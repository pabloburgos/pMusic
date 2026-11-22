import { contextBridge, ipcRenderer } from 'electron';
import type {
  DiscordPresenceState,
  DiscordRpcStatus,
  NativeMediaAction,
} from '@pmusic/core';

contextBridge.exposeInMainWorld('pmusicDesktop', {
  runtime: 'electron' as const,
  getApiBaseUrl: (): Promise<string> => ipcRenderer.invoke('pmusic:get-api-base-url'),
  getAuthHeaders: (): Promise<Record<string, string>> =>
    ipcRenderer.invoke('pmusic:get-auth-headers'),
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
  onMediaShortcut: (cb: (action: NativeMediaAction) => void): (() => void) => {
    const handler = (_event: unknown, action: NativeMediaAction) => cb(action);
    ipcRenderer.on('pmusic:media-action', handler);
    return () => {
      ipcRenderer.removeListener('pmusic:media-action', handler);
    };
  },
});
