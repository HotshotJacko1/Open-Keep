// Copyright (c) 2026. Licensed under AGPLv3.

import { useState, useCallback, useEffect, useMemo } from "react";
import { initDropbox, getAuthenticationUrl, handleAuthRedirect, syncNotesWithDropbox, checkDropboxMasterKey, consumeOAuthState, clearDropboxTokens } from "@/lib/dropbox";
import type { SyncResult } from "@/lib/note-storage";
import { runCloudSync, runOAuthSuccessSync, ForceResolution, clearKeepLocalPending } from "@/lib/cloud-sync-runner";
import { setupDropboxOAuthRedirect } from "@/lib/dropbox-oauth";
import { useCloudSyncState, useLastSynced } from "@/lib/cloud-sync-state";
import { showSuccess, showError } from "@/utils/toast";
import { Browser } from "@capacitor/browser";
import { expectExternalActivity } from "@/lib/app-relock";
import { Capacitor } from "@capacitor/core";

export const useDropbox = () => {
    const isSyncing = useCloudSyncState("dropbox");
    const [lastSynced, setLastSynced] = useLastSynced("dropbox-last-synced");
    const [accessToken, setAccessToken] = useState<string | null>(localStorage.getItem("dropbox-access-token"));

    // Initialize on mount if token exists, and listen for cross-component token updates
    useEffect(() => {
        if (accessToken) {
            initDropbox(accessToken);
        }

        const handleTokenUpdate = () => {
            setAccessToken(localStorage.getItem("dropbox-access-token"));
        };

        window.addEventListener("dropbox-token-updated", handleTokenUpdate);
        return () => window.removeEventListener("dropbox-token-updated", handleTokenUpdate);
    }, [accessToken]);

    // Handle redirect return (web query param + native deep link via shared handler)
    useEffect(() => {
        setupDropboxOAuthRedirect();

        const handleOAuthSuccess = (event: Event) =>
            runOAuthSuccessSync("dropbox", () => {
                const token = (event as CustomEvent<{ token: string }>).detail?.token;
                if (token) {
                    setAccessToken(token);
                }
                // eslint-disable-next-line react-hooks/immutability -- only called asynchronously after render, when doInternalSync is declared
                return doInternalSync(undefined, undefined, undefined, true);
            });

        window.addEventListener("dropbox-oauth-success", handleOAuthSuccess);

        const checkWebCode = async () => {
            const urlParams = new URLSearchParams(window.location.search);
            const code = urlParams.get("code");

            if (code && !accessToken && consumeOAuthState(urlParams.get("state"))) {
                try {
                    window.history.replaceState({}, document.title, window.location.pathname);
                    const token = await handleAuthRedirect(code);
                    setAccessToken(token);
                    window.dispatchEvent(new Event("dropbox-token-updated"));
                    initDropbox(token);
                    showSuccess("Connected to Dropbox!");
                    const syncResult = await doInternalSync();
                    if (syncResult.status === "conflict") {
                        window.dispatchEvent(new CustomEvent("open-sync-conflict", { detail: { service: "dropbox", payload: syncResult.cloudPayload, reason: syncResult.reason } }));
                    }
                } catch (error) {
                    console.error("Dropbox auth error:", error);
                }
            }
        };

        checkWebCode();

        return () => {
            window.removeEventListener("dropbox-oauth-success", handleOAuthSuccess);
        };
    }, [accessToken]);

    const login = useCallback(async () => {
        try {
            const url = await getAuthenticationUrl();
            if (Capacitor.isNativePlatform()) {
                expectExternalActivity();
                await Browser.open({ url: encodeURI(url.toString()) });
            } else {
                window.location.href = encodeURI(url.toString());
            }
        } catch (error: unknown) {
            console.error("Dropbox Login init failed:", error);
            showError(`Failed to start Dropbox login: ${(error as Error | undefined)?.message || error}`);
        }
    }, []);

    const doInternalSync = (forceResolution?: ForceResolution, cloudPayload?: string, providedPin?: string, silent: boolean = false): Promise<SyncResult> =>
        runCloudSync({
            provider: "dropbox",
            label: "Dropbox",
            lastSyncedKey: "dropbox-last-synced",
            successMessage: "Notes synced with Dropbox!",
            failureMessage: "Dropbox sync failed.",
            permissionMessage: "Dropbox didn't grant Open Keep access to its files. Disconnect Dropbox in Settings, then reconnect and allow access.",
            checkMasterKey: checkDropboxMasterKey,
            syncNotes: syncNotesWithDropbox,
            classifyError: (error) => {
                const status = (error as { status?: number })?.status;
                // Dropbox reports a missing OAuth scope as a 401 with a missing_scope summary.
                const summary: string = (error as { error?: { error_summary?: string } })?.error?.error_summary ?? "";
                if (summary.startsWith("missing_scope")) return "permission";
                if (status === 401) return "auth";
                return null;
            },
            // The SDK refreshes expired access tokens itself, so a 401 means the refresh
            // token was revoked (or this is a pre-refresh-token connection) — drop it.
            onAuthError: () => {
                showError("Dropbox session expired. Please reconnect.");
                disconnect();
                return { status: "error", message: "Auth required" };
            },
            onSynced: setLastSynced,
        }, { forceResolution, cloudPayload, providedPin, silent });

    const sync = useCallback(async (forceResolution?: "local" | "cloud" | "merge", cloudPayload?: string, providedPin?: string, silent: boolean = false): Promise<SyncResult> => {
        if (!accessToken) {
            showError("Please connect to Dropbox first.");
            return { status: "error", message: "Not connected" };
        }

        return await doInternalSync(forceResolution, cloudPayload, providedPin, silent);
    }, [accessToken]);

    const disconnect = useCallback(() => {
        setAccessToken(null);
        clearDropboxTokens();
        localStorage.removeItem("dropbox-last-synced");
        clearKeepLocalPending("dropbox");
        setLastSynced(null);
        window.dispatchEvent(new Event("dropbox-token-updated"));
        // Note: We don't revoke token on server here, just forget it locally.
        showSuccess("Disconnected from Dropbox.");
    }, [setLastSynced]);

    // Memoised so the object's identity only changes with its contents;
    // Index.tsx lists it in effect deps.
    return useMemo(() => ({
        login,
        sync,
        disconnect,
        isSyncing,
        lastSynced,
        isConnected: !!accessToken,
        // userEmail is not easily available without another API call, skipping for now or fetching in init
        userEmail: accessToken ? "Dropbox User" : null
    }), [login, sync, disconnect, isSyncing, lastSynced, accessToken]);
};
