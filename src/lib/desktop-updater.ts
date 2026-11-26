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

let started = false;
let offeredVersion: string | null = null;

const install = async (update: Update): Promise<void> => {
    const id = toast.loading(`Downloading Open Keep ${update.version}…`);
    try {
        await update.downloadAndInstall();
        // On Windows the installer closes the app and starts the new version, so
        // this only runs if it didn't.
        const { relaunch } = await import("@tauri-apps/plugin-process");
        await relaunch();
    } catch (error) {
        console.error("Update failed:", error);
        toast.error("The update couldn't be installed. Open Keep will offer it again later.", { id });
        offeredVersion = null;
    }
};

const checkForUpdate = async (): Promise<void> => {
    try {
        const { check } = await import("@tauri-apps/plugin-updater");
        const update = await check();
        // Offer each version once per session; a dismissed offer returns tomorrow.
        if (!update || update.version === offeredVersion) return;
        offeredVersion = update.version;
        toast(`Open Keep ${update.version} is available`, {
            description: "It restarts the app; your notes are kept.",
            duration: Infinity,
            action: { label: "Restart to update", onClick: () => void install(update) },
        });
    } catch (error) {
        // Offline, or no release with a latest.json yet: try again at the next check.
        console.warn("Update check failed:", error);
    }
};

/** Starts the update checks. Safe to call more than once. */
export const startDesktopUpdateChecks = async (): Promise<void> => {
    if (started || !isDesktopApp() || import.meta.env.DEV) return;
    started = true;
    const { invoke } = await import("@tauri-apps/api/core");
    // If the check itself fails, assume the Store version: better no offer than a wrong one.
    const isStorePackage = await invoke<boolean>("desktop_is_store_package").catch(() => true);
    if (isStorePackage) return;
    setTimeout(() => {
        void checkForUpdate();
        setInterval(() => void checkForUpdate(), CHECK_EVERY_MS);
    }, FIRST_CHECK_DELAY_MS);
};
