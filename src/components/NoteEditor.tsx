// Copyright (c) 2026. Licensed under AGPLv3.
import React, { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { cn, safeRandomUUID } from "@/lib/utils";
import { Note } from "@/types/note";
import { toast } from "sonner";
import { showSuccess } from "@/utils/toast";
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogTitle,
    DialogDescription,
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
import { Plus, X, GripVertical, ArrowLeft, Pin, Archive, Type, Tag, Trash2, FileDown, ListChecks, Bold, Italic, Underline, Upload, ChevronDown, ChevronRight, Bell, Info, Palette } from "lucide-react";
import NoteLabels from "@/components/NoteLabels";
import ReminderSheet from "@/components/ReminderSheet";
import CheckboxHitArea from "@/components/CheckboxHitArea";
import FileInfo from "@/components/FileInfo";
import NoteColorPicker from "@/components/NoteColorPicker";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import { DEFAULT_NOTE_COLOR, getNoteTintVars, isNoteTinted, normalizeNoteColor } from "@/lib/note-colors";
import { scheduleReminderNotification, cancelReminderNotification, formatReminderLabel } from "@/utils/reminder";
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
    isTopLevel,
    parseChecklist,
    serializeChecklist,
    removeChecklistItems,
    splitMultilineItemText,
    groupChecklistForDisplay,
    moveChecklistItem,
    indentChecklistItem,
    outdentChecklistItem,
    groupEnd,
    convertTextToList,
    convertListToText,
    CHECKLIST_INDENT,
    ChecklistItem,
    ChecklistDisplayRow
} from "@/utils/markdown";
import { Capacitor } from "@capacitor/core";
import { App as CapacitorApp } from "@capacitor/app";

import { Filesystem, Directory, Encoding } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { useIsMobile } from "@/hooks/use-mobile";
import { useFlipNextChange } from "@/hooks/use-flip-layout";

import { saveImage, getImageSrc, deleteImage } from "@/lib/image-storage";
import { expectExternalActivity } from "@/lib/app-relock";
import { ImageIcon } from "lucide-react";

import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import CharacterCount from '@tiptap/extension-character-count'
import { CustomLink, HardBreakOnEnter, LINK_OPTIONS } from "@/lib/editor-extensions"
import { LinkHighlightedTextarea } from "@/components/LinkHighlightedTextarea"
import { TITLE_MAX, BODY_MAX, LIST_ITEM_MAX, LIST_ITEMS_MAX } from "../lib/note-limits"
import { plainTextToHtml, serializeNoteToMarkdown } from "@/utils/note-markdown-format";
import { getTextDirection } from "@/utils/text-direction";
import { useBackToClose } from "@/hooks/use-back-to-close";

interface NoteEditorProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (note: Note) => void;
    onDelete: (id: string) => void;
    initialNote?: Note;
    availableTags: string[];
    autoFocus?: boolean;
    focusTarget?: "title" | "body";
    /**
     * The note was opened from its card and a container transform is playing
     * (lib/container-transform.ts): swap the dialog's zoom for fades timed to
     * the morph -- stay invisible while the ghost grows, then fade in; fade out
     * quickly on close while the ghost takes over.
     */
    morph?: boolean;
}

// The fields that count as "the user changed this note". Used for the baseline
// taken on open/save and for the live comparison, so both are built the same way.
const makeNoteSnapshot = (n: Pick<Note, 'title' | 'content' | 'tags' | 'isPinned' | 'isArchived' | 'images' | 'color' | 'reminder' | 'recurrence'> & { type?: string }) =>
    JSON.stringify({
        title: n.title,
        content: n.content,
        type: n.type === 'list' ? 'list' : 'text',
        tags: n.tags || [],
        isPinned: !!n.isPinned,
        isArchived: !!n.isArchived,
        images: n.images || [],
        color: normalizeNoteColor(n.color || DEFAULT_NOTE_COLOR),
        reminder: n.reminder,
        recurrence: n.recurrence,
    });

// Moves focus between checklist item textareas (id="list-item-<itemId>") in DOM order,
// used so ArrowUp/ArrowDown/ArrowLeft/ArrowRight can cross from one item into the next
// when the cursor is already at the start/end of the current item's content.
const focusAdjacentListItem = (currentId: string, direction: "next" | "prev"): boolean => {
    const textareas = Array.from(
        document.querySelectorAll<HTMLTextAreaElement>('textarea[id^="list-item-"]')
    );
    const index = textareas.findIndex((t) => t.id === `list-item-${currentId}`);
    if (index === -1) return false;
    const target = textareas[direction === "next" ? index + 1 : index - 1];
    if (!target) return false;
    target.focus();
    const pos = direction === "next" ? 0 : target.value.length;
    target.setSelectionRange(pos, pos);
    return true;
};

/**
 * Line breaks must never end up inside an item's text: the note is stored one
 * item per line, so the text after a line break would stop being part of the
 * item. Keyboards don't all send Enter as a keydown "Enter" (some Samsung
 * Keyboard / SwiftKey setups only send a beforeinput line break), so those are
 * handled here exactly like Enter, and text containing line breaks is split
 * into items instead of being inserted.
 */
const useItemLineBreaks = (
    textareaRef: React.RefObject<HTMLTextAreaElement | null>,
    itemId: string,
    onEnter: (id: string, cursorPosition?: number) => void,
    onMultilineText?: (id: string, fullText: string, caret: number) => void,
) => {
    const handlersRef = useRef({ itemId, onEnter, onMultilineText });
    // eslint-disable-next-line react-hooks/refs -- latest-value ref: keeps stable callbacks pointed at current handlers
    handlersRef.current = { itemId, onEnter, onMultilineText };

    useEffect(() => {
        const el = textareaRef.current;
        if (!el) return;
        const handleBeforeInput = (e: InputEvent) => {
            const { itemId: id, onEnter: enter, onMultilineText: multiline } = handlersRef.current;
            if (el.readOnly) return;
            if (e.inputType === "insertLineBreak" || e.inputType === "insertParagraph") {
                e.preventDefault();
                enter(id, el.selectionStart ?? undefined);
                return;
            }
            if (
                multiline &&
                (e.inputType === "insertText" || e.inputType === "insertReplacementText") &&
                e.data && /[\r\n]/.test(e.data)
            ) {
                e.preventDefault();
                const start = el.selectionStart ?? el.value.length;
                const end = el.selectionEnd ?? start;
                multiline(id, el.value.slice(0, start) + e.data + el.value.slice(end), start + e.data.length);
            }
        };
        el.addEventListener("beforeinput", handleBeforeInput);
        return () => el.removeEventListener("beforeinput", handleBeforeInput);
    }, [textareaRef]);

    const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
        const multiline = handlersRef.current.onMultilineText;
        const pasted = e.clipboardData.getData("text/plain");
        if (!multiline || !/[\r\n]/.test(pasted)) return;
        e.preventDefault();
        const el = e.currentTarget;
        const start = el.selectionStart ?? el.value.length;
        const end = el.selectionEnd ?? start;
        multiline(itemId, el.value.slice(0, start) + pasted + el.value.slice(end), start + pasted.length);
    };

    /** Returns true if the value contained a line break and was handled. */
    const handleChangeValue = (value: string, caret: number): boolean => {
        const multiline = handlersRef.current.onMultilineText;
        if (!multiline || !/[\r\n]/.test(value)) return false;
        multiline(itemId, value, caret);
        return true;
    };

    return { handlePaste, handleChangeValue };
};

/** Greyed, read-only copy of a parent, shown above its sub-items when the parent is in the other section. */
const ParentHeaderRow: React.FC<{ item: ChecklistItem }> = ({ item }) => (
    <div data-flip-id={`parent-${item.id}`} dir={getTextDirection(item.content)} className="flex items-start bg-transparent rounded-md mb-0.1 overflow-hidden opacity-50 select-none" aria-hidden="true">
        <div className="flex items-start gap-2 w-full py-2">
            <div className="h-6 w-12 shrink-0" />
            <CheckboxHitArea inert className="pt-4">
                <Checkbox
                    checked={item.checked}
                    disabled
                    tabIndex={-1}
                    className="h-4 w-4 bg-transparent border-muted-foreground data-[state=checked]:bg-transparent data-[state=checked]:text-foreground shrink-0"
                />
            </CheckboxHitArea>
            <span className={`flex-1 text-base text-foreground py-1 break-words [overflow-wrap:anywhere] ${item.checked ? 'line-through' : ''}`}>
                {item.content}
            </span>
            <div className="h-6 w-12 shrink-0" />
        </div>
    </div>
);

/**
 * A stored line that isn't an item (e.g. text left behind by an old bug).
 * Shown so it isn't invisible; the note only changes if "Make item" is tapped.
 */
const StrayLineRow: React.FC<{ text: string; indented: boolean; disabled?: boolean; flipId: string; onConvert: () => void }> = ({ text, indented, disabled, flipId, onConvert }) => (
    <div data-flip-id={flipId} className={`flex items-start gap-2 py-2 ${indented ? 'ml-8' : ''}`}>
        <div className="h-6 w-12 shrink-0" />
        <span className="auto-dir flex-1 min-w-0 text-base text-muted-foreground italic py-1 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
            {text}
        </span>
        {!disabled && (
            <Button
                variant="ghost"
                size="sm"
                onClick={onConvert}
                className="h-7 px-2 text-xs text-muted-foreground shrink-0"
            >
                Make item
            </Button>
        )}
    </div>
);

interface SortableListItemProps {
    item: ChecklistItem;
    onUpdateItem: (id: string, newContent: string) => void;
    onRemoveItem: (id: string) => void;
    onToggleItem: (id: string) => void;
    onEnter: (id: string, cursorPosition?: number) => void;
    onIndent?: (id: string) => void;
    onOutdent?: (id: string) => void;
    onBackspace?: (id: string, cursorPosition?: number, currentContent?: string) => void;
    onMultilineText?: (id: string, fullText: string, caret: number) => void;
    /** Whether to draw the item indented (see groupChecklistForDisplay). Defaults to its stored indentation. */
    displayIndented?: boolean;
    autoFocus?: boolean;
    disabled?: boolean;
}

