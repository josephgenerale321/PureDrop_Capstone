import { Ionicons } from "@expo/vector-icons";
import { Tabs, useRouter } from "expo-router";
import { onAuthStateChanged } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, StyleSheet, View } from "react-native";
import { ReportNotificationsProvider, useReportNotifications } from "../../components/notifications/notif_func";
import PushNotificationSync from "../../components/notifications/push_notificationfunc";
import { auth, db } from "../../firebaseConfig";
import RegularUserPresenceSync from "./status/RegularUserPresenceSync";

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
  const { unreadCount, markAllAsRead } = useReportNotifications();

  useEffect(() => {
    let unsubscribeProfile = null;

    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      if (unsubscribeProfile) {
        unsubscribeProfile();
        unsubscribeProfile = null;
      }

      if (!currentUser) {
        setIsAuthenticated(false);
        setProfileImageUrl(null);
        if (!redirectingRef.current) {
          redirectingRef.current = true;
          router.replace("/login");
        }
      } else {
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
            setProfileImageUrl(
              typeof data.profileImageUrl === "string" && data.profileImageUrl.length > 0
                ? data.profileImageUrl
                : null
            );
          },
          () => {
            setProfileImageUrl(null);
          }
        );
      }
      setAuthChecked(true);
    });

    return () => {
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
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color="#1e88e5" />
      </View>
    );
  }

  return (
    <>
      <RegularUserPresenceSync />
      <PushNotificationSync />
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
              {unreadCount > 0 && !focused ? <View style={styles.notifDot} /> : null}
              {focused && <View style={styles.activeIndicator} />}
            </View>
          ),
        }}
        listeners={{
          focus: () => {
            // Mark read once when the tab gains focus. The hook is
            // idempotent — it skips the Firestore write when there are
            // no unread notifications — so repeated focus events cost
            // nothing. (The old code also wired tabPress and a pathname
            // effect, causing up to 3 redundant writes.)
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
    top: -2,
    right: -2,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#EF4444",
    borderWidth: 1.5,
    borderColor: "#FFFFFF",
  },

  loading: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#F8FAFC",
  },
});
