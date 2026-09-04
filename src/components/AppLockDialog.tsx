// Copyright (c) 2026. Licensed under AGPLv3.
import React, { useState, useEffect } from "react";
import { getLockRemainingMs, recordFailedAttempt, clearFailedAttempts, formatLockRemaining } from "@/lib/pin-attempts";
import { NativeBiometric } from "@capgo/capacitor-native-biometric";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { showSuccess, showError } from "@/utils/toast";
import { Fingerprint, ShieldCheck, ArrowLeft, Hash } from "lucide-react";
import { Button } from "@/components/ui/button";

interface AppLockDialogProps {
    isOpen: boolean;
    onClose: () => void;
}

const AppLockDialog: React.FC<AppLockDialogProps> = ({ isOpen, onClose }) => {
    const [isBiometricsAvailable, setIsBiometricsAvailable] = useState(false);
    const [isBiometricsEnabled, setIsBiometricsEnabled] = useState(false);
    const [isLaunchLockEnabled, setIsLaunchLockEnabled] = useState(false);

    // States for PIN management when encryption is disabled
    const [isSettingPin, setIsSettingPin] = useState(false);
    const [isChangingPin, setIsChangingPin] = useState(false);
    const [newPin, setNewPin] = useState("");
    const [confirmPin, setConfirmPin] = useState("");
    const [currentPin, setCurrentPin] = useState("");

    useEffect(() => {
        if (isOpen) {
            // Check biometrics availability
            NativeBiometric.isAvailable().then((result) => {
                setIsBiometricsAvailable(result.isAvailable);
            }).catch(() => setIsBiometricsAvailable(false));

            // Load statuses
            setIsBiometricsEnabled(localStorage.getItem("app-biometrics-enabled") === "true");
            setIsLaunchLockEnabled(localStorage.getItem("app-lock-enabled") === "true");

            // Reset sub-states
            setIsSettingPin(false);
            setIsChangingPin(false);
            setNewPin("");
            setConfirmPin("");
            setCurrentPin("");
        }
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen) return;

        window.history.pushState({ dialog: 'app-lock' }, "");

        const handlePopState = (event: PopStateEvent) => {
            if (event.state?.dialog === 'app-lock') return;
            onClose();
        };

        window.addEventListener('popstate', handlePopState);

        return () => {
            window.removeEventListener('popstate', handlePopState);
            if (window.history.state?.dialog === 'app-lock') {
                window.history.back();
            }
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen]);

    const handleSetPin = () => {
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

        localStorage.setItem("app-lock-passcode", newPin);
        localStorage.setItem("app-lock-enabled", "true");
        setIsLaunchLockEnabled(true);
        setIsSettingPin(false);
        setNewPin("");
        setConfirmPin("");
        showSuccess("App Lock PIN set successfully!");
    };

    const handleChangePin = async () => {
        const storedPasscode = localStorage.getItem("app-lock-passcode");
        const lockRemaining = getLockRemainingMs();
        if (lockRemaining > 0) {
            showError(`Too many attempts. Try again in ${formatLockRemaining(lockRemaining)}.`);
            return;
        }

        if (currentPin !== storedPasscode) {
            const state = recordFailedAttempt();
            showError(
                state.locked
                    ? `Too many attempts. Try again in ${formatLockRemaining(state.remainingMs)}.`
                    : "Current PIN is incorrect"
            );
            return;
        }
        clearFailedAttempts();
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

        localStorage.setItem("app-lock-passcode", newPin);

        // Update biometrics credentials if enabled
        if (isBiometricsEnabled && typeof NativeBiometric.setCredentials === 'function') {
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

        setIsChangingPin(false);
        setCurrentPin("");
        setNewPin("");
        setConfirmPin("");
        showSuccess("App Lock PIN changed successfully!");
    };

    const handleToggleBiometrics = async (checked: boolean) => {
        if (checked) {
            const pin = localStorage.getItem("app-passcode") || localStorage.getItem("app-lock-passcode");
            if (!pin) {
                showError("Please set a PIN first");
                setIsSettingPin(true);
                return;
            }

            try {
                await NativeBiometric.verifyIdentity({
                    reason: "Enable biometric authentication",
                    title: "Confirm your identity",
                    subtitle: "",
                    description: "",
                });
                localStorage.setItem("app-biometrics-enabled", "true");

                // Store PIN in secure storage for biometric unlock on native
                if (typeof NativeBiometric.setCredentials === 'function') {
                    await NativeBiometric.setCredentials({
                        username: "app-pin",
                        password: pin,
                        server: "open-keep"
                    });
                }

                setIsBiometricsEnabled(true);
                showSuccess("Biometrics enabled");

                // Also enable launch lock if biometrics is enabled
                if (!isLaunchLockEnabled) {
                    localStorage.setItem("app-lock-enabled", "true");
                    setIsLaunchLockEnabled(true);
                }
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
        if (checked) {
            const hasEncryptionPin = localStorage.getItem("app-passcode");
            const hasAppLockPin = localStorage.getItem("app-lock-passcode");
            
            if (!hasEncryptionPin && !hasAppLockPin) {
                setIsSettingPin(true);
                return;
            }

            localStorage.setItem("app-lock-enabled", "true");
            setIsLaunchLockEnabled(true);
            showSuccess("Launch lock enabled");
        } else {
            localStorage.removeItem("app-lock-enabled");
            showSuccess("Launch lock disabled");

            // Also disable biometrics if launch lock is disabled
            if (isBiometricsEnabled) {
                localStorage.removeItem("app-biometrics-enabled");
                setIsBiometricsEnabled(false);
            }
            setIsLaunchLockEnabled(false);
        }
    };

    const isEncryptionEnabled = localStorage.getItem("app-passcode") !== null;

    const renderContent = () => {
        if (isSettingPin) {
            return (
                <>
                    <DialogHeader className="flex flex-row items-center gap-2 space-y-0 text-left">
                        <Button variant="ghost" size="icon" onClick={() => setIsSettingPin(false)} className="shrink-0 mt-0 h-8 w-8">
                            <ArrowLeft className="h-5 w-5 text-secondary" />
                            <span className="sr-only">Back</span>
                        </Button>
                        <DialogTitle>Set App Lock PIN</DialogTitle>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        <p className="text-sm text-muted-foreground">
                            Choose a 4-6 digit PIN to lock the app on launch.
                        </p>
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
                                    if (e.key === "Enter" && newPin && confirmPin) {
                                        handleSetPin();
                                    }
                                }}
                                placeholder="Retype PIN"
                                maxLength={6}
                            />
                        </div>
                        <Button onClick={handleSetPin} disabled={!newPin || !confirmPin} className="w-full mt-2">
                            Set PIN
                        </Button>
                    </div>
                </>
            );
        }

        if (isChangingPin) {
            return (
                <>
                    <DialogHeader className="flex flex-row items-center gap-2 space-y-0 text-left">
                        <Button variant="ghost" size="icon" onClick={() => setIsChangingPin(false)} className="shrink-0 mt-0 h-8 w-8">
                            <ArrowLeft className="h-5 w-5 text-secondary" />
                            <span className="sr-only">Back</span>
                        </Button>
                        <DialogTitle>Change App Lock PIN</DialogTitle>
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
                                    if (e.key === "Enter" && currentPin && newPin && confirmPin) {
                                        handleChangePin();
                                    }
                                }}
                                placeholder="Retype new PIN"
                                maxLength={6}
                            />
                        </div>
                        <Button onClick={handleChangePin} disabled={!currentPin || !newPin || !confirmPin} className="w-full mt-2">
                            Change PIN
                        </Button>
                    </div>
                </>
            );
        }

        return (
            <>
                <DialogHeader className="flex flex-row items-center gap-2 space-y-0 text-left">
                    <Button variant="ghost" size="icon" onClick={onClose} className="shrink-0 mt-0 h-8 w-8">
                        <ArrowLeft className="h-5 w-5 text-secondary" />
                        <span className="sr-only">Back</span>
                    </Button>
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
                        <div className="flex items-center justify-between border-b pb-4">
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

                    {isLaunchLockEnabled && !isEncryptionEnabled && (
                        <Button
                            variant="outline"
                            onClick={() => setIsChangingPin(true)}
                            className="w-full justify-start mt-2"
                        >
                            <Hash className="h-4 w-4 mr-2" />
                            Change App Lock PIN
                        </Button>
                    )}
                </div>
            </>
        );
    };

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="sm:max-w-[425px] bg-background text-primary-foreground">
                {renderContent()}
            </DialogContent>
        </Dialog>
    );
};

export default AppLockDialog;
