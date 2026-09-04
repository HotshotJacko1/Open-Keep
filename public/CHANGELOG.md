# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), but this project does not adhere to [Semantic Versioning](https://semver.org/spec/v2.0.0.html) because there is no public API.

## [Unreleased]
- F-Droid release.
- E2EE.

## [4.5.0] - 2026-09-08

### Added
- **Note colours.** A palette button in the editor offers eleven colours that tint the note in your list and while open. Colour syncs across devices and survives export/re-import.
- **Note size limits.** Titles up to 1,000 characters, text notes up to 20,000 characters, lists up to 1,000 items of 2,000 characters each. You're stopped at the limit — nothing is lost silently.
- Exported notes now include labels, pinned/archived state, and original dates. Re-importing restores all of it.

### Fixed
- **Notes could not be created on some older devices.** Note and image IDs are now generated using an API that older system WebViews support.
- **Importing .md files now works.** Choosing Markdown files had failed with "No supported import format detected" since 4.3.0.
- Imported notes keep their line breaks instead of paragraphs running together into one block.
- A stray .json file alongside .md files in a folder or zip no longer causes every .md file to be skipped.

## [4.4.1] - 2026-08-30

### Changed
- Google Drive sign-in on the web now lasts, matching the mobile apps.

### Fixed
- Resetting a forgotten PIN now also clears the App Lock PIN, so it can't silently reuse the old one.
- The "Reset & Delete All" warning now correctly describes which data and providers are affected.
- Text notes and list notes now use the same body text size on phones.
- Note text no longer grows larger than the note title on wide screens.

## [4.4.0] - 2026-08-21

### Added
- Links in note titles and bodies are now clickable, including inside list items.

### Changed
- Google Drive sign-in now lasts; the app no longer asks you to sign in again roughly every hour.
- The app starts noticeably faster with Google Drive sync on; folder locations are remembered between launches.
- If the app can't open your notes, it shows an on-screen message and pauses cloud sync instead of an empty list.

### Fixed
- **Notes disappearing.** Refreshing a home screen widget could close the notes database mid-session, silently dropping saves. Fixed.
- **Cloud sync no longer deletes notes it can't read.** A read failure now stops the sync instead of treating it as "no notes".
- "Merge Both Together" no longer deletes notes if the merge fails partway through.
- "Keep Local (Overwrites Cloud)" refuses to run when there are no local notes, preventing accidental cloud wipe.
- A temporary network error is no longer mistaken for an empty cloud, preventing orphaned duplicate files in Drive.
- Note images no longer disappear a few seconds after being added.
- Moving to a new device no longer restores a partial database the app can't open.
- A one-off keystore failure no longer permanently destroys encryption keys; the app reports the error instead.
- Google Drive sync connection errors on Android are fixed.
- The note editor title field is no longer over-tall; title text is readable in light mode on web.

## [4.3.0] - 2026-08-14

### Added
- Sidebar width is now remembered between sessions.

### Changed
- Encryption is now optional, enabling a simpler and faster cloud sync experience.
- Feedback pop-up now asks for reviews and plays confetti.
- Toast notifications follow the app's own theme setting rather than the device theme.
- Google Keep and Markdown importing rebuilt around a shared import manager.
- "Later today" reminders are only offered when that time is still in the future.

### Fixed
- OneDrive stability improvements.
- Various bug fixes/improvements.
- OneDrive no longer overwrites cloud notes with an empty list if a download fails.
- Repeating reminders now roll forward to the next occurrence instead of stopping after a missed one.
- Long-pressing a note that disappears mid-press no longer leaves the press active.
- Cloud sync image restore now validates image names before writing.
- Note content is no longer written to the debug console.
- Settings toggle buttons now show the correct selected state.

## [4.2.0] - 2026-07-03

### Added
- Widgets
  - "New note" widget: quickly create text and list notes from the home screen.
  - "Single note" widget: pin a specific note or list to your home screen.
  - "Note collection" widget: view a set of notes or all notes on your home screen.

### Changed
- Early access dialog no longer appears on first launch.

## [4.1.1] - 2026-06-26

### Added
- Long-pressing a note shows its file info and metadata.

### Changed
- Top bar menu items are easier to see; less-used actions are behind a dropdown.
- Notification permission is now requested only when the user sets a reminder.

### Fixed
- Deleting a parent list item now also deletes its child items.
- Improved cloud sync.
- Setting up cloud sync no longer re-asks for the PIN if it matches the local one.
- Swipe-to-sync is fixed.
- Notes deleted then quickly re-fetched from an in-progress sync no longer reappear.
- Scrolling of long notes improved.

## [4.1.0] - 2026-06-11

### Added
- Sort button in the top bar to sort notes by Recent or Alphabetically.
- Layout button in the top bar to switch between grid and card list view.

## [4.0.0] - 2026-06-09

### Added
- Apple App Store release.

### Fixed
- Fixed favicon on the web version.
- Auto-sync notifications are now silent.
- Fixed Google Drive sync on the web version.
- Notes now show tiering on the home screen.
- Ticked items are now shown at the bottom of notes on the home screen.

## [3.0.0] - 2026-06-05

### Added
- Web version released at [app.openkeep.net](https://app.openkeep.net).

### Changed
- Notes sync on launch, on resume from background, and 30 seconds after the last edit.
- Pin colour changed to gold; pin stays visible when a note is pinned.
- Column count on large screens is now responsive.

## [2.1.1] - 2026-05-29

### Added
- Missing icons added to Settings buttons.

### Fixed
- Welcome screen now visible when using a large font size.
- Fixed Google Drive sync.
- Fixed link text colour in dark mode.
- Long words and URLs now wrap correctly on note cards.

## [2.1.0] - 2026-05-21

### Added
- App is now open source under AGPLv3.
- Prepared for F-Droid release.
- Feedback component added; appears occasionally to ask for feedback.
- Anonymous Supabase auth added to count active users and time feedback prompts. No personal data collected.

### Fixed
- Empty note lists no longer change to text lists.
- Label dialog now closes correctly when a note is open.

## [2.0.2] - 2026-05-18

### Fixed
- Parent list items can no longer be indented.
- Fixed a Google Drive sync setup issue.

## [2.0.1] - 2026-05-09

### Changed
- Passcode dialog now opens the on-screen keyboard automatically.

### Fixed
- Biometrics now work when passcode is disabled; enabling biometrics also enables passcode as a backup.
- Swipe-down-to-sync now updates the last synced time in the cloud sync dialog.

## [2.0.0] - 2026-05-08

### Added
- Reminders, including recurring options (daily, weekly, monthly, yearly).
- List item indenting.
- Reddit link.

### Changed
- Checked list items are now expanded by default.

### Fixed
- Open and close animations on the changelog dialog.
- App version now updates correctly in Settings.

## [1.0.2] - 2026-05-05

### Added
- Checked items in list notes are now collapsible.

### Changed
- Checked items are grouped at the bottom of the list, below the input field.
- Backspace on an empty list item deletes it and moves focus to the previous item.
- The last empty item is removed when a list note is closed.

## [1.0.1] - 2026-05-01

### Added
- Welcome dialog on first launch explaining early access.

### Changed
- Google Keep migration dialog no longer appears on first launch.

### Fixed
- Empty list notes are no longer saved.

## [1.0.0] - 2026-04-29

### Added
- Initial release of Open Keep on Google Play Store.