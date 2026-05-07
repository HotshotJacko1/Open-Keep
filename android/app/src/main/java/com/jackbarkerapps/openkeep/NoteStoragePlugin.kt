package com.jackbarkerapps.openkeep

import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.jackbarkerapps.openkeep.data.NoteEntity
import com.jackbarkerapps.openkeep.data.NoteRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

@CapacitorPlugin(name = "NoteStorage")
class NoteStoragePlugin : Plugin() {

    private lateinit var repository: NoteRepository
    private val scope = CoroutineScope(Dispatchers.IO)

    override fun load() {
        super.load()
        // Repository is initialized via the initialize() plugin method calls
    }

    @PluginMethod
    fun loadNotes(call: PluginCall) {
        scope.launch {
            try {
                // Collect first emission from Flow
                val notes = repository.getAllNotes().first()
                val jsArray = JSONArray()
                
                notes.forEach { note ->
                    val jsNote = JSObject()
                    jsNote.put("id", note.id)
                    jsNote.put("title", note.title)
                    jsNote.put("content", note.content)
                    jsNote.put("type", note.type)
                    jsNote.put("createdAt", note.createdAt)
                    jsNote.put("updatedAt", note.updatedAt)
                    jsNote.put("isPinned", note.isPinned)
                    jsNote.put("isArchived", note.isArchived)
                    jsNote.put("isDeleted", note.deleted)
                    if (note.deleted) {
                        jsNote.put("deletedAt", note.updatedAt)
                    }
                    
                    try {
                        jsNote.put("tags", JSONArray(note.tags))
                    } catch (e: Exception) {
                        jsNote.put("tags", JSONArray())
                    }
                    
                    try {
                        jsNote.put("images", JSONArray(note.images))
                    } catch (e: Exception) {
                        jsNote.put("images", JSONArray())
                    }

                    jsNote.put("reminder", note.reminder)
                    if (note.recurrence != null) {
                        try {
                            jsNote.put("recurrence", JSONObject(note.recurrence))
                        } catch (e: Exception) {}
                    }
                    
                    jsArray.put(jsNote)
                }

                val result = JSObject()
                result.put("notes", jsArray)
                call.resolve(result)
            } catch (e: Exception) {
                call.reject("Failed to load notes: ${e.message}")
            }
        }
    }

    @PluginMethod
    fun saveNote(call: PluginCall) {
        val noteObj = call.getObject("note")
        if (noteObj == null) {
            call.reject("Note object is missing")
            return
        }

        scope.launch {
            try {
                val tagsArray = noteObj.optJSONArray("tags") ?: JSONArray()
                val tagsString = tagsArray.toString()
                
                val imagesArray = noteObj.optJSONArray("images") ?: JSONArray()
                val imagesString = imagesArray.toString()

                val note = NoteEntity(
                    id = noteObj.getString("id") ?: "",
                    title = noteObj.getString("title") ?: "",
                    content = noteObj.getString("content") ?: "",
                    type = noteObj.getString("type") ?: "TEXT",
                    createdAt = noteObj.getLong("createdAt") ?: 0L,
                    updatedAt = noteObj.getLong("updatedAt") ?: 0L,
                    isPinned = noteObj.optBoolean("isPinned", false),
                    isArchived = noteObj.optBoolean("isArchived", false),
                    deleted = noteObj.optBoolean("isDeleted", false),
                    tags = tagsString,
                    syncState = "PENDING",
                    images = imagesString,
                    reminder = if (noteObj.has("reminder") && !noteObj.isNull("reminder")) noteObj.getLong("reminder") else null,
                    recurrence = noteObj.optJSONObject("recurrence")?.toString()
                )
                repository.saveNote(note)
                call.resolve()
            } catch (e: Exception) {
                call.reject("Failed to save note: ${e.message}")
            }
        }
    }

    @PluginMethod
    fun deleteNote(call: PluginCall) {
        val id = call.getString("id")
        if (id == null) {
            call.reject("ID is missing")
            return
        }
        scope.launch {
            try {
                repository.deleteNote(id)
                call.resolve()
            } catch (e: Exception) {
                call.reject("Failed to delete note: ${e.message}")
            }
        }
    }

