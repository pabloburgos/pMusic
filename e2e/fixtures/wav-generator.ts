/**
 * Deterministic 16-bit signed linear PCM RIFF/WAVE synthesizer and RFC 9110
 * byte-range slicer for opaque-box E2E audio playback, Web Audio API DSP,
 * EQ, Crossfade, and DJ AutoMix testing.
 *
 * Strictly zero external dependencies and zero randomness (`Math.random()`).
 */

export type RhythmPattern = 'reggaeton' | 'trap' | 'urban_pop' | 'quiet_intro_drop';

export interface WavGeneratorOptions {
  /** Target tempo in BPM (default: 96; clamped to 60..180). */
  bpm?: number | undefined;
  /** Synthesized audio duration in seconds (default: 10; clamped to 1..180). */
  durationSec?: number | undefined;
  /** Sample rate in Hz (default: 22050; clamped to 8000..48000). */
  sampleRate?: number | undefined;
  /** Number of audio channels (default: 1, mono). */
  channels?: 1 | 2 | undefined;
  /** Rhythmic synthesis pattern shaping kicks, bass, and harmonics. */
  pattern?: RhythmPattern | undefined;
  /** Fundamental sub-bass frequency in Hz (default: 58; clamped to 30..220). */
  baseFreqHz?: number | undefined;
  /** Peak amplitude scale in [0.05, 0.95] (default: 0.85). */
  amplitude?: number | undefined;
  /**
   * Apply structured 3-section RMS envelope:
   * intro (0..18%) -> drop/chorus (18..75%) -> outro (75..100%).
   * Default: true.
   */
  structuredEnvelope?: boolean | undefined;
}

export interface WavHeaderInfo {
  riff: string;
  chunkSize: number;
  wave: string;
  fmtTag: string;
  subchunk1Size: number;
  audioFormat: number;
  numChannels: number;
  sampleRate: number;
  byteRate: number;
  blockAlign: number;
  bitsPerSample: number;
  dataTag: string;
  dataByteLength: number;
  durationSec: number;
}

export interface RangeSliceResult {
  status: 200 | 206 | 416;
  headers: Record<string, string>;
  body: Buffer;
}

interface NormalizedWavOptions {
  bpm: number;
  durationSec: number;
  sampleRate: number;
  channels: 1 | 2;
  pattern: RhythmPattern;
  baseFreqHz: number;
  amplitude: number;
  structuredEnvelope: boolean;
}

const HEADER_BYTE_LENGTH = 44;
const BYTES_PER_SAMPLE = 2;
const BITS_PER_SAMPLE = 16;
const PCM_AUDIO_FORMAT = 1;
const FMT_CHUNK_SIZE = 16;
const TWO_PI = 2 * Math.PI;

const wavCache = new Map<string, Buffer>();

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function normalizeOptions(options?: WavGeneratorOptions): NormalizedWavOptions {
  const bpm = clamp(options?.bpm ?? 96, 60, 180);
  const durationSec = clamp(options?.durationSec ?? 10, 1, 180);
  const sampleRate = Math.round(clamp(options?.sampleRate ?? 22050, 8000, 48000));
  const channels: 1 | 2 = options?.channels === 2 ? 2 : 1;
  const pattern: RhythmPattern = options?.pattern ?? 'reggaeton';
  const baseFreqHz = clamp(options?.baseFreqHz ?? 58, 30, 220);
  const amplitude = clamp(options?.amplitude ?? 0.85, 0.05, 0.95);
  const structuredEnvelope = options?.structuredEnvelope ?? true;

  return {
    bpm,
    durationSec,
    sampleRate,
    channels,
    pattern,
    baseFreqHz,
    amplitude,
    structuredEnvelope,
  };
}

function makeCacheKey(opts: NormalizedWavOptions): string {
  return [
    opts.bpm.toFixed(2),
    opts.durationSec.toFixed(3),
    opts.sampleRate,
    opts.channels,
    opts.pattern,
    opts.baseFreqHz.toFixed(2),
    opts.amplitude.toFixed(3),
    opts.structuredEnvelope ? '1' : '0',
  ].join('|');
}

