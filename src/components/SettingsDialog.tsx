// Copyright (c) 2026. Licensed under AGPLv3.
import React, { useState, useRef, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/context/theme-provider";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { 
  Sun, 
  Moon, 
  Monitor, 
  Upload, 
  Download, 
  Loader2, 
  Shield, 
  FileText, 
  Mail, 
  ArrowLeft, 
  Sparkles, 
  MessageSquare,
  Fingerprint,
  Hash,
  RefreshCw
} from "lucide-react";
import SyncDialog from "./SyncDialog";
import ChangePinDialog from "./ChangePinDialog";
import AppLockDialog from "./AppLockDialog";
import GoogleKeepMigrationGuide from "./GoogleKeepMigrationGuide";
import ChangelogDialog from "./ChangelogDialog";
import { useSession } from "@/context/session-provider";
import { Note } from "@/types/note";
import JSZip from "jszip";
import { saveAs } from "file-saver";
import { showSuccess, showError } from "@/utils/toast";
import { Capacitor } from "@capacitor/core";
import { Filesystem, Directory, Encoding } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { ImportManager } from "@/utils/import-manager";
import { ImportInput, ImportInputFile } from "@/types/import";
import { App } from "@capacitor/app";
import { Device } from "@capacitor/device";
import { supabase } from "@/integrations/supabase/client";

interface SettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  notes: Note[];
  onImportNotes: (notes: Note[]) => void;
}

