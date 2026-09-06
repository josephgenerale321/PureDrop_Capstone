import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "../../../firebaseConfig";

/**
 * Post-email-verification gate for the email verification success screen
 * (app/login/email_verification/success.tsx).
 *
 * After registration completes the user record is created in the
 * `regular_user` Firestore collection ("residents/user") with
 * `emailVerified: true`. When that flag is present on the signed-in user's
 * record, the success screen continues into the identity verification flow
 * (face selfie + Valid ID) instead of sending the user back to Login.
 */

export type PostEmailVerificationTarget = "verification" | "login";

/**
 * Resolves where the user should go after their email was verified:
 * - "verification" — the user record exists AND is marked emailVerified;
 * - "login"        — no live session, no user record, or the record does not
 *                    confirm the verification (non-fatal fallback).
 */
export async function resolvePostEmailVerificationTarget(): Promise<PostEmailVerificationTarget> {
  const user = auth.currentUser;
  if (!user?.uid) {
    return "login";
  }

  try {
    const userSnap = await getDoc(doc(db, "regular_user", user.uid));
    if (userSnap.exists() && userSnap.data().emailVerified === true) {
      return "verification";
    }
  } catch {
    // Non-fatal — a Firestore hiccup must never trap the user on the success
    // screen; they can still proceed through Login.
  }

  return "login";
}

// ---------------------------------------------------------------------------
// Identity verification gate (face selfie + Valid ID)
// ---------------------------------------------------------------------------

export type IdentityVerificationTarget = "verification" | "home";

/**
 * Resolves whether the signed-in user still needs to go through the identity
 * verification flow (face selfie + Valid ID) or may proceed to the app.
 *
 * A user is considered verified-in once BOTH steps have been submitted —
 * detected via the `faceScanPath` and `validIdFrontPath` fields that the
 * submission backends write to the `regular_user` document:
 *
 * - "verification" — the face scan and/or the Valid ID has not been
 *                    submitted yet (the user record exists but is missing
 *                    one of the two submission markers);
 * - "home"         — both steps are submitted, there is no live session, no
 *                    user record, or the record read failed (non-fatal
 *                    fallback — never trap the user on a gate screen).
 */
export async function resolveIdentityVerificationTarget(): Promise<IdentityVerificationTarget> {
  const user = auth.currentUser;
  if (!user?.uid) {
    return "home";
  }

  try {
    const userSnap = await getDoc(doc(db, "regular_user", user.uid));
    if (userSnap.exists()) {
      const data = userSnap.data();
      const faceScanDone =
        typeof data.faceScanPath === "string" && data.faceScanPath.length > 0;
      const validIdDone =
        typeof data.validIdFrontPath === "string" && data.validIdFrontPath.length > 0;

      if (faceScanDone && validIdDone) {
        return "home";
      }
      return "verification";
    }
  } catch {
    // Non-fatal — a Firestore hiccup must never trap the user; they can
    // always proceed and re-verify later.
  }

  return "home";
}
