import * as FileSystem from "expo-file-system/legacy";
import { supabase } from "./supabase";

const BASE64_LOOKUP = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const cleanBase64 = base64.replace(/\s/g, "");
  const padding = cleanBase64.endsWith("==") ? 2 : cleanBase64.endsWith("=") ? 1 : 0;
  const bytes = new Uint8Array((cleanBase64.length * 3) / 4 - padding);
  let byteIndex = 0;

  for (let index = 0; index < cleanBase64.length; index += 4) {
    const first = BASE64_LOOKUP.indexOf(cleanBase64[index]);
    const second = BASE64_LOOKUP.indexOf(cleanBase64[index + 1]);
    const third = BASE64_LOOKUP.indexOf(cleanBase64[index + 2]);
    const fourth = BASE64_LOOKUP.indexOf(cleanBase64[index + 3]);
    const chunk = (first << 18) | (second << 12) | ((third & 63) << 6) | (fourth & 63);

    if (byteIndex < bytes.length) bytes[byteIndex++] = (chunk >> 16) & 255;
    if (byteIndex < bytes.length) bytes[byteIndex++] = (chunk >> 8) & 255;
    if (byteIndex < bytes.length) bytes[byteIndex++] = chunk & 255;
  }

  return bytes.buffer;
}

type UploadFileOptions = {
  bucket?: string;
  contentType?: string;
  upsert?: boolean;
  base64Data?: string;
};

const DEFAULT_BUCKET = process.env.EXPO_PUBLIC_SUPABASE_STORAGE_BUCKET || "reports";

// Normalizes a bucket name so it can never be empty/whitespace. Falls back to
// the given default so a missing/invalid env value never throws on dev/preview.
const normalizeBucket = (bucket: string | undefined, fallback: string): string => {
  const trimmed = (bucket || "").trim();
  return trimmed.length > 0 ? trimmed : fallback;
};
const LOCAL_URI_PATTERN = /^(file|content|ph|assets-library):/i;
const NETWORK_FAILURE_PATTERN = /network request failed|fetch failed/i;

const readLocalFileAsBase64 = async (fileUri: string): Promise<string> => {
  try {
    return await FileSystem.readAsStringAsync(fileUri, {
      encoding: FileSystem.EncodingType.Base64,
    });
  } catch {
    throw new Error(
      "Unable to read the selected file from device storage."
    );
  }
};

const readLocalFileData = async (fileUri: string): Promise<ArrayBuffer> => {
  const base64 = await readLocalFileAsBase64(fileUri);
  return base64ToArrayBuffer(base64);
};

const readFileData = async (fileUri: string) => {
  const trimmedUri = fileUri.trim();
  if (!trimmedUri) {
    throw new Error("Attachment URI is empty.");
  }

  if (LOCAL_URI_PATTERN.test(trimmedUri)) {
    return readLocalFileData(trimmedUri);
  }

  const response = await fetch(trimmedUri);
  if (!response.ok) {
    throw new Error(`File fetch failed (${response.status}).`);
  }

  return response.arrayBuffer();
};

const decodeBase64ToArrayBuffer = (base64Value: string): ArrayBuffer => {
  const normalized = base64Value.includes(",")
    ? (base64Value.split(",").pop() ?? "")
    : base64Value;

  if (!normalized) {
    throw new Error("Attachment data is empty.");
  }

  return base64ToArrayBuffer(normalized);
};

export async function uploadFile(
  fileUri: string,
  destinationPath: string,
  options: UploadFileOptions = {}
) {
const { bucket = DEFAULT_BUCKET, contentType, upsert = false, base64Data } = options;
  const resolvedBucket = normalizeBucket(bucket, DEFAULT_BUCKET);
  const fileData = base64Data ? decodeBase64ToArrayBuffer(base64Data) : await readFileData(fileUri);

  let attempts = 0;
  let lastError: unknown = null;
  while (attempts < 2) {
    attempts += 1;

    try {
      const { data, error } = await supabase.storage.from(resolvedBucket).upload(destinationPath, fileData, {
        contentType,
        upsert,
      });

      if (error) {
        throw error;
      }

      return data;
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      const isTransient = NETWORK_FAILURE_PATTERN.test(message.toLowerCase());

      if (!isTransient || attempts >= 2) {
        break;
      }
    }
  }

  if (
    lastError instanceof Error &&
    NETWORK_FAILURE_PATTERN.test(lastError.message.toLowerCase())
  ) {
    throw new Error(
      "Upload failed due to network/device file access. Please check internet, reselect the image, and try again."
    );
  }

  throw lastError instanceof Error ? lastError : new Error("Upload failed.");
}

export function getPublicFileUrl(path: string, bucket = DEFAULT_BUCKET) {
  const resolvedBucket = normalizeBucket(bucket, DEFAULT_BUCKET);
  const { data } = supabase.storage.from(resolvedBucket).getPublicUrl(path);
  return data.publicUrl;
}

export async function removeFile(path: string, bucket = DEFAULT_BUCKET) {
  const resolvedBucket = normalizeBucket(bucket, DEFAULT_BUCKET);
  const { error } = await supabase.storage.from(resolvedBucket).remove([path]);

  if (error) {
    throw error;
  }
}
