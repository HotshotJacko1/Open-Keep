import React, { useState, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/context/theme-provider";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Sun, Moon, Monitor, Upload, Download, Loader2 } from "lucide-react";
import SyncDialog from "./SyncDialog";
import PasscodeDialog from "./PasscodeDialog";
import { useSession } from "@/context/session-provider";
import { Note, NoteType, TextNote } from "@/types/note";
import JSZip from "jszip";
import { saveAs } from "file-saver";
import { showSuccess, showError } from "@/utils/toast";

interface SettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  notes: Note[];
  onImportNotes: (notes: Note[]) => void;
}

const SettingsDialog: React.FC<SettingsDialogProps> = ({ isOpen, onClose, notes, onImportNotes }) => {
  const { theme, setTheme } = useTheme();
  const [isSyncDialogOpen, setIsSyncDialogOpen] = useState(false);
  const [isPasscodeDialogOpen, setIsPasscodeDialogOpen] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { session } = useSession();
  const user = session?.user;

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const processFile = async (file: File): Promise<Note[]> => {
    const importedNotes: Note[] = [];

    if (file.name.endsWith('.md')) {
      const text = await file.text();
      const title = file.name.replace('.md', '');
      const newNote: TextNote = {
        id: crypto.randomUUID(),
        title: title,
        content: text,
        tags: [],
        isPinned: false,
        isArchived: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        type: NoteType.Text
      };
      importedNotes.push(newNote);
    } else if (file.name.endsWith('.zip')) {
      try {
        const zip = await JSZip.loadAsync(file);
        const filePromises: Promise<void>[] = [];

        zip.forEach((relativePath, zipEntry) => {
          if (!zipEntry.dir && zipEntry.name.endsWith('.md')) {
            const promise = zipEntry.async("string").then((content) => {
              // Extract title from filename, handling potential paths in zip
              const filename = zipEntry.name.split('/').pop() || zipEntry.name;
              const title = filename.replace('.md', '');

              const newNote: TextNote = {
                id: crypto.randomUUID(),
                title: title,
                content: content,
                tags: [],
                isPinned: false,
                isArchived: false,
                createdAt: Date.now(),
                updatedAt: Date.now(),
                type: NoteType.Text
              };
              importedNotes.push(newNote);
            });
            filePromises.push(promise);
          }
        });

        await Promise.all(filePromises);
      } catch (e) {
        console.error("Error reading zip file:", e);
        throw new Error("Failed to read zip file");
      }
    }
    return importedNotes;
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    setIsImporting(true);
    try {
      let allImportedNotes: Note[] = [];

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const notesFromFile = await processFile(file);
        allImportedNotes = [...allImportedNotes, ...notesFromFile];
      }

      if (allImportedNotes.length > 0) {
        onImportNotes(allImportedNotes);
        showSuccess(`Successfully imported ${allImportedNotes.length} notes`);
      } else {
        showError("No valid notes found to import");
      }
    } catch (error) {
      console.error("Import error:", error);
      showError("Failed to import notes");
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
        let content = "";
        if (note.type === NoteType.Text) {
          content = (note as TextNote).content;
        } else {
          content = (note as any).items
            .map((item: any) => `${item.isCompleted ? "[x]" : "[ ]"} ${item.content}`)
            .join("\n");
        }

        // Sanitize title for filename
        const filename = `${note.title.replace(/[^a-z0-9]/gi, '_').substring(0, 50) || 'untitled'}_${note.id.substring(0, 4)}.md`;
        zip.file(filename, `# ${note.title}\n\n${content}`);
      });

      const content = await zip.generateAsync({ type: "blob" });
      saveAs(content, `open-keep-export-${new Date().toISOString().split('T')[0]}.zip`);
      showSuccess("All notes exported successfully");
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
        <DialogContent className="sm:max-w-[425px] bg-background text-primary-foreground max-h-[85vh] overflow-y-auto">
          <DialogHeader>
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

            {/* Data Management */}
            <div className="flex flex-col gap-2 mt-4">
              <Label>Data Management</Label>
              <div className="flex flex-col gap-2">
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  multiple
                  accept=".md,.zip,application/zip,application/x-zip-compressed"
                  className="hidden"
                />
                <Button
                  variant="outline"
                  onClick={handleImportClick}
                  disabled={isImporting}
                  className="justify-start"
                >
                  {isImporting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
                  Import Notes
                </Button>
                <Button
                  variant="outline"
                  onClick={handleExportAll}
                  disabled={isExporting || notes.length === 0}
                  className="justify-start"
                >
                  {isExporting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
                  Export All Notes
                </Button>
              </div>
            </div>

            {/* Button to open PasscodeDialog */}
            <div className="flex flex-col gap-2 mt-4">
              <Label>App Passcode</Label>
              <Button variant="outline" onClick={() => setIsPasscodeDialogOpen(true)}>
                Manage Passcode
              </Button>
            </div>

            <div className="flex flex-col gap-2 mt-4">
              <Label>Sync</Label>
              <Button variant="outline" onClick={() => setIsSyncDialogOpen(true)}>
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
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SyncDialog
        isOpen={isSyncDialogOpen}
        onClose={() => setIsSyncDialogOpen(false)}
      />
      <PasscodeDialog
        isOpen={isPasscodeDialogOpen}
        onClose={() => setIsPasscodeDialogOpen(false)}
      />
    </>
  );
};

export default SettingsDialog;