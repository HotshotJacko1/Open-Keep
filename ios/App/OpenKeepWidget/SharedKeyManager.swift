import Foundation
import Security

/// Shared Keychain access for the widget extension.
/// The main app stores the encrypted master key in the Keychain; the widget reads
/// it from the same Keychain via the Keychain Sharing entitlement.
class SharedKeyManager {
    private let KEY_ALIAS = "db_master_key"
    private let ENCRYPTED_MASTER_KEY_V2 = "encrypted_master_key_v2"

    static let shared = SharedKeyManager()

    private init() {}

    /// Retrieve the raw master key bytes (base64-decoded).
    /// The main app stores this via the `storeMasterKey` method of the app's KeyManager.
    /// Because the widget doesn't know the user's PIN, it relies on the already-unlocked
    /// master key stored by the app after successful authentication.
    func getMasterKey() -> [UInt8]? {
        // Try the shared service first, then fall back to the app's default service
        if let key = keychainGet(service: AppGroupHelper.keychainService, key: KEY_ALIAS) {
            guard let data = Data(base64Encoded: key) else { return nil }
            return [UInt8](data)
        }
        // Fallback to the app's default Keychain service
        if let key = keychainGet(service: Bundle.main.bundleIdentifier ?? "com.jackbarkerapps.openkeep", key: KEY_ALIAS) {
            guard let data = Data(base64Encoded: key) else { return nil }
            return [UInt8](data)
        }
        return nil
    }

    private func keychainGet(service: String, key: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecReturnData as String: kCFBooleanTrue!,
            kSecMatchLimit as String: kSecMatchLimitOne,
            kSecUseDataProtectionKeychain as String: kCFBooleanTrue!
        ]

        var dataTypeRef: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &dataTypeRef)

        if status == errSecSuccess, let data = dataTypeRef as? Data {
            return String(data: data, encoding: .utf8)
        }
        return nil
    }
}