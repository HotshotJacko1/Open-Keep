import React, { useState, useEffect } from "react";
import { ListNote, ListItem, NoteType } from "@/types/note";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Plus, X } from "lucide-react";

interface ListNoteEditorProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (note: ListNote) => void;
  initialNote?: ListNote;
}

const ListNoteEditor: React.FC<ListNoteEditorProps> = ({
  isOpen,
  onClose,
  onSave,
  initialNote,
}) => {
  const [title, setTitle] = useState("");
  const [items, setItems] = useState<ListItem[]>([]);
  const [newItemContent, setNewItemContent] = useState("");
  const [tags, setTags] = useState("");

  useEffect(() => {
    if (initialNote) {
      setTitle(initialNote.title);
      setItems(initialNote.items);
      setTags(initialNote.tags.join(", "));
    } else {
      setTitle("");
      setItems([{ id: crypto.randomUUID(), content: "", isCompleted: false }]);
      setTags("");
    }
  }, [initialNote, isOpen]);

  const handleAddItem = () => {
    if (newItemContent.trim()) {
      setItems((prev) => [
        ...prev,
        { id: crypto.randomUUID(), content: newItemContent.trim(), isCompleted: false },
      ]);
      setNewItemContent("");
    }
  };

  const handleUpdateItem = (id: string, newContent: string) => {
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, content: newContent } : item))
    );
  };

  const handleRemoveItem = (id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  };

  const handleSave = () => {
    const newNote: ListNote = {
      id: initialNote?.id || crypto.randomUUID(),
      type: NoteType.List,
      title,
      items: items.filter(item => item.content.trim() !== ''), // Only save non-empty items
      tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean),
      isPinned: initialNote?.isPinned || false,
      isArchived: initialNote?.isArchived || false,
      createdAt: initialNote?.createdAt || Date.now(),
      updatedAt: Date.now(),
    };
    onSave(newNote);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[425px] md:max-w-[600px] lg:max-w-[800px]">
        <DialogHeader>
          <DialogTitle>{initialNote ? "Edit List Note" : "Create New List Note"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="title" className="text-right">
              Title
            </Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="col-span-3"
            />
          </div>

          <div className="grid grid-cols-4 items-start gap-4">
            <Label className="text-right pt-2">Items</Label>
            <div className="col-span-3 flex flex-col gap-2">
              {items.map((item) => (
                <div key={item.id} className="flex items-center gap-2">
                  <Input
                    value={item.content}
                    onChange={(e) => handleUpdateItem(item.id, e.target.value)}
                    placeholder="List item"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleRemoveItem(item.id)}
                  >
                    <X className="h-4 w-4 text-muted-foreground" />
                  </Button>
                </div>
              ))}
              <div className="flex items-center gap-2 mt-2">
                <Input
                  value={newItemContent}
                  onChange={(e) => setNewItemContent(e.target.value)}
                  onKeyPress={(e) => {
                    if (e.key === "Enter") {
                      handleAddItem();
                    }
                  }}
                  placeholder="Add new item"
                />
                <Button type="button" onClick={handleAddItem} size="icon">
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="tags" className="text-right">
              Tags (comma-separated)
            </Label>
            <Input
              id="tags"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              className="col-span-3"
              placeholder="e.g., work, ideas, personal"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave}>Save Note</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ListNoteEditor;