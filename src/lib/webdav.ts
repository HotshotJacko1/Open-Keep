// Copyright (c) 2026. Licensed under AGPLv3.
import { Capacitor, CapacitorHttp, registerPlugin } from "@capacitor/core";
import { encryptData, decryptData } from "@/lib/note-storage";
import { normalizeCloudMasterKeyPayload } from "@/lib/cloud-master-key";
import { parseSyncData, serializeSyncData } from "@/lib/sync-data";
import { configuredWebDavUrl, getRuntimeConfig } from "@/lib/runtime-config";
import { emptySyncData, isSameSyncData, mergeSyncData, takeSide, type SyncData, type SyncMergeResult, type SyncNotesOptions } from "@/lib/sync-merge";

/**
 * WebDAV sync (Nextcloud, ownCloud, Synology, Koofr, rclone serve, Apache...).
 *
 * The same two files as every other provider, in a folder the user picks on their
 * own server. Plain HTTP with Basic auth: GET, PUT and DELETE, plus MKCOL to
 * create the folder. Native builds go through CapacitorHttp, which isn't subject
 * to CORS; the web build uses fetch, so the server must allow this site (CORS)
 * or be served from the same origin. A server set up for CORS has to allow the
 * request headers Authorization, Content-Type, If-Match, If-None-Match and
 * If-Unmodified-Since, the methods GET, PUT, DELETE and MKCOL, and expose ETag.
 *
 * Android's HTTP stack (HttpURLConnection) refuses any method it doesn't know,
 * MKCOL included, so on Android the folder is created by a small native plugin
 * instead (WebDavFolderPlugin.kt).
 */

const NOTES_FILE_NAME = "notes.json";
const ENCRYPTED_KEY_FILE_NAME = "encrypted_master_key.json";

const SERVER_URL_KEY = "webdav-server-url";
const FOLDER_KEY = "webdav-folder";
const USERNAME_KEY = "webdav-username";
const PASSWORD_KEY = "webdav-password";
export const WEBDAV_CONFIG_EVENT = "webdav-config-updated";

export const DEFAULT_WEBDAV_FOLDER = "Open Keep";

/** How many times a sync re-reads and re-merges when another device wrote in between. */
const MAX_SYNC_ATTEMPTS = 3;

export interface WebDavConfig {
    /** The server's WebDAV root, e.g. https://cloud.example.com/remote.php/dav/files/alice/ */
    serverUrl: string;
    /** Folder under serverUrl that holds the app's files. "" means serverUrl itself. */
    folder: string;
    username: string;
    password: string;
}

/** A WebDAV response outside 2xx; `status` lets callers tell auth, permission and not-found apart. */
export class WebDavHttpError extends Error {
    status: number;

    constructor(status: number, message?: string) {
        super(message || `WebDAV request failed (${status})`);
        this.name = "WebDavHttpError";
        this.status = status;
    }
}

/** A conditional write lost to another device's write (412). The sync re-reads and merges again. */
class WebDavPreconditionError extends Error {
    constructor() {
        super("The notes file changed on the server during sync");
        this.name = "WebDavPreconditionError";
    }
}

// --- Config -----------------------------------------------------------------

/**
 * Checks and tidies a server address. Throws a user-facing message when it can't
 * be used. Always returns it with a trailing slash so file names can be appended.
 */
export const normalizeServerUrl = (input: string): string => {
    const trimmed = input.trim();
    if (!trimmed) throw new Error("Enter your server's WebDAV address.");
    let url: URL;
    try {
        url = new URL(trimmed);
    } catch {
        throw new Error("That doesn't look like a web address. It should start with https://");
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") {
        throw new Error("The WebDAV address must start with https://");
    }
    if (url.username || url.password) {
        throw new Error("Put the username and password in their own fields, not in the address.");
    }
    url.hash = "";
    url.search = "";
    if (!url.pathname.endsWith("/")) url.pathname += "/";
    return url.toString();
};

