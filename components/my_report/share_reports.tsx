import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  Alert,
  Clipboard,
  Linking,
  Platform,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

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

// Parses latitude/longitude from the stored GPS string (e.g.
// "Toledo City (10.377500, 123.638800)") so shares can include a Maps link.
const parseCoordinates = (value: string): { latitude: number; longitude: number } | null => {
  const match = value.match(/\(?(-?\d+\.?\d*),\s*(-?\d+\.?\d*)\)?/);
  if (!match) {
    return null;
  }
  const latitude = Number.parseFloat(match[1]);
  const longitude = Number.parseFloat(match[2]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }
  return { latitude, longitude };
};

// Google Maps link for the pinned location. Empty when the report has no
// parseable GPS coordinates — the line is then simply omitted.
const getMapsLink = (report: ShareableReport): string => {
  const coords = parseCoordinates(report.gpsLocation || "");
  if (!coords) {
    return "";
  }
  return `https://maps.google.com/?q=${coords.latitude},${coords.longitude}`;
};

export const buildReportShareMessage = (report: ShareableReport) => {
  const lines = [
    "PureDrop Report",
    `Report #: ${report.reportId}`,
    `Category: ${report.category || "Uncategorized"}`,
    `Issue: ${report.issue || "N/A"}`,
    `Location: ${getReportLocation(report)}`,
    `Status: ${report.status || "Pending"}`,
  ];

  // A Maps link makes the shared report actionable — recipients can see
  // exactly where the problem is, not just read about it.
  const mapsLink = getMapsLink(report);
  if (mapsLink) {
    lines.push(`Map: ${mapsLink}`);
  }

  return lines.join("\n");
};

const getWebShareUrl = (reportId: string) => {
  if (Platform.OS !== "web" || typeof window === "undefined") {
    return "";
  }

  const path = `/regular_user/my_report/share_reportmain?reportId=${encodeURIComponent(reportId)}`;
  return `${window.location.origin}${path}`;
};

const openMessengerFallback = (message: string) => {
  if (typeof window !== "undefined" && typeof window.open === "function") {
    window.open("https://www.messenger.com/", "_blank", "noopener,noreferrer");
  }

  Alert.alert(
    "Share unavailable",
    "The share feature is unavailable here, so the report was not sent automatically. You can copy the details or open Messenger manually."
  );
};

// Copies the share message to the device clipboard. Uses the web clipboard
// API on web and React Native's Clipboard on native. Returns whether the
// copy succeeded so the caller can show the right feedback.
export const copyReportDetails = async (report: ShareableReport): Promise<boolean> => {
  const message = buildReportShareMessage(report);

  try {
    if (Platform.OS === "web") {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(message);
        return true;
      }
      return false;
    }
    Clipboard.setString(message);
    return true;
  } catch {
    return false;
  }
};

// Opens the OS share sheet so the user can send the report through ANY app
// (Gmail, SMS, WhatsApp, ...). On web this is the browser share dialog when
// available. Share-sheet dismissal is not treated as an error.
export const shareReportToOtherApps = async (report: ShareableReport) => {
  const message = buildReportShareMessage(report);
  const webShareUrl = getWebShareUrl(report.reportId);

  try {
    if (Platform.OS === "web") {
      if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
        await navigator.share({
          title: "Share PureDrop Report",
          text: message,
          url: webShareUrl || undefined,
        });
        return;
      }
      Alert.alert(
        "Share unavailable",
        "Your browser does not support the share dialog. Copy the details instead and paste them anywhere."
      );
      return;
    }

    await Share.share({
      title: "Share PureDrop Report",
      message,
      url: webShareUrl || undefined,
    });
  } catch {
    // Ignored: the most common rejection is the user dismissing the share
    // sheet, which is not an error worth an alert.
  }
};

