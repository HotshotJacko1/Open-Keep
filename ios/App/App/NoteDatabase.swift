import Foundation
import SQLite

class NoteDatabase {
    static let shared = NoteDatabase()
    
    private var db: Connection?
    
    // Define table and columns
    private let notesTable = Table("notes")
    private let id = Expression<String>("id")
    private let title = Expression<String>("title")
    private let content = Expression<String>("content")
    private let type = Expression<String>("type")
    private let createdAt = Expression<Int64>("createdAt")
    private let updatedAt = Expression<Int64>("updatedAt")
    private let isPinned = Expression<Bool>("isPinned")
    private let isArchived = Expression<Bool>("isArchived")
    private let deleted = Expression<Bool>("deleted")
    private let tags = Expression<String>("tags")
    private let syncState = Expression<String>("syncState")
    private let images = Expression<String>("images")
    private let reminder = Expression<Int64?>("reminder")
    private let recurrence = Expression<String?>("recurrence")
    
    private init() {}
    
    func initialize(dbPath: String, key: [UInt8]) throws {
        print("NoteDatabase: Initializing database at \(dbPath)")
        
        let connection = try Connection(dbPath)
        
        // Apply SQLCipher key
        try connection.key(Blob(bytes: key))
        
        // Create table if not exists
        try connection.run(notesTable.create(ifNotExists: true) { t in
            t.column(id, primaryKey: true)
            t.column(title)
            t.column(content)
            t.column(type)
            t.column(createdAt)
            t.column(updatedAt)
            t.column(isPinned)
            t.column(isArchived)
            t.column(deleted)
            t.column(tags)
            t.column(syncState)
            t.column(images, defaultValue: "[]")
            t.column(reminder)
            t.column(recurrence)
        })
        
        // Handle migrations by checking if columns exist
        // (SQLite.swift doesn't have an automatic migration manager like Room, so we do it manually)
        let columns = try connection.prepare("PRAGMA table_info(notes)").map { $0[1] as! String }
        
        if !columns.contains("images") {
            try connection.run(notesTable.addColumn(images, defaultValue: "[]"))
        }
        if !columns.contains("reminder") {
            try connection.run(notesTable.addColumn(reminder))
        }
        if !columns.contains("recurrence") {
            try connection.run(notesTable.addColumn(recurrence))
        }
        
        self.db = connection
        print("NoteDatabase: Successfully initialized")
    }
    
    func reset() {
        self.db = nil
    }
    
    func isInitialized() -> Bool {
        return self.db != nil
    }
    
    func getAllNotes() throws -> [[String: Any]] {
        guard let db = self.db else { throw NSError(domain: "NoteDatabase", code: 1, userInfo: [NSLocalizedDescriptionKey: "Database not initialized"]) }
        
        var result = [[String: Any]]()
        for note in try db.prepare(notesTable.order(updatedAt.desc)) {
            var dict: [String: Any] = [
                "id": note[id],
                "title": note[title],
                "content": note[content],
                "type": note[type],
                "createdAt": note[createdAt],
                "updatedAt": note[updatedAt],
                "isPinned": note[isPinned],
                "isArchived": note[isArchived],
                "isDeleted": note[deleted],
                "syncState": note[syncState]
            ]
            
            // Handle JSON arrays/objects parsing to avoid double-encoding strings when returned to JS
            let tagsString = note[tags]
            if let tagsData = tagsString.data(using: .utf8),
               let tagsArray = try? JSONSerialization.jsonObject(with: tagsData, options: []) as? [String] {
                dict["tags"] = tagsArray
            } else {
                dict["tags"] = []
            }
            
            let imagesString = note[images]
            if let imagesData = imagesString.data(using: .utf8),
               let imagesArray = try? JSONSerialization.jsonObject(with: imagesData, options: []) as? [Any] {
                dict["images"] = imagesArray
            } else {
                dict["images"] = []
            }
            
            if let rem = note[reminder] {
                dict["reminder"] = rem
            }
            
            if let rec = note[recurrence],
               let recData = rec.data(using: .utf8),
               let recObj = try? JSONSerialization.jsonObject(with: recData, options: []) as? [String: Any] {
                dict["recurrence"] = recObj
            }
            
            if note[deleted] {
                dict["deletedAt"] = note[updatedAt]
            }
            
            result.append(dict)
        }
        
        return result
    }
    
    func saveNote(dict: [String: Any]) throws {
        guard let db = self.db else { throw NSError(domain: "NoteDatabase", code: 1, userInfo: [NSLocalizedDescriptionKey: "Database not initialized"]) }
        
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
        
        let noteReminder = dict["reminder"] as? Int64
        
        var recurrenceStr: String? = nil
        if let recDict = dict["recurrence"] as? [String: Any] {
            if let recData = try? JSONSerialization.data(withJSONObject: recDict, options: []) {
                recurrenceStr = String(data: recData, encoding: .utf8)
            }
        }
        
        let setter = [
            id <- noteId,
            title <- noteTitle,
            content <- noteContent,
            type <- noteType,
            createdAt <- noteCreatedAt,
            updatedAt <- noteUpdatedAt,
            isPinned <- noteIsPinned,
            isArchived <- noteIsArchived,
            deleted <- noteIsDeleted,
            tags <- tagsStr,
            syncState <- "PENDING",
            images <- imagesStr,
            reminder <- noteReminder,
            recurrence <- recurrenceStr
        ]
        
        try db.run(notesTable.insert(or: .replace, setter))
    }
    
    func deleteNote(noteId: String) throws {
        guard let db = self.db else { throw NSError(domain: "NoteDatabase", code: 1, userInfo: [NSLocalizedDescriptionKey: "Database not initialized"]) }
        
        let note = notesTable.filter(id == noteId)
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        try db.run(note.update(deleted <- true, updatedAt <- now, syncState <- "PENDING"))
    }
    
    func bulkInsert(notesList: [[String: Any]]) throws {
        guard let db = self.db else { throw NSError(domain: "NoteDatabase", code: 1, userInfo: [NSLocalizedDescriptionKey: "Database not initialized"]) }
        
        try db.transaction {
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
                
                let noteReminder = dict["reminder"] as? Int64
                
                var recurrenceStr: String? = nil
                if let recDict = dict["recurrence"] as? [String: Any] {
                    if let recData = try? JSONSerialization.data(withJSONObject: recDict, options: []) {
                        recurrenceStr = String(data: recData, encoding: .utf8)
                    }
                }
                
                let setter = [
                    id <- noteId,
                    title <- noteTitle,
                    content <- noteContent,
                    type <- noteType,
                    createdAt <- noteCreatedAt,
                    updatedAt <- noteUpdatedAt,
                    isPinned <- noteIsPinned,
                    isArchived <- noteIsArchived,
                    deleted <- noteIsDeleted,
                    tags <- tagsStr,
                    syncState <- "SYNCED",
                    images <- "[]", // Default for migrated
                    reminder <- noteReminder,
                    recurrence <- recurrenceStr
                ]
                
                try db.run(notesTable.insert(or: .ignore, setter))
            }
        }
    }
    
    func changePassword(newKey: [UInt8]) throws {
        guard let db = self.db else { throw NSError(domain: "NoteDatabase", code: 1, userInfo: [NSLocalizedDescriptionKey: "Database not initialized"]) }
        
        try db.rekey(Blob(bytes: newKey))
    }
    
    func clearAllTables() throws {
        guard let db = self.db else { throw NSError(domain: "NoteDatabase", code: 1, userInfo: [NSLocalizedDescriptionKey: "Database not initialized"]) }
        try db.run(notesTable.delete())
    }
}
