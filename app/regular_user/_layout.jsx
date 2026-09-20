import { Ionicons } from "@expo/vector-icons";
import { Tabs, useRouter } from "expo-router";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDocFromCache, getDocFromServer, onSnapshot } from "firebase/firestore";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Image, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import HomeMainLoading from "../../components/loading/homepage/homemain_loading";
import FloatingNotification from "../../components/notifications/floating_notif";
import { ReportNotificationsProvider, useReportNotifications } from "../../components/notifications/notif_func";
import PushNotificationSync from "../../components/notifications/push_notificationfunc";
import SystemNotificationSync from "../../components/notifications/system_notif";
import TabUnreadBadge from "../../components/notifications/tabUnreadBadge";
import NoInternetNotification from "../../components/notifications/nointernet_notif";
import BackInternetNotification from "../../components/notifications/backinternet_notif";
import { auth, db } from "../../firebaseConfig";
import RegularUserPresenceSync from "./status/RegularUserPresenceSync";
import {
  clearSavedLogin,
  clearSessionReady,
  getSavedLogin,
} from "../../components/main_layout/save_loginfunc";
import {
  getProfileCache,
  getProfileFast,
  saveProfileCache,
  saveVerificationCache,
} from "../../components/main_layout/offline_profile_cache";

// While a saved-login marker exists, Firebase may need several seconds to
// refresh the persisted session token after the app reopens (especially on a
// slow network). Keep the /regular_user spinner up for this grace window
// before falling back to /login, so a valid restored session is never dropped
// to the login screen prematurely.
//
// NOTE ON TUNING: if this is set LOWER than the actual token-refresh time on
// the slowest supported network, the app will bounce to /login before the
// session restores, then get redirected back once it does — that is the exact
// "flip-flop" this grace window exists to prevent. 25s matches the 25s loading
// overlay timeout in `components/loading/restore_session/loading_session.tsx`
// for coherent behavior (Vivo-class devices measured at 10–20s on cold start).
const AUTH_RESTORE_GRACE_MS = 25000;

// Floating tab bar geometry. The bar is `position: absolute`, so it must add the
// bottom safe-area inset to its own height and padding — otherwise the Android
// system navigation bar (3-button or gesture pill; edge-to-edge is enabled)
// draws over it. `TAB_BAR_HEIGHT` matches the space screens reserve for the bar
// (`TAB_BAR_HEIGHT + insets.bottom + gap`), so list content never hides behind
// it and nothing is double-padded when the bar is hidden (inset = 0).
const TAB_BAR_HEIGHT = 70;
const TAB_BAR_PADDING_BOTTOM = 12;

export default function RegularUserLayout() {
  return (
    <ReportNotificationsProvider>
      <RegularUserTabs />
    </ReportNotificationsProvider>
  );
}

