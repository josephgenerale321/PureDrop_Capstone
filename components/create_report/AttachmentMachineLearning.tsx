import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { reviewAttachmentAuthenticity } from "../../api/attachmentAuthenticity";
import { styles } from "./createReportStyles";
import type { Attachment } from "./useCreateReportForm";

type ReviewState = "idle" | "analyzing" | "passed" | "warning" | "blocked" | "unavailable";

export type AttachmentMachineLearningItem = {
  attachmentUri: string;
  state: Exclude<ReviewState, "idle" | "analyzing" | "unavailable">;
  message: string;
};

export type AttachmentMachineLearningStatus = {
  attachmentUris: string[];
  canSubmit: boolean;
  items: AttachmentMachineLearningItem[];
  state: ReviewState;
  summary: string;
};

type AttachmentMachineLearningProps = {
  attachments: Attachment[];
  category: string;
  onStatusChange?: (status: AttachmentMachineLearningStatus) => void;
};

type AttachmentAuthenticityResponse = {
  text: {
    has_artificial?: number;
    has_natural?: number;
  } | null;
  type: {
    ai_generated?: number;
    deepfake?: number;
    illustration?: number;
    photo?: number;
  } | null;
};

const initialStatus: AttachmentMachineLearningStatus = {
  attachmentUris: [],
  canSubmit: true,
  items: [],
  state: "idle",
  summary: "Add an attachment to start the authenticity review.",
};

// Remote URLs (https/http) point to already-submitted attachments in Supabase
// storage. They were reviewed for authenticity when the report was first
// created, so they must NOT be re-read with FileSystem (which only supports
// local file URIs) and must not be re-sent to the review edge function.
const isRemoteAttachmentUri = (uri: string) => {
  const trimmed = (uri || "").trim().toLowerCase();
  return trimmed.startsWith("http://") || trimmed.startsWith("https://");
};

const formatScore = (value?: number) => `${Math.round((value ?? 0) * 100)}%`;
const SCREENSHOT_NAME_PATTERN = /(screen\s*shot|screenshot|screen[_-]?capture)/i;

const hasScreenshotFileName = (attachment: Attachment) => {
  const source = `${attachment.fileName ?? ""} ${attachment.uri}`;
  return SCREENSHOT_NAME_PATTERN.test(source);
};

const buildCategoryNote = (category: string) => {
  if (!category.trim()) {
    return "This check focuses on fake or non-photo attachments only.";
  }

  return `This check helps spot fake or non-photo attachments, but it does not confirm the "${category}" category itself.`;
};

const buildAuthenticityReview = (
  attachment: Attachment,
  category: string,
  response: AttachmentAuthenticityResponse,
): AttachmentMachineLearningItem => {
  const aiGeneratedScore = response.type?.ai_generated ?? 0;
  const deepfakeScore = response.type?.deepfake ?? 0;
  const illustrationScore = response.type?.illustration ?? 0;
  const photoScore = response.type?.photo ?? 0;
  const artificialTextScore = response.text?.has_artificial ?? 0;

  if (hasScreenshotFileName(attachment)) {
    return {
      attachmentUri: attachment.uri,
      message: "This attachment looks like a screenshot based on its file name. Please upload a real camera photo of the issue.",
      state: "blocked",
    };
  }

  if (aiGeneratedScore >= 0.7) {
    return {
      attachmentUri: attachment.uri,
      message: `Sightengine marked this attachment as likely AI-generated (${formatScore(aiGeneratedScore)}).`,
      state: "blocked",
    };
  }

  if (deepfakeScore >= 0.6) {
    return {
      attachmentUri: attachment.uri,
      message: `Sightengine marked this attachment as likely deepfake or face-manipulated (${formatScore(deepfakeScore)}).`,
      state: "blocked",
    };
  }

  if (artificialTextScore >= 0.8) {
    return {
      attachmentUri: attachment.uri,
      message: `Sightengine found heavy artificial text or UI elements (${formatScore(artificialTextScore)}), so this may be a screenshot. Please upload a real camera photo.`,
      state: "blocked",
    };
  }

  if (illustrationScore >= 0.85 && photoScore <= 0.2) {
    return {
      attachmentUri: attachment.uri,
      message: `Sightengine thinks this looks like an illustration instead of a real photo (${formatScore(illustrationScore)} illustration).`,
      state: "blocked",
    };
  }

  if (aiGeneratedScore >= 0.35) {
    return {
      attachmentUri: attachment.uri,
      message: `Sightengine sees some AI-generation risk (${formatScore(aiGeneratedScore)}). ${buildCategoryNote(category)}`,
      state: "warning",
    };
  }

  if (illustrationScore >= 0.55 && photoScore < 0.45) {
    return {
      attachmentUri: attachment.uri,
      message: `This attachment may be artwork, a screenshot, or a designed image rather than a camera photo. ${buildCategoryNote(category)}`,
      state: "warning",
    };
  }

  if (deepfakeScore >= 0.25) {
    return {
      attachmentUri: attachment.uri,
      message: `Sightengine sees some deepfake/manipulation risk (${formatScore(deepfakeScore)}). ${buildCategoryNote(category)}`,
      state: "warning",
    };
  }

  return {
    attachmentUri: attachment.uri,
    message: `Sightengine says this looks like a real photo (${formatScore(photoScore)} photo). ${buildCategoryNote(category)}`,
    state: "passed",
  };
};

