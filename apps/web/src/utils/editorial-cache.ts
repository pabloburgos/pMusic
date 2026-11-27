import {
  normalizeSearchText,
  type AlbumDetail,
  type ArtistDetail,
  type HomeEditorialMix,
  type HomeEditorialShelf,
  type Track,
} from '@pmusic/core';

const PROTECTED_EDITORIAL_MIX_IDS = new Set([
  'mix_descubre_lo_nuevo',
  'mix_daily_mix',
  'mix_daily_discover',
]);

export const ARTIST_DETAIL_PERSIST_KEY = 'pmusic_artist_detail_cache_v1';
export const ALBUM_DETAIL_PERSIST_KEY = 'pmusic_album_detail_cache_v1';
export const SYNCED_EDITORIAL_MIXES_KEY = 'pmusic_synced_editorial_mixes_v1';
export const DETAIL_PERSIST_MAX_ENTRIES = 20;
export const DETAIL_PERSIST_READ_TTL_MS = 24 * 60 * 60_000;
export const DETAIL_STALE_REFRESH_MS = 20 * 60_000;
export const DESCUBRE_RESCAN_INTERVAL_MS = 6 * 60 * 60_000;
export const DESCUBRE_ALGO_VERSION = 3;

export function getLocalDayKey(ms: number = Date.now()): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function getRollingDaysAgoIso(days: number, now: Date = new Date()): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export interface CompactSyncedTrack {
  id: string;
  title: string;
  artists: Array<{ id?: string; name: string }>;
  album?: { id?: string; name: string };
  durationSec: number;
  thumbnailUrl: string;
  thumbnailHighUrl?: string;
  releaseDate?: string;
  releaseYear?: number;
  isExplicit?: boolean;
  addedAtDay?: string;
}

export interface SyncedDailyMixEntry {
  dayKey: string;
  generatedAt: number;
  subtitle: string;
  tracks: CompactSyncedTrack[];
}

export interface SyncedEditorialMixesState {
  version: 1;
  ownerUserId: string | null;
  updatedAt: number;
  descubre: {
    lastScanAt: number;
    lastScanDay: string;
    algoVersion?: number;
    tracks: CompactSyncedTrack[];
  };
  dailyMix: SyncedDailyMixEntry | null;
  dailyDiscover: SyncedDailyMixEntry | null;
}

export function toCompactSyncedTrack(t: Track, addedAtDay?: string): CompactSyncedTrack {
  return {
    id: t.id,
    title: t.title,
    artists: (t.artists ?? []).map((a) => (a.id ? { id: a.id, name: a.name } : { name: a.name })),
    ...(t.album ? { album: t.album.id ? { id: t.album.id, name: t.album.name } : { name: t.album.name } } : {}),
    durationSec: t.durationSec,
    thumbnailUrl: t.thumbnailUrl ?? '',
    ...(t.thumbnailHighUrl ? { thumbnailHighUrl: t.thumbnailHighUrl } : {}),
    ...(t.releaseDate ? { releaseDate: t.releaseDate.slice(0, 10) } : {}),
    ...(t.releaseYear ? { releaseYear: t.releaseYear } : {}),
    ...(t.isExplicit ? { isExplicit: true } : {}),
    ...(addedAtDay ? { addedAtDay } : {}),
  };
}

export function fromCompactSyncedTrack(c: CompactSyncedTrack): Track {
  return {
    id: c.id,
    title: c.title,
    artists: c.artists,
    ...(c.album ? { album: c.album } : {}),
    durationSec: c.durationSec,
    thumbnailUrl: c.thumbnailUrl,
    ...(c.thumbnailHighUrl ? { thumbnailHighUrl: c.thumbnailHighUrl } : {}),
    ...(c.releaseDate ? { releaseDate: c.releaseDate } : {}),
    ...(c.releaseYear ? { releaseYear: c.releaseYear } : {}),
    ...(c.isExplicit ? { isExplicit: true } : {}),
    source: 'ytmusic',
  };
}

function trackDedupSig(t: { title: string; artists: ReadonlyArray<{ name: string }> }): string {
  return `${normalizeSearchText(t.title)}::${normalizeSearchText(t.artists[0]?.name ?? '')}`;
}

