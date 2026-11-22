import type {
  DeckTransitionPlan,
  DjFxToggles,
  DjSessionStyle,
  DjTransitionType,
  IDjPlanner,
  Track,
  TrackAnalysis,
} from '@pmusic/core';
import { PcmTrackAnalyzer, type AnalysisCache } from './analyzer.ts';

function computeBpmDistance(bpmA: number, bpmB: number): number {
  const direct = Math.abs(bpmA - bpmB);
  const halfA = Math.abs(bpmA * 0.5 - bpmB);
  const doubleA = Math.abs(bpmA * 2 - bpmB);
  return Math.min(direct, halfA, doubleA);
}

function parseCamelot(key?: string): { num: number; letter: string } | null {
  if (!key) return null;
  const m = /^(\d{1,2})([AB])$/i.exec(key.trim());
  if (!m || !m[1] || !m[2]) return null;
  return { num: Number.parseInt(m[1], 10), letter: m[2].toUpperCase() };
}

function computeCamelotPenalty(keyA?: string, keyB?: string): number {
  const a = parseCamelot(keyA);
  const b = parseCamelot(keyB);
  if (!a || !b) return 0.15;
  const ringDist = Math.min(Math.abs(a.num - b.num), 12 - Math.abs(a.num - b.num));
  const modeDiff = a.letter === b.letter ? 0 : 1;
  if (ringDist === 0 && modeDiff === 0) return 0;
  if ((ringDist === 1 && modeDiff === 0) || (ringDist === 0 && modeDiff === 1)) return 0.08;
  return Math.min(1, (ringDist + modeDiff) / 6);
}

function sampleEnvelopeAtSec(ana: TrackAnalysis, sec: number): number {
  if (!ana.rmsEnvelope.length || ana.durationSec <= 0) return ana.meanEnergy;
  const ratio = Math.max(0, Math.min(0.999, sec / ana.durationSec));
  const idx = Math.floor(ratio * ana.rmsEnvelope.length);
  return ana.rmsEnvelope[idx] ?? ana.meanEnergy;
}

function pairTransitionCost(
  trackA: Track,
  trackB: Track,
  analyses: ReadonlyMap<string, TrackAnalysis>
): number {
  const anaA = analyses.get(trackA.id);
  const anaB = analyses.get(trackB.id);

  const bpmA = anaA?.bpm ?? 120;
  const bpmB = anaB?.bpm ?? 120;
  const bpmNorm = Math.min(1, computeBpmDistance(bpmA, bpmB) / 40);

  const energyA = anaA?.meanEnergy ?? 0.65;
  const energyB = anaB?.meanEnergy ?? 0.65;
  const energyDiff = Math.abs(energyA - energyB);

  const camelotPenalty = computeCamelotPenalty(anaA?.camelotKey, anaB?.camelotKey);
  const sameArtist =
    trackA.artists[0]?.name &&
    trackB.artists[0]?.name &&
    trackA.artists[0].name.toLowerCase() === trackB.artists[0].name.toLowerCase()
      ? 0.35
      : 0;

  return bpmNorm * 0.45 + energyDiff * 0.25 + camelotPenalty * 0.15 + sameArtist;
}

export class DjQueueReorderer {
  public reorderQueueForSession(
    tracks: readonly Track[],
    analyses: ReadonlyMap<string, TrackAnalysis>,
    pinnedTrackId?: string
  ): Track[] {
    if (tracks.length <= 2) {
      return [...tracks];
    }

    const pool = [...tracks];
    let startTrack: Track;

    if (pinnedTrackId) {
      const pinnedIdx = pool.findIndex((t) => t.id === pinnedTrackId);
      if (pinnedIdx >= 0) {
        startTrack = pool.splice(pinnedIdx, 1)[0]!;
      } else {
        startTrack = pool.shift()!;
      }
    } else {
      startTrack = pool.shift()!;
    }

    // Greedy nearest-neighbor build
    const ordered: Track[] = [startTrack];
    while (pool.length > 0) {
      const current = ordered[ordered.length - 1]!;
      let bestIdx = 0;
      let bestCost = Infinity;

      for (let i = 0; i < pool.length; i++) {
        const cost = pairTransitionCost(current, pool[i]!, analyses);
        if (cost < bestCost) {
          bestCost = cost;
          bestIdx = i;
        }
      }
      ordered.push(pool.splice(bestIdx, 1)[0]!);
    }

    // 2-opt local search refinement (keeping index 0 pinned)
    const n = ordered.length;
    if (n >= 4) {
      for (let pass = 0; pass < 2; pass++) {
        for (let i = 1; i < n - 2; i++) {
          for (let k = i + 1; k < n - 1; k++) {
            const before =
              pairTransitionCost(ordered[i - 1]!, ordered[i]!, analyses) +
              pairTransitionCost(ordered[k]!, ordered[k + 1]!, analyses);
            const after =
              pairTransitionCost(ordered[i - 1]!, ordered[k]!, analyses) +
              pairTransitionCost(ordered[i]!, ordered[k + 1]!, analyses);
            if (after + 1e-4 < before) {
              const reversed = ordered.slice(i, k + 1).reverse();
              ordered.splice(i, k - i + 1, ...reversed);
            }
          }
        }
      }
    }

    return ordered;
  }
}