const buildItemReview = async (
  attachment: Attachment,
  category: string,
): Promise<AttachmentMachineLearningItem> => {
  const response = await reviewAttachmentAuthenticity(attachment);
  return buildAuthenticityReview(attachment, category, response);
};

const buildSummary = (items: AttachmentMachineLearningItem[], category: string) => {
  if (items.some((item) => item.state === "blocked")) {
    return "One or more attachments were blocked because they look like screenshots, AI-generated images, face-manipulated images, or non-photographic uploads.";
  }

  if (items.some((item) => item.state === "warning")) {
    return `${buildCategoryNote(category)} Review the warning before submitting.`;
  }

  if (!category.trim()) {
    return "The attachments look like real photos. This review does not check category relevance.";
  }

  return `The attachments look like real photos. Sightengine still does not verify whether they truly match "${category}".`;
};

const getStatusIcon = (state: AttachmentMachineLearningItem["state"]) => {
  switch (state) {
    case "blocked":
      return "close-circle";
    case "warning":
      return "alert-circle";
    default:
      return "checkmark-circle";
  }
};

const getStatusIconColor = (state: AttachmentMachineLearningItem["state"]) => {
  switch (state) {
    case "blocked":
      return "#b91c1c";
    case "warning":
      return "#9a6700";
    default:
      return "#166534";
  }
};

export function AttachmentMachineLearning({
  attachments,
  category,
  onStatusChange,
}: AttachmentMachineLearningProps) {
  const [status, setStatus] = useState<AttachmentMachineLearningStatus>(initialStatus);

  useEffect(() => {
    let cancelled = false;

    const updateStatus = (nextStatus: AttachmentMachineLearningStatus) => {
      if (!cancelled) {
        setStatus(nextStatus);
      }
    };

    if (attachments.length === 0) {
      updateStatus(initialStatus);
      return () => {
        cancelled = true;
      };
    }

    // Only newly-added LOCAL attachments need authenticity review. Remote
    // attachments (already-uploaded Supabase URLs) were reviewed at original
    // submission time and cannot be read with FileSystem.readAsStringAsync.
    const localAttachments = attachments.filter(
      (attachment) => !isRemoteAttachmentUri(attachment.uri),
    );

    // If every attachment is remote (e.g. editing an existing report without
    // adding new photos), skip the review entirely — they already passed.
    if (localAttachments.length === 0) {
      updateStatus({
        attachmentUris: attachments.map((attachment) => attachment.uri),
        canSubmit: true,
        items: [],
        state: "passed",
        summary: "Existing attachments were already reviewed when this report was submitted.",
      });
      return () => {
        cancelled = true;
      };
    }

    updateStatus({
      attachmentUris: attachments.map((attachment) => attachment.uri),
      canSubmit: false,
      items: [],
      state: "analyzing",
      summary: "Checking the new attachments with secure server review...",
    });

    void (async () => {
      const items = await Promise.all(
        localAttachments.map((attachment) => buildItemReview(attachment, category))
      );

      if (cancelled) {
        return;
      }

      const nextStatus: AttachmentMachineLearningStatus = {
        attachmentUris: attachments.map((attachment) => attachment.uri),
        canSubmit: !items.some((item) => item.state === "blocked"),
        items,
        state: items.some((item) => item.state === "blocked")
          ? "blocked"
          : items.some((item) => item.state === "warning")
            ? "warning"
            : "passed",
        summary: buildSummary(items, category),
      };

      updateStatus(nextStatus);
    })()
      .catch((error) => {
        const message =
          error instanceof Error && error.message.trim().length > 0
            ? error.message
            : "Authenticity review failed.";

        updateStatus({
          attachmentUris: attachments.map((attachment) => attachment.uri),
          canSubmit: false,
          items: [],
          state: "unavailable",
          summary: `Attachment review could not finish: ${message}. Please try again before submitting.`,
        });
      });

    return () => {
      cancelled = true;
    };
  }, [attachments, category]);

  useEffect(() => {
    onStatusChange?.(status);
  }, [onStatusChange, status]);

  return (
    <View style={styles.attachmentMlCard}>
      <View style={styles.attachmentMlHeader}>
        <Ionicons
          color={
            status.state === "blocked"
              ? "#b91c1c"
              : status.state === "warning"
                ? "#9a6700"
                : status.state === "passed"
                  ? "#166534"
                  : "#1d4ed8"
          }
          name="sparkles"
          size={16}
        />
        <Text style={styles.attachmentMlTitle}>Attachment Authenticity Review</Text>
      </View>

      {status.state === "analyzing" ? (
        <View style={styles.attachmentMlLoadingRow}>
          <ActivityIndicator color="#1d4ed8" size="small" />
          <Text style={styles.attachmentMlSummary}>{status.summary}</Text>
        </View>
      ) : (
        <Text style={styles.attachmentMlSummary}>{status.summary}</Text>
      )}

      {status.items.map((item, index) => (
        <View
          key={`${item.attachmentUri}-${index}`}
          style={[
            styles.attachmentMlItem,
            item.state === "blocked"
              ? styles.attachmentMlItemBlocked
              : item.state === "warning"
                ? styles.attachmentMlItemWarning
                : styles.attachmentMlItemPassed,
          ]}
        >
          <Ionicons
            color={getStatusIconColor(item.state)}
            name={getStatusIcon(item.state)}
            size={15}
          />
          <Text style={styles.attachmentMlItemText}>{item.message}</Text>
        </View>
      ))}
    </View>
  );
}
