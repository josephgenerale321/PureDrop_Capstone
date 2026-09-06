import {
  deleteField,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { auth, db } from "../../../../firebaseConfig";
import {
  removeVerificationPhoto,
  uploadVerificationPhoto,
} from "../../faceselfie_comp/backend/verificationUpload";

/**
 * Valid ID submission backend for the Valid ID screen
 * (app/verification/valid_id/valid_id_main.tsx).
 *
 * Uploads the captured ID photos to Supabase Storage under the signed-in
 * user's verification folder and records them on the user's `regular_user`
 * Firestore document:
 *
 *   validIdFrontUrl / validIdFrontPath — front photo (or the passport data
 *                                        page, which acts as the front)
 *   validIdBackUrl  / validIdBackPath  — back photo (not used for passports)
 *   validIdType                        — the chosen ID type label
 *   validIdSubmittedAt                 — server timestamp of the submission
 *   verificationStatus                 — "pending" ONLY when a face scan is
 *                                        already on file (both the face scan
 *                                        and the ID are in, awaiting admin
 *                                        approval: pending → verified /
 *                                        rejected in the admin panel). Without
 *                                        a face scan the status is left as
 *                                        "awaiting_id".
 *   verifiedAt                         — null until the admin approves
 *
 * The result reports `hasFaceScan` so the Valid ID screen can route the user
 * to the face-scan flow instead of Home when the selfie is still missing.
 *
 * Firestore fields mirror the face-scan plan
 * (docs/face_scan_verification_plan september 1.docx / 5.2).
 */

const ID_PHOTO_PATHS: Record<"front" | "back" | "passport", string> = {
  front: "valid-id-front.jpg",
  back: "valid-id-back.jpg",
  passport: "valid-id-passport.jpg",
};

export type ValidIdSubmissionSide = "front" | "back" | "passport";

export type ValidIdSubmissionInput = {
  /** Chosen Valid ID type label (e.g. "Passport", "Philippine National ID (PhilID)"). */
  idType: string;
  frontPhoto?: string | null;
  backPhoto?: string | null;
  passportPhoto?: string | null;
};

export type ValidIdSubmissionResult = {
  uploadedSides: ValidIdSubmissionSide[];
  paths: Partial<Record<ValidIdSubmissionSide, string>>;
  /**
   * Whether the account already has a face scan on file. When false, the
   * verification is NOT yet "pending review" — the caller should send the
   * user to the face-scan flow instead of Home.
   */
  hasFaceScan: boolean;
};

/**
 * Submits the captured Valid ID photos for the signed-in user. Throws with a
 * user-presentable message on failure (no upload, no Firestore write).
 */
export async function submitValidId(
  input: ValidIdSubmissionInput,
): Promise<ValidIdSubmissionResult> {
  const user = auth.currentUser;
  if (!user?.uid) {
    throw new Error("You need to be signed in to submit your Valid ID.");
  }

  if (!input.idType?.trim()) {
    throw new Error("Select your Valid ID type before submitting.");
  }

  // Collect whichever sides were captured (passport flow sends one side).
  const sides: ValidIdSubmissionSide[] = [];
  if (input.passportPhoto) {
    sides.push("passport");
  }
  if (input.frontPhoto) {
    sides.push("front");
  }
  if (input.backPhoto) {
    sides.push("back");
  }

  if (sides.length === 0) {
    throw new Error("Attach the photo of your Valid ID before submitting.");
  }

  // Upload each captured side; remember the storage path per side so the
  // Firestore update can reference exactly what was uploaded.
  const paths: Partial<Record<ValidIdSubmissionSide, string>> = {};
  const urls: Partial<Record<ValidIdSubmissionSide, string>> = {};
  try {
    for (const side of sides) {
      const path = `verification/${user.uid}/${ID_PHOTO_PATHS[side]}`;
      urls[side] = await uploadVerificationPhoto(
        (side === "front"
          ? input.frontPhoto
          : side === "back"
            ? input.backPhoto
            : input.passportPhoto) as string,
        path,
      );
      paths[side] = path;
    }
  } catch (error) {
    throw new Error(
      error instanceof Error
        ? error.message
        : "Uploading your Valid ID photo failed. Please check your connection and try again.",
    );
  }

  try {
    // Check whether the face scan is already on file. The Valid ID only
    // moves the account to "pending review" (both face + ID in) — without a
    // face scan the status must stay "awaiting_id" so the admin panel and
    // the verification flow know the face step is still missing.
    const userDocRef = doc(db, "regular_user", user.uid);
    const snapshot = await getDoc(userDocRef);
    const faceData = snapshot.exists() ? snapshot.data() : undefined;
    const hasFaceScan = Boolean(
      faceData?.faceScanUrl ?? faceData?.faceScanPath ?? faceData?.faceScanSubmittedAt,
    );

    const updates: Record<string, unknown> = {
      validIdType: input.idType.trim(),
      validIdSubmittedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    if (hasFaceScan) {
      updates.verificationStatus = "pending";
      updates.verifiedAt = null;
    }

    // The passport data page doubles as the "front" image so the admin
    // panel's preview (which reads validIdFront*) works for every ID type.
    if (urls.front || urls.passport) {
      updates.validIdFrontUrl = urls.front ?? urls.passport;
      updates.validIdFrontPath = paths.front ?? paths.passport;
    }
    if (urls.back) {
      updates.validIdBackUrl = urls.back;
      updates.validIdBackPath = paths.back;
    }

    await setDoc(userDocRef, updates, { merge: true });

    return { uploadedSides: sides, paths, hasFaceScan };
  } catch (error) {
    // The photos are already in storage; surface the Firestore failure so the
    // caller can let the user retry (re-submitting upserts over the same
    // paths, so retrying is safe and idempotent).
    throw new Error(
      error instanceof Error
        ? `Valid ID saved, but recording it failed: ${error.message}`
        : "Valid ID saved, but recording it failed. Please try again.",
    );
  }
}

/**
 * Deletes the submitted Valid ID for the signed-in user — removes the stored
 * photos from Supabase Storage (best-effort) and clears the submission fields
 * on the user's `regular_user` document, reverting the verification status to
 * "awaiting_id". The face scan, if any, stays untouched.
 *
 * Blocked while the account is "pending" (under admin review) or "verified"
 * (admin-approved) — deleting in those states would silently erase a record
 * the admin panel is reviewing or has already approved. Rejected and
 * awaiting_id submissions can be deleted freely so the user can start over.
 */
export async function deleteSubmittedValidId(): Promise<void> {
  const user = auth.currentUser;
  if (!user?.uid) {
    throw new Error("You need to be signed in to delete your Valid ID.");
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

  if (!data || (!data.validIdSubmittedAt && !data.validIdFrontUrl)) {
    throw new Error("You have no submitted Valid ID to delete.");
  }

  const status = String(data.verificationStatus ?? "");
  if (status === "verified") {
    throw new Error(
      "Your Valid ID has already been verified and can no longer be deleted.",
    );
  }
  if (status === "pending") {
    throw new Error(
      "Your Valid ID is currently under review and cannot be deleted right now.",
    );
  }

  // Best-effort storage cleanup — a leftover object is harmless (the same
  // paths are overwritten by any future re-submission), so a failed storage
  // delete must not block clearing the document.
  const storagePaths = [data.validIdFrontPath, data.validIdBackPath].filter(
    (path): path is string => typeof path === "string" && path.length > 0,
  );
  for (const path of storagePaths) {
    await removeVerificationPhoto(path).catch(() => {});
  }

  try {
    await setDoc(
      userDocRef,
      {
        validIdType: deleteField(),
        validIdFrontUrl: deleteField(),
        validIdFrontPath: deleteField(),
        validIdBackUrl: deleteField(),
        validIdBackPath: deleteField(),
        validIdSubmittedAt: deleteField(),
        // The old rejection reason no longer applies once the submission is
        // gone; the admin panel only shows it for "rejected" anyway.
        rejectionReason: deleteField(),
        verificationStatus: "awaiting_id",
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
  } catch (error) {
    // The storage objects are already gone; surface the Firestore failure so
    // the caller can let the user retry (retrying is safe — the storage
    // deletes are best-effort and the field clearing is idempotent).
    throw new Error(
      error instanceof Error
        ? `Valid ID removed, but clearing the record failed: ${error.message}`
        : "Valid ID removed, but clearing the record failed. Please try again.",
    );
  }
}
