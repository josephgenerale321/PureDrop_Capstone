import * as FileSystem from "expo-file-system/legacy";
import { Platform } from "react-native";
import { supabaseAnonKey, supabaseUrl } from "./supabase";
import type { Attachment } from "../components/create_report/useCreateReportForm";

type AttachmentAuthenticityResponse = {
  requestId: string | null;
  text: {
    has_artificial?: number;
    has_natural?: number;
  } | null;
  type: {
    ai_generated?: number;
    deepfake?: number;
    illustration?: number;
    photo?: number;
  } | null;
};

type EdgeFunctionErrorPayload = {
  error?: {
    message?: string;
    status?: number;
  };
};

type LegacyAttachmentAuthenticityRequest = {
  base64: string;
  fileName: string;
  mimeType: string;
};

const REVIEW_ATTACHMENT_FUNCTION = "review-report-attachment";
const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const MISSING_SUPABASE_CONFIG_MESSAGE =
  "Missing Supabase config. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY (or EXPO_PUBLIC_SUPABASE_KEY), then rebuild the app.";

const arrayBufferToBase64 = (arrayBuffer: ArrayBuffer) => {
  const bytes = new Uint8Array(arrayBuffer);
  let base64 = "";

  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index];
    const second = bytes[index + 1];
    const third = bytes[index + 2];

    base64 += BASE64_ALPHABET[first >> 2];
    base64 += BASE64_ALPHABET[((first & 3) << 4) | ((second ?? 0) >> 4)];
    base64 += index + 1 < bytes.length ? BASE64_ALPHABET[((second & 15) << 2) | ((third ?? 0) >> 6)] : "=";
    base64 += index + 2 < bytes.length ? BASE64_ALPHABET[third & 63] : "=";
  }

  return base64;
};

const getAttachmentExtension = (attachment: Attachment) => {
  const cleanFileName = attachment.fileName?.split("?")[0] ?? "";
  const cleanUri = attachment.uri.split("?")[0];
  const source = cleanFileName || cleanUri;
  const parts = source.split(".");

  if (parts.length > 1) {
    return parts[parts.length - 1].toLowerCase();
  }

  const mimeType = attachment.mimeType?.toLowerCase() ?? "";
  if (mimeType.includes("png")) return "png";
  if (mimeType.includes("webp")) return "webp";
  if (mimeType.includes("heic")) return "heic";

  return "jpg";
};

const getAttachmentMimeType = (attachment: Attachment) => {
  const mimeType = attachment.mimeType?.trim();
  if (mimeType) {
    return mimeType;
  }

  switch (getAttachmentExtension(attachment)) {
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "heic":
      return "image/heic";
    case "jpeg":
    case "jpg":
    default:
      return "image/jpeg";
  }
};

const getAttachmentFileName = (attachment: Attachment) =>
  attachment.fileName?.trim() || `report-attachment.${getAttachmentExtension(attachment)}`;

const buildInvokeBody = async (attachment: Attachment) => {
  const formData = new FormData();
  const fileName = getAttachmentFileName(attachment);
  const mimeType = getAttachmentMimeType(attachment);

  if (Platform.OS === "web") {
    const response = await fetch(attachment.uri);
    if (!response.ok) {
      throw new Error(`Unable to read the selected attachment (${response.status}).`);
    }

    const blob = await response.blob();
    formData.append("media", blob, fileName);
    return formData;
  }

  formData.append(
    "media",
    {
      name: fileName,
      type: mimeType,
      uri: attachment.uri,
    } as any,
  );

  return formData;
};

