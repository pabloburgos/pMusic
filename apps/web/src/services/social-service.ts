import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Track, UserProfile } from '@pmusic/core';

export const PUBLIC_WEB_BASE_URL = 'https://pmusic-olive.vercel.app';
const DEFAULT_SUPABASE_URL = 'https://zlaxnxkfwngmwqnqnqtu.supabase.co';
const DEFAULT_SUPABASE_KEY = 'sb_publishable_FksjG7J-ZnFPpsT07uLg3g_kzCzgBdJ';

let anonClient: SupabaseClient | null = null;
export function getAnonSupabaseClient(): SupabaseClient {
  if (!anonClient) {
    anonClient = createClient(DEFAULT_SUPABASE_URL, DEFAULT_SUPABASE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  }
  return anonClient;
}
function getAnonClient(): SupabaseClient {
  return getAnonSupabaseClient();
}

export interface TrackAdderIdentity {
  userId?: string;
  username?: string;
  displayName: string;
  avatarUrl?: string | null;
}

export function stampTrackAddedBy(
  track: Track,
  identity?: TrackAdderIdentity | null
): Track {
  if (!identity?.displayName && !identity?.username) return track;
  return {
    ...track,
    addedBy: {
      userId: identity.userId,
      username: identity.username,
      displayName: identity.displayName || (identity.username ? `@${identity.username}` : 'Colaborador'),
      avatarUrl: identity.avatarUrl ?? null,
      addedAt: new Date().toISOString(),
    },
  };
}

export interface FriendRecord {
  id: string;
  requesterId: string;
  addresseeId: string;
  status: 'pending' | 'accepted' | 'declined';
  otherProfile: UserProfile;
  isIncoming: boolean;
}

export interface FriendListeningActivity {
  userId: string;
  username?: string;
  displayName?: string;
  avatarUrl?: string | null;
  trackId: string;
  trackTitle: string;
  trackArtist: string;
  thumbnailUrl?: string;
  isPlaying: boolean;
  updatedAt: string;
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
  shareCode?: string | null;
  isPublicLink?: boolean;
  allowLinkEdit?: boolean;
  updatedAt: string;
}

export interface JamHostSyncMeta {
  positionSec: number;
  updatedAtMs: number;
  isPlaying: boolean;
  djEnabled: boolean;
  crossfadeEnabled: boolean;
  crossfadeSec: number;
  eqEnabled: boolean;
  eqPreset: string;
  allowGuestPlaybackControls?: boolean;
}

export interface JamQueueOpPayload {
  __jamOp: 'move' | 'remove' | 'add_next' | 'toggle_play' | 'next' | 'prev' | 'seek';
  targetTrackId: string;
  toUpNextIndex?: number;
  seekSec?: number;
  track?: Track;
}

export interface JamSessionRecord {
  code: string;
  hostUserId: string;
  hostName: string;
  currentTrack: Track | null;
  queue: Track[];
  isPlaying: boolean;
  allowGuestDirectAdd: boolean;
  allowGuestPlaybackControls?: boolean;
  maxRequestsPerGuest: number;
  active: boolean;
  updatedAt: string;
}

export function extractJamSyncMeta(session: JamSessionRecord | null | undefined): JamHostSyncMeta | null {
  if (!session?.currentTrack) return null;
  const raw = (session.currentTrack as Track & { __jamSync?: Partial<JamHostSyncMeta> }).__jamSync;
  if (!raw || typeof raw !== 'object') return null;
  return {
    positionSec: typeof raw.positionSec === 'number' && Number.isFinite(raw.positionSec) ? Math.max(0, raw.positionSec) : 0,
    updatedAtMs: typeof raw.updatedAtMs === 'number' && Number.isFinite(raw.updatedAtMs) ? raw.updatedAtMs : Date.now(),
    isPlaying: Boolean(raw.isPlaying ?? session.isPlaying),
    djEnabled: Boolean(raw.djEnabled),
    crossfadeEnabled: Boolean(raw.crossfadeEnabled),
    crossfadeSec: typeof raw.crossfadeSec === 'number' && Number.isFinite(raw.crossfadeSec) ? raw.crossfadeSec : 4,
    eqEnabled: Boolean(raw.eqEnabled),
    eqPreset: typeof raw.eqPreset === 'string' && raw.eqPreset ? raw.eqPreset : 'flat',
    allowGuestPlaybackControls:
      typeof raw.allowGuestPlaybackControls === 'boolean' ? raw.allowGuestPlaybackControls : false,
  };
}

export function isJamQueueOpRequest(req: JamRequestRecord | null | undefined): boolean {
  if (!req?.track) return false;
  return Boolean((req.track as unknown as { __jamOp?: string }).__jamOp);
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

export function generateShareCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 8; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

export function buildPlaylistShareUrl(shareCode: string): string {
  return `${PUBLIC_WEB_BASE_URL}/?playlist=${encodeURIComponent(shareCode.toUpperCase())}`;
}

export function buildJamShareUrl(code: string): string {
  return `${PUBLIC_WEB_BASE_URL}/jam/${code.toUpperCase()}`;
}

export function buildJamShareMessage(hostName: string | undefined | null, code: string): string {
  const cleanHost = (hostName ?? '').trim();
  const cleanCode = code.trim().toUpperCase();
  const url = buildJamShareUrl(cleanCode);
  return cleanHost
    ? `Únete a la Jam de ${cleanHost} en pMusic y pon canciones en la cola en directo (${cleanCode}): ${url}`
    : `Únete a esta Jam en pMusic y pon canciones en la cola en directo (${cleanCode}): ${url}`;
}

export function buildJamWhatsAppUrl(hostName: string | undefined | null, code: string): string {
  const msg = buildJamShareMessage(hostName, code);
  return `https://wa.me/?text=${encodeURIComponent(msg)}`;
}

export function buildJamTelegramUrl(hostName: string | undefined | null, code: string): string {
  const cleanCode = code.trim().toUpperCase();
  const url = buildJamShareUrl(cleanCode);
  const cleanHost = (hostName ?? '').trim();
  const text = cleanHost
    ? `Únete a la Jam de ${cleanHost} en pMusic (${cleanCode})`
    : `Únete a esta Jam en pMusic (${cleanCode})`;
  return `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
}

export function buildJamQrImageUrl(code: string): string {
  const url = buildJamShareUrl(code);
  return `https://api.qrserver.com/v1/create-qr-code/?size=240x240&bgcolor=050507&color=FFFFFF&margin=12&data=${encodeURIComponent(url)}`;
}

function formatSocialError(err: { message?: string; code?: string } | null | undefined, fallback: string): string {
  const msg = err?.message ?? '';
  if (
    err?.code === 'PGRST205' ||
    err?.code === '42P01' ||
    msg.includes('Could not find the table') ||
    msg.includes('does not exist')
  ) {
    return 'Faltan las tablas sociales en Supabase. Ejecuta el script SQL actualizado en Supabase → SQL Editor.';
  }
  return msg || fallback;
}

export async function ensureOwnProfileExists(
  client: SupabaseClient,
  input: { userId: string; email?: string | null; displayName?: string | null; avatarUrl?: string | null }
): Promise<UserProfile | null> {
  try {
    const { data: existing } = await client
      .from('profiles')
      .select('user_id,username,display_name,avatar_url')
      .eq('user_id', input.userId)
      .maybeSingle();
    if (existing) {
      return {
        userId: String(existing.user_id),
        username: String(existing.username),
        displayName: String(existing.display_name),
        avatarUrl: (existing.avatar_url as string | null) ?? null,
      };
    }
    const baseName =
      (input.email?.split('@')[0] ?? input.displayName ?? 'usuario')
        .toLowerCase()
        .replace(/[^a-z0-9._]/g, '_')
        .slice(0, 16) || 'pmusic';
    const candidateUsername = `${baseName.length >= 3 ? baseName : 'pm'}_${input.userId.slice(0, 4)}`.toLowerCase();
    const display = (input.displayName || input.email?.split('@')[0] || 'Usuario pMusic').slice(0, 50);
    const { data: inserted } = await client
      .from('profiles')
      .upsert(
        {
          user_id: input.userId,
          username: candidateUsername,
          display_name: display,
          avatar_url: input.avatarUrl ?? null,
        },
        { onConflict: 'user_id' }
      )
      .select('user_id,username,display_name,avatar_url')
      .maybeSingle();
    if (!inserted) return null;
    return {
      userId: String(inserted.user_id),
      username: String(inserted.username),
      displayName: String(inserted.display_name),
      avatarUrl: (inserted.avatar_url as string | null) ?? null,
    };
  } catch {
    return null;
  }
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
    .or(`username.ilike.%${clean}%,display_name.ilike.%${clean}%`)
    .limit(12);
  if (error) {
    throw new Error(formatSocialError(error, 'No se pudieron buscar usuarios'));
  }
  if (!Array.isArray(data)) return [];
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
  if (error) throw new Error(formatSocialError(error, 'No se pudo enviar la solicitud'));
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
  if (error) throw new Error(formatSocialError(error, 'No se pudo actualizar la solicitud'));
}

// -----------------------------------------------------------------------------
// Shared / Collaborative Playlists & Blend
// -----------------------------------------------------------------------------
function mapSharedPlaylistRow(row: any): SharedPlaylistRecord {
  return {
    id: String(row.id),
    ownerId: String(row.owner_id),
    name: String(row.name),
    description: String(row.description ?? ''),
    coverUrl: (row.cover_url as string | null) ?? null,
    kind: row.kind === 'blend' ? 'blend' : 'collab',
    memberIds: Array.isArray(row.member_ids) ? row.member_ids.map(String) : [],
    tracks: Array.isArray(row.tracks) ? (row.tracks as Track[]) : [],
    compatibilityScore: typeof row.compatibility_score === 'number' ? row.compatibility_score : null,
    shareCode: (row.share_code as string | null) ?? null,
    isPublicLink: Boolean(row.is_public_link ?? false),
    allowLinkEdit: Boolean(row.allow_link_edit ?? false),
    updatedAt: String(row.updated_at ?? new Date().toISOString()),
  };
}

const SHARED_PLAYLIST_SELECT =
  'id,owner_id,name,description,cover_url,kind,member_ids,tracks,compatibility_score,share_code,is_public_link,allow_link_edit,updated_at';

export async function listSharedPlaylists(
  client: SupabaseClient,
  myUserId: string
): Promise<SharedPlaylistRecord[]> {
  const { data, error } = await client
    .from('shared_playlists')
    .select(SHARED_PLAYLIST_SELECT)
    .or(`owner_id.eq.${myUserId},member_ids.cs.{${myUserId}}`)
    .order('updated_at', { ascending: false })
    .limit(40);
  if (error || !Array.isArray(data)) return [];
  return data.map(mapSharedPlaylistRow);
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
    isPublicLink?: boolean;
    allowLinkEdit?: boolean;
    shareCode?: string | null;
    ownerProfile?: UserProfile | null;
  }
): Promise<SharedPlaylistRecord> {
  const members = Array.from(new Set([input.ownerId, ...input.memberIds]));
  const coverUrl = input.tracks[0]?.thumbnailHighUrl ?? input.tracks[0]?.thumbnailUrl ?? null;
  const shareCode = input.shareCode ?? generateShareCode();
  const stampedTracks = input.tracks.slice(0, 150).map((t) =>
    t.addedBy || !input.ownerProfile
      ? t
      : {
          ...t,
          addedBy: {
            userId: input.ownerProfile.userId,
            username: input.ownerProfile.username,
            displayName: input.ownerProfile.displayName,
            avatarUrl: input.ownerProfile.avatarUrl ?? null,
            addedAt: new Date().toISOString(),
          },
        }
  );
  const { data, error } = await client
    .from('shared_playlists')
    .insert({
      owner_id: input.ownerId,
      name: input.name.trim().slice(0, 140),
      description: (input.description ?? '').trim().slice(0, 300),
      cover_url: coverUrl,
      kind: input.kind,
      member_ids: members,
      tracks: stampedTracks,
      compatibility_score: input.compatibilityScore ?? null,
      share_code: shareCode,
      is_public_link: input.isPublicLink ?? true,
      allow_link_edit: input.allowLinkEdit ?? input.kind === 'collab',
    })
    .select(SHARED_PLAYLIST_SELECT)
    .single();
  if (error || !data) {
    throw new Error(formatSocialError(error, 'No se pudo crear la playlist compartida'));
  }
  return mapSharedPlaylistRow(data);
}

export async function publishOrUpdateSharedPlaylistLink(
  client: SupabaseClient,
  input: {
    ownerId: string;
    name: string;
    description?: string;
    tracks: Track[];
    isCollaborative: boolean;
    existingShareCode?: string | null;
    ownerProfile?: UserProfile | null;
  }
): Promise<SharedPlaylistRecord> {
  const shareCode = (input.existingShareCode || generateShareCode()).toUpperCase();
  const stampedTracks = input.tracks.slice(0, 150).map((t) =>
    t.addedBy || !input.ownerProfile
      ? t
      : {
          ...t,
          addedBy: {
            userId: input.ownerProfile.userId,
            username: input.ownerProfile.username,
            displayName: input.ownerProfile.displayName,
            avatarUrl: input.ownerProfile.avatarUrl ?? null,
            addedAt: new Date().toISOString(),
          },
        }
  );
  const coverUrl = stampedTracks[0]?.thumbnailHighUrl ?? stampedTracks[0]?.thumbnailUrl ?? null;

  const { data: existing } = await client
    .from('shared_playlists')
    .select(SHARED_PLAYLIST_SELECT)
    .eq('share_code', shareCode)
    .maybeSingle();

  if (existing) {
    const existingRec = mapSharedPlaylistRow(existing);
    // Preserve tracks added by other collaborators while merging owner updates
    const byId = new Map<string, Track>();
    for (const t of stampedTracks) byId.set(t.id, t);
    for (const rt of existingRec.tracks) {
      if (!byId.has(rt.id) && rt.addedBy?.userId && rt.addedBy.userId !== input.ownerId) {
        byId.set(rt.id, rt);
      }
    }
    const mergedTracks = Array.from(byId.values()).slice(0, 150);
    const { data, error } = await client
      .from('shared_playlists')
      .update({
        name: input.name.trim().slice(0, 140),
        description: (input.description ?? '').trim().slice(0, 300),
        cover_url: coverUrl,
        tracks: mergedTracks,
        is_public_link: true,
        allow_link_edit: input.isCollaborative,
      })
      .eq('id', existingRec.id)
      .select(SHARED_PLAYLIST_SELECT)
      .single();
    if (error || !data) {
      throw new Error(formatSocialError(error, 'No se pudo actualizar el enlace de la playlist'));
    }
    return mapSharedPlaylistRow(data);
  }

  return createSharedPlaylist(client, {
    ownerId: input.ownerId,
    name: input.name,
    description: input.description,
    kind: 'collab',
    memberIds: [input.ownerId],
    tracks: stampedTracks,
    isPublicLink: true,
    allowLinkEdit: input.isCollaborative,
    shareCode,
    ownerProfile: input.ownerProfile,
  });
}

export async function fetchSharedPlaylistByCode(
  code: string,
  client?: SupabaseClient | null
): Promise<SharedPlaylistRecord | null> {
  const cleanCode = code.trim().toUpperCase();
  if (!cleanCode) return null;
  const sb = client ?? getAnonClient();
  const { data, error } = await sb
    .from('shared_playlists')
    .select(SHARED_PLAYLIST_SELECT)
    .eq('share_code', cleanCode)
    .maybeSingle();
  if (error || !data) return null;
  return mapSharedPlaylistRow(data);
}

export async function joinSharedPlaylistByCode(
  client: SupabaseClient,
  playlist: SharedPlaylistRecord,
  myUserId: string
): Promise<SharedPlaylistRecord> {
  if (!playlist.allowLinkEdit) return playlist;
  if (playlist.ownerId === myUserId || playlist.memberIds.includes(myUserId)) return playlist;
  const nextMembers = Array.from(new Set([...playlist.memberIds, myUserId]));
  const { data, error } = await client
    .from('shared_playlists')
    .update({ member_ids: nextMembers })
    .eq('id', playlist.id)
    .select(SHARED_PLAYLIST_SELECT)
    .single();
  if (error || !data) {
    return { ...playlist, memberIds: nextMembers };
  }
  return mapSharedPlaylistRow(data);
}

export async function addTrackToSharedPlaylist(
  client: SupabaseClient,
  playlist: SharedPlaylistRecord,
  track: Track,
  adderProfile?: { userId?: string; username?: string; displayName?: string; avatarUrl?: string | null } | null
): Promise<SharedPlaylistRecord> {
  if (playlist.tracks.some((t) => t.id === track.id)) return playlist;
  const enrichedTrack: Track = {
    ...track,
    addedBy: {
      userId: adderProfile?.userId,
      username: adderProfile?.username,
      displayName: adderProfile?.displayName || adderProfile?.username || 'Colaborador',
      avatarUrl: adderProfile?.avatarUrl ?? null,
      addedAt: new Date().toISOString(),
    },
  };
  const nextTracks = [...playlist.tracks, enrichedTrack].slice(0, 150);
  const coverUrl = playlist.coverUrl ?? track.thumbnailHighUrl ?? track.thumbnailUrl ?? null;
  const nextMembers =
    adderProfile?.userId && !playlist.memberIds.includes(adderProfile.userId)
      ? [...playlist.memberIds, adderProfile.userId]
      : playlist.memberIds;
  const { error } = await client
    .from('shared_playlists')
    .update({ tracks: nextTracks, cover_url: coverUrl, member_ids: nextMembers })
    .eq('id', playlist.id);
  if (error) throw new Error(formatSocialError(error, 'No se pudo añadir la canción'));
  return { ...playlist, tracks: nextTracks, coverUrl, memberIds: nextMembers };
}

export async function removeTrackFromSharedPlaylist(
  client: SupabaseClient,
  playlist: SharedPlaylistRecord,
  trackId: string
): Promise<SharedPlaylistRecord> {
  const nextTracks = playlist.tracks.filter((t) => t.id !== trackId);
  const coverUrl = nextTracks[0]?.thumbnailHighUrl ?? nextTracks[0]?.thumbnailUrl ?? null;
  const { error } = await client
    .from('shared_playlists')
    .update({ tracks: nextTracks, cover_url: coverUrl })
    .eq('id', playlist.id);
  if (error) throw new Error(formatSocialError(error, 'No se pudo quitar la canción'));
  return { ...playlist, tracks: nextTracks, coverUrl };
}

export async function inviteMemberToSharedPlaylist(
  client: SupabaseClient,
  playlist: SharedPlaylistRecord,
  targetUserId: string
): Promise<SharedPlaylistRecord> {
  if (playlist.ownerId === targetUserId || playlist.memberIds.includes(targetUserId)) {
    return playlist;
  }
  const nextMembers = Array.from(new Set([...playlist.memberIds, targetUserId]));
  const { data, error } = await client
    .from('shared_playlists')
    .update({ member_ids: nextMembers })
    .eq('id', playlist.id)
    .select(SHARED_PLAYLIST_SELECT)
    .single();
  if (error) throw new Error(formatSocialError(error, 'No se pudo invitar al amigo'));
  return data ? mapSharedPlaylistRow(data) : { ...playlist, memberIds: nextMembers };
}

export async function deleteOrLeaveSharedPlaylist(
  client: SupabaseClient,
  playlist: SharedPlaylistRecord,
  myUserId: string
): Promise<'deleted' | 'left'> {
  if (playlist.ownerId === myUserId) {
    const { error } = await client
      .from('shared_playlists')
      .delete()
      .eq('id', playlist.id);
    if (error) throw new Error(formatSocialError(error, 'No se pudo eliminar la playlist'));
    return 'deleted';
  }
  const nextMembers = playlist.memberIds.filter((id) => id !== myUserId);
  const { error } = await client
    .from('shared_playlists')
    .update({ member_ids: nextMembers })
    .eq('id', playlist.id);
  if (error) throw new Error(formatSocialError(error, 'No se pudo salir de la playlist'));
  return 'left';
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
    throw new Error(formatSocialError(error, 'No se pudo iniciar la sala Jam'));
  }
  return mapJamRow(data);
}

