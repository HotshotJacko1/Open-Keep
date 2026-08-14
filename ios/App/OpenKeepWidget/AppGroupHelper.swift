import Foundation

/// Shared access to the App Group container used by both the main app and the widget extension.
/// The widget uses this to locate the encrypted SQLCipher database and to read/write shared preferences.
struct AppGroupHelper {
    /// The App Group identifier registered in Apple Developer Portal + Xcode Capabilities.
    /// Must match the value used in the main app's Entitlements and the widget's Entitlements.
    static let appGroupIdentifier = "group.com.jackbarkerapps.openkeep"

    /// URL of the shared container directory where the DB file lives.
    static var sharedContainerURL: URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroupIdentifier)
    }

    /// Shared UserDefaults instance (persists across app + widget).
    static var sharedDefaults: UserDefaults? {
        UserDefaults(suiteName: appGroupIdentifier)
    }

    /// Key used in shared UserDefaults to store the relative DB path.
    private static let dbPathKey = "db_path"

    /// File name the main app uses for the encrypted SQLCipher database.
    /// Must match `SharedAppGroup.databasePath` / `NoteStoragePlugin.getDatabasePath` in the app target.
    static let databaseFileName = "open-keep-db.sqlite3"

    /// Returns the absolute path to the encrypted database file.
    static var databasePath: String? {
        // First check shared UserDefaults for an override path (if the app ever sets one)
        if let relativePath = sharedDefaults?.string(forKey: dbPathKey) {
            let fullPath = sharedContainerURL?.appendingPathComponent(relativePath).path
            if let path = fullPath, FileManager.default.fileExists(atPath: path) {
                return path
            }
        }

        // Default: the shared App Group location written by the main app.
        return sharedContainerURL?.appendingPathComponent(databaseFileName).path
    }

    /// Store the DB path so the widget extension can find it.
    static func setDatabasePath(_ path: String) {
        // Strip the shared container prefix to store a relative path
        guard let container = sharedContainerURL?.path else { return }
        if path.hasPrefix(container) {
            let relative = String(path.dropFirst(container.count + 1))
            sharedDefaults?.set(relative, forKey: dbPathKey)
        }
    }

    /// Shared Keychain service name — used so both targets can read/write the master key.
    static let keychainService = "com.jackbarkerapps.openkeep.shared"
}