import { create } from 'zustand';
import {
  DEFAULT_DJ_MODE_CONFIG,
  DEFAULT_SAFE_CROSSFADE_CONFIG,
  DEFAULT_SPANISH_URBAN_SEEDS,
  DEFAULT_USER_EQ_CONFIG,
  USER_EQ_PRESET_MAP,
  type AlbumDetail,
  type ArtistAffinityRecord,
  type ArtistDetail,
  type AudioAnalyserData,
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
  type UserEqBandsDb,
  type UserEqConfig,
  type UserEqPresetId,
} from '@pmusic/core';
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
import { defaultPlatformBridge } from '../platform/web-bridge.ts';
import { applyAmbientPaletteFromCover } from '../utils/cover-color.ts';
import {
  applyAccentOverride,
  applyPMusicTheme,
  type PMusicAccentPresetId,
  type PMusicPlayerBarStyle,
  type PMusicThemeId,
} from '../utils/themes.ts';

export type MainNavTab = 'Inicio' | 'Explorar' | 'Buscar' | 'Biblioteca';
export type NowPlayingSubTab = 'Portada' | 'Letras' | 'Cola';
export type SearchScopeTab = 'Todo' | 'Canciones' | 'Artistas' | 'Álbumes' | 'Playlists';
export type LibraryCategoryTab = 'Todo' | 'Playlists' | 'Me gusta' | 'Descargas' | 'Historial';
export type OfflineDownloadStatus = 'idle' | 'downloading' | 'downloaded' | 'error';

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
  | { kind: 'artist'; data: ArtistDetail }
  | { kind: 'album'; data: AlbumDetail }
  | { kind: 'playlist'; data: PlaylistDetail }
  | { kind: 'local_playlist'; playlistId: string }
  | null;

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

export interface DiscordRpcConfig {
  clientId: string;
  showTimestamps: boolean;
  showArtwork: boolean;
  showWhenPaused: boolean;
  displayMode: 'song' | 'artist' | 'app';
}

const USER_PREFS_STORAGE_KEY = 'pmusic_user_prefs_v1';
let sleepTimerInterval: ReturnType<typeof setInterval> | null = null;

function normTargetToDb(target: 'quiet' | 'normal' | 'loud'): number {
  if (target === 'quiet') return -14;
  if (target === 'loud') return -8;
  return -11;
}

let importAbortController: AbortController | null = null;
let searchTicket = 0;
let lyricsTicket = 0;
let djAutoTransitionInFlight = false;
let djPreloadedKey = '';
const decodedAudioAnalyzedIds = new Set<string>();
const decodedAudioInFlightIds = new Set<string>();

export type RepeatMode = 'off' | 'all' | 'one';
export type TrackMenuState = {
  track: Track;
  x: number;
  y: number;
  playlistId?: string;
} | null;

let toastTimer: ReturnType<typeof setTimeout> | null = null;

function applyAmbientPaletteForTrack(track: Track | null): void {
  applyAmbientPaletteFromCover(track);
}

export interface PMusicStoreState {
  // Navigation & Sheets
  activeTab: MainNavTab;
  sidebarCollapsed: boolean;
  rightPanelOpen: boolean;
  nowPlayingOpen: boolean;
  nowPlayingTab: NowPlayingSubTab;
  eqSheetOpen: boolean;
  devicesSheetOpen: boolean;
  importModalOpen: boolean;
  settingsOpen: boolean;
  spotlightOpen: boolean;
  activeDetailView: ActiveDetailView;
  isOfflineNetwork: boolean;
  liquidGlassMode: boolean;
  graphicSaverMode: boolean;
  reducedMotionPref: boolean;
  themeId: PMusicThemeId;
  playerBarStyle: PMusicPlayerBarStyle;
  accentPreset: PMusicAccentPresetId;
  lastTrackDirection: 'next' | 'prev' | 'none';
  visualizerEnabled: boolean;
  lyricsSize: 'normal' | 'large' | 'xl';
  lyricsBlurEnabled: boolean;
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
  unshuffledQueue: Track[];
  queueIndex: number;
  shuffleEnabled: boolean;
  repeatMode: RepeatMode;
  isPlaying: boolean;
  positionSec: number;
  durationSec: number;
  volume: number;
  activeDeck: DeckId;
  isTransitioning: boolean;
  activeTransitionType?: DjTransitionType;
  transitionProgress01: number;
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

  // Library & Offline Cache
  libraryCategory: LibraryCategoryTab;
  libraryFilterQuery: string;
  playlists: PlaylistRecord[];
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

