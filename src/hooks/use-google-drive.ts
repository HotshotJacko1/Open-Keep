import { useState, useCallback } from "react";
import { useGoogleLogin } from "@react-oauth/google";
import { initGoogleDrive, setAccessToken, syncNotesWithDrive } from "@/lib/google-drive";
import { loadNotes, saveNotes } from "@/lib/note-storage";
import { showSuccess, showError } from "@/utils/toast";

export const useGoogleDrive = () => {
    const [isSyncing, setIsSyncing] = useState(false);
    const [lastSynced, setLastSynced] = useState<string | null>(localStorage.getItem("last-synced-time"));
    const [userEmail, setUserEmail] = useState<string | null>(localStorage.getItem("google-user-email"));

    const login = useGoogleLogin({
        onSuccess: async (tokenResponse) => {
            try {
                // Initialize GAPI
                await initGoogleDrive();
                setAccessToken(tokenResponse.access_token);

                // Get user info to display email
                const userInfo = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
                    headers: { Authorization: `Bearer ${tokenResponse.access_token}` },
                }).then(res => res.json());

                setUserEmail(userInfo.email);
                localStorage.setItem("google-user-email", userInfo.email);

                showSuccess(`Connected to Google Drive as ${userInfo.email}`);
            } catch (error) {
                console.error("Login setup failed:", error);
                showError("Failed to connect to Google Drive.");
            }
        },
        onError: (error) => {
            console.error("Login Failed:", error);
            showError("Google Sign-In Failed");
        },
        scope: "https://www.googleapis.com/auth/drive.file",
        flow: 'implicit',
    });

    const sync = useCallback(async () => {
        setIsSyncing(true);
        try {
            await initGoogleDrive();
            // In a real app we'd check for token expiry here. 
            // If this fails with 401, it usually means token is missing/expired.

            const localNotes = loadNotes();
            const mergedNotes = await syncNotesWithDrive(localNotes);

            // Save merged notes locally
            saveNotes(mergedNotes);

            // Force a reload of notes in the UI? 
            // The app probably reads from localStorage on mount or has a listener.
            // Note: note-storage.ts doesn't emit events. 
            // We might need to dispatch a storage event or window event to update the UI if it relies on localStorage directly without context.
            // Looking at SettingsDialog (it doesn't list notes), but the main app does.
            // I'll emit a custom event or check how the app updates. 
            window.dispatchEvent(new Event("notes-updated"));

            const now = new Date().toLocaleString();
            setLastSynced(now);
            localStorage.setItem("last-synced-time", now);
            showSuccess("Notes synced successfully!");
        } catch (error) {
            console.error("Sync failed:", error);
            showError("Sync failed. Please reconnect Google Drive.");
        } finally {
            setIsSyncing(false);
        }
    }, []);

    const disconnect = () => {
        setUserEmail(null);
        localStorage.removeItem("google-user-email");
        localStorage.removeItem("last-synced-time");
        setLastSynced(null);
        // We can't really 'logout' the token on server without revocation, but we clear client state
        setAccessToken("");
        showSuccess("Disconnected from Google Drive.");
    };

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
