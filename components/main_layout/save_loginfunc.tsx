import AsyncStorage from "@react-native-async-storage/async-storage";
import { usePathname, useRouter } from "expo-router";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { useEffect, useRef } from "react";
import { auth, db } from "../../firebaseConfig";

const SAVED_LOGIN_KEY = "@puredrop/saved_login";
const SAVED_LOGIN_EMAIL_KEY = "@puredrop/saved_login_email";
const SAVED_LOGIN_NAME_KEY = "@puredrop/saved_login_name";

type SavedLoginState = {
  saved: boolean;
  email: string | null;
  fullName: string | null;
};

/**
 * True when the current route is a pre-login screen (welcome, start, login,
 * register, forgot password, email verification). Auto-login only redirects
 * away from these screens so deep links into the regular-user area are never
 * hijacked.
 */
const isPreLoginRoute = (pathname: string): boolean => {
  return (
    pathname === "/" ||
    pathname === "/start" ||
    pathname === "/login" ||
    pathname.startsWith("/login/")
  );
};

/**
 * Persists a lightweight "saved login" marker in AsyncStorage so that
 * reopening the app can detect that the user was previously logged in.
 *
 * This is a safety net on top of Firebase Auth's built-in persistence
 * (`firebaseConfig.js` already configures `getReactNativePersistence`, so the
 * Firebase session itself survives app restarts). This module:
 *
 * - Saves the login marker + email whenever the Firebase auth state becomes
 *   authenticated (covers manual login AND auto-restored sessions).
 * - Exposes `clearSavedLogin()` for explicit logout flows.
 * - Auto-redirects a restored (or fresh) session away from the pre-login
 *   screens straight into `/regular_user/home`, so reopening the app logs
 *   the user in automatically.
 * - Is fully crash-safe: AsyncStorage reads/writes are wrapped in try/catch,
 *   navigation is wrapped in try/catch, and the component renders nothing.
 *
 * The component returns null. Mount it once in the root layout
 * (`app/_layout.tsx`) so it starts listening as soon as the app boots.
 */
export async function getSavedLogin(): Promise<SavedLoginState> {
  try {
    const [savedRaw, emailRaw, nameRaw] = await AsyncStorage.multiGet([
      SAVED_LOGIN_KEY,
      SAVED_LOGIN_EMAIL_KEY,
      SAVED_LOGIN_NAME_KEY,
    ]);

    const saved = savedRaw?.[1] === "true";
    const email = typeof emailRaw?.[1] === "string" ? emailRaw[1] : null;
    const fullName = typeof nameRaw?.[1] === "string" ? nameRaw[1] : null;

    return { saved, email, fullName };
  } catch {
    return { saved: false, email: null, fullName: null };
  }
}

export async function clearSavedLogin(): Promise<void> {
  try {
    await AsyncStorage.multiRemove([
      SAVED_LOGIN_KEY,
      SAVED_LOGIN_EMAIL_KEY,
      SAVED_LOGIN_NAME_KEY,
    ]);
  } catch {
    // Storage errors are non-fatal — never crash the app.
  }
}

export default function SaveLoginSync() {
  const router = useRouter();
  const pathname = usePathname();
  const handledSessionRef = useRef(false);

  useEffect(() => {
    let isMounted = true;

    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (!currentUser) {
        handledSessionRef.current = false;
        return;
      }

      // Best-effort, crash-safe: persist the login marker + profile name.
      let fullName: string | null = null;
      try {
        const profileRef = doc(db, "regular_user", currentUser.uid);
        const profileSnap = await getDoc(profileRef);
        const data = profileSnap.exists() ? profileSnap.data() : null;
        fullName =
          data && typeof data.fullName === "string" && data.fullName.length > 0
            ? data.fullName
            : null;
      } catch {
        // If the profile fetch fails (e.g. offline restore), fall back to
        // the previous cached value below — never crash.
      }

      try {
        await AsyncStorage.multiSet([
          [SAVED_LOGIN_KEY, "true"],
          [SAVED_LOGIN_EMAIL_KEY, currentUser.email ?? ""],
          [SAVED_LOGIN_NAME_KEY, fullName ?? ""],
        ]);
      } catch {
        // Non-fatal.
      }

      if (!isMounted) {
        return;
      }

      // Auto-login: bounce a logged-in user off the pre-login screens exactly
      // once per session. Manual login already navigates on its own, so this
      // only matters when a session is restored on app open.
      if (!handledSessionRef.current && isPreLoginRoute(pathname)) {
        handledSessionRef.current = true;
        try {
          router.replace("/regular_user/home");
        } catch {
          // Navigation must never crash the app.
        }
      }
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [router, pathname]);

  return null;
}

