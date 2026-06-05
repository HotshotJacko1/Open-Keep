import Foundation
import SQLCipher


class NoteDatabase {
    static let shared = NoteDatabase()
    
    private var db: OpaquePointer?
    
    private init() {}
    
    func initialize(dbPath: String, key: [UInt8]) throws {
        print("NoteDatabase: Initializing database at \(dbPath)")
        
        var connection: OpaquePointer?
        let flags = SQLITE_OPEN_CREATE | SQLITE_OPEN_READWRITE | SQLITE_OPEN_FULLMUTEX
        if sqlite3_open_v2(dbPath, &connection, flags, nil) != SQLITE_OK {
            throw NSError(domain: "NoteDatabase", code: 1, userInfo: [NSLocalizedDescriptionKey: "Failed to open database"])
        }
        
        self.db = connection
        
        // Apply SQLCipher key via PRAGMA SQL API.
        // This avoids the C-level sqlite3_key() call which is gated by SQLITE_HAS_CODEC
        // and not surfaced through the Swift module interface. The PRAGMA approach is
        // fully supported by SQLCipher and goes through sqlite3_exec which IS exported.
        let hexKey = key.map { String(format: "%02x", $0) }.joined()
        let keyPragma = "PRAGMA key = \"x'\(hexKey)'\";"
        if sqlite3_exec(connection, keyPragma, nil, nil, nil) != SQLITE_OK {
            sqlite3_close(connection)
            self.db = nil
            throw NSError(domain: "NoteDatabase", code: 2, userInfo: [NSLocalizedDescriptionKey: "Failed to set encryption key"])
        }
        
        // Test key (SQLCipher needs to run a query to verify the key is correct)
        if sqlite3_exec(connection, "SELECT count(*) FROM sqlite_master;", nil, nil, nil) != SQLITE_OK {
            sqlite3_close(connection)
            self.db = nil
            throw NSError(domain: "NoteDatabase", code: 2, userInfo: [NSLocalizedDescriptionKey: "Invalid encryption key"])
        }
        
        // Create table
        let createTableSql = """
        CREATE TABLE IF NOT EXISTS notes (
            id TEXT PRIMARY KEY,
            title TEXT,
            content TEXT,
            type TEXT,
            createdAt INTEGER,
            updatedAt INTEGER,
            isPinned INTEGER,
            isArchived INTEGER,
            deleted INTEGER,
            tags TEXT,
            syncState TEXT,
            images TEXT DEFAULT '[]',
            reminder INTEGER,
            recurrence TEXT
        );
        """
        if sqlite3_exec(connection, createTableSql, nil, nil, nil) != SQLITE_OK {
            throw NSError(domain: "NoteDatabase", code: 3, userInfo: [NSLocalizedDescriptionKey: "Failed to create table"])
        }
        
        // Migrations
        try ensureColumnExists(columnName: "images", columnType: "TEXT DEFAULT '[]'")
        try ensureColumnExists(columnName: "reminder", columnType: "INTEGER")
        try ensureColumnExists(columnName: "recurrence", columnType: "TEXT")
        
        print("NoteDatabase: Successfully initialized")
    }
    
    private func ensureColumnExists(columnName: String, columnType: String) throws {
        guard let db = self.db else { return }
        
        var stmt: OpaquePointer?
        if sqlite3_prepare_v2(db, "PRAGMA table_info(notes);", -1, &stmt, nil) == SQLITE_OK {
            var exists = false
            while sqlite3_step(stmt) == SQLITE_ROW {
                if let nameCStr = sqlite3_column_text(stmt, 1) {
                    let name = String(cString: UnsafeRawPointer(nameCStr).assumingMemoryBound(to: CChar.self))
                    if name == columnName {
                        exists = true
                        break
                    }
                }
            }
            sqlite3_finalize(stmt)
            
            if !exists {
                let addColSql = "ALTER TABLE notes ADD COLUMN \(columnName) \(columnType);"
                sqlite3_exec(db, addColSql, nil, nil, nil)
            }
        }
    }
    
    func reset() {
        if let db = self.db {
            sqlite3_close(db)
        }
        self.db = nil
    }
    
    func isInitialized() -> Bool {
        return self.db != nil
    }
    
