// Copyright (c) 2026. Licensed under AGPLv3.
/**
 * Build flavor detection: the Play vs. F-Droid split, plus the self-hosted web build.
 *
 * Set VITE_APP_FLAVOR=fdroid when building the F-Droid variant (matching the
 * "fdroid" Android product flavor in android/app/build.gradle) to disable
 * everything that depends on Google Play Services:
 *
 *   VITE_APP_FLAVOR=fdroid npm run build && npx cap sync android && \
 *     cd android && ./gradlew assembleFdroidRelease
 *
 * Google Drive sync uses @capgo/capacitor-social-login's native Google
 * sign-in, which bundles GMS and is not permitted in F-Droid builds (see
 * initNativeGoogleAuth() in src/hooks/use-google-drive.ts). OneDrive
 * (@azure/msal-browser, browser-based OAuth) and Dropbox (dropbox SDK,
 * browser-based OAuth) have no such dependency and are unaffected by this
 * flag -- they work identically in both builds.
 *
 * VITE_APP_FLAVOR=selfhost is the web app for running on your own server (the
 * Dockerfile, SELF_HOSTING.md). It never contacts Open Keep's own services:
 * no Supabase (anonymous sign-in, usage counting, feedback prompt), no Vercel
 * page-view analytics, and only WebDAV sync. Google Drive needs Open Keep's Supabase token exchange, and
 * Dropbox/OneDrive sign in through Open Keep's app registrations, which only
 * send people back to Open Keep's own addresses.
 */
export const APP_FLAVOR = import.meta.env.VITE_APP_FLAVOR || "play";

export const isSelfHosted = APP_FLAVOR === "selfhost";

export const isGoogleDriveSyncAvailable = APP_FLAVOR !== "fdroid" && !isSelfHosted;

/** Dropbox and OneDrive: only where Open Keep's app registrations can send people back. */
export const areOAuthSyncProvidersAvailable = !isSelfHosted;

/** Usage counting and the feedback prompt (anonymous Supabase session), and Vercel page-view analytics. */
export const isUsageReportingEnabled = !isSelfHosted;

// Shown next to the greyed-out Google Drive option in the F-Droid build.
// GitHub releases carry the full build as OpenKeep-<version>-android-full.apk
// (.github/workflows/release.yml).
export const FULL_BUILD_PLAY_URL = "https://play.google.com/store/apps/details?id=com.jackbarkerapps.openkeep";
export const FULL_BUILD_GITHUB_URL = "https://github.com/HotshotJacko1/Open-Keep/releases";
