/**
 * TabUnreadBadge — the red unread dot on the Notifications tab icon.
 *
 * This is a component (rather than inline JSX in the tab layout) so that the
 * notification context is consumed HERE. Unread counts change on every report /
 * notification snapshot, and when the tab layout consumed `unreadCount` directly
 * every one of those updates re-rendered the whole `<Tabs>` navigator while the
 * user was tapping a tab (the felt latency on slower phones). Subscribing in a
 * leaf component keeps those updates to this few-pixel view.
 */
import { StyleSheet, Text, View } from "react-native";
import { useReportNotifications } from "./notif_func";

type Props = {
  /** Hidden while the Notifications tab is the active one. */
  focused: boolean;
};

export default function TabUnreadBadge({ focused }: Props) {
  const { unreadCount } = useReportNotifications();

  if (focused || unreadCount <= 0) {
    return null;
  }

  return (
    <View style={styles.notifDot}>
      <Text style={styles.notifDotText}>
        {unreadCount > 9 ? "9+" : String(unreadCount)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  notifDot: {
    position: "absolute",
    top: -4,
    right: -8,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#EF4444",
    borderWidth: 1.5,
    borderColor: "#FFFFFF",
  },

  notifDotText: {
    color: "#FFFFFF",
    fontSize: 10,
    fontWeight: "800",
    lineHeight: 12,
  },
});