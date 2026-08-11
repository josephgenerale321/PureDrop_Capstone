import { Ionicons } from "@expo/vector-icons";
import { useRouter, type Href } from "expo-router";
import { onAuthStateChanged } from "firebase/auth";
import {
  collectionGroup,
  doc,
  getDoc,
  onSnapshot,
  type DocumentData,
  type QuerySnapshot,
} from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { FlashList } from "@shopify/flash-list";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import AllRepComponent, { type AllReportListItem } from "../../../components/all_reports/all_repcomponent";
import { uidToNumber } from "../../../lib/uidToNumber";
import { auth, db } from "../../../firebaseConfig";

const LOGIN_ROUTE = "/login" as Href;

type UserProfileCache = Record<
  string,
  {
    fullName?: string;
    profileImageUrl?: string;
  }
>;

type RawReport = {
  reportId?: unknown;
  userId?: unknown;
  category?: unknown;
  status?: unknown;
  submittedAt?: unknown;
  createdAt?: unknown;
  reporterName?: unknown;
  reporterAvatarUrl?: unknown;
};

const normalizeStatus = (value: unknown) => {
  if (typeof value !== "string") return "Pending";
const normalized = value.trim().toLowerCase();
  if (normalized === "approved") return "Approved";
  if (normalized === "resolving" || normalized === "resolved") return "Resolving";
  if (normalized === "pending" || normalized === "submitted") return "Pending";
  if (normalized === "rejected") return "Rejected";
  return "Pending";
};

const toEpoch = (value: unknown) => {
  if (typeof value === "string") {
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? 0 : ms;
  }
  if (value && typeof value === "object" && "toDate" in (value as Record<string, unknown>)) {
    try {
      const dateValue = (value as { toDate: () => Date }).toDate();
      return dateValue.getTime();
    } catch {
      return 0;
    }
  }
  return 0;
};

