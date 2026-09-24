// Copyright (c) 2026. Licensed under AGPLv3.
import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useGoogleLogin } from "@react-oauth/google";
import { SocialLogin } from "@capgo/capacitor-social-login";
import { Capacitor } from "@capacitor/core";
import { initGoogleDrive, setAccessToken, getGoogleAccessToken, syncNotesWithDrive, checkGoogleDriveMasterKey, isGoogleDriveAuthError, isGoogleDriveScopeError, clearCachedDriveIds } from "@/lib/google-drive";
import type { SyncResult } from "@/lib/note-storage";
import { runCloudSync, ForceResolution } from "@/lib/cloud-sync-runner";
import {
    blockGoogleDriveScopeAuth,
    clearGoogleDriveScopeBlock,
    isGoogleDriveScopeBlocked,
    runGoogleDriveTokenEnsure,
} from "@/lib/google-drive-auth-state";
import { useCloudSyncState } from "@/lib/cloud-sync-state";
import { supabase } from "@/integrations/supabase/client";
import { showSuccess, showError } from "@/utils/toast";
import { isGoogleDriveSyncAvailable } from "@/lib/build-flavor";

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
    payload: { code: string; redirectUri?: string } | { refreshToken: string }
): Promise<GoogleTokenEndpointResponse> => {
    const { data, error } = await supabase.functions.invoke<GoogleTokenEndpointResponse>(
        "google-token-exchange",
        { body: payload }
    );
    if (error) {
        // supabase-js throws away the response body on a non-2xx, leaving only
        // "Edge Function returned a non-2xx status code". Recover it so a
        // misconfigured function says *why* (e.g. server_misconfigured).
        let detail = error.message;
        const res = (error as { context?: unknown }).context;
        if (res instanceof Response) {
            try {
                const body = await res.json();
                if (body?.error) {
                    detail = body.error_description
                        ? `${body.error}: ${body.error_description}`
                        : String(body.error);
                }
            } catch {
                // body wasn't JSON — keep the generic message
            }
        }
        throw new GoogleTokenServiceUnavailable(`Google token service unavailable (${detail})`);
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
        // Only a genuine invalid_grant means the refresh token itself is dead
        // (revoked, or expired after ~6 months of inactivity) -- drop it so
        // the interactive sign-in path can recover with a fresh one. Any
        // other error (rate limiting, a transient 5xx from Google or from
        // our own edge function, etc.) is not the refresh token's fault;
        // keep it stored so the next scheduled refresh can simply try again
        // instead of forcing every future renewal through an interactive
        // sign-in.
        console.log(`Google token refresh rejected (${res.error}): ${res.error_description ?? "no description"}`);
        if (res.error === "invalid_grant") {
            setStoredRefreshToken(null);
            setAccessToken("");
        }
        throw new Error(`Google token refresh failed (${res.error})`);
    }

    clearGoogleDriveScopeBlock();
    return persistTokenResponse(res);
};