  // Actions
  initApp: () => Promise<void>;
  setActiveTab: (tab: MainNavTab) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setRightPanelOpen: (open: boolean) => void;
  setNowPlayingOpen: (open: boolean) => void;
  setNowPlayingTab: (tab: NowPlayingSubTab) => void;
  setEqSheetOpen: (open: boolean) => void;
  setDevicesSheetOpen: (open: boolean) => void;
  setImportModalOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  setSpotlightOpen: (open: boolean) => void;
  openArtistDetail: (artistId: string) => Promise<void>;
  openAlbumDetail: (albumId: string) => Promise<void>;
  openPlaylistDetail: (playlistId: string) => Promise<void>;
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
  startTrackRadio: (track: Track, withDj?: boolean) => Promise<void>;
  setAutoplayEnabled: (enabled: boolean) => void;

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

  // Library & Offline Actions
  setLibraryCategory: (cat: LibraryCategoryTab) => void;
  setLibraryFilterQuery: (q: string) => void;
  createPlaylist: (name: string, description?: string, tracks?: Track[]) => Promise<PlaylistRecord>;
  renamePlaylist: (playlistId: string, name: string) => Promise<void>;
  deletePlaylist: (playlistId: string) => Promise<void>;
  addTrackToPlaylist: (playlistId: string, track: Track) => Promise<void>;
  removeTrackFromPlaylist: (playlistId: string, trackId: string) => Promise<void>;
  reorderPlaylistTrack: (playlistId: string, fromIndex: number, toIndex: number) => Promise<void>;
  likeTrackIfNeeded: (track: Track) => Promise<void>;
  searchTracksForPlaylist: (query: string) => Promise<Track[]>;
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
  signInSupabase: (email: string, password: string) => Promise<void>;
  signUpSupabase: (email: string, password: string) => Promise<void>;
  signOutSupabase: () => Promise<void>;
  pairDemoCompanionDevice: () => void;
  sendRemoteDeviceCommand: (
    targetDeviceId: string,
    action: 'play' | 'pause' | 'toggle' | 'next' | 'prev',
    volume01?: number
  ) => Promise<void>;
  transferPlaybackToDevice: (targetDeviceId: string) => Promise<void>;
  setLiquidGlassMode: (enabled: boolean) => void;
  setGraphicSaverMode: (enabled: boolean) => void;
  setReducedMotionPref: (enabled: boolean) => void;
  setTheme: (themeId: PMusicThemeId) => void;
  setPlayerBarStyle: (style: PMusicPlayerBarStyle) => void;
  setAccentPreset: (accent: PMusicAccentPresetId) => void;
  setVisualizerEnabled: (enabled: boolean) => void;
  setLyricsSize: (size: 'normal' | 'large' | 'xl') => void;
  setLyricsBlurEnabled: (enabled: boolean) => void;
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
  async function analyzeTrackAudioInBackground(track: Track): Promise<void> {
    if (decodedAudioAnalyzedIds.has(track.id) || decodedAudioInFlightIds.has(track.id)) {
      return;
    }
    if (
      typeof window === 'undefined' ||
      typeof window.AudioContext === 'undefined' ||
      !window.location?.protocol?.startsWith('http')
    ) {
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
      set((prev) => ({
        trackAnalyses: { ...prev.trackAnalyses, [track.id]: pcmAnalysis },
      }));
      void recomputeActiveDjPlan();
    } catch {
      // Ignore network/codec failures and keep heuristic analysis
    } finally {
      decodedAudioInFlightIds.delete(track.id);
    }
  }

