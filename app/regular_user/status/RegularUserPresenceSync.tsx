import { onAuthStateChanged } from "firebase/auth";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { useEffect, useRef } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { auth, db } from "../../../firebaseConfig";

const USERS_COLLECTION = "regular_user";
const ACTIVE_STATUS = "Active";
const INACTIVE_STATUS = "Inactive";

// The admin dashboard treats a user as "Active" only if their presence
// timestamp is fresher than ACTIVE_PRESENCE_MAX_AGE_MS (3 minutes). To keep an
// actively-using user from falling out of "Active" while they keep the app open
// (no auth/app-state transition), we send a heartbeat well below that window.
const HEARTBEAT_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes

const writePresence = async (uid: string, status: string, source: string): Promise<void> => {
  const isActive = status === ACTIVE_STATUS;

  await setDoc(
    doc(db, USERS_COLLECTION, uid),
    {
      uid,
      status,
      presenceStatus: status,
      presenceSource: source,
      presenceUpdatedAt: serverTimestamp(),
      lastSeenAt: serverTimestamp(),
      ...(isActive ? { lastActiveAt: serverTimestamp() } : {}),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
};

export async function markCurrentUserActive(source = "manual"): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid) {
    return;
  }
  await writePresence(uid, ACTIVE_STATUS, source);
}

export async function markUserActiveByUid(uid: string, source = "manual"): Promise<void> {
  if (!uid) {
    return;
  }
  await writePresence(uid, ACTIVE_STATUS, source);
}

export async function markCurrentUserInactive(source = "manual"): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid) {
    return;
  }
  await writePresence(uid, INACTIVE_STATUS, source);
}

export default function RegularUserPresenceSync() {
  const currentUidRef = useRef<string | null>(auth.currentUser?.uid ?? null);
  const lastStatusRef = useRef<string>("");
  // True while the app is visually in the foreground AND the user is
  // authenticated. The heartbeat only runs in this state so we never write
  // presence while the app is backgrounded or logged out.
  //
  // BUG FIX: `AppState` only fires its "change" listener on *transitions*, not
  // for the initial state. The app launches in the foreground, so we must seed
  // `foregroundRef` from `AppState.currentState` here — otherwise it would stay
  // `false` forever and the heartbeat would never run.
  const foregroundRef = useRef<boolean>(AppState.currentState === "active");

  const writeIfChanged = (status: string, source: string, force = false): void => {
    const uid = currentUidRef.current || auth.currentUser?.uid || null;
    if (!uid) {
      return;
    }
    // Skip a redundant write unless `force` is set (used by the heartbeat to
    // bump the timestamp even when the status string hasn't changed).
    if (!force && lastStatusRef.current === status) {
      return;
    }

    lastStatusRef.current = status;
    void writePresence(uid, status, source);
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      currentUidRef.current = currentUser?.uid ?? null;

      if (!currentUser) {
        foregroundRef.current = false;
        lastStatusRef.current = "";
        return;
      }

      writeIfChanged(ACTIVE_STATUS, "auth_state_change");
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const handleAppStateChange = (nextState: AppStateStatus) => {
      const isActive = nextState === "active";
      foregroundRef.current = isActive;

      if (isActive) {
        // Refresh both the status and the timestamp on returning to the
        // foreground (force=true so we always bump the timestamp).
        writeIfChanged(ACTIVE_STATUS, "app_state_active", true);
        return;
      }

      writeIfChanged(INACTIVE_STATUS, "app_state_background");
    };

    const subscription = AppState.addEventListener("change", handleAppStateChange);
    return () => {
      subscription.remove();
    };
  }, []);

  // Foreground heartbeat: while the user is authenticated and the app is in
  // the foreground, bump the presence timestamp every HEARTBEAT_INTERVAL_MS so
  // the admin's 3-minute "Active" window never lapses for an active user.
  // The interval is cleared on unmount and whenever the app backgrounds.
  useEffect(() => {
    const intervalId = setInterval(() => {
      // Only heartbeat when we have an authenticated user AND the app is in
      // the foreground. Otherwise the interval is effectively idle.
      const uid = currentUidRef.current || auth.currentUser?.uid || null;
      if (!uid || !foregroundRef.current) {
        return;
      }
      writeIfChanged(ACTIVE_STATUS, "heartbeat", true);
    }, HEARTBEAT_INTERVAL_MS);

    return () => clearInterval(intervalId);
  }, []);

  return null;
}
