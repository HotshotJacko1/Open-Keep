// Copyright (c) 2026. Licensed under AGPLv3.
//
// Updates for the Windows `.exe` version (docs/plans/D1-windows-desktop.md).
// Tauri's updater reads latest.json from the newest GitHub release, checks the
// installer's signature against the public key in tauri.conf.json, and runs the
// installer in passive mode (a progress bar, no questions), which closes the
// app and reopens it on the new version.
//
// Not used by the Microsoft Store version (the Store updates it), dev builds,
// or anything that isn't the desktop app.

import { toast } from "sonner";
import type { Update } from "@tauri-apps/plugin-updater";
import { isDesktopApp } from "./platform";

/** After the notes are on screen, so the check never slows startup. */
const FIRST_CHECK_DELAY_MS = 15_000;
/** The app often lives in the tray for days, so check again daily. */
const CHECK_EVERY_MS = 24 * 60 * 60 * 1000;

/**
 * One toast for the offer, the download and any error. Showing the offer again
 * with the same id updates it in place if it's still open, or brings it back
 * if it was closed, so the daily check never stacks copies.
 */
const UPDATE_TOAST_ID = "desktop-update";

let started = false;
let installing = false;
let storePackage: Promise<boolean> | null = null;

/** What Settings → "Check for updates" shows. */
export type UpdateCheckResult =
    | { status: "available"; version: string; install: () => Promise<void> }
    | { status: "none" }
    | { status: "failed" }
    /** An update is already downloading. */
    | { status: "installing" };

const isStorePackage = (): Promise<boolean> => {
    storePackage ??= import("@tauri-apps/api/core")
        .then(({ invoke }) => invoke<boolean>("desktop_is_store_package"))
        // If the check itself fails, assume the Store version: better no offer than a wrong one.
        .catch(() => true);
    return storePackage;
};

/** True in the GitHub `.exe` version only: the Store updates its own. */
export const canCheckForUpdates = async (): Promise<boolean> =>
    isDesktopApp() && !import.meta.env.DEV && !(await isStorePackage());

const install = async (update: Update): Promise<void> => {
    installing = true;
    const id = toast.loading(`Downloading Open Keep ${update.version}…`, { id: UPDATE_TOAST_ID });
    try {
        await update.downloadAndInstall();
        // On Windows the installer closes the app and starts the new version, so
        // this only runs if it didn't.
        const { relaunch } = await import("@tauri-apps/plugin-process");
        await relaunch();
    } catch (error) {
        console.error("Update failed:", error);
        toast.error("The update couldn't be installed. Open Keep will offer it again later.", { id });
        installing = false;
    }
};

/**
 * Asks GitHub for a newer version, for Settings → "Check for updates", which
 * shows the answer itself (a toast's button may not be clickable while the
 * Settings dialog is open).
 */
export const findUpdate = async (): Promise<UpdateCheckResult> => {
    if (installing) return { status: "installing" };
    try {
        const { check } = await import("@tauri-apps/plugin-updater");
        const update = await check();
        if (installing) return { status: "installing" };
        if (!update) return { status: "none" };
        return { status: "available", version: update.version, install: () => install(update) };
    } catch (error) {
        // Offline, or no release with a latest.json yet.
        console.warn("Update check failed:", error);
        return { status: "failed" };
    }
};

/**
 * Offers the newest version. Runs at startup and then daily, so an offer that
 * was closed comes back the next day even if the app stays open in the tray.
 * Exported for tests.
 */
export const checkForUpdate = async (): Promise<void> => {
    const result = await findUpdate();
    if (result.status !== "available") return;
    toast(`Open Keep ${result.version} is available`, {
        id: UPDATE_TOAST_ID,
        description: "It restarts the app; your notes are kept.",
        duration: Infinity,
        action: { label: "Restart to update", onClick: () => void result.install() },
    });
};

/** Starts the update checks. Safe to call more than once. */
export const startDesktopUpdateChecks = async (): Promise<void> => {
    if (started) return;
    started = true;
    if (!(await canCheckForUpdates())) return;
    setTimeout(() => {
        void checkForUpdate();
        setInterval(() => void checkForUpdate(), CHECK_EVERY_MS);
    }, FIRST_CHECK_DELAY_MS);
};
