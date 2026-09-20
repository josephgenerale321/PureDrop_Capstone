import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";

initializeApp();

const REGION = "asia-southeast1";

const ADMIN_PROFILE_COLLECTION = "admin_user";

/**
 * Determines whether the authenticated caller is an admin.
 * Mirrors the Firestore rules isAdmin() helper:
 * - has an admin=true or role='admin' custom claim, OR
 * - has an admin_user/{uid} document with role='admin' or isAdmin=true.
 */
const isAdminCaller = async (authUid) => {
  if (!authUid) {
    return false;
  }

  try {
    const userRecord = await getAuth().getUser(authUid);
    const claims = userRecord?.customClaims || {};

    if (claims.admin === true || claims.role === "admin") {
      return true;
    }
  } catch (error) {
    logger.warn("deleteRegularUserAccount customClaim check failed", {
      authUid,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    const adminDoc = await getFirestore()
      .collection(ADMIN_PROFILE_COLLECTION)
      .doc(authUid)
      .get();

    if (!adminDoc.exists) {
      return false;
    }

    const adminData = adminDoc.data() || {};
    return adminData.role === "admin" || adminData.isAdmin === true;
  } catch (error) {
    logger.warn("deleteRegularUserAccount admin profile check failed", {
      authUid,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
};

/**
 * Deletes a regular user's Firebase Authentication account.
 * Called by the admin dashboard after Firestore user documents have been
 * removed. Requires the caller to be an admin (custom claim or admin_user
 * profile). Uses the Firebase Admin SDK, so it must run as a Cloud Function
 * and the project must be on the Blaze (pay-as-you-go) plan.
 */
export const deleteRegularUserAccount = onCall(
  {
    region: REGION,
    maxInstances: 10,
  },
  async (request) => {
    try {
      if (!request.auth) {
        throw new HttpsError("unauthenticated", "Please sign in again before deleting a user.");
      }

      const callerUid = request.auth.uid;
      const isAdmin = await isAdminCaller(callerUid);
      if (!isAdmin) {
        throw new HttpsError("permission-denied", "Only admins can delete user accounts.");
      }

      const targetUid =
        typeof request.data?.uid === "string" ? request.data.uid.trim() : "";

      if (!targetUid) {
        throw new HttpsError("invalid-argument", "A target user uid is required.");
      }

      if (targetUid === callerUid) {
        throw new HttpsError("failed-precondition", "Admins cannot delete their own account.");
      }

      await getAuth().deleteUser(targetUid);

      logger.info("deleteRegularUserAccount succeeded", {
        callerUid,
        targetUid,
      });

      return { success: true };
    } catch (error) {
      logger.error("deleteRegularUserAccount failed", {
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
          : "Unexpected server error during user deletion.";

      throw new HttpsError("internal", message, { message });
    }
  },
);

const SIGHTENGINE_API_USER = defineSecret("SIGHTENGINE_API_USER");
const SIGHTENGINE_API_SECRET = defineSecret("SIGHTENGINE_API_SECRET");

// Expo push delivery endpoint (free, no API key required). Sends push
// messages to Expo Push Tokens that the mobile app registers in the
// user's regular_user profile document.
const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

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

const normalizeVerificationStatusForPush = (value) => {
  if (typeof value !== "string") {
    return "";
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "verified") return "verified";
  if (normalized === "rejected") return "rejected";
  if (normalized === "pending") return "pending";
  return normalized || "";
};

const buildVerificationPushBody = (status, rejectionTarget, wasReapproved = false) => {
  if (status === "verified") {
    // Re-approved existing user (explicit `wasReapproved` flag written by the
    // admin panel at approve time) gets the "verified again" wording;
    // first-time approvals keep the original Welcome text. Mirrors the mobile
    // client (notif_func.tsx / verificationPushSync.tsx) and the Supabase
    // send-report-push edge function word-for-word.
    if (wasReapproved) {
      return "Your account has been verified again. Welcome back to PureDrop!";
    }
    return "Your account has been verified. Welcome to PureDrop!";
  }

  if (status === "rejected") {
    if (rejectionTarget === "valid_id") {
      return "Your Valid ID was rejected. Please resubmit it to continue.";
    }
    if (rejectionTarget === "face_scan") {
      return "Your face scan was rejected. Please resubmit it to continue.";
    }
    return "Your verification was rejected. Please re-verify your ID to continue.";
  }

  return "Your verification status has been updated. Please open the app to review it.";
};

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
    const status = normalizeStatusForPush(after.status);

    try {
      const userDoc = await getFirestore()
        .collection("regular_user")
        .doc(userId)
        .get();

      if (!userDoc.exists) {
        logger.warn("sendReportStatusPush skipped: user profile not found", {
          userId,
          reportId,
        });
        return;
      }

      const userData = userDoc.data() || {};
      const token = typeof userData.expoPushToken === "string" ? userData.expoPushToken : "";
      const pushEnabled = userData.pushNotificationEnabled;

      if (!token) {
        logger.warn("sendReportStatusPush skipped: no push token", {
          userId,
          reportId,
          status,
        });
        return;
      }

      if (pushEnabled === false) {
        logger.warn("sendReportStatusPush skipped: push disabled", {
          userId,
          reportId,
          status,
        });
        return;
      }

      const changedByAdmin = after.statusUpdatedBy === "admin";
      if (!changedByAdmin) {
        logger.warn("sendReportStatusPush skipped: not an admin update", {
          userId,
          reportId,
          status,
          statusUpdatedBy: after.statusUpdatedBy ?? null,
        });
        return;
      }
      // NOTE: previously this gate read `before.statusUpdatedBy` (the OLD
      // snapshot) while the comment claimed to check the admin flag — since
      // the flag only appears on the new snapshot, that read was never the
      // admin value and every admin status change exited here silently.
      const body = buildPushBody(status, reportId, changedByAdmin);

      const response = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: token,
          title: "Report update",
          body,
          sound: "default",
          // Android channel + high priority so the notification is shown
          // prominently in the system shade even when the app is backgrounded
          // or fully closed. Matches the channel id created by the app
          // (push_notificationfunc.tsx / system_notif.tsx).
          channelId: "report-updates",
          priority: "high",
          categoryId: "report-update",
          data: {
            reportId,
            userId,
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

/**
 * Sends an Expo push notification to a user when the admin decides on their
 * identity verification (`regular_user/{uid}.verificationStatus` changes to
 * "verified" or "rejected"). This is the ONLY outside-app signal for the
 * verification flow — the in-app realtime watcher
 * (components/verification/backend/useVerificationDecisionWatcher.ts) only
 * fires while the app is open on a verification screen.
 *
 * Mirrors sendReportStatusPush: reads the same `expoPushToken` /
 * `pushNotificationEnabled` fields on the same user doc and POSTs to the
 * same Expo push service on the same `report-updates` Android channel so no
 * app rebuild is required.
 */
export const sendVerificationStatusPush = onDocumentUpdated(
  {
    document: "regular_user/{userId}",
    region: REGION,
    memory: "256MiB",
  },
  async (event) => {
    const before = event.data?.before?.data?.();
    const after = event.data?.after?.data?.();

    if (!before || !after) {
      return;
    }

    const beforeStatus = normalizeVerificationStatusForPush(before.verificationStatus);
    const afterStatus = normalizeVerificationStatusForPush(after.verificationStatus);
    if (!afterStatus || afterStatus === beforeStatus) {
      return;
    }

    // Only the terminal admin decisions produce an outside notification.
    // Intermediate states (pending / awaiting_id / incomplete) are covered
    // by the in-app hub UI and watcher.
    if (afterStatus !== "verified" && afterStatus !== "rejected") {
      return;
    }

    const userId = event.params.userId;

    try {
      const userData = after || {};
      const token = typeof userData.expoPushToken === "string" ? userData.expoPushToken : "";
      const pushEnabled = userData.pushNotificationEnabled;

      if (!token) {
        return;
      }

      if (pushEnabled === false) {
        return;
      }

      const rawTarget = after.rejectionTarget;
      const rejectionTarget =
        rawTarget === "valid_id" || rawTarget === "face_scan" || rawTarget === "both"
          ? rawTarget
          : "both";

      const body = buildVerificationPushBody(
        afterStatus,
        rejectionTarget,
        after.wasReapproved === true,
      );
      const isVerified = afterStatus === "verified";

      const response = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: token,
          title: isVerified ? "Account verified" : "Verification update",
          body,
          sound: "default",
          // Reuse the existing channel so devices on the current build show
          // the banner / lock-screen notification without an app update.
          channelId: "report-updates",
          priority: "high",
          data: {
            kind: "verification",
            verificationStatus: afterStatus,
            rejectionTarget,
            wasReapproved: after.wasReapproved === true,
            userId,
            route: isVerified ? "/login/validation/fullyverif" : "/login/validation/rejectedverif",
          },
        }),
      });

      if (!response.ok) {
        logger.warn("sendVerificationStatusPush non-OK response", {
          userId,
          status: response.status,
          verificationStatus: afterStatus,
        });
        return;
      }

      const payload = await response.json();
      if (payload?.data?.[0]?.status === "error") {
        logger.warn("Expo verification push rejected", {
          userId,
          message: payload.data[0].message,
        });
        return;
      }

      logger.info("sendVerificationStatusPush delivered", { userId, verificationStatus: afterStatus });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Pushes are best-effort; failures must never break verification updates.
      logger.warn("sendVerificationStatusPush failed", { userId, message });
    }
  },
);

