// @ts-nocheck — Deno runtime globals (Deno, jsr: imports) are not available in VSCode
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json",
};

const BREVO_SEND_EMAIL_URL = "https://api.brevo.com/v3/smtp/email";
// Firestore uses the Datastore OAuth scope.
const FIREBASE_FIRESTORE_SCOPE = "https://www.googleapis.com/auth/datastore";
const OAUTH2_TOKEN_URL = "https://oauth2.googleapis.com/token";
const FIRESTORE_API_URL = "https://firestore.googleapis.com/v1";

type SendReportStatusEmailPayload = {
  userId?: string;
  reportId?: string;
  status?: string;
  changedByAdmin?: boolean;
};

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    headers: corsHeaders,
    status,
  });

/**
 * Parse a Firebase service account JSON string from env.
 * Same secret used by the send-report-push Edge Function.
 */
const getServiceAccount = (): Record<string, string> | null => {
  const raw = Deno.env.get("FIREBASE_SERVICE_ACCOUNT_KEY")?.trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return null;
  }
};

/**
 * Decode a PEM-encoded private key to DER bytes.
 */
const pemToDerBytes = (pem: string): Uint8Array => {
  const lines = pem.split("\n");
  const base64Lines: string[] = [];
  let inKey = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("-----BEGIN ")) {
      inKey = true;
      continue;
    }
    if (trimmed.startsWith("-----END ")) {
      inKey = false;
      continue;
    }
    if (inKey && trimmed) {
      base64Lines.push(trimmed);
    }
  }
  const base64 = base64Lines.join("");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

/**
 * Create a JWT assertion signed with the service account's private key
 * to exchange for a Google OAuth2 access token.
 */
const createJwtAssertion = async (
  serviceAccount: Record<string, string>,
): Promise<string> => {
  const { client_email, private_key } = serviceAccount;
  if (!client_email || !private_key) {
    throw new Error("Service account is missing client_email or private_key.");
  }

  const now = Math.floor(Date.now() / 1000);

  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: client_email,
    scope: FIREBASE_FIRESTORE_SCOPE,
    aud: OAUTH2_TOKEN_URL,
    iat: now,
    exp: now + 3600,
  };

  const headerB64 = btoa(JSON.stringify(header));
  const payloadB64 = btoa(JSON.stringify(payload));
  const signingInput = `${headerB64}.${payloadB64}`;

  const derBytes = pemToDerBytes(private_key);

  const pemKey = await crypto.subtle.importKey(
    "pkcs8",
    derBytes.buffer as ArrayBuffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" },
    pemKey,
    new TextEncoder().encode(signingInput),
  );

  const signatureB64 = btoa(
    String.fromCharCode(...new Uint8Array(signature)),
  );

  return `${signingInput}.${signatureB64}`;
};

/**
 * Exchange a signed JWT assertion for a Google OAuth2 access token.
 */
