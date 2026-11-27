import {
  normalizeArtistKey,
  normalizeSearchText,
  type AlbumSummary,
  type ArtistAffinityRecord,
  type ArtistSummary,
  type FavoriteArtistRecord,
  type HomeEditorialShelf,
  type PlayHistoryRecord,
  type SearchResultBundle,
  type Track,
} from '@pmusic/core';
import {
  computeBoundedEditDistance,
  scoreFuzzyTokenMatch,
  type SearchPersonalSignals,
} from '@pmusic/recommendations';

export interface InstantRecentItemLike {
  kind: 'track' | 'artist';
  id: string;
  track?: Track;
  artistId?: string;
  name?: string;
  thumbnailUrl?: string;
}

export interface InstantPlaylistLike {
  tracks: readonly Track[];
}

export interface InstantLikedTrackLike {
  trackId: string;
  track: Track;
}

export interface InstantSearchContext {
  likedTracks: readonly InstantLikedTrackLike[];
  playHistory: readonly PlayHistoryRecord[];
  playlists: readonly InstantPlaylistLike[];
  recentSearchItems: readonly InstantRecentItemLike[];
  recentSearches: readonly string[];
  favoriteArtists: readonly FavoriteArtistRecord[];
  homeShelves: readonly HomeEditorialShelf[];
  affinityProfile: readonly ArtistAffinityRecord[];
  cachedBundles?: readonly SearchResultBundle[];
}

function normTokens(input: string): string[] {
  const clean = normalizeSearchText(input)
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return clean ? clean.split(' ') : [];
}

function dedupeTrackKey(t: Track): string {
  return `${normalizeSearchText(t.title)}::${normalizeArtistKey(t.artists[0]?.name ?? '')}`;
}

export function buildPersonalSearchSignals(ctx: {
  likedTracks: readonly InstantLikedTrackLike[];
  playHistory: readonly PlayHistoryRecord[];
  recentSearches: readonly string[];
  recentSearchItems: readonly InstantRecentItemLike[];
  favoriteArtists: readonly FavoriteArtistRecord[];
}): SearchPersonalSignals {
  const likedTrackIds = new Set<string>();
  const personalTracks: Track[] = [];
  const seenPersonalIds = new Set<string>();

  for (const l of ctx.likedTracks) {
    likedTrackIds.add(l.trackId);
    if (l.track && !seenPersonalIds.has(l.track.id)) {
      seenPersonalIds.add(l.track.id);
      personalTracks.push(l.track);
    }
  }

  const playCountsByTrackId = new Map<string, number>();
  for (const h of ctx.playHistory) {
    if (!h.trackId) continue;
    playCountsByTrackId.set(h.trackId, (playCountsByTrackId.get(h.trackId) ?? 0) + 1);
  }

  const recentTrackIds = new Set<string>();
  for (const item of ctx.recentSearchItems) {
    if (item.kind === 'track' && item.track) {
      recentTrackIds.add(item.track.id);
      if (!seenPersonalIds.has(item.track.id)) {
        seenPersonalIds.add(item.track.id);
        personalTracks.push(item.track);
      }
    }
  }

  const favoriteArtistKeys = new Set<string>();
  for (const fa of ctx.favoriteArtists) {
    const k = normalizeArtistKey(fa.artistName);
    if (k) favoriteArtistKeys.add(k);
  }

  return {
    likedTrackIds,
    playCountsByTrackId,
    recentSearchQueries: ctx.recentSearches,
    recentTrackIds,
    favoriteArtistKeys,
    personalTracks: personalTracks.slice(0, 60),
  };
}

