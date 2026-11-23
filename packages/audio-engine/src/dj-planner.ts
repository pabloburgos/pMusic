import type {
  DeckTransitionPlan,
  DjFxToggles,
  DjSessionStyle,
  DjStemChoreography,
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

function sampleStemWindow(
  stem: readonly number[] | undefined,
  durationSec: number,
  fromSec: number,
  toSec: number,
  fallback: number
): number {
  if (!stem || !stem.length || durationSec <= 0) return fallback;
  const startSec = Math.max(0, Math.min(durationSec, Math.min(fromSec, toSec)));
  const endSec = Math.max(startSec + 1, Math.min(durationSec, Math.max(fromSec, toSec)));
  const i0 = Math.max(0, Math.floor((startSec / durationSec) * stem.length));
  const i1 = Math.min(stem.length - 1, Math.ceil((endSec / durationSec) * stem.length));
  let sum = 0;
  let count = 0;
  for (let i = i0; i <= i1; i++) {
    sum += stem[i] ?? fallback;
    count++;
  }
  return count > 0 ? sum / count : fallback;
}

function snapToDownbeatGrid(
  sec: number,
  phaseSec: number | undefined,
  barSec: number,
  minSec: number,
  maxSec: number
): number {
  if (barSec <= 0.5) return Math.round(Math.max(minSec, Math.min(maxSec, sec)));
  const phase = phaseSec ?? 0;
  const k = Math.round((sec - phase) / barSec);
  const snapped = Math.round(phase + k * barSec);
  return Math.max(minSec, Math.min(maxSec, snapped));
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
      vocal_over_beat: enabledTransitions?.vocal_over_beat ?? true,
      instrumental_bed: enabledTransitions?.instrumental_bed ?? true,
      loop_build: enabledTransitions?.loop_build ?? true,
    };

    const safeFromBpm = Math.max(65, Math.min(175, from.bpm));
    const safeToBpm = Math.max(65, Math.min(175, to.bpm));
    const barSec = (60 / safeFromBpm) * 4;
    const toBarSec = (60 / safeToBpm) * 4;

    const bpmDist = computeBpmDistance(safeFromBpm, safeToBpm);
    const relBpmDiff = Math.abs(safeFromBpm - safeToBpm) / safeFromBpm;
    const camelotPenalty = computeCamelotPenalty(from.camelotKey, to.camelotKey);

    // Pairwise stem-aware window search: jointly minimize vocal-on-vocal clash, bass collision & energy jumps
    const fromEntry = Math.max(0, Math.round(from.primaryDropSec - 4));
    let cueInSec = 0;
    let tentativeCueOut =
      style === 'quick'
        ? fromEntry + Math.max(48, Math.min(82, from.chorusEndSec - fromEntry))
        : from.outroStartSec;

    if (style === 'quick') {
      const scanMinOut = fromEntry + 46;
      const scanMaxOut = Math.min(from.durationSec - 10, fromEntry + 88);
      const outCandidates: number[] = [];
      if (scanMaxOut > scanMinOut + 2) {
        for (let s = scanMinOut; s <= scanMaxOut; s += Math.max(2, Math.round(barSec))) {
          outCandidates.push(
            snapToDownbeatGrid(s, from.beatPhaseSec, barSec, scanMinOut, scanMaxOut)
          );
        }
      }
      if (outCandidates.length === 0) outCandidates.push(tentativeCueOut);

      const maxCueIn = Math.max(2, to.durationSec - 20);
      const rawInCandidates = [
        Math.max(2, Math.round(to.introEndSec)),
        Math.max(2, Math.round(to.primaryDropSec - Math.min(toBarSec * 2, 8))),
        Math.max(2, Math.round(to.primaryDropSec - Math.min(toBarSec * 1.25, 5))),
      ];
      const inCandidates = Array.from(
        new Set(rawInCandidates.map((c) => Math.max(2, Math.min(maxCueIn, c))))
      );

      let bestPairCost = Infinity;
      let bestPairOut = tentativeCueOut;
      let bestPairIn = inCandidates[0] ?? 4;

      for (const outSec of outCandidates) {
        const vOut = sampleStemWindow(from.vocalEnvelope, from.durationSec, outSec, outSec + 8, from.meanEnergy * 0.7);
        const bOut = sampleStemWindow(from.bassEnvelope, from.durationSec, outSec, outSec + 8, from.meanEnergy * 0.8);
        const eOut = sampleEnvelopeAtSec(from, outSec);
        for (const inSec of inCandidates) {
          const vIn = sampleStemWindow(to.vocalEnvelope, to.durationSec, inSec, inSec + 8, to.meanEnergy * 0.6);
          const bIn = sampleStemWindow(to.bassEnvelope, to.durationSec, inSec, inSec + 8, to.meanEnergy * 0.75);
          const eIn = sampleEnvelopeAtSec(to, inSec);
          const vocalCollision = vOut * vIn;
          const bassStep = Math.abs(bOut - bIn);
          const energyStep = Math.abs(eOut - eIn);
          const totalCost = vocalCollision * 0.45 + bassStep * 0.25 + energyStep * 0.30;
          if (totalCost < bestPairCost) {
            bestPairCost = totalCost;
            bestPairOut = outSec;
            bestPairIn = inSec;
          }
        }
      }
      tentativeCueOut = bestPairOut;
      cueInSec = bestPairIn;
    } else {
      // Full mode: preserve intro from 0s, scan cleanly around outro bar downbeats for lowest vocal clash
      cueInSec = 0;
      const tailMin = Math.max(15, Math.min(from.outroStartSec, from.chorusEndSec));
      const tailMax = Math.max(tailMin, from.outroStartSec);
      let bestTailCost = Infinity;
      let bestTailOut = from.outroStartSec;
      for (let s = tailMin; s <= tailMax; s += Math.max(2, Math.round(barSec))) {
        const snappedOut = snapToDownbeatGrid(s, from.beatPhaseSec, barSec, tailMin, tailMax);
        const vOut = sampleStemWindow(from.vocalEnvelope, from.durationSec, snappedOut, snappedOut + 8, 0.5);
        const eOut = sampleEnvelopeAtSec(from, snappedOut);
        const cost = vOut * 0.6 + eOut * 0.4;
        if (cost < bestTailCost) {
          bestTailCost = cost;
          bestTailOut = snappedOut;
        }
      }
      tentativeCueOut = bestTailOut;
    }

    const fromCueEnergy = sampleEnvelopeAtSec(from, tentativeCueOut);
    const toCueEnergy = sampleEnvelopeAtSec(to, cueInSec);
    const energyClash = Math.abs(fromCueEnergy - toCueEnergy);

    const probeDur = Math.max(6, Math.min(12, barSec * 4));
    const vOutProbe = sampleStemWindow(
      from.vocalEnvelope,
      from.durationSec,
      tentativeCueOut,
      tentativeCueOut + probeDur,
      from.meanEnergy * 0.65
    );
    const bOutProbe = sampleStemWindow(
      from.bassEnvelope,
      from.durationSec,
      tentativeCueOut,
      tentativeCueOut + probeDur,
      from.meanEnergy * 0.78
    );
    const vInProbe = sampleStemWindow(
      to.vocalEnvelope,
      to.durationSec,
      cueInSec,
      cueInSec + probeDur,
      to.meanEnergy * 0.6
    );
    const bInProbe = sampleStemWindow(
      to.bassEnvelope,
      to.durationSec,
      cueInSec,
      cueInSec + probeDur,
      to.meanEnergy * 0.75
    );

    // Adaptive Pro-DJ Choreography:
    // Dynamically pairs mix length (2, 4, 8, or 12 bars) & technique to track stems, BPM delta, and energy curve
    let transitionType: DjTransitionType = 'eq_swap';
    let transitionBars: 2 | 4 | 8 | 12 = 4;

    const isHarmonicBlend = bpmDist <= 7 && energyClash <= 0.45;
    const isFilterBridge = bpmDist <= 14 && energyClash <= 0.55;
    const isExplicitFx = preference !== 'auto' && Boolean(toggles[preference]);

    if (preference !== 'auto' && toggles[preference]) {
      transitionType = preference;
      transitionBars =
        (transitionType === 'eq_swap' ||
          transitionType === 'vocal_over_beat' ||
          transitionType === 'instrumental_bed') &&
        style === 'full' &&
        bpmDist <= 10
          ? 8
          : 4;
    } else if (
      Boolean(from.vocalEnvelope?.length) &&
      Boolean(to.bassEnvelope?.length) &&
      vOutProbe >= 0.5 &&
      bInProbe >= 0.5 &&
      vOutProbe - vInProbe >= 0.16 &&
      bpmDist <= 10 &&
      toggles.vocal_over_beat
    ) {
      transitionType = 'vocal_over_beat';
      transitionBars = style === 'full' && bpmDist <= 6 ? 8 : 4;
    } else if (
      Boolean(from.bassEnvelope?.length) &&
      Boolean(to.vocalEnvelope?.length) &&
      vInProbe >= 0.5 &&
      bOutProbe >= 0.5 &&
      vInProbe - vOutProbe >= 0.16 &&
      bpmDist <= 9 &&
      toggles.instrumental_bed
    ) {
      transitionType = 'instrumental_bed';
      transitionBars = style === 'full' && bpmDist <= 6 ? 8 : 4;
    } else if (
      (toCueEnergy > fromCueEnergy + 0.12 || (bpmDist > 7 && bpmDist <= 15 && energyClash <= 0.6)) &&
      toggles.loop_build
    ) {
      transitionType = 'loop_build';
      transitionBars = 4;
    } else if (isHarmonicBlend && toggles.eq_swap) {
      transitionType = 'eq_swap';
      transitionBars =
        style === 'full' && bpmDist <= 4 && camelotPenalty <= 0.1 && energyClash > 0.05 && energyClash <= 0.4
          ? 12
          : style === 'full' && bpmDist <= 6 && camelotPenalty <= 0.45
            ? 8
            : 4;
    } else if (isFilterBridge && toggles.filter_sweep) {
      transitionType = 'filter_sweep';
      transitionBars = style === 'full' && bpmDist <= 8 ? 8 : 4;
    } else if (toggles.echo_out) {
      transitionType = 'echo_out';
      transitionBars = style === 'full' && bpmDist > 20 ? 2 : 4;
    } else if (toggles.filter_sweep) {
      transitionType = 'filter_sweep';
      transitionBars = 4;
    } else {
      transitionType = 'eq_swap';
      transitionBars = 4;
    }

    let rawDur = barSec * transitionBars;
    if (transitionType === 'echo_out' && bpmDist > 16) {
      rawDur = isExplicitFx ? Math.min(6.8, Math.max(4.5, toBarSec * 2.5)) : Math.min(5.2, Math.max(3.2, toBarSec * 1.9));
    }
    const minClamp = !isExplicitFx && transitionBars === 2 ? 3.2 : 4.5;
    const transitionDurationSec = Number(Math.max(minClamp, Math.min(14.0, rawDur)).toFixed(2));

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
        Math.min(tentativeCueOut, from.durationSec - transitionDurationSec)
      );
    }

    let tempoNudgeRate = 1.0;
    if (relBpmDiff <= 0.06 && safeToBpm > 0) {
      const ratio = safeFromBpm / safeToBpm;
      tempoNudgeRate = Number(Math.max(0.96, Math.min(1.04, ratio)).toFixed(3));
    }

    const echoSubdivision: 0.5 | 0.75 =
      transitionType === 'echo_out' && safeFromBpm >= 115 ? 0.75 : 0.5;
    const loopSubdivision: 0.25 | 0.5 = bpmDist >= 11 ? 0.25 : 0.5;
    const harmonicPenalty = bpmDist / 50 + camelotPenalty * 0.25 + energyClash * 0.2;
    const compatibilityScore = Number(Math.max(0.15, Math.min(1, 1 - harmonicPenalty)).toFixed(2));

    // Synthesize bespoke continuous 3-stem DSP choreography tailored to exact pair metrics
    const vOutWin = sampleStemWindow(
      from.vocalEnvelope,
      from.durationSec,
      cueOutSec,
      cueOutSec + transitionDurationSec,
      from.meanEnergy * 0.65
    );
    const vInWin = sampleStemWindow(
      to.vocalEnvelope,
      to.durationSec,
      cueInSec,
      cueInSec + transitionDurationSec,
      to.meanEnergy * 0.6
    );
    const bassInWin = sampleStemWindow(
      to.bassEnvelope,
      to.durationSec,
      cueInSec,
      cueInSec + transitionDurationSec,
      to.meanEnergy * 0.75
    );
    const vocalOverlap = Math.min(1, vOutWin * vInWin * 1.45);
    const vocalClashAvoided =
      vocalOverlap >= 0.24 ||
      transitionType === 'vocal_over_beat' ||
      transitionType === 'instrumental_bed';

    const techniqueMode: NonNullable<DjStemChoreography['techniqueMode']> =
      transitionType === 'vocal_over_beat'
        ? 'vocal_over_beat'
        : transitionType === 'instrumental_bed'
          ? 'instrumental_bed'
          : transitionType === 'loop_build'
            ? 'loop_build'
            : transitionType === 'filter_sweep'
              ? 'filter_sweep'
              : transitionType === 'echo_out'
                ? 'dub_echo'
                : 'bass_swap';

    const bassSwapPoint01 = Number(
      (transitionType === 'vocal_over_beat'
        ? 0.28
        : transitionType === 'instrumental_bed'
          ? 0.64
          : transitionType === 'loop_build'
            ? 0.7
            : Math.max(0.34, Math.min(0.64, bpmDist <= 6 ? 0.52 - bassInWin * 0.08 : 0.44))
      ).toFixed(2)
    );
    const bassSwapWidth01 = Number(
      (transitionType === 'vocal_over_beat' || transitionType === 'loop_build'
        ? 0.14
        : bpmDist <= 7 && bassInWin >= 0.6
          ? 0.16
          : 0.28
      ).toFixed(2)
    );
    const vocalCarveDb = Number(
      (transitionType === 'instrumental_bed'
        ? -18.5
        : transitionType === 'vocal_over_beat'
          ? -3.5
          : -7 - vocalOverlap * 11 - (transitionType === 'echo_out' ? 3 : 0)
      ).toFixed(1)
    );
    const incomingVocalHoldDb = Number(
      (transitionType === 'vocal_over_beat'
        ? -10.5
        : transitionType === 'instrumental_bed'
          ? -1.2
          : Math.max(-9, Math.min(-1.5, -2.0 - vocalOverlap * 6.5))
      ).toFixed(1)
    );
    const outHighPassPeakHz =
      transitionType === 'filter_sweep' || transitionType === 'loop_build'
        ? Math.round(1800 + Math.min(1600, bpmDist * 85))
        : transitionType === 'echo_out'
          ? Math.round(780 + Math.min(620, bpmDist * 30))
          : Math.round(280 + camelotPenalty * 220);
    const inLowPassStartHz =
      transitionType === 'filter_sweep'
        ? Math.round(240 + Math.min(360, toCueEnergy * 320))
        : transitionType === 'eq_swap' && bpmDist <= 6
          ? Math.round(3200 + (1 - camelotPenalty) * 2800)
          : 12000;
    const echoSendPeak = Number(
      Math.min(
        0.65,
        Math.max(
          0.16,
          (transitionType === 'echo_out' || transitionType === 'loop_build' ? 0.58 : 0.24) +
            vocalOverlap * 0.14
        )
      ).toFixed(2)
    );
    const echoFeedbackPeak = Number(
      Math.min(
        0.74,
        transitionType === 'loop_build'
          ? 0.72
          : transitionType === 'echo_out'
            ? 0.62
            : 0.44
      ).toFixed(2)
    );
    const highStemLead01 = Number(
      (bpmDist <= 8 && transitionType !== 'echo_out' ? 0.24 : 0.05).toFixed(2)
    );
    const fromLufs = from.loudnessDb ?? -10;
    const toLufs = to.loudnessDb ?? -10;
    const loudnessTrimDb = Number(
      Math.max(-5, Math.min(5, (fromLufs - toLufs) * 0.55)).toFixed(1)
    );

    const summaryParts: string[] = [];
    if (transitionType === 'vocal_over_beat') {
      summaryParts.push(`Voz sobre base entrante (${transitionBars} comp.)`);
    } else if (transitionType === 'instrumental_bed') {
      summaryParts.push(`Base instrumental + entrada vocal (${transitionBars} comp.)`);
    } else if (transitionType === 'loop_build') {
      summaryParts.push(`Build-up con bucle 1/${loopSubdivision === 0.25 ? '4' : '2'} (${transitionBars} comp.)`);
    } else if (transitionType === 'eq_swap') {
      summaryParts.push(
        transitionBars >= 12
          ? 'Cruce armónico largo (12 comp.)'
          : `Cruce armónico de stems (${transitionBars} comp.)`
      );
    } else if (transitionType === 'filter_sweep') {
      summaryParts.push(`Barrido resonante progresivo (${transitionBars} comp.)`);
    } else {
      summaryParts.push(
        transitionBars === 2
          ? `Dub Echo Out rápido (${Math.round(bpmDist)} BPM Δ)`
          : `Dub Echo Out sincronizado (${Math.round(bpmDist)} BPM Δ)`
      );
    }
    if (vocalClashAvoided && transitionType !== 'vocal_over_beat' && transitionType !== 'instrumental_bed') {
      summaryParts.push(`bolsillo vocal ${vocalCarveDb} dB`);
    }
    summaryParts.push(`swap bajos @ ${Math.round(bassSwapPoint01 * 100)}%`);

    const choreography: DjStemChoreography = {
      bassSwapPoint01,
      bassSwapWidth01,
      vocalCarveDb,
      incomingVocalHoldDb,
      outHighPassPeakHz,
      inLowPassStartHz,
      echoSendPeak,
      echoFeedbackPeak,
      highStemLead01,
      loudnessTrimDb,
      vocalClashAvoided,
      summary: summaryParts.join(' · '),
      techniqueMode,
      loopSubdivision,
    };

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
      choreography,
    };
  }
}
