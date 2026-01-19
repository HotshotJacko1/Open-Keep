package com.jackbarkerapps.openkeep.data

import android.content.Context
import androidx.room.Room
import kotlinx.coroutines.flow.Flow

class NoteRepository(context: Context) {
    // Singleton pattern for DB to prevent multiple instances
    companion object {
        @Volatile
        private var INSTANCE: AppDatabase? = null

        fun getDatabase(context: Context): AppDatabase {
            return INSTANCE ?: synchronized(this) {
                val instance = Room.databaseBuilder(
                    context.applicationContext,
                    AppDatabase::class.java,
                    "open-keep-db"
                ).build()
                INSTANCE = instance
                instance
            }
        }
    }

    private val db = getDatabase(context)
    private val dao = db.noteDao()

    fun getAllNotes(): Flow<List<NoteEntity>> = dao.getAllNotes()

    suspend fun saveNote(note: NoteEntity) {
        dao.insertNote(note)
    }

    suspend fun deleteNote(id: String) {
        dao.markDeleted(id, System.currentTimeMillis())
    }

    suspend fun bulkInsert(notes: List<NoteEntity>) {
        dao.insertAll(notes)
    }
}
