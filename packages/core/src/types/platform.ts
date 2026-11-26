import type { PlatformRuntime, Track } from './music.ts';
import type { Unsubscribe } from './utility.ts';

export type AudioStreamQuality = 'high' | 'medium' | 'low';

export interface NativeFetchRequest {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface NativeFetchResponse {
  status: number;
  headers: Record<string, string>;
  text: string;
  /** Final URL after redirects (used for Spotify short-link resolution) */
  url?: string;
}

export interface DiscordPresenceState {
  track: Track | null;
  isPlaying: boolean;
  positionSec: number;
  durationSec?: number;
  enabled: boolean;
  clientId?: string;
  showTimestamps?: boolean;
  showArtwork?: boolean;
  showWhenPaused?: boolean;
  displayMode?: 'song' | 'artist' | 'app';
}

export interface DiscordRpcStatus {
  connected: boolean;
  status: 'connected' | 'connecting' | 'disconnected' | 'needs_client_id' | 'disabled' | 'web_only';
  username?: string;
  clientId: string;
  lastError?: string;
}

export type NativeMediaActionType =
  | 'play'
  | 'pause'
  | 'toggle'
  | 'nexttrack'
  | 'previoustrack'
  | 'seekto'
  | 'stop'
  | 'shuffle'
  | 'repeat';

export interface NativeMediaAction {
  type: NativeMediaActionType;
  seekTimeSec?: number;
}

export interface NativeMediaSessionState {
  track: Track | null;
  isPlaying: boolean;
  positionSec: number;
  durationSec: number;
  playbackRate?: number;
  shuffleEnabled?: boolean;
  repeatMode?: 'off' | 'all' | 'one';
}

export interface OfflineAudioSaveResult {
  uri: string;
  sizeBytes: number;
}

export interface OfflineAudioEntry {
  trackId: string;
  sizeBytes: number;
}

export interface IOfflineStorageBridge {
  saveAudio(trackId: string, data: ArrayBuffer, mimeType: string): Promise<OfflineAudioSaveResult>;
  getAudioUrl(trackId: string): Promise<string | null>;
  deleteAudio(trackId: string): Promise<void>;
  listOfflineIds(): Promise<OfflineAudioEntry[]>;
  clearAll(): Promise<void>;
}

/**
 * Async key-value persistence bridge.
 * Intentionally shape-compatible with `@supabase/auth-js` `SupportedStorage`
 * so Android (`@capacitor/preferences`), Electron, and Web share one contract.
 */
export interface IPreferencesStorageBridge {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface IPlatformBridge {
  readonly runtime: PlatformRuntime;
  /** Vite dev: '', Electron: 'http://127.0.0.1:<port>', Android: native proxy or '' */
  getApiBaseUrl(): Promise<string>;
  /** Per-launch loopback auth headers for Electron/Android local proxy */
  getAuthHeaders(): Promise<Record<string, string>>;
  /** Always returns a CORS-safe URL usable by `<audio crossOrigin="anonymous">` + Web Audio API */
  buildStreamUrl(videoId: string, quality?: AudioStreamQuality): Promise<string>;
  nativeFetch(url: string, init?: NativeFetchRequest): Promise<NativeFetchResponse>;
  updateDiscordPresence?(state: DiscordPresenceState): Promise<void>;
  configureDiscordRpc?(clientId: string): Promise<DiscordRpcStatus>;
  reconnectDiscordRpc?(): Promise<DiscordRpcStatus>;
  getDiscordRpcStatus?(): Promise<DiscordRpcStatus>;
  updateNativeMediaSession?(state: NativeMediaSessionState): Promise<void>;
  onNativeMediaAction?(cb: (action: NativeMediaAction) => void): Unsubscribe;
  offlineStorage: IOfflineStorageBridge;
  preferencesStorage: IPreferencesStorageBridge;
}
