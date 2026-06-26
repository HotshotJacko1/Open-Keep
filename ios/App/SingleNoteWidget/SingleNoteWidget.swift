import WidgetKit
import SwiftUI
import AppIntents
import Foundation
import SQLite3

// SQLCipher: sqlite3_key is conditionally declared in the header under SQLITE_HAS_CODEC.
// The pre-compiled SQLCipher module strips it, so we use @_silgen_name to bind directly.
@_silgen_name("sqlite3_key")
private func sqlite3_key(_ db: OpaquePointer?, _ pKey: UnsafeRawPointer?, _ nKey: Int32) -> Int32

// MARK: - App Group Constants

private let appGroupIdentifier = "group.com.jackbarkerapps.openkeep"
private let dbFileName = "open-keep-db.sqlite3"

// MARK: - Shared Database Helpers

/// Returns the database file URL inside the shared App Group container.
private func sharedDatabasePath() -> URL? {
    guard let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroupIdentifier) else {
        return nil
    }
    return container.appendingPathComponent(dbFileName)
}

/// Opens and returns a pointer to the encrypted SQLCipher database.
/// Returns `nil` if the key cannot be retrieved from the shared keychain.
private func openSharedDatabase() -> OpaquePointer? {
    guard let dbURL = sharedDatabasePath() else {
        print("[SingleNoteWidget] Failed to get shared container URL")
        return nil
    }

    let dbPath = dbURL.path
    guard FileManager.default.fileExists(atPath: dbPath) else {
        print("[SingleNoteWidget] Database file not found at \(dbPath)")
        return nil
    }

    guard let masterKey = retrieveMasterKeyFromSharedKeychain() else {
        print("[SingleNoteWidget] Failed to retrieve master key")
        return nil
    }

    var db: OpaquePointer?
    let flags = SQLITE_OPEN_READWRITE | SQLITE_OPEN_FULLMUTEX
    guard sqlite3_open_v2(dbPath, &db, flags, nil) == SQLITE_OK else {
        print("[SingleNoteWidget] Failed to open database")
        return nil
    }

    // Apply encryption key
    let keyData = Data(masterKey)
    let result = keyData.withUnsafeBytes { ptr -> Int32 in
        sqlite3_key(db, ptr.baseAddress, Int32(masterKey.count))
    }

    if result != SQLITE_OK {
        print("[SingleNoteWidget] Failed to apply encryption key")
        sqlite3_close(db)
        return nil
    }

    // Verify key by running a test query
    var stmt: OpaquePointer?
    let verifySql = "SELECT count(*) FROM sqlite_master;"
    if sqlite3_prepare_v2(db, verifySql, -1, &stmt, nil) != SQLITE_OK {
        print("[SingleNoteWidget] Key verification failed")
        sqlite3_close(db)
        return nil
    }
    let stepResult = sqlite3_step(stmt)
    sqlite3_finalize(stmt)

    if stepResult != SQLITE_ROW {
        print("[SingleNoteWidget] Key verification step failed")
        sqlite3_close(db)
        return nil
    }

    return db
}

private func closeDatabase(_ db: OpaquePointer?) {
    guard let db = db else { return }
    sqlite3_close(db)
}

/// Retrieves the master encryption key from the shared App Group UserDefaults.
/// The main app stores the key there via KeyManager.storeMasterKey().
private func retrieveMasterKeyFromSharedKeychain() -> [UInt8]? {
    guard let sharedDefaults = UserDefaults(suiteName: appGroupIdentifier),
          let encodedKey = sharedDefaults.string(forKey: "shared_master_key"),
          let keyData = Data(base64Encoded: encodedKey) else {
        return nil
    }
    return [UInt8](keyData)
}

/// Query the database for the list of all non-deleted notes.
private func fetchAllNotes() -> [(id: String, title: String, preview: String)] {
    guard let db = openSharedDatabase() else { return [] }
    defer { closeDatabase(db) }

    let query = """
    SELECT id, title, content FROM notes
    WHERE deleted = 0
    ORDER BY updatedAt DESC;
    """

    var stmt: OpaquePointer?
    guard sqlite3_prepare_v2(db, query, -1, &stmt, nil) == SQLITE_OK else {
        return []
    }
    defer { sqlite3_finalize(stmt) }

    var notes: [(id: String, title: String, preview: String)] = []
    while sqlite3_step(stmt) == SQLITE_ROW {
        let id = sqlite3_column_text(stmt, 0).map { String(cString: $0 as! UnsafePointer<CChar>) } ?? ""
        let title = sqlite3_column_text(stmt, 1).map { String(cString: $0 as! UnsafePointer<CChar>) } ?? ""
        let content = sqlite3_column_text(stmt, 2).map { String(cString: $0 as! UnsafePointer<CChar>) } ?? ""

        let displayTitle = title.isEmpty
            ? content.components(separatedBy: "\n").first?.trimmingCharacters(in: .whitespaces).prefix(60) ?? "Untitled"
            : title
        let preview = content.components(separatedBy: "\n")
            .first(where: { !$0.trimmingCharacters(in: .whitespaces).isEmpty })?
            .trimmingCharacters(in: .whitespaces).prefix(80) ?? ""

        notes.append((id: id, title: String(displayTitle), preview: String(preview)))
    }

    return notes
}

