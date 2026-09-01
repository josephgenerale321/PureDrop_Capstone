// @ts-nocheck — Deno runtime globals (Deno, jsr: imports) are not available in VSCode
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json",
};

const BREVO_SEND_EMAIL_URL = "https://api.brevo.com/v3/smtp/email";

type AccountUpdateEmailPayload = {
  email?: string;
  fullName?: string;
  changeType?: "password" | "profile" | "status" | "custom";
  details?: string;
  changedByAdmin?: boolean;
};

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    headers: corsHeaders,
    status,
  });

const normalizeChangeType = (value: unknown): string => {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (
    normalized === "password" ||
    normalized === "profile" ||
    normalized === "status" ||
    normalized === "custom"
  ) {
    return normalized;
  }
  return "custom";
};

const sanitizeDetails = (value: unknown): string => {
  if (typeof value !== "string") {
    return "";
  }
  // Strip angle brackets so details can be interpolated into the HTML body.
  return value.replace(/[<>]/g, "").trim().slice(0, 1000);
};

const buildEmailSubject = (changeType: string, details: string): string => {
  if (changeType === "password") {
    return "Your PureDrop password was changed";
  }
  if (changeType === "status") {
    return "Your PureDrop account status changed";
  }
  if (changeType === "profile") {
    return "Your PureDrop account details were updated";
  }
  return "Your PureDrop account was updated";
};

const buildEmailBodyHtml = (changeType: string, details: string): string => {
  let headline = "An administrator updated your PureDrop account.";
  if (changeType === "password") {
    headline = "An administrator changed your PureDrop account password.";
  } else if (changeType === "status") {
    headline = "An administrator changed your PureDrop account status.";
  } else if (changeType === "profile") {
    headline = "An administrator updated your PureDrop account details.";
  }

  const detailsBlock = details
    ? `<p style="margin-top: 16px;"><strong>Changes:</strong></p><p>${details}</p>`
    : "";

  const securityNote = changeType === "password"
    ? `<p style="margin-top: 20px;">If you did not expect this change, please contact the PureDrop team immediately.</p>`
    : "";

  return `
  <div style="font-family: Arial, sans-serif; color: #102a43;">
    <h2 style="margin-bottom: 12px;">Account update</h2>
    <p>${headline}</p>
    ${detailsBlock}
    ${securityNote}
    <p style="margin-top: 20px;">You can open the PureDrop app to review your account.</p>
  </div>
`;
};

const buildEmailBodyText = (changeType: string, details: string): string => {
  let headline = "An administrator updated your PureDrop account.";
  if (changeType === "password") {
    headline = "An administrator changed your PureDrop account password.";
  } else if (changeType === "status") {
    headline = "An administrator changed your PureDrop account status.";
  } else if (changeType === "profile") {
    headline = "An administrator updated your PureDrop account details.";
  }

  const lines = [headline];
  if (details) {
    lines.push(`Changes: ${details}`);
  }
  if (changeType === "password") {
    lines.push("If you did not expect this change, please contact the PureDrop team immediately.");
  }
  lines.push("You can open the PureDrop app to review your account.");
  return lines.join("\n");
};

/**
 * Send the account-update email through Brevo's transactional email API.
 * Same secrets/pattern as the email-verification-otp Edge Function.
 */
const sendBrevoEmail = async (
  toEmail: string,
  toName: string,
  changeType: string,
  details: string,
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
      subject: buildEmailSubject(changeType, details),
      htmlContent: buildEmailBodyHtml(changeType, details),
      textContent: buildEmailBodyText(changeType, details),
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

  let body: AccountUpdateEmailPayload;
  try {
    body = await request.json() as AccountUpdateEmailPayload;
  } catch {
    return jsonResponse({ error: "Request body must be valid JSON." }, 400);
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const fullName = typeof body.fullName === "string" ? body.fullName.trim().slice(0, 200) : "";
  const changeType = normalizeChangeType(body.changeType);
  const details = sanitizeDetails(body.details);
  const changedByAdmin = body.changedByAdmin !== false;

  if (!email || !email.includes("@")) {
    return jsonResponse({ error: "A valid email address is required." }, 400);
  }

  const sendResult = await sendBrevoEmail(email, fullName, changeType, details);
  if ("errorResponse" in sendResult) {
    return sendResult.errorResponse;
  }

  return jsonResponse({ ok: true, email, changeType, changedByAdmin });
});
