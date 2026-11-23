import {
  type ILrcParser,
  type ILyricsProvider,
  type IMusicProvider,
  type LyricsDocument,
  type LyricsQuery,
  normalizeSearchText,
  stripTrackTitleNoise,
} from '@pmusic/core';
import { defaultLrcParser } from './lrc-parser.ts';

export interface MusixmatchLyricsPayload {
  syncedLyrics?: string | null;
  plainLyrics?: string | null;
  source?: 'musixmatch';
}

export interface LrclibProviderOptions {
  baseUrl?: string;
  parser?: ILrcParser;
  musicProvider?: Pick<IMusicProvider, 'getPlainLyricsFallback'> & {
    getMusixmatchLyrics?: (
      title: string,
      artist: string,
      durationSec?: number,
      signal?: AbortSignal
    ) => Promise<MusixmatchLyricsPayload | null>;
  };
  musixmatchFetcher?: (
    title: string,
    artist: string,
    durationSec?: number,
    signal?: AbortSignal
  ) => Promise<MusixmatchLyricsPayload | null>;
  fetchFn?: typeof fetch;
  cacheTtlMs?: number;
}

interface LrclibApiRecord {
  id?: number;
  trackName?: string;
  artistName?: string;
  albumName?: string;
  duration?: number;
  instrumental?: boolean;
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
}

const LRCLIB_CLIENT_HEADER = 'pMusic/0.1.0 (https://github.com/pmusic/pmusic)';

const LYRIC_ARTIST_ALIASES: Record<string, string[]> = {
  'cruz cafune': ['cruzzi'],
  cruzzi: ['cruz cafune'],
  'la pantera': ['lapantera'],
  lapantera: ['la pantera'],
  'c tangana': ['pucho', 'el madrileno'],
  'd valentino': ['dvalentino'],
  dvalentino: ['d valentino'],
  'lucho rk': ['luchork'],
  'bad bunny': ['benito'],
};

const COMMON_LYRIC_WORDS = new Set([
  'de', 'la', 'que', 'el', 'en', 'y', 'a', 'no', 'me', 'te', 'se', 'lo', 'un', 'por',
  'con', 'mi', 'tu', 'es', 'para', 'como', 'pero', 'si', 'yo', 'ya', 'mas', 'del', 'al',
  'las', 'los', 'una', 'su', 'le', 'sin', 'pa', 'to', 'todo', 'nada', 'vida', 'noche',
  'solo', 'bien', 'amor', 'cuando', 'esta', 'este', 'eso', 'esa', 'son', 'fue', 'ha',
  'nos', 'ni', 'o', 'u', 'e', 'soy', 'eres', 'voy', 'va', 'van', 'ven', 'ver', 'vez',
  'the', 'and', 'to', 'you', 'in', 'it', 'is', 'of', 'for', 'on', 'my', 'that', 'with',
  'be', 'so', 'all', 'we', 'know', 'love', 'like', 'yeah', 'oh', 'ey', 'eh', 'baby',
  'i', 'im', 'dont', 'up', 'down', 'out', 'get', 'go', 'now', 'what', 'when', 'just',
  'can', 'but', 'not', 'are', 'was', 'have', 'from', 'they', 'she', 'he', 'her', 'his',
]);

/**
 * Rejects Musixmatch anti-bot scrambled CVC cipher ("Kahe rorew vip / Vuqew qazaqo kimi")
 * and non-Latin foreign script mismatches so pMusic only shows authentic lyrics.
 */
export function isAuthenticLyricsText(rawText: string): boolean {
  if (!rawText || typeof rawText !== 'string') return false;
  const stripped = rawText
    .replace(/\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]/g, ' ')
    .replace(/<\d{1,3}:\d{2}(?:[.:]\d{1,3})?>/g, ' ')
    .replace(/^\[[a-z]{2,8}:[^\]]*\]$/gim, ' ')
    .trim();
  if (stripped.length < 10) return false;

  const nonSpaceChars = stripped.replace(/\s+/g, '');
  if (nonSpaceChars.length === 0) return false;
  const nonLatinChars = nonSpaceChars.replace(
    /[a-zA-Z0-9áéíóúüñÁÉÍÓÚÜÑàèìòùÀÈÌÒÙâêîôûÂÊÎÔÛäëïöüÄËÏÖÜçÇãõÃÕ.,!?'":;()\-¡¿♪♫’‘“”—–…/\[\]]/g,
    ''
  );
  if (nonLatinChars.length / nonSpaceChars.length > 0.18) {
    return false;
  }

  const lettersOnly = stripped
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
  if (lettersOnly.length >= 28) {
    const rareLetters = lettersOnly.replace(/[^qxzkwjv]/g, '');
    if (rareLetters.length / lettersOnly.length > 0.115) {
      return false;
    }
  }

  const words = stripped
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((w) => w.length >= 1);

  if (words.length >= 12) {
    let commonHits = 0;
    for (const w of words) {
      if (COMMON_LYRIC_WORDS.has(w)) commonHits++;
    }
    if (commonHits / words.length < 0.045) {
      return false;
    }
  }

  return true;
}

