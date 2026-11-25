// Copyright (c) 2026. Licensed under AGPLv3.
import { describe, it, expect } from "vitest";
import { LAST_SEEN_VERSION_KEY, markUpdateNoticeSeen, shouldShowUpdateNotice } from "@/lib/update-notice";

const memoryStorage = (initial: Record<string, string> = {}) => {
    const data = new Map(Object.entries(initial));
    return {
        getItem: (key: string) => data.get(key) ?? null,
        setItem: (key: string, value: string) => void data.set(key, value),
        data,
    };
};

describe("App updated card", () => {
    it("doesn't show on a fresh install, and remembers the version", () => {
        const storage = memoryStorage();
        expect(shouldShowUpdateNotice("5.4.2", storage)).toBe(false);
        expect(storage.data.get(LAST_SEEN_VERSION_KEY)).toBe("5.4.2");
        expect(shouldShowUpdateNotice("5.4.2", storage)).toBe(false);
    });

    it("shows when upgrading from a version without the card", () => {
        const storage = memoryStorage({ "sort-mode": "recent" });
        expect(shouldShowUpdateNotice("5.4.2", storage)).toBe(true);
    });

    it("shows after the version changes and keeps showing until seen", () => {
        const storage = memoryStorage({ [LAST_SEEN_VERSION_KEY]: "5.4.1" });
        expect(shouldShowUpdateNotice("5.4.2", storage)).toBe(true);
        expect(shouldShowUpdateNotice("5.4.2", storage)).toBe(true);
        markUpdateNoticeSeen("5.4.2", storage);
        expect(shouldShowUpdateNotice("5.4.2", storage)).toBe(false);
    });

    it("stays quiet if storage throws", () => {
        const storage = {
            getItem: () => { throw new Error("blocked"); },
            setItem: () => { throw new Error("blocked"); },
        };
        expect(shouldShowUpdateNotice("5.4.2", storage)).toBe(false);
        expect(() => markUpdateNoticeSeen("5.4.2", storage)).not.toThrow();
    });
});
