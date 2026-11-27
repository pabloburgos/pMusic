import {
  ARTIST_DETAIL_PERSIST_KEY,
  readPersistedArtistCache,
} from './editorial-cache.ts';

const ARTIST_ART_STORAGE_KEY = 'pmusic_artist_art_v1';
const ARTIST_ART_TTL_MS = 7 * 24 * 60 * 60_000;
const ARTIST_ART_MAX_ENTRIES = 120;
const PUBLIC_WEB_BASE_URL = 'https://pmusic-olive.vercel.app';

interface PersistedArtistArtEntry {
  url: string | null;
  updatedAt: number;
}

const memoryArtistArt = new Map<string, string | null>();
const inflightArtistArt = new Map<string, Promise<string | null>>();

function normalizeArtistLookupKey(artistName?: string): string {
  return (artistName ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function isUsableArtistArtUrl(url: unknown): url is string {
  if (typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (!trimmed || !/^https?:\/\//i.test(trimmed)) return false;
  if (trimmed.includes('/images/artist//') || trimmed.includes('d41d8cd98f00b204e9800998ecf8427e')) {
    return false;
  }
  return true;
}

function readStorageMap(): Record<string, PersistedArtistArtEntry> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(ARTIST_ART_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, PersistedArtistArtEntry>) : {};
  } catch {
    return {};
  }
}

function writeStorageEntry(key: string, url: string | null): void {
  if (typeof window === 'undefined' || !key) return;
  try {
    const map = readStorageMap();
    const now = Date.now();
    map[key] = { url, updatedAt: now };
    const entries = Object.entries(map)
      .filter(([, v]) => v && typeof v.updatedAt === 'number' && now - v.updatedAt < ARTIST_ART_TTL_MS)
      .sort((a, b) => b[1].updatedAt - a[1].updatedAt)
      .slice(0, ARTIST_ART_MAX_ENTRIES);
    window.localStorage.setItem(ARTIST_ART_STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // ignore quota errors
  }
}

function getFromPersistedArtistDetail(normKey: string, rawName?: string): string | null {
  try {
    if (rawName) {
      const direct = readPersistedArtistCache(rawName.trim()) ?? readPersistedArtistCache(normKey);
      const art = direct?.data?.artist as ({ bannerUrl?: string; thumbnailUrl?: string } | undefined);
      const directCand = art?.bannerUrl ?? art?.thumbnailUrl;
      if (isUsableArtistArtUrl(directCand)) return directCand;
    }
    if (typeof window === 'undefined') return null;
    const raw = window.localStorage.getItem(ARTIST_DETAIL_PERSIST_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, { data?: { artist?: { name?: string; bannerUrl?: string; thumbnailUrl?: string } } }> | null;
    if (!parsed || typeof parsed !== 'object') return null;
    for (const entry of Object.values(parsed)) {
      const artist = entry?.data?.artist;
      if (!artist) continue;
      if (normalizeArtistLookupKey(artist.name) === normKey) {
        const cand = artist.bannerUrl ?? artist.thumbnailUrl;
        if (isUsableArtistArtUrl(cand)) return cand;
      }
    }
  } catch {
    // ignore
  }
  return null;
}

export function getCachedArtistArtwork(artistName?: string): string | null {
  const key = normalizeArtistLookupKey(artistName);
  if (!key) return null;
  if (memoryArtistArt.has(key)) {
    return memoryArtistArt.get(key) ?? null;
  }
  const fromDetail = getFromPersistedArtistDetail(key, artistName);
  if (fromDetail) {
    memoryArtistArt.set(key, fromDetail);
    return fromDetail;
  }
  const storageMap = readStorageMap();
  const stored = storageMap[key];
  if (stored && Date.now() - stored.updatedAt < ARTIST_ART_TTL_MS) {
    const url = isUsableArtistArtUrl(stored.url) ? stored.url : null;
    memoryArtistArt.set(key, url);
    return url;
  }
  return null;
}

export async function resolveArtistArtwork(
  artistName?: string,
  artistId?: string
): Promise<string | null> {
  const cleanName = (artistName ?? '').trim();
  const key = normalizeArtistLookupKey(cleanName);
  if (!key) return null;

  if (memoryArtistArt.has(key)) {
    return memoryArtistArt.get(key) ?? null;
  }
  const cached = getCachedArtistArtwork(cleanName);
  if (cached) return cached;

  const inflight = inflightArtistArt.get(key);
  if (inflight) return inflight;

  const isTestEnv =
    typeof import.meta !== 'undefined' &&
    (Boolean((import.meta as any).vitest) || (import.meta as any).env?.MODE === 'test');
  const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
  if (isOffline || (isTestEnv && typeof fetch !== 'function')) {
    return null;
  }

  const work = (async (): Promise<string | null> => {
    let resolved: string | null = null;
    const canUseRelativeProxy =
      typeof window !== 'undefined' &&
      window.location?.protocol?.startsWith('http') &&
      window.location?.hostname !== 'appassets.pmusic.local' &&
      window.location?.hostname !== '127.0.0.1' &&
      window.location?.hostname !== 'localhost';

    const dzPath = `/search/artist?q=${encodeURIComponent(cleanName)}&limit=3`;
    const dzCandidates = [
      ...(canUseRelativeProxy ? [`/api/dz-proxy?path=${encodeURIComponent(dzPath)}`] : []),
      `${PUBLIC_WEB_BASE_URL}/api/dz-proxy?path=${encodeURIComponent(dzPath)}`,
    ];

    for (const url of dzCandidates) {
      if (isTestEnv) break;
      try {
        const res = await fetch(url);
        if (!res.ok) continue;
        const json = (await res.json()) as { data?: any[] };
        const items = Array.isArray(json?.data) ? json.data : [];
        const exact =
          items.find((it) => normalizeArtistLookupKey(it?.name) === key) ?? items[0];
        const pic = exact?.picture_xl ?? exact?.picture_big ?? exact?.picture_medium ?? exact?.picture;
        if (isUsableArtistArtUrl(pic)) {
          resolved = pic;
          break;
        }
      } catch {
        // try next source
      }
    }

    if (!resolved && !isTestEnv) {
      try {
        const itUrl = `https://itunes.apple.com/search?media=music&entity=song&limit=3&term=${encodeURIComponent(
          artistId && !artistId.startsWith('dz') ? `${cleanName}` : cleanName
        )}`;
        const itRes = await fetch(itUrl);
        if (itRes.ok) {
          const itJson = (await itRes.json()) as { results?: any[] };
          const items = Array.isArray(itJson?.results) ? itJson.results : [];
          const hit = items.find((r) => isUsableArtistArtUrl(r?.artworkUrl100));
          if (hit?.artworkUrl100) {
            resolved = String(hit.artworkUrl100).replace(/\/\d+x\d+bb\./, '/600x600bb.');
          }
        }
      } catch {
        // ignore network failure
      }
    }

    memoryArtistArt.set(key, resolved);
    writeStorageEntry(key, resolved);
    return resolved;
  })().finally(() => {
    inflightArtistArt.delete(key);
  });

  inflightArtistArt.set(key, work);
  return work;
}
