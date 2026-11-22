import type { Track } from '../types/music.ts';

export type ImportPlatform = 'spotify' | 'youtube';
export type ImportEntityKind = 'playlist' | 'album';

export interface ParsedPlaylistUrl {
  platform: ImportPlatform;
  kind: ImportEntityKind;
  id: string;
  canonicalUrl: string;
}

export interface ImportedSourceTrack {
  title: string;
  artists: string[];
  durationSec?: number;
  externalId?: string;
  thumbnailUrl?: string;
}

export type ImportMatchStatus = 'matched' | 'low_confidence' | 'unmatched';

export interface MatchedImportTrack {
  source: ImportedSourceTrack;
  match?: Track;
  /** Normalized similarity score in [0, 1] */
  confidence: number;
  status: ImportMatchStatus;
}

export type ImportProgressPhase =
  | 'resolving_url'
  | 'extracting_source'
  | 'matching_tracks'
  | 'done'
  | 'error';

export interface ImportProgressEvent {
  phase: ImportProgressPhase;
  completed: number;
  total: number;
  matchedCount: number;
  unmatchedCount: number;
  currentTrackTitle?: string;
}

export interface PlaylistImportResult {
  name: string;
  description?: string;
  author?: string;
  coverUrl?: string;
  sourcePlatform: ImportPlatform;
  sourceUrl: string;
  /** `true` when Spotify public embed hits its 100-track ceiling */
  truncated: boolean;
  warning?: string;
  items: MatchedImportTrack[];
}

export interface IPlaylistImporter {
  parseUrl(rawUrl: string): ParsedPlaylistUrl | null;
  importFromUrl(
    rawUrl: string,
    onProgress?: (event: ImportProgressEvent) => void,
    signal?: AbortSignal
  ): Promise<PlaylistImportResult>;
}
