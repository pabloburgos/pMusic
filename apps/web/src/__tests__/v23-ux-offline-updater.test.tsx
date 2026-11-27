// @vitest-environment jsdom
import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { App } from '../App.tsx';
import { AddToPlaylistModal } from '../components/AddToPlaylistModal.tsx';
import { PMusicLogo } from '../components/PMusicLogo.tsx';
import { PublicJamGuestPage } from '../components/PublicJamGuestPage.tsx';
import { SettingsModal } from '../components/SettingsModal.tsx';
import { SwipeableTrackRow } from '../components/SwipeableTrackRow.tsx';
import { TrackArtwork } from '../components/TrackArtwork.tsx';
import {
  InkBleedCoverTransition,
  prefetchInkCoverImage,
} from '../components/InkBleedCoverTransition.tsx';
import { MobileFluidBackdropCanvas } from '../components/MobileFluidBackdropCanvas.tsx';
import { DetailViewPanel } from '../components/Screens.tsx';
import { compareSemver } from '../utils/app-updater.ts';
import {
  animateAmbientPaletteFromCover,
  shouldUseDarkInkOnBackdrop,
} from '../utils/cover-color.ts';
import { optimizeArtworkUrl, setDataSaverMode } from '../utils/image-opt.ts';
import {
  DESCUBRE_ALGO_VERSION,
  evolveDailyPlaylistForNewDay,
  getLocalDayKey,
  getRollingDaysAgoIso,
  mergeCloudEditorialMixes,
  mergeIncrementalDescubrePool,
  mergeProtectedEditorialShelves,
  readPersistedArtistCache,
  toCompactSyncedTrack,
  writePersistedArtistCache,
} from '../utils/editorial-cache.ts';
import { usePMusicStore } from '../store/usePMusicStore.ts';
import type { PlaylistRecord, Track } from '@pmusic/core';

function makeTrack(idx: number): Track {
  return {
    id: `v23-track-${idx}`,
    title: `Track V23 #${idx}`,
    artists: [{ id: `art-${idx}`, name: `Artist ${idx}` }],
    album: { id: `alb-${idx}`, name: `Album ${idx}` },
    durationSec: 215,
    thumbnailUrl: 'https://example.com/thumb.jpg',
    isExplicit: false,
    source: 'youtube',
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  act(() => {
    usePMusicStore.setState({
      isOfflineNetwork: false,
      settingsOpen: false,
      mobileHubOpen: false,
      settingsReturnToMobileHub: false,
      activeDetailView: null,
    });
  });
});

