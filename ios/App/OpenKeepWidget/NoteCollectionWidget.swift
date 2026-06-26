import WidgetKit
import SwiftUI
import Intents

// MARK: - Timeline Entry

struct NoteCollectionEntry: TimelineEntry {
    let date: Date
    let notes: [WidgetNote]
    let filterName: String
    let isLocked: Bool
    let errorMessage: String?
}

struct WidgetNote: Identifiable {
    let id: String
    let title: String
    let content: String
    let type: String
    let isPinned: Bool
    let updatedAt: Int64
    let tags: [String]
    let checkboxes: [CheckboxItem]
}

struct CheckboxItem: Identifiable {
    let id: String  // "lineIndex" as string
    let lineIndex: Int
    let isChecked: Bool
    let text: String
}

// MARK: - Provider

struct NoteCollectionWidgetProvider: TimelineProvider {

    func placeholder(in context: Context) -> NoteCollectionEntry {
        NoteCollectionEntry(
            date: Date(),
            notes: [],
            filterName: "Notes",
            isLocked: false,
            errorMessage: nil
        )
    }

    func getSnapshot(in context: Context, completion: @escaping (NoteCollectionEntry) -> Void) {
        let entry = loadNotes()
        completion(entry)
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<NoteCollectionEntry>) -> Void) {
        let entry = loadNotes()
        // Refresh every 15 minutes (widgets can be refreshed more frequently in practice)
        let nextUpdate = Date().addingTimeInterval(15 * 60)
        let timeline = Timeline(entries: [entry], policy: .after(nextUpdate))
        completion(timeline)
    }

    private func loadNotes() -> NoteCollectionEntry {
        guard let dbPath = AppGroupHelper.databasePath else {
            return NoteCollectionEntry(
                date: Date(),
                notes: [],
                filterName: "Notes",
                isLocked: false,
                errorMessage: "Could not locate database"
            )
        }

        guard let masterKey = SharedKeyManager.shared.getMasterKey() else {
            return NoteCollectionEntry(
                date: Date(),
                notes: [],
                filterName: "Notes",
                isLocked: true,
                errorMessage: "Unlock Open Keep first"
            )
        }

        let reader = WidgetDatabaseReader()
        defer { reader.close() }

        guard reader.open(path: dbPath, key: masterKey) else {
            return NoteCollectionEntry(
                date: Date(),
                notes: [],
                filterName: "Notes",
                isLocked: true,
                errorMessage: "Unable to open database"
            )
        }

        let rawNotes = reader.fetchFilteredNotes()
        let notes = rawNotes.compactMap { parseNote($0) }

        return NoteCollectionEntry(
            date: Date(),
            notes: notes,
            filterName: "Notes",
            isLocked: false,
            errorMessage: notes.isEmpty ? "No notes" : nil
        )
    }

    private func parseNote(_ dict: [String: Any]) -> WidgetNote? {
        guard let id = dict["id"] as? String else { return nil }
        let title = dict["title"] as? String ?? ""
        let content = dict["content"] as? String ?? ""
        let type = dict["type"] as? String ?? "TEXT"
        let isPinned = dict["isPinned"] as? Bool ?? false
        let updatedAt = dict["updatedAt"] as? Int64 ?? 0
        let tags = dict["tags"] as? [String] ?? []

        let checkboxes = parseCheckboxes(from: content)

        return WidgetNote(
            id: id,
            title: title,
            content: content,
            type: type,
            isPinned: isPinned,
            updatedAt: updatedAt,
            tags: tags,
            checkboxes: checkboxes
        )
    }

    private func parseCheckboxes(from content: String) -> [CheckboxItem] {
        let lines = content.split(separator: "\n").map(String.init)
        let regex = try! NSRegularExpression(pattern: "^(\\s*)-\\s\\[([ xX])\\]\\s(.*)$", options: [])

        var result = [CheckboxItem]()
        for (idx, line) in lines.enumerated() {
            let range = NSRange(location: 0, length: line.utf16.count)
            if let match = regex.firstMatch(in: line, options: [], range: range) {
                let checkedStr = String(line[Range(match.range(at: 2), in: line)!]).lowercased()
                let text = String(line[Range(match.range(at: 3), in: line)!])
                result.append(CheckboxItem(
                    id: "\(idx)",
                    lineIndex: idx,
                    isChecked: checkedStr == "x",
                    text: text
                ))
            }
        }
        return result
    }
}

// MARK: - URL Scheme Actions (iOS 17+ interactive widgets)

/// App Intent to toggle a checkbox in a note (iOS 17+).
/// The system handles the intent and the widget timeline is reloaded automatically.
@available(iOS 17.0, *)
struct ToggleCheckboxIntent: AppIntent {
    static var title: LocalizedStringResource = "Toggle Checkbox"
    static var description = IntentDescription("Mark a checkbox as done or undone")

    @Parameter(title: "Note ID")
    var noteId: String

    @Parameter(title: "Line Index")
    var lineIndex: Int

    init() {}

    init(noteId: String, lineIndex: Int) {
        self.noteId = noteId
        self.lineIndex = lineIndex
    }

