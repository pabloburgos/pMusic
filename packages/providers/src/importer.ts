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

export function scoreTrackCandidateMatch(source: ImportedSourceTrack, candidate: Track): number {
  const titleSim = tokenJaccardSimilarity(source.title, candidate.title);
  const srcArtist = source.artists.join(' ');
  const candArtist = candidate.artists.map((a) => a.name).join(' ');
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
    const total = extraction.tracks.length;
    const items: MatchedImportTrack[] = [];
    let matchedCount = 0;
    let unmatchedCount = 0;

    for (let i = 0; i < extraction.tracks.length; i++) {
      if (signal?.aborted) {
        throw new DomainError('ABORTED', 'Importación cancelada por el usuario.');
      }
      const sourceTrack = extraction.tracks[i]!;
      onProgress?.({
        phase: 'matching_tracks',
        completed: i,
        total,
        matchedCount,
        unmatchedCount,
        currentTrackTitle: sourceTrack.title,
      });

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
        matchedCount++;
        items.push({
          source: sourceTrack,
          match: bestMatch,
          confidence: bestConfidence,
          status: 'matched',
        });
      } else if (bestMatch && bestConfidence >= 0.35) {
        matchedCount++;
        items.push({
          source: sourceTrack,
          match: bestMatch,
          confidence: bestConfidence,
          status: 'low_confidence',
        });
      } else {
        unmatchedCount++;
        items.push({
          source: sourceTrack,
          confidence: bestConfidence,
          status: 'unmatched',
        });
      }
    }

    onProgress?.({
      phase: 'done',
      completed: total,
      total,
      matchedCount,
      unmatchedCount,
    });

    return {
      name: extraction.name,
      author: extraction.author,
      coverUrl: extraction.coverUrl,
      sourcePlatform: 'spotify',
      sourceUrl: extraction.sourceUrl,
      truncated: extraction.truncated,
      warning: extraction.warning,
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
