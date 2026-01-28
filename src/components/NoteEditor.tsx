import React, { useState, useEffect, useRef } from "react";
import { Note } from "@/types/note";
import {
    Dialog,
    DialogContent,
    DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import { Plus, X, GripVertical, ArrowLeft, Pin, Archive, Type, Tag, Trash2, Upload, ListChecks } from "lucide-react";
import NoteLabels from "@/components/NoteLabels";
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
    arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
    isChecklist,
    parseChecklist,
    convertTextToList,
    convertListToText,
    ChecklistItem
} from "@/utils/markdown";

interface NoteEditorProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (note: Note) => void;
    onDelete: (id: string) => void;
    initialNote?: Note;
    availableTags: string[];
}

interface SortableListItemProps {
    item: ChecklistItem;
    onUpdateItem: (id: string, newContent: string) => void;
    onRemoveItem: (id: string) => void;
    onToggleItem: (id: string) => void;
}

const SortableListItem: React.FC<SortableListItemProps> = ({
    item,
    onUpdateItem,
    onRemoveItem,
    onToggleItem
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
            className="flex items-center gap-2 bg-white dark:bg-[#202124] rounded-md mb-1"
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
            <div
                className="cursor-pointer"
                onClick={() => onToggleItem(item.id)}
            >
                <input
                    type="checkbox"
                    checked={item.checked}
                    readOnly
                    className="h-4 w-4 cursor-pointer"
                />
            </div>
            <Input
                value={item.content}
                onChange={(e) => onUpdateItem(item.id, e.target.value)}
                placeholder="List item"
                className={`flex-1 bg-white dark:bg-[#202124] text-black dark:text-white border-none focus-visible:ring-0 ${item.checked ? 'line-through text-gray-500' : ''}`}
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

const NoteEditor: React.FC<NoteEditorProps> = ({
    isOpen,
    onClose,
    onSave,
    onDelete,
    initialNote,
    availableTags = [],
}) => {
    const [title, setTitle] = useState("");
    const [content, setContent] = useState("");
    const [tags, setTags] = useState("");
    const [isPinned, setIsPinned] = useState(false);
    const [isArchived, setIsArchived] = useState(false);
    const [isLabelsOpen, setIsLabelsOpen] = useState(false);

    // Checklist Mode State
    const [isChecklistMode, setIsChecklistMode] = useState(false);
    const [checklistItems, setChecklistItems] = useState<ChecklistItem[]>([]);
    const [newItemContent, setNewItemContent] = useState("");

    const noteIdRef = useRef<string>(initialNote?.id || crypto.randomUUID());
    const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const prevIsOpen = useRef(isOpen);

    // Initialize form
    useEffect(() => {
        if (isOpen && !prevIsOpen.current) {
            if (initialNote) {
                noteIdRef.current = initialNote.id;
                setTitle(initialNote.title);
                setContent(initialNote.content);
                setTags(initialNote.tags.join(", "));
                setIsPinned(initialNote.isPinned);
                setIsArchived(initialNote.isArchived);

                // Detect mode
                const isList = isChecklist(initialNote.content);
                setIsChecklistMode(isList);
                if (isList) {
                    const { items } = parseChecklist(initialNote.content);
                    // Re-assign stable IDs for DnD to prevent jumpiness if we generated random ones?
                    // Actually parseChecklist generates IDs based on index 'line-0', 'line-1'.
                    // This is "okay" for initial load, but for reordering we need stable ones.
                    // Let's replace them with random UUIDs for the session immediately.
                    setChecklistItems(items.map(i => ({ ...i, id: crypto.randomUUID() })));
                }
            } else {
                // Fresh note
                noteIdRef.current = crypto.randomUUID();
                setTitle("");
                setContent("");
                setTags("");
                setIsPinned(false);
                setIsArchived(false);
                setIsChecklistMode(false);
                setChecklistItems([]);
            }
        }
        prevIsOpen.current = isOpen;
    }, [initialNote, isOpen]);

    // Sync Checklist Items -> Content string (Only when in checklist mode)
    // This is how we treat Markdown as authoritative: we rebuild it from UI state.
    useEffect(() => {
        if (isChecklistMode && isOpen) {
            const newContent = checklistItems
                .map(item => `- [${item.checked ? 'x' : ' '}] ${item.content}`)
                .join('\n');

            // Avoid infinite loop if content is already same (though comparison might be expensive)
            if (newContent !== content) {
                setContent(newContent);
            }
        }
    }, [checklistItems, isChecklistMode, isOpen]);

    // Auto-save logic
    useEffect(() => {
        if (!isOpen) {
            if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
            return;
        }
        if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);

        // Don't save if completely empty
        if (title.trim() === "" && content.trim() === "") {
            return;
        }

        saveTimeoutRef.current = setTimeout(() => {
            const newNote: Note = {
                id: noteIdRef.current,
                title,
                content,
                tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean),
                isPinned,
                isArchived,
                createdAt: initialNote?.createdAt || Date.now(),
                updatedAt: Date.now(),
            };
            onSave(newNote);
        }, 500);

        return () => {
            if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
        };
    }, [title, content, tags, isPinned, isArchived, onSave, initialNote, isOpen]);

    // Toggle Mode Logic
    const handleToggleMode = () => {
        if (isChecklistMode) {
            // List -> Text
            const newContent = convertListToText(content);
            setContent(newContent);
            setIsChecklistMode(false);
        } else {
            // Text -> List
            const newContent = convertTextToList(content);
            setContent(newContent);
            setIsChecklistMode(true);

            // Hydrate checklist items for UI
            const { items } = parseChecklist(newContent);
            setChecklistItems(items.map(i => ({ ...i, id: crypto.randomUUID() })));
        }
    };

    // DnD Sensors
    const sensors = useSensors(
        useSensor(PointerSensor),
        useSensor(KeyboardSensor)
    );

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;
        if (active.id !== over?.id) {
            setChecklistItems((items) => {
                const oldIndex = items.findIndex((item) => item.id === active.id);
                const newIndex = items.findIndex((item) => item.id === over?.id);
                return arrayMove(items, oldIndex, newIndex);
            });
        }
    };

    const handleAddItem = () => {
        if (newItemContent.trim()) {
            const newItem = {
                id: crypto.randomUUID(),
                content: newItemContent.trim(),
                checked: false,
                indentation: ""
            };
            setChecklistItems(prev => [...prev, newItem]);
            setNewItemContent("");
        }
    };

    const handleRemoveItem = (id: string) => {
        setChecklistItems(prev => prev.filter(i => i.id !== id));
    };

    const handleUpdateItem = (id: string, newText: string) => {
        setChecklistItems(prev => prev.map(i => i.id === id ? { ...i, content: newText } : i));
    };

    const handleToggleItem = (id: string) => {
        setChecklistItems(prev => prev.map(i => i.id === id ? { ...i, checked: !i.checked } : i));
    };

    const handleCloseEditor = () => {
        // Cleanup empty note if needed
        if (title.trim() === "" && content.trim() === "") {
            onDelete(noteIdRef.current);
        }
        onClose();
    };

    const handleDelete = () => {
        onDelete(noteIdRef.current);
        onClose();
    };

    const handleTagToggle = (tagToAddOrRemove: string) => {
        const currentTags = tags.split(",").map(t => t.trim()).filter(Boolean);
        let newTags: string[];

        if (currentTags.includes(tagToAddOrRemove)) {
            newTags = currentTags.filter(t => t !== tagToAddOrRemove);
        } else {
            newTags = [...currentTags, tagToAddOrRemove];
        }
        setTags(newTags.join(", "));
    };

    // Calculate tag states for NoteLabels
    const currentTagList = tags.split(",").map(t => t.trim()).filter(Boolean);
    const tagStates: Record<string, boolean> = {};
    availableTags.forEach(t => {
        tagStates[t] = currentTagList.includes(t);
    });
    // Also include any new tags not in available list but present in note?
    currentTagList.forEach(t => {
        if (!tagStates[t]) tagStates[t] = true;
    });
    // Merge unique tags for display
    const distplayTags = Array.from(new Set([...availableTags, ...currentTagList])).sort();

    const handleExport = () => {
        const filename = (title.trim() || "Untitled").replace(/[<>:"/\\|?*]/g, '_') + ".md";
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
        <>
            <Dialog open={isOpen} onOpenChange={handleCloseEditor}>
                <DialogContent className="sm:max-w-[425px] md:max-w-[600px] lg:max-w-[800px] h-[80vh] flex flex-col p-0 gap-0 bg-white dark:bg-[#202124] text-black dark:text-white">

                    {/* Header */}
                    <div className="flex justify-between items-center p-2 border-b border-gray-200 dark:border-gray-700 shrink-0">
                        {/* ... existing header ... */}
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button variant="ghost" size="icon" onClick={handleCloseEditor}>
                                    <ArrowLeft className="h-5 w-5 text-secondary" />
                                    <span className="sr-only">Back</span>
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent><p>Back</p></TooltipContent>
                        </Tooltip>

                        <div className="flex gap-2">
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={() => setIsPinned(!isPinned)}
                                        className={isPinned ? "text-yellow-400" : "text-secondary"}
                                    >
                                        <Pin className="h-5 w-5" />
                                        <span className="sr-only">{isPinned ? "Unpin" : "Pin"}</span>
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent><p>{isPinned ? "Unpin" : "Pin"}</p></TooltipContent>
                            </Tooltip>

                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={() => setIsArchived(!isArchived)}
                                        className={isArchived ? "text-blue-400" : "text-secondary"}
                                    >
                                        <Archive className="h-5 w-5" />
                                        <span className="sr-only">{isArchived ? "Unarchive" : "Archive"}</span>
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent><p>{isArchived ? "Unarchive" : "Archive"}</p></TooltipContent>
                            </Tooltip>
                        </div>
                    </div>

                    {/* Scrollable Body */}
                    <div className="flex-1 overflow-y-auto p-4">
                        {/* Title */}
                        <Input
                            id="title"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            className="w-full bg-white dark:bg-[#202124] text-black dark:text-white border-0 focus-visible:ring-0 text-xl font-semibold px-0 mb-4 placeholder:text-gray-400"
                            placeholder="Title"
                        />

                        {/* Editor Content */}
                        {isChecklistMode ? (
                            <div className="flex flex-col gap-2">
                                <DndContext
                                    sensors={sensors}
                                    collisionDetection={closestCenter}
                                    onDragEnd={handleDragEnd}
                                >
                                    <SortableContext
                                        items={checklistItems.map(item => item.id)}
                                        strategy={verticalListSortingStrategy}
                                    >
                                        {checklistItems.map((item) => (
                                            <SortableListItem
                                                key={item.id}
                                                item={item}
                                                onUpdateItem={handleUpdateItem}
                                                onRemoveItem={handleRemoveItem}
                                                onToggleItem={handleToggleItem}
                                            />
                                        ))}
                                    </SortableContext>
                                </DndContext>
                                <div className="flex items-center gap-2 mt-2 pl-2">
                                    <Plus className="h-4 w-4 text-gray-400" />
                                    <Input
                                        value={newItemContent}
                                        onChange={(e) => setNewItemContent(e.target.value)}
                                        onKeyPress={(e) => {
                                            if (e.key === "Enter") handleAddItem();
                                        }}
                                        placeholder="List item"
                                        className="bg-transparent border-none focus-visible:ring-0 flex-1"
                                    />
                                </div>
                            </div>
                        ) : (
                            <Textarea
                                id="content"
                                value={content}
                                onChange={(e) => setContent(e.target.value)}
                                className="w-full h-full min-h-[300px] resize-none bg-white dark:bg-[#202124] text-black dark:text-white border-none focus-visible:ring-0 p-0 leading-relaxed text-base"
                                placeholder="Note"
                            />
                        )}
                    </div>

                    {/* Footer */}
                    <DialogFooter className="flex flex-row items-center justify-between p-2 border-t border-gray-200 dark:border-gray-700 shrink-0">
                        <div className="flex gap-2">
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button variant="ghost" size="icon" onClick={() => setIsChecklistMode(!isChecklistMode)} className="text-secondary">
                                        <ListChecks className={`h-5 w-5 ${isChecklistMode ? "text-primary" : ""}`} />
                                        <span className="sr-only">{isChecklistMode ? "Hide Checkboxes" : "Show Checkboxes"}</span>
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent><p>{isChecklistMode ? "Hide Checkboxes" : "Show Checkboxes"}</p></TooltipContent>
                            </Tooltip>

                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="text-secondary"
                                        onClick={() => setIsLabelsOpen(true)}
                                    >
                                        <Tag className="h-5 w-5" />
                                        <span className="sr-only">Labels</span>
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent><p>Labels</p></TooltipContent>
                            </Tooltip>

                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button variant="ghost" size="icon" className="text-secondary">
                                        <Type className="h-5 w-5" />
                                        <span className="sr-only">Formatting</span>
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent><p>Formatting</p></TooltipContent>
                            </Tooltip>
                        </div>

                        <div className="flex gap-2">
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button variant="ghost" size="icon" onClick={handleExport} className="text-secondary">
                                        <Upload className="h-5 w-5" />
                                        <span className="sr-only">Export</span>
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent><p>Export</p></TooltipContent>
                            </Tooltip>

                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button variant="ghost" size="icon" onClick={handleDelete} className="text-secondary hover:text-red-400">
                                        <Trash2 className="h-5 w-5" />
                                        <span className="sr-only">Delete</span>
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent><p>Delete</p></TooltipContent>
                            </Tooltip>
                        </div>
                    </DialogFooter>

                </DialogContent>
            </Dialog>

            <NoteLabels
                isOpen={isLabelsOpen}
                onClose={() => setIsLabelsOpen(false)}
                availableTags={distplayTags}
                selectedTags={tagStates}
                onTagToggle={handleTagToggle}
            />
        </>
    );
};

export default NoteEditor;
