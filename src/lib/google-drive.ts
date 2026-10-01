// Copyright (c) 2026. Licensed under AGPLv3.
import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { encryptData, decryptData } from "@/lib/note-storage";
import { parseSyncData, serializeSyncData } from "@/lib/sync-data";
import { emptySyncData, isSameSyncData, mergeSyncData, takeSide, type SyncData, type SyncMergeResult, type SyncNotesOptions } from "@/lib/sync-merge";
import { normalizeCloudMasterKeyPayload } from "@/lib/cloud-master-key";

const FOLDER_NAME = "Open Keep Notes";
const NOTES_FILE_NAME = "notes.json";
const ENCRYPTED_KEY_FILE_NAME = "encrypted_master_key.json";

let isInitialized = false;
let globalAccessToken: string | null = null;
let globalTokenExpiry: number | null = null;

const formatDriveError = (error: unknown): string => {
    if (error instanceof Error && error.message) return error.message;
    if (typeof error === "string") return error;
    try {
        return JSON.stringify(error);
    } catch {
        return "Unknown Google Drive error";
    }
};

/** Drive request failure carrying the HTTP status, so callers can tell auth (401/403) and not-found (404) errors apart. */
export class GoogleDriveHttpError extends Error {
    status: number;

    constructor(status: number, body: string) {
        super(body || `Google Drive request failed (${status})`);
        this.name = "GoogleDriveHttpError";
        this.status = status;
    }
}

const driveRequest = async (
    method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
    url: string,
    options?: {
        headers?: Record<string, string>;
        body?: string;
    }
): Promise<{ status: number; body: string }> => {
    const headers = options?.headers ?? {};

    if (Capacitor.isNativePlatform()) {
        const response = await CapacitorHttp.request({
            url,
            method,
            headers,
            data: options?.body,
            responseType: "text",
        });

        const body =
            typeof response.data === "string"
                ? response.data
                : response.data != null
                  ? JSON.stringify(response.data)
                  : "";

        if (response.status < 200 || response.status >= 300) {
            throw new GoogleDriveHttpError(response.status, body);
        }

        return { status: response.status, body };
    }

    const response = await fetch(url, {
        method,
        headers,
        body: options?.body,
    });
    const body = await response.text();

    if (!response.ok) {
        throw new GoogleDriveHttpError(response.status, body);
    }

    return { status: response.status, body };
};

export const initGoogleDrive = async () => {
    isInitialized = true;
};

export const setAccessToken = (token: string, expiresIn: number = 3600) => {
    globalAccessToken = token;
    if (token) {
        const expiry = Date.now() + expiresIn * 1000;
        globalTokenExpiry = expiry;
        localStorage.setItem("google-access-token", token);
        localStorage.setItem("google-token-expiry", expiry.toString());
    } else {
        globalTokenExpiry = null;
        localStorage.removeItem("google-access-token");
        localStorage.removeItem("google-token-expiry");
    }
    window.dispatchEvent(new Event("google-token-updated"));
};

export const hasGoogleAccessToken = () => {
    return getGoogleAccessToken() !== null;
};

export const getGoogleAccessToken = (): string | null => {
    if (globalAccessToken && globalTokenExpiry && Date.now() < globalTokenExpiry) {
        return globalAccessToken;
    }
    const token = localStorage.getItem("google-access-token");
    const expiry = localStorage.getItem("google-token-expiry");
    if (token && expiry && Date.now() < parseInt(expiry, 10)) {
        globalAccessToken = token;
        globalTokenExpiry = parseInt(expiry, 10);
        return token;
    }
    globalAccessToken = null;
    globalTokenExpiry = null;
    return null;
};

export const isGoogleDriveScopeError = (error: unknown): boolean => {
    const message = formatDriveError(error);
    return (
        message.includes("ACCESS_TOKEN_SCOPE_INSUFFICIENT") ||
        message.includes("insufficientPermissions") ||
        message.includes("Insufficient Permission")
    );
};

/**
 * True when a Drive request failed because the OAuth token was rejected
 * (expired, revoked, or lacking the Drive scope). Callers should obtain a
 * fresh token and retry the original request once, instead of probing the
 * token with extra requests up-front.
 */