function RegularUserTabs() {
  // The floating tab bar must clear the Android system navigation bar, so it
  // grows by the bottom inset — read via `useSafeAreaInsets()` at the render
  // site below (0 while ImmersiveNavBar has the system bar hidden).
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  // Fail-closed gate: Home tabs render ONLY after the verification-status
  // check below resolves to "allowed". A rejected account must never see
  // Home — not even for one frame — so this stays false until proven.
  const [accessChecked, setAccessChecked] = useState(false);
  const [accessAllowed, setAccessAllowed] = useState(false);
  const [profileImageUrl, setProfileImageUrl] = useState(null);
  const redirectingRef = useRef(false);
  // True while this open still holds a saved-login marker. During the short
  // window after a force-close+reopen, Firebase may legitimately report "no
  // user" for a few seconds while it refreshes the persisted session token —
  // we must not bounce to /login during that window.
  const hasSavedLoginRef = useRef(false);
  // True until the first AsyncStorage read settles, so an auth "no user"
  // event that races ahead of the read doesn't cause a premature redirect.
  const markerPendingRef = useRef(true);
  const graceTimerRef = useRef(null);
  const { markAllAsRead } = useReportNotifications();
  // `markAllAsRead` is read through a ref so the memoized navigator below does
  // not depend on the notification context value — that value is a fresh object
  // on every snapshot delivery, so depending on it would rebuild the navigator.
  const markAllAsReadRef = useRef(markAllAsRead);
  useEffect(() => {
    markAllAsReadRef.current = markAllAsRead;
  }, [markAllAsRead]);

  useEffect(() => {
    let unsubscribeProfile = null;
    let unsubscribeAccess = null;
    let isMounted = true;

    const clearGraceTimer = () => {
      if (graceTimerRef.current) {
        clearTimeout(graceTimerRef.current);
        graceTimerRef.current = null;
      }
    };

    const redirectToLogin = () => {
      if (!redirectingRef.current) {
        redirectingRef.current = true;
        router.replace("/login");
      }
    };

    // Sends the user to the right non-Home destination for a rejected
    // account. Session is KEPT (no sign-out): rejectedverif + the
    // verification flow need the live uid to load the record and resubmit.
    // Unseen rejection count  -> rejection notice (once per rejection).
    // Already acknowledged    -> straight back into re-verification.
    const redirectForRejected = (data) => {
      if (redirectingRef.current) {
        return;
      }
      redirectingRef.current = true;
      // Keep the gate-relevant AsyncStorage snapshot in step with this live
      // rejection: the notice screen (rejectedverif) paints from that snapshot
      // first, and a stale "verified" copy rendered it with no reason and no
      // "Please resubmit" hint. Never throws; only a real rejected payload is
      // written (an empty one would wipe the cached snapshot).
      if (data?.verificationStatus === "rejected") {
        void saveVerificationCache(auth.currentUser?.uid ?? "", data);
      }
      const asCount = (v) =>
        typeof v === "number" && Number.isFinite(v)
          ? Math.max(0, Math.floor(v))
          : 0;
      let target = "/verification/verificationmain";
      try {
        const current = asCount(data?.verificationRejectionCount);
        const seenRaw = data?.rejectedNoticeSeenCount;
        const seen =
          seenRaw === null || seenRaw === undefined ? -1 : asCount(seenRaw);
        if (seen !== current) {
          target = "/login/validation/rejectedverif";
        }
      } catch {
        target = "/verification/verificationmain";
      }
      // Belt-and-suspenders: this device must not fast-path to Home again.
      void clearSessionReady().catch(() => {});
      try {
        router.replace(target);
      } catch {
        // Navigation must never crash the app.
      }
    };

    // Fail-closed verification gate for the whole `/regular_user` area.
    // Runs once a live session exists. The status read is cache-first
    // (deduped with the startup gate's read via `getProfileFast`), so 2nd
    // boot / offline reopen resolves in ms instead of 10-13s. SECURITY:
    // when only a CACHED copy is available we do NOT open Home yet — the
    // fail-closed loader (AUTH_RESTORE_GRACE_MS) stays up while the server
    // re-check runs in the foreground and the live listener below enforces
    // any newer rejection. Rejected -> bounced out immediately (session
    // kept). Missing record / read error -> allowed (fail-open, preserves
    // the old offline behaviour — never trap a valid user).
    // `watchRejections` also arms a live listener so a mid-session admin
    // rejection kicks the user out without waiting for a reopen.
    const runAccessCheck = (uid, { watchRejections = false } = {}) => {
      void (async () => {
        if (!isMounted) {
          return;
        }
        // Arms the live rejection listener WITHOUT opening Home first, so a
        // cached "verified" copy can never flash Home for a rejected account.
        const armRejectionWatch = () => {
          if (!watchRejections || !isMounted) {
            return;
          }
          try {
            if (unsubscribeAccess) {
              unsubscribeAccess();
            }
            unsubscribeAccess = onSnapshot(
              doc(db, "regular_user", uid),
              (liveSnap) => {
                if (!isMounted || !liveSnap.exists()) {
                  return;
                }
                try {
                  if (liveSnap.data()?.verificationStatus === "rejected") {
                    setAccessAllowed(false);
                    redirectForRejected(liveSnap.data() || {});
                  }
                } catch {
                  // Never crash on a live update.
                }
              },
              () => {
                // Listener error — ignore, the one-shot check already ran.
              }
            );
          } catch {
            // Non-fatal.
          }
        };
        try {
          const profileRef = doc(db, "regular_user", uid);
          const fast = await getProfileFast({
            uid,
            emailFallback: auth.currentUser?.email ?? null,
            getCacheSnapshot: async () => {
              try {
                const snap = await getDocFromCache(profileRef);
                return snap.exists() ? snap.data() || {} : null;
              } catch {
                return null;
              }
            },
            getServerSnapshot: async () => {
              const snap = await getDocFromServer(profileRef);
              return snap.exists() ? snap.data() || {} : null;
            },
          });
          const data = fast.data;
          if (!isMounted) {
            return;
          }
          // A cache-ONLY "rejected" copy must NOT bounce the user on its own:
          // the snapshot can be stale (the admin approved this account moments
          // ago while the live verification hub was open, but the cache still
          // says "rejected"), and redirecting on it threw freshly approved
          // users back into /verification/verificationmain in a loop. The
          // authoritative server re-check below is the decider for cache hits —
          // and when the server is unreachable, the cached rejection is
          // honoured there too, so this stays fail-CLOSED for real rejections.
          const cachedRejected =
            data?.verificationStatus === "rejected" &&
            fast.source !== "server";
          if (data) {
            if (data.verificationStatus === "rejected" && !cachedRejected) {
              setAccessAllowed(false);
              setAccessChecked(true);
              setAuthChecked(true);
              redirectForRejected(data);
              return;
            }
          }
          if (fast.source !== "server" && fast.data) {
            // Cache hit only: stay fail-CLOSED (loader keeps showing) while
            // the authoritative server re-check runs in the FOREGROUND.
            // `watchRejections` listener is armed first so even a slow
            // re-check cannot flash Home for a rejected account.
            armRejectionWatch();
            try {
              const serverSnap = await getDocFromServer(profileRef);
              if (!isMounted) {
                return;
              }
              const serverData = serverSnap.exists() ? serverSnap.data() || {} : null;
              if (serverData?.verificationStatus === "rejected") {
                setAccessAllowed(false);
                setAccessChecked(true);
                setAuthChecked(true);
                redirectForRejected(serverData);
                return;
              }
              // Verified / pending / missing record — Home stays reachable.
              setAccessAllowed(true);
              setAccessChecked(true);
            } catch {
              // Server unreachable. A cached REJECTION stays fail-CLOSED: the
              // verdict was never trusted on its own, but nothing disproved it
              // either — so a rejected user is kept out of Home instead of
              // being waved through on stale data.
              if (cachedRejected) {
                setAccessAllowed(false);
                setAccessChecked(true);
                setAuthChecked(true);
                redirectForRejected(data || {});
                return;
              }
              // Plain cache hit — fail OPEN (old offline behaviour): a valid
              // user is never trapped on a loader. NOTE: a rejected user on a
              // fully-offline device can therefore still see cached Home until
              // the network returns — accepted tradeoff (Firestore has no
              // signed offline ACL); the online path above enforces it.
              if (isMounted) {
                setAccessAllowed(true);
                setAccessChecked(true);
              }
            }
            return;
          }
          // Verified / pending / missing record — Home stays reachable.
          setAccessAllowed(true);
          setAccessChecked(true);
        } catch {
          // Read error (offline etc.) — fail OPEN, not closed: keep the old
          // behaviour so a valid user is never trapped on a loader.
          // NOTE: a rejected user on a fully-offline device can therefore
          // still see cached Home until the network returns. That is an
          // accepted tradeoff (Firestore has no signed offline ACL); the
          // online check above is what enforces the rule.
          if (isMounted) {
            setAccessAllowed(true);
            setAccessChecked(true);
          }
        }

        if (watchRejections && isMounted) {
          // Already armed on the cache-hit path above; arm here for the
          // server/miss path (guarded so it is never attached twice).
          if (!unsubscribeAccess) {
          try {
            unsubscribeAccess = onSnapshot(
              doc(db, "regular_user", uid),
              (liveSnap) => {
                if (!isMounted || !liveSnap.exists()) {
                  return;
                }
                try {
                  if (liveSnap.data()?.verificationStatus === "rejected") {
                    setAccessAllowed(false);
                    redirectForRejected(liveSnap.data() || {});
                  }
                } catch {
                  // Never crash on a live update.
                }
              },
              () => {
                // Listener error — ignore, the one-shot check already ran.
              }
            );
          } catch {
            // Non-fatal.
          }
          }
        }
      })();
    };

    const handleNoCurrentUser = () => {
      if (hasSavedLoginRef.current) {
        // A restore is (probably) in progress — give Firebase a grace window
        // before falling back to the login screen. A valid restored session
        // must never be dropped to /login prematurely.
        if (!graceTimerRef.current) {
          graceTimerRef.current = setTimeout(() => {
            graceTimerRef.current = null;
            if (!isMounted) {
              return;
            }
            // No session restored within the grace window — treat the saved
            // login as stale, clear it, and fall back to a manual login.
            hasSavedLoginRef.current = false;
            void clearSavedLogin().catch(() => {});
            setIsAuthenticated(false);
            redirectToLogin();
          }, AUTH_RESTORE_GRACE_MS);
        }
      } else if (!markerPendingRef.current) {
        // No marker and the storage read has settled — this is a normal
        // logged-out state, redirect immediately (existing gate behavior).
        redirectToLogin();
      }
      // marker still pending: the storage read resolves below and re-runs
      // this decision.
    };

    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      if (unsubscribeProfile) {
        unsubscribeProfile();
        unsubscribeProfile = null;
      }

      if (!currentUser) {
        setIsAuthenticated(false);
        setAccessAllowed(false);
        setAccessChecked(false);
        setProfileImageUrl(null);
        handleNoCurrentUser();
      } else {
        // A session arrived (restored or fresh) — cancel any pending grace
        // fallback. The tab UI renders ONLY after the access check below
        // proves this account may see Home (fail-closed for rejected).
        clearGraceTimer();
        hasSavedLoginRef.current = false;
        markerPendingRef.current = false;
        setIsAuthenticated(true);
        redirectingRef.current = false;
        runAccessCheck(currentUser.uid, { watchRejections: true });
        const userRef = doc(db, "regular_user", currentUser.uid);
        unsubscribeProfile = onSnapshot(
          userRef,
          (snap) => {
            if (!snap.exists()) {
              setProfileImageUrl(null);
              return;
            }

            const data = snap.data();
            const imgUrl =
              typeof data.profileImageUrl === "string" && data.profileImageUrl.length > 0
                ? data.profileImageUrl
                : null;
            setProfileImageUrl(imgUrl);
            // Persist the profile photo locally so the tab avatar can be shown
            // offline too.
            void saveProfileCache(currentUser.uid, {
              fullName: typeof data.fullName === "string" ? data.fullName : "",
              address: typeof data.address === "string" ? data.address : "",
              email: typeof data.email === "string" ? data.email : "",
              waterMeter:
                typeof data.waterMeter === "string" ||
                typeof data.waterMeter === "number"
                  ? data.waterMeter
                  : null,
              profileImageUrl: imgUrl,
            });
          },
          async () => {
            // Offline: fall back to the locally cached profile photo (if any)
            // so the tab avatar still shows the user's picture.
            try {
              const cached = await getProfileCache(currentUser.uid);
              if (isMounted) {
                setProfileImageUrl(
                  cached?.profileImageLocalUri || cached?.profileImageUrl || null
                );
              }
            } catch {
              if (isMounted) {
                setProfileImageUrl(null);
              }
            }
          }
        );
      }
      setAuthChecked(true);
    });

    // Decide whether this open should wait for a session restore, and close
    // the race where the auth listener fires "no user" before the storage
    // read settles.
    (async () => {
      try {
        const savedLogin = await getSavedLogin();
        if (!isMounted) {
          return;
        }
        markerPendingRef.current = false;
        hasSavedLoginRef.current = savedLogin.saved;

        if (savedLogin.saved) {
          // Marked for restore — if the auth listener already reported no
          // user, arm the grace timer now.
          if (!auth.currentUser) {
            handleNoCurrentUser();
          }
        } else if (!auth.currentUser && !redirectingRef.current) {
          // No marker and no session — normal logged-out gate.
          redirectToLogin();
        }
      } catch {
        // Storage read failure is non-fatal. The normal gate applies; the
        // auth listener above handles immediate redirects from here on.
        if (isMounted) {
          markerPendingRef.current = false;
        }
      }
    })();

    return () => {
      isMounted = false;
      clearGraceTimer();
      unsubscribe();
      if (unsubscribeProfile) {
        unsubscribeProfile();
      }
      if (unsubscribeAccess) {
        try {
          unsubscribeAccess();
        } catch {
          // Non-fatal.
        }
        unsubscribeAccess = null;
      }
    };
  }, [router]);

  // The tab avatar (and the whole navigator subtree) lives in
  // `RegularUserNavigator` below, so notification updates that re-render this
  // layout can never re-render the tab bar or rebuild its screen options.

  // Fail-closed: Home tabs render ONLY when auth is live AND the access
  // check proved this account is not rejected. Until then (or when bounced)
  // the loader stays up — a rejected account never sees Home, not one frame.
  if (!authChecked || !isAuthenticated || !accessChecked || !accessAllowed) {
    return <HomeMainLoading />;
  }

  return (
    <RegularUserNavigator
      profileImageUrl={profileImageUrl}
      bottomInset={insets.bottom}
      markAllAsReadRef={markAllAsReadRef}
    />
  );
}

