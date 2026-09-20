import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

export default function AboutScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <SafeAreaView style={styles.container}>
      <TouchableOpacity
        style={[styles.backButton, { top: insets.top + 12 }]}
        onPress={() => router.replace("/regular_user/profile")}
        activeOpacity={0.85}
        hitSlop={{ top: 12, right: 12, bottom: 12, left: 12 }}
      >
        <Ionicons name="arrow-back" size={24} color="#ffffff" />
      </TouchableOpacity>

      <View style={[styles.header, { paddingTop: Math.max(12, insets.top + 4) }]}>
        <Text style={styles.headerTitle}>About</Text>
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          // The floating tab bar in `regular_user/_layout.jsx` is position:
          // "absolute", so it overlays the bottom of this screen. Reserve its
          // height (70) plus the device bottom inset plus a gap, so the card's
          // last line is never clipped behind the bar (same pattern as
          // `my_report/index.tsx` and `notification_main.tsx`).
          { paddingBottom: 70 + Math.max(0, insets.bottom) + 24 },
        ]}
      >
        <View style={styles.card}>
          <Text style={styles.body}>
            PureDrop is a community-based reporting platform created to help residents
            of Toledo City easily report and monitor water-related problems in their
            area. The app empowers citizens to take an active role in improving local
            water services by providing a simple and accessible way to raise concerns.
          </Text>

          <Text style={styles.body}>
            With PureDrop, users can report issues such as no water supply, dirty or
            discolored water, and water leaks in just a few steps. Residents simply
            enter a short description of the problem, select their barangay, and
            optionally upload a photo as supporting evidence. This makes reports
            clearer, more accurate, and easier for authorities to verify.
          </Text>

          <Text style={styles.body}>
            All submitted reports are displayed in an organized list that shows the
            type of problem, location, date reported, and current status, allowing
            users to stay informed about ongoing issues in their community.
          </Text>

          <Text style={styles.body}>
            On the administrative side, PureDrop includes an admin panel where
            authorized personnel can review, manage, and update reports efficiently.
            This helps ensure that water-related concerns are addressed faster and in
            a more organized manner.
          </Text>

          <Text style={styles.body}>
            By connecting residents and local authorities, PureDrop promotes
            transparency, faster response times, and stronger community involvement in
            maintaining safe and reliable water services.
          </Text>
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

  header: {
    alignItems: "center",
    paddingHorizontal: 20,
    paddingBottom: 16,
  },

  backButton: {
    position: "absolute",
    // `top` is applied dynamically from the safe-area inset in the component
    // (hardcoded values sit at the wrong distance on devices with different
    // status-bar heights).
    left: 20,
    zIndex: 10,
    width: 36,
    height: 36,
    borderRadius: 6,
    backgroundColor: "#0284c7",
    justifyContent: "center",
    alignItems: "center",
  },

  headerTitle: {
    color: "#0F172A",
    fontSize: 24,
    fontWeight: "700",
  },

  scrollContent: {
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 32,
    paddingBottom: 40,
  },

  card: {
    width: "100%",
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 3,
  },

  body: {
    color: "#334155",
    fontSize: 14,
    lineHeight: 22,
    textAlign: "left",
    marginBottom: 16,
  },
});
