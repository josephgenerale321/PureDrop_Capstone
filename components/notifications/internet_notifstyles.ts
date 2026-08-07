import { StyleSheet } from "react-native";

/**
 * Shared styles for the in-app "No Internet connection" banner
 * (`components/notifications/nointernet_notif.tsx`).
 *
 * Dark/gray theme designed to be user-friendly and readable against the app's
 * light screens. Uses only React Native core style properties so it works on
 * Android, iOS, and web.
 */
export const styles = StyleSheet.create({
overlay: {
    position: "absolute",
    left: 12,
    right: 12,
    zIndex: 9999,
    elevation: 9999,
  },
  banner: {
    width: "100%",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#334155",
    backgroundColor: "#1E293B",
    padding: 10,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 6,
  },
  rowBetween: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  reportTitleWrap: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    paddingRight: 8,
  },
  iconWrap: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#334155",
    marginRight: 8,
  },
  title: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "800",
    flexShrink: 1,
  },
  statusWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
  },
statusWrapOffline: {
    backgroundColor: "#3F1D1D",
    borderColor: "#7F1D1D",
  },
  statusWrapOnline: {
    backgroundColor: "#123524",
    borderColor: "#166534",
  },
  status: {
    fontSize: 10,
    fontWeight: "800",
  },
  statusOffline: {
    color: "#FCA5A5",
  },
  statusOnline: {
    color: "#86EFAC",
  },
  message: {
    color: "#CBD5E1",
    fontSize: 12,
    lineHeight: 16,
    marginBottom: 4,
  },
  footerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  hint: {
    color: "#94A3B8",
    fontSize: 11,
    flex: 1,
  },
  dismissBtn: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#334155",
  },
});
