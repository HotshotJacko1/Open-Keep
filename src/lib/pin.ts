// Copyright (c) 2026. Licensed under AGPLv3.
//
// PIN state. The PIN itself is never persisted.
//
// - Encryption PIN: whether one is set is a flag. Whether a given PIN is right is
//   decided by unwrapping the master key with it (verifyEncryptionPin in
//   note-storage.ts), never by comparing against a stored copy.
// - App Lock PIN (encryption off): only a salted PBKDF2 verifier is kept. It gates
//   the UI and nothing else. The notes aren't protected by it, so a verifier that
//   is brute-forceable offline gives away nothing that isn't already readable.
// - Session PIN: kept in memory after the user types it (unlock, enable, change),
//   so cloud sync can wrap and check the cloud key without asking again.
//
// Up to 5.0.5 the raw PIN sat in localStorage under "app-passcode" and
// "app-lock-passcode". migrateLegacyPins() converts and removes those.

export const ENCRYPTION_ENABLED_KEY = "app-encryption-enabled";
export const APP_LOCK_ENABLED_KEY = "app-lock-enabled";
export const BIOMETRICS_ENABLED_KEY = "app-biometrics-enabled";
const APP_LOCK_VERIFIER_KEY = "app-lock-verifier";
const LEGACY_ENCRYPTION_PIN_KEY = "app-passcode";
const LEGACY_APP_LOCK_PIN_KEY = "app-lock-passcode";

// ── Encryption flag ────────────────────────────────────────────────

export const isEncryptionEnabled = (): boolean =>
    localStorage.getItem(ENCRYPTION_ENABLED_KEY) === "true";

/** Fired on window whenever the flag changes, e.g. from a sync conflict choice. */
export const ENCRYPTION_CHANGED_EVENT = "open-keep-encryption-changed";

export const setEncryptionEnabled = (enabled: boolean): void => {
    if (enabled) localStorage.setItem(ENCRYPTION_ENABLED_KEY, "true");
    else localStorage.removeItem(ENCRYPTION_ENABLED_KEY);
    window.dispatchEvent(new Event(ENCRYPTION_CHANGED_EVENT));
};

export const isAppLockEnabled = (): boolean =>
    localStorage.getItem(APP_LOCK_ENABLED_KEY) === "true";

// ── Session PIN (memory only) ──────────────────────────────────────

let sessionPin: string | null = null;

/** The encryption PIN typed this session, or null if it hasn't been entered yet. */
export const getSessionPin = (): string | null => sessionPin;
export const setSessionPin = (pin: string | null): void => {
    sessionPin = pin;
};

// ── PIN rules (shared by every dialog that sets a PIN) ────────────

/** Returns an error message, or null if the new PIN is acceptable. */
export const validateNewPin = (
    newPin: string,
    confirmPin: string,
    options: { currentPin?: string; label?: string } = {}
): string | null => {
    const label = options.label ?? "PIN";
    if (newPin.length < 4 || newPin.length > 6) return `${label} must be 4-6 digits long`;
    if (!/^\d+$/.test(newPin)) return `${label} must contain only numbers`;
    if (newPin !== confirmPin) return `${label}s do not match`;
    if (options.currentPin !== undefined && newPin === options.currentPin) {
        return "New PIN must be different from current PIN";
    }
    return null;
};

// ── App Lock verifier (encryption off) ────────────────────────────

const VERIFIER_ITERATIONS = 150_000;

type AppLockVerifier = { v: 1; salt: string; hash: string; iterations: number };

const toBase64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes));
const fromBase64 = (b64: string): Uint8Array => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

const derive = async (pin: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> => {
    const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, material, 256);
    return new Uint8Array(bits);
};

const readVerifier = (): AppLockVerifier | null => {
    try {
        const parsed = JSON.parse(localStorage.getItem(APP_LOCK_VERIFIER_KEY) ?? "null");
        return parsed && parsed.v === 1 ? parsed : null;
    } catch {
        return null;
    }
};

export const hasAppLockPin = (): boolean => readVerifier() !== null;

export const setAppLockPin = async (pin: string): Promise<void> => {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const hash = await derive(pin, salt, VERIFIER_ITERATIONS);
    const verifier: AppLockVerifier = { v: 1, salt: toBase64(salt), hash: toBase64(hash), iterations: VERIFIER_ITERATIONS };
    localStorage.setItem(APP_LOCK_VERIFIER_KEY, JSON.stringify(verifier));
};

export const verifyAppLockPin = async (pin: string): Promise<boolean> => {
    const verifier = readVerifier();
    if (!verifier) return false;
    const actual = await derive(pin, fromBase64(verifier.salt), verifier.iterations);
    const expected = fromBase64(verifier.hash);
    if (actual.length !== expected.length) return false;
    let diff = 0;
    for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
    return diff === 0;
};

