// Copyright (c) 2026. Licensed under AGPLv3.
export interface Note {
  id: string;
  title: string;
  content: string;
  type?: 'text' | 'list'; // Explicit note type so list notes survive an empty body
  tags: string[];
  isPinned: boolean;
  isArchived: boolean;
  isDeleted?: boolean;
  deletedAt?: number;
  createdAt: number;
  updatedAt: number;
  images?: string[];
  color?: string; // Palette id from lib/note-colors (e.g. "sage"); absent = default
  reminder?: number; // Unix timestamp (ms) when the reminder notification should fire
  recurrence?: {
    type: 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom';
    interval?: number;
    unit?: 'day' | 'week' | 'month' | 'year';
    // Original day-of-month (1-31) for month/year recurrences, kept once an
    // occurrence has been clamped to a shorter month (Jan 31 -> Feb 28).
    // Set by rescheduleAllReminders; cleared whenever the user picks a date.
    anchorDay?: number;
  };
}

/**
 * Record that a note was permanently deleted, synced so other devices drop
 * their copy instead of merging it back in (C3-01). Holds no note content.
 */
export interface Tombstone {
  id: string;
  deletedAt: number; // ms since epoch, on the deleting device's clock
}

/**
 * The latest create or delete of a custom label, synced so a deleted or renamed
 * label doesn't come back from another device (C1-19). The newest change per name wins.
 */
export interface TagChange {
  name: string;
  deleted: boolean;
  at: number; // ms since epoch
}