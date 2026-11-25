import type {
  AudioStreamQuality,
  DiscordPresenceState,
  DiscordRpcStatus,
  IOfflineStorageBridge,
  IPlatformBridge,
  IPreferencesStorageBridge,
  NativeFetchRequest,
  NativeFetchResponse,
  NativeMediaAction,
  NativeMediaSessionState,
  OfflineAudioEntry,
  OfflineAudioSaveResult,
  PlatformRuntime,
  Unsubscribe,
} from '@pmusic/core';
import { createDefaultPreferencesStorage } from '@pmusic/sync';

interface StoredOfflineBlobRecord {
  trackId: string;
  mimeType: string;
  sizeBytes: number;
  data: ArrayBuffer;
}

interface ElectronDesktopWindowBridge {
  runtime?: 'electron';
  getApiBaseUrl?: () => Promise<string>;
  getAuthHeaders?: () => Promise<Record<string, string>>;
  updateMediaSession?: (state: NativeMediaSessionState) => Promise<void>;
  updateDiscordPresence?: (state: DiscordPresenceState) => Promise<void>;
  configureDiscordRpc?: (clientId: string) => Promise<DiscordRpcStatus>;
  reconnectDiscordRpc?: () => Promise<DiscordRpcStatus>;
  getDiscordRpcStatus?: () => Promise<DiscordRpcStatus>;
  setTitleBarOverlay?: (opts: {
    color?: string;
    symbolColor?: string;
    height?: number;
  }) => Promise<void>;
  toggleFullscreen?: () => Promise<boolean>;
  getFullscreen?: () => Promise<boolean>;
  onFullscreenChange?: (cb: (isFs: boolean) => void) => Unsubscribe;
  onMediaShortcut?: (cb: (action: NativeMediaAction) => void) => Unsubscribe;
  vaultGet?: (key: string) => Promise<string | null>;
  vaultSet?: (key: string, value: string) => Promise<void>;
  vaultRemove?: (key: string) => Promise<void>;
}

function createElectronVaultPreferencesStorage(
  fallback: IPreferencesStorageBridge,
  desktopBridge?: ElectronDesktopWindowBridge
): IPreferencesStorageBridge {
  if (!desktopBridge?.vaultGet) return fallback;
  return {
    async getItem(key: string): Promise<string | null> {
      const localVal = await fallback.getItem(key);
      if (localVal !== null) return localVal;
      try {
        const diskVal = await desktopBridge.vaultGet?.(key);
        if (typeof diskVal === 'string') {
          await fallback.setItem(key, diskVal);
          return diskVal;
        }
      } catch {
        // ignore vault read error
      }
      return null;
    },
    async setItem(key: string, value: string): Promise<void> {
      await fallback.setItem(key, value);
      try {
        await desktopBridge.vaultSet?.(key, value);
      } catch {
        // ignore vault write error
      }
    },
    async removeItem(key: string): Promise<void> {
      await fallback.removeItem(key);
      try {
        await desktopBridge.vaultRemove?.(key);
      } catch {
        // ignore vault remove error
      }
    },
  };
}

export function isElectronDesktopRuntime(): boolean {
  if (typeof window === 'undefined') return false;
  const win = window as unknown as { pmusicDesktop?: ElectronDesktopWindowBridge };
  return win.pmusicDesktop?.runtime === 'electron';
}

export async function setDesktopTitleBarOverlay(opts: {
  color?: string;
  symbolColor?: string;
  height?: number;
}): Promise<void> {
  if (typeof window === 'undefined') return;
  const win = window as unknown as { pmusicDesktop?: ElectronDesktopWindowBridge };
  await win.pmusicDesktop?.setTitleBarOverlay?.(opts);
}

let androidFullscreenState = false;
const androidFsListeners = new Set<(isFs: boolean) => void>();

