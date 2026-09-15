import AsyncStorage from "@react-native-async-storage/async-storage";
import { usePathname, useRouter, type Href } from "expo-router";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDocFromCache, getDocFromServer } from "firebase/firestore";
import { useEffect, useRef } from "react";
import { auth, db } from "../../firebaseConfig";
import {
  hasChosenVerificationLater,
  resolvePostLoginTarget,
} from "../login/backend/postEmailVerificationGate";
import {
  getProfileCache,
  getProfileFast,
  revalidateProfileInBackground,
  saveProfileCache,
} from "./offline_profile_cache";

/**
 * Storage keys + helpers for the lightweight "saved login" marker.
 *
 * Extra key: `@puredrop/session_ready` — written AFTER a session has fully
 * resolved once (auth OK + gate OK -> home reachable). On the next cold start
 * it lets `SaveLoginSync` redirect instantly (optimistic fast path) instead of
 * waiting 10–20s for Firebase + Firestore on slow devices, while the fresh
 * Firestore read re-validates in the background.
 */
const SAVED_LOGIN_KEY = "@puredrop/saved_login";
const SAVED_LOGIN_EMAIL_KEY = "@puredrop/saved_login_email";
const SAVED_LOGIN_NAME_KEY = "@puredrop/saved_login_name";
const SESSION_READY_KEY = "@puredrop/session_ready";
const SESSION_READY_UID_KEY = "@puredrop/session_ready_uid";

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
 * - `/login/validation` — the rejection notice screen (rejectedverif), the
 *   legacy notice (legacyverif), and the one-time fully-verified celebration
 *   (fullyverif). The user must acknowledge each of them themselves; an
 *   auto-redirect firing while one is open would bypass the notice.
 * - `/verification` — the identity verification flow itself (face selfie +
 *   Valid ID). An unverified user belongs here, not on Home.
 */
const AUTO_REDIRECT_EXCLUDED_PREFIXES = [
  "/login/email_verification",
  "/login/validation",
  "/verification",
];

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
 * True when this is a confirmed manual logout (explicit logout flow ran).
 * In that case the optimistic fast path must NOT fire — the user just logged
 * out on purpose. Module-level so it survives the root-layout remount that
 * happens when navigation jumps between route groups.
 */
let manualLogoutFlag = false;

/** Called by the explicit logout flow before Firebase signs out. */
export function noteManualLogout(): void {
  manualLogoutFlag = true;
}

/** Clears the manual-logout suppression (next fresh sign-in). */
export function clearManualLogoutFlag(): void {
  manualLogoutFlag = false;
}

/**
 * Settle-signal for the `SavedLoginWait` overlay (`loading_session.tsx`).
 *
 * `true` = the session restore fully settled this app run (gate finished and
 * any redirect was issued, or the decision was "stay put"). Route changes
 * unmount the loader anyway, so this flag only matters for the "stay put"
 * outcomes (`verification` suppressed by "later", expired session, gate
 * error) where the user REMAINS on the pre-login screen — without the signal
 * the overlay would sit until the 25s timeout.
 *
 * Module-level (with subscribers) so it works even if the root layout
 * remounts and so late-mounted loaders still see the settled state.
 */
let sessionSettledFlag = false;
const sessionSettledListeners = new Set<() => void>();

/** True when the session restore already settled this app run. */
export function isSessionSettled(): boolean {
  return sessionSettledFlag;
}

/** Marks the session restore as settled and wakes waiting loaders. */
export function noteSessionSettled(): void {
  sessionSettledFlag = true;
  for (const listener of sessionSettledListeners) {
    try {
      listener();
    } catch {
      // A listener must never crash the setter.
    }
  }
}

/**
 * Disarms the optimistic fast path (`@puredrop/session_ready`) WITHOUT
 * touching the saved-login marker or the Firebase session.
 *
 * Called whenever a gate resolves to anything OTHER than `home`
 * (rejected / pending / unverified / legacy / celebration): the account must
 * re-prove itself next cold start instead of jumping straight to Home.
 * The session itself is KEPT — rejectedverif / verificationmain need the live
 * uid to load the record and resubmit. Never `signOut()` here.
 */
