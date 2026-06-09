# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), but this project does not adhere to [Semantic Versioning](https://semver.org/spec/v2.0.0.html) because there is no public API.

## [Unreleased]
- F-Droid release.

## [4.1.0] - 2026-06-12
### Added
- Button in top bar to sort notes either by Recent or Alphabetically.

## [4.0.0] - 2026-06-09
### Added
- Apple App Store release.

### Fixed
- Fixed favicon (tab icon) on web version.
- Auto-sync notifications now silent.
- Fixed Google Drive sync on web version.
- Notes now show tiering on the homescreen.
- Notes on homescreen now show ticked/checked items at the bottom.

## [3.0.0] - 2026-06-05
### Added
- PC version released. You can now access Open Keep on a web browser at [app.openkeep.net](https://app.openkeep.net).

### Changed
- Improved automatic cloud syncing. Notes now sync to the cloud when the app launches, when the app is resumed from background, and 30 seconds after last edit.
- Changed pin colour to gold to more clearly show when a note is pinned. Pin remains visible when a note is pinned.
- On large screens, the number of columns is responsive, so, for example, the web version will show more than 2 columns on PCs.

## [2.1.1] - 2026-05-29
### Added
- Added missing icons to buttons in settings.

### Fixed
- Fixed welcome screen visibility when using large font size.
- Fixed Google Drive sync.
- Fixed link text colour in dark mode.
- Fixed long words/URLs not wrapping to the next line on note cards and causing overflow issues.

## [2.1.0] - 2026-05-21
### Added
- Made the app open source AGPLv3.
- Prepped for release onto F-Droid.
- Added feedback component which will appear occasionally to ask for feedback.
- Added Supabase as anonymous auth to count how many users are using the app and determine when to ask for feedback. No personal data is collected.

### Fixed
- Fixed issue with empty note lists changing to text lists.
- Fixed issue with closing the label dialog when a note is open.

## [2.0.2] - 2026-05-18
### Fixed
- In lists, parent items can no longer be indented.
- Fixed an issue with Google Drive sync setup.

## [2.0.1] - 2026-05-09

### Changed
- Passcode dialog now opens on-screen keyboard automatically.

### Fixed
- Fixed biometric not working when passcode is disabled. Enabling biometrics now also enables passcode as a backup.
- Fixed swipe down from the top to cloud sync not updating the last synced time in cloud sync dialog.

## [2.0.0] - 2026-05-08

### Added
- Reminders. Users can now set reminders for their notes. There is also an option to set recurring reminders - e.g. daily, weekly, monthly, yearly.
- List item indenting.
- Reddit link.

### Changed
- Checked/ticked list items will now be expanded by default, so that they are visible until collapsed.

### Fixed
- Open & close animations on changelog dialog.
- App version not updating in settings.

## [1.0.2] - 2026-05-05

### Added
- Checked/ticked items in list notes are now collapsible.

### Changed
- Checked/ticked list items will now be grouped together at the bottom of the checklist, below the "List item" input field.
- Pressing backspace on an empty list item will now delete it and move focus to the previous list item.
- When closing a list note, if the last item is empty/blank, it will be deleted.

## [1.0.1] - 2026-05-01
### Added
- Welcome dialog on first launch to welcome feedback and notify that the app is still in early access.

### Changed
- Stopped Google Keep migration dialog from appearing on first launch.

### Fixed
- Empty list notes won't be saved anymore.

## [1.0.0] - 2026-04-29
### Added
- Initial release of Open Keep on Google Play Store.