import { Ionicons } from "@expo/vector-icons";
import { useMemo, useState } from "react";
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  AttachmentMachineLearning,
  type AttachmentMachineLearningStatus,
} from "./AttachmentMachineLearning";
import { useCreateReportKeyboardScroll } from "./create_reportbehavior";
import { styles } from "./createReportStyles";
import { LightboxCreateReport } from "./LightboxCreateReport";
import { MiniMapPreview } from "./MiniMapPreview";
import type { Attachment } from "./useCreateReportForm";

type CreateReportFormContentProps = {
  address: string;
  attachments: Attachment[];
category: string;
  gpsAccuracy?: number | null;
  gpsLoading: boolean;
  gpsLocation: string;
  selectedPin?: { latitude: number; longitude: number } | null;
  issue: string;
  location: string;
  submitLoading: boolean;
  waterMeter: string;
  onAddressChange: (value: string) => void;
  onBack: () => void;
  onCategoryChange: (value: string) => void;
  onIssueChange: (value: string) => void;
  onLocationChange: (value: string) => void;
  onPickAttachment: () => void;
  onAttachmentReviewChange?: (status: AttachmentMachineLearningStatus) => void;
  onRemoveAttachment: (index: number) => void;
  onSubmit: () => void;
  onUseGps: () => void;
  onWaterMeterChange: (value: string) => void;
  /** Optional override for the page title. Defaults to "Report a Problem". */
  pageTitle?: string;
  /** Optional override for the submit button label. Defaults to "Submit Report". */
  submitLabel?: string;
};

const CATEGORY_OPTIONS = ["No water", "Dirty water", "Water leaking"];
const ISSUE_MAX_LENGTH = 500;

