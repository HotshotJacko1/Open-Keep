// Copyright (c) 2026. Licensed under AGPLv3.
import type { Note, TagChange, Tombstone } from "@/types/note";
import { mergeTagChanges, mergeTombstones, pruneTagChanges, pruneTombstones, TOMBSTONE_RETENTION_MS } from "@/lib/tombstones";

/** What a cloud notes file holds, once decrypted and parsed. */
export interface SyncData {
    notes: Note[];
    customTags: string[];
    tombstones: Tombstone[];
    /** Tombstones deleted before this time may have been pruned (see TOMBSTONE_RETENTION_MS). */
    tombstonesPrunedBefore?: number;
    /** Latest create/delete per custom label (C1-19). */
    tagChanges: TagChange[];
}

export interface SyncMergeResult extends SyncData {
    /** Ids of notes this device holds that a tombstone says to delete locally. */
    removeIds: string[];
}

/** Options every provider's syncNotes takes (see CloudSyncAdapter.syncNotes). */
export interface SyncNotesOptions {
    masterKeyPayload?: string;
    forceResolution?: "local" | "cloud";
    lastSyncStartedAt: number | null;
}

export const emptySyncData = (): SyncData => ({ notes: [], customTags: [], tombstones: [], tagChanges: [] });

/** The result of a "keep one side" resolution: that side as-is, nothing to remove. */
export const takeSide = (data: SyncData): SyncMergeResult => ({ ...data, removeIds: [] });

interface MergeInput {
    local: SyncData;
    remote: SyncData;
    /** When this device's last successful sync with this provider started; null if unknown. */
    lastSyncStartedAt: number | null;
    now: number;
    logTag: string;
}

/**
 * Merges this device's data with the cloud's. Pure: no I/O, so it can be unit tested.
 * The rules are in docs/plans/C3-01-tombstones.md §4.3–4.4. In short:
 *
 * 1. Notes: union by id; the higher updatedAt wins, ties keep local.
 * 2. A tombstone removes a note unless the note was edited after the delete,
 *    in which case the note wins and the tombstone is dropped.
 * 3. Stale device: if this device last synced before tombstones were pruned, it may
 *    have missed deletes. Local notes the cloud no longer has, that weren't edited
 *    since that sync, go to the Bin (recoverable), not back into the cloud.
 * 4. Tombstones older than the retention window are pruned.
 * 5. Custom labels: union, minus any whose latest change (either side) is a delete.
 *    Renames are a delete plus a create. Label changes are pruned like tombstones.
 *
 * Logs note ids only, never titles: console output reaches Sentry as breadcrumbs.
 */
