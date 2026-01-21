import React, { useState, useEffect, useRef } from "react";
import { ListNote, ListItem, NoteType } from "@/types/note";
import {
  Dialog,
  DialogContent,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label"; // Keep Label for potential future use
import { Plus, X, GripVertical, ArrowLeft, Pin, Archive, Type, Tag, Trash2, Upload } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { arrayMove } from "@dnd-kit/sortable";

interface ListNoteEditorProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (note: ListNote) => void;
  onDelete: (id: string) => void; // New prop for deleting notes
  initialNote?: ListNote;
}

interface SortableListItemProps {
  item: ListItem;
  onUpdateItem: (id: string, newContent: string) => void;
  onRemoveItem: (id: string) => void;
}

const SortableListItem: React.FC<SortableListItemProps> = ({
  item,
  onUpdateItem,
  onRemoveItem,
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : 0,
    opacity: isDragging ? 0.8 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 bg-white dark:bg-[#202124] rounded-md"
    >
      <Button
        variant="ghost"
        size="icon"
        className="cursor-grab text-black dark:text-white"
        {...listeners}
        {...attributes}
      >
        <GripVertical className="h-4 w-4" />
      </Button>
      <Input
        value={item.content}
        onChange={(e) => onUpdateItem(item.id, e.target.value)}
        placeholder="List item"
        className="flex-1 bg-white dark:bg-[#202124] text-black dark:text-white border-gray-700"
      />
      <Button
        variant="ghost"
        size="icon"
        onClick={() => onRemoveItem(item.id)}
        className="text-black dark:text-white"
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
};

const ListNoteEditor: React.FC<ListNoteEditorProps> = ({
  isOpen,
  onClose,
  onSave,
  onDelete,
  initialNote,
}) => {
  const [title, setTitle] = useState("");
  const [items, setItems] = useState<ListItem[]>([]);
  const [newItemContent, setNewItemContent] = useState("");
  const [tags, setTags] = useState("");
  const [isPinned, setIsPinned] = useState(false);
  const [isArchived, setIsArchived] = useState(false);

  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (initialNote) {
      setTitle(initialNote.title);
      setItems(initialNote.items);
      setTags(initialNote.tags.join(", "));
      setIsPinned(initialNote.isPinned);
      setIsArchived(initialNote.isArchived);
    } else {
      setTitle("");
      setItems([{ id: crypto.randomUUID(), content: "", isCompleted: false }]);
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
      const newNote: ListNote = {
        id: initialNote?.id || crypto.randomUUID(),
        type: NoteType.List,
        title,
        items: items.filter(item => item.content.trim() !== ''), // Only save non-empty items
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
  }, [title, items, tags, isPinned, isArchived, onSave, initialNote, isOpen]);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor)
  );

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

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (active.id !== over?.id) {
      setItems((items) => {
        const oldIndex = items.findIndex((item) => item.id === active.id);
        const newIndex = items.findIndex((item) => item.id === over?.id);
        return arrayMove(items, oldIndex, newIndex);
      });
    }
  };

  const handleDelete = () => {
    if (initialNote?.id) {
      onDelete(initialNote.id);
      onClose();
    }
  };

  const handleCloseEditor = () => {
    // If the note is existing and both title is blank and there are no non-empty items, delete it
    const hasContent = title.trim() !== "" || items.some(item => item.content.trim() !== '');
    if (initialNote?.id && !hasContent) {
      onDelete(initialNote.id);
    }
    onClose();
  };

  const handleExport = () => {
    const filename = (title.trim() || "Untitled_List").replace(/[<>:"/\\|?*]/g, '_') + ".md";
    // Format items as a markdown checklist
    const content = items.map(item => `- [${item.isCompleted ? 'x' : ' '}] ${item.content}`).join('\n');
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
        <div className="flex justify-between items-center p-2 border-b border-gray-700">
          <Button variant="ghost" size="icon" onClick={handleCloseEditor}>
            <ArrowLeft className="h-5 w-5" />
            <span className="sr-only">Back</span>
          </Button>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsPinned(!isPinned)}
              className={isPinned ? "text-yellow-400" : "text-secondary"}
            >
              <Pin className="h-5 w-5" />
              <span className="sr-only">{isPinned ? "Unpin Note" : "Pin Note"}</span>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsArchived(!isArchived)}
              className={isArchived ? "text-blue-400" : "text-secondary"}
            >
              <Archive className="h-5 w-5" />
              <span className="sr-only">{isArchived ? "Unarchive Note" : "Archive Note"}</span>
            </Button>
          </div>
        </div>

        <div className="grid gap-4 py-4 px-2">
          {/* Title Input with placeholder */}
          <div>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full bg-white dark:bg-[#202124] text-black dark:text-white border-gray-700 text-lg font-semibold"
              placeholder="Title"
            />
          </div>

          <div className="flex flex-col gap-2">
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={items.map(item => item.id)}
                strategy={verticalListSortingStrategy}
              >
                {items.map((item) => (
                  <SortableListItem
                    key={item.id}
                    item={item}
                    onUpdateItem={handleUpdateItem}
                    onRemoveItem={handleRemoveItem}
                  />
                ))}
              </SortableContext>
            </DndContext>
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
                className="bg-white dark:bg-[#202124] text-black dark:text-white border-gray-700"
              />
              <Button type="button" variant="ghost" onClick={handleAddItem} size="icon" className="text-secondary">
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>

        </div>
        <DialogFooter className="flex flex-row items-center justify-end gap-2 p-2 border-t border-gray-200 dark:border-gray-700">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="text-secondary">
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
              <Button variant="ghost" size="icon" className="text-secondary">
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
                size="icon"
                onClick={handleExport}
                className="text-secondary"
              >
                <Upload className="h-5 w-5" />
                <span className="sr-only">Export Note</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Export Note</p>
            </TooltipContent>
          </Tooltip>
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

export default ListNoteEditor;