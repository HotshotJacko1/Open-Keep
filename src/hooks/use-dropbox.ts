
import { useState, useCallback, useEffect, useRef } from "react";
import { initDropbox, getAuthenticationUrl, handleAuthRedirect, syncNotesWithDropbox } from "@/lib/dropbox";
import { loadNotes, saveNote } from "@/lib/note-storage";
import { showSuccess, showError } from "@/utils/toast";
import { Browser } from "@capacitor/browser";
import { App as CapacitorApp } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";

export const useDropbox = () => {
    const [isSyncing, setIsSyncing] = useState(false);
    const [lastSynced, setLastSynced] = useState<string | null>(localStorage.getItem("dropbox-last-synced"));
    const [accessToken, setAccessToken] = useState<string | null>(localStorage.getItem("dropbox-access-token"));

    // Prevent duplicate processing during React Strict Mode
    const isAuthenticating = useRef(false);

    // Initialize on mount if token exists
    useEffect(() => {
        if (accessToken) {
            initDropbox(accessToken);
        }
    }, [accessToken]);

    // Handle Redirect Return
    useEffect(() => {
        let listenerHandle: any = null;

        const handleAppUrlOpen = async (event: { url: string }) => {
            if (event.url.includes("openkeep://auth")) {
                await Browser.close();
                const url = new URL(event.url.replace("openkeep://auth", "https://localhost"));
                const code = url.searchParams.get("code");

                if (code && !isAuthenticating.current) {
                    isAuthenticating.current = true;
                    try {
                        console.log("Processing Dropbox Auth Code from Deep Link...");
                        const token = await handleAuthRedirect(code);
                        setAccessToken(token);
                        localStorage.setItem("dropbox-access-token", token);
                        initDropbox(token);
                        showSuccess("Connected to Dropbox!");
                    } catch (error) {
                        console.error("Dropbox auth error from deep link:", error);
                        showError("Failed to finalize Dropbox login.");
                    } finally {
                        isAuthenticating.current = false;
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
                    initDropbox(token);
                    showSuccess("Connected to Dropbox!");
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

    const sync = useCallback(async () => {
        if (!accessToken) {
            showError("Please connect to Dropbox first.");
            return;
        }

        setIsSyncing(true);
        try {
            const localNotes = await loadNotes();
            const mergedNotes = await syncNotesWithDropbox(localNotes);

            await Promise.all(mergedNotes.map(n => saveNote(n)));
            window.dispatchEvent(new Event("notes-updated"));

            const now = new Date().toLocaleString();
            setLastSynced(now);
            localStorage.setItem("dropbox-last-synced", now);
            showSuccess("Notes synced with Dropbox!");
        } catch (error) {
            console.error("Dropbox sync failed:", error);
            if ((error as any).status === 401) {
                showError("Dropbox session expired. Please reconnect.");
                disconnect();
            } else {
                showError("Dropbox sync failed.");
            }
        } finally {
            setIsSyncing(false);
        }
    }, [accessToken]);

    const disconnect = useCallback(() => {
        setAccessToken(null);
        localStorage.removeItem("dropbox-access-token");
        localStorage.removeItem("dropbox-last-synced");
        setLastSynced(null);
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
