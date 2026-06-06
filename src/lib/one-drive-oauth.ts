// Copyright (c) 2026. Licensed under AGPLv3.
import { Browser } from "@capacitor/browser";
import { Capacitor } from "@capacitor/core";
import { handleOneDriveRedirect, initOneDrive, msalInstance } from "@/lib/one-drive";
import { isOneDriveOAuthUrl, registerOAuthRedirectHandler } from "@/lib/oauth-redirect";
import { showError, showSuccess } from "@/utils/toast";

let handlerRegistered = false;
let authInProgress = false;

export const isOneDriveOAuthInProgress = (): boolean => authInProgress;

const completeOneDriveLogin = async (redirectUrl: string): Promise<void> => {
    if (authInProgress) return;
    if (!isOneDriveOAuthUrl(redirectUrl)) return;

    authInProgress = true;
    try {
        await Browser.close();
        const response = await handleOneDriveRedirect(redirectUrl);

        const account = response?.account ?? msalInstance.getActiveAccount() ?? msalInstance.getAllAccounts()[0];
        if (!account?.username) {
            return;
        }

        msalInstance.setActiveAccount(account);
        localStorage.setItem("onedrive-user-email", account.username);
        window.dispatchEvent(new Event("onedrive-user-updated"));
        window.dispatchEvent(new CustomEvent("onedrive-oauth-success", { detail: { username: account.username } }));
        showSuccess(`Connected to OneDrive as ${account.username}`);
    } catch (error: unknown) {
        const err = error as { errorCode?: string; message?: string; errorMessage?: string };
        // Harmless when another handler already consumed this redirect.
        if (err.errorCode === "authorization_code_missing_from_server_response") {
            const account = msalInstance.getActiveAccount() ?? msalInstance.getAllAccounts()[0];
            if (account?.username) {
                msalInstance.setActiveAccount(account);
                localStorage.setItem("onedrive-user-email", account.username);
                window.dispatchEvent(new Event("onedrive-user-updated"));
                window.dispatchEvent(new CustomEvent("onedrive-oauth-success", { detail: { username: account.username } }));
                return;
            }
        }

        console.error("OneDrive OAuth redirect error:", error);
        showError("Failed to finalize OneDrive login.");
    } finally {
        authInProgress = false;
    }
};

/** Register the OneDrive OAuth deep-link handler once for the entire app. */
export const setupOneDriveOAuthRedirect = (): void => {
    if (!Capacitor.isNativePlatform() || handlerRegistered) return;
    handlerRegistered = true;

    void initOneDrive();

    registerOAuthRedirectHandler({
        id: "onedrive",
        match: isOneDriveOAuthUrl,
        handle: completeOneDriveLogin,
    });
};