export class LrclibLyricsProvider implements ILyricsProvider {
  private readonly baseUrl: string;
  private readonly parser: ILrcParser;
  private readonly musicProvider?: LrclibProviderOptions['musicProvider'];
  private readonly musixmatchFetcher?: LrclibProviderOptions['musixmatchFetcher'];
  private readonly fetchFn: typeof fetch;
  private readonly cacheTtlMs: number;
  private readonly cache = new Map<string, LyricsDocument>();

  public constructor(options: LrclibProviderOptions = {}) {
    this.baseUrl = (options.baseUrl ?? 'https://lrclib.net').replace(/\/+$/, '');
    this.parser = options.parser ?? defaultLrcParser;
    this.musicProvider = options.musicProvider;
    this.musixmatchFetcher = options.musixmatchFetcher;
    this.fetchFn = options.fetchFn ?? globalThis.fetch.bind(globalThis);
    this.cacheTtlMs = options.cacheTtlMs ?? 30 * 60_000;
  }

  public async getLyrics(query: LyricsQuery, signal?: AbortSignal): Promise<LyricsDocument> {
    const cacheKey = `${query.trackId}::${normalizeSearchText(query.title)}::${normalizeSearchText(query.artist)}`;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.fetchedAtMs < this.cacheTtlMs) {
      return cached;
    }

    const cleanTitle = stripTrackTitleNoise(query.title) || query.title.trim();
    const cleanArtist = (query.artist.split(/,|&|\bfeat\.?\b|\bft\.?\b/i)[0] ?? query.artist).trim();

    // 1. Try /api/get exact match
    const exactRecord = await this.fetchExactRecord(cleanTitle, cleanArtist, query.album, query.durationSec, signal);
    if (exactRecord) {
      const doc = this.recordToDocument(query.trackId, exactRecord);
      if (doc.status !== 'not_found') {
        this.cache.set(cacheKey, doc);
        return doc;
      }
    }

    // 2. Fallback to /api/search
    const searchRecord = await this.fetchSearchBestMatch(cleanTitle, cleanArtist, query.durationSec, signal);
    if (searchRecord) {
      const doc = this.recordToDocument(query.trackId, searchRecord);
      if (doc.status !== 'not_found') {
        this.cache.set(cacheKey, doc);
        return doc;
      }
    }

    // 3. Fallback to Musixmatch (synced LRC or plain lyrics via local backend proxy)
    const mxmDoc = await this.fetchMusixmatchDocument(
      query.trackId,
      cleanTitle,
      cleanArtist,
      query.durationSec,
      signal
    );
    if (mxmDoc && mxmDoc.status !== 'not_found') {
      this.cache.set(cacheKey, mxmDoc);
      return mxmDoc;
    }

