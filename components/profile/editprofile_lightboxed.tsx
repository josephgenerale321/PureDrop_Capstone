import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { FlashList } from "@shopify/flash-list";
import type { EditableProfileValues } from "./useProfileBackend";

const CITY_SUFFIX = ", Toledo City";

const BARANGAYS: string[] = [
  "Awihao",
  "Bagakay",
  "Bato",
  "Biga",
  "Bulongan",
  "Bunga",
  "Cabitoonan",
  "Calongcalong",
  "Cambang-ug",
  "Camp 8",
  "Canlumampao",
  "Cantabaco",
  "Capitan Claudio",
  "Carmen",
  "Daanglungsod",
  "Don Andres Soriano (Lutopan)",
  "Dumlog",
  "General Climaco",
  "Ibo",
  "Ilihan",
  "Juan Climaco, Sr. (formerly Malubog)",
  "Landahan",
  "Loay",
  "Luray II",
  "Magdugo",
  "Matab-ang",
  "Media Once",
  "Pangamihan",
  "Pandong Bato",
  "Poblacion",
  "Poog",
  "Putingbato",
  "Sam-ang",
  "Sangi",
  "Santo Ni\u00f1o",
  "Subayon",
  "Tancor",
  "Tubod",
];

type EditProfileLightboxProps = {
  visible: boolean;
  values: EditableProfileValues;
  saving: boolean;
  uploadingProfilePicture: boolean;
  profileImageUrl?: string | null;
  pendingAvatarUri?: string | null;
  hasProfilePicture?: boolean;
  onClose: () => void;
  onSave: (values: EditableProfileValues) => void;
  onChangeProfilePicture: () => void;
  onTakePhoto: () => void;
  onRemoveProfilePicture: () => void;
};

export default function EditProfileLightbox({
  visible,
  values,
  saving,
  uploadingProfilePicture,
  profileImageUrl,
  pendingAvatarUri,
  hasProfilePicture,
  onClose,
  onSave,
  onChangeProfilePicture,
  onTakePhoto,
  onRemoveProfilePicture,
}: EditProfileLightboxProps) {
  const [form, setForm] = useState<EditableProfileValues>(values);
  const [addressPickerVisible, setAddressPickerVisible] = useState(false);
  const [addressQuery, setAddressQuery] = useState("");
  const [photoOptionsVisible, setPhotoOptionsVisible] = useState(false);

  useEffect(() => {
    if (visible) {
      setForm(values);
      setAddressPickerVisible(false);
      setAddressQuery("");
      setPhotoOptionsVisible(false);
    }
  }, [values, visible]);

  const updateField = (key: keyof EditableProfileValues, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const filteredBarangays = BARANGAYS.filter((barangay) =>
    barangay.toLowerCase().includes(addressQuery.trim().toLowerCase()),
  );

  const avatarSource = pendingAvatarUri
    ? { uri: pendingAvatarUri }
    : profileImageUrl
      ? { uri: profileImageUrl }
      : require("../../assets/images/default_account.png");

  const selectAddress = (barangay: string) => {
    updateField("address", `${barangay}${CITY_SUFFIX}`);
    setAddressPickerVisible(false);
    setAddressQuery("");
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.overlay}
      >
        <View style={styles.lightbox}>
          <View style={styles.header}>
            <Text style={styles.title}>Edit Profile</Text>
            <TouchableOpacity
              style={styles.closeButton}
              onPress={onClose}
              disabled={saving}
              activeOpacity={0.8}
            >
              <Text style={styles.closeText}>x</Text>
            </TouchableOpacity>
          </View>

          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.form}
          >
            <View style={styles.avatarSection}>
              <View style={styles.avatarWrap}>
                <Image source={avatarSource} style={styles.avatar} contentFit="cover" />
                {pendingAvatarUri ? (
                  <View style={styles.previewBadge}>
                    <Ionicons name="image-outline" size={12} color="#ffffff" />
                    <Text style={styles.previewBadgeText}>New</Text>
                  </View>
                ) : null}
              </View>
              <TouchableOpacity
                style={[styles.photoButton, uploadingProfilePicture && styles.disabledButton]}
                onPress={() => setPhotoOptionsVisible(true)}
                disabled={uploadingProfilePicture || saving}
                activeOpacity={0.85}
              >
                {uploadingProfilePicture ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <Ionicons name="camera-outline" size={18} color="#ffffff" />
                )}
                <Text style={styles.photoButtonText}>
                  {uploadingProfilePicture
                    ? "Uploading..."
                    : pendingAvatarUri
                      ? "Replace New Photo"
                      : "Edit Profile Picture"}
                </Text>
              </TouchableOpacity>
              {(pendingAvatarUri || hasProfilePicture) && !uploadingProfilePicture ? (
                <TouchableOpacity
                  style={styles.removePhotoButton}
                  onPress={onRemoveProfilePicture}
                  disabled={saving}
                  activeOpacity={0.85}
                >
                  {pendingAvatarUri ? (
                    <>
                      <Ionicons name="close-circle-outline" size={16} color="#ef4444" />
                      <Text style={styles.removePhotoText}>Discard New Photo</Text>
                    </>
                  ) : (
                    <>
                      <Ionicons name="trash-outline" size={16} color="#ef4444" />
                      <Text style={styles.removePhotoText}>Remove Photo</Text>
                    </>
                  )}
                </TouchableOpacity>
              ) : null}
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Full Name</Text>
              <TextInput
                value={form.fullName}
                onChangeText={(value) => updateField("fullName", value)}
                style={styles.input}
                placeholder="Enter full name"
                placeholderTextColor="#94a3b8"
                autoCapitalize="words"
              />
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Address</Text>
              <TouchableOpacity
                style={styles.addressInput}
                activeOpacity={0.8}
                onPress={() => setAddressPickerVisible(true)}
                disabled={saving}
              >
                <Text style={form.address ? styles.inputText : styles.placeholderText}>
                  {form.address || "Select your barangay"}
                </Text>
              </TouchableOpacity>
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Email</Text>
              <TextInput
                value={form.email}
                onChangeText={(value) => updateField("email", value)}
                style={styles.input}
                placeholder="Enter email"
                placeholderTextColor="#94a3b8"
                autoCapitalize="none"
                keyboardType="email-address"
              />
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Water Meter</Text>
              <TextInput
                value={form.waterMeter}
