// Copyright (c) 2026. Licensed under AGPLv3.

import { useState, useCallback, useEffect } from "react";
import { initDropbox, getAuthenticationUrl, handleAuthRedirect, syncNotesWithDropbox, checkDropboxMasterKey } from "@/lib/dropbox";
import { loadNotes, saveNote, exportMasterKey, importMasterKey, verifyCloudMasterKeyMatch, wipeDatabaseButKeepKeys, changeEncryptionKey, SyncResult } from "@/lib/note-storage";
import { showSuccess, showError } from "@/utils/toast";
import { Browser } from "@capacitor/browser";
import { App as CapacitorApp } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";

let isAuthenticating = false;

export const useDropbox = () => {
    const [isSyncing, setIsSyncing] = useState(false);
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

    // Handle Redirect Return
    useEffect(() => {
        let listenerHandle: any = null;

        const handleAppUrlOpen = async (event: { url: string }) => {
            if (event.url.includes("openkeep://auth")) {
                await Browser.close();
                const url = new URL(event.url.replace("openkeep://auth", "https://localhost"));
                const code = url.searchParams.get("code");

                if (code && !isAuthenticating) {
                    isAuthenticating = true;
                    try {
                        console.log("Processing Dropbox Auth Code from Deep Link...");
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
                        console.error("Dropbox auth error from deep link:", error);
                        showError("Failed to finalize Dropbox login.");
                    } finally {
                        isAuthenticating = false;
                    }
                }
            }
        };

        const checkCodeAndListen = async () => {
            const urlParams = new URLSearchParams(window.location.search);
            const code = urlParams.get("code");

            if (code && !accessToken) {
                try {
                    // Clean URL
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

            if (Capacitor.isNativePlatform()) {
                listenerHandle = await CapacitorApp.addListener('appUrlOpen', handleAppUrlOpen);
            }
        };

        checkCodeAndListen();

        return () => {
            if (listenerHandle) {
                listenerHandle.remove();
            }
        };
    }, [accessToken]);

    const login = useCallback(async () => {
        try {
            const url = await getAuthenticationUrl();
            if (Capacitor.isNativePlatform()) {
                await Browser.open({ url: url.toString() });
            } else {
                window.location.href = url.toString();
            }
        } catch (error) {
            console.error("Dropbox Login init failed:", error);
            showError("Failed to start Dropbox login.");
        }
    }, []);

    const doInternalSync = async (forceResolution?: "local" | "cloud" | "merge", cloudPayload?: string, providedPin?: string, silent: boolean = false): Promise<SyncResult> => {
        setIsSyncing(true);
        try {
            const pin = localStorage.getItem("app-passcode");
            if (!pin && Capacitor.isNativePlatform()) {
                throw new Error("No PIN found. Please set up a PIN in App Lock settings first.");
            }

            if (forceResolution === "cloud" && cloudPayload && pin) {
                const importPin = providedPin || pin;
                await wipeDatabaseButKeepKeys();
                await importMasterKey(cloudPayload, importPin);
                if (providedPin && providedPin !== pin) {
                    localStorage.setItem("app-passcode", providedPin);
                }
            }

            if (forceResolution === "merge" && cloudPayload && pin && providedPin && providedPin !== pin) {
                await changeEncryptionKey(pin, providedPin);
                await importMasterKey(cloudPayload, providedPin);
                localStorage.setItem("app-passcode", providedPin);
            }

            let masterKeyPayload: string | undefined;

            if (pin && Capacitor.isNativePlatform()) {
                if (forceResolution === "local" || (!forceResolution)) {
                    masterKeyPayload = await exportMasterKey(pin);
                }

                if (!forceResolution) {
                    const cloudKey = await checkDropboxMasterKey();
                    if (cloudKey.exists && cloudKey.payload) {
                        const localNotes = await loadNotes();
                        const isMatch = await verifyCloudMasterKeyMatch(cloudKey.payload, pin);
                        const isFirstConnect = !localStorage.getItem("dropbox-last-synced");
                        
                        if (!isMatch) {
                            return { status: "conflict", cloudPayload: cloudKey.payload, reason: "key_mismatch" };
                        }

                        if (localNotes.length === 0) {
                            await wipeDatabaseButKeepKeys();
                            await importMasterKey(cloudKey.payload, pin);
                            masterKeyPayload = undefined;
                        } else if (isFirstConnect) {
                            return { status: "conflict", cloudPayload: cloudKey.payload, reason: "first_connect" };
                        }
                    }
                }
            }

            const localNotes = await loadNotes();
            const localCustomTags = JSON.parse(localStorage.getItem("custom-tags") || "[]");
            const { notes: mergedNotes, customTags: mergedTags } = await syncNotesWithDropbox(localNotes, localCustomTags, { masterKeyPayload, forceResolution });

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
            console.error("Dropbox sync failed:", error);
            if ((error as any).status === 401) {
                showError("Dropbox session expired. Please reconnect.");
                disconnect();
            } else if ((error as Error).message.includes("BAD_DECRYPT") || (error as Error).message.includes("Decryption failed")) {
                showError("Cloud notes could not be decrypted. They may be locked with an old, unknown key.");
                const cloudKey = await checkDropboxMasterKey();
                if (cloudKey.payload) {
                    return { status: "conflict", cloudPayload: cloudKey.payload, reason: "key_mismatch" };
                }
                return { status: "error", message: (error as Error).message };
            } else {
                showError("Dropbox sync failed.");
            }
            return { status: "error", message: (error as Error).message };
        } finally {
            setIsSyncing(false);
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
