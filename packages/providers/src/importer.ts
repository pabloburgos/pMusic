import {
  DomainError,
  type IMusicProvider,
  type IPlaylistImporter,
  type ImportedSourceTrack,
  type ImportEntityKind,
  type ImportProgressEvent,
  type MatchedImportTrack,
  type ParsedPlaylistUrl,
  type PlaylistImportResult,
  type Track,
  normalizeSearchText,
  stripTrackTitleNoise,
} from '@pmusic/core';

export interface SpotifyEmbedExtraction {
  id: string;
  kind: ImportEntityKind;
  name: string;
  author?: string;
  coverUrl?: string;
  sourceUrl: string;
  truncated: boolean;
  warning?: string;
  tracks: ImportedSourceTrack[];
}

export interface PlaylistImporterOptions {
  musicProvider: Pick<IMusicProvider, 'search' | 'getPlaylist' | 'getAlbum'>;
  spotifyExtractor?: (parsed: ParsedPlaylistUrl, signal?: AbortSignal) => Promise<SpotifyEmbedExtraction>;
  fetchFn?: typeof fetch;
  apiBaseUrl?: string;
}

const SPOTIFY_URI_RE = /^spotify:(playlist|album):([A-Za-z0-9]{10,40})$/i;
const SPOTIFY_WEB_RE =
  /^https?:\/\/(?:open\.spotify\.com|play\.spotify\.com)\/(?:intl-[a-z]{2}(?:-[a-z]{2})?\/)?(?:embed\/)?(playlist|album)\/([A-Za-z0-9]{8,40})/i;
const NEXT_DATA_SCRIPT_RE = /<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i;
const SPOTIFY_PATHFINDER_PLAYLIST_HASH =
  'b39f62e9b566aa849b1780927de1450f47e02c54abf1e66e513f96e849591e41';

/**
 * Extracts Spotify's anonymous web-player access token embedded inside `__NEXT_DATA__`.
 */
export function extractSpotifyEmbedAccessToken(html: string): string | null {
  const match = NEXT_DATA_SCRIPT_RE.exec(html);
  if (!match || !match[1]) return null;
  try {
    const json = JSON.parse(match[1]) as {
      props?: {
        pageProps?: {
          state?: {
            settings?: {
              session?: {
                accessToken?: string;
              };
            };
          };
        };
      };
    };
    const tok = json?.props?.pageProps?.state?.settings?.session?.accessToken;
    return typeof tok === 'string' && tok.trim().length > 16 ? tok.trim() : null;
  } catch {
    return null;
  }
}

/**
 * Paginates Spotify's public Pathfinder GraphQL playlist endpoint so playlists with >100 tracks
 * can be extracted cleanly without user OAuth.
 */
