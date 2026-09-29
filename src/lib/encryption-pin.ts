// Copyright (c) 2026. Licensed under AGPLv3.
//
// Enable / change / disable the encryption PIN.
//
// Ordering is what makes these safe to interrupt (C2-02). There is no stored PIN
// to fall out of step with the key any more, only the "encryption enabled" flag,
// and each flow orders its writes so that a crash can only ever leave
// "flag on, key wrapped under the empty PIN". The unlock path in App.tsx recovers
// from that state (it retries with the empty PIN and clears the flag). The
// reverse, "flag off, key under a real PIN", would lock a web user out for good,
// so it is never allowed to arise.

import { NativeBiometric } from "@capgo/capacitor-native-biometric";
import { changeEncryptionKey, verifyEncryptionPin } from "@/lib/note-storage";
import { syncImageEncryption } from "@/lib/image-storage";
import {
    APP_LOCK_ENABLED_KEY,
    BIOMETRICS_ENABLED_KEY,
    clearAppLockPin,
    isAppLockEnabled,
    setAppLockPin,
    setCloudKeyPushPending,
    setEncryptionEnabled,
    setSessionPin,
} from "@/lib/pin";

export { verifyEncryptionPin };

/** Keeps the PIN held for biometric unlock (Keystore/Keychain-backed) current. */
const updateBiometricPin = async (pin: string): Promise<void> => {
    if (localStorage.getItem(BIOMETRICS_ENABLED_KEY) !== "true") return;
    try {
        if (typeof NativeBiometric.setCredentials === "function") {
            await NativeBiometric.setCredentials({ username: "app-pin", password: pin, server: "open-keep" });
        }
    } catch (e) {
        // Not fatal: biometric unlock then reports a PIN mismatch and asks for it.
        console.error("Failed to update biometrics credentials", e);
    }
};

export const enableEncryption = async (newPin: string): Promise<void> => {
    // Flag first: if the re-key lands and we crash before the flag, a web user
    // would be left with a PIN-wrapped key the app thinks is unencrypted.
    setEncryptionEnabled(true);
    try {
        await changeEncryptionKey("", newPin);
    } catch (e) {
        setEncryptionEnabled(false);
        throw e;
    }
    setSessionPin(newPin);
    clearAppLockPin(); // the encryption PIN is the lock PIN from now on
    setCloudKeyPushPending(true, "");
    await updateBiometricPin(newPin);
    // Not awaited: images read correctly in either form meanwhile.
    syncImageEncryption().catch((e) => console.error("Could not encrypt stored images", e));
};

/** Caller has already verified `currentPin`. The re-key is one native write, so it is atomic. */
export const changeEncryptionPin = async (currentPin: string, newPin: string): Promise<void> => {
    await changeEncryptionKey(currentPin, newPin);
    setSessionPin(newPin);
    setCloudKeyPushPending(true, currentPin);
    await updateBiometricPin(newPin);
};

/** Caller has already verified `currentPin`. Keeps App Lock on (with the same PIN) if it was on. */
export const disableEncryption = async (currentPin: string): Promise<void> => {
    await changeEncryptionKey(currentPin, "");

    if (isAppLockEnabled()) {
        await setAppLockPin(currentPin);
    } else {
        localStorage.removeItem(APP_LOCK_ENABLED_KEY);
        localStorage.removeItem(BIOMETRICS_ENABLED_KEY);
        try {
            await NativeBiometric.deleteCredentials({ server: "open-keep" });
        } catch {
            // No credentials stored.
        }
    }

    // Flag last: see the ordering note at the top.
    setEncryptionEnabled(false);
    setSessionPin(null);
    setCloudKeyPushPending(true, currentPin);
    // Not awaited: images read correctly in either form meanwhile.
    syncImageEncryption().catch((e) => console.error("Could not decrypt stored images", e));
};

/**
 * Pre-V2 native installs derive the DB key from the PIN directly, and the
 * native exportMasterKey then accepts any PIN, which would defeat
 * verifyEncryptionPin. Re-keying to the same PIN upgrades them to a wrapped key.
 * Detected by probing with a PIN nobody can type: only a pre-V2 install accepts it.
 */
export const upgradeLegacyNativeKey = async (pin: string): Promise<void> => {
    const acceptsAnyPin = await verifyEncryptionPin("\u0000probe");
    if (!acceptsAnyPin) return;
    await changeEncryptionKey(pin, pin);
};
