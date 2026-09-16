import { Ionicons } from "@expo/vector-icons";
import { Tabs, useRouter } from "expo-router";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDocFromCache, getDocFromServer, onSnapshot } from "firebase/firestore";
import { useEffect, useRef, useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import HomeMainLoading from "../../components/loading/homepage/homemain_loading";
import FloatingNotification from "../../components/notifications/floating_notif";
import { ReportNotificationsProvider, useReportNotifications } from "../../components/notifications/notif_func";
import PushNotificationSync from "../../components/notifications/push_notificationfunc";
import SystemNotificationSync from "../../components/notifications/system_notif";
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
  // grows by the bottom inset — which is 0 while ImmersiveNavBar has it hidden.
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
  const { unreadCount, markAllAsRead } = useReportNotifications();

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
          if (data) {
            if (data.verificationStatus === "rejected") {
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
              // Server unreachable — fail OPEN (old offline behaviour): a
              // valid user is never trapped on a loader. NOTE: a rejected
              // user on a fully-offline device can therefore still see cached
              // Home until the network returns — accepted tradeoff (Firestore
              // has no signed offline ACL); the online path above enforces it.
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

  const tabAvatarSource = profileImageUrl
    ? { uri: profileImageUrl }
    : require("../../assets/images/default_account.png");

  // Fail-closed: Home tabs render ONLY when auth is live AND the access
  // check proved this account is not rejected. Until then (or when bounced)
  // the loader stays up — a rejected account never sees Home, not one frame.
  if (!authChecked || !isAuthenticated || !accessChecked || !accessAllowed) {
    return <HomeMainLoading />;
  }

  return (
    <>
<RegularUserPresenceSync />
<PushNotificationSync />
      <SystemNotificationSync />
<FloatingNotification />
      <NoInternetNotification />
      <BackInternetNotification />
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarShowLabel: false,
          tabBarStyle: [
            styles.tabBar,
            {
              height: TAB_BAR_HEIGHT + insets.bottom,
              paddingBottom: TAB_BAR_PADDING_BOTTOM + insets.bottom,
            },
          ],
          tabBarItemStyle: styles.tabItem,
          lazy: true,
        }}
      >
        <Tabs.Screen
          name="home"
          options={{
            href: "/regular_user/home",
            tabBarIcon: ({ focused }) => (
              <View style={styles.iconContainer}>
                <Ionicons
                  name={focused ? "home" : "home-outline"}
                  size={24}
                  color={focused ? "#0EA5E9" : "#94A3B8"}
                />
                {focused && <View style={styles.activeIndicator} />}
              </View>
            ),
          }}
        />

      <Tabs.Screen
        name="notifications"
        options={{
          href: "/regular_user/notifications",
          tabBarIcon: ({ focused }) => (
            <View style={styles.iconContainer}>
              <Ionicons
                name={focused ? "notifications" : "notifications-outline"}
                size={24}
                color={focused ? "#0EA5E9" : "#94A3B8"}
              />
{unreadCount > 0 && !focused ? (
                <View style={styles.notifDot}>
                  <Text style={styles.notifDotText}>{unreadCount > 9 ? "9+" : String(unreadCount)}</Text>
                </View>
              ) : null}
              {focused && <View style={styles.activeIndicator} />}
            </View>
          ),
        }}
listeners={{
          // Mark notifications as read only when the user LEAVES the
          // notifications tab (blur), not when they open it. This way the
          // unread highlights in the list stay visible while the user is
          // viewing them, and only clear once they navigate away (e.g. to
          // Home) and come back — matching YouTube-style read behavior.
          blur: () => {
            markAllAsRead();
          },
        }}
      />


      <Tabs.Screen
        name="profile"
        options={{
          href: "/regular_user/profile",
          tabBarIcon: ({ focused }) => (
            <View style={styles.iconContainer}>
              <Image
                source={tabAvatarSource}
                style={[styles.avatar, focused && styles.activeAvatar]}
              />
              {focused && <View style={styles.activeIndicator} />}
            </View>
          ),
        }}
      />

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
}

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

notifDot: {
    position: "absolute",
    top: -4,
    right: -8,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#EF4444",
    borderWidth: 1.5,
    borderColor: "#FFFFFF",
  },

  notifDotText: {
    color: "#FFFFFF",
    fontSize: 10,
    fontWeight: "800",
    lineHeight: 12,
  },

  loading: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#F8FAFC",
  },
});
