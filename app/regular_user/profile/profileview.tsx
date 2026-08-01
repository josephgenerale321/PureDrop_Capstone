import * as FileSystem from "expo-file-system/legacy";
import * as ImagePicker from "expo-image-picker";
import { type Href, useRouter } from "expo-router";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc, onSnapshot, serverTimestamp, updateDoc } from "firebase/firestore";
import { useEffect, useState } from "react";
import { Alert } from "react-native";
import { getPublicFileUrl, removeFile, uploadFile } from "../../../api/storage";
import { takeProfilePhoto } from "../../../components/profile/camera_editprof";
import EditProfileLightbox, {
  type EditableProfileValues,
} from "../../../components/profile/editprofile_lightboxed";
import { resizeProfileImage } from "../../../components/profile/file_resize_editprof";
import {
  getContentType,
  getFileExtension,
  validateProfileImage,
} from "../../../components/profile/file_valid_editprof";
import ProfileComponent, {
  type ProfileViewModel,
} from "../../../components/profile/profilecomponent";
import { auth, db } from "../../../firebaseConfig";

const LOGIN_ROUTE = "/login" as Href;
const LOCAL_AVATAR_URI_PATTERN = /^(file|content|ph|assets-library):/i;
const PROFILE_AVATAR_CACHE_DIR = "profile-avatar";

interface RegularUserDoc {
  fullName?: string;
  address?: string;
  email?: string;
  waterMeter?: number | string | null;
  profileImageUrl?: string;
  profileImagePath?: string;
}

