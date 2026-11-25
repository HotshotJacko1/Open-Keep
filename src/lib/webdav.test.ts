// Copyright (c) 2026. Licensed under AGPLv3.
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import type { Note } from "@/types/note";
import type { SyncData, SyncNotesOptions } from "@/lib/sync-merge";

// --- In-memory stand-ins for the browser ---

class MemoryStorage {
    private map = new Map<string, string>();
    getItem(key: string) { return this.map.has(key) ? this.map.get(key)! : null; }
    setItem(key: string, value: string) { this.map.set(key, String(value)); }
    removeItem(key: string) { this.map.delete(key); }
    clear() { this.map.clear(); }
}
vi.stubGlobal("localStorage", new MemoryStorage());
vi.stubGlobal("window", new EventTarget());

// Web build: requests go through fetch.
vi.mock("@capacitor/core", () => ({
    Capacitor: { isNativePlatform: () => false, getPlatform: () => "web" },
    registerPlugin: () => ({}),
    CapacitorHttp: { request: async () => { throw new Error("not used on web"); } },
}));
// Encryption off: the file is the plain JSON, as with an empty PIN.
vi.mock("@/lib/note-storage", () => ({
    encryptData: async (text: string) => text,
    decryptData: async (text: string) => text,
}));
vi.mock("@/lib/image-storage", () => ({
    isValidImagePath: () => true,
    resolveImagesToBase64: async () => [],
    restoreImagesFromBase64: async () => [],
}));

// --- A small WebDAV server: folders, files with ETags, conditional PUT ---

/** `modified`: a Last-Modified time, one second apart per write, as a real server's whole-second clock would be. */
interface ServerFile { body: string; etag: string; modified: number }

const server = {
    folders: new Set<string>(),
    files: new Map<string, ServerFile>(),
    version: 0,
    password: "secret",
    weakEtags: false,
    lastModified: true,
    mkcolRejects: false,
    requests: [] as Array<{ method: string; url: string; headers: Record<string, string> }>,
    /** Runs just before a PUT is applied, once: another device writing in between. */
    beforeNextPut: null as null | (() => void),
};

const ROOT = "https://dav.example.com/remote.php/dav/files/alice/";

const parentOf = (url: string) => url.replace(/[^/]+\/?$/, "");

const write = (url: string, body: string) => {
    server.version++;
    server.files.set(url, {
        body,
        etag: `${server.weakEtags ? "W/" : ""}"v${server.version}"`,
        modified: Date.UTC(2026, 0, 1) + server.version * 1000,
    });
};

const fakeFetch = async (input: string, init: RequestInit = {}): Promise<Response> => {
    const method = init.method ?? "GET";
    const headers = init.headers as Record<string, string>;
    server.requests.push({ method, url: input, headers });

    const expectedAuth = "Basic " + Buffer.from(`alice:${server.password}`, "utf8").toString("base64");
    if (headers.Authorization !== expectedAuth) return new Response("", { status: 401 });

    switch (method) {
        case "GET": {
            const file = server.files.get(input);
            return file
                ? new Response(file.body, {
                    status: 200,
                    headers: {
                        ETag: file.etag,
                        ...(server.lastModified && { "Last-Modified": new Date(file.modified).toUTCString() }),
                    },
                })
                : new Response("", { status: 404 });
        }
        case "PUT": {
            if (!server.folders.has(parentOf(input))) return new Response("", { status: 409 });
            if (server.beforeNextPut) {
                const run = server.beforeNextPut;
                server.beforeNextPut = null;
                run();
            }
            const existing = server.files.get(input);
            const ifMatch = headers["If-Match"];
            const ifNoneMatch = headers["If-None-Match"];
            if (ifMatch && existing?.etag !== ifMatch) return new Response("", { status: 412 });
            if (ifNoneMatch === "*" && existing) return new Response("", { status: 412 });
            const ifUnmodifiedSince = headers["If-Unmodified-Since"];
            if (ifUnmodifiedSince && existing && existing.modified > Date.parse(ifUnmodifiedSince)) {
                return new Response("", { status: 412 });
            }
            write(input, init.body as string);
            return new Response(null, { status: existing ? 204 : 201 });
        }
        case "DELETE": {
            return server.files.delete(input) ? new Response(null, { status: 204 }) : new Response("", { status: 404 });
        }
        case "MKCOL": {
            if (server.mkcolRejects) throw new TypeError("Failed to fetch");
            if (server.folders.has(input)) return new Response("", { status: 405 });
            if (!server.folders.has(parentOf(input))) return new Response("", { status: 409 });
            server.folders.add(input);
            return new Response("", { status: 201 });
        }
    }
    return new Response("", { status: 405 });
};
vi.stubGlobal("fetch", fakeFetch);

let webdav: typeof import("@/lib/webdav");

