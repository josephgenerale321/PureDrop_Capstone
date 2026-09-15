import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";
import { Platform } from "react-native";

/**
 * Fast, cache-first read of the signed-in user's `regular_user` profile doc.
 *
 * WHY: a plain `getDoc()` goes to the server and pays the full cold-connect
 * cost (auth token refresh + WebChannel/long-poll handshake = 10-13s on
 * Vivo-class devices / emulator on 1st boot, because the connection is torn
 * down on every kill). This helper instead:
 *
 *   1. Returns the AsyncStorage text cache instantly (ms — measured 27ms on
 *      2nd boot; also covers offline reopens). On web, the Firestore
 *      persistent cache (`getDocFromCache`) is tried first when available.
 *   2. Revalidates from the server in the background and refreshes all caches.
 *   3. Dedupes concurrent callers (startup gate + tab layout + profile
 *      screen) onto ONE in-flight server read so the first open no longer
 *      issues 2-3 parallel `getDoc`s against the same cold connection.
 *
 * PLATFORM NOTE: the Firestore JS SDK has no IndexedDB on React Native /
 * Hermes, so `persistentLocalCache()` always falls back to memory cache on
 * native (warns "missing IndexedDB") — AsyncStorage is the real persistent
 * tier on Android/iOS. `getCacheSnapshot` is therefore best-effort: on
 * native it cheaply misses and tier 2 serves the UI.
 *
 * NEVER throws: on total failure it resolves `{ data: null, source: "none" }`
 * so callers fall back to cached/anonymous UI instead of trapping the user.
 *
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
 *
 * Cache-first single-flight profile reader is appended at the bottom of this
 * file (`getProfileFast`).
 */

const CACHE_PREFIX = "@puredrop/profile_cache";
// Sub-folder inside the FileSystem cache directory.
const PROFILE_PHOTO_DIR = "profile-photos";

// ---------------------------------------------------------------------------
// Verification snapshot cache (gate-relevant fields)
// ---------------------------------------------------------------------------
//
// WHY THIS EXISTS — the display cache above (`CachedProfile`) deliberately
// holds ONLY name / address / email / water meter / photo. It carries NO
// `verificationStatus`, and feeding that shape to the login gate
// (`resolvePostLoginTarget`) made every cached boot look "not verified":
// `data.verificationStatus === "verified"` was false, so the gate fell through
// to its last branch and routed FULLY VERIFIED users back into
// `/verification/verificationmain` (the "it still loops to verification"
// bug — visible in the log as `gate: -> verification +1ms` with NO
// `gate: verified+docs, checking celebration` line).
//
// This snapshot caches exactly the fields the gate needs so the fast path can
// stay at ms AND route correctly. An explicit allowlist (not a whole-doc dump)
// keeps AsyncStorage small and avoids persisting anything sensitive beyond
// what the gate already reads.
const VERIFICATION_CACHE_PREFIX = "@puredrop/verification_cache";

/** Fields copied into the verification snapshot — keep in sync with the
 * consumers: `resolvePostLoginTarget` (status / submission markers /
 * counters / celebration) and the realtime decision watcher. */
const VERIFICATION_FIELDS = [
  "verificationStatus",
  "rejectionTarget",
  "verificationRejectionCount",
  "rejectedNoticeSeenCount",
  "rejectionReason",
  "fullyVerifiedNoticeSeenAt",
  "verifiedAt",
  "wasReapproved",
  "reapprovalCycle",
  "faceScanUrl",
  "faceScanPath",
  "faceScanSubmittedAt",
  "validIdFrontUrl",
  "validIdFrontPath",
  "validIdSubmittedAt",
  "validIdType",
] as const;

/** `regular_user:{uid}` — verification snapshot key for a user. */
const verificationKeyFor = (uid: string): string => `${VERIFICATION_CACHE_PREFIX}:${uid}`;

/**
 * Persists the gate-relevant slice of a fresh `regular_user` doc. Never
 * throws; a storage failure only costs an extra server read on the next boot.
 */
