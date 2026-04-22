import { useState, useCallback, useEffect } from "react";
import { useGoogleLogin } from "@react-oauth/google";
import { GoogleAuth } from "@codetrix-studio/capacitor-google-auth";
import { Capacitor } from "@capacitor/core";
import { initGoogleDrive, setAccessToken, syncNotesWithDrive, checkGoogleDriveMasterKey } from "@/lib/google-drive";
import { loadNotes, saveNote, exportMasterKey, importMasterKey, verifyCloudMasterKeyMatch, wipeDatabaseButKeepKeys, changeEncryptionKey, SyncResult } from "@/lib/note-storage";
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

    useEffect(() => {
        const handleUserUpdated = () => {
            setUserEmail(localStorage.getItem("google-user-email"));
        };
        window.addEventListener("google-user-updated", handleUserUpdated);
        return () => window.removeEventListener("google-user-updated", handleUserUpdated);
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

    const login = async (): Promise<SyncResult | undefined> => {
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
                return await doInternalSync();
            } catch (error) {
                console.error("Native Login Failed:", error);
                showError("Google Sign-In Failed");
            }
        } else {
            webLogin();
        }
    };

    const doInternalSync = async (forceResolution?: "local" | "cloud" | "merge", cloudPayload?: string, providedPin?: string): Promise<SyncResult> => {
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
                // Re-encrypt local DB to the new PIN so it matches cloud before merging
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
                    const cloudKey = await checkGoogleDriveMasterKey();
                    if (cloudKey.exists && cloudKey.payload) {
                        const localNotes = await loadNotes();
                        const isFirstConnect = !localStorage.getItem("last-synced-time");
                        const isMatch = await verifyCloudMasterKeyMatch(cloudKey.payload, pin);
                        
                        if (!isMatch) {
                            // Keys differ — conflict resolution required
                            return { status: "conflict", cloudPayload: cloudKey.payload, reason: "key_mismatch" };
                        }
                        
                        if (localNotes.length === 0) {
                            // Local is empty and keys match — auto-restore from cloud
                            await wipeDatabaseButKeepKeys();
                            await importMasterKey(cloudKey.payload, pin);
                            masterKeyPayload = undefined;
                        } else if (isFirstConnect) {
                            // Keys match but this is first connect — ask user which data to keep
                            return { status: "conflict", cloudPayload: cloudKey.payload, reason: "first_connect" };
                        }
                    }
                }
            }

            const localNotes = await loadNotes();
            const localCustomTags = JSON.parse(localStorage.getItem("custom-tags") || "[]");
            const { notes: mergedNotes, customTags: mergedTags } = await syncNotesWithDrive(localNotes, localCustomTags, { masterKeyPayload, forceResolution });

            await Promise.all(mergedNotes.map(note => saveNote(note)));
            localStorage.setItem("custom-tags", JSON.stringify(mergedTags));

            window.dispatchEvent(new Event("notes-updated"));

            const now = new Date().toLocaleString();
            setLastSynced(now);
            localStorage.setItem("last-synced-time", now);
            showSuccess("Notes synced successfully!");
            return { status: "success" };
        } catch (error) {
            console.error("Sync failed:", error);
            if ((error as Error).message.includes("BAD_DECRYPT") || (error as Error).message.includes("Decryption failed")) {
                showError("Cloud notes could not be decrypted. They may be locked with an old, unknown key.");
                const cloudKey = await checkGoogleDriveMasterKey();
                if (cloudKey.payload) {
                    return { status: "conflict", cloudPayload: cloudKey.payload, reason: "key_mismatch" };
                }
            }
            showError("Sync failed. Please reconnect Google Drive.");
            return { status: "error", message: (error as Error).message };
        } finally {
            setIsSyncing(false);
        }
    };

    const sync = useCallback(async (forceResolution?: "local" | "cloud" | "merge", cloudPayload?: string, providedPin?: string) => {
        return await doInternalSync(forceResolution, cloudPayload, providedPin);
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
        window.dispatchEvent(new Event("google-user-updated"));
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