beforeAll(async () => {
    webdav = await import("@/lib/webdav");
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
});

const FOLDER = ROOT + "Open%20Keep/";
const NOTES = FOLDER + "notes.json";
const KEY = FOLDER + "encrypted_master_key.json";

beforeEach(() => {
    localStorage.clear();
    Object.assign(server, {
        folders: new Set([ROOT]),
        files: new Map(),
        version: 0,
        password: "secret",
        weakEtags: false,
        lastModified: true,
        mkcolRejects: false,
        requests: [],
        beforeNextPut: null,
    });
    webdav.saveWebDavConfig({ serverUrl: ROOT, folder: "Open Keep", username: "alice", password: "secret" });
});

const note = (id: string, updatedAt = Date.now() - 60_000): Note => ({
    id, title: id, content: "", tags: [], isPinned: false, isArchived: false,
    createdAt: updatedAt, updatedAt,
});
const data = (notes: Note[]): SyncData => ({ notes, customTags: [], tombstones: [], tagChanges: [] });
const opts = (o: Partial<SyncNotesOptions> = {}): SyncNotesOptions => ({ lastSyncStartedAt: null, ...o });
const serverNoteIds = () => (JSON.parse(server.files.get(NOTES)!.body).notes as Note[]).map((n) => n.id).sort();

