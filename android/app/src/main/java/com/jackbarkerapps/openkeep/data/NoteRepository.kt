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
                    android.util.Log.d("NoteRepository", "Starting rekey operation...")
                    
                    try {
                        // PRAGMA rekey changes the key on the connection. 
                        // Because of how Android's SupportSQLiteDatabase handles verification,
                        // this often throws an exception immediately after the key changes 
                        // because it tries to verify the connection using the OLD key/state.
                        db.query("PRAGMA rekey = \"x'$hexKey'\"").close()
                        android.util.Log.d("NoteRepository", "Rekey command executed (no exception)")
                    } catch (e: Exception) {
                        // This exception is EXPECTED if the library tries to verify the 
                        // connection immediately after the key change. 
                        android.util.Log.d("NoteRepository", "Rekey command executed (caught expected transition exception: ${e.message})")
                    }
                    
                    // Crucially: Reset the current instance (which is now invalid/locked)
                    android.util.Log.d("NoteRepository", "Resetting database instance for re-initialization")
                    reset()
                    
                    // Re-initialize with the NEW key
                    android.util.Log.d("NoteRepository", "Re-initializing with new key")
                    initialize(context, newKey)
                    
                    // VERIFY the new key works before returning success
                    try {
                         val verifiedDb = getDatabase().openHelper.writableDatabase
                         verifiedDb.query("SELECT 1").close()
                         android.util.Log.d("NoteRepository", "New key verified successfully")
                    } catch (e: Exception) {
                        android.util.Log.e("NoteRepository", "Verification of new key FAILED", e)
                        throw IllegalStateException("Rekey seemed to work but new key failed verification: ${e.message}")
                    }
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
