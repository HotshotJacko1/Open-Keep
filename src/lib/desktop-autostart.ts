// Copyright (c) 2026. Licensed under AGPLv3.
//
// Launch at startup, for the Windows desktop app: the web side of
// src-tauri/src/autostart.rs.

export interface AutostartState {
    /** Windows will start the app when the user signs in. */
    enabled: boolean;
    /** Switched off (or forced on) in Windows Settings, so the app can't change it. */
    managedByWindows: boolean;
    /** At sign-in, start in the system tray instead of showing the window. */
    startMinimised: boolean;
}

const invoke = async <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<T>(command, args);
};

export const getAutostart = (): Promise<AutostartState> => invoke("autostart_get");

export const setAutostart = (enabled: boolean): Promise<AutostartState> =>
    invoke("autostart_set", { enabled });

export const setStartMinimised = (minimised: boolean): Promise<void> =>
    invoke("autostart_set_minimised", { minimised });
