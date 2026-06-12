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
import { Sparkles } from "lucide-react";

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
            <Sparkles className="h-5 w-5 text-yellow-500" />
            <DialogTitle className="text-text-primary dark:text-text-primary text-xl">
              Welcome to Open Keep!
            </DialogTitle>
          </div>
          <DialogDescription asChild>
            <div className="pt-2 text-sm text-text-primary dark:text-text-primary space-y-3">
              <p>
                Thank you for using the app — it really means a lot! 🎉
              </p>
              <p>
                It is early days for Open Keep, so you may encounter the occasional rough edge. If you run into any issues or have feedback, please let me know by going to:
              </p>
              <p className="font-medium text-center py-1 rounded-md bg-muted text-text-primary dark:text-text-primary">
                Settings → Feedback
              </p>
              <p>
                I read every message and will work to fix things as quickly as possible.
              </p>
              <p>
                And don't worry — <strong>Open Keep is open source & free forever</strong>. 💛
              </p>
            </div>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="pt-4">
          <Button className="w-full text-white dark:text-text-primary" onClick={onClose}>
            Get Started
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default WelcomeMessage;
