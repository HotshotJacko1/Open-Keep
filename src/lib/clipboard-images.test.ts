// Copyright (c) 2026. Licensed under AGPLv3.
import { describe, it, expect, vi, beforeEach } from "vitest";

const platform = vi.hoisted(() => ({ name: "web" }));
const nativeRead = vi.hoisted(() => vi.fn());

vi.mock("@capacitor/core", () => ({
  Capacitor: { getPlatform: () => platform.name },
  registerPlugin: () => ({ read: nativeRead }),
}));

import { base64ToFile, handleImagePaste, hasPastedText, imageFilesFrom } from "@/lib/clipboard-images";

const png = (name = "a.png") => new File([new Uint8Array([1, 2, 3])], name, { type: "image/png" });

/** A paste event whose clipboard holds `text` per type and `files`; reading `files` is recorded. */
const pasteEvent = (text: Record<string, string>, files: File[] = []) => {
  const read = { files: false };
  const clipboardData = {
    getData: (type: string) => text[type] ?? "",
    get files() {
      read.files = true;
      return files;
    },
  };
  return { event: { clipboardData } as unknown as ClipboardEvent, read };
};

beforeEach(() => {
  platform.name = "web";
  nativeRead.mockReset();
});

describe("OPENKEEP-17: pasting an image into a note body", () => {
  it("leaves text and HTML pastes to the editor", () => {
    expect(hasPastedText({ getData: (t) => (t === "text/plain" ? "hi" : "") })).toBe(true);
    expect(hasPastedText({ getData: (t) => (t === "text/html" ? "<b>x</b>" : "") })).toBe(true);
    expect(hasPastedText({ getData: () => "" })).toBe(false);

    const onImages = vi.fn();
    const { event, read } = pasteEvent({ "text/plain": "hello" }, [png()]);
    expect(handleImagePaste(event, onImages)).toBe(false);
    expect(onImages).not.toHaveBeenCalled();
    expect(read.files).toBe(false);
  });

  it("keeps only image files", () => {
    const text = new File(["x"], "a.txt", { type: "text/plain" });
    expect(imageFilesFrom([png(), text])).toHaveLength(1);
    expect(imageFilesFrom(null)).toEqual([]);
  });

  it("decodes the native plugin's base64 into a file", async () => {
    const file = base64ToFile(btoa("\x01\x02\xff"), "image/jpeg", "p");
    expect(file.type).toBe("image/jpeg");
    expect([...new Uint8Array(await file.arrayBuffer())]).toEqual([1, 2, 255]);
  });

  it("on the web, attaches pasted image files", () => {
    const onImages = vi.fn();
    const image = png();
    const { event } = pasteEvent({}, [image]);
    expect(handleImagePaste(event, onImages)).toBe(true);
    expect(onImages).toHaveBeenCalledWith({ files: [image], denied: false });
  });

  it("on the web, leaves a paste with nothing usable to the editor", () => {
    const onImages = vi.fn();
    const { event } = pasteEvent({}, []);
    expect(handleImagePaste(event, onImages)).toBe(false);
    expect(onImages).not.toHaveBeenCalled();
  });

  it("on Android, reads the image natively and never through the WebView", async () => {
    platform.name = "android";
    nativeRead.mockResolvedValue({ images: [{ data: btoa("abc"), mimeType: "image/png" }], denied: false });
    const onImages = vi.fn();
    const { event, read } = pasteEvent({}, [png()]);

    expect(handleImagePaste(event, onImages)).toBe(true);
    expect(read.files).toBe(false);
    await vi.waitFor(() => expect(onImages).toHaveBeenCalled());
    const { files, denied } = onImages.mock.calls[0][0];
    expect(denied).toBe(false);
    expect(files).toHaveLength(1);
    expect(files[0].type).toBe("image/png");
  });

  it("on Android, takes the paste and reports it when the copying app refuses access", async () => {
    platform.name = "android";
    nativeRead.mockResolvedValue({ images: [], denied: true });
    const onImages = vi.fn();
    const { event } = pasteEvent({});

    expect(handleImagePaste(event, onImages)).toBe(true);
    await vi.waitFor(() => expect(onImages).toHaveBeenCalledWith({ files: [], denied: true }));
  });

  it("on Android, still takes the paste if the plugin fails", async () => {
    platform.name = "android";
    nativeRead.mockRejectedValue(new Error("not implemented"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const onImages = vi.fn();
    const { event } = pasteEvent({});

    expect(handleImagePaste(event, onImages)).toBe(true);
    await vi.waitFor(() => expect(onImages).toHaveBeenCalledWith({ files: [], denied: false }));
  });
});