/** "Open Keep/Work" -> ["Open Keep", "Work"]; rejects "..", which would escape the server root. */
export const normalizeFolder = (input: string): string => {
    const segments = input.split("/").map((s) => s.trim()).filter(Boolean);
    if (segments.some((s) => s === "." || s === "..")) {
        throw new Error("The folder name can't contain \".\" or \"..\".");
    }
    return segments.join("/");
};

/** The folder's URL, with a trailing slash. Each folder segment is percent-encoded. */
export const folderUrlFor = (config: Pick<WebDavConfig, "serverUrl" | "folder">): string => {
    const folder = normalizeFolder(config.folder);
    if (!folder) return config.serverUrl;
    return config.serverUrl + folder.split("/").map(encodeURIComponent).join("/") + "/";
};

export const readWebDavConfig = (): WebDavConfig | null => {
    const serverUrl = localStorage.getItem(SERVER_URL_KEY);
    const username = localStorage.getItem(USERNAME_KEY);
    const password = localStorage.getItem(PASSWORD_KEY);
    if (!serverUrl || !username || !password) return null;
    return { serverUrl, folder: localStorage.getItem(FOLDER_KEY) ?? DEFAULT_WEBDAV_FOLDER, username, password };
};

/**
 * What to pre-fill the form with: the last connection's address, folder and
 * username (kept after a disconnect), else what a self-hosted server suggests
 * (lib/runtime-config.ts).
 */
export const readWebDavFormDefaults = (): Omit<WebDavConfig, "password"> => ({
    serverUrl: localStorage.getItem(SERVER_URL_KEY) ?? configuredWebDavUrl() ?? "",
    folder: localStorage.getItem(FOLDER_KEY) ?? getRuntimeConfig().webdavFolder ?? DEFAULT_WEBDAV_FOLDER,
    username: localStorage.getItem(USERNAME_KEY) ?? "",
});

export const saveWebDavConfig = (config: WebDavConfig): void => {
    localStorage.setItem(SERVER_URL_KEY, config.serverUrl);
    localStorage.setItem(FOLDER_KEY, config.folder);
    localStorage.setItem(USERNAME_KEY, config.username);
    localStorage.setItem(PASSWORD_KEY, config.password);
    window.dispatchEvent(new Event(WEBDAV_CONFIG_EVENT));
};

/**
 * Forgets the password, which is what makes the connection usable. The address,
 * folder and username stay to pre-fill the form; `everything` removes them too.
 */
export const clearWebDavConfig = (everything = false): void => {
    localStorage.removeItem(PASSWORD_KEY);
    if (everything) {
        localStorage.removeItem(SERVER_URL_KEY);
        localStorage.removeItem(FOLDER_KEY);
        localStorage.removeItem(USERNAME_KEY);
    }
    window.dispatchEvent(new Event(WEBDAV_CONFIG_EVENT));
};

// --- HTTP -------------------------------------------------------------------

type WebDavMethod = "GET" | "PUT" | "DELETE" | "MKCOL";

/** Android only: MKCOL, which CapacitorHttp can't send there (see the comment at the top). */
interface WebDavFolderPlugin {
    create(options: { url: string; authorization: string }): Promise<{ status: number }>;
}
const WebDavFolder = registerPlugin<WebDavFolderPlugin>("WebDavFolder");

interface WebDavResponse {
    status: number;
    body: string;
    etag: string | null;
    lastModified: string | null;
}

/** Basic auth, UTF-8 encoded so non-ASCII usernames and passwords survive btoa. */
const basicAuth = (username: string, password: string): string => {
    const bytes = new TextEncoder().encode(`${username}:${password}`);
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return `Basic ${btoa(binary)}`;
};

const findHeader = (headers: Record<string, string> | undefined, name: string): string | null => {
    if (!headers) return null;
    const wanted = name.toLowerCase();
    for (const [key, value] of Object.entries(headers)) {
        if (key.toLowerCase() === wanted) return value;
    }
    return null;
};

