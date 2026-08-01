# Edit Profile Picture Improvements

## Steps
- [x] 1. Create `components/profile/file_valid_editprof.tsx` (validation helpers)
- [x] 2. Create `components/profile/file_resize_editprof.tsx` (safe resize helper — no external dependency)
- [x] 3. Create `components/profile/camera_editprof.tsx` (camera helper)
- [x] 4. Update `app/regular_user/profile/profileview.tsx` (refactor upload, add camera + remove photo, fix Uploading bug, add validation + crop)
- [x] 5. Update `components/profile/editprofile_lightboxed.tsx` (action sheet, icons, expo-image avatar)
- [x] 6. `expo-image-manipulator` installed then removed — confirmed broken on Android bundling; replaced with expo-image-picker built-in `quality` + square crop (crash-safe)
- [x] 7. Verify with typecheck — `npx tsc --noEmit` passes (EXIT=0, no errors)


