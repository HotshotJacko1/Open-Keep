import React, { useState, useEffect } from "react";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Button } from "@/components/ui/button";
import { Fingerprint, Lock, ShieldCheck } from "lucide-react";
import { NativeBiometric } from "capacitor-native-biometric";
import { showSuccess, showError } from "@/utils/toast";

interface LockScreenProps {
    onUnlock: () => void;
}

const LOCAL_STORAGE_PASSCODE_KEY = "app-passcode";

const LockScreen: React.FC<LockScreenProps> = ({ onUnlock }) => {
    const [passcode, setPasscode] = useState("");
    const [savedPasscode, setSavedPasscode] = useState<string | null>(null);
    const [isBiometricsAvailable, setIsBiometricsAvailable] = useState(false);
    const [isBiometricsEnabled, setIsBiometricsEnabled] = useState(false);
    const [errorPing, setErrorPing] = useState(false); // To shake/animate error

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
            // Success
            onUnlock();
        } catch (error) {
            console.log("Biometric unlock failed or cancelled", error);
            // Ensure we don't block passcode entry
        }
    };

    const handlePasscodeChange = (value: string) => {
        setPasscode(value);
        if (value.length === 4) {
            if (value === savedPasscode) {
                onUnlock();
            } else {
                // Wrong passcode
                setPasscode("");
                setErrorPing(true);
                setTimeout(() => setErrorPing(false), 500);
                showError("Incorrect passcode");
            }
        }
    };

    return (
        <div className="fixed inset-0 z-[100] bg-background flex flex-col items-center justify-center p-4">
            <div className="flex flex-col items-center gap-6 max-w-sm w-full animate-in fade-in zoom-in duration-300">
                <div className="bg-primary/10 p-4 rounded-full mb-4">
                    <ShieldCheck className="w-12 h-12 text-primary" />
                </div>

                <div className="text-center space-y-2">
                    <h1 className="text-2xl font-bold tracking-tight text-black dark:text-white">App Locked</h1>
                    <p className="text-black dark:text-white">Enter your 4-digit passcode to unlock</p>
                </div>

                <div className={errorPing ? "animate-shake" : ""}>
                    <InputOTP
                        autoFocus
                        maxLength={4}
                        value={passcode}
                        onChange={handlePasscodeChange}
                    >
                        <InputOTPGroup>
                            <InputOTPSlot index={0} className="w-14 h-14 text-2xl text-black dark:text-white" />
                            <InputOTPSlot index={1} className="w-14 h-14 text-2xl text-black dark:text-white" />
                            <InputOTPSlot index={2} className="w-14 h-14 text-2xl text-black dark:text-white" />
                            <InputOTPSlot index={3} className="w-14 h-14 text-2xl text-black dark:text-white" />
                        </InputOTPGroup>
                    </InputOTP>
                </div>

                {isBiometricsAvailable && isBiometricsEnabled && (
                    <Button
                        variant="ghost"
                        size="lg"
                        className="mt-8 flex gap-2 items-center text-black dark:text-white"
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
