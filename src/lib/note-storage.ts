// Copyright (c) 2026. Licensed under AGPLv3.
import { registerPlugin } from "@capacitor/core";
import { Capacitor } from "@capacitor/core";
import { Note } from "@/types/note";
import {
  initializeDatabaseWeb,
  encryptDataWeb,
  decryptDataWeb,
  lockDatabaseWeb,
  clearWebCryptoKeys,
  changeEncryptionKeyWeb,
  exportCloudMasterKeyWeb,
  importCloudMasterKeyWeb,
  verifyCloudMasterKeyMatchWeb,
  canDecryptCloudMasterKeyWeb
} from "./web-crypto";
import { normalizeCloudMasterKeyPayload } from "./cloud-master-key";

export interface NoteStoragePlugin {
  loadNotes(): Promise<{ notes: any[] }>;
  saveNote(options: { note: any }): Promise<void>;
  deleteNote(options: { id: string }): Promise<void>;
  migrateFromWeb(options: { notes: any[] }): Promise<void>;
  initialize(options: { key: string }): Promise<void>;
  checkStatus(): Promise<{ isConfigured: boolean; isLocked?: boolean }>;
  changeEncryptionKey(options: { oldPin: string; newPin: string }): Promise<void>;
  exportMasterKey(options: { pin: string }): Promise<{ payload: string }>;
  importMasterKey(options: { payload: string; pin: string }): Promise<void>;
  verifyCloudMasterKeyMatch(options: { payload: string; pin: string }): Promise<{ isMatch: boolean }>;
  canDecryptCloudMasterKey(options: { payload: string; pin: string }): Promise<{ canDecrypt: boolean }>;
  wipeDatabaseButKeepKeys(): Promise<void>;
  encrypt(options: { data: string }): Promise<{ data: string }>;
  decrypt(options: { data: string }): Promise<{ data: string }>;
  lock(): Promise<void>;
  clearAllData(): Promise<void>;
}

const NoteStorage = registerPlugin<NoteStoragePlugin>("NoteStorage");

const isNative = Capacitor.isNativePlatform();

// ── Web (localStorage) storage helpers ──────────────────────────────
const WEB_NOTES_KEY = "open-keep-notes";
const CORRUPT_KEY = `${WEB_NOTES_KEY}-corrupt`;
let webReadFailed = false;   // module-level; blocks writes until reload
export const isWebReadFailed = () => webReadFailed;

/** Preserve the raw blob once. Returns false if it could not be preserved. */
const preserveCorrupt = (key: string, raw: string): boolean => {
  try {
    const existing = localStorage.getItem(key);
    if (existing === raw) return true;
    if (existing !== null) return false;      // already hold a different snapshot; don't clobber it
    localStorage.setItem(key, raw);
    return localStorage.getItem(key) === raw; // verify the write landed
  } catch (e) {
    console.error("Could not preserve corrupt notes blob", e);
    return false;                              // never let this mask the original fault
  }
};

const webLoadNotes = (): any[] => {
  const json = localStorage.getItem(WEB_NOTES_KEY);
  if (json === null || json === "") return [];        // genuinely absent
  let parsed: unknown;
  try { parsed = JSON.parse(json); }
  catch { parsed = undefined; }
  if (!Array.isArray(parsed)) {                        // covers "null", "{}", '"x"', truncated
    preserveCorrupt(CORRUPT_KEY, json);
    webReadFailed = true;
    throw new Error("Local notes storage is unreadable");
  }
  return parsed;
};

const webSaveAllNotes = (notes: any[]): void => {
  if (webReadFailed) throw new Error("Refusing to overwrite unreadable notes storage");
  try {
    localStorage.setItem(WEB_NOTES_KEY, JSON.stringify(notes));
  } catch (e) {                                        // G12, folded in — quota / private mode / blocked
    console.error("Failed to persist web notes", e);
    throw new Error("Browser storage is full or unavailable; notes were not saved");
  }
};

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
    isDeleted: !!n.isDeleted,
    deletedAt: n.deletedAt ? Number(n.deletedAt) : undefined,
    // Ensure numbers are numbers
    createdAt: Number(n.createdAt) || Date.now(),
    updatedAt: Number(n.updatedAt) || Date.now(),
    reminder: n.reminder ? Number(n.reminder) : undefined,
  };
};

