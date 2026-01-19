import { registerPlugin } from "@capacitor/core";
import { Note } from "@/types/note";

export interface NoteStoragePlugin {
  loadNotes(): Promise<{ notes: any[] }>;
  saveNote(options: { note: any }): Promise<void>;
  deleteNote(options: { id: string }): Promise<void>;
  migrateFromWeb(options: { notes: any[] }): Promise<void>;
}

const NoteStorage = registerPlugin<NoteStoragePlugin>("NoteStorage");

// Helper to parse tags safely
const parseNote = (n: any): Note => {
  let parsedTags: string[] = [];
  try {
    if (typeof n.tags === 'string') {
      // If it looks like a JSON array, parse it
      if (n.tags.startsWith('[')) {
        parsedTags = JSON.parse(n.tags);
      } else {
        // If comma separated?
        parsedTags = n.tags.split(',').filter(Boolean);
      }
    } else if (Array.isArray(n.tags)) {
      parsedTags = n.tags;
    }
  } catch (e) {
    console.warn("Failed to parse tags for note", n.id, e);
    parsedTags = [];
  }

  return {
    ...n,
    tags: parsedTags,
    // Ensure booleans are booleans (SQLite might return 0/1 if not handled by plugin, but Plugin returns boolean usually)
    isPinned: !!n.isPinned,
    isArchived: !!n.isArchived,
    // Ensure numbers are numbers
    createdAt: Number(n.createdAt),
    updatedAt: Number(n.updatedAt)
  };
};

export const loadNotes = async (): Promise<Note[]> => {
  try {
    const { notes } = await NoteStorage.loadNotes();
    return notes.map(parseNote);
  } catch (error) {
    console.error("Error loading notes from native storage:", error);
    return [];
  }
};

export const saveNote = async (note: Note): Promise<void> => {
  try {
    // Convert tags to string if needed, or pass as array and let Plugin handle?
    // Plugin expects tags to be array in JSON object or whatever we decided.
    // Kotlin side: `val tagsArray = noteObj.optJSONArray("tags") ?: JSONArray()`
    // So passing array is fine.
    await NoteStorage.saveNote({ note });
  } catch (error) {
    console.error("Error saving note to native storage:", error);
  }
};

// Legacy saveNotes signature for compatibility/refactoring ease? 
// The user wanted "Notes auto-save". 
// If Index.tsx calls saveNotes(notes[]) we should probably deprecate/warn or implement loop.
// But better to remove that usage. I will NOT implement saveNotes(notes[]).

export const deleteNote = async (id: string): Promise<void> => {
  try {
    await NoteStorage.deleteNote({ id });
  } catch (error) {
    console.error("Error deleting note from native storage:", error);
  }
};

export const migrateWebNotes = async (notes: Note[]): Promise<void> => {
  try {
    await NoteStorage.migrateFromWeb({ notes });
  } catch (error) {
    console.error("Error migrating web notes:", error);
  }
};

// Legacy LocalStorage helpers
const LOCAL_STORAGE_KEY = "markdown-notes-app";
export const getLegacyWebNotes = (): Note[] => {
  try {
    const json = localStorage.getItem(LOCAL_STORAGE_KEY);
    return json ? JSON.parse(json) : [];
  } catch {
    return [];
  }
};

export const clearLegacyWebNotes = () => {
  localStorage.removeItem(LOCAL_STORAGE_KEY);
};