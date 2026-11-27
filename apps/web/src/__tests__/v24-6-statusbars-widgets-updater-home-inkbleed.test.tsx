// @vitest-environment jsdom
import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { DualDeckAudioEngine } from '@pmusic/audio-engine';
import type { DeckTransitionPlan, HomeEditorialShelf, PlaylistRecord, Track } from '@pmusic/core';
import { HomeScreen } from '../components/Screens.tsx';
import { syncNativeSystemBars } from '../utils/system-bars.ts';
import { usePMusicStore } from '../store/usePMusicStore.ts';

afterEach(() => {
  cleanup();
  delete (window as unknown as { PMusicNative?: unknown }).PMusicNative;
  vi.restoreAllMocks();
  act(() => {
    usePMusicStore.setState({
      homeFeedReady: true,
      homeShelves: [],
      playlists: [],
      playlistAppearances: {},
      playlistPlayCounts: {},
      likedTracks: [],
      playHistory: [],
      isOfflineNetwork: false,
    });
  });
});

describe('pMusic v0.24.6 split status bars, 4 Android widgets, desktop updater guard, Home live covers & synced InkBleed', () => {
  it('calls setSystemBarsSplitAppearance with independent status bar vs nav bar brightness for transparent hero banners', () => {
    const setSystemBarsSplitAppearance = vi.fn();
    const setSystemBarsAppearance = vi.fn();
    (
      window as unknown as {
        PMusicNative?: {
          setSystemBarsSplitAppearance?: typeof setSystemBarsSplitAppearance;
          setSystemBarsAppearance?: typeof setSystemBarsAppearance;
        };
      }
    ).PMusicNative = {
      setSystemBarsSplitAppearance,
      setSystemBarsAppearance,
    };

    syncNativeSystemBars({
      nowPlayingOpen: false,
      isLightBackdrop: false,
      themeId: 'obsidian',
      transparentStatusBar: true,
      isLightStatusBar: true,
    });
    expect(setSystemBarsSplitAppearance).toHaveBeenCalledWith(
      true,
      false,
      'transparent',
      '#070709'
    );

    syncNativeSystemBars({
      nowPlayingOpen: false,
      isLightBackdrop: false,
      themeId: 'obsidian',
      transparentStatusBar: true,
      isLightStatusBar: false,
    });
    expect(setSystemBarsSplitAppearance).toHaveBeenLastCalledWith(
      false,
      false,
      'transparent',
      '#070709'
    );
  });

  it('includes 4 true-rounded Android widgets, split system bars, and version 0.24.6 (versionCode 67) in build-apk.mjs', () => {
    const buildApkSrc = readFileSync(
      resolve(__dirname, '../../../mobile/scripts/build-apk.mjs'),
      'utf-8'
    );

    expect(buildApkSrc).toMatch(/android:versionCode="(6[7-9]|[7-9]\d)"/);
    expect(buildApkSrc).toMatch(/android:versionName="0\.24\.\d+"/);

    expect(buildApkSrc).toContain('PMusicWidgetProvider.java');
    expect(buildApkSrc).toContain('PMusicCompactWidgetProvider.java');
    expect(buildApkSrc).toContain('PMusicRecentWidgetProvider.java');
    expect(buildApkSrc).toContain('PMusicCoverWidgetProvider.java');

    expect(buildApkSrc).toContain('widget_btn_play_white.xml');
    expect(buildApkSrc).toContain('ic_widget_play_dark.xml');
    expect(buildApkSrc).toContain('ic_widget_pause_dark.xml');
    expect(buildApkSrc).toContain('android:clipToOutline="true"');

    expect(buildApkSrc).toContain('setSystemBarsSplitAppearance');
    expect(buildApkSrc).toContain('updateWidgetRecents');

    expect(buildApkSrc).not.toContain('R.id.widget_badge');
    expect(buildApkSrc).not.toMatch(/requestAudioFocus|abandonAudioFocus/);
  });

  it('guards Desktop Windows updater against infinite update loops and cleans up lingering files safely', () => {
    const desktopMainSrc = readFileSync(
      resolve(__dirname, '../../../desktop/src/main.ts'),
      'utf-8'
    );
    const buildElectronSrc = readFileSync(
      resolve(__dirname, '../../../desktop/scripts/build-electron.mjs'),
      'utf-8'
    );
    const customInstallerSrc = readFileSync(
      resolve(__dirname, '../../../desktop/scripts/build-custom-installer.mjs'),
      'utf-8'
    );

    expect(desktopMainSrc).toContain('update-guard.json');
    expect(desktopMainSrc).toContain('app.exit(0)');
    expect(buildElectronSrc).toContain('desktopPkgVersion');
    expect(buildElectronSrc).toContain('getEffectiveNativeVersion');
    expect(buildElectronSrc).toContain('update-guard.json');
    expect(buildElectronSrc).toContain('app.exit(0)');
    expect(buildElectronSrc).not.toContain("const PMUSIC_DESKTOP_VERSION = '0.24.4'");
    expect(customInstallerSrc).toContain('RunSilentUpdate');
    expect(customInstallerSrc).toContain('.old');
    expect(customInstallerSrc).toContain('unpackedMainPath');
    expect(customInstallerSrc).toContain('dist-electron');
    expect(customInstallerSrc).toContain('main.cjs');
    expect(customInstallerSrc).toContain('UseShellExecute = true');
    expect(customInstallerSrc).toContain('pmusic-silent-update.log');
  });

  it('updates Home quick-access playlist artwork when playlistAppearances changes and recovers missing shelf track covers from live library', () => {
    const customPlaylist: PlaylistRecord = {
      id: 'pl_lapanera',
      name: 'LaPanera',
      description: 'Playlist de prueba',
      source: 'local',
      tracks: [
        {
          id: 'tr_lapanera_1',
          title: 'Sharingan',
          artists: [{ id: 'ar_lp', name: 'La Pantera' }],
          album: { id: 'al_lp', name: 'LP' },
          durationSec: 120,
          thumbnailUrl: 'https://example.com/old-playlist-track.jpg',
          source: 'ytmusic',
        },
      ],
      createdAt: '2026-11-27T00:00:00Z',
      updatedAt: '2026-11-27T00:00:00Z',
    };

    const brokenShelfTrack: Track = {
      id: 'tr_prueba',
      title: 'LA PRUEBA',
      artists: [{ id: 'ar_prueba', name: 'Artista Prueba' }],
      album: { id: 'al_prueba', name: 'Album Prueba' },
      durationSec: 195,
      thumbnailUrl: '',
      source: 'ytmusic',
    };

    const liveTrackCover: Track = {
      ...brokenShelfTrack,
      thumbnailUrl: 'https://example.com/live-la-prueba.jpg',
      thumbnailHighUrl: 'https://example.com/live-la-prueba-hq.jpg',
    };

    const shelf: HomeEditorialShelf = {
      id: 'shelf_recent',
      kind: 'listen_again',
      title: 'Volver a escuchar',
      tracks: [brokenShelfTrack],
    };

    act(() => {
      usePMusicStore.setState({
        homeFeedReady: true,
        playlists: [customPlaylist],
        playlistAppearances: {
          pl_lapanera: {
            coverUrl: 'https://example.com/lapanera-cover-v1.jpg',
          },
        },
        playlistPlayCounts: {
          lapanera: {
            name: 'LaPanera',
            count: 3,
            lastPlayedAt: Date.now(),
          },
        },
        likedTracks: [
          {
            trackId: liveTrackCover.id,
            track: liveTrackCover,
            likedAt: '2026-11-27T12:00:00Z',
          },
        ],
        homeShelves: [shelf],
      });
    });

    const { container } = render(<HomeScreen />);
    const srcsV1 = Array.from(container.querySelectorAll('img')).map((el) =>
      el.getAttribute('src')
    );
    expect(srcsV1.some((s) => s?.includes('lapanera-cover-v1.jpg'))).toBe(true);
    expect(srcsV1.some((s) => s?.includes('live-la-prueba-hq.jpg'))).toBe(true);

    act(() => {
      usePMusicStore.setState({
        playlistAppearances: {
          pl_lapanera: {
            coverUrl: 'https://example.com/lapanera-cover-v2.jpg',
          },
        },
      });
    });

    const srcsV2 = Array.from(container.querySelectorAll('img')).map((el) =>
      el.getAttribute('src')
    );
    expect(srcsV2.some((s) => s?.includes('lapanera-cover-v2.jpg'))).toBe(true);
    expect(srcsV2.some((s) => s?.includes('lapanera-cover-v1.jpg'))).toBe(false);
    expect(screen.getByText('LaPanera')).toBeTruthy();
  });

  it('invokes onAudioFadeStart only when audio fade begins and synchronizes InkBleedCard with live playback position', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());

    const engine = new DualDeckAudioEngine();
    await engine.init();
    const internal = engine as unknown as {
      deckA: { audio: HTMLAudioElement };
      deckB: { audio: HTMLAudioElement };
    };
    Object.defineProperty(internal.deckA.audio, 'readyState', {
      value: 4,
      configurable: true,
    });
    Object.defineProperty(internal.deckB.audio, 'readyState', {
      value: 4,
      configurable: true,
    });

    const onAudioFadeStart = vi.fn();
    const plan: DeckTransitionPlan = {
      fromTrackId: 'tr_a',
      toTrackId: 'tr_b',
      cueInSec: 0,
      cueOutSec: 120,
      transitionDurationSec: 4,
      transitionBars: 4,
      transitionType: 'eq_swap',
      tempoNudgeRate: 1.0,
      echoSubdivision: 0.5,
      compatibilityScore: 0.85,
      isPlainCrossfade: true,
    };

    try {
      await engine.executeTransition(plan, onAudioFadeStart);
      expect(onAudioFadeStart).toHaveBeenCalledTimes(1);
      const effectiveDur = onAudioFadeStart.mock.calls[0]?.[0];
      expect(typeof effectiveDur).toBe('number');
      expect(effectiveDur).toBeGreaterThan(0);
    } finally {
      engine.cancelActiveTransition();
    }

    const inkBleedSrc = readFileSync(
      resolve(__dirname, '../components/InkBleedCoverTransition.tsx'),
      'utf-8'
    );
    expect(inkBleedSrc).toContain("optimizeArtworkUrl");
    expect(inkBleedSrc).toContain("'card'");
    expect(inkBleedSrc).toContain('getLivePlaybackPosition');
  });
});
