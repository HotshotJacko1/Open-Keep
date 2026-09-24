// Copyright (c) 2026. Licensed under AGPLv3.

import { useState, useCallback, useEffect, useMemo } from "react";
import { InteractionRequiredAuthError } from "@azure/msal-browser";
import { initOneDrive, loginToOneDrive, syncNotesWithOneDrive, logoutFromOneDrive, checkOneDriveMasterKey, msalInstance } from "@/lib/one-drive";
import { setupOneDriveOAuthRedirect } from "@/lib/one-drive-oauth";
import type { SyncResult } from "@/lib/note-storage";
import { runCloudSync, ForceResolution } from "@/lib/cloud-sync-runner";
import { useCloudSyncState } from "@/lib/cloud-sync-state";
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

    const doInternalSync = (forceResolution?: ForceResolution, cloudPayload?: string, providedPin?: string, silent: boolean = false): Promise<SyncResult> =>
        runCloudSync({
            provider: "onedrive",
            label: "OneDrive",
            lastSyncedKey: "onedrive-last-synced",
            successMessage: "Notes synced with OneDrive!",
            failureMessage: "OneDrive sync failed. Please reconnect.",
            permissionMessage: "OneDrive denied Open Keep access to its folder. Disconnect OneDrive in Settings, then reconnect and allow access.",
            prepare: initOneDrive,
            checkMasterKey: checkOneDriveMasterKey,
            syncNotes: syncNotesWithOneDrive,
            classifyError: (error) => {
                // MSAL couldn't get a token silently and the interactive fallback failed too.
                if (error instanceof InteractionRequiredAuthError) return "auth";
                const message = (error as Error)?.message || "";
                if (message.startsWith("No active account")) return "auth";
                // one-drive.ts embeds the Graph status as "Graph API error 401: …" or "… (401): …".
                if (/(Graph API error |\()401\b/.test(message)) return "auth";
                if (/(Graph API error |\()403\b/.test(message) && message.includes("accessDenied")) return "permission";
                return null;
            },
            onSynced: setLastSynced,
        }, { forceResolution, cloudPayload, providedPin, silent });

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

    // Memoised so the object's identity only changes with its contents;
    // Index.tsx lists it in effect deps.
    return useMemo(() => ({
        login,
        sync,
        disconnect,
        isSyncing,
        lastSynced,
        userEmail,
        isConnected: !!userEmail
    }), [login, sync, disconnect, isSyncing, lastSynced, userEmail]);
};


