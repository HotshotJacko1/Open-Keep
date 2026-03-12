
import { useState, useCallback, useEffect } from "react";
import { initOneDrive, loginToOneDrive, syncNotesWithOneDrive, logoutFromOneDrive, msalInstance } from "@/lib/one-drive";
import { loadNotes, saveNote } from "@/lib/note-storage";
import { showSuccess, showError } from "@/utils/toast";
import { App as CapacitorApp } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { Capacitor } from "@capacitor/core";

export const useOneDrive = () => {
    const [isSyncing, setIsSyncing] = useState(false);
    const [lastSynced, setLastSynced] = useState<string | null>(localStorage.getItem("onedrive-last-synced"));
    const [userEmail, setUserEmail] = useState<string | null>(localStorage.getItem("onedrive-user-email"));

    useEffect(() => {
        const handleNotesUpdated = () => {
            setLastSynced(localStorage.getItem("onedrive-last-synced"));
        };
        window.addEventListener("notes-updated", handleNotesUpdated);
        return () => window.removeEventListener("notes-updated", handleNotesUpdated);
    }, []);

    // Check for active account on load and setup Deep Link Listener
    useEffect(() => {
        let listenerHandle: any = null;

        const handleAppUrlOpen = async (event: { url: string }) => {
            if (event.url.includes("openkeep://auth")) {
                await Browser.close();
                try {
                    await initOneDrive();
                    // MSAL handleRedirectPromise expects the hash string, not the full URL
                    const hashIndex = event.url.indexOf("#");
                    const hash = hashIndex !== -1 ? event.url.substring(hashIndex) : "";

                    const response = await msalInstance.handleRedirectPromise(hash);
                    if (response && response.account) {
                        msalInstance.setActiveAccount(response.account);
                        setUserEmail(response.account.username);
                        localStorage.setItem("onedrive-user-email", response.account.username);
                        showSuccess(`Connected to OneDrive as ${response.account.username}`);
                        await doInternalSync();
                    }
                } catch (e) {
                    console.error("handleRedirectPromise deep link error:", e);
                    showError("Failed to finalize OneDrive login.");
                }
            }
        };

        const checkAccountAndListen = async () => {
            await initOneDrive();
            const account = msalInstance.getActiveAccount();
            if (account && account.username) {
                const isNewLogin = localStorage.getItem("onedrive-user-email") !== account.username;

                setUserEmail(account.username);
                localStorage.setItem("onedrive-user-email", account.username);

                if (isNewLogin) {
                    showSuccess(`Connected to OneDrive as ${account.username}`);
                    // Trigger sync on first successful connection
                    await doInternalSync();
                }
            }

            if (Capacitor.isNativePlatform()) {
                listenerHandle = await CapacitorApp.addListener('appUrlOpen', handleAppUrlOpen);
            }
        };

        checkAccountAndListen();

        return () => {
            if (listenerHandle) {
                listenerHandle.remove();
            }
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

    const doInternalSync = async () => {
        setIsSyncing(true);
        try {
            await initOneDrive();
            const localNotes = await loadNotes();
            const mergedNotes = await syncNotesWithOneDrive(localNotes);

            await Promise.all(mergedNotes.map(n => saveNote(n)));
            window.dispatchEvent(new Event("notes-updated"));

            const now = new Date().toLocaleString();
            setLastSynced(now);
            localStorage.setItem("onedrive-last-synced", now);
            showSuccess("Notes synced with OneDrive!");
        } catch (error) {
            console.error("OneDrive sync failed:", error);
            showError("OneDrive sync failed. Please reconnect.");
        } finally {
            setIsSyncing(false);
        }
    };

    const sync = useCallback(async () => {
        if (!userEmail) {
            showError("Please connect to OneDrive first.");
            return;
        }
        await doInternalSync();
    }, [userEmail]);

    const disconnect = useCallback(async () => {
        await logoutFromOneDrive();
        setUserEmail(null);
        localStorage.removeItem("onedrive-user-email");
        localStorage.removeItem("onedrive-last-synced");
        setLastSynced(null);
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
