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
import { ArrowLeft } from "lucide-react";
import { changeEncryptionKey, clearAllData } from "@/lib/note-storage";
import { deleteRemoteData } from "@/lib/google-drive";
import { NativeBiometric } from "@capgo/capacitor-native-biometric";
import ResetDialog from "./ResetDialog";

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
            setCurrentPin("");
            setNewPin("");
            setConfirmPin("");
            setIsLoading(false);
        }
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen) return;

        window.history.pushState({ dialog: 'change-pin' }, "");

        const handlePopState = (event: PopStateEvent) => {
            if (event.state?.dialog === 'change-pin') return;
            onClose();
        };

        window.addEventListener('popstate', handlePopState);

        return () => {
            window.removeEventListener('popstate', handlePopState);
            if (window.history.state?.dialog === 'change-pin') {
                window.history.back();
            }
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
            await changeEncryptionKey(currentPin, newPin);

            // 3. Update local storage passcode
            localStorage.setItem("app-passcode", newPin);

            // 4. Update biometrics credentials if enabled
            if (localStorage.getItem("app-biometrics-enabled") === "true") {
                try {
                    await NativeBiometric.setCredentials({
                        username: "app-pin",
                        password: newPin,
                        server: "open-keep"
                    });
                } catch (e) {
                    console.error("Failed to update biometrics credentials", e);
                }
            }

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
            await clearAllData();
            try {
                await deleteRemoteData();
            } catch (e) {
                console.error("Failed to delete remote data or not authenticated", e);
            }
            localStorage.removeItem("app-passcode");
            localStorage.removeItem("app-lock-enabled");
            localStorage.removeItem("app-biometrics-enabled");
            localStorage.removeItem("custom-tags");

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
                    <Button variant="ghost" size="icon" onClick={onClose} className="shrink-0 mt-0 h-8 w-8">
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
                />
            </DialogContent>
        </Dialog>
    );
};

export default ChangePinDialog;
