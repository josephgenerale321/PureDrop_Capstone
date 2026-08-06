import { onAuthStateChanged } from "firebase/auth";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { auth } from "../../../firebaseConfig";
import { getSavedLogin } from "../../main_layout/save_loginfunc";

/**
 * Safety timeout: if the saved session hasn't been restored by Firebase within
 * this window, hide the loading overlay so the user can still sign in manually
 * instead of being stuck on a spinner forever.
 */
const SESSION_RESTORE_TIMEOUT_MS = 8000;

/**
 * `LoadingSession` (SavedLoginWait) — crash-safe loading overlay for the
 * saved-login flow.
 *
 * When the app reopens (or the user navigates to a pre-login screen) with a
 * saved-login marker in AsyncStorage, Firebase needs a moment to restore the
 * session. This component shows a lightweight full-screen "Restoring your
 * session…" loading alert so the user gets immediate feedback, then hides
 * itself the instant Firebase reports an authenticated user (the actual
 * redirect is handled by `SaveLoginSync` in the root layout).
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

    const hide = () => {
      // If a session came back, the safety timeout is no longer needed —
      // drop it so no redundant `setVisible(false)` fires afterwards.
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
      if (isMounted) {
        setVisible(false);
      }
    };

    unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      // The moment Firebase reports a restored (or fresh) session, stop
      // showing the loading overlay. Auto-redirect to `/regular_user/home`
      // is handled separately by SaveLoginSync in the root layout.
      if (currentUser) {
        userSeenRef.current = true;
        hide();
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
        // still in flight, there is nothing left to wait for — don't flash the
        // overlay (covers both the auth listener that beat us here and the
        // user navigating back to a pre-login screen after restoring).
        if (userSeenRef.current || auth.currentUser) {
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
    };
  }, []);

  if (!visible) {
    return null;
  }

  return (
    <View style={styles.overlay} pointerEvents="auto">
      <View style={styles.card}>
        <ActivityIndicator size="large" color="#0EA5E9" />
        <Text style={styles.title}>Restoring your session</Text>
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
