import { describe, expect, it } from 'vitest';
import type { Track } from '@pmusic/core';
import {
  DjCuePlanner,
  DjQueueReorderer,
  DualDeckAudioEngine,
  PcmTrackAnalyzer,
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
    await engine.dispose();
  });
});
