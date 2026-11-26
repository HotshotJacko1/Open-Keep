// Copyright (c) 2026. Licensed under AGPLv3.
import { Capacitor } from "@capacitor/core";

/**
 * The Windows desktop app (Tauri, src-tauri/). Capacitor reports "web" there,
 * because it is the web build in a WebView2 window, so Capacitor's own checks
 * can't tell it apart from a browser tab.
 */
export const isDesktopApp = (): boolean =>
    typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/**
 * Notes live in an encrypted SQLCipher database with the key kept by the OS
 * (Keystore, Keychain or Windows Credential Manager), rather than in this
 * page's localStorage. True on Android, iOS and the desktop app.
 *
 * Use this for storage, encryption and lock behaviour. Keep
 * Capacitor.isNativePlatform() for things that need a Capacitor plugin
 * (Filesystem, biometrics, local notifications, the share sheet...), which
 * the desktop app doesn't have.
 */
export const hasNativeStorage = (): boolean =>
    Capacitor.isNativePlatform() || isDesktopApp();

/**
 * Dropbox and OneDrive sign-in happens in the system browser, which comes back
 * to the app on openkeep://auth (see oauth-redirect.ts), rather than by
 * redirecting this page. True on Android, iOS and desktop.
 */
export const usesAppSignInRedirect = (): boolean =>
    Capacitor.isNativePlatform() || isDesktopApp();

/** Opens `url` outside the app: the default browser on desktop, the in-app browser sheet on phones. */
export const openInSystemBrowser = async (url: string): Promise<void> => {
    if (isDesktopApp()) {
        const { openUrl } = await import("@tauri-apps/plugin-opener");
        await openUrl(url);
        return;
    }
    const { Browser } = await import("@capacitor/browser");
    await Browser.open({ url });
};
