import { type Href } from "expo-router";

export const FACE_SELFIE_ROUTE =
  "/verification/face_selfie/faceselfiemain" as Href;
// Read-only review of the already-submitted face scan — the "Face Recognition"
// card lands here once an enrollment exists (the check mark is showing),
// mirroring how the Valid ID card opens the submitted-ID review.
export const FACE_SELFIE_SUBMITTED_ROUTE =
  "/verification/face_selfie/facescan_submittedview" as Href;
export const VALID_ID_ROUTE = "/verification/valid_id/valid_id_main" as Href;
// Read-only review of the already-submitted Valid ID — the "Verify your id"
// card lands here once a submission exists (the check mark is showing).
export const VALID_ID_SUBMITTED_ROUTE =
  "/verification/valid_id/valid_id_submittedview" as Href;
export const START_ROUTE = "/start" as Href;
// Read-only overview of EVERYTHING the user has submitted for verification
// (face scan + Valid ID photos) — opened by the "Review Submission" button.
export const REVIEW_SUBMISSION_ROUTE =
  "/verification/reviewsubmission" as Href;