export const loadNotes = async (): Promise<Note[]> => {
  if (!isNative) {
    return webLoadNotes().map(parseNote);
  }
  // Let native errors propagate — callers must handle them.
  // Swallowing here made DB corruption indistinguishable from empty DB.
  const { notes } = await NoteStorage.loadNotes();
  return notes.map(parseNote);
};

export const saveNote = async (note: Note): Promise<void> => {
  if (!isNative) {
    const all = webLoadNotes();
    const idx = all.findIndex((n: any) => n.id === note.id);
    if (idx > -1) {
      all[idx] = note;
    } else {
      all.push(note);
    }
    webSaveAllNotes(all);
    return;
  }
  // Let native errors propagate to caller for proper error handling.
  const noteToSave = {
    ...note,
    type: 'text' // Implicitly set type for compatibility
  };
  await NoteStorage.saveNote({ note: noteToSave });
};

export const deleteNote = async (id: string): Promise<void> => {
  if (!isNative) {
    const all = webLoadNotes().filter((n: any) => n.id !== id);
    webSaveAllNotes(all);
    return;
  }
  // Let native errors propagate to caller for proper error handling.
  await NoteStorage.deleteNote({ id });
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

  if (!isNative) {
    // On web, merge migrated notes into the web storage
    const existing = webLoadNotes();
    const existingIds = new Set(existing.map((n: any) => n.id));
    for (const note of migratedNotes) {
      if (!existingIds.has(note.id)) {
        existing.push(note);
      }
    }
    webSaveAllNotes(existing);
    return;
  }

  try {
    await NoteStorage.migrateFromWeb({ notes: migratedNotes });
  } catch (error) {
    console.error("Error migrating web notes:", error);
  }
};

const getEffectivePin = (pin: string) => pin === "" ? "OPENKEEP_DEFAULT_UNENCRYPTED_PIN" : pin;

export const initializeDatabase = async (key: string): Promise<void> => {
  const effectiveKey = getEffectivePin(key);
  if (!isNative) {
    try {
      await initializeDatabaseWeb(effectiveKey);
      return;
    } catch (error) {
      console.error("Error initializing web database:", error);
      throw error;
    }
  }
  try {
    await NoteStorage.initialize({ key: effectiveKey });
  } catch (error) {
    console.error("Error initializing database:", error);
    throw error;
  }
};

export const checkDatabaseStatus = async (): Promise<{ isConfigured: boolean; isLocked?: boolean }> => {
  if (!isNative) return { isConfigured: true }; // Web is always "configured"
  try {
    const status = await NoteStorage.checkStatus();
    return status;
  } catch (error) {
    console.error("Error checking database status:", error);
    return { isConfigured: false };
  }
};

export const encryptData = async (data: string): Promise<string> => {
  if (!localStorage.getItem("app-passcode")) {
    return data;
  }

  if (!isNative) {
    try {
      return await encryptDataWeb(data);
    } catch (e) {
      // If no master key is available (e.g., user is not locked and unencrypted), return as-is
      if ((e as Error).message === "No master key available") return data;
      throw e;
    }
  }
  try {
    const result = await NoteStorage.encrypt({ data });
    return result.data;
  } catch (error) {
    console.error("Error encrypting data:", error);
    throw error;
  }
};

export const decryptData = async (data: string): Promise<string> => {
  if (!isNative) {
    try {
      return await decryptDataWeb(data);
    } catch (e) {
      // If we try to decrypt but it fails, it might be unencrypted plain JSON, or we lack the key
      if ((e as Error).message === "No master key available" || (e as Error).message === "Invalid encrypted data") {
        return data; // Return as-is
      }
      throw e;
    }
  }
  try {
    const result = await NoteStorage.decrypt({ data });
    return result.data;
  } catch (error) {
    console.error("Error decrypting data:", error);
    throw error;
  }
};

export const lockDatabase = async (): Promise<void> => {
  if (!isNative) {
    await lockDatabaseWeb();
    return;
  }
  try {
    await NoteStorage.lock();
  } catch (error) {
    console.error("Error locking database:", error);
  }
};

export const clearAllData = async (): Promise<void> => {
  if (!isNative) {
    localStorage.removeItem(WEB_NOTES_KEY);
    clearWebCryptoKeys();
    return;
  }
  try {
    await NoteStorage.clearAllData();
  } catch (error) {
    console.error("Error clearing data:", error);
    throw error;
  }
};

