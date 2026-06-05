import Foundation
import CryptoKit
import CommonCrypto
import Security

class KeyManager {
    
    private let KEY_ALIAS = "db_master_key"
    private let ENCRYPTED_MASTER_KEY_V2 = "encrypted_master_key_v2"
    private let SALT_KEY = "kdf_salt"
    private let SALT_SIZE = 16
    private let ITERATIONS: UInt32 = 10000
    private let KEY_LENGTH = 32 // 256 bits
    
    // UserDefaults used for salt, like Android's standardPrefs
    private let defaults = UserDefaults.standard
    
    init() {}
    
    func getOrGenerateSalt() -> [UInt8] {
        if let saltString = defaults.string(forKey: SALT_KEY),
           let saltData = Data(base64Encoded: saltString) {
            return [UInt8](saltData)
        }
        
        var salt = [UInt8](repeating: 0, count: SALT_SIZE)
        _ = SecRandomCopyBytes(kSecRandomDefault, SALT_SIZE, &salt)
        
        let encodedSalt = Data(salt).base64EncodedString()
        defaults.set(encodedSalt, forKey: SALT_KEY)
        return salt
    }
    
    func deriveLocalKEK(pin: String) throws -> [UInt8] {
        let salt = getOrGenerateSalt()
        return try pbkdf2(password: pin, salt: salt, iterations: ITERATIONS, keyLength: KEY_LENGTH)
    }
    
    func deriveExportKEK(pin: String) throws -> [UInt8] {
        // "OpenKeepCloudExportSalt123" first 16 bytes
        let staticSaltStr = String("OpenKeepCloudExportSalt123".prefix(16))
        let staticSalt = [UInt8](staticSaltStr.data(using: .utf8)!)
        return try pbkdf2(password: pin, salt: staticSalt, iterations: ITERATIONS, keyLength: KEY_LENGTH)
    }
    
    private func pbkdf2(password: String, salt: [UInt8], iterations: UInt32, keyLength: Int) throws -> [UInt8] {
        guard let passwordData = password.data(using: .utf8) else {
            throw NSError(domain: "KeyManager", code: 1, userInfo: [NSLocalizedDescriptionKey: "Invalid PIN"])
        }
        
        var derivedKey = [UInt8](repeating: 0, count: keyLength)
        
        let passwordPtr = [UInt8](passwordData)
        let status = CCKeyDerivationPBKDF(
            CCPBKDFAlgorithm(kCCPBKDF2),
            passwordPtr, passwordData.count,
            salt, salt.count,
            CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA256),
            iterations,
            &derivedKey, keyLength
        )
        
        guard status == kCCSuccess else {
            throw NSError(domain: "KeyManager", code: Int(status), userInfo: [NSLocalizedDescriptionKey: "Key derivation failed"])
        }
        
