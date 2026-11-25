import { create } from 'zustand';
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
  computeWrappedSummary,
  isWrappedSeason,
  loadLocalWrappedEvents,
  mergeWrappedEvents,
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
import { LibraryStore, SyncEngine } from '@pmusic/sync';
import {
  defaultPlatformBridge,
  isElectronDesktopRuntime,
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
export type NowPlayingSubTab = 'Portada' | 'Letras' | 'Cola';
export type SearchScopeTab = 'Todo' | 'Canciones' | 'Artistas' | 'Álbumes' | 'Playlists';
export type LibraryCategoryTab = 'Todo' | 'Playlists' | 'Me gusta' | 'Descargas' | 'Historial';
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
  | null;

const DETAIL_CLIENT_CACHE_TTL_MS = 15 * 60_000;
const artistClientCache = new Map<string, { at: number; data: ArtistDetail }>();
const albumClientCache = new Map<string, { at: number; data: AlbumDetail }>();
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
const decodedAudioAnalyzedIds = new Set<string>();
const decodedAudioInFlightIds = new Set<string>();
const hydratedContributorIds = new Set<string>();

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
  'fluid',
  'paint',
  'pulse',
  'minimal',
];

function parseNowPlayingBackdropStyle(
  value: unknown,
  fallback: NowPlayingBackdropStyle = 'fluid'
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
    return 'fluid';
  }
  return fallback;
}

const HOME_SHELVES_CACHE_KEY = 'pmusic_home_shelves_cache_v1';

function readCachedHomeShelves(): HomeEditorialShelf[] | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(HOME_SHELVES_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0 ? (parsed as HomeEditorialShelf[]) : null;
  } catch {
    return null;
  }
}

function saveCachedHomeShelves(shelves: HomeEditorialShelf[]): void {
  try {
    if (typeof localStorage === 'undefined' || !shelves || shelves.length === 0) return;
    localStorage.setItem(HOME_SHELVES_CACHE_KEY, JSON.stringify(shelves.slice(0, 6)));
  } catch {
    // ignore storage quota errors
  }
}

