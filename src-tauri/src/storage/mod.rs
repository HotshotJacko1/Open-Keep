// Copyright (c) 2026. Licensed under AGPLv3.
//
// The desktop NoteStorage plugin: one Tauri command per method of the
// NoteStoragePlugin interface in src/lib/note-storage.ts, behaving like
// Android's NoteStoragePlugin.kt. src/lib/desktop-note-storage.ts calls these.
//
// The database is always encrypted. Without a PIN, the JS side passes a fixed
// default PIN (as on mobile), and the unwrapped key lives in Credential Manager
// so the app opens without asking.

mod db;
mod keys;

use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard};

use rusqlite::Connection;
use serde_json::{json, Value};
use tauri::State;

use keys::{KeyManager, MasterKey};

pub struct Storage {
    dir: PathBuf,
    keys: KeyManager,
    conn: Mutex<Option<Connection>>,
    /// The auto-unlock key, cached so encrypt/decrypt don't read Credential Manager each time.
    master: Mutex<Option<MasterKey>>,
    /// Held for the whole of every command, so they run one at a time. Two
    /// overlapping initialize calls (React runs effects twice in development)
    /// would otherwise each create a salt and a wrapped key, and the loser's
    /// key file would no longer match the database.
    ops: Mutex<()>,
}

type CmdResult = Result<Value, String>;

impl Storage {
    pub fn new(dir: PathBuf) -> Self {
        Self { keys: KeyManager::new(&dir), dir, conn: Mutex::new(None), master: Mutex::new(None), ops: Mutex::new(()) }
    }

    fn exclusive(&self) -> Result<MutexGuard<'_, ()>, String> {
        self.ops.lock().map_err(|_| "Storage lock poisoned".to_string())
    }

    fn with_conn<T>(&self, f: impl FnOnce(&mut Connection) -> Result<T, String>) -> Result<T, String> {
        let mut guard = self.conn.lock().map_err(|_| "Database lock poisoned")?;
        let conn = guard.as_mut().ok_or("Database is locked")?;
        f(conn)
    }

    fn close(&self) {
        if let Ok(mut guard) = self.conn.lock() {
            *guard = None;
        }
    }

    fn set_master(&self, master: Option<MasterKey>) {
        if let Ok(mut guard) = self.master.lock() {
            *guard = master;
        }
    }

    fn current_master(&self) -> Result<MasterKey, String> {
        if let Some(master) = self.master.lock().ok().and_then(|g| g.clone()) {
            return Ok(master);
        }
        let master = self.keys.stored_master_key().ok_or("No master key available")?;
        self.set_master(Some(master.clone()));
        Ok(master)
    }

    /// Opens with `master`, proving the key and bringing the schema up to date.
    fn open_verified(&self, master: &[u8]) -> Result<(), String> {
        self.close();
        let conn = db::open(&self.dir, master)?;
        db::verify(&conn)?;
        *self.conn.lock().map_err(|_| "Database lock poisoned")? = Some(conn);
        Ok(())
    }

    fn delete_db_files(&self) -> Result<(), String> {
        self.close();
        for path in db::db_files(&self.dir) {
            match std::fs::remove_file(&path) {
                Ok(()) => {}
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => return Err(format!("Could not delete {}: {e}", path.display())),
            }
        }
        Ok(())
    }
}

#[tauri::command]
pub async fn ns_load_notes(state: State<'_, Storage>) -> CmdResult {
    let _op = state.exclusive()?;
    let notes = state.with_conn(|conn| db::load_notes(conn))?;
    Ok(json!({ "notes": notes }))
}

#[tauri::command]
pub async fn ns_save_note(state: State<'_, Storage>, note: Value) -> CmdResult {
    let _op = state.exclusive()?;
    state.with_conn(|conn| db::upsert(conn, &note, "PENDING", true))?;
    Ok(Value::Null)
}

#[tauri::command]
pub async fn ns_delete_note(state: State<'_, Storage>, id: String) -> CmdResult {
    let _op = state.exclusive()?;
    state.with_conn(|conn| db::delete(conn, &id))?;
    Ok(Value::Null)
}

#[tauri::command]
pub async fn ns_migrate_from_web(state: State<'_, Storage>, notes: Vec<Value>) -> CmdResult {
    let _op = state.exclusive()?;
    state.with_conn(|conn| db::bulk_insert(conn, &notes))?;
    Ok(Value::Null)
}

#[tauri::command]
pub async fn ns_initialize(state: State<'_, Storage>, key: String) -> CmdResult {
    let _op = state.exclusive()?;
    let db_exists = db::db_path(&state.dir).exists();
    let master = if !db_exists && !state.keys.has_v2_key()? {
        state.keys.generate_master_key_and_save(&key)?
    } else {
        state
            .keys
            .master_key_for_pin(&key)
            .map_err(|_| "Failed to open database. Incorrect PIN?".to_string())?
    };
    if let Err(e) = state.open_verified(&master) {
        state.close();
        return Err(e);
    }
    state.keys.upgrade_to_v2(&master, &key)?;
    state
        .keys
        .store_master_key(&master)
        .map_err(|e| format!("Database verified but failed to save encryption key state: {e}"))?;
    state.set_master(Some(master));
    Ok(Value::Null)
}

