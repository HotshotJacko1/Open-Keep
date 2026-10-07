// Copyright (c) 2026. Licensed under AGPLv3.
import {
  canDecryptCloudMasterKey,
  importMasterKey,
  wipeDatabaseButKeepKeys,
  verifyCloudMasterKeyMatch,
} from "@/lib/note-storage";
import { clearAppLockPin, setAppLockEnabled, setEncryptionEnabled, setSessionPin } from "@/lib/pin";
import { showError } from "@/utils/toast";
import { withImagesInPlaintext } from "@/lib/image-storage";

export type CloudKeyImportResult =
  /** `wiped`: the local database was emptied and re-keyed to the cloud key. */
  | { ok: true; effectivePin: string; wiped: boolean }
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
  setAppLockEnabled(true);
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
    return { ok: true, effectivePin: localPin, wiped: false };
  }

  const importPin = (providedPin || localPin).trim();

  // When using the local PIN, verifyCloudMasterKeyMatch is sufficient and works on all native builds.
  let keysAlreadyMatch = false;
  if (importPin === localPin) {
    try {
      keysAlreadyMatch = await verifyCloudMasterKeyMatch(cloudPayload, importPin);
    } catch (error) {
      console.warn("Cloud master key match check failed; falling back to decrypt check", error);
    }
  }
  let canDecrypt = keysAlreadyMatch;
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

  // Same master key on both sides: a merge needs no re-key, so don't wipe (C1-20).
  // The normal union merge and write-back do the job, and local notes never leave
  // the database. "cloud" still wipes: write-back never deletes local-only notes,
  // so the wipe is what makes "replace local with cloud" replace.
  if (forceResolution === "merge" && keysAlreadyMatch) {
    return { ok: true, effectivePin: importPin, wiped: false };
  }

  // cloud: replace local with cloud. merge: existing local notes are captured
  // in memory before this call and are merged and saved during sync write-back
  // (or put back by runCloudSync if the sync fails after this wipe).
  // Either way, the local DB is wiped and the cloud master key imported.
  // Images stay on disk through the wipe, so they must move to the new key too.
  await withImagesInPlaintext(async () => {
    await wipeDatabaseButKeepKeys();
    await importMasterKey(cloudPayload, importPin);
  });
  if (forceResolution === "merge" || importPin !== localPin) {
    adoptImportedPin(importPin);
  }
  return { ok: true, effectivePin: importPin, wiped: true };
};
