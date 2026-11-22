/**
 * Playwright network & WebSocket interceptor for opaque-box pMusic E2E tests.
 *
 * Intercepts all 12 `/api/*` endpoints, `/__mock__/art/*` pure-Node 64x64 PNG
 * & SVG artwork routes, `https://lrclib.net/api/**` (with CORS `OPTIONS`
 * preflight for `Lrclib-Client` and strict +/-2s duration cascade), Spotify
 * playlist/album import modes, and Supabase Auth/REST + Realtime WebSocket
 * (`page.routeWebSocket`) Connect Presence/Broadcast/Transfer flows.
 *
 * Strictly opaque-box: ZERO imports from `apps/**` or `packages/**`.
 */

import type { Page, Route, WebSocketRoute } from '@playwright/test';
import { generateWavBuffer, sliceRange } from './wav-generator';
import {
  ARTIST_ID_ALIASES,
  MOCK_ALBUMS,
  MOCK_ARTISTS,
  MOCK_PLAYLISTS,
  MOCK_TRACKS,
  TRACK_AUDIO_SPECS,
  TRACK_LYRICS_SPECS,
  buildMockHomeFeed,
  findAlbumById,
  findArtistById,
  findPlaylistById,
  findTrackById,
  getMockArtPngBuffer,
  getMockArtSvg,
  normalizeSpanishText,
  queryMockCatalog,
  queryMockSuggestions,
  resolveCanonicalTrackId,
  type MockLrclibRecord,
  type MockSpotifyImportPayload,
  type MockTrack,
} from './test-data';

export * from './test-data';

export type SpotifyImportMode =
  | 'normal'
  | 'partial_unmatched'
  | 'cap_100'
  | 'private_or_invalid'
  | 'slow_cancel';

export type SupabaseAuthMode =
  | 'ok'
  | 'invalid_credentials'
  | 'rate_limited'
  | 'paused_503';

export interface MockPeerDeviceState {
  deviceId: string;
  deviceName: string;
  platform: 'android' | 'desktop' | 'web';
  isOnline: boolean;
  trackId: string;
  trackTitle: string;
  artistName: string;
  albumName?: string;
  thumbnailUrl?: string;
  positionMs: number;
  positionSec: number;
  durationSec: number;
  isPlaying: boolean;
  volume: number;
  updatedAt?: string;
}

export interface MockSupabaseOptions {
  urlPrefix?: string;
  authMode?: SupabaseAuthMode;
  userEmail?: string;
  userId?: string;
  peers?: MockPeerDeviceState[];
  dropTransferAck?: boolean;
}

export interface MockApiOptions {
  offline?: boolean;
  failRoutes?: {
    home?: number | 'abort';
    search?: number | 'abort';
    suggestions?: number | 'abort';
    stream?: number | 'abort' | Record<string, number | 'abort'>;
    lyrics?: number | 'abort';
    importSpotify?: number | 'abort';
    playlist?: number | 'abort';
  };
  failOnce?: Array<
    | 'home'
    | 'search'
    | 'suggestions'
    | 'stream'
    | 'lyrics'
    | 'importSpotify'
    | 'playlist'
  >;
  latencyMs?: {
    home?: number;
    search?: number;
    suggestions?: number;
    importSpotify?: number;
    stream?: number;
    playlist?: number;
    lyrics?: number;
  };
  spotifyImportMode?: SpotifyImportMode;
  wavDurationSec?: number;
  streamFailFirstCount?: number;
  supabaseMock?: MockSupabaseOptions;
  blockExternal?: boolean;
}

export interface CapturedRequest {
  method: string;
  url: string;
  pathname: string;
  searchParams: Record<string, string>;
  headers: Record<string, string>;
  status: number;
  timestampMs: number;
  postData?: string | null;
}

export interface MockRealtimeBroadcastEvent {
  topic: string;
  event: string;
  payload: Record<string, unknown>;
  timestampMs: number;
}

export interface MockApiController {
  readonly requests: CapturedRequest[];
  getRequests(pathnamePrefix?: string): CapturedRequest[];
  getSearchQueries(): string[];
  getRangeRequests(trackId?: string): CapturedRequest[];
  getImportCalls(): CapturedRequest[];
  getLyricsCalls(): CapturedRequest[];
  getRealtimeBroadcasts(): MockRealtimeBroadcastEvent[];
  setOffline(offline: boolean): void;
  setOptions(patch: Partial<MockApiOptions>): void;
  setPeerDevices(peers: MockPeerDeviceState[]): void;
  emitRealtimeBroadcast(event: string, payload: Record<string, unknown>): void;
  clearLogs(): void;
  uninstall(): Promise<void>;
}

const CORS_HEADERS: Readonly<Record<string, string>> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS',
  'Access-Control-Allow-Headers':
    'Lrclib-Client, X-User-Agent, User-Agent, Content-Type, Authorization, apikey, Range, X-PMusic-Token, X-Client-Info, Prefer',
  'Access-Control-Expose-Headers':
    'Content-Length, Content-Range, Accept-Ranges, Retry-After',
};

const DEFAULT_ANDROID_PEER: MockPeerDeviceState = {
  deviceId: 'peer-android-pixel8',
  deviceName: 'Android · Pixel 8',
  platform: 'android',
  isOnline: true,
  trackId: 'pmBBtiti001',
  trackTitle: 'Tití Me Preguntó',
  artistName: 'Bad Bunny',
  albumName: 'Un Verano Sin Ti',
  thumbnailUrl: '/__mock__/art/bb-titi.png',
  positionMs: 14000,
  positionSec: 14,
  durationSec: 244,
  isPlaying: true,
  volume: 0.8,
  updatedAt: '2026-11-22T14:00:00.000Z',
};

