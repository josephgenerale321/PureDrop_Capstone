import assert from "node:assert/strict";
import test from "node:test";

import {
  buildApprovalKey,
  buildApprovalMessage,
  buildRejectionKey,
  parseRejectionCounts,
  shouldHandleApproval,
  shouldHandleRejection,
} from "../components/verification/backend/verificationDecisionRules.ts";

// ---------------------------------------------------------------------------
// Fingerprints
// ---------------------------------------------------------------------------

test("buildApprovalKey anchors on the admin's verifiedAt stamp", () => {
  const data = { verifiedAt: { toMillis: () => 1_700_000_000_000 } };
  assert.equal(buildApprovalKey("uidA", data), "uidA:1700000000000");
});

test("buildApprovalKey falls back to the reapproval cycle for legacy rows", () => {
  assert.equal(buildApprovalKey("uidA", {}), "uidA:legacy:0");
  assert.equal(buildApprovalKey("uidA", { reapprovalCycle: 3 }), "uidA:legacy:3");
  // Non-numeric cycles must not produce "NaN" keys (that would make every
  // legacy account's snapshots collide).
  assert.equal(buildApprovalKey("uidA", { reapprovalCycle: "x" }), "uidA:legacy:0");
});

test("buildApprovalKey is uid-scoped so accounts never share a fingerprint", () => {
  const data = { verifiedAt: { toMillis: () => 42 } };
  assert.notEqual(buildApprovalKey("uidA", data), buildApprovalKey("uidB", data));
});

test("buildRejectionKey is uid + count", () => {
  assert.equal(buildRejectionKey("uidA", 2), "uidA:2");
  assert.notEqual(buildRejectionKey("uidA", 1), buildRejectionKey("uidA", 2));
});

// ---------------------------------------------------------------------------
// Rejection counters
// ---------------------------------------------------------------------------

test("parseRejectionCounts treats absent fields as fresh / never acknowledged", () => {
  assert.deepEqual(parseRejectionCounts({}), { rejectionCount: 0, seenCount: -1 });
});

test("parseRejectionCounts does not read null as 0 seen", () => {
  // `Number(null) === 0` — without the explicit guard a legacy rejected
  // account would look like "acknowledged 0 times" instead of "never".
  assert.deepEqual(
    parseRejectionCounts({
      verificationRejectionCount: 1,
      rejectedNoticeSeenCount: null,
    }),
    { rejectionCount: 1, seenCount: -1 }
  );
});

test("parseRejectionCounts normalises unusable counters", () => {
  assert.deepEqual(
    parseRejectionCounts({
      verificationRejectionCount: -5,
      rejectedNoticeSeenCount: "abc",
    }),
    { rejectionCount: 0, seenCount: -1 }
  );
  assert.deepEqual(
    parseRejectionCounts({
      verificationRejectionCount: 2.9,
      rejectedNoticeSeenCount: 2.9,
    }),
    { rejectionCount: 2, seenCount: 2 }
  );
});

// ---------------------------------------------------------------------------
// Approval guard — the "Account Verified" popup replay
// ---------------------------------------------------------------------------

test("an already-verified account's seed snapshot never fires the popup", () => {
  // Regression: an existing verified user landing on a verification screen
  // (account switch, fail-closed gate fallback, Home's Verify Identity card)
  // replayed the popup for an approval from days ago.
  assert.equal(
    shouldHandleApproval({
      isSeedSnapshot: true,
      approvalKey: "uidA:1700000000000",
      handledApprovalKey: null,
    }),
    false
  );
});

test("the first genuinely NEW approval fires exactly once", () => {
  assert.equal(
    shouldHandleApproval({
      isSeedSnapshot: false,
      approvalKey: "uidA:1700000000000",
      handledApprovalKey: null,
    }),
    true
  );
  // Snapshot re-emission / a stacked screen's own listener — same key.
  assert.equal(
    shouldHandleApproval({
      isSeedSnapshot: false,
      approvalKey: "uidA:1700000000000",
      handledApprovalKey: "uidA:1700000000000",
    }),
    false
  );
  // A later reject → re-approve cycle carries a NEW verifiedAt → fires again.
  assert.equal(
    shouldHandleApproval({
      isSeedSnapshot: false,
      approvalKey: "uidA:1700000099999",
      handledApprovalKey: "uidA:1700000000000",
    }),
    true
  );
});

// ---------------------------------------------------------------------------
// Rejection guard — the "Verification Under Review" replay
// ---------------------------------------------------------------------------

test("an unacknowledged NEW rejection fires", () => {
  assert.equal(
    shouldHandleRejection({
      rejectionKey: "uidA:1",
      handledRejectionKey: null,
      rejectionCount: 1,
      seenCount: 0,
      locallyAcknowledged: false,
    }),
    true
  );
});

test("a rejection stays silent once any of the three ack sources says so", () => {
  const base = {
    rejectionKey: "uidA:1",
    rejectionCount: 1,
    seenCount: 0,
    locallyAcknowledged: false,
  };
  // Handled already this run (snapshot re-emission / stacked listeners).
  assert.equal(
    shouldHandleRejection({ ...base, handledRejectionKey: "uidA:1" }),
    false
  );
  // In-memory ack while the Firestore write is still in flight.
  assert.equal(shouldHandleRejection({ ...base, locallyAcknowledged: true }), false);
  // The document already recorded the acknowledgement.
  assert.equal(
    shouldHandleRejection({ ...base, handledRejectionKey: null, seenCount: 1 }),
    false
  );
  // A DIFFERENT (older) rejection being handled must not mask a new one.
  assert.equal(
    shouldHandleRejection({ ...base, handledRejectionKey: "uidA:0" }),
    true
  );
});

// ---------------------------------------------------------------------------
// Alert wording
// ---------------------------------------------------------------------------

test("buildApprovalMessage picks the wording by re-approval / celebration state", () => {
  // Re-approved wins even when the celebration marker is present.
  assert.equal(
    buildApprovalMessage({ wasReapproved: true, fullyVerifiedNoticeSeenAt: {} }),
    "Your account has been verified again. Welcome back to PureDrop!"
  );
  // Previously verified, older admin build (no flag) → legacy empty body.
  assert.equal(buildApprovalMessage({ fullyVerifiedNoticeSeenAt: {} }), "");
  // Brand-new user → the full welcome text.
  assert.equal(
    buildApprovalMessage({}),
    "An admin has approved your verification. Welcome to PureDrop!"
  );
});
