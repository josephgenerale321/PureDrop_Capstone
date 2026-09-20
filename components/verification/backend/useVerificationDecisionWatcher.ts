import { useEffect } from "react";
import { Alert } from "react-native";
import { onAuthStateChanged } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { type Href, useRouter } from "expo-router";
import { getLocallyAcknowledgedRejectionKey } from "../../login/backend/postEmailVerificationGate";
import { saveVerificationCache } from "../../main_layout/offline_profile_cache";
import { auth, db } from "../../../firebaseConfig";

// Verified users' destination — when the admin approves a "pending" account
// while the user sits anywhere in the verification flow, the "Account
// Verified" alert takes them straight Home. The alert IS this session's
// celebration, so the one-time fullyverif marker is consumed here — the next
// login goes directly Home instead of resurrecting fullyverif.tsx for an
// approval the user already acknowledged. (fullyverif.tsx still shows once
// for approvals that happened while the user was AWAY, via the login gate.)
//
// Existing fully-verified users (approved before, accidentally rejected, then
// re-approved) get an EMPTY welcome message ('') — they already celebrated
// once. Brand-new users (never celebrated) still get the full "Welcome to
// PureDrop!" text. The signal is `fullyVerifiedNoticeSeenAt` on the user doc:
// the admin approve path never clears it, so its presence means "already
// celebrated".
const HOME_ROUTE = "/regular_user/home" as Href;
// Rejection notice screen — the admin can reject this account's verification
// while the user sits anywhere in the flow; the live subscription detects it
// in realtime and auto-redirects here.
const REJECTED_NOTICE_ROUTE = "/login/validation/rejectedverif" as Href;

// ---------------------------------------------------------------------------
// Module-level decision guards — shared by EVERY mounted verification screen.
//
// Several verification screens can be mounted at the same time (the hub stays
// in the stack underneath every pushed flow screen) and they all subscribe to
// the same `regular_user` document, so a single admin decision arrives on
// several listeners at once. These guards make sure exactly ONE alert /
// redirect fires per decision, no matter which screen's listener lands first.
// ---------------------------------------------------------------------------

// Approval guard — fingerprint of the last handled "verified" snapshot
// (uid + the admin's own `verifiedAt` decision stamp) so snapshot
// re-emissions of the same write can never fire twice, while a later
// reject → re-approve cycle (a NEW `verifiedAt`) can fire again. The stamp
// deliberately avoids `updatedAt`: that field is bumped by OUR OWN writes
// (`markFullyVerifiedNoticeSeen` on OK) and by the presence heartbeat, which
// rotated the key after every acknowledgement and replayed the alert in a
// loop.
let handledApprovalKey: string | null = null;

// Rejection guard — uid + rejection count of the last handled rejection, so a
// NEW rejection (count increments) fires while re-emissions of the same
// rejection cannot. Mirrors the acknowledged-notice gate in the snapshot
// handler below.
let handledRejectionKey: string | null = null;

/**
 * Realtime admin decision watcher for the verification flow.
 *
 * Subscribes to the signed-in user's `regular_user` document and reacts to
 * admin decisions made from the admin panel WHILE the user is on ANY
 * verification screen (hub, face selfie, Valid ID, camera, review):
 *
 *   - Approved ("pending" → "verified"): shows the "Account Verified" alert
 *     and takes the user straight Home (dismissAll + replace, so no stale
 *     flow screen survives underneath). The one-time fullyverif marker is
 *     consumed at the same time, so the next login also goes directly Home
 *     instead of replaying the celebration for an already-acknowledged
 *     approval. Re-approved users (`wasReapproved` flag written by the admin
 *     panel) get the restored-verification wording, while brand-new users get
 *     the full "Welcome to PureDrop!" text. The empty string is kept only as a
 *     fallback for a previously-verified user whose approval carries no
 *     re-approval flag (e.g. a doc written by an older admin build).
 *   - Rejected ("rejected" with an unacknowledged rejection count): redirects
 *     to the rejection notice screen (same gate as the login flow — the
 *     notice only fires for a rejection the user has NOT acknowledged yet).
 *     If the account was previously fully verified AND both Valid ID + face
 *     scan are still on file (accidental-reject signal), an extra
 *     "Verification Under Review" alert shows FIRST, then OK continues to
 *     the notice. First-time rejections keep the silent redirect.
 *
 * Attach it with a single `useVerificationDecisionWatcher()` call; the
 * module-level guards make it safe (no double alerts) even when several
 * stacked screens use it at once.
 */
