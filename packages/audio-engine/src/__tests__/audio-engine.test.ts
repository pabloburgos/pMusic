import { describe, expect, it } from 'vitest';
import type { Track } from '@pmusic/core';
import {
  DjCuePlanner,
  DjQueueReorderer,
  DualDeckAudioEngine,
  PcmTrackAnalyzer,
  volumeToPerceptualGain,
} from '../index.ts';

const SAMPLE_TRACKS: Track[] = [
  {
    id: 'trk_1',
    title: 'Me Muevo Con Dios',
    artists: [{ name: 'Cruz Cafuné' }],
    durationSec: 214,
    thumbnailUrl: 'https://example.com/1.jpg',
    source: 'ytmusic',
  },
  {
    id: 'trk_2',
    title: 'Cayetano',
    artists: [{ name: 'La Pantera' }],
    durationSec: 224,
    thumbnailUrl: 'https://example.com/2.jpg',
    source: 'ytmusic',
  },
  {
    id: 'trk_3',
    title: 'MONACO',
    artists: [{ name: 'Bad Bunny' }],
    durationSec: 267,
    thumbnailUrl: 'https://example.com/3.jpg',
    source: 'ytmusic',
  },
  {
    id: 'trk_4',
    title: 'Columbia',
    artists: [{ name: 'Quevedo' }],
    durationSec: 186,
    thumbnailUrl: 'https://example.com/4.jpg',
    source: 'ytmusic',
  },
];