export async function toggleRealFullscreen(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  const win = window as unknown as {
    pmusicDesktop?: ElectronDesktopWindowBridge;
    PMusicNative?: { setImmersiveFullscreen?: (enabled: boolean) => void };
  };
  if (win.pmusicDesktop?.toggleFullscreen) {
    return win.pmusicDesktop.toggleFullscreen();
  }
  if (win.PMusicNative?.setImmersiveFullscreen) {
    androidFullscreenState = !androidFullscreenState;
    try {
      win.PMusicNative.setImmersiveFullscreen(androidFullscreenState);
    } catch {
      // ignore native toggle error
    }
    for (const cb of androidFsListeners) cb(androidFullscreenState);
    return androidFullscreenState;
  }
  if (typeof document !== 'undefined') {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen?.();
        return false;
      }
      if (typeof document.documentElement?.requestFullscreen === 'function') {
        await document.documentElement.requestFullscreen();
        return Boolean(document.fullscreenElement);
      }
    } catch {
      return Boolean(document.fullscreenElement);
    }
  }
  return false;
}

export async function getRealFullscreen(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  const win = window as unknown as {
    pmusicDesktop?: ElectronDesktopWindowBridge;
    PMusicNative?: { setImmersiveFullscreen?: (enabled: boolean) => void };
  };
  if (win.pmusicDesktop?.getFullscreen) {
    return win.pmusicDesktop.getFullscreen();
  }
  if (win.PMusicNative?.setImmersiveFullscreen) {
    return androidFullscreenState;
  }
  if (typeof document !== 'undefined') {
    return Boolean(document.fullscreenElement);
  }
  return false;
}

export function onRealFullscreenChange(cb: (isFs: boolean) => void): Unsubscribe {
  if (typeof window === 'undefined') return () => {};
  const win = window as unknown as {
    pmusicDesktop?: ElectronDesktopWindowBridge;
    PMusicNative?: { setImmersiveFullscreen?: (enabled: boolean) => void };
  };
  if (win.pmusicDesktop?.onFullscreenChange) {
    return win.pmusicDesktop.onFullscreenChange(cb);
  }
  if (win.PMusicNative?.setImmersiveFullscreen) {
    androidFsListeners.add(cb);
    return () => {
      androidFsListeners.delete(cb);
    };
  }
  if (typeof document !== 'undefined') {
    const handler = () => cb(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }
  return () => {};
}

class BrowserOfflineStorageBridge implements IOfflineStorageBridge {
  private readonly memoryStore = new Map<string, StoredOfflineBlobRecord>();
  private readonly objectUrls = new Map<string, string>();
  private readonly indexStorageKey = 'pmusic.offline.entries';
  private readonly prefs: IPreferencesStorageBridge;

  public constructor(prefs: IPreferencesStorageBridge) {
    this.prefs = prefs;
  }

  public async saveAudio(
    trackId: string,
    data: ArrayBuffer,
    mimeType = 'audio/wav'
  ): Promise<OfflineAudioSaveResult> {
    const sizeBytes = data.byteLength;
    this.memoryStore.set(trackId, {
      trackId,
      mimeType,
      sizeBytes,
      data,
    });

    const existingUrl = this.objectUrls.get(trackId);
    if (existingUrl && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
      URL.revokeObjectURL(existingUrl);
    }

    let uri = `/api/stream/${encodeURIComponent(trackId)}?offline=1`;
    if (typeof Blob !== 'undefined' && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
      const blob = new Blob([data], { type: mimeType });
      uri = URL.createObjectURL(blob);
      this.objectUrls.set(trackId, uri);
    }

    const entries = await this.listOfflineIds();
    const filtered = entries.filter((e) => e.trackId !== trackId);
    filtered.push({ trackId, sizeBytes });
    await this.prefs.setItem(this.indexStorageKey, JSON.stringify(filtered));

    return { uri, sizeBytes };
  }

  public async getAudioUrl(trackId: string): Promise<string | null> {
    const cachedUrl = this.objectUrls.get(trackId);
    if (cachedUrl) return cachedUrl;
    const entries = await this.listOfflineIds();
    if (entries.some((e) => e.trackId === trackId)) {
      return `/api/stream/${encodeURIComponent(trackId)}?offline=1`;
    }
    return null;
  }

  public async deleteAudio(trackId: string): Promise<void> {
    this.memoryStore.delete(trackId);
    const existingUrl = this.objectUrls.get(trackId);
    if (existingUrl && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
      URL.revokeObjectURL(existingUrl);
    }
    this.objectUrls.delete(trackId);

    const entries = await this.listOfflineIds();
    const filtered = entries.filter((e) => e.trackId !== trackId);
    await this.prefs.setItem(this.indexStorageKey, JSON.stringify(filtered));
  }

  public async listOfflineIds(): Promise<OfflineAudioEntry[]> {
    const raw = await this.prefs.getItem(this.indexStorageKey);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as OfflineAudioEntry[]) : [];
    } catch {
      return [];
    }
  }

  public async clearAll(): Promise<void> {
    this.memoryStore.clear();
    if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
      for (const u of this.objectUrls.values()) {
        URL.revokeObjectURL(u);
      }
    }
    this.objectUrls.clear();
    await this.prefs.removeItem(this.indexStorageKey);
  }
}

