import { registerPlugin } from "@capacitor/core";
import { Note } from "@/types/note";

export interface NoteStoragePlugin {
  loadNotes(): Promise<{ notes: any[] }>;
  saveNote(options: { note: any }): Promise<void>;
  deleteNote(options: { id: string }): Promise<void>;
  migrateFromWeb(options: { notes: any[] }): Promise<void>;
  initialize(options: { key: string }): Promise<void>;
  checkStatus(): Promise<{ isConfigured: boolean; isLocked?: boolean }>;
  changeEncryptionKey(options: { key: string }): Promise<void>;
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

  // MIGRATION LOGIC:
  // If it was a list note, convert items to markdown checklist
  let content = n.content || "";
  // Check for legacy "list" type OR if items array exists
  if (n.type === "list" || (n.items && Array.isArray(n.items))) {
    try {
      let items = n.items;
      if (typeof items === 'string') {
        if (items.trim().startsWith('[')) {
          items = JSON.parse(items);
        }
      }

      if (Array.isArray(items)) {
        // Convert legacy items to checklist markdown
        content = items.map((item: any) => {
          const isChecked = item.isCompleted || false;
          const text = item.content || "";
          return `- [${isChecked ? 'x' : ' '}] ${text}`;
        }).join('\n');
      }
    } catch (e) {
      console.warn("Failed to parse legacy items for list note", n.id, e);
    }
  }

  return {
    id: n.id,
    title: n.title || "",
    content: content,
    tags: parsedTags,
    // Ensure booleans are booleans
    isPinned: !!n.isPinned,
    isArchived: !!n.isArchived,
    // Ensure numbers are numbers
    createdAt: Number(n.createdAt) || Date.now(),
    updatedAt: Number(n.updatedAt) || Date.now()
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
    // We send the plain object. 
    // The native plugin might expect 'type' field still if it validates schemas.
    // For safety, we can send type='text' implicitly to satisfy any strict validation on the native side if it exists.
    const noteToSave = {
      ...note,
      type: 'text' // Implicitly set type for compatibility
    };
    await NoteStorage.saveNote({ note: noteToSave });
  } catch (error) {
    console.error("Error saving note to native storage:", error);
  }
};

export const deleteNote = async (id: string): Promise<void> => {
  try {
    await NoteStorage.deleteNote({ id });
  } catch (error) {
    console.error("Error deleting note from native storage:", error);
  }
};

export const migrateWebNotes = async (notes: any[]): Promise<void> => {
  // Pre-convert legacy web notes to the new format before sending migration
  const migratedNotes = notes.map(n => {
    let content = n.content || "";
    if (n.type === "list" || (n.items && Array.isArray(n.items))) {
      const items = n.items;
      if (Array.isArray(items)) {
        content = items.map((item: any) => `- [${item.isCompleted ? 'x' : ' '}] ${item.content}`).join('\n');
      }
    }

    return {
      ...n,
      content,
      type: 'text', // Normalize to text type for native DB
      items: undefined // Remove legacy items
    };
  });

  try {
    await NoteStorage.migrateFromWeb({ notes: migratedNotes });
  } catch (error) {
    console.error("Error migrating web notes:", error);
  }
};

export const initializeDatabase = async (key: string): Promise<void> => {
  try {
    await NoteStorage.initialize({ key });
  } catch (error) {
    console.error("Error initializing database:", error);
    throw error;
  }
};

export const checkDatabaseStatus = async (): Promise<{ isConfigured: boolean }> => {
  try {
    const status = await NoteStorage.checkStatus();
    return status;
  } catch (error) {
    console.error("Error checking database status:", error);
    return { isConfigured: false };
  }
};

export const changeEncryptionKey = async (key: string): Promise<void> => {
  try {
    await NoteStorage.changeEncryptionKey({ key });
  } catch (error) {
    console.error("Error changing encryption key:", error);
    throw error;
  }
};

// Legacy LocalStorage helpers
const LOCAL_STORAGE_KEY = "markdown-notes-app";
export const getLegacyWebNotes = (): any[] => {
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