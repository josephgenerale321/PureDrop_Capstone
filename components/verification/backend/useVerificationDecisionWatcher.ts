import { useEffect, useRef } from "react";
import { Alert, AppState } from "react-native";
import { onAuthStateChanged } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { type Href, usePathname, useRouter } from "expo-router";
import {
  getLocallyAcknowledgedRejectionKey,
  hasPersistedRejectionAck,
} from "../../login/backend/postEmailVerificationGate";
import { saveVerificationCache } from "../../main_layout/offline_profile_cache";
import {
  buildApprovalKey,
  buildApprovalMessage,
  buildRejectionKey,
  parseRejectionCounts,
  shouldHandleApproval,
  shouldHandleRejection,
} from "./verificationDecisionRules";
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

// UID whose FIRST doc snapshot has already been consumed as a seed this app
// run. MODULE level (not effect level) on purpose: a remount or re-subscribe of
// the SAME account must not re-classify a snapshot as "the state before I
// attached", or a genuinely new approval landing during that gap would be
// swallowed instead of announced. Reset only on an ACCOUNT change (in the auth
// listener), because the previous account's decision must never judge the next
// account's first snapshot — `handledApprovalKey` is a single slot and would
// otherwise make a switch back to an old account replay its approval.
let seededDecisionUid: string | null = null;

// ---------------------------------------------------------------------------
// Foreground state + a stashed "Account Verified" presentation.
//
// `Alert.alert` on a backgrounded app is dropped or deferred by the OS, but
// `handledApprovalKey` is consumed the moment we decide to show it — so the
// popup would be lost forever. Instead the presentation is parked here and
// flushed the instant the app is active again. (The meantime is covered by the
// OS push path — see `verificationPushSync`, which only fires while
// backgrounded.)
// ---------------------------------------------------------------------------
const appStateActive = { current: true };
let pendingApprovalPresentation: (() => void) | null = null;

/** Runs a stashed presentation, if any. Idempotent — first caller wins. */
function flushPendingApprovalPresentation(): void {
  const present = pendingApprovalPresentation;
  if (!present) {
    return;
  }
  pendingApprovalPresentation = null;
  present();
}

