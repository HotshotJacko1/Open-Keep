// Copyright (c) 2026. Licensed under AGPLv3.
import React from "react";
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

interface ResetDialogProps {
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    onConfirm: () => void;
    isResetting: boolean;
}

const ResetDialog: React.FC<ResetDialogProps> = ({ isOpen, onOpenChange, onConfirm, isResetting }) => {
    return (
        <AlertDialog open={isOpen} onOpenChange={onOpenChange}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle className="text-black dark:text-white">Reset App & Delete Data?</AlertDialogTitle>
                    <AlertDialogDescription className="text-destructive">
                        Your encryption PIN cannot be recovered.
                        If you reset it, all encrypted notes will be permanently deleted from this device and from the cloud.
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel disabled={isResetting} className="text-black dark:text-white">Cancel</AlertDialogCancel>
                    <AlertDialogAction
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        onClick={(e) => {
                            e.preventDefault();
                            onConfirm();
                        }}
                        disabled={isResetting}
                    >
                        {isResetting ? "Resetting..." : "Reset & Start Over"}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
};

export default ResetDialog;
