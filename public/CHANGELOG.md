# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), but this project does not adhere to [Semantic Versioning](https://semver.org/spec/v2.0.0.html) because there is no public API.

## [Unreleased]
- N/A

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