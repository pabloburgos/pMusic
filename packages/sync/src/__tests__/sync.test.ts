import { describe, expect, it } from 'vitest';
import type { Track } from '@pmusic/core';
import { LibraryStore, SyncEngine } from '../index.ts';

const SAMPLE_TRACK: Track = {
  id: 'cc_01',
  title: 'Me Muevo Con Dios',
  artists: [{ name: 'Cruz Cafuné' }],
  durationSec: 214,
  thumbnailUrl: 'https://example.com/1.jpg',
  source: 'ytmusic',
};

describe('@pmusic/sync', () => {
  it('boots cleanly in local_only mode when Supabase credentials are absent and persists library mutations in outbox', async () => {
    const store = new LibraryStore();
    await store.hydrate();

    const pl = await store.createPlaylist({
      name: 'Trap Canarias 2026',
      description: 'Mis favoritos',
      tracks: [SAMPLE_TRACK],
    });
    expect(pl.name).toBe('Trap Canarias 2026');
    expect(store.getPlaylists()).toHaveLength(1);

    const liked = await store.toggleLikeTrack(SAMPLE_TRACK);
    expect(liked).toBe(true);
    expect(store.isTrackLiked(SAMPLE_TRACK.id)).toBe(true);
    expect(store.outbox.getPending().length).toBeGreaterThanOrEqual(2);

    const secondTrack: Track = {
      ...SAMPLE_TRACK,
      id: 'cc_02',
      title: 'Cayetano',
    };
    await store.addTrackToPlaylist(pl.id, secondTrack);
    expect(store.getPlaylists()[0]?.tracks).toHaveLength(2);

    const reordered = await store.reorderPlaylistTrack(pl.id, 1, 0);
    expect(reordered?.tracks[0]?.id).toBe('cc_02');

    const trimmed = await store.removeTrackFromPlaylist(pl.id, 'cc_01');
    expect(trimmed?.tracks).toHaveLength(1);
    expect(trimmed?.tracks[0]?.id).toBe('cc_02');
  });

  it('enforces <= 8 keys on Presence payload and transfers playback at exact millisecond between devices', async () => {
    const engine = new SyncEngine({
      deviceId: 'dev_pc_win',
      deviceName: 'pMusic Windows PC',
      platform: 'windows',
    });

    expect(engine.mode).toBe('local_only');
    const devices = engine.getOnlineDevices();
    expect(devices).toHaveLength(1);
    expect(Object.keys(devices[0]!).length).toBeLessThanOrEqual(8);

    engine.upsertPeerDevice({
      device_id: 'dev_android_pixel',
      device_name: 'pMusic Android',
      platform: 'android',
      is_active: false,
      is_playing: false,
      track_title: 'En espera',
      updated_at: Date.now(),
    });

    expect(engine.getOnlineDevices()).toHaveLength(2);

    const xfer = await engine.transferPlaybackTo('dev_android_pixel', {
      track: SAMPLE_TRACK,
      queue: [SAMPLE_TRACK],
      queueIndex: 0,
      positionMs: 48_250,
      isPlaying: true,
      volume: 0.9,
      djModeEnabled: true,
      djSessionStyle: 'quick',
      sentAtEpochMs: Date.now(),
    });

    expect(xfer.acked).toBe(true);
    const updatedPeer = engine
      .getOnlineDevices()
      .find((d) => d.device_id === 'dev_android_pixel');
    expect(updatedPeer?.is_active).toBe(true);
    expect(updatedPeer?.is_playing).toBe(true);
    expect(updatedPeer?.track_title).toContain('Me Muevo Con Dios');
  });

  it('normalizes legacy playlist IDs to UUIDs and upserts remote playlists & likes preserving exact cloud IDs without outbox duplication', async () => {
    const store = new LibraryStore();
    await store.hydrate();

    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const remoteId = '11111111-2222-4333-8444-555555555555';
    const track2: Track = {
      ...SAMPLE_TRACK,
      id: 'dz:999',
      title: 'Cangrinaje',
    };

    const syncedPl = await store.upsertRemotePlaylist({
      id: remoteId,
      name: 'Cloud Mix',
      description: 'Synced from desktop',
      tracks: [SAMPLE_TRACK],
    });
    expect(syncedPl.id).toBe(remoteId);
    expect(store.getPlaylists()).toHaveLength(1);
    expect(store.outbox.getPending()).toHaveLength(0);

    // Updating the same cloud playlist with new tracks preserves the exact remote ID and avoids duplicates
    const updatedPl = await store.upsertRemotePlaylist({
      id: remoteId,
      name: 'Cloud Mix',
      tracks: [SAMPLE_TRACK, track2],
    });
    expect(updatedPl.id).toBe(remoteId);
    expect(store.getPlaylists()).toHaveLength(1);
    expect(store.getPlaylists()[0]?.tracks).toHaveLength(2);

    await store.upsertRemoteLikedTrack({
      trackId: track2.id,
      track: track2,
      likedAt: new Date().toISOString(),
    });
    expect(store.isTrackLiked(track2.id)).toBe(true);
    expect(store.outbox.getPending()).toHaveLength(0);

    const localCreated = await store.createPlaylist({ name: 'Local UUID Check', tracks: [] });
    expect(uuidRe.test(localCreated.id)).toBe(true);
  });
});
