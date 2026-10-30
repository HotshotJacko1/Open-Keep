import WidgetKit
import SwiftUI
import AppIntents

// MARK: - Filter configuration (matches Android FilterPrefs)

enum CollectionFilterType: String, AppEnum {
    case all
    case pinned
    case label

    static var typeDisplayRepresentation: TypeDisplayRepresentation = "Filter"

    static var caseDisplayRepresentations: [CollectionFilterType: DisplayRepresentation] = [
        .all: "All Notes",
        .pinned: "Pinned Notes",
        .label: "By Label"
    ]
}

struct LabelEntity: AppEntity, Identifiable, Hashable {
    let id: String
    let name: String

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(name)")
    }

    static var typeDisplayRepresentation: TypeDisplayRepresentation = "Label"
    static var defaultQuery = LabelQuery()
}

struct LabelQuery: EntityQuery {
    func entities(for identifiers: [LabelEntity.ID]) async throws -> [LabelEntity] {
        fetchDistinctLabels()
            .filter { identifiers.contains($0) }
            .map { LabelEntity(id: $0, name: $0) }
    }

    func suggestedEntities() async throws -> [LabelEntity] {
        fetchDistinctLabels().map { LabelEntity(id: $0, name: $0) }
    }
}

private func fetchDistinctLabels() -> [String] {
    guard let dbPath = AppGroupHelper.databasePath,
          let masterKey = SharedKeyManager.shared.getMasterKey() else {
        return []
    }

    let reader = WidgetDatabaseReader()
    defer { reader.close() }
    guard reader.open(path: dbPath, key: masterKey) else { return [] }
    return reader.fetchDistinctTags()
}

struct SelectCollectionFilterIntent: WidgetConfigurationIntent {
    static var title: LocalizedStringResource = "Note Collection"
    static var description = IntentDescription("Choose notes to display")

    @Parameter(title: "Show", default: .all)
    var filterType: CollectionFilterType

    @Parameter(title: "Label")
    var label: LabelEntity?

    init() {}

    init(filterType: CollectionFilterType, label: LabelEntity?) {
        self.filterType = filterType
        self.label = label
    }
}

// MARK: - Timeline Entry

struct NoteCollectionEntry: TimelineEntry {
    let date: Date
    let notes: [WidgetNote]
    let filterName: String
    let isLocked: Bool
    let needsLabelSelection: Bool
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
    let id: String
    let lineIndex: Int
    let isChecked: Bool
    let text: String
}

// MARK: - Provider

struct NoteCollectionWidgetProvider: AppIntentTimelineProvider {

    func placeholder(in context: Context) -> NoteCollectionEntry {
        NoteCollectionEntry(
            date: Date(),
            notes: [],
            filterName: "All Notes",
            isLocked: false,
            needsLabelSelection: false,
            errorMessage: nil
        )
    }

    func snapshot(for configuration: SelectCollectionFilterIntent, in context: Context) async -> NoteCollectionEntry {
        loadNotes(configuration: configuration)
    }

    func timeline(for configuration: SelectCollectionFilterIntent, in context: Context) async -> Timeline<NoteCollectionEntry> {
        let entry = loadNotes(configuration: configuration)
        let nextUpdate = Date().addingTimeInterval(15 * 60)
        return Timeline(entries: [entry], policy: .after(nextUpdate))
    }