function normArtistNames(artists: ReadonlyArray<{ name: string }>): string[] {
  return artists
    .flatMap((a) => a.name.split(/\s*(?:,|&|\bfeat\.?\b|\bft\.?\b|\bcon\b)\s*/i))
    .map((n) => normalizeSearchText(n))
    .filter(Boolean);
}

/**
 * Self-feeding 15-day Descubre lo Nuevo pool:
 * - Retains existing tracks whose releaseDate (or addedAtDay) is still within [today - 15d, today].
 * - Automatically retires expired tracks older than 15 days.
 * - Merges new incoming <= 15-day tracks without resetting existing ones to 0.
 * - Prioritizes user favorite artists and newest dates, capped cleanly at 50 tracks (max 3 per primary artist).
 */
export function mergeIncrementalDescubrePool(
  existingTracks: readonly CompactSyncedTrack[],
  incomingTracks: readonly (Track | CompactSyncedTrack)[],
  nowDate: Date = new Date(),
  favoriteArtistNames: readonly string[] = [],
  libraryArtistNames: readonly string[] = []
): CompactSyncedTrack[] {
  const todayIso = getLocalDayKey(nowDate.getTime());
  const cutoff15Iso = getRollingDaysAgoIso(15, nowDate);
  const favSet = new Set(favoriteArtistNames.map((n) => normalizeSearchText(n)).filter(Boolean));
  const libSet = new Set(libraryArtistNames.map((n) => normalizeSearchText(n)).filter(Boolean));

  const pool = new Map<string, CompactSyncedTrack>();
  const sigToId = new Map<string, string>();

  const consider = (raw: Track | CompactSyncedTrack) => {
    if (!raw?.id || !raw.title) return;
    if (raw.id.startsWith('trk_fb_') || raw.id.startsWith('fallback_')) return;
    const rawRelDate = raw.releaseDate ? raw.releaseDate.trim().slice(0, 10) : '';
    const rawAdded = 'addedAtDay' in raw && raw.addedAtDay ? raw.addedAtDay.slice(0, 10) : undefined;
    // Strict <= 15-day rule: track must carry a verified releaseDate in [cutoff15Iso, todayIso] (never addedAtDay!)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(rawRelDate) || rawRelDate < cutoff15Iso || rawRelDate > todayIso) {
      return;
    }

    const compact: CompactSyncedTrack = toCompactSyncedTrack(
      raw as Track,
      rawAdded ?? rawRelDate
    );
    compact.releaseDate = rawRelDate;

    const prev = pool.get(compact.id);
    if (prev) {
      const mergedArtists =
        compact.artists.length >= prev.artists.length ? compact.artists : prev.artists;
      const bestDate =
        compact.releaseDate && (!prev.releaseDate || compact.releaseDate > prev.releaseDate)
          ? compact.releaseDate
          : prev.releaseDate;
      pool.set(compact.id, {
        ...prev,
        ...compact,
        artists: mergedArtists,
        ...(bestDate ? { releaseDate: bestDate } : {}),
        addedAtDay: prev.addedAtDay ?? compact.addedAtDay,
      });
      return;
    }

    const sig = trackDedupSig(compact);
    const existingBySig = sig !== '::' ? sigToId.get(sig) : undefined;
    if (existingBySig && pool.has(existingBySig)) {
      const existing = pool.get(existingBySig)!;
      if (
        (compact.releaseDate ?? '') > (existing.releaseDate ?? '') ||
        compact.artists.length > existing.artists.length
      ) {
        pool.delete(existingBySig);
        pool.set(compact.id, compact);
        sigToId.set(sig, compact.id);
      }
      return;
    }

    pool.set(compact.id, compact);
    if (sig !== '::') sigToId.set(sig, compact.id);
  };

  for (const item of existingTracks) consider(item);
  for (const item of incomingTracks) consider(item);

  const artistTier = (artists: CompactSyncedTrack['artists']): number => {
    const norms = normArtistNames(artists);
    if (norms.some((n) => favSet.has(n))) return 2;
    if (norms.some((n) => libSet.has(n))) return 1;
    return 0;
  };

  const ranked = Array.from(pool.values()).sort((a, b) => {
    const diffTier = artistTier(b.artists) - artistTier(a.artists);
    if (diffTier !== 0) return diffTier;
    const cmpDate = (b.releaseDate ?? b.addedAtDay ?? '').localeCompare(
      a.releaseDate ?? a.addedAtDay ?? ''
    );
    if (cmpDate !== 0) return cmpDate;
    return a.id.localeCompare(b.id);
  });

  const out: CompactSyncedTrack[] = [];
  const artistCounts = new Map<string, number>();
  for (const t of ranked) {
    const pArtist = normalizeSearchText(t.artists[0]?.name ?? '');
    if (pArtist && (artistCounts.get(pArtist) ?? 0) >= 3) continue;
    if (pArtist) artistCounts.set(pArtist, (artistCounts.get(pArtist) ?? 0) + 1);
    out.push(t);
    if (out.length >= 50) break;
  }
  return out;
}

