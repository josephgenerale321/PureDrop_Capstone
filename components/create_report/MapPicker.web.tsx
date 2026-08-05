import type { StyleProp, ViewStyle } from "react-native";
import { StyleSheet, Text, View } from "react-native";

export type Coordinate = {
  latitude: number;
  longitude: number;
};

export type Region = Coordinate & {
  latitudeDelta: number;
  longitudeDelta: number;
};

type MapPickerProps = {
  style?: StyleProp<ViewStyle>;
  initialRegion: Region;
  onRegionChangeComplete: (region: Region) => void;
  center?: {
    latitude: number;
    longitude: number;
  } | null;
  recenterKey?: number;
};

export function MapPicker({ style }: MapPickerProps) {
  return (
    <View style={[style, styles.fallback]}>
      <Text style={styles.title}>Map picker is unavailable on this platform.</Text>
      <Text style={styles.text}>Use the GPS button to auto-fill your current location.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    backgroundColor: "#f8fafc",
  },
  title: {
    color: "#0f172a",
    fontSize: 16,
    fontWeight: "700",
    marginBottom: 8,
    textAlign: "center",
  },
  text: {
    color: "#334155",
    fontSize: 14,
    textAlign: "center",
  },
});
