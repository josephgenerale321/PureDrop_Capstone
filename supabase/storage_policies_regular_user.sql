-- =====================================================================
-- Supabase Storage policies for the `regular_user` bucket
-- Project: kfanwlpemesqvquypqvh
--
-- Paste this entire file into the Supabase SQL editor and run it.
--
-- The PureDrop mobile app authenticates with Firebase Auth, but talks to
-- Supabase Storage using the public anon key. Because there is no Supabase
-- JWT session from the app, the policies below allow the public anon key to
-- upload/read/delete profile pictures in the `regular_user` bucket.
-- =====================================================================

-- Ensure bucket exists
insert into storage.buckets (id, name, public)
values ('regular_user', 'regular_user', true)
on conflict (id) do nothing;

-- Clean old policies (optional but avoids duplicates/conflicts)
drop policy if exists "allow anon insert regular_user" on storage.objects;
drop policy if exists "allow anon update regular_user" on storage.objects;
drop policy if exists "allow anon read regular_user" on storage.objects;
drop policy if exists "allow anon delete regular_user" on storage.objects;

-- Required for first upload
create policy "allow anon insert regular_user"
on storage.objects
for insert
to anon
with check (bucket_id = 'regular_user');

-- Required for upsert overwrite
create policy "allow anon update regular_user"
on storage.objects
for update
to anon
using (bucket_id = 'regular_user')
with check (bucket_id = 'regular_user');

create policy "allow anon read regular_user"
on storage.objects
for select
to anon
using (bucket_id = 'regular_user');

create policy "allow anon delete regular_user"
on storage.objects
for delete
to anon
using (bucket_id = 'regular_user');
