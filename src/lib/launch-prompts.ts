// Copyright (c) 2026. Licensed under AGPLv3.
//
// Occasional cards at the top of the notes list ("Would you recommend Open
// Keep?", "Enjoying Open Keep?"). Each shows on a launch only when both enough
// time and enough launches have passed, so a person who opens the app once a
// month and one who opens it ten times a day are both asked rarely. Everything
// is kept on the device; nothing here talks to a server.

export const KOFI_URL = "https://ko-fi.com/D1I1275TCA";

export const DAY_MS = 24 * 60 * 60 * 1000;

export interface LaunchPromptConfig {
    /** localStorage key holding this prompt's state. */
    key: string;
    /** No prompt for this long after the prompt first runs on a device. */
    firstDelayMs: number;
    /** After the card has shown, wait this long before showing it again. */
    repromptDelayMs: number;
    /** Launches needed since the card last showed (or since first run). */
    launchesBetween: number;
}

/** Same rule as the server's old `ready_to_ask_for_feedback` (open_keep_user_status view). */
export const FEEDBACK_PROMPT: LaunchPromptConfig = {
    key: "feedback-prompt",
    firstDelayMs: 30 * DAY_MS,
    repromptDelayMs: 60 * DAY_MS,
    launchesBetween: 10,
};

export const SUPPORT_PROMPT: LaunchPromptConfig = {
    key: "support-prompt",
    firstDelayMs: 14 * DAY_MS,
    repromptDelayMs: 60 * DAY_MS,
    launchesBetween: 10,
};

/** After tapping Donate, wait longer before asking again. */
export const AFTER_DONATE_DELAY_MS = 180 * DAY_MS;

export interface LaunchPromptState {
    /** Launches counted since the card last showed. */
    launches: number;
    /** Epoch ms before which the card won't show. */
    nextEligibleAt: number;
}

type KeyValueStorage = Pick<Storage, "getItem" | "setItem">;

/** The stored state, or null when there is none yet (or it's corrupt). */
export const readLaunchPromptState = (
    config: LaunchPromptConfig,
    storage: KeyValueStorage = localStorage,
): LaunchPromptState | null => {
    try {
        const parsed = JSON.parse(storage.getItem(config.key) ?? "null");
        if (parsed && Number.isFinite(parsed.launches) && Number.isFinite(parsed.nextEligibleAt)) {
            return { launches: parsed.launches, nextEligibleAt: parsed.nextEligibleAt };
        }
    } catch {
        // Missing, corrupt or unreadable: start over.
    }
    return null;
};

export const writeLaunchPromptState = (
    config: LaunchPromptConfig,
    state: LaunchPromptState,
    storage: KeyValueStorage = localStorage,
): void => {
    try {
        storage.setItem(config.key, JSON.stringify(state));
    } catch {
        // Storage unavailable: nothing to remember, and the card won't show.
    }
};

/**
 * Counts this launch and says whether the card should show on it. Showing it
 * restarts both the launch count and the waiting period, so an ignored card
 * isn't repeated on the next launch. Pass `canShow: false` when another card
 * already has this launch; the launch still counts. Call once per launch.
 */
export const recordLaunch = (
    config: LaunchPromptConfig,
    now: number = Date.now(),
    canShow = true,
    storage: KeyValueStorage = localStorage,
): boolean => {
    // Unreadable storage starts over every launch, so the card never shows.
    let state = readLaunchPromptState(config, storage) ?? {
        launches: 0,
        nextEligibleAt: now + config.firstDelayMs,
    };
    state.launches += 1;
    const show = canShow && now >= state.nextEligibleAt && state.launches >= config.launchesBetween;
    if (show) {
        state = { launches: 0, nextEligibleAt: now + config.repromptDelayMs };
    }
    writeLaunchPromptState(config, state, storage);
    return show;
};

/** Don't show the card again for `delayMs`, and start the launch count over. */
export const snoozeLaunchPrompt = (
    config: LaunchPromptConfig,
    delayMs: number,
    now: number = Date.now(),
    storage: KeyValueStorage = localStorage,
): void => {
    writeLaunchPromptState(config, { launches: 0, nextEligibleAt: now + delayMs }, storage);
};

/**
 * Before the feedback prompt's timing moved onto the device, the server kept
 * it: account at least FEEDBACK_PROMPT.firstDelayMs old, and at least
 * repromptDelayMs since the last answer or skip (`feedback_date`). Carries
 * that over once, so people who already answered aren't asked again early and
 * long-time users don't wait another month. Keeps the local launch count.
 */
export const feedbackStateFromServer = (
    local: LaunchPromptState | null,
    accountCreatedAt: number,
    lastAskedAt: number | null,
): LaunchPromptState => ({
    launches: local?.launches ?? 0,
    nextEligibleAt: Math.max(
        accountCreatedAt + FEEDBACK_PROMPT.firstDelayMs,
        lastAskedAt === null ? -Infinity : lastAskedAt + FEEDBACK_PROMPT.repromptDelayMs,
    ),
});
