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

      // Recurring reminders are scheduled as a batch of one-shot notifications
      // rather than the plugin's `repeats`. With `at` set, both the iOS and
      // Android plugin ignore `every` and repeat at the gap between *now* and
      // `at` -- so a daily 08:00 reminder set at 15:00 the day before repeated
      // every 17 hours, and custom intervals (every 3 days, every 2 months)
      // couldn't be expressed at all. Computing each occurrence with
      // nextOccurrenceAfter keeps it on the right wall-clock time across
      // month lengths and DST. rescheduleAllReminders tops the batch up on
      // every app launch.
      const occurrences = upcomingOccurrences(note.reminder, note.recurrence, Date.now());

      await LocalNotifications.schedule({
        notifications: occurrences.map((at, i) => ({
          id: occurrenceNotificationId(note.id, i),
          title: note.title || "Reminder",
          body: "You have a note reminder.",
          schedule: { at: new Date(at) },
          sound: undefined,
          attachments: undefined,
          actionTypeId: "",
          extra: { noteId: note.id },
        })),
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
        armWebReminder(note, note.reminder);
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
      // Cancel every slot, not just the ones the current recurrence uses: the
      // note may previously have had a recurrence that scheduled more.
      const notifications = Array.from({ length: MAX_SCHEDULED_OCCURRENCES }, (_, i) => ({
        id: occurrenceNotificationId(noteId, i),
      }));
      await LocalNotifications.cancel({ notifications });
    } catch (e) {
      console.warn("Failed to cancel notification:", e);
    }
  } else {
    clearWebTimer(noteId);
  }
}

// --- Web reminder scheduling ---
//
// The browser has no OS-level scheduler, so web reminders are in-page timers.
// Two things make a bare setTimeout(fire, delay) unreliable:
//   * setTimeout stores its delay as a signed 32-bit int. Anything past
//     ~24.8 days overflows and fires immediately, so long delays are walked
//     down in MAX_TIMEOUT_MS hops, re-reading the clock at each hop.
//   * Timers die with the tab. The notes themselves are the persisted
//     schedule -- rescheduleAllReminders re-arms future reminders on every
//     load -- and a small "already notified" ledger in localStorage lets a
//     load fire a reminder that came due while the tab was closed, exactly
//     once. Only note ids and timestamps go in the ledger, never note text,
//     since web notes are otherwise stored encrypted.

const MAX_TIMEOUT_MS = 2_147_483_647;
// A reminder missed by more than this is dropped rather than fired late on
// the next load, so reopening the app after a long break isn't a flood.
const MISSED_REMINDER_GRACE_MS = 24 * 60 * 60 * 1000;
const FIRED_LEDGER_KEY = "open-keep-web-reminders-fired";

const webTimers = new Map<string, ReturnType<typeof setTimeout>>();

function clearWebTimer(noteId: string): void {
  const handle = webTimers.get(noteId);
  if (handle !== undefined) {
    clearTimeout(handle);
    webTimers.delete(noteId);
  }
}