export async function fetchSpotifyPathfinderPlaylist(
  playlistId: string,
  accessToken: string,
  options?: {
    maxTracks?: number;
    fetchFn?: typeof fetch;
    signal?: AbortSignal;
    fallbackMeta?: {
      name?: string;
      author?: string;
      coverUrl?: string;
      sourceUrl?: string;
    };
  }
): Promise<SpotifyEmbedExtraction | null> {
  const fetchFn = options?.fetchFn ?? globalThis.fetch.bind(globalThis);
  const maxTracks = Math.max(50, Math.min(1500, options?.maxTracks ?? 500));
  const cleanId = playlistId.trim();
  if (!cleanId || !accessToken.trim()) return null;

  let playlistName = options?.fallbackMeta?.name?.trim() || 'Playlist de Spotify';
  let playlistAuthor = options?.fallbackMeta?.author;
  let playlistCover = options?.fallbackMeta?.coverUrl;
  let totalCount = 0;
  const collected: ImportedSourceTrack[] = [];

  for (let offset = 0; offset < maxTracks; offset += 100) {
    if (options?.signal?.aborted) break;
    const limit = Math.min(100, maxTracks - offset);
    const variables = JSON.stringify({
      uri: `spotify:playlist:${cleanId}`,
      offset,
      limit,
    });
    const extensions = JSON.stringify({
      persistedQuery: {
        version: 1,
        sha256Hash: SPOTIFY_PATHFINDER_PLAYLIST_HASH,
      },
    });
    const endpoint =
      `https://api-partner.spotify.com/pathfinder/v1/query?operationName=fetchPlaylist` +
      `&variables=${encodeURIComponent(variables)}&extensions=${encodeURIComponent(extensions)}`;

    let res: Response;
    try {
      res = await fetchFn(endpoint, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
        signal: options?.signal,
      });
    } catch {
      break;
    }

    if (!res.ok) {
      if (offset === 0) return null;
      break;
    }

    let payload: {
      data?: {
        playlistV2?: {
          name?: string;
          ownerV2?: { data?: { name?: string } };
          images?: { items?: Array<{ sources?: Array<{ url?: string }> }> };
          content?: {
            totalCount?: number;
            items?: Array<{
              uid?: string;
              itemV2?: {
                data?: {
                  __typename?: string;
                  uri?: string;
                  name?: string;
                  trackDuration?: { totalMilliseconds?: number };
                  artists?: { items?: Array<{ profile?: { name?: string } }> };
                  albumOfTrack?: {
                    coverArt?: { sources?: Array<{ url?: string }> };
                  };
                };
              };
            }>;
          };
        };
      };
    };

    try {
      payload = (await res.json()) as typeof payload;
    } catch {
      break;
    }

    const pv2 = payload?.data?.playlistV2;
    if (!pv2) {
      if (offset === 0) return null;
      break;
    }

    if (offset === 0) {
      if (typeof pv2.name === 'string' && pv2.name.trim()) {
        playlistName = pv2.name.trim();
      }
      if (pv2.ownerV2?.data?.name) {
        playlistAuthor = pv2.ownerV2.data.name;
      }
      const coverCandidate = pv2.images?.items?.[0]?.sources?.[0]?.url;
      if (coverCandidate) {
        playlistCover = coverCandidate;
      }
      totalCount = Number(pv2.content?.totalCount ?? 0) || 0;
    }

    const items = Array.isArray(pv2.content?.items) ? pv2.content.items : [];
    if (items.length === 0) break;

    for (const entry of items) {
      const t = entry?.itemV2?.data;
      if (!t || typeof t.name !== 'string' || !t.name.trim()) continue;
      const artists = Array.isArray(t.artists?.items)
        ? t.artists.items
            .map((a) => a?.profile?.name?.trim())
            .filter((n): n is string => Boolean(n && n.length > 0))
        : [];
      const durMs = Number(t.trackDuration?.totalMilliseconds ?? 0);
      const trackCover =
        t.albumOfTrack?.coverArt?.sources?.[1]?.url ??
        t.albumOfTrack?.coverArt?.sources?.[0]?.url ??
        playlistCover;
      collected.push({
        title: t.name.trim(),
        artists: artists.length > 0 ? artists : ['Artista desconocido'],
        durationSec: Number.isFinite(durMs) && durMs > 0 ? Math.round(durMs / 1000) : undefined,
        externalId: t.uri ?? entry?.uid,
        thumbnailUrl: trackCover,
      });
    }

    if (items.length < limit) break;
    if (totalCount > 0 && collected.length >= totalCount) break;
  }

  if (collected.length === 0) return null;

  const effectiveTotal = Math.max(totalCount, collected.length);
  const truncated = effectiveTotal > collected.length;
  const warning = truncated
    ? `La playlist tiene ${effectiveTotal} canciones; se importaron las primeras ${collected.length} para mantener la fluidez.`
    : undefined;

  return {
    id: cleanId,
    kind: 'playlist',
    name: playlistName,
    author: playlistAuthor,
    coverUrl: playlistCover,
    sourceUrl: options?.fallbackMeta?.sourceUrl ?? `https://open.spotify.com/playlist/${cleanId}`,
    truncated,
    warning,
    tracks: collected,
  };
}

function splitCsvRow(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      cells.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  cells.push(cur.trim());
  return cells;
}

