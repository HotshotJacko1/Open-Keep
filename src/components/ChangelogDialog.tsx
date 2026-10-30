// Copyright (c) 2026. Licensed under AGPLv3.
import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Sparkles, ArrowLeft } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { useBackToClose } from "@/hooks/use-back-to-close";

const ChangelogDialog: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [changelogContent, setChangelogContent] = useState<string>('Loading...');

  useBackToClose("changelog", isOpen, () => setIsOpen(false));

  useEffect(() => {
    if (isOpen) {
      fetch('/CHANGELOG.md')
        .then((response) => response.text())
        .then((text) => setChangelogContent(text))
        .catch((error) => {
          console.error('Failed to load changelog:', error);
          setChangelogContent('Failed to load changelog.');
        });
    }
  }, [isOpen]);

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="w-full justify-start">
          <Sparkles className="h-4 w-4 mr-2" /> What's New
        </Button>
      </DialogTrigger>
      <DialogContent 
        aria-describedby={undefined}
        className="w-full h-full max-w-full sm:max-w-[500px] sm:h-auto sm:max-h-[85vh] !rounded-none sm:!rounded-dialog bg-background sm:bg-surface-container-high text-text-primary border-0 sm:border p-0 pb-[max(env(safe-area-inset-bottom),1.5rem)] flex flex-col overflow-hidden"
      >
        <div className="flex flex-col h-full min-h-0">
          <DialogHeader className="flex flex-row items-center gap-2 space-y-0 text-left px-6 pt-[max(env(safe-area-inset-top),1.5rem)] pb-4 border-b">
            <Button variant="ghost" size="icon" onClick={() => setIsOpen(false)} className="touch-target shrink-0 mt-0 h-8 w-8">
              <ArrowLeft className="h-5 w-5 text-secondary" />
              <span className="sr-only">Back</span>
            </Button>
            <DialogTitle className="">What's New</DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto px-6 py-4">
            <div className="prose dark:prose-invert max-w-none 
              prose-headings:font-bold prose-headings:text-text-primary
              prose-p:text-text-primary
              prose-li:text-text-primary">
              <ReactMarkdown>{changelogContent}</ReactMarkdown>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ChangelogDialog;
