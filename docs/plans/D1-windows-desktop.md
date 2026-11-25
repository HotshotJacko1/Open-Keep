# D1 — Windows desktop app

Status: plan, not started (2026-11-25).

Goal: a Windows app people download and install (a setup `.exe`, later the
Microsoft Store), running the same React app as web/iOS/Android, with the same
encryption, sync and AI bridge.

## What tasks.org does

The installed Tasks.org desktop app (`TasksOrg_15.14.1.0`) is a Kotlin/Compose
Multiplatform JVM app packaged by **Hydraulic Conveyor** as a signed MSIX, with
Conveyor's `updatecheck.exe` as the entry point for auto-updates. It reuses the
Android app's Kotlin code. Open Keep's shared code is the web app, so the
equivalent move for us is a **web-view shell**, not a JVM app.

## Choice of shell

| | Tauri 2 (recommended) | Electron |
|---|---|---|
| Installer size | ~5–10 MB (uses Windows' built-in WebView2) | ~90–120 MB (ships Chromium) |
| Native code | Rust | Node/TypeScript |
| SQLCipher | `rusqlite` with `bundled-sqlcipher` | `better-sqlite3-multiple-ciphers` |
| Deep links, single instance, tray, notifications, auto-update | Official plugins | Built in / electron-builder |
| Installers | NSIS `.exe` and MSI out of the box; MSIX via extra tooling | NSIS, MSI, MSIX via electron-builder |
| macOS/Linux later | Same project | Same project |

Tauri fits the privacy/lightweight positioning, and adding one Rust storage
plugin is the same kind of work as the existing Kotlin and Swift
`NoteStoragePlugin`s. Electron is the fallback if Rust turns out to be a burden.

Not chosen:
- **PWA install** (Edge/Chrome "Install app") works today at zero cost, but
  there is no `.exe`, data lives in the browser profile, and no `openkeep://`
  links. Worth mentioning on the website regardless.
- **Capacitor Electron** (`@capacitor-community/electron`): community-maintained
  and lags Capacitor releases; our native plugins would need rewriting anyway.

## How the existing code behaves inside the shell

In Tauri `Capacitor.isNativePlatform()` is `false`, so the app takes the
**web** paths everywhere. That is the starting point, and most of it works
unchanged:

| Area | Inside Tauri as-is | Work needed |
|---|---|---|
| Notes storage (`note-storage.ts`) | localStorage + WebCrypto in WebView2's profile dir — works, encrypted | v1: none. v2: native SQLCipher plugin (below) |
| WebDAV sync | Works (fetch); CORS stops applying if requests go through Tauri's HTTP plugin | Route through `@tauri-apps/plugin-http` to avoid CORS on servers without it |
| Dropbox / OneDrive | Web path redirects to `window.location.origin` (`http://tauri.localhost`), which isn't registered | Use the **mobile** flow: open the system browser, come back on `openkeep://auth` (already registered with Dropbox and Azure, handled by `oauth-redirect.ts`) via `tauri-plugin-deep-link` |
| Google Drive | Native path needs `capacitor-social-login` (mobile only); web path's Google Identity popup needs a registered JS origin | New Google OAuth client of type *Desktop app*: PKCE + loopback redirect (`http://127.0.0.1:<port>`), token exchange through the existing Supabase function. **Verify before promising** |
| MCP bridge | The tab dials out to `ws://127.0.0.1:<port>` — works the same from WebView2 | Allow it in the Tauri CSP. Later: the app can start the MCP server itself |
| Reminders | Web path: `Notification` API while the app is open | Keep the app alive in the tray (close → minimise to tray, optional start at login) |
| App Lock biometrics | `capacitor-native-biometric` is mobile only | v1: PIN only. v2: Windows Hello |
| Widgets | n/a | Skip |
| Clipboard images, export/share | Web paths | Check export uses a save dialog (`plugin-dialog`/`plugin-fs`) rather than a browser download |

A small `isDesktop` helper (e.g. `"__TAURI_INTERNALS__" in window`) next to
`build-flavor.ts` decides the desktop-only branches above, so UI code doesn't
check for Tauri itself.

## Storage: v2 native database

Same pattern as Android/iOS: a Rust plugin exposing the `NoteStoragePlugin`
methods (`initializeDatabase`, `loadNotes`, `saveNote`, `changeEncryptionKey`,
`exportMasterKey`, …) over an SQLCipher file in `%APPDATA%\com.jackbarkerapps.openkeep\`.
`note-storage.ts` gets a third branch. On first launch of v2, notes are read
through the web path and written into the database, then the localStorage copy
is cleared once the write is verified. Reasons to do it: no localStorage size
ceiling (images), a real file users can back up, and parity with mobile.

## Packaging and distribution

1. **Setup `.exe` (NSIS, per-user, no admin)** attached to GitHub Releases,
   built by a new `windows` job in `.github/workflows/release.yml` using
   `tauri-action` on `windows-latest`.
2. **Code signing.** Unsigned installers get the SmartScreen "Windows protected
   your PC" warning. Options, cheapest first:
   - Microsoft Store: the Store signs it, no warning, updates handled.
   - SignPath Foundation: free signing for open-source projects (application
     and review needed).
   - Azure Trusted/Artifact Signing (~US$10/month): check whether it's open to
     individual developers in the UK before relying on it.
3. **Auto-update** for the GitHub build: `tauri-plugin-updater` reading a
   `latest.json` from the release (needs its own update-signing key, kept as a
   GitHub secret — separate from Authenticode).
4. **Microsoft Store** (MSIX) and **winget** manifest once the app is stable.

Versioning: `tauri.conf.json` takes its version from `build.gradle` like iOS
does — extend `scripts/sync-version.cjs` (and its `--check` in `pnpm lint`).

## Phases

**0. Spike (1–2 days).** `src-tauri/` scaffold loading `dist/`; confirm notes
persist across restarts, encryption/PIN works, WebDAV sync, MCP bridge connects,
CSP is right. Decide Tauri vs Electron here.

**1. Usable beta.** Desktop OAuth for Dropbox and OneDrive via `openkeep://`;
single-instance (second launch focuses the window and forwards deep links);
window size/position memory; tray + reminders; native save dialogs; Windows
icons; unsigned NSIS installer from CI, released as "beta".

**2. Release.** Google Drive desktop sign-in; signing; auto-updater; SQLCipher
storage + migration; Windows Hello for App Lock; Store and winget listings;
README/website download section; changelog entry.

**3. Later.** macOS and Linux builds from the same `src-tauri/`; the app
starting the MCP server itself so AI tools work without a separate install.

## Open decisions

- Tauri or Electron (recommend Tauri; confirm in the spike).
- Distribution first: GitHub `.exe` + SignPath, or Store first.
- Is Google Drive required for the first public release, or can it follow?
