import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback } from "react";
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import {
  type NotificationItem,
  useReportNotifications,
} from "../../../components/notifications/notif_func";

const getStatusColor = (status: string) => {
  if (status === "Approved") return "#166534";
  if (status === "Resolving") return "#1d4ed8";
  return "#1f2937";
};

const renderItem = ({ item }: { item: NotificationItem }) => (
  <View style={styles.card}>
    <View style={styles.rowBetween}>
      <Text style={styles.reportId}>Report #{item.reportId}</Text>
      <Text style={[styles.status, { color: getStatusColor(item.status) }]}>{item.status}</Text>
    </View>

    <Text style={styles.message}>{item.message}</Text>
    <Text style={styles.date}>{item.createdLabel}</Text>
  </View>
);

export default function NotificationScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { items, loading, markAllAsRead } = useReportNotifications();

  useFocusEffect(
    useCallback(() => {
      markAllAsRead();
    }, [markAllAsRead]),
  );

  const handleGoToReports = () => {
    try {
      router.push("/regular_user/view-reports");
    } catch {
      // Silently fail - navigation errors should not crash the app
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
          >
            <Ionicons name="chevron-back" size={24} color="#0F172A" />
          </TouchableOpacity>

          <Text style={styles.title}>Notifications</Text>
          <View style={styles.badgeWrap} />
        </View>

        {loading ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color="#0284c7" />
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
            data={items}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            renderItem={renderItem}
          />
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F8FAFC",
  },
  animatedScreen: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF",
    zIndex: 2,
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 3,
  },
  title: {
    color: "#0F172A",
    fontSize: 20,
    fontWeight: "800",
  },
  badgeWrap: {
    width: 40,
    alignItems: "flex-end",
  },
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 24,
    gap: 12,
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    padding: 16,
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  rowBetween: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  reportId: {
    color: "#0F172A",
    fontSize: 15,
    fontWeight: "800",
  },
  status: {
    fontSize: 13,
    fontWeight: "700",
  },
  message: {
    color: "#475569",
    fontSize: 14,
    marginBottom: 8,
    lineHeight: 20,
  },
  date: {
    color: "#94A3B8",
    fontSize: 12,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  emptyContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "flex-start",
    paddingTop: 60,
    paddingHorizontal: 24,
  },
  emptyTitle: {
    color: "#0F172A",
    fontSize: 20,
    fontWeight: "800",
    marginBottom: 8,
  },
  emptySub: {
    color: "#475569",
    fontSize: 14,
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 28,
    maxWidth: 300,
  },
  emptyIconWrap: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: "#F1F5F9",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
  },
  emptyCta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#0EA5E9",
    paddingHorizontal: 24,
    paddingVertical: 16,
    borderRadius: 16,
    shadowColor: "#0EA5E9",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 6,
  },
  emptyCtaText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700",
  },
});
