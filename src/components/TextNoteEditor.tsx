import React, { useState, useEffect, useRef } from "react";
import { TextNote, NoteType } from "@/types/note";
import {
  Dialog,
  DialogContent,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label"; // Keep Label for potential future use or if other components need it
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"; // Import Tooltip components
import { ArrowLeft, Pin, Archive, Type, Tag, Trash2, Upload } from "lucide-react";

interface TextNoteEditorProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (note: TextNote) => void;
  onDelete: (id: string) => void; // New prop for deleting notes
  initialNote?: TextNote;
}

const TextNoteEditor: React.FC<TextNoteEditorProps> = ({
  isOpen,
  onClose,
  onSave,
  onDelete,
  initialNote,
}) => {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [tags, setTags] = useState(""); // Keep state for tags, even if input is removed, for auto-save logic
  const [isPinned, setIsPinned] = useState(false);
  const [isArchived, setIsArchived] = useState(false);

  // Use a ref to store the current note ID. 
  // This ensures we keep the same ID for a new note across auto-saves.
  const noteIdRef = useRef<string>(initialNote?.id || crypto.randomUUID());

  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Effect to load initial note data or reset for new note
  useEffect(() => {
    if (initialNote) {
      noteIdRef.current = initialNote.id;
      setTitle(initialNote.title);
      setContent(initialNote.content);
      setTags(initialNote.tags.join(", "));
      setIsPinned(initialNote.isPinned);
      setIsArchived(initialNote.isArchived);
    } else {
      // For a new note, we generate a fresh ID only when the editor opens fresh.
      // But we need to be careful not to regenerate it if we are just re-rendering.
      // Ideally, we should reset it only when `isOpen` changes from false to true.
      // However, since this effect runs on [initialNote, isOpen], lets handle it carefully.
      if (isOpen && !initialNote) {
        // If opening a new note, ensure we have an ID (could be from previous render if not cleared, 
        // but for safety let's assume we want a new one if we are "resetting")
        // Actually, simpler: if `isOpen` is true and no initialNote, we are starting fresh.
        // BUT, we might have already started editing.
        // The safe bet for "new note" is usually handled by the parent unmounting or resetting key.
        // Given how this component seems to stay mounted but just hidden/shown (based on isOpen),
        // we should reset the ID when it OPENS.
      }
    }
  }, [initialNote, isOpen]);

  // When opening fresh (without initialNote), we might want to ensure a fresh ID.
  // We can do this with a separate effect that runs only when `isOpen` becomes true.
  useEffect(() => {
    if (isOpen && !initialNote) {
      noteIdRef.current = crypto.randomUUID();
      setTitle("");
      setContent("");
      setTags("");
      setIsPinned(false);
      setIsArchived(false);
    }
  }, [isOpen, initialNote]);

  // Auto-save effect with debounce
  useEffect(() => {
    if (!isOpen) {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      return;
    }

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    // Don't save if completely empty
    if (title.trim() === "" && content.trim() === "") {
      return;
    }

    saveTimeoutRef.current = setTimeout(() => {
      const newNote: TextNote = {
        id: noteIdRef.current, // Use the persistent ref
        type: NoteType.Text,
        title,
        content,
        tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean),
        isPinned,
        isArchived,
        createdAt: initialNote?.createdAt || Date.now(),
        updatedAt: Date.now(),
      };
      onSave(newNote);
    }, 500); // Debounce for 500ms

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [title, content, tags, isPinned, isArchived, onSave, initialNote, isOpen]);

  const handleDelete = () => {
    // We can always delete using the current ID ref
    onDelete(noteIdRef.current);
    onClose();
  };

  const handleCloseEditor = () => {
    // If the note is existing and both title and content are blank, delete it
    // This logic applies to both new (saved via auto-save) and existing notes.
    if (title.trim() === "" && content.trim() === "") {
      // If it was previously saved (and thus has an entry in the parent list), we should delete it.
      // Since auto-save creates the entry, we can just call onDelete.
      // However, if it was NEVER saved (empty from start), onDelete might fail if the ID doesn't exist in parent?
      // The parent `onDelete` filters by ID. If ID isn't found, it likely does nothing, which is fine.
      onDelete(noteIdRef.current);
    }
    onClose();
  };

  const handleExport = () => {
    const filename = (title.trim() || "Untitled_Note").replace(/[<>:"/\\|?*]/g, '_') + ".md";
    const blob = new Blob([content], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleCloseEditor}>
      <DialogContent className="sm:max-w-[425px] md:max-w-[600px] lg:max-w-[800px] bg-white dark:bg-[#202124] text-black dark:text-white">
        {/* Top row of action buttons */}
        <div className="flex justify-between items-center p-2 border-b border-gray-200 dark:border-gray-700">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" onClick={handleCloseEditor}>
                <ArrowLeft className="h-5 w-5 text-black dark:text-white" />
                <span className="sr-only">Back</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Back</p>
            </TooltipContent>
          </Tooltip>
          <div className="flex gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setIsPinned(!isPinned)}
                  className={isPinned ? "text-yellow-400" : "text-black dark:text-white"}
                >
                  <Pin className="h-5 w-5" />
                  <span className="sr-only">{isPinned ? "Unpin Note" : "Pin Note"}</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>{isPinned ? "Unpin Note" : "Pin Note"}</p>
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setIsArchived(!isArchived)}
                  className={isArchived ? "text-blue-400" : "text-black dark:text-white"}
                >
                  <Archive className="h-5 w-5" />
                  <span className="sr-only">{isArchived ? "Unarchive Note" : "Archive Note"}</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>{isArchived ? "Unarchive Note" : "Archive Note"}</p>
              </TooltipContent>
            </Tooltip>
          </div>
        </div>

        <div className="grid gap-4 py-4 px-2">
          {/* Title Input with placeholder */}
          <div>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full bg-white dark:bg-[#202124] text-black dark:text-white border-gray-200 dark:border-gray-700 text-lg font-semibold"
              placeholder="Title"
            />
          </div>
          {/* Content Textarea with placeholder */}
          <div>
            <Textarea
              id="content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="w-full min-h-[150px] bg-white dark:bg-[#202124] text-black dark:text-white border-gray-200 dark:border-gray-700"
              placeholder="Content"
            />
          </div>
          {/* Tags row removed as requested */}
        </div>

        <DialogFooter className="flex justify-between p-2 border-t border-gray-200 dark:border-gray-700">
          <div className="flex gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="text-black dark:text-white">
                  <Type className="h-5 w-5" />
                  <span className="sr-only">Text Formatting</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Text Formatting</p>
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="text-black dark:text-white">
                  <Tag className="h-5 w-5" />
                  <span className="sr-only">Add Labels</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Add Labels</p>
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon" // Changed size to "icon" to match other icon buttons
                  onClick={handleExport}
                  className="text-black dark:text-white"
                >
                  <Upload className="h-5 w-5" /> {/* Adjusted icon size to match others */}
                  <span className="sr-only">Export Note</span> {/* Added sr-only for accessibility */}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Export Note</p>
              </TooltipContent>
            </Tooltip>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" onClick={handleDelete} className="text-red-400">
                <Trash2 className="h-5 w-5" />
                <span className="sr-only">Delete Note</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Delete Note</p>
            </TooltipContent>
          </Tooltip>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default TextNoteEditor;