import {
  collection,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../../firebaseConfig";

const USERS_COLLECTION = "regular_user";
const COUNTERS_COLLECTION = "counters";
const SEQUENTIAL_ID_COUNTER_ID = "regularUserSequentialId";

/**
 * Reads a previously stored sequential display ID from a user document.
 * Only positive integers count — anything else means "no ID assigned yet".
 */
export const readStoredSequentialId = (
  data?: { sequentialId?: unknown } | null,
): number | null => {
  const value = data?.sequentialId;
  return typeof value === "number" && Number.isInteger(value) && value >= 1
    ? value
    : null;
};

const readCounterNext = (data?: { next?: unknown } | null): number | null => {
  const value = data?.next;
  return typeof value === "number" && Number.isInteger(value) && value >= 1
    ? value
    : null;
};

const readHighestStoredSequentialId = (
  docs: { data: () => unknown }[],
): number | null => {
  let highest: number | null = null;
  for (const docSnap of docs) {
    const stored = readStoredSequentialId(
      docSnap.data() as { sequentialId?: unknown },
    );
    if (stored !== null && (highest === null || stored > highest)) {
      highest = stored;
    }
  }
  return highest;
};

const readSeededNextId = async (): Promise<number> => {
  const topSnap = await getDocs(
    query(
      collection(db, USERS_COLLECTION),
      orderBy("sequentialId", "desc"),
      limit(1),
    ),
  );
  return (readHighestStoredSequentialId(topSnap.docs) ?? 0) + 1;
};

/**
 * Reserve the next sequential display ID (1, 2, 3...) WITHOUT creating or
 * touching any user document. Used during signup: the ID is claimed first,
 * then written as part of the profile's initial setDoc — so the profile is
 * born with its final ID and no stub document ever exists.
 *
 * The counter bump is atomic (Firestore transaction), so two simultaneous
 * signups can never receive the same ID.
 */
export const reserveSequentialUserId = async (): Promise<number> => {
  const counterRef = doc(db, COUNTERS_COLLECTION, SEQUENTIAL_ID_COUNTER_ID);

  // Legacy databases (created before the counter existed) seed from the
  // highest stored sequentialId. Transactions cannot run queries, so the
  // seed is read BEFORE the transaction and only used when the counter doc
  // still does not exist inside the transaction. Racing first-claims retry
  // and converge on the same counter value.
  const seededNext = await readSeededNextId();

  return runTransaction(db, async (transaction) => {
    const counterSnap = await transaction.get(counterRef);
    const counterNext = readCounterNext(
      counterSnap.data() as { next?: unknown } | undefined,
    );

    const next = counterNext ?? seededNext;
    transaction.set(
      counterRef,
      { next: next + 1, updatedAt: serverTimestamp() },
      { merge: true },
    );

    return next;
  });
};

/**
 * Claims (and persists) the sequential display ID for an EXISTING user
 * document — the self-heal path for legacy accounts created before this
 * feature. Throws when the user doc does not exist, so signup (which writes
 * the ID as part of profile creation) can never accidentally create stub
 * documents.
 *
 * Idempotent: a doc that already has an ID keeps it; the counter is only
 * fast-forwarded when it lags behind.
 */
export const claimSequentialUserId = async (uid: string): Promise<number> => {
  const userRef = doc(db, USERS_COLLECTION, uid);
  const counterRef = doc(db, COUNTERS_COLLECTION, SEQUENTIAL_ID_COUNTER_ID);

  const seededNext = await readSeededNextId();

  return runTransaction(db, async (transaction) => {
    const userDocSnap = await transaction.get(userRef);
    if (!userDocSnap.exists()) {
      throw new Error(
        "Cannot claim a sequential ID for a user document that does not exist.",
      );
    }
    const existing = readStoredSequentialId(
      userDocSnap.data() as { sequentialId?: unknown } | undefined,
    );
    const counterSnap = await transaction.get(counterRef);
    const counterNext = readCounterNext(
      counterSnap.data() as { next?: unknown } | undefined,
    );

    // A doc that already owns an ID always keeps it — the counter is only
    // fast-forwarded when it lags behind, and never moves backwards.
    // This keeps IDs 1, 2, 3... permanent even if the counter doc was
    // deleted or restored from a stale backup.
    if (existing !== null) {
      if (counterNext === null || counterNext <= existing) {
        transaction.set(
          counterRef,
          { next: existing + 1, updatedAt: serverTimestamp() },
          { merge: true },
        );
      }
      return existing;
    }

    const next = counterNext ?? seededNext;
    transaction.set(
      counterRef,
      { next: next + 1, updatedAt: serverTimestamp() },
      { merge: true },
    );
    transaction.set(
      userRef,
      { sequentialId: next, updatedAt: serverTimestamp() },
      { merge: true },
    );

    return next;
  });
};
