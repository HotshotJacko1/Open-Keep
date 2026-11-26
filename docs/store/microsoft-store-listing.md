# Microsoft Store listing — Open Keep (Store ID 9PH1JT22QHDK)

Text for the Partner Center submission, kept here so the next submission can
reuse it. Based on `fastlane/metadata/android/en-US/` (the Play listing) with
the Windows app's own features. Listing language: English (United Kingdom),
matching the package's `en-gb` resource.

## Product name

Open Keep

## Short description (max 270 characters, shown in search results on some surfaces)

Private, open-source notes with 256-bit AES encryption, Markdown and checklists. Sync through your own Dropbox, OneDrive, Google Drive or WebDAV, or keep notes only on this PC. No account, no ads.

## Description

Open Keep is a simple, privacy-focused notes app for people who want full control over their data. No Google dependency, no account, no personal data collection: just your notes, stored how and where you choose.

Write notes and checklists in clean, portable Markdown, lock the app with a PIN or Windows Hello, and keep everything in sync across Windows, Android, iPhone and the web through the cloud storage you already use.

Features:
• Encrypted on your PC: notes live in an encrypted database (SQLCipher, 256-bit AES), with the key kept by Windows Credential Manager
• Optional end-to-end encrypted sync with Dropbox, OneDrive, Google Drive or your own WebDAV server (Nextcloud and others)
• Markdown notes and checklists, labels, colours, pinning, archive and bin
• Reminders as Windows notifications, from the system tray
• App Lock with a PIN or Windows Hello
• Import from Google Keep and Markdown; export everything at any time
• Let AI tools such as Claude read and edit your notes, only if you switch it on (every AI change is labelled and can be undone)
• Open source under the AGPL-3.0

Privacy:
• Your notes never reach our servers; we can't see them
• No ads and no login
• Anonymous usage counting (how many people use the app) and an occasional feedback prompt
• Crash reports (Sentry) to fix bugs, with all text masked and images blocked, so your notes aren't included

Your notes. Your storage. Your control.

## What's new in this version

First Windows release.

## Product features (one per line, max 20)

Encrypted notes database on your PC
End-to-end encrypted cloud sync
Dropbox, OneDrive, Google Drive and WebDAV sync
Markdown notes and checklists
Labels, colours, pins and archive
Reminders as Windows notifications
App Lock with PIN or Windows Hello
Import from Google Keep
Export all notes at any time
Optional AI assistant access, off by default
Open source (AGPL-3.0)

## Search terms (max 7)

notes, encrypted notes, markdown, checklist, google keep alternative, private notes, open source

## Category

Productivity (subcategory: none needed)

## Privacy policy URL

https://openkeep.net/privacy-policy/

## Website

https://openkeep.net/

## Support contact

jack@openkeep.net (the address the in-app feedback email uses)

## Copyright and trademark info

Copyright (c) 2026 Jack Barker. Licensed under AGPLv3.

## Pricing and availability

Free, all markets, no in-app purchases.

## Age rating (IARC questionnaire)

Category: Productivity / utility app. Answers: no violence, sexual content,
gambling, drugs or crude humour; no user-to-user communication or sharing
inside the app; no location sharing; no purchases. Expected rating: 3+ / PEGI 3.
Note: notes can contain anything the user types, but they are private to the
user and never shown to anyone else, so "users interact" is **No**.

## Restricted capability: runFullTrust (justification)

Open Keep is a desktop (Win32) app built with Tauri and packaged as MSIX. Like
every packaged desktop app it needs runFullTrust to run as a normal desktop
process: it keeps its encrypted notes database in the user's app data folder,
stores the database key in Windows Credential Manager, shows reminders from the
system tray, and receives sign-in links (openkeep://) from the user's browser
when they connect Dropbox, OneDrive or Google Drive.

## Notes for certification

The app needs no account and works offline. To check cloud sync, any personal
Dropbox, OneDrive or Google account can be connected from Settings → Open Sync
Options; sign-in opens in the default browser and returns to the app. App Lock
is off by default (Settings → App Lock & Biometrics).

## Screenshots

`docs/store/screenshots/` — 1920 × 1080 PNGs of the app with sample notes (no
real user data).
