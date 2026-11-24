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

async function playAudioWithTimeout(audio: HTMLAudioElement, timeoutMs = 3500): Promise<void> {
  let p: unknown;
  try {
    p = audio.play();
  } catch {
    return;
  }
  if (!p || typeof (p as Promise<unknown>).then !== 'function') {
    return;
  }
  const playPromise = p as Promise<unknown>;
  playPromise.catch(() => {});
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    await Promise.race([
      playPromise.then(
        () => undefined,
        () => undefined
      ),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
        (timer as { unref?: () => void }).unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export interface LivePlaybackSnapshot {
  positionSec: number;
  durationSec: number;
  isPlaying: boolean;
  isBuffering: boolean;
  isPaused: boolean;
  isEnded: boolean;
  isSeeking: boolean;
  isTransitioning: boolean;
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
  private isBuffering = false;
  private bufferedPct = 0;
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
  private transitionSafetyTimer: ReturnType<typeof setTimeout> | null = null;
  private transitionRafId: number | null = null;
  private transitionResolve: (() => void) | null = null;
  private watchdogTimer: ReturnType<typeof setInterval> | null = null;
  private loadGeneration = 0;
  private eofFiredKey = '';
  private lastObservedSrc = '';
  private lastObservedTime = -1;
  private lastProgressWallMs = 0;
  private lastRecoveryNudgeWallMs = 0;

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

        if (Number.isFinite(audio.duration) && audio.duration > 1) {
          this.durationSec = audio.duration;
        }
        const realDur =
          Number.isFinite(audio.duration) && audio.duration > 1
            ? audio.duration
            : this.durationSec;

        const rawTime =
          !audio.seeking && Number.isFinite(audio.currentTime) && audio.currentTime >= 0
            ? audio.currentTime
            : this.positionSec;
        const curTime = realDur > 0 ? Math.min(rawTime, realDur) : rawTime;
        this.positionSec = curTime;

        const curSrc = audio.src || deck.track?.id || '';
        const nowMs = Date.now();
        if (curSrc !== this.lastObservedSrc || Math.abs(curTime - this.lastObservedTime) >= 0.04) {
          this.lastObservedSrc = curSrc;
          this.lastObservedTime = curTime;
          this.lastProgressWallMs = nowMs;
          if (audio.readyState >= 3 && this.isBuffering) {
            this.isBuffering = false;
          }
        }
        const stalledMs = this.lastProgressWallMs > 0 ? nowMs - this.lastProgressWallMs : 0;

        if (
          audio.ended === true ||
          (realDur > 4 && curTime >= realDur - 0.35) ||
          (realDur > 8 &&
            !audio.seeking &&
            curTime >= realDur - 3.5 &&
            (stalledMs >= 1600 || (audio.paused && stalledMs >= 650)))
        ) {
          this.triggerTrackEnded(this.activeDeck);
          return;
        }
        if (
          !audio.ended &&
          !audio.seeking &&
          realDur > 12 &&
          curTime > 1 &&
          curTime < realDur - 4.5 &&
          (audio.readyState < 3 || audio.paused) &&
          stalledMs >= 2800
        ) {
          if (!this.isBuffering) {
            this.isBuffering = true;
            this.emitState();
          }
        }
        if (
          !audio.ended &&
          !audio.seeking &&
          realDur > 12 &&
          curTime > 1 &&
          curTime < realDur - 4.5 &&
          ((audio.paused && stalledMs >= 1200) || stalledMs >= 3200) &&
          nowMs - this.lastRecoveryNudgeWallMs >= 4500
        ) {
          this.lastRecoveryNudgeWallMs = nowMs;
          if (stalledMs >= 4500 && !audio.paused && audio.readyState < 2) {
            try {
              audio.currentTime = curTime;
            } catch {
              // ignore
            }
          }
          void audio.play().catch(() => {});
        }
        this.emitState();
      }, 250);
      (this.watchdogTimer as { unref?: () => void }).unref?.();
    }
  }

  private resetEofTracking(posSec = 0): void {
    this.eofFiredKey = '';
    this.lastObservedSrc = '';
    this.lastObservedTime = posSec;
    this.lastProgressWallMs = Date.now();
    this.lastRecoveryNudgeWallMs = 0;
  }

  private triggerTrackEnded(deckId: DeckId): void {
    if (
      this.activeDeck !== deckId ||
      this.isTransitioning ||
      !this.deckA ||
      !this.deckB
    ) {
      return;
    }
    const deck = this.getDeck(deckId);
    const key = `${deckId}::${deck.audio.src || deck.track?.id || ''}`;
    if (this.eofFiredKey === key) {
      return;
    }
    this.eofFiredKey = key;
    this.isPlaying = false;
    this.isBuffering = false;
    if (this.durationSec > 0 && this.positionSec > this.durationSec) {
      this.positionSec = this.durationSec;
    }
    this.emitState();
    for (const listener of this.endedListeners) {
      listener(deckId);
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

    const isPlausibleDuration = (rawDur: number): boolean => {
      if (!Number.isFinite(rawDur) || rawDur <= 1) return false;
      const metaDur = this.getDeck(id).track?.durationSec ?? 0;
      if (metaDur < 45) return true;
      const ratio = rawDur / metaDur;
      return (
        (ratio >= 0.3 && ratio <= 1.45) ||
        (Number.isFinite(audio.currentTime) && audio.currentTime > metaDur * 1.15)
      );
    };

    const syncDuration = () => {
      if (this.activeDeck !== id) return;
      if (isPlausibleDuration(audio.duration)) {
        this.durationSec = audio.duration;
        if (this.positionSec > this.durationSec) {
          this.positionSec = this.durationSec;
        }
        this.emitState();
      }
    };

    const markBufferingOn = () => {
      if (this.activeDeck !== id || !this.isPlaying) return;
      if (!this.isBuffering) {
        this.isBuffering = true;
        this.emitState();
      }
    };

    const markBufferingOff = () => {
      if (this.activeDeck !== id) return;
      if (this.isBuffering) {
        this.isBuffering = false;
        this.emitState();
      }
    };

    const updateBufferedProgress = () => {
      if (this.activeDeck !== id) return;
      try {
        const realDur =
          Number.isFinite(audio.duration) && audio.duration > 1 ? audio.duration : this.durationSec;
        if (realDur > 0 && audio.buffered && audio.buffered.length > 0) {
          const end = audio.buffered.end(audio.buffered.length - 1);
          this.bufferedPct = Math.max(0, Math.min(1, end / realDur));
          this.emitState();
        }
      } catch {
        // ignore invalid TimeRanges
      }
    };

    audio.addEventListener('loadedmetadata', syncDuration);
    audio.addEventListener('durationchange', syncDuration);
    audio.addEventListener('canplay', () => {
      syncDuration();
      markBufferingOff();
    });
    audio.addEventListener('loadstart', markBufferingOn);
    audio.addEventListener('waiting', markBufferingOn);
    audio.addEventListener('stalled', markBufferingOn);
    audio.addEventListener('playing', markBufferingOff);
    audio.addEventListener('canplaythrough', markBufferingOff);
    audio.addEventListener('progress', updateBufferedProgress);

    audio.addEventListener('timeupdate', () => {
      if (this.activeDeck === id) {
        if (isPlausibleDuration(audio.duration)) {
          this.durationSec = audio.duration;
        }
        const realDur = isPlausibleDuration(audio.duration)
          ? audio.duration
          : this.durationSec;
        if (!audio.seeking && Number.isFinite(audio.currentTime) && audio.currentTime >= 0) {
          this.positionSec = realDur > 0 ? Math.min(audio.currentTime, realDur) : audio.currentTime;
        }
        if (this.isBuffering && !audio.paused && audio.currentTime > 0) {
          this.isBuffering = false;
        }
        this.emitState();

        if (
          !this.isTransitioning &&
          this.isPlaying &&
          (audio.ended || (realDur > 4 && this.positionSec >= realDur - 0.25))
        ) {
          this.triggerTrackEnded(id);
        }
      }
    });

    audio.addEventListener('ended', () => {
      this.triggerTrackEnded(id);
    });

    audio.addEventListener('error', () => {
      if (this.activeDeck === id) {
        const mediaErrCode = audio.error?.code;
        if (!audio.src || mediaErrCode === 1) {
          this.isBuffering = false;
          this.emitState();
          return;
        }
        this.isBuffering = false;
        const realDur =
          Number.isFinite(audio.duration) && audio.duration > 1
            ? audio.duration
            : this.durationSec;
        const curPos = Number.isFinite(audio.currentTime) ? audio.currentTime : this.positionSec;
        if (this.isPlaying && !this.isTransitioning && realDur > 4 && curPos >= realDur - 5) {
          this.triggerTrackEnded(id);
          return;
        }
        this.isPlaying = false;
        this.emitState();
        const err = new DomainError('TRACK_UNPLAYABLE', 'No se pudo cargar el audio completo de esta pista');
        for (const listener of this.errorListeners) {
          listener(err);
        }
      }
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
    deck.audio.loop = false;
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
    resetAudioParam(deck.midEqNode?.frequency, this.audioCtx, 1000);
    resetAudioParam(deck.midEqNode?.Q, this.audioCtx, 0.8);
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
    const loadGen = ++this.loadGeneration;

    const deck = this.getDeck(this.activeDeck);
    const otherDeck = this.getDeck(this.getInactiveDeckId());
    otherDeck.audio.pause();
    this.resetDeckDsp(otherDeck, 0);

    deck.track = track;
    this.playbackRate = 1.0;
    this.resetDeckDsp(deck, 1.0);
    this.isBuffering = true;
    this.bufferedPct = 0;
    this.emitState();

    const streamUrl = await this.resolveStreamUrlFn(track);
    if (loadGen !== this.loadGeneration || !this.deckA || !this.deckB) return;

    deck.audio.crossOrigin = 'anonymous';
    deck.audio.src = streamUrl;
    this.durationSec = track.durationSec > 0 ? track.durationSec : 195;
    this.positionSec = Math.max(0, startSec);
    this.resetEofTracking(this.positionSec);

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
    await playAudioWithTimeout(deck.audio, 3500);
    this.resetEofTracking(this.positionSec);
    this.isPlaying = true;
    const isBrowserAudio = typeof (deck.audio as { readyState?: unknown }).readyState === 'number';
    if (!isBrowserAudio || deck.audio.readyState >= 3 || deck.audio.src.startsWith('blob:')) {
      this.isBuffering = false;
    }
    this.emitState();
  }

  public pause(): void {
    if (!this.deckA || !this.deckB) return;
    this.positionSec = this.getLivePositionSec();
    this.deckA.audio.pause();
    this.deckB.audio.pause();
    this.isPlaying = false;
    this.isBuffering = false;
    this.emitState();
  }

  public seek(positionSec: number): void {
    if (this.isTransitioning) {
      this.cancelActiveTransition();
    }
    const safePos = Math.max(0, Math.min(this.durationSec || 3600, positionSec));
    this.positionSec = safePos;
    this.resetEofTracking(safePos);
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
          this.resetEofTracking(clampedEndPos);
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
    // Cap upward boost at +3.5 dB so normalized tracks never clip or swell during crossfade overlap
    const deltaDb = Math.max(-6, Math.min(3.5, this.normalizationTargetDb - trackLoudnessDb));
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
        vocal_over_beat: config.enabledTransitions?.vocal_over_beat ?? true,
        instrumental_bed: config.enabledTransitions?.instrumental_bed ?? true,
        loop_build: config.enabledTransitions?.loop_build ?? true,
      },
    };
    if (config.enabled) {
      this.safeCrossfadeConfig = {
        ...this.safeCrossfadeConfig,
        enabled: false,
      };
    } else {
      this.playbackRate = 1.0;
      if (this.isTransitioning) {
        this.cancelActiveTransition();
      } else if (this.deckA && this.deckB) {
        const active = this.getDeck(this.activeDeck);
        const inactive = this.getDeck(this.getInactiveDeckId());
        inactive.audio.pause();
        this.resetDeckDsp(inactive, 0);
        this.resetDeckDsp(active, 1.0);
        this.emitState();
      }
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

    try {
      const startRate = this.djModeConfig.tempoMatching
        ? Math.max(0.94, Math.min(1.06, plan.choreography?.inTempoStartRate ?? plan.tempoNudgeRate))
        : 1.0;
      const outTargetRate = this.djModeConfig.tempoMatching
        ? Math.max(0.94, Math.min(1.06, plan.choreography?.outTempoTargetRate ?? 1.0))
        : 1.0;
      incoming.audio.playbackRate = startRate;
      try {
        const outPitch = outgoing.audio as HTMLAudioElement & {
          preservesPitch?: boolean;
          webkitPreservesPitch?: boolean;
        };
        const inPitch = incoming.audio as HTMLAudioElement & {
          preservesPitch?: boolean;
          webkitPreservesPitch?: boolean;
        };
        outPitch.preservesPitch = true;
        outPitch.webkitPreservesPitch = true;
        inPitch.preservesPitch = true;
        inPitch.webkitPreservesPitch = true;
      } catch {
        // ignore in mock DOM
      }

      const ch = plan.choreography;
      const incomingTrimLinear = ch
        ? Math.pow(10, Math.max(-5, Math.min(5, ch.loudnessTrimDb)) / 20)
        : 1.0;

      // Reset incoming DSP cleanly before fading in
      this.resetDeckDsp(incoming, 0);
      incoming.audio.playbackRate = startRate;
      setAudioParamSmooth(incoming.trimGainNode?.gain, this.audioCtx, incomingTrimLinear, 0.01);
      if (ch?.stemAutomation) {
        setAudioParamSmooth(incoming.lowEqNode?.gain, this.audioCtx, ch.stemAutomation.outLowCutDb, 0.01);
        setAudioParamSmooth(incoming.midEqNode?.gain, this.audioCtx, ch.stemAutomation.inMidHoldDb, 0.01);
        if (incoming.sweepFilterNode && ch.inFilterLayer?.enabled && ch.inFilterLayer.startHz < 11000) {
          incoming.sweepFilterNode.type = ch.inFilterLayer.type;
          incoming.sweepFilterNode.Q.value = ch.inFilterLayer.q;
          setAudioParamSmooth(incoming.sweepFilterNode.frequency, this.audioCtx, ch.inFilterLayer.startHz, 0.01);
        }
      } else if (ch) {
        setAudioParamSmooth(incoming.lowEqNode?.gain, this.audioCtx, -24, 0.01);
        setAudioParamSmooth(incoming.midEqNode?.gain, this.audioCtx, ch.incomingVocalHoldDb, 0.01);
        if (incoming.sweepFilterNode && ch.inLowPassStartHz < 11000) {
          incoming.sweepFilterNode.type = 'lowpass';
          incoming.sweepFilterNode.Q.value = 1.2;
          setAudioParamSmooth(incoming.sweepFilterNode.frequency, this.audioCtx, ch.inLowPassStartHz, 0.01);
        }
      } else if (plan.transitionType === 'eq_swap') {
        // Vocal-Stem Isolation setup on incoming deck so its voice floats cleanly over the outgoing beat
        setAudioParamSmooth(incoming.lowEqNode?.gain, this.audioCtx, -32, 0.01);
        setAudioParamSmooth(incoming.midEqNode?.frequency, this.audioCtx, 1250, 0.01);
        setAudioParamSmooth(incoming.midEqNode?.Q, this.audioCtx, 0.72, 0.01);
        setAudioParamSmooth(incoming.midEqNode?.gain, this.audioCtx, 3.5, 0.01);
        setAudioParamSmooth(incoming.highEqNode?.gain, this.audioCtx, -4.5, 0.01);
        if (incoming.sweepFilterNode) {
          incoming.sweepFilterNode.type = 'highpass';
          incoming.sweepFilterNode.Q.value = 0.75;
          setAudioParamSmooth(incoming.sweepFilterNode.frequency, this.audioCtx, 320, 0.01);
        }
        setAudioParamSmooth(outgoing.midEqNode?.frequency, this.audioCtx, 1250, 0.01);
        setAudioParamSmooth(outgoing.midEqNode?.Q, this.audioCtx, 0.72, 0.01);
      } else if (plan.transitionType === 'filter_sweep' && incoming.sweepFilterNode) {
        incoming.sweepFilterNode.type = 'lowpass';
        incoming.sweepFilterNode.Q.value = 1.25;
        setAudioParamSmooth(incoming.sweepFilterNode.frequency, this.audioCtx, 260, 0.01);
      }

      await waitForAudioReady(incoming.audio, Math.max(0, plan.cueInSec), 4200);
      if (!this.isTransitioning) return;

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

      await playAudioWithTimeout(incoming.audio, 3500);
      if (!this.isTransitioning) return;
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
      const beatSub =
        ch?.loopLayer?.enabled
          ? ch.loopLayer.subdivision
          : plan.transitionType === 'loop_build'
            ? (ch?.loopSubdivision ?? 0.25)
            : plan.echoSubdivision === 0.75
              ? 0.75
              : 0.5;
      const beatDelaySec = Math.max(
        0.10,
        Math.min(0.85, (60 / estFromBpm) * beatSub)
      );

      if (outgoing.delayNode) {
        outgoing.delayNode.delayTime.value = beatDelaySec;
      }
      if (outgoing.delayBandpassNode && ch?.echoLayer?.bandpassHz) {
        outgoing.delayBandpassNode.frequency.value = ch.echoLayer.bandpassHz;
      }

      const applyCurve = (pRaw: number) => {
        const p = Math.max(0, Math.min(1, pRaw));
        this.transitionProgress01 = Number(p.toFixed(2));

        let outGain = Math.cos(p * 0.5 * Math.PI);
        let inGain = Math.sin(p * 0.5 * Math.PI);

        if (ch?.stemAutomation) {
          const sa = ch.stemAutomation;
          const swapStart = Math.max(0.14, sa.bassSwapPoint01 - sa.bassSwapWidth01 * 0.5);
          const swapEnd = Math.min(0.88, sa.bassSwapPoint01 + sa.bassSwapWidth01 * 0.5);
          const swapU =
            p <= swapStart
              ? 0
              : p >= swapEnd
                ? 1
                : (p - swapStart) / Math.max(0.05, swapEnd - swapStart);

          // 1. Independent Bass / Vocal / High Stem Curves
          setAudioParamSmooth(outgoing.lowEqNode?.gain, this.audioCtx, sa.outLowCutDb * swapU);
          setAudioParamSmooth(incoming.lowEqNode?.gain, this.audioCtx, sa.outLowCutDb * (1 - swapU));

          const hiLeadEnd = Math.max(0.2, 0.66 - sa.inHighLead01 * 0.5);
          const hiInU = Math.min(1, p / hiLeadEnd);
          const hiOutU = p < sa.outHighFade01 ? 0 : Math.min(1, (p - sa.outHighFade01) / (1 - sa.outHighFade01));
          setAudioParamSmooth(incoming.highEqNode?.gain, this.audioCtx, -5.5 * (1 - hiInU));
          setAudioParamSmooth(outgoing.highEqNode?.gain, this.audioCtx, -8 * Math.pow(hiOutU, 1.35));

          const midCarveFactor =
            ch.techniqueMode === 'vocal_over_beat'
              ? (p < 0.52 ? 0 : Math.min(1, (p - 0.52) / 0.42))
              : Math.sin(Math.min(1, p / 0.85) * Math.PI * 0.72);
          setAudioParamSmooth(outgoing.midEqNode?.gain, this.audioCtx, sa.outMidCarveDb * midCarveFactor);

          const inMidOpenU =
            ch.techniqueMode === 'vocal_over_beat'
              ? Math.max(0, (p - 0.48) / 0.42)
              : Math.max(0, (p - swapStart) / Math.max(0.15, 1 - swapStart));
          setAudioParamSmooth(
            incoming.midEqNode?.gain,
            this.audioCtx,
            sa.inMidHoldDb * (1 - Math.min(1, inMidOpenU))
          );

          // 2. Simultaneous Sweeping Resonant Filters (HPF outgoing + LPF incoming)
          if (outgoing.sweepFilterNode && ch.outFilterLayer?.enabled) {
            const fl = ch.outFilterLayer;
            const fu = p <= fl.start01 ? 0 : p >= fl.end01 ? 1 : (p - fl.start01) / Math.max(0.05, fl.end01 - fl.start01);
            outgoing.sweepFilterNode.type = fl.type;
            outgoing.sweepFilterNode.Q.value = fl.q;
            const freq = Math.max(25, fl.startHz) * Math.pow(Math.max(40, fl.endHz) / Math.max(25, fl.startHz), Math.pow(fu, 1.2));
            setAudioParamSmooth(outgoing.sweepFilterNode.frequency, this.audioCtx, freq);
          }
          if (incoming.sweepFilterNode && ch.inFilterLayer?.enabled) {
            const fl = ch.inFilterLayer;
            const fu = p <= fl.start01 ? 0 : p >= fl.end01 ? 1 : (p - fl.start01) / Math.max(0.05, fl.end01 - fl.start01);
            incoming.sweepFilterNode.type = fl.type;
            incoming.sweepFilterNode.Q.value = fl.q;
            const freq = Math.max(120, fl.startHz) * Math.pow(Math.max(200, fl.endHz) / Math.max(120, fl.startHz), fu);
            setAudioParamSmooth(incoming.sweepFilterNode.frequency, this.audioCtx, freq);
          }

          // 3. Simultaneous Beat-Locked Phrase Loop + Dub Echo Tail (feedback strictly <= 0.78)
          let combinedSend = 0;
          let combinedFb = 0;
          if (ch.loopLayer?.enabled) {
            const ll = ch.loopLayer;
            if (p >= ll.start01 && p <= ll.end01) {
              const lu = (p - ll.start01) / Math.max(0.05, ll.end01 - ll.start01);
              combinedSend = Math.max(combinedSend, 0.22 + lu * 0.42);
              combinedFb = Math.max(combinedFb, 0.44 + lu * 0.28);
              if (outgoing.delayNode && ll.tightenToHalf) {
                const subNow = lu > 0.6 ? ll.subdivision * 0.5 : ll.subdivision;
                const dSec = Math.max(0.08, Math.min(0.85, (60 / estFromBpm) * subNow));
                setAudioParamSmooth(outgoing.delayNode.delayTime, this.audioCtx, dSec, 0.02);
              }
            } else if (p > ll.end01) {
              const tailU = Math.min(1, (p - ll.end01) / 0.25);
              combinedSend = Math.max(combinedSend, 0.5 * (1 - tailU));
              combinedFb = Math.max(combinedFb, 0.65 * (1 - tailU));
            }
          }
          if (ch.echoLayer?.enabled) {
            const el = ch.echoLayer;
            if (p >= el.start01) {
              const eu = Math.min(1, (p - el.start01) / Math.max(0.1, el.end01 - el.start01));
              const sendEnv = eu < 0.45 ? (eu / 0.45) * el.peakSend : Math.max(0, el.peakSend * (1 - (eu - 0.45) / 0.55));
              const fbEnv = Math.min(0.75, el.peakFeedback * (1 - Math.max(0, eu - 0.5) / 0.5));
              combinedSend = Math.max(combinedSend, sendEnv);
              combinedFb = Math.max(combinedFb, fbEnv);
            }
          }
          setAudioParamSmooth(outgoing.delaySendNode?.gain, this.audioCtx, Math.min(0.68, combinedSend), 0.025);
          setAudioParamSmooth(outgoing.delayFeedbackNode?.gain, this.audioCtx, Math.min(0.76, combinedFb), 0.025);

          // 4. Organic Gain Sculpting
          if (ch.techniqueMode === 'dub_echo') {
            outGain = p < 0.62 ? Math.cos((p / 0.62) * 0.5 * Math.PI) : 0;
            inGain = p < 0.2 ? 0 : Math.min(1, Math.sin(Math.min(1, (p - 0.2) / 0.52) * 0.5 * Math.PI));
          } else if (ch.techniqueMode === 'loop_build') {
            const buildU = Math.min(1, p / 0.68);
            outGain = p < 0.68 ? 1 - buildU * 0.22 : 0.78 * Math.max(0, 1 - (p - 0.68) / 0.16);
            inGain = p < 0.4 ? Math.sin((p / 0.4) * 0.5 * Math.PI) * 0.65 : p < 0.68 ? 0.65 + ((p - 0.4) / 0.28) * 0.35 : 1.0;
          } else {
            outGain = p < 0.58 ? 1 - 0.16 * (p / 0.58) : 0.84 * Math.cos(((p - 0.58) / 0.42) * 0.5 * Math.PI);
            inGain = p < 0.5 ? Math.sin((p / 0.5) * 0.5 * Math.PI) * 0.93 : 0.93 + 0.07 * ((p - 0.5) / 0.5);
          }

          // 5. Bidirectional BPM Ramp Matching
          if (this.djModeConfig.tempoMatching) {
            if (Math.abs(outTargetRate - 1.0) > 0.002) {
              const ramp = Math.min(1, p / 0.75);
              outgoing.audio.playbackRate = Number((1.0 + (outTargetRate - 1.0) * ramp).toFixed(3));
            }
            if (Math.abs(startRate - 1.0) > 0.002) {
              const glide = p <= 0.46 ? 0 : Math.min(1, (p - 0.46) / 0.54);
              incoming.audio.playbackRate = Number((startRate + (1.0 - startRate) * glide).toFixed(3));
            }
          }
        } else if (ch && ch.techniqueMode === 'vocal_over_beat') {
          // Outgoing vocal floats clean while outgoing bass cuts early and incoming beat takes over
          const outLowDrop = Math.min(1, p / 0.3);
          const inLowRise = p < 0.16 ? 0 : Math.min(1, (p - 0.16) / 0.22);
          const inMidRelease = p < 0.5 ? 0 : Math.min(1, (p - 0.5) / 0.36);

          setAudioParamSmooth(outgoing.lowEqNode?.gain, this.audioCtx, -24 * outLowDrop);
          setAudioParamSmooth(incoming.lowEqNode?.gain, this.audioCtx, -24 * (1 - inLowRise));
          setAudioParamSmooth(
            outgoing.midEqNode?.gain,
            this.audioCtx,
            p < 0.55 ? 1.5 : 1.5 - ((p - 0.55) / 0.45) * 14
          );
          setAudioParamSmooth(
            incoming.midEqNode?.gain,
            this.audioCtx,
            ch.incomingVocalHoldDb * (1 - inMidRelease)
          );
          setAudioParamSmooth(incoming.highEqNode?.gain, this.audioCtx, -4 * (1 - Math.min(1, p / 0.35)));
          if (outgoing.sweepFilterNode) {
            outgoing.sweepFilterNode.type = 'highpass';
            outgoing.sweepFilterNode.Q.value = 0.85;
            setAudioParamSmooth(outgoing.sweepFilterNode.frequency, this.audioCtx, 180 + p * 650);
          }
          const sendCurve = p < 0.48 ? 0 : p < 0.78 ? ((p - 0.48) / 0.3) * 0.46 : Math.max(0, 0.46 * (1 - (p - 0.78) / 0.22));
          setAudioParamSmooth(outgoing.delaySendNode?.gain, this.audioCtx, sendCurve, 0.025);
          setAudioParamSmooth(outgoing.delayFeedbackNode?.gain, this.audioCtx, 0.5, 0.025);

          outGain = p < 0.62 ? 0.94 - p * 0.12 : 0.86 * Math.cos(((p - 0.62) / 0.38) * 0.5 * Math.PI);
          inGain = p < 0.35 ? Math.sin((p / 0.35) * 0.5 * Math.PI) * 0.94 : 0.94 + 0.06 * ((p - 0.35) / 0.65);
        } else if (ch && ch.techniqueMode === 'instrumental_bed') {
          // Carve outgoing vocals deeply to leave instrumental groove while incoming vocal glides in cleanly
          const carveU = Math.min(1, p / 0.25);
          const swapStart = 0.5;
          const swapEnd = 0.76;
          const swapU = p <= swapStart ? 0 : p >= swapEnd ? 1 : (p - swapStart) / (swapEnd - swapStart);

          setAudioParamSmooth(outgoing.midEqNode?.gain, this.audioCtx, -18.5 * carveU);
          setAudioParamSmooth(incoming.midEqNode?.gain, this.audioCtx, -2 * (1 - Math.min(1, p / 0.32)));
          setAudioParamSmooth(outgoing.lowEqNode?.gain, this.audioCtx, -24 * swapU);
          setAudioParamSmooth(incoming.lowEqNode?.gain, this.audioCtx, -24 * (1 - swapU));
          setAudioParamSmooth(outgoing.highEqNode?.gain, this.audioCtx, -6 * Math.pow(p, 1.3));
          setAudioParamSmooth(incoming.highEqNode?.gain, this.audioCtx, -5 * (1 - Math.min(1, p / 0.45)));

          outGain = p < 0.64 ? 0.96 - p * 0.14 : 0.87 * Math.cos(((p - 0.64) / 0.36) * 0.5 * Math.PI);
          inGain = p < 0.3 ? Math.sin((p / 0.3) * 0.5 * Math.PI) * 0.92 : 0.92 + 0.08 * ((p - 0.3) / 0.7);
        } else if (ch && ch.techniqueMode === 'loop_build') {
          // Tight rhythmic loop repeat + resonant HPF build into crisp incoming drop
          const buildU = Math.min(1, p / 0.68);
          if (outgoing.sweepFilterNode) {
            outgoing.sweepFilterNode.type = 'highpass';
            outgoing.sweepFilterNode.Q.value = 2.3;
            const hpFreq = 90 * Math.pow(2400 / 90, Math.pow(buildU, 1.2));
            setAudioParamSmooth(outgoing.sweepFilterNode.frequency, this.audioCtx, hpFreq);
          }
          setAudioParamSmooth(outgoing.lowEqNode?.gain, this.audioCtx, -24 * Math.min(1, p / 0.5));
          setAudioParamSmooth(incoming.lowEqNode?.gain, this.audioCtx, p < 0.66 ? -24 : 0, 0.02);

          const loopSend = p < 0.66 ? 0.18 + buildU * 0.46 : Math.max(0, 0.64 * (1 - (p - 0.66) / 0.25));
          const loopFb = p < 0.66 ? 0.42 + buildU * 0.31 : Math.max(0, 0.72 * (1 - (p - 0.66) / 0.34));
          setAudioParamSmooth(outgoing.delaySendNode?.gain, this.audioCtx, loopSend, 0.02);
          setAudioParamSmooth(outgoing.delayFeedbackNode?.gain, this.audioCtx, Math.min(0.75, loopFb), 0.02);

          outGain = p < 0.68 ? 1 - buildU * 0.22 : 0.78 * Math.max(0, 1 - (p - 0.68) / 0.16);
          inGain = p < 0.4 ? Math.sin((p / 0.4) * 0.5 * Math.PI) * 0.65 : p < 0.68 ? 0.65 + ((p - 0.4) / 0.28) * 0.35 : 1.0;
        } else if (ch) {
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
          // Vocal-Stem over Outgoing Beat Crossfade:
          // Phase 1 (0–46%): Outgoing carves its own vocal pocket (-16.5 dB) to become an instrumental bed
          //                  while incoming enters isolated as a vocal stem (HPF 320Hz, +3.5 dB vocal presence, -32 dB lows).
          // Phase 2 (46–54%): Brief zero-clash low-end pocket (both basses cut) so kicks at different BPMs never collide.
          // Phase 3 (54–72%): Incoming beat & bass drop in cleanly while outgoing fades out high-passed with subtle echo tail.
          // Phase 4 (72–100%): Full transparent incoming track; outgoing dissolves cleanly.
          if (p < 0.46) {
            const u = p / 0.46;
            const carveU = Math.min(1, p / 0.22);
            const outBassCutU = p < 0.34 ? 0 : (p - 0.34) / 0.12;

            outGain = 1.0 - 0.22 * u;
            inGain = Math.sin(u * 0.5 * Math.PI) * 0.86;

            // Outgoing becomes clean instrumental bed (carve vocals, keep beat until p=0.34, then drop lows)
            setAudioParamSmooth(outgoing.midEqNode?.gain, this.audioCtx, -16.5 * carveU);
            setAudioParamSmooth(outgoing.highEqNode?.gain, this.audioCtx, -3.5 * carveU);
            setAudioParamSmooth(outgoing.lowEqNode?.gain, this.audioCtx, -32 * outBassCutU);
            if (outgoing.sweepFilterNode) {
              outgoing.sweepFilterNode.type = 'highpass';
              outgoing.sweepFilterNode.Q.value = 0.75;
              setAudioParamSmooth(outgoing.sweepFilterNode.frequency, this.audioCtx, 24 + outBassCutU * 276);
            }

            // Incoming floats as vocal stem only (zero kicks/bass, vocal presence forward)
            setAudioParamSmooth(incoming.lowEqNode?.gain, this.audioCtx, -32);
            setAudioParamSmooth(incoming.midEqNode?.gain, this.audioCtx, 3.5);
            setAudioParamSmooth(incoming.highEqNode?.gain, this.audioCtx, -4.5);
            if (incoming.sweepFilterNode) {
              incoming.sweepFilterNode.type = 'highpass';
              incoming.sweepFilterNode.Q.value = 0.75;
              setAudioParamSmooth(incoming.sweepFilterNode.frequency, this.audioCtx, 320);
            }
          } else if (p < 0.54) {
            const u = (p - 0.46) / 0.08;
            outGain = 0.78 - 0.14 * u;
            inGain = 0.86 + 0.06 * u;

            // Zero-clash pocket + subtle dub echo tail on outgoing instrumental
            setAudioParamSmooth(outgoing.lowEqNode?.gain, this.audioCtx, -32);
            setAudioParamSmooth(outgoing.midEqNode?.gain, this.audioCtx, -16.5);
            setAudioParamSmooth(outgoing.highEqNode?.gain, this.audioCtx, -4.5);
            if (outgoing.sweepFilterNode) {
              outgoing.sweepFilterNode.type = 'highpass';
              outgoing.sweepFilterNode.Q.value = 0.8;
              setAudioParamSmooth(outgoing.sweepFilterNode.frequency, this.audioCtx, 300 + u * 80);
            }
            setAudioParamSmooth(outgoing.delaySendNode?.gain, this.audioCtx, 0.16 * u, 0.025);
            setAudioParamSmooth(outgoing.delayFeedbackNode?.gain, this.audioCtx, 0.32, 0.025);

            setAudioParamSmooth(incoming.lowEqNode?.gain, this.audioCtx, -32);
            setAudioParamSmooth(incoming.midEqNode?.gain, this.audioCtx, 3.5);
            setAudioParamSmooth(incoming.highEqNode?.gain, this.audioCtx, -4.0);
            if (incoming.sweepFilterNode) {
              incoming.sweepFilterNode.type = 'highpass';
              incoming.sweepFilterNode.Q.value = 0.75;
              setAudioParamSmooth(incoming.sweepFilterNode.frequency, this.audioCtx, 320);
            }
          } else if (p < 0.72) {
            const u = (p - 0.54) / 0.18;
            outGain = 0.64 * Math.cos(u * 0.5 * Math.PI * 0.75);
            inGain = 0.92 + 0.08 * u;

            // Incoming beat & bass drop in smoothly while vocal EQ relaxes to flat
            setAudioParamSmooth(incoming.lowEqNode?.gain, this.audioCtx, -32 * (1 - u));
            setAudioParamSmooth(incoming.midEqNode?.gain, this.audioCtx, 3.5 * (1 - u));
            setAudioParamSmooth(incoming.highEqNode?.gain, this.audioCtx, -4.0 * (1 - u));
            if (incoming.sweepFilterNode) {
              incoming.sweepFilterNode.type = 'highpass';
              incoming.sweepFilterNode.Q.value = 0.707;
              setAudioParamSmooth(incoming.sweepFilterNode.frequency, this.audioCtx, 320 - u * 296);
            }

            // Outgoing sweeps up and dissolves out of the way
            setAudioParamSmooth(outgoing.lowEqNode?.gain, this.audioCtx, -32);
            setAudioParamSmooth(outgoing.midEqNode?.gain, this.audioCtx, -16.5);
            setAudioParamSmooth(outgoing.highEqNode?.gain, this.audioCtx, -4.5 - u * 3.5);
            if (outgoing.sweepFilterNode) {
              outgoing.sweepFilterNode.type = 'highpass';
              outgoing.sweepFilterNode.Q.value = 0.9;
              setAudioParamSmooth(outgoing.sweepFilterNode.frequency, this.audioCtx, 380 + u * 420);
            }
            setAudioParamSmooth(outgoing.delaySendNode?.gain, this.audioCtx, 0.16 * (1 - u), 0.025);
            setAudioParamSmooth(outgoing.delayFeedbackNode?.gain, this.audioCtx, 0.32 * (1 - u * 0.6), 0.025);
          } else {
            const u = (p - 0.72) / 0.28;
            outGain = 0.24 * Math.cos(u * 0.5 * Math.PI);
            inGain = 1.0;

            setAudioParamSmooth(outgoing.lowEqNode?.gain, this.audioCtx, -32);
            setAudioParamSmooth(outgoing.midEqNode?.gain, this.audioCtx, -18);
            setAudioParamSmooth(outgoing.highEqNode?.gain, this.audioCtx, -8);
            if (outgoing.sweepFilterNode) {
              outgoing.sweepFilterNode.type = 'highpass';
              outgoing.sweepFilterNode.Q.value = 0.9;
              setAudioParamSmooth(outgoing.sweepFilterNode.frequency, this.audioCtx, 800 + u * 600);
            }
            setAudioParamSmooth(outgoing.delaySendNode?.gain, this.audioCtx, 0, 0.025);
            setAudioParamSmooth(outgoing.delayFeedbackNode?.gain, this.audioCtx, 0, 0.025);

            setAudioParamSmooth(incoming.lowEqNode?.gain, this.audioCtx, 0);
            setAudioParamSmooth(incoming.midEqNode?.gain, this.audioCtx, 0);
            setAudioParamSmooth(incoming.highEqNode?.gain, this.audioCtx, 0);
            if (incoming.sweepFilterNode) {
              incoming.sweepFilterNode.type = 'lowpass';
              incoming.sweepFilterNode.Q.value = 0.707;
              setAudioParamSmooth(incoming.sweepFilterNode.frequency, this.audioCtx, 20000);
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

        // Sum-normalized gain ceiling: prevents overlapping decks + normalization from summing louder than a single track
        const powerSum = Math.hypot(outGain, inGain);
        if (powerSum > 1.0) {
          outGain /= powerSum;
          inGain /= powerSum;
        }
        const linearSum = outGain + inGain;
        if (linearSum > 1.04) {
          const atten = 1.04 / linearSum;
          outGain *= atten;
          inGain *= atten;
        }

        // Smoothly attenuate any active upward normalization boost during overlap so volume stays level at end of crossfade
        if (this.normalizationEnabled) {
          const overlapFactor = Math.sin(p * Math.PI);
          const outTrimNow = outgoing.trimGainNode?.gain.value ?? 1.0;
          if (outTrimNow > 1.0) {
            const targetOutTrim = 1.0 + (outTrimNow - 1.0) * (1 - 0.55 * overlapFactor);
            setAudioParamSmooth(outgoing.trimGainNode?.gain, this.audioCtx, targetOutTrim, 0.05);
          }
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
          if (this.transitionSafetyTimer) {
            clearTimeout(this.transitionSafetyTimer);
            this.transitionSafetyTimer = null;
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
            void playAudioWithTimeout(incoming.audio, 2500);
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
          this.positionSec = this.durationSec > 0 ? Math.min(this.durationSec, livePos) : livePos;
          this.resetEofTracking(this.positionSec);
          this.emitState();
          resolve();
        };

        this.transitionResolve = () => {
          if (settled) return;
          settled = true;
          this.transitionResolve = null;
          resolve();
        };

        this.transitionSafetyTimer = setTimeout(() => {
          finish();
        }, totalMs + 1200);
        (this.transitionSafetyTimer as { unref?: () => void }).unref?.();

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
    } catch (err) {
      this.cancelActiveTransition();
      throw err;
    }
  }

  public cancelActiveTransition(): void {
    if (this.transitionTimer) {
      clearInterval(this.transitionTimer);
      this.transitionTimer = null;
    }
    if (this.transitionSafetyTimer) {
      clearTimeout(this.transitionSafetyTimer);
      this.transitionSafetyTimer = null;
    }
    if (this.transitionRafId !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(this.transitionRafId);
      this.transitionRafId = null;
    }
    const wasTransitioning = this.isTransitioning;
    this.isTransitioning = false;
    this.activeTransitionType = undefined;
    this.transitionProgress01 = 0;
    this.playbackRate = 1.0;
    if (this.deckA && this.deckB) {
      const active = this.getDeck(this.activeDeck);
      const inactive = this.getDeck(this.getInactiveDeckId());
      inactive.audio.pause();
      this.resetDeckDsp(inactive, 0);
      this.resetDeckDsp(active, 1.0);
    }
    if (wasTransitioning) {
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
    let raw = this.positionSec;
    if (this.deckA && this.deckB) {
      const deck = this.getDeck(this.activeDeck);
      const t = deck.audio.currentTime;
      if (!deck.audio.seeking && Number.isFinite(t) && t >= 0) {
        raw = t;
      }
    }
    return this.durationSec > 0 ? Math.max(0, Math.min(this.durationSec, raw)) : Math.max(0, raw);
  }

  public getLivePlaybackSnapshot(): LivePlaybackSnapshot {
    const deck = this.deckA && this.deckB ? this.getDeck(this.activeDeck) : null;
    const audio = deck?.audio;
    const audioDur =
      audio && Number.isFinite(audio.duration) && audio.duration > 1 ? audio.duration : 0;
    const dur = audioDur > 0 ? audioDur : this.durationSec;
    let rawPos = this.positionSec;
    if (audio && !audio.seeking && Number.isFinite(audio.currentTime) && audio.currentTime >= 0) {
      rawPos = audio.currentTime;
    }
    const clampedPos = dur > 0 ? Math.max(0, Math.min(dur, rawPos)) : Math.max(0, rawPos);
    return {
      positionSec: clampedPos,
      durationSec: dur,
      isPlaying: this.isPlaying,
      isBuffering: this.isBuffering,
      isPaused: audio ? Boolean(audio.paused) : !this.isPlaying,
      isEnded: audio ? Boolean(audio.ended) : false,
      isSeeking: audio ? Boolean(audio.seeking) : false,
      isTransitioning: this.isTransitioning,
    };
  }

  public getState(): AudioEngineState {
    return {
      activeDeck: this.activeDeck,
      isPlaying: this.isPlaying,
      isBuffering: this.isBuffering,
      bufferedPct: this.bufferedPct,
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
    this.loadGeneration++;
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
