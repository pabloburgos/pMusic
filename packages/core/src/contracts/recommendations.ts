import type { AlbumSummary, Track } from '../types/music.ts';
import type { SearchResultBundle, TopResultMatch } from './providers.ts';

export type ImplicitSignalType =
  | 'skip_early'
  | 'complete_listen'
  | 'repeat_loop'
  | 'like'
  | 'add_to_playlist'
  | 'unlike';

export interface SeedArtistConfig {
  /** Lowercase NFD-normalized key matching `normalizeArtistKey(displayName)` */
  artistKey: string;
  displayName: string;
  artistId?: string;
  /** Primary user seeds = +8.0, Spanish urban scene = +4.5 */
  priorWeight: number;
  genres: readonly string[];
}

export interface ArtistAffinityRecord {
  artistKey: string;
  artistName: string;
  artistId?: string;
  /** Clamped to [-20, +200] matching Supabase `artist_affinity.score` CHECK */
  score: number;
  genres: string[];
  playCount: number;
  skipCount: number;
  /** Mirrors `public.artist_affinity.is_seed` */
  isSeed?: boolean;
  /** ISO-8601 UTC timestamp */
  updatedAt: string;
}

export type HomeEditorialShelfKind =
  | 'listen_again'
  | 'mixes_for_you'
  | 'because_you_listened'
  | 'favorite_new_releases';

export interface HomeEditorialMix {
  id: string;
  /** e.g. 'Daily Mix 1' or 'Descubre lo Nuevo' */
  title: string;
  /** e.g. 'Cruzzi, La Pantera, Quevedo y escena urbana ES' */
  subtitle: string;
  badge?: string;
  coverUrl: string;
  accentColor: string;
  tracks: Track[];
}

export interface HomeEditorialShelf {
  id: string;
  kind: HomeEditorialShelfKind;
  /** Localized Spanish editorial title */
  title: string;
  subtitle?: string;
  anchorArtist?: string;
  tracks?: Track[];
  mixes?: HomeEditorialMix[];
  albums?: AlbumSummary[];
}

export type AutocompleteSuggestionKind = 'artist' | 'history' | 'suggestion';

export interface AutocompleteSuggestion {
  text: string;
  kind: AutocompleteSuggestionKind;
  boostScore: number;
}

export interface RecommendationSignalMeta {
  actualPlayedSec?: number;
  completionRatio?: number;
  nowMs?: number;
}

export interface RecommendationRerankOptions {
  query?: string;
  limit?: number;
  explorationRate?: number;
  maxPerArtistInWindow?: number;
  nowMs?: number;
}

export interface IRecommendationEngine {
  recordSignal(
    track: Track,
    signal: ImplicitSignalType,
    meta?: RecommendationSignalMeta
  ): Promise<void>;
  getEffectiveAffinity(artistName: string, nowMs?: number): number;
  rerankTracks(candidates: readonly Track[], opts?: RecommendationRerankOptions): Track[];
  rankAutocomplete(
    query: string,
    remoteSuggestions: readonly string[]
  ): AutocompleteSuggestion[];
  selectBestResult(query: string, bundle: SearchResultBundle): TopResultMatch | undefined;
  buildHomeShelves(signal?: AbortSignal): Promise<HomeEditorialShelf[]>;
  updateSeedArtists(seeds: SeedArtistConfig[]): Promise<void>;
  getSeedArtists?(): SeedArtistConfig[];
  getAffinityProfile?(): ArtistAffinityRecord[];
  resetTastes?(): Promise<void>;
}
