// Copyright (c) 2026. Licensed under AGPLv3.
import { useState, useCallback, useEffect } from "react";
import { useGoogleLogin } from "@react-oauth/google";
import { SocialLogin, type GoogleLoginResponse } from "@capgo/capacitor-social-login";
import { Capacitor } from "@capacitor/core";
import { initGoogleDrive, setAccessToken, getGoogleAccessToken, syncNotesWithDrive, checkGoogleDriveMasterKey, hasGoogleAccessToken, verifyGoogleDriveAccess } from "@/lib/google-drive";
import { loadNotes, saveNote, exportMasterKey, importMasterKey, verifyCloudMasterKeyMatch, wipeDatabaseButKeepKeys, SyncResult } from "@/lib/note-storage";
import { resolveCloudKeyImport, getCloudKeyConflictIfNeeded } from "@/lib/cloud-sync-resolver";
import {
    blockGoogleDriveScopeAuth,
    clearGoogleDriveScopeBlock,
    isGoogleDriveScopeBlocked,
    runGoogleDriveTokenEnsure,
} from "@/lib/google-drive-auth-state";
import { setCloudSyncState, useCloudSyncState } from "@/lib/cloud-sync-state";
import { showSuccess, showError } from "@/utils/toast";

export { isGoogleDriveAuthBusy, isGoogleDriveScopeBlocked } from "@/lib/google-drive-auth-state";

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

const readGoogleAccessTokenFromLogin = async (
    result: GoogleLoginResponse
): Promise<string> => {
    if (result.responseType !== "online") {
        throw new Error("Expected online Google login response");
    }

    // Prefer the token returned by login — it includes scopes just granted in this session.
    const loginToken = result.accessToken?.token;
    if (loginToken) {
        return loginToken;
    }

    try {
        const auth = await SocialLogin.getAuthorizationCode({ provider: "google" });
        if (auth.accessToken) {
            return auth.accessToken;
        }
    } catch (e) {
        console.warn("getAuthorizationCode after login failed", e);
    }

    throw new Error("No access token received from Google");
};

const nativeGoogleSignIn = async (logoutFirst = false) => {
    await initNativeGoogleAuth();

    if (logoutFirst) {
        try {
            await SocialLogin.logout({ provider: "google" });
        } catch (e) {
            console.warn("Google logout before re-auth failed", e);
        }
        setAccessToken("");
    }

    const res = await SocialLogin.login({
        provider: "google",
        options: {
            scopes: GOOGLE_DRIVE_SCOPES,
            forceRefreshToken: true,
            forcePrompt: true,
        },
    });

    if (res.result.responseType !== "online") {
        throw new Error("Expected online Google login response");
    }

    const accessToken = await readGoogleAccessTokenFromLogin(res.result);

    return {
        accessToken,
        email: res.result.profile.email || "",
    };
};

const nativeGoogleEnsureDriveToken = async (): Promise<string> => {
    return runGoogleDriveTokenEnsure(async () => {
        if (isGoogleDriveScopeBlocked()) {
            throw new Error(
                "Google Drive permission was not granted. Disconnect and reconnect Google Drive in Settings."
            );
        }

        await initNativeGoogleAuth();

        if (hasGoogleAccessToken()) {
            try {
                if (await verifyGoogleDriveAccess()) {
                    clearGoogleDriveScopeBlock();
                    const token = getGoogleAccessToken();
                    if (token) return token;
                }
            } catch (e) {
                console.log("Stored Google token failed Drive verification", e);
            }
            setAccessToken("");
        }

        try {
            const { isLoggedIn } = await SocialLogin.isLoggedIn({ provider: "google" });
            if (isLoggedIn) {
                const auth = await SocialLogin.getAuthorizationCode({ provider: "google" });
                if (auth.accessToken) {
                    setAccessToken(auth.accessToken);
                    if (await verifyGoogleDriveAccess()) {
                        clearGoogleDriveScopeBlock();
                        return auth.accessToken;
                    }
                }
            }
        } catch (e) {
            console.log("Silent Google token fetch failed", e);
        }

        setAccessToken("");
        let user = await nativeGoogleSignIn(false);
        setAccessToken(user.accessToken);
        if (user.email) {
            localStorage.setItem("google-user-email", user.email);
        }
        if (await verifyGoogleDriveAccess()) {
            clearGoogleDriveScopeBlock();
            return user.accessToken;
        }

        console.log("Drive scope still missing — signing out and requesting fresh consent...");
        user = await nativeGoogleSignIn(true);
        setAccessToken(user.accessToken);
        if (user.email) {
            localStorage.setItem("google-user-email", user.email);
        }
        if (await verifyGoogleDriveAccess()) {
            clearGoogleDriveScopeBlock();
            return user.accessToken;
        }

        blockGoogleDriveScopeAuth();
        setAccessToken("");
        throw new Error(
            "Google Drive permission was not granted. Disconnect Google Drive in Settings, then reconnect and allow Drive access."
        );
    });
};

