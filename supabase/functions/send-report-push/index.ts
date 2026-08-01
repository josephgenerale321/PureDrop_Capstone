// @ts-nocheck — Deno runtime globals (Deno, jsr: imports) are not available in VSCode
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json",
};

// Expo push delivery endpoint (free, no API key required).
const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
// Firestore uses the Datastore OAuth scope.
const FIREBASE_FIRESTORE_SCOPE = "https://www.googleapis.com/auth/datastore";
const OAUTH2_TOKEN_URL = "https://oauth2.googleapis.com/token";
const FIRESTORE_API_URL = "https://firestore.googleapis.com/v1";

type SendReportPushPayload = {
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
 * Same secret used by the direct-password-reset Edge Function.
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
 * e.g. { "expoPushToken": { "stringValue": "ExponentPushToken[...]" } }
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

const readBooleanField = (
  fields: Record<string, unknown> | undefined,
  key: string,
): boolean | undefined => {
  const entry = fields?.[key] as { booleanValue?: boolean } | undefined;
  return entry?.booleanValue;
};

/**
 * Normalizes a report status to the canonical form used by the app.
 * Mirrors the mobile client's normalizeStatus.
 */
const normalizeStatus = (value: unknown): string => {
  if (typeof value !== "string") {
    return "Pending";
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "approved") return "Approved";
  if (normalized === "resolving" || normalized === "resolved") return "Resolving";
  return "Pending";
};

const buildPushBody = (
  status: string,
  reportId: string,
  changedByAdmin: boolean,
): string => {
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

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }

  let body: SendReportPushPayload;
  try {
    body = await request.json() as SendReportPushPayload;
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
    return jsonResponse({
      error: "Firebase service account is not configured. Set FIREBASE_SERVICE_ACCOUNT_KEY in Supabase Edge Function secrets.",
    }, 500);
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
    const token = readStringField(fields, "expoPushToken");
    const pushEnabled = readBooleanField(fields, "pushNotificationEnabled");

    if (!token) {
      return jsonResponse({ ok: true, skipped: "no-token" });
    }

    if (pushEnabled === false) {
      return jsonResponse({ ok: true, skipped: "disabled" });
    }

    const status = normalizeStatus(body.status);
    const bodyText = buildPushBody(status, reportId, changedByAdmin);

    // Step 3: Send the push notification through Expo's free API.
    const expoResponse = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: token,
        title: "Report update",
        body: bodyText,
        sound: "default",
        data: {
          reportId,
          route: "/regular_user/notifications",
        },
      }),
    });

    if (!expoResponse.ok) {
      const details = await expoResponse.text();
      return jsonResponse(
        { error: `Expo push request failed (${expoResponse.status}): ${details}` },
        502,
      );
    }

    const expoPayload = await expoResponse.json() as {
      data?: Array<{ status?: string; message?: string }>;
    };

    if (expoPayload?.data?.[0]?.status === "error") {
      return jsonResponse(
        { error: expoPayload.data[0].message || "Expo push rejected the message." },
        422,
      );
    }

    return jsonResponse({ ok: true, status, reportId });
  } catch (error) {
    const message =
      error instanceof Error && error.message.trim()
        ? error.message.trim()
        : "Could not send the push notification.";

    return jsonResponse({ error: message }, 500);
  }
});

