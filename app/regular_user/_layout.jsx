import { Ionicons } from "@expo/vector-icons";
import { Tabs, useRouter } from "expo-router";
import { onAuthStateChanged } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { useEffect, useRef, useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
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
  getSavedLogin,
} from "../../components/main_layout/save_loginfunc";
import {
  getProfileCache,
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
// "flip-flop" this grace window exists to prevent. 6s matches the 6s loading
// overlay timeout in `components/loading/restore_session/loading_session.tsx`
// for coherent behavior.
const AUTH_RESTORE_GRACE_MS = 6000;

export default function RegularUserLayout() {
  return (
    <ReportNotificationsProvider>
      <RegularUserTabs />
    </ReportNotificationsProvider>
  );
}

function RegularUserTabs() {
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
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
        setProfileImageUrl(null);
        handleNoCurrentUser();
      } else {
        // A session arrived (restored or fresh) — cancel any pending grace
        // fallback and show the tab UI.
        clearGraceTimer();
        hasSavedLoginRef.current = false;
        markerPendingRef.current = false;
        setIsAuthenticated(true);
        redirectingRef.current = false;
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
    };
  }, [router]);

  const tabAvatarSource = profileImageUrl
    ? { uri: profileImageUrl }
    : require("../../assets/images/default_account.png");

if (!authChecked || !isAuthenticated) {
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
          tabBarStyle: styles.tabBar,
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
    height: 70,
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 0,
    position: "absolute",
    paddingBottom: 12,
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