export const useGoogleDrive = () => {
    const isSyncing = useCloudSyncState("google-drive");
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
                clearGoogleDriveScopeBlock();
                const accessToken = await nativeGoogleEnsureDriveToken();
                setAccessToken(accessToken);

                const email = localStorage.getItem("google-user-email");
                if (email) {
                    setUserEmail(email);
                    showSuccess(`Connected to Google Drive as ${email}`);
                } else {
                    showSuccess("Connected to Google Drive");
                }
                return await doInternalSync();
            } catch (error) {
                console.error("Native Login Failed:", error);
                showError((error as Error).message || "Google Sign-In Failed");
            }
        } else {
            webLogin();
        }
    };

    const doInternalSync = async (forceResolution?: "local" | "cloud" | "merge", cloudPayload?: string, providedPin?: string, silent: boolean = false): Promise<SyncResult> => {
        setCloudSyncState("google-drive", true);
        try {
            await initGoogleDrive();

            if (Capacitor.isNativePlatform()) {
                const accessToken = await nativeGoogleEnsureDriveToken();
                setAccessToken(accessToken);
            } else {
                if (!hasGoogleAccessToken()) {
                    setCloudSyncState("google-drive", false);
                    webLogin();
                    return { status: "error", message: "Re-authenticating..." };
                }
            }

            const pin = localStorage.getItem("app-passcode");
            if (!pin && localStorage.getItem("app-lock-enabled") === "true") {
                throw new Error("No PIN found. Please set up a PIN in App Lock settings first.");
            }

            const cloudKeyConflict = await getCloudKeyConflictIfNeeded(
                pin,
                forceResolution,
                checkGoogleDriveMasterKey
            );
            if (cloudKeyConflict) return cloudKeyConflict;

            const keyImport = await resolveCloudKeyImport(forceResolution, cloudPayload, pin, providedPin);
            if (keyImport.ok === false) {
                if (cloudPayload) {
                    return { status: "conflict", cloudPayload, reason: "key_mismatch" };
                }
                return { status: "error", message: keyImport.reason };
            }
            const effectivePin = keyImport.effectivePin || pin;

            let masterKeyPayload: string | undefined;

            if (effectivePin) {
                if (forceResolution === "local" || (!forceResolution)) {
                    masterKeyPayload = await exportMasterKey(effectivePin);
                }

                if (!forceResolution) {
                    const cloudKey = await checkGoogleDriveMasterKey();
                    if (cloudKey.exists && cloudKey.payload) {
                        const localNotes = await loadNotes();
                        const isFirstConnect = !localStorage.getItem("last-synced-time");
                        const isMatch = await verifyCloudMasterKeyMatch(cloudKey.payload, effectivePin);

                        if (!isMatch) {
                            // Keys differ — conflict resolution required
                            return { status: "conflict", cloudPayload: cloudKey.payload, reason: "key_mismatch" };
                        }

                        if (localNotes.length === 0) {
                            // Local is empty and keys match — auto-restore from cloud
                            await wipeDatabaseButKeepKeys();
                            await importMasterKey(cloudKey.payload, effectivePin);
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
            const message = (error as Error).message || "";
            if (message.includes("Google Drive permission was not granted")) {
                showError(message);
                return { status: "error", message };
            }
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
            setCloudSyncState("google-drive", false);
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
        clearGoogleDriveScopeBlock();
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
