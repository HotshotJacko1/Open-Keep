import React, { useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useGoogleDrive } from "@/hooks/use-google-drive";
import { useOneDrive } from "@/hooks/use-one-drive";
import { useDropbox } from "@/hooks/use-dropbox";
import { Loader2, FolderSync } from "lucide-react";

interface SyncDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

const SyncDialog: React.FC<SyncDialogProps> = ({ isOpen, onClose }) => {
  const googleDrive = useGoogleDrive();
  const oneDrive = useOneDrive();
  const dropbox = useDropbox();

  // Determine which service is active
  const activeService = useMemo(() => {
    if (googleDrive.isConnected) return { ...googleDrive, name: "Google Drive" };
    if (oneDrive.isConnected) return { ...oneDrive, name: "OneDrive" };
    if (dropbox.isConnected) return { ...dropbox, name: "Dropbox" };
    return null;
  }, [googleDrive.isConnected, oneDrive.isConnected, dropbox.isConnected, googleDrive, oneDrive, dropbox]);

  const isAnySyncing = googleDrive.isSyncing || oneDrive.isSyncing || dropbox.isSyncing;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[425px] bg-white dark:bg-[#202124] text-primary-foreground">
        <DialogHeader>
          <DialogTitle>Sync Options</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="flex flex-col gap-4">
            <Label>Cloud Sync</Label>

            <p className="text-sm text-primary-foreground">
              Sync your notes to a cloud provider to keep them backed up and accessible.
            </p>

            {!activeService ? (
              <div className="flex flex-col gap-2">
                <Button onClick={() => googleDrive.login()} className="w-full justify-start" variant="outline">
                  <FolderSync className="mr-2 h-4 w-4" /> Sync with Google Drive
                </Button>
                <Button onClick={() => oneDrive.login()} className="w-full justify-start" variant="outline">
                  <FolderSync className="mr-2 h-4 w-4" /> Sync with OneDrive
                </Button>
                <Button onClick={() => dropbox.login()} className="w-full justify-start" variant="outline">
                  <FolderSync className="mr-2 h-4 w-4" /> Sync with Dropbox
                </Button>
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
                    onClick={() => activeService.sync()}
                    disabled={isAnySyncing}
                    className="flex-1 text-primary-foreground"
                  >
                    {activeService.isSyncing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {activeService.isSyncing ? "Syncing..." : "Sync Now"}
                  </Button>
                  <Button
                    variant="outline"
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
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default SyncDialog;