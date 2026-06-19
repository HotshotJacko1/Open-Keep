// Copyright (c) 2026. Licensed under AGPLv3.

import { useState, useCallback, useEffect } from "react";
import { initDropbox, getAuthenticationUrl, handleAuthRedirect, syncNotesWithDropbox, checkDropboxMasterKey } from "@/lib/dropbox";
import { loadNotes, saveNote, exportMasterKey, importMasterKey, verifyCloudMasterKeyMatch, wipeDatabaseButKeepKeys, SyncResult } from "@/lib/note-storage";
import { resolveCloudKeyImport, getCloudKeyConflictIfNeeded } from "@/lib/cloud-sync-resolver";
import { setupDropboxOAuthRedirect } from "@/lib/dropbox-oauth";
import { setCloudSyncState, useCloudSyncState } from "@/lib/cloud-sync-state";
import { showSuccess, showError } from "@/utils/toast";
import { Browser } from "@capacitor/browser";
import { Capacitor } from "@capacitor/core";

let oauthSuccessHandling = false;

export const useDropbox = () => {
    const isSyncing = useCloudSyncState("dropbox");
    const [lastSynced, setLastSynced] = useState<string | null>(localStorage.getItem("dropbox-last-synced"));
    const [accessToken, setAccessToken] = useState<string | null>(localStorage.getItem("dropbox-access-token"));

    useEffect(() => {
        const handleNotesUpdated = () => {
            setLastSynced(localStorage.getItem("dropbox-last-synced"));
        };
        window.addEventListener("notes-updated", handleNotesUpdated);
        return () => window.removeEventListener("notes-updated", handleNotesUpdated);
    }, []);

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

        const handleOAuthSuccess = async (event: Event) => {
            if (oauthSuccessHandling) return;
            oauthSuccessHandling = true;
            try {
                const token = (event as CustomEvent<{ token: string }>).detail?.token;
                if (token) {
                    setAccessToken(token);
                }
                const syncResult = await doInternalSync(undefined, undefined, undefined, true);
                if (syncResult.status === "conflict") {
                    window.dispatchEvent(new CustomEvent("open-sync-conflict", {
                        detail: { service: "dropbox", payload: (syncResult as any).cloudPayload, reason: (syncResult as any).reason },
                    }));
                }
            } finally {
                oauthSuccessHandling = false;
            }
        };

        window.addEventListener("dropbox-oauth-success", handleOAuthSuccess);

        const checkWebCode = async () => {
            const urlParams = new URLSearchParams(window.location.search);
            const code = urlParams.get("code");

            if (code && !accessToken) {
                try {
                    window.history.replaceState({}, document.title, window.location.pathname);
                    const token = await handleAuthRedirect(code);
                    setAccessToken(token);
                    localStorage.setItem("dropbox-access-token", token);
                    window.dispatchEvent(new Event("dropbox-token-updated"));
                    initDropbox(token);
                    showSuccess("Connected to Dropbox!");
                    const syncResult = await doInternalSync();
                    if (syncResult.status === "conflict") {
                        window.dispatchEvent(new CustomEvent("open-sync-conflict", { detail: { service: "dropbox", payload: (syncResult as any).cloudPayload, reason: (syncResult as any).reason } }));
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
                await Browser.open({ url: encodeURI(url.toString()) });
            } else {
                window.location.href = encodeURI(url.toString());
            }
        } catch (error: any) {
            console.error("Dropbox Login init failed:", error);
            showError(`Failed to start Dropbox login: ${error?.message || error}`);
        }
    }, []);

    const doInternalSync = async (forceResolution?: "local" | "cloud" | "merge", cloudPayload?: string, providedPin?: string, silent: boolean = false): Promise<SyncResult> => {
        setCloudSyncState("dropbox", true);
        try {
            const pin = localStorage.getItem("app-passcode");
            if (!pin && localStorage.getItem("app-lock-enabled") === "true") {
                throw new Error("No PIN found. Please set up a PIN in App Lock settings first.");
            }

            const cloudKeyConflict = await getCloudKeyConflictIfNeeded(
                pin,
                forceResolution,
                checkDropboxMasterKey
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
                    const cloudKey = await checkDropboxMasterKey();
                    if (cloudKey.exists && cloudKey.payload) {
                        const localNotes = await loadNotes();
                        const isMatch = await verifyCloudMasterKeyMatch(cloudKey.payload, effectivePin);
                        const isFirstConnect = !localStorage.getItem("dropbox-last-synced");
                        
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
            const dropboxForceResolution = forceResolution === "merge" ? undefined : forceResolution;
            const { notes: mergedNotes, customTags: mergedTags } = await syncNotesWithDropbox(localNotes, localCustomTags, { masterKeyPayload, forceResolution: dropboxForceResolution });

            await Promise.all(mergedNotes.map(note => saveNote(note)));
            localStorage.setItem("custom-tags", JSON.stringify(mergedTags));
            const now = new Date().toLocaleString();
            localStorage.setItem("dropbox-last-synced", now);
            setLastSynced(now);
            window.dispatchEvent(new Event("notes-updated"));
            if (!silent) {
                showSuccess("Notes synced with Dropbox!");
            }
            return { status: "success" };
        } catch (error) {
            const message = (error as Error).message || "";
            if (!message.includes("Cannot parse synced data")) {
                console.error("Dropbox sync failed:", error);
            }
            if ((error as any).status === 401) {
                showError("Dropbox session expired. Please reconnect.");
                disconnect();
            } else if (message.includes("BAD_DECRYPT") || message.includes("Decryption failed") || message.includes("Cannot parse synced data")) {
                if (!silent) showError("Cloud notes could not be decrypted. They may be locked with an old, unknown key.");
                const cloudKey = await checkDropboxMasterKey();
                if (cloudKey.payload) {
                    return { status: "conflict", cloudPayload: cloudKey.payload, reason: "key_mismatch" };
                }
                return { status: "error", message };
            } else {
                if (!silent) showError("Dropbox sync failed.");
            }
            return { status: "error", message };
        } finally {
            setCloudSyncState("dropbox", false);
        }
    };

    const sync = useCallback(async (forceResolution?: "local" | "cloud" | "merge", cloudPayload?: string, providedPin?: string, silent: boolean = false) => {
        if (!accessToken) {
            showError("Please connect to Dropbox first.");
            return { status: "error", message: "Not connected" };
        }

        return await doInternalSync(forceResolution, cloudPayload, providedPin, silent);
    }, [accessToken]);

    const disconnect = useCallback(() => {
        setAccessToken(null);
        localStorage.removeItem("dropbox-access-token");
        localStorage.removeItem("dropbox-last-synced");
        setLastSynced(null);
        window.dispatchEvent(new Event("dropbox-token-updated"));
        // Note: We don't revoke token on server here, just forget it locally.
        showSuccess("Disconnected from Dropbox.");
    }, []);

    return {
        login,
        sync,
        disconnect,
        isSyncing,
        lastSynced,
        isConnected: !!accessToken,
        // userEmail is not easily available without another API call, skipping for now or fetching in init
        userEmail: accessToken ? "Dropbox User" : null
    };
};
