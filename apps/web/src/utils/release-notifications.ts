import type { LikedTrackRecord, PlayHistoryRecord, Track } from '@pmusic/core';
import { upgradeCoverUrlToHd } from './image-opt.ts';

export interface PriorityArtistTarget {
  name: string;
  normName: string;
  artistId?: string;
  score: number;
}

export interface ReleaseNotificationItem {
  id: string;
  artistName: string;
  artistId?: string;
  title: string;
  albumId?: string;
  trackId?: string;
  coverUrl: string;
  releaseDate: string;
  recordType: 'single' | 'ep' | 'album' | 'track';
  detectedAt: string;
  read: boolean;
  track?: Track;
}

export interface ReleaseNotificationsPersistedState {
  enabled: boolean;
  lastCheckedAt: number;
  seenIds: string[];
  items: ReleaseNotificationItem[];
}

const RELEASE_NOTIFICATIONS_STORAGE_KEY = 'pmusic_release_notifications_v1';
const RESOLVED_ARTIST_ID_STORAGE_KEY = 'pmusic_release_artist_ids_v1';
const PUBLIC_WEB_ORIGIN = 'https://pmusic-olive.vercel.app';
const MAX_STORED_NOTIFICATIONS = 40;
const MAX_SEEN_IDS = 120;

