// Copyright (c) 2026. Licensed under AGPLv3.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => false } }));
vi.mock("./platform", () => ({ isDesktopApp: () => false }));

const UA = {
    macChrome: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    macSafari: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15",
    macFirefox: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:133.0) Gecko/20100101 Firefox/133.0",
    linuxChrome: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    linuxFirefox: "Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0",
    windowsEdge: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
    windowsFirefox: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0",
    android: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
    iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
};

type Listener = (event: Event) => void;
let listeners: Record<string, Listener[]>;

/** A browser tab with this user agent, at `path`. */
const setBrowser = (userAgent: string, { standalone = false, touchPoints = 0, path = "/" } = {}) => {
    listeners = {};
    vi.stubGlobal("navigator", { userAgent, maxTouchPoints: touchPoints });
    vi.stubGlobal("window", {
        location: { pathname: path, search: "", hash: "" },
        history: { state: null, replaceState: vi.fn() },
        matchMedia: () => ({ matches: standalone }),
        addEventListener: (type: string, listener: Listener) => {
            (listeners[type] ??= []).push(listener);
        },
    });
};

/** Chrome and Edge's install prompt arriving. */
const offerInstallPrompt = () => {
    const event = { preventDefault: vi.fn(), prompt: vi.fn(async () => {}), userChoice: Promise.resolve({ outcome: "accepted" }) };
    listeners.beforeinstallprompt.forEach((listener) => listener(event as unknown as Event));
};

const loadPwa = async () => {
    vi.resetModules();
    const pwa = await import("./pwa");
    pwa.startPwa();
    return pwa;
};

describe("install help (the install link's box)", () => {
    beforeEach(() => vi.stubEnv("DEV", true)); // no service worker registration in tests
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.unstubAllEnvs();
    });

    it.each([
        ["Mac Chrome", UA.macChrome],
        ["Linux Chrome", UA.linuxChrome],
    ])("%s: install button once the prompt arrives, instructions before", async (_name, ua) => {
        setBrowser(ua);
        const pwa = await loadPwa();
        expect(pwa.getInstallHelp()).toEqual({ kind: "chromium" });
        offerInstallPrompt();
        expect(pwa.getInstallHelp()?.kind).toBe("prompt");
    });

    it("Mac Safari: Add to Dock steps", async () => {
        setBrowser(UA.macSafari);
        const pwa = await loadPwa();
        expect(pwa.getInstallHelp()).toEqual({ kind: "safari" });
    });

    it.each([
        ["Mac Firefox", UA.macFirefox],
        ["Linux Firefox", UA.linuxFirefox],
    ])("%s: explains Firefox can't install", async (_name, ua) => {
        setBrowser(ua);
        const pwa = await loadPwa();
        expect(pwa.getInstallHelp()).toEqual({ kind: "firefox" });
    });

    it.each([
        ["Edge", UA.windowsEdge],
        ["Firefox", UA.windowsFirefox],
    ])("Windows %s: the Windows app", async (_name, ua) => {
        setBrowser(ua);
        const pwa = await loadPwa();
        expect(pwa.getInstallHelp()).toEqual({ kind: "windows", install: undefined });
    });

    it("Windows with the prompt: the web app as a second choice", async () => {
        setBrowser(UA.windowsEdge);
        const pwa = await loadPwa();
        offerInstallPrompt();
        const help = pwa.getInstallHelp();
        expect(help?.kind).toBe("windows");
        expect(help && "install" in help && help.install).toBeTypeOf("function");
    });

    it.each([
        ["Android", UA.android, 0, "Google Play"],
        ["iPhone", UA.iphone, 5, "the App Store"],
        ["iPad (reports itself as a Mac)", UA.macSafari, 5, "the App Store"],
    ])("%s: the store app", async (_name, ua, touchPoints, storeName) => {
        setBrowser(ua, { touchPoints });
        const pwa = await loadPwa();
        expect(pwa.getInstallHelp()).toMatchObject({ kind: "phone", storeName });
    });

    it("already running installed: nothing", async () => {
        setBrowser(UA.macChrome, { standalone: true });
        const pwa = await loadPwa();
        expect(pwa.getInstallHelp()).toBeNull();
    });

    it("/install is remembered and the address becomes /", async () => {
        setBrowser(UA.macChrome, { path: "/install/" });
        const pwa = await loadPwa();
        expect(pwa.isInstallRequested()).toBe(true);
        expect(window.history.replaceState).toHaveBeenCalledWith(null, "", "/");
        pwa.clearInstallRequest();
        expect(pwa.isInstallRequested()).toBe(false);
    });

    it("any other path is not an install request", async () => {
        setBrowser(UA.macChrome, { path: "/" });
        const pwa = await loadPwa();
        expect(pwa.isInstallRequested()).toBe(false);
    });
});
