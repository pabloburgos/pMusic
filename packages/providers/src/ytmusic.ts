import type {
  AlbumDetail,
  ArtistDetail,
  AudioStreamQuality,
  HomeFeedResult,
  IMusicProvider,
  IPlatformBridge,
  PlaylistDetail,
  RelatedResult,
  SearchFilter,
  SearchResultBundle,
  StreamResolution,
  Track,
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
                  : [{ name: 'Artista Urbano' }];
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
          const fallback = searchFallbackCatalog(query, filter);
          return {
            ...fallback,
            query,
            songs,
            topResult: { kind: 'song', item: songs[0]! },
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

  public async getArtist(artistId: string, _signal?: AbortSignal): Promise<ArtistDetail> {
    if (this.catalog) {
      try {
        if (/^\d+$/.test(artistId)) {
          return await this.catalog.artist(artistId, _signal);
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
    videoId: string,
    _signal?: AbortSignal
  ): Promise<string | null> {
    const track = FALLBACK_TRACKS.find((t) => t.id === videoId) ?? FALLBACK_TRACKS[0]!;
    return [
      `${track.title} — ${track.artists.map((a) => a.name).join(', ')}`,
      'Subiendo desde las islas hasta Madrid',
      'La noche brilla en el estudio sin parar',
      'Este ritmo suena limpio en pMusic',
      'Toda la calle cantando el estribillo',
    ].join('\n');
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

  public constructor(options: HttpProxyMusicProviderOptions = {}) {
    this.platformBridge = options.platformBridge;
    this.fetchFn = options.fetchFn ?? globalThis.fetch.bind(globalThis);
    this.baseUrl = (options.baseUrl ?? '').replace(/\/+$/, '');
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
    const params = new URLSearchParams({ q: query, filter });
    const remote = await this.fetchApiJson<SearchResultBundle>(`/api/search?${params.toString()}`, signal);
    if (remote && Array.isArray(remote.songs)) {
      return remote;
    }
    return searchFallbackCatalog(query, filter);
  }

  public async getSearchSuggestions(input: string, signal?: AbortSignal): Promise<string[]> {
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
    const query = moodFilter ? `?mood=${encodeURIComponent(moodFilter)}` : '';
    const remote = await this.fetchApiJson<HomeFeedResult>(`/api/home${query}`, signal);
    if (remote && Array.isArray(remote.shelves)) {
      return remote;
    }
    return getFallbackHomeFeed();
  }

  public async getUpNext(videoId: string, _automix = true, signal?: AbortSignal): Promise<Track[]> {
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
    const remote = await this.fetchApiJson<RelatedResult>(
      `/api/related/${encodeURIComponent(videoId)}`,
      signal
    );
    if (remote && Array.isArray(remote.tracks)) {
      return remote;
    }
    return getFallbackRelated(videoId);
  }

  public async getArtist(artistId: string, signal?: AbortSignal): Promise<ArtistDetail> {
    const remote = await this.fetchApiJson<ArtistDetail>(
      `/api/artist/${encodeURIComponent(artistId)}`,
      signal
    );
    if (remote && remote.artist) {
      return remote;
    }
    return getFallbackArtistDetail(artistId);
  }

  public async getTrack(trackId: string, signal?: AbortSignal): Promise<Track | null> {
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
