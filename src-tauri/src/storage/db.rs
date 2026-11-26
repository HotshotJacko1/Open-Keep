// Copyright (c) 2026. Licensed under AGPLv3.
//
// The SQLCipher notes database. Same `notes` table as Android's Room schema
// (data/NoteEntity.kt, version 4), and the same JSON shapes in and out as
// NoteStoragePlugin.kt, so src/lib/note-storage.ts can't tell them apart.

use std::path::{Path, PathBuf};

use rusqlite::{params, Connection, OpenFlags};
use serde_json::{json, Map, Value};

pub const DB_NAME: &str = "open-keep-db";

const SCHEMA_VERSION: i64 = 1;

pub fn db_path(dir: &Path) -> PathBuf {
    dir.join(DB_NAME)
}

/// The database file and every companion SQLite may leave beside it.
pub fn db_files(dir: &Path) -> Vec<PathBuf> {
    ["", "-wal", "-shm", "-journal"]
        .iter()
        .map(|suffix| dir.join(format!("{DB_NAME}{suffix}")))
        .collect()
}

/// Opens (creating if needed) with the raw 32-byte master key. SQLCipher only
/// checks the key on the first read, so callers that must know call `verify`.
pub fn open(dir: &Path, master: &[u8]) -> Result<Connection, String> {
    std::fs::create_dir_all(dir).map_err(|e| format!("Could not create data folder: {e}"))?;
    let conn = Connection::open_with_flags(
        db_path(dir),
        OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_CREATE | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|e| format!("Could not open database: {e}"))?;
    // x'..' is a raw key: SQLCipher uses it as is, with no passphrase KDF on top.
    conn.execute_batch(&format!("PRAGMA key = \"x'{}'\";", hex::encode(master)))
        .map_err(|e| format!("Could not set database key: {e}"))?;
    Ok(conn)
}

/// Proves the key by reading, then creates or upgrades the schema.
pub fn verify(conn: &Connection) -> Result<(), String> {
    conn.query_row("SELECT count(*) FROM sqlite_master", [], |r| r.get::<_, i64>(0))
        .map_err(|_| "Failed to open database. Incorrect PIN?".to_string())?;
    migrate(conn)
}

fn migrate(conn: &Connection) -> Result<(), String> {
    let version: i64 = conn
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    if version < 1 {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS notes (
                id TEXT NOT NULL PRIMARY KEY,
                title TEXT NOT NULL,
                content TEXT NOT NULL,
                type TEXT NOT NULL,
                createdAt INTEGER NOT NULL,
                updatedAt INTEGER NOT NULL,
                isPinned INTEGER NOT NULL,
                isArchived INTEGER NOT NULL,
                deleted INTEGER NOT NULL,
                tags TEXT NOT NULL,
                syncState TEXT NOT NULL,
                images TEXT NOT NULL DEFAULT '[]',
                reminder INTEGER,
                recurrence TEXT,
                color TEXT
            );",
        )
        .map_err(|e| format!("Could not create notes table: {e}"))?;
    }
    if version < SCHEMA_VERSION {
        conn.execute_batch(&format!("PRAGMA user_version = {SCHEMA_VERSION};"))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn json_array_or_empty(text: &str) -> Value {
    match serde_json::from_str::<Value>(text) {
        Ok(v @ Value::Array(_)) => v,
        _ => json!([]),
    }
}

pub fn load_notes(conn: &Connection) -> Result<Vec<Value>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, title, content, type, createdAt, updatedAt, isPinned, isArchived, deleted,
                    tags, images, reminder, recurrence, color
             FROM notes ORDER BY updatedAt DESC",
        )
        .map_err(|e| format!("Failed to load notes: {e}"))?;
    let rows = stmt
        .query_map([], |r| {
            let deleted: bool = r.get(8)?;
            let updated_at: i64 = r.get(5)?;
            let mut note = Map::new();
            note.insert("id".into(), json!(r.get::<_, String>(0)?));
            note.insert("title".into(), json!(r.get::<_, String>(1)?));
            note.insert("content".into(), json!(r.get::<_, String>(2)?));
            note.insert("type".into(), json!(r.get::<_, String>(3)?));
            note.insert("createdAt".into(), json!(r.get::<_, i64>(4)?));
            note.insert("updatedAt".into(), json!(updated_at));
            note.insert("isPinned".into(), json!(r.get::<_, bool>(6)?));
            note.insert("isArchived".into(), json!(r.get::<_, bool>(7)?));
            note.insert("isDeleted".into(), json!(deleted));
            if deleted {
                // As on Android: the move to the Bin is the note's last update.
                note.insert("deletedAt".into(), json!(updated_at));
            }
            note.insert("tags".into(), json_array_or_empty(&r.get::<_, String>(9)?));
            note.insert("images".into(), json_array_or_empty(&r.get::<_, String>(10)?));
            if let Some(reminder) = r.get::<_, Option<i64>>(11)? {
                note.insert("reminder".into(), json!(reminder));
            }
            if let Some(recurrence) = r.get::<_, Option<String>>(12)? {
                if let Ok(v @ Value::Object(_)) = serde_json::from_str::<Value>(&recurrence) {
                    note.insert("recurrence".into(), v);
                }
            }
            if let Some(color) = r.get::<_, Option<String>>(13)? {
                note.insert("color".into(), json!(color));
            }
            Ok(Value::Object(note))
        })
        .map_err(|e| format!("Failed to load notes: {e}"))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to load notes: {e}"))
}

