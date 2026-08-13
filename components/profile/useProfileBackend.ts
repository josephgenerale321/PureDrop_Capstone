import * as FileSystem from "expo-file-system/legacy";
import * as ImagePicker from "expo-image-picker";
import { type Href, useRouter } from "expo-router";
import { onAuthStateChanged } from "firebase/auth";
import { collection, doc, getDocs, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { useEffect, useState } from "react";
import { Alert } from "react-native";
import { getPublicFileUrl, removeFile, uploadFile } from "../../api/storage";
import { takeProfilePhoto } from "./camera_editprof";
import { resizeProfileImage } from "./file_resize_editprof";
import {
  getContentType,
  getFileExtension,
  validateProfileImage,
} from "./file_valid_editprof";
import type { ProfileViewModel } from "./profilecomponent";
import {
  getProfileCache,
  saveProfileCache,
} from "../main_layout/offline_profile_cache";
import { auth, db } from "../../firebaseConfig";
import { uidToNumber } from "../../lib/uidToNumber";

const LOGIN_ROUTE = "/login" as Href;
const LOCAL_AVATAR_URI_PATTERN = /^(file|content|ph|assets-library):/i;
const PROFILE_AVATAR_CACHE_DIR = "profile-avatar";
// Generous timeouts: after the app has been idle for 10-30 min, the first
// request can be slow (token refresh, cold connection). Never fail a request
// that is still completing in the background.
const FIRESTORE_TIMEOUT_MS = 60_000;
const AVATAR_UPLOAD_TIMEOUT_MS = 60_000;

const withTimeout = <T,>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(
        new Error(
          `${label} timed out after ${Math.round(timeoutMs / 1000)}s. Please check your connection and try again.`
        )
      );
    }, timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (timer) {
      clearTimeout(timer);
    }
  });
};

/**
 * Computes the sequential display ID (1, 2, 3...) for a user, matching the
 * admin panel's logic: sort all users by UID alphabetically, then assign
 * index + 1. This ensures the mobile app shows the SAME ID as the admin.
 */
const getSequentialDisplayId = async (uid: string): Promise<string> => {
  try {
    const usersSnap = await getDocs(collection(db, "regular_user"));
    const allUids = usersSnap.docs
      .map((docSnap) => {
        const data = docSnap.data() as { uid?: string };
        return data.uid || docSnap.id;
      })
      .sort((a, b) => String(a).localeCompare(String(b)));
    const position = allUids.indexOf(uid);
    if (position >= 0) {
      return String(position + 1);
    }
  } catch {
    // Fall back to hash-based ID if the lookup fails (offline, permissions, etc.)
  }
  return uidToNumber(uid);
};

interface RegularUserDoc {
  fullName?: string;
  address?: string;
  email?: string;
  waterMeter?: number | string | null;
  profileImageUrl?: string;
  profileImagePath?: string;
}

export type EditableProfileValues = {
  fullName: string;
  address: string;
  email: string;
  waterMeter: string;
};

