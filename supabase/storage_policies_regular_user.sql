-- =====================================================================
-- Supabase Storage policies for the `regular_user` bucket
-- Project: kfanwlpemesqvquypqvh
--
-- The PureDrop mobile app authenticates with Firebase Auth, but talks to
-- Supabase Storage using the public anon key. Because there is no Supabase
-- JWT session from the app, the policies below allow the public anon key to
-- upload/read/delete profile pictures under the `users/{userId}/` folder.
--
-- If you later switch the app to Supabase Auth (so `auth.uid()` is populated),
-- you can tighten these policies to `(storage.foldername(name))[1] =
-- auth.uid()::text`. For now, keep them permissive so the preview/dev builds
-- never fail to upload.
-- =====================================================================

-- 1) PUBLIC READ: anyone can read profile pictures (needed so the public
--    anon key can display avatars without a signed URL).
CREATE POLICY "regular_user_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'regular_user');

-- 2) PUBLIC INSERT: allow the anon key to upload profile pictures.
CREATE POLICY "regular_user_public_insert"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'regular_user');

-- 3) PUBLIC UPDATE: allow overwrite/upsert of profile pictures.
CREATE POLICY "regular_user_public_update"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'regular_user');

-- 4) PUBLIC DELETE: allow the app to remove old profile pictures.
CREATE POLICY "regular_user_public_delete"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'regular_user');
