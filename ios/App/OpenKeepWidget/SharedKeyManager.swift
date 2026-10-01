import Foundation
import Security

/// Shared master-key access for the widget extension.
///
/// The main app (`KeyManager.storeMasterKey`) writes the already-unlocked master key,
/// base64-encoded, to the Keychain item `db_master_key` in the access group both targets list
/// under `keychain-access-groups`. The widget reads it from there — it can't derive the key
/// itself because it never sees the user's PIN. If the app has never been unlocked (or the user
/// locked it), the item is absent and the widget renders its locked state.
///
/// Builds up to 5.1.0 kept this copy in App Group `UserDefaults` instead, which is backed up
/// in cleartext (C6-ESC). Don't reintroduce a fallback to it.
class SharedKeyManager {
    /// Must match `KeyManager.KEY_ALIAS` in the app target.
    private let KEY_ALIAS = "db_master_key"

    static let shared = SharedKeyManager()

    private init() {}

    /// Mirrors `KeyManager.keychainAccessGroup`: the `KeychainAccessGroup` Info.plist key, or nil
    /// (default group) if `$(AppIdentifierPrefix)` didn't expand.
    private let accessGroup: String? = {
        guard let group = Bundle.main.object(forInfoDictionaryKey: "KeychainAccessGroup") as? String,
              !group.hasPrefix("."), !group.contains("$(") else {
            return nil
        }
        return group
    }()

    /// Retrieve the raw master key bytes (base64-decoded) from the shared Keychain item.
    func getMasterKey() -> [UInt8]? {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: KEY_ALIAS,
            kSecReturnData as String: kCFBooleanTrue!,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        if let group = accessGroup {
            query[kSecAttrAccessGroup as String] = group
        }

        var result: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data,
              let encodedKey = String(data: data, encoding: .utf8),
              let keyData = Data(base64Encoded: encodedKey) else {
            return nil
        }
        return [UInt8](keyData)
    }
}