export async function fetchActiveHostJamSession(
  client: SupabaseClient,
  hostUserId: string
): Promise<JamSessionRecord | null> {
  const { data, error } = await client
    .from('jam_sessions')
    .select('*')
    .eq('host_user_id', hostUserId)
    .eq('active', true)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
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
  directAdd: boolean,
  guestIdentity?: TrackAdderIdentity | null
): Promise<JamRequestRecord> {
  const sb = getAnonClient();
  const cleanGuestName = guestName.trim().slice(0, 40) || 'Invitado';
  const stampedTrack = stampTrackAddedBy(
    track,
    guestIdentity ?? {
      displayName: cleanGuestName,
      avatarUrl: track.addedBy?.avatarUrl ?? null,
    }
  );
  const { data, error } = await sb
    .from('jam_requests')
    .insert({
      jam_code: code.toUpperCase(),
      guest_name: cleanGuestName,
      track_data: stampedTrack,
      status: directAdd ? 'approved' : 'pending',
    })
    .select('id,jam_code,guest_name,track_data,status,created_at')
    .single();
  if (error || !data) {
    throw new Error(error?.message || 'No se pudo enviar tu petición');
  }
  return mapJamRequestRow(data);
}

export async function submitPublicJamQueueOp(
  code: string,
  guestName: string,
  op: JamQueueOpPayload
): Promise<void> {
  const sb = getAnonClient();
  const cleanGuestName = guestName.trim().slice(0, 40) || 'Invitado';
  const payload = {
    id: `__jam_op__:${op.__jamOp}:${op.targetTrackId}:${Date.now()}`,
    title: op.track?.title ?? op.__jamOp,
    artists: op.track?.artists ?? [],
    durationSec: op.track?.durationSec ?? 0,
    thumbnailUrl: op.track?.thumbnailUrl ?? '',
    source: 'youtube',
    ...op,
  };
  await sb.from('jam_requests').insert({
    jam_code: code.toUpperCase(),
    guest_name: cleanGuestName,
    track_data: payload,
    status: 'approved',
  });
}

