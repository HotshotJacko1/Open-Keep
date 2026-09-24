// Copyright (c) 2026. Licensed under AGPLv3.

import { readCustomTags } from "@/lib/custom-tags";
import {
    loadNotes,
    saveNote,
    exportMasterKey,
    importMasterKey,
    verifyCloudMasterKeyMatch,
    canDecryptCloudMasterKey,
    wipeDatabaseButKeepKeys,
    SyncResult,
} from "@/lib/note-storage";
import { resolveCloudKeyImport, getCloudKeyConflictIfNeeded } from "@/lib/cloud-sync-resolver";
import { setCloudSyncState, CloudSyncProvider } from "@/lib/cloud-sync-state";
import { showSuccess, showError } from "@/utils/toast";
import type { Note } from "@/types/note";

export type ForceResolution = "local" | "cloud" | "merge";

export interface CloudSyncRequest {
    forceResolution?: ForceResolution;
    cloudPayload?: string;
    providedPin?: string;
    silent?: boolean;
}

/**
 * What a cloud provider plugs into the shared sync pipeline. Everything
 * provider-specific — auth, transport, error classification and recovery —
 * lives here; the key-conflict and write-back logic is shared.
 */
export interface CloudSyncAdapter {
    provider: CloudSyncProvider;
    /** Human-readable name, used in logs and toasts ("Dropbox", "Google Drive"). */
    label: string;
    /** localStorage key holding the last successful sync time. */
    lastSyncedKey: string;
    successMessage: string;
    failureMessage: string;
    /** Shown when the provider denies access to the files the app needs (missing scope/consent). */
    permissionMessage: string;

    /** Runs before anything else (init, token acquisition). Throw an auth error to abort. */
    prepare?: (silent: boolean) => Promise<void>;
    checkMasterKey: () => Promise<{ exists: boolean; payload: string | null }>;
    syncNotes: (
        localNotes: Note[],
        localCustomTags: string[],
        options: { masterKeyPayload?: string; forceResolution?: "local" | "cloud" }
    ) => Promise<{ notes: Note[]; customTags: string[] }>;

    /**
     * Sorts a thrown error into the failure kinds every provider must handle:
     * "auth" (token expired/revoked, sign-in needed) or "permission" (the
     * account is signed in but hasn't granted the access the app needs).
     */
    classifyError: (error: unknown) => "auth" | "permission" | null;
    /** Recovery for an auth failure; the default just asks the user to reconnect. */
    onAuthError?: (silent: boolean) => SyncResult;
    /** Called after a successful sync with the timestamp stored under lastSyncedKey. */
    onSynced: (syncedAt: string) => void;
}

const isLocalDatabaseError = (message: string): boolean =>
    message.includes("database") ||
    message.includes("Database not initialized") ||
    message.includes("INSTANCE") ||
    message.includes("sqlcipher");

const isDecryptError = (message: string): boolean =>
    message.includes("BAD_DECRYPT") ||
    message.includes("Decryption failed") ||
    message.includes("Cannot parse synced data");