export const isGoogleDriveAuthError = (error: unknown): boolean => {
    if (!(error instanceof Error)) return false;
    const status = error instanceof GoogleDriveHttpError ? error.status : undefined;
    if (status === 401) return true;
    if (status === 403) {
        // Scope/permission failures are worth a fresh-token retry; quota and
        // rate-limit 403s are not.
        return (
            error.message.includes("insufficientPermissions") ||
            error.message.includes("Insufficient Permission") ||
            error.message.includes("ACCESS_TOKEN_SCOPE_INSUFFICIENT")
        );
    }
    // Some paths surface scope problems purely in the response body text.
    return isGoogleDriveScopeError(error);
};

/** True when Drive reported a missing file/folder — typically a stale cached ID. */
export const isGoogleDriveNotFoundError = (error: unknown): boolean => {
    if (!(error instanceof Error)) return false;
    if (error instanceof GoogleDriveHttpError && error.status === 404) return true;
    return error.message.includes("File not found");
};

const getHeaders = () => {
    const token = getGoogleAccessToken();
    if (!token) {
        throw new Error("No access token found");
    }
    return {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
    };
};

const findFolder = async (): Promise<string | null> => {
    try {
        const q = encodeURIComponent(`mimeType='application/vnd.google-apps.folder' and name='${FOLDER_NAME}' and trashed=false`);
        const { body } = await driveRequest("GET", `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&orderBy=modifiedTime%20desc`, {
            headers: getHeaders(),
        });
        const result = JSON.parse(body);
        const files = result.files;
        return files && files.length > 0 ? files[0].id : null;
    } catch (error: unknown) {
        console.error("Error finding folder:", formatDriveError(error));
        throw error;
    }
};

const createFolder = async (): Promise<string> => {
    const fileMetadata = {
        name: FOLDER_NAME,
        mimeType: "application/vnd.google-apps.folder",
    };
    const { body } = await driveRequest("POST", "https://www.googleapis.com/drive/v3/files?fields=id", {
        headers: getHeaders(),
        body: JSON.stringify(fileMetadata),
    });
    const result = JSON.parse(body);
    return result.id;
};

// ---- Folder/file ID caching -------------------------------------------------
// These IDs almost never change; caching them skips two lookup round-trips on
// warm starts. They are re-resolved automatically whenever Drive reports
// not-found for a cached ID.

const FOLDER_ID_CACHE_KEY = "gdrive-folder-id";

const childFileCacheKey = (folderId: string, fileName: string): string =>
    `gdrive-file-${fileName}-${folderId}`;

const getCachedId = (key: string): string | null => localStorage.getItem(key);

const setCachedId = (key: string, id: string | null): void => {
    if (id) {
        localStorage.setItem(key, id);
    } else {
        localStorage.removeItem(key);
    }
};

export const clearCachedDriveIds = (): void => {
    localStorage.removeItem(FOLDER_ID_CACHE_KEY);
    const staleKeys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith("gdrive-file-")) staleKeys.push(key);
    }
    staleKeys.forEach((key) => localStorage.removeItem(key));
};

const resolveFolderId = async (): Promise<string> => {
    const cached = getCachedId(FOLDER_ID_CACHE_KEY);
    if (cached) return cached;

    const folderId = (await findFolder()) ?? (await createFolder());
    setCachedId(FOLDER_ID_CACHE_KEY, folderId);
    return folderId;
};

const findChildFile = async (folderId: string, fileName: string): Promise<string | null> => {
    const cacheKey = childFileCacheKey(folderId, fileName);
    const cached = getCachedId(cacheKey);
    if (cached) return cached;

    try {
        const q = encodeURIComponent(`name='${fileName}' and '${folderId}' in parents and trashed=false`);
        const { body } = await driveRequest("GET", `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&orderBy=modifiedTime%20desc`, {
            headers: getHeaders(),
        });
        const result = JSON.parse(body);
        const files = result.files;
        const fileId: string | null = files && files.length > 0 ? files[0].id : null;
        if (fileId) setCachedId(cacheKey, fileId);
        return fileId;
    } catch (error: unknown) {
        console.error(`Error finding ${fileName}:`, formatDriveError(error));
        throw error;
    }
};

/** Runs a Drive operation; on not-found (stale cached IDs) clears the cache and retries once. */
const withStaleCacheRetry = async <T>(work: () => Promise<T>): Promise<T> => {
    try {
        return await work();
    } catch (error) {
        if (!isGoogleDriveNotFoundError(error)) throw error;
        console.warn("Drive returned not-found — clearing cached folder/file IDs and retrying once");
        clearCachedDriveIds();
        return await work();
    }
};

