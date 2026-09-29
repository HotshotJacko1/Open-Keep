// Copyright (c) 2026. Licensed under AGPLv3.
import { Filesystem, Directory } from "@capacitor/filesystem";
import { Capacitor } from "@capacitor/core";
import imageCompression from "browser-image-compression";
import { safeRandomUUID } from "@/lib/utils";
import { encryptData, decryptData } from "@/lib/note-storage";
import { isEncryptionEnabled } from "@/lib/pin";

const IMAGE_DIR = "images";

const COMPRESSION_OPTIONS = {
  maxSizeMB: 0.3,
  maxWidthOrHeight: 1600,
  useWebWorker: true,
};

// --- Encryption at rest (C1-16) ---
//
// With encryption on, an image file holds base64("OKENC1:" + encryptData(jpegBase64)),
// under the same master key as the notes. It is still written as base64 (no `encoding`):
// the web Filesystem ignores `encoding` on read, so a text file would read back
// differently on web and native. "OKENC1" is 6 bytes, so every encrypted file's base64
// starts with the same 8 characters; a plain JPEG's starts "/9j/".
//
// Files are brought in line with the encryption flag by syncImageEncryption(), which
// runs on unlock and after encryption is turned on or off. The master key survives a
// PIN change (it is only re-wrapped), but importing a cloud key replaces it, so that
// has to go through withImagesInPlaintext() or every local image becomes unreadable.
const ENCRYPTED_MAGIC = "OKENC1:";
const ENCRYPTED_MAGIC_B64 = btoa("OKENC1");
const TMP_SUFFIX = ".tmp";
// The state the last *complete* sweep left every file in: "encrypted" | "plain".
const IMAGE_ENCRYPTION_STATE_KEY = "open-keep-image-encryption-state";

const isEncryptedFile = (fileData: string) => fileData.startsWith(ENCRYPTED_MAGIC_B64);

/** Storage form of a JPEG's base64: encrypted when encryption is on. Throws if no key is loaded. */
const toStoredData = async (jpegBase64: string): Promise<string> => {
  if (!isEncryptionEnabled()) return jpegBase64;
  return btoa(ENCRYPTED_MAGIC + await encryptData(jpegBase64));
};

const fromStoredData = async (fileData: string): Promise<string> => {
  if (!isEncryptedFile(fileData)) return fileData;
  const ciphertext = atob(fileData).slice(ENCRYPTED_MAGIC.length);
  const plain = await decryptData(ciphertext);
  // Web decryptData returns its input rather than throwing when it has no key.
  if (plain === ciphertext) throw new Error("Image could not be decrypted");
  return plain;
};

const readStored = async (path: string): Promise<string> => {
  const { data } = await Filesystem.readFile({ path, directory: Directory.Data });
  return data as string; // only strings are ever written
};

/** Reads an image as a plain JPEG base64 string (no data-URI prefix), decrypting if needed. */
export const readImageBase64 = async (path: string): Promise<string> =>
  fromStoredData(await readStored(path));

/**
 * Replaces a file without a window where a crash leaves it truncated: write a temp
 * file, delete the original, rename. A crash in between leaves a `.tmp` that the
 * next sweep finishes or discards (see recoverTempFiles).
 */
const replaceFile = async (path: string, data: string): Promise<void> => {
  const tmp = path + TMP_SUFFIX;
  await Filesystem.writeFile({ path: tmp, data, directory: Directory.Data, recursive: true });
  await Filesystem.deleteFile({ path, directory: Directory.Data });
  await Filesystem.rename({ from: tmp, to: path, directory: Directory.Data, toDirectory: Directory.Data });
};

const recoverTempFiles = async (names: string[]): Promise<void> => {
  const present = new Set(names);
  for (const name of names) {
    if (!name.endsWith(TMP_SUFFIX)) continue;
    const tmp = `${IMAGE_DIR}/${name}`;
    const original = tmp.slice(0, -TMP_SUFFIX.length);
    try {
      if (present.has(name.slice(0, -TMP_SUFFIX.length))) {
        // Original still there: the temp write may be incomplete, keep the original.
        await Filesystem.deleteFile({ path: tmp, directory: Directory.Data });
      } else {
        // Original already deleted, so the temp write had finished.
        await Filesystem.rename({ from: tmp, to: original, directory: Directory.Data, toDirectory: Directory.Data });
      }
    } catch (e) {
      console.warn("Could not recover interrupted image write:", tmp, e);
    }
  }
};

const listImageFiles = async (): Promise<string[]> => {
  try {
    const { files } = await Filesystem.readdir({ path: IMAGE_DIR, directory: Directory.Data });
    await recoverTempFiles(files.map((f) => f.name));
    const { files: after } = await Filesystem.readdir({ path: IMAGE_DIR, directory: Directory.Data });
    return after.map((f) => f.name).filter((name) => !name.endsWith(TMP_SUFFIX));
  } catch {
    return []; // no images directory yet
  }
};

