import type {
  AlbumDetail,
  AlbumSummary,
  ArtistDetail,
  ArtistSummary,
  HomeFeedResult,
  PlaylistDetail,
  PlaylistSummary,
  RelatedResult,
  SearchFilter,
  SearchResultBundle,
  Track,
} from '@pmusic/core';

/**
 * Catálogo real y gratuito (sin claves) basado en la API pública de Deezer:
 * millones de canciones, artistas, álbumes y listas con carátulas oficiales.
 * El audio completo se resuelve aparte (YouTube) en el proxy de streaming.
 */
const API = 'https://api.deezer.com';

export const DZ_PREFIX = 'dz:';
export const toTrackId = (dzId: number | string): string => `${DZ_PREFIX}${dzId}`;
export const isDeezerTrackId = (id: string): boolean => id.startsWith(DZ_PREFIX);

/**
 * Extracts featured artist names from song titles like
 * "Cayó La Noche (feat. Cruzzi, Abhir Hathi, Bejo) [Remix]" or "Song ft. Artist1 & Artist2".
 */
export function parseFeaturedArtistsFromTitle(title: string): string[] {
  if (!title) return [];
  const results: string[] = [];
  const bracketRe = /[([]\s*(?:feat\.?|ft\.?|featuring|with|con)\s+([^)\]]+)[)\]]/gi;
  const inlineRe = /(?:^|\s)(?:feat\.?|ft\.?|featuring)\s+([^(\[]+)$/i;

  const pushChunk = (raw: string) => {
    const cleaned = raw
      .replace(/\s*(?:remix|version|versión|en vivo|live|official.*|audio.*|video.*)$/i, '')
      .trim();
    if (!cleaned) return;
    const parts = cleaned.split(/\s*(?:,|&|\/|\sy\s|\sx\s|\+)\s*/i);
    for (const part of parts) {
      const name = part.replace(/^["']|["']$/g, '').trim();
      if (
        name.length >= 2 &&
        !/^(?:remix|edit|version|versión|prod\.?|official|video|audio)$/i.test(name) &&
        !results.some((r) => r.toLowerCase() === name.toLowerCase())
      ) {
        results.push(name);
      }
    }
  };

  let m: RegExpExecArray | null;
  while ((m = bracketRe.exec(title)) !== null) {
    if (m[1]) pushChunk(m[1]);
  }
  const stripped = title.replace(bracketRe, '').trim();
  const inMatch = inlineRe.exec(stripped);
  if (inMatch?.[1]) {
    pushChunk(inMatch[1]);
  }
  return results;
}

type Json = Record<string, any>;

function normalizeSearchStr(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function collapseSearchStr(input: string): string {
  return normalizeSearchStr(input).replace(/\s+/g, '');
}

function tokenizeSearchStr(input: string): string[] {
  const clean = normalizeSearchStr(input);
  return clean ? clean.split(' ') : [];
}

function scoreFieldTokens(
  queryTokens: readonly string[],
  normQuery: string,
  title: string,
  artistNames: readonly string[],
  albumName?: string
): number {
  if (!normQuery || queryTokens.length === 0) return 0;
  const collapsedQuery = normQuery.replace(/\s+/g, '');
  const normTitle = normalizeSearchStr(title);
  const titleWords = new Set(tokenizeSearchStr(title));
  const normArtists = artistNames.map((n) => normalizeSearchStr(n)).filter(Boolean);
  const collapsedArtists = artistNames.map((n) => collapseSearchStr(n)).filter(Boolean);
  const artistWordSet = new Set(normArtists.flatMap((a) => tokenizeSearchStr(a)));
  const normAlbum = albumName ? normalizeSearchStr(albumName) : '';
  const albumWords = new Set(normAlbum ? tokenizeSearchStr(normAlbum) : []);

  let score = 0;

  if (normTitle === normQuery) score += 180;
  if (collapsedArtists.some((a) => a === collapsedQuery)) score += 155;
  for (const a of normArtists) {
    if (`${a} ${normTitle}` === normQuery || `${normTitle} ${a}` === normQuery) {
      score += 185;
      break;
    }
  }

  let matchedInTitleCount = 0;
  let matchedInArtistCount = 0;
  let totalCoveredTokens = 0;

  for (const tok of queryTokens) {
    const inTitleWord = titleWords.has(tok);
    const inArtistWord = artistWordSet.has(tok);
    const inAlbumWord = albumWords.has(tok);

    if (inTitleWord) {
      matchedInTitleCount++;
      score += 34;
    } else if (normTitle.includes(tok)) {
      score += 7;
    }

    if (inArtistWord) {
      matchedInArtistCount++;
      score += 30;
    } else if (normArtists.some((a) => a.includes(tok))) {
      score += 6;
    }

    if (!inTitleWord && !inArtistWord && inAlbumWord) {
      score += 14;
    }

    if (inTitleWord || inArtistWord || inAlbumWord) {
      totalCoveredTokens++;
    }
  }

  // Split Artist + Track intent (e.g. "pablete diabla" -> Pablete in artists AND diabla in title)
  if (queryTokens.length >= 2 && matchedInTitleCount >= 1 && matchedInArtistCount >= 1) {
    score += 150;
    if (totalCoveredTokens === queryTokens.length) {
      score += 40;
    }
  } else if (totalCoveredTokens === queryTokens.length) {
    score += 95;
  }

  // Boost clean exact/prefix matches on title when single or short query
  if (normTitle.startsWith(normQuery)) score += 18;
  if (normArtists.some((a) => a === normQuery)) score += 145;

  return score;
}

export function scoreTrackForQuery(track: Track, query: string): number {
  const normQuery = normalizeSearchStr(query);
  const queryTokens = tokenizeSearchStr(query);
  return scoreFieldTokens(
    queryTokens,
    normQuery,
    track.title,
    track.artists.map((a) => a.name),
    track.album?.name
  );
}

export function scoreAlbumForQuery(album: AlbumSummary, query: string): number {
  const normQuery = normalizeSearchStr(query);
  const queryTokens = tokenizeSearchStr(query);
  const base = scoreFieldTokens(
    queryTokens,
    normQuery,
    album.title,
    album.artists.map((a) => a.name)
  );
  // Slight adjustment so exact song matches beat album cards when both exist
  return base > 0 ? base - 8 : 0;
}

export function scoreArtistForQuery(artist: ArtistSummary, query: string): number {
  const normQuery = normalizeSearchStr(query);
  const collapsedQuery = collapseSearchStr(query);
  const queryTokens = tokenizeSearchStr(query);
  if (!normQuery || queryTokens.length === 0) return 0;
  const normName = normalizeSearchStr(artist.name);
  const collapsedName = collapseSearchStr(artist.name);
  if (normName === normQuery || (collapsedQuery.length >= 4 && collapsedName === collapsedQuery)) {
    return 640;
  }
  const nameWords = new Set(tokenizeSearchStr(artist.name));
  const wordHits = queryTokens.filter((t) => nameWords.has(t)).length;
  if (wordHits === queryTokens.length) return 560;
  if (
    collapsedQuery.length >= 4 &&
    (collapsedName.startsWith(collapsedQuery) || collapsedQuery === collapsedName)
  ) {
    return 320;
  }
  if (
    collapsedQuery.length >= 4 &&
    (collapsedName.includes(collapsedQuery) || collapsedQuery.includes(collapsedName))
  ) {
    return 240;
  }
  if (normName.includes(normQuery) || normQuery.includes(normName)) return 140;
  return wordHits * 28;
}

const GENRE_CHART_MAP: Record<string, number> = {
  'género: latino': 197,
  'género: reggaetón': 122,
  'género: rap & hip-hop': 116,
  'género: pop': 132,
  'género: electrónica': 106,
  'género: r&b': 165,
  'género: dance': 113,
  'género: rock': 152,
};

export class DeezerCatalog {
  private readonly fetchFn: typeof fetch;
  private readonly cache = new Map<string, { at: number; data: unknown }>();
  private readonly inFlight = new Map<string, Promise<Json>>();
  private readonly searchCache = new Map<string, { at: number; bundle: SearchResultBundle }>();

  public constructor(fetchFn?: typeof fetch) {
    this.fetchFn = fetchFn ?? globalThis.fetch.bind(globalThis);
  }

  private async get(path: string, signal?: AbortSignal): Promise<Json> {
    const hit = this.cache.get(path);
    if (hit && Date.now() - hit.at < 5 * 60_000) return hit.data as Json;
    if (!signal) {
      const pending = this.inFlight.get(path);
      if (pending) return pending;
    }
    const exec = (async () => {
      const res = await this.fetchFn(`${API}${path}`, { signal });
      if (!res.ok) throw new Error(`Deezer ${res.status}`);
      const data = (await res.json()) as Json;
      if (data?.error) throw new Error(String(data.error?.message ?? 'Deezer error'));
      this.cache.set(path, { at: Date.now(), data });
      if (this.cache.size > 400) this.cache.delete(this.cache.keys().next().value as string);
      return data;
    })();
    if (!signal) {
      this.inFlight.set(path, exec);
    }
    try {
      return await exec;
    } finally {
      this.inFlight.delete(path);
    }
  }

  public mapTrack(t: Json, albumOverride?: Json): Track {
    const album = t.album ?? albumOverride;
    const rawList: Array<{ id?: string; name: string }> = [];
    const seenIds = new Set<string>();
    const seenNames = new Set<string>();

    const pushArtist = (idVal: unknown, nameVal: unknown) => {
      const name = typeof nameVal === 'string' ? nameVal.trim() : '';
      if (!name) return;
      const id =
        idVal !== undefined && idVal !== null && String(idVal).trim()
          ? String(idVal).trim()
          : undefined;
      const lower = name
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
      const hasTokenOverlap = Array.from(seenNames).some(
        (existing) => existing === lower || existing.startsWith(`${lower} `) || lower.startsWith(`${existing} `)
      );
      if ((id && seenIds.has(id)) || seenNames.has(lower) || hasTokenOverlap) return;
      if (id) seenIds.add(id);
      seenNames.add(lower);
      rawList.push(id ? { id, name } : { name });
    };

    if (t.artist) pushArtist(t.artist.id, t.artist.name);
    if (Array.isArray(t.contributors)) {
      for (const c of t.contributors) {
        if (c) pushArtist(c.id, c.name);
      }
    }
    const extraFeatured = parseFeaturedArtistsFromTitle(
      String(t.title ?? t.title_short ?? '')
    );
    for (const extraName of extraFeatured) {
      pushArtist(undefined, extraName);
    }

    const rawTitle = String(t.title ?? t.title_short ?? '');
    const shortTitle = String(t.title_short ?? t.title ?? '');
    const hasRemixOrVersionInFullTitle =
      rawTitle.length > shortTitle.length &&
      /\b(?:remix|version|versión|live|en vivo|acústico|acoustic|edit|vip)\b/i.test(rawTitle);

    return {
      id: toTrackId(t.id),
      title: hasRemixOrVersionInFullTitle ? rawTitle : shortTitle,
      artists: rawList.length ? rawList : [{ name: 'Artista' }],
      album: album ? { id: String(album.id), name: String(album.title) } : undefined,
      durationSec: Number(t.duration) || 200,
      thumbnailUrl: album?.cover_medium ?? album?.cover ?? '',
      thumbnailHighUrl: album?.cover_xl ?? album?.cover_big ?? album?.cover_medium,
      isExplicit: Boolean(t.explicit_lyrics),
      source: 'ytmusic',
      releaseYear: album?.release_date ? Number(String(album.release_date).slice(0, 4)) : undefined,
    };
  }

  private async enrichTracks(
    rawTracks: Json[],
    mappedTracks: Track[],
    maxCount = 12,
    signal?: AbortSignal
  ): Promise<Track[]> {
    const out = [...mappedTracks];
    const indicesToEnrich: number[] = [];
    const cap = Math.min(rawTracks.length, out.length, maxCount);
    for (let i = 0; i < cap; i++) {
      const raw = rawTracks[i];
      if (raw?.id && !Array.isArray(raw.contributors)) {
        indicesToEnrich.push(i);
      }
    }
    if (indicesToEnrich.length === 0) return out;

    await Promise.allSettled(
      indicesToEnrich.map(async (idx) => {
        const raw = rawTracks[idx];
        const existing = out[idx];
        if (!raw?.id || !existing) return;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 1100);
        const onOuterAbort = () => controller.abort();
        signal?.addEventListener('abort', onOuterAbort, { once: true });
        try {
          const full = await this.get(`/track/${encodeURIComponent(String(raw.id))}`, controller.signal);
          const fullMapped = this.mapTrack(full, raw.album);
          if (fullMapped.artists.length > 0) {
            // Merge any parsed featured artists from original title if full contributors omitted one
            const merged = [...fullMapped.artists];
            const have = new Set(merged.map((a) => a.name.toLowerCase()));
            for (const orig of existing.artists) {
              if (!have.has(orig.name.toLowerCase())) {
                merged.push(orig);
                have.add(orig.name.toLowerCase());
              }
            }
            out[idx] = { ...existing, artists: merged };
          }
        } catch {
          // Ignore timeout / network error per track and keep original mapped artists
        } finally {
          clearTimeout(timer);
          signal?.removeEventListener('abort', onOuterAbort);
        }
      })
    );
    return out;
  }

  private mapArtist(a: Json): ArtistSummary {
    return {
      id: String(a.id),
      name: String(a.name),
      thumbnailUrl: a.picture_big ?? a.picture_medium ?? a.picture ?? '',
      subscribersText: a.nb_fan ? `${Number(a.nb_fan).toLocaleString('es-ES')} fans` : undefined,
    };
  }

  private mapAlbum(a: Json, artist?: Json): AlbumSummary {
    const artistList: Array<{ id?: string; name: string }> = [];
    const seen = new Set<string>();
    const pushAr = (rawAr: Json | undefined) => {
      const name = typeof rawAr?.name === 'string' ? rawAr.name.trim() : '';
      if (!name) return;
      const norm = normalizeSearchStr(name);
      if (!norm || seen.has(norm)) return;
      seen.add(norm);
      const idStr =
        rawAr?.id !== undefined && rawAr?.id !== null && String(rawAr.id).trim()
          ? String(rawAr.id).trim()
          : undefined;
      artistList.push(idStr ? { id: idStr, name } : { name });
    };
    if (a.artist) pushAr(a.artist);
    if (Array.isArray(a.contributors)) {
      for (const c of a.contributors) pushAr(c);
    }
    if (artist) pushAr(artist);
    return {
      id: String(a.id),
      title: String(a.title),
      artists: artistList,
      year: a.release_date ? Number(String(a.release_date).slice(0, 4)) : undefined,
      thumbnailUrl: a.cover_big ?? a.cover_medium ?? a.cover ?? '',
    };
  }

  private mapPlaylist(p: Json): PlaylistSummary {
    return {
      id: String(p.id),
      title: String(p.title),
      author: p.user?.name ?? 'Deezer',
      trackCount: p.nb_tracks,
      thumbnailUrl: p.picture_big ?? p.picture_medium ?? '',
      source: 'ytmusic',
    };
  }

  public async search(query: string, filter: SearchFilter = 'all', signal?: AbortSignal): Promise<SearchResultBundle> {
    if (!query.trim()) {
      const [tracks, latinoTracks, artists, albums, playlists] = await Promise.all([
        this.get('/chart/0/tracks?limit=25', signal),
        this.get('/chart/197/tracks?limit=15', signal).catch(() => ({ data: [] })),
        this.get('/chart/0/artists?limit=12', signal),
        this.get('/chart/0/albums?limit=12', signal),
        this.get('/chart/0/playlists?limit=10', signal).catch(() => ({ data: [] })),
      ]);
      const rawTracks = [...(latinoTracks.data ?? []), ...(tracks.data ?? [])];
      const seenTrackIds = new Set<string>();
      const rawUnique: Json[] = [];
      const songsInit: Track[] = [];
      for (const t of rawTracks) {
        const mapped = this.mapTrack(t);
        if (!seenTrackIds.has(mapped.id)) {
          seenTrackIds.add(mapped.id);
          rawUnique.push(t);
          songsInit.push(mapped);
        }
      }
      const songs = await this.enrichTracks(rawUnique, songsInit, 12, signal);
      return {
        query,
        topResult: songs[0] ? { kind: 'song', item: songs[0] } : undefined,
        songs,
        videos: songs.slice(0, 4),
        artists: (artists.data ?? []).map((a: Json) => this.mapArtist(a)),
        albums: (albums.data ?? []).map((a: Json) => this.mapAlbum(a)),
        playlists: (playlists.data ?? []).map((p: Json) => this.mapPlaylist(p)),
      };
    }

    const genreId = GENRE_CHART_MAP[query.trim().toLowerCase()];
    if (genreId) {
      const [tracks, artists, albums, playlists] = await Promise.all([
        this.get(`/chart/${genreId}/tracks?limit=30`, signal),
        this.get(`/chart/${genreId}/artists?limit=8`, signal).catch(() => ({ data: [] })),
        this.get(`/chart/${genreId}/albums?limit=10`, signal).catch(() => ({ data: [] })),
        this.get(`/chart/${genreId}/playlists?limit=8`, signal).catch(() => ({ data: [] })),
      ]);
      const rawGenreTracks = tracks.data ?? [];
      const songs = await this.enrichTracks(
        rawGenreTracks,
        rawGenreTracks.map((t: Json) => this.mapTrack(t)),
        12,
        signal
      );
      const artistList = (artists.data ?? []).map((a: Json) => this.mapArtist(a));
      return {
        query,
        topResult: songs[0]
          ? { kind: 'song', item: songs[0] }
          : artistList[0]
            ? { kind: 'artist', item: artistList[0] }
            : undefined,
        songs,
        videos: songs.slice(0, 4),
        artists: artistList,
        albums: (albums.data ?? []).map((a: Json) => this.mapAlbum(a)),
        playlists: (playlists.data ?? []).map((p: Json) => this.mapPlaylist(p)),
      };
    }

    const rawQ = query.trim();
    const searchCacheKey = `${filter}::${normalizeSearchStr(rawQ)}`;
    const cachedBundle = this.searchCache.get(searchCacheKey);
    if (cachedBundle && Date.now() - cachedBundle.at < 5 * 60_000) {
      return cachedBundle.bundle;
    }

    const q = encodeURIComponent(rawQ);
    const tokens = tokenizeSearchStr(rawQ);
    const want = (f: SearchFilter) => filter === 'all' || filter === f;

    const runTimedGet = async (path: string, timeoutMs = 750): Promise<Json | null> => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      const onOuter = () => ctrl.abort();
      signal?.addEventListener('abort', onOuter, { once: true });
      try {
        return await this.get(path, ctrl.signal);
      } catch {
        return null;
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onOuter);
      }
    };

    const [songs, artists, albums, playlists] = await Promise.all([
      want('song') || want('video') ? this.get(`/search?q=${q}&limit=25`, signal) : null,
      want('artist') ? this.get(`/search/artist?q=${q}&limit=35`, signal) : null,
      want('album') || ((want('song') || want('video')) && tokens.length >= 2)
        ? this.get(`/search/album?q=${q}&limit=10`, signal).catch(() => ({ data: [] }))
        : null,
      want('playlist') ? this.get(`/search/playlist?q=${q}&limit=8`, signal) : null,
    ]);

    const rawArtistRows: Json[] = [...(artists?.data ?? [])];
    const extraDotArtists: Json[] = [];
    const extraArtistTracks: Json[] = [];

    // Single-token search enhancement for punctuated initial artist names (e.g. "valentino" -> "D.Valentino")
    if (tokens.length === 1 && tokens[0] && tokens[0].length >= 4 && (want('artist') || want('song'))) {
      const tok = tokens[0];
      const dotVariants: string[] = [];
      if (!tok.startsWith('d')) {
        dotVariants.push(`D.${rawQ}`);
      } else if (tok.length >= 5) {
        dotVariants.push(`d.${rawQ.slice(1)}`);
      }
      await Promise.all(
        dotVariants.map((variant) =>
          runTimedGet(`/search/artist?q=${encodeURIComponent(variant)}&limit=8`, 750).then((res) => {
            for (const row of res?.data ?? []) {
              extraDotArtists.push(row);
            }
          })
        )
      );
    }

    const seenArtistIds = new Set<string>();
    const combinedRawArtists: Json[] = [];
    for (const row of [...extraDotArtists, ...rawArtistRows]) {
      const idStr = row?.id ? String(row.id) : '';
      if (!idStr || seenArtistIds.has(idStr)) continue;
      seenArtistIds.add(idStr);
      combinedRawArtists.push(row);
    }

    // Fetch top tracks for dotted/initial artist variants so their Spanish songs appear alongside global hits
    const dotMatchedArtists = extraDotArtists
      .filter((raw) => scoreArtistForQuery(this.mapArtist(raw), rawQ) >= 120)
      .slice(0, 2);
    if (dotMatchedArtists.length > 0 && (want('song') || want('video'))) {
      await Promise.all(
        dotMatchedArtists.map((ar) =>
          runTimedGet(`/artist/${encodeURIComponent(String(ar.id))}/top?limit=5`, 650).then((res) => {
            for (const t of res?.data ?? []) {
              extraArtistTracks.push(t);
            }
          })
        )
      );
    }

    const albumListRaw: Json[] = albums?.data ?? [];
    const primaryRawSongs: Json[] = songs?.data ?? [];
    const bestPrimaryScore = primaryRawSongs.reduce((best, raw) => {
      const s = scoreTrackForQuery(this.mapTrack(raw), rawQ);
      return s > best ? s : best;
    }, 0);

    const structuredTracks: Array<Json | null> = [];
    const candidateAlbumTracks: Json[] = [];

    if ((want('song') || want('video')) && tokens.length >= 2 && bestPrimaryScore < 165) {
      const first = tokens[0]!;
      const rest = tokens.slice(1).join(' ');
      const last = tokens[tokens.length - 1]!;
      const head = tokens.slice(0, -1).join(' ');
      const matchingAlbums = albumListRaw
        .map((al) => ({
          al,
          score: scoreAlbumForQuery(this.mapAlbum(al), rawQ),
        }))
        .filter((entry) => entry.score >= 60)
        .sort((a, b) => b.score - a.score)
        .slice(0, 2);

      const secondaryCalls: Array<Promise<void>> = [
        runTimedGet(`/search/track?q=${encodeURIComponent(`artist:"${first}" track:"${rest}"`)}&limit=8`).then((res) => {
          if (res) structuredTracks.push(res);
        }),
        runTimedGet(`/search/track?q=${encodeURIComponent(`artist:"${last}" track:"${head}"`)}&limit=8`).then((res) => {
          if (res) structuredTracks.push(res);
        }),
        ...matchingAlbums.map(({ al }) =>
          runTimedGet(`/album/${encodeURIComponent(String(al.id))}/tracks?limit=20`).then((res) => {
            const list = (res?.data ?? []).map((t: Json) => ({
              ...t,
              artist: t.artist ?? al.artist,
              album: t.album ?? al,
            }));
            candidateAlbumTracks.push(...list);
          })
        ),
      ];
      await Promise.all(secondaryCalls);
    }

    const mergedRaw: Json[] = [];
    const seenRawIds = new Set<string>();
    const pushRawUnique = (list: Json[]) => {
      for (const item of list) {
        if (!item || !item.id) continue;
        const idStr = String(item.id);
        if (seenRawIds.has(idStr)) continue;
        seenRawIds.add(idStr);
        mergedRaw.push(item);
      }
    };

    for (const sRes of structuredTracks) {
      pushRawUnique(sRes?.data ?? []);
    }
    pushRawUnique(candidateAlbumTracks);
    pushRawUnique(extraArtistTracks);
    pushRawUnique(primaryRawSongs);

    const enrichedList = await this.enrichTracks(
      mergedRaw,
      mergedRaw.map((t: Json) => this.mapTrack(t)),
      16,
      signal
    );

    const songList = enrichedList
      .map((track, idx) => ({ track, idx, score: scoreTrackForQuery(track, rawQ) }))
      .sort((a, b) => b.score - a.score || a.idx - b.idx)
      .map((x) => x.track);

    const artistList = combinedRawArtists
      .map((raw: Json, idx: number) => {
        const artist = this.mapArtist(raw);
        const fanBoost = Math.log10(Math.max(1, Number(raw.nb_fan) || 0) + 1) * 8;
        return {
          artist,
          idx,
          score: scoreArtistForQuery(artist, rawQ) + fanBoost,
        };
      })
      .sort((a: { score: number; idx: number }, b: { score: number; idx: number }) => b.score - a.score || a.idx - b.idx)
      .map((x: { artist: ArtistSummary }) => x.artist);

    // Promote shared joint-album collaborators discovered in enriched search tracks onto album summaries
    const albumExtraArtists = new Map<string, Map<string, { ref: { id?: string; name: string }; count: number }>>();
    for (const song of songList) {
      const aid = song.album?.id;
      if (!aid || song.artists.length < 2) continue;
      let arMap = albumExtraArtists.get(aid);
      if (!arMap) {
        arMap = new Map();
        albumExtraArtists.set(aid, arMap);
      }
      for (const a of song.artists) {
        const norm = normalizeSearchStr(a.name);
        if (!norm) continue;
        const prev = arMap.get(norm);
        arMap.set(norm, { ref: prev?.ref ?? a, count: (prev?.count ?? 0) + 1 });
      }
    }

    const albumList = (want('album') ? albumListRaw : [])
      .map((a: Json) => {
        const mapped = this.mapAlbum(a);
        const extras = albumExtraArtists.get(mapped.id);
        if (!extras) return mapped;
        const have = new Set(mapped.artists.map((x) => normalizeSearchStr(x.name)));
        const promoted = [...mapped.artists];
        for (const [norm, entry] of extras.entries()) {
          if (entry.count >= 2 && !have.has(norm)) {
            have.add(norm);
            promoted.push(entry.ref);
          }
        }
        return promoted.length > mapped.artists.length ? { ...mapped, artists: promoted } : mapped;
      })
      .map((album: AlbumSummary, idx: number) => ({
        album,
        idx,
        score: scoreAlbumForQuery(album, rawQ),
      }))
      .sort((a: { score: number; idx: number }, b: { score: number; idx: number }) => b.score - a.score || a.idx - b.idx)
      .map((x: { album: AlbumSummary }) => x.album);

    const topSong = songList[0];
    const topArtist = artistList[0];
    const topAlbum = albumList[0];

    const normQ = normalizeSearchStr(rawQ);
    const qTokens = tokenizeSearchStr(rawQ);
    const topSongNormTitle = topSong ? normalizeSearchStr(topSong.title) : '';
    const topSongTitleWords = new Set(topSong ? tokenizeSearchStr(topSong.title) : []);
    const topSongTitleHits = qTokens.filter((t) => topSongTitleWords.has(t)).length;
    const topSongIsTitleIntent = Boolean(
      topSong &&
        (topSongNormTitle === normQ ||
          (normQ.length >= 3 && topSongNormTitle.startsWith(normQ)) ||
          (qTokens.length >= 2 && topSongTitleHits >= 1) ||
          (qTokens.length === 1 && topSongTitleHits === 1))
    );

    const rawSongScore = topSong ? scoreTrackForQuery(topSong, rawQ) : -1;
    const songScore = topSong
      ? topSongIsTitleIntent
        ? rawSongScore
        : Math.min(rawSongScore, 340)
      : -1;
    const artistScore = topArtist ? scoreArtistForQuery(topArtist, rawQ) : -1;
    const albumScore = topAlbum ? scoreAlbumForQuery(topAlbum, rawQ) : -1;

    let topResult: SearchResultBundle['topResult'];
    if (artistScore >= songScore && artistScore >= albumScore && topArtist) {
      topResult = { kind: 'artist', item: topArtist };
    } else if (songScore >= albumScore && topSong) {
      topResult = { kind: 'song', item: topSong };
    } else if (topAlbum) {
      topResult = { kind: 'album', item: topAlbum };
    } else if (topSong) {
      topResult = { kind: 'song', item: topSong };
    } else if (topArtist) {
      topResult = { kind: 'artist', item: topArtist };
    }

    const bundle: SearchResultBundle = {
      query,
      topResult,
      songs: songList,
      videos: songList.slice(0, 4),
      artists: artistList,
      albums: albumList,
      playlists: (playlists?.data ?? []).map((p: Json) => this.mapPlaylist(p)),
    };
    this.searchCache.set(searchCacheKey, { at: Date.now(), bundle });
    if (this.searchCache.size > 120) {
      this.searchCache.delete(this.searchCache.keys().next().value as string);
    }
    return bundle;
  }

  public async suggestions(input: string, signal?: AbortSignal): Promise<string[]> {
    const data = await this.get(`/search/autocomplete?q=${encodeURIComponent(input)}&limit=6`, signal);
    const out = new Set<string>();
    for (const a of data.artists?.data ?? []) out.add(a.name);
    for (const t of data.tracks?.data ?? []) out.add(`${t.title_short ?? t.title} - ${t.artist?.name ?? ''}`.trim());
    return [...out].slice(0, 8);
  }

  public async home(signal?: AbortSignal): Promise<HomeFeedResult> {
    const [chartTracks, chartArtists, chartAlbums, chartPlaylists] = await Promise.all([
      this.get('/chart/0/tracks?limit=30', signal),
      this.get('/chart/0/artists?limit=12', signal),
      this.get('/chart/0/albums?limit=12', signal),
      this.get('/chart/0/playlists?limit=10', signal),
    ]);
    const rawChartTracks = chartTracks.data ?? [];
    const enrichedChartTracks = await this.enrichTracks(
      rawChartTracks,
      rawChartTracks.map((t: Json) => this.mapTrack(t)),
      10,
      signal
    );
    return {
      moods: ['Para ti', 'Tendencias', 'Reggaeton', 'Pop', 'Hip-Hop', 'Electrónica'],
      shelves: [
        { title: 'Éxitos del momento', items: enrichedChartTracks },
        { title: 'Artistas del momento', items: (chartArtists.data ?? []).map((a: Json) => this.mapArtist(a)) },
        { title: 'Álbumes populares', items: (chartAlbums.data ?? []).map((a: Json) => this.mapAlbum(a)) },
        { title: 'Listas para descubrir', items: (chartPlaylists.data ?? []).map((p: Json) => this.mapPlaylist(p)) },
      ],
    } as HomeFeedResult;
  }

  public async artistByName(name: string, signal?: AbortSignal): Promise<ArtistDetail> {
    const cleaned = name.trim();
    const res = await this.get(`/search/artist?q=${encodeURIComponent(cleaned)}&limit=15`, signal);
    const list = (res.data ?? []) as Json[];
    if (list.length === 0) {
      throw new Error(`Artista no encontrado: ${name}`);
    }
    const normTarget = normalizeSearchStr(cleaned);
    const exactMatches = list
      .filter((a) => normalizeSearchStr(String(a.name ?? '')) === normTarget)
      .sort((a, b) => (Number(b.nb_fan) || 0) - (Number(a.nb_fan) || 0));

    const best =
      exactMatches[0] ??
      [...list].sort((a, b) => {
        const sA =
          scoreArtistForQuery(this.mapArtist(a), cleaned) +
          Math.log10(Math.max(1, Number(a.nb_fan) || 0) + 1) * 18;
        const sB =
          scoreArtistForQuery(this.mapArtist(b), cleaned) +
          Math.log10(Math.max(1, Number(b.nb_fan) || 0) + 1) * 18;
        return sB - sA;
      })[0]!;
    return this.artist(String(best.id), signal);
  }

  public async artist(id: string, signal?: AbortSignal): Promise<ArtistDetail> {
    const [a, top, albums, related] = await Promise.all([
      this.get(`/artist/${encodeURIComponent(id)}`, signal),
      this.get(`/artist/${encodeURIComponent(id)}/top?limit=20`, signal),
      this.get(`/artist/${encodeURIComponent(id)}/albums?limit=12`, signal),
      this.get(`/artist/${encodeURIComponent(id)}/related?limit=8`, signal),
    ]);
    const artist = this.mapArtist(a);
    const rawTop = top.data ?? [];
    const topSongs = await this.enrichTracks(
      rawTop,
      rawTop.map((t: Json) => this.mapTrack(t)),
      14,
      signal
    );
    return {
      artist,
      bannerUrl: a.picture_xl ?? artist.thumbnailUrl,
      description: artist.subscribersText ?? '',
      topSongs,
      albums: (albums.data ?? []).map((al: Json) => this.mapAlbum(al, a)),
      singles: [],
      relatedArtists: (related.data ?? []).map((r: Json) => this.mapArtist(r)),
    } as ArtistDetail;
  }

  public async album(id: string, signal?: AbortSignal): Promise<AlbumDetail> {
    const a = await this.get(`/album/${encodeURIComponent(id)}`, signal);
    let trackData: Json[] = a.tracks?.data ?? [];
    if (a.nb_tracks && trackData.length < Number(a.nb_tracks)) {
      const fullTracks = await this.get(`/album/${encodeURIComponent(id)}/tracks?limit=100`, signal).catch(() => null);
      if (Array.isArray(fullTracks?.data) && fullTracks.data.length > trackData.length) {
        trackData = fullTracks.data;
      }
    }
    const rawTracks = trackData.map((t: Json) => ({
      ...t,
      artist: t.artist ?? a.artist,
      album: t.album ?? a,
    }));
    const tracks = await this.enrichTracks(
      rawTracks,
      rawTracks.map((t: Json) => this.mapTrack(t, a)),
      30,
      signal
    );

    // Promote co-headlining joint-album collaborators (e.g. "TA FACIL" -> Lucho RK, La Pantera)
    const mappedAlbum = this.mapAlbum(a);
    if (tracks.length >= 2) {
      const collabCounts = new Map<string, { ref: { id?: string; name: string }; count: number }>();
      for (const tr of tracks) {
        const seenInTrack = new Set<string>();
        for (const ar of tr.artists) {
          const norm = normalizeSearchStr(ar.name);
          if (!norm || seenInTrack.has(norm)) continue;
          seenInTrack.add(norm);
          const prev = collabCounts.get(norm);
          collabCounts.set(norm, { ref: prev?.ref ?? ar, count: (prev?.count ?? 0) + 1 });
        }
      }
      const threshold = Math.max(2, Math.ceil(tracks.length * 0.6));
      const existingNorms = new Set(mappedAlbum.artists.map((x) => normalizeSearchStr(x.name)));
      const promoted = [...mappedAlbum.artists];
      const candidates = Array.from(collabCounts.entries())
        .filter(([norm, info]) => info.count >= threshold && !existingNorms.has(norm))
        .sort((x, y) => y[1].count - x[1].count);
      for (const [norm, info] of candidates) {
        existingNorms.add(norm);
        promoted.push(info.ref);
      }
      mappedAlbum.artists = promoted;
    }

    return {
      album: mappedAlbum,
      tracks,
    } as AlbumDetail;
  }

  public async albumByQuery(title: string, artist?: string, signal?: AbortSignal): Promise<AlbumDetail | null> {
    const cleanTitle = title.trim();
    if (!cleanTitle) return null;
    const queries = Array.from(
      new Set([artist ? `${cleanTitle} ${artist}` : cleanTitle, cleanTitle].map((q) => q.trim()).filter(Boolean))
    );
    for (const q of queries) {
      const res = await this.get(`/search/album?q=${encodeURIComponent(q)}&limit=12`, signal).catch(() => null);
      const list: Json[] = res?.data ?? [];
      if (list.length === 0) continue;
      const scored = list
        .map((al) => ({
          al,
          score: scoreAlbumForQuery(this.mapAlbum(al), q),
        }))
        .sort((a, b) => b.score - a.score);
      const best = scored[0]?.al;
      if (best?.id) {
        return this.album(String(best.id), signal);
      }
    }
    return null;
  }

  public async playlist(id: string, maxItems = 100, signal?: AbortSignal): Promise<PlaylistDetail> {
    const p = await this.get(`/playlist/${encodeURIComponent(id.replace(/^VL/, ''))}`, signal);
    const rawTracks = (p.tracks?.data ?? []).slice(0, maxItems);
    const tracks = await this.enrichTracks(
      rawTracks,
      rawTracks.map((t: Json) => this.mapTrack(t)),
      12,
      signal
    );
    return {
      playlist: this.mapPlaylist(p),
      tracks,
    } as PlaylistDetail;
  }

  public async related(trackId: string, signal?: AbortSignal): Promise<RelatedResult> {
    const raw = trackId.replace(DZ_PREFIX, '');
    const t = await this.get(`/track/${encodeURIComponent(raw)}`, signal);
    const seedTrackId = toTrackId(raw);
    const seedArtistId = t?.artist?.id ? String(t.artist.id) : '';
    const seedArtistName = String(t?.artist?.name ?? '').trim();
    const seedAlbumId = t?.album?.id ? String(t.album.id) : '';

    const [relRes, radioRes, artistTopRes, albumRes, playlistSearchRes] = await Promise.allSettled([
      seedArtistId
        ? this.get(`/artist/${encodeURIComponent(seedArtistId)}/related?limit=10`, signal)
        : Promise.resolve({ data: [] }),
      seedArtistId
        ? this.get(`/artist/${encodeURIComponent(seedArtistId)}/radio?limit=25`, signal)
        : Promise.resolve({ data: [] }),
      seedArtistId
        ? this.get(`/artist/${encodeURIComponent(seedArtistId)}/top?limit=15`, signal)
        : Promise.resolve({ data: [] }),
      seedAlbumId
        ? this.get(`/album/${encodeURIComponent(seedAlbumId)}`, signal)
        : Promise.resolve(null),
      seedArtistName
        ? this.get(`/search/playlist?q=${encodeURIComponent(seedArtistName)}&limit=6`, signal)
        : Promise.resolve({ data: [] }),
    ]);

    const relArtistsRaw: Json[] =
      relRes.status === 'fulfilled' && Array.isArray(relRes.value?.data) ? relRes.value.data : [];
    const radioRaw: Json[] =
      radioRes.status === 'fulfilled' && Array.isArray(radioRes.value?.data)
        ? radioRes.value.data
        : [];
    const artistTopRaw: Json[] =
      artistTopRes.status === 'fulfilled' && Array.isArray(artistTopRes.value?.data)
        ? artistTopRes.value.data
        : [];
    const albumData: Json | null = albumRes.status === 'fulfilled' ? albumRes.value : null;
    const playlistsRaw: Json[] =
      playlistSearchRes.status === 'fulfilled' && Array.isArray(playlistSearchRes.value?.data)
        ? playlistSearchRes.value.data
        : [];

    // Gather collaborator IDs from the seed track & artist's top tracks (vital for underground scenes)
    const collabIds: string[] = [];
    const collabSet = new Set<string>();
    const addCollabId = (idVal: unknown) => {
      const idStr = idVal !== undefined && idVal !== null ? String(idVal).trim() : '';
      if (!idStr || idStr === seedArtistId || collabSet.has(idStr)) return;
      collabSet.add(idStr);
      collabIds.push(idStr);
    };

    if (Array.isArray(t?.contributors)) {
      for (const c of t.contributors) addCollabId(c?.id);
    }
    for (const topItem of artistTopRaw) {
      if (topItem?.artist?.id) addCollabId(topItem.artist.id);
      if (Array.isArray(topItem?.contributors)) {
        for (const c of topItem.contributors) addCollabId(c?.id);
      }
    }

    // If Deezer omitted contributor IDs on underground tracks, resolve featured artists by name
    if (collabIds.length < 3) {
      const candidateNames: string[] = [
        ...parseFeaturedArtistsFromTitle(String(t?.title ?? '')),
        ...artistTopRaw.slice(0, 6).flatMap((x) => parseFeaturedArtistsFromTitle(String(x?.title ?? ''))),
      ].filter(
        (name, idx, arr) =>
          name.toLowerCase() !== seedArtistName.toLowerCase() &&
          arr.findIndex((other) => other.toLowerCase() === name.toLowerCase()) === idx
      );
      if (candidateNames.length > 0) {
        const lookedUp = await Promise.allSettled(
          candidateNames.slice(0, 3).map((name) =>
            this.get(`/search/artist?q=${encodeURIComponent(name)}&limit=3`, signal)
          )
        );
        for (let i = 0; i < lookedUp.length; i++) {
          const item = lookedUp[i];
          if (item?.status !== 'fulfilled') continue;
          const hits: Json[] = item.value?.data ?? [];
          const want = candidateNames[i]!.toLowerCase();
          const exact =
            hits.find((a) => String(a?.name ?? '').trim().toLowerCase() === want) ?? hits[0];
          if (exact?.id) addCollabId(exact.id);
        }
      }
    }

    const peerIdsToFetch = [
      ...collabIds.slice(0, 4),
      ...relArtistsRaw
        .map((a) => String(a?.id ?? '').trim())
        .filter((idStr) => idStr && idStr !== seedArtistId && !collabSet.has(idStr))
        .slice(0, 4),
    ];

    const scenePlaylists = playlistsRaw
      .filter((p) => {
        const n = Number(p?.nb_tracks ?? 0);
        return p?.id && n >= 5 && n <= 180;
      })
      .slice(0, 2);

    const [peerTopResponses, playlistResponses] = await Promise.all([
      Promise.allSettled(
        peerIdsToFetch.map((idStr) =>
          this.get(`/artist/${encodeURIComponent(idStr)}/top?limit=5`, signal)
        )
      ),
      Promise.allSettled(
        scenePlaylists.map((p) =>
          this.get(`/playlist/${encodeURIComponent(String(p.id))}/tracks?limit=40`, signal)
        )
      ),
    ]);

    const collabTracks: Track[] = [];
    const relArtistTracks: Track[] = [];
    peerTopResponses.forEach((res, idx) => {
      if (res.status !== 'fulfilled' || !Array.isArray(res.value?.data)) return;
      const mapped = res.value.data.map((x: Json) => this.mapTrack(x));
      if (idx < collabIds.slice(0, 4).length) {
        collabTracks.push(...mapped);
      } else {
        relArtistTracks.push(...mapped);
      }
    });

    const playlistSceneTracks: Track[] = [];
    playlistResponses.forEach((res, idx) => {
      if (res.status !== 'fulfilled' || !Array.isArray(res.value?.data)) return;
      const rawItems: Json[] = res.value.data;
      const plTitle = String(scenePlaylists[idx]?.title ?? '').toLowerCase();
      const seedLower = seedArtistName.toLowerCase();
      const containsSeed =
        (seedLower.length >= 3 && plTitle.includes(seedLower)) ||
        rawItems.some(
          (item) =>
            (seedArtistId && String(item?.artist?.id ?? '') === seedArtistId) ||
            (seedLower && String(item?.artist?.name ?? '').toLowerCase() === seedLower)
        );
      if (!containsSeed) return;
      playlistSceneTracks.push(...rawItems.map((x: Json) => this.mapTrack(x)));
    });

    const radioTracks = radioRaw.map((x: Json) => this.mapTrack(x));
    const seedOtherTracks = artistTopRaw
      .map((x: Json) => this.mapTrack(x))
      .filter((tr) => !seedAlbumId || tr.album?.id !== seedAlbumId);

    // Same-genre cushion ONLY if artist radio, collaborators, related artists & playlists produced < 8 tracks
    const preCount =
      collabTracks.length +
      relArtistTracks.length +
      playlistSceneTracks.length +
      radioTracks.length +
      seedOtherTracks.length;
    const genreTracks: Track[] = [];
    const genreId = Number(albumData?.genres?.data?.[0]?.id ?? albumData?.genre_id ?? -1);
    if (preCount < 8 && Number.isFinite(genreId) && genreId > 0) {
      const genreRes = await this.get(`/chart/${genreId}/tracks?limit=15`, signal).catch(() => ({
        data: [],
      }));
      if (Array.isArray(genreRes?.data)) {
        genreTracks.push(...genreRes.data.map((x: Json) => this.mapTrack(x)));
      }
    }

    // Interleave style-matched pools cleanly while capping any single artist/album from dominating
    const pools: Track[][] = [
      collabTracks,
      playlistSceneTracks,
      relArtistTracks,
      radioTracks,
      seedOtherTracks,
      genreTracks,
    ];
    const cursors = pools.map(() => 0);
    const seenIds = new Set<string>([seedTrackId]);
    const seenTitleArtist = new Set<string>();
    if (t?.title && seedArtistName) {
      seenTitleArtist.add(
        `${String(t.title).trim().toLowerCase()}::${seedArtistName.toLowerCase()}`
      );
    }
    const artistCounts = new Map<string, number>();
    const mixed: Track[] = [];

    let progressed = true;
    while (mixed.length < 30 && progressed) {
      progressed = false;
      for (let pIdx = 0; pIdx < pools.length && mixed.length < 30; pIdx++) {
        const pool = pools[pIdx]!;
        while (cursors[pIdx]! < pool.length) {
          const cand = pool[cursors[pIdx]!]!;
          cursors[pIdx]!++;
          if (!cand?.id || seenIds.has(cand.id)) continue;
          const primaryArtist = (cand.artists[0]?.name ?? '').trim().toLowerCase();
          const normKey = `${cand.title.trim().toLowerCase()}::${primaryArtist}`;
          if (seenTitleArtist.has(normKey)) continue;
          const aCount = artistCounts.get(primaryArtist) ?? 0;
          const maxForArtist =
            seedArtistName && primaryArtist === seedArtistName.toLowerCase() ? 3 : 2;
          if (primaryArtist && aCount >= maxForArtist) continue;
          seenIds.add(cand.id);
          seenTitleArtist.add(normKey);
          if (primaryArtist) artistCounts.set(primaryArtist, aCount + 1);
          mixed.push(cand);
          progressed = true;
          break;
        }
      }
    }

    return {
      tracks: mixed,
      artists: relArtistsRaw.map((r: Json) => this.mapArtist(r)),
      playlists: [],
    } as RelatedResult;
  }

  public async track(trackId: string, signal?: AbortSignal): Promise<Track> {
    const t = await this.get(`/track/${encodeURIComponent(trackId.replace(DZ_PREFIX, ''))}`, signal);
    return this.mapTrack(t);
  }

  public async getTrack(trackId: string, signal?: AbortSignal): Promise<Track | null> {
    try {
      return await this.track(trackId, signal);
    } catch {
      return null;
    }
  }

  /** Fragmento de 30 s (siempre disponible) usado como último recurso. */
  public async previewUrl(trackId: string, signal?: AbortSignal): Promise<string | null> {
    const raw = trackId.replace(DZ_PREFIX, '');
    // Sin caché: las URLs de preview caducan.
    const res = await this.fetchFn(`${API}/track/${encodeURIComponent(raw)}`, { signal });
    const t = (await res.json()) as Json;
    return t?.preview || null;
  }
}
