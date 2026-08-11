import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json",
};

const BREVO_SEND_EMAIL_URL = "https://api.brevo.com/v3/smtp/email";
const OTP_TABLE = "password_reset_otps";
const OTP_EXPIRY_MS = 10 * 60 * 1000;
const OTP_RESEND_MS = 30 * 1000;
const OTP_MAX_ATTEMPTS = 5;

type OtpRequestPayload = {
  action?: "send" | "verify";
  email?: string;
  code?: string;
};

type OtpRecord = {
  attempts: number;
  code_hash: string;
  email: string;
  email_hash: string;
  expires_at: string;
  sent_at: string;
};

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    headers: corsHeaders,
    status,
  });

const normalizeEmail = (value: unknown) =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

const normalizeCode = (value: unknown) =>
  typeof value === "string" ? value.replace(/\D/g, "").slice(0, 6) : "";

const toHex = (bytes: ArrayBuffer) =>
  Array.from(new Uint8Array(bytes))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

const sha256 = async (value: string) => {
  const data = new TextEncoder().encode(value);
  return toHex(await crypto.subtle.digest("SHA-256", data));
};

const generateOtpCode = () => {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return String(bytes[0] % 1_000_000).padStart(6, "0");
};

const getServiceRoleKey = () => {
  const legacyKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
  if (legacyKey) {
    return legacyKey;
  }

  const secretKeys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (!secretKeys) {
    return "";
  }

  try {
    const parsed = JSON.parse(secretKeys) as Record<string, string | undefined>;
    return parsed.default?.trim() ?? "";
  } catch {
    return "";
  }
};

const getSupabaseAdmin = () => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim() ?? "";
  const serviceRoleKey = getServiceRoleKey();

  if (!supabaseUrl || !serviceRoleKey) {
    return null;
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
};

const getResetMessageHtml = (code: string) => `
  <div style="font-family: Arial, sans-serif; color: #102a43;">
    <h2 style="margin-bottom: 12px;">Reset your PureDrop password</h2>
    <p>Use this 6-digit code to reset your password:</p>
    <p style="font-size: 32px; font-weight: 700; letter-spacing: 6px; margin: 20px 0;">${code}</p>
    <p>This code expires in 10 minutes.</p>
    <p>If you did not request this code, you can ignore this email.</p>
  </div>
`;

const getResetMessageText = (code: string) =>
  `Reset your PureDrop password with this 6-digit code: ${code}. This code expires in 10 minutes.`;