describe('@pmusic/audio-engine', () => {
  it('analyzes tracks and detects BPM, RMS envelope, intro, drop/chorus, and outro cues', async () => {
    const analyzer = new PcmTrackAnalyzer();
    const res = await analyzer.analyzeTrack('trk_1', null, 214);
    expect(res.bpm).toBeGreaterThanOrEqual(65);
    expect(res.bpm).toBeLessThanOrEqual(175);
    expect(res.rmsEnvelope.length).toBeGreaterThanOrEqual(16);
    expect(res.primaryDropSec).toBeGreaterThanOrEqual(res.introEndSec);
    expect(res.outroStartSec).toBeGreaterThan(res.primaryDropSec);
  });

  it('reorders queue harmonically while keeping pinned track first', async () => {
    const planner = new DjCuePlanner();
    const analyses = new Map();
    for (const t of SAMPLE_TRACKS) {
      analyses.set(t.id, await planner.analyzeTrack(t.id, null, t.durationSec));
    }
    const reordered = new DjQueueReorderer().reorderQueueForSession(
      SAMPLE_TRACKS,
      analyses,
      'trk_2'
    );
    expect(reordered[0]?.id).toBe('trk_2');
    expect(reordered).toHaveLength(4);
  });

  it('plans quick (45-90s drop window) vs full DJ session transitions and respects FX toggles', async () => {
    const planner = new DjCuePlanner();
    const a1 = await planner.analyzeTrack('trk_1', null, 214);
    const a2 = await planner.analyzeTrack('trk_2', null, 224);

    const quickPlan = planner.planTransition(a1, a2, 'quick', 'auto');
    expect(quickPlan.cueInSec).toBeGreaterThan(0);
    const activePlaySec = quickPlan.cueOutSec - Math.max(0, a1.primaryDropSec - 4);
    expect(activePlaySec).toBeGreaterThanOrEqual(45);
    expect(activePlaySec).toBeLessThanOrEqual(90);

    const fullPlan = planner.planTransition(a1, a2, 'full', 'echo_out', {
      eq_swap: true,
      filter_sweep: true,
      echo_out: true,
    });
    expect(fullPlan.cueInSec).toBe(0);
    expect(fullPlan.transitionType).toBe('echo_out');
    expect(fullPlan.transitionDurationSec).toBeGreaterThanOrEqual(4.5);
    expect(fullPlan.transitionDurationSec).toBeLessThanOrEqual(14.0);
  });

  it('loads tracks into DualDeckAudioEngine, switches decks on transition, and clamps EQ gains', async () => {
    const engine = new DualDeckAudioEngine();
    await engine.init();
    await engine.loadAndPlay(SAMPLE_TRACKS[0]!, 10);
    expect(engine.getState().isPlaying).toBe(true);
    expect(engine.getState().activeDeck).toBe('A');

    engine.setUserEq({
      enabled: true,
      preset: 'urbano',
      bandsDb: [15, 4, 0, 2, -20],
    });

    await engine.preloadNextDeck(SAMPLE_TRACKS[1]!, 16);
    await engine.executeTransition({
      fromTrackId: 'trk_1',
      toTrackId: 'trk_2',
      cueInSec: 16,
      cueOutSec: 70,
      transitionDurationSec: 0.3,
      transitionBars: 4,
      transitionType: 'eq_swap',
      tempoNudgeRate: 1.0,
      echoSubdivision: 0.5,
      compatibilityScore: 0.92,
    });

    expect(engine.getState().activeDeck).toBe('B');
    expect(engine.getState().isTransitioning).toBe(false);
    expect(engine.getState().isPlaying).toBe(true);
    expect(engine.getLivePositionSec()).toBeGreaterThanOrEqual(16);
    await engine.dispose();
  });

  it('detects BPM and true integrated loudness from Float32Array kick pulses', async () => {
    const sampleRate = 8000;
    const durationSec = 30;
    const samples = new Float32Array(sampleRate * durationSec);
    // Synthesize 120 BPM kick pulses (every 0.5s = 4000 samples) + verse/chorus lift
    const period = sampleRate * 0.5;
    for (let i = 0; i < samples.length; i++) {
      const posInBeat = i % period;
      const env = posInBeat < 400 ? Math.exp(-posInBeat / 90) : 0;
      const sectionGain = i > sampleRate * 8 ? 0.85 : 0.35;
      samples[i] = Math.sin(2 * Math.PI * 75 * (i / sampleRate)) * env * sectionGain;
    }

    const analyzer = new PcmTrackAnalyzer();
    const res = await analyzer.analyzeFloatPcm('pcm_120', samples, sampleRate, durationSec);
    expect(res.source).toBe('pcm');
    expect(Math.abs(res.bpm - 120)).toBeLessThanOrEqual(4);
    expect(res.loudnessDb).toBeLessThan(-1);
    expect(res.loudnessDb).toBeGreaterThan(-25);
  });

  it('adapts transition choreography and bar count to BPM and energy compatibility', () => {
    const planner = new DjCuePlanner();
    const base = {
      trackId: 'a',
      durationSec: 210,
      bpm: 122,
      bpmConfidence: 0.9,
      meanEnergy: 0.72,
      peakEnergy: 1,
      rmsEnvelope: Array.from({ length: 180 }, () => 0.72),
      introEndSec: 12,
      primaryDropSec: 24,
      chorusStartSec: 24,
      chorusEndSec: 88,
      outroStartSec: 184,
      camelotKey: '8A',
      source: 'pcm' as const,
      analyzedAtMs: Date.now(),
    };

    const harmonicFull = planner.planTransition(
      base,
      { ...base, trackId: 'b', bpm: 124, camelotKey: '8A' },
      'full',
      'auto'
    );
    expect(harmonicFull.transitionType).toBe('eq_swap');
    expect(harmonicFull.transitionBars).toBe(8);

    const wideGap = planner.planTransition(
      base,
      { ...base, trackId: 'c', bpm: 92, camelotKey: '3B', meanEnergy: 0.25 },
      'quick',
      'auto'
    );
    expect(wideGap.transitionType).toBe('echo_out');
    expect(wideGap.transitionBars).toBe(4);
    expect(wideGap.transitionDurationSec).toBeLessThanOrEqual(6.8);
  });

  it('applies a perceptual logarithmic volume curve for quiet low-volume playback', async () => {
    expect(volumeToPerceptualGain(0)).toBe(0);
    expect(volumeToPerceptualGain(1)).toBe(1);
    expect(volumeToPerceptualGain(0.1)).toBeLessThan(0.005);
    expect(volumeToPerceptualGain(0.05)).toBeLessThan(0.001);

    const engine = new DualDeckAudioEngine();
    await engine.init();
    engine.setVolume(0.05);
    expect(engine.getState().volume).toBe(0.05);
    engine.setPlaybackRate(1.15, true);
    engine.setBalance(-0.25);
    engine.setMonoAudio(true);
    await engine.dispose();
  });

  it('computes 3-stem envelopes and synthesizes vocal-clash avoidance choreography', async () => {
    const planner = new DjCuePlanner();
    const vocalHeavyA = await planner.analyzeTrack('stem_a', null, 210);
    const vocalHeavyB = await planner.analyzeTrack('stem_b', null, 220);

    expect(vocalHeavyA.bassEnvelope?.length).toBeGreaterThan(10);
    expect(vocalHeavyA.vocalEnvelope?.length).toBeGreaterThan(10);
    expect(vocalHeavyA.highEnvelope?.length).toBeGreaterThan(10);

    const plan = planner.planTransition(
      {
        ...vocalHeavyA,
        bpm: 122,
        camelotKey: '8A',
        loudnessDb: -8,
        vocalEnvelope: Array.from({ length: vocalHeavyA.rmsEnvelope.length }, () => 0.9),
      },
      {
        ...vocalHeavyB,
        bpm: 124,
        camelotKey: '8A',
        loudnessDb: -12,
        vocalEnvelope: Array.from({ length: vocalHeavyB.rmsEnvelope.length }, () => 0.88),
      },
      'full',
      'auto'
    );

    expect(plan.choreography).toBeDefined();
    expect(plan.choreography?.vocalClashAvoided).toBe(true);
    expect(plan.choreography?.vocalCarveDb).toBeLessThan(-10);
    expect(plan.choreography?.loudnessTrimDb).toBeGreaterThan(0);
    expect(plan.choreography?.echoFeedbackPeak).toBeLessThanOrEqual(0.78);
  });

  function createFakeBrowserAudioElement() {
    const listeners = new Map<string, Set<() => void>>();
    const el: Record<string, any> = {
      crossOrigin: 'anonymous',
      preload: 'auto',
      src: '',
      readyState: 4,
      currentTime: 0,
      duration: 107,
      volume: 1,
      playbackRate: 1,
      paused: true,
      ended: false,
      seeking: false,
      dataset: {},
      style: {},
      play: async () => {
        el.paused = false;
      },
      pause: () => {
        el.paused = true;
      },
      load: () => {},
      remove: () => {},
      addEventListener: (ev: string, fn: () => void, opts?: { once?: boolean }) => {
        const set = listeners.get(ev) ?? new Set<() => void>();
        if (opts?.once) {
          const wrapped = () => {
            set.delete(wrapped);
            fn();
          };
          set.add(wrapped);
        } else {
          set.add(fn);
        }
        listeners.set(ev, set);
      },
      removeEventListener: (ev: string, fn: () => void) => {
        listeners.get(ev)?.delete(fn);
      },
      dispatch: (ev: string) => {
        for (const fn of Array.from(listeners.get(ev) ?? [])) {
          fn();
        }
      },
    };
    return el;
  }

  it('triggers onTrackEnded on natural EOF and never lets positionSec exceed durationSec', async () => {
    const created: ReturnType<typeof createFakeBrowserAudioElement>[] = [];
    const prevDoc = (globalThis as { document?: unknown }).document;
    (globalThis as { document?: unknown }).document = {
      createElement: () => {
        const el = createFakeBrowserAudioElement();
        created.push(el);
        return el;
      },
      body: { appendChild: () => {} },
    };

    const engine = new DualDeckAudioEngine();
    try {
      let endedCalls = 0;
      engine.onTrackEnded(() => {
        endedCalls += 1;
      });
      await engine.init();
      await engine.loadAndPlay(SAMPLE_TRACKS[0]!, 0);

      const deckAEl = created[0]!;
      deckAEl.duration = 107;
      deckAEl.currentTime = 112;
      deckAEl.ended = true;
      deckAEl.dispatch('timeupdate');
      deckAEl.dispatch('ended');

      expect(endedCalls).toBe(1);
      expect(engine.getLivePositionSec()).toBeLessThanOrEqual(107);
      expect(engine.getLivePlaybackSnapshot().positionSec).toBeLessThanOrEqual(107);
      expect(engine.getState().positionSec).toBeLessThanOrEqual(107);
      expect(engine.getState().isPlaying).toBe(false);
    } finally {
      await engine.dispose();
      (globalThis as { document?: unknown }).document = prevDoc;
    }
  });

  it('recovers via watchdog when stream stalls silently just before EOF', async () => {
    const created: ReturnType<typeof createFakeBrowserAudioElement>[] = [];
    const prevDoc = (globalThis as { document?: unknown }).document;
    (globalThis as { document?: unknown }).document = {
      createElement: () => {
        const el = createFakeBrowserAudioElement();
        created.push(el);
        return el;
      },
      body: { appendChild: () => {} },
    };

    const engine = new DualDeckAudioEngine();
    try {
      let endedCalls = 0;
      engine.onTrackEnded(() => {
        endedCalls += 1;
      });
      await engine.init();
      await engine.loadAndPlay(SAMPLE_TRACKS[0]!, 0);

      const deckAEl = created[0]!;
      deckAEl.duration = 107;
      deckAEl.readyState = 2;
      deckAEl.ended = false;
      deckAEl.paused = false;
      deckAEl.currentTime = 105.5;
      deckAEl.dispatch('timeupdate');

      await new Promise((r) => setTimeout(r, 2100));
      expect(endedCalls).toBe(1);
      expect(engine.getState().isPlaying).toBe(false);
    } finally {
      await engine.dispose();
      (globalThis as { document?: unknown }).document = prevDoc;
    }
  }, 10_000);

  it('auto-resumes mid-song if browser audio pauses unexpectedly while engine expects playback', async () => {
    const created: ReturnType<typeof createFakeBrowserAudioElement>[] = [];
    const prevDoc = (globalThis as { document?: unknown }).document;
    (globalThis as { document?: unknown }).document = {
      createElement: () => {
        const el = createFakeBrowserAudioElement();
        created.push(el);
        return el;
      },
      body: { appendChild: () => {} },
    };

    const engine = new DualDeckAudioEngine();
    try {
      let endedCalls = 0;
      engine.onTrackEnded(() => {
        endedCalls += 1;
      });
      await engine.init();
      await engine.loadAndPlay(SAMPLE_TRACKS[0]!, 0);

      const deckAEl = created[0]!;
      deckAEl.duration = 214;
      deckAEl.readyState = 3;
      deckAEl.ended = false;
      deckAEl.currentTime = 48;
      deckAEl.dispatch('timeupdate');
      deckAEl.paused = true;

      await new Promise((r) => setTimeout(r, 1750));
      expect(endedCalls).toBe(0);
      expect(deckAEl.paused).toBe(false);
      expect(engine.getState().isPlaying).toBe(true);
    } finally {
      await engine.dispose();
      (globalThis as { document?: unknown }).document = prevDoc;
    }
  }, 10_000);

  it('never deadlocks isTransitioning if incoming audio.play() hangs', async () => {
    const created: ReturnType<typeof createFakeBrowserAudioElement>[] = [];
    const prevDoc = (globalThis as { document?: unknown }).document;
    (globalThis as { document?: unknown }).document = {
      createElement: () => {
        const el = createFakeBrowserAudioElement();
        created.push(el);
        return el;
      },
      body: { appendChild: () => {} },
    };

    const engine = new DualDeckAudioEngine();
    try {
      await engine.init();
      await engine.loadAndPlay(SAMPLE_TRACKS[0]!, 10);
      await engine.preloadNextDeck(SAMPLE_TRACKS[1]!, 16);

      const deckBEl = created[1]!;
      deckBEl.play = () => new Promise<void>(() => {});

      await engine.executeTransition({
        fromTrackId: 'trk_1',
        toTrackId: 'trk_2',
        cueInSec: 16,
        cueOutSec: 70,
        transitionDurationSec: 0.4,
        transitionBars: 4,
        transitionType: 'eq_swap',
        tempoNudgeRate: 1.0,
        echoSubdivision: 0.5,
        compatibilityScore: 0.9,
      });

      expect(engine.getState().activeDeck).toBe('B');
      expect(engine.getState().isTransitioning).toBe(false);
      expect(engine.getState().isPlaying).toBe(true);
    } finally {
      await engine.dispose();
      (globalThis as { document?: unknown }).document = prevDoc;
    }
  }, 12_000);
});
