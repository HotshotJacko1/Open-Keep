// Copyright (c) 2026. Licensed under AGPLv3.

const SALT_KEY = "kdf_salt";
const ENCRYPTED_MASTER_KEY_V2 = "encrypted_master_key_v2";
const ITERATIONS = 10000;
const KEY_LENGTH = 256; // bits

// In-memory master key for the session
let sessionMasterKey: CryptoKey | null = null;

const encodeBase64 = (buffer: ArrayBuffer): string => {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
};

const decodeBase64 = (base64: string): ArrayBuffer => {
    const binary = window.atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
};

const getOrGenerateSalt = (): Uint8Array => {
    const existing = localStorage.getItem(SALT_KEY);
    if (existing) {
        return new Uint8Array(decodeBase64(existing));
    }
    const salt = new Uint8Array(16);
    crypto.getRandomValues(salt);
    localStorage.setItem(SALT_KEY, encodeBase64(salt.buffer));
    return salt;
};

const deriveKEK = async (pin: string, salt: Uint8Array): Promise<CryptoKey> => {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
        "raw",
        enc.encode(pin),
        { name: "PBKDF2" },
        false,
        ["deriveBits", "deriveKey"]
    );
    return await crypto.subtle.deriveKey(
        {
            name: "PBKDF2",
            salt: salt,
            iterations: ITERATIONS,
            hash: "SHA-256"
        },
        keyMaterial,
        { name: "AES-GCM", length: KEY_LENGTH },
        true,
        ["encrypt", "decrypt"]
    );
};

const deriveLocalKEK = async (pin: string): Promise<CryptoKey> => {
    const salt = getOrGenerateSalt();
    return await deriveKEK(pin, salt);
};

const deriveExportKEK = async (pin: string): Promise<CryptoKey> => {
    const enc = new TextEncoder();
    // In Android: "OpenKeepCloudExportSalt123".toByteArray(Charsets.UTF_8).copyOf(16)
    // "OpenKeepCloudExportSalt123" is 26 bytes. copyOf(16) takes the first 16 bytes: "OpenKeepCloudExp"
    const staticSaltString = "OpenKeepCloudExportSalt123".substring(0, 16);
    const staticSalt = enc.encode(staticSaltString);
    return await deriveKEK(pin, staticSalt);
};

const encryptWithKEK = async (payload: ArrayBuffer, kek: CryptoKey): Promise<string> => {
    const iv = new Uint8Array(12);
    crypto.getRandomValues(iv);

    const ciphertext = await crypto.subtle.encrypt(
        {
            name: "AES-GCM",
            iv: iv,
            tagLength: 128
        },
        kek,
        payload
    );

    // Combine IV and Ciphertext
    const combined = new Uint8Array(iv.length + ciphertext.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(ciphertext), iv.length);

    return encodeBase64(combined.buffer);
};

const decryptWithKEK = async (encryptedBase64: string, kek: CryptoKey): Promise<ArrayBuffer> => {
    const combined = new Uint8Array(decodeBase64(encryptedBase64));
    if (combined.length < 12) throw new Error("Invalid encrypted payload");

    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);

    return await crypto.subtle.decrypt(
        {
            name: "AES-GCM",
            iv: iv,
            tagLength: 128
        },
        kek,
        ciphertext
    );
};

export const hasV2KeyWeb = (): boolean => {
    return localStorage.getItem(ENCRYPTED_MASTER_KEY_V2) !== null;
};

export const getMasterKeyForPinWeb = async (pin: string): Promise<ArrayBuffer> => {
    const v2Encoded = localStorage.getItem(ENCRYPTED_MASTER_KEY_V2);
    if (v2Encoded) {
        const kek = await deriveLocalKEK(pin);
        return await decryptWithKEK(v2Encoded, kek);
    }
    // Fallback V1 logic
    const kek = await deriveLocalKEK(pin);
    const exportedKek = await crypto.subtle.exportKey("raw", kek);
    return exportedKek;
};

export const storeSessionMasterKey = async (keyBuffer: ArrayBuffer) => {
    sessionMasterKey = await crypto.subtle.importKey(
        "raw",
        keyBuffer,
        { name: "AES-GCM" },
        true,
        ["encrypt", "decrypt"]
    );
};

export const getSessionMasterKey = (): CryptoKey | null => {
    return sessionMasterKey;
};

