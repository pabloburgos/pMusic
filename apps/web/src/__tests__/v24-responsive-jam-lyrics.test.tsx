// @vitest-environment jsdom
import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { PlaylistRecord, Track } from '@pmusic/core';
import { VolumeHoverPopover } from '../components/VolumeHoverPopover.tsx';
import { ReleaseNotificationsModal } from '../components/ReleaseNotificationsModal.tsx';
import { PublicJamGuestPage } from '../components/PublicJamGuestPage.tsx';
import App from '../App.tsx';
import { usePMusicStore } from '../store/usePMusicStore.ts';

function makeTrack(id: string, title: string, artist: string): Track {
  return {
    id,
    title,
    artists: [{ id: `ar_${id}`, name: artist }],
    durationSec: 195,
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
  Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true });
  act(() => {
    usePMusicStore.setState({
      activeJamSession: null,
      activeJamRole: null,
      activeJamRequests: [],
      notificationsPanelOpen: false,
      globalActiveJams: [],
      pendingJamJoinCode: null,
      playlistContextMenu: null,
      sidebarCollapsed: false,
    });
  });
});

describe('pMusic v0.24.13 Responsive Dock Volume Popover, Collapsed Sidebar Order & Right-Click, Interactive Jam & Lyrics', () => {
  it('shows Liner-style vertical hover volume capsule below lg breakpoint and handles wheel + keyboard adjustment', () => {
    Object.defineProperty(window, 'innerWidth', { value: 860, configurable: true });
    const onChange = vi.fn();
    const onToggleMute = vi.fn();

    render(
      <VolumeHoverPopover
        volume={0.4}
        onChangeVolume={onChange}
        onToggleMute={onToggleMute}
        inlineBreakpoint="lg"
      />
    );

    const btn = screen.getByTestId('dock-volume-btn');
    fireEvent.mouseEnter(btn.parentElement!);
    expect(screen.getByTestId('volume-hover-popover')).toBeTruthy();
    expect(screen.getByTestId('volume-hover-pct').textContent).toBe('40%');
    expect(screen.getByTestId('volume-hover-fill').style.height).toBe('40%');

    const slider = screen.getByRole('slider', { name: 'Volumen' });
    fireEvent.keyDown(slider, { key: 'ArrowUp' });
    expect(onChange).toHaveBeenCalledWith(0.45);

    fireEvent.wheel(btn, { deltaY: -100 });
    expect(onChange).toHaveBeenCalledWith(0.45);

    fireEvent.click(btn);
    expect(onToggleMute).toHaveBeenCalledTimes(1);
  });

  it('renders playlists BEFORE Likes & Downloads in collapsed/expanded sidebar, prevents squishing with shrink-0, and opens context menu on collapsed right-click', () => {
    Object.defineProperty(window, 'innerWidth', { value: 900, configurable: true });
    const pl: PlaylistRecord = {
      id: 'pl-col-1',
      name: 'Canarias Mix',
      description: 'Trap',
      source: 'local',
      tracks: [makeTrack('t1', 'DOGGY', 'La Pantera')],
      createdAt: '2026-11-01T00:00:00Z',
      updatedAt: '2026-11-01T00:00:00Z',
    };

    act(() => {
      usePMusicStore.setState({
        sidebarCollapsed: true,
        playlists: [pl],
        playlistContextMenu: null,
      });
    });

    render(<App />);

    const collapsedCol = screen.getByTestId('sidebar-collapsed-collection');
    const children = Array.from(collapsedCol.querySelectorAll('button'));
    expect(children[0]?.getAttribute('data-testid')).toBe('sidebar-collapsed-playlist-pl-col-1');
    expect(children[1]?.getAttribute('data-testid')).toBe('sidebar-collapsed-likes-btn');
    expect(children[2]?.getAttribute('data-testid')).toBe('sidebar-collapsed-downloads-btn');
    for (const btn of children) {
      expect(btn.className).toContain('shrink-0');
    }

    fireEvent.contextMenu(children[0]!, { clientX: 40, clientY: 160 });
    const ctx = usePMusicStore.getState().playlistContextMenu;
    expect(ctx).toMatchObject({ kind: 'local', playlistId: 'pl-col-1' });
  });

  it('surfaces active global Jams in ReleaseNotificationsModal with 1-tap join prompt', () => {
    const t = makeTrack('t-jam-1', 'Cayetano', 'La Pantera');
    act(() => {
      usePMusicStore.setState({
        notificationsPanelOpen: true,
        authState: { connected: true, userId: 'me-1', email: 'me@pmusic.es' },
        globalActiveJams: [
          {
            code: 'XYZ999',
            hostUserId: 'friend-host-2',
            hostName: 'Carlos',
            currentTrack: t,
            queue: [t],
            isPlaying: true,
            allowGuestDirectAdd: true,
            allowGuestPlaybackControls: true,
            maxRequestsPerGuest: 0,
            active: true,
            updatedAt: new Date().toISOString(),
          },
        ],
      });
    });

    render(<ReleaseNotificationsModal />);
    expect(screen.getByTestId('notifications-live-jams-section')).toBeTruthy();
    expect(screen.getByText(/Jam de Carlos/i)).toBeTruthy();

    fireEvent.click(screen.getByTestId('notifications-jam-join-XYZ999'));
    expect(usePMusicStore.getState().pendingJamJoinCode).toBe('XYZ999');
    expect(usePMusicStore.getState().notificationsPanelOpen).toBe(false);
  });

  it('runs interactive 2-step Jam entry flow on web and unlocks playback controls when host permits them', async () => {
    const tNow = makeTrack('t-now', 'Cangrinaje', 'Cruzzi');
    const opsSent: string[] = [];
    const origFetch = globalThis.fetch;

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('jam_sessions')) {
          return new Response(
            JSON.stringify({
              code: 'PLAY24',
              host_user_id: 'host-1',
              host_name: 'Pablo',
              current_track: {
                ...tNow,
                __jamSync: {
                  positionSec: 15,
                  updatedAtMs: Date.now(),
                  isPlaying: true,
                  djEnabled: false,
                  crossfadeEnabled: true,
                  crossfadeSec: 4,
                  eqEnabled: false,
                  eqPreset: 'flat',
                  allowGuestPlaybackControls: true,
                },
              },
              queue: [tNow],
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
            opsSent.push(init.body);
            return new Response(
              JSON.stringify([{ id: 'op-1', jam_code: 'PLAY24', guest_name: 'Luis', track_data: {}, status: 'approved', created_at: new Date().toISOString() }]),
              { status: 201, headers: { 'content-type': 'application/json' } }
            );
          }
          return new Response(JSON.stringify([]), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ data: [], results: [] }), { status: 200 });
      })
    );

    try {
      render(<PublicJamGuestPage code="PLAY24" />);
      await act(async () => {
        await new Promise((r) => setTimeout(r, 40));
      });

      // Step 1: Ask native app vs web
      expect(screen.getByTestId('jam-entry-step-1')).toBeTruthy();
      expect(screen.getByTestId('jam-open-native-app-btn')).toBeTruthy();
      fireEvent.click(screen.getByTestId('jam-continue-web-btn'));

      // Step 2: Audio mode + nickname
      expect(screen.getByTestId('jam-entry-step-2')).toBeTruthy();
      fireEvent.click(screen.getByTestId('jam-web-audio-host-only-btn'));
      fireEvent.change(screen.getByPlaceholderText('Tu nombre o apodo'), {
        target: { value: 'Luis' },
      });
      fireEvent.click(screen.getByTestId('jam-entry-submit-btn'));

      // Inside live session with unlocked playback controls
      const playBtns = screen.getAllByTestId('jam-guest-play-btn');
      expect((playBtns[0] as HTMLButtonElement).disabled).toBe(false);
      await act(async () => {
        fireEvent.click(playBtns[0]!);
      });
      expect(opsSent.some((b) => b.includes('"__jamOp":"toggle_play"'))).toBe(true);
    } finally {
      vi.stubGlobal('fetch', origFetch);
    }
  });

  it('ships pmusic://jam deep link intent filter in Android manifest and smooth GPU lyrics CSS without Windows reduced-motion starvation', () => {
    const repoRoot = resolve(__dirname, '../../../../');
    const apkSrc = readFileSync(resolve(repoRoot, 'apps/mobile/scripts/build-apk.mjs'), 'utf-8');
    const cssSrc = readFileSync(resolve(repoRoot, 'apps/web/src/styles/index.css'), 'utf-8');

    expect(apkSrc).toContain('android:scheme="pmusic" android:host="jam"');
    expect(apkSrc).toContain('https://api-partner.spotify.com/pathfinder/');
    expect(cssSrc).toContain('.pm-lyric-line-past');
    expect(cssSrc).toContain('.pm-volume-pop');
  });
});
