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

    const bpmDist = computeBpmDistance(from.bpm, to.bpm);
    const relBpmDiff = Math.abs(from.bpm - to.bpm) / Math.max(65, from.bpm);

    // Choose transition choreography
    let transitionType: DjTransitionType = 'eq_swap';
    if (preference !== 'auto' && toggles[preference]) {
      transitionType = preference;
    } else {
      if (bpmDist <= 8 && toggles.eq_swap) {
        transitionType = 'eq_swap';
      } else if (bpmDist <= 18 && toggles.filter_sweep) {
        transitionType = 'filter_sweep';
      } else if (toggles.echo_out) {
        transitionType = 'echo_out';
      } else if (toggles.filter_sweep) {
        transitionType = 'filter_sweep';
      } else {
        transitionType = 'eq_swap';
      }
    }

    const transitionBars: 4 | 8 = style === 'quick' || bpmDist > 10 ? 4 : 8;
    const barSec = (60 / Math.max(65, Math.min(175, from.bpm))) * 4;
    const rawTransitionDur = barSec * transitionBars;
    const transitionDurationSec = Number(
      Math.max(4.5, Math.min(14.0, rawTransitionDur)).toFixed(2)
    );

    let cueInSec: number;
    let cueOutSec: number;

    if (style === 'quick') {
      // Quick session: enters right before drop/chorus and keeps active window in [45, 90] seconds
      cueInSec = Math.max(0, Math.round(to.primaryDropSec - Math.min(4, barSec)));
      const fromEntry = Math.max(0, Math.round(from.primaryDropSec - 4));
      const desiredActiveSec = Math.max(45, Math.min(90, from.chorusEndSec - fromEntry));
      cueOutSec = Math.min(
        Math.max(15, from.durationSec - transitionDurationSec),
        fromEntry + desiredActiveSec
      );
    } else {
      // Full session: plays full track from intro and mixes at outroStartSec
      cueInSec = 0;
      cueOutSec = Math.max(
        15,
        Math.min(from.outroStartSec, from.durationSec - transitionDurationSec)
      );
    }

    let tempoNudgeRate = 1.0;
    if (relBpmDiff <= 0.06 && to.bpm > 0) {
      const ratio = from.bpm / to.bpm;
      tempoNudgeRate = Number(Math.max(0.96, Math.min(1.04, ratio)).toFixed(3));
    }

    const echoSubdivision: 0.5 | 0.75 = transitionType === 'echo_out' && from.bpm >= 115 ? 0.75 : 0.5;
    const compatibilityScore = Number(
      Math.max(0.15, Math.min(1, 1 - bpmDist / 50)).toFixed(2)
    );

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