    // 4. Fallback to YTMusic plain lyrics
    if (this.musicProvider) {
      try {
        const plainText = await this.musicProvider.getPlainLyricsFallback(query.trackId, signal);
        if (plainText && plainText.trim().length > 0) {
          const plainLines = plainText
            .replace(/\r\n?/g, '\n')
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line.length > 0);
          if (plainLines.length > 0) {
            const fallbackDoc: LyricsDocument = {
              trackId: query.trackId,
              source: 'ytmusic',
              status: 'plain',
              offsetMs: 0,
              lines: [],
              plainLines,
              fetchedAtMs: Date.now(),
            };
            this.cache.set(cacheKey, fallbackDoc);
            return fallbackDoc;
          }
        }
      } catch {
        // Proceed to not_found
      }
    }

    const notFoundDoc: LyricsDocument = {
      trackId: query.trackId,
      source: 'none',
      status: 'not_found',
      offsetMs: 0,
      lines: [],
      plainLines: [],
      fetchedAtMs: Date.now(),
    };
    return notFoundDoc;
  }

  private buildHeaders(): Record<string, string> {
    const isBrowser = typeof window !== 'undefined' && typeof window.document !== 'undefined';
    if (isBrowser) {
      return {
        Accept: 'application/json',
        'Lrclib-Client': LRCLIB_CLIENT_HEADER,
      };
    }
    return {
      Accept: 'application/json',
      'Lrclib-Client': LRCLIB_CLIENT_HEADER,
      'User-Agent': LRCLIB_CLIENT_HEADER,
    };
  }

  private async fetchJsonSafe<T>(url: string, signal?: AbortSignal): Promise<T | null> {
    try {
      const response = await this.fetchFn(url, {
        method: 'GET',
        headers: this.buildHeaders(),
        signal,
      });

      if (response.status === 429) {
        const retryAfterRaw = response.headers.get('retry-after');
        const retrySec = retryAfterRaw ? Number.parseFloat(retryAfterRaw) : 0.4;
        const waitMs = Math.min(2000, Math.max(150, (Number.isFinite(retrySec) ? retrySec : 0.4) * 1000));
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        const retryRes = await this.fetchFn(url, {
          method: 'GET',
          headers: this.buildHeaders(),
          signal,
        });
        if (!retryRes.ok) return null;
        const ct = retryRes.headers.get('content-type') ?? '';
        if (!ct.includes('json')) return null;
        return (await retryRes.json()) as T;
      }

      if (!response.ok) {
        return null;
      }

      const contentType = response.headers.get('content-type') ?? '';
      if (contentType && !contentType.includes('json')) {
        return null;
      }

      return (await response.json()) as T;
    } catch {
      return null;
    }
  }

  private async fetchExactRecord(
    title: string,
    artist: string,
    album?: string,
    durationSec?: number,
    signal?: AbortSignal
  ): Promise<LrclibApiRecord | null> {
    const params = new URLSearchParams({
      track_name: title,
      artist_name: artist,
    });
    if (album && album.trim().length > 0) {
      params.set('album_name', album.trim());
    }
    if (durationSec && Number.isFinite(durationSec) && durationSec > 0) {
      params.set('duration', String(Math.round(durationSec)));
    }
    const record = await this.fetchJsonSafe<LrclibApiRecord>(`${this.baseUrl}/api/get?${params.toString()}`, signal);
    if (!record) return null;
    if (
      durationSec &&
      durationSec > 0 &&
      typeof record.duration === 'number' &&
      Math.abs(record.duration - durationSec) > 3
    ) {
      return null;
    }
    return record;
  }

  private async fetchSearchBestMatch(
    title: string,
    artist: string,
    durationSec?: number,
    signal?: AbortSignal
  ): Promise<LrclibApiRecord | null> {
    const params = new URLSearchParams({
      q: `${title} ${artist}`.trim(),
    });
    const list = await this.fetchJsonSafe<LrclibApiRecord[]>(`${this.baseUrl}/api/search?${params.toString()}`, signal);
    if (!Array.isArray(list) || list.length === 0) return null;

    const normTitle = normalizeSearchText(title);
    const normArtist = normalizeSearchText(artist);
    const artistVariants = [
      normArtist,
      ...(LYRIC_ARTIST_ALIASES[normArtist] ?? []),
    ].filter(Boolean);

    let best: LrclibApiRecord | null = null;
    let bestScore = -Infinity;

    for (const candidate of list) {
      const candTitle = normalizeSearchText(candidate.trackName ?? '');
      const candArtist = normalizeSearchText(candidate.artistName ?? '');
      if (!candTitle || !candArtist) continue;

      let titleScore = 0;
      if (candTitle === normTitle) titleScore = 5;
      else if (candTitle.includes(normTitle) || normTitle.includes(candTitle)) titleScore = 3;

      let artistScore = 0;
      if (artistVariants.some((v) => candArtist === v)) artistScore = 4;
      else if (artistVariants.some((v) => candArtist.includes(v) || v.includes(candArtist))) {
        artistScore = 2.5;
      }

      // Require BOTH title and artist match so we never show unrelated foreign song lyrics
      if (titleScore === 0 || artistScore === 0) {
        continue;
      }

      let score = titleScore + artistScore;

      if (typeof candidate.syncedLyrics === 'string' && candidate.syncedLyrics.trim().length > 0) {
        score += 3;
      } else if (typeof candidate.plainLyrics === 'string' && candidate.plainLyrics.trim().length > 0) {
        score += 1;
      }

      if (durationSec && durationSec > 0 && typeof candidate.duration === 'number') {
        const diff = Math.abs(candidate.duration - durationSec);
        if (diff <= 2) score += 3;
        else if (diff <= 6) score += 1.5;
        else if (diff > 20) score -= 4;
      }

      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }

    return bestScore >= 5 ? best : null;
  }

  private async fetchMusixmatchDocument(
    trackId: string,
    title: string,
    artist: string,
    durationSec?: number,
    signal?: AbortSignal
  ): Promise<LyricsDocument | null> {
    try {
      let payload: MusixmatchLyricsPayload | null = null;
      if (this.musixmatchFetcher) {
        payload = await this.musixmatchFetcher(title, artist, durationSec, signal);
      } else if (this.musicProvider?.getMusixmatchLyrics) {
        payload = await this.musicProvider.getMusixmatchLyrics(title, artist, durationSec, signal);
      } else {
        const params = new URLSearchParams({ title, artist });
        if (durationSec && Number.isFinite(durationSec) && durationSec > 0) {
          params.set('duration', String(Math.round(durationSec)));
        }
        payload = await this.fetchJsonSafe<MusixmatchLyricsPayload>(
          `/api/lyrics/musixmatch?${params.toString()}`,
          signal
        );
      }
      if (!payload) return null;
      if (!payload.syncedLyrics && !payload.plainLyrics) return null;
      const doc = this.recordToDocument(
        trackId,
        {
          syncedLyrics: payload.syncedLyrics ?? null,
          plainLyrics: payload.plainLyrics ?? null,
        },
        'musixmatch'
      );
      return doc.status !== 'not_found' ? doc : null;
    } catch {
      return null;
    }
  }

  private recordToDocument(
    trackId: string,
    record: LrclibApiRecord,
    source: 'lrclib' | 'musixmatch' = 'lrclib'
  ): LyricsDocument {
    if (record.instrumental) {
      return {
        trackId,
        source,
        status: 'instrumental',
        lrclibId: record.id,
        offsetMs: 0,
        lines: [],
        plainLines: ['♪ Instrumental ♪'],
        fetchedAtMs: Date.now(),
      };
    }

    if (
      typeof record.syncedLyrics === 'string' &&
      record.syncedLyrics.trim().length > 0 &&
      isAuthenticLyricsText(record.syncedLyrics)
    ) {
      const parsed = this.parser.parse(record.syncedLyrics);
      if (parsed.lines.length > 0) {
        const plainLines =
          typeof record.plainLyrics === 'string' &&
          record.plainLyrics.trim().length > 0 &&
          isAuthenticLyricsText(record.plainLyrics)
            ? record.plainLyrics
                .replace(/\r\n?/g, '\n')
                .split('\n')
                .map((l) => l.trim())
                .filter(Boolean)
            : parsed.lines.map((l) => l.text);
        return {
          trackId,
          source,
          status: 'synced',
          lrclibId: record.id,
          offsetMs: parsed.offsetMs,
          lines: parsed.lines,
          plainLines,
          fetchedAtMs: Date.now(),
        };
      }
    }

    if (
      typeof record.plainLyrics === 'string' &&
      record.plainLyrics.trim().length > 0 &&
      isAuthenticLyricsText(record.plainLyrics)
    ) {
      const plainLines = record.plainLyrics
        .replace(/\r\n?/g, '\n')
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
      if (plainLines.length > 0) {
        return {
          trackId,
          source,
          status: 'plain',
          lrclibId: record.id,
          offsetMs: 0,
          lines: [],
          plainLines,
          fetchedAtMs: Date.now(),
        };
      }
    }

    return {
      trackId,
      source: 'none',
      status: 'not_found',
      offsetMs: 0,
      lines: [],
      plainLines: [],
      fetchedAtMs: Date.now(),
    };
  }
}
