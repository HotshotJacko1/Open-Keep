// Copyright (c) 2026. Licensed under AGPLv3.
import { describe, it, expect, vi, beforeAll } from "vitest";
import type { Note, TagChange, Tombstone } from "@/types/note";
import { isSameNote, isSameSyncData, mergeSyncData, type SyncData } from "@/lib/sync-merge";
import { mergeTagChanges, mergeTombstones, pruneTombstones, normalizeTagChanges, normalizeTombstones, TOMBSTONE_RETENTION_MS } from "@/lib/tombstones";

// sync-data.ts pulls in image storage (Capacitor Filesystem). These tests use no images.
vi.mock("@/lib/image-storage", () => ({
    resolveImagesToBase64: async () => [],
    restoreImagesFromBase64: async () => [],
}));

let serializeSyncData: typeof import("@/lib/sync-data").serializeSyncData;
let parseSyncData: typeof import("@/lib/sync-data").parseSyncData;
beforeAll(async () => {
    ({ serializeSyncData, parseSyncData } = await import("@/lib/sync-data"));
    vi.spyOn(console, "log").mockImplementation(() => {});
});

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 1);
// Recent enough that no tombstone below is pruned unless a test means it to be.
const T = NOW - DAY;

const note = (id: string, updatedAt: number, extra: Partial<Note> = {}): Note => ({
    id, title: "", content: "", tags: [], isPinned: false, isArchived: false,
    createdAt: updatedAt, updatedAt, ...extra,
});

const data = (notes: Note[], tombstones: Tombstone[] = [], extra: Partial<SyncData> = {}): SyncData =>
    ({ notes, customTags: [], tombstones, tagChanges: [], ...extra });

const merge = (local: SyncData, remote: SyncData, lastSyncStartedAt: number | null = null, now = NOW) =>
    mergeSyncData({ local, remote, lastSyncStartedAt, now, logTag: "[test]" });

const ids = (notes: Note[]) => notes.map((n) => n.id).sort();

describe("mergeSyncData: behaviour unchanged from before tombstones", () => {
    it("unions notes; the newer copy wins; ties keep local", () => {
        const r = merge(
            data([note("a", 10, { title: "local" }), note("b", 20, { title: "local" }), note("c", 5)]),
            data([note("a", 11, { title: "remote" }), note("b", 20, { title: "remote" }), note("d", 5)]),
        );
        const byId = new Map(r.notes.map((n) => [n.id, n]));
        expect(ids(r.notes)).toEqual(["a", "b", "c", "d"]);
        expect(byId.get("a")!.title).toBe("remote");
        expect(byId.get("b")!.title).toBe("local");
        expect(r.removeIds).toEqual([]);
    });

    it("unions and sorts custom tags", () => {
        const r = merge({ ...data([]), customTags: ["b", "a"] }, { ...data([]), customTags: ["c", "a"] });
        expect(r.customTags).toEqual(["a", "b", "c"]);
    });
});

describe("mergeSyncData: tombstones", () => {
    it("1. a note deleted on one device is removed from the other", () => {
        // A deleted "x" (tombstone uploaded); B still has it and syncs.
        const r = merge(data([note("x", T + 100), note("y", T + 100)]), data([note("y", T + 100)], [{ id: "x", deletedAt: T + 200 }]));
        expect(ids(r.notes)).toEqual(["y"]);
        expect(r.removeIds).toEqual(["x"]);
        expect(r.tombstones).toEqual([{ id: "x", deletedAt: T + 200 }]);
    });

    it("1b. the deleting device's own tombstone stops a remote copy coming back", () => {
        const r = merge(data([], [{ id: "x", deletedAt: T + 200 }]), data([note("x", T + 100)]));
        expect(r.notes).toEqual([]);
        expect(r.removeIds).toEqual([]); // not held locally, nothing to delete here
        expect(r.tombstones).toEqual([{ id: "x", deletedAt: T + 200 }]);
    });

    it("2. a note edited after it was deleted wins, and the tombstone is dropped", () => {
        const r = merge(data([note("x", T + 300)]), data([], [{ id: "x", deletedAt: T + 200 }]));
        expect(ids(r.notes)).toEqual(["x"]);
        expect(r.removeIds).toEqual([]);
        expect(r.tombstones).toEqual([]);
    });

    it("keeps the latest deletedAt when both sides have a tombstone", () => {
        expect(mergeTombstones([{ id: "x", deletedAt: 1 }], [{ id: "x", deletedAt: 5 }])).toEqual([{ id: "x", deletedAt: 5 }]);
    });

    it("4. prunes tombstones past 180 days and records when", () => {
        const old = { id: "old", deletedAt: NOW - 181 * DAY };
        const fresh = { id: "new", deletedAt: NOW - 10 * DAY };
        const r = merge(data([], [old]), data([], [fresh]));
        expect(r.tombstones).toEqual([fresh]);
        expect(r.tombstonesPrunedBefore).toBe(NOW - TOMBSTONE_RETENTION_MS);
    });

    it("carries an existing prune time forward without moving it back", () => {
        const r = merge(data([]), data([], [], { tombstonesPrunedBefore: NOW - 5 * DAY }));
        expect(r.tombstonesPrunedBefore).toBe(NOW - 5 * DAY);
    });
});

