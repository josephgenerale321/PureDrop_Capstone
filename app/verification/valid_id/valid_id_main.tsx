import { useState } from "react";
import {
  Alert,
  Platform,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { styles } from "../../../components/verification/validid/valididstyles";
import IdPhotoBox from "../../../components/verification/validid/idphotobox";

// Mockup ID types — the real list will come from the backend later.
const VALID_ID_TYPES: string[] = [
  "Philippine National ID (PhilID)",
  "Driver's License",
  "Passport",
  "SSS ID",
  "GSIS UMID",
  "PhilHealth ID",
  "Postal ID",
  "Voter's ID",
  "PRC ID",
  "TIN ID",
];

// Passport is a booklet — a single photo of the data page is enough,
// so it uses one attachment instead of the front/back pair.
const PASSPORT_ID_TYPE = "Passport";

export default function ValidIdMainScreen() {
  const router = useRouter();
  const [selectedIdType, setSelectedIdType] = useState<string | null>(null);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [frontAttached, setFrontAttached] = useState(false);
  const [backAttached, setBackAttached] = useState(false);
  const [passportAttached, setPassportAttached] = useState(false);
  const [isSubmitConfirmOpen, setIsSubmitConfirmOpen] = useState(false);

  const isPassport = selectedIdType === PASSPORT_ID_TYPE;

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    }
  };

  // Mockup attach — toggles the photo state so the flow can be demoed.
  // Real ID photo capture/upload logic will be wired up later.
  const handleAttachPhoto = (side: "front" | "back" | "passport") => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }

    if (side === "front") {
      setFrontAttached((attached) => !attached);
    } else if (side === "back") {
      setBackAttached((attached) => !attached);
    } else {
      setPassportAttached((attached) => !attached);
    }
  };

  // Switching ID types resets attachments so stale photos never carry over
  // between the single-passport flow and the front/back flow.
  const handleSelectIdType = (idType: string) => {
    setSelectedIdType(idType);
    setIsDropdownOpen(false);
    setFrontAttached(false);
    setBackAttached(false);
    setPassportAttached(false);
  };

  const handleSubmit = () => {
    // Guided mockup validation — tells the user exactly what is still missing.
    if (!selectedIdType) {
      Alert.alert("Select your Valid ID", "Please choose your Valid ID type first.");
      return;
    }

    if (isPassport) {
      if (!passportAttached) {
        Alert.alert("Photo missing", "Please attach a photo of your Passport.");
        return;
      }
    } else {
      if (!frontAttached && !backAttached) {
        Alert.alert("Photos missing", "Please attach the front and back photos of your ID.");
        return;
      }

      if (!frontAttached) {
        Alert.alert("Photo missing", "Please attach the front photo of your ID.");
        return;
      }

      if (!backAttached) {
        Alert.alert("Photo missing", "Please attach the back photo of your ID.");
        return;
      }
    }

    // Confirmation modal — same visual pattern as the signout modal.
    setIsSubmitConfirmOpen(true);
  };

  const handleConfirmSubmit = () => {
    setIsSubmitConfirmOpen(false);

    // Mockup — the real backend submission will be wired up later.
    Alert.alert(
      "Mockup",
      `Valid ID submission is not implemented yet. (Selected: ${selectedIdType})`,
    );
  };

  return (
    <>
      <SafeAreaView style={styles.container}>
      <TouchableOpacity style={styles.backButton} onPress={handleBack} activeOpacity={0.8}>
        <Ionicons name="arrow-back" size={22} color="#FFFFFF" />
      </TouchableOpacity>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Choose your Valid ID</Text>

        {/* ID type dropdown (mockup) */}
        <TouchableOpacity
          style={styles.dropdownSelector}
          onPress={() => setIsDropdownOpen((open) => !open)}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Select your Valid ID type"
          accessibilityState={{ expanded: isDropdownOpen }}
        >
          <Text
            style={[
              styles.dropdownSelectorText,
              !selectedIdType && styles.dropdownSelectorPlaceholder,
            ]}
          >
            {selectedIdType ?? "Select"}
          </Text>
          <Ionicons
            name={isDropdownOpen ? "chevron-up" : "chevron-down"}
            size={20}
            color="#0F172A"
          />
        </TouchableOpacity>

        {isDropdownOpen && (
          <View style={styles.dropdownList}>
            {VALID_ID_TYPES.map((idType) => (
              <TouchableOpacity
                key={idType}
                style={[
                  styles.dropdownItem,
                  selectedIdType === idType && styles.dropdownItemSelected,
                ]}
                onPress={() => {
                  handleSelectIdType(idType);
                }}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel={`Choose ${idType}`}
                accessibilityState={{ selected: selectedIdType === idType }}
              >
                <Text style={styles.dropdownItemText}>{idType}</Text>
                {selectedIdType === idType && (
                  <Ionicons name="checkmark" size={18} color="#0EA5E9" />
                )}
              </TouchableOpacity>
            ))}
          </View>
        )}

        {isPassport ? (
          // Passport: a single photo of the data page is enough
          <IdPhotoBox
            label="Passport"
            attached={passportAttached}
            onToggle={() => handleAttachPhoto("passport")}
          />
        ) : (
          <>
            {/* Front ID photo (mockup) */}
            <IdPhotoBox
              label="Front"
              attached={frontAttached}
              onToggle={() => handleAttachPhoto("front")}
            />

            {/* Back ID photo (mockup) */}
            <IdPhotoBox
              label="Back"
              attached={backAttached}
              onToggle={() => handleAttachPhoto("back")}
            />
          </>
        )}

        <TouchableOpacity
          style={styles.submitButton}
          onPress={handleSubmit}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Submit your Valid ID"
        >
          <Text style={styles.submitButtonText}>Submit Valid ID</Text>
        </TouchableOpacity>
      </ScrollView>
      </SafeAreaView>

      {isSubmitConfirmOpen && (
        <View style={styles.confirmOverlay}>
          <View style={styles.confirmCard}>
            <Text style={styles.confirmTitle}>Submit this Valid ID?</Text>
            <Text style={styles.confirmMessage}>
              Please double check your Valid ID before you submit. You won&apos;t be able to edit
              it after submission.
            </Text>

            <View style={styles.confirmActions}>
              <TouchableOpacity
                style={[styles.confirmButton, styles.confirmCancelButton]}
                onPress={() => setIsSubmitConfirmOpen(false)}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel="Go back without submitting"
              >
                <Text style={[styles.confirmButtonText, styles.confirmCancelButtonText]}>
                  GO BACK
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.confirmButton, styles.confirmSubmitButton]}
                onPress={handleConfirmSubmit}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel="Confirm and submit your Valid ID"
              >
                <Text style={styles.confirmButtonText}>SUBMIT</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}
    </>
  );
}

