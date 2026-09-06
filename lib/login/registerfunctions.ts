import { createUserWithEmailAndPassword } from "firebase/auth";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { auth, db } from "../../firebaseConfig";

export interface RegisterParams {
  fullName: string;
  address: string;
  email: string;
  password: string;
  confirmPassword: string;
  waterMeter: number;
}

const CITY_SUFFIX = ", Toledo City";

const normalizeAddress = (value: string): string => {
  const trimmed = value.trim();

  if (!trimmed) {
    return "";
  }

  if (trimmed.toLowerCase().endsWith(CITY_SUFFIX.toLowerCase())) {
    return trimmed;
  }

  return `${trimmed}${CITY_SUFFIX}`;
};

export function prepareRegistrationParams({
  fullName,
  address,
  email,
  password,
  confirmPassword,
  waterMeter,
}: RegisterParams): RegisterParams {
  const formattedAddress = normalizeAddress(address);
  const formattedFullName = fullName.trim();
  const formattedEmail = email.trim();

  if (!formattedFullName || !formattedAddress || !formattedEmail || !password) {
    throw new Error("All fields are required");
  }

  if (password !== confirmPassword) {
    throw new Error("Passwords do not match");
  }

  if (!Number.isFinite(waterMeter) || waterMeter < 0) {
    throw new Error("Water meter must be non-negative");
  }

  return {
    fullName: formattedFullName,
    address: formattedAddress,
    email: formattedEmail,
    password,
    confirmPassword,
    waterMeter,
  };
}

export async function registerUser(params: RegisterParams) {
  const {
    fullName,
    address,
    email,
    password,
    waterMeter,
  } = prepareRegistrationParams(params);

  const userCredential = await createUserWithEmailAndPassword(
    auth,
    email,
    password,
  );

  const user = userCredential.user;

  await setDoc(doc(db, "regular_user", user.uid), {
    uid: user.uid,
    fullName,
    address,
    email,
    emailVerified: true,
    role: "regular_user",
    status: "Inactive",
    // Identity verification (face selfie + Valid ID) starts as "awaiting_id":
    // the account exists and its email is verified, but no face scan or ID
    // has been submitted yet. Statuses: awaiting_id → pending → verified/rejected.
    verificationStatus: "awaiting_id",
    verifiedAt: null,
    // Rejection bookkeeping for the login rejection notice:
    // - verificationRejectionCount — bumped by the admin panel on each reject
    // - rejectedNoticeSeenCount    — count at the time the user acknowledged
    //                                the notice (drives "show once per rejection")
    verificationRejectionCount: 0,
    rejectedNoticeSeenCount: 0,
    presenceStatus: "Inactive",
    presenceSource: "register",
    presenceUpdatedAt: serverTimestamp(),
    lastSeenAt: serverTimestamp(),
    waterMeter,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  return user;
}