describe("mergeSyncData: stale device (§4.4)", () => {
    const prunedBefore = NOW - 100 * DAY;
    const lastSync = NOW - 300 * DAY; // before the prune: this device may have missed deletes

    it("5. an unedited local note missing from the cloud goes to the Bin", () => {
        const r = merge(data([note("gone", lastSync - DAY)]), data([], [], { tombstonesPrunedBefore: prunedBefore }), lastSync);
        expect(r.notes).toHaveLength(1);
        expect(r.notes[0]).toMatchObject({ id: "gone", isDeleted: true, deletedAt: NOW, updatedAt: NOW });
        expect(r.removeIds).toEqual([]);
    });

    it("6. a note edited while offline is kept as-is", () => {
        const edited = note("edited", lastSync + DAY);
        const r = merge(data([edited]), data([], [], { tombstonesPrunedBefore: prunedBefore }), lastSync);
        expect(r.notes).toEqual([edited]);
    });

    it("does nothing when the device synced after the prune", () => {
        const n = note("n", NOW - 200 * DAY);
        const r = merge(data([n]), data([], [], { tombstonesPrunedBefore: prunedBefore }), NOW - 50 * DAY);
        expect(r.notes).toEqual([n]);
    });

    it("7. does nothing for a device that has never synced", () => {
        const n = note("n", 1);
        const r = merge(data([n]), data([], [], { tombstonesPrunedBefore: prunedBefore }), null);
        expect(r.notes).toEqual([n]);
    });

    it("leaves notes already in the Bin alone", () => {
        const binned = note("b", lastSync - DAY, { isDeleted: true, deletedAt: lastSync - DAY });
        const r = merge(data([binned]), data([], [], { tombstonesPrunedBefore: prunedBefore }), lastSync);
        expect(r.notes).toEqual([binned]);
    });
});

describe("mergeSyncData: custom labels (C1-19)", () => {
    const tags = (customTags: string[], tagChanges: TagChange[] = []) => data([], [], { customTags, tagChanges });

    it("a label deleted on one device isn't brought back by another", () => {
        // A deleted "work"; B still lists it.
        const r = merge(tags(["home", "work"]), tags(["home"], [{ name: "work", deleted: true, at: T }]));
        expect(r.customTags).toEqual(["home"]);
        expect(r.tagChanges).toEqual([{ name: "work", deleted: true, at: T }]);
    });

    it("a rename doesn't leave the old name behind", () => {
        const renamed = [{ name: "old", deleted: true, at: T }, { name: "new", deleted: false, at: T }];
        const r = merge(tags(["old"]), tags(["new"], renamed));
        expect(r.customTags).toEqual(["new"]);
    });

    it("re-creating a deleted label sticks, on either side", () => {
        const deleted = { name: "work", deleted: true, at: T };
        const recreated = { name: "work", deleted: false, at: T + 100 };
        expect(merge(tags(["work"], [recreated]), tags([], [deleted])).customTags).toEqual(["work"]);
        expect(merge(tags([], [deleted]), tags(["work"], [recreated])).customTags).toEqual(["work"]);
    });

    it("a create older than the delete loses", () => {
        const r = merge(tags(["work"], [{ name: "work", deleted: false, at: T }]), tags([], [{ name: "work", deleted: true, at: T + 100 }]));
        expect(r.customTags).toEqual([]);
    });

    it("on an exact tie, the delete wins", () => {
        expect(mergeTagChanges(
            [{ name: "x", deleted: false, at: 5 }], [{ name: "x", deleted: true, at: 5 }],
        )).toEqual([{ name: "x", deleted: true, at: 5 }]);
    });

    it("prunes label changes past 180 days", () => {
        const r = merge(tags([], [{ name: "gone", deleted: true, at: NOW - 181 * DAY }]), tags([]));
        expect(r.tagChanges).toEqual([]);
    });

    it("drops malformed label changes from an untrusted file", () => {
        expect(normalizeTagChanges([
            { name: "ok", deleted: true, at: 1 }, { name: "x", deleted: "yes", at: 1 }, { name: 2, deleted: true, at: 1 }, null,
        ])).toEqual([{ name: "ok", deleted: true, at: 1 }]);
        expect(normalizeTagChanges("nope")).toEqual([]);
    });
});

