// Copyright (c) 2026. Licensed under AGPLv3.

import { readCustomTags } from "@/lib/custom-tags";
import {
    loadNotes,
    saveNote,
    deleteNote,
    exportMasterKey,
    importMasterKey,
    verifyCloudMasterKeyMatch,
    canDecryptCloudMasterKey,
    wipeDatabaseButKeepKeys,
    verifyEncryptionPin,
    SyncResult,
} from "@/lib/note-storage";
import { resolveCloudKeyImport } from "@/lib/cloud-sync-resolver";
import {
    getCloudKeyCache,
    getCloudKeyPushFromPin,
    getSessionPin,
    isCloudKeyPushPending,
    isEncryptionEnabled,
    setCloudKeyCache,
    setCloudKeyPushPending,
    setSessionPin,
} from "@/lib/pin";
import { setCloudSyncState, CloudSyncProvider } from "@/lib/cloud-sync-state";
import { showSuccess, showError } from "@/utils/toast";
import { deleteImage, withImagesInPlaintext } from "@/lib/image-storage";
import { mergeTagChanges, mergeTombstones, pruneTagChanges, pruneTombstones, readTagChanges, readTombstones, writeTagChanges, writeTombstones } from "@/lib/tombstones";
import { isSameNote, type SyncData, type SyncMergeResult, type SyncNotesOptions } from "@/lib/sync-merge";
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
    syncNotes: (local: SyncData, options: SyncNotesOptions) => Promise<SyncMergeResult>;

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

/**
 * When this device's last successful sync with a provider *started*, in ms (C3-01 §4.4).
 * The start, not the end: a note created while a sync is in flight must not look
 * "unchanged since the last sync" next time. Only trusted while the provider's
 * last-synced display key exists, so every reset/disconnect path that clears that
 * key (LockScreen, ChangePinDialog, each hook's disconnect) invalidates this too.
 */
const syncStartedKey = (provider: CloudSyncProvider): string => `${provider}-last-sync-started-ms`;

const readLastSyncStartedAt = (adapter: CloudSyncAdapter): number | null => {
    if (!localStorage.getItem(adapter.lastSyncedKey)) return null;
    const value = Number(localStorage.getItem(syncStartedKey(adapter.provider)));
    return Number.isFinite(value) && value > 0 ? value : null;
};

/**
 * The cloud key a "Keep local" choice uploaded, kept until its notes have landed
 * too (C1-28). The key and the notes are two uploads, so a failure between them
 * leaves this device's key in the cloud next to notes under the old one, and the
 * next sync would ask the same question again. Instead it finishes the upload, but
 * only while the cloud key is still exactly this payload: if another device or
 * account has written since, that stands and the normal checks run. It's the same
 * public blob as the cloud key cache (see pin.ts), so keeping it exposes nothing.
 */
const keepLocalPendingKey = (provider: CloudSyncProvider): string => `${provider}-keep-local-pending`;

/** Forget an unfinished "Keep local" (disconnect, reset). No `provider`: all of them. */
export const clearKeepLocalPending = (provider?: CloudSyncProvider): void => {
    const providers: CloudSyncProvider[] = provider ? [provider] : ["google-drive", "onedrive", "dropbox"];
    for (const p of providers) localStorage.removeItem(keepLocalPendingKey(p));
};

/**
 * Local notes a failed "merge" couldn't put back after its wipe (C1-20). Kept for
 * the rest of the session so the next sync attempt can save them before reading
 * local notes. An app kill still loses them; only a persisted snapshot would fix
 * that, and on web it would be plaintext (C1-21).
 */
let unrestoredNotes: Note[] | null = null;

/**
 * Puts `notes` back into the local database after a wipe, skipping any the user
 * has since saved a newer copy of. Returns false if the database won't take them.
 */
const restoreLocalNotes = async (notes: Note[], logTag: string): Promise<boolean> => {
    try {
        const current = new Map((await loadNotes()).map((n) => [n.id, n]));
        for (const note of notes) {
            const existing = current.get(note.id);
            if (existing && existing.updatedAt >= note.updatedAt) continue;
            await saveNote(note, { skipLimits: true });
        }
        console.log(`${logTag} Restored ${notes.length} local notes after a failed merge`);
        window.dispatchEvent(new Event("notes-updated"));
        return true;
    } catch (error) {
        console.error(`${logTag} Could not restore local notes after a failed merge`, error);
        return false;
    }
};

const pinRequired = (cloudPayload: string): SyncResult =>
    ({ status: "conflict", cloudPayload, reason: "pin_required" });

/**
 * Whether `cloudPayload` is the wrap this device had in the cloud before its
 * pending re-wrap: either the cached payload, or (no cache yet) one that opens
 * under the PIN it was wrapped with before the change.
 */
