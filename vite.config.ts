import { defineConfig, loadEnv } from "vite";
import dyadComponentTagger from "@dyad-sh/react-vite-component-tagger";
import react from "@vitejs/plugin-react-swc";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import path from "path";
import fs from "fs";

// Read version from build.gradle
const buildGradlePath = path.resolve(import.meta.dirname, 'android/app/build.gradle');
let appVersion = 'Unknown';
try {
  if (fs.existsSync(buildGradlePath)) {
    const buildGradle = fs.readFileSync(buildGradlePath, 'utf8');
    const versionMatch = buildGradle.match(/versionName\s+"([^"]+)"/);
    if (versionMatch && versionMatch[1]) {
      appVersion = versionMatch[1];
    }
  }
} catch (e) {
  console.error('Failed to parse build.gradle for version', e);
}

export default defineConfig(({ mode }) => {
  // Third arg "" loads vars with no prefix filter, so SENTRY_AUTH_TOKEN is
  // visible here. It is only ever read inside the plugin config below - it is
  // never passed to `define`, so it cannot leak into the client bundle.
  const env = loadEnv(mode, process.cwd(), "");
  const sentryAuthToken = env.SENTRY_AUTH_TOKEN;

  // Only upload on a real production build, and only when a token exists.
  // Without a token the build behaves exactly as it did before this change.
  const uploadSourcemaps = mode === "production" && !!sentryAuthToken;

  return {
    server: {
      host: "::",
      port: 8080,
    },
    define: {
      __APP_VERSION__: JSON.stringify(appVersion)
    },
    build: {
      // "hidden" emits .map files but writes NO //# sourceMappingURL comment
      // into the bundle, so the shipped JS never advertises them. Combined
      // with filesToDeleteAfterUpload below, maps reach Sentry and nothing
      // else - important because `npx cap sync` copies dist/ into the APK.
      sourcemap: uploadSourcemaps ? "hidden" : false,
    },
    plugins: [
      dyadComponentTagger(),
      react(),
      // Must come last so it sees the final emitted bundle.
      ...(uploadSourcemaps
        ? [
          sentryVitePlugin({
            org: "jack-barker-apps",
            project: "openkeep",
            // EU region. Omitting this points sentry-cli at sentry.io and
            // fails with a misleading auth error.
            url: "https://de.sentry.io/",
            authToken: sentryAuthToken,
            telemetry: false,
            sourcemaps: {
              // Delete maps once uploaded so they never ship inside the app.
              filesToDeleteAfterUpload: ["./dist/**/*.map"],
            },
            release: {
              // @sentry/capacitor sets the release natively
              // (com.jackbarkerapps.openkeep@<versionName>+<versionCode>).
              // Letting the plugin inject its own git-derived release name
              // would override that and break the release tagging that
              // currently works. Matching is by debug ID, which needs neither.
              create: false,
              inject: false,
            },
          }),
        ]
        : []),
    ],
    resolve: {
      alias: {
        "@": path.resolve(import.meta.dirname, "./src"),
      },
    },
  };
});
