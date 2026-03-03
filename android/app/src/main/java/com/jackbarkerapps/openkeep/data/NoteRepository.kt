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
        android.util.Log.d("NoteRepository", "Starting rekey operation (ByteArray mode)...")

        val keyManager = com.jackbarkerapps.openkeep.security.KeyManager(context)
        val currentKey = keyManager.getMasterKey()
            ?: throw IllegalStateException("Current encryption key not found.")

        // 1️⃣ Fully close Room
        android.util.Log.d("NoteRepository", "Closing Room instance")
        reset()

        try {
            val dbPath = context.getDatabasePath("open-keep-db").absolutePath

            android.util.Log.d("NoteRepository", "Opening SQLCipher database with current ByteArray key")

            // ✅ IMPORTANT: pass ByteArray directly (NO HEX)
            val rawDb = net.zetetic.database.sqlcipher.SQLiteDatabase.openDatabase(
                dbPath,
                currentKey,
                null,
                net.zetetic.database.sqlcipher.SQLiteDatabase.OPEN_READWRITE
            )

            android.util.Log.d("NoteRepository", "Calling changePassword()")
            rawDb.changePassword(newKey)

            rawDb.close()
            android.util.Log.d("NoteRepository", "Rekey successful")

            // 2️⃣ Reinitialize Room with new key
            initialize(context, newKey)

            // 3️⃣ Verify
            getDatabase().openHelper.writableDatabase.query("SELECT 1").close()
            android.util.Log.d("NoteRepository", "Rekey verified successfully")

        } catch (e: Exception) {
            android.util.Log.e("NoteRepository", "Rekey FAILED", e)

            // restore old state
            initialize(context, currentKey)
            throw e
        }
    }
}                
                // 4. Re-initialize Room with the NEW key
                android.util.Log.d("NoteRepository", "Re-initializing Room with new key")
                initialize(context, newKey)
                
                // 5. Final verification
                try {
                    val verifiedDb = getDatabase().openHelper.writableDatabase
                    verifiedDb.query("SELECT 1").close()
                    android.util.Log.d("NoteRepository", "Encryption key change verified successfully")
                } catch (e: Exception) {
                    android.util.Log.e("NoteRepository", "Room verification FAILED after rekey", e)
                    throw IllegalStateException("The database was rekeyed but Room failed to open it: ${e.message}")
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
