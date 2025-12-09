import { Note } from "@/types/note";

const LOCAL_STORAGE_KEY = "markdown-notes-app";

export const loadNotes = (): Note[] => {
  try {
    const serializedNotes = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (serializedNotes === null) {
      return [];
    }
    return JSON.parse(serializedNotes);
  } catch (error) {
    console.error("Error loading notes from local storage:", error);
    return [];
  }
};

export const saveNotes = (notes: Note[]): void => {
  try {
    const serializedNotes = JSON.stringify(notes);
    localStorage.setItem(LOCAL_STORAGE_KEY, serializedNotes);
  } catch (error) {
    console.error("Error saving notes to local storage:", error);
  }
};