function safeSin(freqHz: number, t: number, nyquistHz: number, phase = 0): number {
  if (freqHz >= nyquistHz) return 0;
  return Math.sin(TWO_PI * freqHz * t + phase);
}

/**
 * Generates a deterministic 16-bit signed linear PCM RIFF/WAVE Buffer with a
 * 44-byte little-endian header, beat-accurate rhythmic content, multi-band
 * spectral harmonics, and a 3-section intro -> drop -> outro RMS envelope.
 */
export function generateWavBuffer(options?: WavGeneratorOptions): Buffer {
  const opts = normalizeOptions(options);
  const key = makeCacheKey(opts);
  const cached = wavCache.get(key);
  if (cached) {
    return cached;
  }

  const numSamples = Math.max(1, Math.round(opts.sampleRate * opts.durationSec));
  const blockAlign = opts.channels * BYTES_PER_SAMPLE;
  const byteRate = opts.sampleRate * blockAlign;
  const dataByteLength = numSamples * blockAlign;
  const totalByteLength = HEADER_BYTE_LENGTH + dataByteLength;

  const buf = Buffer.allocUnsafe(totalByteLength);

  // 44-byte RIFF/WAVE header (little-endian)
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataByteLength, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(FMT_CHUNK_SIZE, 16);
  buf.writeUInt16LE(PCM_AUDIO_FORMAT, 20);
  buf.writeUInt16LE(opts.channels, 22);
  buf.writeUInt32LE(opts.sampleRate, 24);
  buf.writeUInt32LE(byteRate, 28);
  buf.writeUInt16LE(blockAlign, 32);
  buf.writeUInt16LE(BITS_PER_SAMPLE, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataByteLength, 40);

  const beatPeriod = 60 / opts.bpm;
  const halfBeatPeriod = beatPeriod / 2;
  const nyquistHz = opts.sampleRate * 0.48;
  const baseFreq = opts.baseFreqHz;

  let offset = HEADER_BYTE_LENGTH;

  for (let i = 0; i < numSamples; i++) {
    const t = i / opts.sampleRate;
    const tau = t % beatPeriod;
    const beatPos = tau / beatPeriod;

    // Primary beat kick anchoring periodic autocorrelation BPM detection
    const kick =
      tau < 0.14
        ? Math.sin(TWO_PI * (52 * tau + (120 * (1 - Math.exp(-tau * 35))) / 35)) *
          Math.exp(-tau * 18)
        : 0;

    let layer = 0;
    let rightDelta = 0;

    switch (opts.pattern) {
      case 'reggaeton': {
        // Dembow snare accents + steady sub-bass + upper presence harmonics
        const dembowHit =
          (beatPos >= 0.375 && beatPos < 0.435) || (beatPos >= 0.75 && beatPos < 0.81);
        const snare = dembowHit
          ? 0.42 * safeSin(230, t, nyquistHz) +
            0.22 * safeSin(910, t, nyquistHz) +
            0.12 * safeSin(3600, t, nyquistHz)
          : 0;
        const subBass = 0.35 * safeSin(baseFreq, t, nyquistHz);
        const pad = 0.1 * safeSin(440, t, nyquistHz) + 0.05 * safeSin(2200, t, nyquistHz);
        layer = 0.55 * kick + snare + subBass + pad;
        rightDelta = 0.04 * safeSin(440, t, nyquistHz, 0.7);
        break;
      }

      case 'trap': {
        // Sustained 808 sub-bass + crisp 16th-note hi-hat pulses
        const sub808 = 0.45 * safeSin(55, t, nyquistHz) * Math.exp(-tau * 2.5);
        const hatWindow = t % halfBeatPeriod < 0.025;
        const hiHat = hatWindow
          ? 0.28 * safeSin(3600, t, nyquistHz) + 0.16 * safeSin(7200, t, nyquistHz)
          : 0;
        const midAccent =
          beatPos >= 0.5 && beatPos < 0.56 ? 0.3 * safeSin(910, t, nyquistHz) : 0;
        layer = 0.52 * kick + sub808 + hiHat + midAccent;
        rightDelta = hatWindow ? 0.05 * safeSin(3600, t, nyquistHz, 1.1) : 0;
        break;
      }

      case 'urban_pop': {
        // Punchy kick + warm triadic chords across low-mid/mid/high EQ bands
        const triad =
          0.22 * safeSin(220, t, nyquistHz) +
          0.16 * safeSin(330, t, nyquistHz) +
          0.11 * safeSin(880, t, nyquistHz) +
          0.07 * safeSin(3520, t, nyquistHz);
        const bass = 0.28 * safeSin(baseFreq, t, nyquistHz);
        layer = 0.5 * kick + bass + triad;
        rightDelta = 0.05 * safeSin(330, t, nyquistHz, 0.9);
        break;
      }

      case 'quiet_intro_drop': {
        // Strong contrast between sparse intro and dense chorus drop
        const sub = 0.38 * safeSin(baseFreq, t, nyquistHz);
        const chord =
          0.24 * safeSin(230, t, nyquistHz) +
          0.15 * safeSin(910, t, nyquistHz) +
          0.09 * safeSin(3600, t, nyquistHz);
        layer = 0.58 * kick + sub + chord;
        rightDelta = 0.04 * safeSin(910, t, nyquistHz, 0.8);
        break;
      }
    }

    // 3-section RMS envelope (intro -> drop/chorus -> outro)
    let env = 1.0;
    if (opts.structuredEnvelope) {
      const ratio = t / opts.durationSec;
      if (opts.pattern === 'quiet_intro_drop') {
        if (ratio < 0.18) {
          env = 0.18 + 0.08 * (ratio / 0.18);
        } else if (ratio < 0.75) {
          env = 1.0;
        } else {
          env = 0.55 - 0.3 * ((ratio - 0.75) / 0.25);
        }
      } else {
        if (ratio < 0.18) {
          env = 0.3 + 0.15 * (ratio / 0.18);
        } else if (ratio < 0.75) {
          env = 1.0;
        } else {
          env = 0.7 - 0.45 * ((ratio - 0.75) / 0.25);
        }
      }
    }

    const leftSample = clamp(layer * env * opts.amplitude, -1, 1);
    buf.writeInt16LE(Math.round(leftSample * 32767), offset);
    offset += BYTES_PER_SAMPLE;

    if (opts.channels === 2) {
      const rightSample = clamp((layer + rightDelta) * env * opts.amplitude, -1, 1);
      buf.writeInt16LE(Math.round(rightSample * 32767), offset);
      offset += BYTES_PER_SAMPLE;
    }
  }

  wavCache.set(key, buf);
  return buf;
}

