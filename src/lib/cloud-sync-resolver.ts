// Copyright (c) 2026. Licensed under AGPLv3.
import {
  canDecryptCloudMasterKey,
  importMasterKey,
  wipeDatabaseButKeepKeys,
  changeEncryptionKey,
  exportMasterKey,
  verifyCloudMasterKeyMatch,
} from "@/lib/note-storage";
import { showError } from "@/utils/toast";

export type CloudKeyImportResult =
  | { ok: true; effectivePin: string }
  | { ok: false; reason: "missing_pin" | "invalid_pin" };

/** Validate and apply cloud master key import for conflict resolution flows. */
export const resolveCloudKeyImport = async (
  forceResolution: "local" | "cloud" | "merge" | undefined,
  cloudPayload: string | undefined,
  localPin: string | null,
  providedPin?: string
): Promise<CloudKeyImportResult> => {
  if (!forceResolution || !cloudPayload || forceResolution === "local") {
    return { ok: true, effectivePin: localPin || providedPin || "" };
  }

  const importPin = (providedPin || localPin)?.trim();
  if (!importPin) {
    showError("Please enter your App Lock PIN to restore cloud data.");
    return { ok: false, reason: "missing_pin" };
  }

  // When using the local PIN, verifyCloudMasterKeyMatch is sufficient and works on all native builds.
  let canDecrypt = false;
  if (localPin && importPin === localPin) {
    canDecrypt = await verifyCloudMasterKeyMatch(cloudPayload, importPin);
  }
  if (!canDecrypt) {
    canDecrypt = await canDecryptCloudMasterKey(cloudPayload, importPin);
  }
  if (!canDecrypt) {
    showError("Incorrect PIN. Enter the App Lock PIN from your other device.");
    return { ok: false, reason: "invalid_pin" };
  }

  if (forceResolution === "cloud") {
    await wipeDatabaseButKeepKeys();
    await importMasterKey(cloudPayload, importPin);
    if (importPin !== localPin) {
      localStorage.setItem("app-passcode", importPin);
      localStorage.setItem("app-lock-enabled", "true");
    }
    return { ok: true, effectivePin: importPin };
  }

  // merge
  if (localPin && importPin !== localPin) {
    try {
      await exportMasterKey(localPin);
      await changeEncryptionKey(localPin, importPin);
    } catch {
      // Local PIN cannot decrypt existing keys — wipe notes and import cloud key only.
      await wipeDatabaseButKeepKeys();
    }
  } else if (!localPin) {
    await wipeDatabaseButKeepKeys();
  }

  await importMasterKey(cloudPayload, importPin);
  localStorage.setItem("app-passcode", importPin);
  localStorage.setItem("app-lock-enabled", "true");
  return { ok: true, effectivePin: importPin };
};

/** Prompt for PIN when cloud data exists but no local PIN is configured. */
export const getCloudKeyConflictIfNeeded = async (
  localPin: string | null,
  forceResolution: "local" | "cloud" | "merge" | undefined,
  checkCloudKey: () => Promise<{ exists: boolean; payload: string | null }>
): Promise<{ status: "conflict"; cloudPayload: string; reason: "key_mismatch" } | null> => {
  if (localPin || forceResolution) return null;

  const cloudKey = await checkCloudKey();
  if (cloudKey.exists && cloudKey.payload) {
    return { status: "conflict", cloudPayload: cloudKey.payload, reason: "key_mismatch" };
  }

  return null;
};
