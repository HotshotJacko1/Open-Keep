// Copyright (c) 2026. Licensed under AGPLv3.

import { useState, useCallback, useEffect, useMemo } from "react";
import { Capacitor } from "@capacitor/core";
import { setupOneDriveOAuthRedirect } from "@/lib/one-drive-oauth";
import type { SyncResult } from "@/lib/note-storage";
import { runCloudSync, runOAuthSuccessSync, ForceResolution, clearKeepLocalPending } from "@/lib/cloud-sync-runner";
import { useCloudSyncState, useLastSynced } from "@/lib/cloud-sync-state";
import { showSuccess, showError } from "@/utils/toast";

// The OneDrive client (MSAL) is a large part of the bundle and most people never
// connect OneDrive, so it's loaded only when OneDrive is actually used.
const loadOneDrive = () => import("@/lib/one-drive");

export const useOneDrive = () => {
    const isSyncing = useCloudSyncState("onedrive");
    const [lastSynced, setLastSynced] = useLastSynced("onedrive-last-synced");
    const [userEmail, setUserEmail] = useState<string | null>(localStorage.getItem("onedrive-user-email"));

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

        const handleOAuthSuccess = (event: Event) =>
            runOAuthSuccessSync("onedrive", () => {
                const username = (event as CustomEvent<{ username: string }>).detail?.username;
                if (username) {
                    setUserEmail(username);
                }
                // eslint-disable-next-line react-hooks/immutability -- only called asynchronously after render, when doInternalSync is declared
                return doInternalSync(undefined, undefined, undefined, true);
            });

        window.addEventListener("onedrive-oauth-success", handleOAuthSuccess);

        const checkExistingAccount = async () => {
            // Native: nothing to restore unless OneDrive was connected. (Web always
            // loads it: MSAL has to process a sign-in redirect in the page URL.)
            if (Capacitor.isNativePlatform() && !localStorage.getItem("onedrive-user-email")) return;
            const { initOneDrive, msalInstance } = await loadOneDrive();
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
            const { loginToOneDrive } = await loadOneDrive();
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
            prepare: async () => (await loadOneDrive()).initOneDrive(),
            checkMasterKey: async () => (await loadOneDrive()).checkOneDriveMasterKey(),
            syncNotes: async (local, options) => (await loadOneDrive()).syncNotesWithOneDrive(local, options),
            classifyError: (error) => {
                // MSAL couldn't get a token silently and the interactive fallback failed too.
                // (Matched by name: importing the class would pull MSAL into the main bundle.)
                if ((error as Error)?.name === "InteractionRequiredAuthError") return "auth";
                const message = (error as Error)?.message || "";
                if (message.startsWith("No active account")) return "auth";
                // one-drive.ts embeds the Graph status as "Graph API error 401: …" or "… (401): …".
                if (/(Graph API error |\()401\b/.test(message)) return "auth";
                if (/(Graph API error |\()403\b/.test(message) && message.includes("accessDenied")) return "permission";
                return null;
            },
            onSynced: setLastSynced,
        }, { forceResolution, cloudPayload, providedPin, silent });

    const sync = useCallback(async (forceResolution?: "local" | "cloud" | "merge", cloudPayload?: string, providedPin?: string, silent: boolean = false): Promise<SyncResult> => {
        if (!userEmail) {
            showError("Please connect to OneDrive first.");
            return { status: "error", message: "Not connected" };
        }
        return await doInternalSync(forceResolution, cloudPayload, providedPin, silent);
    }, [userEmail]);

    const disconnect = useCallback(async () => {
        await (await loadOneDrive()).logoutFromOneDrive();
        setUserEmail(null);
        localStorage.removeItem("onedrive-user-email");
        localStorage.removeItem("onedrive-last-synced");
        clearKeepLocalPending("onedrive");
        setLastSynced(null);
        window.dispatchEvent(new Event("onedrive-user-updated"));
        showSuccess("Disconnected from OneDrive.");
    }, [setLastSynced]);

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


