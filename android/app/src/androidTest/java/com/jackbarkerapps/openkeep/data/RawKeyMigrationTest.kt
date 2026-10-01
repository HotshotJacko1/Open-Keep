package com.jackbarkerapps.openkeep.data

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import net.zetetic.database.sqlcipher.SQLiteDatabase
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.security.SecureRandom

/**
 * Re-keying from the legacy passphrase key to SQLCipher's raw-key form. Works on
 * throwaway files in the test's cache dir, never the app's real database.
 */
@RunWith(AndroidJUnit4::class)
class RawKeyMigrationTest {
    private lateinit var dir: File
    private lateinit var dbFile: File

    @Before
    fun setUp() {
        System.loadLibrary("sqlcipher")
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        dir = File(context.cacheDir, "raw-key-test-${System.nanoTime()}").apply { mkdirs() }
        dbFile = File(dir, "notes.db")
    }

    @After
    fun tearDown() {
        dir.deleteRecursively()
    }

    private fun randomKey() = ByteArray(32).also { SecureRandom().nextBytes(it) }

    /** A database the way older app versions left it: master key used as a passphrase, WAL on. */
    private fun createLegacyDb(key: ByteArray, wal: Boolean = true) {
        val db = SQLiteDatabase.openOrCreateDatabase(dbFile, key, null, null, null)
        try {
            if (wal) db.rawQuery("PRAGMA journal_mode = WAL", null).use { it.moveToFirst() }
            db.execSQL("CREATE TABLE notes (id TEXT PRIMARY KEY, content TEXT)")
            db.execSQL("INSERT INTO notes VALUES ('a', 'hello'), ('b', 'world')")
        } finally {
            db.close()
        }
    }

    private fun readContents(passphrase: ByteArray): List<String> {
        val db = NoteRepository.openCipherDb(dbFile.absolutePath, passphrase)
        try {
            db.rawQuery("SELECT content FROM notes ORDER BY id", null).use { c ->
                val out = mutableListOf<String>()
                while (c.moveToNext()) out.add(c.getString(0))
                return out
            }
        } finally {
            db.close()
        }
    }

    @Test
    fun legacyDatabaseIsRekeyedToRawKeyWithDataIntact() {
        val key = randomKey()
        createLegacyDb(key)
        val raw = NoteRepository.rawKeyOf(key)!!

        val result = NoteRepository.passphraseForFile(dbFile, key)

        assertArrayEquals(raw, result)
        assertEquals(listOf("hello", "world"), readContents(raw))
        assertFalse("old passphrase must no longer open it", NoteRepository.canOpen(dbFile.absolutePath, key))
    }

    @Test
    fun alreadyRawDatabaseIsLeftAlone() {
        val key = randomKey()
        createLegacyDb(key)
        NoteRepository.passphraseForFile(dbFile, key)
        val modified = dbFile.lastModified()

        val result = NoteRepository.passphraseForFile(dbFile, key)

        assertArrayEquals(NoteRepository.rawKeyOf(key), result)
        assertEquals(modified, dbFile.lastModified())
        assertEquals(listOf("hello", "world"), readContents(result))
    }

    @Test
    fun nonWalLegacyDatabaseIsRekeyed() {
        val key = randomKey()
        createLegacyDb(key, wal = false)

        val result = NoteRepository.passphraseForFile(dbFile, key)

        assertArrayEquals(NoteRepository.rawKeyOf(key), result)
        assertEquals(listOf("hello", "world"), readContents(result))
    }

    @Test
    fun wrongKeyLeavesFileUntouchedAndReturnsPassphrase() {
        val key = randomKey()
        createLegacyDb(key)
        val wrong = randomKey()

        val result = NoteRepository.passphraseForFile(dbFile, wrong)

        assertArrayEquals(wrong, result)
        assertTrue(dbFile.exists())
        assertEquals("real key still opens the untouched file", listOf("hello", "world"), readContents(key))
    }

    @Test
    fun newDatabaseUsesRawKey() {
        val key = randomKey()
        assertFalse(dbFile.exists())

        assertArrayEquals(NoteRepository.rawKeyOf(key), NoteRepository.passphraseForFile(dbFile, key))
    }

    @Test
    fun rawKeyOpensMuchFasterThanPassphrase() {
        val key = randomKey()
        createLegacyDb(key)
        val t0 = System.nanoTime()
        assertTrue(NoteRepository.canOpen(dbFile.absolutePath, key))
        val passphraseMs = (System.nanoTime() - t0) / 1_000_000

        val raw = NoteRepository.passphraseForFile(dbFile, key)
        val t1 = System.nanoTime()
        assertTrue(NoteRepository.canOpen(dbFile.absolutePath, raw))
        val rawMs = (System.nanoTime() - t1) / 1_000_000

        android.util.Log.d("RawKeyMigrationTest", "passphrase open ${passphraseMs}ms, raw open ${rawMs}ms")
        assertTrue("raw ${rawMs}ms vs passphrase ${passphraseMs}ms", rawMs * 5 < passphraseMs)
    }
}