/**
 * One request. Never throws for an HTTP status: callers decide what each one
 * means. Throws only when the server can't be reached at all.
 */
const webDavRequest = async (
    config: WebDavConfig,
    method: WebDavMethod,
    url: string,
    options: { body?: string; headers?: Record<string, string> } = {}
): Promise<WebDavResponse> => {
    const headers: Record<string, string> = {
        Authorization: basicAuth(config.username, config.password),
        ...options.headers,
    };
    if (options.body !== undefined) {
        // CapacitorHttp on Android writes no body at all without a Content-Type, and
        // with application/json it may re-encode it. Octet-stream is sent as is.
        headers["Content-Type"] = "application/octet-stream";
    }

    if (Capacitor.isNativePlatform()) {
        if (method === "MKCOL" && Capacitor.getPlatform() === "android") {
            const { status } = await WebDavFolder.create({ url, authorization: headers.Authorization });
            return { status, body: "", etag: null, lastModified: null };
        }
        let response;
        try {
            response = await CapacitorHttp.request({
                url,
                method,
                headers,
                data: options.body,
                responseType: "text",
            });
        } catch (error) {
            if (method === "MKCOL") throw error;
            const detail = (error as Error | undefined)?.message;
            throw new Error(`Couldn't reach the WebDAV server.${detail ? ` (${detail})` : ""}`, { cause: error });
        }
        const body = typeof response.data === "string"
            ? response.data
            : response.data != null ? JSON.stringify(response.data) : "";
        return {
            status: response.status,
            body,
            etag: findHeader(response.headers, "etag"),
            lastModified: findHeader(response.headers, "last-modified"),
        };
    }

    let response: Response;
    try {
        response = await fetch(url, {
            method,
            headers,
            body: options.body,
            // Never answer from the browser cache: a stale notes file would undo edits.
            cache: "no-store",
            // Basic auth only. A session cookie from the same server (Nextcloud on the
            // same origin) would make it demand a CSRF token instead.
            credentials: "omit",
        });
    } catch (error) {
        throw new Error(
            "Couldn't reach the WebDAV server. Check the address, and that the server allows requests from this site (CORS).",
            { cause: error }
        );
    }
    return {
        status: response.status,
        body: await response.text(),
        etag: response.headers.get("ETag"),
        // Readable cross-origin without Access-Control-Expose-Headers (a CORS-safelisted header).
        lastModified: response.headers.get("Last-Modified"),
    };
};

const isOk = (status: number) => status >= 200 && status < 300;

/** A strong ETag, usable in If-Match. Weak ones (W/"...") never match a strong comparison, so they're dropped. */
const strongEtag = (etag: string | null): string | null =>
    etag && !etag.startsWith("W/") ? etag : null;

// --- Folder -----------------------------------------------------------------

const missingFolderError = (config: WebDavConfig): Error =>
    new Error(
        `The folder "${normalizeFolder(config.folder) || "/"}" doesn't exist on your WebDAV server. Create it there, then sync again.`
    );

/**
 * Creates the app's folder. Only its last segment: the parent has to exist,
 * as WebDAV doesn't create intermediate folders. When it can't, it explains
 * what to do instead.
 */
const createFolder = async (config: WebDavConfig): Promise<void> => {
    if (!normalizeFolder(config.folder)) throw missingFolderError(config);
    let response: WebDavResponse;
    try {
        response = await webDavRequest(config, "MKCOL", folderUrlFor(config));
    } catch (error) {
        console.warn("[WebDAV] MKCOL failed", error);
        throw missingFolderError(config);
    }
    // 405: it already exists (another device made it in the meantime).
    if (isOk(response.status) || response.status === 405) return;
    if (response.status === 401 || response.status === 403) throw new WebDavHttpError(response.status);
    throw missingFolderError(config);
};

/**
 * PUT that creates the folder and tries again once when the server reports it
 * missing: 409 per RFC 4918, though some servers answer 404.
 */
