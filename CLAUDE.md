# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Open Keep — an open-source, privacy-focused, cross-platform (web/iOS/Android via Capacitor) note-taking app with local AES-256 encryption, optional cloud sync (Dropbox, Google Drive, OneDrive, WebDAV), and a local MCP bridge that lets AI tools read/write notes. AGPL-3.0.

## Commands

Package manager is **pnpm** (`packageManager: pnpm@10.34.5`). Node version is pinned in `.nvmrc` (24.21.0). It must match the Node that F-Droid installs from Debian forky, or the F-Droid reproducible-build check fails (see `metadata/com.jackbarkerapps.openkeep.yml` in fdroiddata).

```bash
pnpm install
pnpm dev            # vite dev server on port 8080
pnpm build           # production build: prebuild (scripts/sync-version.cjs), then tsc -b, then vite build
pnpm typecheck       # tsc -b only (app + vite config projects)
pnpm build:dev        # development-mode build
pnpm lint            # version check (sync-version.cjs --check: iOS MARKETING_VERSION must match build.gradle), then eslint .
pnpm preview          # preview a production build
```

The main app's unit tests run with `pnpm test` (Vitest). They cover the sync merge rules (`src/lib/sync-merge.test.ts`), the shared sync pipeline's conflict-resolution and write-back paths (`src/lib/cloud-sync-runner.test.ts`, with the database and providers mocked), App Lock relocking (`src/lib/app-relock.test.ts`), and helpers in `src/utils/` (markdown, text direction, note import/export). Codemagic and the release workflow both run them. The **mcp-server** sub-package has its own tests:

```bash
cd mcp-server
npm install
npm run build         # tsc -p tsconfig.json
npm test              # build, then run test/mock-roundtrip.mjs (end-to-end bridge protocol; prints a pass/fail count)
npm run pack:mcpb      # bundle the Claude Desktop extension into build/open-keep.mcpb
```

### Native mobile builds

After changing web code that affects the native shell, sync Capacitor:

```bash
npx cap sync ios
npx cap sync android
```

iOS builds are done via Codemagic (`codemagic.yaml`), triggered on push to `main`; it runs `pnpm install --frozen-lockfile` (via Corepack) then `pnpm lint` then `pnpm test` then `pnpm build` then `pnpm exec cap sync ios` then an Xcode archive/IPA build.

### App versioning

The **single source of truth for app version is `android/app/build.gradle`'s `versionName`**. `scripts/sync-version.cjs` runs as a `prebuild` step and copies that value into iOS's `MARKETING_VERSION` (`ios/App/App.xcodeproj/project.pbxproj`); `vite.config.ts` reads `build.gradle` itself for the `__APP_VERSION__` define. `pnpm lint` fails if the two have drifted. Bump the version by editing `build.gradle` only — do not hand-edit the iOS project version.

## Architecture

### Storage: native SQLCipher vs. web localStorage+WebCrypto

All note persistence goes through [src/lib/note-storage.ts](src/lib/note-storage.ts), which branches on `hasNativeStorage()` from [src/lib/platform.ts](src/lib/platform.ts) (Capacitor native, or the desktop app):

- **Native (iOS/Android)**: calls through a Capacitor plugin (`registerPlugin<NoteStoragePlugin>("NoteStorage")`) implemented natively in [android/app/src/main/java/com/jackbarkerapps/openkeep/NoteStoragePlugin.kt](android/app/src/main/java/com/jackbarkerapps/openkeep/NoteStoragePlugin.kt) and [ios/App/App/NoteStoragePlugin.swift](ios/App/App/NoteStoragePlugin.swift), backed by an on-disk SQLCipher-encrypted SQLite database (pulled in via Swift Package Manager from `sqlcipher/SQLCipher.swift`, declared in `ios/App/App.xcodeproj/project.pbxproj`). The PIN/passcode is the encryption key.
- **Windows desktop (Tauri, `src-tauri/`)**: Capacitor reports `web` there, so `isDesktopApp()` picks [src/lib/desktop-note-storage.ts](src/lib/desktop-note-storage.ts), the same plugin interface implemented in Rust ([src-tauri/src/storage/](src-tauri/src/storage/)) over SQLCipher built with LibTomCrypt in `src-tauri/build.rs`. Its key format must stay byte-compatible with Android's `KeyManager.kt` and `web-crypto.ts`; the auto-unlock key is in Windows Credential Manager. Use `hasNativeStorage()` for storage/encryption/lock behaviour and keep `Capacitor.isNativePlatform()` for things that need a Capacitor plugin. Plan and status: [docs/plans/D1-windows-desktop.md](docs/plans/D1-windows-desktop.md). Run with `pnpm desktop:dev`, build the installer with `pnpm desktop:build`, Rust tests with `cargo test` in `src-tauri`.
- **Web**: notes live in `localStorage` (`open-keep-notes` key) and are encrypted/decrypted via the WebCrypto API in [src/lib/web-crypto.ts](src/lib/web-crypto.ts), mirroring the native plugin's method signatures (`initializeDatabaseWeb`, `encryptDataWeb`, etc.).