export const initializeDatabaseWeb = async (pin: string): Promise<void> => {
    if (!hasV2KeyWeb()) {
        // Generate new random master key
        const masterKeyBuffer = new Uint8Array(32);
        crypto.getRandomValues(masterKeyBuffer);
        
        const kek = await deriveLocalKEK(pin);
        const encrypted = await encryptWithKEK(masterKeyBuffer.buffer, kek);
        localStorage.setItem(ENCRYPTED_MASTER_KEY_V2, encrypted);
        await storeSessionMasterKey(masterKeyBuffer.buffer);
    } else {
        const masterKeyBuffer = await getMasterKeyForPinWeb(pin);
        await storeSessionMasterKey(masterKeyBuffer);
    }
};

export const exportCloudMasterKeyWeb = async (pin: string): Promise<string> => {
    const masterKeyBuffer = await getMasterKeyForPinWeb(pin);
    const exportKEK = await deriveExportKEK(pin);
    return await encryptWithKEK(masterKeyBuffer, exportKEK);
};

export const importCloudMasterKeyWeb = async (payload: string, pin: string): Promise<void> => {
    const exportKEK = await deriveExportKEK(pin);
    const masterKeyBuffer = await decryptWithKEK(payload, exportKEK);

    const localKEK = await deriveLocalKEK(pin);
    const encryptedLocal = await encryptWithKEK(masterKeyBuffer, localKEK);
    localStorage.setItem(ENCRYPTED_MASTER_KEY_V2, encryptedLocal);

    await storeSessionMasterKey(masterKeyBuffer);
};

export const canDecryptCloudMasterKeyWeb = async (payload: string, pin: string): Promise<boolean> => {
    try {
        const exportKEK = await deriveExportKEK(pin);
        await decryptWithKEK(payload, exportKEK);
        return true;
    } catch {
        return false;
    }
};

export const verifyCloudMasterKeyMatchWeb = async (payload: string, pin: string): Promise<boolean> => {
    try {
        const exportKEK = await deriveExportKEK(pin);
        const cloudMasterKey = await decryptWithKEK(payload, exportKEK);
        const currentMasterKey = await getMasterKeyForPinWeb(pin);
        
        // Compare byte arrays
        const a = new Uint8Array(cloudMasterKey);
        const b = new Uint8Array(currentMasterKey);
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) {
            if (a[i] !== b[i]) return false;
        }
        return true;
    } catch (e) {
        return false;
    }
};

export const changeEncryptionKeyWeb = async (oldPin: string, newPin: string): Promise<void> => {
    const masterKeyBuffer = await getMasterKeyForPinWeb(oldPin);
    const newLocalKEK = await deriveLocalKEK(newPin);
    const encryptedLocal = await encryptWithKEK(masterKeyBuffer, newLocalKEK);
    localStorage.setItem(ENCRYPTED_MASTER_KEY_V2, encryptedLocal);
};

export const encryptDataWeb = async (data: string): Promise<string> => {
    if (!sessionMasterKey) throw new Error("No master key available");
    
    const enc = new TextEncoder();
    const payload = enc.encode(data);
    
    const iv = new Uint8Array(12);
    crypto.getRandomValues(iv);

    const ciphertext = await crypto.subtle.encrypt(
        {
            name: "AES-GCM",
            iv: iv,
            tagLength: 128
        },
        sessionMasterKey,
        payload
    );

    const combined = new Uint8Array(iv.length + ciphertext.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(ciphertext), iv.length);

    return encodeBase64(combined.buffer);
};

export const decryptDataWeb = async (encryptedBase64: string): Promise<string> => {
    if (!sessionMasterKey) throw new Error("No master key available");

    const combined = new Uint8Array(decodeBase64(encryptedBase64));
    if (combined.length < 12) throw new Error("Invalid encrypted data");

    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);

    const plaintextBytes = await crypto.subtle.decrypt(
        {
            name: "AES-GCM",
            iv: iv,
            tagLength: 128
        },
        sessionMasterKey,
        ciphertext
    );

    const dec = new TextDecoder();
    return dec.decode(plaintextBytes);
};

export const lockDatabaseWeb = async (): Promise<void> => {
    sessionMasterKey = null;
};

export const clearWebCryptoKeys = (): void => {
    localStorage.removeItem(ENCRYPTED_MASTER_KEY_V2);
    localStorage.removeItem(SALT_KEY);
    sessionMasterKey = null;
};
