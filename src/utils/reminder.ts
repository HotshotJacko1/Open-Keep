// Copyright (c) 2026. Licensed under AGPLv3.
import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";
import { Note } from "@/types/note";
import { saveNote } from "@/lib/note-storage";

export interface ReminderOption {
  label: string;   // e.g. "Later today"
  time: string;    // e.g. "18:00" or "Thu, 8 May"
  ts: number | null; // null = "Choose a date and time"
}

/**
 * Returns the 4 reminder quick-pick options based on the current time.
 */
export function getReminderOptions(now: Date): ReminderOption[] {
  const options: ReminderOption[] = [];

  // --- Later today ---
  const laterToday = new Date(now);
  laterToday.setMinutes(0, 0, 0);
  laterToday.setHours(laterToday.getHours() + 2);
  if (laterToday.getHours() % 2 !== 0) {
    laterToday.setHours(laterToday.getHours() + 1);
  }

  const sameDay = laterToday.getDate() === now.getDate();
  if (sameDay && laterToday.getHours() > 18) {
    laterToday.setHours(18);
  }

  // Only offer "Later today" if it is actually still today and still in the future
  if (sameDay && laterToday.getTime() > now.getTime()) {
    options.push({
      label: "Later today",
      time: formatTime(laterToday),
      ts: laterToday.getTime(),
    });
  }

  // --- Tomorrow morning ---
  const tomorrowMorning = new Date(now);
  tomorrowMorning.setDate(tomorrowMorning.getDate() + 1);
  tomorrowMorning.setHours(8, 0, 0, 0);
  options.push({
    label: "Tomorrow morning",
    time: formatTime(tomorrowMorning),
    ts: tomorrowMorning.getTime(),
  });

  // --- Next [Weekday] --- same weekday as today, 7 days from now at 08:00
  const nextWeekday = new Date(now);
  nextWeekday.setDate(nextWeekday.getDate() + 7);
  nextWeekday.setHours(8, 0, 0, 0);
  const weekdayName = nextWeekday.toLocaleDateString("en-GB", { weekday: "long" });
  options.push({
    label: `Next ${weekdayName}`,
    time: formatTime(nextWeekday),
    ts: nextWeekday.getTime(),
  });

  // --- Choose a date and time ---
  options.push({
    label: "Choose a date and time",
    time: "",
    ts: null,
  });

  return options;
}

/** Format a Date as HH:MM */
function formatTime(d: Date): string {
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

/** Format a reminder timestamp into a human-readable chip label */
export function formatReminderLabel(ts: number): string {
  const now = new Date();
  const d = new Date(ts);

  const isToday =
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear();

  const isTomorrow = (() => {
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return (
      d.getDate() === tomorrow.getDate() &&
      d.getMonth() === tomorrow.getMonth() &&
      d.getFullYear() === tomorrow.getFullYear()
    );
  })();

  const timeStr = d.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });

  if (isToday) return `Today, ${timeStr}`;
  if (isTomorrow) return `Tomorrow, ${timeStr}`;
  return d.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  }) + `, ${timeStr}`;
}

/** Schedule (or reschedule) a local notification for a note reminder.
 *  Returns:
 *    true    â€” scheduled successfully
 *    false   â€” scheduling failed (non-permission error)
 *    'denied' â€” permission is permanently denied; user must go to Settings */
