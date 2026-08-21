// Copyright (c) 2026. Licensed under AGPLv3.
import { useState, useCallback, useEffect } from "react";
import { useGoogleLogin } from "@react-oauth/google";
import { SocialLogin } from "@capgo/capacitor-social-login";
import { Capacitor } from "@capacitor/core";
import { initGoogleDrive, setAccessToken, getGoogleAccessToken, syncNotesWithDrive, checkGoogleDriveMasterKey, hasGoogleAccessToken, isGoogleDriveAuthError, clearCachedDriveIds } from "@/lib/google-drive";
import { loadNotes, saveNote, exportMasterKey, importMasterKey, verifyCloudMasterKeyMatch, canDecryptCloudMasterKey, wipeDatabaseButKeepKeys, SyncResult } from "@/lib/note-storage";
import { resolveCloudKeyImport, getCloudKeyConflictIfNeeded } from "@/lib/cloud-sync-resolver";
import {
    blockGoogleDriveScopeAuth,
    clearGoogleDriveScopeBlock,
    isGoogleDriveScopeBlocked,
    runGoogleDriveTokenEnsure,
} from "@/lib/google-drive-auth-state";
import { setCloudSyncState, useCloudSyncState } from "@/lib/cloud-sync-state";
import { supabase } from "@/integrations/supabase/client";
import { showSuccess, showError } from "@/utils/toast";

export { isGoogleDriveAuthBusy, isGoogleDriveScopeBlocked } from "@/lib/google-drive-auth-state";

const GOOGLE_WEB_CLIENT_ID = "889284625804-5prnhudcoalopvn0ad0au449lo1bn8f8.apps.googleusercontent.com";
const GOOGLE_IOS_CLIENT_ID = "889284625804-4o32i9r7cun3pd9a471a6kno2rmgb4k1.apps.googleusercontent.com";
const GOOGLE_DRIVE_SCOPES = ["profile", "email", "https://www.googleapis.com/auth/drive.file"];
const REFRESH_TOKEN_STORAGE_KEY = "google-refresh-token";

// ---- Token plumbing ---------------------------------------------------------
// Native Google auth runs in "offline" mode: SocialLogin hands us a one-time
// server auth code which our Supabase Edge Function exchanges for a refresh
// token. The refresh token is stored locally and lets us mint Drive access
// tokens silently forever — no sign-in prompt every hour.

interface GoogleTokenEndpointSuccess {
    access_token: string;
    expires_in: number;
    refresh_token?: string;
    scope?: string;
    token_type?: string;
    id_token?: string;
}

interface GoogleTokenEndpointFailure {
    error: string;
    error_description?: string;
}

type GoogleTokenEndpointResponse = GoogleTokenEndpointSuccess | GoogleTokenEndpointFailure;

const isTokenEndpointFailure = (
    res: GoogleTokenEndpointResponse
): res is GoogleTokenEndpointFailure => "error" in res && !("access_token" in res);

/**
 * The token service itself was unreachable (network, CORS, function down).
 * Distinct from a Google *rejection* — no amount of user interaction fixes it,
 * and every rung of the token ladder depends on this same endpoint.
 */
export class GoogleTokenServiceUnavailable extends Error {
    constructor(message: string) {
        super(message);
        this.name = "GoogleTokenServiceUnavailable";
    }
}

const requestGoogleTokens = async (
    payload: { code: string } | { refreshToken: string }
): Promise<GoogleTokenEndpointResponse> => {
    const { data, error } = await supabase.functions.invoke<GoogleTokenEndpointResponse>(
        "google-token-exchange",
        { body: payload }
    );
    if (error) {
        throw new GoogleTokenServiceUnavailable(`Google token service unavailable (${error.message})`);
    }
    if (!data) {
        throw new GoogleTokenServiceUnavailable("Google token service returned no data");
    }
    return data;
};

const getStoredRefreshToken = (): string | null => localStorage.getItem(REFRESH_TOKEN_STORAGE_KEY);

const setStoredRefreshToken = (token: string | null): void => {
    if (token) {
        localStorage.setItem(REFRESH_TOKEN_STORAGE_KEY, token);
    } else {
        localStorage.removeItem(REFRESH_TOKEN_STORAGE_KEY);
    }
};

