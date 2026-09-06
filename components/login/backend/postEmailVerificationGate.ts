import AsyncStorage from "@react-native-async-storage/async-storage";
import { doc, getDoc, serverTimestamp, updateDoc } from "firebase/firestore";
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

      // A rejected user must NEVER land on Home — they are sent back into the
      // verification flow to resubmit (the login gate routes them through the
      // rejection notice screen first via `resolvePostLoginTarget`).
      if (data.verificationStatus === "rejected") {
        return "verification";
      }

      const faceScanDone =
        typeof data.faceScanPath === "string" && data.faceScanPath.length > 0;
      const validIdDone =
        typeof data.validIdFrontPath === "string" && data.validIdFrontPath.length > 0;

      if (faceScanDone && validIdDone) {
        if (data.verificationStatus === VERIFIED_STATUS) {
          // The admin has approved the account — only NOW may it enter the
          // app.
          return "home";
        }

        // Both steps are in but the admin has NOT approved yet ("pending") —
        // the user stays in the verification flow until approval.
        return "verification";
      }
      return "verification";
    }
  } catch {
    // Non-fatal — a Firestore hiccup must never trap the user; they can
    // always proceed and re-verify later.
  }

  return "home";
}

// ---------------------------------------------------------------------------
// Rejection notice gate (rejectedverif screen)
// ---------------------------------------------------------------------------

/**
 * Where the user should land right after a login, based on the identity
 * verification state of their `regular_user` record:
 *
 * - "rejected_notice" — the account's verification was REJECTED by the admin
 *                       AND the user has not seen the rejection notice for
 *                       this rejection yet. The notice (same design as the
 *                       email-verification success screen) shows ONCE per
 *                       rejection; the user then re-verifies their ID.
 * - "verification"    — the user still owes a face scan / Valid ID, the
 *                       verification is "pending" (both steps in, awaiting
 *                       admin approval), or the verification was rejected and
 *                       the notice has already been seen.
 * - "home"            — the admin has VERIFIED the account, or the state
 *                       could not be read (non-fatal fallback — never trap
 *                       the user on a gate screen).
 *
 * Firestore fields driving the "show the notice only once per rejection"
 * behaviour:
 *
 * - verificationRejectionCount   — incremented by the admin panel on every
 *                                  rejection, reset to 0 on approval.
 * - rejectedNoticeSeenCount      — the rejection count at the time the user
 *                                  acknowledged the notice on the mobile
 *                                  rejectedverif screen.
 *
 * The notice shows whenever `rejectedNoticeSeenCount` differs from the
 * current `verificationRejectionCount` (i.e. a NEW rejection the user has
 * not been told about yet). At 3+ rejections the same screen shows again but
 * with the final-warning text variant.
 */
export type PostLoginTarget = "rejected_notice" | "verification" | "home";

const REJECTED_STATUS = "rejected";
const VERIFIED_STATUS = "verified";

// ---------------------------------------------------------------------------
// "Continue later" marker (Cancel Verification → GO BACK on verificationmain)
// ---------------------------------------------------------------------------

/**
 * Persisted "continue verification later" marker (AsyncStorage). Choosing
 * GO BACK on verificationmain's back-confirm lightbox records the signed-in
 * user's uid, and the session auto-redirect (SaveLoginSync) then stops
 * dragging that account into the verification flow — on ANY pre-login screen
 * (index / start / login / register), across app restarts, until the
 * verification is actually completed (the gate clears the marker once the
 * admin has verified the account). Explicit logins are NOT suppressed: they
 * are the enforcement point that still routes an unverified / pending user
 * into verificationmain. The stored value is the uid of the account that made
 * the choice, so a different account on the same device never inherits it.
 */
const VERIFICATION_LATER_KEY = "@puredrop/verification_later";

/** Records the "continue verification later" choice for the signed-in account. */
export async function markVerificationLater(): Promise<void> {
  try {
    const uid = auth.currentUser?.uid;
    if (uid) {
      await AsyncStorage.setItem(VERIFICATION_LATER_KEY, uid);
    }
  } catch {
    // Storage errors are non-fatal — the worst case is one extra redirect.
  }
}

