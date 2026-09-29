// Copyright (c) 2026. Licensed under AGPLv3.
import { Browser } from "@capacitor/browser";
import { Capacitor } from "@capacitor/core";
import { consumeOAuthState, handleAuthRedirect, initDropbox } from "@/lib/dropbox";
import { isDropboxOAuthUrl, registerOAuthRedirectHandler } from "@/lib/oauth-redirect";
import { showError, showSuccess } from "@/utils/toast";

let handlerRegistered = false;
let authInProgress = false;

export const isDropboxOAuthInProgress = (): boolean => authInProgress;

const completeDropboxLogin = async (redirectUrl: string): Promise<void> => {
    if (authInProgress) return;
    if (!isDropboxOAuthUrl(redirectUrl)) return;

    const parsed = new URL(redirectUrl.replace(/^openkeep:\/\//, "https://"));
    const code = parsed.searchParams.get("code");
    if (!code) return;

    // openkeep:// can't be verified as ours on Android or iOS, so any app can
    // deliver a redirect here. Only finish a login this device actually started.
    if (!consumeOAuthState(parsed.searchParams.get("state"))) {
        console.warn("Ignoring Dropbox redirect with missing or unexpected state");
        return;
    }

    authInProgress = true;
    try {
        await Browser.close();
        const token = await handleAuthRedirect(code);
        initDropbox(token);
        window.dispatchEvent(new Event("dropbox-token-updated"));
        window.dispatchEvent(new CustomEvent("dropbox-oauth-success", { detail: { token } }));
        showSuccess("Connected to Dropbox!");
    } catch (error) {
        console.error("Dropbox OAuth redirect error:", error);
        showError("Failed to finalize Dropbox login.");
    } finally {
        authInProgress = false;
    }
};

/** Register the Dropbox OAuth deep-link handler once for the entire app. */
export const setupDropboxOAuthRedirect = (): void => {
    if (!Capacitor.isNativePlatform() || handlerRegistered) return;
    handlerRegistered = true;

    registerOAuthRedirectHandler({
        id: "dropbox",
        match: isDropboxOAuthUrl,
        handle: completeDropboxLogin,
    });
};