export const changeEncryptionKey = async (oldPin: string, newPin: string): Promise<void> => {
  const effectiveOldPin = getEffectivePin(oldPin);
  const effectiveNewPin = getEffectivePin(newPin);
  if (!isNative) {
    await changeEncryptionKeyWeb(effectiveOldPin, effectiveNewPin);
    return;
  }
  try {
    await NoteStorage.changeEncryptionKey({ oldPin: effectiveOldPin, newPin: effectiveNewPin });
  } catch (error) {
    console.error("Error changing encryption key:", error);
    throw error;
  }
};

export const exportMasterKey = async (pin: string): Promise<string> => {
  const effectivePin = getEffectivePin(pin);
  if (!isNative) {
    return await exportCloudMasterKeyWeb(effectivePin);
  }
  try {
    const result = await NoteStorage.exportMasterKey({ pin: effectivePin });
    return result.payload;
  } catch (error) {
    console.error("Error exporting master key:", error);
    throw error;
  }
};

export const importMasterKey = async (payload: string, pin: string): Promise<void> => {
  const effectivePin = getEffectivePin(pin);
  const normalizedPayload = normalizeCloudMasterKeyPayload(payload);
  if (!normalizedPayload) {
    throw new Error("Invalid cloud master key payload");
  }

  if (!isNative) {
    await importCloudMasterKeyWeb(normalizedPayload, effectivePin);
    return;
  }
  try {
    await NoteStorage.importMasterKey({ payload: normalizedPayload, pin: effectivePin });
  } catch (error) {
    console.error("Error importing master key:", error);
    throw error;
  }
};

export const verifyCloudMasterKeyMatch = async (payload: string, pin: string): Promise<boolean> => {
  const effectivePin = getEffectivePin(pin);
  const normalizedPayload = normalizeCloudMasterKeyPayload(payload);
  if (!normalizedPayload) return false;

  if (!isNative) {
    return await verifyCloudMasterKeyMatchWeb(normalizedPayload, effectivePin);
  }
  try {
    const result = await NoteStorage.verifyCloudMasterKeyMatch({ payload: normalizedPayload, pin: effectivePin });
    return result.isMatch;
  } catch (error) {
    console.error("Error verifying master key match:", error);
    throw error;
  }
};

export const canDecryptCloudMasterKey = async (payload: string, pin: string): Promise<boolean> => {
  const effectivePin = getEffectivePin(pin);
  const normalizedPayload = normalizeCloudMasterKeyPayload(payload);
  if (!normalizedPayload) return false;

  if (!isNative) {
    return await canDecryptCloudMasterKeyWeb(normalizedPayload, effectivePin);
  }
  try {
    const result = await NoteStorage.canDecryptCloudMasterKey({ payload: normalizedPayload, pin: effectivePin });
    return result.canDecrypt;
  } catch (error) {
    const err = error as { code?: string };
    // Native plugin not rebuilt yet — same crypto logic runs in JS via Web Crypto.
    if (err.code === "UNIMPLEMENTED") {
      return await canDecryptCloudMasterKeyWeb(normalizedPayload, effectivePin);
    }
    console.error("Error checking cloud master key decryption:", error);
    return false;
  }
};

export const wipeDatabaseButKeepKeys = async (): Promise<void> => {
  if (!isNative) {
    localStorage.removeItem(WEB_NOTES_KEY);
    return;
  }
  try {
    await NoteStorage.wipeDatabaseButKeepKeys();
  } catch (error) {
    console.error("Error wiping database:", error);
    throw error;
  }
};

export type SyncResult = 
    | { status: "success" }
    | { status: "conflict", cloudPayload: string, reason?: "key_mismatch" | "first_connect" }
    | { status: "error", message: string };

// Legacy LocalStorage helpers
const LOCAL_STORAGE_KEY = "markdown-notes-app";
export const getLegacyWebNotes = (): any[] => {
  const json = localStorage.getItem(LOCAL_STORAGE_KEY);
  if (json === null || json === "") return [];
  let parsed: unknown;
  try { parsed = JSON.parse(json); }
  catch { parsed = undefined; }
  if (!Array.isArray(parsed)) {
    preserveCorrupt(`${LOCAL_STORAGE_KEY}-corrupt`, json);
    return [];
  }
  return parsed;
};

export const clearLegacyWebNotes = () => {
  localStorage.removeItem(LOCAL_STORAGE_KEY);
};