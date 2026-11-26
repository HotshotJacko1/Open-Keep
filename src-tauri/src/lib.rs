// Copyright (c) 2026. Licensed under AGPLv3.

mod autostart;
mod hello;
// Used by release builds only (dev builds always register themselves).
#[cfg(windows)]
#[cfg_attr(debug_assertions, allow(dead_code))]
mod link_repair;
mod mcp;
mod store_package;
mod storage;

pub use mcp::{requested as mcp_requested, run as run_mcp};

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, WindowEvent};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_window_state::{AppHandleExt, StateFlags};

/// Shows, restores and focuses the main window (tray click, second launch).
fn show_main(app: &AppHandle) {
  if let Some(window) = app.get_webview_window("main") {
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
  }
}

/// The first time the window is closed to the tray, say so once: otherwise
/// "I closed it but my reminders still pop up" looks like a bug.
fn tray_hint_once(app: &AppHandle) {
  let Ok(dir) = app.path().app_local_data_dir() else { return };
  let marker = dir.join("tray-hint-shown");
  if marker.exists() {
    return;
  }
  let _ = std::fs::create_dir_all(&dir);
  let _ = std::fs::write(&marker, b"");
  let _ = app
    .notification()
    .builder()
    .title("Open Keep is still running")
    .body("It keeps running in the system tray so reminders still arrive. Right-click the tray icon to quit.")
    .show();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    // Must be the first plugin. A second launch (including Windows starting the
    // app for an openkeep:// sign-in link) focuses the running window instead of
    // opening another, which would share the encrypted database. The deep-link
    // feature hands that launch's link to the running app's deep-link listener.
    .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main(app)))
    .plugin(tauri_plugin_deep_link::init())
    // WebDAV sync (src/lib/webdav.ts) and OneDrive's token requests: sent from
    // Rust, so a server without CORS headers (Nextcloud) works as on mobile.
    .plugin(tauri_plugin_http::init())
    // Size, position and maximised state, restored at the next launch. Not
    // visibility: the window starts hidden (tauri.conf.json) and setup shows it,
    // unless Windows started the app at sign-in with "start minimised" on.
    .plugin(
      tauri_plugin_window_state::Builder::default()
        .with_state_flags(StateFlags::all() - StateFlags::VISIBLE)
        .build(),
    )
    // Also patches window.Notification, so the web reminder code shows Windows notifications.
    .plugin(tauri_plugin_notification::init())
    // Save dialog + writing the chosen file, for exports (src/lib/save-file.ts).
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    // Opens Dropbox/OneDrive/Google sign-in in the default browser.
    .plugin(tauri_plugin_opener::init())
    // Google Drive sign-in: a one-request listener on 127.0.0.1 that catches
    // Google's redirect (src/lib/google-desktop-auth.ts).
    .plugin(tauri_plugin_oauth::init())
    // Updates for the `.exe` version: signed installer + latest.json on the
    // GitHub release (src/lib/desktop-updater.ts). The Store version skips it.
    .plugin(tauri_plugin_updater::Builder::new().build())
    .plugin(tauri_plugin_process::init())
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      // The installer registers openkeep:// for the installed app; a dev build
      // registers itself so sign-in can be tested without installing.
      #[cfg(all(debug_assertions, windows))]
      {
        use tauri_plugin_deep_link::DeepLinkExt;
        app.deep_link().register_all()?;
      }
      // Release, outside the Store package: put the registration back if it's
      // gone (removing the package deletes it) or points at a deleted copy.
      #[cfg(all(not(debug_assertions), windows))]
      link_repair::repair_protocol_registration(app.handle());

      // %LOCALAPPDATA%\com.jackbarkerapps.openkeep, beside WebView2's profile.
      // Local, not roaming: the auto-unlock key in Credential Manager stays on this PC.
      let dir = app.path().app_local_data_dir()?;
      app.manage(storage::Storage::new(dir));

      // Tray: closing the window hides it here, so reminder timers keep running.
      let open = MenuItem::with_id(app, "open", "Open Open Keep", true, None::<&str>)?;
      let quit = MenuItem::with_id(app, "quit", "Quit Open Keep", true, None::<&str>)?;
      let menu = Menu::with_items(app, &[&open, &quit])?;
      let mut tray = TrayIconBuilder::with_id("main")
        .tooltip("Open Keep")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
          "open" => show_main(app),
          "quit" => app.exit(0),
          _ => {}
        })
        .on_tray_icon_event(|tray, event| {
          if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
            show_main(tray.app_handle());
          }
        });
      if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
      }
      tray.build(app)?;

      if autostart::should_start_hidden(app.handle()) {
        log::info!("Started at sign-in: staying in the tray");
      } else {
        show_main(app.handle());
      }
      Ok(())
    })
    .on_window_event(|window, event| {
      if let WindowEvent::CloseRequested { api, .. } = event {
        if window.label() == "main" {
          api.prevent_close();
          // The window-state plugin only writes to disk when the app exits, and a
          // tray app may never exit cleanly (Windows shutting down), so save now.
          let _ = window.app_handle().save_window_state(StateFlags::all());
          let _ = window.hide();
          tray_hint_once(window.app_handle());
        }
      }
    })
    .invoke_handler(tauri::generate_handler![
      store_package::desktop_is_store_package,
      autostart::autostart_get,
      autostart::autostart_set,
      autostart::autostart_set_minimised,
      storage::ns_load_notes,
      storage::ns_save_note,
      storage::ns_delete_note,
      storage::ns_migrate_from_web,
      storage::ns_initialize,
      storage::ns_check_status,
      storage::ns_change_encryption_key,
      storage::ns_export_master_key,
      storage::ns_import_master_key,
      storage::ns_verify_cloud_master_key_match,
      storage::ns_can_decrypt_cloud_master_key,
      storage::ns_wipe_database_but_keep_keys,
      storage::ns_encrypt,
      storage::ns_decrypt,
      storage::ns_lock,
      storage::ns_clear_all_data,
      hello::bio_is_available,
      hello::bio_verify,
      hello::bio_set_credential,
      hello::bio_get_credential,
      hello::bio_delete_credential,
      mcp::setup::mcp_set_token,
      mcp::setup::mcp_relay_command,
      mcp::setup::mcp_add_to_claude_desktop,
    ])
    .run(tauri::generate_context!())
    .expect("error while building tauri application");
}
