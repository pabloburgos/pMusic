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
  type AutocompleteSuggestion,
  type DeckId,
  type DeckTransitionPlan,
  type DevicePresenceState,
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

export type MainNavTab = 'Inicio' | 'Buscar' | 'Biblioteca';
export type NowPlayingSubTab = 'Portada' | 'Letras' | 'Cola';
export type SearchScopeTab = 'Todo' | 'Canciones' | 'Artistas' | 'Álbumes' | 'Playlists';
export type LibraryCategoryTab = 'Todo' | 'Playlists' | 'Me gusta' | 'Descargas' | 'Historial';
export type OfflineDownloadStatus = 'idle' | 'downloading' | 'downloaded' | 'error';

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
  const baseUrl = await defaultPlatformBridge.buildStreamUrl(track.id, 'high');
  if (baseUrl.startsWith('blob:') || baseUrl.startsWith('data:')) {
    return baseUrl;
  }
  const sep = baseUrl.includes('?') ? '&' : '?';
  const artist = track.artists[0]?.name ?? '';
  return `${baseUrl}${sep}title=${encodeURIComponent(track.title)}&artist=${encodeURIComponent(artist)}&durationSec=${Math.round(track.durationSec || 200)}`;
}

const djPlanner = new DjCuePlanner();
const audioEngine = new DualDeckAudioEngine({
  resolveStreamUrl: resolveTrackStreamUrl,
});

let importAbortController: AbortController | null = null;
let searchTicket = 0;
let lyricsTicket = 0;
let djAutoTransitionInFlight = false;
let djPreloadedKey = '';
const decodedAudioAnalyzedIds = new Set<string>();
const decodedAudioInFlightIds = new Set<string>();

export type RepeatMode = 'off' | 'all' | 'one';

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
  activeDetailView: ActiveDetailView;
  isOfflineNetwork: boolean;
  graphicSaverMode: boolean;
  discordRpcEnabled: boolean;

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
  openArtistDetail: (artistId: string) => Promise<void>;
  openAlbumDetail: (albumId: string) => Promise<void>;
  openPlaylistDetail: (playlistId: string) => Promise<void>;
  openLocalPlaylistDetail: (playlistId: string) => void;
  closeDetailView: () => void;

  // Playback Actions
  playTrack: (track: Track, newQueue?: Track[], startSec?: number) => Promise<void>;
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
  addToQueue: (track: Track) => void;
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
  setGraphicSaverMode: (enabled: boolean) => void;
  setDiscordRpcEnabled: (enabled: boolean) => void;
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
  activeDetailView: null,
  isOfflineNetwork: typeof navigator !== 'undefined' ? !navigator.onLine : false,
  graphicSaverMode: false,
  discordRpcEnabled: true,

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

    set({
      playlists: libraryStore.getPlaylists(),
      likedTracks: libraryStore.getLikedTracks(),
      playHistory: libraryStore.getPlayHistory(),
      seedArtists: recommendationEngine.getSeedArtists(),
      affinityProfile: recommendationEngine.getAffinityProfile(),
      offlineEntries,
      offlineDownloads,
      trackAnalyses: analyses,
      homeShelves: shelves,
      onlineDevices: syncEngine.getOnlineDevices(),
    });

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

  setActiveTab: (tab) => set({ activeTab: tab, activeDetailView: null }),
  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
  setRightPanelOpen: (open) => set({ rightPanelOpen: open }),
  setNowPlayingOpen: (open) => set({ nowPlayingOpen: open }),
  setNowPlayingTab: (tab) => set({ nowPlayingTab: tab }),
  setEqSheetOpen: (open) => set({ eqSheetOpen: open }),
  setDevicesSheetOpen: (open) => set({ devicesSheetOpen: open }),
  setImportModalOpen: (open) => set({ importModalOpen: open, importError: null }),
  setSettingsOpen: (open) => set({ settingsOpen: open }),

  openArtistDetail: async (artistId) => {
    const data = await musicProvider.getArtist(artistId);
    set({ activeDetailView: { kind: 'artist', data } });
  },
  openAlbumDetail: async (albumId) => {
    const data = await musicProvider.getAlbum(albumId);
    set({ activeDetailView: { kind: 'album', data } });
  },
  openPlaylistDetail: async (playlistId) => {
    const data = await musicProvider.getPlaylist(playlistId);
    set({ activeDetailView: { kind: 'playlist', data } });
  },
  openLocalPlaylistDetail: (playlistId) => {
    set({ activeDetailView: { kind: 'local_playlist', playlistId } });
  },
  closeDetailView: () => set({ activeDetailView: null }),

  playTrack: async (track, newQueue, startSec) => {
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
      await audioEngine.loadAndPlay(track, effectiveStartSec);
      void analyzeTrackAudioInBackground(track);

      void syncEngine.updatePresence({
        is_active: true,
        is_playing: true,
        track_title: `${track.title} — ${track.artists.map((a) => a.name).join(', ')}`,
      });

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

    await st.playTrack(next, st.queue);
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
    await st.playTrack(prev, st.queue);
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

  addToQueue: (track) => {
    const st = get();
    if (st.queue.some((t) => t.id === track.id)) return;
    set({ queue: [...st.queue, track] });
    void recomputeActiveDjPlan();
  },

  setAutoplayEnabled: (enabled) => set({ autoplayEnabled: enabled }),

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
  },

  setEqEnabled: (enabled) => {
    const st = get();
    const nextEq: UserEqConfig = {
      ...st.userEq,
      enabled,
    };
    audioEngine.setUserEq(nextEq);
    set({ userEq: nextEq });
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
      const rerankedSongs = recommendationEngine.rerankTracks(rawBundle.songs);
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
    await libraryStore.addTrackToPlaylist(playlistId, track);
    await recommendationEngine.recordSignal(track, 'add_to_playlist');
    set({
      playlists: libraryStore.getPlaylists(),
      affinityProfile: recommendationEngine.getAffinityProfile(),
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

  setGraphicSaverMode: (enabled) => {
    if (typeof document !== 'undefined') {
      document.documentElement.classList.toggle('pm-reduced-transparency', enabled);
      document.documentElement.classList.toggle('pm-reduced-motion', enabled);
    }
    set({ graphicSaverMode: enabled });
  },

  setDiscordRpcEnabled: (enabled) => {
    set({ discordRpcEnabled: enabled });
    void defaultPlatformBridge.updateDiscordPresence?.({
      track: get().currentTrack,
      isPlaying: get().isPlaying,
      positionSec: get().positionSec,
      enabled,
    });
  },
  };
});
