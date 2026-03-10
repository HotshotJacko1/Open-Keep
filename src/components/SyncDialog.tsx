import React, { useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useGoogleDrive } from "@/hooks/use-google-drive";
import { useOneDrive } from "@/hooks/use-one-drive";
import { useDropbox } from "@/hooks/use-dropbox";

import { Loader2, FolderSync, ArrowLeft } from "lucide-react";
import { showSuccess, showError } from "@/utils/toast";
import { App } from "@capacitor/app";

interface SyncDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

const SyncDialog: React.FC<SyncDialogProps> = ({ isOpen, onClose }) => {
  const googleDrive = useGoogleDrive();
  const oneDrive = useOneDrive();
  const dropbox = useDropbox();



  React.useEffect(() => {
    if (!isOpen) return;

    window.history.pushState({ dialog: 'sync' }, "");

    const handlePopState = () => {
      onClose();
    };

    window.addEventListener('popstate', handlePopState);

    const backButtonListener = App.addListener('backButton', () => {
      onClose();
    });

    return () => {
      window.removeEventListener('popstate', handlePopState);
      if (window.history.state?.dialog === 'sync') {
        window.history.back();
      }
      backButtonListener.then(listener => listener.remove());
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

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
      <DialogContent className="w-full h-full max-w-full sm:max-w-[425px] sm:h-auto sm:max-h-[85vh] sm:rounded-lg !rounded-none sm:!rounded-lg overflow-y-auto bg-background text-primary-foreground border-0 sm:border pt-[max(env(safe-area-inset-top,3.5rem),3.5rem)] sm:pt-6 pb-[max(env(safe-area-inset-bottom),1.5rem)] px-6">
        <DialogHeader className="flex flex-row items-start gap-2 space-y-0 text-left">
          <Button variant="ghost" size="icon" onClick={onClose} className="shrink-0 mt-0 h-8 w-8">
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
                <Button
                  onClick={() => {
                    showSuccess("Initiating Google Login...");
                    console.log("Calling googleDrive.login()");
                    googleDrive.login();
                  }}
                  className="w-full justify-start"
                  variant="outline"
                  type="button"
                >
                  <FolderSync className="mr-2 h-4 w-4" /> Sync with Google Drive
                </Button>
                <Button onClick={() => oneDrive.login()} className="w-full justify-start" variant="outline" type="button">
                  <FolderSync className="mr-2 h-4 w-4" /> Sync with OneDrive
                </Button>
                <Button onClick={() => dropbox.login()} className="w-full justify-start" variant="outline" type="button">
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
                    variant="outline"
                    onClick={() => activeService.sync()}
                    disabled={isAnySyncing}
                    className="flex-1 text-primary-foreground"
                  >
                    {activeService.isSyncing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {activeService.isSyncing ? "Syncing..." : "Sync Now"}
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