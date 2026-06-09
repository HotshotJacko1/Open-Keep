package com.jackbarkerapps.openkeep.security

import android.content.Context
import android.content.SharedPreferences
import android.util.Base64
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import java.security.SecureRandom
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec
import javax.crypto.Cipher
import javax.crypto.spec.SecretKeySpec
import javax.crypto.spec.GCMParameterSpec

class KeyManager(private val context: Context) {

    companion object {
        private const val SHARED_PREFS_FILENAME = "secure_prefs"
        private const val KEY_ALIAS = "db_master_key"
        private const val ENCRYPTED_MASTER_KEY_V2 = "encrypted_master_key_v2"
        private const val SALT_KEY = "kdf_salt"
        private const val SALT_SIZE = 16
        private const val ITERATIONS = 10000 // OWASP recommends higher, but this is reasonable for mobile
        private const val KEY_LENGTH = 256
    }

    private val masterKey by lazy {
        MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
    }

    private val securePrefs: SharedPreferences by lazy {
        try {
            createSecurePrefs()
        } catch (e: Exception) {
            android.util.Log.e("KeyManager", "Failed to create EncryptedSharedPreferences, retrying after delete", e)
            try {
                // Delete the file and try again - this handles cases where the key is lost/corrupted
                deletePrefs()
                createSecurePrefs()
            } catch (e2: Exception) {
                android.util.Log.e("KeyManager", "Secondary failure creating EncryptedSharedPreferences, attempting Keystore clear", e2)
                try {
                    // Last ditch effort: clear the Keystore entry itself
                    clearKeyStore()
                    deletePrefs()
                    createSecurePrefs()
                } catch (e3: Exception) {
                    android.util.Log.e("KeyManager", "Fatal error creating EncryptedSharedPreferences after Keystore clear", e3)
                    throw e3
                }
            }
        }
    }

