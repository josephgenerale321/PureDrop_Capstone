import { Ionicons } from "@expo/vector-icons";
import { onAuthStateChanged } from "firebase/auth";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  updateDoc,
} from "firebase/firestore";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { auth, db } from "../../firebaseConfig";
import { removeFile } from "../../api/storage";

const REPORTS_BUCKET = "reports";

/**
 * Extracts the storage object path from a Supabase public/signed attachment
 * URL. Mirrors the admin dashboard's `extractReportsAttachmentPath` logic so
 * the mobile app can clean up the same folder layout (`{reportId}/{name}`).
 * Returns "" when the value cannot be parsed; callers treat that as skip.
 */
const extractReportsAttachmentPath = (attachmentUrl: string): string => {
  const rawValue = String(attachmentUrl || "").trim();
  if (!rawValue) {
    return "";
  }

  const normalizeStoragePath = (value: string): string => {
    const trimmed = value.trim().replace(/^\/+|\/+$/g, "");
    if (!trimmed) {
      return "";
    }
    try {
      return decodeURIComponent(trimmed);
    } catch {
      return trimmed;
    }
  };

  if (!rawValue.includes("://")) {
    if (rawValue.startsWith(`${REPORTS_BUCKET}/`)) {
      return normalizeStoragePath(rawValue.slice(REPORTS_BUCKET.length + 1));
    }
    return normalizeStoragePath(rawValue);
  }

  try {
    const parsedUrl = new URL(rawValue);
    const markers = [
      `/storage/v1/object/public/${REPORTS_BUCKET}/`,
      `/storage/v1/object/sign/${REPORTS_BUCKET}/`,
      `/storage/v1/object/authenticated/${REPORTS_BUCKET}/`,
      `/storage/v1/render/image/public/${REPORTS_BUCKET}/`,
      `/storage/v1/render/image/authenticated/${REPORTS_BUCKET}/`,
      `/storage/v1/object/${REPORTS_BUCKET}/`,
    ];

    for (const marker of markers) {
      const markerIndex = parsedUrl.pathname.indexOf(marker);
      if (markerIndex >= 0) {
        return normalizeStoragePath(
          parsedUrl.pathname.slice(markerIndex + marker.length)
        );
      }
    }
  } catch {
    return "";
  }

  return "";
};

/**
 * Best-effort removes the report's uploaded attachment objects from Supabase
 * storage. Never throws and never blocks the Firestore delete — a storage
 * cleanup failure is non-fatal (the report doc is still deleted).
 */
const removeReportAttachments = async (attachments: string[]): Promise<void> => {
  const paths = (Array.isArray(attachments) ? attachments : [])
    .map((url) => extractReportsAttachmentPath(url))
    .filter((path) => path.length > 0);

  if (paths.length === 0) {
    return;
  }

  try {
    await Promise.all(
      paths.map((path) =>
        removeFile(path, REPORTS_BUCKET).catch(() => {
          // Non-fatal: skip individual file removal failures.
        })
      )
    );
  } catch {
    // Non-fatal: the report document delete still proceeds.
  }
};

type DeleteReportLightboxProps = {
  visible: boolean;
  reportId?: string | null;
  onClose: () => void;
  onDeleted: () => void;
};

/**
 * In-screen lightbox (Modal) that confirms deleting one of the user's reports.
 * Because it is rendered inside the My Reports screen (not a separate route),
 * it avoids the cross-navigator navigation errors that occur when a modal-like
 * action is pushed as its own route.
 */
