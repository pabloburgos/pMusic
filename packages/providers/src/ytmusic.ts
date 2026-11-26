import type {
  AlbumDetail,
  ArtistDetail,
  AudioStreamQuality,
  ExternalReleaseCandidate,
  HomeFeedResult,
  IMusicProvider,
  IPlatformBridge,
  PlaylistDetail,
  RelatedResult,
  SearchFilter,
  SearchResultBundle,
  StreamResolution,
  Track,
  TrackCredits,
} from '@pmusic/core';
import {
  FALLBACK_TRACKS,
  getFallbackAlbumDetail,
  getFallbackArtistDetail,
  getFallbackHomeFeed,
  getFallbackPlaylistDetail,
  getFallbackRelated,
  searchFallbackCatalog,
} from './catalog-fallback.ts';
import { DeezerCatalog, isDeezerTrackId } from './deezer-catalog.ts';
import { fetchExternalReleaseRadar, getMostRecentFridayIso } from './release-radar.ts';

export interface YouTubeMusicProviderOptions {
  lang?: string;
  location?: string;
  enableLiveNetwork?: boolean;
  proxyBaseUrl?: string;
  catalog?: DeezerCatalog | null;
}

export class YouTubeMusicProvider implements IMusicProvider {
  private readonly lang: string;
  private readonly location: string;
  private readonly enableLiveNetwork: boolean;
  private readonly proxyBaseUrl: string;
  private innertubePromise: Promise<unknown> | null = null;
  private readonly catalog: DeezerCatalog | null;

  public constructor(options: YouTubeMusicProviderOptions = {}) {
    this.catalog =
      options.catalog !== undefined
        ? options.catalog
        : options.enableLiveNetwork
          ? new DeezerCatalog()
          : null;
    this.lang = options.lang ?? 'es';
    this.location = options.location ?? 'ES';
    this.enableLiveNetwork = options.enableLiveNetwork ?? false;
    this.proxyBaseUrl = (options.proxyBaseUrl ?? '').replace(/\/+$/, '');
  }

  private async getInnertube(): Promise<any | null> {
    if (!this.enableLiveNetwork) return null;
    if (!this.innertubePromise) {
      this.innertubePromise = (async () => {
        try {
          const ytMod: any = await import('youtubei.js');
          if (ytMod.Platform?.shim) {
            ytMod.Platform.shim.eval = async (data: { output: string }, env: Record<string, unknown>) => {
              const fn = new Function(...Object.keys(env), `${data.output}`);
              return fn(...Object.values(env));
            };
          }
          if (ytMod.Parser?.setParserErrorHandler) {
            ytMod.Parser.setParserErrorHandler(() => {});
          }
          const Innertube = ytMod.Innertube ?? ytMod.default;
          return await Innertube.create({
            lang: this.lang,
            location: this.location,
            retrieve_player: true,
          });
        } catch {
          return null;
        }
      })();
    }
    return this.innertubePromise;
  }

  public async search(
    query: string,
    filter: SearchFilter = 'all',
    _signal?: AbortSignal
  ): Promise<SearchResultBundle> {
    if (this.catalog) {
      try {
        const b = await this.catalog.search(query, filter, _signal);
        if (b.songs.length || b.artists.length || b.albums.length) return b;
      } catch {
        // fallback
      }
    }
    const yt = await this.getInnertube();
    if (yt) {
      try {
        const res = await yt.music.search(query, { type: filter === 'all' ? undefined : filter });
        const songs: Track[] = [];
        const sections = res?.contents ?? [];
        for (const sec of sections) {
          const items = sec?.contents ?? [];
          for (const item of items) {
            const id = item?.id ?? item?.video_id;
            const title = item?.title ?? item?.name;
            if (typeof id === 'string' && typeof title === 'string') {
              const rawArtists = item?.artists ?? item?.authors ?? [];
              const artists =
                Array.isArray(rawArtists) && rawArtists.length > 0
                  ? rawArtists.map((a: any) => ({
                      id: a?.channel_id ?? a?.id,
                      name: String(a?.name ?? 'Artista'),
                    }))
                  : [{ name: 'Artista' }];
              songs.push({
                id,
                title,
                artists,
                durationSec: Number(item?.duration?.seconds ?? 195),
                thumbnailUrl:
                  item?.thumbnails?.[0]?.url ?? FALLBACK_TRACKS[0]!.thumbnailUrl,
                source: 'ytmusic',
              });
            }
          }
        }
        if (songs.length > 0) {
          return {
            query,
            topResult: { kind: 'song', item: songs[0]! },
            songs: filter === 'all' || filter === 'song' ? songs : [],
            videos: filter === 'all' || filter === 'video' ? songs.slice(0, 4) : [],
            artists: [],
            albums: [],
            playlists: [],
          };
        }
      } catch {
        // Fallback to curated Spanish urban catalog
      }
    }
    return searchFallbackCatalog(query, filter);
  }

