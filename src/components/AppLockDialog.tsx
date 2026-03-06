import React, { useState, useEffect } from "react";
import { App } from "@capacitor/app";
import { NativeBiometric } from "@capgo/capacitor-native-biometric";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { showSuccess, showError } from "@/utils/toast";
import { Fingerprint, ShieldCheck } from "lucide-react";

interface AppLockDialogProps {
    isOpen: boolean;
    onClose: () => void;
}

const AppLockDialog: React.FC<AppLockDialogProps> = ({ isOpen, onClose }) => {
    const [isBiometricsAvailable, setIsBiometricsAvailable] = useState(false);
    const [isBiometricsEnabled, setIsBiometricsEnabled] = useState(false);
    const [isLaunchLockEnabled, setIsLaunchLockEnabled] = useState(false);

    useEffect(() => {
        if (isOpen) {
            // Check biometrics availability
            NativeBiometric.isAvailable().then((result) => {
                setIsBiometricsAvailable(result.isAvailable);
            }).catch(() => setIsBiometricsAvailable(false));

            // Load statuses
            setIsBiometricsEnabled(localStorage.getItem("app-biometrics-enabled") === "true");
            setIsLaunchLockEnabled(localStorage.getItem("app-lock-enabled") === "true");
        }
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen) return;

        const backButtonListener = App.addListener('backButton', () => {
            onClose();
        });

        return () => {
            backButtonListener.then(listener => listener.remove());
        };
    }, [isOpen, onClose]);

    const handleToggleBiometrics = async (checked: boolean) => {
        if (checked) {
            try {
                await NativeBiometric.verifyIdentity({
                    reason: "Enable biometric authentication",
                    title: "Confirm your identity",
                    subtitle: "",
                    description: "",
                });
                localStorage.setItem("app-biometrics-enabled", "true");

                // Store PIN in secure storage for biometric unlock on native
                const pin = localStorage.getItem("app-passcode");
                if (pin && typeof NativeBiometric.setCredentials === 'function') {
                    await NativeBiometric.setCredentials({
                        username: "app-pin",
                        password: pin,
                        server: "open-keep"
                    });
                }

                setIsBiometricsEnabled(true);
                showSuccess("Biometrics enabled");
            } catch (error) {
                console.error("Biometric verification failed", error);
                showError("Failed to enable biometrics");
                setIsBiometricsEnabled(false);
            }
        } else {
            localStorage.removeItem("app-biometrics-enabled");
            setIsBiometricsEnabled(false);
            showSuccess("Biometrics disabled");
        }
    };

    const handleToggleLaunchLock = (checked: boolean) => {
        // Check if encryption PIN is set
        const pin = localStorage.getItem("app-passcode");
        if (checked && !pin) {
            showError("Please set an Encryption PIN first");
            return;
        }

        if (checked) {
            localStorage.setItem("app-lock-enabled", "true");
            showSuccess("Launch lock enabled");
        } else {
            localStorage.removeItem("app-lock-enabled");
            showSuccess("Launch lock disabled");
        }
        setIsLaunchLockEnabled(checked);
    };

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="sm:max-w-[425px] bg-background text-primary-foreground">
                <DialogHeader>
                    <DialogTitle>App Lock & Biometrics</DialogTitle>
                </DialogHeader>
                <div className="flex flex-col gap-6 py-4">
                    <div className="flex items-center justify-between border-b pb-4">
                        <div className="space-y-0.5">
                            <div className="flex items-center gap-2">
                                <ShieldCheck className="w-4 h-4 text-primary" />
                                <Label htmlFor="launch-lock">Require PIN on Launch</Label>
                            </div>
                            <p className="text-xs text-muted-foreground">
                                Lock the app every time it is opened
                            </p>
                        </div>
                        <Switch
                            id="launch-lock"
                            checked={isLaunchLockEnabled}
                            onCheckedChange={handleToggleLaunchLock}
                        />
                    </div>

                    {isBiometricsAvailable && (
                        <div className="flex items-center justify-between">
                            <div className="space-y-0.5">
                                <div className="flex items-center gap-2">
                                    <Fingerprint className="w-4 h-4 text-primary" />
                                    <Label htmlFor="biometrics">Biometric Unlock</Label>
                                </div>
                                <p className="text-xs text-muted-foreground">
                                    Use FaceID or TouchID to unlock
                                </p>
                            </div>
                            <Switch
                                id="biometrics"
                                checked={isBiometricsEnabled}
                                onCheckedChange={handleToggleBiometrics}
                            />
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
};

export default AppLockDialog;
