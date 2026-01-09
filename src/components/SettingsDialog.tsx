import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/context/theme-provider";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Sun, Moon, Monitor } from "lucide-react";
import SyncDialog from "./SyncDialog";
import PasscodeDialog from "./PasscodeDialog"; // Import the new PasscodeDialog

interface SettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

const SettingsDialog: React.FC<SettingsDialogProps> = ({ isOpen, onClose }) => {
  const { theme, setTheme } = useTheme();
  const [isSyncDialogOpen, setIsSyncDialogOpen] = useState(false);
  const [isPasscodeDialogOpen, setIsPasscodeDialogOpen] = useState(false); // New state for PasscodeDialog

  return (
    <>
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="sm:max-w-[425px] bg-white dark:bg-[#202124]">
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

            {/* Button to open PasscodeDialog */}
            <div className="flex flex-col gap-2 mt-4">
              <Label>App Passcode</Label>
              <Button variant="outline" onClick={() => setIsPasscodeDialogOpen(true)}>
                Manage Passcode
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
      <PasscodeDialog
        isOpen={isPasscodeDialogOpen}
        onClose={() => setIsPasscodeDialogOpen(false)}
      />
    </>
  );
};

export default SettingsDialog;