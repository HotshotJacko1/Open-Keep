
import { useState, useCallback, useEffect } from "react";
import { initOneDrive, loginToOneDrive, syncNotesWithOneDrive, logoutFromOneDrive, msalInstance } from "@/lib/one-drive";
import { loadNotes, saveNote } from "@/lib/note-storage";
import { showSuccess, showError } from "@/utils/toast";

export const useOneDrive = () => {
    const [isSyncing, setIsSyncing] = useState(false);
    const [lastSynced, setLastSynced] = useState<string | null>(localStorage.getItem("onedrive-last-synced"));
    const [userEmail, setUserEmail] = useState<string | null>(localStorage.getItem("onedrive-user-email"));

    // Check for active account on load
    useEffect(() => {
        const checkAccount = async () => {
            await initOneDrive();
            const account = msalInstance.getActiveAccount();
            if (account && account.username) {
                setUserEmail(account.username);
                localStorage.setItem("onedrive-user-email", account.username);
            }
        };
        checkAccount();
    }, []);

    const login = useCallback(async () => {
        try {
            const account = await loginToOneDrive();
            if (account && account.username) {
                setUserEmail(account.username);
                localStorage.setItem("onedrive-user-email", account.username);
                showSuccess(`Connected to OneDrive as ${account.username}`);
            }
        } catch (error) {
            console.error("OneDrive Login failed:", error);
            showError("Failed to connect to OneDrive.");
        }
    }, []);

    const sync = useCallback(async () => {
        if (!userEmail) {
            showError("Please connect to OneDrive first.");
            return;
        }

        setIsSyncing(true);
        try {
            // Ensure initialized
            await initOneDrive();

            const localNotes = await loadNotes();
            const mergedNotes = await syncNotesWithOneDrive(localNotes);

            // Save merged notes locally
            await Promise.all(mergedNotes.map(n => saveNote(n)));

            // Notify UI
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
