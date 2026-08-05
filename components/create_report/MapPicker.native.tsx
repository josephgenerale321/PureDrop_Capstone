import type { StyleProp, ViewStyle } from "react-native";
import { OsmTileMap } from "./OsmTileMap.native";

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

export function MapPicker({
  style,
  initialRegion,
  onRegionChangeComplete,
  center,
  recenterKey,
}: MapPickerProps) {
  return (
    <OsmTileMap
      style={style}
      initialRegion={initialRegion}
      interactive
      onRegionChangeComplete={onRegionChangeComplete}
      center={center}
      recenterKey={recenterKey}
    />
  );
}