export function CreateReportFormContent({
  address,
  attachments,
  category,
  gpsAccuracy,
  gpsLoading,
  gpsLocation,
  selectedPin,
  issue,
  location,
  submitLoading,
  waterMeter,
  onAddressChange,
  onBack,
  onCategoryChange,
  onIssueChange,
  onLocationChange,
  onPickAttachment,
  onAttachmentReviewChange,
  onRemoveAttachment,
  onSubmit,
  onUseGps,
  onWaterMeterChange,
  pageTitle = "Report a Problem",
  submitLabel = "Submit Report",
}: CreateReportFormContentProps) {
  const [addressModalVisible, setAddressModalVisible] = useState(false);
  const insets = useSafeAreaInsets();
  const {
    scrollViewRef,
    createReportInputRef,
    createReportFieldLayout,
    createReportSectionLayout,
    followFocusedField,
    focusNextField,
    handleScroll,
    handleScrollBeginDrag,
  } = useCreateReportKeyboardScroll();

  const mobileScrollProps = useMemo(() => {
    if (Platform.OS === "web") {
      return {};
    }
    return {
      showsVerticalScrollIndicator: true,
      ...(Platform.OS === "android" ? { persistentScrollbar: true } : {}),
    };
  }, []);

  return (
    <>
      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 24 : 0}
      >
        <ScrollView
          ref={scrollViewRef}
          style={styles.formScroll}
          contentContainerStyle={[
            styles.content,
            { paddingTop: Math.max(22, insets.top + 10) },
          ]}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          onScroll={handleScroll}
          onScrollBeginDrag={handleScrollBeginDrag}
          scrollEventThrottle={16}
          {...mobileScrollProps}
        >
          <View style={styles.headerRow}>
            <TouchableOpacity
              style={styles.backButton}
              onPress={onBack}
              activeOpacity={0.85}
              hitSlop={{ top: 12, right: 12, bottom: 12, left: 12 }}
            >
              <Ionicons name="arrow-back" size={24} color="#0F172A" />
            </TouchableOpacity>
            <Text style={styles.pageTitle}>{pageTitle}</Text>
            <View style={{ width: 40 }} />
          </View>

          <Text style={styles.sectionTitle}>Category</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryRow}>
            {CATEGORY_OPTIONS.map((option) => {
              const isSelected = category === option;
              return (
                <TouchableOpacity
                  key={option}
                  style={[styles.categoryPill, isSelected && styles.categoryPillSelected]}
                  onPress={() => onCategoryChange(option)}
                  activeOpacity={0.85}
                >
                  <Text
                    style={[
                      styles.categoryPillText,
                      isSelected && styles.categoryPillTextSelected,
                    ]}
                  >
                    {option}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <View
            style={styles.card}
            onLayout={createReportSectionLayout("details")}
          >
            <Text style={styles.cardTitle}>Issue Details</Text>

            <View onLayout={createReportFieldLayout("issue")}>
              <Text style={styles.label}>Describe the issue</Text>
              <TextInput
                ref={createReportInputRef("issue")}
                value={issue}
                onChangeText={onIssueChange}
                onFocus={() => followFocusedField("issue")}
                onPressIn={() => followFocusedField("issue")}
                style={styles.textArea}
                multiline
                textAlignVertical="top"
                maxLength={ISSUE_MAX_LENGTH}
                placeholder="Please provide details about the problem..."
                placeholderTextColor="#94A3B8"
              />
              <Text
                style={{
                  color: "#94A3B8",
                  fontSize: 12,
                  fontWeight: "600",
                  marginTop: -14,
                  marginBottom: 16,
                  textAlign: "right",
                }}
              >
                {issue.length}/{ISSUE_MAX_LENGTH}
              </Text>
            </View>

            <View onLayout={createReportFieldLayout("waterMeter")}>
              <Text style={styles.label}>Water Meter (Optional)</Text>
              <TextInput
                ref={createReportInputRef("waterMeter")}
value={waterMeter}
                onChangeText={(value) =>
                  onWaterMeterChange(value.replace(/[^\d]/g, "").slice(0, 6))
                }
                onFocus={() => followFocusedField("waterMeter")}
                onPressIn={() => followFocusedField("waterMeter")}
                style={styles.input}
                placeholder="Enter meter reading"
                placeholderTextColor="#94A3B8"
                keyboardType="numeric"
                returnKeyType="next"
                blurOnSubmit={false}
                onSubmitEditing={() => focusNextField("waterMeter")}
              />
            </View>
          </View>

          <View
            style={styles.card}
            onLayout={createReportSectionLayout("location")}
          >
            <Text style={styles.cardTitle}>Location Information</Text>

            <Text style={styles.label}>Barangay</Text>
            <TouchableOpacity
              style={[styles.input, styles.addressPickerTrigger]}
              activeOpacity={0.85}
              onPress={() => setAddressModalVisible(true)}
            >
              <Text style={address ? styles.addressPickerValue : styles.addressPickerPlaceholder}>
                {address || "Select barangay in Toledo City"}
              </Text>
              <Ionicons name="chevron-down" size={16} color="#94A3B8" />
            </TouchableOpacity>

            <View onLayout={createReportFieldLayout("location")}>
              <Text style={styles.label}>Landmark / Specific Location</Text>
              <TextInput
                ref={createReportInputRef("location")}
                value={location}
                onChangeText={onLocationChange}
                onFocus={() => followFocusedField("location")}
                onPressIn={() => followFocusedField("location")}
                style={styles.input}
                placeholder="e.g. In front of the chapel"
                placeholderTextColor="#94A3B8"
                returnKeyType="done"
                onSubmitEditing={() => focusNextField("location")}
              />
            </View>

            <View style={styles.gpsHeader}>
              <Text style={styles.label}>Pin Location on Map</Text>
              {selectedPin ? (
                <TouchableOpacity onPress={onUseGps} activeOpacity={0.7}>
                  <Text style={styles.repickText}>Change Pin</Text>
                </TouchableOpacity>
              ) : null}
            </View>

            {selectedPin ? (
<TouchableOpacity onPress={onUseGps} activeOpacity={0.9}>
                <MiniMapPreview
                  gpsLocation={gpsLocation}
                  gpsAccuracy={gpsAccuracy}
                  selectedPin={selectedPin}
                />
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={[styles.featureButton, gpsLoading && styles.featureButtonLoading]}
                onPress={onUseGps}
                disabled={gpsLoading}
                activeOpacity={0.85}
              >
                <Ionicons name="map-outline" size={20} color="#0EA5E9" />
                <Text style={styles.featureButtonText}>
                  {gpsLoading ? "Loading map..." : "Open Map to Pin Location"}
                </Text>
              </TouchableOpacity>
            )}
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Attachments</Text>
            <Text style={styles.attachmentsText}>Upload up to 2 photos to help us identify the issue.</Text>

            <View style={styles.attachmentRow}>
              {attachments.map((item, index) => (
                <View key={`${item.uri}-${index}`} style={styles.attachmentCard}>
                  <Image source={{ uri: item.uri }} style={styles.attachmentPreview} />
                  <TouchableOpacity
                    style={styles.removeButton}
                    onPress={() => onRemoveAttachment(index)}
                    activeOpacity={0.8}
                  >
                    <Ionicons name="close" size={14} color="#FFFFFF" />
                  </TouchableOpacity>
                </View>
              ))}

              {attachments.length < 2 && (
                <TouchableOpacity
                  style={styles.uploadButton}
                  onPress={onPickAttachment}
                  activeOpacity={0.7}
                >
                  <Ionicons name="image-outline" size={32} color="#94A3B8" />
                  <Text style={styles.uploadButtonText}>Add Photo</Text>
                </TouchableOpacity>
              )}
            </View>

            <AttachmentMachineLearning
              attachments={attachments}
              category={category}
              onStatusChange={onAttachmentReviewChange}
            />
          </View>

          <TouchableOpacity style={styles.submitButton} onPress={onSubmit} disabled={submitLoading} activeOpacity={0.85}>
            <Text style={styles.submitText}>
              {submitLoading
                ? "Saving..."
                : submitLabel}
            </Text>
            {!submitLoading && <Ionicons name="arrow-forward" size={20} color="#FFFFFF" />}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>

      <LightboxCreateReport
        selectedAddress={address}
        visible={addressModalVisible}
        onClose={() => setAddressModalVisible(false)}
        onSelectAddress={onAddressChange}
      />
    </>
  );
}