onChangeText={(value) =>
                  updateField("waterMeter", value.replace(/[^\d]/g, "").slice(0, 8))
                }
                style={styles.input}
                placeholder="Enter water meter number"
                placeholderTextColor="#94a3b8"
                keyboardType="numeric"
              />
            </View>
          </ScrollView>

          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.secondaryButton, saving && styles.disabledButton]}
              onPress={onClose}
              disabled={saving}
              activeOpacity={0.85}
            >
              <Text style={styles.secondaryText}>Cancel</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.primaryButton, saving && styles.disabledButton]}
              onPress={() => onSave(form)}
              disabled={saving}
              activeOpacity={0.85}
            >
              <Text style={styles.primaryText}>{saving ? "Saving..." : "Save"}</Text>
            </TouchableOpacity>
          </View>
        </View>

        <Modal
          visible={photoOptionsVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setPhotoOptionsVisible(false)}
        >
          <View style={styles.pickerOverlay}>
            <View style={styles.photoSheet}>
              <Text style={styles.pickerTitle}>Profile Picture</Text>

              <TouchableOpacity
                style={styles.photoOptionButton}
                onPress={() => {
                  setPhotoOptionsVisible(false);
                  onChangeProfilePicture();
                }}
                disabled={uploadingProfilePicture || saving}
                activeOpacity={0.85}
              >
                <Ionicons name="images-outline" size={20} color="#0284c7" />
                <Text style={styles.photoOptionText}>Choose from Library</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.photoOptionButton}
                onPress={() => {
                  setPhotoOptionsVisible(false);
                  onTakePhoto();
                }}
                disabled={uploadingProfilePicture || saving}
                activeOpacity={0.85}
              >
                <Ionicons name="camera-outline" size={20} color="#0284c7" />
                <Text style={styles.photoOptionText}>Take Photo</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.cancelPickerButton}
                onPress={() => setPhotoOptionsVisible(false)}
                activeOpacity={0.85}
              >
                <Text style={styles.cancelPickerText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        <Modal
          visible={addressPickerVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setAddressPickerVisible(false)}
        >
          <View style={styles.pickerOverlay}>
            <View style={styles.pickerSheet}>
              <Text style={styles.pickerTitle}>Select Address</Text>

              <TextInput
                style={styles.searchInput}
                placeholder="Search barangay"
                placeholderTextColor="#94a3b8"
                value={addressQuery}
                onChangeText={setAddressQuery}
              />

<FlashList
                data={filteredBarangays}
                keyExtractor={(item) => item}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={styles.listContent}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.itemButton}
                    onPress={() => selectAddress(item)}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.itemText}>{item}</Text>
                  </TouchableOpacity>
                )}
              />

              <TouchableOpacity
                style={styles.cancelPickerButton}
                onPress={() => setAddressPickerVisible(false)}
                activeOpacity={0.85}
              >
                <Text style={styles.cancelPickerText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "center",
    backgroundColor: "rgba(15, 23, 42, 0.58)",
    paddingHorizontal: 16,
  },
  lightbox: {
    maxHeight: "86%",
    borderRadius: 6,
    backgroundColor: "#ffffff",
    padding: 16,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 8,
  },
  header: {
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    color: "#0f172a",
  },
  closeButton: {
    position: "absolute",
    right: 0,
    width: 36,
    height: 36,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f1f5f9",
  },
  closeText: {
    color: "#475569",
    fontSize: 18,
    fontWeight: "700",
    lineHeight: 20,
  },
  form: {
    paddingTop: 4,
    paddingBottom: 12,
  },
  avatarSection: {
    alignItems: "center",
    marginBottom: 16,
  },
  avatarWrap: {
    alignItems: "center",
  },
  previewBadge: {
    position: "absolute",
    right: -4,
    bottom: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: "#0284c7",
    borderRadius: 10,
    paddingVertical: 3,
    paddingHorizontal: 7,
    borderWidth: 2,
    borderColor: "#ffffff",
  },
  previewBadgeText: {
    color: "#ffffff",
    fontSize: 10,
    fontWeight: "700",
  },
  avatar: {
    width: 92,
    height: 92,
    borderRadius: 46,
    borderWidth: 2,
    borderColor: "#e2e8f0",
    backgroundColor: "#f1f5f9",
    marginBottom: 10,
  },
  photoButton: {
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 6,
    backgroundColor: "#0284c7",
    paddingVertical: 9,
    paddingHorizontal: 14,
  },
  photoButtonText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "700",
  },
  removePhotoButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginTop: 10,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 6,
    backgroundColor: "#fef2f2",
    borderWidth: 1,
    borderColor: "#fecaca",
  },
  removePhotoText: {
    color: "#ef4444",
    fontSize: 13,
    fontWeight: "600",
  },
  fieldGroup: {
    marginBottom: 14,
  },
  label: {
    fontSize: 13,
    color: "#475569",
    fontWeight: "700",
    marginBottom: 6,
  },
  input: {
    minHeight: 44,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#cbd5e1",
    backgroundColor: "#ffffff",
    color: "#0f172a",
    paddingHorizontal: 12,
    fontSize: 15,
  },
  addressInput: {
    minHeight: 44,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#cbd5e1",
    backgroundColor: "#ffffff",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  inputText: {
    color: "#0f172a",
    fontSize: 15,
  },
  placeholderText: {
    color: "#94a3b8",
    fontSize: 15,
  },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: "#e2e8f0",
    paddingTop: 14,
  },
  secondaryButton: {
    minWidth: 88,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#cbd5e1",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: "#ffffff",
  },
  primaryButton: {
    minWidth: 88,
    borderRadius: 6,
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: "#0284c7",
  },
  disabledButton: {
    opacity: 0.65,
  },
  secondaryText: {
    color: "#475569",
    fontSize: 14,
    fontWeight: "700",
  },
  primaryText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "700",
  },
  pickerOverlay: {
    flex: 1,
    justifyContent: "center",
    backgroundColor: "rgba(5, 22, 38, 0.45)",
    paddingHorizontal: 16,
  },
  photoSheet: {
    borderRadius: 8,
    backgroundColor: "#ffffff",
    padding: 16,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 8,
  },
  photoOptionButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 6,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 10,
    backgroundColor: "#ffffff",
  },
  photoOptionText: {
    color: "#0f172a",
    fontSize: 15,
    fontWeight: "600",
  },
  pickerSheet: {
    maxHeight: "82%",
    borderRadius: 8,
    backgroundColor: "#ffffff",
    padding: 16,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 8,
  },
  pickerTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#0f172a",
    marginBottom: 12,
    textAlign: "center",
  },
  searchInput: {
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
    backgroundColor: "#ffffff",
    color: "#0f172a",
  },
  listContent: {
    paddingBottom: 8,
  },
  itemButton: {
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 6,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 8,
    backgroundColor: "#ffffff",
  },
  itemText: {
    color: "#334155",
  },
  cancelPickerButton: {
    marginTop: 8,
    paddingVertical: 12,
    borderRadius: 6,
    backgroundColor: "#f1f5f9",
  },
  cancelPickerText: {
    color: "#475569",
    fontWeight: "600",
    textAlign: "center",
  },
});
