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
  ownerUserId: 'pmusic.lib.ownerUserId',
} as const;

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function normalizePlaylistNameKey(name: string): string {
  return (name ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizeTrackDuplicateKey(t: Track): string {
  const title = (t.title ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  const artist = (t.artists?.[0]?.name ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  return `${title}::${artist}`;
}

function canonicalizeArtistRef(ref: { id?: string; name: string }): { id?: string; name: string } {
  const norm = (ref.name ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
  if (norm === 'cruz cafune' || norm === 'cruzzi' || ref.id === '10125390') {
    return { id: '73148212', name: 'Cruzzi' };
  }
  return ref;
}

export function canonicalizeStoredTrack(track: Track): Track {
  if (!track || !Array.isArray(track.artists)) return track;
  let changed = false;
  const nextArtists = track.artists.map((ar) => {
    const canon = canonicalizeArtistRef(ar);
    if (canon.name !== ar.name || canon.id !== ar.id) changed = true;
    return canon;
  });
  return changed ? { ...track, artists: nextArtists } : track;
}

function canonicalizeStoredAffinity(rec: ArtistAffinityRecord): ArtistAffinityRecord {
  const canon = canonicalizeArtistRef({ id: rec.artistId, name: rec.artistName });
  if (canon.name === rec.artistName && (canon.id ?? rec.artistId) === rec.artistId) {
    return rec;
  }
  return {
    ...rec,
    artistId: canon.id ?? rec.artistId,
    artistName: canon.name,
  };
}

export function mergePlaylistTracksUnique(
  primary: readonly Track[],
  secondary: readonly Track[]
): Track[] {
  const out: Track[] = [];
  const seenIds = new Set<string>();
  const seenMeta = new Set<string>();
  const pushTrack = (t: Track | null | undefined) => {
    if (!t?.id) return;
    const metaKey = normalizeTrackDuplicateKey(t);
    if (seenIds.has(t.id) || (metaKey !== '::' && seenMeta.has(metaKey))) return;
    seenIds.add(t.id);
    if (metaKey !== '::') seenMeta.add(metaKey);
    out.push(t);
  };
  for (const t of primary) pushTrack(t);
  for (const t of secondary) pushTrack(t);
  return out;
}

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

  public async clearAll(): Promise<void> {
    this.queue = [];
    await this.storage.setItem(STORAGE_KEYS.outbox, '[]');
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
  private ownerUserId: string | null = null;
  private readonly tableListeners = new Set<(table: SyncTableName) => void>();

  public constructor(storage: IPreferencesStorageBridge = createDefaultPreferencesStorage()) {
    this.storage = storage;
    this.outbox = new OfflineOutbox(storage);
  }

  public async hydrate(): Promise<void> {
    await this.outbox.hydrate();
    const [rawPlaylists, rawLiked, rawHistory, rawAffinity, rawSession, rawOwner] = await Promise.all([
      this.storage.getItem(STORAGE_KEYS.playlists),
      this.storage.getItem(STORAGE_KEYS.liked),
      this.storage.getItem(STORAGE_KEYS.history),
      this.storage.getItem(STORAGE_KEYS.affinity),
      this.storage.getItem(STORAGE_KEYS.session),
      this.storage.getItem(STORAGE_KEYS.ownerUserId),
    ]);

    this.ownerUserId = rawOwner && rawOwner.trim().length > 0 ? rawOwner.trim() : null;
    this.playlists = this.safeParseArray<PlaylistRecord>(rawPlaylists).map((pl) => ({
      ...pl,
      tracks: (pl.tracks ?? []).map(canonicalizeStoredTrack),
    }));
    await this.deduplicatePlaylists();
    this.likedTracks = this.safeParseArray<LikedTrackRecord>(rawLiked).map((rec) => ({
      ...rec,
      track: canonicalizeStoredTrack(rec.track),
    }));
    this.playHistory = this.safeParseArray<PlayHistoryRecord>(rawHistory).map((rec) => ({
      ...rec,
      track: canonicalizeStoredTrack(rec.track),
    }));
    this.affinities = this.safeParseArray<ArtistAffinityRecord>(rawAffinity).map(
      canonicalizeStoredAffinity
    );
    if (rawSession) {
      try {
        this.deviceSession = JSON.parse(rawSession) as DeviceSessionRecord;
      } catch {
        this.deviceSession = null;
      }
    }
  }

  public getOwnerUserId(): string | null {
    return this.ownerUserId;
  }

  public async setOwnerUserId(userId: string | null): Promise<void> {
    this.ownerUserId = userId && userId.trim().length > 0 ? userId.trim() : null;
    if (this.ownerUserId) {
      await this.storage.setItem(STORAGE_KEYS.ownerUserId, this.ownerUserId);
    } else {
      await this.storage.removeItem(STORAGE_KEYS.ownerUserId);
    }
  }

  /**
   * Clears all user-scoped library data (playlists, likes, history, affinity, session, outbox)
   * when switching Google/Supabase accounts or signing out so accounts never cross-contaminate.
   */
  public async clearAllUserData(): Promise<void> {
    this.playlists = [];
    this.likedTracks = [];
    this.playHistory = [];
    this.affinities = [];
    this.deviceSession = null;
    this.ownerUserId = null;
    await this.outbox.clearAll();
    await Promise.all([
      this.storage.removeItem(STORAGE_KEYS.playlists),
      this.storage.removeItem(STORAGE_KEYS.liked),
      this.storage.removeItem(STORAGE_KEYS.history),
      this.storage.removeItem(STORAGE_KEYS.affinity),
      this.storage.removeItem(STORAGE_KEYS.session),
      this.storage.removeItem(STORAGE_KEYS.ownerUserId),
    ]);
    this.emitTableChanged('playlists');
    this.emitTableChanged('liked_tracks');
    this.emitTableChanged('artist_affinity');
    this.emitTableChanged('device_sessions');
  }

  /**
   * Consolidates duplicate local/remote playlists sharing the same normalized name,
   * preserving the richest tracklist (e.g. 32 songs beats stale 18-song duplicates).
   */
  public async deduplicatePlaylists(): Promise<boolean> {
    if (this.playlists.length <= 1) return false;
    const groups = new Map<string, PlaylistRecord[]>();
    const unkeyed: PlaylistRecord[] = [];
    for (const pl of this.playlists) {
      const key = normalizePlaylistNameKey(pl.name);
      if (!key) {
        unkeyed.push(pl);
        continue;
      }
      const list = groups.get(key) ?? [];
      list.push(pl);
      groups.set(key, list);
    }

    let changed = false;
    const deduped: PlaylistRecord[] = [...unkeyed];
    for (const group of groups.values()) {
      if (group.length === 1) {
        deduped.push(group[0]!);
        continue;
      }
      changed = true;
      const sorted = [...group].sort((a, b) => {
        if (b.tracks.length !== a.tracks.length) {
          return b.tracks.length - a.tracks.length;
        }
        return (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0);
      });
      const keeper = sorted[0]!;
      let mergedTracks = [...keeper.tracks];
      for (const extra of sorted.slice(1)) {
        mergedTracks = mergePlaylistTracksUnique(mergedTracks, extra.tracks);
      }
      deduped.push({
        ...keeper,
        tracks: mergedTracks,
        coverUrl: keeper.coverUrl ?? mergedTracks[0]?.thumbnailUrl,
      });
    }

    if (changed) {
      this.playlists = deduped;
      await this.storage.setItem(STORAGE_KEYS.playlists, JSON.stringify(this.playlists));
      this.emitTableChanged('playlists');
    }
    return changed;
  }

  public getPlaylists(): PlaylistRecord[] {
    return this.playlists.map((pl) => ({
      ...pl,
      tracks: (pl.tracks ?? []).map(canonicalizeStoredTrack),
    }));
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
    const normRemoteName = normalizePlaylistNameKey(remote.name);
    const matchIdx = this.playlists.findIndex(
      (p) =>
        p.id === remote.id ||
        (normRemoteName.length > 0 && normalizePlaylistNameKey(p.name) === normRemoteName)
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
      tracks: remote.tracks.map(canonicalizeStoredTrack),
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
    const normalized: LikedTrackRecord = {
      ...rec,
      track: canonicalizeStoredTrack(rec.track),
    };
    this.likedTracks = [normalized, ...this.likedTracks];
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
      tracks: input.tracks ? input.tracks.map(canonicalizeStoredTrack) : [],
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
    patch: Partial<
      Pick<
        PlaylistRecord,
        | 'name'
        | 'description'
        | 'coverUrl'
        | 'bannerUrl'
        | 'bannerEnabled'
        | 'coverStyleSeed'
        | 'tracks'
        | 'shareCode'
        | 'isCollaborative'
        | 'isPublicLink'
      >
    >
  ): Promise<PlaylistRecord | null> {
    const idx = this.playlists.findIndex((p) => p.id === playlistId);
    if (idx === -1) return null;
    const current = this.playlists[idx]!;
    const updated: PlaylistRecord = {
      ...current,
      ...(patch.name !== undefined ? { name: patch.name.trim() || current.name } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.coverUrl !== undefined ? { coverUrl: patch.coverUrl || undefined } : {}),
      ...(patch.bannerUrl !== undefined ? { bannerUrl: patch.bannerUrl || undefined } : {}),
      ...(patch.bannerEnabled !== undefined ? { bannerEnabled: patch.bannerEnabled } : {}),
      ...(patch.coverStyleSeed !== undefined ? { coverStyleSeed: patch.coverStyleSeed } : {}),
      ...(patch.tracks !== undefined ? { tracks: patch.tracks.map(canonicalizeStoredTrack) } : {}),
      ...(patch.shareCode !== undefined ? { shareCode: patch.shareCode } : {}),
      ...(patch.isCollaborative !== undefined ? { isCollaborative: patch.isCollaborative } : {}),
      ...(patch.isPublicLink !== undefined ? { isPublicLink: patch.isPublicLink } : {}),
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
      coverUrl: pl.coverUrl || track.thumbnailUrl,
    });
  }

  public async replacePlaylistTracks(
    playlistId: string,
    nextTracks: Track[]
  ): Promise<PlaylistRecord | null> {
    const pl = this.playlists.find((p) => p.id === playlistId);
    if (!pl) return null;
    const keepCustomCover =
      Boolean(pl.coverUrl) &&
      (pl.coverUrl!.startsWith('data:') ||
        nextTracks.some((t) => t.thumbnailUrl === pl.coverUrl));
    return this.updatePlaylist(playlistId, {
      tracks: nextTracks,
      coverUrl: keepCustomCover ? pl.coverUrl : (nextTracks[0]?.thumbnailUrl ?? ''),
    });
  }

  public async removeTrackFromPlaylist(
    playlistId: string,
    trackId: string
  ): Promise<PlaylistRecord | null> {
    const pl = this.playlists.find((p) => p.id === playlistId);
    if (!pl) return null;
    const removed = pl.tracks.find((t) => t.id === trackId);
    const filtered = pl.tracks.filter((t) => t.id !== trackId);
    if (filtered.length === pl.tracks.length) return pl;
    const keepCustomCover =
      Boolean(pl.coverUrl) &&
      (pl.coverUrl!.startsWith('data:') ||
        (Boolean(removed?.thumbnailUrl) && pl.coverUrl !== removed!.thumbnailUrl));
    return this.updatePlaylist(playlistId, {
      tracks: filtered,
      coverUrl: keepCustomCover ? pl.coverUrl : (filtered[0]?.thumbnailUrl ?? ''),
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
    const keepCustomCover =
      Boolean(pl.coverUrl) &&
      pl.coverUrl !== pl.tracks[0]?.thumbnailUrl &&
      pl.coverUrl !== pl.tracks[0]?.thumbnailHighUrl;
    return this.updatePlaylist(playlistId, {
      tracks: copy,
      coverUrl: keepCustomCover ? pl.coverUrl : (copy[0]?.thumbnailUrl ?? ''),
    });
  }

  public getLikedTracks(): LikedTrackRecord[] {
    return this.likedTracks.map((rec) => ({
      ...rec,
      track: canonicalizeStoredTrack(rec.track),
    }));
  }

  public isTrackLiked(trackId: string): boolean {
    return this.likedTracks.some((l) => l.trackId === trackId);
  }

  public async toggleLikeTrack(track: Track): Promise<boolean> {
    const cleanTrack = canonicalizeStoredTrack(track);
    const exists = this.isTrackLiked(cleanTrack.id);
    if (exists) {
      this.likedTracks = this.likedTracks.filter((l) => l.trackId !== cleanTrack.id);
      await this.storage.setItem(STORAGE_KEYS.liked, JSON.stringify(this.likedTracks));
      await this.outbox.enqueue('liked_tracks', 'delete', { trackId: cleanTrack.id });
      this.emitTableChanged('liked_tracks');
      return false;
    } else {
      const rec: LikedTrackRecord = {
        trackId: cleanTrack.id,
        track: cleanTrack,
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
    return this.playHistory.map((rec) => ({
      ...rec,
      track: canonicalizeStoredTrack(rec.track),
    }));
  }

  public async setPlayHistory(records: PlayHistoryRecord[]): Promise<void> {
    this.playHistory = records.slice(0, 200).map((rec) => ({
      ...rec,
      track: canonicalizeStoredTrack(rec.track),
    }));
    await this.storage.setItem(STORAGE_KEYS.history, JSON.stringify(this.playHistory));
  }

  public getAffinities(): ArtistAffinityRecord[] {
    return [...this.affinities];
  }

  public async setAffinities(records: ArtistAffinityRecord[]): Promise<void> {
    this.affinities = records.map(canonicalizeStoredAffinity);
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
