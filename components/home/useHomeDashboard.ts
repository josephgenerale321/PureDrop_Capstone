import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import { onAuthStateChanged } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { useEffect, useState } from "react";
import { auth, db } from "../../firebaseConfig";
import {
  getProfileCache,
  saveProfileCache,
} from "../main_layout/offline_profile_cache";

const SAVED_LOGIN_NAME_KEY = "@puredrop/saved_login_name";

/**
 * Profile fields resolved from the `regular_user/{uid}` Firestore document.
 * `fullName` is the only field the home UI reads; the rest of the document is
 * kept in the state object so future dashboard sections can use it without
 * another fetch.
 */
export type HomeUser = {
  uid: string;
  email: string | null;
  fullName?: string;
  [key: string]: unknown;
};

/**
 * Reads the cached full name written by `save_loginfunc.tsx`. Used only as an
 * instant fast-path so the greeting shows the real name immediately after an
 * auto-login; the live Firestore listener below always converges to the
 * freshest profile data.
 */
const getCachedFullName = async (): Promise<string | null> => {
  try {
    const raw = await AsyncStorage.getItem(SAVED_LOGIN_NAME_KEY);
    return typeof raw === "string" && raw.trim().length > 0 ? raw : null;
  } catch {
    return null;
  }
};

/**
 * Backend logic for the home dashboard.
 *
 * - Subscribes to Firebase auth state.
 * - Subscribes to the current user's `regular_user/{uid}` Firestore document
 *   with a LIVE `onSnapshot` listener (same pattern as the profile screen), so
 *   the displayed name always converges to the real profile — even right after
 *   an auto-login when a one-shot `getDoc` can race with session restore and
 *   return before the document is readable.
 * - Seeds the greeting from the locally cached full name (if any) for an
 *   instant fast-path while the live listener resolves.
 * - Redirects to `/login` when there is no authenticated user.
 * - Exposes `loading` so the UI can show a spinner until the first auth/user
 *   resolution completes.
 *
 * This module deliberately imports no React Native UI APIs, so it is safe on
 * every platform (Android, iOS, web, preview, dev builds).
 */
export function useHomeDashboard() {
  const router = useRouter();
  const [user, setUser] = useState<HomeUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    let unsubscribeProfile: (() => void) | null = null;

    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (unsubscribeProfile) {
        unsubscribeProfile();
        unsubscribeProfile = null;
      }

      if (!currentUser) {
        if (isMounted) {
          setUser(null);
          router.replace("/login");
          setLoading(false);
        }
        return;
      }

      // Fast-path: show the cached full name instantly while the live
      // listener resolves the freshest profile.
      if (isMounted) {
        try {
          const cachedName = await getCachedFullName();
          if (isMounted && cachedName) {
            setUser((prev) => {
              if (prev && typeof prev.fullName === "string" && prev.fullName.length > 0) {
                return prev;
              }
              return { uid: currentUser.uid, email: currentUser.email, fullName: cachedName };
            });
          }
        } catch {
          // Non-fatal — the live listener will provide the real profile.
        }
      }

      const userDocRef = doc(db, "regular_user", currentUser.uid);
      unsubscribeProfile = onSnapshot(
        userDocRef,
        (userSnap) => {
          if (!isMounted) {
            return;
          }

if (userSnap.exists()) {
            const data = userSnap.data();
            setUser({
              uid: currentUser.uid,
              email: currentUser.email,
              ...data,
            });
            // Persist the profile locally so it can be shown offline (name +
            // downloaded profile picture) when Firestore is not reachable.
            void saveProfileCache(currentUser.uid, {
              fullName:
                typeof data.fullName === "string" ? data.fullName : "",
              address: typeof data.address === "string" ? data.address : "",
              email: typeof data.email === "string" ? data.email : "",
              waterMeter:
                typeof data.waterMeter === "string" ||
                typeof data.waterMeter === "number"
                  ? data.waterMeter
                  : null,
              profileImageUrl:
                typeof data.profileImageUrl === "string"
                  ? data.profileImageUrl
                  : null,
            });
          } else {
            setUser({ uid: currentUser.uid, email: currentUser.email });
            console.warn("User profile not found in Firestore");
          }
          setLoading(false);
        },
        (error) => {
          if (!isMounted) {
            return;
          }

          console.warn("Failed to subscribe to user profile after login", error);
          // Offline fallback: try to restore the cached profile (name + local
          // photo) so the home shows the real account instead of "Resident".
          void (async () => {
            try {
              const cached = await getProfileCache(currentUser.uid);
              if (!isMounted) {
                return;
              }
              if (cached) {
                setUser((prev) => {
                  if (
                    prev &&
                    typeof prev.fullName === "string" &&
                    prev.fullName.length > 0
                  ) {
                    return prev;
                  }
                  return {
                    uid: currentUser.uid,
                    email: currentUser.email,
                    fullName: cached.fullName,
                    profileImageUrl: cached.profileImageLocalUri || cached.profileImageUrl,
                    profileImageLocalUri: cached.profileImageLocalUri,
                  };
                });
              } else {
                // Keep the cached fast-path user (if any) or a minimal user, so
                // the dashboard still renders instead of spinning forever.
                setUser((prev) => {
                  if (prev) {
                    return prev;
                  }
                  return { uid: currentUser.uid, email: currentUser.email };
                });
              }
            } catch {
              // Non-fatal.
            } finally {
              if (isMounted) {
                setLoading(false);
              }
            }
          })();
        },
      );
    });

    return () => {
      isMounted = false;
      unsubscribe();
      if (unsubscribeProfile) {
        unsubscribeProfile();
      }
    };
  }, [router]);

  return { user, loading };
}