// Stable tab-icon components, hoisted to module scope so the memoized navigator
// below can reference them WITHOUT creating fresh `tabBarIcon` closures (and
// fresh option objects) on every render. The unread dot subscribes to the
// notification context inside `TabUnreadBadge` itself, so badge updates only
// re-render that leaf view — never the tab bar during a tap.
function HomeTabIcon({ focused }) {
  return (
    <View style={styles.iconContainer}>
      <Ionicons
        name={focused ? "home" : "home-outline"}
        size={24}
        color={focused ? "#0EA5E9" : "#94A3B8"}
      />
      {focused && <View style={styles.activeIndicator} />}
    </View>
  );
}

function NotificationsTabIcon({ focused }) {
  return (
    <View style={styles.iconContainer}>
      <Ionicons
        name={focused ? "notifications" : "notifications-outline"}
        size={24}
        color={focused ? "#0EA5E9" : "#94A3B8"}
      />
      <TabUnreadBadge focused={focused} />
      {focused && <View style={styles.activeIndicator} />}
    </View>
  );
}

function ProfileTabIcon({ focused, source }) {
  return (
    <View style={styles.iconContainer}>
      <Image
        source={source}
        style={[styles.avatar, focused && styles.activeAvatar]}
      />
      {focused && <View style={styles.activeIndicator} />}
    </View>
  );
}

