// Copyright (c) 2026. Licensed under AGPLv3.
import DOMPurify from "dompurify";
import { Importer, ImportInput, ImportInputFile, ImportNote } from "../../types/import";
import { isChecklist } from "../markdown";
import { looksLikeHtml, parseNoteMarkdown, plainTextToHtml } from "../note-markdown-format";
import { normalizeNoteColor } from "../../lib/note-colors";

export class MarkdownImporter implements Importer {
  name = "Markdown";

  detect(input: ImportInput): boolean {
    return input.files.some(f => f.name.toLowerCase().endsWith(".md"));
  }

  handles(file: ImportInputFile): boolean {
    return file.name.toLowerCase().endsWith(".md");
  }

  async parse(input: ImportInput): Promise<ImportNote[]> {
    const notes: ImportNote[] = [];

    for (const file of input.files) {
      if (!this.handles(file)) continue;

      const fallbackTitle = file.name.replace(/\.md$/i, "");
      const parsed = parseNoteMarkdown(file.content, fallbackTitle);

      let content = parsed.content;

      // The rest of the app derives list-ness from the content itself
      // (NoteCard calls isChecklist), so content wins. Frontmatter type is
      // only consulted for an empty body, where an empty list note would
      // otherwise come back as a text note.
      const type = content.trim().length === 0
        ? (parsed.type ?? 'text')
        : (isChecklist(content) ? 'list' : 'text');

      // Text notes are rendered as HTML, so plain markdown must be converted
      // or every newline collapses. Content that is already HTML (our own
      // exports of text notes) is kept, but sanitised before it is stored, as
      // the MCP bridge does: an imported file is untrusted (C3-31).
      if (type === 'text' && content.trim().length > 0) {
        content = looksLikeHtml(content) ? DOMPurify.sanitize(content) : plainTextToHtml(content);
      }

      const now = Date.now();

      notes.push({
        title: parsed.title || "Untitled",
        content,
        type,
        tags: parsed.tags ?? [],
        isPinned: parsed.isPinned ?? false,
        isArchived: parsed.isArchived ?? false,
        createdAt: parsed.createdAt ?? now,
        updatedAt: parsed.updatedAt ?? now,
        color: normalizeNoteColor(parsed.color),
      });
    }

    return notes;
  }
}
