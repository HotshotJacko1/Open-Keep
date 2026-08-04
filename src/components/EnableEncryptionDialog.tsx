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
import { ArrowLeft, Lock } from "lucide-react";
import { changeEncryptionKey } from "@/lib/note-storage";

interface EnableEncryptionDialogProps {
    isOpen: boolean;
    onClose: () => void;
}

const EnableEncryptionDialog: React.FC<EnableEncryptionDialogProps> = ({ isOpen, onClose }) => {
    const [newPin, setNewPin] = useState("");
    const [confirmPin, setConfirmPin] = useState("");
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        if (isOpen) {
            setNewPin("");
            setConfirmPin("");
            setIsLoading(false);
        }
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen) return;

        window.history.pushState({ dialog: 'enable-encryption' }, "");

        const handlePopState = (event: PopStateEvent) => {
            if (event.state?.dialog === 'enable-encryption') return;
            onClose();
        };

        window.addEventListener('popstate', handlePopState);

        return () => {
            window.removeEventListener('popstate', handlePopState);
            if (window.history.state?.dialog === 'enable-encryption') {
                window.history.back();
            }
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen]);

    const handleEnable = async () => {
        if (newPin.length < 4 || newPin.length > 6) {
            showError("PIN must be 4-6 digits long");
            return;
        }
        if (!/^\d+$/.test(newPin)) {
            showError("PIN must contain only numbers");
            return;
        }
        if (newPin !== confirmPin) {
            showError("PINs do not match");
            return;
        }

        setIsLoading(true);
        try {
            // Re-key from the transparent empty PIN to the new PIN
            await changeEncryptionKey("", newPin);

            // Update local storage passcode
            localStorage.setItem("app-passcode", newPin);
            localStorage.removeItem("app-lock-passcode");

            // Update biometrics credentials if enabled
            if (localStorage.getItem("app-biometrics-enabled") === "true") {
                try {
                    const { NativeBiometric } = await import("@capgo/capacitor-native-biometric");
                    if (typeof NativeBiometric.setCredentials === 'function') {
                        await NativeBiometric.setCredentials({
                            username: "app-pin",
                            password: newPin,
                            server: "open-keep"
                        });
                    }
                } catch (e) {
                    console.error("Failed to update biometrics credentials on encryption enable", e);
                }
            }
            
            showSuccess("Encryption enabled successfully");
            onClose();
        } catch (error) {
            console.error(error);
            showError("Failed to enable encryption. Please try again.");
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
                    <Button variant="ghost" size="icon" onClick={onClose} className="shrink-0 mt-0 h-8 w-8">
                        <ArrowLeft className="h-5 w-5 text-secondary" />
                        <span className="sr-only">Back</span>
                    </Button>
                    <DialogTitle>Enable Encryption</DialogTitle>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="flex flex-col items-center justify-center text-center space-y-2 mb-2">
                        <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mb-2">
                            <Lock className="w-6 h-6 text-primary" />
                        </div>
                        <DialogDescription className="text-sm">
                            Choose a 4-6 digit PIN to encrypt your database.
                            <br />
                            <span className="text-destructive font-medium">Warning: If you lose this PIN, your cloud notes cannot be recovered.</span>
                        </DialogDescription>
                    </div>

                    <div className="flex flex-col gap-2">
                        <Label htmlFor="new-pin">Enter PIN</Label>
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
                        <Label htmlFor="confirm-pin">Confirm PIN</Label>
                        <Input
                            id="confirm-pin"
                            type="password"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            value={confirmPin}
                            onChange={(e) => setConfirmPin(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter" && !isLoading && newPin && confirmPin) {
                                    handleEnable();
                                }
                            }}
                            placeholder="Retype PIN"
                            disabled={isLoading}
                            maxLength={6}
                        />
                    </div>
                </div>
                <div className="flex flex-col items-center mt-2">
                    <Button onClick={handleEnable} disabled={isLoading || !newPin || !confirmPin} className="w-full">
                        {isLoading ? "Enabling..." : "Enable Encryption"}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
};

export default EnableEncryptionDialog;
