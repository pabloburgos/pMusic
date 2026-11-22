import type { ILrcParser, LrcParseResult, LrcWordTiming, LyricLine } from '@pmusic/core';

const TIME_TAG_GLOBAL_RE = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
const META_TAG_RE = /^\[([a-zA-Z_]+):([^\]]*)\]$/;
const WORD_TAG_RE = /<(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?>([^<]*)/g;
const INTERLUDE_TEXT_RE = /^(?:[♪♫♬♩\s•·…-]+|\[(?:instrumental|interludio|música|music)\])$/i;

function parseTimeMs(minRaw: string, secRaw: string, fracRaw?: string): number {
  const minutes = Number.parseInt(minRaw, 10);
  const seconds = Number.parseInt(secRaw, 10);
  let millis = 0;
  if (fracRaw !== undefined && fracRaw.length > 0) {
    if (fracRaw.length === 1) {
      millis = Number.parseInt(fracRaw, 10) * 100;
    } else if (fracRaw.length === 2) {
      millis = Number.parseInt(fracRaw, 10) * 10;
    } else {
      millis = Number.parseInt(fracRaw.slice(0, 3), 10);
    }
  }
  return minutes * 60_000 + seconds * 1_000 + millis;
}

function parseWordTimings(rawText: string, offsetMs: number): { cleanText: string; words?: LrcWordTiming[] } {
  if (!rawText.includes('<') || !rawText.includes('>')) {
    return { cleanText: rawText.trim() };
  }
  const words: LrcWordTiming[] = [];
  let match: RegExpExecArray | null;
  WORD_TAG_RE.lastIndex = 0;
  while ((match = WORD_TAG_RE.exec(rawText)) !== null) {
    const startMs = Math.max(0, parseTimeMs(match[1]!, match[2]!, match[3]) - offsetMs);
    const wordText = (match[4] ?? '').trim();
    if (wordText.length > 0) {
      words.push({ startTimeMs: startMs, text: wordText });
    }
  }
  if (words.length === 0) {
    return { cleanText: rawText.replace(/<[^>]+>/g, '').trim() };
  }
  for (let i = 0; i < words.length - 1; i++) {
    words[i] = {
      ...words[i]!,
      endTimeMs: words[i + 1]!.startTimeMs,
    };
  }
  const cleanText = words.map((w) => w.text).join(' ').trim();
  return { cleanText, words };
}

export class LrcParser implements ILrcParser {
  public parse(rawLrc: string): LrcParseResult {
    const metadata: Record<string, string> = {};
    let offsetMs = 0;

    if (typeof rawLrc !== 'string' || rawLrc.trim().length === 0) {
      return { metadata, offsetMs: 0, lines: [] };
    }

    const rawLines = rawLrc.replace(/\r\n?/g, '\n').split('\n');
    const preliminary: Array<{ timeMs: number; rawText: string; order: number }> = [];
    let orderCounter = 0;

    for (const rawLine of rawLines) {
      const trimmed = rawLine.trim();
      if (!trimmed) continue;

      TIME_TAG_GLOBAL_RE.lastIndex = 0;
      const timestamps: number[] = [];
      let lastIndex = 0;
      let match: RegExpExecArray | null;

      while ((match = TIME_TAG_GLOBAL_RE.exec(trimmed)) !== null) {
        timestamps.push(parseTimeMs(match[1]!, match[2]!, match[3]));
        lastIndex = TIME_TAG_GLOBAL_RE.lastIndex;
      }

      if (timestamps.length === 0) {
        const metaMatch = META_TAG_RE.exec(trimmed);
        if (metaMatch && metaMatch[1] && metaMatch[2] !== undefined) {
          const key = metaMatch[1].toLowerCase().trim();
          const val = metaMatch[2].trim();
          metadata[key] = val;
          if (key === 'offset') {
            const parsedOffset = Number.parseInt(val, 10);
            if (Number.isFinite(parsedOffset)) {
              offsetMs = parsedOffset;
            }
          }
        }
        continue;
      }

      const textAfterTags = trimmed.slice(lastIndex).trim();
      for (const ts of timestamps) {
        preliminary.push({
          timeMs: ts,
          rawText: textAfterTags,
          order: orderCounter++,
        });
      }
    }

    preliminary.sort((a, b) => (a.timeMs !== b.timeMs ? a.timeMs - b.timeMs : a.order - b.order));

    const lines: LyricLine[] = preliminary.map((item, idx) => {
      const adjustedTimeMs = Math.max(0, item.timeMs - offsetMs);
      const { cleanText, words } = parseWordTimings(item.rawText, offsetMs);
      const isInterlude = cleanText.length === 0 || INTERLUDE_TEXT_RE.test(cleanText);
      const displayText = isInterlude && cleanText.length === 0 ? '♪' : cleanText;

      return {
        index: idx,
        timeMs: adjustedTimeMs,
        text: displayText,
        isInterlude,
        ...(words ? { words } : {}),
      };
    });

    for (let i = 0; i < lines.length - 1; i++) {
      const current = lines[i]!;
      const next = lines[i + 1]!;
      lines[i] = {
        ...current,
        endTimeMs: next.timeMs,
      };
    }

    return { metadata, offsetMs, lines };
  }

  public findActiveLineIndex(lines: readonly LyricLine[], currentTimeMs: number): number {
    if (!lines || lines.length === 0 || !Number.isFinite(currentTimeMs) || currentTimeMs < 0) {
      return -1;
    }
    if (currentTimeMs < lines[0]!.timeMs) {
      return -1;
    }

    let low = 0;
    let high = lines.length - 1;
    let result = -1;

    while (low <= high) {
      const mid = (low + high) >>> 1;
      const lineTime = lines[mid]!.timeMs;
      if (lineTime <= currentTimeMs) {
        result = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    return result;
  }
}

export const defaultLrcParser = new LrcParser();
