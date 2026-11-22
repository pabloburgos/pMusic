import { Capacitor, registerPlugin } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Preferences } from '@capacitor/preferences';
import { StatusBar, Style } from '@capacitor/status-bar';
import type {
  IOfflineStorageBridge,
  IPreferencesStorageBridge,
  NativeMediaSessionState,
  OfflineAudioEntry,
  OfflineAudioSaveResult,
} from '@pmusic/core';

export interface PMusicMediaNativePlugin {
  updateSession(options: {
    title: string;
    artist: string;
    album: string;
    artworkUrl: string;
    isPlaying: boolean;
    positionMs: number;
    durationMs: number;
  }): Promise<void>;
  getProxyPort(): Promise<{ port: number; token: string }>;
}

export const PMusicMedia = registerPlugin<PMusicMediaNativePlugin>('PMusicMedia');

export async function configureAndroidStatusBar(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await StatusBar.setStyle({ style: Style.Dark });
    await StatusBar.setBackgroundColor({ color: '#06060A' });
  } catch {
    // ignore on unsupported devices
  }
}

export const androidPreferencesStorage: IPreferencesStorageBridge = {
  async getItem(key: string): Promise<string | null> {
    const { value } = await Preferences.get({ key });
    return value ?? null;
  },
  async setItem(key: string, value: string): Promise<void> {
    await Preferences.set({ key, value });
  },
  async removeItem(key: string): Promise<void> {
    await Preferences.remove({ key });
  },
};

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return typeof btoa === 'function' ? btoa(binary) : '';
}

export const androidOfflineStorage: IOfflineStorageBridge = {
  async saveAudio(
    trackId: string,
    data: ArrayBuffer,
    _mimeType: string
  ): Promise<OfflineAudioSaveResult> {
    const path = `pmusic_offline/${trackId}.wav`;
    const base64Data = arrayBufferToBase64(data);
    const saved = await Filesystem.writeFile({
      path,
      data: base64Data,
      directory: Directory.Data,
      recursive: true,
    });
    const list = await this.listOfflineIds();
    const updated = [...list.filter((e) => e.trackId !== trackId), { trackId, sizeBytes: data.byteLength }];
    await Preferences.set({ key: 'pmusic.android.offline', value: JSON.stringify(updated) });
    return {
      uri: Capacitor.convertFileSrc(saved.uri),
      sizeBytes: data.byteLength,
    };
  },
  async getAudioUrl(trackId: string): Promise<string | null> {
    try {
      const uriRes = await Filesystem.getUri({
        path: `pmusic_offline/${trackId}.wav`,
        directory: Directory.Data,
      });
      return Capacitor.convertFileSrc(uriRes.uri);
    } catch {
      return null;
    }
  },
  async deleteAudio(trackId: string): Promise<void> {
    try {
      await Filesystem.deleteFile({
        path: `pmusic_offline/${trackId}.wav`,
        directory: Directory.Data,
      });
    } catch {
      // ignore
    }
    const list = await this.listOfflineIds();
    await Preferences.set({
      key: 'pmusic.android.offline',
      value: JSON.stringify(list.filter((e) => e.trackId !== trackId)),
    });
  },
  async listOfflineIds(): Promise<OfflineAudioEntry[]> {
    const { value } = await Preferences.get({ key: 'pmusic.android.offline' });
    if (!value) return [];
    try {
      return JSON.parse(value) as OfflineAudioEntry[];
    } catch {
      return [];
    }
  },
  async clearAll(): Promise<void> {
    try {
      await Filesystem.rmdir({
        path: 'pmusic_offline',
        directory: Directory.Data,
        recursive: true,
      });
    } catch {
      // ignore
    }
    await Preferences.remove({ key: 'pmusic.android.offline' });
  },
};

export async function syncAndroidMediaSession(state: NativeMediaSessionState): Promise<void> {
  if (!Capacitor.isNativePlatform() || !state.track) return;
  try {
    await PMusicMedia.updateSession({
      title: state.track.title,
      artist: state.track.artists.map((a) => a.name).join(', '),
      album: state.track.album?.name ?? 'pMusic',
      artworkUrl: state.track.thumbnailUrl,
      isPlaying: state.isPlaying,
      positionMs: Math.round(state.positionSec * 1000),
      durationMs: Math.round(state.durationSec * 1000),
    });
  } catch {
    // ignore
  }
}
