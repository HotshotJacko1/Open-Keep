// Copyright (c) 2026. Licensed under AGPLv3.

import { PublicClientApplication, Configuration, PopupRequest, NavigationClient, NavigationOptions, LogLevel, InteractionRequiredAuthError, INetworkModule, NetworkRequestOptions, NetworkResponse } from "@azure/msal-browser";
import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { Browser } from "@capacitor/browser";
import { expectExternalActivity } from "@/lib/app-relock";
import { encryptData, decryptData } from "@/lib/note-storage";
import { parseSyncData, serializeSyncData } from "@/lib/sync-data";
import { emptySyncData, isSameSyncData, mergeSyncData, takeSide, type SyncData, type SyncMergeResult, type SyncNotesOptions } from "@/lib/sync-merge";
import { normalizeCloudMasterKeyPayload } from "@/lib/cloud-master-key";

export const CLIENT_ID = import.meta.env.VITE_MICROSOFT_CLIENT_ID;
const FOLDER_NAME = "Open Keep Notes";
const NOTES_FILE_NAME = "notes.json";
const ENCRYPTED_KEY_FILE_NAME = "encrypted_master_key.json";

// MSAL Configuration
export const REDIRECT_URI = Capacitor.isNativePlatform()
    ? "openkeep://auth"
    : (import.meta.env.VITE_ONEDRIVE_REDIRECT_URI || window.location.origin);

class NativeNetworkClient implements INetworkModule {
    async sendGetRequestAsync<T>(url: string, options?: NetworkRequestOptions): Promise<NetworkResponse<T>> {
        const response = await CapacitorHttp.get({
            url: url,
            headers: options?.headers,
        });
        return {
            body: (typeof response.data === 'string' && response.data ? JSON.parse(response.data) : response.data) as T,
            headers: response.headers || {},
            status: response.status,
        };
    }

    async sendPostRequestAsync<T>(url: string, options?: NetworkRequestOptions): Promise<NetworkResponse<T>> {
        const headers = { ...(options?.headers || {}) };
        delete headers["Origin"];
        delete headers["origin"];

        const response = await CapacitorHttp.post({
            url: url,
            headers: headers,
            data: options?.body,
        });

        let body = response.data;
        try {
            if (typeof body === 'string' && body) body = JSON.parse(body);
        } catch {
            // Not JSON -- keep the raw string body.
        }

        return {
            body: body as T,
            headers: response.headers || {},
            status: response.status,
        };
    }
}

const msalConfig: Configuration = {
    auth: {
        clientId: CLIENT_ID,
        authority: "https://login.microsoftonline.com/common",
        redirectUri: REDIRECT_URI, // Ensure this is registered in Azure Portal
        ...(Capacitor.isNativePlatform() ? { navigateToLoginRequestUrl: false } : {}),
    },
    cache: {
        cacheLocation: "localStorage", // This configures where your cache will be stored
        storeAuthStateInCookie: false, // Set this to "true" if you are having issues on IE11 or Edge
    },
    system: {
        ...(Capacitor.isNativePlatform() ? { networkClient: new NativeNetworkClient() } : {}),
        loggerOptions: {
            loggerCallback: (level, message, containsPii) => {
                if (containsPii) return;
                switch (level) {
                    case LogLevel.Error:
                        console.error("[MSAL]", message);
                        break;
                    case LogLevel.Warning:
                        console.warn("[MSAL]", message);
                        break;
                    case LogLevel.Info:
                        console.info("[MSAL]", message);
                        break;
                    case LogLevel.Verbose:
                        console.debug("[MSAL]", message);
                        break;
                }
            },
            logLevel: import.meta.env.DEV ? LogLevel.Verbose : LogLevel.Warning,
        },
    }
};

export const msalInstance = new PublicClientApplication(msalConfig);

// Initialize MSAL (should be called on app start or component mount)
// For MSAL Browser v2/v3, initialize needs to be called.
class CustomNavigationClient extends NavigationClient {
    async navigateExternal(url: string, options: NavigationOptions) {
        if (Capacitor.isNativePlatform()) {
            expectExternalActivity();
            await Browser.open({ url });
            return true;
        } else {
            return super.navigateExternal(url, options);
        }
    }
}

let isInitialized = false;
let initPromise: Promise<void> | null = null;

