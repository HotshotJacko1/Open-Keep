# Copyright (c) 2026. Licensed under AGPLv3.
#
# Packs the desktop app's release build into an MSIX for the Microsoft Store
# (docs/plans/D1-windows-desktop.md). Run after `pnpm desktop:build`:
#
#   pnpm desktop:msix
#
# Output: src-tauri/target/msix/OpenKeep_<version>_x64.msix, unsigned. The
# Store signs it after certification; it can't be installed by double-click
# until then (to test locally, turn on Developer Mode and register the staged
# folder: Add-AppxPackage -Register src-tauri\target\msix\stage\AppxManifest.xml).
#
# Needs the Windows 10/11 SDK (makeappx.exe, makepri.exe), which the Visual
# Studio C++ workload installs, as do GitHub's windows-latest runners.

$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$tauri = Join-Path $root "src-tauri"
$out = Join-Path $tauri "target\msix"
$stage = Join-Path $out "stage"

# Version: tauri.conf.json, which scripts/sync-version.cjs keeps equal to
# build.gradle. The Store reserves an MSIX version's fourth part (it must be 0),
# so only x.y.z can be packaged.
$version = (Get-Content (Join-Path $tauri "tauri.conf.json") -Raw | ConvertFrom-Json).version
if ($version -notmatch '^\d+\.\d+\.\d+$') {
    throw "MSIX needs an x.y.z version, but tauri.conf.json has '$version'. The Store reserves the fourth part of the version, so release a three-part versionName."
}
$msixVersion = "$version.0"

# Newest installed SDK that has the packaging tools.
$kits = Join-Path ${env:ProgramFiles(x86)} "Windows Kits\10\bin"
$sdk = Get-ChildItem $kits -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match '^10\.' -and (Test-Path (Join-Path $_.FullName "x64\makeappx.exe")) } |
    Sort-Object { [version]$_.Name } -Descending |
    Select-Object -First 1
if (-not $sdk) { throw "Windows SDK not found (makeappx.exe under $kits)." }
$makeappx = Join-Path $sdk.FullName "x64\makeappx.exe"
$makepri = Join-Path $sdk.FullName "x64\makepri.exe"

$exe = Join-Path $tauri "target\release\open-keep.exe"
if (-not (Test-Path $exe)) { throw "No release build at $exe. Run 'pnpm desktop:build' first." }

Write-Host "Packing Open Keep $msixVersion with Windows SDK $($sdk.Name)"

if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
New-Item -ItemType Directory -Force $stage | Out-Null
# Tauri embeds the web app and WebView2's loader in the exe, so it is the only file.
Copy-Item $exe $stage
Copy-Item -Recurse (Join-Path $tauri "msix\Assets") (Join-Path $stage "Assets")
(Get-Content (Join-Path $tauri "msix\AppxManifest.xml") -Raw).Replace("{{VERSION}}", $msixVersion) |
    Set-Content (Join-Path $stage "AppxManifest.xml") -Encoding utf8

# resources.pri lets Windows pick Assets\Square44x44Logo.targetsize-32_altform-unplated.png
# and the scale-200 files for the plain names in the manifest. Without it the
# qualified files are never found.
$priConfig = Join-Path $out "priconfig.xml"
& $makepri createconfig /cf $priConfig /dq en-GB /o | Out-Null
if ($LASTEXITCODE -ne 0) { throw "makepri createconfig failed ($LASTEXITCODE)" }
# The default config splits scale/language variants into resources.<qualifier>.pri
# files meant for separate resource packages in a bundle. This is a single
# package, so keep every variant in the one resources.pri.
[xml]$cfg = Get-Content $priConfig
$packaging = $cfg.SelectSingleNode("//packaging")
if ($packaging) { [void]$packaging.ParentNode.RemoveChild($packaging) }
$cfg.Save($priConfig)
& $makepri new /pr $stage /cf $priConfig /mn (Join-Path $stage "AppxManifest.xml") /of (Join-Path $stage "resources.pri") /o | Out-Null
if ($LASTEXITCODE -ne 0) { throw "makepri new failed ($LASTEXITCODE)" }

$msix = Join-Path $out "OpenKeep_${msixVersion}_x64.msix"
& $makeappx pack /d $stage /p $msix /o
if ($LASTEXITCODE -ne 0) { throw "makeappx pack failed ($LASTEXITCODE)" }

Write-Host "Built $msix"