function delay(ms: number | undefined): Promise<void> {
  if (!ms || ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseSearchParams(urlObj: URL): Record<string, string> {
  const out: Record<string, string> = {};
  urlObj.searchParams.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

function findTrackByTitleAndArtist(
  trackName: string,
  artistName?: string
): MockTrack | undefined {
  const normTitle = normalizeSpanishText(trackName);
  const normArtist = artistName ? normalizeSpanishText(artistName) : '';
  if (!normTitle) return undefined;

  // Exact or substring title match
  const candidates = MOCK_TRACKS.filter((t) => {
    const tTitle = normalizeSpanishText(t.title);
    return tTitle === normTitle || tTitle.includes(normTitle) || normTitle.includes(tTitle);
  });

  if (candidates.length === 0) return undefined;
  if (!normArtist) return candidates[0];

  const withArtist = candidates.find((t) =>
    t.artists.some((a) => {
      const aName = normalizeSpanishText(a.name);
      return aName.includes(normArtist) || normArtist.includes(aName);
    })
  );
  return withArtist ?? candidates[0];
}

function buildLrclibRecord(track: MockTrack): MockLrclibRecord | null {
  const canonicalId = resolveCanonicalTrackId(track.id);
  const spec = TRACK_LYRICS_SPECS[canonicalId];
  if (!spec || spec.mode === 'no_lyrics' || spec.mode === 'yt_plain_fallback') {
    return null;
  }
  const numericId =
    canonicalId
      .split('')
      .reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) % 900000, 100000) || 100001;

  return {
    id: numericId,
    name: track.title,
    trackName: track.title,
    artistName: track.artists.map((a) => a.name).join(', '),
    albumName: track.album?.name ?? 'Single',
    duration: spec.lrclibDurationSec ?? track.durationSec,
    instrumental: spec.mode === 'instrumental',
    plainLyrics: spec.plainLyrics,
    syncedLyrics: spec.syncedLyrics,
  };
}

function isValidSpotifyUrl(rawUrl: string): {
  valid: boolean;
  kind: 'playlist' | 'album';
  id: string;
} {
  const trimmed = rawUrl.trim();
  if (!trimmed) return { valid: false, kind: 'playlist', id: '' };

  const uriMatch = /^spotify:(playlist|album):([a-zA-Z0-9_-]{6,64})$/i.exec(trimmed);
  if (uriMatch) {
    const kind = (uriMatch[1]?.toLowerCase() === 'album' ? 'album' : 'playlist') as
      | 'playlist'
      | 'album';
    return { valid: true, kind, id: uriMatch[2] ?? '37i9dQZF1DXaxEKcoCdWHD' };
  }

  try {
    const u = new URL(trimmed);
    if (!/^(open\.spotify\.com|spotify\.link)$/i.test(u.hostname)) {
      return { valid: false, kind: 'playlist', id: '' };
    }
    if (u.hostname.toLowerCase() === 'spotify.link') {
      return {
        valid: u.pathname.length > 1,
        kind: 'playlist',
        id: u.pathname.slice(1) || '37i9dQZF1DXaxEKcoCdWHD',
      };
    }
    const pathMatch =
      /^\/(?:intl-[a-z]{2}\/)?(?:embed\/)?(playlist|album)\/([a-zA-Z0-9_-]{6,64})/i.exec(
        u.pathname
      );
    if (!pathMatch) {
      return { valid: false, kind: 'playlist', id: '' };
    }
    const kind = (pathMatch[1]?.toLowerCase() === 'album' ? 'album' : 'playlist') as
      | 'playlist'
      | 'album';
    return { valid: true, kind, id: pathMatch[2] ?? '37i9dQZF1DXaxEKcoCdWHD' };
  } catch {
    return { valid: false, kind: 'playlist', id: '' };
  }
}

function buildSpotifyImportPayload(
  sourceUrl: string,
  kind: 'playlist' | 'album',
  id: string,
  mode: SpotifyImportMode
): MockSpotifyImportPayload {
  const baseFourTracks = [
    {
      title: 'Mina el Hammani',
      artists: ['Cruz Cafuné'],
      rawSubtitle: 'Cruz Cafuné',
      durationSec: 197,
      album: 'Me Muevo Con Dios',
      matchedTrackId: 'pmCCmina002',
    },
    {
      title: 'Cayó La Noche (Remix)',
      // Exercises \u00A0 non-breaking space multi-artist delimiter splitting!
      artists: ['La Pantera', 'Quevedo'],
      rawSubtitle: 'La Pantera,\u00A0Quevedo',
      durationSec: 238,
      album: 'Canarias Urbano',
      matchedTrackId: 'pmLPcayo003',
    },
    {
      title: 'Tití Me Preguntó',
      artists: ['Bad Bunny'],
      rawSubtitle: 'Bad Bunny',
      durationSec: 244,
      album: 'Un Verano Sin Ti',
      matchedTrackId: 'pmBBtiti001',
    },
    {
      title: 'Modelito',
      artists: ['Mora'],
      rawSubtitle: 'Mora',
      durationSec: 204,
      album: 'ESTRELLA',
      matchedTrackId: 'pmMRmode005',
    },
  ];

  if (mode === 'partial_unmatched') {
    return {
      id,
      kind,
      name: 'Urbano España · Selección Parcial',
      author: 'Spotify España',
      coverUrl: '/__mock__/art/lp-cayo.png',
      sourceUrl,
      truncated: false,
      tracks: [
        baseFourTracks[0]!,
        baseFourTracks[1]!,
        baseFourTracks[2]!,
        {
          title: 'Tema Regional Bloqueado XYZ',
          artists: ['Artista Desconocido 999'],
          rawSubtitle: 'Artista Desconocido 999',
          durationSec: 180,
          album: 'Inédito',
          matchedTrackId: null,
        },
      ],
    };
  }

  if (mode === 'cap_100') {
    const tracks = Array.from({ length: 100 }, (_, idx) => {
      if (idx === 0) {
        return {
          title: 'Cayó La Noche (Remix)',
          artists: ['La Pantera', 'Quevedo'],
          rawSubtitle: 'La Pantera,\u00A0Quevedo',
          durationSec: 238,
          album: 'Canarias Urbano',
          matchedTrackId: 'pmLPcayo003',
        };
      }
      const template = baseFourTracks[idx % baseFourTracks.length]!;
      return {
        ...template,
        title: idx < 4 ? template.title : `${template.title} (Sesión #${idx + 1})`,
      };
    });

    return {
      id,
      kind,
      name: 'Top 100 Urbano España',
      author: 'Spotify Editorial',
      coverUrl: '/__mock__/art/bb-titi.png',
      sourceUrl,
      truncated: true,
      warning:
        'Spotify limita las playlists públicas sin clave a las primeras 100 canciones.',
      tracks,
    };
  }

  if (mode === 'slow_cancel') {
    return {
      id,
      kind,
      name: 'Sesión Larga Cancelable',
      author: 'Spotify España',
      coverUrl: '/__mock__/art/cc-mina.png',
      sourceUrl,
      truncated: false,
      tracks: [
        ...baseFourTracks,
        {
          title: 'Columbia',
          artists: ['Quevedo'],
          rawSubtitle: 'Quevedo',
          durationSec: 186,
          album: 'Donde Quiero Estar',
          matchedTrackId: 'pmQVcolu004',
        },
        {
          title: 'Supernova',
          artists: ['Saiko'],
          rawSubtitle: 'Saiko',
          durationSec: 192,
          album: 'SAKURA',
          matchedTrackId: 'pmSKsupe006',
        },
      ],
    };
  }

  return {
    id,
    kind,
    name: kind === 'album' ? 'Un Verano Sin Ti (Importado)' : 'Éxitos Urbano España',
    author: 'Spotify España',
    coverUrl: '/__mock__/art/cc-mina.png',
    sourceUrl,
    truncated: false,
    tracks: baseFourTracks,
  };
}

/**
 * Installs deterministic route & WebSocket handlers on a Playwright `Page`.
 */
export async function installMockApi(
  page: Page,
  initialOptions?: MockApiOptions
): Promise<MockApiController> {
  const state: MockApiOptions = {
    offline: initialOptions?.offline ?? false,
    failRoutes: { ...(initialOptions?.failRoutes ?? {}) },
    failOnce: [...(initialOptions?.failOnce ?? [])],
    latencyMs: { ...(initialOptions?.latencyMs ?? {}) },
    spotifyImportMode: initialOptions?.spotifyImportMode ?? 'normal',
    wavDurationSec: initialOptions?.wavDurationSec,
    streamFailFirstCount: initialOptions?.streamFailFirstCount ?? 0,
    supabaseMock: {
      authMode: initialOptions?.supabaseMock?.authMode ?? 'ok',
      userEmail: initialOptions?.supabaseMock?.userEmail ?? 'pablo@pmusic.es',
      userId: initialOptions?.supabaseMock?.userId ?? '00000000-0000-4000-8000-000000000001',
      urlPrefix: initialOptions?.supabaseMock?.urlPrefix,
      peers: initialOptions?.supabaseMock?.peers
        ? [...initialOptions.supabaseMock.peers]
        : [{ ...DEFAULT_ANDROID_PEER }],
      dropTransferAck: initialOptions?.supabaseMock?.dropTransferAck ?? false,
    },
    blockExternal: initialOptions?.blockExternal ?? true,
  };

  const requests: CapturedRequest[] = [];
  const realtimeBroadcasts: MockRealtimeBroadcastEvent[] = [];
  const activeWsClients = new Set<{
    ws: WebSocketRoute;
    topic: string;
  }>();
  const failOnceConsumed = new Set<string>();
  let remainingStreamFails = state.streamFailFirstCount ?? 0;

  function recordRequest(route: Route, status: number): void {
    const req = route.request();
    const rawUrl = req.url();
    let pathname = rawUrl;
    let searchParams: Record<string, string> = {};
    try {
      const parsed = new URL(rawUrl);
      pathname = parsed.pathname;
      searchParams = parseSearchParams(parsed);
    } catch {
      // Fallback for non-standard URLs
    }
    requests.push({
      method: req.method().toUpperCase(),
      url: rawUrl,
      pathname,
      searchParams,
      headers: req.headers(),
      status,
      timestampMs: Date.now(),
      postData: req.postData(),
    });
  }

  async function respondJson(
    route: Route,
    status: number,
    payload: unknown,
    extraHeaders?: Record<string, string>
  ): Promise<void> {
    recordRequest(route, status);
    await route.fulfill({
      status,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        ...(extraHeaders ?? {}),
      },
      body: JSON.stringify(payload),
    });
  }

  async function handleOptionsPreflight(route: Route): Promise<boolean> {
    if (route.request().method().toUpperCase() === 'OPTIONS') {
      recordRequest(route, 204);
      await route.fulfill({
        status: 204,
        headers: { ...CORS_HEADERS },
        body: '',
      });
      return true;
    }
    return false;
  }

  function checkRouteFailure(
    routeKey: 'home' | 'search' | 'suggestions' | 'lyrics' | 'importSpotify' | 'playlist'
  ): number | 'abort' | null {
    if (state.offline) return 'abort';
    if (
      state.failOnce?.includes(routeKey) &&
      !failOnceConsumed.has(routeKey)
    ) {
      failOnceConsumed.add(routeKey);
      return 500;
    }
    const configured = state.failRoutes?.[routeKey];
    return configured ?? null;
  }

  async function applyFailureIfAny(
    route: Route,
    failure: number | 'abort' | null,
    errorCode = 'UPSTREAM_ERROR',
    errorMessage = 'No se pudo completar la solicitud en este momento.'
  ): Promise<boolean> {
    if (!failure) return false;
    if (failure === 'abort') {
      recordRequest(route, 0);
      await route.abort('failed');
      return true;
    }
    await respondJson(route, failure, {
      ok: false,
      code: errorCode,
      error: errorMessage,
      message: errorMessage,
    });
    return true;
  }

  // 1. Register optional external host blocker FIRST (lowest priority in Playwright LIFO)
  if (state.blockExternal !== false) {
    await page.route(/^https?:\/\//i, async (route) => {
      const rawUrl = route.request().url();
      try {
        const u = new URL(rawUrl);
        const host = u.hostname.toLowerCase();
        const isLocal =
          host === '127.0.0.1' ||
          host === 'localhost' ||
          host.endsWith('.local') ||
          host === 'lrclib.net' ||
          host.endsWith('.supabase.co') ||
          host.includes('supabase');
        if (isLocal) {
          await route.fallback();
          return;
        }
      } catch {
        // Ignore parse error
      }
      await route.abort('blockedbyclient');
    });
  }

  // 2. Register Pure-Node 64x64 PNG & SVG Cover Art Interceptor
  await page.route(
    /\/(?:__mock__\/art|api\/mock-art|mock-art)\/([^/?#]+)/i,
    async (route) => {
      if (await handleOptionsPreflight(route)) return;
      const urlObj = new URL(route.request().url());
      const filename = urlObj.pathname.split('/').pop() ?? 'cc-mina.png';
      const isSvg = filename.toLowerCase().endsWith('.svg');

      if (isSvg) {
        const svg = getMockArtSvg(filename);
        if (svg === null) {
          recordRequest(route, 404);
          await route.fulfill({
            status: 404,
            headers: { ...CORS_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' },
            body: 'Artwork not found',
          });
          return;
        }
        recordRequest(route, 200);
        await route.fulfill({
          status: 200,
          headers: {
            ...CORS_HEADERS,
            'Content-Type': 'image/svg+xml; charset=utf-8',
            'Cache-Control': 'public, max-age=3600',
          },
          body: svg,
        });
        return;
      }

      const png = getMockArtPngBuffer(filename);
      if (png === null) {
        recordRequest(route, 404);
        await route.fulfill({
          status: 404,
          headers: { ...CORS_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' },
          body: 'Artwork not found',
        });
        return;
      }

      recordRequest(route, 200);
      await route.fulfill({
        status: 200,
        headers: {
          ...CORS_HEADERS,
          'Content-Type': 'image/png',
          'Content-Length': String(png.length),
          'Cache-Control': 'public, max-age=3600',
        },
        body: png,
      });
    }
  );

  // 3. GET /api/health
  await page.route(/\/api\/health(?:\?|$)/i, async (route) => {
    if (await handleOptionsPreflight(route)) return;
    if (state.offline) {
      recordRequest(route, 0);
      await route.abort('failed');
      return;
    }
    await respondJson(route, 200, {
      ok: true,
      status: 'ok',
      region: 'ES',
      lang: 'es',
    });
  });

  // 4. GET /api/search
  await page.route(/\/api\/search(?:\?|$)/i, async (route) => {
    if (await handleOptionsPreflight(route)) return;
    const effectiveDelay =
      state.latencyMs?.search ??
      (state.spotifyImportMode === 'slow_cancel' ? 550 : 0);
    await delay(effectiveDelay);

    const failure = checkRouteFailure('search');
    if (
      await applyFailureIfAny(
        route,
        failure,
        'SEARCH_FAILED',
        'No se pudo completar la búsqueda. Inténtalo de nuevo.'
      )
    ) {
      return;
    }

    const urlObj = new URL(route.request().url());
    const q = urlObj.searchParams.get('q') ?? urlObj.searchParams.get('query') ?? '';
    const filter = urlObj.searchParams.get('filter') ?? 'all';
    const bundle = queryMockCatalog(q, filter);
    await respondJson(route, 200, bundle);
  });

  // 5. GET /api/suggestions
  await page.route(/\/api\/suggestions(?:\?|$)/i, async (route) => {
    if (await handleOptionsPreflight(route)) return;
    await delay(state.latencyMs?.suggestions);

    const failure = checkRouteFailure('suggestions');
    if (
      await applyFailureIfAny(
        route,
        failure,
        'SUGGESTIONS_FAILED',
        'No se pudieron cargar las sugerencias.'
      )
    ) {
      return;
    }

    const urlObj = new URL(route.request().url());
    const q = urlObj.searchParams.get('q') ?? urlObj.searchParams.get('query') ?? '';
    const suggestions = queryMockSuggestions(q);
    await respondJson(route, 200, { suggestions });
  });

  // 6. GET /api/home
  await page.route(/\/api\/home(?:\?|$)/i, async (route) => {
    if (await handleOptionsPreflight(route)) return;
    await delay(state.latencyMs?.home);

    const failure = checkRouteFailure('home');
    if (
      await applyFailureIfAny(
        route,
        failure,
        'HOME_FEED_FAILED',
        'No se pudo cargar el inicio. Revisa tu conexión e inténtalo de nuevo.'
      )
    ) {
      return;
    }

    const urlObj = new URL(route.request().url());
    const mood = urlObj.searchParams.get('mood') ?? undefined;
    await respondJson(route, 200, buildMockHomeFeed(mood));
  });

  // 7. GET /api/up-next/:videoId
  await page.route(/\/api\/up-next\/([^/?#]+)/i, async (route) => {
    if (await handleOptionsPreflight(route)) return;
    if (state.offline) {
      recordRequest(route, 0);
      await route.abort('failed');
      return;
    }

    const urlObj = new URL(route.request().url());
    const rawId = decodeURIComponent(urlObj.pathname.split('/').pop() ?? '');
    const canonicalId = resolveCanonicalTrackId(rawId);
    const tracks = MOCK_TRACKS.filter((t) => t.id !== canonicalId).slice(0, 8);
    await respondJson(route, 200, { tracks });
  });

  // 8. GET /api/related/:videoId
  await page.route(/\/api\/related\/([^/?#]+)/i, async (route) => {
    if (await handleOptionsPreflight(route)) return;
    if (state.offline) {
      recordRequest(route, 0);
      await route.abort('failed');
      return;
    }

    const urlObj = new URL(route.request().url());
    const rawId = decodeURIComponent(urlObj.pathname.split('/').pop() ?? '');
    const canonicalId = resolveCanonicalTrackId(rawId);
    const tracks = MOCK_TRACKS.filter((t) => t.id !== canonicalId).slice(0, 6);
    await respondJson(route, 200, {
      tracks,
      artists: MOCK_ARTISTS.slice(0, 4),
      playlists: MOCK_PLAYLISTS,
    });
  });

  // 9. GET /api/artist/:artistId
  await page.route(/\/api\/artist\/([^/?#]+)/i, async (route) => {
    if (await handleOptionsPreflight(route)) return;
    if (state.offline) {
      recordRequest(route, 0);
      await route.abort('failed');
      return;
    }

    const urlObj = new URL(route.request().url());
    const rawId = decodeURIComponent(urlObj.pathname.split('/').pop() ?? '');
    const artist =
      findArtistById(rawId) ??
      MOCK_ARTISTS.find(
        (a) => normalizeSpanishText(a.name) === normalizeSpanishText(rawId)
      );

    if (!artist) {
      await respondJson(route, 404, {
        code: 'ARTIST_NOT_FOUND',
        error: 'Artista no encontrado.',
      });
      return;
    }

    const topSongs = MOCK_TRACKS.filter((t) =>
      t.artists.some((a) => (ARTIST_ID_ALIASES[a.id] ?? a.id) === artist.id)
    );
    const albums = MOCK_ALBUMS.filter((al) =>
      al.artists.some((a) => (ARTIST_ID_ALIASES[a.id] ?? a.id) === artist.id)
    );
    const relatedArtists = MOCK_ARTISTS.filter((a) => a.id !== artist.id).slice(0, 4);

    await respondJson(route, 200, {
      artist,
      bannerUrl: artist.bannerUrl ?? artist.thumbnailUrl,
      description: artist.description,
      topSongs: topSongs.length > 0 ? topSongs : MOCK_TRACKS.slice(0, 4),
      albums: albums.length > 0 ? albums : MOCK_ALBUMS.slice(0, 2),
      singles: albums.slice(0, 1),
      relatedArtists,
    });
  });

  // 10. GET /api/album/:albumId
  await page.route(/\/api\/album\/([^/?#]+)/i, async (route) => {
    if (await handleOptionsPreflight(route)) return;
    if (state.offline) {
      recordRequest(route, 0);
      await route.abort('failed');
      return;
    }

    const urlObj = new URL(route.request().url());
    const rawId = decodeURIComponent(urlObj.pathname.split('/').pop() ?? '');
    const album = findAlbumById(rawId);

    if (!album) {
      await respondJson(route, 404, {
        code: 'ALBUM_NOT_FOUND',
        error: 'Álbum no encontrado.',
      });
      return;
    }

    const tracks = MOCK_TRACKS.filter((t) => t.album?.id === album.id);
    await respondJson(route, 200, {
      album,
      tracks: tracks.length > 0 ? tracks : MOCK_TRACKS.slice(0, 4),
    });
  });

  // 11. GET /api/playlist/:playlistId
  await page.route(/\/api\/playlist\/([^/?#]+)/i, async (route) => {
    if (await handleOptionsPreflight(route)) return;
    await delay(state.latencyMs?.playlist);

    const failure = checkRouteFailure('playlist');
    if (
      await applyFailureIfAny(
        route,
        failure,
        'PLAYLIST_LOAD_FAILED',
        'No se pudo cargar la playlist.'
      )
    ) {
      return;
    }

    const urlObj = new URL(route.request().url());
    const rawId = decodeURIComponent(urlObj.pathname.split('/').pop() ?? '');
    if (rawId.toLowerCase().includes('private') || rawId.toLowerCase().includes('404')) {
      await respondJson(route, 404, {
        code: 'PLAYLIST_PRIVATE_OR_NOT_FOUND',
        error: 'La playlist de YouTube es privada o no existe.',
      });
      return;
    }

    const found = findPlaylistById(rawId);
    if (!found) {
      await respondJson(route, 404, {
        code: 'PLAYLIST_PRIVATE_OR_NOT_FOUND',
        error: 'Playlist no encontrada.',
      });
      return;
    }

    await respondJson(route, 200, found);
  });

  // 12. GET /api/lyrics/yt/:videoId
  await page.route(/\/api\/lyrics\/yt\/([^/?#]+)/i, async (route) => {
    if (await handleOptionsPreflight(route)) return;
    await delay(state.latencyMs?.lyrics);

    const failure = checkRouteFailure('lyrics');
    if (
      await applyFailureIfAny(
        route,
        failure,
        'LYRICS_FAILED',
        'No se pudieron cargar las letras.'
      )
    ) {
      return;
    }

    const urlObj = new URL(route.request().url());
    const rawId = decodeURIComponent(urlObj.pathname.split('/').pop() ?? '');
    const canonicalId = resolveCanonicalTrackId(rawId);
    const spec = TRACK_LYRICS_SPECS[canonicalId];
    const plain =
      spec && spec.mode !== 'no_lyrics' && spec.mode !== 'instrumental'
        ? spec.plainLyrics
        : null;

    await respondJson(route, 200, {
      videoId: rawId,
      lyrics: plain,
      plainLyrics: plain,
      syncedLyrics: null,
    });
  });

  // 13. GET | HEAD | OPTIONS /api/stream/:videoId
  await page.route(/\/api\/stream\/([^/?#]+)/i, async (route) => {
    if (await handleOptionsPreflight(route)) return;
    await delay(state.latencyMs?.stream);

    if (state.offline) {
      recordRequest(route, 0);
      await route.abort('failed');
      return;
    }

    const urlObj = new URL(route.request().url());
    const rawId = decodeURIComponent(urlObj.pathname.split('/').pop() ?? '');
    const canonicalId = resolveCanonicalTrackId(rawId);

    // Check decrementing streamFailFirstCount
    if (remainingStreamFails > 0) {
      remainingStreamFails--;
      await respondJson(route, 503, {
        code: 'STREAM_UNAVAILABLE',
        error: 'No se pudo cargar el flujo de audio. Pulsa Reintentar.',
      });
      return;
    }

    // Check failOnce: ['stream']
    if (
      state.failOnce?.includes('stream') &&
      !failOnceConsumed.has('stream')
    ) {
      failOnceConsumed.add('stream');
      await respondJson(route, 503, {
        code: 'STREAM_UNAVAILABLE',
        error: 'No se pudo cargar el flujo de audio. Pulsa Reintentar.',
      });
      return;
    }

    // Check failRoutes.stream (global or per-trackId map)
    const streamFailConfig = state.failRoutes?.stream;
    const specificFail =
      typeof streamFailConfig === 'object' && streamFailConfig !== null
        ? streamFailConfig[rawId] ?? streamFailConfig[canonicalId] ?? null
        : streamFailConfig ?? null;

    if (
      await applyFailureIfAny(
        route,
        specificFail,
        'STREAM_UNAVAILABLE',
        'No se pudo reproducir la canción en este momento.'
      )
    ) {
      return;
    }

    const audioSpec =
      TRACK_AUDIO_SPECS[canonicalId] ?? TRACK_AUDIO_SPECS['pmCCmina002']!;
    // Short signal tracks keep their exact short duration unless explicitly overridden
    const isShortSpecial =
      canonicalId === 'pmQVshrt013' || canonicalId === 'pmLPmiss014';
    const targetDurationSec = isShortSpecial
      ? audioSpec.wavDurationSec
      : state.wavDurationSec ?? audioSpec.wavDurationSec;

    const wavBuffer = generateWavBuffer({
      bpm: audioSpec.bpm,
      pattern: audioSpec.pattern,
      durationSec: targetDurationSec,
      baseFreqHz: audioSpec.baseFreqHz,
      sampleRate: targetDurationSec >= 60 ? 8000 : 22050,
      structuredEnvelope: true,
    });

    const rangeHeader = route.request().headers()['range'];
    const sliced = sliceRange(wavBuffer, rangeHeader, 'audio/wav');
    const isHead = route.request().method().toUpperCase() === 'HEAD';

    recordRequest(route, sliced.status);
    await route.fulfill({
      status: sliced.status,
      headers: sliced.headers,
      body: isHead ? Buffer.alloc(0) : sliced.body,
    });
  });

  // 14. GET | OPTIONS /api/import/spotify
  await page.route(/\/api\/import\/spotify(?:\?|$)/i, async (route) => {
    if (await handleOptionsPreflight(route)) return;
    await delay(state.latencyMs?.importSpotify);

    const failure = checkRouteFailure('importSpotify');
    if (
      await applyFailureIfAny(
        route,
        failure,
        'SPOTIFY_IMPORT_FAILED',
        'No se pudo importar la playlist desde Spotify.'
      )
    ) {
      return;
    }

    const urlObj = new URL(route.request().url());
    const sourceUrl = urlObj.searchParams.get('url') ?? '';
    const parsed = isValidSpotifyUrl(sourceUrl);

    if (!parsed.valid) {
      await respondJson(route, 400, {
        code: 'INVALID_PLAYLIST_URL',
        error: 'Introduce un enlace válido de playlist de Spotify o YouTube.',
        message: 'Introduce un enlace válido de playlist de Spotify o YouTube.',
      });
      return;
    }

    const mode: SpotifyImportMode =
      parsed.id.toLowerCase().includes('private') ||
      parsed.id.toLowerCase().includes('empty') ||
      parsed.id.toLowerCase().includes('404')
        ? 'private_or_invalid'
        : state.spotifyImportMode ?? 'normal';

    if (mode === 'private_or_invalid') {
      await respondJson(route, 404, {
        code: 'PLAYLIST_PRIVATE_OR_NOT_FOUND',
        error:
          'Esta playlist de Spotify es privada o no está disponible públicamente.',
        message:
          'Esta playlist de Spotify es privada o no está disponible públicamente.',
      });
      return;
    }

    const payload = buildSpotifyImportPayload(
      sourceUrl,
      parsed.kind,
      parsed.id,
      mode
    );
    await respondJson(route, 200, payload);
  });

  // 15. External LRCLIB v1 API Interceptor (`https://lrclib.net/api/**`)
  await page.route(/https?:\/\/lrclib\.net\/api\//i, async (route) => {
    if (await handleOptionsPreflight(route)) return;
    await delay(state.latencyMs?.lyrics);

    const failure = checkRouteFailure('lyrics');
    if (failure === 'abort') {
      recordRequest(route, 0);
      await route.abort('failed');
      return;
    }
    if (typeof failure === 'number') {
      if (failure === 429) {
        await respondJson(
          route,
          429,
          { statusCode: 429, message: 'Too Many Requests' },
          { 'Retry-After': '1' }
        );
        return;
      }
      if (failure === 400) {
        // LRCLIB real behavior: plain-text 400 body (tests Content-Type guard!)
        recordRequest(route, 400);
        await route.fulfill({
          status: 400,
          headers: {
            ...CORS_HEADERS,
            'Content-Type': 'text/plain; charset=utf-8',
          },
          body: 'Bad Request: invalid parameters',
        });
        return;
      }
      await respondJson(route, failure, {
        statusCode: failure,
        name: 'UpstreamError',
        message: 'LRCLIB service unavailable',
      });
      return;
    }

    const urlObj = new URL(route.request().url());
    const pathname = urlObj.pathname;

    // GET /api/get
    if (/\/api\/get$/i.test(pathname)) {
      const trackName = urlObj.searchParams.get('track_name') ?? '';
      const artistName = urlObj.searchParams.get('artist_name') ?? '';
      const durationStr = urlObj.searchParams.get('duration');

      if (!trackName || !artistName) {
        recordRequest(route, 400);
        await route.fulfill({
          status: 400,
          headers: {
            ...CORS_HEADERS,
            'Content-Type': 'text/plain; charset=utf-8',
          },
          body: 'Missing required parameter: track_name or artist_name',
        });
        return;
      }

      const matchedTrack = findTrackByTitleAndArtist(trackName, artistName);
      if (!matchedTrack) {
        await respondJson(route, 404, {
          statusCode: 404,
          name: 'TrackNotFound',
          message: 'Failed to find specified track',
        });
        return;
      }

      const canonicalId = resolveCanonicalTrackId(matchedTrack.id);
      const spec = TRACK_LYRICS_SPECS[canonicalId];
      const record = buildLrclibRecord(matchedTrack);

      if (!record || !spec) {
        await respondJson(route, 404, {
          statusCode: 404,
          name: 'TrackNotFound',
          message: 'Failed to find specified track',
        });
        return;
      }

      // Enforce LRCLIB's strict +/- 2s duration rule on /api/get
      if (durationStr !== null && durationStr !== '') {
        const reqDur = Number.parseFloat(durationStr);
        if (
          Number.isFinite(reqDur) &&
          Math.abs(reqDur - record.duration) > 2
        ) {
          await respondJson(route, 404, {
            statusCode: 404,
            name: 'TrackNotFound',
            message: 'Duration mismatch exceeding +/- 2 seconds',
          });
          return;
        }
      } else if (spec.mode === 'duration_mismatch_search_fallback') {
        await respondJson(route, 404, {
          statusCode: 404,
          name: 'TrackNotFound',
          message: 'Duration mismatch on strict /api/get lookup',
        });
        return;
      }

      await respondJson(route, 200, record);
      return;
    }

    // GET /api/search or /api/v2/search
    if (/\/api\/(?:v2\/)?search$/i.test(pathname)) {
      const q =
        urlObj.searchParams.get('q') ??
        urlObj.searchParams.get('track_name') ??
        '';
      const artistName = urlObj.searchParams.get('artist_name') ?? '';
      const matchedTrack = findTrackByTitleAndArtist(q, artistName);

      if (!matchedTrack) {
        await respondJson(route, 200, []);
        return;
      }

      const record = buildLrclibRecord(matchedTrack);
      await respondJson(route, 200, record ? [record] : []);
      return;
    }

    await respondJson(route, 404, {
      statusCode: 404,
      name: 'NotFound',
      message: 'Endpoint not found',
    });
  });

  // 16. Supabase Auth (`/auth/v1/**`) & REST (`/rest/v1/**`) Interceptors
  await page.route(/\/(?:auth|rest)\/v1\//i, async (route) => {
    if (await handleOptionsPreflight(route)) return;
    if (state.offline) {
      recordRequest(route, 0);
      await route.abort('failed');
      return;
    }

    const authMode = state.supabaseMock?.authMode ?? 'ok';
    if (authMode === 'paused_503') {
      await respondJson(route, 503, {
        code: 'PGRST002',
        message: 'Project is paused due to 7-day free tier inactivity.',
        error: 'Project paused',
      });
      return;
    }
    if (authMode === 'rate_limited') {
      await respondJson(
        route,
        429,
        {
          code: 'over_request_rate_limit',
          message: 'Demasiados intentos. Espera unos segundos.',
        },
        { 'Retry-After': '2' }
      );
      return;
    }

    const urlObj = new URL(route.request().url());
    const pathname = urlObj.pathname;

    if (pathname.includes('/auth/v1/')) {
      if (pathname.endsWith('/logout')) {
        recordRequest(route, 204);
        await route.fulfill({
          status: 204,
          headers: { ...CORS_HEADERS },
          body: '',
        });
        return;
      }

      if (authMode === 'invalid_credentials') {
        await respondJson(route, 400, {
          error: 'invalid_grant',
          error_description: 'Credenciales inválidas. Revisa tu correo y contraseña.',
          msg: 'Credenciales inválidas. Revisa tu correo y contraseña.',
        });
        return;
      }

      let email = state.supabaseMock?.userEmail ?? 'pablo@pmusic.es';
      try {
        const postBody = route.request().postDataJSON() as
          | { email?: string }
          | null;
        if (postBody?.email) {
          email = postBody.email;
          if (state.supabaseMock) {
            state.supabaseMock.userEmail = email;
          }
        }
      } catch {
        // Ignore JSON body parse errors
      }

      const userId =
        state.supabaseMock?.userId ?? '00000000-0000-4000-8000-000000000001';
      const userObj = {
        id: userId,
        aud: 'authenticated',
        role: 'authenticated',
        email,
        email_confirmed_at: '2026-11-22T12:00:00Z',
        app_metadata: { provider: 'email', providers: ['email'] },
        user_metadata: { display_name: 'Pablo Madrid' },
        created_at: '2026-11-22T12:00:00Z',
        updated_at: '2026-11-22T12:00:00Z',
      };

      if (pathname.endsWith('/user')) {
        await respondJson(route, 200, userObj);
        return;
      }

      await respondJson(route, 200, {
        access_token: 'mock-supabase-jwt-access-token',
        token_type: 'bearer',
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        refresh_token: 'mock-supabase-refresh-token',
        user: userObj,
      });
      return;
    }

    // /rest/v1/ tables
    if (pathname.includes('/device_sessions')) {
      const peers = (state.supabaseMock?.peers ?? [DEFAULT_ANDROID_PEER]).filter(
        (p) => p.isOnline
      );
      await respondJson(
        route,
        200,
        peers.map((p) => ({
          device_id: p.deviceId,
          device_name: p.deviceName,
          platform: p.platform,
          is_online: p.isOnline,
          current_track_id: p.trackId,
          current_track_title: p.trackTitle,
          current_artist_name: p.artistName,
          position_ms: p.positionMs,
          is_playing: p.isPlaying,
          volume: p.volume,
          updated_at: p.updatedAt ?? new Date().toISOString(),
        }))
      );
      return;
    }

    const method = route.request().method().toUpperCase();
    if (method === 'GET') {
      await respondJson(route, 200, []);
      return;
    }
    await respondJson(route, 201, []);
  });

  // 17. Supabase Realtime WebSocket Interceptor (`page.routeWebSocket`)
  function buildPresenceStatePayload(): Record<string, unknown> {
    const peers = (state.supabaseMock?.peers ?? [DEFAULT_ANDROID_PEER]).filter(
      (p) => p.isOnline
    );
    const presenceState: Record<string, unknown> = {};
    for (const p of peers) {
      presenceState[p.deviceId] = {
        metas: [
          {
            phx_ref: `ref-${p.deviceId}`,
            device_id: p.deviceId,
            deviceId: p.deviceId,
            device_name: p.deviceName,
            deviceName: p.deviceName,
            platform: p.platform,
            is_online: p.isOnline,
            isOnline: p.isOnline,
            track_id: p.trackId,
            trackId: p.trackId,
            track_title: p.trackTitle,
            trackTitle: p.trackTitle,
            artist_name: p.artistName,
            artistName: p.artistName,
            album_name: p.albumName ?? 'Un Verano Sin Ti',
            thumbnail_url: p.thumbnailUrl ?? '/__mock__/art/bb-titi.png',
            position_ms: p.positionMs,
            positionMs: p.positionMs,
            position_sec: p.positionSec,
            positionSec: p.positionSec,
            duration_sec: p.durationSec,
            durationSec: p.durationSec,
            is_playing: p.isPlaying,
            isPlaying: p.isPlaying,
            volume: p.volume,
          },
        ],
      };
    }
    return presenceState;
  }

  await page.routeWebSocket(/realtime\/v1\/websocket|pmusic-realtime/i, (ws) => {
    const clientEntry = { ws, topic: 'realtime:pmusic:user:default' };
    activeWsClients.add(clientEntry);

    ws.onClose(() => {
      activeWsClients.delete(clientEntry);
    });

    ws.onMessage((rawMsg) => {
      const text =
        typeof rawMsg === 'string'
          ? rawMsg
          : Buffer.from(rawMsg).toString('utf-8');

      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        return;
      }

      // Support Phoenix VSN 2 array format `[join_ref, ref, topic, event, payload]`
      // AND object format `{ topic, event, payload, ref }`
      let joinRef: string | null = null;
      let ref: string | null = null;
      let topic = clientEntry.topic;
      let event = '';
      let payload: Record<string, unknown> = {};
      const isV2Array = Array.isArray(parsed);

      if (isV2Array) {
        const arr = parsed as unknown[];
        joinRef = typeof arr[0] === 'string' ? arr[0] : null;
        ref = typeof arr[1] === 'string' ? arr[1] : null;
        topic = typeof arr[2] === 'string' ? arr[2] : topic;
        event = typeof arr[3] === 'string' ? arr[3] : '';
        payload =
          typeof arr[4] === 'object' && arr[4] !== null
            ? (arr[4] as Record<string, unknown>)
            : {};
      } else if (typeof parsed === 'object' && parsed !== null) {
        const obj = parsed as Record<string, unknown>;
        ref = typeof obj['ref'] === 'string' ? obj['ref'] : null;
        joinRef = typeof obj['join_ref'] === 'string' ? obj['join_ref'] : null;
        topic = typeof obj['topic'] === 'string' ? obj['topic'] : topic;
        event = typeof obj['event'] === 'string' ? obj['event'] : '';
        payload =
          typeof obj['payload'] === 'object' && obj['payload'] !== null
            ? (obj['payload'] as Record<string, unknown>)
            : obj;
      }

      function sendFrame(
        outTopic: string,
        outEvent: string,
        outPayload: Record<string, unknown>,
        outRef: string | null = null
      ): void {
        if (isV2Array) {
          ws.send(JSON.stringify([joinRef, outRef, outTopic, outEvent, outPayload]));
        } else {
          ws.send(
            JSON.stringify({
              topic: outTopic,
              event: outEvent,
              payload: outPayload,
              ref: outRef,
            })
          );
        }
      }

      if (event === 'phx_join') {
        clientEntry.topic = topic;
        sendFrame(
          topic,
          'phx_reply',
          {
            status: 'ok',
            response: { postgres_changes: [] },
          },
          ref
        );
        sendFrame(topic, 'presence_state', buildPresenceStatePayload(), null);
        return;
      }

      if (event === 'heartbeat') {
        sendFrame('phoenix', 'phx_reply', { status: 'ok', response: {} }, ref);
        return;
      }

      if (event === 'presence') {
        sendFrame(topic, 'phx_reply', { status: 'ok', response: {} }, ref);
        return;
      }

      if (event === 'broadcast' || event === 'command' || event === 'transfer') {
        const innerEvent =
          typeof payload['event'] === 'string' ? payload['event'] : event;
        const innerPayload =
          typeof payload['payload'] === 'object' && payload['payload'] !== null
            ? (payload['payload'] as Record<string, unknown>)
            : payload;

        realtimeBroadcasts.push({
          topic,
          event: innerEvent,
          payload: innerPayload,
          timestampMs: Date.now(),
        });

        if (ref) {
          sendFrame(topic, 'phx_reply', { status: 'ok', response: {} }, ref);
        }

        // Auto-respond with transfer_ack unless dropTransferAck is configured
        const isTransferReq =
          innerEvent === 'transfer' ||
          innerEvent === 'transfer_request' ||
          innerPayload['type'] === 'transfer' ||
          innerPayload['action'] === 'transfer';

        if (isTransferReq && !state.supabaseMock?.dropTransferAck) {
          const peer =
            state.supabaseMock?.peers?.[0] ?? DEFAULT_ANDROID_PEER;
          const ackPayload = {
            type: 'broadcast',
            event: 'transfer_ack',
            payload: {
              type: 'transfer_ack',
              status: 'ok',
              fromDeviceId: peer.deviceId,
              trackId: peer.trackId,
              positionMs: peer.positionMs,
              positionSec: peer.positionSec,
              timestampMs: Date.now(),
            },
          };
          sendFrame(topic, 'broadcast', ackPayload, null);
        }
      }
    });
  });

  function pushPresenceToAllClients(): void {
    const presencePayload = buildPresenceStatePayload();
    for (const client of activeWsClients) {
      try {
        client.ws.send(
          JSON.stringify({
            topic: client.topic,
            event: 'presence_state',
            payload: presencePayload,
            ref: null,
          })
        );
      } catch {
        // Ignore closed socket
      }
    }
  }

  return {
    get requests() {
      return requests;
    },
    getRequests(pathnamePrefix?: string): CapturedRequest[] {
      if (!pathnamePrefix) return [...requests];
      return requests.filter(
        (r) =>
          r.pathname.startsWith(pathnamePrefix) ||
          r.url.includes(pathnamePrefix)
      );
    },
    getSearchQueries(): string[] {
      return requests
        .filter((r) => r.pathname.includes('/api/search'))
        .map((r) => r.searchParams['q'] ?? r.searchParams['query'] ?? '');
    },
    getRangeRequests(trackId?: string): CapturedRequest[] {
      return requests.filter((r) => {
        if (!r.pathname.includes('/api/stream/')) return false;
        if (!trackId) return true;
        return (
          r.pathname.includes(trackId) ||
          r.pathname.includes(resolveCanonicalTrackId(trackId))
        );
      });
    },
    getImportCalls(): CapturedRequest[] {
      return requests.filter(
        (r) =>
          r.pathname.includes('/api/import/spotify') ||
          r.pathname.includes('/api/playlist/')
      );
    },
    getLyricsCalls(): CapturedRequest[] {
      return requests.filter(
        (r) =>
          r.url.includes('lrclib.net/api/') ||
          r.pathname.includes('/api/lyrics/yt/')
      );
    },
    getRealtimeBroadcasts(): MockRealtimeBroadcastEvent[] {
      return [...realtimeBroadcasts];
    },
    setOffline(offline: boolean): void {
      state.offline = offline;
    },
    setOptions(patch: Partial<MockApiOptions>): void {
      if (patch.offline !== undefined) state.offline = patch.offline;
      if (patch.spotifyImportMode !== undefined) {
        state.spotifyImportMode = patch.spotifyImportMode;
      }
      if (patch.wavDurationSec !== undefined) {
        state.wavDurationSec = patch.wavDurationSec;
      }
      if (patch.streamFailFirstCount !== undefined) {
        state.streamFailFirstCount = patch.streamFailFirstCount;
        remainingStreamFails = patch.streamFailFirstCount;
      }
      if (patch.failRoutes) {
        state.failRoutes = { ...(state.failRoutes ?? {}), ...patch.failRoutes };
      }
      if (patch.failOnce) {
        state.failOnce = [...patch.failOnce];
        failOnceConsumed.clear();
      }
      if (patch.latencyMs) {
        state.latencyMs = { ...(state.latencyMs ?? {}), ...patch.latencyMs };
      }
      if (patch.supabaseMock) {
        state.supabaseMock = {
          ...(state.supabaseMock ?? {}),
          ...patch.supabaseMock,
        };
      }
    },
    setPeerDevices(peers: MockPeerDeviceState[]): void {
      state.supabaseMock = {
        ...(state.supabaseMock ?? {}),
        peers: [...peers],
      };
      pushPresenceToAllClients();
    },
    emitRealtimeBroadcast(
      event: string,
      payload: Record<string, unknown>
    ): void {
      for (const client of activeWsClients) {
        try {
          client.ws.send(
            JSON.stringify({
              topic: client.topic,
              event: 'broadcast',
              payload: {
                type: 'broadcast',
                event,
                payload: {
                  type: event,
                  ...payload,
                },
              },
              ref: null,
            })
          );
        } catch {
          // Ignore closed socket
        }
      }
    },
    clearLogs(): void {
      requests.length = 0;
      realtimeBroadcasts.length = 0;
    },
    async uninstall(): Promise<void> {
      await page.unrouteAll({ behavior: 'ignoreErrors' });
    },
  };
}
