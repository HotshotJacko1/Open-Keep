
import { Note } from "@/types/note";
import { PublicClientApplication, Configuration, PopupRequest } from "@azure/msal-browser";

const CLIENT_ID = import.meta.env.VITE_MICROSOFT_CLIENT_ID;
const FOLDER_NAME = "Open Keep Notes";
const NOTES_FILE_NAME = "notes.json";

// MSAL Configuration
const msalConfig: Configuration = {
    auth: {
        clientId: CLIENT_ID,
        authority: "https://login.microsoftonline.com/common",
        redirectUri: window.location.origin, // Ensure this is registered in Azure Portal
    },
    cache: {
        cacheLocation: "localStorage", // This configures where your cache will be stored
        storeAuthStateInCookie: false, // Set this to "true" if you are having issues on IE11 or Edge
    },
};

export const msalInstance = new PublicClientApplication(msalConfig);

// Initialize MSAL (should be called on app start or component mount)
// For MSAL Browser v2/v3, initialize needs to be called.
export const initOneDrive = async () => {
    if (!msalInstance.getActiveAccount()) {
        await msalInstance.initialize();
        // Attempt to handle redirect promise if we were to use redirects, but we use popup.
        // However, handleRedirectPromise should be called to process the response from redirect flows.
        try {
            await msalInstance.handleRedirectPromise();
        } catch (e) {
            console.error(e);
        }
    }
};

const loginRequest: PopupRequest = {
    scopes: ["User.Read", "Files.ReadWrite.AppFolder"], // App Folder scope or Files.ReadWrite
    // Note: App Folder support in OneDrive/Graph is "Files.ReadWrite.AppFolder" but requires "special/approot" access.
    // Alternatively simplify with Files.ReadWrite and create a named folder in root.
    // Let's use specific named folder in root for better visibility for user (like GDrive impl)
};


export const loginToOneDrive = async () => {
    await initOneDrive();
    try {
        const loginResponse = await msalInstance.loginPopup(loginRequest);
        msalInstance.setActiveAccount(loginResponse.account);
        return loginResponse.account;
    } catch (err) {
        console.error("OneDrive Login failed", err);
        throw err;
    }
};

export const getGraphAccessToken = async () => {
    const account = msalInstance.getActiveAccount();
    if (!account) throw new Error("No active account! Verify a user has been signed in and setActiveAccount has been called.");

    try {
        const response = await msalInstance.acquireTokenSilent({
            ...loginRequest,
            account: account,
        });
        return response.accessToken;
    } catch (error) {
        console.warn("Silent token acquisition failed. Acquiring token using popup", error);
        // Fallback to interaction when silent call fails
        const response = await msalInstance.acquireTokenPopup({
            ...loginRequest,
            account: account,
        });
        return response.accessToken;
    }
};


// --- Graph API Helpers ---

const GRAPH_ENDPOINT = "https://graph.microsoft.com/v1.0";

const callGraphApi = async (endpoint: string, method: string = "GET", body?: any, contentType: string = "application/json") => {
    const accessToken = await getGraphAccessToken();
    const headers: HeadersInit = {
        Authorization: `Bearer ${accessToken}`,
    };

    if (body) {
        headers["Content-Type"] = contentType;
    }

    const options: RequestInit = {
        method,
        headers,
        body: body ? (contentType === "application/json" ? JSON.stringify(body) : body) : undefined,
    };

    const response = await fetch(`${GRAPH_ENDPOINT}${endpoint}`, options);
    if (!response.ok) {
        // Handle 404 specifically for existence checks
        if (response.status === 404) return null;
        const errorText = await response.text();
        throw new Error(`Graph API error ${response.status}: ${errorText}`);
    }

    // Some endpoints return 204 No Content
    if (response.status === 204) return null;

    return response.json();
};