export async function saveVerificationCache(
  uid: string,
  data: Record<string, unknown> | null | undefined,
): Promise<void> {
  if (!uid || !data) {
    return;
  }
  try {
    const payload: Record<string, unknown> = {};
    for (const key of VERIFICATION_FIELDS) {
      if (data[key] !== undefined) {
        payload[key] = data[key];
      }
    }
    await AsyncStorage.setItem(verificationKeyFor(uid), JSON.stringify(payload));
  } catch {
    // Non-fatal.
  }
}

/**
 * Reads the cached verification snapshot. Returns null when nothing is cached
 * or the payload is unusable — callers then treat the account as "unknown"
 * and fall back to an authoritative read.
 */
export async function getVerificationCache(
  uid: string,
): Promise<Record<string, unknown> | null> {
  if (!uid) {
    return null;
  }
  try {
    const raw = await AsyncStorage.getItem(verificationKeyFor(uid));
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Clears the verification snapshot (logout / account switch). Never throws. */
export async function clearVerificationCache(uid: string): Promise<void> {
  if (!uid) {
    return;
  }
  try {
    await AsyncStorage.removeItem(verificationKeyFor(uid));
  } catch {
    // Non-fatal.
  }
}

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
    // The gate-relevant snapshot must not outlive the display cache: a later
    // account on this device must never inherit the previous user's
    // verificationStatus.
    await clearVerificationCache(uid);
  } catch {
    // Non-fatal.
  }
}

// ---------------------------------------------------------------------------
// Cache-first single-flight profile reader
// ---------------------------------------------------------------------------

export type ProfileFastSource = "firestore-cache" | "async-cache" | "server" | "none";

export type ProfileFastResult = {
  /** Raw `regular_user/{uid}` fields, or null when unreadable. */
  data: Record<string, unknown> | null;
  /** Where the returned snapshot came from (for __DEV__ timing logs). */
  source: ProfileFastSource;
  /** Milliseconds the fast path took (cache hit or server fallback). */
  elapsedMs: number;
};

// One in-flight server read per uid. Concurrent callers (startup gate + tab
// layout + profile screen) share the same promise instead of issuing 2-3
// parallel `getDoc`s against the same cold connection.
const inflightServerReads = new Map<string, Promise<Record<string, unknown> | null>>();

const cachedProfileToDocData = (
  cached: CachedProfile | null,
  emailFallback: string | null,
): Record<string, unknown> | null => {
  if (!cached) {
    return null;
  }
  if (!cached.fullName && !cached.address && !cached.email && cached.profileImageUrl == null) {
    return null;
  }
  return {
    fullName: cached.fullName,
    address: cached.address,
    email: cached.email || emailFallback || "",
    waterMeter: cached.waterMeter ?? null,
    profileImageUrl: cached.profileImageUrl,
  };
};

const readServerProfileOnce = (
  uid: string,
  getServerSnapshot: () => Promise<Record<string, unknown> | null>,
): Promise<Record<string, unknown> | null> => {
  const pending = inflightServerReads.get(uid);
  if (pending) {
    return pending;
  }
  // NOTE: cleanup runs in a chained `.finally` (not inside the executor) so
  // `task` is definitely assigned by the time it is referenced.
  const task: Promise<Record<string, unknown> | null> = (async () => {
    try {
      return await getServerSnapshot();
    } catch {
      return null;
    }
  })();
  inflightServerReads.set(uid, task);
  void task.finally(() => {
    if (inflightServerReads.get(uid) === task) {
      inflightServerReads.delete(uid);
    }
  });
  return task;
};

/**
 * Cache-first read of `regular_user/{uid}`.
 *
 * Order: (1) Firestore cache (`getDocFromCache` — web-only in practice; on
 * native it cheaply misses because there is no IndexedDB) ->
 * (2) AsyncStorage text cache (`getProfileCache`, ms — the real persistent
 * tier on Android/iOS) -> (3) server (`getDocFromServer`, slow on cold boot,
 * deduped across callers).
 *
 * On native, tier 1 is skipped outright (no IndexedDB exists, so the call
 * can only warn/miss) and tier 2 serves the UI instantly.
 *
 * Pass Firestore accessors in so this module stays decoupled from
 * `firebaseConfig` (avoids an import cycle with the startup gate).
 *
 * Never throws; resolves `{ data: null, source: "none" }` when everything
 * fails so callers degrade to cached/anonymous UI.
 */
