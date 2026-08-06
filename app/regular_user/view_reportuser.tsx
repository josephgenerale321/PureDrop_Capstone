import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { onAuthStateChanged } from "firebase/auth";
import { collection, doc, getDoc } from "firebase/firestore";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { auth, db } from "../../firebaseConfig";

type DetailedReport = {
  reportId: string;
  category: string;
  issue: string;
  location: string | null;
  gpsLocation: string | null;
  status: string;
  waterMeter: string | null;
  attachments: string[];
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

const normalizeReport = (value: unknown, fallbackId: string): DetailedReport => {
  const item = (value ?? {}) as Partial<DetailedReport>;
  return {
    reportId: typeof item.reportId === "string" && item.reportId.length > 0 ? item.reportId : fallbackId,
    category: typeof item.category === "string" ? item.category : "Uncategorized",
    issue: typeof item.issue === "string" ? item.issue : "",
    location: typeof item.location === "string" ? item.location : null,
    gpsLocation: typeof item.gpsLocation === "string" ? item.gpsLocation : null,
    status: normalizeStatus(item.status),
    waterMeter: typeof item.waterMeter === "string" ? item.waterMeter : null,
    attachments: Array.isArray(item.attachments)
      ? item.attachments.filter((url): url is string => typeof url === "string" && url.length > 0)
      : [],
  };
};

export default function ViewReportUserScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { reportId, userId } = useLocalSearchParams<{ reportId?: string; userId?: string }>();
  const [loading, setLoading] = useState(true);
  const [report, setReport] = useState<DetailedReport | null>(null);
  const [retryToggle, setRetryToggle] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (!currentUser) {
        setReport(null);
        setLoading(false);
        return;
      }

      const selectedReportId = typeof reportId === "string" ? reportId : "";
      const selectedUserId = typeof userId === "string" ? userId : "";
      if (!selectedReportId) {
        setReport(null);
        setLoading(false);
        return;
      }

      try {
        const ownerUserId = selectedUserId || currentUser.uid;
        const subReportRef = doc(collection(db, "regular_user", ownerUserId, "reports"), selectedReportId);
        const subReportSnap = await getDoc(subReportRef);

        if (subReportSnap.exists()) {
          setReport(normalizeReport(subReportSnap.data(), subReportSnap.id));
          setLoading(false);
          return;
        }

        if (selectedUserId) {
          setReport(null);
          setLoading(false);
          return;
        }

        const userDocRef = doc(db, "regular_user", currentUser.uid);
        const userSnap = await getDoc(userDocRef);
        if (!userSnap.exists()) {
          setReport(null);
          setLoading(false);
          return;
        }

        const legacyReports = Array.isArray(userSnap.data().reports) ? userSnap.data().reports : [];
        const foundLegacy = legacyReports.find(
          (item: unknown) =>
            typeof item === "object" &&
            item !== null &&
            "reportId" in (item as Record<string, unknown>) &&
            (item as Record<string, unknown>).reportId === selectedReportId
        );

        setReport(foundLegacy ? normalizeReport(foundLegacy, selectedReportId) : null);
      } catch {
        setReport(null);
      } finally {
        setLoading(false);
      }
    });

return () => unsubscribe();
  }, [reportId, userId, retryToggle]);

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#ffffff" />
        </View>
      </SafeAreaView>
    );
  }

  const handleRetry = () => {
    try {
      setLoading(true);
      setReport(null);
      // Re-trigger the effect by forcing a re-render via a state toggle
      setRetryToggle((prev) => !prev);
    } catch {
      // Silently fail — retry should not crash the app
    }
  };

  if (!report) {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <View style={styles.centered}>
          <View style={styles.errorIconWrap}>
            <Ionicons name="document-text-outline" size={48} color="#94A3B8" />
          </View>
          <Text style={styles.emptyTitle}>Report not found</Text>
          <Text style={styles.emptyText}>
            The report could not be loaded. It may have been removed or you may have a connection issue.
          </Text>
<View style={styles.errorActions}>
            <TouchableOpacity style={styles.backButton} onPress={() => router.replace("/regular_user/my_report")}>
              <Text style={styles.backButtonText}>Go Back</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.retryButton} onPress={handleRetry} activeOpacity={0.85}>
              <Ionicons name="refresh-outline" size={18} color="#FFFFFF" />
              <Text style={styles.retryButtonText}>Try Again</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
