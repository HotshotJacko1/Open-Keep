// Copyright (c) 2026. Licensed under AGPLv3.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { check, toast } = vi.hoisted(() => {
    const toast = Object.assign(vi.fn(), { loading: vi.fn(), error: vi.fn() });
    return { check: vi.fn(), toast };
});

vi.mock("sonner", () => ({ toast }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn() }));

import { checkForUpdate, findUpdate } from "@/lib/desktop-updater";

type Offer = { id: string; action: { onClick: () => void } };
const fakeUpdate = (version: string, downloadAndInstall: () => Promise<void>) => ({ version, downloadAndInstall });
const lastOffer = () => toast.mock.calls.at(-1)?.[1] as Offer;

describe("desktop update reminder", () => {
    beforeEach(() => {
        check.mockReset();
        toast.mockClear();
        toast.loading.mockClear();
        toast.error.mockClear();
    });

    it("offers the same version again at every check, as one toast", async () => {
        check.mockResolvedValue(fakeUpdate("6.0.1", async () => {}));

        await checkForUpdate();
        await checkForUpdate(); // the next day, after the first offer was closed

        expect(toast).toHaveBeenCalledTimes(2);
        const ids = toast.mock.calls.map(([, options]) => (options as Offer).id);
        expect(ids[0]).toBe(ids[1]);
    });

    it("stays quiet when there's no update", async () => {
        check.mockResolvedValue(null);
        await checkForUpdate();
        expect(toast).not.toHaveBeenCalled();
    });

    it("doesn't offer while an update is downloading, and offers again if it fails", async () => {
        let failDownload: (error: Error) => void = () => {};
        const downloading = new Promise<void>((_, reject) => { failDownload = reject; });
        check.mockResolvedValue(fakeUpdate("6.0.1", () => downloading));

        await checkForUpdate();
        lastOffer().action.onClick(); // "Restart to update"
        expect(toast.loading).toHaveBeenCalledTimes(1);

        await checkForUpdate();
        expect(toast).toHaveBeenCalledTimes(1);
        expect(check).toHaveBeenCalledTimes(1);

        failDownload(new Error("offline"));
        await vi.waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));

        await checkForUpdate();
        expect(toast).toHaveBeenCalledTimes(2);
    });
});

describe("Settings → Check for updates", () => {
    beforeEach(() => {
        check.mockReset();
        toast.mockClear();
    });

    it("reports each answer without showing the toast", async () => {
        check.mockResolvedValueOnce(null);
        expect(await findUpdate()).toEqual({ status: "none" });

        check.mockRejectedValueOnce(new Error("offline"));
        expect(await findUpdate()).toEqual({ status: "failed" });

        check.mockResolvedValueOnce(fakeUpdate("6.0.1", async () => {}));
        expect(await findUpdate()).toMatchObject({ status: "available", version: "6.0.1" });

        expect(toast).not.toHaveBeenCalled();
    });

    it("says an update is downloading instead of checking again", async () => {
        let failDownload: (error: Error) => void = () => {};
        const downloading = new Promise<void>((_, reject) => { failDownload = reject; });
        check.mockResolvedValue(fakeUpdate("6.0.1", () => downloading));

        const found = await findUpdate();
        if (found.status !== "available") throw new Error("expected an update");
        const installed = found.install();

        expect(await findUpdate()).toEqual({ status: "installing" });
        expect(check).toHaveBeenCalledTimes(1);

        failDownload(new Error("offline"));
        await installed;
        expect(await findUpdate()).toMatchObject({ status: "available" });
    });
});