  public async getSearchSuggestions(input: string, _signal?: AbortSignal): Promise<string[]> {
    const trimmed = input.trim();
    if (this.catalog && trimmed) {
      try {
        const s = await this.catalog.suggestions(trimmed, _signal);
        if (s.length) return s;
      } catch {
        // fallback
      }
    }
    if (!trimmed) {
      return [
        'Cruz Cafuné',
        'La Pantera',
        'Bad Bunny',
        'Quevedo',
        'Saiko',
        'Morad',
      ];
    }
    const bundle = searchFallbackCatalog(trimmed, 'all');
    const suggestions = new Set<string>();
    for (const artist of bundle.artists) {
      suggestions.add(artist.name);
    }
    for (const song of bundle.songs) {
      suggestions.add(`${song.title} - ${song.artists[0]?.name ?? ''}`.trim());
      suggestions.add(song.title);
    }
    return Array.from(suggestions).slice(0, 8);
  }

  public async getHomeFeed(_moodFilter?: string, _signal?: AbortSignal): Promise<HomeFeedResult> {
    if (this.catalog) {
      try {
        return await this.catalog.home(_signal);
      } catch {
        // fallback
      }
    }
    return getFallbackHomeFeed();
  }

  public async getUpNext(
    videoId: string,
    _automix = true,
    _signal?: AbortSignal
  ): Promise<Track[]> {
    if (this.catalog && isDeezerTrackId(videoId)) {
      try {
        return (await this.catalog.related(videoId, _signal)).tracks;
      } catch {
        // fallback
      }
    }
    const currentIdx = FALLBACK_TRACKS.findIndex((t) => t.id === videoId);
    if (currentIdx === -1) return [...FALLBACK_TRACKS];
    return [
      ...FALLBACK_TRACKS.slice(currentIdx + 1),
      ...FALLBACK_TRACKS.slice(0, currentIdx + 1),
    ];
  }

  public async getRelated(videoId: string, _signal?: AbortSignal): Promise<RelatedResult> {
    if (this.catalog && isDeezerTrackId(videoId)) {
      try {
        return await this.catalog.related(videoId, _signal);
      } catch {
        // fallback
      }
    }
    return getFallbackRelated(videoId);
  }

  public async getArtist(
    artistId: string,
    _signal?: AbortSignal,
    hint?: { name?: string }
  ): Promise<ArtistDetail> {
    if (this.catalog) {
      try {
        if (/^\d+$/.test(artistId)) {
          return await this.catalog.artist(artistId, _signal, hint?.name);
        }
        const lookupName = artistId.startsWith('UC_')
          ? artistId.slice(3).replace(/_/g, ' ')
          : artistId;
        if (lookupName.trim()) {
          return await this.catalog.artistByName(lookupName, _signal);
        }
      } catch {
        // fallback
      }
    }
    return getFallbackArtistDetail(artistId);
  }