fn str_field<'a>(note: &'a Value, key: &str) -> Option<&'a str> {
    note.get(key).and_then(Value::as_str)
}

/// Numbers arrive as JSON numbers, but older rows may have stringified them.
fn int_field(note: &Value, key: &str) -> Option<i64> {
    match note.get(key)? {
        Value::Number(n) => n.as_i64().or_else(|| n.as_f64().map(|f| f as i64)),
        Value::String(s) => s.trim().parse::<f64>().ok().map(|f| f as i64),
        _ => None,
    }
}

fn bool_field(note: &Value, key: &str) -> bool {
    match note.get(key) {
        Some(Value::Bool(b)) => *b,
        Some(Value::Number(n)) => n.as_i64().unwrap_or(0) != 0,
        Some(Value::String(s)) => s == "true" || s == "1",
        _ => false,
    }
}

fn array_text(note: &Value, key: &str) -> String {
    match note.get(key) {
        Some(v @ Value::Array(_)) => v.to_string(),
        Some(Value::String(s)) if s.trim_start().starts_with('[') => json_array_or_empty(s).to_string(),
        _ => "[]".into(),
    }
}

/// `replace`: saveNote overwrites; migrateFromWeb keeps a row that already exists.
pub fn upsert(conn: &Connection, note: &Value, sync_state: &str, replace: bool) -> Result<(), String> {
    let id = str_field(note, "id").filter(|s| !s.is_empty()).ok_or("Note id is missing")?;
    let verb = if replace { "INSERT OR REPLACE" } else { "INSERT OR IGNORE" };
    conn.execute(
        &format!(
            "{verb} INTO notes (id, title, content, type, createdAt, updatedAt, isPinned, isArchived, deleted,
                                tags, syncState, images, reminder, recurrence, color)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)"
        ),
        params![
            id,
            str_field(note, "title").unwrap_or(""),
            str_field(note, "content").unwrap_or(""),
            str_field(note, "type").unwrap_or("text"),
            int_field(note, "createdAt").unwrap_or(0),
            int_field(note, "updatedAt").unwrap_or(0),
            bool_field(note, "isPinned"),
            bool_field(note, "isArchived"),
            bool_field(note, "isDeleted"),
            array_text(note, "tags"),
            sync_state,
            array_text(note, "images"),
            int_field(note, "reminder"),
            note.get("recurrence").filter(|v| v.is_object()).map(Value::to_string),
            str_field(note, "color"),
        ],
    )
    .map_err(|e| format!("Failed to save note: {e}"))?;
    Ok(())
}