    @PluginMethod
    fun initialize(call: PluginCall) {
        val pin = call.getString("key")
        if (pin == null) {
            call.reject("PIN is missing")
            return
        }

        try {
            val keyManager = com.jackbarkerapps.openkeep.security.KeyManager(context)
            val dbFile = context.getDatabasePath("open-keep-db")
            val dbExists = dbFile.exists()

            val masterKey = if (!dbExists && !keyManager.hasV2Key()) {
                keyManager.generateRandomMasterKeyAndSave(pin)
            } else {
                keyManager.getMasterKeyForPin(pin)
            }

            // Reset any previous instance
            NoteRepository.reset()
            NoteRepository.initialize(context, masterKey)

            // Trigger a dummy query to verify the key works
            scope.launch {
                try {
                    repository = NoteRepository(context)
                    repository.getAllNotes().first()
                    
                    // If successful, store the key for auto-unlock and upgrade to V2 if needed
                    try {
                        keyManager.upgradeToV2(masterKey, pin)
                        keyManager.storeMasterKey(masterKey)
                        call.resolve()
                    } catch (e: Exception) {
                        android.util.Log.e("NoteStorage", "Failed to store master key for auto-unlock", e)
                        call.reject("Database verified but failed to save encryption key state: ${e.message}")
                    }
                } catch (e: Exception) {
                    android.util.Log.e("NoteStorage", "Database verification failed", e)
                    NoteRepository.reset()
                    call.reject("Failed to open database. Incorrect PIN?")
                }
            }
        } catch (e: Throwable) {
            android.util.Log.e("NoteStorage", "Database initialization failed", e)
            val errorMsg = "Initialization failed: ${e.javaClass.simpleName} - ${e.message ?: "no message"}"
            call.reject(errorMsg)
        }
    }

    @PluginMethod
    fun checkStatus(call: PluginCall) {
        val dbFile = context.getDatabasePath("open-keep-db")
        val isConfigured = dbFile.exists()
        
        val ret = JSObject()
        ret.put("isConfigured", isConfigured)
        ret.put("isLocked", true) // Default to locked

        if (isConfigured) {
            // Try auto-unlock
            try {
                val keyManager = com.jackbarkerapps.openkeep.security.KeyManager(context)
                val storedKey = keyManager.getMasterKey()

                if (storedKey != null) {
                    NoteRepository.reset()
                    NoteRepository.initialize(context, storedKey)

                    // Verify
                    scope.launch {
                        try {
                            repository = NoteRepository(context)
                            repository.getAllNotes().first()
                            // Success!
                            ret.put("isLocked", false)
                            call.resolve(ret)
                        } catch (e: Exception) {
                            // Key might be wrong or DB corrupted?
                            NoteRepository.reset()
                            // call.resolve(ret) // ret already says locked=true
                             call.resolve(ret)
                        }
                    }
                    return // Async resolve in launch
                }
            } catch (e: Exception) {
            }
        }
        
        call.resolve(ret)
    }

    @PluginMethod
    fun encrypt(call: PluginCall) {
        val data = call.getString("data")
        if (data == null) {
            call.reject("Data is missing")
            return
        }
        
        try {
            val keyManager = com.jackbarkerapps.openkeep.security.KeyManager(context)
            val encrypted = keyManager.encrypt(data)
            val ret = JSObject()
            ret.put("data", encrypted)
            call.resolve(ret)
        } catch (e: Exception) {
            call.reject("Encryption failed: ${e.message}")
        }
    }

    @PluginMethod
    fun decrypt(call: PluginCall) {
        val data = call.getString("data")
        if (data == null) {
            call.reject("Data is missing")
            return
        }

        try {
            val keyManager = com.jackbarkerapps.openkeep.security.KeyManager(context)
            val decrypted = keyManager.decrypt(data)
            val ret = JSObject()
            ret.put("data", decrypted)
            call.resolve(ret)
        } catch (e: Exception) {
            call.reject("Decryption failed: ${e.message}")
        }
    }

    @PluginMethod
    fun lock(call: PluginCall) {
         try {
            val keyManager = com.jackbarkerapps.openkeep.security.KeyManager(context)
            keyManager.clear()
            NoteRepository.reset()
            call.resolve()
        } catch (e: Exception) {
            call.reject("Lock failed: ${e.message}")
        }
    }

