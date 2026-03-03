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
                android.util.Log.d("NoteRepository", "Starting low-level rekey operation...")
                
                // 1. Get the current key from KeyManager to open the raw connection
                val keyManager = com.jackbarkerapps.openkeep.security.KeyManager(context)
                val currentKey = keyManager.getMasterKey() ?: throw IllegalStateException("Current encryption key not found in storage.")
                
                // 2. Shut down Room completely to release all connections
                android.util.Log.d("NoteRepository", "Closing Room instance")
                reset()
                
                // 3. Open a raw SQLCipher connection and perform the rekey
                try {
                    val dbPath = context.getDatabasePath("open-keep-db").absolutePath
                    android.util.Log.d("NoteRepository", "Opening raw SQLCipher connection at $dbPath")
                    
                    val rawDb = net.zetetic.database.sqlcipher.SQLiteDatabase.openDatabase(
                        dbPath,
                        currentKey,
                        null,
                        net.zetetic.database.sqlcipher.SQLiteDatabase.OPEN_READWRITE,
                        null
                    )
                    
                    val hexNewKey = newKey.joinToString("") { "%02x".format(it) }
                    android.util.Log.d("NoteRepository", "Executing PRAGMA rekey")
                    rawDb.execSQL("PRAGMA rekey = \"x'$hexNewKey'\"")
                    rawDb.close()
                    android.util.Log.d("NoteRepository", "Raw rekey command completed successfully")
                } catch (e: Exception) {
                    android.util.Log.e("NoteRepository", "Raw rekey FAILED", e)
                    // If raw rekey fails, try to restore Room with the old key
                    initialize(context, currentKey)
                    throw e
                }
                
                // 4. Re-initialize Room with the NEW key
                android.util.Log.d("NoteRepository", "Re-initializing Room with new key")
                initialize(context, newKey)
                
                // 5. Final verification through Room
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
