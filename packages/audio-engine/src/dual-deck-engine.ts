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
  gainNode?: GainNode;
  delaySendNode?: GainNode;
  delayNode?: DelayNode;
  delayFeedbackNode?: GainNode;
}

function setAudioParamSmooth(
  param: AudioParam | undefined,
  ctx: AudioContext | null,
  value: number,
  timeConstantSec = 0.03
): void {
  if (!param) return;
  if (ctx && typeof param.setTargetAtTime === 'function') {
    param.setTargetAtTime(value, ctx.currentTime, timeConstantSec);
  } else {
    param.value = value;
  }
}

export async function waitForAudioReady(
  audio: HTMLAudioElement,
  targetSec: number,
  timeoutMs = 2400
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
      const maxDur = Number.isFinite(audio.duration) && audio.duration > 1 ? audio.duration - 0.5 : safeTarget;
      audio.currentTime = Math.max(0, Math.min(maxDur, safeTarget));
    } catch {
      // ignore before metadata
    }
  };

  if (audio.readyState >= 1) {
    seekTarget();
    if (safeTarget <= 0.2 || audio.readyState >= 3) return;
  }

  await new Promise<void>((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      audio.removeEventListener('loadedmetadata', onMeta);
      audio.removeEventListener('canplay', done);
      audio.removeEventListener('seeked', done);
      clearTimeout(timer);
      resolve();
    };
    const onMeta = () => {
      seekTarget();
      if (safeTarget <= 0.2 || audio.readyState >= 3) {
        done();
      }
    };
    const timer = setTimeout(() => {
      seekTarget();
      done();
    }, timeoutMs);

    audio.addEventListener('loadedmetadata', onMeta);
    audio.addEventListener('canplay', done);
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
  private limiterNode: DynamicsCompressorNode | null = null;
  private analyserNode: AnalyserNode | null = null;

  private deckA: DeckChannelNodes | null = null;
  private deckB: DeckChannelNodes | null = null;

  private activeDeck: DeckId = 'A';
  private isPlaying = false;
  private positionSec = 0;
  private durationSec = 0;
  private volume = 0.85;
  private isTransitioning = false;
  private activeTransitionType?: DjTransitionType;
  private transitionProgress01 = 0;
  private transitionTimer: ReturnType<typeof setInterval> | null = null;
  private transitionRafId: number | null = null;
  private transitionResolve: (() => void) | null = null;

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
        this.masterGainNode.gain.value = this.volume;

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
        this.masterGainNode.connect(this.analyserNode);
        this.analyserNode.connect(ctx.destination);

        this.wireDeckWebAudioNodes(ctx, this.deckA, firstEq);
        this.wireDeckWebAudioNodes(ctx, this.deckB, firstEq);
      } catch {
        // Fallback to pure HTMLAudioElement playback when Web Audio is unavailable in test runners
      }
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
        volume: this.volume,
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

    audio.addEventListener('timeupdate', () => {
      if (this.activeDeck === id) {
        this.positionSec = Number.isFinite(audio.currentTime) ? audio.currentTime : this.positionSec;
        if (Number.isFinite(audio.duration) && audio.duration > 0) {
          this.durationSec = audio.duration;
        }
        this.emitState();
      }
    });

    audio.addEventListener('ended', () => {
      if (this.activeDeck === id) {
        this.isPlaying = false;
        this.emitState();
      }
      for (const listener of this.endedListeners) {
        listener(id);
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

      const deckGain = ctx.createGain();
      deckGain.gain.value = 1.0;

      const delaySend = ctx.createGain();
      delaySend.gain.value = 0;

      const delayNode = ctx.createDelay(4.0);
      delayNode.delayTime.value = 0.375;

      const delayFeedback = ctx.createGain();
      delayFeedback.gain.value = 0; // Capped <= 0.78 during Echo Out

      source.connect(lowEq);
      lowEq.connect(midEq);
      midEq.connect(highEq);
      highEq.connect(sweepFilter);
      sweepFilter.connect(deckGain);
      deckGain.connect(destination);

      // Pre-fader echo send loop so echo tail rings out even as deckGain fades down
      sweepFilter.connect(delaySend);
      delaySend.connect(delayNode);
      delayNode.connect(delayFeedback);
      delayFeedback.connect(delayNode);
      delayNode.connect(destination);

      deck.sourceNode = source;
      deck.lowEqNode = lowEq;
      deck.midEqNode = midEq;
      deck.highEqNode = highEq;
      deck.sweepFilterNode = sweepFilter;
      deck.gainNode = deckGain;
      deck.delaySendNode = delaySend;
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
    deck.audio.playbackRate = 1.0;
    deck.audio.volume = this.audioCtx ? 1.0 : this.volume * gainValue;
    if (deck.lowEqNode) deck.lowEqNode.gain.value = 0;
    if (deck.midEqNode) deck.midEqNode.gain.value = 0;
    if (deck.highEqNode) deck.highEqNode.gain.value = 0;
    if (deck.sweepFilterNode) {
      deck.sweepFilterNode.type = 'lowpass';
      deck.sweepFilterNode.frequency.value = 20000;
      deck.sweepFilterNode.Q.value = 0.707;
    }
    if (deck.gainNode) deck.gainNode.gain.value = gainValue;
    if (deck.delaySendNode) deck.delaySendNode.gain.value = 0;
    if (deck.delayFeedbackNode) deck.delayFeedbackNode.gain.value = 0;
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
      await waitForAudioReady(nextDeck.audio, safeStart, 1200);
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
    try {
      nextDeck.audio.currentTime = safeStart;
    } catch {
      nextDeck.audio.addEventListener?.(
        'loadedmetadata',
        () => {
          try {
            nextDeck.audio.currentTime = safeStart;
          } catch {
            // ignore
          }
        },
        { once: true }
      );
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
    const safePos = Math.max(0, Math.min(this.durationSec || 3600, positionSec));
    this.positionSec = safePos;
    if (this.deckA && this.deckB) {
      const deck = this.getDeck(this.activeDeck);
      try {
        deck.audio.currentTime = safePos;
      } catch {
        // ignore
      }
    }
    this.emitState();
  }

  public setVolume(volume01: number): void {
    const clamped = Math.max(0, Math.min(1, Number.isFinite(volume01) ? volume01 : 0.85));
    this.volume = clamped;
    if (this.masterGainNode) {
      this.masterGainNode.gain.value = clamped;
    }
    if (this.deckA && !this.audioCtx) {
      this.deckA.audio.volume = clamped;
    }
    if (this.deckB && !this.audioCtx) {
      this.deckB.audio.volume = clamped;
    }
    this.emitState();
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

    // Reset incoming DSP cleanly before fading in
    this.resetDeckDsp(incoming, 0);
    incoming.audio.playbackRate = startRate;
    if (plan.transitionType === 'eq_swap') {
      setAudioParamSmooth(incoming.lowEqNode?.gain, this.audioCtx, -24, 0.01);
      setAudioParamSmooth(incoming.midEqNode?.gain, this.audioCtx, -3, 0.01);
    } else if (plan.transitionType === 'filter_sweep' && incoming.sweepFilterNode) {
      incoming.sweepFilterNode.type = 'lowpass';
      incoming.sweepFilterNode.Q.value = 1.25;
      setAudioParamSmooth(incoming.sweepFilterNode.frequency, this.audioCtx, 260, 0.01);
    }

    await waitForAudioReady(incoming.audio, Math.max(0, plan.cueInSec), 2400);

    try {
      await incoming.audio.play();
    } catch {
      // ignore in headless tests
    }

    const totalMs = Math.max(250, Math.min(14_000, Math.round(plan.transitionDurationSec * 1000)));
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

      if (plan.transitionType === 'eq_swap') {
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
        outgoing.audio.volume = this.volume * outGain;
        incoming.audio.volume = this.volume * inGain;
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

      if (typeof requestAnimationFrame === 'function' && totalMs >= 500) {
        const startedAt = performance.now();
        const tick = (now: number) => {
          if (settled) return;
          const p = Math.min(1, (now - startedAt) / totalMs);
          applyCurve(p);
          if (p >= 1) {
            finish();
          } else {
            this.transitionRafId = requestAnimationFrame(tick);
          }
        };
        this.transitionRafId = requestAnimationFrame(tick);
      } else {
        const steps = 12;
        const stepMs = Math.max(20, Math.floor(totalMs / steps));
        let currentStep = 0;
        this.transitionTimer = setInterval(() => {
          currentStep++;
          const p = Math.min(1, currentStep / steps);
          applyCurve(p);
          if (currentStep >= steps) {
            finish();
          }
        }, stepMs);
      }
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
