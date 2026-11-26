import {
  AFFINITY_HALF_LIFE_DAYS,
  AFFINITY_SCORE_MAX,
  AFFINITY_SCORE_MIN,
  DEFAULT_SPANISH_URBAN_SEEDS,
  SIGNAL_WEIGHTS,
  clampAffinityScore,
  computeDecayedScore,
  normalizeArtistKey,
  normalizeSearchText,
  type AlbumSummary,
  type ArtistAffinityRecord,
  type ArtistSummary,
  type AutocompleteSuggestion,
  type ExternalReleaseCandidate,
  type FavoriteArtistRecord,
  type HomeEditorialMix,
  type HomeEditorialShelf,
  type IMusicProvider,
  type IRecommendationEngine,
  type ImplicitSignalType,
  type PlayHistoryRecord,
  type RecommendationRerankOptions,
  type RecommendationSignalMeta,
  type SearchResultBundle,
  type SeedArtistConfig,
  type TopResultMatch,
  type Track,
} from '@pmusic/core';

export interface RecommendationStorageAdapter {
  loadAffinities(): Promise<ArtistAffinityRecord[]>;
  saveAffinities(records: ArtistAffinityRecord[]): Promise<void>;
  loadHistory(): Promise<PlayHistoryRecord[]>;
  saveHistory(records: PlayHistoryRecord[]): Promise<void>;
  loadSeeds?(): Promise<SeedArtistConfig[] | null>;
  saveSeeds?(seeds: SeedArtistConfig[]): Promise<void>;
}

export interface RecommendationEngineOptions {
  musicProvider?: Pick<IMusicProvider, 'search' | 'getHomeFeed' | 'getUpNext' | 'getRelated'> &
    Partial<Pick<IMusicProvider, 'getArtist' | 'getAlbum' | 'getReleaseRadar'>>;
  storage?: RecommendationStorageAdapter;
  initialSeeds?: readonly SeedArtistConfig[];
  initialHistory?: readonly PlayHistoryRecord[];
  onAffinityUpdated?: (record: ArtistAffinityRecord) => void;
  onHistoryRecorded?: (record: PlayHistoryRecord) => void;
}

const MIX_PALETTES = [
  '#BF5AF2',
  '#0A84FF',
  '#30D158',
  '#FF9F0A',
  '#FF375F',
  '#5E5CE6',
] as const;

const SPANISH_ACCENT_RE = /[áéíóúüñ¿¡]/i;
const SPANISH_TITLE_WORDS = new Set([
  'de', 'del', 'la', 'las', 'el', 'los', 'en', 'con', 'por', 'para', 'que', 'te', 'me',
  'se', 'mi', 'tu', 'su', 'nos', 'yo', 'un', 'una', 'no', 'si', 'mas', 'como', 'cuando',
  'donde', 'noche', 'noches', 'amor', 'vida', 'dios', 'muevo', 'calle', 'corazon', 'fuego',
  'luna', 'sol', 'mar', 'besos', 'besame', 'ojos', 'boca', 'solo', 'sola', 'nada', 'todo',
  'siempre', 'nunca', 'ahora', 'manana', 'ayer', 'bueno', 'malo', 'diabla', 'normal',
  'invierno', 'contigo', 'sumisa', 'sordo', 'resaca', 'aire', 'cayetano', 'cangrinaje',
  'monaco', 'perro', 'negro', 'nuevayol', 'bala', 'lleve', 'volando', 'dime', 'quiero',
  'sabe', 'pasar', 'gente', 'mira', 'toma', 'dale', 'va', 'voy', 'soy', 'eres', 'pobre',
  'rico', 'oro', 'plata', 'cielo', 'infierno', 'alma', 'mente', 'cuerpo', 'lado', 'verano',
]);
const KNOWN_ES_SCENE_ARTISTS = new Set([
  'cruz cafune', 'la pantera', 'bad bunny', 'quevedo', 'saiko', 'morad', 'rels b',
  'dellafuente', 'feid', 'lucho rk', 'abhir hathi', 'bejo', 'juseph', 'd valentino',
  'dvalentino', 'mvrk', 'came beats', 'bluu', 'sneaky wh', 'beny jr', 'bb trickz',
  'rusowsky', 'judeline', 'ralphie choo', 'rvfv', 'omar montes', 'kidd keo', 'recycled j',
  'kable', 'pablete', 'gonzalo moreno', 'miky woodz', 'eladio carrion', 'myke towers',
  'rauw alejandro', 'rosalia', 'ctangana', 'c tangana', 'alizzz', 'natos y waor', 'ayax',
  'kaze', 'hard gz', 'delao', 'delaossa', 'hoke', 'ill pekeño', 'ill pequeno', 'ergo pro',
  'disobey', 'yung beef', 'sticky ma', 'rojuu', 'maikel delacalle',
  'anuel aa', 'jhayco', 'jhay cortez', 'nicki nicole', 'lia kali', 'la zowi', 'kapo',
  'dei v', 'gonzy', 'sech', 'bad gyal', 'omar courtz', 'jc reyes', 'mora', 'clarent',
  'ryan castro', 'j balvin', 'sfdk', 'nemzzz', 'alvaro diaz', 'tini', 'duki', 'ysy a',
  'emilia', 'young miko', 'bryant myers', 'ozuna', 'arcangel', 'el alfa', 'tokischa',
  'trueno', 'tiago pzk', 'lit killah', 'khea', 'bizarrap', 'tainy', 'kidd voodoo',
  'soge culebra', 'raul clyde', 'kristina', 'ptazeta', 'lola indigo', 'aitana',
  'sen senra', 'ca7riel', 'paco amoroso', 'milo j', 'blessd', 'karol g',
]);

function collapseNormalized(input: string): string {
  return normalizeSearchText(input).replace(/[^a-z0-9]+/g, '');
}

function hashString32(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  const arr = [...items];
  let state = hashString32(seed) || 1;
  for (let i = arr.length - 1; i > 0; i--) {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    const j = state % (i + 1);
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
  return arr;
}

export function getDailyMixDateKey(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Computes the weekly release-radar cycle key updating every Thursday at 12:00 local time.
 */
export function getThursdayNoonCycleKey(now: Date = new Date()): string {
  const cursor = new Date(now.getTime());
  const day = cursor.getDay(); // 0=Sun ... 4=Thu ... 6=Sat
  let daysSinceThu = (day - 4 + 7) % 7;
  if (daysSinceThu === 0 && cursor.getHours() < 12) {
    daysSinceThu = 7;
  }
  cursor.setDate(cursor.getDate() - daysSinceThu);
  cursor.setHours(12, 0, 0, 0);
  return `${getDailyMixDateKey(cursor)}-T12`;
}

const SPANISH_SHORT_MONTHS = [
  'ene',
  'feb',
  'mar',
  'abr',
  'may',
  'jun',
  'jul',
  'ago',
  'sep',
  'oct',
  'nov',
  'dic',
] as const;

export interface MondayWeekWindow {
  startIso: string;
  endIso: string;
  prevStartIso: string;
  prevEndIso: string;
  weekKey: string;
  rangeLabel: string;
}

/**
 * Computes the current Monday-to-Monday release window [startIso, endIso) in local time.
 */
export function getMondayWeekWindow(now: Date = new Date()): MondayWeekWindow {
  const daysSinceMonday = (now.getDay() + 6) % 7; // Mon=0, Tue=1 ... Sun=6
  const start = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - daysSinceMonday,
    0,
    0,
    0,
    0
  );
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7, 0, 0, 0, 0);
  const prevStart = new Date(start.getFullYear(), start.getMonth(), start.getDate() - 7, 0, 0, 0, 0);
  const startIso = getDailyMixDateKey(start);
  const endIso = getDailyMixDateKey(end);
  const prevStartIso = getDailyMixDateKey(prevStart);
  const rangeLabel = `${start.getDate()} ${SPANISH_SHORT_MONTHS[start.getMonth()]} – ${end.getDate()} ${SPANISH_SHORT_MONTHS[end.getMonth()]}`;
  return {
    startIso,
    endIso,
    prevStartIso,
    prevEndIso: startIso,
    weekKey: startIso,
    rangeLabel,
  };
}

export interface RollingDaysWindow {
  startIso: string;
  endIso: string;
  days: number;
  dayKey: string;
  rangeLabel: string;
}

/**
 * Returns a rolling [today - days, tomorrow) YYYY-MM-DD window inclusive of today,
 * updating daily so releases and collaborations within the last N days appear immediately.
 */
export function getRollingDaysWindow(
  now: Date = new Date(),
  days = 10
): RollingDaysWindow {
  const safeDays = Math.max(1, Math.round(days));
  const start = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - safeDays,
    0,
    0,
    0,
    0
  );
  const end = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1,
    0,
    0,
    0,
    0
  );
  const startIso = getDailyMixDateKey(start);
  const endIso = getDailyMixDateKey(end);
  const dayKey = getDailyMixDateKey(now);
  const rangeLabel = `${start.getDate()} ${SPANISH_SHORT_MONTHS[start.getMonth()]} – Hoy`;
  return {
    startIso,
    endIso,
    days: safeDays,
    dayKey,
    rangeLabel,
  };
}

/**
 * Strict check that a YYYY-MM-DD releaseDate lies inside [startIso, endIso).
 */
export function isReleaseDateInWindow(
  releaseDate: string | undefined,
  startIso: string,
  endIso: string
): boolean {
  if (!releaseDate || typeof releaseDate !== 'string') return false;
  const iso = releaseDate.trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  return iso >= startIso && iso < endIso;
}

function isSameArtistAlias(normA: string, normB: string): boolean {
  if (!normA || !normB) return false;
  if (normA === normB) return true;
  if (
    (normA === 'cruz cafune' || normA === 'cruzzi') &&
    (normB === 'cruz cafune' || normB === 'cruzzi')
  ) {
    return true;
  }
  return false;
}

const SYNTHETIC_TRACK_ID_SET = new Set([
  'cc_me_muevo_01',
  'cc_cangrinaje_02',
  'cc_dios_1_03',
  'lp_cayetano_04',
  'lp_una_bala_05',
  'bb_monaco_06',
  'bb_perro_negro_07',
  'qv_columbia_08',
  'sk_supernova_09',
  'mr_pelele_10',
  'df_consentia_11',
  'rb_a_mi_12',
]);

function isBrokenOrSyntheticTrack(t: Track | undefined | null): boolean {
  if (!t || !t.id || !t.title) return true;
  if (SYNTHETIC_TRACK_ID_SET.has(t.id)) return true;
  const thumb = t.thumbnailUrl ?? '';
  if (thumb.includes('unsplash.com')) return true;
  return false;
}

function scoreSpanishTitleCues(title: string): number {
  if (/[šŠčČžŽćĆđĐłŁøØß]/.test(title)) return 0;
  let score = 0;
  const hasEsAccent = SPANISH_ACCENT_RE.test(title);
  if (hasEsAccent) score += 28;
  const words = tokenizeNormalized(title);
  const hitWords = words.filter((w) => SPANISH_TITLE_WORDS.has(w));
  const hasLongEsWord = hitWords.some((w) => w.length >= 4);
  if (hasEsAccent || hasLongEsWord || hitWords.length >= 2) {
    score += Math.min(48, hitWords.length * 16);
  }
  return score;
}

function tokenizeNormalized(input: string): string[] {
  const clean = normalizeSearchText(input)
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return clean ? clean.split(' ') : [];
}

