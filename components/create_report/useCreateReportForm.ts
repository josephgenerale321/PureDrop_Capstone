import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system/legacy";
import { useRef, useState } from "react";
import { Alert, Platform } from "react-native";
import { collection, doc, getDoc, runTransaction, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import { getPublicFileUrl, removeFile, uploadFile } from "../../api/storage";
import { autoCategorizeIssue } from "../../lib/regular_user/assistant_api";
import { getCurrentGpsLocation, getLocationFromCoordinates } from "../../lib/regular_user/creategps";
import { auth, db } from "../../firebaseConfig";
import type { Coordinate, Region } from "./MapPicker";

export type Attachment = {
  uri: string;
  mimeType?: string | null;
  fileName?: string | null;
  base64?: string | null;
};

const TOLEDO_BARANGAYS = [
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
  "Santo Niño",
  "Subayon",
  "Tancor",
  "Tubod",
] as const;

const LOCAL_ATTACHMENT_URI_PATTERN = /^(file|content|ph|assets-library):/i;
const REPORT_ATTACHMENT_CACHE_DIR = "report-attachments";

const normalizeToledoAddress = (value: string): string => {
  const trimmed = value.trim();

  if (!trimmed) {
    return "";
  }

  const lower = trimmed.toLowerCase();
  if (lower.includes("toledo city")) {
    return trimmed;
  }

  const match = TOLEDO_BARANGAYS.find((barangay) =>
    lower.startsWith(barangay.toLowerCase()),
  );

  if (!match) {
    return trimmed;
  }

  const remainder = trimmed.slice(match.length).trim().replace(/^,\s*/, "");
  return remainder ? `${match}, Toledo City ${remainder}` : `${match}, Toledo City`;
};

const reserveNextReportId = async (uid: string) => {
  const userRef = doc(db, "regular_user", uid);

  const nextValue = await runTransaction(db, async (transaction) => {
    const userSnap = await transaction.get(userRef);
    if (!userSnap.exists()) {
      throw new Error("Profile missing");
    }

    const data = userSnap.data() as { reportCounter?: unknown };
    const currentCounter = typeof data.reportCounter === "number" ? data.reportCounter : 0;
    const nextCounter = currentCounter + 1;

    transaction.update(userRef, { reportCounter: nextCounter });
    return nextCounter;
  });

  return String(nextValue);
};

export function useCreateReportForm() {
  const [category, setCategory] = useState("");
  const [address, setAddress] = useState("");
  const [location, setLocation] = useState("");
  const [gpsLocation, setGpsLocation] = useState("");
  const [issue, setIssue] = useState("");
  const [waterMeter, setWaterMeter] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [aiCategorizing, setAiCategorizing] = useState(false);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [mapVisible, setMapVisible] = useState(false);
  const [mapRegion, setMapRegion] = useState<Region>({
    latitude: 10.3775,
    longitude: 123.6388,
    latitudeDelta: 0.02,
    longitudeDelta: 0.02,
  });
const [selectedPin, setSelectedPin] = useState<Coordinate | null>(null);
  const [confirmedPin, setConfirmedPin] = useState<Coordinate | null>(null);
  // Guards against a rapid double-tap on "Submit Report" running two
  // concurrent submit transactions (double report ids, double uploads).
  const submittingRef = useRef(false);

  const getFileExtension = (attachment: Attachment) => {
    const cleanUri = attachment.uri.split("?")[0];
    const parts = cleanUri.split(".");

    if (parts.length > 1) {
      return parts[parts.length - 1].toLowerCase();
    }

    const mime = attachment.mimeType?.toLowerCase() ?? "";
    if (mime.includes("png")) return "png";
    if (mime.includes("webp")) return "webp";
    if (mime.includes("heic")) return "heic";
    return "jpg";
  };

  const getContentType = (extension: string) => {
    switch (extension) {
      case "jpg":
      case "jpeg":
        return "image/jpeg";
      case "png":
        return "image/png";
      case "webp":
        return "image/webp";
      case "heic":
        return "image/heic";
      default:
        return "application/octet-stream";
    }
  };

  const isLocalAttachmentUri = (uri: string) => LOCAL_ATTACHMENT_URI_PATTERN.test(uri);

  const isCachedAttachmentUri = (uri: string) =>
    typeof FileSystem.cacheDirectory === "string" &&
    uri.startsWith(`${FileSystem.cacheDirectory}${REPORT_ATTACHMENT_CACHE_DIR}/`);

  const createStableAttachment = async (picked: ImagePicker.ImagePickerAsset): Promise<Attachment> => {
    let stableUri = picked.uri;
    const extension = getFileExtension({
      uri: picked.uri,
      mimeType: picked.mimeType,
      fileName: picked.fileName,
    });

    if (isLocalAttachmentUri(picked.uri) && FileSystem.cacheDirectory) {
      const cacheDir = `${FileSystem.cacheDirectory}${REPORT_ATTACHMENT_CACHE_DIR}`;
      const cacheUri = `${cacheDir}/attachment-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2)}.${extension}`;

      await FileSystem.makeDirectoryAsync(cacheDir, { intermediates: true });
      await FileSystem.copyAsync({ from: picked.uri, to: cacheUri });
      stableUri = cacheUri;
    }

    return {
      uri: stableUri,
      mimeType: picked.mimeType,
      fileName: picked.fileName,
      base64: picked.base64,
    };
  };

const cleanupCachedAttachments = async (list: Attachment[]) => {
    // Wrap the whole routine so it can NEVER reject — a failure here must not
    // break submit/reset flow on preview/dev builds. Each file is already
    // individually guarded, and we swallow any unexpected error too.
    try {
      await Promise.all(
        list.map(async (attachment) => {
          if (!isCachedAttachmentUri(attachment.uri)) {
            return;
          }

          try {
            await FileSystem.deleteAsync(attachment.uri, { idempotent: true });
          } catch {
            // Cache cleanup failure should not block user flow.
          }
        }),
      );
    } catch {
      // Non-fatal.
    }
  };

  /**
   * Best-effort deletes files that were uploaded to storage as part of a
   * submit that later failed, so we do not leave orphaned objects. Never
   * throws and never blocks the submit flow.
   */
  const cleanupOrphanedUploads = (paths: string[]): void => {
    if (!paths || paths.length === 0) {
      return;
    }

    void Promise.all(
      paths.map((path) => {
        if (!path || typeof path !== "string") {
          return;
        }
        return removeFile(path).catch(() => {
          // Non-fatal: orphan cleanup is best-effort.
        });
      }),
    ).catch(() => {
      // Non-fatal.
    });
  };
  const resolveUploadedFileUrl = (uploadedPath: string, fallbackPath: string) => {
    const resolved = getPublicFileUrl(uploadedPath || fallbackPath);
    if (!resolved || typeof resolved !== "string") {
      throw new Error("Failed to resolve uploaded image URL.");
    }
    return resolved;
  };

  const handleUseGps = async () => {
    if (selectedPin) {
      setMapVisible(true);
      return;
    }

    try {
      setGpsLoading(true);
      const gpsResult = await getCurrentGpsLocation();
      const region: Region = {
        latitude: gpsResult.latitude,
        longitude: gpsResult.longitude,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      };
      setMapRegion(region);
      setSelectedPin({
        latitude: gpsResult.latitude,
        longitude: gpsResult.longitude,
      });
      setMapVisible(true);
    } catch (error) {
      if (error instanceof Error && error.message === "LOCATION_PERMISSION_DENIED") {
        Alert.alert(
          "Permission needed",
          "Please allow location access to center the map on your current position. You can still pin the location manually.",
        );
      } else {
        Alert.alert("GPS error", "Could not fetch current location. You can still pin the location manually.");
      }

      setSelectedPin({
        latitude: mapRegion.latitude,
        longitude: mapRegion.longitude,
      });
      setMapVisible(true);
    } finally {
      setGpsLoading(false);
    }
  };

  const getAttachmentStorageFileName = (
    attachment: Attachment,
    index: number,
    extension: string,
    usedFileNames: Set<string>,
  ) => {
    const rawFileName = attachment.fileName?.split(/[\\/]/).pop()?.split("?")[0]?.trim() ?? "";
    const sanitizedFileName = rawFileName
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "");
    const fallbackFileName = `attachment-${index + 1}.${extension}`;
    const fileNameWithExtension = sanitizedFileName || fallbackFileName;
    const fileName = /\.[a-zA-Z0-9]+$/.test(fileNameWithExtension)
      ? fileNameWithExtension
      : `${fileNameWithExtension}.${extension}`;

    if (!usedFileNames.has(fileName)) {
      usedFileNames.add(fileName);
      return fileName;
    }

    const dotIndex = fileName.lastIndexOf(".");
    const baseName = dotIndex >= 0 ? fileName.slice(0, dotIndex) : fileName;
    const fileExtension = dotIndex >= 0 ? fileName.slice(dotIndex + 1) : extension;
    const uniqueFileName = `${baseName}-${index + 1}.${fileExtension}`;
    usedFileNames.add(uniqueFileName);
    return uniqueFileName;
  };

  const handleRegionChangeComplete = (region: Region) => {
    setMapRegion(region);
    setSelectedPin({
      latitude: region.latitude,
      longitude: region.longitude,
    });
  };

  const handleConfirmMapLocation = async () => {
    if (!selectedPin) {
      Alert.alert("Select location", "Tap on the map to choose your location.");
      return;
    }

    try {
      setGpsLoading(true);
      const pickedLocation = await getLocationFromCoordinates(
        selectedPin.latitude,
        selectedPin.longitude,
      );
      if (pickedLocation.isOutsideToledo) {
        Alert.alert("Outside Toledo", "The selected location does not appear to be in Toledo City.");
        return;
      }

      setGpsLocation(pickedLocation.formattedLocation);
      setConfirmedPin(selectedPin);
      setMapVisible(false);
    } catch {
      Alert.alert("GPS error", "Could not resolve selected map location.");
    } finally {
      setGpsLoading(false);
    }
  };

  const handleCancelMapLocation = () => {
    setMapVisible(false);

    if (confirmedPin) {
      setSelectedPin(confirmedPin);
      setMapRegion((current) => ({
        ...current,
        latitude: confirmedPin.latitude,
        longitude: confirmedPin.longitude,
      }));
      return;
    }

    setSelectedPin(null);
  };

const launchPicker = async (source: "camera" | "gallery") => {
    try {
      let result;
      if (source === "camera") {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (permission.status !== "granted") {
          Alert.alert("Permission needed", "Please allow camera access to take photos.");
          return;
        }
result = await ImagePicker.launchCameraAsync({
          mediaTypes: ["images"],
          quality: 0.8,
          allowsEditing: false,
          base64: true,
        });
      } else {
        if (Platform.OS !== "web") {
          const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
          if (permission.status !== "granted") {
            Alert.alert("Permission needed", "Please allow photo library access.");
            return;
          }
        }
result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ["images"],
          quality: 0.8,
          allowsMultipleSelection: false,
          base64: true,
        });
      }

      if (!result.canceled && result.assets.length > 0) {
        try {
          const picked = result.assets[0];
          const stableAttachment = await createStableAttachment(picked);
          setAttachments((prev) => [...prev, stableAttachment]);
        } catch {
          Alert.alert(
            "Attachment error",
            "Unable to process the selected image. Please pick another image and try again.",
          );
        }
      }
    } catch {
      // A rare native picker/permission failure must never crash the screen
      // on preview/dev builds.
      Alert.alert(
        "Choose photo failed",
        "Unable to open the camera or gallery. Please try again.",
      );
    }
  };

  const handlePickAttachment = () => {
    if (attachments.length >= 2) {
      Alert.alert("Attachment limit", "Only 2 attachments are allowed.");
      return;
    }

    if (Platform.OS === "web") {
      void launchPicker("gallery");
      return;
    }

    Alert.alert("Add Photo", "Choose an option", [
      { text: "Take Photo", onPress: () => void launchPicker("camera") },
      { text: "Choose from Gallery", onPress: () => void launchPicker("gallery") },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  const handleRemoveAttachment = (index: number) => {
    setAttachments((prev) => {
      const removed = prev[index];
      if (removed && isCachedAttachmentUri(removed.uri)) {
        void FileSystem.deleteAsync(removed.uri, { idempotent: true }).catch(() => {
          // Cache cleanup failure should not block user flow.
        });
      }

      return prev.filter((_, i) => i !== index);
    });
  };

  const handleAutoCategorizeIssue = async () => {
    const trimmedIssue = issue.trim();
    if (!trimmedIssue) {
      Alert.alert("Missing issue details", "Please describe the issue first.");
      return;
    }

    try {
      setAiCategorizing(true);
      const result = await autoCategorizeIssue(trimmedIssue);

      if (!result.category) {
        Alert.alert(
          "No suggestion",
          "AI could not determine a category. Please select a category manually.",
        );
        return;
      }

      setCategory(result.category);

      if (result.source === "fallback") {
        Alert.alert("Category set", `Set to "${result.category}" using local fallback rules.`);
      }
    } catch (error) {
      const message =
        error instanceof Error && error.message.trim().length > 0
          ? error.message
          : "Could not auto-categorize issue.";
      Alert.alert("AI categorization error", message);
    } finally {
      setAiCategorizing(false);
    }
  };

  const handleSubmit = async () => {
    const trimmedCategory = category.trim();
    const trimmedAddress = normalizeToledoAddress(address);
    const trimmedLocation = location.trim();
    const trimmedIssue = issue.trim();
    const trimmedGpsLocation = gpsLocation.trim();
    const trimmedWaterMeter = waterMeter.trim();
    const combinedLocation = [trimmedAddress, trimmedLocation].filter(Boolean).join(" ");

    if (trimmedWaterMeter.length > 0) {
      const waterMeterNumber = Number(trimmedWaterMeter);
      if (Number.isNaN(waterMeterNumber) || waterMeterNumber < 0) {
        Alert.alert("Invalid water meter", "Water meter must be a valid non-negative number.");
        return false;
      }
    }

    if (!trimmedCategory || !trimmedIssue || (!combinedLocation && !trimmedGpsLocation)) {
      Alert.alert(
        "Missing fields",
        "Please fill category, issue details, and either address/location or GPS.",
      );
      return false;
    }

const currentUser = auth.currentUser;
    if (!currentUser) {
      Alert.alert("Not signed in", "Please log in again before submitting a report.");
      return false;
    }

    // Guard against a rapid double-tap on "Submit Report". Without this, two
    // concurrent transactions could reserve two report ids and upload twice.
    if (submittingRef.current) {
      return false;
    }

    try {
      submittingRef.current = true;
      setSubmitLoading(true);
      const reportId = await reserveNextReportId(currentUser.uid);
      const uploadedUrls: string[] = [];
      const uploadedPaths: string[] = [];
      const usedStorageFileNames = new Set<string>();

      try {
        for (let i = 0; i < attachments.length; i += 1) {
          const attachment = attachments[i];
          const extension = getFileExtension(attachment);
          const storageFileName = getAttachmentStorageFileName(
            attachment,
            i,
            extension,
            usedStorageFileNames,
          );
          const destinationPath = `${reportId}/${storageFileName}`;

          const uploaded = await uploadFile(attachment.uri, destinationPath, {
            contentType: attachment.mimeType || getContentType(extension),
            base64Data: attachment.base64 ?? undefined,
          });

          const uploadedPath =
            typeof uploaded?.path === "string" && uploaded.path.length > 0
              ? uploaded.path
              : destinationPath;

          uploadedPaths.push(uploadedPath);

          const publicUrl = resolveUploadedFileUrl(uploadedPath, destinationPath);
          uploadedUrls.push(publicUrl);
        }

        if (uploadedUrls.some((url) => !url || typeof url !== "string")) {
          throw new Error("One or more attachment URLs are invalid.");
        }

        const userDocRef = doc(db, "regular_user", currentUser.uid);
        const userDocSnap = await getDoc(userDocRef);

        if (!userDocSnap.exists()) {
          Alert.alert("Profile missing", "Your user profile was not found. Please contact support.");
          return false;
        }

        const reportDocRef = doc(collection(db, "regular_user", currentUser.uid, "reports"), reportId);
        const userData = userDocSnap.data() as {
          fullName?: unknown;
          profileImageUrl?: unknown;
        };

        await setDoc(reportDocRef, {
          reportId,
          userId: currentUser.uid,
          reporterName: typeof userData.fullName === "string" ? userData.fullName : null,
          reporterAvatarUrl:
            typeof userData.profileImageUrl === "string" ? userData.profileImageUrl : null,
          category: trimmedCategory,
          issue: trimmedIssue,
          address: trimmedAddress || null,
          locationDetails: trimmedLocation || null,
          location: combinedLocation || null,
          gpsLocation: trimmedGpsLocation || null,
          waterMeter: trimmedWaterMeter || null,
          attachments: uploadedUrls,
          submittedAt: new Date().toISOString(),
          createdAt: serverTimestamp(),
          status: "Pending",
        });

        await updateDoc(userDocRef, {
          lastReportAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } catch (error) {
        // Best-effort: delete any files that were uploaded before the failure so
        // we do not leave orphaned objects in storage. Non-blocking and never
        // crashes the submit flow.
        void cleanupOrphanedUploads(uploadedPaths);
        throw error;
      }

      await cleanupCachedAttachments(attachments);

      setCategory("");
      setAddress("");
      setLocation("");
      setGpsLocation("");
      setIssue("");
      setWaterMeter("");
      setAttachments([]);
      setSelectedPin(null);
      setConfirmedPin(null);

      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to submit report.";
      Alert.alert("Submit error", message);
      return false;
    } finally {
      submittingRef.current = false;
      setSubmitLoading(false);
    }
  };

  const resetForm = () => {
    void cleanupCachedAttachments(attachments);

    setCategory("");
    setAddress("");
    setLocation("");
    setGpsLocation("");
    setIssue("");
    setWaterMeter("");
    setAttachments([]);
    setMapVisible(false);
    setMapRegion({
      latitude: 10.3775,
      longitude: 123.6388,
      latitudeDelta: 0.02,
      longitudeDelta: 0.02,
    });
    setSelectedPin(null);
    setConfirmedPin(null);
  };

  return {
    aiCategorizing,
    address,
    attachments,
    category,
    gpsLoading,
    gpsLocation,
    handleConfirmMapLocation,
    handleCancelMapLocation,
    handleRegionChangeComplete,
    handlePickAttachment,
    handleRemoveAttachment,
    handleAutoCategorizeIssue,
    handleSubmit,
    handleUseGps,
    issue,
    location,
    mapRegion,
    mapVisible,
    resetForm,
    selectedPin,
    setAddress,
    setCategory,
    setIssue,
    setLocation,
    setMapVisible,
    setWaterMeter,
    submitLoading,
    waterMeter,
  };
}
