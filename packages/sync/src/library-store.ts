import type {
  ArtistAffinityRecord,
  DeviceSessionRecord,
  IPreferencesStorageBridge,
  LikedTrackRecord,
  PlayHistoryRecord,
  PlaylistRecord,
  PlaylistRecordSource,
  SyncTableName,
  Track,
  Unsubscribe,
} from '@pmusic/core';

export interface OutboxMutation {
  id: string;
  table: SyncTableName;
  action: 'upsert' | 'delete';
  payload: unknown;
  createdAtMs: number;
}

const STORAGE_KEYS = {
  playlists: 'pmusic.lib.playlists',
  liked: 'pmusic.lib.liked',
  history: 'pmusic.lib.history',
  affinity: 'pmusic.lib.affinity',
  session: 'pmusic.lib.session',
  outbox: 'pmusic.lib.outbox',
} as const;

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function generateUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function createDefaultPreferencesStorage(): IPreferencesStorageBridge {
  const fallbackMap = new Map<string, string>();
  return {
    async getItem(key: string): Promise<string | null> {
      try {
        if (typeof localStorage !== 'undefined') {
          return localStorage.getItem(key);
        }
      } catch {
        // fallback to in-memory
      }
      return fallbackMap.get(key) ?? null;
    },
    async setItem(key: string, value: string): Promise<void> {
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(key, value);
          return;
        }
      } catch {
        // fallback to in-memory
      }
      fallbackMap.set(key, value);
    },
    async removeItem(key: string): Promise<void> {
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.removeItem(key);
          return;
        }
      } catch {
        // fallback
      }
      fallbackMap.delete(key);
    },
  };
}

export class OfflineOutbox {
  private readonly storage: IPreferencesStorageBridge;
  private queue: OutboxMutation[] = [];

  public constructor(storage: IPreferencesStorageBridge = createDefaultPreferencesStorage()) {
    this.storage = storage;
  }

