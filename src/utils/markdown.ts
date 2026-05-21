// Copyright (c) 2026. Licensed under AGPLv3.
export const CHECKBOX_REGEX = /^(\s*)-\s\[([ xX])\]\s(.*)$/;

export interface ChecklistItem {
    id: string;
    content: string;
    checked: boolean;
    indentation: string;
}

/**
 * Checks if a note's content looks like a checklist.
 * Heuristic: If the first non-empty line starts with "- [ ]" or "- [x]", it's a checklist.
 */
export const isChecklist = (content: string): boolean => {
    if (!content) return false;
    const lines = content.split('\n');
    const firstContentLine = lines.find(line => line.trim().length > 0);
    if (!firstContentLine) return false;
    return CHECKBOX_REGEX.test(firstContentLine);
};

/**
 * Toggles the checkbox on a specific line of markdown content.
 * Returns the new content string.
 */
export const toggleCheckboxInContent = (content: string, lineIndex: number): string => {
    const lines = content.split('\n');
    if (lineIndex < 0 || lineIndex >= lines.length) return content;

    const line = lines[lineIndex];
    const match = line.match(CHECKBOX_REGEX);

    if (match) {
        const indentation = match[1];
        const isChecked = match[2].toLowerCase() === 'x';
        const text = match[3];
        lines[lineIndex] = `${indentation}- [${isChecked ? ' ' : 'x'}] ${text}`;
    }

    return lines.join('\n');
};

/**
 * Parses markdown content into structured checklist items for the UI.
 * Gives each item a stable-ish ID based on index (warning: reordering changes IDs if we use index).
 * For drag-and-drop, we might need to handle this carefully in the editor state.
 */
export const parseChecklist = (content: string): { items: ChecklistItem[], extraText: string } => {
    const lines = content.split('\n');
    const items: ChecklistItem[] = [];
    const extraLines: string[] = []; // Lines that don't match checklist pattern? 
    // Actually, usually we treat mixed content as Mixed. 
    // But for "Note Editor", if in List Mode, we generally expect all lines to be list items.

    lines.forEach((line, index) => {
        const match = line.match(CHECKBOX_REGEX);
        if (match) {
            items.push({
                // Using index as ID is risky for DnD, but fine for simple rendering.
                // In Editor, we'll assign random UUIDs to local state items.
                id: `line-${index}`,
                indentation: match[1],
                checked: match[2].toLowerCase() === 'x',
                content: match[3]
            });
        }
    });

    return { items, extraText: extraLines.join('\n') };
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
