import { contextBridge, ipcRenderer } from 'electron';
import type {
  DiscordPresenceState,
  DiscordRpcStatus,
  NativeMediaAction,
  NativeMediaSessionState,
} from '@pmusic/core';

contextBridge.exposeInMainWorld('pmusicDesktop', {
  runtime: 'electron' as const,
  getApiBaseUrl: (): Promise<string> => ipcRenderer.invoke('pmusic:get-api-base-url'),
  getAuthHeaders: (): Promise<Record<string, string>> =>
    ipcRenderer.invoke('pmusic:get-auth-headers'),
  updateMediaSession: (state: NativeMediaSessionState): Promise<void> =>
    ipcRenderer.invoke('pmusic:update-media-session', state),
  updateDiscordPresence: (state: DiscordPresenceState): Promise<void> =>
    ipcRenderer.invoke('pmusic:update-discord', state),
  configureDiscordRpc: (clientId: string): Promise<DiscordRpcStatus> =>
    ipcRenderer.invoke('pmusic:configure-discord', clientId),
  reconnectDiscordRpc: (): Promise<DiscordRpcStatus> =>
    ipcRenderer.invoke('pmusic:reconnect-discord'),
  getDiscordRpcStatus: (): Promise<DiscordRpcStatus> =>
    ipcRenderer.invoke('pmusic:get-discord-status'),
  setTitleBarOverlay: (opts: {
    color?: string;
    symbolColor?: string;
    height?: number;
  }): Promise<void> => ipcRenderer.invoke('pmusic:set-titlebar-overlay', opts),
  toggleFullscreen: (): Promise<boolean> => ipcRenderer.invoke('pmusic:toggle-fullscreen'),
  getFullscreen: (): Promise<boolean> => ipcRenderer.invoke('pmusic:get-fullscreen'),
  onFullscreenChange: (cb: (isFs: boolean) => void): (() => void) => {
    const handler = (_event: unknown, isFs: boolean) => cb(Boolean(isFs));
    ipcRenderer.on('pmusic:fullscreen-changed', handler);
    return () => {
      ipcRenderer.removeListener('pmusic:fullscreen-changed', handler);
    };
  },
  onWindowVisibilityChanged: (cb: (visible: boolean) => void): (() => void) => {
    const handler = (_event: unknown, visible: boolean) => cb(Boolean(visible));
    ipcRenderer.on('pmusic:window-visibility', handler);
    return () => {
      ipcRenderer.removeListener('pmusic:window-visibility', handler);
    };
  },
  openExternalUrl: (url: string): Promise<void> =>
    ipcRenderer.invoke('pmusic:open-external-url', url),
  getOAuthRedirectUrl: (): Promise<string> =>
    ipcRenderer.invoke('pmusic:get-oauth-redirect-url'),
  consumePendingAuthCallback: (): Promise<string | null> =>
    ipcRenderer.invoke('pmusic:consume-pending-auth-callback'),
  onAuthCallback: (cb: (url: string) => void): (() => void) => {
    const handler = (_event: unknown, url: string) => cb(url);
    ipcRenderer.on('pmusic:auth-callback', handler);
    return () => {
      ipcRenderer.removeListener('pmusic:auth-callback', handler);
    };
  },
  onMediaShortcut: (cb: (action: NativeMediaAction) => void): (() => void) => {
    const handler = (_event: unknown, action: NativeMediaAction) => cb(action);
    ipcRenderer.on('pmusic:media-action', handler);
    return () => {
      ipcRenderer.removeListener('pmusic:media-action', handler);
    };
  },
  vaultGet: (key: string): Promise<string | null> => ipcRenderer.invoke('pmusic:vault-get', key),
  vaultSet: (key: string, value: string): Promise<void> =>
    ipcRenderer.invoke('pmusic:vault-set', key, value),
  vaultRemove: (key: string): Promise<void> => ipcRenderer.invoke('pmusic:vault-remove', key),
  readPrefsFile: (): Promise<string | null> => ipcRenderer.invoke('pmusic:read-prefs-file'),
  writePrefsFile: (jsonText: string): Promise<void> =>
    ipcRenderer.invoke('pmusic:write-prefs-file', jsonText),
  clearAuthState: (): Promise<void> => ipcRenderer.invoke('pmusic:clear-auth-state'),
});