/**
 * Parses Exportify / Chosic CSV exports or plain `Artist - Track` text lists into `ImportedSourceTrack[]`.
 */
export function parsePlaylistCsvOrText(raw: string): ImportedSourceTrack[] {
  if (typeof raw !== 'string') return [];
  const lines = raw
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) return [];

  const headerLine = lines[0]!;
  const delimiter = headerLine.includes('\t') ? '\t' : headerLine.includes(';') && !headerLine.includes(',') ? ';' : ',';
  const headerCells = splitCsvRow(headerLine, delimiter).map((c) => c.toLowerCase());
  const titleIdx = headerCells.findIndex((h) =>
    h === 'track name' || h === 'track' || h === 'title' || h === 'name' || h === 'canción' || h === 'cancion'
  );
  const artistIdx = headerCells.findIndex((h) =>
    h.startsWith('artist') || h === 'artista' || h === 'artistas'
  );
  const durMsIdx = headerCells.findIndex((h) =>
    h.includes('duration (ms)') || h === 'duration_ms'
  );
  const durSecIdx = headerCells.findIndex((h) =>
    h === 'duration' || h === 'duration_sec'
  );

  if (titleIdx >= 0) {
    const parsedTracks: ImportedSourceTrack[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cells = splitCsvRow(lines[i]!, delimiter);
      const rawTitle = cells[titleIdx]?.trim();
      if (!rawTitle) continue;
      const rawArtists = artistIdx >= 0 ? cells[artistIdx] ?? '' : '';
      const artists = rawArtists
        .split(/\s*[;,]\s*|\s*&\s*/u)
        .map((a) => a.trim())
        .filter(Boolean);
      let durationSec: number | undefined;
      if (durMsIdx >= 0) {
        const ms = Number(cells[durMsIdx]);
        if (Number.isFinite(ms) && ms > 0) durationSec = Math.round(ms / 1000);
      } else if (durSecIdx >= 0) {
        const s = Number(cells[durSecIdx]);
        if (Number.isFinite(s) && s > 0) durationSec = Math.round(s);
      }
      parsedTracks.push({
        title: rawTitle,
        artists: artists.length > 0 ? artists : ['Artista desconocido'],
        durationSec,
      });
    }
    return parsedTracks;
  }

  // Fallback plain-text lines: `Artist - Track` or `Track`
  return lines.map((line) => {
    const sepIdx = line.indexOf(' - ');
    if (sepIdx > 0) {
      const artistPart = line.slice(0, sepIdx).trim();
      const titlePart = line.slice(sepIdx + 3).trim();
      return {
        title: titlePart || line,
        artists: splitSpotifySubtitleArtists(artistPart),
      };
    }
    return {
      title: line,
      artists: ['Artista desconocido'],
    };
  });
}

/**
 * Merges collaborating artists extracted from the source playlist into the matched provider Track
 * so multi-artist tracks display every artist immediately upon import (before playback enrichment).
 */
export function mergeMatchedTrackArtists(match: Track, sourceArtists: string[]): Track {
  const validSourceArtists = sourceArtists
    .map((a) => a.trim())
    .filter((a) => a.length > 0 && normalizeSearchText(a) !== 'artista desconocido');
  if (validSourceArtists.length === 0) return match;

  const merged = [...match.artists];
  const seen = new Set(merged.map((a) => normalizeSearchText(a.name)).filter(Boolean));
  for (const name of validSourceArtists) {
    const norm = normalizeSearchText(name);
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    const slug = norm.replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    merged.push({
      id: `imported_artist_${slug || merged.length}`,
      name,
    });
  }

  return merged.length === match.artists.length ? match : { ...match, artists: merged };
}

/**
 * Splits Spotify embed subtitle artist strings on `, ` including `\u00A0` non-breaking space.
 */