/// Unlike Android, this proves the stored key straight away: opening with a raw
/// key costs no KDF, so there's no cold-start reason to defer it to loadNotes.
#[tauri::command]
pub async fn ns_check_status(state: State<'_, Storage>) -> CmdResult {
    let _op = state.exclusive()?;
    let is_configured = db::db_path(&state.dir).exists();
    let mut is_locked = true;
    if is_configured {
        if let Some(master) = state.keys.stored_master_key() {
            if state.open_verified(&master).is_ok() {
                state.set_master(Some(master));
                is_locked = false;
            } else {
                state.close();
            }
        }
    }
    Ok(json!({ "isConfigured": is_configured, "isLocked": is_locked }))
}

#[tauri::command]
pub async fn ns_change_encryption_key(state: State<'_, Storage>, old_pin: String, new_pin: String) -> CmdResult {
    let _op = state.exclusive()?;
    let master = if state.keys.has_v2_key()? {
        // The database key is the master key, which doesn't change: only its wrapping does.
        state.keys.change_pin(&old_pin, &new_pin)?
    } else {
        // Android's V1 path, where the PIN-derived key encrypted the database directly.
        let derived = state.keys.derive_local_kek(&new_pin)?;
        state.with_conn(|conn| db::change_key(conn, &derived))?;
        state.keys.upgrade_to_v2(&derived, &new_pin)?;
        derived
    };
    state.keys.store_master_key(&master)?;
    state.set_master(Some(master));
    Ok(Value::Null)
}

#[tauri::command]
pub async fn ns_export_master_key(state: State<'_, Storage>, pin: String) -> CmdResult {
    let _op = state.exclusive()?;
    let payload = state.keys.export_cloud_master_key(&pin)?;
    Ok(json!({ "payload": payload }))
}

#[tauri::command]
pub async fn ns_import_master_key(state: State<'_, Storage>, payload: String, pin: String) -> CmdResult {
    let _op = state.exclusive()?;
    let master = state.keys.import_cloud_master_key(&payload, &pin)?;
    // As on Android, reopen with the imported key without proving it here: the
    // caller has wiped or is about to replace the local data.
    state.close();
    let conn = db::open(&state.dir, &master)?;
    if db::verify(&conn).is_ok() {
        *state.conn.lock().map_err(|_| "Database lock poisoned")? = Some(conn);
    }
    state.set_master(Some(master));
    Ok(Value::Null)
}

#[tauri::command]
pub async fn ns_verify_cloud_master_key_match(state: State<'_, Storage>, payload: String, pin: String) -> CmdResult {
    let _op = state.exclusive()?;
    Ok(json!({ "isMatch": state.keys.verify_cloud_master_key_match(&payload, &pin) }))
}

#[tauri::command]
pub async fn ns_can_decrypt_cloud_master_key(payload: String, pin: String) -> CmdResult {
    Ok(json!({ "canDecrypt": KeyManager::can_decrypt_cloud_master_key(&payload, &pin) }))
}

#[tauri::command]
pub async fn ns_wipe_database_but_keep_keys(state: State<'_, Storage>) -> CmdResult {
    let _op = state.exclusive()?;
    state.delete_db_files()?;
    Ok(Value::Null)
}

#[tauri::command]
pub async fn ns_encrypt(state: State<'_, Storage>, data: String) -> CmdResult {
    let _op = state.exclusive()?;
    let master = state.current_master()?;
    Ok(json!({ "data": keys::encrypt_with(&master, data.as_bytes())? }))
}

#[tauri::command]
pub async fn ns_decrypt(state: State<'_, Storage>, data: String) -> CmdResult {
    let _op = state.exclusive()?;
    let master = state.current_master()?;
    let plain = keys::decrypt_with(&master, &data)?;
    let text = String::from_utf8(plain.to_vec()).map_err(|_| "Decrypted data is not text".to_string())?;
    Ok(json!({ "data": text }))
}

#[tauri::command]
pub async fn ns_lock(state: State<'_, Storage>) -> CmdResult {
    let _op = state.exclusive()?;
    state.keys.clear();
    state.set_master(None);
    state.close();
    Ok(Value::Null)
}

#[tauri::command]
pub async fn ns_clear_all_data(state: State<'_, Storage>) -> CmdResult {
    let _op = state.exclusive()?;
    state.delete_db_files()?;
    state.keys.clear_all()?;
    state.set_master(None);
    Ok(Value::Null)
}
