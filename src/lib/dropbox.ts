// Copyright (c) 2026. Licensed under AGPLv3.
import { encryptData, decryptData } from "@/lib/note-storage";
import { normalizeCloudMasterKeyPayload } from "@/lib/cloud-master-key";
import { parseSyncData, serializeSyncData } from "@/lib/sync-data";
import { emptySyncData, isSameSyncData, mergeSyncData, takeSide, type SyncData, type SyncMergeResult, type SyncNotesOptions } from "@/lib/sync-merge";
import { Dropbox, DropboxAuth } from "dropbox";
import { Capacitor } from "@capacitor/core";

const CLIENT_ID = import.meta.env.VITE_DROPBOX_CLIENT_ID;
const FILE_PATH = "/notes.json";
const ENCRYPTED_KEY_FILE_NAME = "/encrypted_master_key.json";

// We need to persist the access token
let dbx: Dropbox | null = null;

export const REDIRECT_URI = Capacitor.isNativePlatform()
    ? "openkeep://auth"
    : window.location.origin;

const ACCESS_TOKEN_KEY = "dropbox-access-token";
const REFRESH_TOKEN_KEY = "dropbox-refresh-token";
const EXPIRES_AT_KEY = "dropbox-token-expires-at";
const OAUTH_STATE_KEY = "dropbox_oauth_state";

export const initDropbox = (accessToken?: string) => {
    if (accessToken) {
        // With a refresh token the SDK renews the short-lived access token itself
        // before each request. Connections made before refresh tokens were kept
        // have neither value, so they fall back to the bare access token.
        const expiresAt = Number(localStorage.getItem(EXPIRES_AT_KEY));
        const auth = new DropboxAuth({
            clientId: CLIENT_ID,
            accessToken,
            refreshToken: localStorage.getItem(REFRESH_TOKEN_KEY) ?? undefined,
            accessTokenExpiresAt: expiresAt ? new Date(expiresAt) : undefined,
        });
        dbx = new Dropbox({ auth });
    }
};

