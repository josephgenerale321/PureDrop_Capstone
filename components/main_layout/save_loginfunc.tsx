import AsyncStorage from "@react-native-async-storage/async-storage";
import { usePathname, useRouter, type Href } from "expo-router";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { useEffect, useRef } from "react";
import { auth, db } from "../../firebaseConfig";
import { resolveIdentityVerificationTarget } from "../login/backend/postEmailVerificationGate";

const SAVED_LOGIN_KEY = "@puredrop/saved_login";
const SAVED_LOGIN_EMAIL_KEY = "@puredrop/saved_login_email";
const SAVED_LOGIN_NAME_KEY = "@puredrop/saved_login_name";

type SavedLoginState = {
  saved: boolean;
  email: string | null;
  fullName: string | null;
};

/**
 * Route prefixes that must NEVER be auto-redirected away from, even when a
 * session is (or becomes) authenticated. These screens are part of the
 * registration / identity-verification flow and drive their own navigation:
 *
 * - `/login/email_verification` — the 6-digit OTP screen and the success
 *   screen. `registerUser()` signs the user in the moment the OTP is
 *   confirmed, so an auth event fires while the user is still here; without
 *   this exclusion the auto-redirect would hijack them to Home and they
 *   would never see the success screen / "Verify Identity" step.
 * - `/verification` — the identity verification flow itself (face selfie +
 *   Valid ID). An unverified user belongs here, not on Home.
 */
const AUTO_REDIRECT_EXCLUDED_PREFIXES = ["/login/email_verification", "/verification"];

/**
 * True when the current route is a pre-login screen (welcome, start, login,
 * register, forgot password, email verification). Auto-login only redirects
 * away from these screens so deep links into the regular-user area are never
 * hijacked.
 */