<ScrollView contentContainerStyle={[styles.scrollContent, { paddingTop: Math.max(16, insets.top + 6) }]}>
        <TouchableOpacity
          style={styles.topBack}
          onPress={() => router.replace("/regular_user/my_report")}
          activeOpacity={0.85}
          hitSlop={{ top: 12, right: 12, bottom: 12, left: 12 }}
        >
          <Ionicons name="arrow-back" size={26} color="#0F172A" />
        </TouchableOpacity>

        <View style={styles.card}>
          <Text style={styles.heading}>Problem Summary</Text>

          <Text style={styles.label}>Category:</Text>
          <Text style={styles.value}>{report.category}</Text>

          <Text style={styles.label}>Location (Toledo City only):</Text>
          <Text style={styles.value}>{report.location || "N/A"}</Text>

          <Text style={styles.label}>GPS Coordinates:</Text>
          <Text style={styles.value}>{report.gpsLocation || "N/A"}</Text>

          <Text style={styles.label}>Issue:</Text>
          <Text style={styles.value}>{report.issue || "N/A"}</Text>

          <Text style={styles.label}>Water Meter:</Text>
          <Text style={styles.value}>{report.waterMeter || "N/A"}</Text>

          <Text style={styles.label}>Attachments:</Text>
          {report.attachments.length === 0 ? (
            <Text style={styles.value}>No attachments</Text>
          ) : (
            <View style={styles.attachmentRow}>
              {report.attachments.map((uri, index) => (
                <TouchableOpacity
                  key={`${uri}-${index}`}
                  activeOpacity={0.86}
                  onPress={() =>
                    router.push({
                      pathname: "/regular_user/attachment_lightbox_user",
                      params: {
                        uri,
                        reportId: report.reportId,
                        userId: typeof userId === "string" ? userId : "",
                        index: String(index + 1),
                      },
                    })
                  }
                >
                  <Image source={{ uri }} style={styles.attachmentImage} />
                </TouchableOpacity>
              ))}
            </View>
          )}

          <Text style={styles.label}>Status:</Text>
          <Text style={styles.value}>{report.status}</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F8FAFC",
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingBottom: 28,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  topBack: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
    zIndex: 2,
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 3,
  },
  card: {
    borderRadius: 16,
    backgroundColor: "#FFFFFF",
    padding: 24,
    minHeight: 460,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 3,
  },
  heading: {
    fontSize: 22,
    fontWeight: "800",
    textAlign: "center",
    color: "#0F172A",
    marginBottom: 24,
  },
  label: {
    color: "#475569",
    fontSize: 13,
    fontWeight: "700",
    marginTop: 16,
    letterSpacing: 0.5,
  },
  value: {
    color: "#0F172A",
    fontSize: 16,
    marginTop: 6,
    marginBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#F1F5F9",
    paddingBottom: 8,
  },
  attachmentRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    marginTop: 10,
    marginBottom: 10,
  },
  attachmentImage: {
    width: 100,
    height: 100,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  emptyText: {
    color: "#475569",
    fontSize: 16,
    marginBottom: 16,
  },
  backButton: {
    backgroundColor: "#0EA5E9",
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 16,
  },
  backButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700",
  },
  errorIconWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "#F1F5F9",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
  },
  emptyTitle: {
    color: "#0F172A",
    fontSize: 20,
    fontWeight: "800",
    textAlign: "center",
    marginBottom: 12,
  },
  errorActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 12,
  },
  retryButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: "#334155",
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 16,
  },
  retryButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700",
  },
});
