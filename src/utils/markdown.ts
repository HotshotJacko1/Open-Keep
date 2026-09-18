// Copyright (c) 2026. Licensed under AGPLv3.

// `\s?` after the marker matches ChecklistMarkdown.kt (the Android widget), so
// an empty item stored as "- [ ]" with no trailing space is still an item.
export const CHECKBOX_REGEX = /^(\s*)-\s\[([ xX])\]\s?(.*)$/;

/** Indentation written for a sub-item. */
export const CHECKLIST_INDENT = "    ";

export interface ChecklistItem {
    id: string;
    content: string;
    checked: boolean;
    indentation: string;
    /**
     * Tick character as stored ('x' or 'X'). Only used so an item the user
     * hasn't touched is written back exactly as it was.
     */
    marker?: string;
    /**
     * Lines stored directly after this item that aren't items (blank lines,
     * stray text). They travel with the item and are always written back, so
     * saving a checklist can never drop them.
     */
    trailing?: string[];
}

export interface ParsedChecklist {
    items: ChecklistItem[];
    /** Non-item lines that come before the first item. */
    leading: string[];
    /** All non-blank, non-item lines joined with newlines. */
    extraText: string;
}

const stripCR = (line: string): string => (line.endsWith("\r") ? line.slice(0, -1) : line);

export const isTopLevel = (item: ChecklistItem): boolean => item.indentation === "";

/**
 * Checks if a note's content looks like a checklist.
 * Heuristic: If the first non-empty line starts with "- [ ]" or "- [x]", it's a checklist.
 */
export const isChecklist = (content: string): boolean => {
    if (!content) return false;
    const lines = content.split('\n');
    const firstContentLine = lines.find(line => line.trim().length > 0);
    if (!firstContentLine) return false;
    return CHECKBOX_REGEX.test(stripCR(firstContentLine));
};

/**
 * Toggles the checkbox on a specific line of markdown content.
 * Returns the new content string. Every other line is left exactly as it was.
 */
export const toggleCheckboxInContent = (content: string, lineIndex: number): string => {
    const lines = content.split('\n');
    if (lineIndex < 0 || lineIndex >= lines.length) return content;

    const raw = lines[lineIndex];
    const hadCR = raw.endsWith("\r");
    const match = stripCR(raw).match(CHECKBOX_REGEX);

    if (match) {
        const indentation = match[1];
        const isChecked = match[2].toLowerCase() === 'x';
        const text = match[3];
        lines[lineIndex] = `${indentation}- [${isChecked ? ' ' : 'x'}] ${text}${hadCR ? "\r" : ""}`;
    }

    return lines.join('\n');
};

/**
 * Parses checklist content into items for the editor.
 *
 * Nothing is thrown away: a line that isn't an item is kept on the item above
 * it (`trailing`), or in `leading` if it comes before the first item, and
 * `serializeChecklist` writes it back in the same place.
 */
export const parseChecklist = (content: string): ParsedChecklist => {
    const items: ChecklistItem[] = [];
    const leading: string[] = [];
    const extraLines: string[] = [];
    if (content === "") return { items, leading, extraText: "" };

    content.split('\n').forEach((rawLine, index) => {
        const line = stripCR(rawLine);
        const match = line.match(CHECKBOX_REGEX);
        if (match) {
            items.push({
                // Index-based ids are only placeholders; the editor assigns UUIDs.
                id: `line-${index}`,
                indentation: match[1],
                checked: match[2].toLowerCase() === 'x',
                marker: match[2],
                content: match[3],
                trailing: [],
            });
            return;
        }
        if (items.length > 0) {
            items[items.length - 1].trailing!.push(line);
        } else {
            leading.push(line);
        }
        if (line.trim() !== "") extraLines.push(line);
    });

    return { items, leading, extraText: extraLines.join('\n') };
};

const LINE_BREAKS = /\r\n|\r|\n/g;

/** One item as a stored line. Line breaks in the text are replaced so an item can never be split. */
export const serializeChecklistItem = (item: ChecklistItem): string => {
    const mark = item.checked ? (item.marker === "X" ? "X" : "x") : " ";
    const text = item.content.replace(LINE_BREAKS, " ");
    return `${item.indentation}- [${mark}] ${text}`;
};

