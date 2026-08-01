import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";

initializeApp();

const SIGHTENGINE_API_USER = defineSecret("SIGHTENGINE_API_USER");
const SIGHTENGINE_API_SECRET = defineSecret("SIGHTENGINE_API_SECRET");

// Expo push delivery endpoint (free, no API key required). Sends push
// messages to Expo Push Tokens that the mobile app registers in the
// user's regular_user profile document.
const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

const REGION = "asia-southeast1";
const SIGHTENGINE_API_URL = "https://api.sightengine.com/1.0/check.json";
const SIGHTENGINE_MODELS = "genai,deepfake,type,text";
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

const normalizeBase64 = (value) => {
  if (typeof value !== "string") {
    return "";
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  return trimmed.includes(",") ? (trimmed.split(",").pop() ?? "") : trimmed;
};

const normalizeMimeType = (value) => {
  if (typeof value !== "string") {
    return "image/jpeg";
  }

  const trimmed = value.trim().toLowerCase();
  return trimmed || "image/jpeg";
};

const normalizeFileName = (value, mimeType) => {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  if (mimeType.includes("png")) {
    return "attachment.png";
  }

  if (mimeType.includes("webp")) {
    return "attachment.webp";
  }

  if (mimeType.includes("heic")) {
    return "attachment.heic";
  }

  return "attachment.jpg";
};

const parseSightengineResponse = async (response) => {
  const responseText = await response.text();

  let payload;
  try {
    payload = JSON.parse(responseText);
  } catch {
    payload = null;
  }

  return { payload, responseText };
};

const getSightengineErrorMessage = (status, payload, responseText) => {
  const apiMessage = payload?.error?.message;
  if (typeof apiMessage === "string" && apiMessage.trim()) {
    return apiMessage.trim();
  }

  if (typeof responseText === "string" && responseText.trim()) {
    return responseText.trim();
  }

  return `Sightengine request failed (${status}).`;
};

export const reviewReportAttachment = onCall(
  {
    region: REGION,
    secrets: [SIGHTENGINE_API_USER, SIGHTENGINE_API_SECRET],
  },
  async (request) => {
    try {
      if (!request.auth) {
        throw new HttpsError("unauthenticated", "Please sign in again before reviewing attachments.");
      }

      const base64 = normalizeBase64(request.data?.base64);
      if (!base64) {
        throw new HttpsError("invalid-argument", "Attachment image data is missing.");
      }

      const mimeType = normalizeMimeType(request.data?.mimeType);
      const fileName = normalizeFileName(request.data?.fileName, mimeType);
      const apiUser = SIGHTENGINE_API_USER.value().trim();
      const apiSecret = SIGHTENGINE_API_SECRET.value().trim();

      if (!apiUser || !apiSecret) {
        throw new HttpsError(
          "failed-precondition",
          "Sightengine server secrets are not configured on Firebase Functions.",
        );
      }

      let bytes;
      try {
        bytes = Buffer.from(base64, "base64");
      } catch {
        throw new HttpsError("invalid-argument", "Attachment image data is not valid base64.");
      }

      if (!bytes.length) {
        throw new HttpsError("invalid-argument", "Attachment image data is empty.");
      }

      if (bytes.length > MAX_ATTACHMENT_BYTES) {
        throw new HttpsError(
          "invalid-argument",
          "Attachment is too large for authenticity review. Please choose a smaller image.",
        );
      }

      const formData = new FormData();
      formData.append("models", SIGHTENGINE_MODELS);
      formData.append("api_user", apiUser);
      formData.append("api_secret", apiSecret);
      formData.append("media", new Blob([bytes], { type: mimeType }), fileName);

      const response = await fetch(SIGHTENGINE_API_URL, {
        body: formData,
        method: "POST",
      });

      const { payload, responseText } = await parseSightengineResponse(response);

      if (!response.ok) {
        const message = getSightengineErrorMessage(response.status, payload, responseText);
        throw new HttpsError("internal", message, { message, status: response.status });
      }

      if (payload?.status !== "success") {
        const message =
          getSightengineErrorMessage(response.status, payload, responseText) || "Sightengine review failed.";
        throw new HttpsError("internal", message, { message, status: response.status });
      }

      return {
        requestId: typeof payload?.request?.id === "string" ? payload.request.id : null,
        text: payload?.text ?? null,
        type: payload?.type ?? null,
      };
    } catch (error) {
      logger.error("reviewReportAttachment failed", {
        authUid: request.auth?.uid ?? null,
        errorMessage: error instanceof Error ? error.message : String(error),
        errorName: error instanceof Error ? error.name : typeof error,
      });

      if (error instanceof HttpsError) {
        throw error;
      }

      const message =
        error instanceof Error && error.message.trim()
          ? error.message.trim()
          : "Unexpected server error during attachment authenticity review.";

      throw new HttpsError("internal", message, { message });
    }
  },
);

/**
 * Directly updates the Firebase Auth user's password after OTP verification.
 * Called from the forgot password flow after the user verifies their email via OTP.
 */
export const directPasswordReset = onRequest(
  {
    region: REGION,
    maxInstances: 10,
  },
  async (req, res) => {
    // Handle CORS preflight
    res.set("Access-Control-Allow-Origin", "*");

    if (req.method === "OPTIONS") {
      res.set("Access-Control-Allow-Methods", "POST");
      res.set("Access-Control-Allow-Headers", "Content-Type");
      res.status(204).send("");
      return;
    }

    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed." });
      return;
    }

    const { email, newPassword } = req.body || {};
    const formattedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
    const formattedPassword = typeof newPassword === "string" ? newPassword : "";

    if (!formattedEmail) {
      res.status(400).json({ error: "Email is required." });
      return;
    }

    if (formattedPassword.length < 6) {
      res.status(400).json({ error: "Password must be at least 6 characters." });
      return;
    }

    try {
      const userRecord = await getAuth().getUserByEmail(formattedEmail);
      await getAuth().updateUser(userRecord.uid, { password: formattedPassword });
      logger.info("directPasswordReset succeeded", { email: formattedEmail });
      res.json({ success: true });
    } catch (error) {
      logger.error("directPasswordReset failed", {
        email: formattedEmail,
        errorMessage: error instanceof Error ? error.message : String(error),
      });

      const message =
        error instanceof Error && error.message.trim()
          ? error.message.trim()
          : "Could not reset password. Please try again.";

      res.status(500).json({ error: message });
    }
  },
);

