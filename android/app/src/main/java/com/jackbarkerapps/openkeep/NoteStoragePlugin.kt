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
                    deleted = false,
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
                    keyManager.storeMasterKey(derivedKey)
                    
                    call.resolve()
                } catch (e: Exception) {
                    NoteRepository.reset()
                    call.reject("Failed to open database. Incorrect PIN?")
                }
            }
        } catch (e: Exception) {
             call.reject("Initialization failed: ${e.message}")
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
                // Failed to check key or whatever, treat as locked
            }
        }
        
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
                        deleted = false,
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
