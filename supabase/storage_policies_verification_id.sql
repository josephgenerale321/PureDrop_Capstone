-- =====================================================================
-- Supabase Storage policies for the `verification_id` bucket
-- Project: kfanwlpemesqvquypqvh
--
-- Paste this entire file into the Supabase SQL editor and run it.
--
-- The PureDrop mobile app authenticates with Firebase Auth, but talks to
-- Supabase Storage using the public anon key. Because there is no Supabase
-- JWT session from the app, the policies below allow the public anon key to
-- upload/read/delete the identity-verification photos (face selfies and
-- valid IDs) in the `verification_id` bucket. The admin verification review
-- screens read the same objects through their public URLs.
-- =====================================================================

-- Ensure bucket exists (public, so the admin panel can resolve public URLs)
insert into storage.buckets (id, name, public)
values ('verification_id', 'verification_id', true)
on conflict (id) do nothing;

-- Clean old policies (optional but avoids duplicates/conflicts)
drop policy if exists "allow anon insert verification_id" on storage.objects;
drop policy if exists "allow anon update verification_id" on storage.objects;
drop policy if exists "allow anon read verification_id" on storage.objects;
drop policy if exists "allow anon delete verification_id" on storage.objects;

-- Required for first upload
create policy "allow anon insert verification_id"
on storage.objects
for insert
to anon
with check (bucket_id = 'verification_id');

-- Required for upsert overwrite (retaking a photo overwrites the object)
create policy "allow anon update verification_id"
on storage.objects
for update
to anon
using (bucket_id = 'verification_id')
with check (bucket_id = 'verification_id');

create policy "allow anon read verification_id"
on storage.objects
for select
to anon
using (bucket_id = 'verification_id');

-- Required for the delete-submission flow in the mobile app
create policy "allow anon delete verification_id"
on storage.objects
for delete
to anon
using (bucket_id = 'verification_id');
