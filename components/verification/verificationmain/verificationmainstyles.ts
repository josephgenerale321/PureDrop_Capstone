import { StyleSheet } from "react-native";

// Styles for the Verification Main screen (app/verification/verificationmain).
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
  // Back confirmation lightbox (same pattern as the other verification modals)
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
  // Destructive LOG OUT button in the back-confirm lightbox — same red as the
  // sign-out modal's YES button; only shown to previously-verified users whose
  // account is re-rejected (their only way out of the hub).
  confirmLogoutButton: {
    backgroundColor: "#EF4444",
  },
  confirmButtonText: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 15,
  },
  confirmCancelButtonText: {
    color: "#475569",
  },
  content: {
    flex: 1,
    alignItems: "center",
    paddingTop: 56,
  },
  title: {
    fontSize: 24,
    fontWeight: "600",
    color: "#0F172A",
    marginBottom: 40,
  },
  // Pending-admin-review banner — shown while verificationStatus is
  // "pending" (both steps in, awaiting the admin's decision).
  pendingBanner: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "stretch",
    backgroundColor: "#FEF9C3",
    borderColor: "#FACC15",
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 28,
  },
  pendingBannerText: {
    flex: 1,
    marginLeft: 8,
    color: "#854D0E",
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 18,
  },
  identityBanner: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F1F5F9",
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 32,
  },
  identityIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#D6E8F7",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  identityTextWrap: {
    flex: 1,
  },
  identityLabel: {
    fontSize: 12,
    color: "#64748B",
  },
  identityEmail: {
    fontSize: 14,
    fontWeight: "600",
    color: "#0F172A",
  },
  identityEmailMissing: {
    color: "#94A3B8",
    fontWeight: "400",
  },
  optionCard: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#D6E8F7",
    borderRadius: 16,
    paddingVertical: 22,
    paddingHorizontal: 28,
    marginBottom: 32,
    borderWidth: 2,
    borderColor: "transparent",
  },
  optionText: {
    fontSize: 17,
    color: "#0F172A",
    marginLeft: 20,
  },
  // Text stack on the "Verify your id" card — holds the title plus the
  // submitted ID category subtitle. marginLeft matches optionText's indent;
  // the inner title re-declares the font without the extra margin.
  optionTextWrap: {
    flex: 1,
    marginLeft: 20,
  },
  optionTextInWrap: {
    fontSize: 17,
    color: "#0F172A",
  },
  // Submitted ID category subtitle on the "Verify your id" card — smaller and
  // muted so it reads as metadata under the title.
  optionSubText: {
    fontSize: 12,
    color: "#64748B",
    marginTop: 2,
  },
  // Completion check pinned to the right edge of an option card —
  // marginLeft: "auto" pushes it to the end of the row layout.
  optionCheck: {
    marginLeft: "auto",
  },
  // Mini ID-card icon on the "Verify your id" option card. Fixed at 30px
  // wide — the same footprint as the 30px Ionicons used on the Face
  // Recognition card — so both rows' text lines up (height 30/1.586 ≈ 19
  // keeps the CR80 card ratio).
  idCardIcon: {
    width: 30,
    height: 19,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: "#0F172A",
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 3,
  },
  idCardIconPhoto: {
    width: 6,
    height: 9,
    borderRadius: 1,
    backgroundColor: "#0F172A",
  },
  idCardIconLines: {
    flex: 1,
    gap: 2,
  },
  idCardIconLine: {
    height: 2,
    borderRadius: 1,
    backgroundColor: "#0F172A",
  },
  idCardIconLineShort: {
    width: "60%",
  },
});

