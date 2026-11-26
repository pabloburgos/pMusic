// @vitest-environment jsdom
import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { App } from '../App.tsx';
import { SettingsModal } from '../components/SettingsModal.tsx';
import { TrackArtwork } from '../components/TrackArtwork.tsx';
import { compareSemver } from '../utils/app-updater.ts';
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
  it('hides list cover on offline failure and renders pMusic fallback in NowPlaying', async () => {
    act(() => {
      usePMusicStore.setState({ isOfflineNetwork: true });
    });

    const listRender = render(
      <TrackArtwork
        trackId="missing-offline-cover"
        src="https://example.com/missing.jpg"
        alt="Offline Song"
        variant="list"
      />
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(listRender.container.querySelector('img')).toBeNull();
    expect(listRender.container.textContent).toBe('');

    render(
      <TrackArtwork
        trackId="missing-offline-cover"
        src="https://example.com/missing.jpg"
        alt="Offline Song"
        variant="nowplaying"
      />
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTestId('nowplaying-missing-cover')).toBeTruthy();
    expect(screen.getByText(/No se consiguió cargar la portada/i)).toBeTruthy();
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

  it('configures Electron OAuth auto-close window helper and silent installer updater flags', () => {
    const buildElectronSrc = readFileSync(
      resolve(__dirname, '../../../desktop/scripts/build-electron.mjs'),
      'utf-8'
    );
    const buildInstallerSrc = readFileSync(
      resolve(__dirname, '../../../desktop/scripts/build-custom-installer.mjs'),
      'utf-8'
    );
    expect(buildElectronSrc).toContain('scheduleCloseOAuthBrowserWindow');
    expect(buildElectronSrc).toContain('0x0010');
    expect(buildElectronSrc).toContain('Sesión iniciada');
    expect(buildElectronSrc).toContain('pmusic:check-and-apply-update');
    expect(buildInstallerSrc).toContain('/silent');
    expect(buildInstallerSrc).toContain('/relaunch');
  });
});