    @PluginMethod
    fun clearAllData(call: PluginCall) {
        scope.launch {
            try {
                android.util.Log.d("NoteStorage", "Starting clearAllData process")
                
                // 1. Clear KeyManager
                try {
                    android.util.Log.d("NoteStorage", "Clearing KeyManager")
                    val keyManager = com.jackbarkerapps.openkeep.security.KeyManager(context)
                    keyManager.clearAll()
                    android.util.Log.d("NoteStorage", "KeyManager cleared")
                } catch (e: Exception) {
                    android.util.Log.e("NoteStorage", "Error clearing KeyManager: ${e.message}", e)
                }

                // 2. Clear Tables and Get Exact Path
                var actualDbPath: String? = null
                try {
                    android.util.Log.d("NoteStorage", "Attempting to clear tables and get exact DB path")
                    if (com.jackbarkerapps.openkeep.data.NoteRepository.isInitialized()) {
                        val db = com.jackbarkerapps.openkeep.data.NoteRepository.getDatabase()
                        
                        try {
                            db.clearAllTables()
                            android.util.Log.d("NoteStorage", "Successfully cleared all tables in Room")
                        } catch (e: Exception) {
                            android.util.Log.e("NoteStorage", "Failed to clear tables: \${e.message}")
                        }
                        
                        try {
                            actualDbPath = db.openHelper.writableDatabase.path
                            android.util.Log.d("NoteStorage", "Room reports active DB path: \$actualDbPath")
                        } catch (e: Exception) {
                            android.util.Log.e("NoteStorage", "Failed to get active DB path: \${e.message}")
                        }
                    }
                } catch (e: Exception) {
                    android.util.Log.e("NoteStorage", "Error during DB pre-deletion step: \${e.message}", e)
                }

                // 2.5 Reset Repository
                try {
                    android.util.Log.d("NoteStorage", "Resetting NoteRepository")
                    NoteRepository.reset()
                    android.util.Log.d("NoteStorage", "NoteRepository reset")
                } catch (e: Exception) {
                    android.util.Log.e("NoteStorage", "Error resetting NoteRepository: \${e.message}", e)
                }
                
                // Small delay to let Android/Room release any pending file locks
                kotlinx.coroutines.delay(100)

                // 3. Delete Database file
                try {
                    android.util.Log.d("NoteStorage", "Deleting database file")
                    
                    val dbFile = if (actualDbPath != null) java.io.File(actualDbPath) else context.getDatabasePath("open-keep-db")
                    android.util.Log.d("NoteStorage", "Target dbFile path: \${dbFile.absolutePath}, exists: \${dbFile.exists()}")

                    var anyDeleted = false
                    val dbDir = dbFile.parentFile
                    if (dbDir != null && dbDir.exists()) {
                        val baseName = dbFile.name
                        dbDir.listFiles()?.forEach { file ->
                            if (file.name.startsWith(baseName) || file.name.startsWith("open-keep-db")) {
                                val fd = file.delete()
                                android.util.Log.d("NoteStorage", "Deleted DB file \${file.name}: \$fd")
                                if (fd) anyDeleted = true
                            }
                        }
                    }
                    val deletedDb = if (actualDbPath != null) false else context.deleteDatabase("open-keep-db")
                    android.util.Log.d("NoteStorage", "Database file deletion result: loop deleted anything=\$anyDeleted, context delete=\$deletedDb, still exists=\${dbFile.exists()}")
                } catch (e: Exception) {
                    android.util.Log.e("NoteStorage", "Error deleting database file: \${e.message}", e)
                }

                android.util.Log.d("NoteStorage", "clearAllData process completed")
                call.resolve()
            } catch (e: Exception) {
                val errorMsg = "Clear data failed: ${e.javaClass.simpleName} - ${e.message ?: "null"}"
                android.util.Log.e("NoteStorage", errorMsg, e)
                call.reject(errorMsg)
            }
        }
    }

    @PluginMethod
    fun wipeDatabaseButKeepKeys(call: PluginCall) {
        scope.launch {
            try {
                android.util.Log.d("NoteStorage", "Starting wipeDatabaseButKeepKeys process")
                
                try {
                    if (com.jackbarkerapps.openkeep.data.NoteRepository.isInitialized()) {
                        val db = com.jackbarkerapps.openkeep.data.NoteRepository.getDatabase()
                        try {
                            db.clearAllTables()
                        } catch (e: Exception) {}
                    }
                } catch (e: Exception) {}

                NoteRepository.reset()
                
                // Allow Room's background threads to fully release file locks
                kotlinx.coroutines.delay(500)

                try {
                    val dbName = "open-keep-db"
                    val deleted = context.deleteDatabase(dbName)
                    android.util.Log.d("NoteStorage", "Context deleteDatabase returned: $deleted")
                    
                    // Fallback manual deletion just in case
                    val dbFile = context.getDatabasePath(dbName)
                    val dbDir = dbFile.parentFile
                    if (dbDir != null && dbDir.exists()) {
                        dbDir.listFiles()?.forEach { file ->
                            if (file.name.startsWith(dbName)) {
                                val fd = file.delete()
                                android.util.Log.d("NoteStorage", "Manual fallback deleted file ${file.name}: $fd")
                            }
                        }
                    }
                } catch (e: Exception) {
                    android.util.Log.e("NoteStorage", "Error deleting database file during wipe", e)
                }

                call.resolve()
            } catch (e: Exception) {
                call.reject("Failed to wipe database: ${e.message}")
            }
        }
    }

