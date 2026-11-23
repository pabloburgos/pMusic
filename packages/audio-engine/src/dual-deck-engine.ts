import {
  DomainError,
  USER_EQ_FREQUENCIES_HZ,
  clampEqGainDb,
  type AudioAnalyserData,
  type AudioEngineState,
  type DeckId,
  type DeckTransitionPlan,
  type DjModeConfig,
  type DjTransitionType,
  type IAudioEngine,
  type SafeCrossfadeConfig,
  type Track,
  type Unsubscribe,
  type UserEqConfig,
} from '@pmusic/core';

export interface DualDeckAudioEngineOptions {
  resolveStreamUrl?: (track: Track) => Promise<string>;
}

interface DeckChannelNodes {
  readonly id: DeckId;
  readonly audio: HTMLAudioElement;
  track: Track | null;
  sourceNode?: MediaElementAudioSourceNode;
  lowEqNode?: BiquadFilterNode;
  midEqNode?: BiquadFilterNode;
  highEqNode?: BiquadFilterNode;
  sweepFilterNode?: BiquadFilterNode;
  trimGainNode?: GainNode;
  gainNode?: GainNode;
  delaySendNode?: GainNode;
  delayBandpassNode?: BiquadFilterNode;
  delayNode?: DelayNode;
  delayFeedbackNode?: GainNode;
}

function resetAudioParam(
  param: AudioParam | undefined,
  ctx: AudioContext | null,
  value: number
): void {
  if (!param) return;
  try {
    if (ctx && typeof param.cancelScheduledValues === 'function') {
      param.cancelScheduledValues(0);
    }
    if (ctx && typeof param.setValueAtTime === 'function') {
      param.setValueAtTime(value, ctx.currentTime);
    }
  } catch {
    // ignore in synthetic audio contexts
  }
  param.value = value;
}

function setAudioParamSmooth(
  param: AudioParam | undefined,
  ctx: AudioContext | null,
  value: number,
  timeConstantSec = 0.03
): void {
  if (!param) return;
  if (ctx && typeof param.setTargetAtTime === 'function') {
    try {
      param.cancelScheduledValues?.(ctx.currentTime);
      param.setTargetAtTime(value, ctx.currentTime, timeConstantSec);
      return;
    } catch {
      // fall through
    }
  }
  param.value = value;
}

/**
 * Converts a linear [0..1] UI volume slider value to a perceptual gain multiplier
 * (~-56 dB at 10%, ~-73 dB at 5%, whisper-quiet minimum) matching human hearing.
 */
export function volumeToPerceptualGain(volume01: number): number {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(volume01) ? volume01 : 0.85));
  if (clamped <= 0) return 0;
  return Math.pow(clamped, 2.8);
}

export async function waitForAudioReady(
  audio: HTMLAudioElement,
  targetSec: number,
  timeoutMs = 4200
): Promise<void> {
  const safeTarget = Math.max(0, targetSec);
  // Instant path for synthetic mock audio elements in Vitest
  if (typeof (audio as { readyState?: unknown }).readyState !== 'number') {
    try {
      audio.currentTime = safeTarget;
    } catch {
      // ignore
    }
    return;
  }

  const seekTarget = () => {
    try {
      const maxDur =
        Number.isFinite(audio.duration) && audio.duration > 1 ? audio.duration - 0.5 : safeTarget;
      const desired = Math.max(0, Math.min(maxDur, safeTarget));
      if (Math.abs((audio.currentTime || 0) - desired) > 0.35) {
        audio.currentTime = desired;
      }
    } catch {
      // ignore before metadata
    }
  };

  if (audio.readyState >= 2) {
    seekTarget();
    if (safeTarget <= 0.2 || audio.readyState >= 3) return;
  } else if (audio.readyState >= 1) {
    seekTarget();
  }

  await new Promise<void>((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      audio.removeEventListener('loadedmetadata', onMeta);
      audio.removeEventListener('loadeddata', done);
      audio.removeEventListener('canplay', done);
      audio.removeEventListener('canplaythrough', done);
      audio.removeEventListener('seeked', done);
      clearTimeout(timer);
      resolve();
    };
    const onMeta = () => {
      seekTarget();
      if (safeTarget <= 0.2 && audio.readyState >= 2) {
        done();
      }
    };
    const timer = setTimeout(() => {
      seekTarget();
      done();
    }, timeoutMs);

    audio.addEventListener('loadedmetadata', onMeta);
    audio.addEventListener('loadeddata', done);
    audio.addEventListener('canplay', done);
    audio.addEventListener('canplaythrough', done);
    audio.addEventListener('seeked', done);
    if (audio.readyState >= 1) {
      seekTarget();
    }
  });
}

export class DualDeckAudioEngine implements IAudioEngine {
  private readonly resolveStreamUrlFn: (track: Track) => Promise<string>;
  private audioCtx: AudioContext | null = null;
  private userEqNodes: BiquadFilterNode[] = [];
  private masterGainNode: GainNode | null = null;
  private stereoPannerNode: StereoPannerNode | null = null;
  private limiterNode: DynamicsCompressorNode | null = null;
  private analyserNode: AnalyserNode | null = null;

  private deckA: DeckChannelNodes | null = null;
  private deckB: DeckChannelNodes | null = null;

  private activeDeck: DeckId = 'A';
  private isPlaying = false;
  private positionSec = 0;
  private durationSec = 0;
  private volume = 0.85;
  private playbackRate = 1.0;
  private preservesPitch = true;
  private stereoBalance = 0;
  private monoAudio = false;
  private normalizationEnabled = true;
  private normalizationTargetDb = -11;
  private isTransitioning = false;
  private activeTransitionType?: DjTransitionType;
  private transitionProgress01 = 0;
  private transitionTimer: ReturnType<typeof setInterval> | null = null;
  private transitionRafId: number | null = null;
  private transitionResolve: (() => void) | null = null;
  private watchdogTimer: ReturnType<typeof setInterval> | null = null;

