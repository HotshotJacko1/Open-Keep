import { Note } from "@/types/note";
import { Dropbox, DropboxAuth } from "dropbox";
import { Capacitor } from "@capacitor/core";

const CLIENT_ID = import.meta.env.VITE_DROPBOX_CLIENT_ID;
const FILE_PATH = "/Open Keep Notes/notes.json";

// We need to persist the access token
let dbx: Dropbox | null = null;

export const REDIRECT_URI = Capacitor.isNativePlatform()
    ? "openkeep://auth"
    : window.location.origin;

export const initDropbox = (accessToken?: string) => {
    if (accessToken) {
        dbx = new Dropbox({ accessToken });
    } else if (!dbx) {
        // Initialize without token if needed, but mostly we need token
    }
};

// PKCE Auth Flow Helpers
export const getAuthenticationUrl = async () => {
    const dbxAuth = new DropboxAuth({ clientId: CLIENT_ID });

    console.log("Dropbox Redirect URI:", REDIRECT_URI);

    const authUrl = await dbxAuth.getAuthenticationUrl(
        REDIRECT_URI, // redirect URI
        undefined, // state
        'code', // response_type
        'offline', // tokenAccessType (offline for refresh tokens if needed, but implicit/code flow usually gives us what we need for session)
        undefined, // scope
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
    // Add other properties if needed, e.g., expires_in, refresh_token, token_type
}

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
    const accessToken = (response.result as DropboxAccessTokenResponse).access_token;

    // Refresh token might also be available: response.result.refresh_token
    // For now, let's just use the access token for the session.
    return accessToken;
};


// --- API Helpers ---

const downloadNotes = async (): Promise<Note[]> => {
    if (!dbx) throw new Error("Dropbox not initialized");

    try {
        const response = await dbx.filesDownload({ path: FILE_PATH });
        const blob = (response.result as any).fileBlob;
        const text = await blob.text();
        return JSON.parse(text) as Note[];
    } catch (error: any) {
        // If file not found
        if (error.error && error.error.path && error.error.path['.tag'] === 'not_found') {
            return [];
        }
        console.error("Error downloading notes from Dropbox:", error);
        return [];
    }
};

const uploadNotes = async (notes: Note[]) => {
    if (!dbx) throw new Error("Dropbox not initialized");

    const fileContent = JSON.stringify(notes);

    await dbx.filesUpload({
        path: FILE_PATH,
        contents: fileContent,
        mode: { '.tag': 'overwrite' } // Overwrite existing
    });
};

export const syncNotesWithDropbox = async (localNotes: Note[]): Promise<Note[]> => {
    if (!dbx) throw new Error("Dropbox not initialized");

    const remoteNotes = await downloadNotes();

    // Merge Logic (shared)
    const mergedNotesMap = new Map<string, Note>();

    localNotes.forEach((note) => mergedNotesMap.set(note.id, note));

    remoteNotes.forEach((remoteNote) => {
        const localNote = mergedNotesMap.get(remoteNote.id);
        if (!localNote) {
            mergedNotesMap.set(remoteNote.id, remoteNote);
        } else {
            if (remoteNote.updatedAt > localNote.updatedAt) {
                mergedNotesMap.set(remoteNote.id, remoteNote);
            }
        }
    });

    const mergedNotes = Array.from(mergedNotesMap.values());

    await uploadNotes(mergedNotes);

    return mergedNotes;
};