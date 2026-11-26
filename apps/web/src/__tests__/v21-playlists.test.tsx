// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { App } from '../App.tsx';
import { LiquidHeartIcon } from '../components/LiquidHeartIcon.tsx';
import { MarqueeText } from '../components/MarqueeText.tsx';
import { PlaylistOptionsMenu } from '../components/PlaylistOptionsMenu.tsx';
import {
  formatPlaylistDuration,
  generatePlaylistBannerDataUrl,
  generatePlaylistCoverDataUrl,
} from '../utils/playlist-artwork.ts';
import { usePMusicStore } from '../store/usePMusicStore.ts';
import type { PlaylistRecord, Track } from '@pmusic/core';

function makeTrack(idx: number): Track {
  return {
    id: `v21-track-${idx}`,
    title: `Track V21 #${idx}`,
    artists: [{ id: `art-${idx}`, name: `Artist ${idx}` }],
    album: { id: `alb-${idx}`, name: `Album ${idx}` },
    durationSec: 210,
    thumbnailUrl: 'https://example.com/thumb.jpg',
    isExplicit: false,
    source: 'youtube',
  };
}

afterEach(() => {
  cleanup();
});

describe('pMusic v0.21.0 features', () => {
  it('formats playlist durations cleanly into minutes and hours', () => {
    expect(formatPlaylistDuration(0)).toBe('');
    expect(formatPlaylistDuration(42)).toBe('< 1 min');
    expect(formatPlaylistDuration(43 * 60)).toBe('43 min');
    expect(formatPlaylistDuration(135 * 60)).toBe('2 h 15 min');
    expect(formatPlaylistDuration(120 * 60)).toBe('2 h');
  });

  it('generates deterministic unique cover and banner SVGs for playlists', () => {
    const covA = generatePlaylistCoverDataUrl('Noches de Verano', 1);
    const covB = generatePlaylistCoverDataUrl('Noches de Verano', 2);
    const banA = generatePlaylistBannerDataUrl('Noches de Verano', 1);
    expect(covA.startsWith('data:image/svg+xml')).toBe(true);
    expect(covA).not.toBe(covB);
    expect(banA.startsWith('data:image/svg+xml')).toBe(true);
  });

  it('deletes a playlist completely and clears activeDetailView', async () => {
    const pl: PlaylistRecord = {
      id: 'pl-delete-v21',
      name: 'Playlist Borrable',
      description: '',
      source: 'local',
      tracks: [makeTrack(1), makeTrack(2)],
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

    await act(async () => {
      await usePMusicStore.getState().deletePlaylist(pl.id);
    });

    const state = usePMusicStore.getState();
    expect(state.playlists.some((p) => p.id === pl.id)).toBe(false);
    expect(state.activeDetailView).toBeNull();
  });

  it('does not auto-open add finder and hides recommendations until playlist has at least 10 tracks', () => {
    const smallPl: PlaylistRecord = {
      id: 'pl-small-v21',
      name: 'Lista Pequeña',
      description: '',
      source: 'local',
      tracks: Array.from({ length: 5 }, (_, i) => makeTrack(i + 1)),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    act(() => {
      usePMusicStore.setState((s) => ({
        playlists: [smallPl, ...s.playlists.filter((p) => p.id !== smallPl.id)],
        activeTab: 'Biblioteca',
        activeDetailView: { kind: 'local_playlist', playlistId: smallPl.id },
      }));
    });

    render(<App />);

    // Add finder panel should NOT be auto-opened when opening a playlist
    expect(screen.queryByPlaceholderText(/Buscar canciones o artistas para añadir/i)).toBeNull();
    // Recommendations stay hidden below 10 tracks
    expect(screen.queryByText(/Recomendadas para esta playlist/i)).toBeNull();

    // Update playlist to 10 tracks -> recommendations appear
    const tenPl: PlaylistRecord = {
      ...smallPl,
      tracks: Array.from({ length: 10 }, (_, i) => makeTrack(i + 1)),
    };
    act(() => {
      usePMusicStore.setState((s) => ({
        playlists: s.playlists.map((p) => (p.id === smallPl.id ? tenPl : p)),
      }));
    });

    expect(screen.getByText(/Recomendadas para esta playlist/i)).toBeDefined();
  });

  it('renders right-click playlist options menu in a top-layer body portal and supports classic no-banner toggle', async () => {
    const pl: PlaylistRecord = {
      id: 'pl-portal-v21',
      name: 'Playlist Portal',
      description: '',
      source: 'local',
      tracks: [makeTrack(1), makeTrack(2)],
      bannerEnabled: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    act(() => {
      usePMusicStore.setState((s) => ({
        playlists: [pl, ...s.playlists.filter((p) => p.id !== pl.id)],
        playlistContextMenu: {
          kind: 'local',
          playlistId: pl.id,
          x: 120,
          y: 160,
        },
      }));
    });

    render(<PlaylistOptionsMenu />);
    const menu = document.body.querySelector('[data-testid="playlist-actions-menu"]');
    expect(menu).not.toBeNull();
    expect(menu?.className).toContain('z-[9999]');
    expect(menu?.parentElement).toBe(document.body);

    await act(async () => {
      await usePMusicStore
        .getState()
        .updatePlaylistAppearance('local', pl.id, { bannerEnabled: false });
    });
    expect(usePMusicStore.getState().playlistAppearances[pl.id]?.bannerEnabled).toBe(false);
  });

  it('renders LiquidHeartIcon with unique clipPath IDs and bottom-to-top liquid fill state', () => {
    const { rerender } = render(
      <div>
        <LiquidHeartIcon liked={false} />
        <LiquidHeartIcon liked={true} />
      </div>
    );
    const clips = Array.from(document.querySelectorAll('clipPath'));
    expect(clips.length).toBe(2);
    expect(clips[0]!.id).not.toBe(clips[1]!.id);

    const svgs = Array.from(document.querySelectorAll('svg[data-liked]'));
    expect(svgs[0]?.getAttribute('data-liked')).toBe('false');
    expect(svgs[1]?.getAttribute('data-liked')).toBe('true');

    const riseUnliked = svgs[0]?.querySelector('.pm-liquid-rise') as HTMLElement | null;
    const riseLiked = svgs[1]?.querySelector('.pm-liquid-rise') as HTMLElement | null;
    expect(riseUnliked?.style.transform).toContain('translateY(25px)');
    expect(riseLiked?.style.transform).toContain('translateY(-2px)');

    rerender(
      <div>
        <LiquidHeartIcon liked={true} />
        <LiquidHeartIcon liked={true} />
      </div>
    );
    expect(svgs[0]?.getAttribute('data-liked')).toBe('true');
  });

  it('persists safeCrossfade and alwaysShuffle with savedAt timestamp and keeps MarqueeText track unconstrained when enabled', () => {
    act(() => {
      usePMusicStore.getState().setSafeCrossfade({ enabled: true, durationSec: 6 });
      usePMusicStore.getState().setAlwaysShuffle(true);
    });

    const raw = localStorage.getItem('pmusic_user_prefs_v1');
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!) as Record<string, any>;
    expect(typeof parsed.savedAt).toBe('number');
    expect(parsed.safeCrossfade).toEqual({ enabled: true, durationSec: 6 });
    expect(parsed.alwaysShuffle).toBe(true);

    const { rerender } = render(
      <MarqueeText disabled={false} testId="test-marquee">
        <span>Artist One, Artist Two, Artist Three</span>
      </MarqueeText>
    );
    const trackEl = screen.getByTestId('test-marquee').querySelector('.pm-marquee-track');
    expect(trackEl?.className).toContain('inline-flex');
    expect(trackEl?.className).not.toContain('truncate');

    rerender(
      <MarqueeText disabled={true} testId="test-marquee">
        <span>Artist One, Artist Two, Artist Three</span>
      </MarqueeText>
    );
    const disabledTrackEl = screen.getByTestId('test-marquee').querySelector('.pm-marquee-track');
    expect(disabledTrackEl?.className).toContain('truncate');
  });
});
