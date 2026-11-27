/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from "vite";
import dyadComponentTagger from "@dyad-sh/react-vite-component-tagger";
import react from "@vitejs/plugin-react-swc";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import { VitePWA } from "vite-plugin-pwa";
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
      // Installable web app (PWA): the manifest, and a service worker that keeps
      // the app's files on the device so it opens offline. The worker is only
      // registered in a browser (src/lib/pwa.ts), never in the phone or desktop
      // apps, which ship dist/ too. To take it back out of browsers that already
      // have it, set `selfDestroying: true` and deploy.
      VitePWA({
        injectRegister: false,
        registerType: "prompt",
        includeAssets: ["favicon.svg", "favicon.ico", "icons/apple-touch-icon.png"],
        manifest: {
          id: "/",
          name: "Open Keep",
          short_name: "Open Keep",
          description: "Private, encrypted notes with optional sync.",
          start_url: "/",
          scope: "/",
          display: "standalone",
          background_color: "#ffffff",
          theme_color: "#ffffff",
          icons: [
            { src: "/icons/pwa-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
            { src: "/icons/pwa-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
            { src: "/icons/pwa-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
          ],
        },
        workbox: {
          globPatterns: ["**/*.{js,css,html,svg,ico,png,woff2}"],
          // config.js is rewritten at every start of the self-hosted container,
          // so it is fetched fresh (below), never served from the precache.
          globIgnores: ["config.js", "**/*.map"],
          maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
          navigateFallback: "index.html",
          // The self-hosted image forwards /webdav/ to the WebDAV server.
          navigateFallbackDenylist: [/^\/webdav\//],
          cleanupOutdatedCaches: true,
          // No .map files in dist/: it is copied into the phone and desktop apps.
          sourcemap: false,
          runtimeCaching: [
            {
              urlPattern: ({ url, sameOrigin }) => sameOrigin && url.pathname === "/config.js",
              handler: "NetworkFirst",
              options: { cacheName: "open-keep-config", networkTimeoutSeconds: 3 },
            },
          ],
        },
      }),
      // Must come last so it sees the final emitted bundle.
      ...(uploadSourcemaps
        ? [
          sentryVitePlugin({
            org: "jack-barker-apps",
            project: "openkeep",
            // No `url` on purpose. Organization auth tokens (sntrys_...)
            // embed their own region and sentry-cli overrides any manually
            // configured URL with it, warning as it does so. The de.sentry.io
            // seen in browser links is the EU storage region; the token
            // resolves the org correctly on its own.
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
    test: {
      // Claude worktrees under .claude/ hold full copies of src/, tests
      // included; vitest's default exclude would run those too (C4-18).
      exclude: ["**/node_modules/**", "**/.git/**", ".claude/**", "dist/**"],
    },
  };
});
