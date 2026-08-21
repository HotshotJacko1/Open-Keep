import Foundation

// sqlite3_* (including sqlite3_key) is provided by the SQLCipher package via the
// widget's bridging header (OpenKeepWidget-Bridging-Header.h), matching the main app.

/// Lightweight SQLCipher reader used by the widget extension to query notes
/// from the encrypted database. Does NOT use the app's NoteDatabase singleton
/// because the widget runs in its own process.
class WidgetDatabaseReader {
    private var db: OpaquePointer?

    /// Open the encrypted database with the given master key.
    /// - Returns: true if opened and keyed successfully.
    func open(path: String, key: [UInt8]) -> Bool {
        guard FileManager.default.fileExists(atPath: path) else {
            return false
        }

        var connection: OpaquePointer?
        let flags = SQLITE_OPEN_READWRITE | SQLITE_OPEN_FULLMUTEX

        guard sqlite3_open_v2(path, &connection, flags, nil) == SQLITE_OK else {
            return false
        }

        self.db = connection

        // Apply the encryption key via sqlite3_key
        let keyData = Data(key)
        let keyStatus = keyData.withUnsafeBytes { ptr -> Int32 in
            sqlite3_key(connection, ptr.baseAddress, Int32(key.count))
        }

        guard keyStatus == SQLITE_OK else {
            sqlite3_close(connection)
            self.db = nil
            return false
        }

        // Test — run a query to verify the key
        guard sqlite3_exec(connection, "SELECT count(*) FROM sqlite_master;", nil, nil, nil) == SQLITE_OK else {
            sqlite3_close(connection)
            self.db = nil
            return false
        }

        return true
    }

    /// Fetch all non-deleted, non-archived notes, sorted by isPinned DESC, updatedAt DESC.
    func fetchFilteredNotes(excludeArchived: Bool = true) -> [[String: Any]] {
        guard let db = self.db else { return [] }

        var conditions = "deleted = 0"
        if excludeArchived {
            conditions += " AND isArchived = 0"
        }

        let query = """
        SELECT id, title, content, type, updatedAt, isPinned, isArchived, deleted, tags
        FROM notes
        WHERE \(conditions)
        ORDER BY isPinned DESC, updatedAt DESC;
        """

        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db, query, -1, &stmt, nil) == SQLITE_OK else {
            return []
        }

        var results = [[String: Any]]()
        while sqlite3_step(stmt) == SQLITE_ROW {
            var dict = [String: Any]()
            dict["id"] = stringColumn(stmt!, index: 0)
            dict["title"] = stringColumn(stmt!, index: 1)
            dict["content"] = stringColumn(stmt!, index: 2)
            dict["type"] = stringColumn(stmt!, index: 3)
            dict["updatedAt"] = sqlite3_column_int64(stmt, 4)
            dict["isPinned"] = sqlite3_column_int(stmt, 5) != 0
            dict["isArchived"] = sqlite3_column_int(stmt, 6) != 0
            dict["isDeleted"] = sqlite3_column_int(stmt, 7) != 0

            let tagsStr = stringColumn(stmt!, index: 8)
            if let tagsData = tagsStr.data(using: .utf8),
               let tagsArray = try? JSONSerialization.jsonObject(with: tagsData) as? [String] {
                dict["tags"] = tagsArray
            } else {
                dict["tags"] = [String]()
            }

            results.append(dict)
        }
        sqlite3_finalize(stmt)
        return results
    }

    /// Toggle a checkbox in a note's content at the given line index.
    func toggleCheckbox(noteId: String, lineIndex: Int) {
        guard let db = self.db else { return }

        // Get current content
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db, "SELECT content FROM notes WHERE id = ?;", -1, &stmt, nil) == SQLITE_OK else {
            return
        }
        sqlite3_bind_text(stmt, 1, (noteId as NSString).utf8String, -1, nil)

        var content: String?
        if sqlite3_step(stmt) == SQLITE_ROW {
            content = stringColumn(stmt!, index: 0)
        }
        sqlite3_finalize(stmt)

        guard var lines = content?.split(separator: "\n").map(String.init) else { return }
        guard lineIndex >= 0 && lineIndex < lines.count else { return }

        let line = lines[lineIndex]
        let checkboxRe = try! NSRegularExpression(pattern: "^(\\s*)-\\s\\[([ xX])\\]\\s(.*)$", options: [])
        let range = NSRange(location: 0, length: line.utf16.count)

        if let match = checkboxRe.firstMatch(in: line, options: [], range: range) {
            let indentRange = Range(match.range(at: 1), in: line)!
            let checkedRange = Range(match.range(at: 2), in: line)!
            let textRange = Range(match.range(at: 3), in: line)!

            let indent = String(line[indentRange])
            let checked = String(line[checkedRange]).lowercased() == "x"
            let text = String(line[textRange])

            let newChecked = checked ? " " : "x"
            lines[lineIndex] = "\(indent)- [\(newChecked)] \(text)"
        }

        let newContent = lines.joined(separator: "\n")
        let now = Int64(Date().timeIntervalSince1970 * 1000)

        var updateStmt: OpaquePointer?
        guard sqlite3_prepare_v2(db, "UPDATE notes SET content = ?, updatedAt = ?, syncState = 'PENDING' WHERE id = ?;", -1, &updateStmt, nil) == SQLITE_OK else {
            return
        }
        sqlite3_bind_text(updateStmt, 1, (newContent as NSString).utf8String, -1, nil)
        sqlite3_bind_int64(updateStmt, 2, now)
        sqlite3_bind_text(updateStmt, 3, (noteId as NSString).utf8String, -1, nil)
        sqlite3_step(updateStmt)
        sqlite3_finalize(updateStmt)
    }

    /// Returns sorted unique tag names from all non-deleted, non-archived notes.
    func fetchDistinctTags() -> [String] {
        let notes = fetchFilteredNotes()
        var tagSet = Set<String>()
        for note in notes {
            if let tags = note["tags"] as? [String] {
                tags.forEach { tagSet.insert($0) }
            }
        }
        return tagSet.sorted()
    }

    func close() {
        if let db = self.db {
            sqlite3_close(db)
        }
        self.db = nil
    }

    private func stringColumn(_ stmt: OpaquePointer, index: Int32) -> String {
        guard let cString = sqlite3_column_text(stmt, index) else { return "" }
        return String(cString: cString)
    }
}