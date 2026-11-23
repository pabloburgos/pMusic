import type { Track } from '../types/music.ts';
import type { DistributiveOmit, Unsubscribe } from '../types/utility.ts';
import type { DjSessionStyle } from './audio.ts';
import type { ImplicitSignalType } from './recommendations.ts';

/** Exact match to PostgreSQL `public.device_sessions.active_platform` CHECK constraint */
export type DevicePlatform = 'windows' | 'android' | 'web';

export type SyncMode = 'supabase' | 'local_only';

export type SyncTableName =
  | 'playlists'
  | 'playlist_tracks'
  | 'liked_tracks'
  | 'artist_affinity'
  | 'device_sessions';

export interface SyncAuthState {
  userId: string | null;
  email: string | null;
  connected: boolean;
}

export interface SyncConfigInput {
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  deviceName?: string;
}

/**
 * Supabase Realtime Presence payload.
 * Strictly 7 keys total (<= 10-key Supabase Free Tier limit).
 * `track()` calls MUST be throttled >= 8,000ms to respect the 5 calls / 30s limit.
 */
export interface DevicePresenceState {
  device_id: string;
  device_name: string;
  platform: DevicePlatform;
  is_active: boolean;
  is_playing: boolean;
  track_title: string;
  /** Epoch milliseconds */
  updated_at: number;
}

export interface PlaybackTransferSnapshot {
  track: Track;
  /** Capped <= 100 tracks to remain safely under 256 KB Broadcast limit */
  queue: Track[];
  queueIndex: number;
  positionMs: number;
  isPlaying: boolean;
  volume: number;
  djModeEnabled: boolean;
  djSessionStyle: DjSessionStyle;
  sentAtEpochMs: number;
}

export type PlayHistorySignalType = 'play' | ImplicitSignalType;

/**
 * Reconciled local + Supabase `play_history` record.
 */
export interface PlayHistoryRecord {
  /** UUID */
  id: string;
  trackId: string;
  track: Track;
  playedSec: number;
  /** Validated range [0, 1.5] matching SQL CHECK */
  completionRatio: number;
  signalType: PlayHistorySignalType;
  deviceId?: string;
  /** ISO-8601 UTC timestamp */
  playedAt: string;
  userId?: string;
}

/**
 * Reconciled local + Supabase `device_sessions` record.
 */
export interface DeviceSessionRecord {
  userId?: string;
  activeDeviceId: string;
  activeDeviceName: string;
  activePlatform: DevicePlatform;
  track: Track | null;
  queue: Track[];
  queueIndex: number;
  positionMs: number;
  isPlaying: boolean;
  volume: number;
  djModeEnabled: boolean;
  djSessionStyle: DjSessionStyle;
  /** ISO-8601 UTC timestamp */
  updatedAt: string;
}

export interface RemoteCommandEnvelope {
  cmdId: string;
  originDeviceId: string;
  targetDeviceId: string;
  seq: number;
}

export type RemoteCommand =
  | (RemoteCommandEnvelope & {
      type: 'play' | 'pause' | 'toggle' | 'next' | 'prev' | 'request_state' | 'pull_transfer';
    })
  | (RemoteCommandEnvelope & { type: 'seek'; positionMs: number })
  | (RemoteCommandEnvelope & { type: 'volume'; volume01: number })
  | (RemoteCommandEnvelope & {
      type: 'set_dj_mode';
      enabled: boolean;
      style: DjSessionStyle;
    })
  | (RemoteCommandEnvelope & {
      type: 'transfer';
      snapshot: PlaybackTransferSnapshot;
    })
  | (RemoteCommandEnvelope & {
      type: 'transfer_ack';
      transferCmdId: string;
    })
  | (RemoteCommandEnvelope & {
      type: 'state_pulse';
      deviceName: string;
      trackTitle: string;
      trackArtist: string;
      thumbnailUrl?: string;
      isPlaying: boolean;
      positionMs: number;
      durationMs: number;
      volume: number;
    })
  | (RemoteCommandEnvelope & { type: 'clock_ping'; t0: number })
  | (RemoteCommandEnvelope & { type: 'clock_pong'; t0: number; t1: number });

/**
 * Preserves full discriminated union narrowing for outgoing remote commands
 * (`DistributiveOmit` avoids built-in `Omit` union-collapse).
 */
export type RemoteCommandInput = DistributiveOmit<
  RemoteCommand,
  'cmdId' | 'originDeviceId' | 'seq'
>;

export interface ISyncEngine {
  readonly mode: SyncMode;
  readonly deviceId: string;
  configure(config: SyncConfigInput): Promise<void>;
  signUp(
    email: string,
    password: string
  ): Promise<{ userId: string; needsEmailConfirmation: boolean }>;
  signIn(email: string, password: string): Promise<{ userId: string }>;
  signOut(): Promise<void>;
  restoreSession?(): Promise<SyncAuthState>;
  getAuthState(): SyncAuthState;
  persistDeviceSession?(snapshot: PlaybackTransferSnapshot): Promise<void>;
  fetchLatestDeviceSession?(): Promise<DeviceSessionRecord | null>;
  connectRealtime(): Promise<void>;
  disconnectRealtime(): Promise<void>;
  getOnlineDevices(): DevicePresenceState[];
  sendRemoteCommand(cmd: RemoteCommandInput): Promise<boolean>;
  transferPlaybackTo(
    targetDeviceId: string,
    snapshot: PlaybackTransferSnapshot
  ): Promise<{ acked: boolean }>;
  updatePresence?(
    state: Partial<Omit<DevicePresenceState, 'device_id' | 'updated_at'>>
  ): Promise<void>;
  /** Flushes offline outbox + delta pulls updated_at > lastSyncedAt */
  syncNow(): Promise<void>;
  onRemoteCommand(cb: (cmd: RemoteCommand) => void): Unsubscribe;
  onDevicesChanged(cb: (devices: DevicePresenceState[]) => void): Unsubscribe;
  onLibraryChanged(cb: (table: SyncTableName) => void): Unsubscribe;
  onAuthStateChanged?(cb: (state: SyncAuthState) => void): Unsubscribe;
}
