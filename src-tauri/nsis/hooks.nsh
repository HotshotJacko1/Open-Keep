; Copyright (c) 2026. Licensed under AGPLv3.
;
; Installer hooks for the `.exe` version (tauri.conf.json → bundle.windows.nsis).

; Settings → "Launch at startup" adds an entry to HKCU\...\Run (src/autostart.rs).
; Remove it when the app is uninstalled, but not when an update runs the old
; uninstaller first (/UPDATE), or updating would turn the setting off.
!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $UpdateMode <> 1
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Open Keep"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "Open Keep"
  ${EndIf}
!macroend
