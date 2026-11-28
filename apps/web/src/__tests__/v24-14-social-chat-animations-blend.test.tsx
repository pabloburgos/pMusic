// @vitest-environment jsdom
import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { PlaylistRecord, Track } from '@pmusic/core';
import { buildCurated100Blend } from '../services/social-service.ts';
import { SEARCH_PLACEHOLDER_PHRASES } from '../utils/search-placeholders.ts';
import { ExploreScreen } from '../components/Screens.tsx';
import { FriendProfileView } from '../components/FriendProfileView.tsx';
import { FriendChatPanel } from '../components/FriendChatPanel.tsx';
import App from '../App.tsx';
import { usePMusicStore } from '../store/usePMusicStore.ts';

function makeTrack(id: string, title: string, artist: string): Track {
  return {
    id,
    title,
    artists: [{ id: `ar_${artist.toLowerCase().replace(/\s+/g, '_')}`, name: artist }],
    durationSec: 200,
    thumbnailUrl: 'https://cdn-images.dzcdn.net/images/cover/abc123/250x250-000000-80-0-0.jpg',
    isExplicit: false,
    source: 'ytmusic',
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  document.documentElement.classList.remove('pm-reduced-motion', 'pm-surface-simple');
  act(() => {
    usePMusicStore.setState({
      reducedMotionPref: false,
      surfaceStyle: 'liquid-glass',
      playerBarStyle: 'ambient-dock',
      activeDetailView: null,
      pendingJamJoinCode: null,
      friends: [],
      friendProfilesCache: {},
      directMessagesByFriend: {},
      unreadDmCounts: {},
      activeChatFriendId: null,
    });
  });
});

