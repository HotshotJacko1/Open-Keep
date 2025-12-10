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
import { Label } from "@/components/ui/label";
import { ArrowLeft, Pin, Archive, Type, Tag, Trash2 } from "lucide-react";

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
  const [tags, setTags] = useState("");
  const [isPinned, setIsPinned] = useState(false);
  const [isArchived, setIsArchived] = useState(false);

  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Effect to load initial note data or reset for new note
  useEffect(() => {
    if (initialNote) {
      setTitle(initialNote.title);
      setContent(initialNote.content);
      setTags(initialNote.tags.join(", "));
      setIsPinned(initialNote.isPinned);
      setIsArchived(initialNote.isArchived);
    } else {
      setTitle("");
      setContent("");
      setTags("");
      setIsPinned(false);
      setIsArchived(false);
    }
  }, [initialNote, isOpen]);

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

    saveTimeoutRef.current = setTimeout(() => {
      const newNote: TextNote = {
        id: initialNote?.id || crypto.randomUUID(),
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
    if (initialNote?.id) {
      onDelete(initialNote.id);
      onClose();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[425px] md:max-w-[600px] lg:max-w-[800px] bg-[#202124] text-white">
        {/* Top row of action buttons */}
        <div className="flex justify-between items-center p-2 border-b border-gray-700">
          <Button variant="ghost" size="icon" onClick={onClose}>
            <ArrowLeft className="h-5 w-5 text-white" />
            <span className="sr-only">Back</span>
          </Button>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsPinned(!isPinned)}
              className={isPinned ? "text-yellow-400" : "text-white"}
            >
              <Pin className="h-5 w-5" />
              <span className="sr-only">{isPinned ? "Unpin Note" : "Pin Note"}</span>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsArchived(!isArchived)}
              className={isArchived ? "text-blue-400" : "text-white"}
            >
              <Archive className="h-5 w-5" />
              <span className="sr-only">{isArchived ? "Unarchive Note" : "Archive Note"}</span>
            </Button>
          </div>
        </div>

        <div className="grid gap-4 py-4 px-2">
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="title" className="text-right text-white">
              Title
            </Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="col-span-3 bg-gray-800 text-white border-gray-700"
            />
          </div>
          <div className="grid grid-cols-4 items-start gap-4">
            <Label htmlFor="content" className="text-right pt-2 text-white">
              Content
            </Label>
            <Textarea
              id="content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="col-span-3 min-h-[150px] bg-gray-800 text-white border-gray-700"
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="tags" className="text-right text-white">
              Tags (comma-separated)
            </Label>
            <Input
              id="tags"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              className="col-span-3 bg-gray-800 text-white border-gray-700"
              placeholder="e.g., work, ideas, personal"
            />
          </div>
        </div>

        <DialogFooter className="flex justify-between p-2 border-t border-gray-700">
          <div className="flex gap-2">
            <Button variant="ghost" size="icon" className="text-white">
              <Type className="h-5 w-5" />
              <span className="sr-only">Text Formatting</span>
            </Button>
            <Button variant="ghost" size="icon" className="text-white">
              <Tag className="h-5 w-5" />
              <span className="sr-only">Add Labels</span>
            </Button>
          </div>
          {initialNote?.id && ( // Only show delete button for existing notes
            <Button variant="ghost" size="icon" onClick={handleDelete} className="text-red-400">
              <Trash2 className="h-5 w-5" />
              <span className="sr-only">Delete Note</span>
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default TextNoteEditor;