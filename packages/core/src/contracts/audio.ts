import type { DomainError } from '../errors.ts';
import type { Track } from '../types/music.ts';
import type { Unsubscribe } from '../types/utility.ts';

export type DeckId = 'A' | 'B';
export type DjSessionStyle = 'quick' | 'full';
export type DjTransitionType = 'eq_swap' | 'filter_sweep' | 'echo_out';

/** Individual DJ transition FX toggles exposed in the Sesión DJ UI */
export interface DjFxToggles {
  eq_swap: boolean;
  filter_sweep: boolean;
  echo_out: boolean;
}

export type TrackAnalysisSource = 'pcm' | 'heuristic';

export interface TrackAnalysis {
  trackId: string;
  durationSec: number;
  /** Estimated BPM clamped to [65, 175] */
  bpm: number;
  /** Confidence in [0, 1] */
  bpmConfidence: number;
  /** Normalized mean RMS energy in [0, 1] */
  meanEnergy: number;
  /** Normalized peak RMS energy in [0, 1] */
  peakEnergy: number;
  /** Downsampled ~1Hz energy envelope (0..1) for waveform/structure UI */
  rmsEnvelope: number[];
  introEndSec: number;
  primaryDropSec: number;
  chorusStartSec: number;
  chorusEndSec: number;
  outroStartSec: number;
  /** Optional Camelot wheel key (e.g. '8A', '9B') */
  camelotKey?: string;
  loudnessDb?: number;
  source: TrackAnalysisSource;
  analyzedAtMs: number;
}

export interface DeckTransitionPlan {
  fromTrackId: string;
  toTrackId: string;
  /** Incoming track start position in seconds */
  cueInSec: number;
  /** Outgoing track timestamp to launch incoming deck in seconds */
  cueOutSec: number;
  /** Quantized to 4 or 8 bars, clamped [4.5, 14.0] */
  transitionDurationSec: number;
  transitionBars: 4 | 8;
  transitionType: DjTransitionType;
  /** Incoming playbackRate clamped [0.96, 1.04] if |ΔBPM| <= 6%, else 1.0 */
  tempoNudgeRate: number;
  /** Beat subdivision for Echo Out: eighth (0.5) or dotted-eighth (0.75) */
  echoSubdivision: 0.5 | 0.75;
  /** Pair transition compatibility in [0, 1] */
  compatibilityScore: number;
}

export interface DjModeConfig {
  enabled: boolean;
  /** 'quick' (45–90s around drop/chorus) | 'full' */
  style: DjSessionStyle;
  autoReorderQueue: boolean;
  preferredTransition: 'auto' | DjTransitionType;
  /** Individual FX toggles; defaults to all `true` when omitted */
  enabledTransitions?: DjFxToggles;
  /** Gentle ±4% playbackRate nudge */
  tempoMatching: boolean;
}

export interface SafeCrossfadeConfig {
  /** Mutually exclusive with `DjModeConfig.enabled` (DJ Mode takes precedence) */
  enabled: boolean;
  /** Clamped to [0, 12] seconds */
  durationSec: number;
}

/** Exact 6 Spanish presets reconciled across PROJECT.md, SCOPE.md, and Design spec */
export type UserEqPresetId =
  | 'flat'
  | 'urbano'
  | 'vocal'
  | 'electronic'
  | 'acoustic'
  | 'custom';

/** 5-band graphic EQ gains in dB [-12, +12] for [60Hz, 230Hz, 910Hz, 3.6kHz, 14kHz] */
export type UserEqBandsDb = [number, number, number, number, number];

export interface UserEqPreset {
  readonly id: UserEqPresetId;
  readonly label: string;
  readonly description: string;
  readonly bandsDb: readonly [number, number, number, number, number];
}

export interface UserEqConfig {
  enabled: boolean;
  preset: UserEqPresetId;
  bandsDb: UserEqBandsDb;
}

export interface AudioAnalyserData {
  frequencyBins: Uint8Array;
  rmsLevel: number;
}

export interface AudioEngineState {
  activeDeck: DeckId;
  isPlaying: boolean;
  positionSec: number;
  durationSec: number;
  volume: number;
  isTransitioning: boolean;
  activeTransitionType?: DjTransitionType;
  transitionProgress01: number;
}

export interface IAudioEngine {
  init(): Promise<void>;
  loadAndPlay(track: Track, startSec?: number): Promise<void>;
  preloadNextDeck(track: Track, startSec?: number): Promise<void>;
  play(): Promise<void>;
  pause(): void;
  seek(positionSec: number): void;
  setVolume(volume01: number): void;
  setUserEq(config: UserEqConfig): void;
  setSafeCrossfade(config: SafeCrossfadeConfig): void;
  setDjMode(config: DjModeConfig): void;
  executeTransition(plan: DeckTransitionPlan): Promise<void>;
  cancelActiveTransition(): void;
  getAnalyserData(): AudioAnalyserData;
  getState(): AudioEngineState;
  onStateChange?(cb: (state: AudioEngineState) => void): Unsubscribe;
  onTrackEnded?(cb: (deck: DeckId) => void): Unsubscribe;
  onError?(cb: (error: DomainError) => void): Unsubscribe;
  dispose(): Promise<void>;
}

export interface IDjPlanner {
  analyzeTrack(
    trackId: string,
    audioData: ArrayBuffer | null,
    durationSec: number
  ): Promise<TrackAnalysis>;
  reorderQueueForSession(
    tracks: readonly Track[],
    analyses: ReadonlyMap<string, TrackAnalysis>,
    pinnedTrackId?: string
  ): Track[];
  planTransition(
    from: TrackAnalysis,
    to: TrackAnalysis,
    style: DjSessionStyle,
    preference: 'auto' | DjTransitionType,
    enabledTransitions?: DjFxToggles
  ): DeckTransitionPlan;
}