const getAccessToken = async (
  serviceAccount: Record<string, string>,
): Promise<string> => {
  const jwtAssertion = await createJwtAssertion(serviceAccount);

  const response = await fetch(OAUTH2_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      assertion: jwtAssertion,
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to get OAuth2 token: ${response.status} ${body}`);
  }

  const data = await response.json() as { access_token?: string };
  if (!data.access_token) {
    throw new Error("OAuth2 response missing access_token.");
  }

  return data.access_token;
};

/**
 * Read a Firestore document via the REST API using an access token.
 * The document path is URL-encoded per segment.
 */
const getFirestoreDocument = async (
  accessToken: string,
  projectId: string,
  documentPath: string,
): Promise<{ ok: boolean; payload?: Record<string, unknown>; status?: number }> => {
  const encodedPath = documentPath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

  const url = `${FIRESTORE_API_URL}/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/${encodedPath}`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    return { ok: false, status: response.status };
  }

  const payload = await response.json() as Record<string, unknown>;
  return { ok: true, payload };
};

/**
 * Convert a Firestore REST field map to plain values.
 * e.g. { "email": { "stringValue": "user@example.com" } }
 */
const readStringField = (
  fields: Record<string, unknown> | undefined,
  key: string,
): string => {
  const entry = fields?.[key] as { stringValue?: string } | undefined;
  return typeof entry?.stringValue === "string" && entry.stringValue.trim()
    ? entry.stringValue.trim()
    : "";
};

const readStringArrayField = (
  fields: Record<string, unknown> | undefined,
  key: string,
): string[] => {
  const entry = fields?.[key] as { arrayValue?: { values?: Array<{ stringValue?: string }> } } | undefined;
  const values = entry?.arrayValue?.values;
  if (!Array.isArray(values)) {
    return [];
  }
  return values
    .map((item) => (typeof item?.stringValue === "string" ? item.stringValue.trim() : ""))
    .filter(Boolean);
};

/**
 * Normalizes a report status to the canonical form used by the app.
 * Mirrors the mobile client's and send-report-push's normalizeStatus.
 */
const normalizeStatus = (value: unknown): string => {
  if (typeof value !== "string") {
    return "Pending";
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "approved") return "Approved";
  if (normalized === "resolving" || normalized === "resolved") return "Resolving";
  if (normalized === "rejected") return "Rejected";
  return "Pending";
};

const buildEmailSubject = (status: string, reportId: string): string => {
  const id = typeof reportId === "string" && reportId.length > 0 ? reportId : "?";
  if (status === "Approved") return `Your PureDrop report #${id} was approved`;
  if (status === "Resolving") return `Your PureDrop report #${id} is now resolving`;
  if (status === "Rejected") return `Your PureDrop report #${id} was rejected`;
  return `Your PureDrop report #${id} status update`;
};

const buildEmailBodyHtml = (status: string, reportId: string): string => {
  const id = typeof reportId === "string" && reportId.length > 0 ? reportId : "?";
  let headline = "An admin set your report to pending.";
  if (status === "Approved") headline = "An admin approved your report.";
  else if (status === "Resolving") headline = "An admin marked your report as resolving.";
  else if (status === "Rejected") headline = "An admin rejected your report.";

  return `
  <div style="font-family: Arial, sans-serif; color: #102a43;">
    <h2 style="margin-bottom: 12px;">Report status update</h2>
    <p>${headline}</p>
    <p style="font-size: 20px; font-weight: 700; margin: 16px 0;">Report #${id} — Status: ${status}</p>
    <p>You can open the PureDrop app and go to your reports to see the latest details.</p>
    <p>If you were not expecting this update, you can ignore this email.</p>
  </div>
`;
};

const buildEmailBodyText = (status: string, reportId: string): string => {
  const id = typeof reportId === "string" && reportId.length > 0 ? reportId : "?";
  return `PureDrop update: an admin set your report #${id} to ${status}. Open the PureDrop app to see the latest details.`;
};

/**
 * Send the status-update email through Brevo's transactional email API.
 * Same secrets/pattern as the email-verification-otp Edge Function.
 */
const sendBrevoEmail = async (
  toEmail: string,
  toName: string,
  status: string,
  reportId: string,
) => {
  const apiKey = Deno.env.get("BREVO_API_KEY")?.trim() ?? "";
  const senderEmail = Deno.env.get("BREVO_SENDER_EMAIL")?.trim() ?? "";
  const senderName = Deno.env.get("BREVO_SENDER_NAME")?.trim() || "PureDrop App";

  if (!apiKey || !senderEmail) {
    return {
      errorResponse: jsonResponse(
        { error: "Brevo secrets are not configured in Supabase Edge Functions." },
        500,
      ),
    };
  }

  const recipient: { email: string; name?: string } = { email: toEmail };
  if (toName) {
    recipient.name = toName;
  }

  const brevoResponse = await fetch(BREVO_SEND_EMAIL_URL, {
    body: JSON.stringify({
      sender: {
        email: senderEmail,
        name: senderName,
      },
      to: [recipient],
      subject: buildEmailSubject(status, reportId),
      htmlContent: buildEmailBodyHtml(status, reportId),
      textContent: buildEmailBodyText(status, reportId),
    }),
    headers: {
      accept: "application/json",
      "api-key": apiKey,
      "content-type": "application/json",
    },
    method: "POST",
  });

  if (brevoResponse.ok) {
    return {};
  }

  let message = `Brevo email request failed (${brevoResponse.status}).`;
  try {
    const payload = await brevoResponse.json() as { message?: unknown };
    if (typeof payload.message === "string" && payload.message.trim()) {
      message = payload.message.trim();
    }
  } catch {
    try {
      const text = await brevoResponse.text();
      if (text.trim()) {
        message = text.trim();
      }
    } catch {
      // Keep default message.
    }
  }

  return {
    errorResponse: jsonResponse({ error: message }, 502),
  };
};

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }

  let body: SendReportStatusEmailPayload;
  try {
    body = await request.json() as SendReportStatusEmailPayload;
  } catch {
    return jsonResponse({ error: "Request body must be valid JSON." }, 400);
  }

  const userId = typeof body.userId === "string" ? body.userId.trim() : "";
  const reportId = typeof body.reportId === "string" ? body.reportId.trim() : "";
  const changedByAdmin = body.changedByAdmin !== false;

  if (!userId) {
    return jsonResponse({ error: "userId is required." }, 400);
  }

  const serviceAccount = getServiceAccount();
  if (!serviceAccount) {
    return jsonResponse(
      { error: "Firebase service account is not configured. Set FIREBASE_SERVICE_ACCOUNT_KEY in Supabase Edge Function secrets." },
      500,
    );
  }

  try {
    // Step 1: Get OAuth2 access token with Firestore (datastore) scope.
    const accessToken = await getAccessToken(serviceAccount);

    // Step 2: Read the user's profile document from Firestore.
    const projectId = serviceAccount.project_id;
    if (!projectId) {
      return jsonResponse({ error: "Service account is missing project_id." }, 500);
    }

    const userDoc = await getFirestoreDocument(
      accessToken,
      projectId,
      `regular_user/${userId}`,
    );

    if (!userDoc.ok) {
      if (userDoc.status === 404) {
        return jsonResponse({ error: "User profile was not found." }, 404);
      }
      return jsonResponse({ error: "Could not read the user profile from Firestore." }, 502);
    }

    const fields = userDoc.payload?.fields as Record<string, unknown> | undefined;
    const email =
      readStringField(fields, "email") ||
      readStringArrayField(fields, "emails")[0] ||
      readStringField(fields, "emailAddress") ||
      readStringField(fields, "userEmail");
    const fullName = readStringField(fields, "fullName") || readStringField(fields, "name");

    if (!email || !email.includes("@")) {
      return jsonResponse({ ok: true, skipped: "no-email" });
    }

    // Step 3: Send the status-update email through Brevo.
    const status = normalizeStatus(body.status);
    const sendResult = await sendBrevoEmail(email, fullName, status, reportId);
    if ("errorResponse" in sendResult) {
      return sendResult.errorResponse;
    }

    return jsonResponse({ ok: true, status, reportId, email, changedByAdmin });
  } catch (error) {
    const message =
      error instanceof Error && error.message.trim()
        ? error.message.trim()
        : "Could not send the report status email.";

    return jsonResponse({ error: message }, 500);
  }
});