export function useProfileBackend() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [uploadingProfilePicture, setUploadingProfilePicture] = useState(false);
  const [editProfileVisible, setEditProfileVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<ProfileViewModel | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [profileImagePath, setProfileImagePath] = useState<string | null>(null);

  type PendingAvatar = ImagePicker.ImagePickerAsset | null;
  const [pendingAvatar, setPendingAvatar] = useState<PendingAvatar>(null);

  const avatarBucket =
    (process.env.EXPO_PUBLIC_SUPABASE_AVATAR_BUCKET || "").trim()
    || (process.env.EXPO_PUBLIC_SUPABASE_STORAGE_BUCKET || "").trim()
    || "regular_user";
  const avatarFolder = (process.env.EXPO_PUBLIC_SUPABASE_AVATAR_FOLDER || "").trim() || "users";

  const createStableAvatarUri = async (uri: string, extension: string) => {
    if (!LOCAL_AVATAR_URI_PATTERN.test(uri) || !FileSystem.cacheDirectory) {
      return { cached: false, uri };
    }

    const cacheDir = `${FileSystem.cacheDirectory}${PROFILE_AVATAR_CACHE_DIR}`;
    const cachedUri = `${cacheDir}/avatar-${currentUserId}-${Date.now()}.${extension}`;
    await FileSystem.makeDirectoryAsync(cacheDir, { intermediates: true });
    await FileSystem.copyAsync({ from: uri, to: cachedUri });

    return { cached: true, uri: cachedUri };
  };

  useEffect(() => {
    let isMounted = true;
    let unsubscribeProfile: (() => void) | null = null;

    const unsubscribeAuth = onAuthStateChanged(auth, (currentUser) => {
      if (unsubscribeProfile) {
        unsubscribeProfile();
        unsubscribeProfile = null;
      }

      if (!currentUser) {
        if (isMounted) {
          setCurrentUserId(null);
          setProfileImagePath(null);
          setEditProfileVisible(false);
          router.replace(LOGIN_ROUTE);
          setLoading(false);
        }
        return;
      }

      if (isMounted) {
        setCurrentUserId(currentUser.uid);
        setError(null);
        setLoading(true);
      }

      const profileRef = doc(db, "regular_user", currentUser.uid);
      unsubscribeProfile = onSnapshot(
        profileRef,
        (profileSnap) => {
          if (!isMounted) {
            return;
          }

          if (!profileSnap.exists()) {
            setError("Profile not found.");
            setProfileImagePath(null);
            setProfile({
              fullName: "User",
              address: "",
              email: currentUser.email || "No email",
              waterMeter: null,
              profileImageUrl: null,
              uid: uidToNumber(currentUser.uid),
            });
            setLoading(false);
            return;
          }

          const data = profileSnap.data() as RegularUserDoc;
          setError(null);
          setProfileImagePath(typeof data.profileImagePath === "string" ? data.profileImagePath : null);
          const imgUrl =
            typeof data.profileImageUrl === "string" && data.profileImageUrl.length > 0
              ? data.profileImageUrl
              : null;
          // Compute the sequential display ID (1, 2, 3...) matching the admin.
          void getSequentialDisplayId(currentUser.uid).then((displayId) => {
            if (!isMounted) {
              return;
            }
            setProfile({
              fullName: data.fullName || "User",
              address: data.address || "",
              email: data.email || currentUser.email || "No email",
              waterMeter: data.waterMeter ?? null,
              profileImageUrl: imgUrl,
              uid: displayId,
            });
          });
          // Persist the profile locally (name + downloaded photo) so the
          // Profile screen can render offline too.
          void saveProfileCache(currentUser.uid, {
            fullName: data.fullName || "",
            address: data.address || "",
            email: data.email || currentUser.email || "",
            waterMeter: data.waterMeter ?? null,
            profileImageUrl: imgUrl,
          });
          setLoading(false);
        },
        async (profileError) => {
          if (!isMounted) {
            return;
          }

          console.error("Failed to subscribe to profile:", profileError);
          // Offline fallback: show the cached profile (name + local photo)
          // instead of an error so the Profile screen still reflects the user.
          try {
            const cached = await getProfileCache(currentUser.uid);
            if (!isMounted) {
              return;
            }
            if (cached) {
              // Compute the sequential display ID (1, 2, 3...) matching the admin.
              void getSequentialDisplayId(currentUser.uid).then((displayId) => {
                if (!isMounted) {
                  return;
                }
                setProfile({
                  fullName: cached.fullName || "User",
                  address: cached.address || "",
                  email: cached.email || currentUser.email || "No email",
                  waterMeter: cached.waterMeter ?? null,
                  profileImageUrl: cached.profileImageLocalUri || cached.profileImageUrl,
                  uid: displayId,
                });
              });
              setError(null);
            } else {
              setError("Failed to load your profile.");
            }
          } catch {
            if (isMounted) {
              setError("Failed to load your profile.");
            }
          } finally {
            if (isMounted) {
              setLoading(false);
            }
          }
        },
      );
    });

    return () => {
      isMounted = false;
      unsubscribeAuth();
      if (unsubscribeProfile) {
        unsubscribeProfile();
      }
    };
  }, [router]);

  const editProfileValues: EditableProfileValues = {
    fullName: profile?.fullName || "",
    address: profile?.address || "",
    email: profile?.email || "",
    waterMeter:
      profile?.waterMeter !== undefined && profile?.waterMeter !== null
        ? `${profile.waterMeter}`
        : "",
  };

  const handleSaveProfile = async (values: EditableProfileValues) => {
    if (!currentUserId) {
      Alert.alert("Not signed in", "Please sign in again before editing your profile.");
      return;
    }

    const fullName = values.fullName.trim();
    const address = values.address.trim();
    const email = values.email.trim();
    const waterMeterText = values.waterMeter.trim();

    if (!fullName) {
      Alert.alert("Full name required", "Please enter your full name.");
      return;
    }

    if (!address) {
      Alert.alert("Address required", "Please enter your address.");
      return;
    }

    if (!email) {
      Alert.alert("Email required", "Please enter your email.");
      return;
    }

    const waterMeter =
      waterMeterText.length > 0 ? Number.parseInt(waterMeterText, 10) : null;

    if (waterMeterText.length > 0 && !Number.isFinite(waterMeter)) {
      Alert.alert("Invalid water meter", "Please enter numbers only for your water meter.");
      return;
    }

    if (waterMeterText.length > 6) {
      Alert.alert("Invalid water meter", "Water meter must be at most 6 digits.");
      return;
    }

    try {
      setSavingProfile(true);
      const userDocRef = doc(db, "regular_user", currentUserId);

      let resolvedProfileImageUrl: string | null = null;
      let resolvedProfileImagePath: string | null = null;

      if (pendingAvatar) {
        const upload = await withTimeout(
          uploadPendingAvatar(pendingAvatar),
          AVATAR_UPLOAD_TIMEOUT_MS,
          "Profile picture upload"
        );
        resolvedProfileImageUrl = upload.publicUrl;
        resolvedProfileImagePath = upload.uploadedPath;
      }

      // Firestore update with retry. After 10-30 min idle, the first write can
      // be slow (token refresh, cold connection). If the first attempt times
      // out, retry immediately — the connection is now warm and the retry will
      // succeed. This prevents false "30 second" errors after an idle period.
      const profileFields: Record<string, unknown> = {
        fullName,
        address,
        email,
        waterMeter,
        updatedAt: serverTimestamp(),
      };
      // Only write the avatar fields when a new picture was actually uploaded.
      // Otherwise a plain text edit would wipe out the existing profile
      // picture (profileImageUrl/path would be overwritten with null).
      if (resolvedProfileImageUrl) {
        profileFields.profileImageUrl = resolvedProfileImageUrl;
      }
      if (resolvedProfileImagePath) {
        profileFields.profileImagePath = resolvedProfileImagePath;
      }
      try {
        await withTimeout(
          setDoc(userDocRef, profileFields, { merge: true }),
          FIRESTORE_TIMEOUT_MS,
          "Profile save"
        );
      } catch (firstError) {
        // First attempt timed out (cold start). Retry once — the connection is
        // now warm. But still let the retry surface a real failure if any.
        await withTimeout(
          setDoc(userDocRef, profileFields, { merge: true }),
          FIRESTORE_TIMEOUT_MS,
          "Profile save"
        );
      }

      setProfile((prev) => ({
        fullName,
        address,
        email,
        waterMeter,
        profileImageUrl: resolvedProfileImageUrl ?? prev?.profileImageUrl ?? null,
        uid: prev?.uid ?? uidToNumber(currentUserId),
      }));
      setProfileImagePath(resolvedProfileImagePath ?? profileImagePath);
      setPendingAvatar(null);
      setEditProfileVisible(false);
    } catch (saveError) {
      const rawMessage =
        saveError instanceof Error ? saveError.message.trim() : "";
      const message =
        rawMessage.length > 0
          ? rawMessage
          : "Failed to save your profile. Please check your connection and try again.";
      Alert.alert("Profile update error", message);
    } finally {
      setSavingProfile(false);
    }
  };

  const uploadPendingAvatar = async (selected: ImagePicker.ImagePickerAsset) => {
    if (!currentUserId) {
      throw new Error("You must be signed in to update your profile picture.");
    }

    let cachedAvatarUri: string | null = null;

    try {
      const validationError = await validateProfileImage(
        selected.uri,
        selected.mimeType,
        selected.fileSize ?? null
      );
      if (validationError) {
        throw new Error(validationError);
      }

      const resized = await withTimeout(
        resizeProfileImage(selected.uri, selected.mimeType),
        AVATAR_UPLOAD_TIMEOUT_MS,
        "Image resize"
      );
      const extension = getFileExtension(resized.uri, resized.mimeType);
      const stableAvatar = await withTimeout(
        createStableAvatarUri(resized.uri, extension),
        AVATAR_UPLOAD_TIMEOUT_MS,
        "Image cache"
      );
      if (stableAvatar.cached) {
        cachedAvatarUri = stableAvatar.uri;
      }

      // Use a UNIQUE timestamped path so INSERT always works — even if the
      // UPDATE policy is missing on Supabase. This guarantees the new picture
      // is always uploaded successfully. Old files are cleaned up afterward
      // (best-effort, requires DELETE policy).
      const destinationPath = `${avatarFolder}/${currentUserId}/profile-image-${Date.now()}.${extension}`;

      // Plain insert (no upsert) — always works because the filename is unique.
      const uploaded = await uploadFile(stableAvatar.uri, destinationPath, {
        bucket: avatarBucket,
        contentType: resized.mimeType || getContentType(extension),
        upsert: false,
        timeoutMs: AVATAR_UPLOAD_TIMEOUT_MS,
      });

      const uploadedPath =
        typeof uploaded?.path === "string" && uploaded.path.length > 0
          ? uploaded.path
          : destinationPath;

      // Clean up the previous profile image file(s) so the bucket never
      // accumulates files. The current upload uses a unique timestamped path,
      // so the previous file is the one stored in the user doc's
      // profileImagePath (if it differs from the path we just uploaded).
      // Fall back to cleaning stable `profile-image.{ext}` variants too.
      // Best-effort; never blocks the upload flow.
      const userFolderPath = `${avatarFolder}/${currentUserId}`;
      const previousPath = profileImagePath;
      const legacyVariants = ["jpg", "jpeg", "png", "webp", "heic"]
        .map((ext) => `${userFolderPath}/profile-image.${ext}`)
        .concat([`${userFolderPath}/profile-image-${Date.now()}.${extension}`]);
      const candidatesToRemove = legacyVariants;
      if (typeof previousPath === "string" && previousPath.length > 0) {
        candidatesToRemove.unshift(previousPath);
      }
      for (const legacyPath of candidatesToRemove) {
        if (legacyPath !== uploadedPath) {
          void removeFile(legacyPath, avatarBucket).catch(() => {
            // Legacy variant cleanup is best-effort; never blocks the flow.
          });
        }
      }

      const publicUrl = getPublicFileUrl(uploadedPath, avatarBucket);
      if (!publicUrl) {
        throw new Error("Failed to resolve avatar URL.");
      }

      // Cache-busting query param: even though the storage path stays stable,
      // the URL changes on every upload so the Image component / HTTP cache
      // does NOT serve the old avatar. Without this, "taking a picture again
      // fast" can display the previously cached image.
      const cacheBustedUrl = `${publicUrl}${publicUrl.includes("?") ? "&" : "?"}v=${Date.now()}`;

      return { publicUrl: cacheBustedUrl, uploadedPath };
    } finally {
      if (cachedAvatarUri) {
        void FileSystem.deleteAsync(cachedAvatarUri, { idempotent: true }).catch(() => {
          // Cache cleanup failure should not block profile upload flow.
        });
      }
    }
  };

  const validateAndSetPendingAvatar = async (selected: ImagePicker.ImagePickerAsset) => {
    const validationError = await validateProfileImage(
      selected.uri,
      selected.mimeType,
      selected.fileSize ?? null
    );
    if (validationError) {
      Alert.alert("Invalid image", validationError);
      return;
    }
    // Only set a local preview. The upload happens on Save.
    setPendingAvatar(selected);
  };

  const handleChangeProfilePicture = async () => {
    if (!currentUserId) {
      Alert.alert("Not signed in", "Please sign in again before updating your profile picture.");
      return;
    }

    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (permission.status !== "granted") {
        Alert.alert("Permission needed", "Please allow photo library access.");
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });

      if (result.canceled || result.assets.length === 0) {
        return;
      }

      await validateAndSetPendingAvatar(result.assets[0]);
    } catch {
      Alert.alert("Image picker error", "Unable to open the photo library. Please try again.");
    }
  };

  const handleTakePhoto = async () => {
    if (!currentUserId) {
      Alert.alert("Not signed in", "Please sign in again before updating your profile picture.");
      return;
    }

    const selected = await takeProfilePhoto();
    if (!selected) {
      return;
    }

    await validateAndSetPendingAvatar(selected);
  };

  const handleRemoveProfilePicture = async () => {
    if (!currentUserId) {
      Alert.alert("Not signed in", "Please sign in again before updating your profile picture.");
      return;
    }

    // If there is a pending (unsaved) preview, just discard it and revert.
    if (pendingAvatar) {
      setPendingAvatar(null);
      return;
    }

    const currentPath = profileImagePath;
    if (!currentPath) {
      return;
    }

    try {
      setUploadingProfilePicture(true);
      const userDocRef = doc(db, "regular_user", currentUserId);

      await withTimeout(
        setDoc(
          userDocRef,
          {
            profileImageUrl: null,
            profileImagePath: null,
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        ),
        FIRESTORE_TIMEOUT_MS,
        "Remove profile picture"
      );

      try {
        await removeFile(currentPath, avatarBucket);
      } catch {
        // The document is already cleared; storage cleanup should not block the flow.
      }

      setProfileImagePath(null);
      setProfile((prev) => ({
        fullName: prev?.fullName || "User",
        address: prev?.address || "",
        email: prev?.email || "No email",
        waterMeter: prev?.waterMeter ?? null,
        profileImageUrl: null,
        uid: prev?.uid ?? uidToNumber(currentUserId),
      }));
    } catch (removeError) {
      const message =
        removeError instanceof Error
          ? removeError.message
          : "Failed to remove profile picture.";
      Alert.alert("Remove error", message);
    } finally {
      setUploadingProfilePicture(false);
    }
  };

  const openEditProfile = () => {
    setPendingAvatar(null);
    setEditProfileVisible(true);
  };

  const closeEditProfile = () => {
    if (!savingProfile && !uploadingProfilePicture) {
      setPendingAvatar(null);
      setEditProfileVisible(false);
    }
  };

  return {
    // State
    loading,
    savingProfile,
    uploadingProfilePicture,
    editProfileVisible,
    error,
    profile,
    currentUserId,
    profileImagePath,
    pendingAvatar,
    editProfileValues,
    // Handlers
    handleSaveProfile,
    handleChangeProfilePicture,
    handleTakePhoto,
    handleRemoveProfilePicture,
    openEditProfile,
    closeEditProfile,
  };
}