    private func getString(stmt: OpaquePointer, index: Int32) -> String {
        guard let cString = sqlite3_column_text(stmt, index) else { return "" }
        return String(cString: UnsafeRawPointer(cString).assumingMemoryBound(to: CChar.self))
    }
    
    func getAllNotes() throws -> [[String: Any]] {
        guard let db = self.db else { throw NSError(domain: "NoteDatabase", code: 1, userInfo: [NSLocalizedDescriptionKey: "Database not initialized"]) }
        
        let query = "SELECT id, title, content, type, createdAt, updatedAt, isPinned, isArchived, deleted, tags, syncState, images, reminder, recurrence FROM notes ORDER BY updatedAt DESC;"
        var stmt: OpaquePointer?
        
        if sqlite3_prepare_v2(db, query, -1, &stmt, nil) != SQLITE_OK {
            throw NSError(domain: "NoteDatabase", code: 4, userInfo: [NSLocalizedDescriptionKey: "Failed to prepare select query"])
        }
        
        var result = [[String: Any]]()
        while sqlite3_step(stmt) == SQLITE_ROW {
            let deletedBool = sqlite3_column_int(stmt, 8) != 0
            var dict: [String: Any] = [
                "id": getString(stmt: stmt!, index: 0),
                "title": getString(stmt: stmt!, index: 1),
                "content": getString(stmt: stmt!, index: 2),
                "type": getString(stmt: stmt!, index: 3),
                "createdAt": sqlite3_column_int64(stmt, 4),
                "updatedAt": sqlite3_column_int64(stmt, 5),
                "isPinned": sqlite3_column_int(stmt, 6) != 0,
                "isArchived": sqlite3_column_int(stmt, 7) != 0,
                "isDeleted": deletedBool,
                "syncState": getString(stmt: stmt!, index: 10)
            ]
            
            let tagsString = getString(stmt: stmt!, index: 9)
            if let tagsData = tagsString.data(using: .utf8),
               let tagsArray = try? JSONSerialization.jsonObject(with: tagsData, options: []) as? [String] {
                dict["tags"] = tagsArray
            } else {
                dict["tags"] = []
            }
            
            let imagesString = getString(stmt: stmt!, index: 11)
            if let imagesData = imagesString.data(using: .utf8),
               let imagesArray = try? JSONSerialization.jsonObject(with: imagesData, options: []) as? [Any] {
                dict["images"] = imagesArray
            } else {
                dict["images"] = []
            }
            
            if sqlite3_column_type(stmt, 12) != SQLITE_NULL {
                dict["reminder"] = sqlite3_column_int64(stmt, 12)
            }
            
            if sqlite3_column_type(stmt, 13) != SQLITE_NULL {
                let rec = getString(stmt: stmt!, index: 13)
                if let recData = rec.data(using: .utf8),
                   let recObj = try? JSONSerialization.jsonObject(with: recData, options: []) as? [String: Any] {
                    dict["recurrence"] = recObj
                }
            }
            
            if deletedBool {
                dict["deletedAt"] = dict["updatedAt"]
            }
            
            result.append(dict)
        }
        sqlite3_finalize(stmt)
        
        return result
    }
    
    private func bindString(_ stmt: OpaquePointer, index: Int32, value: String?) {
        if let val = value {
            sqlite3_bind_text(stmt, index, (val as NSString).utf8String, -1, nil)
        } else {
            sqlite3_bind_null(stmt, index)
        }
    }
    