/** Rewrites every stored image encrypted or plain. Returns false if any file couldn't be converted. */
const convertAllImages = async (encrypt: boolean): Promise<boolean> => {
  let complete = true;
  for (const name of await listImageFiles()) {
    const path = `${IMAGE_DIR}/${name}`;
    try {
      const stored = await readStored(path);
      if (isEncryptedFile(stored) === encrypt) continue;
      if (encrypt) {
        const encrypted = await toStoredData(stored);
        if (!isEncryptedFile(encrypted)) { complete = false; continue; }
        await replaceFile(path, encrypted);
      } else {
        await replaceFile(path, await fromStoredData(stored));
      }
    } catch (e) {
      console.warn(`Could not ${encrypt ? "encrypt" : "decrypt"} stored image:`, path, e);
      complete = false;
    }
  }
  return complete;
};

// Sweeps run one at a time, so a toggle during a sweep can't interleave rewrites.
let sweepQueue: Promise<unknown> = Promise.resolve();
const serialized = <T>(fn: () => Promise<T>): Promise<T> => {
  const next = sweepQueue.then(fn, fn);
  sweepQueue = next.catch(() => undefined);
  return next;
};

/**
 * Brings every stored image in line with the encryption flag. Cheap when nothing
 * changed: it only walks the files when the flag differs from what the last
 * complete sweep recorded. Call once the database is unlocked.
 */
export const syncImageEncryption = (): Promise<void> => serialized(async () => {
  const target = isEncryptionEnabled() ? "encrypted" : "plain";
  if (localStorage.getItem(IMAGE_ENCRYPTION_STATE_KEY) === target) return;
  if (await convertAllImages(target === "encrypted")) {
    localStorage.setItem(IMAGE_ENCRYPTION_STATE_KEY, target);
  }
});

/**
 * Runs `fn` (which replaces the master key) with every image decrypted under the
 * old key first, then re-encrypts under whatever key is current afterwards,
 * whether `fn` succeeded or not.
 */
export const withImagesInPlaintext = async <T>(fn: () => Promise<T>): Promise<T> => {
  await serialized(async () => {
    localStorage.removeItem(IMAGE_ENCRYPTION_STATE_KEY);
    if (await convertAllImages(false)) localStorage.setItem(IMAGE_ENCRYPTION_STATE_KEY, "plain");
  });
  try {
    return await fn();
  } finally {
    await syncImageEncryption().catch((e) => console.error("Could not re-encrypt images after key change", e));
  }
};

/** Compress + save an image File; returns the relative storage path stored in note.images[] */
export const saveImage = async (file: File): Promise<string> => {
  const compressed = await imageCompression(file, COMPRESSION_OPTIONS);
  const id = `img_${safeRandomUUID()}`;
  const fileName = `${IMAGE_DIR}/${id}.jpg`;

  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Strip the data URL prefix
      resolve(result.split(",")[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(compressed);
  });

  await Filesystem.writeFile({
    path: fileName,
    data: await toStoredData(base64),
    directory: Directory.Data,
    recursive: true,
  });

  return fileName;
};

/** Get a displayable src URI for a stored image path */
export const getImageSrc = async (path: string): Promise<string> => {
  // Already a data URI (e.g. during sync restore preview)
  if (path.startsWith("data:")) return path;

  // Native can point the WebView straight at the file, but only when it is known
  // to be plain: encryption off, and the last complete sweep left every file plain.
  if (
    Capacitor.isNativePlatform() &&
    !isEncryptionEnabled() &&
    localStorage.getItem(IMAGE_ENCRYPTION_STATE_KEY) === "plain"
  ) {
    const { uri } = await Filesystem.getUri({ path, directory: Directory.Data });
    return Capacitor.convertFileSrc(uri);
  }

  return `data:image/jpeg;base64,${await readImageBase64(path)}`;
};

/** Delete an image file from the device filesystem */
export const deleteImage = async (path: string): Promise<void> => {
  try {
    await Filesystem.deleteFile({ path, directory: Directory.Data });
  } catch (e) {
    console.warn("Could not delete image file:", path, e);
  }
};

/**
 * Convert all image paths in a note to base64 objects for embedding in a sync payload.
 * Format: { id: "images/img_abc.jpg", data: "data:image/jpeg;base64,..." }
 */
export const resolveImagesToBase64 = async (
  images: string[]
): Promise<Array<{ id: string; data: string }>> => {
  const results: Array<{ id: string; data: string }> = [];
  for (const path of images) {
    try {
      results.push({ id: path, data: `data:image/jpeg;base64,${await readImageBase64(path)}` });
    } catch (e) {
      console.warn("Could not resolve image for sync, skipping:", path, e);
    }
  }
  return results;
};

/**
 * Restore base64 images from a sync payload back to the device filesystem.
 * Returns the array of local paths to store in note.images[].
 */
export const restoreImagesFromBase64 = async (
  syncImages: Array<{ id: string; data: string }>
): Promise<string[]> => {
  const paths: string[] = [];
  for (const { id, data } of syncImages) {
    try {
      if (!/^images\/img_[a-zA-Z0-9-]+\.jpg$/.test(id)) {
        console.warn("Invalid image id for sync restore, skipping:", id);
        continue;
      }
      const base64 = data.includes(",") ? data.split(",")[1] : data;
      await Filesystem.writeFile({
        path: id,
        data: await toStoredData(base64),
        directory: Directory.Data,
        recursive: true,
      });
      paths.push(id);
    } catch (e) {
      console.warn("Could not restore image from sync:", id, e);
    }
  }
  return paths;
};