const HOME_TAB_OPTIONS = {
  href: "/regular_user/home",
  tabBarIcon: HomeTabIcon,
};

const NOTIFICATIONS_TAB_OPTIONS = {
  href: "/regular_user/notifications",
  tabBarIcon: NotificationsTabIcon,
};

// Memoized navigator subtree: re-renders only when the avatar URL or the bottom
// safe-area inset changes. This is what keeps a notification/report snapshot —
// which re-renders `RegularUserTabs` through the notification context — from
// rebuilding the ~25 screen option objects and re-rendering the tab bar while
// the user is tapping a tab (felt as ~0.5s input latency on slower phones).
const RegularUserNavigator = memo(function RegularUserNavigator({
  profileImageUrl,
  bottomInset,
  markAllAsReadRef,
}) {
  const avatarSource = useMemo(
    () =>
      profileImageUrl
        ? { uri: profileImageUrl }
        : require("../../assets/images/default_account.png"),
    [profileImageUrl],
  );

  // `screenOptions` is the same object identity across renders unless the
  // bottom inset changes — otherwise React Navigation recomputes options for
  // every screen on each parent render (felt as tap latency).
  const screenOptions = useMemo(
    () => ({
      headerShown: false,
      tabBarShowLabel: false,
      tabBarStyle: [
        styles.tabBar,
        {
          height: TAB_BAR_HEIGHT + bottomInset,
          paddingBottom: TAB_BAR_PADDING_BOTTOM + bottomInset,
        },
      ],
      tabBarItemStyle: styles.tabItem,
      lazy: true,
      // Keep the (already mounted) tab screens from re-rendering while they
      // are not focused — their data hooks still fire, but React skips the
      // render pass, which keeps the JS thread free for tab switches.
      freezeOnBlur: true,
    }),
    [bottomInset],
  );

  // The avatar image depends on the profile URL, so the profile tab's options
  // object is memoized per avatar — not rebuilt inline on every render.
  const profileTabOptions = useMemo(
    () => ({
      href: "/regular_user/profile",
      tabBarIcon: ({ focused }) => (
        <ProfileTabIcon focused={focused} source={avatarSource} />
      ),
    }),
    [avatarSource],
  );

  // `listeners` must be a stable reference too, or the navigator re-subscribes
  // on every render. The ref indirection keeps it independent of the
  // notification context value (a fresh object on each snapshot delivery).
  const notificationsListeners = useMemo(
    () => ({
      // Mark notifications as read only when the user LEAVES the
      // notifications tab (blur), not when they open it. This way the
      // unread highlights in the list stay visible while the user is
      // viewing them, and only clear once they navigate away (e.g. to
      // Home) and come back — matching YouTube-style read behavior.
      blur: () => {
        markAllAsReadRef.current?.();
      },
    }),
    [markAllAsReadRef],
  );

  return (
    <>
<RegularUserPresenceSync />
<PushNotificationSync />
      <SystemNotificationSync />
<FloatingNotification />
      <NoInternetNotification />
      <BackInternetNotification />
      <Tabs screenOptions={screenOptions}>
        <Tabs.Screen name="home" options={HOME_TAB_OPTIONS} />

      <Tabs.Screen
        name="notifications"
        options={NOTIFICATIONS_TAB_OPTIONS}
        listeners={notificationsListeners}
      />


      <Tabs.Screen name="profile" options={profileTabOptions} />

      {/* Hidden routes (still navigable) */}
      <Tabs.Screen name="report" options={{ href: null }} />
      <Tabs.Screen
        name="create_report/submitted"
        options={{ href: null, tabBarStyle: { display: "none" } }}
      />
      <Tabs.Screen name="notifications/notification_main" options={{ href: null }} />
      <Tabs.Screen name="view-reports" options={{ href: null }} />
      <Tabs.Screen name="create_report/createreport" options={{ href: null }} />
      <Tabs.Screen name="profile/profileview" options={{ href: null }} />
      <Tabs.Screen name="my_report/index" options={{ href: null }} />
      <Tabs.Screen
        name="my_report/edit_myreport"
        options={{ href: null, tabBarStyle: { display: "none" } }}
      />
      <Tabs.Screen name="my_report/share_reportmain" options={{ href: null }} />
      <Tabs.Screen name="reports-list" options={{ href: null }} />
      <Tabs.Screen name="all_reports/all_reportlist" options={{ href: null }} />
      <Tabs.Screen
        name="view_allrep/attachment_lightbox"
        options={{ href: null, tabBarStyle: { display: "none" } }}
      />
      <Tabs.Screen
        name="attachment_lightbox_user"
        options={{ href: null, tabBarStyle: { display: "none" } }}
      />
      <Tabs.Screen name="view_reportuser" options={{ href: null, tabBarStyle: { display: "none" } }} />
      <Tabs.Screen name="view_allrep/viewallreports" options={{ href: null, tabBarStyle: { display: "none" } }} />
      <Tabs.Screen name="status/RegularUserPresenceSync" options={{ href: null, tabBarStyle: { display: "none" } }} />
      <Tabs.Screen name="assistant/assistant_main" options={{ href: null, tabBarStyle: { display: "none" } }} />
      <Tabs.Screen name="directory" options={{ href: null }} />
      <Tabs.Screen name="about" options={{ href: null }} />
        <Tabs.Screen
          name="signout"
          options={{ href: null, tabBarStyle: { display: "none" } }}
        />
      </Tabs>
    </>
  );
});

const styles = StyleSheet.create({
  tabBar: {
    height: TAB_BAR_HEIGHT,
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 0,
    position: "absolute",
    paddingBottom: TAB_BAR_PADDING_BOTTOM,
    paddingTop: 12,
    paddingHorizontal: 16,
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
    elevation: 10,
  },

  tabItem: {
    justifyContent: "center",
    alignItems: "center",
  },

  iconContainer: {
    alignItems: "center",
    justifyContent: "center",
  },

  activeIndicator: {
    marginTop: 6,
    width: 16,
    height: 4,
    backgroundColor: "#0EA5E9",
    borderRadius: 2,
  },

  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: "transparent",
  },

  activeAvatar: {
    borderColor: "#0EA5E9",
  },

  loading: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#F8FAFC",
  },
});