export const mergeSyncData = ({ local, remote, lastSyncStartedAt, now, logTag }: MergeInput): SyncMergeResult => {
    console.log(`${logTag} Starting merge. Local notes: ${local.notes.length}, Remote notes: ${remote.notes.length}`);

    // 1. Notes
    const merged = new Map<string, Note>();
    for (const note of local.notes) merged.set(note.id, note);
    const remoteIds = new Set<string>();
    for (const remoteNote of remote.notes) {
        remoteIds.add(remoteNote.id);
        const localNote = merged.get(remoteNote.id);
        if (!localNote || remoteNote.updatedAt > localNote.updatedAt) {
            merged.set(remoteNote.id, remoteNote);
        }
    }

    // 2. Tombstones
    const localIds = new Set(local.notes.map((n) => n.id));
    const removeIds: string[] = [];
    const tombstones: Tombstone[] = [];
    const tombstonedIds = new Set<string>();
    for (const tombstone of mergeTombstones(local.tombstones, remote.tombstones)) {
        tombstonedIds.add(tombstone.id);
        const note = merged.get(tombstone.id);
        if (note && note.updatedAt > tombstone.deletedAt) {
            // Edited after the delete (e.g. restored from the Bin elsewhere): the edit wins.
            console.log(`${logTag} Note ${tombstone.id} was edited after it was deleted. Keeping it.`);
            continue;
        }
        if (note) {
            merged.delete(tombstone.id);
            if (localIds.has(tombstone.id)) removeIds.push(tombstone.id);
            console.log(`${logTag} Note ${tombstone.id} was permanently deleted. Removing it.`);
        }
        tombstones.push(tombstone);
    }

    // 3. Stale device
    const prunedBefore = remote.tombstonesPrunedBefore;
    if (lastSyncStartedAt !== null && prunedBefore !== undefined && lastSyncStartedAt < prunedBefore) {
        for (const note of local.notes) {
            if (remoteIds.has(note.id) || tombstonedIds.has(note.id) || note.isDeleted) continue;
            if (note.updatedAt > lastSyncStartedAt) continue; // edited while offline: keep
            console.log(`${logTag} Note ${note.id} is missing from the cloud and this device missed pruned deletes. Moving it to the Bin.`);
            merged.set(note.id, { ...note, isDeleted: true, deletedAt: now, updatedAt: now });
        }
    }

    // 4. Prune
    const kept = pruneTombstones(tombstones, now);
    let tombstonesPrunedBefore = maxDefined(local.tombstonesPrunedBefore, remote.tombstonesPrunedBefore);
    if (kept.length < tombstones.length) {
        tombstonesPrunedBefore = maxDefined(tombstonesPrunedBefore, now - TOMBSTONE_RETENTION_MS);
    }

    // 5. Custom labels
    const allTagChanges = mergeTagChanges(local.tagChanges, remote.tagChanges);
    const deletedTags = new Set(allTagChanges.filter((c) => c.deleted).map((c) => c.name));
    const customTags = Array.from(new Set([...local.customTags, ...remote.customTags]))
        .filter((tag) => !deletedTags.has(tag))
        .sort();
    const tagChanges = pruneTagChanges(allTagChanges, now);

    const notes = Array.from(merged.values());
    console.log(`${logTag} Merge done. Notes: ${notes.length}, removed locally: ${removeIds.length}, tombstones: ${kept.length}`);
    return { notes, customTags, tombstones: kept, tombstonesPrunedBefore, tagChanges, removeIds };
};

const maxDefined = (a: number | undefined, b: number | undefined): number | undefined =>
    a === undefined ? b : b === undefined ? a : Math.max(a, b);

/**
 * A stable string for comparing values that came from different places (the native
 * DB, a parsed cloud file): object keys sorted, and null/undefined fields dropped,
 * since a note with no reminder may carry `reminder: null` from one source and no
 * key at all from another.
 */
const canonical = (value: unknown): string =>
    JSON.stringify(value, (_key, v) =>
        v && typeof v === "object" && !Array.isArray(v)
            ? Object.fromEntries(
                  Object.keys(v)
                      .filter((k) => v[k] !== null && v[k] !== undefined)
                      .sort()
                      .map((k) => [k, v[k]])
              )
            : v
    );

/** Whether two copies of a note hold the same data. */
export const isSameNote = (a: Note, b: Note): boolean => canonical(a) === canonical(b);

const byKey = <T>(items: T[], key: (item: T) => string): T[] =>
    [...items].sort((x, y) => (key(x) < key(y) ? -1 : key(x) > key(y) ? 1 : 0));

/**
 * Whether two sync states hold the same data, ignoring order. A provider uses it to
 * skip re-uploading a cloud file the merge didn't change.
 */
export const isSameSyncData = (a: SyncData, b: SyncData): boolean =>
    canonical({
        notes: byKey(a.notes, (n) => n.id),
        customTags: [...a.customTags].sort(),
        tombstones: byKey(a.tombstones, (t) => t.id),
        tombstonesPrunedBefore: a.tombstonesPrunedBefore,
        tagChanges: byKey(a.tagChanges, (c) => c.name),
    }) ===
    canonical({
        notes: byKey(b.notes, (n) => n.id),
        customTags: [...b.customTags].sort(),
        tombstones: byKey(b.tombstones, (t) => t.id),
        tombstonesPrunedBefore: b.tombstonesPrunedBefore,
        tagChanges: byKey(b.tagChanges, (c) => c.name),
    });
