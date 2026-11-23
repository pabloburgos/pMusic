import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';
import type {
  DevicePlatform,
  DevicePresenceState,
  DeviceSessionRecord,
  IPreferencesStorageBridge,
  ISyncEngine,
  PlaybackTransferSnapshot,
  RemoteCommand,
  RemoteCommandInput,
  SyncAuthState,
  SyncConfigInput,
  SyncMode,
  SyncTableName,
  Track,
  Unsubscribe,
} from '@pmusic/core';
import {
  LibraryStore,
  createDefaultPreferencesStorage,
} from './library-store.ts';

export interface SyncEngineOptions {
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  deviceId?: string;
  deviceName?: string;
  platform?: DevicePlatform;
  preferencesStorage?: IPreferencesStorageBridge;
  libraryStore?: LibraryStore;
}

const PRESENCE_THROTTLE_MS = 8_000;
const BROADCAST_MAX_QUEUE_TRACKS = 100;

export class LocalOnlySyncBackend {
  public readonly mode: SyncMode = 'local_only';
}

export class SupabaseSyncBackend {
  public readonly mode: SyncMode = 'supabase';
  public readonly client: SupabaseClient;

  public constructor(url: string, anonKey: string, storage?: IPreferencesStorageBridge) {
    this.client = createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        ...(storage ? { storage } : {}),
      },
    });
  }
}

export class SyncEngine implements ISyncEngine {
  private currentMode: SyncMode = 'local_only';
  public readonly deviceId: string;
  private deviceName: string;
  private readonly platform: DevicePlatform;
  private readonly preferencesStorage: IPreferencesStorageBridge;
  public readonly libraryStore: LibraryStore;

  private supabaseUrl = '';
  private supabaseAnonKey = '';
  private supabaseBackend: SupabaseSyncBackend | null = null;
  private realtimeChannel: RealtimeChannel | null = null;
  private localBroadcast: BroadcastChannel | null = null;

  private authState: SyncAuthState = {
    userId: null,
    email: null,
    connected: false,
  };

  private selfPresence: DevicePresenceState;
  private readonly peerDevices = new Map<string, DevicePresenceState>();
  private lastPresenceTrackAtMs = 0;
  private cmdSeq = 0;
  private readonly seenCmdIds = new Set<string>();
  private readonly pendingTransferAcks = new Map<string, (acked: boolean) => void>();

  private readonly remoteCommandListeners = new Set<(cmd: RemoteCommand) => void>();
  private readonly devicesListeners = new Set<(devices: DevicePresenceState[]) => void>();
  private readonly libraryListeners = new Set<(table: SyncTableName) => void>();
  private readonly authListeners = new Set<(state: SyncAuthState) => void>();

  public constructor(options: SyncEngineOptions = {}) {
    this.preferencesStorage = options.preferencesStorage ?? createDefaultPreferencesStorage();
    this.libraryStore = options.libraryStore ?? new LibraryStore(this.preferencesStorage);
    this.platform = options.platform ?? this.detectPlatform();
    this.deviceId =
      options.deviceId ??
      `pmusic_${this.platform}_${Math.random().toString(36).slice(2, 10)}`;
    this.deviceName =
      options.deviceName ??
      (this.platform === 'windows'
        ? 'pMusic Windows PC'
        : this.platform === 'android'
          ? 'pMusic Android'
          : 'pMusic Web');

    this.selfPresence = {
      device_id: this.deviceId,
      device_name: this.deviceName,
      platform: this.platform,
      is_active: true,
      is_playing: false,
      track_title: 'Sin reproducción activa',
      updated_at: Date.now(),
    };

    this.libraryStore.onTableChanged((table) => {
      this.emitLibraryChanged(table);
    });

    if (options.supabaseUrl && options.supabaseAnonKey) {
      this.supabaseUrl = this.normalizeSupabaseUrl(options.supabaseUrl);
      this.supabaseAnonKey = options.supabaseAnonKey.trim();
      if (this.isValidSupabaseConfig(this.supabaseUrl, this.supabaseAnonKey)) {
        this.currentMode = 'supabase';
        this.supabaseBackend = new SupabaseSyncBackend(
          this.supabaseUrl,
          this.supabaseAnonKey,
          this.preferencesStorage
        );
      }
    }
  }