export default function AllReportListScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [reports, setReports] = useState<AllReportListItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [retryCounter, setRetryCounter] = useState(0);

  useEffect(() => {
    let unsubscribeReports: (() => void) | null = null;

    const unsubscribeAuth = onAuthStateChanged(auth, (currentUser) => {
      if (unsubscribeReports) {
        unsubscribeReports();
        unsubscribeReports = null;
      }

      if (!currentUser) {
        setReports([]);
        setLoading(false);
        router.replace(LOGIN_ROUTE);
        return;
      }

      const profileCache: UserProfileCache = {};
      const reportsRef = collectionGroup(db, "reports");

      unsubscribeReports = onSnapshot(
        reportsRef,
        async (snapshot: QuerySnapshot<DocumentData>) => {
          const docs = snapshot.docs.map((docSnap) => {
            const data = (docSnap.data() ?? {}) as RawReport;
            return {
              fallbackReportId: docSnap.id,
              reportId: typeof data.reportId === "string" && data.reportId.length > 0 ? data.reportId : docSnap.id,
              userId: typeof data.userId === "string" ? data.userId : "",
              category: typeof data.category === "string" ? data.category : "Uncategorized",
              status: normalizeStatus(data.status),
              submittedAt:
                typeof data.submittedAt === "string"
                  ? data.submittedAt
                  : "",
              createdAt: data.createdAt,
              reporterName: typeof data.reporterName === "string" ? data.reporterName : "",
              reporterAvatarUrl:
                typeof data.reporterAvatarUrl === "string" && data.reporterAvatarUrl.length > 0
                  ? data.reporterAvatarUrl
                  : null,
            };
          });

          const uniqueUserIds = Array.from(
            new Set(docs.map((item) => item.userId).filter((id) => typeof id === "string" && id.length > 0))
          );

          await Promise.all(
            uniqueUserIds.map(async (uid) => {
              if (profileCache[uid]) {
                return;
              }
              try {
                const userRef = doc(db, "regular_user", uid);
                const userSnap = await getDoc(userRef);
                if (!userSnap.exists()) {
                  profileCache[uid] = {};
                  return;
                }
                const userData = userSnap.data() as { fullName?: unknown; profileImageUrl?: unknown };
                profileCache[uid] = {
                  fullName: typeof userData.fullName === "string" ? userData.fullName : undefined,
                  profileImageUrl:
                    typeof userData.profileImageUrl === "string" ? userData.profileImageUrl : undefined,
                };
              } catch {
                profileCache[uid] = {};
              }
            })
          );

          const normalized = docs
            .map((item) => {
              const profile = item.userId ? profileCache[item.userId] : undefined;
              return {
                reportId: item.reportId,
                userId: item.userId,
                category: item.category,
                status: item.status,
                submittedAt: item.submittedAt,
                reporterName:
                  item.reporterName
                  || profile?.fullName
                  || (item.userId ? `User ${uidToNumber(item.userId)}` : "Unknown User"),
                reporterAvatarUrl: item.reporterAvatarUrl || profile?.profileImageUrl || null,
              } satisfies AllReportListItem;
            })
            .sort((a, b) => {
              const aMs = toEpoch(a.submittedAt);
              const bMs = toEpoch(b.submittedAt);
              return bMs - aMs;
            });

          setReports(normalized);
          setError(null);
          setLoading(false);
        },
        (snapshotError) => {
          const err = snapshotError as { code?: string; message?: string };
          const rawMessage = err.message || "Failed to load community reports.";
          const rawCode = err.code || "unknown";
          const isPermissionError =
            rawMessage.toLowerCase().includes("permission") ||
            rawMessage.toLowerCase().includes("insufficient") ||
            rawCode.toLowerCase().includes("permission-denied");

          setReports([]);
          setLoading(false);
          setError(
            isPermissionError
              ? `Missing permissions (${rawCode}). ${rawMessage}`
              : `${rawCode}: ${rawMessage}`
          );
        }
      );
    });

    return () => {
      unsubscribeAuth();
      if (unsubscribeReports) {
        unsubscribeReports();
      }
    };
  }, [router, retryCounter]);

  const monthLabel = useMemo(() => {
    const now = new Date();
    return now.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  }, []);

  const handleRetry = () => {
    try {
      setLoading(true);
      setError(null);
      setRetryCounter((prev) => prev + 1);
    } catch {
      // Silently fail — retry should not crash the app
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#0284c7" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={[styles.header, { paddingTop: Math.max(10, insets.top + 2) }]}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.replace("/regular_user/home")}
          activeOpacity={0.85}
          hitSlop={{ top: 12, right: 12, bottom: 12, left: 12 }}
        >
          <Ionicons name="arrow-back" size={24} color="#0F172A" />
        </TouchableOpacity>
        <Text style={styles.title}>Report Lists</Text>
      </View>

      <Text style={styles.monthText}>{monthLabel}</Text>

      {error ? (
        <View style={styles.errorContainer}>
          <View style={styles.errorIconWrap}>
            <Ionicons name="alert-circle-outline" size={32} color="#EF4444" />
          </View>
          <Text style={styles.errorTitle}>Unable to load reports</Text>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={handleRetry}
            activeOpacity={0.85}
          >
            <Ionicons name="refresh-outline" size={18} color="#FFFFFF" />
            <Text style={styles.retryButtonText}>Try Again</Text>
          </TouchableOpacity>
        </View>
) : (
        <FlashList
          data={reports}
          keyExtractor={(item) => `${item.userId}-${item.reportId}`}
contentContainerStyle={styles.listContent}
          ListEmptyComponent={<Text style={styles.emptyText}>No reports yet.</Text>}
          renderItem={({ item }) => (
            <AllRepComponent
              item={item}
              onPress={() =>
                router.push({
                  pathname: "/regular_user/view_allrep/viewallreports",
                  params: { reportId: item.reportId, userId: item.userId },
                })
              }
            />
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F8FAFC",
    paddingHorizontal: 20,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 16,
    zIndex: 2,
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 3,
  },
  title: {
    color: "#0F172A",
    fontSize: 24,
    fontWeight: "800",
  },
  monthText: {
    color: "#475569",
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 16,
    marginLeft: 4,
  },
  listContent: {
    paddingBottom: 24,
  },
  emptyText: {
    color: "#475569",
    textAlign: "center",
    fontSize: 14,
    marginTop: 30,
  },
  errorText: {
    color: "#ef4444",
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 20,
  },
  errorContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    paddingBottom: 60,
  },
  errorIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "#FEF2F2",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  errorTitle: {
    color: "#0F172A",
    fontSize: 18,
    fontWeight: "800",
    textAlign: "center",
    marginBottom: 8,
  },
  retryButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#0EA5E9",
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 14,
    shadowColor: "#0EA5E9",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  retryButtonText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700",
  },
});