  private userEqConfig: UserEqConfig = {
    enabled: true,
    preset: 'flat',
    bandsDb: [0, 0, 0, 0, 0],
  };

  private safeCrossfadeConfig: SafeCrossfadeConfig = {
    enabled: false,
    durationSec: 4,
  };

  private djModeConfig: DjModeConfig = {
    enabled: false,
    style: 'quick',
    autoReorderQueue: true,
    preferredTransition: 'auto',
    enabledTransitions: { eq_swap: true, filter_sweep: true, echo_out: true },
    tempoMatching: true,
  };

  private readonly stateListeners = new Set<(state: AudioEngineState) => void>();
  private readonly endedListeners = new Set<(deck: DeckId) => void>();
  private readonly errorListeners = new Set<(error: DomainError) => void>();

  public constructor(options: DualDeckAudioEngineOptions = {}) {
    this.resolveStreamUrlFn =
      options.resolveStreamUrl ??
      (async (track: Track) => `/api/stream/${encodeURIComponent(track.id)}?quality=high`);
  }

  public async init(): Promise<void> {
    if (this.deckA && this.deckB) return;

    this.deckA = this.createDeckElement('A');
    this.deckB = this.createDeckElement('B');

    const AudioCtxCtor =
      typeof window !== 'undefined'
        ? window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        : undefined;

    if (AudioCtxCtor) {
      try {
        const ctx = new AudioCtxCtor();
        this.audioCtx = ctx;

        this.userEqNodes = USER_EQ_FREQUENCIES_HZ.map((freq, idx) => {
          const biquad = ctx.createBiquadFilter();
          biquad.type = idx === 0 ? 'lowshelf' : idx === USER_EQ_FREQUENCIES_HZ.length - 1 ? 'highshelf' : 'peaking';
          biquad.frequency.value = freq;
          biquad.Q.value = 1.0;
          biquad.gain.value = this.userEqConfig.enabled
            ? clampEqGainDb(this.userEqConfig.bandsDb[idx] ?? 0)
            : 0;
          return biquad;
        });

        this.limiterNode = ctx.createDynamicsCompressor();
        this.limiterNode.threshold.value = -1.5;
        this.limiterNode.knee.value = 6;
        this.limiterNode.ratio.value = 12;
        this.limiterNode.attack.value = 0.003;
        this.limiterNode.release.value = 0.15;

        this.masterGainNode = ctx.createGain();
        this.masterGainNode.gain.value = volumeToPerceptualGain(this.volume);
        if (this.monoAudio) {
          try {
            this.masterGainNode.channelCountMode = 'explicit';
            this.masterGainNode.channelCount = 1;
          } catch {
            // ignore in limited AudioContext implementations
          }
        }

        if (typeof ctx.createStereoPanner === 'function') {
          this.stereoPannerNode = ctx.createStereoPanner();
          this.stereoPannerNode.pan.value = this.stereoBalance;
        }

        this.analyserNode = ctx.createAnalyser();
        this.analyserNode.fftSize = 256;
        this.analyserNode.smoothingTimeConstant = 0.8;

        for (let i = 0; i < this.userEqNodes.length - 1; i++) {
          this.userEqNodes[i]!.connect(this.userEqNodes[i + 1]!);
        }
        const firstEq = this.userEqNodes[0]!;
        const lastEq = this.userEqNodes[this.userEqNodes.length - 1]!;
        lastEq.connect(this.limiterNode);
        this.limiterNode.connect(this.masterGainNode);
        if (this.stereoPannerNode) {
          this.masterGainNode.connect(this.stereoPannerNode);
          this.stereoPannerNode.connect(this.analyserNode);
        } else {
          this.masterGainNode.connect(this.analyserNode);
        }
        this.analyserNode.connect(ctx.destination);

        this.wireDeckWebAudioNodes(ctx, this.deckA, firstEq);
        this.wireDeckWebAudioNodes(ctx, this.deckB, firstEq);
      } catch {
        // Fallback to pure HTMLAudioElement playback when Web Audio is unavailable in test runners
      }
    }
    if (!this.audioCtx) {
      const initGain = volumeToPerceptualGain(this.volume);
      this.deckA.audio.volume = initGain;
      this.deckB.audio.volume = initGain;
    }

    if (!this.watchdogTimer) {
      this.watchdogTimer = setInterval(() => {
        if (!this.isPlaying || this.isTransitioning || !this.deckA || !this.deckB) return;
        const deck = this.getDeck(this.activeDeck);
        const audio = deck.audio;
        const isBrowserAudio = typeof (audio as { readyState?: unknown }).readyState === 'number';
        if (!isBrowserAudio) return;

        if (Number.isFinite(audio.currentTime) && audio.currentTime >= 0) {
          this.positionSec = audio.currentTime;
        }
        if (Number.isFinite(audio.duration) && audio.duration > 1) {
          this.durationSec = audio.duration;
        }
        const realDur =
          Number.isFinite(audio.duration) && audio.duration > 10
            ? audio.duration
            : this.durationSec;

        if (audio.ended || (realDur > 10 && audio.currentTime >= realDur - 0.35)) {
          this.isPlaying = false;
          this.emitState();
          for (const listener of this.endedListeners) {
            listener(this.activeDeck);
          }
          return;
        }
        this.emitState();
      }, 380);
      (this.watchdogTimer as { unref?: () => void }).unref?.();
    }
  }

  private createDeckElement(id: DeckId): DeckChannelNodes {
    let audio: HTMLAudioElement;
    if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
      audio = document.createElement('audio');
      // Critical invariant #1: crossOrigin="anonymous" MUST be set before src
      audio.crossOrigin = 'anonymous';
      audio.preload = 'auto';
      audio.dataset.deck = id;
      audio.style.display = 'none';
      document.body?.appendChild(audio);
    } else {
      audio = {
        crossOrigin: 'anonymous',
        preload: 'auto',
        src: '',
        currentTime: 0,
        duration: 180,
        volume: volumeToPerceptualGain(this.volume),
        playbackRate: 1,
        paused: true,
        dataset: { deck: id },
        play: async () => {
          (audio as { paused: boolean }).paused = false;
        },
        pause: () => {
          (audio as { paused: boolean }).paused = true;
        },
        load: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        remove: () => {},
      } as unknown as HTMLAudioElement;
    }