/**
 * Parses and validates the 44-byte RIFF/WAVE header of a PCM WAV Buffer.
 */
export function inspectWavHeader(buf: Buffer): WavHeaderInfo {
  if (buf.length < HEADER_BYTE_LENGTH) {
    throw new Error(`Invalid WAV buffer: expected at least 44 bytes, received ${buf.length}`);
  }

  const riff = buf.toString('ascii', 0, 4);
  const chunkSize = buf.readUInt32LE(4);
  const wave = buf.toString('ascii', 8, 12);
  const fmtTag = buf.toString('ascii', 12, 16);
  const subchunk1Size = buf.readUInt32LE(16);
  const audioFormat = buf.readUInt16LE(20);
  const numChannels = buf.readUInt16LE(22);
  const sampleRate = buf.readUInt32LE(24);
  const byteRate = buf.readUInt32LE(28);
  const blockAlign = buf.readUInt16LE(32);
  const bitsPerSample = buf.readUInt16LE(34);
  const dataTag = buf.toString('ascii', 36, 40);
  const dataByteLength = buf.readUInt32LE(40);
  const numFrames = blockAlign > 0 ? dataByteLength / blockAlign : 0;
  const durationSec = sampleRate > 0 ? numFrames / sampleRate : 0;

  return {
    riff,
    chunkSize,
    wave,
    fmtTag,
    subchunk1Size,
    audioFormat,
    numChannels,
    sampleRate,
    byteRate,
    blockAlign,
    bitsPerSample,
    dataTag,
    dataByteLength,
    durationSec,
  };
}

/**
 * Computes normalized RMS amplitude in [0, 1] across a 16-bit PCM WAV buffer's
 * data chunk (optionally sliced to `[startSec, endSec)`).
 */
