# Code signing policy

Windows releases of Open Keep (the installer attached to each
[GitHub release](https://github.com/HotshotJacko1/Open-Keep/releases)) are
built by GitHub Actions from this repository
([.github/workflows/release.yml](.github/workflows/release.yml)) and, once
approved, signed with a certificate provided by
[SignPath.io](https://about.signpath.io/), certificate by
[SignPath Foundation](https://signpath.org/).

## Team roles

- Committers and reviewers: [Jack Barker](https://github.com/HotshotJacko1)
- Approvers (who approve each signing request): [Jack Barker](https://github.com/HotshotJacko1)

All team members use multi-factor authentication for GitHub and SignPath.

## What gets signed

Only binaries built from this repository's source by the release workflow:
`open-keep.exe` and its NSIS installer `OpenKeep-windows-x64-setup.exe`.
Nothing built on a personal computer is signed. The Microsoft Store version is
signed by Microsoft.

## Privacy

Open Keep does not send your notes anywhere except the cloud storage you
choose to connect (Dropbox, OneDrive, Google Drive or your own WebDAV server),
and those copies are encrypted when you set a PIN. It counts users anonymously
and sends crash reports with all text masked. Details:
[privacy policy](https://openkeep.net/privacy-policy/) and the
[README](README.md#privacy).
