const TRACK_COVER_STORAGE_KEY = 'pmusic_track_cover_recovery_v1';
const TRACK_COVER_TTL_MS = 7 * 24 * 60 * 60_000;
const TRACK_COVER_MAX_ENTRIES = 200;
const PUBLIC_WEB_BASE_URL = 'https://pmusic-olive.vercel.app';

interface PersistedTrackCoverEntry {
  url: string | null;
  updatedAt: number;
}

const memoryRecoveredCovers = new Map<string, string | null>();
const inflightRecoveredCovers = new Map<string, Promise<string | null>>();

export function isBrokenCoverUrl(url?: string | null): boolean {
  if (typeof url !== 'string') return true;
  const trimmed = url.trim();
  if (!trimmed) return true;
  if (trimmed.includes('/images/cover//') || trimmed.includes('/images/artist//')) return true;
  if (trimmed.includes('d41d8cd98f00b204e9800998ecf8427e')) return true;
  return false;
}

function buildLookupKey(trackId?: string, title?: string, artistName?: string): string {
  const cleanId = (trackId ?? '').trim();
  const normTitle = (title ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  const normArtist = (artistName ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  if (cleanId && (cleanId.startsWith('dz_') || cleanId.startsWith('dz:'))) {
    return `id:${cleanId.slice(3)}`;
  }
  if (!normTitle) return cleanId ? `id:${cleanId}` : '';
  return `q:${normTitle}::${normArtist}`;
}

function readRecoveryMap(): Record<string, PersistedTrackCoverEntry> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(TRACK_COVER_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object'
      ? (parsed as Record<string, PersistedTrackCoverEntry>)
      : {};
  } catch {
    return {};
  }
}

function writeRecoveryEntry(key: string, url: string | null): void {
  if (typeof window === 'undefined' || !key) return;
  try {
    const map = readRecoveryMap();
    const now = Date.now();
    map[key] = { url, updatedAt: now };
    const entries = Object.entries(map)
      .filter(([, v]) => v && typeof v.updatedAt === 'number' && now - v.updatedAt < TRACK_COVER_TTL_MS)
      .sort((a, b) => b[1].updatedAt - a[1].updatedAt)
      .slice(0, TRACK_COVER_MAX_ENTRIES);
    window.localStorage.setItem(TRACK_COVER_STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // ignore storage quota errors
  }
}

function resolveDzProxyOrigin(): string {
  if (typeof window === 'undefined') return '';
  const loc = window.location;
  if (!loc) return '';
  if (loc.hostname === 'appassets.pmusic.local' || loc.protocol === 'file:' || loc.hostname === '127.0.0.1' || loc.hostname === 'localhost') {
    return loc.origin.startsWith('http') ? loc.origin : '';
  }
  return PUBLIC_WEB_BASE_URL;
}

async function fetchDzProxyJson<T>(dzPath: string): Promise<T | null> {
  const origin = resolveDzProxyOrigin();
  const baseUrl = origin
    ? `${origin.replace(/\/+$/, '')}/api/dz-proxy`
    : '/api/dz-proxy';
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), 4500) : null;
  try {
    const res = await fetch(`${baseUrl}?path=${encodeURIComponent(dzPath)}`, {
      signal: ctrl?.signal,
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function getCachedRecoveredTrackCover(
  trackId?: string,
  title?: string,
  artistName?: string
): string | null {
  const key = buildLookupKey(trackId, title, artistName);
  if (!key) return null;
  if (memoryRecoveredCovers.has(key)) {
    return memoryRecoveredCovers.get(key) ?? null;
  }
  const stored = readRecoveryMap()[key];
  if (stored && Date.now() - stored.updatedAt < TRACK_COVER_TTL_MS) {
    const url = !isBrokenCoverUrl(stored.url) ? stored.url! : null;
    memoryRecoveredCovers.set(key, url);
    return url;
  }
  return null;
}

export async function resolveRecoveredTrackCover(
  trackId?: string,
  title?: string,
  artistName?: string
): Promise<string | null> {
  const key = buildLookupKey(trackId, title, artistName);
  if (!key) return null;

  const cached = getCachedRecoveredTrackCover(trackId, title, artistName);
  if (cached || memoryRecoveredCovers.has(key)) {
    return cached;
  }

  const inflight = inflightRecoveredCovers.get(key);
  if (inflight) return inflight;

  const task = (async (): Promise<string | null> => {
    const cleanId = (trackId ?? '').trim();
    if (cleanId.startsWith('dz_') || cleanId.startsWith('dz:')) {
      const dzNum = cleanId.slice(3);
      if (/^\d+$/.test(dzNum)) {
        const direct = await fetchDzProxyJson<{
          album?: { cover_xl?: string; cover_big?: string; cover_medium?: string; cover?: string };
        }>(`/track/${encodeURIComponent(dzNum)}`);
        const cand =
          direct?.album?.cover_xl ??
          direct?.album?.cover_big ??
          direct?.album?.cover_medium ??
          direct?.album?.cover;
        if (!isBrokenCoverUrl(cand)) {
          memoryRecoveredCovers.set(key, cand!);
          writeRecoveryEntry(key, cand!);
          return cand!;
        }
      }
    }

    const cleanTitle = (title ?? '').replace(/\([^)]*\)|\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();
    const cleanArtist = (artistName ?? '').split(/\s*(?:,|&|\bfeat\.?\b|\bft\.?\b)\s*/i)[0]?.trim() ?? '';
    const query = cleanArtist && cleanTitle ? `${cleanArtist} ${cleanTitle}` : cleanTitle || cleanArtist;
    if (query) {
      const searched = await fetchDzProxyJson<{
        data?: Array<{
          title?: string;
          album?: { cover_xl?: string; cover_big?: string; cover_medium?: string; cover?: string };
        }>;
      }>(`/search?q=${encodeURIComponent(query)}&limit=3`);
      const items = Array.isArray(searched?.data) ? searched.data : [];
      for (const item of items) {
        const cand =
          item?.album?.cover_xl ??
          item?.album?.cover_big ??
          item?.album?.cover_medium ??
          item?.album?.cover;
        if (!isBrokenCoverUrl(cand)) {
          memoryRecoveredCovers.set(key, cand!);
          writeRecoveryEntry(key, cand!);
          return cand!;
        }
      }
    }

    memoryRecoveredCovers.set(key, null);
    writeRecoveryEntry(key, null);
    return null;
  })().finally(() => {
    inflightRecoveredCovers.delete(key);
  });

  inflightRecoveredCovers.set(key, task);
  return task;
}
