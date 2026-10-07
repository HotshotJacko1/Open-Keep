// Copyright (c) 2026. Licensed under AGPLv3.
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import type { Note } from "@/types/note";
import type { SyncData, SyncMergeResult, SyncNotesOptions } from "@/lib/sync-merge";

// --- In-memory stand-ins for the browser and the local database ---

class MemoryStorage {
    private map = new Map<string, string>();
    getItem(key: string) { return this.map.has(key) ? this.map.get(key)! : null; }
    setItem(key: string, value: string) { this.map.set(key, String(value)); }
    removeItem(key: string) { this.map.delete(key); }
    clear() { this.map.clear(); }
}
vi.stubGlobal("localStorage", new MemoryStorage());
vi.stubGlobal("window", new EventTarget());

const db = new Map<string, Note>();
const keys = { verifyMatch: true, wipes: 0, failSaves: false, failOnce: new Set<string>() };

vi.mock("@/lib/note-storage", () => ({
    loadNotes: async () => Array.from(db.values()).map((n) => ({ ...n })),
    saveNote: async (note: Note) => {
        if (keys.failSaves) throw new Error("save failed");
        if (keys.failOnce.delete(note.id)) throw new Error("save failed");
        db.set(note.id, { ...note });
    },
    deleteNote: async (id: string) => { db.delete(id); },
    exportMasterKey: async () => "local-key",
    importMasterKey: async () => {},
    verifyCloudMasterKeyMatch: async () => keys.verifyMatch,
    canDecryptCloudMasterKey: async () => true,
    wipeDatabaseButKeepKeys: async () => { keys.wipes++; db.clear(); },
    verifyEncryptionPin: async () => true,
}));
vi.mock("@/lib/pin", () => ({
    setAppLockEnabled: () => {},
    clearAppLockPin: () => {},
    setEncryptionEnabled: () => {},
    getCloudKeyCache: () => null,
    getCloudKeyPushFromPin: () => null,
    getSessionPin: () => "",
    isCloudKeyPushPending: () => false,
    isEncryptionEnabled: () => false,
    setCloudKeyCache: () => {},
    setCloudKeyPushPending: () => {},
    setSessionPin: () => {},
}));
vi.mock("@/lib/cloud-sync-state", () => ({ setCloudSyncState: () => {} }));
vi.mock("@/utils/toast", () => ({ showSuccess: () => {}, showError: () => {} }));
vi.mock("@/lib/image-storage", () => ({
    deleteImage: async () => {},
    withImagesInPlaintext: async <T>(fn: () => Promise<T>) => fn(),
}));

let runCloudSync: typeof import("@/lib/cloud-sync-runner").runCloudSync;
let mergeSyncData: typeof import("@/lib/sync-merge").mergeSyncData;
let takeSide: typeof import("@/lib/sync-merge").takeSide;
let tombstones: typeof import("@/lib/tombstones");
let readCustomTags: typeof import("@/lib/custom-tags").readCustomTags;
type Adapter = import("@/lib/cloud-sync-runner").CloudSyncAdapter;

beforeAll(async () => {
    ({ runCloudSync } = await import("@/lib/cloud-sync-runner"));
    ({ mergeSyncData, takeSide } = await import("@/lib/sync-merge"));
    tombstones = await import("@/lib/tombstones");
    ({ readCustomTags } = await import("@/lib/custom-tags"));
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
});

beforeEach(() => {
    db.clear();
    localStorage.clear();
    Object.assign(keys, { verifyMatch: true, wipes: 0, failSaves: false, failOnce: new Set<string>() });
});

const note = (id: string, updatedAt = Date.now() - 60_000): Note => ({
    id, title: id, content: "", tags: [], isPinned: false, isArchived: false,
    createdAt: updatedAt, updatedAt,
});

/**
 * A provider whose cloud file is `remote`. `duringSync` runs while the sync is
 * "in flight", before the merge result comes back; `fail` makes the download throw.
 */
const adapter = (
    remote: SyncData,
    { fail = false, duringSync, prepare }: { fail?: boolean; duringSync?: () => Promise<void>; prepare?: () => Promise<void> } = {}
): Adapter => ({
    provider: "dropbox",
    prepare,
    label: "Test",
    lastSyncedKey: "test-last-synced",
    successMessage: "ok",
    failureMessage: "failed",
    permissionMessage: "denied",
    checkMasterKey: async () => ({ exists: true, payload: "cloud-key" }),
    syncNotes: async (local: SyncData, options: SyncNotesOptions): Promise<SyncMergeResult> => {
        await duringSync?.();
        if (fail) throw new Error("network down");
        if (options.forceResolution === "cloud") return takeSide(remote);
        return mergeSyncData({ local, remote, lastSyncStartedAt: options.lastSyncStartedAt, now: Date.now(), logTag: "[test]" });
    },
    classifyError: () => null,
    onSynced: () => {},
});