export async function getProfileFast(args: {
  uid: string;
  emailFallback?: string | null;
  getCacheSnapshot: () => Promise<Record<string, unknown> | null>;
  getServerSnapshot: () => Promise<Record<string, unknown> | null>;
  refreshCaches?: (data: Record<string, unknown>) => void;
}): Promise<ProfileFastResult> {
  const t0 = Date.now();
  const { uid, emailFallback = null, getCacheSnapshot, getServerSnapshot, refreshCaches } = args;
  if (!uid) {
    return { data: null, source: "none", elapsedMs: 0 };
  }

  // 1) Firestore cache — web-only in practice. On native (Android/iOS) the
  //    JS SDK has no IndexedDB, so this tier can only miss; skip it outright
  //    to avoid the "missing IndexedDB" warning path entirely.
  if (Platform.OS === "web") {
    try {
      const cachedDoc = await getCacheSnapshot();
      if (cachedDoc) {
        return { data: cachedDoc, source: "firestore-cache", elapsedMs: Date.now() - t0 };
      }
    } catch {
      // Fall through to the next tier.
    }
  }

  // 2) AsyncStorage text cache — instant greeting/avatar while the server
  //    revalidates in the background. NOTE: the background refresh lives
  //    ONLY in the explicit caller (`revalidateProfileInBackground`) — not
  //    here — so a cache hit never spawns a duplicate server read / log.
  //
  //    The display cache has no verification fields, so the gate-relevant
  //    snapshot is merged in here. Without it every cached boot looked "not
  //    verified" and the login gate routed fully-verified users back into the
  //    verification flow. Callers that need to know whether the gate fields
  //    are trustworthy must check for them explicitly (see
  //    `resolvePostLoginTarget`), because the snapshot is absent on the first
  //    boot after install / upgrade.
  try {
    const cached = await getProfileCache(uid);
    const asDoc = cachedProfileToDocData(cached, emailFallback);
    if (asDoc) {
      const verification = await getVerificationCache(uid);
      if (verification) {
        Object.assign(asDoc, verification);
      }
      return { data: asDoc, source: "async-cache", elapsedMs: Date.now() - t0 };
    }
  } catch {
    // Fall through to the server.
  }

  // 3) Server — slow on cold boot (10-13s), but deduped: concurrent callers
  //    share one in-flight read.
  const fresh = await readServerProfileOnce(uid, getServerSnapshot);
  if (fresh) {
    try {
      refreshCaches?.(fresh);
    } catch {
      // Non-fatal.
    }
    // Prime the gate-relevant snapshot so the NEXT boot can route correctly
    // from cache instead of paying this server read again.
    void saveVerificationCache(uid, fresh);
    return { data: fresh, source: "server", elapsedMs: Date.now() - t0 };
  }
  return { data: null, source: "none", elapsedMs: Date.now() - t0 };
}

/**
 * Fire-and-forget server revalidation for a profile that was served from
 * cache. Refreshes the AsyncStorage tier (the persistent tier on native)
 * without blocking the UI. Never throws.
 */
export function revalidateProfileInBackground(args: {
  uid: string;
  getServerSnapshot: () => Promise<Record<string, unknown> | null>;
  refreshCaches?: (data: Record<string, unknown>) => void;
  timeoutMs?: number;
}): void {
  const { uid, getServerSnapshot, refreshCaches, timeoutMs = 45_000 } = args;
  if (!uid) {
    return;
  }
  void (async () => {
    try {
      const fresh = await Promise.race([
        readServerProfileOnce(uid, getServerSnapshot),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
      ]);
      if (fresh) {
        try {
          refreshCaches?.(fresh);
        } catch {
          // Non-fatal.
        }
        // Keep the gate-relevant snapshot in step with the revalidated doc so
        // the next boot's ms-fast path routes to the right screen.
        void saveVerificationCache(uid, fresh);
      }
    } catch {
      // Non-fatal — the cached UI is already on screen.
    }
  })();
}
