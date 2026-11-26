// Copyright (c) 2026. Licensed under AGPLv3.
//
// Settings → Desktop → "Launch at startup" and "Start minimised to the tray".
//
// Two ways in, as with openkeep:// (link_repair.rs):
// - The `.exe` install adds `"...\open-keep.exe" --autostart` to
//   HKCU\...\CurrentVersion\Run. The NSIS uninstaller removes it again
//   (nsis/hooks.nsh).
// - The Store package can't: its HKCU writes go to a private copy of the
//   registry that Windows never reads at sign-in. It declares a startup task in
//   its manifest (msix/AppxManifest.xml) instead, switched with the StartupTask API.
//
// Both can be turned off by the user in Windows Settings → Apps → Startup (or
// Task Manager). The app reports that rather than pretending it is on.
//
// "Start minimised" is a marker file, read when Windows starts the app at
// sign-in. Starting the app any other way always shows the window.

use serde::Serialize;
use tauri::{AppHandle, Manager};

/// Argument the Run entry passes, so the app knows Windows started it.
#[cfg_attr(not(windows), allow(dead_code))]
const AUTOSTART_ARG: &str = "--autostart";
/// The startup task's TaskId in msix/AppxManifest.xml.
#[cfg_attr(not(windows), allow(dead_code))]
const STARTUP_TASK_ID: &str = "OpenKeepStartup";
/// Marker file in the app's local data folder: present = start minimised.
const MINIMISED_MARKER: &str = "start-minimised";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutostartState {
    /// Windows will start the app at sign-in.
    enabled: bool,
    /// Turned off (or forced on) outside the app, so the switch can't change it.
    /// Only the Store version: the `.exe` version can turn itself back on.
    managed_by_windows: bool,
    start_minimised: bool,
}

/// True when Windows started this process at sign-in.
pub fn launched_at_startup() -> bool {
    #[cfg(windows)]
    {
        if crate::store_package::is_packaged() {
            return packaged::launched_by_startup_task();
        }
    }
    std::env::args().skip(1).any(|arg| arg == AUTOSTART_ARG)
}

/// True when this launch should stay in the tray instead of showing the window.
pub fn should_start_hidden(app: &AppHandle) -> bool {
    launched_at_startup() && start_minimised(app)
}

fn marker(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_local_data_dir().ok().map(|dir| dir.join(MINIMISED_MARKER))
}

fn start_minimised(app: &AppHandle) -> bool {
    marker(app).is_some_and(|path| path.exists())
}

fn state(app: &AppHandle) -> Result<AutostartState, String> {
    let (enabled, managed_by_windows) = platform_state()?;
    Ok(AutostartState { enabled, managed_by_windows, start_minimised: start_minimised(app) })
}

#[tauri::command]
pub async fn autostart_get(app: AppHandle) -> Result<AutostartState, String> {
    tauri::async_runtime::spawn_blocking(move || state(&app))
        .await
        .map_err(|e| e.to_string())?
}

