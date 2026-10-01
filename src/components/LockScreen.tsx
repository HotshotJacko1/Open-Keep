// Copyright (c) 2026. Licensed under AGPLv3.
import React, { useState, useEffect, useRef } from "react";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Fingerprint, Lock, AlertTriangle } from "lucide-react";
import { NativeBiometric } from "@capgo/capacitor-native-biometric";
import { Keyboard } from "@capacitor/keyboard";
import { showSuccess, showError } from "@/utils/toast";
import {
    getLockRemainingMs,
    recordFailedAttempt,
    clearFailedAttempts,
    formatLockRemaining,
} from "@/lib/pin-attempts";
import { clearAllData } from "@/lib/note-storage";
import { clearAllPinState, verifyAppLockPin, BIOMETRICS_ENABLED_KEY } from "@/lib/pin";
import { deleteAllRemoteData } from "@/lib/cloud-reset";
import { clearTagChanges } from "@/lib/tombstones";
import ResetDialog from "./ResetDialog";

interface LockScreenProps {
    onUnlock: (pin?: string) => void | Promise<boolean>;
    /** The PIN unwraps the encryption key (checked by decryption). Otherwise it's an App Lock PIN. */
    isEncryptionEnabled?: boolean;
    onReset?: () => void;
}

const LockScreen: React.FC<LockScreenProps> = ({ onUnlock, isEncryptionEnabled, onReset }) => {
    const [passcode, setPasscode] = useState("");
    const [isBiometricsAvailable, setIsBiometricsAvailable] = useState(false);
    const [isBiometricsEnabled, setIsBiometricsEnabled] = useState(false);
    const [errorPing, setErrorPing] = useState(false); // To shake/animate error
    const [isLoading, setIsLoading] = useState(false);
    const [isResetDialogOpen, setIsResetDialogOpen] = useState(false);
    const [isResetting, setIsResetting] = useState(false);
    const [lockRemainingMs, setLockRemainingMs] = useState(() => getLockRemainingMs());
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        // Check biometrics
        NativeBiometric.isAvailable()
            .then((result) => setIsBiometricsAvailable(result.isAvailable))
            .catch(() => setIsBiometricsAvailable(false));

        const biometricsEnabled = localStorage.getItem(BIOMETRICS_ENABLED_KEY) === "true";
        // eslint-disable-next-line react-hooks/set-state-in-effect -- reads the persisted setting from localStorage after mount
        setIsBiometricsEnabled(biometricsEnabled);

        // Auto-trigger biometric if enabled. Only one of these branches ever
        // runs, so a single handle is enough — but it must be cleared on
        // unmount, or a fast lock/unlock fires the prompt against a dead
        // component.
        let startupTimer: ReturnType<typeof setTimeout>;

        if (biometricsEnabled) {
            // Small delay to ensure UI is ready and not conflicting with app resume
            startupTimer = setTimeout(() => {
                // eslint-disable-next-line react-hooks/immutability -- only called from a timer after mount, when the handler is declared; reordering would change effect order
                handleBiometricUnlock();
            }, 300);
        } else {
            // Use a longer delay to ensure the WebView is fully settled before
            // requesting focus and showing the keyboard. Android's WebView
            // actively hides the IME after launch; Keyboard.show() forces it open.
            startupTimer = setTimeout(() => {
                inputRef.current?.focus();
                Keyboard.show().catch(() => {
                    // Keyboard plugin not available on this platform (web/iOS), ignore
                });
            }, 500);
        }

        return () => clearTimeout(startupTimer);
    }, [isEncryptionEnabled]);

    // Tick the lockout countdown so the UI re-enables itself without a reload.
    useEffect(() => {
        if (lockRemainingMs <= 0) return;
        const id = setInterval(() => setLockRemainingMs(getLockRemainingMs()), 1000);
        return () => clearInterval(id);
    }, [lockRemainingMs]);

    const handleBiometricUnlock = async () => {
        try {
            await NativeBiometric.verifyIdentity({
                reason: "Unlock App",
                title: "Unlock App",
                subtitle: "",
                description: "",
            });

            if (!isEncryptionEnabled) {
                try {
                    const success = await onUnlock();
                    if (success === false) {
                        showError("Biometric unlock failed to initialize database.");
                    } else {
                        clearFailedAttempts();
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
                        if (success) {
                            clearFailedAttempts();
                        } else {
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

        const remaining = getLockRemainingMs();
        if (remaining > 0) {
            setLockRemainingMs(remaining);
            setErrorPing(true);
            setTimeout(() => setErrorPing(false), 500);
            showError(`Too many attempts. Try again in ${formatLockRemaining(remaining)}.`);
            return;
        }

        if (passcode.length < 4) {
            setErrorPing(true);
            setTimeout(() => setErrorPing(false), 500);
            return;
        }

        setIsLoading(true);

        const onWrongPin = (message: string) => {
            setPasscode("");
            setErrorPing(true);
            setTimeout(() => setErrorPing(false), 500);
            const state = recordFailedAttempt();
            if (state.locked) {
                setLockRemainingMs(state.remainingMs);
                showError(`Too many attempts. Try again in ${formatLockRemaining(state.remainingMs)}.`);
            } else if (state.attemptsRemaining <= 2) {
                showError(`${message} — ${state.attemptsRemaining} attempt${state.attemptsRemaining === 1 ? "" : "s"} left.`);
            } else {
                showError(message);
            }
        };

        try {
            if (isEncryptionEnabled) {
                const success = await onUnlock(passcode);
                if (success) {
                    clearFailedAttempts();
                } else {
                    onWrongPin("Incorrect PIN");
                }
            } else {
                // App Lock only: the notes aren't encrypted, the PIN just gates the UI.
                if (await verifyAppLockPin(passcode)) {
                    clearFailedAttempts();
                    await onUnlock(passcode);
                } else {
                    onWrongPin("Incorrect passcode");
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
            // With encryption on, a forgotten PIN means the notes can't be opened
            // again on any platform, so the reset has to delete them.
            if (isEncryptionEnabled) {
                // 1. Delete local DB
                await clearAllData();

                // 2. Delete cloud data (attempt)
                await deleteAllRemoteData();
            }

            // 3. Clear local storage flags
            clearAllPinState();
            localStorage.removeItem("custom-tags"); // While we're at it
            // The label list's change records go with it. Note tombstones stay: with
            // encryption off the notes are kept, and so are the deletes that shaped them.
            clearTagChanges();

            // 4. Clear sync state
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
            <div className="flex flex-col items-center gap-6 max-w-sm w-full animate-in fade-in zoom-in duration-md3-medium2 ease-md3-decelerate">
                <div className="bg-primary/10 p-4 rounded-full mb-4">
                    <img src="/favicon.svg" alt="App Icon" className="w-12 h-12" />
                </div>

                <div className="text-center space-y-2">
                    <h1 className="text-2xl font-bold tracking-tight text-foreground">App Locked</h1>
                    <p className="text-muted-foreground">
                        {lockRemainingMs > 0
                            ? `Too many attempts. Try again in ${formatLockRemaining(lockRemainingMs)}.`
                            : "Enter your 4-6 digit PIN to unlock"}
                    </p>
                </div>

                <form onSubmit={handleSubmit} className={`w-full max-w-[240px] space-y-4 ${errorPing ? "animate-shake" : ""}`}>
                    <div className="flex gap-2 justify-center text-foreground">
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
                            disabled={lockRemainingMs > 0}
                        />
                    </div>
                    <Button
                        type="submit"
                        className="w-full"
                        disabled={isLoading || passcode.length < 4 || lockRemainingMs > 0}
                    >
                        {isLoading
                            ? "Unlocking..."
                            : lockRemainingMs > 0
                                ? `Locked — ${formatLockRemaining(lockRemainingMs)}`
                                : "Unlock"}
                    </Button>
                </form>

                {isBiometricsAvailable && isBiometricsEnabled && !isEncryptionEnabled && (
                    <Button
                        variant="ghost"
                        size="lg"
                        className="mt-4 flex gap-2 items-center text-text-primary dark:text-text-primary"
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
                isEncryptionEnabled={isEncryptionEnabled}
            />
        </div>
    );
};
export default LockScreen;
