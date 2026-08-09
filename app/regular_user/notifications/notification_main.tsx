import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import {
  type NotificationItem,
  formatRelativeTime,
  useReportNotifications,
} from "../../../components/notifications/notif_func";
import {
  BUCKET_LABELS,
  groupNotificationsByTime,
  isNotificationUnread,
} from "../../../components/notifications/notif_reddot";
import { styles } from "../../../components/notifications/notif_styles";

const getStatusColor = (status: string) => {
  if (status === "Approved") return "#166534";
  if (status === "Resolving") return "#1d4ed8";
  if (status === "Rejected") return "#b91c1c";
  return "#1f2937";
};

const getStatusIcon = (status: string): keyof typeof Ionicons.glyphMap => {
  if (status === "Approved") return "checkmark-circle";
  if (status === "Resolving") return "construct";
  if (status === "Rejected") return "close-circle";
  return "time";
};

const getStatusIconColor = (status: string) => {
  if (status === "Approved") return "#16A34A";
  if (status === "Resolving") return "#2563EB";
  if (status === "Rejected") return "#DC2626";
  return "#94A3B8";
};

const getStatusWrapStyle = (status: string) => {
  if (status === "Approved") return styles.statusWrapApproved;
  if (status === "Resolving") return styles.statusWrapResolving;
  if (status === "Rejected") return styles.statusWrapRejected;
  return styles.statusWrapPending;
};

function NotificationCard({
  item,
  lastSeenMs,
  onOpenReport,
}: {
  item: NotificationItem;
  lastSeenMs: number;
  onOpenReport: (item: NotificationItem) => void;
}) {
  return (
    <TouchableOpacity
      style={[
        styles.card,
        isNotificationUnread(item, lastSeenMs) && styles.unreadCard,
      ]}
      onPress={() => onOpenReport(item)}
      activeOpacity={0.82}
      accessibilityRole="button"
      accessibilityLabel={`Open report ${item.reportId} notification`}
    >
      {isNotificationUnread(item, lastSeenMs) ? <View style={styles.unreadAccent} /> : null}
      <View style={styles.rowBetween}>
        <View style={styles.reportTitleWrap}>
          {isNotificationUnread(item, lastSeenMs) ? <View style={styles.inPageRedDot} /> : null}
          <Text style={styles.reportId}>Report #{item.reportId}</Text>
        </View>
        <View style={[styles.statusWrap, getStatusWrapStyle(item.status)]}>
          <Ionicons name={getStatusIcon(item.status)} size={13} color={getStatusIconColor(item.status)} />
          <Text style={[styles.status, { color: getStatusColor(item.status) }]}>{item.status}</Text>
        </View>
      </View>

      <Text style={styles.message}>{item.message}</Text>

      {item.category || item.issue ? (
        <View style={styles.contextRow}>
          {item.category ? <Text style={styles.contextCategory}>{item.category}</Text> : null}
          {item.issue ? (
            <Text style={styles.contextIssue} numberOfLines={1}>
              {item.issue}
            </Text>
          ) : null}
        </View>
      ) : null}

      <View style={styles.footerRow}>
        <Text style={styles.date}>{formatRelativeTime(item.createdAtMs)}</Text>
        <View style={styles.openRow}>
          <Text style={styles.openText}>View report</Text>
          <Ionicons name="chevron-forward" size={14} color="#2563EB" />
        </View>
      </View>
    </TouchableOpacity>
  );
}

export default function NotificationScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const {
    items,
    loading,
    hasError,
    refreshing,
    unreadCount,
    lastSeenMs,
    markAllAsRead,
    refresh,
  } = useReportNotifications();

  const sections = groupNotificationsByTime(items);

  const handleGoToReports = () => {
    try {
      router.push("/regular_user/view-reports");
    } catch {
      // Silently fail - navigation errors should not crash the app
    }
  };

  const handleOpenReport = (item: NotificationItem) => {
    try {
      if (!item || !item.reportId) {
        return;
      }

      router.push({
        pathname: "/regular_user/view_reportuser",
        params: { reportId: item.reportId },
      });
    } catch {
      try {
        router.push("/regular_user/view-reports");
      } catch {
        // Silently fail - navigation errors should not crash the app
      }
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.animatedScreen}>
        <View style={[styles.header, { paddingTop: Math.max(8, insets.top + 2) }]}>
<TouchableOpacity
            style={styles.backButton}
            onPress={() => router.navigate("/regular_user/home")}
            hitSlop={{ top: 12, right: 12, bottom: 12, left: 12 }}
            accessibilityRole="button"
            accessibilityLabel="Go back to home"
          >
            <Ionicons name="chevron-back" size={24} color="#0F172A" />
          </TouchableOpacity>

          <Text style={styles.title}>Notifications</Text>
          <View style={styles.badgeWrap}>
            {unreadCount > 0 ? (
<TouchableOpacity
                style={styles.markReadButton}
                onPress={markAllAsRead}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel="Mark all notifications as read"
              >
                <Text style={styles.markReadText}>Read</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>

        {loading ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color="#0284c7" />
          </View>
        ) : hasError && items.length === 0 ? (
          <View style={styles.emptyContainer}>
            <View style={styles.emptyIconWrap}>
              <Ionicons name="cloud-offline-outline" size={48} color="#94A3B8" />
            </View>
            <Text style={styles.emptyTitle}>{"Couldn't load notifications"}</Text>
            <Text style={styles.emptySub}>
              {"We couldn't fetch your notifications. Check your connection and try again."}
            </Text>
            <TouchableOpacity
              style={styles.emptyCta}
              onPress={refresh}
              activeOpacity={0.85}
            >
              <Ionicons name="refresh" size={20} color="#FFFFFF" />
              <Text style={styles.emptyCtaText}>Try Again</Text>
            </TouchableOpacity>
          </View>
        ) : items.length === 0 ? (
          <View style={styles.emptyContainer}>
            <View style={styles.emptyIconWrap}>
              <Ionicons name="notifications-outline" size={48} color="#94A3B8" />
            </View>
            <Text style={styles.emptyTitle}>No notifications yet</Text>
            <Text style={styles.emptySub}>
              You will receive updates here when the status of your submitted reports changes.
            </Text>
            <TouchableOpacity
              style={styles.emptyCta}
              onPress={handleGoToReports}
              activeOpacity={0.85}
            >
              <Ionicons name="eye-outline" size={20} color="#FFFFFF" />
              <Text style={styles.emptyCtaText}>View My Reports</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <FlatList
            data={sections}
            keyExtractor={(section) => section.bucket}
            contentContainerStyle={styles.listContent}
            extraData={lastSeenMs}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={refresh}
                tintColor="#0284c7"
                colors={["#0284c7"]}
              />
            }
            renderItem={({ item: section }) => (
              <View key={section.bucket}>
                <Text style={styles.sectionHeader}>{BUCKET_LABELS[section.bucket]}</Text>
                {section.items.map((notification) => (
                  <NotificationCard
                    key={notification.id}
                    item={notification}
                    lastSeenMs={lastSeenMs}
                    onOpenReport={handleOpenReport}
                  />
                ))}
              </View>
            )}
          />
        )}
      </View>
    </SafeAreaView>
  );
}