export function computeWavRms(buf: Buffer, startSec?: number, endSec?: number): number {
  const header = inspectWavHeader(buf);
  const availableDataBytes = Math.min(header.dataByteLength, buf.length - HEADER_BYTE_LENGTH);
  if (availableDataBytes < BYTES_PER_SAMPLE || header.blockAlign <= 0) {
    return 0;
  }

  const totalFrames = Math.floor(availableDataBytes / header.blockAlign);
  const startFrame = Math.max(
    0,
    Math.min(totalFrames, Math.floor((startSec ?? 0) * header.sampleRate))
  );
  const endFrame = Math.max(
    startFrame,
    Math.min(
      totalFrames,
      endSec !== undefined ? Math.floor(endSec * header.sampleRate) : totalFrames
    )
  );

  let sumSq = 0;
  let count = 0;
  for (let frame = startFrame; frame < endFrame; frame++) {
    const base = HEADER_BYTE_LENGTH + frame * header.blockAlign;
    for (let ch = 0; ch < header.numChannels; ch++) {
      const sample = buf.readInt16LE(base + ch * BYTES_PER_SAMPLE) / 32768;
      sumSq += sample * sample;
      count++;
    }
  }

  return count > 0 ? Math.sqrt(sumSq / count) : 0;
}

/**
 * RFC 9110 §14.1.2 byte-range slicer returning 200, 206, or 416 with mandatory
 * Web Audio API CORS + Range exposure headers.
 */
export function sliceRange(
  buf: Buffer,
  rangeHeader?: string | null,
  contentType = 'audio/wav'
): RangeSliceResult {
  const total = buf.length;
  const baseHeaders: Record<string, string> = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
    'Accept-Ranges': 'bytes',
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
  };

  const trimmed = rangeHeader?.trim() ?? '';
  if (!trimmed || !/^bytes=/i.test(trimmed)) {
    return {
      status: 200,
      headers: {
        ...baseHeaders,
        'Content-Length': String(total),
      },
      body: buf,
    };
  }

  // RFC-valid simplification for multi-range headers: return full 200 payload
  if (trimmed.includes(',')) {
    return {
      status: 200,
      headers: {
        ...baseHeaders,
        'Content-Length': String(total),
      },
      body: buf,
    };
  }

  const make416 = (): RangeSliceResult => ({
    status: 416,
    headers: {
      ...baseHeaders,
      'Content-Range': `bytes */${total}`,
      'Content-Length': '0',
    },
    body: Buffer.alloc(0),
  });

  if (total === 0) {
    return make416();
  }

  const match = /^bytes=(\d*)-(\d*)$/i.exec(trimmed);
  if (!match) {
    return make416();
  }

  const rawStart = match[1] ?? '';
  const rawEnd = match[2] ?? '';
  if (rawStart === '' && rawEnd === '') {
    return make416();
  }

  let start: number;
  let end: number;

  if (rawStart === '') {
    // Suffix byte-range: bytes=-N
    const suffixLength = Number.parseInt(rawEnd, 10);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) {
      return make416();
    }
    start = Math.max(0, total - suffixLength);
    end = total - 1;
  } else if (rawEnd === '') {
    // Open-ended byte-range: bytes=start-
    start = Number.parseInt(rawStart, 10);
    if (!Number.isFinite(start) || start < 0 || start >= total) {
      return make416();
    }
    end = total - 1;
  } else {
    // Explicit byte-range: bytes=start-end
    start = Number.parseInt(rawStart, 10);
    const parsedEnd = Number.parseInt(rawEnd, 10);
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(parsedEnd) ||
      start < 0 ||
      start >= total ||
      start > parsedEnd
    ) {
      return make416();
    }
    end = Math.min(parsedEnd, total - 1);
  }

  const slice = buf.subarray(start, end + 1);
  return {
    status: 206,
    headers: {
      ...baseHeaders,
      'Content-Range': `bytes ${start}-${end}/${total}`,
      'Content-Length': String(slice.length),
    },
    body: slice,
  };
}

/**
 * Clears the in-memory memoized WAV buffer cache.
 */
export function clearWavCache(): void {
  wavCache.clear();
}
