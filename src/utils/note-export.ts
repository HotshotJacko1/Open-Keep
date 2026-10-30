// Copyright (c) 2026. Licensed under AGPLv3.
import JSZip from "jszip";
import { Note } from "@/types/note";
import { readImageBase64 } from "@/lib/image-storage";
import { serializeNoteToMarkdown } from "@/utils/note-markdown-format";

/**
 * Adds each note to the zip as `<title>_<id8>.md`, with its images in a
 * sibling `<title>_<id8>_images/` folder. Every export path goes through here
 * so none of them can silently drop images again.
 */
export const addNotesToZip = async (zip: JSZip, notes: Note[]): Promise<void> => {
  // Every note needs its own name: JSZip silently replaces a file added under
  // a name it already holds, and this zip is the user's backup (C3-33).
  // Untitled and same-titled notes used to differ only by 4 hex digits.
  // Compared case-insensitively, because macOS and Windows unzip that way.
  const usedStems = new Set<string>();
  const stems = notes.map((note) => {
    const safeTitle = Array.from(note.title.replace(/[^\p{L}\p{N}]/gu, '_')).slice(0, 50).join('') || 'untitled';
    const base = `${safeTitle}_${note.id.replace(/[^a-z0-9]/gi, '').substring(0, 8)}`;
    let stem = base;
    for (let n = 2; usedStems.has(stem.toLowerCase()); n++) stem = `${base}_${n}`;
    usedStems.add(stem.toLowerCase());
    return stem;
  });

  await Promise.all(notes.map(async (note, index) => {
    const stem = stems[index];
    zip.file(`${stem}.md`, serializeNoteToMarkdown(note));

    if (note.images && note.images.length > 0) {
      const imgFolder = zip.folder(`${stem}_images`);
      if (imgFolder) {
        for (const imgPath of note.images) {
          try {
            const data = await readImageBase64(imgPath);
            imgFolder.file(imgPath.split('/').pop() || 'image.jpg', data, { base64: true });
          } catch (e) {
            console.warn("Failed to export image", imgPath);
          }
        }
      }
    }
  }));
};
