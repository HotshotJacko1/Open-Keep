package com.jackbarkerapps.openkeep.security

import android.content.Context
import android.content.SharedPreferences
import android.util.Base64
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import java.security.SecureRandom
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec

class KeyManager(private val context: Context) {

    companion object {
        private const val SHARED_PREFS_FILENAME = "secure_prefs"
        private const val KEY_ALIAS = "db_master_key"
        private const val SALT_KEY = "kdf_salt"
        private const val SALT_SIZE = 16
        private const val ITERATIONS = 10000 // OWASP recommends higher, but this is reasonable for mobile
        private const val KEY_LENGTH = 256
    }

    private val masterKey = MasterKey.Builder(context)
        .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
        .build()

    private val securePrefs: SharedPreferences = EncryptedSharedPreferences.create(
        context,
        SHARED_PREFS_FILENAME,
        masterKey,
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
    )

    private val standardPrefs: SharedPreferences = context.getSharedPreferences("app_prefs", Context.MODE_PRIVATE)

    fun getOrGenerateSalt(): ByteArray {
        val saltString = standardPrefs.getString(SALT_KEY, null)
        if (saltString != null) {
            return Base64.decode(saltString, Base64.DEFAULT)
        }

        val salt = ByteArray(SALT_SIZE)
        SecureRandom().nextBytes(salt)
        val encodedSalt = Base64.encodeToString(salt, Base64.DEFAULT)
        standardPrefs.edit().putString(SALT_KEY, encodedSalt).apply()
        return salt
    }

    fun deriveKey(pin: String): ByteArray {
        val salt = getOrGenerateSalt()
        val spec = PBEKeySpec(pin.toCharArray(), salt, ITERATIONS, KEY_LENGTH)
        val factory = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")
        return factory.generateSecret(spec).encoded
    }

    fun storeMasterKey(key: ByteArray) {
        val encodedKey = Base64.encodeToString(key, Base64.DEFAULT)
        securePrefs.edit().putString(KEY_ALIAS, encodedKey).apply()
    }

    fun getMasterKey(): ByteArray? {
        val encodedKey = securePrefs.getString(KEY_ALIAS, null) ?: return null
        return Base64.decode(encodedKey, Base64.DEFAULT)
    }

    fun clear() {
        securePrefs.edit().remove(KEY_ALIAS).apply()
        // Do we clear salt? Probably not, or we can't derive same key if user re-enters PIN
        // But if user "resets" app, we might. behavior depends on "logout".
        // For now, keep salt to allow re-login with same PIN to same DB.
    }
}
