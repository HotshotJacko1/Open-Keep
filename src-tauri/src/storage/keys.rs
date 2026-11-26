// Copyright (c) 2026. Licensed under AGPLv3.
//
// Desktop port of Android's KeyManager (security/KeyManager.kt). The formats
// must stay byte-compatible with it, iOS and src/lib/web-crypto.ts, because the
// exported master key travels between devices through cloud sync:
//
// - master key: 32 random bytes; it is the SQLCipher key and the AES-GCM key
//   for encrypt/decrypt (cloud files, images).
// - wrapped blobs: base64(12-byte IV || AES-256-GCM ciphertext+tag).
// - local KEK: PBKDF2-HMAC-SHA256(PIN, random 16-byte salt, 10000, 32 bytes).
// - export KEK: the same with the fixed salt "OpenKeepCloudExp" (the first 16
//   bytes of "OpenKeepCloudExportSalt123"), so another device can derive it.
//
// Where Android keeps things:
// - EncryptedSharedPreferences "encrypted_master_key_v2" and "kdf_salt" -> keys.json
//   next to the database. Both are only useful with the PIN.
// - EncryptedSharedPreferences "db_master_key" (the unwrapped key, for opening
//   without a PIN) -> Windows Credential Manager, protected by the user's login.

use std::fs;
use std::path::{Path, PathBuf};

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

const ITERATIONS: u32 = 10_000;
const KEY_LEN: usize = 32;
const SALT_LEN: usize = 16;
const IV_LEN: usize = 12;
const EXPORT_SALT: &[u8; 16] = b"OpenKeepCloudExp";
const KEYRING_SERVICE: &str = "com.jackbarkerapps.openkeep";
const KEYRING_USER: &str = "db_master_key";

pub type MasterKey = Zeroizing<Vec<u8>>;

#[derive(Default, Serialize, Deserialize)]
struct KeyFile {
    #[serde(skip_serializing_if = "Option::is_none")]
    encrypted_master_key_v2: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    kdf_salt: Option<String>,
}

pub struct KeyManager {
    path: PathBuf,
}

/// Base64 as Android writes it (Base64.DEFAULT wraps lines), web, or JSON-quoted.
fn decode_b64(data: &str) -> Result<Vec<u8>, String> {
    let cleaned: String = data.chars().filter(|c| !c.is_whitespace()).collect();
    STANDARD
        .decode(cleaned)
        .map_err(|_| "Invalid encrypted data".to_string())
}

fn derive(pin: &str, salt: &[u8]) -> MasterKey {
    let mut out = Zeroizing::new(vec![0u8; KEY_LEN]);
    pbkdf2::pbkdf2_hmac::<sha2::Sha256>(pin.as_bytes(), salt, ITERATIONS, &mut out);
    out
}

pub fn encrypt_with(key: &[u8], plaintext: &[u8]) -> Result<String, String> {
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| "Invalid key length".to_string())?;
    let mut iv = [0u8; IV_LEN];
    rand::thread_rng().fill_bytes(&mut iv);
    let ciphertext = cipher
        .encrypt(Nonce::from_slice(&iv), plaintext)
        .map_err(|_| "Encryption failed".to_string())?;
    let mut combined = Vec::with_capacity(IV_LEN + ciphertext.len());
    combined.extend_from_slice(&iv);
    combined.extend_from_slice(&ciphertext);
    Ok(STANDARD.encode(combined))
}

pub fn decrypt_with(key: &[u8], encoded: &str) -> Result<Zeroizing<Vec<u8>>, String> {
    let combined = decode_b64(encoded)?;
    if combined.len() < IV_LEN {
        return Err("Invalid encrypted data".into());
    }
    let (iv, ciphertext) = combined.split_at(IV_LEN);
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| "Invalid key length".to_string())?;
    cipher
        .decrypt(Nonce::from_slice(iv), ciphertext)
        .map(Zeroizing::new)
        .map_err(|_| "Decryption failed".to_string())
}

