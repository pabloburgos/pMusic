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
  musicProvider?: Pick<IMusicProvider, 'search' | 'getHomeFeed' | 'getUpNext' | 'getRelated'>;
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
  'kaze', 'hard gz', 'delao', 'hoke', 'ill pekeño', 'ill pequeno', 'ergo pro', 'disobey',
  'yunq beef', 'yung beef', 'sticky ma', 'rojuu', 'claudia', 'maikel delacalle',
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
  private readonly musicProvider?: Pick<
    IMusicProvider,
    'search' | 'getHomeFeed' | 'getUpNext' | 'getRelated'
  >;
  private readonly storage?: RecommendationStorageAdapter;
  private readonly onAffinityUpdated?: (record: ArtistAffinityRecord) => void;
  private readonly onHistoryRecorded?: (record: PlayHistoryRecord) => void;

  private seeds = new Map<string, SeedArtistConfig>();
  private affinities = new Map<string, ArtistAffinityRecord>();
  private favoriteArtists = new Map<string, FavoriteArtistRecord>();
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
    const thursdayKey = getThursdayNoonCycleKey(now);
    const currentYear = now.getFullYear();

    const favNames = Array.from(this.favoriteArtists.values()).map((a) => a.artistName);
    const rankedArtists = this.getRankedArtists();
    const mergedTopNames: string[] = [];
    const seenArtistKeys = new Set<string>();
    const pushTopArtist = (name?: string) => {
      if (!name) return;
      const k = normalizeArtistKey(name);
      if (!k || seenArtistKeys.has(k)) return;
      seenArtistKeys.add(k);
      mergedTopNames.push(name);
    };
    for (const fn of favNames) pushTopArtist(fn);
    for (const ra of rankedArtists) pushTopArtist(ra.name);
    for (const def of ['Cruzzi', 'La Pantera', 'Bad Bunny', 'Quevedo', 'Rels B', 'Saiko']) {
      pushTopArtist(def);
    }

    const topArtist1 = mergedTopNames[0] ?? 'Cruzzi';
    const topArtist2 = mergedTopNames[1] ?? 'La Pantera';
    const topArtist3 = mergedTopNames[2] ?? 'Bad Bunny';
    const topArtist4 = mergedTopNames[3] ?? 'Quevedo';
    const topArtist5 = mergedTopNames[4] ?? 'Rels B';

    let catalogSongs: Track[] = [];
    let catalogAlbums: AlbumSummary[] = [];
    let releaseRadarSongs: Track[] = [];

    if (this.musicProvider) {
      const queries = Array.from(new Set(['', topArtist1, topArtist2, topArtist3, topArtist4]));
      const radarQueries = [
        `${topArtist1} ${currentYear}`,
        `${topArtist2} ${currentYear}`,
        `${topArtist3} nuevo`,
      ];
      const [mainBundles, radarBundles] = await Promise.all([
        Promise.all(
          queries.map((q) => this.musicProvider!.search(q, 'all', signal).catch(() => null))
        ),
        Promise.all(
          radarQueries.map((q) => this.musicProvider!.search(q, 'song', signal).catch(() => null))
        ),
      ]);
      const ok = mainBundles.filter((b): b is NonNullable<typeof b> => Boolean(b));
      const seen = new Set<string>();
      const merged: Track[] = [];
      const maxLen = Math.max(0, ...ok.map((b) => b.songs.length));
      for (let i = 0; i < maxLen; i++) {
        for (const b of ok) {
          const s = b.songs[i];
          if (s && !seen.has(s.id)) {
            seen.add(s.id);
            merged.push(s);
          }
        }
      }
      catalogSongs = this.rerankTracks(merged);
      catalogAlbums = ok
        .flatMap((b) => b.albums)
        .filter((a, i, arr) => arr.findIndex((x) => x.id === a.id) === i)
        .sort((a, b) => (b.year ?? 0) - (a.year ?? 0))
        .slice(0, 12);

      const okRadar = radarBundles.filter((b): b is NonNullable<typeof b> => Boolean(b));
      const radarSeen = new Set<string>();
      const radarRaw: Track[] = [];
      for (const b of okRadar) {
        for (const s of b.songs) {
          if (s?.id && !radarSeen.has(s.id)) {
            radarSeen.add(s.id);
            radarRaw.push(s);
          }
        }
      }
      releaseRadarSongs = this.rerankTracks(radarRaw);
    }

    const heardIds = new Set(this.history.map((h) => h.trackId));
    const heardKeys = new Set(
      this.history.map(
        (h) => `${normalizeSearchText(h.track.title)}::${normalizeArtistKey(h.track.artists[0]?.name ?? '')}`
      )
    );
    const isUnheard = (t: Track): boolean => {
      if (heardIds.has(t.id)) return false;
      const k = `${normalizeSearchText(t.title)}::${normalizeArtistKey(t.artists[0]?.name ?? '')}`;
      return !heardKeys.has(k);
    };

    const listenAgainTracks: Track[] = [];
    const seenIds = new Set<string>();
    const hasLiveCatalog = catalogSongs.some((t) => !isBrokenOrSyntheticTrack(t));

    for (const h of this.history) {
      if (
        h.signalType !== 'skip_early' &&
        !seenIds.has(h.track.id) &&
        (!hasLiveCatalog || !isBrokenOrSyntheticTrack(h.track))
      ) {
        seenIds.add(h.track.id);
        listenAgainTracks.push(h.track);
      }
    }
    for (const t of catalogSongs) {
      if (!seenIds.has(t.id) && listenAgainTracks.length < 8) {
        seenIds.add(t.id);
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
      maxCount = 14
    ): Track[] => {
      const shuffledPrimary = seededShuffle(primaryPool, seed);
      const shuffledFallback = seededShuffle(fallbackPool, `${seed}:fb`);
      const out: Track[] = [];
      const localIds = new Set<string>();
      const localKeys = new Set<string>();
      const addList = (list: readonly Track[]) => {
        for (const t of list) {
          if (!t?.id || localIds.has(t.id)) continue;
          const k = `${normalizeSearchText(t.title)}::${normalizeArtistKey(t.artists[0]?.name ?? '')}`;
          if (localKeys.has(k)) continue;
          localIds.add(t.id);
          localKeys.add(k);
          out.push(t);
          if (out.length >= maxCount) return;
        }
      };
      addList(shuffledPrimary);
      if (out.length < maxCount) addList(shuffledFallback);
      return out;
    };

    // 1. Descubre lo Nuevo (Weekly refresh every Thursday 12:00)
    const radarCombined = [...releaseRadarSongs, ...catalogSongs]
      .sort((a, b) => (b.releaseYear ?? 0) - (a.releaseYear ?? 0));
    const unheardRadar = radarCombined.filter(isUnheard);
    const radarTracks = pickDistinctMixTracks(
      unheardRadar.length >= 6 ? unheardRadar : radarCombined,
      catalogSongs,
      `radar:${thursdayKey}`,
      16
    );

    // 2. Daily Mix 1 — Core favorite & top affinity cluster
    const mix1Cluster = catalogSongs.filter((t) =>
      matchArtistInList(t, [topArtist1, topArtist3])
    );
    const mix1Tracks = pickDistinctMixTracks(
      mix1Cluster.length >= 4 ? mix1Cluster : catalogSongs,
      catalogSongs,
      `daily1:${dailyKey}`,
      14
    );

    // 3. Daily Mix 2 — Second distinct style / scene cluster
    const mix2Cluster = catalogSongs.filter(
      (t) =>
        matchArtistInList(t, [topArtist2, topArtist4]) &&
        !mix1Tracks.slice(0, 4).some((m) => m.id === t.id)
    );
    const mix2Tracks = pickDistinctMixTracks(
      mix2Cluster.length >= 4 ? mix2Cluster : catalogSongs.filter((t) => !matchArtistInList(t, [topArtist1])),
      catalogSongs,
      `daily2:${dailyKey}`,
      14
    );

    // 4. Daily Mix 3 — Discovery / third style blend
    const mix3Cluster = catalogSongs.filter(
      (t) =>
        matchArtistInList(t, [topArtist4, topArtist5]) ||
        (!matchArtistInList(t, [topArtist1, topArtist2]) && isUnheard(t))
    );
    const mix3Tracks = pickDistinctMixTracks(
      mix3Cluster.length >= 4 ? mix3Cluster : [...catalogSongs].reverse(),
      catalogSongs,
      `daily3:${dailyKey}`,
      14
    );

    const mixes: HomeEditorialMix[] = [
      {
        id: 'mix_descubre_lo_nuevo',
        title: 'Descubre lo Nuevo',
        subtitle: `Novedades de ${topArtist1}, ${topArtist2} y tu escena · Jueves 12:00`,
        badge: 'JUEVES 12:00',
        coverUrl:
          radarTracks[0]?.thumbnailHighUrl ??
          radarTracks[0]?.thumbnailUrl ??
          catalogSongs[0]?.thumbnailUrl ??
          '',
        accentColor: MIX_PALETTES[4]!,
        tracks: radarTracks,
      },
      {
        id: 'mix_daily_1',
        title: 'Daily Mix 1',
        subtitle: `${topArtist1}, ${topArtist3} y favoritos de hoy`,
        badge: 'DAILY MIX',
        coverUrl:
          mix1Tracks[0]?.thumbnailHighUrl ??
          mix1Tracks[0]?.thumbnailUrl ??
          catalogSongs[0]?.thumbnailUrl ??
          '',
        accentColor: MIX_PALETTES[0]!,
        tracks: mix1Tracks,
      },
      {
        id: 'mix_daily_2',
        title: 'Daily Mix 2',
        subtitle: `${topArtist2}, ${topArtist4} y vibes alternativos`,
        badge: 'DAILY MIX',
        coverUrl:
          mix2Tracks[0]?.thumbnailHighUrl ??
          mix2Tracks[0]?.thumbnailUrl ??
          catalogSongs[2]?.thumbnailUrl ??
          '',
        accentColor: MIX_PALETTES[1]!,
        tracks: mix2Tracks,
      },
      {
        id: 'mix_daily_3',
        title: 'Daily Mix 3',
        subtitle: `${topArtist4}, ${topArtist5} y descubrimientos del día`,
        badge: 'DAILY MIX',
        coverUrl:
          mix3Tracks[0]?.thumbnailHighUrl ??
          mix3Tracks[0]?.thumbnailUrl ??
          catalogSongs[4]?.thumbnailUrl ??
          '',
        accentColor: MIX_PALETTES[2]!,
        tracks: mix3Tracks,
      },
    ];

    const anchorArtist =
      this.history.find(
        (h) => h.signalType !== 'skip_early' && !isBrokenOrSyntheticTrack(h.track)
      )?.track.artists[0]?.name ?? topArtist1;

    const anchorNorm = normalizeArtistKey(anchorArtist);
    const artistSpecificSongs = catalogSongs.filter((t) =>
      t.artists.some((a) => isSameArtistAlias(normalizeArtistKey(a.name), anchorNorm))
    );
    const restSongs = catalogSongs.filter(
      (t) => !artistSpecificSongs.some((as) => as.id === t.id)
    );
    const becauseTracks =
      artistSpecificSongs.length > 0
        ? [...artistSpecificSongs, ...this.rerankTracks(restSongs)]
        : this.rerankTracks(catalogSongs.length > 0 ? catalogSongs : listenAgainTracks);

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
        subtitle: 'Recomendados según tu estilo · Actualizados cada día',
        mixes,
      },
      {
        id: 'shelf_because_you_listened',
        kind: 'because_you_listened',
        title: `Porque escuchaste a ${anchorArtist}`,
        subtitle: 'Recomendaciones adaptadas a tu estilo',
        anchorArtist,
        tracks: becauseTracks.slice(0, 8),
      },
      {
        id: 'shelf_favorite_new_releases',
        kind: 'favorite_new_releases',
        title: 'Novedades de tus artistas favoritos',
        subtitle: `Lanzamientos destacados de ${topArtist1}, ${topArtist2} y ${topArtist3}`,
        albums: catalogAlbums,
        tracks: radarTracks.slice(0, 8),
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