pub fn delete(conn: &Connection, id: &str) -> Result<(), String> {
    conn.execute("DELETE FROM notes WHERE id = ?1", params![id])
        .map_err(|e| format!("Failed to delete note: {e}"))?;
    Ok(())
}

pub fn bulk_insert(conn: &mut Connection, notes: &[Value]) -> Result<(), String> {
    let tx = conn.transaction().map_err(|e| format!("Migration failed: {e}"))?;
    for note in notes {
        upsert(&tx, note, "SYNCED", false)?;
    }
    tx.commit().map_err(|e| format!("Migration failed: {e}"))
}

pub fn change_key(conn: &Connection, master: &[u8]) -> Result<(), String> {
    conn.execute_batch(&format!("PRAGMA rekey = \"x'{}'\";", hex::encode(master)))
        .map_err(|e| format!("Could not re-key database: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("ok-db-test-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn notes_round_trip_and_file_is_encrypted() {
        let dir = temp_dir("roundtrip");
        let key = [3u8; 32];
        let conn = open(&dir, &key).unwrap();
        verify(&conn).unwrap();
        let note = json!({
            "id": "n1", "title": "Secret title", "content": "<p>secret body</p>", "type": "text",
            "createdAt": 1, "updatedAt": 2, "isPinned": true, "isArchived": false, "isDeleted": true,
            "tags": ["a", "b"], "images": ["images/x.jpg"], "reminder": 5,
            "recurrence": { "frequency": "daily" }, "color": "red"
        });
        upsert(&conn, &note, "PENDING", true).unwrap();
        let loaded = load_notes(&conn).unwrap();
        assert_eq!(loaded.len(), 1);
        let n = &loaded[0];
        assert_eq!(n["title"], "Secret title");
        assert_eq!(n["tags"], json!(["a", "b"]));
        assert_eq!(n["images"], json!(["images/x.jpg"]));
        assert_eq!(n["isDeleted"], true);
        assert_eq!(n["deletedAt"], 2);
        assert_eq!(n["recurrence"]["frequency"], "daily");
        drop(conn);

        let raw = std::fs::read(db_path(&dir)).unwrap();
        assert!(!raw.windows(6).any(|w| w == b"secret"), "plaintext found in database file");
        assert!(!raw.starts_with(b"SQLite format 3"), "database is not encrypted");

        let wrong = open(&dir, &[4u8; 32]).unwrap();
        assert!(verify(&wrong).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn migration_keeps_existing_rows() {
        let dir = temp_dir("migrate");
        let mut conn = open(&dir, &[5u8; 32]).unwrap();
        verify(&conn).unwrap();
        upsert(&conn, &json!({ "id": "a", "title": "device", "updatedAt": 9 }), "PENDING", true).unwrap();
        bulk_insert(&mut conn, &[json!({ "id": "a", "title": "web" }), json!({ "id": "b", "title": "web b" })]).unwrap();
        let loaded = load_notes(&conn).unwrap();
        assert_eq!(loaded.len(), 2);
        assert!(loaded.iter().any(|n| n["id"] == "a" && n["title"] == "device"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn rekey_keeps_data() {
        let dir = temp_dir("rekey");
        let conn = open(&dir, &[6u8; 32]).unwrap();
        verify(&conn).unwrap();
        upsert(&conn, &json!({ "id": "a", "title": "t" }), "PENDING", true).unwrap();
        change_key(&conn, &[7u8; 32]).unwrap();
        drop(conn);
        let conn = open(&dir, &[7u8; 32]).unwrap();
        verify(&conn).unwrap();
        assert_eq!(load_notes(&conn).unwrap().len(), 1);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