    private func loadNotes(configuration: SelectCollectionFilterIntent) -> NoteCollectionEntry {
        let filterName = displayName(for: configuration)

        if configuration.filterType == .label && configuration.label == nil {
            return NoteCollectionEntry(
                date: Date(),
                notes: [],
                filterName: filterName,
                isLocked: false,
                needsLabelSelection: true,
                errorMessage: nil
            )
        }

        guard let dbPath = AppGroupHelper.databasePath else {
            return NoteCollectionEntry(
                date: Date(),
                notes: [],
                filterName: filterName,
                isLocked: false,
                needsLabelSelection: false,
                errorMessage: "Could not locate database"
            )
        }

        guard let masterKey = SharedKeyManager.shared.getMasterKey() else {
            return NoteCollectionEntry(
                date: Date(),
                notes: [],
                filterName: filterName,
                isLocked: true,
                needsLabelSelection: false,
                errorMessage: nil
            )
        }

        let reader = WidgetDatabaseReader()
        defer { reader.close() }

        guard reader.open(path: dbPath, key: masterKey) else {
            return NoteCollectionEntry(
                date: Date(),
                notes: [],
                filterName: filterName,
                isLocked: true,
                needsLabelSelection: false,
                errorMessage: "Unable to open database"
            )
        }

        let rawNotes = reader.fetchFilteredNotes()
        let allNotes = rawNotes.compactMap { parseNote($0) }
        let notes = applyFilter(allNotes, configuration: configuration)

        return NoteCollectionEntry(
            date: Date(),
            notes: notes,
            filterName: filterName,
            isLocked: false,
            needsLabelSelection: false,
            errorMessage: notes.isEmpty ? "No notes found" : nil
        )
    }

    private func displayName(for configuration: SelectCollectionFilterIntent) -> String {
        switch configuration.filterType {
        case .all:
            return "All Notes"
        case .pinned:
            return "Pinned Notes"
        case .label:
            if let label = configuration.label?.name, !label.isEmpty {
                return "Label: \(label)"
            }
            return "By Label"
        }
    }

    private func applyFilter(_ notes: [WidgetNote], configuration: SelectCollectionFilterIntent) -> [WidgetNote] {
        switch configuration.filterType {
        case .all:
            return notes
        case .pinned:
            return notes.filter { $0.isPinned }
        case .label:
            guard let labelName = configuration.label?.name, !labelName.isEmpty else {
                return notes
            }
            return notes.filter { $0.tags.contains(labelName) }
        }
    }

    private func parseNote(_ dict: [String: Any]) -> WidgetNote? {
        guard let id = dict["id"] as? String else { return nil }
        let title = dict["title"] as? String ?? ""
        let content = dict["content"] as? String ?? ""
        let type = dict["type"] as? String ?? "text"
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

// MARK: - Interactive checkbox toggle

struct ToggleCollectionCheckboxIntent: AppIntent {
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

        WidgetCenter.shared.reloadTimelines(ofKind: "com.jackbarkerapps.openkeep.notecollection")
        return .result()
    }
}

// MARK: - Views

struct NoteCollectionWidgetEntryView: View {
    var entry: NoteCollectionEntry
    @Environment(\.widgetFamily) var family

    var body: some View {
        Group {
            if entry.isLocked {
                lockedView
            } else if entry.needsLabelSelection {
                emptyView(message: "Tap to configure", opensApp: true)
            } else if let error = entry.errorMessage {
                emptyView(message: error, opensApp: false)
            } else {
                noteListView
            }
        }
        .containerBackground(for: .widget) {
            WidgetPalette.background
        }
    }

    private var lockedView: some View {
        Link(destination: URL(string: "openkeep://")!) {
            VStack(spacing: 8) {
                Image(systemName: "lock.fill")
                    .font(.system(size: 28))
                    .foregroundColor(WidgetPalette.icon)
                Text("Open Keep to unlock")
                    .font(.caption)
                    .foregroundColor(WidgetPalette.textSecondary)
                    .multilineTextAlignment(.center)
            }
            .padding()
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    @ViewBuilder
    private func emptyView(message: String, opensApp: Bool) -> some View {
        let content = VStack(spacing: 8) {
            Image(systemName: "note.text")
                .font(.system(size: 28))
                .foregroundColor(WidgetPalette.icon)
            Text(message)
                .font(.caption)
                .foregroundColor(WidgetPalette.textSecondary)
                .multilineTextAlignment(.center)
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity)

        if opensApp {
            Link(destination: URL(string: "openkeep://")!) { content }
        } else {
            content
        }
    }

    private var noteListView: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Text(entry.filterName)
                    .font(.system(size: 15, weight: .bold))
                    .foregroundColor(WidgetPalette.heading)
                    .lineLimit(1)
                Spacer()
                Text(entry.notes.count == 1 ? "1 note" : "\(entry.notes.count) notes")
                    .font(.caption2)
                    .foregroundColor(WidgetPalette.textSecondary)
            }

            let maxVisible: Int = (family == .systemLarge || family == .systemExtraLarge) ? 8 : 4
            let visibleNotes = entry.notes.prefix(maxVisible)

            ScrollView {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(visibleNotes) { note in
                        NoteRowView(note: note)
                    }
                }
            }
        }
    }
}

