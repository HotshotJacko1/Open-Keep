// Copyright (c) 2026. Licensed under AGPLv3.
import { Note } from "@/types/note";
import { encryptData, decryptData } from "@/lib/note-storage";
import { resolveImagesToBase64, restoreImagesFromBase64 } from "@/lib/image-storage";
import { normalizeCloudMasterKeyPayload } from "@/lib/cloud-master-key";
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

const downloadNotes = async (): Promise<{ notes: Note[], customTags: string[] }> => {
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

        for (const note of parsedNotes) {
            if (parsedNoteImages[note.id] && parsedNoteImages[note.id].length > 0) {
                note.images = await restoreImagesFromBase64(parsedNoteImages[note.id]);
            }
        }

        return { notes: parsedNotes, customTags: parsedTags };
    } catch (error: unknown) {
        if (isDropboxNotFound(error)) {
            return { notes: [], customTags: [] };
        }
        console.error("Error downloading notes from Dropbox:", error);
        throw error;
    }
};

const uploadNotes = async (notes: Note[], customTags: string[]) => {
    if (!dbx) throw new Error("Dropbox not initialized");

    const noteImages: Record<string, Array<{id: string, data: string}>> = {};
    for (const note of notes) {
        if (note.images && note.images.length > 0) {
            noteImages[note.id] = await resolveImagesToBase64(note.images);
        }
    }

    let fileContent = JSON.stringify({ notes, customTags, noteImages });

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
    localNotes: Note[], 
    localCustomTags: string[],
    options?: {
        masterKeyPayload?: string;
        forceResolution?: "local" | "cloud";
    }
): Promise<{ notes: Note[], customTags: string[] }> => {
    if (!dbx) throw new Error("Dropbox not initialized");

    const { masterKeyPayload, forceResolution } = options || {};

    // If Keep Local, ignore remote notes entirely
    if (forceResolution === "local") {
        if (localNotes.length === 0) {
            throw new Error("Refusing to overwrite cloud with an empty local set");
        }
        if (masterKeyPayload) {
            await uploadMasterKey(masterKeyPayload);
        }
        await uploadNotes(localNotes, localCustomTags);
        return { notes: localNotes, customTags: localCustomTags };
    }

    // If Keep Cloud, download remote notes only (local was wiped before import)
    if (forceResolution === "cloud") {
        try {
            const remoteData = await downloadNotes();
            return { notes: remoteData.notes, customTags: remoteData.customTags };
        } catch (e: unknown) {
            if (isDropboxNotFound(e)) {
                return { notes: [], customTags: [] };
            }
            throw e;
        }
    }

    let remoteNotes: Note[] = [];
    let remoteCustomTags: string[] = [];
    try {
        const remoteData = await downloadNotes();
        remoteNotes = remoteData.notes;
        remoteCustomTags = remoteData.customTags || [];
    } catch (e) {
        console.error("Could not download/parse remote notes, aborting sync to prevent data loss", e);
        throw e;
    }

    // Merge Logic
    console.log(`[Dropbox Sync] Starting merge. Local notes: ${localNotes.length}, Remote notes: ${remoteNotes.length}`);
    const mergedNotesMap = new Map<string, Note>();

    // Add all local notes initially
    localNotes.forEach((note) => {
        const inRemote = remoteNotes.some(r => r.id === note.id);
        if (!inRemote) {
            console.log(`[Dropbox Sync] Note ${note.id} (${note.title}) only exists locally. Will upload.`);
        }
        mergedNotesMap.set(note.id, note);
    });

    // Merge remote notes
    remoteNotes.forEach((remoteNote) => {
        const localNote = mergedNotesMap.get(remoteNote.id);
        if (!localNote) {
            // Note exists remotely but not locally (new from other device)
            console.log(`[Dropbox Sync] Note ${remoteNote.id} (${remoteNote.title}) only exists remotely. Adding to local.`);
            mergedNotesMap.set(remoteNote.id, remoteNote);
        } else {
            // Note exists on both
            if (remoteNote.updatedAt > localNote.updatedAt) {
                // Remote is newer
                console.log(`[Dropbox Sync] Note ${remoteNote.id} (${remoteNote.title}) exists on both. Remote is newer (${new Date(remoteNote.updatedAt).toISOString()} > ${new Date(localNote.updatedAt).toISOString()}). Overwriting local with remote.`);
                mergedNotesMap.set(remoteNote.id, remoteNote);
            } else if (remoteNote.updatedAt < localNote.updatedAt) {
                console.log(`[Dropbox Sync] Note ${remoteNote.id} (${localNote.title}) exists on both. Local is newer (${new Date(localNote.updatedAt).toISOString()} > ${new Date(remoteNote.updatedAt).toISOString()}). Keeping local.`);
            } else {
                console.log(`[Dropbox Sync] Note ${remoteNote.id} (${localNote.title}) exists on both with same timestamp. Keeping local.`);
            }
            // Else keep local (it's newer or same)
        }
    });

    const mergedNotes = Array.from(mergedNotesMap.values());

    // Merge Tags logic (Set union)
    console.log(`[Dropbox Sync] Merging custom tags. Local tags: ${localCustomTags.length}, Remote tags: ${remoteCustomTags.length}`);
    const mergedTags = Array.from(new Set([...localCustomTags, ...remoteCustomTags])).sort();
    
    localCustomTags.forEach(tag => {
        if (!remoteCustomTags.includes(tag)) {
            console.log(`[Dropbox Sync] Tag '${tag}' only exists locally. Will upload.`);
        }
    });
    
    remoteCustomTags.forEach(tag => {
        if (!localCustomTags.includes(tag)) {
            console.log(`[Dropbox Sync] Tag '${tag}' only exists remotely. Adding to local.`);
        }
    });

    if (masterKeyPayload) {
        await uploadMasterKey(masterKeyPayload);
    }
    await uploadNotes(mergedNotes, mergedTags);

    return { notes: mergedNotes, customTags: mergedTags };
};