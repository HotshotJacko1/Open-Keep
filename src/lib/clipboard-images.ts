// Copyright (c) 2026. Licensed under AGPLv3.
//
// Pasting an image into a note body adds it as an attachment, as if it had been
// picked with "Add image". The body editor can't hold images itself.
//
// On Android the image is read natively (ClipboardImagePlugin.kt), never by the
// WebView. Without this, ProseMirror falls back to letting the WebView paste
// into a hidden element, the WebView reads the image itself, and if the app that
// copied it (ChatGPT, for one) hasn't shared it with us, the WebView throws an
// error it doesn't catch and the whole app crashes (Sentry OPENKEEP-17).
import { Capacitor, registerPlugin } from "@capacitor/core";

interface ClipboardImagePlugin {
  read(): Promise<{ images: Array<{ data: string; mimeType: string }>; denied: boolean }>;
}

const ClipboardImage = registerPlugin<ClipboardImagePlugin>("ClipboardImage");

export const PASTE_DENIED_MESSAGE =
  "Couldn't paste that image. Save it to your device, then use Add image.";

export interface PastedImages {
  files: File[];
  /** The app that copied an image didn't let us read it. */
  denied: boolean;
}

/** True when the paste carries text or HTML, which the editor pastes as usual. */
export const hasPastedText = (data: Pick<DataTransfer, "getData">): boolean =>
  !!(data.getData("text/plain") || data.getData("Text") || data.getData("text/html"));

export const imageFilesFrom = (files: ArrayLike<File> | null | undefined): File[] =>
  Array.from(files ?? []).filter((f) => f.type.startsWith("image/"));

export const base64ToFile = (base64: string, mimeType: string, name: string): File => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], name, { type: mimeType });
};

const readNative = async (): Promise<PastedImages> => {
  const { images, denied } = await ClipboardImage.read();
  return {
    files: images.map((img, i) => base64ToFile(img.data, img.mimeType, `pasted-${i + 1}`)),
    denied,
  };
};

/**
 * For an editor's `handlePaste`. Takes over a paste with no text in it and hands
 * any images to `onImages`; returns true when it took the paste. Pastes with
 * text are left to the editor, so they behave as before.
 */
export const handleImagePaste = (
  event: ClipboardEvent,
  onImages: (pasted: PastedImages) => void
): boolean => {
  const data = event.clipboardData;
  if (!data || hasPastedText(data)) return false;

  if (Capacitor.getPlatform() === "android") {
    // Always taken here, even if there turns out to be no image: anything that
    // reaches the WebView's own paste can crash the app (see top of file).
    readNative().then(onImages, (e) => {
      console.warn("Could not read pasted image:", e);
      onImages({ files: [], denied: false });
    });
    return true;
  }

  // Browsers clear clipboardData once the event ends, so read it now.
  const files = imageFilesFrom(data.files);
  if (files.length === 0) return false;
  onImages({ files, denied: false });
  return true;
};
