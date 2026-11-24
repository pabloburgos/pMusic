import type {
  ArtistAffinityRecord,
  PlayHistoryRecord,
  SeedArtistConfig,
} from '@pmusic/core';

export interface PlaylistPlayStat {
  count: number;
  lastPlayedAt: number;
  name: string;
}

export interface AccountTasteProfile {
  updatedAtMs: number;
  richnessScore: number;
  affinities: ArtistAffinityRecord[];
  playHistory: PlayHistoryRecord[];
  seedArtists: SeedArtistConfig[];
  playlistPlayCounts: Record<string, PlaylistPlayStat>;
}

export function normalizePlaylistStatKey(name: string): string {
  return (name ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export function computeTasteRichnessScore(
  affinities: readonly ArtistAffinityRecord[],
  playHistory: readonly PlayHistoryRecord[],
  playlistPlayCounts: Record<string, PlaylistPlayStat>
): number {
  const affinityPlays = affinities.reduce((acc, a) => acc + Math.max(0, a.playCount || 0), 0);
  const nonSkipHistory = playHistory.filter((h) => h.signalType !== 'skip_early').length;
  const plPlays = Object.values(playlistPlayCounts).reduce(
    (acc, stat) => acc + Math.max(0, stat?.count || 0),
    0
  );
  return affinityPlays * 3 + affinities.length * 2 + nonSkipHistory * 4 + plPlays * 2;
}

export function buildCompactAccountTasteProfile(input: {
  affinities: readonly ArtistAffinityRecord[];
  playHistory: readonly PlayHistoryRecord[];
  seedArtists: readonly SeedArtistConfig[];
  playlistPlayCounts: Record<string, PlaylistPlayStat>;
  updatedAtMs?: number;
}): AccountTasteProfile {
  const affinities = [...input.affinities]
    .sort((a, b) => b.score - a.score)
    .slice(0, 40)
    .map((a) => ({
      ...a,
      genres: (a.genres ?? []).slice(0, 4),
    }));

  const seenTrackIds = new Set<string>();
  const playHistory: PlayHistoryRecord[] = [];
  for (const h of input.playHistory) {
    if (!h?.track?.id || seenTrackIds.has(h.track.id)) continue;
    seenTrackIds.add(h.track.id);
    playHistory.push({
      id: h.id,
      trackId: h.trackId,
      playedAt: h.playedAt,
      playedSec: h.playedSec ?? 0,
      signalType: h.signalType,
      completionRatio: h.completionRatio ?? 0,
      track: {
        id: h.track.id,
        title: h.track.title,
        artists: h.track.artists.slice(0, 5),
        album: h.track.album,
        durationSec: h.track.durationSec,
        thumbnailUrl: h.track.thumbnailUrl,
        thumbnailHighUrl: h.track.thumbnailHighUrl,
        isExplicit: h.track.isExplicit,
        source: h.track.source ?? 'ytmusic',
      },
    });
    if (playHistory.length >= 35) break;
  }

  const playlistPlayCounts: Record<string, PlaylistPlayStat> = {};
  for (const [rawKey, stat] of Object.entries(input.playlistPlayCounts ?? {})) {
    const norm = normalizePlaylistStatKey(stat?.name || rawKey);
    if (!norm || !stat || stat.count <= 0) continue;
    playlistPlayCounts[norm] = {
      name: stat.name || rawKey,
      count: stat.count,
      lastPlayedAt: stat.lastPlayedAt || 0,
    };
  }

  const seedArtists = input.seedArtists.slice(0, 12);
  return {
    updatedAtMs: input.updatedAtMs ?? Date.now(),
    richnessScore: computeTasteRichnessScore(affinities, playHistory, playlistPlayCounts),
    affinities,
    playHistory,
    seedArtists,
    playlistPlayCounts,
  };
}

/**
 * Merges local & remote cloud taste profiles without letting a cold/fresh device
 * overwrite richer established desktop/mobile recommendation history.
 */
export function mergeAccountTasteProfiles(
  local: AccountTasteProfile | null | undefined,
  remote: AccountTasteProfile | null | undefined
): AccountTasteProfile {
  if (!remote && !local) {
    return buildCompactAccountTasteProfile({
      affinities: [],
      playHistory: [],
      seedArtists: [],
      playlistPlayCounts: {},
    });
  }
  if (!remote) return buildCompactAccountTasteProfile(local!);
  if (!local) return buildCompactAccountTasteProfile(remote);

  const affinityMap = new Map<string, ArtistAffinityRecord>();
  const mergeAffinityList = (list: readonly ArtistAffinityRecord[]) => {
    for (const rec of list) {
      if (!rec?.artistKey) continue;
      const existing = affinityMap.get(rec.artistKey);
      if (!existing) {
        affinityMap.set(rec.artistKey, { ...rec, genres: [...(rec.genres ?? [])] });
        continue;
      }
      const existingMs = Date.parse(existing.updatedAt) || 0;
      const incomingMs = Date.parse(rec.updatedAt) || 0;
      const mergedGenres = Array.from(
        new Set([...(existing.genres ?? []), ...(rec.genres ?? [])])
      ).slice(0, 4);
      affinityMap.set(rec.artistKey, {
        ...existing,
        artistName: rec.artistName || existing.artistName,
        artistId: rec.artistId ?? existing.artistId,
        score: Math.max(existing.score, rec.score),
        playCount: Math.max(existing.playCount, rec.playCount),
        skipCount: Math.max(existing.skipCount, rec.skipCount),
        genres: mergedGenres,
        isSeed: existing.isSeed || rec.isSeed,
        updatedAt: incomingMs >= existingMs ? rec.updatedAt : existing.updatedAt,
      });
    }
  };
  mergeAffinityList(remote.affinities ?? []);
  mergeAffinityList(local.affinities ?? []);

  const combinedHistory = [...(remote.playHistory ?? []), ...(local.playHistory ?? [])].sort(
    (a, b) => (Date.parse(b.playedAt) || 0) - (Date.parse(a.playedAt) || 0)
  );
  const historyDedup: PlayHistoryRecord[] = [];
  const seenTracks = new Set<string>();
  for (const h of combinedHistory) {
    if (!h?.track?.id || seenTracks.has(h.track.id)) continue;
    seenTracks.add(h.track.id);
    historyDedup.push(h);
    if (historyDedup.length >= 35) break;
  }

  const plCounts: Record<string, PlaylistPlayStat> = {};
  const mergePlStats = (src: Record<string, PlaylistPlayStat> | undefined) => {
    for (const [k, stat] of Object.entries(src ?? {})) {
      const norm = normalizePlaylistStatKey(stat?.name || k);
      if (!norm || !stat) continue;
      const cur = plCounts[norm];
      plCounts[norm] = {
        name: stat.name || cur?.name || k,
        count: Math.max(cur?.count ?? 0, stat.count ?? 0),
        lastPlayedAt: Math.max(cur?.lastPlayedAt ?? 0, stat.lastPlayedAt ?? 0),
      };
    }
  };
  mergePlStats(remote.playlistPlayCounts);
  mergePlStats(local.playlistPlayCounts);

  const remoteRicher =
    (remote.richnessScore ?? 0) > (local.richnessScore ?? 0) ||
    ((remote.richnessScore ?? 0) === (local.richnessScore ?? 0) &&
      (remote.updatedAtMs ?? 0) >= (local.updatedAtMs ?? 0));
  const chosenSeeds =
    remoteRicher && (remote.seedArtists?.length ?? 0) > 0
      ? remote.seedArtists
      : (local.seedArtists?.length ?? 0) > 0
        ? local.seedArtists
        : remote.seedArtists ?? [];

  return buildCompactAccountTasteProfile({
    affinities: Array.from(affinityMap.values()),
    playHistory: historyDedup,
    seedArtists: chosenSeeds,
    playlistPlayCounts: plCounts,
    updatedAtMs: Math.max(local.updatedAtMs || 0, remote.updatedAtMs || 0, Date.now()),
  });
}
