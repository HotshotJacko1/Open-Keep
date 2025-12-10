import React from "react";
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
import { Loader2 } from "lucide-react";

interface SyncDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

const SyncDialog: React.FC<SyncDialogProps> = ({ isOpen, onClose }) => {
  const {
    login,
    sync,
    disconnect,
    isSyncing,
    lastSynced,
    userEmail,
    isConnected
  } = useGoogleDrive();

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[425px] bg-[#202124]">
        <DialogHeader>
          <DialogTitle>Sync Options</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="flex flex-col gap-4">
            <Label>Google Drive Sync</Label>

            <p className="text-sm text-muted-foreground">
              Sync your notes to a specialized folder in your Google Drive to keep them backed up and accessible.
            </p>

            {!isConnected ? (
              <Button onClick={() => login()} className="w-full">
                Sync with Google Drive
              </Button>
            ) : (
              <div className="flex flex-col gap-3 border rounded-md p-4 bg-muted/50">
                <div className="flex flex-col gap-1">
                  <span className="text-sm font-medium">Connected Account</span>
                  <span className="text-sm text-muted-foreground break-all">{userEmail}</span>
                </div>

                <div className="flex flex-col gap-1">
                  <span className="text-sm font-medium">Last Synced</span>
                  <span className="text-sm text-muted-foreground">
                    {lastSynced || "Never"}
                  </span>
                </div>

                <div className="flex gap-2 mt-2">
                  <Button
                    onClick={() => sync()}
                    disabled={isSyncing}
                    className="flex-1"
                  >
                    {isSyncing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {isSyncing ? "Syncing..." : "Sync Now"}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={disconnect}
                    disabled={isSyncing}
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