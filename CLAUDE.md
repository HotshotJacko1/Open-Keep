# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Open Keep — an open-source, privacy-focused, cross-platform (web/iOS/Android via Capacitor) note-taking app with local AES-256 encryption, optional cloud sync (Dropbox, Google Drive, OneDrive), and a local MCP bridge that lets AI tools read/write notes. AGPL-3.0.

## Commands

Package manager is **pnpm** (`packageManager: pnpm@10.34.5`). Node version is pinned in `.nvmrc` (22.22.2).

```bash
pnpm install
pnpm dev            # vite dev server on port 8080
pnpm build           # production build: prebuild (scripts/sync-version.cjs), then tsc -b, then vite build
pnpm typecheck       # tsc -b only (app + vite config projects)
pnpm build:dev        # development-mode build
pnpm lint            # eslint .
pnpm preview          # preview a production build
```

There is no unit test suite for the main app. The **mcp-server** sub-package has its own tests:

```bash
cd mcp-server
npm install
npm run build         # tsc -p tsconfig.json
npm test              # build, then run test/mock-roundtrip.mjs (28 assertions, end-to-end bridge protocol)
npm run pack:mcpb      # bundle the Claude Desktop extension into build/open-keep.mcpb
```

### Native mobile builds

After changing web code that affects the native shell, sync Capacitor:

```bash
npx cap sync ios
npx cap sync android
```

iOS builds are done via Codemagic (`codemagic.yaml`), triggered on push to `main`; it runs `pnpm install --frozen-lockfile` (via Corepack) then `pnpm build` then `pnpm exec cap sync ios` then an Xcode archive/IPA build.

### App versioning

The **single source of truth for app version is `android/app/build.gradle`'s `versionName`**. `scripts/sync-version.cjs` runs as a `prebuild` step and copies that value into iOS's `MARKETING_VERSION` (`ios/App/App.xcodeproj/project.pbxproj`) and into `vite.config.ts`'s `__APP_VERSION__` define. Bump the version by editing `build.gradle` only — do not hand-edit the iOS project version.

## Architecture

### Storage: native SQLCipher vs. web localStorage+WebCrypto

All note persistence goes through [src/lib/note-storage.ts](src/lib/note-storage.ts), which branches on `Capacitor.isNativePlatform()`:

- **Native (iOS/Android)**: calls through a Capacitor plugin (`registerPlugin<NoteStoragePlugin>("NoteStorage")`) implemented natively in [android/app/src/main/java/com/jackbarkerapps/openkeep/NoteStoragePlugin.kt](android/app/src/main/java/com/jackbarkerapps/openkeep/NoteStoragePlugin.kt) and [ios/App/App/NoteStoragePlugin.swift](ios/App/App/NoteStoragePlugin.swift), backed by an on-disk SQLCipher-encrypted SQLite database (pulled in via Swift Package Manager from `sqlcipher/SQLCipher.swift`; see `SQLCipher_Package.swift`). The PIN/passcode is the encryption key.
- **Web**: notes live in `localStorage` (`open-keep-notes` key) and are encrypted/decrypted via the WebCrypto API in [src/lib/web-crypto.ts](src/lib/web-crypto.ts), mirroring the native plugin's method signatures (`initializeDatabaseWeb`, `encryptDataWeb`, etc.).

Both backends expose the same async API surface (`loadNotes`, `saveNote`, `deleteNote`, `initializeDatabase`, `checkDatabaseStatus`, `lockDatabase`, `changeEncryptionKey`, `exportMasterKey`/`importMasterKey` for cross-device key transfer, `wipeDatabaseButKeepKeys`, `clearAllData`). Callers (UI code) should generally go through this module rather than branching on platform themselves.

Legacy data migration: old "list"-type notes (with an `items` array) are converted on load into markdown checklists (`- [ ] ...`); see `parseNote` in `note-storage.ts`.

### App boot / lock flow

