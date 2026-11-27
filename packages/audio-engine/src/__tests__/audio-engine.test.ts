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

  it('chooses dynamic Pro-DJ choreography (vocal_over_beat, instrumental_bed, loop_build) and preserves exact pause time', async () => {
    const planner = new DjCuePlanner();
    const a1 = await planner.analyzeTrack('trk_1', null, 214);
    const a2 = await planner.analyzeTrack('trk_2', null, 224);

    const vocalOver = planner.planTransition(
      {
        ...a1,
        bpm: 120,
        vocalEnvelope: new Array(214).fill(0.82),
        bassEnvelope: new Array(214).fill(0.5),
      },
      {
        ...a2,
        bpm: 122,
        vocalEnvelope: new Array(224).fill(0.22),
        bassEnvelope: new Array(224).fill(0.84),
      },
      'full',
      'auto'
    );
    expect(vocalOver.transitionType).toBe('vocal_over_beat');
    expect(vocalOver.choreography?.techniqueMode).toBe('vocal_over_beat');

    const instBed = planner.planTransition(
      {
        ...a1,
        bpm: 118,
        vocalEnvelope: new Array(214).fill(0.25),
        bassEnvelope: new Array(214).fill(0.82),
      },
      {
        ...a2,
        bpm: 120,
        vocalEnvelope: new Array(224).fill(0.82),
        bassEnvelope: new Array(224).fill(0.52),
      },
      'full',
      'auto'
    );
    expect(instBed.transitionType).toBe('instrumental_bed');
    expect(instBed.choreography?.techniqueMode).toBe('instrumental_bed');

    const loopBuild = planner.planTransition(
      {
        ...a1,
        bpm: 96,
        vocalEnvelope: new Array(214).fill(0.2),
        bassEnvelope: new Array(214).fill(0.25),
        rmsEnvelope: new Array(214).fill(0.32),
      },
      {
        ...a2,
        bpm: 108,
        vocalEnvelope: new Array(224).fill(0.35),
        bassEnvelope: new Array(224).fill(0.45),
        rmsEnvelope: new Array(224).fill(0.75),
      },
      'full',
      'auto'
    );
    expect(loopBuild.transitionType).toBe('loop_build');
    expect(loopBuild.choreography?.techniqueMode).toBe('loop_build');

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
      await engine.loadAndPlay(SAMPLE_TRACKS[0]!, 0);
      const deckAEl = created[0]!;
      deckAEl.duration = 214;
      deckAEl.currentTime = 73.4;
      engine.pause();
      expect(engine.getState().isPlaying).toBe(false);
      expect(engine.getState().positionSec).toBeCloseTo(73.4, 1);
    } finally {
      await engine.dispose();
      (globalThis as { document?: unknown }).document = prevDoc;
    }
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

  it('tracks isBuffering state across loadAndPlay, playing, waiting, and pause', async () => {
    const created: ReturnType<typeof createFakeBrowserAudioElement>[] = [];
    const prevDoc = (globalThis as { document?: unknown }).document;
    (globalThis as { document?: unknown }).document = {
      createElement: () => {
        const el = createFakeBrowserAudioElement();
        el.readyState = 0;
        created.push(el);
        return el;
      },
      body: { appendChild: () => {} },
    };

    const engine = new DualDeckAudioEngine();
    try {
      await engine.init();
      const states: boolean[] = [];
      engine.onStateChange((st) => {
        states.push(Boolean(st.isBuffering));
      });

      await engine.loadAndPlay(SAMPLE_TRACKS[0]!, 0);
      expect(engine.getState().isBuffering).toBe(true);

      const deckAEl = created[0]!;
      deckAEl.readyState = 4;
      deckAEl.dispatch('playing');
      expect(engine.getState().isBuffering).toBe(false);

      deckAEl.readyState = 1;
      deckAEl.dispatch('waiting');
      expect(engine.getState().isBuffering).toBe(true);

      deckAEl.paused = false;
      deckAEl.currentTime = 12.4;
      deckAEl.dispatch('timeupdate');
      expect(engine.getState().isBuffering).toBe(false);

      const errs: string[] = [];
      engine.onError((err) => {
        errs.push(err.code);
      });
      deckAEl.dispatch('waiting');
      expect(engine.getState().isBuffering).toBe(true);
      deckAEl.dispatch('error');
      expect(engine.getState().isBuffering).toBe(false);
      expect(engine.getState().isPlaying).toBe(false);
      expect(errs).toContain('TRACK_UNPLAYABLE');

      engine.pause();
      expect(engine.getState().isBuffering).toBe(false);
      expect(states).toContain(true);
      expect(states).toContain(false);
    } finally {
      await engine.dispose();
      (globalThis as { document?: unknown }).document = prevDoc;
    }
  });

  it('streams directly on a single audio connection, ignores aborted errors, and cancels DJ mode immediately', async () => {
    const created: ReturnType<typeof createFakeBrowserAudioElement>[] = [];
    const prevDoc = (globalThis as { document?: unknown }).document;
    const prevFetch = globalThis.fetch;
    let fetchCalls = 0;

    (globalThis as { document?: unknown }).document = {
      createElement: () => {
        const el = createFakeBrowserAudioElement();
        el.readyState = 2;
        created.push(el);
        return el;
      },
      body: { appendChild: () => {} },
    };
    globalThis.fetch = (async () => {
      fetchCalls++;
      return new Response(new Uint8Array(0), { status: 200 });
    }) as typeof fetch;

    const engine = new DualDeckAudioEngine({
      resolveStreamUrl: async () => 'https://stream.pmusic.test/trk_1',
    });
    try {
      await engine.init();
      const errs: string[] = [];
      engine.onError((e) => errs.push(e.code));

      await engine.loadAndPlay(SAMPLE_TRACKS[0]!, 0);
      created[0]!.readyState = 4;
      created[0]!.dispatch('playing');
      await new Promise((r) => setTimeout(r, 40));

      // Single-stream design: never opens redundant background full-file downloads
      expect(fetchCalls).toBe(0);

      // Aborted error during rapid track swap does not emit TRACK_UNPLAYABLE
      (created[0]! as unknown as { error?: { code: number } }).error = { code: 1 };
      created[0]!.dispatch('error');
      expect(errs).toHaveLength(0);

      // Immediate DJ deactivation cancels active transition & restores playbackRate = 1.0
      engine.setDjMode({
        enabled: true,
        style: 'quick',
        autoReorderQueue: false,
        preferredTransition: 'auto',
        tempoMatching: true,
      });
      await engine.preloadNextDeck(SAMPLE_TRACKS[1]!, 4);
      const pendingTransition = engine.executeTransition({
        fromTrackId: SAMPLE_TRACKS[0]!.id,
        toTrackId: SAMPLE_TRACKS[1]!.id,
        cueInSec: 4,
        cueOutSec: 70,
        transitionDurationSec: 4,
        transitionBars: 4,
        transitionType: 'eq_swap',
        tempoNudgeRate: 1.04,
        echoSubdivision: 0.5,
        compatibilityScore: 0.9,
      });
      await new Promise((r) => setTimeout(r, 40));
      expect(engine.getState().isTransitioning).toBe(true);

      engine.setDjMode({
        enabled: false,
        style: 'quick',
        autoReorderQueue: false,
        preferredTransition: 'auto',
        tempoMatching: true,
      });
      await pendingTransition;
      expect(engine.getState().isTransitioning).toBe(false);
      expect(created[0]!.playbackRate).toBe(1);
      expect(created[1]!.playbackRate).toBe(1);
    } finally {
      await engine.dispose();
      (globalThis as { document?: unknown }).document = prevDoc;
      globalThis.fetch = prevFetch;
    }
  });

  it('composes multi-layer generative DJ choreography (BPM ramp, stems, dual filters, loop & echo) per track pair', async () => {
    const planner = new DjCuePlanner();
    const a1 = await planner.analyzeTrack('gen_1', null, 200);
    const a2 = await planner.analyzeTrack('gen_2', null, 210);

    const plan = planner.planTransition(
      {
        ...a1,
        bpm: 118,
        camelotKey: '8A',
        vocalEnvelope: new Array(200).fill(0.76),
        bassEnvelope: new Array(200).fill(0.62),
        rmsEnvelope: new Array(200).fill(0.45),
      },
      {
        ...a2,
        bpm: 125,
        camelotKey: '9A',
        vocalEnvelope: new Array(210).fill(0.72),
        bassEnvelope: new Array(210).fill(0.78),
        rmsEnvelope: new Array(210).fill(0.84),
      },
      'full',
      'auto'
    );

    const ch = plan.choreography;
    expect(ch).toBeDefined();
    expect(ch?.stemAutomation).toBeDefined();
    expect(ch?.outTempoTargetRate).toBeGreaterThan(1.0);
    expect(ch?.inTempoStartRate).toBeLessThan(1.0);
    expect(ch?.outFilterLayer?.enabled).toBe(true);
    expect(ch?.inFilterLayer?.enabled).toBe(true);
    expect(ch?.loopLayer?.enabled).toBe(true);
    expect(ch?.echoLayer?.enabled).toBe(true);
    expect(ch?.echoLayer?.peakFeedback).toBeLessThanOrEqual(0.78);
    expect((ch?.activeLayers?.length ?? 0)).toBeGreaterThanOrEqual(4);

    const engine = new DualDeckAudioEngine();
    await engine.init();
    await engine.loadAndPlay(SAMPLE_TRACKS[0]!, 10);
    await engine.preloadNextDeck(SAMPLE_TRACKS[1]!, plan.cueInSec);
    await engine.executeTransition({
      ...plan,
      fromTrackId: SAMPLE_TRACKS[0]!.id,
      toTrackId: SAMPLE_TRACKS[1]!.id,
      transitionDurationSec: 0.35,
    });
    expect(engine.getState().activeDeck).toBe('B');
    expect(engine.getState().isTransitioning).toBe(false);
    expect(engine.getState().isPlaying).toBe(true);
    await engine.dispose();
  });

  it('ignores implausible 2x audio.duration glitches and preserves track metadata durationSec', async () => {
    const created: ReturnType<typeof createFakeBrowserAudioElement>[] = [];
    const prevDoc = (globalThis as { document?: unknown }).document;
    (globalThis as { document?: unknown }).document = {
      createElement: () => {
        const el = createFakeBrowserAudioElement();
        el.duration = 368;
        el.readyState = 4;
        created.push(el);
        return el;
      },
      body: { appendChild: () => {} },
    };

    const engine = new DualDeckAudioEngine();
    try {
      await engine.init();
      await engine.loadAndPlay(
        { ...SAMPLE_TRACKS[0]!, durationSec: 184 },
        0
      );
      created[0]!.duration = 368;
      created[0]!.dispatch('loadedmetadata');
      created[0]!.dispatch('durationchange');
      created[0]!.currentTime = 12;
      created[0]!.paused = false;
      created[0]!.dispatch('timeupdate');

      expect(engine.getState().durationSec).toBe(184);
    } finally {
      await engine.dispose();
      (globalThis as { document?: unknown }).document = prevDoc;
    }
  });

  it('starts eq_swap cleanly without resetting active outgoing deck when no transition is in flight', async () => {
    const created: ReturnType<typeof createFakeBrowserAudioElement>[] = [];
    const prevDoc = (globalThis as { document?: unknown }).document;
    (globalThis as { document?: unknown }).document = {
      createElement: () => {
        const el = createFakeBrowserAudioElement();
        el.duration = 210;
        el.readyState = 4;
        created.push(el);
        return el;
      },
      body: { appendChild: () => {} },
    };

    const engine = new DualDeckAudioEngine();
    try {
      await engine.init();
      await engine.loadAndPlay(SAMPLE_TRACKS[0]!, 10);
      await engine.preloadNextDeck(SAMPLE_TRACKS[1]!, 0);

      let deckAPauseCallsBeforeHandoff = 0;
      const origPause = created[0]!.pause.bind(created[0]!);
      created[0]!.pause = () => {
        if (engine.getState().isTransitioning && engine.getState().transitionProgress01 < 0.99) {
          deckAPauseCallsBeforeHandoff++;
        }
        origPause();
      };

      await engine.executeTransition({
        fromTrackId: SAMPLE_TRACKS[0]!.id,
        toTrackId: SAMPLE_TRACKS[1]!.id,
        cueInSec: 0,
        cueOutSec: 180,
        transitionDurationSec: 0.35,
        transitionBars: 4,
        transitionType: 'eq_swap',
        tempoNudgeRate: 1.0,
        echoSubdivision: 0.5,
        compatibilityScore: 0.85,
      });

      expect(deckAPauseCallsBeforeHandoff).toBe(0);
      expect(engine.getState().activeDeck).toBe('B');
      expect(engine.getState().isTransitioning).toBe(false);
    } finally {
      await engine.dispose();
      (globalThis as { document?: unknown }).document = prevDoc;
    }
  });

  it('never leaks previous track position or triggers EOF while loadAndPlay resolves the next stream asynchronously', async () => {
    const created: ReturnType<typeof createFakeBrowserAudioElement>[] = [];
    const prevDoc = (globalThis as { document?: unknown }).document;
    (globalThis as { document?: unknown }).document = {
      createElement: () => {
        const el = createFakeBrowserAudioElement();
        el.duration = 180;
        el.readyState = 4;
        created.push(el);
        return el;
      },
      body: { appendChild: () => {} },
    };

    const engine = new DualDeckAudioEngine({
      resolveStreamUrl: async (track) => {
        if (track.id === SAMPLE_TRACKS[1]!.id) {
          await new Promise((r) => setTimeout(r, 70));
        }
        return `https://stream.pmusic.test/${track.id}`;
      },
    });
    try {
      let endedCalls = 0;
      engine.onTrackEnded(() => {
        endedCalls += 1;
      });
      await engine.init();
      await engine.loadAndPlay(SAMPLE_TRACKS[0]!, 0);

      // Put outgoing deck into final crossfade / near-EOF zone
      const deckAEl = created[0]!;
      deckAEl.duration = 180;
      deckAEl.currentTime = 175;
      deckAEl.paused = false;

      const loadPromise = engine.loadAndPlay(SAMPLE_TRACKS[1]!, 0);
      // Wait just long enough for loadAndPlay to pause deckA and await stream resolution
      await new Promise((r) => setTimeout(r, 15));

      const snapDuringLoad = engine.getLivePlaybackSnapshot();
      expect(snapDuringLoad.positionSec).toBe(0);
      expect(snapDuringLoad.isEnded).toBe(false);
      expect(endedCalls).toBe(0);

      await loadPromise;
      expect(engine.getLivePlaybackSnapshot().positionSec).toBe(0);
      expect(endedCalls).toBe(0);
    } finally {
      await engine.dispose();
      (globalThis as { document?: unknown }).document = prevDoc;
    }
  });

  it('reuses a single Uint8Array analyser buffer across calls with zero per-frame allocation', async () => {
    const engine = new DualDeckAudioEngine();
    await engine.init();
    const first = engine.getAnalyserData().frequencyBins;
    const second = engine.getAnalyserData().frequencyBins;
    expect(first).toBe(second);
    await engine.dispose();
  });

  it('configures transparent brickwall safety limiter (-0.3 dB / knee 0) and zero-roll-off idle sweep filters with playback AudioContext hint', async () => {
    const prevWindow = (globalThis as { window?: unknown }).window;
    const createdCompressors: Array<{
      threshold: { value: number };
      knee: { value: number };
      ratio: { value: number };
      attack: { value: number };
      release: { value: number };
      connect: () => void;
    }> = [];
    const createdFilters: Array<{
      type: string;
      frequency: { value: number };
      Q: { value: number };
      gain: { value: number };
      connect: () => void;
    }> = [];
    let capturedCtxOpts: unknown;

    class MockAudioContext {
      public currentTime = 0;
      public state = 'running';
      public destination = {};
      public constructor(opts?: unknown) {
        capturedCtxOpts = opts;
      }
      public createBiquadFilter() {
        const node = {
          type: 'lowpass',
          frequency: { value: 350 },
          Q: { value: 1 },
          gain: { value: 0 },
          connect: () => {},
        };
        createdFilters.push(node);
        return node;
      }
      public createDynamicsCompressor() {
        const comp = {
          threshold: { value: -24 },
          knee: { value: 30 },
          ratio: { value: 12 },
          attack: { value: 0.003 },
          release: { value: 0.25 },
          connect: () => {},
        };
        createdCompressors.push(comp);
        return comp;
      }
      public createGain() {
        return { gain: { value: 1 }, connect: () => {} };
      }
      public createStereoPanner() {
        return { pan: { value: 0 }, connect: () => {} };
      }
      public createAnalyser() {
        return { fftSize: 256, smoothingTimeConstant: 0.8, connect: () => {}, getByteFrequencyData: () => {} };
      }
      public createMediaElementSource() {
        return { connect: () => {} };
      }
      public createDelay() {
        return { delayTime: { value: 0 }, connect: () => {} };
      }
      public close() {
        return Promise.resolve();
      }
    }

    (globalThis as { window?: unknown }).window = {
      AudioContext: MockAudioContext,
    };

    const engine = new DualDeckAudioEngine();
    try {
      await engine.init();
      expect(capturedCtxOpts).toEqual({ latencyHint: 'playback' });
      expect(createdCompressors).toHaveLength(1);
      expect(createdCompressors[0]?.threshold.value).toBe(-0.3);
      expect(createdCompressors[0]?.knee.value).toBe(0);
      expect(createdCompressors[0]?.ratio.value).toBe(20);

      // Both deck sweep filters should idle at flat peaking 0 dB instead of lowpass 20 kHz
      const peakingSweepNodes = createdFilters.filter(
        (f) => f.type === 'peaking' && f.frequency.value === 1000 && f.Q.value === 0.707 && f.gain.value === 0
      );
      expect(peakingSweepNodes.length).toBeGreaterThanOrEqual(2);
    } finally {
      await engine.dispose();
      (globalThis as { window?: unknown }).window = prevWindow;
    }
  });

  it('uses cancelAndHoldAtTime, hardware equal-power setValueCurveAtTime, and zero redundant playbackRate/preservesPitch writes during Safe Crossfade', async () => {
    const prevWindow = (globalThis as { window?: unknown }).window;
    const prevDoc = (globalThis as { document?: unknown }).document;
    const holdCalls: number[] = [];
    const valueCurveCalls: Array<{ length: number; startTime: number; duration: number }> = [];
    const playbackRateWrites: Array<{ deckIdx: number; value: number }> = [];
    const preservesPitchWrites: Array<{ deckIdx: number; value: boolean }> = [];
    let filterTypeWrites = 0;

    function createTrackedParam(initial = 1) {
      return {
        value: initial,
        cancelAndHoldAtTime(t: number) {
          holdCalls.push(t);
        },
        cancelScheduledValues() {},
        setValueAtTime() {},
        setTargetAtTime(v: number) {
          this.value = v;
        },
        setValueCurveAtTime(values: Float32Array, startTime: number, duration: number) {
          valueCurveCalls.push({ length: values.length, startTime, duration });
        },
      };
    }

    class MockWebAudioContext {
      public currentTime = 1.0;
      public state = 'running';
      public destination = {};
      public createBiquadFilter() {
        let currentType = 'lowpass';
        return {
          get type() {
            return currentType;
          },
          set type(next: string) {
            filterTypeWrites += 1;
            currentType = next;
          },
          frequency: createTrackedParam(1000),
          Q: createTrackedParam(0.707),
          gain: createTrackedParam(0),
          connect: () => {},
        };
      }
      public createDynamicsCompressor() {
        return {
          threshold: createTrackedParam(-24),
          knee: createTrackedParam(30),
          ratio: createTrackedParam(12),
          attack: createTrackedParam(0.003),
          release: createTrackedParam(0.25),
          connect: () => {},
        };
      }
      public createGain() {
        return { gain: createTrackedParam(1), connect: () => {} };
      }
      public createStereoPanner() {
        return { pan: createTrackedParam(0), connect: () => {} };
      }
      public createAnalyser() {
        return { fftSize: 256, smoothingTimeConstant: 0.8, connect: () => {}, getByteFrequencyData: () => {} };
      }
      public createMediaElementSource() {
        return { connect: () => {} };
      }
      public createDelay() {
        return { delayTime: createTrackedParam(0), connect: () => {} };
      }
      public close() {
        return Promise.resolve();
      }
    }

    let createdCount = 0;
    (globalThis as { window?: unknown }).window = {
      AudioContext: MockWebAudioContext,
    };
    (globalThis as { document?: unknown }).document = {
      createElement: () => {
        const deckIdx = createdCount++;
        let curRate = 1;
        let curPreserves = true;
        const el: Record<string, any> = {
          crossOrigin: 'anonymous',
          preload: 'auto',
          src: '',
          readyState: 4,
          currentTime: 0,
          duration: 180,
          volume: 1,
          paused: true,
          ended: false,
          seeking: false,
          loop: false,
          dataset: {},
          style: {},
          get playbackRate() {
            return curRate;
          },
          set playbackRate(v: number) {
            playbackRateWrites.push({ deckIdx, value: v });
            curRate = v;
          },
          get preservesPitch() {
            return curPreserves;
          },
          set preservesPitch(v: boolean) {
            preservesPitchWrites.push({ deckIdx, value: v });
            curPreserves = v;
          },
          play: async () => {
            el.paused = false;
          },
          pause: () => {
            el.paused = true;
          },
          load: () => {},
          remove: () => {},
          addEventListener: () => {},
          removeEventListener: () => {},
          setAttribute: () => {},
        };
        return el;
      },
      body: { appendChild: () => {} },
    };

    const engine = new DualDeckAudioEngine();
    try {
      await engine.init();
      await engine.loadAndPlay(SAMPLE_TRACKS[0]!, 0);
      await engine.preloadNextDeck(SAMPLE_TRACKS[1]!, 0);

      // Clear boot/preload counts before measuring the live transition itself
      playbackRateWrites.length = 0;
      preservesPitchWrites.length = 0;
      holdCalls.length = 0;
      valueCurveCalls.length = 0;
      const filterWritesBefore = filterTypeWrites;

      await engine.executeTransition({
        fromTrackId: 'trk_1',
        toTrackId: 'trk_2',
        cueInSec: 0,
        cueOutSec: 170,
        transitionDurationSec: 0.35,
        transitionBars: 4,
        transitionType: 'eq_swap',
        tempoNudgeRate: 1.0,
        echoSubdivision: 0.5,
        compatibilityScore: 0.85,
        isPlainCrossfade: true,
      });

      // Safe Crossfade schedules hardware equal-power curve & holds params without abrupt snapping
      expect(valueCurveCalls).toHaveLength(2);
      expect(valueCurveCalls[0]?.length).toBe(65);
      expect(holdCalls.length).toBeGreaterThanOrEqual(2);
      // Neither deck receives redundant playbackRate/preservesPitch writes when already 1.0/true
      expect(playbackRateWrites).toHaveLength(0);
      expect(preservesPitchWrites).toHaveLength(0);
      // Sweep filter was already 'peaking' so finishing crossfade never flips live filter types
      expect(filterTypeWrites).toBe(filterWritesBefore);
      expect(engine.getState().activeDeck).toBe('B');
      expect(engine.getState().isPlaying).toBe(true);
    } finally {
      await engine.dispose();
      (globalThis as { window?: unknown }).window = prevWindow;
      (globalThis as { document?: unknown }).document = prevDoc;
    }
  });
});
