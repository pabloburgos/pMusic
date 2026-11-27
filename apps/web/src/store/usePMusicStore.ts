import { create } from 'zustand';
import {
  clearOfflineCovers,
  deleteOfflineCover,
  hydrateOfflineCoversMemory,
  saveOfflineCover,
} from '../utils/offline-covers.ts';
import {
  DESCUBRE_ALGO_VERSION,
  DESCUBRE_RESCAN_INTERVAL_MS,
  DETAIL_STALE_REFRESH_MS,
  applySyncedMixesToShelves,
  evolveDailyPlaylistForNewDay,
  getLocalDayKey,
  getRollingDaysAgoIso,
  hasHealthyDailyMixes,
  mergeCloudEditorialMixes,
  mergeIncrementalDescubrePool,
  mergeProtectedEditorialShelves,
  readPersistedAlbumCache,
  readPersistedArtistCache,
  readSyncedEditorialMixes,
  toCompactSyncedTrack,
  writePersistedAlbumCache,
  writePersistedArtistCache,
  writeSyncedEditorialMixes,
  type SyncedEditorialMixesState,
} from '../utils/editorial-cache.ts';
import { optimizeArtworkUrl, setDataSaverMode, upgradeCoverUrlToHd } from '../utils/image-opt.ts';
import { findPlaylistDuplicates, getTrackDuplicateKey } from '../utils/playlist-tools.ts';
import {
  checkArtistNewReleases,
  extractPriorityArtists,
  loadReleaseNotificationsState,
  saveReleaseNotificationsState,
  type ReleaseNotificationItem,
} from '../utils/release-notifications.ts';

const WIFI_ONLY_STORAGE_KEY = 'pmusic.offline.wifiOnly';
const AUTO_OFFLINE_PLAYLISTS_KEY = 'pmusic.offline.autoPlaylists';

function readWifiOnlyDownloadsPref(): boolean {
  try {
    return (
      typeof localStorage !== 'undefined' &&
      localStorage.getItem(WIFI_ONLY_STORAGE_KEY) === '1'
    );
  } catch {
    return false;
  }
}

function readOfflineAutoPlaylistIds(): string[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(AUTO_OFFLINE_PLAYLISTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === 'string' && id.length > 0)
      : [];
  } catch {
    return [];
  }
}

function writeOfflineAutoPlaylistIds(ids: string[]): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(AUTO_OFFLINE_PLAYLISTS_KEY, JSON.stringify(ids));
    }
  } catch {
    // ignore storage errors
  }
}

function isMeteredOrCellularNetwork(): boolean {
  try {
    const win =
      typeof window !== 'undefined'
        ? (window as unknown as {
            PMusicNative?: { isMeteredNetwork?: () => boolean };
          })
        : null;
    if (typeof win?.PMusicNative?.isMeteredNetwork === 'function') {
      return Boolean(win.PMusicNative.isMeteredNetwork());
    }
    const nav =
      typeof navigator !== 'undefined'
        ? (navigator as unknown as {
            connection?: { type?: string; saveData?: boolean };
          })
        : null;
    const conn = nav?.connection;
    if (!conn) return false;
    return conn.type === 'cellular' || Boolean(conn.saveData);
  } catch {
    return false;
  }
}
import {
  DEFAULT_DJ_MODE_CONFIG,
  DEFAULT_SAFE_CROSSFADE_CONFIG,
  DEFAULT_SPANISH_URBAN_SEEDS,
  DEFAULT_USER_EQ_CONFIG,
  USER_EQ_PRESET_MAP,
  type AlbumDetail,
  type AlbumSummary,
  type ArtistAffinityRecord,
  type ArtistDetail,
  type ArtistSummary,
  type AudioAnalyserData,
  type AudioEngineState,
  type AudioStreamQuality,
  type AutocompleteSuggestion,
  type DeckId,
  type DeckTransitionPlan,
  type DevicePresenceState,
  type DiscordRpcStatus,
  type DjFxToggles,
  type DjModeConfig,
  type DjSessionStyle,
  type DjTransitionType,
  type FavoriteArtistRecord,
  type HomeEditorialShelf,
  type ImportProgressEvent,
  type LikedTrackRecord,
  type LyricsDocument,
  type OfflineAudioEntry,
  type PlaybackTransferSnapshot,
  type PlayHistoryRecord,
  type PlaylistDetail,
  type PlaylistImportResult,
  type PlaylistRecord,
  type SafeCrossfadeConfig,
  type SearchResultBundle,
  type SeedArtistConfig,
  type SyncAuthState,
  type SyncMode,
  type TopResultMatch,
  type Track,
  type TrackAnalysis,
  type TrackCredits,
  type UserEqBandsDb,
  type UserEqConfig,
  type UserEqPresetId,
  type UserProfile,
} from '@pmusic/core';
import {
  appendLocalWrappedEvent,
  buildWrappedListenEvent,
  computePeriodTopStats,
  computeWrappedSummary,
  isWrappedSeason,
  loadLocalWrappedEvents,
  mergeWrappedEvents,
  type PeriodTopStats,
  type TopStatsWindow,
  type WrappedSummary,
} from '../lib/wrapped-stats.ts';
import {
  buildCompactAccountTasteProfile,
  mergeAccountTasteProfiles,
  normalizePlaylistStatKey,
  type AccountTasteProfile,
  type PlaylistPlayStat,
} from '../lib/taste-sync.ts';
import {
  FALLBACK_ALBUMS,
  FALLBACK_ARTISTS,
  FALLBACK_PLAYLISTS,
  FALLBACK_TRACKS,
  HttpProxyMusicProvider,
  LrcParser,
  LrclibLyricsProvider,
  PlaylistImporter,
} from '@pmusic/providers';
import {
  DjCuePlanner,
  DualDeckAudioEngine,
  MediaSessionController,
} from '@pmusic/audio-engine';
import { RecommendationEngine } from '@pmusic/recommendations';
import { LibraryStore, SyncEngine, type SavedAccountSlot } from '@pmusic/sync';
import {
  addTrackToSharedPlaylist,
  computeBlendScoreAndTracks,
  createJamSession,
  createSharedPlaylist,
  deleteOrLeaveSharedPlaylist,
  ensureOwnProfileExists,
  fetchActiveHostJamSession,
  fetchJamRequests,
  fetchPublicJamRequests,
  fetchPublicJamSession,
  fetchSharedPlaylistByCode,
  getAnonSupabaseClient,
  inviteMemberToSharedPlaylist,
  isJamQueueOpRequest,
  joinSharedPlaylistByCode,
  listFriendships,
  listSharedPlaylists,
  publishOrUpdateSharedPlaylistLink,
  removeTrackFromSharedPlaylist,
  respondFriendRequest,
  searchPublicCatalog,
  sendFriendRequest,
  stampTrackAddedBy,
  submitPublicJamQueueOp,
  submitPublicJamRequest,
  extractJamSyncMeta,
  updateJamRequestStatus,
  updateJamSessionState,
  type FriendListeningActivity,
  type FriendRecord,
  type JamQueueOpPayload,
  type JamRequestRecord,
  type JamSessionRecord,
  type SharedPlaylistRecord,
  type TrackAdderIdentity,
} from '../services/social-service.ts';
import {
  defaultPlatformBridge,
  getDesktopTrayPrefs,
  isElectronDesktopRuntime,
  setDesktopTrayPrefs,
  showNativeReleaseNotification,
} from '../platform/web-bridge.ts';
import {
  applyAmbientPaletteFromCover,
  getActiveAmbientTrackKey,
  prebakeMobileBackdrop,
  trimBackdropMemoryCaches,
} from '../utils/cover-color.ts';
import {
  applyAccentOverride,
  applyPMusicTheme,
  type PMusicAccentPresetId,
  type PMusicPlayerBarStyle,
  type PMusicThemeId,
} from '../utils/themes.ts';

export type MainNavTab = 'Inicio' | 'Explorar' | 'Buscar' | 'Biblioteca' | 'Social';
export type SocialSubTab = 'jam' | 'amigos' | 'compartidas' | 'top';
export type NowPlayingSubTab = 'Portada' | 'Letras' | 'Cola';
export type SearchScopeTab = 'Todo' | 'Canciones' | 'Artistas' | 'Álbumes' | 'Playlists';
export type LibraryCategoryTab =
  | 'Todo'
  | 'Playlists'
  | 'Artistas'
  | 'Me gusta'
  | 'Descargas'
  | 'Historial';
export type OfflineDownloadStatus = 'idle' | 'downloading' | 'downloaded' | 'error';
export type PMusicSurfaceStyle = 'liquid-glass' | 'frosted-glass' | 'simple';

function applySurfaceStyleClasses(style: PMusicSurfaceStyle): void {
  if (typeof document === 'undefined') return;
  const cls = document.documentElement.classList;
  cls.remove('pm-surface-balloon');
  cls.toggle('pm-surface-liquid', style === 'liquid-glass');
  cls.toggle('pm-surface-frosted', style === 'frosted-glass');
  cls.toggle('pm-surface-simple', style === 'simple');
  cls.toggle('pm-liquid-glass-all', style === 'liquid-glass');
  cls.toggle('pm-solid-modern', style === 'simple');
  cls.toggle('pm-reduced-transparency', style === 'simple');
}

export type RecentSearchItem =
  | { kind: 'track'; id: string; track: Track; addedAtMs: number }
  | {
      kind: 'artist';
      id: string;
      artistId: string;
      name: string;
      thumbnailUrl: string;
      addedAtMs: number;
    };

const RECENT_SEARCH_ITEMS_STORAGE_KEY = 'pmusic_recent_search_items_v1';
const CLIENT_SEARCH_CACHE_TTL_MS = 3 * 60_000;
const clientSearchCache = new Map<
  string,
  { at: number; bundle: SearchResultBundle; best?: TopResultMatch; suggestions: AutocompleteSuggestion[] }
>();

function buildDefaultRecentSearchItems(): RecentSearchItem[] {
  const now = Date.now();
  const trackItems: RecentSearchItem[] = FALLBACK_TRACKS.slice(0, 4).map((track, idx) => ({
    kind: 'track',
    id: `track:${track.id}`,
    track,
    addedAtMs: now - idx * 60_000,
  }));
  const firstArtist = FALLBACK_ARTISTS[0];
  if (firstArtist) {
    trackItems.splice(1, 0, {
      kind: 'artist',
      id: `artist:${firstArtist.id}`,
      artistId: firstArtist.id,
      name: firstArtist.name,
      thumbnailUrl: firstArtist.thumbnailUrl,
      addedAtMs: now - 30_000,
    });
  }
  return trackItems;
}

function persistRecentSearchItems(items: RecentSearchItem[]): void {
  void defaultPlatformBridge.preferencesStorage
    .setItem(RECENT_SEARCH_ITEMS_STORAGE_KEY, JSON.stringify(items))
    .catch(() => {});
}

export type ActiveDetailView =
  | { kind: 'artist'; data: ArtistDetail; isLoading?: boolean; transitionKey?: string }
  | { kind: 'album'; data: AlbumDetail; isLoading?: boolean; transitionKey?: string }
  | { kind: 'playlist'; data: PlaylistDetail }
  | { kind: 'local_playlist'; playlistId: string }
  | { kind: 'shared_playlist'; sharedId: string }
  | null;

const DETAIL_CLIENT_CACHE_TTL_MS = 15 * 60_000;
const artistClientCache = new Map<string, { at: number; data: ArtistDetail }>();
const albumClientCache = new Map<string, { at: number; data: AlbumDetail }>();
const inFlightArtistPrefetch = new Set<string>();
let detailRequestSeq = 0;

function readClientCache<T>(map: Map<string, { at: number; data: T }>, key: string): T | null {
  const hit = map.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at >= DETAIL_CLIENT_CACHE_TTL_MS) {
    map.delete(key);
    return null;
  }
  return hit.data;
}

function writeClientCache<T>(map: Map<string, { at: number; data: T }>, key: string, data: T): void {
  map.set(key, { at: Date.now(), data });
  if (map.size > 24) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }
}

// Instantiate domain services once
const musicProvider = new HttpProxyMusicProvider({
  platformBridge: defaultPlatformBridge,
});
const lrcParser = new LrcParser();
const lyricsProvider = new LrclibLyricsProvider({
  parser: lrcParser,
  musicProvider,
});
const playlistImporter = new PlaylistImporter({
  musicProvider,
});
const libraryStore = new LibraryStore(defaultPlatformBridge.preferencesStorage);

const DEFAULT_USER_SUPABASE_URL = 'https://zlaxnxkfwngmwqnqnqtu.supabase.co';
const DEFAULT_USER_SUPABASE_KEY = 'sb_publishable_FksjG7J-ZnFPpsT07uLg3g_kzCzgBdJ';
const envMeta = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
const resolvedSupabaseUrl = envMeta.VITE_SUPABASE_URL ?? DEFAULT_USER_SUPABASE_URL;
const resolvedSupabaseKey = envMeta.VITE_SUPABASE_ANON_KEY ?? DEFAULT_USER_SUPABASE_KEY;

const syncEngine = new SyncEngine({
  supabaseUrl: resolvedSupabaseUrl,
  supabaseAnonKey: resolvedSupabaseKey,
  preferencesStorage: defaultPlatformBridge.preferencesStorage,
  libraryStore,
});

export function getSyncSupabaseClient() {
  return syncEngine.getSupabaseClient();
}

const recommendationEngine = new RecommendationEngine({
  musicProvider,
  storage: {
    loadAffinities: async () => libraryStore.getAffinities(),
    saveAffinities: async (recs) => libraryStore.setAffinities(recs),
    loadHistory: async () => libraryStore.getPlayHistory(),
    saveHistory: async (recs) => libraryStore.setPlayHistory(recs),
  },
});

async function resolveTrackStreamUrl(track: Track): Promise<string> {
  const quality = currentStreamQualityPref;
  const baseUrl = await defaultPlatformBridge.buildStreamUrl(track.id, quality);
  if (baseUrl.startsWith('blob:') || baseUrl.startsWith('data:')) {
    return baseUrl;
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new Error('TRACK_OFFLINE_UNAVAILABLE');
  }
  const sep = baseUrl.includes('?') ? '&' : '?';
  const artist = track.artists[0]?.name ?? '';
  return `${baseUrl}${sep}title=${encodeURIComponent(track.title)}&artist=${encodeURIComponent(artist)}&durationSec=${Math.round(track.durationSec || 200)}`;
}

let currentStreamQualityPref: AudioStreamQuality = 'high';

const djPlanner = new DjCuePlanner();
const audioEngine = new DualDeckAudioEngine({
  resolveStreamUrl: resolveTrackStreamUrl,
});

export function getLiveAnalyserData(): AudioAnalyserData {
  return audioEngine.getAnalyserData();
}

export function getLivePlaybackPosition(): {
  positionSec: number;
  durationSec: number;
  isPlaying: boolean;
  isBuffering: boolean;
  isPaused: boolean;
  isEnded: boolean;
  isSeeking: boolean;
  isTransitioning: boolean;
  transitionProgress01: number;
  incomingPositionSec?: number;
  incomingDurationSec?: number;
} {
  return audioEngine.getLivePlaybackSnapshot();
}

function isLiveRuntime(): boolean {
  if (typeof window === 'undefined') return false;
  const proto = window.location?.protocol ?? '';
  return proto.startsWith('http') || proto === 'file:' || isElectronDesktopRuntime();
}

function isVitestEnv(): boolean {
  return Boolean((import.meta as any).vitest) || (import.meta as any).env?.MODE === 'test';
}

function isMobileHardwareVolumeRuntime(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.location?.hostname === 'appassets.pmusic.local') return true;
  if (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(max-width: 767px), (hover: none) and (pointer: coarse)').matches
  ) {
    return true;
  }
  return false;
}

export const DEFAULT_DISCORD_CLIENT_ID = '1574169804590416005';

export interface DiscordRpcConfig {
  clientId: string;
  showTimestamps: boolean;
  showArtwork: boolean;
  showWhenPaused: boolean;
  displayMode: 'song' | 'artist' | 'app';
}

const USER_PREFS_STORAGE_KEY = 'pmusic_user_prefs_v1';
const HOME_HISTORY_MIGRATION_KEY = 'pmusic_home_history_clean_v3';
const validFallbackTrackMap = new Map(FALLBACK_TRACKS.map((t) => [t.id, t]));

function isLegacySyntheticTrackId(id: string | undefined | null): boolean {
  if (!id) return true;
  if (
    id.startsWith('dz:') ||
    id.startsWith('yt:') ||
    id.startsWith('local:') ||
    id.startsWith('offline:')
  ) {
    return false;
  }
  return !validFallbackTrackMap.has(id);
}

function isLegacyOutdatedTrack(track: Track | undefined | null): boolean {
  if (!track) return true;
  if (isLegacySyntheticTrackId(track.id)) return true;
  if (track.album?.name === 'Cayetano Remix') return true;
  const fallback = validFallbackTrackMap.get(track.id);
  if (fallback && fallback.title !== track.title) return true;
  return false;
}
let lastWrappedTrackId = '';
let lastWrappedRecordedAtMs = 0;

function detectDevicePlatform(): 'windows' | 'android' | 'web' {
  if (typeof window === 'undefined') return 'web';
  if (window.location?.hostname === 'appassets.pmusic.local') return 'android';
  if ((window as any).pmusicDesktop?.runtime === 'electron') return 'windows';
  if (typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent)) return 'android';
  return 'web';
}

function recordWrappedListenIfEligible(
  track: Track | null | undefined,
  playedSec: number,
  sourceContext = 'library',
  isRepeatLoop = false
): void {
  if (!track || !track.id) return;
  const dur = Math.max(1, track.durationSec || 180);
  const minThreshold = dur < 60 ? dur * 0.5 : 30;
  if (playedSec < minThreshold) return;
  const nowMs = Date.now();
  if (track.id === lastWrappedTrackId && nowMs - lastWrappedRecordedAtMs < 20_000 && !isRepeatLoop) {
    return;
  }
  lastWrappedTrackId = track.id;
  lastWrappedRecordedAtMs = nowMs;

  const event = buildWrappedListenEvent({
    track,
    playedSec,
    deviceType: detectDevicePlatform(),
    sourceContext,
    isRepeatLoop,
  });
  const nextList = appendLocalWrappedEvent(event);
  usePMusicStore.setState({ wrappedLocalCount: nextList.length });
  void syncEngine.recordListenEvent?.(event);
}

let sleepTimerInterval: ReturnType<typeof setInterval> | null = null;
let seekAutoTriggerTimer: ReturnType<typeof setTimeout> | null = null;

function normTargetToDb(target: 'quiet' | 'normal' | 'loud'): number {
  if (target === 'quiet') return -14;
  if (target === 'loud') return -8;
  return -11;
}

let importAbortController: AbortController | null = null;
let searchTicket = 0;
let lyricsTicket = 0;
let djAutoTransitionInFlight = false;
let djAutoTransitionStartedAtMs = 0;
let autoAdvanceInFlight = false;
let manualTrackSwitchInFlight = false;
let manualSwitchEpoch = 0;
let djPreloadedKey = '';
let djSessionEpoch = 0;
let suppressedAutoTransitionTrackId: string | null = null;
let lastObservedPlayback: { trackId: string; posSec: number } | null = null;
let lastAutoAdvanceGuard: { trackId: string; atMs: number } = { trackId: '', atMs: 0 };
let engineBindingsAttached = false;
let playbackMonitorTimer: ReturnType<typeof setInterval> | null = null;
let hiddenSkipTick = 0;
let lastMediaSessionSyncKey = '';
let lastMediaSessionSyncWallMs = 0;
let homeShelvesBuildEpoch = 0;
let socialRealtimeChannel: any = null;
let socialSubscribedUserId = '';
let friendPresenceChannel: any = null;
let friendPresenceReady = false;
let friendPresenceUserId = '';
let triggerPresenceSync: (() => void) | null = null;
const SHARE_LISTENING_STORAGE_KEY = 'pmusic.social.shareListening';

function readShareListeningPref(): boolean {
  try {
    return (
      typeof localStorage === 'undefined' ||
      localStorage.getItem(SHARE_LISTENING_STORAGE_KEY) !== '0'
    );
  } catch {
    return true;
  }
}

export const JAM_IDLE_TIMEOUT_MS = 5 * 60 * 1000;

let jamRealtimeChannel: any = null;
let jamFallbackPollTimer: ReturnType<typeof setInterval> | null = null;
let jamHostPushTimer: ReturnType<typeof setTimeout> | null = null;
let jamIdleSinceMs: number | null = null;
let jamIdleCheckTimer: ReturnType<typeof setInterval> | null = null;
const processedJamRequestIds = new Set<string>();
const decodedAudioAnalyzedIds = new Set<string>();
const decodedAudioInFlightIds = new Set<string>();
const hydratedContributorIds = new Set<string>();
let activePlaylistDownloadCancelled = false;

export interface PlaylistAppearanceEntry {
  coverUrl?: string | null;
  bannerUrl?: string | null;
  bannerEnabled?: boolean;
  coverStyleSeed?: number;
}

export type LyricsVisualStyle =
  | 'classic'
  | 'wordflow'
  | 'kinetic'
  | 'neon'
  | 'typewriter'
  | 'poster'
  | 'focus'
  | 'editorial';
export type NowPlayingBackdropStyle =
  | 'fluid'
  | 'paint'
  | 'pulse'
  | 'minimal';
export type RepeatMode = 'off' | 'all' | 'one';

const BACKDROP_STYLES: readonly NowPlayingBackdropStyle[] = [
  'pulse',
  'fluid',
  'paint',
  'minimal',
];

function parseNowPlayingBackdropStyle(
  value: unknown,
  fallback: NowPlayingBackdropStyle = 'pulse'
): NowPlayingBackdropStyle {
  if (typeof value !== 'string') return fallback;
  if ((BACKDROP_STYLES as readonly string[]).includes(value)) {
    return value as NowPlayingBackdropStyle;
  }
  if (
    value === 'prism' ||
    value === 'nebula' ||
    value === 'rhythm' ||
    value === 'mesh' ||
    value === 'vinyl' ||
    value === 'waves'
  ) {
    return 'pulse';
  }
  return fallback;
}

function canonicalizeArtistRefName(id: string | undefined, name: string): { id?: string; name: string } {
  const norm = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
  if (norm === 'cruz cafune' || norm === 'cruzzi' || id === '10125390') {
    return { id: '73148212', name: 'Cruzzi' };
  }
  return id ? { id, name } : { name };
}

function canonicalizeTrackArtists(track: Track): Track {
  let changed = false;
  const nextArtists = track.artists.map((ar) => {
    const canon = canonicalizeArtistRefName(ar.id, ar.name);
    if (canon.name !== ar.name || canon.id !== ar.id) changed = true;
    return canon;
  });
  return changed ? { ...track, artists: nextArtists } : track;
}

const HOME_SHELVES_CACHE_KEY = 'pmusic_home_shelves_cache_v3';
const HOME_SHELVES_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

interface CachedHomeShelvesEntry {
  ownerUserId: string | null;
  savedAt: number;
  shelves: HomeEditorialShelf[];
}

function isLegacyOrFallbackShelves(shelves: HomeEditorialShelf[]): boolean {
  if (!Array.isArray(shelves) || shelves.length === 0) return true;
  const hasLegacyMixId = shelves.some((s) =>
    (s.mixes ?? []).some((m) => m.id === 'mix_cruz_urbano_es')
  );
  if (hasLegacyMixId) return true;
  const hasSyntheticFallback = shelves.some((s) =>
    (s.tracks ?? []).some((t) => t.id.startsWith('trk_fb_') || t.id.startsWith('fallback_'))
  );
  return hasSyntheticFallback;
}

function readCachedHomeShelves(
  expectedOwnerUserId?: string | null
): CachedHomeShelvesEntry | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    localStorage.removeItem('pmusic_home_shelves_cache_v1');
    localStorage.removeItem('pmusic_home_shelves_cache_v2');
    const raw = localStorage.getItem(HOME_SHELVES_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CachedHomeShelvesEntry> | null;
    if (
      !parsed ||
      !Array.isArray(parsed.shelves) ||
      parsed.shelves.length === 0 ||
      isLegacyOrFallbackShelves(parsed.shelves)
    ) {
      return null;
    }
    const storedOwner = parsed.ownerUserId ?? null;
    if (expectedOwnerUserId !== undefined && storedOwner !== (expectedOwnerUserId ?? null)) {
      return null;
    }
    return {
      ownerUserId: storedOwner,
      savedAt: typeof parsed.savedAt === 'number' ? parsed.savedAt : 0,
      shelves: parsed.shelves,
    };
  } catch {
    return null;
  }
}

function saveCachedHomeShelves(
  shelves: HomeEditorialShelf[],
  ownerUserId?: string | null
): void {
  try {
    if (
      typeof localStorage === 'undefined' ||
      !shelves ||
      shelves.length === 0 ||
      isLegacyOrFallbackShelves(shelves)
    ) {
      return;
    }
    const entry: CachedHomeShelvesEntry = {
      ownerUserId: ownerUserId ?? null,
      savedAt: Date.now(),
      shelves: shelves.slice(0, 6),
    };
    localStorage.setItem(HOME_SHELVES_CACHE_KEY, JSON.stringify(entry));
  } catch {
    // ignore storage quota errors
  }
}

const CACHED_PROFILE_STORAGE_KEY = 'pmusic.cached_profile.v1';
const CACHED_SHARED_PLAYLISTS_KEY = 'pmusic.cached_shared_playlists.v1';

async function writeCachedProfile(
  ownerUserId: string | null | undefined,
  profile: UserProfile | null
): Promise<void> {
  if (!ownerUserId || !profile) return;
  try {
    await defaultPlatformBridge.preferencesStorage.setItem(
      CACHED_PROFILE_STORAGE_KEY,
      JSON.stringify({ ownerUserId, profile })
    );
  } catch {
    // ignore storage quota errors
  }
}

async function writeCachedSharedPlaylists(
  ownerUserId: string | null | undefined,
  sharedPlaylists: SharedPlaylistRecord[]
): Promise<void> {
  if (!ownerUserId) return;
  try {
    await defaultPlatformBridge.preferencesStorage.setItem(
      CACHED_SHARED_PLAYLISTS_KEY,
      JSON.stringify({ ownerUserId, sharedPlaylists })
    );
  } catch {
    // ignore storage quota errors
  }
}

async function clearCachedAccountArtifacts(): Promise<void> {
  try {
    await Promise.all([
      defaultPlatformBridge.preferencesStorage.removeItem(CACHED_PROFILE_STORAGE_KEY),
      defaultPlatformBridge.preferencesStorage.removeItem(CACHED_SHARED_PLAYLISTS_KEY),
    ]);
  } catch {
    // ignore storage errors
  }
}

function parseCachedForOwner<T>(raw: string | null | undefined, expectedUserId: string | null): T | null {
  if (!raw || !expectedUserId) return null;
  try {
    const parsed = JSON.parse(raw) as { ownerUserId?: string; profile?: T; sharedPlaylists?: T };
    if (parsed.ownerUserId !== expectedUserId) return null;
    if ('profile' in parsed) return (parsed.profile ?? null) as T | null;
    if ('sharedPlaylists' in parsed) return (parsed.sharedPlaylists ?? null) as T | null;
    return null;
  } catch {
    return null;
  }
}

async function preloadTopHomeCovers(shelves: HomeEditorialShelf[]): Promise<void> {
  if (typeof Image === 'undefined') return;
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const shelf of shelves) {
    for (const t of shelf.tracks ?? []) {
      const u = optimizeArtworkUrl(t.thumbnailUrl, 'row');
      if (u && !seen.has(u)) {
        seen.add(u);
        urls.push(u);
      }
      if (urls.length >= 8) break;
    }
    if (urls.length >= 8) break;
  }
  if (urls.length === 0) return;
  const loaders = urls.map(
    (u) =>
      new Promise<void>((resolve) => {
        try {
          const img = new Image();
          img.decoding = 'async';
          img.onload = () => resolve();
          img.onerror = () => resolve();
          img.src = u;
          if (img.complete) resolve();
        } catch {
          resolve();
        }
      })
  );
  await Promise.race([
    Promise.all(loaders),
    new Promise<void>((resolve) => setTimeout(resolve, 900)),
  ]);
}

function fisherYatesShuffle<T>(items: readonly T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
  return arr;
}

function normalizeTrackShuffleTitle(title: string): string {
  return String(title ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\([^)]*(?:feat\.?|ft\.?|con|with|official|audio|video)[^)]*\)/gi, ' ')
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Diversifies shuffled queues across albums/releases and removes duplicate song titles
 * (e.g. a single release appearing alongside its album version) so shuffle truly spans
 * an artist's catalog instead of clustering onto one latest album.
 */
export function diversifyAndShuffleTracks(
  tracks: readonly Track[],
  avoidFirstTrackId?: string
): Track[] {
  if (tracks.length <= 1) return [...tracks];

  const deduped: Track[] = [];
  const seenIds = new Set<string>();
  const seenTitleArtist = new Set<string>();
  for (const t of tracks) {
    if (!t?.id || seenIds.has(t.id)) continue;
    const normTitle = normalizeTrackShuffleTitle(t.title);
    const primaryArtist = (t.artists[0]?.name ?? '').toLowerCase().trim();
    const titleKey = `${normTitle}::${primaryArtist}`;
    if (normTitle && seenTitleArtist.has(titleKey)) continue;
    seenIds.add(t.id);
    if (normTitle) seenTitleArtist.add(titleKey);
    deduped.push(t);
  }
  if (deduped.length <= 1) return deduped;

  const buckets = new Map<string, Track[]>();
  for (const t of deduped) {
    const albumKey =
      (t.album?.id && `id:${t.album.id}`) ||
      (t.album?.name && `name:${t.album.name.toLowerCase().trim()}`) ||
      `single:${t.id}`;
    const bucket = buckets.get(albumKey);
    if (bucket) bucket.push(t);
    else buckets.set(albumKey, [t]);
  }

  for (const [k, list] of buckets.entries()) {
    buckets.set(k, fisherYatesShuffle(list));
  }

  const result: Track[] = [];
  let prevAlbumKey: string | null = null;
  while (buckets.size > 0) {
    const allKeys = Array.from(buckets.keys());
    const eligible = allKeys.filter((k) => k !== prevAlbumKey);
    const poolKeys = eligible.length > 0 ? eligible : allKeys;

    let totalWeight = 0;
    for (const k of poolKeys) totalWeight += buckets.get(k)!.length;
    let pick = Math.random() * totalWeight;
    let chosenKey = poolKeys[0]!;
    for (const k of poolKeys) {
      pick -= buckets.get(k)!.length;
      if (pick <= 0) {
        chosenKey = k;
        break;
      }
    }

    const bucket = buckets.get(chosenKey)!;
    const nextTrack = bucket.pop()!;
    result.push(nextTrack);
    prevAlbumKey = chosenKey;
    if (bucket.length === 0) {
      buckets.delete(chosenKey);
    }
  }

  if (avoidFirstTrackId && result[0]?.id === avoidFirstTrackId && result.length > 1) {
    const altIdx = 1 + Math.floor(Math.random() * (result.length - 1));
    const tmp = result[0]!;
    result[0] = result[altIdx]!;
    result[altIdx] = tmp;
  }

  return result;
}

let activeArtistShuffleToken = 0;

const preloadedCoverUrls = new Set<string>();
function preloadTrackCoverArt(track: Track | null | undefined): void {
  if (!track || typeof Image === 'undefined') return;
  const shouldPrebakeMobile = isMobileHardwareVolumeRuntime();
  for (const url of [track.thumbnailHighUrl, track.thumbnailUrl]) {
    if (!url || preloadedCoverUrls.has(url)) continue;
    preloadedCoverUrls.add(url);
    if (preloadedCoverUrls.size > 12) {
      const oldest = preloadedCoverUrls.values().next().value;
      if (oldest) preloadedCoverUrls.delete(oldest);
    }
    try {
      const img = new Image();
      img.decoding = 'async';
      if (shouldPrebakeMobile) {
        img.onload = () => {
          prebakeMobileBackdrop(url, img);
        };
      }
      img.src = url;
      if (shouldPrebakeMobile && img.complete && img.naturalWidth > 0) {
        prebakeMobileBackdrop(url, img);
      }
    } catch {
      // ignore image preload errors
    }
  }
}
export type TrackMenuState = {
  track: Track;
  x: number;
  y: number;
  playlistId?: string;
} | null;

let toastTimer: ReturnType<typeof setTimeout> | null = null;
let cloudPrefsSaveTimer: ReturnType<typeof setTimeout> | null = null;
let pendingCloudPrefsPayload: Record<string, unknown> | null = null;
let cloudLibrarySyncTimer: ReturnType<typeof setTimeout> | null = null;
let prefsUnloadBound = false;
let lastLocalPrefsSavedAt = 0;
let cloudFocusSyncAt = 0;
let oauthCallbackInFlight = false;
const handledOAuthTokens = new Set<string>();

function extractOAuthTokenKey(callbackUrl: string): string | null {
  try {
    const normalized = callbackUrl.replace('#', '?');
    const parsed = new URL(normalized.includes('://') ? normalized : `https://pmusic.local/${normalized}`);
    const code = parsed.searchParams.get('code');
    if (code) return `code:${code}`;
    const accessToken = parsed.searchParams.get('access_token');
    if (accessToken) return `token:${accessToken.slice(0, 32)}`;
  } catch {
    // ignore malformed url
  }
  return null;
}

function scheduleLibraryCloudSync(immediate = false): void {
  if (cloudLibrarySyncTimer) {
    clearTimeout(cloudLibrarySyncTimer);
    cloudLibrarySyncTimer = null;
  }
  const runSync = () => {
    cloudLibrarySyncTimer = null;
    if (!syncEngine.getAuthState().connected) return;
    void syncEngine.syncNow().then(() => {
      void syncEngine.sendRemoteCommand({ targetDeviceId: '*', type: 'library_sync' });
    });
  };
  if (immediate) {
    runSync();
    return;
  }
  cloudLibrarySyncTimer = setTimeout(runSync, 350);
}

function applyAmbientPaletteForTrack(track: Track | null, durationMs = 1100): void {
  applyAmbientPaletteFromCover(track, durationMs);
}

function normalizeTrackMetaKey(t: Track): string {
  const title = (t.title ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\((feat|ft|with|official|video|audio|lyric|visualizer|en vivo)[^)]*\)/gi, '')
    .replace(/\[(official|video|audio|lyric|visualizer)[^\]]*\]/gi, '')
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const artist = (t.artists?.[0]?.name ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return `${title}::${artist}`;
}

const sessionPlayedTrackIds = new Set<string>();
const sessionPlayedTrackKeys = new Set<string>();
const activePlaylistExcludedIds = new Set<string>();
const activePlaylistExcludedKeys = new Set<string>();

function recordSessionPlayedTrack(t: Track | null | undefined): void {
  if (!t?.id) return;
  sessionPlayedTrackIds.add(t.id);
  const k = normalizeTrackMetaKey(t);
  if (k !== '::') sessionPlayedTrackKeys.add(k);
}

function clearSessionTrackMemory(): void {
  sessionPlayedTrackIds.clear();
  sessionPlayedTrackKeys.clear();
  activePlaylistExcludedIds.clear();
  activePlaylistExcludedKeys.clear();
}

function isArtistAliasMatch(a: string, b: string): boolean {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (
    (na === 'cruzzi' || na === 'cruz cafune') &&
    (nb === 'cruzzi' || nb === 'cruz cafune')
  ) {
    return true;
  }
  return false;
}

function parseFanCountText(txt?: string): number {
  if (!txt) return 0;
  const low = txt.trim().toLowerCase();
  const numMatch = low.match(/([\d.,]+)/);
  if (!numMatch) return 0;
  const cleanNum = Number.parseFloat(numMatch[1]!.replace(/\.(?=\d{3}(?:\D|$))/g, '').replace(',', '.'));
  if (!Number.isFinite(cleanNum)) return 0;
  if (/\bm\b|\bmill/i.test(low)) return Math.round(cleanNum * 1_000_000);
  if (/\bmil\b|\bk\b/i.test(low)) return Math.round(cleanNum * 1_000);
  return Math.round(cleanNum);
}

export interface PMusicStoreState {
  // Navigation & Sheets
  activeTab: MainNavTab;
  appReady: boolean;
  homeFeedReady: boolean;
  carModeOpen: boolean;
  sidebarCollapsed: boolean;
  rightPanelOpen: boolean;
  nowPlayingOpen: boolean;
  nowPlayingTab: NowPlayingSubTab;
  eqSheetOpen: boolean;
  djPopoverOpen: boolean;
  audioPanelTab: 'dj' | 'eq' | 'display';
  outgoingTransitionTrack: Track | null;
  incomingTransitionTrack: Track | null;
  devicesSheetOpen: boolean;
  importModalOpen: boolean;
  settingsOpen: boolean;
  settingsReturnToMobileHub: boolean;
  settingsInitialCategory:
    | 'apariencia'
    | 'audio'
    | 'dj'
    | 'discord'
    | 'reproduccion'
    | 'cuenta'
    | null;
  mobileHubOpen: boolean;
  spotlightOpen: boolean;
  activeDetailView: ActiveDetailView;
  detailViewHistory: Exclude<ActiveDetailView, null>[];
  isOfflineNetwork: boolean;
  isAppHidden: boolean;
  surfaceStyle: PMusicSurfaceStyle;
  liquidGlassMode: boolean;
  ambientMotionEnabled: boolean;
  graphicSaverMode: boolean;
  reducedMotionPref: boolean;
  themeId: PMusicThemeId;
  playerBarStyle: PMusicPlayerBarStyle;
  accentPreset: PMusicAccentPresetId;
  lastTrackDirection: 'next' | 'prev' | 'none';
  visualizerEnabled: boolean;
  lyricsSize: 'normal' | 'large' | 'xl';
  lyricsBlurEnabled: boolean;
  lyricsStyle: LyricsVisualStyle;
  nowPlayingBackdropStyle: NowPlayingBackdropStyle;
  alwaysShuffle: boolean;
  skipSameAlbumCoverTransition: boolean;
  marqueeTextEnabled: boolean;
  showRemainingTime: boolean;
  discordRpcEnabled: boolean;
  discordRpcConfig: DiscordRpcConfig;
  discordRpcStatus: DiscordRpcStatus;
  playbackRate: number;
  preservesPitch: boolean;
  audioNormalization: boolean;
  normalizationTarget: 'quiet' | 'normal' | 'loud';
  stereoBalance: number;
  monoAudio: boolean;
  streamQuality: AudioStreamQuality;
  sleepTimerMode: 'off' | 'minutes' | 'end_of_track';
  sleepTimerRemainingSec: number;
  trackInfoModalTrack: Track | null;
  addToPlaylistModalTrack: Track | null;
  trackMenu: TrackMenuState;
  toastMessage: string | null;

  // Playback & Audio
  currentTrack: Track;
  queue: Track[];
  userQueueCount: number;
  recommendedQueue: Track[];
  sessionPrevStack: Track[];
  isLoadingRecommendedQueue: boolean;
  unshuffledQueue: Track[];
  queueIndex: number;
  shuffleEnabled: boolean;
  repeatMode: RepeatMode;
  isPlaying: boolean;
  isBuffering: boolean;
  positionSec: number;
  durationSec: number;
  volume: number;
  activeDeck: DeckId;
  isTransitioning: boolean;
  activeTransitionType?: DjTransitionType;
  transitionProgress01: number;
  transitionDurationSec: number;
  autoplayEnabled: boolean;

  // Audio Modes (DJ AutoMix, Safe Crossfade, 5-Band EQ)
  djMode: DjModeConfig;
  safeCrossfade: SafeCrossfadeConfig;
  userEq: UserEqConfig;
  trackAnalyses: Record<string, TrackAnalysis>;
  activeTransitionPlan: DeckTransitionPlan | null;

  // Synced Lyrics
  currentLyrics: LyricsDocument | null;
  activeLyricIndex: number;
  lyricsUserScrolled: boolean;

  // Home & Search & Recommendations
  homeShelves: HomeEditorialShelf[];
  searchQuery: string;
  isSearching: boolean;
  searchScope: SearchScopeTab;
  searchResults: SearchResultBundle;
  bestResult?: TopResultMatch;
  autocompleteSuggestions: AutocompleteSuggestion[];
  recentSearches: string[];
  recentSearchItems: RecentSearchItem[];
  seedArtists: SeedArtistConfig[];
  affinityProfile: ArtistAffinityRecord[];
  exploreSimilarTracks: Track[];
  exploreEmergingArtists: ArtistSummary[];
  isLoadingExplore: boolean;

  // Library & Offline Cache
  libraryCategory: LibraryCategoryTab;
  libraryFilterQuery: string;
  playlists: PlaylistRecord[];
  playlistPlayCounts: Record<string, PlaylistPlayStat>;
  dismissedPlaylistRecs: Record<string, string[]>;
  playlistAppearances: Record<string, PlaylistAppearanceEntry>;
  playlistContextMenu: { kind: 'local' | 'shared'; playlistId: string; x: number; y: number } | null;
  playlistAppearanceModal: { kind: 'local' | 'shared'; playlistId: string } | null;
  playlistDownloadProgress: { playlistId: string; completed: number; total: number } | null;
  likedTracks: LikedTrackRecord[];
  playHistory: PlayHistoryRecord[];
  offlineDownloads: Record<string, OfflineDownloadStatus>;
  offlineEntries: OfflineAudioEntry[];
  wifiOnlyDownloads: boolean;
  offlineAutoPlaylistIds: string[];

  // Importer
  importUrlInput: string;
  importProgress: ImportProgressEvent | null;
  importResult: PlaylistImportResult | null;
  importError: string | null;

  // Sync & Connect Devices
  syncMode: SyncMode;
  selfDeviceId: string;
  deviceName: string;
  supabaseUrlInput: string;
  supabaseAnonKeyInput: string;
  authState: SyncAuthState;
  onlineDevices: DevicePresenceState[];
  lastTransferBanner: string | null;
  remoteControlledDeviceId: string | null;
  remoteDeviceSnapshot: {
    deviceId: string;
    deviceName: string;
    trackTitle: string;
    trackArtist: string;
    thumbnailUrl?: string;
    isPlaying: boolean;
    positionMs: number;
    durationMs: number;
    volume: number;
  } | null;

  // Onboarding, Profile, Social & Wrapped
  authOnboardingOpen: boolean;
  needsProfileSetup: boolean;
  userProfile: UserProfile | null;
  authCallbackError: string | null;
  favoriteArtists: FavoriteArtistRecord[];
  friends: FriendRecord[];
  sharedPlaylists: SharedPlaylistRecord[];
  socialSubTab: SocialSubTab;
  shareListeningActivity: boolean;
  friendActivities: Record<string, FriendListeningActivity>;
  personalTopStats: Record<TopStatsWindow, PeriodTopStats | null>;
  minimizeToTrayOnClose: boolean;
  desktopTrackNotifications: boolean;
  releaseNotificationsEnabled: boolean;
  releaseNotifications: ReleaseNotificationItem[];
  releaseNotificationsChecking: boolean;
  notificationsPanelOpen: boolean;
  activeJamCode: string | null;
  activeJamSession: JamSessionRecord | null;
  activeJamRole: 'host' | 'guest' | null;
  activeJamRequests: JamRequestRecord[];
  jamInviteModalOpen: boolean;
  wrappedModalOpen: boolean;
  wrappedSummary: WrappedSummary | null;
  wrappedSoundtrackTracks: Track[];
  wrappedSeasonActive: boolean;
  wrappedLocalCount: number;

  // Actions
  initApp: () => Promise<void>;
  setActiveTab: (tab: MainNavTab) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setRightPanelOpen: (open: boolean) => void;
  setNowPlayingOpen: (open: boolean) => void;
  setNowPlayingTab: (tab: NowPlayingSubTab) => void;
  setEqSheetOpen: (open: boolean) => void;
  setDjPopoverOpen: (open: boolean) => void;
  setAudioPanelTab: (tab: 'dj' | 'eq' | 'display') => void;
  setCarModeOpen: (open: boolean) => void;
  setAppHidden: (hidden: boolean) => void;
  playFromVoiceQuery: (query: string) => Promise<void>;
  setDevicesSheetOpen: (open: boolean) => void;
  setImportModalOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  setMobileHubOpen: (open: boolean) => void;
  openSettingsCategory: (
    cat: 'apariencia' | 'audio' | 'dj' | 'discord' | 'reproduccion' | 'cuenta'
  ) => void;
  clearPlayHistory: () => Promise<void>;
  setSpotlightOpen: (open: boolean) => void;
  openArtistDetail: (
    artistId: string,
    hint?: { name?: string; thumbnailUrl?: string }
  ) => Promise<void>;
  prefetchArtistDetail: (
    artistId: string,
    hint?: { name?: string; thumbnailUrl?: string }
  ) => void;
  openAlbumDetail: (
    albumId: string,
    hint?: { title?: string; artist?: string; thumbnailUrl?: string }
  ) => Promise<void>;
  openPlaylistDetail: (playlistId: string) => Promise<void>;
  fetchTrackCredits: (track: Track) => Promise<TrackCredits | null>;
  openLocalPlaylistDetail: (playlistId: string) => void;
  openSharedPlaylistDetail: (sharedId: string) => void;
  closeDetailView: () => void;
  showToast: (message: string) => void;
  openTrackMenu: (track: Track, x: number, y: number, playlistId?: string) => void;
  closeTrackMenu: () => void;

  // Playback Actions
  playTrack: (
    track: Track,
    newQueue?: Track[],
    startSec?: number,
    direction?: 'next' | 'prev'
  ) => Promise<void>;
  playCollection: (
    tracks: Track[],
    options?: {
      forceShuffle?: boolean;
      isPlaylist?: boolean;
      startIndex?: number;
    }
  ) => Promise<void>;
  togglePlayPause: () => Promise<void>;
  nextTrack: (isAutoAdvance?: boolean) => Promise<void>;
  prevTrack: () => Promise<void>;
  toggleShuffle: () => void;
  cycleRepeatMode: () => void;
  seekTo: (positionSec: number) => void;
  setVolume: (volume01: number) => void;
  toggleMute: () => void;
  moveQueueItem: (fromIndex: number, toIndex: number) => void;
  removeQueueItem: (index: number) => void;
  clearUpNextQueue: () => void;
  addToQueue: (track: Track) => void;
  playNextInQueue: (track: Track) => void;
  playQueueIndex: (index: number) => Promise<void>;
  replenishRecommendedQueue: (force?: boolean) => Promise<void>;
  promoteRecommendedTrack: (trackId: string) => void;
  dismissRecommendedTrack: (trackId: string) => void;
  startTrackRadio: (track: Track, withDj?: boolean) => Promise<void>;
  playArtistShuffled: (
    artist: ArtistSummary,
    topSongs: Track[],
    albums?: AlbumSummary[],
    singles?: AlbumSummary[]
  ) => Promise<void>;
  startFullDjRadio: () => Promise<void>;
  setAutoplayEnabled: (enabled: boolean) => void;
  setAmbientMotionEnabled: (enabled: boolean) => void;
  setNowPlayingBackdropStyle: (style: NowPlayingBackdropStyle) => void;
  setAlwaysShuffle: (enabled: boolean) => void;
  setSkipSameAlbumCoverTransition: (enabled: boolean) => void;
  setMarqueeTextEnabled: (enabled: boolean) => void;
  setShowRemainingTime: (enabled: boolean) => void;

  // DJ AutoMix & EQ Actions
  toggleDjMode: (enabled?: boolean) => Promise<void>;
  setDjSessionStyle: (style: DjSessionStyle) => Promise<void>;
  toggleDjFx: (fx: keyof DjFxToggles) => void;
  triggerDjMixNow: () => Promise<void>;
  setSafeCrossfade: (config: Partial<SafeCrossfadeConfig>) => void;
  setEqPreset: (presetId: UserEqPresetId) => void;
  setEqBandGain: (bandIndex: number, gainDb: number) => void;
  setEqEnabled: (enabled: boolean) => void;

  // Lyrics Actions
  loadLyricsForTrack: (track: Track) => Promise<void>;
  setLyricsUserScrolled: (scrolled: boolean) => void;

  // Search & Recommendations Actions
  setSearchQuery: (query: string, immediate?: boolean) => Promise<void>;
  submitSearch: (query?: string) => Promise<void>;
  setSearchScope: (scope: SearchScopeTab) => void;
  clearRecentSearches: () => void;
  addRecentSearchTrack: (track: Track) => void;
  addRecentSearchArtist: (artist: { id: string; name: string; thumbnailUrl: string }) => void;
  removeRecentSearchItem: (id: string) => void;
  clearRecentSearchItems: () => void;
  toggleFavoriteArtist: (artist: {
    id: string;
    name: string;
    thumbnailUrl?: string;
  }) => Promise<boolean>;
  isArtistFavorite: (artistIdOrName: string) => boolean;
  setPlaylistShareMetadata: (
    playlistId: string,
    patch: { shareCode?: string | null; isCollaborative?: boolean; isPublicLink?: boolean }
  ) => Promise<void>;
  setSocialSubTab: (tab: SocialSubTab) => void;
  setActiveJamCode: (code: string | null) => void;
  openJamView: () => void;
  setJamInviteModalOpen: (open: boolean) => void;
  hydrateSocialAndSubscribe: () => Promise<void>;
  startJam: (opts?: {
    allowGuestDirectAdd?: boolean;
    maxRequestsPerGuest?: number;
    openSheet?: boolean;
  }) => Promise<JamSessionRecord | null>;
  joinJamInApp: (code: string) => Promise<JamSessionRecord | null>;
  leaveOrEndJam: (reason?: string) => Promise<void>;
  checkJamIdleAutoEnd: (nowMs?: number) => Promise<boolean>;
  addTrackToActiveJam: (track: Track, playNext?: boolean) => Promise<void>;
  modifyJamQueueAsGuest: (
    op: 'move' | 'remove' | 'add_next',
    targetTrackId: string,
    toUpNextIndex?: number,
    track?: Track
  ) => Promise<void>;
  approveJamRequest: (req: JamRequestRecord) => Promise<void>;
  rejectJamRequest: (req: JamRequestRecord) => Promise<void>;
  updateJamSettings: (patch: {
    allowGuestDirectAdd?: boolean;
    maxRequestsPerGuest?: number;
  }) => Promise<void>;
  sendFriendRequestToUser: (targetUserId: string) => Promise<void>;
  respondToFriendRequest: (
    friendshipId: string,
    status: 'accepted' | 'declined',
    username?: string
  ) => Promise<void>;
  togglePlaylistCollaborative: (playlistId: string) => Promise<SharedPlaylistRecord | null>;
  inviteFriendToPlaylist: (
    playlistIdOrSharedId: string,
    friendUserId: string
  ) => Promise<SharedPlaylistRecord | null>;
  createCollaborativePlaylist: (
    name: string,
    friendIds?: string[],
    initialTracks?: Track[]
  ) => Promise<SharedPlaylistRecord | null>;
  createBlendWithFriend: (friend: FriendRecord) => Promise<SharedPlaylistRecord | null>;
  addTrackToCollaborativePlaylist: (sharedId: string, track: Track) => Promise<void>;
  removeTrackFromCollaborativePlaylist: (sharedId: string, trackId: string) => Promise<void>;
  joinSharedPlaylistLink: (shareCode: string) => Promise<SharedPlaylistRecord | null>;
  updateUserProfile: (input: {
    displayName: string;
    avatarUrl?: string | null;
    username?: string;
  }) => Promise<UserProfile>;
  addSeedArtist: (name: string) => Promise<void>;
  removeSeedArtist: (artistKey: string) => Promise<void>;
  resetTasteProfile: () => Promise<void>;
  refreshHomeRecommendations: (clearHistory?: boolean) => Promise<void>;

  // Library & Offline Actions
  setLibraryCategory: (cat: LibraryCategoryTab) => void;
  setLibraryFilterQuery: (q: string) => void;
  recordPlaylistPlay: (playlist: Pick<PlaylistRecord, 'id' | 'name'>) => void;
  createPlaylist: (name: string, description?: string, tracks?: Track[]) => Promise<PlaylistRecord>;
  renamePlaylist: (playlistId: string, name: string) => Promise<void>;
  deletePlaylist: (playlistId: string) => Promise<void>;
  deleteOrLeaveSharedPlaylistById: (sharedId: string) => Promise<void>;
  duplicatePlaylist: (playlistId: string) => Promise<PlaylistRecord | null>;
  openPlaylistContextMenu: (
    kind: 'local' | 'shared',
    playlistId: string,
    x: number,
    y: number
  ) => void;
  closePlaylistContextMenu: () => void;
  openPlaylistAppearanceModal: (kind: 'local' | 'shared', playlistId: string) => void;
  closePlaylistAppearanceModal: () => void;
  updatePlaylistAppearance: (
    kind: 'local' | 'shared',
    playlistId: string,
    patch: PlaylistAppearanceEntry
  ) => Promise<void>;
  downloadPlaylistOffline: (
    playlistId: string,
    tracks: Track[],
    playlistName?: string
  ) => Promise<void>;
  cancelPlaylistDownload: () => void;
  copyPlaylistTracksTo: (sourcePlaylistId: string, targetPlaylistId: string) => Promise<number>;
  addTrackToPlaylist: (playlistId: string, track: Track) => Promise<void>;
  removeTrackFromPlaylist: (playlistId: string, trackId: string) => Promise<void>;
  removePlaylistDuplicates: (playlistId: string) => Promise<number>;
  reorderPlaylistTrack: (playlistId: string, fromIndex: number, toIndex: number) => Promise<void>;
  likeTrackIfNeeded: (track: Track) => Promise<void>;
  searchTracksForPlaylist: (query: string) => Promise<Track[]>;
  dismissPlaylistRecommendation: (playlistId: string, trackId: string) => void;
  fetchPlaylistRecommendations: (
    playlistId: string,
    options?: { seedTrack?: Track; excludeIds?: string[] }
  ) => Promise<Track[]>;
  toggleLike: (track?: Track) => Promise<void>;
  downloadTrackOffline: (track: Track, options?: { silent?: boolean }) => Promise<void>;
  removeOfflineTrack: (trackId: string) => Promise<void>;
  removePlaylistOffline: (playlistId: string) => Promise<void>;
  setWifiOnlyDownloads: (enabled: boolean) => void;
  clearOfflineCache: () => Promise<void>;

  // Importer Actions
  setImportUrlInput: (url: string) => void;
  startPlaylistImport: (url?: string) => Promise<void>;
  cancelPlaylistImport: () => void;
  saveImportedPlaylistToLibrary: () => Promise<void>;

  // Sync & Connect Actions
  savedAccounts: SavedAccountSlot[];
  configureSupabase: (url: string, anonKey: string, deviceName?: string) => Promise<void>;
  setDeviceName: (deviceName: string) => Promise<void>;
  signInSupabase: (email: string, password: string) => Promise<void>;
  signUpSupabase: (
    email: string,
    password: string
  ) => Promise<{ userId: string; needsEmailConfirmation: boolean }>;
  signInWithGoogle: () => Promise<void>;
  handleAuthCallbackUrl: (callbackUrl: string) => Promise<void>;
  signOutSupabase: () => Promise<void>;
  switchSavedAccount: (userId: string) => Promise<void>;
  prepareAddSecondaryAccount: () => Promise<void>;
  removeSavedAccount: (userId: string) => Promise<void>;
  setAuthOnboardingOpen: (open: boolean) => void;
  continueAsGuest: () => void;
  saveUserProfile: (input: {
    username: string;
    displayName: string;
    avatarUrl?: string | null;
  }) => Promise<void>;
  checkUsernameAvailable: (username: string) => Promise<boolean>;
  openWrappedModal: (year?: number) => Promise<void>;
  closeWrappedModal: () => void;
  setMinimizeToTrayOnClose: (enabled: boolean) => void;
  setDesktopTrackNotifications: (enabled: boolean) => void;
  setReleaseNotificationsEnabled: (enabled: boolean) => void;
  setNotificationsPanelOpen: (open: boolean) => void;
  checkNewArtistReleases: (force?: boolean) => Promise<void>;
  markReleaseNotificationRead: (id: string) => void;
  markAllReleaseNotificationsRead: () => void;
  playReleaseNotification: (item: ReleaseNotificationItem) => Promise<void>;
  setShareListeningActivity: (enabled: boolean) => void;
  loadPersonalTopStats: (window: TopStatsWindow) => Promise<PeriodTopStats>;
  playFriendActivityTrack: (activity: FriendListeningActivity) => Promise<void>;
  pairDemoCompanionDevice: () => void;
  sendRemoteDeviceCommand: (
    targetDeviceId: string,
    action: 'play' | 'pause' | 'toggle' | 'next' | 'prev' | 'request_state' | 'pull_transfer',
    volume01?: number
  ) => Promise<void>;
  transferPlaybackToDevice: (targetDeviceId: string) => Promise<void>;
  pullPlaybackFromDevice: (sourceDeviceId: string) => Promise<void>;
  setRemoteControlledDevice: (deviceId: string | null) => void;
  setSurfaceStyle: (style: PMusicSurfaceStyle) => void;
  setLiquidGlassMode: (enabled: boolean) => void;
  setGraphicSaverMode: (enabled: boolean) => void;
  setReducedMotionPref: (enabled: boolean) => void;
  setTheme: (themeId: PMusicThemeId) => void;
  setPlayerBarStyle: (style: PMusicPlayerBarStyle) => void;
  setAccentPreset: (accent: PMusicAccentPresetId) => void;
  setVisualizerEnabled: (enabled: boolean) => void;
  setLyricsSize: (size: 'normal' | 'large' | 'xl') => void;
  setLyricsBlurEnabled: (enabled: boolean) => void;
  setLyricsStyle: (style: LyricsVisualStyle) => void;
  setPlaybackRate: (rate: number) => void;
  setPreservesPitch: (preserves: boolean) => void;
  setAudioNormalization: (enabled: boolean) => void;
  setNormalizationTarget: (target: 'quiet' | 'normal' | 'loud') => void;
  setStereoBalance: (pan: number) => void;
  setMonoAudio: (enabled: boolean) => void;
  setStreamQuality: (quality: AudioStreamQuality) => void;
  setDjStemSculpting: (enabled: boolean) => void;
  setDjVocalClashProtection: (enabled: boolean) => void;
  setDjAutoReorder: (enabled: boolean) => void;
  setDiscordRpcEnabled: (enabled: boolean) => void;
  setDiscordRpcConfig: (patch: Partial<DiscordRpcConfig>, reconnect?: boolean) => Promise<void>;
  reconnectDiscordRpc: () => Promise<void>;
  refreshDiscordRpcStatus: () => Promise<void>;
  setSleepTimer: (minutes: number | 'end_of_track') => void;
  cancelSleepTimer: () => void;
  setTrackInfoModalTrack: (track: Track | null) => void;
  setAddToPlaylistModalTrack: (track: Track | null) => void;
  exportLibraryJson: () => string;
  importLibraryJson: (rawJson: string) => Promise<number>;
  refreshExploreDiscovery: (force?: boolean) => Promise<void>;
}

const canonicalFallbackQueue = FALLBACK_TRACKS.map(canonicalizeTrackArtists);
const initialTrack = canonicalFallbackQueue[0]!;
const initialBundle = {
  query: '',
  topResult: { kind: 'artist' as const, item: FALLBACK_ARTISTS[0]! },
  songs: [...canonicalFallbackQueue],
  videos: canonicalFallbackQueue.slice(0, 4),
  artists: [...FALLBACK_ARTISTS],
  albums: [...FALLBACK_ALBUMS],
  playlists: [...FALLBACK_PLAYLISTS],
};

let initialized = false;
let previousVolumeBeforeMute = 0.85;
let pendingNextUserQueueCount: number | null = null;

export const usePMusicStore = create<PMusicStoreState>((set, get) => {
  let mediaController: MediaSessionController | null = null;
  function getMediaController(): MediaSessionController {
    if (!mediaController) {
      mediaController = new MediaSessionController({
        platformBridge: defaultPlatformBridge,
        onAction: (action) => {
          const playing = get().isPlaying;
          if (action.type === 'toggle') {
            void get().togglePlayPause();
          } else if (action.type === 'play') {
            if (!playing) void get().togglePlayPause();
          } else if (action.type === 'pause') {
            if (playing) void get().togglePlayPause();
          } else if (action.type === 'stop') {
            if (playing) void get().togglePlayPause();
          } else if (action.type === 'nexttrack') {
            void get().nextTrack();
          } else if (action.type === 'previoustrack') {
            void get().prevTrack();
          } else if (action.type === 'seekto' && typeof action.seekTimeSec === 'number') {
            get().seekTo(action.seekTimeSec);
          } else if (action.type === 'shuffle') {
            get().toggleShuffle();
          } else if (action.type === 'repeat') {
            get().cycleRepeatMode();
          }
        },
      });
    }
    return mediaController;
  }

  function checkLivePlaybackTriggers(engineStateOverride?: Partial<AudioEngineState>): void {
    if (
      djAutoTransitionInFlight &&
      djAutoTransitionStartedAtMs > 0 &&
      Date.now() - djAutoTransitionStartedAtMs > 20_000
    ) {
      djAutoTransitionInFlight = false;
      djAutoTransitionStartedAtMs = 0;
      audioEngine.cancelActiveTransition();
    }

    const baseEngine = audioEngine.getState();
    const engineState: AudioEngineState = engineStateOverride
      ? { ...baseEngine, ...engineStateOverride }
      : baseEngine;
    const snap = audioEngine.getLivePlaybackSnapshot();

    const useIncomingClock = Boolean(
      engineState.isTransitioning &&
        engineState.transitionProgress01 >= 0.5 &&
        typeof snap.incomingPositionSec === 'number' &&
        typeof snap.incomingDurationSec === 'number' &&
        snap.incomingDurationSec > 0
    );

    const safeDur = useIncomingClock
      ? snap.incomingDurationSec!
      : Number.isFinite(snap.durationSec) && snap.durationSec > 2
        ? snap.durationSec
        : Number.isFinite(engineState.durationSec) && engineState.durationSec > 2
          ? engineState.durationSec
          : get().currentTrack.durationSec;

    const rawPos = useIncomingClock
      ? snap.incomingPositionSec!
      : snap.positionSec > 0 || engineState.positionSec === 0
        ? snap.positionSec
        : engineState.positionSec;
    const safePos =
      safeDur > 0 ? Math.max(0, Math.min(safeDur, rawPos)) : Math.max(0, rawPos);

    const lyrics = get().currentLyrics;
    const activeIdx =
      lyrics && lyrics.status === 'synced'
        ? lrcParser.findActiveLineIndex(lyrics.lines, safePos * 1000)
        : -1;

    const curBeforeUpdate = get();
    const appHidden = curBeforeUpdate.isAppHidden;
    const durationChanged =
      !engineState.isTransitioning &&
      Number.isFinite(safeDur) &&
      safeDur > 2 &&
      Math.abs(safeDur - curBeforeUpdate.currentTrack.durationSec) >= 1.5;

    const criticalStateChanged =
      curBeforeUpdate.activeDeck !== engineState.activeDeck ||
      curBeforeUpdate.isPlaying !== engineState.isPlaying ||
      curBeforeUpdate.isBuffering !== Boolean(engineState.isBuffering) ||
      curBeforeUpdate.volume !== engineState.volume ||
      curBeforeUpdate.isTransitioning !== engineState.isTransitioning ||
      durationChanged;

    const needsStorePatch =
      criticalStateChanged ||
      ((!appHidden || engineState.isTransitioning) &&
        (Math.floor(curBeforeUpdate.positionSec) !== Math.floor(safePos) ||
          Math.abs(curBeforeUpdate.positionSec - safePos) >= 0.95 ||
          Math.abs(curBeforeUpdate.durationSec - safeDur) >= 0.25 ||
          (curBeforeUpdate.transitionProgress01 < 0.5 && engineState.transitionProgress01 >= 0.5) ||
          (engineState.transitionProgress01 === 0 && curBeforeUpdate.transitionProgress01 !== 0) ||
          (engineState.transitionProgress01 === 1 && curBeforeUpdate.transitionProgress01 !== 1) ||
          curBeforeUpdate.activeLyricIndex !== activeIdx));

    if (needsStorePatch) {
      set((prev) => ({
        activeDeck: engineState.activeDeck,
        isPlaying: engineState.isPlaying,
        isBuffering: Boolean(engineState.isBuffering),
        positionSec: safePos,
        durationSec: safeDur,
        volume: engineState.volume,
        isTransitioning: engineState.isTransitioning,
        activeTransitionType: engineState.activeTransitionType,
        transitionProgress01: engineState.transitionProgress01,
        activeLyricIndex: activeIdx,
        ...(durationChanged
          ? {
              currentTrack: {
                ...prev.currentTrack,
                durationSec: Math.round(safeDur),
              },
              queue: prev.queue.map((qItem) =>
                qItem.id === prev.currentTrack.id
                  ? { ...qItem, durationSec: Math.round(safeDur) }
                  : qItem
              ),
            }
          : {}),
      }));
    }

    if (durationChanged && get().djMode.enabled && !engineState.isTransitioning) {
      void recomputeActiveDjPlan();
    }

    const activeTrack = get().currentTrack;
    const mediaSessionKey = `${activeTrack.id}|${engineState.isPlaying}|${Math.round(safeDur)}|${get().shuffleEnabled}|${get().repeatMode}`;
    const nowWallMs = Date.now();
    const minSessionIntervalMs = appHidden ? 15_000 : 1000;
    if (
      Boolean(engineStateOverride) ||
      mediaSessionKey !== lastMediaSessionSyncKey ||
      nowWallMs - lastMediaSessionSyncWallMs >= minSessionIntervalMs
    ) {
      lastMediaSessionSyncKey = mediaSessionKey;
      lastMediaSessionSyncWallMs = nowWallMs;
      void getMediaController().updateSession({
        track: activeTrack,
        isPlaying: engineState.isPlaying,
        positionSec: safePos,
        durationSec: safeDur,
        shuffleEnabled: get().shuffleEnabled,
        repeatMode: get().repeatMode,
      });
    }

    const liveState = get();
    if (
      engineState.isPlaying &&
      !engineState.isTransitioning &&
      !djAutoTransitionInFlight &&
      liveState.autoplayEnabled &&
      liveState.recommendedQueue.length < 3 &&
      !liveState.isLoadingRecommendedQueue &&
      isLiveRuntime()
    ) {
      void liveState.replenishRecommendedQueue();
    }

    if (
      !engineState.isPlaying ||
      engineState.isBuffering ||
      engineState.isTransitioning ||
      djAutoTransitionInFlight ||
      manualTrackSwitchInFlight ||
      autoAdvanceInFlight
    ) {
      return;
    }

    const prevObsPos =
      lastObservedPlayback && lastObservedPlayback.trackId === liveState.currentTrack.id
        ? lastObservedPlayback.posSec
        : null;
    lastObservedPlayback = { trackId: liveState.currentTrack.id, posSec: safePos };

    if (
      liveState.djMode.enabled &&
      liveState.repeatMode !== 'one' &&
      suppressedAutoTransitionTrackId !== liveState.currentTrack.id
    ) {
      const target = getUpcomingDjTarget(liveState);
      const nextTrack = target?.track;
      const nextIdx = target?.nextIdx ?? 0;
      if (nextTrack && nextTrack.id !== liveState.currentTrack.id) {
        const plan = liveState.activeTransitionPlan;
        const liveDur = safeDur;
        if (
          !plan ||
          plan.fromTrackId !== liveState.currentTrack.id ||
          plan.toTrackId !== nextTrack.id
        ) {
          void recomputeActiveDjPlan();
        } else {
          const effectiveCueOut =
            liveDur > 6
              ? Math.max(
                  4,
                  Math.min(
                    plan.cueOutSec,
                    Math.max(4, liveDur - Math.min(plan.transitionDurationSec, liveDur * 0.42) - 1.0)
                  )
                )
              : plan.cueOutSec;
          const preloadKey = `${liveState.currentTrack.id}->${nextTrack.id}@${plan.cueInSec}`;
          if (djPreloadedKey !== preloadKey) {
            djPreloadedKey = preloadKey;
            preloadTrackCoverArt(nextTrack);
            void analyzeTrackAudioInBackground(nextTrack);
            void audioEngine.preloadNextDeck(nextTrack, plan.cueInSec);
          }
          if (safePos >= effectiveCueOut - 0.25) {
            if (prevObsPos !== null && prevObsPos >= effectiveCueOut + 1.25) {
              suppressedAutoTransitionTrackId = liveState.currentTrack.id;
            } else {
              void executeDjTransition(
                effectiveCueOut !== plan.cueOutSec ? { ...plan, cueOutSec: effectiveCueOut } : plan,
                nextTrack,
                nextIdx
              );
              return;
            }
          }
        }
      }
    } else if (
      !liveState.djMode.enabled &&
      liveState.safeCrossfade.enabled &&
      liveState.safeCrossfade.durationSec > 0 &&
      liveState.repeatMode !== 'one' &&
      suppressedAutoTransitionTrackId !== liveState.currentTrack.id
    ) {
      const target = getUpcomingDjTarget(liveState);
      const nextTrack = target?.track;
      const nextIdx = target?.nextIdx ?? 0;
      if (nextTrack && nextTrack.id !== liveState.currentTrack.id) {
        const cfPreloadKey = `${liveState.currentTrack.id}->${nextTrack.id}@0`;
        if (djPreloadedKey !== cfPreloadKey) {
          djPreloadedKey = cfPreloadKey;
          preloadTrackCoverArt(nextTrack);
          void audioEngine.preloadNextDeck(nextTrack, 0);
        }
        const triggerPos = safeDur - liveState.safeCrossfade.durationSec - 0.35;
        if (safeDur > 10 && safePos >= triggerPos) {
          if (prevObsPos !== null && prevObsPos >= triggerPos + 1.25) {
            suppressedAutoTransitionTrackId = liveState.currentTrack.id;
          } else {
            const cfPlan: DeckTransitionPlan = {
              fromTrackId: liveState.currentTrack.id,
              toTrackId: nextTrack.id,
              cueInSec: 0,
              cueOutSec: Math.max(6, Math.round(safeDur - liveState.safeCrossfade.durationSec)),
              transitionDurationSec: Math.max(1.5, Math.min(12, liveState.safeCrossfade.durationSec)),
              transitionBars: 4,
              transitionType: 'eq_swap',
              tempoNudgeRate: 1.0,
              echoSubdivision: 0.5,
              compatibilityScore: 0.85,
            };
            void executeDjTransition(cfPlan, nextTrack, nextIdx, true);
            return;
          }
        }
      }
    } else if (liveState.repeatMode !== 'one') {
      const target = getUpcomingDjTarget(liveState);
      const nextTrack = target?.track;
      if (
        nextTrack &&
        nextTrack.id !== liveState.currentTrack.id &&
        safeDur > 15 &&
        safePos >= Math.max(0, safeDur - 20)
      ) {
        const normPreloadKey = `${liveState.currentTrack.id}->${nextTrack.id}@0`;
        if (djPreloadedKey !== normPreloadKey) {
          djPreloadedKey = normPreloadKey;
          preloadTrackCoverArt(nextTrack);
          void audioEngine.preloadNextDeck(nextTrack, 0);
        }
      }
    }

    if (
      !engineState.isBuffering &&
      !autoAdvanceInFlight &&
      (snap.isEnded || (safeDur > 4 && safePos >= safeDur - 0.35))
    ) {
      if (liveState.sleepTimerMode === 'end_of_track') {
        audioEngine.pause();
        set({
          isPlaying: false,
          isBuffering: false,
          sleepTimerMode: 'off',
          sleepTimerRemainingSec: 0,
        });
        syncDiscordPresenceState();
        liveState.showToast('Temporizador finalizado');
        return;
      }
      const nowMs = Date.now();
      if (
        lastAutoAdvanceGuard.trackId === liveState.currentTrack.id &&
        nowMs - lastAutoAdvanceGuard.atMs < 1800
      ) {
        return;
      }
      lastAutoAdvanceGuard = { trackId: liveState.currentTrack.id, atMs: nowMs };
      void recommendationEngine.recordSignal(liveState.currentTrack, 'complete_listen', {
        completionRatio: 1.0,
      });
      void liveState.nextTrack(true);
    }
  }

  function ensureAudioEngineBindings(): void {
    if (engineBindingsAttached) return;
    engineBindingsAttached = true;

    audioEngine.onStateChange((engineState) => {
      syncJamIdleClock(engineState.isPlaying);
      checkLivePlaybackTriggers(engineState);
    });

    audioEngine.onTrackEnded(() => {
      const st = get();
      if (st.sleepTimerMode === 'end_of_track') {
        audioEngine.pause();
        set({
          isPlaying: false,
          isBuffering: false,
          sleepTimerMode: 'off',
          sleepTimerRemainingSec: 0,
        });
        syncDiscordPresenceState();
        st.showToast('Temporizador finalizado');
        return;
      }
      if (
        st.isTransitioning ||
        djAutoTransitionInFlight ||
        autoAdvanceInFlight ||
        manualTrackSwitchInFlight
      ) {
        return;
      }
      const nowMs = Date.now();
      if (
        lastAutoAdvanceGuard.trackId === st.currentTrack.id &&
        nowMs - lastAutoAdvanceGuard.atMs < 1800
      ) {
        return;
      }
      lastAutoAdvanceGuard = { trackId: st.currentTrack.id, atMs: nowMs };
      recordWrappedListenIfEligible(
        st.currentTrack,
        Math.max(st.positionSec, st.durationSec || st.currentTrack.durationSec || 0),
        st.activeTab.toLowerCase(),
        st.repeatMode === 'one'
      );
      void recommendationEngine.recordSignal(st.currentTrack, 'complete_listen', {
        completionRatio: 1.0,
      });
      void st.nextTrack(true);
    });

    audioEngine.onError?.((err) => {
      set({ isBuffering: false, isPlaying: false });
      syncDiscordPresenceState();
      get().showToast(err.message || 'No se pudo cargar el audio completo de esta pista');
    });

    syncEngine.onDevicesChanged((devices) => {
      const curRemote = get().remoteControlledDeviceId;
      const remoteStillOnline = curRemote ? devices.some((d) => d.device_id === curRemote) : false;
      set({
        onlineDevices: devices,
        ...(curRemote && !remoteStillOnline
          ? { remoteControlledDeviceId: null, remoteDeviceSnapshot: null }
          : {}),
      });
    });

    syncEngine.onAuthStateChanged((auth) => {
      set({ authState: auth, onlineDevices: syncEngine.getOnlineDevices() });
    });

    syncEngine.onLibraryChanged((table) => {
      if (table === 'playlists' || table === 'playlist_tracks') {
        set({ playlists: libraryStore.getPlaylists() });
      } else if (table === 'liked_tracks') {
        set({ likedTracks: libraryStore.getLikedTracks() });
      }
    });

    syncEngine.onRemoteCommand((cmd) => {
      const st = get();
      if (cmd.type === 'play' && !st.isPlaying) void st.togglePlayPause();
      else if (cmd.type === 'pause' && st.isPlaying) void st.togglePlayPause();
      else if (cmd.type === 'toggle') void st.togglePlayPause();
      else if (cmd.type === 'next') void st.nextTrack();
      else if (cmd.type === 'prev') void st.prevTrack();
      else if (cmd.type === 'seek') st.seekTo(cmd.positionMs / 1000);
      else if (cmd.type === 'volume') st.setVolume(cmd.volume01);
      else if (cmd.type === 'set_dj_mode') {
        void st.toggleDjMode(cmd.enabled);
        void st.setDjSessionStyle(cmd.style);
      } else if (cmd.type === 'pull_transfer') {
        void st.transferPlaybackToDevice(cmd.originDeviceId);
      } else if (cmd.type === 'request_state') {
        void syncEngine.sendRemoteCommand({
          targetDeviceId: cmd.originDeviceId,
          type: 'state_pulse',
          deviceName: st.deviceName,
          trackTitle: st.currentTrack.title,
          trackArtist: st.currentTrack.artists.map((a) => a.name).join(', '),
          thumbnailUrl: st.currentTrack.thumbnailUrl,
          isPlaying: st.isPlaying,
          positionMs: Math.round(st.positionSec * 1000),
          durationMs: Math.round(st.durationSec * 1000),
          volume: st.volume,
        });
      } else if (cmd.type === 'state_pulse') {
        set({
          remoteDeviceSnapshot: {
            deviceId: cmd.originDeviceId,
            deviceName: cmd.deviceName,
            trackTitle: cmd.trackTitle,
            trackArtist: cmd.trackArtist,
            thumbnailUrl: cmd.thumbnailUrl,
            isPlaying: cmd.isPlaying,
            positionMs: cmd.positionMs,
            durationMs: cmd.durationMs,
            volume: cmd.volume,
          },
        });
      } else if (cmd.type === 'transfer') {
        const snap = cmd.snapshot;
        set({
          currentTrack: snap.track,
          queue: snap.queue.length > 0 ? snap.queue : [snap.track],
          queueIndex: snap.queueIndex,
          volume: snap.volume,
          remoteControlledDeviceId: null,
          remoteDeviceSnapshot: null,
          lastTransferBanner: `Reproducción recibida en ${Math.round(snap.positionMs / 1000)}s`,
        });
        void st.playTrack(snap.track, snap.queue, snap.positionMs / 1000);
        st.showToast(`Escuchando aquí: ${snap.track.title}`);
      } else if (cmd.type === 'library_sync') {
        void Promise.all([
          syncEngine.syncNow(),
          syncEngine.loadAccountPreferences?.(),
        ]).then(([, cloudPrefs]) => {
          set((prev) => ({
            playlists: libraryStore.getPlaylists(),
            likedTracks: libraryStore.getLikedTracks(),
            playHistory: libraryStore.getPlayHistory(),
            ...(cloudPrefs?.playlistAppearances &&
            typeof cloudPrefs.playlistAppearances === 'object' &&
            Number(cloudPrefs.savedAt ?? 0) >= lastLocalPrefsSavedAt
              ? {
                  playlistAppearances: cloudPrefs.playlistAppearances as Record<
                    string,
                    PlaylistAppearanceEntry
                  >,
                }
              : {}),
          }));
        });
      }
    });

    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => set({ isOfflineNetwork: false }));
      window.addEventListener('offline', () => set({ isOfflineNetwork: true }));
      window.addEventListener('resize', () => {
        if (window.innerWidth < 1024 && !get().sidebarCollapsed) {
          set({ sidebarCollapsed: true });
        } else if (window.innerWidth >= 1024 && get().sidebarCollapsed) {
          set({ sidebarCollapsed: false });
        }
      });
      if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', () => {
          get().setAppHidden(Boolean(document.hidden));
        });
      }
      const desktopBridge = (window as {
        pmusicDesktop?: { onWindowVisibilityChanged?: (cb: (visible: boolean) => void) => () => void };
      }).pmusicDesktop;
      desktopBridge?.onWindowVisibilityChanged?.((visible: boolean) => {
        get().setAppHidden(!visible);
      });
      (window as unknown as { __pmusicOnAppResume?: () => void }).__pmusicOnAppResume = () => {
        get().setAppHidden(false);
        audioEngine.recoverAfterAppResume();
      };
    }

    if (!playbackMonitorTimer && typeof setInterval === 'function') {
      playbackMonitorTimer = setInterval(() => {
        const st = get();
        const eng = audioEngine.getState();
        if (!st.isPlaying && !eng.isPlaying) return;
        if (st.isAppHidden && !eng.isTransitioning) {
          const rem = Math.max(0, (eng.durationSec || 0) - (eng.positionSec || 0));
          if (rem > 16) {
            hiddenSkipTick = (hiddenSkipTick + 1) % 4;
            if (hiddenSkipTick !== 0) return;
          }
        }
        checkLivePlaybackTriggers();
      }, 250);
      (playbackMonitorTimer as { unref?: () => void }).unref?.();
    }
  }
  async function analyzeTrackAudioInBackground(track: Track): Promise<void> {
    if (decodedAudioAnalyzedIds.has(track.id) || decodedAudioInFlightIds.has(track.id)) {
      return;
    }
    if (
      typeof window === 'undefined' ||
      typeof window.AudioContext === 'undefined' ||
      !isLiveRuntime()
    ) {
      return;
    }
    // Avoid heavy full-track fetch + decodeAudioData unless DJ Mode is active
    if (!get().djMode.enabled) {
      return;
    }
    decodedAudioInFlightIds.add(track.id);
    try {
      const url = await resolveTrackStreamUrl(track);
      const headers = await defaultPlatformBridge.getAuthHeaders();
      const res = await fetch(url, { headers });
      if (!res.ok) return;
      const buf = await res.arrayBuffer();
      const pcmAnalysis = await djPlanner.analyzeEncodedAudio(track.id, buf, track.durationSec);
      decodedAudioAnalyzedIds.add(track.id);
      if (decodedAudioAnalyzedIds.size > 24) {
        const oldest = decodedAudioAnalyzedIds.values().next().value;
        if (oldest) decodedAudioAnalyzedIds.delete(oldest);
      }
      set((prev) => {
        const nextAnalyses = { ...prev.trackAnalyses, [track.id]: pcmAnalysis };
        const keys = Object.keys(nextAnalyses);
        if (keys.length > 16) {
          for (const k of keys.slice(0, keys.length - 16)) {
            if (k !== track.id && k !== prev.currentTrack.id) {
              delete nextAnalyses[k];
            }
          }
        }
        return { trackAnalyses: nextAnalyses };
      });
      void recomputeActiveDjPlan();
    } catch {
      // Ignore network/codec failures and keep heuristic analysis
    } finally {
      decodedAudioInFlightIds.delete(track.id);
    }
  }

  function getUpcomingDjTarget(
    st: PMusicStoreState
  ): { track: Track; nextIdx: number; fromRecommended: boolean } | null {
    for (let i = st.queueIndex + 1; i < st.queue.length; i++) {
      const next = st.queue[i];
      if (next && next.id !== st.currentTrack.id) {
        return { track: next, nextIdx: i, fromRecommended: false };
      }
    }
    if (st.queueIndex + 1 < st.queue.length && st.queue[st.queueIndex + 1]) {
      return {
        track: st.queue[st.queueIndex + 1]!,
        nextIdx: st.queueIndex + 1,
        fromRecommended: false,
      };
    }
    if (st.repeatMode === 'all' && st.queue.length > 1) {
      const wrap = st.queue[0];
      if (wrap && wrap.id !== st.currentTrack.id) {
        return { track: wrap, nextIdx: 0, fromRecommended: false };
      }
    }
    if (st.autoplayEnabled && st.recommendedQueue.length > 0) {
      const rec =
        st.recommendedQueue.find((t) => t.id !== st.currentTrack.id) ??
        st.recommendedQueue[0];
      if (rec) {
        return { track: rec, nextIdx: 0, fromRecommended: true };
      }
    }
    return null;
  }

  async function recomputeActiveDjPlan(): Promise<DeckTransitionPlan | null> {
    const st = get();
    if (!st.djMode.enabled || st.repeatMode === 'one') {
      if (st.activeTransitionPlan !== null) set({ activeTransitionPlan: null });
      return null;
    }
    const target = getUpcomingDjTarget(st);
    const nextTrack = target?.track;
    if (!nextTrack || nextTrack.id === st.currentTrack.id) {
      if (st.activeTransitionPlan !== null) set({ activeTransitionPlan: null });
      return null;
    }

    const engineDur = audioEngine.getState().durationSec;
    const effDuration =
      engineDur > 2 ? engineDur : st.durationSec > 2 ? st.durationSec : st.currentTrack.durationSec;

    const cachedFrom = st.trackAnalyses[st.currentTrack.id];
    const needDurationRefresh =
      !cachedFrom || Math.abs(cachedFrom.durationSec - effDuration) >= 1.5;
    const fromAna = needDurationRefresh
      ? await djPlanner.analyzeTrack(st.currentTrack.id, null, effDuration)
      : cachedFrom;

    const cachedTo = st.trackAnalyses[nextTrack.id];
    const toAna =
      cachedTo ??
      (await djPlanner.analyzeTrack(nextTrack.id, null, nextTrack.durationSec));

    if (needDurationRefresh || !cachedTo) {
      set((prev) => ({
        trackAnalyses: {
          ...prev.trackAnalyses,
          [st.currentTrack.id]: fromAna,
          [nextTrack.id]: toAna,
        },
      }));
    }

    let plan = djPlanner.planTransition(
      fromAna,
      toAna,
      st.djMode.style,
      st.djMode.preferredTransition,
      st.djMode.enabledTransitions
    );

    const latest = get();
    if (!latest.djMode.enabled) {
      if (latest.activeTransitionPlan !== null) set({ activeTransitionPlan: null });
      return null;
    }
    const latestDurRaw = audioEngine.getState().durationSec;
    const latestEffDuration =
      latestDurRaw > 2 ? latestDurRaw : latest.durationSec > 2 ? latest.durationSec : fromAna.durationSec;
    const safeTransDur = Math.min(plan.transitionDurationSec, Math.max(2, latestEffDuration * 0.35));
    const maxSafeCueOut = Math.max(4, Math.floor(latestEffDuration - safeTransDur - 1.4));
    let nextCueOut = Math.max(4, Math.min(plan.cueOutSec, maxSafeCueOut));

    const existingPlan = latest.activeTransitionPlan;
    const samePair =
      existingPlan &&
      existingPlan.fromTrackId === latest.currentTrack.id &&
      existingPlan.toTrackId === nextTrack.id;

    if (
      samePair &&
      !needDurationRefresh &&
      existingPlan.cueOutSec <= maxSafeCueOut &&
      latest.positionSec < existingPlan.cueOutSec - 0.2
    ) {
      nextCueOut = Math.max(4, Math.min(maxSafeCueOut, existingPlan.cueOutSec));
    }

    plan = {
      ...plan,
      transitionDurationSec: safeTransDur,
      cueOutSec: nextCueOut,
    };

    if (!get().djMode.enabled) return null;
    set({ activeTransitionPlan: plan });
    return plan;
  }

  async function runWithTimeout(promise: Promise<void>, timeoutMs: number): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      const outcome = await Promise.race([
        promise.then(() => true),
        new Promise<boolean>((resolve) => {
          timer = setTimeout(() => resolve(false), timeoutMs);
        }),
      ]);
      return outcome;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function executeDjTransition(
    plan: DeckTransitionPlan,
    nextTrack: Track,
    nextIdx: number,
    isPlainCrossfade = false
  ): Promise<void> {
    if (djAutoTransitionInFlight) return;
    const startDjEpoch = djSessionEpoch;
    const trackDjCancellation = !isPlainCrossfade;
    const isCancelled = () =>
      startDjEpoch !== djSessionEpoch || (trackDjCancellation && !get().djMode.enabled);

    djAutoTransitionInFlight = true;
    djAutoTransitionStartedAtMs = Date.now();
    let handoffTimer: ReturnType<typeof setTimeout> | null = null;
    let swapped = false;

    const prevTrack = get().currentTrack;
    const commitTrackSwap = () => {
      if (swapped || isCancelled()) return;
      swapped = true;
      if (handoffTimer) {
        clearTimeout(handoffTimer);
        handoffTimer = null;
      }
      const curState = get();
      if (curState.currentTrack.id === nextTrack.id) return;
      const updatedPrevStack = [...curState.sessionPrevStack, prevTrack].slice(-20);
      const fromRecommended = !curState.queue.some(
        (t, idx) => idx === nextIdx && t.id === nextTrack.id
      );
      let nextQueue: Track[];
      let nextQueueIndex = 0;
      let nextRecommended = curState.recommendedQueue;

      if (fromRecommended) {
        nextQueue = [nextTrack];
        nextQueueIndex = 0;
        nextRecommended = curState.recommendedQueue.filter((t) => t.id !== nextTrack.id);
      } else if (curState.repeatMode === 'all' && nextIdx === 0 && curState.queue.length > 1) {
        nextQueue = curState.queue;
        nextQueueIndex = 0;
      } else {
        nextQueue = curState.queue.slice(Math.max(0, nextIdx));
        nextQueueIndex = 0;
      }

      const liveSnap = audioEngine.getLivePlaybackSnapshot();
      const handoffPosSec =
        typeof liveSnap.incomingPositionSec === 'number'
          ? liveSnap.incomingPositionSec
          : plan.cueInSec;
      const handoffDurSec =
        typeof liveSnap.incomingDurationSec === 'number' && liveSnap.incomingDurationSec > 2
          ? liveSnap.incomingDurationSec
          : nextTrack.durationSec;

      set({
        currentTrack: nextTrack,
        lastTrackDirection: 'next',
        queue: nextQueue,
        recommendedQueue: nextRecommended,
        sessionPrevStack: updatedPrevStack,
        queueIndex: nextQueueIndex,
        positionSec: handoffPosSec,
        durationSec: handoffDurSec,
        isPlaying: true,
        activeTransitionPlan: null,
        currentLyrics: null,
        activeLyricIndex: -1,
        lyricsUserScrolled: false,
      });

      suppressedAutoTransitionTrackId = null;
      lastObservedPlayback = { trackId: nextTrack.id, posSec: handoffPosSec };
      const expectedPaletteKey = `${nextTrack.id}::${nextTrack.thumbnailHighUrl ?? nextTrack.thumbnailUrl ?? ''}`;
      if (getActiveAmbientTrackKey() !== expectedPaletteKey) {
        applyAmbientPaletteForTrack(nextTrack, Math.round(Math.max(0.8, plan.transitionDurationSec * 0.5) * 1000));
      }
      void get().loadLyricsForTrack(nextTrack);
      if (nextRecommended.length < 6) {
        void get().replenishRecommendedQueue();
      }
      void syncEngine.updatePresence({
        is_active: true,
        is_playing: true,
        track_title: `${nextTrack.title} — ${nextTrack.artists.map((a) => a.name).join(', ')}`,
      });
      syncDiscordPresenceState();
    };

    try {
      void recommendationEngine.recordSignal(prevTrack, 'complete_listen', {
        completionRatio: 1.0,
      });

      try {
        const preloadedOk = await runWithTimeout(
          audioEngine.preloadNextDeck(nextTrack, plan.cueInSec),
          5000
        );
        if (isCancelled()) {
          djAutoTransitionInFlight = false;
          djAutoTransitionStartedAtMs = 0;
          set({ outgoingTransitionTrack: null, incomingTransitionTrack: null, isTransitioning: false, activeTransitionPlan: null });
          return;
        }
        if (!preloadedOk) {
          djAutoTransitionInFlight = false;
          djAutoTransitionStartedAtMs = 0;
          set({ outgoingTransitionTrack: null, incomingTransitionTrack: null });
          await get().playTrack(nextTrack, get().queue, plan.cueInSec);
          return;
        }
      } catch {
        djAutoTransitionInFlight = false;
        djAutoTransitionStartedAtMs = 0;
        set({ outgoingTransitionTrack: null, incomingTransitionTrack: null });
        if (isCancelled()) return;
        await get().playTrack(nextTrack, get().queue, plan.cueInSec);
        return;
      }

      if (isCancelled()) return;

      // Act 1: Reveal incoming track transition state before swapping title & cover at deck handoff (~48%)
      set({
        outgoingTransitionTrack: prevTrack,
        incomingTransitionTrack: nextTrack,
        transitionDurationSec: plan.transitionDurationSec,
      });
      void hydrateTrackContributorsIfNeeded(nextTrack);
      // Animate ambient backdrop colors linearly 0->10->20->...->100 over the FULL transition for BOTH DJ & crossfade!
      applyAmbientPaletteForTrack(
        nextTrack,
        Math.round(Math.max(1.2, plan.transitionDurationSec) * 1000)
      );
      if (!isPlainCrossfade) {
        suppressedAutoTransitionTrackId = null;
        lastObservedPlayback = { trackId: nextTrack.id, posSec: plan.cueInSec };
      }

      const handoffDelayMs = Math.max(
        380,
        Math.round(plan.transitionDurationSec * 500)
      );
      handoffTimer = setTimeout(() => {
        if (!isCancelled()) {
          commitTrackSwap();
        }
      }, handoffDelayMs);

      try {
        const transTimeoutMs = Math.max(7000, Math.round(plan.transitionDurationSec * 1000) + 5500);
        const transitionedOk = await runWithTimeout(
          audioEngine.executeTransition(plan),
          transTimeoutMs
        );
        if (isCancelled()) {
          if (handoffTimer) {
            clearTimeout(handoffTimer);
            handoffTimer = null;
          }
          audioEngine.cancelActiveTransition();
          djAutoTransitionInFlight = false;
          djAutoTransitionStartedAtMs = 0;
          set({ outgoingTransitionTrack: null, incomingTransitionTrack: null, isTransitioning: false, activeTransitionPlan: null });
          return;
        }
        if (!transitionedOk) {
          if (handoffTimer) {
            clearTimeout(handoffTimer);
            handoffTimer = null;
          }
          audioEngine.cancelActiveTransition();
          djAutoTransitionInFlight = false;
          djAutoTransitionStartedAtMs = 0;
          set({ outgoingTransitionTrack: null, incomingTransitionTrack: null });
          await get().playTrack(nextTrack, get().queue, plan.cueInSec);
          return;
        }
        commitTrackSwap();
        if (!audioEngine.getState().isPlaying) {
          await audioEngine.play();
        }
      } catch {
        if (handoffTimer) {
          clearTimeout(handoffTimer);
          handoffTimer = null;
        }
        audioEngine.cancelActiveTransition();
        djAutoTransitionInFlight = false;
        djAutoTransitionStartedAtMs = 0;
        set({ outgoingTransitionTrack: null, incomingTransitionTrack: null });
        if (isCancelled()) return;
        await get().playTrack(nextTrack, get().queue, plan.cueInSec);
        return;
      }

      const postEngineState = audioEngine.getState();
      const landedDur =
        Number.isFinite(postEngineState.durationSec) && postEngineState.durationSec > 2
          ? postEngineState.durationSec
          : nextTrack.durationSec;
      const landedPos =
        Number.isFinite(postEngineState.positionSec) && postEngineState.positionSec >= 0
          ? Math.min(landedDur > 0 ? landedDur : postEngineState.positionSec, postEngineState.positionSec)
          : plan.cueInSec;

      if (get().currentTrack.id === nextTrack.id) {
        set({
          positionSec: landedPos,
          durationSec: landedDur,
          isPlaying: true,
          outgoingTransitionTrack: null,
          incomingTransitionTrack: null,
        });
      }

      djPreloadedKey = '';
      if (!isPlainCrossfade && get().djMode.enabled && startDjEpoch === djSessionEpoch) {
        void analyzeTrackAudioInBackground(nextTrack);
        const upcoming = getUpcomingDjTarget(get())?.track;
        if (upcoming && upcoming.id !== nextTrack.id) {
          void analyzeTrackAudioInBackground(upcoming);
        }
        const nextPlan = await recomputeActiveDjPlan();
        if (
          nextPlan &&
          get().djMode.enabled &&
          startDjEpoch === djSessionEpoch &&
          upcoming &&
          upcoming.id !== nextTrack.id
        ) {
          void audioEngine.preloadNextDeck(upcoming, nextPlan.cueInSec);
        }
      }
    } finally {
      if (handoffTimer) {
        clearTimeout(handoffTimer);
        handoffTimer = null;
      }
      djAutoTransitionInFlight = false;
      djAutoTransitionStartedAtMs = 0;
      if (get().incomingTransitionTrack || get().outgoingTransitionTrack) {
        set({ outgoingTransitionTrack: null, incomingTransitionTrack: null });
      }
    }
  }

  function syncDiscordPresenceState(): void {
    const st = get();
    void defaultPlatformBridge.updateDiscordPresence?.({
      track: st.currentTrack,
      isPlaying: st.isPlaying,
      positionSec: st.positionSec,
      durationSec: st.durationSec,
      enabled: st.discordRpcEnabled,
      clientId: st.discordRpcConfig.clientId,
      showTimestamps: st.discordRpcConfig.showTimestamps,
      showArtwork: st.discordRpcConfig.showArtwork,
      showWhenPaused: st.discordRpcConfig.showWhenPaused,
      displayMode: st.discordRpcConfig.displayMode,
    });
    if (st.authState.connected && !st.remoteControlledDeviceId) {
      const artistLabel = st.currentTrack.artists.map((a) => a.name).join(', ');
      void syncEngine.sendRemoteCommand({
        targetDeviceId: '*',
        type: 'state_pulse',
        deviceName: st.deviceName,
        trackTitle: st.currentTrack.title,
        trackArtist: artistLabel,
        thumbnailUrl: st.currentTrack.thumbnailUrl,
        isPlaying: st.isPlaying,
        positionMs: Math.round(st.positionSec * 1000),
        durationMs: Math.round(st.durationSec * 1000),
        volume: st.volume,
      });
    }
  }

  async function hydrateTrackContributorsIfNeeded(track: Track | null | undefined): Promise<void> {
    if (!track || track.artists.length > 1 || !track.id.startsWith('dz:')) return;
    if (hydratedContributorIds.has(track.id) || typeof musicProvider.getTrack !== 'function') return;
    hydratedContributorIds.add(track.id);
    try {
      const enriched = await musicProvider.getTrack(track.id);
      if (!enriched || enriched.artists.length <= 1) return;
      const patchArtists = (item: Track): Track =>
        item.id === track.id ? { ...item, artists: enriched.artists } : item;

      let playlistMutated = false;
      for (const pl of libraryStore.getPlaylists()) {
        if (pl.tracks.some((pt) => pt.id === track.id && pt.artists.length <= 1)) {
          playlistMutated = true;
          await libraryStore.updatePlaylist(pl.id, {
            tracks: pl.tracks.map(patchArtists),
          });
        }
      }

      set((prev) => ({
        currentTrack: patchArtists(prev.currentTrack),
        outgoingTransitionTrack: prev.outgoingTransitionTrack
          ? patchArtists(prev.outgoingTransitionTrack)
          : null,
        incomingTransitionTrack: prev.incomingTransitionTrack
          ? patchArtists(prev.incomingTransitionTrack)
          : null,
        queue: prev.queue.map(patchArtists),
        recommendedQueue: prev.recommendedQueue.map(patchArtists),
        homeShelves: prev.homeShelves.map((shelf) =>
          shelf.tracks
            ? { ...shelf, tracks: shelf.tracks.map(patchArtists) }
            : shelf
        ),
        searchResults: {
          ...prev.searchResults,
          songs: prev.searchResults.songs.map(patchArtists),
        },
        ...(playlistMutated ? { playlists: libraryStore.getPlaylists() } : {}),
      }));
      syncDiscordPresenceState();
    } catch {
      // non-fatal metadata hydration failure
    }
  }

  function syncUserLibraryContextToEngine(): void {
    const pls = libraryStore.getPlaylists();
    const likes = libraryStore.getLikedTracks();
    const shared = get().sharedPlaylists;
    recommendationEngine.setUserLibraryContext({
      libraryTracks: [
        ...pls.flatMap((p) => p.tracks),
        ...shared.flatMap((s) => s.tracks),
      ],
      likedTracks: likes.map((l) => l.track),
    });
  }

  function getOwnAdderIdentity(): TrackAdderIdentity {
    const st = get();
    return {
      userId: st.authState.userId ?? undefined,
      username: st.userProfile?.username,
      displayName:
        st.userProfile?.displayName ||
        st.authState.displayName ||
        (st.userProfile?.username ? `@${st.userProfile.username}` : '') ||
        st.authState.email?.split('@')[0] ||
        'Tú',
      avatarUrl: st.userProfile?.avatarUrl ?? st.authState.avatarUrl ?? null,
    };
  }

  function syncJamIdleClock(playing: boolean, nowMs = Date.now()): void {
    const st = get();
    if (st.activeJamRole !== 'host' || !st.activeJamSession?.active) {
      jamIdleSinceMs = null;
      return;
    }
    if (playing) {
      jamIdleSinceMs = null;
    } else if (jamIdleSinceMs === null) {
      jamIdleSinceMs = nowMs;
    }
  }

  async function runJamIdleAutoEndCheck(nowMs = Date.now()): Promise<boolean> {
    const st = get();
    if (st.activeJamRole !== 'host' || !st.activeJamSession?.active) {
      jamIdleSinceMs = null;
      return false;
    }
    if (st.isPlaying) {
      jamIdleSinceMs = null;
      return false;
    }
    if (jamIdleSinceMs === null) {
      jamIdleSinceMs = nowMs;
      return false;
    }
    if (nowMs - jamIdleSinceMs >= JAM_IDLE_TIMEOUT_MS) {
      jamIdleSinceMs = null;
      await st.leaveOrEndJam('Jam finalizada automáticamente tras 5 min sin música');
      return true;
    }
    return false;
  }

  function cleanupJamRealtime(): void {
    if (jamHostPushTimer) {
      clearTimeout(jamHostPushTimer);
      jamHostPushTimer = null;
    }
    if (jamFallbackPollTimer) {
      clearInterval(jamFallbackPollTimer);
      jamFallbackPollTimer = null;
    }
    if (jamIdleCheckTimer) {
      clearInterval(jamIdleCheckTimer);
      jamIdleCheckTimer = null;
    }
    jamIdleSinceMs = null;
    if (jamRealtimeChannel) {
      try {
        void jamRealtimeChannel.unsubscribe?.();
        getSyncSupabaseClient()?.removeChannel?.(jamRealtimeChannel);
        getAnonSupabaseClient().removeChannel?.(jamRealtimeChannel);
      } catch {
        // ignore channel cleanup
      }
      jamRealtimeChannel = null;
    }
    processedJamRequestIds.clear();
  }

  function syncOwnListeningPresence(): void {
    if (!friendPresenceChannel || !friendPresenceReady) return;
    const cur = get();
    try {
      if (
        !cur.shareListeningActivity ||
        !cur.isPlaying ||
        !cur.currentTrack?.id ||
        !cur.authState.connected ||
        !cur.authState.userId
      ) {
        void friendPresenceChannel.untrack?.();
        return;
      }
      void friendPresenceChannel.track?.({
        userId: cur.authState.userId,
        username: cur.userProfile?.username,
        displayName: cur.userProfile?.displayName ?? cur.authState.displayName,
        avatarUrl: cur.userProfile?.avatarUrl ?? cur.authState.avatarUrl,
        trackId: cur.currentTrack.id,
        trackTitle: cur.currentTrack.title,
        trackArtist: cur.currentTrack.artists.map((a) => a.name).join(', '),
        thumbnailUrl: cur.currentTrack.thumbnailUrl,
        isPlaying: true,
        updatedAt: new Date().toISOString(),
      });
    } catch {
      // ignore realtime presence error
    }
  }
  triggerPresenceSync = syncOwnListeningPresence;

  function cleanupSocialRealtime(): void {
    if (socialRealtimeChannel) {
      try {
        void socialRealtimeChannel.unsubscribe?.();
        getSyncSupabaseClient()?.removeChannel?.(socialRealtimeChannel);
      } catch {
        // ignore
      }
      socialRealtimeChannel = null;
    }
    if (friendPresenceChannel) {
      try {
        void friendPresenceChannel.untrack?.();
        void friendPresenceChannel.unsubscribe?.();
        getSyncSupabaseClient()?.removeChannel?.(friendPresenceChannel);
      } catch {
        // ignore
      }
      friendPresenceChannel = null;
    }
    friendPresenceReady = false;
    friendPresenceUserId = '';
    socialSubscribedUserId = '';
    set({ friendActivities: {} });
  }

  let lastHostJamPushAtMs = 0;

  function buildHostSyncedTrack(cur: PMusicStoreState): Track {
    const cleanBase = { ...cur.currentTrack } as Track & { __jamSync?: unknown };
    delete cleanBase.__jamSync;
    const liveSyncPos = getLivePlaybackPosition();
    return {
      ...cleanBase,
      __jamSync: {
        positionSec: Number(Math.max(0, liveSyncPos.positionSec).toFixed(2)),
        updatedAtMs: Date.now(),
        isPlaying: cur.isPlaying,
        djEnabled: cur.djMode.enabled,
        crossfadeEnabled: cur.safeCrossfade.enabled,
        crossfadeSec: cur.safeCrossfade.durationSec,
        eqEnabled: cur.userEq.enabled,
        eqPreset: cur.userEq.preset,
      },
    } as Track;
  }

  function pushHostJamStateSoon(): void {
    const st = get();
    const sb = getSyncSupabaseClient();
    if (!sb || !st.activeJamSession?.active || st.activeJamRole !== 'host') return;
    if (jamHostPushTimer) clearTimeout(jamHostPushTimer);
    jamHostPushTimer = setTimeout(() => {
      jamHostPushTimer = null;
      const cur = get();
      const sbNow = getSyncSupabaseClient();
      if (!sbNow || !cur.activeJamSession?.active || cur.activeJamRole !== 'host') return;
      lastHostJamPushAtMs = Date.now();
      const liveQueue = cur.queue.slice(Math.max(0, cur.queueIndex));
      void updateJamSessionState(sbNow, cur.activeJamSession.code, {
        currentTrack: buildHostSyncedTrack(cur),
        queue: liveQueue,
        isPlaying: cur.isPlaying,
        allowGuestDirectAdd: cur.activeJamSession.allowGuestDirectAdd,
        maxRequestsPerGuest: cur.activeJamSession.maxRequestsPerGuest,
      });
    }, 220);
  }

  async function syncSharedPlaylistsToLocalPlaylists(sharedList: SharedPlaylistRecord[]): Promise<void> {
    if (!sharedList || sharedList.length === 0) return;
    const localPls = libraryStore.getPlaylists();
    let mutated = false;
    for (const sp of sharedList) {
      if (!sp.shareCode) continue;
      const match = localPls.find(
        (lp) => lp.shareCode && lp.shareCode.toUpperCase() === sp.shareCode!.toUpperCase()
      );
      if (match) {
        const diffTracks =
          match.tracks.length !== sp.tracks.length ||
          match.tracks.some(
            (t, idx) =>
              t.id !== sp.tracks[idx]?.id ||
              (t.addedBy?.userId ?? '') !== (sp.tracks[idx]?.addedBy?.userId ?? '')
          );
        const diffCollab = Boolean(match.isCollaborative) !== Boolean(sp.allowLinkEdit);
        if (diffTracks || diffCollab || match.name !== sp.name) {
          mutated = true;
          await libraryStore.updatePlaylist(match.id, {
            tracks: sp.tracks,
            isCollaborative: Boolean(sp.allowLinkEdit),
            name: sp.name,
            coverUrl: sp.coverUrl ?? match.coverUrl,
          });
        }
      }
    }
    if (mutated) {
      set({ playlists: libraryStore.getPlaylists() });
      syncUserLibraryContextToEngine();
    }
  }

  function processIncomingHostJamRequests(reqs: JamRequestRecord[]): void {
    const st = get();
    if (st.activeJamRole !== 'host' || !st.activeJamSession?.active) return;
    const myNameLow = getOwnAdderIdentity().displayName.trim().toLowerCase();
    for (const req of reqs) {
      if (req.status === 'approved' && !processedJamRequestIds.has(req.id)) {
        processedJamRequestIds.add(req.id);
        if (isJamQueueOpRequest(req)) {
          const op = req.track as unknown as JamQueueOpPayload;
          const cur = get();
          const baseIdx = Math.max(0, cur.queueIndex);
          const upNext = cur.queue.slice(baseIdx + 1);
          const isOwnOp = req.guestName.trim().toLowerCase() === myNameLow;
          if (op.__jamOp === 'move') {
            const fromRel = upNext.findIndex((t) => t.id === op.targetTrackId);
            if (fromRel >= 0) {
              const targetRel = Math.max(
                0,
                Math.min(upNext.length - 1, op.toUpNextIndex ?? Math.max(0, fromRel - 1))
              );
              if (fromRel !== targetRel) {
                const nextUp = [...upNext];
                const [moved] = nextUp.splice(fromRel, 1);
                if (moved) {
                  nextUp.splice(targetRel, 0, moved);
                  set({ queue: [...cur.queue.slice(0, baseIdx + 1), ...nextUp] });
                  if (!isOwnOp) cur.showToast(`${req.guestName} reordenó la cola de la Jam`);
                  pushHostJamStateSoon();
                }
              }
            }
          } else if (op.__jamOp === 'remove') {
            const rmRel = upNext.findIndex((t) => t.id === op.targetTrackId);
            if (rmRel >= 0) {
              const nextUp = [...upNext];
              const [removed] = nextUp.splice(rmRel, 1);
              set({ queue: [...cur.queue.slice(0, baseIdx + 1), ...nextUp] });
              if (!isOwnOp && removed) {
                cur.showToast(`${req.guestName} quitó «${removed.title}» de la cola`);
              }
              pushHostJamStateSoon();
            }
          } else if (op.__jamOp === 'add_next' && op.track?.id) {
            const cleaned = { ...(op.track as Track & { __jamOp?: unknown; targetTrackId?: unknown; toUpNextIndex?: unknown }) };
            delete cleaned.__jamOp;
            delete cleaned.targetTrackId;
            delete cleaned.toUpNextIndex;
            const stamped = cleaned.addedBy?.displayName
              ? cleaned
              : stampTrackAddedBy(cleaned, {
                  displayName: req.guestName || 'Invitado',
                  avatarUrl: cleaned.addedBy?.avatarUrl ?? null,
                });
            if (!upNext.some((t) => t.id === stamped.id)) {
              set({ queue: [...cur.queue.slice(0, baseIdx + 1), stamped, ...upNext] });
              if (!isOwnOp) cur.showToast(`${req.guestName} puso «${stamped.title}» a continuación`);
              pushHostJamStateSoon();
            }
          }
          continue;
        }
        if (req.track?.id && !st.queue.some((t) => t.id === req.track.id)) {
          const stamped = req.track.addedBy?.displayName
            ? req.track
            : stampTrackAddedBy(req.track, {
                displayName: req.guestName || 'Invitado',
                avatarUrl: req.track.addedBy?.avatarUrl ?? null,
              });
          set((prev) => ({
            queue: prev.queue.some((t) => t.id === stamped.id)
              ? prev.queue
              : [...prev.queue, stamped],
          }));
          if (req.guestName.trim().toLowerCase() !== myNameLow) {
            get().showToast(`${req.guestName} añadió «${req.track.title}» a la Jam`);
          }
          pushHostJamStateSoon();
        }
      }
    }
  }

  function subscribeJamRealtime(code: string): void {
    cleanupJamRealtime();
    const cleanCode = code.trim().toUpperCase();
    if (!cleanCode) return;
    const sb = getSyncSupabaseClient() ?? getAnonSupabaseClient();

    const refreshJamSnapshot = async () => {
      const [sess, reqs] = await Promise.all([
        fetchPublicJamSession(cleanCode),
        fetchPublicJamRequests(cleanCode),
      ]);
      const cur = get();
      if (!cur.activeJamSession || cur.activeJamSession.code !== cleanCode) return;
      if (!sess || !sess.active) {
        cleanupJamRealtime();
        set({
          activeJamSession: null,
          activeJamRole: null,
          activeJamCode: null,
          activeJamRequests: [],
          jamInviteModalOpen: false,
        });
        get().showToast('La sala Jam ha finalizado');
        return;
      }
      if (cur.activeJamRole === 'guest') {
        const syncMeta = extractJamSyncMeta(sess);
        const guestPatch: Partial<PMusicStoreState> = {
          activeJamSession: sess,
          activeJamRequests: reqs,
        };
        if (sess.currentTrack) {
          const cleanTrack = { ...sess.currentTrack } as Track & { __jamSync?: unknown };
          delete cleanTrack.__jamSync;
          const elapsedSec =
            syncMeta && syncMeta.isPlaying
              ? Math.max(0, (Date.now() - syncMeta.updatedAtMs) / 1000)
              : 0;
          const syncedPos = syncMeta
            ? Math.min(cleanTrack.durationSec || 9999, syncMeta.positionSec + elapsedSec)
            : cur.positionSec;
          const syncedQueue = sess.queue.length > 0 ? sess.queue : [cleanTrack];
          const idx = Math.max(
            0,
            syncedQueue.findIndex((q) => q.id === cleanTrack.id)
          );
          guestPatch.currentTrack = cleanTrack;
          guestPatch.durationSec = cleanTrack.durationSec || cur.durationSec;
          guestPatch.isPlaying = sess.isPlaying;
          guestPatch.positionSec = syncedPos;
          guestPatch.queue = syncedQueue;
          guestPatch.queueIndex = idx;
        }
        set(guestPatch);
      } else {
        set({
          activeJamSession: sess,
          activeJamRequests: reqs,
        });
        processIncomingHostJamRequests(reqs);
        if (cur.isPlaying && Date.now() - lastHostJamPushAtMs >= 4800) {
          pushHostJamStateSoon();
        }
      }
    };

    try {
      jamRealtimeChannel = sb
        .channel(`pmusic-jam-rt:${cleanCode}:${Date.now()}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'jam_sessions', filter: `code=eq.${cleanCode}` },
          () => {
            void refreshJamSnapshot();
          }
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'jam_requests', filter: `jam_code=eq.${cleanCode}` },
          () => {
            void refreshJamSnapshot();
          }
        )
        .subscribe();
    } catch {
      // ignore realtime init error, fallback poll keeps syncing
    }

    jamFallbackPollTimer = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      void refreshJamSnapshot();
    }, 5500);

    jamIdleSinceMs = get().isPlaying ? null : Date.now();
    jamIdleCheckTimer = setInterval(() => {
      void runJamIdleAutoEndCheck();
    }, 5000);
  }

  function buildLocalTasteSnapshot(): AccountTasteProfile {
    const st = get();
    return buildCompactAccountTasteProfile({
      affinities: recommendationEngine.getAffinityProfile(),
      playHistory: libraryStore.getPlayHistory(),
      seedArtists: recommendationEngine.getSeedArtists(),
      playlistPlayCounts: st.playlistPlayCounts,
    });
  }

  async function hydrateAndMergeCloudTaste(
    cloudPrefs: Record<string, any> | null | undefined,
    options?: { skipShelfRebuild?: boolean }
  ): Promise<void> {
    const remoteTaste = (cloudPrefs?.tasteProfile ?? null) as AccountTasteProfile | null;
    const localTaste = buildLocalTasteSnapshot();
    const merged = mergeAccountTasteProfiles(localTaste, remoteTaste);

    if (merged.affinities.length > 0) {
      await libraryStore.setAffinities(merged.affinities);
    }
    if (merged.playHistory.length > 0) {
      await libraryStore.setPlayHistory(merged.playHistory);
    }
    if (merged.seedArtists.length > 0) {
      await recommendationEngine.updateSeedArtists(merged.seedArtists);
    }
    await recommendationEngine.hydrate();
    syncUserLibraryContextToEngine();

    set({
      playlistPlayCounts: merged.playlistPlayCounts,
      affinityProfile: recommendationEngine.getAffinityProfile(),
      playHistory: libraryStore.getPlayHistory(),
      seedArtists: recommendationEngine.getSeedArtists(),
    });

    if (!options?.skipShelfRebuild) {
      // Trigger immediate shelf refresh under the latest epoch so merged account taste wins over initial cold shelves
      const myEpoch = ++homeShelvesBuildEpoch;
      try {
        const freshShelves = await recommendationEngine.buildHomeShelves();
        if (myEpoch !== homeShelvesBuildEpoch) return;
        const allReal = Array.from(
          new Map(freshShelves.flatMap((s) => s.tracks ?? []).map((t) => [t.id, t])).values()
        );
        set((prev) => ({
          homeShelves: allReal.length > 0 ? freshShelves : prev.homeShelves,
          ...(allReal.length > 0 && !prev.isPlaying
            ? {
                currentTrack: allReal[0]!,
                queue: allReal.slice(0, 10),
                recommendedQueue: allReal.slice(10, 20),
                queueIndex: 0,
                durationSec: allReal[0]!.durationSec,
                positionSec: 0,
              }
            : {}),
        }));
        if (isLiveRuntime()) {
          void get().refreshExploreDiscovery(true);
        }
      } catch {
        // keep existing shelves if offline
      }
    }

    if (get().authState.connected && (!remoteTaste || merged.richnessScore > (remoteTaste.richnessScore ?? 0))) {
      persistPrefsFromStore();
    }
  }

  let activeEditorialMixesState: SyncedEditorialMixesState | null = null;

  function collectLibraryArtistNames(): string[] {
    const state = get();
    const seen = new Set<string>();
    const out: string[] = [];
    const pushArtist = (name?: string) => {
      const trimmed = (name ?? '').trim();
      if (!trimmed) return;
      const key = trimmed.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      out.push(trimmed);
    };
    for (const fa of state.favoriteArtists) pushArtist(fa.artistName);
    for (const entry of state.likedTracks) {
      for (const a of entry.track.artists) pushArtist(a.name);
    }
    for (const pl of state.playlists) {
      for (const t of pl.tracks) {
        for (const a of t.artists) pushArtist(a.name);
      }
    }
    return out;
  }

  function syncEditorialMixesFromShelves(
    shelves: HomeEditorialShelf[],
    ownerKey: string | null,
    opts?: { forceReset?: boolean; markDescubreScan?: boolean }
  ): HomeEditorialShelf[] {
    const todayKey = getLocalDayKey();
    const favNames = get().favoriteArtists.map((fa) => fa.artistName);
    const libArtistNames = collectLibraryArtistNames();
    const mixes = shelves.flatMap((s) => s.mixes ?? []);
    const dlnMix = mixes.find((m) => m.id === 'mix_descubre_lo_nuevo');
    const dmMix = mixes.find((m) => m.id === 'mix_daily_mix');
    const ddMix = mixes.find((m) => m.id === 'mix_daily_discover');

    const prev = opts?.forceReset ? null : activeEditorialMixesState ?? readSyncedEditorialMixes(ownerKey);
    const prevIsStaleAlgo = (prev?.descubre?.algoVersion ?? 1) < DESCUBRE_ALGO_VERSION;
    const incomingDescubreTracks = dlnMix?.tracks ?? [];
    const baseExistingDescubre =
      prevIsStaleAlgo && incomingDescubreTracks.length > 0 ? [] : prev?.descubre?.tracks ?? [];
    const nextDescubreTracks = mergeIncrementalDescubrePool(
      baseExistingDescubre,
      incomingDescubreTracks,
      new Date(),
      favNames,
      libArtistNames
    );
    const prevDm = prev?.dailyMix;
    const prevDd = prev?.dailyDiscover;
    const nextDailyMix = dmMix
      ? evolveDailyPlaylistForNewDay(prevDm, dmMix.tracks ?? [], dmMix.subtitle ?? '', todayKey, 0.65)
      : prevDm ?? null;
    const nextDailyDiscover = ddMix
      ? evolveDailyPlaylistForNewDay(prevDd, ddMix.tracks ?? [], ddMix.subtitle ?? '', todayKey, 0.6)
      : prevDd ?? null;

    const nowMs = Date.now();
    const nextState: SyncedEditorialMixesState = {
      version: 1,
      ownerUserId: ownerKey,
      updatedAt: nowMs,
      descubre: {
        lastScanAt: opts?.markDescubreScan ? nowMs : prev?.descubre?.lastScanAt ?? nowMs,
        lastScanDay: opts?.markDescubreScan ? todayKey : prev?.descubre?.lastScanDay ?? todayKey,
        algoVersion: DESCUBRE_ALGO_VERSION,
        tracks:
          nextDescubreTracks.length > 0
            ? nextDescubreTracks
            : (dlnMix?.tracks ?? [])
                .filter((t) => {
                  const cutoff15 = getRollingDaysAgoIso(15);
                  return Boolean(t.releaseDate && t.releaseDate >= cutoff15 && t.releaseDate <= todayKey);
                })
                .slice(0, 50)
                .map((t) => toCompactSyncedTrack(t, t.releaseDate ?? todayKey)),
      },
      dailyMix: nextDailyMix,
      dailyDiscover: nextDailyDiscover,
    };
    activeEditorialMixesState = nextState;
    writeSyncedEditorialMixes(nextState);
    return applySyncedMixesToShelves(shelves, nextState);
  }

  function feedPassiveDescubreTracks(candidateTracks: readonly Track[], ownerKey: string | null): void {
    const cutoff15 = getRollingDaysAgoIso(15);
    const freshOnes = candidateTracks.filter((t) => t.releaseDate && t.releaseDate >= cutoff15);
    if (freshOnes.length === 0) return;

    const prev = activeEditorialMixesState ?? readSyncedEditorialMixes(ownerKey);
    if (!prev) return;

    const prevIds = prev.descubre.tracks.map((t) => t.id).join('|');
    const favNames = get().favoriteArtists.map((fa) => fa.artistName);
    const libArtistNames = collectLibraryArtistNames();
    const mergedTracks = mergeIncrementalDescubrePool(
      prev.descubre.tracks,
      freshOnes,
      new Date(),
      favNames,
      libArtistNames
    );
    const nextIds = mergedTracks.map((t) => t.id).join('|');
    if (mergedTracks.length === 0 || prevIds === nextIds) return;

    const nextState: SyncedEditorialMixesState = {
      ...prev,
      updatedAt: Date.now(),
      descubre: {
        ...prev.descubre,
        algoVersion: prev.descubre.algoVersion ?? DESCUBRE_ALGO_VERSION,
        tracks: mergedTracks,
      },
    };
    activeEditorialMixesState = nextState;
    writeSyncedEditorialMixes(nextState);
    const updatedShelves = applySyncedMixesToShelves(get().homeShelves, nextState);
    saveCachedHomeShelves(updatedShelves, ownerKey);
    set({ homeShelves: updatedShelves });
    persistPrefsFromStore();
  }

  function flushCloudPrefsNow(): void {
    if (!pendingCloudPrefsPayload || !get().authState.connected) return;
    if (cloudPrefsSaveTimer) {
      clearTimeout(cloudPrefsSaveTimer);
      cloudPrefsSaveTimer = null;
    }
    const payload = pendingCloudPrefsPayload;
    pendingCloudPrefsPayload = null;
    const savedAt = Number(payload.savedAt ?? Date.now());
    lastLocalPrefsSavedAt = Math.max(lastLocalPrefsSavedAt, savedAt);
    void syncEngine.saveAccountPreferences?.(payload)?.then(() => {
      void syncEngine.sendRemoteCommand({ targetDeviceId: '*', type: 'library_sync' });
    });
  }

  function persistPrefsFromStore(immediate = false): void {
    const st = get();
    const tasteProfile = buildCompactAccountTasteProfile({
      affinities: recommendationEngine.getAffinityProfile(),
      playHistory: libraryStore.getPlayHistory(),
      seedArtists: recommendationEngine.getSeedArtists(),
      playlistPlayCounts: st.playlistPlayCounts,
    });
    const payload = {
      savedAt: Date.now(),
      ownerUserId: st.authState.userId ?? null,
      themeId: st.themeId,
      playerBarStyle: st.playerBarStyle,
      accentPreset: st.accentPreset,
      surfaceStyle: st.surfaceStyle,
      liquidGlassMode: st.liquidGlassMode,
      ambientMotionEnabled: st.ambientMotionEnabled,
      graphicSaverMode: st.graphicSaverMode,
      reducedMotionPref: st.reducedMotionPref,
      visualizerEnabled: st.visualizerEnabled,
      lyricsSize: st.lyricsSize,
      lyricsBlurEnabled: st.lyricsBlurEnabled,
      lyricsStyle: st.lyricsStyle,
      nowPlayingBackdropStyle: st.nowPlayingBackdropStyle,
      alwaysShuffle: st.alwaysShuffle,
      shuffleEnabled: st.shuffleEnabled,
      skipSameAlbumCoverTransition: st.skipSameAlbumCoverTransition,
      marqueeTextEnabled: st.marqueeTextEnabled,
      showRemainingTime: st.showRemainingTime,
      repeatMode: st.repeatMode,
      volume: st.volume,
      sidebarCollapsed: st.sidebarCollapsed,
      rightPanelOpen: st.rightPanelOpen,
      discordRpcEnabled: st.discordRpcEnabled,
      discordRpcConfig: st.discordRpcConfig,
      playbackRate: st.playbackRate,
      preservesPitch: st.preservesPitch,
      audioNormalization: st.audioNormalization,
      normalizationTarget: st.normalizationTarget,
      stereoBalance: st.stereoBalance,
      monoAudio: st.monoAudio,
      streamQuality: st.streamQuality,
      autoplayEnabled: st.autoplayEnabled,
      safeCrossfade: st.safeCrossfade,
      userEq: st.userEq,
      djMode: st.djMode,
      favoriteArtists: st.favoriteArtists,
      dismissedPlaylistRecs: st.dismissedPlaylistRecs,
      playlistAppearances: st.playlistAppearances,
      playlistPlayCounts: st.playlistPlayCounts,
      tasteProfile,
      ...(activeEditorialMixesState ? { editorialMixes: activeEditorialMixesState } : {}),
    };
    const compactJson = JSON.stringify(payload);
    void defaultPlatformBridge.preferencesStorage
      .setItem(USER_PREFS_STORAGE_KEY, compactJson)
      .catch(() => {});
    if (typeof window !== 'undefined') {
      void (window as any).pmusicDesktop?.writePrefsFile?.(compactJson)?.catch?.(() => {});
    }

    if (st.authState.connected) {
      pendingCloudPrefsPayload = payload;
      if (cloudPrefsSaveTimer) {
        clearTimeout(cloudPrefsSaveTimer);
        cloudPrefsSaveTimer = null;
      }
      if (immediate) {
        flushCloudPrefsNow();
      } else {
        cloudPrefsSaveTimer = setTimeout(() => {
          flushCloudPrefsNow();
        }, 450);
      }
    }
  }

  function applyPreferencesPayload(prefs: Record<string, any>): void {
    const resolvedSurfaceStyle: PMusicSurfaceStyle =
      prefs.surfaceStyle === 'liquid-glass' ||
      prefs.surfaceStyle === 'frosted-glass' ||
      prefs.surfaceStyle === 'simple'
        ? prefs.surfaceStyle
        : typeof prefs.liquidGlassMode === 'boolean'
          ? prefs.liquidGlassMode
            ? 'liquid-glass'
            : 'simple'
          : prefs.graphicSaverMode
            ? 'simple'
            : get().surfaceStyle;

    applySurfaceStyleClasses(resolvedSurfaceStyle);
    if (typeof document !== 'undefined') {
      document.documentElement.classList.toggle(
        'pm-reduced-motion',
        Boolean(prefs.reducedMotionPref)
      );
    }

    const resolvedTheme =
      typeof prefs.themeId === 'string'
        ? (prefs.themeId as PMusicThemeId)
        : get().themeId;
    if (typeof prefs.themeId === 'string') {
      applyPMusicTheme(resolvedTheme);
    }
    if (typeof prefs.accentPreset === 'string') {
      applyAccentOverride(
        prefs.accentPreset as PMusicAccentPresetId,
        resolvedTheme
      );
    }
    if (typeof prefs.streamQuality === 'string') {
      currentStreamQualityPref = prefs.streamQuality as AudioStreamQuality;
      setDataSaverMode(prefs.streamQuality === 'low');
    }
    if (prefs.userEq) audioEngine.setUserEq(prefs.userEq as UserEqConfig);
    if (prefs.safeCrossfade) {
      audioEngine.setSafeCrossfade(prefs.safeCrossfade as SafeCrossfadeConfig);
    }
    if (prefs.djMode) audioEngine.setDjMode(prefs.djMode as DjModeConfig);
    if (typeof prefs.playbackRate === 'number') {
      audioEngine.setPlaybackRate(prefs.playbackRate, prefs.preservesPitch !== false);
    }
    if (typeof prefs.stereoBalance === 'number') {
      audioEngine.setBalance(prefs.stereoBalance);
    }
    if (typeof prefs.monoAudio === 'boolean') {
      audioEngine.setMonoAudio(prefs.monoAudio);
    }

    set((prev) => ({
      themeId: (prefs.themeId as PMusicThemeId) ?? prev.themeId,
      playerBarStyle:
        prefs.playerBarStyle === 'classic-center' ||
        prefs.playerBarStyle === 'ambient-dock' ||
        prefs.playerBarStyle === 'floating-island' ||
        prefs.playerBarStyle === 'minimal-wave'
          ? prefs.playerBarStyle
          : prev.playerBarStyle,
      accentPreset: (prefs.accentPreset as PMusicAccentPresetId) ?? prev.accentPreset,
      surfaceStyle: resolvedSurfaceStyle,
      liquidGlassMode: resolvedSurfaceStyle === 'liquid-glass',
      ambientMotionEnabled: Boolean(prefs.ambientMotionEnabled ?? prev.ambientMotionEnabled),
      graphicSaverMode: resolvedSurfaceStyle === 'simple',
      reducedMotionPref: Boolean(prefs.reducedMotionPref ?? prev.reducedMotionPref),
      visualizerEnabled: Boolean(prefs.visualizerEnabled ?? prev.visualizerEnabled),
      lyricsSize: prefs.lyricsSize ?? prev.lyricsSize,
      lyricsBlurEnabled: Boolean(prefs.lyricsBlurEnabled ?? prev.lyricsBlurEnabled),
      lyricsStyle:
        prefs.lyricsStyle === 'classic' ||
        prefs.lyricsStyle === 'wordflow' ||
        prefs.lyricsStyle === 'kinetic' ||
        prefs.lyricsStyle === 'neon' ||
        prefs.lyricsStyle === 'typewriter' ||
        prefs.lyricsStyle === 'poster' ||
        prefs.lyricsStyle === 'focus' ||
        prefs.lyricsStyle === 'editorial'
          ? prefs.lyricsStyle
          : prev.lyricsStyle,
      nowPlayingBackdropStyle: parseNowPlayingBackdropStyle(
        prefs.nowPlayingBackdropStyle,
        prev.nowPlayingBackdropStyle
      ),
      alwaysShuffle: Boolean(prefs.alwaysShuffle ?? prev.alwaysShuffle),
      shuffleEnabled:
        typeof prefs.shuffleEnabled === 'boolean'
          ? prefs.shuffleEnabled
          : Boolean(prefs.alwaysShuffle ?? prev.shuffleEnabled),
      skipSameAlbumCoverTransition: Boolean(
        prefs.skipSameAlbumCoverTransition ?? prev.skipSameAlbumCoverTransition
      ),
      marqueeTextEnabled: Boolean(prefs.marqueeTextEnabled ?? prev.marqueeTextEnabled),
      showRemainingTime: Boolean(prefs.showRemainingTime ?? prev.showRemainingTime),
      repeatMode:
        prefs.repeatMode === 'off' ||
        prefs.repeatMode === 'all' ||
        prefs.repeatMode === 'one'
          ? prefs.repeatMode
          : prev.repeatMode,
      ...(typeof prefs.volume === 'number' && !isMobileHardwareVolumeRuntime()
        ? { volume: Math.max(0, Math.min(1, prefs.volume)) }
        : {}),
      ...(typeof prefs.sidebarCollapsed === 'boolean'
        ? { sidebarCollapsed: prefs.sidebarCollapsed }
        : {}),
      ...(typeof prefs.rightPanelOpen === 'boolean'
        ? { rightPanelOpen: prefs.rightPanelOpen }
        : {}),
      ...(Boolean(prefs.alwaysShuffle ?? prev.alwaysShuffle) ? { shuffleEnabled: true } : {}),
      discordRpcEnabled: Boolean(prefs.discordRpcEnabled ?? prev.discordRpcEnabled),
      discordRpcConfig: {
        ...prev.discordRpcConfig,
        ...(prefs.discordRpcConfig ?? {}),
        clientId:
          prefs.discordRpcConfig?.clientId?.trim() || DEFAULT_DISCORD_CLIENT_ID,
      },
      playbackRate: Number(prefs.playbackRate ?? prev.playbackRate),
      preservesPitch: Boolean(prefs.preservesPitch ?? prev.preservesPitch),
      audioNormalization: Boolean(prefs.audioNormalization ?? prev.audioNormalization),
      normalizationTarget: prefs.normalizationTarget ?? prev.normalizationTarget,
      stereoBalance: Number(prefs.stereoBalance ?? prev.stereoBalance),
      monoAudio: Boolean(prefs.monoAudio ?? prev.monoAudio),
      streamQuality: prefs.streamQuality ?? prev.streamQuality,
      autoplayEnabled: Boolean(prefs.autoplayEnabled ?? prev.autoplayEnabled),
      safeCrossfade: prefs.safeCrossfade ?? prev.safeCrossfade,
      userEq: prefs.userEq ?? prev.userEq,
      djMode: prefs.djMode ?? prev.djMode,
      dismissedPlaylistRecs:
        prefs.dismissedPlaylistRecs && typeof prefs.dismissedPlaylistRecs === 'object'
          ? (prefs.dismissedPlaylistRecs as Record<string, string[]>)
          : prev.dismissedPlaylistRecs,
      playlistAppearances:
        prefs.playlistAppearances && typeof prefs.playlistAppearances === 'object'
          ? (prefs.playlistAppearances as Record<string, PlaylistAppearanceEntry>)
          : prev.playlistAppearances,
      playlistPlayCounts:
        prefs.playlistPlayCounts && typeof prefs.playlistPlayCounts === 'object'
          ? (prefs.playlistPlayCounts as Record<string, PlaylistPlayStat>)
          : prev.playlistPlayCounts,
      ...(Array.isArray(prefs.favoriteArtists)
        ? {
            favoriteArtists: (prefs.favoriteArtists as FavoriteArtistRecord[]).filter(
              (a) => Boolean(a?.artistId && a?.artistName)
            ),
          }
        : {}),
    }));
    if (Array.isArray(prefs.favoriteArtists)) {
      recommendationEngine.setFavoriteArtists(
        (prefs.favoriteArtists as FavoriteArtistRecord[]).filter(
          (a) => Boolean(a?.artistId && a?.artistName)
        )
      );
    }
    if (prefs.editorialMixes && typeof prefs.editorialMixes === 'object') {
      const mergedMixes = mergeCloudEditorialMixes(
        activeEditorialMixesState ?? readSyncedEditorialMixes(get().authState.userId ?? null),
        prefs.editorialMixes,
        new Date(),
        get().favoriteArtists.map((a) => a.artistName),
        collectLibraryArtistNames()
      );
      if (mergedMixes) {
        activeEditorialMixesState = mergedMixes;
        writeSyncedEditorialMixes(mergedMixes);
        set((prev) => ({
          homeShelves: applySyncedMixesToShelves(prev.homeShelves, mergedMixes),
        }));
      }
    }
  }

  function syncAndroidAutoLibrarySnapshot(): void {
    if (typeof window === 'undefined') return;
    const native = (window as unknown as {
      PMusicNative?: { syncCarLibrary?: (json: string) => void };
    }).PMusicNative;
    if (!native?.syncCarLibrary) return;
    try {
      const st = get();
      const mapMiniTrack = (t: Track) => ({
        id: t.id,
        title: t.title,
        artist: t.artists.map((a) => a.name).join(', '),
        art: t.thumbnailUrl ?? '',
        durationSec: t.durationSec,
      });
      const recentTracks: Track[] = [];
      const seen = new Set<string>();
      for (const h of st.playHistory) {
        if (h.track && !seen.has(h.track.id)) {
          seen.add(h.track.id);
          recentTracks.push(h.track);
        }
        if (recentTracks.length >= 16) break;
      }
      for (const s of st.homeShelves) {
        for (const t of s.tracks ?? []) {
          if (!seen.has(t.id)) {
            seen.add(t.id);
            recentTracks.push(t);
          }
          if (recentTracks.length >= 18) break;
        }
        if (recentTracks.length >= 18) break;
      }
      const payload = {
        recents: recentTracks.map(mapMiniTrack),
        liked: st.likedTracks.slice(0, 20).map((l) => mapMiniTrack(l.track)),
        playlists: st.playlists.slice(0, 14).map((p) => ({
          id: p.id,
          name: p.name,
          count: p.tracks.length,
          art: p.coverUrl ?? p.tracks[0]?.thumbnailUrl ?? '',
        })),
      };
      native.syncCarLibrary(JSON.stringify(payload));
    } catch {
      // ignore Android Auto bridge failures
    }
  }

  return {
  activeTab: 'Inicio',
  appReady: false,
  homeFeedReady: isVitestEnv() || !isLiveRuntime(),
  carModeOpen: false,
  sidebarCollapsed: typeof window !== 'undefined' ? window.innerWidth < 1024 : false,
  rightPanelOpen: typeof window !== 'undefined' ? window.innerWidth >= 1280 : false,
  nowPlayingOpen: false,
  nowPlayingTab: 'Portada',
  eqSheetOpen: false,
  djPopoverOpen: false,
  devicesSheetOpen: false,
  importModalOpen: false,
  settingsOpen: false,
  settingsReturnToMobileHub: false,
  settingsInitialCategory: null,
  mobileHubOpen: false,
  spotlightOpen: false,
  savedAccounts: [],
  activeDetailView: null,
  detailViewHistory: [],
  isOfflineNetwork: typeof navigator !== 'undefined' ? !navigator.onLine : false,
  isAppHidden: typeof document !== 'undefined' ? Boolean(document.hidden) : false,
  surfaceStyle: 'liquid-glass',
  liquidGlassMode: true,
  ambientMotionEnabled: true,
  graphicSaverMode: false,
  reducedMotionPref: false,
  themeId: 'obsidian',
  playerBarStyle: 'classic-center',
  accentPreset: 'auto',
  lastTrackDirection: 'none',
  visualizerEnabled: true,
  lyricsSize: 'large',
  lyricsBlurEnabled: true,
  lyricsStyle: 'classic',
  nowPlayingBackdropStyle: 'pulse',
  alwaysShuffle: false,
  skipSameAlbumCoverTransition: true,
  marqueeTextEnabled: true,
  showRemainingTime: true,
  discordRpcEnabled: true,
  discordRpcConfig: {
    clientId: DEFAULT_DISCORD_CLIENT_ID,
    showTimestamps: true,
    showArtwork: true,
    showWhenPaused: true,
    displayMode: 'app',
  },
  discordRpcStatus: {
    connected: false,
    status: 'disconnected',
    clientId: DEFAULT_DISCORD_CLIENT_ID,
  },
  playbackRate: 1.0,
  preservesPitch: true,
  audioNormalization: true,
  normalizationTarget: 'normal',
  stereoBalance: 0,
  monoAudio: false,
  streamQuality: 'high',
  sleepTimerMode: 'off',
  sleepTimerRemainingSec: 0,
  trackInfoModalTrack: null,
  addToPlaylistModalTrack: null,
  trackMenu: null,
  toastMessage: null,

  currentTrack: initialTrack,
  queue: canonicalFallbackQueue,
  userQueueCount: 0,
  recommendedQueue: [],
  sessionPrevStack: [],
  isLoadingRecommendedQueue: false,
  unshuffledQueue: [],
  queueIndex: 0,
  shuffleEnabled: false,
  repeatMode: 'off',
  isPlaying: false,
  isBuffering: false,
  positionSec: 0,
  durationSec: initialTrack.durationSec,
  volume: 0.85,
  activeDeck: 'A',
  isTransitioning: false,
  activeTransitionType: undefined,
  transitionProgress01: 0,
  transitionDurationSec: 4,
  autoplayEnabled: true,

  djMode: {
    ...DEFAULT_DJ_MODE_CONFIG,
    enabledTransitions: {
      eq_swap: true,
      filter_sweep: true,
      echo_out: true,
      vocal_over_beat: true,
      instrumental_bed: true,
      loop_build: true,
    },
    stemSculpting: true,
    vocalClashProtection: true,
  },
  audioPanelTab: 'dj',
  outgoingTransitionTrack: null,
  incomingTransitionTrack: null,
  safeCrossfade: { ...DEFAULT_SAFE_CROSSFADE_CONFIG },
  userEq: {
    ...DEFAULT_USER_EQ_CONFIG,
    bandsDb: [...DEFAULT_USER_EQ_CONFIG.bandsDb] as UserEqBandsDb,
  },
  trackAnalyses: {},
  activeTransitionPlan: null,

  currentLyrics: null,
  activeLyricIndex: -1,
  lyricsUserScrolled: false,

  homeShelves:
    isLiveRuntime() && !isVitestEnv()
      ? []
      : [
        {
          id: 'shelf_listen_again',
          kind: 'listen_again',
          title: 'Escuchar de nuevo',
          subtitle: 'Tus temas recientes y favoritos al instante',
          tracks: canonicalFallbackQueue.slice(0, 8),
        },
        {
          id: 'shelf_mixes_for_you',
          kind: 'mixes_for_you',
          title: 'Mixes para ti',
          subtitle: 'Generados por tu algoritmo con Modo Sesión DJ',
          mixes: [
            {
              id: 'mix_cruz_urbano_es',
              title: 'Mix Cruzzi',
              subtitle: 'Cruzzi, La Pantera, Quevedo y escena urbana ES',
              coverUrl: canonicalFallbackQueue[0]!.thumbnailUrl,
              accentColor: '#BF5AF2',
              tracks: canonicalFallbackQueue.slice(0, 8),
            },
            {
              id: 'mix_trap_canarias',
              title: 'Mix La Pantera & Canarias',
              subtitle: 'La Pantera, Cruzzi, Juseph y trap isleño',
              coverUrl: canonicalFallbackQueue[3]!.thumbnailUrl,
              accentColor: '#0A84FF',
              tracks: [...canonicalFallbackQueue.slice(2), ...canonicalFallbackQueue.slice(0, 2)],
            },
            {
              id: 'mix_sesion_dj_club',
              title: 'Sesión DJ: Bad Bunny & Urbano',
              subtitle: 'Bad Bunny, Saiko, Morad y himnos de club',
              coverUrl: canonicalFallbackQueue[5]!.thumbnailUrl,
              accentColor: '#30D158',
              tracks: [...canonicalFallbackQueue].reverse(),
            },
          ],
        },
        {
          id: 'shelf_because_you_listened',
          kind: 'because_you_listened',
          title: 'Porque escuchaste a Cruzzi',
          subtitle: 'Recomendaciones adaptadas a tu perfil urbano',
          anchorArtist: 'Cruzzi',
          tracks: canonicalFallbackQueue.slice(0, 8),
        },
        {
          id: 'shelf_favorite_new_releases',
          kind: 'favorite_new_releases',
          title: 'Novedades de tus artistas favoritos',
          subtitle: 'Lanzamientos destacados de Bad Bunny, La Pantera y Cruzzi',
          albums: [...FALLBACK_ALBUMS],
          tracks: canonicalFallbackQueue.slice(0, 6),
        },
      ],
  searchQuery: '',
  isSearching: false,
  searchScope: 'Todo',
  searchResults: initialBundle,
  bestResult: initialBundle.topResult,
  autocompleteSuggestions: recommendationEngine.rankAutocomplete('', []),
  recentSearches: ['Cruzzi', 'La Pantera', 'Bad Bunny'],
  recentSearchItems: buildDefaultRecentSearchItems(),
  seedArtists: [...DEFAULT_SPANISH_URBAN_SEEDS],
  affinityProfile: recommendationEngine.getAffinityProfile(),
  exploreSimilarTracks: [],
  exploreEmergingArtists: [],
  isLoadingExplore: false,

  libraryCategory: 'Todo',
  libraryFilterQuery: '',
  playlists: [],
  playlistPlayCounts: {},
  dismissedPlaylistRecs: {},
  playlistAppearances: {},
  playlistContextMenu: null,
  playlistAppearanceModal: null,
  playlistDownloadProgress: null,
  likedTracks: [],
  playHistory: [],
  offlineDownloads: {},
  offlineEntries: [],
  wifiOnlyDownloads: readWifiOnlyDownloadsPref(),
  offlineAutoPlaylistIds: readOfflineAutoPlaylistIds(),

  importUrlInput: '',
  importProgress: null,
  importResult: null,
  importError: null,

  syncMode: syncEngine.mode,
  selfDeviceId: syncEngine.deviceId,
  deviceName:
    typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent)
      ? 'pMusic Android'
      : 'pMusic Windows PC',
  supabaseUrlInput: resolvedSupabaseUrl,
  supabaseAnonKeyInput: resolvedSupabaseKey,
  authState: syncEngine.getAuthState(),
  onlineDevices: syncEngine.getOnlineDevices(),
  lastTransferBanner: null,
  remoteControlledDeviceId: null,
  remoteDeviceSnapshot: null,

  authOnboardingOpen: false,
  needsProfileSetup: false,
  userProfile: null,
  authCallbackError: null,
  favoriteArtists: [],
  friends: [],
  sharedPlaylists: [],
  socialSubTab: 'jam',
  shareListeningActivity: readShareListeningPref(),
  friendActivities: {},
  personalTopStats: { '7d': null, '30d': null },
  minimizeToTrayOnClose: true,
  desktopTrackNotifications: false,
  releaseNotificationsEnabled: loadReleaseNotificationsState().enabled,
  releaseNotifications: loadReleaseNotificationsState().items,
  releaseNotificationsChecking: false,
  notificationsPanelOpen: false,
  activeJamCode: null,
  activeJamSession: null,
  activeJamRole: null,
  activeJamRequests: [],
  jamInviteModalOpen: false,
  wrappedModalOpen: false,
  wrappedSummary: null,
  wrappedSoundtrackTracks: [],
  wrappedSeasonActive: isWrappedSeason(),
  wrappedLocalCount: loadLocalWrappedEvents().length,

  initApp: async () => {
    ensureAudioEngineBindings();
    if (initialized) return;
    initialized = true;

    // 1. Run ALL local storage, audio init, offline catalog & local session restore in parallel
    const [
      ,
      ,
      ,
      ,
      offlineEntriesRes,
      rawRecentRes,
      migratedFlagRes,
      rawPrefsRes,
      diskPrefsRes,
      rawCachedProfileRes,
      rawCachedSharedRes,
      rpcStatusRes,
      savedAccountsRes,
      restoredAuthRes,
    ] = await Promise.allSettled([
      libraryStore.hydrate(),
      recommendationEngine.hydrate(),
      audioEngine.init(),
      hydrateOfflineCoversMemory(),
      defaultPlatformBridge.offlineStorage.listOfflineIds(),
      defaultPlatformBridge.preferencesStorage.getItem(RECENT_SEARCH_ITEMS_STORAGE_KEY),
      defaultPlatformBridge.preferencesStorage.getItem(HOME_HISTORY_MIGRATION_KEY),
      defaultPlatformBridge.preferencesStorage.getItem(USER_PREFS_STORAGE_KEY),
      typeof window !== 'undefined' && (window as any).pmusicDesktop?.readPrefsFile
        ? (window as any).pmusicDesktop.readPrefsFile()
        : Promise.resolve(null),
      defaultPlatformBridge.preferencesStorage.getItem(CACHED_PROFILE_STORAGE_KEY),
      defaultPlatformBridge.preferencesStorage.getItem(CACHED_SHARED_PLAYLISTS_KEY),
      defaultPlatformBridge.getDiscordRpcStatus?.() ?? Promise.resolve(undefined),
      syncEngine.listSavedAccounts(),
      syncEngine.restoreSession({ deferSync: true }),
    ]);

    const restoredAuth: SyncAuthState =
      restoredAuthRes.status === 'fulfilled'
        ? restoredAuthRes.value
        : { userId: null, email: null, connected: false };

    let ranV3Migration = false;
    try {
      const migrated = migratedFlagRes.status === 'fulfilled' ? migratedFlagRes.value : null;
      if (migrated !== '1') {
        ranV3Migration = true;
        await recommendationEngine.clearPlayHistory();
        await libraryStore.setPlayHistory([]);
        for (const liked of libraryStore.getLikedTracks()) {
          if (isLegacyOutdatedTrack(liked.track) || isLegacySyntheticTrackId(liked.trackId)) {
            await libraryStore.toggleLikeTrack(liked.track);
          }
        }
        for (const pl of libraryStore.getPlaylists()) {
          const cleaned = pl.tracks.filter((t) => !isLegacyOutdatedTrack(t));
          if (cleaned.length !== pl.tracks.length) {
            await libraryStore.updatePlaylist(pl.id, { tracks: cleaned });
          }
        }
        await defaultPlatformBridge.preferencesStorage.setItem(HOME_HISTORY_MIGRATION_KEY, '1');
      }
    } catch {
      // ignore storage failure
    }
    syncUserLibraryContextToEngine();

    const isMobileUa =
      typeof navigator !== 'undefined' && navigator.userAgent.toLowerCase().includes('android');
    syncEngine.upsertPeerDevice({
      device_id: isMobileUa ? 'pmusic_windows_companion' : 'pmusic_android_companion',
      device_name: isMobileUa ? 'pMusic Windows PC' : 'pMusic Android',
      platform: isMobileUa ? 'windows' : 'android',
      is_active: false,
      is_playing: false,
      track_title: 'Listo para conectar',
      updated_at: Date.now(),
    });

    const offlineEntries: OfflineAudioEntry[] =
      offlineEntriesRes.status === 'fulfilled' ? offlineEntriesRes.value : [];
    const offlineDownloads: Record<string, OfflineDownloadStatus> = {};
    for (const entry of offlineEntries) {
      offlineDownloads[entry.trackId] = 'downloaded';
    }

    let hydratedRecentItems = get().recentSearchItems;
    try {
      const rawRecent = rawRecentRes.status === 'fulfilled' ? rawRecentRes.value : null;
      if (rawRecent !== null && rawRecent !== undefined) {
        const parsed = JSON.parse(rawRecent) as unknown;
        if (Array.isArray(parsed)) {
          const cast = parsed as RecentSearchItem[];
          const cleaned = cast.filter(
            (item) => item.kind !== 'track' || !isLegacyOutdatedTrack(item.track)
          );
          hydratedRecentItems =
            cleaned.length > 0 ? cleaned : buildDefaultRecentSearchItems();
          if (ranV3Migration || cleaned.length !== cast.length) {
            persistRecentSearchItems(hydratedRecentItems);
          }
        }
      }
    } catch {
      // keep default
    }

    let hydratedPrefs: Record<string, any> | null = null;
    try {
      const rawPrefs = rawPrefsRes.status === 'fulfilled' ? rawPrefsRes.value : null;
      const diskPrefs = diskPrefsRes.status === 'fulfilled' ? diskPrefsRes.value : null;
      if (rawPrefs) {
        hydratedPrefs = JSON.parse(rawPrefs) as Record<string, any>;
      } else if (typeof diskPrefs === 'string' && diskPrefs && diskPrefs !== '{}') {
        hydratedPrefs = JSON.parse(diskPrefs) as Record<string, any>;
      }
    } catch {
      hydratedPrefs = null;
    }

    if (
      restoredAuth.connected &&
      hydratedPrefs?.ownerUserId &&
      hydratedPrefs.ownerUserId !== restoredAuth.userId
    ) {
      hydratedPrefs = null;
    }

    const cachedProfile = restoredAuth.connected
      ? parseCachedForOwner<UserProfile>(
          rawCachedProfileRes.status === 'fulfilled' ? rawCachedProfileRes.value : null,
          restoredAuth.userId
        )
      : null;
    const cachedSharedPlaylists =
      (restoredAuth.connected
        ? parseCachedForOwner<SharedPlaylistRecord[]>(
            rawCachedSharedRes.status === 'fulfilled' ? rawCachedSharedRes.value : null,
            restoredAuth.userId
          )
        : null) ?? [];
    const savedAccounts: SavedAccountSlot[] =
      savedAccountsRes.status === 'fulfilled' ? savedAccountsRes.value : [];

    const restoredFavoriteArtists: FavoriteArtistRecord[] = Array.isArray(
      hydratedPrefs?.favoriteArtists
    )
      ? (hydratedPrefs!.favoriteArtists as FavoriteArtistRecord[]).filter(
          (a) => Boolean(a?.artistId && a?.artistName)
        )
      : [];
    if (restoredFavoriteArtists.length > 0) {
      recommendationEngine.setFavoriteArtists(restoredFavoriteArtists);
    }

    const resolvedSurfaceStyle: PMusicSurfaceStyle =
      hydratedPrefs &&
      (hydratedPrefs.surfaceStyle === 'liquid-glass' ||
        hydratedPrefs.surfaceStyle === 'frosted-glass' ||
        hydratedPrefs.surfaceStyle === 'simple')
        ? hydratedPrefs.surfaceStyle
        : hydratedPrefs && typeof hydratedPrefs.liquidGlassMode === 'boolean'
          ? hydratedPrefs.liquidGlassMode
            ? 'liquid-glass'
            : 'simple'
          : hydratedPrefs && hydratedPrefs.graphicSaverMode
            ? 'simple'
            : get().surfaceStyle;

    applySurfaceStyleClasses(resolvedSurfaceStyle);
    if (typeof document !== 'undefined') {
      document.documentElement.classList.toggle(
        'pm-reduced-motion',
        Boolean(hydratedPrefs?.reducedMotionPref)
      );
    }

    if (hydratedPrefs) {
      const resolvedTheme =
        typeof hydratedPrefs.themeId === 'string'
          ? (hydratedPrefs.themeId as PMusicThemeId)
          : get().themeId;
      if (typeof hydratedPrefs.themeId === 'string') {
        applyPMusicTheme(resolvedTheme);
      }
      if (typeof hydratedPrefs.accentPreset === 'string') {
        applyAccentOverride(
          hydratedPrefs.accentPreset as PMusicAccentPresetId,
          resolvedTheme
        );
      }
      if (typeof hydratedPrefs.streamQuality === 'string') {
        currentStreamQualityPref = hydratedPrefs.streamQuality as AudioStreamQuality;
        setDataSaverMode(hydratedPrefs.streamQuality === 'low');
      }
      if (hydratedPrefs.userEq) audioEngine.setUserEq(hydratedPrefs.userEq as UserEqConfig);
      if (hydratedPrefs.safeCrossfade) {
        audioEngine.setSafeCrossfade(hydratedPrefs.safeCrossfade as SafeCrossfadeConfig);
      }
      if (hydratedPrefs.djMode) audioEngine.setDjMode(hydratedPrefs.djMode as DjModeConfig);
      if (typeof hydratedPrefs.playbackRate === 'number') {
        audioEngine.setPlaybackRate(
          hydratedPrefs.playbackRate,
          hydratedPrefs.preservesPitch !== false
        );
      }
      if (typeof hydratedPrefs.stereoBalance === 'number') {
        audioEngine.setBalance(hydratedPrefs.stereoBalance);
      }
      if (typeof hydratedPrefs.monoAudio === 'boolean') {
        audioEngine.setMonoAudio(hydratedPrefs.monoAudio);
      }
      if (typeof hydratedPrefs.volume === 'number' && !isMobileHardwareVolumeRuntime()) {
        audioEngine.setVolume(Math.max(0, Math.min(1, hydratedPrefs.volume)));
      }
    }

    if (isMobileHardwareVolumeRuntime()) {
      audioEngine.setVolume(1.0);
    }

    const rpcStatus = rpcStatusRes.status === 'fulfilled' ? rpcStatusRes.value : undefined;
    const canonicalPlaylists = libraryStore.getPlaylists().map((pl) => ({
      ...pl,
      tracks: pl.tracks.map(canonicalizeTrackArtists),
    }));
    const canonicalLiked = libraryStore.getLikedTracks().map((l) => ({
      ...l,
      track: canonicalizeTrackArtists(l.track),
    }));
    const canonicalHistory = libraryStore.getPlayHistory().map((h) => ({
      ...h,
      track: canonicalizeTrackArtists(h.track),
    }));

    // 2. Commit instant local state immediately (auth, cached profile, playlists, likes, prefs)
    set((prev) => ({
      ...(isMobileHardwareVolumeRuntime()
        ? { volume: 1.0 }
        : typeof hydratedPrefs?.volume === 'number'
          ? { volume: Math.max(0, Math.min(1, hydratedPrefs.volume)) }
          : {}),
      authState: restoredAuth,
      userProfile: cachedProfile,
      needsProfileSetup: restoredAuth.connected && !cachedProfile,
      savedAccounts,
      sharedPlaylists: cachedSharedPlaylists,
      favoriteArtists: restoredFavoriteArtists,
      playlists: canonicalPlaylists,
      likedTracks: canonicalLiked,
      playHistory: canonicalHistory,
      seedArtists: recommendationEngine.getSeedArtists(),
      affinityProfile: recommendationEngine.getAffinityProfile(),
      recentSearchItems: hydratedRecentItems,
      offlineEntries,
      offlineDownloads,
      onlineDevices: syncEngine.getOnlineDevices(),
      ...(rpcStatus ? { discordRpcStatus: rpcStatus } : {}),
      ...(hydratedPrefs
        ? {
            themeId: (hydratedPrefs.themeId as PMusicThemeId) ?? prev.themeId,
            playerBarStyle:
              hydratedPrefs.playerBarStyle === 'classic-center' ||
              hydratedPrefs.playerBarStyle === 'ambient-dock' ||
              hydratedPrefs.playerBarStyle === 'floating-island' ||
              hydratedPrefs.playerBarStyle === 'minimal-wave'
                ? hydratedPrefs.playerBarStyle
                : prev.playerBarStyle,
            accentPreset:
              (hydratedPrefs.accentPreset as PMusicAccentPresetId) ?? prev.accentPreset,
            surfaceStyle: resolvedSurfaceStyle,
            liquidGlassMode: resolvedSurfaceStyle === 'liquid-glass',
            ambientMotionEnabled: Boolean(
              hydratedPrefs.ambientMotionEnabled ?? prev.ambientMotionEnabled
            ),
            graphicSaverMode: resolvedSurfaceStyle === 'simple',
            reducedMotionPref: Boolean(hydratedPrefs.reducedMotionPref ?? prev.reducedMotionPref),
            visualizerEnabled: Boolean(hydratedPrefs.visualizerEnabled ?? prev.visualizerEnabled),
            lyricsSize: hydratedPrefs.lyricsSize ?? prev.lyricsSize,
            lyricsBlurEnabled: Boolean(hydratedPrefs.lyricsBlurEnabled ?? prev.lyricsBlurEnabled),
            lyricsStyle:
              hydratedPrefs.lyricsStyle === 'classic' ||
              hydratedPrefs.lyricsStyle === 'wordflow' ||
              hydratedPrefs.lyricsStyle === 'kinetic' ||
              hydratedPrefs.lyricsStyle === 'neon' ||
              hydratedPrefs.lyricsStyle === 'typewriter' ||
              hydratedPrefs.lyricsStyle === 'poster' ||
              hydratedPrefs.lyricsStyle === 'focus' ||
              hydratedPrefs.lyricsStyle === 'editorial'
                ? hydratedPrefs.lyricsStyle
                : prev.lyricsStyle,
            nowPlayingBackdropStyle: parseNowPlayingBackdropStyle(
              hydratedPrefs.nowPlayingBackdropStyle,
              prev.nowPlayingBackdropStyle
            ),
            alwaysShuffle: Boolean(hydratedPrefs.alwaysShuffle ?? prev.alwaysShuffle),
            skipSameAlbumCoverTransition: Boolean(
              hydratedPrefs.skipSameAlbumCoverTransition ?? prev.skipSameAlbumCoverTransition
            ),
            marqueeTextEnabled: Boolean(
              hydratedPrefs.marqueeTextEnabled ?? prev.marqueeTextEnabled
            ),
            showRemainingTime: Boolean(
              hydratedPrefs.showRemainingTime ?? prev.showRemainingTime
            ),
            repeatMode:
              hydratedPrefs.repeatMode === 'off' ||
              hydratedPrefs.repeatMode === 'all' ||
              hydratedPrefs.repeatMode === 'one'
                ? hydratedPrefs.repeatMode
                : prev.repeatMode,
            ...(typeof hydratedPrefs.sidebarCollapsed === 'boolean'
              ? { sidebarCollapsed: hydratedPrefs.sidebarCollapsed }
              : {}),
            ...(typeof hydratedPrefs.rightPanelOpen === 'boolean'
              ? { rightPanelOpen: hydratedPrefs.rightPanelOpen }
              : {}),
            ...(typeof hydratedPrefs.shuffleEnabled === 'boolean'
              ? { shuffleEnabled: hydratedPrefs.shuffleEnabled }
              : Boolean(hydratedPrefs.alwaysShuffle ?? prev.alwaysShuffle)
                ? { shuffleEnabled: true }
                : {}),
            discordRpcEnabled: Boolean(hydratedPrefs.discordRpcEnabled ?? prev.discordRpcEnabled),
            discordRpcConfig: {
              ...prev.discordRpcConfig,
              ...(hydratedPrefs.discordRpcConfig ?? {}),
              clientId:
                hydratedPrefs.discordRpcConfig?.clientId ||
                rpcStatus?.clientId ||
                prev.discordRpcConfig.clientId,
            },
            playbackRate: Number(hydratedPrefs.playbackRate ?? prev.playbackRate),
            preservesPitch: Boolean(hydratedPrefs.preservesPitch ?? prev.preservesPitch),
            audioNormalization: Boolean(
              hydratedPrefs.audioNormalization ?? prev.audioNormalization
            ),
            normalizationTarget: hydratedPrefs.normalizationTarget ?? prev.normalizationTarget,
            stereoBalance: Number(hydratedPrefs.stereoBalance ?? prev.stereoBalance),
            monoAudio: Boolean(hydratedPrefs.monoAudio ?? prev.monoAudio),
            streamQuality: hydratedPrefs.streamQuality ?? prev.streamQuality,
            autoplayEnabled: Boolean(hydratedPrefs.autoplayEnabled ?? prev.autoplayEnabled),
            safeCrossfade: hydratedPrefs.safeCrossfade ?? prev.safeCrossfade,
            userEq: hydratedPrefs.userEq ?? prev.userEq,
            djMode: hydratedPrefs.djMode ?? prev.djMode,
            dismissedPlaylistRecs:
              hydratedPrefs.dismissedPlaylistRecs &&
              typeof hydratedPrefs.dismissedPlaylistRecs === 'object'
                ? (hydratedPrefs.dismissedPlaylistRecs as Record<string, string[]>)
                : prev.dismissedPlaylistRecs,
            playlistAppearances:
              hydratedPrefs.playlistAppearances &&
              typeof hydratedPrefs.playlistAppearances === 'object'
                ? (hydratedPrefs.playlistAppearances as Record<string, PlaylistAppearanceEntry>)
                : prev.playlistAppearances,
          }
        : {}),
    }));

    if (!prefsUnloadBound) {
      prefsUnloadBound = true;
      const pullCloudDeltaOnFocus = () => {
        if (!get().authState.connected) return;
        if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
        const now = Date.now();
        if (now - cloudFocusSyncAt < 8000) return;
        cloudFocusSyncAt = now;
        void Promise.all([
          syncEngine.syncNow(),
          syncEngine.loadAccountPreferences?.(),
        ]).then(([, cloudPrefs]) => {
          set((prev) => ({
            playlists: libraryStore.getPlaylists().map((pl) => ({
              ...pl,
              tracks: pl.tracks.map(canonicalizeTrackArtists),
            })),
            likedTracks: libraryStore.getLikedTracks().map((l) => ({
              ...l,
              track: canonicalizeTrackArtists(l.track),
            })),
            playHistory: libraryStore.getPlayHistory().map((h) => ({
              ...h,
              track: canonicalizeTrackArtists(h.track),
            })),
            ...(cloudPrefs?.playlistAppearances &&
            typeof cloudPrefs.playlistAppearances === 'object' &&
            Number(cloudPrefs.savedAt ?? 0) >= lastLocalPrefsSavedAt
              ? {
                  playlistAppearances: cloudPrefs.playlistAppearances as Record<
                    string,
                    PlaylistAppearanceEntry
                  >,
                }
              : {}),
          }));
        });
      };
      if (typeof window !== 'undefined') {
        window.addEventListener('beforeunload', () => flushCloudPrefsNow());
        window.addEventListener('pagehide', () => flushCloudPrefsNow());
        window.addEventListener('focus', pullCloudDeltaOnFocus);
      }
      if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', () => {
          if (document.hidden) {
            flushCloudPrefsNow();
          } else {
            pullCloudDeltaOnFocus();
          }
        });
      }
    }

    // 3. Fire single non-blocking Realtime connection
    void syncEngine.connectRealtime().catch(() => {});

    const canonicalizeShelves = (rawShelves: HomeEditorialShelf[]) =>
      rawShelves.map((sh) => ({
        ...sh,
        anchorArtist:
          sh.anchorArtist && /cruz\s*cafun[eé]/i.test(sh.anchorArtist)
            ? 'Cruzzi'
            : sh.anchorArtist,
        tracks: sh.tracks?.map(canonicalizeTrackArtists),
        albums: sh.albums?.map((al) => ({
          ...al,
          artists: al.artists.map((ar) => canonicalizeArtistRefName(ar.id, ar.name)),
        })),
      }));

    const commitShelvesAndSeedPlayer = async (builtShelves: HomeEditorialShelf[]) => {
      const canonicalShelves = canonicalizeShelves(builtShelves);
      const allRealTracks = Array.from(
        new Map(canonicalShelves.flatMap((s) => s.tracks ?? []).map((t) => [t.id, t])).values()
      );
      const trackSample = [...FALLBACK_TRACKS, ...allRealTracks].slice(0, 24);
      const analyzedPairs = await Promise.all(
        trackSample.map(
          async (t) => [t.id, await djPlanner.analyzeTrack(t.id, null, t.durationSec)] as const
        )
      );
      const analyses: Record<string, TrackAnalysis> = {};
      for (const [id, ana] of analyzedPairs) {
        analyses[id] = ana;
      }
      const listenTracks = canonicalShelves.find((s) => s.kind === 'listen_again')?.tracks ?? [];
      const baseQueue = (listenTracks.length > 0 ? listenTracks : allRealTracks).slice(0, 10);
      const firstReal = baseQueue[0] ?? allRealTracks[0];
      const qIds = new Set(baseQueue.map((t) => t.id));
      const initialRec = allRealTracks.filter((t) => !qIds.has(t.id)).slice(0, 10);
      const keepShuffle = get().alwaysShuffle || get().shuffleEnabled;
      const realQueue =
        firstReal && keepShuffle && baseQueue.length > 1
          ? [firstReal, ...fisherYatesShuffle(baseQueue.filter((t) => t.id !== firstReal.id))]
          : baseQueue;

      set((prev) => ({
        homeShelves: canonicalShelves.some((s) => (s.tracks?.length ?? 0) > 0)
          ? canonicalShelves
          : prev.homeShelves,
        homeFeedReady: true,
        trackAnalyses: { ...prev.trackAnalyses, ...analyses },
        ...(firstReal && !prev.isPlaying
          ? {
              currentTrack: firstReal,
              queue: realQueue,
              ...(keepShuffle ? { unshuffledQueue: baseQueue, shuffleEnabled: true } : {}),
              recommendedQueue: initialRec,
              queueIndex: 0,
              durationSec: firstReal.durationSec,
              positionSec: 0,
            }
          : {}),
      }));
      if (isLiveRuntime()) {
        void preloadTopHomeCovers(canonicalShelves);
      }
    };

    const ownerKey = restoredAuth.connected ? restoredAuth.userId : null;
    activeEditorialMixesState = readSyncedEditorialMixes(ownerKey);
    const cachedHomeEntry = readCachedHomeShelves(ownerKey);
    const cachedHomeRaw = cachedHomeEntry?.shelves ?? null;
    const cachedHome = cachedHomeRaw
      ? applySyncedMixesToShelves(cachedHomeRaw, activeEditorialMixesState)
      : null;
    const todayLocalIso = getLocalDayKey();
    const cachedDayIso = cachedHomeEntry?.savedAt ? getLocalDayKey(cachedHomeEntry.savedAt) : '';
    const hasWarmHome = Boolean(cachedHome && cachedHome.length > 0);
    const isSameLocalDay = cachedDayIso === todayLocalIso;
    const cachedMixesHealthy = Boolean(cachedHome && hasHealthyDailyMixes(cachedHome));
    const hasFreshHomeCache = Boolean(
      cachedHomeEntry &&
        cachedHomeEntry.shelves.length >= 2 &&
        Date.now() - cachedHomeEntry.savedAt < HOME_SHELVES_CACHE_TTL_MS &&
        isSameLocalDay &&
        cachedMixesHealthy
    );
    const hasWarmAccount =
      !restoredAuth.connected ||
      (Boolean(cachedProfile) &&
        (canonicalPlaylists.length > 0 || cachedSharedPlaylists.length > 0));
    const localSavedAt = Number(hydratedPrefs?.savedAt ?? 0);
    const isOnline = typeof navigator === 'undefined' || navigator.onLine !== false;

    if (isOnline && isLiveRuntime() && (offlineEntries.length > 0 || canonicalPlaylists.length > 0)) {
      const downloadedSet = new Set(offlineEntries.map((e) => e.trackId));
      const knownTracks = [
        ...canonicalLiked.map((l) => l.track),
        ...canonicalPlaylists.flatMap((pl) => pl.tracks),
        ...canonicalHistory.map((h) => h.track),
      ];
      const coverBackfill = new Map<string, string>();
      // Downloaded tracks first, then user library tracks up to 100
      for (const tr of knownTracks) {
        if (!tr?.id || !downloadedSet.has(tr.id)) continue;
        const cu = tr.thumbnailHighUrl ?? tr.thumbnailUrl;
        if (cu && !coverBackfill.has(tr.id)) coverBackfill.set(tr.id, cu);
      }
      for (const tr of knownTracks) {
        if (coverBackfill.size >= 100) break;
        if (!tr?.id || coverBackfill.has(tr.id)) continue;
        const cu = tr.thumbnailHighUrl ?? tr.thumbnailUrl;
        if (cu) coverBackfill.set(tr.id, cu);
      }
      if (coverBackfill.size > 0) {
        void (async () => {
          for (const [tid, cu] of coverBackfill) {
            await saveOfflineCover(tid, cu).catch(() => false);
          }
        })();
      }
    }

    const runCloudAndShelfSync = async () => {
      const shelfEpoch = ++homeShelvesBuildEpoch;
      let mergedPrefsFound = false;
      if (restoredAuth.connected && isOnline) {
        await Promise.allSettled([
          syncEngine.syncNow().then(() => {
            syncUserLibraryContextToEngine();
            set({
              playlists: libraryStore.getPlaylists().map((pl) => ({
                ...pl,
                tracks: pl.tracks.map(canonicalizeTrackArtists),
              })),
              likedTracks: libraryStore.getLikedTracks().map((l) => ({
                ...l,
                track: canonicalizeTrackArtists(l.track),
              })),
              playHistory: libraryStore.getPlayHistory().map((h) => ({
                ...h,
                track: canonicalizeTrackArtists(h.track),
              })),
            });
            syncAndroidAutoLibrarySnapshot();
          }),
          syncEngine.getProfile?.().then(async (prof) => {
            if (prof) {
              set({ userProfile: prof, needsProfileSetup: false });
              void writeCachedProfile(prof.userId, prof);
              const slots = await syncEngine.rememberCurrentAccountSession({
                username: prof.username,
                displayName: prof.displayName,
                avatarUrl: prof.avatarUrl,
              });
              set({ savedAccounts: slots });
            } else {
              set({ needsProfileSetup: !cachedProfile });
            }
          }),
          syncEngine.loadAccountPreferences?.().then(async (cloudPrefs) => {
            if (cloudPrefs) {
              mergedPrefsFound = true;
              const cloudSavedAt = Number(cloudPrefs.savedAt ?? 0);
              if (!hydratedPrefs || cloudSavedAt >= localSavedAt) {
                applyPreferencesPayload(cloudPrefs);
                void defaultPlatformBridge.preferencesStorage
                  .setItem(USER_PREFS_STORAGE_KEY, JSON.stringify(cloudPrefs))
                  .catch(() => {});
              } else {
                persistPrefsFromStore(true);
              }
              await hydrateAndMergeCloudTaste(cloudPrefs, { skipShelfRebuild: true });
            }
          }),
          get().hydrateSocialAndSubscribe(),
          restoredFavoriteArtists.length === 0
            ? syncEngine.listFavoriteArtists?.().then((favs) => {
                if (favs && favs.length > 0) {
                  recommendationEngine.setFavoriteArtists(favs);
                  set({ favoriteArtists: favs });
                }
              })
            : Promise.resolve(),
        ]);

        if (!mergedPrefsFound) {
          await hydrateAndMergeCloudTaste(null, { skipShelfRebuild: true });
          persistPrefsFromStore(true);
        }
      }

      if (!isOnline && hasWarmHome) {
        await commitShelvesAndSeedPlayer(cachedHome!);
        return;
      }

      if (hasWarmHome && cachedHome) {
        const syncedCachedHome = applySyncedMixesToShelves(cachedHome, activeEditorialMixesState);
        await commitShelvesAndSeedPlayer(syncedCachedHome);
        const syncedNow = activeEditorialMixesState;
        const needsDescubreAlgoUpgrade =
          !syncedNow || (syncedNow.descubre.algoVersion ?? 1) < DESCUBRE_ALGO_VERSION;
        const isLockedDailyHealthy = Boolean(
          syncedNow &&
            !needsDescubreAlgoUpgrade &&
            syncedNow.dailyMix?.dayKey === todayLocalIso &&
            syncedNow.dailyMix.tracks.length >= 25 &&
            syncedNow.dailyDiscover?.dayKey === todayLocalIso &&
            syncedNow.dailyDiscover.tracks.length >= 25 &&
            syncedNow.descubre.tracks.length >= 35 &&
            Date.now() - syncedNow.descubre.lastScanAt < DESCUBRE_RESCAN_INTERVAL_MS
        );
        if (
          isLockedDailyHealthy ||
          (!needsDescubreAlgoUpgrade && isSameLocalDay && hasHealthyDailyMixes(syncedCachedHome))
        ) {
          return;
        }
        if (isOnline && isLiveRuntime()) {
          // New 24h day, incomplete pool (<35), or >6h incremental radar refresh: protect & evolve cleanly
          void recommendationEngine
            .buildHomeShelves()
            .then((fresh) => {
              const protectedShelves = mergeProtectedEditorialShelves(
                syncedCachedHome,
                canonicalizeShelves(fresh)
              );
              const syncedShelves = syncEditorialMixesFromShelves(protectedShelves, ownerKey, {
                markDescubreScan: true,
              });
              saveCachedHomeShelves(syncedShelves, ownerKey);
              set({ homeShelves: syncedShelves, homeFeedReady: true });
              if (get().authState.connected) persistPrefsFromStore();
            })
            .catch(() => {});
        }
        return;
      }

      const freshShelves = await recommendationEngine
        .buildHomeShelves()
        .then((built) => {
          const protectedShelves = mergeProtectedEditorialShelves(
            cachedHome,
            canonicalizeShelves(built)
          );
          const syncedShelves = syncEditorialMixesFromShelves(protectedShelves, ownerKey, {
            markDescubreScan: true,
          });
          saveCachedHomeShelves(syncedShelves, ownerKey);
          if (get().authState.connected) persistPrefsFromStore();
          return syncedShelves;
        })
        .catch(() => cachedHome ?? get().homeShelves);
      if (shelfEpoch === homeShelvesBuildEpoch) {
        await commitShelvesAndSeedPlayer(freshShelves);
      }
    };

    const syncWorkPromise = runCloudAndShelfSync();
    if (isLiveRuntime() && isOnline) {
      const budgetMs = hasWarmAccount && hasFreshHomeCache ? 900 : 5200;
      await Promise.race([
        syncWorkPromise,
        new Promise<void>((resolve) => setTimeout(resolve, budgetMs)),
      ]);
      void syncWorkPromise.then(() => {
        if (!get().homeFeedReady) {
          set({ homeFeedReady: true });
        }
      });
    } else {
      await syncWorkPromise;
    }

    if (isLiveRuntime() && !get().searchQuery && isOnline) {
      const firstFav = get().favoriteArtists[0]?.artistName;
      const firstLibArtist = libraryStore.getPlaylists()[0]?.tracks[0]?.artists[0]?.name;
      const seedQ =
        firstFav || firstLibArtist || recommendationEngine.getAffinityProfile()[0]?.artistName || 'Cruzzi';
      void musicProvider
        .search(seedQ, 'all')
        .then((bundle) => {
          if (!get().searchQuery && bundle.songs.length > 0) {
            const reranked = recommendationEngine.rerankTracks(bundle.songs);
            set({
              searchResults: { ...bundle, songs: reranked },
              bestResult: recommendationEngine.selectBestResult(seedQ, {
                ...bundle,
                songs: reranked,
              }),
            });
          }
        })
        .catch(() => {});
    }

    applyAmbientPaletteForTrack(get().currentTrack);
    void get().loadLyricsForTrack(get().currentTrack);
    set((prev) => ({
      appReady: true,
      homeFeedReady: prev.homeFeedReady || prev.homeShelves.length > 0 || !isOnline,
    }));
    syncAndroidAutoLibrarySnapshot();
    if (isLiveRuntime() && isOnline) {
      void get().refreshExploreDiscovery();
      void get().replenishRecommendedQueue();
    }
    if (get().djMode.enabled) {
      void recomputeActiveDjPlan();
    }

    // Expose native car/media callbacks for Android Auto, CarPlay & OS voice search
    if (typeof window !== 'undefined') {
      (window as any).__pmusicSetCarMode = (active: boolean) => {
        get().setCarModeOpen(Boolean(active));
      };
      (window as any).__pmusicPlayFromSearch = (q: string) => {
        void get().playFromVoiceQuery(q);
      };
      (window as any).__pmusicPlayFromMediaId = (mediaId: string) => {
        if (!mediaId) return;
        const stCur = get();
        if (mediaId.startsWith('playlist:')) {
          const plId = mediaId.slice('playlist:'.length);
          const pl = stCur.playlists.find((p) => p.id === plId);
          if (pl && pl.tracks[0]) {
            void stCur.playTrack(pl.tracks[0], pl.tracks);
          }
          return;
        }
        const trackId = mediaId.startsWith('track:') ? mediaId.slice('track:'.length) : mediaId;
        const pools: Track[] = [
          ...stCur.queue,
          ...stCur.likedTracks.map((l) => l.track),
          ...stCur.playHistory.map((h) => h.track),
          ...stCur.homeShelves.flatMap((s) => s.tracks ?? []),
          ...stCur.playlists.flatMap((p) => p.tracks),
        ];
        const found = pools.find((t) => t.id === trackId);
        if (found) {
          const matchingPl = stCur.playlists.find((p) => p.tracks.some((t) => t.id === trackId));
          void stCur.playTrack(
            found,
            matchingPl ? matchingPl.tracks : stCur.homeShelves[0]?.tracks ?? pools.slice(0, 15)
          );
        }
      };
    }

    // Check initial URL query for web OAuth redirect (native listeners stay singleton at module scope)
    if (typeof window !== 'undefined') {
      const href = window.location?.href ?? '';
      if (href.includes('code=') || href.includes('access_token=')) {
        const dispatchOnce = (window as any).__pmusicHandleAuthCallback;
        if (typeof dispatchOnce === 'function') {
          dispatchOnce(href);
        } else {
          void get().handleAuthCallbackUrl(href);
        }
      }
    }

    // Show first-launch onboarding if guest (session already restored above)
    if (!restoredAuth.connected) {
      const isTestEnv =
        Boolean((import.meta as any).vitest) ||
        (import.meta as any).env?.MODE === 'test';
      let dismissed = false;
      try {
        dismissed =
          typeof localStorage !== 'undefined' &&
          localStorage.getItem('pmusic.onboarding.dismissed') === '1';
      } catch {
        dismissed = false;
      }
      if (!isTestEnv && !dismissed) {
        set({ authOnboardingOpen: true });
      }
    }

    if (isElectronDesktopRuntime()) {
      void getDesktopTrayPrefs()
        .then((prefs) => {
          if (prefs) {
            set({
              minimizeToTrayOnClose: prefs.minimizeToTrayOnClose,
              desktopTrackNotifications: prefs.notifyOnTrackChange,
            });
          }
        })
        .catch(() => {});
    }

    const isTestEnvRel =
      Boolean((import.meta as any).vitest) ||
      (import.meta as any).env?.MODE === 'test';
    if (!isTestEnvRel && typeof window !== 'undefined') {
      window.setTimeout(() => {
        void get().checkNewArtistReleases(false);
      }, 6000);
      window.setInterval(() => {
        if (typeof document !== 'undefined' && document.hidden) return;
        void get().checkNewArtistReleases(false);
      }, 60 * 60_000);
    }
  },

  setActiveTab: (tab) => {
    set({
      activeTab: tab,
      activeDetailView: null,
      detailViewHistory: [],
      spotlightOpen: false,
    });
    if (tab === 'Explorar' && get().exploreSimilarTracks.length === 0) {
      void get().refreshExploreDiscovery();
    }
  },
  setSidebarCollapsed: (collapsed) => {
    set({ sidebarCollapsed: collapsed });
    persistPrefsFromStore();
  },
  setRightPanelOpen: (open) => {
    set({ rightPanelOpen: open });
    persistPrefsFromStore();
  },
  setNowPlayingOpen: (open) => set({ nowPlayingOpen: open }),
  setNowPlayingTab: (tab) => set({ nowPlayingTab: tab }),
  setEqSheetOpen: (open) =>
    set({
      eqSheetOpen: open,
      djPopoverOpen: false,
      ...(open ? { audioPanelTab: 'eq' as const, devicesSheetOpen: false } : {}),
    }),
  setDjPopoverOpen: (open) =>
    set({
      djPopoverOpen: open,
      eqSheetOpen: false,
      ...(open ? { audioPanelTab: 'dj' as const, devicesSheetOpen: false } : {}),
    }),
  setAudioPanelTab: (tab) =>
    set((st) => ({
      audioPanelTab: tab,
      ...(st.eqSheetOpen || st.djPopoverOpen
        ? { eqSheetOpen: tab !== 'dj', djPopoverOpen: tab === 'dj', devicesSheetOpen: false }
        : {}),
    })),
  setCarModeOpen: (open) => set({ carModeOpen: open }),
  setAppHidden: (hidden) => {
    set({ isAppHidden: hidden });
    if (typeof document !== 'undefined') {
      document.documentElement.classList.toggle('pm-app-hidden', hidden);
    }
    if (hidden) {
      trimBackdropMemoryCaches();
    } else {
      audioEngine.recoverAfterAppResume();
      const eng = audioEngine.getState();
      const stNow = get();
      if (
        !eng.isTransitioning &&
        (stNow.outgoingTransitionTrack || stNow.incomingTransitionTrack || stNow.isTransitioning)
      ) {
        set({
          isTransitioning: false,
          outgoingTransitionTrack: null,
          incomingTransitionTrack: null,
          transitionProgress01: 0,
        });
      }
      checkLivePlaybackTriggers(eng);
      applyAmbientPaletteFromCover(get().currentTrack, 0);
    }
  },
  playFromVoiceQuery: async (query) => {
    const clean = query.trim();
    if (!clean) {
      const first =
        get().homeShelves[0]?.tracks?.[0] ??
        get().likedTracks[0]?.track ??
        get().currentTrack;
      if (first) await get().playTrack(first);
      return;
    }
    try {
      const bundle = await musicProvider.search(clean, 'all');
      const hit = bundle.songs[0] ?? get().homeShelves[0]?.tracks?.[0];
      if (hit) {
        await get().playTrack(hit, bundle.songs.length > 0 ? bundle.songs.slice(0, 20) : [hit]);
        get().showToast(`Reproduciendo: ${hit.title}`);
        return;
      }
    } catch {
      // fall back to local search across queue/shelves
    }
    const localPool = [
      ...get().playlists.flatMap((p) => p.tracks),
      ...get().likedTracks.map((l) => l.track),
      ...get().homeShelves.flatMap((s) => s.tracks ?? []),
    ];
    const qLow = clean.toLowerCase();
    const localHit = localPool.find(
      (t) =>
        t.title.toLowerCase().includes(qLow) ||
        t.artists.some((a) => a.name.toLowerCase().includes(qLow))
    );
    if (localHit) {
      await get().playTrack(localHit, localPool.slice(0, 15));
      get().showToast(`Reproduciendo: ${localHit.title}`);
    } else {
      get().showToast(`Sin resultados para "${clean}"`);
    }
  },
  setDevicesSheetOpen: (open) =>
    set({
      devicesSheetOpen: open,
      ...(open ? { eqSheetOpen: false, djPopoverOpen: false } : {}),
    }),
  fetchTrackCredits: async (track) => {
    try {
      const fn = (musicProvider as {
        getTrackCredits?: (
          trackId: string,
          hint?: { title?: string; artist?: string }
        ) => Promise<TrackCredits | null>;
      }).getTrackCredits;
      if (typeof fn === 'function') {
        return await fn.call(musicProvider, track.id, {
          title: track.title,
          artist: track.artists.map((a) => a.name).join(', '),
        });
      }
    } catch {
      // ignore fetch error and fall back in modal
    }
    return null;
  },
  setImportModalOpen: (open) => set({ importModalOpen: open, importError: null }),
  setSettingsOpen: (open) =>
    set((prev) => ({
      settingsOpen: open,
      settingsInitialCategory: open ? prev.settingsInitialCategory : null,
      ...(open
        ? {}
        : {
            mobileHubOpen: prev.settingsReturnToMobileHub ? true : prev.mobileHubOpen,
            settingsReturnToMobileHub: false,
          }),
    })),
  setMobileHubOpen: (open) => set({ mobileHubOpen: open }),
  openSettingsCategory: (cat) =>
    set((prev) => ({
      settingsReturnToMobileHub: prev.mobileHubOpen,
      settingsInitialCategory: cat,
      settingsOpen: true,
    })),
  clearPlayHistory: async () => {
    await recommendationEngine.clearPlayHistory();
    await libraryStore.setPlayHistory([]);
    set({ playHistory: [] });
    get().showToast('Historial de reproducción borrado');
  },
  setSpotlightOpen: (open) => set({ spotlightOpen: open }),

  openArtistDetail: async (artistId, hint) => {
    const canonHint = canonicalizeArtistRefName(artistId, hint?.name ?? '');
    const rawTrim = artistId.trim();
    const cleanId =
      canonHint.id && (rawTrim === '10125390' || !/^\d+$/.test(rawTrim) || canonHint.name === 'Cruzzi')
        ? canonHint.id
        : rawTrim;
    const effectiveHintName = canonHint.name || hint?.name;
    const normKey = `artist:${cleanId.toLowerCase()}`;
    const nameKey = effectiveHintName ? `artist:${effectiveHintName.trim().toLowerCase()}` : null;
    const memCached =
      readClientCache(artistClientCache, normKey) ??
      (nameKey ? readClientCache(artistClientCache, nameKey) : null);
    const persistedCached = !memCached
      ? readPersistedArtistCache(normKey) ?? (nameKey ? readPersistedArtistCache(nameKey) : null)
      : null;

    const prev = get().activeDetailView;
    const seq = ++detailRequestSeq;
    const transitionKey = cleanId || effectiveHintName || 'artist';

    const saveArtistBoth = (detail: ArtistDetail) => {
      writeClientCache(artistClientCache, normKey, detail);
      writeClientCache(artistClientCache, `artist:${detail.artist.id.toLowerCase()}`, detail);
      writeClientCache(artistClientCache, `artist:${detail.artist.name.trim().toLowerCase()}`, detail);
      writePersistedArtistCache(normKey, detail);
      writePersistedArtistCache(`artist:${detail.artist.id.toLowerCase()}`, detail);
      writePersistedArtistCache(`artist:${detail.artist.name.trim().toLowerCase()}`, detail);
    };

    const isFallbackArtist = (detail: ArtistDetail) =>
      Boolean(detail.description?.includes('Escena urbana y tendencias en pMusic')) ||
      (detail.topSongs.length > 0 &&
        detail.topSongs.length <= 5 &&
        detail.topSongs.every((t) => !t.id.startsWith('dz:')));

    if (memCached) {
      set((s) => ({
        detailViewHistory:
          prev && !(prev.kind === 'artist' && prev.data.artist.id === memCached.artist.id)
            ? [...s.detailViewHistory, prev].slice(-12)
            : s.detailViewHistory,
        activeDetailView: { kind: 'artist', data: memCached, isLoading: false, transitionKey },
        spotlightOpen: false,
        nowPlayingOpen: false,
      }));
      return;
    }

    if (persistedCached) {
      const cachedData = persistedCached.data;
      writeClientCache(artistClientCache, normKey, cachedData);
      set((s) => ({
        detailViewHistory:
          prev && !(prev.kind === 'artist' && prev.data.artist.id === cachedData.artist.id)
            ? [...s.detailViewHistory, prev].slice(-12)
            : s.detailViewHistory,
        activeDetailView: { kind: 'artist', data: cachedData, isLoading: false, transitionKey },
        spotlightOpen: false,
        nowPlayingOpen: false,
      }));
      if (Date.now() - persistedCached.at >= DETAIL_STALE_REFRESH_MS && !get().isOfflineNetwork) {
        void musicProvider
          .getArtist(cleanId, undefined, effectiveHintName ? { name: effectiveHintName } : undefined)
          .then((freshData) => {
            if (!isFallbackArtist(freshData)) {
              saveArtistBoth(freshData);
              if (seq === detailRequestSeq) {
                set((s) =>
                  s.activeDetailView?.kind === 'artist'
                    ? {
                        activeDetailView: {
                          kind: 'artist',
                          data: freshData,
                          isLoading: false,
                          transitionKey: s.activeDetailView.transitionKey ?? transitionKey,
                        },
                      }
                    : {}
                );
              }
            }
          })
          .catch(() => {});
      }
      return;
    }

    const displayName =
      effectiveHintName?.trim() ||
      (!/^\d+$/.test(cleanId) && !cleanId.startsWith('UC') ? cleanId : 'Cargando artista…');
    const stNow = get();
    const targetNameNorm = (effectiveHintName ?? displayName).trim().toLowerCase();
    const inMemoryMatchesMap = new Map<string, Track>();
    const candidatePools: Track[] = [
      ...stNow.likedTracks.map((l) => l.track),
      ...stNow.playlists.flatMap((p) => p.tracks),
      ...stNow.playHistory.map((h) => h.track),
      ...stNow.homeShelves.flatMap((sh) => [
        ...(sh.tracks ?? []),
        ...(sh.mixes ?? []).flatMap((m) => m.tracks ?? []),
      ]),
      ...stNow.queue,
    ];
    for (const tr of candidatePools) {
      if (!tr?.id || inMemoryMatchesMap.has(tr.id)) continue;
      const matchesArtist = tr.artists.some(
        (ar) =>
          (ar.id && ar.id === cleanId) ||
          (targetNameNorm && ar.name.trim().toLowerCase() === targetNameNorm)
      );
      if (matchesArtist) inMemoryMatchesMap.set(tr.id, tr);
      if (inMemoryMatchesMap.size >= 10) break;
    }
    const optimisticTopSongs = Array.from(inMemoryMatchesMap.values());
    const knownThumb =
      hint?.thumbnailUrl?.trim() ||
      stNow.favoriteArtists.find(
        (fa) =>
          fa.artistId === cleanId ||
          (targetNameNorm && fa.artistName.trim().toLowerCase() === targetNameNorm)
      )?.thumbnailUrl ||
      stNow.searchResults.artists.find(
        (ar) =>
          ar.id === cleanId ||
          (targetNameNorm && ar.name.trim().toLowerCase() === targetNameNorm)
      )?.thumbnailUrl ||
      optimisticTopSongs[0]?.thumbnailUrl ||
      '';

    const optimisticData: ArtistDetail = {
      artist: {
        id: cleanId,
        name: displayName,
        thumbnailUrl: knownThumb,
      },
      bannerUrl: knownThumb || undefined,
      topSongs: optimisticTopSongs,
      albums: [],
      singles: [],
      relatedArtists: [],
    };

    set((s) => ({
      detailViewHistory:
        prev && !(prev.kind === 'artist' && prev.data.artist.id === cleanId)
          ? [...s.detailViewHistory, prev].slice(-12)
          : s.detailViewHistory,
      activeDetailView: {
        kind: 'artist',
        data: optimisticData,
        isLoading: true,
        transitionKey,
      },
      spotlightOpen: false,
      nowPlayingOpen: false,
    }));

    const data = await musicProvider.getArtist(
      cleanId,
      undefined,
      effectiveHintName ? { name: effectiveHintName } : undefined
    );
    if (!isFallbackArtist(data)) {
      saveArtistBoth(data);
      const ownerForPassive = get().authState.connected ? get().authState.userId : null;
      feedPassiveDescubreTracks([...(data.appearances ?? []), ...data.topSongs], ownerForPassive);
    }

    if (seq !== detailRequestSeq) return;
    set((s) => {
      if (s.activeDetailView?.kind !== 'artist') return {};
      return {
        activeDetailView: {
          kind: 'artist',
          data,
          isLoading: false,
          transitionKey: s.activeDetailView.transitionKey ?? transitionKey,
        },
      };
    });
  },
  prefetchArtistDetail: (artistId, hint) => {
    if (get().isOfflineNetwork) return;
    const canonHint = canonicalizeArtistRefName(artistId, hint?.name ?? '');
    const rawTrim = artistId.trim();
    const cleanId =
      canonHint.id && (rawTrim === '10125390' || !/^\d+$/.test(rawTrim) || canonHint.name === 'Cruzzi')
        ? canonHint.id
        : rawTrim;
    if (!cleanId) return;
    const effectiveHintName = canonHint.name || hint?.name;
    const normKey = `artist:${cleanId.toLowerCase()}`;
    const nameKey = effectiveHintName ? `artist:${effectiveHintName.trim().toLowerCase()}` : null;
    if (readClientCache(artistClientCache, normKey) || (nameKey && readClientCache(artistClientCache, nameKey))) {
      return;
    }
    const persisted =
      readPersistedArtistCache(normKey) ?? (nameKey ? readPersistedArtistCache(nameKey) : null);
    if (persisted && Date.now() - persisted.at < DETAIL_STALE_REFRESH_MS) {
      return;
    }
    if (inFlightArtistPrefetch.has(normKey)) return;
    inFlightArtistPrefetch.add(normKey);
    void musicProvider
      .getArtist(cleanId, undefined, effectiveHintName ? { name: effectiveHintName } : undefined)
      .then((data) => {
        const isFallback =
          Boolean(data.description?.includes('Escena urbana y tendencias en pMusic')) ||
          (data.topSongs.length > 0 &&
            data.topSongs.length <= 5 &&
            data.topSongs.every((t) => !t.id.startsWith('dz:')));
        if (isFallback) return;
        writeClientCache(artistClientCache, normKey, data);
        writeClientCache(artistClientCache, `artist:${data.artist.id.toLowerCase()}`, data);
        writeClientCache(artistClientCache, `artist:${data.artist.name.trim().toLowerCase()}`, data);
        writePersistedArtistCache(normKey, data);
        writePersistedArtistCache(`artist:${data.artist.id.toLowerCase()}`, data);
        writePersistedArtistCache(`artist:${data.artist.name.trim().toLowerCase()}`, data);
        const heroUrl = optimizeArtworkUrl(data.bannerUrl ?? data.artist.thumbnailUrl, 'banner');
        if (heroUrl && typeof Image !== 'undefined') {
          const pre = new Image();
          pre.decoding = 'async';
          pre.src = heroUrl;
        }
      })
      .catch(() => {})
      .finally(() => {
        inFlightArtistPrefetch.delete(normKey);
      });
  },
  openAlbumDetail: async (albumId, hint) => {
    const cleanId = albumId.trim();
    const normKey = `album:${cleanId.toLowerCase()}`;
    const cached = readClientCache(albumClientCache, normKey) ?? readPersistedAlbumCache(normKey)?.data ?? null;
    const prev = get().activeDetailView;
    const seq = ++detailRequestSeq;
    const transitionKey = cleanId || hint?.title || 'album';

    if (cached) {
      writeClientCache(albumClientCache, normKey, cached);
      set((s) => ({
        detailViewHistory:
          prev && !(prev.kind === 'album' && prev.data.album.id === cached.album.id)
            ? [...s.detailViewHistory, prev].slice(-12)
            : s.detailViewHistory,
        activeDetailView: { kind: 'album', data: cached, isLoading: false, transitionKey },
        spotlightOpen: false,
        nowPlayingOpen: false,
      }));
      return;
    }

    const optimisticAlbum: AlbumDetail = {
      album: {
        id: cleanId,
        title: hint?.title?.trim() || 'Cargando álbum…',
        artists: hint?.artist ? [{ name: hint.artist }] : [],
        thumbnailUrl: hint?.thumbnailUrl ?? '',
      },
      tracks: [],
    };
    set((s) => ({
      detailViewHistory:
        prev && !(prev.kind === 'album' && prev.data.album.id === cleanId)
          ? [...s.detailViewHistory, prev].slice(-12)
          : s.detailViewHistory,
      activeDetailView: {
        kind: 'album',
        data: optimisticAlbum,
        isLoading: true,
        transitionKey,
      },
      spotlightOpen: false,
      nowPlayingOpen: false,
    }));

    const data = await musicProvider.getAlbum(albumId, undefined, hint);
    writeClientCache(albumClientCache, normKey, data);
    writePersistedAlbumCache(normKey, data);
    if (seq !== detailRequestSeq) return;
    set((s) => {
      if (s.activeDetailView?.kind !== 'album') return {};
      return {
        activeDetailView: {
          kind: 'album',
          data,
          isLoading: false,
          transitionKey: s.activeDetailView.transitionKey ?? transitionKey,
        },
      };
    });
  },
  openPlaylistDetail: async (playlistId) => {
    const prev = get().activeDetailView;
    const data = await musicProvider.getPlaylist(playlistId);
    set((s) => ({
      detailViewHistory:
        prev && !(prev.kind === 'playlist' && prev.data.playlist.id === data.playlist.id)
          ? [...s.detailViewHistory, prev].slice(-12)
          : s.detailViewHistory,
      activeDetailView: { kind: 'playlist', data },
      spotlightOpen: false,
      nowPlayingOpen: false,
    }));
  },
  openLocalPlaylistDetail: (playlistId) => {
    const prev = get().activeDetailView;
    const targetPl = get().playlists.find((p) => p.id === playlistId);
    if (targetPl) {
      const singleArtistTracks = targetPl.tracks
        .filter((t) => t.artists.length <= 1 && t.id.startsWith('dz:'))
        .slice(0, 8);
      for (const stTrack of singleArtistTracks) {
        void hydrateTrackContributorsIfNeeded(stTrack);
      }
    }
    set((s) => ({
      detailViewHistory:
        prev && !(prev.kind === 'local_playlist' && prev.playlistId === playlistId)
          ? [...s.detailViewHistory, prev].slice(-12)
          : s.detailViewHistory,
      activeDetailView: { kind: 'local_playlist', playlistId },
      spotlightOpen: false,
      nowPlayingOpen: false,
    }));
  },
  openSharedPlaylistDetail: (sharedId) => {
    const prev = get().activeDetailView;
    set((s) => ({
      detailViewHistory:
        prev && !(prev.kind === 'shared_playlist' && prev.sharedId === sharedId)
          ? [...s.detailViewHistory, prev].slice(-12)
          : s.detailViewHistory,
      activeDetailView: { kind: 'shared_playlist', sharedId },
      spotlightOpen: false,
      nowPlayingOpen: false,
    }));
  },
  closeDetailView: () =>
    set((s) => {
      if (s.detailViewHistory.length > 0) {
        const nextHistory = s.detailViewHistory.slice(0, -1);
        const targetView = s.detailViewHistory[s.detailViewHistory.length - 1] ?? null;
        return {
          activeDetailView: targetView,
          detailViewHistory: nextHistory,
        };
      }
      return { activeDetailView: null, detailViewHistory: [] };
    }),

  showToast: (message) => {
    if (toastTimer) {
      clearTimeout(toastTimer);
      toastTimer = null;
    }
    set({ toastMessage: message });
    toastTimer = setTimeout(() => {
      toastTimer = null;
      set({ toastMessage: null });
    }, 2600);
  },

  openTrackMenu: (track, x, y, playlistId) => {
    set({ trackMenu: { track, x, y, playlistId } });
  },

  closeTrackMenu: () => set({ trackMenu: null }),

  playTrack: async (rawTrack, newQueue, startSec, direction = 'next') => {
    const requestedTrack = canonicalizeTrackArtists(rawTrack);
    ensureAudioEngineBindings();
    if (seekAutoTriggerTimer) {
      clearTimeout(seekAutoTriggerTimer);
      seekAutoTriggerTimer = null;
    }
    const mySwitchEpoch = ++manualSwitchEpoch;
    manualTrackSwitchInFlight = true;
    try {
      const st = get();
      const offlineNow =
        st.isOfflineNetwork || (typeof navigator !== 'undefined' && navigator.onLine === false);
      let track = requestedTrack;
      if (offlineNow) {
        let hasOfflineAudio = st.offlineDownloads[track.id] === 'downloaded';
        if (!hasOfflineAudio) {
          const directUrl = await defaultPlatformBridge.offlineStorage.getAudioUrl(track.id);
          hasOfflineAudio = Boolean(directUrl);
        }
        if (!hasOfflineAudio) {
          const pool =
            newQueue && newQueue.length > 0
              ? newQueue.map(canonicalizeTrackArtists)
              : st.queue.map(canonicalizeTrackArtists);
          const firstAvailable = pool.find((t) => st.offlineDownloads[t.id] === 'downloaded');
          if (firstAvailable && newQueue && newQueue.length > 1) {
            st.showToast(`Sin conexión: saltando a «${firstAvailable.title}»`);
            track = firstAvailable;
          } else {
            st.showToast('Sin conexión: esta canción no está descargada');
            return;
          }
        }
      }
      recordSessionPlayedTrack(track);
      if (st.currentTrack && st.currentTrack.id !== track.id && st.positionSec >= 30) {
        recordWrappedListenIfEligible(
          st.currentTrack,
          st.positionSec,
          st.activeTab.toLowerCase(),
          false
        );
      }
      const rawQueue =
        newQueue && newQueue.length > 0
          ? newQueue.map(canonicalizeTrackArtists)
          : st.queue.map(canonicalizeTrackArtists);
      const hasNewQueue = Boolean(newQueue && newQueue.length > 0);
      let queue = [...rawQueue];
      let unshuffledQueue = hasNewQueue ? [...rawQueue] : st.unshuffledQueue;
      let nextShuffleEnabled = st.alwaysShuffle ? true : st.shuffleEnabled;

      if (nextShuffleEnabled && queue.length > 1 && (hasNewQueue || (st.alwaysShuffle && !st.shuffleEnabled))) {
        const others = queue.filter((t) => t.id !== track.id);
        unshuffledQueue = hasNewQueue
          ? [...rawQueue]
          : st.unshuffledQueue.length > 0
            ? st.unshuffledQueue
            : [...queue];
        queue = [track, ...diversifyAndShuffleTracks(others)];
      }

      let idx = queue.findIndex((t) => t.id === track.id);
      if (idx === -1) {
        queue.unshift(track);
        idx = 0;
      }

      const rawUserQueueCount =
        pendingNextUserQueueCount !== null
          ? pendingNextUserQueueCount
          : hasNewQueue
            ? 0
            : st.userQueueCount;
      pendingNextUserQueueCount = null;
      const nextUserQueueCount = Math.max(
        0,
        Math.min(rawUserQueueCount, Math.max(0, queue.length - idx - 1))
      );

      if (!st.trackAnalyses[track.id]) {
        const ana = await djPlanner.analyzeTrack(track.id, null, track.durationSec);
        set((prev) => ({
          trackAnalyses: { ...prev.trackAnalyses, [track.id]: ana },
        }));
      }

      const analysis = get().trackAnalyses[track.id];
      const effectiveStartSec =
        startSec !== undefined
          ? startSec
          : st.djMode.enabled && st.djMode.style === 'quick' && analysis
            ? Math.max(0, analysis.primaryDropSec - 4)
            : 0;

      const trackMetaKey = normalizeTrackMetaKey(track);
      set({
        currentTrack: track,
        lastTrackDirection: direction,
        queue,
        userQueueCount: nextUserQueueCount,
        unshuffledQueue,
        shuffleEnabled: nextShuffleEnabled,
        queueIndex: idx,
        recommendedQueue: st.recommendedQueue.filter(
          (t) => t.id !== track.id && normalizeTrackMetaKey(t) !== trackMetaKey
        ),
        positionSec: effectiveStartSec,
        durationSec: track.durationSec,
        isPlaying: true,
        activeTransitionPlan: null,
        currentLyrics: null,
        activeLyricIndex: -1,
        lyricsUserScrolled: false,
      });

      djPreloadedKey = '';
      suppressedAutoTransitionTrackId = null;
      lastObservedPlayback = { trackId: track.id, posSec: effectiveStartSec };
      applyAmbientPaletteForTrack(track);
      void get().loadLyricsForTrack(track);
      audioEngine.setPlaybackRate(get().playbackRate, get().preservesPitch);
      await audioEngine.loadAndPlay(track, effectiveStartSec);
      audioEngine.setNormalization(
        get().audioNormalization,
        normTargetToDb(get().normalizationTarget),
        analysis?.loudnessDb
      );
      void analyzeTrackAudioInBackground(track);

      // Lazy full-credits contributor hydration & presence only when online
      if (!offlineNow) {
        void hydrateTrackContributorsIfNeeded(track);
      }

      if (!offlineNow) {
        void syncEngine.updatePresence({
          is_active: true,
          is_playing: true,
          track_title: `${track.title} — ${track.artists.map((a) => a.name).join(', ')}`,
        });
      }
      syncDiscordPresenceState();
      pushHostJamStateSoon();

      if (
        isLiveRuntime() &&
        !offlineNow &&
        get().streamQuality !== 'low' &&
        (get().recommendedQueue.length < 5 || (newQueue && newQueue.length === 1))
      ) {
        void get().replenishRecommendedQueue(Boolean(newQueue && newQueue.length === 1));
      }
      const nextCandidate = getUpcomingDjTarget(get())?.track;
      if (nextCandidate && nextCandidate.id !== track.id && get().streamQuality !== 'low') {
        const nextAna =
          get().trackAnalyses[nextCandidate.id] ??
          (await djPlanner.analyzeTrack(nextCandidate.id, null, nextCandidate.durationSec));
        const nextCueIn =
          st.djMode.enabled && st.djMode.style === 'quick'
            ? Math.max(1, Math.round(nextAna.primaryDropSec - 4))
            : 0;
        preloadTrackCoverArt(nextCandidate);
        void analyzeTrackAudioInBackground(nextCandidate);
        void audioEngine.preloadNextDeck(nextCandidate, nextCueIn);
      }
      void recomputeActiveDjPlan();
    } finally {
      if (mySwitchEpoch === manualSwitchEpoch) {
        manualTrackSwitchInFlight = false;
      }
    }
  },

  playCollection: async (rawTracks, options) => {
    const tracks = rawTracks.filter((t) => Boolean(t?.id)).map(canonicalizeTrackArtists);
    if (tracks.length === 0) return;
    if (options?.isPlaylist) {
      activePlaylistExcludedIds.clear();
      activePlaylistExcludedKeys.clear();
      for (const t of tracks) {
        activePlaylistExcludedIds.add(t.id);
        const mk = normalizeTrackMetaKey(t);
        if (mk !== '::') activePlaylistExcludedKeys.add(mk);
      }
    }
    const st = get();
    const useShuffle = Boolean(options?.forceShuffle || st.shuffleEnabled || st.alwaysShuffle);
    let chosenIdx = options?.startIndex ?? 0;
    if (useShuffle && options?.startIndex === undefined && tracks.length > 1) {
      chosenIdx = Math.floor(Math.random() * tracks.length);
    }
    chosenIdx = Math.max(0, Math.min(tracks.length - 1, chosenIdx));
    const picked = tracks[chosenIdx]!;
    if (options?.forceShuffle && !st.shuffleEnabled) {
      set({ shuffleEnabled: true });
    }
    await get().playTrack(picked, tracks, undefined, 'next');
    if (options?.forceShuffle || useShuffle) {
      persistPrefsFromStore();
    }
  },

  togglePlayPause: async () => {
    const preSt = get();
    if (preSt.activeJamRole === 'guest' && preSt.activeJamSession?.active) {
      preSt.showToast('Solo el jefe de la Jam controla la reproducción');
      return;
    }
    ensureAudioEngineBindings();
    const st = get();
    if (st.isPlaying) {
      const livePos = audioEngine.getLivePositionSec();
      const dur = audioEngine.getState().durationSec || st.durationSec;
      const clampedLivePos =
        dur > 0 ? Math.max(0, Math.min(dur, livePos || st.positionSec)) : livePos || st.positionSec;
      const lyrics = st.currentLyrics;
      const liveLyricIdx =
        lyrics && lyrics.status === 'synced'
          ? lrcParser.findActiveLineIndex(lyrics.lines, clampedLivePos * 1000)
          : st.activeLyricIndex;
      audioEngine.pause();
      set({
        isPlaying: false,
        isBuffering: false,
        positionSec: clampedLivePos,
        activeLyricIndex: liveLyricIdx,
      });
      void syncEngine.updatePresence({ is_playing: false });
      syncDiscordPresenceState();
      pushHostJamStateSoon();
    } else {
      const snapshots =
        typeof document !== 'undefined'
          ? Array.from(document.querySelectorAll('audio'))
          : [];
      const hasLoadedSrc = snapshots.some((a) => Boolean(a.src));
      if (!hasLoadedSrc) {
        await st.playTrack(st.currentTrack, st.queue, st.positionSec);
      } else {
        await audioEngine.play();
        set({ isPlaying: true });
        void syncEngine.updatePresence({ is_playing: true });
        syncDiscordPresenceState();
        pushHostJamStateSoon();
      }
    }
  },

  nextTrack: async (isAutoAdvance = false) => {
    const preSt = get();
    if (preSt.activeJamRole === 'guest' && preSt.activeJamSession?.active) {
      if (!isAutoAdvance) preSt.showToast('Solo el jefe de la Jam controla la reproducción');
      return;
    }
    if (isAutoAdvance && (autoAdvanceInFlight || manualTrackSwitchInFlight)) return;
    if (seekAutoTriggerTimer) {
      clearTimeout(seekAutoTriggerTimer);
      seekAutoTriggerTimer = null;
    }
    if (isAutoAdvance) autoAdvanceInFlight = true;
    const mySwitchEpoch = !isAutoAdvance ? ++manualSwitchEpoch : manualSwitchEpoch;
    if (!isAutoAdvance) manualTrackSwitchInFlight = true;
    try {
      const st = get();
      if (!isAutoAdvance) {
        lastAutoAdvanceGuard = { trackId: st.currentTrack.id, atMs: Date.now() };
        if (st.positionSec > 0 && st.positionSec < 20) {
          void recommendationEngine.recordSignal(st.currentTrack, 'skip_early', {
            actualPlayedSec: st.positionSec,
          });
        } else if (st.durationSec > 0 && st.positionSec / st.durationSec >= 0.8) {
          void recommendationEngine.recordSignal(st.currentTrack, 'complete_listen', {
            completionRatio: st.positionSec / st.durationSec,
          });
        }
      }

      if (isAutoAdvance && st.repeatMode === 'one') {
        await st.playTrack(st.currentTrack, st.queue, 0);
        return;
      }

      const offlineNow =
        st.isOfflineNetwork || (typeof navigator !== 'undefined' && navigator.onLine === false);
      let target = getUpcomingDjTarget(st);
      if (offlineNow && target && st.offlineDownloads[target.track.id] !== 'downloaded') {
        const offlinePool = st.queue.filter(
          (t, i) => i > st.queueIndex && st.offlineDownloads[t.id] === 'downloaded'
        );
        const fallbackPool =
          offlinePool.length > 0
            ? offlinePool
            : st.queue.filter(
                (t) => t.id !== st.currentTrack?.id && st.offlineDownloads[t.id] === 'downloaded'
              );
        if (fallbackPool.length > 0) {
          const picked = fallbackPool[0]!;
          target = {
            track: picked,
            nextIdx: st.queue.findIndex((t) => t.id === picked.id),
            fromRecommended: false,
          };
        } else {
          target = null;
        }
      }
      if (!target && st.autoplayEnabled && !offlineNow) {
        await st.replenishRecommendedQueue(true);
        target = getUpcomingDjTarget(get());
      }

      if (!target) {
        if (isAutoAdvance && st.repeatMode === 'off') {
          audioEngine.pause();
          set({ isPlaying: false });
        }
        return;
      }

      const latest = get();
      const next = target.track;

      if (!isAutoAdvance && (djAutoTransitionInFlight || latest.isTransitioning)) {
        djSessionEpoch++;
        audioEngine.cancelActiveTransition();
        djAutoTransitionInFlight = false;
        djAutoTransitionStartedAtMs = 0;
        set({ outgoingTransitionTrack: null, incomingTransitionTrack: null });
      }

      const nextPrevStack = [...latest.sessionPrevStack, latest.currentTrack].slice(-20);
      let nextQueue: Track[];
      let nextRecommended = latest.recommendedQueue;

      if (target.fromRecommended) {
        nextQueue = [next];
        nextRecommended = latest.recommendedQueue.filter((t) => t.id !== next.id);
        pendingNextUserQueueCount = 0;
      } else if (latest.repeatMode === 'all' && target.nextIdx === 0 && latest.queue.length > 1) {
        nextQueue = latest.queue;
        pendingNextUserQueueCount = 0;
      } else {
        // Consumed tracks before nextIdx drop off from active queue automatically
        nextQueue = latest.queue.slice(Math.max(0, target.nextIdx));
        const stepsConsumed = Math.max(1, target.nextIdx - latest.queueIndex);
        pendingNextUserQueueCount = Math.max(0, latest.userQueueCount - stepsConsumed);
      }

      set({
        sessionPrevStack: nextPrevStack,
        recommendedQueue: nextRecommended,
      });
      await get().playTrack(next, nextQueue, undefined, 'next');
      set({
        affinityProfile: recommendationEngine.getAffinityProfile(),
        playHistory: libraryStore.getPlayHistory(),
      });
      if (get().authState.connected) {
        persistPrefsFromStore();
      }
    } finally {
      if (isAutoAdvance) autoAdvanceInFlight = false;
      if (!isAutoAdvance && mySwitchEpoch === manualSwitchEpoch) {
        manualTrackSwitchInFlight = false;
      }
    }
  },

  prevTrack: async () => {
    const st = get();
    if (st.activeJamRole === 'guest' && st.activeJamSession?.active) {
      st.showToast('Solo el jefe de la Jam controla la reproducción');
      return;
    }
    if (st.positionSec > 5) {
      st.seekTo(0);
      return;
    }
    if (seekAutoTriggerTimer) {
      clearTimeout(seekAutoTriggerTimer);
      seekAutoTriggerTimer = null;
    }
    const mySwitchEpoch = ++manualSwitchEpoch;
    manualTrackSwitchInFlight = true;
    try {
      lastAutoAdvanceGuard = { trackId: st.currentTrack.id, atMs: Date.now() };
      if (st.sessionPrevStack.length > 0) {
        const prev = st.sessionPrevStack[st.sessionPrevStack.length - 1]!;
        const nextStack = st.sessionPrevStack.slice(0, -1);
        const remaining = st.queue.filter((t) => t.id !== prev.id);
        const nextQueue = [prev, ...remaining];
        set({ sessionPrevStack: nextStack });
        await st.playTrack(prev, nextQueue, undefined, 'prev');
        return;
      }
      const prevIdx = (st.queueIndex - 1 + st.queue.length) % Math.max(1, st.queue.length);
      const prev = st.queue[prevIdx] ?? FALLBACK_TRACKS[0]!;
      await st.playTrack(prev, st.queue, undefined, 'prev');
    } finally {
      if (mySwitchEpoch === manualSwitchEpoch) {
        manualTrackSwitchInFlight = false;
      }
    }
  },

  toggleShuffle: () => {
    const st = get();
    if (st.activeJamRole === 'guest' && st.activeJamSession?.active) {
      st.showToast('Solo el jefe de la Jam controla la reproducción');
      return;
    }
    djPreloadedKey = '';
    if (!st.shuffleEnabled) {
      const original = [...st.queue];
      const others = original.filter((t) => t.id !== st.currentTrack.id);
      const shuffled = [st.currentTrack, ...diversifyAndShuffleTracks(others)];
      set({
        shuffleEnabled: true,
        unshuffledQueue: original,
        queue: shuffled,
        queueIndex: 0,
      });
    } else {
      const restored = st.unshuffledQueue.length > 0 ? [...st.unshuffledQueue] : [...st.queue];
      const idx = Math.max(
        0,
        restored.findIndex((t) => t.id === st.currentTrack.id)
      );
      set({
        shuffleEnabled: false,
        unshuffledQueue: [],
        queue: restored,
        queueIndex: idx,
      });
    }
    void recomputeActiveDjPlan();
    persistPrefsFromStore();
    const nextShuf = get();
    lastMediaSessionSyncKey = '';
    void getMediaController().updateSession({
      track: nextShuf.currentTrack,
      isPlaying: nextShuf.isPlaying,
      positionSec: nextShuf.positionSec,
      durationSec: nextShuf.durationSec,
      shuffleEnabled: nextShuf.shuffleEnabled,
      repeatMode: nextShuf.repeatMode,
    });
  },

  cycleRepeatMode: () => {
    const preSt = get();
    if (preSt.activeJamRole === 'guest' && preSt.activeJamSession?.active) {
      preSt.showToast('Solo el jefe de la Jam controla la reproducción');
      return;
    }
    const cur = preSt.repeatMode;
    const next: RepeatMode = cur === 'off' ? 'all' : cur === 'all' ? 'one' : 'off';
    set({ repeatMode: next });
    void recomputeActiveDjPlan();
    persistPrefsFromStore();
    const stRep = get();
    lastMediaSessionSyncKey = '';
    void getMediaController().updateSession({
      track: stRep.currentTrack,
      isPlaying: stRep.isPlaying,
      positionSec: stRep.positionSec,
      durationSec: stRep.durationSec,
      shuffleEnabled: stRep.shuffleEnabled,
      repeatMode: stRep.repeatMode,
    });
  },

  seekTo: (positionSec) => {
    const preSt = get();
    if (preSt.activeJamRole === 'guest' && preSt.activeJamSession?.active) {
      preSt.showToast('Solo el jefe de la Jam controla la reproducción');
      return;
    }
    if (seekAutoTriggerTimer) {
      clearTimeout(seekAutoTriggerTimer);
      seekAutoTriggerTimer = null;
    }
    const st = get();
    const dur = audioEngine.getState().durationSec || st.durationSec || st.currentTrack.durationSec;
    const lyrics = st.currentLyrics;
    const activeIdx =
      lyrics && lyrics.status === 'synced'
        ? lrcParser.findActiveLineIndex(lyrics.lines, positionSec * 1000)
        : -1;

    if (st.isTransitioning || djAutoTransitionInFlight) {
      djSessionEpoch++;
      djAutoTransitionInFlight = false;
      djAutoTransitionStartedAtMs = 0;
      set({
        isTransitioning: false,
        outgoingTransitionTrack: null,
        incomingTransitionTrack: null,
      });
    }

    // 1. If the user drags the scrub bar right to the very end of the track, advance 1 track cleanly
    if (dur > 10 && positionSec >= dur - 0.85) {
      suppressedAutoTransitionTrackId = st.currentTrack.id;
      lastObservedPlayback = { trackId: st.currentTrack.id, posSec: dur };
      set({ positionSec: dur, activeLyricIndex: activeIdx });
      syncDiscordPresenceState();
      seekAutoTriggerTimer = setTimeout(() => {
        seekAutoTriggerTimer = null;
        const cur = get();
        if (cur.isTransitioning || djAutoTransitionInFlight || autoAdvanceInFlight) return;
        const nowMs = Date.now();
        if (
          lastAutoAdvanceGuard.trackId === cur.currentTrack.id &&
          nowMs - lastAutoAdvanceGuard.atMs < 1800
        ) {
          return;
        }
        lastAutoAdvanceGuard = { trackId: cur.currentTrack.id, atMs: nowMs };
        void recommendationEngine.recordSignal(cur.currentTrack, 'complete_listen', {
          completionRatio: 1.0,
        });
        void cur.nextTrack(true);
      }, 140);
      return;
    }

    audioEngine.seek(positionSec);
    lastObservedPlayback = { trackId: st.currentTrack.id, posSec: positionSec };
    set({ positionSec, activeLyricIndex: activeIdx });

    // 2. Seeking directly inside the active DJ / crossfade window suppresses auto-crossfade
    // for the rest of this track so playback never bugs or skips multiple tracks; seeking
    // back out re-arms it cleanly for when natural playback crosses the threshold.
    const plan = st.activeTransitionPlan;
    if (st.djMode.enabled && st.repeatMode !== 'one') {
      const effectiveCueOut = plan
        ? Math.max(4, Math.min(plan.cueOutSec, Math.floor(dur - Math.min(plan.transitionDurationSec, dur * 0.35) - 0.5)))
        : Math.max(10, Math.floor(dur - 8));
      if (dur > 10 && positionSec >= effectiveCueOut - 0.5) {
        suppressedAutoTransitionTrackId = st.currentTrack.id;
      } else {
        suppressedAutoTransitionTrackId = null;
        if (!plan) {
          void recomputeActiveDjPlan();
        }
      }
    } else if (
      !st.djMode.enabled &&
      st.safeCrossfade.enabled &&
      st.safeCrossfade.durationSec > 0 &&
      st.repeatMode !== 'one' &&
      dur > 10 &&
      positionSec >= dur - st.safeCrossfade.durationSec - 0.5
    ) {
      suppressedAutoTransitionTrackId = st.currentTrack.id;
    } else {
      suppressedAutoTransitionTrackId = null;
    }
    syncDiscordPresenceState();
  },

  setVolume: (volume01) => {
    const clamped = Math.max(0, Math.min(1, volume01));
    if (clamped > 0) previousVolumeBeforeMute = clamped;
    audioEngine.setVolume(clamped);
    set({ volume: clamped });
    persistPrefsFromStore();
  },

  toggleMute: () => {
    const st = get();
    if (st.volume > 0) {
      previousVolumeBeforeMute = st.volume;
      st.setVolume(0);
    } else {
      st.setVolume(previousVolumeBeforeMute || 0.85);
    }
  },

  moveQueueItem: (fromIndex, toIndex) => {
    const st = get();
    if (
      fromIndex < 0 ||
      toIndex < 0 ||
      fromIndex >= st.queue.length ||
      toIndex >= st.queue.length ||
      fromIndex === toIndex
    ) {
      return;
    }
    const oldCurIdx = st.queueIndex;
    const oldUserEnd = oldCurIdx + st.userQueueCount;
    const fromInUserZone = fromIndex > oldCurIdx && fromIndex <= oldUserEnd;
    const toInUserZone = toIndex > oldCurIdx && toIndex <= oldUserEnd;
    let nextUserCount = st.userQueueCount;
    if (fromInUserZone && !toInUserZone && toIndex > oldUserEnd) {
      nextUserCount = Math.max(0, nextUserCount - 1);
    } else if (!fromInUserZone && toInUserZone && fromIndex > oldUserEnd) {
      nextUserCount += 1;
    }

    const copy = [...st.queue];
    const [moved] = copy.splice(fromIndex, 1);
    if (!moved) return;
    copy.splice(toIndex, 0, moved);
    const newCurrentIdx = Math.max(
      0,
      copy.findIndex((t) => t.id === st.currentTrack.id)
    );
    set({
      queue: copy,
      queueIndex: newCurrentIdx,
      userQueueCount: Math.max(0, Math.min(nextUserCount, Math.max(0, copy.length - newCurrentIdx - 1))),
    });
    void recomputeActiveDjPlan();
    persistPrefsFromStore();
    pushHostJamStateSoon();
  },

  removeQueueItem: (index) => {
    const st = get();
    if (st.queue.length <= 1 || index < 0 || index >= st.queue.length) return;
    const removedInUserZone =
      index > st.queueIndex && index <= st.queueIndex + st.userQueueCount;
    const copy = st.queue.filter((_, idx) => idx !== index);
    const newCurrentIdx = Math.max(
      0,
      copy.findIndex((t) => t.id === st.currentTrack.id)
    );
    const nextUserCount = removedInUserZone
      ? Math.max(0, st.userQueueCount - 1)
      : st.userQueueCount;
    set({
      queue: copy,
      queueIndex: newCurrentIdx,
      userQueueCount: Math.max(0, Math.min(nextUserCount, Math.max(0, copy.length - newCurrentIdx - 1))),
    });
    void recomputeActiveDjPlan();
    persistPrefsFromStore();
    pushHostJamStateSoon();
  },

  clearUpNextQueue: () => {
    const st = get();
    const kept = st.currentTrack;
    djPreloadedKey = '';
    set({
      queue: [kept],
      userQueueCount: 0,
      unshuffledQueue: st.shuffleEnabled ? [kept] : st.unshuffledQueue,
      queueIndex: 0,
      activeTransitionPlan: null,
    });
    st.showToast('Cola limpiada');
    pushHostJamStateSoon();
  },

  addToQueue: (rawTrack) => {
    const track = canonicalizeTrackArtists(rawTrack);
    const st = get();
    if (track.id === st.currentTrack.id && st.queue.length <= 1) {
      st.showToast('Ya está sonando ahora');
      return;
    }
    const userSliceEnd = st.queueIndex + st.userQueueCount;
    let adjustedUserCount = st.userQueueCount;
    const filtered = st.queue.filter((t, i) => {
      if (i > st.queueIndex && t.id === track.id) {
        if (i <= userSliceEnd) adjustedUserCount = Math.max(0, adjustedUserCount - 1);
        return false;
      }
      return true;
    });
    const curIdx = Math.max(
      0,
      filtered.findIndex((t) => t.id === st.currentTrack.id)
    );
    const insertIdx = Math.min(filtered.length, curIdx + 1 + adjustedUserCount);
    filtered.splice(insertIdx, 0, track);
    const nextUserCount = Math.min(Math.max(0, filtered.length - curIdx - 1), adjustedUserCount + 1);
    set({
      queue: filtered,
      queueIndex: curIdx,
      userQueueCount: nextUserCount,
      recommendedQueue: st.recommendedQueue.filter((t) => t.id !== track.id),
    });
    djPreloadedKey = '';
    st.showToast('Añadida a la cola');
    void recomputeActiveDjPlan();
    persistPrefsFromStore();
    pushHostJamStateSoon();
  },

  playNextInQueue: (rawTrack) => {
    const track = canonicalizeTrackArtists(rawTrack);
    const st = get();
    if (track.id === st.currentTrack.id) {
      st.showToast('Ya está sonando ahora');
      return;
    }
    const userSliceEnd = st.queueIndex + st.userQueueCount;
    let adjustedUserCount = st.userQueueCount;
    const copy = st.queue.filter((t, i) => {
      if (i > st.queueIndex && t.id === track.id) {
        if (i <= userSliceEnd) adjustedUserCount = Math.max(0, adjustedUserCount - 1);
        return false;
      }
      return true;
    });
    const curIdx = Math.max(
      0,
      copy.findIndex((t) => t.id === st.currentTrack.id)
    );
    copy.splice(curIdx + 1, 0, track);
    set({
      queue: copy,
      queueIndex: curIdx,
      userQueueCount: Math.min(Math.max(0, copy.length - curIdx - 1), adjustedUserCount + 1),
      recommendedQueue: st.recommendedQueue.filter((t) => t.id !== track.id),
    });
    djPreloadedKey = '';
    st.showToast('Sonará a continuación');
    void recomputeActiveDjPlan();
    persistPrefsFromStore();
    pushHostJamStateSoon();
  },

  playQueueIndex: async (index) => {
    const st = get();
    const t = st.queue[index];
    if (!t) return;
    if (index > st.queueIndex) {
      const steps = index - st.queueIndex;
      pendingNextUserQueueCount = Math.max(0, st.userQueueCount - steps);
    } else {
      pendingNextUserQueueCount = st.userQueueCount;
    }
    await get().playTrack(t, st.queue.slice(index), undefined, 'next');
  },

  replenishRecommendedQueue: async (force = false) => {
    const st = get();
    if (st.isLoadingRecommendedQueue) return;
    if (!force && (st.streamQuality === 'low' ? st.recommendedQueue.length >= 2 : st.recommendedQueue.length >= 6)) return;
    set({ isLoadingRecommendedQueue: true });
    try {
      const excludedIds = new Set<string>([
        st.currentTrack.id,
        ...st.queue.map((t) => t.id),
        ...st.sessionPrevStack.map((t) => t.id),
        ...sessionPlayedTrackIds,
        ...activePlaylistExcludedIds,
      ]);
      const excludedKeys = new Set<string>([
        normalizeTrackMetaKey(st.currentTrack),
        ...st.queue.map(normalizeTrackMetaKey),
        ...st.sessionPrevStack.map(normalizeTrackMetaKey),
        ...sessionPlayedTrackKeys,
        ...activePlaylistExcludedKeys,
      ]);
      const baseExisting = force ? [] : st.recommendedQueue;
      for (const t of baseExisting) {
        excludedIds.add(t.id);
        excludedKeys.add(normalizeTrackMetaKey(t));
      }

      const primaryFetched: Track[] = [];
      try {
        const [relRes, upNextRes] = await Promise.allSettled([
          musicProvider.getRelated(st.currentTrack.id),
          musicProvider.getUpNext(st.currentTrack.id, true),
        ]);
        if (relRes.status === 'fulfilled') {
          primaryFetched.push(...(relRes.value.tracks ?? []));
        }
        if (upNextRes.status === 'fulfilled') {
          primaryFetched.push(...(upNextRes.value ?? []));
        }
      } catch {
        // ignore and search artist scene below
      }

      const freshPrimaryCount = primaryFetched.filter(
        (t) =>
          t?.id &&
          !excludedIds.has(t.id) &&
          !excludedKeys.has(normalizeTrackMetaKey(t))
      ).length;

      if (freshPrimaryCount < 5) {
        const favNames = st.favoriteArtists.map((a) => a.artistName);
        const topNames = recommendationEngine
          .getAffinityProfile()
          .slice(0, 6)
          .map((a) => a.artistName);
        const seedArtist = st.currentTrack.artists[0]?.name?.trim();
        const searchCandidates = Array.from(
          new Set([
            ...(seedArtist ? [seedArtist] : []),
            ...favNames,
            ...topNames,
          ].filter(Boolean))
        ).slice(0, 3);
        const searches = await Promise.allSettled(
          searchCandidates.map((q) => musicProvider.search(q, 'song'))
        );
        for (const sRes of searches) {
          if (sRes.status === 'fulfilled') {
            primaryFetched.push(...(sRes.value.songs ?? []));
          }
        }
      }

      const fallbackCushion =
        primaryFetched.length < 6
          ? [
              ...get().exploreSimilarTracks,
              ...get().homeShelves.flatMap((s) => s.tracks ?? []),
              ...FALLBACK_TRACKS,
            ]
          : [];

      const uniquePrimary: Track[] = [];
      const uniqueCushion: Track[] = [];
      const seenKeys = new Set<string>(excludedKeys);
      const pushUnique = (list: Track[], target: Track[]) => {
        for (const item of list) {
          if (!item?.id || excludedIds.has(item.id)) continue;
          const normKey = normalizeTrackMetaKey(item);
          if (normKey !== '::' && seenKeys.has(normKey)) continue;
          if (normKey !== '::') seenKeys.add(normKey);
          excludedIds.add(item.id);
          target.push(item);
        }
      };

      pushUnique(primaryFetched, uniquePrimary);
      pushUnique(fallbackCushion, uniqueCushion);

      const rankedPrimary =
        uniquePrimary.length > 0
          ? recommendationEngine.rerankTracks(uniquePrimary, {
              maxPerArtistInWindow: 2,
              limit: 24,
            })
          : [];
      const rankedCushion =
        rankedPrimary.length < 8 && uniqueCushion.length > 0
          ? recommendationEngine.rerankTracks(uniqueCushion, {
              maxPerArtistInWindow: 2,
              limit: 12,
            })
          : [];
      const rankedNew = [...rankedPrimary, ...rankedCushion].slice(0, 28);

      const curAlbumKey = (st.currentTrack.album?.name ?? '').trim().toLowerCase();
      const diversified: Track[] = [];
      const overflowSameAlbum: Track[] = [];
      const albumCounts = new Map<string, number>();

      for (const candidate of rankedNew) {
        const albumKey = (candidate.album?.name ?? '').trim().toLowerCase();
        if (curAlbumKey && albumKey === curAlbumKey) {
          overflowSameAlbum.push(candidate);
          continue;
        }
        const count = albumKey ? (albumCounts.get(albumKey) ?? 0) : 0;
        if (albumKey && count >= 3) continue;
        if (albumKey) albumCounts.set(albumKey, count + 1);
        diversified.push(candidate);
        if (diversified.length >= 12) break;
      }

      if (overflowSameAlbum.length > 0 && diversified.length < 14) {
        const sameCap = Math.min(2, overflowSameAlbum.length);
        for (let i = 0; i < sameCap && diversified.length < 14; i++) {
          const insertAt = Math.min(diversified.length, i === 0 ? 2 : 5);
          diversified.splice(insertAt, 0, overflowSameAlbum[i]!);
        }
      }

      const merged = [...baseExisting, ...diversified].slice(0, 14);
      set({
        recommendedQueue: merged,
        isLoadingRecommendedQueue: false,
      });
      if (get().djMode.enabled && !get().activeTransitionPlan) {
        void recomputeActiveDjPlan();
      }
    } catch {
      set({ isLoadingRecommendedQueue: false });
    }
  },

  promoteRecommendedTrack: (trackId) => {
    const st = get();
    const target = st.recommendedQueue.find((t) => t.id === trackId);
    if (!target) return;
    const nextRec = st.recommendedQueue.filter((t) => t.id !== trackId);
    set({ recommendedQueue: nextRec });
    st.addToQueue(target);
    if (nextRec.length < 6) {
      void get().replenishRecommendedQueue();
    }
  },

  dismissRecommendedTrack: (trackId) => {
    const st = get();
    const nextRec = st.recommendedQueue.filter((t) => t.id !== trackId);
    set({ recommendedQueue: nextRec });
    if (nextRec.length < 6) {
      void get().replenishRecommendedQueue();
    }
  },

  startTrackRadio: async (track, withDj = true) => {
    const st = get();
    let related: Track[] = [];
    try {
      related = await musicProvider.getUpNext(track.id, true);
    } catch {
      related = [];
    }
    if (related.length === 0) {
      try {
        const artistQuery = track.artists[0]?.name ?? track.title;
        const bundle = await musicProvider.search(artistQuery, 'song');
        related = bundle.songs;
      } catch {
        related = [];
      }
    }
    const radioQueue = [track, ...related.filter((t) => t.id !== track.id).slice(0, 20)];
    if (withDj && !st.djMode.enabled) {
      await st.toggleDjMode(true);
    }
    await get().playTrack(track, radioQueue);
    get().showToast(`Radio de «${track.title}» iniciada`);
  },

  playArtistShuffled: async (artist, topSongs, albums = [], singles = []) => {
    const basePool = [...topSongs];
    if (basePool.length === 0) return;

    const token = ++activeArtistShuffleToken;
    const shuffled = diversifyAndShuffleTracks(basePool, get().currentTrack?.id);
    const first = shuffled[0] ?? basePool[0]!;
    set({ shuffleEnabled: true });
    await get().playTrack(first, shuffled);
    set({ unshuffledQueue: [...basePool], shuffleEnabled: true });

    // Background enrichment: mix in tracks from the artist's albums & EPs so older releases
    // get equal representation alongside their newest album.
    const countsByAlbumId = new Map<string, number>();
    for (const t of basePool) {
      if (t.album?.id) {
        countsByAlbumId.set(t.album.id, (countsByAlbumId.get(t.album.id) ?? 0) + 1);
      }
    }
    const candidateReleases = [...albums, ...singles].filter((r) => Boolean(r?.id));
    if (!isLiveRuntime() || candidateReleases.length === 0) return;

    const prioritizedReleases = candidateReleases
      .sort((a, b) => (countsByAlbumId.get(a.id) ?? 0) - (countsByAlbumId.get(b.id) ?? 0))
      .slice(0, 4);

    void Promise.allSettled(
      prioritizedReleases.map((rel) =>
        musicProvider.getAlbum(rel.id, undefined, {
          title: rel.title,
          artist: artist.name,
        })
      )
    ).then((results) => {
      if (token !== activeArtistShuffleToken) return;
      const curState = get();
      if (!curState.shuffleEnabled || curState.currentTrack.id !== first.id) return;

      const artistNorm = artist.name.trim().toLowerCase();
      const extraTracks: Track[] = [];
      for (const r of results) {
        if (r.status !== 'fulfilled' || !r.value?.tracks) continue;
        for (const t of r.value.tracks) {
          const belongs = t.artists.some(
            (ar) => ar.id === artist.id || ar.name.trim().toLowerCase() === artistNorm
          );
          if (belongs) extraTracks.push(t);
        }
      }
      if (extraTracks.length === 0) return;

      const curIdx = Math.max(0, curState.queueIndex);
      const playedOrCurrent = curState.queue.slice(0, curIdx + 1);
      const playedIds = new Set(playedOrCurrent.map((t) => t.id));
      const playedTitles = new Set(
        playedOrCurrent.map((t) => normalizeTrackShuffleTitle(t.title)).filter(Boolean)
      );
      const upcoming = [
        ...curState.queue.slice(curIdx + 1),
        ...extraTracks,
      ].filter((t) => {
        if (playedIds.has(t.id)) return false;
        const nt = normalizeTrackShuffleTitle(t.title);
        return !nt || !playedTitles.has(nt);
      });
      if (upcoming.length === 0) return;

      const diversifiedUpcoming = diversifyAndShuffleTracks(upcoming);
      set({
        queue: [...playedOrCurrent, ...diversifiedUpcoming],
        unshuffledQueue: [...basePool, ...extraTracks],
      });
      void recomputeActiveDjPlan();
    });
  },

  startFullDjRadio: async () => {
    const st = get();
    const candidates: Track[] = [
      ...st.likedTracks.map((l) => l.track),
      ...st.exploreSimilarTracks,
      ...st.homeShelves.flatMap((s) => s.tracks ?? []),
      ...st.playHistory.map((h) => h.track),
      ...FALLBACK_TRACKS,
    ];

    const topAffinity = st.affinityProfile[0]?.artistName ?? st.seedArtists[0]?.displayName;
    if (isLiveRuntime() && topAffinity) {
      try {
        const res = await musicProvider.search(topAffinity, 'song');
        candidates.push(...res.songs);
      } catch {
        // fallback to existing personalized pool
      }
    }

    const deduped: Track[] = [];
    const seen = new Set<string>();
    for (const item of candidates) {
      if (!item?.id || seen.has(item.id)) continue;
      seen.add(item.id);
      deduped.push(item);
    }

    const ranked = recommendationEngine.rerankTracks(deduped, {
      maxPerArtistInWindow: 2,
      limit: 18,
    });
    const sessionPool = ranked.length > 0 ? ranked : [...FALLBACK_TRACKS];
    const analysesMap = new Map<string, TrackAnalysis>();
    for (const t of sessionPool) {
      const ana =
        st.trackAnalyses[t.id] ?? (await djPlanner.analyzeTrack(t.id, null, t.durationSec));
      analysesMap.set(t.id, ana);
    }
    const orderedQueue = djPlanner.reorderQueueForSession(
      sessionPool,
      analysesMap,
      sessionPool[0]?.id
    );

    const nextDjMode: DjModeConfig = {
      ...st.djMode,
      enabled: true,
      autoReorderQueue: true,
      preferredTransition: 'auto',
      enabledTransitions: {
        eq_swap: true,
        filter_sweep: true,
        echo_out: true,
        vocal_over_beat: true,
        instrumental_bed: true,
        loop_build: true,
        ...st.djMode.enabledTransitions,
      },
    };
    audioEngine.setDjMode(nextDjMode);
    audioEngine.setSafeCrossfade({ ...st.safeCrossfade, enabled: false });
    set({
      djMode: nextDjMode,
      safeCrossfade: { ...st.safeCrossfade, enabled: false },
      trackAnalyses: {
        ...st.trackAnalyses,
        ...Object.fromEntries(analysesMap.entries()),
      },
    });
    persistPrefsFromStore();

    const first = orderedQueue[0];
    if (first) {
      await get().playTrack(first, orderedQueue);
    }
    get().showToast('Radio Full DJ activada · sesión ordenada por BPM y armonía');
  },

  setAutoplayEnabled: (enabled) => {
    set({ autoplayEnabled: enabled });
    persistPrefsFromStore();
  },

  setDjStemSculpting: (enabled) => {
    const st = get();
    const nextDjMode: DjModeConfig = { ...st.djMode, stemSculpting: enabled };
    audioEngine.setDjMode(nextDjMode);
    set({ djMode: nextDjMode });
    persistPrefsFromStore();
  },

  setDjVocalClashProtection: (enabled) => {
    const st = get();
    const nextDjMode: DjModeConfig = { ...st.djMode, vocalClashProtection: enabled };
    audioEngine.setDjMode(nextDjMode);
    set({ djMode: nextDjMode });
    persistPrefsFromStore();
  },

  setDjAutoReorder: (enabled) => {
    const st = get();
    const nextDjMode: DjModeConfig = { ...st.djMode, autoReorderQueue: enabled };
    audioEngine.setDjMode(nextDjMode);
    set({ djMode: nextDjMode });
    persistPrefsFromStore();
  },

  toggleDjMode: async (enabled) => {
    const st = get();
    const nextEnabled = enabled !== undefined ? enabled : !st.djMode.enabled;
    const nextDjMode: DjModeConfig = {
      ...st.djMode,
      enabled: nextEnabled,
    };
    const epoch = ++djSessionEpoch;
    djPreloadedKey = '';

    if (!nextEnabled) {
      if (seekAutoTriggerTimer) {
        clearTimeout(seekAutoTriggerTimer);
        seekAutoTriggerTimer = null;
      }
      djAutoTransitionInFlight = false;
      djAutoTransitionStartedAtMs = 0;
      audioEngine.cancelActiveTransition();
      audioEngine.setDjMode(nextDjMode);
      audioEngine.setPlaybackRate(1.0);
      const nextSafeCrossfade: SafeCrossfadeConfig = {
        ...st.safeCrossfade,
        enabled: st.safeCrossfade.durationSec > 0 ? true : st.safeCrossfade.enabled,
      };
      audioEngine.setSafeCrossfade(nextSafeCrossfade);
      set({
        djMode: nextDjMode,
        safeCrossfade: nextSafeCrossfade,
        activeTransitionPlan: null,
        outgoingTransitionTrack: null,
        incomingTransitionTrack: null,
        isTransitioning: false,
        transitionProgress01: 0,
        activeTransitionType: undefined,
      });
      persistPrefsFromStore();
      return;
    }

    audioEngine.setDjMode(nextDjMode);
    const pausedSafeCrossfade: SafeCrossfadeConfig = {
      ...st.safeCrossfade,
      enabled: false,
    };
    audioEngine.setSafeCrossfade(pausedSafeCrossfade);
    set({
      djMode: nextDjMode,
      // Safe crossfade is paused automatically while DJ Mode is active
      safeCrossfade: pausedSafeCrossfade,
    });
    persistPrefsFromStore();

    if (nextDjMode.autoReorderQueue) {
      const baseQueue = [...get().queue];
      const map = new Map<string, TrackAnalysis>();
      for (const t of baseQueue) {
        const ana =
          get().trackAnalyses[t.id] ??
          (await djPlanner.analyzeTrack(t.id, null, t.durationSec));
        map.set(t.id, ana);
      }
      if (!get().djMode.enabled || djSessionEpoch !== epoch) return;
      const latest = get();
      const reordered = djPlanner.reorderQueueForSession(
        [...latest.queue],
        map,
        latest.currentTrack.id
      );
      const nextIdx = Math.max(
        0,
        reordered.findIndex((t) => t.id === latest.currentTrack.id)
      );
      set({
        queue: reordered,
        queueIndex: nextIdx,
      });
      persistPrefsFromStore();
    }

    if (!get().djMode.enabled || djSessionEpoch !== epoch) return;
    const curState = get();
    void analyzeTrackAudioInBackground(curState.currentTrack);
    const upcoming = getUpcomingDjTarget(curState)?.track;
    if (upcoming && upcoming.id !== curState.currentTrack.id) {
      void analyzeTrackAudioInBackground(upcoming);
    }
    const plan = await recomputeActiveDjPlan();
    if (
      plan &&
      get().djMode.enabled &&
      djSessionEpoch === epoch &&
      upcoming &&
      upcoming.id !== get().currentTrack.id
    ) {
      void audioEngine.preloadNextDeck(upcoming, plan.cueInSec);
    }
  },

  setDjSessionStyle: async (style) => {
    const st = get();
    const wasEnabled = st.djMode.enabled;
    const nextDjMode: DjModeConfig = {
      ...st.djMode,
      enabled: true,
      style,
    };
    const epoch = ++djSessionEpoch;
    audioEngine.setDjMode(nextDjMode);
    djPreloadedKey = '';
    set({
      djMode: nextDjMode,
      activeTransitionPlan: null,
      safeCrossfade: { ...st.safeCrossfade, enabled: false },
    });
    persistPrefsFromStore();

    if (!wasEnabled && nextDjMode.autoReorderQueue) {
      const baseQueue = [...get().queue];
      const map = new Map<string, TrackAnalysis>();
      for (const t of baseQueue) {
        const ana =
          get().trackAnalyses[t.id] ??
          (await djPlanner.analyzeTrack(t.id, null, t.durationSec));
        map.set(t.id, ana);
      }
      if (!get().djMode.enabled || djSessionEpoch !== epoch) return;
      const latest = get();
      const reordered = djPlanner.reorderQueueForSession(
        [...latest.queue],
        map,
        latest.currentTrack.id
      );
      const nextIdx = Math.max(
        0,
        reordered.findIndex((t) => t.id === latest.currentTrack.id)
      );
      set({
        queue: reordered,
        queueIndex: nextIdx,
      });
      persistPrefsFromStore();
    }

    if (!get().djMode.enabled || djSessionEpoch !== epoch) return;
    const curState = get();
    void analyzeTrackAudioInBackground(curState.currentTrack);
    const upcoming = getUpcomingDjTarget(curState)?.track;
    if (upcoming && upcoming.id !== curState.currentTrack.id) {
      void analyzeTrackAudioInBackground(upcoming);
    }
    const plan = await recomputeActiveDjPlan();
    if (
      plan &&
      get().djMode.enabled &&
      djSessionEpoch === epoch &&
      upcoming &&
      upcoming.id !== get().currentTrack.id
    ) {
      void audioEngine.preloadNextDeck(upcoming, plan.cueInSec);
    }
  },

  toggleDjFx: (fx) => {
    const st = get();
    const currentToggles: DjFxToggles = {
      eq_swap: st.djMode.enabledTransitions?.eq_swap ?? true,
      filter_sweep: st.djMode.enabledTransitions?.filter_sweep ?? true,
      echo_out: st.djMode.enabledTransitions?.echo_out ?? true,
      vocal_over_beat: st.djMode.enabledTransitions?.vocal_over_beat ?? true,
      instrumental_bed: st.djMode.enabledTransitions?.instrumental_bed ?? true,
      loop_build: st.djMode.enabledTransitions?.loop_build ?? true,
    };
    const updated: DjFxToggles = {
      ...currentToggles,
      [fx]: !currentToggles[fx],
    };
    if (
      !updated.eq_swap &&
      !updated.filter_sweep &&
      !updated.echo_out &&
      !updated.vocal_over_beat &&
      !updated.instrumental_bed &&
      !updated.loop_build
    ) {
      updated.eq_swap = true;
    }
    const nextDjMode: DjModeConfig = {
      ...st.djMode,
      enabledTransitions: updated,
    };
    audioEngine.setDjMode(nextDjMode);
    set({ djMode: nextDjMode });
    void recomputeActiveDjPlan();
    persistPrefsFromStore();
  },

  triggerDjMixNow: async () => {
    const st = get();
    let target = getUpcomingDjTarget(st);
    if (!target && st.autoplayEnabled) {
      await st.replenishRecommendedQueue(true);
      target = getUpcomingDjTarget(get());
    }
    const nextTrack = target?.track;
    const nextIdx = target?.nextIdx ?? 0;
    if (!nextTrack) return;

    const fromAna =
      st.trackAnalyses[st.currentTrack.id] ??
      (await djPlanner.analyzeTrack(st.currentTrack.id, null, st.currentTrack.durationSec));
    const toAna =
      st.trackAnalyses[nextTrack.id] ??
      (await djPlanner.analyzeTrack(nextTrack.id, null, nextTrack.durationSec));

    const basePlan = djPlanner.planTransition(
      fromAna,
      toAna,
      st.djMode.style,
      st.djMode.preferredTransition,
      st.djMode.enabledTransitions
    );

    const interactiveDurationSec = Number(
      Math.max(4.5, Math.min(8.5, basePlan.transitionDurationSec)).toFixed(2)
    );
    await executeDjTransition(
      { ...basePlan, transitionDurationSec: interactiveDurationSec },
      nextTrack,
      nextIdx
    );
  },

  setSafeCrossfade: (patch) => {
    const st = get();
    const nextDuration = Math.max(
      0,
      Math.min(12, patch.durationSec ?? st.safeCrossfade.durationSec)
    );
    const nextEnabled =
      patch.enabled !== undefined
        ? patch.enabled
        : patch.durationSec !== undefined
          ? nextDuration > 0
          : st.safeCrossfade.enabled;
    const next: SafeCrossfadeConfig = {
      enabled: nextEnabled && nextDuration > 0,
      durationSec: nextDuration,
    };
    audioEngine.setSafeCrossfade(next);
    if (next.enabled && st.djMode.enabled) {
      const nextDj: DjModeConfig = { ...st.djMode, enabled: false };
      audioEngine.setDjMode(nextDj);
      set({
        safeCrossfade: next,
        djMode: nextDj,
        activeTransitionPlan: null,
      });
    } else {
      set({ safeCrossfade: next });
    }
    persistPrefsFromStore(true);
  },

  setEqPreset: (presetId) => {
    const preset = USER_EQ_PRESET_MAP[presetId] ?? USER_EQ_PRESET_MAP.flat;
    const nextEq: UserEqConfig = {
      enabled: true,
      preset: preset.id,
      bandsDb: [...preset.bandsDb] as UserEqBandsDb,
    };
    audioEngine.setUserEq(nextEq);
    set({ userEq: nextEq });
    persistPrefsFromStore();
  },

  setEqBandGain: (bandIndex, gainDb) => {
    const st = get();
    const bands = [...st.userEq.bandsDb] as UserEqBandsDb;
    if (bandIndex >= 0 && bandIndex < 5) {
      bands[bandIndex] = Math.max(-12, Math.min(12, gainDb));
    }
    const nextEq: UserEqConfig = {
      enabled: true,
      preset: 'custom',
      bandsDb: bands,
    };
    audioEngine.setUserEq(nextEq);
    set({ userEq: nextEq });
    persistPrefsFromStore();
  },

  setEqEnabled: (enabled) => {
    const st = get();
    const nextEq: UserEqConfig = {
      ...st.userEq,
      enabled,
    };
    audioEngine.setUserEq(nextEq);
    set({ userEq: nextEq });
    persistPrefsFromStore();
  },

  loadLyricsForTrack: async (track) => {
    const ticket = ++lyricsTicket;
    set({ currentLyrics: null, activeLyricIndex: -1, lyricsUserScrolled: false });

    const doc = await lyricsProvider.getLyrics({
      trackId: track.id,
      title: track.title,
      artist: track.artists[0]?.name ?? 'Artista',
      album: track.album?.name,
      durationSec: track.durationSec,
    });

    if (ticket !== lyricsTicket || get().currentTrack.id !== track.id) {
      return;
    }

    if (doc.status === 'not_found') {
      set({ currentLyrics: null, activeLyricIndex: -1, lyricsUserScrolled: false });
      return;
    }

    set({
      currentLyrics: doc,
      activeLyricIndex:
        doc.status === 'synced'
          ? lrcParser.findActiveLineIndex(doc.lines, get().positionSec * 1000)
          : -1,
      lyricsUserScrolled: false,
    });
  },

  setLyricsUserScrolled: (scrolled) => set({ lyricsUserScrolled: scrolled }),

  setSearchQuery: async (query, immediate = false) => {
    const trimmed = query.trim();
    const cacheKey = trimmed.toLowerCase();
    const cached = clientSearchCache.get(cacheKey);
    if (cached && Date.now() - cached.at < CLIENT_SEARCH_CACHE_TTL_MS) {
      ++searchTicket;
      set({
        searchQuery: query,
        autocompleteSuggestions: cached.suggestions,
        searchResults: cached.bundle,
        bestResult: cached.best,
        isSearching: false,
      });
      return;
    }

    set({ searchQuery: query, isSearching: true });
    const ticket = ++searchTicket;
    if (!immediate && trimmed) {
      await new Promise((r) => setTimeout(r, 120));
      if (ticket !== searchTicket) return;
    }
    try {
      const [rawBundle, remoteSuggestions] = await Promise.all([
        musicProvider.search(query, 'all'),
        trimmed.length >= 2
          ? musicProvider.getSearchSuggestions(query).catch(() => [] as string[])
          : Promise.resolve([] as string[]),
      ]);
      if (ticket !== searchTicket) return;
      const ranked = recommendationEngine.rankAutocomplete(query, remoteSuggestions);
      const bundle = recommendationEngine.rerankSearchBundle(query, rawBundle);
      const best = bundle.topResult ?? recommendationEngine.selectBestResult(query, bundle);
      clientSearchCache.set(cacheKey, {
        at: Date.now(),
        bundle,
        best,
        suggestions: ranked,
      });
      if (clientSearchCache.size > 60) {
        clientSearchCache.delete(clientSearchCache.keys().next().value as string);
      }
      set({
        autocompleteSuggestions: ranked,
        searchResults: bundle,
        bestResult: best,
        isSearching: false,
      });
    } catch {
      if (ticket === searchTicket) {
        set({ isSearching: false });
      }
    }
  },

  submitSearch: async (query) => {
    const q = (query ?? get().searchQuery).trim();
    if (q) {
      recommendationEngine.recordSearchQuery(q);
      set((prev) => ({
        recentSearches: [
          q,
          ...prev.recentSearches.filter((item) => item.toLowerCase() !== q.toLowerCase()),
        ].slice(0, 8),
      }));
    }
    await get().setSearchQuery(q, true);
  },

  setSearchScope: (scope) => set({ searchScope: scope }),

  clearRecentSearches: () => {
    recommendationEngine.clearRecentSearchQueries();
    set({ recentSearches: [] });
  },

  addRecentSearchTrack: (track) => {
    const entry: RecentSearchItem = {
      kind: 'track',
      id: `track:${track.id}`,
      track,
      addedAtMs: Date.now(),
    };
    const next = [
      entry,
      ...get().recentSearchItems.filter((item) => item.id !== entry.id),
    ].slice(0, 10);
    set({ recentSearchItems: next });
    persistRecentSearchItems(next);
  },

  addRecentSearchArtist: (artist) => {
    const entry: RecentSearchItem = {
      kind: 'artist',
      id: `artist:${artist.id}`,
      artistId: artist.id,
      name: artist.name,
      thumbnailUrl: artist.thumbnailUrl,
      addedAtMs: Date.now(),
    };
    const next = [
      entry,
      ...get().recentSearchItems.filter((item) => item.id !== entry.id),
    ].slice(0, 10);
    set({ recentSearchItems: next });
    persistRecentSearchItems(next);
  },

  removeRecentSearchItem: (id) => {
    const next = get().recentSearchItems.filter((item) => item.id !== id);
    set({ recentSearchItems: next });
    persistRecentSearchItems(next);
  },

  clearRecentSearchItems: () => {
    recommendationEngine.clearRecentSearchQueries();
    set({ recentSearches: [], recentSearchItems: [] });
    persistRecentSearchItems([]);
  },

  addSeedArtist: async (name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const current = recommendationEngine.getSeedArtists();
    const updated: SeedArtistConfig[] = [
      {
        artistKey: trimmed.toLowerCase(),
        displayName: trimmed,
        priorWeight: 8.0,
        genres: ['urbano_es'],
      },
      ...current.filter((s) => s.displayName.toLowerCase() !== trimmed.toLowerCase()),
    ];
    await recommendationEngine.updateSeedArtists(updated);
    const shelves = await recommendationEngine.buildHomeShelves();
    set({
      seedArtists: recommendationEngine.getSeedArtists(),
      affinityProfile: recommendationEngine.getAffinityProfile(),
      homeShelves: shelves,
    });
  },

  toggleFavoriteArtist: async (artist) => {
    const cleanName = artist.name.trim();
    const cleanId = artist.id.trim() || cleanName.toLowerCase();
    const current = get().favoriteArtists;
    const existing = current.find(
      (f) => f.artistId === cleanId || isArtistAliasMatch(f.artistName, cleanName)
    );
    let nextList: FavoriteArtistRecord[];
    let likedNow = false;
    if (existing) {
      nextList = current.filter(
        (f) => f.artistId !== existing.artistId && !isArtistAliasMatch(f.artistName, cleanName)
      );
      void syncEngine.removeFavoriteArtist?.(existing.artistId);
      get().showToast(`${cleanName} quitado de artistas favoritos`);
    } else {
      likedNow = true;
      const entry: FavoriteArtistRecord = {
        artistId: cleanId,
        artistName: cleanName,
        thumbnailUrl: artist.thumbnailUrl,
        likedAt: new Date().toISOString(),
      };
      nextList = [entry, ...current];
      void syncEngine.upsertFavoriteArtist?.(entry);
      get().showToast(`${cleanName} añadido a tus artistas favoritos`);
    }
    recommendationEngine.setFavoriteArtists(nextList);
    set({
      favoriteArtists: nextList,
      affinityProfile: recommendationEngine.getAffinityProfile(),
    });
    persistPrefsFromStore();
    void recommendationEngine.buildHomeShelves().then((shelves) => {
      set({ homeShelves: shelves });
      saveCachedHomeShelves(shelves, get().authState.userId);
    });
    return likedNow;
  },

  isArtistFavorite: (artistIdOrName) => {
    const list = get().favoriteArtists;
    return list.some(
      (f) => f.artistId === artistIdOrName || isArtistAliasMatch(f.artistName, artistIdOrName)
    );
  },

  setPlaylistShareMetadata: async (playlistId, patch) => {
    await libraryStore.updatePlaylist(playlistId, patch);
    set({ playlists: libraryStore.getPlaylists() });
    scheduleLibraryCloudSync();
  },

  setSocialSubTab: (tab) => set({ socialSubTab: tab }),
  setActiveJamCode: (code) => set({ activeJamCode: code }),
  setJamInviteModalOpen: (open) => set({ jamInviteModalOpen: open }),
  openJamView: () => {
    const st = get();
    if (st.activeJamSession) {
      set({ nowPlayingOpen: true, nowPlayingTab: 'Cola', jamInviteModalOpen: true });
      return;
    }
    if (st.authState.connected) {
      void st.startJam({ openSheet: true });
    } else {
      set({ activeTab: 'Social', socialSubTab: 'jam' });
    }
  },

  hydrateSocialAndSubscribe: async () => {
    const st = get();
    const sb = getSyncSupabaseClient();
    const myUserId = st.authState.userId;
    if (!sb || !myUserId || !st.authState.connected) return;

    try {
      if (!st.userProfile) {
        const ensured = await ensureOwnProfileExists(sb, {
          userId: myUserId,
          email: st.authState.email,
          displayName: st.authState.displayName,
          avatarUrl: st.authState.avatarUrl,
        });
        if (ensured) {
          set({ userProfile: ensured, needsProfileSetup: false });
          void writeCachedProfile(myUserId, ensured);
        }
      }
      const [fList, spList, hostJam] = await Promise.all([
        listFriendships(sb, myUserId),
        listSharedPlaylists(sb, myUserId),
        fetchActiveHostJamSession(sb, myUserId),
      ]);
      set({
        friends: fList,
        sharedPlaylists: spList,
      });
      void writeCachedSharedPlaylists(myUserId, spList);
      await syncSharedPlaylistsToLocalPlaylists(spList);
      syncUserLibraryContextToEngine();

      if (hostJam && (!get().activeJamSession || get().activeJamSession?.code === hostJam.code)) {
        const reqs = await fetchJamRequests(sb, hostJam.code);
        set({
          activeJamSession: hostJam,
          activeJamRole: 'host',
          activeJamCode: hostJam.code,
          activeJamRequests: reqs,
        });
        processIncomingHostJamRequests(reqs);
        subscribeJamRealtime(hostJam.code);
      }

      if (socialSubscribedUserId !== myUserId) {
        cleanupSocialRealtime();
        socialSubscribedUserId = myUserId;
        socialRealtimeChannel = sb
          .channel(`pmusic-social-rt:${myUserId}:${Date.now()}`)
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'friendships' },
            async () => {
              const cur = get();
              const prevList = cur.friends;
              const nextList = await listFriendships(sb, myUserId);
              for (const nf of nextList) {
                const old = prevList.find((of) => of.id === nf.id);
                if (!old && nf.isIncoming && nf.status === 'pending') {
                  cur.showToast(`Nueva solicitud de amistad de @${nf.otherProfile.username}`);
                } else if (old?.status === 'pending' && nf.status === 'accepted') {
                  cur.showToast(`¡@${nf.otherProfile.username} y tú ahora sois amigos!`);
                }
              }
              set({ friends: nextList });
            }
          )
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'shared_playlists' },
            async () => {
              const nextSp = await listSharedPlaylists(sb, myUserId);
              set({ sharedPlaylists: nextSp });
              await syncSharedPlaylistsToLocalPlaylists(nextSp);
            }
          )
          .subscribe();
      }

      if (friendPresenceUserId !== myUserId) {
        friendPresenceUserId = myUserId;
        friendPresenceReady = false;
        const syncPresenceMap = () => {
          if (!friendPresenceChannel) return;
          const stNow = get();
          const acceptedIds = new Set(
            stNow.friends
              .filter((f) => f.status === 'accepted')
              .map((f) => f.otherProfile.userId)
          );
          const rawState = (friendPresenceChannel.presenceState?.() ?? {}) as Record<
            string,
            Array<Partial<FriendListeningActivity>>
          >;
          const nextActivities: Record<string, FriendListeningActivity> = {};
          for (const entries of Object.values(rawState)) {
            for (const entry of entries ?? []) {
              const uid = entry?.userId;
              if (!uid || uid === myUserId || !acceptedIds.has(uid) || !entry.trackTitle) {
                continue;
              }
              const prev = nextActivities[uid];
              if (!prev || (entry.updatedAt ?? '') >= prev.updatedAt) {
                nextActivities[uid] = {
                  userId: uid,
                  username: entry.username,
                  displayName: entry.displayName,
                  avatarUrl: entry.avatarUrl,
                  trackId: entry.trackId ?? uid,
                  trackTitle: entry.trackTitle,
                  trackArtist: entry.trackArtist ?? '',
                  thumbnailUrl: entry.thumbnailUrl,
                  isPlaying: entry.isPlaying !== false,
                  updatedAt: entry.updatedAt ?? new Date().toISOString(),
                };
              }
            }
          }
          set({ friendActivities: nextActivities });
        };

        friendPresenceChannel = sb
          .channel('pmusic-friends-presence-v1')
          .on('presence', { event: 'sync' }, syncPresenceMap)
          .on('presence', { event: 'join' }, syncPresenceMap)
          .on('presence', { event: 'leave' }, syncPresenceMap)
          .subscribe((status: string) => {
            if (status === 'SUBSCRIBED') {
              friendPresenceReady = true;
              syncOwnListeningPresence();
              syncPresenceMap();
            }
          });
      }
    } catch {
      // ignore offline social sync failure
    }
  },

  startJam: async (opts) => {
    const st = get();
    const sb = getSyncSupabaseClient();
    const myUserId = st.authState.userId;
    if (!sb || !myUserId || !st.authState.connected) {
      st.showToast('Inicia sesión para iniciar una Jam');
      set({ authOnboardingOpen: true });
      return null;
    }
    const existing = await fetchActiveHostJamSession(sb, myUserId);
    if (existing) {
      const reqs = await fetchJamRequests(sb, existing.code);
      set({
        activeJamSession: existing,
        activeJamRole: 'host',
        activeJamCode: existing.code,
        activeJamRequests: reqs,
        ...(opts?.openSheet !== false
          ? { nowPlayingOpen: true, nowPlayingTab: 'Cola' as const, jamInviteModalOpen: true }
          : {}),
      });
      subscribeJamRealtime(existing.code);
      return existing;
    }

    const identity = getOwnAdderIdentity();
    await ensureOwnProfileExists(sb, {
      userId: myUserId,
      email: st.authState.email,
      displayName: identity.displayName,
      avatarUrl: identity.avatarUrl,
    });

    const stampedQueue = st.queue.slice(Math.max(0, st.queueIndex)).map((t) =>
      t.addedBy?.displayName ? t : stampTrackAddedBy(t, identity)
    );
    const created = await createJamSession(sb, {
      hostUserId: myUserId,
      hostName: identity.displayName,
      currentTrack: st.currentTrack.addedBy?.displayName
        ? st.currentTrack
        : stampTrackAddedBy(st.currentTrack, identity),
      queue: stampedQueue,
      isPlaying: st.isPlaying,
      allowGuestDirectAdd: opts?.allowGuestDirectAdd ?? true,
      maxRequestsPerGuest: opts?.maxRequestsPerGuest ?? 0,
    });
    processedJamRequestIds.clear();
    set({
      activeJamSession: created,
      activeJamRole: 'host',
      activeJamCode: created.code,
      activeJamRequests: [],
      ...(opts?.openSheet !== false
        ? { nowPlayingOpen: true, nowPlayingTab: 'Cola' as const, jamInviteModalOpen: true }
        : {}),
    });
    subscribeJamRealtime(created.code);
    st.showToast(`Jam ${created.code} iniciada`);
    return created;
  },

  joinJamInApp: async (code) => {
    const cleanCode = code.trim().toUpperCase().replace(/^.*\/JAM\//i, '').replace(/[^A-Z0-9]/g, '');
    if (cleanCode.length < 4) {
      get().showToast('Introduce un código de Jam válido');
      return null;
    }
    const [sess, reqs] = await Promise.all([
      fetchPublicJamSession(cleanCode),
      fetchPublicJamRequests(cleanCode),
    ]);
    if (!sess || !sess.active) {
      get().showToast(`La Jam ${cleanCode} no existe o ya terminó`);
      return null;
    }
    const st = get();
    const isOwnHost = Boolean(st.authState.userId && sess.hostUserId === st.authState.userId);
    set({
      activeJamSession: sess,
      activeJamRole: isOwnHost ? 'host' : 'guest',
      activeJamCode: sess.code,
      activeJamRequests: reqs,
      nowPlayingOpen: true,
      nowPlayingTab: 'Cola',
      jamInviteModalOpen: false,
      ...(sess.currentTrack && !st.isPlaying
        ? {
            currentTrack: sess.currentTrack,
            queue: sess.queue.length > 0 ? sess.queue : [sess.currentTrack],
            queueIndex: 0,
            durationSec: sess.currentTrack.durationSec,
          }
        : {}),
    });
    subscribeJamRealtime(sess.code);
    get().showToast(`Conectado a la Jam de ${sess.hostName} (${sess.code})`);
    return sess;
  },

  leaveOrEndJam: async (reason) => {
    const st = get();
    const sb = getSyncSupabaseClient();
    const sess = st.activeJamSession;
    const role = st.activeJamRole;
    cleanupJamRealtime();
    if (sb && sess && role === 'host') {
      await updateJamSessionState(sb, sess.code, { active: false }).catch(() => {});
      st.showToast(reason ?? 'Sala Jam finalizada');
    } else if (sess) {
      st.showToast(reason ?? 'Saliste de la Jam');
    }
    set({
      activeJamSession: null,
      activeJamRole: null,
      activeJamCode: null,
      activeJamRequests: [],
      jamInviteModalOpen: false,
    });
  },

  checkJamIdleAutoEnd: async (nowMs) => runJamIdleAutoEndCheck(nowMs),

  addTrackToActiveJam: async (rawTrack, playNext = false) => {
    const st = get();
    const sess = st.activeJamSession;
    if (!sess) {
      if (playNext) st.playNextInQueue(rawTrack);
      else st.addToQueue(rawTrack);
      return;
    }
    const identity = getOwnAdderIdentity();
    const stamped = stampTrackAddedBy(canonicalizeTrackArtists(rawTrack), identity);
    if (st.activeJamRole === 'host') {
      if (playNext) st.playNextInQueue(stamped);
      else st.addToQueue(stamped);
      pushHostJamStateSoon();
      return;
    }
    if (playNext && sess.allowGuestDirectAdd) {
      await st.modifyJamQueueAsGuest('add_next', stamped.id, 0, stamped);
      return;
    }
    const created = await submitPublicJamRequest(
      sess.code,
      identity.displayName,
      stamped,
      sess.allowGuestDirectAdd,
      identity
    );
    set((prev) => ({
      activeJamRequests: [created, ...prev.activeJamRequests],
      ...(sess.allowGuestDirectAdd && prev.activeJamSession
        ? {
            activeJamSession: {
              ...prev.activeJamSession,
              queue: prev.activeJamSession.queue.some((q) => q.id === stamped.id)
                ? prev.activeJamSession.queue
                : [...prev.activeJamSession.queue, stamped],
            },
          }
        : {}),
    }));
    st.showToast(
      sess.allowGuestDirectAdd
        ? `«${stamped.title}» añadida a la cola de la Jam`
        : `«${stamped.title}» enviada para aprobación`
    );
  },

  modifyJamQueueAsGuest: async (op, targetTrackId, toUpNextIndex, rawTrack) => {
    const st = get();
    const sess = st.activeJamSession;
    if (!sess || !sess.active) return;
    const identity = getOwnAdderIdentity();
    const curTrackId = sess.currentTrack?.id ?? st.currentTrack.id;
    const upNext = sess.queue.filter((t) => t.id !== curTrackId);
    const currentHead = sess.queue.filter((t) => t.id === curTrackId);
    let nextUp = [...upNext];

    if (op === 'move') {
      const fromIdx = nextUp.findIndex((t) => t.id === targetTrackId);
      if (fromIdx >= 0) {
        const destIdx = Math.max(0, Math.min(nextUp.length - 1, toUpNextIndex ?? Math.max(0, fromIdx - 1)));
        const [moved] = nextUp.splice(fromIdx, 1);
        if (moved) nextUp.splice(destIdx, 0, moved);
      }
    } else if (op === 'remove') {
      nextUp = nextUp.filter((t) => t.id !== targetTrackId);
    } else if (op === 'add_next' && rawTrack) {
      const stamped = stampTrackAddedBy(canonicalizeTrackArtists(rawTrack), identity);
      nextUp = [stamped, ...nextUp.filter((t) => t.id !== stamped.id)];
    }

    const updatedQueue = [...currentHead, ...nextUp];
    set((prev) => ({
      activeJamSession: prev.activeJamSession
        ? { ...prev.activeJamSession, queue: updatedQueue }
        : prev.activeJamSession,
      queue: updatedQueue,
    }));

    const payloadTrack = rawTrack ? stampTrackAddedBy(canonicalizeTrackArtists(rawTrack), identity) : undefined;
    try {
      await submitPublicJamQueueOp(sess.code, identity.displayName, {
        __jamOp: op,
        targetTrackId,
        ...(typeof toUpNextIndex === 'number' ? { toUpNextIndex } : {}),
        ...(payloadTrack ? { track: payloadTrack } : {}),
      });
      if (op === 'add_next' && payloadTrack) {
        st.showToast(`«${payloadTrack.title}» sonará a continuación en la Jam`);
      } else if (op === 'remove') {
        st.showToast('Canción quitada de la cola de la Jam');
      }
    } catch {
      // keep optimistic UI if transient network issue
    }
  },

  approveJamRequest: async (req) => {
    const sb = getSyncSupabaseClient();
    if (!sb) return;
    await updateJamRequestStatus(sb, req.id, 'approved');
    processedJamRequestIds.add(req.id);
    if (req.track?.id) {
      const stamped = req.track.addedBy?.displayName
        ? req.track
        : stampTrackAddedBy(req.track, {
            displayName: req.guestName || 'Invitado',
            avatarUrl: req.track.addedBy?.avatarUrl ?? null,
          });
      get().addToQueue(stamped);
    }
    set((prev) => ({
      activeJamRequests: prev.activeJamRequests.map((item) =>
        item.id === req.id ? { ...item, status: 'approved' } : item
      ),
    }));
  },

  rejectJamRequest: async (req) => {
    const sb = getSyncSupabaseClient();
    if (!sb) return;
    await updateJamRequestStatus(sb, req.id, 'rejected');
    set((prev) => ({
      activeJamRequests: prev.activeJamRequests.map((item) =>
        item.id === req.id ? { ...item, status: 'rejected' } : item
      ),
    }));
  },

  updateJamSettings: async (patch) => {
    const st = get();
    const sb = getSyncSupabaseClient();
    if (!sb || !st.activeJamSession || st.activeJamRole !== 'host') return;
    const nextSess: JamSessionRecord = {
      ...st.activeJamSession,
      ...(patch.allowGuestDirectAdd !== undefined
        ? { allowGuestDirectAdd: patch.allowGuestDirectAdd }
        : {}),
      ...(patch.maxRequestsPerGuest !== undefined
        ? { maxRequestsPerGuest: patch.maxRequestsPerGuest }
        : {}),
    };
    set({ activeJamSession: nextSess });
    await updateJamSessionState(sb, nextSess.code, patch);
  },

  sendFriendRequestToUser: async (targetUserId) => {
    const st = get();
    const sb = getSyncSupabaseClient();
    if (!sb || !st.authState.userId) return;
    await sendFriendRequest(sb, st.authState.userId, targetUserId);
    const fList = await listFriendships(sb, st.authState.userId);
    set({ friends: fList });
  },

  respondToFriendRequest: async (friendshipId, status, username) => {
    const st = get();
    const sb = getSyncSupabaseClient();
    if (!sb || !st.authState.userId) return;
    await respondFriendRequest(sb, friendshipId, status);
    const fList = await listFriendships(sb, st.authState.userId);
    set({ friends: fList });
    if (status === 'accepted' && username) {
      st.showToast(`Ahora eres amigo de @${username}`);
    }
  },

  togglePlaylistCollaborative: async (playlistId) => {
    const st = get();
    const pl = st.playlists.find((p) => p.id === playlistId);
    if (!pl) return null;
    const nextCollab = !pl.isCollaborative;
    const sb = getSyncSupabaseClient();
    if (!sb || !st.authState.connected || !st.authState.userId) {
      await st.setPlaylistShareMetadata(playlistId, { isCollaborative: nextCollab });
      st.showToast(nextCollab ? 'Playlist marcada como colaborativa' : 'Modo solo lectura activado');
      return null;
    }
    const synced = await publishOrUpdateSharedPlaylistLink(sb, {
      ownerId: st.authState.userId,
      name: pl.name,
      description: pl.description,
      tracks: pl.tracks,
      isCollaborative: nextCollab,
      existingShareCode: pl.shareCode,
      ownerProfile: st.userProfile,
    });
    await st.setPlaylistShareMetadata(playlistId, {
      shareCode: synced.shareCode ?? pl.shareCode,
      isCollaborative: nextCollab,
      isPublicLink: true,
    });
    const nextShared = [
      synced,
      ...st.sharedPlaylists.filter((s) => s.id !== synced.id),
    ];
    set({ sharedPlaylists: nextShared });
    await syncSharedPlaylistsToLocalPlaylists(nextShared);
    st.showToast(
      nextCollab
        ? 'Playlist colaborativa activada — ¡invita a amigos o comparte el enlace!'
        : 'Playlist cambiada a solo lectura'
    );
    return synced;
  },

  inviteFriendToPlaylist: async (playlistIdOrSharedId, friendUserId) => {
    const st = get();
    const sb = getSyncSupabaseClient();
    if (!sb || !st.authState.connected || !st.authState.userId) {
      st.showToast('Inicia sesión para invitar colaboradores');
      return null;
    }
    let shared =
      st.sharedPlaylists.find((s) => s.id === playlistIdOrSharedId) ?? null;
    if (!shared) {
      const local = st.playlists.find((p) => p.id === playlistIdOrSharedId);
      if (local) {
        if (local.shareCode) {
          shared =
            st.sharedPlaylists.find(
              (s) => s.shareCode?.toUpperCase() === local.shareCode?.toUpperCase()
            ) ?? null;
        }
        if (!shared) {
          shared = await publishOrUpdateSharedPlaylistLink(sb, {
            ownerId: st.authState.userId,
            name: local.name,
            description: local.description,
            tracks: local.tracks,
            isCollaborative: true,
            existingShareCode: local.shareCode,
            ownerProfile: st.userProfile,
          });
          await st.setPlaylistShareMetadata(local.id, {
            shareCode: shared.shareCode ?? local.shareCode,
            isCollaborative: true,
            isPublicLink: true,
          });
        }
      }
    }
    if (!shared) return null;
    const updated = await inviteMemberToSharedPlaylist(sb, shared, friendUserId);
    set((prev) => ({
      sharedPlaylists: [
        updated,
        ...prev.sharedPlaylists.filter((item) => item.id !== updated.id),
      ],
    }));
    const friend = st.friends.find((f) => f.otherProfile.userId === friendUserId);
    st.showToast(
      friend
        ? `@${friend.otherProfile.username} añadido como colaborador`
        : 'Colaborador añadido al instante'
    );
    return updated;
  },

  createCollaborativePlaylist: async (name, friendIds = [], initialTracks = []) => {
    const st = get();
    const sb = getSyncSupabaseClient();
    if (!sb || !st.authState.userId) return null;
    const created = await createSharedPlaylist(sb, {
      ownerId: st.authState.userId,
      name: name.trim(),
      description: 'Playlist colaborativa en pMusic',
      kind: 'collab',
      memberIds: friendIds,
      tracks: initialTracks,
      isPublicLink: true,
      allowLinkEdit: true,
      ownerProfile: st.userProfile,
    });
    set((prev) => ({
      sharedPlaylists: [created, ...prev.sharedPlaylists.filter((s) => s.id !== created.id)],
    }));
    syncUserLibraryContextToEngine();
    st.showToast(`Playlist colaborativa «${created.name}» creada`);
    return created;
  },

  createBlendWithFriend: async (friend) => {
    const st = get();
    const sb = getSyncSupabaseClient();
    if (!sb || !st.authState.userId) return null;
    const baseTracks = [...st.likedTracks.map((l) => l.track), ...st.queue];
    const { score, tracks } = computeBlendScoreAndTracks(baseTracks, friend.otherProfile.username);
    const created = await createSharedPlaylist(sb, {
      ownerId: st.authState.userId,
      name: `Blend · ${st.userProfile?.displayName || 'Tú'} + ${friend.otherProfile.displayName}`,
      description: `Mezcla automática con @${friend.otherProfile.username} (${score}% de compatibilidad)`,
      kind: 'blend',
      memberIds: [friend.otherProfile.userId],
      tracks,
      compatibilityScore: score,
      ownerProfile: st.userProfile,
    });
    set((prev) => ({
      sharedPlaylists: [created, ...prev.sharedPlaylists.filter((s) => s.id !== created.id)],
    }));
    st.showToast(`Blend creado (${score}% de match)`);
    return created;
  },

  addTrackToCollaborativePlaylist: async (sharedId, track) => {
    const st = get();
    const sb = getSyncSupabaseClient();
    const target = st.sharedPlaylists.find((s) => s.id === sharedId);
    if (!sb || !target) return;
    const identity = getOwnAdderIdentity();
    const updated = await addTrackToSharedPlaylist(sb, target, canonicalizeTrackArtists(track), identity);
    set((prev) => ({
      sharedPlaylists: prev.sharedPlaylists.map((item) =>
        item.id === updated.id ? updated : item
      ),
    }));
    await syncSharedPlaylistsToLocalPlaylists([updated]);
    st.showToast(`«${track.title}» añadida por ${identity.displayName}`);
  },

  removeTrackFromCollaborativePlaylist: async (sharedId, trackId) => {
    const st = get();
    const sb = getSyncSupabaseClient();
    const target = st.sharedPlaylists.find((s) => s.id === sharedId);
    if (!sb || !target) return;
    const updated = await removeTrackFromSharedPlaylist(sb, target, trackId);
    set((prev) => ({
      sharedPlaylists: prev.sharedPlaylists.map((item) =>
        item.id === updated.id ? updated : item
      ),
    }));
    await syncSharedPlaylistsToLocalPlaylists([updated]);
    st.showToast('Eliminada de la playlist colaborativa');
  },

  joinSharedPlaylistLink: async (shareCode) => {
    const st = get();
    const sb = getSyncSupabaseClient();
    const found = await fetchSharedPlaylistByCode(shareCode, sb);
    if (!found) return null;
    if (sb && st.authState.connected && st.authState.userId && found.allowLinkEdit) {
      const joined = await joinSharedPlaylistByCode(sb, found, st.authState.userId);
      set((prev) => ({
        sharedPlaylists: [joined, ...prev.sharedPlaylists.filter((s) => s.id !== joined.id)],
      }));
      await syncSharedPlaylistsToLocalPlaylists([joined]);
      return joined;
    }
    return found;
  },

  updateUserProfile: async (input) => {
    const st = get();
    const currentUsername =
      input.username?.trim().toLowerCase().replace(/^@+/, '') ||
      st.userProfile?.username ||
      (st.authState.email?.split('@')[0] ?? 'usuario')
        .toLowerCase()
        .replace(/[^a-z0-9._]/g, '_')
        .slice(0, 20) ||
      `user_${Math.random().toString(36).slice(2, 6)}`;
    const safeUsername = /^[a-z0-9._]{3,24}$/.test(currentUsername)
      ? currentUsername
      : `pm_${Math.random().toString(36).slice(2, 8)}`;
    const updated = await syncEngine.upsertProfile!({
      username: safeUsername,
      displayName: input.displayName,
      avatarUrl: input.avatarUrl !== undefined ? input.avatarUrl : (st.userProfile?.avatarUrl ?? null),
    });
    set({
      userProfile: updated,
      authState: syncEngine.getAuthState(),
      needsProfileSetup: false,
    });
    void writeCachedProfile(updated.userId, updated);
    void syncEngine
      .rememberCurrentAccountSession({
        username: updated.username,
        displayName: updated.displayName,
        avatarUrl: updated.avatarUrl,
      })
      .then((slots) => set({ savedAccounts: slots }));
    get().showToast('Perfil actualizado en pMusic');
    return updated;
  },

  removeSeedArtist: async (artistKey) => {
    const current = recommendationEngine.getSeedArtists();
    const updated = current.filter((s) => s.artistKey !== artistKey);
    await recommendationEngine.updateSeedArtists(updated);
    set({
      seedArtists: recommendationEngine.getSeedArtists(),
      affinityProfile: recommendationEngine.getAffinityProfile(),
    });
  },

  resetTasteProfile: async () => {
    await recommendationEngine.resetTastes();
    const shelves = await recommendationEngine.buildHomeShelves();
    set({
      seedArtists: recommendationEngine.getSeedArtists(),
      affinityProfile: recommendationEngine.getAffinityProfile(),
      playHistory: [],
      homeShelves: shelves,
    });
  },

  refreshHomeRecommendations: async (clearHistory = false) => {
    if (clearHistory) {
      await recommendationEngine.clearPlayHistory();
      await libraryStore.setPlayHistory([]);
    }
    syncUserLibraryContextToEngine();
    const rawShelves = await recommendationEngine.buildHomeShelves();
    const ownerForRefresh = get().authState.connected ? get().authState.userId : null;
    const mergedRaw = clearHistory
      ? rawShelves
      : mergeProtectedEditorialShelves(get().homeShelves, rawShelves);
    const shelves = syncEditorialMixesFromShelves(mergedRaw, ownerForRefresh, {
      forceReset: clearHistory,
      markDescubreScan: true,
    });
    saveCachedHomeShelves(shelves, ownerForRefresh);
    if (get().authState.connected) persistPrefsFromStore();
    const allRealTracks = Array.from(
      new Map(shelves.flatMap((s) => s.tracks ?? []).map((t) => [t.id, t])).values()
    );
    set((prev) => ({
      playHistory: libraryStore.getPlayHistory(),
      affinityProfile: recommendationEngine.getAffinityProfile(),
      homeShelves: shelves,
      ...(allRealTracks.length > 0 && !prev.isPlaying
        ? {
            currentTrack: allRealTracks[0]!,
            queue: allRealTracks.slice(0, 10),
            recommendedQueue: allRealTracks.slice(10, 20),
            queueIndex: 0,
            durationSec: allRealTracks[0]!.durationSec,
            positionSec: 0,
          }
        : {}),
    }));
    get().showToast(
      clearHistory
        ? 'Historial y recomendaciones de inicio reiniciados'
        : 'Recomendaciones de inicio actualizadas'
    );
  },

  setLibraryCategory: (cat) => set({ libraryCategory: cat }),
  setLibraryFilterQuery: (q) => set({ libraryFilterQuery: q }),

  recordPlaylistPlay: (playlist) => {
    const key = normalizePlaylistStatKey(playlist.name);
    if (!key) return;
    set((prev) => {
      const existing = prev.playlistPlayCounts[key];
      return {
        playlistPlayCounts: {
          ...prev.playlistPlayCounts,
          [key]: {
            name: playlist.name,
            count: (existing?.count ?? 0) + 1,
            lastPlayedAt: Date.now(),
          },
        },
      };
    });
    persistPrefsFromStore();
  },

  createPlaylist: async (name, description, tracks) => {
    const created = await libraryStore.createPlaylist({
      name,
      description,
      tracks,
    });
    set({ playlists: libraryStore.getPlaylists() });
    syncUserLibraryContextToEngine();
    scheduleLibraryCloudSync();
    return created;
  },

  renamePlaylist: async (playlistId, name) => {
    await libraryStore.updatePlaylist(playlistId, { name });
    set({ playlists: libraryStore.getPlaylists() });
    scheduleLibraryCloudSync();
  },

  deletePlaylist: async (playlistId) => {
    const st = get();
    const existing = st.playlists.find((p) => p.id === playlistId);
    const linkedShared = existing?.shareCode
      ? st.sharedPlaylists.find(
          (s) => s.shareCode?.toUpperCase() === existing.shareCode?.toUpperCase()
        )
      : undefined;

    await libraryStore.deletePlaylist(playlistId);

    const sb = getSyncSupabaseClient();
    if (sb && linkedShared && st.authState.connected && st.authState.userId) {
      await deleteOrLeaveSharedPlaylist(sb, linkedShared, st.authState.userId).catch(() => {});
    }

    set((prev) => {
      const nextApps = { ...prev.playlistAppearances };
      delete nextApps[playlistId];
      if (linkedShared) delete nextApps[linkedShared.id];

      const isViewingDeletedLocal =
        prev.activeDetailView?.kind === 'local_playlist' &&
        prev.activeDetailView.playlistId === playlistId;
      const isViewingDeletedShared =
        Boolean(linkedShared) &&
        prev.activeDetailView?.kind === 'shared_playlist' &&
        prev.activeDetailView.sharedId === linkedShared!.id;

      return {
        ...(isMobileHardwareVolumeRuntime() ? { volume: 1.0 } : {}),
        playlists: libraryStore.getPlaylists(),
        sharedPlaylists: linkedShared
          ? prev.sharedPlaylists.filter((s) => s.id !== linkedShared.id)
          : prev.sharedPlaylists,
        playlistAppearances: nextApps,
        activeDetailView:
          isViewingDeletedLocal || isViewingDeletedShared ? null : prev.activeDetailView,
        detailViewHistory: prev.detailViewHistory.filter(
          (v) =>
            !(v.kind === 'local_playlist' && v.playlistId === playlistId) &&
            !(linkedShared && v.kind === 'shared_playlist' && v.sharedId === linkedShared.id)
        ),
        playlistContextMenu:
          prev.playlistContextMenu?.playlistId === playlistId ? null : prev.playlistContextMenu,
      };
    });
    syncUserLibraryContextToEngine();
    scheduleLibraryCloudSync();
    persistPrefsFromStore();
    get().showToast('Playlist eliminada');
  },

  deleteOrLeaveSharedPlaylistById: async (sharedId) => {
    const st = get();
    const target = st.sharedPlaylists.find((s) => s.id === sharedId);
    if (!target) return;

    const sb = getSyncSupabaseClient();
    let action: 'deleted' | 'left' =
      target.ownerId === st.authState.userId ? 'deleted' : 'left';
    if (sb && st.authState.connected && st.authState.userId) {
      action = await deleteOrLeaveSharedPlaylist(sb, target, st.authState.userId).catch(
        () => action
      );
    }

    const mirroredLocal = target.shareCode
      ? st.playlists.find(
          (p) => p.shareCode?.toUpperCase() === target.shareCode?.toUpperCase()
        )
      : undefined;
    if (mirroredLocal) {
      await libraryStore.deletePlaylist(mirroredLocal.id);
    }

    set((prev) => {
      const nextApps = { ...prev.playlistAppearances };
      delete nextApps[sharedId];
      if (mirroredLocal) delete nextApps[mirroredLocal.id];
      const isViewingDeleted =
        (prev.activeDetailView?.kind === 'shared_playlist' &&
          prev.activeDetailView.sharedId === sharedId) ||
        (Boolean(mirroredLocal) &&
          prev.activeDetailView?.kind === 'local_playlist' &&
          prev.activeDetailView.playlistId === mirroredLocal!.id);
      return {
        sharedPlaylists: prev.sharedPlaylists.filter((s) => s.id !== sharedId),
        playlists: libraryStore.getPlaylists(),
        playlistAppearances: nextApps,
        activeDetailView: isViewingDeleted ? null : prev.activeDetailView,
        detailViewHistory: prev.detailViewHistory.filter(
          (v) =>
            !(v.kind === 'shared_playlist' && v.sharedId === sharedId) &&
            !(mirroredLocal && v.kind === 'local_playlist' && v.playlistId === mirroredLocal.id)
        ),
        playlistContextMenu:
          prev.playlistContextMenu?.playlistId === sharedId ? null : prev.playlistContextMenu,
      };
    });
    syncUserLibraryContextToEngine();
    scheduleLibraryCloudSync();
    persistPrefsFromStore();
    get().showToast(
      action === 'deleted' ? 'Playlist eliminada' : 'Has salido de la lista colaborativa'
    );
  },

  openPlaylistContextMenu: (kind, playlistId, x, y) => {
    set({ playlistContextMenu: { kind, playlistId, x, y }, trackMenu: null });
  },

  closePlaylistContextMenu: () => set({ playlistContextMenu: null }),

  openPlaylistAppearanceModal: (kind, playlistId) => {
    set({ playlistAppearanceModal: { kind, playlistId }, playlistContextMenu: null });
  },

  closePlaylistAppearanceModal: () => set({ playlistAppearanceModal: null }),

  updatePlaylistAppearance: async (kind, playlistId, patch) => {
    const prevApp = get().playlistAppearances[playlistId] ?? {};
    const nextApp: PlaylistAppearanceEntry = {
      ...prevApp,
      ...(patch.coverUrl !== undefined ? { coverUrl: patch.coverUrl || null } : {}),
      ...(patch.bannerUrl !== undefined ? { bannerUrl: patch.bannerUrl || null } : {}),
      ...(patch.bannerEnabled !== undefined ? { bannerEnabled: patch.bannerEnabled } : {}),
      ...(patch.coverStyleSeed !== undefined ? { coverStyleSeed: patch.coverStyleSeed } : {}),
    };

    if (kind === 'local') {
      await libraryStore.updatePlaylist(playlistId, {
        ...(patch.coverUrl !== undefined ? { coverUrl: patch.coverUrl ?? '' } : {}),
        ...(patch.bannerUrl !== undefined ? { bannerUrl: patch.bannerUrl } : {}),
        ...(patch.bannerEnabled !== undefined ? { bannerEnabled: patch.bannerEnabled } : {}),
        ...(patch.coverStyleSeed !== undefined ? { coverStyleSeed: patch.coverStyleSeed } : {}),
      });
      set((prev) => ({
        playlists: libraryStore.getPlaylists(),
        playlistAppearances: {
          ...prev.playlistAppearances,
          [playlistId]: nextApp,
        },
      }));
    } else {
      set((prev) => ({
        playlistAppearances: {
          ...prev.playlistAppearances,
          [playlistId]: nextApp,
        },
      }));
    }
    scheduleLibraryCloudSync(true);
    persistPrefsFromStore(true);
  },

  downloadPlaylistOffline: async (playlistId, tracks, playlistName) => {
    const st = get();
    const nextAutoIds = st.offlineAutoPlaylistIds.includes(playlistId)
      ? st.offlineAutoPlaylistIds
      : [...st.offlineAutoPlaylistIds, playlistId];
    if (nextAutoIds !== st.offlineAutoPlaylistIds) {
      writeOfflineAutoPlaylistIds(nextAutoIds);
      set({ offlineAutoPlaylistIds: nextAutoIds });
    }

    const pending = tracks.filter(
      (t) => Boolean(t?.id) && st.offlineDownloads[t.id] !== 'downloaded'
    );
    if (pending.length === 0) {
      st.showToast(
        playlistName
          ? `«${playlistName}» ya está descargada offline`
          : 'Playlist ya descargada offline'
      );
      return;
    }

    if (st.wifiOnlyDownloads && isMeteredOrCellularNetwork()) {
      st.showToast('Descargas pausadas: modo Solo Wi-Fi activo');
      return;
    }

    activePlaylistDownloadCancelled = false;
    set({
      playlistDownloadProgress: { playlistId, completed: 0, total: pending.length },
    });

    let completed = 0;
    let nextIdx = 0;
    const concurrency = 2;

    const worker = async () => {
      while (!activePlaylistDownloadCancelled) {
        const idx = nextIdx++;
        if (idx >= pending.length) break;
        const track = pending[idx]!;
        try {
          await get().downloadTrackOffline(track);
        } catch {
          // downloadTrackOffline records per-track error state safely
        }
        completed++;
        if (!activePlaylistDownloadCancelled) {
          set({
            playlistDownloadProgress: {
              playlistId,
              completed,
              total: pending.length,
            },
          });
        }
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(concurrency, pending.length) }, () => worker())
    );

    const wasCancelled = activePlaylistDownloadCancelled;
    activePlaylistDownloadCancelled = false;
    set({ playlistDownloadProgress: null });
    if (!wasCancelled) {
      get().showToast(
        playlistName
          ? `Playlist «${playlistName}» descargada offline`
          : 'Playlist descargada offline'
      );
    }
  },

  cancelPlaylistDownload: () => {
    activePlaylistDownloadCancelled = true;
    set({ playlistDownloadProgress: null });
    get().showToast('Descarga de playlist cancelada');
  },

  duplicatePlaylist: async (playlistId) => {
    const src = get().playlists.find((p) => p.id === playlistId);
    if (!src) return null;
    const created = await libraryStore.createPlaylist({
      name: `${src.name} (copia)`,
      description: src.description,
      tracks: [...src.tracks],
    });
    set({ playlists: libraryStore.getPlaylists() });
    scheduleLibraryCloudSync();
    get().showToast(`Playlist «${created.name}» creada`);
    return created;
  },

  copyPlaylistTracksTo: async (sourcePlaylistId, targetPlaylistId) => {
    const src = get().playlists.find((p) => p.id === sourcePlaylistId);
    const dst = get().playlists.find((p) => p.id === targetPlaylistId);
    if (!src || !dst) return 0;
    let added = 0;
    for (const track of src.tracks) {
      if (!dst.tracks.some((ex) => ex.id === track.id)) {
        await libraryStore.addTrackToPlaylist(dst.id, track);
        added++;
      }
    }
    set({ playlists: libraryStore.getPlaylists() });
    if (added > 0) scheduleLibraryCloudSync();
    get().showToast(
      added > 0
        ? `${added} ${added === 1 ? 'pista añadida' : 'pistas añadidas'} a «${dst.name}»`
        : `Todas las canciones ya estaban en «${dst.name}»`
    );
    return added;
  },

  addTrackToPlaylist: async (playlistId, track) => {
    const existing = get().playlists.find((p) => p.id === playlistId);
    const stamped = existing?.isCollaborative
      ? stampTrackAddedBy(canonicalizeTrackArtists(track), getOwnAdderIdentity())
      : canonicalizeTrackArtists(track);
    const dupKey = getTrackDuplicateKey(stamped);
    const alreadyIn = Boolean(
      existing?.tracks.some(
        (t) => t.id === stamped.id || (dupKey !== '::' && getTrackDuplicateKey(t) === dupKey)
      )
    );
    if (alreadyIn) {
      if (existing) {
        get().showToast(`Ya estaba en «${existing.name}»`);
      }
      return;
    }
    await libraryStore.addTrackToPlaylist(playlistId, stamped);
    await recommendationEngine.recordSignal(stamped, 'add_to_playlist');
    scheduleLibraryCloudSync();
    const sb = getSyncSupabaseClient();
    const st = get();
    if (sb && existing?.isCollaborative && existing.shareCode && st.authState.connected) {
      const linked = st.sharedPlaylists.find(
        (s) => s.shareCode?.toUpperCase() === existing.shareCode?.toUpperCase()
      );
      if (linked) {
        void addTrackToSharedPlaylist(sb, linked, stamped, getOwnAdderIdentity()).then((updated) => {
          set((prev) => ({
            sharedPlaylists: prev.sharedPlaylists.map((item) =>
              item.id === updated.id ? updated : item
            ),
          }));
        }).catch(() => {});
      }
    }
    set({
      playlists: libraryStore.getPlaylists(),
      affinityProfile: recommendationEngine.getAffinityProfile(),
    });
    syncUserLibraryContextToEngine();
    if (existing) {
      get().showToast(`Añadida a «${existing.name}»`);
    }
    if (
      st.offlineAutoPlaylistIds.includes(playlistId) &&
      !(st.wifiOnlyDownloads && isMeteredOrCellularNetwork())
    ) {
      void get().downloadTrackOffline(stamped, { silent: true });
    }
  },

  removePlaylistDuplicates: async (playlistId) => {
    const existing = get().playlists.find((p) => p.id === playlistId);
    if (!existing) return 0;
    const { duplicateCount, uniqueTracks } = findPlaylistDuplicates(existing.tracks);
    if (duplicateCount === 0) {
      get().showToast('No hay canciones duplicadas en esta playlist');
      return 0;
    }
    await libraryStore.replacePlaylistTracks(playlistId, uniqueTracks);
    set({ playlists: libraryStore.getPlaylists() });
    syncUserLibraryContextToEngine();
    scheduleLibraryCloudSync();
    get().showToast(
      duplicateCount === 1
        ? '1 canción duplicada eliminada'
        : `${duplicateCount} canciones duplicadas eliminadas`
    );
    return duplicateCount;
  },

  removeTrackFromPlaylist: async (playlistId, trackId) => {
    const existing = get().playlists.find((p) => p.id === playlistId);
    await libraryStore.removeTrackFromPlaylist(playlistId, trackId);
    set({ playlists: libraryStore.getPlaylists() });
    syncUserLibraryContextToEngine();
    scheduleLibraryCloudSync();
    const sb = getSyncSupabaseClient();
    const st = get();
    if (sb && existing?.isCollaborative && existing.shareCode && st.authState.connected) {
      const linked = st.sharedPlaylists.find(
        (s) => s.shareCode?.toUpperCase() === existing.shareCode?.toUpperCase()
      );
      if (linked) {
        void removeTrackFromSharedPlaylist(sb, linked, trackId).then((updated) => {
          set((prev) => ({
            sharedPlaylists: prev.sharedPlaylists.map((item) =>
              item.id === updated.id ? updated : item
            ),
          }));
        }).catch(() => {});
      }
    }
    get().showToast('Eliminada de la playlist');
  },

  reorderPlaylistTrack: async (playlistId, fromIndex, toIndex) => {
    await libraryStore.reorderPlaylistTrack(playlistId, fromIndex, toIndex);
    set({ playlists: libraryStore.getPlaylists() });
    scheduleLibraryCloudSync();
  },

  likeTrackIfNeeded: async (track) => {
    if (libraryStore.isTrackLiked(track.id)) {
      get().showToast('Ya estaba en Canciones que te gustan');
      return;
    }
    await get().toggleLike(track);
    get().showToast('Añadida a Canciones que te gustan');
  },

  searchTracksForPlaylist: async (query) => {
    const q = query.trim();
    if (!q) return get().searchResults.songs.slice(0, 12);
    try {
      const bundle = await musicProvider.search(q, 'song');
      if (bundle.songs.length > 0) return bundle.songs.slice(0, 16);
    } catch {
      // fall back to public catalog
    }
    try {
      return await searchPublicCatalog(q);
    } catch {
      return [];
    }
  },

  dismissPlaylistRecommendation: (playlistId, trackId) => {
    if (!playlistId || !trackId) return;
    set((prev) => {
      const existing = prev.dismissedPlaylistRecs[playlistId] ?? [];
      if (existing.includes(trackId)) return prev;
      return {
        dismissedPlaylistRecs: {
          ...prev.dismissedPlaylistRecs,
          [playlistId]: [...existing, trackId].slice(-250),
        },
      };
    });
    persistPrefsFromStore();
  },

  fetchPlaylistRecommendations: async (playlistId, options) => {
    const st = get();
    const pl = st.playlists.find((p) => p.id === playlistId);
    if (!pl) return [];

    const dismissed = new Set(st.dismissedPlaylistRecs[playlistId] ?? []);
    const excludedIds = new Set<string>([
      ...pl.tracks.map((t) => t.id),
      ...dismissed,
      ...(options?.excludeIds ?? []),
    ]);
    const excludedKeys = new Set<string>(pl.tracks.map((t) => normalizeTrackMetaKey(t)));
    if (options?.seedTrack) {
      excludedIds.add(options.seedTrack.id);
      excludedKeys.add(normalizeTrackMetaKey(options.seedTrack));
    }

    const candidates = new Map<string, Track>();
    const pushCand = (t: Track) => {
      if (!t?.id || excludedIds.has(t.id)) return;
      const key = normalizeTrackMetaKey(t);
      if (excludedKeys.has(key)) return;
      excludedKeys.add(key);
      candidates.set(t.id, t);
    };

    const playlistSeeds = [...pl.tracks];
    // Pick up to 5 distributed seeds across playlist + explicit seedTrack just added
    const seedTracks: Track[] = [];
    if (options?.seedTrack) seedTracks.push(options.seedTrack);
    if (playlistSeeds.length > 0) {
      const step = Math.max(1, Math.floor(playlistSeeds.length / 4));
      for (let i = playlistSeeds.length - 1; i >= 0 && seedTracks.length < 5; i -= step) {
        const cand = playlistSeeds[i]!;
        if (!seedTracks.some((s) => s.id === cand.id)) seedTracks.push(cand);
      }
    }
    if (seedTracks.length === 0) {
      seedTracks.push(st.currentTrack);
    }

    const artistSeeds = Array.from(
      new Set([
        ...(options?.seedTrack?.artists.map((a) => a.name) ?? []),
        ...pl.tracks.flatMap((t) => t.artists.map((a) => a.name)),
      ])
    ).slice(0, 4);

    const [relRes, artRes] = await Promise.all([
      Promise.allSettled(seedTracks.map((t) => musicProvider.getRelated(t.id))),
      Promise.allSettled(artistSeeds.map((name) => musicProvider.getArtist(name))),
    ]);

    const relatedArtistNames: string[] = [];
    const olderAlbumsToSample: AlbumSummary[] = [];

    for (const r of relRes) {
      if (r.status !== 'fulfilled') continue;
      for (const t of r.value.tracks ?? []) pushCand(t);
      for (const ar of r.value.artists ?? []) {
        if (!artistSeeds.some((s) => s.toLowerCase() === ar.name.toLowerCase())) {
          relatedArtistNames.push(ar.name);
        }
      }
    }
    for (const r of artRes) {
      if (r.status !== 'fulfilled') continue;
      for (const t of r.value.topSongs ?? []) pushCand(t);
      for (const relAr of r.value.relatedArtists ?? []) {
        if (!artistSeeds.some((s) => s.toLowerCase() === relAr.name.toLowerCase())) {
          relatedArtistNames.push(relAr.name);
        }
      }
      // Also pick older albums (skip index 0 which is typically the newest album) so older classics & deep cuts appear
      const older = [...(r.value.albums ?? [])]
        .sort((a, b) => (a.year ?? 2020) - (b.year ?? 2020))
        .slice(0, 2);
      olderAlbumsToSample.push(...older);
    }

    // Second wave: fetch related artists & older albums so recommendations span eras & albums, not just this year
    const uniqRelatedArtists = Array.from(new Set(relatedArtistNames)).slice(0, 4);
    const uniqOlderAlbums = olderAlbumsToSample
      .filter((a, i, arr) => arr.findIndex((x) => x.id === a.id) === i)
      .slice(0, 3);
    if (uniqRelatedArtists.length > 0 || uniqOlderAlbums.length > 0) {
      const [relArtDetails, olderAlbDetails] = await Promise.all([
        Promise.allSettled(uniqRelatedArtists.map((n) => musicProvider.getArtist(n))),
        Promise.allSettled(uniqOlderAlbums.map((al) => musicProvider.getAlbum(al.id))),
      ]);
      for (const r of relArtDetails) {
        if (r.status === 'fulfilled') {
          for (const t of r.value.topSongs ?? []) pushCand(t);
        }
      }
      for (const r of olderAlbDetails) {
        if (r.status === 'fulfilled') {
          for (const t of r.value.tracks ?? []) pushCand(t);
        }
      }
    }

    for (const t of [...st.searchResults.songs, ...st.recommendedQueue, ...FALLBACK_TRACKS]) {
      if (candidates.size < 18) pushCand(t);
    }

    const reranked = recommendationEngine.rerankTracks(Array.from(candidates.values()), {
      maxPerArtistInWindow: 2,
      limit: 60,
    });

    // Enforce rich album & era diversity: max 1 track per album in the first pass, mixing older & newer releases
    const albumUsed = new Map<string, number>();
    const playlistAlbumCounts = new Map<string, number>();
    for (const pt of pl.tracks) {
      const ak = (pt.album?.name ?? '').trim().toLowerCase();
      if (ak) playlistAlbumCounts.set(ak, (playlistAlbumCounts.get(ak) ?? 0) + 1);
    }
    const primaryPass: Track[] = [];
    const overflowPass: Track[] = [];
    for (const cand of reranked) {
      const ak = (cand.album?.name ?? '').trim().toLowerCase();
      const inPlAlbum = ak ? (playlistAlbumCounts.get(ak) ?? 0) : 0;
      const usedInOut = ak ? (albumUsed.get(ak) ?? 0) : 0;
      if (ak && (usedInOut >= 1 || inPlAlbum >= 3)) {
        overflowPass.push(cand);
      } else {
        if (ak) albumUsed.set(ak, usedInOut + 1);
        primaryPass.push(cand);
      }
    }

    // When a new seedTrack was just added, prioritize fresh related discoveries near the front so suggestions visibly adapt
    if (options?.seedTrack) {
      const seedRelRes = relRes[0];
      const seedRelIds = new Set<string>(
        seedRelRes && seedRelRes.status === 'fulfilled'
          ? (seedRelRes.value.tracks ?? []).map((t) => t.id)
          : []
      );
      const seedFirst: Track[] = [];
      const restPrimary: Track[] = [];
      for (const cand of primaryPass) {
        if (seedRelIds.has(cand.id)) seedFirst.push(cand);
        else restPrimary.push(cand);
      }
      return [...seedFirst, ...restPrimary, ...overflowPass].slice(0, 24);
    }

    return [...primaryPass, ...overflowPass].slice(0, 24);
  },

  toggleLike: async (track) => {
    const target = track ?? get().currentTrack;
    const likedNow = await libraryStore.toggleLikeTrack(target);
    await recommendationEngine.recordSignal(target, likedNow ? 'like' : 'unlike');
    syncUserLibraryContextToEngine();
    const shelves = await recommendationEngine.buildHomeShelves();
    set({
      likedTracks: libraryStore.getLikedTracks(),
      affinityProfile: recommendationEngine.getAffinityProfile(),
      homeShelves: shelves,
    });
    scheduleLibraryCloudSync();
  },

  downloadTrackOffline: async (track, options) => {
    const st = get();
    if (st.offlineDownloads[track.id] === 'downloaded') return;
    if (st.wifiOnlyDownloads && isMeteredOrCellularNetwork()) {
      if (!options?.silent) {
        st.showToast('Descarga pausada: modo Solo Wi-Fi activo');
      }
      return;
    }
    set((prev) => ({
      offlineDownloads: { ...prev.offlineDownloads, [track.id]: 'downloading' },
    }));

    try {
      const url = await resolveTrackStreamUrl(track);
      const headers = await defaultPlatformBridge.getAuthHeaders();
      const res = await fetch(url, { headers });
      if (!res.ok) throw new Error('stream');
      const contentType = (res.headers.get('content-type') ?? 'audio/mp4').toLowerCase();
      if (
        contentType.includes('application/json') ||
        contentType.includes('text/html') ||
        contentType.includes('text/plain')
      ) {
        throw new Error('invalid_audio_mime');
      }
      const buf = await res.arrayBuffer();
      if (buf.byteLength < 32_768) {
        throw new Error('audio_too_small');
      }
      await defaultPlatformBridge.offlineStorage.saveAudio(
        track.id,
        buf,
        res.headers.get('content-type') ?? 'audio/mp4'
      );
      const hdCoverUrl = upgradeCoverUrlToHd(track.thumbnailHighUrl ?? track.thumbnailUrl);
      if (hdCoverUrl) {
        await saveOfflineCover(track.id, hdCoverUrl).catch(() => false);
      }
      const entries = await defaultPlatformBridge.offlineStorage.listOfflineIds();
      const verified = entries.some((e) => e.trackId === track.id);
      if (!verified) throw new Error('persist_failed');
      set((prev) => ({
        offlineDownloads: { ...prev.offlineDownloads, [track.id]: 'downloaded' },
        offlineEntries: entries,
      }));
    } catch {
      set((prev) => ({
        offlineDownloads: { ...prev.offlineDownloads, [track.id]: 'error' },
      }));
    }
  },

  removeOfflineTrack: async (trackId) => {
    await defaultPlatformBridge.offlineStorage.deleteAudio(trackId);
    await deleteOfflineCover(trackId);
    const entries = await defaultPlatformBridge.offlineStorage.listOfflineIds();
    set((prev) => {
      const nextMap = { ...prev.offlineDownloads };
      delete nextMap[trackId];
      return {
        offlineDownloads: nextMap,
        offlineEntries: entries,
      };
    });
  },

  removePlaylistOffline: async (playlistId) => {
    const st = get();
    const remainingAutoIds = st.offlineAutoPlaylistIds.filter((id) => id !== playlistId);
    writeOfflineAutoPlaylistIds(remainingAutoIds);

    const targetPlaylist =
      st.playlists.find((p) => p.id === playlistId) ??
      st.sharedPlaylists.find((p) => p.id === playlistId);

    const protectedIds = new Set<string>();
    for (const id of remainingAutoIds) {
      const other =
        st.playlists.find((p) => p.id === id) ??
        st.sharedPlaylists.find((p) => p.id === id);
      if (other) {
        for (const t of other.tracks) {
          if (t?.id) protectedIds.add(t.id);
        }
      }
    }

    const removedIds = new Set<string>();
    if (targetPlaylist) {
      for (const track of targetPlaylist.tracks) {
        if (!track?.id || protectedIds.has(track.id)) continue;
        await defaultPlatformBridge.offlineStorage.deleteAudio(track.id);
        await deleteOfflineCover(track.id);
        removedIds.add(track.id);
      }
    }

    const entries = await defaultPlatformBridge.offlineStorage.listOfflineIds();
    set((prev) => {
      const nextMap = { ...prev.offlineDownloads };
      for (const trackId of removedIds) {
        delete nextMap[trackId];
      }
      return {
        offlineAutoPlaylistIds: remainingAutoIds,
        offlineDownloads: nextMap,
        offlineEntries: entries,
      };
    });
    st.showToast(
      targetPlaylist
        ? `Descarga automática quitada de «${targetPlaylist.name}»`
        : 'Descarga automática de playlist quitada'
    );
  },

  setWifiOnlyDownloads: (enabled) => {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(WIFI_ONLY_STORAGE_KEY, enabled ? '1' : '0');
      }
    } catch {
      // ignore storage errors
    }
    set({ wifiOnlyDownloads: enabled });
  },

  clearOfflineCache: async () => {
    await defaultPlatformBridge.offlineStorage.clearAll();
    await clearOfflineCovers();
    writeOfflineAutoPlaylistIds([]);
    set({
      offlineDownloads: {},
      offlineEntries: [],
      offlineAutoPlaylistIds: [],
    });
  },

  setImportUrlInput: (url) => set({ importUrlInput: url, importError: null }),

  startPlaylistImport: async (url) => {
    const rawUrl = (url ?? get().importUrlInput).trim();
    importAbortController?.abort();
    importAbortController = new AbortController();

    set({
      importError: null,
      importResult: null,
      importProgress: {
        phase: 'resolving_url',
        completed: 0,
        total: 1,
        matchedCount: 0,
        unmatchedCount: 0,
      },
    });

    try {
      const result = await playlistImporter.importFromUrl(
        rawUrl,
        (ev) => set({ importProgress: ev }),
        importAbortController.signal
      );
      set({ importResult: result });
    } catch (err) {
      set({
        importError:
          err instanceof Error
            ? err.message
            : 'No se pudo importar la playlist. Comprueba que el enlace sea público.',
        importProgress: null,
      });
    }
  },

  cancelPlaylistImport: () => {
    importAbortController?.abort();
    importAbortController = null;
    set({
      importProgress: null,
      importError: 'Importación cancelada.',
    });
  },

  saveImportedPlaylistToLibrary: async () => {
    const res = get().importResult;
    if (!res) return;
    const matchedTracks = res.items
      .map((item) => item.match)
      .filter((t): t is Track => Boolean(t));

    await libraryStore.createPlaylist({
      name: res.name,
      description: `Importada de ${res.sourcePlatform === 'spotify' ? 'Spotify' : 'YouTube'}`,
      coverUrl: res.coverUrl,
      source: res.sourcePlatform === 'spotify' ? 'imported_spotify' : 'imported_youtube',
      sourceUrl: res.sourceUrl,
      tracks: matchedTracks,
    });

    set({
      playlists: libraryStore.getPlaylists(),
      importModalOpen: false,
      importResult: null,
      importProgress: null,
      importUrlInput: '',
      activeTab: 'Biblioteca',
    });
    syncUserLibraryContextToEngine();
    scheduleLibraryCloudSync();
  },

  configureSupabase: async (url, anonKey, deviceName) => {
    await syncEngine.configure({
      supabaseUrl: url,
      supabaseAnonKey: anonKey,
      deviceName,
    });
    set({
      syncMode: syncEngine.mode,
      supabaseUrlInput: url,
      supabaseAnonKeyInput: anonKey,
      ...(deviceName ? { deviceName } : {}),
      onlineDevices: syncEngine.getOnlineDevices(),
    });
  },

  setDeviceName: async (deviceName) => {
    const clean = deviceName.trim();
    if (!clean) return;
    await syncEngine.configure({ deviceName: clean });
    set({
      deviceName: clean,
      onlineDevices: syncEngine.getOnlineDevices(),
    });
    get().showToast(`Dispositivo renombrado a "${clean}"`);
  },

  signInSupabase: async (email, password) => {
    await syncEngine.signIn(email, password);
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(HOME_SHELVES_CACHE_KEY);
      }
    } catch {
      // ignore
    }
    const profile = (await syncEngine.getProfile?.()) ?? null;
    try {
      const cloudPrefs = await syncEngine.loadAccountPreferences?.();
      if (cloudPrefs) {
        applyPreferencesPayload(cloudPrefs);
        void defaultPlatformBridge.preferencesStorage
          .setItem(USER_PREFS_STORAGE_KEY, JSON.stringify(cloudPrefs))
          .catch(() => {});
      }
      await hydrateAndMergeCloudTaste(cloudPrefs);
    } catch {
      // ignore cloud prefs load error
    }
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('pmusic.onboarding.dismissed', '1');
      }
    } catch {
      // ignore
    }
    set({
      authState: syncEngine.getAuthState(),
      userProfile: profile,
      authOnboardingOpen: false,
      needsProfileSetup: !profile,
      onlineDevices: syncEngine.getOnlineDevices(),
      likedTracks: libraryStore.getLikedTracks(),
      playlists: libraryStore.getPlaylists(),
      playHistory: libraryStore.getPlayHistory(),
    });
    if (profile) void writeCachedProfile(profile.userId, profile);
    void syncEngine
      .rememberCurrentAccountSession(
        profile
          ? {
              username: profile.username,
              displayName: profile.displayName,
              avatarUrl: profile.avatarUrl,
            }
          : undefined
      )
      .then((slots) => set({ savedAccounts: slots }));
    void syncEngine.sendRemoteCommand({
      targetDeviceId: '*',
      type: 'request_state',
    });
    void get().hydrateSocialAndSubscribe();
  },

  signUpSupabase: async (email, password) => {
    const res = await syncEngine.signUp(email, password);
    const auth = syncEngine.getAuthState();
    const profile = auth.connected ? ((await syncEngine.getProfile?.()) ?? null) : null;
    if (auth.connected) {
      persistPrefsFromStore();
    }
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('pmusic.onboarding.dismissed', '1');
      }
    } catch {
      // ignore
    }
    set({
      authState: auth,
      userProfile: profile,
      authOnboardingOpen: false,
      needsProfileSetup: auth.connected && !profile,
      onlineDevices: syncEngine.getOnlineDevices(),
      likedTracks: libraryStore.getLikedTracks(),
      playlists: libraryStore.getPlaylists(),
      playHistory: libraryStore.getPlayHistory(),
    });
    if (profile) void writeCachedProfile(profile.userId, profile);
    if (auth.connected) {
      void syncEngine
        .rememberCurrentAccountSession(
          profile
            ? {
                username: profile.username,
                displayName: profile.displayName,
                avatarUrl: profile.avatarUrl,
              }
            : undefined
        )
        .then((slots) => set({ savedAccounts: slots }));
    }
    return res;
  },

  signInWithGoogle: async () => {
    const desktopBridge = typeof window !== 'undefined' ? (window as any).pmusicDesktop : null;
    const isAndroidApp =
      typeof window !== 'undefined' && window.location?.hostname === 'appassets.pmusic.local';

    let redirectTo = 'pmusic://auth/callback';
    if (desktopBridge?.getOAuthRedirectUrl) {
      try {
        const loopbackRedirect = await desktopBridge.getOAuthRedirectUrl();
        if (typeof loopbackRedirect === 'string' && loopbackRedirect.startsWith('http://127.0.0.1:')) {
          redirectTo = loopbackRedirect;
        }
      } catch {
        redirectTo = 'pmusic://auth/callback';
      }
    } else if (!isAndroidApp && typeof window !== 'undefined' && window.location?.protocol?.startsWith('http')) {
      redirectTo = `${window.location.origin}${window.location.pathname}`;
    }

    const res = await syncEngine.signInWithGoogle?.(redirectTo);
    if (!res?.url) {
      throw new Error('No se pudo obtener la URL de acceso con Google.');
    }
    if (typeof window !== 'undefined') {
      const androidNative = (window as any).PMusicNative;
      if (desktopBridge?.openAuthWindow) {
        await desktopBridge.openAuthWindow(res.url);
        get().showToast('Autentícate con Google en la ventana nueva…');
        return;
      }
      if (desktopBridge?.openExternalUrl) {
        await desktopBridge.openExternalUrl(res.url);
        get().showToast('Completa el inicio con Google en tu navegador...');
        return;
      }
      if (androidNative?.openExternalUrl) {
        androidNative.openExternalUrl(res.url);
        get().showToast('Completa el inicio con Google en Chrome...');
        return;
      }
      const popup = window.open(
        res.url,
        'pmusic-google-auth',
        'popup=yes,width=520,height=700,menubar=no,toolbar=no,status=no,resizable=yes,scrollbars=yes'
      );
      if (!popup) {
        window.location.href = res.url;
      }
    }
  },

  handleAuthCallbackUrl: async (callbackUrl) => {
    const playlistDeepMatch = callbackUrl.match(/^pmusic:\/\/playlist\/([A-Za-z0-9]{4,16})/i);
    if (playlistDeepMatch?.[1] && typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('pmusic:open-shared-playlist', {
          detail: playlistDeepMatch[1].toUpperCase(),
        })
      );
      return;
    }
    const tokenKey = extractOAuthTokenKey(callbackUrl);
    if (tokenKey && handledOAuthTokens.has(tokenKey)) {
      return;
    }
    if (oauthCallbackInFlight) {
      return;
    }
    if (tokenKey) {
      handledOAuthTokens.add(tokenKey);
    }
    oauthCallbackInFlight = true;
    set({ authCallbackError: null });
    try {
      const auth = await syncEngine.completeOAuthCallback?.(callbackUrl);
      if (auth?.connected) {
        try {
          if (typeof localStorage !== 'undefined') {
            localStorage.removeItem(HOME_SHELVES_CACHE_KEY);
          }
        } catch {
          // ignore
        }
        const profile = (await syncEngine.getProfile?.()) ?? null;
        await syncEngine.syncNow().catch(() => {});
        try {
          const cloudPrefs = await syncEngine.loadAccountPreferences?.();
          if (cloudPrefs) {
            applyPreferencesPayload(cloudPrefs);
            void defaultPlatformBridge.preferencesStorage
              .setItem(USER_PREFS_STORAGE_KEY, JSON.stringify(cloudPrefs))
              .catch(() => {});
            await hydrateAndMergeCloudTaste(cloudPrefs);
          } else {
            await hydrateAndMergeCloudTaste(null);
            persistPrefsFromStore(true);
          }
        } catch {
          // ignore
        }
        try {
          if (typeof localStorage !== 'undefined') {
            localStorage.setItem('pmusic.onboarding.dismissed', '1');
          }
        } catch {
          // ignore
        }
        set({
          authState: auth,
          userProfile: profile,
          authOnboardingOpen: false,
          needsProfileSetup: !profile,
          authCallbackError: null,
          onlineDevices: syncEngine.getOnlineDevices(),
          likedTracks: libraryStore.getLikedTracks(),
          playlists: libraryStore.getPlaylists(),
          playHistory: libraryStore.getPlayHistory(),
        });
        if (profile) void writeCachedProfile(profile.userId, profile);
        void syncEngine
          .rememberCurrentAccountSession(
            profile
              ? {
                  username: profile.username,
                  displayName: profile.displayName,
                  avatarUrl: profile.avatarUrl,
                }
              : undefined
          )
          .then((slots) => set({ savedAccounts: slots }));
        if (isLiveRuntime()) {
          void recommendationEngine
            .buildHomeShelves()
            .then((fresh) => {
              if (fresh.length > 0) {
                saveCachedHomeShelves(fresh, auth.userId);
                set({ homeShelves: fresh, homeFeedReady: true });
              }
            })
            .catch(() => {});
        } else {
          set({ homeFeedReady: true });
        }
        get().showToast(
          profile
            ? `Sesión iniciada como @${profile.username}`
            : 'Sesión iniciada con Google'
        );
        void syncEngine.sendRemoteCommand({
          targetDeviceId: '*',
          type: 'request_state',
        });
        void get().hydrateSocialAndSubscribe();
      } else {
        set({ authCallbackError: 'No se recibió una sesión válida de Google. Inténtalo de nuevo.' });
      }
    } catch (err) {
      if (syncEngine.getAuthState().connected) {
        set({ authCallbackError: null, authOnboardingOpen: false });
        return;
      }
      const msg = err instanceof Error ? err.message : 'No se pudo completar el inicio con Google';
      set({ authCallbackError: msg });
      get().showToast(msg);
    } finally {
      oauthCallbackInFlight = false;
    }
  },

  signOutSupabase: async () => {
    if (cloudPrefsSaveTimer) {
      clearTimeout(cloudPrefsSaveTimer);
      cloudPrefsSaveTimer = null;
    }
    pendingCloudPrefsPayload = null;
    cleanupJamRealtime();
    cleanupSocialRealtime();
    clearSessionTrackMemory();
    recommendationEngine.setFavoriteArtists([]);
    recommendationEngine.setUserLibraryContext({ libraryTracks: [], likedTracks: [] });
    await syncEngine.signOut();
    if (typeof window !== 'undefined') {
      try {
        await (window as any).pmusicDesktop?.clearAuthState?.();
      } catch {
        // ignore desktop clearAuthState failure
      }
    }
    try {
      await recommendationEngine.resetTastes();
    } catch {
      // ignore taste reset error
    }
    try {
      await defaultPlatformBridge.preferencesStorage.removeItem(USER_PREFS_STORAGE_KEY);
      await clearCachedAccountArtifacts();
    } catch {
      // ignore storage cleanup error
    }
    const remainingSavedAccounts = await syncEngine.listSavedAccounts().catch(() => []);
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(HOME_SHELVES_CACHE_KEY);
        localStorage.removeItem('pmusic.wrapped.events.v1');
      }
    } catch {
      // ignore
    }
    set((prev) => ({
      authState: syncEngine.getAuthState(),
      userProfile: null,
      needsProfileSetup: false,
      mobileHubOpen: false,
      savedAccounts: remainingSavedAccounts,
      favoriteArtists: [],
      friends: [],
      sharedPlaylists: [],
      activeJamCode: null,
      activeJamSession: null,
      activeJamRole: null,
      activeJamRequests: [],
      jamInviteModalOpen: false,
      onlineDevices: syncEngine.getOnlineDevices(),
      remoteControlledDeviceId: null,
      remoteDeviceSnapshot: null,
      playlists: [],
      likedTracks: [],
      playHistory: [],
      playlistPlayCounts: {},
      nowPlayingBackdropStyle: 'pulse',
      alwaysShuffle: false,
      shuffleEnabled: false,
      repeatMode: 'off',
      seedArtists: recommendationEngine.getSeedArtists(),
      affinityProfile: recommendationEngine.getAffinityProfile(),
      activeDetailView:
        prev.activeDetailView?.kind === 'local_playlist' ||
        prev.activeDetailView?.kind === 'shared_playlist'
          ? null
          : prev.activeDetailView,
    }));
    void get().refreshHomeRecommendations(false);
  },

  setAuthOnboardingOpen: (open) => set({ authOnboardingOpen: open }),

  prepareAddSecondaryAccount: async () => {
    const st = get();
    if (st.authState.connected) {
      const slots = await syncEngine.rememberCurrentAccountSession(
        st.userProfile
          ? {
              username: st.userProfile.username,
              displayName: st.userProfile.displayName,
              avatarUrl: st.userProfile.avatarUrl,
            }
          : undefined
      );
      set({ savedAccounts: slots });
    }
    set({
      mobileHubOpen: false,
      settingsOpen: false,
      authOnboardingOpen: true,
    });
  },

  switchSavedAccount: async (userId) => {
    const st = get();
    if (st.authState.userId === userId && st.authState.connected) {
      set({ mobileHubOpen: false });
      return;
    }
    if (st.authState.connected) {
      await syncEngine.rememberCurrentAccountSession(
        st.userProfile
          ? {
              username: st.userProfile.username,
              displayName: st.userProfile.displayName,
              avatarUrl: st.userProfile.avatarUrl,
            }
          : undefined
      );
    }
    cleanupJamRealtime();
    cleanupSocialRealtime();
    clearSessionTrackMemory();

    const res = await syncEngine.switchToSavedAccount(userId);
    if (!res.switched) {
      set({
        savedAccounts: await syncEngine.listSavedAccounts().catch(() => st.savedAccounts),
        mobileHubOpen: false,
        authOnboardingOpen: true,
      });
      get().showToast(
        res.needsReloginEmail
          ? `Vuelve a iniciar sesión con ${res.needsReloginEmail} para reactivar esta cuenta`
          : 'No se pudo cambiar a esa cuenta. Inicia sesión de nuevo.'
      );
      return;
    }

    const [profile, cloudPrefs, nextSlots] = await Promise.all([
      syncEngine.getProfile?.() ?? Promise.resolve(null),
      syncEngine.loadAccountPreferences?.() ?? Promise.resolve(null),
      syncEngine.listSavedAccounts(),
    ]);
    if (cloudPrefs) {
      applyPreferencesPayload(cloudPrefs);
      void defaultPlatformBridge.preferencesStorage
        .setItem(USER_PREFS_STORAGE_KEY, JSON.stringify(cloudPrefs))
        .catch(() => {});
    }
    await hydrateAndMergeCloudTaste(cloudPrefs);
    if (profile) void writeCachedProfile(profile.userId, profile);

    set((prev) => ({
      authState: syncEngine.getAuthState(),
      userProfile: profile,
      savedAccounts: nextSlots,
      needsProfileSetup: !profile,
      mobileHubOpen: false,
      onlineDevices: syncEngine.getOnlineDevices(),
      playlists: libraryStore.getPlaylists().map((pl) => ({
        ...pl,
        tracks: pl.tracks.map(canonicalizeTrackArtists),
      })),
      likedTracks: libraryStore.getLikedTracks().map((l) => ({
        ...l,
        track: canonicalizeTrackArtists(l.track),
      })),
      playHistory: libraryStore.getPlayHistory().map((h) => ({
        ...h,
        track: canonicalizeTrackArtists(h.track),
      })),
      activeDetailView:
        prev.activeDetailView?.kind === 'local_playlist' ||
        prev.activeDetailView?.kind === 'shared_playlist'
          ? null
          : prev.activeDetailView,
    }));
    void get().hydrateSocialAndSubscribe();
    get().showToast(
      profile ? `Cambiado a @${profile.username}` : 'Cuenta cambiada'
    );
  },

  removeSavedAccount: async (userId) => {
    const nextSlots = await syncEngine.removeSavedAccount(userId);
    set({ savedAccounts: nextSlots });
    get().showToast('Cuenta eliminada de este dispositivo');
  },

  continueAsGuest: () => {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('pmusic.onboarding.dismissed', '1');
      }
    } catch {
      // ignore
    }
    set({ authOnboardingOpen: false });
  },

  saveUserProfile: async (input) => {
    const profile = await syncEngine.upsertProfile?.(input);
    if (profile) {
      set({
        userProfile: profile,
        needsProfileSetup: false,
        authOnboardingOpen: false,
      });
      get().showToast(`¡Bienvenido, @${profile.username}!`);
    }
  },

  checkUsernameAvailable: async (username) => {
    return (await syncEngine.isUsernameAvailable?.(username)) ?? true;
  },

  openWrappedModal: async (year) => {
    const targetYear = year ?? new Date().getFullYear();
    const localEvents = loadLocalWrappedEvents();
    const remoteEvents = (await syncEngine.fetchYearListenEvents?.(targetYear)) ?? [];
    const merged = mergeWrappedEvents(localEvents, remoteEvents);
    const summary = computeWrappedSummary(merged, targetYear);

    const st = get();
    const catalogPool = new Map<string, Track>();
    for (const l of st.likedTracks) {
      if (l.track?.id) catalogPool.set(l.track.id, canonicalizeTrackArtists(l.track));
    }
    for (const h of st.playHistory) {
      if (h.track?.id) catalogPool.set(h.track.id, canonicalizeTrackArtists(h.track));
    }
    for (const p of st.playlists) {
      for (const t of p.tracks) {
        if (t?.id) catalogPool.set(t.id, canonicalizeTrackArtists(t));
      }
    }
    for (const s of st.homeShelves) {
      for (const t of s.tracks ?? []) {
        if (t?.id) catalogPool.set(t.id, canonicalizeTrackArtists(t));
      }
    }

    const soundtrack: Track[] = [];
    const seenIds = new Set<string>();
    const seenKeys = new Set<string>();
    const pushDistinctTrack = (raw: Track | undefined) => {
      if (!raw?.id || seenIds.has(raw.id)) return;
      const key = `${raw.title.trim().toLowerCase()}::${(raw.artists[0]?.name ?? '').trim().toLowerCase()}`;
      if (seenKeys.has(key)) return;
      seenIds.add(raw.id);
      seenKeys.add(key);
      soundtrack.push(canonicalizeTrackArtists(raw));
    };
    const allPool = Array.from(catalogPool.values());

    // 1. Prioritize top wrapped tracks if present in pool
    for (const top of summary.topTracks.slice(0, 7)) {
      const hit =
        catalogPool.get(top.key) ??
        allPool.find(
          (t) =>
            t.id === top.key ||
            t.title.trim().toLowerCase() === top.title.trim().toLowerCase()
        );
      pushDistinctTrack(hit);
    }

    // 2. Supplement with favorite artists & top affinity tracks matching user taste
    const rankedTasteTracks = recommendationEngine.rerankTracks(allPool, {
      maxPerArtistInWindow: 2,
      limit: 20,
    });
    for (const t of rankedTasteTracks) {
      pushDistinctTrack(t);
      if (soundtrack.length >= 12) break;
    }

    // 3. Ensure at least 7 distinct songs so every Wrapped story plays a different track
    if (soundtrack.length < 7) {
      const seedQuery =
        summary.topArtists[0]?.title ??
        st.favoriteArtists[0]?.artistName ??
        recommendationEngine.getAffinityProfile()[0]?.artistName ??
        'Cruzzi';
      try {
        const res = await musicProvider.search(seedQuery, 'song');
        for (const t of res.songs.slice(0, 10)) {
          pushDistinctTrack(t);
          if (soundtrack.length >= 12) break;
        }
      } catch {
        // fallback handled right below
      }
      for (const t of canonicalFallbackQueue) {
        pushDistinctTrack(t);
        if (soundtrack.length >= 10) break;
      }
    }

    set({
      wrappedSummary: summary,
      wrappedSoundtrackTracks: soundtrack,
      wrappedModalOpen: true,
    });
  },

  closeWrappedModal: () => set({ wrappedModalOpen: false }),

  setMinimizeToTrayOnClose: (enabled) => {
    set({ minimizeToTrayOnClose: enabled });
    void setDesktopTrayPrefs({ minimizeToTrayOnClose: enabled });
  },

  setDesktopTrackNotifications: (enabled) => {
    set({ desktopTrackNotifications: enabled });
    void setDesktopTrayPrefs({ notifyOnTrackChange: enabled });
  },

  setReleaseNotificationsEnabled: (enabled) => {
    const cur = loadReleaseNotificationsState();
    saveReleaseNotificationsState({
      ...cur,
      enabled,
      items: get().releaseNotifications,
    });
    set({ releaseNotificationsEnabled: enabled });
  },

  setNotificationsPanelOpen: (open) => set({ notificationsPanelOpen: open }),

  checkNewArtistReleases: async (force = false) => {
    const st = get();
    if (!st.releaseNotificationsEnabled && !force) return;
    if (st.releaseNotificationsChecking) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;

    const persisted = loadReleaseNotificationsState();
    if (!force && persisted.lastCheckedAt > 0 && Date.now() - persisted.lastCheckedAt < 30 * 60_000) {
      return;
    }

    const priorityArtists = extractPriorityArtists(st.likedTracks, st.playHistory, 12);
    if (priorityArtists.length === 0) {
      saveReleaseNotificationsState({ ...persisted, lastCheckedAt: Date.now() });
      return;
    }

    set({ releaseNotificationsChecking: true });
    try {
      const incoming = await checkArtistNewReleases(priorityArtists, persisted.seenIds);
      const existingMap = new Map(st.releaseNotifications.map((item) => [item.id, item]));
      const newlyDiscovered: ReleaseNotificationItem[] = [];
      for (const item of incoming) {
        if (!existingMap.has(item.id)) {
          newlyDiscovered.push(item);
          existingMap.set(item.id, item);
        }
      }
      const mergedList = Array.from(existingMap.values())
        .sort((a, b) => b.releaseDate.localeCompare(a.releaseDate))
        .slice(0, 40);
      const nextSeenIds = Array.from(
        new Set([...persisted.seenIds, ...newlyDiscovered.map((x) => x.id)])
      );
      saveReleaseNotificationsState({
        enabled: st.releaseNotificationsEnabled,
        lastCheckedAt: Date.now(),
        seenIds: nextSeenIds,
        items: mergedList,
      });
      set({ releaseNotifications: mergedList });

      if (newlyDiscovered.length > 0 && st.releaseNotificationsEnabled) {
        const newest = newlyDiscovered[0]!;
        get().showToast(
          newlyDiscovered.length === 1
            ? `Nuevo lanzamiento de ${newest.artistName}: ${newest.title}`
            : `${newlyDiscovered.length} nuevos lanzamientos de tus artistas favoritos`
        );
        for (const rel of newlyDiscovered.slice(0, 2)) {
          showNativeReleaseNotification(
            `Nuevo de ${rel.artistName}`,
            rel.title,
            rel.trackId ?? rel.albumId ?? ''
          );
        }
      } else if (force) {
        get().showToast('No hay nuevos lanzamientos recientes de tus artistas');
      }
    } finally {
      set({ releaseNotificationsChecking: false });
    }
  },

  markReleaseNotificationRead: (id) => {
    const cur = get().releaseNotifications;
    const next = cur.map((n) => (n.id === id ? { ...n, read: true } : n));
    const persisted = loadReleaseNotificationsState();
    saveReleaseNotificationsState({
      ...persisted,
      enabled: get().releaseNotificationsEnabled,
      items: next,
    });
    set({ releaseNotifications: next });
  },

  markAllReleaseNotificationsRead: () => {
    const next = get().releaseNotifications.map((n) => ({ ...n, read: true }));
    const persisted = loadReleaseNotificationsState();
    saveReleaseNotificationsState({
      ...persisted,
      enabled: get().releaseNotificationsEnabled,
      items: next,
    });
    set({ releaseNotifications: next });
  },

  playReleaseNotification: async (item) => {
    get().markReleaseNotificationRead(item.id);
    set({ notificationsPanelOpen: false });
    if (item.track) {
      await get().playTrack(item.track, [item.track]);
      return;
    }
    if (item.albumId) {
      await get().openAlbumDetail(item.albumId, {
        title: item.title,
        artist: item.artistName,
        thumbnailUrl: item.coverUrl,
      });
      const dv = get().activeDetailView;
      if (dv?.kind === 'album' && dv.data.tracks.length > 0) {
        await get().playTrack(dv.data.tracks[0]!, dv.data.tracks);
      }
      return;
    }
    const found = await get().searchTracksForPlaylist(`${item.artistName} ${item.title}`);
    if (found.length > 0) {
      await get().playTrack(found[0]!, found);
    } else {
      get().showToast(`No se pudo cargar «${item.title}» ahora mismo`);
    }
  },

  setShareListeningActivity: (enabled) => {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(SHARE_LISTENING_STORAGE_KEY, enabled ? '1' : '0');
      }
    } catch {
      // ignore storage errors
    }
    set({ shareListeningActivity: enabled });
    syncOwnListeningPresence();
  },

  loadPersonalTopStats: async (window) => {
    const localEvents = loadLocalWrappedEvents();
    let remoteEvents: typeof localEvents = [];
    try {
      remoteEvents =
        (await syncEngine.fetchYearListenEvents?.(new Date().getFullYear())) ?? [];
    } catch {
      remoteEvents = [];
    }
    const merged = mergeWrappedEvents(localEvents, remoteEvents);
    const stats = computePeriodTopStats(merged, window);
    set((prev) => ({
      personalTopStats: { ...prev.personalTopStats, [window]: stats },
    }));
    return stats;
  },

  playFriendActivityTrack: async (activity) => {
    const st = get();
    const candidates: Track[] = [
      ...st.playHistory.map((h) => h.track),
      ...st.likedTracks.map((l) => l.track),
      ...st.playlists.flatMap((p) => p.tracks),
      ...st.homeShelves.flatMap((s) => s.tracks ?? []),
    ];
    const localMatch = candidates.find(
      (t) =>
        t?.id === activity.trackId ||
        (t?.title.trim().toLowerCase() === activity.trackTitle.trim().toLowerCase() &&
          (!activity.trackArtist ||
            t.artists.some((a) =>
              a.name.toLowerCase().includes(activity.trackArtist.toLowerCase())
            )))
    );
    if (localMatch) {
      await st.playTrack(localMatch);
      return;
    }
    const query = [activity.trackTitle, activity.trackArtist].filter(Boolean).join(' ').trim();
    if (query) {
      await st.playFromVoiceQuery(query);
    }
  },

  pairDemoCompanionDevice: () => {
    syncEngine.upsertPeerDevice({
      device_id: 'pmusic_companion_android',
      device_name: 'pMusic Android (Pixel 8)',
      platform: 'android',
      is_active: false,
      is_playing: false,
      track_title: 'Conectado en la misma cuenta',
      updated_at: Date.now(),
    });
    set({ onlineDevices: syncEngine.getOnlineDevices() });
  },

  sendRemoteDeviceCommand: async (targetDeviceId, action, volume01) => {
    if (volume01 !== undefined) {
      await syncEngine.sendRemoteCommand({
        targetDeviceId,
        type: 'volume',
        volume01,
      });
      return;
    }
    await syncEngine.sendRemoteCommand({
      targetDeviceId,
      type: action,
    });
  },

  transferPlaybackToDevice: async (targetDeviceId) => {
    const st = get();
    const snapshot: PlaybackTransferSnapshot = {
      track: st.currentTrack,
      queue: st.queue,
      queueIndex: st.queueIndex,
      positionMs: Math.round(st.positionSec * 1000),
      isPlaying: st.isPlaying || true,
      volume: st.volume,
      djModeEnabled: st.djMode.enabled,
      djSessionStyle: st.djMode.style,
      sentAtEpochMs: Date.now(),
    };
    const res = await syncEngine.transferPlaybackTo(targetDeviceId, snapshot);
    void syncEngine.persistDeviceSession(snapshot);

    // Spotify Connect handoff: pause local playback and switch to remote-control mode
    if (st.isPlaying) {
      audioEngine.pause();
    }

    const targetDev = st.onlineDevices.find((d) => d.device_id === targetDeviceId);
    set({
      isPlaying: false,
      remoteControlledDeviceId: targetDeviceId,
      remoteDeviceSnapshot: {
        deviceId: targetDeviceId,
        deviceName: targetDev?.device_name ?? targetDeviceId,
        trackTitle: st.currentTrack.title,
        trackArtist: st.currentTrack.artists.map((a) => a.name).join(', '),
        thumbnailUrl: st.currentTrack.thumbnailUrl,
        isPlaying: true,
        positionMs: snapshot.positionMs,
        durationMs: Math.round(st.durationSec * 1000),
        volume: st.volume,
      },
      onlineDevices: syncEngine.getOnlineDevices(),
      lastTransferBanner: res.acked
        ? `Transferido a ${targetDev?.device_name ?? targetDeviceId} en ${Math.round(st.positionSec)}s`
        : `Enviado a ${targetDev?.device_name ?? targetDeviceId}`,
    });
  },

  pullPlaybackFromDevice: async (sourceDeviceId) => {
    await syncEngine.sendRemoteCommand({
      targetDeviceId: sourceDeviceId,
      type: 'pull_transfer',
    });
    const latest = await syncEngine.fetchLatestDeviceSession();
    if (latest?.track && latest.activeDeviceId === sourceDeviceId) {
      set({
        remoteControlledDeviceId: null,
        remoteDeviceSnapshot: null,
        lastTransferBanner: `Reproducción traída desde ${latest.activeDeviceName}`,
      });
      await get().playTrack(
        latest.track,
        latest.queue.length > 0 ? latest.queue : [latest.track],
        latest.positionMs / 1000
      );
      return;
    }
    set({
      remoteControlledDeviceId: null,
      lastTransferBanner: 'Solicitando reproducción al otro dispositivo…',
    });
  },

  setRemoteControlledDevice: (deviceId) => {
    set({
      remoteControlledDeviceId: deviceId,
      ...(deviceId === null ? { remoteDeviceSnapshot: null } : {}),
    });
    if (deviceId) {
      void syncEngine.sendRemoteCommand({
        targetDeviceId: deviceId,
        type: 'request_state',
      });
    }
  },

  setSurfaceStyle: (style) => {
    applySurfaceStyleClasses(style);
    const simple = style === 'simple';
    if (typeof document !== 'undefined') {
      document.documentElement.classList.toggle(
        'pm-reduced-motion',
        simple || get().reducedMotionPref
      );
    }
    set({
      surfaceStyle: style,
      liquidGlassMode: style === 'liquid-glass',
      graphicSaverMode: simple,
    });
    persistPrefsFromStore(true);
  },

  setLiquidGlassMode: (enabled) => {
    const nextStyle: PMusicSurfaceStyle = enabled ? 'liquid-glass' : 'simple';
    get().setSurfaceStyle(nextStyle);
  },

  setAmbientMotionEnabled: (enabled) => {
    set({ ambientMotionEnabled: enabled });
    persistPrefsFromStore(true);
  },

  setGraphicSaverMode: (enabled) => {
    const nextStyle: PMusicSurfaceStyle = enabled ? 'simple' : 'liquid-glass';
    get().setSurfaceStyle(nextStyle);
  },

  setReducedMotionPref: (enabled) => {
    if (typeof document !== 'undefined') {
      document.documentElement.classList.toggle(
        'pm-reduced-motion',
        enabled || get().graphicSaverMode
      );
    }
    set({ reducedMotionPref: enabled });
    persistPrefsFromStore(true);
  },

  setTheme: (themeId) => {
    applyPMusicTheme(themeId);
    applyAccentOverride(get().accentPreset, themeId);
    set({ themeId });
    persistPrefsFromStore(true);
  },

  setPlayerBarStyle: (playerBarStyle) => {
    set({ playerBarStyle });
    persistPrefsFromStore(true);
  },

  setAccentPreset: (accentPreset) => {
    applyAccentOverride(accentPreset, get().themeId);
    set({ accentPreset });
    persistPrefsFromStore(true);
  },

  setVisualizerEnabled: (enabled) => {
    set({ visualizerEnabled: enabled });
    persistPrefsFromStore(true);
  },

  setLyricsSize: (size) => {
    set({ lyricsSize: size });
    persistPrefsFromStore(true);
  },

  setLyricsBlurEnabled: (enabled) => {
    set({ lyricsBlurEnabled: enabled });
    persistPrefsFromStore(true);
  },

  setLyricsStyle: (style) => {
    set({ lyricsStyle: style });
    persistPrefsFromStore(true);
  },

  setNowPlayingBackdropStyle: (style) => {
    const valid = parseNowPlayingBackdropStyle(style, get().nowPlayingBackdropStyle);
    set({ nowPlayingBackdropStyle: valid });
    persistPrefsFromStore(true);
  },

  setAlwaysShuffle: (enabled) => {
    set({ alwaysShuffle: enabled });
    if (enabled && !get().shuffleEnabled) {
      get().toggleShuffle();
    }
    persistPrefsFromStore(true);
  },

  setSkipSameAlbumCoverTransition: (enabled) => {
    set({ skipSameAlbumCoverTransition: enabled });
    persistPrefsFromStore(true);
  },

  setMarqueeTextEnabled: (enabled) => {
    set({ marqueeTextEnabled: enabled });
    persistPrefsFromStore(true);
  },

  setShowRemainingTime: (enabled) => {
    set({ showRemainingTime: enabled });
    persistPrefsFromStore(true);
  },

  setPlaybackRate: (rate) => {
    const safeRate = Math.max(0.5, Math.min(2.0, rate));
    audioEngine.setPlaybackRate(safeRate, get().preservesPitch);
    set({ playbackRate: safeRate });
    persistPrefsFromStore(true);
  },

  setPreservesPitch: (preserves) => {
    audioEngine.setPlaybackRate(get().playbackRate, preserves);
    set({ preservesPitch: preserves });
    persistPrefsFromStore(true);
  },

  setAudioNormalization: (enabled) => {
    const st = get();
    const curAna = st.trackAnalyses[st.currentTrack.id];
    audioEngine.setNormalization(
      enabled,
      normTargetToDb(st.normalizationTarget),
      curAna?.loudnessDb
    );
    set({ audioNormalization: enabled });
    persistPrefsFromStore(true);
  },

  setNormalizationTarget: (target) => {
    const st = get();
    const curAna = st.trackAnalyses[st.currentTrack.id];
    audioEngine.setNormalization(
      st.audioNormalization,
      normTargetToDb(target),
      curAna?.loudnessDb
    );
    set({ normalizationTarget: target });
    persistPrefsFromStore(true);
  },

  setStereoBalance: (pan) => {
    const clamped = Math.max(-1, Math.min(1, Number(pan.toFixed(2))));
    audioEngine.setBalance(clamped);
    set({ stereoBalance: clamped });
    persistPrefsFromStore();
  },

  setMonoAudio: (enabled) => {
    audioEngine.setMonoAudio(enabled);
    set({ monoAudio: enabled });
    persistPrefsFromStore(true);
  },

  setStreamQuality: (quality) => {
    currentStreamQualityPref = quality;
    setDataSaverMode(quality === 'low');
    set({ streamQuality: quality });
    persistPrefsFromStore(true);
    get().showToast(
      `Calidad de audio: ${
        quality === 'high' ? 'Alta' : quality === 'medium' ? 'Equilibrada' : 'Ahorro 3G/E'
      }`
    );
  },

  setDiscordRpcEnabled: (enabled) => {
    set({ discordRpcEnabled: enabled });
    syncDiscordPresenceState();
    persistPrefsFromStore();
    void get().refreshDiscordRpcStatus();
  },

  setDiscordRpcConfig: async (patch, reconnect = false) => {
    const merged: DiscordRpcConfig = {
      ...get().discordRpcConfig,
      ...patch,
    };
    const nextCfg: DiscordRpcConfig = {
      ...merged,
      clientId: merged.clientId.trim() || DEFAULT_DISCORD_CLIENT_ID,
    };
    set({ discordRpcConfig: nextCfg });
    persistPrefsFromStore();
    if (reconnect) {
      const status = await defaultPlatformBridge.configureDiscordRpc?.(
        nextCfg.clientId
      );
      if (status) set({ discordRpcStatus: status });
    }
    syncDiscordPresenceState();
  },

  reconnectDiscordRpc: async () => {
    const cid = get().discordRpcConfig.clientId.trim() || DEFAULT_DISCORD_CLIENT_ID;
    const status = await defaultPlatformBridge.configureDiscordRpc?.(cid);
    if (status) set({ discordRpcStatus: status });
    syncDiscordPresenceState();
  },

  refreshDiscordRpcStatus: async () => {
    const status = await defaultPlatformBridge.getDiscordRpcStatus?.();
    if (status) set({ discordRpcStatus: status });
  },

  setSleepTimer: (minutesOrEnd) => {
    if (sleepTimerInterval) {
      clearInterval(sleepTimerInterval);
      sleepTimerInterval = null;
    }
    if (minutesOrEnd === 'end_of_track') {
      set({ sleepTimerMode: 'end_of_track', sleepTimerRemainingSec: 0 });
      get().showToast('Se pausará al terminar esta canción');
      return;
    }
    const mins = Math.max(1, Math.min(180, Math.round(minutesOrEnd)));
    set({
      sleepTimerMode: 'minutes',
      sleepTimerRemainingSec: mins * 60,
    });
    sleepTimerInterval = setInterval(() => {
      const cur = get();
      if (cur.sleepTimerMode !== 'minutes') {
        if (sleepTimerInterval) clearInterval(sleepTimerInterval);
        sleepTimerInterval = null;
        return;
      }
      if (cur.sleepTimerRemainingSec <= 1) {
        if (sleepTimerInterval) clearInterval(sleepTimerInterval);
        sleepTimerInterval = null;
        audioEngine.pause();
        set({
          isPlaying: false,
          sleepTimerMode: 'off',
          sleepTimerRemainingSec: 0,
        });
        syncDiscordPresenceState();
        cur.showToast('Temporizador de sueño finalizado');
        return;
      }
      set({ sleepTimerRemainingSec: cur.sleepTimerRemainingSec - 1 });
    }, 1000);
    get().showToast(`Temporizador activo: ${mins} min`);
  },

  cancelSleepTimer: () => {
    if (sleepTimerInterval) {
      clearInterval(sleepTimerInterval);
      sleepTimerInterval = null;
    }
    set({ sleepTimerMode: 'off', sleepTimerRemainingSec: 0 });
    get().showToast('Temporizador cancelado');
  },

  setTrackInfoModalTrack: (track) => set({ trackInfoModalTrack: track }),
  setAddToPlaylistModalTrack: (track) => set({ addToPlaylistModalTrack: track }),

  exportLibraryJson: () => {
    const st = get();
    return JSON.stringify(
      {
        version: 1,
        exportedAt: new Date().toISOString(),
        playlists: st.playlists,
        likedTracks: st.likedTracks,
        seedArtists: st.seedArtists,
      },
      null,
      2
    );
  },

  importLibraryJson: async (rawJson) => {
    const parsed = JSON.parse(rawJson) as {
      playlists?: PlaylistRecord[];
      likedTracks?: LikedTrackRecord[];
    };
    let count = 0;
    for (const pl of parsed.playlists ?? []) {
      if (pl?.name && Array.isArray(pl.tracks)) {
        await libraryStore.createPlaylist({
          name: pl.name,
          description: pl.description ?? 'Importada de copia JSON',
          tracks: pl.tracks,
        });
        count++;
      }
    }
    for (const lk of parsed.likedTracks ?? []) {
      if (lk?.track && !libraryStore.isTrackLiked(lk.track.id)) {
        await libraryStore.toggleLikeTrack(lk.track);
        count++;
      }
    }
    set({
      playlists: libraryStore.getPlaylists(),
      likedTracks: libraryStore.getLikedTracks(),
    });
    scheduleLibraryCloudSync();
    get().showToast(`Copia restaurada (${count} elementos)`);
    return count;
  },

  refreshExploreDiscovery: async (force = false) => {
    const st = get();
    if (st.isLoadingExplore) return;
    if (!force && st.exploreSimilarTracks.length > 0 && st.exploreEmergingArtists.length > 0) {
      return;
    }
    set({ isLoadingExplore: true });
    try {
      const profile = recommendationEngine.getAffinityProfile();
      const topArtists = profile.slice(0, 3);
      const topKeys = new Set(
        topArtists.map((a) => a.artistName.trim().toLowerCase())
      );

      const recentPlayed = st.playHistory
        .filter((h) => h.signalType !== 'skip_early')
        .slice(0, 6)
        .map((h) => h.track);
      const likedSeedTracks = st.likedTracks.slice(0, 3).map((l) => l.track);
      const fallbackSeeds = st.homeShelves.flatMap((s) => s.tracks ?? []).slice(0, 2);
      const seedTracks = Array.from(
        new Map(
          [
            st.currentTrack,
            ...st.playlists.flatMap((p) => p.tracks.slice(0, 2)),
            ...recentPlayed,
            ...likedSeedTracks,
            ...fallbackSeeds,
          ].map((t) => [t.id, t])
        ).values()
      ).slice(0, 4);

      const [artistResults, relatedResults] = await Promise.all([
        Promise.allSettled(
          topArtists.map((a) => musicProvider.getArtist(a.artistId || a.artistName))
        ),
        Promise.allSettled(
          seedTracks.map((t) => musicProvider.getRelated(t.id))
        ),
      ]);

      const ownedPlaylistTracks = st.playlists.flatMap((p) => p.tracks);
      const ownedLikedTracks = st.likedTracks.map((l) => l.track);
      const ownedTrackIds = new Set<string>([
        st.currentTrack.id,
        ...st.playHistory.slice(0, 12).map((h) => h.trackId),
        ...ownedPlaylistTracks.map((t) => t.id),
        ...ownedLikedTracks.map((t) => t.id),
        ...st.offlineEntries.map((e) => e.trackId),
      ]);
      const ownedNormKeys = new Set<string>([
        ...ownedPlaylistTracks.map((t) => normalizeTrackMetaKey(t)),
        ...ownedLikedTracks.map((t) => normalizeTrackMetaKey(t)),
        normalizeTrackMetaKey(st.currentTrack),
      ]);

      const playlistArtistCount = new Map<string, number>();
      for (const t of ownedPlaylistTracks) {
        for (const a of t.artists) {
          const k = a.name.trim().toLowerCase();
          if (k) playlistArtistCount.set(k, (playlistArtistCount.get(k) ?? 0) + 1);
        }
      }

      const seenTitleKeys = new Set<string>();
      const candidateTrackMap = new Map<string, Track>();
      const pushCandidateTrack = (t: Track) => {
        if (!t?.id || ownedTrackIds.has(t.id)) return;
        const normKey = normalizeTrackMetaKey(t);
        if (ownedNormKeys.has(normKey) || seenTitleKeys.has(normKey)) return;
        seenTitleKeys.add(normKey);
        candidateTrackMap.set(t.id, t);
      };

      const emergingPool = new Map<
        string,
        { artist: ArtistSummary; score: number }
      >();
      const addEmergingCandidate = (artist: ArtistSummary, baseBoost: number) => {
        const cleanName = artist.name.trim();
        const key = cleanName.toLowerCase();
        if (!cleanName || topKeys.has(key)) return;
        if ((playlistArtistCount.get(key) ?? 0) >= 3) return;
        const fans = parseFanCountText(artist.subscribersText);
        // Strictly filter mega-mainstream stars out of "Artistas emergentes para descubrir"
        if (fans >= 3_000_000) return;
        const emergingSweetSpot =
          fans > 20 && fans < 250_000
            ? 50
            : fans >= 250_000 && fans < 1_500_000
              ? 18
              : fans === 0
                ? 24
                : 4;
        const affinityBoost = recommendationEngine.getEffectiveAffinity(cleanName) * 1.5;
        const total = baseBoost + emergingSweetSpot + affinityBoost;
        const existing = emergingPool.get(key);
        if (!existing || total > existing.score) {
          emergingPool.set(key, { artist, score: total });
        }
      };

      const relatedArtistsToFetch: ArtistSummary[] = [];
      for (const r of artistResults) {
        if (r.status !== 'fulfilled') continue;
        for (const rel of r.value.relatedArtists ?? []) {
          addEmergingCandidate(rel, 35);
          relatedArtistsToFetch.push(rel);
        }
        for (const t of r.value.topSongs ?? []) {
          if (t.artists.length > 1) {
            pushCandidateTrack(t);
            for (const co of t.artists) {
              if (!topKeys.has(co.name.trim().toLowerCase())) {
                addEmergingCandidate(
                  {
                    id: co.id ?? co.name,
                    name: co.name,
                    thumbnailUrl: t.thumbnailUrl,
                    subscribersText: 'Colaboración en escena',
                  },
                  28
                );
              }
            }
          }
        }
      }

      for (const relRes of relatedResults) {
        if (relRes.status !== 'fulfilled') continue;
        for (const t of relRes.value.tracks ?? []) {
          pushCandidateTrack(t);
        }
        for (const relAr of relRes.value.artists ?? []) {
          addEmergingCandidate(relAr, 30);
          relatedArtistsToFetch.push(relAr);
        }
      }

      // Fetch top tracks of up to 5 discovered emerging/related artists for fresh discoveries
      const topRelatedPick = Array.from(emergingPool.values())
        .sort((a, b) => b.score - a.score)
        .slice(0, 5)
        .map((x) => x.artist);
      if (topRelatedPick.length > 0) {
        const extraArtistDetails = await Promise.allSettled(
          topRelatedPick.map((a) => musicProvider.getArtist(a.id || a.name))
        );
        for (const res of extraArtistDetails) {
          if (res.status !== 'fulfilled') continue;
          for (const t of res.value.topSongs.slice(0, 4)) {
            pushCandidateTrack(t);
          }
          for (const rel of (res.value.relatedArtists ?? []).slice(0, 4)) {
            addEmergingCandidate(rel, 24);
          }
        }
      }

      const similarPool =
        candidateTrackMap.size > 0
          ? Array.from(candidateTrackMap.values())
          : [...FALLBACK_TRACKS].filter(
              (t) => !ownedTrackIds.has(t.id) && !ownedNormKeys.has(normalizeTrackMetaKey(t))
            );

      const exploreSimilarTracks = recommendationEngine.rerankTracks(similarPool, {
        maxPerArtistInWindow: 2,
        limit: 12,
      });

      const fallbackEmerging = FALLBACK_ARTISTS.filter(
        (a) => !topKeys.has(a.name.trim().toLowerCase())
      );
      const exploreEmergingArtists =
        emergingPool.size > 0
          ? Array.from(emergingPool.values())
              .sort((a, b) => b.score - a.score)
              .map((x) => x.artist)
              .slice(0, 12)
          : fallbackEmerging;

      set({
        exploreSimilarTracks,
        exploreEmergingArtists,
        isLoadingExplore: false,
      });
    } catch {
      set({ isLoadingExplore: false });
    }
  },
  };
});

// Attach native Electron & Android OAuth callback listeners immediately on module load
// so Google OAuth callbacks are NEVER missed while initApp() is still hydrating.
if (typeof window !== 'undefined') {
  let lastHandledAuthUrl = '';
  const dispatchOAuthOnce = (cbUrl: string) => {
    if (!cbUrl || cbUrl === lastHandledAuthUrl) return;
    lastHandledAuthUrl = cbUrl;
    void usePMusicStore.getState().handleAuthCallbackUrl(cbUrl);
  };
  (window as any).__pmusicHandleAuthCallback = dispatchOAuthOnce;
  (window as any).__pmusicSetAppBackgrounded = (bg: boolean) => {
    (window as any).__pmusicAppBackgrounded = Boolean(bg);
    try {
      window.dispatchEvent(new CustomEvent('pmusic-bg-change', { detail: Boolean(bg) }));
    } catch {
      // ignore
    }
  };
  const desktopBridge = (window as any).pmusicDesktop;
  if (desktopBridge?.onAuthCallback) {
    desktopBridge.onAuthCallback(dispatchOAuthOnce);
  }
  if (desktopBridge?.consumePendingAuthCallback) {
    void desktopBridge.consumePendingAuthCallback().then((pending: string | null) => {
      if (pending) dispatchOAuthOnce(pending);
    });
  }
  const androidNative = (window as any).PMusicNative;
  if (androidNative?.consumePendingAuthCallback) {
    try {
      const pending = androidNative.consumePendingAuthCallback();
      if (pending) dispatchOAuthOnce(pending);
    } catch {
      // ignore
    }
  }

  let prevHome = usePMusicStore.getState().homeShelves;
  let prevPl = usePMusicStore.getState().playlists;
  let prevLiked = usePMusicStore.getState().likedTracks;
  let prevPresenceTrackId = usePMusicStore.getState().currentTrack?.id;
  let prevPresencePlaying = usePMusicStore.getState().isPlaying;
  let prevPresenceShare = usePMusicStore.getState().shareListeningActivity;
  let carSyncTimer: ReturnType<typeof setTimeout> | null = null;
  let presenceSyncTimer: ReturnType<typeof setTimeout> | null = null;
  usePMusicStore.subscribe((st) => {
    if (
      st.currentTrack?.id !== prevPresenceTrackId ||
      st.isPlaying !== prevPresencePlaying ||
      st.shareListeningActivity !== prevPresenceShare
    ) {
      prevPresenceTrackId = st.currentTrack?.id;
      prevPresencePlaying = st.isPlaying;
      prevPresenceShare = st.shareListeningActivity;
      if (presenceSyncTimer) clearTimeout(presenceSyncTimer);
      presenceSyncTimer = setTimeout(() => {
        presenceSyncTimer = null;
        triggerPresenceSync?.();
      }, 300);
    }
    if (st.homeShelves !== prevHome || st.playlists !== prevPl || st.likedTracks !== prevLiked) {
      prevHome = st.homeShelves;
      prevPl = st.playlists;
      prevLiked = st.likedTracks;
      if (carSyncTimer) clearTimeout(carSyncTimer);
      carSyncTimer = setTimeout(() => {
        carSyncTimer = null;
        const nativeBridge = (window as unknown as {
          PMusicNative?: { syncCarLibrary?: (json: string) => void };
        }).PMusicNative;
        if (!nativeBridge?.syncCarLibrary) return;
        try {
          const cur = usePMusicStore.getState();
          const mapMini = (t: Track) => ({
            id: t.id,
            title: t.title,
            artist: t.artists.map((a) => a.name).join(', '),
            art: t.thumbnailUrl ?? '',
            durationSec: t.durationSec,
          });
          const seen = new Set<string>();
          const recents: ReturnType<typeof mapMini>[] = [];
          for (const h of cur.playHistory) {
            if (h.track && !seen.has(h.track.id)) {
              seen.add(h.track.id);
              recents.push(mapMini(h.track));
            }
            if (recents.length >= 16) break;
          }
          for (const s of cur.homeShelves) {
            for (const t of s.tracks ?? []) {
              if (!seen.has(t.id)) {
                seen.add(t.id);
                recents.push(mapMini(t));
              }
              if (recents.length >= 18) break;
            }
            if (recents.length >= 18) break;
          }
          nativeBridge.syncCarLibrary(
            JSON.stringify({
              recents,
              liked: cur.likedTracks.slice(0, 20).map((l) => mapMini(l.track)),
              playlists: cur.playlists.slice(0, 14).map((p) => ({
                id: p.id,
                name: p.name,
                count: p.tracks.length,
                art: p.coverUrl ?? p.tracks[0]?.thumbnailUrl ?? '',
              })),
            })
          );
        } catch {
          // ignore Android Auto snapshot error
        }
      }, 250);
    }
  });
}