/** The single way checklist state is turned back into stored content. */
export const serializeChecklist = (items: ChecklistItem[], leading: string[] = []): string => {
    const lines: string[] = [...leading];
    for (const item of items) {
        lines.push(serializeChecklistItem(item));
        if (item.trailing && item.trailing.length > 0) lines.push(...item.trailing);
    }
    return lines.join('\n');
};

/**
 * Removes items without losing the non-item lines attached to them: those
 * lines stay where they were, so they move onto the nearest remaining item
 * above (or into `leading`).
 */
export const removeChecklistItems = (
    items: ChecklistItem[],
    leading: string[],
    idsToRemove: Set<string>,
): { items: ChecklistItem[]; leading: string[] } => {
    const result: ChecklistItem[] = [];
    let newLeading = leading;
    for (const item of items) {
        if (!idsToRemove.has(item.id)) {
            result.push(item);
            continue;
        }
        const orphaned = item.trailing ?? [];
        if (orphaned.length === 0) continue;
        if (result.length > 0) {
            const prev = result[result.length - 1];
            result[result.length - 1] = { ...prev, trailing: [...(prev.trailing ?? []), ...orphaned] };
        } else {
            newLeading = [...newLeading, ...orphaned];
        }
    }
    return { items: result, leading: newLeading };
};

/**
 * Splits text that contains line breaks, for pasting into (or a keyboard
 * inserting a line break into) a checklist item. The first line stays in the
 * item; every other non-blank line becomes a new item. `caret` is an offset in
 * `text`; the result says which line and offset it lands on.
 */
export const splitMultilineItemText = (
    text: string,
    caret: number,
): { lines: string[]; caretLine: number; caretOffset: number } => {
    const segs: { text: string; start: number }[] = [];
    const re = /\r\n|\r|\n/g;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
        segs.push({ text: text.slice(last, m.index), start: last });
        last = m.index + m[0].length;
    }
    segs.push({ text: text.slice(last), start: last });

    const kept = segs
        .map((s, i) => ({ text: s.text, seg: i }))
        .filter((s, i) => i === 0 || s.text.trim() !== "");
    if (kept.length > 1 && kept[0].text.trim() === "") kept.shift();

    let caretSeg = 0;
    for (let i = 0; i < segs.length; i++) {
        if (segs[i].start <= caret) caretSeg = i;
    }
    let caretLine = 0;
    let caretOffset = 0;
    for (let k = kept.length - 1; k >= 0; k--) {
        if (kept[k].seg === caretSeg) {
            caretLine = k;
            caretOffset = Math.max(0, Math.min(caret - segs[caretSeg].start, kept[k].text.length));
            break;
        }
        if (kept[k].seg < caretSeg) {
            caretLine = k;
            caretOffset = kept[k].text.length;
            break;
        }
    }
    return { lines: kept.map(k => k.text), caretLine, caretOffset };
};

// ── Nesting ─────────────────────────────────────────────────────────────
//
// Which item a sub-item belongs to isn't stored: a sub-item belongs to the
// nearest top-level item above it. That only works because ticking never
// reorders items — ticked items are shown at the bottom by
// groupChecklistForDisplay, but stay in place in the stored list.

/** Index just past the end of the group that starts at top-level index `i`. */
export const groupEnd = (items: ChecklistItem[], i: number): number => {
    let j = i + 1;
    while (j < items.length && !isTopLevel(items[j])) j++;
    return j;
};

/** Index of the top-level item that owns index `i` (itself if top-level), or -1. */
export const ownerIndex = (items: ChecklistItem[], i: number): number => {
    for (let k = i; k >= 0; k--) {
        if (isTopLevel(items[k])) return k;
    }
    return -1;
};

export type ChecklistDisplayRow =
    | { kind: 'item'; item: ChecklistItem; indented: boolean }
    /** Greyed, read-only copy of a parent, shown above its sub-items when the parent is in the other section. */
    | { kind: 'parent'; item: ChecklistItem };

/**
 * Splits items into the unticked and ticked sections for display, keeping
 * stored order. A sub-item whose parent is in the other section is shown
 * under a greyed copy of that parent (as Google Keep does).
 */