/** noteId -> reminder timestamp that has already been notified. */
function readFiredLedger(): Record<string, number> {
  try {
    const raw = localStorage.getItem(FIRED_LEDGER_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function markWebReminderFired(noteId: string, dueAt: number): void {
  try {
    const ledger = readFiredLedger();
    ledger[noteId] = dueAt;
    // Anything older than the grace window can never be caught up again, so
    // its entry is no longer needed.
    const cutoff = Date.now() - MISSED_REMINDER_GRACE_MS;
    for (const id of Object.keys(ledger)) {
      if (ledger[id] < cutoff) delete ledger[id];
    }
    localStorage.setItem(FIRED_LEDGER_KEY, JSON.stringify(ledger));
  } catch {
    // Storage unavailable -- worst case a missed reminder is shown twice.
  }
}

function wasWebReminderFired(noteId: string, dueAt: number): boolean {
  return readFiredLedger()[noteId] === dueAt;
}

function showWebReminder(note: Note, dueAt: number): void {
  // Another tab (or an earlier load's catch-up) may already have shown it.
  if (wasWebReminderFired(note.id, dueAt)) return;
  markWebReminderFired(note.id, dueAt);
  try {
    new Notification(note.title || "Reminder", {
      body: "You have a note reminder.",
      // Same tag across tabs, so duplicates replace rather than stack.
      tag: `open-keep-reminder-${note.id}`,
    });
  } catch (e) {
    // e.g. Android Chrome only allows notifications via a service worker.
    console.warn("Failed to show reminder notification:", e);
  }
}

function armWebReminder(note: Note, dueAt: number): void {
  clearWebTimer(note.id);
  const delay = dueAt - Date.now();
  if (delay <= 0) return;

  if (delay > MAX_TIMEOUT_MS) {
    webTimers.set(note.id, setTimeout(() => armWebReminder(note, dueAt), MAX_TIMEOUT_MS));
    return;
  }

  webTimers.set(note.id, setTimeout(() => {
    webTimers.delete(note.id);
    showWebReminder(note, dueAt);
    if (note.recurrence && note.recurrence.type !== 'none') {
      // dueAt may be a clamped occurrence, so anchor on the note's own reminder.
      const rec = withResolvedAnchor(note.reminder ?? dueAt, note.recurrence);
      armWebReminder(note, nextOccurrenceAfter(dueAt, rec, Date.now()));
    }
  }, delay));
}

/** On web, fire a reminder that came due while no tab was open (once, and
 *  only if it's recent enough to still be useful). */
function catchUpMissedWebReminder(note: Note, dueAt: number, now: number): void {
  if (Capacitor.isNativePlatform()) return;
  if (!("Notification" in window) || Notification.permission !== 'granted') return;
  if (dueAt > now || now - dueAt > MISSED_REMINDER_GRACE_MS) return;
  showWebReminder(note, dueAt);
}


/** Number of days in the given month (month is 0-based, may overflow into other years) */
function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

/** How many months a month/year-based recurrence advances per step, or null
 *  for day/week-based recurrences (which can't drift and just add days). */
function monthStep(recurrence: NonNullable<Note['recurrence']>): number | null {
  if (recurrence.type === 'monthly') return 1;
  if (recurrence.type === 'yearly') return 12;
  if (recurrence.type === 'custom') {
    const interval = recurrence.interval || 1;
    if (recurrence.unit === 'month') return interval;
    if (recurrence.unit === 'year') return interval * 12;
  }
  return null;
}

/**
 * Day-of-month a month/year-based recurrence is anchored to. Once an occurrence
 * has been clamped (Jan 31 -> Feb 28) the saved reminder no longer carries the
 * original day, so it's kept in recurrence.anchorDay. The stored value is only
 * trusted if the reminder is exactly what that anchor would clamp to in the
 * reminder's own month -- otherwise the reminder was moved without the anchor
 * being cleared, and the reminder's own day wins.
 */
function resolveAnchorDay(reminder: number, recurrence: NonNullable<Note['recurrence']>): number {
  const d = new Date(reminder);
  const anchor = recurrence.anchorDay;
  if (
    anchor && Number.isInteger(anchor) && anchor >= 1 && anchor <= 31 &&
    Math.min(anchor, daysInMonth(d.getFullYear(), d.getMonth())) === d.getDate()
  ) {
    return anchor;
  }
  return d.getDate();
}

/**
 * The recurrence with its anchor day pinned to the original reminder's. Needed
 * wherever occurrences are chained (occurrence n -> n+1): without it, once one
 * occurrence is clamped to Feb 28 the next is computed from day 28 and the
 * reminder drifts to the 28th for good.
 */
function withResolvedAnchor(reminder: number, recurrence: Note['recurrence']): Note['recurrence'] {
  if (!recurrence || monthStep(recurrence) === null) return recurrence;
  return { ...recurrence, anchorDay: resolveAnchorDay(reminder, recurrence) };
}

/** Calculate the next occurrence for a recurring reminder */
function nextOccurrenceAfter(reminder: number, recurrence: Note['recurrence'], now: number): number {
  if (!recurrence || recurrence.type === 'none') return reminder;
  if (reminder > now) return reminder;

  const step = monthStep(recurrence);
  if (step !== null) {
    // Month/year based: compute each occurrence from the anchor rather than
    // stepping from the previous one, and clamp to the last day of the target
    // month. Stepping with setMonth() overflows (Jan 31 + 1 month = Mar 3) and
    // the drift then sticks for every later occurrence.
    const start = new Date(reminder);
    const anchorDay = resolveAnchorDay(reminder, recurrence);
    for (let k = 1; k <= 10000; k++) {
      const year = start.getFullYear();
      const month = start.getMonth() + k * step;
      const day = Math.min(anchorDay, daysInMonth(year, month));
      const next = new Date(
        year, month, day,
        start.getHours(), start.getMinutes(), start.getSeconds(), start.getMilliseconds(),
      );
      if (next.getTime() > now) return next.getTime();
    }
    return reminder;
  }

  const date = new Date(reminder);

  // Failsafe limit to avoid infinite loops with corrupted data
  let iterations = 0;
  while (date.getTime() <= now && iterations < 10000) {
    iterations++;
    if (recurrence.type === 'daily') {
      date.setDate(date.getDate() + 1);
    } else if (recurrence.type === 'weekly') {
      date.setDate(date.getDate() + 7);
    } else if (recurrence.type === 'custom') {
      const interval = recurrence.interval || 1;
      if (recurrence.unit === 'week') date.setDate(date.getDate() + (interval * 7));
      else date.setDate(date.getDate() + interval);
    } else {
      break;
    }
  }
  return date.getTime();
}

/** The most recent occurrence of a recurring reminder that is <= now (the
 *  reminder itself if it doesn't recur). */
function latestOccurrenceAtOrBefore(reminder: number, recurrence: Note['recurrence'], now: number): number {
  const rec = withResolvedAnchor(reminder, recurrence);
  let latest = reminder;
  for (let i = 0; i < 10000; i++) {
    const next = nextOccurrenceAfter(latest, rec, latest);
    if (next <= latest || next > now) break;
    latest = next;
  }
  return latest;
}

/** Reschedule all pending reminders (e.g. on app cold start) */
export async function rescheduleAllReminders(notes: Note[]): Promise<void> {
  const now = Date.now();
  const pending: Note[] = [];

  for (const n of notes) {
    if (!n.reminder || n.isDeleted) continue;

    if (n.reminder > now) {
      pending.push(n);
      continue;
    }

    // Past due. Native notifications fire from the OS even with the app
    // closed; web ones don't, so show it now if it was missed.
    catchUpMissedWebReminder(n, latestOccurrenceAtOrBefore(n.reminder, n.recurrence, now), now);

    if (n.recurrence && n.recurrence.type !== 'none') {
      // Past-due but recurring — roll forward to the next occurrence
      const nextTime = nextOccurrenceAfter(n.reminder, n.recurrence, now);

      // Month/year recurrences: remember the original day-of-month before the
      // reminder is overwritten, since the next occurrence may be clamped
      // (Jan 31 -> Feb 28) and would otherwise lose it for good.
      n.recurrence = withResolvedAnchor(n.reminder, n.recurrence);

      // Update in-memory so Index.tsx sees the new time
      n.reminder = nextTime;

      // updatedAt is deliberately NOT bumped. The next occurrence is worked
      // out from (reminder, recurrence), so every device reaches the same time
      // on its own next launch -- it doesn't need to travel through sync. This
      // used to set updatedAt to "now" on every cold start, which showed a
      // note the user hadn't touched as edited just now, floated it to the top
      // of a sort-by-edited list, and made it the winner of the next
      // last-write-wins sync.

      // Save it to update the database
      await saveNote(n);
      
      pending.push(n);
    }
  }

  await Promise.all(pending.map(scheduleReminderNotification));
}

// How many upcoming occurrences of a recurring reminder are handed to the OS
// at once. iOS only keeps the 64 soonest pending notifications across the
// whole app, so this stays small enough for several recurring notes to share
// that budget; the batch is refilled on every launch, so a daily reminder only
// runs dry if the app goes unopened for this many days.
const MAX_SCHEDULED_OCCURRENCES = 10;

/** The reminder time plus, if it recurs, the following occurrences --
 *  only those still in the future, at most MAX_SCHEDULED_OCCURRENCES. */
function upcomingOccurrences(reminder: number, recurrence: Note['recurrence'], now: number): number[] {
  const recurs = !!recurrence && recurrence.type !== 'none';
  const rec = withResolvedAnchor(reminder, recurrence);
  const first = recurs ? nextOccurrenceAfter(reminder, rec, now - 1) : reminder;
  const result = [first];
  while (recurs && result.length < MAX_SCHEDULED_OCCURRENCES) {
    const prev = result[result.length - 1];
    const next = nextOccurrenceAfter(prev, rec, prev);
    if (next <= prev) break; // unknown recurrence type -- don't loop forever
    result.push(next);
  }
  return result;
}

/** Notification ID for the i-th scheduled occurrence of a note's reminder.
 *  Occurrence 0 keeps the original single-notification ID, so cancelling a
 *  reminder also clears one scheduled by an older build. */
function occurrenceNotificationId(noteId: string, i: number): number {
  return i === 0 ? hashNoteId(noteId) : hashNoteId(`${noteId}#${i}`);
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
