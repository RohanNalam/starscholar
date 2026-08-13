-- StarScholar: private per-user saved lookups.
-- Run this once in your Supabase project: SQL Editor → New query → paste → Run.

create table if not exists public.lookups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  video_url text not null,
  result jsonb not null,          -- the full CheckResult card, re-renderable as-is
  status text,                    -- verified / exaggerated / expired / unverified
  type text,                      -- scholarship / internship / job / summer_program / fellowship
  name text,
  organization text,
  deadline text,
  deadline_date date,             -- machine-readable deadline; drives auto-cleanup
  created_at timestamptz not null default now(),
  -- one row per opportunity: a single video can list several, so uniqueness is
  -- per (user, video, program name). Re-checking updates instead of duplicating.
  unique (user_id, video_url, name)
);

-- ── Migration (only if you created the table BEFORE multi-opportunity support) ─
-- Run these two lines once in the SQL Editor:
--
-- alter table public.lookups drop constraint if exists lookups_user_id_video_url_key;
-- alter table public.lookups add constraint lookups_user_video_name_key unique (user_id, video_url, name);

-- Row-level security: the database itself guarantees users only ever see their own rows.
alter table public.lookups enable row level security;

create policy "read own lookups"
  on public.lookups for select
  using (auth.uid() = user_id);

create policy "insert own lookups"
  on public.lookups for insert
  with check (auth.uid() = user_id);

create policy "update own lookups"
  on public.lookups for update
  using (auth.uid() = user_id);

create policy "delete own lookups"
  on public.lookups for delete
  using (auth.uid() = user_id);

create index if not exists lookups_user_created_idx
  on public.lookups (user_id, created_at desc);

-- ── Shared opportunity directory (Phase 2) ──────────────────────────────────
-- Every lookup any user runs is cached here: repeat URLs are instant and free,
-- and the browsable directory compounds with every user. Expired entries are
-- archived (status flip), never deleted — cycles recur annually.

create table if not exists public.opportunities (
  id uuid primary key default gen_random_uuid(),
  video_url text not null,
  platform text,
  author text,
  caption text,
  analyzed_with text,
  name text not null,
  organization text,
  type text,
  status text,
  deadline text,
  deadline_date date,
  result jsonb not null,           -- the full verified opportunity (claims + verification + sources)
  checked_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (video_url, name)
);

alter table public.opportunities enable row level security;

create policy "anyone can read the directory"
  on public.opportunities for select using (true);

create policy "app can insert"
  on public.opportunities for insert with check (true);

create policy "app can update"
  on public.opportunities for update using (true);

-- Lets a re-check clear rows it superseded. Without this, a run that names the
-- same program slightly differently leaves the old row behind and the video
-- appears to contain two opportunities.
create policy "app can delete"
  on public.opportunities for delete using (true);

create index if not exists opportunities_deadline_idx on public.opportunities (deadline_date);
create index if not exists opportunities_checked_idx on public.opportunities (checked_at);
create index if not exists opportunities_video_idx on public.opportunities (video_url);

-- ── Optional: nightly auto-purge of expired saves ────────────────────────────
-- The app already lazy-deletes expired rows whenever a user opens My List.
-- If you also want a true nightly cleanup, enable the pg_cron extension
-- (Database → Extensions → search "pg_cron" → enable), then run:
--
-- select cron.schedule(
--   'purge-expired-lookups',
--   '0 8 * * *',  -- every day 08:00 UTC
--   $$ delete from public.lookups where deadline_date is not null and deadline_date < current_date $$
-- );

-- ── Migration for projects created before the delete policy existed ──────────
-- Run this once in the SQL Editor if you set up the database earlier. It adds
-- the delete policy and clears duplicate rows already accumulated, keeping only
-- each video's most recent check.
--
-- create policy "app can delete" on public.opportunities for delete using (true);
--
-- delete from public.opportunities o
-- where o.checked_at < (
--   select max(o2.checked_at) from public.opportunities o2 where o2.video_url = o.video_url
-- );