const emailFromIdToken = (idToken?: string): string | null => {
    if (!idToken) return null;
    try {
        const payloadPart = idToken.split(".")[1];
        if (!payloadPart) return null;
        const base64 = payloadPart.replace(/-/g, "+").replace(/_/g, "/").replace(/=/g, "");
        const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
        const payload = JSON.parse(atob(padded));
        return typeof payload.email === "string" ? payload.email : null;
    } catch {
        return null;
    }
};

/** Stores the fresh tokens; throws (and blocks) if Drive scope was not granted. */
const persistTokenResponse = (tokens: GoogleTokenEndpointSuccess): string => {
    // Google only returns a refresh_token on first consent or forced refresh;
    // when absent, the previously stored one remains valid.
    if (tokens.refresh_token) {
        setStoredRefreshToken(tokens.refresh_token);
    }

    const grantedScopes = tokens.scope || "";
    if (!grantedScopes.includes("auth/drive.file")) {
        blockGoogleDriveScopeAuth();
        setAccessToken("");
        throw new Error(
            "Google Drive permission was not granted. Disconnect Google Drive in Settings, then reconnect and allow Drive access."
        );
    }

    setAccessToken(tokens.access_token, tokens.expires_in || 3600);

    const email = emailFromIdToken(tokens.id_token);
    if (email) {
        localStorage.setItem("google-user-email", email);
        window.dispatchEvent(new Event("google-user-updated"));
    }

    return tokens.access_token;
};

/** Silently mints a new access token from the stored refresh token. */
const refreshAccessTokenFromStorage = async (): Promise<string> => {
    const refreshToken = getStoredRefreshToken();
    if (!refreshToken) {
        throw new Error("No stored Google refresh token");
    }

    const res = await requestGoogleTokens({ refreshToken });
    if (isTokenEndpointFailure(res)) {
        // e.g. invalid_grant: revoked or expired (~6 months). Drop it so the
        // interactive sign-in path can recover.
        console.log(`Google token refresh rejected (${res.error})`);
        setStoredRefreshToken(null);
        setAccessToken("");
        throw new Error(`Google token refresh failed (${res.error})`);
    }

    clearGoogleDriveScopeBlock();
    return persistTokenResponse(res);
};

const initNativeGoogleAuth = async () => {
    await SocialLogin.initialize({
        google: {
            webClientId: GOOGLE_WEB_CLIENT_ID,
            iOSClientId: GOOGLE_IOS_CLIENT_ID,
            iOSServerClientId: GOOGLE_WEB_CLIENT_ID,
            mode: "offline",
        },
    });
};

/**
 * Interactive sign-in followed by an auth-code exchange. With
 * filterByAuthorizedAccounts + autoSelectEnabled this usually completes with
 * zero UI for a returning user; forcePrompt falls back to the full picker.
 */
const nativeGoogleSignInAndExchange = async (logoutFirst: boolean, forcePrompt: boolean): Promise<string> => {
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
            filterByAuthorizedAccounts: !forcePrompt,
            autoSelectEnabled: !forcePrompt,
            forcePrompt,
        },
    });

    if (res.result.responseType !== "offline") {
        throw new Error("Expected offline (server auth code) Google login response");
    }

    const tokenRes = await requestGoogleTokens({ code: res.result.serverAuthCode });
    if (isTokenEndpointFailure(tokenRes)) {
        throw new Error(`Google token exchange failed (${tokenRes.error})`);
    }

    return persistTokenResponse(tokenRes);
};