export default function useVerificationDecisionWatcher() {
  const router = useRouter();

  useEffect(() => {
    let activeUserId: string | null = null;
    let unsubscribeDoc: (() => void) | null = null;

    const unsubscribeAuth = onAuthStateChanged(auth, (currentUser) => {
      const uid = currentUser?.uid ?? null;
      if (uid === activeUserId) {
        return;
      }

      // Account changed (sign-in / sign-out) — rewire the doc subscription.
      unsubscribeDoc?.();
      unsubscribeDoc = null;
      activeUserId = uid;

      if (!uid) {
        return;
      }

      unsubscribeDoc = onSnapshot(
        doc(db, "regular_user", uid),
        (snapshot) => {
          const data = snapshot.exists() ? snapshot.data() : undefined;
          if (!data) {
            return;
          }
          const status = String(data.verificationStatus ?? "");

          // ---- Realtime APPROVAL redirect ---------------------------------
          // The moment the admin approves this account ("pending" →
          // "verified") while the user sits on any verification screen, the
          // "Account Verified" alert takes them STRAIGHT Home — no
          // fullyverif stop in between (the alert is this session's
          // celebration). The one-time fullyverif marker is CONSUMED here so
          // the next login also goes directly Home instead of replaying the
          // celebration for an approval the user already acknowledged. The
          // approval fingerprint below keeps snapshot re-emissions (and
          // the duplicate listeners on stacked screens) from firing twice,
          // while still allowing a future reject → re-approve cycle to alert
          // again.
          if (status === "verified") {
            // Anchor the fingerprint to the ADMIN's own decision stamp,
            // `verifiedAt` (server-stamped on every approve, nulled on every
            // reject) — NEVER to `updatedAt`. `updatedAt` is bumped by our own
            // acknowledgement write below (`markFullyVerifiedNoticeSeen`) and
            // by the presence heartbeat every 2 minutes, so an
            // `updatedAt`-keyed guard rotated right after OK, the same
            // approval looked "new" again and the alert replayed forever.
            // `reapprovalCycle` only exists once the updated admin panel has
            // approved the account; it keeps legacy rows distinct and acts as
            // a tiebreaker when two approvals land in the same millisecond.
            const verifiedAt = data.verifiedAt as
              | { toMillis?: () => number }
              | null
              | undefined;
            const verifiedStamp =
              typeof verifiedAt?.toMillis === "function"
                ? String(verifiedAt.toMillis())
                : `legacy:${Number(data.reapprovalCycle) || 0}`;
            const approvalKey = `${uid}:${verifiedStamp}`;
            if (handledApprovalKey !== approvalKey) {
              handledApprovalKey = approvalKey;
              // Keep the gate-relevant AsyncStorage snapshot in step with the
              // live decision BEFORE navigating. The `/regular_user` layout
              // (app/regular_user/_layout.jsx) reads that snapshot cache-first;
              // while it still said "rejected" the freshly approved user was
              // bounced straight back into this hub — the OK → hub (checked) →
              // OK loop. Never throws; a storage failure only costs the
              // authoritative server re-check on Home.
              void saveVerificationCache(uid, data);
              // Re-approved existing user (explicit `wasReapproved` flag written
              // by the admin panel at approve time): they already celebrated
              // once, so they get the restrained "verified again" wording
              // instead of the first-approval welcome. A previously-verified
              // user approved by an OLDER admin build (no flag) keeps the
              // legacy empty body, and brand-new users still get the full
              // welcome text.
              const isExistingFullyVerifiedUser =
                data.fullyVerifiedNoticeSeenAt != null;
              const wasReapproved = data.wasReapproved === true;
              Alert.alert(
                "Account Verified",
                wasReapproved
                  ? "Your account has been verified again. Welcome back to PureDrop!"
                  : isExistingFullyVerifiedUser
                    ? ""
                    : "An admin has approved your verification. Welcome to PureDrop!",
                [
                  {
                    text: "OK",
                    onPress: () => {
                      // The user acknowledged THIS approval in-session — burn
                      // the one-time fullyverif ticket now (best-effort, never
                      // blocks navigation) so the next login skips it. Skipped
                      // for an account whose marker is already on the doc (an
                      // existing user who celebrated before): rewriting it
                      // only churns the document for nothing.
                      if (!isExistingFullyVerifiedUser) {
                        void (async () => {
                          try {
                            const { markFullyVerifiedNoticeSeen } = await import(
                              "../../login/backend/postEmailVerificationGate"
                            );
                            await markFullyVerifiedNoticeSeen(uid);
                          } catch {
                            // Non-fatal — worst case the login gate shows
                            // fullyverif once; never crash or trap.
                          }
                        })();
                      }
                      try {
                        // Dismiss any flow screens (camera/review) pushed
                        // above the hub first, so the user is actually taken
                        // Home instead of being left on a stale camera/review
                        // screen with Home only underneath it in the stack.
                        // Guarded: dismissAll() on a stack with nothing to
                        // dismiss emits POP_TO_TOP (dev-only warning) — and
                        // replace() alone already guarantees the landing, so
                        // the dismiss is best-effort only.
                        try {
                          if (router.canDismiss && router.canDismiss()) {
                            router.dismissAll();
                          }
                        } catch {
                          // Dismiss unsupported here — replace() below still lands Home.
                        }
                        router.replace(HOME_ROUTE);
                      } catch {
                        // Navigation must never crash the app.
                      }
                    },
                  },
                ],
              );
            }
          }

          // ---- Realtime REJECTION redirect --------------------------------
          // If the admin rejects this account's verification while the user
          // is on any verification screen, send them straight to the
          // rejection notice screen (same design as the email success
          // screen; final-warning text at 3 rejections). Mirrors the gate
          // logic in postEmailVerificationGate.ts: the notice fires for a
          // rejection the user has NOT acknowledged yet (seen count differs
          // from the current rejection count), so a user who already
          // acknowledged and came back to re-verify is not interrupted.
          //
          // ACCIDENTAL-REJECT case: the account was previously fully verified
          // (fullyVerifiedNoticeSeenAt is still set — the admin reject path
          // nulls verifiedAt but never clears the celebration marker) AND
          // both the Valid ID + face scan are still on file. That combo
          // strongly suggests the reject was a mistake, so show an
          // explanatory alert FIRST — then take them to the rejection notice
          // on OK. Genuine first-time rejections keep the existing silent
          // redirect (no extra popup).
          if (status === "rejected") {
            const parsedCount = Number(data.verificationRejectionCount);
            const rejectionCount =
              Number.isFinite(parsedCount) && parsedCount > 0
                ? Math.floor(parsedCount)
                : 0;

            // Absent field = never acknowledged any rejection notice (-1),
            // so even a legacy rejected account gets redirected once.
            const seenRaw = data.rejectedNoticeSeenCount;
            let seenCount = -1;
            if (seenRaw !== null && seenRaw !== undefined) {
              const parsedSeen = Number(seenRaw);
              if (Number.isFinite(parsedSeen)) {
                seenCount = Math.floor(parsedSeen);
              }
            }

            const rejectionKey = `${uid}:${rejectionCount}`;
            // The user acknowledged THIS rejection on the notice screen (they
            // pressed [Re-verify ID]) — honour the in-memory acknowledgement
            // immediately. The Firestore `rejectedNoticeSeenCount` write is
            // still in flight for a moment, and reading only the document made
            // the hub treat the rejection as fresh and re-pop the
            // "Verification Under Review" alert / bounce the user back to the
            // notice right after they chose to re-verify.
            const locallyAcknowledged =
              getLocallyAcknowledgedRejectionKey() === rejectionKey;
            if (
              seenCount !== rejectionCount &&
              !locallyAcknowledged &&
              handledRejectionKey !== rejectionKey
            ) {
              handledRejectionKey = rejectionKey;
              // Same cache-honesty rule as the approval branch: persist the
              // live rejection so the gate-relevant snapshot can never keep
              // claiming "verified" for an account the admin just rejected.
              void saveVerificationCache(uid, data);
              // Accidental-reject signal: previously fully verified (celebration
              // marker still present) + both Valid ID and face scan still on
              // file. Same markers the hub's useVerificationMainProgress uses.
              const wasPreviouslyVerified =
                data.fullyVerifiedNoticeSeenAt != null;
              const hasFaceOnFile = Boolean(
                data.faceScanUrl ?? data.faceScanPath ?? data.faceScanSubmittedAt,
              );
              const hasValidIdOnFile = Boolean(
                data.validIdFrontUrl ??
                  data.validIdFrontPath ??
                  data.validIdSubmittedAt,
              );
              // Admin-typed reason for THIS rejection. The previously-verified
              // popup below must tell the user WHY the account was rejected —
              // first-time (new user) rejections show the same text on the
              // rejection notice screen instead. Null when the admin left it
              // blank or the field is missing on legacy rejections.
              const reasonRaw = data.rejectionReason as string | null | undefined;
              const rejectionReason =
                typeof reasonRaw === "string" && reasonRaw.trim().length > 0
                  ? reasonRaw.trim()
                  : null;
              const rejectionReasonLine = rejectionReason
                ? `\n\nReason: ${rejectionReason}`
                : "";
              const goToRejectionNotice = () => {
                try {
                  // Same dismiss-first rule as the approval redirect: flow
                  // screens (camera/review) pushed above the hub must not
                  // survive the redirect into the rejection notice. Guarded:
                  // dismissAll() with nothing to dismiss emits POP_TO_TOP
                  // (dev-only warning) — replace() alone already guarantees
                  // the landing, so the dismiss is best-effort only.
                  try {
                    if (router.canDismiss && router.canDismiss()) {
                      router.dismissAll();
                    }
                  } catch {
                    // Dismiss unsupported here — replace() below still lands.
                  }
                  router.replace(REJECTED_NOTICE_ROUTE);
                } catch {
                  // Navigation must never crash the app — the user can still
                  // re-verify manually from here.
                }
              };
              if (wasPreviouslyVerified && hasFaceOnFile && hasValidIdOnFile) {
                Alert.alert(
                  "Verification Under Review",
                  `Your account was verified before with a valid ID and face scan on file. This rejection may have been accidental — please check the notice and re-verify only if needed.${rejectionReasonLine}`,
                  [{ text: "OK", onPress: goToRejectionNotice }],
                );
                return;
              }
              goToRejectionNotice();
            }
          }
        },
        () => {
          // Read failed (offline / permissions) — nothing to do here; each
          // screen keeps its own UI state and error handling.
        },
      );
    });

    return () => {
      unsubscribeAuth();
      unsubscribeDoc?.();
    };
  }, [router]);
}