export const clearAppLockPin = (): void => {
    localStorage.removeItem(APP_LOCK_VERIFIER_KEY);
};

// ── Cloud key cache ────────────────────────────────────────────────
//
// The cloud key payload last proven to wrap this device's master key under its
// current PIN (either uploaded from here, or verified with the PIN). It is the
// same public blob that sits in the cloud, so caching it adds no exposure. Sync
// uses it to recognise an unchanged cloud key without needing the PIN, which
// matters on native, where an encrypted DB can auto-unlock with no PIN typed.
//
// "Push pending" means this device changed how the key is wrapped (enable,
// disable, change PIN) and the cloud copy still needs re-uploading. It is only
// honoured while the cloud copy equals the cache, i.e. nobody else changed it.

const CLOUD_KEY_CACHE_KEY = "cloud-key-verified-payload";
const CLOUD_KEY_PUSH_PENDING_KEY = "cloud-key-push-pending";

export const getCloudKeyCache = (): string | null => localStorage.getItem(CLOUD_KEY_CACHE_KEY);
export const setCloudKeyCache = (payload: string | null): void => {
    if (payload) localStorage.setItem(CLOUD_KEY_CACHE_KEY, payload);
    else localStorage.removeItem(CLOUD_KEY_CACHE_KEY);
};

// The PIN the cloud copy was wrapped under before the local change, for when
// there is no cache to compare against yet (e.g. PIN changed before the first
// sync since updating). An empty PIN is public, so that case is persisted; a
// real PIN is kept in memory only, and is simply unknown after a restart.
let pushFromPin: string | null = null;

export const isCloudKeyPushPending = (): boolean => localStorage.getItem(CLOUD_KEY_PUSH_PENDING_KEY) !== null;
export const getCloudKeyPushFromPin = (): string | null =>
    localStorage.getItem(CLOUD_KEY_PUSH_PENDING_KEY) === "from-empty" ? "" : pushFromPin;

/** `fromPin`: the PIN the key was wrapped under before this change. */
export const setCloudKeyPushPending = (pending: boolean, fromPin?: string): void => {
    // Two changes before a sync: the cloud copy still has the wrap from before the first.
    if (pending && isCloudKeyPushPending()) return;
    pushFromPin = pending ? (fromPin ?? null) : null;
    if (!pending) localStorage.removeItem(CLOUD_KEY_PUSH_PENDING_KEY);
    else localStorage.setItem(CLOUD_KEY_PUSH_PENDING_KEY, fromPin === "" ? "from-empty" : "true");
};

// ── Reset & migration ─────────────────────────────────────────────

/** Forget every PIN-related setting on this device (for "Reset & Delete All"). */
export const clearAllPinState = (): void => {
    [
        ENCRYPTION_ENABLED_KEY,
        APP_LOCK_ENABLED_KEY,
        BIOMETRICS_ENABLED_KEY,
        APP_LOCK_VERIFIER_KEY,
        CLOUD_KEY_CACHE_KEY,
        CLOUD_KEY_PUSH_PENDING_KEY,
        LEGACY_ENCRYPTION_PIN_KEY,
        LEGACY_APP_LOCK_PIN_KEY,
    ].forEach((key) => localStorage.removeItem(key));
    sessionPin = null;
};

/**
 * One-time conversion from the cleartext PIN keys. Runs before anything reads PIN
 * state. Returns the legacy encryption PIN, if there was one, so the caller can
 * finish the native half (see upgradeLegacyNativeKey), and seeds the session
 * PIN with it so this launch keeps syncing without a prompt.
 */
export const migrateLegacyPins = async (): Promise<{ legacyEncryptionPin: string | null }> => {
    const encryptionPin = localStorage.getItem(LEGACY_ENCRYPTION_PIN_KEY);
    const appLockPin = localStorage.getItem(LEGACY_APP_LOCK_PIN_KEY);

    if (encryptionPin) {
        setEncryptionEnabled(true);
        setSessionPin(encryptionPin);
    } else if (appLockPin && !hasAppLockPin()) {
        await setAppLockPin(appLockPin);
    }
    // Only once the replacement is in place.
    localStorage.removeItem(LEGACY_ENCRYPTION_PIN_KEY);
    localStorage.removeItem(LEGACY_APP_LOCK_PIN_KEY);

    // A launch lock with no PIN behind it can never be opened. That shouldn't
    // happen, but an interrupted flow could leave it, so repair rather than brick.
    if (isAppLockEnabled() && !isEncryptionEnabled() && !hasAppLockPin()) {
        localStorage.removeItem(APP_LOCK_ENABLED_KEY);
        localStorage.removeItem(BIOMETRICS_ENABLED_KEY);
    }

    return { legacyEncryptionPin: encryptionPin };
};
