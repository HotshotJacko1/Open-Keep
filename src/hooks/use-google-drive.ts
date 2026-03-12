import { useState, useCallback, useEffect } from "react";
import { useGoogleLogin } from "@react-oauth/google";
import { GoogleAuth } from "@codetrix-studio/capacitor-google-auth";
import { Capacitor } from "@capacitor/core";
import { initGoogleDrive, setAccessToken, syncNotesWithDrive } from "@/lib/google-drive";
import { loadNotes, saveNote } from "@/lib/note-storage";
import { showSuccess, showError } from "@/utils/toast";

export const useGoogleDrive = () => {
    const [isSyncing, setIsSyncing] = useState(false);
    const [lastSynced, setLastSynced] = useState<string | null>(localStorage.getItem("last-synced-time"));
    const [userEmail, setUserEmail] = useState<string | null>(localStorage.getItem("google-user-email"));

    useEffect(() => {
        const handleNotesUpdated = () => {
            setLastSynced(localStorage.getItem("last-synced-time"));
        };
        window.addEventListener("notes-updated", handleNotesUpdated);
        return () => window.removeEventListener("notes-updated", handleNotesUpdated);
    }, []);

    const webLogin = useGoogleLogin({
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
                await doInternalSync();
            } catch (error) {
                console.error("Login setup failed:", error);
                showError("Failed to connect to Google Drive.");
            }
        },
        onError: (error) => {
            console.error("Login Failed:", error);
            showError("Google Sign-In Failed");
        },
        onNonOAuthError: (error) => {
            console.error("Non-OAuth Login Error:", error);
            // This often happens if the client ID is missing or script failed to load
            showError("Google Sign-In Error (Non-OAuth)");
        },
        scope: "https://www.googleapis.com/auth/drive.file",
        flow: 'implicit',
        prompt: 'select_account',
    });

    const login = async () => {
        if (Capacitor.isNativePlatform()) {
            try {
                // Initialize plugin before sign in (required for capacitor-google-auth v3.2.0+)
                await GoogleAuth.initialize({
                    scopes: ["profile", "email", "https://www.googleapis.com/auth/drive.file"]
                });
                const user = await GoogleAuth.signIn();

                // Initialize GAPI
                await initGoogleDrive();
                setAccessToken(user.authentication.accessToken);

                setUserEmail(user.email);
                localStorage.setItem("google-user-email", user.email);

                showSuccess(`Connected to Google Drive as ${user.email}`);
                await doInternalSync();
            } catch (error) {
                console.error("Native Login Failed:", error);
                showError("Google Sign-In Failed");
            }
        } else {
            webLogin();
        }
    };

    const doInternalSync = async () => {
        setIsSyncing(true);
        try {
            await initGoogleDrive();

            if (Capacitor.isNativePlatform()) {
                await GoogleAuth.initialize({
                    scopes: ["profile", "email", "https://www.googleapis.com/auth/drive.file"]
                });
                try {
                    const auth = await GoogleAuth.refresh();
                    setAccessToken(auth.accessToken);
                } catch (e) {
                    console.log("Silent refresh failed, attempting sign in", e);
                    const user = await GoogleAuth.signIn();
                    setAccessToken(user.authentication.accessToken);
                    setUserEmail(user.email);
                    localStorage.setItem("google-user-email", user.email);
                }
            }

            const localNotes = await loadNotes();
            const mergedNotes = await syncNotesWithDrive(localNotes);

            await Promise.all(mergedNotes.map(note => saveNote(note)));

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
    };

    const sync = useCallback(async () => {
        await doInternalSync();
    }, []);

    const disconnect = async () => {
        if (Capacitor.isNativePlatform()) {
            try {
                await GoogleAuth.initialize({
                    scopes: ["profile", "email", "https://www.googleapis.com/auth/drive.file"]
                });
                await GoogleAuth.signOut();
            } catch (e) {
                console.error("Native signout failed", e);
            }
        }
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
