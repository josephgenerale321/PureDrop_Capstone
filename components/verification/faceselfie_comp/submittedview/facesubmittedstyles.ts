import { StyleSheet } from "react-native";

// Styles for the submitted face-scan review screen
// (app/verification/face_selfie/facescan_submittedview.tsx) — mirrors the
// shared shapes from valididstyles.ts (action buttons, confirm modal,
// lightbox) but with a portrait 3:4 selfie preview instead of the CR80 ID
// card ratio, so the Valid ID styles stay untouched.
export const styles = StyleSheet.create({
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
  scroll: {
    flex: 1,
  },
  content: {
    alignItems: "center",
    paddingBottom: 32,
  },
  title: {
    fontSize: 24,
    fontWeight: "600",
    color: "#0F172A",
    marginTop: 32,
    marginBottom: 28,
  },

  // Enrolled-selfie preview box — portrait 3:4 like the capture/review
  // screens' frames, with the attached (green) look once a selfie exists.
  previewBox: {
    width: "85%",
    aspectRatio: 3 / 4,
    borderRadius: 24,
    backgroundColor: "#F1F5F9",
    borderWidth: 2,
    borderColor: "#CBD5E1",
    borderStyle: "dashed",
    padding: 12,
    overflow: "hidden",
    shadowColor: "#0EA5E9",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  previewBoxAttached: {
    borderStyle: "solid",
    borderColor: "#22C55E",
    backgroundColor: "#FFFFFF",
  },
  previewBoxHeader: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  previewBoxLabel: {
    fontSize: 16,
    fontWeight: "600",
    color: "#0EA5E9",
  },
  previewBoxMicrocopy: {
    fontSize: 11,
    color: "#64748B",
    textAlign: "center",
  },
  previewArea: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 10,
    borderRadius: 14,
    backgroundColor: "#E2E8F0",
    // Clips the absolutely-filled photo to the rounded preview area so it
    // always fits neatly inside the box below the header.
    overflow: "hidden",
  },
  previewPhoto: {
    ...StyleSheet.absoluteFillObject,
    width: "100%",
    height: "100%",
    backgroundColor: "#0F172A",
  },

  // Enrollment info rows (liveness result + submitted date) under the box —
  // same visual language as the face review screen's score card.
  infoWrap: {
    width: "85%",
    marginTop: 24,
    gap: 10,
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#F1F5F9",
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  infoRowText: {
    flex: 1,
    fontSize: 14,
    color: "#0F172A",
  },
  infoRowTextMuted: {
    color: "#94A3B8",
  },

  // Liveness checklist card — the measured checks behind the recorded score.
  checklistCard: {
    width: "85%",
    marginTop: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    backgroundColor: "#F8FAFC",
    paddingVertical: 16,
    paddingHorizontal: 18,
    gap: 14,
  },
  checklistHeading: {
    fontSize: 13,
    fontWeight: "700",
    color: "#475569",
  },
  checkRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  checkTextWrap: {
    flex: 1,
  },
  checkLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: "#0F172A",
  },
  checkDetail: {
    fontSize: 12,
    color: "#64748B",
    marginTop: 2,
  },

  // Retake / Delete actions — reuses the shared actionButton shape from the
  // Valid ID submitted view (height 46, rounded, row-centered).
  submittedActionsWrap: {
    width: "85%",
    gap: 10,
    marginTop: 24,
  },
  actionButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 46,
    borderRadius: 12,
  },
  replaceButton: {
    backgroundColor: "#0EA5E9",
    shadowColor: "#0EA5E9",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  deleteButton: {
    backgroundColor: "#FEE2E2",
    borderWidth: 1,
    borderColor: "#FCA5A5",
  },
  deleteButtonText: {
    color: "#DC2626",
  },

  // Confirmation modal (delete) — same look as the Valid ID / hub confirms.
  confirmOverlay: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.45)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  confirmCard: {
    width: "100%",
    maxWidth: 320,
    backgroundColor: "#FFFFFF",
    borderRadius: 24,
    paddingVertical: 32,
    paddingHorizontal: 24,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    alignItems: "center",
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  confirmTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: "#0F172A",
    textAlign: "center",
    marginBottom: 10,
  },
  confirmMessage: {
    fontSize: 13,
    color: "#64748B",
    textAlign: "center",
    marginBottom: 24,
  },
  confirmActions: {
    width: "100%",
    flexDirection: "row",
    justifyContent: "space-around",
    gap: 16,
  },
  confirmButton: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
  },
  confirmCancelButton: {
    backgroundColor: "#F1F5F9",
    borderWidth: 1,
    borderColor: "#CBD5E1",
  },
  confirmDeleteButton: {
    backgroundColor: "#DC2626",
    shadowColor: "#DC2626",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  confirmButtonText: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 15,
  },
  confirmCancelButtonText: {
    color: "#475569",
  },

  // Full-screen photo lightbox (same look as the report attachment lightbox).
  lightboxOverlay: {
    flex: 1,
    backgroundColor: "#000000",
  },
  lightboxHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 10,
  },
  lightboxCloseButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.2)",
  },
  lightboxTitle: {
    flex: 1,
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700",
  },
  lightboxImageWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
    paddingBottom: 20,
  },
  lightboxImage: {
    width: "100%",
    height: "100%",
  },
});
