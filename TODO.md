# Offline Account & Reports Fix

## Goal
Make the app show the real logged-in account (name + profile picture) and My Reports when reopened **offline**, across Home, Profile, and tab avatar.

## Steps
- [x] 1. Create `components/main_layout/offline_profile_cache.ts` (per-user profile cache + local photo download)
- [x] 2. Update `components/home/useHomeDashboard.ts` to cache profile online & read cache offline
- [x] 3. Update `app/regular_user/_layout.jsx` to use cached profile image for tab avatar offline
- [x] 4. Update `app/regular_user/profile/profileview.tsx` to show cached profile offline
- [x] 5. Harden `components/my_report/useMyReports.ts` offline fallback (don't wipe cache, seed on online)
- [x] 6. Update `components/my_report/offlinefunc.tsx` (helper for clearing per-user cache)
- [x] 7. Update `app/regular_user/signout/signout_modal.tsx` to clear profile + reports caches on logout
- [ ] 8. Rebuild preview APK (`npx eas build --profile preview --platform android`)