export async function clearSessionReady(): Promise<void> {
  try {
    await AsyncStorage.multiRemove([SESSION_READY_KEY, SESSION_READY_UID_KEY]);
  } catch {
    // Non-fatal — worst case is one stale fast-path attempt, which the
    // background re-validation still corrects.
  }
}

/**
 * Subscribes to the settle signal. Returns an unsubscribe function.
 * Crash-safe: never throws.
 */
export function subscribeSessionSettled(listener: () => void): () => void {
  try {
    sessionSettledListeners.add(listener);
  } catch {
    // Non-fatal — the loader falls back to its timeout.
    return () => {};
  }
  return () => {
    try {
      sessionSettledListeners.delete(listener);
    } catch {
      // Non-fatal.
    }
  };
}

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
      SESSION_READY_KEY,
      SESSION_READY_UID_KEY,
    ]);
  } catch {
    // Storage errors are non-fatal — never crash the app.
  }
}

/**
 * True when a previous full session resolved to Home at least once
 * (fast-path marker for instant optimistic restore on cold start).
 */
export async function hasReadySession(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(SESSION_READY_KEY)) === "true";
  } catch {
    return false;
  }
}

export async function getReadySessionUid(): Promise<string | null> {
  try {
    const v = await AsyncStorage.getItem(SESSION_READY_UID_KEY);
    return typeof v === "string" && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

/** Marks the session as fully resolved (only call when gate => home). */
export async function markSessionReady(uid: string): Promise<void> {
  try {
    await AsyncStorage.multiSet([
      [SESSION_READY_KEY, "true"],
      [SESSION_READY_UID_KEY, uid],
    ]);
  } catch {
    // Non-fatal.
  }
}

export default function SaveLoginSync() {
  const router = useRouter();
  const pathname = usePathname();
  // Guards the OPTIMISTIC redirect so it can only ever run once per app run.
  // (`handledSessionRef` below still guards the verified/settled redirect.)
  const fastPathDoneRef = useRef(false);
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
  // Latest profile snapshot fetched during the auth sync. Reused by the
  // settled redirect so the gate costs 0 extra Firestore reads.
  const syncedProfileRef = useRef<{
    uid: string;
    data: Record<string, unknown> | null;
  } | null>(null);

  useEffect(() => {
    let isMounted = true;
    let unsubscribe: (() => void) | null = null;

    const navigate = (target: Href) => {
      try {
        router.replace(target);
      } catch {
        // Navigation must never crash the app.
      }
    };

    const targetForGate = (loginTarget: string): Href => {
      if (loginTarget === "rejected_notice") {
        return "/login/validation/rejectedverif" as Href;
      } else if (loginTarget === "legacy_notice") {
        return "/login/validation/legacyverif" as Href;
      } else if (loginTarget === "fully_verified_notice") {
        return "/login/validation/fullyverif" as Href;
      } else if (loginTarget === "verification") {
        return "/verification/verificationmain" as Href;
      }
      return "/regular_user/home";
    };

    /**
     * Resolves with the live Firebase uid, waiting up to `timeoutMs` for the
     * persisted session to refresh. Resolves `null` on timeout (expired /
     * revoked session). Poll-based — no extra auth listener needed.
     */
    const waitForAuthUid = (timeoutMs: number): Promise<string | null> =>
      new Promise((resolve) => {
        const existing = auth.currentUser?.uid ?? null;
        if (existing) {
          resolve(existing);
          return;
        }
        const startedAt = Date.now();
        const timer = setInterval(() => {
          const uid = auth.currentUser?.uid ?? null;
          if (uid) {
            clearInterval(timer);
            resolve(uid);
            return;
          }
          if (Date.now() - startedAt >= timeoutMs) {
            clearInterval(timer);
            resolve(null);
          }
        }, 250);
      });

    /** Background re-validation for the optimistic fast path. */
    const revalidateAfterFastPath = (uid: string) => {
      void (async () => {
        if (!isMounted) {
          return;
        }
        try {
          // The fast path fires while `auth.currentUser` is still null, and
          // the gate returns "home" for a null user (fail-open). So WAIT for
          // the live session first — otherwise this would "confirm" Home
          // without ever reading Firestore.
          const liveUid = await waitForAuthUid(25000);
          if (!isMounted) {
            return;
          }
          if (!liveUid) {
            // No session actually restored (expired/revoked). Release the
            // one-shot so the settled path can act if auth arrives late; the
            // /regular_user grace window will bounce to /login if needed.
            handledSessionRef.current = true;
            noteSessionSettled();
            return;
          }
          const freshTarget = await resolvePostLoginTarget();
          // Fast path already put the user on Home. Correct only when the
          // fresh read disagrees (e.g. admin rejected since last run).
          // The session is KEPT (no sign-out): rejectedverif + verification
          // need the live uid. Home access is revoked by navigating away,
          // and the fast-path flag is disarmed so the NEXT cold start does
          // not jump to Home again.
          if (freshTarget !== "home") {
            handledSessionRef.current = true;
            const corrected = targetForGate(freshTarget);
            navigate(corrected);
            await recordGateOutcome(corrected, liveUid);
            noteSessionSettled();
            return;
          }
          handledSessionRef.current = true;
          await markSessionReady(liveUid);
          noteSessionSettled();
        } catch {
          handledSessionRef.current = true;
          noteSessionSettled();
        }
      })();
    };

    /**
     * Records the gate outcome for the fast-path flag: `home` re-arms it,
     * anything else disarms it so the next cold start re-proves the account
     * instead of jumping straight to Home. Session + saved-login marker are
     * NEVER touched here (rejected users keep their uid for re-verify).
     */
    const recordGateOutcome = async (
      target: Href,
      uid: string | null
    ): Promise<void> => {
      try {
        if (target === "/regular_user/home") {
          if (uid) {
            await markSessionReady(uid);
          }
        } else {
          await clearSessionReady();
        }
      } catch {
        // Non-fatal — worst case is one stale fast-path attempt, corrected
        // by background re-validation.
      }
    };

    /**
     * Settles the one-shot redirect once a profile snapshot is available,
     * reusing it for the gate (single Firestore read total).
     */
    const settleWithProfile = (
      uid: string,
      profileData: Record<string, unknown> | null
    ) => {
      if (
        handledSessionRef.current ||
        !restoreIntentRef.current ||
        !isPreLoginRoute(pathname)
      ) {
        return;
      }
      // Claim the one-shot redirect immediately so overlapping auth events
      // cannot trigger a second navigation while the gate check is awaited.
      handledSessionRef.current = true;

      void (async () => {
        try {
          if (await hasChosenVerificationLater()) {
            try {
              const laterTarget = await resolvePostLoginTarget({
                uid,
                data: profileData,
              });
              if (laterTarget === "rejected_notice") {
                navigate("/login/validation/rejectedverif" as Href);
                await recordGateOutcome(
                  "/login/validation/rejectedverif" as Href,
                  uid
                );
              } else if (laterTarget === "fully_verified_notice") {
                navigate("/login/validation/fullyverif" as Href);
                await recordGateOutcome(
                  "/login/validation/fullyverif" as Href,
                  uid
                );
              } else if (laterTarget === "home") {
                navigate("/regular_user/home");
                await markSessionReady(uid);
              } else {
                // "verification"/"legacy" → stay put: the user chose "later".
                // Disarm the fast path: a non-home outcome must re-prove
                // itself next cold start.
                await recordGateOutcome(
                  "/verification/verificationmain" as Href,
                  uid
                );
              }
              // "verification" → stay put: the user chose "later".
            } catch {
              // Stay put — navigation must never crash the app.
            } finally {
              // Always settle: on "stay put" the loader is still mounted on
              // the pre-login screen and must hide now (not at the 25s
              // timeout). On redirect the unmount hides it anyway.
              noteSessionSettled();
            }
            return;
          }

          // Post-login gate — rejected => rejection notice, unverified =>
          // verification flow, newly-approved => one-time celebration, else
          // Home. Reuses the synced profile snapshot (0 extra reads).
          let target: Href = "/regular_user/home";
          try {
            const loginTarget = await resolvePostLoginTarget({
              uid,
              data: profileData,
            });
            target = targetForGate(loginTarget);
          } catch {
            // Gate check failure is non-fatal — fall through to Home.
          }

          navigate(target);
          await recordGateOutcome(target, uid);
          noteSessionSettled();
        } catch {
          // Never crash.
          noteSessionSettled();
        }
      })();
    };


    const maybeRedirect = async () => {
      if (
        !handledSessionRef.current &&
        restoreIntentRef.current &&
        isPreLoginRoute(pathname)
      ) {
        // A saved-login marker alone is NOT a session. Right after a
        // force-close + reopen, Firebase can take several seconds to refresh
        // the persisted session token, and during that window
        // `auth.currentUser` is still null. The optimistic fast path below
        // covers the wait; once auth + the synced profile arrive, the
        // settled redirect reuses the snapshot so the gate never misfires.
        const currentUid = auth.currentUser?.uid ?? null;
        if (!currentUid) {
          // No live auth yet — try the OPTIMISTIC fast path: a previous full
          // session resolved to Home, so go there instantly and re-validate
          // in the background. This is what kills the Vivo 10–20s stare at
          // the Login screen (Firebase token refresh is the slow span).
          // Suppressed right after an explicit manual logout (the flag is set
          // before Firebase signs out, and cleared on the next fresh sign-in).
          if (!fastPathDoneRef.current && !manualLogoutFlag) {
            fastPathDoneRef.current = true;
            void (async () => {
              try {
                const [ready, readyUid] = await Promise.all([
                  hasReadySession(),
                  getReadySessionUid(),
                ]);
                if (!isMounted || !ready) {
                  return;
                }
                if (
                  handledSessionRef.current ||
                  !restoreIntentRef.current ||
                  !isPreLoginRoute(pathname)
                ) {
                  return;
                }
                const alreadyLive = auth.currentUser;
                if (alreadyLive) {
                  return;
                }
                navigate("/regular_user/home");
                // If the session is already back under a different uid, skip.
                const liveNow: { uid?: string | null } | null =
                  auth.currentUser;
                if (liveNow && readyUid && liveNow.uid !== readyUid) {
                  return;
                }
                revalidateAfterFastPath(readyUid ?? "unknown");
              } catch {
                // Fast path is best-effort — the settled redirect still runs.
              }
            })();
          }
          return;
        }

        const preloaded = syncedProfileRef.current;
        const profileForGate =
          preloaded && preloaded.uid === currentUid ? preloaded.data : null;
        // The auth sync always fetches the profile before settling, so reuse
        // it. On the rare path where auth is already live but the sync hasn't
        // finished, fall back to a fresh single-read gate.
        if (profileForGate !== null || preloaded?.uid === currentUid) {
          settleWithProfile(currentUid, profileForGate);
          return;
        }

        // Rare path: auth is live but the profile sync hasn't finished (e.g.
        // maybeRedirect ran before the auth listener's fetch). Reuse the
        // shared settle helper with a fresh single read.
        if (await hasChosenVerificationLater()) {
          handledSessionRef.current = true;
          void (async () => {
            try {
              const laterTarget = await resolvePostLoginTarget();
              if (laterTarget === "rejected_notice") {
                navigate("/login/validation/rejectedverif" as Href);
                const rareUid = auth.currentUser?.uid ?? null;
                await recordGateOutcome(
                  "/login/validation/rejectedverif" as Href,
                  rareUid
                );
              } else if (laterTarget === "fully_verified_notice") {
                navigate("/login/validation/fullyverif" as Href);
                const rareUid = auth.currentUser?.uid ?? null;
                await recordGateOutcome(
                  "/login/validation/fullyverif" as Href,
                  rareUid
                );
              } else if (laterTarget === "home") {
                navigate("/regular_user/home");
                const readyUid = auth.currentUser?.uid;
                if (readyUid) {
                  await markSessionReady(readyUid);
                }
              } else {
                // "verification"/"legacy" → stay put: the user chose "later".
                // Disarm the fast path for the next cold start.
                const rareUid = auth.currentUser?.uid ?? null;
                await recordGateOutcome(
                  "/verification/verificationmain" as Href,
                  rareUid
                );
              }
              // "verification" → stay put: the user chose "later".
            } catch {
              // Stay put — navigation must never crash the app.
            } finally {
              noteSessionSettled();
            }
          })();
          return;
        }

        // Claim the one-shot redirect immediately so overlapping auth events
        // cannot trigger a second navigation while the gate check is awaited.
        handledSessionRef.current = true;

        void (async () => {
          // Post-login gate — routes a rejected verification to the rejection
          // notice screen (shown once per rejection), an unverified user to
          // the verification flow, and everyone else to Home.
          let target: Href = "/regular_user/home";
          try {
            // Post-login gate — routes a rejected verification to the
            // rejection notice, a pending/unverified user to the verification
            // flow, a newly-approved account to the one-time fully-verified
            // celebration, and a verified account to Home.
            const loginTarget = await resolvePostLoginTarget();
            target = targetForGate(loginTarget);
          } catch {
            // Gate check failure is non-fatal — fall through to Home.
          }

          navigate(target);
          const rareUid = auth.currentUser?.uid ?? null;
          await recordGateOutcome(target, rareUid);
          noteSessionSettled();
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
        if (currentUser == null) {
          // Explicit sign-out (or expired session). Allow the next sign-in to
          // re-synchronize so a profile/name change is not missed.
          syncedUidRef.current = null;
          syncedProfileRef.current = null;
          return;
        }

        const signedInUser = currentUser;

        // Same user as the last auth event — already synced this app run.
        // Skip the network profile read and the storage write entirely; only
        // re-attempt the cheap (local) one-shot redirect, reusing the snapshot.
        if (syncedUidRef.current === signedInUser.uid) {
          const again = syncedProfileRef.current;
          if (again && again.uid === signedInUser.uid) {
            settleWithProfile(signedInUser.uid, again.data);
          } else {
            void maybeRedirect();
          }
          return;
        }

        // A sync for this sign-in is already in flight — don't start a second
        // overlapping network read.
        if (syncingRef.current) {
          return;
        }
        syncingRef.current = true;
        const syncingUser = signedInUser;

        void (async () => {
          // Hoisted so the `finally` below can settle the redirect with the
          // just-fetched snapshot (zero extra Firestore reads).
          let syncedProfileData: Record<string, unknown> | null = null;
          try {
            // 1) Resolve the display name cache-first (zero network I/O).
            let cached: SavedLoginState;
            try {
              cached = await getSavedLogin();
            } catch {
              cached = { saved: false, email: null, fullName: null };
            }

            let fullName = cached.fullName;

            // 2) Fetch the profile ONCE (cache-first, single-flight). It serves
            //    BOTH the display-name cache AND the identity gate below
            //    (passed as `preloaded`), so the gate never issues a 2nd read.
            //    On 2nd boot / offline reopen this resolves from AsyncStorage
            //    in ms (measured 27ms) instead of the 10-13s server handshake.
            //    On a fully-verified reopen this + the celebration fast-path =
            //    exactly 1 deduplicated server read worst-case.
            try {
              const profileRef = doc(db, "regular_user", syncingUser.uid);
              const readServerDoc = async (): Promise<Record<string, unknown> | null> => {
                const t0 = typeof __DEV__ !== "undefined" && __DEV__ ? Date.now() : 0;
                try {
                  const snap = await getDocFromServer(profileRef);
                  return snap.exists() ? (snap.data() as Record<string, unknown>) : null;
                } finally {
                  if (typeof __DEV__ !== "undefined" && __DEV__) {
                    console.log(`[gate] profile getDocFromServer +${Date.now() - t0}ms`);
                  }
                }
              };
              const refreshAllCaches = (fresh: Record<string, unknown>): void => {
                const v = fresh.fullName;
                const addr = fresh.address;
                const mail = fresh.email;
                const img = fresh.profileImageUrl;
                void saveProfileCache(syncingUser.uid, {
                  fullName: typeof v === "string" ? v : "",
                  address: typeof addr === "string" ? addr : "",
                  email: typeof mail === "string" ? mail : (syncingUser.email ?? ""),
                  waterMeter:
                    typeof fresh.waterMeter === "number" || typeof fresh.waterMeter === "string"
                      ? (fresh.waterMeter as number | string)
                      : null,
                  profileImageUrl: typeof img === "string" ? img : null,
                });
                if (isMounted) {
                  syncedUidRef.current = syncingUser.uid;
                  syncedProfileRef.current = { uid: syncingUser.uid, data: fresh };
                }
              };
              const fast = await getProfileFast({
                uid: syncingUser.uid,
                emailFallback: syncingUser.email ?? null,
                getCacheSnapshot: async () => {
                  try {
                    const snap = await getDocFromCache(profileRef);
                    return snap.exists() ? (snap.data() as Record<string, unknown>) : null;
                  } catch {
                    return null;
                  }
                },
                getServerSnapshot: readServerDoc,
                refreshCaches: refreshAllCaches,
              });
              if (typeof __DEV__ !== "undefined" && __DEV__) {
                console.log(`[gate] profile getDoc +${fast.elapsedMs}ms (${fast.source})`);
              }
              syncedProfileData = fast.data;
              if (fast.source !== "server" && fast.data) {
                // Served instantly from cache — refresh the server copy + all
                // caches in the background (deduped with other callers).
                revalidateProfileInBackground({
                  uid: syncingUser.uid,
                  getServerSnapshot: readServerDoc,
                  refreshCaches: refreshAllCaches,
                });
              }
              if (!fullName && syncedProfileData) {
                const v = syncedProfileData.fullName;
                fullName = typeof v === "string" && v.length > 0 ? v : null;
              }
              if (!syncedProfileData) {
                // Total miss (never cached + server unreachable): fall back to
                // the AsyncStorage text cache so the greeting never goes blank.
                try {
                  const fallback = await getProfileCache(syncingUser.uid);
                  if (fallback?.fullName && !fullName) {
                    fullName = fallback.fullName;
                  }
                } catch {
                  // Non-fatal.
                }
              }
            } catch {
              // If the profile fetch fails (e.g. offline restore), fall back
              // to the cached value — never crash.
            }
            // 3) Persist only what actually changed (diff against the cached
            //    values) — no redundant AsyncStorage writes on every signal.
            try {
              const writes: [string, string][] = [];
              if (!cached.saved) {
                writes.push([SAVED_LOGIN_KEY, "true"]);
              }
              const emailValue = syncingUser.email ?? "";
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
              syncedUidRef.current = syncingUser.uid;
              syncedProfileRef.current = {
                uid: syncingUser.uid,
                data: syncedProfileData,
              };
            }
          } finally {
            syncingRef.current = false;
            if (isMounted) {
              // Pass the just-fetched profile straight into the redirect so
              // the gate reuses it (zero extra Firestore reads).
              settleWithProfile(syncingUser.uid, syncedProfileData);
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