const SortableListItem: React.FC<SortableListItemProps> = ({
    item,
    onUpdateItem,
    onRemoveItem,
    onToggleItem,
    onEnter,
    onIndent,
    onOutdent,
    onBackspace,
    onMultilineText,
    displayIndented,
    autoFocus,
    disabled
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
    const { handlePaste, handleChangeValue } = useItemLineBreaks(textareaRef, item.id, onEnter, onMultilineText);
    const isIndented = displayIndented ?? item.indentation !== "";
    // A right-to-left item is mirrored: checkbox on the right, indented from
    // the right, and the swipes and arrow keys below reversed to match.
    const dir = getTextDirection(item.content);
    const nextArrow = dir === "rtl" ? "ArrowLeft" : "ArrowRight";
    const prevArrow = dir === "rtl" ? "ArrowRight" : "ArrowLeft";
    const touchStartRef = useRef<{ x: number, y: number } | null>(null);
    const [swipeX, setSwipeX] = useState(0);

    const handleTouchStart = (e: React.TouchEvent) => {
        // A binned note is read-only: swipes would indent/outdent it (C2-25).
        if (disabled) return;
        touchStartRef.current = {
            x: e.touches[0].clientX,
            y: e.touches[0].clientY
        };
    };

    const handleTouchMove = (e: React.TouchEvent) => {
        if (!touchStartRef.current) return;
        const dx = e.touches[0].clientX - touchStartRef.current.x;
        const dy = e.touches[0].clientY - touchStartRef.current.y;

        if (Math.abs(dx) > Math.abs(dy)) {
            setSwipeX(dx);
        }
    };

    const handleTouchEnd = (e: React.TouchEvent) => {
        if (!touchStartRef.current) return;
        const dx = e.changedTouches[0].clientX - touchStartRef.current.x;
        const dy = e.changedTouches[0].clientY - touchStartRef.current.y;

        const threshold = 50;
        if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > threshold) {
            // Swiping towards the end of the line indents
            if ((dir === "rtl" ? -dx : dx) > 0) {
                if (onIndent) onIndent(item.id);
            } else {
                if (onOutdent) onOutdent(item.id);
            }
        }
        setSwipeX(0);
        touchStartRef.current = null;
    };

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
            data-flip-id={item.id}
            dir={dir}
            className={`flex items-start bg-transparent rounded-md mb-0.1 overflow-hidden ${isIndented ? 'ms-8' : ''}`}
        >
            <div
                className="flex items-start gap-2 w-full py-2 transition-transform duration-75"
                style={{ transform: `translateX(${swipeX}px)` }}
            >
                {/* touch-none on the grip only: without it a finger on the grip
                    starts a scroll, which cancels the drag (C2-27). The row and
                    the text must still scroll. */}
                <Button
                    variant="ghost"
                    size="icon"
                    className="cursor-grab touch-none text-foreground -my-2 h-12 w-12 shrink-0 items-start pt-4"
                    disabled={disabled}
                    {...listeners}
                    {...attributes}
                >
                    <GripVertical className="h-4 w-4" />
                </Button>
                <CheckboxHitArea disabled={disabled} className="pt-4">
                    <Checkbox
                        checked={item.checked}
                        onCheckedChange={() => onToggleItem(item.id)}
                        disabled={disabled}
                        className="h-4 w-4 bg-transparent border-muted-foreground data-[state=checked]:bg-transparent data-[state=checked]:text-foreground shrink-0"
                    />
                </CheckboxHitArea>
                <LinkHighlightedTextarea
                    id={`list-item-${item.id}`}
                    ref={textareaRef}
                    value={item.content}
                    readOnly={disabled}
                    maxLength={LIST_ITEM_MAX}
                    onChange={(e) => {
                        if (handleChangeValue(e.target.value, e.target.selectionStart ?? e.target.value.length)) return;
                        onUpdateItem(item.id, e.target.value);
                        adjustHeight();
                    }}
                    onPaste={handlePaste}
                    onKeyDown={(e) => {
                        // readOnly stops typing but not these handlers, which insert,
                        // merge and indent items. Arrow-key navigation stays (C2-25).
                        if (disabled && (e.key === "Enter" || e.key === "Backspace" || e.key === "Tab")) return;
                        if (e.key === "Enter") {
                            e.preventDefault();
                            onEnter(item.id, e.currentTarget.selectionStart ?? undefined);
                        } else if (e.key === "Backspace") {
                            const isAtStart = e.currentTarget.selectionStart === 0 && e.currentTarget.selectionEnd === 0;
                            if (isAtStart || e.currentTarget.value === "") {
                                e.preventDefault();
                                if (onBackspace) onBackspace(item.id, e.currentTarget.selectionStart ?? 0, e.currentTarget.value);
                            }
                        } else if (e.key === "Tab") {
                            e.preventDefault();
                            if (e.shiftKey) {
                                if (onOutdent) onOutdent(item.id);
                            } else {
                                if (onIndent) onIndent(item.id);
                            }
                        } else if (
                            (e.key === "ArrowDown" || e.key === nextArrow) &&
                            !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey &&
                            e.currentTarget.selectionStart === e.currentTarget.value.length &&
                            e.currentTarget.selectionEnd === e.currentTarget.value.length
                        ) {
                            if (focusAdjacentListItem(item.id, "next")) {
                                e.preventDefault();
                            }
                        } else if (
                            (e.key === "ArrowUp" || e.key === prevArrow) &&
                            !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey &&
                            e.currentTarget.selectionStart === 0 &&
                            e.currentTarget.selectionEnd === 0
                        ) {
                            if (focusAdjacentListItem(item.id, "prev")) {
                                e.preventDefault();
                            }
                        }
                    }}
                    rows={1}
                    placeholder="List item"
                    onTouchStart={handleTouchStart}
                    onTouchMove={handleTouchMove}
                    onTouchEnd={handleTouchEnd}
                    className={`flex-1 bg-transparent text-base text-foreground border-none focus:outline-none resize-none overflow-hidden min-h-[24px] py-1 ${item.checked ? 'line-through text-muted-foreground' : ''}`}
                />
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => onRemoveItem(item.id)}
                    disabled={disabled}
                    className="text-foreground -my-2 h-12 w-12 shrink-0 items-start pt-4"
                >
                    <X className="h-4 w-4" />
                </Button>
            </div>
        </div>
    );
};

