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

                val note = NoteEntity(
                    id = noteObj.getString("id") ?: "",
                    title = noteObj.getString("title") ?: "",
                    content = noteObj.getString("content") ?: "",
                    type = noteObj.getString("type") ?: "TEXT",
                    createdAt = noteObj.getLong("createdAt") ?: 0L,
                    updatedAt = noteObj.getLong("updatedAt") ?: 0L,
                    isPinned = noteObj.getBoolean("isPinned") ?: false,
                    isArchived = noteObj.getBoolean("isArchived") ?: false,
                    deleted = noteObj.getBoolean("isDeleted") ?: false,
                    tags = tagsString,
                    syncState = "PENDING"
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
            // Derive key from PIN
            val keyManager = com.jackbarkerapps.openkeep.security.KeyManager(context)
            val derivedKey = keyManager.deriveKey(pin)

            // Reset any previous instance
            NoteRepository.reset()
            NoteRepository.initialize(context, derivedKey)

            // Trigger a dummy query to verify the key works
            scope.launch {
                try {
                    repository = NoteRepository(context)
                    repository.getAllNotes().first()
                    
                    // If successful, store the key for auto-unlock
                    try {
                        keyManager.storeMasterKey(derivedKey)
                        call.resolve()
                    } catch (e: Exception) {
                        android.util.Log.e("NoteStorage", "Failed to store master key for auto-unlock", e)
                        call.reject("Database verified but failed to store encryption key: ${e.message}")
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
                    keyManager.clear()
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
                        syncState = "SYNCED"
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
        val key = call.getString("key")
        if (key == null) {
            call.reject("Key is missing")
            return
        }

        scope.launch {
            try {
                // Derive key from PIN
                val keyManager = com.jackbarkerapps.openkeep.security.KeyManager(context)
                val derivedKey = keyManager.deriveKey(key)

                NoteRepository.changePassword(context, derivedKey)
                
                // Update stored key for future auto-unlocks
                keyManager.storeMasterKey(derivedKey)

                call.resolve()
            } catch (e: Exception) {
                call.reject("Failed to change encryption key: ${e.message}")
            }
        }
    }
}
