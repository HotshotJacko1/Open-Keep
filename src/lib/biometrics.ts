// Copyright (c) 2026. Licensed under AGPLv3.
//
// Biometric unlock for App Lock, per platform:
//  - Android/iOS: @capgo/capacitor-native-biometric.
//  - Windows desktop: Windows Hello, through src-tauri/src/hello.rs.
//  - Browser: none.
//
// Don't import NativeBiometric directly. Off a phone it falls back to the
// plugin's web stub, which reports biometrics as available and passes every
// verifyIdentity() without asking for anything, so "Biometric Unlock" opened
// the app with no check at all on desktop and web.
import { Capacitor } from "@capacitor/core";
import {
    NativeBiometric,
    type DeleteCredentialOptions,
    type GetCredentialOptions,
    type SetCredentialOptions,
    type BiometricOptions,
} from "@capgo/capacitor-native-biometric";
import { isDesktopApp } from "@/lib/platform";

export interface BiometricsApi {
    isAvailable(): Promise<{ isAvailable: boolean }>;
    /** Resolves only when the user passed the check; rejects on cancel or failure. */
    verifyIdentity(options: BiometricOptions): Promise<void>;
    setCredentials(options: SetCredentialOptions): Promise<void>;
    getCredentials(options: GetCredentialOptions): Promise<{ password: string }>;
    deleteCredentials(options: DeleteCredentialOptions): Promise<void>;
}

const desktop: BiometricsApi = {
    async isAvailable() {
        const { invoke } = await import("@tauri-apps/api/core");
        return { isAvailable: await invoke<boolean>("bio_is_available") };
    },
    async verifyIdentity(options) {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("bio_verify", { reason: options.reason || options.title || "Unlock Open Keep" });
    },
    async setCredentials(options) {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("bio_set_credential", { pin: options.password });
    },
    async getCredentials() {
        const { invoke } = await import("@tauri-apps/api/core");
        return { password: await invoke<string>("bio_get_credential") };
    },
    async deleteCredentials() {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("bio_delete_credential");
    },
};

const unavailable: BiometricsApi = {
    isAvailable: async () => ({ isAvailable: false }),
    verifyIdentity: () => Promise.reject(new Error("Biometrics are not available here")),
    setCredentials: () => Promise.reject(new Error("Biometrics are not available here")),
    getCredentials: () => Promise.reject(new Error("Biometrics are not available here")),
    deleteCredentials: async () => {},
};

export const Biometrics: BiometricsApi = Capacitor.isNativePlatform()
    ? NativeBiometric
    : isDesktopApp()
      ? desktop
      : unavailable;