const CheckedListItem: React.FC<SortableListItemProps> = ({
    item,
    onUpdateItem,
    onRemoveItem,
    onToggleItem,
    onEnter,
    onIndent,
    onOutdent,
    onBackspace,
    onMultilineText,
    displayIndented,
    autoFocus,
    disabled
}) => {
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const { handlePaste, handleChangeValue } = useItemLineBreaks(textareaRef, item.id, onEnter, onMultilineText);
    const isIndented = displayIndented ?? item.indentation !== "";
    // A right-to-left item is mirrored: checkbox on the right, indented from
    // the right, and the swipes and arrow keys below reversed to match.
    const dir = getTextDirection(item.content);
    const nextArrow = dir === "rtl" ? "ArrowLeft" : "ArrowRight";
    const prevArrow = dir === "rtl" ? "ArrowRight" : "ArrowLeft";
    const touchStartRef = useRef<{ x: number, y: number } | null>(null);
    const [swipeX, setSwipeX] = useState(0);

    const handleTouchStart = (e: React.TouchEvent) => {
        // A binned note is read-only: swipes would indent/outdent it (C2-25).
        if (disabled) return;
        touchStartRef.current = {
            x: e.touches[0].clientX,
            y: e.touches[0].clientY
        };
    };

    const handleTouchMove = (e: React.TouchEvent) => {
        if (!touchStartRef.current) return;
        const dx = e.touches[0].clientX - touchStartRef.current.x;
        const dy = e.touches[0].clientY - touchStartRef.current.y;

        if (Math.abs(dx) > Math.abs(dy)) {
            setSwipeX(dx);
        }
    };

    const handleTouchEnd = (e: React.TouchEvent) => {
        if (!touchStartRef.current) return;
        const dx = e.changedTouches[0].clientX - touchStartRef.current.x;
        const dy = e.changedTouches[0].clientY - touchStartRef.current.y;

        const threshold = 50;
        if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > threshold) {
            // Swiping towards the end of the line indents
            if ((dir === "rtl" ? -dx : dx) > 0) {
                if (onIndent) onIndent(item.id);
            } else {
                if (onOutdent) onOutdent(item.id);
            }
        }
        setSwipeX(0);
        touchStartRef.current = null;
    };

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

    useEffect(() => {
        if (autoFocus && textareaRef.current) {
            textareaRef.current.focus();
            textareaRef.current.setSelectionRange(
                textareaRef.current.value.length,
                textareaRef.current.value.length
            );
        }
    }, [autoFocus]);

    return (
        <div data-flip-id={item.id} dir={dir} className={`flex items-start bg-transparent rounded-md mb-0.1 overflow-hidden ${isIndented ? 'ms-8' : ''}`}>
            <div
                className="flex items-start gap-2 w-full py-2 transition-transform duration-75"
                style={{ transform: `translateX(${swipeX}px)` }}
            >
                <div className="h-6 w-12 shrink-0" />
                <CheckboxHitArea disabled={disabled} className="pt-4">
                    <Checkbox
                        checked={item.checked}
                        onCheckedChange={() => onToggleItem(item.id)}
                        disabled={disabled}
                        className="h-4 w-4 bg-transparent border-muted-foreground data-[state=checked]:bg-transparent data-[state=checked]:text-foreground shrink-0"
                    />
                </CheckboxHitArea>
                <LinkHighlightedTextarea
                    id={`list-item-${item.id}`}
                    ref={textareaRef}
                    value={item.content}
                    readOnly={disabled}
                    maxLength={LIST_ITEM_MAX}
                    onChange={(e) => {
                        if (handleChangeValue(e.target.value, e.target.selectionStart ?? e.target.value.length)) return;
                        onUpdateItem(item.id, e.target.value);
                        adjustHeight();
                    }}
                    onPaste={handlePaste}
                    onKeyDown={(e) => {
                        // readOnly stops typing but not these handlers, which insert,
                        // merge and indent items. Arrow-key navigation stays (C2-25).
                        if (disabled && (e.key === "Enter" || e.key === "Backspace" || e.key === "Tab")) return;
                        if (e.key === "Enter") {
                            e.preventDefault();
                            onEnter(item.id, e.currentTarget.selectionStart ?? undefined);
                        } else if (e.key === "Backspace") {
                            const isAtStart = e.currentTarget.selectionStart === 0 && e.currentTarget.selectionEnd === 0;
                            if (isAtStart || e.currentTarget.value === "") {
                                e.preventDefault();
                                if (onBackspace) onBackspace(item.id, e.currentTarget.selectionStart ?? 0, e.currentTarget.value);
                            }
                        } else if (e.key === "Tab") {
                            e.preventDefault();
                            if (e.shiftKey) {
                                if (onOutdent) onOutdent(item.id);
                            } else {
                                if (onIndent) onIndent(item.id);
                            }
                        } else if (
                            (e.key === "ArrowDown" || e.key === nextArrow) &&
                            !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey &&
                            e.currentTarget.selectionStart === e.currentTarget.value.length &&
                            e.currentTarget.selectionEnd === e.currentTarget.value.length
                        ) {
                            if (focusAdjacentListItem(item.id, "next")) {
                                e.preventDefault();
                            }
                        } else if (
                            (e.key === "ArrowUp" || e.key === prevArrow) &&
                            !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey &&
                            e.currentTarget.selectionStart === 0 &&
                            e.currentTarget.selectionEnd === 0
                        ) {
                            if (focusAdjacentListItem(item.id, "prev")) {
                                e.preventDefault();
                            }
                        }
                    }}
                    rows={1}
                    placeholder="List item"
                    onTouchStart={handleTouchStart}
                    onTouchMove={handleTouchMove}
                    onTouchEnd={handleTouchEnd}
                    className={`flex-1 bg-transparent text-base text-foreground border-none focus:outline-none resize-none overflow-hidden min-h-[24px] py-1 ${item.checked ? 'line-through text-muted-foreground' : ''}`}
                />
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => onRemoveItem(item.id)}
                    disabled={disabled}
                    className="text-foreground -my-2 h-12 w-12 shrink-0 items-start pt-4"
                >
                    <X className="h-4 w-4" />
                </Button>
            </div>
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
    focusTarget = "body",
    morph = false,
}) => {
    const isMobile = useIsMobile();
    const isDeleted = initialNote?.isDeleted === true;
    const [title, setTitle] = useState("");
    const [content, setContent] = useState("");
    const [tags, setTags] = useState("");
    const [isPinned, setIsPinned] = useState(false);
    const [isArchived, setIsArchived] = useState(false);
    const [isLabelsOpen, setIsLabelsOpen] = useState(false);
    const [showFormatting, setShowFormatting] = useState(false);
    const [images, setImages] = useState<string[]>([]);
    // Display src per stored path: null if it couldn't be read, absent while loading.
    // Keyed by path, not index, so a slow or failed load can't shift which file an
    // X button deletes (C2-26). `images` stays the source of truth for what's shown.
    const [imageSrcs, setImageSrcs] = useState<Record<string, string | null>>({});
    const [fullscreenImageSrc, setFullscreenImageSrc] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Checklist Mode State
    const [isChecklistMode, setIsChecklistMode] = useState(false);
    const [checklistItems, setChecklistItems] = useState<ChecklistItem[]>([]);
    // Non-item lines stored before the first item (see parseChecklist). Lines
    // after an item travel on the item itself (`trailing`).
    const leadingLinesRef = useRef<string[]>([]);
    // Set once the user changes an item. Until then the checklist -> content
    // effect doesn't write: opening a note must never change it.
    const itemsEditedRef = useRef(false);
    const updateItems = (next: ChecklistItem[] | ((prev: ChecklistItem[]) => ChecklistItem[])) => {
        itemsEditedRef.current = true;
        setChecklistItems(next);
    };
    // The tag text as loaded, so an untouched tag list is compared and saved
    // exactly as stored (a tag containing a comma would otherwise be split).
    const initialTagsTextRef = useRef("");
    const [newItemContent, setNewItemContent] = useState("");
    const [focusItemId, setFocusItemId] = useState<string | null>(null);
    const [showCheckedItems, setShowCheckedItems] = useState(true);
    // Ticking an item slides it down to the ticked section (and unticking
    // slides it back up), instead of it vanishing and reappearing.
    const checklistRef = useRef<HTMLDivElement>(null);
    const captureChecklistLayout = useFlipNextChange(checklistRef);
    const [reminder, setReminder] = useState<number | undefined>(undefined);
    const [recurrence, setRecurrence] = useState<Note['recurrence'] | undefined>(undefined);
    const [isReminderSheetOpen, setIsReminderSheetOpen] = useState(false);
    const [isFileInfoOpen, setIsFileInfoOpen] = useState(false);
    const [color, setColor] = useState<string>(DEFAULT_NOTE_COLOR);
    const [isColorPickerOpen, setIsColorPickerOpen] = useState(false);

    const noteIdRef = useRef<string>(initialNote?.id || safeRandomUUID());
    const titleTextareaRef = useRef<HTMLTextAreaElement>(null);
    const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const prevIsOpen = useRef(isOpen);
    const handleCloseEditorRef = useRef<() => void>(() => { });
    // Locked to true between handleCloseEditor() and the dialog finishing its close animation.
    // Prevents any effect from resetting isChecklistMode while the dialog is still visible.
    const isClosingRef = useRef(false);
    // Snapshot of the note state at the time it was opened. Used to determine whether the note
    // has actually been edited, so opening and closing a note without modifications does not
    // bump its updatedAt timestamp.
    const baselineNoteSnapshotRef = useRef<string | null>(null);
    // updatedAt of the version this editor last wrote (or opened). After each
    // save the baseline moves to the saved state, so "dirty" means "changed
    // since the last save" — otherwise ticking then unticking an item left the
    // ticked version stored, because the final state matched the opening one.
    const lastSavedUpdatedAtRef = useRef<number | undefined>(undefined);

    const adjustTitleHeight = () => {
        const textarea = titleTextareaRef.current;
        if (textarea) {
            textarea.style.height = 'auto';
            textarea.style.height = `${textarea.scrollHeight}px`;
        }
    };

    const isLabelsOpenRef = useRef(isLabelsOpen);
    const isReminderSheetOpenRef = useRef(isReminderSheetOpen);
    const fullscreenImageSrcRef = useRef(fullscreenImageSrc);
    const fullscreenOverlayRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        isLabelsOpenRef.current = isLabelsOpen;
    }, [isLabelsOpen]);

    useEffect(() => {
        isReminderSheetOpenRef.current = isReminderSheetOpen;
    }, [isReminderSheetOpen]);

    useEffect(() => {
        fullscreenImageSrcRef.current = fullscreenImageSrc;
    }, [fullscreenImageSrc]);

    // Mobile back button: close the innermost open panel first, then the editor.
    useBackToClose("note-editor", isMobile && isOpen, () => handleCloseEditorRef.current(), () => {
        if (fullscreenImageSrcRef.current) {
            setFullscreenImageSrc(null);
        } else if (isLabelsOpenRef.current) {
            setIsLabelsOpen(false);
        } else if (isReminderSheetOpenRef.current) {
            setIsReminderSheetOpen(false);
        } else {
            return false;
        }
        return true;
    });


    const editor = useEditor({
        extensions: [
            // link: false — StarterKit bundles @tiptap/extension-link, and
            // registering our own configured Link below made it a duplicate.
            // That produced "[tiptap warn]: Duplicate extension names found:
            // ['link']" everywhere, and threw RangeError (autolink plugin key
            // collision) under StrictMode's double-render in dev. See Sentry
            // OPENKEEP-H.
            StarterKit.configure({ link: false }),
            Placeholder.configure({
                placeholder: 'Take a note...',
            }),
            CustomLink.configure(LINK_OPTIONS),
            CharacterCount.configure({ limit: BODY_MAX }),
            HardBreakOnEnter,
        ],
        content: content,
        editable: !isDeleted,
        editorProps: {
            attributes: {
                // Body text stays 16px on mobile so text notes match list notes
                // (which inherit 16px) and Google Keep's 16sp. No xl step — it
                // pushed body text above the 20px title on wide screens.
                class: 'auto-dir prose lg:prose-lg dark:prose-invert max-w-none focus:outline-none min-h-[40px] text-foreground',
            },
        },
        onUpdate: ({ editor }) => {
            setContent(editor.getHTML());
        },
    });

    const prevInitialNoteIdRef = useRef<string | undefined>(undefined);

    // Initialize form
    useEffect(() => {
        const becameOpen = isOpen && !prevIsOpen.current;
        const noteIdChanged = isOpen && initialNote?.id !== prevInitialNoteIdRef.current;

        if (becameOpen || noteIdChanged) {
            isClosingRef.current = false; // Reset close lock when (re-)opening
            if (initialNote) {
                noteIdRef.current = initialNote.id;
                // eslint-disable-next-line react-hooks/set-state-in-effect -- loads the note into editor state when the editor opens (intentional)
                setTitle(initialNote.title);
                setContent(initialNote.content);
                setTags(initialNote.tags.join(", "));
                initialTagsTextRef.current = initialNote.tags.join(", ");
                itemsEditedRef.current = false;
                setIsPinned(initialNote.isPinned);
                setIsArchived(initialNote.isArchived);
                setReminder(initialNote.reminder);
                setRecurrence(initialNote.recurrence);

                const initialImages = initialNote.images || [];
                setImages(initialImages);
                setImageSrcs({});
                const openedNoteId = initialNote.id;
                Promise.allSettled(initialImages.map(getImageSrc)).then((results) => {
                    // Another note may have opened while these were decrypting.
                    if (noteIdRef.current !== openedNoteId) return;
                    setImageSrcs((prev) => {
                        const next = { ...prev };
                        results.forEach((result, i) => {
                            next[initialImages[i]] = result.status === "fulfilled" ? result.value : null;
                        });
                        return next;
                    });
                });

                // Update Editor Content
                // emitUpdate: false — TipTap 3 emits an update by default, which ran
                // onUpdate and replaced `content` with the editor's re-serialised
                // HTML the moment a note opened (for list notes too, since the
                // hidden editor is loaded as well). Opening must not change a note.
                if (editor) {
                    editor.commands.setContent(initialNote.content, { emitUpdate: false });
                }

                // Detect mode: prefer explicit 'type' field so empty-body list notes
                // are not misclassified as text notes on reopen.
                setColor(initialNote.color || DEFAULT_NOTE_COLOR);

                const isList = initialNote.type === 'list' || isChecklist(initialNote.content);
                setIsChecklistMode(isList);
                if (isList) {
                    const { items, leading } = parseChecklist(initialNote.content);
                    leadingLinesRef.current = leading;
                    setChecklistItems(items.map(i => ({ ...i, id: safeRandomUUID() })));
                } else {
                    leadingLinesRef.current = [];
                }

                baselineNoteSnapshotRef.current = makeNoteSnapshot({
                    ...initialNote,
                    type: isList ? 'list' : 'text',
                    images: initialImages,
                });
                lastSavedUpdatedAtRef.current = initialNote.updatedAt;
            } else {
                // Fresh note
                noteIdRef.current = safeRandomUUID();
                baselineNoteSnapshotRef.current = null;
                lastSavedUpdatedAtRef.current = undefined;
                setTitle("");
                setContent("");
                setTags("");
                setIsPinned(false);
                setIsArchived(false);
                setIsChecklistMode(false);
                setChecklistItems([]);
                leadingLinesRef.current = [];
                itemsEditedRef.current = false;
                initialTagsTextRef.current = "";
                setShowCheckedItems(true);
                setImages([]);
                setImageSrcs({});
                setReminder(undefined);
                setRecurrence(undefined);
                setColor(DEFAULT_NOTE_COLOR);

                if (editor) {
                    editor.commands.setContent('', { emitUpdate: false });
                }
            }

            // Focus logic
            // We use setTimeout to ensure the Dialog animation/mounting is complete enough for focus to take
            setTimeout(() => {
                adjustTitleHeight();
                if (!autoFocus) return;

                // If the user prefers to start in the title field, focus that.
                if (focusTarget === "title") {
                    if (titleTextareaRef.current) {
                        titleTextareaRef.current.focus();
                        titleTextareaRef.current.setSelectionRange(
                            titleTextareaRef.current.value.length,
                            titleTextareaRef.current.value.length
                        );
                    }
                    return;
                }

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
        prevInitialNoteIdRef.current = initialNote?.id;
    }, [initialNote, isOpen, editor]);

    // Sync Checklist Items -> Content string (Only when in checklist mode)
    // This now writes internal content state.
    //
    // Only after the user has changed an item: filling checklistItems when a note
    // opens must not rewrite its content (that used to drop every line that
    // wasn't an item, and made untouched notes look edited).
    useEffect(() => {
        if (!isChecklistMode || !isOpen || isClosingRef.current) return;
        if (!itemsEditedRef.current) return;
        const newContent = serializeChecklist(checklistItems, leadingLinesRef.current);
        if (newContent !== content) {
            setContent(newContent);
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


    // Stray (non-item) text in a list note counts as content.
    const hasStrayText = (items: ChecklistItem[], leading: string[]) =>
        leading.some(line => line.trim() !== "") ||
        items.some(item => (item.trailing ?? []).some(line => line.trim() !== ""));

    const tagsFromText = (text: string) => text.split(",").map((tag) => tag.trim()).filter(Boolean);
    const currentTags = (): string[] =>
        initialNote && tags === initialTagsTextRef.current ? (initialNote.tags || []) : tagsFromText(tags);

    // Helper: is the note empty?
    const isNoteEmpty = () => {
        if (title.trim() !== "") return false;
        if (images.length > 0) return false;
        if (isChecklistMode) {
            // Empty list = no items, or every item has blank content
            return checklistItems.every(item => item.content.trim() === "") &&
                !hasStrayText(checklistItems, leadingLinesRef.current);
        }
        const plainText = content.replace(/<[^>]+>/g, '').trim();
        return plainText === "";
    };

    /**
     * Checks whether the current editor state has actually diverged from the snapshot
     * taken when the note was opened. If false, no user edit has occurred.
     *
     * Accepts the same field overrides buildNoteFromState does (e.g. a just-toggled
     * isArchived/isPinned) so a caller that flips a value and immediately builds/saves
     * a note in the same tick isn't compared against its own stale closure state --
     * setIsArchived(!isArchived) hasn't re-rendered yet when this runs.
     */
    const isNoteDirty = (overrides?: Partial<Note>): boolean => {
        if (!initialNote || baselineNoteSnapshotRef.current === null) {
            // New note has no baseline
            return true;
        }

        const currentSnapshot = makeNoteSnapshot({
            title: overrides?.title !== undefined ? overrides.title : title,
            content: overrides?.content !== undefined ? overrides.content : content,
            type: isChecklistMode ? 'list' : 'text',
            tags: overrides?.tags !== undefined ? overrides.tags : currentTags(),
            isPinned: overrides?.isPinned !== undefined ? overrides.isPinned : isPinned,
            isArchived: overrides?.isArchived !== undefined ? overrides.isArchived : isArchived,
            images: overrides?.images !== undefined ? overrides.images : images,
            color: overrides?.color !== undefined ? overrides.color : color,
            reminder: overrides?.reminder !== undefined ? overrides.reminder : reminder,
            recurrence: overrides?.recurrence !== undefined ? overrides.recurrence : recurrence,
        });

        return currentSnapshot !== baselineNoteSnapshotRef.current;
    };

    /**
     * Single source of truth for turning editor state into a Note.
     *
     * This was previously four hand-written object literals, which is how
     * `type` came to be dropped on the archive path -- invisible in the UI
     * because NoteCard sniffs the content for checkboxes, but real for a list
     * note whose items have all been emptied, where `type` is the only thing
     * carrying its list-ness. Every save path goes through here now, so a new
     * Note field cannot be half-added.
     *
     * Colour is deliberately NOT part of isNoteEmpty(): a note that has only a
     * colour set and no title or body is still discarded on close.
     */
    const buildNoteFromState = (overrides?: Partial<Note>): Note => {
        const dirty = isNoteDirty(overrides);
        const effectiveUpdatedAt = dirty
            ? Date.now()
            : (lastSavedUpdatedAtRef.current || initialNote?.updatedAt || Date.now());

        return {
            id: noteIdRef.current,
            title,
            content,
            type: isChecklistMode ? 'list' : 'text',
            tags: currentTags(),
            isPinned,
            isArchived,
            createdAt: initialNote?.createdAt || Date.now(),
            updatedAt: effectiveUpdatedAt,
            images,
            color: normalizeNoteColor(color),
            reminder,
            recurrence,
            ...overrides,
        };
    };

    // Saves from the editor's own autosave/close paths, then moves the baseline
    // to what was saved (see lastSavedUpdatedAtRef).
    const saveFromEditor = (note: Note) => {
        // The editor is view-only for a note in the Bin. buildNoteFromState doesn't
        // carry isDeleted/deletedAt, so any save from here would silently restore it
        // and sync that restore everywhere (C2-25).
        if (isDeleted) return;
        onSave(note);
        baselineNoteSnapshotRef.current = makeNoteSnapshot(note);
        lastSavedUpdatedAtRef.current = note.updatedAt;
    };

    // Auto-save logic
    useEffect(() => {
        if (!isOpen) {
            if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
            return;
        }
        if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;

        // Don't save if completely empty
        const plainText = content.replace(/<[^>]+>/g, '').trim();
        const checklistEmpty = isChecklistMode &&
            checklistItems.every(item => item.content.trim() === "") &&
            !hasStrayText(checklistItems, leadingLinesRef.current);
        if (title.trim() === "" && plainText === "" && images.length === 0) {
            return;
        }
        if (isChecklistMode && checklistEmpty && title.trim() === "") {
            return;
        }

        // Don't auto-save if an existing note hasn't actually been modified
        if (!isNoteDirty()) {
            return;
        }

        saveTimeoutRef.current = setTimeout(() => {
            saveTimeoutRef.current = null;
            saveFromEditor(buildNoteFromState());
        }, 500);

        return () => {
            if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [title, content, tags, isPinned, isArchived, images, color, reminder, recurrence]);

    // Runs a pending autosave now instead of in up to 500ms. Called as the app goes
    // to the background: Android may kill it there, and App Lock unmounts the editor
    // on the way back (C3-27). Either would drop the last edit.
    const flushPendingSaveRef = useRef<() => void>(() => { });
    // eslint-disable-next-line react-hooks/refs -- latest-value ref: the listener below must save the current state
    flushPendingSaveRef.current = () => {
        if (!isOpen || saveTimeoutRef.current === null) return;
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
        saveFromEditor(buildNoteFromState());
    };

    useEffect(() => {
        if (!Capacitor.isNativePlatform()) return;
        const listenerPromise = CapacitorApp.addListener('appStateChange', ({ isActive }) => {
            if (!isActive) flushPendingSaveRef.current();
        });
        return () => {
            listenerPromise.then((listener) => listener.remove());
        };
    }, []);

    // Toggle Mode Logic
    const handleToggleMode = () => {
        if (isChecklistMode) {
            // List -> Text
            // Convert list to text, then wrap lines in <p> for Tiptap to respect newlines.
            // Item text is plain, so it's escaped: "Buy <milk>" must not be read as a tag (C2-30).
            const plainText = convertListToText(content);
            const htmlContent = plainTextToHtml(plainText);

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
            // Pre-process HTML so newlines are preserved, then read its text.
            let textContent = content;

            if (content.includes('<')) {
                const tempHtml = content
                    .replace(/<\/p>/gi, '\n') // End of paragraph = newline
                    .replace(/<br\s*\/?>/gi, '\n') // Break tag = newline
                    .replace(/<\/div>/gi, '\n'); // End of div = newline

                // Parsed in an inert document, not a div's innerHTML: `content` is the
                // stored note, which can come from a cloud file or an import, and a
                // detached div still loads <img> and runs its onerror (C2-24).
                textContent = new DOMParser().parseFromString(tempHtml, 'text/html').body.textContent || "";
            }

            const newContent = convertTextToList(textContent);
            setContent(newContent);
            setIsChecklistMode(true);
            setShowFormatting(false);

            // Hydrate checklist items for UI
            const { items, leading } = parseChecklist(newContent);
            leadingLinesRef.current = leading;
            updateItems(items.map(i => ({ ...i, id: safeRandomUUID() })));
        }
    };

    // DnD Sensors
    const sensors = useSensors(
        useSensor(PointerSensor),
        useSensor(KeyboardSensor)
    );

    // Ticked items are shown at the bottom, but they stay in place in the
    // stored list: which item a sub-item belongs to is worked out from its
    // position, so nothing here may reorder items just because of a tick.
    // See groupChecklistForDisplay in utils/markdown.ts.
    const visibleItemsInSection = (items: ChecklistItem[], checked: boolean): ChecklistItem[] => {
        const display = groupChecklistForDisplay(items);
        return (checked ? display.checked : display.unchecked)
            .flatMap((row: ChecklistDisplayRow) => (row.kind === 'item' ? [row.item] : []));
    };

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over, delta } = event;
        const activeId = active.id as string;

        // A mostly sideways drag indents or outdents, and anything else is a
        // move and only a move: sideways drift on a long drag must not also
        // nest the item under whatever was above its old position (C2-28).
        // The sideways case ignores `over`, because closestCenter often
        // reports the row above as `over` (sub-item rows sit further right).
        if (Math.abs(delta.x) > 40 && Math.abs(delta.x) > Math.abs(delta.y)) {
            if (delta.x > 0) {
                handleIndent(activeId);
            } else {
                handleOutdent(activeId);
            }
            return;
        }

        if (over && activeId !== over.id) {
            const overId = over.id as string;
            const visibleIds = visibleItemsInSection(checklistItems, false).map(i => i.id);
            const movingDown = visibleIds.indexOf(activeId) < visibleIds.indexOf(overId);
            updateItems(items => moveChecklistItem(items, activeId, overId, movingDown));
        }
    };

    const handleIndent = (id: string) => {
        const item = checklistItems.find(i => i.id === id);
        if (!item) return;
        // Nest under the item shown directly above, not whatever hidden
        // (ticked) item happens to be above it in the stored list.
        const section = visibleItemsInSection(checklistItems, item.checked);
        const pos = section.findIndex(i => i.id === id);
        const aboveId = pos > 0 ? section[pos - 1].id : null;
        updateItems(prev => indentChecklistItem(prev, id, aboveId));
    };

    const handleOutdent = (id: string) => {
        updateItems(prev => outdentChecklistItem(prev, id));
    };

    // Indentation for an item inserted directly after `index`: a new item
    // placed between a top-level item and its sub-items becomes its first
    // sub-item, instead of taking those sub-items over.
    const indentationForInsertAfter = (items: ChecklistItem[], index: number): string => {
        const current = items[index];
        if (isTopLevel(current) && groupEnd(items, index) > index + 1) return CHECKLIST_INDENT;
        return current.indentation;
    };

    const handleInsertItemAfter = (currentId: string, cursorPosition?: number) => {
        if (checklistItems.length >= LIST_ITEMS_MAX) {
            toast.error(`Maximum ${LIST_ITEMS_MAX} items per checklist`);
            return;
        }
        const index = checklistItems.findIndex(i => i.id === currentId);
        if (index === -1) return;

        const currentItem = checklistItems[index];

        // If cursor is at index 0 (at the very beginning of the item), insert a blank item BEFORE
        // and keep focus and cursor at index 0 of current item.
        if (cursorPosition === 0) {
            const newItem: ChecklistItem = {
                id: safeRandomUUID(),
                content: "",
                checked: false,
                indentation: currentItem.indentation
            };

            const newItems = [...checklistItems];
            newItems.splice(index, 0, newItem);
            updateItems(newItems);
            setTimeout(() => {
                const el = document.getElementById(`list-item-${currentItem.id}`) as HTMLTextAreaElement;
                if (el) {
                    el.focus();
                    el.setSelectionRange(0, 0);
                }
            }, 0);
            return;
        }

        // If cursor is in the middle of text, split the item at the cursor
        if (cursorPosition !== undefined && cursorPosition < currentItem.content.length) {
            const beforeText = currentItem.content.slice(0, cursorPosition);
            const afterText = currentItem.content.slice(cursorPosition);

            const newItem: ChecklistItem = {
                id: safeRandomUUID(),
                content: afterText,
                checked: false,
                indentation: indentationForInsertAfter(checklistItems, index),
                // Lines stored after the item stay after its second half.
                trailing: currentItem.trailing,
            };

            const newItems = [...checklistItems];
            newItems[index] = { ...currentItem, content: beforeText, trailing: [] };
            newItems.splice(index + 1, 0, newItem);
            updateItems(newItems);
            setFocusItemId(newItem.id);
            setTimeout(() => {
                const el = document.getElementById(`list-item-${newItem.id}`) as HTMLTextAreaElement;
                if (el) {
                    el.focus();
                    el.setSelectionRange(0, 0);
                }
            }, 0);
            return;
        }

        const newItem: ChecklistItem = {
            id: safeRandomUUID(),
            content: "",
            checked: false,
            indentation: indentationForInsertAfter(checklistItems, index)
        };

        const newItems = [...checklistItems];
        newItems.splice(index + 1, 0, newItem);
        updateItems(newItems);
        setFocusItemId(newItem.id);
    };

    // Text containing line breaks (a paste, or a keyboard inserting a line
    // break): the first line stays in the item, every other non-blank line
    // becomes a new item right after it.
    const handleMultilineItemText = (id: string, fullText: string, caret: number) => {
        const index = checklistItems.findIndex(i => i.id === id);
        if (index === -1) return;
        const current = checklistItems[index];
        const { lines, caretLine, caretOffset } = splitMultilineItemText(fullText, caret);

        let extra = lines.slice(1);
        const room = Math.max(0, LIST_ITEMS_MAX - checklistItems.length);
        if (extra.length > room) {
            extra = extra.slice(0, room);
            toast.error(`Maximum ${LIST_ITEMS_MAX} items per checklist`);
        }
        let clipped = false;
        const clip = (text: string) => {
            if (text.length <= LIST_ITEM_MAX) return text;
            clipped = true;
            return text.slice(0, LIST_ITEM_MAX);
        };

        const indentation = indentationForInsertAfter(checklistItems, index);
        const newItems: ChecklistItem[] = extra.map(text => ({
            id: safeRandomUUID(),
            content: clip(text),
            checked: current.checked,
            indentation,
        }));
        const updatedCurrent: ChecklistItem = {
            ...current,
            content: clip(lines[0]),
            trailing: newItems.length > 0 ? [] : current.trailing,
        };
        if (newItems.length > 0) newItems[newItems.length - 1].trailing = current.trailing;
        if (clipped) toast.error(`Maximum ${LIST_ITEM_MAX} characters per item`);

        updateItems([
            ...checklistItems.slice(0, index),
            updatedCurrent,
            ...newItems,
            ...checklistItems.slice(index + 1),
        ]);

        const targetLine = Math.min(caretLine, newItems.length);
        const target = targetLine === 0 ? updatedCurrent : newItems[targetLine - 1];
        const offset = targetLine === caretLine ? Math.min(caretOffset, target.content.length) : target.content.length;
        if (target.id !== id) setFocusItemId(target.id);
        setTimeout(() => {
            const el = document.getElementById(`list-item-${target.id}`) as HTMLTextAreaElement | null;
            if (el) {
                el.focus();
                el.setSelectionRange(offset, offset);
            }
        }, 0);
    };

    const handleBackspaceItem = (id: string, cursorPosition?: number, currentContent?: string) => {
        const item = checklistItems.find(i => i.id === id);
        if (!item) return;
        // "Previous" means the item shown directly above in the same section,
        // never a hidden ticked item that sits in between in the stored list.
        const section = visibleItemsInSection(checklistItems, item.checked);
        const pos = section.findIndex(i => i.id === id);
        if (pos <= 0) return;
        const previousItem = section[pos - 1];
        const textToMerge = currentContent !== undefined ? currentContent : item.content;

        // If the item has text and cursor is at position 0, merge it into the previous item
        if (cursorPosition === 0 && textToMerge.length > 0) {
            const combinedContent = previousItem.content + textToMerge;
            if (combinedContent.length > LIST_ITEM_MAX) {
                toast.error(`Maximum ${LIST_ITEM_MAX} characters per item`);
                return;
            }
            const mergePos = previousItem.content.length;
            const removed = removeChecklistItems(checklistItems, leadingLinesRef.current, new Set([id]));
            leadingLinesRef.current = removed.leading;
            updateItems(removed.items.map(i => i.id === previousItem.id ? { ...i, content: combinedContent } : i));
            setFocusItemId(previousItem.id);
            setTimeout(() => {
                const el = document.getElementById(`list-item-${previousItem.id}`) as HTMLTextAreaElement;
                if (el) {
                    el.focus();
                    el.setSelectionRange(mergePos, mergePos);
                }
            }, 0);
            return;
        }

        // Normal backspace when item is empty. If it was a top-level item with
        // sub-items, those become top-level rather than silently joining
        // the item above.
        let base = checklistItems;
        if (isTopLevel(item)) {
            const idx = base.findIndex(i => i.id === id);
            const end = groupEnd(base, idx);
            base = base.map((it, i) => (i > idx && i < end ? { ...it, indentation: "" } : it));
        }
        const removed = removeChecklistItems(base, leadingLinesRef.current, new Set([id]));
        leadingLinesRef.current = removed.leading;
        setFocusItemId(previousItem.id);
        updateItems(removed.items);
        setTimeout(() => {
            const el = document.getElementById(`list-item-${previousItem.id}`) as HTMLTextAreaElement;
            if (el) {
                el.focus();
                el.setSelectionRange(el.value.length, el.value.length);
            }
        }, 0);
    };

    const handleAddItem = () => {
        if (checklistItems.length >= LIST_ITEMS_MAX) {
            toast.error(`Maximum ${LIST_ITEMS_MAX} items per checklist`);
            return;
        }
        if (newItemContent.trim()) {
            const newItem = {
                id: safeRandomUUID(),
                content: newItemContent.trim(),
                checked: false,
                indentation: ""
            };
            updateItems(prev => [...prev, newItem]);
            setNewItemContent("");
            setFocusItemId(null);
        }
    };

    // Typing (or pasting) into the "List item" box at the bottom.
    const handleNewItemBoxChange = (value: string) => {
        if (!value) {
            setNewItemContent("");
            return;
        }
        const lines = /[\r\n]/.test(value)
            ? value.split(/\r\n|\r|\n/).filter(line => line.trim() !== "")
            : [value];
        if (lines.length === 0) {
            setNewItemContent("");
            return;
        }
        const room = Math.max(0, LIST_ITEMS_MAX - checklistItems.length);
        if (lines.length > room) toast.error(`Maximum ${LIST_ITEMS_MAX} items per checklist`);
        const newItems: ChecklistItem[] = lines.slice(0, room).map(text => ({
            id: safeRandomUUID(),
            content: text.slice(0, LIST_ITEM_MAX),
            checked: false,
            indentation: "",
        }));
        setNewItemContent("");
        if (newItems.length === 0) return;
        updateItems(prev => [...prev, ...newItems]);
        setFocusItemId(newItems[newItems.length - 1].id);
    };

    const handleRemoveItem = (id: string) => {
        const baseLeading = leadingLinesRef.current;
        updateItems(prev => {
            const index = prev.findIndex(i => i.id === id);
            if (index === -1) return prev;

            const item = prev[index];
            const idsToRemove = new Set([id]);

            // A top-level item takes its sub-items with it (ticked ones too:
            // they stay next to it in the stored list).
            if (isTopLevel(item)) {
                const end = groupEnd(prev, index);
                for (let i = index + 1; i < end; i++) idsToRemove.add(prev[i].id);
            }

            // Computed from baseLeading, not the ref, so this updater stays
            // pure if React calls it twice.
            const removed = removeChecklistItems(prev, baseLeading, idsToRemove);
            leadingLinesRef.current = removed.leading;
            return removed.items;
        });
    };

    const handleUpdateItem = (id: string, newText: string) => {
        updateItems(prev => prev.map(i => i.id === id ? { ...i, content: newText } : i));
    };

    const handleToggleItem = (id: string) => {
        captureChecklistLayout();
        updateItems(prev => {
            const itemIndex = prev.findIndex(i => i.id === id);
            if (itemIndex === -1) return prev;

            const item = prev[itemIndex];
            const isChecked = !item.checked;

            // Ticking or unticking a top-level item does the same to its
            // sub-items. A sub-item never changes its parent's tick.
            const itemsToToggle = new Set([id]);
            if (isTopLevel(item)) {
                const end = groupEnd(prev, itemIndex);
                for (let i = itemIndex + 1; i < end; i++) itemsToToggle.add(prev[i].id);
            }

            // Toggled in place — no re-sort (see visibleItemsInSection).
            return prev.map(i =>
                itemsToToggle.has(i.id) ? { ...i, checked: isChecked, marker: undefined } : i
            );
        });
    };

    // "Make item" on a stray line: it becomes an unticked item in the same place.
    const handleConvertStrayLine = (ownerId: string | null, lineIndex: number) => {
        if (checklistItems.length >= LIST_ITEMS_MAX) {
            toast.error(`Maximum ${LIST_ITEMS_MAX} items per checklist`);
            return;
        }
        const ownerIndex = ownerId === null ? -1 : checklistItems.findIndex(i => i.id === ownerId);
        if (ownerId !== null && ownerIndex === -1) return;
        const lines = ownerId === null ? leadingLinesRef.current : (checklistItems[ownerIndex].trailing ?? []);
        const text = lines[lineIndex];
        if (text === undefined) return;

        const newItem: ChecklistItem = {
            id: safeRandomUUID(),
            content: text.trim().slice(0, LIST_ITEM_MAX),
            checked: false,
            indentation: ownerId === null ? "" : indentationForInsertAfter(checklistItems, ownerIndex),
            trailing: lines.slice(lineIndex + 1),
        };
        const before = lines.slice(0, lineIndex);

        if (ownerId === null) {
            leadingLinesRef.current = before;
            updateItems([newItem, ...checklistItems]);
        } else {
            const owner = checklistItems[ownerIndex];
            updateItems([
                ...checklistItems.slice(0, ownerIndex),
                { ...owner, trailing: before },
                newItem,
                ...checklistItems.slice(ownerIndex + 1),
            ]);
        }
        setFocusItemId(newItem.id);
    };

    const renderStrayLines = (ownerId: string | null, lines: string[] | undefined, indented: boolean) =>
        (lines ?? []).map((text, lineIndex) =>
            text.trim() === "" ? null : (
                <StrayLineRow
                    key={`stray-${ownerId ?? 'top'}-${lineIndex}`}
                    flipId={`stray-${ownerId ?? 'top'}-${lineIndex}`}
                    text={text}
                    indented={indented}
                    disabled={isDeleted}
                    onConvert={() => handleConvertStrayLine(ownerId, lineIndex)}
                />
            )
        );

    const handleCloseEditor = () => {
        // Lock effects so nothing resets isChecklistMode during the close animation
        isClosingRef.current = true;

        // Clear any pending auto-save to prevent race conditions
        if (saveTimeoutRef.current) {
            clearTimeout(saveTimeoutRef.current);
        }

        let currentChecklistItems = checklistItems;
        let currentContent = content;

        let currentLeading = leadingLinesRef.current;

        if (isChecklistMode) {
            const untickedItems = currentChecklistItems.filter(i => !i.checked);
            if (untickedItems.length > 0) {
                const lastUnticked = untickedItems[untickedItems.length - 1];
                // Tidy away a trailing empty item only when the note is being
                // saved anyway — closing an untouched note must not change it.
                if (lastUnticked.content.trim() === "" && (!initialNote || isNoteDirty())) {
                    const removed = removeChecklistItems(currentChecklistItems, currentLeading, new Set([lastUnticked.id]));
                    currentChecklistItems = removed.items;
                    currentLeading = removed.leading;
                    // Don't call setChecklistItems here — we're closing the dialog and only need
                    // the local variable for the save/delete decision. A state update here would
                    // trigger a re-render before onClose(), causing the checklist sync effect to
                    // run and potentially flick the UI to text mode during the close animation.
                    currentContent = serializeChecklist(currentChecklistItems, currentLeading);
                }
            }
        }

        const plainText = currentContent.replace(/<[^>]+>/g, '').trim();
        const checklistIsEmpty = isChecklistMode &&
            currentChecklistItems.every(item => item.content.trim() === "") &&
            !hasStrayText(currentChecklistItems, currentLeading);

        // Cleanup empty note if needed (but save if it has images)
        if (title.trim() === "" && images.length === 0 && (plainText === "" || checklistIsEmpty)) {
            onDelete(noteIdRef.current);
        } else if (!initialNote || isNoteDirty({ content: currentContent })) {
            // Save if it's a new note or if actual changes were made
            saveFromEditor(buildNoteFromState({ content: currentContent }));
        }
        onClose();
    };
    // eslint-disable-next-line react-hooks/refs -- latest-value ref: keeps stable callbacks pointed at the current close handler
    handleCloseEditorRef.current = handleCloseEditor;

    // Loaded (or failed) images only; ones still decrypting appear when ready.
    const shownImages = images.filter((path) => imageSrcs[path] !== undefined);

    const removeImage = async (path: string) => {
        await deleteImage(path);
        setImages(prev => prev.filter(p => p !== path));
        setImageSrcs(prev => {
            const next = { ...prev };
            delete next[path];
            return next;
        });
    };

    const checklistDisplay = groupChecklistForDisplay(checklistItems);
    const checkedItemCount = checklistDisplay.checked.filter(row => row.kind === 'item').length;

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

        // Export the same self-describing format the bulk exports use, so a
        // re-import restores tags, pin/archive state and timestamps.
        const exportData = serializeNoteToMarkdown(buildNoteFromState());

        if (Capacitor.isNativePlatform()) {
            try {
                const result = await Filesystem.writeFile({
                    path: filename,
                    data: exportData,
                    directory: Directory.Cache,
                    encoding: Encoding.UTF8,
                });

                await Share.share({
                    title: 'Export Note',
                    text: 'Exporting note',
                    url: result.uri,
                    dialogTitle: 'Export Note'
                });

                toast.success(`Note exported`);

            } catch (error) {
                console.error("Error exporting note:", error);
                toast.error("Failed to export note");
            }
        } else {
            // Web fallback
            const blob = new Blob([exportData], { type: "text/markdown" });
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

    const handleArchiveToggle = () => {
        const newState = !isArchived;
        setIsArchived(newState);

        if (saveTimeoutRef.current) {
            clearTimeout(saveTimeoutRef.current);
        }

        // isNoteEmpty counts images and checklist items, so a photo-only note is
        // archived rather than binned (C2-29).
        if (isNoteEmpty()) {
            onDelete(noteIdRef.current);
        } else {
            const savedNote = buildNoteFromState({ isArchived: newState });
            saveFromEditor(savedNote);
            if (newState) {
                showSuccess("Note archived", {
                    action: {
                        label: "Undo",
                        onClick: async () => {
                            const unarchivedNote = {
                                ...savedNote,
                                isArchived: false,
                                updatedAt: Date.now()
                            };
                            await onSave(unarchivedNote);
                        }
                    }
                });
            } else {
                showSuccess("Note unarchived", {
                    action: {
                        label: "Undo",
                        onClick: async () => {
                            const rearchivedNote = {
                                ...savedNote,
                                isArchived: true,
                                updatedAt: Date.now()
                            };
                            await onSave(rearchivedNote);
                        }
                    }
                });
            }
        }
        onClose();
    };

    // Formatting sub-buttons (B/I/U). Rendered inline next to T on desktop,
    // and in a dedicated row above the footer on mobile (narrow screens
    // can't fit nine icon buttons in one row).
    const canFormat = showFormatting && !!editor && !isChecklistMode;
    const formattingButtons = editor ? (
        <>
            <Tooltip>
                <TooltipTrigger asChild>
                    <Button
                        variant="ghost"
                        size="icon"
                        className={`text-secondary ${editor.isActive('bold') ? 'bg-brand-container text-brand-container-foreground' : ''}`}
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
                        className={`text-secondary ${editor.isActive('italic') ? 'bg-brand-container text-brand-container-foreground' : ''}`}
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
                        className={`text-secondary ${editor.isActive('underline') ? 'bg-brand-container text-brand-container-foreground' : ''}`}
                        onClick={() => editor.chain().focus().toggleUnderline().run()}
                    >
                        <Underline className="h-4 w-4" />
                        <span className="sr-only">Underline</span>
                    </Button>
                </TooltipTrigger>
                <TooltipContent><p>Underline</p></TooltipContent>
            </Tooltip>
        </>
    ) : null;

    return (
        <>
            {fullscreenImageSrc && createPortal(
                <div
                    ref={fullscreenOverlayRef}
                    className="fixed inset-0 z-[100] bg-scrim/90 flex items-center justify-center cursor-zoom-out p-4 pointer-events-auto"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                        // Stop the native event before it reaches document, so the
                        // Radix dialog underneath doesn't treat this as an outside
                        // press and close the whole editor (same as the X button).
                        e.stopPropagation();
                        setFullscreenImageSrc(null);
                    }}
                >
                    <button
                        className="absolute top-4 right-4 bg-scrim/50 hover:bg-scrim/70 rounded-full p-2 text-on-scrim transition-colors z-10"
                        onClick={(e) => {
                            e.stopPropagation();
                            setFullscreenImageSrc(null);
                        }}
                    >
                        <X className="h-6 w-6" />
                        <span className="sr-only">Close</span>
                    </button>
                    <img src={fullscreenImageSrc} alt="" className="max-w-full max-h-full object-contain" />
                </div>,
                document.body
            )}

            <Dialog open={isOpen} onOpenChange={(open) => !open && handleCloseEditor()}>
                <DialogContent
                    className={cn("note-editor-dialog", isNoteTinted(color) && "note-tinted", "fixed inset-0 translate-x-0 translate-y-0 left-0 top-0 w-full h-full max-w-none rounded-none sm:left-[50%] sm:top-[50%] sm:bottom-auto sm:translate-x-[-50%] sm:translate-y-[-50%] sm:w-full sm:max-w-[425px] sm:h-auto sm:max-h-[90vh] md:max-w-[600px] lg:max-w-[800px] sm:rounded-dialog flex flex-col p-0 gap-0 bg-note-editor-background dark:bg-note-editor-background text-foreground pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] sm:pb-0 outline-none focus:outline-none focus-visible:ring-0 focus-visible:outline-none border-0 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 origin-center data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95 data-[state=open]:duration-md3-medium2 data-[state=closed]:duration-md3-short4 data-[state=open]:ease-md3-decelerate data-[state=closed]:ease-md3-accelerate",
                        // 350ms delay = MORPH_MS in lib/container-transform.ts
                        morph && "data-[state=open]:[animation:md3-fade-in_150ms_linear_350ms_backwards] data-[state=closed]:[animation:md3-fade-out_100ms_linear_forwards]")}
                    style={{
                        ...(isMobile ? {
                            '--tw-enter-translate-x': '0',
                            '--tw-enter-translate-y': '0',
                            '--tw-exit-translate-x': '0',
                            '--tw-exit-translate-y': '0'
                        } : {}),
                        ...getNoteTintVars(color),
                    } as React.CSSProperties}
                    onOpenAutoFocus={(e) => e.preventDefault()}
                >
                    <DialogTitle className="sr-only">Edit Note</DialogTitle>
                    <DialogDescription className="sr-only">Note editor modal</DialogDescription>

                    {/* Header */}
                    <div className="flex justify-between items-center p-2 border-b border-border shrink-0">
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
                                        disabled={isDeleted}
                                        onClick={() => setIsPinned(!isPinned)}
                                        className={isPinned ? "text-highlight" : "text-secondary"}
                                    >
                                        <Pin className={`h-5 w-5 ${isPinned ? "fill-highlight" : ""}`} />
                                        <span className="sr-only">{isPinned ? "Unpin" : "Pin"}</span>
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent><p>{isPinned ? "Unpin" : "Pin"}</p></TooltipContent>
                            </Tooltip>

                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button
                                        id="reminder-bell-button"
                                        variant="ghost"
                                        size="icon"
                                        disabled={isDeleted}
                                        onClick={() => setIsReminderSheetOpen(true)}
                                        className={reminder ? "text-highlight" : "text-secondary"}
                                    >
                                        <Bell className={`h-5 w-5 ${reminder ? "fill-highlight" : ""}`} />
                                        <span className="sr-only">{reminder ? "Edit reminder" : "Set reminder"}</span>
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent><p>{reminder ? "Edit reminder" : "Set reminder"}</p></TooltipContent>
                            </Tooltip>

                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        disabled={isDeleted}
                                        onClick={handleArchiveToggle}
                                        className={isArchived ? "text-highlight" : "text-secondary"}
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
                    <div
                        className="flex-auto overflow-y-auto min-h-0 p-4 cursor-text"
                        onClick={(e) => {
                            if (e.target === e.currentTarget && !isChecklistMode && editor) {
                                editor.chain().focus('end').run();
                            }
                        }}
                    >
                        {/* Hidden file input */}
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={async (e) => {
                                const file = e.target.files?.[0];
                                if (!file) return;
                                if (images.length >= 5) {
                                    toast.error('Maximum 5 images per note');
                                    return;
                                }
                                try {
                                    const path = await saveImage(file);
                                    const src = await getImageSrc(path);
                                    setImages(prev => [...prev, path]);
                                    setImageSrcs(prev => ({ ...prev, [path]: src }));
                                } catch (err) {
                                    toast.error('Failed to add image');
                                }
                                e.target.value = '';
                            }}
                        />

                        {/* Image strip */}
                        {shownImages.length === 1 && shownImages.map((path) => (
                            <div key={path} className="relative w-full mb-4 rounded-lg overflow-hidden border border-border max-h-64 sm:max-h-96 cursor-zoom-in" onClick={() => imageSrcs[path] && setFullscreenImageSrc(imageSrcs[path])}>
                                {imageSrcs[path] ? (
                                    <img src={imageSrcs[path]} alt="" className="w-full h-full object-contain bg-note-editor-background dark:bg-note-editor-background" />
                                ) : (
                                    // Unreadable (missing or undecryptable). Still shown, so it can be removed.
                                    <div className="w-full h-32 flex items-center justify-center bg-muted text-muted-foreground" role="img" aria-label="Image unavailable">
                                        <ImageIcon className="h-8 w-8" />
                                    </div>
                                )}
                                {!isDeleted && (
                                    <button
                                        onClick={async (e) => {
                                            e.stopPropagation();
                                            await removeImage(path);
                                        }}
                                        aria-label="Remove image"
                                        className="group/remove absolute top-0 right-0 h-12 w-12 flex items-start justify-end p-2"
                                    >
                                        <span className="bg-scrim/50 group-hover/remove:bg-scrim/70 rounded-full p-1.5 text-on-scrim transition-colors">
                                            <X className="h-5 w-5" />
                                        </span>
                                    </button>
                                )}
                            </div>
                        ))}

                        {shownImages.length > 1 && (
                            <div className="flex gap-2 overflow-x-auto mb-4 -mx-4 px-4 pb-2">
                                {shownImages.map((path) => (
                                    <div key={path} className="relative flex-shrink-0 w-40 h-32 rounded-lg overflow-hidden border border-border cursor-zoom-in" onClick={() => imageSrcs[path] && setFullscreenImageSrc(imageSrcs[path])}>
                                        {imageSrcs[path] ? (
                                            <img src={imageSrcs[path]} alt="" className="w-full h-full object-cover" />
                                        ) : (
                                            <div className="w-full h-full flex items-center justify-center bg-muted text-muted-foreground" role="img" aria-label="Image unavailable">
                                                <ImageIcon className="h-6 w-6" />
                                            </div>
                                        )}
                                        {!isDeleted && (
                                            <button
                                                onClick={async (e) => {
                                                    e.stopPropagation();
                                                    await removeImage(path);
                                                }}
                                                aria-label="Remove image"
                                                className="group/remove absolute top-0 right-0 h-12 w-12 flex items-start justify-end p-1"
                                            >
                                                <span className="bg-scrim/50 group-hover/remove:bg-scrim/70 rounded-full p-1 text-on-scrim transition-colors">
                                                    <X className="h-4 w-4" />
                                                </span>
                                            </button>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Title */}
                        <LinkHighlightedTextarea
                            id="title"
                            ref={titleTextareaRef}
                            value={title}
                            maxLength={TITLE_MAX}
                            onChange={(e) => {
                                setTitle(e.target.value);
                                adjustTitleHeight();
                            }}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                    e.preventDefault();
                                    if (isChecklistMode) {
                                        const bodyTextareas = document.querySelectorAll<HTMLTextAreaElement>('div[role="dialog"] textarea:not(#title)');
                                        if (bodyTextareas.length > 0) {
                                            const target = bodyTextareas[0];
                                            target.focus();
                                            target.setSelectionRange(target.value.length, target.value.length);
                                        }
                                    } else if (editor) {
                                        editor.commands.focus();
                                    }
                                }
                            }}
                            rows={1}
                            readOnly={isDeleted}
                            className="w-full bg-transparent text-foreground border-0 focus:outline-none text-xl font-semibold px-0 mb-2 placeholder:text-muted-foreground resize-none overflow-hidden h-auto"
                            placeholder="Title"
                        />

                        {/* Reminder chip */}
                        {reminder && (
                            <button
                                id="reminder-chip"
                                className="press-feedback inline-flex items-center gap-1.5 mb-3 text-xs font-medium px-2.5 py-1 rounded-full bg-warning-container text-warning-container-foreground hover:bg-warning-container/80 transition-colors"
                                onClick={() => setIsReminderSheetOpen(true)}
                                disabled={isDeleted}
                            >
                                <Bell className="h-3 w-3" />
                                {formatReminderLabel(reminder)}
                            </button>
                        )}

                        {/* Editor Content */}
                        {isChecklistMode ? (
                            <div ref={checklistRef} className="flex flex-col -mx-4">
                                {/* -mx-4 cancels the body's side padding so each row's
                                    48px grip and remove buttons sit at the edges; their
                                    icons then line up with the title. The add row, checked
                                    header and tag chips add it back so they stay put. */}
                                <DndContext
                                    sensors={sensors}
                                    collisionDetection={closestCenter}
                                    onDragEnd={handleDragEnd}
                                >
                                    <SortableContext
                                        items={checklistDisplay.unchecked.flatMap(row => row.kind === 'item' ? [row.item.id] : [])}
                                        strategy={verticalListSortingStrategy}
                                    >
                                        {/* eslint-disable-next-line react-hooks/refs -- leading stray lines are kept in a ref alongside checklist state, which re-renders on change */}
                                        {renderStrayLines(null, leadingLinesRef.current, false)}
                                        {checklistDisplay.unchecked.map((row) => row.kind === 'parent' ? (
                                            <ParentHeaderRow key={`parent-${row.item.id}`} item={row.item} />
                                        ) : (
                                            <React.Fragment key={row.item.id}>
                                                <SortableListItem
                                                    item={row.item}
                                                    displayIndented={row.indented}
                                                    onUpdateItem={handleUpdateItem}
                                                    onRemoveItem={handleRemoveItem}
                                                    onToggleItem={handleToggleItem}
                                                    onEnter={handleInsertItemAfter}
                                                    onIndent={handleIndent}
                                                    onOutdent={handleOutdent}
                                                    onBackspace={handleBackspaceItem}
                                                    onMultilineText={handleMultilineItemText}
                                                    autoFocus={row.item.id === focusItemId}
                                                    disabled={isDeleted}
                                                />
                                                {renderStrayLines(row.item.id, row.item.trailing, row.indented)}
                                            </React.Fragment>
                                        ))}
                                    </SortableContext>
                                </DndContext>
                                <div data-flip-id="add-item" className="flex items-start gap-2 mt-2 ps-6 pe-4">
                                    <Plus className="h-4 w-4 text-muted-foreground mt-1.5" />
                                    <LinkHighlightedTextarea
                                        value={newItemContent}
                                        maxLength={LIST_ITEM_MAX}
                                        onChange={(e) => {
                                            handleNewItemBoxChange(e.target.value);
                                            e.target.style.height = 'auto';
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
                                            } else if (e.key === "Backspace" && e.currentTarget.value === "" && checklistItems.length > 0) {
                                                e.preventDefault();
                                                const visibleUnticked = visibleItemsInSection(checklistItems, false);
                                                const previousItem = visibleUnticked[visibleUnticked.length - 1];
                                                if (!previousItem) return;
                                                setFocusItemId(previousItem.id);
                                                setTimeout(() => {
                                                    const el = document.getElementById(`list-item-${previousItem.id}`) as HTMLTextAreaElement;
                                                    if (el) {
                                                        el.focus();
                                                        el.setSelectionRange(el.value.length, el.value.length);
                                                    }
                                                }, 0);
                                            }
                                        }}
                                        rows={1}
                                        readOnly={isDeleted}
                                        placeholder="List item"
                                        className="bg-transparent text-base text-foreground border-none focus:outline-none resize-none overflow-hidden min-h-[24px] flex-1 py-1"
                                    />
                                </div>
                                {checkedItemCount > 0 && (
                                    <div className="mt-4 flex flex-col gap-2">
                                        <Button
                                            data-flip-id="checked-header"
                                            variant="ghost"
                                            className="flex items-center gap-2 p-0 h-auto text-sm text-muted-foreground hover:bg-transparent hover:text-foreground transition-colors w-fit ps-6"
                                            onClick={() => setShowCheckedItems(!showCheckedItems)}
                                        >
                                            {showCheckedItems ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                            {checkedItemCount} checked {checkedItemCount === 1 ? 'item' : 'items'}
                                        </Button>

                                        {showCheckedItems && (
                                            <div className="flex flex-col">
                                                {checklistDisplay.checked.map((row) => row.kind === 'parent' ? (
                                                    <ParentHeaderRow key={`parent-${row.item.id}`} item={row.item} />
                                                ) : (
                                                    <React.Fragment key={row.item.id}>
                                                        <CheckedListItem
                                                            item={row.item}
                                                            displayIndented={row.indented}
                                                            onUpdateItem={handleUpdateItem}
                                                            onRemoveItem={handleRemoveItem}
                                                            onToggleItem={handleToggleItem}
                                                            onEnter={handleInsertItemAfter}
                                                            onIndent={handleIndent}
                                                            onOutdent={handleOutdent}
                                                            onBackspace={handleBackspaceItem}
                                                            onMultilineText={handleMultilineItemText}
                                                            autoFocus={row.item.id === focusItemId}
                                                            disabled={isDeleted}
                                                        />
                                                        {renderStrayLines(row.item.id, row.item.trailing, row.indented)}
                                                    </React.Fragment>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                )}
                                {/* Tag chips — below checklist content */}
                                {(() => {
                                    const tagList = tags.split(",").map(t => t.trim()).filter(Boolean);
                                    return tagList.length > 0 ? (
                                        <div className="mt-3 mx-4 flex flex-wrap gap-1.5" onClick={(e) => e.stopPropagation()}>
                                            {tagList.map((tag) => (
                                                <span
                                                    key={tag}
                                                    dir="auto"
                                                    className="px-2.5 py-1 text-xs rounded-full bg-background text-secondary-foreground border border-foreground/10"
                                                >
                                                    {tag}
                                                </span>
                                            ))}
                                        </div>
                                    ) : null;
                                })()}
                            </div>
                        ) : (
                            <div onClick={() => editor?.chain().focus().run()} className="w-full cursor-text">
                                <EditorContent editor={editor} className="outline-none" />
                                {/* Tag chips — below text content */}
                                {(() => {
                                    const tagList = tags.split(",").map(t => t.trim()).filter(Boolean);
                                    return tagList.length > 0 ? (
                                        <div className="mt-3 flex flex-wrap gap-1.5" onClick={(e) => e.stopPropagation()}>
                                            {tagList.map((tag) => (
                                                <span
                                                    key={tag}
                                                    dir="auto"
                                                    className="px-2.5 py-1 text-xs rounded-full bg-background text-secondary-foreground border border-foreground/10"
                                                >
                                                    {tag}
                                                </span>
                                            ))}
                                        </div>
                                    ) : null;
                                })()}
                            </div>
                        )}
                    </div>

                    {/* Mobile formatting bar — sits above the footer so the icon row can't overflow */}
                    {isMobile && canFormat && (
                        <div className="flex items-center gap-2 px-2 py-1 border-t border-border shrink-0">
                            {formattingButtons}
                        </div>
                    )}

                    {/* Footer */}
                    <DialogFooter className="flex flex-row items-center justify-between sm:justify-between p-2 border-t border-border shrink-0">
                        <div className="flex gap-2">
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button variant="ghost" size="icon" disabled={isDeleted} onClick={() => { expectExternalActivity(); fileInputRef.current?.click(); }} className="text-secondary">
                                        <ImageIcon className="h-5 w-5" />
                                        <span className="sr-only">Add Photo</span>
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent><p>Add Photo</p></TooltipContent>
                            </Tooltip>

                            <Popover open={isColorPickerOpen} onOpenChange={setIsColorPickerOpen}>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <PopoverTrigger asChild>
                                            <Button variant="ghost" size="icon" disabled={isDeleted} className="text-secondary">
                                                <Palette className="h-5 w-5" />
                                                <span className="sr-only">Colour</span>
                                            </Button>
                                        </PopoverTrigger>
                                    </TooltipTrigger>
                                    <TooltipContent><p>Colour</p></TooltipContent>
                                </Tooltip>
                                <PopoverContent side="top" align="start" className="w-auto max-w-[min(20rem,calc(100vw-2rem))] p-2">
                                    <NoteColorPicker
                                        value={color}
                                        disabled={isDeleted}
                                        onChange={(next) => {
                                            setColor(next);
                                            setIsColorPickerOpen(false);
                                        }}
                                    />
                                </PopoverContent>
                            </Popover>

                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button variant="ghost" size="icon" disabled={isDeleted} onClick={handleToggleMode} className="text-secondary">
                                        <ListChecks className="h-5 w-5" />
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
                                        disabled={isDeleted}
                                        className="text-secondary"
                                        onClick={() => setIsLabelsOpen(true)}
                                    >
                                        <Tag className="h-5 w-5" />
                                        <span className="sr-only">Labels</span>
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent><p>Labels</p></TooltipContent>
                            </Tooltip>

                            {/* Rich text formatting is text-notes only — checklist items are plain text,
                                so the whole T group is hidden rather than shown as a dead toggle. */}
                            {!isChecklistMode && (
                                <div className={`flex items-center gap-2 rounded-lg transition-colors ${!isMobile && canFormat ? "bg-muted px-1" : ""}`}>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                disabled={isDeleted}
                                                className={`text-secondary ${showFormatting ? "bg-brand-container text-brand-container-foreground" : ""}`}
                                                onClick={() => setShowFormatting(!showFormatting)}
                                            >
                                                <Type className="h-5 w-5" />
                                                <span className="sr-only">Formatting</span>
                                            </Button>
                                        </TooltipTrigger>
                                        <TooltipContent><p>Formatting</p></TooltipContent>
                                    </Tooltip>

                                    {!isMobile && canFormat && formattingButtons}
                                </div>
                            )}

                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="text-secondary"
                                        onClick={() => setIsFileInfoOpen(true)}
                                    >
                                        <Info className="h-5 w-5" />
                                        <span className="sr-only">File Info</span>
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent><p>File Info</p></TooltipContent>
                            </Tooltip>

                        </div>

                        <div className="flex gap-2">
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button variant="ghost" size="icon" disabled={isDeleted} onClick={handleExport} className="text-secondary">
                                        <Upload className="h-5 w-5" />
                                        <span className="sr-only">Export Note</span>
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent><p>Save to Device</p></TooltipContent>
                            </Tooltip>

                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button variant="ghost" size="icon" onClick={handleDelete} className="text-secondary hover:text-destructive">
                                        <Trash2 className="h-5 w-5" />
                                        <span className="sr-only">Delete</span>
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent><p>Delete</p></TooltipContent>
                            </Tooltip>
                        </div>
                    </DialogFooter>

                    <NoteLabels
                        isOpen={isLabelsOpen}
                        onClose={() => setIsLabelsOpen(false)}
                        availableTags={distplayTags}
                        selectedTags={tagStates}
                        onTagToggle={handleTagToggle}
                    />

                    <ReminderSheet
                        isOpen={isReminderSheetOpen}
                        onClose={() => setIsReminderSheetOpen(false)}
                        currentReminder={reminder}
                        currentRecurrence={recurrence}
                        onSetReminder={async (ts, rec) => {
                            // Schedule notification first â€” if permission is denied, don't save the reminder
                            const noteForNotif = buildNoteFromState({ reminder: ts, recurrence: rec });
                            const result = await scheduleReminderNotification(noteForNotif);
                            if (result === true) {
                                setReminder(ts);
                                setRecurrence(rec);
                            } else if (result === 'denied') {
                                // Permission permanently denied â€” OS won't show a dialog, must go to Settings
                                toast.error("Notifications are blocked. Go to Settings â†’ Apps â†’ Open Keep â†’ Notifications to enable reminders.", {
                                    duration: 6000,
                                });
                            } else {
                                // User declined the permission dialog
                                toast.error("Reminder not set â€” notification permission is required.", {
                                    duration: 4000,
                                });
                            }
                        }}
                        onRemoveReminder={async () => {
                            setReminder(undefined);
                            setRecurrence(undefined);
                            await cancelReminderNotification(noteIdRef.current);
                        }}
                    />
                </DialogContent>
            </Dialog>

            {isFileInfoOpen && initialNote && (
                <FileInfo
                    isOpen={isFileInfoOpen}
                    onClose={() => setIsFileInfoOpen(false)}
                    note={{
                        ...initialNote,
                        title,
                        content,
                        tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
                        isPinned,
                        isArchived,
                        updatedAt: initialNote.updatedAt,
                        createdAt: initialNote.createdAt,
                    }}
                />
            )}
        </>
    );
};

export default NoteEditor;
