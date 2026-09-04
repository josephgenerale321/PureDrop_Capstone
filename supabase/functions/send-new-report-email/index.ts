// @ts-nocheck — Deno runtime globals (Deno, jsr: imports) are not available in VSCode
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

/**
 * send-new-report-email
 *
 * Called by the mobile app right after a resident submits a new report with
 * `status: "Pending"`. Reads the report back from Firestore, verifies it is
 * still pending, then emails every resident profile in the `regular_user`
 * collection through Brevo transactional email.
 *
 * Mirrors send-report-status-email: same secrets (FIREBASE_SERVICE_ACCOUNT_KEY,
 * BREVO_API_KEY, BREVO_SENDER_EMAIL, BREVO_SENDER_NAME), same Firestore REST
 * approach. Deploy with:
 *   supabase functions deploy send-new-report-email
 */

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

// Resident listing / sending batching.
const RESIDENTS_PAGE_SIZE = 200;
const MAX_RESIDENT_PAGES = 25; // hard cap: 5,000 resident profiles per run
const BREVO_CHUNK_SIZE = 8; // parallel Brevo calls per wave (stay under rate limits)

type SendNewReportEmailPayload = {
  userId?: string;
  reportId?: string;
  notifyReporter?: boolean;
};

type ResidentRecipient = {
  userId: string;
  email: string;
  name: string;
};

type ReportSummary = {
  id: string;
  status: string;
  category: string;
  issue: string;
  location: string;
  reporterName: string;
};

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    headers: corsHeaders,
    status,
  });

const getServiceAccount = (): Record<string, string> | null => {
  const raw = Deno.env.get("FIREBASE_SERVICE_ACCOUNT_KEY")?.trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return null;
  }
};

/** Read a Firestore document via the REST API using an access token. */
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

/** Report content is user input — always escape before embedding in HTML. */
const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

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
 * List every document in the top-level `regular_user` collection, following
 * __name__-ordered pagination until exhausted (documents default to __name__
 * order, so startAt with the last document's referenceValue resumes cleanly).
 */
const listAllResidents = async (
  accessToken: string,
  projectId: string,
): Promise<Array<Record<string, unknown>>> => {
  const documents: Array<Record<string, unknown>> = [];
  let startAfterName: string | null = null;

  for (let page = 0; page < MAX_RESIDENT_PAGES; page += 1) {
    const structuredQuery: Record<string, unknown> = {
      from: [{ collectionId: "regular_user", allDescendants: false }],
      limit: { value: RESIDENTS_PAGE_SIZE },
    };
    if (startAfterName) {
      structuredQuery.startAt = {
        values: [{ referenceValue: startAfterName }],
        before: false,
      };
    }

    const response = await fetch(
      `${FIRESTORE_API_URL}/projects/${encodeURIComponent(projectId)}/databases/(default)/documents:runQuery`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ structuredQuery }),
      },
    );

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Firestore resident query failed: ${response.status} ${body}`);
    }

    const entries = await response.json() as Array<Record<string, unknown>>;
    const pageDocs = entries
      .map((entry) => entry.document as Record<string, unknown> | undefined)
      .filter(Boolean) as Array<Record<string, unknown>>;

    if (pageDocs.length === 0) {
      break;
    }

    documents.push(...pageDocs);

    const lastName = pageDocs[pageDocs.length - 1]?.name;
    if (typeof lastName !== "string") {
      break;
    }
    startAfterName = lastName;

    if (pageDocs.length < RESIDENTS_PAGE_SIZE) {
      break;
    }
  }

  return documents;
};


const buildEmailSubject = (report: ReportSummary): string =>
  `New PureDrop report #${report.id} is pending review`;