const initNativeGoogleAuth = async () => {
    if (!isGoogleDriveSyncAvailable) {
        // This build never bundles Google Play Services (see src/lib/build-flavor.ts).
        // Every native Google Drive code path -- login, logout, silent token
        // refresh -- funnels through this one function first, so this is the
        // single place that needs to refuse before SocialLogin.initialize()
        // ever runs and constructs a GoogleProvider.
        throw new Error(
            "Google Drive sync isn't available in this build. Get the full build from Google Play or GitHub for Google Drive sync."
        );
    }
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
        // user this resolves without any visible prompt. If we have no
        // refresh token stored at all, force the consent screen this time
        // (forcePrompt) so Google actually issues one -- otherwise a
        // "silent" auto-select sign-in commonly hands back an access token
        // with no refresh token, and we're right back here next time it
        // expires.
        const needsConsent = !getStoredRefreshToken();
        try {
            const accessToken = await nativeGoogleSignInAndExchange(false, needsConsent);
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
        if (Capacitor.isNativePlatform()) {
            await nativeGoogleEnsureDriveToken(allowInteractiveRecovery);
        } else {
            try {
                await refreshAccessTokenFromStorage();
            } catch (err) {
                if (allowInteractiveRecovery) {
                    throw new Error("Web auth required");
                }
                throw e;
            }
        }
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
        onSuccess: async (tokenResponse: any) => {
            try {
                if (!tokenResponse.code) {
                    throw new Error("No authorization code received from Google");
                }
                
                const tokenRes = await requestGoogleTokens({
                    code: tokenResponse.code,
                    redirectUri: window.location.origin
                });
                if (isTokenEndpointFailure(tokenRes)) {
                    throw new Error(`Google token exchange failed (${tokenRes.error})`);
                }
                const accessToken = persistTokenResponse(tokenRes);

                // Initialize GAPI
                await initGoogleDrive();

                // Get user info to display email
                const userInfo = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
                    headers: { Authorization: `Bearer ${accessToken}` },
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
        flow: 'auth-code',
        // Not in the library's auth-code options type, but useGoogleLogin
        // forwards every extra prop to GIS initCodeClient at runtime.
        ...{ prompt: userEmail ? '' : 'select_account' },
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
            try {
                if (getStoredRefreshToken()) {
                    await refreshAccessTokenFromStorage();
                    const email = localStorage.getItem("google-user-email");
                    if (email) {
                        setUserEmail(email);
                        showSuccess(`Connected to Google Drive as ${email}`);
                    } else {
                        showSuccess("Connected to Google Drive");
                    }
                    return await doInternalSync();
                }
            } catch (e) {
                console.log("Silent refresh failed during login, falling back to popup", e);
            }
            webLogin();
        }
    };

    const doInternalSync = (forceResolution?: ForceResolution, cloudPayload?: string, providedPin?: string, silent: boolean = false): Promise<SyncResult> =>
        runCloudSync({
            provider: "google-drive",
            label: "Google Drive",
            lastSyncedKey: "last-synced-time",
            successMessage: "Notes synced successfully!",
            failureMessage: "Sync failed. Please reconnect Google Drive.",
            permissionMessage: "Google Drive permission was not granted. Disconnect Google Drive in Settings, then reconnect and allow Drive access.",
            prepare: async () => {
                await initGoogleDrive();
                if (Capacitor.isNativePlatform()) {
                    setAccessToken(await nativeGoogleEnsureDriveToken(!silent));
                } else if (!getGoogleAccessToken()) {
                    try {
                        await refreshAccessTokenFromStorage();
                    } catch {
                        throw new Error("Web auth required");
                    }
                }
            },
            checkMasterKey: () => runWithFreshDriveToken(() => checkGoogleDriveMasterKey(), !silent),
            syncNotes: (localNotes, localCustomTags, options) =>
                runWithFreshDriveToken(() => syncNotesWithDrive(localNotes, localCustomTags, options), !silent),
            classifyError: (error) => {
                const message = (error as Error)?.message || "";
                // Checked first: isGoogleDriveAuthError also matches scope failures.
                if (message.includes("Google Drive permission was not granted") || isGoogleDriveScopeError(error)) return "permission";
                if (message === "Web auth required" || isGoogleDriveAuthError(error)) return "auth";
                return null;
            },
            onAuthError: (isSilent) => {
                if (!isSilent && !Capacitor.isNativePlatform()) {
                    webLogin();
                    return { status: "error", message: "Re-authenticating..." };
                }
                if (!isSilent) showError("Google Drive session expired. Please reconnect.");
                return { status: "error", message: "Auth required" };
            },
            onSynced: setLastSynced,
        }, { forceResolution, cloudPayload, providedPin, silent });

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

    // login/disconnect close over per-render values (webLogin, userEmail), so
    // expose stable wrappers that always call the latest version. That keeps
    // the returned object's identity stable, which Index.tsx relies on: it
    // lists this object in effect deps (listeners were re-added every render).
    const loginRef = useRef(login);
    loginRef.current = login;
    const disconnectRef = useRef(disconnect);
    disconnectRef.current = disconnect;
    const stableLogin = useCallback(() => loginRef.current(), []);
    const stableDisconnect = useCallback(() => disconnectRef.current(), []);

    return useMemo(() => ({
        login: stableLogin,
        sync,
        disconnect: stableDisconnect,
        isSyncing,
        lastSynced,
        userEmail,
        isConnected: !!userEmail,
        isTokenExpired,
        isAvailable: isGoogleDriveSyncAvailable
    }), [stableLogin, sync, stableDisconnect, isSyncing, lastSynced, userEmail, isTokenExpired]);
};