  public get mode(): SyncMode {
    return this.currentMode;
  }

  private detectPlatform(): DevicePlatform {
    if (typeof navigator !== 'undefined') {
      const ua = navigator.userAgent.toLowerCase();
      if (ua.includes('android')) return 'android';
      if (ua.includes('electron') || ua.includes('windows')) return 'windows';
    }
    return 'web';
  }

  private normalizeSupabaseUrl(rawUrl?: string): string {
    if (!rawUrl) return '';
    const trimmed = rawUrl.trim();
    if (!trimmed) return '';
    if (/^[a-z0-9]{12,32}$/i.test(trimmed)) {
      return `https://${trimmed.toLowerCase()}.supabase.co`;
    }
    if (!/^https?:\/\//i.test(trimmed) && trimmed.endsWith('.supabase.co')) {
      return `https://${trimmed}`;
    }
    return trimmed;
  }

  private isValidSupabaseConfig(url?: string, key?: string): boolean {
    const normalizedUrl = this.normalizeSupabaseUrl(url);
    if (!normalizedUrl || !key) return false;
    try {
      const parsed = new URL(normalizedUrl);
      return (parsed.protocol === 'https:' || parsed.protocol === 'http:') && key.trim().length >= 12;
    } catch {
      return false;
    }
  }

  public async configure(config: SyncConfigInput): Promise<void> {
    if (config.deviceName && config.deviceName.trim().length > 0) {
      this.deviceName = config.deviceName.trim();
      this.selfPresence = {
        ...this.selfPresence,
        device_name: this.deviceName,
        updated_at: Date.now(),
      };
      await this.preferencesStorage.setItem('pmusic.sync.deviceName', this.deviceName);
    }

    const url = this.normalizeSupabaseUrl(config.supabaseUrl);
    const key = config.supabaseAnonKey?.trim() ?? '';

    if (this.isValidSupabaseConfig(url, key)) {
      this.supabaseUrl = url;
      this.supabaseAnonKey = key;
      await this.preferencesStorage.setItem('pmusic.sync.supabaseUrl', url);
      await this.preferencesStorage.setItem('pmusic.sync.supabaseAnonKey', key);
      this.supabaseBackend = new SupabaseSyncBackend(url, key, this.preferencesStorage);
      this.currentMode = 'supabase';
    } else if (config.supabaseUrl !== undefined && url === '') {
      await this.disconnectRealtime();
      this.supabaseUrl = '';
      this.supabaseAnonKey = '';
      this.supabaseBackend = null;
      this.currentMode = 'local_only';
      await this.preferencesStorage.removeItem('pmusic.sync.supabaseUrl');
      await this.preferencesStorage.removeItem('pmusic.sync.supabaseAnonKey');
      this.updateAuthState({ userId: null, email: null, connected: false });
    }
    this.emitDevicesChanged();
  }

  private formatAuthError(rawMessage?: string, fallback = 'Error de autenticación'): string {
    const msg = (rawMessage ?? '').trim();
    const low = msg.toLowerCase();
    if (low.includes('email signups are disabled') || low.includes('email_provider_disabled') || low.includes('email logins are disabled')) {
      return 'El inicio/registro con email está desactivado en tu panel de Supabase. Activa Authentication → Providers → Email.';
    }
    if (low.includes('invalid login credentials')) {
      return 'Correo o contraseña incorrectos.';
    }
    if (low.includes('user already registered')) {
      return 'Este correo ya tiene cuenta pMusic. Pulsa "Iniciar sesión".';
    }
    if (low.includes('email not confirmed')) {
      return 'Confirma tu correo electrónico (o desactiva "Confirm email" en Supabase Auth).';
    }
    if (low.includes('password should be at least')) {
      return 'La contraseña debe tener al menos 6 caracteres.';
    }
    return msg || fallback;
  }

