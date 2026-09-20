import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { StyleSheet, Text, TouchableOpacity, View, ScrollView, Linking } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

export default function DirectoryScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const handleCall = (phoneNumber: string) => {
    Linking.openURL(`tel:${phoneNumber}`);
  };

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={[styles.header, { paddingTop: Math.max(12, insets.top + 4) }]}>
        <Text style={styles.title}>Directory</Text>
      </View>

      {/* Floating back button — matches profileview / My Reports: 36x36 blue,
          pinned to the top-left. Kept outside the header bar so it never shifts
          with the title. */}
      <TouchableOpacity
        style={[styles.backButton, { top: insets.top + 12 }]}
        onPress={() => router.back()}
        hitSlop={{ top: 12, right: 12, bottom: 12, left: 12 }}
      >
        <Ionicons name="arrow-back" size={24} color="#ffffff" />
      </TouchableOpacity>

      <ScrollView 
        style={styles.content} 
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.descriptionContainer}>
          <Ionicons name="information-circle" size={24} color="#0EA5E9" style={{ marginRight: 12, marginTop: 2 }} />
          <Text style={styles.mainDescription}>
            Contact us for water-related concerns, billing inquiries, or general assistance.
          </Text>
        </View>

        {/* Offices Card */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Ionicons name="location" size={20} color="#0EA5E9" />
            <Text style={styles.cardTitle}>Offices</Text>
          </View>
          <View style={styles.divider} />
          
          <View style={styles.infoRow}>
            <View style={styles.iconContainer}>
              <Ionicons name="business" size={20} color="#64748B" />
            </View>
            <View style={styles.textContainer}>
              <Text style={styles.label}>Main Office</Text>
              <Text style={styles.value}>S. Osmena St. Brgy. Sangi, Toledo City, Cebu</Text>
            </View>
          </View>

          <View style={[styles.infoRow, { marginBottom: 0 }]}>
            <View style={styles.iconContainer}>
              <Ionicons name="people" size={20} color="#64748B" />
            </View>
            <View style={styles.textContainer}>
              <Text style={styles.label}>Customer Interaction Center</Text>
              <Text style={styles.value}>CEBECO II Compound, Sipaway, Luray II, Toledo City, Cebu</Text>
            </View>
          </View>
        </View>

        {/* Office Hours Card */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Ionicons name="time" size={20} color="#0EA5E9" />
            <Text style={styles.cardTitle}>Office Hours</Text>
          </View>
          <View style={styles.divider} />
          
          <View style={[styles.infoRow, { marginBottom: 0 }]}>
            <View style={styles.iconContainer}>
              <Ionicons name="calendar" size={20} color="#64748B" />
            </View>
            <View style={styles.textContainer}>
              <Text style={styles.label}>Monday - Friday</Text>
              <Text style={styles.value}>8:00 AM - 5:00 PM</Text>
            </View>
          </View>
        </View>

        {/* Contact Numbers Card */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Ionicons name="call" size={20} color="#0EA5E9" />
            <Text style={styles.cardTitle}>Contact Numbers</Text>
          </View>
          <View style={styles.divider} />
          
          <TouchableOpacity 
            style={styles.contactButton} 
            onPress={() => handleCall('0324273574')}
            activeOpacity={0.7}
          >
            <View style={styles.iconContainerPrimary}>
              <Ionicons name="call" size={20} color="#FFFFFF" />
            </View>
            <View style={styles.textContainer}>
              <Text style={styles.contactLabel}>Sangi Office</Text>
              <Text style={styles.contactValue}>(032) 427-3574</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#CBD5E1" />
          </TouchableOpacity>

          <TouchableOpacity 
            style={styles.contactButton} 
            onPress={() => handleCall('0324366547')}
            activeOpacity={0.7}
          >
            <View style={styles.iconContainerPrimary}>
              <Ionicons name="call" size={20} color="#FFFFFF" />
            </View>
            <View style={styles.textContainer}>
              <Text style={styles.contactLabel}>CIC Office</Text>
              <Text style={styles.contactValue}>(032) 436-6547</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#CBD5E1" />
          </TouchableOpacity>

          <TouchableOpacity 
            style={[styles.contactButton, { marginBottom: 0 }]} 
            onPress={() => handleCall('09176216566')}
            activeOpacity={0.7}
          >
            <View style={styles.iconContainerEmergency}>
              <Ionicons name="warning" size={20} color="#FFFFFF" />
            </View>
            <View style={styles.textContainer}>
              <Text style={styles.contactLabel}>Hotline / Emergency</Text>
              <Text style={styles.contactValue}>0917 621 6566</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#CBD5E1" />
          </TouchableOpacity>
        </View>

        {/* Bottom Padding */}
        <View style={{ height: 20 }} />
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
    backgroundColor: "#FFFFFF",
    borderBottomWidth: 1,
    borderBottomColor: "#E2E8F0",
    zIndex: 10,
  },
  backButton: {
    // Floating back button — matches profileview / My Reports: 36x36, radius 6,
    // pinned to the top-left. `top` is applied dynamically from the safe-area
    // inset in the component (hardcoded values sit at the wrong distance on
    // devices with different status-bar heights).
    position: "absolute",
    left: 20,
    zIndex: 10,
    width: 36,
    height: 36,
    borderRadius: 6,
    backgroundColor: "#0284c7",
    justifyContent: "center",
    alignItems: "center",
  },
  title: {
    color: "#0F172A",
    fontSize: 24,
    fontWeight: "700",
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    padding: 20,
    paddingBottom: 40,
  },
  descriptionContainer: {
    flexDirection: "row",
    backgroundColor: "#F0F9FF",
    padding: 16,
    borderRadius: 12,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: "#BAE6FD",
  },
  mainDescription: {
    flex: 1,
    fontSize: 14,
    color: "#0369A1",
    lineHeight: 20,
    fontWeight: "500",
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03,
    shadowRadius: 8,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#0F172A",
    marginLeft: 8,
  },
  divider: {
    height: 1,
    backgroundColor: "#F1F5F9",
    marginBottom: 16,
  },
  infoRow: {
    flexDirection: "row",
    marginBottom: 16,
    alignItems: "center",
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#F1F5F9",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  textContainer: {
    flex: 1,
    justifyContent: "center",
  },
  label: {
    fontSize: 12,
    fontWeight: "600",
    color: "#64748B",
    marginBottom: 4,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  value: {
    fontSize: 14,
    color: "#0F172A",
    lineHeight: 20,
    fontWeight: "500",
  },
  contactButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F8FAFC",
    padding: 12,
    borderRadius: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  iconContainerPrimary: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#0EA5E9",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  iconContainerEmergency: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#EF4444",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  contactLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#64748B",
    marginBottom: 2,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  contactValue: {
    fontSize: 16,
    color: "#0F172A",
    fontWeight: "700",
  },
});
