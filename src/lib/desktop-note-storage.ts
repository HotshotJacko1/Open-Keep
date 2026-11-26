// Copyright (c) 2026. Licensed under AGPLv3.
//
// The desktop app's NoteStorage plugin: the same interface as the Capacitor
// plugin on Android and iOS, implemented in Rust (src-tauri/src/storage) over a
// SQLCipher database. note-storage.ts picks this one when isDesktopApp().
import { invoke } from "@tauri-apps/api/core";
import type { NoteStoragePlugin } from "./note-storage";

/** Tauri rejects with the Rust error string; callers expect an Error, as from Capacitor. */
const call = async <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
    try {
        return await invoke<T>(command, args);
    } catch (error) {
        throw error instanceof Error ? error : new Error(String(error));
    }
};

export const desktopNoteStorage: NoteStoragePlugin = {
    loadNotes: () => call("ns_load_notes"),
    saveNote: ({ note }) => call("ns_save_note", { note }),
    deleteNote: ({ id }) => call("ns_delete_note", { id }),
    migrateFromWeb: ({ notes }) => call("ns_migrate_from_web", { notes }),
    initialize: ({ key }) => call("ns_initialize", { key }),
    checkStatus: () => call("ns_check_status"),
    changeEncryptionKey: ({ oldPin, newPin }) => call("ns_change_encryption_key", { oldPin, newPin }),
    exportMasterKey: ({ pin }) => call("ns_export_master_key", { pin }),
    importMasterKey: ({ payload, pin }) => call("ns_import_master_key", { payload, pin }),
    verifyCloudMasterKeyMatch: ({ payload, pin }) => call("ns_verify_cloud_master_key_match", { payload, pin }),
    canDecryptCloudMasterKey: ({ payload, pin }) => call("ns_can_decrypt_cloud_master_key", { payload, pin }),
    wipeDatabaseButKeepKeys: () => call("ns_wipe_database_but_keep_keys"),
    encrypt: ({ data }) => call("ns_encrypt", { data }),
    decrypt: ({ data }) => call("ns_decrypt", { data }),
    lock: () => call("ns_lock"),
    clearAllData: () => call("ns_clear_all_data"),
    // Android's FLAG_SECURE; note-storage.ts only calls it on Android.
    setSecureWindow: async () => {},
};