describe("normalizeTombstones", () => {
    it("drops malformed entries from an untrusted file", () => {
        expect(normalizeTombstones([
            { id: "ok", deletedAt: 1 }, { id: 1, deletedAt: 1 }, { id: "x" }, null, "x",
            { id: "nan", deletedAt: NaN }, { id: "extra", deletedAt: 2, title: "leak" },
        ])).toEqual([{ id: "ok", deletedAt: 1 }, { id: "extra", deletedAt: 2 }]);
        expect(normalizeTombstones({ not: "an array" })).toEqual([]);
        expect(normalizeTombstones(undefined)).toEqual([]);
    });

    it("prunes by age", () => {
        expect(pruneTombstones([{ id: "a", deletedAt: NOW - 200 * DAY }], NOW)).toEqual([]);
    });
});

/**
 * Compatibility with app versions before tombstones. `legacyParse` and `legacySerialize`
 * are copied verbatim from 5.1.0 (git 9f6e4cb, src/lib/dropbox.ts:196-219 and :239); the
 * Google Drive and OneDrive readers since 0.3.0 are the same shape. If these pass, an old
 * version reads a tombstone-bearing file exactly as it reads today's.
 */
describe("compatibility with pre-tombstone app versions", () => {
    const legacyParse = (result: unknown) => {
        let parsedNotes: Note[] = [];
        let parsedTags: string[] = [];
        let parsedNoteImages: Record<string, Array<{id: string, data: string}>> = {};

        if (Array.isArray(result)) {
            parsedNotes = result as Note[];
        } else if (result && typeof result === 'object' && 'notes' in result) {
            const payload = result as {
                notes?: Note[];
                customTags?: string[];
                noteImages?: Record<string, Array<{id: string, data: string}>>;
            };
            parsedNotes = payload.notes || [];
            parsedTags = payload.customTags || [];
            parsedNoteImages = payload.noteImages || {};
        }
        return { notes: parsedNotes, customTags: parsedTags, noteImages: parsedNoteImages };
    };
    const legacySerialize = (notes: Note[], customTags: string[], noteImages = {}) =>
        JSON.stringify({ notes, customTags, noteImages });
    // 5.1.0's merge: union by id, newer wins.
    const legacyMerge = (local: Note[], remote: Note[]) => {
        const m = new Map(local.map((n) => [n.id, n]));
        for (const r of remote) { const l = m.get(r.id); if (!l || r.updatedAt > l.updatedAt) m.set(r.id, r); }
        return Array.from(m.values());
    };

    const v2File = async () => serializeSyncData(data(
        [note("a", T + 100, { title: "A" })],
        [{ id: "deleted", deletedAt: T + 200 }],
        { customTags: ["work"], tombstonesPrunedBefore: T + 50 },
    ));

    it("an old version reads a new file exactly as it reads an old one", async () => {
        const newFile = JSON.parse(await v2File());
        const oldFile = JSON.parse(legacySerialize([note("a", T + 100, { title: "A" })], ["work"]));
        expect(legacyParse(newFile)).toEqual(legacyParse(oldFile));
    });

    it("the new file is still a JSON object with notes, customTags and noteImages", async () => {
        const parsed = JSON.parse(await v2File());
        expect(Array.isArray(parsed.notes)).toBe(true);
        expect(Array.isArray(parsed.customTags)).toBe(true);
        expect(typeof parsed.noteImages).toBe("object");
        // Tombstones hold ids and times only, never content.
        expect(parsed.tombstones).toEqual([{ id: "deleted", deletedAt: T + 200 }]);
    });

    it("9. the new version reads a 5.1.0 file, and the bare-array format", async () => {
        const fromObject = await parseSyncData(JSON.parse(legacySerialize([note("a", 1)], ["t"])));
        expect(fromObject).toEqual({ notes: [note("a", 1)], customTags: ["t"], tombstones: [], tombstonesPrunedBefore: undefined, tagChanges: [] });
        const fromArray = await parseSyncData([note("a", 1)]);
        expect(fromArray.notes).toEqual([note("a", 1)]);
        expect(fromArray.tombstones).toEqual([]);
    });

    it("an old device brings a deleted label back; the next new sync removes it again", async () => {
        const cloudAfterA = await serializeSyncData(data([], [], { customTags: ["home"], tagChanges: [{ name: "work", deleted: true, at: T }] }));
        const b = legacyParse(JSON.parse(cloudAfterA));
        const cloudAfterB = legacySerialize(b.notes, Array.from(new Set([...b.customTags, "home", "work"])).sort());
        const remote = await parseSyncData(JSON.parse(cloudAfterB));
        expect(remote.customTags).toEqual(["home", "work"]);
        expect(remote.tagChanges).toEqual([]);
        const r = merge(data([], [], { customTags: ["home"], tagChanges: [{ name: "work", deleted: true, at: T }] }), remote);
        expect(r.customTags).toEqual(["home"]);
        expect(r.tagChanges).toEqual([{ name: "work", deleted: true, at: T }]);
    });

    it("3. an old device resurrects a note and drops tombstones; the next new sync undoes it", async () => {
        // New device A deleted "x" and uploaded a v2 file with its tombstone.
        const cloudAfterA = await serializeSyncData(data([note("y", T + 100)], [{ id: "x", deletedAt: T + 200 }]));
        // Old device B still has "x": it merges the 5.1.0 way and re-uploads without tombstones.
        const b = legacyParse(JSON.parse(cloudAfterA));
        const cloudAfterB = legacySerialize(legacyMerge([note("x", T + 100), note("y", T + 100)], b.notes), b.customTags);
        const remote = await parseSyncData(JSON.parse(cloudAfterB));
        expect(ids(remote.notes)).toEqual(["x", "y"]);
        expect(remote.tombstones).toEqual([]);
        // A syncs again with its local tombstone store: "x" is removed again and the tombstone restored.
        const r = merge(data([note("y", T + 100)], [{ id: "x", deletedAt: T + 200 }]), remote, NOW - DAY);
        expect(ids(r.notes)).toEqual(["y"]);
        expect(r.tombstones).toEqual([{ id: "x", deletedAt: T + 200 }]);
    });
});

