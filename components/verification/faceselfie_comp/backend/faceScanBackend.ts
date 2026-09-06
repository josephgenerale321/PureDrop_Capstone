import { deleteField, doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { auth, db } from "../../../../firebaseConfig";
import {
  removeVerificationPhoto,
  uploadVerificationPhoto,
} from "./verificationUpload";
// Type-only import — erased at compile time, so this never pulls the
// native-only vision-camera module graph into the web bundle.
import type { LivenessCheck } from "../selfiecapture/backend/selfiecaptfunc";

/**
 * Face-scan submission backend for the Face Scan Details review screen
 * (app/verification/face_selfie/cameraface_selfie/reviewselfiedetails.tsx).
 *
 * Uploads the captured selfie to Supabase Storage at
 * verification/{userId}/selfie.jpg and records the result on the signed-in
 * user's `regular_user` Firestore document:
 *
 *   faceScanUrl / faceScanPath   - public URL + storage path of the selfie
 *   livenessPassed               - the capture screen only lets a live,
 *                                  detected face through, so this is true
 *   faceScanSubmittedAt          - server timestamp of the submission
 *   verificationStatus           - set to "awaiting_id" only when the account
 *                                  has no status yet (selfie done, ID still
 *                                  missing). An existing "pending" /
 *                                  "verified" / "rejected" status is kept so
 *                                  a resubmission never erases an admin
 *                                  decision.
 *
 * Firestore fields mirror the face-scan plan
 * (docs/face_scan_verification_plan september 1.docx / 5.2).
 */

// Verification statuses understood by the admin panel. "awaiting_id" means
// the face scan is in but the Valid ID is still missing.
const RESPECTED_STATUSES = new Set(["pending", "verified", "rejected", "awaiting_id"]);

export type FaceScanSubmissionResult = {
  faceScanUrl: string;
  faceScanPath: string;
};

/**
 * Submits the captured selfie for the signed-in user. `livenessScore` is the
 * 0–100 quality score computed on-device from the captured photo's face
 * metrics and `livenessChecks` the per-check results behind it (both
 * null/undefined = not available, not recorded). Throws with a
 * user-presentable message on failure (no upload, no Firestore write).
 */
export async function submitFaceScan({
  photoUri,
  livenessScore,
  livenessChecks,
}: {
  photoUri: string;
  livenessScore?: number | null;
  livenessChecks?: LivenessCheck[] | null;
}): Promise<FaceScanSubmissionResult> {
  const user = auth.currentUser;
  if (!user?.uid) {
    throw new Error("You need to be signed in to submit your face scan.");
  }

  const path = `verification/${user.uid}/selfie.jpg`;
  const faceScanUrl = await uploadVerificationPhoto(photoUri, path);

  try {
    const userDocRef = doc(db, "regular_user", user.uid);
    const snapshot = await getDoc(userDocRef);
    const currentStatus = snapshot.exists()
      ? snapshot.data().verificationStatus
      : undefined;

    const updates: Record<string, unknown> = {
      faceScanUrl,
      faceScanPath: path,
      livenessPassed: true,
      faceScanSubmittedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    // Record the on-device liveness score when one was computed — the admin
    // panel (and the submitted-view review screen) can read it alongside
    // livenessPassed.
    if (typeof livenessScore === "number" && Number.isFinite(livenessScore)) {
      updates.livenessScore = Math.round(Math.min(100, Math.max(0, livenessScore)));
    }

    // Record the per-check liveness results (eyes open / facing the camera /
    // good distance) so the submitted-view screen and admin panel can show
    // WHAT was verified, not only that it passed. Entries are re-validated
    // here so only clean { key, label, passed, detail } rows reach Firestore.
    if (Array.isArray(livenessChecks) && livenessChecks.length > 0) {
      const cleanChecks = livenessChecks
        .filter(
          (check): check is LivenessCheck =>
            !!check &&
            typeof check.key === "string" &&
            typeof check.label === "string" &&
            typeof check.passed === "boolean" &&
            typeof check.detail === "string",
        )
        .map(({ key, label, passed, detail }) => ({ key, label, passed, detail }));
      if (cleanChecks.length > 0) {
        updates.livenessChecks = cleanChecks;
      }
    }

    // Only mark "awaiting_id" when the account has no verification status
    // yet - never overwrite a decision the admin panel already made.
    if (!RESPECTED_STATUSES.has(String(currentStatus))) {
      updates.verificationStatus = "awaiting_id";
    }

    await setDoc(userDocRef, updates, { merge: true });
  } catch (error) {
    // The selfie is already in storage; surface the Firestore failure so the
    // caller can let the user retry (the re-submit upserts over the same
    // path, so retrying is safe and idempotent).
    throw new Error(
      error instanceof Error
        ? `Face scan saved, but recording it failed: ${error.message}`
        : "Face scan saved, but recording it failed. Please try again.",
    );
  }

  return { faceScanUrl, faceScanPath: path };
}

/**
 * Deletes the submitted face scan for the signed-in user — removes the stored
 * selfie from Supabase Storage (best-effort) and clears the face-scan fields
 * on the user's `regular_user` document. The Valid ID submission, if any,
 * stays untouched (mirror of deleteSubmittedValidId in validIdBackend.ts,
 * with the face-scan / Valid ID roles swapped):
 *
 *   - A Valid ID still on file  → status reverts to "awaiting_id" (the ID is
 *     in, the face scan is the missing step again).
 *   - No Valid ID on file       → the whole verification status (and any
 *     rejection reason) is cleared, leaving a fresh unverified account.
 *
 * Blocked while the account is "pending" (under admin review) or "verified"
 * (admin-approved) — deleting in those states would silently erase a record
 * the admin panel is reviewing or has already approved. Rejected and
 * awaiting_id accounts can delete freely so the user can start over.
 */
export async function deleteSubmittedFaceScan(): Promise<void> {
  const user = auth.currentUser;
  if (!user?.uid) {
    throw new Error("You need to be signed in to delete your face scan.");
  }

  const userDocRef = doc(db, "regular_user", user.uid);

  let data: Record<string, unknown> | undefined;
  try {
    const snapshot = await getDoc(userDocRef);
    data = snapshot.exists() ? (snapshot.data() as Record<string, unknown>) : undefined;
  } catch (error) {
    throw new Error(
      error instanceof Error
        ? `Checking your submission failed: ${error.message}`
        : "Checking your submission failed. Please check your connection and try again.",
    );
  }

  if (!data || (!data.faceScanUrl && !data.faceScanPath && !data.faceScanSubmittedAt)) {
    throw new Error("You have no submitted face scan to delete.");
  }

  const status = String(data.verificationStatus ?? "");
  if (status === "verified") {
    throw new Error(
      "Your face scan has already been verified and can no longer be deleted.",
    );
  }
  if (status === "pending") {
    throw new Error(
      "Your verification is currently under review and cannot be deleted right now.",
    );
  }

  // Best-effort storage cleanup — a leftover object is harmless (the same
  // path is overwritten by any future re-enrollment), so a failed storage
  // delete must not block clearing the document.
  if (typeof data.faceScanPath === "string" && data.faceScanPath.length > 0) {
    await removeVerificationPhoto(data.faceScanPath).catch(() => {});
  }

  // A Valid ID still on file means only the face scan is being removed —
  // keep the status at "awaiting_id" so the account reads as "ID in, face
  // scan missing". With no ID either, the account is fully unverified again
  // and the status (plus any stale rejection reason) is cleared outright.
  const hasValidId = Boolean(data.validIdFrontUrl ?? data.validIdSubmittedAt);

  try {
    const updates: Record<string, unknown> = {
      faceScanUrl: deleteField(),
      faceScanPath: deleteField(),
      livenessPassed: deleteField(),
      faceScanSubmittedAt: deleteField(),
      updatedAt: serverTimestamp(),
    };

    if (hasValidId) {
      updates.verificationStatus = "awaiting_id";
    } else {
      // The old rejection reason no longer applies once nothing is submitted;
      // the admin panel only shows it for "rejected" anyway.
      updates.verificationStatus = deleteField();
      updates.rejectionReason = deleteField();
    }

    await setDoc(userDocRef, updates, { merge: true });
  } catch (error) {
    // The storage object is already gone; surface the Firestore failure so
    // the caller can let the user retry (retrying is safe — the storage
    // delete is best-effort and the field clearing is idempotent).
    throw new Error(
      error instanceof Error
        ? `Face scan removed, but clearing the record failed: ${error.message}`
        : "Face scan removed, but clearing the record failed. Please try again.",
    );
  }
}