function scoreLocalTrack(
  query: string,
  qTokens: readonly string[],
  normQuery: string,
  track: Track
): number {
  const normTitle = normalizeSearchText(track.title);
  const titleWords = new Set(normTokens(track.title));
  const artistNames = track.artists.map((a) => a.name);
  const normArtists = artistNames.map((n) => normalizeSearchText(n)).filter(Boolean);
  const artistWords = new Set(normArtists.flatMap((n) => normTokens(n)));
  const normArtistsJoined = normArtists.join(' ');
  const albumNorm = track.album?.name ? normalizeSearchText(track.album.name) : '';
  const albumWords = new Set(albumNorm ? normTokens(albumNorm) : []);

  let score = 0;
  if (normTitle === normQuery) score += 220;
  else if (normTitle.startsWith(normQuery) && normQuery.length >= 2) score += 130;

  let covered = 0;
  let titleHits = 0;
  let artistHits = 0;
  for (const tok of qTokens) {
    const tSim = scoreFuzzyTokenMatch(tok, titleWords, normTitle);
    const aSim = scoreFuzzyTokenMatch(tok, artistWords, normArtistsJoined);
    const albSim = albumNorm ? scoreFuzzyTokenMatch(tok, albumWords, albumNorm) : 0;
    if (tSim >= 0.68) {
      titleHits++;
      score += Math.round(60 * tSim);
    } else if (tSim > 0) {
      score += Math.round(22 * tSim);
    }
    if (aSim >= 0.68) {
      artistHits++;
      score += Math.round(52 * aSim);
    } else if (aSim > 0) {
      score += Math.round(18 * aSim);
    }
    if (tSim < 0.68 && aSim < 0.68 && albSim >= 0.68) {
      score += 20;
    }
    if (tSim >= 0.68 || aSim >= 0.68 || albSim >= 0.68 || (tok.length >= 3 && (tSim > 0 || aSim > 0))) {
      covered++;
    }
  }

  if (covered === 0) return 0;
  if (covered < qTokens.length && score < 90) return 0;
  if (qTokens.length >= 2 && titleHits >= 1 && artistHits >= 1) score += 140;
  else if (covered === qTokens.length) score += 85;
  return score;
}