const sendBrevoEmail = async (email: string, code: string) => {
  const apiKey = Deno.env.get("BREVO_API_KEY")?.trim() ?? "";
  const senderEmail = Deno.env.get("BREVO_SENDER_EMAIL")?.trim() ?? "";
  const senderName = Deno.env.get("BREVO_SENDER_NAME")?.trim() || "PureDrop App";

  if (!apiKey || !senderEmail) {
    return {
      errorResponse: jsonResponse(
        { error: { message: "Brevo secrets are not configured in Supabase Edge Functions." } },
        500,
      ),
    };
  }

  const brevoResponse = await fetch(BREVO_SEND_EMAIL_URL, {
    body: JSON.stringify({
      sender: {
        email: senderEmail,
        name: senderName,
      },
      to: [{ email }],
      subject: "Your PureDrop password reset code",
      htmlContent: getResetMessageHtml(code),
      textContent: getResetMessageText(code),
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
    errorResponse: jsonResponse({ error: { message } }, 502),
  };
};

const handleSend = async (email: string) => {
  const supabaseAdmin = getSupabaseAdmin();
  if (!supabaseAdmin) {
    return jsonResponse(
      { error: { message: "Supabase service role secret is not available to the Edge Function." } },
      500,
    );
  }

  const emailHash = await sha256(email);
  const { data: existingRecord, error: readError } = await supabaseAdmin
    .from(OTP_TABLE)
    .select("sent_at")
    .eq("email_hash", emailHash)
    .maybeSingle();

  if (readError) {
    return jsonResponse({ error: { message: readError.message } }, 500);
  }

  if (existingRecord?.sent_at) {
    const lastSentMs = Date.parse(existingRecord.sent_at);
    if (Number.isFinite(lastSentMs) && Date.now() - lastSentMs < OTP_RESEND_MS) {
      return jsonResponse(
        { error: { message: "Please wait before requesting another code." } },
        429,
      );
    }
  }

  const now = new Date();
  const code = generateOtpCode();
  const record = {
    attempts: 0,
    code_hash: await sha256(`${email}:${code}`),
    created_at: now.toISOString(),
    email,
    email_hash: emailHash,
    expires_at: new Date(now.getTime() + OTP_EXPIRY_MS).toISOString(),
    last_attempt_at: null,
    sent_at: now.toISOString(),
  };

  const { error: upsertError } = await supabaseAdmin
    .from(OTP_TABLE)
    .upsert(record, { onConflict: "email_hash" });

  if (upsertError) {
    return jsonResponse({ error: { message: upsertError.message } }, 500);
  }

  try {
    const sendResult = await sendBrevoEmail(email, code);
    if ("errorResponse" in sendResult) {
      await supabaseAdmin.from(OTP_TABLE).delete().eq("email_hash", emailHash);
      return sendResult.errorResponse;
    }
  } catch (error) {
    await supabaseAdmin.from(OTP_TABLE).delete().eq("email_hash", emailHash);
    const message = error instanceof Error && error.message.trim()
      ? error.message.trim()
      : "Could not send password reset email through Brevo.";
    return jsonResponse({ error: { message } }, 502);
  }

  return jsonResponse({
    expiresInSeconds: OTP_EXPIRY_MS / 1000,
    resendAfterSeconds: OTP_RESEND_MS / 1000,
    sent: true,
  });
};

const handleVerify = async (email: string, code: string) => {
  const supabaseAdmin = getSupabaseAdmin();
  if (!supabaseAdmin) {
    return jsonResponse(
      { error: { message: "Supabase service role secret is not available to the Edge Function." } },
      500,
    );
  }

  const emailHash = await sha256(email);
  const { data: recordData, error: readError } = await supabaseAdmin
    .from(OTP_TABLE)
    .select("attempts, code_hash, email, email_hash, expires_at, sent_at")
    .eq("email_hash", emailHash)
    .maybeSingle();

  if (readError) {
    return jsonResponse({ error: { message: readError.message } }, 500);
  }

  if (!recordData) {
    return jsonResponse(
      { error: { message: "Reset code was not found. Please request a new code." } },
      404,
    );
  }

  const record = recordData as OtpRecord;

  if (Date.now() > Date.parse(record.expires_at)) {
    await supabaseAdmin.from(OTP_TABLE).delete().eq("email_hash", emailHash);
    return jsonResponse(
      { error: { message: "Reset code has expired. Please request a new code." } },
      410,
    );
  }

  if (record.attempts >= OTP_MAX_ATTEMPTS) {
    await supabaseAdmin.from(OTP_TABLE).delete().eq("email_hash", emailHash);
    return jsonResponse(
      { error: { message: "Too many attempts. Please request a new code." } },
      429,
    );
  }

  const codeHash = await sha256(`${email}:${code}`);
  if (codeHash !== record.code_hash) {
    await supabaseAdmin
      .from(OTP_TABLE)
      .update({
        attempts: record.attempts + 1,
        last_attempt_at: new Date().toISOString(),
      })
      .eq("email_hash", emailHash);

    return jsonResponse({ error: { message: "Incorrect reset code." } }, 403);
  }

  await supabaseAdmin.from(OTP_TABLE).delete().eq("email_hash", emailHash);

  return jsonResponse({ verified: true });
};

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: { message: "Method not allowed." } }, 405);
  }

  let payload: OtpRequestPayload;
  try {
    payload = await request.json() as OtpRequestPayload;
  } catch {
    return jsonResponse({ error: { message: "Request body must be valid JSON." } }, 400);
  }

  const action = payload.action;
  const email = normalizeEmail(payload.email);

  if (!email) {
    return jsonResponse({ error: { message: "Email address is required." } }, 400);
  }

  if (action === "send") {
    return handleSend(email);
  }

  if (action === "verify") {
    const code = normalizeCode(payload.code);
    if (code.length !== 6) {
      return jsonResponse({ error: { message: "A valid 6-digit code is required." } }, 400);
    }

    return handleVerify(email, code);
  }

  return jsonResponse({ error: { message: "Unsupported password reset action." } }, 400);
});