  public async getAlbum(
    albumId: string,
    _signal?: AbortSignal,
    hint?: { title?: string; artist?: string }
  ): Promise<AlbumDetail> {
    const cleanId = albumId.replace(/^(dz-album-|dz:)/, '');
    if (this.catalog && /^\d+$/.test(cleanId)) {
      try {
        return await this.catalog.album(cleanId, _signal);
      } catch {
        // fallback
      }
    }
    const fallback = getFallbackAlbumDetail(albumId);
    const titleQuery = hint?.title?.trim() || fallback.album.title;
    const artistQuery = hint?.artist?.trim() || fallback.album.artists[0]?.name;
    if (this.catalog && titleQuery) {
      try {
        const resolved = await this.catalog.albumByQuery(titleQuery, artistQuery, _signal);
        if (resolved && resolved.tracks.length > 0) {
          return resolved;
        }
      } catch {
        // fallback
      }
    }
    return fallback;
  }

  public async getTrack(trackId: string, _signal?: AbortSignal): Promise<Track | null> {
    if (this.catalog && isDeezerTrackId(trackId)) {
      return this.catalog.getTrack(trackId, _signal);
    }
    return FALLBACK_TRACKS.find((t) => t.id === trackId) ?? null;
  }

  public async getPlaylist(
    playlistId: string,
    maxItems = 100,
    _signal?: AbortSignal
  ): Promise<PlaylistDetail> {
    if (this.catalog && /^\d+$/.test(playlistId.replace(/^VL/, ''))) {
      try {
        return await this.catalog.playlist(playlistId, maxItems, _signal);
      } catch {
        // fallback
      }
    }
    const detail = getFallbackPlaylistDetail(playlistId);
    return {
      playlist: detail.playlist,
      tracks: detail.tracks.slice(0, maxItems),
    };
  }

  public async getPlainLyricsFallback(
    _videoId: string,
    _signal?: AbortSignal
  ): Promise<string | null> {
    return null;
  }

  public async getTrackCredits(
    trackId: string,
    hint?: { title?: string; artist?: string },
    signal?: AbortSignal
  ): Promise<TrackCredits | null> {
    if (this.catalog) {
      try {
        return await this.catalog.trackCredits(trackId, hint, signal);
      } catch {
        // ignore network error
      }
    }
    return null;
  }

  public async getReleaseRadar(signal?: AbortSignal): Promise<ExternalReleaseCandidate[]> {
    if (!this.enableLiveNetwork) return [];
    try {
      return await fetchExternalReleaseRadar({ signal });
    } catch {
      return [];
    }
  }

  public async resolveAudioStream(
    videoId: string,
    quality: AudioStreamQuality = 'high',
    _signal?: AbortSignal
  ): Promise<StreamResolution> {
    const track = FALLBACK_TRACKS.find((t) => t.id === videoId);
    const bitrate = quality === 'high' ? 160_000 : quality === 'medium' ? 128_000 : 64_000;
    return {
      trackId: videoId,
      proxyUrl: `${this.proxyBaseUrl}/api/stream/${encodeURIComponent(videoId)}?quality=${quality}`,
      mimeType: 'audio/wav',
      bitrate,
      durationSec: track?.durationSec ?? 195,
      loudnessDb: -1.5,
      expiresAtMs: Date.now() + 6 * 3600_000,
      strategy: 'direct_adaptive',
    };
  }
}

export interface HttpProxyMusicProviderOptions {
  platformBridge?: Pick<IPlatformBridge, 'getApiBaseUrl' | 'getAuthHeaders' | 'buildStreamUrl'>;
  fetchFn?: typeof fetch;
  baseUrl?: string;
}

export class HttpProxyMusicProvider implements IMusicProvider {
  private readonly platformBridge?: Pick<
    IPlatformBridge,
    'getApiBaseUrl' | 'getAuthHeaders' | 'buildStreamUrl'
  >;
  private readonly fetchFn: typeof fetch;
  private readonly baseUrl: string;
  private mobileProxyCatalog: YouTubeMusicProvider | null = null;

  public constructor(options: HttpProxyMusicProviderOptions = {}) {
    this.platformBridge = options.platformBridge;
    this.fetchFn = options.fetchFn ?? globalThis.fetch.bind(globalThis);
    this.baseUrl = (options.baseUrl ?? '').replace(/\/+$/, '');
  }

