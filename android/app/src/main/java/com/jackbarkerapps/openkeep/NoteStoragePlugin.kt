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
        val key = call.getString("key")
        if (key == null) {
            call.reject("Key is missing")
            return
        }
        
        try {
            NoteRepository.initialize(context, key.toCharArray())
            // Trigger a dummy query to verify the key works
            scope.launch {
                try {
                    repository = NoteRepository(context)
                    repository.getAllNotes().first()
                    call.resolve()
                } catch (e: Exception) {
                    // Reset instance if failed
                     // Note: We can't easily reset a static singleton in Kotlin without adding a reset method.
                     // For now, let's assume if it fails, the app must restart or we handle it in Repository.
                     // But actually, SupportFactory will throw on open if key is wrong.
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
        call.resolve(ret)
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
}
