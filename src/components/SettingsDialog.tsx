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
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/context/theme-provider";
import { showSuccess, showError } from "@/utils/toast";

interface SettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

const LOCAL_STORAGE_PASSCODE_KEY = "app-passcode";

const SettingsDialog: React.FC<SettingsDialogProps> = ({ isOpen, onClose }) => {
  const { theme, setTheme } = useTheme();
  const [passcode, setPasscode] = useState("");
  const [currentPasscode, setCurrentPasscode] = useState<string | null>(null);

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
      onClose();
    } else if (passcode === "") {
      localStorage.removeItem(LOCAL_STORAGE_PASSCODE_KEY);
      setCurrentPasscode(null);
      showSuccess("Passcode removed.");
      onClose();
    } else {
      showError("Passcode must be a 4-digit number or empty to remove.");
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="theme">Theme</Label>
            <RadioGroup
              id="theme"
              value={theme}
              onValueChange={(value: "light" | "dark" | "system") => setTheme(value)}
              className="flex space-x-4"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="light" id="light" />
                <Label htmlFor="light">Light</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="dark" id="dark" />
                <Label htmlFor="dark">Dark</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="system" id="system" />
                <Label htmlFor="system">System</Label>
              </div>
            </RadioGroup>
          </div>

          <div className="flex flex-col gap-2 mt-4">
            <Label htmlFor="passcode">App Passcode (4-digits)</Label>
            <Input
              id="passcode"
              type="password"
              maxLength={4}
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
              placeholder={currentPasscode ? "Enter new passcode or leave empty to remove" : "Set a 4-digit passcode"}
            />
            <p className="text-sm text-muted-foreground">
              {currentPasscode ? "Passcode is currently set." : "No passcode set."}
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSavePasscode}>
            {currentPasscode ? "Update Passcode" : "Set Passcode"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default SettingsDialog;