  private getMobileDirectProvider(): YouTubeMusicProvider | null {
    if (
      typeof window !== 'undefined' &&
      window.location?.hostname === 'appassets.pmusic.local'
    ) {
      if (!this.mobileProxyCatalog) {
        const proxyFetch = ((input: RequestInfo | URL, init?: RequestInit) => {
          const rawUrl = String(input);
          if (rawUrl.startsWith('https://api.deezer.com')) {
            const dzPath = rawUrl.slice('https://api.deezer.com'.length) || '/';
            return this.fetchFn(
              `https://appassets.pmusic.local/api/dz-proxy?path=${encodeURIComponent(dzPath)}`,
              init
            );
          }
          if (rawUrl.startsWith('https://music.youtube.com/youtubei/v1/')) {
            const ep =
              rawUrl
                .slice('https://music.youtube.com/youtubei/v1/'.length)
                .split('?')[0] ?? '';
            const bodyStr = typeof init?.body === 'string' ? init.body : '';
            return this.fetchFn(
              `https://appassets.pmusic.local/api/ytm-proxy?ep=${encodeURIComponent(ep)}&body=${encodeURIComponent(bodyStr)}`,
              { method: 'GET', signal: init?.signal }
            );
          }
          if (rawUrl.startsWith('https://www.youtube.com/youtubei/v1/player')) {
            const bodyStr = typeof init?.body === 'string' ? init.body : '';
            return this.fetchFn(
              `https://appassets.pmusic.local/api/ytm-proxy?ep=player&body=${encodeURIComponent(bodyStr)}`,
              { method: 'GET', signal: init?.signal }
            );
          }
          return this.fetchFn(input, init);
        }) as typeof fetch;
        this.mobileProxyCatalog = new YouTubeMusicProvider({
          catalog: new DeezerCatalog(proxyFetch),
        });
      }
      return this.mobileProxyCatalog;
    }
    return null;
  }

  private async resolveEndpoint(path: string): Promise<{ url: string; headers: Record<string, string> }> {
    const base = this.platformBridge ? await this.platformBridge.getApiBaseUrl() : this.baseUrl;
    const authHeaders = this.platformBridge ? await this.platformBridge.getAuthHeaders() : {};
    const cleanBase = base.replace(/\/+$/, '');
    return {
      url: `${cleanBase}${path}`,
      headers: {
        Accept: 'application/json',
        ...authHeaders,
      },
    };
  }

  private async fetchApiJson<T>(path: string, signal?: AbortSignal): Promise<T | null> {
    try {
      const { url, headers } = await this.resolveEndpoint(path);
      const res = await this.fetchFn(url, { method: 'GET', headers, signal });
      if (!res.ok) return null;
      return (await res.json()) as T;
    } catch {
      return null;
    }
  }

  public async search(
    query: string,
    filter: SearchFilter = 'all',
    signal?: AbortSignal
  ): Promise<SearchResultBundle> {
    const mobileDirect = this.getMobileDirectProvider();
    if (mobileDirect) {
      return mobileDirect.search(query, filter, signal);
    }
    const params = new URLSearchParams({ q: query, filter });
    const remote = await this.fetchApiJson<SearchResultBundle>(`/api/search?${params.toString()}`, signal);
    if (remote && Array.isArray(remote.songs)) {
      return remote;
    }
    return searchFallbackCatalog(query, filter);
  }

  public async getSearchSuggestions(input: string, signal?: AbortSignal): Promise<string[]> {
    const mobileDirect = this.getMobileDirectProvider();
    if (mobileDirect) {
      return mobileDirect.getSearchSuggestions(input, signal);
    }
    const params = new URLSearchParams({ q: input });
    const remote = await this.fetchApiJson<{ suggestions: string[] }>(
      `/api/suggestions?${params.toString()}`,
      signal
    );
    if (remote && Array.isArray(remote.suggestions)) {
      return remote.suggestions;
    }
    const fallback = new YouTubeMusicProvider();
    return fallback.getSearchSuggestions(input, signal);
  }

