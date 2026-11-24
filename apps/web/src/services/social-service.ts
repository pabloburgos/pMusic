import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Track, UserProfile } from '@pmusic/core';

export const PUBLIC_WEB_BASE_URL = 'https://pmusic-olive.vercel.app';
const DEFAULT_SUPABASE_URL = 'https://zlaxnxkfwngmwqnqnqtu.supabase.co';
const DEFAULT_SUPABASE_KEY = 'sb_publishable_FksjG7J-ZnFPpsT07uLg3g_kzCzgBdJ';

let anonClient: SupabaseClient | null = null;
function getAnonClient(): SupabaseClient {
  if (!anonClient) {
    anonClient = createClient(DEFAULT_SUPABASE_URL, DEFAULT_SUPABASE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  }
  return anonClient;
}

export interface FriendRecord {
  id: string;
  requesterId: string;
  addresseeId: string;
  status: 'pending' | 'accepted' | 'declined';
  otherProfile: UserProfile;
  isIncoming: boolean;
}

export interface SharedPlaylistRecord {
  id: string;
  ownerId: string;
  name: string;
  description: string;
  coverUrl?: string | null;
  kind: 'collab' | 'blend';
  memberIds: string[];
  tracks: Track[];
  compatibilityScore?: number | null;
  updatedAt: string;
}

export interface JamSessionRecord {
  code: string;
  hostUserId: string;
  hostName: string;
  currentTrack: Track | null;
  queue: Track[];
  isPlaying: boolean;
  allowGuestDirectAdd: boolean;
  maxRequestsPerGuest: number;
  active: boolean;
  updatedAt: string;
}

export interface JamRequestRecord {
  id: string;
  jamCode: string;
  guestName: string;
  track: Track;
  status: 'approved' | 'pending' | 'rejected';
  createdAt: string;
}

export function generateJamCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 6; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

export function buildJamShareUrl(code: string): string {
  return `${PUBLIC_WEB_BASE_URL}/jam/${code.toUpperCase()}`;
}

export function buildJamQrImageUrl(code: string): string {
  const url = buildJamShareUrl(code);
  return `https://api.qrserver.com/v1/create-qr-code/?size=240x240&bgcolor=050507&color=FFFFFF&margin=12&data=${encodeURIComponent(url)}`;
}

// -----------------------------------------------------------------------------
// Friends (@username)
// -----------------------------------------------------------------------------
export async function searchProfilesByUsername(
  client: SupabaseClient,
  query: string,
  excludeUserId?: string | null
): Promise<UserProfile[]> {
  const clean = query.trim().toLowerCase().replace(/^@+/, '');
  if (clean.length < 2) return [];
  const { data, error } = await client
    .from('profiles')
    .select('user_id,username,display_name,avatar_url')
    .ilike('username', `%${clean}%`)
    .limit(12);
  if (error || !Array.isArray(data)) return [];
  return data
    .filter((row) => row.user_id !== excludeUserId)
    .map((row) => ({
      userId: String(row.user_id),
      username: String(row.username),
      displayName: String(row.display_name),
      avatarUrl: (row.avatar_url as string | null) ?? null,
    }));
}

export async function listFriendships(
  client: SupabaseClient,
  myUserId: string
): Promise<FriendRecord[]> {
  const { data, error } = await client
    .from('friendships')
    .select('id,requester_id,addressee_id,status')
    .or(`requester_id.eq.${myUserId},addressee_id.eq.${myUserId}`)
    .neq('status', 'declined')
    .order('updated_at', { ascending: false });
  if (error || !Array.isArray(data) || data.length === 0) return [];

  const otherIds = Array.from(
    new Set(
      data.map((r) => (r.requester_id === myUserId ? String(r.addressee_id) : String(r.requester_id)))
    )
  );
  const { data: profiles } = await client
    .from('profiles')
    .select('user_id,username,display_name,avatar_url')
    .in('user_id', otherIds);
  const profileMap = new Map<string, UserProfile>();
  for (const p of profiles ?? []) {
    profileMap.set(String(p.user_id), {
      userId: String(p.user_id),
      username: String(p.username),
      displayName: String(p.display_name),
      avatarUrl: (p.avatar_url as string | null) ?? null,
    });
  }

  return data.map((row) => {
    const otherId = row.requester_id === myUserId ? String(row.addressee_id) : String(row.requester_id);
    const otherProfile = profileMap.get(otherId) ?? {
      userId: otherId,
      username: 'usuario',
      displayName: 'Amigo pMusic',
      avatarUrl: null,
    };
    return {
      id: String(row.id),
      requesterId: String(row.requester_id),
      addresseeId: String(row.addressee_id),
      status: row.status as 'pending' | 'accepted' | 'declined',
      otherProfile,
      isIncoming: row.addressee_id === myUserId,
    };
  });
}

export async function sendFriendRequest(
  client: SupabaseClient,
  myUserId: string,
  targetUserId: string
): Promise<void> {
  const { error } = await client.from('friendships').upsert(
    {
      requester_id: myUserId,
      addressee_id: targetUserId,
      status: 'pending',
    },
    { onConflict: 'requester_id,addressee_id' }
  );
  if (error) throw new Error(error.message || 'No se pudo enviar la solicitud');
}

export async function respondFriendRequest(
  client: SupabaseClient,
  friendshipId: string,
  status: 'accepted' | 'declined'
): Promise<void> {
  const { error } = await client
    .from('friendships')
    .update({ status })
    .eq('id', friendshipId);
  if (error) throw new Error(error.message || 'No se pudo actualizar la solicitud');
}

// -----------------------------------------------------------------------------
// Shared / Collaborative Playlists & Blend
// -----------------------------------------------------------------------------
export async function listSharedPlaylists(
  client: SupabaseClient,
  myUserId: string
): Promise<SharedPlaylistRecord[]> {
  const { data, error } = await client
    .from('shared_playlists')
    .select('id,owner_id,name,description,cover_url,kind,member_ids,tracks,compatibility_score,updated_at')
    .or(`owner_id.eq.${myUserId},member_ids.cs.{${myUserId}}`)
    .order('updated_at', { ascending: false })
    .limit(40);
  if (error || !Array.isArray(data)) return [];
  return data.map((row) => ({
    id: String(row.id),
    ownerId: String(row.owner_id),
    name: String(row.name),
    description: String(row.description ?? ''),
    coverUrl: (row.cover_url as string | null) ?? null,
    kind: row.kind === 'blend' ? 'blend' : 'collab',
    memberIds: Array.isArray(row.member_ids) ? row.member_ids.map(String) : [],
    tracks: Array.isArray(row.tracks) ? (row.tracks as Track[]) : [],
    compatibilityScore: typeof row.compatibility_score === 'number' ? row.compatibility_score : null,
    updatedAt: String(row.updated_at ?? new Date().toISOString()),
  }));
}

export async function createSharedPlaylist(
  client: SupabaseClient,
  input: {
    ownerId: string;
    name: string;
    description?: string;
    kind: 'collab' | 'blend';
    memberIds: string[];
    tracks: Track[];
    compatibilityScore?: number | null;
  }
): Promise<SharedPlaylistRecord> {
  const members = Array.from(new Set([input.ownerId, ...input.memberIds]));
  const coverUrl = input.tracks[0]?.thumbnailHighUrl ?? input.tracks[0]?.thumbnailUrl ?? null;
  const { data, error } = await client
    .from('shared_playlists')
    .insert({
      owner_id: input.ownerId,
      name: input.name.trim().slice(0, 140),
      description: (input.description ?? '').trim().slice(0, 300),
      cover_url: coverUrl,
      kind: input.kind,
      member_ids: members,
      tracks: input.tracks.slice(0, 100),
      compatibility_score: input.compatibilityScore ?? null,
    })
    .select('id,owner_id,name,description,cover_url,kind,member_ids,tracks,compatibility_score,updated_at')
    .single();
  if (error || !data) {
    throw new Error(error?.message || 'No se pudo crear la playlist compartida');
  }
  return {
    id: String(data.id),
    ownerId: String(data.owner_id),
    name: String(data.name),
    description: String(data.description ?? ''),
    coverUrl: (data.cover_url as string | null) ?? null,
    kind: data.kind === 'blend' ? 'blend' : 'collab',
    memberIds: Array.isArray(data.member_ids) ? data.member_ids.map(String) : [],
    tracks: Array.isArray(data.tracks) ? (data.tracks as Track[]) : [],
    compatibilityScore: typeof data.compatibility_score === 'number' ? data.compatibility_score : null,
    updatedAt: String(data.updated_at ?? new Date().toISOString()),
  };
}

export async function addTrackToSharedPlaylist(
  client: SupabaseClient,
  playlist: SharedPlaylistRecord,
  track: Track
): Promise<SharedPlaylistRecord> {
  if (playlist.tracks.some((t) => t.id === track.id)) return playlist;
  const nextTracks = [...playlist.tracks, track].slice(0, 150);
  const coverUrl = playlist.coverUrl ?? track.thumbnailHighUrl ?? track.thumbnailUrl ?? null;
  const { error } = await client
    .from('shared_playlists')
    .update({ tracks: nextTracks, cover_url: coverUrl })
    .eq('id', playlist.id);
  if (error) throw new Error(error.message || 'No se pudo añadir la canción');
  return { ...playlist, tracks: nextTracks, coverUrl };
}

export function computeBlendScoreAndTracks(
  myTracks: Track[],
  friendLabel: string
): { score: number; tracks: Track[] } {
  const unique = Array.from(new Map(myTracks.map((t) => [t.id, t])).values()).slice(0, 24);
  let hash = 0;
  for (let i = 0; i < friendLabel.length; i++) {
    hash = (hash * 31 + friendLabel.charCodeAt(i)) % 1000;
  }
  const score = 74 + (hash % 24); // 74% - 97%
  return { score, tracks: unique };
}

// -----------------------------------------------------------------------------
// Live Jam Host & Public Web Guest Requests
// -----------------------------------------------------------------------------
export async function createJamSession(
  client: SupabaseClient,
  input: {
    hostUserId: string;
    hostName: string;
    currentTrack: Track | null;
    queue: Track[];
    isPlaying: boolean;
    allowGuestDirectAdd: boolean;
    maxRequestsPerGuest: number;
  }
): Promise<JamSessionRecord> {
  const code = generateJamCode();
  const { data, error } = await client
    .from('jam_sessions')
    .insert({
      code,
      host_user_id: input.hostUserId,
      host_name: input.hostName.trim().slice(0, 40) || 'pMusic',
      current_track: input.currentTrack,
      queue: input.queue.slice(0, 40),
      is_playing: input.isPlaying,
      allow_guest_direct_add: input.allowGuestDirectAdd,
      max_requests_per_guest: input.maxRequestsPerGuest,
      active: true,
    })
    .select('*')
    .single();
  if (error || !data) {
    throw new Error(error?.message || 'No se pudo iniciar la sala Jam (¿ejecutaste el nuevo schema.sql?)');
  }
  return mapJamRow(data);
}

export async function updateJamSessionState(
  client: SupabaseClient,
  code: string,
  patch: Partial<{
    currentTrack: Track | null;
    queue: Track[];
    isPlaying: boolean;
    allowGuestDirectAdd: boolean;
    maxRequestsPerGuest: number;
    active: boolean;
  }>
): Promise<void> {
  const payload: Record<string, unknown> = {};
  if (patch.currentTrack !== undefined) payload.current_track = patch.currentTrack;
  if (patch.queue !== undefined) payload.queue = patch.queue.slice(0, 40);
  if (patch.isPlaying !== undefined) payload.is_playing = patch.isPlaying;
  if (patch.allowGuestDirectAdd !== undefined) {
    payload.allow_guest_direct_add = patch.allowGuestDirectAdd;
  }
  if (patch.maxRequestsPerGuest !== undefined) {
    payload.max_requests_per_guest = patch.maxRequestsPerGuest;
  }
  if (patch.active !== undefined) payload.active = patch.active;
  await client.from('jam_sessions').update(payload).eq('code', code);
}

export async function fetchJamRequests(
  client: SupabaseClient,
  code: string
): Promise<JamRequestRecord[]> {
  const { data, error } = await client
    .from('jam_requests')
    .select('id,jam_code,guest_name,track_data,status,created_at')
    .eq('jam_code', code.toUpperCase())
    .order('created_at', { ascending: false })
    .limit(50);
  if (error || !Array.isArray(data)) return [];
  return data.map(mapJamRequestRow);
}

export async function updateJamRequestStatus(
  client: SupabaseClient,
  requestId: string,
  status: 'approved' | 'rejected'
): Promise<void> {
  await client.from('jam_requests').update({ status }).eq('id', requestId);
}

// Public anonymous endpoints for https://pmusic-olive.vercel.app/jam/:code
export async function fetchPublicJamSession(code: string): Promise<JamSessionRecord | null> {
  const sb = getAnonClient();
  const { data, error } = await sb
    .from('jam_sessions')
    .select('*')
    .eq('code', code.toUpperCase())
    .eq('active', true)
    .maybeSingle();
  if (error || !data) return null;
  return mapJamRow(data);
}

export async function fetchPublicJamRequests(code: string): Promise<JamRequestRecord[]> {
  return fetchJamRequests(getAnonClient(), code);
}

export async function submitPublicJamRequest(
  code: string,
  guestName: string,
  track: Track,
  directAdd: boolean
): Promise<JamRequestRecord> {
  const sb = getAnonClient();
  const { data, error } = await sb
    .from('jam_requests')
    .insert({
      jam_code: code.toUpperCase(),
      guest_name: guestName.trim().slice(0, 40) || 'Invitado',
      track_data: track,
      status: directAdd ? 'approved' : 'pending',
    })
    .select('id,jam_code,guest_name,track_data,status,created_at')
    .single();
  if (error || !data) {
    throw new Error(error?.message || 'No se pudo enviar tu petición');
  }
  return mapJamRequestRow(data);
}

export async function searchPublicCatalog(query: string): Promise<Track[]> {
  const q = query.trim();
  if (!q) return [];
  const res = await fetch(`/api/dz-proxy?path=${encodeURIComponent(`/search?q=${encodeURIComponent(q)}&limit=15`)}`);
  if (!res.ok) return [];
  const json = await res.json();
  const items = Array.isArray(json?.data) ? json.data : [];
  return items.map((item: any): Track => ({
    id: `dz:${item.id}`,
    title: String(item.title ?? 'Sin título'),
    artists: [{ id: `dz_art:${item.artist?.id ?? '0'}`, name: String(item.artist?.name ?? 'Artista') }],
    album: {
      id: `dz_alb:${item.album?.id ?? '0'}`,
      name: String(item.album?.title ?? ''),
    },
    durationSec: Number(item.duration ?? 180),
    thumbnailUrl: String(item.album?.cover_medium ?? item.album?.cover ?? ''),
    thumbnailHighUrl: String(item.album?.cover_xl ?? item.album?.cover_big ?? item.album?.cover_medium ?? ''),
    isExplicit: Boolean(item.explicit_lyrics),
    source: 'youtube',
  }));
}

function mapJamRow(row: any): JamSessionRecord {
  return {
    code: String(row.code),
    hostUserId: String(row.host_user_id),
    hostName: String(row.host_name ?? 'pMusic'),
    currentTrack: (row.current_track as Track | null) ?? null,
    queue: Array.isArray(row.queue) ? (row.queue as Track[]) : [],
    isPlaying: Boolean(row.is_playing),
    allowGuestDirectAdd: Boolean(row.allow_guest_direct_add ?? true),
    maxRequestsPerGuest: Number(row.max_requests_per_guest ?? 0),
    active: Boolean(row.active ?? true),
    updatedAt: String(row.updated_at ?? new Date().toISOString()),
  };
}

function mapJamRequestRow(row: any): JamRequestRecord {
  return {
    id: String(row.id),
    jamCode: String(row.jam_code),
    guestName: String(row.guest_name ?? 'Invitado'),
    track: row.track_data as Track,
    status: (row.status as 'approved' | 'pending' | 'rejected') ?? 'approved',
    createdAt: String(row.created_at ?? new Date().toISOString()),
  };
}
