import Foundation
import Capacitor

@objc(NoteStoragePlugin)
public class NoteStoragePlugin: CAPPlugin, CAPBridgedPlugin {
    
    public let identifier = "NoteStoragePlugin"
    public let jsName = "NoteStorage"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "loadNotes", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "saveNote", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deleteNote", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "initialize", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "checkStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "encrypt", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "decrypt", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "lock", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearAllData", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "wipeDatabaseButKeepKeys", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "migrateFromWeb", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "changeEncryptionKey", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "exportMasterKey", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "importMasterKey", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "verifyCloudMasterKeyMatch", returnType: CAPPluginReturnPromise)
    ]
    
    private lazy var keyManager = KeyManager()
    
    private func getDatabasePath() -> String {
        let paths = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)
        let documentsDirectory = paths[0]
        return documentsDirectory.appendingPathComponent("open-keep-db.sqlite3").path
    }
    
    private func removeDatabaseFiles(at dbPath: String) {
        let fm = FileManager.default
        for path in [dbPath, "\(dbPath)-wal", "\(dbPath)-shm"] {
            if fm.fileExists(atPath: path) {
                try? fm.removeItem(atPath: path)
            }
        }
    }
    
    /// True when no encrypted database file exists yet (first-launch setup).
    private func needsFreshEncryptionSetup(dbExists: Bool) -> Bool {
        return !dbExists
    }
    
    @objc func loadNotes(_ call: CAPPluginCall) {
        do {
            let notes = try NoteDatabase.shared.getAllNotes()
            call.resolve(["notes": notes])
        } catch {
            call.reject("Failed to load notes: \(error.localizedDescription)")
        }
    }
    
    @objc func saveNote(_ call: CAPPluginCall) {
        guard let noteObj = call.getObject("note") else {
            call.reject("Note object is missing")
            return
        }
        
        do {
            try NoteDatabase.shared.saveNote(dict: noteObj)
            call.resolve()
        } catch {
            call.reject("Failed to save note: \(error.localizedDescription)")
        }
    }
    
    @objc func deleteNote(_ call: CAPPluginCall) {
        guard let id = call.getString("id") else {
            call.reject("ID is missing")
            return
        }
        
        do {
            try NoteDatabase.shared.deleteNote(noteId: id)
            call.resolve()
        } catch {
            call.reject("Failed to delete note: \(error.localizedDescription)")
        }
    }
    
    @objc func initialize(_ call: CAPPluginCall) {
        guard let pin = call.getString("key") else {
            call.reject("PIN is missing")
            return
        }
        
        let dbPath = getDatabasePath()
        let dbExists = FileManager.default.fileExists(atPath: dbPath)
        let freshSetup = needsFreshEncryptionSetup(dbExists: dbExists)
        
        do {
            let masterKey: [UInt8]
            if freshSetup {
                // Fresh install, reinstall, or recovering from a failed first-launch attempt.
                // Keychain can survive iOS uninstalls while the DB file and PBKDF2 salt do not.
                keyManager.clearAll()
                removeDatabaseFiles(at: dbPath)
                masterKey = try keyManager.generateRandomMasterKeyAndSave(pin: pin)
            } else {
                masterKey = try keyManager.getMasterKeyForPin(pin: pin)
            }
            
            NoteDatabase.shared.reset()
            try NoteDatabase.shared.initialize(dbPath: dbPath, key: masterKey)
            
            // Trigger dummy query
            _ = try NoteDatabase.shared.getAllNotes()
            
            try keyManager.upgradeToV2(masterKey: masterKey, pin: pin)
            try keyManager.storeMasterKey(key: masterKey)
            
            call.resolve()
        } catch {
            NoteDatabase.shared.reset()
            if freshSetup {
                keyManager.clearAll()
                removeDatabaseFiles(at: dbPath)
            }
            call.reject("Failed to open database. Incorrect PIN? \(error.localizedDescription)")
        }
    }
    
    @objc func checkStatus(_ call: CAPPluginCall) {
        let dbPath = getDatabasePath()
        let isConfigured = FileManager.default.fileExists(atPath: dbPath)
        
        var ret: [String: Any] = [
            "isConfigured": isConfigured,
            "isLocked": true
        ]
        
        if isConfigured {
            if let storedKey = keyManager.getMasterKey() {
                do {
                    NoteDatabase.shared.reset()
                    try NoteDatabase.shared.initialize(dbPath: dbPath, key: storedKey)
                    _ = try NoteDatabase.shared.getAllNotes()
                    ret["isLocked"] = false
                } catch {
                    NoteDatabase.shared.reset()
                }
            }
        }
        
        call.resolve(ret)
    }
    
    @objc func encrypt(_ call: CAPPluginCall) {
        guard let data = call.getString("data") else {
            call.reject("Data is missing")
            return
        }
        
        do {
            let encrypted = try keyManager.encrypt(plaintext: data)
            call.resolve(["data": encrypted])
        } catch {
            call.reject("Encryption failed: \(error.localizedDescription)")
        }
    }
    
    @objc func decrypt(_ call: CAPPluginCall) {
        guard let data = call.getString("data") else {
            call.reject("Data is missing")
            return
        }
        
        do {
            let decrypted = try keyManager.decrypt(encryptedData: data)
            call.resolve(["data": decrypted])
        } catch {
            call.reject("Decryption failed: \(error.localizedDescription)")
        }
    }
    
    @objc func lock(_ call: CAPPluginCall) {
        keyManager.clear()
        NoteDatabase.shared.reset()
        call.resolve()
    }
    
    @objc func clearAllData(_ call: CAPPluginCall) {
        keyManager.clearAll()
        
        NoteDatabase.shared.reset()
        removeDatabaseFiles(at: getDatabasePath())
        call.resolve()
    }
    
    @objc func wipeDatabaseButKeepKeys(_ call: CAPPluginCall) {
        do {
            if NoteDatabase.shared.isInitialized() {
                try NoteDatabase.shared.clearAllTables()
            }
        } catch {
            // Ignore table clear errors
        }
        
        NoteDatabase.shared.reset()
        removeDatabaseFiles(at: getDatabasePath())
        call.resolve()
    }
    
    @objc func migrateFromWeb(_ call: CAPPluginCall) {
        guard let notesArray = call.getArray("notes") as? [[String: Any]] else {
            call.reject("Notes array is missing")
            return
        }
        
        do {
            try NoteDatabase.shared.bulkInsert(notesList: notesArray)
            call.resolve()
        } catch {
            call.reject("Migration failed: \(error.localizedDescription)")
        }
    }
    
    @objc func changeEncryptionKey(_ call: CAPPluginCall) {
        guard let oldPin = call.getString("oldPin"), let newPin = call.getString("newPin") else {
            call.reject("Missing PINs")
            return
        }
        
        do {
            if keyManager.hasV2Key() {
                try keyManager.changePinV2(oldPin: oldPin, newPin: newPin)
            } else {
                let newDerivedKey = try keyManager.deriveLocalKEK(pin: newPin)
                try NoteDatabase.shared.changePassword(newKey: newDerivedKey)
                try keyManager.upgradeToV2(masterKey: newDerivedKey, pin: newPin)
            }
            
            let newMasterKey = try keyManager.getMasterKeyForPin(pin: newPin)
            try keyManager.storeMasterKey(key: newMasterKey)
            
            call.resolve()
        } catch {
            call.reject("Failed to change encryption key: \(error.localizedDescription)")
        }
    }
    
    @objc func exportMasterKey(_ call: CAPPluginCall) {
        guard let pin = call.getString("pin") else {
            call.reject("PIN is missing")
            return
        }
        
        do {
            let payload = try keyManager.exportCloudMasterKey(pin: pin)
            call.resolve(["payload": payload])
        } catch {
            call.reject("Failed to export master key: \(error.localizedDescription)")
        }
    }
    
    @objc func importMasterKey(_ call: CAPPluginCall) {
        guard let payload = call.getString("payload"), let pin = call.getString("pin") else {
            call.reject("Missing payload or PIN")
            return
        }
        
        do {
            try keyManager.importCloudMasterKey(payload: payload, pin: pin)
            
            let masterKey = try keyManager.getMasterKeyForPin(pin: pin)
            NoteDatabase.shared.reset()
            try NoteDatabase.shared.initialize(dbPath: getDatabasePath(), key: masterKey)
            
            call.resolve()
        } catch {
            call.reject("Failed to import master key: \(error.localizedDescription)")
        }
    }
    
    @objc func verifyCloudMasterKeyMatch(_ call: CAPPluginCall) {
        guard let payload = call.getString("payload"), let pin = call.getString("pin") else {
            call.reject("Missing payload or PIN")
            return
        }
        
        let isMatch = keyManager.verifyCloudMasterKeyMatch(payload: payload, pin: pin)
        call.resolve(["isMatch": isMatch])
    }
}
