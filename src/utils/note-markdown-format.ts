// Copyright (c) 2026. Licensed under AGPLv3.
import { Note } from "@/types/note";

/**
 * Open Keep's .md interchange format.
 *
 * Exported files carry a frontmatter block so a re-import can restore tags,
 * pin/archive state and timestamps -- without it, "export all and import back"
 * silently drops every label and resets every creation date.
 *
 * Values are JSON-encoded, so a title containing a colon, a quote or a newline
 * survives the round-trip.
 *
 * Files WITHOUT frontmatter still import fine: hand-written markdown, and
 * exports from versions before this format existed. See parseNoteMarkdown.
 *
 * Images are deliberately NOT recorded here. note.images holds device-local
 * paths that would dangle on any other install, so an importer would only
 * restore broken references.
 */

export interface ParsedNoteMarkdown {
  title?: string;
  content: string;
  tags?: string[];
  isPinned?: boolean;
  isArchived?: boolean;
  createdAt?: number;
  updatedAt?: number;
  type?: 'text' | 'list';
  color?: string;
  hadFrontmatter: boolean;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/;

/**
 * Elements TipTap actually emits, plus the common hand-written ones. Used to
 * tell "this file already holds HTML" from "this file holds plain markdown".
 */
const HTML_LIKE_RE = /<\/?(p|div|br|ul|ol|li|h[1-6]|strong|em|b|i|u|a|blockquote|pre|code|s|span|img|hr|table)\b[^>]*>/i;

export const looksLikeHtml = (content: string): boolean => HTML_LIKE_RE.test(content);

const escapeHtml = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Text notes are stored AND rendered as HTML -- NoteCard uses
 * dangerouslySetInnerHTML and the editor uses editor.commands.setContent().
 * Plain text carrying \n newlines therefore collapses into one run-on
 * paragraph, and the next autosave persists that collapse.
 *
 * Wrapping each line in <p> mirrors what handleToggleMode already does in
 * NoteEditor ("wrap lines in <p> for Tiptap to respect newlines").
 *
 * Note this preserves structure only. Markdown syntax (**bold**, headings,
 * links) is NOT converted -- the app has no markdown renderer, so that would
 * be a separate feature.
 */
export const plainTextToHtml = (text: string): string =>
  text
    .split(/\r?\n/)
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join('');

export const serializeNoteToMarkdown = (note: Note): string => {
  const frontmatter = [
    '---',
    `title: ${JSON.stringify(note.title || '')}`,
    `tags: ${JSON.stringify(note.tags || [])}`,
    `pinned: ${!!note.isPinned}`,
    `archived: ${!!note.isArchived}`,
    `type: ${JSON.stringify(note.type || 'text')}`,
    `color: ${JSON.stringify(note.color || 'default')}`,
    `created: ${note.createdAt || Date.now()}`,
    `updated: ${note.updatedAt || Date.now()}`,
    '---',
    '',
  ].join('\n');

  // The '# title' heading is kept for readability in other markdown apps, and
  // so files exported before frontmatter existed keep importing identically.
  return `${frontmatter}# ${note.title}\n\n${note.content}`;
};

export const parseNoteMarkdown = (raw: string, fallbackTitle: string): ParsedNoteMarkdown => {
  let body = raw;
  const meta: Record<string, string> = {};
  let hadFrontmatter = false;

  const match = raw.match(FRONTMATTER_RE);
  if (match) {
    hadFrontmatter = true;
    body = raw.slice(match[0].length);
    for (const line of match[1].split(/\r?\n/)) {
      const separator = line.indexOf(':');
      if (separator === -1) continue;
      const key = line.slice(0, separator).trim();
      if (key) meta[key] = line.slice(separator + 1).trim();
    }
  }

  const readString = (key: string): string | undefined => {
    const value = meta[key];
    if (value === undefined) return undefined;
    try {
      const parsed = JSON.parse(value);
      return typeof parsed === 'string' ? parsed : undefined;
    } catch {
      return value || undefined;
    }
  };

  const readStringArray = (key: string): string[] | undefined => {
    const value = meta[key];
    if (value === undefined) return undefined;
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : undefined;
    } catch {
      return undefined;
    }
  };

  const readBoolean = (key: string): boolean | undefined => {
    const value = meta[key];
    if (value === 'true') return true;
    if (value === 'false') return false;
    return undefined;
  };

  const readTimestamp = (key: string): number | undefined => {
    const value = meta[key];
    if (value === undefined) return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  };

  let title = readString('title');

  // A leading '# Heading' is how we write the title, so strip it rather than
  // repeat it in the body.
  const lines = body.split('\n');
  const firstContentIndex = lines.findIndex((line) => line.trim().length > 0);
  if (firstContentIndex !== -1 && lines[firstContentIndex].startsWith('# ')) {
    const heading = lines[firstContentIndex].substring(2).trim();
    if (!title) title = heading;
    lines.splice(firstContentIndex, 1);
    body = lines.join('\n').trimStart();
  }

  const rawType = readString('type');
  // Validated against the live palette on import (see the markdown importer),
  // so a file naming a swatch this build does not have degrades to default.
  const rawColor = readString('color');

  return {
    title: title || fallbackTitle || undefined,
    content: body,
    tags: readStringArray('tags'),
    isPinned: readBoolean('pinned'),
    isArchived: readBoolean('archived'),
    createdAt: readTimestamp('created'),
    updatedAt: readTimestamp('updated'),
    type: rawType === 'list' || rawType === 'text' ? rawType : undefined,
    color: rawColor || undefined,
    hadFrontmatter,
  };
};
