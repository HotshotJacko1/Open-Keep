import React, { useState, useRef } from "react";
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
import { Sun, Moon, Monitor, Upload, Download, Loader2, Shield, FileText, Mail, ArrowLeft } from "lucide-react";
import SyncDialog from "./SyncDialog";
import ChangePinDialog from "./ChangePinDialog";
import AppLockDialog from "./AppLockDialog";
import { App } from "@capacitor/app";
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
  const [isImporting, setIsImporting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { session } = useSession();
  const user = session?.user;

  React.useEffect(() => {
    if (!isOpen) return;

    window.history.pushState({ dialog: 'settings' }, "");

    const handlePopState = () => {
      onClose();
    };

    window.addEventListener('popstate', handlePopState);

    const backButtonListener = App.addListener('backButton', () => {
      onClose();
    });

    return () => {
      window.removeEventListener('popstate', handlePopState);
      if (window.history.state?.dialog === 'settings') {
        window.history.back();
      }
      backButtonListener.then(listener => listener.remove());
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

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
                  App Lock & Biometrics
                </Button>
                <Button variant="outline" onClick={() => setIsChangePinDialogOpen(true)} className="w-full justify-start">
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
                Open Sync Options
              </Button>
            </div>

            {/* Supabase User ID */}
            {user?.id && (
              <div className="flex items-center justify-between mt-4">
                <Label className="text-sm text-primary-foreground font-medium">User ID</Label>
                <span className="text-xs text-primary-foreground max-w-[60%] truncate">
                  {user.id}
                </span>
              </div>
            )}

            <div className="flex flex-col gap-2 mt-4">
              <Button
                variant="outline"
                onClick={() => window.location.href = "mailto:openkeep@jorvikwebdesigns.com"}
                className="w-full"
              >
                <Mail className="h-4 w-4 mr-2" /> Suggestions & Feedback
              </Button>
              <Button
                variant="outline"
                onClick={() => window.open("https://jorvikwebdesigns.com/open-keep-privacy-policy/", "_blank")}
                className="w-full"
              >
                <Shield className="h-4 w-4 mr-2" /> Privacy Policy
              </Button>
              <Button
                variant="outline"
                onClick={() => window.open("https://jorvikwebdesigns.com/open-keep-privacy-policy/", "_blank")}
                className="w-full"
              >
                <FileText className="h-4 w-4 mr-2" /> Terms of Service
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <SyncDialog
        isOpen={isSyncDialogOpen}
        onClose={() => setIsSyncDialogOpen(false)}
      />
    </>
  );
};

export default SettingsDialog;