
import { useState, useCallback, useEffect } from "react";
import { initOneDrive, loginToOneDrive, syncNotesWithOneDrive, logoutFromOneDrive, msalInstance, checkOneDriveMasterKey } from "@/lib/one-drive";
import { loadNotes, saveNote, exportMasterKey, importMasterKey, verifyCloudMasterKeyMatch, wipeDatabaseButKeepKeys, SyncResult } from "@/lib/note-storage";
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
                        const syncResult = await doInternalSync();
                        if (syncResult.status === "conflict") {
                            window.dispatchEvent(new CustomEvent("open-sync-conflict", { detail: { service: "onedrive", payload: (syncResult as any).cloudPayload, reason: (syncResult as any).reason } }));
                        }
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
                    const result = await doInternalSync();
                    if (result.status === "conflict") {
                        window.dispatchEvent(new CustomEvent("open-sync-conflict", { detail: { service: "onedrive", payload: (result as any).cloudPayload, reason: (result as any).reason } }));
                    }
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

    const doInternalSync = async (forceResolution?: "local" | "cloud", cloudPayload?: string, providedPin?: string): Promise<SyncResult> => {
        setIsSyncing(true);
        try {
            await initOneDrive();
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

            let masterKeyPayload: string | undefined;

            if (pin && Capacitor.isNativePlatform()) {
                if (forceResolution === "local" || (!forceResolution)) {
                    masterKeyPayload = await exportMasterKey(pin);
                }

                if (!forceResolution) {
                    const cloudKey = await checkOneDriveMasterKey();
                    if (cloudKey.exists && cloudKey.payload) {
                        const localNotes = await loadNotes();
                        const isMatch = await verifyCloudMasterKeyMatch(cloudKey.payload, pin);
                        
                        if (!isMatch) {
                            return { status: "conflict", cloudPayload: cloudKey.payload, reason: "key_mismatch" };
                        }
                        
                        if (localNotes.length === 0) {
                            await wipeDatabaseButKeepKeys();
                            await importMasterKey(cloudKey.payload, pin);
                            masterKeyPayload = undefined;
                        } else {
                            return { status: "conflict", cloudPayload: cloudKey.payload, reason: "first_connect" };
                        }
                    }
                }
            }

            const localNotes = await loadNotes();
            const localCustomTags = JSON.parse(localStorage.getItem("custom-tags") || "[]");
            const { notes: mergedNotes, customTags: mergedTags } = await syncNotesWithOneDrive(localNotes, localCustomTags, { masterKeyPayload, forceResolution });

            await Promise.all(mergedNotes.map(note => saveNote(note)));
            localStorage.setItem("custom-tags", JSON.stringify(mergedTags));
            window.dispatchEvent(new Event("notes-updated"));

            const now = new Date().toLocaleString();
            setLastSynced(now);
            localStorage.setItem("onedrive-last-synced", now);
            showSuccess("Notes synced with OneDrive!");
            return { status: "success" };
        } catch (error) {
            console.error("OneDrive sync failed:", error);
            if ((error as Error).message.includes("BAD_DECRYPT") || (error as Error).message.includes("Decryption failed")) {
                showError("Cloud notes could not be decrypted. They may be locked with an old, unknown key.");
                const cloudKey = await checkOneDriveMasterKey();
                if (cloudKey.payload) {
                    return { status: "conflict", cloudPayload: cloudKey.payload, reason: "key_mismatch" };
                }
            }
            showError("OneDrive sync failed. Please reconnect.");
            return { status: "error", message: (error as Error).message };
        } finally {
            setIsSyncing(false);
        }
    };

    const sync = useCallback(async (forceResolution?: "local" | "cloud", cloudPayload?: string, providedPin?: string) => {
        if (!userEmail) {
            showError("Please connect to OneDrive first.");
            return { status: "error", message: "Not connected" };
        }
        return await doInternalSync(forceResolution, cloudPayload, providedPin);
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