    let eofFiredForSrc = '';
    const fireEndedIfActive = () => {
      if (this.activeDeck !== id || this.isTransitioning) {
        return;
      }
      const curSrc = audio.src || id;
      if (eofFiredForSrc === curSrc && !this.isPlaying) {
        return;
      }
      eofFiredForSrc = curSrc;
      this.isPlaying = false;
      this.emitState();
      for (const listener of this.endedListeners) {
        listener(id);
      }
    };

    const syncDuration = () => {
      if (this.activeDeck !== id) return;
      if (Number.isFinite(audio.duration) && audio.duration > 1) {
        this.durationSec = audio.duration;
        this.emitState();
      }
    };

    audio.addEventListener('loadedmetadata', syncDuration);
    audio.addEventListener('durationchange', syncDuration);

    audio.addEventListener('timeupdate', () => {
      if (this.activeDeck === id) {
        this.positionSec = Number.isFinite(audio.currentTime) ? audio.currentTime : this.positionSec;
        if (Number.isFinite(audio.duration) && audio.duration > 1) {
          this.durationSec = audio.duration;
        } else if (this.positionSec + 0.5 > this.durationSec) {
          this.durationSec = Math.ceil(this.positionSec + 12);
        }
        this.emitState();

        if (
          !this.isTransitioning &&
          this.isPlaying &&
          (audio.ended ||
            (Number.isFinite(audio.duration) &&
              audio.duration > 10 &&
              audio.currentTime >= audio.duration - 0.15 &&
              audio.paused))
        ) {
          fireEndedIfActive();
        }
      }
    });

    audio.addEventListener('ended', () => {
      fireEndedIfActive();
    });

