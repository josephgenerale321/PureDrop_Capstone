import { useRouter } from "expo-router";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { useEffect, useState } from "react";
import { auth, db } from "../../firebaseConfig";

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
 * Backend logic for the home dashboard.
 *
 * - Subscribes to Firebase auth state.
 * - Fetches the current user's `regular_user/{uid}` Firestore document once
 *   after login and exposes it as `user`.
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

    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
        try {
          const userDocRef = doc(db, "regular_user", currentUser.uid);
          const userSnap = await getDoc(userDocRef);

          if (!isMounted) {
            return;
          }

          if (userSnap.exists()) {
            setUser({
              uid: currentUser.uid,
              email: currentUser.email,
              ...userSnap.data(),
            });
          } else {
            setUser({ uid: currentUser.uid, email: currentUser.email });
            console.warn("User profile not found in Firestore");
          }
        } catch (error) {
          if (!isMounted) {
            return;
          }

          setUser({ uid: currentUser.uid, email: currentUser.email });
          console.warn("Failed to load user profile after login", error);
        }
      } else {
        if (isMounted) {
          setUser(null);
          router.replace("/login");
        }
      }

      if (isMounted) {
        setLoading(false);
      }
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [router]);

  return { user, loading };
}