export default function DeleteReportLightbox({
  visible,
  reportId,
  onClose,
  onDeleted,
}: DeleteReportLightboxProps) {
  const [deleting, setDeleting] = useState(false);
  const [ready, setReady] = useState(false);
  const isMountedRef = useRef(true);
  // Guards against a rapid double-tap on "Delete" running two concurrent
  // delete operations (double Firestore deletes + double storage removals).
  const deletingRef = useRef(false);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Reset state whenever the lightbox opens for a new report.
  useEffect(() => {
    if (visible) {
      setReady(Boolean(reportId));
      setDeleting(false);
    }
  }, [visible, reportId]);

  // Cancel/close: only dismisses the lightbox. It never touches the report.
  const handleCancel = () => {
    if (deleting) {
      return;
    }
    onClose();
  };

  const handleConfirm = async () => {
    if (deletingRef.current) {
      return;
    }

    const currentUser = auth.currentUser;
    if (!currentUser) {
      Alert.alert("Not signed in", "Please log in again before deleting a report.");
      return;
    }
    if (!reportId) {
      Alert.alert("Missing report", "No report was selected to delete.");
      return;
    }

    deletingRef.current = true;
    setDeleting(true);

    try {
      const uid = currentUser.uid;
      const reportRef = doc(collection(db, "regular_user", uid, "reports"), reportId);
      const reportSnap = await getDoc(reportRef);

      // Collect attachment URLs from the subcollection report (if present) so
      // we can also clean up the uploaded images from Supabase storage.
      let attachments: string[] = [];
      if (reportSnap.exists()) {
        const data = reportSnap.data() as { attachments?: unknown };
        attachments = Array.isArray(data.attachments)
          ? data.attachments.filter(
              (item): item is string =>
                typeof item === "string" && item.trim().length > 0
            )
          : [];
      }

      // Legacy fallback: the report may live in the user doc's `reports`
      // array instead of a subcollection. Remove it there too.
      const userDocRef = doc(db, "regular_user", uid);
      try {
        const userSnap = await getDoc(userDocRef);
        if (userSnap.exists()) {
          const userData = userSnap.data() as { reports?: unknown };
          const legacyReports = Array.isArray(userData.reports)
            ? userData.reports
            : [];
          const filtered = legacyReports.filter(
            (item: unknown) =>
              typeof item === "object" &&
              item !== null &&
              !(
                "reportId" in (item as Record<string, unknown>) &&
                (item as Record<string, unknown>).reportId === reportId
              )
          );
          if (filtered.length !== legacyReports.length) {
            // Best-effort legacy removal; non-fatal if it fails.
            try {
              await updateDoc(userDocRef, { reports: filtered });
            } catch {
              // Non-fatal.
            }
          }
        }
      } catch {
        // Non-fatal: the subcollection delete below is the primary path.
      }

      // Delete the subcollection report document (primary storage).
      await deleteDoc(reportRef);

      // Best-effort remove uploaded images from Supabase storage.
      await removeReportAttachments(attachments);

      if (isMountedRef.current) {
        onDeleted();
      }
    } catch (error) {
      const message =
        error instanceof Error && error.message.trim().length > 0
          ? error.message
          : "Unable to delete the report right now.";
      if (isMountedRef.current) {
        Alert.alert("Delete failed", message);
      }
    } finally {
      deletingRef.current = false;
      if (isMountedRef.current) {
        setDeleting(false);
      }
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleCancel}>
      <View style={styles.overlay}>
        <View style={styles.lightbox}>
          <View style={styles.header}>
            <Text style={styles.title}>Delete Report</Text>
            <TouchableOpacity
              style={styles.closeButton}
              onPress={handleCancel}
              disabled={deleting}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Close delete report"
            >
              <Text style={styles.closeText}>x</Text>
            </TouchableOpacity>
          </View>

          {!ready ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator size="large" color="#dc2626" />
            </View>
          ) : (
            <>
              <View style={styles.iconWrap}>
                <Ionicons name="trash-outline" size={28} color="#dc2626" />
              </View>
              <Text style={styles.message}>
                Do you want to delete this report? This will also remove its
                uploaded attachments.
              </Text>

              <View style={styles.actions}>
                <TouchableOpacity
                  style={[styles.actionButton, styles.cancelButton]}
                  onPress={handleCancel}
                  disabled={deleting}
                  activeOpacity={0.85}
                  accessibilityRole="button"
                  accessibilityLabel="Cancel delete"
                >
                  <Text style={styles.cancelText}>Cancel</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.actionButton,
                    styles.deleteButton,
                    deleting && styles.disabledButton,
                  ]}
                  onPress={handleConfirm}
                  disabled={deleting}
                  activeOpacity={0.85}
                  accessibilityRole="button"
                  accessibilityLabel="Delete report"
                >
                  <Text style={styles.deleteText}>
                    {deleting ? "Deleting..." : "Delete"}
                  </Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "center",
    backgroundColor: "rgba(15, 23, 42, 0.58)",
    paddingHorizontal: 16,
  },
  lightbox: {
    borderRadius: 6,
    backgroundColor: "#ffffff",
    padding: 16,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 8,
  },
  header: {
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    color: "#0f172a",
  },
  closeButton: {
    position: "absolute",
    right: 0,
    width: 36,
    height: 36,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f1f5f9",
  },
  closeText: {
    color: "#475569",
    fontSize: 18,
    fontWeight: "700",
    lineHeight: 20,
  },
  loadingWrap: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 32,
  },
  iconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#fef2f2",
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    marginTop: 8,
    marginBottom: 16,
  },
  message: {
    fontSize: 15,
    color: "#334155",
    lineHeight: 22,
    textAlign: "center",
    marginBottom: 20,
  },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: "#e2e8f0",
    paddingTop: 14,
  },
  actionButton: {
    minWidth: 96,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  cancelButton: {
    borderWidth: 1,
    borderColor: "#cbd5e1",
    backgroundColor: "#ffffff",
  },
  cancelText: {
    color: "#475569",
    fontSize: 14,
    fontWeight: "700",
  },
  deleteButton: {
    backgroundColor: "#dc2626",
  },
  deleteText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "700",
  },
  disabledButton: {
    opacity: 0.65,
  },
});
