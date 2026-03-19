import React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

interface GoogleKeepMigrationGuideProps {
  isOpen: boolean;
  onClose: () => void;
}

const GoogleKeepMigrationGuide: React.FC<GoogleKeepMigrationGuideProps> = ({ isOpen, onClose }) => {
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent
        aria-describedby={undefined}
        className="w-full h-full max-w-full sm:max-w-[500px] sm:h-auto sm:max-h-[85vh] sm:rounded-lg !rounded-none sm:!rounded-lg overflow-y-auto bg-background text-primary-foreground border-0 sm:border pt-[max(env(safe-area-inset-top),1.5rem)] pb-[max(env(safe-area-inset-bottom),1.5rem)] px-6"
      >
        <DialogHeader className="flex flex-row items-center gap-2 space-y-0 text-left mb-4">
          <Button variant="ghost" size="icon" onClick={onClose} className="shrink-0 mt-0 h-8 w-8">
            <ArrowLeft className="h-5 w-5 text-secondary" />
            <span className="sr-only">Back</span>
          </Button>
          <DialogTitle className="text-black dark:text-white">Google Keep Migration Guide</DialogTitle>
        </DialogHeader>

        <div className="space-y-6 text-sm text-black dark:text-white pb-4">
          <div className="space-y-2">
            <h3 className="font-semibold text-base">Step 1: Export your notes from Google Keep</h3>
            <ol className="list-decimal pl-5 space-y-1">
              <li>
                Go to <a href="https://takeout.google.com/" target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline font-medium">Google Takeout</a>.
              </li>
              <li>Click <strong>Deselect all</strong> at the top of the list so you don't export unnecessary data.</li>
              <li>Scroll down until you find <strong>Keep</strong> and check the box next to it.</li>
              <li>Scroll to the bottom of the page and click <strong>Next step</strong>.</li>
              <li>Choose your preferred file type (<strong>.zip is recommended</strong>), frequency (Export once), and destination (e.g., Send download link via email).</li>
              <li>Click <strong>Create export</strong>.</li>
              <li>Once Google has prepared your export, download the .zip file to your device.</li>
            </ol>
          </div>

          <div className="space-y-2">
            <h3 className="font-semibold text-base">Step 2: Import your notes into Open Keep</h3>
            <ol className="list-decimal pl-5 space-y-1">
              <li>Open the Open Keep app.</li>
              <li>Open the <strong>Settings</strong> menu.</li>
              <li>Scroll down to the <strong>Data Management</strong> section.</li>
              <li>Click on <strong>Import Notes</strong>.</li>
              <li>Select the .zip file you downloaded from Google Takeout (the app can read .zip, .json, and .md files directly).</li>
            </ol>
          </div>

          <div className="bg-primary/10 border border-primary/20 p-4 rounded-md">
            <p className="font-medium text-black dark:text-white">
              The app will process the archive and automatically import your Google Keep notes (along with any labels they have)!
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default GoogleKeepMigrationGuide;