describe('pMusic v0.23.0 UX, offline covers, Android media & updater', () => {
  it('renders bespoke modern pMusic generated cover artwork with unboxed mark when cover fails or is offline', async () => {
    act(() => {
      usePMusicStore.setState({ isOfflineNetwork: true });
    });

    const listRender = render(
      <TrackArtwork
        trackId="missing-offline-cover"
        src="https://example.com/missing.jpg"
        title="LA PRUEBA"
        artistName="Raul Clyde"
        alt="LA PRUEBA"
        variant="list"
      />
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(listRender.container.querySelector('[data-testid="pmusic-generated-cover"]')).not.toBeNull();
    expect(listRender.container.querySelector('rect[rx="64"]')).toBeNull();

    render(
      <TrackArtwork
        trackId="missing-offline-cover"
        src="https://example.com/missing.jpg"
        title="LA PRUEBA"
        artistName="Raul Clyde"
        alt="LA PRUEBA"
        variant="nowplaying"
      />
    );
    await act(async () => {
      await Promise.resolve();
    });
    const npCover = screen.getByTestId('nowplaying-missing-cover');
    expect(npCover).toBeTruthy();
    expect(screen.getByText('LA PRUEBA')).toBeTruthy();
    expect(screen.getByText('Raul Clyde')).toBeTruthy();
    expect(npCover.querySelector('rect[rx="64"]')).toBeNull();
  });

  it('compares semantic versions accurately for splash auto-updates', () => {
    expect(compareSemver('0.23.1', '0.23.0')).toBe(1);
    expect(compareSemver('v1.0.0', '0.23.0')).toBe(1);
    expect(compareSemver('0.23.0', '0.23.0')).toBe(0);
    expect(compareSemver('0.22.1', '0.23.0')).toBe(-1);
  });

  it('renders SettingsModal as full-screen native page on mobile matching MobileHubPage', () => {
    const origInnerWidth = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: 390,
    });
    window.dispatchEvent(new Event('resize'));

    act(() => {
      usePMusicStore.setState({ mobileHubOpen: true });
      usePMusicStore.getState().openSettingsCategory('audio');
    });

    render(<SettingsModal />);
    const view = screen.getByTestId('settings-view');
    expect(view.className).toContain('pm-canvas');
    expect(view.className).toContain('fixed inset-0');
    const backBtn = screen.getByTestId('settings-mobile-back-btn');
    expect(backBtn).toBeTruthy();

    fireEvent.click(backBtn);
    expect(usePMusicStore.getState().settingsOpen).toBe(false);
    expect(usePMusicStore.getState().mobileHubOpen).toBe(true);

    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: origInnerWidth,
    });
    window.dispatchEvent(new Event('resize'));
  });

  it('renders horizontal mobile playlist & album headers without "Creada en pMusic" or floating "Personalizar"', () => {
    const t1 = makeTrack(1);
    const t2 = makeTrack(2);
    const pl: PlaylistRecord = {
      id: 'pl-v23-clean',
      name: 'Playlist V23',
      description: 'Creada en pMusic',
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

    expect(screen.queryByText(/^Creada en pMusic$/i)).toBeNull();
    // Cover action lets user customize without a redundant floating "Personalizar" header button
    const coverBtn = screen.getByLabelText('Personalizar portada y banner');
    expect(coverBtn.className).toContain('inset-0');
    expect(screen.getByText(/2 pistas/i)).toBeTruthy();

    act(() => {
      usePMusicStore.setState({
        activeDetailView: {
          kind: 'album',
          data: {
            album: {
              id: 'alb-v23',
              title: 'Album V23',
              artists: [{ id: 'a1', name: 'Cruzzi' }],
              year: 2025,
              thumbnailUrl: 'https://example.com/alb.jpg',
            },
            tracks: [t1, t2],
          },
        },
      });
    });

    const albumHero = screen.getByTestId('album-hero-banner');
    expect(albumHero).toBeTruthy();
    expect(screen.getByText(/SINGLE · 2025/i)).toBeTruthy();
  });

  it('wires Android notification shuffle/repeat controls, missing-cover canvas fallback, and keeps AudioFocus untouched', () => {
    const buildApkSrc = readFileSync(
      resolve(__dirname, '../../../mobile/scripts/build-apk.mjs'),
      'utf-8'
    );
    expect(buildApkSrc).toContain('CUSTOM_ACTION_SHUFFLE');
    expect(buildApkSrc).toContain('CUSTOM_ACTION_REPEAT');
    expect(buildApkSrc).toContain('buildMissingCoverBitmap');
    expect(buildApkSrc).toContain('No se pudo cargar');
    expect(buildApkSrc).toContain('ic_media_shuffle_on');
    expect(buildApkSrc).toContain('ic_media_repeat_one');
    expect(buildApkSrc).toContain('downloadAndInstallUpdate');
    expect(buildApkSrc.includes('requestAudioFocus')).toBe(false);
  });

  it('configures Electron DiscordRpcManager, OAuth --app= window auto-close, and silent updater', () => {
    const buildElectronSrc = readFileSync(
      resolve(__dirname, '../../../desktop/scripts/build-electron.mjs'),
      'utf-8'
    );
    const buildInstallerSrc = readFileSync(
      resolve(__dirname, '../../../desktop/scripts/build-custom-installer.mjs'),
      'utf-8'
    );
    expect(buildElectronSrc).toContain('scheduleCloseOAuthBrowserWindow');
    expect(buildElectronSrc).toContain('GetWindowThreadProcessId');
    expect(buildElectronSrc).toContain("'--app='");
    expect(buildElectronSrc).toContain('DiscordRpcManager');
    expect(buildElectronSrc).toContain('pmusic:configure-discord');
    expect(buildElectronSrc).toContain('pmusic:get-discord-status');
    expect(buildElectronSrc).toContain('0x0010');
    expect(buildElectronSrc).toContain('Sesión iniciada');
    expect(buildElectronSrc).toContain('pmusic:check-and-apply-update');
    expect(buildInstallerSrc).toContain('/silent');
    expect(buildInstallerSrc).toContain('/relaunch');
  });

  it('wires custom pMusic vector icons in APK build and hides Discord RPC on mobile settings', () => {
    const buildApkSrc = readFileSync(
      resolve(__dirname, '../../../mobile/scripts/build-apk.mjs'),
      'utf-8'
    );
    expect(buildApkSrc).toMatch(/versionName="0\.23\.\d+"/);
    expect(buildApkSrc).toContain('ic_media_play.xml');
    expect(buildApkSrc).toContain('ic_media_pause.xml');
    expect(buildApkSrc).toContain('ic_media_prev.xml');
    expect(buildApkSrc).toContain('ic_media_next.xml');
    expect(buildApkSrc).toContain('R.drawable.ic_media_play');
    expect(buildApkSrc).toContain('R.drawable.ic_media_pause');
    expect(buildApkSrc).toContain('downloadAndInstallOtaBundle');
    expect(buildApkSrc).toContain('ota_web/current');

    // Mobile SettingsModal hides Discord category
    const origInnerWidth = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: 390,
    });
    window.dispatchEvent(new Event('resize'));
    act(() => {
      usePMusicStore.getState().openSettingsCategory('apariencia');
    });
    render(<SettingsModal />);
    expect(screen.queryByTestId('settings-category-discord')).toBeNull();

    cleanup();
    // Desktop SettingsModal exposes Discord category + 3-step guide
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: 1280,
    });
    window.dispatchEvent(new Event('resize'));
    act(() => {
      usePMusicStore.getState().openSettingsCategory('discord');
    });
    render(<SettingsModal />);
    expect(screen.getByTestId('settings-category-discord')).toBeTruthy();
    expect(screen.getByText(/Cómo activar Discord RPC en Windows/i)).toBeTruthy();

    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: origInnerWidth,
    });
    window.dispatchEvent(new Event('resize'));
  });

  it('rejects legacy mix_cruz_urbano_es home cache entries and tracks homeFeedReady', () => {
    expect(typeof usePMusicStore.getState().homeFeedReady).toBe('boolean');
    const storeSrc = readFileSync(
      resolve(__dirname, '../store/usePMusicStore.ts'),
      'utf-8'
    );
    expect(storeSrc).toContain('pmusic_home_shelves_cache_v3');
    expect(storeSrc).toContain('isLegacyOrFallbackShelves');
  });

  it('renders Último lanzamiento and Última aparición on artist profiles and wires in-splash OTA bundle extraction', () => {
    const t1 = makeTrack(91);
    const collab: Track = {
      id: 'collab-feat-92',
      title: 'LAMINE YAMAL (feat. Cruzzi)',
      artists: [
        { id: 'ext-nemzzz', name: 'Nemzzz' },
        { id: 'ar-cruz', name: 'Cruzzi' },
      ],
      album: { id: 'alb-ext', name: 'LOCKED IN' },
      durationSec: 178,
      thumbnailUrl: 'https://example.com/feat.jpg',
      source: 'ytmusic',
      releaseDate: '2026-11-22',
      releaseYear: 2026,
    };

    act(() => {
      usePMusicStore.setState({
        activeDetailView: {
          kind: 'artist',
          data: {
            artist: { id: 'ar-cruz', name: 'Cruzzi', thumbnailUrl: 'https://example.com/a.jpg' },
            topSongs: [t1],
            appearances: [collab],
            albums: [
              {
                id: 'alb-main',
                title: 'FILIPENSES',
                artists: [{ id: 'ar-cruz', name: 'Cruzzi' }],
                thumbnailUrl: 'https://example.com/alb.jpg',
                year: 2026,
                releaseDate: '2026-11-06',
              },
            ],
            singles: [],
            relatedArtists: [],
          },
        },
      });
    });

    render(<App />);
    const relCard = screen.getByTestId('artist-latest-release-card');
    const appCard = screen.getByTestId('artist-latest-appearance-card');
    expect(relCard.textContent).toContain('FILIPENSES');
    expect(appCard.textContent).toContain('LAMINE YAMAL (feat. Cruzzi)');
    expect(appCard.textContent).toMatch(/Colaboración · feat\./i);

    const buildElectronSrc = readFileSync(
      resolve(__dirname, '../../../desktop/scripts/build-electron.mjs'),
      'utf-8'
    );
    const appUpdaterSrc = readFileSync(
      resolve(__dirname, '../utils/app-updater.ts'),
      'utf-8'
    );
    const otaScriptSrc = readFileSync(
      resolve(__dirname, '../../../../scripts/build-ota-bundle.mjs'),
      'utf-8'
    );
    expect(buildElectronSrc).toContain('extractZipBufferToDir');
    expect(buildElectronSrc).toContain('getActiveWebDistRoot');
    expect(appUpdaterSrc).toContain('ota/latest.json');
    expect(appUpdaterSrc).toContain('downloadAndInstallOtaBundle');
    expect(otaScriptSrc).toContain('pMusic-web-bundle.zip');
  });

  it('isolates fullscreen Queue in memoized NowPlayingQueuePanel without positionSec subscription and throttles canvas FPS', () => {
    const t1 = makeTrack(101);
    const t2 = makeTrack(102);
    const t3 = makeTrack(103);
    act(() => {
      usePMusicStore.setState({
        nowPlayingOpen: true,
        nowPlayingTab: 'Cola',
        currentTrack: t1,
        queue: [t1, t2],
        queueIndex: 0,
        recommendedQueue: [t3],
      });
    });

    render(<App />);
    const queueView = screen.getByTestId('queue-view');
    expect(queueView).toBeTruthy();
    expect(screen.getByTestId('user-queue-section')).toBeTruthy();
    expect(screen.getByTestId('recommended-queue-section')).toBeTruthy();

    const listItems = queueView.querySelectorAll('[role="listitem"]');
    expect(listItems.length).toBeGreaterThanOrEqual(3);
    const firstNextRow = listItems[1] as HTMLElement;
    expect(firstNextRow.style.contentVisibility).toBe('auto');

    const firstImg = queueView.querySelector('[data-testid="user-queue-section"] img') as HTMLImageElement | null;
    expect(firstImg?.getAttribute('loading')).toBe('lazy');

    const queuePanelSrc = readFileSync(
      resolve(__dirname, '../components/NowPlayingQueuePanel.tsx'),
      'utf-8'
    );
    expect(queuePanelSrc).toContain('React.memo');
    expect(queuePanelSrc.includes('s.positionSec')).toBe(false);
    expect(queuePanelSrc.includes('smoothPosSec')).toBe(false);

    const canvasSrc = readFileSync(
      resolve(__dirname, '../components/ExoticBackdropCanvas.tsx'),
      'utf-8'
    );
    expect(canvasSrc).toContain('throttleFps');
  });

  it('holds previous decoded cover visible in NowPlaying during track switch and renders compact mobile transport controls', () => {
    const { container, rerender } = render(
      <TrackArtwork
        trackId="tr-cover-1"
        src="https://example.com/cover1.jpg"
        alt="Track 1"
        variant="nowplaying"
      />
    );
    const img1 = container.querySelector('img');
    expect(img1).not.toBeNull();
    expect(img1?.getAttribute('loading')).toBe('eager');
    expect(img1?.getAttribute('src')).toBe('https://example.com/cover1.jpg');

    rerender(
      <TrackArtwork
        trackId="tr-cover-2"
        src="https://example.com/cover2.jpg"
        alt="Track 2"
        variant="nowplaying"
      />
    );
    const imgDuringLoad = container.querySelector('img');
    expect(imgDuringLoad).not.toBeNull();
    expect(imgDuringLoad?.getAttribute('src')).toBe('https://example.com/cover1.jpg');

    const overlaysSrc = readFileSync(
      resolve(__dirname, '../components/Overlays.tsx'),
      'utf-8'
    );
    // Shuffle & Repeat icons are compact on mobile while Play/Pause and Prev/Next keep desktop proportions
    expect(overlaysSrc).toContain('h-[14px] w-[14px] md:h-[18px] md:w-[18px]');
    expect(overlaysSrc).toContain('h-[52px] w-[52px]');
    expect(overlaysSrc).toContain('h-8 w-8');

    const screensSrc = readFileSync(
      resolve(__dirname, '../components/Screens.tsx'),
      'utf-8'
    );
    expect(screensSrc).toContain('data-testid="artist-like-btn"');
    expect(screensSrc).not.toContain("<span>{isLikedArtist ? 'Favorito' : 'Me gusta'}</span>");
  });

  it('enables adaptive dark ink only for genuinely white or very bright covers while keeping normal vibrant fluid backdrops white-ink', () => {
    // Pure white minimalist cover (e.g. Salto de Fe / FILIPENSES) -> Dark ink ON
    expect(
      shouldUseDarkInkOnBackdrop({
        perceptualLuma: 0.78,
        brightFraction: 0.72,
        backdropStyle: 'fluid',
      })
    ).toBe(true);

    // Rich colorful or medium-bright fluid artwork -> Keep white ink
    expect(
      shouldUseDarkInkOnBackdrop({
        perceptualLuma: 0.42,
        brightFraction: 0.25,
        backdropStyle: 'fluid',
      })
    ).toBe(false);

    // Minimal mode always stays dark glass -> Keep white ink even on white covers
    expect(
      shouldUseDarkInkOnBackdrop({
        perceptualLuma: 0.9,
        brightFraction: 0.95,
        backdropStyle: 'minimal',
      })
    ).toBe(false);

    // Bright pulse/paint canvases also switch to dark ink when >52% perceptual luma
    expect(
      shouldUseDarkInkOnBackdrop({
        perceptualLuma: 0.6,
        brightFraction: 0.52,
        backdropStyle: 'pulse',
      })
    ).toBe(true);
  });

  it('optimizes CDN artwork URLs for cellular data, uses GPU crossfade without ImageData loops, and polishes charcoal dark ink + dots + volume bar', () => {
    const dz1000 = 'https://cdn-images.dzcdn.net/images/cover/abc123/1000x1000-000000-80-0-0.jpg';
    expect(optimizeArtworkUrl(dz1000, 'row', true)).toBe(
      'https://cdn-images.dzcdn.net/images/cover/abc123/250x250-000000-80-0-0.jpg'
    );
    expect(optimizeArtworkUrl(dz1000, 'card', true)).toBe(
      'https://cdn-images.dzcdn.net/images/cover/abc123/250x250-000000-80-0-0.jpg'
    );
    expect(optimizeArtworkUrl(dz1000, 'banner', true)).toBe(
      'https://cdn-images.dzcdn.net/images/cover/abc123/500x500-000000-80-0-0.jpg'
    );
    expect(optimizeArtworkUrl(dz1000, 'banner', false)).toBe(
      'https://cdn-images.dzcdn.net/images/cover/abc123/1000x1000-000000-80-0-0.jpg'
    );

    const ytmBanner = 'https://lh3.googleusercontent.com/xyz987=w1440-h600-p-l90-rj';
    expect(optimizeArtworkUrl(ytmBanner, 'banner', true)).toBe(
      'https://lh3.googleusercontent.com/xyz987=w800-h400-p-l80-rj'
    );
    // Untouched non-CDN URL
    expect(optimizeArtworkUrl('https://example.com/thumb.jpg', 'row', true)).toBe(
      'https://example.com/thumb.jpg'
    );

    const inkSrc = readFileSync(
      resolve(__dirname, '../components/InkBleedCoverTransition.tsx'),
      'utf-8'
    );
    expect(inkSrc).not.toContain('putImageData');
    expect(inkSrc).not.toContain('buildInkField');

    const cssSrc = readFileSync(resolve(__dirname, '../styles/index.css'), 'utf-8');
    expect(cssSrc).toContain('#000000');
    expect(cssSrc).toContain('.pm-indicator-dot');
    expect(cssSrc).toContain('.pm-np-light-surface input[type="range"].pm-range-pill');
    expect(cssSrc).toContain('--pm-ink-transition-ms');
  });

  it('maintains incremental 15-day Descubre pool, locks 24h Daily Mix/Discover, evolves across days, syncs cloud mixes, and caches artists', () => {
    const today = new Date();
    const todayIso = getLocalDayKey(today.getTime());
    const threeDaysAgo = getRollingDaysAgoIso(3, today);
    const twentyDaysAgo = getRollingDaysAgoIso(20, today);
    const yesterdayIso = getRollingDaysAgoIso(1, today);

    const tFreshKept = { ...makeTrack(501), id: 'dz_kept', releaseDate: threeDaysAgo };
    const tExpired = { ...makeTrack(502), id: 'dz_old', releaseDate: twentyDaysAgo };
    const tNewAdded = { ...makeTrack(503), id: 'dz_new', title: 'Nuevo Tema', artists: [{ name: 'Quevedo' }], releaseDate: todayIso };

    const mergedPool = mergeIncrementalDescubrePool(
      [toCompactSyncedTrack(tFreshKept, threeDaysAgo), toCompactSyncedTrack(tExpired, twentyDaysAgo)],
      [tNewAdded],
      today,
      ['Quevedo']
    );
    expect(mergedPool.some((t) => t.id === 'dz_old')).toBe(false);
    expect(mergedPool.some((t) => t.id === 'dz_kept')).toBe(true);
    expect(mergedPool[0]?.id).toBe('dz_new');

    const thirtyPrev = Array.from({ length: 40 }, (_, i) =>
      toCompactSyncedTrack({ ...makeTrack(600 + i), id: `dm_prev_${i}` })
    );
    const fortyFresh = Array.from({ length: 40 }, (_, i) => ({
      ...makeTrack(700 + i),
      id: `dm_fresh_${i}`,
    }));

    // Same calendar day stays 100% locked identical
    const lockedSameDay = evolveDailyPlaylistForNewDay(
      { dayKey: todayIso, generatedAt: 1000, subtitle: 'Today Mix', tracks: thirtyPrev },
      fortyFresh,
      'Fresh Sub',
      todayIso,
      0.65
    );
    expect(lockedSameDay.tracks.map((t) => t.id)).toEqual(thirtyPrev.map((t) => t.id));

    // Cellular failure (<15 tracks) must NOT overwrite existing healthy 40-track mix even on a new day
    const protectedWeak = mergeProtectedEditorialShelves(
      [
        {
          id: 'sh_mixes',
          kind: 'mixes_for_you',
          title: 'Mixes para ti',
          mixes: [
            {
              id: 'mix_descubre_lo_nuevo',
              title: 'Descubre lo Nuevo',
              subtitle: '',
              badge: 'ÚLTIMOS 15 DÍAS',
              coverUrl: '',
              accentColor: '#fff',
              tracks: thirtyPrev.map((c) => ({ ...c, source: 'ytmusic' })),
            },
          ],
        },
      ],
      [
        {
          id: 'sh_mixes',
          kind: 'mixes_for_you',
          title: 'Mixes para ti',
          mixes: [
            {
              id: 'mix_descubre_lo_nuevo',
              title: 'Descubre lo Nuevo',
              subtitle: '',
              badge: 'ÚLTIMOS 15 DÍAS',
              coverUrl: '',
              accentColor: '#fff',
              tracks: [makeTrack(999)],
            },
          ],
        },
      ]
    );
    expect(protectedWeak[0]?.mixes?.[0]?.tracks.length).toBe(40);

    // New day rotates ~35% fresh tracks while retaining ~65% continuity
    const evolvedNewDay = evolveDailyPlaylistForNewDay(
      { dayKey: yesterdayIso, generatedAt: 1000, subtitle: 'Yesterday', tracks: thirtyPrev },
      fortyFresh,
      'Today Evolved',
      todayIso,
      0.65
    );
    expect(evolvedNewDay.dayKey).toBe(todayIso);
    expect(evolvedNewDay.tracks.some((t) => t.id.startsWith('dm_prev_'))).toBe(true);
    expect(evolvedNewDay.tracks.some((t) => t.id.startsWith('dm_fresh_'))).toBe(true);

    // Cloud merge combines Descubre tracks from both devices and picks today's locked Daily Mix
    const cloudMerged = mergeCloudEditorialMixes(
      {
        version: 1,
        ownerUserId: 'u1',
        updatedAt: 2000,
        descubre: { lastScanAt: 2000, lastScanDay: todayIso, tracks: [toCompactSyncedTrack(tFreshKept)] },
        dailyMix: { dayKey: yesterdayIso, generatedAt: 1000, subtitle: 'Old', tracks: thirtyPrev },
        dailyDiscover: null,
      },
      {
        version: 1,
        ownerUserId: 'u1',
        updatedAt: 2500,
        descubre: { lastScanAt: 2500, lastScanDay: todayIso, tracks: [toCompactSyncedTrack(tNewAdded)] },
        dailyMix: { dayKey: todayIso, generatedAt: 2500, subtitle: 'Today PC', tracks: thirtyPrev },
        dailyDiscover: null,
      },
      today,
      ['Quevedo']
    );
    expect(cloudMerged?.descubre.tracks.length).toBe(2);
    expect(cloudMerged?.dailyMix?.dayKey).toBe(todayIso);

    // Persisted artist detail cache round-trips cleanly
    writePersistedArtistCache('artist:6705223', {
      artist: { id: '6705223', name: 'Quevedo', thumbnailUrl: 'https://example.com/q.jpg' },
      topSongs: [tNewAdded],
      albums: [],
      singles: [],
      relatedArtists: [],
    });
    expect(readPersistedArtistCache('artist:6705223')?.data.artist.name).toBe('Quevedo');
  });

  it('v0.23.9 restores GPU WebGL ink-bleed crossfade, avoids :root RAF DOM storms, supports desktopMode backdrop, and sizes playlist play larger than artist play on the right', () => {
    expect(typeof prefetchInkCoverImage).toBe('function');
    prefetchInkCoverImage('https://example.com/ink-prefetch.jpg');

    render(
      <InkBleedCoverTransition
        outgoingUrl="https://example.com/out.jpg"
        outgoingTitle="Outgoing Song"
        incomingUrl="https://example.com/in.jpg"
        incomingTitle="Incoming Song"
        seedKey="out:in"
        durationSec={4}
      />
    );
    const inkWrap = screen.getByTestId('ink-bleed-cover');
    expect(inkWrap.querySelector('canvas')).toBeTruthy();
    const inImg = screen.getByAltText('Incoming Song') as HTMLImageElement;
    expect(inImg.style.transform).toContain('scale(1.035');
    cleanup();

    // MobileFluidBackdropCanvas supports desktopMode without restarting RAF on coverUrl updates
    const { rerender } = render(
      <MobileFluidBackdropCanvas
        desktopMode
        coverUrl="https://example.com/a.jpg"
        crossfadeMs={950}
        crossfadeLinear={false}
        ambientMotionEnabled
        reducedMotionPref={false}
      />
    );
    const canvasEl = screen.getByTestId('live-backdrop-img') as HTMLCanvasElement;
    expect(canvasEl.width).toBe(240);
    expect(canvasEl.height).toBe(144);
    rerender(
      <MobileFluidBackdropCanvas
        desktopMode
        coverUrl="https://example.com/b.jpg"
        crossfadeMs={950}
        crossfadeLinear={false}
        ambientMotionEnabled
        reducedMotionPref={false}
      />
    );
    expect(screen.getByTestId('live-backdrop-img')).toBe(canvasEl);
    cleanup();

    // cover-color triggers single CSS @property update on :root without per-frame style.setProperty spam
    const spySetProp = vi.spyOn(document.documentElement.style, 'setProperty');
    animateAmbientPaletteFromCover({ ...makeTrack(501), thumbnailUrl: '' }, 1400);
    expect(spySetProp.mock.calls.some(([prop]) => prop === '--pm-ambient-transition-ms')).toBe(true);
    expect(spySetProp.mock.calls.some(([prop]) => prop === '--pm-ambient-1')).toBe(true);
    spySetProp.mockRestore();

    // Artist profile Play button uses larger size (h-16 / sm:h-[72px])
    const artistTrack = makeTrack(701);
    act(() => {
      usePMusicStore.setState({
        activeDetailView: {
          kind: 'artist',
          data: {
            artist: { id: 'ar-hero', name: 'Quevedo', thumbnailUrl: 'https://example.com/q.jpg' },
            topSongs: [artistTrack],
            albums: [],
            singles: [],
            relatedArtists: [],
          },
        },
      });
    });
    render(<DetailViewPanel />);
    const artistPlayBtn = screen.getByTestId('artist-play-btn');
    expect(artistPlayBtn.className).toContain('h-16');
    expect(artistPlayBtn.className).toContain('sm:h-[72px]');
    cleanup();

    // Playlist detail places right-aligned actions with Play button larger than artist profile (h-[72px] / sm:h-[86px])
    const pl: PlaylistRecord = {
      id: 'pl-hero-right',
      name: 'LaPanera',
      description: '',
      source: 'local',
      tracks: [artistTrack],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    act(() => {
      usePMusicStore.setState({
        playlists: [pl],
        activeDetailView: { kind: 'local_playlist', playlistId: pl.id },
      });
    });
    render(<DetailViewPanel />);
    const playlistPlayBtn = screen.getByRole('button', { name: /^Reproducir$/i });
    const moreBtn = screen.getByTestId('playlist-more-actions-btn');
    expect(playlistPlayBtn.className).toContain('h-[72px]');
    expect(playlistPlayBtn.className).toContain('sm:h-[86px]');
    expect(moreBtn.parentElement?.className).toContain('justify-end');
    cleanup();
  });

  it('v0.23.10 clears stale crossfade/dock animation on foreground resume, disables Electron background throttling on restore/show, and uses pure black light-surface ink', () => {
    const electronSrc = readFileSync(
      resolve(__dirname, '../../../desktop/scripts/build-electron.mjs'),
      'utf-8'
    );
    expect(electronSrc).toContain('setBackgroundThrottling(false)');
    expect(electronSrc).toContain('.invalidate()');

    const appSrc = readFileSync(resolve(__dirname, '../App.tsx'), 'utf-8');
    expect(appSrc).toContain('!isAppHidden &&');

    const tOut = makeTrack(801);
    const tIn = makeTrack(802);
    act(() => {
      usePMusicStore.setState({
        isAppHidden: true,
        isTransitioning: true,
        transitionProgress01: 0.8,
        outgoingTransitionTrack: tOut,
        incomingTransitionTrack: tIn,
        currentTrack: tIn,
      });
    });

    act(() => {
      usePMusicStore.getState().setAppHidden(false);
    });
    expect(usePMusicStore.getState().isAppHidden).toBe(false);
    expect(usePMusicStore.getState().isTransitioning).toBe(false);
    expect(usePMusicStore.getState().outgoingTransitionTrack).toBeNull();
    expect(usePMusicStore.getState().incomingTransitionTrack).toBeNull();
  });

  it('v0.23.12 auto-purges stale v1 Descubre cloud caches, ranks library artists higher, restores NowPlaying Play morph CSS, and uses multi-directional Pintura drift', () => {
    const todayIso = getLocalDayKey();
    const v2Local = {
      version: 1 as const,
      ownerUserId: 'usr-1',
      updatedAt: 200,
      descubre: {
        lastScanAt: 200,
        lastScanDay: todayIso,
        algoVersion: DESCUBRE_ALGO_VERSION,
        tracks: [
          toCompactSyncedTrack(
            {
              ...makeTrack(901),
              id: 'clean_jhayco',
              title: 'X',
              artists: [{ id: 'ar-jhayco', name: 'Jhayco' }],
              releaseDate: todayIso,
            },
            todayIso
          ),
        ],
      },
      dailyMix: null,
      dailyDiscover: null,
    };
    const v1Cloud = {
      version: 1 as const,
      ownerUserId: 'usr-1',
      updatedAt: 300,
      descubre: {
        lastScanAt: 300,
        lastScanDay: todayIso,
        tracks: [
          toCompactSyncedTrack(
            {
              ...makeTrack(902),
              id: 'stale_lana',
              title: 'Off-Genre Pop',
              artists: [{ id: 'ar-lana', name: 'Lana Del Rey' }],
              releaseDate: todayIso,
            },
            todayIso
          ),
        ],
      },
      dailyMix: null,
      dailyDiscover: null,
    };

    const keptV2 = mergeCloudEditorialMixes(v2Local, v1Cloud, new Date(), [], ['Anmi', 'Jhayco']);
    expect(keptV2?.descubre.algoVersion).toBe(DESCUBRE_ALGO_VERSION);
    expect(keptV2?.descubre.tracks.map((t) => t.id)).toEqual(['clean_jhayco']);

    const upgradedToV2 = mergeCloudEditorialMixes(v1Cloud, v2Local, new Date(), [], ['Anmi', 'Jhayco']);
    expect(upgradedToV2?.descubre.algoVersion).toBe(DESCUBRE_ALGO_VERSION);
    expect(upgradedToV2?.descubre.tracks.map((t) => t.id)).toEqual(['clean_jhayco']);

    const ranked = mergeIncrementalDescubrePool(
      [],
      [
        {
          ...makeTrack(903),
          id: 'editorial_other',
          title: 'Other',
          artists: [{ name: 'Random Editorial' }],
          releaseDate: todayIso,
        },
        {
          ...makeTrack(904),
          id: 'lib_anmi',
          title: 'SECRETNOVIO',
          artists: [{ name: 'Anmi' }],
          releaseDate: todayIso,
        },
      ],
      new Date(),
      [],
      ['Anmi']
    );
    expect(ranked[0]?.id).toBe('lib_anmi');

    const exoticSrc = readFileSync(resolve(__dirname, '../components/ExoticBackdropCanvas.tsx'), 'utf-8');
    expect(exoticSrc).toContain('driftQ');
    expect(exoticSrc).toContain('driftR');

    const cssSrc = readFileSync(resolve(__dirname, '../styles/index.css'), 'utf-8');
    expect(cssSrc).not.toContain('h1, button, svg');
  });

  it('v0.23.13 fixes Jam link splash & routing, locks guest audio/transport while allowing personal settings and queue edits, and renders unboxed pMusic mark + TrackArtwork', async () => {
    // 1. Verify vercel.json & vite.config.ts asset routing on nested /jam/:code links
    const vercelSrc = readFileSync(resolve(__dirname, '../../../../vercel.json'), 'utf-8');
    expect(vercelSrc).toContain('/jam/assets/(.*)');
    expect(vercelSrc).toContain('/jam/favicon.svg');
    const viteSrc = readFileSync(resolve(__dirname, '../../vite.config.ts'), 'utf-8');
    expect(viteSrc).toContain("process.env.VERCEL === '1' ? '/' : './'");

    // 2. Verify PMusicLogo variant="mark" renders pure unboxed SVG glyph (no square icon frame)
    const { container: markContainer } = render(<PMusicLogo variant="mark" size={28} color="#FFFFFF" />);
    expect(markContainer.querySelector('svg')).not.toBeNull();
    expect(markContainer.querySelector('rect')).toBeNull();
    cleanup();

    // 3. Verify NowPlayingQueuePanel & App En Reproducción use TrackArtwork instead of raw cover img tags
    const queuePanelSrc = readFileSync(
      resolve(__dirname, '../components/NowPlayingQueuePanel.tsx'),
      'utf-8'
    );
    expect(queuePanelSrc).toContain('<TrackArtwork');
    expect(queuePanelSrc).not.toContain('<img');

    // 4. Verify PublicJamGuestPage immediately dismisses #pm-boot-splash and provides interactive UI + host locks
    const splashEl = document.createElement('div');
    splashEl.id = 'pm-boot-splash';
    document.body.appendChild(splashEl);
    localStorage.setItem('pmusic.jam.guestName', 'Ana');

    const tNow = makeTrack(950);
    const tQ1 = { ...makeTrack(951), id: 'jam-q-1', title: 'LA PRUEBA', artists: [{ id: 'ar-rc', name: 'Raul Clyde' }], thumbnailUrl: '' };
    const tQ2 = { ...makeTrack(952), id: 'jam-q-2', title: 'Segundos', artists: [{ id: 'ar-q2', name: 'Quevedo' }] };
    const queueOpsSent: string[] = [];

    const origFetch = globalThis.fetch;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('jam_sessions')) {
          return new Response(
            JSON.stringify({
              code: 'AB3K9P',
              host_user_id: 'host-user-1',
              host_name: 'Pablo',
              current_track: {
                ...tNow,
                __jamSync: {
                  positionSec: 42,
                  updatedAtMs: Date.now(),
                  isPlaying: true,
                  djEnabled: false,
                  crossfadeEnabled: true,
                  crossfadeSec: 6,
                  eqEnabled: true,
                  eqPreset: 'bass',
                },
              },
              queue: [tNow, tQ1, tQ2],
              is_playing: true,
              allow_guest_direct_add: true,
              max_requests_per_guest: 0,
              active: true,
              updated_at: new Date().toISOString(),
            }),
            { status: 200, headers: { 'content-type': 'application/json' } }
          );
        }
        if (url.includes('jam_requests')) {
          if (init?.method === 'POST' && typeof init.body === 'string') {
            queueOpsSent.push(init.body);
            return new Response(JSON.stringify([{ id: 'op-1', jam_code: 'AB3K9P', guest_name: 'Ana', track_data: {}, status: 'approved', created_at: new Date().toISOString() }]), {
              status: 201,
              headers: { 'content-type': 'application/json' },
            });
          }
          return new Response(JSON.stringify([]), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ data: [], results: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      })
    );

    try {
      render(<PublicJamGuestPage code="AB3K9P" />);
      await act(async () => {
        await new Promise((r) => setTimeout(r, 40));
      });

      expect(splashEl.classList.contains('pm-splash-hide')).toBe(true);
      expect(screen.getAllByText(/Solo el jefe de la Jam/i).length).toBeGreaterThan(0);

      // Transport play button is locked for Jam guests
      const lockedBtns = screen.getAllByTestId('jam-guest-play-locked-btn');
      expect((lockedBtns[0] as HTMLButtonElement).disabled).toBe(true);

      // Move queue item up + remove item as guest
      const moveUpBtns = screen.getAllByRole('button', { name: /Subir Segundos en la cola/i });
      await act(async () => {
        fireEvent.click(moveUpBtns[0]!);
      });
      expect(queueOpsSent.some((b) => b.includes('"__jamOp":"move"'))).toBe(true);

      // Open Guest Settings: backdrop is interactive while Crossfade/EQ/DJ are locked
      await act(async () => {
        fireEvent.click(screen.getByTestId('jam-guest-settings-btn'));
      });
      expect(screen.getByTestId('jam-guest-settings-modal')).toBeTruthy();
      expect(screen.getByTestId('jam-guest-audio-locked').textContent).toContain(
        'Solo el jefe de la Jam puede cambiar esto'
      );
      await act(async () => {
        fireEvent.click(screen.getByTestId('jam-guest-backdrop-pulse'));
      });
      expect(JSON.parse(localStorage.getItem('pmusic.jam.guestPrefs') || '{}').backdropStyle).toBe('pulse');
    } finally {
      vi.stubGlobal('fetch', origFetch);
      localStorage.removeItem('pmusic.jam.guestName');
      localStorage.removeItem('pmusic.jam.guestPrefs');
      splashEl.remove();
    }
  });

  it('v0.23.14 enforces official Deezer cover specs & 3G/E data saver, strict 15-day Descubre pool, FIFO priority queue above playlist, and Spotify swipe gestures + AddToPlaylistModal', async () => {
    // 1. Official Deezer CDN specs + Data Saver mode (56x56 rows, 250x250 cards)
    const sampleDz = 'https://cdn-images.dzcdn.net/images/cover/afe01aaef4d2afd9ed5f6026669d9879/500x500-000000-80-0-0.jpg';
    setDataSaverMode(false);
    expect(optimizeArtworkUrl(sampleDz, 'row', false)).toContain('250x250-000000-80-0-0.jpg');
    expect(optimizeArtworkUrl(sampleDz, 'nowplaying', false)).toContain('1000x1000-000000-80-0-0.jpg');
    setDataSaverMode(true);
    expect(optimizeArtworkUrl(sampleDz, 'row', true)).toContain('56x56-000000-80-0-0.jpg');
    expect(optimizeArtworkUrl(sampleDz, 'nowplaying', true)).toContain('250x250-000000-80-0-0.jpg');
    setDataSaverMode(false);

    // 2. Strict <= 15-day rule in mergeIncrementalDescubrePool (never uses addedAtDay fallback or >15d tracks)
    expect(DESCUBRE_ALGO_VERSION).toBeGreaterThanOrEqual(3);
    const todayIso = getLocalDayKey();
    const old20Iso = getRollingDaysAgoIso(20);
    const poolResult = mergeIncrementalDescubrePool(
      [
        toCompactSyncedTrack({ ...makeTrack(1), id: 'old-villa', releaseDate: old20Iso }, todayIso),
        toCompactSyncedTrack({ ...makeTrack(2), id: 'undated-item', releaseDate: undefined }, todayIso),
      ],
      [
        { ...makeTrack(3), id: 'fresh-release', releaseDate: todayIso },
      ],
      new Date()
    );
    expect(poolResult.map((t) => t.id)).toEqual(['fresh-release']);

    // 3. FIFO Priority User Queue while playing a playlist:
    // Queue = [Playing, P1, P2]. addToQueue(A) -> [Playing, A, P1, P2]. addToQueue(B) -> [Playing, A, B, P1, P2].
    const tNow = makeTrack(101);
    const tP1 = makeTrack(102);
    const tP2 = makeTrack(103);
    const tA = makeTrack(104);
    const tB = makeTrack(105);
    const createdPlaylist = await usePMusicStore.getState().createPlaylist('Favs Urban');
    await usePMusicStore.getState().addTrackToPlaylist(createdPlaylist.id, tP1);

    usePMusicStore.setState({
      currentTrack: tNow,
      queue: [tNow, tP1, tP2],
      queueIndex: 0,
      userQueueCount: 0,
      addToPlaylistModalTrack: null,
    });

    usePMusicStore.getState().addToQueue(tA);
    usePMusicStore.getState().addToQueue(tB);
    expect(usePMusicStore.getState().queue.map((t) => t.id)).toEqual([
      tNow.id,
      tA.id,
      tB.id,
      tP1.id,
      tP2.id,
    ]);
    expect(usePMusicStore.getState().userQueueCount).toBe(2);

    // 4. SwipeableTrackRow left swipe -> add to queue, right swipe -> open playlist modal
    const onLeft = vi.fn();
    const onRight = vi.fn();
    render(
      <SwipeableTrackRow onSwipeLeft={onLeft} onSwipeRight={onRight}>
        <div>Row Content</div>
      </SwipeableTrackRow>
    );
    const swipeWrap = screen.getByTestId('swipeable-track-row');
    fireEvent.touchStart(swipeWrap, { touches: [{ clientX: 200, clientY: 100 }] });
    fireEvent.touchMove(swipeWrap, { touches: [{ clientX: 100, clientY: 102 }] });
    fireEvent.touchEnd(swipeWrap);
    expect(onLeft).toHaveBeenCalledTimes(1);

    fireEvent.touchStart(swipeWrap, { touches: [{ clientX: 50, clientY: 100 }] });
    fireEvent.touchMove(swipeWrap, { touches: [{ clientX: 150, clientY: 102 }] });
    fireEvent.touchEnd(swipeWrap);
    expect(onRight).toHaveBeenCalledTimes(1);
    cleanup();

    // 5. AddToPlaylistModal interactive toggle
    usePMusicStore.setState({ addToPlaylistModalTrack: tA });
    render(<AddToPlaylistModal />);
    expect(screen.getByTestId('add-to-playlist-modal')).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByTestId(`playlist-picker-row-${createdPlaylist.id}`));
    });
    expect(
      usePMusicStore.getState().playlists.find((p) => p.id === createdPlaylist.id)?.tracks.some((t) => t.id === tA.id)
    ).toBe(true);
    cleanup();
    usePMusicStore.setState({ addToPlaylistModalTrack: null });

    // 6. Verify ExoticBackdropCanvas portrait zoom + mobile FPS throttle + __pmusicAppBackgrounded hook
    const exoticSrc = readFileSync(resolve(__dirname, '../components/ExoticBackdropCanvas.tsx'), 'utf-8');
    expect(exoticSrc).toContain('mix(1.38, 0.74, isPortrait)');
    expect(exoticSrc).toContain('mix(1.0, 0.44, isPortrait)');
    expect(exoticSrc).toContain('__pmusicAppBackgrounded');
  });
});
