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