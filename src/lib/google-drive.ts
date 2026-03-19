import { Note } from "@/types/note";
import { gapi } from "gapi-script";
import { Capacitor } from "@capacitor/core";
import { encryptData, decryptData } from "@/lib/note-storage";

const FOLDER_NAME = "Open Keep Notes";
const NOTES_FILE_NAME = "notes.json";
const ENCRYPTED_KEY_FILE_NAME = "encrypted_master_key.json";
const DISCOVERY_DOCS = ["https://www.googleapis.com/discovery/v1/apis/drive/v3/rest"];

let isInitialized = false;

export const initGoogleDrive = async () => {
    if (isInitialized) return;

    try {
        await new Promise<void>((resolve, reject) => {
            gapi.load("client", {
                callback: resolve,
                onerror: reject,
            });
        });

        await gapi.client.init({
            apiKey: import.meta.env.VITE_GOOGLE_API_KEY,
            discoveryDocs: DISCOVERY_DOCS,
        });

        isInitialized = true;
    } catch (error) {
        console.error("Error initializing Google Drive API:", error);
        throw error;
    }
};

export const setAccessToken = (token: string) => {
    gapi.client.setToken({ access_token: token });
};

const findFolder = async (): Promise<string | null> => {
    try {
        const response = await gapi.client.drive.files.list({
            q: `mimeType='application/vnd.google-apps.folder' and name='${FOLDER_NAME}' and trashed=false`,
            fields: "files(id, name)",
        });
        const files = response.result.files;
        return files && files.length > 0 ? files[0].id : null;
    } catch (error: any) {
        console.error("Error finding folder:", error?.result?.error?.message || JSON.stringify(error));
        return null;
    }
};

const createFolder = async (): Promise<string> => {
    try {
        const fileMetadata = {
            name: FOLDER_NAME,
            mimeType: "application/vnd.google-apps.folder",
        };
        const response = await gapi.client.drive.files.create({
            resource: fileMetadata,
            fields: "id",
        });
        return response.result.id;
    } catch (error: any) {
        console.error("Error creating folder:", error?.result?.error?.message || JSON.stringify(error));
        throw error;
    }
};

const findNotesFile = async (folderId: string): Promise<string | null> => {
    try {
        const response = await gapi.client.drive.files.list({
            q: `name='${NOTES_FILE_NAME}' and '${folderId}' in parents and trashed=false`,
            fields: "files(id, name)",
        });
        const files = response.result.files;
        return files && files.length > 0 ? files[0].id : null;
    } catch (error: any) {
        console.error("Error finding notes file:", error?.result?.error?.message || JSON.stringify(error));
        return null;
    }
};

const findKeyFile = async (folderId: string): Promise<string | null> => {
    try {
        const response = await gapi.client.drive.files.list({
            q: `name='${ENCRYPTED_KEY_FILE_NAME}' and '${folderId}' in parents and trashed=false`,
            fields: "files(id, name)",
        });
        const files = response.result.files;
        return files && files.length > 0 ? files[0].id : null;
    } catch (error: any) {
        console.error("Error finding master key file:", error?.result?.error?.message || JSON.stringify(error));
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
        const response = await gapi.client.drive.files.get({
            fileId: fileId,
            alt: "media",
        });
        return typeof response.result === 'string' ? response.result : JSON.stringify(response.result);
    } catch (error: any) {
        console.error("Error downloading master key:", error?.result?.error?.message || JSON.stringify(error));
        return null;
    }
};

const downloadNotes = async (fileId: string): Promise<Note[]> => {
    try {
        const response = await gapi.client.drive.files.get({
            fileId: fileId,
            alt: "media",
        });

        if (Capacitor.isNativePlatform()) {
            try {
                const result = response.result;
                if (Array.isArray(result)) {
                    // Plaintext (legacy or from web)
                    return result as unknown as Note[];
                } else if (typeof result === 'string') {
                    // Attempt decrypt
                    const decryptedText = await decryptData(result);
                    return JSON.parse(decryptedText);
                }
                // If it is an object but NOT array, it might be weird.
                return response.result as unknown as Note[];

            } catch (e) {
                console.error("Decryption failed or content was not encrypted", e);
                // If decryption fails, maybe it IS plaintext but parsed as string? unlikely.
                return [];
            }
        }

        return response.result as unknown as Note[];
    } catch (error: any) {
        console.error("Error downloading notes:", error?.result?.error?.message || JSON.stringify(error));
        return [];
    }
};

const uploadNotes = async (
    folderId: string,
    notes: Note[],
    fileId: string | null
): Promise<void> => {
    let fileContent = JSON.stringify(notes);

    if (Capacitor.isNativePlatform()) {
        try {
            const encrypted = await encryptData(fileContent);
            if (encrypted) {
                // Wrap in JSON string to ensure valid JSON file format
                fileContent = JSON.stringify(encrypted);
            }
        } catch (e) {
            console.error("Encryption failed, aborting upload", e);
            throw e;
        }
    }

    const metadata = {
        name: NOTES_FILE_NAME,
        mimeType: "application/json",
        parents: fileId ? undefined : [folderId],
    };

    const accessToken = gapi.client.getToken()?.access_token;
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
        mimeType: "application/json",
        parents: fileId ? undefined : [folderId],
    };

    const accessToken = gapi.client.getToken()?.access_token;
    if (!accessToken) throw new Error("No access token found");

    const form = new FormData();
    form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
    form.append("file", new Blob([payload], { type: "application/json" }));

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
    options?: {
        masterKeyPayload?: string;
        forceResolution?: "local" | "cloud";
    }
): Promise<Note[]> => {
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
        await uploadNotes(folderId, localNotes, fileId);
        return localNotes;
    }

    let remoteNotes: Note[] = [];

    if (fileId) {
        try {
            remoteNotes = await downloadNotes(fileId);
        } catch (e) {
            console.warn("Could not download/parse remote notes, continuing with empty remote", e);
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

    // Upload merged notes
    await uploadNotes(folderId, mergedNotes, fileId);

    return mergedNotes;
};

export const deleteRemoteData = async (): Promise<void> => {
    if (!isInitialized) await initGoogleDrive();

    // Do not attempt to find or delete remote folder if user is not authenticated
    const token = gapi.client.getToken();
    if (!token) {
        return;
    }

    const folderId = await findFolder();
    if (folderId) {
        await gapi.client.drive.files.delete({ fileId: folderId });
    }
};
