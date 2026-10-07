// Copyright (c) 2026. Licensed under AGPLv3.
//
// When App Lock asks for the PIN again after the app has been in the
// background (C3-27). Native only: on web, App Lock is asked for when the page
// loads, and a hidden tab isn't "away" in the same way.
//
// Locking unmounts the app (the same lock screen as a cold start), so anything
// still in flight in the UI when it locks is dropped. That's why the picker and
// sign-in flows below get a longer allowance.

/** Back after at least this long in the background, and App Lock asks again. */
export const RELOCK_AFTER_MS = 30_000;

/**
 * After the app sends the user elsewhere on purpose (the photo picker, a cloud
 * sign-in), it waits this long instead. Otherwise a photo picked, or a sign-in
 * finished, after an ordinary 30 seconds would be lost behind the lock screen.
 */
const EXTERNAL_RELOCK_AFTER_MS = 10 * 60_000;

/**
 * How soon after expectExternalActivity() the app must go to the background for
 * the longer allowance to apply. Stops a picker that never opened from
 * stretching the next, unrelated trip away.
 */
const EXTERNAL_START_WINDOW_MS = 15_000;

let externalActivityExpectedAt: number | null = null;

/** Call just before opening a picker or sign-in flow that leaves the app. */
export const expectExternalActivity = (): void => {
    externalActivityExpectedAt = Date.now();
};

/**
 * Whether coming back at `now`, after going to the background at
 * `backgroundedAt`, should lock. Uses up any expectExternalActivity() call.
 */
export const shouldRelock = (backgroundedAt: number, now: number): boolean => {
    const expected = externalActivityExpectedAt;
    externalActivityExpectedAt = null;
    const external = expected !== null && backgroundedAt - expected <= EXTERNAL_START_WINDOW_MS;
    return now - backgroundedAt >= (external ? EXTERNAL_RELOCK_AFTER_MS : RELOCK_AFTER_MS);
};
