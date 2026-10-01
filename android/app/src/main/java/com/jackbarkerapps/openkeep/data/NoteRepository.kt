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

        // Key INSTANCE was built with, so a warm instance can be reused when the
        // same key is asked for again (see openWithKey).
        private var instanceKey: ByteArray? = null

        fun initialize(context: Context, keyBytes: ByteArray) {
             android.util.Log.d("NoteRepository", "Initializing database...")
             try {
                System.loadLibrary("sqlcipher")
                android.util.Log.d("NoteRepository", "sqlcipher library loaded")
             } catch (e: Throwable) {
                android.util.Log.e("NoteRepository", "Failed to load sqlcipher library", e)
                throw e
             }
             
             synchronized(this) {
                if (INSTANCE == null) {
                    // Resolved under the lock, before any connection exists: it may re-key the file.
                    val factory = net.zetetic.database.sqlcipher.SupportOpenHelperFactory(passphraseFor(context, keyBytes))
                    android.util.Log.d("NoteRepository", "Building Room database instance")
                    val instance = Room.databaseBuilder(
                        context.applicationContext,
                        AppDatabase::class.java,
                        DB_NAME
                    )
                    .openHelperFactory(factory)
                    // One connection, not WAL's writer + reader pool. SQLCipher runs the full
                    // PBKDF2 key derivation (~0.5s, more on low-end phones) for EVERY connection
                    // it opens, so under WAL the first SELECT paid it again on a fresh read
                    // connection even after prewarm() had opened the writer. A notes app gains
                    // nothing from WAL's concurrent reads.
                    .setJournalMode(androidx.room.RoomDatabase.JournalMode.TRUNCATE)
                    .addMigrations(AppDatabase.MIGRATION_1_2, AppDatabase.MIGRATION_2_3, AppDatabase.MIGRATION_3_4)
//                    .fallbackToDestructiveMigration() // Should likely remove this for prod
                    .build()
                    INSTANCE = instance
                    instanceKey = keyBytes.copyOf()
                    _instanceFlow.value = instance
                }
            }
        }

        private const val DB_NAME = "open-keep-db"

        // Never let a failed key attempt delete the file. (SQLCipher's default handler
        // already skips deletion for encrypted databases; this makes it explicit.)
        private val KEEP_FILE_ON_ERROR = net.zetetic.database.DatabaseErrorHandler { _, _ -> }

        /**
         * SQLCipher's raw-key form, x'<64 hex chars>'. Given a key as a passphrase,
         * SQLCipher stretches it with PBKDF2 (256,000 rounds) on every open: ~0.5s on
         * a Pixel 6, seconds on low-end phones. That stretching exists to slow down
         * guessing of human passwords; the master key is already 32 random bytes (and
         * the PIN is stretched separately by KeyManager), so the raw form loses no
         * security and opens in milliseconds.
         */
        @androidx.annotation.VisibleForTesting
        internal fun rawKeyOf(key: ByteArray): ByteArray? {
            if (key.size != 32) return null
            val hex = key.joinToString("") { "%02x".format(it) }
            return "x'$hex'".toByteArray(Charsets.US_ASCII)
        }

        @androidx.annotation.VisibleForTesting
        internal fun openCipherDb(path: String, passphrase: ByteArray): net.zetetic.database.sqlcipher.SQLiteDatabase =
            net.zetetic.database.sqlcipher.SQLiteDatabase.openDatabase(
                path, passphrase, null,
                net.zetetic.database.sqlcipher.SQLiteDatabase.OPEN_READWRITE,
                KEEP_FILE_ON_ERROR, null
            )

        @androidx.annotation.VisibleForTesting
        internal fun canOpen(path: String, passphrase: ByteArray): Boolean =
            try {
                val db = openCipherDb(path, passphrase)
                try {
                    db.rawQuery("SELECT count(*) FROM sqlite_master", null).use { it.moveToFirst() }
                    true
                } finally {
                    db.close()
                }
            } catch (e: Exception) {
                false
            }

        /**
         * The bytes to key the database file with for this master key. New databases
         * are created with the raw key. A database from an older version (keyed with
         * the master key as a passphrase) is re-keyed to the raw form once, here,
         * paying the slow open a final time. Must run with no connection open.
         *
         * Self-healing: the format is detected by trying the raw key first (a few ms),
         * not stored, so a crash mid-way or a restored backup can't leave a stale flag.
         * If neither form opens the file (wrong key), the legacy passphrase is returned
         * and the first read fails exactly as it always did.
         */
        private fun passphraseFor(context: Context, key: ByteArray): ByteArray =
            passphraseForFile(context.getDatabasePath(DB_NAME), key)

        @androidx.annotation.VisibleForTesting
        internal fun passphraseForFile(dbFile: java.io.File, key: ByteArray): ByteArray {
            val raw = rawKeyOf(key) ?: return key
            if (!dbFile.exists()) return raw
            val path = dbFile.absolutePath
            if (canOpen(path, raw)) return raw

            val start = android.os.SystemClock.elapsedRealtime()
            return try {
                val db = openCipherDb(path, key)
                try {
                    // Leave WAL first: SQLCipher can't rekey a database in WAL mode.
                    db.rawQuery("PRAGMA journal_mode = DELETE", null).use { it.moveToFirst() }
                    db.changePassword(raw)
                } finally {
                    db.close()
                }
                android.util.Log.d("NoteRepository", "[Perf] re-keyed database to raw key: ${android.os.SystemClock.elapsedRealtime() - start}ms")
                raw
            } catch (e: Exception) {
                android.util.Log.w("NoteRepository", "Database not re-keyed; keeping passphrase key", e)
                key
            }
        }

        fun reset() {
            synchronized(this) {
                INSTANCE?.close()
                INSTANCE = null
                instanceKey = null
                // Signal to any Flow collectors that the DB is gone
                _instanceFlow.value = null
            }
        }

        fun reinitialize(context: Context, keyBytes: ByteArray) {
            synchronized(this) {
                INSTANCE?.close()
                INSTANCE = null
                instanceKey = null
                _instanceFlow.value = null
                initialize(context, keyBytes)
            }
        }

        /**
         * Like reinitialize(), but keeps the current instance when it was built with
         * this same key, so a database already opened by prewarm() stays open.
         */
        fun openWithKey(context: Context, keyBytes: ByteArray) {
            synchronized(this) {
                val current = instanceKey
                if (INSTANCE != null && current != null && current.contentEquals(keyBytes)) return
                reinitialize(context, keyBytes)
            }
        }

        /**
         * Opens the database in the background at app start, while the WebView is
         * still loading. The first open of a SQLCipher file is slow (PBKDF2 key
         * derivation, page-1 decrypt, Room's identity check: hundreds of ms, over a
         * second on low-end phones); doing it here means loadNotes() finds it done.
         *
         * Best effort: any failure is swallowed. A wrong key still surfaces where it
         * always has, on loadNotes(), which sends the app back to the lock screen.
         */
        fun prewarm(context: Context) {
            try {
                val appContext = context.applicationContext
                if (!appContext.getDatabasePath(DB_NAME).exists()) return
                val key = com.jackbarkerapps.openkeep.security.KeyManager(appContext).getMasterKey() ?: return
                initializeIfNeeded(appContext, key)
                val start = android.os.SystemClock.elapsedRealtime()
                // Outside the companion lock: Room's open helper serialises its own
                // open, so a loadNotes() that arrives mid-open just waits for it.
                INSTANCE?.openHelper?.writableDatabase
                android.util.Log.d("NoteRepository", "[Perf] prewarm open: ${android.os.SystemClock.elapsedRealtime() - start}ms")
            } catch (e: Throwable) {
                android.util.Log.w("NoteRepository", "Database prewarm failed", e)
            }
        }

        /**
         * Atomically check-then-init: if already initialized, this is a no-op.
         * Widgets must use this instead of isInitialized() + initialize() to avoid
         * a TOCTOU race with the plugin's reinitialize().
         */
        fun initializeIfNeeded(context: Context, keyBytes: ByteArray) {
            synchronized(this) {
                if (INSTANCE == null) {
                    initialize(context, keyBytes)
                }
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
                
                // 3. Open a raw SQLCipher connection with whichever key form the file uses
                // (passphraseFor also upgrades an old passphrase-keyed file), then re-key
                // it straight to the new key's raw form.
                try {
                    val dbPath = context.getDatabasePath(DB_NAME).absolutePath
                    android.util.Log.d("NoteRepository", "Opening raw SQLCipher connection at $dbPath")
                    
                    val rawDb = openCipherDb(dbPath, passphraseFor(context, currentKey))
                    
                    android.util.Log.d("NoteRepository", "Changing password using rawDb.changePassword()")
                    rawDb.changePassword(rawKeyOf(newKey) ?: newKey)
                    rawDb.close()
                    android.util.Log.d("NoteRepository", "Rekey operation completed successfully")
                } catch (e: Exception) {
                    android.util.Log.e("NoteRepository", "Rekey FAILED", e)
                    // Restoration attempt with old key
                    reinitialize(context, currentKey)
                    throw e
                }
                
                // 4. Re-initialize Room with the NEW key
                android.util.Log.d("NoteRepository", "Re-initializing Room with new key")
                reinitialize(context, newKey)
                
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

    // We observe the instance flow and flatMapLatest into the actual query, so when it's null we emit empty
    @kotlin.OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
    fun getAllNotes(): Flow<List<NoteEntity>> = instanceFlow.flatMapLatest { instance ->
        instance?.noteDao()?.getAllNotes() ?: throw IllegalStateException("Database not initialized")
    }

    suspend fun saveNote(note: NoteEntity) {
        getDatabase().noteDao().insertNote(note)
    }

    suspend fun deleteNote(id: String) {
        getDatabase().noteDao().markDeleted(id, System.currentTimeMillis())
    }

    suspend fun bulkInsert(notes: List<NoteEntity>) {
        getDatabase().noteDao().insertAll(notes)
    }
}
