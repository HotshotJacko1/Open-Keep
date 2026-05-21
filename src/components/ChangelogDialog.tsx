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

const ChangelogDialog: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [changelogContent, setChangelogContent] = useState<string>('Loading...');

  useEffect(() => {
    if (!isOpen) return;

    window.history.pushState({ dialog: 'changelog' }, "");

    const handlePopState = (event: PopStateEvent) => {
      // If we popped back to something else, close this
      if (event.state?.dialog === 'changelog') return;
      setIsOpen(false);
    };

    window.addEventListener('popstate', handlePopState);

    return () => {
      window.removeEventListener('popstate', handlePopState);
      if (window.history.state?.dialog === 'changelog') {
        window.history.back();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

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
        className="fixed inset-0 w-screen h-[100dvh] max-w-none max-h-none m-0 rounded-none bg-background text-primary-foreground border-0 p-0 flex flex-col translate-x-0 translate-y-0 origin-center"
        style={{
          '--tw-enter-translate-x': '0',
          '--tw-enter-translate-y': '0',
          '--tw-exit-translate-x': '0',
          '--tw-exit-translate-y': '0',
        } as React.CSSProperties}
      >
        <div className="flex flex-col h-full">
          <DialogHeader className="flex flex-row items-center gap-2 space-y-0 text-left px-6 pt-[max(env(safe-area-inset-top),1.5rem)] pb-4 border-b">
            <Button variant="ghost" size="icon" onClick={() => setIsOpen(false)} className="shrink-0 mt-0 h-8 w-8">
              <ArrowLeft className="h-5 w-5 text-secondary" />
              <span className="sr-only">Back</span>
            </Button>
            <DialogTitle className="text-xl font-bold">What's New</DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto px-6 py-4">
            <div className="prose dark:prose-invert max-w-none 
              prose-headings:font-bold prose-headings:text-primary-foreground
              prose-p:text-primary-foreground/90
              prose-li:text-primary-foreground/90">
              <ReactMarkdown>{changelogContent}</ReactMarkdown>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ChangelogDialog;