export function buildInstantLocalSearchBundle(
  query: string,
  ctx: InstantSearchContext
): SearchResultBundle {
  const trimmed = query.trim();
  const normQuery = normalizeSearchText(trimmed);
  const qTokens = normTokens(trimmed);
  if (!normQuery || qTokens.length === 0) {
    const recs = buildSearchHomeRecommendations(ctx);
    return {
      query,
      topResult: recs.recommendedTracks[0]
        ? { kind: 'song', item: recs.recommendedTracks[0] }
        : recs.recommendedArtists[0]
          ? { kind: 'artist', item: recs.recommendedArtists[0] }
          : undefined,
      songs: recs.recommendedTracks,
      videos: [],
      artists: recs.recommendedArtists,
      albums: [],
      playlists: [],
    };
  }

  const likedIds = new Set(ctx.likedTracks.map((l) => l.trackId));
  const recentTrackIds = new Set(
    ctx.recentSearchItems
      .filter((i): i is InstantRecentItemLike & { track: Track } => i.kind === 'track' && Boolean(i.track))
      .map((i) => i.track.id)
  );
  const playCounts = new Map<string, number>();
  for (const h of ctx.playHistory) {
    if (h.trackId) playCounts.set(h.trackId, (playCounts.get(h.trackId) ?? 0) + 1);
  }
  const favArtistKeys = new Set(ctx.favoriteArtists.map((f) => normalizeArtistKey(f.artistName)));
  const affinityByArtist = new Map<string, number>();
  for (const rec of ctx.affinityProfile) {
    affinityByArtist.set(normalizeArtistKey(rec.artistKey), rec.score);
  }

  // Collect deduplicated candidate tracks & artists & albums from user's local universe + prefix caches
  const trackPool = new Map<string, { track: Track; originBoost: number }>();
  const addTrackCandidate = (track: Track | undefined, originBoost: number) => {
    if (!track?.id || !track.title) return;
    const prev = trackPool.get(track.id);
    if (!prev || originBoost > prev.originBoost) {
      trackPool.set(track.id, { track, originBoost });
    }
  };

  for (const item of ctx.recentSearchItems) {
    if (item.kind === 'track' && item.track) addTrackCandidate(item.track, 90);
  }
  for (const liked of ctx.likedTracks) {
    addTrackCandidate(liked.track, 95);
  }
  for (const pl of ctx.playlists) {
    for (const t of pl.tracks) addTrackCandidate(t, 65);
  }
  for (const shelf of ctx.homeShelves) {
    for (const t of shelf.tracks ?? []) addTrackCandidate(t, 50);
    for (const m of shelf.mixes ?? []) {
      for (const t of m.tracks ?? []) addTrackCandidate(t, 45);
    }
  }
  for (const cached of ctx.cachedBundles ?? []) {
    for (const t of cached.songs ?? []) addTrackCandidate(t, 25);
  }

  const scoredSongs: Array<{ track: Track; score: number }> = [];
  for (const { track, originBoost } of trackPool.values()) {
    const matchScore = scoreLocalTrack(trimmed, qTokens, normQuery, track);
    if (matchScore <= 0) continue;
    let personalBoost = originBoost;
    if (likedIds.has(track.id)) personalBoost += 70;
    if (recentTrackIds.has(track.id)) personalBoost += 45;
    personalBoost += Math.min(60, (playCounts.get(track.id) ?? 0) * 12);
    const maxArtAff = track.artists.reduce(
      (m, a) =>
        Math.max(
          m,
          affinityByArtist.get(normalizeArtistKey(a.name)) ?? 0,
          favArtistKeys.has(normalizeArtistKey(a.name)) ? 10 : 0
        ),
      0
    );
    personalBoost += Math.min(60, maxArtAff * 4);
    scoredSongs.push({ track, score: matchScore + personalBoost });
  }
  scoredSongs.sort((a, b) => b.score - a.score);

  const artistPool = new Map<string, { artist: ArtistSummary; originBoost: number }>();
  const addArtistCandidate = (artist: ArtistSummary | undefined, originBoost: number) => {
    if (!artist?.id || !artist.name) return;
    const key = normalizeArtistKey(artist.name) || artist.id;
    const prev = artistPool.get(key);
    if (!prev || originBoost > prev.originBoost || (!prev.artist.thumbnailUrl && artist.thumbnailUrl)) {
      artistPool.set(key, {
        artist: {
          ...artist,
          thumbnailUrl: artist.thumbnailUrl || prev?.artist.thumbnailUrl || '',
        },
        originBoost: Math.max(originBoost, prev?.originBoost ?? 0),
      });
    }
  };

  for (const item of ctx.recentSearchItems) {
    if (item.kind === 'artist' && item.artistId && item.name) {
      addArtistCandidate(
        { id: item.artistId, name: item.name, thumbnailUrl: item.thumbnailUrl ?? '' },
        105
      );
    }
  }
  for (const fa of ctx.favoriteArtists) {
    addArtistCandidate(
      { id: fa.artistId, name: fa.artistName, thumbnailUrl: fa.thumbnailUrl ?? '' },
      115
    );
  }
  for (const shelf of ctx.homeShelves) {
    for (const t of shelf.tracks ?? []) {
      const firstAr = t.artists[0];
      if (firstAr?.name) {
        addArtistCandidate(
          { id: firstAr.id ?? firstAr.name.toLowerCase(), name: firstAr.name, thumbnailUrl: t.thumbnailUrl ?? '' },
          55
        );
      }
    }
    for (const m of shelf.mixes ?? []) {
      for (const t of m.tracks ?? []) {
        const firstAr = t.artists[0];
        if (firstAr?.name) {
          addArtistCandidate(
            { id: firstAr.id ?? firstAr.name.toLowerCase(), name: firstAr.name, thumbnailUrl: t.thumbnailUrl ?? '' },
            45
          );
        }
      }
    }
  }
  for (const cached of ctx.cachedBundles ?? []) {
    for (const a of cached.artists ?? []) addArtistCandidate(a, 30);
  }

  const collapsedQuery = normQuery.replace(/[^a-z0-9]+/g, '');
  const scoredArtists: Array<{ artist: ArtistSummary; score: number }> = [];
  for (const { artist, originBoost } of artistPool.values()) {
    const normName = normalizeSearchText(artist.name);
    const collapsedName = normName.replace(/[^a-z0-9]+/g, '');
    const words = new Set(normTokens(artist.name));
    let matchScore = 0;
    if (normName === normQuery || (collapsedQuery.length >= 4 && collapsedName === collapsedQuery)) {
      matchScore = 300;
    } else if (qTokens.every((t) => words.has(t))) {
      matchScore = 240;
    } else if (normName.startsWith(normQuery) || collapsedName.startsWith(collapsedQuery)) {
      matchScore = 200;
    } else if (normName.includes(normQuery) || (collapsedQuery.length >= 4 && collapsedName.includes(collapsedQuery))) {
      matchScore = 135;
    } else if (
      qTokens.every((t) => scoreFuzzyTokenMatch(t, words, normName) >= 0.68) ||
      (collapsedQuery.length >= 4 && computeBoundedEditDistance(collapsedQuery, collapsedName, 1) <= 1)
    ) {
      matchScore = 175;
    }
    if (matchScore <= 0) continue;
    const aff = affinityByArtist.get(normalizeArtistKey(artist.name)) ?? 0;
    const fav = favArtistKeys.has(normalizeArtistKey(artist.name)) ? 100 : 0;
    scoredArtists.push({ artist, score: matchScore + originBoost + fav + Math.min(80, aff * 5) });
  }
  scoredArtists.sort((a, b) => b.score - a.score);

  const albumsPool = new Map<string, AlbumSummary>();
  for (const shelf of ctx.homeShelves) {
    for (const al of shelf.albums ?? []) albumsPool.set(al.id, al);
  }
  for (const cached of ctx.cachedBundles ?? []) {
    for (const al of cached.albums ?? []) albumsPool.set(al.id, al);
  }
  const scoredAlbums = Array.from(albumsPool.values())
    .map((album) => {
      const normTitle = normalizeSearchText(album.title);
      const words = new Set(normTokens(album.title));
      const allArtist = album.artists.map((a) => normalizeSearchText(a.name)).join(' ');
      let s = 0;
      if (normTitle === normQuery) s = 220;
      else if (qTokens.every((t) => scoreFuzzyTokenMatch(t, words, normTitle) >= 0.68 || allArtist.includes(t))) {
        s = 130;
      }
      return { album, score: s };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.album);

  const songs = scoredSongs.slice(0, 20).map((x) => x.track);
  const artists = scoredArtists.slice(0, 12).map((x) => x.artist);
  const bestSongScore = scoredSongs[0]?.score ?? -1;
  const bestArtistScore = scoredArtists[0]?.score ?? -1;
  const topResult: SearchResultBundle['topResult'] =
    bestArtistScore >= bestSongScore && artists[0]
      ? { kind: 'artist', item: artists[0] }
      : songs[0]
        ? { kind: 'song', item: songs[0] }
        : scoredAlbums[0]
          ? { kind: 'album', item: scoredAlbums[0] }
          : undefined;

  return {
    query,
    topResult,
    songs,
    videos: songs.slice(0, 4),
    artists,
    albums: scoredAlbums.slice(0, 10),
    playlists: [],
  };
}

export function mergeSearchBundles(
  local: SearchResultBundle,
  remote: SearchResultBundle
): SearchResultBundle {
  const seenSongIds = new Set<string>();
  const seenSongKeys = new Set<string>();
  const songs: Track[] = [];
  const pushSong = (t: Track) => {
    if (!t?.id || seenSongIds.has(t.id)) return;
    const key = dedupeTrackKey(t);
    if (seenSongKeys.has(key)) return;
    seenSongIds.add(t.id);
    seenSongKeys.add(key);
    songs.push(t);
  };
  for (const t of remote.songs ?? []) pushSong(t);
  for (const t of local.songs ?? []) pushSong(t);

  const seenArtistKeys = new Set<string>();
  const artists: ArtistSummary[] = [];
  const pushArtist = (a: ArtistSummary) => {
    if (!a?.id || !a.name) return;
    const key = normalizeArtistKey(a.name) || a.id;
    if (seenArtistKeys.has(key)) return;
    seenArtistKeys.add(key);
    artists.push(a);
  };
  for (const a of remote.artists ?? []) pushArtist(a);
  for (const a of local.artists ?? []) pushArtist(a);

  const seenAlbumIds = new Set<string>();
  const albums: AlbumSummary[] = [];
  for (const al of [...(remote.albums ?? []), ...(local.albums ?? [])]) {
    if (!al?.id || seenAlbumIds.has(al.id)) continue;
    seenAlbumIds.add(al.id);
    albums.push(al);
  }

  return {
    query: remote.query || local.query,
    topResult: remote.topResult ?? local.topResult,
    songs,
    videos: remote.videos?.length ? remote.videos : songs.slice(0, 4),
    artists,
    albums,
    playlists: remote.playlists ?? [],
  };
}

export function buildSearchHomeRecommendations(ctx: InstantSearchContext): {
  recommendedTracks: Track[];
  recommendedArtists: ArtistSummary[];
} {
  const seenTrackIds = new Set<string>();
  const seenTrackKeys = new Set<string>();
  const recommendedTracks: Track[] = [];
  const pushTrack = (t: Track | undefined) => {
    if (!t?.id || !t.title || seenTrackIds.has(t.id)) return;
    const key = dedupeTrackKey(t);
    if (seenTrackKeys.has(key)) return;
    seenTrackIds.add(t.id);
    seenTrackKeys.add(key);
    recommendedTracks.push(t);
  };

  // Prioritize personalized home shelves ("Recomendado para ti", "Descubre lo Nuevo", "Daily Mix")
  const prioritizedShelves = [...ctx.homeShelves].sort((a, b) => {
    const scoreTitle = (t: string) =>
      /recomendado/i.test(t) ? 3 : /descubre|mix|reciente|para ti/i.test(t) ? 2 : 1;
    return scoreTitle(b.title) - scoreTitle(a.title);
  });
  for (const shelf of prioritizedShelves) {
    for (const t of (shelf.tracks ?? []).slice(0, 4)) pushTrack(t);
    for (const mix of (shelf.mixes ?? []).slice(0, 2)) {
      for (const t of (mix.tracks ?? []).slice(0, 3)) pushTrack(t);
    }
    if (recommendedTracks.length >= 10) break;
  }
  for (const liked of ctx.likedTracks) {
    pushTrack(liked.track);
    if (recommendedTracks.length >= 12) break;
  }
  for (const pl of ctx.playlists) {
    for (const t of pl.tracks) {
      pushTrack(t);
      if (recommendedTracks.length >= 12) break;
    }
    if (recommendedTracks.length >= 12) break;
  }

  // Personalized artists (Favorites first, then top affinity & shelf track artists with art)
  const seenArtistKeys = new Set<string>();
  const recommendedArtists: ArtistSummary[] = [];
  const artLookup = new Map<string, ArtistSummary>();
  const recordTrackArtist = (t: Track) => {
    for (const a of t.artists) {
      const k = normalizeArtistKey(a.name);
      if (k && t.thumbnailUrl && !artLookup.has(k)) {
        artLookup.set(k, {
          id: a.id ?? k,
          name: a.name,
          thumbnailUrl: t.thumbnailUrl,
        });
      }
    }
  };
  for (const shelf of ctx.homeShelves) {
    for (const t of shelf.tracks ?? []) recordTrackArtist(t);
    for (const m of shelf.mixes ?? []) {
      for (const t of m.tracks ?? []) recordTrackArtist(t);
    }
  }
  for (const l of ctx.likedTracks) {
    if (l.track) recordTrackArtist(l.track);
  }
  for (const item of ctx.recentSearchItems) {
    if (item.kind === 'artist' && item.name && item.thumbnailUrl) {
      const k = normalizeArtistKey(item.name);
      if (k && !artLookup.has(k)) {
        artLookup.set(k, {
          id: item.artistId ?? k,
          name: item.name,
          thumbnailUrl: item.thumbnailUrl,
        });
      }
    }
  }

  const pushArtist = (a: ArtistSummary | undefined) => {
    if (!a?.name) return;
    const k = normalizeArtistKey(a.name);
    if (!k || seenArtistKeys.has(k)) return;
    seenArtistKeys.add(k);
    const enriched = artLookup.get(k);
    recommendedArtists.push({
      id: a.id || enriched?.id || k,
      name: a.name,
      thumbnailUrl: a.thumbnailUrl || enriched?.thumbnailUrl || '',
      subscribersText: a.subscribersText ?? enriched?.subscribersText,
    });
  };

  for (const fa of ctx.favoriteArtists) {
    pushArtist({
      id: fa.artistId,
      name: fa.artistName,
      thumbnailUrl: fa.thumbnailUrl ?? '',
      subscribersText: 'Artista favorito',
    });
  }
  for (const rec of ctx.affinityProfile) {
    const k = normalizeArtistKey(rec.artistKey);
    const hit = artLookup.get(k);
    if (hit) {
      pushArtist({ ...hit, subscribersText: hit.subscribersText ?? 'Para ti' });
    }
  }
  for (const art of artLookup.values()) {
    pushArtist(art);
    if (recommendedArtists.length >= 10) break;
  }

  return {
    recommendedTracks: recommendedTracks.slice(0, 10),
    recommendedArtists: recommendedArtists.slice(0, 10),
  };
}
