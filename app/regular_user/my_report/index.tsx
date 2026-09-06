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
  onEdit: (item: ReportItem) => void;
  onDelete: (item: ReportItem) => void;
};

// Height of the floating tab bar rendered by app/regular_user/_layout.jsx
// (position:"absolute", so it overlays the bottom of this screen's list).
// Must stay in sync with the `tabBar.height` style in that layout.
const TAB_BAR_HEIGHT = 70;
// Extra breathing room between the last card and the tab bar.
const LIST_BOTTOM_GAP = 16;

function ReportRow({ item, onOpen, onEdit, onDelete }: ReportRowProps) {
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
        <View style={styles.rowActionsRight}>
          <TouchableOpacity
            style={styles.editButton}
            onPress={() => onEdit(item)}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel={`Edit report ${item.reportId}`}
            hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
          >
            <Ionicons name="create-outline" size={20} color="#0284C7" />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.deleteButton}
            onPress={() => onDelete(item)}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel={`Delete report ${item.reportId}`}
            hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
          >
            <Ionicons name="trash-outline" size={20} color="#DC2626" />
          </TouchableOpacity>
        </View>
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

  const handleEditReport = (item: ReportItem) => {
    try {
      router.push({
        pathname: "/regular_user/my_report/edit_myreport",
        params: { reportId: item.reportId },
      });
    } catch {
      // Silently fail - navigation errors should not crash the app
    }
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
        contentContainerStyle={[
          styles.listContent,
          // The floating tab bar (position:absolute in the regular_user tab
          // layout) overlays the bottom of this screen — reserve its height
          // plus the device bottom inset so the last card's action row is
          // never hidden behind it.
          { paddingBottom: TAB_BAR_HEIGHT + insets.bottom + LIST_BOTTOM_GAP },
        ]}
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
            onEdit={handleEditReport}
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