const nativeGoogleEnsureDriveToken = async (isExplicitLogin = false): Promise<string> => {
    return runGoogleDriveTokenEnsure(async () => {
        if (isGoogleDriveScopeBlocked()) {
            throw new Error(
                "Google Drive permission was not granted. Disconnect and reconnect Google Drive in Settings."
            );
        }

        await initNativeGoogleAuth();

        // 1. Unexpired access token from earlier this session.
        const cached = getGoogleAccessToken();
        if (cached) {
            clearGoogleDriveScopeBlock();
            return cached;
        }

        // 2. Silent refresh via the stored refresh token — no UI at all.
        try {
            return await refreshAccessTokenFromStorage();
        } catch (e) {
            // Sign-in also needs this endpoint to exchange the code — don't prompt.
            if (e instanceof GoogleTokenServiceUnavailable) throw e;
            console.log("Silent Google token refresh failed, falling back to sign-in", e);
        }

        // 3. Sign-in restricted to already-authorized accounts. For a returning
        // user this resolves without any visible prompt.
        try {
            const accessToken = await nativeGoogleSignInAndExchange(false, false);
            clearGoogleDriveScopeBlock();
            return accessToken;
        } catch (e) {
            // The forced picker would hit the same unreachable endpoint.
            if (e instanceof GoogleTokenServiceUnavailable) throw e;
            console.log("Silent sign-in attempt failed", e);
            if (!isExplicitLogin) {
                throw e;
            }
        }

        console.log("Falling back to forced Google account picker / re-consent...");
        // 4. Last resort: force the account picker so the user can pick & re-consent.
        const accessToken = await nativeGoogleSignInAndExchange(true, true);
        clearGoogleDriveScopeBlock();
        return accessToken;
    });
};

/**
 * Runs a Drive operation; if Google rejects the current token mid-request
 * (expired/revoked/scope), obtains a fresh one and retries once. This replaces
 * the old up-front token-validation probe — the real request is its own probe.
 */