export class DjCuePlanner implements IDjPlanner {
  private readonly analyzer: PcmTrackAnalyzer;
  private readonly reorderer: DjQueueReorderer;

  public constructor(cache?: AnalysisCache) {
    this.analyzer = new PcmTrackAnalyzer(cache);
    this.reorderer = new DjQueueReorderer();
  }

  public async analyzeTrack(
    trackId: string,
    audioData: ArrayBuffer | null,
    durationSec: number
  ): Promise<TrackAnalysis> {
    return this.analyzer.analyzeTrack(trackId, audioData, durationSec);
  }

  public async analyzeFloatPcm(
    trackId: string,
    monoSamples: Float32Array,
    sampleRate: number,
    durationSec: number
  ): Promise<TrackAnalysis> {
    return this.analyzer.analyzeFloatPcm(trackId, monoSamples, sampleRate, durationSec);
  }

  public async analyzeEncodedAudio(
    trackId: string,
    encodedData: ArrayBuffer,
    durationSec: number
  ): Promise<TrackAnalysis> {
    return this.analyzer.analyzeEncodedAudio(trackId, encodedData, durationSec);
  }

  public reorderQueueForSession(
    tracks: readonly Track[],
    analyses: ReadonlyMap<string, TrackAnalysis>,
    pinnedTrackId?: string
  ): Track[] {
    return this.reorderer.reorderQueueForSession(tracks, analyses, pinnedTrackId);
  }