export function splitSpotifySubtitleArtists(subtitle: string | undefined | null): string[] {
  if (!subtitle || typeof subtitle !== 'string') return ['Artista desconocido'];
  const cleaned = subtitle.replace(/\u00A0/g, ' ').trim();
  if (!cleaned) return ['Artista desconocido'];
  const parts = cleaned
    .split(/,\s+/u)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  return parts.length > 0 ? parts : [cleaned];
}

/**
 * Parses Spotify `/embed/{playlist|album}/{id}` HTML containing `__NEXT_DATA__`.
 */
export function parseSpotifyEmbedHtml(
  html: string,
  parsed: ParsedPlaylistUrl
): SpotifyEmbedExtraction | null {
  const match = NEXT_DATA_SCRIPT_RE.exec(html);
  if (!match || !match[1]) return null;

  try {
    const json = JSON.parse(match[1]) as {
      props?: {
        pageProps?: {
          state?: {
            data?: {
              entity?: {
                name?: string;
                title?: string;
                subtitle?: string;
                ownerV2?: { data?: { name?: string } };
                coverArt?: { sources?: Array<{ url?: string }> };
                visualIdentity?: { image?: Array<{ url?: string }> };
                trackList?: Array<{
                  uid?: string;
                  uri?: string;
                  title?: string;
                  subtitle?: string;
                  duration?: number;
                }>;
              };
            };
          };
        };
      };
    };

    const entity = json?.props?.pageProps?.state?.data?.entity;
    if (!entity || !Array.isArray(entity.trackList)) {
      return null;
    }

    const name = (entity.title ?? entity.name ?? 'Playlist de Spotify').trim();
    const author = entity.ownerV2?.data?.name ?? (entity.subtitle ? entity.subtitle.replace(/\u00A0/g, ' ').trim() : undefined);
    const coverUrl =
      entity.coverArt?.sources?.[0]?.url ??
      entity.visualIdentity?.image?.[0]?.url;

    const tracks: ImportedSourceTrack[] = entity.trackList
      .filter((item) => Boolean(item && typeof item.title === 'string' && item.title.trim().length > 0))
      .map((item) => ({
        title: item.title!.trim(),
        artists: splitSpotifySubtitleArtists(item.subtitle),
        durationSec:
          typeof item.duration === 'number' && item.duration > 0
            ? Math.round(item.duration / 1000)
            : undefined,
        externalId: item.uri ?? item.uid,
        thumbnailUrl: coverUrl,
      }));

    const truncated = tracks.length >= 100;
    const warning = truncated
      ? 'Spotify limita la vista pública a las primeras 100 canciones sin iniciar sesión.'
      : undefined;

    return {
      id: parsed.id,
      kind: parsed.kind,
      name,
      author,
      coverUrl,
      sourceUrl: parsed.canonicalUrl,
      truncated,
      warning,
      tracks,
    };
  } catch {
    return null;
  }
}