const runWithFreshDriveToken = async <T>(work: () => Promise<T>, allowInteractiveRecovery: boolean): Promise<T> => {
    try {
        return await work();
    } catch (e) {
        if (!isGoogleDriveAuthError(e)) throw e;
        console.log("Google rejected the Drive token — refreshing once and retrying");
        setAccessToken("");
        await nativeGoogleEnsureDriveToken(allowInteractiveRecovery);
        return await work();
    }
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
                const accessToken = await nativeGoogleEnsureDriveToken(true);
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
                console.error("Stringified error:", JSON.stringify(error, Object.getOwnPropertyNames(error)));
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
                const accessToken = await nativeGoogleEnsureDriveToken(!silent);
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
                () => runWithFreshDriveToken(() => checkGoogleDriveMasterKey(), !silent)
            );
            if (cloudKeyConflict) return cloudKeyConflict;

            const keyImport = await resolveCloudKeyImport(forceResolution, cloudPayload, pin, providedPin);
            if (keyImport.ok === false) {
                if (cloudPayload) {
                    return { status: "conflict", cloudPayload, reason: "key_mismatch" };
                }
                return { status: "error", message: keyImport.reason };
            }
            const effectivePin = keyImport.effectivePin ?? pin ?? "";

            let masterKeyPayload: string | undefined;

            if (forceResolution === "local" || (!forceResolution)) {
                masterKeyPayload = await exportMasterKey(effectivePin);
            }

            if (!forceResolution) {
                const cloudKey = await runWithFreshDriveToken(() => checkGoogleDriveMasterKey(), !silent);
                if (cloudKey.exists && cloudKey.payload) {
                    const localNotes = await loadNotes();
                    const isFirstConnect = !localStorage.getItem("last-synced-time");
                    const canDecrypt = await canDecryptCloudMasterKey(cloudKey.payload, effectivePin);
                    const isMatch = await verifyCloudMasterKeyMatch(cloudKey.payload, effectivePin);

                    if (localNotes.length === 0) {
                        if (canDecrypt) {
                            // Local is empty and we can decrypt the cloud key — auto-restore from cloud
                            await wipeDatabaseButKeepKeys();
                            await importMasterKey(cloudKey.payload, effectivePin);
                            masterKeyPayload = undefined;
                        } else {
                            // We cannot decrypt the cloud key. Need the correct PIN.
                            return { status: "conflict", cloudPayload: cloudKey.payload, reason: "key_mismatch" };
                        }
                    } else {
                        if (!isMatch) {
                            // Keys differ and we have local notes — conflict resolution required
                            return { status: "conflict", cloudPayload: cloudKey.payload, reason: "key_mismatch" };
                        } else if (isFirstConnect) {
                            // Keys match but this is first connect — ask user which data to keep
                            return { status: "conflict", cloudPayload: cloudKey.payload, reason: "first_connect" };
                        }
                    }
                }
            }

            const localNotes = await loadNotes();
            console.log(`[Google Drive Sync] Loaded ${localNotes.length} local notes for sync`);
            const localCustomTags = JSON.parse(localStorage.getItem("custom-tags") || "[]");
            const driveForceResolution = forceResolution === "merge" ? undefined : forceResolution;
            const { notes: mergedNotes, customTags: mergedTags } = await runWithFreshDriveToken(
                () => syncNotesWithDrive(localNotes, localCustomTags, { masterKeyPayload, forceResolution: driveForceResolution }),
                !silent
            );

            if (forceResolution === "cloud") {
                await wipeDatabaseButKeepKeys();
            }

            // Re-read local DB state now that sync is complete. Local notes may have changed
            // while the sync was in-flight (e.g. user deleted a note during a long sync).
            // Only write back a merged note if it is still newer than (or equal to) the
            // current local copy — this prevents a stale sync from resurrecting deleted notes.
            const currentLocalNotes = await loadNotes();
            const currentLocalMap = new Map(currentLocalNotes.map(n => [n.id, n]));

            let savedCount = 0;
            let skippedCount = 0;
            await Promise.all(mergedNotes.map(async note => {
                const current = currentLocalMap.get(note.id);
                if (current && current.updatedAt > note.updatedAt) {
                    // Local was modified after the sync started — skip to avoid overwriting
                    console.log(`[Google Drive Sync] Write-back skipped for note ${note.id} (${note.title}): local is newer (${new Date(current.updatedAt).toISOString()} > ${new Date(note.updatedAt).toISOString()})`);
                    skippedCount++;
                    return;
                }
                await saveNote(note);
                savedCount++;
            }));
            console.log(`[Google Drive Sync] Write-back complete: ${savedCount} saved, ${skippedCount} skipped (local was newer)`);
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
            const message = (error as Error).message || "";
            if (!message.includes("Cannot parse synced data")) {
                console.error("Sync failed:", error);
            }
            // Check for local DB errors first — don't confuse them with cloud issues
            if (message.includes("database") || message.includes("INSTANCE") || message.includes("not initialized") || message.includes("sqlcipher")) {
                if (!silent) showError("Local database access failed. Notes are safe — please restart the app.");
                return { status: "error", message: "Local database access failed" };
            }
            if (message.includes("Google Drive permission was not granted")) {
                showError(message);
                return { status: "error", message };
            }
            if (message.includes("BAD_DECRYPT") || message.includes("Decryption failed") || message.includes("Cannot parse synced data")) {
                // If it's a silent sync (like auto-sync on refresh), don't spam the UI with errors
                if (!silent) showError("Cloud notes could not be decrypted. They may be locked with an old, unknown key.");
                const cloudKey = await checkGoogleDriveMasterKey();
                if (cloudKey.payload) {
                    return { status: "conflict", cloudPayload: cloudKey.payload, reason: "key_mismatch" };
                }
            }
            if (!silent) showError("Sync failed. Please reconnect Google Drive.");
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
                console.warn("Google plugin logout unsupported in offline mode (local state cleared anyway)", e);
            }
        }
        setUserEmail(null);
        localStorage.removeItem("google-user-email");
        localStorage.removeItem("last-synced-time");
        setLastSynced(null);
        setStoredRefreshToken(null);
        clearCachedDriveIds();
        // We can't really 'logout' the token on server without revocation, but we clear client state
        setAccessToken("");
        clearGoogleDriveScopeBlock();
        window.dispatchEvent(new Event("google-user-updated"));
        showSuccess("Disconnected from Google Drive.");
    };

    const [isTokenExpired, setIsTokenExpired] = useState<boolean>(false);

    useEffect(() => {
        const checkExpiry = () => {
            const expiry = localStorage.getItem("google-token-expiry");
            if (userEmail && expiry && Date.now() > parseInt(expiry, 10)) {
                setIsTokenExpired(true);
            } else {
                setIsTokenExpired(false);
            }
        };
        checkExpiry();
        const interval = setInterval(checkExpiry, 10000);
        
        const handleTokenUpdate = () => checkExpiry();
        window.addEventListener("google-token-updated", handleTokenUpdate);
        
        return () => {
            clearInterval(interval);
            window.removeEventListener("google-token-updated", handleTokenUpdate);
        };
    }, [userEmail]);

    return {
        login,
        sync,
        disconnect,
        isSyncing,
        lastSynced,
        userEmail,
        isConnected: !!userEmail,
        isTokenExpired
    };
};
