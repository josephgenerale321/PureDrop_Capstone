import { useLocalSearchParams, useRouter } from "expo-router";
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { CreateReportFormContent } from "../../../components/create_report/CreateReportFormContent";
import { GpsMapModal } from "../../../components/create_report/GpsMapModal";
import { styles } from "../../../components/create_report/createReportStyles";
import { useEditReportForm } from "../../../components/my_report/edit_myreport/useEditReportForm";

export default function EditMyReportScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ reportId?: string }>();
  const reportId = typeof params.reportId === "string" ? params.reportId : "";

  const form = useEditReportForm(reportId);

  const handleBackPress = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/regular_user/my_report");
    }
  };

  const handleSavePress = async () => {
    const didSave = await form.handleSave();
    if (didSave) {
      Alert.alert("Report updated", "Your report changes have been saved.");
      router.back();
    }
  };

  if (form.loading) {
    return (
      <SafeAreaView style={editStyles.screen}>
        <View style={editStyles.centered}>
          <ActivityIndicator size="large" color="#0EA5E9" />
          <Text style={editStyles.loadingText}>Loading report...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (form.loadError || !reportId) {
    return (
      <SafeAreaView style={editStyles.screen}>
        <View style={editStyles.centered}>
          <Text style={editStyles.errorTitle}>Unable to Load Report</Text>
          <Text style={editStyles.errorText}>
            This report could not be found or you do not have permission to edit it.
          </Text>
          <TouchableOpacity style={editStyles.errorButton} onPress={handleBackPress} activeOpacity={0.85}>
            <Text style={editStyles.errorButtonText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <CreateReportFormContent
        address={form.address}
        attachments={form.attachments}
        category={form.category}
        gpsAccuracy={form.gpsAccuracy}
        gpsLoading={form.gpsLoading}
        gpsLocation={form.gpsLocation}
        selectedPin={form.selectedPin}
        issue={form.issue}
        location={form.location}
        submitLoading={form.submitLoading}
        waterMeter={form.waterMeter}
        onAddressChange={form.setAddress}
        onCategoryChange={form.setCategory}
        onIssueChange={form.setIssue}
        onLocationChange={form.setLocation}
        onPickAttachment={form.handlePickAttachment}
        onRemoveAttachment={form.handleRemoveAttachment}
        onBack={handleBackPress}
        onSubmit={handleSavePress}
        onUseGps={form.handleUseGps}
        onWaterMeterChange={form.setWaterMeter}
        pageTitle="Edit Report"
        submitLabel="Save Changes"
      />

      <GpsMapModal
        gpsAccuracy={form.gpsAccuracy}
        gpsLoading={form.gpsLoading}
        initialRegion={form.mapRegion}
        visible={form.mapVisible}
        followEnabled={form.followEnabled}
        center={form.mapCenter}
        recenterKey={form.recenterKey}
        onCancel={form.handleCancelMapLocation}
        onConfirm={form.handleConfirmMapLocation}
        onRecenter={form.handleRecenterMap}
        onToggleFollow={form.handleToggleFollow}
        onRegionChangeComplete={form.handleRegionChangeComplete}
      />
    </SafeAreaView>
  );
}

const editStyles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#F1F5F9",
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  loadingText: {
    marginTop: 12,
    color: "#475569",
    fontSize: 14,
    fontWeight: "600",
  },
  errorTitle: {
    color: "#0F172A",
    fontSize: 20,
    fontWeight: "800",
    marginBottom: 8,
    textAlign: "center",
  },
  errorText: {
    color: "#64748B",
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
    marginBottom: 24,
  },
  errorButton: {
    backgroundColor: "#0EA5E9",
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
  },
  errorButtonText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700",
  },
});