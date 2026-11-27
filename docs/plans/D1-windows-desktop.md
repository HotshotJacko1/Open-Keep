# D1 — Windows desktop app

Status: spike done on Tauri 2 (2026-11-25), see "Spike results". Phase 1 done
(see "Phase 1 progress"), including Dropbox/OneDrive with real accounts. Phase 2
(see "Phase 2 progress"): built-in MCP server, Windows Hello, Google Drive and
auto-update done; Store submission 1 (5.5.0 MSIX) sent for certification
2026-11-25, held until "Publish now"; SignPath Foundation applied for the same
day; winget waits for the 6.0.0 release.

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
| SQLCipher | `rusqlite` + SQLCipher built with LibTomCrypt in `build.rs` (no OpenSSL) | `better-sqlite3-multiple-ciphers` |
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
| Notes storage (`note-storage.ts`) | localStorage in WebView2's profile dir — works, but notes are plain text on disk (PIN only encrypts cloud copies) | Native SQLCipher plugin (below), needed for the beta |
| WebDAV sync | Works (fetch); CORS stops applying if requests go through Tauri's HTTP plugin | Route through `@tauri-apps/plugin-http` to avoid CORS on servers without it |
| Dropbox / OneDrive | Web path redirects to `window.location.origin` (`http://tauri.localhost`), which isn't registered | Use the **mobile** flow: open the system browser, come back on `openkeep://auth` (already registered with Dropbox and Azure, handled by `oauth-redirect.ts`) via `tauri-plugin-deep-link` |
| Google Drive | Native path needs `capacitor-social-login` (mobile only); web path's Google Identity popup needs a registered JS origin | New Google OAuth client of type *Desktop app*: PKCE + loopback redirect (`http://127.0.0.1:<port>`), token exchange through the existing Supabase function. **Verify before promising** |
| MCP bridge | The tab dials out to `ws://127.0.0.1:<port>` — works the same from WebView2 | Allow it in the Tauri CSP. Later: the app can start the MCP server itself |
| Reminders | Web path: `Notification` API while the app is open | Keep the app alive in the tray (close → minimise to tray, optional start at login) |
| App Lock biometrics | `capacitor-native-biometric` is mobile only; off a phone its web stub passes every check | Windows Hello via `src-tauri/src/hello.rs`, behind `src/lib/biometrics.ts` (browser: none). Done |
| Widgets | n/a | Skip |
| Clipboard images, export/share | Web paths | Check export uses a save dialog (`plugin-dialog`/`plugin-fs`) rather than a browser download |

`src/lib/platform.ts` decides the desktop-only branches: `isDesktopApp()`
(`"__TAURI_INTERNALS__" in window`) and `hasNativeStorage()` (Android, iOS or
desktop: notes in SQLCipher). Storage, encryption and lock behaviour use
`hasNativeStorage()`; anything that needs a Capacitor plugin keeps
`Capacitor.isNativePlatform()`.

## Storage: native database (phase 1)

Same pattern as Android/iOS: a Rust plugin exposing the `NoteStoragePlugin`
methods over an SQLCipher file, `%LOCALAPPDATA%\com.jackbarkerapps.openkeep\open-keep-db`.
Built: see "Phase 1 progress". On first launch, notes an earlier desktop build
left in localStorage are moved into the database, and the localStorage copy is
removed once every note reads back. Reasons to do it: notes encrypted at rest
(the web path leaves them in plain text), no localStorage size ceiling (images),
a real file users can back up, and parity with mobile.

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

### Microsoft Store (name reserved 2026-11-25)

MSIX, not the `.exe`: the Store re-signs MSIX packages itself (no certificate
needed), while an EXE/MSI submission must already be signed with a certificate
that chains to Microsoft's Trusted Root Program. Individual developer accounts
are free. Tauri doesn't build MSIX, so a script packs the release build with
the Windows SDK's `makeappx` and an `AppxManifest.xml` (declaring the
`openkeep://` protocol, since the NSIS installer's registry entries don't exist
inside a package). To check inside the package: Windows notifications (package
identity), `openkeep://` activation, and data paths (virtualised under the
package).

Partner Center product "Open Keep" (MSIX or PWA app). **Submit within three
months of 2026-11-25 or the name reservation lapses.**