  public planTransition(
    from: TrackAnalysis,
    to: TrackAnalysis,
    style: DjSessionStyle,
    preference: 'auto' | DjTransitionType = 'auto',
    enabledTransitions?: DjFxToggles
  ): DeckTransitionPlan {
    const toggles: DjFxToggles = {
      eq_swap: enabledTransitions?.eq_swap ?? true,
      filter_sweep: enabledTransitions?.filter_sweep ?? true,
      echo_out: enabledTransitions?.echo_out ?? true,
    };

    const safeFromBpm = Math.max(65, Math.min(175, from.bpm));
    const safeToBpm = Math.max(65, Math.min(175, to.bpm));
    const barSec = (60 / safeFromBpm) * 4;
    const toBarSec = (60 / safeToBpm) * 4;

    const bpmDist = computeBpmDistance(safeFromBpm, safeToBpm);
    const relBpmDiff = Math.abs(safeFromBpm - safeToBpm) / safeFromBpm;
    const camelotPenalty = computeCamelotPenalty(from.camelotKey, to.camelotKey);

    // Quick cueIn first so we can evaluate real energy match at exact transition points
    const rawCueIn =
      style === 'quick'
        ? Math.max(4, Math.round(to.primaryDropSec - Math.min(barSec * 1.5, 6)))
        : 0;
    const cueInSec =
      style === 'quick'
        ? Math.max(1, Math.min(Math.max(1, to.durationSec - 20), rawCueIn))
        : 0;

    // Pick lowest-energy phrase exit inside valid [45, 90]s window in quick mode
    const fromEntry = Math.max(0, Math.round(from.primaryDropSec - 4));
    let tentativeCueOut =
      style === 'quick'
        ? fromEntry + Math.max(48, Math.min(82, from.chorusEndSec - fromEntry))
        : from.outroStartSec;

    if (style === 'quick' && from.rmsEnvelope.length >= 16) {
      const scanMin = fromEntry + 48;
      const scanMax = Math.min(from.durationSec - 10, fromEntry + 82);
      if (scanMax > scanMin + 2) {
        let lowestE = Infinity;
        let bestSec = tentativeCueOut;
        for (let s = scanMin; s <= scanMax; s += 2) {
          const e = sampleEnvelopeAtSec(from, s);
          if (e < lowestE) {
            lowestE = e;
            bestSec = s;
          }
        }
        // Snap lightly to outgoing bar grid while clamping strictly inside [45, 90] window
        const barIdx = Math.round(bestSec / Math.max(1, barSec));
        const snapped = Math.round(barIdx * barSec);
        tentativeCueOut = Math.max(scanMin, Math.min(scanMax, snapped));
      }
    }

    const fromCueEnergy = sampleEnvelopeAtSec(from, tentativeCueOut);
    const toCueEnergy = sampleEnvelopeAtSec(to, cueInSec);
    const energyClash = Math.abs(fromCueEnergy - toCueEnergy);

    // Adaptive Choreography:
    // - Beat-matchable BPM (<= 7) & manageable energy shift -> club EQ Swap (8 bars gradual in full when harmonic)
    // - Moderate BPM delta (<= 14) -> exponential Filter Sweep
    // - Wide BPM jump (> 14) or extreme energy cliff -> punchy dub Echo Out (prevents beat trainwrecks)
    let transitionType: DjTransitionType = 'eq_swap';
    let transitionBars: 4 | 8 = 4;

    const isHarmonicBlend = bpmDist <= 7 && energyClash <= 0.45;
    const isFilterBridge = bpmDist <= 14 && energyClash <= 0.55;

    if (preference !== 'auto' && toggles[preference]) {
      transitionType = preference;
      transitionBars =
        transitionType === 'eq_swap' && style === 'full' && bpmDist <= 10 ? 8 : 4;
    } else if (isHarmonicBlend && toggles.eq_swap) {
      transitionType = 'eq_swap';
      transitionBars = style === 'full' && bpmDist <= 6 && camelotPenalty <= 0.45 ? 8 : 4;
    } else if (isFilterBridge && toggles.filter_sweep) {
      transitionType = 'filter_sweep';
      transitionBars = style === 'full' && bpmDist <= 8 ? 8 : 4;
    } else if (toggles.echo_out) {
      transitionType = 'echo_out';
      transitionBars = 4;
    } else if (toggles.filter_sweep) {
      transitionType = 'filter_sweep';
      transitionBars = 4;
    } else {
      transitionType = 'eq_swap';
      transitionBars = 4;
    }

    let rawDur = barSec * transitionBars;
    if (transitionType === 'echo_out' && bpmDist > 16) {
      // Wide BPM jumps sound much cleaner with a crisp 4.5-6.8s dub wash rather than dragging beats
      rawDur = Math.min(6.8, Math.max(4.5, toBarSec * 2.5));
    }
    const transitionDurationSec = Number(Math.max(4.5, Math.min(14.0, rawDur)).toFixed(2));

    let cueOutSec: number;
    if (style === 'quick') {
      const desiredActive = Math.max(45, Math.min(90, tentativeCueOut - fromEntry));
      cueOutSec = Math.min(
        Math.max(15, from.durationSec - transitionDurationSec),
        fromEntry + desiredActive
      );
    } else {
      cueOutSec = Math.max(
        15,
        Math.min(from.outroStartSec, from.durationSec - transitionDurationSec)
      );
    }

    let tempoNudgeRate = 1.0;
    if (relBpmDiff <= 0.06 && safeToBpm > 0) {
      const ratio = safeFromBpm / safeToBpm;
      tempoNudgeRate = Number(Math.max(0.96, Math.min(1.04, ratio)).toFixed(3));
    }

    const echoSubdivision: 0.5 | 0.75 =
      transitionType === 'echo_out' && safeFromBpm >= 115 ? 0.75 : 0.5;
    const harmonicPenalty = bpmDist / 50 + camelotPenalty * 0.25 + energyClash * 0.2;
    const compatibilityScore = Number(Math.max(0.15, Math.min(1, 1 - harmonicPenalty)).toFixed(2));

    return {
      fromTrackId: from.trackId,
      toTrackId: to.trackId,
      cueInSec,
      cueOutSec,
      transitionDurationSec,
      transitionBars,
      transitionType,
      tempoNudgeRate,
      echoSubdivision,
      compatibilityScore,
    };
  }
}
