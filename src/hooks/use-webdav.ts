// Copyright (c) 2026. Licensed under AGPLv3.

import { useState, useCallback, useEffect, useMemo } from "react";
import {
    checkWebDavMasterKey,
    clearWebDavConfig,
    describeWebDavError,
    normalizeFolder,
    normalizeServerUrl,
    probeWebDav,
    readWebDavConfig,
    saveWebDavConfig,
    syncNotesWithWebDav,
    WEBDAV_CONFIG_EVENT,
    WebDavHttpError,
    type WebDavConfig,
} from "@/lib/webdav";
import type { SyncResult } from "@/lib/note-storage";
import { runCloudSync, ForceResolution, clearKeepLocalPending } from "@/lib/cloud-sync-runner";
import { useCloudSyncState, useLastSynced } from "@/lib/cloud-sync-state";
import { showSuccess, showError } from "@/utils/toast";

const LAST_SYNCED_KEY = "webdav-last-synced";

/** What the connect form collects. */
export type WebDavConnectInput = WebDavConfig;

const displayName = (config: WebDavConfig | null): string | null => {
    if (!config) return null;
    try {
        return `${config.username} on ${new URL(config.serverUrl).host}`;
    } catch {
        return config.username;
    }
};

export const useWebDav = () => {
    const isSyncing = useCloudSyncState("webdav");
    const [lastSynced, setLastSynced] = useLastSynced(LAST_SYNCED_KEY);
    const [config, setConfig] = useState<WebDavConfig | null>(readWebDavConfig);

    // Every component that mounts this hook follows connects and disconnects made elsewhere.
    useEffect(() => {
        const handleConfigUpdate = () => setConfig(readWebDavConfig());
        window.addEventListener(WEBDAV_CONFIG_EVENT, handleConfigUpdate);
        return () => window.removeEventListener(WEBDAV_CONFIG_EVENT, handleConfigUpdate);
    }, []);

    // Keeps the address, folder and username for the form; only the password goes.
    const disconnect = useCallback(() => {
        clearWebDavConfig();
        localStorage.removeItem(LAST_SYNCED_KEY);
        clearKeepLocalPending("webdav");
        setLastSynced(null);
        showSuccess("Disconnected from WebDAV.");
    }, [setLastSynced]);

    const doInternalSync = useCallback((forceResolution?: ForceResolution, cloudPayload?: string, providedPin?: string, silent: boolean = false): Promise<SyncResult> =>
        runCloudSync({
            provider: "webdav",
            label: "WebDAV",
            lastSyncedKey: LAST_SYNCED_KEY,
            successMessage: "Notes synced with WebDAV!",
            failureMessage: "WebDAV sync failed.",
            permissionMessage: "Your WebDAV server didn't allow Open Keep to use that folder. Check the account's access to it, then sync again.",
            checkMasterKey: checkWebDavMasterKey,
            syncNotes: syncNotesWithWebDav,
            classifyError: (error) => {
                if (!(error instanceof WebDavHttpError)) return null;
                if (error.status === 401) return "auth";
                if (error.status === 403) return "permission";
                return null;
            },
            describeError: describeWebDavError,
            // A rejected password won't start working on its own, and servers such as
            // Nextcloud throttle an address after repeated failed logins, so stop
            // auto-sync from retrying it: drop the password and ask for it again.
            onAuthError: () => {
                showError("Your WebDAV server rejected the saved password. Please reconnect.");
                clearWebDavConfig();
                localStorage.removeItem(LAST_SYNCED_KEY);
                setLastSynced(null);
                return { status: "error", message: "Auth required" };
            },
            onSynced: setLastSynced,
        }, { forceResolution, cloudPayload, providedPin, silent }), [setLastSynced]);

    /**
     * Checks the details against the server, saves them, and runs the first sync.
     * Returns the sync's result so the caller can show a conflict, or an error
     * (already shown as a toast) when the details didn't work.
     */
    const connect = useCallback(async (input: WebDavConnectInput): Promise<SyncResult> => {
        let candidate: WebDavConfig;
        try {
            candidate = {
                serverUrl: normalizeServerUrl(input.serverUrl),
                folder: normalizeFolder(input.folder),
                username: input.username.trim(),
                password: input.password,
            };
            if (!candidate.username) throw new Error("Enter your WebDAV username.");
            if (!candidate.password) throw new Error("Enter your WebDAV password or app password.");
            await probeWebDav(candidate);
        } catch (error) {
            const message = (error as Error | undefined)?.message || "Couldn't connect to the WebDAV server.";
            showError(message);
            return { status: "error", message };
        }

        saveWebDavConfig(candidate);
        showSuccess("Connected to WebDAV!");
        return doInternalSync();
    }, [doInternalSync]);

    const sync = useCallback(async (forceResolution?: ForceResolution, cloudPayload?: string, providedPin?: string, silent: boolean = false): Promise<SyncResult> => {
        if (!readWebDavConfig()) {
            showError("Please connect to WebDAV first.");
            return { status: "error", message: "Not connected" };
        }
        return doInternalSync(forceResolution, cloudPayload, providedPin, silent);
    }, [doInternalSync]);

    // Memoised so the object's identity only changes with its contents;
    // Index.tsx lists it in effect deps.
    return useMemo(() => ({
        connect,
        sync,
        disconnect,
        isSyncing,
        lastSynced,
        isConnected: !!config,
        userEmail: displayName(config),
    }), [connect, sync, disconnect, isSyncing, lastSynced, config]);
};