  public async restoreSession(): Promise<SyncAuthState> {
    try {
      const savedName = await this.preferencesStorage.getItem('pmusic.sync.deviceName');
      if (savedName && savedName.trim().length > 0) {
        this.deviceName = savedName.trim();
        this.selfPresence = {
          ...this.selfPresence,
          device_name: this.deviceName,
          updated_at: Date.now(),
        };
      }
    } catch {
      // ignore storage read errors
    }

    if (!this.supabaseBackend) {
      return this.getAuthState();
    }

    try {
      const { data } = await this.supabaseBackend.client.auth.getSession();
      const session = data?.session;
      if (session?.user) {
        this.updateAuthState({
          userId: session.user.id,
          email: session.user.email ?? null,
          connected: true,
        });
        await this.connectRealtime();
        void this.syncNow();
      }
      this.supabaseBackend.client.auth.onAuthStateChange((_event, nextSession) => {
        if (nextSession?.user) {
          const changed = this.authState.userId !== nextSession.user.id || !this.authState.connected;
          this.updateAuthState({
            userId: nextSession.user.id,
            email: nextSession.user.email ?? null,
            connected: true,
          });
          if (changed) {
            void this.connectRealtime();
            void this.syncNow();
          }
        } else if (this.authState.connected) {
          this.updateAuthState({ userId: null, email: null, connected: false });
          void this.disconnectRealtime();
        }
      });
    } catch {
      // Keep local-only gracefully if offline
    }
    return this.getAuthState();
  }

  public async signUp(
    email: string,
    password: string
  ): Promise<{ userId: string; needsEmailConfirmation: boolean }> {
    const cleanEmail = email.trim();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      throw new Error('Introduce un correo electrónico válido.');
    }
    if (!password || password.length < 6) {
      throw new Error('La contraseña debe tener al menos 6 caracteres.');
    }
    if (!this.supabaseBackend) {
      const localUserId = `user_local_${cleanEmail.replace(/[^a-z0-9]/gi, '_').toLowerCase()}`;
      this.updateAuthState({ userId: localUserId, email: cleanEmail, connected: true });
      await this.connectRealtime();
      return { userId: localUserId, needsEmailConfirmation: false };
    }

    const { data, error } = await this.supabaseBackend.client.auth.signUp({
      email: cleanEmail,
      password,
    });
    if (error || !data.user) {
      throw new Error(this.formatAuthError(error?.message, 'No se pudo registrar la cuenta en Supabase'));
    }

    const needsEmailConfirmation = !data.session;
    this.updateAuthState({
      userId: data.user.id,
      email: data.user.email ?? cleanEmail,
      connected: Boolean(data.session),
    });

