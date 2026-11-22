import type {
  IPlatformBridge,
  NativeMediaAction,
  Track,
  Unsubscribe,
} from '@pmusic/core';

export interface MediaSessionControllerOptions {
  platformBridge?: Pick<
    IPlatformBridge,
    'updateNativeMediaSession' | 'updateDiscordPresence' | 'onNativeMediaAction'
  >;
  onAction?: (action: NativeMediaAction) => void;
}

export class MediaSessionController {
  private readonly platformBridge?: Pick<
    IPlatformBridge,
    'updateNativeMediaSession' | 'updateDiscordPresence' | 'onNativeMediaAction'
  >;
  private readonly onAction?: (action: NativeMediaAction) => void;
  private nativeUnsub?: Unsubscribe;
  private discordEnabled = true;

  public constructor(options: MediaSessionControllerOptions = {}) {
    this.platformBridge = options.platformBridge;
    this.onAction = options.onAction;
    this.bindHandlers();
  }

  public setDiscordEnabled(enabled: boolean): void {
    this.discordEnabled = enabled;
  }

  private bindHandlers(): void {
    if (this.platformBridge?.onNativeMediaAction && this.onAction) {
      this.nativeUnsub = this.platformBridge.onNativeMediaAction((action) => {
        this.onAction?.(action);
      });
    }

    if (typeof navigator !== 'undefined' && 'mediaSession' in navigator && navigator.mediaSession) {
      const ms = navigator.mediaSession;
      const safeSetHandler = (
        action: MediaSessionAction,
        handler: MediaSessionActionHandler | null
      ) => {
        try {
          ms.setActionHandler(action, handler);
        } catch {
          // Unsupported action on current browser
        }
      };

      safeSetHandler('play', () => this.onAction?.({ type: 'play' }));
      safeSetHandler('pause', () => this.onAction?.({ type: 'pause' }));
      safeSetHandler('previoustrack', () => this.onAction?.({ type: 'previoustrack' }));
      safeSetHandler('nexttrack', () => this.onAction?.({ type: 'nexttrack' }));
      safeSetHandler('stop', () => this.onAction?.({ type: 'stop' }));
      safeSetHandler('seekto', (details) => {
        if (typeof details.seekTime === 'number') {
          this.onAction?.({ type: 'seekto', seekTimeSec: details.seekTime });
        }
      });
    }
  }

  public async updateSession(state: {
    track: Track | null;
    isPlaying: boolean;
    positionSec: number;
    durationSec: number;
  }): Promise<void> {
    if (typeof navigator !== 'undefined' && 'mediaSession' in navigator && navigator.mediaSession) {
      const ms = navigator.mediaSession;
      ms.playbackState = state.isPlaying ? 'playing' : state.track ? 'paused' : 'none';

      if (state.track && typeof MediaMetadata !== 'undefined') {
        ms.metadata = new MediaMetadata({
          title: state.track.title,
          artist: state.track.artists.map((a) => a.name).join(', '),
          album: state.track.album?.name ?? 'pMusic',
          artwork: state.track.thumbnailUrl
            ? [{ src: state.track.thumbnailUrl, sizes: '512x512', type: 'image/jpeg' }]
            : [],
        });
      }

      if (typeof ms.setPositionState === 'function' && state.durationSec > 0) {
        try {
          ms.setPositionState({
            duration: Math.max(1, state.durationSec),
            playbackRate: 1,
            position: Math.max(0, Math.min(state.durationSec, state.positionSec)),
          });
        } catch {
          // ignore range errors
        }
      }
    }

    if (this.platformBridge?.updateNativeMediaSession) {
      await this.platformBridge.updateNativeMediaSession(state);
    }

    if (this.platformBridge?.updateDiscordPresence) {
      await this.platformBridge.updateDiscordPresence({
        track: state.track,
        isPlaying: state.isPlaying,
        positionSec: state.positionSec,
        enabled: this.discordEnabled,
      });
    }
  }

  public dispose(): void {
    this.nativeUnsub?.();
    this.nativeUnsub = undefined;
  }
}