export const shareReportToFacebook = async (report: ShareableReport) => {
  const message = buildReportShareMessage(report);
  const webShareUrl = getWebShareUrl(report.reportId);

  try {
    if (Platform.OS === "web") {
      const facebookUrl = new URL("https://www.facebook.com/sharer/sharer.php");
      facebookUrl.searchParams.set("u", webShareUrl || (typeof window !== "undefined" ? window.location.href : ""));
      facebookUrl.searchParams.set("quote", message);
      if (typeof window !== "undefined" && typeof window.open === "function") {
        window.open(facebookUrl.toString(), "_blank", "noopener,noreferrer");
      }
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
  const shareText = `${message}${webShareUrl ? `\n\n${webShareUrl}` : ""}`;

  try {
    if (Platform.OS === "web") {
      const webNavigator = typeof navigator === "undefined" ? null : navigator;

      if (webNavigator && typeof webNavigator.share === "function") {
        try {
          await webNavigator.share({
            title: "Share PureDrop Report",
            text: shareText,
            url: webShareUrl || undefined,
          });
          return;
        } catch {
          // Fall back to clipboard or manual messenger open.
        }
      }

      if (webNavigator?.clipboard?.writeText) {
        try {
          await webNavigator.clipboard.writeText(shareText);
          Alert.alert("Report copied", "The report details were copied to your clipboard.");
          return;
        } catch {
          // Continue to manual fallback.
        }
      }

      openMessengerFallback(shareText);
      return;
    }

    try {
      await Share.share({
        title: "Share PureDrop Report to Messenger",
        message: shareText,
        url: webShareUrl || undefined,
      });
    } catch {
      Alert.alert("Unable to share", "Sharing is not available on this device right now.");
    }
  } catch {
    Alert.alert("Unable to share", "Please try sharing this report again.");
  }
};

type ShareReportButtonProps = {
  report: ShareableReport;
};

export function ShareReportButton({ report }: ShareReportButtonProps) {
  const router = useRouter();

  return (
    <TouchableOpacity
      style={styles.shareButton}
      activeOpacity={0.85}
      onPress={() => {
        // Open the share screen (preview + target choice) instead of firing
        // a generic system share immediately — the screen was previously
        // unreachable from inside the app.
        router.push({
          pathname: "/regular_user/my_report/share_reportmain",
          params: {
            reportId: report.reportId,
            category: report.category || "",
            issue: report.issue || "",
            location: report.location || "",
            gpsLocation: report.gpsLocation || "",
            status: report.status || "",
          },
        });
      }}
      accessibilityRole="button"
      accessibilityLabel={`Share report ${report.reportId}`}
      hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
    >
      <Ionicons name="share-social" size={20} color="#FFFFFF" />
    </TouchableOpacity>
  );
}

const getParam = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] || "" : value || "";

export default function ShareReportScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
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

  // Safe back: screens in the Tabs navigator stay mounted, so the history
  // stack may be empty (cold deep-link) — fall back to the My Reports tab.
  const handleBackPress = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/regular_user/my_report");
    }
  };

  const handleOpenFacebook = async () => {
    await shareReportToFacebook(report);
  };

  const handleCopyDetails = async () => {
    const didCopy = await copyReportDetails(report);
    Alert.alert(
      didCopy ? "Report copied" : "Copy failed",
      didCopy
        ? "The report details were copied to your clipboard."
        : "The details could not be copied. Please try again."
    );
  };

  const handleOpenApp = async () => {
    if (Platform.OS === "web") {
      return;
    }

    await Linking.openURL("https://www.facebook.com/");
  };

  // Same Maps link the share message uses, shown as a tappable chip so the
  // user can preview where recipients will be pointed.
  const mapsLink = getMapsLink(report);

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={handleBackPress}
          activeOpacity={0.85}
          hitSlop={{ top: 12, right: 12, bottom: 12, left: 12 }}
        >
          <Ionicons name="arrow-back" size={24} color="#0F172A" />
        </TouchableOpacity>
        <Text style={styles.title}>Share Report</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          // The floating tab bar (position:"absolute") overlays the bottom of
          // this screen — reserve its height + bottom inset + a gap so the
          // last button is never hidden behind it (same fix as About page).
          { paddingBottom: 70 + Math.max(0, insets.bottom) + 24 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.card}>
          <Text style={styles.cardTitle}>PureDrop Report #{report.reportId}</Text>
          <Text style={styles.detail}>Category: {report.category || "Uncategorized"}</Text>
          <Text style={styles.detail}>Issue: {report.issue || "N/A"}</Text>
          <Text style={styles.detail}>Location: {getReportLocation(report)}</Text>
          <Text style={styles.detail}>Status: {report.status || "Pending"}</Text>

          {mapsLink ? (
            <TouchableOpacity
              style={styles.mapsChip}
              onPress={() => Linking.openURL(mapsLink)}
              activeOpacity={0.85}
              accessibilityRole="link"
              accessibilityLabel="Open report location in maps"
            >
              <Ionicons name="location-outline" size={16} color="#0EA5E9" />
              <Text style={styles.mapsChipText} numberOfLines={1}>
                Open pinned location in Maps
              </Text>
              <Ionicons name="chevron-forward" size={14} color="#94A3B8" />
            </TouchableOpacity>
          ) : null}
        </View>

        {/* Share targets as icon-only buttons (brand-colored squares). */}
        <View style={styles.shareTargetsRow}>
          <TouchableOpacity
            style={[styles.shareIconButton, styles.facebookIconButton]}
            onPress={handleOpenFacebook}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Share to Facebook"
            hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
          >
            <Ionicons name="logo-facebook" size={26} color="#FFFFFF" />
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.shareIconButton, styles.messengerIconButton]}
            onPress={() => shareReportToMessenger(report)}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Share to Messenger"
            hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
          >
            <Ionicons name="chatbubble-ellipses" size={24} color="#FFFFFF" />
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={[styles.secondaryButton, styles.otherAppsButton]}
          onPress={() => shareReportToOtherApps(report)}
          activeOpacity={0.85}
        >
          <Ionicons name="share-social-outline" size={18} color="#0F172A" />
          <Text style={styles.secondaryButtonText}>Share via other apps</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.secondaryButton, styles.copyButton]}
          onPress={handleCopyDetails}
          activeOpacity={0.85}
        >
          <Ionicons name="copy-outline" size={18} color="#0F172A" />
          <Text style={styles.secondaryButtonText}>Copy details</Text>
        </TouchableOpacity>

        {Platform.OS !== "web" ? (
          <TouchableOpacity style={[styles.secondaryButton, styles.openAppButton]} onPress={handleOpenApp} activeOpacity={0.85}>
            <Text style={styles.secondaryButtonText}>Open Facebook</Text>
          </TouchableOpacity>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#F8FAFC",
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 4,
  },
  header: {
    paddingTop: 20,
    paddingBottom: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
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
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0284C7",
    borderRadius: 12,
  },
  shareTargetsRow: {
    marginTop: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
  },
  shareIconButton: {
    width: 56,
    height: 56,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  facebookIconButton: {
    backgroundColor: "#1877F2",
  },
  messengerIconButton: {
    backgroundColor: "#0084FF",
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
  mapsChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#F0F9FF",
    borderWidth: 1,
    borderColor: "#BAE6FD",
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  mapsChipText: {
    flex: 1,
    color: "#0369A1",
    fontSize: 13,
    fontWeight: "600",
  },
  otherAppsButton: {
    marginTop: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  copyButton: {
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  openAppButton: {
    marginTop: 10,
  },
});