/** Clears the "continue verification later" choice (verification completed). */
export async function clearVerificationLater(): Promise<void> {
  try {
    await AsyncStorage.removeItem(VERIFICATION_LATER_KEY);
  } catch {
    // Non-fatal.
  }
}

/** True when the currently signed-in account previously chose "later". */
export async function hasChosenVerificationLater(): Promise<boolean> {
  try {
    const uid = auth.currentUser?.uid;
    const savedUid = await AsyncStorage.getItem(VERIFICATION_LATER_KEY);
    return Boolean(uid && savedUid === uid);
  } catch {
    return false;
  }
}

/** Normalizes a Firestore counter into a non-negative integer (default 0). */
const asCount = (value: unknown): number => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
};

/**
 * Normalizes the "notice seen" counter. Absent field means the user has
 * never acknowledged any rejection notice yet (-1), so even a legacy
 * `rejected` account with no counters shows the notice once.
 */
const asSeenCount = (value: unknown): number => {
  if (value === null || value === undefined) {
    return -1;
  }
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? Math.floor(parsed) : -1;
};

export async function resolvePostLoginTarget(): Promise<PostLoginTarget> {
  const user = auth.currentUser;
  if (!user?.uid) {
    return "home";
  }

  try {
    const userSnap = await getDoc(doc(db, "regular_user", user.uid));
    if (userSnap.exists()) {
      const data = userSnap.data();

      // Rejected accounts: show the rejection notice once per rejection,
      // then send the user straight into re-verification on later logins.
      // This ALWAYS wins — a user who backed out earlier with "later" is
      // still sent to re-verify once the admin has rejected their account.
      if (data.verificationStatus === REJECTED_STATUS) {
        const rejectionCount = asCount(data.verificationRejectionCount);
        const seenCount = asSeenCount(data.rejectedNoticeSeenCount);

        if (seenCount !== rejectionCount) {
          return "rejected_notice";
        }
        return "verification";
      }

      const faceScanDone =
        typeof data.faceScanPath === "string" && data.faceScanPath.length > 0;
      const validIdDone =
        typeof data.validIdFrontPath === "string" && data.validIdFrontPath.length > 0;

      if (faceScanDone && validIdDone) {
        if (data.verificationStatus === VERIFIED_STATUS) {
          // The admin has APPROVED the account — only now may it enter the
          // app. Any earlier "later" choice is moot; drop it.
          await clearVerificationLater();
          return "home";
        }

        // Both steps are in but the admin has NOT approved yet ("pending") —
        // the user must NOT reach Home. They stay on the verification hub
        // (both check marks showing, with a live redirect to Home the moment
        // the admin approves). The "later" flag does not apply here — approval
        // is mandatory.
        return "verification";
      }

      // NOTE: the "continue later" marker is NOT consulted here — it is
      // handled by the callers: SaveLoginSync suppresses the silent auto-
      // redirect for an account that chose "later", while an explicit login
      // (app/login/index.tsx) always runs this gate so verification stays
      // enforced.
      return "verification";
    }
  } catch {
    // Non-fatal — a Firestore hiccup must never trap the user; they can
    // always proceed and re-verify later.
  }

  return "home";
}

/**
 * Marks the rejection notice as SEEN for the given rejection count, so the
 * notice pops up exactly ONCE per rejection (a new admin rejection bumps
 * `verificationRejectionCount` and the notice shows again).
 *
 * Fully non-fatal: if the write fails the worst case is the notice showing
 * one more time on the next login — never a crash.
 */
export async function markRejectedNoticeSeen(rejectionCount: number): Promise<void> {
  const user = auth.currentUser;
  if (!user?.uid) {
    return;
  }

  const safeCount = Number.isFinite(rejectionCount)
    ? Math.max(0, Math.floor(rejectionCount))
    : 0;

  try {
    await updateDoc(doc(db, "regular_user", user.uid), {
      rejectedNoticeSeenCount: safeCount,
      updatedAt: serverTimestamp(),
    });
  } catch {
    // Non-fatal — never crash the notice screen on a failed write.
  }
}
