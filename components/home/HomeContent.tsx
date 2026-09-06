import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import {
  Image,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import HomeMainLoading from "../loading/homepage/homemain_loading";
import HomeExitHandler from "../main_layout/home_exit_handler";
import { styles } from "./home_styles";
import type { HomeUser } from "./useHomeDashboard";

type HomeContentProps = {
  user: HomeUser | null;
  loading: boolean;
};

/**
 * Presentational UI for the home dashboard.
 *
 * Renders the header bar, welcome hero card, "Report a Problem" call-to-action,
 * and the dashboard utilities grid. It receives `user`/`loading` as props from
 * the screen wrapper (which owns the backend logic via `useHomeDashboard`).
 *
 * The Android double-press-to-exit handler is platform-guarded and inert on
 * every non-Android platform, so it stays safe on preview/dev builds.
 */
export default function HomeContent({ user, loading }: HomeContentProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();

if (loading) {
    return (
      <View style={styles.container}>
        <HomeMainLoading />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Android double-press-to-exit handler (inert on other platforms) */}
      <HomeExitHandler />

      {/* Header Bar */}
      <View style={[styles.headerBar, { paddingTop: Math.max(14, insets.top + 10) }]}>
        <View style={styles.headerLeft}>
          <Image source={require("../../assets/images/logo.png")} style={styles.headerLogo} />
        </View>
      </View>

      {/* Scrollable Dashboard Body */}
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        {/* Welcome Hero Card */}
        <View style={styles.heroCard}>
          <View style={styles.heroOverlay}>
            <View style={styles.heroTextContainer}>
              <Text style={styles.heroWelcome}>Welcome back,</Text>
              <Text style={styles.heroName}>{user?.fullName || "Resident"}</Text>
              <Text style={styles.heroSubtitle}>Toledo City Community Portal</Text>
            </View>
            <View style={styles.heroIconContainer}>
              <Ionicons name="water" size={100} color="rgba(255,255,255,0.1)" />
            </View>
          </View>
        </View>

        {/* Primary Call-to-Action Card */}
        <TouchableOpacity
          style={styles.primaryActionCard}
          onPress={() => router.push("/regular_user/report")}
          activeOpacity={0.85}
        >
          <View style={styles.primaryActionIconWrap}>
            <Ionicons name="add-circle" size={32} color="#FFFFFF" />
          </View>
          <View style={styles.primaryActionTextWrap}>
            <Text style={styles.primaryActionTitle}>Report a Problem</Text>
            <Text style={styles.primaryActionDesc}>
              Submit a report for leaks, dirty water, or supply outage.
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={24} color="#A0EEBA" style={{ opacity: 0.8 }} />
        </TouchableOpacity>

        {/* Identity verification call-to-action — shown while the account is
            not verified yet. This is the way back into the verification flow
            for users who chose "continue later" on the verification hub (the
            login/restore gates respect that choice and land here instead). */}
        {String(user?.verificationStatus ?? "") !== "verified" && (
          <TouchableOpacity
            style={styles.primaryActionCard}
            onPress={() => router.push("/verification/verificationmain")}
            activeOpacity={0.85}
          >
            <View style={styles.primaryActionIconWrap}>
              <Ionicons name="shield-checkmark" size={32} color="#FFFFFF" />
            </View>
            <View style={styles.primaryActionTextWrap}>
              <Text style={styles.primaryActionTitle}>Verify your identity</Text>
              <Text style={styles.primaryActionDesc}>
                Submit your face scan and Valid ID to verify your account.
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={24} color="#A0EEBA" style={{ opacity: 0.8 }} />
          </TouchableOpacity>
        )}

        {/* Dashboard Utilities Section */}
        <Text style={styles.sectionLabel}>Dashboard Utilities</Text>

        <View style={styles.utilitiesGrid}>
          {/* My Reports */}
          <TouchableOpacity
            style={styles.gridCard}
            onPress={() => router.push("/regular_user/view-reports")}
            activeOpacity={0.85}
          >
            <View style={[styles.gridIconWrap, { backgroundColor: "#E0F2FE" }]}>
              <Ionicons name="clipboard-outline" size={24} color="#0EA5E9" />
            </View>
            <Text style={styles.gridTitle}>My Reports</Text>
            <Text style={styles.gridDesc}>Track your submissions</Text>
          </TouchableOpacity>

          {/* Community Feed */}
          {/* <TouchableOpacity
            style={styles.gridCard}
            onPress={() => router.push("/regular_user/all_reports/all_reportlist")}
            activeOpacity={0.85}
          >
            <View style={[styles.gridIconWrap, { backgroundColor: "#ECFDF5" }]}>
              <Ionicons name="people-outline" size={24} color="#10B981" />
            </View>
            <Text style={styles.gridTitle}>Community</Text>
            <Text style={styles.gridDesc}>View local issues</Text>
          </TouchableOpacity> */}

          {/* Emergency Directory (Full width spanning 2 columns) */}
          <TouchableOpacity
            style={[styles.gridCard, styles.gridCardFull]}
            onPress={() => router.push("/regular_user/directory")}
            activeOpacity={0.85}
          >
            <View style={styles.fullCardContent}>
              <View style={[styles.gridIconWrap, { backgroundColor: "#FEF2F2", marginBottom: 0 }]}>
                <Ionicons name="call-outline" size={24} color="#EF4444" />
              </View>
              <View style={styles.fullCardText}>
                <Text style={styles.gridTitle}>Emergency Directory</Text>
                <Text style={styles.gridDesc}>Contact numbers and hotline</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color="#CBD5E1" />
            </View>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Floating Help FAB */}
    </View>
  );
}

