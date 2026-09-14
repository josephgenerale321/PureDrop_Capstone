import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { FlashList } from "@shopify/flash-list";
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
  if (status === "Approved" || status === "Verified") return "#166534";
  if (status === "Resolving") return "#1d4ed8";
  if (status === "Rejected") return "#b91c1c";
  return "#1f2937";
};

const getStatusIcon = (status: string): keyof typeof Ionicons.glyphMap => {
  if (status === "Approved" || status === "Verified") return "checkmark-circle";
  if (status === "Resolving") return "construct";
  if (status === "Rejected") return "close-circle";
  return "time";
};

const getStatusIconColor = (status: string) => {
  if (status === "Approved" || status === "Verified") return "#16A34A";
  if (status === "Resolving") return "#2563EB";
  if (status === "Rejected") return "#DC2626";
  return "#94A3B8";
};

const getStatusWrapStyle = (status: string) => {
  if (status === "Approved" || status === "Verified") return styles.statusWrapApproved;
  if (status === "Resolving") return styles.statusWrapResolving;
  if (status === "Rejected") return styles.statusWrapRejected;
  return styles.statusWrapPending;
};

const getCardTitle = (item: NotificationItem) => {
  if (item.kind === "verification") {
    return "Account Verification";
  }
  return `Report #${item.reportId}`;
};

const getCardAccessibilityLabel = (item: NotificationItem) => {
  if (item.kind === "verification") {
    return `Open account verification notification, status ${item.status}`;
  }
  return `Open report ${item.reportId} notification`;
};

function NotificationCard({
  item,
  lastSeenMs,
  verificationSeenKey,
  verificationSeenLoaded,
  onOpenReport,
  onVisible,
}: {
  item: NotificationItem;
  lastSeenMs: number;
  verificationSeenKey: string | null;
  verificationSeenLoaded: boolean;
  onOpenReport: (item: NotificationItem) => void;
  onVisible?: (item: NotificationItem) => void;
}) {
  // Verification cards are informational only — the message already carries
  // the full decision text, and the celebration / rejection screens are
  // login-gate one-timers that bounce straight Home on revisit. Making the
  // card tappable would push there and instantly bounce back (ping-pong),
  // so only report cards navigate. Verification unread is per-decision
  // (seenKey), never wall-clock — its timestamps are frozen post-decision.
  const isVerification = item.kind === "verification";
  const unread = isNotificationUnread(
    item,
    lastSeenMs,
    verificationSeenKey,
    verificationSeenLoaded,
  );

  // Screen-view acknowledgement: the moment this card is actually RENDERED as
  // visible-and-unread, the decision counts as seen — viewing IS reading.
  // Debounced via onVisible so a navigation flash (notification screen briefly
  // mounts while the router settles the home redirect) cannot mark an item
  // read that the user never actually saw.
  const visibleAckTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (visibleAckTimer.current) {
        clearTimeout(visibleAckTimer.current);
        visibleAckTimer.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!onVisible || !unread) {
      return;
    }
    if (visibleAckTimer.current) {
      clearTimeout(visibleAckTimer.current);
    }
    visibleAckTimer.current = setTimeout(() => {
      visibleAckTimer.current = null;
      onVisible(item);
    }, 800);
    return () => {
      if (visibleAckTimer.current) {
        clearTimeout(visibleAckTimer.current);
        visibleAckTimer.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id, item.seenKey, unread]);

  if (isVerification) {
    return (
      <View
        style={[
          styles.card,
          unread && styles.unreadCard,
        ]}
        accessibilityRole="text"
        accessibilityLabel={`Account verification notification, status ${item.status}`}
      >
        {unread ? <View style={styles.unreadAccent} /> : null}
        <View style={styles.rowBetween}>
          <View style={styles.reportTitleWrap}>
            {unread ? <View style={styles.inPageRedDot} /> : null}
            <Text style={styles.reportId}>{getCardTitle(item)}</Text>
          </View>
          <View style={[styles.statusWrap, getStatusWrapStyle(item.status)]}>
            <Ionicons name={getStatusIcon(item.status)} size={13} color={getStatusIconColor(item.status)} />
            <Text style={[styles.status, { color: getStatusColor(item.status) }]}>{item.status}</Text>
          </View>
        </View>

        <Text style={styles.message}>{item.message}</Text>

        <View style={styles.footerRow}>
          <Text style={styles.date}>{formatRelativeTime(item.createdAtMs)}</Text>
        </View>
      </View>
    );
  }

  return (
    <TouchableOpacity
      style={[
        styles.card,
        unread && styles.unreadCard,
      ]}
      onPress={() => onOpenReport(item)}
      activeOpacity={0.82}
      accessibilityRole="button"
      accessibilityLabel={getCardAccessibilityLabel(item)}
    >
      {unread ? <View style={styles.unreadAccent} /> : null}
      <View style={styles.rowBetween}>
        <View style={styles.reportTitleWrap}>
          {unread ? <View style={styles.inPageRedDot} /> : null}
          <Text style={styles.reportId}>{getCardTitle(item)}</Text>
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
    verificationSeenKey,
    verificationSeenLoaded,
    markAllAsRead,
    markVerificationAsSeen,
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

  // Auto-ack verification on stable view: opening the bell and actually
  // SEEING the verification card marks that decision seen (reports are
  // untouched — same split as the floating-banner tap path). Debounced by
  // the card (800ms mounted + still unread) so a routing flash that briefly
  // mounts this screen on the way to home can never consume the decision
  // before the user views it.
  const verificationAckedRef = useRef<string | null>(null);
  const handleVerificationVisible = useCallback(
    (item: NotificationItem) => {
      const key = item.seenKey ?? null;
      if (key == null || verificationAckedRef.current === key) {
        return;
      }
      verificationAckedRef.current = key;
      void markVerificationAsSeen();
    },
    [markVerificationAsSeen],
  );

  // Reset the per-decision ack guard when a NEW decision arrives so the next
  // decision can auto-ack on view.
  useEffect(() => {
    const current = items.find((entry) => entry.kind === "verification");
    if (current?.seenKey !== verificationAckedRef.current) {
      verificationAckedRef.current = null;
    }
  }, [items]);

  const handleOpenReport = (item: NotificationItem) => {
    try {
      // Report cards open the report. Verification cards are NOT tappable
      // (rendered as a plain View above), so this only ever sees reports —
      // the guard below is just a type-level safety net.
      if (!item || item.kind === "verification" || !item.reportId) {
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
              You will receive updates here when the status of your submitted reports
              or your account verification changes.
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
<FlashList
            data={sections}
            keyExtractor={(section) => section.bucket}
            contentContainerStyle={styles.listContent}
            extraData={[lastSeenMs, verificationSeenKey, verificationSeenLoaded]}
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
                    verificationSeenKey={verificationSeenKey}
                    verificationSeenLoaded={verificationSeenLoaded}
                    onOpenReport={handleOpenReport}
                    onVisible={handleVerificationVisible}
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