  public async getHomeFeed(moodFilter?: string, signal?: AbortSignal): Promise<HomeFeedResult> {
    const mobileDirect = this.getMobileDirectProvider();
    if (mobileDirect) {
      return mobileDirect.getHomeFeed(moodFilter, signal);
    }
    const query = moodFilter ? `?mood=${encodeURIComponent(moodFilter)}` : '';
    const remote = await this.fetchApiJson<HomeFeedResult>(`/api/home${query}`, signal);
    if (remote && Array.isArray(remote.shelves)) {
      return remote;
    }
    return getFallbackHomeFeed();
  }

  public async getUpNext(videoId: string, _automix = true, signal?: AbortSignal): Promise<Track[]> {
    const mobileDirect = this.getMobileDirectProvider();
    if (mobileDirect) {
      return mobileDirect.getUpNext(videoId, _automix, signal);
    }
    const remote = await this.fetchApiJson<{ tracks: Track[] }>(
      `/api/up-next/${encodeURIComponent(videoId)}`,
      signal
    );
    if (remote && Array.isArray(remote.tracks)) {
      return remote.tracks;
    }
    return FALLBACK_TRACKS.filter((t) => t.id !== videoId);
  }

  public async getRelated(videoId: string, signal?: AbortSignal): Promise<RelatedResult> {
    const mobileDirect = this.getMobileDirectProvider();
    if (mobileDirect) {
      return mobileDirect.getRelated(videoId, signal);
    }
    const remote = await this.fetchApiJson<RelatedResult>(
      `/api/related/${encodeURIComponent(videoId)}`,
      signal
    );
    if (remote && Array.isArray(remote.tracks)) {
      return remote;
    }
    return getFallbackRelated(videoId);
  }

  public async getArtist(
    artistId: string,
    signal?: AbortSignal,
    hint?: { name?: string }
  ): Promise<ArtistDetail> {
    const mobileDirect = this.getMobileDirectProvider();
    if (mobileDirect) {
      return mobileDirect.getArtist(artistId, signal, hint);
    }
    const qs = hint?.name?.trim() ? `?name=${encodeURIComponent(hint.name.trim())}` : '';
    let remote = await this.fetchApiJson<ArtistDetail>(
      `/api/artist/${encodeURIComponent(artistId)}${qs}`,
      signal
    );
    if ((!remote || !remote.artist) && !signal?.aborted) {
      await new Promise((resolve) => setTimeout(resolve, 300));
      if (!signal?.aborted) {
        remote = await this.fetchApiJson<ArtistDetail>(
          `/api/artist/${encodeURIComponent(artistId)}${qs}`,
          signal
        );
      }
    }
    if (remote && remote.artist) {
      return remote;
    }
    return getFallbackArtistDetail(artistId);
  }

  public async getTrack(trackId: string, signal?: AbortSignal): Promise<Track | null> {
    const mobileDirect = this.getMobileDirectProvider();
    if (mobileDirect) {
      return mobileDirect.getTrack ? mobileDirect.getTrack(trackId, signal) : null;
    }
    const remote = await this.fetchApiJson<Track>(
      `/api/track/${encodeURIComponent(trackId)}`,
      signal
    );
    return remote && remote.id ? remote : null;
  }

  public async getAlbum(
    albumId: string,
    signal?: AbortSignal,
    hint?: { title?: string; artist?: string }
  ): Promise<AlbumDetail> {
    const mobileDirect = this.getMobileDirectProvider();
    if (mobileDirect) {
      return mobileDirect.getAlbum(albumId, signal, hint);
    }
    const params = new URLSearchParams();
    if (hint?.title?.trim()) params.set('title', hint.title.trim());
    if (hint?.artist?.trim()) params.set('artist', hint.artist.trim());
    const qs = params.toString() ? `?${params.toString()}` : '';
    const remote = await this.fetchApiJson<AlbumDetail>(
      `/api/album/${encodeURIComponent(albumId)}${qs}`,
      signal
    );
    if (remote && remote.album) {
      return remote;
    }
    return getFallbackAlbumDetail(albumId);
  }

