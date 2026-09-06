import { StyleSheet } from "react-native";

// Styles for the Face Scan Details review screen
// (app/verification/face_selfie/cameraface_selfie/reviewselfiedetails.tsx).
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
    flexGrow: 1,
    alignItems: "center",
    paddingTop: 24,
    // Breathing room under the "What was checked" card — without it the
    // card sits flush against the fixed footer (Submit) when scrolled down.
    paddingBottom: 32,
  },
  title: {
    fontSize: 24,
    fontWeight: "600",
    color: "#0F172A",
    marginBottom: 28,
  },
  previewWrap: {
    width: "85%",
    aspectRatio: 3 / 4,
    borderRadius: 24,
    backgroundColor: "#E2E8F0",
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  previewImage: {
    ...StyleSheet.absoluteFillObject,
    width: "100%",
    height: "100%",
  },
  previewPlaceholder: {
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  previewPlaceholderText: {
    fontSize: 13,
    color: "#94A3B8",
  },
  scoreCard: {
    alignItems: "center",
    marginTop: 28,
  },
  scoreLabel: {
    fontSize: 16,
    fontWeight: "600",
    color: "#0F172A",
  },
  scoreValue: {
    fontSize: 28,
    fontWeight: "700",
    color: "#0EA5E9",
    marginTop: 6,
  },
  // Liveness checklist card — the measured checks behind the score.
  checklistCard: {
    width: "85%",
    marginTop: 24,
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
  footer: {
    alignItems: "center",
    paddingBottom: 32,
  },
  submitButton: {
    width: "78%",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0EA5E9",
    borderRadius: 10,
    paddingVertical: 14,
    shadowColor: "#0EA5E9",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  submitButtonDisabled: {
    opacity: 0.5,
    elevation: 0,
    shadowOpacity: 0,
  },
  submitButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#FFFFFF",
  },
  confirmOverlay: {
    ...StyleSheet.absoluteFillObject,
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
  confirmSubmitButton: {
    backgroundColor: "#0EA5E9",
    shadowColor: "#0EA5E9",
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
  // "Face Scan Uploaded" lightbox icon badge
  uploadedIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "#DCFCE7",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  // "Maybe later" text link at the bottom of the Valid ID Already Submitted
  // lightbox — plain, low-emphasis, same look as the valid-id action cancel.
  modalCancelButton: {
    marginTop: 14,
    paddingVertical: 8,
  },
  modalCancelButtonText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#94A3B8",
  },
});

