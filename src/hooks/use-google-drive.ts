// Copyright (c) 2026. Licensed under AGPLv3.
import { useState, useCallback, useEffect } from "react";
import { useGoogleLogin } from "@react-oauth/google";
import { SocialLogin } from "@capgo/capacitor-social-login";
import { Capacitor } from "@capacitor/core";
import { initGoogleDrive, setAccessToken, syncNotesWithDrive, checkGoogleDriveMasterKey, hasGoogleAccessToken } from "@/lib/google-drive";
import { loadNotes, saveNote, exportMasterKey, importMasterKey, verifyCloudMasterKeyMatch, wipeDatabaseButKeepKeys, changeEncryptionKey, SyncResult } from "@/lib/note-storage";
import { showSuccess, showError } from "@/utils/toast";

const GOOGLE_WEB_CLIENT_ID = "889284625804-5prnhudcoalopvn0ad0au449lo1bn8f8.apps.googleusercontent.com";
const GOOGLE_IOS_CLIENT_ID = "889284625804-4o32i9r7cun3pd9a471a6kno2rmgb4k1.apps.googleusercontent.com";
const GOOGLE_DRIVE_SCOPES = ["profile", "email", "https://www.googleapis.com/auth/drive.file"];

const initNativeGoogleAuth = async () => {
    await SocialLogin.initialize({
        google: {
            webClientId: GOOGLE_WEB_CLIENT_ID,
            iOSClientId: GOOGLE_IOS_CLIENT_ID,
            iOSServerClientId: GOOGLE_WEB_CLIENT_ID,
            mode: "online",
        },
    });
};

const nativeGoogleSignIn = async () => {
    await initNativeGoogleAuth();
    const res = await SocialLogin.login({
        provider: "google",
        options: {
            scopes: GOOGLE_DRIVE_SCOPES,
            forceRefreshToken: true,
        },
    });

    if (res.result.responseType !== "online") {
        throw new Error("Expected online Google login response");
    }

    const accessToken = res.result.accessToken?.token;
    if (!accessToken) {
        throw new Error("No access token received from Google");
    }

    return {
        accessToken,
        email: res.result.profile.email || "",
    };
};

const nativeGoogleRefreshToken = async () => {
    await initNativeGoogleAuth();
    await SocialLogin.refresh({
        provider: "google",
        options: {
            scopes: GOOGLE_DRIVE_SCOPES,
        },
    });
    const auth = await SocialLogin.getAuthorizationCode({ provider: "google" });
    if (!auth.accessToken) {
        throw new Error("No access token available after refresh");
    }
    return auth.accessToken;
};

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
                const result = await doInternalSync();
                if (result && result.status === "conflict" && 'cloudPayload' in result) {
                    window.dispatchEvent(new CustomEvent("open-sync-conflict", { detail: { service: "google", payload: (result as any).cloudPayload, reason: (result as any).reason } }));
                }
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
        prompt: userEmail ? '' : 'select_account',
        hint: userEmail || undefined,
    });

    const login = async (): Promise<SyncResult | undefined> => {
        if (Capacitor.isNativePlatform()) {
            try {
                const user = await nativeGoogleSignIn();

                await initGoogleDrive();
                setAccessToken(user.accessToken);

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

    const doInternalSync = async (forceResolution?: "local" | "cloud" | "merge", cloudPayload?: string, providedPin?: string, silent: boolean = false): Promise<SyncResult> => {
        setIsSyncing(true);
        try {
            await initGoogleDrive();

            if (Capacitor.isNativePlatform()) {
                try {
                    const accessToken = await nativeGoogleRefreshToken();
                    setAccessToken(accessToken);
                } catch (e) {
                    console.log("Silent refresh failed, attempting sign in", e);
                    const user = await nativeGoogleSignIn();
                    setAccessToken(user.accessToken);
                    setUserEmail(user.email);
                    localStorage.setItem("google-user-email", user.email);
                }
            } else {
                if (!hasGoogleAccessToken()) {
                    setIsSyncing(false);
                    webLogin();
                    return { status: "error", message: "Re-authenticating..." };
                }
            }

            const pin = localStorage.getItem("app-passcode");
            if (!pin && localStorage.getItem("app-lock-enabled") === "true") {
                throw new Error("No PIN found. Please set up a PIN in App Lock settings first.");
            }

            // forceResolution: cloud — import the cloud master key, then sync notes from cloud
            if (forceResolution === "cloud" && cloudPayload && (pin || providedPin)) {
                const importPin = providedPin || pin!;
                await wipeDatabaseButKeepKeys();
                await importMasterKey(cloudPayload, importPin);
                // Persist the PIN locally so subsequent syncs can re-use it
                if (importPin !== pin) {
                    localStorage.setItem("app-passcode", importPin);
                    localStorage.setItem("app-lock-enabled", "true");
                }
            }

            // forceResolution: merge — re-encrypt with the provided PIN and import cloud key
            if (forceResolution === "merge" && cloudPayload && providedPin) {
                if (pin && providedPin !== pin) {
                    // Re-encrypt local DB to the new PIN so it matches cloud before merging
                    await changeEncryptionKey(pin, providedPin);
                }
                await importMasterKey(cloudPayload, providedPin);
                localStorage.setItem("app-passcode", providedPin);
                localStorage.setItem("app-lock-enabled", "true");
            }

            let masterKeyPayload: string | undefined;

            // Web with no local PIN: check if cloud has an encrypted master key and prompt for PIN
            if (!pin && !forceResolution) {
                const cloudKey = await checkGoogleDriveMasterKey();
                if (cloudKey.exists && cloudKey.payload) {
                    return { status: "conflict", cloudPayload: cloudKey.payload, reason: "key_mismatch" };
                }
            }

            if (pin) {
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
            const driveForceResolution = forceResolution === "merge" ? undefined : forceResolution;
            const { notes: mergedNotes, customTags: mergedTags } = await syncNotesWithDrive(localNotes, localCustomTags, { masterKeyPayload, forceResolution: driveForceResolution });

            await Promise.all(mergedNotes.map(note => saveNote(note)));
            localStorage.setItem("custom-tags", JSON.stringify(mergedTags));

            const now = new Date().toLocaleString();
            localStorage.setItem("last-synced-time", now);
            setLastSynced(now);
            window.dispatchEvent(new Event("notes-updated"));
            if (!silent) {
                showSuccess("Notes synced successfully!");
            }
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

    const sync = useCallback(async (forceResolution?: "local" | "cloud" | "merge", cloudPayload?: string, providedPin?: string, silent: boolean = false) => {
        return await doInternalSync(forceResolution, cloudPayload, providedPin, silent);
    }, []);

    const disconnect = async () => {
        if (Capacitor.isNativePlatform()) {
            try {
                await initNativeGoogleAuth();
                await SocialLogin.logout({ provider: "google" });
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