    return {
      id,
      audio,
      track: null,
    };
  }

  private wireDeckWebAudioNodes(
    ctx: AudioContext,
    deck: DeckChannelNodes,
    destination: AudioNode
  ): void {
    try {
      const source = ctx.createMediaElementSource(deck.audio);

      const lowEq = ctx.createBiquadFilter();
      lowEq.type = 'lowshelf';
      lowEq.frequency.value = 200;
      lowEq.gain.value = 0;

      const midEq = ctx.createBiquadFilter();
      midEq.type = 'peaking';
      midEq.frequency.value = 1000;
      midEq.Q.value = 0.8;
      midEq.gain.value = 0;

      const highEq = ctx.createBiquadFilter();
      highEq.type = 'highshelf';
      highEq.frequency.value = 4000;
      highEq.gain.value = 0;

      const sweepFilter = ctx.createBiquadFilter();
      sweepFilter.type = 'lowpass';
      sweepFilter.frequency.value = 20000;
      sweepFilter.Q.value = 0.707;

      const trimGain = ctx.createGain();
      trimGain.gain.value = 1.0;

      const deckGain = ctx.createGain();
      deckGain.gain.value = 1.0;

      const delaySend = ctx.createGain();
      delaySend.gain.value = 0;

      const delayBandpass = ctx.createBiquadFilter();
      delayBandpass.type = 'bandpass';
      delayBandpass.frequency.value = 1400;
      delayBandpass.Q.value = 0.85;

      const delayNode = ctx.createDelay(4.0);
      delayNode.delayTime.value = 0.375;

      const delayFeedback = ctx.createGain();
      delayFeedback.gain.value = 0; // Capped <= 0.78 during Echo Out

      source.connect(lowEq);
      lowEq.connect(midEq);
      midEq.connect(highEq);
      highEq.connect(sweepFilter);
      sweepFilter.connect(trimGain);
      trimGain.connect(deckGain);
      deckGain.connect(destination);

      // Pre-fader bandpass echo loop keeps dub tails warm without muddying sub-bass
      sweepFilter.connect(delaySend);
      delaySend.connect(delayBandpass);
      delayBandpass.connect(delayNode);
      delayNode.connect(delayFeedback);
      delayFeedback.connect(delayBandpass);
      delayNode.connect(destination);

      deck.sourceNode = source;
      deck.lowEqNode = lowEq;
      deck.midEqNode = midEq;
      deck.highEqNode = highEq;
      deck.sweepFilterNode = sweepFilter;
      deck.trimGainNode = trimGain;
      deck.gainNode = deckGain;
      deck.delaySendNode = delaySend;
      deck.delayBandpassNode = delayBandpass;
      deck.delayNode = delayNode;
      deck.delayFeedbackNode = delayFeedback;
    } catch {
      // Ignore if MediaElementSource cannot attach in synthetic DOM
    }
  }

  private getDeck(id: DeckId): DeckChannelNodes {
    const deck = id === 'A' ? this.deckA : this.deckB;
    if (!deck) {
      throw new DomainError('TRACK_UNPLAYABLE', `Deck ${id} no inicializado`);
    }
    return deck;
  }

  private getInactiveDeckId(): DeckId {
    return this.activeDeck === 'A' ? 'B' : 'A';
  }

  private resetDeckDsp(deck: DeckChannelNodes, gainValue = 1.0): void {
    deck.audio.playbackRate = this.playbackRate;
    try {
      const pitchAudio = deck.audio as HTMLAudioElement & {
        preservesPitch?: boolean;
        webkitPreservesPitch?: boolean;
      };
      pitchAudio.preservesPitch = this.preservesPitch;
      pitchAudio.webkitPreservesPitch = this.preservesPitch;
    } catch {
      // ignore on unsupported engines
    }
    deck.audio.volume =
      this.audioCtx && deck.sourceNode
        ? 1.0
        : volumeToPerceptualGain(this.volume) * gainValue;
    resetAudioParam(deck.lowEqNode?.gain, this.audioCtx, 0);
    resetAudioParam(deck.midEqNode?.gain, this.audioCtx, 0);
    resetAudioParam(deck.highEqNode?.gain, this.audioCtx, 0);
    if (deck.sweepFilterNode) {
      deck.sweepFilterNode.type = 'lowpass';
      resetAudioParam(deck.sweepFilterNode.frequency, this.audioCtx, 20000);
      resetAudioParam(deck.sweepFilterNode.Q, this.audioCtx, 0.707);
    }
    resetAudioParam(deck.trimGainNode?.gain, this.audioCtx, 1.0);
    resetAudioParam(deck.gainNode?.gain, this.audioCtx, gainValue);
    resetAudioParam(deck.delaySendNode?.gain, this.audioCtx, 0);
    resetAudioParam(deck.delayFeedbackNode?.gain, this.audioCtx, 0);
  }

  public async loadAndPlay(track: Track, startSec = 0): Promise<void> {
    await this.init();
    this.cancelActiveTransition();

    const deck = this.getDeck(this.activeDeck);
    const otherDeck = this.getDeck(this.getInactiveDeckId());
    otherDeck.audio.pause();
    this.resetDeckDsp(otherDeck, 0);

    deck.track = track;
    this.resetDeckDsp(deck, 1.0);

    const streamUrl = await this.resolveStreamUrlFn(track);
    deck.audio.crossOrigin = 'anonymous';
    deck.audio.src = streamUrl;
    this.durationSec = track.durationSec > 0 ? track.durationSec : 195;
    this.positionSec = Math.max(0, startSec);

    try {
      deck.audio.currentTime = this.positionSec;
    } catch {
      // Some browsers require loadedmetadata before setting currentTime; handled below
      deck.audio.addEventListener(
        'loadedmetadata',
        () => {
          try {
            deck.audio.currentTime = this.positionSec;
          } catch {
            // ignore
          }
        },
        { once: true }
      );
    }

    await this.play();
  }

  public async preloadNextDeck(track: Track, startSec = 0): Promise<void> {
    await this.init();
    const nextDeck = this.getDeck(this.getInactiveDeckId());
    const safeStart = Math.max(0, startSec);

    if (nextDeck.track?.id === track.id && nextDeck.audio.src) {
      this.resetDeckDsp(nextDeck, 0);
      if (
        safeStart > 0.1 &&
        nextDeck.audio.readyState >= 1 &&
        Math.abs((nextDeck.audio.currentTime || 0) - safeStart) > 0.35
      ) {
        try {
          nextDeck.audio.currentTime = safeStart;
        } catch {
          // ignore
        }
      }
      return;
    }

    nextDeck.track = track;
    this.resetDeckDsp(nextDeck, 0);
    const streamUrl = await this.resolveStreamUrlFn(track);
    nextDeck.audio.crossOrigin = 'anonymous';
    nextDeck.audio.src = streamUrl;
    if (typeof nextDeck.audio.load === 'function') {
      try {
        nextDeck.audio.load();
      } catch {
        // ignore in mock DOM
      }
    }
    if (safeStart > 0.1) {
      try {
        nextDeck.audio.currentTime = safeStart;
      } catch {
        nextDeck.audio.addEventListener?.(
          'loadedmetadata',
          () => {
            try {
              if (Math.abs((nextDeck.audio.currentTime || 0) - safeStart) > 0.35) {
                nextDeck.audio.currentTime = safeStart;
              }
            } catch {
              // ignore
            }
          },
          { once: true }
        );
      }
    }
  }

  public async play(): Promise<void> {
    await this.init();
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      try {
        await this.audioCtx.resume();
      } catch {
        // ignore
      }
    }
    const deck = this.getDeck(this.activeDeck);
    try {
      await deck.audio.play();
    } catch {
      // In headless/synthetic environments without audio device, still update state
    }
    this.isPlaying = true;
    this.emitState();
  }

  public pause(): void {
    if (!this.deckA || !this.deckB) return;
    this.deckA.audio.pause();
    this.deckB.audio.pause();
    this.isPlaying = false;
    this.emitState();
  }

  public seek(positionSec: number): void {
    if (this.isTransitioning) {
      this.cancelActiveTransition();
    }
    const safePos = Math.max(0, Math.min(this.durationSec || 3600, positionSec));
    this.positionSec = safePos;
    if (this.deckA && this.deckB) {
      const deck = this.getDeck(this.activeDeck);
      try {
        const isBrowserAudio = typeof (deck.audio as { readyState?: unknown }).readyState === 'number';
        const realDur =
          Number.isFinite(deck.audio.duration) && deck.audio.duration > 10
            ? deck.audio.duration
            : this.durationSec;
        if (isBrowserAudio && realDur > 10 && safePos >= realDur - 0.8) {
          const clampedEndPos = Math.max(0, realDur - 1.4);
          this.positionSec = clampedEndPos;
          deck.audio.currentTime = clampedEndPos;
        } else {
          deck.audio.currentTime = safePos;
        }
      } catch {
        // ignore
      }
    }
    this.emitState();
  }

  public setVolume(volume01: number): void {
    const clamped = Math.max(0, Math.min(1, Number.isFinite(volume01) ? volume01 : 0.85));
    this.volume = clamped;
    const gain = volumeToPerceptualGain(clamped);
    if (this.masterGainNode) {
      if (this.audioCtx && typeof this.masterGainNode.gain.setTargetAtTime === 'function') {
        this.masterGainNode.gain.setTargetAtTime(gain, this.audioCtx.currentTime, 0.015);
      } else {
        this.masterGainNode.gain.value = gain;
      }
    }
    if (this.deckA && (!this.audioCtx || !this.deckA.sourceNode)) {
      this.deckA.audio.volume = gain;
    }
    if (this.deckB && (!this.audioCtx || !this.deckB.sourceNode)) {
      this.deckB.audio.volume = gain;
    }
    this.emitState();
  }

  public setBalance(pan: number): void {
    const clamped = Math.max(-1, Math.min(1, Number.isFinite(pan) ? pan : 0));
    this.stereoBalance = clamped;
    setAudioParamSmooth(this.stereoPannerNode?.pan, this.audioCtx, clamped, 0.02);
  }

  public setMonoAudio(enabled: boolean): void {
    this.monoAudio = Boolean(enabled);
    if (this.masterGainNode) {
      try {
        if (this.monoAudio) {
          this.masterGainNode.channelCountMode = 'explicit';
          this.masterGainNode.channelCount = 1;
        } else {
          this.masterGainNode.channelCountMode = 'max';
          this.masterGainNode.channelCount = 2;
        }
      } catch {
        // ignore in mock DOM
      }
    }
  }

  public setPlaybackRate(rate: number, preservesPitch = this.preservesPitch): void {
    const clamped = Math.max(0.5, Math.min(2.0, Number.isFinite(rate) ? rate : 1.0));
    this.playbackRate = clamped;
    this.preservesPitch = preservesPitch;
    for (const deck of [this.deckA, this.deckB]) {
      if (!deck) continue;
      deck.audio.playbackRate = clamped;
      try {
        const pitchAudio = deck.audio as HTMLAudioElement & {
          preservesPitch?: boolean;
          webkitPreservesPitch?: boolean;
        };
        pitchAudio.preservesPitch = preservesPitch;
        pitchAudio.webkitPreservesPitch = preservesPitch;
      } catch {
        // ignore
      }
    }
  }

  public setNormalization(enabled: boolean, targetDb = -11, trackLoudnessDb?: number): void {
    this.normalizationEnabled = Boolean(enabled);
    this.normalizationTargetDb = Math.max(-18, Math.min(-6, targetDb));
    if (!this.deckA || !this.deckB) return;
    const active = this.getDeck(this.activeDeck);
    if (!this.normalizationEnabled || typeof trackLoudnessDb !== 'number') {
      setAudioParamSmooth(active.trimGainNode?.gain, this.audioCtx, 1.0, 0.08);
      return;
    }
    const deltaDb = Math.max(-6, Math.min(6, this.normalizationTargetDb - trackLoudnessDb));
    const linear = Math.pow(10, deltaDb / 20);
    setAudioParamSmooth(active.trimGainNode?.gain, this.audioCtx, linear, 0.08);
  }

  public setUserEq(config: UserEqConfig): void {
    this.userEqConfig = {
      enabled: config.enabled,
      preset: config.preset,
      bandsDb: [
        clampEqGainDb(config.bandsDb[0]),
        clampEqGainDb(config.bandsDb[1]),
        clampEqGainDb(config.bandsDb[2]),
        clampEqGainDb(config.bandsDb[3]),
        clampEqGainDb(config.bandsDb[4]),
      ],
    };
    for (let i = 0; i < this.userEqNodes.length; i++) {
      const node = this.userEqNodes[i]!;
      node.gain.value = this.userEqConfig.enabled ? (this.userEqConfig.bandsDb[i] ?? 0) : 0;
    }
  }

  public setSafeCrossfade(config: SafeCrossfadeConfig): void {
    const durationSec = Math.max(0, Math.min(12, Number.isFinite(config.durationSec) ? config.durationSec : 4));
    this.safeCrossfadeConfig = {
      // Mutually exclusive: DJ Mode takes precedence
      enabled: this.djModeConfig.enabled ? false : config.enabled,
      durationSec,
    };
  }

  public setDjMode(config: DjModeConfig): void {
    this.djModeConfig = {
      ...config,
      enabledTransitions: {
        eq_swap: config.enabledTransitions?.eq_swap ?? true,
        filter_sweep: config.enabledTransitions?.filter_sweep ?? true,
        echo_out: config.enabledTransitions?.echo_out ?? true,
      },
    };
    if (config.enabled) {
      this.safeCrossfadeConfig = {
        ...this.safeCrossfadeConfig,
        enabled: false,
      };
    }
  }

  public async executeTransition(plan: DeckTransitionPlan): Promise<void> {
    await this.init();
    this.cancelActiveTransition();

    const outgoingId = this.activeDeck;
    const incomingId = this.getInactiveDeckId();
    const outgoing = this.getDeck(outgoingId);
    const incoming = this.getDeck(incomingId);

    this.isTransitioning = true;
    this.activeTransitionType = plan.transitionType;
    this.transitionProgress01 = 0;

    const startRate = this.djModeConfig.tempoMatching
      ? Math.max(0.96, Math.min(1.04, plan.tempoNudgeRate))
      : 1.0;
    incoming.audio.playbackRate = startRate;

    const ch = plan.choreography;
    const incomingTrimLinear = ch
      ? Math.pow(10, Math.max(-5, Math.min(5, ch.loudnessTrimDb)) / 20)
      : 1.0;

    // Reset incoming DSP cleanly before fading in
    this.resetDeckDsp(incoming, 0);
    incoming.audio.playbackRate = startRate;
    setAudioParamSmooth(incoming.trimGainNode?.gain, this.audioCtx, incomingTrimLinear, 0.01);
    if (ch) {
      setAudioParamSmooth(incoming.lowEqNode?.gain, this.audioCtx, -24, 0.01);
      setAudioParamSmooth(incoming.midEqNode?.gain, this.audioCtx, ch.incomingVocalHoldDb, 0.01);
      if (incoming.sweepFilterNode && ch.inLowPassStartHz < 11000) {
        incoming.sweepFilterNode.type = 'lowpass';
        incoming.sweepFilterNode.Q.value = 1.2;
        setAudioParamSmooth(incoming.sweepFilterNode.frequency, this.audioCtx, ch.inLowPassStartHz, 0.01);
      }
    } else if (plan.transitionType === 'eq_swap') {
      setAudioParamSmooth(incoming.lowEqNode?.gain, this.audioCtx, -24, 0.01);
      setAudioParamSmooth(incoming.midEqNode?.gain, this.audioCtx, -3, 0.01);
    } else if (plan.transitionType === 'filter_sweep' && incoming.sweepFilterNode) {
      incoming.sweepFilterNode.type = 'lowpass';
      incoming.sweepFilterNode.Q.value = 1.25;
      setAudioParamSmooth(incoming.sweepFilterNode.frequency, this.audioCtx, 260, 0.01);
    }

    await waitForAudioReady(incoming.audio, Math.max(0, plan.cueInSec), 4200);

    const ensureIncomingPlaying = () => {
      if (!incoming.audio.paused) return;
      try {
        const p = incoming.audio.play();
        if (p && typeof p.catch === 'function') {
          p.catch(() => {});
        }
      } catch {
        // ignore in headless tests
      }
    };

    try {
      await incoming.audio.play();
    } catch {
      incoming.audio.addEventListener?.('canplay', ensureIncomingPlaying, { once: true });
    }
    if (incoming.audio.paused) {
      incoming.audio.addEventListener?.('canplay', ensureIncomingPlaying, { once: true });
    }

    const outDur =
      Number.isFinite(outgoing.audio.duration) && outgoing.audio.duration > 10
        ? outgoing.audio.duration
        : this.durationSec;
    const outPos =
      Number.isFinite(outgoing.audio.currentTime) && outgoing.audio.currentTime > 0
        ? outgoing.audio.currentTime
        : this.positionSec;
    const outRemainingSec =
      outDur > 10 && outPos > 0
        ? Math.max(1.2, outDur - outPos + 0.6)
        : plan.transitionDurationSec;
    const effectiveTransSec = Math.max(
      1.2,
      Math.min(plan.transitionDurationSec, outRemainingSec)
    );

    const totalMs = Math.max(250, Math.min(14_000, Math.round(effectiveTransSec * 1000)));
    const estFromBpm = Math.max(
      65,
      Math.min(175, (240 * plan.transitionBars) / Math.max(2, plan.transitionDurationSec))
    );
    const beatDelaySec = Math.max(
      0.16,
      Math.min(0.85, (60 / estFromBpm) * (plan.echoSubdivision === 0.75 ? 0.75 : 0.5))
    );

    if (outgoing.delayNode) {
      outgoing.delayNode.delayTime.value = beatDelaySec;
    }

    const applyCurve = (pRaw: number) => {
      const p = Math.max(0, Math.min(1, pRaw));
      this.transitionProgress01 = Number(p.toFixed(2));

      let outGain = Math.cos(p * 0.5 * Math.PI);
      let inGain = Math.sin(p * 0.5 * Math.PI);

      if (ch) {
        // Continuous adaptive 3-stem DJ sculpting tailored specifically for this song pair
        const swapStart = Math.max(0.15, ch.bassSwapPoint01 - ch.bassSwapWidth01 * 0.5);
        const swapEnd = Math.min(0.88, ch.bassSwapPoint01 + ch.bassSwapWidth01 * 0.5);
        const swapU =
          p <= swapStart
            ? 0
            : p >= swapEnd
              ? 1
              : (p - swapStart) / Math.max(0.05, swapEnd - swapStart);

        // Low-stem swap (sub-bass / kick clean handover with zero phase mud)
        setAudioParamSmooth(outgoing.lowEqNode?.gain, this.audioCtx, -24 * swapU);
        setAudioParamSmooth(incoming.lowEqNode?.gain, this.audioCtx, -24 * (1 - swapU));

        // High-stem percussion / hi-hat entry
        const hiLeadU = Math.min(1, p / Math.max(0.2, 0.65 - ch.highStemLead01 * 0.5));
        setAudioParamSmooth(incoming.highEqNode?.gain, this.audioCtx, -6 * (1 - hiLeadU));
        setAudioParamSmooth(outgoing.highEqNode?.gain, this.audioCtx, -8 * Math.pow(p, 1.4));

        // Mid vocal-pocket sculpting (carves outgoing vocal presence while lifting incoming lead after bass swap)
        const midCarveFactor = Math.sin(Math.min(1, p / 0.85) * Math.PI * 0.7);
        setAudioParamSmooth(
          outgoing.midEqNode?.gain,
          this.audioCtx,
          ch.vocalCarveDb * midCarveFactor
        );
        const inVocalOpen = p < swapStart ? 0 : Math.min(1, (p - swapStart) / (1 - swapStart));
        setAudioParamSmooth(
          incoming.midEqNode?.gain,
          this.audioCtx,
          ch.incomingVocalHoldDb * (1 - inVocalOpen)
        );

        // Filter choreography
        if (outgoing.sweepFilterNode && ch.outHighPassPeakHz > 80) {
          outgoing.sweepFilterNode.type = 'highpass';
          outgoing.sweepFilterNode.Q.value = plan.transitionType === 'filter_sweep' ? 1.45 : 0.9;
          const hpFreq = 32 * Math.pow(ch.outHighPassPeakHz / 32, Math.pow(p, 1.25));
          setAudioParamSmooth(outgoing.sweepFilterNode.frequency, this.audioCtx, hpFreq);
        }
        if (incoming.sweepFilterNode && ch.inLowPassStartHz < 11000) {
          incoming.sweepFilterNode.type = 'lowpass';
          incoming.sweepFilterNode.Q.value = 1.2;
          const lpRatio = Math.min(1, p / 0.78);
          const lpFreq =
            ch.inLowPassStartHz * Math.pow(20000 / Math.max(120, ch.inLowPassStartHz), lpRatio);
          setAudioParamSmooth(incoming.sweepFilterNode.frequency, this.audioCtx, lpFreq);
        }

        // Bandpassed BPM dub echo send (strictly <= 0.78 feedback)
        if (plan.transitionType === 'echo_out' || ch.vocalClashAvoided) {
          const sendCurve = p < 0.45 ? (p / 0.45) * ch.echoSendPeak : Math.max(0, ch.echoSendPeak * (1 - (p - 0.45) / 0.35));
          const fbCurve = Math.min(0.75, ch.echoFeedbackPeak * (1 - Math.max(0, p - 0.5) / 0.5));
          setAudioParamSmooth(outgoing.delaySendNode?.gain, this.audioCtx, sendCurve, 0.025);
          setAudioParamSmooth(outgoing.delayFeedbackNode?.gain, this.audioCtx, fbCurve, 0.025);
        }

        // Gain curve adapts smoothly between harmonic club blend vs crisp echo-out cut
        if (plan.transitionType === 'echo_out') {
          outGain = p < 0.62 ? Math.cos((p / 0.62) * 0.5 * Math.PI) : 0;
          inGain = p < 0.2 ? 0 : Math.min(1, Math.sin(Math.min(1, (p - 0.2) / 0.52) * 0.5 * Math.PI));
        } else {
          outGain = p < 0.55 ? 1 - 0.18 * (p / 0.55) : 0.82 * Math.cos(((p - 0.55) / 0.45) * 0.5 * Math.PI);
          inGain = p < 0.55 ? Math.sin((p / 0.55) * 0.5 * Math.PI) * 0.92 : 0.92 + 0.08 * ((p - 0.55) / 0.45);
        }
      } else if (plan.transitionType === 'eq_swap') {
        // Phase-locked club blend: gradual bring-in -> punchy midpoint bass swap -> clean exit
        if (p < 0.44) {
          const u = p / 0.44;
          outGain = 1 - u * 0.1;
          inGain = Math.sin(u * 0.5 * Math.PI) * 0.88;
          setAudioParamSmooth(outgoing.lowEqNode?.gain, this.audioCtx, -2 * u);
          setAudioParamSmooth(incoming.lowEqNode?.gain, this.audioCtx, -24);
          setAudioParamSmooth(incoming.midEqNode?.gain, this.audioCtx, -3 * (1 - u * 0.4));
        } else if (p < 0.62) {
          const u = (p - 0.44) / 0.18;
          outGain = 0.9 - u * 0.12;
          inGain = 0.88 + u * 0.12;
          setAudioParamSmooth(outgoing.lowEqNode?.gain, this.audioCtx, -2 - u * 22);
          setAudioParamSmooth(incoming.lowEqNode?.gain, this.audioCtx, -24 + u * 24);
          setAudioParamSmooth(incoming.midEqNode?.gain, this.audioCtx, -1.8 * (1 - u));
        } else {
          const u = (p - 0.62) / 0.38;
          outGain = 0.78 * Math.cos(u * 0.5 * Math.PI);
          inGain = 1.0;
          setAudioParamSmooth(outgoing.lowEqNode?.gain, this.audioCtx, -24);
          setAudioParamSmooth(incoming.lowEqNode?.gain, this.audioCtx, 0);
          setAudioParamSmooth(incoming.midEqNode?.gain, this.audioCtx, 0);
          if (outgoing.sweepFilterNode) {
            outgoing.sweepFilterNode.type = 'highpass';
            outgoing.sweepFilterNode.Q.value = 0.9;
            setAudioParamSmooth(
              outgoing.sweepFilterNode.frequency,
              this.audioCtx,
              35 + u * 340
            );
          }
        }
      } else if (plan.transitionType === 'filter_sweep') {
        // Smooth exponential high-pass exit & low-pass warm reveal
        if (outgoing.sweepFilterNode) {
          outgoing.sweepFilterNode.type = 'highpass';
          outgoing.sweepFilterNode.Q.value = 1.5;
          const outFreq = 35 * Math.pow(2400 / 35, Math.pow(p, 1.35));
          setAudioParamSmooth(outgoing.sweepFilterNode.frequency, this.audioCtx, outFreq);
        }
        setAudioParamSmooth(outgoing.lowEqNode?.gain, this.audioCtx, -12 * p);
        if (incoming.sweepFilterNode) {
          incoming.sweepFilterNode.type = 'lowpass';
          incoming.sweepFilterNode.Q.value = 1.25;
          const openRatio = Math.min(1, p / 0.78);
          const inFreq = 260 * Math.pow(20000 / 260, openRatio);
          setAudioParamSmooth(incoming.sweepFilterNode.frequency, this.audioCtx, inFreq);
        }
      } else if (plan.transitionType === 'echo_out') {
        // BPM-synced dub echo wash on outgoing phrase while incoming track drops cleanly
        outGain = p < 0.6 ? Math.cos((p / 0.6) * 0.5 * Math.PI) : 0;
        inGain = p < 0.25 ? 0 : Math.min(1, Math.sin(Math.min(1, (p - 0.25) / 0.5) * 0.5 * Math.PI));

        const sendVal =
          p < 0.42 ? (p / 0.42) * 0.58 : Math.max(0, 0.58 * (1 - (p - 0.42) / 0.2));
        // Feedback strictly capped <= 0.78 invariant
        const fbVal =
          p < 0.48
            ? 0.28 + (p / 0.48) * 0.34
            : Math.max(0, 0.62 * (1 - (p - 0.48) / 0.52));

        setAudioParamSmooth(outgoing.delaySendNode?.gain, this.audioCtx, sendVal, 0.025);
        setAudioParamSmooth(outgoing.delayFeedbackNode?.gain, this.audioCtx, Math.min(0.75, fbVal), 0.025);
      }

      setAudioParamSmooth(outgoing.gainNode?.gain, this.audioCtx, outGain);
      setAudioParamSmooth(incoming.gainNode?.gain, this.audioCtx, inGain);
      if (!this.audioCtx) {
        const masterGain = volumeToPerceptualGain(this.volume);
        outgoing.audio.volume = masterGain * outGain;
        incoming.audio.volume = masterGain * inGain;
      }

      if (this.djModeConfig.tempoMatching && Math.abs(startRate - 1.0) > 0.001) {
        const glide = p <= 0.5 ? 0 : (p - 0.5) * 2;
        incoming.audio.playbackRate = Number((startRate + (1.0 - startRate) * glide).toFixed(3));
      }

      this.emitState();
    };

    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        if (this.transitionTimer) {
          clearInterval(this.transitionTimer);
          this.transitionTimer = null;
        }
        if (this.transitionRafId !== null && typeof cancelAnimationFrame === 'function') {
          cancelAnimationFrame(this.transitionRafId);
          this.transitionRafId = null;
        }
        this.transitionResolve = null;

        outgoing.audio.pause();
        this.resetDeckDsp(outgoing, 0);
        this.resetDeckDsp(incoming, 1.0);
        this.activeDeck = incomingId;
        this.isTransitioning = false;
        this.activeTransitionType = undefined;
        this.transitionProgress01 = 1;
        this.isPlaying = true;
        if (incoming.audio.paused && typeof incoming.audio.play === 'function') {
          try {
            void incoming.audio.play().catch(() => {});
          } catch {
            // ignore
          }
        }
        if (incoming.track) {
          this.durationSec =
            Number.isFinite(incoming.audio.duration) && incoming.audio.duration > 10
              ? incoming.audio.duration
              : incoming.track.durationSec;
        }
        const livePos =
          Number.isFinite(incoming.audio.currentTime) && incoming.audio.currentTime > 0
            ? incoming.audio.currentTime
            : plan.cueInSec + plan.transitionDurationSec;
        this.positionSec = livePos;
        this.emitState();
        resolve();
      };

      this.transitionResolve = () => {
        if (settled) return;
        settled = true;
        this.transitionResolve = null;
        resolve();
      };

      const startedAt = Date.now();
      const stepMs = Math.max(15, Math.min(25, Math.floor(totalMs / 16)));
      this.transitionTimer = setInterval(() => {
        if (settled) return;
        const p = Math.min(1, (Date.now() - startedAt) / totalMs);
        applyCurve(p);
        if (p >= 1) {
          if (this.transitionTimer) {
            clearInterval(this.transitionTimer);
            this.transitionTimer = null;
          }
          finish();
        }
      }, stepMs);
    });
  }

  public cancelActiveTransition(): void {
    if (this.transitionTimer) {
      clearInterval(this.transitionTimer);
      this.transitionTimer = null;
    }
    if (this.transitionRafId !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(this.transitionRafId);
      this.transitionRafId = null;
    }
    if (this.isTransitioning) {
      this.isTransitioning = false;
      this.activeTransitionType = undefined;
      this.transitionProgress01 = 0;
      if (this.deckA && this.deckB) {
        const active = this.getDeck(this.activeDeck);
        const inactive = this.getDeck(this.getInactiveDeckId());
        inactive.audio.pause();
        this.resetDeckDsp(inactive, 0);
        this.resetDeckDsp(active, 1.0);
      }
      this.emitState();
    }
    if (this.transitionResolve) {
      const resFn = this.transitionResolve;
      this.transitionResolve = null;
      resFn();
    }
  }

  public getAnalyserData(): AudioAnalyserData {
    const bins = new Uint8Array(64);
    if (this.analyserNode) {
      this.analyserNode.getByteFrequencyData(bins);
      let sum = 0;
      for (let i = 0; i < bins.length; i++) {
        const v = (bins[i] ?? 0) / 255;
        sum += v * v;
      }
      const rmsLevel = Number(Math.sqrt(sum / bins.length).toFixed(3));
      return { frequencyBins: bins, rmsLevel };
    }
    if (this.isPlaying) {
      for (let i = 0; i < bins.length; i++) {
        bins[i] = Math.round(90 + 60 * Math.sin(i * 0.4 + this.positionSec));
      }
      return { frequencyBins: bins, rmsLevel: 0.48 };
    }
    return { frequencyBins: bins, rmsLevel: 0 };
  }

  public getLivePositionSec(): number {
    if (this.deckA && this.deckB) {
      const deck = this.getDeck(this.activeDeck);
      const t = deck.audio.currentTime;
      if (Number.isFinite(t) && t >= 0) {
        return t;
      }
    }
    return this.positionSec;
  }

  public getState(): AudioEngineState {
    return {
      activeDeck: this.activeDeck,
      isPlaying: this.isPlaying,
      positionSec: this.positionSec,
      durationSec: this.durationSec,
      volume: this.volume,
      isTransitioning: this.isTransitioning,
      activeTransitionType: this.activeTransitionType,
      transitionProgress01: this.transitionProgress01,
    };
  }

  public onStateChange(cb: (state: AudioEngineState) => void): Unsubscribe {
    this.stateListeners.add(cb);
    return () => {
      this.stateListeners.delete(cb);
    };
  }

  public onTrackEnded(cb: (deck: DeckId) => void): Unsubscribe {
    this.endedListeners.add(cb);
    return () => {
      this.endedListeners.delete(cb);
    };
  }

  public onError(cb: (error: DomainError) => void): Unsubscribe {
    this.errorListeners.add(cb);
    return () => {
      this.errorListeners.delete(cb);
    };
  }

  private emitState(): void {
    const snapshot = this.getState();
    for (const listener of this.stateListeners) {
      listener(snapshot);
    }
  }

  public async dispose(): Promise<void> {
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
    this.cancelActiveTransition();
    this.pause();
    this.deckA?.audio.remove?.();
    this.deckB?.audio.remove?.();
    this.deckA = null;
    this.deckB = null;
    if (this.audioCtx) {
      try {
        await this.audioCtx.close();
      } catch {
        // ignore
      }
      this.audioCtx = null;
    }
    this.stateListeners.clear();
    this.endedListeners.clear();
    this.errorListeners.clear();
  }
}