async function preloadTopHomeCovers(shelves: HomeEditorialShelf[]): Promise<void> {
  if (typeof Image === 'undefined') return;
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const shelf of shelves) {
    for (const t of shelf.tracks ?? []) {
      const u = t.thumbnailUrl;
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
let cloudLibrarySyncTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleLibraryCloudSync(): void {
  if (cloudLibrarySyncTimer) clearTimeout(cloudLibrarySyncTimer);
  cloudLibrarySyncTimer = setTimeout(() => {
    cloudLibrarySyncTimer = null;
    if (syncEngine.getAuthState().connected) {
      void syncEngine.syncNow();
    }
  }, 600);
}

function applyAmbientPaletteForTrack(track: Track | null, durationMs = 1100): void {
  applyAmbientPaletteFromCover(track, durationMs);
}

function normalizeTrackMetaKey(t: Track): string {
  const title = (t.title ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  const artist = (t.artists?.[0]?.name ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  return `${title}::${artist}`;
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
  trackMenu: TrackMenuState;
  toastMessage: string | null;

  // Playback & Audio
  currentTrack: Track;
  queue: Track[];
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
  likedTracks: LikedTrackRecord[];
  playHistory: PlayHistoryRecord[];
  offlineDownloads: Record<string, OfflineDownloadStatus>;
  offlineEntries: OfflineAudioEntry[];

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

  // Onboarding, Profile & Wrapped
  authOnboardingOpen: boolean;
  needsProfileSetup: boolean;
  userProfile: UserProfile | null;
  authCallbackError: string | null;
  wrappedModalOpen: boolean;
  wrappedSummary: WrappedSummary | null;
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
  setSpotlightOpen: (open: boolean) => void;
  openArtistDetail: (
    artistId: string,
    hint?: { name?: string; thumbnailUrl?: string }
  ) => Promise<void>;
  openAlbumDetail: (
    albumId: string,
    hint?: { title?: string; artist?: string; thumbnailUrl?: string }
  ) => Promise<void>;
  openPlaylistDetail: (playlistId: string) => Promise<void>;
  fetchTrackCredits: (track: Track) => Promise<TrackCredits | null>;
  openLocalPlaylistDetail: (playlistId: string) => void;
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
  duplicatePlaylist: (playlistId: string) => Promise<PlaylistRecord | null>;
  copyPlaylistTracksTo: (sourcePlaylistId: string, targetPlaylistId: string) => Promise<number>;
  addTrackToPlaylist: (playlistId: string, track: Track) => Promise<void>;
  removeTrackFromPlaylist: (playlistId: string, trackId: string) => Promise<void>;
  reorderPlaylistTrack: (playlistId: string, fromIndex: number, toIndex: number) => Promise<void>;
  likeTrackIfNeeded: (track: Track) => Promise<void>;
  searchTracksForPlaylist: (query: string) => Promise<Track[]>;
  dismissPlaylistRecommendation: (playlistId: string, trackId: string) => void;
  fetchPlaylistRecommendations: (
    playlistId: string,
    options?: { seedTrack?: Track; excludeIds?: string[] }
  ) => Promise<Track[]>;
  toggleLike: (track?: Track) => Promise<void>;
  downloadTrackOffline: (track: Track) => Promise<void>;
  removeOfflineTrack: (trackId: string) => Promise<void>;
  clearOfflineCache: () => Promise<void>;

  // Importer Actions
  setImportUrlInput: (url: string) => void;
  startPlaylistImport: (url?: string) => Promise<void>;
  cancelPlaylistImport: () => void;
  saveImportedPlaylistToLibrary: () => Promise<void>;

  // Sync & Connect Actions
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
  exportLibraryJson: () => string;
  importLibraryJson: (rawJson: string) => Promise<number>;
  refreshExploreDiscovery: (force?: boolean) => Promise<void>;
}

const initialTrack = FALLBACK_TRACKS[0]!;
const initialBundle = {
  query: '',
  topResult: { kind: 'artist' as const, item: FALLBACK_ARTISTS[0]! },
  songs: [...FALLBACK_TRACKS],
  videos: FALLBACK_TRACKS.slice(0, 4),
  artists: [...FALLBACK_ARTISTS],
  albums: [...FALLBACK_ALBUMS],
  playlists: [...FALLBACK_PLAYLISTS],
};

let initialized = false;
let previousVolumeBeforeMute = 0.85;

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
          Math.abs(curBeforeUpdate.transitionProgress01 - engineState.transitionProgress01) >= 0.08 ||
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
    const mediaSessionKey = `${activeTrack.id}|${engineState.isPlaying}|${Math.round(safeDur)}`;
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

  function buildLocalTasteSnapshot(): AccountTasteProfile {
    const st = get();
    return buildCompactAccountTasteProfile({
      affinities: recommendationEngine.getAffinityProfile(),
      playHistory: libraryStore.getPlayHistory(),
      seedArtists: recommendationEngine.getSeedArtists(),
      playlistPlayCounts: st.playlistPlayCounts,
    });
  }

  async function hydrateAndMergeCloudTaste(cloudPrefs: Record<string, any> | null | undefined): Promise<void> {
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

    set({
      playlistPlayCounts: merged.playlistPlayCounts,
      affinityProfile: recommendationEngine.getAffinityProfile(),
      playHistory: libraryStore.getPlayHistory(),
      seedArtists: recommendationEngine.getSeedArtists(),
    });

    // Trigger immediate shelf refresh under the latest epoch so merged account taste wins over initial cold shelves
    const myEpoch = ++homeShelvesBuildEpoch;
    try {
      const freshShelves = await recommendationEngine.buildHomeShelves();
      if (myEpoch !== homeShelvesBuildEpoch) return;
      const allReal = Array.from(
        new Map(freshShelves.flatMap((s) => s.tracks ?? []).map((t) => [t.id, t])).values()
      );
      set((prev) => ({
        homeShelves: freshShelves,
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

    if (get().authState.connected && (!remoteTaste || merged.richnessScore > (remoteTaste.richnessScore ?? 0))) {
      persistPrefsFromStore();
    }
  }

  function persistPrefsFromStore(): void {
    const st = get();
    const tasteProfile = buildCompactAccountTasteProfile({
      affinities: recommendationEngine.getAffinityProfile(),
      playHistory: libraryStore.getPlayHistory(),
      seedArtists: recommendationEngine.getSeedArtists(),
      playlistPlayCounts: st.playlistPlayCounts,
    });
    const payload = {
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
      skipSameAlbumCoverTransition: st.skipSameAlbumCoverTransition,
      marqueeTextEnabled: st.marqueeTextEnabled,
      showRemainingTime: st.showRemainingTime,
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
      dismissedPlaylistRecs: st.dismissedPlaylistRecs,
      playlistPlayCounts: st.playlistPlayCounts,
      tasteProfile,
    };
    void defaultPlatformBridge.preferencesStorage
      .setItem(USER_PREFS_STORAGE_KEY, JSON.stringify(payload))
      .catch(() => {});

    if (st.authState.connected) {
      if (cloudPrefsSaveTimer) clearTimeout(cloudPrefsSaveTimer);
      cloudPrefsSaveTimer = setTimeout(() => {
        cloudPrefsSaveTimer = null;
        if (get().authState.connected) {
          void syncEngine.saveAccountPreferences?.(payload);
        }
      }, 1200);
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
      skipSameAlbumCoverTransition: Boolean(
        prefs.skipSameAlbumCoverTransition ?? prev.skipSameAlbumCoverTransition
      ),
      marqueeTextEnabled: Boolean(prefs.marqueeTextEnabled ?? prev.marqueeTextEnabled),
      showRemainingTime: Boolean(prefs.showRemainingTime ?? prev.showRemainingTime),
      ...(Boolean(prefs.alwaysShuffle ?? prev.alwaysShuffle) ? { shuffleEnabled: true } : {}),
      discordRpcEnabled: Boolean(prefs.discordRpcEnabled ?? prev.discordRpcEnabled),
      discordRpcConfig: {
        ...prev.discordRpcConfig,
        ...(prefs.discordRpcConfig ?? {}),
        clientId:
          prefs.discordRpcConfig?.clientId || prev.discordRpcConfig.clientId,
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
      playlistPlayCounts:
        prefs.playlistPlayCounts && typeof prefs.playlistPlayCounts === 'object'
          ? (prefs.playlistPlayCounts as Record<string, PlaylistPlayStat>)
          : prev.playlistPlayCounts,
    }));
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
  spotlightOpen: false,
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
  nowPlayingBackdropStyle: 'fluid',
  alwaysShuffle: false,
  skipSameAlbumCoverTransition: true,
  marqueeTextEnabled: true,
  showRemainingTime: true,
  discordRpcEnabled: true,
  discordRpcConfig: {
    clientId: '',
    showTimestamps: true,
    showArtwork: true,
    showWhenPaused: true,
    displayMode: 'song',
  },
  discordRpcStatus: {
    connected: false,
    status: 'needs_client_id',
    clientId: '',
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
  trackMenu: null,
  toastMessage: null,

  currentTrack: initialTrack,
  queue: [...FALLBACK_TRACKS],
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

  homeShelves: [
    {
      id: 'shelf_listen_again',
      kind: 'listen_again',
      title: 'Escuchar de nuevo',
      subtitle: 'Tus temas recientes y favoritos al instante',
      tracks: FALLBACK_TRACKS.slice(0, 8),
    },
    {
      id: 'shelf_mixes_for_you',
      kind: 'mixes_for_you',
      title: 'Mixes para ti',
      subtitle: 'Generados por tu algoritmo con Modo Sesión DJ',
      mixes: [
        {
          id: 'mix_cruz_urbano_es',
          title: 'Mix Cruz Cafuné',
          subtitle: 'Cruz Cafuné, La Pantera, Quevedo y escena urbana ES',
          coverUrl: FALLBACK_TRACKS[0]!.thumbnailUrl,
          accentColor: '#BF5AF2',
          tracks: FALLBACK_TRACKS.slice(0, 8),
        },
        {
          id: 'mix_trap_canarias',
          title: 'Mix La Pantera & Canarias',
          subtitle: 'La Pantera, Cruz Cafuné, Juseph y trap isleño',
          coverUrl: FALLBACK_TRACKS[3]!.thumbnailUrl,
          accentColor: '#0A84FF',
          tracks: [...FALLBACK_TRACKS.slice(2), ...FALLBACK_TRACKS.slice(0, 2)],
        },
        {
          id: 'mix_sesion_dj_club',
          title: 'Sesión DJ: Bad Bunny & Urbano',
          subtitle: 'Bad Bunny, Saiko, Morad y himnos de club',
          coverUrl: FALLBACK_TRACKS[5]!.thumbnailUrl,
          accentColor: '#30D158',
          tracks: [...FALLBACK_TRACKS].reverse(),
        },
      ],
    },
    {
      id: 'shelf_because_you_listened',
      kind: 'because_you_listened',
      title: 'Porque escuchaste a Cruz Cafuné',
      subtitle: 'Recomendaciones adaptadas a tu perfil urbano',
      anchorArtist: 'Cruz Cafuné',
      tracks: FALLBACK_TRACKS.slice(0, 8),
    },
    {
      id: 'shelf_favorite_new_releases',
      kind: 'favorite_new_releases',
      title: 'Novedades de tus artistas favoritos',
      subtitle: 'Lanzamientos destacados de Bad Bunny, La Pantera y Cruz Cafuné',
      albums: [...FALLBACK_ALBUMS],
      tracks: FALLBACK_TRACKS.slice(0, 6),
    },
  ],
  searchQuery: '',
  isSearching: false,
  searchScope: 'Todo',
  searchResults: initialBundle,
  bestResult: initialBundle.topResult,
  autocompleteSuggestions: recommendationEngine.rankAutocomplete('', []),
  recentSearches: ['Cruz Cafuné', 'La Pantera', 'Bad Bunny'],
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
  likedTracks: [],
  playHistory: [],
  offlineDownloads: {},
  offlineEntries: [],

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
  wrappedModalOpen: false,
  wrappedSummary: null,
  wrappedSeasonActive: isWrappedSeason(),
  wrappedLocalCount: loadLocalWrappedEvents().length,

  initApp: async () => {
    ensureAudioEngineBindings();
    if (initialized) return;
    initialized = true;

    try {
      await libraryStore.hydrate();
    } catch {
      // ignore hydration failure
    }
    try {
      await recommendationEngine.hydrate();
    } catch {
      // ignore hydration failure
    }
    let ranV3Migration = false;
    try {
      const migrated = await defaultPlatformBridge.preferencesStorage.getItem(
        HOME_HISTORY_MIGRATION_KEY
      );
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
    await audioEngine.init();
    try {
      await syncEngine.connectRealtime();
    } catch {
      // ignore offline/sync error so initApp never stalls
    }

    // Ensure at least one companion peer device is visible in Dispositivos for smooth cross-device demo/E2E
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

    let offlineEntries: OfflineAudioEntry[] = [];
    try {
      offlineEntries = await defaultPlatformBridge.offlineStorage.listOfflineIds();
    } catch {
      offlineEntries = [];
    }
    const offlineDownloads: Record<string, OfflineDownloadStatus> = {};
    for (const entry of offlineEntries) {
      offlineDownloads[entry.trackId] = 'downloaded';
    }

    // Pre-analyze initial fallback catalog for DJ badges
    const analyses: Record<string, TrackAnalysis> = {};
    for (const track of FALLBACK_TRACKS) {
      analyses[track.id] = await djPlanner.analyzeTrack(track.id, null, track.durationSec);
    }

    let shelves: HomeEditorialShelf[] = [];
    const cachedHome = readCachedHomeShelves();
    if (cachedHome && cachedHome.length > 0 && get().homeShelves.length <= 2) {
      set({ homeShelves: cachedHome });
    }
    const preAuthEpoch = ++homeShelvesBuildEpoch;
    try {
      const builtShelves = await recommendationEngine.buildHomeShelves();
      shelves = preAuthEpoch === homeShelvesBuildEpoch ? builtShelves : get().homeShelves;
      saveCachedHomeShelves(shelves);
    } catch {
      shelves = cachedHome ?? get().homeShelves;
    }
    for (const shelf of shelves) {
      for (const track of shelf.tracks ?? []) {
        if (!analyses[track.id]) {
          analyses[track.id] = await djPlanner.analyzeTrack(track.id, null, track.durationSec);
        }
      }
    }

    let hydratedRecentItems = get().recentSearchItems;
    try {
      const rawRecent = await defaultPlatformBridge.preferencesStorage.getItem(
        RECENT_SEARCH_ITEMS_STORAGE_KEY
      );
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
      const rawPrefs = await defaultPlatformBridge.preferencesStorage.getItem(
        USER_PREFS_STORAGE_KEY
      );
      if (rawPrefs) {
        hydratedPrefs = JSON.parse(rawPrefs) as Record<string, any>;
      }
    } catch {
      hydratedPrefs = null;
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
    }

    if (isMobileHardwareVolumeRuntime()) {
      audioEngine.setVolume(1.0);
    }

    const rpcStatus = await defaultPlatformBridge.getDiscordRpcStatus?.();
    const restoredAuth = await syncEngine.restoreSession();
    const restoredProfile = restoredAuth.connected
      ? ((await syncEngine.getProfile?.()) ?? null)
      : null;

    set((prev) => ({
      ...(isMobileHardwareVolumeRuntime() ? { volume: 1.0 } : {}),
      authState: restoredAuth,
      userProfile: restoredProfile,
      needsProfileSetup: restoredAuth.connected && !restoredProfile,
      playlists: libraryStore.getPlaylists(),
      likedTracks: libraryStore.getLikedTracks(),
      playHistory: libraryStore.getPlayHistory(),
      seedArtists: recommendationEngine.getSeedArtists(),
      affinityProfile: recommendationEngine.getAffinityProfile(),
      recentSearchItems: hydratedRecentItems,
      offlineEntries,
      offlineDownloads,
      trackAnalyses: analyses,
      homeShelves: shelves,
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
            ambientMotionEnabled: Boolean(hydratedPrefs.ambientMotionEnabled ?? prev.ambientMotionEnabled),
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
            ...(Boolean(hydratedPrefs.alwaysShuffle ?? prev.alwaysShuffle)
              ? { shuffleEnabled: true }
              : {}),
            discordRpcEnabled: Boolean(hydratedPrefs.discordRpcEnabled ?? prev.discordRpcEnabled),
            discordRpcConfig: {
              ...prev.discordRpcConfig,
              ...(hydratedPrefs.discordRpcConfig ?? {}),
              clientId:
                hydratedPrefs.discordRpcConfig?.clientId || rpcStatus?.clientId || prev.discordRpcConfig.clientId,
            },
            playbackRate: Number(hydratedPrefs.playbackRate ?? prev.playbackRate),
            preservesPitch: Boolean(hydratedPrefs.preservesPitch ?? prev.preservesPitch),
            audioNormalization: Boolean(hydratedPrefs.audioNormalization ?? prev.audioNormalization),
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
          }
        : {}),
    }));

    let cloudTasteMerged = false;
    if (restoredAuth.connected) {
      try {
        const cloudPrefs = await syncEngine.loadAccountPreferences?.();
        if (cloudPrefs) {
          applyPreferencesPayload(cloudPrefs);
          void defaultPlatformBridge.preferencesStorage
            .setItem(USER_PREFS_STORAGE_KEY, JSON.stringify(cloudPrefs))
            .catch(() => {});
          await hydrateAndMergeCloudTaste(cloudPrefs);
          cloudTasteMerged = true;
        }
      } catch {
        // ignore offline cloud prefs load
      }
      if (!cloudTasteMerged) {
        await hydrateAndMergeCloudTaste(null);
      }
    }

    const activeShelves = cloudTasteMerged ? get().homeShelves : shelves;
    const allRealTracks = Array.from(
      new Map(activeShelves.flatMap((s) => s.tracks ?? []).map((t) => [t.id, t])).values()
    );
    const firstReal = allRealTracks[0];
    if (firstReal && !get().isPlaying && !cloudTasteMerged) {
      const listenTracks = activeShelves.find((s) => s.kind === 'listen_again')?.tracks ?? [];
      const baseQueue = (listenTracks.length > 0 ? listenTracks : allRealTracks).slice(0, 10);
      const qIds = new Set(baseQueue.map((t) => t.id));
      const initialRec = allRealTracks.filter((t) => !qIds.has(t.id)).slice(0, 10);
      const keepShuffle = get().alwaysShuffle || get().shuffleEnabled;
      const realQueue =
        keepShuffle && baseQueue.length > 1
          ? [firstReal, ...fisherYatesShuffle(baseQueue.filter((t) => t.id !== firstReal.id))]
          : baseQueue;
      set({
        currentTrack: firstReal,
        queue: realQueue,
        ...(keepShuffle ? { unshuffledQueue: baseQueue, shuffleEnabled: true } : {}),
        recommendedQueue: initialRec,
        queueIndex: 0,
        durationSec: firstReal.durationSec,
        positionSec: 0,
      });
    }

    if (isLiveRuntime() && !get().searchQuery) {
      void musicProvider.search('', 'all').then((bundle) => {
        if (!get().searchQuery && bundle.songs.length > 0) {
          const reranked = recommendationEngine.rerankTracks(bundle.songs);
          set({
            searchResults: { ...bundle, songs: reranked },
            bestResult: recommendationEngine.selectBestResult('', { ...bundle, songs: reranked }),
          });
        }
      }).catch(() => {});
    }

    applyAmbientPaletteForTrack(get().currentTrack);
    void get().loadLyricsForTrack(get().currentTrack);
    if (isLiveRuntime()) {
      await preloadTopHomeCovers(get().homeShelves);
    }
    set({ appReady: true });
    syncAndroidAutoLibrarySnapshot();
    if (isLiveRuntime()) {
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

    // Wire native & web OAuth deep-link callbacks (Google Sign-In)
    if (typeof window !== 'undefined') {
      (window as any).__pmusicHandleAuthCallback = (cbUrl: string) => {
        if (cbUrl) void get().handleAuthCallbackUrl(cbUrl);
      };
      const desktopBridge = (window as any).pmusicDesktop;
      if (desktopBridge?.onAuthCallback) {
        desktopBridge.onAuthCallback((cbUrl: string) => {
          if (cbUrl) void get().handleAuthCallbackUrl(cbUrl);
        });
      }
      if (desktopBridge?.consumePendingAuthCallback) {
        void desktopBridge.consumePendingAuthCallback().then((pending: string | null) => {
          if (pending) void get().handleAuthCallbackUrl(pending);
        });
      }
      const androidNative = (window as any).PMusicNative;
      if (androidNative?.consumePendingAuthCallback) {
        try {
          const pending = androidNative.consumePendingAuthCallback();
          if (pending) void get().handleAuthCallbackUrl(pending);
        } catch {
          // ignore
        }
      }
      const href = window.location?.href ?? '';
      if (href.includes('code=') || href.includes('access_token=')) {
        void get().handleAuthCallbackUrl(href);
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
  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
  setRightPanelOpen: (open) => set({ rightPanelOpen: open }),
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
      checkLivePlaybackTriggers(audioEngine.getState());
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
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  setSpotlightOpen: (open) => set({ spotlightOpen: open }),

  openArtistDetail: async (artistId, hint) => {
    const cleanId = artistId.trim();
    const normKey = `artist:${cleanId.toLowerCase()}`;
    const nameKey = hint?.name ? `artist:${hint.name.trim().toLowerCase()}` : null;
    const cached =
      readClientCache(artistClientCache, normKey) ??
      (nameKey ? readClientCache(artistClientCache, nameKey) : null);

    const prev = get().activeDetailView;
    const seq = ++detailRequestSeq;
    const transitionKey = cleanId || hint?.name || 'artist';

    if (cached) {
      set((s) => ({
        detailViewHistory:
          prev && !(prev.kind === 'artist' && prev.data.artist.id === cached.artist.id)
            ? [...s.detailViewHistory, prev].slice(-12)
            : s.detailViewHistory,
        activeDetailView: { kind: 'artist', data: cached, isLoading: false, transitionKey },
        spotlightOpen: false,
        nowPlayingOpen: false,
      }));
      return;
    }

    const displayName =
      hint?.name?.trim() ||
      (!/^\d+$/.test(cleanId) && !cleanId.startsWith('UC') ? cleanId : 'Cargando artista…');
    const optimisticData: ArtistDetail = {
      artist: {
        id: cleanId,
        name: displayName,
        thumbnailUrl: hint?.thumbnailUrl ?? '',
      },
      bannerUrl: hint?.thumbnailUrl || undefined,
      topSongs: [],
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
      artistId,
      undefined,
      hint?.name ? { name: hint.name } : undefined
    );
    writeClientCache(artistClientCache, normKey, data);
    writeClientCache(artistClientCache, `artist:${data.artist.id.toLowerCase()}`, data);
    writeClientCache(artistClientCache, `artist:${data.artist.name.trim().toLowerCase()}`, data);

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
  openAlbumDetail: async (albumId, hint) => {
    const cleanId = albumId.trim();
    const normKey = `album:${cleanId.toLowerCase()}`;
    const cached = readClientCache(albumClientCache, normKey);
    const prev = get().activeDetailView;
    const seq = ++detailRequestSeq;
    const transitionKey = cleanId || hint?.title || 'album';

    if (cached) {
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

  playTrack: async (track, newQueue, startSec, direction = 'next') => {
    ensureAudioEngineBindings();
    if (seekAutoTriggerTimer) {
      clearTimeout(seekAutoTriggerTimer);
      seekAutoTriggerTimer = null;
    }
    const mySwitchEpoch = ++manualSwitchEpoch;
    manualTrackSwitchInFlight = true;
    try {
      const st = get();
      if (st.currentTrack && st.currentTrack.id !== track.id && st.positionSec >= 30) {
        recordWrappedListenIfEligible(
          st.currentTrack,
          st.positionSec,
          st.activeTab.toLowerCase(),
          false
        );
      }
      const rawQueue = newQueue && newQueue.length > 0 ? [...newQueue] : st.queue;
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

      set({
        currentTrack: track,
        lastTrackDirection: direction,
        queue,
        unshuffledQueue,
        shuffleEnabled: nextShuffleEnabled,
        queueIndex: idx,
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

      // Lazy full-credits contributor hydration if playing a single-credit Deezer track
      void hydrateTrackContributorsIfNeeded(track);

      void syncEngine.updatePresence({
        is_active: true,
        is_playing: true,
        track_title: `${track.title} — ${track.artists.map((a) => a.name).join(', ')}`,
      });
      syncDiscordPresenceState();

      if (
        isLiveRuntime() &&
        (get().recommendedQueue.length < 5 || (newQueue && newQueue.length === 1))
      ) {
        void get().replenishRecommendedQueue(Boolean(newQueue && newQueue.length === 1));
      }
      const nextCandidate = getUpcomingDjTarget(get())?.track;
      if (nextCandidate && nextCandidate.id !== track.id) {
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

  togglePlayPause: async () => {
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
      }
    }
  },

  nextTrack: async (isAutoAdvance = false) => {
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

      let target = getUpcomingDjTarget(st);
      if (!target && st.autoplayEnabled) {
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
      } else if (latest.repeatMode === 'all' && target.nextIdx === 0 && latest.queue.length > 1) {
        nextQueue = latest.queue;
      } else {
        // Consumed tracks before nextIdx drop off from active queue automatically
        nextQueue = latest.queue.slice(Math.max(0, target.nextIdx));
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
  },

  cycleRepeatMode: () => {
    const cur = get().repeatMode;
    const next: RepeatMode = cur === 'off' ? 'all' : cur === 'all' ? 'one' : 'off';
    set({ repeatMode: next });
    void recomputeActiveDjPlan();
  },

  seekTo: (positionSec) => {
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
    const copy = [...st.queue];
    const [moved] = copy.splice(fromIndex, 1);
    if (!moved) return;
    copy.splice(toIndex, 0, moved);
    const newCurrentIdx = copy.findIndex((t) => t.id === st.currentTrack.id);
    set({
      queue: copy,
      queueIndex: newCurrentIdx >= 0 ? newCurrentIdx : 0,
    });
    void recomputeActiveDjPlan();
  },

  removeQueueItem: (index) => {
    const st = get();
    if (st.queue.length <= 1 || index < 0 || index >= st.queue.length) return;
    const copy = st.queue.filter((_, idx) => idx !== index);
    const newCurrentIdx = Math.max(
      0,
      copy.findIndex((t) => t.id === st.currentTrack.id)
    );
    set({
      queue: copy,
      queueIndex: newCurrentIdx,
    });
    void recomputeActiveDjPlan();
  },

  clearUpNextQueue: () => {
    const st = get();
    const kept = st.currentTrack;
    djPreloadedKey = '';
    set({
      queue: [kept],
      unshuffledQueue: st.shuffleEnabled ? [kept] : st.unshuffledQueue,
      queueIndex: 0,
      activeTransitionPlan: null,
    });
    st.showToast('Cola limpiada');
  },

  addToQueue: (track) => {
    const st = get();
    if (st.queue.some((t) => t.id === track.id)) {
      const idx = st.queue.findIndex((t) => t.id === track.id);
      if (idx !== st.queueIndex) {
        const copy = st.queue.filter((t) => t.id !== track.id);
        copy.push(track);
        const curIdx = Math.max(
          0,
          copy.findIndex((t) => t.id === st.currentTrack.id)
        );
        set({ queue: copy, queueIndex: curIdx });
      }
      st.showToast('Añadida al final de la cola');
      void recomputeActiveDjPlan();
      return;
    }
    set({
      queue: [...st.queue, track],
      recommendedQueue: st.recommendedQueue.filter((t) => t.id !== track.id),
    });
    st.showToast('Añadida a la cola');
    void recomputeActiveDjPlan();
  },

  playNextInQueue: (track) => {
    const st = get();
    if (track.id === st.currentTrack.id) {
      st.showToast('Ya está sonando ahora');
      return;
    }
    const copy = st.queue.filter((t) => t.id !== track.id);
    const curIdx = Math.max(
      0,
      copy.findIndex((t) => t.id === st.currentTrack.id)
    );
    copy.splice(curIdx + 1, 0, track);
    set({
      queue: copy,
      queueIndex: curIdx,
      recommendedQueue: st.recommendedQueue.filter((t) => t.id !== track.id),
    });
    djPreloadedKey = '';
    st.showToast('Sonará a continuación');
    void recomputeActiveDjPlan();
  },

  replenishRecommendedQueue: async (force = false) => {
    const st = get();
    if (st.isLoadingRecommendedQueue) return;
    if (!force && st.recommendedQueue.length >= 6) return;
    set({ isLoadingRecommendedQueue: true });
    try {
      const excludedIds = new Set<string>([
        st.currentTrack.id,
        ...st.queue.map((t) => t.id),
        ...st.sessionPrevStack.slice(-8).map((t) => t.id),
      ]);
      const baseExisting = force ? [] : st.recommendedQueue;
      for (const t of baseExisting) excludedIds.add(t.id);

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

      if (primaryFetched.length < 4) {
        try {
          const seedArtist = st.currentTrack.artists[0]?.name?.trim();
          const query = seedArtist || st.currentTrack.title;
          if (query) {
            const bundle = await musicProvider.search(query, 'song');
            primaryFetched.push(...(bundle.songs ?? []));
          }
        } catch {
          // ignore search failure
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
      const seenKeys = new Set<string>();
      const pushUnique = (list: Track[], target: Track[]) => {
        for (const item of list) {
          if (!item?.id || excludedIds.has(item.id)) continue;
          const normKey = `${item.title.trim().toLowerCase()}::${(item.artists[0]?.name ?? '').trim().toLowerCase()}`;
          if (seenKeys.has(normKey)) continue;
          seenKeys.add(normKey);
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
    persistPrefsFromStore();
    void recomputeActiveDjPlan();
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
    persistPrefsFromStore();
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
    const shelves = await recommendationEngine.buildHomeShelves();
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
    scheduleLibraryCloudSync();
    return created;
  },

  renamePlaylist: async (playlistId, name) => {
    await libraryStore.updatePlaylist(playlistId, { name });
    set({ playlists: libraryStore.getPlaylists() });
    scheduleLibraryCloudSync();
  },

  deletePlaylist: async (playlistId) => {
    await libraryStore.deletePlaylist(playlistId);
    set((prev) => ({
      ...(isMobileHardwareVolumeRuntime() ? { volume: 1.0 } : {}),
      playlists: libraryStore.getPlaylists(),
      activeDetailView:
        prev.activeDetailView?.kind === 'local_playlist' &&
        prev.activeDetailView.playlistId === playlistId
          ? null
          : prev.activeDetailView,
    }));
    scheduleLibraryCloudSync();
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
    const alreadyIn = Boolean(existing?.tracks.some((t) => t.id === track.id));
    await libraryStore.addTrackToPlaylist(playlistId, track);
    if (!alreadyIn) {
      await recommendationEngine.recordSignal(track, 'add_to_playlist');
      scheduleLibraryCloudSync();
    }
    set({
      playlists: libraryStore.getPlaylists(),
      affinityProfile: recommendationEngine.getAffinityProfile(),
    });
    if (existing) {
      get().showToast(
        alreadyIn
          ? `Ya estaba en «${existing.name}»`
          : `Añadida a «${existing.name}»`
      );
    }
  },

  removeTrackFromPlaylist: async (playlistId, trackId) => {
    await libraryStore.removeTrackFromPlaylist(playlistId, trackId);
    set({ playlists: libraryStore.getPlaylists() });
    scheduleLibraryCloudSync();
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
      return bundle.songs.slice(0, 16);
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
    // Pick up to 3 varied seeds across playlist + explicit seedTrack just added
    const seedTracks: Track[] = [];
    if (options?.seedTrack) seedTracks.push(options.seedTrack);
    if (playlistSeeds.length > 0) {
      const step = Math.max(1, Math.floor(playlistSeeds.length / 3));
      for (let i = playlistSeeds.length - 1; i >= 0 && seedTracks.length < 4; i -= step) {
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
    ).slice(0, 3);

    const [relRes, artRes] = await Promise.all([
      Promise.allSettled(seedTracks.map((t) => musicProvider.getRelated(t.id))),
      Promise.allSettled(artistSeeds.map((name) => musicProvider.getArtist(name))),
    ]);

    for (const r of relRes) {
      if (r.status !== 'fulfilled') continue;
      for (const t of r.value.tracks ?? []) pushCand(t);
    }
    for (const r of artRes) {
      if (r.status !== 'fulfilled') continue;
      for (const t of r.value.topSongs ?? []) pushCand(t);
    }
    for (const t of [...st.searchResults.songs, ...st.recommendedQueue, ...FALLBACK_TRACKS]) {
      pushCand(t);
    }

    return recommendationEngine.rerankTracks(Array.from(candidates.values()), {
      maxPerArtistInWindow: 2,
      limit: 24,
    });
  },

  toggleLike: async (track) => {
    const target = track ?? get().currentTrack;
    const likedNow = await libraryStore.toggleLikeTrack(target);
    await recommendationEngine.recordSignal(target, likedNow ? 'like' : 'unlike');
    const shelves = await recommendationEngine.buildHomeShelves();
    set({
      likedTracks: libraryStore.getLikedTracks(),
      affinityProfile: recommendationEngine.getAffinityProfile(),
      homeShelves: shelves,
    });
    scheduleLibraryCloudSync();
  },

  downloadTrackOffline: async (track) => {
    set((prev) => ({
      offlineDownloads: { ...prev.offlineDownloads, [track.id]: 'downloading' },
    }));

    try {
      const url = await resolveTrackStreamUrl(track);
      const headers = await defaultPlatformBridge.getAuthHeaders();
      const res = await fetch(url, { headers });
      if (!res.ok) throw new Error('stream');
      const buf = await res.arrayBuffer();
      await defaultPlatformBridge.offlineStorage.saveAudio(track.id, buf, res.headers.get('content-type') ?? 'audio/mp4');
      const entries = await defaultPlatformBridge.offlineStorage.listOfflineIds();
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

  clearOfflineCache: async () => {
    await defaultPlatformBridge.offlineStorage.clearAll();
    set({
      offlineDownloads: {},
      offlineEntries: [],
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
    void syncEngine.sendRemoteCommand({
      targetDeviceId: '*',
      type: 'request_state',
    });
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
      window.location.href = res.url;
    }
  },

  handleAuthCallbackUrl: async (callbackUrl) => {
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
            persistPrefsFromStore();
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
        get().showToast(
          profile
            ? `Sesión iniciada como @${profile.username}`
            : 'Sesión iniciada con Google'
        );
        void syncEngine.sendRemoteCommand({
          targetDeviceId: '*',
          type: 'request_state',
        });
      } else {
        set({ authCallbackError: 'No se recibió una sesión válida de Google. Inténtalo de nuevo.' });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudo completar el inicio con Google';
      set({ authCallbackError: msg });
      get().showToast(msg);
    }
  },

  signOutSupabase: async () => {
    await syncEngine.signOut();
    try {
      await recommendationEngine.resetTastes();
    } catch {
      // ignore taste reset error
    }
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
      onlineDevices: syncEngine.getOnlineDevices(),
      remoteControlledDeviceId: null,
      remoteDeviceSnapshot: null,
      playlists: [],
      likedTracks: [],
      playHistory: [],
      playlistPlayCounts: {},
      seedArtists: recommendationEngine.getSeedArtists(),
      affinityProfile: recommendationEngine.getAffinityProfile(),
      activeDetailView:
        prev.activeDetailView?.kind === 'local_playlist' ? null : prev.activeDetailView,
    }));
    void get().refreshHomeRecommendations(false);
  },

  setAuthOnboardingOpen: (open) => set({ authOnboardingOpen: open }),

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
    set({
      wrappedSummary: summary,
      wrappedModalOpen: true,
    });
  },

  closeWrappedModal: () => set({ wrappedModalOpen: false }),

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
    persistPrefsFromStore();
  },

  setLiquidGlassMode: (enabled) => {
    const nextStyle: PMusicSurfaceStyle = enabled ? 'liquid-glass' : 'simple';
    get().setSurfaceStyle(nextStyle);
  },

  setAmbientMotionEnabled: (enabled) => {
    set({ ambientMotionEnabled: enabled });
    persistPrefsFromStore();
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
    persistPrefsFromStore();
  },

  setTheme: (themeId) => {
    applyPMusicTheme(themeId);
    applyAccentOverride(get().accentPreset, themeId);
    set({ themeId });
    persistPrefsFromStore();
  },

  setPlayerBarStyle: (playerBarStyle) => {
    set({ playerBarStyle });
    persistPrefsFromStore();
  },

  setAccentPreset: (accentPreset) => {
    applyAccentOverride(accentPreset, get().themeId);
    set({ accentPreset });
    persistPrefsFromStore();
  },

  setVisualizerEnabled: (enabled) => {
    set({ visualizerEnabled: enabled });
    persistPrefsFromStore();
  },

  setLyricsSize: (size) => {
    set({ lyricsSize: size });
    persistPrefsFromStore();
  },

  setLyricsBlurEnabled: (enabled) => {
    set({ lyricsBlurEnabled: enabled });
    persistPrefsFromStore();
  },

  setLyricsStyle: (style) => {
    set({ lyricsStyle: style });
    persistPrefsFromStore();
  },

  setNowPlayingBackdropStyle: (style) => {
    const valid = parseNowPlayingBackdropStyle(style, get().nowPlayingBackdropStyle);
    set({ nowPlayingBackdropStyle: valid });
    persistPrefsFromStore();
  },

  setAlwaysShuffle: (enabled) => {
    set({ alwaysShuffle: enabled });
    if (enabled && !get().shuffleEnabled) {
      get().toggleShuffle();
    }
    persistPrefsFromStore();
  },

  setSkipSameAlbumCoverTransition: (enabled) => {
    set({ skipSameAlbumCoverTransition: enabled });
    persistPrefsFromStore();
  },

  setMarqueeTextEnabled: (enabled) => {
    set({ marqueeTextEnabled: enabled });
    persistPrefsFromStore();
  },

  setShowRemainingTime: (enabled) => {
    set({ showRemainingTime: enabled });
    persistPrefsFromStore();
  },

  setPlaybackRate: (rate) => {
    const safeRate = Math.max(0.5, Math.min(2.0, rate));
    audioEngine.setPlaybackRate(safeRate, get().preservesPitch);
    set({ playbackRate: safeRate });
    persistPrefsFromStore();
  },

  setPreservesPitch: (preserves) => {
    audioEngine.setPlaybackRate(get().playbackRate, preserves);
    set({ preservesPitch: preserves });
    persistPrefsFromStore();
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
    persistPrefsFromStore();
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
    persistPrefsFromStore();
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
    persistPrefsFromStore();
  },

  setStreamQuality: (quality) => {
    currentStreamQualityPref = quality;
    set({ streamQuality: quality });
    persistPrefsFromStore();
    get().showToast(
      `Calidad de audio: ${
        quality === 'high' ? 'Alta' : quality === 'medium' ? 'Equilibrada' : 'Ahorro'
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
    const nextCfg: DiscordRpcConfig = {
      ...get().discordRpcConfig,
      ...patch,
    };
    set({ discordRpcConfig: nextCfg });
    persistPrefsFromStore();
    if (reconnect && typeof nextCfg.clientId === 'string') {
      const status = await defaultPlatformBridge.configureDiscordRpc?.(
        nextCfg.clientId
      );
      if (status) set({ discordRpcStatus: status });
    }
    syncDiscordPresenceState();
  },

  reconnectDiscordRpc: async () => {
    const cid = get().discordRpcConfig.clientId.trim();
    const status = cid
      ? await defaultPlatformBridge.configureDiscordRpc?.(cid)
      : await defaultPlatformBridge.reconnectDiscordRpc?.();
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
  let carSyncTimer: ReturnType<typeof setTimeout> | null = null;
  usePMusicStore.subscribe((st) => {
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
