import { getPublicFileUrl, removeFile, uploadFile } from "../../../../api/storage";

/**
 * Shared storage layer for the identity-verification photos (face selfie and
 * Valid ID captures). Both feature backends (faceScanBackend, validIdBackend)
 * upload through this module so the bucket and path layout stay consistent.
 *
 * Photos land in the public `verification_id` bucket — the same bucket the
 * admin verification review screens read from (must match the admin panel's
 * VITE_SUPABASE_VERIFICATION_BUCKET value):
 *
 *   verification/{userId}/selfie.jpg
 *   verification/{userId}/valid-id-front.jpg
 *   verification/{userId}/valid-id-back.jpg
 *   verification/{userId}/valid-id-passport.jpg
 */
export const VERIFICATION_BUCKET =
  process.env.EXPO_PUBLIC_SUPABASE_VERIFICATION_BUCKET?.trim() || "verification_id";

/**
 * Uploads a captured verification photo (local file URI from the camera or
 * cropper) to Supabase Storage and resolves its public URL.
 *
 * `upsert: true` so retaking a photo overwrites the previous submission
 * instead of accumulating duplicate objects.
 */
export async function uploadVerificationPhoto(
  fileUri: string,
  destinationPath: string,
): Promise<string> {
  await uploadFile(fileUri, destinationPath, {
    bucket: VERIFICATION_BUCKET,
    // The captures and cropper outputs are JPEG files.
    contentType: "image/jpeg",
    upsert: true,
  });

  const publicUrl = getPublicFileUrl(destinationPath, VERIFICATION_BUCKET);
  if (!publicUrl) {
    throw new Error("Failed to resolve the uploaded photo URL.");
  }

  return publicUrl;
}

/**
 * Deletes an uploaded verification photo (best-effort). Used to roll back the
 * storage object when the Firestore update after a successful upload fails,
 * so no orphaned photo is left behind without a matching document field.
 */
export async function removeVerificationPhoto(path: string): Promise<void> {
  await removeFile(path, VERIFICATION_BUCKET);
}