export function createPlatformBridge(): IPlatformBridge {
  const win = typeof window !== 'undefined' ? (window as unknown as {
    pmusicDesktop?: ElectronDesktopWindowBridge;
    Capacitor?: { isNativePlatform?: () => boolean };
  }) : undefined;

  const desktopBridge = win?.pmusicDesktop;
  const isElectron = Boolean(desktopBridge);
  const isAndroid = Boolean(win?.Capacitor?.isNativePlatform?.());

  const runtime: PlatformRuntime = isElectron
    ? 'electron'
    : isAndroid
      ? 'android'
      : 'web';

  const preferencesStorage = createElectronVaultPreferencesStorage(
    createDefaultPreferencesStorage(),
    desktopBridge
  );
  const offlineStorage = new BrowserOfflineStorageBridge(preferencesStorage);

  return {
    runtime,
    offlineStorage,
    preferencesStorage,
    async getApiBaseUrl(): Promise<string> {
      if (desktopBridge?.getApiBaseUrl) {
        return desktopBridge.getApiBaseUrl();
      }
      return '';
    },
    async getAuthHeaders(): Promise<Record<string, string>> {
      if (desktopBridge?.getAuthHeaders) {
        return desktopBridge.getAuthHeaders();
      }
      return {};
    },
    async buildStreamUrl(videoId: string, quality: AudioStreamQuality = 'high'): Promise<string> {
      const offlineUrl = await offlineStorage.getAudioUrl(videoId);
      if (offlineUrl) return offlineUrl;
      let base = desktopBridge?.getApiBaseUrl ? await desktopBridge.getApiBaseUrl() : '';
      if (!base && typeof window !== 'undefined') {
        const nativeBridge = (window as unknown as { PMusicNative?: { getStreamBaseUrl?: () => string } }).PMusicNative;
        const nativeBase = nativeBridge?.getStreamBaseUrl?.();
        if (typeof nativeBase === 'string' && nativeBase.startsWith('http://127.0.0.1:')) {
          base = nativeBase;
        }
      }
      const authHeaders = desktopBridge?.getAuthHeaders ? await desktopBridge.getAuthHeaders() : {};
      const token = authHeaders['X-PMusic-Token'] ?? authHeaders['x-pmusic-token'];
      const tokenQuery = token ? `&token=${encodeURIComponent(token)}` : '';
      return `${base.replace(/\/+$/, '')}/api/stream/${encodeURIComponent(videoId)}?quality=${quality}${tokenQuery}`;
    },
    async nativeFetch(url: string, init?: NativeFetchRequest): Promise<NativeFetchResponse> {
      const res = await fetch(url, {
        method: init?.method ?? 'GET',
        headers: init?.headers,
        body: init?.body,
        signal: init?.signal,
      });
      const headers: Record<string, string> = {};
      res.headers.forEach((v, k) => {
        headers[k] = v;
      });
      const text = await res.text();
      return {
        status: res.status,
        headers,
        text,
        url: res.url,
      };
    },
    async updateDiscordPresence(state: DiscordPresenceState): Promise<void> {
      if (desktopBridge?.updateDiscordPresence) {
        await desktopBridge.updateDiscordPresence(state);
      }
    },
    async configureDiscordRpc(clientId: string): Promise<DiscordRpcStatus> {
      if (desktopBridge?.configureDiscordRpc) {
        return desktopBridge.configureDiscordRpc(clientId);
      }
      return {
        connected: false,
        status: 'web_only',
        clientId,
      };
    },
    async reconnectDiscordRpc(): Promise<DiscordRpcStatus> {
      if (desktopBridge?.reconnectDiscordRpc) {
        return desktopBridge.reconnectDiscordRpc();
      }
      return {
        connected: false,
        status: 'web_only',
        clientId: '',
      };
    },
    async getDiscordRpcStatus(): Promise<DiscordRpcStatus> {
      if (desktopBridge?.getDiscordRpcStatus) {
        return desktopBridge.getDiscordRpcStatus();
      }
      return {
        connected: false,
        status: 'web_only',
        clientId: '',
      };
    },
    async updateNativeMediaSession(state: NativeMediaSessionState): Promise<void> {
      if (desktopBridge?.updateMediaSession) {
        await desktopBridge.updateMediaSession(state);
      }
      if (typeof window !== 'undefined') {
        const androidNative = (window as unknown as {
          PMusicNative?: { updateMediaSession?: (json: string) => void };
        }).PMusicNative;
        if (androidNative?.updateMediaSession) {
          try {
            androidNative.updateMediaSession(
              JSON.stringify({
                trackId: state.track?.id ?? '',
                title: state.track?.title ?? 'pMusic',
                artist: state.track?.artists.map((a) => a.name).join(', ') ?? '',
                album: state.track?.album?.name ?? 'pMusic',
                artworkUrl: state.track?.thumbnailHighUrl ?? state.track?.thumbnailUrl ?? '',
                isPlaying: state.isPlaying,
                positionMs: Math.round(state.positionSec * 1000),
                durationMs: Math.round(Math.max(1, state.durationSec) * 1000),
              })
            );
          } catch {
            // ignore Android native media session bridge errors
          }
        }
      }
    },
    onNativeMediaAction(cb: (action: NativeMediaAction) => void): Unsubscribe {
      const desktopUnsub = desktopBridge?.onMediaShortcut ? desktopBridge.onMediaShortcut(cb) : null;
      if (typeof window === 'undefined') {
        return desktopUnsub ?? (() => {});
      }
      const win = window as unknown as {
        __pmusicMediaActionListeners?: Set<(action: NativeMediaAction) => void>;
        __pmusicNativeMediaAction?: (type: string, seekTimeSec?: number) => void;
      };
      if (!win.__pmusicMediaActionListeners) {
        win.__pmusicMediaActionListeners = new Set();
      }
      win.__pmusicMediaActionListeners.add(cb);
      win.__pmusicNativeMediaAction = (type: string, seekTimeSec?: number) => {
        const action: NativeMediaAction = {
          type: (type as NativeMediaAction['type']) || 'toggle',
          ...(typeof seekTimeSec === 'number' && seekTimeSec >= 0 ? { seekTimeSec } : {}),
        };
        for (const listener of win.__pmusicMediaActionListeners ?? []) {
          listener(action);
        }
      };
      return () => {
        desktopUnsub?.();
        win.__pmusicMediaActionListeners?.delete(cb);
      };
    },
  };
}

export const defaultPlatformBridge = createPlatformBridge();