export function normArtistKey(raw?: string | null): string {
  return String(raw ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function toIsoDate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function extractPriorityArtists(
  likedTracks: LikedTrackRecord[],
  playHistory: PlayHistoryRecord[],
  maxArtists = 12
): PriorityArtistTarget[] {
  const scores = new Map<string, PriorityArtistTarget>();

  const bump = (name: string | undefined, artistId: string | undefined, weight: number) => {
    const cleanName = String(name ?? '').trim();
    const norm = normArtistKey(cleanName);
    if (!norm || norm === 'artista' || norm === 'pmusic') return;
    const prev = scores.get(norm);
    const numericId =
      artistId && /^\d+$/.test(artistId)
        ? artistId
        : artistId?.startsWith('dz_ar_')
          ? artistId.slice(6)
          : undefined;
    if (prev) {
      prev.score += weight;
      if (!prev.artistId && numericId) prev.artistId = numericId;
    } else {
      scores.set(norm, {
        name: cleanName,
        normName: norm,
        ...(numericId ? { artistId: numericId } : {}),
        score: weight,
      });
    }
  };

  for (const entry of likedTracks) {
    const t = entry?.track;
    if (!t?.artists) continue;
    t.artists.forEach((ar, idx) => bump(ar?.name, ar?.id, idx === 0 ? 3 : 2));
  }

  for (const h of playHistory) {
    const t = h?.track;
    if (!t?.artists) continue;
    t.artists.forEach((ar, idx) => bump(ar?.name, ar?.id, idx === 0 ? 1 : 0.5));
  }

  return Array.from(scores.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, maxArtists);
}

export function loadReleaseNotificationsState(): ReleaseNotificationsPersistedState {
  const defaults: ReleaseNotificationsPersistedState = {
    enabled: true,
    lastCheckedAt: 0,
    seenIds: [],
    items: [],
  };
  if (typeof window === 'undefined') return defaults;
  try {
    const raw = window.localStorage.getItem(RELEASE_NOTIFICATIONS_STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<ReleaseNotificationsPersistedState>;
    return {
      enabled: parsed.enabled !== false,
      lastCheckedAt: typeof parsed.lastCheckedAt === 'number' ? parsed.lastCheckedAt : 0,
      seenIds: Array.isArray(parsed.seenIds) ? parsed.seenIds.filter((x): x is string => typeof x === 'string') : [],
      items: Array.isArray(parsed.items) ? (parsed.items as ReleaseNotificationItem[]).slice(0, MAX_STORED_NOTIFICATIONS) : [],
    };
  } catch {
    return defaults;
  }
}

export function saveReleaseNotificationsState(state: ReleaseNotificationsPersistedState): void {
  if (typeof window === 'undefined') return;
  try {
    const payload: ReleaseNotificationsPersistedState = {
      enabled: state.enabled !== false,
      lastCheckedAt: state.lastCheckedAt || 0,
      seenIds: state.seenIds.slice(-MAX_SEEN_IDS),
      items: state.items.slice(0, MAX_STORED_NOTIFICATIONS),
    };
    window.localStorage.setItem(RELEASE_NOTIFICATIONS_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // ignore storage quota errors
  }
}

function readArtistIdCache(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(RESOLVED_ARTIST_ID_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function writeArtistIdCache(normName: string, id: string): void {
  if (typeof window === 'undefined' || !normName || !id) return;
  try {
    const cur = readArtistIdCache();
    cur[normName] = id;
    window.localStorage.setItem(RESOLVED_ARTIST_ID_STORAGE_KEY, JSON.stringify(cur));
  } catch {
    // ignore
  }
}

function resolveApiOrigin(): string {
  if (typeof window === 'undefined') return PUBLIC_WEB_ORIGIN;
  const loc = window.location;
  if (
    loc &&
    (loc.hostname === 'appassets.pmusic.local' ||
      loc.hostname === '127.0.0.1' ||
      loc.hostname === 'localhost') &&
    loc.origin.startsWith('http')
  ) {
    return loc.origin.replace(/\/+$/, '');
  }
  return PUBLIC_WEB_ORIGIN;
}

async function fetchJsonWithTimeout<T>(url: string, fetchFn: typeof fetch, timeoutMs = 4500): Promise<T | null> {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    const res = await fetchFn(url, { signal: ctrl?.signal });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function checkArtistNewReleases(
  artists: PriorityArtistTarget[],
  seenIds: Iterable<string>,
  options?: { fetchFn?: typeof fetch; now?: Date }
): Promise<ReleaseNotificationItem[]> {
  if (!artists.length) return [];
  const fetchFn = options?.fetchFn ?? (typeof fetch === 'function' ? fetch : null);
  if (!fetchFn) return [];

  const now = options?.now ?? new Date();
  const todayIso = toIsoDate(now);
  const cutoff14Iso = toIsoDate(
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 14))
  );
  const origin = resolveApiOrigin();
  const seenSet = new Set(seenIds);
  const artistMap = new Map<string, PriorityArtistTarget>();
  for (const ar of artists) {
    artistMap.set(ar.normName, ar);
  }

  const candidateMap = new Map<string, ReleaseNotificationItem>();
  const detectedAtIso = now.toISOString();

  const pushCandidate = (item: ReleaseNotificationItem) => {
    const key = `${normArtistKey(item.artistName)}::${normArtistKey(item.title)}`;
    if (!key || key === '::' || seenSet.has(item.id) || candidateMap.has(key)) return;
    candidateMap.set(key, item);
  };

  // 1. Cross-check curated Release Radar against user's priority artists
  const radar = await fetchJsonWithTimeout<{
    releases?: Array<{
      title?: string;
      artists?: string[];
      releaseDate?: string;
      kind?: string;
      thumbnailUrl?: string;
      thumbnailHighUrl?: string;
      track?: Track;
    }>;
  }>(`${origin}/api/release-radar`, fetchFn, 4000);

  if (Array.isArray(radar?.releases)) {
    for (const rel of radar.releases) {
      const rd = String(rel?.releaseDate ?? '').slice(0, 10);
      if (!rd || rd < cutoff14Iso || rd > todayIso || !rel?.title) continue;
      const relArtists = Array.isArray(rel.artists) ? rel.artists : [];
      const matched = relArtists.find((name) => artistMap.has(normArtistKey(name)));
      if (!matched) continue;
      const priority = artistMap.get(normArtistKey(matched));
      const cleanId = `radar:${normArtistKey(matched)}:${normArtistKey(rel.title)}:${rd}`;
      const rawCover = rel.thumbnailHighUrl ?? rel.thumbnailUrl ?? rel.track?.thumbnailHighUrl ?? rel.track?.thumbnailUrl ?? '';
      pushCandidate({
        id: cleanId,
        artistName: matched,
        ...(priority?.artistId ? { artistId: priority.artistId } : {}),
        title: rel.title.trim(),
        ...(rel.track?.album?.id ? { albumId: rel.track.album.id } : {}),
        ...(rel.track?.id ? { trackId: rel.track.id } : {}),
        coverUrl: upgradeCoverUrlToHd(rawCover) || rawCover,
        releaseDate: rd,
        recordType: rel.kind === 'album' ? 'album' : rel.kind === 'ep' ? 'ep' : 'track',
        detectedAt: detectedAtIso,
        read: false,
        ...(rel.track ? { track: rel.track } : {}),
      });
    }
  }

  // 2. Query top 10 priority artists directly via Deezer proxy for newest singles/EPs/albums
  const topTargets = artists.slice(0, 10);
  const idCache = readArtistIdCache();
  const dzProxy = (dzPath: string) => `${origin}/api/dz-proxy?path=${encodeURIComponent(dzPath)}`;

  const processArtist = async (target: PriorityArtistTarget) => {
    let dzId = target.artistId || idCache[target.normName];
    if (!dzId) {
      const found = await fetchJsonWithTimeout<{
        data?: Array<{ id?: number | string; name?: string }>;
      }>(dzProxy(`/search/artist?q=${encodeURIComponent(target.name)}&limit=3`), fetchFn, 3500);
      const exact = (found?.data ?? []).find((a) => normArtistKey(a?.name) === target.normName) ?? found?.data?.[0];
      if (exact?.id) {
        dzId = String(exact.id);
        writeArtistIdCache(target.normName, dzId);
      }
    }
    if (!dzId || !/^\d+$/.test(dzId)) return;

    const albumsRes = await fetchJsonWithTimeout<{
      data?: Array<{
        id?: number | string;
        title?: string;
        release_date?: string;
        record_type?: string;
        cover_xl?: string;
        cover_big?: string;
        cover_medium?: string;
        cover?: string;
      }>;
    }>(dzProxy(`/artist/${encodeURIComponent(dzId)}/albums?limit=6`), fetchFn, 3500);

    for (const al of albumsRes?.data ?? []) {
      const rd = String(al?.release_date ?? '').slice(0, 10);
      if (!al?.id || !al?.title || !rd || rd < cutoff14Iso || rd > todayIso) continue;
      const alId = String(al.id);
      const rawCover = al.cover_xl || al.cover_big || al.cover_medium || al.cover || '';
      const rType =
        al.record_type === 'album'
          ? 'album'
          : al.record_type === 'ep'
            ? 'ep'
            : 'single';
      pushCandidate({
        id: `dz-al:${alId}:${rd}`,
        artistName: target.name,
        artistId: dzId,
        title: al.title.trim(),
        albumId: alId,
        coverUrl: upgradeCoverUrlToHd(rawCover) || rawCover,
        releaseDate: rd,
        recordType: rType,
        detectedAt: detectedAtIso,
        read: false,
      });
    }
  };

  for (let i = 0; i < topTargets.length; i += 3) {
    await Promise.allSettled(topTargets.slice(i, i + 3).map(processArtist));
  }

  return Array.from(candidateMap.values()).sort((a, b) =>
    b.releaseDate.localeCompare(a.releaseDate)
  );
}
