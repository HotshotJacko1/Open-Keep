// Copyright (c) 2026. Licensed under AGPLv3.
//
// Failed-PIN throttling, shared by LockScreen, AppLockDialog and ChangePinDialog.
//
// Scope, deliberately: this defends against someone thumbing PINs into a device
// they picked up. It does NOT defend against an offline attack on the vault --
// `encrypted_master_key_v2` and `kdf_salt` are readable in localStorage, so an
// attacker with that blob brute-forces outside the UI entirely. Raising the KDF
// iteration count is the fix for that, not this file. On web, unlock is still a
// plaintext string comparison, so this is worth little until that changes.
//
// Policy: MAX_ATTEMPTS failures => LOCKOUT_MS wait, then the counter resets and
// the cycle repeats. It never escalates to a permanent lock, and it never gates
// the destructive "Forgot PIN" reset -- being locked out of your own notes with
// no way back is a worse outcome than a slow guesser.

const ATTEMPTS_KEY = "pin-failed-attempts";
const LOCKED_UNTIL_KEY = "pin-locked-until";

export const MAX_ATTEMPTS = 5;
export const LOCKOUT_MS = 5 * 60 * 1000;

const readInt = (key: string): number => {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return 0;
        const n = parseInt(raw, 10);
        return Number.isFinite(n) && n > 0 ? n : 0;
    } catch {
        return 0; // private mode / storage disabled: fail open, don't brick the app
    }
};

const write = (key: string, value: number) => {
    try {
        localStorage.setItem(key, String(value));
    } catch {
        // Storage unavailable. Throttling degrades to nothing rather than
        // breaking unlock -- see fail-open note above.
    }
};

const clear = (key: string) => {
    try {
        localStorage.removeItem(key);
    } catch {
        /* no-op */
    }
};

/**
 * Milliseconds remaining on the current lockout, or 0 if not locked.
 *
 * Winding the device clock forward escapes the wait; that is accepted (anyone
 * who can set the clock can also read the vault blob). Winding it *backwards*
 * is clamped, so the wait can never exceed LOCKOUT_MS.
 */
export const getLockRemainingMs = (): number => {
    const lockedUntil = readInt(LOCKED_UNTIL_KEY);
    if (!lockedUntil) return 0;

    const remaining = lockedUntil - Date.now();
    if (remaining <= 0) {
        clear(LOCKED_UNTIL_KEY);
        return 0;
    }
    if (remaining > LOCKOUT_MS) {
        const clamped = Date.now() + LOCKOUT_MS;
        write(LOCKED_UNTIL_KEY, clamped);
        return LOCKOUT_MS;
    }
    return remaining;
};

export const isLocked = (): boolean => getLockRemainingMs() > 0;

/** Attempts left before the next lockout. */
export const getAttemptsRemaining = (): number =>
    Math.max(0, MAX_ATTEMPTS - readInt(ATTEMPTS_KEY));

/**
 * Record one wrong PIN. Returns the resulting state so the caller can decide
 * what to show without re-reading storage.
 */
export const recordFailedAttempt = (): { locked: boolean; remainingMs: number; attemptsRemaining: number } => {
    const attempts = readInt(ATTEMPTS_KEY) + 1;

    if (attempts >= MAX_ATTEMPTS) {
        clear(ATTEMPTS_KEY);
        write(LOCKED_UNTIL_KEY, Date.now() + LOCKOUT_MS);
        return { locked: true, remainingMs: LOCKOUT_MS, attemptsRemaining: 0 };
    }

    write(ATTEMPTS_KEY, attempts);
    return { locked: false, remainingMs: 0, attemptsRemaining: MAX_ATTEMPTS - attempts };
};

/** Clear all throttle state. Call on every successful unlock or PIN change. */
export const clearFailedAttempts = (): void => {
    clear(ATTEMPTS_KEY);
    clear(LOCKED_UNTIL_KEY);
};

/** "4:31" / "0:09" */
export const formatLockRemaining = (ms: number): string => {
    const total = Math.max(0, Math.ceil(ms / 1000));
    const mins = Math.floor(total / 60);
    const secs = total % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
};
