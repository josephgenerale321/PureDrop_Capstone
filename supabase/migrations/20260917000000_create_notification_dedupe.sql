-- =====================================================================
-- Supabase-backed once-only dedupe for in-app + system notifications
-- Project: kfanwlpemesqvquypqvh
--
-- Paste this entire file into the Supabase SQL editor and run it, OR
-- run `supabase db push` from PureDrop_Capstone-main.
--
-- WHY THIS TABLE EXISTS:
-- The mobile app authenticates with Firebase Auth but uses the Supabase
-- anon key for storage/edge-functions (no Supabase JWT session). Floating
-- banners (floating_notif.tsx) and local system notifications
-- (system_notif.tsx) must each present a given report-status update ONLY
-- ONCE -- even across app restarts -- otherwise the same
-- "Admin set your report as Pending/..." update doubles on app open
-- (both presenters fire) and re-appears on every reopen while still
-- unread. Firestore is NOT used for this (per product decision); the
-- presented-keys live here in Supabase with an AsyncStorage mirror for
-- offline/fast boot.
--
-- SHAPE: one row per Firebase uid, holding the last ~200 presented keys:
--   report:       "<docId>:<statusUpdatedAtMs>:<status>"
--   verification: "verification:<seenKey or status:createdAtMs>"
-- =====================================================================

create table if not exists public.notification_dedupe (
  user_id text primary key,
  presented_keys jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.notification_dedupe enable row level security;

-- The app talks to Supabase with the public anon key (no Supabase Auth
-- session -- auth is Firebase). Mirror the storage_policies_* pattern and
-- allow the anon key to manage its own dedupe rows. Keys are opaque
-- "<id>:<ts>:<status>" strings -- no PII -- so a permissive anon policy is
-- acceptable here. Restrict to anon + authenticated (service_role bypasses
-- RLS anyway for edge functions).
drop policy if exists "allow anon select notification_dedupe" on public.notification_dedupe;
drop policy if exists "allow anon insert notification_dedupe" on public.notification_dedupe;
drop policy if exists "allow anon update notification_dedupe" on public.notification_dedupe;
drop policy if exists "allow anon delete notification_dedupe" on public.notification_dedupe;

create policy "allow anon select notification_dedupe"
on public.notification_dedupe
for select
to anon, authenticated
using (true);

create policy "allow anon insert notification_dedupe"
on public.notification_dedupe
for insert
to anon, authenticated
with check (char_length(user_id) > 0 and char_length(user_id) <= 128);

create policy "allow anon update notification_dedupe"
on public.notification_dedupe
for update
to anon, authenticated
using (true)
with check (char_length(user_id) > 0 and char_length(user_id) <= 128);

create policy "allow anon delete notification_dedupe"
on public.notification_dedupe
for delete
to anon, authenticated
using (true);

create index if not exists notification_dedupe_updated_at_idx
  on public.notification_dedupe (updated_at);
