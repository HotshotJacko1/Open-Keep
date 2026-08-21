// Copyright (c) 2026. Licensed under AGPLv3.
import React, { useState, useEffect, useRef } from "react";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Fingerprint, Lock, AlertTriangle } from "lucide-react";
import { NativeBiometric } from "@capgo/capacitor-native-biometric";
import { Keyboard } from "@capacitor/keyboard";
import { showSuccess, showError } from "@/utils/toast";
import { clearAllData } from "@/lib/note-storage";
import { deleteRemoteData } from "@/lib/google-drive";
import ResetDialog from "./ResetDialog";

interface LockScreenProps {
    onUnlock: (pin?: string) => void | Promise<boolean>;
    isNativeEncryption?: boolean;
    onReset?: () => void;
}

const LOCAL_STORAGE_PASSCODE_KEY = "app-passcode";

const LockScreen: React.FC<LockScreenProps> = ({ onUnlock, isNativeEncryption, onReset }) => {
    const [passcode, setPasscode] = useState("");
    const [savedPasscode, setSavedPasscode] = useState<string | null>(null);
    const [isBiometricsAvailable, setIsBiometricsAvailable] = useState(false);
    const [isBiometricsEnabled, setIsBiometricsEnabled] = useState(false);
    const [errorPing, setErrorPing] = useState(false); // To shake/animate error
    const [isLoading, setIsLoading] = useState(false);
    const [isResetDialogOpen, setIsResetDialogOpen] = useState(false);
    const [isResetting, setIsResetting] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        // Load saved passcode (encryption passcode or app lock passcode)
        const stored = localStorage.getItem("app-passcode") || localStorage.getItem("app-lock-passcode");
        setSavedPasscode(stored);

        // Check biometrics
        NativeBiometric.isAvailable()
            .then((result) => setIsBiometricsAvailable(result.isAvailable))
            .catch(() => setIsBiometricsAvailable(false));

        const biometricsEnabled = localStorage.getItem("app-biometrics-enabled") === "true";
        setIsBiometricsEnabled(biometricsEnabled);

        // Auto-trigger biometric if enabled
        if (biometricsEnabled) {
            // Small delay to ensure UI is ready and not conflicting with app resume
            setTimeout(() => {
                handleBiometricUnlock();
            }, 300);
        } else {
            // Use a longer delay to ensure the WebView is fully settled before
            // requesting focus and showing the keyboard. Android's WebView
            // actively hides the IME after launch; Keyboard.show() forces it open.
            setTimeout(() => {
                inputRef.current?.focus();
                Keyboard.show().catch(() => {
                    // Keyboard plugin not available on this platform (web/iOS), ignore
                });
            }, 500);
        }
    }, [isNativeEncryption]);

    const handleBiometricUnlock = async () => {
        try {
            await NativeBiometric.verifyIdentity({
                reason: "Unlock App",
                title: "Unlock App",
                subtitle: "",
                description: "",
            });

            if (!isNativeEncryption) {
                try {
                    const success = await onUnlock();
                    if (success === false) {
                        showError("Biometric unlock failed to initialize database.");
                    }
                } catch (e) {
                    console.error("Unlock failed", e);
                    showError("Biometric unlock failed to initialize database.");
                }
            } else {
                // Try to get credentials if native encryption is on
                try {
                    const credentials = await NativeBiometric.getCredentials({
                        server: "open-keep"
                    });
                    if (credentials && credentials.password) {
                        const success = await onUnlock(credentials.password);
                        if (!success) {
                            showError("Biometric unlock failed: PIN mismatch. Please enter manually.");
                        }
                    } else {
                        showError("Biometrics ready, but PIN not found. Please enter manually.");
                    }
                } catch (e) {
                    console.error("Failed to get credentials", e);
                    showError("Biometric verification succeeded, but failed to retrieve PIN.");
                }
            }
        } catch (error) {
            console.log("Biometric unlock failed or cancelled", error);
        }
    };

    const handleSubmit = async (e?: React.FormEvent) => {
        e?.preventDefault();

        if (passcode.length < 4) {
            setErrorPing(true);
            setTimeout(() => setErrorPing(false), 500);
            return;
        }

        setIsLoading(true);

        try {
            if (isNativeEncryption) {
                const success = await onUnlock(passcode);
                if (!success) {
                    setPasscode("");
                    setErrorPing(true);
                    setTimeout(() => setErrorPing(false), 500);
                    showError("Incorrect PIN");
                }
            } else {
                // Web flow or unencrypted flow check
                if (passcode === savedPasscode) {
                    await onUnlock(passcode);
                } else {
                    setPasscode("");
                    setErrorPing(true);
                    setTimeout(() => setErrorPing(false), 500);
                    showError("Incorrect passcode");
                }
            }
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
            if (isNativeEncryption) {
                // 1. Delete local DB
                await clearAllData();

                // 2. Delete cloud data (attempt)
                try {
                    await deleteRemoteData();
                } catch (e) {
                    console.error("Failed to delete remote data or not authenticated", e);
                }
            }

            // 3. Clear local storage flags
            localStorage.removeItem("app-passcode");
            localStorage.removeItem("app-lock-passcode");
            localStorage.removeItem("app-lock-enabled");
            localStorage.removeItem("app-biometrics-enabled");
            localStorage.removeItem("custom-tags"); // While we're at it
            
            // 4. Clear sync state
            localStorage.removeItem("last-synced-time");
            localStorage.removeItem("google-access-token");
            localStorage.removeItem("google-token-expiry");
            localStorage.removeItem("google-user-email");
            localStorage.removeItem("dropbox-access-token");
            localStorage.removeItem("dropbox-last-synced");
            localStorage.removeItem("onedrive-user-email");
            localStorage.removeItem("onedrive-last-synced");

            if (onReset) onReset();

            showSuccess("App reset successfully");
        } catch (e) {
            console.error(e);
            showError("Failed to reset app");
        } finally {
            setIsResetting(false);
            setIsResetDialogOpen(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[40] bg-background flex flex-col items-center justify-center p-4">
            <div className="flex flex-col items-center gap-6 max-w-sm w-full animate-in fade-in zoom-in duration-300">
                <div className="bg-primary/10 p-4 rounded-full mb-4">
                    <img src="/favicon.svg" alt="App Icon" className="w-12 h-12" />
                </div>

                <div className="text-center space-y-2">
                    <h1 className="text-2xl font-bold tracking-tight text-black dark:text-white">App Locked</h1>
                    <p className="text-muted-foreground">Enter your 4-6 digit PIN to unlock</p>
                </div>

                <form onSubmit={handleSubmit} className={`w-full max-w-[240px] space-y-4 ${errorPing ? "animate-shake" : ""}`}>
                    <div className="flex gap-2 justify-center text-black dark:text-white">
                        <Input
                            ref={inputRef}
                            type="password"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            className="text-center text-lg tracking-widest"
                            value={passcode}
                            onChange={(e) => setPasscode(e.target.value)}
                            placeholder="PIN"
                            maxLength={6}
                        />
                    </div>
                    <Button type="submit" className="w-full" disabled={isLoading || passcode.length < 4}>
                        {isLoading ? "Unlocking..." : "Unlock"}
                    </Button>
                </form>

                {isBiometricsAvailable && isBiometricsEnabled && !isNativeEncryption && (
                    <Button
                        variant="ghost"
                        size="lg"
                        className="mt-4 flex gap-2 items-center text-foreground"
                        onClick={handleBiometricUnlock}
                    >
                        <Fingerprint className="w-6 h-6" />
                        Unlock with biometrics
                    </Button>
                )}

                <Button variant="link" className="mt-2 text-muted-foreground text-sm" onClick={handleForgotPin}>
                    Forgot PIN?
                </Button>
            </div>

            <ResetDialog
                isOpen={isResetDialogOpen}
                onOpenChange={setIsResetDialogOpen}
                onConfirm={confirmReset}
                isResetting={isResetting}
                isNativeEncryption={isNativeEncryption}
            />
        </div>
    );
};
export default LockScreen;