const putFile = async (
    config: WebDavConfig,
    fileName: string,
    body: string,
    headers?: Record<string, string>
): Promise<void> => {
    const url = folderUrlFor(config) + fileName;
    let response = await webDavRequest(config, "PUT", url, { body, headers });
    if (response.status === 409 || response.status === 404) {
        await createFolder(config);
        response = await webDavRequest(config, "PUT", url, { body, headers });
    }
    if (response.status === 412) throw new WebDavPreconditionError();
    if (!isOk(response.status)) throw new WebDavHttpError(response.status);
};

// --- Files ------------------------------------------------------------------

const requireConfig = (): WebDavConfig => {
    const config = readWebDavConfig();
    if (!config) throw new Error("WebDAV not connected");
    return config;
};

/**
 * Checks the address and credentials before they're saved: reads the cloud key
 * file, which is there (200) or not yet (404). Throws a user-facing message.
 */
export const probeWebDav = async (config: WebDavConfig): Promise<void> => {
    const response = await webDavRequest(config, "GET", folderUrlFor(config) + ENCRYPTED_KEY_FILE_NAME);
    if (isOk(response.status) || response.status === 404) return;
    if (response.status === 401) throw new Error("The server didn't accept that username and password.");
    if (response.status === 403) throw new Error("That account isn't allowed to use this folder.");
    if (response.status === 405 || response.status === 501) {
        throw new Error("That address isn't a WebDAV folder. Check it in your server's settings.");
    }
    throw new Error(`The WebDAV server answered with an error (${response.status}).`);
};

export const checkWebDavMasterKey = async (): Promise<{ exists: boolean; payload: string | null }> => {
    const config = requireConfig();
    const response = await webDavRequest(config, "GET", folderUrlFor(config) + ENCRYPTED_KEY_FILE_NAME);
    if (response.status === 404) return { exists: false, payload: null };
    if (!isOk(response.status)) throw new WebDavHttpError(response.status);
    const parsed = JSON.parse(response.body);
    const payload = typeof parsed === "string" ? parsed : JSON.stringify(parsed);
    return { exists: true, payload: normalizeCloudMasterKeyPayload(payload) };
};

interface RemoteNotes {
    data: SyncData;
    /** False when the file isn't there yet. */
    exists: boolean;
    /** The version that was read, for a conditional write. Null when the server gave none usable. */
    etag: string | null;
    /** The file's Last-Modified, the fallback check when the ETag is weak or missing. */
    lastModified: string | null;
}

const downloadNotes = async (config: WebDavConfig): Promise<RemoteNotes> => {
    const response = await webDavRequest(config, "GET", folderUrlFor(config) + NOTES_FILE_NAME);
    if (response.status === 404) return { data: emptySyncData(), exists: false, etag: null, lastModified: null };
    if (!isOk(response.status)) throw new WebDavHttpError(response.status);

    const text = response.body;
    let result: unknown;
    if (text.startsWith('"') && text.endsWith('"')) {
        const decryptedText = await decryptData(JSON.parse(text));
        try {
            result = JSON.parse(decryptedText);
        } catch (parseError) {
            throw new Error("Cannot parse synced data. Your vault might be locked or the master key does not match.", { cause: parseError });
        }
    } else {
        result = JSON.parse(text);
    }
    return { data: await parseSyncData(result), exists: true, etag: strongEtag(response.etag), lastModified: response.lastModified };
};

/**
 * Writes the notes file. With `basedOn`, only if it's still the version that
 * was read, or still absent (If-None-Match), so a write from another device in
 * between is merged rather than overwritten.
 *
 * The version check is If-Match with the ETag. Many servers only hand out weak
 * ETags (W/"..."), typically because they compress responses, and If-Match
 * never matches those; then it falls back to If-Unmodified-Since with the
 * file's Last-Modified. That's only accurate to the second, so a write from
 * another device in the same second can still be overwritten, as it can with
 * no check at all.
 */
