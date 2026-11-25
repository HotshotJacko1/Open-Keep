// Copyright (c) 2026. Licensed under AGPLv3.

/**
 * Settings a self-hoster sets when starting the Docker container, without
 * rebuilding: public/config.js, rewritten from environment variables at
 * container start (docker/40-open-keep-config.sh, SELF_HOSTING.md). Empty in
 * every other build. Only suggestions for the user, never anything secret:
 * the file is public.
 */
export interface RuntimeConfig {
    /** Pre-filled WebDAV address. May be a path on this site, e.g. "/webdav/remote.php/dav/files/". */
    webdavUrl?: string;
    /** Pre-filled WebDAV folder. */
    webdavFolder?: string;
}

declare global {
    interface Window {
        __OPEN_KEEP_CONFIG__?: RuntimeConfig;
    }
}

const asString = (value: unknown): string | undefined =>
    typeof value === "string" && value.trim() ? value.trim() : undefined;

export const getRuntimeConfig = (): RuntimeConfig => {
    const raw = typeof window !== "undefined" ? window.__OPEN_KEEP_CONFIG__ : undefined;
    if (!raw || typeof raw !== "object") return {};
    return { webdavUrl: asString(raw.webdavUrl), webdavFolder: asString(raw.webdavFolder) };
};

/** The configured WebDAV address as a full URL, resolving a path against this site. */
export const configuredWebDavUrl = (): string | undefined => {
    const { webdavUrl } = getRuntimeConfig();
    if (!webdavUrl) return undefined;
    try {
        return new URL(webdavUrl, window.location.href).toString();
    } catch {
        return undefined;
    }
};
