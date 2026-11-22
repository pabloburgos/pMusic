export interface LrcWordTiming {
  startTimeMs: number;
  endTimeMs?: number;
  text: string;
}

export interface LyricLine {
  index: number;
  timeMs: number;
  endTimeMs?: number;
  text: string;
  isInterlude: boolean;
  words?: LrcWordTiming[];
}

export type LyricsSource = 'lrclib' | 'musixmatch' | 'ytmusic' | 'none';
export type LyricsStatus = 'synced' | 'plain' | 'instrumental' | 'not_found';

export interface LyricsDocument {
  trackId: string;
  source: LyricsSource;
  status: LyricsStatus;
  lrclibId?: number;
  offsetMs: number;
  /** Non-empty when `status === 'synced'` */
  lines: LyricLine[];
  /** Non-empty when `status === 'plain'` or plain fallback available */
  plainLines: string[];
  fetchedAtMs: number;
}

export interface LyricsQuery {
  trackId: string;
  title: string;
  artist: string;
  album?: string;
  durationSec?: number;
}

export interface ILyricsProvider {
  getLyrics(query: LyricsQuery, signal?: AbortSignal): Promise<LyricsDocument>;
}

export interface LrcParseResult {
  metadata: Record<string, string>;
  offsetMs: number;
  lines: LyricLine[];
}

export interface ILrcParser {
  parse(rawLrc: string): LrcParseResult;
  /** O(log N) binary search; returns -1 before first lyric line or when empty */
  findActiveLineIndex(lines: readonly LyricLine[], currentTimeMs: number): number;
}
