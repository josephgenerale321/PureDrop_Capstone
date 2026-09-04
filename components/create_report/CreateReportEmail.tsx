import { supabase, supabaseAnonKey, supabaseUrl } from "../../api/supabase";

/**
 * Notifies every resident about a newly created report via the Supabase
 * `send-new-report-email` Edge Function (Brevo transactional email).
 *
 * Called right after the report document is committed to Firestore with
 * `status: "Pending"`. The Edge Function reads the report back from Firestore
 * and emails all resident profiles, so only the ids travel from the client —
 * report content cannot be spoofed through this call.
 *
 * Best-effort and non-blocking, mirroring the admin dashboard's
 * fireReportStatusEmail contract: failures are swallowed and only logged to
 * the console so they never break or delay the report submission. The Edge
 * Function skips resident profiles without an email on file and skips the
 * reporter themselves (they already know — they filed the report).
 */
export const fireNewReportEmail = ({
  userId,
  reportId,
}: {
  userId: string;
  reportId: string;
}): void => {
  const normalizedUserId = String(userId ?? "").trim();
  const normalizedReportId = String(reportId ?? "").trim();

  if (!normalizedUserId || !normalizedReportId) {
    console.warn("[CreateReportEmail] skipped: missing userId or reportId.");
    return;
  }

  if (!supabaseUrl || !supabaseAnonKey) {
    // Checked via the raw config exports — touching `supabase` directly would
    // throw the missing-config proxy error and crash the submit flow.
    console.warn(
      "[CreateReportEmail] skipped: Supabase is not configured in this build.",
    );
    return;
  }

  supabase.functions
    .invoke("send-new-report-email", {
      body: {
        userId: normalizedUserId,
        reportId: normalizedReportId,
      },
    })
    .then(({ error }) => {
      if (error) {
        console.warn(
          "[CreateReportEmail] resident notification skipped:",
          error.message || error,
        );
      }
    })
    .catch((error: unknown) => {
      console.warn(
        "[CreateReportEmail] resident notification skipped:",
        error instanceof Error ? error.message : String(error),
      );
    });
};

export default fireNewReportEmail;

