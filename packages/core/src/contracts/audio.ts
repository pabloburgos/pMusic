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
  /** Optional 3-stem energy envelopes (~1Hz, 0..1) for stem-aware DJ transitions */
  bassEnvelope?: number[];
  vocalEnvelope?: number[];
  highEnvelope?: number[];
  /** First detected downbeat phase offset in seconds */
  beatPhaseSec?: number;
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

/**
 * Bespoke per-pair DSP stem choreography computed from real audio analysis
 * (bass, vocal mid pocket, high percussion, sweep filter, echo send & loudness trim).
 */
export interface DjStemChoreography {
  /** Normalized progress point [0.25..0.75] where sub-bass swaps decks */
  bassSwapPoint01: number;
  /** Normalized width of the sub-bass cross-fade */
  bassSwapWidth01: number;
  /** Outgoing vocal presence cut in dB (e.g. -16 dB) to prevent vocal clash */
  vocalCarveDb: number;
  /** Initial incoming mid hold in dB before full vocal takeover */
  incomingVocalHoldDb: number;
  /** Outgoing high-pass sweep ceiling in Hz during exit */
  outHighPassPeakHz: number;
  /** Incoming low-pass reveal starting frequency in Hz */
  inLowPassStartHz: number;
  /** Peak pre-fader bandpass echo send [0..0.7] */
  echoSendPeak: number;
  /** Peak feedback capped strictly <= 0.78 */
  echoFeedbackPeak: number;
  /** Early high-frequency stem entry lead [0..0.45] */
  highStemLead01: number;
  /** Gain trim in dB applied to incoming deck to match perceived loudness */
  loudnessTrimDb: number;
  /** True when vocal pocket carving is active because both tracks sing in the window */
  vocalClashAvoided: boolean;
  /** Concise Spanish human-readable description of what the DJ is sculpting */
  summary: string;
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
  /** Adaptive pairwise stem choreography */
  choreography?: DjStemChoreography;
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
  /** Adaptive 3-stem crossover & vocal-pocket sculpting */
  stemSculpting?: boolean;
  /** Avoid overlapping vocal stems during transition window */
  vocalClashProtection?: boolean;
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
