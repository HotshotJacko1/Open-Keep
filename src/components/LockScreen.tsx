import React, { useState, useEffect } from "react";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Fingerprint, Lock, ShieldCheck } from "lucide-react";
import { NativeBiometric } from "@capgo/capacitor-native-biometric";
import { showSuccess, showError } from "@/utils/toast";

interface LockScreenProps {
    onUnlock: (pin?: string) => void | Promise<boolean>;
    isNativeEncryption?: boolean;
}

const LOCAL_STORAGE_PASSCODE_KEY = "app-passcode";

const LockScreen: React.FC<LockScreenProps> = ({ onUnlock, isNativeEncryption }) => {
    const [passcode, setPasscode] = useState("");
    const [savedPasscode, setSavedPasscode] = useState<string | null>(null);
    const [isBiometricsAvailable, setIsBiometricsAvailable] = useState(false);
    const [isBiometricsEnabled, setIsBiometricsEnabled] = useState(false);
    const [errorPing, setErrorPing] = useState(false); // To shake/animate error
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        // Load saved passcode
        const stored = localStorage.getItem(LOCAL_STORAGE_PASSCODE_KEY);
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
        }
    }, []);

    const handleBiometricUnlock = async () => {
        try {
            await NativeBiometric.verifyIdentity({
                reason: "Unlock App",
                title: "Unlock App",
                subtitle: "",
                description: "",
            });

            // If native encryption, we might need the PIN to unlock the DB.
            // Biometrics can't retrieve the PIN unless we stored it in Keystore wrapped with biometric auth.
            // For now, if Native Encryption is ON, Biometrics might not be enough to unlock the DB 
            // UNLESS we implement the Keystore retrieval. 
            // The current plan didn't explicitly cover "Biometric + SQLCipher".
            // So if isNativeEncryption, we might have to disable Biometrics OR simply skip it for now.
            // Let's assume for this iteration: Biometrics is for the legacy "Lock Screen" only.
            // If isNativeEncryption, we mandate PIN.
            if (!isNativeEncryption) {
                onUnlock();
            } else {
                showError("Biometric unlock not supported with Encryption yet. Please enter PIN.");
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

        if (isNativeEncryption) {
            const success = await onUnlock(passcode);
            if (!success) {
                setPasscode("");
                setErrorPing(true);
                setTimeout(() => setErrorPing(false), 500);
                showError("Incorrect PIN");
            }
        } else {
            // Legacy local storage check
            if (passcode === savedPasscode) {
                onUnlock();
            } else {
                setPasscode("");
                setErrorPing(true);
                setTimeout(() => setErrorPing(false), 500);
                showError("Incorrect passcode");
            }
        }
        setIsLoading(false);
    };

    return (
        <div className="fixed inset-0 z-[100] bg-background flex flex-col items-center justify-center p-4">
            <div className="flex flex-col items-center gap-6 max-w-sm w-full animate-in fade-in zoom-in duration-300">
                <div className="bg-primary/10 p-4 rounded-full mb-4">
                    <ShieldCheck className="w-12 h-12 text-primary" />
                </div>

                <div className="text-center space-y-2">
                    <h1 className="text-2xl font-bold tracking-tight text-foreground">App Locked</h1>
                    <p className="text-muted-foreground">Enter your 4-6 digit PIN to unlock</p>
                </div>

                <form onSubmit={handleSubmit} className={`w-full max-w-[240px] space-y-4 ${errorPing ? "animate-shake" : ""}`}>
                    <div className="flex gap-2 justify-center">
                        <Input
                            type="password"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            className="text-center text-lg tracking-widest"
                            value={passcode}
                            onChange={(e) => setPasscode(e.target.value)}
                            placeholder="PIN"
                            maxLength={6}
                            autoFocus
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
            </div>
        </div>
    );
};

export default LockScreen;