const buildEmailBodyHtml = (
  recipientName: string,
  report: ReportSummary,
): string => {
  const greeting = recipientName ? `Hi ${escapeHtml(recipientName)},` : "Hi there,";
  const category = escapeHtml(report.category || "Uncategorized");
  const issue = escapeHtml(report.issue || "(no details provided)");
  const location = escapeHtml(report.location || "(no location provided)");
  const reporter = escapeHtml(report.reporterName || "A resident");

  return `
  <div style="font-family: Arial, sans-serif; color: #102a43;">
    <h2 style="margin-bottom: 12px;">New water report in your area</h2>
    <p>${greeting}</p>
    <p>${reporter} just filed a new report and it is now <strong>pending</strong> review by the PureDrop team.</p>
    <table style="border-collapse: collapse; margin: 16px 0;" cellpadding="8">
      <tr><td style="font-weight: 700; background: #f0f4f8;">Report #</td><td>${escapeHtml(report.id)}</td></tr>
      <tr><td style="font-weight: 700; background: #f0f4f8;">Category</td><td>${category}</td></tr>
      <tr><td style="font-weight: 700; background: #f0f4f8;">Issue</td><td>${issue}</td></tr>
      <tr><td style="font-weight: 700; background: #f0f4f8;">Location</td><td>${location}</td></tr>
      <tr><td style="font-weight: 700; background: #f0f4f8;">Status</td><td>Pending</td></tr>
    </table>
    <p>You can open the PureDrop app to follow this report and see other reports near you.</p>
    <p style="color: #829ab1; font-size: 12px;">You received this email because you are a registered PureDrop resident. If this was not expected, you can ignore this email.</p>
  </div>
`;
};

const buildEmailBodyText = (report: ReportSummary): string =>
  `PureDrop: a new report #${report.id} (${report.category || "Uncategorized"}) was filed by ${report.reporterName || "a resident"} and is now pending review. Issue: ${report.issue || "(no details)"}. Location: ${report.location || "(no location)"}. Open the PureDrop app to follow it.`;

/**
 * Send one personalized resident email through Brevo. Returns true on
 * success; per-recipient failures are logged and counted, never thrown, so
 * one bad address cannot stop the rest of the fan-out.
 */
const sendResidentEmail = async (
  recipient: ResidentRecipient,
  report: ReportSummary,
): Promise<boolean> => {
  try {
    const apiKey = Deno.env.get("BREVO_API_KEY")?.trim() ?? "";
    const senderEmail = Deno.env.get("BREVO_SENDER_EMAIL")?.trim() ?? "";
    const senderName = Deno.env.get("BREVO_SENDER_NAME")?.trim() || "PureDrop App";

    if (!apiKey || !senderEmail) {
      throw new Error("Brevo secrets are not configured in Supabase Edge Functions.");
    }

    const recipientPayload: { email: string; name?: string } = {
      email: recipient.email,
    };
    if (recipient.name) {
      recipientPayload.name = recipient.name;
    }

    const brevoResponse = await fetch(BREVO_SEND_EMAIL_URL, {
      body: JSON.stringify({
        sender: {
          email: senderEmail,
          name: senderName,
        },
        to: [recipientPayload],
        subject: buildEmailSubject(report),
        htmlContent: buildEmailBodyHtml(recipient.name, report),
        textContent: buildEmailBodyText(report),
      }),
      headers: {
        accept: "application/json",
        "api-key": apiKey,
        "content-type": "application/json",
      },
      method: "POST",
    });

    if (brevoResponse.ok) {
      return true;
    }

    let message = `Brevo email request failed (${brevoResponse.status}).`;
    try {
      const payload = await brevoResponse.json() as { message?: unknown };
      if (typeof payload.message === "string" && payload.message.trim()) {
        message = payload.message.trim();
      }
    } catch {
      // Keep default message.
    }
    console.warn(
      `[send-new-report-email] Brevo send failed for ${recipient.email}: ${message}`,
    );
    return false;
  } catch (error) {
    console.warn(
      `[send-new-report-email] Brevo send failed for ${recipient.email}:`,
      error instanceof Error ? error.message : String(error),
    );
    return false;
  }
};


