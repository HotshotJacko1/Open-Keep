// Copyright (c) 2026. Licensed under AGPLv3.
import { Importer, ImportInput, ImportNote } from "../../types/import";
import { isChecklist } from "../markdown";
import { looksLikeHtml, plainTextToHtml } from "../note-markdown-format";

interface KeepNoteLabel {
  name: string;
}

interface KeepListItem {
  text: string;
  isChecked: boolean;
}

interface KeepNote {
  title?: string;
  textContent?: string;
  listContent?: KeepListItem[];
  labels?: KeepNoteLabel[];
  isPinned?: boolean;
  isArchived?: boolean;
  isTrashed?: boolean;
  createdTimestampUsec?: number;
  userEditedTimestampUsec?: number;
}

/** Keys that only appear in a Google Keep Takeout note export. */
const KEEP_SHAPED_JSON = /"(textContent|listContent|isTrashed|userEditedTimestampUsec|createdTimestampUsec)"\s*:/;

export class GoogleKeepImporter implements Importer {
  name = "Google Keep";

  detect(input: ImportInput): boolean {
    // Must actually look like Keep. This used to end in '|| true', which made
    // it match ANY .json file -- and because this importer is tried first, a
    // single stray .json would win and silently skip every .md in the batch.
    return input.files.some(f => {
      if (!f.name.toLowerCase().endsWith(".json")) return false;
      if (f.name.includes("Takeout") || f.name.includes("Keep")) return true;
      return KEEP_SHAPED_JSON.test(f.content);
    });
  }

  async parse(input: ImportInput): Promise<ImportNote[]> {
    const notes: ImportNote[] = [];

    for (const file of input.files) {
      if (!file.name.toLowerCase().endsWith(".json")) continue;

      try {
        const keepData = JSON.parse(file.content) as KeepNote;

        // Skip trashed exported notes if they explicitly say trashed, though user might want them? Let's skip trashed by default.
        if (keepData.isTrashed) {
          continue;
        }

        const tags = (keepData.labels || []).map(l => l.name);
        
        // Convert list to markdown checklist if present
        let body = keepData.textContent || "";
        if (keepData.listContent && keepData.listContent.length > 0) {
          const listMarkdown = keepData.listContent
            .map(item => `- [${item.isChecked ? 'x' : ' '}] ${item.text}`)
            .join("\n");
          body = body ? `${body}\n\n${listMarkdown}` : listMarkdown;
        }

        // Keep timestamps are in microseconds (usec), JS Date needs milliseconds
        const createdAt = keepData.createdTimestampUsec 
          ? Math.floor(keepData.createdTimestampUsec / 1000) 
          : Date.now();
        const updatedAt = keepData.userEditedTimestampUsec 
          ? Math.floor(keepData.userEditedTimestampUsec / 1000) 
          : createdAt;

        // Keep gives us plain text. Text notes are rendered as HTML, so
        // without this every newline collapses into one run-on paragraph.
        const type = isChecklist(body) ? 'list' : 'text';
        const content = type === 'text' && body.trim().length > 0 && !looksLikeHtml(body)
          ? plainTextToHtml(body)
          : body;

        notes.push({
          title: keepData.title || "Untitled",
          content,
          type,
          tags: tags,
          isPinned: !!keepData.isPinned,
          isArchived: !!keepData.isArchived,
          createdAt: createdAt,
          updatedAt: updatedAt
        });

      } catch (e) {
        console.warn(`Failed to parse Keep JSON file: ${file.name}`, e);
        // Continue to the next file if one fails to parse
      }
    }

    return notes;
  }
}
