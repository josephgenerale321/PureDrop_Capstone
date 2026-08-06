# TODO — Edit Profile Photo Preview/Cancel/Save Flow

Goal: When picking/taking a photo in the Edit Profile lightbox, only show a local preview.
- Cancel discards the preview and reverts to the previous photo.
- Save commits (uploads) the new photo, along with the text fields.

## Steps
- [x] 1. `editprofile_lightboxed.tsx`:
      - Add `pendingAvatarUri` prop + type.
      - Avatar source logic prefers `pendingAvatarUri`.
      - Show Remove/Discard button when `hasProfilePicture || pendingAvatarUri`.
      - Add a small "New photo" preview badge.
- [x] 2. `profileview.tsx`:
      - Add `pendingAvatar` state.
      - Reset `pendingAvatar` on open/close.
      - `handleChangeProfilePicture` / `handleTakePhoto` only set the local preview.
      - Refactor `processAndUploadImage` into `uploadPendingAvatar` returning `{publicUrl, uploadedPath}` without committing the doc.
      - `handleSaveProfile` uploads pending avatar and includes it in the single `updateDoc`.
      - `handleRemoveProfilePicture` clears pending preview first (server removal otherwise).
      - Pass `pendingAvatarUri` to the lightbox.
- [ ] 3. Run TypeScript check (`tsc --noEmit`).
- [ ] 4. Manual test: pick/take photo → preview → Cancel reverts; Save uploads + persists.

## Crash-Safety
- All new logic wrapped in existing try/catch.
- Preview uses stable local URIs only.
- Upload keeps `finally` cleanup for cached avatar.

