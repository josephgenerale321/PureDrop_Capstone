import { useEffect, useState } from "react";
import {
  Image,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { onAuthStateChanged } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { SafeAreaView } from "react-native-safe-area-context";
import { auth, db } from "../../firebaseConfig";

type Lightbox = { label: string; uri: string } | null;

// Fallback destination when this screen has no history to pop.
const VERIFICATION_HUB_ROUTE = "/verification/verificationmain";

/**
 * Review Submission screen — opened from the verification hub's "Review
 * Submission" button. A read-only overview of EVERYTHING the signed-in user
 * has submitted for identity verification, from their live `regular_user`
 * Firestore document:
 *
 *   - Account status (pending admin review / verified / incomplete)
 *   - Account information — full name, email, address and water meter
 *   - Face Recognition — the enrolled selfie (faceScanUrl)
 *   - Valid ID — the chosen ID type (validIdType) plus the front and back
 *     photos (validIdFrontUrl / validIdBackUrl)
 *
 * Tapping any submitted photo opens the full-screen lightbox. Nothing here is
 * editable — submissions are changed through the Face Recognition / Verify
 * your id flows on the hub.
 */
export default function ReviewSubmissionScreen() {
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);
  // True until the first Firestore snapshot arrives.
  const [isLoading, setIsLoading] = useState(true);
  const [faceUrl, setFaceUrl] = useState<string | null>(null);
  const [idType, setIdType] = useState<string | null>(null);
  const [frontUrl, setFrontUrl] = useState<string | null>(null);
  const [backUrl, setBackUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("");
  // Account information shown alongside the verification submissions.
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [fullName, setFullName] = useState<string | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [waterMeter, setWaterMeter] = useState<string | null>(null);
  // Photo shown in the full-screen lightbox (null = closed).
  const [lightbox, setLightbox] = useState<Lightbox>(null);

  // Track the live Firebase session so the review always reflects the account
  // that is actually signed in on this device.
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUserId(currentUser?.uid ?? null);
      setUserEmail(currentUser?.email ?? null);
    });

    return unsubscribe;
  }, []);

  // Live subscription to the submitted verification fields — the screen
  // updates instantly if the user re-submits anything from the flows.
  useEffect(() => {
    if (!userId) {
      setFaceUrl(null);
      setIdType(null);
      setFrontUrl(null);
      setBackUrl(null);
      setStatus("");
      setFullName(null);
      setAddress(null);
      setWaterMeter(null);
      setIsLoading(false);
      return undefined;
    }

    const unsubscribe = onSnapshot(
      doc(db, "regular_user", userId),
      (snapshot) => {
        const data = snapshot.exists() ? snapshot.data() : undefined;
        setFaceUrl(
          typeof data?.faceScanUrl === "string" ? data.faceScanUrl : null,
        );
        setIdType(
          typeof data?.validIdType === "string" ? data.validIdType : null,
        );
        setFrontUrl(
          typeof data?.validIdFrontUrl === "string" ? data.validIdFrontUrl : null,
        );
        setBackUrl(
          typeof data?.validIdBackUrl === "string" ? data.validIdBackUrl : null,
        );
        setStatus(String(data?.verificationStatus ?? ""));
        setFullName(
          typeof data?.fullName === "string" && data.fullName.trim().length > 0
            ? data.fullName
            : null,
        );
        setAddress(
          typeof data?.address === "string" && data.address.trim().length > 0
            ? data.address
            : null,
        );
        if (data?.waterMeter !== undefined && data?.waterMeter !== null) {
          const meter = Number(data.waterMeter);
          setWaterMeter(Number.isFinite(meter) ? String(meter) : null);
        } else {
          setWaterMeter(null);
        }
        setIsLoading(false);
      },
      () => {
        // Read failed (offline / permissions) — render the empty state.
        setIsLoading(false);
      },
    );

    return unsubscribe;
  }, [userId]);

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      // No history to pop (deep link / app-restart entry) — land on the
      // verification hub instead of leaving a dead back button.
      try {
        router.replace(VERIFICATION_HUB_ROUTE);
      } catch {
        // Navigation must never crash the app.
      }
    }
  };

  const statusBadge = (() => {
    if (status === "verified") {
      return { label: "Verified", color: "#16A34A", background: "#DCFCE7" };
    }
    if (status === "pending") {
      return { label: "Pending admin review", color: "#854D0E", background: "#FEF9C3" };
    }
    if (status === "rejected") {
      return { label: "Rejected — resubmit required", color: "#B91C1C", background: "#FEE2E2" };
    }
    return { label: "Incomplete", color: "#475569", background: "#F1F5F9" };
  })();

  return (
    <>
      <SafeAreaView style={styles.container}>
        <TouchableOpacity style={styles.backButton} onPress={handleBack} activeOpacity={0.8}>
          <Ionicons name="arrow-back" size={22} color="#FFFFFF" />
        </TouchableOpacity>

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Text style={styles.title}>Review Submission</Text>

          {/* Account status badge */}
          <View style={[styles.statusBadge, { backgroundColor: statusBadge.background }]}>
            <Text style={[styles.statusBadgeText, { color: statusBadge.color }]}>
              {statusBadge.label}
            </Text>
          </View>

          {/* Account information — the identity details this verification is
              tied to (name, email, address, water meter). */}
          <Text style={styles.sectionLabel}>Account Information</Text>
          <View style={styles.infoCard}>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Full name</Text>
              <Text style={styles.infoValue}>{fullName ?? "—"}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Email</Text>
              <Text style={styles.infoValue}>{userEmail ?? "—"}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Address</Text>
              <Text style={styles.infoValue}>{address ?? "—"}</Text>
            </View>
            <View style={[styles.infoRow, styles.infoRowLast]}>
              <Text style={styles.infoLabel}>Water meter</Text>
              <Text style={styles.infoValue}>{waterMeter ?? "—"}</Text>
            </View>
          </View>

          {/* Face Recognition section */}
          <Text style={styles.sectionLabel}>Face Recognition</Text>
          <TouchableOpacity
            style={[styles.photoCard, faceUrl && styles.photoCardAttached]}
            onPress={() => faceUrl && setLightbox({ label: "Face scan", uri: faceUrl })}
            activeOpacity={faceUrl ? 0.8 : 1}
            disabled={!faceUrl}
            accessibilityRole={faceUrl ? "button" : "text"}
            accessibilityLabel="View your submitted face scan full screen"
          >
            <View style={styles.photoCardHeader}>
              <Text style={styles.photoCardLabel}>Enrolled selfie</Text>
              {faceUrl ? (
                <Ionicons name="checkmark-circle" size={18} color="#22C55E" />
              ) : (
                <Ionicons name="close-circle" size={18} color="#94A3B8" />
              )}
            </View>
            <View style={styles.facePreview}>
              {faceUrl ? (
                <Image source={{ uri: faceUrl }} style={styles.photo} resizeMode="cover" />
              ) : (
                <Text style={styles.placeholderText}>
                  {isLoading ? "Loading your submission…" : "Not submitted yet"}
                </Text>
              )}
            </View>
          </TouchableOpacity>

          {/* Valid ID section */}
          <Text style={styles.sectionLabel}>Valid ID</Text>
          <View style={styles.photoCard}>
            <View style={styles.photoCardHeader}>
              <Text style={styles.photoCardLabel}>{idType ?? "No ID submitted yet"}</Text>
              {frontUrl ? (
                <Ionicons name="checkmark-circle" size={18} color="#22C55E" />
              ) : (
                <Ionicons name="close-circle" size={18} color="#94A3B8" />
              )}
            </View>

            <Text style={styles.sideLabel}>Front</Text>
            <TouchableOpacity
              style={styles.idPreview}
              onPress={() => frontUrl && setLightbox({ label: "Front", uri: frontUrl })}
              activeOpacity={frontUrl ? 0.8 : 1}
              disabled={!frontUrl}
              accessibilityRole={frontUrl ? "button" : "text"}
              accessibilityLabel="View your submitted Valid ID front photo full screen"
            >
              {frontUrl ? (
                <Image source={{ uri: frontUrl }} style={styles.photo} resizeMode="cover" />
              ) : (
                <Text style={styles.placeholderText}>
                  {isLoading ? "Loading your submission…" : "Not submitted yet"}
                </Text>
              )}
            </TouchableOpacity>

            <Text style={styles.sideLabel}>Back</Text>
            <TouchableOpacity
              style={styles.idPreview}
              onPress={() => backUrl && setLightbox({ label: "Back", uri: backUrl })}
              activeOpacity={backUrl ? 0.8 : 1}
              disabled={!backUrl}
              accessibilityRole={backUrl ? "button" : "text"}
              accessibilityLabel="View your submitted Valid ID back photo full screen"
            >
              {backUrl ? (
                <Image source={{ uri: backUrl }} style={styles.photo} resizeMode="cover" />
              ) : (
                <Text style={styles.placeholderText}>
                  {isLoading ? "Loading your submission…" : "Not submitted yet"}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </ScrollView>
      </SafeAreaView>

      {/* Full-screen photo lightbox for the submitted verification photos. */}
      <Modal
        visible={lightbox !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setLightbox(null)}
      >
        <SafeAreaView style={styles.lightboxOverlay}>
          <View style={styles.lightboxHeader}>
            <TouchableOpacity
              style={styles.lightboxCloseButton}
              onPress={() => setLightbox(null)}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Close image preview"
            >
              <Ionicons name="close" size={24} color="#FFFFFF" />
            </TouchableOpacity>
            <Text style={styles.lightboxTitle}>{lightbox?.label ?? ""} photo</Text>
          </View>

          <View style={styles.lightboxImageWrap}>
            {lightbox && (
              <Image
                source={{ uri: lightbox.uri }}
                style={styles.lightboxImage}
                resizeMode="contain"
              />
            )}
          </View>
        </SafeAreaView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 24,
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: "#0EA5E9",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
    shadowColor: "#0EA5E9",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  content: {
    paddingTop: 24,
    paddingBottom: 48,
  },
  title: {
    fontSize: 24,
    fontWeight: "600",
    color: "#0F172A",
    marginBottom: 16,
  },
  // Account status badge (pending / verified / rejected / incomplete).
  statusBadge: {
    alignSelf: "flex-start",
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 6,
    marginBottom: 24,
  },
  statusBadgeText: {
    fontSize: 13,
    fontWeight: "700",
  },
  // Account information card (full name / email / address / water meter).
  infoCard: {
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderRadius: 16,
    paddingHorizontal: 14,
    marginBottom: 24,
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 16,
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#E2E8F0",
  },
  // The last row of the info card — no separator line underneath.
  infoRowLast: {
    borderBottomWidth: 0,
  },
  infoLabel: {
    fontSize: 13,
    color: "#64748B",
  },
  infoValue: {
    flex: 1,
    fontSize: 13,
    fontWeight: "600",
    color: "#0F172A",
    textAlign: "right",
  },
  sectionLabel: {
    fontSize: 14,
    fontWeight: "700",
    color: "#0F172A",
    marginBottom: 10,
  },
  // Read-only photo card (same visual language as the submitted-ID review).
  photoCard: {
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderRadius: 16,
    padding: 14,
    marginBottom: 24,
  },
  photoCardAttached: {
    borderColor: "#BBF7D0",
    backgroundColor: "#F0FDF4",
  },
  photoCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  photoCardLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: "#0F172A",
  },
  sideLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#64748B",
    marginBottom: 6,
  },
  facePreview: {
    width: "100%",
    aspectRatio: 1,
    borderRadius: 12,
    backgroundColor: "#E2E8F0",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  idPreview: {
    width: "100%",
    aspectRatio: 1.586, // CR80 ID card ratio (85.6mm x 54mm)
    borderRadius: 12,
    backgroundColor: "#E2E8F0",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    marginBottom: 12,
  },
  photo: {
    width: "100%",
    height: "100%",
  },
  placeholderText: {
    fontSize: 13,
    color: "#94A3B8",
  },
  // Full-screen photo lightbox (same pattern as the other verification screens)
  lightboxOverlay: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.97)",
  },
  lightboxHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  lightboxCloseButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: "rgba(255, 255, 255, 0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  lightboxTitle: {
    flex: 1,
    marginLeft: 12,
    fontSize: 16,
    fontWeight: "600",
    color: "#FFFFFF",
  },
  lightboxImageWrap: {
    flex: 1,
    padding: 20,
  },
  lightboxImage: {
    width: "100%",
    height: "100%",
  },
});