  async function recomputeActiveDjPlan(): Promise<DeckTransitionPlan | null> {
    const st = get();
    if (!st.djMode.enabled || st.queue.length < 2 || st.repeatMode === 'one') {
      if (st.activeTransitionPlan !== null) set({ activeTransitionPlan: null });
      return null;
    }
    const nextIdx = (st.queueIndex + 1) % st.queue.length;
    const nextTrack = st.queue[nextIdx];
    if (!nextTrack || nextTrack.id === st.currentTrack.id) {
      if (st.activeTransitionPlan !== null) set({ activeTransitionPlan: null });
      return null;
    }

    const fromAna =
      st.trackAnalyses[st.currentTrack.id] ??
      (await djPlanner.analyzeTrack(st.currentTrack.id, null, st.currentTrack.durationSec));
    const toAna =
      st.trackAnalyses[nextTrack.id] ??
      (await djPlanner.analyzeTrack(nextTrack.id, null, nextTrack.durationSec));

    if (!st.trackAnalyses[st.currentTrack.id] || !st.trackAnalyses[nextTrack.id]) {
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

    // Live catch-up when Quick DJ is enabled mid-song so mix triggers smoothly ahead
    const latest = get();
    const effDuration = latest.durationSec > 10 ? latest.durationSec : fromAna.durationSec;
    if (
      latest.djMode.style === 'quick' &&
      latest.isPlaying &&
      latest.positionSec >= plan.cueOutSec - 4 &&
      latest.positionSec < Math.max(20, effDuration - plan.transitionDurationSec - 3)
    ) {
      plan = {
        ...plan,
        cueOutSec: Math.min(
          Math.max(15, Math.round(effDuration - plan.transitionDurationSec - 1)),
          Math.round(latest.positionSec + 8)
        ),
      };
    }

    set({ activeTransitionPlan: plan });
    return plan;
  }

  async function executeDjTransition(
    plan: DeckTransitionPlan,
    nextTrack: Track,
    nextIdx: number
  ): Promise<void> {
    if (djAutoTransitionInFlight) return;
    djAutoTransitionInFlight = true;
    try {
      const prevTrack = get().currentTrack;
      void recommendationEngine.recordSignal(prevTrack, 'complete_listen', {
        completionRatio: 1.0,
      });

      await audioEngine.preloadNextDeck(nextTrack, plan.cueInSec);
      await audioEngine.executeTransition(plan);

      const enginePos = audioEngine.getState().positionSec;
      const landedPos =
        Number.isFinite(enginePos) && enginePos > 0 ? enginePos : plan.cueInSec;

      set({
        currentTrack: nextTrack,
        queueIndex: nextIdx,
        positionSec: landedPos,
        durationSec: nextTrack.durationSec,
        isPlaying: true,
        activeTransitionPlan: null,
        currentLyrics: null,
        activeLyricIndex: -1,
        lyricsUserScrolled: false,
      });

      applyAmbientPaletteForTrack(nextTrack);
      void get().loadLyricsForTrack(nextTrack);
      void syncEngine.updatePresence({
        is_active: true,
        is_playing: true,
        track_title: `${nextTrack.title} — ${nextTrack.artists.map((a) => a.name).join(', ')}`,
      });
      syncDiscordPresenceState();

      djPreloadedKey = '';
      void analyzeTrackAudioInBackground(nextTrack);
      const q = get().queue;
      const upcoming = q[(nextIdx + 1) % Math.max(1, q.length)];
      if (upcoming && upcoming.id !== nextTrack.id) {
        void analyzeTrackAudioInBackground(upcoming);
      }
      await recomputeActiveDjPlan();
    } finally {
      djAutoTransitionInFlight = false;
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
  }

  function persistPrefsFromStore(): void {
    const st = get();
    const payload = {
      themeId: st.themeId,
      playerBarStyle: st.playerBarStyle,
      accentPreset: st.accentPreset,
      liquidGlassMode: st.liquidGlassMode,
      graphicSaverMode: st.graphicSaverMode,
      reducedMotionPref: st.reducedMotionPref,
      visualizerEnabled: st.visualizerEnabled,
      lyricsSize: st.lyricsSize,
      lyricsBlurEnabled: st.lyricsBlurEnabled,
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
    };
    void defaultPlatformBridge.preferencesStorage
      .setItem(USER_PREFS_STORAGE_KEY, JSON.stringify(payload))
      .catch(() => {});
  }

  return {
  activeTab: 'Inicio',
  sidebarCollapsed: typeof window !== 'undefined' ? window.innerWidth < 1024 : false,
  rightPanelOpen: typeof window !== 'undefined' ? window.innerWidth >= 1280 : false,
  nowPlayingOpen: false,
  nowPlayingTab: 'Portada',
  eqSheetOpen: false,
  devicesSheetOpen: false,
  importModalOpen: false,
  settingsOpen: false,
  spotlightOpen: false,
  activeDetailView: null,
  isOfflineNetwork: typeof navigator !== 'undefined' ? !navigator.onLine : false,
  liquidGlassMode: true,
  graphicSaverMode: false,
  reducedMotionPref: false,
  themeId: 'obsidian',
  playerBarStyle: 'classic-center',
  accentPreset: 'auto',
  lastTrackDirection: 'none',
  visualizerEnabled: true,
  lyricsSize: 'large',
  lyricsBlurEnabled: true,
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
  unshuffledQueue: [],
  queueIndex: 0,
  shuffleEnabled: false,
  repeatMode: 'off',
  isPlaying: false,
  positionSec: 0,
  durationSec: initialTrack.durationSec,
  volume: 0.85,
  activeDeck: 'A',
  isTransitioning: false,
  activeTransitionType: undefined,
  transitionProgress01: 0,
  autoplayEnabled: true,

  djMode: {
    ...DEFAULT_DJ_MODE_CONFIG,
    enabledTransitions: { eq_swap: true, filter_sweep: true, echo_out: true },
    stemSculpting: true,
    vocalClashProtection: true,
  },
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

  libraryCategory: 'Todo',
  libraryFilterQuery: '',
  playlists: [],
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
  deviceName: 'pMusic Dispositivo Actual',
  supabaseUrlInput: resolvedSupabaseUrl,
  supabaseAnonKeyInput: resolvedSupabaseKey,
  authState: syncEngine.getAuthState(),
  onlineDevices: syncEngine.getOnlineDevices(),
  lastTransferBanner: null,

  initApp: async () => {
    if (initialized) return;
    initialized = true;

    await libraryStore.hydrate();
    await recommendationEngine.hydrate();
    await audioEngine.init();
    await syncEngine.connectRealtime();

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

    const offlineEntries = await defaultPlatformBridge.offlineStorage.listOfflineIds();
    const offlineDownloads: Record<string, OfflineDownloadStatus> = {};
    for (const entry of offlineEntries) {
      offlineDownloads[entry.trackId] = 'downloaded';
    }

    // Pre-analyze initial fallback catalog for DJ badges
    const analyses: Record<string, TrackAnalysis> = {};
    for (const track of FALLBACK_TRACKS) {
      analyses[track.id] = await djPlanner.analyzeTrack(track.id, null, track.durationSec);
    }

    const shelves = await recommendationEngine.buildHomeShelves();
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
          hydratedRecentItems = parsed as RecentSearchItem[];
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

    const resolvedLiquidGlass =
      hydratedPrefs && typeof hydratedPrefs.liquidGlassMode === 'boolean'
        ? hydratedPrefs.liquidGlassMode
        : hydratedPrefs
          ? !Boolean(hydratedPrefs.graphicSaverMode)
          : get().liquidGlassMode;

    if (typeof document !== 'undefined') {
      document.documentElement.classList.toggle('pm-liquid-glass-all', resolvedLiquidGlass);
      document.documentElement.classList.toggle('pm-solid-modern', !resolvedLiquidGlass);
      document.documentElement.classList.toggle('pm-reduced-transparency', !resolvedLiquidGlass);
      document.documentElement.classList.toggle(
        'pm-reduced-motion',
        Boolean(hydratedPrefs?.reducedMotionPref ?? (!resolvedLiquidGlass))
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

    const rpcStatus = await defaultPlatformBridge.getDiscordRpcStatus?.();

    set((prev) => ({
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
              (hydratedPrefs.playerBarStyle as PMusicPlayerBarStyle) ?? prev.playerBarStyle,
            accentPreset:
              (hydratedPrefs.accentPreset as PMusicAccentPresetId) ?? prev.accentPreset,
            liquidGlassMode: resolvedLiquidGlass,
            graphicSaverMode: !resolvedLiquidGlass,
            reducedMotionPref: Boolean(hydratedPrefs.reducedMotionPref ?? prev.reducedMotionPref),
            visualizerEnabled: Boolean(hydratedPrefs.visualizerEnabled ?? prev.visualizerEnabled),
            lyricsSize: hydratedPrefs.lyricsSize ?? prev.lyricsSize,
            lyricsBlurEnabled: Boolean(hydratedPrefs.lyricsBlurEnabled ?? prev.lyricsBlurEnabled),
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
          }
        : {}),
    }));

    const firstReal = shelves.flatMap((s) => s.tracks ?? [])[0];
    if (firstReal && !get().isPlaying) {
      const realQueue = shelves.find((s) => s.kind === 'listen_again')?.tracks ?? [firstReal];
      set({ currentTrack: firstReal, queue: realQueue, queueIndex: 0, durationSec: firstReal.durationSec, positionSec: 0 });
    }

    if (typeof window !== 'undefined' && window.location?.protocol?.startsWith('http') && !get().searchQuery) {
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

    const mediaController = new MediaSessionController({
      platformBridge: defaultPlatformBridge,
      onAction: (action) => {
        if (action.type === 'play') void get().togglePlayPause();
        else if (action.type === 'pause') void get().togglePlayPause();
        else if (action.type === 'nexttrack') void get().nextTrack();
        else if (action.type === 'previoustrack') void get().prevTrack();
        else if (action.type === 'seekto' && typeof action.seekTimeSec === 'number') {
          get().seekTo(action.seekTimeSec);
        }
      },
    });

    audioEngine.onStateChange((engineState) => {
      const lyrics = get().currentLyrics;
      const activeIdx =
        lyrics && lyrics.status === 'synced'
          ? lrcParser.findActiveLineIndex(lyrics.lines, engineState.positionSec * 1000)
          : -1;

      set({
        activeDeck: engineState.activeDeck,
        isPlaying: engineState.isPlaying,
        positionSec: engineState.positionSec,
        durationSec: engineState.durationSec || get().currentTrack.durationSec,
        volume: engineState.volume,
        isTransitioning: engineState.isTransitioning,
        activeTransitionType: engineState.activeTransitionType,
        transitionProgress01: engineState.transitionProgress01,
        activeLyricIndex: activeIdx,
      });

      void mediaController.updateSession({
        track: get().currentTrack,
        isPlaying: engineState.isPlaying,
        positionSec: engineState.positionSec,
        durationSec: engineState.durationSec || get().currentTrack.durationSec,
      });

      const liveState = get();
      if (
        liveState.djMode.enabled &&
        engineState.isPlaying &&
        !engineState.isTransitioning &&
        !djAutoTransitionInFlight &&
        liveState.repeatMode !== 'one' &&
        liveState.queue.length > 1
      ) {
        const nextIdx = (liveState.queueIndex + 1) % liveState.queue.length;
        const nextTrack = liveState.queue[nextIdx];
        if (nextTrack && nextTrack.id !== liveState.currentTrack.id) {
          const plan = liveState.activeTransitionPlan;
          if (!plan || plan.fromTrackId !== liveState.currentTrack.id || plan.toTrackId !== nextTrack.id) {
            void recomputeActiveDjPlan();
          } else {
            const preloadKey = `${liveState.currentTrack.id}->${nextTrack.id}@${plan.cueInSec}`;
            if (
              engineState.positionSec >= Math.max(0, plan.cueOutSec - 16) &&
              djPreloadedKey !== preloadKey
            ) {
              djPreloadedKey = preloadKey;
              void analyzeTrackAudioInBackground(nextTrack);
              void audioEngine.preloadNextDeck(nextTrack, plan.cueInSec);
            }
            if (engineState.positionSec >= plan.cueOutSec) {
              void executeDjTransition(plan, nextTrack, nextIdx);
            }
          }
        }
      } else if (
        !liveState.djMode.enabled &&
        liveState.safeCrossfade.enabled &&
        liveState.safeCrossfade.durationSec > 0 &&
        engineState.isPlaying &&
        !engineState.isTransitioning &&
        !djAutoTransitionInFlight &&
        liveState.repeatMode !== 'one' &&
        liveState.queue.length > 1
      ) {
        const dur = engineState.durationSec || liveState.durationSec;
        if (dur > 15 && engineState.positionSec >= dur - liveState.safeCrossfade.durationSec - 0.3) {
          const nextIdx = (liveState.queueIndex + 1) % liveState.queue.length;
          const nextTrack = liveState.queue[nextIdx];
          if (nextTrack && nextTrack.id !== liveState.currentTrack.id) {
            const cfPlan: DeckTransitionPlan = {
              fromTrackId: liveState.currentTrack.id,
              toTrackId: nextTrack.id,
              cueInSec: 0,
              cueOutSec: Math.max(10, Math.round(dur - liveState.safeCrossfade.durationSec)),
              transitionDurationSec: Math.max(1.5, Math.min(12, liveState.safeCrossfade.durationSec)),
              transitionBars: 4,
              transitionType: 'eq_swap',
              tempoNudgeRate: 1.0,
              echoSubdivision: 0.5,
              compatibilityScore: 0.85,
            };
            void executeDjTransition(cfPlan, nextTrack, nextIdx);
          }
        }
      }
    });

    audioEngine.onTrackEnded(() => {
      const st = get();
      if (st.sleepTimerMode === 'end_of_track') {
        audioEngine.pause();
        set({
          isPlaying: false,
          sleepTimerMode: 'off',
          sleepTimerRemainingSec: 0,
        });
        syncDiscordPresenceState();
        st.showToast('Temporizador finalizado');
        return;
      }
      if (st.isTransitioning || djAutoTransitionInFlight) return;
      void recommendationEngine.recordSignal(st.currentTrack, 'complete_listen', {
        completionRatio: 1.0,
      });
      void st.nextTrack(true);
    });

    syncEngine.onDevicesChanged((devices) => {
      set({ onlineDevices: devices });
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
      } else if (cmd.type === 'transfer') {
        const snap = cmd.snapshot;
        set({
          currentTrack: snap.track,
          queue: snap.queue.length > 0 ? snap.queue : [snap.track],
          queueIndex: snap.queueIndex,
          volume: snap.volume,
          lastTransferBanner: `Reproducción recibida en ${ Math.round(snap.positionMs / 1000) }s`,
        });
        void st.playTrack(snap.track, snap.queue, snap.positionMs / 1000);
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
    }
  },

  setActiveTab: (tab) => set({ activeTab: tab, activeDetailView: null, spotlightOpen: false }),
  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
  setRightPanelOpen: (open) => set({ rightPanelOpen: open }),
  setNowPlayingOpen: (open) => set({ nowPlayingOpen: open }),
  setNowPlayingTab: (tab) => set({ nowPlayingTab: tab }),
  setEqSheetOpen: (open) => set({ eqSheetOpen: open }),
  setDevicesSheetOpen: (open) => set({ devicesSheetOpen: open }),
  setImportModalOpen: (open) => set({ importModalOpen: open, importError: null }),
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  setSpotlightOpen: (open) => set({ spotlightOpen: open }),

  openArtistDetail: async (artistId) => {
    const data = await musicProvider.getArtist(artistId);
    set({
      activeDetailView: { kind: 'artist', data },
      spotlightOpen: false,
      nowPlayingOpen: false,
    });
  },
  openAlbumDetail: async (albumId) => {
    const data = await musicProvider.getAlbum(albumId);
    set({
      activeDetailView: { kind: 'album', data },
      spotlightOpen: false,
      nowPlayingOpen: false,
    });
  },
  openPlaylistDetail: async (playlistId) => {
    const data = await musicProvider.getPlaylist(playlistId);
    set({
      activeDetailView: { kind: 'playlist', data },
      spotlightOpen: false,
      nowPlayingOpen: false,
    });
  },
  openLocalPlaylistDetail: (playlistId) => {
    set({
      activeDetailView: { kind: 'local_playlist', playlistId },
      spotlightOpen: false,
      nowPlayingOpen: false,
    });
  },
  closeDetailView: () => set({ activeDetailView: null }),

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
    const st = get();
    const queue = newQueue && newQueue.length > 0 ? [...newQueue] : st.queue;
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
        unshuffledQueue: newQueue && newQueue.length > 0 ? [...newQueue] : st.unshuffledQueue,
        queueIndex: idx,
        positionSec: effectiveStartSec,
        durationSec: track.durationSec,
        isPlaying: true,
        currentLyrics: null,
        activeLyricIndex: -1,
        lyricsUserScrolled: false,
      });

      djPreloadedKey = '';
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
      if (track.artists.length <= 1 && track.id.startsWith('dz:')) {
        void musicProvider
          .getTrack?.(track.id)
          .then((enriched) => {
            if (!enriched || enriched.artists.length <= 1) return;
            set((prev) => ({
              currentTrack:
                prev.currentTrack.id === track.id
                  ? { ...prev.currentTrack, artists: enriched.artists }
                  : prev.currentTrack,
              queue: prev.queue.map((qItem) =>
                qItem.id === track.id ? { ...qItem, artists: enriched.artists } : qItem
              ),
              searchResults: {
                ...prev.searchResults,
                songs: prev.searchResults.songs.map((s) =>
                  s.id === track.id ? { ...s, artists: enriched.artists } : s
                ),
              },
            }));
            syncDiscordPresenceState();
          })
          .catch(() => {});
      }

      void syncEngine.updatePresence({
        is_active: true,
        is_playing: true,
        track_title: `${track.title} — ${track.artists.map((a) => a.name).join(', ')}`,
      });
      syncDiscordPresenceState();

      const nextCandidate = queue[(idx + 1) % queue.length];
      if (nextCandidate && nextCandidate.id !== track.id) {
        const nextAna =
          get().trackAnalyses[nextCandidate.id] ??
          (await djPlanner.analyzeTrack(nextCandidate.id, null, nextCandidate.durationSec));
        const nextCueIn =
          st.djMode.enabled && st.djMode.style === 'quick'
            ? Math.max(1, Math.round(nextAna.primaryDropSec - 4))
            : 0;
        void analyzeTrackAudioInBackground(nextCandidate);
        void audioEngine.preloadNextDeck(nextCandidate, nextCueIn);
      }
      void recomputeActiveDjPlan();
  },

  togglePlayPause: async () => {
    const st = get();
    if (st.isPlaying) {
      audioEngine.pause();
      set({ isPlaying: false });
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
    const st = get();
    if (!isAutoAdvance) {
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

    const isLast = st.queueIndex >= Math.max(0, st.queue.length - 1);
    if (isAutoAdvance && st.repeatMode === 'off' && isLast && !st.autoplayEnabled) {
      audioEngine.pause();
      set({ isPlaying: false });
      return;
    }

    const nextIdx = (st.queueIndex + 1) % Math.max(1, st.queue.length);
    const next = st.queue[nextIdx] ?? FALLBACK_TRACKS[0]!;

    if (st.djMode.enabled && st.isPlaying && next.id !== st.currentTrack.id) {
      await st.triggerDjMixNow();
      return;
    }

    await st.playTrack(next, st.queue, undefined, 'next');
    set({
      affinityProfile: recommendationEngine.getAffinityProfile(),
      playHistory: libraryStore.getPlayHistory(),
    });
  },

  prevTrack: async () => {
    const st = get();
    if (st.positionSec > 5) {
      st.seekTo(0);
      return;
    }
    const prevIdx = (st.queueIndex - 1 + st.queue.length) % Math.max(1, st.queue.length);
    const prev = st.queue[prevIdx] ?? FALLBACK_TRACKS[0]!;
    await st.playTrack(prev, st.queue, undefined, 'prev');
  },

  toggleShuffle: () => {
    const st = get();
    djPreloadedKey = '';
    if (!st.shuffleEnabled) {
      const original = [...st.queue];
      const others = original.filter((t) => t.id !== st.currentTrack.id);
      for (let i = others.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const tmp = others[i]!;
        others[i] = others[j]!;
        others[j] = tmp;
      }
      const shuffled = [st.currentTrack, ...others];
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
    audioEngine.seek(positionSec);
    const lyrics = get().currentLyrics;
    const activeIdx =
      lyrics && lyrics.status === 'synced'
        ? lrcParser.findActiveLineIndex(lyrics.lines, positionSec * 1000)
        : -1;
    set({ positionSec, activeLyricIndex: activeIdx });
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
    set({ queue: [...st.queue, track] });
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
    });
    djPreloadedKey = '';
    st.showToast('Sonará a continuación');
    void recomputeActiveDjPlan();
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

    audioEngine.setDjMode(nextDjMode);
    djPreloadedKey = '';

    let nextQueue = [...st.queue];
    if (nextEnabled && nextDjMode.autoReorderQueue) {
      const map = new Map<string, TrackAnalysis>();
      for (const t of nextQueue) {
        const ana =
          st.trackAnalyses[t.id] ??
          (await djPlanner.analyzeTrack(t.id, null, t.durationSec));
        map.set(t.id, ana);
      }
      nextQueue = djPlanner.reorderQueueForSession(nextQueue, map, st.currentTrack.id);
    }

    const nextIdx = Math.max(
      0,
      nextQueue.findIndex((t) => t.id === st.currentTrack.id)
    );

    set({
      djMode: nextDjMode,
      queue: nextQueue,
      queueIndex: nextIdx,
      // Safe crossfade is paused automatically while DJ Mode is active
      safeCrossfade: nextEnabled
        ? { ...st.safeCrossfade, enabled: false }
        : st.safeCrossfade,
    });
    persistPrefsFromStore();

    if (nextEnabled) {
      void analyzeTrackAudioInBackground(st.currentTrack);
      const upcoming = nextQueue[(nextIdx + 1) % Math.max(1, nextQueue.length)];
      if (upcoming && upcoming.id !== st.currentTrack.id) {
        void analyzeTrackAudioInBackground(upcoming);
      }
      const plan = await recomputeActiveDjPlan();
      if (plan && upcoming && upcoming.id !== st.currentTrack.id) {
        void audioEngine.preloadNextDeck(upcoming, plan.cueInSec);
      }
    } else {
      set({ activeTransitionPlan: null });
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
    audioEngine.setDjMode(nextDjMode);
    djPreloadedKey = '';

    let nextQueue = [...st.queue];
    if (!wasEnabled && nextDjMode.autoReorderQueue) {
      const map = new Map<string, TrackAnalysis>();
      for (const t of nextQueue) {
        const ana =
          st.trackAnalyses[t.id] ??
          (await djPlanner.analyzeTrack(t.id, null, t.durationSec));
        map.set(t.id, ana);
      }
      nextQueue = djPlanner.reorderQueueForSession(nextQueue, map, st.currentTrack.id);
    }

    const nextIdx = Math.max(
      0,
      nextQueue.findIndex((t) => t.id === st.currentTrack.id)
    );

    set({
      djMode: nextDjMode,
      queue: nextQueue,
      queueIndex: nextIdx,
      safeCrossfade: { ...st.safeCrossfade, enabled: false },
    });
    persistPrefsFromStore();

    void analyzeTrackAudioInBackground(st.currentTrack);
    const upcoming = nextQueue[(nextIdx + 1) % Math.max(1, nextQueue.length)];
    if (upcoming && upcoming.id !== st.currentTrack.id) {
      void analyzeTrackAudioInBackground(upcoming);
    }
    const plan = await recomputeActiveDjPlan();
    if (plan && upcoming && upcoming.id !== st.currentTrack.id) {
      void audioEngine.preloadNextDeck(upcoming, plan.cueInSec);
    }
  },

  toggleDjFx: (fx) => {
    const st = get();
    const currentToggles: DjFxToggles = st.djMode.enabledTransitions ?? {
      eq_swap: true,
      filter_sweep: true,
      echo_out: true,
    };
    const updated: DjFxToggles = {
      ...currentToggles,
      [fx]: !currentToggles[fx],
    };
    // Ensure at least one FX transition stays active
    if (!updated.eq_swap && !updated.filter_sweep && !updated.echo_out) {
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
    const nextIdx = (st.queueIndex + 1) % Math.max(1, st.queue.length);
    const nextTrack = st.queue[nextIdx];
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
    const next: SafeCrossfadeConfig = {
      enabled: st.djMode.enabled ? false : (patch.enabled ?? st.safeCrossfade.enabled),
      durationSec: Math.max(
        0,
        Math.min(12, patch.durationSec ?? st.safeCrossfade.durationSec)
      ),
    };
    audioEngine.setSafeCrossfade(next);
    set({ safeCrossfade: next });
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
    set({ searchQuery: query, isSearching: true });
    const ticket = ++searchTicket;
    if (!immediate && query) {
      await new Promise((r) => setTimeout(r, 240));
      if (ticket !== searchTicket) return;
    }
    try {
      const [remoteSuggestions, rawBundle] = await Promise.all([
        musicProvider.getSearchSuggestions(query).catch(() => [] as string[]),
        musicProvider.search(query, 'all'),
      ]);
      if (ticket !== searchTicket) return;
      const ranked = recommendationEngine.rankAutocomplete(query, remoteSuggestions);
      const rerankedSongs = recommendationEngine.rerankTracks(rawBundle.songs, { query });
      const bundle: SearchResultBundle = {
        ...rawBundle,
        songs: rerankedSongs,
      };
      const best = recommendationEngine.selectBestResult(query, bundle);
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

  setLibraryCategory: (cat) => set({ libraryCategory: cat }),
  setLibraryFilterQuery: (q) => set({ libraryFilterQuery: q }),

  createPlaylist: async (name, description, tracks) => {
    const created = await libraryStore.createPlaylist({
      name,
      description,
      tracks,
    });
    set({ playlists: libraryStore.getPlaylists() });
    return created;
  },

  renamePlaylist: async (playlistId, name) => {
    await libraryStore.updatePlaylist(playlistId, { name });
    set({ playlists: libraryStore.getPlaylists() });
  },

  deletePlaylist: async (playlistId) => {
    await libraryStore.deletePlaylist(playlistId);
    set((prev) => ({
      playlists: libraryStore.getPlaylists(),
      activeDetailView:
        prev.activeDetailView?.kind === 'local_playlist' &&
        prev.activeDetailView.playlistId === playlistId
          ? null
          : prev.activeDetailView,
    }));
  },

  addTrackToPlaylist: async (playlistId, track) => {
    const existing = get().playlists.find((p) => p.id === playlistId);
    const alreadyIn = Boolean(existing?.tracks.some((t) => t.id === track.id));
    await libraryStore.addTrackToPlaylist(playlistId, track);
    if (!alreadyIn) {
      await recommendationEngine.recordSignal(track, 'add_to_playlist');
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
    get().showToast('Eliminada de la playlist');
  },

  reorderPlaylistTrack: async (playlistId, fromIndex, toIndex) => {
    await libraryStore.reorderPlaylistTrack(playlistId, fromIndex, toIndex);
    set({ playlists: libraryStore.getPlaylists() });
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

  signInSupabase: async (email, password) => {
    await syncEngine.signIn(email, password);
    set({
      authState: syncEngine.getAuthState(),
      onlineDevices: syncEngine.getOnlineDevices(),
    });
  },

  signUpSupabase: async (email, password) => {
    await syncEngine.signUp(email, password);
    set({
      authState: syncEngine.getAuthState(),
      onlineDevices: syncEngine.getOnlineDevices(),
    });
  },

  signOutSupabase: async () => {
    await syncEngine.signOut();
    set({
      authState: syncEngine.getAuthState(),
      onlineDevices: syncEngine.getOnlineDevices(),
    });
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
    const res = await syncEngine.transferPlaybackTo(targetDeviceId, {
      track: st.currentTrack,
      queue: st.queue,
      queueIndex: st.queueIndex,
      positionMs: Math.round(st.positionSec * 1000),
      isPlaying: st.isPlaying,
      volume: st.volume,
      djModeEnabled: st.djMode.enabled,
      djSessionStyle: st.djMode.style,
      sentAtEpochMs: Date.now(),
    });

    const targetDev = st.onlineDevices.find((d) => d.device_id === targetDeviceId);
    set({
      onlineDevices: syncEngine.getOnlineDevices(),
      lastTransferBanner: res.acked
        ? `Transferido a ${targetDev?.device_name ?? targetDeviceId} en ${Math.round(st.positionSec)}s`
        : `Enviado a ${targetDev?.device_name ?? targetDeviceId}`,
    });
  },

  setLiquidGlassMode: (enabled) => {
    const saver = !enabled;
    if (typeof document !== 'undefined') {
      document.documentElement.classList.toggle('pm-liquid-glass-all', enabled);
      document.documentElement.classList.toggle('pm-solid-modern', saver);
      document.documentElement.classList.toggle('pm-reduced-transparency', saver);
    }
    set({ liquidGlassMode: enabled, graphicSaverMode: saver });
    persistPrefsFromStore();
  },

  setGraphicSaverMode: (enabled) => {
    const liquid = !enabled;
    if (typeof document !== 'undefined') {
      document.documentElement.classList.toggle('pm-liquid-glass-all', liquid);
      document.documentElement.classList.toggle('pm-solid-modern', enabled);
      document.documentElement.classList.toggle('pm-reduced-transparency', enabled);
      document.documentElement.classList.toggle(
        'pm-reduced-motion',
        enabled || get().reducedMotionPref
      );
    }
    set({ graphicSaverMode: enabled, liquidGlassMode: liquid });
    persistPrefsFromStore();
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
    get().showToast(`Copia restaurada (${count} elementos)`);
    return count;
  },
  };
});
