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
    isNativeEncryption?: boolean;
}

const ResetDialog: React.FC<ResetDialogProps> = ({ isOpen, onOpenChange, onConfirm, isResetting, isNativeEncryption }) => {
    const [confirmText, setConfirmText] = useState("");

    useEffect(() => {
        if (!isOpen) {
            setConfirmText("");
        }
    }, [isOpen]);

    const isDestructive = isNativeEncryption;
    const canConfirm = isDestructive ? confirmText === "DELETE" : true;

    return (
        <AlertDialog open={isOpen} onOpenChange={onOpenChange}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle className="text-black dark:text-white">
                        {isDestructive ? "Reset App & Delete All Data?" : "Reset App Lock?"}
                    </AlertDialogTitle>
                    <AlertDialogDescription className={isDestructive ? "text-destructive" : ""}>
                        {isDestructive 
                            ? "Your encryption PIN cannot be recovered. If you reset it, all encrypted notes will be permanently deleted from this device (and supported cloud providers)."
                            : "This will remove your App Lock PIN and clear your cloud sync sessions. Your notes will not be deleted."
                        }
                    </AlertDialogDescription>
                </AlertDialogHeader>
                {isDestructive && (
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
                )}
                <AlertDialogFooter>
                    <AlertDialogCancel disabled={isResetting} className="text-black dark:text-white">Cancel</AlertDialogCancel>
                    <AlertDialogAction
                        className={isDestructive ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : ""}
                        onClick={(e) => {
                            e.preventDefault();
                            if (canConfirm) {
                                onConfirm();
                            }
                        }}
                        disabled={isResetting || !canConfirm}
                    >
                        {isResetting ? "Resetting..." : isDestructive ? "Reset & Delete All" : "Reset App Lock"}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
};

export default ResetDialog;
