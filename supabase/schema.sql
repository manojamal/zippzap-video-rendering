-- ============================================================================
-- ZippZap — Supabase schema (v2, idempotent / safe to re-run)
-- Run this in Supabase Studio → SQL Editor. Safe to paste and run multiple
-- times — every statement either uses IF NOT EXISTS, IF EXISTS, or a guard,
-- so re-running it after a partial failure won't error out like v1 could.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------- organizers (mirrors auth.users 1:1) ----------
create table if not exists public.organizers (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  tier text not null default 'free',
  points integer not null default 0,
  monthly_msg_count integer not null default 0,
  brand_logo_url text,
  brand_color text,
  created_at timestamptz not null default now()
);

-- ---------- campaigns ----------
create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  organizer_id uuid not null references public.organizers(id) on delete cascade,
  title text not null,
  occasion text,
  celebrant text,
  event_date date,
  emoji text,
  status text not null default 'active' check (status in ('active','delivered','pending')),
  invite_slug text not null unique default encode(gen_random_bytes(8), 'hex'),
  pipeline_stage integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists campaigns_organizer_idx on public.campaigns (organizer_id);
create index if not exists campaigns_slug_idx on public.campaigns (invite_slug);

-- ---------- invites / contributors ----------
create table if not exists public.invites (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  name text not null,
  contact text,
  method text check (method in ('WhatsApp','Email','SMS')),
  sent boolean not null default false,
  viewed boolean not null default false,
  responded boolean not null default false,
  allowed_upload boolean not null default true,
  is_muted boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists invites_campaign_idx on public.invites (campaign_id);

-- ---------- media_items (contributions) ----------
create table if not exists public.media_items (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  type text not null check (type in ('video','audio','text','photo')),
  from_name text not null,
  note text,
  text_body text,
  storage_path text,
  thumb_path text,
  duration numeric,
  size_bytes bigint,
  style text default 'gradient',
  approved boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists media_items_campaign_idx on public.media_items (campaign_id);
create index if not exists media_items_campaign_approved_idx on public.media_items (campaign_id, approved);

-- ---------- comments ----------
create table if not exists public.wish_comments (
  id uuid primary key default gen_random_uuid(),
  media_item_id uuid not null references public.media_items(id) on delete cascade,
  author text not null,
  text text not null,
  created_at timestamptz not null default now()
);

-- ---------- renders (final exported videos) ----------
create table if not exists public.renders (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  storage_path text not null,
  format text not null default 'mp4',
  resolution text,
  created_at timestamptz not null default now()
);

-- ============================================================================
-- Auto-create the organizer profile row via trigger, NOT from the client.
--
-- Why: supabase.auth.signUp() does not create an active session when email
-- confirmation is required (Supabase's default). A client-side insert into
-- organizers running immediately after signUp() would run as an anonymous
-- request — auth.uid() is null at that point — which the organizer_self RLS
-- policy correctly rejects. Running this as a SECURITY DEFINER trigger on
-- auth.users sidesteps the timing issue entirely.
-- ============================================================================
create or replace function public.handle_new_organizer()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.organizers (id, name, tier)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'tier', 'free')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_organizer();

-- ============================================================================
-- Row Level Security
-- ============================================================================
alter table public.organizers enable row level security;
alter table public.campaigns enable row level security;
alter table public.invites enable row level security;
alter table public.media_items enable row level security;
alter table public.wish_comments enable row level security;
alter table public.renders enable row level security;

-- Drop-then-create every policy so this script is safe to re-run without
-- "policy already exists" errors (the #1 cause of a v1 script half-failing).
drop policy if exists "organizer_self" on public.organizers;
create policy "organizer_self" on public.organizers
  for all using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "campaign_owner_all" on public.campaigns;
create policy "campaign_owner_all" on public.campaigns
  for all using (organizer_id = auth.uid()) with check (organizer_id = auth.uid());

-- REMOVED: "campaign_public_read_by_slug" used to grant `for select using (true)` -
-- i.e. it made every column of every organizer's campaign row (title, celebrant name,
-- event date, organizer_id, pipeline stage) readable by any client holding the public
-- anon key, completely unscoped by invite_slug despite the policy's name. Audited: no
-- code path in the app actually queries campaigns filtered by invite_slug (the
-- contributor portal is reached via eventId, not the slug), so this policy had zero
-- functional purpose. It also leaked into organizer-only queries like "fetch my own
-- campaigns" (campaignApi.ts), since Postgres combines multiple permissive SELECT
-- policies with OR - meaning even that legitimate, correctly-scoped query would have
-- returned every organizer's campaigns, not just the caller's own, for as long as this
-- policy existed alongside "campaign_owner_all" below. If a real public-by-link lookup
-- is added later, scope it narrowly - e.g. a SECURITY DEFINER RPC function that takes
-- the slug as a parameter and returns only the specific matching row (the same pattern
-- already used for handle_new_organizer above), not a blanket table-wide SELECT policy.
drop policy if exists "campaign_public_read_by_slug" on public.campaigns;

drop policy if exists "invite_owner_all" on public.invites;
create policy "invite_owner_all" on public.invites
  for all using (
    campaign_id in (select id from public.campaigns where organizer_id = auth.uid())
  ) with check (
    campaign_id in (select id from public.campaigns where organizer_id = auth.uid())
  );

drop policy if exists "media_owner_all" on public.media_items;
create policy "media_owner_all" on public.media_items
  for all using (
    campaign_id in (select id from public.campaigns where organizer_id = auth.uid())
  );

drop policy if exists "media_anon_insert_active_campaign" on public.media_items;
create policy "media_anon_insert_active_campaign" on public.media_items
  for insert to anon with check (
    campaign_id in (select id from public.campaigns where status = 'active')
  );

-- Contributors are also allowed to insert via a logged-in (authenticated) session
-- if you ever add contributor accounts later — harmless to include now.
drop policy if exists "media_authenticated_insert_active_campaign" on public.media_items;
create policy "media_authenticated_insert_active_campaign" on public.media_items
  for insert to authenticated with check (
    campaign_id in (select id from public.campaigns where status = 'active')
  );

drop policy if exists "comments_owner_all" on public.wish_comments;
create policy "comments_owner_all" on public.wish_comments
  for all using (
    media_item_id in (
      select mi.id from public.media_items mi
      join public.campaigns c on c.id = mi.campaign_id
      where c.organizer_id = auth.uid()
    )
  );

drop policy if exists "renders_owner_all" on public.renders;
create policy "renders_owner_all" on public.renders
  for all using (
    campaign_id in (select id from public.campaigns where organizer_id = auth.uid())
  );

-- ============================================================================
-- Storage buckets
-- ============================================================================
insert into storage.buckets (id, name, public)
  values ('media', 'media', false)
  on conflict (id) do nothing;
insert into storage.buckets (id, name, public)
  values ('renders', 'renders', true)
  on conflict (id) do nothing;

drop policy if exists "media_anon_upload" on storage.objects;
create policy "media_anon_upload" on storage.objects
  for insert to anon with check (bucket_id = 'media');

drop policy if exists "media_authenticated_upload" on storage.objects;
create policy "media_authenticated_upload" on storage.objects
  for insert to authenticated with check (bucket_id = 'media');

drop policy if exists "media_owner_read" on storage.objects;
create policy "media_owner_read" on storage.objects
  for select using (
    bucket_id = 'media'
    and (storage.foldername(name))[1]::uuid in (
      select id from public.campaigns where organizer_id = auth.uid()
    )
  );

drop policy if exists "renders_owner_write" on storage.objects;
create policy "renders_owner_write" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'renders'
    and (storage.foldername(name))[1]::uuid in (
      select id from public.campaigns where organizer_id = auth.uid()
    )
  );

drop policy if exists "renders_public_read" on storage.objects;
create policy "renders_public_read" on storage.objects
  for select using (bucket_id = 'renders');

-- ============================================================================
-- Realtime — guarded so re-running this doesn't error with
-- "relation is already member of publication"
-- ============================================================================
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'media_items'
  ) then
    alter publication supabase_realtime add table public.media_items;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'invites'
  ) then
    alter publication supabase_realtime add table public.invites;
  end if;
end $$;

-- ============================================================================
-- IMPORTANT MANUAL STEP — this SQL alone does not fully enable Realtime.
-- Go to: Supabase Dashboard → Database → Replication → supabase_realtime
-- and make sure media_items (and invites, if you want live invite status too)
-- have the toggle switched ON. The "alter publication" above is necessary but
-- Supabase's UI toggle is what actually activates delivery in some project
-- configurations — if rows insert fine but never arrive over the Realtime
-- channel, this toggle is almost always why.
-- ============================================================================