/**
 * 24-hour Daily Mix / Daily Discover lock & gradual rotation:
 * - Same calendar day -> stays 100% locked identical across reloads and devices.
 * - Weak fresh response (< 20 tracks) when yesterday had >= 25 tracks -> protects saved playlist.
 * - New calendar day (24h rollover) -> keeps ~keepRatio (60-65%) from previous day and swaps ~35-40% fresh songs.
 */
export function evolveDailyPlaylistForNewDay(
  prevEntry: SyncedDailyMixEntry | null | undefined,
  freshTracks: readonly (Track | CompactSyncedTrack)[],
  freshSubtitle: string,
  todayKey: string,
  keepRatio: number
): SyncedDailyMixEntry {
  const validFresh = freshTracks
    .filter((t) => Boolean(t?.id && t.title && !t.id.startsWith('trk_fb_')))
    .map((t) => toCompactSyncedTrack(t as Track));

  if (prevEntry && prevEntry.dayKey === todayKey && prevEntry.tracks.length >= 25) {
    return prevEntry;
  }

  if (prevEntry && prevEntry.tracks.length >= 25 && validFresh.length < 20) {
    return prevEntry;
  }

  if (!prevEntry || prevEntry.tracks.length < 20) {
    return {
      dayKey: todayKey,
      generatedAt: Date.now(),
      subtitle: freshSubtitle,
      tracks: validFresh.slice(0, 100),
    };
  }

  // New 24h day with healthy fresh candidates: retain keepRatio + rotate in fresh tracks
  const targetCount = Math.min(100, Math.max(prevEntry.tracks.length, validFresh.length));
  const keepCount = Math.max(10, Math.min(prevEntry.tracks.length, Math.round(targetCount * keepRatio)));

  const freshIdSet = new Set(validFresh.map((t) => t.id));
  const freshSigSet = new Set(validFresh.map((t) => trackDedupSig(t)));
  const orderedPrev = [
    ...prevEntry.tracks.filter((t) => freshIdSet.has(t.id) || freshSigSet.has(trackDedupSig(t))),
    ...prevEntry.tracks.filter((t) => !freshIdSet.has(t.id) && !freshSigSet.has(trackDedupSig(t))),
  ];

  const picked: CompactSyncedTrack[] = [];
  const usedIds = new Set<string>();
  const usedSigs = new Set<string>();

  const pushUnique = (t: CompactSyncedTrack) => {
    if (usedIds.has(t.id)) return false;
    const sig = trackDedupSig(t);
    if (sig !== '::' && usedSigs.has(sig)) return false;
    usedIds.add(t.id);
    if (sig !== '::') usedSigs.add(sig);
    picked.push(t);
    return true;
  };

  for (const t of orderedPrev) {
    if (picked.length >= keepCount) break;
    pushUnique(t);
  }
  for (const t of validFresh) {
    if (picked.length >= targetCount) break;
    pushUnique(t);
  }
  for (const t of orderedPrev) {
    if (picked.length >= targetCount) break;
    pushUnique(t);
  }

  // Interleave kept and new fresh tracks cleanly so fresh discoveries sit right near the top
  const keptSlice = picked.slice(0, keepCount);
  const rotatedSlice = picked.slice(keepCount);
  const interleaved: CompactSyncedTrack[] = [];
  let ki = 0;
  let ri = 0;
  while (ki < keptSlice.length || ri < rotatedSlice.length) {
    if (ki < keptSlice.length) interleaved.push(keptSlice[ki++]!);
    if (ki < keptSlice.length) interleaved.push(keptSlice[ki++]!);
    if (ri < rotatedSlice.length) interleaved.push(rotatedSlice[ri++]!);
  }

  return {
    dayKey: todayKey,
    generatedAt: Date.now(),
    subtitle: freshSubtitle || prevEntry.subtitle,
    tracks: interleaved.slice(0, 100),
  };
}

