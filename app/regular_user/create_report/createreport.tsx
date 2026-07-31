import { useNavigation, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { AttachmentMachineLearningStatus } from "../../../components/create_report/AttachmentMachineLearning";
import { CreateReportFormContent } from "../../../components/create_report/CreateReportFormContent";
import { GpsMapModal } from "../../../components/create_report/GpsMapModal";
import { styles } from "../../../components/create_report/createReportStyles";
import { useCreateReportForm } from "../../../components/create_report/useCreateReportForm";
import { isLogoutInProgress } from "../../../lib/auth/logoutState";

export default function CreateReportScreen() {
  const form = useCreateReportForm();
  const router = useRouter();
  const navigation = useNavigation();
  const discardAlertVisibleRef = useRef(false);
  const isDiscardingRef = useRef(false);
  const resetFormRef = useRef(form.resetForm);
  const [attachmentReview, setAttachmentReview] = useState<AttachmentMachineLearningStatus | null>(
    null,
  );
  
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isFormDirty =
    form.category !== "" ||
    form.issue !== "" ||
    form.address !== "" ||
    form.location !== "" ||
    form.gpsLocation !== "" ||
    form.attachments.length > 0 ||
    form.waterMeter !== "";

  useEffect(() => {
    resetFormRef.current = form.resetForm;
  }, [form.resetForm]);

  useEffect(() => {
    const unsubscribe = navigation.addListener("beforeRemove", (e) => {
      // If we're submitting, or the form is clean, let the navigation happen
      if (!isFormDirty || isSubmitting || isDiscardingRef.current || isLogoutInProgress()) {
        return;
      }

      const beforeRemoveEvent = e as typeof e & { preventDefault: () => void };

      // Prevent default behavior of leaving the screen
      beforeRemoveEvent.preventDefault();

      if (discardAlertVisibleRef.current) {
        return;
      }

      discardAlertVisibleRef.current = true;

      Alert.alert(
        "Discard Report?",
        "You have unfinished details in your report. Are you sure you want to discard them?",
        [
          {
            text: "Keep Editing",
            style: "cancel",
            onPress: () => {
              discardAlertVisibleRef.current = false;
            },
          },
          {
            text: "Discard",
            style: "destructive",
            onPress: () => {
              if (isDiscardingRef.current) {
                return;
              }

              discardAlertVisibleRef.current = false;
              isDiscardingRef.current = true;
              resetFormRef.current();
              navigation.dispatch(beforeRemoveEvent.data.action);
            },
          },
        ],
        {
          onDismiss: () => {
            discardAlertVisibleRef.current = false;
          },
        },
      );
    });

    return unsubscribe;
  }, [navigation, isFormDirty, isSubmitting]);

  useEffect(() => {
    const unsubscribe = navigation.addListener("focus", () => {
      discardAlertVisibleRef.current = false;
      isDiscardingRef.current = false;
    });

    return unsubscribe;
  }, [navigation]);

  const handleBackPress = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/regular_user/home");
    }
  };

  const handleSubmitPress = async () => {
    const attachmentUris = form.attachments.map((attachment) => attachment.uri);
    const hasPendingAttachmentReview =
      attachmentUris.length > 0 &&
      (!attachmentReview ||
        attachmentReview.state === "idle" ||
        attachmentReview.state === "analyzing" ||
        attachmentReview.attachmentUris.length !== attachmentUris.length ||
        !attachmentUris.every((uri) => attachmentReview.attachmentUris.includes(uri)));

    if (hasPendingAttachmentReview) {
      Alert.alert("Attachment check", "Please wait until the current attachments finish review.");
      return;
    }

    if (attachmentReview && !attachmentReview.canSubmit) {
      Alert.alert("Attachment check", attachmentReview.summary);
      return;
    }

    setIsSubmitting(true);
    const didSubmit = await form.handleSubmit();
    if (didSubmit) {
      router.replace("/regular_user/create_report/submitted");
    } else {
      setIsSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <CreateReportFormContent
        address={form.address}
        attachments={form.attachments}
        category={form.category}
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
        onAttachmentReviewChange={setAttachmentReview}
        onPickAttachment={form.handlePickAttachment}
        onRemoveAttachment={form.handleRemoveAttachment}
        onBack={handleBackPress}
        onSubmit={handleSubmitPress}
        onUseGps={form.handleUseGps}
        onWaterMeterChange={form.setWaterMeter}
      />

      <GpsMapModal
        gpsLoading={form.gpsLoading}
        initialRegion={form.mapRegion}
        visible={form.mapVisible}
        onCancel={form.handleCancelMapLocation}
        onConfirm={form.handleConfirmMapLocation}
        onRegionChangeComplete={form.handleRegionChangeComplete}
      />
    </SafeAreaView>
  );
}