/// Fetch a single note's data from the database by ID.
private func fetchNoteById(_ noteId: String) -> (title: String, content: String)? {
    guard let db = openSharedDatabase() else { return nil }
    defer { closeDatabase(db) }

    let query = "SELECT title, content FROM notes WHERE id = ? AND deleted = 0;"
    var stmt: OpaquePointer?
    guard sqlite3_prepare_v2(db, query, -1, &stmt, nil) == SQLITE_OK else { return nil }
    defer { sqlite3_finalize(stmt) }

    sqlite3_bind_text(stmt, 1, (noteId as NSString).utf8String, -1, nil)

    guard sqlite3_step(stmt) == SQLITE_ROW else { return nil }

    let title = sqlite3_column_text(stmt, 0).map { String(cString: $0 as! UnsafePointer<CChar>) } ?? ""
    let content = sqlite3_column_text(stmt, 1).map { String(cString: $0 as! UnsafePointer<CChar>) } ?? ""

    return (title, content)
}

/// Toggle a checklist line in the database.
private func toggleChecklistLine(noteId: String, lineIndex: Int) -> Bool {
    guard let db = openSharedDatabase() else { return false }
    defer { closeDatabase(db) }

    // Fetch current content
    let selectQuery = "SELECT content FROM notes WHERE id = ?;"
    var selectStmt: OpaquePointer?
    guard sqlite3_prepare_v2(db, selectQuery, -1, &selectStmt, nil) == SQLITE_OK else { return false }
    sqlite3_bind_text(selectStmt, 1, (noteId as NSString).utf8String, -1, nil)

    var content: String?
    if sqlite3_step(selectStmt) == SQLITE_ROW {
        content = sqlite3_column_text(selectStmt, 0).map { String(cString: $0 as! UnsafePointer<CChar>) }
    }
    sqlite3_finalize(selectStmt)

    guard let originalContent = content else { return false }

    var lines = originalContent.components(separatedBy: "\n")
    guard lineIndex >= 0, lineIndex < lines.count else { return false }

    let line = lines[lineIndex]
    let trimmed = line.trimmingCharacters(in: .whitespaces)
    let indent = String(line.prefix(line.count - trimmed.count))

    let toggled: String
    if trimmed.hasPrefix("- [ ]") {
        toggled = indent + trimmed.replacingOccurrences(of: "- [ ]", with: "- [x]")
    } else if trimmed.hasPrefix("- [x]") {
        toggled = indent + trimmed.replacingOccurrences(of: "- [x]", with: "- [ ]")
    } else {
        return false // Not a checklist line
    }

    lines[lineIndex] = toggled
    let newContent = lines.joined(separator: "\n")
    let now = Int64(Date().timeIntervalSince1970 * 1000)

    let updateQuery = "UPDATE notes SET content = ?, updatedAt = ?, syncState = 'PENDING' WHERE id = ?;"
    var updateStmt: OpaquePointer?
    guard sqlite3_prepare_v2(db, updateQuery, -1, &updateStmt, nil) == SQLITE_OK else { return false }
    sqlite3_bind_text(updateStmt, 1, (newContent as NSString).utf8String, -1, nil)
    sqlite3_bind_int64(updateStmt, 2, now)
    sqlite3_bind_text(updateStmt, 3, (noteId as NSString).utf8String, -1, nil)

    let updateResult = sqlite3_step(updateStmt) == SQLITE_DONE
    sqlite3_finalize(updateStmt)
    return updateResult
}

/// Store the selected note ID in shared UserDefaults.
private func storeSelectedNoteId(_ noteId: String) {
    UserDefaults(suiteName: appGroupIdentifier)?.set(noteId, forKey: "single_note_widget_note_id")
}

/// Retrieve the selected note ID from shared UserDefaults.
private func getSelectedNoteId() -> String? {
    UserDefaults(suiteName: appGroupIdentifier)?.string(forKey: "single_note_widget_note_id")
}

// MARK: - Note Entity for App Intents

