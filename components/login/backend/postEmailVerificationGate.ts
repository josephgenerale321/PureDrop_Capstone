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
 * - "legacy_notice"   — a legacy account the admin marked "verified" without
 *                       real submissions: show the success-style notice that
 *                       the face scan and Valid ID are still owed.
 * - "fully_verified_notice" — the admin has VERIFIED the account AND both
 *                       steps are genuinely submitted AND the account has not
 *                       celebrated yet: show fullyverif.tsx ONCE, then Home.
 * - "home"            — the admin has VERIFIED the account AND both steps are
 *                       genuinely submitted AND the one-time notice was already
 *                       celebrated, or the state could not be read
 *                       (non-fatal fallback — never trap the user on a gate
 *                       screen).
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
export type PostLoginTarget =
  | "rejected_notice"
  | "legacy_notice"
  | "fully_verified_notice"
  | "verification"
  | "home";

const REJECTED_STATUS = "rejected";
const VERIFIED_STATUS = "verified";

/** Toggle with `__DEV__` logging for slow-restore diagnostics on Vivo. */
const GATE_DEBUG = __DEV__;

/** Timestamped diagnostic line used to find the slow span on cold start. */
const gateLog = (label: string, t0: number): void => {
  if (GATE_DEBUG) {
    // eslint-disable-next-line no-console
    console.log(`[gate] ${label} +${Date.now() - t0}ms`);
  }
};

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
 *
 * A REJECTED account can never use this marker: `markVerificationLater()`
 * refuses to write while the account's live verificationStatus is
 * "rejected", so "Later" can never stash a flag that parks a rejected user
 * on the pre-login screens (and bouncing between hub <-> notice).
 */
const VERIFICATION_LATER_KEY = "@puredrop/verification_later";

/** Records the "continue verification later" choice for the signed-in account. */
export async function markVerificationLater(): Promise<boolean> {
  const outcome = await getVerificationLaterOutcome();
  return outcome.kind === "allowed";
}

/**
 * Discriminant result of attempting to record the "continue verification
 * later" choice. Callers use `kind` to pick the right messaging / behavior.
 *
 * - `allowed`            — the account is NOT rejected; the marker was written.
 * - `rejected`           — the account's live `verificationStatus` is "rejected";
 *                          no marker is written. `wasPreviouslyVerified` is true
 *                          when the account has a `verifiedAt` timestamp (i.e. the
 *                          admin approved it at least once before re-rejecting it),
 *                          so callers can say "Re-verification required" vs "Your
 *                          verification was rejected" without tracking a separate
 *                          boolean field.
 * - `error`              — the doc read or the AsyncStorage write failed; the
 *                          marker was NOT written and the account was NOT confirmed
 *                          as rejected. The safe default for callers is to keep the
 *                          user in the verification flow (the realtime watcher still
 *                          enforces any rejection once Firestore is reachable).
 */
export type VerificationLaterOutcome =
  | { kind: "allowed"; uid: string }
  | { kind: "rejected"; wasPreviouslyVerified: boolean }
  | { kind: "error" };

/**
 * Rejected accounts must finish re-verification now — never stash a "later"
 * flag for them. Parking a rejected user on index/start/login is exactly what
 * produced the "Later backs to verificationmain, back redirects to index"
 * ping-pong: every gate (SaveLoginSync, Home's fail-closed check, the realtime
 * watcher) yanks the rejected account right back into the verification flow.
 *
 * The function also reports whether the account was EVER previously verified
 * (via the `verifiedAt` timestamp the admin panel writes on every approval —
 * see PureDrop_Admin/.../verificationService.js:273-274) so callers can
 * distinguish a first-time rejection from a re-rejection of a previously-
 * approved account and use the matching wording.
 */
