import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Button } from "@/components/ui/button";
import { showSuccess } from "@/utils/toast";

interface SyncDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

const LOCAL_STORAGE_SYNC_KEY = "app-sync-option";

const SyncDialog: React.FC<SyncDialogProps> = ({ isOpen, onClose }) => {
  const [syncOption, setSyncOption] = useState<string>("Local Storage (default)");

  useEffect(() => {
    if (isOpen) {
      const storedSyncOption = localStorage.getItem(LOCAL_STORAGE_SYNC_KEY);
      if (storedSyncOption) {
        setSyncOption(storedSyncOption);
      } else {
        setSyncOption("Local Storage (default)");
      }
    }
  }, [isOpen]);

  const handleSyncOptionChange = (value: string) => {
    setSyncOption(value);
    localStorage.setItem(LOCAL_STORAGE_SYNC_KEY, value);
    showSuccess(`Sync option set to ${value}.`);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Sync Options</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="sync-option">Choose your sync method</Label>
            <RadioGroup
              id="sync-option"
              value={syncOption}
              onValueChange={handleSyncOptionChange}
              className="flex flex-col space-y-2"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="Local Storage (default)" id="sync-local" />
                <Label htmlFor="sync-local">Local Storage (default)</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="Google Drive" id="sync-google" />
                <Label htmlFor="sync-google">Google Drive</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="OneDrive" id="sync-onedrive" />
                <Label htmlFor="sync-onedrive">OneDrive</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="Dropbox" id="sync-dropbox" />
                <Label htmlFor="sync-dropbox">Dropbox</Label>
              </div>
            </RadioGroup>
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