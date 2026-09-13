import { onAuthStateChanged } from "firebase/auth";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { auth } from "../../../firebaseConfig";
import {
  getSavedLogin,
  isSessionSettled,
  subscribeSessionSettled,
} from "../../main_layout/save_loginfunc";

/**
 * Safety timeout: if the saved session hasn't been restored by Firebase within
 * this window, hide the loading overlay so the user can still sign in manually
 * instead of being stuck on a spinner forever.
 *
 * 25s: Vivo-class devices on slow networks can take 10–20s for the token
 * refresh + first Firestore read. The old 6s hid the overlay mid-restore,
 * leaving the user staring at Login buttons that were about to auto-redirect
 * — that "stuck then sudden jump" gap is exactly the reported bug.
 */
const SESSION_RESTORE_TIMEOUT_MS = 25000;

/**
 * `LoadingSession` (SavedLoginWait) — crash-safe loading overlay for the
 * saved-login flow. Shared by ALL pre-login screens (`/`, `/start`, `/login`)
 * — nothing rejected/verified-specific lives here on purpose: the loader
 * cannot know the account status (zero Firestore reads), it only knows that
 * a restore is in flight.
 *
 * Two stages, both generic:
 * - Stage 1 "Restoring your session" — Firebase token refresh (auth).
 * - Stage 2 "Checking verification status" — Firestore gate read.
 *
 * The overlay now stays up until the gate SETTLES (not just until auth
 * arrives): on redirect the route unmount hides it anyway; on "stay put"
 * (`verification` suppressed by "later", expired session) the settle signal
 * from `SaveLoginSync` hides it. Previously it hid at auth and left 10–20s
 * of tappable buttons that were about to redirect — the reported Vivo bug.
 *
 * Crash-safety guarantees (dev + preview/web builds):
 * - No native-only imports. Uses only React Native core primitives
 *   (`ActivityIndicator`, `Text`, `View`, `StyleSheet`) that work on
 *   Android, iOS, and react-native-web.
 * - All AsyncStorage reads go through `getSavedLogin()`, which is already
 *   wrapped in try/catch — never throws.
 * - The `onAuthStateChanged` listener is always unsubscribed on unmount.
 * - A timeout guarantees the overlay always dismisses, even if the session
 *   restore fails or the auth state never fires with a user.
 * - Renders `null` whenever there is no saved login, so the UI is untouched.
 */
export default function LoadingSession() {
  const [visible, setVisible] = useState(false);
  // Stage 2 flag: auth is back but the gate (Firestore read) is still
  // running. Only the copy changes — no status-specific text, because the
  // status (rejected / verified / pending) is still unknown at this point.
  const [checkingVerification, setCheckingVerification] = useState(false);
  // Set to `true` the moment Firebase reports an authenticated user for this
  // mount. Used to close the race between the async auth listener and the
  // async storage read in `boot()`.
  const userSeenRef = useRef(false);
  // Ensures the overlay can only ever be shown once per mount.
  const shownRef = useRef(false);

  useEffect(() => {
    let isMounted = true;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    let unsubscribe: ReturnType<typeof onAuthStateChanged> | null = null;
    let unsubscribeSettled: (() => void) | null = null;

    const hide = () => {
      // If a session came back, the safety timeout is no longer needed —
      // drop it so no redundant `setVisible(false)` fires afterwards.
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
      if (unsubscribeSettled) {
        unsubscribeSettled();
        unsubscribeSettled = null;
      }
      if (isMounted) {
        setVisible(false);
        setCheckingVerification(false);
      }
    };

    // Fired when the gate fully settles (redirect issued or "stay put"
    // decision). On redirect the route unmount hides this anyway; this
    // mainly covers the "stay put" cases where the loader would otherwise
    // sit until the 25s timeout.
    const handleSettled = () => {
      hide();
    };

    const armSettleWatcher = () => {
      if (unsubscribeSettled) {
        return;
      }
      try {
        if (isSessionSettled()) {
          hide();
          return;
        }
        unsubscribeSettled = subscribeSessionSettled(handleSettled);
      } catch {
        // Non-fatal — the timeout still guarantees dismissal.
      }
    };

    unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      // Auth is back — the gate (Firestore read) is now running, so switch
      // to stage-2 copy but KEEP the overlay up. The redirect (or the
      // settle signal for "stay put") dismisses it. Hiding here was the old
      // bug: 10–20s of tappable pre-login buttons before the redirect fired.
      if (currentUser) {
        userSeenRef.current = true;
        armSettleWatcher();
        if (isMounted && shownRef.current) {
          setCheckingVerification(true);
        }
      }
    });

    const boot = async () => {
      try {
        const savedLogin = await getSavedLogin();
        if (!isMounted) {
          return;
        }

        // No saved-login marker means there is no session to wait for — tear
        // down the now-useless auth subscription and render nothing.
        if (!savedLogin.saved) {
          if (unsubscribe) {
            unsubscribe();
            unsubscribe = null;
          }
          return;
        }

        // If Firebase already restored the session while the storage read was
        // still in flight, don't flash the overlay for stage 1 — but if the
        // gate hasn't settled yet, show STAGE 2 ("Checking verification…")
        // instead of leaving the pre-login buttons exposed for 10–20s.
        // (Covers both the auth listener beating us here and the user
        // navigating back to a pre-login screen after restoring.)
        if (userSeenRef.current || auth.currentUser) {
          try {
            if (isSessionSettled()) {
              return;
            }
          } catch {
            return;
          }
          if (shownRef.current) {
            return;
          }
          shownRef.current = true;
          armSettleWatcher();
          setCheckingVerification(true);
          setVisible(true);
          timeout = setTimeout(hide, SESSION_RESTORE_TIMEOUT_MS);
          return;
        }

        // Never show the overlay twice for the same mount.
        if (shownRef.current) {
          return;
        }

        shownRef.current = true;
        setVisible(true);

        // Never let the overlay block the app forever.
        timeout = setTimeout(hide, SESSION_RESTORE_TIMEOUT_MS);
      } catch {
        // Storage read failures must never crash the app.
      }
    };

    void boot();

    return () => {
      isMounted = false;
      if (timeout) {
        clearTimeout(timeout);
      }
      if (unsubscribe) {
        unsubscribe();
      }
      if (unsubscribeSettled) {
        try {
          unsubscribeSettled();
        } catch {
          // Non-fatal.
        }
        unsubscribeSettled = null;
      }
    };
  }, []);

  if (!visible) {
    return null;
  }

  return (
    <View style={styles.overlay} pointerEvents="auto">
      <View style={styles.card}>
        <ActivityIndicator size="large" color="#0EA5E9" />
        <Text style={styles.title}>
          {checkingVerification
            ? "Checking verification status"
            : "Restoring your session"}
        </Text>
        <Text style={styles.subtitle}>Please wait a moment…</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(248, 250, 252, 0.92)",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 999,
    elevation: 999,
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    paddingVertical: 28,
    paddingHorizontal: 32,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 6,
  },
  title: {
    color: "#0F172A",
    fontSize: 17,
    fontWeight: "800",
    marginTop: 16,
  },
  subtitle: {
    color: "#64748B",
    fontSize: 13,
    marginTop: 4,
  },
});