function pickBestDailyMixEntry(
  localEntry: SyncedDailyMixEntry | null | undefined,
  cloudEntry: SyncedDailyMixEntry | null | undefined,
  todayKey: string
): SyncedDailyMixEntry | null {
  const locOk = Boolean(localEntry && localEntry.tracks.length >= 25);
  const cldOk = Boolean(cloudEntry && cloudEntry.tracks.length >= 25);
  if (!locOk && !cldOk) {
    return (cloudEntry?.tracks.length ?? 0) > (localEntry?.tracks.length ?? 0)
      ? cloudEntry ?? null
      : localEntry ?? null;
  }
  if (!locOk) return cloudEntry ?? null;
  if (!cldOk) return localEntry ?? null;

  const locIsToday = localEntry!.dayKey === todayKey;
  const cldIsToday = cloudEntry!.dayKey === todayKey;
  if (locIsToday && !cldIsToday) return localEntry!;
  if (cldIsToday && !locIsToday) return cloudEntry!;
  if (locIsToday && cldIsToday) {
    // Same day on both devices: adopt earliest-generated so both devices converge deterministically
    return cloudEntry!.generatedAt <= localEntry!.generatedAt ? cloudEntry! : localEntry!;
  }
  return cloudEntry!.generatedAt >= localEntry!.generatedAt ? cloudEntry! : localEntry!;
}

/**
 * Combines PC & Mobile editorial mixes state cleanly:
 * - Descubre lo Nuevo = 15-day union across devices.
 * - Daily Mix & Daily Discover = shared identical 24h locked playlist across devices.
 */
export function mergeCloudEditorialMixes(
  localState: SyncedEditorialMixesState | null | undefined,
  cloudRaw: unknown,
  nowDate: Date = new Date(),
  favoriteArtistNames: readonly string[] = [],
  libraryArtistNames: readonly string[] = []
): SyncedEditorialMixesState | null {
  if (!cloudRaw || typeof cloudRaw !== 'object') return localState ?? null;
  const cloud = cloudRaw as Partial<SyncedEditorialMixesState>;
  const todayKey = getLocalDayKey(nowDate.getTime());

  const localAlgo = localState?.descubre?.algoVersion ?? 1;
  const cloudAlgo = cloud.descubre?.algoVersion ?? 1;
  const localTracks = localAlgo >= cloudAlgo ? localState?.descubre?.tracks ?? [] : [];
  const cloudTracks = cloudAlgo >= localAlgo ? cloud.descubre?.tracks ?? [] : [];

  const mergedDescubreTracks = mergeIncrementalDescubrePool(
    localTracks,
    cloudTracks,
    nowDate,
    favoriteArtistNames,
    libraryArtistNames
  );
  const lastScanAt =
    localAlgo !== cloudAlgo
      ? localAlgo > cloudAlgo
        ? localState?.descubre?.lastScanAt ?? 0
        : typeof cloud.descubre?.lastScanAt === 'number'
          ? cloud.descubre.lastScanAt
          : 0
      : Math.max(
          localState?.descubre?.lastScanAt ?? 0,
          typeof cloud.descubre?.lastScanAt === 'number' ? cloud.descubre.lastScanAt : 0
        );
  const lastScanDay =
    (localState?.descubre?.lastScanDay ?? '') >= (cloud.descubre?.lastScanDay ?? '')
      ? localState?.descubre?.lastScanDay || cloud.descubre?.lastScanDay || todayKey
      : cloud.descubre?.lastScanDay || todayKey;

  const dailyMix = pickBestDailyMixEntry(localState?.dailyMix, cloud.dailyMix, todayKey);
  const dailyDiscover = pickBestDailyMixEntry(
    localState?.dailyDiscover,
    cloud.dailyDiscover,
    todayKey
  );

  return {
    version: 1,
    ownerUserId: localState?.ownerUserId ?? cloud.ownerUserId ?? null,
    updatedAt: Math.max(localState?.updatedAt ?? 0, cloud.updatedAt ?? 0, Date.now()),
    descubre: {
      lastScanAt,
      lastScanDay,
      algoVersion: Math.max(localAlgo, cloudAlgo),
      tracks: mergedDescubreTracks,
    },
    dailyMix,
    dailyDiscover,
  };
}

