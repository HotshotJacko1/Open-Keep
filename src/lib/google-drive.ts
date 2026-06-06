// Copyright (c) 2026. Licensed under AGPLv3.
import { Note } from "@/types/note";
import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { encryptData, decryptData } from "@/lib/note-storage";
import { resolveImagesToBase64, restoreImagesFromBase64 } from "@/lib/image-storage";
import { normalizeCloudMasterKeyPayload } from "@/lib/cloud-master-key";

const FOLDER_NAME = "Open Keep Notes";
const NOTES_FILE_NAME = "notes.json";
const ENCRYPTED_KEY_FILE_NAME = "encrypted_master_key.json";

let isInitialized = false;
let globalAccessToken: string | null = null;

const formatDriveError = (error: unknown): string => {
    if (error instanceof Error && error.message) return error.message;
    if (typeof error === "string") return error;
    try {
        return JSON.stringify(error);
    } catch {
        return "Unknown Google Drive error";
    }
};

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
            throw new Error(body || `Google Drive request failed (${response.status})`);
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
        throw new Error(body || `Google Drive request failed (${response.status})`);
    }

    return { status: response.status, body };
};

export const initGoogleDrive = async () => {
    isInitialized = true;
};

export const setAccessToken = (token: string, expiresIn: number = 3600) => {
    globalAccessToken = token;
    if (token) {
        localStorage.setItem("google-access-token", token);
        localStorage.setItem("google-token-expiry", (Date.now() + expiresIn * 1000).toString());
    } else {
        localStorage.removeItem("google-access-token");
        localStorage.removeItem("google-token-expiry");
    }
};

export const hasGoogleAccessToken = () => {
    return getGoogleAccessToken() !== null;
};

