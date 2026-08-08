import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Offline cache helpers for "My Reports".
 *
 * PureDrop stores the currently-loaded list of the user's submitted reports in
 * AsyncStorage so that, when the Firestore listener fails (no internet), the
 * My Reports screen can still render the last-known reports instead of showing
 * an empty list.
 *
 * SAFETY / PLATFORM NOTES:
 * - Every function is fully wrapped in try/catch and NEVER throws. A storage
 *   failure simply behaves as "no cache" (returns []) so the app never crashes.
 * - AsyncStorage is a no-op on some web/preview bundles; the try/catch treats
 *   those as "no cache" too.
 * - The cache is keyed per user (`regular_user:{uid}`) so switching accounts
 *   never leaks one user's reports into another's.
 */

const CACHE_PREFIX = "@puredrop/my_reports_cache";

type OfflineReports = {
  reportId: string;
  category: string;
  issue: string;
  location: string | null;
  gpsLocation: string | null;
  status: string;
  submittedAt: string;
};

const cacheKeyFor = (uid: string): string => `${CACHE_PREFIX}:${uid}`;

/**
 * Persists the given report list for a user. Fire-and-forget; storage errors
 * are swallowed so a failed write can never interrupt the UI.
 */
export async function saveReports(
  uid: string,
  reports: OfflineReports[]
): Promise<void> {
  if (!uid) {
    return;
  }
  try {
    await AsyncStorage.setItem(cacheKeyFor(uid), JSON.stringify(reports));
  } catch {
    // Non-fatal: caching is an optimization, not a requirement.
  }
}

/**
 * Reads the cached report list for a user. Returns [] on any error or when
 * nothing is cached, so callers always receive a safe array.
 */
export async function getCachedReports(
  uid: string
): Promise<OfflineReports[]> {
  if (!uid) {
    return [];
  }
  try {
    const raw = await AsyncStorage.getItem(cacheKeyFor(uid));
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    // Defensive: only keep entries that look like report objects.
    return parsed.filter(
      (item): item is OfflineReports =>
        !!item &&
        typeof item === "object" &&
        typeof (item as OfflineReports).reportId === "string"
    );
  } catch {
    return [];
  }
}

/**
 * Clears the cached reports for a user. Used on logout / account switch.
 */
export async function clearReports(uid: string): Promise<void> {
  if (!uid) {
    return;
  }
  try {
    await AsyncStorage.removeItem(cacheKeyFor(uid));
  } catch {
    // Non-fatal.
  }
}

export type { OfflineReports };
