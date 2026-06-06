// Copyright (c) 2026. Licensed under AGPLv3.

/** Shared auth state across hook instances to prevent concurrent Google sign-in loops. */
let ensureTokenPromise: Promise<string> | null = null;
let scopeBlockedUntil = 0;

const SCOPE_BLOCK_MS = 60_000;

export const isGoogleDriveAuthBusy = (): boolean => ensureTokenPromise !== null;

export const isGoogleDriveScopeBlocked = (): boolean => Date.now() < scopeBlockedUntil;

export const blockGoogleDriveScopeAuth = (): void => {
    scopeBlockedUntil = Date.now() + SCOPE_BLOCK_MS;
};

export const clearGoogleDriveScopeBlock = (): void => {
    scopeBlockedUntil = 0;
};

export const runGoogleDriveTokenEnsure = (task: () => Promise<string>): Promise<string> => {
    if (ensureTokenPromise) {
        return ensureTokenPromise;
    }

    ensureTokenPromise = task().finally(() => {
        ensureTokenPromise = null;
    });

    return ensureTokenPromise;
};
