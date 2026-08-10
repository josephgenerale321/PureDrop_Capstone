import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Location from "expo-location";
import { useEffect, useRef, useState } from "react";
import { Alert, Platform } from "react-native";
import {
  collection,
  doc,
  getDoc,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { getPublicFileUrl, uploadFile } from "../../../api/storage";
import {
  getCurrentGpsLocation,
  getLocationFromCoordinates,
  loadLastGpsFix,
  saveLastGpsFix,
} from "../../../lib/regular_user/creategps";
import { auth, db } from "../../../firebaseConfig";
import type { Coordinate, Region } from "../../create_report/MapPicker";

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

// Checks foreground location permission, requesting it if not yet granted.
// Fully guarded so a permission/platform failure can never reject/rethrow.
const isPermissionGrantedForFollow = async (): Promise<boolean> => {
  try {
    const { status } = await Location.getForegroundPermissionsAsync();
    if (status === "granted") {
      return true;
    }
    const { status: requested } = await Location.requestForegroundPermissionsAsync();
    return requested === "granted";
  } catch {
    return false;
  }
};

/**
 * Form state for editing an existing report. Loads the existing report from
 * Firestore on mount, populates the form fields, and saves changes back with
 * `updateDoc` (never replaces the document).
 *
 * SAFETY: All async work is wrapped so it can never throw and crash the app,
 * including on preview and development builds.
 */
export function useEditReportForm(reportId: string) {
  const [category, setCategory] = useState("");
  const [address, setAddress] = useState("");
  const [location, setLocation] = useState("");
  const [gpsLocation, setGpsLocation] = useState("");
  const [gpsAccuracy, setGpsAccuracy] = useState<number | null>(null);
  const [issue, setIssue] = useState("");
  const [waterMeter, setWaterMeter] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [mapVisible, setMapVisible] = useState(false);
  const [mapRegion, setMapRegion] = useState<Region>({
    latitude: 10.3775,
    longitude: 123.6388,
    latitudeDelta: 0.02,
    longitudeDelta: 0.02,
  });
  const [selectedPin, setSelectedPin] = useState<Coordinate | null>(null);
  const [confirmedPin, setConfirmedPin] = useState<Coordinate | null>(null);
  const [followEnabled, setFollowEnabled] = useState(false);
  const [mapCenter, setMapCenter] = useState<Coordinate | null>(null);
  const [recenterKey, setRecenterKey] = useState(0);
  const watchSubscriptionRef = useRef<{ remove: () => void } | null>(null);
  const submittingRef = useRef(false);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Load the existing report data when the screen mounts. Uses
  // onAuthStateChanged so we wait for auth to restore before fetching.
  useEffect(() => {
    let cancelled = false;

    const loadReport = async (uid: string) => {
      try {
        const reportRef = doc(
          collection(db, "regular_user", uid, "reports"),
          reportId,
        );
        const reportSnap = await getDoc(reportRef);

        if (!reportSnap.exists()) {
          if (!cancelled) {
            setLoadError(true);
            setLoading(false);
          }
          return;
        }

        const data = reportSnap.data() as {
          category?: unknown;
          issue?: unknown;
          address?: unknown;
          location?: unknown;
          locationDetails?: unknown;
          gpsLocation?: unknown;
          waterMeter?: unknown;
          attachments?: unknown;
        };

        const rawAttachments = Array.isArray(data.attachments)
          ? data.attachments.filter(
              (item): item is string =>
                typeof item === "string" && item.trim().length > 0,
            )
          : [];

        if (!cancelled) {
          setCategory(typeof data.category === "string" ? data.category : "");
          setIssue(typeof data.issue === "string" ? data.issue : "");
          setAddress(typeof data.address === "string" ? data.address : "");
          setLocation(
            typeof data.locationDetails === "string"
              ? data.locationDetails
              : typeof data.location === "string"
                ? data.location
                : "",
          );
          setGpsLocation(
            typeof data.gpsLocation === "string" ? data.gpsLocation : "",
          );
          setWaterMeter(
            typeof data.waterMeter === "string" ? data.waterMeter : "",
          );
          // Existing remote attachments (Supabase URLs) are displayed as-is.
          // New local attachments are uploaded on save.
          setAttachments(
            rawAttachments.map((url) => ({ uri: url })),
          );
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setLoadError(true);
          setLoading(false);
        }
      }
    };

    // Wait for auth to restore before attempting to fetch the report.
    const unsubscribeAuth = auth.onAuthStateChanged((currentUser) => {
      if (cancelled) {
        return;
      }
      if (!currentUser) {
        setLoadError(true);
        setLoading(false);
        return;
      }
      void loadReport(currentUser.uid);
    });

    return () => {
      cancelled = true;
      unsubscribeAuth();
    };
  }, [reportId]);

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

  const isLocalAttachmentUri = (uri: string) =>
    LOCAL_ATTACHMENT_URI_PATTERN.test(uri);

  const isCachedAttachmentUri = (uri: string) =>
    typeof FileSystem.cacheDirectory === "string" &&
    uri.startsWith(`${FileSystem.cacheDirectory}${REPORT_ATTACHMENT_CACHE_DIR}/`);

  const createStableAttachment = async (
    picked: ImagePicker.ImagePickerAsset,
  ): Promise<Attachment> => {
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
    try {
      await Promise.all(
        list.map(async (attachment) => {
          if (!isCachedAttachmentUri(attachment.uri)) {
            return;
          }
          try {
            await FileSystem.deleteAsync(attachment.uri, { idempotent: true });
          } catch {
            // Non-fatal.
          }
        }),
      );
    } catch {
      // Non-fatal.
    }
  };

  const handleUseGps = async () => {
    try {
      setGpsLoading(true);

      let lastFix = null;
      try {
        lastFix = await loadLastGpsFix();
      } catch {
        lastFix = null;
      }
      if (lastFix && Number.isFinite(lastFix.latitude) && Number.isFinite(lastFix.longitude)) {
        setMapRegion({
          latitude: lastFix.latitude,
          longitude: lastFix.longitude,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        });
        setSelectedPin({ latitude: lastFix.latitude, longitude: lastFix.longitude });
        setGpsAccuracy(lastFix.accuracyMeters ?? null);
        setMapVisible(true);
      }

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
      setGpsAccuracy(gpsResult.accuracyMeters ?? null);
      // Force the map to visually recenter to the fresh GPS fix.
      setMapCenter({ latitude: gpsResult.latitude, longitude: gpsResult.longitude });
      setRecenterKey((key) => key + 1);
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

  const handleRecenterMap = async () => {
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
      setGpsAccuracy(gpsResult.accuracyMeters ?? null);
      setMapCenter({ latitude: gpsResult.latitude, longitude: gpsResult.longitude });
      setRecenterKey((key) => key + 1);
    } catch (error) {
      if (error instanceof Error && error.message === "LOCATION_PERMISSION_DENIED") {
        Alert.alert(
          "Permission needed",
          "Please allow location access to center the map on your current position.",
        );
      } else {
        Alert.alert("GPS error", "Could not fetch current location.");
      }
    } finally {
      setGpsLoading(false);
    }
  };

  const stopFollowing = () => {
    const sub = watchSubscriptionRef.current;
    watchSubscriptionRef.current = null;
    if (sub && typeof sub.remove === "function") {
      try {
        sub.remove();
      } catch {
        // Non-fatal.
      }
    }
    setFollowEnabled(false);
  };

  const startFollowing = async () => {
    try {
      if (watchSubscriptionRef.current) {
        return;
      }
      const granted = await isPermissionGrantedForFollow();
      if (!granted) {
        Alert.alert(
          "Permission needed",
          "Please allow location access to follow your current position.",
        );
        return;
      }
      const subscription = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, distanceInterval: 5, timeInterval: 2000 },
        (reading) => {
          const latitude = reading?.coords?.latitude;
          const longitude = reading?.coords?.longitude;
          if (
            typeof latitude !== "number" ||
            typeof longitude !== "number" ||
            !Number.isFinite(latitude) ||
            !Number.isFinite(longitude)
          ) {
            return;
          }
          setSelectedPin({ latitude, longitude });
          setMapRegion((current) => ({
            ...current,
            latitude,
            longitude,
          }));
          const accuracy = reading.coords.accuracy;
          if (typeof accuracy === "number" && Number.isFinite(accuracy)) {
            setGpsAccuracy(accuracy);
          }
          setMapCenter({ latitude, longitude });
          setRecenterKey((key) => key + 1);
          void saveLastGpsFix({
            latitude,
            longitude,
            accuracyMeters:
              typeof accuracy === "number" && Number.isFinite(accuracy) ? accuracy : undefined,
            timestamp: Date.now(),
          });
        },
      );
      watchSubscriptionRef.current = subscription;
      setFollowEnabled(true);
    } catch {
      Alert.alert("Follow error", "Could not start following your location.");
    }
  };

  const handleToggleFollow = () => {
    if (followEnabled) {
      stopFollowing();
    } else {
      void startFollowing();
    }
  };

  const handleCancelMapLocation = () => {
    stopFollowing();
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

  useEffect(() => {
    return () => {
      stopFollowing();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
          // Non-fatal.
        });
      }
      return prev.filter((_, i) => i !== index);
    });
  };

  const resolveUploadedFileUrl = (uploadedPath: string, fallbackPath: string) => {
    const resolved = getPublicFileUrl(uploadedPath || fallbackPath);
    if (!resolved || typeof resolved !== "string") {
      throw new Error("Failed to resolve uploaded image URL.");
    }
    return resolved;
  };

  const handleSave = async (): Promise<boolean> => {
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
      Alert.alert("Not signed in", "Please log in again before saving changes.");
      return false;
    }

    if (submittingRef.current) {
      return false;
    }

    try {
      submittingRef.current = true;
      setSubmitLoading(true);

      // Keep existing remote attachment URLs.
      const existingUrls = attachments
        .filter((attachment) => !isLocalAttachmentUri(attachment.uri))
        .map((attachment) => attachment.uri);

      // Upload any new local attachments.
      const newLocalAttachments = attachments.filter((attachment) =>
        isLocalAttachmentUri(attachment.uri),
      );
      const uploadedUrls: string[] = [];

      for (let i = 0; i < newLocalAttachments.length; i += 1) {
        const attachment = newLocalAttachments[i];
        const extension = getFileExtension(attachment);
        const destinationPath = `${reportId}/edited-attachment-${Date.now()}-${i + 1}.${extension}`;

        const uploaded = await uploadFile(attachment.uri, destinationPath, {
          contentType: attachment.mimeType || getContentType(extension),
          base64Data: attachment.base64 ?? undefined,
        });

        const uploadedPath =
          typeof uploaded?.path === "string" && uploaded.path.length > 0
            ? uploaded.path
            : destinationPath;

        const publicUrl = resolveUploadedFileUrl(uploadedPath, destinationPath);
        uploadedUrls.push(publicUrl);
      }

      const finalAttachmentUrls = [...existingUrls, ...uploadedUrls];

      const reportRef = doc(
        collection(db, "regular_user", currentUser.uid, "reports"),
        reportId,
      );

      await updateDoc(reportRef, {
        category: trimmedCategory,
        issue: trimmedIssue,
        address: trimmedAddress || null,
        locationDetails: trimmedLocation || null,
        location: combinedLocation || null,
        gpsLocation: trimmedGpsLocation || null,
        waterMeter: trimmedWaterMeter || null,
        attachments: finalAttachmentUrls,
        updatedAt: serverTimestamp(),
      });

      await cleanupCachedAttachments(newLocalAttachments);

      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to save changes.";
      Alert.alert("Save error", message);
      return false;
    } finally {
      submittingRef.current = false;
      setSubmitLoading(false);
    }
  };

  return {
    address,
    attachments,
    category,
    followEnabled,
    gpsAccuracy,
    gpsLoading,
    gpsLocation,
    issue,
    loading,
    loadError,
    location,
    mapCenter,
    mapRegion,
    mapVisible,
    recenterKey,
    selectedPin,
    submitLoading,
    waterMeter,
    handleCancelMapLocation,
    handleConfirmMapLocation,
    handlePickAttachment,
    handleRecenterMap,
    handleRegionChangeComplete,
    handleRemoveAttachment,
    handleSave,
    handleToggleFollow,
    handleUseGps,
    setAddress,
    setCategory,
    setIssue,
    setLocation,
    setMapVisible,
    setWaterMeter,
  };
}