    @PluginMethod
    fun migrateFromWeb(call: PluginCall) {
        val notesArray = call.getArray("notes")
        if (notesArray == null) {
            call.reject("Notes array is missing")
            return
        }

        scope.launch {
            try {
                val notesList = mutableListOf<NoteEntity>()
                for (i in 0 until notesArray.length()) {
                    val noteObj = notesArray.getJSONObject(i)
                    val tagsArray = noteObj.optJSONArray("tags") ?: JSONArray()
                    
                    notesList.add(NoteEntity(
                        id = noteObj.getString("id"),
                        title = noteObj.getString("title"),
                        content = noteObj.getString("content"),
                        type = noteObj.getString("type"),
                        createdAt = noteObj.getLong("createdAt"),
                        updatedAt = noteObj.getLong("updatedAt"),
                        isPinned = noteObj.optBoolean("isPinned", false),
                        isArchived = noteObj.optBoolean("isArchived", false),
                        deleted = noteObj.optBoolean("isDeleted", false),
                        tags = tagsArray.toString(),
                        syncState = "SYNCED",
                        reminder = if (noteObj.has("reminder") && !noteObj.isNull("reminder")) noteObj.getLong("reminder") else null,
                        recurrence = noteObj.optJSONObject("recurrence")?.toString()
                    ))
                }
                repository.bulkInsert(notesList)
                call.resolve()
            } catch (e: Exception) {
                call.reject("Migration failed: ${e.message}")
            }
        }
    }
    @PluginMethod
    fun changeEncryptionKey(call: PluginCall) {
        val oldPin = call.getString("oldPin")
        val newPin = call.getString("newPin")
        
        if (oldPin == null || newPin == null) {
            // Fallback for legacy calls
            val legacyKey = call.getString("key")
            if (legacyKey != null) {
                call.reject("Old PIN is required for V2 architecture to re-wrap the Master Key")
                return
            }
            call.reject("Missing PINs")
            return
        }

        scope.launch {
            try {
                val keyManager = com.jackbarkerapps.openkeep.security.KeyManager(context)
                
                if (keyManager.hasV2Key()) {
                    keyManager.changePinV2(oldPin, newPin)
                } else {
                    // Legacy V1 logic: the PIN-derived key encrypts the DB directly
                    val newDerivedKey = keyManager.deriveLocalKEK(newPin)
                    NoteRepository.changePassword(context, newDerivedKey)
                    
                    // Upgrade them to V2 while we're at it!
                    keyManager.upgradeToV2(newDerivedKey, newPin)
                }
                
                // Keep auto-unlock matching the current Master Key
                val newMasterKey = keyManager.getMasterKeyForPin(newPin)
                keyManager.storeMasterKey(newMasterKey)

                call.resolve()
            } catch (e: Exception) {
                call.reject("Failed to change encryption key: ${e.message}")
            }
        }
    }

    @PluginMethod
    fun exportMasterKey(call: PluginCall) {
        val pin = call.getString("pin")
        if (pin == null) {
            call.reject("PIN is missing")
            return
        }
        try {
            val keyManager = com.jackbarkerapps.openkeep.security.KeyManager(context)
            val payload = keyManager.exportCloudMasterKey(pin)
            val ret = JSObject()
            ret.put("payload", payload)
            call.resolve(ret)
        } catch (e: Exception) {
            call.reject("Failed to export master key: ${e.message}")
        }
    }

    @PluginMethod
    fun importMasterKey(call: PluginCall) {
        val payload = call.getString("payload")
        val pin = call.getString("pin")
        if (payload == null || pin == null) {
            call.reject("Missing payload or PIN")
            return
        }
        try {
            val keyManager = com.jackbarkerapps.openkeep.security.KeyManager(context)
            keyManager.importCloudMasterKey(payload, pin)
            
            // Re-initialize repository with the newly imported master key to prove it works
            val masterKey = keyManager.getMasterKeyForPin(pin)
            NoteRepository.reset()
            NoteRepository.initialize(context, masterKey)

            call.resolve()
        } catch (e: Exception) {
            call.reject("Failed to import master key: ${e.message}")
        }
    }

    @PluginMethod
    fun verifyCloudMasterKeyMatch(call: PluginCall) {
        val payload = call.getString("payload")
        val pin = call.getString("pin")
        if (payload == null || pin == null) {
            call.reject("Missing payload or PIN")
            return
        }
        try {
            val keyManager = com.jackbarkerapps.openkeep.security.KeyManager(context)
            val isMatch = keyManager.verifyCloudMasterKeyMatch(payload, pin)
            val ret = JSObject()
            ret.put("isMatch", isMatch)
            call.resolve(ret)
        } catch (e: Exception) {
            call.reject("Verification failed: ${e.message}")
        }
    }
}