    func perform() async throws -> some IntentResult {
        guard let dbPath = AppGroupHelper.databasePath,
              let masterKey = SharedKeyManager.shared.getMasterKey() else {
            return .result()
        }

        let reader = WidgetDatabaseReader()
        guard reader.open(path: dbPath, key: masterKey) else {
            return .result()
        }

        reader.toggleCheckbox(noteId: noteId, lineIndex: lineIndex)
        reader.close()

        // Reload timelines
        let kind = "com.jackbarkerapps.openkeep.notecollection"
        if #available(iOS 17.0, *) {
            ControlCenter.shared.reloadControls(ofKind: kind)
        }
        WidgetCenter.shared.reloadTimelines(ofKind: kind)

        return .result()
    }
}

// MARK: - Views

struct NoteCollectionWidgetEntryView: View {
    var entry: NoteCollectionEntry
    @Environment(\.widgetFamily) var family

    var body: some View {
        if entry.isLocked {
            lockedView
        } else if let error = entry.errorMessage {
            emptyView(message: error)
        } else if entry.notes.isEmpty {
            emptyView(message: "No notes found")
        } else {
            noteListView
        }
    }

    private var lockedView: some View {
        VStack(spacing: 8) {
            Image(systemName: "lock.fill")
                .font(.system(size: 28))
                .foregroundColor(.secondary)
            Text("Unlock Open Keep first")
                .font(.caption)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(.systemBackground))
    }

    private func emptyView(message: String) -> some View {
        VStack(spacing: 8) {
            Image(systemName: "note.text")
                .font(.system(size: 28))
                .foregroundColor(.secondary)
            Text(message)
                .font(.caption)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(.systemBackground))
    }

    private var noteListView: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Header
            HStack {
                Image(systemName: "note.text")
                    .font(.caption)
                Text(entry.filterName)
                    .font(.caption.weight(.semibold))
                Spacer()
                Text("\(entry.notes.count)")
                    .font(.caption2)
                    .foregroundColor(.secondary)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)

            Divider()

            // Notes list
            let maxVisible: Int = (family == .systemLarge || family == .systemExtraLarge) ? 8 : 4
            let visibleNotes = entry.notes.prefix(maxVisible)

            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(visibleNotes) { note in
                        NoteRowView(note: note)
                        Divider().padding(.leading, 16)
                    }
                }
            }
        }
        .background(Color(.systemBackground))
    }
}

struct NoteRowView: View {
    let note: WidgetNote
    @Environment(\.widgetFamily) var family

    var body: some View {
        Link(destination: URL(string: "openkeep://open-note/\(note.id)")!) {
            VStack(alignment: .leading, spacing: 3) {
                // Title + pin indicator
                HStack(spacing: 4) {
                    if note.isPinned {
                        Image(systemName: "pin.fill")
                            .font(.system(size: 8))
                            .foregroundColor(.orange)
                    }
                    Text(note.title.isEmpty ? "Untitled" : note.title)
                        .font(.system(size: 13, weight: .semibold))
                        .lineLimit(1)
                }

                // Content preview
                if note.type == "LIST" && !note.checkboxes.isEmpty {
                    // Show up to 3 checkbox items
                    ForEach(note.checkboxes.prefix(3)) { checkbox in
                        checkboxRow(checkbox)
                    }
                    if note.checkboxes.count > 3 {
                        Text("+\(note.checkboxes.count - 3) more items")
                            .font(.system(size: 10))
                            .foregroundColor(.secondary)
                            .padding(.leading, 4)
                    }
                } else {
                    // Show first line of content as preview
                    let preview = note.content
                        .split(separator: "\n")
                        .first(where: { !$0.trimmingCharacters(in: .whitespaces).isEmpty })
                        .map(String.init) ?? ""
                    if !preview.isEmpty {
                        Text(preview)
                            .font(.system(size: 11))
                            .foregroundColor(.secondary)
                            .lineLimit(2)
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
        }
    }

    @ViewBuilder
    private func checkboxRow(_ checkbox: CheckboxItem) -> some View {
        if #available(iOS 17.0, *) {
            HStack(spacing: 4) {
                Button(intent: ToggleCheckboxIntent(
                    noteId: note.id,
                    lineIndex: checkbox.lineIndex
                )) {
                    Image(systemName: checkbox.isChecked ? "checkmark.square.fill" : "square")
                        .font(.system(size: 11))
                        .foregroundColor(checkbox.isChecked ? .green : .secondary)
                }
                .buttonStyle(.plain)

                Text(checkbox.text)
                    .font(.system(size: 11))
                    .foregroundColor(checkbox.isChecked ? .secondary : .primary)
                    .strikethrough(checkbox.isChecked)
                    .lineLimit(1)
            }
            .padding(.leading, 4)
        } else {
            // iOS 14-16 fallback: tappable row opens the note
            HStack(spacing: 4) {
                Image(systemName: checkbox.isChecked ? "checkmark.square.fill" : "square")
                    .font(.system(size: 11))
                    .foregroundColor(checkbox.isChecked ? .green : .secondary)

                Text(checkbox.text)
                    .font(.system(size: 11))
                    .foregroundColor(checkbox.isChecked ? .secondary : .primary)
                    .strikethrough(checkbox.isChecked)
                    .lineLimit(1)
            }
            .padding(.leading, 4)
        }
    }
}

// MARK: - Widget Definition

struct NoteCollectionWidgetIOS: Widget {
    let kind: String = "com.jackbarkerapps.openkeep.notecollection"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: NoteCollectionWidgetProvider()) { entry in
            NoteCollectionWidgetEntryView(entry: entry)
        }
        .configurationDisplayName("Notes")
        .description("Browse your notes from the home screen")
        .supportedFamilies([.systemMedium, .systemLarge])
    }
}