const findFolder = async (): Promise<string | null> => {
    // Search for folder by name in root
    // using OData filter
    const response = await callGraphApi(`/me/drive/root/children?$filter=name eq '${FOLDER_NAME}' and folder ne null`);
    if (response && response.value && response.value.length > 0) {
        return response.value[0].id;
    }
    return null;
};

const createFolder = async (): Promise<string> => {
    const response = await callGraphApi(`/me/drive/root/children`, "POST", {
        name: FOLDER_NAME,
        folder: {},
        "@microsoft.graph.conflictBehavior": "rename"
    });
    return response.id;
};

const findNotesFile = async (folderId: string): Promise<string | null> => {
    const response = await callGraphApi(`/me/drive/items/${folderId}/children?$filter=name eq '${NOTES_FILE_NAME}'`);
    if (response && response.value && response.value.length > 0) {
        return response.value[0].id;
    }
    return null;
};

const downloadNotes = async (fileId: string): Promise<Note[]> => {
    // To get file content, we use /content endpoint which returns raw binary/text
    // callGraphApi helper assumes JSON response, let's make a custom fetch for content
    const accessToken = await getGraphAccessToken();
    const response = await fetch(`${GRAPH_ENDPOINT}/me/drive/items/${fileId}/content`, {
        headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (!response.ok) {
        console.error("Error downloading notes content");
        return [];
    }

    return await response.json();
};

const uploadNotes = async (folderId: string, notes: Note[], fileId: string | null) => {
    // To upload file, we PUT to /content
    // If fileId exists, use it. If not, create in folder.
    // Graph API for small files: PUT /me/drive/items/{parent-id}:/{filename}:/content

    const fileContent = JSON.stringify(notes);
    const accessToken = await getGraphAccessToken();

    const url = fileId
        ? `${GRAPH_ENDPOINT}/me/drive/items/${fileId}/content`
        : `${GRAPH_ENDPOINT}/me/drive/items/${folderId}:/${NOTES_FILE_NAME}:/content`;

    const response = await fetch(url, {
        method: "PUT", // PUT creates or updates
        headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json"
        },
        body: fileContent
    });

    if (!response.ok) {
        throw new Error("Failed to upload notes to OneDrive");
    }
};

export const syncNotesWithOneDrive = async (localNotes: Note[]): Promise<Note[]> => {
    let folderId = await findFolder();
    if (!folderId) {
        folderId = await createFolder();
    }

    const fileId = await findNotesFile(folderId);
    let remoteNotes: Note[] = [];

    if (fileId) {
        remoteNotes = await downloadNotes(fileId);
    }

    // Merge Logic (Reusing same logic as Google Drive for consistency. 
    // Ideally this merge logic should be extracted to a shared util)
    const mergedNotesMap = new Map<string, Note>();

    // Add all local notes initially
    localNotes.forEach((note) => mergedNotesMap.set(note.id, note));

    // Merge remote notes
    remoteNotes.forEach((remoteNote) => {
        const localNote = mergedNotesMap.get(remoteNote.id);
        if (!localNote) {
            // Note exists remotely but not locally
            mergedNotesMap.set(remoteNote.id, remoteNote);
        } else {
            // Note exists on both
            if (remoteNote.updatedAt > localNote.updatedAt) {
                // Remote is newer
                mergedNotesMap.set(remoteNote.id, remoteNote);
            }
        }
    });

    const mergedNotes = Array.from(mergedNotesMap.values());

    // Upload merged notes
    // We pass fileId if we have it, otherwise it creates new (or overwrites at path)
    await uploadNotes(folderId, mergedNotes, fileId);

    return mergedNotes;
};

export const logoutFromOneDrive = async () => {
    // Optional: Clear local cache?
    // msalInstance.logoutPopup(); // This might redirect user to logout page

    // For "disconnect", we usually just clear local tokens. 
    // True logout clears cookies on MS server.
    // Let's just remove the active account.
    const account = msalInstance.getActiveAccount();
    if (account) {
        msalInstance.setActiveAccount(null);
    }
};
