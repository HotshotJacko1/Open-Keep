// Copyright (c) 2026. Licensed under AGPLv3.
import { App as CapacitorApp } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";

export type OAuthRedirectHandler = {
    id: string;
    match: (url: string) => boolean;
    handle: (url: string) => Promise<void>;
};

const handlers = new Map<string, OAuthRedirectHandler>();
const processedRedirectKeys = new Set<string>();

let appUrlListener: { remove: () => void } | null = null;
let launchUrlChecked = false;

/** MSAL OneDrive redirect: openkeep://auth#code=...&state=... */
export const isOneDriveOAuthUrl = (url: string): boolean => {
    if (!url.startsWith("openkeep://auth")) return false;
    const hashIndex = url.indexOf("#");
    if (hashIndex === -1) return false;
    const hash = url.slice(hashIndex + 1);
    if (!hash) return false;
    const params = new URLSearchParams(hash);
    return params.has("code") || params.has("error");
};

/** Dropbox redirect: openkeep://auth?code=... */
export const isDropboxOAuthUrl = (url: string): boolean => {
    if (!url.startsWith("openkeep://auth")) return false;
    try {
        const parsed = new URL(url.replace(/^openkeep:\/\//, "https://"));
        return parsed.searchParams.has("code");
    } catch {
        return false;
    }
};

const getRedirectDedupeKey = (url: string): string => {
    if (isDropboxOAuthUrl(url)) {
        const parsed = new URL(url.replace(/^openkeep:\/\//, "https://"));
        const code = parsed.searchParams.get("code");
        if (code) return `dropbox:${code}`;
    }

    if (isOneDriveOAuthUrl(url)) {
        const hash = url.slice(url.indexOf("#") + 1);
        const params = new URLSearchParams(hash);
        const code = params.get("code");
        const state = params.get("state");
        if (code) return `onedrive:${state ?? code}`;
        if (params.has("error")) return `onedrive-error:${params.get("error")}`;
    }

    return url;
};

const dispatchOAuthRedirect = async (url: string): Promise<void> => {
    if (!url.includes("openkeep://auth")) return;

    const matchingHandler = [...handlers.values()].find((handler) => handler.match(url));
    if (!matchingHandler) return;

    const dedupeKey = getRedirectDedupeKey(url);
    if (processedRedirectKeys.has(dedupeKey)) {
        return;
    }

    processedRedirectKeys.add(dedupeKey);
    try {
        await matchingHandler.handle(url);
    } catch (error) {
        processedRedirectKeys.delete(dedupeKey);
        throw error;
    }
};

const ensureOAuthListener = async (): Promise<void> => {
    if (!Capacitor.isNativePlatform()) return;

    if (!launchUrlChecked) {
        launchUrlChecked = true;
        try {
            const launch = await CapacitorApp.getLaunchUrl();
            if (launch?.url) {
                await dispatchOAuthRedirect(launch.url);
            }
        } catch (error) {
            console.warn("Failed to read OAuth launch URL:", error);
        }
    }

    if (!appUrlListener) {
        appUrlListener = await CapacitorApp.addListener("appUrlOpen", async (event) => {
            await dispatchOAuthRedirect(event.url);
        });
    }
};

/** Register a provider OAuth handler. Only one listener is attached for the whole app. */
export const registerOAuthRedirectHandler = (handler: OAuthRedirectHandler): (() => void) => {
    handlers.set(handler.id, handler);
    void ensureOAuthListener();

    return () => {
        handlers.delete(handler.id);
    };
};
