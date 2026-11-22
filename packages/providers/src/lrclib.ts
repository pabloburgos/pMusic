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

export interface LrclibProviderOptions {
  baseUrl?: string;
  parser?: ILrcParser;
  musicProvider?: Pick<IMusicProvider, 'getPlainLyricsFallback'>;
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

export class LrclibLyricsProvider implements ILyricsProvider {
  private readonly baseUrl: string;
  private readonly parser: ILrcParser;
  private readonly musicProvider?: Pick<IMusicProvider, 'getPlainLyricsFallback'>;
  private readonly fetchFn: typeof fetch;
  private readonly cacheTtlMs: number;
  private readonly cache = new Map<string, LyricsDocument>();

  public constructor(options: LrclibProviderOptions = {}) {
    this.baseUrl = (options.baseUrl ?? 'https://lrclib.net').replace(/\/+$/, '');
    this.parser = options.parser ?? defaultLrcParser;
    this.musicProvider = options.musicProvider;
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

    // 3. Fallback to YTMusic plain lyrics
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

    let best: LrclibApiRecord | null = null;
    let bestScore = -Infinity;

    for (const candidate of list) {
      const candTitle = normalizeSearchText(candidate.trackName ?? '');
      const candArtist = normalizeSearchText(candidate.artistName ?? '');
      let score = 0;

      if (candTitle === normTitle) score += 5;
      else if (candTitle.includes(normTitle) || normTitle.includes(candTitle)) score += 3;

      if (candArtist === normArtist) score += 4;
      else if (candArtist.includes(normArtist) || normArtist.includes(candArtist)) score += 2.5;

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

    return bestScore >= 2 ? best : null;
  }

  private recordToDocument(trackId: string, record: LrclibApiRecord): LyricsDocument {
    if (record.instrumental) {
      return {
        trackId,
        source: 'lrclib',
        status: 'instrumental',
        lrclibId: record.id,
        offsetMs: 0,
        lines: [],
        plainLines: ['♪ Instrumental ♪'],
        fetchedAtMs: Date.now(),
      };
    }

    if (typeof record.syncedLyrics === 'string' && record.syncedLyrics.trim().length > 0) {
      const parsed = this.parser.parse(record.syncedLyrics);
      if (parsed.lines.length > 0) {
        const plainLines =
          typeof record.plainLyrics === 'string' && record.plainLyrics.trim().length > 0
            ? record.plainLyrics
                .replace(/\r\n?/g, '\n')
                .split('\n')
                .map((l) => l.trim())
                .filter(Boolean)
            : parsed.lines.map((l) => l.text);
        return {
          trackId,
          source: 'lrclib',
          status: 'synced',
          lrclibId: record.id,
          offsetMs: parsed.offsetMs,
          lines: parsed.lines,
          plainLines,
          fetchedAtMs: Date.now(),
        };
      }
    }

    if (typeof record.plainLyrics === 'string' && record.plainLyrics.trim().length > 0) {
      const plainLines = record.plainLyrics
        .replace(/\r\n?/g, '\n')
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
      if (plainLines.length > 0) {
        return {
          trackId,
          source: 'lrclib',
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