Built (2026-11-25): `pnpm desktop:msix` (`scripts/build-msix.ps1`) packs the
release `open-keep.exe` with `src-tauri/msix/AppxManifest.xml` (identity below,
`openkeep://` protocol, `internetClient` + `runFullTrust`) and
`src-tauri/msix/Assets` into `src-tauri/target/msix/OpenKeep_<x.y.z>.0_x64.msix`.
`makeappx` validates the manifest; `makepri` builds one `resources.pri` (its
default split into per-scale PRIs is for bundles, so the script removes it) that
maps the plain asset names to the `scale-*` and `targetsize-*_altform-unplated`
icons, so the taskbar shows the full-size bulb rather than a padded plate. The
Store reserves the version's fourth part, so a four-part `versionName` can't be
packaged (the script stops with a message). The icons come from
`src-tauri/icons/source.svg` (the favicon bulb, cropped). CI builds it after the
installer and keeps it as the `OpenKeep-msix` workflow artifact for upload in
Partner Center. The submission will ask why the app needs `runFullTrust`: every
packaged desktop (Win32) app does.

Tested installed from the package (Developer Mode, `Add-AppxPackage -Register`
on the staged folder, 2026-11-25): the package family name came out as
`JackBarkerApps.OpenKeep_e5tgr4k6n8gj8`, matching Partner Center; the taskbar
shows the full-size unplated bulb; the app opened the existing encrypted
database (SQLCipher + Credential Manager key) and synced with Dropbox; the
tray notice arrived as a Windows toast; and with only the package's
`openkeep://` declaration registered, a link reached the app's Dropbox handler
(and was refused for its unknown `state`, as it should be). The manifest's
Application `Id` is `com.jackbarkerapps.openkeep` because
`tauri-plugin-notification` sends toasts as `<package family>!<Tauri identifier>`.

Found: the packaged app uses the same `%LOCALAPPDATA%\com.jackbarkerapps.openkeep`
data as the `.exe` install (no separate copy), so on one PC both versions
share notes and keys; the single-instance plugin stops both running at once.
And Windows treats `HKCU\Software\Classes\openkeep` as the package's: removing
the package deleted the key, which also breaks the `.exe` install's sign-in
links. Fixed (`src-tauri/src/link_repair.rs`): at startup, a release build
that isn't packaged (`GetCurrentPackageFullName` returns no package) checks
`HKCU\Software\Classes\openkeep\shell\open\command` and calls
`deep_link().register_all()` if it's missing or names an exe that no longer
exists. A working registration is left alone, even one pointing at another
copy, so a build run from the project folder doesn't take links over.

| Manifest field | Value |
|---|---|
| `Package/Identity/Name` | `JackBarkerApps.OpenKeep` |
| `Package/Identity/Publisher` | `CN=382B8A97-CD32-4510-958F-EC66B19A7BCA` |
| `Package/Properties/PublisherDisplayName` | `Jack Barker Apps` |
| Package Family Name | `JackBarkerApps.OpenKeep_e5tgr4k6n8gj8` |
| Store ID | `9PH1JT22QHDK` |
| Store link | https://apps.microsoft.com/detail/9PH1JT22QHDK |

Versioning: `tauri.conf.json` takes its version from `build.gradle` like iOS
does — extend `scripts/sync-version.cjs` (and its `--check` in `pnpm lint`).

## Spike results (2026-11-25)

Tauri 2.12 / Rust 1.100 (MSVC) / WebView2 158, `src-tauri/` scaffold, unchanged
web app. `pnpm desktop:dev` runs it (Vite on port 1420 so it doesn't clash with
`pnpm dev` on 8080); `pnpm desktop:build` makes the NSIS installer.

Release build: `Open Keep_5.4.1_x64-setup.exe` is **2.8 MB** (per-user NSIS);
`open-keep.exe` uses ~29 MB plus WebView2's own processes. First Rust build
takes ~4.5 minutes, later ones seconds. The release build runs at origin
`http://tauri.localhost`.

