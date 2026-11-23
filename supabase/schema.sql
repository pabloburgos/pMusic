-- =============================================================================
-- pMusic — Esquema SQL Completo e Idempotente para Supabase (Free Tier)
-- Tablas: playlists, playlist_tracks, liked_tracks, play_history,
--         artist_affinity, device_sessions
-- Incluye: Row Level Security (RLS), REPLICA IDENTITY FULL y Supabase Realtime
-- =============================================================================

create extension if not exists "pgcrypto";

-- Función para actualizar automáticamente updated_at
create or replace function public.pmusic_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- 1. public.playlists
-- -----------------------------------------------------------------------------
create table if not exists public.playlists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 140),
  description text not null default '',
  cover_url text,
  source text not null default 'local' check (source in ('local', 'imported_spotify', 'imported_youtube', 'mix')),
  source_url text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_playlists_user_updated
  on public.playlists (user_id, updated_at desc);

drop trigger if exists trg_playlists_updated_at on public.playlists;
create trigger trg_playlists_updated_at
  before update on public.playlists
  for each row execute function public.pmusic_set_updated_at();

alter table public.playlists replica identity full;
alter table public.playlists enable row level security;

drop policy if exists "playlists_owner_all" on public.playlists;
create policy "playlists_owner_all"
  on public.playlists
  for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- -----------------------------------------------------------------------------
-- 2. public.playlist_tracks
-- -----------------------------------------------------------------------------
create table if not exists public.playlist_tracks (
  id uuid primary key default gen_random_uuid(),
  playlist_id uuid not null references public.playlists(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  track_id text not null,
  position integer not null default 0 check (position >= 0),
  track_data jsonb not null,
  added_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (playlist_id, track_id)
);

create index if not exists idx_playlist_tracks_playlist_pos
  on public.playlist_tracks (playlist_id, position asc);

create index if not exists idx_playlist_tracks_user_updated
  on public.playlist_tracks (user_id, updated_at desc);

drop trigger if exists trg_playlist_tracks_updated_at on public.playlist_tracks;
create trigger trg_playlist_tracks_updated_at
  before update on public.playlist_tracks
  for each row execute function public.pmusic_set_updated_at();

alter table public.playlist_tracks replica identity full;
alter table public.playlist_tracks enable row level security;

drop policy if exists "playlist_tracks_owner_all" on public.playlist_tracks;
create policy "playlist_tracks_owner_all"
  on public.playlist_tracks
  for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- -----------------------------------------------------------------------------
-- 3. public.liked_tracks
-- -----------------------------------------------------------------------------
create table if not exists public.liked_tracks (
  user_id uuid not null references auth.users(id) on delete cascade,
  track_id text not null,
  track_data jsonb not null,
  liked_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (user_id, track_id)
);

create index if not exists idx_liked_tracks_user_liked
  on public.liked_tracks (user_id, liked_at desc);

drop trigger if exists trg_liked_tracks_updated_at on public.liked_tracks;
create trigger trg_liked_tracks_updated_at
  before update on public.liked_tracks
  for each row execute function public.pmusic_set_updated_at();

alter table public.liked_tracks replica identity full;
alter table public.liked_tracks enable row level security;

drop policy if exists "liked_tracks_owner_all" on public.liked_tracks;
create policy "liked_tracks_owner_all"
  on public.liked_tracks
  for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- -----------------------------------------------------------------------------
-- 4. public.play_history
-- -----------------------------------------------------------------------------
create table if not exists public.play_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  track_id text not null,
  track_data jsonb not null,
  played_sec numeric(8,2) not null default 0 check (played_sec >= 0),
  completion_ratio numeric(4,3) not null default 0 check (completion_ratio between 0 and 1.5),
  signal_type text not null check (signal_type in ('play', 'skip_early', 'complete_listen', 'repeat_loop', 'like', 'add_to_playlist', 'unlike')),
  device_id text,
  played_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_play_history_user_played
  on public.play_history (user_id, played_at desc);

alter table public.play_history
  add column if not exists genre text,
  add column if not exists artist_name text,
  add column if not exists hour_of_day smallint check (hour_of_day between 0 and 23),
  add column if not exists day_of_week smallint check (day_of_week between 0 and 6),
  add column if not exists source_context text not null default 'library',
  add column if not exists is_repeat_loop boolean not null default false;

alter table public.play_history enable row level security;

drop policy if exists "play_history_owner_all" on public.play_history;
create policy "play_history_owner_all"
  on public.play_history
  for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- -----------------------------------------------------------------------------
-- 5. public.artist_affinity
-- -----------------------------------------------------------------------------
create table if not exists public.artist_affinity (
  user_id uuid not null references auth.users(id) on delete cascade,
  artist_key text not null,
  artist_name text not null,
  artist_id text,
  score numeric(8,3) not null default 0 check (score between -20 and 200),
  genres text[] not null default '{}',
  play_count integer not null default 0 check (play_count >= 0),
  skip_count integer not null default 0 check (skip_count >= 0),
  is_seed boolean not null default false,
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (user_id, artist_key)
);

create index if not exists idx_artist_affinity_user_score
  on public.artist_affinity (user_id, score desc);

drop trigger if exists trg_artist_affinity_updated_at on public.artist_affinity;
create trigger trg_artist_affinity_updated_at
  before update on public.artist_affinity
  for each row execute function public.pmusic_set_updated_at();

alter table public.artist_affinity replica identity full;
alter table public.artist_affinity enable row level security;

drop policy if exists "artist_affinity_owner_all" on public.artist_affinity;
create policy "artist_affinity_owner_all"
  on public.artist_affinity
  for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- -----------------------------------------------------------------------------
-- 6. public.device_sessions
-- -----------------------------------------------------------------------------
create table if not exists public.device_sessions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  active_device_id text not null,
  active_device_name text not null,
  active_platform text not null check (active_platform in ('windows', 'android', 'web')),
  track_data jsonb,
  queue_data jsonb not null default '[]'::jsonb,
  queue_index integer not null default 0 check (queue_index >= 0),
  position_ms bigint not null default 0 check (position_ms >= 0),
  is_playing boolean not null default false,
  volume numeric(4,3) not null default 0.85 check (volume between 0 and 1),
  dj_mode_enabled boolean not null default false,
  dj_session_style text not null default 'quick' check (dj_session_style in ('quick', 'full')),
  updated_at timestamptz not null default timezone('utc', now())
);