export function applySyncedMixesToShelves(
  shelves: HomeEditorialShelf[],
  state: SyncedEditorialMixesState | null | undefined
): HomeEditorialShelf[] {
  if (!state) return shelves;
  const descubreTracks = (state.descubre?.tracks ?? []).map(fromCompactSyncedTrack);
  const dmTracks = (state.dailyMix?.tracks ?? []).map(fromCompactSyncedTrack);
  const ddTracks = (state.dailyDiscover?.tracks ?? []).map(fromCompactSyncedTrack);

  let foundMixShelf = false;
  const updated = shelves.map((shelf) => {
    if (shelf.kind !== 'mixes_for_you' || !Array.isArray(shelf.mixes)) return shelf;
    foundMixShelf = true;
    const nextMixes: HomeEditorialMix[] = shelf.mixes.map((mix) => {
      if (mix.id === 'mix_descubre_lo_nuevo' && descubreTracks.length > 0) {
        return {
          ...mix,
          badge: 'ÚLTIMOS 15 DÍAS',
          coverUrl:
            descubreTracks[0]?.thumbnailHighUrl ??
            descubreTracks[0]?.thumbnailUrl ??
            mix.coverUrl,
          tracks: descubreTracks,
        };
      }
      if (mix.id === 'mix_daily_mix' && dmTracks.length > 0) {
        return {
          ...mix,
          subtitle: state.dailyMix?.subtitle || mix.subtitle,
          coverUrl: dmTracks[0]?.thumbnailHighUrl ?? dmTracks[0]?.thumbnailUrl ?? mix.coverUrl,
          tracks: dmTracks,
        };
      }
      if (mix.id === 'mix_daily_discover' && ddTracks.length > 0) {
        return {
          ...mix,
          subtitle: state.dailyDiscover?.subtitle || mix.subtitle,
          coverUrl: ddTracks[0]?.thumbnailHighUrl ?? ddTracks[0]?.thumbnailUrl ?? mix.coverUrl,
          tracks: ddTracks,
        };
      }
      return mix;
    });
    return { ...shelf, mixes: nextMixes };
  });

  if (foundMixShelf) return updated;
  return updated;
}

export function readSyncedEditorialMixes(
  expectedOwnerUserId?: string | null
): SyncedEditorialMixesState | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(SYNCED_EDITORIAL_MIXES_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SyncedEditorialMixesState | null;
    if (!parsed || parsed.version !== 1) return null;
    if (
      expectedOwnerUserId !== undefined &&
      (parsed.ownerUserId ?? null) !== (expectedOwnerUserId ?? null)
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function writeSyncedEditorialMixes(state: SyncedEditorialMixesState): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(SYNCED_EDITORIAL_MIXES_KEY, JSON.stringify(state));
  } catch {
    // ignore storage quota errors
  }
}

export function hasHealthyDailyMixes(shelves: readonly HomeEditorialShelf[]): boolean {
  if (!Array.isArray(shelves) || shelves.length === 0) return false;
  const allMixes = shelves.flatMap((s) => s.mixes ?? []);
  const descubre = allMixes.find((m) => m.id === 'mix_descubre_lo_nuevo');
  if (!descubre || (descubre.tracks?.length ?? 0) < 25) return false;
  const dailyMix = allMixes.find((m) => m.id === 'mix_daily_mix');
  if (dailyMix && (dailyMix.tracks?.length ?? 0) < 25) return false;
  const dailyDiscover = allMixes.find((m) => m.id === 'mix_daily_discover');
  if (dailyDiscover && (dailyDiscover.tracks?.length ?? 0) < 25) return false;
  return true;
}

