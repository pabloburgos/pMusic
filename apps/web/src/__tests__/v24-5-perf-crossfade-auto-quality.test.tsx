// @vitest-environment jsdom
import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { HomeEditorialShelf } from '@pmusic/core';
import { rankStreamFormatsForQuality } from '@pmusic/providers';
import { SettingsModal } from '../components/SettingsModal.tsx';
import { AudioStudioSheet } from '../components/Overlays.tsx';
import { HomeScreen } from '../components/Screens.tsx';
import { APP_VERSION } from '../utils/app-updater.ts';
import {
  getLowResPreviewUrl,
  optimizeArtworkUrl,
  setDataSaverMode,
} from '../utils/image-opt.ts';
import {
  getAutoQualityStatusLabel,
  getNetworkSpeedTier,
  isMeteredOrCellularNetwork,
  recordStreamLoadTelemetry,
  resetNetworkQualityTelemetry,
  resolveEffectiveStreamQuality,
} from '../utils/network-quality.ts';
import { usePMusicStore } from '../store/usePMusicStore.ts';

function setConnectionMock(conn?: {
  saveData?: boolean;
  effectiveType?: string;
  type?: string;
  downlink?: number;
  rtt?: number;
}) {
  Object.defineProperty(navigator, 'connection', {
    value: conn,
    configurable: true,
  });
}

afterEach(() => {
  cleanup();
  setDataSaverMode(false);
  resetNetworkQualityTelemetry();
  setConnectionMock(undefined);
  delete (window as unknown as { PMusicNative?: unknown }).PMusicNative;
  vi.restoreAllMocks();
  act(() => {
    usePMusicStore.setState({
      settingsOpen: false,
      eqSheetOpen: false,
      djPopoverOpen: false,
      audioPanelTab: 'dj',
      streamQuality: 'high',
      homeFeedReady: true,
      isOfflineNetwork: false,
    });
  });
});

