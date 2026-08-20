// Copyright (c) 2026. Licensed under AGPLv3.
import React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertCircle } from "lucide-react";

interface WelcomeMessageProps {
  isOpen: boolean;
  onClose: () => void;
}

const WelcomeMessage: React.FC<WelcomeMessageProps> = ({ isOpen, onClose }) => {
  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-[425px] max-h-[85dvh] overflow-y-auto px-6 pt-[max(env(safe-area-inset-top),1.5rem)] pb-[max(env(safe-area-inset-bottom),1.5rem)]">
        <DialogHeader>
          <div className="flex items-center gap-2 mb-1">
            <AlertCircle className="h-5 w-5 text-blue-500" />
            <DialogTitle className="text-text-primary dark:text-text-primary text-xl">
              Local Storage Only
            </DialogTitle>
          </div>
          <DialogDescription asChild>
            <div className="pt-2 text-sm text-text-primary dark:text-text-primary space-y-3">
              <p>
                Notes are stored in this browser only. Connect cloud sync or export regularly.
              </p>
            </div>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="pt-4">
          <Button className="w-full text-white dark:text-text-primary" onClick={onClose}>
            Got it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default WelcomeMessage;
