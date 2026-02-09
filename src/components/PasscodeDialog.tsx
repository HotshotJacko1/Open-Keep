import React, { useState, useEffect } from "react";
import { NativeBiometric } from "capacitor-native-biometric";
import { Switch } from "@/components/ui/switch";
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
import { showSuccess, showError } from "@/utils/toast";

interface PasscodeDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

const LOCAL_STORAGE_PASSCODE_KEY = "app-passcode";

const PasscodeDialog: React.FC<PasscodeDialogProps> = ({ isOpen, onClose }) => {
  const [passcode, setPasscode] = useState("");
  const [currentPasscode, setCurrentPasscode] = useState<string | null>(null);
  const [isBiometricsAvailable, setIsBiometricsAvailable] = useState(false);
  const [isBiometricsEnabled, setIsBiometricsEnabled] = useState(false);

  useEffect(() => {
    if (isOpen) {
      const storedPasscode = localStorage.getItem(LOCAL_STORAGE_PASSCODE_KEY);
      setCurrentPasscode(storedPasscode);
      setPasscode(""); // Clear input when dialog opens

      // Check biometrics availability
      NativeBiometric.isAvailable().then((result) => {
        setIsBiometricsAvailable(result.isAvailable);
      }).catch(() => setIsBiometricsAvailable(false));

      // Check if enabled
      const enabled = localStorage.getItem("app-biometrics-enabled") === "true";
      setIsBiometricsEnabled(enabled);
    }
  }, [isOpen]);

  const handleToggleBiometrics = async (checked: boolean) => {
    if (checked) {
      try {
        await NativeBiometric.verifyIdentity({
          reason: "Enable biometric authentication",
          title: "Confirm your identity",
          subtitle: "",
          description: "",
        });
        localStorage.setItem("app-biometrics-enabled", "true");
        setIsBiometricsEnabled(true);
        showSuccess("Biometrics enabled");
      } catch (error) {
        console.error("Biometric verification failed", error);
        showError("Failed to enable biometrics");
      }
    } else {
      localStorage.removeItem("app-biometrics-enabled");
      setIsBiometricsEnabled(false);
    }
  };

  const handleSavePasscode = () => {
    if (passcode.length === 4 && /^\d+$/.test(passcode)) {
      localStorage.setItem(LOCAL_STORAGE_PASSCODE_KEY, passcode);
      setCurrentPasscode(passcode);
      showSuccess("Passcode set successfully!");
      // onClose(); // Removed auto-close
    } else if (passcode === "") {
      localStorage.removeItem(LOCAL_STORAGE_PASSCODE_KEY);
      setCurrentPasscode(null);
      showSuccess("Passcode removed.");
      onClose(); // Close dialog after removing
    } else {
      showError("Passcode must be a 4-digit number or empty to remove.");
    }
  };

  const handleRemovePasscode = () => {
    localStorage.removeItem(LOCAL_STORAGE_PASSCODE_KEY);
    setCurrentPasscode(null);
    setPasscode(""); // Clear input
    showSuccess("Passcode removed.");
    onClose(); // Close dialog after removing
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      handleSavePasscode();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent
        className="sm:max-w-[425px] bg-background text-primary-foreground"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>App Passcode</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="passcode">App Passcode (4-digits)</Label>
            <Input
              id="passcode"
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={4}
              value={passcode}
              onChange={(e) => {
                const val = e.target.value;
                if (/^\d*$/.test(val)) {
                  setPasscode(val);
                }
              }}
              onKeyDown={handleKeyDown}
              placeholder={currentPasscode ? "Enter new passcode or leave empty to remove" : "Set a 4-digit passcode"}
            />
            <p className="text-sm text-primary-foreground font-medium">
              {currentPasscode ? "Passcode is currently set." : "No passcode set."}
            </p>
            <div className="flex gap-2 mt-2">
              <Button onClick={handleSavePasscode} variant="outline" className="flex-grow">
                {currentPasscode ? "Update Passcode" : "Set Passcode"}
              </Button>
              {currentPasscode && (
                <Button onClick={handleRemovePasscode} variant="destructive" className="flex-grow">
                  Remove Passcode
                </Button>
              )}
            </div>
            {currentPasscode && isBiometricsAvailable && (
              <div className="flex items-center justify-between border-t pt-4 mt-2">
                <div className="space-y-0.5">
                  <Label htmlFor="biometrics">Biometric Unlock</Label>
                  <p className="text-sm text-primary">
                    Use FaceID or TouchID to unlock
                  </p>
                </div>
                <Switch
                  id="biometrics"
                  checked={isBiometricsEnabled}
                  onCheckedChange={handleToggleBiometrics}
                />
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

export default PasscodeDialog;