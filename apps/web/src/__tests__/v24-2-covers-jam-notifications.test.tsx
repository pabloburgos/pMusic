// @vitest-environment jsdom
import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { LikedTrackRecord, PlayHistoryRecord, Track } from '@pmusic/core';
import {
  optimizeArtworkUrl,
  setDataSaverMode,
  upgradeCoverUrlToHd,
} from '../utils/image-opt.ts';
import { syncNativeSystemBars } from '../utils/system-bars.ts';
import {
  buildJamShareMessage,
  buildJamTelegramUrl,
  buildJamWhatsAppUrl,
} from '../services/social-service.ts';
import {
  checkArtistNewReleases,
  extractPriorityArtists,
} from '../utils/release-notifications.ts';
import { NowPlayingQueuePanel } from '../components/NowPlayingQueuePanel.tsx';
import { ReleaseNotificationsModal } from '../components/ReleaseNotificationsModal.tsx';
import { usePMusicStore } from '../store/usePMusicStore.ts';
// @ts-expect-error ESM route helper without declaration file
import { injectJamMetaTags } from '../../../../api/jam-page.js';
// @ts-expect-error Pure ESM theme helper without declaration file
import { getJamBannerTheme } from '../../../../api/jam-theme.js';

function makeTrack(id: string, title: string, artistName: string, artistId?: string): Track {
  return {
    id,
    title,
    artists: [{ id: artistId, name: artistName }],
    album: { id: `al_${id}`, name: `${title} Album` },
    durationSec: 190,
    thumbnailUrl: 'https://cdn-images.dzcdn.net/images/cover/abc123/56x56-000000-80-0-0.jpg',
    isExplicit: false,
    source: 'ytmusic',
  };
}

afterEach(() => {
  cleanup();
  setDataSaverMode(false);
  vi.restoreAllMocks();
  delete (window as unknown as { PMusicNative?: unknown }).PMusicNative;
  act(() => {
    usePMusicStore.setState({
      activeJamSession: null,
      activeJamRole: null,
      activeJamRequests: [],
      notificationsPanelOpen: false,
      releaseNotifications: [],
    });
  });
});

