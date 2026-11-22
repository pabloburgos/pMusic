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

  public constructor(fetchFn?: typeof fetch) {
    this.fetchFn = fetchFn ?? globalThis.fetch.bind(globalThis);
  }

  private async get(path: string, signal?: AbortSignal): Promise<Json> {
    const hit = this.cache.get(path);
    if (hit && Date.now() - hit.at < 5 * 60_000) return hit.data as Json;
    const res = await this.fetchFn(`${API}${path}`, { signal });
    if (!res.ok) throw new Error(`Deezer ${res.status}`);
    const data = (await res.json()) as Json;
    if (data?.error) throw new Error(String(data.error?.message ?? 'Deezer error'));
    this.cache.set(path, { at: Date.now(), data });
    if (this.cache.size > 300) this.cache.delete(this.cache.keys().next().value as string);
    return data;
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

    return {
      id: toTrackId(t.id),
      title: String(t.title_short ?? t.title),
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
    const who = a.artist ?? artist;
    return {
      id: String(a.id),
      title: String(a.title),
      artists: who ? [{ id: String(who.id), name: String(who.name) }] : [],
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

    const q = encodeURIComponent(query.trim());
    const want = (f: SearchFilter) => filter === 'all' || filter === f;
    const [songs, artists, albums, playlists] = await Promise.all([
      want('song') || want('video') ? this.get(`/search?q=${q}&limit=30`, signal) : null,
      want('artist') ? this.get(`/search/artist?q=${q}&limit=8`, signal) : null,
      want('album') ? this.get(`/search/album?q=${q}&limit=10`, signal) : null,
      want('playlist') ? this.get(`/search/playlist?q=${q}&limit=8`, signal) : null,
    ]);
    const rawSearchSongs = songs?.data ?? [];
    const songList = await this.enrichTracks(
      rawSearchSongs,
      rawSearchSongs.map((t: Json) => this.mapTrack(t)),
      12,
      signal
    );
    const artistList = (artists?.data ?? []).map((a: Json) => this.mapArtist(a));
    const topArtist = artistList[0];
    const qn = query.trim().toLowerCase();
    return {
      query,
      topResult:
        topArtist && topArtist.name.toLowerCase().includes(qn)
          ? { kind: 'artist', item: topArtist }
          : songList[0]
            ? { kind: 'song', item: songList[0] }
            : topArtist
              ? { kind: 'artist', item: topArtist }
              : undefined,
      songs: songList,
      videos: songList.slice(0, 4),
      artists: artistList,
      albums: (albums?.data ?? []).map((a: Json) => this.mapAlbum(a)),
      playlists: (playlists?.data ?? []).map((p: Json) => this.mapPlaylist(p)),
    };
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
    const res = await this.get(`/search/artist?q=${encodeURIComponent(cleaned)}&limit=4`, signal);
    const list = (res.data ?? []) as Json[];
    if (list.length === 0) {
      throw new Error(`Artista no encontrado: ${name}`);
    }
    const lower = cleaned.toLowerCase();
    const best =
      list.find((a) => String(a.name ?? '').trim().toLowerCase() === lower) ?? list[0]!;
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
      10,
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
    const rawTracks = (a.tracks?.data ?? []).map((t: Json) => ({
      ...t,
      artist: t.artist ?? a.artist,
      album: t.album ?? a,
    }));
    const tracks = await this.enrichTracks(
      rawTracks,
      rawTracks.map((t: Json) => this.mapTrack(t, a)),
      12,
      signal
    );
    return {
      album: this.mapAlbum(a),
      tracks,
    } as AlbumDetail;
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
    const radio = await this.get(`/artist/${t.artist.id}/radio?limit=30`, signal);
    const rel = await this.get(`/artist/${t.artist.id}/related?limit=6`, signal);
    return {
      tracks: (radio.data ?? []).map((x: Json) => this.mapTrack(x)),
      artists: (rel.data ?? []).map((r: Json) => this.mapArtist(r)),
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