export const initOneDrive = async () => {
    if (isInitialized) return;
    if (initPromise) return initPromise;
    initPromise = (async () => {
        try {
            await msalInstance.initialize();
            msalInstance.setNavigationClient(new CustomNavigationClient());
        } catch (e) {
            console.warn("MSAL Initialize warn:", e);
        }

        // On web, the OAuth redirect hash is in window.location — handle it once at startup.
        if (!Capacitor.isNativePlatform()) {
            try {
                const response = await msalInstance.handleRedirectPromise();
                if (response?.account) {
                    msalInstance.setActiveAccount(response.account);
                }
            } catch (e) {
                console.error("handleRedirectPromise error:", e);
            }
        } else if (!msalInstance.getActiveAccount()) {
            const accounts = msalInstance.getAllAccounts();
            if (accounts.length > 0) {
                msalInstance.setActiveAccount(accounts[0]);
            }
        }

        isInitialized = true;
    })();
    return initPromise;
};

/** Extract OAuth hash fragment for MSAL (expects `#code=...`, not full deep link URL). */
export const extractOAuthHashFromUrl = (url: string): string => {
    const hashIndex = url.indexOf("#");
    if (hashIndex === -1) return url;
    return url.slice(hashIndex);
};

/** Process an OAuth redirect URL (native deep link). Call separately from init. */
export const handleOneDriveRedirect = async (redirectUrl: string) => {
    await initOneDrive();
    const hash = extractOAuthHashFromUrl(redirectUrl);
    return msalInstance.handleRedirectPromise(hash);
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
        await msalInstance.loginRedirect(loginRequest);
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
        // Only fall back to interactive if it's genuinely an interaction-required error
        if (error instanceof InteractionRequiredAuthError) {
            console.warn("Silent token acquisition requires interaction. Trying popup...", error);
            try {
                const response = await msalInstance.acquireTokenPopup({
                    ...loginRequest,
                    account: account,
                });
                return response.accessToken;
            } catch (popupError) {
                console.error("Popup token acquisition also failed", popupError);
                throw popupError;
            }
        }
        // For other errors (network, config, etc.), surface them directly
        console.error("Silent token acquisition failed with non-interactive error", error);
        throw error;
    }
};


// --- Graph API Helpers ---

const GRAPH_ENDPOINT = "https://graph.microsoft.com/v1.0";

const callGraphApi = async (endpoint: string, method: string = "GET", body?: unknown, contentType: string = "application/json") => {
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
        body: body ? (contentType === "application/json" ? JSON.stringify(body) : (body as BodyInit)) : undefined,
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
    // AppFolder scope uses special/approot implicitly
    return "special/approot";
};

const createFolder = async (): Promise<string> => {
    return "special/approot";
};

const findNotesFile = async (folderId: string): Promise<string | null> => {
    const response = await callGraphApi(`/me/drive/special/approot/children?$filter=name eq '${NOTES_FILE_NAME}'`);
    if (response && response.value && response.value.length > 0) {
        return response.value[0].id;
    }
    return null;
};

const findKeyFile = async (folderId: string): Promise<string | null> => {
    const response = await callGraphApi(`/me/drive/special/approot/children?$filter=name eq '${ENCRYPTED_KEY_FILE_NAME}'`);
    if (response && response.value && response.value.length > 0) {
        return response.value[0].id;
    }
    return null;
};

export const checkOneDriveMasterKey = async (): Promise<{ exists: boolean, fileId: string | null, payload: string | null }> => {
    const folderId = await findFolder();
    if (!folderId) return { exists: false, fileId: null, payload: null };
    
    const fileId = await findKeyFile(folderId);
    if (!fileId) return { exists: false, fileId: null, payload: null };

    const payload = await downloadMasterKey(fileId);
    return { exists: true, fileId, payload };
};