describe("addresses", () => {
    it("normalizes the server address and encodes folder segments", () => {
        expect(webdav.normalizeServerUrl("  https://dav.example.com/files/alice  ")).toBe("https://dav.example.com/files/alice/");
        expect(webdav.folderUrlFor({ serverUrl: ROOT, folder: "/Notes/Open Keep/" })).toBe(ROOT + "Notes/Open%20Keep/");
        expect(webdav.folderUrlFor({ serverUrl: ROOT, folder: "" })).toBe(ROOT);
    });

    it("rejects addresses it can't use", () => {
        expect(() => webdav.normalizeServerUrl("dav.example.com")).toThrow(/https:\/\//);
        expect(() => webdav.normalizeServerUrl("ftp://dav.example.com/")).toThrow(/https:\/\//);
        expect(() => webdav.normalizeServerUrl("https://alice:pw@dav.example.com/")).toThrow(/own fields/);
        expect(() => webdav.normalizeFolder("notes/../..")).toThrow();
    });
});

describe("probeWebDav", () => {
    it("accepts a server where the app's files don't exist yet", async () => {
        await expect(webdav.probeWebDav(webdav.readWebDavConfig()!)).resolves.toBeUndefined();
    });

    it("explains a wrong password", async () => {
        server.password = "other";
        await expect(webdav.probeWebDav(webdav.readWebDavConfig()!)).rejects.toThrow(/username and password/);
    });
});

describe("syncNotesWithWebDav", () => {
    it("creates the folder on the first sync and writes the notes", async () => {
        const result = await webdav.syncNotesWithWebDav(data([note("a")]), opts({ masterKeyPayload: "wrapped-key" }));

        expect(result.notes.map((n) => n.id)).toEqual(["a"]);
        expect(server.folders.has(FOLDER)).toBe(true);
        expect(serverNoteIds()).toEqual(["a"]);
        expect(JSON.parse(server.files.get(KEY)!.body)).toBe("wrapped-key");
        // A file that wasn't there is only created if it still isn't.
        const notesPut = server.requests.filter((r) => r.method === "PUT" && r.url === NOTES).at(-1)!;
        expect(notesPut.headers["If-None-Match"]).toBe("*");
        await expect(webdav.checkWebDavMasterKey()).resolves.toEqual({ exists: true, payload: "wrapped-key" });
    });

    it("merges in notes another device uploaded", async () => {
        await webdav.syncNotesWithWebDav(data([note("from-phone")]), opts({}));
        const result = await webdav.syncNotesWithWebDav(data([note("from-laptop")]), opts({}));

        expect(result.notes.map((n) => n.id).sort()).toEqual(["from-laptop", "from-phone"]);
        expect(serverNoteIds()).toEqual(["from-laptop", "from-phone"]);
        const notesPut = server.requests.filter((r) => r.method === "PUT" && r.url === NOTES).at(-1)!;
        expect(notesPut.headers["If-Match"]).toBe(`"v1"`);
    });

    it("skips the upload when the server already has the merged notes", async () => {
        await webdav.syncNotesWithWebDav(data([note("a", 1000)]), opts({}));
        server.requests = [];
        await webdav.syncNotesWithWebDav(data([note("a", 1000)]), opts({}));
        expect(server.requests.some((r) => r.method === "PUT")).toBe(false);
    });

    it("re-reads and merges when another device writes during the sync", async () => {
        await webdav.syncNotesWithWebDav(data([note("first")]), opts({}));
        server.beforeNextPut = () => {
            write(NOTES, JSON.stringify({ formatVersion: 2, notes: [note("first"), note("sneaky")], customTags: [], noteImages: {}, tombstones: [], tagChanges: [] }));
        };

        const result = await webdav.syncNotesWithWebDav(data([note("first"), note("mine")]), opts({}));

        expect(result.notes.map((n) => n.id).sort()).toEqual(["first", "mine", "sneaky"]);
        expect(serverNoteIds()).toEqual(["first", "mine", "sneaky"]);
    });

    it("with a weak ETag, which If-Match never matches, checks Last-Modified instead", async () => {
        server.weakEtags = true;
        await webdav.syncNotesWithWebDav(data([note("a")]), opts({}));
        const readVersion = new Date(server.files.get(NOTES)!.modified).toUTCString();
        await webdav.syncNotesWithWebDav(data([note("b")]), opts({}));
        const notesPut = server.requests.filter((r) => r.method === "PUT" && r.url === NOTES).at(-1)!;
        expect(notesPut.headers["If-Match"]).toBeUndefined();
        expect(notesPut.headers["If-Unmodified-Since"]).toBe(readVersion);
        expect(serverNoteIds()).toEqual(["a", "b"]);
    });

    it("with a weak ETag, still re-reads and merges a write from another device", async () => {
        server.weakEtags = true;
        await webdav.syncNotesWithWebDav(data([note("first")]), opts({}));
        server.beforeNextPut = () => {
            write(NOTES, JSON.stringify({ formatVersion: 2, notes: [note("first"), note("sneaky")], customTags: [], noteImages: {}, tombstones: [], tagChanges: [] }));
        };

        const result = await webdav.syncNotesWithWebDav(data([note("first"), note("mine")]), opts({}));

        expect(result.notes.map((n) => n.id).sort()).toEqual(["first", "mine", "sneaky"]);
        expect(serverNoteIds()).toEqual(["first", "mine", "sneaky"]);
    });

    it("with neither a strong ETag nor Last-Modified, writes without a check", async () => {
        server.weakEtags = true;
        server.lastModified = false;
        await webdav.syncNotesWithWebDav(data([note("a")]), opts({}));
        await webdav.syncNotesWithWebDav(data([note("b")]), opts({}));
        const notesPut = server.requests.filter((r) => r.method === "PUT" && r.url === NOTES).at(-1)!;
        expect(notesPut.headers["If-Match"]).toBeUndefined();
        expect(notesPut.headers["If-Unmodified-Since"]).toBeUndefined();
        expect(serverNoteIds()).toEqual(["a", "b"]);
    });

    it("'Keep local' overwrites the server unconditionally", async () => {
        await webdav.syncNotesWithWebDav(data([note("cloud")]), opts({}));
        await webdav.syncNotesWithWebDav(data([note("local")]), opts({ forceResolution: "local", masterKeyPayload: "k" }));
        expect(serverNoteIds()).toEqual(["local"]);
    });

    it("says to create the folder when it can't be created (Android)", async () => {
        server.mkcolRejects = true;
        await expect(webdav.syncNotesWithWebDav(data([note("a")]), opts({}))).rejects.toThrow(/Create it there/);
    });

    it("reports a rejected password as a 401", async () => {
        server.password = "changed";
        const error = await webdav.syncNotesWithWebDav(data([note("a")]), opts({})).catch((e) => e);
        expect(error).toBeInstanceOf(webdav.WebDavHttpError);
        expect(error.status).toBe(401);
    });
});

describe("credentials", () => {
    it("encodes a non-ASCII password as UTF-8 Basic auth", async () => {
        server.password = "pässwörd✓";
        webdav.saveWebDavConfig({ serverUrl: ROOT, folder: "Open Keep", username: "alice", password: "pässwörd✓" });
        await expect(webdav.syncNotesWithWebDav(data([note("a")]), opts({}))).resolves.toBeDefined();
    });

    it("a plain disconnect keeps the address for the form but drops the password", () => {
        webdav.clearWebDavConfig();
        expect(webdav.readWebDavConfig()).toBeNull();
        expect(webdav.readWebDavFormDefaults()).toEqual({ serverUrl: ROOT, folder: "Open Keep", username: "alice" });
        webdav.clearWebDavConfig(true);
        expect(webdav.readWebDavFormDefaults().serverUrl).toBe("");
    });
});

describe("deleteRemoteData", () => {
    it("removes both files and leaves the folder", async () => {
        await webdav.syncNotesWithWebDav(data([note("a")]), opts({ masterKeyPayload: "k" }));
        await webdav.deleteRemoteData();
        expect(server.files.size).toBe(0);
        expect(server.folders.has(FOLDER)).toBe(true);
        // Already gone isn't an error.
        await expect(webdav.deleteRemoteData()).resolves.toBeUndefined();
    });
});
