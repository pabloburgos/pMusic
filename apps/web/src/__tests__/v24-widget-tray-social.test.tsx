// @vitest-environment jsdom
import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { computePeriodTopStats } from '../lib/wrapped-stats.ts';
import { SocialScreen } from '../components/SocialScreen.tsx';
import { SettingsModal } from '../components/SettingsModal.tsx';
import { usePMusicStore } from '../store/usePMusicStore.ts';

afterEach(() => {
  cleanup();
  delete (window as any).pmusicDesktop;
});

describe('pMusic v0.24.0 Android Widget, Windows Tray & Social Live / Top', () => {
  it('computes 7d and 30d personal top stats accurately while excluding older plays', () => {
    const now = new Date('2026-11-27T12:00:00Z').getTime();
    const daysAgoIso = (days: number) => new Date(now - days * 86_400_000).toISOString();

    const mkEvent = (
      id: string,
      trackId: string,
      title: string,
      artist: string,
      genre: string,
      playedSec: number,
      daysAgo: number
    ) => ({
      id,
      trackId,
      title,
      artist,
      genre,
      durationSec: playedSec,
      playedSec,
      completionRatio: 1,
      hourOfDay: 18,
      dayOfWeek: 4,
      deviceType: 'windows' as const,
      sourceContext: 'library',
      isRepeatLoop: false,
      playedAt: daysAgoIso(daysAgo),
    });

    const events = [
      mkEvent('e1', 't1', 'La Prueba', 'Quevedo', 'Reggaeton / Urbano', 180, 2),
      mkEvent('e2', 't1', 'La Prueba', 'Quevedo', 'Reggaeton / Urbano', 180, 5),
      mkEvent('e3', 't2', 'Beso', 'Rosalía', 'Pop', 240, 14),
      mkEvent('e4', 't3', 'Clásico Antiguo', 'Artista Viejo', 'Otro', 600, 45),
    ];

    const top7d = computePeriodTopStats(events, '7d', now);
    expect(top7d.totalPlays).toBe(2);
    expect(top7d.totalMinutes).toBe(6);
    expect(top7d.uniqueTracks).toBe(1);
    expect(top7d.topTracks.map((t) => t.key)).toEqual(['t1']);

    const top30d = computePeriodTopStats(events, '30d', now);
    expect(top30d.totalPlays).toBe(3);
    expect(top30d.totalMinutes).toBe(10);
    expect(top30d.uniqueTracks).toBe(2);
    expect(top30d.topTracks.map((t) => t.key)).toEqual(['t1', 't2']);
    expect(top30d.topArtists.map((a) => a.title)).toEqual(['Quevedo', 'Rosalía']);
  });

  it('renders SocialScreen live friend activity cards, privacy switch, and Mi Top (7d / 30d) tab', async () => {
    const spyPlayFriend = vi.fn(async () => {});
    const spyLoadTop = vi.fn(async (win: '7d' | '30d') => ({
      window: win,
      totalMinutes: win === '7d' ? 42 : 185,
      totalPlays: win === '7d' ? 12 : 54,
      uniqueTracks: 8,
      uniqueArtists: 4,
      topTracks: [
        {
          key: 'top-1',
          title: win === '7d' ? 'Tema Semanal' : 'Tema Mensual',
          subtitle: 'Artista Top',
          plays: win === '7d' ? 5 : 19,
          minutes: win === '7d' ? 15 : 60,
        },
      ],
      topArtists: [
        {
          key: 'artista top',
          title: 'Artista Top',
          plays: 19,
          minutes: 60,
        },
      ],
      topGenres: [],
    }));

    const prevPlayFriend = usePMusicStore.getState().playFriendActivityTrack;
    const prevLoadTop = usePMusicStore.getState().loadPersonalTopStats;

    usePMusicStore.setState({
      authState: {
        connected: true,
        userId: 'me-1',
        email: 'me@pmusic.app',
        displayName: 'Yo',
      } as any,
      socialSubTab: 'amigos',
      shareListeningActivity: true,
      friends: [
        {
          id: 'fr-1',
          requesterId: 'me-1',
          addresseeId: 'friend-1',
          status: 'accepted',
          isIncoming: false,
          otherProfile: {
            userId: 'friend-1',
            username: 'carlos',
            displayName: 'Carlos',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        },
      ],
      friendActivities: {
        'friend-1': {
          userId: 'friend-1',
          username: 'carlos',
          displayName: 'Carlos',
          trackId: 'tr-live-1',
          trackTitle: 'Columbia',
          trackArtist: 'Quevedo',
          isPlaying: true,
          updatedAt: new Date().toISOString(),
        },
      },
      playFriendActivityTrack: spyPlayFriend,
      loadPersonalTopStats: spyLoadTop,
    });

    const { rerender } = render(<SocialScreen />);

    // Privacy switch defaults to ON (true) and toggles cleanly
    const shareToggle = screen.getByTestId('social-share-listening-toggle');
    expect(shareToggle.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(shareToggle);
    expect(usePMusicStore.getState().shareListeningActivity).toBe(false);

    // Live friend activity card + Play button
    const liveCard = screen.getByTestId('friend-live-activity-card');
    expect(liveCard.textContent).toContain('Carlos');
    expect(liveCard.textContent).toContain('Columbia');
    fireEvent.click(screen.getByLabelText('Reproducir Columbia'));
    expect(spyPlayFriend).toHaveBeenCalledTimes(1);

    // Switch to Mi Top tab and toggle 7d <-> 30d
    fireEvent.click(screen.getByText('Mi Top'));
    expect(usePMusicStore.getState().socialSubTab).toBe('top');
    usePMusicStore.setState({
      personalTopStats: {
        '7d': await spyLoadTop('7d'),
        '30d': await spyLoadTop('30d'),
      },
    });
    rerender(<SocialScreen />);

    expect(screen.getByTestId('social-top-panel').textContent).toContain('Tema Semanal');
    fireEvent.click(screen.getByTestId('top-window-30d'));
    expect(screen.getByTestId('social-top-panel').textContent).toContain('Tema Mensual');

    usePMusicStore.setState({
      playFriendActivityTrack: prevPlayFriend,
      loadPersonalTopStats: prevLoadTop,
      friendActivities: {},
      friends: [],
      socialSubTab: 'jam',
      shareListeningActivity: true,
    });
  });

  it('exposes Windows System Tray controls in SettingsModal when running in Electron and forwards IPC updates', () => {
    const setDesktopTrayPrefsSpy = vi.fn(async (patch: any) => ({
      minimizeToTrayOnClose: patch.minimizeToTrayOnClose ?? true,
      notifyOnTrackChange: patch.notifyOnTrackChange ?? false,
    }));
    (window as any).pmusicDesktop = {
      runtime: 'electron',
      setDesktopTrayPrefs: setDesktopTrayPrefsSpy,
    };

    usePMusicStore.setState({
      settingsOpen: true,
      settingsInitialCategory: 'cuenta',
      minimizeToTrayOnClose: true,
      desktopTrackNotifications: false,
      shareListeningActivity: true,
    });

    render(<SettingsModal />);
    expect(screen.getByTestId('settings-desktop-tray-section')).toBeTruthy();

    const trayToggle = screen.getByTestId('settings-minimize-to-tray-toggle');
    expect(trayToggle.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(trayToggle);
    expect(usePMusicStore.getState().minimizeToTrayOnClose).toBe(false);
    expect(setDesktopTrayPrefsSpy).toHaveBeenCalledWith({ minimizeToTrayOnClose: false });

    const notifToggle = screen.getByTestId('settings-tray-notifications-toggle');
    expect(notifToggle.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(notifToggle);
    expect(usePMusicStore.getState().desktopTrackNotifications).toBe(true);
    expect(setDesktopTrayPrefsSpy).toHaveBeenCalledWith({ notifyOnTrackChange: true });

    usePMusicStore.setState({
      settingsOpen: false,
      minimizeToTrayOnClose: true,
      desktopTrackNotifications: false,
    });
  });

  it('embeds Android home widget resources/provider in build-apk.mjs with version 0.24.0 and zero AudioFocus calls', () => {
    const src = readFileSync(
      resolve(__dirname, '../../../mobile/scripts/build-apk.mjs'),
      'utf-8'
    );
    expect(src).toMatch(/android:versionCode="(6[1-9]|[7-9]\d)"/);
    expect(src).toMatch(/android:versionName="0\.24\.\d+"/);
    expect(src).toContain('PMusicWidgetProvider.java');
    expect(src).toContain('widget_pmusic.xml');
    expect(src).toContain('pmusic_widget_info.xml');
    expect(src).not.toMatch(/requestAudioFocus|abandonAudioFocus/);
  });
});
