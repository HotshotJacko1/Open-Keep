// Copyright (c) 2026. Licensed under AGPLv3.
import type { Note } from "@/types/note";
import { resolveImagesToBase64, restoreImagesFromBase64 } from "@/lib/image-storage";
import { normalizeTagChanges, normalizeTombstones } from "@/lib/tombstones";
import type { SyncData } from "@/lib/sync-merge";

/**
 * The cloud notes file format, shared by every provider. Each provider owns only
 * the transport and the outer encryption wrapping; the JSON inside is built here.
 *
 * Version 2 (C3-01) adds `tombstones` and `tombstonesPrunedBefore`, and (C1-19)
 * `tagChanges`. Earlier app versions ignore these fields and re-upload without
 * them, which is safe: devices on version 2 keep their own copy and put them
 * back (see lib/tombstones.ts).
 */
const FORMAT_VERSION = 2;

type NoteImages = Record<string, Array<{ id: string; data: string }>>;

export const serializeSyncData = async (data: SyncData): Promise<string> => {
    const noteImages: NoteImages = {};
    for (const note of data.notes) {
        if (note.images && note.images.length > 0) {
            noteImages[note.id] = await resolveImagesToBase64(note.images);
        }
    }
    return JSON.stringify({
        formatVersion: FORMAT_VERSION,
        notes: data.notes,
        customTags: data.customTags,
        noteImages,
        tombstones: data.tombstones,
        tagChanges: data.tagChanges,
        ...(data.tombstonesPrunedBefore !== undefined && { tombstonesPrunedBefore: data.tombstonesPrunedBefore }),
    });
};

/** Parses a decrypted cloud file: a bare notes array (oldest format) or the object format. */
export const parseSyncData = async (result: unknown): Promise<SyncData> => {
    let notes: Note[] = [];
    let customTags: string[] = [];
    let noteImages: NoteImages = {};
    let tombstones: SyncData["tombstones"] = [];
    let tombstonesPrunedBefore: number | undefined;
    let tagChanges: SyncData["tagChanges"] = [];

    if (Array.isArray(result)) {
        notes = result as Note[];
    } else if (result && typeof result === "object" && "notes" in result) {
        const payload = result as {
            notes?: Note[];
            customTags?: string[];
            noteImages?: NoteImages;
            tombstones?: unknown;
            tombstonesPrunedBefore?: unknown;
            tagChanges?: unknown;
        };
        notes = payload.notes || [];
        customTags = payload.customTags || [];
        noteImages = payload.noteImages || {};
        tombstones = normalizeTombstones(payload.tombstones);
        tagChanges = normalizeTagChanges(payload.tagChanges);
        if (typeof payload.tombstonesPrunedBefore === "number" && Number.isFinite(payload.tombstonesPrunedBefore)) {
            tombstonesPrunedBefore = payload.tombstonesPrunedBefore;
        }
    }

    for (const note of notes) {
        if (noteImages[note.id] && noteImages[note.id].length > 0) {
            note.images = await restoreImagesFromBase64(noteImages[note.id]);
        }
    }

    return { notes, customTags, tombstones, tombstonesPrunedBefore, tagChanges };
};
