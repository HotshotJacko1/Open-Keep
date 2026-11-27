# Welcome to Open Keep

**[Changelog](public/CHANGELOG.md)**

## Download

- **Windows:** download [`OpenKeep-windows-x64-setup.exe`](https://github.com/HotshotJacko1/Open-Keep/releases/latest/download/OpenKeep-windows-x64-setup.exe) (always the latest version) and run it. It installs for your user only, with no admin rights needed, and updates itself. The installer isn't code-signed yet, so Windows SmartScreen may say "Windows protected your PC": choose **More info**, then **Run anyway**. A Microsoft Store version is coming.
- **Android:** [Google Play](https://play.google.com/store/apps/details?id=com.jackbarkerapps.openkeep), or the APKs on the [releases page](https://github.com/HotshotJacko1/Open-Keep/releases/latest) (`-android-full` has Google Drive sync; `-fdroid` has no Google Play Services).
- **iPhone and iPad:** [App Store](https://apps.apple.com/gb/app/open-keep/id6775857379).
- **Web:** [app.openkeep.net](https://app.openkeep.net), or [host it yourself](SELF_HOSTING.md).

## Features
Open source notes app with exporting, cloud sync, app lock, & encryption.

Open Keep is a simple, privacy-focused note-taking app designed for users who want full control over their data. No Google dependency, no personal data collection - just your notes, stored how and where you choose.

Write notes using clean and powerful Markdown (.md), protect sensitive content with passcode protection/biometrics, and keep everything in sync across your devices using your preferred cloud storage provider.

Key Features:

- DeGoogled – No reliance on Google services
- Cloud sync (Dropbox, Google Drive, OneDrive, WebDAV such as Nextcloud)
- Self-hostable web app – see [SELF_HOSTING.md](SELF_HOSTING.md)
- Markdown Support (.md) – Write and edit notes in a standard, portable format
- Password Protection – Secure your notes with passcode/biometrics
- Import & Export Notes – Easily move your data in or out at any time
- Encrypted – 256-bit AES encryption, which is an industry standard (often referred to as military-grade encryption).

Open Keep is ideal for users who value privacy, data ownership, and open formats - whether you’re taking quick notes, writing documentation, or managing personal knowledge.

Your notes. Your storage. Your control.

## Privacy

- 256-bit AES encryption
- No personal data collection, no logins
- I cannot see your notes
- Notes can be kept locally on device, or optionally synced to the cloud.
- Supabase anonymous auth is used purely to 1) count how many users are using the app, and 2) to ask users for feedback occasionally. The self-hosted version doesn't use it.

## Licence

This project is licensed under the GNU Affero General Public License v3.0 (AGPLv3) - see the [LICENSE](LICENSE) file for details.
