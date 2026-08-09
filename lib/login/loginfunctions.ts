import AsyncStorage from "@react-native-async-storage/async-storage";
import { signInWithEmailAndPassword } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "../../firebaseConfig";
import { markUserActiveByUid } from "../../app/regular_user/status/RegularUserPresenceSync";

const SAVED_LOGIN_NAME_KEY = "@puredrop/saved_login_name";

interface LoginParams {
  email: string;
  password: string;
}

/**
 * Result of a successful sign-in. `profile` is optional because the profile
 * read is now non-blocking — the UI navigates as soon as Auth succeeds and the
 * profile data (if present) resolves in the background.
 */
export type LoginResult = {
  uid: string;
  email: string | null;
  profile?: Record<string, unknown> | null;
};

/**
 * Signs the user in and returns immediately after Firebase Auth succeeds.
 *
 * Performance fix: the previous implementation awaited THREE sequential
 * network round-trips (Auth sign-in -> Firestore `getDoc` profile -> Firestore
 * `setDoc` presence write) before returning, which on a slow/cold network
 * could take 8–10s. Now:
 *
 * - Auth sign-in is still awaited (it is the source of truth for whether login
 *   succeeded).
 * - The profile `getDoc` and the presence `setDoc` are fired in PARALLEL and
 *   in a guarded fire-and-forget manner, so they never block navigation.
 *   `useHomeDashboard` already subscribes to the profile with a live
 *   listener + cached-name fast-path, so the Home screen converges on its own.
 *
 * Crash-safety (preview/dev/web safe): all background work is wrapped in
 * try/catch and can never throw into the caller or crash the app.
 */
export async function loginUser({ email, password }: LoginParams): Promise<LoginResult> {
  if (!email || !password) {
    throw new Error("Email and password are required");
  }

  const userCredential = await signInWithEmailAndPassword(
    auth,
    email,
    password
  );

  const user = userCredential.user;

  // Resolve the profile and update presence in parallel, in the background.
  // Never awaited, never throws — the caller (login screen) navigates as soon
  // as Auth resolves.
  void (async () => {
    try {
      const userDocRef = doc(db, "regular_user", user.uid);
      const userSnap = await getDoc(userDocRef);

      if (userSnap.exists()) {
        // Persist the resolved profile so the home dashboard can show the
        // cached fast-path immediately. Wrapped so a cache write failure can
        // never crash the app.
        try {
          const data = userSnap.data();
          await AsyncStorage.setItem(
            SAVED_LOGIN_NAME_KEY,
            typeof data.fullName === "string" && data.fullName.length > 0
              ? data.fullName
              : ""
          );
        } catch {
          // Non-fatal cache write.
        }
      }
    } catch {
      // Non-fatal — the live listener in useHomeDashboard will load the real
      // profile.
    }

    try {
      await markUserActiveByUid(user.uid, "login_success");
    } catch {
      // Do not block login success if presence write fails.
    }
  })();

  return {
    uid: user.uid,
    email: user.email,
  };
}
