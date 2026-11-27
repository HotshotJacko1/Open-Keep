# winget — Open Keep (JackBarkerApps.OpenKeep)

winget installs from the GitHub release's `.exe` (per-user NSIS installer,
silent with `/S`). Packages live in https://github.com/microsoft/winget-pkgs as
YAML manifests, added by pull request.

Best done after the installer is code-signed: winget's validation scans every
installer, and users installing an unsigned one still meet SmartScreen.

Status: 6.0.0 submitted 2026-11-26 as
[microsoft/winget-pkgs#489879](https://github.com/microsoft/winget-pkgs/pull/489879),
from the fork HotshotJacko1/winget-pkgs (manifests written by hand to schema
1.28.0 and checked with `winget validate`, rather than with `wingetcreate new`).
The installer is `OpenKeep-windows-x64-setup.exe` (no version in the name; each
release's URL has its tag), and the CI step below uses that name.

## First version (by hand, once)

Needs a published release, e.g. v6.0.0, and
[wingetcreate](https://github.com/microsoft/winget-create) (`winget install wingetcreate`).

```powershell
wingetcreate new https://github.com/HotshotJacko1/Open-Keep/releases/download/v6.0.0/OpenKeep-windows-x64-setup.exe
```

Answers:

| Field | Value |
|---|---|
| PackageIdentifier | `JackBarkerApps.OpenKeep` |
| PackageVersion | `6.0.0` (the release's version) |
| InstallerType | `nullsoft` (detected) |
| Scope | `user` |
| Publisher | Jack Barker Apps |
| PackageName | Open Keep |
| License | AGPL-3.0 |
| LicenseUrl | https://github.com/HotshotJacko1/Open-Keep/blob/main/LICENSE |
| ShortDescription | Private, open-source notes with encryption and your own cloud sync |
| PackageUrl | https://openkeep.net/ |
| PublisherUrl | https://openkeep.net/ |
| PrivacyUrl | https://openkeep.net/privacy-policy/ |
| ReleaseNotesUrl | https://github.com/HotshotJacko1/Open-Keep/blob/main/public/CHANGELOG.md |
| Tags | notes, markdown, encryption, privacy, open-source |

Then let wingetcreate submit the pull request (it asks for a GitHub sign-in).
A Microsoft bot validates it; a maintainer merges it, usually within a few days.

## Later versions (automatic)

`.github/workflows/release.yml` ends the Windows job with
`wingetcreate update JackBarkerApps.OpenKeep --version <v> --urls <installer> --submit`.
It runs only when the repository variable `WINGET_ENABLED` is `true`, with the
secret `WINGET_TOKEN`: a classic GitHub token with the `public_repo` scope.