const emptyRemote = (notes: Note[] = []): SyncData => ({ notes, customTags: [], tombstones: [], tagChanges: [] });

describe("C1-20: a failed merge doesn't lose local notes", () => {
    it("skips the wipe when the keys already match", async () => {
        db.set("a", note("a"));
        const result = await runCloudSync(adapter(emptyRemote(), { fail: true }), { forceResolution: "merge", cloudPayload: "cloud-key" });
        expect(result.status).toBe("error");
        expect(keys.wipes).toBe(0);
        expect([...db.keys()]).toEqual(["a"]);
    });

    it("puts local notes back when the keys differ and the download fails", async () => {
        keys.verifyMatch = false;
        db.set("a", note("a"));
        db.set("b", note("b"));
        const result = await runCloudSync(adapter(emptyRemote(), { fail: true }), { forceResolution: "merge", cloudPayload: "cloud-key" });
        expect(result.status).toBe("error");
        expect(keys.wipes).toBe(1);
        expect([...db.keys()].sort()).toEqual(["a", "b"]);
    });

    it("keeps the notes for the next sync when they can't be saved back", async () => {
        keys.verifyMatch = false;
        db.set("a", note("a"));
        keys.failSaves = true;
        await runCloudSync(adapter(emptyRemote(), { fail: true }), { forceResolution: "merge", cloudPayload: "cloud-key" });
        expect(db.size).toBe(0);

        // The cloud key was imported before the failure, so the keys now match.
        keys.failSaves = false;
        keys.verifyMatch = true;
        localStorage.setItem("test-last-synced", "yes");
        const result = await runCloudSync(adapter(emptyRemote([note("c")])));
        expect(result.status).toBe("success");
        expect([...db.keys()].sort()).toEqual(["a", "c"]);
    });

    it("still merges both sides when the keys differ and the sync succeeds", async () => {
        keys.verifyMatch = false;
        db.set("a", note("a"));
        const result = await runCloudSync(adapter(emptyRemote([note("c")])), { forceResolution: "merge", cloudPayload: "cloud-key" });
        expect(result.status).toBe("success");
        expect([...db.keys()].sort()).toEqual(["a", "c"]);
    });

    it("still replaces local with cloud on a \"cloud\" choice", async () => {
        db.set("a", note("a"));
        await runCloudSync(adapter(emptyRemote([note("c")])), { forceResolution: "cloud", cloudPayload: "cloud-key" });
        expect(keys.wipes).toBe(1);
        expect([...db.keys()]).toEqual(["c"]);
    });
});

describe("C1-29: the restore safety net covers the write-back and a failing prepare", () => {
    it("puts local notes back when a write-back save fails after a wiping merge", async () => {
        keys.verifyMatch = false;
        db.set("a", note("a"));
        keys.failOnce.add("a"); // the write-back's save of "a" throws; the restore's succeeds
        const result = await runCloudSync(adapter(emptyRemote([note("c")])), { forceResolution: "merge", cloudPayload: "cloud-key" });
        expect(result.status).toBe("error");
        expect(db.has("a")).toBe(true);
    });

    it("restores queued notes even when the next sync fails in prepare", async () => {
        keys.verifyMatch = false;
        db.set("a", note("a"));
        keys.failSaves = true;
        await runCloudSync(adapter(emptyRemote(), { fail: true }), { forceResolution: "merge", cloudPayload: "cloud-key" });
        expect(db.size).toBe(0);

        keys.failSaves = false;
        const result = await runCloudSync(adapter(emptyRemote(), {
            prepare: async () => { throw new Error("token refresh failed"); },
        }));
        expect(result.status).toBe("error");
        expect([...db.keys()]).toEqual(["a"]);
    });
});

/**
 * A cloud holding a key file and a notes file. Notes are readable only under the
 * key they were written with, so a key with someone else's notes next to it fails
 * to decrypt, as it does for real. "Keep local" uploads the key, then the notes.
 */