/**
 * Normalizes a report status value to the canonical form used by the app.
 * Mirrors the mobile client's normalizeStatus so the push message title
 * matches what is shown in the notification screen.
 */
const normalizeStatusForPush = (value) => {
  if (typeof value !== "string") {
    return "Pending";
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "approved") return "Approved";
  if (normalized === "resolving" || normalized === "resolved") return "Resolving";
  return "Pending";
};

const buildPushBody = (status, reportId, changedByAdmin) => {
  const id = typeof reportId === "string" && reportId.length > 0 ? reportId : "?";
  if (changedByAdmin) {
    if (status === "Approved") return `Admin approved your report #${id}.`;
    if (status === "Resolving") return `Admin marked your report #${id} as resolving.`;
    return `Admin set your report #${id} to pending.`;
  }
  if (status === "Approved") return `Your report #${id} has been approved.`;
  if (status === "Resolving") return `Your report #${id} is now resolving.`;
  return `Your report #${id} is still pending.`;
};

/**
 * Sends an Expo push notification to a report owner when the report's
 * status changes. The mobile app registers its Expo Push Token in the
 * user's `regular_user/{uid}` document (`expoPushToken` + `pushNotificationEnabled`),
 * so this trigger reads that token and POSTs a message to Expo's free
 * push service.
 */
export const sendReportStatusPush = onDocumentUpdated(
  {
    document: "regular_user/{userId}/reports/{reportId}",
    region: REGION,
    memory: "256MiB",
  },
  async (event) => {
    const before = event.data?.before?.data?.();
    const after = event.data?.after?.data?.();

    if (!before || !after) {
      return;
    }

    const beforeStatus = typeof before.status === "string" ? before.status.toLowerCase() : "";
    const afterStatus = typeof after.status === "string" ? after.status.toLowerCase() : "";
    if (!afterStatus || afterStatus === beforeStatus) {
      return;
    }

    const userId = event.params.userId;
    const reportId = typeof event.params.reportId === "string" ? event.params.reportId : "";

    try {
      const userDoc = await getFirestore()
        .collection("regular_user")
        .doc(userId)
        .get();

      if (!userDoc.exists) {
        return;
      }

      const userData = userDoc.data() || {};
      const token = typeof userData.expoPushToken === "string" ? userData.expoPushToken : "";
      const pushEnabled = userData.pushNotificationEnabled;

      if (!token) {
        return;
      }

      if (pushEnabled === false) {
        return;
      }

      const status = normalizeStatusForPush(after.status);
      const rawUpdatedBy = before.statusUpdatedBy;
      const changedByAdmin =
        typeof rawUpdatedBy === "string" ? rawUpdatedBy.toLowerCase() === "admin" : false;

      const body = buildPushBody(status, reportId, changedByAdmin);

      const response = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: token,
          title: "Report update",
          body,
          sound: "default",
          data: {
            reportId,
            route: "/regular_user/notifications",
          },
        }),
      });

      if (!response.ok) {
        logger.warn("sendReportStatusPush non-OK response", {
          userId,
          reportId,
          status: response.status,
        });
        return;
      }

      const payload = await response.json();
      if (payload?.data?.[0]?.status === "error") {
        logger.warn("Expo push rejected", {
          userId,
          reportId,
          message: payload.data[0].message,
        });
        return;
      }

      logger.info("sendReportStatusPush delivered", { userId, reportId, status });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Pushes are best-effort; failures must never break report updates.
      logger.warn("sendReportStatusPush failed", { userId, reportId, message });
    }
  },
);
