import React, { useState, useEffect } from "react";
import { NativeBiometric } from "@capgo/capacitor-native-biometric";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { showSuccess, showError } from "@/utils/toast";
import PasscodeDialog from "./PasscodeDialog";
import { Fingerprint, KeyRound } from "lucide-react";

interface AppLockDialogProps {
    isOpen: boolean;
    onClose: () => void;
}

const AppLockDialog: React.FC<AppLockDialogProps> = ({ isOpen, onClose }) => {
    const [showPasscode, setShowPasscode] = useState(false);
    const [isBiometricsAvailable, setIsBiometricsAvailable] = useState(false);

    useEffect(() => {
        if (isOpen) {
            // Check biometrics availability
            NativeBiometric.isAvailable().then((result) => {
                setIsBiometricsAvailable(result.isAvailable);
            }).catch(() => setIsBiometricsAvailable(false));
        }
    }, [isOpen]);

    const handleBiometricsClick = async () => {
        try {
            await NativeBiometric.verifyIdentity({
                reason: "Enable biometric authentication",
                title: "Confirm your identity",
                subtitle: "",
                description: "",
            });
            localStorage.setItem("app-biometrics-enabled", "true");
            showSuccess("Biometrics enabled");
            onClose();
        } catch (error) {
            console.error("Biometric verification failed", error);
            showError("Failed to verify identity");
        }
    };

    const handlePasscodeClick = () => {
        setShowPasscode(true);
    };

    const handlePasscodeClose = () => {
        setShowPasscode(false);
        onClose();
    };

    return (
        <>
            <Dialog open={isOpen} onOpenChange={onClose}>
                <DialogContent className="sm:max-w-[425px] bg-background text-primary-foreground">
                    <DialogHeader>
                        <DialogTitle>App Lock</DialogTitle>
                    </DialogHeader>
                    <div className="flex flex-col gap-4 py-4">
                        <Button
                            className="h-20 text-lg flex flex-col items-center justify-center gap-2"
                            variant="outline"
                            onClick={handleBiometricsClick}
                            disabled={!isBiometricsAvailable}
                        >
                            <Fingerprint className="w-6 h-6" />
                            Biometrics
                        </Button>
                        <Button
                            className="h-20 text-lg flex flex-col items-center justify-center gap-2"
                            variant="outline"
                            onClick={handlePasscodeClick}
                        >
                            <KeyRound className="w-6 h-6" />
                            Passcode
                        </Button>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={onClose}>
                            Close
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <PasscodeDialog
                isOpen={showPasscode}
                onClose={() => setShowPasscode(false)}
            />
        </>
    );
};

export default AppLockDialog;