    private fun deletePrefs() {
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.N) {
            context.deleteSharedPreferences(SHARED_PREFS_FILENAME)
        } else {
            val file = java.io.File(context.filesDir.parent, "shared_prefs/$SHARED_PREFS_FILENAME.xml")
            if (file.exists()) {
                file.delete()
            }
        }
    }

    private fun clearKeyStore() {
        try {
            val keyStore = java.security.KeyStore.getInstance("AndroidKeyStore")
            keyStore.load(null)
            keyStore.deleteEntry(MasterKey.DEFAULT_MASTER_KEY_ALIAS)
            android.util.Log.d("KeyManager", "Cleared MasterKey from KeyStore")
        } catch (e: Exception) {
            android.util.Log.e("KeyManager", "Failed to clear KeyStore entry", e)
        }
    }

    private fun createSecurePrefs(): SharedPreferences {
        return EncryptedSharedPreferences.create(
            context,
            SHARED_PREFS_FILENAME,
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )
    }

    private val standardPrefs: SharedPreferences by lazy { 
        context.getSharedPreferences("app_prefs", Context.MODE_PRIVATE)
    }

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

    // Derives local KEK using local salt
    fun deriveLocalKEK(pin: String): ByteArray {
        val salt = getOrGenerateSalt()
        val spec = PBEKeySpec(pin.toCharArray(), salt, ITERATIONS, KEY_LENGTH)
        val factory = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")
        return factory.generateSecret(spec).encoded
    }

    // Derives Export KEK using static salt for cloud syncing
    private fun deriveExportKEK(pin: String): ByteArray {
        // A static 16-byte salt solely for wrapping the Master Key for cloud export
        val staticSalt = "OpenKeepCloudExportSalt123".toByteArray(Charsets.UTF_8).copyOf(16)
        val spec = PBEKeySpec(pin.toCharArray(), staticSalt, ITERATIONS, KEY_LENGTH)
        val factory = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")
        return factory.generateSecret(spec).encoded
    }

    private fun encryptWithKEK(payload: ByteArray, kek: ByteArray): String {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        val spec = SecretKeySpec(kek, "AES")
        cipher.init(Cipher.ENCRYPT_MODE, spec)
        val iv = cipher.iv
        val ciphertext = cipher.doFinal(payload)
        val combined = ByteArray(iv.size + ciphertext.size)
        System.arraycopy(iv, 0, combined, 0, iv.size)
        System.arraycopy(ciphertext, 0, combined, iv.size, ciphertext.size)
        return Base64.encodeToString(combined, Base64.DEFAULT)
    }

    private fun decryptWithKEK(encryptedBase64: String, kek: ByteArray): ByteArray {
        val combined = Base64.decode(encryptedBase64, Base64.DEFAULT)
        val iv = ByteArray(12)
        if (combined.size < 12) throw IllegalArgumentException("Invalid encrypted payload")
        System.arraycopy(combined, 0, iv, 0, 12)
        val ciphertext = ByteArray(combined.size - 12)
        System.arraycopy(combined, 12, ciphertext, 0, ciphertext.size)
        
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        val spec = SecretKeySpec(kek, "AES")
        val gcmSpec = GCMParameterSpec(128, iv)
        cipher.init(Cipher.DECRYPT_MODE, spec, gcmSpec)
        return cipher.doFinal(ciphertext)
    }

    fun hasV2Key(): Boolean {
        return securePrefs.contains(ENCRYPTED_MASTER_KEY_V2)
    }

    fun generateRandomMasterKeyAndSave(pin: String): ByteArray {
        val masterKey = ByteArray(32)
        SecureRandom().nextBytes(masterKey)
        val kek = deriveLocalKEK(pin)
        val encrypted = encryptWithKEK(masterKey, kek)
        securePrefs.edit().putString(ENCRYPTED_MASTER_KEY_V2, encrypted).apply()
        return masterKey
    }

    fun getMasterKeyForPin(pin: String): ByteArray {
        val v2Encoded = securePrefs.getString(ENCRYPTED_MASTER_KEY_V2, null)
        if (v2Encoded != null) {
            val kek = deriveLocalKEK(pin)
            return decryptWithKEK(v2Encoded, kek)
        }
        // Fallback to V1 logic where the derived PIN key IS the Master Key
        return deriveLocalKEK(pin)
    }

    fun upgradeToV2(masterKey: ByteArray, pin: String) {
        val v2Encoded = securePrefs.getString(ENCRYPTED_MASTER_KEY_V2, null)
        if (v2Encoded == null) {
            val kek = deriveLocalKEK(pin)
            val encrypted = encryptWithKEK(masterKey, kek)
            securePrefs.edit().putString(ENCRYPTED_MASTER_KEY_V2, encrypted).apply()
        }
    }

    fun exportCloudMasterKey(pin: String): String {
        val masterKey = getMasterKeyForPin(pin)
        val exportKEK = deriveExportKEK(pin)
        return encryptWithKEK(masterKey, exportKEK)
    }

    fun importCloudMasterKey(payload: String, pin: String) {
        val exportKEK = deriveExportKEK(pin)
        val masterKey = decryptWithKEK(payload, exportKEK)
        // Save it locally wrapped with local KEK
        val localKEK = deriveLocalKEK(pin)
        val encryptedLocal = encryptWithKEK(masterKey, localKEK)
        securePrefs.edit().putString(ENCRYPTED_MASTER_KEY_V2, encryptedLocal).apply()
        // Also save it for auto-unlock
        storeMasterKey(masterKey)
    }

    fun canDecryptCloudMasterKey(payload: String, pin: String): Boolean {
        return try {
            val exportKEK = deriveExportKEK(pin)
            decryptWithKEK(payload, exportKEK)
            true
        } catch (e: Exception) {
            false
        }
    }

    fun verifyCloudMasterKeyMatch(payload: String, pin: String): Boolean {
        try {
            val exportKEK = deriveExportKEK(pin)
            val cloudMasterKey = decryptWithKEK(payload, exportKEK)
            val currentMasterKey = getMasterKeyForPin(pin)
            return cloudMasterKey.contentEquals(currentMasterKey)
        } catch (e: Exception) {
            return false
        }
    }

    fun changePinV2(oldPin: String, newPin: String) {
        val masterKey = getMasterKeyForPin(oldPin)
        val newLocalKEK = deriveLocalKEK(newPin)
        val encryptedLocal = encryptWithKEK(masterKey, newLocalKEK)
        securePrefs.edit().putString(ENCRYPTED_MASTER_KEY_V2, encryptedLocal).apply()
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
            
            // NO_WRAP prevents line breaks in base64 output, which avoids
            // issues when the encrypted data is transmitted via JSON (e.g. Google Drive sync).
            return Base64.encodeToString(combined, Base64.NO_WRAP)
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
        // We do NOT clear ENCRYPTED_MASTER_KEY_V2, as that represents our locked database key.
        // Clearing KEY_ALIAS simply "locks" the auto-unlock feature.
    }

    fun clearAll() {
        clear()
        securePrefs.edit().remove(ENCRYPTED_MASTER_KEY_V2).apply()
    }
}