describe('pMusic v0.24.2 HD covers, Jam OG, Android bars/widgets, Release Notifications & Jam UI', () => {
  it('upgrades Deezer, Google, Apple mzstatic, Spotify, and YouTube cover URLs to HD even on mobile viewports', () => {
    setDataSaverMode(false);
    Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true });

    expect(
      optimizeArtworkUrl(
        'https://cdn-images.dzcdn.net/images/cover/abc123/56x56-000000-80-0-0.jpg',
        'nowplaying'
      )
    ).toContain('1000x1000-000000-80-0-0.jpg');

    expect(
      optimizeArtworkUrl(
        'https://lh3.googleusercontent.com/xyz=w60-h60-l90-rj',
        'nowplaying'
      )
    ).toContain('=w1000-h1000-l90-rj');

    expect(
      optimizeArtworkUrl(
        'https://is1-ssl.mzstatic.com/image/thumb/Music/v4/aa/bb/cc/100x100bb.jpg',
        'nowplaying'
      )
    ).toContain('/1000x1000bb.jpg');

    expect(
      optimizeArtworkUrl(
        'https://i.scdn.co/image/ab67616d00004851deadbeef123456',
        'card'
      )
    ).toContain('ab67616d0000b273deadbeef123456');

    expect(
      optimizeArtworkUrl('https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg', 'nowplaying')
    ).toContain('/sddefault.jpg');

    expect(
      upgradeCoverUrlToHd(
        'https://cdn-images.dzcdn.net/images/cover/abc123/250x250-000000-80-0-0.jpg'
      )
    ).toContain('1000x1000-000000-80-0-0.jpg');
  });

  it('injects minimal description and unique personalized /api/jam-og image in Jam HTML and generates distinct per-Jam themes', () => {
    const html = `<!doctype html><html><head><title>pMusic</title><meta name="description" content="old" /></head><body><div id="root"></div></body></html>`;
    const rendered = injectJamMetaTags(html, {
      code: '4WQY5B',
      hostName: 'Pablete',
      trackTitle: 'LA PRUEBA',
      trackArtist: 'Raul Clyde',
    });

    expect(rendered).toContain('Tu música sin límites en Windows, Android y Web.');
    expect(rendered).not.toContain('Liquid Glass');
    expect(rendered).toContain('Jam de Pablete · pMusic');
    expect(rendered).toContain('https://pmusic-olive.vercel.app/api/jam-og?code=4WQY5B');

    const tA = getJamBannerTheme('4WQY5B');
    const tB = getJamBannerTheme('AB3K9P');
    const tC = getJamBannerTheme('ZX91LM');
    expect(new Set([tA.name, tB.name, tC.name]).size).toBeGreaterThanOrEqual(2);
    expect(getJamBannerTheme('4wqy5b')).toEqual(tA);
  });

  it('synchronizes meta theme-color and dark system bar icon flag when Now Playing has a white/light cover', () => {
    let meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.setAttribute('name', 'theme-color');
      document.head.appendChild(meta);
    }
    const setBarsSpy = vi.fn();
    (window as unknown as { PMusicNative?: unknown }).PMusicNative = {
      setSystemBarsAppearance: setBarsSpy,
    };

    syncNativeSystemBars({ nowPlayingOpen: true, isLightBackdrop: true, themeId: 'obsidian' });
    expect(meta.getAttribute('content')).toBe('#FFFFFF');
    expect(setBarsSpy).toHaveBeenCalledWith(true, 'transparent', 'transparent');

    syncNativeSystemBars({ nowPlayingOpen: false, isLightBackdrop: true, themeId: 'obsidian' });
    expect(meta.getAttribute('content')).toBe('#070709');
    expect(setBarsSpy).toHaveBeenLastCalledWith(false, '#070709', '#070709');
  });

  it('extracts priority artists from likes and play history and detects recent releases from mocked feeds', async () => {
    const liked: LikedTrackRecord[] = [
      {
        trackId: 't1',
        likedAt: '2026-11-26T10:00:00Z',
        track: makeTrack('t1', 'Luna', 'Quevedo', '123456'),
      },
    ];
    const history: PlayHistoryRecord[] = [
      {
        id: 'h1',
        trackId: 't2',
        playedAt: '2026-11-26T12:00:00Z',
        playedSec: 180,
        completionRatio: 0.95,
        signalType: 'play',
        track: makeTrack('t2', 'Cayo', 'Bad Bunny', '10583405'),
      },
      {
        id: 'h2',
        trackId: 't3',
        playedAt: '2026-11-26T13:00:00Z',
        playedSec: 170,
        completionRatio: 0.9,
        signalType: 'play',
        track: makeTrack('t3', 'Tema', 'Bad Bunny', '10583405'),
      },
    ];
    const priority = extractPriorityArtists(liked, history, 10);
    expect(priority.length).toBe(2);
    expect(priority[0]?.name).toBe('Quevedo');
    expect(priority[0]?.artistId).toBe('123456');

    const now = new Date('2026-11-27T12:00:00Z');
    const mockFetch = vi.fn(async (input: string | URL | Request) => {
      const url = decodeURIComponent(String(input));
      if (url.includes('/api/release-radar')) {
        return {
          ok: true,
          json: async () => ({
            releases: [
              {
                title: 'Estreno En Vivo',
                artists: ['Quevedo'],
                releaseDate: '2026-11-27',
                kind: 'track',
                thumbnailUrl: 'https://cdn-images.dzcdn.net/images/cover/rel1/250x250-000000-80-0-0.jpg',
              },
              {
                title: 'Viejo',
                artists: ['Quevedo'],
                releaseDate: '2026-09-01',
                kind: 'track',
              },
            ],
          }),
        } as unknown as Response;
      }
      if (url.includes('/artist/123456/albums')) {
        return {
          ok: true,
          json: async () => ({
            data: [
              {
                id: 999888,
                title: 'Single Nuevo',
                release_date: '2026-11-25',
                record_type: 'single',
                cover_big: 'https://cdn-images.dzcdn.net/images/cover/rel2/500x500-000000-80-0-0.jpg',
              },
            ],
          }),
        } as unknown as Response;
      }
      return { ok: true, json: async () => ({ data: [] }) } as unknown as Response;
    }) as unknown as typeof fetch;

    const detected = await checkArtistNewReleases(priority, [], { fetchFn: mockFetch, now });
    expect(detected.length).toBe(2);
    expect(detected[0]?.title).toBe('Estreno En Vivo');
    expect(detected[0]?.coverUrl).toContain('1000x1000-000000-80-0-0.jpg');
    expect(detected[1]?.title).toBe('Single Nuevo');
  });

  it('builds WhatsApp/Telegram share links and renders pMusic adaptive Jam controls + release notifications modal', () => {
    const msg = buildJamShareMessage('Pablo', '4WQY5B');
    expect(msg).toContain('Pablo');
    expect(msg).toContain('https://pmusic-olive.vercel.app/jam/4WQY5B');
    expect(buildJamWhatsAppUrl('Pablo', '4WQY5B')).toMatch(/^https:\/\/wa\.me\/\?text=/);
    expect(buildJamTelegramUrl('Pablo', '4WQY5B')).toMatch(/^https:\/\/t\.me\/share\/url\?url=/);

    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    act(() => {
      usePMusicStore.setState({
        activeJamSession: {
          code: '4WQY5B',
          hostUserId: 'u1',
          hostName: 'Pablo',
          currentTrack: makeTrack('t1', 'LA PRUEBA', 'Raul Clyde'),
          queue: [makeTrack('t1', 'LA PRUEBA', 'Raul Clyde')],
          isPlaying: true,
          allowGuestDirectAdd: true,
          maxRequestsPerGuest: 5,
          active: true,
          updatedAt: '2026-11-27T12:00:00Z',
        },
        activeJamRole: 'host',
        notificationsPanelOpen: true,
        releaseNotifications: [
          {
            id: 'rel-1',
            artistName: 'Quevedo',
            title: 'Buenas Noches',
            coverUrl: 'https://cdn-images.dzcdn.net/images/cover/rel1/1000x1000-000000-80-0-0.jpg',
            releaseDate: '2026-11-27',
            recordType: 'single',
            detectedAt: '2026-11-27T12:00:00Z',
            read: false,
          },
        ],
      });
    });

    render(
      <>
        <NowPlayingQueuePanel />
        <ReleaseNotificationsModal />
      </>
    );

    const waBtn = screen.getByTestId('queue-jam-whatsapp-btn');
    fireEvent.click(waBtn);
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(String(openSpy.mock.calls[0]?.[0])).toContain('https://wa.me/?text=');

    expect(screen.getByTestId('queue-jam-control-strip')).toBeTruthy();
    expect(screen.getByTestId('release-notifications-modal')).toBeTruthy();
    expect(screen.getByText('Buenas Noches')).toBeTruthy();
  });

  it('ships dual Android home widgets with API 31 previewLayout, MIUI/Android light status bar icons, and v0.24.2 OTA apkUrl', () => {
    const repoRoot = resolve(__dirname, '../../../../');
    const apkSrc = readFileSync(resolve(repoRoot, 'apps/mobile/scripts/build-apk.mjs'), 'utf-8');
    const otaSrc = readFileSync(resolve(repoRoot, 'scripts/build-ota-bundle.mjs'), 'utf-8');

    expect(apkSrc).toMatch(/android:versionName="0\.24\.\d+"/);
    expect(apkSrc).toContain('PMusicWidgetProvider');
    expect(apkSrc).toContain('PMusicCompactWidgetProvider');
    expect(apkSrc).toContain("resolve(resDir, 'xml-v31')");
    expect(apkSrc).toContain('android:previewLayout="@layout/widget_pmusic"');
    expect(apkSrc).toContain('android:previewLayout="@layout/widget_pmusic_compact"');
    expect(apkSrc).toContain('MiuiWindowManager');
    expect(apkSrc).toContain('SYSTEM_UI_FLAG_LIGHT_STATUS_BAR');
    expect(apkSrc).toContain('showReleaseNotification');

    expect(otaSrc).toMatch(/minNativeVersion:\s*'0\.24\.\d+'/);
    expect(otaSrc).toContain('pMusic-Android.apk');
  });
});
