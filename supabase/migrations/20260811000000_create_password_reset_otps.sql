create table if not exists public.password_reset_otps (
  email_hash text primary key,
  email text not null,
  code_hash text not null,
  attempts integer not null default 0,
  expires_at timestamptz not null,
  sent_at timestamptz not null,
  created_at timestamptz not null default now(),
  last_attempt_at timestamptz
);

alter table public.password_reset_otps enable row level security;

create index if not exists password_reset_otps_expires_at_idx
  on public.password_reset_otps (expires_at);