export async function getVerificationLaterOutcome(): Promise<VerificationLaterOutcome> {
  const uid = auth.currentUser?.uid;
  if (!uid) {
    return { kind: "error" };
  }

  // --- read the live doc once (status + was-previously-verified signal) ---
  let isRejected = false;
  let wasPreviouslyVerified = false;
  try {
    const userSnap = await getDoc(doc(db, "regular_user", uid));
    if (userSnap.exists()) {
      const data = userSnap.data();
      if (data.verificationStatus === REJECTED_STATUS) {
        isRejected = true;
      }
      // The admin panel writes `verifiedAt` on every approval. Its presence
      // means the account has been verified at least once before (whether the
      // current status is "verified", "pending" re-approval, or "rejected"
      // again). Absent field = never approved.
      wasPreviouslyVerified =
        data.verifiedAt != null &&
        (typeof data.verifiedAt === "object" ||
          typeof data.verifiedAt === "number");
    }
  } catch {
    // Doc read failed — cannot confirm the account is NOT rejected, so do NOT
    // record a "later" choice. The realtime watcher still enforces any
    // rejection once Firestore is reachable; the safe default is to keep the
    // user in the verification flow.
    return { kind: "error" };
  }

  if (isRejected) {
    return { kind: "rejected", wasPreviouslyVerified };
  }

  // --- write the persisted "later" marker (only for non-rejected accounts) ---
  try {
    await AsyncStorage.setItem(VERIFICATION_LATER_KEY, uid);
    return { kind: "allowed", uid };
  } catch {
    // Storage errors are non-fatal — the worst case is one extra redirect.
    return { kind: "error" };
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

// ---------------------------------------------------------------------------
// "Fully verified" one-time notice (app/login/validation/fullyverif.tsx)
// ---------------------------------------------------------------------------

/**
 * Per-account marker for the one-time "fully verified" celebration screen.
 * Shown ONCE per account: when the admin has approved the account, the NEXT
 * explicit login (and the next silent session auto-redirect) lands on
 * fullyverif.tsx first, then the marker is consumed and every later login
 * goes straight to Home. Stored per-uid so a different account on the same
 * device still gets its own one-time celebration.
 *
 * Firestore `fullyVerifiedNoticeSeenAt` is authoritative (survives reinstall /
 * device change); the AsyncStorage uid marker is a fast offline mirror so an
 * offline login still shows the notice exactly once. Both are best-effort —
 * a storage failure only ever costs one extra (or one skipped) celebration,
 * never a crash or a trap.
 */
const FULLY_VERIFIED_LATER_KEY = "@puredrop/fully_verified_notice_seen";

const fullyVerifiedSeenKey = (uid: string): string => `${FULLY_VERIFIED_LATER_KEY}:${uid}`;

/** True when this account already celebrated its fully-verified notice. */
export async function hasSeenFullyVerifiedNotice(uid?: string | null): Promise<boolean> {
  const resolvedUid = uid ?? auth.currentUser?.uid ?? null;
  if (!resolvedUid) {
    return false;
  }
  try {
    const seen = await AsyncStorage.getItem(fullyVerifiedSeenKey(resolvedUid));
    if (seen === "true") {
      return true;
    }
  } catch {
    // Storage read failure — fall through to the Firestore check.
  }
  try {
    const userSnap = await getDoc(doc(db, "regular_user", resolvedUid));
    if (userSnap.exists() && userSnap.data().fullyVerifiedNoticeSeenAt != null) {
      try {
        await AsyncStorage.setItem(fullyVerifiedSeenKey(resolvedUid), "true");
      } catch {
        // Mirror write is best-effort.
      }
      return true;
    }
  } catch {
    // Firestore hiccup — treat as unseen so the notice still shows once the
    // user can reach it; the consume step retries the write later.
  }
  return false;
}

/**
 * Consumes the one-time notice for this account: marks it seen locally AND on
 * the user's `regular_user` document (both best-effort). Called when
 * fullyverif.tsx is acknowledged (button press) AND on mount as a safety net
 * so backing out via hardware back can never resurrect it on the next login.
 */
export async function markFullyVerifiedNoticeSeen(uid?: string | null): Promise<void> {
  const resolvedUid = uid ?? auth.currentUser?.uid ?? null;
  if (!resolvedUid) {
    return;
  }
  try {
    await AsyncStorage.setItem(fullyVerifiedSeenKey(resolvedUid), "true");
  } catch {
    // Non-fatal.
  }
  try {
    await updateDoc(doc(db, "regular_user", resolvedUid), {
      fullyVerifiedNoticeSeenAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch {
    // Non-fatal — the local mirror still suppresses repeats on this device;
    // the Firestore write is retried on the next acknowledgement.
  }
}

/**
 * Optional preloaded user document (already fetched by the caller).
 * Passing it avoids a duplicate Firestore `getDoc` — the gate reuses the same
 * snapshot for status + submission markers + rejection counters.
 */
export type PreloadedUserDoc = {
  uid: string;
  data: Record<string, unknown> | null;
} | null;

export async function resolvePostLoginTarget(
  preloaded: PreloadedUserDoc = null
): Promise<PostLoginTarget> {
  const t0 = Date.now();
  const user = auth.currentUser;
  if (!user?.uid) {
    return "home";
  }

  try {
    // ONE read total: reuse the caller's snapshot when available (SaveLoginSync
    // profile sync already fetched it), otherwise a single `getDoc` here.
    let data: Record<string, unknown> | null = null;
    if (preloaded && preloaded.uid === user.uid) {
      data = preloaded.data;
      gateLog("gate: reused preloaded profile (0 reads)", t0);
    } else {
      gateLog("gate: getDoc start", t0);
      const userSnap = await getDoc(doc(db, "regular_user", user.uid));
      gateLog("gate: getDoc done", t0);
      data = userSnap.exists()
        ? (userSnap.data() as Record<string, unknown>)
        : null;
    }
    if (data) {

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

      // Legacy accounts — some old users were marked "verified" in the admin
      // panel without ever submitting a face scan / Valid ID through the app.
      // They still owe BOTH steps: logins route them to a success-style
      // notice screen (app/login/validation/legacyverif.tsx) that explains
      // this and sends them into the verification flow.
      if (data.verificationStatus === VERIFIED_STATUS) {
        if (faceScanDone && validIdDone) {
          // Genuinely verified — the account may enter the app. Any earlier
          // "later" choice is moot; drop it.
          await clearVerificationLater();
          // One-time celebration: the FIRST login after the admin's approval
          // lands on fullyverif.tsx; every later login goes straight Home.
          // FAST PATH: the preloaded doc already carries
          // `fullyVerifiedNoticeSeenAt`, so reuse it instead of a 2nd getDoc.
          // Only when the field is missing do we fall back to the full
          // `hasSeenFullyVerifiedNotice()` check (AsyncStorage + Firestore).
          gateLog("gate: verified+docs, checking celebration", t0);
          try {
            const celebratedFromDoc = data.fullyVerifiedNoticeSeenAt != null;
            if (!celebratedFromDoc) {
              const celebrated = await hasSeenFullyVerifiedNotice(user.uid);
              if (!celebrated) {
                gateLog("gate: -> fully_verified_notice", t0);
                return "fully_verified_notice";
              }
            }
          } catch {
            // Gate check failure is non-fatal — fall through to Home.
          }
          gateLog("gate: -> home", t0);
          return "home";
        }
        gateLog("gate: -> legacy_notice", t0);
        return "legacy_notice";
      }

      // Pending (both steps in, awaiting admin approval) or still incomplete —
      // the user stays in the verification flow. The hub shows their progress
      // and auto-advances to Home the moment the admin approves.
      // NOTE: the "continue later" marker is NOT consulted here — it is
      // handled by the callers: SaveLoginSync suppresses the silent auto-
      // redirect for an account that chose "later", while an explicit login
      // (app/login/index.tsx) always runs this gate so verification stays
      // enforced.
      gateLog("gate: -> verification", t0);
      return "verification";
    }
  } catch {
    // Non-fatal — a Firestore hiccup must never trap the user; they can
    // always proceed and re-verify later.
    gateLog("gate: error, fallback home", t0);
  }

  gateLog("gate: -> home (fallback)", t0);
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