/** Forget every Dropbox credential stored on this device. */
export const clearDropboxTokens = () => {
    localStorage.removeItem(ACCESS_TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    localStorage.removeItem(EXPIRES_AT_KEY);
    dbx = null;
};

const createOAuthState = (): string => {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
};

/**
 * True only for the redirect of a login this device started. The stored state is
 * single-use, so a replayed or unsolicited openkeep://auth?code=... is rejected.
 */
export const consumeOAuthState = (returnedState: string | null): boolean => {
    const expected = localStorage.getItem(OAUTH_STATE_KEY);
    if (!expected || returnedState !== expected) return false;
    localStorage.removeItem(OAUTH_STATE_KEY);
    return true;
};

// PKCE Auth Flow Helpers
export const getAuthenticationUrl = async () => {
    const dbxAuth = new DropboxAuth({ clientId: CLIENT_ID });

    console.log("Dropbox Redirect URI:", REDIRECT_URI);

    const state = createOAuthState();
    localStorage.setItem(OAUTH_STATE_KEY, state);

    const authUrl = await dbxAuth.getAuthenticationUrl(
        REDIRECT_URI, // redirect URI
        state, // state — checked by consumeOAuthState on the way back
        'code', // response_type
        'offline', // tokenAccessType — returns a refresh token alongside the short-lived access token
        ['account_info.read', 'files.metadata.read', 'files.metadata.write', 'files.content.read', 'files.content.write'], // scope
        undefined, // includeGrantedScopes
        true // usePKCE
    );

    // The SDK stores it in sessionStorage 'code_verifier' by default.
    // On Android, sessionStorage is often cleared when the app activity is destroyed/restarted
    // during the external browser redirect. We MUST persist it in localStorage.
    const verifier = dbxAuth.getCodeVerifier();
    if (verifier) {
        console.log("Persisting Dropbox Code Verifier to localStorage");
        localStorage.setItem("dropbox_code_verifier", verifier);
    }

    return authUrl;
};

interface DropboxAccessTokenResponse {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
}

/** Exchange the redirect's code for tokens, persist them, and return the access token. */
export const handleAuthRedirect = async (code: string) => {
    const dbxAuth = new DropboxAuth({ clientId: CLIENT_ID });

    // Retrieve the persisted code verifier
    const persistedVerifier = localStorage.getItem("dropbox_code_verifier");
    if (persistedVerifier) {
        console.log("Restoring Dropbox Code Verifier from localStorage");
        dbxAuth.setCodeVerifier(persistedVerifier);
        // Clear it after use
        localStorage.removeItem("dropbox_code_verifier");
    }

    // This will read the code_verifier from the auth object and exchange code
    console.log("Dropbox Redirect URI (Token Exchange):", REDIRECT_URI);
    const response = await dbxAuth.getAccessTokenFromCode(REDIRECT_URI, code);
    const { access_token: accessToken, refresh_token: refreshToken, expires_in: expiresIn } =
        response.result as DropboxAccessTokenResponse;

    localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
    if (refreshToken) {
        localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
    } else {
        localStorage.removeItem(REFRESH_TOKEN_KEY);
    }
    if (expiresIn) {
        localStorage.setItem(EXPIRES_AT_KEY, String(Date.now() + expiresIn * 1000));
    } else {
        localStorage.removeItem(EXPIRES_AT_KEY);
    }

    return accessToken;
};


// --- API Helpers ---

// The Dropbox SDK's typings omit the `fileBlob` it attaches to download
// results in the browser.
type DropboxDownloadResult = { fileBlob: Blob };

// The SDK throws a DropboxResponseError whose `error` is the whole parsed response body:
// `{ error_summary: "path/not_found/..", error: { '.tag': 'path', path: { '.tag': 'not_found' } } }`.
// Match on the summary, which is stable across endpoints: download/get_metadata report
// "path/not_found/...", delete reports "path_lookup/not_found/...".
const isDropboxNotFound = (error: unknown): boolean => {
    const summary = (error as { error?: { error_summary?: string } } | null | undefined)?.error?.error_summary ?? "";
    return /^(path|path_lookup)\/not_found/.test(summary);
};

export const checkDropboxMasterKey = async (): Promise<{ exists: boolean, payload: string | null }> => {
    if (!dbx) return { exists: false, payload: null };
    
    try {
        const response = await dbx.filesDownload({ path: ENCRYPTED_KEY_FILE_NAME });
        const blob = (response.result as unknown as DropboxDownloadResult).fileBlob;
        const text = await blob.text();
        const parsed = JSON.parse(text);
        const payload = typeof parsed === "string" ? parsed : JSON.stringify(parsed);
        return { exists: true, payload: normalizeCloudMasterKeyPayload(payload) };
    } catch (error: unknown) {
         if (isDropboxNotFound(error)) {
            return { exists: false, payload: null };
        }
        throw error;
    }
};

const downloadNotes = async (): Promise<SyncData> => {
    if (!dbx) throw new Error("Dropbox not initialized");

    try {
        const response = await dbx.filesDownload({ path: FILE_PATH });
        const blob = (response.result as unknown as DropboxDownloadResult).fileBlob;
        const text = await blob.text();

        let result: unknown;
        try {
            if (text.startsWith('"') && text.endsWith('"')) {
                const parsedString = JSON.parse(text);
                const decryptedText = await decryptData(parsedString);
                try {
                    result = JSON.parse(decryptedText);
                } catch (parseError) {
                    throw new Error("Cannot parse synced data. Your vault might be locked or the master key does not match.", { cause: parseError });
                }
            } else {
                result = JSON.parse(text);
            }
        } catch (e) {
            console.warn("Could not decrypt Dropbox payload.", e);
            throw e;
        }

        return await parseSyncData(result);
    } catch (error: unknown) {
        if (isDropboxNotFound(error)) {
            return emptySyncData();
        }
        console.error("Error downloading notes from Dropbox:", error);
        throw error;
    }
};

const uploadNotes = async (data: SyncData) => {
    if (!dbx) throw new Error("Dropbox not initialized");

    let fileContent = await serializeSyncData(data);

    try {
        const encrypted = await encryptData(fileContent);
        if (encrypted && encrypted !== fileContent) {
            // Wrap in JSON string to ensure valid JSON file format
            fileContent = JSON.stringify(encrypted);
        }
    } catch (e) {
        console.error("Encryption failed, aborting upload", e);
        throw e;
    }

    await dbx.filesUpload({
        path: FILE_PATH,
        contents: fileContent,
        mode: { '.tag': 'overwrite' } // Overwrite existing
    });
};

const uploadMasterKey = async (payload: string) => {
    if (!dbx) throw new Error("Dropbox not initialized");

    await dbx.filesUpload({
        path: ENCRYPTED_KEY_FILE_NAME,
        contents: JSON.stringify(payload),
        mode: { '.tag': 'overwrite' }
    });
};

/**
 * Deletes the files the app writes (notes + wrapped master key) from the app folder.
 * No-op when Dropbox isn't connected; a file that is already gone isn't an error.
 */
export const deleteRemoteData = async (): Promise<void> => {
    if (!dbx) {
        const token = localStorage.getItem(ACCESS_TOKEN_KEY);
        if (!token) return;
        initDropbox(token);
    }
    if (!dbx) return;

    for (const path of [FILE_PATH, ENCRYPTED_KEY_FILE_NAME]) {
        try {
            await dbx.filesDeleteV2({ path });
        } catch (error: unknown) {
            if (!isDropboxNotFound(error)) throw error;
        }
    }
};

export const syncNotesWithDropbox = async (
    local: SyncData,
    { masterKeyPayload, forceResolution, lastSyncStartedAt }: SyncNotesOptions
): Promise<SyncMergeResult> => {
    if (!dbx) throw new Error("Dropbox not initialized");

    // If Keep Local, ignore remote notes entirely
    if (forceResolution === "local") {
        if (local.notes.length === 0) {
            throw new Error("Refusing to overwrite cloud with an empty local set");
        }
        if (masterKeyPayload) {
            await uploadMasterKey(masterKeyPayload);
        }
        await uploadNotes(local);
        return takeSide(local);
    }

    // If Keep Cloud, download remote notes only (local was wiped before import)
    if (forceResolution === "cloud") {
        return takeSide(await downloadNotes());
    }

    let remote: SyncData;
    try {
        remote = await downloadNotes();
    } catch (e) {
        console.error("Could not download/parse remote notes, aborting sync to prevent data loss", e);
        throw e;
    }

    const merged = mergeSyncData({ local, remote, lastSyncStartedAt, now: Date.now(), logTag: "[Dropbox Sync]" });

    if (masterKeyPayload) {
        await uploadMasterKey(masterKeyPayload);
    }
    // A missing file downloads as empty, so this only skips when both sides are empty too.
    if (isSameSyncData(merged, remote)) {
        console.log("[Dropbox Sync] Cloud already up to date, skipping upload");
    } else {
        await uploadNotes(merged);
    }

    return merged;
};