/** Collect email-bearing resident profiles from the Firestore documents. */
const collectRecipients = (
  documents: Array<Record<string, unknown>>,
  reporterUserId: string,
  notifyReporter: boolean,
): { recipients: ResidentRecipient[]; skippedNoEmail: number } => {
  const recipients: ResidentRecipient[] = [];
  let skippedNoEmail = 0;

  for (const document of documents) {
    const fields = document.fields as Record<string, unknown> | undefined;
    const email =
      readStringField(fields, "email") ||
      readStringArrayField(fields, "emails")[0] ||
      readStringField(fields, "emailAddress") ||
      readStringField(fields, "userEmail");

    if (!email || !email.includes("@")) {
      skippedNoEmail += 1;
      continue;
    }

    const name = readStringField(fields, "fullName") || readStringField(fields, "name");
    const userId = typeof document.name === "string"
      ? document.name.split("/").pop() ?? ""
      : "";

    // The reporter already knows about the report — skip them unless asked.
    if (!notifyReporter && userId && userId === reporterUserId) {
      continue;
    }

    recipients.push({ userId, email, name });
  }

  return { recipients, skippedNoEmail };
};

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }

  let body: SendNewReportEmailPayload;
  try {
    body = await request.json() as SendNewReportEmailPayload;
  } catch {
    return jsonResponse({ error: "Request body must be valid JSON." }, 400);
  }

  const userId = typeof body.userId === "string" ? body.userId.trim() : "";
  const reportId = typeof body.reportId === "string" ? body.reportId.trim() : "";
  const notifyReporter = body.notifyReporter === true;

  if (!userId || !reportId) {
    return jsonResponse({ error: "userId and reportId are required." }, 400);
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

    const projectId = serviceAccount.project_id;
    if (!projectId) {
      return jsonResponse({ error: "Service account is missing project_id." }, 500);
    }

    // Step 2: Read the freshly created report (content comes from Firestore,
    // never from the client payload, so it cannot be spoofed).
    const reportDoc = await getFirestoreDocument(
      accessToken,
      projectId,
      `regular_user/${userId}/reports/${reportId}`,
    );

    if (!reportDoc.ok) {
      if (reportDoc.status === 404) {
        return jsonResponse({ error: "Report was not found." }, 404);
      }
      return jsonResponse({ error: "Could not read the report from Firestore." }, 502);
    }

    const reportFields = reportDoc.payload?.fields as Record<string, unknown> | undefined;
    const status = readStringField(reportFields, "status") || "Pending";

    // Only fan out for freshly created, still-pending reports.
    if (status.toLowerCase() !== "pending") {
      return jsonResponse({ ok: true, skipped: "not-pending", status });
    }

    const report: ReportSummary = {
      id: readStringField(reportFields, "reportId") || reportId,
      status,
      category: readStringField(reportFields, "category"),
      issue: readStringField(reportFields, "issue"),
      location:
        readStringField(reportFields, "location") ||
        readStringField(reportFields, "address"),
      reporterName: readStringField(reportFields, "reporterName"),
    };

    // Step 3: List every resident profile and collect email recipients.
    const documents = await listAllResidents(accessToken, projectId);
    const { recipients, skippedNoEmail } = collectRecipients(
      documents,
      userId,
      notifyReporter,
    );

    if (recipients.length === 0) {
      return jsonResponse({ ok: true, reportId, sent: 0, failed: 0, skippedNoEmail });
    }

    // Step 4: Send personalized emails in bounded parallel waves so one
    // failing address never blocks the rest of the fan-out.
    let sent = 0;
    let failed = 0;
    for (let i = 0; i < recipients.length; i += BREVO_CHUNK_SIZE) {
      const chunk = recipients.slice(i, i + BREVO_CHUNK_SIZE);
      const results = await Promise.all(
        chunk.map((recipient) => sendResidentEmail(recipient, report)),
      );
      for (const ok of results) {
        if (ok) {
          sent += 1;
        } else {
          failed += 1;
        }
      }
    }

    return jsonResponse({
      ok: true,
      reportId,
      status: report.status,
      recipients: recipients.length,
      sent,
      failed,
      skippedNoEmail,
    });
  } catch (error) {
    const message =
      error instanceof Error && error.message.trim()
        ? error.message.trim()
        : "Could not send the new report notification emails.";

    return jsonResponse({ error: message }, 500);
  }
});

