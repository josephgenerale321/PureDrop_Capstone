import { useLocalSearchParams, useNavigation, useRouter, useFocusEffect } from "expo-router";
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import type { EventArg, NavigationAction } from "@react-navigation/native";
import { SafeAreaView } from "react-native-safe-area-context";
import { CreateReportFormContent } from "../../../components/create_report/CreateReportFormContent";
import { GpsMapModal } from "../../../components/create_report/GpsMapModal";
import { styles } from "../../../components/create_report/createReportStyles";
import { DiscardChangesLightbox } from "../../../components/my_report/edit_myreport/DiscardChangesLightbox";
import { useEditReportForm } from "../../../components/my_report/edit_myreport/useEditReportForm";
import { isLogoutInProgress } from "../../../lib/auth/logoutState";

// Navigation event fired before the screen is removed from the navigator
// (`preventable` = true, carrying the action that was about to happen). The
// unsaved-changes lightbox queues this event's action and dispatches it only
// after the user confirms the discard.
type BeforeRemoveEvent = EventArg<
  "beforeRemove",
  true,
  { action: NavigationAction }
>;

export default function EditMyReportScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const params = useLocalSearchParams<{ reportId?: string }>();
  const reportId = typeof params.reportId === "string" ? params.reportId : "";

  const form = useEditReportForm(reportId);

  // Unsaved-changes lightbox state. When `beforeRemove` fires with dirty
  // edits, the navigation is prevented and its action is queued here; the
  // lightbox's [Discard] button dispatches it, [Keep Editing] drops it.
  const [discardModalVisible, setDiscardModalVisible] = useState(false);
  const pendingRemoveEventRef = useRef<BeforeRemoveEvent | null>(null);
  // Set once the user confirms (or a save succeeds), so exactly one
  // navigation passes through the guard afterwards.
  const isDiscardingRef = useRef(false);

  useEffect(() => {
    const unsubscribe = navigation.addListener("beforeRemove", (e) => {
      const beforeRemoveEvent = e as BeforeRemoveEvent;

      // A save is in flight — block navigation so the update isn't abandoned
      // mid-write. `handleSavePress` navigates back itself once the save
      // finishes, so this only swallows back taps during "Saving...".
      if (form.submitLoading) {
        beforeRemoveEvent.preventDefault();
        return;
      }
      // Clean form, an already-confirmed discard, or an in-progress logout
      // (which must never be blocked by this screen) — let navigation happen.
      if (!form.isDirty || isDiscardingRef.current || isLogoutInProgress()) {
        return;
      }

      // Unsaved edits: stop the removal and open the confirm lightbox.
      beforeRemoveEvent.preventDefault();
      pendingRemoveEventRef.current = beforeRemoveEvent;
      setDiscardModalVisible(true);
    });

    return unsubscribe;
  }, [navigation, form.isDirty, form.submitLoading]);

  // [Keep Editing]: close the lightbox and drop the queued navigation.
  const handleKeepEditing = useCallback(() => {
    pendingRemoveEventRef.current = null;
    setDiscardModalVisible(false);
  }, []);

  // Leaves the Edit screen the ordinary way (history back, with a fallback
  // for a cold deep-link where there is nothing to go back to).
  const performBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/regular_user/my_report");
    }
  }, [router]);

  // [Discard]: confirm the discard and redirect to the My Reports page
  // (always, regardless of where the back navigation was headed).
  // `isDiscardingRef` whitelists this one navigation so the unsaved-changes
  // guard lets the redirect through without a second prompt.
  const handleDiscardChanges = useCallback(() => {
    pendingRemoveEventRef.current = null;
    setDiscardModalVisible(false);
    isDiscardingRef.current = true;
    router.replace("/regular_user/my_report");
  }, [router]);

  // Reset the guard state whenever the screen regains focus, so a future
  // edit session (remount) never inherits a stale "discarding" flag or a
  // half-open lightbox.
  useEffect(() => {
    const unsubscribe = navigation.addListener("focus", () => {
      pendingRemoveEventRef.current = null;
      setDiscardModalVisible(false);
      isDiscardingRef.current = false;
    });
    return unsubscribe;
  }, [navigation]);

  // Header back button. Screens in the Tabs navigator stay mounted across
  // navigation, so `beforeRemove` does NOT fire on the history back this
  // button performs — the dirtiness check must happen here.
  const handleBackPress = () => {
    if (form.submitLoading) {
      return; // swallow back taps while "Saving..."
    }
    if (form.isDirty && !isDiscardingRef.current) {
      pendingRemoveEventRef.current = null;
      setDiscardModalVisible(true);
      return;
    }
    performBack();
  };

  // Android hardware / gesture back — same interception as the header button
  // (same pattern as `viewallreports.tsx`).
  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
        if (form.submitLoading) {
          return true; // swallow back taps while "Saving..."
        }
        if (form.isDirty && !isDiscardingRef.current) {
          pendingRemoveEventRef.current = null;
          setDiscardModalVisible(true);
          return true;
        }
        return false; // clean form — let expo-router handle the back
      });
      return () => subscription.remove();
    }, [form.isDirty, form.submitLoading]),
  );

  const handleSavePress = async () => {
    const didSave = await form.handleSave();
    if (didSave) {
      // Mark the form clean and whitelist this one navigation so the
      // unsaved-changes guard lets the post-save `router.back()` through.
      form.markFormClean();
      isDiscardingRef.current = true;
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

      <DiscardChangesLightbox
        visible={discardModalVisible}
        onKeepEditing={handleKeepEditing}
        onDiscard={handleDiscardChanges}
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