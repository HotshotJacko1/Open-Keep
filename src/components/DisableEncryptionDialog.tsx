// Copyright (c) 2026. Licensed under AGPLv3.
import React, { useState, useEffect } from "react";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { showSuccess, showError } from "@/utils/toast";
import { ArrowLeft, Unlock } from "lucide-react";
import { disableEncryption, verifyEncryptionPin } from "@/lib/encryption-pin";
import { getLockRemainingMs, recordFailedAttempt, clearFailedAttempts, formatLockRemaining } from "@/lib/pin-attempts";
import { useBackToClose } from "@/hooks/use-back-to-close";

interface DisableEncryptionDialogProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void;
}

const DisableEncryptionDialog: React.FC<DisableEncryptionDialogProps> = ({ isOpen, onClose, onSuccess }) => {
    const [currentPin, setCurrentPin] = useState("");
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        if (isOpen) {
            // eslint-disable-next-line react-hooks/set-state-in-effect -- resets local form state each time the dialog opens (intentional)
            setCurrentPin("");
            setIsLoading(false);
        }
    }, [isOpen]);

    useBackToClose("disable-encryption", isOpen, onClose);

    const handleDisable = async () => {
        if (!currentPin) {
            showError("Please enter your current PIN");
            return;
        }

        const lockRemaining = getLockRemainingMs();
        if (lockRemaining > 0) {
            showError(`Too many attempts. Try again in ${formatLockRemaining(lockRemaining)}.`);
            return;
        }

        setIsLoading(true);
        try {
            // Verified by unwrapping the key with it, not by comparing to a stored copy.
            if (!(await verifyEncryptionPin(currentPin))) {
                const state = recordFailedAttempt();
                showError(
                    state.locked
                        ? `Too many attempts. Try again in ${formatLockRemaining(state.remainingMs)}.`
                        : "Current PIN is incorrect"
                );
                return;
            }
            clearFailedAttempts();

            // Re-key to the transparent empty PIN. If App Lock is on it stays on,
            // with the same PIN, now checked against a verifier instead.
            await disableEncryption(currentPin);

            showSuccess("Encryption disabled successfully");
            onSuccess();
            onClose();
        } catch (error) {
            console.error(error);
            showError("Failed to disable encryption. Please try again.");
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent
                aria-describedby={undefined}
                className="sm:max-w-[425px] bg-background text-primary-foreground"
            >
                <DialogHeader className="flex flex-row items-center gap-2 space-y-0 text-left">
                    <Button variant="ghost" size="icon" onClick={onClose} className="touch-target shrink-0 mt-0 h-8 w-8">
                        <ArrowLeft className="h-5 w-5 text-secondary" />
                        <span className="sr-only">Back</span>
                    </Button>
                    <DialogTitle>Disable Encryption</DialogTitle>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="flex flex-col items-center justify-center text-center space-y-2 mb-2">
                        <div className="w-12 h-12 bg-destructive/10 rounded-full flex items-center justify-center mb-2">
                            <Unlock className="w-6 h-6 text-destructive" />
                        </div>
                        <DialogDescription className="text-sm">
                            Your notes stay encrypted on this device, but with a key anyone with a copy of the app could derive. Anything you sync to the cloud will be uploaded unencrypted.
                            <br />
                            <br />
                            App Lock and Biometrics will remain enabled using your current PIN.
                        </DialogDescription>
                    </div>

                    <div className="flex flex-col gap-2">
                        <Label htmlFor="current-pin">Current PIN</Label>
                        <Input
                            id="current-pin"
                            type="password"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            value={currentPin}
                            onChange={(e) => setCurrentPin(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter" && !isLoading && currentPin) {
                                    handleDisable();
                                }
                            }}
                            placeholder="Enter current PIN to confirm"
                            disabled={isLoading}
                            maxLength={6}
                        />
                    </div>
                </div>
                <div className="flex flex-col items-center mt-2">
                    <Button variant="destructive" onClick={handleDisable} disabled={isLoading || !currentPin} className="w-full">
                        {isLoading ? "Disabling..." : "Disable Encryption"}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
};

export default DisableEncryptionDialog;
