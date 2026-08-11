import * as FileSystem from "expo-file-system/legacy";

export const MAX_AVATAR_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

const ALLOWED_AVATAR_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "heic"];

export const getFileExtension = (
  uri: string,
  mimeType?: string | null
): string => {
  const cleanUri = uri.split("?")[0];
  const parts = cleanUri.split(".");
  if (parts.length > 1) {
    const extension = parts[parts.length - 1].toLowerCase();
    if (extension.length > 0 && extension.length <= 5) {
      // Normalize "jpeg" -> "jpg" so the stable storage path is ALWAYS
      // `profile-image.jpg` regardless of whether the source file was
      // `*.jpg` or `*.jpeg`. Without this, upsert would create TWO
      // different files (`profile-image.jpg` AND `profile-image.jpeg`).
      return extension === "jpeg" ? "jpg" : extension;
    }
  }

  const mime = (mimeType || "").toLowerCase();
  if (mime.includes("jpeg")) return "jpg";
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("heic")) return "heic";
  return "jpg";
};

export const getContentType = (extension: string): string => {
  switch (extension) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "heic":
      return "image/heic";
    default:
      return "application/octet-stream";
  }
};

export const getLocalFileSize = async (
  uri: string
): Promise<number | null> => {
  try {
    const info = await FileSystem.getInfoAsync(uri);
    if (info.exists && typeof info.size === "number") {
      return info.size;
    }
  } catch {
    // Size lookup is best-effort and must never crash the flow.
  }
  return null;
};

export const validateProfileImage = async (
  uri: string,
  mimeType?: string | null,
  providedFileSize?: number | null
): Promise<string | null> => {
  const extension = getFileExtension(uri, mimeType);
  if (!ALLOWED_AVATAR_EXTENSIONS.includes(extension)) {
    return "Please select a JPG, PNG, WEBP, or HEIC image.";
  }

  let fileSize = typeof providedFileSize === "number" ? providedFileSize : null;
  if (fileSize === null) {
    fileSize = await getLocalFileSize(uri);
  }

  if (fileSize !== null && fileSize > MAX_AVATAR_FILE_SIZE) {
    return "The selected image is too large. Please choose an image under 10 MB.";
  }

  return null;
};

