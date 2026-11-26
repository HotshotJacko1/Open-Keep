// Copyright (c) 2026. Licensed under AGPLv3.
//
// Keeps openkeep:// (Dropbox and OneDrive sign-in) pointing at a working copy
// of the app, for the `.exe` install. The NSIS installer registers it once, in
// HKCU\Software\Classes\openkeep. But when the Microsoft Store package (which
// declares the same scheme) is installed on the same PC and later removed,
// Windows deletes that whole key, and sign-in in the `.exe` install would stop
// working (docs/plans/D1-windows-desktop.md). So at startup, outside a package,
// the app repairs a missing or dead registration.
//
// A registration that works is left alone, even if it points at another copy:
// running a build from the project folder mustn't take links over from the
// installed app.

use std::path::Path;

use tauri::AppHandle;

pub fn repair_protocol_registration(app: &AppHandle) {
    // Inside the Store package the manifest declares the scheme.
    if crate::store_package::is_packaged() {
        return;
    }
    let registered = windows_registry::CURRENT_USER
        .open(r"Software\Classes\openkeep\shell\open\command")
        .and_then(|key| key.get_string(""))
        .ok();
    if registered.as_deref().and_then(command_exe).is_some_and(|exe| Path::new(exe).is_file()) {
        return;
    }
    use tauri_plugin_deep_link::DeepLinkExt;
    match app.deep_link().register_all() {
        Ok(()) => log::info!("Registered openkeep:// for this copy of the app (was {registered:?})"),
        Err(error) => log::warn!("Could not register openkeep://: {error}"),
    }
}

/// The exe in a shell open command: `"C:\...\open-keep.exe" "%1"` or `C:\app.exe %1`.
fn command_exe(command: &str) -> Option<&str> {
    let command = command.trim();
    let exe = match command.strip_prefix('"') {
        Some(rest) => rest.split('"').next()?,
        None => command.split_whitespace().next()?,
    };
    (!exe.is_empty()).then_some(exe)
}

#[cfg(test)]
mod tests {
    use super::command_exe;

    #[test]
    fn reads_the_exe_from_open_commands() {
        assert_eq!(
            command_exe(r#""C:\Users\me\AppData\Local\Open Keep\open-keep.exe" "%1""#),
            Some(r"C:\Users\me\AppData\Local\Open Keep\open-keep.exe")
        );
        assert_eq!(command_exe(r"C:\apps\keep.exe %1"), Some(r"C:\apps\keep.exe"));
        assert_eq!(command_exe("   "), None);
        assert_eq!(command_exe(r#""" "%1""#), None);
    }
}