    func saveNote(dict: [String: Any]) throws {
        guard let db = self.db else { throw NSError(domain: "NoteDatabase", code: 1, userInfo: [NSLocalizedDescriptionKey: "Database not initialized"]) }
        
        let query = """
        INSERT OR REPLACE INTO notes (id, title, content, type, createdAt, updatedAt, isPinned, isArchived, deleted, tags, syncState, images, reminder, recurrence)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
        """
        
        var stmt: OpaquePointer?
        if sqlite3_prepare_v2(db, query, -1, &stmt, nil) != SQLITE_OK {
            throw NSError(domain: "NoteDatabase", code: 5, userInfo: [NSLocalizedDescriptionKey: "Failed to prepare insert query"])
        }
        
        let noteId = dict["id"] as? String ?? ""
        let noteTitle = dict["title"] as? String ?? ""
        let noteContent = dict["content"] as? String ?? ""
        let noteType = dict["type"] as? String ?? "TEXT"
        let noteCreatedAt = dict["createdAt"] as? Int64 ?? Int64(Date().timeIntervalSince1970 * 1000)
        let noteUpdatedAt = dict["updatedAt"] as? Int64 ?? Int64(Date().timeIntervalSince1970 * 1000)
        let noteIsPinned = dict["isPinned"] as? Bool ?? false
        let noteIsArchived = dict["isArchived"] as? Bool ?? false
        let noteIsDeleted = dict["isDeleted"] as? Bool ?? false
        
        let tagsArray = dict["tags"] as? [String] ?? []
        let tagsData = try JSONSerialization.data(withJSONObject: tagsArray, options: [])
        let tagsStr = String(data: tagsData, encoding: .utf8) ?? "[]"
        
        let imagesArray = dict["images"] as? [Any] ?? []
        let imagesData = try JSONSerialization.data(withJSONObject: imagesArray, options: [])
        let imagesStr = String(data: imagesData, encoding: .utf8) ?? "[]"
        
        var recurrenceStr: String? = nil
        if let recDict = dict["recurrence"] as? [String: Any] {
            if let recData = try? JSONSerialization.data(withJSONObject: recDict, options: []) {
                recurrenceStr = String(data: recData, encoding: .utf8)
            }
        }
        
        bindString(stmt!, index: 1, value: noteId)
        bindString(stmt!, index: 2, value: noteTitle)
        bindString(stmt!, index: 3, value: noteContent)
        bindString(stmt!, index: 4, value: noteType)
        sqlite3_bind_int64(stmt, 5, noteCreatedAt)
        sqlite3_bind_int64(stmt, 6, noteUpdatedAt)
        sqlite3_bind_int(stmt, 7, noteIsPinned ? 1 : 0)
        sqlite3_bind_int(stmt, 8, noteIsArchived ? 1 : 0)
        sqlite3_bind_int(stmt, 9, noteIsDeleted ? 1 : 0)
        bindString(stmt!, index: 10, value: tagsStr)
        bindString(stmt!, index: 11, value: "PENDING")
        bindString(stmt!, index: 12, value: imagesStr)
        
        if let noteReminder = dict["reminder"] as? Int64 {
            sqlite3_bind_int64(stmt, 13, noteReminder)
        } else {
            sqlite3_bind_null(stmt, 13)
        }
        
        bindString(stmt!, index: 14, value: recurrenceStr)
        
        if sqlite3_step(stmt) != SQLITE_DONE {
            sqlite3_finalize(stmt)
            throw NSError(domain: "NoteDatabase", code: 6, userInfo: [NSLocalizedDescriptionKey: "Failed to execute insert"])
        }
        sqlite3_finalize(stmt)
    }
    
    func deleteNote(noteId: String) throws {
        guard let db = self.db else { throw NSError(domain: "NoteDatabase", code: 1, userInfo: [NSLocalizedDescriptionKey: "Database not initialized"]) }
        
        let query = "UPDATE notes SET deleted = 1, updatedAt = ?, syncState = 'PENDING' WHERE id = ?;"
        var stmt: OpaquePointer?
        if sqlite3_prepare_v2(db, query, -1, &stmt, nil) != SQLITE_OK {
            throw NSError(domain: "NoteDatabase", code: 7, userInfo: [NSLocalizedDescriptionKey: "Failed to prepare delete query"])
        }
        
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        sqlite3_bind_int64(stmt, 1, now)
        bindString(stmt!, index: 2, value: noteId)
        
        if sqlite3_step(stmt) != SQLITE_DONE {
            sqlite3_finalize(stmt)
            throw NSError(domain: "NoteDatabase", code: 8, userInfo: [NSLocalizedDescriptionKey: "Failed to execute delete"])
        }
        sqlite3_finalize(stmt)
    }
    
