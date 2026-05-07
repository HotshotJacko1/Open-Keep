import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";
import { Note } from "@/types/note";

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
  // Round up to the next even hour, capped at 18:00 today
  const laterToday = new Date(now);
  laterToday.setMinutes(0, 0, 0);
  laterToday.setHours(laterToday.getHours() + 2); // at least 1h away, round to even
  if (laterToday.getHours() % 2 !== 0) {
    laterToday.setHours(laterToday.getHours() + 1);
  }
  if (laterToday.getHours() > 18) {
    laterToday.setHours(18);
  }
  options.push({
    label: "Later today",
    time: formatTime(laterToday),
    ts: laterToday.getTime(),
  });

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

/** Schedule (or reschedule) a local notification for a note reminder */
export async function scheduleReminderNotification(note: Note): Promise<void> {
  if (!note.reminder) return;

  if (Capacitor.isNativePlatform()) {
    try {
      // Cancel any existing notification for this note first
      await cancelReminderNotification(note.id);

      // Numeric ID derived from note ID (hash to int)
      const notifId = hashNoteId(note.id);

      await LocalNotifications.schedule({
        notifications: [
          {
            id: notifId,
            title: note.title || "Reminder",
            body: "You have a note reminder.",
            schedule: { at: new Date(note.reminder) },
            sound: undefined,
            attachments: undefined,
            actionTypeId: "",
            extra: { noteId: note.id },
          },
        ],
      });
    } catch (e) {
      console.warn("Failed to schedule notification:", e);
    }
  } else {
    // Web fallback via browser Notifications API
    if ("Notification" in window && Notification.permission === "granted") {
      const delay = note.reminder - Date.now();
      if (delay > 0) {
        setTimeout(() => {
          new Notification(note.title || "Reminder", {
            body: "You have a note reminder.",
          });
        }, delay);
      }
    }
  }
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

/** Request notification permissions (call once on app start) */
export async function requestNotificationPermission(): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    try {
      const { display } = await LocalNotifications.requestPermissions();
      if (display !== "granted") {
        console.warn("Notification permission not granted");
      }
    } catch (e) {
      console.warn("Failed to request notification permissions:", e);
    }
  } else if ("Notification" in window && Notification.permission === "default") {
    await Notification.requestPermission();
  }
}

/** Reschedule all pending reminders (e.g. on app cold start) */
export async function rescheduleAllReminders(notes: Note[]): Promise<void> {
  const now = Date.now();
  const pending = notes.filter((n) => n.reminder && n.reminder > now);
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