Both backends expose the same async API surface (`loadNotes`, `saveNote`, `deleteNote`, `initializeDatabase`, `checkDatabaseStatus`, `changeEncryptionKey`, `exportMasterKey`/`importMasterKey` for cross-device key transfer, `wipeDatabaseButKeepKeys`, `clearAllData`). Callers (UI code) should generally go through this module rather than branching on platform themselves.

Legacy data migration: old "list"-type notes (with an `items` array) are converted on load into markdown checklists (`- [ ] ...`); see `parseNote` in `note-storage.ts`.

### App boot / lock flow

[src/App.tsx](src/App.tsx) drives a state machine (`loading` → `setup`/`locked`/`ready`) that decides whether to show the passcode `LockScreen`, an initialization error screen, or the main `Index` route. Native builds auto-initialize the DB with a transparent (empty) key if none is configured yet; a failed native key verification on first real read dispatches a `window` event (`open-keep-db-unverified`) that forces the app back to the lock screen (see the comment in `App.tsx` for why this can't be decided at `checkStatus` time). Widget deep links (Android/iOS home-screen widgets) are captured via `ensureWidgetDeepLinkCapture()` even while locked, so a tap isn't lost behind the lock screen.

### Cloud sync and multi-device key conflicts

Cloud sync (Dropbox/Google Drive/OneDrive/WebDAV, under `src/lib/dropbox*.ts`, `src/lib/google-drive.ts`, `src/lib/one-drive*.ts`, `src/lib/webdav.ts`) does not store notes in plaintext in the cloud — a "cloud master key" (the local encryption key, wrapped) is synced alongside the notes so another device can decrypt them. [src/lib/cloud-sync-resolver.ts](src/lib/cloud-sync-resolver.ts) and [src/lib/cloud-sync-state.ts](src/lib/cloud-sync-state.ts) handle the conflict case where a device's local PIN doesn't match the cloud-stored key: the user is prompted for the *other* device's PIN, and the resolution can keep local data, replace with cloud data, or merge (`forceResolution: "local" | "cloud" | "merge"`).

The providers share one cloud file format ([src/lib/sync-data.ts](src/lib/sync-data.ts)) and one merge ([src/lib/sync-merge.ts](src/lib/sync-merge.ts)); each provider owns only transport and the outer encryption wrapping. A permanent delete records a **tombstone** ([src/lib/tombstones.ts](src/lib/tombstones.ts)) that syncs in the same file, so other devices drop the note rather than merging it back; tombstones are kept 180 days. Custom labels work the same way through `tagChanges` (the latest create or delete per label wins; a rename is a delete plus a create). Older app versions ignore the tombstone fields and re-upload without them, so every device keeps its own copy and restores them on its next sync. Design and rules: [docs/plans/C3-01-tombstones.md](docs/plans/C3-01-tombstones.md).

### WebDAV and self-hosting

WebDAV sync ([src/lib/webdav.ts](src/lib/webdav.ts)) is plain HTTP with Basic auth: `fetch` on web (the server must allow CORS, or be on the same origin), `CapacitorHttp` on native. Android's HttpURLConnection refuses `MKCOL`, so folder creation there goes through [WebDavFolderPlugin.kt](android/app/src/main/java/com/jackbarkerapps/openkeep/WebDavFolderPlugin.kt), registered in both flavors' `MainActivity`. Writes are conditional (`If-Match`, else `If-Unmodified-Since` when the server only gives weak ETags) and re-merge on 412. `pnpm webdav:dev` runs a local test server (`--proxy <url>` puts a CORS proxy in front of a real server); see [scripts/webdav-dev-server.mjs](scripts/webdav-dev-server.mjs).

`VITE_APP_FLAVOR=selfhost` is the web build for running on your own server ([src/lib/build-flavor.ts](src/lib/build-flavor.ts)): no Supabase session (so no usage counting or feedback prompt), WebDAV the only sync option. The [Dockerfile](Dockerfile) builds it and serves it with nginx; [docker/40-open-keep-config.sh](docker/40-open-keep-config.sh) turns `OPENKEEP_*` env vars into `config.js` (read by [src/lib/runtime-config.ts](src/lib/runtime-config.ts)) and an optional `/webdav/` forward. [.github/workflows/docker-image.yml](.github/workflows/docker-image.yml) checks and publishes the image to GHCR on version tags. User docs: [SELF_HOSTING.md](SELF_HOSTING.md).

### MCP bridge (AI assistant access)

Three pieces implement "let an AI tool read/write your notes":

- **Browser side**: [src/lib/mcp-bridge/](src/lib/mcp-bridge/) (`bridge-client.ts`, `protocol.ts`) — the open Open Keep tab connects *out* to a local WebSocket server (a tab can't listen for connections itself).
- **Node side**: [mcp-server/](mcp-server/) — a standalone `@openkeep/mcp-server` npm package that implements the actual MCP server (via `@modelcontextprotocol/sdk`) and the WebSocket relay (`bridge-server.ts`) the browser tab connects to. It can be packaged as a Claude Desktop extension (`npm run pack:mcpb`).
- **Desktop app**: `open-keep.exe --mcp` ([src-tauri/src/mcp/](src-tauri/src/mcp/)) is a Rust port of the Node server, so desktop users need no Node or `.mcpb`; Settings → AI Assistant Access sets AI tools up to start it (one click for Claude Desktop). It reads the pairing token from Windows Credential Manager, where the app keeps it. Its tool list, `tools.json`, is generated from `mcp-server/src/server.ts` by `npm run export-tools` (mcp-server's `npm test` fails while stale), and `npm run test:relay` runs mcp-server's tests against it after `cargo build`.

The two `protocol.ts` files (browser-side and mcp-server-side) are **hand-synced mirrors, not a shared import**, and `src-tauri/src/mcp/bridge.rs` is a third copy of the server side — if you change the wire protocol (request/response shapes, `BridgeOp` union, error codes), update all three identically. Read/write access is gated by two independent user-controlled switches in Settings, and every AI write is undoable and tagged (`ai-created`/`ai-edited`); see [MCP.md](MCP.md) for the full user-facing command list and safety model.

### Notes data model

The canonical `Note` shape is [src/types/note.ts](src/types/note.ts). Notes have no separate "list" type anymore in the UI — checklists are represented as markdown checkbox syntax inside `content` (see `CHECKBOX_REGEX` in [src/utils/markdown.ts](src/utils/markdown.ts)); the `type: 'list'` field only exists to keep an all-checkbox note from collapsing when its body would otherwise look empty. Note limits (title/body length, list item counts) live in [src/lib/note-limits.ts](src/lib/note-limits.ts); colors are a fixed palette normalized through [src/lib/note-colors.ts](src/lib/note-colors.ts) (unrecognized ids fall back to default rather than erroring).

### Frontend structure

- Routes live in `src/App.tsx` (per [AI_RULES.md](AI_RULES.md) convention) — currently just `Index` (the whole app) and a catch-all `NotFound`.
- `src/pages/Index.tsx` is the main page composing the note grid/list, sidebar, top bar, and dialogs.
- `src/components/ui/` is shadcn/ui — generated primitives; don't hand-edit, wrap/extend instead.
- `src/components/` holds the app's own components (dialogs, note editor/card, lock screen, settings, etc.).
- Path alias `@/*` → `src/*` (configured in `vite.config.ts` and `tsconfig`).
- The web app is an installable PWA: `vite-plugin-pwa` in `vite.config.ts` builds the manifest and a Workbox service worker into `dist/`. [src/lib/pwa.ts](src/lib/pwa.ts) registers it **only in a browser tab** (never on Capacitor native or the desktop app, which ship the same `dist/`), shows a "new version ready" toast instead of reloading on its own, and keeps the install prompt for Settings → App ([InstallAppSettings.tsx](src/components/InstallAppSettings.tsx), desktop browsers only; on Windows it offers the Windows app first, with the web app as a smaller second choice). The website's install link, `app.openkeep.net/install`, is caught in `startPwa()` (the address is rewritten to `/` before the router sees it) and opens [InstallAppDialog.tsx](src/components/InstallAppDialog.tsx) with steps for that browser, or the store app on phones; `src/lib/pwa.test.ts` covers which browser gets what. `config.js` is never precached, so self-hosted config changes still apply. To remove the worker from browsers that have it, set `selfDestroying: true` and deploy.
- State that needs to survive across the app: `src/context/session-provider.tsx` (Supabase auth session) and `theme-provider.tsx`.

### Backend touchpoints

Supabase is used minimally and not for note storage: anonymous auth for usage counting/feedback prompts, and one edge function, [supabase/functions/google-token-exchange](supabase/functions/google-token-exchange), for the Google Drive OAuth token exchange (see [GOOGLE_SETUP.md](GOOGLE_SETUP.md) / [AZURE_SETUP.md](AZURE_SETUP.md) for the OAuth app setup those integrations depend on). No user note content ever leaves the device except to the cloud storage provider the user explicitly connects.

### Importers/exporters

[src/utils/import-manager.ts](src/utils/import-manager.ts) dispatches to format-specific importers in `src/utils/importers/` (`google-keep.ts`, `markdown.ts`). `src/components/GoogleKeepMigrationGuide.tsx` is the Google Keep migration guide referenced in the README's "DeGoogled" positioning, opened from Settings → "Google Keep Import Guide".
