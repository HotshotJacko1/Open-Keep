import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/context/theme-provider";
import { showSuccess, showError } from "@/utils/toast";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Sun, Moon, Monitor } from "lucide-react";
import SyncDialog from "./SyncDialog"; // Import the new SyncDialog

interface SettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

const LOCAL_STORAGE_PASSCODE_KEY = "app-passcode";

const SettingsDialog: React.FC<SettingsDialogProps> = ({ isOpen, onClose }) => {
  const { theme, setTheme } = useTheme();
  const [passcode, setPasscode] = useState("");
  const [currentPasscode, setCurrentPasscode] = useState<string | null>(null);
  const [isSyncDialogOpen, setIsSyncDialogOpen] = useState(false);

  useEffect(() => {
    if (isOpen) {
      const storedPasscode = localStorage.getItem(LOCAL_STORAGE_PASSCODE_KEY);
      setCurrentPasscode(storedPasscode);
      setPasscode(""); // Clear input when dialog opens
    }
  }, [isOpen]);

  const handleSavePasscode = () => {
    if (passcode.length === 4 && /^\d+$/.test(passcode)) {
      localStorage.setItem(LOCAL_STORAGE_PASSCODE_KEY, passcode);
      setCurrentPasscode(passcode);
      showSuccess("Passcode set successfully!");
    } else if (passcode === "") {
      localStorage.removeItem(LOCAL_STORAGE_PASSCODE_KEY);
      setCurrentPasscode(null);
      showSuccess("Passcode removed.");
    } else {
      showError("Passcode must be a 4-digit number or empty to remove.");
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      handleSavePasscode();
    }
  };

  return (
    <>
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="sm:max-w-[425px] bg-[#202124]">
          <DialogHeader>
            <DialogTitle>Settings</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="theme">Theme</Label>
              <ToggleGroup
                type="single"
                value={theme}
                onValueChange={(value: "light" | "dark" | "system") => {
                  if (value) setTheme(value);
                }}
                className="justify-start"
              >
                <ToggleGroupItem value="light" aria-label="Toggle light theme">
                  <Sun className="h-4 w-4 mr-2" /> Light
                </ToggleGroupItem>
                <ToggleGroupItem value="dark" aria-label="Toggle dark theme">
                  <Moon className="h-4 w-4 mr-2" /> Dark
                </ToggleGroupItem>
                <ToggleGroupItem value="system" aria-label="Toggle system theme">
                  <Monitor className="h-4 w-4 mr-2" /> System
                </ToggleGroupItem>
              </ToggleGroup>
            </div>

            <div className="flex flex-col gap-2 mt-4">
              <Label htmlFor="passcode">App Passcode (4-digits)</Label>
              <Input
                id="passcode"
                type="password"
                maxLength={4}
                value={passcode}
                onChange={(e) => setPasscode(e.target.value)}
                onKeyDown={handleKeyDown}
                // Added onKeyDown handler
                placeholder={currentPasscode ? "Enter new passcode or leave empty to remove" : "Set a 4-digit passcode"}
              />
              <p className="text-sm text-muted-foreground">
                {currentPasscode ? "Passcode is currently set." : "No passcode set."}
              </p>
              <Button onClick={handleSavePasscode} className="mt-2" variant="outline">
                {currentPasscode ? "Update Passcode" : "Set Passcode"}
              </Button>
            </div>

            <div className="flex flex-col gap-2 mt-4">
              <Label>Sync</Label>
              <Button variant="outline" onClick={() => setIsSyncDialogOpen(true)}>
                Open Sync Options
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SyncDialog
        isOpen={isSyncDialogOpen}
        onClose={() => setIsSyncDialogOpen(false)}
      />
    </>
  );
};

export default SettingsDialog;