import type { Track } from '@pmusic/core';

export type PlaylistSortMode = 'custom' | 'recent' | 'title' | 'artist' | 'duration';

function stripDiacritics(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function getTrackDuplicateKey(track: Track): string {
  const titleKey = stripDiacritics(track.title ?? '');
  const artistKey = stripDiacritics(track.artists[0]?.name ?? '');
  return `${titleKey}::${artistKey}`;
}

export function findPlaylistDuplicates(tracks: readonly Track[]): {
  duplicateCount: number;
  duplicateIds: Set<string>;
  uniqueTracks: Track[];
} {
  const seenIds = new Set<string>();
  const seenKeys = new Set<string>();
  const duplicateIds = new Set<string>();
  const uniqueTracks: Track[] = [];
  let duplicateCount = 0;

  for (const track of tracks) {
    if (!track?.id) continue;
    const key = getTrackDuplicateKey(track);
    if (seenIds.has(track.id) || (key !== '::' && seenKeys.has(key))) {
      duplicateCount++;
      duplicateIds.add(track.id);
      continue;
    }
    seenIds.add(track.id);
    if (key !== '::') seenKeys.add(key);
    uniqueTracks.push(track);
  }

  return { duplicateCount, duplicateIds, uniqueTracks };
}

export function filterAndSortPlaylistTracks(
  tracks: readonly Track[],
  query: string,
  sortMode: PlaylistSortMode
): Array<{ track: Track; originalIndex: number }> {
  const indexed = tracks.map((track, originalIndex) => ({ track, originalIndex }));
  const cleanQuery = stripDiacritics(query);

  const filtered = cleanQuery
    ? indexed.filter(({ track }) => {
        const title = stripDiacritics(track.title ?? '');
        const album = stripDiacritics(track.album?.name ?? '');
        const artists = track.artists.map((a) => stripDiacritics(a.name ?? '')).join(' ');
        return (
          title.includes(cleanQuery) ||
          artists.includes(cleanQuery) ||
          album.includes(cleanQuery)
        );
      })
    : indexed;

  if (sortMode === 'custom') {
    return filtered;
  }

  const copy = [...filtered];
  if (sortMode === 'recent') {
    copy.reverse();
    return copy;
  }
  if (sortMode === 'title') {
    copy.sort((a, b) =>
      a.track.title.localeCompare(b.track.title, 'es', { sensitivity: 'base' })
    );
    return copy;
  }
  if (sortMode === 'artist') {
    copy.sort((a, b) => {
      const ar = (a.track.artists[0]?.name ?? '').localeCompare(
        b.track.artists[0]?.name ?? '',
        'es',
        { sensitivity: 'base' }
      );
      if (ar !== 0) return ar;
      return a.track.title.localeCompare(b.track.title, 'es', { sensitivity: 'base' });
    });
    return copy;
  }
  copy.sort((a, b) => (a.track.durationSec ?? 0) - (b.track.durationSec ?? 0));
  return copy;
}