const twoFileCloud = (key: string, notes: Note[]) => {
    const cloud = { key, notesKey: key, notes: emptyRemote(notes), failNotesUpload: false };
    const provider: Adapter = {
        ...adapter(emptyRemote()),
        checkMasterKey: async () => ({ exists: true, payload: cloud.key }),
        syncNotes: async (local, options) => {
            if (options.masterKeyPayload) cloud.key = options.masterKeyPayload;
            if (options.forceResolution === "local") {
                if (cloud.failNotesUpload) throw new Error("network down");
                Object.assign(cloud, { notes: local, notesKey: cloud.key });
                return takeSide(local);
            }
            if (cloud.notesKey !== cloud.key) throw new Error("Cannot parse synced data");
            return mergeSyncData({ local, remote: cloud.notes, lastSyncStartedAt: options.lastSyncStartedAt, now: Date.now(), logTag: "[test]" });
        },
    };
    return { cloud, provider };
};

describe("C1-28: an interrupted \"Keep local\" is finished, not asked again", () => {
    beforeEach(() => localStorage.setItem("test-last-synced", "yes"));

    it("finishes the notes upload on the next sync", async () => {
        db.set("a", note("a"));
        const { cloud, provider } = twoFileCloud("other-device-key", [note("theirs")]);
        cloud.failNotesUpload = true;
        const first = await runCloudSync(provider, { forceResolution: "local", cloudPayload: "other-device-key" });
        expect(first.status).toBe("error");
        expect(cloud.key).toBe("local-key");
        expect(cloud.notesKey).toBe("other-device-key");

        cloud.failNotesUpload = false;
        const next = await runCloudSync(provider);
        expect(next.status).toBe("success");
        expect(cloud.notesKey).toBe("local-key");
        expect(cloud.notes.notes.map((n) => n.id)).toEqual(["a"]);
        expect(localStorage.getItem("dropbox-keep-local-pending")).toBeNull();
    });

    it("leaves the cloud alone if another device has written its key since", async () => {
        db.set("a", note("a"));
        const { cloud, provider } = twoFileCloud("other-device-key", [note("theirs")]);
        cloud.failNotesUpload = true;
        await runCloudSync(provider, { forceResolution: "local", cloudPayload: "other-device-key" });

        // A third device chose "Keep local" in between, and finished.
        Object.assign(cloud, { key: "third-device-key", notesKey: "third-device-key", notes: emptyRemote([note("third")]) });
        cloud.failNotesUpload = false;
        keys.verifyMatch = false;
        const next = await runCloudSync(provider);
        expect(next.status).toBe("conflict");
        expect(cloud.key).toBe("third-device-key");
        expect(cloud.notes.notes.map((n) => n.id)).toEqual(["third"]);
        expect(localStorage.getItem("dropbox-keep-local-pending")).toBeNull();
    });

    it("leaves nothing to finish after a \"Keep local\" that succeeds", async () => {
        db.set("a", note("a"));
        const { cloud, provider } = twoFileCloud("other-device-key", [note("theirs")]);
        const result = await runCloudSync(provider, { forceResolution: "local", cloudPayload: "other-device-key" });
        expect(result.status).toBe("success");
        expect(cloud.notesKey).toBe("local-key");
        expect(localStorage.getItem("dropbox-keep-local-pending")).toBeNull();
    });
});

describe("C1-22: deletes and label changes made during a sync are kept", () => {
    beforeEach(() => localStorage.setItem("test-last-synced", "yes"));

    it("doesn't resurrect a note permanently deleted mid-sync, and keeps its tombstone", async () => {
        const a = note("a");
        db.set("a", a);
        const result = await runCloudSync(adapter(emptyRemote([a]), {
            duringSync: async () => {
                db.delete("a");
                tombstones.recordTombstone("a");
            },
        }));
        expect(result.status).toBe("success");
        expect(db.has("a")).toBe(false);
        expect(tombstones.readTombstones().map((t) => t.id)).toEqual(["a"]);
    });

    it("keeps a label created and a label deleted mid-sync", async () => {
        localStorage.setItem("custom-tags", JSON.stringify(["old"]));
        db.set("a", note("a"));
        await runCloudSync(adapter({ ...emptyRemote(), customTags: ["old", "remote"] }, {
            duringSync: async () => {
                localStorage.setItem("custom-tags", JSON.stringify(["new"]));
                tombstones.recordTagChange("old", true);
                tombstones.recordTagChange("new", false);
            },
        }));
        expect(readCustomTags()).toEqual(["new", "remote"]);
        const changes = Object.fromEntries(tombstones.readTagChanges().map((c) => [c.name, c.deleted]));
        expect(changes).toEqual({ old: true, new: false });
    });
});