struct NoteEntity: Identifiable, Hashable, AppEntity {
    let id: String
    let title: String
    let preview: String

    static var typeDisplayRepresentation: TypeDisplayRepresentation = "Note"
    static var defaultQuery = NoteQuery()
}

struct NoteQuery: EntityQuery {
    func entities(for identifiers: [NoteEntity.ID]) async throws -> [NoteEntity] {
        let allNotes = fetchAllNotes()
        return allNotes.filter { identifiers.contains($0.id) }.map {
            NoteEntity(id: $0.id, title: $0.title, preview: $0.preview)
        }
    }

    func suggestedEntities() async throws -> [NoteEntity] {
        return fetchAllNotes().map { .init(id: $0.id, title: $0.title, preview: $0.preview) }
    }
}

// MARK: - Select Note Intent (Configuration)

struct SelectNoteIntent: WidgetConfigurationIntent {
    static let title: LocalizedStringResource = "Select Note"
    static let description = IntentDescription("Choose which note to display on the widget")

    @Parameter(title: "Note")
    var note: NoteEntity?

    init(note: NoteEntity?) {
        self.note = note
    }

    init() {}
}

// MARK: - Toggle Checkbox Intent

struct ToggleCheckboxIntent: AppIntent {
    static var title: LocalizedStringResource = "Toggle Checkbox"
    static var description = IntentDescription("Toggle a checklist item")

    @Parameter(title: "Note ID")
    var noteId: String

    @Parameter(title: "Line Index")
    var lineIndex: Int

    init(noteId: String, lineIndex: Int) {
        self.noteId = noteId
        self.lineIndex = lineIndex
    }

    init() {}

    func perform() async throws -> some IntentResult {
        let success = toggleChecklistLine(noteId: noteId, lineIndex: lineIndex)
        if success {
            // Refresh widget timelines
            WidgetCenter.shared.reloadTimelines(ofKind: "SingleNoteWidget")
        }
        return .result()
    }
}

// MARK: - Widget Entry & Provider

struct SingleNoteWidgetEntry: TimelineEntry {
    let date: Date
    let noteId: String?
    let title: String
    let content: String
    let isUnconfigured: Bool
    let isUnavailable: Bool
}

struct SingleNoteWidgetProvider: AppIntentTimelineProvider {

    func placeholder(in context: Context) -> SingleNoteWidgetEntry {
        SingleNoteWidgetEntry(
            date: Date(),
            noteId: nil,
            title: "My Note",
            content: "Loading...",
            isUnconfigured: false,
            isUnavailable: false
        )
    }

    func snapshot(for configuration: SelectNoteIntent, in context: Context) async -> SingleNoteWidgetEntry {
        if let note = configuration.note {
            let noteData = fetchNoteById(note.id)
            return SingleNoteWidgetEntry(
                date: Date(),
                noteId: note.id,
                title: noteData?.title ?? note.title,
                content: noteData?.content ?? "",
                isUnconfigured: false,
                isUnavailable: noteData == nil
            )
        }
        return emptyEntry()
    }

    func timeline(for configuration: SelectNoteIntent, in context: Context) async -> Timeline<SingleNoteWidgetEntry> {
        if let note = configuration.note {
            // Also store the selected ID in shared user defaults for the app
            storeSelectedNoteId(note.id)
            let noteData = fetchNoteById(note.id)
            let entry = SingleNoteWidgetEntry(
                date: Date(),
                noteId: note.id,
                title: noteData?.title ?? note.title,
                content: noteData?.content ?? "",
                isUnconfigured: false,
                isUnavailable: noteData == nil
            )
            // Refresh every 30 minutes so edits made in the app eventually show up
            let refreshDate = Calendar.current.date(byAdding: .minute, value: 30, to: Date()) ?? Date()
            return Timeline(entries: [entry], policy: .after(refreshDate))
        }
        return Timeline(entries: [emptyEntry()], policy: .never)
    }

    private func emptyEntry() -> SingleNoteWidgetEntry {
        SingleNoteWidgetEntry(
            date: Date(),
            noteId: nil,
            title: "",
            content: "",
            isUnconfigured: true,
            isUnavailable: false
        )
    }
}

// MARK: - Checklist Parsing

private struct ChecklistItem: Identifiable {
    let id = UUID()
    let text: String
    let isChecked: Bool
    let indentation: Int
}