export const checkGoogleDriveMasterKey = async (): Promise<{ exists: boolean, fileId: string | null, payload: string | null }> => {
    if (!isInitialized) await initGoogleDrive();

    return withStaleCacheRetry(async () => {
        const folderId = await resolveFolderId();
        const fileId = await findChildFile(folderId, ENCRYPTED_KEY_FILE_NAME);
        if (!fileId) return { exists: false, fileId: null, payload: null };

        const payload = await downloadMasterKey(fileId);
        return { exists: true, fileId, payload };
    });
};

const downloadMasterKey = async (fileId: string): Promise<string | null> => {
    try {
        const token = getGoogleAccessToken();
        if (!token) throw new Error("No access token found");
        const { body } = await driveRequest("GET", `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
            headers: { Authorization: `Bearer ${token}` },
        });
        return normalizeCloudMasterKeyPayload(body);
    } catch (error: unknown) {
        // Rethrow rather than returning null: callers read a null payload as
        // "no cloud key" and would upload the local key over the real one.
        console.error("Error downloading master key:", formatDriveError(error));
        throw error;
    }
};

const downloadNotes = async (fileId: string): Promise<SyncData> => {
    try {
        const token = getGoogleAccessToken();
        if (!token) throw new Error("No access token found");
        const { body: text } = await driveRequest("GET", `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
            headers: { Authorization: `Bearer ${token}` },
        });
        let result: unknown;
        try {
            result = JSON.parse(text);
        } catch {
            result = text;
        }

        try {
            if (typeof result === 'string') {
                // Strip whitespace and JSON escape artifacts (\n) before decrypting.
                // Android's Base64.DEFAULT inserts real newlines, which JSON.stringify
                // converts to literal \\n sequences. The regex /\\n/g removes the pair
                // as a unit (keeping any preceding 'n' in the base64 intact).
                const cleaned = result.replace(/\\n/g, '').replace(/\s/g, '');
                const decryptedText = await decryptData(cleaned);
                try {
                    result = JSON.parse(decryptedText);
                } catch (parseError) {
                    throw new Error("Cannot parse synced data. Your vault might be locked or the master key does not match.", { cause: parseError });
                }
            }
        } catch (e) {
            // Backward compatibility: the data might be old JSON-wrapped format,
            // where JSON.stringify(encryptedBase64) was uploaded as "application/json".
            // Try parsing as a JSON string, then decrypt.
            if (typeof result !== 'string') {
                console.error("Decryption failed", e);
                throw e;
            }
            try {
                if (result.startsWith('"') && result.endsWith('"')) {
                    const innerText = JSON.parse(result);
                    if (typeof innerText === 'string') {
                        const cleaned = innerText.replace(/\\n/g, '').replace(/\s/g, '');
                        const decryptedText = await decryptData(cleaned);
                        try {
                            result = JSON.parse(decryptedText);
                        } catch (parseError) {
                            throw new Error("Cannot parse synced data. Your vault might be locked or the master key does not match.", { cause: parseError });
                        }
                    } else {
                        throw e;
                    }
                } else {
                    throw e;
                }
            } catch (innerErr) {
                console.error("Decryption failed", e);
                throw e;
            }
        }

        return await parseSyncData(result);
    } catch (error: unknown) {
        if ((error as Error).message && (error as Error).message.includes("Cannot parse synced data")) {
            // Suppress error log for locked vault
        } else {
            console.error("Error downloading notes:", formatDriveError(error));
        }
        throw error;
    }
};

const uploadFileContent = async (
    fileName: string,
    mimeType: string,
    folderId: string,
    content: string,
    fileId: string | null
): Promise<void> => {
    const accessToken = getGoogleAccessToken();
    if (!accessToken) throw new Error("No access token found");

    if (fileId) {
        await driveRequest(
            "PATCH",
            `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`,
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    "Content-Type": mimeType,
                },
                body: content,
            }
        );
        return;
    }

    const { body } = await driveRequest("POST", "https://www.googleapis.com/drive/v3/files?fields=id", {
        headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            name: fileName,
            mimeType,
            parents: [folderId],
        }),
    });
    const created = JSON.parse(body);
    setCachedId(childFileCacheKey(folderId, fileName), created.id);

    await driveRequest(
        "PATCH",
        `https://www.googleapis.com/upload/drive/v3/files/${created.id}?uploadType=media`,
        {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": mimeType,
            },
            body: content,
        }
    );
};

