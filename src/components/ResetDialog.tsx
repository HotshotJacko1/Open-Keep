// Copyright (c) 2026. Licensed under AGPLv3.
import React, { useState, useEffect } from "react";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";

interface ResetDialogProps {
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    onConfirm: () => void;
    isResetting: boolean;
    isEncryptionEnabled?: boolean;
}

const ResetDialog: React.FC<ResetDialogProps> = ({ isOpen, onOpenChange, onConfirm, isResetting, isEncryptionEnabled }) => {
    const [confirmText, setConfirmText] = useState("");

    useEffect(() => {
        if (!isOpen) {
            // eslint-disable-next-line react-hooks/set-state-in-effect -- clears the confirmation text when the dialog closes (intentional)
            setConfirmText("");
        }
    }, [isOpen]);

    // Both resets delete this device's notes (C2-32): without encryption,
    // a reset that kept them let anyone holding the device remove App Lock.
    const canConfirm = confirmText === "DELETE";

    return (
        <AlertDialog open={isOpen} onOpenChange={onOpenChange}>
            <AlertDialogContent className="w-[calc(100%-2rem)] rounded-dialog">
                <AlertDialogHeader>
                    <AlertDialogTitle className="text-foreground">
                        {isEncryptionEnabled ? "Reset App & Delete All Data?" : "Reset App Lock & Delete Notes?"}
                    </AlertDialogTitle>
                    <AlertDialogDescription className="text-destructive">
                        {isEncryptionEnabled
                            ? "Your encryption PIN cannot be recovered. If you reset it, all encrypted notes will be permanently deleted from this device (and supported cloud providers)."
                            : "Your App Lock PIN cannot be recovered. Resetting it permanently deletes the notes on this device and signs you out of cloud sync. Notes already in the cloud are kept: sign in again to get them back."
                        }
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <div className="py-4">
                    <p className="text-sm text-muted-foreground mb-2">
                        Please type <strong>DELETE</strong> to confirm this action.
                    </p>
                    <Input
                        value={confirmText}
                        onChange={(e) => setConfirmText(e.target.value)}
                        placeholder="DELETE"
                        disabled={isResetting}
                    />
                </div>
                <AlertDialogFooter>
                    <AlertDialogCancel disabled={isResetting}>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                        onClick={(e) => {
                            e.preventDefault();
                            if (canConfirm) {
                                onConfirm();
                            }
                        }}
                        disabled={isResetting || !canConfirm}
                    >
                        {isResetting ? "Resetting..." : isEncryptionEnabled ? "Reset & Delete All" : "Reset & Delete Notes"}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
};

export default ResetDialog;
