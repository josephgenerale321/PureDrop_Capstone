import AsyncStorage from "@react-native-async-storage/async-storage";
import type { RegisterParams } from "./registerfunctions";

const PENDING_REGISTRATION_KEY = "@puredrop/pending_registration";
const OTP_SENT_AT_KEY = "@puredrop/pending_registration_otp_sent_at";
const PENDING_REGISTRATION_TTL_MS = 30 * 60 * 1000;

let pendingRegistration: RegisterParams | null = null;
let otpSentAt: number | null = null;
let hydratePromise: Promise<void> | null = null;

type StoredPendingRegistration = {
  registration: RegisterParams;
  otpSentAt: number | null;
};

const isValidRegistration = (value: unknown): value is RegisterParams => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<RegisterParams>;
  return (
    typeof candidate.fullName === "string" &&
    typeof candidate.address === "string" &&
    typeof candidate.email === "string" &&
    typeof candidate.password === "string" &&
    typeof candidate.waterMeter === "number"
  );
};

async function hydrateFromStorage(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(PENDING_REGISTRATION_KEY);
    if (!raw) {
      return;
    }

    const parsed = JSON.parse(raw) as StoredPendingRegistration;
    if (!isValidRegistration(parsed.registration)) {
      await AsyncStorage.multiRemove([
        PENDING_REGISTRATION_KEY,
        OTP_SENT_AT_KEY,
      ]);
      return;
    }

    if (
      typeof parsed.otpSentAt === "number" &&
      Date.now() - parsed.otpSentAt > PENDING_REGISTRATION_TTL_MS
    ) {
      await AsyncStorage.multiRemove([
        PENDING_REGISTRATION_KEY,
        OTP_SENT_AT_KEY,
      ]);
      return;
    }

    pendingRegistration = parsed.registration;
    otpSentAt =
      typeof parsed.otpSentAt === "number" ? parsed.otpSentAt : null;
  } catch {
    // Storage failures must never crash registration — in-memory still works.
  }
}

function ensureHydrated(): Promise<void> {
  if (pendingRegistration || otpSentAt !== null) {
    return Promise.resolve();
  }

  if (!hydratePromise) {
    hydratePromise = hydrateFromStorage().finally(() => {
      hydratePromise = null;
    });
  }

  return hydratePromise;
}

export function setPendingRegistration(registration: RegisterParams) {
  pendingRegistration = registration;
  otpSentAt = Date.now();

  const payload: StoredPendingRegistration = {
    registration,
    otpSentAt,
  };

  AsyncStorage.multiSet([
    [PENDING_REGISTRATION_KEY, JSON.stringify(payload)],
    [OTP_SENT_AT_KEY, String(otpSentAt)],
  ]).catch(() => {
    // Non-fatal: in-memory registration still works for this session.
  });
}

export function getPendingRegistration() {
  return pendingRegistration;
}

export async function getPendingRegistrationAsync(): Promise<RegisterParams | null> {
  if (pendingRegistration) {
    return pendingRegistration;
  }

  await ensureHydrated();
  return pendingRegistration;
}

export function getOtpSentAt(): number | null {
  return otpSentAt;
}

export async function getOtpSentAtAsync(): Promise<number | null> {
  if (otpSentAt !== null) {
    return otpSentAt;
  }

  await ensureHydrated();
  return otpSentAt;
}

export function clearPendingRegistration() {
  pendingRegistration = null;
  otpSentAt = null;

  AsyncStorage.multiRemove([
    PENDING_REGISTRATION_KEY,
    OTP_SENT_AT_KEY,
  ]).catch(() => {
    // Non-fatal.
  });
}

