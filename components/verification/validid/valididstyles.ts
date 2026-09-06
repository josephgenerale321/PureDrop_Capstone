import { StyleSheet } from "react-native";

// Styles for the Valid ID verification flow (app/verification/valid_id).
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
  content: {
    alignItems: "center",
    paddingBottom: 32,
  },
  title: {
    fontSize: 24,
    fontWeight: "600",
    color: "#0F172A",
    marginTop: 32,
    marginBottom: 40,
  },
  dropdownSelector: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#D6E8F7",
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 18,
  },
  dropdownSelectorText: {
    fontSize: 16,
    color: "#0F172A",
    flex: 1,
  },
  dropdownSelectorPlaceholder: {
    color: "#0F172A",
  },
  dropdownList: {
    width: "100%",
    backgroundColor: "#F1F5F9",
    borderRadius: 12,
    marginTop: 8,
    overflow: "hidden",
  },
  dropdownItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
    paddingHorizontal: 18,
  },
  dropdownItemSelected: {
    backgroundColor: "#D6E8F7",
  },
  dropdownItemText: {
    fontSize: 15,
    color: "#0F172A",
    flex: 1,
  },
  photoBox: {
    width: "85%",
    aspectRatio: 1.586, // CR80 ID card ratio (85.6mm x 54mm)
    borderRadius: 16,
    backgroundColor: "#F1F5F9",
    borderWidth: 2,
    borderColor: "#CBD5E1",
    borderStyle: "dashed",
    padding: 14,
    marginTop: 40,
    overflow: "hidden",
    shadowColor: "#0EA5E9",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  photoBoxAttached: {
    borderStyle: "solid",
    borderColor: "#22C55E",
    backgroundColor: "#FFFFFF",
  },
  photoBoxHeader: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  photoBoxLabel: {
    fontSize: 16,
    fontWeight: "600",
    color: "#0EA5E9",
  },
  photoBoxBody: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  cameraBadge: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#D6E8F7",
    alignItems: "center",
    justifyContent: "center",
  },
  photoBoxHint: {
    fontSize: 14,
    fontWeight: "600",
    color: "#0EA5E9",
  },
  photoBoxMicrocopy: {
    fontSize: 11,
    color: "#64748B",
    textAlign: "center",
  },
  previewArea: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 10,
    borderRadius: 10,
    backgroundColor: "#E2E8F0",
    // Clips the absolutely-filled photo to the rounded preview area so it
    // always fits neatly inside the box below the header (the box's remaining
    // height is smaller than the CR80 1.586 ratio, so the photo must be sized
    // by the container, not by its own aspect ratio).
    overflow: "hidden",
  },
  previewCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#FFFFFF",
    borderRadius: 6,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  previewPortrait: {
    width: 26,
    height: 32,
    borderRadius: 4,
    backgroundColor: "#CBD5E1",
  },
  previewLinesWrap: {
    flex: 1,
    gap: 6,
    maxWidth: 120,
  },
  previewLine: {
    height: 5,
    borderRadius: 2.5,
    backgroundColor: "#CBD5E1",
  },
  retakeChip: {
    position: "absolute",
    top: 6,
    right: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: "rgba(15, 23, 42, 0.75)",
    borderRadius: 8,
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  retakeChipText: {
    fontSize: 11,
    fontWeight: "600",
    color: "#FFFFFF",
  },
  submitButton: {
    width: "78%",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0EA5E9",
    borderRadius: 10,
    paddingVertical: 14,
    marginTop: 48,
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

  // Submit confirmation modal (same pattern as the signout modal)
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
  // Real captured ID photo preview (from valididcapture). Fills the preview
  // area edge-to-edge; resizeMode="cover" crops instead of distorting, and the
  // previewArea clips it to the box's remaining space below the header.
  previewPhoto: {
    ...StyleSheet.absoluteFillObject,
    width: "100%",
    height: "100%",
    backgroundColor: "#0F172A",
  },

  // Attached-photo action card (View Image / Retake) — reuses the confirm
  // modal card styles (confirmOverlay / confirmCard / confirmTitle /
  // confirmMessage / confirmButtonText) for the shared look.
  actionThumbnail: {
    width: "100%",
    aspectRatio: 1.586, // CR80 ID card ratio, matches the attach box
    borderRadius: 10,
    backgroundColor: "#E2E8F0",
    marginBottom: 14,
  },
  actionButtonsWrap: {
    width: "100%",
    gap: 10,
  },
  actionButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 46,
    borderRadius: 12,
  },
  actionButtonPrimary: {
    backgroundColor: "#0EA5E9",
    shadowColor: "#0EA5E9",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  actionButtonSecondary: {
    backgroundColor: "#F1F5F9",
    borderWidth: 1,
    borderColor: "#CBD5E1",
  },
  actionCancelButton: {
    marginTop: 6,
    paddingVertical: 10,
  },
  actionCancelButtonText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#94A3B8",
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