Worked with no app changes:
- The app boots in the window; Capacitor reports platform `web`, `__TAURI_INTERNALS__` is present.
- Notes persist across restarts (WebView2 profile in `%LOCALAPPDATA%\com.jackbarkerapps.openkeep\EBWebView`).
- Enabling encryption (WebCrypto PIN) works; after a restart the app opens on the lock screen and unlocks.
- WebDAV against a server that sends CORS headers: PUT, GET and ETags all fine.
- A WebSocket to the MCP bridge port (8420) opens from the window. Pairing is by token, not origin, and `use-mcp-bridge.ts` only switches itself off for Capacitor-native, so the bridge should pair as it does from a browser tab (not paired in the spike, to keep test notes away from the real Claude Desktop extension).

Found:
1. **Notes are plain text on disk.** On the web path the PIN encrypts cloud copies and images only; the dialog says "Notes stored in this browser stay unencrypted". In the desktop app the note text is readable in `EBWebView\Default\Local Storage\leveldb\*.log`. For an app sold on local encryption this has to be fixed before a public release: **the SQLCipher storage plugin moves from phase 2 to phase 1.**
2. **WebDAV servers without CORS are blocked**, exactly as in a browser (Nextcloud doesn't send CORS). Routing WebDAV through `@tauri-apps/plugin-http` fixes this, which makes the desktop app *better* than the web app for self-hosters (no `--proxy` needed).
3. Dev and release builds have different origins (`http://localhost:1420` vs `http://tauri.localhost`), so they keep separate localStorage. Moving to SQLCipher removes this.
4. Web copy says "this browser" in places (encryption dialogs, "Local Storage Only" banner); needs desktop wording.
5. A production `pnpm build` uploads sourcemaps to Sentry when `SENTRY_AUTH_TOKEN` is set. The desktop CI job must keep the same release-tagging rules as the other builds (or run with it unset).

## Phase 1 progress (2026-11-25)

**SQLCipher storage** (`src-tauri/src/storage/`, `src/lib/desktop-note-storage.ts`):
- One Tauri command per `NoteStoragePlugin` method; `note-storage.ts` uses it when `isDesktopApp()` and treats desktop as native.
- Key handling ports Android's `KeyManager.kt` byte for byte: random 32-byte master key, AES-256-GCM wrapping, PBKDF2-SHA256 (10,000 rounds) with a local salt, and the fixed export salt for the cloud key. The wrapped key and salt are in `keys.json` beside the database. The unwrapped key (for opening without a PIN, as Keystore/Keychain do) is in Windows Credential Manager as `db_master_key.com.jackbarkerapps.openkeep`.
- As on mobile, the database is always encrypted: with no PIN, the fixed default PIN wraps the key. With a PIN the app still opens without asking unless App Lock is on.
- SQLCipher 4.20 is compiled in `build.rs` from `sqlcipher-src` with LibTomCrypt as its crypto provider, linked as `sqlite3` for rusqlite. rusqlite's own `bundled-sqlcipher` needs OpenSSL on Windows (and Strawberry Perl to build it). `.cargo/config.toml` stops vcpkg supplying a system SQLite instead.
- Commands run one at a time (a lock in `Storage`): React's double-run effects in development made two `initialize` calls race and write mismatched key files.
- Tested: Rust unit tests (`cargo test` in `src-tauri`: file encrypted, wrong key rejected, re-key, migration keeps rows, PIN wrap/export/change). In the app: the database file has no readable text; localStorage notes moved in; restart opens without a PIN; a key exported from Rust opens with `web-crypto.ts` and the reverse, with wrong PINs rejected; encrypt/decrypt round trip.
- Known: an earlier desktop build's plain localStorage copy can linger in WebView2's LevelDB log until LevelDB compacts it. Only affects the unreleased spike builds.

**WebDAV through `@tauri-apps/plugin-http`** (`webdav.ts`): requests go out from Rust, so no CORS, and `MKCOL` works. Scope: any http/https URL (`capabilities/default.json`). Tested against a server with every CORS header stripped (like Nextcloud): connect, `MKCOL` after a 409, key and notes uploaded encrypted. The connect form's CORS note is hidden on desktop.

**Desktop wording:** with desktop on the native storage path, the encryption and App Lock dialogs use the mobile text ("on this device") and the "Local Storage Only" first-note dialog no longer shows. The AI Assistant dialog says "while Open Keep is open", and the support email gives `windows-desktop` and the app version.

**Single instance:** a second launch focuses the running window (`tauri-plugin-single-instance`), so two windows never share the database.

**Relock:** `@capacitor/app`'s web `appStateChange` follows page visibility, so App Lock's "relock after 30 seconds away" works when the window is minimised and restored.

**Dropbox and OneDrive sign-in** (`platform.ts` `usesAppSignInRedirect()`/`openInSystemBrowser()`, `oauth-redirect.ts`): the mobile flow. Sign-in opens in the default browser (`plugin-opener`), which returns on `openkeep://auth`; the installer registers the scheme (a dev build registers itself). Windows starts a second copy with the link, the single-instance plugin hands it to the running app, and `plugin-deep-link`'s `onOpenUrl` feeds the existing handlers. OneDrive's MSAL requests go through `DesktopNetworkClient` (`one-drive.ts`): `plugin-http` with its `unsafe-headers` feature and an empty `Origin`, so the header is left off as on mobile. Tested: a link reaches the Dropbox handler and an unknown `state` is refused; with a valid `state` the stored PKCE verifier is used and the token request reaches Dropbox (400 for the fake code); the Dropbox sign-in URL has `redirect_uri=openkeep://auth`; the OneDrive client sends no `Origin`. Tested with real Dropbox and OneDrive accounts (2026-11-25).

Fixed after the first install: `opener:allow-open-url` was granted with no URL scope, so every sign-in page was refused ("Not allowed to open url"); it is now scoped to `https://*`. And MSAL's `interaction_in_progress` lock (sessionStorage `msal.interaction.status`) survived a sign-in that never came back, blocking every retry until restart; `loginToOneDrive` now clears it on desktop and phones before starting a new sign-in.

**Google Drive** (`src/lib/google-desktop-auth.ts`): Google's web sign-in is a GIS popup the app can't open, and Google blocks sign-in in embedded webviews, so desktop uses the default browser with a loopback redirect. `tauri-plugin-oauth` listens once on `127.0.0.1` (ports 44257, 44258, 44259 in turn); the consent page uses the same **web** OAuth client as the web app, with `access_type=offline` and `prompt=consent` for a refresh token; the returned `state` is checked; the code goes through the existing `google-token-exchange` Supabase function, so no client secret ships in the app and refresh works as on the web. `http://127.0.0.1:44257`, `:44258` and `:44259` were added to that web client's Authorised redirect URIs in Google Cloud Console (2026-11-25); Google accepts them (the consent page loads with that `redirect_uri`). Tested: the listener binds, serves its page, and hands the redirect URL to the app. Not yet tested with a real account.

**Window, tray, reminders:** `tauri-plugin-window-state` restores size, position and maximised state. Closing the window hides it to the tray (left-click shows it; right-click menu has Open and Quit), with a one-time notification saying so, so reminder timers keep running. Settings → Startup turns on launch at sign-in (`src-tauri/src/autostart.rs`): the `.exe` version writes an HKCU `Run` entry with `--autostart` (removed by the uninstaller via `nsis/hooks.nsh`), the Store version switches a `windows.startupTask` declared in its manifest. **Start Minimised** keeps a sign-in launch in the tray; the window starts hidden (`visible: false`, and window-state doesn't restore visibility) and setup shows it otherwise. `tauri-plugin-notification` patches `window.Notification`, so the web reminder code shows Windows notifications with permission already granted.

**Exports:** `src/lib/save-file.ts` opens Windows' Save As dialog (`plugin-dialog`) and writes with `plugin-fs`, which can only write to the path picked there. Used for Export All, exporting selected notes and exporting one note; a cancel shows no success toast.

**Images at rest:** on desktop, images are always encrypted with the device master key (`encryptWithDeviceKey`), PIN or not, like the database. Existing plain images are converted by the sweep at startup. Tested: a saved image is stored with the encrypted marker and decrypts for display.

**Version:** `scripts/sync-version.cjs` writes `build.gradle`'s `versionName` into `tauri.conf.json` and `Cargo.toml` (a fourth part becomes build metadata, `5.4.0.1` → `5.4.0+1`), and `pnpm lint` fails on drift.

**CI:** `release.yml` has a `windows-desktop` job after the Android one: Rust tests, `pnpm desktop:build`, then `OpenKeep-windows-x64-setup.exe` attached to the same release (a fixed name, so `releases/latest/download/OpenKeep-windows-x64-setup.exe` always works; 6.0.0 was built as `OpenKeep-6.0.0-windows-x64-setup.exe` and renamed on the release by hand, with its `latest.json` and winget manifest pointed at the new name). Unsigned, so SmartScreen warns. Sentry: the job passes the repo secret `SENTRY_DSN` as `VITE_SENTRY_DSN` (only to this job, so the F-Droid and GitHub-release APKs stay without crash reporting); without the secret the installer builds with Sentry off. Desktop events carry the tag `app: windows-desktop` and the release `com.jackbarkerapps.openkeep@<version>+windows` (`main.tsx`); no sourcemaps are uploaded for desktop yet.

Still to do: start at login (optional); CSP; code signing; auto-updater. Worth considering: the WebDAV password and OAuth tokens are in localStorage (as on every platform); Credential Manager could hold them on desktop.

## Phase 2 progress (2026-11-25)

**Built-in MCP server** (`src-tauri/src/mcp/`, `src/lib/mcp-desktop.ts`, `src/components/AiToolConnectSection.tsx`): `open-keep.exe --mcp` is the app as its own MCP server, so AI tools need no Node and no `.mcpb`.
- `main.rs` checks for `--mcp` before Tauri starts, so it opens no window and the single-instance plugin never hands it to the running app. It is a Rust port of `mcp-server`: MCP over stdin/stdout (JSON-RPC by hand, no SDK), and the same bridge on 127.0.0.1:8420-8424 (v2 handshake, takeover and standby) that the open window dials. The window does the work, with its switches, undo and tags, exactly as with the Node server. So `bridge.rs` is a third hand-synced copy of the server side of the protocol.
- Tools: `tools.json`, generated from `mcp-server/src/server.ts` (`npm run export-tools`); arguments are checked as zod would (required, types, `minLength`, `minItems`, defaults, unknown keys dropped).
- Token: the app writes it to Credential Manager (`mcp_pairing_token`) whenever it changes; each `--mcp` copy reads it at every handshake, so a new token applies without setting tools up again. `OPENKEEP_MCP_TOKEN` overrides it.
- Settings → AI Assistant Access on desktop: **Add to Claude Desktop** writes `claude_desktop_config.json` (the Store build's `%LOCALAPPDATA%\Claude-Data\claude_*\`, else `%APPDATA%\Claude\`), keeping every other entry and key order, backing the file up once and refusing to touch invalid JSON. Copy buttons for Claude Code (`claude mcp add`), Codex/ChatGPT desktop (`codex mcp add`) and a JSON entry for anything else.
- Tested: `cargo test` (tool validation, MCP replies, config writing, token round trip through Credential Manager under a test name); mcp-server's whole suite against the debug build (`npm run test:relay`, 72/72, including two windows with one token and an in-flight call during a takeover); the release build (GUI subsystem) answering MCP over pipes. With the installed build (2026-11-25): **Add to Claude Desktop** added the entry beside the existing servers, it survived restarting Claude Desktop, and Claude's tool calls reached the app's notes through two `--mcp` copies (ports 8420 and 8421). Generate a new token in Settings kept Claude working with no change on Claude's side.
- Known: an installer or update replaces `open-keep.exe`, and Tauri's NSIS installer closes running copies first, `--mcp` ones included, so AI tools need a restart after an update.
- Later: start Open Keep in the tray when a tool call arrives and it isn't running; for the Store (MSIX) build, an app execution alias for a stable path and registration with Windows' on-device MCP registry (preview).

**Auto-update for the `.exe` version** (`src/lib/desktop-updater.ts`, `src-tauri/src/store_package.rs`):
- `tauri-plugin-updater` reads `https://github.com/HotshotJacko1/Open-Keep/releases/latest/download/latest.json`, checks the installer's minisign signature against the public key in `tauri.conf.json` (`plugins.updater.pubkey`), and installs in passive mode (progress bar, no questions), which closes the app and reopens the new version. `tauri-plugin-process` relaunches if the installer didn't.
- Checked 15 s after the notes first show, then daily (the app lives in the tray). An update is offered as a toast with **Restart to update**. Skipped in dev builds and in the Store package (`desktop_is_store_package`, via `GetCurrentPackageFullName`; the Store updates it).
- Signing key: generated with `tauri signer generate --ci` (no password) at `%USERPROFILE%\.tauri\open-keep-updater.key` (private, **back it up**: losing it means installed apps can never be updated again) and `.key.pub` (in `tauri.conf.json`). CI needs it as the secret `TAURI_SIGNING_PRIVATE_KEY`; without it the release still builds but isn't offered as an update.
- CI (`release.yml`): builds with `bundle.createUpdaterArtifacts` only when the secret exists (local builds have no key), then writes `latest.json` with the version from `tauri.conf.json` and the installer's `.sig`. The version must be the one the installer was signed with: the updater rejects a signature for a different version as tampering.
- `latest.json` is read from the release marked **Latest**, so a manual MCP server release (`mcp-v*`) must be published with `--latest=false` (`gh release create mcp-v… --latest=false`), or desktop apps would look for updates there.
- Tested (2026-11-25), with a test build pointing at a local server: the toast appeared ("Open Keep 9.9.9 is available"); a real signed 5.5.1 offered to a 5.5.0 copy downloaded and its signature was accepted (not installed); a tampered signature, and a signature for a different version than announced, were both rejected.

**Code signing (prepared, not active):** the Windows job adds Tauri's `signCommand` with `trusted-signing-cli` when the Azure Artifact Signing settings exist (secrets `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`; variables `AZURE_SIGNING_ENDPOINT`, `AZURE_SIGNING_ACCOUNT`, `AZURE_SIGNING_PROFILE`). Tauri signs `open-keep.exe` and the installer before making the updater signature, so both stay valid. Needs an Azure account with an Artifact Signing account, certificate profile (identity validation) and an app registration with the signer role; check it's open to individuals in the UK. The free alternative, SignPath Foundation (apply at signpath.org with the repo), signs uploaded CI artifacts instead, which would mean re-making the updater signature after signing; not built.

**winget (prepared):** first version by hand with `wingetcreate new` once a release exists (`docs/store/winget.md`); later versions by a CI step gated on the variable `WINGET_ENABLED=true` and secret `WINGET_TOKEN`.

**Microsoft Store listing (prepared):** text, age rating answers and the `runFullTrust` justification in `docs/store/microsoft-store-listing.md`; four 1920 × 1080 screenshots of the same UI with sample notes in `docs/store/screenshots/` (taken from the web build in a throwaway browser profile, so no real notes). Entered in Partner Center (Store ID 9PH1JT22QHDK) and submitted for certification on 2026-11-25 with the 5.5.0 package; the publishing hold means it goes live only when "Publish now" is pressed. SignPath Foundation application sent the same day (Download URL left blank: the page it names must say the app is signed through SignPath, so add that to the README once approved).

**README:** a Download section for Windows (release `.exe`, SmartScreen tip), Android, iOS and web.

## Phases

**0. Spike (1–2 days).** `src-tauri/` scaffold loading `dist/`; confirm notes
persist across restarts, encryption/PIN works, WebDAV sync, MCP bridge connects,
CSP is right. Decide Tauri vs Electron here.

**1. Usable beta.** SQLCipher storage plugin (spike finding 1); WebDAV through
`plugin-http` (finding 2); desktop OAuth for Dropbox and OneDrive via
`openkeep://`; single-instance (second launch focuses the window and forwards
deep links); window size/position memory; tray + reminders; native save
dialogs; desktop wording; unsigned NSIS installer from CI, released as "beta".

**2. Release.** Google Drive desktop sign-in; signing; auto-updater; Windows
Hello for App Lock (done); the app acting as its own MCP server (`Open Keep.exe
--mcp`) so AI tools work without a separate install; Store and winget listings;
README/website download section; changelog entry.

**3. Later.** macOS and Linux builds from the same `src-tauri/`.

## Open decisions

- ~~Tauri or Electron~~: Tauri (spike passed).
- Distribution first: GitHub `.exe` + SignPath, or Store first.
- Is Google Drive required for the first public release, or can it follow?
