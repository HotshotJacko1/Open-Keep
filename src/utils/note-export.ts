// Copyright (c) 2026. Licensed under AGPLv3.
import JSZip from "jszip";
import { Filesystem, Directory } from "@capacitor/filesystem";
import { Note } from "@/types/note";
import { serializeNoteToMarkdown } from "@/utils/note-markdown-format";

/**
 * Adds each note to the zip as `<title>_<id4>.md`, with its images in a
 * sibling `<title>_images/` folder. Every export path goes through here so
 * none of them can silently drop images again.
 */
export const addNotesToZip = async (zip: JSZip, notes: Note[]): Promise<void> => {
  await Promise.all(notes.map(async (note) => {
    // Sanitize title for filename
    const safeTitle = note.title.replace(/[^a-z0-9]/gi, '_').substring(0, 50) || 'untitled';
    const filename = `${safeTitle}_${note.id.substring(0, 4)}.md`;

    zip.file(filename, serializeNoteToMarkdown(note));

    if (note.images && note.images.length > 0) {
      const imgFolder = zip.folder(`${safeTitle}_images`);
      if (imgFolder) {
        for (const imgPath of note.images) {
          try {
            const { data } = await Filesystem.readFile({ path: imgPath, directory: Directory.Data });
            imgFolder.file(imgPath.split('/').pop() || 'image.jpg', data, { base64: true });
          } catch (e) {
            console.warn("Failed to export image", imgPath);
          }
        }
      }
    }
  }));
};
