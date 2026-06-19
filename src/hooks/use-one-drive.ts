// Copyright (c) 2026. Licensed under AGPLv3.

import { useState, useCallback, useEffect } from "react";
import { initOneDrive, loginToOneDrive, syncNotesWithOneDrive, logoutFromOneDrive, checkOneDriveMasterKey, msalInstance } from "@/lib/one-drive";
import { setupOneDriveOAuthRedirect } from "@/lib/one-drive-oauth";
import { loadNotes, saveNote, exportMasterKey, importMasterKey, verifyCloudMasterKeyMatch, wipeDatabaseButKeepKeys, SyncResult } from "@/lib/note-storage";
import { resolveCloudKeyImport, getCloudKeyConflictIfNeeded } from "@/lib/cloud-sync-resolver";
import { setCloudSyncState, useCloudSyncState } from "@/lib/cloud-sync-state";
import { showSuccess, showError } from "@/utils/toast";

let oauthSuccessHandling = false;

export const useOneDrive = () => {
    const isSyncing = useCloudSyncState("onedrive");
    const [lastSynced, setLastSynced] = useState<string | null>(localStorage.getItem("onedrive-last-synced"));
    const [userEmail, setUserEmail] = useState<string | null>(localStorage.getItem("onedrive-user-email"));

    useEffect(() => {
        const handleNotesUpdated = () => {
            setLastSynced(localStorage.getItem("onedrive-last-synced"));
        };
        window.addEventListener("notes-updated", handleNotesUpdated);
        return () => window.removeEventListener("notes-updated", handleNotesUpdated);
    }, []);

    useEffect(() => {
        const handleUserUpdated = () => {
            setUserEmail(localStorage.getItem("onedrive-user-email"));
        };
        window.addEventListener("onedrive-user-updated", handleUserUpdated);
        return () => window.removeEventListener("onedrive-user-updated", handleUserUpdated);
    }, []);

    // Check for active account on load; OAuth deep links handled once app-wide.
    useEffect(() => {
        setupOneDriveOAuthRedirect();

        const handleOAuthSuccess = async (event: Event) => {
            if (oauthSuccessHandling) return;
            oauthSuccessHandling = true;
            try {
                const username = (event as CustomEvent<{ username: string }>).detail?.username;
                if (username) {
                    setUserEmail(username);
                }
                const syncResult = await doInternalSync(undefined, undefined, undefined, true);
                if (syncResult.status === "conflict") {
                    window.dispatchEvent(new CustomEvent("open-sync-conflict", {
                        detail: { service: "onedrive", payload: (syncResult as any).cloudPayload, reason: (syncResult as any).reason },
                    }));
                }
            } finally {
                oauthSuccessHandling = false;
            }
        };

        window.addEventListener("onedrive-oauth-success", handleOAuthSuccess);

        const checkExistingAccount = async () => {
            await initOneDrive();
            const account = msalInstance.getActiveAccount();
            if (account?.username) {
                setUserEmail(account.username);
                localStorage.setItem("onedrive-user-email", account.username);
            }
        };

        checkExistingAccount();

        return () => {
            window.removeEventListener("onedrive-oauth-success", handleOAuthSuccess);
        };
    }, []);

    const login = useCallback(async () => {
        try {
            await loginToOneDrive();
            // In a redirect flow, this will navigate away and reload the application natively
        } catch (error) {
            console.error("OneDrive Login failed:", error);
            showError("Failed to connect to OneDrive.");
        }
    }, []);

    const doInternalSync = async (forceResolution?: "local" | "cloud" | "merge", cloudPayload?: string, providedPin?: string, silent: boolean = false): Promise<SyncResult> => {
        setCloudSyncState("onedrive", true);
        try {
            await initOneDrive();
            const pin = localStorage.getItem("app-passcode");
            if (!pin && localStorage.getItem("app-lock-enabled") === "true") {
                throw new Error("No PIN found. Please set up a PIN in App Lock settings first.");
            }

            const cloudKeyConflict = await getCloudKeyConflictIfNeeded(
                pin,
                forceResolution,
                checkOneDriveMasterKey
            );
            if (cloudKeyConflict) return cloudKeyConflict;

            const keyImport = await resolveCloudKeyImport(forceResolution, cloudPayload, pin, providedPin);
            if (keyImport.ok === false) {
                if (cloudPayload) {
                    return { status: "conflict", cloudPayload, reason: "key_mismatch" };
                }
                return { status: "error", message: keyImport.reason };
            }
            const effectivePin = keyImport.effectivePin || pin;

            let masterKeyPayload: string | undefined;

            if (effectivePin) {
                if (forceResolution === "local" || (!forceResolution)) {
                    masterKeyPayload = await exportMasterKey(effectivePin);
                }

                if (!forceResolution) {
                    const cloudKey = await checkOneDriveMasterKey();
                    if (cloudKey.exists && cloudKey.payload) {
                        const localNotes = await loadNotes();
                        const isMatch = await verifyCloudMasterKeyMatch(cloudKey.payload, effectivePin);
                        const isFirstConnect = !localStorage.getItem("onedrive-last-synced");
                        
                        if (!isMatch) {
                            return { status: "conflict", cloudPayload: cloudKey.payload, reason: "key_mismatch" };
                        }
                        
                        if (localNotes.length === 0) {
                            await wipeDatabaseButKeepKeys();
                            await importMasterKey(cloudKey.payload, effectivePin);
                            masterKeyPayload = undefined;
                        } else if (isFirstConnect) {
                            return { status: "conflict", cloudPayload: cloudKey.payload, reason: "first_connect" };
                        }
                    }
                }
            }

            const localNotes = await loadNotes();
            const localCustomTags = JSON.parse(localStorage.getItem("custom-tags") || "[]");
            const oneDriveForceResolution = forceResolution === "merge" ? undefined : forceResolution;
            const { notes: mergedNotes, customTags: mergedTags } = await syncNotesWithOneDrive(localNotes, localCustomTags, { masterKeyPayload, forceResolution: oneDriveForceResolution });

            await Promise.all(mergedNotes.map(note => saveNote(note)));
            localStorage.setItem("custom-tags", JSON.stringify(mergedTags));
            const now = new Date().toLocaleString();
            localStorage.setItem("onedrive-last-synced", now);
            setLastSynced(now);
            window.dispatchEvent(new Event("notes-updated"));
            if (!silent) {
                showSuccess("Notes synced with OneDrive!");
            }
            return { status: "success" };
        } catch (error) {
            const message = (error as Error).message || "";
            if (!message.includes("Cannot parse synced data")) {
                console.error("OneDrive sync failed:", error);
            }
            if (message.includes("BAD_DECRYPT") || message.includes("Decryption failed") || message.includes("Cannot parse synced data")) {
                if (!silent) showError("Cloud notes could not be decrypted. They may be locked with an old, unknown key.");
                const cloudKey = await checkOneDriveMasterKey();
                if (cloudKey.payload) {
                    return { status: "conflict", cloudPayload: cloudKey.payload, reason: "key_mismatch" };
                }
            }
            if (!silent) showError("OneDrive sync failed. Please reconnect.");
            return { status: "error", message };
        } finally {
            setCloudSyncState("onedrive", false);
        }
    };

    const sync = useCallback(async (forceResolution?: "local" | "cloud" | "merge", cloudPayload?: string, providedPin?: string, silent: boolean = false) => {
        if (!userEmail) {
            showError("Please connect to OneDrive first.");
            return { status: "error", message: "Not connected" };
        }
        return await doInternalSync(forceResolution, cloudPayload, providedPin, silent);
    }, [userEmail]);

    const disconnect = useCallback(async () => {
        await logoutFromOneDrive();
        setUserEmail(null);
        localStorage.removeItem("onedrive-user-email");
        localStorage.removeItem("onedrive-last-synced");
        setLastSynced(null);
        window.dispatchEvent(new Event("onedrive-user-updated"));
        showSuccess("Disconnected from OneDrive.");
    }, []);

    return {
        login,
        sync,
        disconnect,
        isSyncing,
        lastSynced,
        userEmail,
        isConnected: !!userEmail
    };
};