  public async getPlaylist(
    playlistId: string,
    _maxItems = 100,
    signal?: AbortSignal
  ): Promise<PlaylistDetail> {
    const mobileDirect = this.getMobileDirectProvider();
    if (mobileDirect) {
      return mobileDirect.getPlaylist(playlistId, _maxItems, signal);
    }
    const remote = await this.fetchApiJson<PlaylistDetail>(
      `/api/playlist/${encodeURIComponent(playlistId)}`,
      signal
    );
    if (remote && remote.playlist) {
      return remote;
    }
    return getFallbackPlaylistDetail(playlistId);
  }

  public async getMusixmatchLyrics(
    title: string,
    artist: string,
    durationSec?: number,
    signal?: AbortSignal
  ): Promise<{ syncedLyrics?: string | null; plainLyrics?: string | null } | null> {
    const params = new URLSearchParams({ title, artist });
    if (durationSec && Number.isFinite(durationSec) && durationSec > 0) {
      params.set('duration', String(Math.round(durationSec)));
    }
    if (this.getMobileDirectProvider()) {
      const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = ctrl ? setTimeout(() => ctrl.abort(), 5000) : null;
      const onOuter = () => ctrl?.abort();
      signal?.addEventListener('abort', onOuter, { once: true });
      try {
        const res = await this.fetchFn(
          `https://pmusic-olive.vercel.app/api/lyrics?${params.toString()}`,
          { signal: ctrl?.signal ?? signal }
        );
        if (res.ok) {
          return (await res.json()) as {
            syncedLyrics?: string | null;
            plainLyrics?: string | null;
          };
        }
      } catch {
        // ignore network error and allow remaining fallbacks
      } finally {
        if (timer) clearTimeout(timer);
        signal?.removeEventListener('abort', onOuter);
      }
      return null;
    }
    return this.fetchApiJson<{ syncedLyrics?: string | null; plainLyrics?: string | null }>(
      `/api/lyrics/musixmatch?${params.toString()}`,
      signal
    );
  }

  public async getPlainLyricsFallback(videoId: string, signal?: AbortSignal): Promise<string | null> {
    const remote = await this.fetchApiJson<{ plainLyrics?: string | null; lyrics?: string | null }>(
      `/api/lyrics/yt/${encodeURIComponent(videoId)}`,
      signal
    );
    if (remote) {
      return remote.plainLyrics ?? remote.lyrics ?? null;
    }
    return null;
  }

  public async getTrackCredits(
    trackId: string,
    hint?: { title?: string; artist?: string },
    signal?: AbortSignal
  ): Promise<TrackCredits | null> {
    const mobileDirect = this.getMobileDirectProvider();
    if (mobileDirect) {
      return mobileDirect.getTrackCredits(trackId, hint, signal);
    }
    const params = new URLSearchParams();
    if (hint?.title?.trim()) params.set('title', hint.title.trim());
    if (hint?.artist?.trim()) params.set('artist', hint.artist.trim());
    const qs = params.toString() ? `?${params.toString()}` : '';
    const remote = await this.fetchApiJson<{ credits?: TrackCredits | null }>(
      `/api/credits/${encodeURIComponent(trackId)}${qs}`,
      signal
    );
    return remote?.credits ?? null;
  }