const buildLegacyInvokeBody = async (
  attachment: Attachment,
): Promise<LegacyAttachmentAuthenticityRequest> => {
  const fileName = getAttachmentFileName(attachment);
  const mimeType = getAttachmentMimeType(attachment);

  if (attachment.base64) {
    return {
      base64: attachment.base64,
      fileName,
      mimeType,
    };
  }

  if (Platform.OS === "web") {
    const response = await fetch(attachment.uri);
    if (!response.ok) {
      throw new Error(`Unable to read the selected attachment (${response.status}).`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return {
      base64: arrayBufferToBase64(arrayBuffer),
      fileName,
      mimeType,
    };
  }

  const base64 = await FileSystem.readAsStringAsync(attachment.uri, {
    encoding: FileSystem.EncodingType.Base64,
  });

  return {
    base64,
    fileName,
    mimeType,
  };
};

const readResponseMessage = async (response?: Response) => {
  if (!response) {
    return "";
  }

  try {
    const responseBody = (await response.clone().json()) as EdgeFunctionErrorPayload;
    const message = responseBody.error?.message?.trim();
    return message ?? "";
  } catch {
    try {
      const text = await response.clone().text();
      return text.trim();
    } catch {
      return "";
    }
  }
};

const getSupabaseFunctionErrorMessage = async (error: unknown, response?: Response) => {
  const responseMessage = await readResponseMessage(response);
  if (responseMessage) {
    if (responseMessage.toLowerCase() === "incorrect api user or api secret") {
      return "The Supabase Edge Function is using the wrong Sightengine credentials. Update SIGHTENGINE_API_USER and SIGHTENGINE_API_SECRET in Supabase secrets.";
    }

    return responseMessage;
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  return "Authenticity review failed.";
};

const shouldRetryWithLegacyJson = (message: string) => {
  const normalized = message.trim().toLowerCase();
  return normalized.includes("valid json");
};

const getReviewAttachmentFunctionUrl = () => {
  const trimmedSupabaseUrl = supabaseUrl?.trim().replace(/\/+$/, "");
  const trimmedAnonKey = supabaseAnonKey?.trim();

  if (!trimmedSupabaseUrl || !trimmedAnonKey) {
    throw new Error(MISSING_SUPABASE_CONFIG_MESSAGE);
  }

  return {
    anonKey: trimmedAnonKey,
    url: `${trimmedSupabaseUrl}/functions/v1/${REVIEW_ATTACHMENT_FUNCTION}`,
  };
};

const invokeReviewAttachment = async (
  body: FormData | LegacyAttachmentAuthenticityRequest,
) => {
  const { anonKey, url } = getReviewAttachmentFunctionUrl();
  const isMultipart = body instanceof FormData;

  let response: Response;
  try {
    response = await fetch(url, {
      body: isMultipart ? body : JSON.stringify(body),
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        ...(isMultipart ? {} : { "Content-Type": "application/json" }),
      },
      method: "POST",
    });
  } catch (error) {
    const message =
      error instanceof Error && error.message.trim()
        ? error.message.trim()
        : "Could not reach the Supabase Edge Function.";

    throw new Error(`Could not reach the Supabase Edge Function: ${message}`);
  }

  if (!response.ok) {
    throw new Error(await getSupabaseFunctionErrorMessage(null, response));
  }

  try {
    return (await response.json()) as AttachmentAuthenticityResponse;
  } catch {
    throw new Error("Supabase Edge Function returned invalid JSON.");
  }
};

export async function reviewAttachmentAuthenticity(
  attachment: Attachment,
): Promise<AttachmentAuthenticityResponse> {
  if (!attachment.uri.trim()) {
    throw new Error("Selected attachment is missing a file URI for authenticity review.");
  }

  const body = Platform.OS === "web" ? await buildInvokeBody(attachment) : await buildLegacyInvokeBody(attachment);
  try {
    return await invokeReviewAttachment(body);
  } catch (error) {
    const message =
      error instanceof Error && error.message.trim()
        ? error.message.trim()
        : "Authenticity review failed.";

    if (shouldRetryWithLegacyJson(message)) {
      const legacyBody = await buildLegacyInvokeBody(attachment);
      return await invokeReviewAttachment(legacyBody);
    }

    throw new Error(message);
  }
}
