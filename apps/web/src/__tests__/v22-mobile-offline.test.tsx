// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { App } from '../App.tsx';
import { NowPlayingSheet } from '../components/Overlays.tsx';
import { createPlatformBridge } from '../platform/web-bridge.ts';
import { usePMusicStore } from '../store/usePMusicStore.ts';
import type { PlaylistRecord, Track } from '@pmusic/core';

function makeTrack(idx: number): Track {
  return {
    id: `v22-track-${idx}`,
    title: `Track V22 #${idx}`,
    artists: [{ id: `art-${idx}`, name: `Artist ${idx}` }],
    album: { id: `alb-${idx}`, name: `Album ${idx}` },
    durationSec: 205,
    thumbnailUrl: 'https://example.com/thumb.jpg',
    isExplicit: false,
    source: 'youtube',
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('pMusic v0.22.0 mobile & offline hardening', () => {
  it('never returns phantom /api/stream offline URLs when bytes are missing and persists saved bytes', async () => {
    const createUrlSpy = vi
      .spyOn(URL, 'createObjectURL')
      .mockImplementation(() => 'blob:https://pmusic.test/mock-offline-audio');
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

    const bridge = createPlatformBridge();
    // Stale entry with no backing audio bytes must return null (and never ?offline=1)
    const missingUrl = await bridge.offlineStorage.getAudioUrl('missing-track-id');
    expect(missingUrl).toBeNull();

    const dummyBuf = new Uint8Array(40_000).fill(7).buffer;
    await bridge.offlineStorage.saveAudio('saved-track-1', dummyBuf, 'audio/mp4');

    const storedUrl = await bridge.offlineStorage.getAudioUrl('saved-track-1');
    expect(storedUrl).toBe('blob:https://pmusic.test/mock-offline-audio');
    expect(createUrlSpy).toHaveBeenCalledTimes(1);

    const streamBuilt = await bridge.buildStreamUrl('saved-track-1', 'high');
    expect(streamBuilt).toBe('blob:https://pmusic.test/mock-offline-audio');

    const listed = await bridge.offlineStorage.listOfflineIds();
    expect(listed.some((e: { trackId: string }) => e.trackId === 'saved-track-1')).toBe(true);

    await bridge.offlineStorage.deleteAudio('saved-track-1');
    expect(revokeSpy).toHaveBeenCalled();
    expect(await bridge.offlineStorage.getAudioUrl('saved-track-1')).toBeNull();
  });

  it('skips undownloaded tracks when offline and preserves current downloaded track', async () => {
    const downloadedTrack = makeTrack(1);
    const unavailableTrack = makeTrack(2);

    act(() => {
      usePMusicStore.setState({
        currentTrack: downloadedTrack,
        isOfflineNetwork: true,
        offlineDownloads: {
          [downloadedTrack.id]: 'downloaded',
        },
        queue: [unavailableTrack, downloadedTrack],
      });
    });

    await act(async () => {
      await usePMusicStore.getState().playTrack(unavailableTrack);
    });

    // Single unavailable track must not clobber active downloaded track
    expect(usePMusicStore.getState().currentTrack.id).toBe(downloadedTrack.id);

    await act(async () => {
      await usePMusicStore
        .getState()
        .playTrack(unavailableTrack, [unavailableTrack, downloadedTrack]);
    });

    expect(usePMusicStore.getState().currentTrack.id).toBe(downloadedTrack.id);

    act(() => {
      usePMusicStore.setState({ isOfflineNetwork: false });
    });
  });

  it('removes mobile fullscreen toggle, locks vertical scroll on Portada tab, and renders mobile download button', () => {
    const track = makeTrack(10);
    act(() => {
      usePMusicStore.setState({
        currentTrack: track,
        nowPlayingOpen: true,
        nowPlayingTab: 'Portada',
        offlineDownloads: { [track.id]: 'downloaded' },
      });
    });

    const { container } = render(<NowPlayingSheet />);

    // Mobile fullscreen button must be removed (only desktop `hidden md:inline-flex` remains)
    const fsBtns = screen.queryAllByLabelText(/pantalla completa/i);
    expect(fsBtns.every((btn) => btn.className.includes('hidden'))).toBe(true);

    // Portada tab container uses overflow-hidden on mobile (no spurious scroll)
    const overflowContainers = Array.from(container.querySelectorAll('div')).filter((el) =>
      el.className.includes('overflow-hidden py-1')
    );
    expect(overflowContainers.length).toBeGreaterThan(0);

    // Offline download button is visible on mobile without `hidden ... md:flex`
    const dlBtns = screen.getAllByLabelText('Descargada offline');
    expect(dlBtns.some((btn) => !btn.className.includes('hidden'))).toBe(true);
  });

  it('uses iconic Artist-style controls on local playlists while preserving playlist testids', () => {
    const t1 = makeTrack(21);
    const t2 = makeTrack(22);
    const pl: PlaylistRecord = {
      id: 'pl-iconic-v22',
      name: 'Playlist Icónica',
      description: '',
      source: 'local',
      tracks: [t1, t2],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    act(() => {
      usePMusicStore.setState((s) => ({
        playlists: [pl, ...s.playlists.filter((p) => p.id !== pl.id)],
        activeTab: 'Biblioteca',
        activeDetailView: { kind: 'local_playlist', playlistId: pl.id },
      }));
    });

    render(<App />);

    expect(screen.getByTestId('playlist-add-songs-btn')).toBeTruthy();
    expect(screen.getByTestId('playlist-more-actions-btn')).toBeTruthy();
    expect(screen.getByLabelText('Sesión DJ')).toBeTruthy();
  });
});
