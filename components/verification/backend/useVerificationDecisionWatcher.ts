import { useEffect } from "react";
import { Alert } from "react-native";
import { onAuthStateChanged } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { type Href, useRouter } from "expo-router";
import { auth, db } from "../../../firebaseConfig";

// Verified users' destination — when the admin approves a "pending" account
// while the user sits anywhere in the verification flow, take them Home.
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
// (uid + document updatedAt) so snapshot re-emissions of the same write can
// never fire twice, while a later reject → re-approve cycle (a NEW updatedAt)
// can fire again.
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
 *     and takes the user Home (dismissAll + replace, so no stale flow screen
 *     survives underneath).
 *   - Rejected ("rejected" with an unacknowledged rejection count): redirects
 *     to the rejection notice screen (same gate as the login flow — the
 *     notice only fires for a rejection the user has NOT acknowledged yet).
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
          // "verified") while the user sits on any verification screen, take
          // them into the app. The updatedAt fingerprint keeps snapshot
          // re-emissions (and the duplicate listeners on stacked screens)
          // from firing twice, while still allowing a future reject →
          // re-approve cycle to alert again.
          if (status === "verified") {
            const updatedAt = data.updatedAt as
              | { toMillis?: () => number }
              | null
              | undefined;
            const stamp =
              typeof updatedAt?.toMillis === "function"
                ? String(updatedAt.toMillis())
                : "none";
            const approvalKey = `${uid}:${stamp}`;
            if (handledApprovalKey !== approvalKey) {
              handledApprovalKey = approvalKey;
              Alert.alert(
                "Account Verified",
                "An admin has approved your verification. Welcome to PureDrop!",
                [
                  {
                    text: "OK",
                    onPress: () => {
                      try {
                        // Dismiss any flow screens (camera/review) pushed
                        // above the hub first, so the user is actually taken
                        // Home instead of being left on a stale camera/review
                        // screen with Home only underneath it in the stack.
                        router.dismissAll();
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
            if (
              seenCount !== rejectionCount &&
              handledRejectionKey !== rejectionKey
            ) {
              handledRejectionKey = rejectionKey;
              try {
                // Same dismiss-first rule as the approval redirect: flow
                // screens (camera/review) pushed above the hub must not
                // survive the redirect into the rejection notice.
                router.dismissAll();
                router.replace(REJECTED_NOTICE_ROUTE);
              } catch {
                // Navigation must never crash the app — the user can still
                // re-verify manually from here.
              }
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
