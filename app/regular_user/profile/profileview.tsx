import { useRouter } from "expo-router";
import EditProfileLightbox from "../../../components/profile/editprofile_lightboxed";
import ProfileComponent from "../../../components/profile/profilecomponent";
import {
  useProfileBackend,
  type EditableProfileValues,
} from "../../../components/profile/useProfileBackend";

export default function ProfileViewScreen() {
  const router = useRouter();
  const {
    loading,
    savingProfile,
    uploadingProfilePicture,
    editProfileVisible,
    error,
    profile,
    pendingAvatar,
    editProfileValues,
    handleSaveProfile,
    handleChangeProfilePicture,
    handleTakePhoto,
    handleRemoveProfilePicture,
    openEditProfile,
    closeEditProfile,
  } = useProfileBackend();

  return (
    <>
      <ProfileComponent
        profile={profile}
        loading={loading}
        error={error}
        savingProfile={savingProfile}
        onEditProfile={openEditProfile}
        onBack={() => router.replace("/regular_user/profile")}
      />

      <EditProfileLightbox
        visible={editProfileVisible}
        values={editProfileValues}
        saving={savingProfile}
        uploadingProfilePicture={uploadingProfilePicture}
        profileImageUrl={profile?.profileImageUrl ?? null}
        pendingAvatarUri={pendingAvatar?.uri ?? null}
        hasProfilePicture={profile?.profileImageUrl != null}
        onClose={closeEditProfile}
        onSave={handleSaveProfile}
        onChangeProfilePicture={handleChangeProfilePicture}
        onTakePhoto={handleTakePhoto}
        onRemoveProfilePicture={handleRemoveProfilePicture}
      />
    </>
  );
}