/**
 * Prevents cellular/transient partial refreshes (e.g. 1-track failure) from overwriting
 * healthy saved editorial mixes like Descubre lo Nuevo, Daily Mix, and Daily Discover.
 */
export function mergeProtectedEditorialShelves(
  prevShelves: HomeEditorialShelf[] | null | undefined,
  freshShelves: HomeEditorialShelf[]
): HomeEditorialShelf[] {
  if (!Array.isArray(freshShelves) || freshShelves.length === 0) {
    return Array.isArray(prevShelves) ? prevShelves : [];
  }
  if (!Array.isArray(prevShelves) || prevShelves.length === 0) {
    return freshShelves;
  }

  const prevMixById = new Map<string, HomeEditorialMix>();
  for (const s of prevShelves) {
    for (const m of s.mixes ?? []) {
      if (m?.id) prevMixById.set(m.id, m);
    }
  }

  return freshShelves.map((shelf) => {
    if (shelf.kind !== 'mixes_for_you' || !Array.isArray(shelf.mixes)) {
      return shelf;
    }
    const protectedMixes = shelf.mixes.map((freshMix) => {
      if (!PROTECTED_EDITORIAL_MIX_IDS.has(freshMix.id)) return freshMix;
      const prevMix = prevMixById.get(freshMix.id);
      if (
        prevMix &&
        (prevMix.tracks?.length ?? 0) >= 20 &&
        (freshMix.tracks?.length ?? 0) < 15
      ) {
        return prevMix;
      }
      return freshMix;
    });
    return { ...shelf, mixes: protectedMixes };
  });
}

interface PersistedDetailRecord<T> {
  at: number;
  data: T;
}

function readPersistedDetailMap<T>(storageKey: string): Record<string, PersistedDetailRecord<T>> {
  try {
    if (typeof localStorage === 'undefined') return {};
    const raw = localStorage.getItem(storageKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, PersistedDetailRecord<T>> | null;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function readPersistedEntry<T>(
  storageKey: string,
  key: string
): { data: T; at: number } | null {
  const map = readPersistedDetailMap<T>(storageKey);
  const entry = map[key];
  if (!entry || typeof entry.at !== 'number' || !entry.data) return null;
  if (Date.now() - entry.at >= DETAIL_PERSIST_READ_TTL_MS) {
    return null;
  }
  return entry;
}

function writePersistedEntry<T>(storageKey: string, key: string, data: T): void {
  try {
    if (typeof localStorage === 'undefined' || !key) return;
    const map = readPersistedDetailMap<T>(storageKey);
    map[key] = { at: Date.now(), data };
    const entries = Object.entries(map).sort((a, b) => (b[1]?.at ?? 0) - (a[1]?.at ?? 0));
    const pruned: Record<string, PersistedDetailRecord<T>> = {};
    for (const [k, v] of entries.slice(0, DETAIL_PERSIST_MAX_ENTRIES)) {
      if (Date.now() - (v?.at ?? 0) < DETAIL_PERSIST_READ_TTL_MS) {
        pruned[k] = v;
      }
    }
    localStorage.setItem(storageKey, JSON.stringify(pruned));
  } catch {
    // ignore localStorage quota errors
  }
}

export function readPersistedArtistCache(key: string): { data: ArtistDetail; at: number } | null {
  return readPersistedEntry<ArtistDetail>(ARTIST_DETAIL_PERSIST_KEY, key);
}

export function writePersistedArtistCache(key: string, data: ArtistDetail): void {
  writePersistedEntry<ArtistDetail>(ARTIST_DETAIL_PERSIST_KEY, key, data);
}

export function readPersistedAlbumCache(key: string): { data: AlbumDetail; at: number } | null {
  return readPersistedEntry<AlbumDetail>(ALBUM_DETAIL_PERSIST_KEY, key);
}

export function writePersistedAlbumCache(key: string, data: AlbumDetail): void {
  writePersistedEntry<AlbumDetail>(ALBUM_DETAIL_PERSIST_KEY, key, data);
}
