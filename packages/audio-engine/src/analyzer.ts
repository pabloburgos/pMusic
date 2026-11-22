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
    if (cached && (!audioData || cached.source === 'pcm')) {
      return cached;
    }

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

  public async analyzeEncodedAudio(
    trackId: string,
    encodedData: ArrayBuffer,
    durationSec: number
  ): Promise<TrackAnalysis> {
    const cached = await this.cache.get(trackId);
    if (cached && cached.source === 'pcm') {
      return cached;
    }

    const AudioCtxCtor =
      typeof window !== 'undefined'
        ? window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        : undefined;

    if (AudioCtxCtor && encodedData.byteLength > 1024) {
      let ctx: AudioContext | null = null;
      try {
        ctx = new AudioCtxCtor();
        const copy = encodedData.slice(0);
        const decoded = await ctx.decodeAudioData(copy);
        const ch0 = decoded.getChannelData(0);
        let mono: Float32Array;
        if (decoded.numberOfChannels > 1) {
          const ch1 = decoded.getChannelData(1);
          mono = new Float32Array(ch0.length);
          for (let i = 0; i < ch0.length; i++) {
            mono[i] = ((ch0[i] ?? 0) + (ch1[i] ?? 0)) * 0.5;
          }
        } else {
          mono = ch0;
        }
        const realDur =
          Number.isFinite(decoded.duration) && decoded.duration > 10
            ? decoded.duration
            : durationSec;
        return await this.analyzeFloatPcm(trackId, mono, decoded.sampleRate, realDur);
      } catch {
        // Fallback smoothly when container/codec cannot decode offline in sandbox
      } finally {
        if (ctx) {
          await ctx.close().catch(() => {});
        }
      }
    }

    return this.analyzeTrack(trackId, null, durationSec);
  }

  public async analyzeFloatPcm(
    trackId: string,
    monoSamples: Float32Array,
    sampleRate: number,
    durationSec: number
  ): Promise<TrackAnalysis> {
    const safeRate = Math.max(8000, sampleRate);
    const derivedDur = monoSamples.length / safeRate;
    const safeDuration =
      Number.isFinite(durationSec) && durationSec > 10
        ? durationSec
        : Math.max(20, derivedDur);

    const frameHz = 20; // 50ms windows for accurate transient + phrase tracking
    const frameSamples = Math.max(256, Math.floor(safeRate / frameHz));
    const numFrames = Math.floor(monoSamples.length / frameSamples);

    if (numFrames < 40) {
      const fallback = this.analyzeHeuristic(trackId, safeDuration);
      await this.cache.set(fallback);
      return fallback;
    }

    // 1-pole IIR lowpass @ ~180Hz to isolate kick & sub-bass pulse
    const lpAlpha = 1 - Math.exp((-2 * Math.PI * 180) / safeRate);
    let lpState = 0;

    const fullRms: number[] = new Array(numFrames);
    const bassRms: number[] = new Array(numFrames);
    const midRms: number[] = new Array(numFrames);

    let maxFull = 1e-6;
    let maxBass = 1e-6;
    let sumSqTotal = 0;
    let countTotal = 0;

    for (let f = 0; f < numFrames; f++) {
      let sqFull = 0;
      let sqBass = 0;
      let sqMid = 0;
      const start = f * frameSamples;
      for (let i = 0; i < frameSamples; i++) {
        const s = monoSamples[start + i] ?? 0;
        lpState += lpAlpha * (s - lpState);
        const low = lpState;
        const hi = s - low;
        sqFull += s * s;
        sqBass += low * low;
        sqMid += hi * hi;
      }
      sumSqTotal += sqFull;
      countTotal += frameSamples;

      const rFull = Math.sqrt(sqFull / frameSamples);
      const rBass = Math.sqrt(sqBass / frameSamples);
      const rMid = Math.sqrt(sqMid / frameSamples);
      fullRms[f] = rFull;
      bassRms[f] = rBass;
      midRms[f] = rMid;
      if (rFull > maxFull) maxFull = rFull;
      if (rBass > maxBass) maxBass = rBass;
    }

    const normFull = fullRms.map((v) => Math.min(1, Number((v / maxFull).toFixed(3))));
    const normBass = bassRms.map((v) => Math.min(1, v / maxBass));

    // Downsample to ~1Hz RMS envelope (capped [16, 240]) for UI waveform & cue scanning
    const targetBins = Math.max(16, Math.min(240, Math.round(safeDuration)));
    const rmsEnvelope: number[] = [];
    for (let b = 0; b < targetBins; b++) {
      const idx = Math.min(normFull.length - 1, Math.floor((b / targetBins) * normFull.length));
      rmsEnvelope.push(normFull[idx] ?? 0.5);
    }

    // Weighted onset flux (65% sub-bass kick + 35% full-band transient) at 20Hz
    const flux: number[] = new Array(numFrames).fill(0);
    for (let i = 1; i < numFrames; i++) {
      const dBass = Math.max(0, (normBass[i] ?? 0) - (normBass[i - 1] ?? 0));
      const dFull = Math.max(0, (normFull[i] ?? 0) - (normFull[i - 1] ?? 0));
      flux[i] = dBass * 0.65 + dFull * 0.35;
    }

    // Sub-band autocorrelation in [72..168] BPM with gentle musical tempo prior around 115 BPM
    let bestBpm = 120;
    let bestScore = -1;
    for (let candidateBpm = 72; candidateBpm <= 168; candidateBpm += 1) {
      const exactLag = (60 / candidateBpm) * frameHz;
      const lagFloor = Math.floor(exactLag);
      const frac = exactLag - lagFloor;
      let corr = 0;
      let n = 0;
      for (let i = 0; i + lagFloor + 1 < flux.length; i++) {
        const delayed = (flux[i + lagFloor] ?? 0) * (1 - frac) + (flux[i + lagFloor + 1] ?? 0) * frac;
        corr += (flux[i] ?? 0) * delayed;
        n++;
      }
      const avgCorr = n > 0 ? corr / n : 0;
      const octavePrior =
        candidateBpm >= 85 && candidateBpm <= 150 ? 1.0 : 0.86;
      const score = avgCorr * octavePrior;
      if (score > bestScore) {
        bestScore = score;
        bestBpm = candidateBpm;
      }
    }

    // If peak lag is double-time or half-time harmonic, fold weakly into natural pop/urban range
    if (bestBpm > 152) {
      bestBpm = Math.round(bestBpm * 0.5);
    }
    const bpm = Math.max(65, Math.min(175, bestBpm));
    const barSec = (60 / bpm) * 4;

    // Estimate first downbeat phase offset using modular beat grid energy
    const beatPeriodFrames = (60 / bpm) * frameHz;
    let bestPhase = 0;
    let bestPhaseScore = -1;
    const phaseSteps = Math.max(1, Math.round(beatPeriodFrames));
    for (let ph = 0; ph < phaseSteps; ph++) {
      let s = 0;
      for (let f = ph; f < flux.length; f += Math.max(1, Math.round(beatPeriodFrames))) {
        s += flux[Math.min(flux.length - 1, Math.round(f))] ?? 0;
      }
      if (s > bestPhaseScore) {
        bestPhaseScore = s;
        bestPhase = ph;
      }
    }
    const phaseSec = bestPhase / frameHz;

    const integratedRms = Math.sqrt(sumSqTotal / Math.max(1, countTotal));
    const loudnessDb = Number(
      Math.max(-24, Math.min(-1, 20 * Math.log10(Math.max(1e-5, integratedRms)))).toFixed(1)
    );
    const meanEnergy = Number(
      Math.max(0.1, Math.min(1, integratedRms / maxFull)).toFixed(3)
    );

    const structure = this.detectMusicalStructure(
      normFull,
      normBass,
      frameHz,
      safeDuration,
      barSec,
      phaseSec,
      rmsEnvelope
    );

    const h = hashTrackId(trackId);
    const analysis: TrackAnalysis = {
      trackId,
      durationSec: Math.round(safeDuration),
      bpm,
      bpmConfidence: bestScore > 0.002 ? 0.92 : 0.78,
      meanEnergy,
      peakEnergy: 1,
      rmsEnvelope,
      ...structure,
      camelotKey: CAMELOT_KEYS[h % CAMELOT_KEYS.length],
      loudnessDb,
      source: 'pcm',
      analyzedAtMs: Date.now(),
    };

    await this.cache.set(analysis);
    return analysis;
  }

  private snapToBar(sec: number, phaseSec: number, barSec: number, minSec: number, maxSec: number): number {
    if (barSec <= 0.5) return Math.round(Math.max(minSec, Math.min(maxSec, sec)));
    const idx = Math.round((sec - phaseSec) / barSec);
    const snapped = Math.round(phaseSec + idx * barSec);
    return Math.max(minSec, Math.min(maxSec, snapped));
  }

  private detectMusicalStructure(
    normFull: readonly number[],
    normBass: readonly number[],
    frameHz: number,
    durationSec: number,
    barSec: number,
    phaseSec: number,
    rmsEnvelope: readonly number[]
  ): {
    introEndSec: number;
    primaryDropSec: number;
    chorusStartSec: number;
    chorusEndSec: number;
    outroStartSec: number;
  } {
    const winFrames = Math.max(10, Math.round(6 * frameHz));

    // 1) Detect intro end: first frame >= 6s where sustained kick+energy crosses 54% peak
    let introEndSec = Math.round(Math.min(24, Math.max(8, durationSec * 0.1)));
    const introMinFrame = Math.round(6 * frameHz);
    const introMaxFrame = Math.min(normFull.length - 1, Math.round(Math.min(36, durationSec * 0.25) * frameHz));
    for (let f = introMinFrame; f < introMaxFrame; f++) {
      const e = (normFull[f] ?? 0) * 0.6 + (normBass[f] ?? 0) * 0.4;
      if (e >= 0.54) {
        introEndSec = this.snapToBar(f / frameHz, phaseSec, barSec, 6, Math.round(durationSec * 0.26));
        break;
      }
    }

    // 2) Detect primary drop: highest contrast jump (next 8s avg - prev 6s avg) in [intro .. 48%]
    const dropStartF = Math.max(winFrames, Math.round(Math.max(introEndSec, durationSec * 0.1) * frameHz));
    const dropEndF = Math.min(normFull.length - winFrames - 1, Math.round(durationSec * 0.48 * frameHz));
    let bestDropF = dropStartF;
    let bestDropScore = -999;

    const avgRange = (arr: readonly number[], from: number, to: number): number => {
      const a = Math.max(0, from);
      const b = Math.min(arr.length, to);
      if (b <= a) return 0;
      let sum = 0;
      for (let i = a; i < b; i++) sum += arr[i] ?? 0;
      return sum / (b - a);
    };

    for (let f = dropStartF; f < dropEndF; f += 4) {
      const before = avgRange(normFull, f - winFrames, f);
      const afterFull = avgRange(normFull, f, f + Math.round(8 * frameHz));
      const afterBass = avgRange(normBass, f, f + Math.round(8 * frameHz));
      const jump = (afterFull - before) * 0.7 + afterFull * 0.25 + afterBass * 0.35;
      if (jump > bestDropScore) {
        bestDropScore = jump;
        bestDropF = f;
      }
    }

    let primaryDropSec = this.snapToBar(
      bestDropF / frameHz,
      phaseSec,
      barSec,
      introEndSec,
      Math.round(durationSec * 0.48)
    );
    if (primaryDropSec < introEndSec) primaryDropSec = introEndSec;
    const chorusStartSec = primaryDropSec;

    // 3) Phrase-aligned chorusEndSec inside [primaryDropSec + 46s .. primaryDropSec + 84s]
    const winMinSec = Math.min(durationSec - 14, chorusStartSec + 46);
    const winMaxSec = Math.min(durationSec - 12, chorusStartSec + 84);
    let chorusEndSec = Math.max(winMinSec, Math.round(chorusStartSec + Math.min(68, durationSec * 0.34)));

    if (winMaxSec > winMinSec + 4) {
      let bestDipVal = Infinity;
      for (let s = winMinSec; s <= winMaxSec; s += 2) {
        const idx = Math.min(rmsEnvelope.length - 1, Math.floor((s / durationSec) * rmsEnvelope.length));
        const val = rmsEnvelope[idx] ?? 0.6;
        if (val < bestDipVal) {
          bestDipVal = val;
          chorusEndSec = s;
        }
      }
      chorusEndSec = this.snapToBar(chorusEndSec, phaseSec, barSec, winMinSec, winMaxSec);
    }

    // 4) Scan tail [duration * 0.68 .. duration - 8s] for outro transition point
    let outroStartSec = Math.max(
      chorusEndSec,
      Math.round(durationSec - Math.min(26, Math.max(12, durationSec * 0.14)))
    );
    const tailMin = Math.max(chorusStartSec + 20, Math.round(durationSec * 0.7));
    const tailMax = Math.round(durationSec - 8);
    if (tailMax > tailMin + 4) {
      let lowestTailEnergy = Infinity;
      let bestTailSec = outroStartSec;
      for (let s = tailMin; s <= tailMax; s += 2) {
        const f = Math.min(normFull.length - 1, Math.round(s * frameHz));
        const e = avgRange(normFull, f, f + Math.round(4 * frameHz));
        if (e < lowestTailEnergy && e <= 0.68) {
          lowestTailEnergy = e;
          bestTailSec = s;
        }
      }
      outroStartSec = this.snapToBar(
        bestTailSec,
        phaseSec,
        barSec,
        Math.max(primaryDropSec + 12, tailMin),
        Math.round(durationSec - 8)
      );
    }
    if (outroStartSec <= primaryDropSec) {
      outroStartSec = Math.min(Math.round(durationSec - 6), primaryDropSec + 20);
    }

    return {
      introEndSec,
      primaryDropSec,
      chorusStartSec,
      chorusEndSec,
      outroStartSec,
    };
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

    const targetBins = Math.max(16, Math.min(240, Math.round(durationSec)));
    const rmsEnvelope: number[] = [];
    for (let b = 0; b < targetBins; b++) {
      const idx = Math.min(
        normalized10Hz.length - 1,
        Math.floor((b / targetBins) * normalized10Hz.length)
      );
      rmsEnvelope.push(normalized10Hz[idx] ?? 0.5);
    }

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