/// Turns launching at sign-in on or off, then reports what Windows ended up with.
#[tauri::command]
pub async fn autostart_set(app: AppHandle, enabled: bool) -> Result<AutostartState, String> {
    tauri::async_runtime::spawn_blocking(move || {
        platform_set(enabled)?;
        state(&app)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn autostart_set_minimised(app: AppHandle, minimised: bool) -> Result<(), String> {
    let path = marker(&app).ok_or("No app data folder")?;
    if minimised {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        std::fs::write(&path, b"").map_err(|e| e.to_string())
    } else {
        match std::fs::remove_file(&path) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
            _ => Ok(()),
        }
    }
}

#[cfg(windows)]
fn platform_state() -> Result<(bool, bool), String> {
    if crate::store_package::is_packaged() {
        packaged::state()
    } else {
        Ok((run_key::is_enabled(), false))
    }
}

#[cfg(windows)]
fn platform_set(enabled: bool) -> Result<(), String> {
    if crate::store_package::is_packaged() {
        packaged::set(enabled)
    } else {
        run_key::set(enabled)
    }
}

#[cfg(not(windows))]
fn platform_state() -> Result<(bool, bool), String> {
    Ok((false, false))
}

#[cfg(not(windows))]
fn platform_set(_enabled: bool) -> Result<(), String> {
    Err("Launch at startup is only available on Windows".into())
}

/// The `.exe` install: an entry in HKCU\...\Run.
#[cfg(windows)]
mod run_key {
    use windows_registry::CURRENT_USER;

    const RUN: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
    /// Where Windows Settings → Startup apps and Task Manager record that the
    /// user turned an entry off, without removing it from Run.
    const APPROVED: &str = r"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run";

    /// A build from the project folder gets its own entry, so trying the switch
    /// there doesn't repoint the installed app's.
    const VALUE: &str = if cfg!(debug_assertions) { "Open Keep (dev)" } else { "Open Keep" };

    pub fn is_enabled() -> bool {
        let present = CURRENT_USER.open(RUN).and_then(|key| key.get_string(VALUE)).is_ok();
        present && !turned_off_in_windows()
    }

    /// StartupApproved holds a 12-byte value per entry: first byte 2 (or 6)
    /// is on, 3 (or 7) is off. No value means on.
    fn turned_off_in_windows() -> bool {
        CURRENT_USER
            .open(APPROVED)
            .and_then(|key| key.get_value(VALUE))
            .is_ok_and(|value| value.first().is_some_and(|flag| flag & 1 == 1))
    }

    pub fn set(enabled: bool) -> Result<(), String> {
        let run = CURRENT_USER.create(RUN).map_err(|e| e.to_string())?;
        if enabled {
            let exe = std::env::current_exe().map_err(|e| e.to_string())?;
            let command = format!("\"{}\" {}", exe.display(), super::AUTOSTART_ARG);
            run.set_string(VALUE, command).map_err(|e| e.to_string())?;
        } else {
            let _ = run.remove_value(VALUE);
        }
        // The user asked for this in the app, so it overrides an earlier "off"
        // in Windows Settings (and a stale flag doesn't outlive the entry).
        // (`open` alone is read-only.)
        if let Ok(approved) = CURRENT_USER.options().read().write().open(APPROVED) {
            let _ = approved.remove_value(VALUE);
        }
        Ok(())
    }
}

/// The Store package: the startup task in its manifest.
#[cfg(windows)]
mod packaged {
    use windows::ApplicationModel::Activation::ActivationKind;
    use windows::ApplicationModel::{AppInstance, StartupTask, StartupTaskState};
    use windows::core::HSTRING;

    pub fn launched_by_startup_task() -> bool {
        AppInstance::GetActivatedEventArgs()
            .and_then(|args| args.Kind())
            .is_ok_and(|kind| kind == ActivationKind::StartupTask)
    }

    fn task() -> Result<StartupTask, String> {
        StartupTask::GetAsync(&HSTRING::from(super::STARTUP_TASK_ID))
            .and_then(|op| op.join())
            .map_err(|e| format!("Could not read the startup task: {e}"))
    }

    fn describe(state: StartupTaskState) -> (bool, bool) {
        match state {
            StartupTaskState::Enabled => (true, false),
            StartupTaskState::EnabledByPolicy => (true, true),
            StartupTaskState::DisabledByUser | StartupTaskState::DisabledByPolicy => (false, true),
            _ => (false, false),
        }
    }

    pub fn state() -> Result<(bool, bool), String> {
        let state = task()?.State().map_err(|e| e.to_string())?;
        Ok(describe(state))
    }

    pub fn set(enabled: bool) -> Result<(), String> {
        let task = task()?;
        let current = task.State().map_err(|e| e.to_string())?;
        if describe(current).1 {
            // Off in Windows Settings: only the user can turn it back on there.
            return Ok(());
        }
        if enabled {
            task.RequestEnableAsync()
                .and_then(|op| op.join())
                .map_err(|e| format!("Could not turn on launch at startup: {e}"))?;
        } else {
            task.Disable().map_err(|e| e.to_string())?;
        }
        Ok(())
    }
}
