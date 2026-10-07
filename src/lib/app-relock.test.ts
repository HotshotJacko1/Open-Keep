// Copyright (c) 2026. Licensed under AGPLv3.
import { describe, it, expect, vi, afterEach } from "vitest";
import { expectExternalActivity, shouldRelock, RELOCK_AFTER_MS } from "@/lib/app-relock";

const T0 = 1_800_000_000_000;

afterEach(() => {
    vi.useRealTimers();
    shouldRelock(0, 0); // use up any expectExternalActivity() a test left behind
});

describe("C3-27: when App Lock asks again after the background", () => {
    it("doesn't lock after a short trip away", () => {
        expect(shouldRelock(T0, T0 + RELOCK_AFTER_MS - 1)).toBe(false);
    });

    it("locks once the app has been away long enough", () => {
        expect(shouldRelock(T0, T0 + RELOCK_AFTER_MS)).toBe(true);
    });

    it("gives the photo picker or a sign-in a longer allowance", () => {
        vi.useFakeTimers();
        vi.setSystemTime(T0);
        expectExternalActivity();
        expect(shouldRelock(T0 + 1_000, T0 + 5 * 60_000)).toBe(false);
    });

    it("still locks after a very long sign-in", () => {
        vi.useFakeTimers();
        vi.setSystemTime(T0);
        expectExternalActivity();
        expect(shouldRelock(T0 + 1_000, T0 + 11 * 60_000)).toBe(true);
    });

    it("ignores an allowance that wasn't followed by leaving the app", () => {
        vi.useFakeTimers();
        vi.setSystemTime(T0);
        expectExternalActivity();
        // Went to the background a minute later, for an unrelated reason.
        expect(shouldRelock(T0 + 60_000, T0 + 60_000 + RELOCK_AFTER_MS)).toBe(true);
    });

    it("uses up the allowance on the next return", () => {
        vi.useFakeTimers();
        vi.setSystemTime(T0);
        expectExternalActivity();
        expect(shouldRelock(T0 + 1_000, T0 + 2_000)).toBe(false);
        expect(shouldRelock(T0 + 3_000, T0 + 3_000 + RELOCK_AFTER_MS)).toBe(true);
    });
});
