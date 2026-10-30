// Copyright (c) 2026. Licensed under AGPLv3.
import { clearGoogleDriveSession, deleteRemoteData as deleteGoogleDriveData } from "@/lib/google-drive";
import { clearDropboxTokens, deleteRemoteData as deleteDropboxData } from "@/lib/dropbox";
import { clearGoogleDriveScopeBlock } from "@/lib/google-drive-auth-state";

// Imported on demand so the OneDrive client (MSAL) stays out of the startup bundle.
const deleteOneDriveData = async () => (await import("@/lib/one-drive")).deleteRemoteData();

/**
 * Best-effort removal of the app's files from every cloud provider this device is
 * connected to, for "Reset & Delete All". Each provider is a no-op when it isn't
 * connected; one provider failing doesn't stop the others.
 */
export const deleteAllRemoteData = async (): Promise<void> => {
    const providers = [
        ["Google Drive", deleteGoogleDriveData],
        ["Dropbox", deleteDropboxData],
        ["OneDrive", deleteOneDriveData],
    ] as const;

    const results = await Promise.allSettled(providers.map(([, remove]) => remove()));
    results.forEach((result, i) => {
        if (result.status === "rejected") {
            console.error(`Failed to delete ${providers[i][0]} data or not authenticated`, result.reason);
        }
    });
};

/**
 * Forgets every cloud sign-in on this device, as each provider's disconnect()
 * does, without the hooks or their toasts. Used by the "Forgot PIN" reset
 * (C2-35): a sign-in left behind would let the next sync pull the deleted
 * notes straight back. The native Google sign-in SDK session is not signed
 * out here (that needs the hook's SocialLogin setup); with its refresh token
 * gone the app can't use it without a new interactive sign-in.
 */
export const signOutOfCloudProviders = async (): Promise<void> => {
    clearGoogleDriveSession();
    clearGoogleDriveScopeBlock();
    clearDropboxTokens();
    try {
        const oneDrive = await import("@/lib/one-drive");
        await oneDrive.initOneDrive();
        await oneDrive.logoutFromOneDrive();
    } catch (e) {
        console.warn("Could not clear the OneDrive session", e);
    }
    [
        "last-synced-time",
        "google-user-email",
        "dropbox-last-synced",
        "onedrive-user-email",
        "onedrive-last-synced",
    ].forEach((key) => localStorage.removeItem(key));
};
