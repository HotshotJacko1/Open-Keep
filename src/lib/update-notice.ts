// Copyright (c) 2026. Licensed under AGPLv3.
//
// "App updated" card: shown on the first launch after the app's version
// changes, until the user taps Dismiss or What's New.

export const LAST_SEEN_VERSION_KEY = "last-seen-app-version";

/**
 * Written on every Index mount by every version before this feature, so its
 * presence without a last-seen version means an upgrade, not a fresh install.
 */
const EXISTING_INSTALL_MARKER_KEY = "sort-mode";

type KeyValueStorage = Pick<Storage, "getItem" | "setItem">;

/**
 * Whether to show the update card for `currentVersion`. A fresh install
 * records the version straight away so it never sees the card for the
 * version it was installed at.
 */
export const shouldShowUpdateNotice = (
    currentVersion: string,
    storage: KeyValueStorage = localStorage,
): boolean => {
    try {
        const lastSeen = storage.getItem(LAST_SEEN_VERSION_KEY);
        if (lastSeen === currentVersion) return false;
        if (lastSeen === null && storage.getItem(EXISTING_INSTALL_MARKER_KEY) === null) {
            storage.setItem(LAST_SEEN_VERSION_KEY, currentVersion);
            return false;
        }
        return true;
    } catch {
        return false;
    }
};

export const markUpdateNoticeSeen = (
    currentVersion: string,
    storage: KeyValueStorage = localStorage,
): void => {
    try {
        storage.setItem(LAST_SEEN_VERSION_KEY, currentVersion);
    } catch {
        // Storage unavailable: the card may show again next launch.
    }
};
