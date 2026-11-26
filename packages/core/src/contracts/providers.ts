import type {
  AlbumSummary,
  ArtistSummary,
  PlaylistSummary,
  Track,
  TrackCredits,
} from '../types/music.ts';
import type { AudioStreamQuality } from '../types/platform.ts';

export type SearchFilter = 'all' | 'song' | 'video' | 'artist' | 'album' | 'playlist';

/** Discriminated union enabling strict narrowing on `topResult.kind` */
export type TopResultMatch =
  | { kind: 'artist'; item: ArtistSummary }
  | { kind: 'song'; item: Track }
  | { kind: 'album'; item: AlbumSummary }
  | { kind: 'playlist'; item: PlaylistSummary };

export interface SearchResultBundle {
  query: string;
  topResult?: TopResultMatch;
  songs: Track[];
  videos: Track[];
  artists: ArtistSummary[];
  albums: AlbumSummary[];
  playlists: PlaylistSummary[];
  continuationToken?: string;
}

export type StreamStrategy = 'offline' | 'direct_adaptive' | 'sabr' | 'hls_fallback';

export interface StreamResolution {
  trackId: string;
  /** Always CORS-safe for Web Audio API (`Access-Control-Allow-Origin: *` or same-origin offline URI) */
  proxyUrl: string;
  mimeType: string;
  bitrate: number;
  durationSec: number;
  loudnessDb?: number;
  expiresAtMs: number;
  strategy: StreamStrategy;
}

export type HomeFeedItem = Track | AlbumSummary | PlaylistSummary | ArtistSummary;

export interface HomeFeedShelf {
  title: string;
  items: HomeFeedItem[];
}

export interface HomeFeedResult {
  shelves: HomeFeedShelf[];
  moods: string[];
}

export interface RelatedResult {
  tracks: Track[];
  artists: ArtistSummary[];
  playlists: PlaylistSummary[];
}

export interface ArtistDetail {
  artist: ArtistSummary;
  bannerUrl?: string;
  description?: string;
  topSongs: Track[];
  appearances?: Track[];
  albums: AlbumSummary[];
  singles: AlbumSummary[];
  relatedArtists: ArtistSummary[];
}

export interface AlbumDetail {
  album: AlbumSummary;
  tracks: Track[];
}

export interface PlaylistDetail {
  playlist: PlaylistSummary;
  tracks: Track[];
}

export interface IMusicProvider {
  search(query: string, filter?: SearchFilter, signal?: AbortSignal): Promise<SearchResultBundle>;
  getSearchSuggestions(input: string, signal?: AbortSignal): Promise<string[]>;
  getHomeFeed(moodFilter?: string, signal?: AbortSignal): Promise<HomeFeedResult>;
  getUpNext(videoId: string, automix?: boolean, signal?: AbortSignal): Promise<Track[]>;
  getRelated(videoId: string, signal?: AbortSignal): Promise<RelatedResult>;
  getArtist(
    artistId: string,
    signal?: AbortSignal,
    hint?: { name?: string }
  ): Promise<ArtistDetail>;
  getAlbum(albumId: string, signal?: AbortSignal): Promise<AlbumDetail>;
  getPlaylist(playlistId: string, maxItems?: number, signal?: AbortSignal): Promise<PlaylistDetail>;
  getPlainLyricsFallback(videoId: string, signal?: AbortSignal): Promise<string | null>;
  getTrackCredits?(
    trackId: string,
    hint?: { title?: string; artist?: string },
    signal?: AbortSignal
  ): Promise<TrackCredits | null>;
  resolveAudioStream(
    videoId: string,
    quality?: AudioStreamQuality,
    signal?: AbortSignal
  ): Promise<StreamResolution>;
}
