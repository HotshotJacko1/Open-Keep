package com.jackbarkerapps.openkeep.data

import android.content.Context
import androidx.room.Room
import kotlinx.coroutines.flow.Flow

class NoteRepository(context: Context) {
    // Singleton pattern for DB to prevent multiple instances
    companion object {
        @Volatile
        private var INSTANCE: AppDatabase? = null

        fun initialize(context: Context, keyBytes: ByteArray) {
             android.util.Log.d("NoteRepository", "Initializing database...")
             try {
                System.loadLibrary("sqlcipher")
                android.util.Log.d("NoteRepository", "sqlcipher library loaded")
             } catch (e: Throwable) {
                android.util.Log.e("NoteRepository", "Failed to load sqlcipher library", e)
                throw e
             }
             
             // Pass the raw bytes directly to the factory
             val factory = net.zetetic.database.sqlcipher.SupportOpenHelperFactory(keyBytes)
             
             synchronized(this) {
                if (INSTANCE == null) {
                    android.util.Log.d("NoteRepository", "Building Room database instance")
                    val instance = Room.databaseBuilder(
                        context.applicationContext,
                        AppDatabase::class.java,
                        "open-keep-db"
                    )
                    .openHelperFactory(factory)
//                    .fallbackToDestructiveMigration() // Should likely remove this for prod
                    .build()
                    INSTANCE = instance
                }
            }
        }

        fun reset() {
            synchronized(this) {
                INSTANCE?.close()
                INSTANCE = null
            }
        }

        fun changePassword(context: Context, newKey: ByteArray) {
            synchronized(this) {
                val db = INSTANCE?.openHelper?.writableDatabase
                if (db != null && db.isOpen) {
                    val hexKey = newKey.joinToString("") { "%02x".format(it) }
                    // Use .query() instead of .execSQL() because the Android framework 
                    // incorrectly checks the SQL string for PRAGMAs and rejects them in execSQL 
                    // if it thinks they might return results (even if they don't).
                    db.query("PRAGMA rekey = \"x'$hexKey'\"").close()
                    
                    // Close the old instance
                    INSTANCE?.close()
                    INSTANCE = null
                    
                    // Re-initialize with new key
                    initialize(context, newKey)
                } else {
                     throw IllegalStateException("Database is not open, cannot change password.")
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
