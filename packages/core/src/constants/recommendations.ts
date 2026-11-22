import type { ImplicitSignalType, SeedArtistConfig } from '../contracts/recommendations.ts';

export const SIGNAL_WEIGHTS: Readonly<Record<ImplicitSignalType, number>> = Object.freeze({
  skip_early: -1.0,
  complete_listen: 2.0,
  repeat_loop: 3.5,
  like: 5.0,
  add_to_playlist: 5.0,
  unlike: -3.5,
});

/** Half-life in days for lazy exponential decay: S(t) = S0 * 2^(-Δt / 14) */
export const AFFINITY_HALF_LIFE_DAYS = 14;
export const AFFINITY_MIN_SCORE = -20;
export const AFFINITY_MAX_SCORE = 200;
export const AFFINITY_SCORE_MIN = AFFINITY_MIN_SCORE;
export const AFFINITY_SCORE_MAX = AFFINITY_MAX_SCORE;

/**
 * Default Spanish urban cold-start seed prior:
 * - 3 primary user seeds (+8.0): Bad Bunny, La Pantera, Cruz Cafuné
 * - 11 Spanish urban scene artists (+4.5)
 */
export const DEFAULT_SPANISH_URBAN_SEEDS: readonly SeedArtistConfig[] = Object.freeze([
  Object.freeze({
    artistKey: 'bad bunny',
    displayName: 'Bad Bunny',
    priorWeight: 8.0,
    genres: Object.freeze(['urbano', 'reggaeton', 'latin trap']),
  }),
  Object.freeze({
    artistKey: 'la pantera',
    displayName: 'La Pantera',
    priorWeight: 8.0,
    genres: Object.freeze(['urbano es', 'trap es', 'canarias']),
  }),
  Object.freeze({
    artistKey: 'cruz cafune',
    displayName: 'Cruz Cafuné',
    priorWeight: 8.0,
    genres: Object.freeze(['urbano es', 'rap es', 'canarias']),
  }),
  Object.freeze({
    artistKey: 'quevedo',
    displayName: 'Quevedo',
    priorWeight: 4.5,
    genres: Object.freeze(['urbano es', 'reggaeton', 'canarias']),
  }),
  Object.freeze({
    artistKey: 'saiko',
    displayName: 'Saiko',
    priorWeight: 4.5,
    genres: Object.freeze(['urbano es', 'reggaeton']),
  }),
  Object.freeze({
    artistKey: 'mora',
    displayName: 'Mora',
    priorWeight: 4.5,
    genres: Object.freeze(['urbano', 'reggaeton']),
  }),
  Object.freeze({
    artistKey: 'rels b',
    displayName: 'Rels B',
    priorWeight: 4.5,
    genres: Object.freeze(['urbano es', 'r&b es']),
  }),
  Object.freeze({
    artistKey: 'feid',
    displayName: 'Feid',
    priorWeight: 4.5,
    genres: Object.freeze(['urbano', 'reggaeton']),
  }),
  Object.freeze({
    artistKey: 'dellafuente',
    displayName: 'Dellafuente',
    priorWeight: 4.5,
    genres: Object.freeze(['urbano es', 'flamenco urbano']),
  }),
  Object.freeze({
    artistKey: 'eladio carrion',
    displayName: 'Eladio Carrión',
    priorWeight: 4.5,
    genres: Object.freeze(['latin trap', 'urbano']),
  }),
  Object.freeze({
    artistKey: 'myke towers',
    displayName: 'Myke Towers',
    priorWeight: 4.5,
    genres: Object.freeze(['urbano', 'reggaeton']),
  }),
  Object.freeze({
    artistKey: 'jc reyes',
    displayName: 'JC Reyes',
    priorWeight: 4.5,
    genres: Object.freeze(['urbano es', 'drill es']),
  }),
  Object.freeze({
    artistKey: 'morad',
    displayName: 'Morad',
    priorWeight: 4.5,
    genres: Object.freeze(['urbano es', 'drill es']),
  }),
  Object.freeze({
    artistKey: 'dei v',
    displayName: 'Dei V',
    priorWeight: 4.5,
    genres: Object.freeze(['urbano', 'latin trap']),
  }),
]);