impl KeyManager {
    pub fn new(dir: &Path) -> Self {
        Self { path: dir.join("keys.json") }
    }

    fn read(&self) -> Result<KeyFile, String> {
        match fs::read_to_string(&self.path) {
            Ok(text) => serde_json::from_str(&text).map_err(|e| format!("Key file is unreadable: {e}")),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(KeyFile::default()),
            Err(e) => Err(format!("Could not read key file: {e}")),
        }
    }

    /// Written to a temporary file and renamed over the old one, so a crash
    /// mid-write never leaves a half-written key behind.
    fn write(&self, file: &KeyFile) -> Result<(), String> {
        if let Some(dir) = self.path.parent() {
            fs::create_dir_all(dir).map_err(|e| format!("Could not create data folder: {e}"))?;
        }
        let tmp = self.path.with_extension("json.tmp");
        let text = serde_json::to_string(file).map_err(|e| e.to_string())?;
        fs::write(&tmp, text).map_err(|e| format!("Could not write key file: {e}"))?;
        fs::rename(&tmp, &self.path).map_err(|e| format!("Could not save key file: {e}"))
    }

    fn salt(&self) -> Result<Vec<u8>, String> {
        let mut file = self.read()?;
        if let Some(salt) = &file.kdf_salt {
            return decode_b64(salt);
        }
        let mut salt = vec![0u8; SALT_LEN];
        rand::thread_rng().fill_bytes(&mut salt);
        file.kdf_salt = Some(STANDARD.encode(&salt));
        self.write(&file)?;
        Ok(salt)
    }

    pub fn derive_local_kek(&self, pin: &str) -> Result<MasterKey, String> {
        Ok(derive(pin, &self.salt()?))
    }

    fn derive_export_kek(pin: &str) -> MasterKey {
        derive(pin, EXPORT_SALT)
    }

    pub fn has_v2_key(&self) -> Result<bool, String> {
        Ok(self.read()?.encrypted_master_key_v2.is_some())
    }

    fn save_wrapped(&self, master: &[u8], pin: &str) -> Result<(), String> {
        let kek = self.derive_local_kek(pin)?;
        let wrapped = encrypt_with(&kek, master)?;
        let mut file = self.read()?;
        file.encrypted_master_key_v2 = Some(wrapped);
        self.write(&file)
    }

    pub fn generate_master_key_and_save(&self, pin: &str) -> Result<MasterKey, String> {
        let mut master = Zeroizing::new(vec![0u8; KEY_LEN]);
        rand::thread_rng().fill_bytes(&mut master);
        self.save_wrapped(&master, pin)?;
        Ok(master)
    }

    /// Unwraps the master key with `pin`. Fails on a wrong PIN (the GCM tag check).
    /// Without a wrapped key, the PIN-derived key is the master key (Android's V1).
    pub fn master_key_for_pin(&self, pin: &str) -> Result<MasterKey, String> {
        let kek = self.derive_local_kek(pin)?;
        match self.read()?.encrypted_master_key_v2 {
            Some(wrapped) => decrypt_with(&kek, &wrapped).map_err(|_| "Incorrect PIN".to_string()),
            None => Ok(kek),
        }
    }

    pub fn upgrade_to_v2(&self, master: &[u8], pin: &str) -> Result<(), String> {
        if self.has_v2_key()? {
            return Ok(());
        }
        self.save_wrapped(master, pin)
    }

    pub fn change_pin(&self, old_pin: &str, new_pin: &str) -> Result<MasterKey, String> {
        let master = self.master_key_for_pin(old_pin)?;
        self.save_wrapped(&master, new_pin)?;
        Ok(master)
    }

    pub fn export_cloud_master_key(&self, pin: &str) -> Result<String, String> {
        let master = self.master_key_for_pin(pin)?;
        encrypt_with(&Self::derive_export_kek(pin), &master)
    }

