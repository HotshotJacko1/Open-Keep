# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), but this project does not adhere to [Semantic Versioning](https://semver.org/spec/v2.0.0.html) because there is no public API.

## [Unreleased]
- F-Droid release.
- Coloured notes.
- E2EE.

## [4.4.0] - 2026-08-21

### Added
- Links in notes are now clickable, in both note titles and note bodies, including inside list items.

### Changed
- Signing in to Google Drive now lasts. The app keeps you signed in instead of asking you to sign in again roughly every hour.
- The app starts noticeably faster when Google Drive sync is switched on. Folder and file locations are remembered between launches, and several unnecessary checks before your notes load have been removed.
- If the app can't open your notes, it now says so with an on-screen message and pauses cloud sync, rather than showing an empty list. The message warns you not to use "Reset app" while it's showing, since your notes are still on the device.

### Fixed
- **Notes disappearing.** Adding or refreshing a home screen widget could close the app's notes database while the app was still running. After that, edits reported as saved were never written, and the app could show no notes at all. Widgets no longer interfere with the app's own access to your notes.
- **Cloud sync no longer deletes notes it can't read.** Previously, if the app failed to read your notes for any reason, sync treated that as "this device has no notes" and could clear the device to match the cloud, or overwrite the cloud with nothing. Failures now stop the sync and tell you.
- "Merge Both Together (Keep All Notes)" no longer deletes your notes if the merge fails partway through.
- "Keep Local (Overwrites Cloud)" now refuses to run when there are no notes on this device, so it can't wipe your cloud copy.
- A temporary network or Google Drive error is no longer mistaken for "there is nothing in the cloud", which previously could create a second, near-empty notes file in Drive and leave the original orphaned.
- Note images no longer disappear a few seconds after being added.
- Moving to a new device no longer restores a partial copy of the notes database that the app can't open.
- A one-off failure of the device's secure keystore no longer permanently destroys your encryption keys. The app now reports the error instead of clearing them.
- Google Drive sync could fail outright with a connection error on Android. Fixed.
- The note editor's title field is no longer over-tall, and title text is readable in light mode on the web version.

## [4.3.0] - 2026-08-14

### Added
- Sidebar width is now remembered between sessions instead of resetting each time you open the app.

### Changed
- Encryption is now optional. This ensures that users who do not require encryption can enjoy a simpler and faster cloud sync experience. It also makes the onboarding flow smoother for new users.
- Feedback pop-up now asks for reviews and plays confetti.
- Toast notifications now follow the app's own theme setting rather than your device theme.
- Google Keep and Markdown importing rebuilt around a shared import manager.
- Reminders: "Later today" is now only offered when it is genuinely still today and still in the future.

### Fixed
- OneDrive stability improvements.
- Various bug fixes/improvements.
- OneDrive could overwrite your cloud notes with local-only data if a download failed. Failed downloads now stop the sync instead of continuing with an empty note list.
- Repeating reminders no longer stop firing after a missed occurrence — they now roll forward to the next one.
- Long-pressing a note that disappeared mid-press no longer leaves the press active.
- Restoring images from a cloud sync now validates image names before writing them.
- Note content is no longer written to the debug console.
- Sidebar and dialog fixes: toggle buttons in Settings now show the correct selected state.

## [4.2.0] - 2026-07-03
### Added
- Widgets
  - "New note" widget on mobile. Quickly create text and list notes.
  - "Single note" widget on mobile. Pin a specific note or list to your homescreen.
  - "Note collection" widget on mobile. View a set of notes or all notes.

### Changed
- Disabled early access dialog from appearing on first launch. This is because the app is more stable now, and it will further streamline onboarding.

## [4.1.1] - 2026-06-26
### Added
- Highlighting a note allows users to see file info/metadata.

### Changed
- Menu items in top bar are easier to see, and some are now hidden behind a hamburger dropdown.
- App only asks for notification permissions when user sets a reminder. This makes for a smoother onboarding flow on first launch.

### Fixed
- Deleting a parent list item now also deletes the child list items.
- Improved cloud sync.
- Fixed issue where setting up cloud sync with existing notes would ask for the cloud PIN, even if the local PIN is the same. Now, it will use the local PIN if they're the same and not ask for it again.
- Fixed swipe to sync not working.
- Fixed issue with notes being deleted, then quickly reappearing due to in-progress cloud syncs.
- Improved scrolling of long notes.

## [4.1.0] - 2026-06-11
### Added
- Button in top bar to sort notes either by Recent or Alphabetically.
- Button in top bar to toggle displaying notes in a grid or as a card list.

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
- Empty list notes won't be saved any more.

## [1.0.0] - 2026-04-29
### Added
- Initial release of Open Keep on Google Play Store.