const uploadNotes = async (
    folderId: string,
    data: SyncData,
    fileId: string | null
): Promise<void> => {
    let fileContent = await serializeSyncData(data);

    try {
        const encrypted = await encryptData(fileContent);
        if (encrypted && encrypted !== fileContent) {
            // Upload the raw encrypted base64 (no JSON wrapper) to avoid
            // JSON double-encoding issues with newlines in base64.
            fileContent = encrypted;
        }
    } catch (e) {
        console.error("Encryption failed, aborting upload", e);
        throw e;
    }

    await uploadFileContent(NOTES_FILE_NAME, "text/plain", folderId, fileContent, fileId);
};

const uploadMasterKey = async (folderId: string, payload: string, fileId: string | null): Promise<void> => {
    await uploadFileContent(ENCRYPTED_KEY_FILE_NAME, "text/plain", folderId, payload, fileId);
};

export const syncNotesWithDrive = async (
    local: SyncData,
    { masterKeyPayload, forceResolution, lastSyncStartedAt }: SyncNotesOptions
): Promise<SyncMergeResult> => {
    if (!isInitialized) await initGoogleDrive();

    return withStaleCacheRetry(async () => {
        const folderId = await resolveFolderId();

        // The two file lookups are independent — run them concurrently.
        const [keyFileId, fileId] = await Promise.all([
            masterKeyPayload ? findChildFile(folderId, ENCRYPTED_KEY_FILE_NAME) : Promise.resolve(null),
            findChildFile(folderId, NOTES_FILE_NAME),
        ]);


        if (masterKeyPayload) {
            await uploadMasterKey(folderId, masterKeyPayload, keyFileId);
        }

        // If Keep Local, ignore remote notes entirely
        if (forceResolution === "local") {
            if (local.notes.length === 0) {
                throw new Error("Refusing to overwrite cloud with an empty local set");
            }
            await uploadNotes(folderId, local, fileId);
            return takeSide(local);
        }

        // If Keep Cloud, download remote notes only (local was wiped before import)
        if (forceResolution === "cloud") {
            return takeSide(fileId ? await downloadNotes(fileId) : emptySyncData());
        }

        let remote = emptySyncData();

        if (fileId) {
            try {
                remote = await downloadNotes(fileId);
            } catch (e: unknown) {
                if ((e as Error).message && (e as Error).message.includes("Cannot parse synced data")) {
                    // Expected when vault is locked, no noisy error
                } else {
                    console.error("Could not download/parse remote notes, aborting sync to prevent data loss", e);
                }
                throw e;
            }
        }

        const merged = mergeSyncData({ local, remote, lastSyncStartedAt, now: Date.now(), logTag: "[Google Drive Sync]" });

        // Upload merged data, unless the cloud already holds exactly this
        if (fileId && isSameSyncData(merged, remote)) {
            console.log("[Google Drive Sync] Cloud already up to date, skipping upload");
        } else {
            await uploadNotes(folderId, merged, fileId);
        }

        return merged;
    });
};

export const deleteRemoteData = async (): Promise<void> => {
    if (!isInitialized) await initGoogleDrive();

    const token = getGoogleAccessToken();
    if (!token) {
        return;
    }

    await withStaleCacheRetry(async () => {
        // Look the folder up fresh: resolveFolderId would create it just to delete from it, and a
        // stale cached ID could make the query below silently match nothing.
        const folderId = await findFolder();
        if (!folderId) {
            clearCachedDriveIds();
            return;
        }

        // Delete only the files the app writes (including any duplicates), never the folder.
        // Under drive.file scope the app can't see files the user added to "Open Keep Notes"
        // themselves, so it can't tell whether the folder is really empty — and deleting the
        // folder would take those files with it.
        const q = encodeURIComponent(
            `'${folderId}' in parents and trashed=false and (name='${NOTES_FILE_NAME}' or name='${ENCRYPTED_KEY_FILE_NAME}')`
        );
        const { body } = await driveRequest("GET", `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)&pageSize=100`, {
            headers: getHeaders(),
        });
        const files: { id: string }[] = JSON.parse(body).files ?? [];
        for (const file of files) {
            await driveRequest("DELETE", `https://www.googleapis.com/drive/v3/files/${file.id}`, {
                headers: getHeaders(),
            });
        }
        clearCachedDriveIds();
    });
};
