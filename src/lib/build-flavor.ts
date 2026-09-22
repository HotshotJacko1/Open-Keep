// Copyright (c) 2026. Licensed under AGPLv3.
/**
 * Build flavor detection for the Play vs. F-Droid split.
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
 */
export const APP_FLAVOR = import.meta.env.VITE_APP_FLAVOR || "play";

export const isGoogleDriveSyncAvailable = APP_FLAVOR !== "fdroid";

// Shown next to the greyed-out Google Drive option in the F-Droid build.
// TODO: confirm/replace the GitHub link once full-build APKs are actually
// published as GitHub releases -- there isn't one today (checked 2026-09-22).
export const FULL_BUILD_PLAY_URL = "https://play.google.com/store/apps/details?id=com.jackbarkerapps.openkeep";
export const FULL_BUILD_GITHUB_URL = "https://github.com/HotshotJacko1/Open-Keep/releases";
