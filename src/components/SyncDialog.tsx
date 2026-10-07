// Copyright (c) 2026. Licensed under AGPLv3.
import React, { useMemo, useState, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useGoogleDrive } from "@/hooks/use-google-drive";
import { useOneDrive } from "@/hooks/use-one-drive";
import { useDropbox } from "@/hooks/use-dropbox";
import { FULL_BUILD_PLAY_URL, FULL_BUILD_GITHUB_URL } from "@/lib/build-flavor";

import { Loader2, FolderSync, ArrowLeft, AlertCircle, Check } from "lucide-react";
import { showSuccess, showError } from "@/utils/toast";
import { loadNotes, verifyEncryptionPin, type SyncConflictReason, type SyncResult } from "@/lib/note-storage";
import { disableEncryption } from "@/lib/encryption-pin";
import { getSessionPin, isEncryptionEnabled, setCloudKeyCache, setCloudKeyPushPending, setSessionPin } from "@/lib/pin";
import { useBackToClose } from "@/hooks/use-back-to-close";

interface SyncDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

type SyncService =
  | ReturnType<typeof useGoogleDrive>
  | ReturnType<typeof useOneDrive>
  | ReturnType<typeof useDropbox>;

const SyncDialog: React.FC<SyncDialogProps> = ({ isOpen, onClose }) => {
  const googleDrive = useGoogleDrive();
  const oneDrive = useOneDrive();
  const dropbox = useDropbox();

  const [conflictData, setConflictData] = useState<{ activeService: SyncService, cloudPayload: string, reason?: SyncConflictReason } | null>(null);
  const [providedPin, setProvidedPin] = useState("");
  const [localNotesCount, setLocalNotesCount] = useState<number | null>(null);

  React.useEffect(() => {
    if (conflictData) {
      loadNotes().then(notes => setLocalNotesCount(notes.length)).catch(() => setLocalNotesCount(0));
    }
  }, [conflictData]);

  React.useEffect(() => {
    const handleGlobalConflict = ((e: CustomEvent) => {
      const { service, payload, reason } = e.detail;
      let activeSvc;
      if (service === 'onedrive') activeSvc = { ...oneDrive, name: "OneDrive" };
      else if (service === 'dropbox') activeSvc = { ...dropbox, name: "Dropbox" };
      else activeSvc = { ...googleDrive, name: "Google Drive" };
      
      setConflictData({ activeService: activeSvc, cloudPayload: payload, reason });
    }) as EventListener;

    window.addEventListener('open-sync-conflict', handleGlobalConflict);
    return () => window.removeEventListener('open-sync-conflict', handleGlobalConflict);
  }, [oneDrive, dropbox, googleDrive]);
  useBackToClose("sync", isOpen, onClose, () => {
      // Back from the conflict view returns to the main sync view.
      if (!conflictData) return false;
      setConflictData(null);
      return true;
  });

  // Determine which service is active
  const activeService = useMemo(() => {
    if (googleDrive.isConnected) return { ...googleDrive, name: "Google Drive" };
    if (oneDrive.isConnected) return { ...oneDrive, name: "OneDrive" };
    if (dropbox.isConnected) return { ...dropbox, name: "Dropbox" };
    return null;
  }, [googleDrive.isConnected, oneDrive.isConnected, dropbox.isConnected, googleDrive, oneDrive, dropbox]);

  const isAnySyncing = googleDrive.isSyncing || oneDrive.isSyncing || dropbox.isSyncing;

  const [justSynced, setJustSynced] = useState(false);
  const justSyncedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    return () => {
      if (justSyncedTimeoutRef.current) clearTimeout(justSyncedTimeoutRef.current);
    };
  }, []);

  const handleSync = async () => {
    if (!activeService) return;
    const result = await activeService.sync();
    if (result && result.status === "conflict" && 'cloudPayload' in result) {
      setConflictData({ activeService, cloudPayload: result.cloudPayload, reason: result.reason });
    } else if (result && result.status === "success") {
      if (justSyncedTimeoutRef.current) clearTimeout(justSyncedTimeoutRef.current);
      setJustSynced(true);
      justSyncedTimeoutRef.current = setTimeout(() => setJustSynced(false), 1200);
    }
  };

  const applyResult = (result: SyncResult | undefined, service: SyncService) => {
    if (result?.status === "success") {
      setConflictData(null);
      setProvidedPin("");
    } else if (result?.status === "conflict") {
      setConflictData({ activeService: service, cloudPayload: result.cloudPayload, reason: result.reason });
    }
  };

  // This device's own encryption PIN: from this session, or typed into the panel.
  const getOwnPin = async (): Promise<string | null> => {
    const sessionPin = getSessionPin();
    if (sessionPin) return sessionPin;
    const typed = providedPin.trim();
    if (!typed) {
      showError("Enter this device's encryption PIN");
      return null;
    }
    if (!(await verifyEncryptionPin(typed))) {
      showError("Incorrect PIN");
      return null;
    }
    setSessionPin(typed);
    return typed;
  };

  const syncWithOwnPin = async () => {
    if (!conflictData) return;
    const result = await conflictData.activeService.sync(undefined, undefined, providedPin.trim());
    applyResult(result, conflictData.activeService);
  };

  // C2-22. Cloud encryption is one setting shared by every synced device, so the
  // only choices are to match the other device or to put the PIN back for everyone.
  const turnEncryptionOffHere = async () => {
    if (!conflictData) return;
    const pin = await getOwnPin();
    if (pin === null) return;
    try {
      await disableEncryption(pin);
    } catch (e) {
      console.error(e);
      showError("Failed to turn off encryption. Please try again.");
      return;
    }
    showSuccess("Encryption turned off on this device");
    applyResult(await conflictData.activeService.sync(), conflictData.activeService);
  };

  const reEnableForAllDevices = async () => {
    if (!conflictData) return;
    const pin = await getOwnPin();
    if (pin === null) return;
    // Treat the empty-PIN copy as this device's previous wrap, so the next sync
    // replaces it with one under this PIN. Other devices then get asked for it.
    setCloudKeyCache(conflictData.cloudPayload);
    setCloudKeyPushPending(true);
    applyResult(await conflictData.activeService.sync(), conflictData.activeService);
  };

  const resolveConflict = async (resolution: "local" | "cloud" | "merge") => {
    if (!conflictData) return;
    const result = await conflictData.activeService.sync(
      resolution,
      conflictData.cloudPayload,
      providedPin !== undefined ? providedPin.trim() : ""
    );
    if (result?.status === "success") {
      setConflictData(null);
      setProvidedPin("");
    } else if (result?.status === "conflict") {
      setConflictData({
        activeService: conflictData.activeService,
        cloudPayload: result.cloudPayload,
        reason: result.reason
      });
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="w-full h-full max-w-full sm:max-w-[425px] sm:h-auto sm:max-h-[85vh] sm:rounded-lg !rounded-none sm:!rounded-lg overflow-y-auto bg-background text-primary-foreground border-0 sm:border pt-[max(env(safe-area-inset-top,3.5rem),3.5rem)] sm:pt-6 pb-[max(env(safe-area-inset-bottom),1.5rem)] px-6">
        <DialogHeader className="flex flex-row items-start gap-2 space-y-0 text-left">
          <Button variant="ghost" size="icon" onClick={onClose} className="touch-target shrink-0 mt-0 h-8 w-8">
              <ArrowLeft className="h-5 w-5 text-secondary" />
              <span className="sr-only">Back</span>
          </Button>
          <div className="flex flex-col gap-1">
            <DialogTitle>Sync Options</DialogTitle>
            <DialogDescription>
              Manage your cloud sync connections and settings.
            </DialogDescription>
          </div>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="flex flex-col gap-4">
            <Label>Cloud Sync</Label>



            <p className="text-sm text-primary-foreground">
              Sync your notes to a cloud provider to keep them backed up and accessible.
            </p>

            {!activeService ? (
              <div className="flex flex-col gap-2">
                {googleDrive.isAvailable ? (
                  <Button
                    onClick={async () => {
                      showSuccess("Initiating Google Login...");
                      const result = await googleDrive.login();
                      if (result && result.status === "conflict" && 'cloudPayload' in result) {
                        setConflictData({ activeService: googleDrive, cloudPayload: result.cloudPayload, reason: result.reason });
                      }
                    }}
                    className="w-full justify-start"
                    variant="outline"
                    type="button"
                  >
                    <FolderSync className="mr-2 h-4 w-4" /> Sync with Google Drive
                  </Button>
                ) : (
                  <div className="flex flex-col gap-1">
                    <Button className="w-full justify-start" variant="outline" type="button" disabled>
                      <FolderSync className="mr-2 h-4 w-4" /> Sync with Google Drive
                    </Button>
                    <p className="text-xs text-primary-foreground/70 px-1">
                      Google Drive sync is available in the full build at{" "}
                      <a href={FULL_BUILD_PLAY_URL} target="_blank" rel="noreferrer" className="underline">
                        Google Play
                      </a>{" "}
                      or{" "}
                      <a href={FULL_BUILD_GITHUB_URL} target="_blank" rel="noreferrer" className="underline">
                        GitHub
                      </a>.
                    </p>
                  </div>
                )}
                <Button onClick={() => oneDrive.login()} className="w-full justify-start" variant="outline" type="button">
                  <FolderSync className="mr-2 h-4 w-4" /> Sync with OneDrive
                </Button>
                <Button onClick={() => dropbox.login()} className="w-full justify-start" variant="outline" type="button">
                  <FolderSync className="mr-2 h-4 w-4" /> Sync with Dropbox
                </Button>
              </div>
            ) : conflictData?.reason === "pin_required" ? (
              <div className="flex flex-col gap-4 py-2 border rounded-md p-4 bg-muted/50">
                <div className="flex items-center gap-2">
                  <AlertCircle className="h-5 w-5 text-warning" />
                  <h3 className="font-semibold text-lg text-primary-foreground">Enter your PIN to sync</h3>
                </div>
                <p className="text-sm text-primary-foreground/90 leading-relaxed">
                  Your notes are encrypted, and the key stored in {activeService.name} has changed since this device last checked it. Enter this device's encryption PIN to keep syncing.
                </p>
                <input
                  type="password"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={providedPin}
                  onChange={e => setProvidedPin(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && providedPin) syncWithOwnPin(); }}
                  placeholder="Encryption PIN"
                  className="border rounded px-2 py-1 bg-background text-sm"
                  autoFocus
                />
                <div className="flex flex-col gap-3 mt-2">
                  <Button onClick={syncWithOwnPin} disabled={isAnySyncing || !providedPin}>
                    {isAnySyncing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Sync
                  </Button>
                  <Button variant="ghost" onClick={() => setConflictData(null)} disabled={isAnySyncing}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : conflictData?.reason === "encryption_disabled_elsewhere" ? (
              <div className="flex flex-col gap-4 py-2 border rounded-md p-4 bg-muted/50">
                <div className="flex items-center gap-2">
                  <AlertCircle className="h-5 w-5 text-warning" />
                  <h3 className="font-semibold text-lg text-primary-foreground">Encryption was turned off on another device</h3>
                </div>
                <p className="text-sm text-primary-foreground/90 leading-relaxed">
                  The copy in {activeService.name} is no longer protected by a PIN. Encryption applies to all your synced devices together, so choose one setting for all of them:
                </p>
                <ul className="text-sm text-primary-foreground/90 list-disc pl-5 space-y-1">
                  <li><strong>Turn off here too:</strong> this device stops using a PIN, like the other one.</li>
                  <li><strong>Turn back on for all devices:</strong> the cloud copy is protected with this device's PIN again. Your other devices will ask for it on their next sync.</li>
                </ul>
                {!getSessionPin() && (
                  <input
                    type="password"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={providedPin}
                    onChange={e => setProvidedPin(e.target.value)}
                    placeholder="This device's encryption PIN"
                    className="border rounded px-2 py-1 bg-background text-sm"
                    autoFocus
                  />
                )}
                <div className="flex flex-col gap-3 mt-2">
                  <Button variant="outline" onClick={turnEncryptionOffHere} disabled={isAnySyncing}>
                    {isAnySyncing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Turn Off Encryption Here Too
                  </Button>
                  <Button onClick={reEnableForAllDevices} disabled={isAnySyncing}>
                    {isAnySyncing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Turn Encryption Back On for All Devices
                  </Button>
                  <Button variant="ghost" onClick={() => setConflictData(null)} disabled={isAnySyncing}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : conflictData ? (
              <div className="flex flex-col gap-4 py-2 border rounded-md p-4 bg-muted/50">
                <div className="flex items-center gap-2 text-destructive">
                  <AlertCircle className="h-5 w-5" />
                  <h3 className="font-semibold text-lg text-primary-foreground">Sync Conflict Detected</h3>
                </div>
                <p className="text-sm text-primary-foreground/90 leading-relaxed">
                  Cloud data was found. Which version would you like to keep?
                  Choosing <strong>Cloud</strong> will replace your local notes with the cloud backup.
                  Choosing <strong>Local</strong> will overwrite the cloud with your device's notes.
                  {localNotesCount !== null && (
                    <span className="block mt-2 font-semibold">
                      Local notes: {localNotesCount}
                    </span>
                  )}
                </p>
                <p className="text-sm font-medium text-primary-foreground">How would you like to resolve this?</p>
                
                {conflictData.reason === "key_mismatch" && (
                  <div className="flex flex-col gap-2 mt-2 p-3 bg-warning/10 border border-warning/50 rounded-md">
                    <Label className="text-warning">🔐 Cloud notes are encrypted</Label>
                    <p className="text-xs text-warning/90 mb-1">
                      {isEncryptionEnabled()
                        ? "Enter the App Lock PIN you set on your other device to decrypt and restore your notes."
                        : "These notes are protected by a PIN set on another device. Enter that PIN to keep syncing. This turns encryption on here too, with the same PIN. To keep this device without a PIN, disconnect sync here instead."}
                    </p>
                    <input 
                      type="password" 
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={providedPin}
                      onChange={e => setProvidedPin(e.target.value)}
                      placeholder="Enter your PIN"
                      className="border rounded px-2 py-1 bg-background text-sm"
                      autoFocus
                    />
                  </div>
                )}
                
                <div className="flex flex-col gap-3 mt-2">
                  <Button 
                    variant="default" 
                    onClick={() => resolveConflict("merge")}
                    disabled={isAnySyncing}
                  >
                     {isAnySyncing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Merge Both Together (Keep All Notes)
                  </Button>
                  <Button 
                    variant="destructive" 
                    onClick={() => resolveConflict("cloud")}
                    disabled={isAnySyncing}
                  >
                     {isAnySyncing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Keep Cloud Data (Deletes Local Notes)
                  </Button>
                  <Button 
                    variant="outline" 
                    onClick={() => resolveConflict("local")}
                    // Off until the count has loaded (null), not only when it's 0 (C1-27).
                    disabled={isAnySyncing || !localNotesCount}
                  >
                     {isAnySyncing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Keep Local Data (Overwrites Cloud)
                  </Button>
                  <Button 
                    variant="ghost" 
                    onClick={() => setConflictData(null)}
                    disabled={isAnySyncing}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-3 border rounded-md p-4 bg-muted/50 text-primary-foreground">
                <div className="flex flex-col gap-1">
                  <span className="text-sm font-medium">Connected to {activeService.name}</span>
                  <span className="text-sm break-all">{activeService.userEmail || "Connected"}</span>
                </div>

                <div className="flex flex-col gap-1">
                  <span className="text-sm font-medium">Last Synced</span>
                  <span className="text-sm text-primary-foreground">
                    {activeService.lastSynced || "Never"}
                  </span>
                </div>

                <div className="flex gap-2 mt-2">
                  <Button
                    variant="outline"
                    onClick={handleSync}
                    disabled={isAnySyncing}
                    className={cn(
                      "flex-1 text-primary-foreground transition-colors duration-md3-short4 ease-md3-standard",
                      justSynced && "bg-success hover:bg-success border-success text-success-foreground"
                    )}
                  >
                    {activeService.isSyncing ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : justSynced ? (
                      <Check className="mr-2 h-4 w-4" />
                    ) : null}
                    {activeService.isSyncing ? "Syncing..." : justSynced ? "Synced" : "Sync Now"}
                  </Button>
                  <Button
                    variant="outline"
                    className="bg-secondary"
                    onClick={activeService.disconnect}
                    disabled={isAnySyncing}
                  >
                    Disconnect
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default SyncDialog;