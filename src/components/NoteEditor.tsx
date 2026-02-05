import React, { useState, useEffect, useRef } from "react";
import { Note } from "@/types/note";
import {
    Dialog,
    DialogContent,
    DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import { Plus, X, GripVertical, ArrowLeft, Pin, Archive, Type, Tag, Trash2, Upload, ListChecks, Bold, Italic, Underline } from "lucide-react";
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
import { Capacitor } from "@capacitor/core";
import { Share } from "@capacitor/share";
import { Filesystem, Directory, Encoding } from "@capacitor/filesystem";
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import UnderlineExtension from '@tiptap/extension-underline'
import Placeholder from '@tiptap/extension-placeholder'

interface NoteEditorProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (note: Note) => void;
    onDelete: (id: string) => void;
    initialNote?: Note;
    availableTags: string[];
    autoFocus?: boolean;
}

interface SortableListItemProps {
    item: ChecklistItem;
    onUpdateItem: (id: string, newContent: string) => void;
    onRemoveItem: (id: string) => void;
    onToggleItem: (id: string) => void;
    onEnter: (id: string) => void;
    autoFocus?: boolean;
}

const SortableListItem: React.FC<SortableListItemProps> = ({
    item,
    onUpdateItem,
    onRemoveItem,
    onToggleItem,
    onEnter,
    autoFocus
}) => {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id: item.id });

    const textareaRef = useRef<HTMLTextAreaElement>(null);

    const adjustHeight = () => {
        const textarea = textareaRef.current;
        if (textarea) {
            textarea.style.height = 'auto';
            textarea.style.height = `${textarea.scrollHeight}px`;
        }
    };

    useEffect(() => {
        adjustHeight();
    }, [item.content]);

    // Adjust height on initial render/focus if needed
    useEffect(() => {
        if (autoFocus && textareaRef.current) {
            textareaRef.current.focus();
            // Move cursor to end
            textareaRef.current.setSelectionRange(
                textareaRef.current.value.length,
                textareaRef.current.value.length
            );
        }
    }, [autoFocus]);

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
            className="flex items-start gap-2 bg-white dark:bg-[#202124] rounded-md mb-1 py-1"
        >
            <Button
                variant="ghost"
                size="icon"
                className="cursor-grab text-black dark:text-white mt-1 h-6 w-6 shrink-0"
                {...listeners}
                {...attributes}
            >
                <GripVertical className="h-4 w-4" />
            </Button>
            <Checkbox
                checked={item.checked}
                onCheckedChange={() => onToggleItem(item.id)}
                className="mt-2 h-4 w-4 bg-transparent border-gray-400 data-[state=checked]:bg-transparent data-[state=checked]:text-black dark:data-[state=checked]:text-white shrink-0"
            />
            <textarea
                ref={textareaRef}
                value={item.content}
                onChange={(e) => {
                    onUpdateItem(item.id, e.target.value);
                    adjustHeight();
                }}
                onKeyDown={(e) => {
                    if (e.key === "Enter") {
                        e.preventDefault();
                        onEnter(item.id);
                    }
                }}
                rows={1}
                placeholder="List item"
                className={`flex-1 bg-white dark:bg-[#202124] text-black dark:text-white border-none focus:outline-none resize-none overflow-hidden min-h-[24px] py-1 ${item.checked ? 'line-through text-gray-500' : ''}`}
            />
            <Button
                variant="ghost"
                size="icon"
                onClick={() => onRemoveItem(item.id)}
                className="text-black dark:text-white mt-1 h-6 w-6 shrink-0"
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
    autoFocus = true,
}) => {
    const [title, setTitle] = useState("");
    const [content, setContent] = useState("");
    const [tags, setTags] = useState("");
    const [isPinned, setIsPinned] = useState(false);
    const [isArchived, setIsArchived] = useState(false);
    const [isLabelsOpen, setIsLabelsOpen] = useState(false);
    const [showFormatting, setShowFormatting] = useState(false);

    // Checklist Mode State
    const [isChecklistMode, setIsChecklistMode] = useState(false);
    const [checklistItems, setChecklistItems] = useState<ChecklistItem[]>([]);
    const [newItemContent, setNewItemContent] = useState("");
    const [focusItemId, setFocusItemId] = useState<string | null>(null);

    const noteIdRef = useRef<string>(initialNote?.id || crypto.randomUUID());
    const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const prevIsOpen = useRef(isOpen);

    const editor = useEditor({
        extensions: [
            StarterKit,
            UnderlineExtension,
            Placeholder.configure({
                placeholder: 'Take a note...',
            }),
        ],
        content: content,
        editorProps: {
            attributes: {
                class: 'prose prose-sm sm:prose lg:prose-lg xl:prose-2xl mx-auto focus:outline-none h-full min-h-[300px] text-black dark:text-white',
            },
        },
        onUpdate: ({ editor }) => {
            setContent(editor.getHTML());
        },
    });

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

                // Update Editor Content
                if (editor) {
                    editor.commands.setContent(initialNote.content);
                }

                // Detect mode
                const isList = isChecklist(initialNote.content);
                setIsChecklistMode(isList);
                if (isList) {
                    const { items } = parseChecklist(initialNote.content);
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

                if (editor) {
                    editor.commands.setContent('');
                }
            }

            // Focus logic
            // We use setTimeout to ensure the Dialog animation/mounting is complete enough for focus to take
            setTimeout(() => {
                if (!autoFocus) return;

                // Focus on content as requested.
                if (editor && !isChecklist(initialNote?.content || "")) {
                    editor.commands.focus();
                } else {
                    // Checklist focus is handled by 'focusItemId' usually, but here we manually finding the input.
                    const content = initialNote?.content || "";
                    if (isChecklist(content)) {
                        const { items } = parseChecklist(content);
                        if (items.length > 0) {
                            // Look for the first textarea in the dialog.
                            // We use a slightly more specific selector if possible, or just the first one.
                            const firstTextarea = document.querySelector('div[role="dialog"] textarea') as HTMLTextAreaElement;
                            if (firstTextarea) {
                                firstTextarea.focus();
                                // Ensure cursor is at end
                                firstTextarea.setSelectionRange(firstTextarea.value.length, firstTextarea.value.length);
                            }
                        }
                    }
                }
            }, 100);
        }

        prevIsOpen.current = isOpen;
    }, [initialNote, isOpen, editor]);

    // Sync Checklist Items -> Content string (Only when in checklist mode)
    // This now writes internal content state.
    useEffect(() => {
        if (isChecklistMode && isOpen) {
            const newContent = checklistItems
                .map(item => `- [${item.checked ? 'x' : ' '}] ${item.content}`)
                .join('\n');

            // Avoid infinite loop if content is already same (though comparison might be expensive)
            if (newContent !== content) {
                setContent(newContent);
                // We typically don't update Editor here because we are in Checklist Mode (hidden editor).
                // But if we switch back, we want fresh content.
                // We'll handle that in toggle.
            }
        }
    }, [checklistItems, isChecklistMode, isOpen]);

    // Update editor when switching TO text mode
    useEffect(() => {
        if (!isChecklistMode && editor && content) {
            // Only update if editor is desynced? 
            // editor.getHTML() might differ largely from 'content' if we just switched from list.
            // But we don't want to overwrite typing loop.
            // This is tricky. simpler: only set content on mode switch.
            // Handled in handleToggleMode below? No, that handles state.
            // Let's leave this manual sync for handleToggleMode.
        }
    }, [isChecklistMode, editor]);


    // Auto-save logic
    useEffect(() => {
        if (!isOpen) {
            if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
            return;
        }
        if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);

        // Don't save if completely empty (stripped HTML check?)
        const plainText = content.replace(/<[^>]+>/g, '').trim();
        if (title.trim() === "" && plainText === "") {
            return;
        }

        saveTimeoutRef.current = setTimeout(() => {
            const newNote: Note = {
                id: noteIdRef.current,
                title,
                content, // Saves HTML now
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
            // Convert list to text, then wrap lines in <p> for Tiptap to respect newlines
            const plainText = convertListToText(content);
            const htmlContent = plainText
                .split('\n')
                .map(line => `<p>${line}</p>`)
                .join('');

            setContent(htmlContent);
            setIsChecklistMode(false);
            // Editor needs update
            if (editor) {
                editor.commands.setContent(htmlContent);
                editor.commands.focus('end');
            }
        } else {
            // Text -> List
            // Parse HTML to text manually to ensure we get lines back
            // We use a temporary div but pre-process HTML to ensure newlines are preserved
            let textContent = content;

            if (content.includes('<')) {
                const tempHtml = content
                    .replace(/<\/p>/gi, '\n') // End of paragraph = newline
                    .replace(/<br\s*\/?>/gi, '\n') // Break tag = newline
                    .replace(/<\/div>/gi, '\n'); // End of div = newline

                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = tempHtml;
                textContent = tempDiv.textContent || tempDiv.innerText || "";

                // DEBUG: Inspect values
                console.log('Toggle Debug:', { content, tempHtml, textContent });
                (window as any).debugContent = { content, tempHtml, textContent };
            }

            const newContent = convertTextToList(textContent);
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

    const handleInsertItemAfter = (currentId: string) => {
        const index = checklistItems.findIndex(i => i.id === currentId);
        if (index === -1) return;

        const newItem: ChecklistItem = {
            id: crypto.randomUUID(),
            content: "",
            checked: false,
            indentation: ""
        };

        const newItems = [...checklistItems];
        newItems.splice(index + 1, 0, newItem);
        setChecklistItems(newItems);
        setFocusItemId(newItem.id);
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
            setFocusItemId(null);
        }
    };

    const handleRemoveItem = (id: string) => {
        setChecklistItems(prev => prev.filter(i => i.id !== id));
    };

    const handleUpdateItem = (id: string, newText: string) => {
        setChecklistItems(prev => prev.map(i => i.id === id ? { ...i, content: newText } : i));
    };

    const handleToggleItem = (id: string) => {
        setChecklistItems(prev => {
            const itemIndex = prev.findIndex(i => i.id === id);
            if (itemIndex === -1) return prev;

            const newItems = [...prev];
            const item = newItems[itemIndex];
            const isChecked = !item.checked;

            // Remove current item
            newItems.splice(itemIndex, 1);
            const updatedItem = { ...item, checked: isChecked };

            if (isChecked) {
                // Move to bottom if checked
                newItems.push(updatedItem);
            } else {
                // Keep in place (insert back at same index) if unchecked
                newItems.splice(itemIndex, 0, updatedItem);
            }

            return newItems;
        });
    };

    const handleCloseEditor = () => {
        // Clear any pending auto-save to prevent race conditions
        if (saveTimeoutRef.current) {
            clearTimeout(saveTimeoutRef.current);
        }

        const plainText = content.replace(/<[^>]+>/g, '').trim();

        // Cleanup empty note if needed
        if (title.trim() === "" && plainText === "") {
            onDelete(noteIdRef.current);
        } else {
            // Force immediate save on close
            const finalNote: Note = {
                id: noteIdRef.current,
                title,
                content,
                tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean),
                isPinned,
                isArchived,
                createdAt: initialNote?.createdAt || Date.now(),
                updatedAt: Date.now(),
            };
            onSave(finalNote);
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

    const handleExport = async () => {
        const filename = (title.trim() || "Untitled").replace(/[<>:"/\\|?*]/g, '_') + ".md";

        if (Capacitor.isNativePlatform()) {
            try {
                // Write file to cache directory
                const result = await Filesystem.writeFile({
                    path: filename,
                    data: content,
                    directory: Directory.Cache,
                    encoding: Encoding.UTF8,
                });

                // Share the file
                await Share.share({
                    title: title || "Untitled Note",
                    text: "Here is your note from Open Keep",
                    url: result.uri,
                    dialogTitle: "Export Note",
                });
            } catch (error) {
                console.error("Error exporting note:", error);
                // Fallback or alert user? For now just log.
            }
        } else {
            // Web fallback
            const blob = new Blob([content], { type: "text/markdown" });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
        }
    };

    return (
        <>
            <Dialog open={isOpen} onOpenChange={(open) => !open && handleCloseEditor()}>
                <DialogContent
                    className="w-full max-w-none h-[100dvh] rounded-none sm:rounded-lg sm:max-w-[425px] sm:h-[80vh] md:max-w-[600px] lg:max-w-[800px] flex flex-col p-0 gap-0 bg-white dark:bg-[#202124] text-black dark:text-white"
                    onOpenAutoFocus={(e) => e.preventDefault()}
                >

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
                                                onEnter={handleInsertItemAfter}
                                                autoFocus={item.id === focusItemId}
                                            />
                                        ))}
                                    </SortableContext>
                                </DndContext>
                                <div className="flex items-start gap-2 mt-2 pl-2">
                                    <Plus className="h-4 w-4 text-gray-400 mt-1.5" />
                                    <textarea
                                        value={newItemContent}
                                        onChange={(e) => {
                                            setNewItemContent(e.target.value);
                                            e.target.style.height = 'auto';
                                            e.target.style.height = `${e.target.scrollHeight}px`;
                                        }}
                                        onKeyDown={(e) => {
                                            if (e.key === "Enter") {
                                                e.preventDefault();
                                                handleAddItem();
                                                // Reset height after adding
                                                setTimeout(() => {
                                                    const target = e.target as HTMLTextAreaElement;
                                                    target.style.height = 'auto';
                                                }, 0);
                                            }
                                        }}
                                        rows={1}
                                        placeholder="List item"
                                        className="bg-transparent border-none focus:outline-none resize-none overflow-hidden min-h-[24px] flex-1 py-1"
                                    />
                                </div>
                            </div>
                        ) : (
                            <div onClick={() => editor?.chain().focus().run()} className="w-full h-full min-h-[300px] cursor-text">
                                <EditorContent editor={editor} className="outline-none min-h-[300px]" />
                            </div>
                        )}
                    </div>

                    {/* Footer */}
                    <DialogFooter className="flex flex-row items-center justify-between sm:justify-between p-2 border-t border-gray-200 dark:border-gray-700 shrink-0">
                        <div className="flex gap-2">
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button variant="ghost" size="icon" onClick={handleToggleMode} className="text-secondary">
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
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className={`text-secondary ${showFormatting ? "bg-accent" : ""}`}
                                        onClick={() => setShowFormatting(!showFormatting)}
                                    >
                                        <Type className="h-5 w-5" />
                                        <span className="sr-only">Formatting</span>
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent><p>Formatting</p></TooltipContent>
                            </Tooltip>

                            {showFormatting && editor && !isChecklistMode && (
                                <>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className={`text-secondary ${editor.isActive('bold') ? 'bg-accent' : ''}`}
                                                onClick={() => editor.chain().focus().toggleBold().run()}
                                            >
                                                <Bold className="h-4 w-4" />
                                                <span className="sr-only">Bold</span>
                                            </Button>
                                        </TooltipTrigger>
                                        <TooltipContent><p>Bold</p></TooltipContent>
                                    </Tooltip>

                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className={`text-secondary ${editor.isActive('italic') ? 'bg-accent' : ''}`}
                                                onClick={() => editor.chain().focus().toggleItalic().run()}
                                            >
                                                <Italic className="h-4 w-4" />
                                                <span className="sr-only">Italic</span>
                                            </Button>
                                        </TooltipTrigger>
                                        <TooltipContent><p>Italic</p></TooltipContent>
                                    </Tooltip>

                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className={`text-secondary ${editor.isActive('underline') ? 'bg-accent' : ''}`}
                                                onClick={() => editor.chain().focus().toggleUnderline().run()}
                                            >
                                                <Underline className="h-4 w-4" />
                                                <span className="sr-only">Underline</span>
                                            </Button>
                                        </TooltipTrigger>
                                        <TooltipContent><p>Underline</p></TooltipContent>
                                    </Tooltip>
                                </>
                            )}
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