drop trigger if exists trg_device_sessions_updated_at on public.device_sessions;
create trigger trg_device_sessions_updated_at
  before update on public.device_sessions
  for each row execute function public.pmusic_set_updated_at();

alter table public.device_sessions replica identity full;
alter table public.device_sessions enable row level security;

drop policy if exists "device_sessions_owner_all" on public.device_sessions;
create policy "device_sessions_owner_all"
  on public.device_sessions
  for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- -----------------------------------------------------------------------------
-- 7. public.profiles (Perfiles @usuario para cuenta, Blend y Jam)
-- -----------------------------------------------------------------------------
create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9._]{3,24}$'),
  display_name text not null check (char_length(trim(display_name)) between 1 and 60),
  avatar_url text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_profiles_username_lower
  on public.profiles (lower(username));

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute function public.pmusic_set_updated_at();

alter table public.profiles enable row level security;

drop policy if exists "profiles_select_authenticated" on public.profiles;
create policy "profiles_select_authenticated"
  on public.profiles
  for select
  to authenticated
  using (true);

drop policy if exists "profiles_owner_write" on public.profiles;
create policy "profiles_owner_write"
  on public.profiles
  for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- -----------------------------------------------------------------------------
-- 8. Publicación en Supabase Realtime (Idempotente)
-- -----------------------------------------------------------------------------
do $$
declare
  tbl text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach tbl in array array['playlists', 'playlist_tracks', 'liked_tracks', 'artist_affinity', 'device_sessions', 'profiles']
    loop
      if not exists (
        select 1
        from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = tbl
      ) then
        execute format('alter publication supabase_realtime add table public.%I', tbl);
      end if;
    end loop;
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 9. Permisos explícitos para roles authenticated y service_role (Idempotente)
-- -----------------------------------------------------------------------------
grant usage on schema public to anon, authenticated, service_role;
grant all on table
  public.profiles,
  public.playlists,
  public.playlist_tracks,
  public.liked_tracks,
  public.play_history,
  public.artist_affinity,
  public.device_sessions
  to authenticated, service_role;
