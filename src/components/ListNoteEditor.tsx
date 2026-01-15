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
import { Plus, X, GripVertical, ArrowLeft, Pin, Archive, Type, Tag, Trash2 } from "lucide-react";
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
      className="flex items-center gap-2 bg-white dark:bg-[#202124] rounded-md" // Adjusted background
    >
      <Button
        variant="ghost"
        size="icon"
        className="cursor-grab text-black dark:text-white" // Adjusted text color
        {...listeners}
        {...attributes}
      >
        <GripVertical className="h-4 w-4 text-muted-foreground" />
      </Button>
      <Input
        value={item.content}
        onChange={(e) => onUpdateItem(item.id, e.target.value)}
        placeholder="List item"
        className="flex-1 bg-white dark:bg-[#202124] text-black dark:text-white border-gray-200 dark:border-gray-700" // Adjusted background, text, and border
      />
      <Button
        variant="ghost"
        size="icon"
        onClick={() => onRemoveItem(item.id)}
        className="text-black dark:text-white" // Adjusted text color
      >
        <X className="h-4 w-4 text-muted-foreground" />
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

  return (
    <Dialog open={isOpen} onOpenChange={handleCloseEditor}>
      <DialogContent className="sm:max-w-[425px] md:max-w-[600px] lg:max-w-[800px] bg-white dark:bg-[#202124] text-black dark:text-white"> {/* Adjusted background and text color */}
        {/* Top row of action buttons */}
        <div className="flex justify-between items-center p-2 border-b border-gray-200 dark:border-gray-700"> {/* Adjusted border color */}
          <Button variant="ghost" size="icon" onClick={handleCloseEditor}>
            <ArrowLeft className="h-5 w-5 text-black dark:text-white" /> {/* Adjusted text color */}
            <span className="sr-only">Back</span>
          </Button>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsPinned(!isPinned)}
              className={isPinned ? "text-yellow-400" : "text-black dark:text-white"} {/* Adjusted text color */}
            >
              <Pin className="h-5 w-5" />
              <span className="sr-only">{isPinned ? "Unpin Note" : "Pin Note"}</span>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsArchived(!isArchived)}
              className={isArchived ? "text-blue-400" : "text-black dark:text-white"} {/* Adjusted text color */}
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
              className="w-full bg-white dark:bg-[#202124] text-black dark:text-white border-gray-200 dark:border-gray-700 text-lg font-semibold" // Adjusted background, text, and border
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
                className="bg-white dark:bg-[#202124] text-black dark:text-white border-gray-200 dark:border-gray-700" // Adjusted background, text, and border
              />
              <Button type="button" onClick={handleAddItem} size="icon" className="text-black dark:text-white"> {/* Adjusted text color */}
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>

        </div>
        <DialogFooter className="flex justify-between p-2 border-t border-gray-200 dark:border-gray-700"> {/* Adjusted border color */}
          <div className="flex gap-2">
            <Button variant="ghost" size="icon" className="text-black dark:text-white"> {/* Adjusted text color */}
              <Type className="h-5 w-5" />
              <span className="sr-only">Text Formatting</span>
            </Button>
            <Button variant="ghost" size="icon" className="text-black dark:text-white"> {/* Adjusted text color */}
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

export default ListNoteEditor;