const SettingsDialog: React.FC<SettingsDialogProps> = ({ isOpen, onClose, notes, onImportNotes }) => {
  const { theme, setTheme } = useTheme();
  const [isSyncDialogOpen, setIsSyncDialogOpen] = useState(false);
  const [isAppLockDialogOpen, setIsAppLockDialogOpen] = useState(false);
  const [isChangePinDialogOpen, setIsChangePinDialogOpen] = useState(false);
  const [isKeepGuideOpen, setIsKeepGuideOpen] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { session } = useSession();
  const user = session?.user;
  const [appVersion, setAppVersion] = useState<string>("...");
  const [pinCode, setPinCode] = useState<string | null>(null);

  useEffect(() => {
    const fetchPin = async () => {
      if (user?.id) {
        const { data, error } = await supabase
          .from('user_entitlements')
          .select('pin_code')
          .eq('user_id', user.id)
          .single();
        if (data && data.pin_code) {
          setPinCode(data.pin_code.toString());
        } else if (error && error.code !== 'PGRST116') {
          console.error('Error fetching pin:', error);
        }
      }
    };
    if (isOpen) {
      fetchPin();
    }
  }, [user?.id, isOpen]);

  useEffect(() => {
    const getAppInfo = async () => {
      try {
        const info = await App.getInfo();
        setAppVersion(info.version);
      } catch (error) {
        console.error("Failed to get app info:", error);
        setAppVersion("1.0.2"); // Fallback
      }
    };
    getAppInfo();
  }, []);

  React.useEffect(() => {
    if (!isOpen) return;

    window.history.pushState({ dialog: 'settings' }, "");

    const handlePopState = (event: PopStateEvent) => {
      // If we popped back TO settings state, stay open
      if (event.state?.dialog === 'settings') return;
      onClose();
    };

    window.addEventListener('popstate', handlePopState);

    return () => {
      window.removeEventListener('popstate', handlePopState);
      if (window.history.state?.dialog === 'settings') {
        window.history.back();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  React.useEffect(() => {
    const handleGlobalConflict = () => {
      setIsSyncDialogOpen(true);
    };
    window.addEventListener('open-sync-conflict', handleGlobalConflict);
    return () => window.removeEventListener('open-sync-conflict', handleGlobalConflict);
  }, []);

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    setIsImporting(true);
    try {
      const inputFiles: ImportInputFile[] = [];

      // We need to read zip contents or direct file contents
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (file.name.endsWith('.md') || file.name.endsWith('.json')) {
          const content = await file.text();
          inputFiles.push({ name: file.name, content: content });
        } else if (file.name.endsWith('.zip')) {
          const zip = await JSZip.loadAsync(file);
          const promises: Promise<void>[] = [];

          zip.forEach((relativePath, zipEntry) => {
            if (!zipEntry.dir && (zipEntry.name.endsWith('.md') || zipEntry.name.endsWith('.json'))) {
              const promise = zipEntry.async("string").then((content) => {
                inputFiles.push({
                  name: zipEntry.name.split('/').pop() || zipEntry.name,
                  content: content
                });
              });
              promises.push(promise);
            }
          });
          await Promise.all(promises);
        }
      }

      const inputData: ImportInput = { files: inputFiles };
      const manager = new ImportManager();
      const result = await manager.run(inputData);

      if (result.notes.length > 0) {
        // We ensure a valid ID for notes just in case
        const mappedNotes: Note[] = result.notes.map(n => ({
          ...n,
          id: n.id || crypto.randomUUID(),
          title: n.title || "Untitled",
          content: n.content || "",
          tags: n.tags || [],
          isPinned: !!n.isPinned,
          isArchived: !!n.isArchived,
          createdAt: n.createdAt || Date.now(),
          updatedAt: n.updatedAt || Date.now()
        }));

        onImportNotes(mappedNotes);
        showSuccess(`Imported ${result.report.notesImported} notes from ${result.report.source}. Created ${result.report.tagsCreated} tags.`);
      } else {
        showError("No valid notes found to import.");
      }
    } catch (error: any) {
      console.error("Import error:", error);
      showError(`Import Error: ${error.message || 'Failed to import notes'}`);
    } finally {
      setIsImporting(false);
      // Reset input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };


  const handleExportAll = async () => {
    if (notes.length === 0) {
      showError("No notes to export");
      return;
    }

    setIsExporting(true);
    try {
      const zip = new JSZip();

      notes.forEach((note) => {
        // Content is always markdown now
        const content = note.content;

        // Sanitize title for filename
        const filename = `${note.title.replace(/[^a-z0-9]/gi, '_').substring(0, 50) || 'untitled'}_${note.id.substring(0, 4)}.md`;
        zip.file(filename, `# ${note.title}\n\n${content}`);
      });

      const filename = `open-keep-export-${new Date().toISOString().split('T')[0]}.zip`;

      if (Capacitor.isNativePlatform()) {
        const contentBase64 = await zip.generateAsync({ type: "base64" });

        const result = await Filesystem.writeFile({
          path: filename,
          data: contentBase64,
          directory: Directory.Cache,
          recursive: true
        });

        await Share.share({
          title: 'Export All Notes',
          text: 'Exporting all notes',
          url: result.uri,
          dialogTitle: 'Export All Notes'
        });

        showSuccess(`Export ready`);
      } else {
        const content = await zip.generateAsync({ type: "blob" });
        saveAs(content, filename);
        showSuccess("All notes exported successfully");
      }
    } catch (error) {
      console.error("Export error:", error);
      showError("Failed to export notes");
    } finally {
      setIsExporting(false);
    }
  };

  const handleFeedbackEmail = async () => {
    try {
      const info = await Device.getInfo();
      const appInfo = await App.getInfo();
      const platformString = Capacitor.getPlatform();
      const subject = "Open Keep App";
      const emailRecipient = "openkeep@jorvikwebdesigns.com";

      const emailBody = `Platform: ${platformString}
Device make: ${info.manufacturer || 'Unknown'}
Device model: ${info.model || 'Unknown'}
App version: ${appInfo.version}
PIN code: ${pinCode || 'Not set'}`;

      const mailtoUrl = `mailto:${emailRecipient}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(emailBody)}`;

      // Copy to clipboard
      await navigator.clipboard.writeText(emailRecipient);
      showSuccess('Email copied to clipboard');

      // Open mail client
      window.location.href = mailtoUrl;
    } catch (error) {
      console.error("Feedback error:", error);
      // Fallback if device info fails
      window.location.href = "mailto:openkeep@jorvikwebdesigns.com?subject=Open%20Keep%20App";
    }
  };


  return (
    <>
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent
          aria-describedby={undefined}
          className="w-full h-full max-w-full sm:max-w-[425px] sm:h-auto sm:max-h-[85vh] sm:rounded-lg !rounded-none sm:!rounded-lg overflow-y-auto bg-background text-primary-foreground border-0 sm:border pt-[max(env(safe-area-inset-top),1.5rem)] pb-[max(env(safe-area-inset-bottom),1.5rem)] px-6"
        >
          <DialogHeader className="flex flex-row items-center gap-2 space-y-0 text-left">
            <Button variant="ghost" size="icon" onClick={onClose} className="shrink-0 mt-0 h-8 w-8">
              <ArrowLeft className="h-5 w-5 text-secondary" />
              <span className="sr-only">Back</span>
            </Button>
            <DialogTitle>Settings</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="theme">Theme</Label>
              <ToggleGroup
                type="single"
                value={theme}
                onValueChange={(value: "light" | "dark" | "system") => {
                  if (value) setTheme(value);
                }}
                className="justify-start"
              >
                <ToggleGroupItem value="light"
                  className="data-[state=on]:bg-[#707070] data-[state=on]:text-[#f8fafc]"
                  aria-label="Toggle light theme">
                  <Sun className="h-4 w-4 mr-2" /> Light
                </ToggleGroupItem>
                <ToggleGroupItem value="dark"
                  aria-label="Toggle dark theme">
                  <Moon className="h-4 w-4 mr-2" /> Dark
                </ToggleGroupItem>
                <ToggleGroupItem value="system"
                  aria-label="Toggle system theme">
                  <Monitor className="h-4 w-4 mr-2" /> System
                </ToggleGroupItem>
              </ToggleGroup>
            </div>

            <div className="flex flex-col gap-2 mt-4">
              <Label>Security</Label>
              <div className="flex flex-col gap-2">
                <Button variant="outline" onClick={() => setIsAppLockDialogOpen(true)} className="w-full justify-start">
                  <Fingerprint className="h-4 w-4 mr-2" />
                  App Lock & Biometrics
                </Button>
                <Button variant="outline" onClick={() => setIsChangePinDialogOpen(true)} className="w-full justify-start">
                  <Hash className="h-4 w-4 mr-2" />
                  Change Encryption PIN
                </Button>
              </div>
            </div>

            {/* Data Management */}
            <div className="flex flex-col gap-2 mt-4">
              <Label>Data Management</Label>
              <div className="flex flex-col gap-2">
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  multiple
                  accept=".md,.json,.zip,application/zip,application/x-zip-compressed,application/json"
                  className="hidden"
                />
                <Button
                  variant="outline"
                  onClick={() => setIsKeepGuideOpen(true)}
                  className="justify-start"
                >
                  <FileText className="h-4 w-4 mr-2" />
                  Google Keep Import Guide
                </Button>
                <Button
                  variant="outline"
                  onClick={handleImportClick}
                  disabled={isImporting}
                  className="justify-start"
                >
                  {isImporting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
                  Import Notes
                </Button>
                <Button
                  variant="outline"
                  onClick={handleExportAll}
                  disabled={isExporting || notes.length === 0}
                  className="justify-start"
                >
                  {isExporting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
                  Export All Notes
                </Button>
              </div>
            </div>

            <ChangePinDialog
              isOpen={isChangePinDialogOpen}
              onClose={() => setIsChangePinDialogOpen(false)}
            />

            <AppLockDialog
              isOpen={isAppLockDialogOpen}
              onClose={() => setIsAppLockDialogOpen(false)}
            />

            <div className="flex flex-col gap-2 mt-4">
              <Label>Sync</Label>
              <Button variant="outline" onClick={() => setIsSyncDialogOpen(true)} className="w-full justify-start text-left">
                <RefreshCw className="h-4 w-4 mr-2" />
                Open Sync Options
              </Button>
            </div>

            <div className="flex flex-col gap-2 mt-4">
              <Button
                variant="outline"
                onClick={handleFeedbackEmail}
                className="w-full justify-start"
              >
                <Mail className="h-4 w-4 mr-2" /> Feedback, Suggestions, & Support
              </Button>
              <ChangelogDialog />
              <Button
                variant="outline"
                onClick={() => window.open("https://jorvikwebdesigns.com/open-keep-privacy-policy/", "_blank")}
                className="w-full justify-start"
              >
                <Shield className="h-4 w-4 mr-2" /> Privacy Policy
              </Button>
              <Button
                variant="outline"
                onClick={() => window.open("https://jorvikwebdesigns.com/open-keep-terms-of-service/", "_blank")}
                className="w-full justify-start"
              >
                <FileText className="h-4 w-4 mr-2" /> Terms of Service
              </Button>
              <Button
                variant="outline"
                onClick={() => window.open("https://www.reddit.com/r/OpenKeep/", "_blank")}
                className="w-full justify-start"
              >
                <MessageSquare className="h-4 w-4 mr-2" /> Join the Reddit Community
              </Button>
            </div>

            {/* Supabase User PIN */}
            {pinCode && (
              <div className="flex items-center justify-between mt-4">
                <Label className="text-sm font-medium">PIN Code</Label>
                <span className="text-sm font-mono font-semibold tracking-widest text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-900 px-2 py-1 rounded">
                  {pinCode}
                </span>
              </div>
            )}

            <div className="flex items-center justify-between mt-2">
              <Label className="text-sm text-primary-foreground font-medium">App Version</Label>
              <span className="text-xs text-primary-foreground max-w-[60%] truncate">
                {appVersion}
              </span>
            </div>

            {/* Supabase User ID */}
            {user?.id && (
              <div className="flex items-center justify-between mt-2">
                <Label className="text-sm text-primary-foreground font-medium">User ID</Label>
                <span className="text-xs text-primary-foreground max-w-[60%] truncate">
                  {user.id}
                </span>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <SyncDialog
        isOpen={isSyncDialogOpen}
        onClose={() => setIsSyncDialogOpen(false)}
      />

      <GoogleKeepMigrationGuide
        isOpen={isKeepGuideOpen}
        onClose={() => setIsKeepGuideOpen(false)}
      />
    </>
  );
};

export default SettingsDialog;