struct NoteRowView: View {
    let note: WidgetNote
    // iOS 18's tinted home screen draws everything in one tint by opacity, so a
    // solid card fill would cover its own text. Outside full colour, keep only the outline.
    @Environment(\.widgetRenderingMode) private var renderingMode

    var body: some View {
        Link(destination: URL(string: "openkeep://open-note/\(note.id)")!) {
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 4) {
                    if note.isPinned {
                        Image(systemName: "pin.fill")
                            .font(.system(size: 8))
                            .foregroundColor(WidgetPalette.highlight)
                    }
                    Text(WidgetText.displayTitle(title: note.title, content: note.content))
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundColor(WidgetPalette.textPrimary)
                        .lineLimit(1)
                }

                if !note.checkboxes.isEmpty {
                    ForEach(note.checkboxes.prefix(3)) { checkbox in
                        checkboxRow(checkbox)
                    }
                    if note.checkboxes.count > 3 {
                        Text("+\(note.checkboxes.count - 3) more items")
                            .font(.system(size: 10))
                            .foregroundColor(WidgetPalette.textSecondary)
                    }
                } else {
                    // Text notes are stored as editor HTML: show the text, not the tags.
                    // An untitled note's first line is already its title.
                    let lines = WidgetText.plainLines(note.content)
                    let untitled = note.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                    let preview = (untitled ? Array(lines.dropFirst()) : lines)
                        .prefix(3)
                        .joined(separator: "\n")
                    if !preview.isEmpty {
                        Text(preview)
                            .font(.system(size: 11))
                            .foregroundColor(WidgetPalette.textSecondary)
                            .lineLimit(3)
                    }
                }
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .frame(maxWidth: .infinity, alignment: .leading)
            // A note card as the app draws it: card colour, outline, 12pt corners.
            .background(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(renderingMode == .fullColor ? WidgetPalette.card : Color.clear)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .strokeBorder(WidgetPalette.cardStroke, lineWidth: 1)
            )
        }
    }

    @ViewBuilder
    private func checkboxRow(_ checkbox: CheckboxItem) -> some View {
        HStack(spacing: 6) {
            Button(intent: ToggleCollectionCheckboxIntent(
                noteId: note.id,
                lineIndex: checkbox.lineIndex
            )) {
                // As in the app: an outlined square, or a green tick with no box.
                Image(systemName: checkbox.isChecked ? "checkmark" : "square")
                    .font(.system(size: 11, weight: checkbox.isChecked ? .bold : .regular))
                    .foregroundColor(checkbox.isChecked ? WidgetPalette.check : WidgetPalette.checkbox)
                    .frame(width: 14)
            }
            .buttonStyle(.plain)

            Text(checkbox.text)
                .font(.system(size: 11))
                .foregroundColor(checkbox.isChecked ? WidgetPalette.textChecked : WidgetPalette.textList)
                .strikethrough(checkbox.isChecked)
                .lineLimit(1)
        }
    }
}

// MARK: - Widget Definition

struct NoteCollectionWidgetIOS: Widget {
    let kind: String = "com.jackbarkerapps.openkeep.notecollection"

    var body: some WidgetConfiguration {
        AppIntentConfiguration(
            kind: kind,
            intent: SelectCollectionFilterIntent.self,
            provider: NoteCollectionWidgetProvider()
        ) { entry in
            NoteCollectionWidgetEntryView(entry: entry)
        }
        .configurationDisplayName("Note Collection")
        .description("View a set of notes")
        .supportedFamilies([.systemMedium, .systemLarge])
    }
}
