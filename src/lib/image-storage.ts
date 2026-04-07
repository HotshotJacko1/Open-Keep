import { Filesystem, Directory } from "@capacitor/filesystem";
import { Capacitor } from "@capacitor/core";
import imageCompression from "browser-image-compression";

const IMAGE_DIR = "images";

const COMPRESSION_OPTIONS = {
  maxSizeMB: 0.3,
  maxWidthOrHeight: 1600,
  useWebWorker: true,
};

/** Compress + save an image File; returns the relative storage path stored in note.images[] */
export const saveImage = async (file: File): Promise<string> => {
  const compressed = await imageCompression(file, COMPRESSION_OPTIONS);
  const id = `img_${crypto.randomUUID()}`;
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
    data: base64,
    directory: Directory.Data,
    recursive: true,
  });

  return fileName;
};

/** Get a displayable src URI for a stored image path */
export const getImageSrc = async (path: string): Promise<string> => {
  // Already a data URI (e.g. during sync restore preview)
  if (path.startsWith("data:")) return path;

  if (Capacitor.isNativePlatform()) {
    const { uri } = await Filesystem.getUri({ path, directory: Directory.Data });
    return Capacitor.convertFileSrc(uri);
  }

  // Web: read and return as base64 data URI
  const { data } = await Filesystem.readFile({ path, directory: Directory.Data });
  return `data:image/jpeg;base64,${data}`;
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
      const { data } = await Filesystem.readFile({ path, directory: Directory.Data });
      results.push({ id: path, data: `data:image/jpeg;base64,${data}` });
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
      const base64 = data.includes(",") ? data.split(",")[1] : data;
      await Filesystem.writeFile({
        path: id,
        data: base64,
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
