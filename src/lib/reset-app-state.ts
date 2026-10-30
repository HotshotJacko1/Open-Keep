// Copyright (c) 2026. Licensed under AGPLv3.
import { clearAllData } from "@/lib/note-storage";
import { deleteAllImages } from "@/lib/image-storage";
import { clearAllPinState } from "@/lib/pin";
import { deleteAllRemoteData, signOutOfCloudProviders } from "@/lib/cloud-reset";
import { clearTagChanges } from "@/lib/tombstones";
import { clearKeepLocalPending } from "@/lib/cloud-sync-runner";

/**
 * The "Forgot PIN" reset, shared by the lock screen and the Change PIN dialog
 * so the two can't drift apart again (C2-35). A new persisted key or provider
 * session belongs here.
 *
 * It always deletes this device's notes and images: with encryption on they
 * can't be opened without the PIN, and with App Lock alone, keeping them would
 * let anyone holding the device remove the lock and read them (C2-32, option a).
 * The cloud copy is deleted only with encryption on, where it can't be opened
 * either; with App Lock alone it stays, so the owner can sign in again and get
 * the notes back. Every cloud sign-in is forgotten either way, or the next sync
 * would bring the notes straight back.
 *
 * The notes go first: if deleting them fails, the PIN is still in place.
 */
export const resetAppState = async ({ deleteCloudData }: { deleteCloudData: boolean }): Promise<void> => {
    await clearAllData();
    await deleteAllImages();
    if (deleteCloudData) await deleteAllRemoteData();
    await signOutOfCloudProviders();

    clearAllPinState();
    localStorage.removeItem("custom-tags");
    clearTagChanges();
    clearKeepLocalPending();
};
