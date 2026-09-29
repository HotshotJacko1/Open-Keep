// Copyright (c) 2026. Licensed under AGPLv3.
import {
  canDecryptCloudMasterKey,
  importMasterKey,
  wipeDatabaseButKeepKeys,
  verifyCloudMasterKeyMatch,
} from "@/lib/note-storage";
import { APP_LOCK_ENABLED_KEY, clearAppLockPin, setEncryptionEnabled, setSessionPin } from "@/lib/pin";
import { showError } from "@/utils/toast";
import { withImagesInPlaintext } from "@/lib/image-storage";

export type CloudKeyImportResult =
  | { ok: true; effectivePin: string }
  | { ok: false; reason: "missing_pin" | "invalid_pin" };

/**
 * After importing the cloud key under `importPin`, this device's PIN *is*
 * `importPin`. Callers only get here from an explicit conflict choice, where the
 * dialog has said so (e.g. "this turns encryption on here too").
 */
const adoptImportedPin = (importPin: string) => {
  if (!importPin) {
    setEncryptionEnabled(false);
    setSessionPin(null);
    return;
  }
  setEncryptionEnabled(true);
  setSessionPin(importPin);
  localStorage.setItem(APP_LOCK_ENABLED_KEY, "true");
  clearAppLockPin();
};

/**
 * Validate and apply cloud master key import for conflict resolution flows.
 * `localPin` is this device's PIN: "" when encryption is off.
 */
export const resolveCloudKeyImport = async (
  forceResolution: "local" | "cloud" | "merge" | undefined,
  cloudPayload: string | undefined,
  localPin: string,
  providedPin?: string
): Promise<CloudKeyImportResult> => {
  if (!forceResolution || !cloudPayload || forceResolution === "local") {
    return { ok: true, effectivePin: localPin };
  }

  const importPin = (providedPin || localPin).trim();

  // When using the local PIN, verifyCloudMasterKeyMatch is sufficient and works on all native builds.
  let canDecrypt = false;
  if (localPin && importPin === localPin) {
    canDecrypt = await verifyCloudMasterKeyMatch(cloudPayload, importPin);
  }
  if (!canDecrypt) {
    canDecrypt = await canDecryptCloudMasterKey(cloudPayload, importPin);
  }

  if (!canDecrypt) {
    // If we couldn't decrypt, check if we need to request a PIN
    if (!providedPin && !localPin) {
      showError("Please enter your App Lock PIN to restore cloud data.");
      return { ok: false, reason: "missing_pin" };
    }
    showError("Incorrect PIN. Enter the App Lock PIN from your other device.");
    return { ok: false, reason: "invalid_pin" };
  }

  // cloud: replace local with cloud. merge: existing local notes are captured
  // in memory before this call and are merged and saved during sync write-back.
  // Either way, the local DB is wiped and the cloud master key imported.
  // Images stay on disk through the wipe, so they must move to the new key too.
  await withImagesInPlaintext(async () => {
    await wipeDatabaseButKeepKeys();
    await importMasterKey(cloudPayload, importPin);
  });
  if (forceResolution === "merge" || importPin !== localPin) {
    adoptImportedPin(importPin);
  }
  return { ok: true, effectivePin: importPin };
};
