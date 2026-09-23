import type { CapacitorConfig } from '@capacitor/cli';
import { readFileSync } from 'node:fs';

// The F-Droid build ("fdroid" flavor, VITE_APP_FLAVOR=fdroid) must not compile
// @capgo/capacitor-social-login at all: its Android module pulls in Google Play
// Services and the Facebook SDK. Capacitor only accepts an allowlist here, so
// build it from package.json so new plugins are picked up automatically.
// The app never calls SocialLogin in this flavor (see src/lib/build-flavor.ts).
const isFdroid = process.env.VITE_APP_FLAVOR === 'fdroid';
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const fdroidPlugins = Object.keys(pkg.dependencies ?? {}).filter(
  (name) => name !== '@capgo/capacitor-social-login',
);

const config: CapacitorConfig = {
  appId: 'com.jackbarkerapps.openkeep',
  appName: 'Open Keep',
  webDir: 'dist',
  plugins: {
    // Open Keep only uses Google sign-in (Drive sync, play flavor). Without this
    // the plugin bundles the Facebook SDK into the Android app by default.
    // Read by the plugin's `capacitor:sync:before` hook, which writes its
    // android/gradle.properties. (iOS uses SPM, which this setting doesn't touch.)
    SocialLogin: {
      providers: {
        facebook: false,
      },
    },
  },
  ...(isFdroid ? { android: { includePlugins: fdroidPlugins } } : {}),
};

export default config;
