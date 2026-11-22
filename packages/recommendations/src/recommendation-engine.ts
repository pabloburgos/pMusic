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
  type AutocompleteSuggestion,
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
      this.history = storedHistory;
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

  public getEffectiveAffinity(artistName: string, nowMs = Date.now()): number {
    const key = normalizeArtistKey(artistName);
    if (!key) return 0;

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
      return Number(clampAffinityScore(seedBoost).toFixed(3));
    }

    const updatedMs = Date.parse(record.updatedAt);
    const elapsedDays = Number.isFinite(updatedMs)
      ? Math.max(0, (nowMs - updatedMs) / 86_400_000)
      : 0;
    const decayedDynamic = computeDecayedScore(record.score, elapsedDays, AFFINITY_HALF_LIFE_DAYS);

    return Number(
      Math.max(
        AFFINITY_SCORE_MIN,
        Math.min(AFFINITY_SCORE_MAX, decayedDynamic + seedBoost)
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

      return {
        track,
        primaryArtistKey: normalizeArtistKey(track.artists[0]?.name ?? ''),
        score: artistScore + genreBonus + skipPenalty + positionBonus,
      };
    });

    scored.sort((a, b) => b.score - a.score);

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

  public selectBestResult(
    query: string,
    bundle: SearchResultBundle
  ): TopResultMatch | undefined {
    const normQuery = normalizeSearchText(query);

    let bestCandidate: TopResultMatch | undefined = bundle.topResult;
    let bestScore = -Infinity;

    for (const artist of bundle.artists) {
      const normName = normalizeSearchText(artist.name);
      const exact = normQuery.length > 0 && normName === normQuery ? 12 : 0;
      const partial =
        normQuery.length > 0 && (normName.includes(normQuery) || normQuery.includes(normName))
          ? 6
          : 0;
      const affinity = this.getEffectiveAffinity(artist.name);
      const score = exact + partial + affinity;
      if (score > bestScore) {
        bestScore = score;
        bestCandidate = { kind: 'artist', item: artist };
      }
    }

    for (const song of bundle.songs) {
      const normTitle = normalizeSearchText(song.title);
      const exactTitle = normQuery.length > 0 && normTitle === normQuery ? 11 : 0;
      const partialTitle = normQuery.length > 0 && normTitle.includes(normQuery) ? 5 : 0;
      const artistAffinity = song.artists.reduce(
        (m, a) => Math.max(m, this.getEffectiveAffinity(a.name)),
        0
      );
      const score = exactTitle + partialTitle + artistAffinity * 0.85;
      if (score > bestScore) {
        bestScore = score;
        bestCandidate = { kind: 'song', item: song };
      }
    }

    for (const album of bundle.albums) {
      const normTitle = normalizeSearchText(album.title);
      const exactAlbum = normQuery.length > 0 && normTitle === normQuery ? 9 : 0;
      const artistAffinity = album.artists.reduce(
        (m, a) => Math.max(m, this.getEffectiveAffinity(a.name)),
        0
      );
      const score = exactAlbum + artistAffinity * 0.7;
      if (score > bestScore) {
        bestScore = score;
        bestCandidate = { kind: 'album', item: album };
      }
    }

    return bestCandidate ?? (bundle.songs[0] ? { kind: 'song', item: bundle.songs[0] } : undefined);
  }

  public async buildHomeShelves(signal?: AbortSignal): Promise<HomeEditorialShelf[]> {
    const rankedArtists = this.getRankedArtists();
    const topArtist1 = rankedArtists[0]?.name ?? 'Cruz Cafuné';
    const topArtist2 = rankedArtists[1]?.name ?? 'La Pantera';
    const topArtist3 = rankedArtists[2]?.name ?? 'Bad Bunny';

    let catalogSongs: Track[] = [];
    let catalogAlbums: AlbumSummary[] = [];

    if (this.musicProvider) {
      const bundles = await Promise.all(
        ['', topArtist1, topArtist2, topArtist3].map((q) =>
          this.musicProvider!.search(q, 'all', signal).catch(() => null)
        )
      );
      const ok = bundles.filter((b): b is NonNullable<typeof b> => Boolean(b));
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
      catalogAlbums = ok.flatMap((b) => b.albums).filter((a, i, arr) => arr.findIndex((x) => x.id === a.id) === i).slice(0, 10);
    }

    const listenAgainTracks: Track[] = [];
    const seenIds = new Set<string>();

    for (const h of this.history) {
      if (h.signalType !== 'skip_early' && !seenIds.has(h.track.id)) {
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

    const mixes: HomeEditorialMix[] = [
      {
        id: 'mix_cruz_urbano_es',
        title: `Mix ${topArtist1}`,
        subtitle: `${topArtist1}, ${topArtist2}, Quevedo y escena urbana ES`,
        coverUrl:
          catalogSongs[0]?.thumbnailUrl ??
          'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=400&q=80',
        accentColor: MIX_PALETTES[0]!,
        tracks: catalogSongs.slice(0, 8),
      },
      {
        id: 'mix_trap_canarias',
        title: `Mix ${topArtist2} & Canarias`,
        subtitle: `${topArtist2}, ${topArtist1}, Juseph y trap isleño`,
        coverUrl:
          catalogSongs[3]?.thumbnailUrl ??
          'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=400&q=80',
        accentColor: MIX_PALETTES[1]!,
        tracks: [...catalogSongs.slice(2), ...catalogSongs.slice(0, 2)],
      },
      {
        id: 'mix_sesion_dj_club',
        title: `Sesión DJ: ${topArtist3} & Urbano`,
        subtitle: `${topArtist3}, Saiko, Morad y himnos de club`,
        coverUrl:
          catalogSongs[5]?.thumbnailUrl ??
          'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=400&q=80',
        accentColor: MIX_PALETTES[2]!,
        tracks: [...catalogSongs].reverse(),
      },
    ];

    const anchorArtist =
      this.history.find((h) => h.signalType !== 'skip_early')?.track.artists[0]?.name ?? topArtist1;

    const becauseTracks = this.rerankTracks(
      catalogSongs.filter((t) =>
        t.artists.some((a) => normalizeArtistKey(a.name) === normalizeArtistKey(anchorArtist))
      ).length > 0
        ? catalogSongs
        : listenAgainTracks
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
        subtitle: 'Generados por tu algoritmo con Modo Sesión DJ',
        mixes,
      },
      {
        id: 'shelf_because_you_listened',
        kind: 'because_you_listened',
        title: `Porque escuchaste a ${anchorArtist}`,
        subtitle: 'Recomendaciones adaptadas a tu perfil urbano',
        anchorArtist,
        tracks: becauseTracks.slice(0, 8),
      },
      {
        id: 'shelf_favorite_new_releases',
        kind: 'favorite_new_releases',
        title: 'Novedades de tus artistas favoritos',
        subtitle: `Lanzamientos destacados de ${topArtist1}, ${topArtist2} y ${topArtist3}`,
        albums: catalogAlbums,
        tracks: catalogSongs.slice(0, 6),
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
