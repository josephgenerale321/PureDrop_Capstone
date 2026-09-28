/**
 * Pure decision rules for the realtime verification decision watcher
 * (`components/verification/backend/useVerificationDecisionWatcher.ts`).
 *
 * Everything here is a plain function over the `regular_user` document fields —
 * no React, no Firebase, no navigation — so the "exactly ONE reaction per
 * admin decision" guards can be exercised directly. Covered by
 * `scripts/verificationDecisionRules.test.mjs` (`npm test`, node:test).
 *
 * Keep it that way: a new guard belongs HERE first, then gets wired into the
 * hook. That is what stopped the "Account Verified" popup replaying for an
 * account that was already verified (seed guard) and what keeps a
 * reject → re-approve cycle from collapsing into one fingerprint.
 */

/** The slice of the doc the approval fingerprint is built from. */
export type ApprovalStampSource = {
  /** Server stamp — present on every approve, nulled on every reject. */
  verifiedAt?: { toMillis?: () => number } | null;
  /** Only exists once the updated admin panel has approved; legacy tiebreaker. */
  reapprovalCycle?: unknown;
};

/**
 * Fingerprint of ONE approval: `uid` + the ADMIN's own `verifiedAt` stamp.
 *
 * Deliberately NEVER `updatedAt`: that field is bumped by our own
 * acknowledgement write (`markFullyVerifiedNoticeSeen`) and by the presence
 * heartbeat, so an `updatedAt`-keyed guard rotated right after OK and the same
 * approval looked "new" again — replaying the popup forever.
 */
export function buildApprovalKey(uid: string, data: ApprovalStampSource): string {
  const verifiedAt = data.verifiedAt;
  const verifiedStamp =
    typeof verifiedAt?.toMillis === "function"
      ? String(verifiedAt.toMillis())
      : `legacy:${Number(data.reapprovalCycle) || 0}`;
  return `${uid}:${verifiedStamp}`;
}

/** Fingerprint of ONE rejection: `uid` + the current rejection count. */
export function buildRejectionKey(uid: string, rejectionCount: number): string {
  return `${uid}:${rejectionCount}`;
}

export type RejectionCounts = {
  /** Current rejection count — 0 when the field is absent / unusable. */
  rejectionCount: number;
  /**
   * How many rejection notices the account acknowledged, or -1 when the field
   * is absent (legacy rows: "never acknowledged"), so even a legacy rejected
   * account gets redirected once.
   */
  seenCount: number;
};

/** Parses the two rejection counters out of a `regular_user` doc. */
export function parseRejectionCounts(data: {
  verificationRejectionCount?: unknown;
  rejectedNoticeSeenCount?: unknown;
}): RejectionCounts {
  const parsedCount = Number(data.verificationRejectionCount);
  const rejectionCount =
    Number.isFinite(parsedCount) && parsedCount > 0 ? Math.floor(parsedCount) : 0;

  let seenCount = -1;
  const seenRaw = data.rejectedNoticeSeenCount;
  // Explicit null/undefined guard: `Number(null)` is 0, which would otherwise
  // misread "never acknowledged" as "acknowledged 0 times".
  if (seenRaw !== null && seenRaw !== undefined) {
    const parsedSeen = Number(seenRaw);
    if (Number.isFinite(parsedSeen)) {
      seenCount = Math.floor(parsedSeen);
    }
  }

  return { rejectionCount, seenCount };
}

/**
 * Should this snapshot fire the "Account Verified" alert?
 *
 * The FIRST snapshot per account is a SEED: it is the state the account was
 * already in when the watcher attached, not a decision made while watching —
 * an already-verified account must never replay the popup (or its redirect).
 * After that, the module-level `handledApprovalKey` dedupes snapshot
 * re-emissions and the duplicate listeners on stacked screens, while a later
 * reject → re-approve cycle (a NEW `verifiedAt`) fires again.
 */
export function shouldHandleApproval(params: {
  isSeedSnapshot: boolean;
  approvalKey: string;
  handledApprovalKey: string | null;
}): boolean {
  if (params.isSeedSnapshot) {
    return false;
  }
  return params.handledApprovalKey !== params.approvalKey;
}

/**
 * Should this snapshot fire the rejection notice (or the "Verification Under
 * Review" alert before it)?
 *
 * Three independent reasons to stay silent — all of which must be false:
 *  - `handledRejectionKey`: this very rejection was already handled this run
 *    (snapshot re-emissions + stacked listeners);
 *  - `locallyAcknowledged`: the user pressed [Re-verify ID] and the Firestore
 *    write is still in flight;
 *  - `seenCount === rejectionCount`: the account already recorded the
 *    acknowledgement.
 *
 * The caller still consults the PERSISTED ack afterwards: the Firestore write
 * can be offline, leaving `seenCount` stale for the next run.
 */
export function shouldHandleRejection(params: {
  rejectionKey: string;
  handledRejectionKey: string | null;
  rejectionCount: number;
  seenCount: number;
  locallyAcknowledged: boolean;
}): boolean {
  if (params.handledRejectionKey === params.rejectionKey) {
    return false;
  }
  if (params.locallyAcknowledged) {
    return false;
  }
  return params.seenCount !== params.rejectionCount;
}

/**
 * Body of the "Account Verified" alert. Re-approved users (explicit admin
 * `wasReapproved` flag) get the restrained wording; a previously-verified user
 * approved by an OLDER admin build (no flag) keeps the legacy empty body; only
 * brand-new users get the full welcome text.
 */
export function buildApprovalMessage(data: {
  fullyVerifiedNoticeSeenAt?: unknown;
  wasReapproved?: unknown;
}): string {
  if (data.wasReapproved === true) {
    return "Your account has been verified again. Welcome back to PureDrop!";
  }
  if (data.fullyVerifiedNoticeSeenAt != null) {
    return "";
  }
  return "An admin has approved your verification. Welcome to PureDrop!";
}