describe('pMusic v0.24.14 Desktop Animations, Continuous Dock Hover Seekbar, Minimalist Explorar, Blend 100 & Social Network', () => {
  it('removes OS prefers-reduced-motion blockers so Windows laptops keep animations while pm-reduced-motion stops crossfades and keeps lyrics active', () => {
    const css = readFileSync(resolve(process.cwd(), 'apps/web/src/styles/index.css'), 'utf8');
    expect(css).not.toMatch(/@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)/);

    const reducedBlockMatch = css.match(
      /html\.pm-reduced-motion\s+\.pm-ambient-mesh[\s\S]*?animation:\s*none\s*!important;/
    );
    expect(reducedBlockMatch).not.toBeNull();
    const block = reducedBlockMatch![0];
    expect(block).toContain('.pm-cube-prism');
    expect(block).toContain('.pm-dock-color-collapse');
    expect(block).not.toContain('.pm-sing-word');
    expect(block).not.toContain('.pm-kinetic-enter');
    expect(block).not.toContain('.pm-lyrics-swap-in');

    act(() => {
      usePMusicStore.getState().setSurfaceStyle('simple');
    });
    expect(document.documentElement.classList.contains('pm-reduced-motion')).toBe(false);

    act(() => {
      usePMusicStore.getState().setReducedMotionPref(true);
    });
    expect(document.documentElement.classList.contains('pm-reduced-motion')).toBe(true);
  });

  it('moves dock hover hairline & time tooltip smoothly on every pointermove pixel in the same direction across ambient-dock, floating-island, and minimal-wave', () => {
    for (const style of ['ambient-dock', 'floating-island', 'minimal-wave'] as const) {
      cleanup();
      act(() => {
        usePMusicStore.setState({
          playerBarStyle: style,
          currentTrack: { ...makeTrack('d1', 'Cangrinaje', 'Cruzzi'), durationSec: 200 },
          durationSec: 200,
        });
      });
      render(<App />);
      const footer = screen.getByTestId('desktop-player-bar');
      vi.spyOn(footer, 'getBoundingClientRect').mockReturnValue({
        left: 0,
        top: 600,
        right: 1000,
        bottom: 680,
        width: 1000,
        height: 80,
        x: 0,
        y: 600,
        toJSON: () => ({}),
      });

      const hairline = screen.getByTestId('dock-hover-hairline');
      const timePill = screen.getByTestId('dock-hover-time');

      fireEvent.mouseMove(footer, { clientX: 150, clientY: 615 });
      expect(hairline.style.transform).toBe('translate3d(150.0px, 0, 0)');
      expect(timePill.textContent).toBe('0:30');

      // Moving continuously in the SAME direction (rightwards) must immediately update transform & text
      fireEvent.mouseMove(footer, { clientX: 400, clientY: 615 });
      expect(hairline.style.transform).toBe('translate3d(400.0px, 0, 0)');
      expect(timePill.textContent).toBe('1:20');

      fireEvent.mouseMove(footer, { clientX: 750, clientY: 615 });
      expect(hairline.style.transform).toBe('translate3d(750.0px, 0, 0)');
      expect(timePill.textContent).toBe('2:30');
    }
  });

  it('renders minimalist monochrome Explorar without purple sparkles or colorful genre bars and rotates search phrases', () => {
    const { container } = render(<ExploreScreen />);
    expect(screen.getByText('Explorar géneros')).toBeTruthy();
    expect(container.querySelector('.text-purple-300')).toBeNull();
    expect(container.innerHTML).not.toContain('bg-[var(--pm-accent-primary)]/20');

    cleanup();
    render(<App />);
    const topSearchBtn = screen.getByTestId('top-center-search-btn');
    expect(topSearchBtn.getAttribute('aria-label')).toBe('Buscar canciones, artistas o álbumes');
    expect(SEARCH_PLACEHOLDER_PHRASES).toContain(topSearchBtn.textContent?.replace('Ctrl K', '').trim());
  });

  it('generates a curated 100-track Blend filtering junk and mixing both friends with balanced artists', () => {
    const myTracks = Array.from({ length: 45 }, (_, i) =>
      makeTrack(`m_${i}`, `Tema Mio ${i}`, `Artista ${i % 12}`)
    );
    const friendTracks = Array.from({ length: 45 }, (_, i) =>
      makeTrack(`f_${i}`, `Tema Amigo ${i}`, `Artista ${(i + 3) % 14}`)
    );
    const extraPool = [
      makeTrack('junk_1', 'Hit (Karaoke Version)', 'Tribute Band'),
      ...Array.from({ length: 60 }, (_, i) =>
        makeTrack(`e_${i}`, `Discovery ${i}`, `Artista ${(i + 1) % 16}`)
      ),
    ];

    const blend = buildCurated100Blend({
      myTracks,
      myArtists: ['Artista 0', 'Artista 1', 'Artista 2'],
      friendTracks,
      friendArtists: ['Artista 1', 'Artista 5', 'Artista 9'],
      extraPool,
      friendLabel: 'alex',
      targetCount: 100,
    });

    expect(blend.tracks).toHaveLength(100);
    expect(blend.score).toBeGreaterThanOrEqual(62);
    expect(blend.score).toBeLessThanOrEqual(99);
    expect(blend.tracks.some((t) => t.id === 'junk_1')).toBe(false);
    expect(new Set(blend.tracks.map((t) => t.id)).size).toBe(100);
  });

  it('renders FriendProfileView Top 10 & public playlists and FriendChatPanel rich cards (image, playlist, Jam invite)', () => {
    const sampleTrack = makeTrack('t_top1', 'SHARINGAN', 'La Pantera');
    const samplePl: PlaylistRecord = {
      id: 'pl-pub-1',
      name: 'Noche Canaria',
      description: 'Favoritas',
      source: 'local',
      tracks: [sampleTrack],
      createdAt: '2026-11-01T00:00:00Z',
      updatedAt: '2026-11-01T00:00:00Z',
    };

    act(() => {
      usePMusicStore.setState({
        authState: {
          connected: true,
          userId: 'me_1',
          email: 'me@pmusic.es',
          displayName: 'Pablo',
        },
        friends: [
          {
            id: 'fr_1',
            requesterId: 'me_1',
            addresseeId: 'friend_1',
            status: 'accepted',
            isIncoming: false,
            otherProfile: {
              userId: 'friend_1',
              username: 'carlos',
              displayName: 'Carlos',
              avatarUrl: null,
            },
          },
        ],
        friendProfilesCache: {
          friend_1: {
            userId: 'friend_1',
            username: 'carlos',
            displayName: 'Carlos',
            avatarUrl: null,
            bio: 'Solo música',
            publicProfileEnabled: true,
            topTracks: [{ track: sampleTrack, plays: 19, minutes: 58 }],
            topArtists: [{ artistName: 'La Pantera', plays: 25 }],
            publicPlaylists: [
              {
                id: samplePl.id,
                name: samplePl.name,
                trackCount: 1,
                tracks: [sampleTrack],
                kind: 'local',
              },
            ],
          },
        },
        activeChatFriendId: 'friend_1',
        directMessagesByFriend: {
          friend_1: [
            {
              id: 'dm_1',
              senderId: 'friend_1',
              recipientId: 'me_1',
              messageType: 'text',
              body: 'Escucha esto!',
              payload: null,
              readAt: '2026-11-28T12:00:00Z',
              createdAt: '2026-11-28T12:00:00Z',
            },
            {
              id: 'dm_2',
              senderId: 'friend_1',
              recipientId: 'me_1',
              messageType: 'image',
              body: '',
              payload: { imageDataUrl: 'data:image/png;base64,iVBORw0KGgo=' },
              readAt: null,
              createdAt: '2026-11-28T12:01:00Z',
            },
            {
              id: 'dm_3',
              senderId: 'friend_1',
              recipientId: 'me_1',
              messageType: 'playlist',
              body: 'Sesión Vibe',
              payload: { playlistName: 'Sesión Vibe', trackCount: 12, tracks: [sampleTrack] },
              readAt: null,
              createdAt: '2026-11-28T12:02:00Z',
            },
            {
              id: 'dm_4',
              senderId: 'friend_1',
              recipientId: 'me_1',
              messageType: 'jam',
              body: 'Únete',
              payload: { jamCode: 'JAM99Z', jamHostName: 'Carlos', jamTrackTitle: 'SHARINGAN' },
              readAt: null,
              createdAt: '2026-11-28T12:03:00Z',
            },
          ],
        },
      });
    });

    render(<FriendProfileView userId="friend_1" />);
    expect(screen.getByTestId('friend-profile-view')).toBeTruthy();
    expect(screen.getByText('Top 10 canciones')).toBeTruthy();
    expect(screen.getByText('SHARINGAN')).toBeTruthy();
    expect(screen.getByText('Noche Canaria')).toBeTruthy();

    cleanup();
    render(<FriendChatPanel />);
    expect(screen.getByTestId('friend-chat-panel')).toBeTruthy();
    expect(screen.getByText('Escucha esto!')).toBeTruthy();
    expect(screen.getByAltText('Imagen compartida')).toBeTruthy();
    expect(screen.getByText('Sesión Vibe')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Unirse a la Jam/i }));
    expect(usePMusicStore.getState().pendingJamJoinCode).toBe('JAM99Z');
  });
});
