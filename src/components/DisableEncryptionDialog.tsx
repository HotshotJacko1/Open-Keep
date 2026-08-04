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
import { changeEncryptionKey } from "@/lib/note-storage";
import { NativeBiometric } from "@capgo/capacitor-native-biometric";

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
            setCurrentPin("");
            setIsLoading(false);
        }
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen) return;

        window.history.pushState({ dialog: 'disable-encryption' }, "");

        const handlePopState = (event: PopStateEvent) => {
            if (event.state?.dialog === 'disable-encryption') return;
            onClose();
        };

        window.addEventListener('popstate', handlePopState);

        return () => {
            window.removeEventListener('popstate', handlePopState);
            if (window.history.state?.dialog === 'disable-encryption') {
                window.history.back();
            }
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen]);

    const handleDisable = async () => {
        if (!currentPin) {
            showError("Please enter your current PIN");
            return;
        }

        const storedPasscode = localStorage.getItem("app-passcode");
        if (currentPin !== storedPasscode) {
            showError("Current PIN is incorrect");
            return;
        }

        setIsLoading(true);
        try {
            // Re-key to the transparent empty PIN
            await changeEncryptionKey(currentPin, "");

            // Update local storage passcode
            localStorage.removeItem("app-passcode");
            
            // Disable App Lock / Biometrics as they require encryption
            localStorage.removeItem("app-lock-enabled");
            localStorage.removeItem("app-biometrics-enabled");
            
            try {
                await NativeBiometric.deleteCredentials({ server: "open-keep" });
            } catch (e) {
                // Ignore if no credentials found
            }
            
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
                    <Button variant="ghost" size="icon" onClick={onClose} className="shrink-0 mt-0 h-8 w-8">
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
                            Disabling encryption will make your local database and cloud sync payloads readable in plaintext.
                            <br />
                            <br />
                            This will also disable App Lock and Biometrics.
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