export async function submitPublicJamPlaybackOp(
  code: string,
  guestName: string,
  op: 'toggle_play' | 'next' | 'prev' | 'seek',
  seekSec?: number
): Promise<void> {
  return submitPublicJamQueueOp(code, guestName, {
    __jamOp: op,
    targetTrackId: op,
    ...(typeof seekSec === 'number' ? { seekSec } : {}),
  });
}

export async function listActiveGlobalJamSessions(
  client?: SupabaseClient | null
): Promise<JamSessionRecord[]> {
  const sb = client ?? getAnonClient();
  const { data, error } = await sb
    .from('jam_sessions')
    .select('*')
    .eq('active', true)
    .order('updated_at', { ascending: false })
    .limit(20);
  if (error || !Array.isArray(data)) return [];
  return data.map(mapJamRow);
}

export function subscribeGlobalActiveJams(
  client: SupabaseClient | null,
  onChange: () => void
): () => void {
  const sb = client ?? getAnonClient();
  let channel: any = null;
  try {
    channel = sb
      .channel(`pmusic-global-jams:${Date.now()}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'jam_sessions' },
        () => {
          onChange();
        }
      )
      .subscribe();
  } catch {
    // ignore realtime setup errors
  }
  return () => {
    try {
      void channel?.unsubscribe?.();
      if (channel) sb.removeChannel?.(channel);
    } catch {
      // ignore
    }
  };
}

function mapDeezerItemsToTracks(items: unknown): Track[] {
  if (!Array.isArray(items)) return [];
  return items
    .filter((item: any) => item && item.id && item.title)
    .map((item: any): Track => ({
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

function mapItunesItemsToTracks(items: unknown): Track[] {
  if (!Array.isArray(items)) return [];
  return items
    .filter((item: any) => item && item.trackId && item.trackName)
    .map((item: any): Track => {
      const artSmall = String(item.artworkUrl100 ?? item.artworkUrl60 ?? '');
      const artLarge = artSmall ? artSmall.replace(/\/\d+x\d+bb\./, '/600x600bb.') : '';
      return {
        id: `it:${item.trackId}`,
        title: String(item.trackName),
        artists: [{ id: item.artistId ? `it_art:${item.artistId}` : undefined, name: String(item.artistName ?? 'Artista') }],
        album: item.collectionName
          ? {
              id: item.collectionId ? `it_alb:${item.collectionId}` : 'it_alb:0',
              name: String(item.collectionName),
            }
          : undefined,
        durationSec: Math.max(30, Math.round(Number(item.trackTimeMillis ?? 180_000) / 1000)),
        thumbnailUrl: artLarge || artSmall,
        thumbnailHighUrl: artLarge || artSmall,
        isExplicit: item.trackExplicitness === 'explicit',
        source: 'youtube',
      };
    });
}

export async function searchPublicCatalog(query: string): Promise<Track[]> {
  const q = query.trim();
  if (!q) return [];
  const dzPath = `/search?q=${encodeURIComponent(q)}&limit=15`;

  const tryDzUrl = async (url: string): Promise<Track[]> => {
    try {
      const res = await fetch(url);
      if (!res.ok) return [];
      const ct = res.headers.get('content-type') ?? '';
      if (!ct.includes('json')) return [];
      const json = await res.json();
      return mapDeezerItemsToTracks(json?.data);
    } catch {
      return [];
    }
  };

  const canUseRelativeProxy =
    typeof window !== 'undefined' &&
    window.location?.protocol?.startsWith('http') &&
    window.location?.hostname !== 'appassets.pmusic.local' &&
    window.location?.hostname !== '127.0.0.1' &&
    window.location?.hostname !== 'localhost';

  // 1. Same-origin Vercel proxy when running on public web
  if (canUseRelativeProxy) {
    const localHits = await tryDzUrl(`/api/dz-proxy?path=${encodeURIComponent(dzPath)}`);
    if (localHits.length > 0) return localHits;
  }

  // 2. Public pMusic proxy fallback (works inside Electron, Android WebView & local dev)
  const remoteHits = await tryDzUrl(
    `${PUBLIC_WEB_BASE_URL}/api/dz-proxy?path=${encodeURIComponent(dzPath)}`
  );
  if (remoteHits.length > 0) return remoteHits;

  // 3. Universal CORS-enabled iTunes catalog fallback (never fails on static hosts)
  try {
    const itRes = await fetch(
      `https://itunes.apple.com/search?media=music&entity=song&limit=15&term=${encodeURIComponent(q)}`
    );
    if (!itRes.ok) return [];
    const itJson = await itRes.json();
    return mapItunesItemsToTracks(itJson?.results);
  } catch {
    return [];
  }
}

function mapJamRow(row: any): JamSessionRecord {
  const currentTrack = (row.current_track as (Track & { __jamSync?: Partial<JamHostSyncMeta> }) | null) ?? null;
  const syncAllow = currentTrack?.__jamSync?.allowGuestPlaybackControls;
  return {
    code: String(row.code),
    hostUserId: String(row.host_user_id),
    hostName: String(row.host_name ?? 'pMusic'),
    currentTrack,
    queue: Array.isArray(row.queue) ? (row.queue as Track[]) : [],
    isPlaying: Boolean(row.is_playing),
    allowGuestDirectAdd: Boolean(row.allow_guest_direct_add ?? true),
    allowGuestPlaybackControls:
      typeof row.allow_guest_playback_controls === 'boolean'
        ? row.allow_guest_playback_controls
        : typeof syncAllow === 'boolean'
          ? syncAllow
          : false,
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
