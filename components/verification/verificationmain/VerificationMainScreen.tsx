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
    wasPreviouslyVerified,
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

  // Targeted-rejection visibility — only the rejected part stays actionable:
  // rejected + valid_id → Valid ID card only (Face hidden), rejected +
  // face_scan → Face card only (Valid ID hidden), rejected + both/legacy →
  // both. Non-rejected states (pending / awaiting_id / verified / new user)
  // always show both — hiding the still-good part also prevents needlessly
  // resubmitting it (which would re-pend the account).
  const isRejected = verificationStatus === "rejected";
  const showFaceCard = !isRejected || rejectionTarget !== "valid_id";
  const showValidIdCard = !isRejected || rejectionTarget !== "face_scan";

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

          {/* Only the admin-rejected part stays actionable: the still-good
              card is hidden so it can't be needlessly resubmitted. */}
          {showFaceCard && (
            <VerificationOptionCard
              icon={<Ionicons name="camera-outline" size={30} color="#0F172A" />}
              title="Face Recognition"
              trailing={faceRejected ? "cross" : faceChecked ? "check" : null}
              onPress={handleFaceRecognition}
            />
          )}

          {showValidIdCard && (
            <VerificationOptionCard
              icon={<IdCardIcon />}
              title="Verify your id"
              subtitle={validIdType}
              trailing={validIdRejected ? "cross" : validIdChecked ? "check" : null}
              onPress={handleValidId}
            />
          )}

          {/* Review Submission — new never-verified users only. Existing
              fully-verified users re-rejected later never see it: they
              resubmit just the rejected part via its own card. Still gated
              on a VISIBLE submitted step so it never links to a hidden part. */}
          {!wasPreviouslyVerified &&
            ((showFaceCard && hasFaceScan) ||
              (showValidIdCard && hasValidId)) && (
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