describe("change detection (skipping no-op writes and uploads)", () => {
    it("a note read back from the cloud matches the local copy despite key order and null fields", () => {
        const local = note("a", 10, { title: "t", reminder: undefined });
        const fromCloud = JSON.parse(JSON.stringify({ updatedAt: 10, id: "a", reminder: null, ...local }));
        expect(isSameNote(local, fromCloud)).toBe(true);
    });

    it("any real difference counts as a change", () => {
        expect(isSameNote(note("a", 10), note("a", 11))).toBe(false);
        expect(isSameNote(note("a", 10), note("a", 10, { isPinned: true }))).toBe(false);
        expect(isSameNote(note("a", 10), note("a", 10, { images: ["images/img_1.jpg"] }))).toBe(false);
    });

    it("merging two identical sides changes nothing, so the upload is skipped", () => {
        const side = data([note("a", 10), note("b", 20)], [{ id: "x", deletedAt: T }], {
            customTags: ["Work"],
            tagChanges: [{ name: "Old", deleted: true, at: T }],
        });
        const remote = JSON.parse(JSON.stringify({ ...side, notes: [...side.notes].reverse() }));
        expect(isSameSyncData(merge(side, remote), remote)).toBe(true);
    });

    it("a local edit, new note, tombstone or label means the cloud needs the upload", () => {
        const remote = data([note("a", 10)]);
        expect(isSameSyncData(merge(data([note("a", 11)]), remote), remote)).toBe(false);
        expect(isSameSyncData(merge(data([note("a", 10), note("b", 5)]), remote), remote)).toBe(false);
        expect(isSameSyncData(merge(data([], [{ id: "a", deletedAt: T }]), remote), remote)).toBe(false);
        expect(isSameSyncData(merge(data([note("a", 10)], [], { customTags: ["New"] }), remote), remote)).toBe(false);
    });

    it("a file from a pre-tombstone version that lost this device's tombstones gets re-uploaded", () => {
        const local = data([note("a", 10)], [{ id: "gone", deletedAt: T }]);
        const remote = data([note("a", 10)]);
        expect(isSameSyncData(merge(local, remote), remote)).toBe(false);
    });
});