export const runCloudSync = async (
    adapter: CloudSyncAdapter,
    { forceResolution, cloudPayload, providedPin, silent = false }: CloudSyncRequest = {}
): Promise<SyncResult> => {
    const logTag = `[${adapter.label} Sync]`;
    setCloudSyncState(adapter.provider, true);
    try {
        await adapter.prepare?.(silent);

        const pin = localStorage.getItem("app-passcode");
        if (!pin && localStorage.getItem("app-lock-enabled") === "true") {
            throw new Error("No PIN found. Please set up a PIN in App Lock settings first.");
        }

        // Read local notes and custom tags BEFORE any database wipe or key import
        const localNotes = await loadNotes();
        const localCustomTags = readCustomTags();

        const cloudKeyConflict = await getCloudKeyConflictIfNeeded(pin, forceResolution, adapter.checkMasterKey);
        if (cloudKeyConflict) return cloudKeyConflict;

        const keyImport = await resolveCloudKeyImport(forceResolution, cloudPayload, pin, providedPin);
        if (keyImport.ok === false) {
            if (cloudPayload) {
                return { status: "conflict", cloudPayload, reason: "key_mismatch" };
            }
            return { status: "error", message: keyImport.reason };
        }
        const effectivePin = keyImport.effectivePin ?? pin ?? "";

        let masterKeyPayload: string | undefined;

        if (forceResolution === "local" || !forceResolution) {
            masterKeyPayload = await exportMasterKey(effectivePin);
        }

        if (!forceResolution) {
            const cloudKey = await adapter.checkMasterKey();
            if (cloudKey.exists && cloudKey.payload) {
                const isFirstConnect = !localStorage.getItem(adapter.lastSyncedKey);
                const canDecrypt = await canDecryptCloudMasterKey(cloudKey.payload, effectivePin);
                const isMatch = await verifyCloudMasterKeyMatch(cloudKey.payload, effectivePin);

                if (localNotes.length === 0) {
                    if (canDecrypt) {
                        // Local is empty and we can decrypt the cloud key — auto-restore from cloud
                        await wipeDatabaseButKeepKeys();
                        await importMasterKey(cloudKey.payload, effectivePin);
                        masterKeyPayload = undefined;
                    } else {
                        // We cannot decrypt the cloud key. Need the correct PIN.
                        return { status: "conflict", cloudPayload: cloudKey.payload, reason: "key_mismatch" };
                    }
                } else if (!isMatch) {
                    // Keys differ and we have local notes — conflict resolution required
                    return { status: "conflict", cloudPayload: cloudKey.payload, reason: canDecrypt ? "first_connect" : "key_mismatch" };
                } else if (isFirstConnect) {
                    // Keys match but this is first connect — ask user which data to keep
                    return { status: "conflict", cloudPayload: cloudKey.payload, reason: "first_connect" };
                }
            }
        }

        console.log(`${logTag} Loaded ${localNotes.length} local notes for sync`);
        const providerForceResolution = forceResolution === "merge" ? undefined : forceResolution;
        const { notes: mergedNotes, customTags: mergedTags } = await adapter.syncNotes(localNotes, localCustomTags, {
            masterKeyPayload,
            forceResolution: providerForceResolution,
        });

        // Re-read local DB state now that sync is complete. Local notes may have changed
        // while the sync was in-flight (e.g. user deleted a note during a long sync).
        // Only write back a merged note if it is still newer than (or equal to) the
        // current local copy — this prevents a stale sync from resurrecting deleted notes.
        const currentLocalNotes = await loadNotes();
        const currentLocalMap = new Map(currentLocalNotes.map((n) => [n.id, n]));
        let savedCount = 0;
        let skippedCount = 0;
        await Promise.all(
            mergedNotes.map(async (note) => {
                const current = currentLocalMap.get(note.id);
                if (current && current.updatedAt > note.updatedAt) {
                    console.log(`${logTag} Write-back skipped for note ${note.id}: local is newer (${new Date(current.updatedAt).toISOString()} > ${new Date(note.updatedAt).toISOString()})`);
                    skippedCount++;
                    return;
                }
                await saveNote(note, { skipLimits: true });
                savedCount++;
            })
        );
        console.log(`${logTag} Write-back complete: ${savedCount} saved, ${skippedCount} skipped (local was newer)`);
        localStorage.setItem("custom-tags", JSON.stringify(mergedTags));

        const now = new Date().toLocaleString();
        localStorage.setItem(adapter.lastSyncedKey, now);
        adapter.onSynced(now);
        window.dispatchEvent(new Event("notes-updated"));
        if (!silent) {
            showSuccess(adapter.successMessage);
        }
        return { status: "success" };
    } catch (error) {
        const message = (error as Error)?.message || "";
        const kind = adapter.classifyError(error);

        if (!isDecryptError(message) && kind !== "auth") {
            console.error(`${adapter.label} sync failed:`, error);
        }
        // Check for local DB errors first — don't confuse them with cloud issues
        if (isLocalDatabaseError(message)) {
            if (!silent) showError("Local database access failed. Notes are safe — please restart the app.");
            return { status: "error", message: "Local database access failed" };
        }
        if (kind === "permission") {
            // Not transient — retrying won't help until the user re-consents, so say so even on silent syncs.
            showError(adapter.permissionMessage);
            return { status: "error", message: adapter.permissionMessage };
        }
        if (kind === "auth") {
            console.warn(`${adapter.label} sync needs re-authentication:`, error);
            if (adapter.onAuthError) return adapter.onAuthError(silent);
            if (!silent) showError(`${adapter.label} session expired. Please reconnect.`);
            return { status: "error", message: "Auth required" };
        }
        if (isDecryptError(message)) {
            if (!silent) showError("Cloud notes could not be decrypted. They may be locked with an old, unknown key.");
            try {
                const cloudKey = await adapter.checkMasterKey();
                if (cloudKey.payload) {
                    return { status: "conflict", cloudPayload: cloudKey.payload, reason: "key_mismatch" };
                }
            } catch (keyError) {
                console.error(`${logTag} Could not re-read cloud master key after decrypt failure`, keyError);
            }
            return { status: "error", message };
        }
        if (!silent) showError(adapter.failureMessage);
        return { status: "error", message };
    } finally {
        setCloudSyncState(adapter.provider, false);
    }
};