export const getGoogleAccessToken = (): string | null => {
    if (globalAccessToken) return globalAccessToken;
    const token = localStorage.getItem("google-access-token");
    const expiry = localStorage.getItem("google-token-expiry");
    if (token && expiry && Date.now() < parseInt(expiry, 10)) {
        globalAccessToken = token;
        return token;
    }
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

/** Returns true when the current token can call the Drive API. */
export const verifyGoogleDriveAccess = async (): Promise<boolean> => {
    try {
        await driveRequest(
            "GET",
            "https://www.googleapis.com/drive/v3/files?pageSize=1&fields=files(id)",
            { headers: getHeaders() }
        );
        return true;
    } catch (error) {
        if (isGoogleDriveScopeError(error)) {
            return false;
        }
        throw error;
    }
};

const getHeaders = () => {
    if (!globalAccessToken) {
        const token = localStorage.getItem("google-access-token");
        const expiry = localStorage.getItem("google-token-expiry");
        if (token && expiry && Date.now() < parseInt(expiry, 10)) {
            globalAccessToken = token;
        } else {
            throw new Error("No access token found");
        }
    }
    return {
        Authorization: `Bearer ${globalAccessToken}`,
        "Content-Type": "application/json",
    };
};

const findFolder = async (): Promise<string | null> => {
    try {
        const q = encodeURIComponent(`mimeType='application/vnd.google-apps.folder' and name='${FOLDER_NAME}' and trashed=false`);
        const { body } = await driveRequest("GET", `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`, {
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

const findNotesFile = async (folderId: string): Promise<string | null> => {
    try {
        const q = encodeURIComponent(`name='${NOTES_FILE_NAME}' and '${folderId}' in parents and trashed=false`);
        const { body } = await driveRequest("GET", `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`, {
            headers: getHeaders(),
        });
        const result = JSON.parse(body);
        const files = result.files;
        return files && files.length > 0 ? files[0].id : null;
    } catch (error: unknown) {
        console.error("Error finding notes file:", formatDriveError(error));
        return null;
    }
};

const findKeyFile = async (folderId: string): Promise<string | null> => {
    try {
        const q = encodeURIComponent(`name='${ENCRYPTED_KEY_FILE_NAME}' and '${folderId}' in parents and trashed=false`);
        const { body } = await driveRequest("GET", `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`, {
            headers: getHeaders(),
        });
        const result = JSON.parse(body);
        const files = result.files;
        return files && files.length > 0 ? files[0].id : null;
    } catch (error: unknown) {
        console.error("Error finding master key file:", formatDriveError(error));
        return null;
    }
};

export const checkGoogleDriveMasterKey = async (): Promise<{ exists: boolean, fileId: string | null, payload: string | null }> => {
    if (!isInitialized) await initGoogleDrive();
    const folderId = await findFolder();
    if (!folderId) return { exists: false, fileId: null, payload: null };
    
    const fileId = await findKeyFile(folderId);
    if (!fileId) return { exists: false, fileId: null, payload: null };

    const payload = await downloadMasterKey(fileId);
    return { exists: true, fileId, payload };
};

const downloadMasterKey = async (fileId: string): Promise<string | null> => {
    try {
        const { body } = await driveRequest("GET", `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
            headers: { Authorization: `Bearer ${globalAccessToken}` },
        });
        return normalizeCloudMasterKeyPayload(body);
    } catch (error: unknown) {
        console.error("Error downloading master key:", formatDriveError(error));
        return null;
    }
};

const downloadNotes = async (fileId: string): Promise<{ notes: Note[], customTags: string[] }> => {
    try {
        const { body: text } = await driveRequest("GET", `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
            headers: { Authorization: `Bearer ${globalAccessToken}` },
        });
        let result: any;
        try {
            result = JSON.parse(text);
        } catch {
            result = text;
        }

        try {
            if (typeof result === 'string') {
                const decryptedText = await decryptData(result);
                result = JSON.parse(decryptedText);
            }
        } catch (e) {
            console.error("Decryption failed", e);
            throw e;
        }

        let parsedNotes: Note[] = [];
        let parsedTags: string[] = [];
        let parsedNoteImages: Record<string, Array<{id: string, data: string}>> = {};

        if (Array.isArray(result)) {
            parsedNotes = result as unknown as Note[];
        } else if (result && typeof result === 'object' && 'notes' in result) {
            parsedNotes = result.notes || [];
            parsedTags = result.customTags || [];
            parsedNoteImages = result.noteImages || {};
        }

        for (const note of parsedNotes) {
            if (parsedNoteImages[note.id] && parsedNoteImages[note.id].length > 0) {
                note.images = await restoreImagesFromBase64(parsedNoteImages[note.id]);
            }
        }

        return { notes: parsedNotes, customTags: parsedTags };
    } catch (error: unknown) {
        console.error("Error downloading notes:", formatDriveError(error));
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
    const accessToken = globalAccessToken;
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
    notes: Note[],
    customTags: string[],
    fileId: string | null
): Promise<void> => {
    // Resolve images
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

    await uploadFileContent(NOTES_FILE_NAME, "application/json", folderId, fileContent, fileId);
};

const uploadMasterKey = async (folderId: string, payload: string, fileId: string | null): Promise<void> => {
    await uploadFileContent(ENCRYPTED_KEY_FILE_NAME, "text/plain", folderId, payload, fileId);
};

export const syncNotesWithDrive = async (
    localNotes: Note[], 
    localCustomTags: string[],
    options?: {
        masterKeyPayload?: string;
        forceResolution?: "local" | "cloud";
    }
): Promise<{ notes: Note[], customTags: string[] }> => {
    if (!isInitialized) await initGoogleDrive();

    let folderId = await findFolder();
    if (!folderId) {
        folderId = await createFolder();
    }

    const { masterKeyPayload, forceResolution } = options || {};

    if (masterKeyPayload) {
        const keyFileId = await findKeyFile(folderId);
        await uploadMasterKey(folderId, masterKeyPayload, keyFileId);
    }

    const fileId = await findNotesFile(folderId);
    
    // If Keep Local, ignore remote notes entirely
    if (forceResolution === "local") {
        if (masterKeyPayload) {
            const keyFileId = await findKeyFile(folderId);
            await uploadMasterKey(folderId, masterKeyPayload, keyFileId);
        }
        await uploadNotes(folderId, localNotes, localCustomTags, fileId);
        return { notes: localNotes, customTags: localCustomTags };
    }

    // If Keep Cloud, download remote notes only (local was wiped before import)
    if (forceResolution === "cloud") {
        if (fileId) {
            const remoteData = await downloadNotes(fileId);
            return { notes: remoteData.notes, customTags: remoteData.customTags };
        }
        return { notes: [], customTags: [] };
    }

    let remoteNotes: Note[] = [];
    let remoteCustomTags: string[] = [];

    if (fileId) {
        try {
            const remoteData = await downloadNotes(fileId);
            remoteNotes = remoteData.notes;
            remoteCustomTags = remoteData.customTags || [];
        } catch (e) {
            console.error("Could not download/parse remote notes, aborting sync to prevent data loss", e);
            throw e;
        }
    }

    // Merge Logic
    const mergedNotesMap = new Map<string, Note>();

    // Add all local notes initially
    localNotes.forEach((note) => mergedNotesMap.set(note.id, note));

    // Merge remote notes
    remoteNotes.forEach((remoteNote) => {
        const localNote = mergedNotesMap.get(remoteNote.id);
        if (!localNote) {
            // Note exists remotely but not locally (new from other device)
            mergedNotesMap.set(remoteNote.id, remoteNote);
        } else {
            // Note exists on both
            if (remoteNote.updatedAt > localNote.updatedAt) {
                // Remote is newer
                mergedNotesMap.set(remoteNote.id, remoteNote);
            }
            // Else keep local (it's newer or same)
        }
    });

    const mergedNotes = Array.from(mergedNotesMap.values());

    // Merge Tags logic (Set union)
    const mergedTags = Array.from(new Set([...localCustomTags, ...remoteCustomTags])).sort();

    // Upload merged data
    await uploadNotes(folderId, mergedNotes, mergedTags, fileId);

    return { notes: mergedNotes, customTags: mergedTags };
};

export const deleteRemoteData = async (): Promise<void> => {
    if (!isInitialized) await initGoogleDrive();

    const token = globalAccessToken;
    if (!token) {
        return;
    }

    const folderId = await findFolder();
    if (folderId) {
        await driveRequest("DELETE", `https://www.googleapis.com/drive/v3/files/${folderId}`, {
            headers: getHeaders(),
        });
    }
};
