// Copyright (c) 2026. Licensed under AGPLv3.
//
// Windows Hello for App Lock's biometric unlock: the desktop side of
// src/lib/biometrics.ts. Hello is whatever the user set up in Windows (face,
// fingerprint, or the Windows PIN as its fallback).
//
// The encryption PIN that biometric unlock hands to the unlock flow is kept in
// Credential Manager, like the auto-unlock key in storage/keys.rs.

use tauri::WebviewWindow;
use windows::Security::Credentials::UI::{
    UserConsentVerificationResult, UserConsentVerifier, UserConsentVerifierAvailability,
};
use windows::Win32::Foundation::HWND;
use windows::Win32::System::WinRT::IUserConsentVerifierInterop;
use windows::core::{HSTRING, factory};
use windows_future::IAsyncOperation;

const KEYRING_SERVICE: &str = "com.jackbarkerapps.openkeep";
const KEYRING_USER: &str = "biometric_pin";

/// True when Windows Hello is set up on this PC for this user.
#[tauri::command]
pub async fn bio_is_available() -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(|| {
        UserConsentVerifier::CheckAvailabilityAsync()
            .and_then(|op| op.join())
            .map(|a| a == UserConsentVerifierAvailability::Available)
            .unwrap_or(false)
    })
    .await
    .map_err(|e| e.to_string())
}

/// Shows the Windows Hello prompt over the app window. Ok only when the user
/// passed it; cancelling or failing is an error, so the lock screen stays up.
#[tauri::command]
pub async fn bio_verify(window: WebviewWindow, reason: String) -> Result<(), String> {
    // HWND holds a raw pointer, which can't cross into the blocking thread.
    let hwnd = window.hwnd().map_err(|e| e.to_string())?.0 as isize;
    let result = tauri::async_runtime::spawn_blocking(move || -> windows::core::Result<UserConsentVerificationResult> {
        let interop = factory::<UserConsentVerifier, IUserConsentVerifierInterop>()?;
        // The ForWindow variant parents the prompt to our window. The plain
        // RequestVerificationAsync is for UWP apps and opens behind a desktop window.
        let op: IAsyncOperation<UserConsentVerificationResult> = unsafe {
            interop.RequestVerificationForWindowAsync(HWND(hwnd as *mut _), &HSTRING::from(reason))
        }?;
        op.join()
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| format!("Windows Hello failed: {e}"))?;

    log::info!("Windows Hello result: {result:?}");
    match result {
        UserConsentVerificationResult::Verified => Ok(()),
        UserConsentVerificationResult::Canceled => Err("Cancelled".into()),
        UserConsentVerificationResult::RetriesExhausted => Err("Too many attempts".into()),
        UserConsentVerificationResult::DeviceBusy => Err("Windows Hello is busy".into()),
        UserConsentVerificationResult::NotConfiguredForUser => Err("Windows Hello is not set up".into()),
        UserConsentVerificationResult::DisabledByPolicy => Err("Windows Hello is turned off by policy".into()),
        _ => Err("Windows Hello is not available".into()),
    }
}

fn entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER).map_err(|e| format!("Credential store unavailable: {e}"))
}

#[tauri::command]
pub fn bio_set_credential(pin: String) -> Result<(), String> {
    entry()?
        .set_password(&pin)
        .map_err(|e| format!("Could not save the PIN to Credential Manager: {e}"))
}

#[tauri::command]
pub fn bio_get_credential() -> Result<String, String> {
    entry()?
        .get_password()
        .map_err(|e| format!("No PIN stored for biometric unlock: {e}"))
}

#[tauri::command]
pub fn bio_delete_credential() -> Result<(), String> {
    match entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("Could not delete the stored PIN: {e}")),
    }
}
