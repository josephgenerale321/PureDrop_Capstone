import { createUserWithEmailAndPassword } from "firebase/auth";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { auth, db } from "../../firebaseConfig";
import { isValidAccountNumber } from "../accountNumber";
import { reserveSequentialUserId } from "../regular_user/sequentialId";

export interface RegisterParams {
  fullName: string;
  address: string;
  email: string;
  password: string;
  confirmPassword: string;
  accountNumber: string;
}

const SUPPORTED_SUFFIXES = [", Toledo City", ", Balamban, Cebu", ", Balamban"];

const normalizeAddress = (value: string): string => {
  const trimmed = value.trim();

  if (!trimmed) {
    return "";
  }

  const lower = trimmed.toLowerCase();
  for (const suffix of SUPPORTED_SUFFIXES) {
    if (lower.endsWith(suffix.toLowerCase())) {
      return trimmed;
    }
  }

  return trimmed;
};

export function prepareRegistrationParams({
  fullName,
  address,
  email,
  password,
  confirmPassword,
  accountNumber,
}: RegisterParams): RegisterParams {
  const formattedAddress = normalizeAddress(address);
  const formattedFullName = fullName.trim();
  const formattedEmail = email.trim();
  const formattedAccountNumber = accountNumber.trim();

  if (!formattedFullName || !formattedAddress || !formattedEmail || !password) {
    throw new Error("All fields are required");
  }

  if (password !== confirmPassword) {
    throw new Error("Passwords do not match");
  }

  if (!isValidAccountNumber(formattedAccountNumber)) {
    throw new Error("Account number must be in 032-012-361 format");
  }

  return {
    fullName: formattedFullName,
    address: formattedAddress,
    email: formattedEmail,
    password,
    confirmPassword,
    accountNumber: formattedAccountNumber,
  };
}

export async function registerUser(params: RegisterParams) {
  const {
    fullName,
    address,
    email,
    password,
    accountNumber,
  } = prepareRegistrationParams(params);

  const userCredential = await createUserWithEmailAndPassword(
    auth,
    email,
    password,
  );

  const user = userCredential.user;

  // Reserve this user's sequential display ID (1, 2, 3...) BEFORE creating
  // the profile, so the doc is born with its final ID already present — no
  // stub document is ever written. Falls back to no stored ID (profile
  // shows a hash fallback) if the reservation fails — the profile screen
  // self-heals it on next view.
  // This read/modify/write chain MUST stay atomic (transaction inside the
  // helper), so two simultaneous signups can never receive the same ID.
  let sequentialId: number | null = null;
  try {
    sequentialId = await reserveSequentialUserId();
  } catch {
    sequentialId = null;
  }

  await setDoc(doc(db, "regular_user", user.uid), {
    uid: user.uid,
    ...(sequentialId !== null ? { sequentialId } : {}),
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
    accountNumber,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  return user;
}
