// Copyright (c) 2026. Licensed under AGPLv3.
import { deleteRemoteData as deleteGoogleDriveData } from "@/lib/google-drive";
import { deleteRemoteData as deleteDropboxData } from "@/lib/dropbox";
import { deleteRemoteData as deleteOneDriveData } from "@/lib/one-drive";

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
