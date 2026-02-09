import React, { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { initializeDatabase } from "@/lib/note-storage";
import { showError, showSuccess } from "@/utils/toast";
import { Lock } from "lucide-react";

interface EncryptionSetupScreenProps {
    onSetupComplete: () => void;
}

const EncryptionSetupScreen: React.FC<EncryptionSetupScreenProps> = ({ onSetupComplete }) => {
    const [pin, setPin] = useState("");
    const [confirmPin, setConfirmPin] = useState("");
    const [isLoading, setIsLoading] = useState(false);

    const handleSetup = async () => {
        if (pin.length < 4 || pin.length > 6) {
            showError("PIN must be 4-6 digits long");
            return;
        }
        if (!/^\d+$/.test(pin)) {
            showError("PIN must contain only numbers");
            return;
        }
        if (pin !== confirmPin) {
            showError("PINs do not match");
            return;
        }

        setIsLoading(true);
        try {
            await initializeDatabase(pin);

            // Also save this PIN to legacy storage for now so the LockScreen knows we have a "passcode"
            // In the future we should unify these.
            localStorage.setItem("app-passcode", pin);

            showSuccess("Encryption set up successfully!");
            onSetupComplete();
        } catch (error) {
            console.error(error);
            showError("Failed to set up encryption");
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center p-4 bg-background">
            <Card className="w-full max-w-md border-border/50 shadow-xl">
                <CardHeader className="text-center space-y-2">
                    <div className="mx-auto w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mb-2">
                        <Lock className="w-6 h-6 text-primary" />
                    </div>
                    <CardTitle className="text-2xl font-bold">Secure Your Notes</CardTitle>
                    <CardDescription>
                        Choose a 4-6 digit PIN to encrypt your database.
                        <br />
                        <span className="text-destructive font-medium">Warning: If you lose this PIN, your notes cannot be recovered.</span>
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="pin">Enter PIN</Label>
                        <Input
                            id="pin"
                            type="password"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            value={pin}
                            onChange={(e) => setPin(e.target.value)}
                            placeholder="4-6 digits"
                            disabled={isLoading}
                            maxLength={6}
                        />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="confirmPin">Confirm PIN</Label>
                        <Input
                            id="confirmPin"
                            type="password"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            value={confirmPin}
                            onChange={(e) => setConfirmPin(e.target.value)}
                            placeholder="Retype PIN"
                            disabled={isLoading}
                            maxLength={6}
                        />
                    </div>
                </CardContent>
                <CardFooter>
                    <Button
                        className="w-full"
                        onClick={handleSetup}
                        disabled={isLoading || !pin || !confirmPin}
                    >
                        {isLoading ? "Encrypting..." : "Enable Encryption"}
                    </Button>
                </CardFooter>
            </Card>
        </div>
    );
};

export default EncryptionSetupScreen;
