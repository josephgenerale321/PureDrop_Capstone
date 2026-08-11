/**
 * Converts a Firebase Auth UID (long alphanumeric string) into a stable,
 * short numeric display ID. This is a deterministic hash — the same UID
 * always produces the same number, and it never throws.
 *
 * Used only for DISPLAY purposes. The real UID is still used internally
 * for Firestore document IDs, auth, storage paths, etc.
 *
 * @param uid The Firebase Auth UID (string, null, or undefined).
 * @returns A stable numeric string (e.g. "1", "42", "12345").
 */
export const uidToNumber = (uid: string | null | undefined): string => {
  if (!uid) {
    return "N/A";
  }

  const raw = String(uid);
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    hash = (hash * 31 + raw.charCodeAt(i)) | 0;
  }

  // Ensure a positive number and keep it reasonably short.
  const positive = Math.abs(hash);
  return String(positive % 1000000);
};