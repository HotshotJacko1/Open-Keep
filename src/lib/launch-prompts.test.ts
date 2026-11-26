// Copyright (c) 2026. Licensed under AGPLv3.
import { describe, it, expect } from "vitest";
import {
    AFTER_DONATE_DELAY_MS,
    DAY_MS,
    FEEDBACK_PROMPT,
    SUPPORT_PROMPT,
    feedbackStateFromServer,
    recordLaunch,
    snoozeLaunchPrompt,
    type LaunchPromptConfig,
} from "@/lib/launch-prompts";

const T0 = 1_800_000_000_000;

const memoryStorage = (initial: Record<string, string> = {}) => {
    const data = new Map(Object.entries(initial));
    return {
        getItem: (key: string) => data.get(key) ?? null,
        setItem: (key: string, value: string) => void data.set(key, value),
        data,
    };
};

/** Launch `count` times at `at`; returns whether any launch showed the card. */
const launch = (
    config: LaunchPromptConfig,
    storage: ReturnType<typeof memoryStorage>,
    at: number,
    count = 1,
    canShow = true,
) => {
    let shown = false;
    for (let i = 0; i < count; i++) {
        shown = recordLaunch(config, at, canShow, storage) || shown;
    }
    return shown;
};

describe.each([
    ["Enjoying Open Keep? (Ko-fi)", SUPPORT_PROMPT],
    ["Would you recommend Open Keep? (feedback)", FEEDBACK_PROMPT],
])("%s card", (_name, config) => {
    it("doesn't show before the first delay, however often the app opens", () => {
        const storage = memoryStorage();
        expect(launch(config, storage, T0, 50)).toBe(false);
        expect(launch(config, storage, T0 + config.firstDelayMs - 1, 50)).toBe(false);
    });

    it("doesn't show after the delay until enough launches have passed", () => {
        const storage = memoryStorage();
        expect(launch(config, storage, T0)).toBe(false);
        expect(launch(config, storage, T0 + config.firstDelayMs, config.launchesBetween - 2)).toBe(false);
        expect(launch(config, storage, T0 + config.firstDelayMs)).toBe(true);
    });

    it("shows once, then waits again for time and launches", () => {
        const storage = memoryStorage();
        launch(config, storage, T0, config.launchesBetween);
        const shownAt = T0 + config.firstDelayMs;
        expect(launch(config, storage, shownAt)).toBe(true);
        expect(launch(config, storage, shownAt, 100)).toBe(false);
        expect(launch(config, storage, shownAt + config.repromptDelayMs)).toBe(true);
    });

    it("gives way to another card without losing the launch", () => {
        const storage = memoryStorage();
        launch(config, storage, T0, config.launchesBetween);
        expect(launch(config, storage, T0 + config.firstDelayMs, 1, false)).toBe(false);
        expect(launch(config, storage, T0 + config.firstDelayMs)).toBe(true);
    });

    it("starts over from corrupt data", () => {
        const storage = memoryStorage({ [config.key]: "{not json" });
        expect(launch(config, storage, T0, 50)).toBe(false);
        expect(launch(config, storage, T0 + config.firstDelayMs)).toBe(true);
    });

    it("never shows if storage throws", () => {
        const storage = {
            getItem: () => { throw new Error("blocked"); },
            setItem: () => { throw new Error("blocked"); },
        };
        for (let i = 0; i < 50; i++) {
            expect(recordLaunch(config, T0 + config.firstDelayMs * 10, true, storage)).toBe(false);
        }
    });
});

describe("prompts are independent", () => {
    it("each keeps its own count and timing", () => {
        const storage = memoryStorage();
        launch(SUPPORT_PROMPT, storage, T0, 20);
        expect(launch(FEEDBACK_PROMPT, storage, T0 + SUPPORT_PROMPT.firstDelayMs, 20)).toBe(false);
        expect(launch(SUPPORT_PROMPT, storage, T0 + SUPPORT_PROMPT.firstDelayMs)).toBe(true);
    });
});

describe("Donate", () => {
    it("waits longer before asking again", () => {
        const storage = memoryStorage();
        snoozeLaunchPrompt(SUPPORT_PROMPT, AFTER_DONATE_DELAY_MS, T0, storage);
        expect(launch(SUPPORT_PROMPT, storage, T0 + SUPPORT_PROMPT.repromptDelayMs, 100)).toBe(false);
        expect(launch(SUPPORT_PROMPT, storage, T0 + AFTER_DONATE_DELAY_MS)).toBe(true);
    });
});

describe("carrying the feedback timing over from the server", () => {
    it("a long-time user who was never asked is due straight away", () => {
        const state = feedbackStateFromServer({ launches: 3, nextEligibleAt: T0 + 30 * DAY_MS }, T0 - 365 * DAY_MS, null);
        expect(state).toEqual({ launches: 3, nextEligibleAt: T0 - 335 * DAY_MS });
    });

    it("someone asked recently waits two months from then", () => {
        const askedAt = T0 - 10 * DAY_MS;
        const state = feedbackStateFromServer(null, T0 - 365 * DAY_MS, askedAt);
        expect(state).toEqual({ launches: 0, nextEligibleAt: askedAt + FEEDBACK_PROMPT.repromptDelayMs });
    });

    it("a new account waits a month from when it was made", () => {
        const state = feedbackStateFromServer(null, T0, null);
        expect(state.nextEligibleAt).toBe(T0 + FEEDBACK_PROMPT.firstDelayMs);
    });
});
