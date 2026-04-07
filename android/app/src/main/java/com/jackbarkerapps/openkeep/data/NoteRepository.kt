package com.jackbarkerapps.openkeep.data

import android.content.Context
import androidx.room.Room
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.flatMapLatest

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
                    .addMigrations(AppDatabase.MIGRATION_1_2)
//                    .fallbackToDestructiveMigration() // Should likely remove this for prod
                    .build()
                    INSTANCE = instance
                    _instanceFlow.value = instance
                }
            }
        }

        fun reset() {
            synchronized(this) {
                INSTANCE?.close()
                INSTANCE = null
                // Signal to any Flow collectors that the DB is gone
                _instanceFlow.value = null
            }
        }
        
        // Use a static flow to notify repositories of the current instance
        private val _instanceFlow = kotlinx.coroutines.flow.MutableStateFlow<AppDatabase?>(null)
        val instanceFlow: kotlinx.coroutines.flow.StateFlow<AppDatabase?> = _instanceFlow.asStateFlow()

        fun changePassword(context: Context, newKey: ByteArray) {
            synchronized(this) {
                android.util.Log.d("NoteRepository", "Starting derivation-correct rekey operation...")
                
                // 1. Get the current key from KeyManager
                val keyManager = com.jackbarkerapps.openkeep.security.KeyManager(context)
                val currentKey = keyManager.getMasterKey() ?: throw IllegalStateException("Current encryption key not found in storage.")
                
                // 2. Shut down Room completely
                android.util.Log.d("NoteRepository", "Closing Room instance")
                reset()
                
                // 3. Open a raw SQLCipher connection using the ByteArray directly
                // This ensures SQLCipher applies the same PBKDF2 derivation as Room's SupportOpenHelperFactory.
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
                    
                    android.util.Log.d("NoteRepository", "Changing password using rawDb.changePassword()")
                    rawDb.changePassword(newKey)
                    rawDb.close()
                    android.util.Log.d("NoteRepository", "Rekey operation completed successfully")
                } catch (e: Exception) {
                    android.util.Log.e("NoteRepository", "Rekey FAILED", e)
                    // Restoration attempt with old key
                    initialize(context, currentKey)
                    throw e
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
                    throw IllegalStateException("The database was rekeyed but Room failed to open it. This might happen if derivation settings changed: ${e.message}")
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

    private fun getDao(): NoteDao? {
         return INSTANCE?.noteDao()
    }

    // We observe the instance flow and flatMapLatest into the actual query, so when it's null we emit empty
    @kotlin.OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
    fun getAllNotes(): Flow<List<NoteEntity>> = instanceFlow.flatMapLatest { instance ->
        instance?.noteDao()?.getAllNotes() ?: kotlinx.coroutines.flow.flowOf(emptyList())
    }

    suspend fun saveNote(note: NoteEntity) {
        getDao()?.insertNote(note)
    }

    suspend fun deleteNote(id: String) {
        getDao()?.markDeleted(id, System.currentTimeMillis())
    }

    suspend fun bulkInsert(notes: List<NoteEntity>) {
        getDao()?.insertAll(notes)
    }
}
