import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";

export type GpsResult = {
  formattedLocation: string;
  city: string;
  isOutsideToledo: boolean;
  latitude: number;
  longitude: number;
  accuracyMeters?: number;
};

// Persists the last successful GPS fix so reopening the map can instantly
// center on the user's last known position instead of a cold acquisition.
// Wrapped so AsyncStorage failures (e.g. web/preview builds) never crash.
const LAST_GPS_KEY = "@puredrop/last_gps_fix";

export type LastGpsFix = {
  latitude: number;
  longitude: number;
  accuracyMeters?: number;
  timestamp: number;
};

export async function saveLastGpsFix(fix: LastGpsFix): Promise<void> {
  try {
    await AsyncStorage.setItem(LAST_GPS_KEY, JSON.stringify(fix));
  } catch {
    // Non-fatal: persistence is an optimization.
  }
}

export async function loadLastGpsFix(): Promise<LastGpsFix | null> {
  try {
    const raw = await AsyncStorage.getItem(LAST_GPS_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<LastGpsFix>;
    if (
      typeof parsed?.latitude === "number" &&
      Number.isFinite(parsed.latitude) &&
      typeof parsed?.longitude === "number" &&
      Number.isFinite(parsed.longitude)
    ) {
      return {
        latitude: parsed.latitude,
        longitude: parsed.longitude,
        accuracyMeters:
          typeof parsed.accuracyMeters === "number" ? parsed.accuracyMeters : undefined,
        timestamp: typeof parsed.timestamp === "number" ? parsed.timestamp : Date.now(),
      };
    }
    return null;
  } catch {
    return null;
  }
}

// Center of Toledo City, Cebu, Philippines (matches the default map region).
const TOLEDO_CENTER = { latitude: 10.3775, longitude: 123.6388 };

// A generous bounding box around Toledo City. GPS-triangulation and reverse
// geocoding can be imprecise near the border, so we give a small tolerance so
// a user standing just outside the official boundary is not wrongly rejected.
const TOLEDO_BOUNDS = {
  minLatitude: 10.24,
  maxLatitude: 10.5,
  minLongitude: 123.56,
  maxLongitude: 123.76,
};

// A reverse-geocoded place is considered "in Toledo" if any of these fields
// mention Toledo (directly or via a known alias).
const TOLEDO_ALIASES = ["toledo"];

// Stop acquiring more readings once we reach this accuracy (meters).
const GOOD_ACCURACY_METERS = 30;

// Hard cap on how long the whole acquisition loop may run before we fall back
// to the best reading gathered so far (or the default center).
const ACQUISITION_TIMEOUT_MS = 15000;

function formatLocation(city: string, latitude: number, longitude: number) {
  return city
    ? `${city} (${latitude.toFixed(6)}, ${longitude.toFixed(6)})`
    : `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
}

const isInsideToledoBounds = (latitude: number, longitude: number): boolean =>
  latitude >= TOLEDO_BOUNDS.minLatitude &&
  latitude <= TOLEDO_BOUNDS.maxLatitude &&
  longitude >= TOLEDO_BOUNDS.minLongitude &&
  longitude <= TOLEDO_BOUNDS.maxLongitude;

const mentionsToledo = (...values: (string | null | undefined)[]): boolean =>
  values.some((value) => {
    if (!value) {
      return false;
    }
    const lower = value.toLowerCase();
    return TOLEDO_ALIASES.some((alias) => lower.includes(alias));
  });

export async function getLocationFromCoordinates(
  latitude: number,
  longitude: number
): Promise<GpsResult> {
  const geocode = await Location.reverseGeocodeAsync({
    latitude,
    longitude,
  });

  const firstMatch = geocode[0];
  const city = firstMatch?.city || firstMatch?.subregion || firstMatch?.region || "";
  const formattedLocation = formatLocation(city, latitude, longitude);

  // A place is considered outside Toledo when it is outside the geofence AND
  // the reverse-geocoded name does not mention Toledo. This avoids false
  // rejections when the geocoder returns an empty/ambiguous name right on the
  // edge of the city.
  const isOutsideToledo = mentionsToledo(
    firstMatch?.city,
    firstMatch?.subregion,
    firstMatch?.region,
    firstMatch?.district,
  )
    ? false
    : !isInsideToledoBounds(latitude, longitude);

  return {
    formattedLocation,
    city,
    isOutsideToledo,
    latitude,
    longitude,
  };
}

export async function isLocationPermissionGranted(): Promise<boolean> {
  const { status } = await Location.getForegroundPermissionsAsync();
  return status === "granted";
}

/**
 * Acquires a GPS fix with a timeout and early-exit optimization.
 *
 * - Never hangs: if the loop exceeds `ACQUISITION_TIMEOUT_MS`, we return the
 *   best reading gathered so far (or a default Toledo center).
 * - Early-exits: stops requesting more readings once we reach or beat
 *   `GOOD_ACCURACY_METERS`, so we don't waste time/battery on extra fixes.
 * - Reuses a recent cached fix via `getLastKnownPositionAsync` when available,
 *   which is faster and more battery-friendly.
 */
async function acquireBestReading(): Promise<{
  latitude: number;
  longitude: number;
  accuracyMeters?: number;
  timedOut: boolean;
}> {
  const startedAt = Date.now();
  let bestLatitude: number | null = null;
  let bestLongitude: number | null = null;
  let bestAccuracy: number | null = null;

  const consider = (reading: Location.LocationObject) => {
    const accuracy = reading.coords.accuracy ?? Number.POSITIVE_INFINITY;
    const isFirst = bestLatitude === null;
    const isBetter = accuracy < bestAccuracy!;

    if (isFirst || isBetter) {
      bestLatitude = reading.coords.latitude;
      bestLongitude = reading.coords.longitude;
      bestAccuracy = Number.isFinite(accuracy) ? accuracy : null;
      return accuracy;
    }

    return bestAccuracy;
  };

  // Try to reuse a recent cached fix first (fast path).
  try {
    const cached = await Location.getLastKnownPositionAsync({ maxAge: 2000 });
    if (cached) {
      const accuracy = consider(cached);
      if (accuracy !== null && accuracy <= GOOD_ACCURACY_METERS) {
        return {
          latitude: cached.coords.latitude,
          longitude: cached.coords.longitude,
          accuracyMeters: cached.coords.accuracy ?? undefined,
          timedOut: false,
        };
      }
    }
  } catch {
    // Ignore cached-read failures; fall through to live acquisition.
  }

  for (let i = 0; i < 3; i += 1) {
    if (Date.now() - startedAt >= ACQUISITION_TIMEOUT_MS) {
      break;
    }

    try {
      const reading = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Highest,
      });
      const bestAlreadyGood =
        bestAccuracy !== null && bestAccuracy <= GOOD_ACCURACY_METERS;
      if (bestAlreadyGood) {
        break;
      }
      consider(reading);
    } catch {
      // A single failed reading should not abort the whole acquisition; the
      // next iteration may still succeed. If none succeed we fall back below.
    }
  }

  const timedOut = Date.now() - startedAt >= ACQUISITION_TIMEOUT_MS;

  if (bestLatitude !== null && bestLongitude !== null) {
    return {
      latitude: bestLatitude,
      longitude: bestLongitude,
      accuracyMeters: bestAccuracy ?? undefined,
      timedOut,
    };
  }

  // No fix at all — fall back to the default Toledo center so the user can
  // still pin the location manually instead of hitting a hard error.
  return {
    latitude: TOLEDO_CENTER.latitude,
    longitude: TOLEDO_CENTER.longitude,
    accuracyMeters: undefined,
    timedOut: true,
  };
}

export async function getCurrentGpsLocation(): Promise<GpsResult> {
  // Check first, request only if needed — avoids a redundant prompt (and
  // delay) when permission is already granted. Every permission API call is
  // guarded so a failure on preview/dev builds can never crash the flow; we
  // simply fall through to the acquisition attempt below.
  try {
    const granted = await isLocationPermissionGranted();
    if (!granted) {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        throw new Error("LOCATION_PERMISSION_DENIED");
      }
    }
  } catch (error) {
    if (error instanceof Error && error.message === "LOCATION_PERMISSION_DENIED") {
      throw error;
    }
    // Any other permission-API failure (e.g. unsupported platform, dev build
    // quirk) is non-fatal — continue and attempt to acquire a fix anyway so
    // the user can still pin the location manually.
  }

const reading = await acquireBestReading();
  const location = await getLocationFromCoordinates(
    reading.latitude,
    reading.longitude
  );

  // Persist the last known fix so the next time the map opens we can center
  // instantly. Guarded inside saveLastGpsFix so it can never reject/crash.
  void saveLastGpsFix({
    latitude: reading.latitude,
    longitude: reading.longitude,
    accuracyMeters: reading.accuracyMeters,
    timestamp: Date.now(),
  });

  return {
    ...location,
    accuracyMeters: reading.accuracyMeters,
  };
}