  public async getReleaseRadar(signal?: AbortSignal): Promise<ExternalReleaseCandidate[]> {
    const mobileDirect = this.getMobileDirectProvider();
    if (mobileDirect) {
      // 1. Fast Vercel Release Radar endpoint FIRST (returns 150+ pre-built playable tracks in 1 request across all APK versions)
      try {
        const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timer = ctrl ? setTimeout(() => ctrl.abort(), 10000) : null;
        const onOuter = () => ctrl?.abort();
        signal?.addEventListener('abort', onOuter, { once: true });
        try {
          const vRes = await this.fetchFn('https://pmusic-olive.vercel.app/api/release-radar', {
            signal: ctrl?.signal ?? signal,
          });
          if (vRes.ok) {
            const vData = (await vRes.json()) as { releases?: ExternalReleaseCandidate[] };
            if (Array.isArray(vData?.releases) && vData.releases.length > 0) {
              return vData.releases;
            }
          }
        } finally {
          if (timer) clearTimeout(timer);
          signal?.removeEventListener('abort', onOuter);
        }
      } catch {
        // Fall through to native /api/radar-proxy and Deezer proxy below
      }

      // 2. Native /api/radar-proxy fallback
      const origin =
        typeof window !== 'undefined' && window.location?.origin
          ? window.location.origin
          : 'https://appassets.pmusic.local';
      const proxyFetch: typeof fetch = (input, init) => {
        const target = String(input);
        if (
          target.startsWith('https://open.spotify.com/embed/playlist/') ||
          target.startsWith('https://www.lahiguera.net/musicalia/')
        ) {
          return this.fetchFn(
            `${origin}/api/radar-proxy?url=${encodeURIComponent(target)}`,
            init
          );
        }
        return this.fetchFn(input, init);
      };
      try {
        const directItems = await fetchExternalReleaseRadar({ fetchFn: proxyFetch, signal });
        if (directItems.length > 0) return directItems;
      } catch {
        // Cascade to Deezer editorial playlists via /api/dz-proxy below
      }

      // 3. Resilient Android fallback via /api/dz-proxy editorial playlists with full playable tracks
      try {
        const fridayIso = getMostRecentFridayIso();
        const searchPl = await this.fetchApiJson<{ data?: Array<{ id?: number | string }> }>(
          `/api/dz-proxy?path=${encodeURIComponent('/search/playlist?q=Novedades+Viernes+Espa%C3%B1a&limit=3')}`,
          signal
        );
        const playlistIds = [
          ...(Array.isArray(searchPl?.data)
            ? searchPl.data.map((p) => String(p?.id ?? '')).filter(Boolean).slice(0, 2)
            : []),
          '1282495565',
        ];
        const uniqueIds = Array.from(new Set(playlistIds));
        const plResults = await Promise.allSettled(
          uniqueIds.map((id) =>
            this.fetchApiJson<{
              data?: Array<{
                id?: number | string;
                title?: string;
                title_short?: string;
                duration?: number;
                explicit_lyrics?: boolean;
                artist?: { id?: number | string; name?: string };
                album?: {
                  id?: number | string;
                  title?: string;
                  cover?: string;
                  cover_medium?: string;
                  cover_big?: string;
                };
                release_date?: string;
              }>;
            }>(`/api/dz-proxy?path=${encodeURIComponent(`/playlist/${id}/tracks?limit=60`)}`, signal)
          )
        );
        const out: ExternalReleaseCandidate[] = [];
        const seen = new Set<string>();
        for (const r of plResults) {
          if (r.status !== 'fulfilled' || !Array.isArray(r.value?.data)) continue;
          for (const t of r.value.data) {
            const title = String(t?.title ?? t?.title_short ?? '').trim();
            const artist = String(t?.artist?.name ?? '').trim();
            if (!title || !artist) continue;
            const k = `${title.toLowerCase()}::${artist.toLowerCase()}`;
            if (seen.has(k)) continue;
            seen.add(k);
            const relDate =
              typeof t.release_date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(t.release_date)
                ? t.release_date.slice(0, 10)
                : fridayIso;
            const dzId = String(t?.id ?? '').trim();
            const coverMed = t.album?.cover_medium ?? t.album?.cover ?? '';
            const coverHigh = t.album?.cover_big ?? coverMed;
            out.push({
              title,
              artists: [artist],
              releaseDate: relDate,
              kind: 'track',
              source: 'deezer_novedades_es',
              priority: 92,
              ...(coverMed ? { thumbnailUrl: coverMed } : {}),
              ...(dzId
                ? {
                    track: {
                      id: `dz_${dzId}`,
                      title,
                      artists: [
                        { id: t.artist?.id ? `dz_ar_${t.artist.id}` : undefined, name: artist },
                      ],
                      ...(t.album?.title
                        ? {
                            album: {
                              id: t.album.id ? `dz_al_${t.album.id}` : undefined,
                              name: t.album.title,
                            },
                          }
                        : {}),
                      durationSec:
                        typeof t.duration === 'number' && t.duration > 0
                          ? Math.round(t.duration)
                          : 180,
                      thumbnailUrl: coverMed,
                      ...(coverHigh ? { thumbnailHighUrl: coverHigh } : {}),
                      releaseYear: Number.parseInt(relDate.slice(0, 4), 10) || undefined,
                      releaseDate: relDate,
                      isExplicit: Boolean(t.explicit_lyrics),
                      source: 'ytmusic',
                    },
                  }
                : {}),
            });
          }
        }
        return out;
      } catch {
        return [];
      }
    }

    const remote = await this.fetchApiJson<{ releases?: ExternalReleaseCandidate[] }>(
      '/api/release-radar',
      signal
    );
    if (Array.isArray(remote?.releases) && remote.releases.length > 0) {
      return remote.releases;
    }

    // Backwards-compatible fallback for older desktop OTA hosts (e.g. Electron v0.23.3):
    // reuse existing /api/import/spotify endpoint for Novedades Viernes España & PEGAO.
    const fridayIso = getMostRecentFridayIso();
    const importTargets: Array<{
      url: string;
      source: 'spotify_novedades_es' | 'spotify_pegao';
      priority: number;
      releaseDate?: string;
    }> = [
      {
        url: 'https://open.spotify.com/playlist/37i9dQZF1DX6PYajiT4pAf',
        source: 'spotify_novedades_es',
        priority: 95,
        releaseDate: fridayIso,
      },
      {
        url: 'https://open.spotify.com/playlist/37i9dQZF1DX1HCSfq0nSal',
        source: 'spotify_pegao',
        priority: 85,
      },
    ];
    const settled = await Promise.allSettled(
      importTargets.map(async (target) => {
        const res = await this.fetchApiJson<{
          name?: string;
          tracks?: Array<{ title?: string; artists?: string[]; thumbnailUrl?: string }>;
        }>(`/api/import/spotify?url=${encodeURIComponent(target.url)}`, signal);
        if (!res || !Array.isArray(res.tracks) || res.name === 'Éxitos Urbano España (Spotify Import)') {
          return [] as ExternalReleaseCandidate[];
        }
        return res.tracks
          .filter((t) => Boolean(t?.title) && Array.isArray(t?.artists) && t.artists.length > 0)
          .map((t) => ({
            title: String(t.title),
            artists: t.artists!.map((a) => String(a)),
            ...(target.releaseDate ? { releaseDate: target.releaseDate } : {}),
            kind: 'track' as const,
            source: target.source,
            priority: target.priority,
            ...(t.thumbnailUrl ? { thumbnailUrl: t.thumbnailUrl } : {}),
          }));
      })
    );
    const out: ExternalReleaseCandidate[] = [];
    for (const r of settled) {
      if (r.status === 'fulfilled') out.push(...r.value);
    }
    return out;
  }

  public async resolveAudioStream(
    videoId: string,
    quality: AudioStreamQuality = 'high',
    _signal?: AbortSignal
  ): Promise<StreamResolution> {
    const proxyUrl = this.platformBridge
      ? await this.platformBridge.buildStreamUrl(videoId, quality)
      : `${this.baseUrl}/api/stream/${encodeURIComponent(videoId)}?quality=${quality}`;
    const track = FALLBACK_TRACKS.find((t) => t.id === videoId);
    return {
      trackId: videoId,
      proxyUrl,
      mimeType: 'audio/wav',
      bitrate: quality === 'high' ? 160_000 : 128_000,
      durationSec: track?.durationSec ?? 195,
      expiresAtMs: Date.now() + 3600_000,
      strategy: 'direct_adaptive',
    };
  }
}
