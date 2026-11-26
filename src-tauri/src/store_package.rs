// Copyright (c) 2026. Licensed under AGPLv3.
//
// Whether this copy is the Microsoft Store (MSIX) package rather than the
// `.exe` install. The Store version gets updates from the Store and declares
// openkeep:// in its manifest; the `.exe` version updates itself
// (src/lib/desktop-updater.ts) and keeps its own link registration
// (link_repair.rs).

/// True when running from an MSIX package (the Microsoft Store version).
#[cfg(windows)]
pub fn is_packaged() -> bool {
    use windows::Win32::Foundation::APPMODEL_ERROR_NO_PACKAGE;
    use windows::Win32::Storage::Packaging::Appx::GetCurrentPackageFullName;
    let mut length = 0u32;
    // With no buffer this only asks for the name's length; an unpackaged
    // process gets APPMODEL_ERROR_NO_PACKAGE instead.
    let result = unsafe { GetCurrentPackageFullName(&mut length, None) };
    result != APPMODEL_ERROR_NO_PACKAGE
}

#[cfg(not(windows))]
pub fn is_packaged() -> bool {
    false
}

#[tauri::command]
pub fn desktop_is_store_package() -> bool {
    is_packaged()
}