function tokenJaccardSimilarity(a: string, b: string): number {
  const normA = normalizeSearchText(stripTrackTitleNoise(a) || a);
  const normB = normalizeSearchText(stripTrackTitleNoise(b) || b);
  if (!normA || !normB) return 0;
  if (normA === normB) return 1;
  if (normA.includes(normB) || normB.includes(normA)) return 0.86;

  const setA = new Set(normA.split(' ').filter(Boolean));
  const setB = new Set(normB.split(' ').filter(Boolean));
  if (setA.size === 0 || setB.size === 0) return 0;

  let intersection = 0;
  for (const tok of setA) {
    if (setB.has(tok)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union > 0 ? intersection / union : 0;
}

function canonicalizeImporterArtistList(artists: string[]): string {
  return artists
    .map((name) => {
      const norm = normalizeSearchText(name);
      return norm === 'cruz cafune' ? 'Cruzzi' : name;
    })
    .join(' ');
}

export function scoreTrackCandidateMatch(source: ImportedSourceTrack, candidate: Track): number {
  const titleSim = tokenJaccardSimilarity(source.title, candidate.title);
  const srcArtist = canonicalizeImporterArtistList(source.artists);
  const candArtist = canonicalizeImporterArtistList(candidate.artists.map((a) => a.name));
  const artistSim = tokenJaccardSimilarity(srcArtist, candArtist);

  let durationScore = 0.85;
  if (source.durationSec && source.durationSec > 0 && candidate.durationSec > 0) {
    const diff = Math.abs(source.durationSec - candidate.durationSec);
    if (diff <= 3) durationScore = 1.0;
    else if (diff <= 8) durationScore = 0.85;
    else if (diff <= 20) durationScore = 0.6;
    else durationScore = 0.25;
  }

  const raw = titleSim * 0.55 + artistSim * 0.35 + durationScore * 0.1;
  return Math.max(0, Math.min(1, Number(raw.toFixed(3))));
}

export class PlaylistImporter implements IPlaylistImporter {
  private readonly musicProvider: Pick<IMusicProvider, 'search' | 'getPlaylist' | 'getAlbum'>;
  private readonly spotifyExtractor?: (parsed: ParsedPlaylistUrl, signal?: AbortSignal) => Promise<SpotifyEmbedExtraction>;
  private readonly fetchFn: typeof fetch;
  private readonly apiBaseUrl: string;

  public constructor(options: PlaylistImporterOptions) {
    this.musicProvider = options.musicProvider;
    this.spotifyExtractor = options.spotifyExtractor;
    this.fetchFn = options.fetchFn ?? globalThis.fetch.bind(globalThis);
    this.apiBaseUrl = (options.apiBaseUrl ?? '').replace(/\/+$/, '');
  }

  public parseUrl(rawUrl: string): ParsedPlaylistUrl | null {
    if (typeof rawUrl !== 'string') return null;
    const trimmed = rawUrl.trim();
    if (!trimmed) return null;

    const uriMatch = SPOTIFY_URI_RE.exec(trimmed);
    if (uriMatch && uriMatch[1] && uriMatch[2]) {
      const kind = uriMatch[1].toLowerCase() as ImportEntityKind;
      const id = uriMatch[2];
      return {
        platform: 'spotify',
        kind,
        id,
        canonicalUrl: `https://open.spotify.com/${kind}/${id}`,
      };
    }

    const webMatch = SPOTIFY_WEB_RE.exec(trimmed);
    if (webMatch && webMatch[1] && webMatch[2]) {
      const kind = webMatch[1].toLowerCase() as ImportEntityKind;
      const id = webMatch[2];
      return {
        platform: 'spotify',
        kind,
        id,
        canonicalUrl: `https://open.spotify.com/${kind}/${id}`,
      };
    }

    try {
      const parsedUrl = new URL(trimmed);
      const host = parsedUrl.hostname.toLowerCase();

      if (
        host === 'youtube.com' ||
        host === 'www.youtube.com' ||
        host === 'm.youtube.com' ||
        host === 'music.youtube.com' ||
        host === 'youtu.be'
      ) {
        const listId = parsedUrl.searchParams.get('list')?.trim();
        if (listId && /^[A-Za-z0-9_-]{6,64}$/.test(listId)) {
          const cleanId = listId.replace(/^VL/, '');
          return {
            platform: 'youtube',
            kind: 'playlist',
            id: cleanId,
            canonicalUrl: `https://music.youtube.com/playlist?list=${cleanId}`,
          };
        }
      }
    } catch {
      return null;
    }

    return null;
  }

  public async importFromUrl(
    rawUrl: string,
    onProgress?: (event: ImportProgressEvent) => void,
    signal?: AbortSignal
  ): Promise<PlaylistImportResult> {
    if (signal?.aborted) {
      throw new DomainError('ABORTED', 'Importación cancelada por el usuario.');
    }

    const parsed = this.parseUrl(rawUrl);
    if (!parsed) {
      throw new DomainError(
        'INVALID_PLAYLIST_URL',
        'Enlace no válido. Introduce un enlace público de playlist o álbum de Spotify o YouTube.'
      );
    }

    onProgress?.({
      phase: 'resolving_url',
      completed: 0,
      total: 1,
      matchedCount: 0,
      unmatchedCount: 0,
    });

    onProgress?.({
      phase: 'extracting_source',
      completed: 0,
      total: 1,
      matchedCount: 0,
      unmatchedCount: 0,
    });

    if (parsed.platform === 'youtube') {
      const detail = await this.musicProvider.getPlaylist(parsed.id, 200, signal);
      const items: MatchedImportTrack[] = detail.tracks.map((track) => ({
        source: {
          title: track.title,
          artists: track.artists.map((a) => a.name),
          durationSec: track.durationSec,
          externalId: track.id,
          thumbnailUrl: track.thumbnailUrl,
        },
        match: track,
        confidence: 1,
        status: 'matched',
      }));

      onProgress?.({
        phase: 'done',
        completed: items.length,
        total: items.length,
        matchedCount: items.length,
        unmatchedCount: 0,
      });

      return {
        name: detail.playlist.title,
        author: detail.playlist.author,
        coverUrl: detail.playlist.thumbnailUrl,
        sourcePlatform: 'youtube',
        sourceUrl: parsed.canonicalUrl,
        truncated: false,
        items,
      };
    }

    const extraction = await this.extractSpotifySource(parsed, signal);
    return this.importFromSourceTracks(
      {
        name: extraction.name,
        author: extraction.author,
        coverUrl: extraction.coverUrl,
        sourcePlatform: 'spotify',
        sourceUrl: extraction.sourceUrl,
        truncated: extraction.truncated,
        warning: extraction.warning,
        tracks: extraction.tracks,
      },
      onProgress,
      signal
    );
  }

  public async importFromSourceTracks(
    input: {
      name: string;
      author?: string;
      coverUrl?: string;
      sourcePlatform: 'spotify' | 'youtube';
      sourceUrl: string;
      truncated?: boolean;
      warning?: string;
      tracks: ImportedSourceTrack[];
    },
    onProgress?: (event: ImportProgressEvent) => void,
    signal?: AbortSignal
  ): Promise<PlaylistImportResult> {
    const total = input.tracks.length;
    const items: MatchedImportTrack[] = new Array(total);
    let completedCount = 0;
    let matchedCount = 0;
    let unmatchedCount = 0;

    const matchSingle = async (sourceTrack: ImportedSourceTrack): Promise<MatchedImportTrack> => {
      const query = `${sourceTrack.title} ${sourceTrack.artists[0] ?? ''}`.trim();
      const searchBundle = await this.musicProvider.search(query, 'song', signal);
      const candidates = searchBundle.songs.length > 0 ? searchBundle.songs : searchBundle.videos;

      let bestMatch: Track | undefined;
      let bestConfidence = 0;

      for (const candidate of candidates) {
        const conf = scoreTrackCandidateMatch(sourceTrack, candidate);
        if (conf > bestConfidence) {
          bestConfidence = conf;
          bestMatch = candidate;
        }
      }

      if (bestMatch && bestConfidence >= 0.6) {
        return {
          source: sourceTrack,
          match: mergeMatchedTrackArtists(bestMatch, sourceTrack.artists),
          confidence: bestConfidence,
          status: 'matched',
        };
      }
      if (bestMatch && bestConfidence >= 0.35) {
        return {
          source: sourceTrack,
          match: mergeMatchedTrackArtists(bestMatch, sourceTrack.artists),
          confidence: bestConfidence,
          status: 'low_confidence',
        };
      }
      return {
        source: sourceTrack,
        confidence: bestConfidence,
        status: 'unmatched',
      };
    };

    const BATCH_SIZE = 6;
    for (let start = 0; start < total; start += BATCH_SIZE) {
      if (signal?.aborted) {
        throw new DomainError('ABORTED', 'Importación cancelada por el usuario.');
      }
      const end = Math.min(total, start + BATCH_SIZE);
      const indices: number[] = [];
      for (let i = start; i < end; i++) indices.push(i);

      await Promise.all(
        indices.map(async (idx) => {
          const sourceTrack = input.tracks[idx]!;
          const result = await matchSingle(sourceTrack);
          items[idx] = result;
          completedCount++;
          if (result.status === 'unmatched') unmatchedCount++;
          else matchedCount++;
          onProgress?.({
            phase: 'matching_tracks',
            completed: completedCount,
            total,
            matchedCount,
            unmatchedCount,
            currentTrackTitle: sourceTrack.title,
          });
        })
      );
    }

    onProgress?.({
      phase: 'done',
      completed: total,
      total,
      matchedCount,
      unmatchedCount,
    });

    return {
      name: input.name,
      author: input.author,
      coverUrl: input.coverUrl,
      sourcePlatform: input.sourcePlatform,
      sourceUrl: input.sourceUrl,
      truncated: Boolean(input.truncated),
      warning: input.warning,
      items,
    };
  }

  private async extractSpotifySource(
    parsed: ParsedPlaylistUrl,
    signal?: AbortSignal
  ): Promise<SpotifyEmbedExtraction> {
    if (this.spotifyExtractor) {
      return this.spotifyExtractor(parsed, signal);
    }

    const endpoint = `${this.apiBaseUrl}/api/import/spotify?url=${encodeURIComponent(parsed.canonicalUrl)}`;
    const response = await this.fetchFn(endpoint, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal,
    });

    if (response.status === 404 && this.apiBaseUrl === '') {
      // Android WebView offline/asset interceptor does not implement /api/import/spotify directly,
      // so use /api/radar-proxy + Spotify Pathfinder pagination directly from the client.
      const embedTarget = `https://open.spotify.com/embed/${parsed.kind}/${parsed.id}`;
      const proxyEmbedRes = await this.fetchFn(
        `/api/radar-proxy?url=${encodeURIComponent(embedTarget)}`,
        { method: 'GET', signal }
      ).catch(() => null);
      if (proxyEmbedRes && proxyEmbedRes.ok) {
        const html = await proxyEmbedRes.text();
        const embedExtracted = parseSpotifyEmbedHtml(html, parsed);
        const token = extractSpotifyEmbedAccessToken(html);
        if (parsed.kind === 'playlist' && token) {
          const proxiedFetch: typeof fetch = (input, init) => {
            const rawTarget = String(input);
            const authHeader =
              init?.headers && typeof (init.headers as Record<string, string>).Authorization === 'string'
                ? (init.headers as Record<string, string>).Authorization
                : '';
            const proxyUrl = `/api/radar-proxy?url=${encodeURIComponent(rawTarget)}${
              authHeader ? `&auth=${encodeURIComponent(authHeader)}` : ''
            }`;
            return this.fetchFn(proxyUrl, { method: 'GET', signal: init?.signal });
          };
          const pf = await fetchSpotifyPathfinderPlaylist(parsed.id, token, {
            maxTracks: 500,
            fetchFn: proxiedFetch,
            signal,
            fallbackMeta: {
              name: embedExtracted?.name,
              author: embedExtracted?.author,
              coverUrl: embedExtracted?.coverUrl,
              sourceUrl: parsed.canonicalUrl,
            },
          });
          if (pf && pf.tracks.length > 0) return pf;
        }
        if (embedExtracted && embedExtracted.tracks.length > 0) return embedExtracted;
      }
    }

    if (response.status === 404 || response.status === 403) {
      throw new DomainError(
        'PLAYLIST_PRIVATE_OR_NOT_FOUND',
        'La playlist de Spotify es privada o no se encontró.'
      );
    }

    if (!response.ok) {
      throw new DomainError(
        'SPOTIFY_EXTRACT_FAILED',
        `No se pudo extraer la playlist de Spotify (HTTP ${response.status}).`
      );
    }

    const data = (await response.json()) as SpotifyEmbedExtraction;
    if (!data || !Array.isArray(data.tracks) || data.tracks.length === 0) {
      throw new DomainError(
        'PLAYLIST_PRIVATE_OR_NOT_FOUND',
        'La playlist de Spotify está vacía o es privada.'
      );
    }

    return data;
  }
}
