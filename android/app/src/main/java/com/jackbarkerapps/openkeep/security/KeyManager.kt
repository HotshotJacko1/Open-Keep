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

    fun encrypt(plaintext: String, key: ByteArray? = getMasterKey()): String {
        if (key == null) throw IllegalStateException("No master key available")
        
        val cipher = javax.crypto.Cipher.getInstance("AES/GCM/NoPadding")
        val spec = javax.crypto.spec.SecretKeySpec(key, "AES")
        cipher.init(javax.crypto.Cipher.ENCRYPT_MODE, spec)
        
        val iv = cipher.iv
        val ciphertext = cipher.doFinal(plaintext.toByteArray(Charsets.UTF_8))
        
        // Return IV + Ciphertext encoded in Base64
        val combined = ByteArray(iv.size + ciphertext.size)
        System.arraycopy(iv, 0, combined, 0, iv.size)
        System.arraycopy(ciphertext, 0, combined, iv.size, ciphertext.size)
        
        return Base64.encodeToString(combined, Base64.DEFAULT)
    }

    fun decrypt(encryptedData: String, key: ByteArray? = getMasterKey()): String {
        if (key == null) throw IllegalStateException("No master key available")

        val combined = Base64.decode(encryptedData, Base64.DEFAULT)
        
        // GCM IV is usually 12 bytes
        val iv = ByteArray(12)
        if (combined.size < 12) throw IllegalArgumentException("Invalid encrypted data")
        System.arraycopy(combined, 0, iv, 0, 12)
        
        val ciphertext = ByteArray(combined.size - 12)
        System.arraycopy(combined, 12, ciphertext, 0, ciphertext.size)
        
        val cipher = javax.crypto.Cipher.getInstance("AES/GCM/NoPadding")
        val keySpec = javax.crypto.spec.SecretKeySpec(key, "AES")
        val gcmSpec = javax.crypto.spec.GCMParameterSpec(128, iv) // 128 bit auth tag
        
        cipher.init(javax.crypto.Cipher.DECRYPT_MODE, keySpec, gcmSpec)
        val plaintextBytes = cipher.doFinal(ciphertext)
        
        return String(plaintextBytes, Charsets.UTF_8)
    }

    fun clear() {
        securePrefs.edit().remove(KEY_ALIAS).apply()
        // Do we clear salt? Probably not, or we can't derive same key if user re-enters PIN
        // But if user "resets" app, we might. behavior depends on "logout".
        // For now, keep salt to allow re-login with same PIN to same DB.
    }
}
