// Copyright (c) 2026. Licensed under AGPLv3.
//
// The installable web app (PWA). vite.config.ts builds the manifest and the
// service worker; this file registers the worker, offers updates, and keeps the
// browser's install prompt for Settings → Install App.
//
// Browser only: the phone and desktop apps load the same dist/ but must never
// run the worker, so every entry point checks isBrowserTab() first.
import { Capacitor } from "@capacitor/core";
import { toast } from "sonner";
import { isDesktopApp } from "./platform";
import { FULL_BUILD_PLAY_URL } from "./build-flavor";

/** Chrome and Edge's install prompt event (not in TypeScript's DOM types). */
interface BeforeInstallPromptEvent extends Event {
    prompt(): Promise<void>;
    userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

let installPrompt: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

const isBrowserTab = (): boolean => !Capacitor.isNativePlatform() && !isDesktopApp();

/** Running as the installed app, in its own window, rather than in a tab. */
export const isRunningInstalled = (): boolean =>
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;

/**
 * Phones and tablets have the store apps, so Settings doesn't offer the PWA
 * there. iPadOS reports itself as a Mac, so touch support is checked too.
 */
const isMobileDevice = (): boolean => {
    const uaData = (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData;
    if (uaData?.mobile) return true;
    const ua = navigator.userAgent;
    if (/Android|iPhone|iPad|iPod|Mobile/i.test(ua)) return true;
    return /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
};

/** Safari on a Mac installs with File → Add to Dock; it has no install prompt event. */
const isMacSafari = (): boolean => {
    const ua = navigator.userAgent;
    return /Macintosh/.test(ua) && /Safari\//.test(ua) && !/Chrome|Chromium|CriOS|Edg|Firefox|FxiOS|OPR/.test(ua);
};

const isWindows = (): boolean => /Windows NT/.test(navigator.userAgent);

/** The Windows app's installer, always the latest release (same link as the README). */
export const WINDOWS_APP_URL =
    "https://github.com/HotshotJacko1/Open-Keep/releases/latest/download/OpenKeep-windows-x64-setup.exe";

export type InstallOption = {
    /** Windows: the Windows app comes first, with its encrypted storage and AI tool access. */
    windowsApp: boolean;
    /** Chrome and Edge's install prompt, when the browser offered one. */
    install?: () => Promise<void>;
    /** Safari on a Mac: show the File → Add to Dock steps. */
    safari: boolean;
};

/** What Settings can offer to install the app here, or null for nothing. */
export const getInstallOption = (): InstallOption | null => {
    if (!isBrowserTab() || isRunningInstalled() || isMobileDevice()) return null;
    const install = installPrompt ? promptInstall : undefined;
    if (isWindows()) return { windowsApp: true, install, safari: false };
    if (install) return { windowsApp: false, install, safari: false };
    if (isMacSafari()) return { windowsApp: false, safari: true };
    return null;
};

export const APP_STORE_URL = "https://apps.apple.com/gb/app/open-keep/id6775857379";

/**
 * What the install link (app.openkeep.net/install) shows. null shows nothing:
 * in the phone and desktop apps, and when already running installed.
 */
export type InstallHelp =
    /** Windows: the Windows app first, the web app (when the browser offers it) second. */
    | { kind: "windows"; install?: () => Promise<void> }
    /** Chrome or Edge, with their install prompt ready. */
    | { kind: "prompt"; install: () => Promise<void> }
    /** Chrome or Edge without a prompt: not offered yet, or already installed. */
    | { kind: "chromium" }
    | { kind: "safari" }
    | { kind: "firefox" }
    /** Phones and tablets: the store apps. */
    | { kind: "phone"; storeName: string; storeUrl: string };

export const getInstallHelp = (): InstallHelp | null => {
    if (!isBrowserTab() || isRunningInstalled()) return null;
    const ua = navigator.userAgent;
    if (isMobileDevice()) {
        return /Android/i.test(ua)
            ? { kind: "phone", storeName: "Google Play", storeUrl: FULL_BUILD_PLAY_URL }
            : { kind: "phone", storeName: "the App Store", storeUrl: APP_STORE_URL };
    }
    const install = installPrompt ? promptInstall : undefined;
    if (isWindows()) return { kind: "windows", install };
    if (install) return { kind: "prompt", install };
    if (isMacSafari()) return { kind: "safari" };
    if (/Firefox\//.test(ua)) return { kind: "firefox" };
    return { kind: "chromium" };
};

/** The install link's path. Any other path shows the app's Not Found page. */
const INSTALL_PATH = "/install";
let installRequested = false;

/** True when the app was opened from the install link, until the box is closed. */
export const isInstallRequested = (): boolean => installRequested;
export const clearInstallRequest = (): void => {
    installRequested = false;
};

export const subscribeInstallOption =(listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
};

const promptInstall = async (): Promise<void> => {
    const prompt = installPrompt;
    if (!prompt) return;
    // A prompt event can only be used once.
    installPrompt = null;
    notify();
    await prompt.prompt();
    await prompt.userChoice;
};

/**
 * Called once at startup (main.tsx). The install prompt event can fire before
 * React renders, so it is caught here and kept for Settings.
 */
export const startPwa = (): void => {
    if (!isBrowserTab()) return;

    // The install link: remember it and continue as the normal app page, so the
    // router (which only knows "/") and a later reload both see "/".
    if (window.location.pathname.replace(/\/+$/, "") === INSTALL_PATH) {
        installRequested = true;
        window.history.replaceState(window.history.state, "", "/" + window.location.search + window.location.hash);
    }

    window.addEventListener("beforeinstallprompt", (event) => {
        // Keep it for the Settings button instead of Chrome's own banner on Android.
        event.preventDefault();
        installPrompt = event as BeforeInstallPromptEvent;
        notify();
    });
    window.addEventListener("appinstalled", () => {
        installPrompt = null;
        notify();
    });

    // `vite` dev serves no worker; a stale one would serve old files over hot reload.
    if (import.meta.env.DEV || !("serviceWorker" in navigator)) return;

    void import("virtual:pwa-register").then(({ registerSW }) => {
        const updateSW = registerSW({
            // A new version is downloaded and waiting. It is not switched to on its
            // own, because reloading could interrupt a note being typed; it starts
            // when the user reloads here, or the next time the app is opened.
            onNeedRefresh() {
                toast("A new version of Open Keep is ready", {
                    duration: Infinity,
                    action: { label: "Reload", onClick: () => void updateSW() },
                });
            },
            // Tabs and installed windows can stay open for days: look for a new
            // version every hour, as opening the app would.
            onRegisteredSW(_swUrl, registration) {
                if (!registration) return;
                setInterval(() => {
                    if (document.visibilityState === "visible" && navigator.onLine) {
                        void registration.update().catch(() => {});
                    }
                }, UPDATE_CHECK_INTERVAL_MS);
            },
            onRegisterError(error) {
                console.warn("Service worker registration failed:", error);
            },
        });
    });
};