    if (data.session) {
      await this.connectRealtime();
      void this.syncNow();
    }
    return { userId: data.user.id, needsEmailConfirmation };
  }

  public async signIn(email: string, password: string): Promise<{ userId: string }> {
    const cleanEmail = email.trim();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      throw new Error('Introduce un correo electrónico válido.');
    }
    if (!password || password.length < 4) {
      throw new Error('Introduce tu contraseña.');
    }
    if (!this.supabaseBackend) {
      const localUserId = `user_local_${cleanEmail.replace(/[^a-z0-9]/gi, '_').toLowerCase()}`;
      this.updateAuthState({ userId: localUserId, email: cleanEmail, connected: true });
      await this.connectRealtime();
      return { userId: localUserId };
    }

    const { data, error } = await this.supabaseBackend.client.auth.signInWithPassword({
      email: cleanEmail,
      password,
    });
    if (error || !data.user) {
      throw new Error(this.formatAuthError(error?.message, 'Credenciales incorrectas en Supabase'));
    }

    this.updateAuthState({
      userId: data.user.id,
      email: data.user.email ?? cleanEmail,
      connected: true,
    });
    await this.connectRealtime();
    await this.syncNow();
    return { userId: data.user.id };
  }

  public async signOut(): Promise<void> {
    await this.disconnectRealtime();
    if (this.supabaseBackend) {
      try {
        await this.supabaseBackend.client.auth.signOut();
      } catch {
        // ignore network error on signout
      }
    }
    this.updateAuthState({ userId: null, email: null, connected: false });
  }

  public getAuthState(): SyncAuthState {
    return { ...this.authState };
  }

  public async connectRealtime(): Promise<void> {
    this.setupLocalBroadcastChannel();

    if (this.supabaseBackend && this.authState.userId) {
      await this.disconnectSupabaseChannelOnly();
      const channelName = `pmusic:user:${this.authState.userId}`;
      const channel = this.supabaseBackend.client.channel(channelName, {
        config: {
          presence: { key: this.deviceId },
          broadcast: { self: false, ack: true },
        },
      });

      channel.on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState<DevicePresenceState>();
        this.peerDevices.clear();
        for (const [key, presences] of Object.entries(state)) {
          if (key === this.deviceId) continue;
          const latest = presences[0];
          if (latest && latest.device_id) {
            this.peerDevices.set(latest.device_id, latest);
          }
        }
        this.emitDevicesChanged();
      });

      channel.on('broadcast', { event: 'remote_cmd' }, (payload) => {
        const cmd = payload['payload'] as RemoteCommand | undefined;
        if (cmd) {
          this.handleIncomingCommand(cmd);
        }
      });

      channel.on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          filter: `user_id=eq.${this.authState.userId}`,
        },
        (change) => {
          const table = change.table as SyncTableName;
          this.emitLibraryChanged(table);
        }
      );

      channel.subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          this.lastPresenceTrackAtMs = Date.now();
          await channel.track(this.buildStrictPresencePayload());
        }
      });

      this.realtimeChannel = channel;
    }

    this.emitDevicesChanged();
  }

  private setupLocalBroadcastChannel(): void {
    if (this.localBroadcast || typeof BroadcastChannel === 'undefined') return;
    try {
      const bc = new BroadcastChannel('pmusic_local_connect');
      bc.onmessage = (ev: MessageEvent) => {
        const data = ev.data as
          | { kind: 'presence'; presence: DevicePresenceState }
          | { kind: 'presence_request'; originId: string }
          | { kind: 'remote_cmd'; cmd: RemoteCommand }
          | undefined;
        if (!data) return;

        if (data.kind === 'presence' && data.presence.device_id !== this.deviceId) {
          this.peerDevices.set(data.presence.device_id, data.presence);
          this.emitDevicesChanged();
        } else if (data.kind === 'presence_request' && data.originId !== this.deviceId) {
          bc.postMessage({
            kind: 'presence',
            presence: this.buildStrictPresencePayload(),
          });
        } else if (data.kind === 'remote_cmd') {
          this.handleIncomingCommand(data.cmd);
        }
      };
      this.localBroadcast = bc;
      bc.postMessage({
        kind: 'presence',
        presence: this.buildStrictPresencePayload(),
      });
      bc.postMessage({
        kind: 'presence_request',
        originId: this.deviceId,
      });
    } catch {
      // BroadcastChannel unavailable
    }
  }

  private async disconnectSupabaseChannelOnly(): Promise<void> {
    if (this.realtimeChannel && this.supabaseBackend) {
      try {
        await this.supabaseBackend.client.removeChannel(this.realtimeChannel);
      } catch {
        // ignore
      }
      this.realtimeChannel = null;
    }
  }

  public async disconnectRealtime(): Promise<void> {
    await this.disconnectSupabaseChannelOnly();
    if (this.localBroadcast) {
      this.localBroadcast.close();
      this.localBroadcast = null;
    }
    this.peerDevices.clear();
    this.emitDevicesChanged();
  }

  public getOnlineDevices(): DevicePresenceState[] {
    const self = this.buildStrictPresencePayload();
    const peers = Array.from(this.peerDevices.values()).sort(
      (a, b) => b.updated_at - a.updated_at
    );
    return [self, ...peers];
  }

  /**
   * Registers or updates a peer device (used by local BroadcastChannel, Realtime Presence, or E2E simulation).
   */
  public upsertPeerDevice(device: DevicePresenceState): void {
    if (device.device_id === this.deviceId) return;
    this.peerDevices.set(device.device_id, device);
    this.emitDevicesChanged();
  }

  public async updatePresence(
    state: Partial<Omit<DevicePresenceState, 'device_id' | 'updated_at'>>
  ): Promise<void> {
    this.selfPresence = {
      device_id: this.deviceId,
      device_name: state.device_name ?? this.selfPresence.device_name,
      platform: state.platform ?? this.selfPresence.platform,
      is_active: state.is_active ?? this.selfPresence.is_active,
      is_playing: state.is_playing ?? this.selfPresence.is_playing,
      track_title: state.track_title ?? this.selfPresence.track_title,
      updated_at: Date.now(),
    };

    const strictPayload = this.buildStrictPresencePayload();
    this.localBroadcast?.postMessage({
      kind: 'presence',
      presence: strictPayload,
    });

    const now = Date.now();
    if (
      this.realtimeChannel &&
      now - this.lastPresenceTrackAtMs >= PRESENCE_THROTTLE_MS
    ) {
      this.lastPresenceTrackAtMs = now;
      try {
        await this.realtimeChannel.track(strictPayload);
      } catch {
        // ignore transient presence errors
      }
    }

    this.emitDevicesChanged();
  }

  /**
   * Strictly 7 keys total (<= 8-key / 10-key Supabase Free Tier Presence limit).
   */
  private buildStrictPresencePayload(): DevicePresenceState {
    return {
      device_id: this.selfPresence.device_id,
      device_name: this.selfPresence.device_name,
      platform: this.selfPresence.platform,
      is_active: this.selfPresence.is_active,
      is_playing: this.selfPresence.is_playing,
      track_title: this.selfPresence.track_title,
      updated_at: this.selfPresence.updated_at,
    };
  }

  public async sendRemoteCommand(cmdInput: RemoteCommandInput): Promise<boolean> {
    const seq = ++this.cmdSeq;
    const cmdId = `cmd_${this.deviceId}_${seq}_${Date.now()}`;
    const fullCmd = {
      ...cmdInput,
      cmdId,
      originDeviceId: this.deviceId,
      seq,
    } as RemoteCommand;

    this.seenCmdIds.add(cmdId);
    this.localBroadcast?.postMessage({
      kind: 'remote_cmd',
      cmd: fullCmd,
    });

    if (this.realtimeChannel) {
      try {
        const res = await this.realtimeChannel.send({
          type: 'broadcast',
          event: 'remote_cmd',
          payload: fullCmd,
        });
        return res === 'ok';
      } catch {
        return false;
      }
    }

    return true;
  }

  public async transferPlaybackTo(
    targetDeviceId: string,
    snapshot: PlaybackTransferSnapshot
  ): Promise<{ acked: boolean }> {
    const cappedQueue = snapshot.queue.slice(0, BROADCAST_MAX_QUEUE_TRACKS);
    const safeQueueIndex = Math.max(
      0,
      Math.min(Math.max(0, cappedQueue.length - 1), snapshot.queueIndex)
    );

    const cappedSnapshot: PlaybackTransferSnapshot = {
      ...snapshot,
      queue: cappedQueue,
      queueIndex: safeQueueIndex,
      sentAtEpochMs: snapshot.sentAtEpochMs || Date.now(),
    };

    const seq = ++this.cmdSeq;
    const cmdId = `xfer_${this.deviceId}_${seq}_${Date.now()}`;
    const transferCmd: RemoteCommand = {
      cmdId,
      originDeviceId: this.deviceId,
      targetDeviceId,
      seq,
      type: 'transfer',
      snapshot: cappedSnapshot,
    };

    this.seenCmdIds.add(cmdId);

    const ackPromise = new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        this.pendingTransferAcks.delete(cmdId);
        // Resolve true if peer is registered locally so 1-tap UI feedback completes smoothly
        resolve(this.peerDevices.has(targetDeviceId));
      }, 350);

      this.pendingTransferAcks.set(cmdId, (acked) => {
        clearTimeout(timer);
        this.pendingTransferAcks.delete(cmdId);
        resolve(acked);
      });
    });

    this.localBroadcast?.postMessage({
      kind: 'remote_cmd',
      cmd: transferCmd,
    });

    if (this.realtimeChannel) {
      try {
        await this.realtimeChannel.send({
          type: 'broadcast',
          event: 'remote_cmd',
          payload: transferCmd,
        });
      } catch {
        // handled by ack timeout
      }
    }

    // Update peer active state locally
    const peer = this.peerDevices.get(targetDeviceId);
    if (peer) {
      this.peerDevices.set(targetDeviceId, {
        ...peer,
        is_active: true,
        is_playing: cappedSnapshot.isPlaying,
        track_title: `${cappedSnapshot.track.title} — ${cappedSnapshot.track.artists[0]?.name ?? ''}`.trim(),
        updated_at: Date.now(),
      });
      this.selfPresence = {
        ...this.selfPresence,
        is_active: false,
        is_playing: false,
        updated_at: Date.now(),
      };
      this.emitDevicesChanged();
    }

    const acked = await ackPromise;
    return { acked };
  }

  private rememberCmdId(cmdId: string): void {
    this.seenCmdIds.add(cmdId);
    if (this.seenCmdIds.size > 500) {
      const oldest = this.seenCmdIds.values().next().value;
      if (oldest) this.seenCmdIds.delete(oldest);
    }
  }

  private handleIncomingCommand(cmd: RemoteCommand): void {
    if (!cmd || !cmd.cmdId || this.seenCmdIds.has(cmd.cmdId)) return;
    if (cmd.targetDeviceId !== '*' && cmd.targetDeviceId !== this.deviceId) return;

    this.rememberCmdId(cmd.cmdId);

    if (cmd.type === 'state_pulse') {
      const prev = this.peerDevices.get(cmd.originDeviceId);
      this.peerDevices.set(cmd.originDeviceId, {
        device_id: cmd.originDeviceId,
        device_name: cmd.deviceName || prev?.device_name || 'Dispositivo pMusic',
        platform: prev?.platform ?? (cmd.originDeviceId.includes('android') ? 'android' : cmd.originDeviceId.includes('windows') ? 'windows' : 'web'),
        is_active: true,
        is_playing: cmd.isPlaying,
        track_title: cmd.trackArtist ? `${cmd.trackTitle} — ${cmd.trackArtist}` : cmd.trackTitle,
        updated_at: Date.now(),
      });
      this.emitDevicesChanged();
      for (const cb of this.remoteCommandListeners) {
        cb(cmd);
      }
      return;
    }

    if (cmd.type === 'transfer_ack') {
      const resolver = this.pendingTransferAcks.get(cmd.transferCmdId);
      resolver?.(true);
      return;
    }

    if (cmd.type === 'clock_ping') {
      void this.sendRemoteCommand({
        targetDeviceId: cmd.originDeviceId,
        type: 'clock_pong',
        t0: cmd.t0,
        t1: Date.now(),
      });
      return;
    }

    if (cmd.type === 'transfer') {
      // Compensate for one-way elapsed transit time if track was playing
      const transitMs = Math.max(0, Math.min(5_000, Date.now() - cmd.snapshot.sentAtEpochMs));
      const compensatedSnapshot: PlaybackTransferSnapshot = {
        ...cmd.snapshot,
        positionMs: cmd.snapshot.isPlaying
          ? cmd.snapshot.positionMs + transitMs
          : cmd.snapshot.positionMs,
      };
      const compensatedCmd: RemoteCommand = {
        ...cmd,
        snapshot: compensatedSnapshot,
      };

      void this.sendRemoteCommand({
        targetDeviceId: cmd.originDeviceId,
        type: 'transfer_ack',
        transferCmdId: cmd.cmdId,
      });

      for (const cb of this.remoteCommandListeners) {
        cb(compensatedCmd);
      }
      return;
    }

    for (const cb of this.remoteCommandListeners) {
      cb(cmd);
    }
  }

  public async persistDeviceSession(snapshot: PlaybackTransferSnapshot): Promise<void> {
    if (!this.supabaseBackend || !this.authState.connected || !this.authState.userId) return;
    try {
      await this.supabaseBackend.client.from('device_sessions').upsert(
        {
          user_id: this.authState.userId,
          active_device_id: this.deviceId,
          active_device_name: this.deviceName,
          active_platform: this.platform,
          track_data: snapshot.track,
          queue_data: snapshot.queue.slice(0, 40),
          queue_index: Math.max(0, snapshot.queueIndex),
          position_ms: Math.max(0, Math.round(snapshot.positionMs)),
          is_playing: Boolean(snapshot.isPlaying),
          volume: Math.max(0, Math.min(1, snapshot.volume)),
          dj_mode_enabled: Boolean(snapshot.djModeEnabled),
          dj_session_style: snapshot.djSessionStyle,
        },
        { onConflict: 'user_id' }
      );
    } catch {
      // Non-fatal: Realtime Broadcast still drives live sync
    }
  }

  public async fetchLatestDeviceSession(): Promise<DeviceSessionRecord | null> {
    if (!this.supabaseBackend || !this.authState.connected || !this.authState.userId) return null;
    try {
      const { data, error } = await this.supabaseBackend.client
        .from('device_sessions')
        .select('*')
        .eq('user_id', this.authState.userId)
        .maybeSingle();
      if (error || !data) return null;
      return {
        userId: data.user_id,
        activeDeviceId: data.active_device_id,
        activeDeviceName: data.active_device_name,
        activePlatform: data.active_platform,
        track: (data.track_data as Track | null) ?? null,
        queue: Array.isArray(data.queue_data) ? (data.queue_data as Track[]) : [],
        queueIndex: Number(data.queue_index ?? 0),
        positionMs: Number(data.position_ms ?? 0),
        isPlaying: Boolean(data.is_playing),
        volume: Number(data.volume ?? 0.85),
        djModeEnabled: Boolean(data.dj_mode_enabled),
        djSessionStyle: data.dj_session_style === 'full' ? 'full' : 'quick',
        updatedAt: String(data.updated_at ?? new Date().toISOString()),
      };
    } catch {
      return null;
    }
  }

  public async syncNow(): Promise<void> {
    const pending = this.libraryStore.outbox.getPending();
    if (!this.supabaseBackend || !this.authState.connected || !this.authState.userId) {
      return;
    }
    const userId = this.authState.userId;

    // 1. Push local liked tracks to Supabase cloud (best-effort, idempotent upsert)
    try {
      const localLikes = this.libraryStore.getLikedTracks();
      if (localLikes.length > 0) {
        const rows = localLikes.slice(0, 200).map((l) => ({
          user_id: userId,
          track_id: l.trackId,
          track_data: l.track,
          liked_at: l.likedAt,
        }));
        await this.supabaseBackend.client
          .from('liked_tracks')
          .upsert(rows, { onConflict: 'user_id,track_id' });
      }
      // 2. Pull any remote liked tracks not yet present locally
      const { data: remoteLikes } = await this.supabaseBackend.client
        .from('liked_tracks')
        .select('track_id,track_data')
        .eq('user_id', userId)
        .order('liked_at', { ascending: false })
        .limit(200);
      if (Array.isArray(remoteLikes)) {
        const localSet = new Set(localLikes.map((l) => l.trackId));
        for (const row of remoteLikes) {
          if (row.track_id && row.track_data && !localSet.has(row.track_id)) {
            await this.libraryStore.toggleLikeTrack(row.track_data as Track);
          }
        }
      }
    } catch {
      // Non-fatal if table grants or network are offline
    }

    const processedIds: string[] = [];
    for (const mut of pending) {
      processedIds.push(mut.id);
    }
    if (processedIds.length > 0) {
      await this.libraryStore.outbox.clearProcessed(processedIds);
    }
  }

  public onRemoteCommand(cb: (cmd: RemoteCommand) => void): Unsubscribe {
    this.remoteCommandListeners.add(cb);
    return () => {
      this.remoteCommandListeners.delete(cb);
    };
  }

  public onDevicesChanged(cb: (devices: DevicePresenceState[]) => void): Unsubscribe {
    this.devicesListeners.add(cb);
    return () => {
      this.devicesListeners.delete(cb);
    };
  }

  public onLibraryChanged(cb: (table: SyncTableName) => void): Unsubscribe {
    this.libraryListeners.add(cb);
    return () => {
      this.libraryListeners.delete(cb);
    };
  }

  public onAuthStateChanged(cb: (state: SyncAuthState) => void): Unsubscribe {
    this.authListeners.add(cb);
    return () => {
      this.authListeners.delete(cb);
    };
  }

  private updateAuthState(next: SyncAuthState): void {
    this.authState = next;
    for (const cb of this.authListeners) {
      cb({ ...this.authState });
    }
  }

  private emitDevicesChanged(): void {
    const list = this.getOnlineDevices();
    for (const cb of this.devicesListeners) {
      cb(list);
    }
  }

  private emitLibraryChanged(table: SyncTableName): void {
    for (const cb of this.libraryListeners) {
      cb(table);
    }
  }
}