function scoreEntityQueryMatch(
  query: string,
  title: string,
  artists: readonly string[],
  albumName?: string
): number {
  const normQuery = normalizeSearchText(query).replace(/[^a-z0-9\s]+/g, ' ').replace(/\s+/g, ' ').trim();
  const collapsedQuery = collapseNormalized(query);
  const queryTokens = tokenizeNormalized(query);
  if (!normQuery || queryTokens.length === 0) return 0;

  const normTitle = normalizeSearchText(title).replace(/[^a-z0-9\s]+/g, ' ').replace(/\s+/g, ' ').trim();
  const titleWords = new Set(tokenizeNormalized(title));
  const normArtists = artists
    .map((a) => normalizeSearchText(a).replace(/[^a-z0-9\s]+/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const collapsedArtists = artists.map((a) => collapseNormalized(a)).filter(Boolean);
  const artistWords = new Set(normArtists.flatMap((a) => tokenizeNormalized(a)));
  const albumWords = new Set(albumName ? tokenizeNormalized(albumName) : []);

  let score = 0;
  if (normTitle === normQuery) score += 180;
  if (collapsedQuery.length >= 4 && collapsedArtists.some((a) => a === collapsedQuery)) {
    score += 155;
  }
  for (const a of normArtists) {
    if (`${a} ${normTitle}` === normQuery || `${normTitle} ${a}` === normQuery) {
      score += 185;
      break;
    }
  }

  let matchedTitle = 0;
  let matchedArtist = 0;
  let covered = 0;

  for (const tok of queryTokens) {
    const hitTitle = titleWords.has(tok);
    const hitArtist = artistWords.has(tok);
    const hitAlbum = albumWords.has(tok);

    if (hitTitle) {
      matchedTitle++;
      score += 34;
    } else if (normTitle.includes(tok)) {
      score += 6;
    }

    if (hitArtist) {
      matchedArtist++;
      score += 30;
    } else if (normArtists.some((a) => a.includes(tok))) {
      score += 5;
    }

    if (!hitTitle && !hitArtist && hitAlbum) {
      score += 14;
    }

    if (hitTitle || hitArtist || hitAlbum) {
      covered++;
    }
  }

  if (queryTokens.length >= 2 && matchedTitle >= 1 && matchedArtist >= 1) {
    score += 150;
    if (covered === queryTokens.length) score += 40;
  } else if (covered === queryTokens.length) {
    score += 95;
  }

  if (normTitle.startsWith(normQuery)) score += 18;
  return score;
}

export class RecommendationEngine implements IRecommendationEngine {
  private readonly musicProvider?: RecommendationEngineOptions['musicProvider'];
  private readonly storage?: RecommendationStorageAdapter;
  private readonly onAffinityUpdated?: (record: ArtistAffinityRecord) => void;
  private readonly onHistoryRecorded?: (record: PlayHistoryRecord) => void;

  private seeds = new Map<string, SeedArtistConfig>();
  private affinities = new Map<string, ArtistAffinityRecord>();
  private favoriteArtists = new Map<string, FavoriteArtistRecord>();
  private userLibraryTracks: Track[] = [];
  private userLikedTracks: Track[] = [];
  private history: PlayHistoryRecord[] = [];
  private recentSearchQueries: string[] = [];

  public constructor(options: RecommendationEngineOptions = {}) {
    this.musicProvider = options.musicProvider;
    this.storage = options.storage;
    this.onAffinityUpdated = options.onAffinityUpdated;
    this.onHistoryRecorded = options.onHistoryRecorded;

    const seedList = options.initialSeeds ?? DEFAULT_SPANISH_URBAN_SEEDS;
    for (const seed of seedList) {
      const key = normalizeArtistKey(seed.displayName);
      this.seeds.set(key, { ...seed, artistKey: key });
    }

    if (options.initialHistory) {
      this.history = [...options.initialHistory];
    }
  }

  public async hydrate(): Promise<void> {
    if (!this.storage) return;
    const [storedAffinities, storedHistory, storedSeeds] = await Promise.all([
      this.storage.loadAffinities(),
      this.storage.loadHistory(),
      this.storage.loadSeeds ? this.storage.loadSeeds() : Promise.resolve(null),
    ]);

    if (storedSeeds && storedSeeds.length > 0) {
      this.seeds.clear();
      for (const s of storedSeeds) {
        const key = normalizeArtistKey(s.displayName);
        this.seeds.set(key, { ...s, artistKey: key });
      }
    }

    for (const rec of storedAffinities) {
      this.affinities.set(normalizeArtistKey(rec.artistName || rec.artistKey), rec);
    }

    if (storedHistory.length > 0) {
      const cleanedHistory = storedHistory.filter((h) => !isBrokenOrSyntheticTrack(h?.track));
      this.history = cleanedHistory;
      if (cleanedHistory.length !== storedHistory.length) {
        await this.storage.saveHistory(cleanedHistory);
      }
    }
  }

  public recordSearchQuery(query: string): void {
    const trimmed = query.trim();
    if (!trimmed) return;
    this.recentSearchQueries = [
      trimmed,
      ...this.recentSearchQueries.filter((q) => normalizeSearchText(q) !== normalizeSearchText(trimmed)),
    ].slice(0, 12);
  }

  public getRecentSearchQueries(): string[] {
    return [...this.recentSearchQueries];
  }

  public clearRecentSearchQueries(): void {
    this.recentSearchQueries = [];
  }

  public async recordSignal(
    track: Track,
    signal: ImplicitSignalType,
    meta?: RecommendationSignalMeta
  ): Promise<void> {
    const nowMs = meta?.nowMs ?? Date.now();
    const nowIso = new Date(nowMs).toISOString();

    // Scrub-proof validation for skip_early and complete_listen
    if (
      signal === 'skip_early' &&
      typeof meta?.actualPlayedSec === 'number' &&
      meta.actualPlayedSec >= 20
    ) {
      return;
    }

    if (
      signal === 'complete_listen' &&
      typeof meta?.completionRatio === 'number' &&
      meta.completionRatio < 0.8
    ) {
      return;
    }

    const delta = SIGNAL_WEIGHTS[signal];

    for (const artistRef of track.artists) {
      const key = normalizeArtistKey(artistRef.name);
      if (!key) continue;

      const existing = this.affinities.get(key);
      const seed = this.seeds.get(key);

      let decayedBase = 0;
      if (existing) {
        const lastMs = Date.parse(existing.updatedAt);
        const elapsedDays = Number.isFinite(lastMs)
          ? Math.max(0, (nowMs - lastMs) / 86_400_000)
          : 0;
        decayedBase = computeDecayedScore(existing.score, elapsedDays, AFFINITY_HALF_LIFE_DAYS);
      }

      const nextScore = clampAffinityScore(decayedBase + delta);
      const mergedGenres = Array.from(
        new Set([...(existing?.genres ?? []), ...(seed?.genres ?? []), ...(track.genres ?? [])])
      );

      const updatedRecord: ArtistAffinityRecord = {
        artistKey: key,
        artistName: artistRef.name,
        artistId: artistRef.id ?? existing?.artistId ?? seed?.artistId,
        score: Number(nextScore.toFixed(3)),
        genres: mergedGenres,
        playCount:
          (existing?.playCount ?? 0) +
          (signal === 'complete_listen' || signal === 'repeat_loop' ? 1 : 0),
        skipCount: (existing?.skipCount ?? 0) + (signal === 'skip_early' ? 1 : 0),
        isSeed: Boolean(seed),
        updatedAt: nowIso,
      };

      this.affinities.set(key, updatedRecord);
      this.onAffinityUpdated?.(updatedRecord);
    }

    const completionRatio = Math.max(
      0,
      Math.min(
        1.5,
        meta?.completionRatio ??
          (signal === 'complete_listen' || signal === 'repeat_loop'
            ? 1.0
            : signal === 'skip_early'
              ? 0.1
              : 0.85)
      )
    );
    const playedSec =
      meta?.actualPlayedSec ?? Math.round((track.durationSec || 180) * Math.min(1, completionRatio));

    const historyEntry: PlayHistoryRecord = {
      id: `hist_${nowMs}_${Math.random().toString(36).slice(2, 8)}`,
      trackId: track.id,
      track,
      playedSec,
      completionRatio: Number(completionRatio.toFixed(2)),
      signalType: signal,
      playedAt: nowIso,
    };

    this.history = [historyEntry, ...this.history].slice(0, 200);
    this.onHistoryRecorded?.(historyEntry);

    if (this.storage) {
      await Promise.all([
        this.storage.saveAffinities(Array.from(this.affinities.values())),
        this.storage.saveHistory(this.history),
      ]);
    }
  }

  public setFavoriteArtists(artists: readonly FavoriteArtistRecord[]): void {
    this.favoriteArtists.clear();
    for (const a of artists) {
      const key = normalizeArtistKey(a.artistName);
      if (!key) continue;
      this.favoriteArtists.set(key, a);
    }
  }

  public getFavoriteArtists(): FavoriteArtistRecord[] {
    return Array.from(this.favoriteArtists.values());
  }

  public setUserLibraryContext(ctx: {
    libraryTracks?: readonly Track[];
    likedTracks?: readonly Track[];
  }): void {
    this.userLibraryTracks = (ctx.libraryTracks ?? []).filter(
      (t) => Boolean(t?.id) && !isBrokenOrSyntheticTrack(t)
    );
    this.userLikedTracks = (ctx.likedTracks ?? []).filter(
      (t) => Boolean(t?.id) && !isBrokenOrSyntheticTrack(t)
    );
  }

  public getEffectiveAffinity(artistName: string, nowMs = Date.now()): number {
    const key = normalizeArtistKey(artistName);
    if (!key) return 0;

    const isFavorite =
      this.favoriteArtists.has(key) ||
      Array.from(this.favoriteArtists.keys()).some((fk) => isSameArtistAlias(fk, key));
    const favBoost = isFavorite ? 24 : 0;

    const seed = this.seeds.get(key);
    // Smoothly attenuate seed prior as organic listening history grows, while always retaining base affinity
    const totalPlays = Array.from(this.affinities.values()).reduce(
      (acc, r) => acc + r.playCount,
      0
    );
    const priorAttenuation = 1 / (1 + totalPlays / 250);
    const seedBoost = seed ? seed.priorWeight * Math.max(0.35, priorAttenuation) : 0;

    const record = this.affinities.get(key);
    if (!record) {
      return Number(clampAffinityScore(seedBoost + favBoost).toFixed(3));
    }

    const updatedMs = Date.parse(record.updatedAt);
    const elapsedDays = Number.isFinite(updatedMs)
      ? Math.max(0, (nowMs - updatedMs) / 86_400_000)
      : 0;
    const decayedDynamic = computeDecayedScore(record.score, elapsedDays, AFFINITY_HALF_LIFE_DAYS);

    return Number(
      Math.max(
        AFFINITY_SCORE_MIN,
        Math.min(AFFINITY_SCORE_MAX, decayedDynamic + seedBoost + favBoost)
      ).toFixed(3)
    );
  }

  public rerankTracks(
    candidates: readonly Track[],
    opts: RecommendationRerankOptions = {}
  ): Track[] {
    if (candidates.length <= 1) return [...candidates];
    const nowMs = opts.nowMs ?? Date.now();
    const maxPerArtist = opts.maxPerArtistInWindow ?? 2;
    const limit = opts.limit ?? candidates.length;

    // Collect learned top genres
    const genreWeights = new Map<string, number>();
    for (const seed of this.seeds.values()) {
      for (const g of seed.genres) {
        genreWeights.set(g, (genreWeights.get(g) ?? 0) + seed.priorWeight * 0.25);
      }
    }
    for (const rec of this.affinities.values()) {
      for (const g of rec.genres) {
        genreWeights.set(g, (genreWeights.get(g) ?? 0) + rec.score * 0.3);
      }
    }

    // Check recent early skips to penalize burned/disliked tracks
    const skippedTrackIds = new Set(
      this.history
        .filter((h) => h.signalType === 'skip_early')
        .slice(0, 30)
        .map((h) => h.trackId)
    );

    const scored = candidates.map((track, idx) => {
      const artistScore = track.artists.reduce(
        (maxVal, a) => Math.max(maxVal, this.getEffectiveAffinity(a.name, nowMs)),
        0
      );
      const genreBonus = (track.genres ?? []).reduce(
        (sum, g) => sum + (genreWeights.get(g) ?? 0) * 0.2,
        0
      );
      const skipPenalty = skippedTrackIds.has(track.id) ? -6.0 : 0;
      const positionBonus = Math.max(0, 1.2 - idx * 0.05);

      const queryTrimmed = opts.query?.trim();
      if (queryTrimmed) {
        const queryScore = scoreEntityQueryMatch(
          queryTrimmed,
          track.title,
          track.artists.map((a) => a.name),
          track.album?.name
        );
        const sceneFit = this.isSpanishSceneDominant() ? this.scoreTrackSceneFit(track) : 0;
        return {
          track,
          primaryArtistKey: normalizeArtistKey(track.artists[0]?.name ?? ''),
          queryScore,
          score:
            queryScore +
            artistScore * 0.25 +
            genreBonus * 0.15 +
            sceneFit * 3.0 +
            skipPenalty +
            positionBonus * 0.2,
        };
      }

      return {
        track,
        primaryArtistKey: normalizeArtistKey(track.artists[0]?.name ?? ''),
        queryScore: 0,
        score: artistScore + genreBonus + skipPenalty + positionBonus,
      };
    });

    scored.sort((a, b) => b.score - a.score);

    // When a search query is active, preserve top query matches in order instead of pushing them down
    if (opts.query?.trim()) {
      return scored.map((item) => item.track).slice(0, limit);
    }

    // Diversity sliding window constraint so no single artist dominates consecutive slots
    const selected: Track[] = [];
    const deferred: Track[] = [];
    const artistCounts = new Map<string, number>();

    for (const item of scored) {
      const count = artistCounts.get(item.primaryArtistKey) ?? 0;
      if (count < maxPerArtist) {
        selected.push(item.track);
        artistCounts.set(item.primaryArtistKey, count + 1);
      } else {
        deferred.push(item.track);
      }
    }

    return [...selected, ...deferred].slice(0, limit);
  }

  public rankAutocomplete(
    query: string,
    remoteSuggestions: readonly string[]
  ): AutocompleteSuggestion[] {
    const normQuery = normalizeSearchText(query);
    const pool = new Map<string, AutocompleteSuggestion>();

    // 1. Seed & high-affinity artists matching query prefix or tokens
    const rankedArtists = this.getRankedArtists();
    for (const artist of rankedArtists) {
      const normArtist = normalizeSearchText(artist.name);
      if (!normQuery || normArtist.includes(normQuery) || normQuery.includes(normArtist)) {
        const prefixBonus = normQuery && normArtist.startsWith(normQuery) ? 5 : 2;
        pool.set(normArtist, {
          text: artist.name,
          kind: 'artist',
          boostScore: Number((artist.affinity + prefixBonus).toFixed(2)),
        });
      }
    }

    // 2. Recent search history
    for (const histQuery of this.recentSearchQueries) {
      const normHist = normalizeSearchText(histQuery);
      if (!normQuery || normHist.includes(normQuery)) {
        if (!pool.has(normHist)) {
          pool.set(normHist, {
            text: histQuery,
            kind: 'history',
            boostScore: 6.5,
          });
        }
      }
    }

    // 3. Remote suggestions boosted by any matching artist affinity
    for (let i = 0; i < remoteSuggestions.length; i++) {
      const text = remoteSuggestions[i]!.trim();
      if (!text) continue;
      const normText = normalizeSearchText(text);
      if (pool.has(normText)) continue;

      let boost = Math.max(0.5, 4 - i * 0.4);
      for (const artist of rankedArtists) {
        if (normText.includes(normalizeSearchText(artist.name))) {
          boost += Math.max(0, artist.affinity * 0.6);
          break;
        }
      }
      pool.set(normText, {
        text,
        kind: 'suggestion',
        boostScore: Number(boost.toFixed(2)),
      });
    }

    return Array.from(pool.values())
      .sort((a, b) => b.boostScore - a.boostScore)
      .slice(0, 8);
  }

  private isSpanishSceneDominant(): boolean {
    const checkGenres = (genres: readonly string[]) =>
      genres.some((g) => /urbano|trap_canarias|reggaeton|latin|flamenco|pop_es|es/i.test(g));
    for (const s of this.seeds.values()) {
      if (checkGenres(s.genres)) return true;
    }
    for (const rec of this.affinities.values()) {
      if (rec.score >= 2 && checkGenres(rec.genres)) return true;
    }
    return false;
  }

  private scoreTrackSceneFit(track: Track): number {
    let score = scoreSpanishTitleCues(track.title);
    if (track.album?.name) {
      score += Math.round(scoreSpanishTitleCues(track.album.name) * 0.5);
    }
    const hasSceneArtist = track.artists.some((a) => {
      const k = normalizeArtistKey(a.name);
      const ck = collapseNormalized(a.name);
      return (
        KNOWN_ES_SCENE_ARTISTS.has(k) ||
        KNOWN_ES_SCENE_ARTISTS.has(ck) ||
        this.getEffectiveAffinity(a.name) >= 3
      );
    });
    if (hasSceneArtist) score += 75;
    if ((track.genres ?? []).some((g) => /urbano|trap_canarias|reggaeton|latin/i.test(g))) {
      score += 25;
    }
    return score;
  }

  private scoreArtistSceneBonus(
    artist: ArtistSummary,
    trackSceneMap?: Map<string, number>
  ): number {
    if (!this.isSpanishSceneDominant()) return 0;
    const key = normalizeArtistKey(artist.name);
    const cKey = collapseNormalized(artist.name);
    let bonus = 0;
    if (KNOWN_ES_SCENE_ARTISTS.has(key) || KNOWN_ES_SCENE_ARTISTS.has(cKey)) {
      bonus += 90;
    }
    if (trackSceneMap) {
      const trackCue = Math.max(trackSceneMap.get(key) ?? 0, trackSceneMap.get(cKey) ?? 0);
      bonus += Math.min(85, trackCue);
    }
    return bonus;
  }

  public rerankSearchBundle(query: string, bundle: SearchResultBundle): SearchResultBundle {
    const songs = this.rerankTracks(bundle.songs, { query });
    const normQuery = normalizeSearchText(query);
    const collapsedQuery = collapseNormalized(query);
    const queryTokens = tokenizeNormalized(query);

    const trackSceneMap = new Map<string, number>();
    const songArtistNames = new Set<string>();
    for (const song of songs) {
      const cue = this.scoreTrackSceneFit(song);
      for (const a of song.artists) {
        const k = normalizeArtistKey(a.name);
        const ck = collapseNormalized(a.name);
        if (k) songArtistNames.add(k);
        if (ck) songArtistNames.add(ck);
        if (cue > 0) {
          trackSceneMap.set(k, Math.max(trackSceneMap.get(k) ?? 0, cue));
          trackSceneMap.set(ck, Math.max(trackSceneMap.get(ck) ?? 0, cue));
        }
      }
    }

    const artists = [...bundle.artists]
      .map((artist, idx) => {
        const normName = normalizeSearchText(artist.name);
        const collapsedName = collapseNormalized(artist.name);
        const artistWordSet = new Set(tokenizeNormalized(artist.name));
        let matchScore = 0;
        if (
          normQuery.length > 0 &&
          (normName === normQuery || (collapsedQuery.length >= 4 && collapsedName === collapsedQuery))
        ) {
          matchScore = 195;
        } else if (
          queryTokens.length > 0 &&
          queryTokens.every((t) => artistWordSet.has(t))
        ) {
          matchScore = 170;
        } else if (
          normQuery.length > 0 &&
          (normName.includes(normQuery) ||
            normQuery.includes(normName) ||
            (collapsedQuery.length >= 4 && collapsedName.includes(collapsedQuery)))
        ) {
          matchScore = 115;
        }
        const appearsInSongs =
          songArtistNames.has(normalizeArtistKey(artist.name)) ||
          songArtistNames.has(collapsedName);
        if (normQuery.length > 0 && matchScore === 0 && !appearsInSongs) {
          return null;
        }
        const affinityBonus = matchScore > 0 ? this.getEffectiveAffinity(artist.name) * 4 : 0;
        const sceneBonus = matchScore > 0 ? this.scoreArtistSceneBonus(artist, trackSceneMap) : 0;
        return {
          artist,
          idx,
          score: matchScore + affinityBonus + sceneBonus,
        };
      })
      .filter((x): x is { artist: ArtistSummary; idx: number; score: number } => x !== null)
      .sort((a, b) => b.score - a.score || a.idx - b.idx)
      .map((x) => x.artist);

    const albums = [...bundle.albums]
      .map((album, idx) => {
        const qScore = scoreEntityQueryMatch(
          query,
          album.title,
          album.artists.map((a) => a.name)
        );
        const esBonus = this.isSpanishSceneDominant()
          ? Math.round(scoreSpanishTitleCues(album.title) * 0.4)
          : 0;
        return { album, idx, score: qScore + esBonus };
      })
      .sort((a, b) => b.score - a.score || a.idx - b.idx)
      .map((x) => x.album);

    const reranked: SearchResultBundle = {
      ...bundle,
      songs,
      artists,
      albums,
    };
    const topResult = this.selectBestResult(query, reranked);
    return {
      ...reranked,
      topResult,
    };
  }

  private parseSubscribersCount(text?: string): number | null {
    if (!text) return null;
    const m = text.match(/([\d.,]+)\s*([kmb]|mil)?/i);
    if (!m || !m[1]) return null;
    let numStr = m[1];
    if (numStr.includes('.') && numStr.includes(',')) {
      numStr = numStr.replace(/\./g, '').replace(',', '.');
    } else if (/^\d{1,3}(\.\d{3})+$/.test(numStr)) {
      numStr = numStr.replace(/\./g, '');
    } else {
      numStr = numStr.replace(',', '.');
    }
    const val = Number.parseFloat(numStr);
    if (!Number.isFinite(val)) return null;
    const unit = (m[2] ?? '').toLowerCase();
    if (unit === 'k' || unit === 'mil') return Math.round(val * 1_000);
    if (unit === 'm') return Math.round(val * 1_000_000);
    if (unit === 'b') return Math.round(val * 1_000_000_000);
    return Math.round(val);
  }

  public selectBestResult(
    query: string,
    bundle: SearchResultBundle
  ): TopResultMatch | undefined {
    const normQuery = normalizeSearchText(query);
    const collapsedQuery = collapseNormalized(query);
    const queryTokens = tokenizeNormalized(query);
    const spanishDom = this.isSpanishSceneDominant();

    const trackSceneMap = new Map<string, number>();
    for (const s of bundle.songs) {
      const cue = this.scoreTrackSceneFit(s);
      if (cue <= 0) continue;
      for (const a of s.artists) {
        const k = normalizeArtistKey(a.name);
        const ck = collapseNormalized(a.name);
        trackSceneMap.set(k, Math.max(trackSceneMap.get(k) ?? 0, cue));
        trackSceneMap.set(ck, Math.max(trackSceneMap.get(ck) ?? 0, cue));
      }
    }

    let bestCandidate: TopResultMatch | undefined;
    let bestScore = -Infinity;

    for (const artist of bundle.artists) {
      const normName = normalizeSearchText(artist.name);
      const collapsedName = collapseNormalized(artist.name);
      const exact =
        normQuery.length > 0 &&
        (normName === normQuery || (collapsedQuery.length >= 4 && collapsedName === collapsedQuery))
          ? 660
          : 0;
      const artistWordSet = new Set(tokenizeNormalized(artist.name));
      const allTokensInArtist =
        queryTokens.length > 0 && queryTokens.every((t) => artistWordSet.has(t)) ? 560 : 0;
      const rawAffinity = this.getEffectiveAffinity(artist.name);
      const favoritePrefixBoost =
        normQuery.length >= 3 &&
        rawAffinity >= 2 &&
        (normName.startsWith(normQuery) || collapsedName.startsWith(collapsedQuery))
          ? 560 + Math.min(200, rawAffinity * 20)
          : 0;
      const partial =
        exact === 0 && normQuery.length > 0 && (normName.includes(normQuery) || normQuery.includes(normName))
          ? 140
          : 0;
      let textMatch = Math.max(exact, allTokensInArtist, favoritePrefixBoost, partial);
      if (normQuery.length > 0 && textMatch === 0) {
        continue;
      }
      const subs = this.parseSubscribersCount(artist.subscribersText);
      if (subs !== null && subs < 500 && rawAffinity <= 0) {
        textMatch = Math.min(textMatch, 420);
      }
      const affinity = Math.min(120, Math.max(-40, rawAffinity * 3));
      const sceneBonus = this.scoreArtistSceneBonus(artist, trackSceneMap) * 0.6;
      const score = textMatch + affinity + sceneBonus;
      if (score > bestScore) {
        bestScore = score;
        bestCandidate = { kind: 'artist', item: artist };
      }
    }

    for (const song of bundle.songs) {
      const queryMatch = scoreEntityQueryMatch(
        query,
        song.title,
        song.artists.map((a) => a.name),
        song.album?.name
      );
      if (normQuery.length > 0 && queryMatch === 0) {
        continue;
      }
      const normTitle = normalizeSearchText(song.title);
      const titleWordSet = new Set(tokenizeNormalized(song.title));
      const titleWordHits = queryTokens.filter((t) => titleWordSet.has(t)).length;
      const isTitleMatched =
        normQuery.length > 0 &&
        (normTitle === normQuery ||
          (normQuery.length >= 3 && normTitle.startsWith(normQuery)) ||
          titleWordHits > 0);
      const cappedQueryMatch = isTitleMatched ? queryMatch + 160 : Math.min(queryMatch, 320);
      const artistAffinity =
        song.artists.reduce(
          (m, a) => Math.max(m, this.getEffectiveAffinity(a.name)),
          0
        ) * 0.35;
      const sceneFit = spanishDom ? this.scoreTrackSceneFit(song) * 2.5 : 0;
      const score = cappedQueryMatch + artistAffinity + sceneFit;
      if (score > bestScore) {
        bestScore = score;
        bestCandidate = { kind: 'song', item: song };
      }
    }

    for (const album of bundle.albums) {
      const queryMatch = scoreEntityQueryMatch(
        query,
        album.title,
        album.artists.map((a) => a.name)
      );
      const artistAffinity =
        album.artists.reduce(
          (m, a) => Math.max(m, this.getEffectiveAffinity(a.name)),
          0
        ) * 0.25;
      // Slightly prefer matching the song over the album card when both cover the query
      const score = (queryMatch > 0 ? queryMatch - 10 : 0) + artistAffinity;
      if (score > bestScore) {
        bestScore = score;
        bestCandidate = { kind: 'album', item: album };
      }
    }

    return bestCandidate ?? (bundle.songs[0] ? { kind: 'song', item: bundle.songs[0] } : undefined);
  }

  public async buildHomeShelves(signal?: AbortSignal): Promise<HomeEditorialShelf[]> {
    const now = new Date();
    const dailyKey = getDailyMixDateKey(now);
    const rollingWin = getRollingDaysWindow(now, 15);
    const rolling30Win = getRollingDaysWindow(now, 30);
    const currentYear = now.getFullYear();

    const makeTrackKey = (t: Track): string =>
      `${normalizeSearchText(t.title)}::${normalizeArtistKey(t.artists[0]?.name ?? '')}`;

    // Collect genuine user tracks from playlists, likes, and non-skip real play history
    const realHistoryTracks = this.history
      .filter((h) => h.signalType !== 'skip_early' && !isBrokenOrSyntheticTrack(h.track))
      .map((h) => h.track);
    const userOwnedTracksMap = new Map<string, Track>();
    const userOwnedKeys = new Set<string>();
    for (const t of [...this.userLikedTracks, ...this.userLibraryTracks, ...realHistoryTracks]) {
      if (!t?.id || isBrokenOrSyntheticTrack(t)) continue;
      const tk = makeTrackKey(t);
      if (!userOwnedTracksMap.has(t.id)) {
        userOwnedTracksMap.set(t.id, t);
      }
      userOwnedKeys.add(tk);
    }
    const userOwnedTracks = Array.from(userOwnedTracksMap.values());

    // Build genuine user artist taste profile:
    // 1. Explicit hearted favorite artists
    // 2. Artists with tracks in playlists / liked tracks (weighted by song count)
    // 3. Organic listened artists (playCount > 0 or non-seed score > 0)
    const artistStats = new Map<string, { displayName: string; id?: string; weight: number }>();
    const bumpUserArtist = (name?: string, delta = 1, id?: string) => {
      if (!name) return;
      const k = normalizeArtistKey(name);
      if (!k) return;
      const existing = artistStats.get(k);
      if (existing) {
        existing.weight += delta;
        if (!existing.id && id) existing.id = id;
      } else {
        artistStats.set(k, { displayName: name.trim(), id, weight: delta });
      }
    };

    for (const fa of this.favoriteArtists.values()) {
      bumpUserArtist(fa.artistName, 50, fa.artistId);
    }
    for (const t of this.userLikedTracks) {
      for (const a of t.artists) bumpUserArtist(a.name, 6, a.id);
    }
    for (const t of this.userLibraryTracks) {
      for (const a of t.artists) bumpUserArtist(a.name, 4, a.id);
    }
    for (const h of this.history) {
      if (h.signalType === 'skip_early' || isBrokenOrSyntheticTrack(h.track)) continue;
      for (const a of h.track.artists) bumpUserArtist(a.name, 2.5, a.id);
    }
    for (const rec of this.affinities.values()) {
      if (rec.playCount > 0 || (!rec.isSeed && rec.score > 0)) {
        bumpUserArtist(rec.artistName, Math.max(1, rec.score * 0.8 + rec.playCount * 2), rec.artistId);
      }
    }

    const hasRealUserTaste = artistStats.size > 0 || userOwnedTracks.length > 0;
    const rankedRealArtists = Array.from(artistStats.entries())
      .sort((a, b) => b[1].weight - a[1].weight)
      .map(([, v]) => v);

    const userCoreArtists: Array<{ displayName: string; id?: string }> = [...rankedRealArtists];
    const seenCoreKeys = new Set(userCoreArtists.map((a) => normalizeArtistKey(a.displayName)));
    if (!hasRealUserTaste) {
      for (const def of ['Cruzzi', 'La Pantera', 'Bad Bunny', 'Quevedo', 'Rels B', 'Saiko']) {
        const k = normalizeArtistKey(def);
        if (!seenCoreKeys.has(k)) {
          seenCoreKeys.add(k);
          userCoreArtists.push({ displayName: def });
        }
      }
    }

    const topArtist1 = userCoreArtists[0]?.displayName ?? 'Cruzzi';
    const topArtist2 = userCoreArtists[1]?.displayName ?? topArtist1;
    const topArtist3 = userCoreArtists[2]?.displayName ?? topArtist2;
    const topArtist4 = userCoreArtists[3]?.displayName ?? topArtist1;
    const topArtist5 = userCoreArtists[4]?.displayName ?? topArtist3;

    // Allowed artists set starts from user's own artists and expands only through real relatedArtists / collaborations
    const allowedTasteKeys = new Set<string>();
    const addAllowedArtist = (name?: string) => {
      if (!name) return;
      const k = normalizeArtistKey(name);
      if (k) allowedTasteKeys.add(k);
    };
    for (const a of userCoreArtists) addAllowedArtist(a.displayName);

    const isAllowedTrack = (t: Track | undefined | null): t is Track => {
      if (!t || !t.id || isBrokenOrSyntheticTrack(t)) return false;
      if (allowedTasteKeys.size === 0) return true;
      return t.artists.some((a) => {
        const ak = normalizeArtistKey(a.name);
        for (const allowed of allowedTasteKeys) {
          if (isSameArtistAlias(ak, allowed)) return true;
        }
        return false;
      });
    };

    const collectedTrackMap = new Map<string, Track>();
    const collectedByTitleKey = new Set<string>();
    const pushTrack = (
      t: Track | undefined | null,
      forceAllow = false,
      allowSynthetic = false
    ) => {
      if (!t || !t.id || !t.title) return;
      if (!allowSynthetic && isBrokenOrSyntheticTrack(t)) return;
      if (!forceAllow && hasRealUserTaste && !isAllowedTrack(t)) return;
      if (collectedTrackMap.has(t.id)) return;
      const tk = makeTrackKey(t);
      if (tk !== '::' && collectedByTitleKey.has(tk)) return;
      if (tk !== '::') collectedByTitleKey.add(tk);
      collectedTrackMap.set(t.id, t);
    };

    for (const t of userOwnedTracks) {
      pushTrack(t, true);
    }

    const recentReleasesMap = new Map<string, Track>();
    const collectedAlbums: AlbumSummary[] = [];
    const seenAlbumKeys = new Set<string>();
    const pushAlbum = (al: AlbumSummary | undefined | null, forceAllow = false) => {
      if (!al || !al.id || !al.title) return;
      const belongs =
        forceAllow ||
        !hasRealUserTaste ||
        al.artists.some((a) => {
          const ak = normalizeArtistKey(a.name);
          for (const allowed of allowedTasteKeys) {
            if (isSameArtistAlias(ak, allowed)) return true;
          }
          return false;
        });
      if (!belongs) return;
      const aKey = `${normalizeSearchText(al.title)}::${normalizeArtistKey(al.artists[0]?.name ?? '')}`;
      if (seenAlbumKeys.has(al.id) || seenAlbumKeys.has(aKey)) return;
      seenAlbumKeys.add(al.id);
      seenAlbumKeys.add(aKey);
      collectedAlbums.push(al);
    };

    const emergingArtistsPool = new Map<string, { id?: string; name: string; score: number }>();
    const queueEmergingArtist = (name?: string, id?: string, score = 10) => {
      if (!name) return;
      const k = normalizeArtistKey(name);
      if (!k) return;
      addAllowedArtist(name);
      const prev = emergingArtistsPool.get(k);
      if (!prev || score > prev.score) {
        emergingArtistsPool.set(k, { id: id ?? prev?.id, name: name.trim(), score });
      }
    };

    if (this.musicProvider) {
      const withTimeout = <T,>(promise: Promise<T>, ms: number): Promise<T | null> =>
        Promise.race([
          promise.catch(() => null),
          new Promise<null>((resolveTimeout) => setTimeout(() => resolveTimeout(null), ms)),
        ]);

      const runBoundedBatch = async <TItem, TOut>(
        items: readonly TItem[],
        concurrency: number,
        perItemMs: number,
        fn: (item: TItem, idx: number) => Promise<TOut>
      ): Promise<Array<TOut | null>> => {
        if (items.length === 0) return [];
        const results: Array<TOut | null> = new Array(items.length).fill(null);
        let cursor = 0;
        const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
          while (cursor < items.length) {
            if (signal?.aborted) break;
            const myIdx = cursor++;
            if (myIdx >= items.length) break;
            results[myIdx] = await withTimeout(fn(items[myIdx]!, myIdx), perItemMs);
          }
        });
        await Promise.all(workers);
        return results;
      };

      const coreBatch = userCoreArtists.slice(0, 8);
      const seedTrackCandidates = seededShuffle(userOwnedTracks, `seeds:${dailyKey}`).slice(0, 4);

      // Wave 1: Bounded parallel fetch of core artists (avoids Deezer 50req/5s quota bursts), track radios, and external radar
      const [artistDetailsRaw, relatedTrackRaw, externalRadarRaw] = await Promise.all([
        runBoundedBatch(coreBatch, 3, 4500, (a): Promise<unknown> =>
          typeof this.musicProvider!.getArtist === 'function'
            ? this.musicProvider!.getArtist!(a.id || a.displayName, signal, { name: a.displayName })
            : this.musicProvider!.search(a.displayName, 'song', signal)
        ),
        runBoundedBatch(seedTrackCandidates, 4, 2600, (t) =>
          this.musicProvider!.getRelated(t.id, signal)
        ),
        typeof this.musicProvider.getReleaseRadar === 'function'
          ? withTimeout(this.musicProvider.getReleaseRadar(signal), 8000).then((r) => r ?? [])
          : Promise.resolve([] as ExternalReleaseCandidate[]),
      ]);

      const artistDetails = artistDetailsRaw.map((val) =>
        val
          ? ({ status: 'fulfilled', value: val } as PromiseFulfilledResult<any>)
          : ({ status: 'rejected', reason: null } as PromiseRejectedResult)
      );
      const relatedTrackRes = relatedTrackRaw.map((val) =>
        val
          ? ({ status: 'fulfilled', value: val } as PromiseFulfilledResult<any>)
          : ({ status: 'rejected', reason: null } as PromiseRejectedResult)
      );

      const recentAlbumCandidates: AlbumSummary[] = [];

      for (const r of artistDetails) {
        if (r.status !== 'fulfilled' || !r.value) continue;
        const val = r.value as any;
        if (Array.isArray(val.topSongs)) {
          // ArtistDetail
          for (const t of val.topSongs) {
            for (const co of t.artists ?? []) addAllowedArtist(co.name);
            pushTrack(t, true);
          }
          for (const ap of (val.appearances ?? []) as Track[]) {
            if (isBrokenOrSyntheticTrack(ap)) continue;
            for (const co of ap.artists ?? []) addAllowedArtist(co.name);
            if (!recentReleasesMap.has(ap.id)) recentReleasesMap.set(ap.id, ap);
            pushTrack(ap, true);
          }
          for (const rel of val.relatedArtists ?? []) {
            queueEmergingArtist(rel.name, rel.id, seenCoreKeys.has(normalizeArtistKey(rel.name)) ? 4 : 25);
          }
          const combinedRels = [...(val.singles ?? []), ...(val.albums ?? [])];
          for (const al of combinedRels) {
            pushAlbum(al, true);
            if (
              (al.year ?? 0) >= currentYear - 1 ||
              isReleaseDateInWindow(al.releaseDate, rolling30Win.startIso, rolling30Win.endIso)
            ) {
              recentAlbumCandidates.push(al);
            }
          }
        } else if (Array.isArray(val.songs)) {
          // Fallback SearchResultBundle
          for (const t of val.songs) {
            pushTrack(t);
          }
          for (const al of val.albums ?? []) {
            pushAlbum(al);
          }
        }
      }

      for (const rel of relatedTrackRes) {
        if (rel.status !== 'fulfilled' || !rel.value) continue;
        for (const t of rel.value.tracks ?? []) {
          for (const a of t.artists ?? []) {
            queueEmergingArtist(a.name, a.id, seenCoreKeys.has(normalizeArtistKey(a.name)) ? 5 : 22);
          }
          pushTrack(t, true);
        }
        for (const ar of rel.value.artists ?? []) {
          queueEmergingArtist(ar.name, ar.id, seenCoreKeys.has(normalizeArtistKey(ar.name)) ? 5 : 28);
        }
      }

      // Score and filter external release radar (Apple ES / Deezer Novedades ES / Spotify / LaHiguera) with instant zero-search fast path for pre-built tracks
      const existingRecentKeys = new Set(
        Array.from(recentReleasesMap.values())
          .filter((t) => isReleaseDateInWindow(t.releaseDate, rollingWin.startIso, rollingWin.endIso))
          .map((t) => makeTrackKey(t))
      );
      const favArtistNorms = new Set(
        Array.from(this.favoriteArtists.values()).map((fa) => normalizeArtistKey(fa.artistName))
      );
      const isArtistInSet = (ak: string, set: Set<string>): boolean => {
        if (!ak) return false;
        if (set.has(ak)) return true;
        for (const k of set) {
          if (isSameArtistAlias(ak, k)) return true;
        }
        return false;
      };
      const isSpanishUrbanUser =
        !hasRealUserTaste ||
        Array.from(seenCoreKeys).some(
          (k) => KNOWN_ES_SCENE_ARTISTS.has(k) || (k === 'cruzzi' && KNOWN_ES_SCENE_ARTISTS.has('cruz cafune'))
        ) ||
        Array.from(favArtistNorms).some(
          (k) => KNOWN_ES_SCENE_ARTISTS.has(k) || (k === 'cruzzi' && KNOWN_ES_SCENE_ARTISTS.has('cruz cafune'))
        ) ||
        userOwnedTracks.some((t) => this.scoreTrackSceneFit(t) >= 30);

      const rawRadarList = Array.isArray(externalRadarRaw) ? externalRadarRaw : [];

      // Zero-search fast path: pre-built playable tracks within the 15-day window go straight into recentReleasesMap
      for (const cand of rawRadarList) {
        const preTrack = cand?.track;
        if (!preTrack || isBrokenOrSyntheticTrack(preTrack)) continue;
        const effectiveDate =
          preTrack.releaseDate && isReleaseDateInWindow(preTrack.releaseDate, rollingWin.startIso, rollingWin.endIso)
            ? preTrack.releaseDate
            : cand.releaseDate && isReleaseDateInWindow(cand.releaseDate, rollingWin.startIso, rollingWin.endIso)
              ? cand.releaseDate
              : undefined;
        if (!effectiveDate) continue;
        const mergedTrackArtists = [...(preTrack.artists ?? [])];
        const existingArtistKeys = new Set(
          mergedTrackArtists.flatMap((a) =>
            a.name
              .split(/\s*(?:,|&|\bfeat\.?\b|\bft\.?\b|\bcon\b)\s*/i)
              .map((p) => normalizeArtistKey(p))
              .filter(Boolean)
          )
        );
        for (const candArtistName of cand.artists ?? []) {
          const ck = normalizeArtistKey(candArtistName);
          if (ck && !existingArtistKeys.has(ck)) {
            existingArtistKeys.add(ck);
            mergedTrackArtists.push({ name: candArtistName });
          }
        }
        const resolvedTrack: Track = {
          ...preTrack,
          artists: mergedTrackArtists,
          releaseDate: effectiveDate,
          releaseYear: Number.parseInt(effectiveDate.slice(0, 4), 10) || preTrack.releaseYear || currentYear,
        };
        for (const a of resolvedTrack.artists) addAllowedArtist(a.name);
        const candKey = `${normalizeSearchText(resolvedTrack.title)}::${normalizeArtistKey(resolvedTrack.artists[0]?.name ?? cand.artists?.[0] ?? '')}`;
        if (candKey !== '::') existingRecentKeys.add(candKey);
        if (!recentReleasesMap.has(resolvedTrack.id)) {
          recentReleasesMap.set(resolvedTrack.id, resolvedTrack);
        }
        pushTrack(resolvedTrack, true);
      }

      const allowEditorialFill = rawRadarList.length >= 12;
      const matchedRadarCandidates = rawRadarList
        .map((cand) => {
          if (!cand?.title || !Array.isArray(cand.artists) || cand.artists.length === 0) return null;
          if (cand.track && !isBrokenOrSyntheticTrack(cand.track)) return null;
          if (cand.releaseDate && cand.releaseDate < rollingWin.startIso) return null;
          const candKey = `${normalizeSearchText(cand.title)}::${normalizeArtistKey(cand.artists[0] ?? '')}`;
          if (existingRecentKeys.has(candKey)) return null;

          let tasteScore = 0;
          let matchedArtistName: string | undefined;
          let bestTierWeight = 0;
          for (const aName of cand.artists) {
            const ak = normalizeArtistKey(aName);
            if (!ak) continue;
            if (isArtistInSet(ak, favArtistNorms) || isArtistInSet(ak, seenCoreKeys)) {
              tasteScore += 100;
              if (100 > bestTierWeight) {
                bestTierWeight = 100;
                matchedArtistName = aName;
              }
            } else if (isArtistInSet(ak, allowedTasteKeys) || emergingArtistsPool.has(ak)) {
              tasteScore += 58;
              if (58 > bestTierWeight) {
                bestTierWeight = 58;
                matchedArtistName = aName;
              }
            } else if (
              isSpanishUrbanUser &&
              cand.source !== 'spotify_nmf' &&
              (KNOWN_ES_SCENE_ARTISTS.has(ak) ||
                Array.from(KNOWN_ES_SCENE_ARTISTS).some((sk) => isSameArtistAlias(ak, sk)))
            ) {
              tasteScore += 36;
              if (36 > bestTierWeight) {
                bestTierWeight = 36;
                matchedArtistName = aName;
              }
            }
          }
          // Tier 4 broad fresh editorial fill so Descubre lo Nuevo reaches up to 50 tracks cleanly
          if (
            tasteScore <= 0 &&
            allowEditorialFill &&
            cand.releaseDate &&
            (cand.source === 'apple_es_top' ||
              cand.source === 'deezer_novedades_es' ||
              cand.source === 'spotify_novedades_es' ||
              cand.source === 'lahiguera_canciones' ||
              cand.source === 'deezer_radar_weekly' ||
              cand.source === 'spotify_nmf')
          ) {
            tasteScore = cand.source === 'apple_es_top' || cand.source === 'spotify_novedades_es' ? 24 : 16;
            matchedArtistName = cand.artists[0]!;
          }
          if (tasteScore <= 0) return null;
          // Prioritize fresh-dated editorial drops (Apple ES / Novedades Viernes ES / LaHiguera) above undated chart tracks (PEGAO)
          const datedFreshBonus = cand.releaseDate ? 120 : -80;
          return {
            cand,
            candKey,
            matchedArtistName: cand.artists[0] ?? matchedArtistName!,
            score: tasteScore + datedFreshBonus + cand.priority * 0.4,
          };
        })
        .filter(
          (
            x
          ): x is {
            cand: ExternalReleaseCandidate;
            candKey: string;
            matchedArtistName: string;
            score: number;
          } => Boolean(x)
        )
        .sort((a, b) => b.score - a.score);

      const dedupedRadarTargets: Array<{ cand: ExternalReleaseCandidate; queryArtist: string }> = [];
      const seenRadarTargetKeys = new Set<string>();
      for (const item of matchedRadarCandidates) {
        if (seenRadarTargetKeys.has(item.candKey)) continue;
        seenRadarTargetKeys.add(item.candKey);
        dedupedRadarTargets.push({ cand: item.cand, queryArtist: item.matchedArtistName });
        if (dedupedRadarTargets.length >= 22) break;
      }

      // Wave 2: Prioritize rolling 15-day (then 30-day) releases, resolve taste-matched radar drops, and emerging artists
      const allCandidateAlbums = [...recentAlbumCandidates, ...collectedAlbums].filter(
        (a, idx, arr) => arr.findIndex((x) => x.id === a.id) === idx
      );
      const recentWindowAlbums = allCandidateAlbums.filter((al) =>
        isReleaseDateInWindow(al.releaseDate, rollingWin.startIso, rollingWin.endIso)
      );
      const fallback30Albums =
        recentWindowAlbums.length >= 4
          ? []
          : allCandidateAlbums.filter(
              (al) =>
                !recentWindowAlbums.some((w) => w.id === al.id) &&
                isReleaseDateInWindow(al.releaseDate, rolling30Win.startIso, rolling30Win.endIso)
            );
      const prioritizedWindowAlbums = [...recentWindowAlbums, ...fallback30Albums];
      const nonWindowNewest = allCandidateAlbums
        .filter((al) => !prioritizedWindowAlbums.some((w) => w.id === al.id))
        .sort((a, b) => {
          const da = a.releaseDate ?? `${a.year ?? 0}-01-01`;
          const db = b.releaseDate ?? `${b.year ?? 0}-01-01`;
          return db.localeCompare(da);
        })
        .slice(0, prioritizedWindowAlbums.length < 4 ? 6 : 2);
      const newestReleaseTargets = [...prioritizedWindowAlbums.slice(0, 6), ...nonWindowNewest].slice(0, 8);
      const fetchedAlbumIds = new Set(newestReleaseTargets.map((al) => al.id));

      const emergingTargets = seededShuffle(
        Array.from(emergingArtistsPool.values())
          .filter((a) => !seenCoreKeys.has(normalizeArtistKey(a.name)))
          .sort((a, b) => b.score - a.score)
          .slice(0, 14),
        `emg:${dailyKey}`
      ).slice(0, 6);

      const extraTargets =
        emergingTargets.length > 0
          ? emergingTargets
          : coreBatch.slice(0, 4).map((a) => ({ id: a.id, name: a.displayName, score: 10 }));

      const [albumDetailRaw, emergingRaw, radarResolveRaw] = await Promise.all([
        typeof this.musicProvider.getAlbum === 'function' && newestReleaseTargets.length > 0
          ? runBoundedBatch(newestReleaseTargets, 4, 2800, (al) =>
              this.musicProvider!.getAlbum!(al.id, signal)
            )
          : Promise.resolve([]),
        runBoundedBatch(extraTargets, 3, 2600, (a): Promise<unknown> =>
          typeof this.musicProvider!.getArtist === 'function'
            ? this.musicProvider!.getArtist!(a.id || a.name, signal, { name: a.name })
            : this.musicProvider!.search(a.name, 'song', signal)
        ),
        dedupedRadarTargets.length > 0
          ? runBoundedBatch(dedupedRadarTargets, 4, 4000, (target) =>
              this.musicProvider!.search(
                `${target.queryArtist} ${target.cand.title}`.trim(),
                'song',
                signal
              )
            )
          : Promise.resolve([]),
      ]);

      const albumDetailRes = albumDetailRaw.map((val) =>
        val
          ? ({ status: 'fulfilled', value: val } as PromiseFulfilledResult<any>)
          : ({ status: 'rejected', reason: null } as PromiseRejectedResult)
      );
      const emergingRes = emergingRaw.map((val) =>
        val
          ? ({ status: 'fulfilled', value: val } as PromiseFulfilledResult<any>)
          : ({ status: 'rejected', reason: null } as PromiseRejectedResult)
      );
      const radarResolveRes = radarResolveRaw.map((val) =>
        val
          ? ({ status: 'fulfilled', value: val } as PromiseFulfilledResult<SearchResultBundle>)
          : ({ status: 'rejected', reason: null } as PromiseRejectedResult)
      );

      const stampAlbumTracks = (resVal: any, fallbackMeta?: AlbumSummary) => {
        if (!Array.isArray(resVal?.tracks)) return;
        const rawTracks = resVal.tracks as Track[];
        if (
          fallbackMeta?.id &&
          resVal.album?.id &&
          String(resVal.album.id) !== String(fallbackMeta.id) &&
          rawTracks.every((t) => isBrokenOrSyntheticTrack(t))
        ) {
          return;
        }
        const fallbackYear = resVal.album?.year ?? fallbackMeta?.year;
        const fallbackDate = resVal.album?.releaseDate ?? fallbackMeta?.releaseDate;
        for (const t of rawTracks) {
          if (isBrokenOrSyntheticTrack(t)) continue;
          const isStaleCatalogTrack =
            Boolean(t.releaseYear && fallbackYear && fallbackYear - t.releaseYear >= 2);
          let resolvedDate = t.releaseDate;
          if (!isStaleCatalogTrack && fallbackDate) {
            resolvedDate =
              resolvedDate && resolvedDate >= fallbackDate ? resolvedDate : fallbackDate;
          }
          const resolvedYear = resolvedDate
            ? Number(resolvedDate.slice(0, 4))
            : t.releaseYear ?? (!isStaleCatalogTrack ? fallbackYear : undefined);
          const enrichedTrack: Track = {
            ...t,
            ...(resolvedYear ? { releaseYear: resolvedYear } : {}),
            ...(resolvedDate ? { releaseDate: resolvedDate } : {}),
          };
          if (!recentReleasesMap.has(enrichedTrack.id)) {
            recentReleasesMap.set(enrichedTrack.id, enrichedTrack);
          }
          pushTrack(enrichedTrack, true);
        }
      };

      for (let i = 0; i < albumDetailRes.length; i++) {
        const res = albumDetailRes[i]!;
        if (res.status !== 'fulfilled' || !res.value) continue;
        stampAlbumTracks(res.value, newestReleaseTargets[i]);
      }

      // Resolve taste-matched external radar releases into playable catalog tracks with strict date validation
      const seventyFiveDaysAgoIso = getDailyMixDateKey(
        new Date(now.getFullYear(), now.getMonth(), now.getDate() - 75, 0, 0, 0, 0)
      );
      for (let i = 0; i < radarResolveRes.length; i++) {
        const res = radarResolveRes[i];
        const target = dedupedRadarTargets[i];
        if (!target || !res || res.status !== 'fulfilled' || !res.value) continue;
        const { cand } = target;
        const candTitleTokens = new Set(tokenizeNormalized(cand.title));
        const candTitleNorm = normalizeSearchText(cand.title);
        const candArtistNorms = cand.artists.map((a) => normalizeArtistKey(a)).filter(Boolean);
        const matchedSong = (res.value.songs ?? []).find((song) => {
          if (isBrokenOrSyntheticTrack(song)) return false;
          const sTitleNorm = normalizeSearchText(song.title);
          if (!sTitleNorm) return false;
          if (candTitleNorm.length <= 2) {
            if (sTitleNorm !== candTitleNorm) return false;
          } else {
            const titleContains =
              sTitleNorm === candTitleNorm ||
              sTitleNorm.includes(candTitleNorm) ||
              candTitleNorm.includes(sTitleNorm);
            if (!titleContains) {
              const sTokens = tokenizeNormalized(song.title);
              const overlapCount = sTokens.filter((tok) => candTitleTokens.has(tok)).length;
              const ratio = candTitleTokens.size > 0 ? overlapCount / candTitleTokens.size : 0;
              if (ratio < 0.6) return false;
            }
          }
          return song.artists.some((sa) => {
            const sak = normalizeArtistKey(sa.name);
            return candArtistNorms.some((ck) => isSameArtistAlias(sak, ck));
          });
        });
        if (!matchedSong) continue;

        const songHasWindowDate = isReleaseDateInWindow(
          matchedSong.releaseDate,
          rollingWin.startIso,
          rollingWin.endIso
        );
        const candHasWindowDate = isReleaseDateInWindow(
          cand.releaseDate,
          rollingWin.startIso,
          rollingWin.endIso
        );

        let resolvedDate: string | undefined;
        if (songHasWindowDate) {
          resolvedDate = matchedSong.releaseDate;
        } else if (matchedSong.releaseDate) {
          if (cand.source === 'spotify_pegao') continue;
          if (matchedSong.releaseDate >= seventyFiveDaysAgoIso && candHasWindowDate) {
            resolvedDate = cand.releaseDate;
          } else {
            continue;
          }
        } else if (
          candHasWindowDate &&
          (!matchedSong.releaseYear || matchedSong.releaseYear >= currentYear - 1)
        ) {
          resolvedDate = cand.releaseDate;
        } else {
          continue;
        }

        const resolvedTrack: Track = {
          ...matchedSong,
          ...(resolvedDate
            ? {
                releaseDate: resolvedDate,
                releaseYear: Number(resolvedDate.slice(0, 4)),
              }
            : {}),
        };
        for (const a of resolvedTrack.artists) addAllowedArtist(a.name);
        if (!recentReleasesMap.has(resolvedTrack.id)) {
          recentReleasesMap.set(resolvedTrack.id, resolvedTrack);
        }
        pushTrack(resolvedTrack, true);
      }

      const secondWaveSeeds: Track[] = [];
      const emergingWeeklyAlbums: AlbumSummary[] = [];
      const secondDegreeEmerging = new Map<string, { id?: string; name: string }>();
      const seenEmergingKeys = new Set(extraTargets.map((e) => normalizeArtistKey(e.name)));

      for (const r of emergingRes) {
        if (r.status !== 'fulfilled' || !r.value) continue;
        const val = r.value as any;
        const songs: Track[] = Array.isArray(val.topSongs)
          ? val.topSongs
          : Array.isArray(val.songs)
            ? val.songs
            : [];
        for (const t of songs) {
          pushTrack(t, true);
          if (secondWaveSeeds.length < 10 && !userOwnedTracksMap.has(t.id)) {
            secondWaveSeeds.push(t);
          }
        }
        for (const ap of (val.appearances ?? []) as Track[]) {
          if (isBrokenOrSyntheticTrack(ap)) continue;
          for (const co of ap.artists ?? []) addAllowedArtist(co.name);
          if (!recentReleasesMap.has(ap.id)) recentReleasesMap.set(ap.id, ap);
          pushTrack(ap, true);
        }
        for (const al of [...(val.singles ?? []), ...(val.albums ?? [])] as AlbumSummary[]) {
          pushAlbum(al, true);
          if (
            !fetchedAlbumIds.has(al.id) &&
            isReleaseDateInWindow(al.releaseDate, rolling30Win.startIso, rolling30Win.endIso)
          ) {
            fetchedAlbumIds.add(al.id);
            emergingWeeklyAlbums.push(al);
          }
        }
        for (const rel of val.relatedArtists ?? []) {
          addAllowedArtist(rel.name);
          const rk = normalizeArtistKey(rel.name);
          if (
            rk &&
            !seenCoreKeys.has(rk) &&
            !seenEmergingKeys.has(rk) &&
            !secondDegreeEmerging.has(rk)
          ) {
            secondDegreeEmerging.set(rk, { id: rel.id, name: rel.name });
          }
        }
      }

      // Wave 3: Only fetch deeper discovery graph if catalog is still under 120 tracks (bounded 1.8s)
      const wave3AlbumBatch =
        collectedTrackMap.size < 120 && typeof this.musicProvider.getAlbum === 'function'
          ? emergingWeeklyAlbums.slice(0, 4)
          : [];
      const wave3RelatedSeeds = collectedTrackMap.size < 120 ? secondWaveSeeds.slice(0, 4) : [];
      const wave3SecondDegArtists =
        collectedTrackMap.size < 120
          ? seededShuffle(Array.from(secondDegreeEmerging.values()), `deg2:${dailyKey}`).slice(0, 4)
          : [];

      if (wave3AlbumBatch.length > 0 || wave3RelatedSeeds.length > 0 || wave3SecondDegArtists.length > 0) {
        const [emgAlbumRes, relSeedRes, deg2Res] = await Promise.all([
          wave3AlbumBatch.length > 0
            ? withTimeout(
                Promise.allSettled(wave3AlbumBatch.map((al) => this.musicProvider!.getAlbum!(al.id, signal))),
                1800
              ).then((r) => r ?? [])
            : Promise.resolve([] as PromiseSettledResult<any>[]),
          wave3RelatedSeeds.length > 0
            ? withTimeout(
                Promise.allSettled(wave3RelatedSeeds.map((t) => this.musicProvider!.getRelated(t.id, signal))),
                1800
              ).then((r) => r ?? [])
            : Promise.resolve([] as PromiseSettledResult<any>[]),
          wave3SecondDegArtists.length > 0
            ? withTimeout(
                Promise.allSettled(
                  wave3SecondDegArtists.map((a) =>
                    typeof this.musicProvider!.getArtist === 'function'
                      ? this.musicProvider!.getArtist!(a.id || a.name, signal, { name: a.name })
                      : this.musicProvider!.search(a.name, 'song', signal)
                  )
                ),
                1800
              ).then((r) => r ?? [])
            : Promise.resolve([] as PromiseSettledResult<any>[]),
        ]);

        for (let i = 0; i < emgAlbumRes.length; i++) {
          const r = emgAlbumRes[i]!;
          if (r.status === 'fulfilled' && r.value) {
            stampAlbumTracks(r.value, wave3AlbumBatch[i]);
          }
        }
        for (const r of relSeedRes) {
          if (r.status !== 'fulfilled' || !r.value) continue;
          for (const t of r.value.tracks ?? []) {
            for (const a of t.artists ?? []) addAllowedArtist(a.name);
            pushTrack(t, true);
          }
        }
        for (const r of deg2Res) {
          if (r.status !== 'fulfilled' || !r.value) continue;
          const val = r.value as any;
          const songs: Track[] = Array.isArray(val.topSongs)
            ? val.topSongs
            : Array.isArray(val.songs)
              ? val.songs
              : [];
          for (const t of songs) {
            for (const a of t.artists ?? []) addAllowedArtist(a.name);
            pushTrack(t, true);
          }
        }
      }

      // Offline / jsdom cold-start safety net: only when library has no taste or live artist lookup yielded 0 tracks
      const isTotallyOffline = collectedTrackMap.size === 0;
      if (isTotallyOffline || (!hasRealUserTaste && collectedTrackMap.size < 8)) {
        if (typeof this.musicProvider.getHomeFeed === 'function') {
          const fallbackFeed = await this.musicProvider.getHomeFeed(undefined, signal).catch(() => null);
          for (const shelf of fallbackFeed?.shelves ?? []) {
            for (const item of shelf.items ?? []) {
              if (item && typeof item === 'object' && 'durationSec' in item && 'title' in item) {
                pushTrack(item as Track, true, isTotallyOffline);
              }
            }
          }
        }
        if (collectedTrackMap.size < 8 && !hasRealUserTaste) {
          const seedSearch = await this.musicProvider.search(topArtist1, 'song', signal).catch(() => null);
          for (const t of seedSearch?.songs ?? []) {
            pushTrack(t, true, isTotallyOffline);
          }
        }
      }
    }

    const catalogSongs = this.rerankTracks(Array.from(collectedTrackMap.values()), {
      maxPerArtistInWindow: 3,
      limit: 460,
    });
    const catalogAlbums = collectedAlbums
      .sort((a, b) => {
        const da = a.releaseDate ?? `${a.year ?? 0}-01-01`;
        const db = b.releaseDate ?? `${b.year ?? 0}-01-01`;
        return db.localeCompare(da);
      })
      .slice(0, 14);

    const heardIds = new Set(this.history.map((h) => h.trackId));
    const heardKeys = new Set(this.history.map((h) => makeTrackKey(h.track)));
    const isUnheard = (t: Track): boolean => {
      if (heardIds.has(t.id)) return false;
      return !heardKeys.has(makeTrackKey(t));
    };
    const isInUserLibrary = (t: Track): boolean =>
      userOwnedTracksMap.has(t.id) || userOwnedKeys.has(makeTrackKey(t));

    // Escuchar de nuevo
    const listenAgainTracks: Track[] = [];
    const seenListenIds = new Set<string>();
    const hasLiveCatalog = catalogSongs.some((t) => !isBrokenOrSyntheticTrack(t));

    for (const h of this.history) {
      if (
        h.signalType !== 'skip_early' &&
        !seenListenIds.has(h.track.id) &&
        (!hasLiveCatalog || !isBrokenOrSyntheticTrack(h.track))
      ) {
        seenListenIds.add(h.track.id);
        listenAgainTracks.push(h.track);
      }
    }
    for (const t of [...this.userLikedTracks, ...catalogSongs]) {
      if (!seenListenIds.has(t.id) && listenAgainTracks.length < 8) {
        seenListenIds.add(t.id);
        listenAgainTracks.push(t);
      }
    }

    const matchArtistInList = (track: Track, targets: readonly string[]): boolean => {
      const targetNorms = targets.map((t) => normalizeArtistKey(t)).filter(Boolean);
      return track.artists.some((a) => {
        const ak = normalizeArtistKey(a.name);
        return targetNorms.some((tk) => isSameArtistAlias(ak, tk));
      });
    };

    const pickDistinctMixTracks = (
      primaryPool: readonly Track[],
      fallbackPool: readonly Track[],
      seed: string,
      maxCount: number,
      sharedUsedIds?: Set<string>,
      sharedUsedKeys?: Set<string>,
      maxPerArtist = 4
    ): Track[] => {
      const shuffledPrimary = seededShuffle(primaryPool, seed);
      const shuffledFallback = seededShuffle(fallbackPool, `${seed}:fb`);
      const out: Track[] = [];
      const localIds = new Set<string>();
      const localKeys = new Set<string>();
      const artistCounts = new Map<string, number>();

      const addList = (list: readonly Track[], enforceArtistCap: boolean) => {
        for (const t of list) {
          if (!t?.id) continue;
          if (localIds.has(t.id) || sharedUsedIds?.has(t.id)) continue;
          const k = makeTrackKey(t);
          if (localKeys.has(k) || sharedUsedKeys?.has(k)) continue;
          const pArtist = normalizeArtistKey(t.artists[0]?.name ?? '');
          if (enforceArtistCap && pArtist && (artistCounts.get(pArtist) ?? 0) >= maxPerArtist) {
            continue;
          }
          localIds.add(t.id);
          localKeys.add(k);
          sharedUsedIds?.add(t.id);
          sharedUsedKeys?.add(k);
          if (pArtist) artistCounts.set(pArtist, (artistCounts.get(pArtist) ?? 0) + 1);
          out.push(t);
          if (out.length >= maxCount) return;
        }
      };

      addList(shuffledPrimary, true);
      if (out.length < maxCount) addList(shuffledFallback, true);
      if (out.length < maxCount) addList([...shuffledPrimary, ...shuffledFallback], false);
      return out;
    };

    // 1. Descubre lo Nuevo (Rolling 15-day window before today, including guest feat/collabs & radar drops)
    const favArtistKeysForScoring = new Set(
      Array.from(this.favoriteArtists.values()).map((fa) => normalizeArtistKey(fa.artistName))
    );
    const hasKeyInSet = (ak: string, set: Set<string>): boolean => {
      if (!ak) return false;
      if (set.has(ak)) return true;
      for (const k of set) {
        if (isSameArtistAlias(ak, k)) return true;
      }
      return false;
    };

    const recentPoolMap = new Map<string, Track>();
    for (const t of recentReleasesMap.values()) {
      if (!isBrokenOrSyntheticTrack(t)) recentPoolMap.set(t.id, t);
    }
    for (const t of catalogSongs) {
      if (!isBrokenOrSyntheticTrack(t) && (!hasRealUserTaste || isAllowedTrack(t)) && !recentPoolMap.has(t.id)) {
        recentPoolMap.set(t.id, t);
      }
    }
    const allDatedPool = Array.from(recentPoolMap.values());
    const rolling15Tracks = allDatedPool.filter((t) =>
      isReleaseDateInWindow(t.releaseDate, rollingWin.startIso, rollingWin.endIso)
    );
    const used30Fallback = rolling15Tracks.length === 0;
    const strictRecentTracks = used30Fallback
      ? allDatedPool.filter((t) =>
          isReleaseDateInWindow(t.releaseDate, rolling30Win.startIso, rolling30Win.endIso)
        )
      : rolling15Tracks;

    const nowDayMs = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const scoreRecentRelease = (t: Track): number => {
      let sc = 0;
      let hasTier1 = false;
      let hasFav = false;
      let hasTier2 = false;
      let hasScene = false;
      let isAllowedEditorial = isAllowedTrack(t);
      for (const a of t.artists) {
        const subNames = a.name.split(/\s*(?:,|&|\bfeat\.?\b|\bft\.?\b|\bcon\b)\s*/i);
        const candidatesForArtist = subNames.length > 1 ? [a.name, ...subNames] : [a.name];
        for (const candName of candidatesForArtist) {
          const ak = normalizeArtistKey(candName);
          if (!ak) continue;
          if (hasKeyInSet(ak, favArtistKeysForScoring)) {
            hasFav = true;
            hasTier1 = true;
          } else if (hasKeyInSet(ak, seenCoreKeys)) {
            hasTier1 = true;
          } else if (hasKeyInSet(ak, allowedTasteKeys)) {
            hasTier2 = true;
          }
          if (
            KNOWN_ES_SCENE_ARTISTS.has(ak) ||
            Array.from(KNOWN_ES_SCENE_ARTISTS).some((sk) => isSameArtistAlias(ak, sk))
          ) {
            hasScene = true;
          }
        }
      }
      if (hasTier1) sc += 45;
      if (hasFav) sc += 15;
      else if (!hasTier1 && hasTier2) sc += 20;
      else if (!hasTier1 && !hasTier2 && hasScene) sc += 12;
      else if (!hasTier1 && !hasTier2 && !hasScene && isAllowedEditorial) sc += 8;
      else if (!hasTier1 && !hasTier2 && !hasScene) sc += 2;
      if (isUnheard(t)) sc += 14;
      const primaryKey = normalizeArtistKey(t.artists[0]?.name ?? '');
      if (t.artists.length > 1 || (hasTier1 && !hasKeyInSet(primaryKey, seenCoreKeys))) {
        sc += 10;
      }
      const iso = (t.releaseDate ?? '').slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
        const parts = iso.split('-').map((n) => Number.parseInt(n, 10));
        const relMs = new Date(parts[0]!, (parts[1]! || 1) - 1, parts[2]! || 1).getTime();
        const daysSince = Math.max(0, Math.floor((nowDayMs - relMs) / 86_400_000));
        sc += Math.max(0, 30 - daysSince * 2);
      }
      return sc;
    };

    const orderedRecent = [...strictRecentTracks].sort((a, b) => {
      const diff = scoreRecentRelease(b) - scoreRecentRelease(a);
      if (diff !== 0) return diff;
      return (b.releaseDate ?? '').localeCompare(a.releaseDate ?? '');
    });
    const seenRecentIds = new Set<string>();
    const seenRecentKeys = new Set<string>();
    const recentArtistCounts = new Map<string, number>();
    const radarTracks: Track[] = [];
    for (const t of orderedRecent) {
      if (!t?.id || seenRecentIds.has(t.id)) continue;
      const tk = makeTrackKey(t);
      if (tk !== '::' && seenRecentKeys.has(tk)) continue;
      const pArtist = normalizeArtistKey(t.artists[0]?.name ?? '');
      if (pArtist && (recentArtistCounts.get(pArtist) ?? 0) >= 3) continue;
      seenRecentIds.add(t.id);
      if (tk !== '::') seenRecentKeys.add(tk);
      if (pArtist) recentArtistCounts.set(pArtist, (recentArtistCounts.get(pArtist) ?? 0) + 1);
      radarTracks.push(t);
      if (radarTracks.length >= 50) break;
    }

    // 2. Daily Mix (100 songs: ~40 from user's playlists/likes/history + ~60 personalized recommendations)
    const DAILY_TARGET = 100;
    const usedDailyMixIds = new Set<string>();
    const usedDailyMixKeys = new Set<string>();

    const freshDiscoveries = catalogSongs.filter((t) => !isInUserLibrary(t));
    const familiarPool = catalogSongs.filter((t) => isInUserLibrary(t));

    const familiarQuota = Math.min(40, familiarPool.length);
    const familiarSlice = pickDistinctMixTracks(
      familiarPool,
      userOwnedTracks,
      `dailymix:fam:${dailyKey}`,
      familiarQuota,
      usedDailyMixIds,
      usedDailyMixKeys,
      5
    );
    const freshSlice = pickDistinctMixTracks(
      freshDiscoveries,
      catalogSongs,
      `dailymix:fresh:${dailyKey}`,
      DAILY_TARGET - familiarSlice.length,
      usedDailyMixIds,
      usedDailyMixKeys,
      4
    );

    const dailyMixTracks: Track[] = [];
    let fIdx = 0;
    let nIdx = 0;
    while (dailyMixTracks.length < DAILY_TARGET && (fIdx < familiarSlice.length || nIdx < freshSlice.length)) {
      for (let k = 0; k < 2 && fIdx < familiarSlice.length && dailyMixTracks.length < DAILY_TARGET; k++) {
        dailyMixTracks.push(familiarSlice[fIdx++]!);
      }
      for (let k = 0; k < 3 && nIdx < freshSlice.length && dailyMixTracks.length < DAILY_TARGET; k++) {
        dailyMixTracks.push(freshSlice[nIdx++]!);
      }
    }

    // 3. Daily Discover (100 songs: STRICTLY NOT in user's playlists/likes AND NOT previously listened,
    // prioritizing emerging & adventurous adjacent styles aligned with user taste!)
    const strictlyUnheardPool = catalogSongs.filter(
      (t) => !isInUserLibrary(t) && isUnheard(t) && !usedDailyMixIds.has(t.id) && !usedDailyMixKeys.has(makeTrackKey(t))
    );
    const adventurousEmerging = strictlyUnheardPool.filter(
      (t) => !seenCoreKeys.has(normalizeArtistKey(t.artists[0]?.name ?? ''))
    );
    const coreUnheardFallback = strictlyUnheardPool.filter((t) =>
      seenCoreKeys.has(normalizeArtistKey(t.artists[0]?.name ?? ''))
    );

    const dailyDiscoverTracks = pickDistinctMixTracks(
      adventurousEmerging,
      coreUnheardFallback,
      `discover100:${dailyKey}`,
      DAILY_TARGET,
      usedDailyMixIds,
      usedDailyMixKeys,
      3
    );

    const mixes: HomeEditorialMix[] = [
      {
        id: 'mix_descubre_lo_nuevo',
        title: 'Descubre lo Nuevo',
        subtitle:
          radarTracks.length > 0 && !used30Fallback
            ? `Estrenos y colaboraciones de los últimos 15 días (${rollingWin.rangeLabel}) · Actualizada cada día`
            : radarTracks.length > 0
              ? `Estrenos y colaboraciones de los últimos 30 días (${rolling30Win.rangeLabel}) · Actualizada cada día`
              : 'Sin estrenos recientes detectados todavía · Actualizada cada día',
        badge: used30Fallback ? 'ÚLTIMOS 30 DÍAS' : 'ÚLTIMOS 15 DÍAS',
        coverUrl:
          radarTracks[0]?.thumbnailHighUrl ??
          radarTracks[0]?.thumbnailUrl ??
          catalogSongs[0]?.thumbnailUrl ??
          '',
        accentColor: MIX_PALETTES[4]!,
        tracks: radarTracks,
      },
      {
        id: 'mix_daily_mix',
        title: 'Daily Mix',
        subtitle: `${topArtist1}, ${topArtist2}, ${topArtist3} y recomendaciones para ti · ${dailyMixTracks.length} temas`,
        badge: 'DAILY MIX',
        coverUrl:
          dailyMixTracks[0]?.thumbnailHighUrl ??
          dailyMixTracks[0]?.thumbnailUrl ??
          catalogSongs[0]?.thumbnailUrl ??
          '',
        accentColor: MIX_PALETTES[0]!,
        tracks: dailyMixTracks,
      },
      {
        id: 'mix_daily_discover',
        title: 'Daily Discover',
        subtitle: `${dailyDiscoverTracks.length} descubrimientos inéditos, emergentes y nuevos sonidos para ti`,
        badge: 'DAILY DISCOVER',
        coverUrl:
          dailyDiscoverTracks[0]?.thumbnailHighUrl ??
          dailyDiscoverTracks[0]?.thumbnailUrl ??
          catalogSongs[1]?.thumbnailUrl ??
          '',
        accentColor: MIX_PALETTES[1]!,
        tracks: dailyDiscoverTracks,
      },
    ];

    // 4. Bold general personalized discovery across ALL user music + emerging artists
    // (replaces single-artist "Porque escuchaste a SAIKO")
    const boldPool = catalogSongs.filter((t) => !isInUserLibrary(t) && isUnheard(t));
    const boldDiscoverTracks = pickDistinctMixTracks(
      boldPool.length >= 8 ? boldPool : freshDiscoveries,
      catalogSongs,
      `discover:${dailyKey}`,
      16,
      undefined,
      undefined,
      2
    );

    const shelves: HomeEditorialShelf[] = [
      {
        id: 'shelf_listen_again',
        kind: 'listen_again',
        title: 'Escuchar de nuevo',
        subtitle: 'Tus temas recientes y favoritos al instante',
        tracks: listenAgainTracks.slice(0, 8),
      },
      {
        id: 'shelf_mixes_for_you',
        kind: 'mixes_for_you',
        title: 'Mixes para ti',
        subtitle: 'Estrenos de los últimos 15 días, tu Daily Mix y Daily Discover de 100 temas',
        mixes,
      },
      {
        id: 'shelf_because_you_listened',
        kind: 'because_you_listened',
        title: 'Recomendado para ti',
        subtitle: 'Descubrimientos y artistas emergentes basados en toda tu música',
        tracks: boldDiscoverTracks.slice(0, 12),
      },
      {
        id: 'shelf_favorite_new_releases',
        kind: 'favorite_new_releases',
        title: 'Álbumes para ti',
        subtitle: `Discos esenciales de ${topArtist1}, ${topArtist2} y tu escena`,
        albums: catalogAlbums,
        tracks: (radarTracks.length > 0 ? radarTracks : freshDiscoveries).slice(0, 8),
      },
    ];

    return shelves;
  }

  public async updateSeedArtists(seeds: SeedArtistConfig[]): Promise<void> {
    this.seeds.clear();
    for (const s of seeds) {
      const key = normalizeArtistKey(s.displayName);
      if (!key) continue;
      this.seeds.set(key, {
        ...s,
        artistKey: key,
      });
    }
    if (this.storage?.saveSeeds) {
      await this.storage.saveSeeds(Array.from(this.seeds.values()));
    }
  }

  public getSeedArtists(): SeedArtistConfig[] {
    return Array.from(this.seeds.values());
  }

  public getAffinityProfile(): ArtistAffinityRecord[] {
    const nowMs = Date.now();
    const merged = new Map<string, ArtistAffinityRecord>();

    for (const seed of this.seeds.values()) {
      merged.set(seed.artistKey, {
        artistKey: seed.artistKey,
        artistName: seed.displayName,
        artistId: seed.artistId,
        score: this.getEffectiveAffinity(seed.displayName, nowMs),
        genres: [...seed.genres],
        playCount: 0,
        skipCount: 0,
        isSeed: true,
        updatedAt: new Date(nowMs).toISOString(),
      });
    }

    for (const [key, rec] of this.affinities.entries()) {
      merged.set(key, {
        ...rec,
        score: this.getEffectiveAffinity(rec.artistName, nowMs),
      });
    }

    return Array.from(merged.values()).sort((a, b) => b.score - a.score);
  }

  public async clearPlayHistory(): Promise<void> {
    this.history = [];
    if (this.storage) {
      await this.storage.saveHistory([]);
    }
  }

  public async resetTastes(): Promise<void> {
    this.affinities.clear();
    this.history = [];
    this.seeds.clear();
    for (const seed of DEFAULT_SPANISH_URBAN_SEEDS) {
      const key = normalizeArtistKey(seed.displayName);
      this.seeds.set(key, { ...seed, artistKey: key });
    }
    if (this.storage) {
      await Promise.all([
        this.storage.saveAffinities([]),
        this.storage.saveHistory([]),
        this.storage.saveSeeds ? this.storage.saveSeeds(Array.from(this.seeds.values())) : Promise.resolve(),
      ]);
    }
  }

  private getRankedArtists(): Array<{ key: string; name: string; affinity: number }> {
    const names = new Map<string, string>();
    for (const s of this.seeds.values()) {
      names.set(s.artistKey, s.displayName);
    }
    for (const a of this.affinities.values()) {
      names.set(a.artistKey, a.artistName);
    }
    const nowMs = Date.now();
    return Array.from(names.entries())
      .map(([key, name]) => ({
        key,
        name,
        affinity: this.getEffectiveAffinity(name, nowMs),
      }))
      .sort((a, b) => b.affinity - a.affinity);
  }
}
