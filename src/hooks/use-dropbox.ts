
import { useState, useCallback, useEffect } from "react";
import { initDropbox, getAuthenticationUrl, handleAuthRedirect, syncNotesWithDropbox } from "@/lib/dropbox";
import { loadNotes, saveNotes } from "@/lib/note-storage";
import { showSuccess, showError } from "@/utils/toast";

export const useDropbox = () => {
    const [isSyncing, setIsSyncing] = useState(false);
    const [lastSynced, setLastSynced] = useState<string | null>(localStorage.getItem("dropbox-last-synced"));
    const [accessToken, setAccessToken] = useState<string | null>(localStorage.getItem("dropbox-access-token"));

    // Initialize on mount if token exists
    useEffect(() => {
        if (accessToken) {
            initDropbox(accessToken);
        }
    }, [accessToken]);

    // Handle Redirect Return
    useEffect(() => {
        const checkCode = async () => {
            const urlParams = new URLSearchParams(window.location.search);
            const code = urlParams.get("code");

            // Check if we initiated a dropbox login (maybe store a flag in sessionStorage?)
            // Or just try if we see a code and aren't connected?
            // "code" is generic, but if we just clicked login, we expect it.

            if (code && !accessToken) {
                // To avoid conflict with other auth providers (though GDrive uses implicit hash usually, or popup), 
                // we should verify this is for us. 
                // Currently, we assume if user is on this page with code, and we expected it...
                // Better approach: component that handles the callback route. 
                // BUT, since we are doing a simple app, we might intercept it here.

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
                    // Don't show error if it wasn't a dropbox code (e.g. might be failure)
                }
            }
        };
        checkCode();
    }, [accessToken]);

    const login = useCallback(async () => {
        try {
            const url = await getAuthenticationUrl();
            // Redirect to Dropbox
            // We use _self because we need to return to the app to handle the code
            window.location.href = url.toString();
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
            const localNotes = loadNotes();
            const mergedNotes = await syncNotesWithDropbox(localNotes);

            saveNotes(mergedNotes);
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