        return derivedKey
    }
    
    private func encryptWithKEK(payload: [UInt8], kek: [UInt8]) throws -> String {
        let symmetricKey = SymmetricKey(data: kek)
        let ivData = [UInt8]((0..<12).map { _ in UInt8.random(in: 0...255) })
        let nonce = try AES.GCM.Nonce(data: ivData)
        
        let sealedBox = try AES.GCM.seal(payload, using: symmetricKey, nonce: nonce)
        let ciphertext = sealedBox.ciphertext
        // Tag is part of the sealedBox but we need to append it. Android does cipher.doFinal() which appends the 16-byte tag.
        // In CryptoKit, sealedBox.combined returns Nonce + Ciphertext + Tag. Wait, no.
        // Android AES/GCM/NoPadding appends the tag to the ciphertext.
        // So Android combined = IV (12) + Ciphertext + Tag (16)
        
        var combined = [UInt8]()
        combined.append(contentsOf: ivData)
        combined.append(contentsOf: ciphertext)
        combined.append(contentsOf: sealedBox.tag)
        
        return Data(combined).base64EncodedString()
    }
    
    private func decryptWithKEK(encryptedBase64: String, kek: [UInt8]) throws -> [UInt8] {
        guard let combinedData = Data(base64Encoded: encryptedBase64) else {
            throw NSError(domain: "KeyManager", code: 1, userInfo: [NSLocalizedDescriptionKey: "Invalid base64 payload"])
        }
        
        let combined = [UInt8](combinedData)
        if combined.count < 12 + 16 { // IV + Tag
            throw NSError(domain: "KeyManager", code: 2, userInfo: [NSLocalizedDescriptionKey: "Invalid encrypted payload size"])
        }
        
        let iv = [UInt8](combined[0..<12])
        let ciphertextAndTag = [UInt8](combined[12...])
        
        // Split ciphertext and tag
        let ciphertext = [UInt8](ciphertextAndTag[0..<(ciphertextAndTag.count - 16)])
        let tag = [UInt8](ciphertextAndTag[(ciphertextAndTag.count - 16)...])
        
        let symmetricKey = SymmetricKey(data: kek)
        let nonce = try AES.GCM.Nonce(data: iv)
        let sealedBox = try AES.GCM.SealedBox(nonce: nonce, ciphertext: ciphertext, tag: tag)
        
        let decryptedData = try AES.GCM.open(sealedBox, using: symmetricKey)
        return [UInt8](decryptedData)
    }
    
    func hasV2Key() -> Bool {
        return keychainGet(key: ENCRYPTED_MASTER_KEY_V2) != nil
    }
    
    func generateRandomMasterKeyAndSave(pin: String) throws -> [UInt8] {
        var masterKey = [UInt8](repeating: 0, count: 32)
        _ = SecRandomCopyBytes(kSecRandomDefault, 32, &masterKey)
        
        let kek = try deriveLocalKEK(pin: pin)
        let encrypted = try encryptWithKEK(payload: masterKey, kek: kek)
        try keychainSet(key: ENCRYPTED_MASTER_KEY_V2, value: encrypted)
        
        return masterKey
    }
    
    func getMasterKeyForPin(pin: String) throws -> [UInt8] {
        if let v2Encoded = keychainGet(key: ENCRYPTED_MASTER_KEY_V2) {
            let kek = try deriveLocalKEK(pin: pin)
            return try decryptWithKEK(encryptedBase64: v2Encoded, kek: kek)
        }
        // Fallback V1
        return try deriveLocalKEK(pin: pin)
    }
    
    func upgradeToV2(masterKey: [UInt8], pin: String) throws {
        if keychainGet(key: ENCRYPTED_MASTER_KEY_V2) == nil {
            let kek = try deriveLocalKEK(pin: pin)
            let encrypted = try encryptWithKEK(payload: masterKey, kek: kek)
            try keychainSet(key: ENCRYPTED_MASTER_KEY_V2, value: encrypted)
        }
    }
    
    func exportCloudMasterKey(pin: String) throws -> String {
        let masterKey = try getMasterKeyForPin(pin: pin)
        let exportKEK = try deriveExportKEK(pin: pin)
        return try encryptWithKEK(payload: masterKey, kek: exportKEK)
    }
    
    func importCloudMasterKey(payload: String, pin: String) throws {
        let exportKEK = try deriveExportKEK(pin: pin)
        let masterKey = try decryptWithKEK(encryptedBase64: payload, kek: exportKEK)
        
        let localKEK = try deriveLocalKEK(pin: pin)
        let encryptedLocal = try encryptWithKEK(payload: masterKey, kek: localKEK)
        try keychainSet(key: ENCRYPTED_MASTER_KEY_V2, value: encryptedLocal)
        
        try storeMasterKey(key: masterKey)
    }
    
    func verifyCloudMasterKeyMatch(payload: String, pin: String) -> Bool {
        do {
            let exportKEK = try deriveExportKEK(pin: pin)
            let cloudMasterKey = try decryptWithKEK(encryptedBase64: payload, kek: exportKEK)
            let currentMasterKey = try getMasterKeyForPin(pin: pin)
            return cloudMasterKey == currentMasterKey
        } catch {
            return false
        }
    }
    
    func changePinV2(oldPin: String, newPin: String) throws {
        let masterKey = try getMasterKeyForPin(pin: oldPin)
        let newLocalKEK = try deriveLocalKEK(pin: newPin)
        let encryptedLocal = try encryptWithKEK(payload: masterKey, kek: newLocalKEK)
        try keychainSet(key: ENCRYPTED_MASTER_KEY_V2, value: encryptedLocal)
    }
    
    func storeMasterKey(key: [UInt8]) throws {
        let encodedKey = Data(key).base64EncodedString()
        try keychainSet(key: KEY_ALIAS, value: encodedKey)
    }
    
    func getMasterKey() -> [UInt8]? {
        guard let encodedKey = keychainGet(key: KEY_ALIAS),
              let keyData = Data(base64Encoded: encodedKey) else {
            return nil
        }
        return [UInt8](keyData)
    }
    
    func encrypt(plaintext: String, key: [UInt8]? = nil) throws -> String {
        let activeKey = key ?? getMasterKey()
        guard let activeKey = activeKey else { throw NSError(domain: "KeyManager", code: 3, userInfo: [NSLocalizedDescriptionKey: "No master key available"]) }
        
        guard let plaintextData = plaintext.data(using: .utf8) else { throw NSError(domain: "KeyManager", code: 4, userInfo: [NSLocalizedDescriptionKey: "Invalid string"]) }
        return try encryptWithKEK(payload: [UInt8](plaintextData), kek: activeKey)
    }
    
    func decrypt(encryptedData: String, key: [UInt8]? = nil) throws -> String {
        let activeKey = key ?? getMasterKey()
        guard let activeKey = activeKey else { throw NSError(domain: "KeyManager", code: 3, userInfo: [NSLocalizedDescriptionKey: "No master key available"]) }
        
        let plaintextBytes = try decryptWithKEK(encryptedBase64: encryptedData, kek: activeKey)
        guard let plaintext = String(data: Data(plaintextBytes), encoding: .utf8) else { throw NSError(domain: "KeyManager", code: 5, userInfo: [NSLocalizedDescriptionKey: "Could not decode string"]) }
        return plaintext
    }
    
    func clear() {
        keychainDelete(key: KEY_ALIAS)
    }
    
    func clearAll() {
        clear()
        keychainDelete(key: ENCRYPTED_MASTER_KEY_V2)
        // Salt lives in UserDefaults and is wiped on uninstall, but must be cleared
        // explicitly when resetting encryption state (matches Android key wipe behavior).
        defaults.removeObject(forKey: SALT_KEY)
    }
    
    // MARK: - Keychain Helpers
    
    private func keychainSet(key: String, value: String) throws {
        guard let data = value.data(using: .utf8) else { return }
        
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key,
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        ]
        
        SecItemDelete(query as CFDictionary)
        let status = SecItemAdd(query as CFDictionary, nil)
        
        if status != errSecSuccess {
            throw NSError(domain: "KeyManager", code: Int(status), userInfo: [NSLocalizedDescriptionKey: "Keychain write failed"])
        }
    }
    
    private func keychainGet(key: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key,
            kSecReturnData as String: kCFBooleanTrue!,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        
        var dataTypeRef: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &dataTypeRef)
        
        if status == errSecSuccess, let data = dataTypeRef as? Data {
            return String(data: data, encoding: .utf8)
        }
        return nil
    }
    
    private func keychainDelete(key: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key
        ]
        SecItemDelete(query as CFDictionary)
    }
}