describe('pMusic v0.24.5 settings version, auto quality, adaptive covers & home skeletons', () => {
  it('shows installed pMusic version badge in Settings on desktop and mobile and exposes Auto quality selector', () => {
    Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true });
    act(() => {
      usePMusicStore.setState({
        settingsOpen: true,
        settingsInitialCategory: 'audio',
        streamQuality: 'auto',
      });
    });

    render(<SettingsModal />);
    const verBadge = screen.getByTestId('settings-app-version');
    expect(verBadge.textContent).toContain(`v${APP_VERSION}`);
    expect(APP_VERSION).toBe('0.24.5');

    const autoBtn = screen.getByTestId('settings-stream-quality-auto');
    expect(autoBtn).toBeTruthy();
    expect(screen.getByTestId('settings-auto-quality-status').textContent).toContain('Auto');
    cleanup();

    Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true });
    (window as unknown as { PMusicNative?: { getAppVersion?: () => string } }).PMusicNative = {
      getAppVersion: () => APP_VERSION,
    };
    render(<SettingsModal />);
    expect(screen.getByTestId('settings-app-version').textContent).toContain(`v${APP_VERSION}`);
  });

  it('adapts Auto stream quality across fast Wi-Fi, metered cellular/3G, slow 2G, and telemetry step-down/recovery', () => {
    setConnectionMock({ effectiveType: '4g', type: 'wifi', downlink: 25, rtt: 35 });
    expect(getNetworkSpeedTier()).toBe('fast');
    expect(isMeteredOrCellularNetwork()).toBe(false);
    expect(resolveEffectiveStreamQuality('auto')).toBe('high');

    setConnectionMock({ effectiveType: '3g', type: 'cellular', downlink: 2.2, rtt: 260 });
    expect(getNetworkSpeedTier()).toBe('moderate');
    expect(isMeteredOrCellularNetwork()).toBe(true);
    expect(resolveEffectiveStreamQuality('auto')).toBe('medium');

    setConnectionMock({ saveData: true, effectiveType: '2g', type: 'cellular', downlink: 0.4, rtt: 600 });
    expect(getNetworkSpeedTier()).toBe('slow');
    expect(resolveEffectiveStreamQuality('auto')).toBe('low');

    // Runtime stall/failure telemetry steps fast Wi-Fi down immediately for reliability, then recovers on fast loads
    setConnectionMock({ effectiveType: '4g', type: 'wifi', downlink: 25, rtt: 35 });
    recordStreamLoadTelemetry(3500, true);
    expect(resolveEffectiveStreamQuality('auto')).toBe('low');
    expect(getAutoQualityStatusLabel()).toContain('Auto · Ligera');

    recordStreamLoadTelemetry(500, false);
    expect(resolveEffectiveStreamQuality('auto')).toBe('medium');
    recordStreamLoadTelemetry(450, false);
    expect(resolveEffectiveStreamQuality('auto')).toBe('high');
  });

  it('optimizes thumb slot to ultra-light dimensions on constrained/mobile and generates low-res blur-up URLs', () => {
    Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true });
    const dz1000 = 'https://cdn-images.dzcdn.net/images/cover/abc123/1000x1000-000000-80-0-0.jpg';
    const googleUrl = 'https://lh3.googleusercontent.com/xyz987=w544-h544-l90-rj';

    expect(optimizeArtworkUrl(dz1000, 'thumb')).toContain('/120x120-000000-80-0-0.jpg');
    expect(optimizeArtworkUrl(googleUrl, 'thumb')).toContain('=w128-h128-l75-rj');

    expect(getLowResPreviewUrl(dz1000)).toContain('/120x120-000000-75-0-0.jpg');
    expect(getLowResPreviewUrl(googleUrl)).toContain('=w120-h120-l70-rj');

    // Desktop fast Wi-Fi uses crisp 250x250 for thumb slots and keeps existing contracts intact
    Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true });
    expect(optimizeArtworkUrl(dz1000, 'thumb')).toContain('/250x250-000000-80-0-0.jpg');
    expect(optimizeArtworkUrl(dz1000, 'row', true)).toContain('/250x250-000000-80-0-0.jpg');
  });

  it('renders Home shimmer skeletons until initial shelves finish loading on cold cellular boot', () => {
    const sampleShelf: HomeEditorialShelf = {
      id: 'sh_listen',
      kind: 'listen_again',
      title: 'Escuchar de nuevo',
      tracks: [
        {
          id: 'tr_1',
          title: 'Track Uno',
          artists: [{ id: 'ar_1', name: 'Artista Uno' }],
          album: { id: 'al_1', name: 'Album Uno' },
          durationSec: 185,
          thumbnailUrl: 'https://cdn-images.dzcdn.net/images/cover/abc123/250x250-000000-80-0-0.jpg',
          source: 'ytmusic',
        },
      ],
    };

    act(() => {
      usePMusicStore.setState({
        homeFeedReady: false,
        homeShelves: [],
        isOfflineNetwork: false,
      });
    });

    render(<HomeScreen />);
    expect(screen.getByTestId('home-loading-skeleton')).toBeTruthy();

    act(() => {
      usePMusicStore.setState({
        homeFeedReady: true,
        homeShelves: [sampleShelf],
      });
    });
    expect(screen.queryByTestId('home-loading-skeleton')).toBeNull();
  });

  it('exposes Auto stream quality in AudioStudioSheet EQ tab and supports auto in yt-stream + build-apk.mjs', () => {
    act(() => {
      usePMusicStore.setState({
        eqSheetOpen: true,
        audioPanelTab: 'eq',
        streamQuality: 'high',
      });
    });

    render(<AudioStudioSheet />);
    const autoBtn = screen.getByTestId('audio-studio-quality-auto');
    expect(autoBtn).toBeTruthy();
    fireEvent.click(autoBtn);
    expect(usePMusicStore.getState().streamQuality).toBe('auto');

    const ranked = rankStreamFormatsForQuality(
      [{ itag: 18, mime_type: 'video/mp4', bitrate: 96_000 }],
      [
        { itag: 140, mime_type: 'audio/mp4; codecs="mp4a.40.2"', bitrate: 129_000 },
        { itag: 251, mime_type: 'audio/webm; codecs="opus"', bitrate: 160_000 },
      ],
      'auto'
    );
    expect(ranked[0]?.itag).toBe(140);

    const buildApkSrc = readFileSync(
      resolve(__dirname, '../../../mobile/scripts/build-apk.mjs'),
      'utf-8'
    );
    expect(buildApkSrc).toContain('android:versionCode="66"');
    expect(buildApkSrc).toContain('android:versionName="0.24.5"');
    expect(buildApkSrc).toContain('if ("auto".equalsIgnoreCase(rawQuality)) return "auto";');
    expect(buildApkSrc).toContain('public String getAppVersion()');
  });
});