const uploadNotes = async (config: WebDavConfig, data: SyncData, basedOn?: RemoteNotes): Promise<void> => {
    let fileContent = await serializeSyncData(data);
    const encrypted = await encryptData(fileContent);
    if (encrypted && encrypted !== fileContent) {
        // Wrapped in a JSON string, as on every other provider.
        fileContent = JSON.stringify(encrypted);
    }

    const headers: Record<string, string> = {};
    if (basedOn?.exists && basedOn.etag) headers["If-Match"] = basedOn.etag;
    else if (basedOn?.exists && basedOn.lastModified) headers["If-Unmodified-Since"] = basedOn.lastModified;
    else if (basedOn && !basedOn.exists) headers["If-None-Match"] = "*";

    await putFile(config, NOTES_FILE_NAME, fileContent, headers);
};

const uploadMasterKey = async (config: WebDavConfig, payload: string): Promise<void> => {
    await putFile(config, ENCRYPTED_KEY_FILE_NAME, JSON.stringify(payload));
};

/**
 * Deletes the files the app writes (notes + wrapped master key). Leaves the
 * folder, which may be the user's own. No-op when WebDAV isn't connected; a file
 * that is already gone isn't an error.
 */
export const deleteRemoteData = async (): Promise<void> => {
    const config = readWebDavConfig();
    if (!config) return;
    for (const fileName of [NOTES_FILE_NAME, ENCRYPTED_KEY_FILE_NAME]) {
        const response = await webDavRequest(config, "DELETE", folderUrlFor(config) + fileName);
        if (!isOk(response.status) && response.status !== 404) throw new WebDavHttpError(response.status);
    }
};

export const syncNotesWithWebDav = async (
    local: SyncData,
    { masterKeyPayload, forceResolution, lastSyncStartedAt }: SyncNotesOptions
): Promise<SyncMergeResult> => {
    const config = requireConfig();

    if (forceResolution === "local") {
        if (local.notes.length === 0) {
            throw new Error("Refusing to overwrite cloud with an empty local set");
        }
        if (masterKeyPayload) await uploadMasterKey(config, masterKeyPayload);
        await uploadNotes(config, local);
        return takeSide(local);
    }

    if (forceResolution === "cloud") {
        return takeSide((await downloadNotes(config)).data);
    }

    let keyUploaded = false;
    for (let attempt = 1; ; attempt++) {
        let remote: RemoteNotes;
        try {
            remote = await downloadNotes(config);
        } catch (e) {
            console.error("[WebDAV Sync] Could not download/parse remote notes, aborting sync to prevent data loss", e);
            throw e;
        }

        const merged = mergeSyncData({ local, remote: remote.data, lastSyncStartedAt, now: Date.now(), logTag: "[WebDAV Sync]" });

        if (masterKeyPayload && !keyUploaded) {
            await uploadMasterKey(config, masterKeyPayload);
            keyUploaded = true;
        }
        if (isSameSyncData(merged, remote.data)) {
            console.log("[WebDAV Sync] Cloud already up to date, skipping upload");
            return merged;
        }
        try {
            await uploadNotes(config, merged, remote);
            return merged;
        } catch (e) {
            if (e instanceof WebDavPreconditionError && attempt < MAX_SYNC_ATTEMPTS) {
                console.log("[WebDAV Sync] Notes changed on the server during sync, merging again");
                continue;
            }
            throw e;
        }
    }
};

/** A message worth showing the user for errors the generic "sync failed" would hide. */
export const describeWebDavError = (error: unknown): string | null => {
    if (error instanceof WebDavPreconditionError) {
        return "Another device kept changing your notes during sync. Try again in a moment.";
    }
    if (error instanceof WebDavHttpError) {
        if (error.status === 404) return "Couldn't find the folder on your WebDAV server. Check the address and folder.";
        if (error.status === 507) return "Your WebDAV server is out of space.";
        return null;
    }
    const message = (error as Error | undefined)?.message ?? "";
    if (message.startsWith("Couldn't reach the WebDAV server") || message.startsWith("The folder \"")) return message;
    return null;
};
