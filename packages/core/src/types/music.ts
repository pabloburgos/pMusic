export type PlatformRuntime = 'electron' | 'android' | 'web';

export type TrackSource = 'ytmusic' | 'youtube' | 'offline';

export interface ArtistRef {
  /** YTMusic channel/browseId (UC...) when available */
  id?: string;
  name: string;
}

export interface AlbumRef {
  /** YTMusic album browseId (MPR...) when available */
  id?: string;
  name: string;
}

export interface Track {
  /** Canonical YouTube videoId (typically 11-char) */
  id: string;
  title: string;
  artists: ArtistRef[];
  album?: AlbumRef;
  durationSec: number;
  thumbnailUrl: string;
  thumbnailHighUrl?: string;
  isExplicit?: boolean;
  source: TrackSource;
  releaseYear?: number;
  /** Optional metadata for DJ / Recommendation engines */
  genres?: string[];
}

export interface ArtistSummary {
  /** YTMusic artist channel/browseId (UC...) */
  id: string;
  name: string;
  thumbnailUrl: string;
  subscribersText?: string;
}

export interface AlbumSummary {
  /** YTMusic album browseId (MPR...) */
  id: string;
  title: string;
  artists: ArtistRef[];
  year?: number;
  thumbnailUrl: string;
}

/** Exact match to PostgreSQL `public.playlists.source` CHECK constraint */
export type PlaylistRecordSource =
  | 'local'
  | 'imported_spotify'
  | 'imported_youtube'
  | 'mix';

export type PlaylistSummarySource = PlaylistRecordSource | 'ytmusic' | 'supabase';

export interface PlaylistSummary {
  /** External playlist ID without leading VL prefix; provider prefixes VL internally */
  id: string;
  title: string;
  author?: string;
  trackCount?: number;
  thumbnailUrl: string;
  source: PlaylistSummarySource;
}

/**
 * Reconciled local (IndexedDB) + remote (Supabase `playlists` + `playlist_tracks`) record.
 */
export interface PlaylistRecord {
  /** UUID */
  id: string;
  name: string;
  description: string;
  coverUrl?: string;
  source: PlaylistRecordSource;
  sourceUrl?: string;
  tracks: Track[];
  /** ISO-8601 UTC timestamp */
  createdAt: string;
  /** ISO-8601 UTC timestamp */
  updatedAt: string;
  /** Supabase `auth.users.id` when synced; omitted in local-only mode */
  userId?: string;
}

/**
 * Reconciled local + Supabase `liked_tracks` record.
 */
export interface LikedTrackRecord {
  trackId: string;
  track: Track;
  /** ISO-8601 UTC timestamp */
  likedAt: string;
  userId?: string;
}

export interface TrackCreditPerson {
  name: string;
  role: string;
  id?: string;
}

export interface TrackCredits {
  trackId: string;
  title: string;
  performers: TrackCreditPerson[];
  writers: string[];
  producers: string[];
  composers?: string[];
  lyricists?: string[];
  engineers?: string[];
  distributor?: string;
  label?: string;
  source?: string;
  albumTitle?: string;
  releaseDate?: string;
  isrc?: string;
  bpm?: number;
  explicit?: boolean;
  fetchedFrom: string;
}
