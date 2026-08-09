import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

export default function AboutScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <SafeAreaView style={styles.container}>
      <View style={[styles.header, { paddingTop: Math.max(12, insets.top + 4) }]}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.replace("/regular_user/profile")}
          hitSlop={{ top: 12, right: 12, bottom: 12, left: 12 }}
        >
          <Ionicons name="arrow-back" size={24} color="#0F172A" />
        </TouchableOpacity>

        <Text style={styles.headerTitle}>About</Text>

        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
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
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 16,
  },

  backButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: "#FFFFFF",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 2,
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 3,
  },

  headerSpacer: {
    width: 40,
    height: 40,
  },

  headerTitle: {
    color: "#0F172A",
    fontSize: 20,
    fontWeight: "800",
  },

  scrollContent: {
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 16,
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
