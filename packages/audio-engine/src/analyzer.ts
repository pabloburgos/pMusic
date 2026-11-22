import type { TrackAnalysis } from '@pmusic/core';

export interface AnalysisCache {
  get(trackId: string): Promise<TrackAnalysis | undefined>;
  set(analysis: TrackAnalysis): Promise<void>;
  clear(): Promise<void>;
}

const CAMELOT_KEYS = [
  '1A', '2A', '3A', '4A', '5A', '6A', '7A', '8A', '9A', '10A', '11A', '12A',
  '1B', '2B', '3B', '4B', '5B', '6B', '7B', '8B', '9B', '10B', '11B', '12B',
] as const;

function hashTrackId(trackId: string): number {
  let h = 2166136261;
  for (let i = 0; i < trackId.length; i++) {
    h ^= trackId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function createAnalysisCache(): AnalysisCache {
  const memory = new Map<string, TrackAnalysis>();
  return {
    async get(trackId: string): Promise<TrackAnalysis | undefined> {
      return memory.get(trackId);
    },
    async set(analysis: TrackAnalysis): Promise<void> {
      memory.set(analysis.trackId, analysis);
    },
    async clear(): Promise<void> {
      memory.clear();
    },
  };
}

export class PcmTrackAnalyzer {
  private readonly cache: AnalysisCache;

  public constructor(cache: AnalysisCache = createAnalysisCache()) {
    this.cache = cache;
  }

  public async analyzeTrack(
    trackId: string,
    audioData: ArrayBuffer | null,
    durationSec: number
  ): Promise<TrackAnalysis> {
    const cached = await this.cache.get(trackId);
    if (cached) return cached;

    const safeDuration = Number.isFinite(durationSec) && durationSec > 10 ? durationSec : 195;
    let analysis: TrackAnalysis;

    if (audioData && audioData.byteLength > 128) {
      analysis = this.analyzePcmBuffer(trackId, audioData, safeDuration);
    } else {
      analysis = this.analyzeHeuristic(trackId, safeDuration);
    }

    await this.cache.set(analysis);
    return analysis;
  }

  private analyzePcmBuffer(
    trackId: string,
    audioData: ArrayBuffer,
    durationSec: number
  ): TrackAnalysis {
    const view = new DataView(audioData);
    const isRiffWav =
      audioData.byteLength > 44 &&
      view.getUint8(0) === 0x52 && // 'R'
      view.getUint8(1) === 0x49 && // 'I'
      view.getUint8(2) === 0x46 && // 'F'
      view.getUint8(3) === 0x46;   // 'F'

    const headerOffset = isRiffWav ? 44 : 0;
    const sampleRate = isRiffWav ? Math.max(8000, view.getUint32(24, true)) : 22050;
    const sampleCount = Math.floor((audioData.byteLength - headerOffset) / 2);

    if (sampleCount < 2048) {
      return this.analyzeHeuristic(trackId, durationSec);
    }

    const windowSamples = Math.max(256, Math.floor(sampleRate / 10)); // 10Hz energy windows
    const numWindows = Math.max(1, Math.floor(sampleCount / windowSamples));
    const windowEnergies: number[] = [];

    let maxRms = 1e-6;
    let sumRms = 0;

    for (let w = 0; w < numWindows; w++) {
      let sqSum = 0;
      const baseIdx = headerOffset + w * windowSamples * 2;
      for (let i = 0; i < windowSamples; i++) {
        const bytePos = baseIdx + i * 2;
        if (bytePos + 1 >= audioData.byteLength) break;
        const sample = view.getInt16(bytePos, true) / 32768;
        sqSum += sample * sample;
      }
      const rms = Math.sqrt(sqSum / windowSamples);
      windowEnergies.push(rms);
      if (rms > maxRms) maxRms = rms;
      sumRms += rms;
    }

    const normalized10Hz = windowEnergies.map((e) => Math.min(1, Number((e / maxRms).toFixed(3))));

    // Downsample to ~1Hz envelope (capped between 16 and 240 bins)
    const targetBins = Math.max(16, Math.min(240, Math.round(durationSec)));
    const rmsEnvelope: number[] = [];
    for (let b = 0; b < targetBins; b++) {
      const idx = Math.min(
        normalized10Hz.length - 1,
        Math.floor((b / targetBins) * normalized10Hz.length)
      );
      rmsEnvelope.push(normalized10Hz[idx] ?? 0.5);
    }

    // Autocorrelation over onset flux in 10Hz envelope for BPM [65..175]
    const onsetFlux: number[] = [];
    for (let i = 1; i < normalized10Hz.length; i++) {
      const diff = (normalized10Hz[i] ?? 0) - (normalized10Hz[i - 1] ?? 0);
      onsetFlux.push(diff > 0 ? diff : 0);
    }

    let bestBpm = 120;
    let bestCorr = -1;
    for (let candidateBpm = 70; candidateBpm <= 170; candidateBpm += 2) {
      const lag = Math.max(1, Math.round((60 / candidateBpm) * 10));
      let corr = 0;
      let count = 0;
      for (let i = 0; i + lag < onsetFlux.length; i++) {
        corr += (onsetFlux[i] ?? 0) * (onsetFlux[i + lag] ?? 0);
        count++;
      }
      const avgCorr = count > 0 ? corr / count : 0;
      if (avgCorr > bestCorr) {
        bestCorr = avgCorr;
        bestBpm = candidateBpm;
      }
    }

    const bpm = Math.max(65, Math.min(175, bestBpm));
    const meanEnergy = Math.min(1, Math.max(0.1, Number(((sumRms / numWindows) / maxRms).toFixed(3))));
    const peakEnergy = 1;

    const structure = this.detectStructureFromEnvelope(rmsEnvelope, durationSec);
    const h = hashTrackId(trackId);
    const camelotKey = CAMELOT_KEYS[h % CAMELOT_KEYS.length];

    return {
      trackId,
      durationSec,
      bpm,
      bpmConfidence: 0.86,
      meanEnergy,
      peakEnergy,
      rmsEnvelope,
      ...structure,
      camelotKey,
      loudnessDb: -1.8,
      source: 'pcm',
      analyzedAtMs: Date.now(),
    };
  }

  private analyzeHeuristic(trackId: string, durationSec: number): TrackAnalysis {
    const h = hashTrackId(trackId);
    const bpmOptions = [94, 98, 102, 108, 114, 120, 124, 128, 134, 140];
    const bpm = bpmOptions[h % bpmOptions.length] ?? 120;
    const meanEnergy = Number((0.55 + ((h >>> 4) % 35) / 100).toFixed(2));
    const peakEnergy = Math.min(1, Number((meanEnergy + 0.18).toFixed(2)));
    const bins = Math.max(20, Math.min(180, Math.round(durationSec)));
    const rmsEnvelope: number[] = [];

    for (let i = 0; i < bins; i++) {
      const p = i / bins;
      let val: number;
      if (p < 0.12) {
        val = 0.32 + p * 2.5;
      } else if (p < 0.45) {
        val = peakEnergy - 0.08 * Math.sin(i * 0.7);
      } else if (p < 0.58) {
        val = meanEnergy * 0.85;
      } else if (p < 0.85) {
        val = peakEnergy - 0.05 * Math.cos(i * 0.5);
      } else {
        val = Math.max(0.2, 0.75 - (p - 0.85) * 3.2);
      }
      rmsEnvelope.push(Number(Math.max(0.1, Math.min(1, val)).toFixed(3)));
    }

    const structure = this.detectStructureFromEnvelope(rmsEnvelope, durationSec);
    const camelotKey = CAMELOT_KEYS[h % CAMELOT_KEYS.length];

    return {
      trackId,
      durationSec,
      bpm,
      bpmConfidence: 0.72,
      meanEnergy,
      peakEnergy,
      rmsEnvelope,
      ...structure,
      camelotKey,
      loudnessDb: -2.0,
      source: 'heuristic',
      analyzedAtMs: Date.now(),
    };
  }

  private detectStructureFromEnvelope(
    envelope: readonly number[],
    durationSec: number
  ): {
    introEndSec: number;
    primaryDropSec: number;
    chorusStartSec: number;
    chorusEndSec: number;
    outroStartSec: number;
  } {
    const introEndSec = Math.round(Math.min(24, Math.max(8, durationSec * 0.12)));

    // Find highest sustained energy window between 12% and 55% of the track
    const startBin = Math.floor(envelope.length * 0.12);
    const endBin = Math.max(startBin + 1, Math.floor(envelope.length * 0.55));
    let bestBin = startBin;
    let bestVal = -1;
    for (let i = startBin; i < endBin; i++) {
      const v = (envelope[i] ?? 0) + (envelope[i + 1] ?? 0);
      if (v > bestVal) {
        bestVal = v;
        bestBin = i;
      }
    }

    const rawDropSec = Math.round((bestBin / Math.max(1, envelope.length)) * durationSec);
    const primaryDropSec = Math.max(introEndSec, Math.min(Math.round(durationSec * 0.45), rawDropSec));
    const chorusStartSec = primaryDropSec;
    // Quick session plays 45-90s around the drop/chorus
    const chorusWindow = Math.min(72, Math.max(48, Math.round(durationSec * 0.36)));
    const chorusEndSec = Math.min(
      Math.round(durationSec - 12),
      chorusStartSec + chorusWindow
    );
    const outroStartSec = Math.max(
      chorusEndSec,
      Math.round(durationSec - Math.min(24, Math.max(10, durationSec * 0.14)))
    );

    return {
      introEndSec,
      primaryDropSec,
      chorusStartSec,
      chorusEndSec,
      outroStartSec,
    };
  }
}
