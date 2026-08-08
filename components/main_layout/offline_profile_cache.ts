import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";
import { Platform } from "react-native";

/**
 * Offline profile cache helpers for PureDrop.
 *
 * PureDrop stores the currently-signed-in user's profile (name, address,
 * email, water meter, and profile picture) so that when Firestore is not
 * reachable (no internet / offline reopen), the Home greeting, Profile
 * screen, and tab avatar can still show the real account instead of the
 * anonymous "Resident" placeholder or a generic default picture.
 *
 * SAFETY / PLATFORM NOTES:
 * - Every function is fully wrapped in try/catch and NEVER throws. A storage
 *   or file-system failure simply behaves as "no cache" so the app never
 *   crashes.
 * - The profile picture is downloaded into the app's cache directory and
 *   referenced by a `file://` URI so it can be rendered offline by
 *   `<Image source={{ uri }} />`.
 * - On web / preview bundles where `FileSystem.cacheDirectory` is unavailable
 *   or AsyncStorage is a no-op, the cache gracefully degrades to "no photo",
 *   still keeping the text fields (name, address, email).
 * - The cache is keyed per user (`regular_user:{uid}`) so switching accounts
 *   never leaks one user's profile into another's.
 */

const CACHE_PREFIX = "@puredrop/profile_cache";
// Sub-folder inside the FileSystem cache directory.
const PROFILE_PHOTO_DIR = "profile-photos";

export type CachedProfile = {
  fullName: string;
  address: string;
  email: string;
  waterMeter?: number | string | null;
  profileImageUrl?: string | null;
  // Local `file://` URI of the downloaded profile picture (offline-safe).
  profileImageLocalUri?: string | null;
};

const cacheKeyFor = (uid: string): string => `${CACHE_PREFIX}:${uid}`;

/** Resolves the directory used to store downloaded profile photos. */
const getPhotoDir = (): string | null => {
  try {
    if (typeof FileSystem.cacheDirectory !== "string") {
      return null;
    }
    return `${FileSystem.cacheDirectory}${PROFILE_PHOTO_DIR}`;
  } catch {
    return null;
  }
};

/** Sanitizes a remote URL into a safe local file name (keeps extension). */
const toLocalFileName = (url: string): string => {
  const clean = (url.split("?")[0] || "profile").split("#")[0];
  const name = clean.split("/").pop() || "profile";
  const sanitized = name
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return sanitized || "profile";
};

/**
 * Downloads a remote profile image into the local cache directory and
 * returns a `file://` URI. Returns null if it cannot be downloaded.
 */
const downloadProfilePhoto = async (uri: string): Promise<string | null> => {
  if (!uri || typeof uri !== "string") {
    return null;
  }
  // Do not attempt to re-download a local file.
  if (/^(file|content|ph|assets-library):/i.test(uri)) {
    return uri;
  }
  if (Platform.OS === "web") {
    return null;
  }
  try {
    const dir = getPhotoDir();
    if (!dir) {
      return null;
    }
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
    const localUri = `${dir}/${Date.now()}-${toLocalFileName(uri)}`;
    await FileSystem.downloadAsync(uri, localUri);
    return localUri;
  } catch {
    return null;
  }
};

/**
 * Removes the previously cached local profile photo file (if any) so disk
 * usage does not grow on every profile update.
 */
const removeLocalPhoto = async (localUri?: string | null): Promise<void> => {
  if (!localUri || typeof localUri !== "string") {
    return;
  }
  try {
    await FileSystem.deleteAsync(localUri, { idempotent: true });
  } catch {
    // Non-fatal.
  }
};

/**
 * Persists the given profile for a user. Downloads the profile picture to
 * local storage so it can be shown offline. Fire-and-forget friendly; never
 * throws.
 *
 * Call this whenever a fresh (online) profile snapshot is received.
 */
export async function saveProfileCache(
  uid: string,
  profile: CachedProfile,
): Promise<void> {
  if (!uid) {
    return;
  }

  // Download (or refresh) the local profile photo.
  let localUri: string | null = null;
  if (profile.profileImageUrl && typeof profile.profileImageUrl === "string") {
    localUri = await downloadProfilePhoto(profile.profileImageUrl);
  }

  try {
    const previous = await getProfileCache(uid);
    // If we could not download a new photo but a previous local one exists,
    // keep the previous local photo so we don't drop the offline picture.
    if (!localUri && previous?.profileImageLocalUri) {
      localUri = previous.profileImageLocalUri;
    }

    const payload: CachedProfile = {
      fullName: profile.fullName ?? "",
      address: profile.address ?? "",
      email: profile.email ?? "",
      waterMeter: profile.waterMeter ?? null,
      profileImageUrl: profile.profileImageUrl ?? null,
      profileImageLocalUri: localUri,
    };

    await AsyncStorage.setItem(cacheKeyFor(uid), JSON.stringify(payload));

    // If we replaced the photo, delete the old local file.
    if (
      previous?.profileImageLocalUri &&
      localUri &&
      previous.profileImageLocalUri !== localUri
    ) {
      void removeLocalPhoto(previous.profileImageLocalUri);
    }
  } catch {
    // Non-fatal.
  }
}

/**
 * Reads the cached profile for a user. Returns null on any error or when
 * nothing is cached.
 */
export async function getProfileCache(
  uid: string,
): Promise<CachedProfile | null> {
  if (!uid) {
    return null;
  }
  try {
    const raw = await AsyncStorage.getItem(cacheKeyFor(uid));
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<CachedProfile>;
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    return {
      fullName: typeof parsed.fullName === "string" ? parsed.fullName : "",
      address: typeof parsed.address === "string" ? parsed.address : "",
      email: typeof parsed.email === "string" ? parsed.email : "",
      waterMeter: parsed.waterMeter ?? null,
      profileImageUrl:
        typeof parsed.profileImageUrl === "string" ? parsed.profileImageUrl : null,
      profileImageLocalUri:
        typeof parsed.profileImageLocalUri === "string"
          ? parsed.profileImageLocalUri
          : null,
    };
  } catch {
    return null;
  }
}

/**
 * Clears the cached profile for a user (including the local photo file).
 * Used on logout / account switch.
 */
export async function clearProfileCache(uid: string): Promise<void> {
  if (!uid) {
    return;
  }
  try {
    const cached = await getProfileCache(uid);
    if (cached?.profileImageLocalUri) {
      await removeLocalPhoto(cached.profileImageLocalUri);
    }
    await AsyncStorage.removeItem(cacheKeyFor(uid));
  } catch {
    // Non-fatal.
  }
}
