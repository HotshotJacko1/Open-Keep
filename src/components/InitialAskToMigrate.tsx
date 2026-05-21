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

interface InitialAskToMigrateProps {
  isOpen: boolean;
  onAccept: () => void;
  onDecline: () => void;
}

const InitialAskToMigrate: React.FC<InitialAskToMigrateProps> = ({ isOpen, onAccept, onDecline }) => {
  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onDecline(); }}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="text-black dark:text-white">Welcome to Open Keep!</DialogTitle>
          <DialogDescription className="pt-4 text-base text-black dark:text-white">
            Would you like to migrate your existing notes from Google Keep?
            <br />
            <br />
            Don't worry, we won't delete them from Google Keep.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex gap-2 sm:gap-0 pt-4 text-black dark:text-white">
          <Button variant="outline" onClick={onDecline}>
            Not Now
          </Button>
          <Button onClick={onAccept}>
            Yes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default InitialAskToMigrate;
