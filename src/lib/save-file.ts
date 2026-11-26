// Copyright (c) 2026. Licensed under AGPLv3.
import { isDesktopApp } from "./platform";

export interface SaveFileFilter {
    name: string;
    extensions: string[];
}

/**
 * Saves a file the user is exporting (zip of notes, a single note, a backup).
 *
 * Desktop: Windows' Save As dialog, then writes where they chose. Returns false
 * if they cancelled. The fs plugin can only write to a path picked in that
 * dialog, never anywhere else.
 * Web: a browser download, which can't report a cancel, so always true.
 *
 * Phones don't come here: they write to the cache and open the share sheet.
 */
export const saveFile = async (blob: Blob, filename: string, filters?: SaveFileFilter[]): Promise<boolean> => {
    if (isDesktopApp()) {
        const [{ save }, { writeFile }] = await Promise.all([
            import("@tauri-apps/plugin-dialog"),
            import("@tauri-apps/plugin-fs"),
        ]);
        const path = await save({ defaultPath: filename, filters });
        if (!path) return false;
        await writeFile(path, new Uint8Array(await blob.arrayBuffer()));
        return true;
    }
    const { saveAs } = await import("file-saver");
    saveAs(blob, filename);
    return true;
};