const downloadMasterKey = async (fileId: string): Promise<string | null> => {
    const accessToken = await getGraphAccessToken();
    const response = await fetch(`${GRAPH_ENDPOINT}/me/drive/items/${fileId}/content`, {
        headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(`Failed to download OneDrive master key (${response.status}): ${detail}`);
    }
    const result = await response.json();
    const raw = typeof result === 'string' ? result : JSON.stringify(result);
    return normalizeCloudMasterKeyPayload(raw);
};

const downloadNotes = async (fileId: string): Promise<SyncData> => {
    const accessToken = await getGraphAccessToken();
    const response = await fetch(`${GRAPH_ENDPOINT}/me/drive/items/${fileId}/content`, {
        headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(`Failed to download OneDrive notes (${response.status}): ${detail}`);
    }

    let result = await response.json();

    try {
        if (typeof result === "string") {
            const decryptedText = await decryptData(result);
            try {
                result = JSON.parse(decryptedText);
            } catch (parseError) {
                throw new Error("Cannot parse synced data. Your vault might be locked or the master key does not match.", { cause: parseError });
            }
        }
    } catch (e) {
        console.warn("Could not decrypt OneDrive payload.", e);
        throw e;
    }

    return await parseSyncData(result);
};

const uploadNotes = async (folderId: string, data: SyncData, fileId: string | null) => {
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

    const accessToken = await getGraphAccessToken();

    const url = fileId
        ? `${GRAPH_ENDPOINT}/me/drive/items/${fileId}/content`
        : `${GRAPH_ENDPOINT}/me/drive/special/approot:/${NOTES_FILE_NAME}:/content`;

    const response = await fetch(url, {
        method: "PUT", // PUT creates or updates
        headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json"
        },
        body: fileContent
    });

    if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(`Failed to upload notes to OneDrive (${response.status}): ${detail}`);
    }
};

const uploadMasterKey = async (payload: string, fileId: string | null) => {
    const accessToken = await getGraphAccessToken();

    const url = fileId
        ? `${GRAPH_ENDPOINT}/me/drive/items/${fileId}/content`
        : `${GRAPH_ENDPOINT}/me/drive/special/approot:/${ENCRYPTED_KEY_FILE_NAME}:/content`;

    const response = await fetch(url, {
        method: "PUT",
        headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(`Failed to upload master key to OneDrive (${response.status}): ${detail}`);
    }
};

export const syncNotesWithOneDrive = async (
    local: SyncData,
    { masterKeyPayload, forceResolution, lastSyncStartedAt }: SyncNotesOptions
): Promise<SyncMergeResult> => {
    let folderId = await findFolder();
    if (!folderId) {
        folderId = await createFolder();
    }

    const fileId = await findNotesFile(folderId);

    // If Keep Local, ignore remote notes entirely
    if (forceResolution === "local") {
        if (local.notes.length === 0) {
            throw new Error("Refusing to overwrite cloud with an empty local set");
        }
        if (masterKeyPayload) {
            const keyFileId = await findKeyFile(folderId);
            await uploadMasterKey(masterKeyPayload, keyFileId);
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
        } catch (e) {
            console.error("Could not download/parse remote notes, aborting sync to prevent data loss", e);
            throw e;
        }
    }

    const merged = mergeSyncData({ local, remote, lastSyncStartedAt, now: Date.now(), logTag: "[OneDrive Sync]" });

    // Upload merged data
    if (masterKeyPayload) {
        const keyFileId = await findKeyFile(folderId);
        await uploadMasterKey(masterKeyPayload, keyFileId);
    }
    if (fileId && isSameSyncData(merged, remote)) {
        console.log("[OneDrive Sync] Cloud already up to date, skipping upload");
    } else {
        await uploadNotes(folderId, merged, fileId);
    }

    return merged;
};

/**
 * Deletes the files the app writes (notes + wrapped master key) from the app folder.
 * Silent-token only: this runs inside a destructive reset, where a sign-in popup would
 * be out of place, so an account that needs interaction is left alone (throws).
 */
export const deleteRemoteData = async (): Promise<void> => {
    await initOneDrive();
    const account = msalInstance.getActiveAccount();
    if (!account) return;

    const { accessToken } = await msalInstance.acquireTokenSilent({ ...loginRequest, account });
    for (const name of [NOTES_FILE_NAME, ENCRYPTED_KEY_FILE_NAME]) {
        const response = await fetch(`${GRAPH_ENDPOINT}/me/drive/special/approot:/${name}`, {
            method: "DELETE",
            headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!response.ok && response.status !== 404) {
            const detail = await response.text().catch(() => "");
            throw new Error(`Failed to delete ${name} from OneDrive (${response.status}): ${detail}`);
        }
    }
};

export const logoutFromOneDrive = async () => {
    // "Disconnect" is local-only: we don't redirect to the Microsoft logout page.
    // clearCache() with no account drops every MSAL entry (accounts, id/access/
    // refresh tokens, metadata) from localStorage so nothing outlives the disconnect.
    msalInstance.setActiveAccount(null);
    try {
        await msalInstance.clearCache();
    } catch (e) {
        console.warn("[OneDrive] Failed to clear MSAL cache on disconnect", e);
    }
};
