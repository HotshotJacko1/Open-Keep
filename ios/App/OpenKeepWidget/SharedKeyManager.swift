import Foundation

/// Shared master-key access for the widget extension.
///
/// The main app (`KeyManager.storeMasterKey`) writes the already-unlocked master key,
/// base64-encoded, into the shared App Group `UserDefaults` under `shared_master_key`.
/// The widget reads it from there — it can't derive the key itself because it never
/// sees the user's PIN. If the app has never been unlocked (or the user locked it),
/// the value is absent and the widget renders its locked state.
class SharedKeyManager {
    private let SHARED_DEFAULTS_KEY = "shared_master_key"

    static let shared = SharedKeyManager()

    private init() {}

    /// Retrieve the raw master key bytes (base64-decoded) from shared App Group storage.
    func getMasterKey() -> [UInt8]? {
        guard let encodedKey = AppGroupHelper.sharedDefaults?.string(forKey: SHARED_DEFAULTS_KEY),
              let keyData = Data(base64Encoded: encodedKey) else {
            return nil
        }
        return [UInt8](keyData)
    }
}