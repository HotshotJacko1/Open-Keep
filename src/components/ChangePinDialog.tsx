import React, { useState, useEffect } from "react";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { showSuccess, showError } from "@/utils/toast";
import { changeEncryptionKey } from "@/lib/note-storage";

interface ChangePinDialogProps {
    isOpen: boolean;
    onClose: () => void;
}

const ChangePinDialog: React.FC<ChangePinDialogProps> = ({ isOpen, onClose }) => {
    const [currentPin, setCurrentPin] = useState("");
    const [newPin, setNewPin] = useState("");
    const [confirmPin, setConfirmPin] = useState("");
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        if (isOpen) {
            setCurrentPin("");
            setNewPin("");
            setConfirmPin("");
            setIsLoading(false);
        }
    }, [isOpen]);

    const handleChangePin = async () => {
        // 1. Validate inputs
        if (!currentPin) {
            showError("Please enter your current PIN");
            return;
        }

        // Check against stored passcode
        const storedPasscode = localStorage.getItem("app-passcode");
        if (currentPin !== storedPasscode) {
            showError("Current PIN is incorrect");
            return;
        }

        if (newPin.length < 4 || newPin.length > 6) {
            showError("New PIN must be 4-6 digits long");
            return;
        }
        if (!/^\d+$/.test(newPin)) {
            showError("New PIN must contain only numbers");
            return;
        }
        if (newPin !== confirmPin) {
            showError("New PINs do not match");
            return;
        }
        if (newPin === currentPin) {
            showError("New PIN must be different from current PIN");
            return;
        }

        setIsLoading(true);
        try {
            // 2. Change native encryption key
            await changeEncryptionKey(newPin);

            // 3. Update local storage passcode
            localStorage.setItem("app-passcode", newPin);

            showSuccess("Encryption PIN changed successfully");
            onClose();
        } catch (error) {
            console.error(error);
            showError("Failed to change PIN. Please try again.");
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="sm:max-w-[425px] bg-background text-primary-foreground">
                <DialogHeader>
                    <DialogTitle>Change Encryption PIN</DialogTitle>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="flex flex-col gap-2">
                        <Label htmlFor="current-pin">Current PIN</Label>
                        <Input
                            id="current-pin"
                            type="password"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            value={currentPin}
                            onChange={(e) => setCurrentPin(e.target.value)}
                            placeholder="Enter current PIN"
                            disabled={isLoading}
                            maxLength={6}
                        />
                    </div>

                    <div className="flex flex-col gap-2">
                        <Label htmlFor="new-pin">New PIN</Label>
                        <Input
                            id="new-pin"
                            type="password"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            value={newPin}
                            onChange={(e) => setNewPin(e.target.value)}
                            placeholder="4-6 digits"
                            disabled={isLoading}
                            maxLength={6}
                        />
                    </div>

                    <div className="flex flex-col gap-2">
                        <Label htmlFor="confirm-pin">Confirm New PIN</Label>
                        <Input
                            id="confirm-pin"
                            type="password"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            value={confirmPin}
                            onChange={(e) => setConfirmPin(e.target.value)}
                            placeholder="Retype new PIN"
                            disabled={isLoading}
                            maxLength={6}
                        />
                    </div>
                </div>
                <Button onClick={handleChangePin} disabled={isLoading || !currentPin || !newPin || !confirmPin} className="w-full mt-4">
                    {isLoading ? "Changing..." : "Change PIN"}
                </Button>
            </DialogContent>
        </Dialog>
    );
};

export default ChangePinDialog;
