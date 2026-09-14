import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { auth, db } from "../../../../firebaseConfig";

export interface VerificationMainProgress {
  userEmail: string | null;
  hasFaceScan: boolean;
  hasValidId: boolean;
  // Live verificationStatus ("awaiting_id" / "pending" / "verified" /
  // "rejected") — drives the pending-admin-review banner.
  verificationStatus: string;
  // Which part the admin's rejection applied to ("valid_id" / "face_scan" /
  // "both") — drives which submitted card shows the red X after a rejection.
  // Absent field (legacy rows) behaves as "both".
  rejectionTarget: string;
  // The submitted ID category (e.g. "Philippine National ID (PhilID)") — shown
  // as a subtitle on the "Verify your id" card.
  validIdType: string | null;
}

// Live verification progress — subscribes to the signed-in user's document
// so the check marks reflect submissions made from the face / Valid ID
// flows instantly (including when this screen regains focus afterwards).
// Extracted verbatim from VerificationMainScreen: auth tracking + onSnapshot
// of the `regular_user` doc. No routing side-effects — the hub must never
// auto-navigate (an unverified user is SUPPOSED to sit here).
export default function useVerificationMainProgress(): VerificationMainProgress {
  const [userEmail, setUserEmail] = useState<string | null>(null);
  // Signed-in user id — drives the verification-progress subscription below
  // (the check marks on the Face Recognition / Verify your id cards).
  const [userId, setUserId] = useState<string | null>(null);
  // Verification progress read from the user's `regular_user` document:
  //   hasFaceScan — a face scan (selfie) is on file
  //   hasValidId  — a Valid ID has been submitted
  const [hasFaceScan, setHasFaceScan] = useState(false);
  const [hasValidId, setHasValidId] = useState(false);
  const [verificationStatus, setVerificationStatus] = useState<string>("");
  const [rejectionTarget, setRejectionTarget] = useState<string>("both");
  const [validIdType, setValidIdType] = useState<string | null>(null);

  // Track the live Firebase session so the banner always shows the account
  // that is actually signed in on this device (and updates if it changes).
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUserEmail(currentUser?.email ?? null);
      setUserId(currentUser?.uid ?? null);
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!userId) {
      setHasFaceScan(false);
      setHasValidId(false);
      setValidIdType(null);
      return undefined;
    }

    const unsubscribe = onSnapshot(
      doc(db, "regular_user", userId),
      (snapshot) => {
        const data = snapshot.exists() ? snapshot.data() : undefined;
        setHasFaceScan(
          Boolean(data?.faceScanUrl ?? data?.faceScanPath ?? data?.faceScanSubmittedAt),
        );
        setHasValidId(Boolean(data?.validIdFrontUrl ?? data?.validIdSubmittedAt));
        setValidIdType(
          typeof data?.validIdType === "string" && data.validIdType.length > 0
            ? data.validIdType
            : null,
        );
        const status = String(data?.verificationStatus ?? "");
        setVerificationStatus(status);

        // Which part the admin rejected — only the rejected card(s) show the
        // red X (defaults to "both" for legacy rows without the field).
        const rawTarget = data?.rejectionTarget;
        setRejectionTarget(
          rawTarget === "valid_id" || rawTarget === "face_scan"
            ? rawTarget
            : "both",
        );

        // Approval / rejection decisions are handled by the shared
        // useVerificationDecisionWatcher hook so the hub and every other
        // screen in the flow react to an admin decision the same way — and
        // only ONE alert / redirect ever fires per decision.
      },
      () => {
        // Read failed (offline / permissions) — hide the checks; the cards
        // stay tappable either way.
        setHasFaceScan(false);
        setHasValidId(false);
        setValidIdType(null);
        setVerificationStatus("");
      },
    );

    return unsubscribe;
  }, [userId]);

  return {
    userEmail,
    hasFaceScan,
    hasValidId,
    verificationStatus,
    rejectionTarget,
    validIdType,
  };
}