export default function ProfileViewScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [uploadingProfilePicture, setUploadingProfilePicture] = useState(false);
  const [editProfileVisible, setEditProfileVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<ProfileViewModel | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [profileImagePath, setProfileImagePath] = useState<string | null>(null);

  const avatarBucket = process.env.EXPO_PUBLIC_SUPABASE_AVATAR_BUCKET
    || process.env.EXPO_PUBLIC_SUPABASE_STORAGE_BUCKET
    || "reports";
  const avatarFolder = process.env.EXPO_PUBLIC_SUPABASE_AVATAR_FOLDER || "users";

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
            });
            setLoading(false);
            return;
          }

          const data = profileSnap.data() as RegularUserDoc;
          setError(null);
          setProfileImagePath(typeof data.profileImagePath === "string" ? data.profileImagePath : null);
          setProfile({
            fullName: data.fullName || "User",
            address: data.address || "",
            email: data.email || currentUser.email || "No email",
            waterMeter: data.waterMeter ?? null,
            profileImageUrl:
              typeof data.profileImageUrl === "string" && data.profileImageUrl.length > 0
                ? data.profileImageUrl
                : null,
          });
          setLoading(false);
        },
        (profileError) => {
          if (!isMounted) {
            return;
          }

          console.error("Failed to subscribe to profile:", profileError);
          setError("Failed to load your profile.");
          setLoading(false);
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

    try {
      setSavingProfile(true);
      const userDocRef = doc(db, "regular_user", currentUserId);

      await updateDoc(userDocRef, {
        fullName,
        address,
        email,
        waterMeter,
        updatedAt: serverTimestamp(),
      });

      setProfile((prev) => ({
        fullName,
        address,
        email,
        waterMeter,
        profileImageUrl: prev?.profileImageUrl ?? null,
      }));
      setEditProfileVisible(false);
    } catch (saveError) {
      const message =
        saveError instanceof Error ? saveError.message : "Failed to save your profile.";
      Alert.alert("Profile update error", message);
    } finally {
      setSavingProfile(false);
    }
  };

  const processAndUploadImage = async (selected: ImagePicker.ImagePickerAsset) => {
    if (!currentUserId) {
      Alert.alert("Not signed in", "Please sign in again before updating your profile picture.");
      return;
    }

    let cachedAvatarUri: string | null = null;

    try {
      setUploadingProfilePicture(true);
      const userDocRef = doc(db, "regular_user", currentUserId);

      const validationError = await validateProfileImage(
        selected.uri,
        selected.mimeType,
        selected.fileSize ?? null
      );
      if (validationError) {
        Alert.alert("Invalid image", validationError);
        return;
      }

      const resized = await resizeProfileImage(selected.uri, selected.mimeType);
      const extension = getFileExtension(resized.uri, resized.mimeType);
      const stableAvatar = await createStableAvatarUri(resized.uri, extension);
      if (stableAvatar.cached) {
        cachedAvatarUri = stableAvatar.uri;
      }

      const destinationPath = `${avatarFolder}/${currentUserId}/profile-image-${Date.now()}.${extension}`;
      const latestProfileSnap = await getDoc(userDocRef);
      const latestProfileData = latestProfileSnap.exists()
        ? (latestProfileSnap.data() as RegularUserDoc)
        : null;
      const previousPathFromDb =
        typeof latestProfileData?.profileImagePath === "string"
          ? latestProfileData.profileImagePath
          : null;

      const uploaded = await uploadFile(stableAvatar.uri, destinationPath, {
        bucket: avatarBucket,
        contentType: resized.mimeType || getContentType(extension),
      });

      const uploadedPath =
        typeof uploaded?.path === "string" && uploaded.path.length > 0
          ? uploaded.path
          : destinationPath;

      const publicUrl = getPublicFileUrl(uploadedPath, avatarBucket);
      if (!publicUrl) {
        throw new Error("Failed to resolve avatar URL.");
      }

      await updateDoc(userDocRef, {
        profileImageUrl: publicUrl,
        profileImagePath: uploadedPath,
        updatedAt: serverTimestamp(),
      });

      const previousPath = previousPathFromDb || profileImagePath;
      if (previousPath && previousPath !== uploadedPath) {
        try {
          await removeFile(previousPath, avatarBucket);
        } catch {
          // The new avatar is already saved, so legacy cleanup should not block the flow.
        }
      }

      setProfileImagePath(uploadedPath);
      setProfile((prev) => ({
        fullName: prev?.fullName || "User",
        address: prev?.address || "",
        email: prev?.email || "No email",
        waterMeter: prev?.waterMeter ?? null,
        profileImageUrl: publicUrl,
      }));
    } catch (uploadError) {
      const message =
        uploadError instanceof Error ? uploadError.message : "Failed to upload profile picture.";
      Alert.alert("Upload error", message);
    } finally {
      if (cachedAvatarUri) {
        void FileSystem.deleteAsync(cachedAvatarUri, { idempotent: true }).catch(() => {
          // Cache cleanup failure should not block profile upload flow.
        });
      }
      setUploadingProfilePicture(false);
    }
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

      await processAndUploadImage(result.assets[0]);
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

    await processAndUploadImage(selected);
  };

  const handleRemoveProfilePicture = async () => {
    if (!currentUserId) {
      Alert.alert("Not signed in", "Please sign in again before updating your profile picture.");
      return;
    }

    const currentPath = profileImagePath;
    if (!currentPath) {
      return;
    }

    try {
      setUploadingProfilePicture(true);
      const userDocRef = doc(db, "regular_user", currentUserId);

      await updateDoc(userDocRef, {
        profileImageUrl: null,
        profileImagePath: null,
        updatedAt: serverTimestamp(),
      });

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

  return (
    <>
      <ProfileComponent
        profile={profile}
        loading={loading}
        error={error}
        savingProfile={savingProfile}
        onEditProfile={() => setEditProfileVisible(true)}
        onBack={() => router.replace("/regular_user/home")}
      />

      <EditProfileLightbox
        visible={editProfileVisible}
        values={editProfileValues}
        saving={savingProfile}
        uploadingProfilePicture={uploadingProfilePicture}
        profileImageUrl={profile?.profileImageUrl ?? null}
        hasProfilePicture={profile?.profileImageUrl != null}
        onClose={() => {
          if (!savingProfile && !uploadingProfilePicture) {
            setEditProfileVisible(false);
          }
        }}
        onSave={handleSaveProfile}
        onChangeProfilePicture={handleChangeProfilePicture}
        onTakePhoto={handleTakePhoto}
        onRemoveProfilePicture={handleRemoveProfilePicture}
      />
    </>
  );
}