export async function scheduleReminderNotification(note: Note): Promise<boolean | 'denied'> {
  if (!note.reminder) return true;

  if (Capacitor.isNativePlatform()) {
    // --- Permission gate ---
    try {
      let { display } = await LocalNotifications.checkPermissions();

      if (display === 'denied') {
        // Android will not show a dialog once permission has been explicitly denied.
        // The user must re-enable in system Settings manually.
        console.warn('Notification permission permanently denied â€” user must open Settings.');
        return 'denied';
      }

      if (display !== 'granted') {
        // 'prompt' or 'prompt-with-rationale' â€” OS can still show the dialog
        const result = await LocalNotifications.requestPermissions();
        display = result.display;
      }

      if (display !== 'granted') {
        // User declined the dialog
        return false;
      }
    } catch (e) {
      console.warn('Failed to check/request notification permissions:', e);
      return false;
    }

    try {
      // Cancel any existing notification for this note first
      await cancelReminderNotification(note.id);

      // Numeric ID derived from note ID (hash to int)
      const notifId = hashNoteId(note.id);
      
      const scheduleOptions: any = { at: new Date(note.reminder) };
      
      if (note.recurrence && note.recurrence.type !== 'none') {
        scheduleOptions.repeats = true;
        
        if (note.recurrence.type === 'daily') scheduleOptions.every = 'day';
        else if (note.recurrence.type === 'weekly') scheduleOptions.every = 'week';
        else if (note.recurrence.type === 'monthly') scheduleOptions.every = 'month';
        else if (note.recurrence.type === 'yearly') scheduleOptions.every = 'year';
        else if (note.recurrence.type === 'custom') {
          const { interval, unit } = note.recurrence;
          if (interval === 1) {
            scheduleOptions.every = unit;
          } else if (interval === 2 && unit === 'week') {
            scheduleOptions.every = 'two-weeks';
          }
        }
      }

      await LocalNotifications.schedule({
        notifications: [
          {
            id: notifId,
            title: note.title || "Reminder",
            body: "You have a note reminder.",
            schedule: scheduleOptions,
            sound: undefined,
            attachments: undefined,
            actionTypeId: "",
            extra: { noteId: note.id },
          },
        ],
      });

      return true;
    } catch (e) {
      console.warn("Failed to schedule notification:", e);
      return false;
    }
  } else {
    // Web fallback via browser Notifications API
    if ("Notification" in window) {
      if (Notification.permission === 'default') {
        await Notification.requestPermission();
      }
      if (Notification.permission === 'granted') {
        const delay = note.reminder - Date.now();
        if (delay > 0) {
          setTimeout(() => {
            new Notification(note.title || "Reminder", {
              body: "You have a note reminder.",
            });
          }, delay);
        }
        return true;
      }
      return false;
    }
  }
  return true;
}

/** Cancel a previously scheduled notification for a note */
export async function cancelReminderNotification(noteId: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    try {
      const notifId = hashNoteId(noteId);
      await LocalNotifications.cancel({ notifications: [{ id: notifId }] });
    } catch (e) {
      console.warn("Failed to cancel notification:", e);
    }
  }
}


/** Calculate the next occurrence for a recurring reminder */
function nextOccurrenceAfter(reminder: number, recurrence: Note['recurrence'], now: number): number {
  if (!recurrence || recurrence.type === 'none') return reminder;
  const date = new Date(reminder);

  // Failsafe limit to avoid infinite loops with corrupted data
  let iterations = 0;
  while (date.getTime() <= now && iterations < 10000) {
    iterations++;
    if (recurrence.type === 'daily') {
      date.setDate(date.getDate() + 1);
    } else if (recurrence.type === 'weekly') {
      date.setDate(date.getDate() + 7);
    } else if (recurrence.type === 'monthly') {
      date.setMonth(date.getMonth() + 1);
    } else if (recurrence.type === 'yearly') {
      date.setFullYear(date.getFullYear() + 1);
    } else if (recurrence.type === 'custom') {
      const interval = recurrence.interval || 1;
      const unit = recurrence.unit || 'day';
      if (unit === 'day') date.setDate(date.getDate() + interval);
      else if (unit === 'week') date.setDate(date.getDate() + (interval * 7));
      else if (unit === 'month') date.setMonth(date.getMonth() + interval);
      else if (unit === 'year') date.setFullYear(date.getFullYear() + interval);
    } else {
      break;
    }
  }
  return date.getTime();
}

/** Reschedule all pending reminders (e.g. on app cold start) */
export async function rescheduleAllReminders(notes: Note[]): Promise<void> {
  const now = Date.now();
  const pending: Note[] = [];

  for (const n of notes) {
    if (!n.reminder || n.isDeleted) continue;

    if (n.reminder > now) {
      pending.push(n);
    } else if (n.recurrence && n.recurrence.type !== 'none') {
      // Past-due but recurring — roll forward to the next occurrence
      const nextTime = nextOccurrenceAfter(n.reminder, n.recurrence, now);
      
      // Update in-memory so Index.tsx sees the new time
      n.reminder = nextTime;
      n.updatedAt = Math.max(Date.now(), n.updatedAt + 1);
      
      // Save it to update the database
      await saveNote(n);
      
      pending.push(n);
    }
  }

  await Promise.all(pending.map(scheduleReminderNotification));
}

/** Stable numeric ID from a UUID string (djb2 hash) */
function hashNoteId(noteId: string): number {
  let hash = 5381;
  for (let i = 0; i < noteId.length; i++) {
    hash = (hash * 33) ^ noteId.charCodeAt(i);
  }
  // Keep positive and within safe JS int range
  return Math.abs(hash) % 2_000_000_000;
}