    pub fn import_cloud_master_key(&self, payload: &str, pin: &str) -> Result<MasterKey, String> {
        let master = decrypt_with(&Self::derive_export_kek(pin), payload)
            .map_err(|_| "Cloud key does not open with this PIN".to_string())?;
        if master.len() != KEY_LEN {
            return Err("Cloud key has the wrong length".into());
        }
        self.save_wrapped(&master, pin)?;
        self.store_master_key(&master)?;
        Ok(master)
    }

    pub fn can_decrypt_cloud_master_key(payload: &str, pin: &str) -> bool {
        decrypt_with(&Self::derive_export_kek(pin), payload).is_ok()
    }

    pub fn verify_cloud_master_key_match(&self, payload: &str, pin: &str) -> bool {
        let Ok(cloud) = decrypt_with(&Self::derive_export_kek(pin), payload) else {
            return false;
        };
        match self.master_key_for_pin(pin) {
            Ok(current) => *cloud == *current,
            Err(_) => false,
        }
    }

    // ── Auto-unlock key (Credential Manager) ──────────────────────────────

    fn entry() -> Result<keyring::Entry, String> {
        keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER).map_err(|e| format!("Credential store unavailable: {e}"))
    }

    pub fn store_master_key(&self, master: &[u8]) -> Result<(), String> {
        Self::entry()?
            .set_password(&STANDARD.encode(master))
            .map_err(|e| format!("Could not save the key to Credential Manager: {e}"))
    }

    pub fn stored_master_key(&self) -> Option<MasterKey> {
        let encoded = Zeroizing::new(Self::entry().ok()?.get_password().ok()?);
        decode_b64(&encoded).ok().map(Zeroizing::new)
    }

    /// Android's clear(): forget the auto-unlock key, keep the wrapped one.
    pub fn clear(&self) {
        if let Ok(entry) = Self::entry() {
            let _ = entry.delete_credential();
        }
    }

    /// Android's clearAll(): also the wrapped key and the salt, so a reset
    /// doesn't re-derive the same KEK from the same PIN.
    pub fn clear_all(&self) -> Result<(), String> {
        self.clear();
        match fs::remove_file(&self.path) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(format!("Could not delete key file: {e}")),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn export_kek_salt_matches_android() {
        assert_eq!(&b"OpenKeepCloudExportSalt123"[..16], EXPORT_SALT);
    }

    #[test]
    fn round_trips_and_rejects_wrong_key() {
        let key = [7u8; 32];
        let blob = encrypt_with(&key, b"hello").unwrap();
        assert_eq!(&*decrypt_with(&key, &blob).unwrap(), b"hello");
        assert!(decrypt_with(&[8u8; 32], &blob).is_err());
    }

    #[test]
    fn accepts_android_line_wrapped_base64() {
        let key = [1u8; 32];
        let blob = encrypt_with(&key, &[9u8; 64]).unwrap();
        let wrapped = format!("{}\n{}\n", &blob[..40], &blob[40..]);
        assert_eq!(decrypt_with(&key, &wrapped).unwrap().len(), 64);
    }

    #[test]
    fn pin_wraps_master_key_and_exports_for_cloud() {
        let dir = std::env::temp_dir().join(format!("ok-keys-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let km = KeyManager::new(&dir);
        let master = km.generate_master_key_and_save("1234").unwrap();
        assert_eq!(*km.master_key_for_pin("1234").unwrap(), *master);
        assert!(km.master_key_for_pin("9999").is_err());

        let payload = km.export_cloud_master_key("1234").unwrap();
        assert!(KeyManager::can_decrypt_cloud_master_key(&payload, "1234"));
        assert!(!KeyManager::can_decrypt_cloud_master_key(&payload, "4321"));
        assert!(km.verify_cloud_master_key_match(&payload, "1234"));

        km.change_pin("1234", "5678").unwrap();
        assert_eq!(*km.master_key_for_pin("5678").unwrap(), *master);
        let _ = fs::remove_dir_all(&dir);
    }
}
