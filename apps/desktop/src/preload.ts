import { contextBridge, ipcRenderer } from 'electron';
import type { DiscordPresenceState, NativeMediaAction } from '@pmusic/core';

contextBridge.exposeInMainWorld('pmusicDesktop', {
  runtime: 'electron' as const,
  getApiBaseUrl: (): Promise<string> => ipcRenderer.invoke('pmusic:get-api-base-url'),
  getAuthHeaders: (): Promise<Record<string, string>> =>
    ipcRenderer.invoke('pmusic:get-auth-headers'),
  updateDiscordPresence: (state: DiscordPresenceState): Promise<void> =>
    ipcRenderer.invoke('pmusic:update-discord', state),
  onMediaShortcut: (cb: (action: NativeMediaAction) => void): (() => void) => {
    const handler = (_event: unknown, action: NativeMediaAction) => cb(action);
    ipcRenderer.on('pmusic:media-action', handler);
    return () => {
      ipcRenderer.removeListener('pmusic:media-action', handler);
    };
  },
});
