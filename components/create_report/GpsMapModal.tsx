import { ActivityIndicator, Modal, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { MapPicker, type Region } from "./MapPicker";
import { styles } from "./createReportStyles";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type GpsMapModalProps = {
  gpsAccuracy: number | null | undefined;
  gpsLoading: boolean;
  initialRegion: Region;
  visible: boolean;
  followEnabled: boolean;
  center?: { latitude: number; longitude: number } | null;
  recenterKey?: number;
  onCancel: () => void;
  onConfirm: () => void;
  onRecenter: () => void;
  onToggleFollow: () => void;
  onRegionChangeComplete: (region: Region) => void;
};

export function GpsMapModal({
  gpsAccuracy,
  gpsLoading,
  initialRegion,
  visible,
  followEnabled,
  center,
  recenterKey,
  onCancel,
  onConfirm,
  onRecenter,
  onToggleFollow,
  onRegionChangeComplete,
}: GpsMapModalProps) {
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.fullScreenMapContainer}>
        <MapPicker
          style={styles.fullScreenMap}
          initialRegion={initialRegion}
          onRegionChangeComplete={onRegionChangeComplete}
          center={center}
          recenterKey={recenterKey}
        />

        {/* Fixed Center Pin */}
        <View style={styles.centerPinContainer} pointerEvents="none">
          <View style={styles.centerPinIconWrap}>
            <Ionicons name="location" size={40} color="#EF4444" />
          </View>
          <View style={styles.centerPinShadow} />
        </View>

{/* Floating Top Bar */}
        <View style={[styles.floatingTopBar, { top: Math.max(20, insets.top + 10) }]}>
          <TouchableOpacity style={styles.floatingCloseButton} onPress={onCancel} activeOpacity={0.8}>
            <Ionicons name="close" size={24} color="#0F172A" />
          </TouchableOpacity>
<TouchableOpacity
            style={styles.floatingRecenterButton}
            onPress={onRecenter}
            disabled={gpsLoading}
            activeOpacity={0.8}
          >
            {gpsLoading ? (
              <ActivityIndicator size="small" color="#0F172A" />
            ) : (
              <>
                <Ionicons name="locate" size={20} color="#0EA5E9" />
                <Text style={styles.floatingRecenterText}>My Location</Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        {/* Follow My Location Toggle */}
        <TouchableOpacity
          style={[styles.followLocationButton, followEnabled && styles.followLocationButtonActive]}
          onPress={onToggleFollow}
          activeOpacity={0.8}
        >
          <Ionicons
            name={followEnabled ? "navigate" : "navigate-outline"}
            size={20}
            color={followEnabled ? "#FFFFFF" : "#0EA5E9"}
          />
          <Text
            style={[styles.followLocationText, followEnabled && styles.followLocationTextActive]}
          >
            {followEnabled ? "Following" : "Follow Me"}
          </Text>
        </TouchableOpacity>

        {/* Floating Bottom Bar */}
        <View style={[styles.floatingBottomBar, { paddingBottom: Math.max(24, insets.bottom + 12) }]}>
          <View style={styles.floatingConfirmPanel}>
<Text style={styles.floatingInstructionText}>
              {"Drag the map to perfectly align the pin with your issue's location."}
            </Text>
            <View style={styles.gpsStatusRow}>
              {gpsLoading ? (
                <>
                  <ActivityIndicator size="small" color="#0EA5E9" />
                  <Text style={styles.gpsStatusText}>Acquiring GPS signal...</Text>
                </>
              ) : gpsAccuracy != null ? (
                <>
                  <Ionicons
                    name="radio-button-on"
                    size={14}
                    color={gpsAccuracy <= 30 ? "#16A34A" : "#F59E0B"}
                  />
                  <Text
                    style={[
                      styles.gpsStatusText,
                      { color: gpsAccuracy <= 30 ? "#16A34A" : "#B45309" },
                    ]}
                  >
                    ±{Math.round(gpsAccuracy)}m accuracy
                  </Text>
                </>
              ) : (
                <>
                  <Ionicons name="information-circle-outline" size={14} color="#64748B" />
                  <Text style={styles.gpsStatusText}>
                    No live GPS fix — drag to pick a location
                  </Text>
                </>
              )}
            </View>
            <TouchableOpacity style={styles.floatingConfirmButton} onPress={onConfirm} activeOpacity={0.85}>
              {gpsLoading ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <>
                  <Ionicons name="checkmark-circle" size={22} color="#FFFFFF" />
                  <Text style={styles.floatingConfirmText}>Confirm Location</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}