    func bulkInsert(notesList: [[String: Any]]) throws {
        guard let db = self.db else { throw NSError(domain: "NoteDatabase", code: 1, userInfo: [NSLocalizedDescriptionKey: "Database not initialized"]) }
        
        sqlite3_exec(db, "BEGIN TRANSACTION;", nil, nil, nil)
        
        let query = """
        INSERT OR IGNORE INTO notes (id, title, content, type, createdAt, updatedAt, isPinned, isArchived, deleted, tags, syncState, images, reminder, recurrence)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
        """
        
        var stmt: OpaquePointer?
        if sqlite3_prepare_v2(db, query, -1, &stmt, nil) != SQLITE_OK {
            sqlite3_exec(db, "ROLLBACK;", nil, nil, nil)
            throw NSError(domain: "NoteDatabase", code: 9, userInfo: [NSLocalizedDescriptionKey: "Failed to prepare bulk insert query"])
        }
        
        for dict in notesList {
            let noteId = dict["id"] as? String ?? ""
            let noteTitle = dict["title"] as? String ?? ""
            let noteContent = dict["content"] as? String ?? ""
            let noteType = dict["type"] as? String ?? "TEXT"
            let noteCreatedAt = dict["createdAt"] as? Int64 ?? Int64(Date().timeIntervalSince1970 * 1000)
            let noteUpdatedAt = dict["updatedAt"] as? Int64 ?? Int64(Date().timeIntervalSince1970 * 1000)
            let noteIsPinned = dict["isPinned"] as? Bool ?? false
            let noteIsArchived = dict["isArchived"] as? Bool ?? false
            let noteIsDeleted = dict["isDeleted"] as? Bool ?? false
            
            let tagsArray = dict["tags"] as? [String] ?? []
            let tagsData = try JSONSerialization.data(withJSONObject: tagsArray, options: [])
            let tagsStr = String(data: tagsData, encoding: .utf8) ?? "[]"
            
            var recurrenceStr: String? = nil
            if let recDict = dict["recurrence"] as? [String: Any] {
                if let recData = try? JSONSerialization.data(withJSONObject: recDict, options: []) {
                    recurrenceStr = String(data: recData, encoding: .utf8)
                }
            }
            
            bindString(stmt!, index: 1, value: noteId)
            bindString(stmt!, index: 2, value: noteTitle)
            bindString(stmt!, index: 3, value: noteContent)
            bindString(stmt!, index: 4, value: noteType)
            sqlite3_bind_int64(stmt, 5, noteCreatedAt)
            sqlite3_bind_int64(stmt, 6, noteUpdatedAt)
            sqlite3_bind_int(stmt, 7, noteIsPinned ? 1 : 0)
            sqlite3_bind_int(stmt, 8, noteIsArchived ? 1 : 0)
            sqlite3_bind_int(stmt, 9, noteIsDeleted ? 1 : 0)
            bindString(stmt!, index: 10, value: tagsStr)
            bindString(stmt!, index: 11, value: "SYNCED")
            bindString(stmt!, index: 12, value: "[]")
            
            if let noteReminder = dict["reminder"] as? Int64 {
                sqlite3_bind_int64(stmt, 13, noteReminder)
            } else {
                sqlite3_bind_null(stmt, 13)
            }
            
            bindString(stmt!, index: 14, value: recurrenceStr)
            
            if sqlite3_step(stmt) != SQLITE_DONE {
                // Ignore single insert error, continue bulk insert
            }
            sqlite3_reset(stmt)
            sqlite3_clear_bindings(stmt)
        }
        
        sqlite3_finalize(stmt)
        sqlite3_exec(db, "COMMIT;", nil, nil, nil)
    }
    
    func changePassword(newKey: [UInt8]) throws {
        guard let db = self.db else { throw NSError(domain: "NoteDatabase", code: 1, userInfo: [NSLocalizedDescriptionKey: "Database not initialized"]) }
        
        // Use PRAGMA rekey SQL API instead of C-level sqlite3_rekey() for same reasons as PRAGMA key.
        let hexKey = newKey.map { String(format: "%02x", $0) }.joined()
        let rekeyPragma = "PRAGMA rekey = \"x'\(hexKey)'\";"
        if sqlite3_exec(db, rekeyPragma, nil, nil, nil) != SQLITE_OK {
            throw NSError(domain: "NoteDatabase", code: 10, userInfo: [NSLocalizedDescriptionKey: "Failed to change encryption key"])
        }
    }
    
    func clearAllTables() throws {
        guard let db = self.db else { throw NSError(domain: "NoteDatabase", code: 1, userInfo: [NSLocalizedDescriptionKey: "Database not initialized"]) }
        sqlite3_exec(db, "DELETE FROM notes;", nil, nil, nil)
    }
}