export const groupChecklistForDisplay = (
    items: ChecklistItem[],
): { unchecked: ChecklistDisplayRow[]; checked: ChecklistDisplayRow[] } => {
    const unchecked: ChecklistDisplayRow[] = [];
    const checked: ChecklistDisplayRow[] = [];
    // Id of the parent whose group is currently open at the end of each section.
    const open: { unchecked: string | null; checked: string | null } = { unchecked: null, checked: null };
    let parent: ChecklistItem | null = null;

    for (const item of items) {
        const key = item.checked ? 'checked' : 'unchecked';
        const rows = item.checked ? checked : unchecked;
        if (isTopLevel(item)) {
            parent = item;
            rows.push({ kind: 'item', item, indented: false });
            open[key] = item.id;
            continue;
        }
        if (parent === null) {
            // A sub-item with nothing above it (e.g. imported content): show it flat.
            rows.push({ kind: 'item', item, indented: false });
            open[key] = null;
            continue;
        }
        if (open[key] !== parent.id) {
            rows.push({ kind: 'parent', item: parent });
            open[key] = parent.id;
        }
        rows.push({ kind: 'item', item, indented: true });
    }
    return { unchecked, checked };
};

/**
 * Moves an item after a drag. A top-level item moves with its whole group
 * (ticked sub-items included) and lands before or after the group it was
 * dropped on, never inside it. A sub-item moves alone and belongs to wherever
 * it lands; dropped above every top-level item, it's outdented.
 */
export const moveChecklistItem = (
    items: ChecklistItem[],
    activeId: string,
    overId: string,
    movingDown: boolean,
): ChecklistItem[] => {
    if (activeId === overId) return items;
    const from = items.findIndex(i => i.id === activeId);
    if (from === -1) return items;
    const isGroupMove = isTopLevel(items[from]);
    const blockEnd = isGroupMove ? groupEnd(items, from) : from + 1;
    const block = items.slice(from, blockEnd);
    const rest = [...items.slice(0, from), ...items.slice(blockEnd)];
    const overIdx = rest.findIndex(i => i.id === overId);
    if (overIdx === -1) return items; // dropped onto its own sub-item

    let insertAt: number;
    if (isGroupMove) {
        const owner = ownerIndex(rest, overIdx);
        if (owner === -1) {
            insertAt = movingDown ? overIdx + 1 : overIdx;
        } else {
            insertAt = movingDown ? groupEnd(rest, owner) : owner;
        }
    } else {
        insertAt = movingDown ? overIdx + 1 : overIdx;
    }

    const result = [...rest.slice(0, insertAt), ...block, ...rest.slice(insertAt)];
    if (!isGroupMove && ownerIndex(result, insertAt) === -1) {
        result[insertAt] = { ...result[insertAt], indentation: "" };
    }
    return result;
};

/**
 * Nests an item under the item shown directly above it (`visibleAboveId`).
 * If hidden items sit in between and one of them is a top-level item, the
 * item (with its own sub-items) is moved up to sit right after the visible
 * item, so it doesn't end up nested under something you can't see.
 */
export const indentChecklistItem = (
    items: ChecklistItem[],
    id: string,
    visibleAboveId: string | null,
): ChecklistItem[] => {
    if (!visibleAboveId) return items;
    const k = items.findIndex(i => i.id === id);
    const a = items.findIndex(i => i.id === visibleAboveId);
    if (k === -1 || a === -1 || a >= k) return items;
    if (!isTopLevel(items[k])) return items;

    const end = groupEnd(items, k);
    const block = [{ ...items[k], indentation: CHECKLIST_INDENT }, ...items.slice(k + 1, end)];
    const hiddenTopLevelBetween = items.slice(a + 1, k).some(isTopLevel);
    if (!hiddenTopLevelBetween) {
        return [...items.slice(0, k), ...block, ...items.slice(end)];
    }
    const without = [...items.slice(0, k), ...items.slice(end)];
    return [...without.slice(0, a + 1), ...block, ...without.slice(a + 1)];
};

/**
 * Converts plain text content to a checklist.
 * Splits by newlines, adds "- [ ] ".
 */
export const convertTextToList = (content: string): string => {
    return content
        .split('\n')
        .filter(line => line.trim().length > 0)
        .map(line => `- [ ] ${line}`)
        .join('\n');
};

/**
 * Converts a checklist to plain text.
 * Removes "- [ ] " or "- [x] ".
 */
export const convertListToText = (content: string): string => {
    return content
        .split('\n')
        .map(line => {
            const match = line.match(CHECKBOX_REGEX);
            return match ? match[3] : line;
        })
        .join('\n');
};
