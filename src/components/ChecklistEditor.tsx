// Copyright (c) 2026. Licensed under AGPLv3.
import React, { useState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { cn, safeRandomUUID } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Plus, X, GripVertical, ChevronDown, ChevronRight } from "lucide-react";
import CheckboxHitArea from "@/components/CheckboxHitArea";
import { LinkHighlightedTextarea } from "@/components/LinkHighlightedTextarea";
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
import {
    isTopLevel,
    removeChecklistItems,
    splitMultilineItemText,
    groupChecklistForDisplay,
    moveChecklistItem,
    indentChecklistItem,
    outdentChecklistItem,
    groupEnd,
    CHECKLIST_INDENT,
    ChecklistItem,
    ChecklistDisplayRow,
} from "@/utils/markdown";
import { useFlipNextChange } from "@/hooks/use-flip-layout";
import { LIST_ITEM_MAX, LIST_ITEMS_MAX } from "@/lib/note-limits";
import { getTextDirection } from "@/utils/text-direction";

/*
 * The checklist part of a note: item rows with drag handles, Tab / Shift+Tab
 * and swipe to indent, Enter to split or insert, Backspace to merge, the
 * "List item" box, and the ticked section. Shared by NoteEditor and
 * InlineNoteCreator so the two can't drift apart. The caller owns the items
 * and turns them into stored content (serializeChecklist).
 */

// Moves focus between checklist item textareas (id="list-item-<itemId>") in DOM order,
// used so ArrowUp/ArrowDown/ArrowLeft/ArrowRight can cross from one item into the next
// when the cursor is already at the start/end of the current item's content.
// Stays within this checklist, so it can't jump into another one on the page.
const focusAdjacentListItem = (from: HTMLElement, currentId: string, direction: "next" | "prev"): boolean => {
    const root = from.closest("[data-checklist-editor]") ?? document;
    const textareas = Array.from(
        root.querySelectorAll<HTMLTextAreaElement>('textarea[id^="list-item-"]')
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
                className="flex items-start gap-2 w-full py-2 transition-transform duration-md3-short1"
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
                            if (focusAdjacentListItem(e.currentTarget, item.id, "next")) {
                                e.preventDefault();
                            }
                        } else if (
                            (e.key === "ArrowUp" || e.key === prevArrow) &&
                            !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey &&
                            e.currentTarget.selectionStart === 0 &&
                            e.currentTarget.selectionEnd === 0
                        ) {
                            if (focusAdjacentListItem(e.currentTarget, item.id, "prev")) {
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
                className="flex items-start gap-2 w-full py-2 transition-transform duration-md3-short1"
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
                            if (focusAdjacentListItem(e.currentTarget, item.id, "next")) {
                                e.preventDefault();
                            }
                        } else if (
                            (e.key === "ArrowUp" || e.key === prevArrow) &&
                            !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey &&
                            e.currentTarget.selectionStart === 0 &&
                            e.currentTarget.selectionEnd === 0
                        ) {
                            if (focusAdjacentListItem(e.currentTarget, item.id, "prev")) {
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

export type ChecklistItemsUpdate = ChecklistItem[] | ((prev: ChecklistItem[]) => ChecklistItem[]);

interface ChecklistEditorProps {
    items: ChecklistItem[];
    /** Every change to the items goes through here. */
    onItemsChange: (next: ChecklistItemsUpdate) => void;
    /**
     * Non-item lines stored before the first item (see parseChecklist). Lines
     * after an item travel on the item itself (`trailing`). Read and replaced
     * in place when items are removed.
     */
    leadingLinesRef: React.MutableRefObject<string[]>;
    /** Whether the ticked section is expanded. */
    showChecked: boolean;
    onShowCheckedChange: (show: boolean) => void;
    /** Read-only (a note in the Bin). */
    disabled?: boolean;
    /** Item to focus when the editor first appears. */
    initialFocusItemId?: string;
    className?: string;
    /** Shown after the ticked section, e.g. label chips. */
    children?: React.ReactNode;
}

export const ChecklistEditor: React.FC<ChecklistEditorProps> = ({
    items: checklistItems,
    onItemsChange: updateItems,
    leadingLinesRef,
    showChecked,
    onShowCheckedChange,
    disabled = false,
    initialFocusItemId,
    className,
    children,
}) => {
    const [newItemContent, setNewItemContent] = useState("");
    const [focusItemId, setFocusItemId] = useState<string | null>(initialFocusItemId ?? null);
    // Ticking an item slides it down to the ticked section (and unticking
    // slides it back up), instead of it vanishing and reappearing.
    const checklistRef = useRef<HTMLDivElement>(null);
    const captureChecklistLayout = useFlipNextChange(checklistRef);

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
                    disabled={disabled}
                    onConvert={() => handleConvertStrayLine(ownerId, lineIndex)}
                />
            )
        );

    const checklistDisplay = groupChecklistForDisplay(checklistItems);
    const checkedItemCount = checklistDisplay.checked.filter(row => row.kind === 'item').length;

    return (
        <div ref={checklistRef} data-checklist-editor="" className={cn("flex flex-col", className)}>
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
                                disabled={disabled}
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
                    readOnly={disabled}
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
                        onClick={() => onShowCheckedChange(!showChecked)}
                    >
                        {showChecked ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        {checkedItemCount} checked {checkedItemCount === 1 ? 'item' : 'items'}
                    </Button>

                    {showChecked && (
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
                                        disabled={disabled}
                                    />
                                    {renderStrayLines(row.item.id, row.item.trailing, row.indented)}
                                </React.Fragment>
                            ))}
                        </div>
                    )}
                </div>
            )}
            {children}
        </div>
    );
};

export default ChecklistEditor;
