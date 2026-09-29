// Copyright (c) 2026. Licensed under AGPLv3.
import React, { useState, useEffect } from "react";
import { getLockRemainingMs, recordFailedAttempt, clearFailedAttempts, formatLockRemaining } from "@/lib/pin-attempts";
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
import { ArrowLeft } from "lucide-react";
import { clearAllData } from "@/lib/note-storage";
import { changeEncryptionPin, verifyEncryptionPin } from "@/lib/encryption-pin";
import { clearAllPinState, validateNewPin } from "@/lib/pin";
import { deleteAllRemoteData } from "@/lib/cloud-reset";
import ResetDialog from "./ResetDialog";
import { useBackToClose } from "@/hooks/use-back-to-close";

interface ChangePinDialogProps {
    isOpen: boolean;
    onClose: () => void;
}

const ChangePinDialog: React.FC<ChangePinDialogProps> = ({ isOpen, onClose }) => {
    const [currentPin, setCurrentPin] = useState("");
    const [newPin, setNewPin] = useState("");
    const [confirmPin, setConfirmPin] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [isResetDialogOpen, setIsResetDialogOpen] = useState(false);
    const [isResetting, setIsResetting] = useState(false);

    useEffect(() => {
        if (isOpen) {
            // eslint-disable-next-line react-hooks/set-state-in-effect -- resets local form state each time the dialog opens (intentional)
            setCurrentPin("");
            setNewPin("");
            setConfirmPin("");
            setIsLoading(false);
        }
    }, [isOpen]);

    useBackToClose("change-pin", isOpen, onClose);

    const handleChangePin = async () => {
        if (!currentPin) {
            showError("Please enter your current PIN");
            return;
        }

        const lockRemaining = getLockRemainingMs();
        if (lockRemaining > 0) {
            showError(`Too many attempts. Try again in ${formatLockRemaining(lockRemaining)}.`);
            return;
        }

        const validationError = validateNewPin(newPin, confirmPin, { currentPin, label: "New PIN" });
        if (validationError) {
            showError(validationError);
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

            // One native re-key; there is no stored PIN left to update alongside it.
            await changeEncryptionPin(currentPin, newPin);

            showSuccess("Encryption PIN changed successfully");
            onClose();
        } catch (error) {
            console.error(error);
            showError("Failed to change PIN. Please try again.");
        } finally {
            setIsLoading(false);
        }
    };

    const handleForgotPin = async () => {
        setIsResetDialogOpen(true);
    };

    const confirmReset = async () => {
        setIsResetting(true);
        try {
            // This dialog only exists while encryption is on, so a forgotten PIN
            // means the notes can't be opened again: delete them (web included).
            await clearAllData();
            await deleteAllRemoteData();

            clearAllPinState();
            localStorage.removeItem("custom-tags");
            
            // Clear sync state
            localStorage.removeItem("last-synced-time");
            localStorage.removeItem("google-access-token");
            localStorage.removeItem("google-token-expiry");
            localStorage.removeItem("google-user-email");
            localStorage.removeItem("dropbox-access-token");
            localStorage.removeItem("dropbox-refresh-token");
            localStorage.removeItem("dropbox-token-expires-at");
            localStorage.removeItem("dropbox-last-synced");
            localStorage.removeItem("onedrive-user-email");
            localStorage.removeItem("onedrive-last-synced");

            showSuccess("App reset successfully");
            
            // Bypass onClose() so window.history.back() isn't triggered from the cleanup
            // Use reload inside a timeout to prevent the current state from lingering in history 
            // and bypassing the back button lock
            setTimeout(() => {
                window.location.reload();
            }, 100);
        } catch (e) {
            console.error(e);
            showError("Failed to reset app");
        } finally {
            setIsResetting(false);
            setIsResetDialogOpen(false);
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
                            onKeyDown={(e) => {
                                if (e.key === "Enter" && !isLoading && currentPin && newPin && confirmPin) {
                                    handleChangePin();
                                }
                            }}
                            placeholder="Retype new PIN"
                            disabled={isLoading}
                            maxLength={6}
                        />
                    </div>
                </div>
                <div className="flex flex-col items-center mt-2">
                    <Button variant="link" className="text-muted-foreground text-sm mb-2" onClick={handleForgotPin}>
                        Forgot PIN?
                    </Button>
                    <Button onClick={handleChangePin} disabled={isLoading || !currentPin || !newPin || !confirmPin} className="w-full">
                        {isLoading ? "Changing..." : "Change PIN"}
                    </Button>
                </div>
                <ResetDialog
                    isOpen={isResetDialogOpen}
                    onOpenChange={setIsResetDialogOpen}
                    onConfirm={confirmReset}
                    isResetting={isResetting}
                    isEncryptionEnabled
                />
            </DialogContent>
        </Dialog>
    );
};

export default ChangePinDialog;
