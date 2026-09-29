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
import { useBackToClose } from "@/hooks/use-back-to-close";
import { Capacitor } from "@capacitor/core";
import { verifyEncryptionPin } from "@/lib/encryption-pin";
import {
    APP_LOCK_ENABLED_KEY,
    BIOMETRICS_ENABLED_KEY,
    getSessionPin,
    hasAppLockPin,
    isAppLockEnabled,
    isEncryptionEnabled as readEncryptionEnabled,
    setAppLockPin,
    setSessionPin,
    validateNewPin,
    verifyAppLockPin,
} from "@/lib/pin";

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
    const [isConfirmingPin, setIsConfirmingPin] = useState(false);

    useEffect(() => {
        if (isOpen) {
            // Check biometrics availability
            NativeBiometric.isAvailable().then((result) => {
                setIsBiometricsAvailable(result.isAvailable);
            }).catch(() => setIsBiometricsAvailable(false));

            // Load statuses
            // eslint-disable-next-line react-hooks/set-state-in-effect -- resets local form state each time the dialog opens (intentional)
            setIsBiometricsEnabled(localStorage.getItem(BIOMETRICS_ENABLED_KEY) === "true");
            setIsLaunchLockEnabled(isAppLockEnabled());

            // Reset sub-states
            setIsSettingPin(false);
            setIsChangingPin(false);
            setIsConfirmingPin(false);
            setNewPin("");
            setConfirmPin("");
            setCurrentPin("");
        }
    }, [isOpen]);

    useBackToClose("app-lock", isOpen, onClose);

    const handleSetPin = async () => {
        const validationError = validateNewPin(newPin, confirmPin);
        if (validationError) {
            showError(validationError);
            return;
        }

        await setAppLockPin(newPin);
        localStorage.setItem(APP_LOCK_ENABLED_KEY, "true");
        setIsLaunchLockEnabled(true);
        setIsSettingPin(false);
        setNewPin("");
        setConfirmPin("");
        showSuccess("App Lock PIN set successfully!");
    };

    const handleChangePin = async () => {
        const lockRemaining = getLockRemainingMs();
        if (lockRemaining > 0) {
            showError(`Too many attempts. Try again in ${formatLockRemaining(lockRemaining)}.`);
            return;
        }

        if (!(await verifyAppLockPin(currentPin))) {
            const state = recordFailedAttempt();
            showError(
                state.locked
                    ? `Too many attempts. Try again in ${formatLockRemaining(state.remainingMs)}.`
                    : "Current PIN is incorrect"
            );
            return;
        }
        clearFailedAttempts();
        const validationError = validateNewPin(newPin, confirmPin, { currentPin, label: "New PIN" });
        if (validationError) {
            showError(validationError);
            return;
        }

        // Biometric unlock without encryption doesn't use a stored PIN, so there
        // are no credentials to update here.
        await setAppLockPin(newPin);

        setIsChangingPin(false);
        setCurrentPin("");
        setNewPin("");
        setConfirmPin("");
        showSuccess("App Lock PIN changed successfully!");
    };

    const handleToggleBiometrics = async (checked: boolean) => {
        if (checked) {
            // With encryption on, biometric unlock hands the encryption PIN to the
            // unlock flow, so it has to be stored in the platform's secure store.
            // It is no longer kept anywhere else, so ask for it if it hasn't been
            // entered this session.
            let pinForCredentials: string | null = null;
            if (isEncryptionEnabled) {
                pinForCredentials = getSessionPin();
                if (!pinForCredentials) {
                    setIsConfirmingPin(true);
                    return;
                }
            } else if (!hasAppLockPin()) {
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
                localStorage.setItem(BIOMETRICS_ENABLED_KEY, "true");

                if (pinForCredentials && typeof NativeBiometric.setCredentials === 'function') {
                    await NativeBiometric.setCredentials({
                        username: "app-pin",
                        password: pinForCredentials,
                        server: "open-keep"
                    });
                }

                setIsBiometricsEnabled(true);
                showSuccess("Biometrics enabled");

                // Also enable launch lock if biometrics is enabled
                if (!isLaunchLockEnabled) {
                    localStorage.setItem(APP_LOCK_ENABLED_KEY, "true");
                    setIsLaunchLockEnabled(true);
                }
            } catch (error) {
                console.error("Biometric verification failed", error);
                showError("Failed to enable biometrics");
                setIsBiometricsEnabled(false);
            }
        } else {
            localStorage.removeItem(BIOMETRICS_ENABLED_KEY);
            setIsBiometricsEnabled(false);
            showSuccess("Biometrics disabled");
        }
    };

    const handleConfirmPin = async () => {
        const lockRemaining = getLockRemainingMs();
        if (lockRemaining > 0) {
            showError(`Too many attempts. Try again in ${formatLockRemaining(lockRemaining)}.`);
            return;
        }
        if (!(await verifyEncryptionPin(currentPin))) {
            const state = recordFailedAttempt();
            showError(
                state.locked
                    ? `Too many attempts. Try again in ${formatLockRemaining(state.remainingMs)}.`
                    : "Incorrect PIN"
            );
            return;
        }
        clearFailedAttempts();
        setSessionPin(currentPin);
        setCurrentPin("");
        setIsConfirmingPin(false);
        await handleToggleBiometrics(true);
    };

    const handleToggleLaunchLock = (checked: boolean) => {
        if (checked) {
            if (!isEncryptionEnabled && !hasAppLockPin()) {
                setIsSettingPin(true);
                return;
            }

            localStorage.setItem(APP_LOCK_ENABLED_KEY, "true");
            setIsLaunchLockEnabled(true);
            showSuccess("Launch lock enabled");
        } else {
            localStorage.removeItem(APP_LOCK_ENABLED_KEY);
            showSuccess("Launch lock disabled");

            // Also disable biometrics if launch lock is disabled
            if (isBiometricsEnabled) {
                localStorage.removeItem(BIOMETRICS_ENABLED_KEY);
                setIsBiometricsEnabled(false);
            }
            setIsLaunchLockEnabled(false);
        }
    };

    const isEncryptionEnabled = readEncryptionEnabled();
    // In the browser there is nowhere safe to keep the key, so an encrypted vault
    // always asks for its PIN at launch; the toggle can't turn that off.
    const isLaunchLockForced = isEncryptionEnabled && !Capacitor.isNativePlatform();

    const renderContent = () => {
        if (isSettingPin) {
            return (
                <>
                    <DialogHeader className="flex flex-row items-center gap-2 space-y-0 text-left">
                        <Button variant="ghost" size="icon" onClick={() => setIsSettingPin(false)} className="touch-target shrink-0 mt-0 h-8 w-8">
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

        if (isConfirmingPin) {
            return (
                <>
                    <DialogHeader className="flex flex-row items-center gap-2 space-y-0 text-left">
                        <Button variant="ghost" size="icon" onClick={() => setIsConfirmingPin(false)} className="touch-target shrink-0 mt-0 h-8 w-8">
                            <ArrowLeft className="h-5 w-5 text-secondary" />
                            <span className="sr-only">Back</span>
                        </Button>
                        <DialogTitle>Confirm Your PIN</DialogTitle>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        <p className="text-sm text-muted-foreground">
                            Enter your encryption PIN to turn on biometric unlock. It is kept in your device's secure storage so biometrics can unlock your notes.
                        </p>
                        <div className="flex flex-col gap-2">
                            <Label htmlFor="confirm-current-pin">Encryption PIN</Label>
                            <Input
                                id="confirm-current-pin"
                                type="password"
                                inputMode="numeric"
                                pattern="[0-9]*"
                                value={currentPin}
                                onChange={(e) => setCurrentPin(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter" && currentPin) {
                                        handleConfirmPin();
                                    }
                                }}
                                placeholder="Enter PIN"
                                maxLength={6}
                            />
                        </div>
                        <Button onClick={handleConfirmPin} disabled={!currentPin} className="w-full mt-2">
                            Continue
                        </Button>
                    </div>
                </>
            );
        }

        if (isChangingPin) {
            return (
                <>
                    <DialogHeader className="flex flex-row items-center gap-2 space-y-0 text-left">
                        <Button variant="ghost" size="icon" onClick={() => setIsChangingPin(false)} className="touch-target shrink-0 mt-0 h-8 w-8">
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
                    <Button variant="ghost" size="icon" onClick={onClose} className="touch-target shrink-0 mt-0 h-8 w-8">
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
                                {isLaunchLockForced
                                    ? "Always on in the browser while encryption is enabled"
                                    : "Lock the app every time it is opened"}
                            </p>
                        </div>
                        <Switch
                            id="launch-lock"
                            checked={isLaunchLockEnabled || isLaunchLockForced}
                            disabled={isLaunchLockForced}
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