/**
 * Realtime admin decision watcher for the verification flow.
 *
 * Subscribes to the signed-in user's `regular_user` document and reacts to
 * admin decisions made from the admin panel WHILE the user is on ANY
 * verification screen (hub, face selfie, Valid ID, camera, review):
 *
 *   - Approved ("pending" → "verified"): shows the "Account Verified" alert
 *     and takes the user straight Home (a SINGLE replace(), so the redirect
 *     can never be dropped — see the handler for why dismissAll()+replace is
 *     forbidden here). The alert only fires for a transition seen WHILE
 *     watching: the first snapshot per account is consumed as a seed, so an
 *     account that was already verified before this watcher attached (account
 *     switch on the same device, a fail-closed gate fallback, the "Verify
 *     Identity" card on Home) never replays the popup. The one-time fullyverif
 *     marker is consumed at the same time, so the next login also goes directly
 *     Home instead of replaying the celebration for an already-acknowledged
 *     approval. Re-approved users (`wasReapproved` flag written by the admin
 *     panel) get the restored-verification wording, while brand-new users get
 *     the full "Welcome to PureDrop!" text. The empty string is kept only as a
 *     fallback for a previously-verified user whose approval carries no
 *     re-approval flag (e.g. a doc written by an older admin build). While the
 *     app is backgrounded the presentation is parked (see
 *     `pendingApprovalPresentation`) and shown on the next foreground rather
 *     than dropped by the OS.
 *   - Rejected ("rejected" with an unacknowledged rejection count): redirects
 *     to the rejection notice screen (same gate as the login flow — the
 *     notice only fires for a rejection the user has NOT acknowledged yet).
 *     The acknowledgement comes from THREE in-session sources plus a PERSISTED
 *     AsyncStorage marker (see `hasPersistedRejectionAck`), so a Firestore
 *     write that was offline when the app closed can never replay the notice.
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
  const pathname = usePathname();
  // Live path behind a ref: the snapshot handler closes over values from the
  // render it was created in, and `pathname` changes on every navigation —
  // adding it to the effect deps would re-subscribe the Firestore listener
  // (and re-consume the seed) on every screen change.
  const pathnameRef = useRef(pathname);
  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  useEffect(() => {
    let activeUserId: string | null = null;
    let unsubscribeDoc: (() => void) | null = null;

    // SINGLE replace() with an "am I already there?" guard: a stacked listener
    // must not re-run a replace() that re-mounts the screen already showing —
    // and never dismissAll()+replace back to back (see the OK handler below).
    // Defined inside the effect on purpose: it only closes over the stable
    // `pathnameRef` + `router`, so the effect never has to re-subscribe.
    const goTo = (target: Href): void => {
      if (pathnameRef.current === target) {
        return;
      }
      try {
        router.replace(target);
      } catch {
        // Navigation must never crash the app.
      }
    };

    // Foreground tracking for the stashed "Account Verified" presentation —
    // see `pendingApprovalPresentation` above. Registered per mounted watcher;
    // the flush is idempotent, so stacked listeners are harmless.
    const appStateSubscription = AppState.addEventListener("change", (nextState) => {
      const active = nextState === "active";
      appStateActive.current = active;
      if (active) {
        flushPendingApprovalPresentation();
      }
    });

    const unsubscribeAuth = onAuthStateChanged(auth, (currentUser) => {
      const uid = currentUser?.uid ?? null;
      if (uid === activeUserId) {
        return;
      }

      // Account changed (sign-in / sign-out) — rewire the doc subscription.
      unsubscribeDoc?.();
      unsubscribeDoc = null;
      activeUserId = uid;
      // A DIFFERENT account always gets its own "already in this state?"
      // baseline (its first snapshot must never be judged against the previous
      // account's decision). A same-uid re-fire never reaches here — see the
      // `uid === activeUserId` guard above — so a remount of the SAME account
      // keeps its seed and can't swallow a decision that lands in the gap.
      seededDecisionUid = null;

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
          // The first snapshot per account only records where the account
          // already stood; every snapshot after it is a live change we may
          // react to (mirrors `seededStatus` in verificationPushSync).
          const isSeedSnapshot = seededDecisionUid !== uid;
          if (isSeedSnapshot) {
            seededDecisionUid = uid;
          }

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
            // Fingerprints and the seed/dedupe decision live in
            // `verificationDecisionRules.ts` so they can be unit-tested — the
            // stamp is the ADMIN's own `verifiedAt` (server-stamped on every
            // approve, nulled on every reject), NEVER `updatedAt`: that field
            // is bumped by our own acknowledgement write below
            // (`markFullyVerifiedNoticeSeen`) and by the presence heartbeat
            // every 2 minutes, so an `updatedAt`-keyed guard rotated right
            // after OK and the same approval replayed forever. `reapprovalCycle`
            // only exists once the updated admin panel has approved the
            // account; it keeps legacy rows distinct and acts as a tiebreaker
            // when two approvals land in the same millisecond.
            const approvalKey = buildApprovalKey(uid, data);
            if (isSeedSnapshot) {
              // The account was ALREADY verified when this watcher attached —
              // there is no new decision to announce. Record the fingerprint
              // so stacked screens and later snapshots stay silent, but never
              // pop the "Account Verified" alert (and never run its redirect)
              // for an approval the user saw long ago. The doc we just read is
              // still fresh, so keep the gate snapshot in step with it.
              handledApprovalKey = approvalKey;
              void saveVerificationCache(uid, data);
              return;
            }
            if (
              shouldHandleApproval({
                isSeedSnapshot,
                approvalKey,
                handledApprovalKey,
              })
            ) {
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
              // Message wording is a pure rule — see `buildApprovalMessage`.
              const approvalMessage = buildApprovalMessage(data);
              const presentApproval = (): void => {
                Alert.alert("Account Verified", approvalMessage, [
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
                      goTo(HOME_ROUTE);
                    },
                  },
                ]);
              };
              // Backgrounded: `Alert.alert` would be dropped by the OS while
              // `handledApprovalKey` is already consumed — park the
              // presentation instead and flush it on the next foreground
              // (the OS push path covers the meantime).
              if (!appStateActive.current) {
                pendingApprovalPresentation = presentApproval;
                return;
              }
              presentApproval();
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
            const { rejectionCount, seenCount } = parseRejectionCounts(data);
            const rejectionKey = buildRejectionKey(uid, rejectionCount);
            // The user acknowledged THIS rejection on the notice screen (they
            // pressed [Re-verify ID]) — honour the in-memory acknowledgement
            // immediately. The Firestore `rejectedNoticeSeenCount` write is
            // still in flight for a moment, and reading only the document made
            // the hub treat the rejection as fresh and re-pop the
            // "Verification Under Review" alert / bounce the user back to the
            // notice right after they chose to re-verify.
            const locallyAcknowledged =
              getLocallyAcknowledgedRejectionKey() === rejectionKey;
            // Idempotency has THREE independent sources — see
            // `shouldHandleRejection`: this run's `handledRejectionKey` (snapshot
            // re-emissions + stacked listeners), the in-memory ack above, and the
            // document's own `seenCount`. The persisted ack is checked after the
            // claim, because the document can be stale when that write was
            // offline — which is exactly what used to replay this popup on the
            // next run.
            if (
              shouldHandleRejection({
                rejectionKey,
                handledRejectionKey,
                rejectionCount,
                seenCount,
                locallyAcknowledged,
              })
            ) {
              // Claim BEFORE the async check below: a stacked listener must not
              // start a second check (and a second popup) for this decision.
              handledRejectionKey = rejectionKey;
              // Same cache-honesty rule as the approval branch: persist the
              // live rejection so the gate-relevant snapshot can never keep
              // claiming "verified" for an account the admin just rejected.
              void saveVerificationCache(uid, data);
              void (async () => {
                // Durable ack from a PREVIOUS run: this rejection was already
                // shown and acknowledged on this device, but the Firestore
                // counter never landed (offline / app killed), so `seenCount`
                // above still claims UNacknowledged. A read failure keeps the
                // old behaviour — treat as unacknowledged.
                try {
                  if (await hasPersistedRejectionAck(uid, rejectionCount)) {
                    return;
                  }
                } catch {
                  // Non-fatal.
                }
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
                  // SINGLE replace() — see `goTo` at the top of this hook: a
                  // dismissAll() queued right before the replace() makes the
                  // REPLACE action target a navigator POP_TO_TOP already tore
                  // down, so it is dropped and the user is stranded on the root
                  // welcome route ("Welcome to PureDrop" / Get Started) instead
                  // of the rejection notice. Landing here is the guarantee.
                  goTo(REJECTED_NOTICE_ROUTE);
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
              })();
            }
          }
        },
        () => {
          // Read failed (offline / permissions) — nothing to do here; each
          // screen keeps its own UI state and error handling. Log it in dev
          // only: a silently dead subscription is indistinguishable from "the
          // admin never decided anything".
          if (typeof __DEV__ !== "undefined" && __DEV__) {
            console.warn(`[decision-watcher] regular_user snapshot error uid=${uid}`);
          }
        },
      );
    });

    return () => {
      unsubscribeAuth();
      unsubscribeDoc?.();
      appStateSubscription.remove();
    };
  }, [router]);
}
