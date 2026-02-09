package com.jackbarkerapps.openkeep.data

import android.content.Context
import androidx.room.Room
import kotlinx.coroutines.flow.Flow

class NoteRepository(context: Context) {
    // Singleton pattern for DB to prevent multiple instances
    companion object {
        @Volatile
        private var INSTANCE: AppDatabase? = null

        fun initialize(context: Context, passphrase:  CharArray) {
             System.loadLibrary("sqlcipher")
             
             val factory = net.sqlcipher.database.SupportFactory(net.sqlcipher.database.SQLiteDatabase.getBytes(passphrase))
             
             synchronized(this) {
                if (INSTANCE == null) {
                    val instance = Room.databaseBuilder(
                        context.applicationContext,
                        AppDatabase::class.java,
                        "open-keep-db"
                    )
                    .openHelperFactory(factory)
                    .fallbackToDestructiveMigration() // For now, if schema changes or key is wrong and we can't migrate
                    .build()
                    INSTANCE = instance
                }
            }
        }
        
        fun isInitialized(): Boolean {
            return INSTANCE != null
        }

        fun getDatabase(): AppDatabase {
            return INSTANCE ?: throw IllegalStateException("Database not initialized. Call initialize() first.")
        }
    }

    private fun getDao(): NoteDao {
         return getDatabase().noteDao()
    }

    fun getAllNotes(): Flow<List<NoteEntity>> = getDao().getAllNotes()

    suspend fun saveNote(note: NoteEntity) {
        getDao().insertNote(note)
    }

    suspend fun deleteNote(id: String) {
        getDao().markDeleted(id, System.currentTimeMillis())
    }

    suspend fun bulkInsert(notes: List<NoteEntity>) {
        getDao().insertAll(notes)
    }
}
