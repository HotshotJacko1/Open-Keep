// Copyright (c) 2026. Licensed under AGPLv3.
import { Capacitor } from "@capacitor/core";
import { Directory, Filesystem } from "@capacitor/filesystem";

/**
 * Where native exports are written for the share sheet (C2-36).
 *
 * An export is a decrypted copy of notes ("Export All Notes" is the whole
 * vault), so it shouldn't outlive the share. It can't be deleted as soon as
 * Share.share() returns, because the receiving app may still be reading it,
 * so every export goes in this one folder, which is emptied before the next
 * export and at every launch.
 */
const EXPORT_DIR = "exports";

export const exportCachePath = (filename: string): string => `${EXPORT_DIR}/${filename}`;

export const clearExportCache = async (): Promise<void> => {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await Filesystem.rmdir({ path: EXPORT_DIR, directory: Directory.Cache, recursive: true });
  } catch {
    // Nothing exported yet.
  }
  // Builds before C2-36 wrote exports to the cache root, and never deleted them.
  try {
    const { files } = await Filesystem.readdir({ path: "", directory: Directory.Cache });
    await Promise.all(files
      .filter((file) => file.type === "file" && /\.(md|zip)$/i.test(file.name))
      .map((file) => Filesystem.deleteFile({ path: file.name, directory: Directory.Cache }).catch(() => undefined)));
  } catch {
    // An unreadable cache has nothing of ours to clean up.
  }
};
