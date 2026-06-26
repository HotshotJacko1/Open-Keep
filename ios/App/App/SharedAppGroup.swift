import Foundation

/// Shared App Group access for the main app target.
/// Mirrors the widget extension's AppGroupHelper so both targets know where the DB lives.
class SharedAppGroup {
    static let appGroupIdentifier = "group.com.jackbarkerapps.openkeep"

    static var sharedContainerURL: URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroupIdentifier)
    }

    /// Default DB path inside the shared container.
    static var databasePath: String {
        sharedContainerURL?.appendingPathComponent("open-keep-db.sqlite3").path
            ?? FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
                .appendingPathComponent("open-keep-db.sqlite3").path
    }
}