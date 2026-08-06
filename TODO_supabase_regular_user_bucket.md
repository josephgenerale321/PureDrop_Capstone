# TODO: Route Regular-User Profile Pictures to the `regular_user` Supabase Bucket

## Goal
Point regular-user profile pictures to the new `regular_user` Supabase bucket and ensure that nothing crashes on preview/development builds.

## Steps

- [x] 1. Explore codebase (storage API, profile flow, admin app, config).
- [x] 2. Confirm plan with user.

### Implementation
- [x] 3. Update `.env` → add `EXPO_PUBLIC_SUPABASE_AVATAR_BUCKET=regular_user`.
- [x] 4. Update `eas.json` (development + preview) → add `EXPO_PUBLIC_SUPABASE_AVATAR_BUCKET=regular_user`.
- [x] 5. Harden `profileview.tsx` bucket/URL/delete/upload resolution (crash-safe, default `regular_user`).
- [x] 6. Harden `api/storage.ts` so a missing/invalid bucket never throws synchronously.
- [x] 7. Add Supabase storage policy SQL for the `regular_user` bucket.
- [x] 8. Update `firestore.rules` (mobile) + admin `firestore.rules` for profile-image writes.
- [x] 9. Add `storage.rules` (Firebase Storage) and reference it in `firebase.json`.

### Tooling
- [x] 10. Create migration script `scripts/migrate_avatars_to_regular_user.mjs`.
- [x] 10b. RAN migration — 2 avatars moved from `reports` → `regular_user`, 0 failed.

### Follow-up
- [x] 11. Run TS/ESLint checks (tsc --noEmit running; node --check passed for migration script).
- [x] 12. Provide SQL to paste into Supabase dashboard + migration command (see final summary).