const isPreLoginRoute = (pathname: string): boolean => {
  if (AUTO_REDIRECT_EXCLUDED_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return false;
  }

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
    const emailValue = emailRaw?.[1];
    const nameValue = nameRaw?.[1];

    // Treat empty strings (the marker's "no value" representation) as null so
    // callers never receive a blank string that looks like real data.
    const email =
      typeof emailValue === "string" && emailValue.length > 0 ? emailValue : null;
    const fullName =
      typeof nameValue === "string" && nameValue.length > 0 ? nameValue : null;

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
  // Guards the auto-redirect so it can only ever run once per app run.
  const handledSessionRef = useRef(false);
  // True only when the app opened with a previously saved login marker — i.e.
  // the current session is a genuine *restore*, not a fresh manual login that
  // already navigates to `/regular_user/home` on its own.
  const restoreIntentRef = useRef(false);
  // uid of the auth session already synchronized (local cache + storage
  // marker). `onAuthStateChanged` can re-fire for the same user (token
  // refresh, re-subscribe); this uid guard keeps the network + storage work to
  // ONE sync per user per app run.
  const syncedUidRef = useRef<string | null>(null);
  // Re-entrancy guard, so an auth re-fire while a sync is still awaiting I/O
  // does not start a second overlapping sync (dedupes network reads).
  const syncingRef = useRef(false);

  useEffect(() => {
    let isMounted = true;
    let unsubscribe: (() => void) | null = null;

    const maybeRedirect = () => {
      if (
        !handledSessionRef.current &&
        restoreIntentRef.current &&
        isPreLoginRoute(pathname)
      ) {
        // A saved-login marker alone is NOT a session. Right after a
        // force-close + reopen, Firebase can take several seconds to refresh
        // the persisted session token, and during that window
        // `auth.currentUser` is still null. Running the identity-verification
        // gate now would read "no user" and wrongly send an UNVERIFIED user
        // straight to Home (the one-shot flag would then swallow the corrected
        // redirect once the session actually restores). So wait: the auth
        // listener below calls this same function the moment the restored
        // session (or its profile sync) completes, and only then does the
        // gate decide between Home and the verification flow.
        if (!auth.currentUser) {
          return;
        }

        // Claim the one-shot redirect immediately so overlapping auth events
        // cannot trigger a second navigation while the gate check is awaited.
        handledSessionRef.current = true;

        void (async () => {
          // Identity verification gate — a user who has not submitted both
          // their face scan and Valid ID is routed to the verification flow
          // ("Let's verify your identity first") instead of Home.
          let target: Href = "/regular_user/home";
          try {
            const verificationTarget = await resolveIdentityVerificationTarget();
            if (verificationTarget === "verification") {
              target = "/verification/verificationmain" as Href;
            }
          } catch {
            // Gate check failure is non-fatal — fall through to Home.
          }

          try {
            router.replace(target);
          } catch {
            // Navigation must never crash the app.
          }
        })();
      }
    };

    // Start observing Firebase auth. Called only after the storage read has
    // settled so `restoreIntentRef` is always accurate when the listener fires
    // (`onAuthStateChanged` emits the current user immediately on subscribe,
    // so no restored session is ever missed).
    const startListening = () => {
      if (!isMounted) {
        return;
      }

      unsubscribe = onAuthStateChanged(auth, (currentUser) => {
        if (!currentUser) {
          // Explicit sign-out (or expired session). Allow the next sign-in to
          // re-synchronize so a profile/name change is not missed.
          syncedUidRef.current = null;
          return;
        }

        // Same user as the last auth event — already synced this app run.
        // Skip the network profile read and the storage write entirely; only
        // re-attempt the cheap (local) one-shot redirect.
        if (syncedUidRef.current === currentUser.uid) {
          maybeRedirect();
          return;
        }

        // A sync for this sign-in is already in flight — don't start a second
        // overlapping network read.
        if (syncingRef.current) {
          return;
        }
        syncingRef.current = true;

        void (async () => {
          try {
            // 1) Resolve the display name cache-first (zero network I/O).
            let cached: SavedLoginState;
            try {
              cached = await getSavedLogin();
            } catch {
              cached = { saved: false, email: null, fullName: null };
            }

            let fullName = cached.fullName;

            // 2) Only when the cache has no name do we hit the network. On a
            //    typical app reopen the cached name already exists, so the
            //    Firestore `getDoc` round-trip is skipped entirely — faster
            //    auto-login, works offline, and saves a network request.
            if (!fullName) {
              try {
                const profileRef = doc(db, "regular_user", currentUser.uid);
                const profileSnap = await getDoc(profileRef);
                const data = profileSnap.exists() ? profileSnap.data() : null;
                fullName =
                  data && typeof data.fullName === "string" && data.fullName.length > 0
                    ? data.fullName
                    : null;
              } catch {
                // If the profile fetch fails (e.g. offline restore), fall back
                // to the cached value — never crash.
              }
            }

            // 3) Persist only what actually changed (diff against the cached
            //    values) — no redundant AsyncStorage writes on every signal.
            try {
              const writes: [string, string][] = [];
              if (!cached.saved) {
                writes.push([SAVED_LOGIN_KEY, "true"]);
              }
              const emailValue = currentUser.email ?? "";
              if (cached.email !== emailValue) {
                writes.push([SAVED_LOGIN_EMAIL_KEY, emailValue]);
              }
              const nameValue = fullName ?? "";
              if (cached.fullName !== nameValue) {
                writes.push([SAVED_LOGIN_NAME_KEY, nameValue]);
              }
              if (writes.length > 0) {
                await AsyncStorage.multiSet(writes);
              }
            } catch {
              // Non-fatal.
            }

            if (isMounted) {
              syncedUidRef.current = currentUser.uid;
            }
          } finally {
            syncingRef.current = false;
            if (isMounted) {
              maybeRedirect();
            }
          }
        })();
      });
    };

    (async () => {
      try {
        const savedLogin = await getSavedLogin();
        if (!isMounted) {
          return;
        }
        restoreIntentRef.current = savedLogin.saved;
        startListening();
        maybeRedirect();
      } catch {
        // Storage read failure is non-fatal. Still listen for auth so the app
        // stays functional; auto-redirect is simply disabled.
        if (!isMounted) {
          return;
        }
        restoreIntentRef.current = false;
        startListening();
      }
    })();

    return () => {
      isMounted = false;
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, [router, pathname]);

  return null;
}

