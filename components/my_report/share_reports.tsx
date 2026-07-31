import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Alert, Linking, Platform, Share, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export type ShareableReport = {
  reportId: string;
  category?: string | null;
  issue?: string | null;
  location?: string | null;
  gpsLocation?: string | null;
  status?: string | null;
};

const getReportLocation = (report: ShareableReport) =>
  report.location || report.gpsLocation || "N/A";

export const buildReportShareMessage = (report: ShareableReport) => {
  const lines = [
    "PureDrop Report",
    `Report #: ${report.reportId}`,
    `Category: ${report.category || "Uncategorized"}`,
    `Issue: ${report.issue || "N/A"}`,
    `Location: ${getReportLocation(report)}`,
    `Status: ${report.status || "Pending"}`,
  ];

  return lines.join("\n");
};

const getWebShareUrl = (reportId: string) => {
  if (Platform.OS !== "web" || typeof window === "undefined") {
    return "";
  }

  const path = `/regular_user/my_report/share_reportmain?reportId=${encodeURIComponent(reportId)}`;
  return `${window.location.origin}${path}`;
};

export const shareReportToFacebook = async (report: ShareableReport) => {
  const message = buildReportShareMessage(report);
  const webShareUrl = getWebShareUrl(report.reportId);

  try {
    if (Platform.OS === "web") {
      const facebookUrl = new URL("https://www.facebook.com/sharer/sharer.php");
      facebookUrl.searchParams.set("u", webShareUrl || window.location.href);
      facebookUrl.searchParams.set("quote", message);
      window.open(facebookUrl.toString(), "_blank", "noopener,noreferrer");
      return;
    }

    await Share.share({
      title: "Share PureDrop Report",
      message,
      url: webShareUrl || undefined,
    });
  } catch {
    Alert.alert("Unable to share", "Please try sharing this report again.");
  }
};

export const shareReportToMessenger = async (report: ShareableReport) => {
  const message = buildReportShareMessage(report);
  const webShareUrl = getWebShareUrl(report.reportId);

  try {
    if (Platform.OS === "web") {
      const webNavigator = typeof navigator === "undefined" ? null : navigator;
      if (webNavigator && "share" in webNavigator && typeof webNavigator.share === "function") {
        await webNavigator.share({
          title: "Share PureDrop Report",
          text: message,
          url: webShareUrl || undefined,
        });
        return;
      }

      if (webNavigator?.clipboard?.writeText) {
        await webNavigator.clipboard.writeText(message);
      }
      window.open("https://www.messenger.com/", "_blank", "noopener,noreferrer");
      Alert.alert("Report copied", "Paste the copied report details into Messenger.");
      return;
    }

    await Share.share({
      title: "Share PureDrop Report to Messenger",
      message,
      url: webShareUrl || undefined,
    });
  } catch {
    Alert.alert("Unable to share", "Please try sharing this report again.");
  }
};

type ShareReportButtonProps = {
  report: ShareableReport;
};

export function ShareReportButton({ report }: ShareReportButtonProps) {
  return (
    <TouchableOpacity
      style={styles.shareButton}
      activeOpacity={0.85}
      onPress={() => shareReportToMessenger(report)}
      accessibilityRole="button"
      accessibilityLabel={`Share report ${report.reportId}`}
    >
      <Ionicons name="share-social" size={18} color="#FFFFFF" />
      <Text style={styles.shareButtonText}>Share</Text>
    </TouchableOpacity>
  );
}

const getParam = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] || "" : value || "";

export default function ShareReportScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    reportId?: string;
    category?: string;
    issue?: string;
    location?: string;
    gpsLocation?: string;
    status?: string;
  }>();

  const report: ShareableReport = {
    reportId: getParam(params.reportId) || "N/A",
    category: getParam(params.category),
    issue: getParam(params.issue),
    location: getParam(params.location),
    gpsLocation: getParam(params.gpsLocation),
    status: getParam(params.status),
  };

  const handleOpenFacebook = async () => {
    await shareReportToFacebook(report);
  };

  const handleOpenApp = async () => {
    if (Platform.OS === "web") {
      return;
    }

    await Linking.openURL("https://www.facebook.com/");
  };

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
          activeOpacity={0.85}
          hitSlop={{ top: 12, right: 12, bottom: 12, left: 12 }}
        >
          <Ionicons name="arrow-back" size={24} color="#0F172A" />
        </TouchableOpacity>
        <Text style={styles.title}>Share Report</Text>
        <View style={styles.headerSpacer} />
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>PureDrop Report #{report.reportId}</Text>
        <Text style={styles.detail}>Category: {report.category || "Uncategorized"}</Text>
        <Text style={styles.detail}>Issue: {report.issue || "N/A"}</Text>
        <Text style={styles.detail}>Location: {getReportLocation(report)}</Text>
        <Text style={styles.detail}>Status: {report.status || "Pending"}</Text>

        <TouchableOpacity style={styles.primaryButton} onPress={handleOpenFacebook} activeOpacity={0.85}>
          <Ionicons name="logo-facebook" size={20} color="#FFFFFF" />
          <Text style={styles.primaryButtonText}>Share to Facebook</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.primaryButton, styles.messengerPrimaryButton]}
          onPress={() => shareReportToMessenger(report)}
          activeOpacity={0.85}
        >
          <Ionicons name="chatbubble-ellipses" size={20} color="#FFFFFF" />
          <Text style={styles.primaryButtonText}>Share to Messenger</Text>
        </TouchableOpacity>

        {Platform.OS !== "web" ? (
          <TouchableOpacity style={styles.secondaryButton} onPress={handleOpenApp} activeOpacity={0.85}>
            <Text style={styles.secondaryButtonText}>Open Facebook</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#F8FAFC",
    paddingHorizontal: 20,
  },
  header: {
    paddingTop: 20,
    paddingBottom: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 3,
  },
  title: {
    color: "#0F172A",
    fontSize: 22,
    fontWeight: "800",
  },
  headerSpacer: {
    width: 40,
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    padding: 20,
    gap: 10,
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  cardTitle: {
    color: "#0F172A",
    fontSize: 18,
    fontWeight: "800",
    marginBottom: 6,
  },
  detail: {
    color: "#475569",
    fontSize: 14,
    lineHeight: 20,
  },
  shareButton: {
    marginTop: 14,
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#1877F2",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
  },
  shareButtonText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "800",
  },
  primaryButton: {
    marginTop: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#1877F2",
    paddingVertical: 14,
    borderRadius: 14,
  },
  messengerPrimaryButton: {
    marginTop: 0,
    backgroundColor: "#0084FF",
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "800",
  },
  secondaryButton: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#CBD5E1",
  },
  secondaryButtonText: {
    color: "#0F172A",
    fontSize: 15,
    fontWeight: "700",
  },
});
