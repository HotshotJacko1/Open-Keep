// Copyright (c) 2026. Licensed under AGPLv3.
import type { TagChange, Tombstone } from "@/types/note";

/**
 * Local store of tombstones: ids of notes this device has permanently deleted,
 * or has learned about from a sync. See docs/plans/C3-01-tombstones.md.
 *
 * Kept on this device (not only in the cloud file) so that when a pre-tombstone
 * app version re-uploads the cloud file without them, this device's next sync
 * puts them back. Holds note ids and times only, never content.
 */
const STORAGE_KEY = "open-keep-tombstones";

/** How long a tombstone is kept. Every device that syncs within this window sees it. */
export const TOMBSTONE_RETENTION_MS = 180 * 24 * 60 * 60 * 1000;

export const readTombstones = (): Tombstone[] => {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return [];
        return normalizeTombstones(JSON.parse(raw));
    } catch {
        return [];
    }
};

export const writeTombstones = (tombstones: Tombstone[]): void => {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(tombstones));
    } catch (error) {
        console.error("Failed to save tombstones:", error);
    }
};

export const recordTombstone = (id: string, deletedAt: number = Date.now()): void => {
    writeTombstones(mergeTombstones(readTombstones(), [{ id, deletedAt }]));
};

export const clearTombstones = (): void => {
    localStorage.removeItem(STORAGE_KEY);
    clearTagChanges();
};

// --- Custom labels (C1-19) ---
//
// Labels are plain strings with no timestamps, so a delete-only tombstone can't tell
// "deleted" from "deleted, then re-created". Each label's latest create or delete is
// recorded instead, and the newest wins. Renaming is a delete of the old name plus a
// create of the new one. Same retention as note tombstones.

const TAG_CHANGES_KEY = "open-keep-tag-changes";

export const readTagChanges = (): TagChange[] => {
    try {
        const raw = localStorage.getItem(TAG_CHANGES_KEY);
        if (!raw) return [];
        return normalizeTagChanges(JSON.parse(raw));
    } catch {
        return [];
    }
};

export const writeTagChanges = (changes: TagChange[]): void => {
    try {
        localStorage.setItem(TAG_CHANGES_KEY, JSON.stringify(changes));
    } catch (error) {
        console.error("Failed to save label changes:", error);
    }
};

export const recordTagChange = (name: string, deleted: boolean, at: number = Date.now()): void => {
    writeTagChanges(mergeTagChanges(readTagChanges(), [{ name, deleted, at }]));
};

export const clearTagChanges = (): void => {
    localStorage.removeItem(TAG_CHANGES_KEY);
};

/** Latest change per name. On an exact tie a delete wins, since it was deliberate. */
export const mergeTagChanges = (...lists: TagChange[][]): TagChange[] => {
    const byName = new Map<string, TagChange>();
    for (const list of lists) {
        for (const change of list) {
            const existing = byName.get(change.name);
            if (!existing || change.at > existing.at || (change.at === existing.at && change.deleted)) {
                byName.set(change.name, change);
            }
        }
    }
    return Array.from(byName.values());
};

export const pruneTagChanges = (changes: TagChange[], now: number): TagChange[] => {
    const cutoff = now - TOMBSTONE_RETENTION_MS;
    return changes.filter((c) => c.at >= cutoff);
};

export const normalizeTagChanges = (value: unknown): TagChange[] => {
    if (!Array.isArray(value)) return [];
    return value.filter(
        (c): c is TagChange =>
            !!c && typeof c === "object" &&
            typeof (c as TagChange).name === "string" &&
            typeof (c as TagChange).deleted === "boolean" &&
            typeof (c as TagChange).at === "number" &&
            Number.isFinite((c as TagChange).at)
    ).map(({ name, deleted, at }) => ({ name, deleted, at }));
};

/** Union by id, keeping the latest deletedAt for each. */
export const mergeTombstones = (...lists: Tombstone[][]): Tombstone[] => {
    const byId = new Map<string, number>();
    for (const list of lists) {
        for (const { id, deletedAt } of list) {
            const existing = byId.get(id);
            if (existing === undefined || deletedAt > existing) byId.set(id, deletedAt);
        }
    }
    return Array.from(byId, ([id, deletedAt]) => ({ id, deletedAt }));
};

/** Drops tombstones older than the retention window. */
export const pruneTombstones = (tombstones: Tombstone[], now: number): Tombstone[] => {
    const cutoff = now - TOMBSTONE_RETENTION_MS;
    return tombstones.filter((t) => t.deletedAt >= cutoff);
};

/** Accepts untrusted input (a cloud file, localStorage) and keeps only well-formed entries. */
export const normalizeTombstones = (value: unknown): Tombstone[] => {
    if (!Array.isArray(value)) return [];
    return value.filter(
        (t): t is Tombstone =>
            !!t && typeof t === "object" &&
            typeof (t as Tombstone).id === "string" &&
            typeof (t as Tombstone).deletedAt === "number" &&
            Number.isFinite((t as Tombstone).deletedAt)
    ).map(({ id, deletedAt }) => ({ id, deletedAt }));
};