  public async hydrate(): Promise<void> {
    const raw = await this.storage.getItem(STORAGE_KEYS.outbox);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        this.queue = parsed as OutboxMutation[];
      }
    } catch {
      this.queue = [];
    }
  }

  public async enqueue(
    table: SyncTableName,
    action: 'upsert' | 'delete',
    payload: unknown
  ): Promise<void> {
    const entry: OutboxMutation = {
      id: `mut_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      table,
      action,
      payload,
      createdAtMs: Date.now(),
    };
    this.queue.push(entry);
    await this.persist();
  }

  public getPending(): OutboxMutation[] {
    return [...this.queue];
  }

  public async clearProcessed(ids: readonly string[]): Promise<void> {
    const idSet = new Set(ids);
    this.queue = this.queue.filter((m) => !idSet.has(m.id));
    await this.persist();
  }

  private async persist(): Promise<void> {
    await this.storage.setItem(STORAGE_KEYS.outbox, JSON.stringify(this.queue));
  }
}

export class LibraryStore {
  private readonly storage: IPreferencesStorageBridge;
  public readonly outbox: OfflineOutbox;

  private playlists: PlaylistRecord[] = [];
  private likedTracks: LikedTrackRecord[] = [];
  private playHistory: PlayHistoryRecord[] = [];
  private affinities: ArtistAffinityRecord[] = [];
  private deviceSession: DeviceSessionRecord | null = null;
  private readonly tableListeners = new Set<(table: SyncTableName) => void>();

  public constructor(storage: IPreferencesStorageBridge = createDefaultPreferencesStorage()) {
    this.storage = storage;
    this.outbox = new OfflineOutbox(storage);
  }

  public async hydrate(): Promise<void> {
    await this.outbox.hydrate();
    const [rawPlaylists, rawLiked, rawHistory, rawAffinity, rawSession] = await Promise.all([
      this.storage.getItem(STORAGE_KEYS.playlists),
      this.storage.getItem(STORAGE_KEYS.liked),
      this.storage.getItem(STORAGE_KEYS.history),
      this.storage.getItem(STORAGE_KEYS.affinity),
      this.storage.getItem(STORAGE_KEYS.session),
    ]);

    this.playlists = this.safeParseArray<PlaylistRecord>(rawPlaylists);
    this.likedTracks = this.safeParseArray<LikedTrackRecord>(rawLiked);
    this.playHistory = this.safeParseArray<PlayHistoryRecord>(rawHistory);
    this.affinities = this.safeParseArray<ArtistAffinityRecord>(rawAffinity);
    if (rawSession) {
      try {
        this.deviceSession = JSON.parse(rawSession) as DeviceSessionRecord;
      } catch {
        this.deviceSession = null;
      }
    }
  }

  public getPlaylists(): PlaylistRecord[] {
    return [...this.playlists];
  }

  public async ensureUuidPlaylistIds(): Promise<boolean> {
    let changed = false;
    this.playlists = this.playlists.map((pl) => {
      if (UUID_RE.test(pl.id)) return pl;
      changed = true;
      return { ...pl, id: generateUuid() };
    });
    if (changed) {
      await this.storage.setItem(STORAGE_KEYS.playlists, JSON.stringify(this.playlists));
      this.emitTableChanged('playlists');
    }
    return changed;
  }

  public async upsertRemotePlaylist(remote: {
    id: string;
    name: string;
    description?: string;
    coverUrl?: string;
    source?: PlaylistRecordSource;
    sourceUrl?: string;
    tracks: Track[];
    createdAt?: string;
    updatedAt?: string;
  }): Promise<PlaylistRecord> {
    const normRemoteName = remote.name.trim().toLowerCase();
    const matchIdx = this.playlists.findIndex(
      (p) =>
        p.id === remote.id ||
        (normRemoteName.length > 0 && p.name.trim().toLowerCase() === normRemoteName)
    );
    const nowIso = new Date().toISOString();
    const existing = matchIdx >= 0 ? this.playlists[matchIdx]! : null;
    const record: PlaylistRecord = {
      id: remote.id,
      name: remote.name.trim() || existing?.name || 'Playlist',
      description: remote.description ?? existing?.description ?? '',
      coverUrl:
        remote.coverUrl ??
        remote.tracks[0]?.thumbnailUrl ??
        existing?.coverUrl,
      source: remote.source ?? existing?.source ?? 'local',
      sourceUrl: remote.sourceUrl ?? existing?.sourceUrl,
      tracks: [...remote.tracks],
      createdAt: remote.createdAt ?? existing?.createdAt ?? nowIso,
      updatedAt: remote.updatedAt ?? existing?.updatedAt ?? nowIso,
    };

    if (matchIdx >= 0) {
      this.playlists = this.playlists.map((p, idx) => (idx === matchIdx ? record : p));
    } else {
      this.playlists = [record, ...this.playlists];
    }
    await this.storage.setItem(STORAGE_KEYS.playlists, JSON.stringify(this.playlists));
    this.emitTableChanged('playlists');
    return record;
  }

  public async upsertRemoteLikedTrack(rec: LikedTrackRecord): Promise<void> {
    if (this.isTrackLiked(rec.trackId)) return;
    this.likedTracks = [rec, ...this.likedTracks];
    await this.storage.setItem(STORAGE_KEYS.liked, JSON.stringify(this.likedTracks));
    this.emitTableChanged('liked_tracks');
  }

  public async createPlaylist(input: {
    name: string;
    description?: string;
    coverUrl?: string;
    source?: PlaylistRecordSource;
    sourceUrl?: string;
    tracks?: Track[];
  }): Promise<PlaylistRecord> {
    const nowIso = new Date().toISOString();
    const record: PlaylistRecord = {
      id: generateUuid(),
      name: input.name.trim() || 'Nueva playlist',
      description: input.description?.trim() ?? '',
      coverUrl: input.coverUrl ?? input.tracks?.[0]?.thumbnailUrl,
      source: input.source ?? 'local',
      sourceUrl: input.sourceUrl,
      tracks: input.tracks ? [...input.tracks] : [],
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    this.playlists = [record, ...this.playlists];
    await this.storage.setItem(STORAGE_KEYS.playlists, JSON.stringify(this.playlists));
    await this.outbox.enqueue('playlists', 'upsert', record);
    this.emitTableChanged('playlists');
    return record;
  }

  public async updatePlaylist(
    playlistId: string,
    patch: Partial<Pick<PlaylistRecord, 'name' | 'description' | 'coverUrl' | 'tracks'>>
  ): Promise<PlaylistRecord | null> {
    const idx = this.playlists.findIndex((p) => p.id === playlistId);
    if (idx === -1) return null;
    const current = this.playlists[idx]!;
    const updated: PlaylistRecord = {
      ...current,
      ...(patch.name !== undefined ? { name: patch.name.trim() || current.name } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.coverUrl !== undefined ? { coverUrl: patch.coverUrl } : {}),
      ...(patch.tracks !== undefined ? { tracks: [...patch.tracks] } : {}),
      updatedAt: new Date().toISOString(),
    };
    this.playlists[idx] = updated;
    await this.storage.setItem(STORAGE_KEYS.playlists, JSON.stringify(this.playlists));
    await this.outbox.enqueue('playlists', 'upsert', updated);
    this.emitTableChanged('playlists');
    return updated;
  }

  public async deletePlaylist(playlistId: string): Promise<void> {
    this.playlists = this.playlists.filter((p) => p.id !== playlistId);
    await this.storage.setItem(STORAGE_KEYS.playlists, JSON.stringify(this.playlists));
    await this.outbox.enqueue('playlists', 'delete', { id: playlistId });
    this.emitTableChanged('playlists');
  }

  public async addTrackToPlaylist(playlistId: string, track: Track): Promise<PlaylistRecord | null> {
    const pl = this.playlists.find((p) => p.id === playlistId);
    if (!pl) return null;
    if (pl.tracks.some((t) => t.id === track.id)) return pl;
    return this.updatePlaylist(playlistId, {
      tracks: [...pl.tracks, track],
      coverUrl: pl.coverUrl ?? track.thumbnailUrl,
    });
  }

  public async removeTrackFromPlaylist(
    playlistId: string,
    trackId: string
  ): Promise<PlaylistRecord | null> {
    const pl = this.playlists.find((p) => p.id === playlistId);
    if (!pl) return null;
    const filtered = pl.tracks.filter((t) => t.id !== trackId);
    if (filtered.length === pl.tracks.length) return pl;
    return this.updatePlaylist(playlistId, {
      tracks: filtered,
      coverUrl: filtered[0]?.thumbnailUrl,
    });
  }

  public async reorderPlaylistTrack(
    playlistId: string,
    fromIndex: number,
    toIndex: number
  ): Promise<PlaylistRecord | null> {
    const pl = this.playlists.find((p) => p.id === playlistId);
    if (!pl) return null;
    if (
      fromIndex < 0 ||
      toIndex < 0 ||
      fromIndex >= pl.tracks.length ||
      toIndex >= pl.tracks.length ||
      fromIndex === toIndex
    ) {
      return pl;
    }
    const copy = [...pl.tracks];
    const [moved] = copy.splice(fromIndex, 1);
    if (!moved) return pl;
    copy.splice(toIndex, 0, moved);
    return this.updatePlaylist(playlistId, { tracks: copy });
  }

  public getLikedTracks(): LikedTrackRecord[] {
    return [...this.likedTracks];
  }

  public isTrackLiked(trackId: string): boolean {
    return this.likedTracks.some((l) => l.trackId === trackId);
  }

  public async toggleLikeTrack(track: Track): Promise<boolean> {
    const exists = this.isTrackLiked(track.id);
    if (exists) {
      this.likedTracks = this.likedTracks.filter((l) => l.trackId !== track.id);
      await this.storage.setItem(STORAGE_KEYS.liked, JSON.stringify(this.likedTracks));
      await this.outbox.enqueue('liked_tracks', 'delete', { trackId: track.id });
      this.emitTableChanged('liked_tracks');
      return false;
    } else {
      const rec: LikedTrackRecord = {
        trackId: track.id,
        track,
        likedAt: new Date().toISOString(),
      };
      this.likedTracks = [rec, ...this.likedTracks];
      await this.storage.setItem(STORAGE_KEYS.liked, JSON.stringify(this.likedTracks));
      await this.outbox.enqueue('liked_tracks', 'upsert', rec);
      this.emitTableChanged('liked_tracks');
      return true;
    }
  }

  public getPlayHistory(): PlayHistoryRecord[] {
    return [...this.playHistory];
  }

  public async setPlayHistory(records: PlayHistoryRecord[]): Promise<void> {
    this.playHistory = [...records].slice(0, 200);
    await this.storage.setItem(STORAGE_KEYS.history, JSON.stringify(this.playHistory));
  }

  public getAffinities(): ArtistAffinityRecord[] {
    return [...this.affinities];
  }

  public async setAffinities(records: ArtistAffinityRecord[]): Promise<void> {
    this.affinities = [...records];
    await this.storage.setItem(STORAGE_KEYS.affinity, JSON.stringify(this.affinities));
    await this.outbox.enqueue('artist_affinity', 'upsert', this.affinities);
    this.emitTableChanged('artist_affinity');
  }

  public getDeviceSession(): DeviceSessionRecord | null {
    return this.deviceSession;
  }

  public async setDeviceSession(session: DeviceSessionRecord): Promise<void> {
    this.deviceSession = session;
    await this.storage.setItem(STORAGE_KEYS.session, JSON.stringify(session));
    this.emitTableChanged('device_sessions');
  }

  public onTableChanged(cb: (table: SyncTableName) => void): Unsubscribe {
    this.tableListeners.add(cb);
    return () => {
      this.tableListeners.delete(cb);
    };
  }

  private emitTableChanged(table: SyncTableName): void {
    for (const listener of this.tableListeners) {
      listener(table);
    }
  }

  private safeParseArray<T>(raw: string | null): T[] {
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch {
      return [];
    }
  }
}
