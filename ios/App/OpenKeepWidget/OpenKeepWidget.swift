import WidgetKit
import SwiftUI

struct OpenKeepWidgetEntry: TimelineEntry {
    let date: Date
}

struct OpenKeepWidgetProvider: TimelineProvider {
    func placeholder(in context: Context) -> OpenKeepWidgetEntry {
        OpenKeepWidgetEntry(date: Date())
    }

    func getSnapshot(in context: Context, completion: @escaping (OpenKeepWidgetEntry) -> Void) {
        completion(OpenKeepWidgetEntry(date: Date()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<OpenKeepWidgetEntry>) -> Void) {
        let entry = OpenKeepWidgetEntry(date: Date())
        // No refresh needed — the widget is purely a launcher
        let timeline = Timeline(entries: [entry], policy: .never)
        completion(timeline)
    }
}

struct OpenKeepWidgetEntryView: View {
    var entry: OpenKeepWidgetEntry

    var body: some View {
        HStack(spacing: 0) {
            // New Text Note
            Link(destination: URL(string: "openkeep://new-text")!) {
                VStack(spacing: 4) {
                    Image(systemName: "plus")
                        .font(.system(size: 24, weight: .medium))
                        .foregroundColor(.secondary)
                    Text("New Note")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundColor(.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }

            // Divider
            Rectangle()
                .fill(Color(.separator))
                .frame(width: 0.5)
                .padding(.vertical, 16)

            // New List Note
            Link(destination: URL(string: "openkeep://new-list")!) {
                VStack(spacing: 4) {
                    Image(systemName: "checkmark.square")
                        .font(.system(size: 24, weight: .medium))
                        .foregroundColor(.secondary)
                    Text("New List")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundColor(.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .padding(8)
        .background(Color(.systemBackground))
    }
}

struct OpenKeepWidget: Widget {
    let kind: String = "com.jackbarkerapps.openkeep.widget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: OpenKeepWidgetProvider()) { entry in
            OpenKeepWidgetEntryView(entry: entry)
        }
        .configurationDisplayName("New note")
        .description("Quickly create new text or list notes")
        .supportedFamilies([.systemSmall])
    }
}