import { Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import useNavigateOnce from "../backend/useNavigateOnce";
import useVerificationDecisionWatcher from "../backend/useVerificationDecisionWatcher";
import useVerificationMainProgress from "./backend/useVerificationMainProgress";
import useVerificationMainBack from "./backend/useVerificationMainBack";
import {
  FACE_SELFIE_ROUTE,
  FACE_SELFIE_SUBMITTED_ROUTE,
  REVIEW_SUBMISSION_ROUTE,
  VALID_ID_ROUTE,
  VALID_ID_SUBMITTED_ROUTE,
} from "./verificationmainroutes";
import VerificationPendingBanner from "./components/VerificationPendingBanner";
import VerificationIdentityBanner from "./components/VerificationIdentityBanner";
import VerificationOptionCard, {
  IdCardIcon,
} from "./components/VerificationOptionCard";
import VerificationBackConfirmLightbox from "./components/VerificationBackConfirmLightbox";
import { styles } from "./verificationmainstyles";

export default function VerificationMainScreen() {
  const navigateOnce = useNavigateOnce();
  useVerificationDecisionWatcher();

  const {
    userEmail,
    hasFaceScan,
    hasValidId,
    verificationStatus,
    rejectionTarget,
    validIdType,
  } = useVerificationMainProgress();
  const { isBackConfirmOpen, handleBack, handleStayBack, handleConfirmBack } =
    useVerificationMainBack();

  const handleFaceRecognition = () => {
    if (hasFaceScan) {
      navigateOnce(FACE_SELFIE_SUBMITTED_ROUTE);
      return;
    }
    navigateOnce(FACE_SELFIE_ROUTE);
  };

  const handleValidId = () => {
    if (hasValidId) {
      navigateOnce(VALID_ID_SUBMITTED_ROUTE);
      return;
    }
    navigateOnce(VALID_ID_ROUTE);
  };

  const handleReviewSubmission = () => {
    navigateOnce(REVIEW_SUBMISSION_ROUTE);
  };

  const faceRejected =
    hasFaceScan &&
    verificationStatus === "rejected" &&
    (rejectionTarget === "face_scan" || rejectionTarget === "both");
  const faceChecked = hasFaceScan && verificationStatus !== "rejected";
  const validIdRejected =
    hasValidId &&
    verificationStatus === "rejected" &&
    (rejectionTarget === "valid_id" || rejectionTarget === "both");
  const validIdChecked = hasValidId && verificationStatus !== "rejected";

  return (
    <>
      <SafeAreaView style={styles.container}>
        <TouchableOpacity style={styles.backButton} onPress={handleBack} activeOpacity={0.8}>
          <Ionicons name="arrow-back" size={22} color="#FFFFFF" />
        </TouchableOpacity>

        <View style={styles.content}>
          <Text style={styles.title}>Identify Yourself</Text>

          <VerificationPendingBanner visible={verificationStatus === "pending"} />

          <VerificationIdentityBanner userEmail={userEmail} />

          <VerificationOptionCard
            icon={<Ionicons name="camera-outline" size={30} color="#0F172A" />}
            title="Face Recognition"
            trailing={faceRejected ? "cross" : faceChecked ? "check" : null}
            onPress={handleFaceRecognition}
          />

          <VerificationOptionCard
            icon={<IdCardIcon />}
            title="Verify your id"
            subtitle={validIdType}
            trailing={validIdRejected ? "cross" : validIdChecked ? "check" : null}
            onPress={handleValidId}
          />

          {/* Review Submission — one read-only overview of everything the
              user has submitted (face scan + Valid ID photos). Only shown
              once at least one step has been submitted. */}
          {(hasFaceScan || hasValidId) && (
            <VerificationOptionCard
              icon={<Ionicons name="document-text-outline" size={30} color="#0F172A" />}
              title="Review Submission"
              trailing="chevron"
              onPress={handleReviewSubmission}
              accessibilityLabel="Review everything you have submitted for verification"
            />
          )}
        </View>
      </SafeAreaView>

      <VerificationBackConfirmLightbox
        visible={isBackConfirmOpen}
        isRejected={verificationStatus === "rejected"}
        onStay={handleStayBack}
        onConfirm={handleConfirmBack}
      />
    </>
  );
}
