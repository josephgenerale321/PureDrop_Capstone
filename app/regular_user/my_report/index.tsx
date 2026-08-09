import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { FlashList } from "@shopify/flash-list";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { ShareReportButton } from "../../../components/my_report/share_reports";
import { styles } from "../../../components/my_report/myreportstyles";
import DeleteReportLightbox from "../../../components/my_report/DeleteReportLightbox";
import {
  ReportItem,
  useMyReports,
} from "../../../components/my_report/useMyReports";

type ReportRowProps = {
  item: ReportItem;
  onOpen: (item: ReportItem) => void;
  onDelete: (item: ReportItem) => void;
};

function ReportRow({ item, onOpen, onDelete }: ReportRowProps) {
  return (
    <View style={styles.card}>
      <TouchableOpacity activeOpacity={0.88} onPress={() => onOpen(item)}>
        <Text style={styles.cardTitle}>{item.category}</Text>
        <Text style={styles.cardIssue}>{item.issue}</Text>
        <Text style={styles.metaText}>
          Location (Toledo City only): {item.location || item.gpsLocation || "N/A"}
        </Text>
        <Text style={styles.metaText}>Status: {item.status}</Text>
      </TouchableOpacity>
      <View style={styles.rowActions}>
        <ShareReportButton report={item} />
        <TouchableOpacity
          style={styles.deleteButton}
          onPress={() => onDelete(item)}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel={`Delete report ${item.reportId}`}
        >
          <Text style={styles.deleteButtonText}>Delete</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

export default function MyReportScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { loading, reports, offline } = useMyReports();
  const [deleteTarget, setDeleteTarget] = useState<ReportItem | null>(null);

  const handleOpenReport = (item: ReportItem) => {
    router.push({
      pathname: "/regular_user/view_reportuser",
      params: { reportId: item.reportId },
    });
  };

  const handleDeleteReport = (item: ReportItem) => {
    // Open the in-screen delete lightbox for the selected report instead of
    // navigating to a separate route (avoids cross-navigator navigation errors).
    setDeleteTarget(item);
  };

  const handleCreateReport = () => {
    try {
      router.push("/regular_user/report");
    } catch {
      // Silently fail - navigation errors should not crash the app
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
      <View style={[styles.header, { paddingTop: Math.max(20, insets.top + 10) }]}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.replace("/regular_user/home")}
          activeOpacity={0.85}
          hitSlop={{ top: 12, right: 12, bottom: 12, left: 12 }}
        >
          <Ionicons name="arrow-back" size={24} color="#0F172A" />
        </TouchableOpacity>
        <Text style={styles.title}>My Reports</Text>
        <View style={styles.headerSpacer} />
      </View>

      {offline ? (
        <View style={styles.offlineBanner}>
          <Ionicons name="cloud-offline-outline" size={16} color="#B45309" />
          <Text style={styles.offlineText}>
            Offline — showing last saved reports
          </Text>
        </View>
      ) : null}

      <FlashList
        data={reports}
        keyExtractor={(item) => item.reportId}
contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <View style={styles.emptyIconWrap}>
              <Ionicons name="clipboard-outline" size={48} color="#94A3B8" />
            </View>
            <Text style={styles.emptyTitle}>No reports submitted yet</Text>
            <Text style={styles.emptySubtitle}>
              Your submitted water reports will appear here. Tap the button below to submit your first report.
            </Text>
            <TouchableOpacity
              style={styles.emptyCta}
              onPress={handleCreateReport}
              activeOpacity={0.85}
            >
              <Ionicons name="add-circle" size={20} color="#FFFFFF" />
              <Text style={styles.emptyCtaText}>Submit Your First Report</Text>
            </TouchableOpacity>
          </View>
        }
        renderItem={({ item }) => (
          <ReportRow
            item={item}
            onOpen={handleOpenReport}
            onDelete={handleDeleteReport}
          />
        )}
      />

      <DeleteReportLightbox
        visible={deleteTarget !== null}
        reportId={deleteTarget?.reportId}
        onClose={() => setDeleteTarget(null)}
        onDeleted={() => setDeleteTarget(null)}
      />
    </SafeAreaView>
  );
}
