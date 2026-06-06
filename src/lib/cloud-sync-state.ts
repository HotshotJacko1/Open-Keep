// Copyright (c) 2026. Licensed under AGPLv3.
import { useEffect, useState } from "react";

export type CloudSyncProvider = "google-drive" | "onedrive" | "dropbox";

const SYNC_STATE_EVENT = "cloud-sync-state-changed";

const syncStateByProvider: Record<CloudSyncProvider, boolean> = {
    "google-drive": false,
    onedrive: false,
    dropbox: false,
};

/** Update syncing state for a provider; broadcast to every hook instance. */
export const setCloudSyncState = (provider: CloudSyncProvider, isSyncing: boolean): void => {
    if (syncStateByProvider[provider] === isSyncing) return;
    syncStateByProvider[provider] = isSyncing;
    window.dispatchEvent(
        new CustomEvent(SYNC_STATE_EVENT, { detail: { provider, isSyncing } })
    );
};

export const getCloudSyncState = (provider: CloudSyncProvider): boolean => {
    return syncStateByProvider[provider];
};

export const isAnyCloudSyncing = (): boolean => {
    return Object.values(syncStateByProvider).some(Boolean);
};

/** Shared syncing flag — all use*Drive/Dropbox hooks subscribe to the same state. */
export const useCloudSyncState = (provider: CloudSyncProvider): boolean => {
    const [isSyncing, setIsSyncing] = useState(() => syncStateByProvider[provider]);

    useEffect(() => {
        const handler = (event: Event) => {
            const { provider: p, isSyncing: syncing } = (event as CustomEvent<{
                provider: CloudSyncProvider;
                isSyncing: boolean;
            }>).detail;
            if (p === provider) {
                setIsSyncing(syncing);
            }
        };

        window.addEventListener(SYNC_STATE_EVENT, handler);
        return () => window.removeEventListener(SYNC_STATE_EVENT, handler);
    }, [provider]);

    return isSyncing;
};