private func parseChecklist(from content: String) -> (items: [ChecklistItem], nonChecklistLines: [String]) {
    var items: [ChecklistItem] = []
    var nonChecklistLines: [String] = []

    for line in content.components(separatedBy: "\n") {
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        let leadingSpaces = line.prefix(while: { $0 == " " }).count
        let indent = leadingSpaces / 2

        if trimmed.hasPrefix("- [ ]") {
            let text = trimmed.dropFirst(5).trimmingCharacters(in: .whitespaces)
            items.append(ChecklistItem(text: String(text), isChecked: false, indentation: indent))
        } else if trimmed.hasPrefix("- [x]") {
            let text = trimmed.dropFirst(5).trimmingCharacters(in: .whitespaces)
            items.append(ChecklistItem(text: String(text), isChecked: true, indentation: indent))
        } else if !trimmed.isEmpty {
            nonChecklistLines.append(trimmed)
        }
    }

    return (items, nonChecklistLines)
}

// MARK: - Widget Entry View

struct SingleNoteWidgetEntryView: View {
    var entry: SingleNoteWidgetEntry

    var body: some View {
        Group {
            if entry.isUnconfigured {
                unconfiguredView
            } else if entry.isUnavailable {
                unavailableView
            } else {
                noteContentView
            }
        }
        .background(Color(.systemBackground))
    }

    // MARK: Unconfigured State
    private var unconfiguredView: some View {
        VStack(spacing: 8) {
            Image(systemName: "note.text")
                .font(.system(size: 28))
                .foregroundColor(.secondary)
            Text("Select a note...")
                .font(.system(size: 14, weight: .medium))
                .foregroundColor(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: Unavailable State
    private var unavailableView: some View {
        VStack(spacing: 8) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 24))
                .foregroundColor(.secondary)
            Text("Note unavailable")
                .font(.system(size: 14, weight: .medium))
                .foregroundColor(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: Note Content View
    private var noteContentView: some View {
        let noteId = entry.noteId ?? ""
        let parsed = parseChecklist(from: entry.content)
        let hasChecklist = !parsed.items.isEmpty

        return VStack(alignment: .leading, spacing: 6) {
            // Header
            HStack {
                Text(entry.title)
                    .font(.system(size: 16, weight: .bold))
                    .lineLimit(1)
                    .foregroundColor(.primary)

                Spacer()

                if hasChecklist {
                    Image(systemName: "checkmark.square")
                        .font(.system(size: 12))
                        .foregroundColor(.secondary)
                }
            }

            // Divider
            Rectangle()
                .fill(Color(.separator))
                .frame(height: 0.5)

            // Scrollable content
            ScrollView(.vertical, showsIndicators: true) {
                VStack(alignment: .leading, spacing: 4) {
                    if hasChecklist {
                        ForEach(parsed.items) { item in
                            HStack(spacing: 6) {
                                // Checkbox button
                                Button(intent: ToggleCheckboxIntent(noteId: noteId, lineIndex: findLineIndex(for: item.text, in: entry.content, isChecked: item.isChecked))) {
                                    Image(systemName: item.isChecked ? "checkmark.square.fill" : "square")
                                        .font(.system(size: 16))
                                        .foregroundColor(item.isChecked ? .green : .secondary)
                                }
                                .buttonStyle(.plain)

                                Text(item.text)
                                    .font(.system(size: 13))
                                    .strikethrough(item.isChecked)
                                    .foregroundColor(item.isChecked ? .secondary : .primary)
                            }
                            .padding(.leading, CGFloat(item.indentation * 16))
                        }
                    } else {
                        ForEach(parsed.nonChecklistLines, id: \.self) { line in
                            Text(line)
                                .font(.system(size: 13))
                                .foregroundColor(.primary)
                        }
                    }
                }
            }

            Spacer(minLength: 0)
        }
        .padding(12)
        .widgetURL(URL(string: "openkeep://open-note/\(noteId)"))
    }

    /// Find the line index of a specific checklist item to pass to the toggle intent.
    private func findLineIndex(for text: String, in content: String, isChecked: Bool) -> Int {
        let lines = content.components(separatedBy: "\n")
        for (index, line) in lines.enumerated() {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            let prefix = isChecked ? "- [x]" : "- [ ]"
            if trimmed.hasPrefix(prefix) {
                let itemText = trimmed.dropFirst(5).trimmingCharacters(in: .whitespaces)
                if itemText == text {
                    return index
                }
            }
        }
        return 0
    }
}

// MARK: - Widget Configuration

struct SingleNoteWidget: Widget {
    let kind: String = "SingleNoteWidget"

    var body: some WidgetConfiguration {
        AppIntentConfiguration(
            kind: kind,
            intent: SelectNoteIntent.self,
            provider: SingleNoteWidgetProvider()
        ) { entry in
            SingleNoteWidgetEntryView(entry: entry)
        }
        .configurationDisplayName("Single Note")
        .description("Pin a specific note or list to your home screen")
        .supportedFamilies([.systemMedium])
    }
}