const isOurPreviousWrap = async (cloudPayload: string, cache: string | null): Promise<boolean> => {
    if (cache) return cloudPayload === cache;
    const fromPin = getCloudKeyPushFromPin();
    return fromPin !== null && await canDecryptCloudMasterKey(cloudPayload, fromPin);
};

export const runCloudSync = async (
    adapter: CloudSyncAdapter,
    { forceResolution, cloudPayload, providedPin, silent = false }: CloudSyncRequest = {}
): Promise<SyncResult> => {
    const logTag = `[${adapter.label} Sync]`;
    setCloudSyncState(adapter.provider, true);
    // Set while a "merge" may have wiped the local DB: the local notes to put back if the sync fails.
    let restoreOnFailure: Note[] | null = null;
    try {
        // Before prepare: putting notes back is purely local, so it mustn't wait on a
        // token refresh or the network, which may be what failed last time (C1-29).
        if (unrestoredNotes) {
            const pending = unrestoredNotes;
            if (await restoreLocalNotes(pending, logTag)) unrestoredNotes = null;
        }

        await adapter.prepare?.(silent);

        const encryptionOn = isEncryptionEnabled();
        // null: encryption is on but its PIN hasn't been entered this session.
        // The PIN isn't stored anywhere, so without it the cloud key can't be
        // wrapped or checked, only recognised via the cache (see pin.ts).
        let pin: string | null = encryptionOn ? getSessionPin() : "";

        // Answer to a pin_required prompt: this device's own PIN, not another's.
        if (pin === null && providedPin && !forceResolution) {
            if (!(await verifyEncryptionPin(providedPin))) {
                showError("Incorrect PIN");
                return pinRequired(cloudPayload ?? "");
            }
            pin = providedPin;
            setSessionPin(pin);
        }

        // Taken before reading local notes; see syncStartedKey.
        const syncStartedAt = Date.now();
        const lastSyncStartedAt = readLastSyncStartedAt(adapter);

        // Read local notes and custom tags BEFORE any database wipe or key import
        const localNotes = await loadNotes();
        const localCustomTags = readCustomTags();

        let masterKeyPayload: string | undefined;
        // The cloud key payload that will be known to match this device once the sync lands.
        let verifiedPayload: string | null = null;
        // What the provider does with the notes. "merge" only decides the key; the notes then merge as usual.
        let resolution: "local" | "cloud" | undefined = forceResolution === "merge" ? undefined : forceResolution;

        if (forceResolution) {
            if (pin === null) return pinRequired(cloudPayload ?? "");
            // Set before the import: importMasterKey can throw after the wipe has run.
            if (forceResolution === "merge") restoreOnFailure = localNotes;
            const keyImport = await resolveCloudKeyImport(forceResolution, cloudPayload, pin, providedPin);
            if (keyImport.ok === true && !keyImport.wiped) restoreOnFailure = null;
            if (keyImport.ok === false) {
                if (cloudPayload) {
                    return { status: "conflict", cloudPayload, reason: "key_mismatch" };
                }
                return { status: "error", message: keyImport.reason };
            }
            if (forceResolution === "local") {
                masterKeyPayload = await exportMasterKey(keyImport.effectivePin);
            } else {
                verifiedPayload = cloudPayload ?? null;
            }
        } else {
            const cloudKey = await adapter.checkMasterKey();
            const cache = getCloudKeyCache();
            const pushPending = isCloudKeyPushPending();

            let keepLocalPending = localStorage.getItem(keepLocalPendingKey(adapter.provider));
            if (keepLocalPending !== null && (cloudKey.payload !== keepLocalPending || localNotes.length === 0)) {
                // The cloud key has changed since (or the key upload never happened), or
                // there's nothing here to upload: drop it and let the checks below decide.
                clearKeepLocalPending(adapter.provider);
                keepLocalPending = null;
            }

            if (keepLocalPending !== null) {
                // A "Keep local" got its key into the cloud but not its notes (C1-28), and
                // nobody has written since: finish it rather than ask the question again.
                console.log(`${logTag} Finishing an interrupted "Keep local" upload`);
                resolution = "local";
                if (!pushPending) verifiedPayload = keepLocalPending;
                // The PIN changed since: the key it uploaded is wrapped under the old one.
                else if (pin !== null) masterKeyPayload = await exportMasterKey(pin);
                else return pinRequired(keepLocalPending);
            } else if (!cloudKey.exists || !cloudKey.payload) {
                // Nothing in the cloud yet: upload ours.
                if (pin !== null) masterKeyPayload = await exportMasterKey(pin);
                else if (cache && !pushPending) masterKeyPayload = cache;
                else return pinRequired("");
            } else if (cloudKey.payload === cache && !pushPending) {
                // Unchanged since it was last proven to match: nothing to check or upload.
                verifiedPayload = cache;
            } else if (pushPending && await isOurPreviousWrap(cloudKey.payload, cache)) {
                // This device re-wrapped its key (enable / disable / change PIN) and the
                // cloud copy is still the old wrap of it: replace it with the new one.
                if (pin === null) return pinRequired(cloudKey.payload);
                masterKeyPayload = await exportMasterKey(pin);
            } else {
                if (pin === null) return pinRequired(cloudKey.payload);

                const isFirstConnect = !localStorage.getItem(adapter.lastSyncedKey);
                const canDecrypt = await canDecryptCloudMasterKey(cloudKey.payload, pin);
                if (!canDecrypt) {
                    // A key this device's PIN can't open. If the empty PIN opens it,
                    // another device turned encryption off: that's a choice to offer
                    // (C2-22), not a PIN to ask for, since there is no PIN to enter.
                    if (encryptionOn && await canDecryptCloudMasterKey(cloudKey.payload, "")) {
                        return { status: "conflict", cloudPayload: cloudKey.payload, reason: "encryption_disabled_elsewhere" };
                    }
                    return { status: "conflict", cloudPayload: cloudKey.payload, reason: "key_mismatch" };
                }
                const isMatch = await verifyCloudMasterKeyMatch(cloudKey.payload, pin);

                if (localNotes.length === 0) {
                    // Local is empty and we can decrypt the cloud key — auto-restore from cloud
                    await withImagesInPlaintext(async () => {
                        await wipeDatabaseButKeepKeys();
                        await importMasterKey(cloudKey.payload, pin);
                    });
                    verifiedPayload = cloudKey.payload;
                } else if (!isMatch) {
                    // Keys differ and we have local notes — conflict resolution required
                    return { status: "conflict", cloudPayload: cloudKey.payload, reason: "first_connect" };
                } else if (isFirstConnect) {
                    // Keys match but this is first connect — ask user which data to keep
                    return { status: "conflict", cloudPayload: cloudKey.payload, reason: "first_connect" };
                } else {
                    // Same key under the same PIN: no need to re-upload it.
                    verifiedPayload = cloudKey.payload;
                }
            }
        }

        console.log(`${logTag} Loaded ${localNotes.length} local notes for sync`);
        if (resolution === "local") {
            // Recorded before the uploads start, and cleared only once both are done.
            const keyInCloud = masterKeyPayload ?? verifiedPayload;
            if (keyInCloud) localStorage.setItem(keepLocalPendingKey(adapter.provider), keyInCloud);
        }
        const localTombstones = pruneTombstones(readTombstones(), syncStartedAt);
        const {
            notes: mergedNotes,
            customTags: mergedTags,
            tombstones: mergedTombstones,
            tagChanges: mergedTagChanges,
            removeIds,
        } = await adapter.syncNotes(
            {
                notes: localNotes,
                customTags: localCustomTags,
                tombstones: localTombstones,
                tagChanges: pruneTagChanges(readTagChanges(), syncStartedAt),
            },
            { masterKeyPayload, forceResolution: resolution, lastSyncStartedAt }
        );
        // Both uploads have landed; nothing to finish next time.
        if (resolution === "local") clearKeepLocalPending(adapter.provider);

        // Re-read local DB state now that sync is complete. Local notes may have changed
        // while the sync was in-flight (e.g. user deleted a note during a long sync).
        // Only write back a merged note if it is still newer than (or equal to) the
        // current local copy — this prevents a stale sync from resurrecting deleted notes.
        const currentLocalNotes = await loadNotes();
        const currentLocalMap = new Map(currentLocalNotes.map((n) => [n.id, n]));

        // Deletes and label changes recorded on this device while the sync ran (C1-22).
        // They aren't in the merge result, which was built from the state at sync start,
        // so overwriting the local stores with it would drop them. Recorded with
        // Date.now(), so anything at or after syncStartedAt is new.
        const tombstonesDuringSync = readTombstones().filter((t) => t.deletedAt >= syncStartedAt);
        const tombstonedDuringSync = new Set(tombstonesDuringSync.map((t) => t.id));
        const tagChangesDuringSync = readTagChanges().filter((c) => c.at >= syncStartedAt);
        const currentCustomTags = readCustomTags();
        const tagsAddedDuringSync = currentCustomTags.filter((t) => !localCustomTags.includes(t));
        const tagsRemovedDuringSync = new Set(localCustomTags.filter((t) => !currentCustomTags.includes(t)));
        let savedCount = 0;
        let skippedCount = 0;
        let unchangedCount = 0;
        await Promise.all(
            mergedNotes.map(async (note) => {
                const current = currentLocalMap.get(note.id);
                // Permanently deleted here while this sync ran (C1-22): don't bring it back.
                // Its tombstone is kept below and removes it from the cloud next sync.
                if (!current && tombstonedDuringSync.has(note.id)) {
                    console.log(`${logTag} Write-back skipped for note ${note.id}: deleted during sync`);
                    skippedCount++;
                    return;
                }
                if (current && current.updatedAt > note.updatedAt) {
                    console.log(`${logTag} Write-back skipped for note ${note.id}: local is newer (${new Date(current.updatedAt).toISOString()} > ${new Date(note.updatedAt).toISOString()})`);
                    skippedCount++;
                    return;
                }
                // Most syncs change nothing; rewriting every note cost a DB write and a
                // native bridge call each.
                if (current && isSameNote(current, note)) {
                    unchangedCount++;
                    return;
                }
                await saveNote(note, { skipLimits: true });
                savedCount++;
            })
        );
        console.log(`${logTag} Write-back complete: ${savedCount} saved, ${unchangedCount} unchanged, ${skippedCount} skipped (local was newer)`);
        // Only now does the local DB hold the merged notes. Until the write-back
        // finished, a merge that wiped it had local-only notes in memory alone (C1-29).
        restoreOnFailure = null;

        // Notes another device permanently deleted (C3-01). Same guard as above: a note
        // edited here after the delete (including during this sync) is kept, and the next
        // sync keeps it everywhere, since a note edited after its tombstone wins.
        const deletedAtById = new Map(mergedTombstones.map((t) => [t.id, t.deletedAt]));
        let removedCount = 0;
        for (const id of removeIds) {
            const current = currentLocalMap.get(id);
            if (!current) continue;
            if (current.updatedAt > (deletedAtById.get(id) ?? Infinity)) {
                console.log(`${logTag} Removal skipped for note ${id}: edited after it was deleted`);
                continue;
            }
            if (current.images && current.images.length > 0) {
                await Promise.all(current.images.map(deleteImage));
            }
            await deleteNote(id);
            removedCount++;
        }
        if (removedCount > 0) console.log(`${logTag} Removed ${removedCount} notes deleted on another device`);
        writeTombstones(mergeTombstones(mergedTombstones, tombstonesDuringSync));
        const finalTagChanges = mergeTagChanges(mergedTagChanges, tagChangesDuringSync);
        writeTagChanges(finalTagChanges);
        const deletedDuringSync = new Set(tagChangesDuringSync.filter((c) => c.deleted).map((c) => c.name));
        const finalTags = Array.from(new Set([...mergedTags, ...tagsAddedDuringSync]))
            .filter((t) => !tagsRemovedDuringSync.has(t) && !deletedDuringSync.has(t))
            .sort();
        localStorage.setItem("custom-tags", JSON.stringify(finalTags));
        setCloudKeyCache(masterKeyPayload ?? verifiedPayload ?? getCloudKeyCache());
        setCloudKeyPushPending(false);

        const now = new Date().toLocaleString();
        localStorage.setItem(adapter.lastSyncedKey, now);
        localStorage.setItem(syncStartedKey(adapter.provider), String(syncStartedAt));
        adapter.onSynced(now);
        window.dispatchEvent(new Event("notes-updated"));
        if (!silent) {
            showSuccess(adapter.successMessage);
        }
        return { status: "success" };
    } catch (error) {
        if (restoreOnFailure && restoreOnFailure.length > 0) {
            // A "merge" wiped the local DB and the sync then failed: put the local
            // notes back, under whichever key the DB now has.
            if (!(await restoreLocalNotes(restoreOnFailure, logTag))) {
                unrestoredNotes = restoreOnFailure;
                showError("Sync failed and your local notes couldn't be saved back yet. Keep the app open and sync again.");
            }
        }
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

// Module-level, not per hook instance: several components mount each provider's
// hook, and only one of them should sync when the OAuth-success event fires.
const oauthSuccessInFlight = new Set<CloudSyncProvider>();

/**
 * Handles a provider's "<provider>-oauth-success" event: runs `syncAfterAuth`
 * once across all hook instances, and hands a conflict to the global resolver.
 */
export const runOAuthSuccessSync = async (
    provider: CloudSyncProvider,
    syncAfterAuth: () => Promise<SyncResult>
): Promise<void> => {
    if (oauthSuccessInFlight.has(provider)) return;
    oauthSuccessInFlight.add(provider);
    try {
        const syncResult = await syncAfterAuth();
        if (syncResult.status === "conflict") {
            window.dispatchEvent(new CustomEvent("open-sync-conflict", {
                detail: { service: provider, payload: syncResult.cloudPayload, reason: syncResult.reason },
            }));
        }
    } finally {
        oauthSuccessInFlight.delete(provider);
    }
};
