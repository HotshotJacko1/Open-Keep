// Copyright (c) 2026. Licensed under AGPLv3.
import { Note } from "@/types/note";
import { Capacitor } from "@capacitor/core";
import { encryptData, decryptData } from "@/lib/note-storage";
import { resolveImagesToBase64, restoreImagesFromBase64 } from "@/lib/image-storage";

const FOLDER_NAME = "Open Keep Notes";
const NOTES_FILE_NAME = "notes.json";
const ENCRYPTED_KEY_FILE_NAME = "encrypted_master_key.json";

let isInitialized = false;
let globalAccessToken: string | null = null;

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
    if (globalAccessToken) return true;
    const token = localStorage.getItem("google-access-token");
    const expiry = localStorage.getItem("google-token-expiry");
    if (token && expiry && Date.now() < parseInt(expiry, 10)) {
        globalAccessToken = token;
        return true;
    }
    return false;
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
        const response = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`, {
            headers: getHeaders(),
        });
        if (!response.ok) throw new Error(await response.text());
        const result = await response.json();
        const files = result.files;
        return files && files.length > 0 ? files[0].id : null;
    } catch (error: any) {
        console.error("Error finding folder:", error);
        return null;
    }
};

const createFolder = async (): Promise<string> => {
    try {
        const fileMetadata = {
            name: FOLDER_NAME,
            mimeType: "application/vnd.google-apps.folder",
        };
        const response = await fetch("https://www.googleapis.com/drive/v3/files?fields=id", {
            method: "POST",
            headers: getHeaders(),
            body: JSON.stringify(fileMetadata),
        });
        if (!response.ok) throw new Error(await response.text());
        const result = await response.json();
        return result.id;
    } catch (error: any) {
        console.error("Error creating folder:", error);
        throw error;
    }
};

const findNotesFile = async (folderId: string): Promise<string | null> => {
    try {
        const q = encodeURIComponent(`name='${NOTES_FILE_NAME}' and '${folderId}' in parents and trashed=false`);
        const response = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`, {
            headers: getHeaders(),
        });
        if (!response.ok) throw new Error(await response.text());
        const result = await response.json();
        const files = result.files;
        return files && files.length > 0 ? files[0].id : null;
    } catch (error: any) {
        console.error("Error finding notes file:", error);
        return null;
    }
};

const findKeyFile = async (folderId: string): Promise<string | null> => {
    try {
        const q = encodeURIComponent(`name='${ENCRYPTED_KEY_FILE_NAME}' and '${folderId}' in parents and trashed=false`);
        const response = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`, {
            headers: getHeaders(),
        });
        if (!response.ok) throw new Error(await response.text());
        const result = await response.json();
        const files = result.files;
        return files && files.length > 0 ? files[0].id : null;
    } catch (error: any) {
        console.error("Error finding master key file:", error);
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
        const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
            headers: { Authorization: `Bearer ${globalAccessToken}` },
        });
        if (!response.ok) throw new Error(await response.text());
        const text = await response.text();
        return text;
    } catch (error: any) {
        console.error("Error downloading master key:", error);
        return null;
    }
};

const downloadNotes = async (fileId: string): Promise<{ notes: Note[], customTags: string[] }> => {
    try {
        const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
            headers: { Authorization: `Bearer ${globalAccessToken}` },
        });
        if (!response.ok) throw new Error(await response.text());
        
        const text = await response.text();
        let result: any;
        try {
            result = JSON.parse(text);
        } catch {
            result = text;
        }

        try {
            if (typeof result === 'string') {
                // Attempt decrypt
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
            // Legacy format: just an array of notes
            parsedNotes = result as unknown as Note[];
        } else if (result && typeof result === 'object' && 'notes' in result) {
            // New format: { notes: Note[], customTags: string[] }
            parsedNotes = result.notes || [];
            parsedTags = result.customTags || [];
            parsedNoteImages = result.noteImages || {};
        }

        // Restore images
        for (const note of parsedNotes) {
            if (parsedNoteImages[note.id] && parsedNoteImages[note.id].length > 0) {
                note.images = await restoreImagesFromBase64(parsedNoteImages[note.id]);
            }
        }

        return { notes: parsedNotes, customTags: parsedTags };
    } catch (error: any) {
        console.error("Error downloading notes:", error);
        return { notes: [], customTags: [] };
    }
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

    const metadata = {
        name: NOTES_FILE_NAME,
        mimeType: "application/json",
        parents: fileId ? undefined : [folderId],
    };

    const accessToken = globalAccessToken;
    if (!accessToken) throw new Error("No access token found");

    const form = new FormData();
    form.append(
        "metadata",
        new Blob([JSON.stringify(metadata)], { type: "application/json" })
    );
    form.append(
        "file",
        new Blob([fileContent], { type: "application/json" })
    );

    const url = fileId
        ? `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart`
        : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart`;

    const method = fileId ? "PATCH" : "POST";

    const response = await fetch(url, {
        method,
        headers: { Authorization: `Bearer ${accessToken}` },
        body: form,
    });

    if (!response.ok) {
        throw new Error(`Upload failed: ${response.statusText}`);
    }
};

const uploadMasterKey = async (folderId: string, payload: string, fileId: string | null): Promise<void> => {
    const metadata = {
        name: ENCRYPTED_KEY_FILE_NAME,
        mimeType: "text/plain",
        parents: fileId ? undefined : [folderId],
    };

    const accessToken = globalAccessToken;
    if (!accessToken) throw new Error("No access token found");

    const form = new FormData();
    form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
    form.append("file", new Blob([payload], { type: "text/plain" }));

    const url = fileId
        ? `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart`
        : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart`;
    const method = fileId ? "PATCH" : "POST";

    const response = await fetch(url, {
        method,
        headers: { Authorization: `Bearer ${accessToken}` },
        body: form,
    });

    if (!response.ok) {
        throw new Error(`Master key upload failed: ${response.statusText}`);
    }
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
        await fetch(`https://www.googleapis.com/drive/v3/files/${folderId}`, {
            method: "DELETE",
            headers: getHeaders(),
        });
    }
};
