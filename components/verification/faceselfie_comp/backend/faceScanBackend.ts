import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { auth, db } from "../../../../firebaseConfig";
import { uploadVerificationPhoto } from "./verificationUpload";

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
 * Submits the captured selfie for the signed-in user. Throws with a
 * user-presentable message on failure (no upload, no Firestore write).
 */
export async function submitFaceScan({
  photoUri,
}: {
  photoUri: string;
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