[src/App.tsx](src/App.tsx) drives a state machine (`loading` → `setup`/`locked`/`ready`) that decides whether to show the passcode `LockScreen`, an initialization error screen, or the main `Index` route. Native builds auto-initialize the DB with a transparent (empty) key if none is configured yet; a failed native key verification on first real read dispatches a `window` event (`open-keep-db-unverified`) that forces the app back to the lock screen (see the comment in `App.tsx` for why this can't be decided at `checkStatus` time). Widget deep links (Android/iOS home-screen widgets) are captured via `ensureWidgetDeepLinkCapture()` even while locked, so a tap isn't lost behind the lock screen.

### Cloud sync and multi-device key conflicts

Cloud sync (Dropbox/Google Drive/OneDrive, under `src/lib/dropbox*.ts`, `src/lib/google-drive.ts`, `src/lib/one-drive*.ts`) does not store notes in plaintext in the cloud — a "cloud master key" (the local encryption key, wrapped) is synced alongside the notes so another device can decrypt them. [src/lib/cloud-sync-resolver.ts](src/lib/cloud-sync-resolver.ts) and [src/lib/cloud-sync-state.ts](src/lib/cloud-sync-state.ts) handle the conflict case where a device's local PIN doesn't match the cloud-stored key: the user is prompted for the *other* device's PIN, and the resolution can keep local data, replace with cloud data, or merge (`forceResolution: "local" | "cloud" | "merge"`).

### MCP bridge (AI assistant access)

Two separate packages implement "let an AI tool read/write your notes":

- **Browser side**: [src/lib/mcp-bridge/](src/lib/mcp-bridge/) (`bridge-client.ts`, `protocol.ts`) — the open Open Keep tab connects *out* to a local WebSocket server (a tab can't listen for connections itself).
- **Node side**: [mcp-server/](mcp-server/) — a standalone `@openkeep/mcp-server` npm package that implements the actual MCP server (via `@modelcontextprotocol/sdk`) and the WebSocket relay (`bridge-server.ts`) the browser tab connects to. It can be packaged as a Claude Desktop extension (`npm run pack:mcpb`).

The two `protocol.ts` files (browser-side and mcp-server-side) are **hand-synced mirrors, not a shared import** — if you change the wire protocol (request/response shapes, `BridgeOp` union, error codes), update both files identically. Read/write access is gated by two independent user-controlled switches in Settings, and every AI write is undoable and tagged (`ai-created`/`ai-edited`); see [MCP.md](MCP.md) for the full user-facing command list and safety model.

### Notes data model

The canonical `Note` shape is [src/types/note.ts](src/types/note.ts). Notes have no separate "list" type anymore in the UI — checklists are represented as markdown checkbox syntax inside `content` (see `CHECKBOX_REGEX` in [src/utils/markdown.ts](src/utils/markdown.ts)); the `type: 'list'` field only exists to keep an all-checkbox note from collapsing when its body would otherwise look empty. Note limits (title/body length, list item counts) live in [src/lib/note-limits.ts](src/lib/note-limits.ts); colors are a fixed palette normalized through [src/lib/note-colors.ts](src/lib/note-colors.ts) (unrecognized ids fall back to default rather than erroring).

### Frontend structure

- Routes live in `src/App.tsx` (per [AI_RULES.md](AI_RULES.md) convention) — currently just `Index` (the whole app) and a catch-all `NotFound`.
- `src/pages/Index.tsx` is the main page composing the note grid/list, sidebar, top bar, and dialogs.
- `src/components/ui/` is shadcn/ui — generated primitives; don't hand-edit, wrap/extend instead.
- `src/components/` holds the app's own components (dialogs, note editor/card, lock screen, settings, etc.).
- Path alias `@/*` → `src/*` (configured in `vite.config.ts` and `tsconfig`).
- State that needs to survive across the app: `src/context/session-provider.tsx` (Supabase auth session) and `theme-provider.tsx`.

### Backend touchpoints

Supabase is used minimally and not for note storage: anonymous auth for usage counting/feedback prompts, and one edge function, [supabase/functions/google-token-exchange](supabase/functions/google-token-exchange), for the Google Drive OAuth token exchange (see [GOOGLE_SETUP.md](GOOGLE_SETUP.md) / [AZURE_SETUP.md](AZURE_SETUP.md) for the OAuth app setup those integrations depend on). No user note content ever leaves the device except to the cloud storage provider the user explicitly connects.

### Importers/exporters

[src/utils/import-manager.ts](src/utils/import-manager.ts) dispatches to format-specific importers in `src/utils/importers/` (`google-keep.ts`, `markdown.ts`). `src/components/GoogleKeepMigrationGuide.tsx` / `InitialAskToMigrate.tsx` drive the Google Keep migration UX referenced in the README's "DeGoogled" positioning.
