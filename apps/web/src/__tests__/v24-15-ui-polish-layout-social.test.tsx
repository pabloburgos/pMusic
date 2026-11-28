// @vitest-environment jsdom
import React from 'react';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Track } from '@pmusic/core';
import App from '../App.tsx';
import { DetailViewPanel } from '../components/Screens.tsx';
import { PlaylistCoverArt } from '../components/PlaylistCoverArt.tsx';
import { SettingsModal } from '../components/SettingsModal.tsx';
import { usePMusicStore } from '../store/usePMusicStore.ts';

function makeTrack(
  id: string,
  title: string,
  artist: string,
  extra?: Partial<Track>
): Track {
  return {
    id,
    title,
    artists: [{ id: `ar_${artist.toLowerCase().replace(/\s+/g, '_')}`, name: artist }],
    album: { id: 'al_pantera', name: 'Una Semana Más' },
    durationSec: 192,
    thumbnailUrl: 'https://cdn-images.dzcdn.net/images/cover/abc123/250x250-000000-80-0-0.jpg',
    isExplicit: false,
    source: 'ytmusic',
    ...extra,
  };
}

function setWindowViewport(width: number, height: number) {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    writable: true,
    value: width,
  });
  Object.defineProperty(window, 'innerHeight', {
    configurable: true,
    writable: true,
    value: height,
  });
  window.dispatchEvent(new Event('resize'));
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  setWindowViewport(1280, 800);
  act(() => {
    usePMusicStore.setState({
      activeDetailView: null,
      detailViewHistory: [],
      settingsOpen: false,
      settingsInitialCategory: null,
      rightPanelOpen: true,
      sidebarCollapsed: false,
      currentTrack: undefined,
      friends: [],
      friendProfilesCache: {},
      sharedPlaylists: [],
    });
  });
});

describe('pMusic v0.24.15 UI Polish, Responsive Cascade, Mobile Settings & Friend Profiles', () => {
  it('places addedBy pill immediately next to artist before album name inside TrackListRow', () => {
    const collabTrack = makeTrack('tr_collab_1', 'Party Privado', 'Soge Culebra', {
      addedBy: { userId: 'u_pablo', username: 'pablo', displayName: 'Pablo Burgos' },
    });

    act(() => {
      usePMusicStore.setState({
        activeDetailView: {
          kind: 'album',
          data: {
            album: {
              id: 'al_pantera',
              title: 'Una Semana Más',
              artists: [{ id: 'ar_soge', name: 'Soge Culebra' }],
              year: 2025,
              thumbnailUrl: collabTrack.thumbnailUrl,
            },
            tracks: [collabTrack],
          },
        },
      });
    });

    render(<DetailViewPanel />);
    const pill = screen.getByTestId('track-added-by-pill');
    const rowContainer = pill.parentElement!;
    const fullRowText = rowContainer.textContent ?? '';
    expect(fullRowText).toContain('Pablo Burgos');
    expect(fullRowText).toContain('Una Semana Más');
    expect(fullRowText.indexOf('Soge Culebra')).toBeGreaterThanOrEqual(0);
    expect(fullRowText.indexOf('Pablo Burgos')).toBeGreaterThan(
      fullRowText.indexOf('Soge Culebra')
    );
    expect(fullRowText.indexOf('Una Semana Más')).toBeGreaterThan(
      fullRowText.indexOf('Pablo Burgos')
    );
  });

  it('removes all Sparkles icons across components and App', () => {
    const compDir = resolve(process.cwd(), 'apps/web/src/components');
    const tsxFiles = readdirSync(compDir)
      .filter((f) => f.endsWith('.tsx'))
      .map((f) => resolve(compDir, f));
    tsxFiles.push(resolve(process.cwd(), 'apps/web/src/App.tsx'));

    for (const filePath of tsxFiles) {
      const content = readFileSync(filePath, 'utf8');
      expect(content, `Unexpected Sparkles reference in ${filePath}`).not.toMatch(/\bSparkles\b/);
    }
  });

  it('centers VolumeHoverPopover animation without -50% transform clash and preserves light-surface contrast on queue search pill', () => {
    const css = readFileSync(resolve(process.cwd(), 'apps/web/src/styles/index.css'), 'utf8');
    const volumeKeyframes = css.match(/@keyframes\s+pmVolumePop\s*\{[\s\S]*?\n\}/);
    expect(volumeKeyframes).not.toBeNull();
    expect(volumeKeyframes![0]).not.toContain('translate(-50%');
    expect(volumeKeyframes![0]).not.toContain('translate3d(-50%');

    expect(css).toContain('.pm-np-light-surface [data-testid="queue-search-pill"]');
    expect(css).toContain('background-color: rgba(0, 0, 0, 0.10) !important');
    expect(css).toContain('color: #000000 !important');
    expect(css).toContain('color: rgba(0, 0, 0, 0.62) !important');
  });

  it('crops playlist cover photos to a strict 1:1 centered square', () => {
    render(
      <PlaylistCoverArt
        coverInfo={{
          url: 'https://i.scdn.co/image/ab67706c0000da84widephoto',
          hasCustomCover: true,
        }}
        title="Mi Playlist Wide"
        className="w-40 rounded-[12px]"
      />
    );

    const wrapper = screen.getByTestId('playlist-square-cover');
    expect(wrapper.className).toContain('aspect-square');
    expect(wrapper.className).toContain('overflow-hidden');
    const img = wrapper.querySelector('img');
    expect(img).toBeTruthy();
    expect(img!.className).toContain('object-cover');
    expect(img!.className).toContain('object-center');
  });

  it('allows switching across Temas, Audio, DJ and Cuenta tabs on mobile SettingsModal without resetting back to Temas', () => {
    setWindowViewport(430, 844);
    act(() => {
      usePMusicStore.setState({
        settingsOpen: true,
        settingsInitialCategory: 'apariencia',
      });
    });

    render(<SettingsModal />);

    const audioTab = screen.getByTestId('settings-category-audio');
    fireEvent.click(audioTab);
    expect(screen.getByTestId('settings-category-audio').getAttribute('aria-selected')).toBe('true');

    const djTab = screen.getByTestId('settings-category-dj');
    fireEvent.click(djTab);
    expect(screen.getByTestId('settings-category-dj').getAttribute('aria-selected')).toBe('true');

    const accountTab = screen.getByTestId('settings-category-cuenta');
    fireEvent.click(accountTab);
    expect(screen.getByTestId('settings-category-cuenta').getAttribute('aria-selected')).toBe(
      'true'
    );
  });

  it('opens a friend public playlist detail screen (not direct playback) when clicking a public playlist on FriendProfileView', async () => {
    const sampleTrack = makeTrack('tr_f1', 'Sharingan', 'La Pantera');
    act(() => {
      usePMusicStore.setState({
        friends: [
          {
            id: 'fr_1',
            requesterId: 'me_1',
            addresseeId: 'friend_1',
            status: 'accepted',
            isIncoming: false,
            otherProfile: {
              userId: 'friend_1',
              username: 'carlos_canarias',
              displayName: 'Carlos',
              avatarUrl: 'https://cdn-images.dzcdn.net/images/artist/carlos/250x250.jpg',
            },
          },
        ],
        friendProfilesCache: {
          friend_1: {
            userId: 'friend_1',
            username: 'carlos_canarias',
            displayName: 'Carlos',
            avatarUrl: 'https://cdn-images.dzcdn.net/images/artist/carlos/250x250.jpg',
            bio: 'Canarias vibes',
            publicProfileEnabled: true,
            topTracks: [{ track: sampleTrack, plays: 18, minutes: 54 }],
            topArtists: [
              {
                artistName: 'La Pantera',
                plays: 18,
                thumbnailUrl: sampleTrack.thumbnailUrl,
              },
            ],
            publicPlaylists: [
              {
                id: 'pl_pub_9',
                name: 'Verano en Las Palmas',
                description: 'Mis favoritas de verano',
                coverUrl: 'https://cdn-images.dzcdn.net/images/cover/summer/500x500.jpg',
                trackCount: 1,
                tracks: [sampleTrack],
                kind: 'local',
              },
            ],
            updatedAt: '2026-11-28T12:00:00Z',
          },
        },
        activeDetailView: { kind: 'friend_profile', userId: 'friend_1' },
      });
    });

    const playSpy = vi.spyOn(usePMusicStore.getState(), 'playCollection');
    render(<DetailViewPanel />);

    expect(screen.getByTestId('friend-profile-view')).toBeTruthy();
    const plBtn = screen.getByTestId('friend-playlist-open-pl_pub_9');
    await act(async () => {
      fireEvent.click(plBtn);
    });

    expect(playSpy).not.toHaveBeenCalled();
    const view = usePMusicStore.getState().activeDetailView;
    expect(view?.kind).toBe('friend_playlist');
    expect(screen.getByTestId('friend-playlist-detail')).toBeTruthy();
    expect(screen.getByText('Verano en Las Palmas')).toBeTruthy();
  });

  it('collapses left sidebar before right queue panel, shows compact short-height queue mode at 1100x680, and enforces Electron min bounds', () => {
    const mainTs = readFileSync(resolve(process.cwd(), 'apps/desktop/src/main.ts'), 'utf8');
    expect(mainTs).toMatch(/minWidth:\s*840/);
    expect(mainTs).toMatch(/minHeight:\s*640/);
    const buildElectronJs = readFileSync(
      resolve(process.cwd(), 'apps/desktop/scripts/build-electron.mjs'),
      'utf8'
    );
    expect(buildElectronJs).toMatch(/minWidth:\s*840/);
    expect(buildElectronJs).toMatch(/minHeight:\s*640/);

    setWindowViewport(1100, 680);
    act(() => {
      usePMusicStore.setState({
        rightPanelOpen: true,
        sidebarCollapsed: false,
        currentTrack: makeTrack('tr_cur_1', 'Cangrinaje', 'Cruzzi'),
      });
    });

    render(<App />);
    // Left sidebar auto-collapses (< 1260px) while expanded Downloads button is absent
    expect(screen.queryByTestId('sidebar-expanded-downloads-btn')).toBeNull();
    // Right panel remains open with compact short-height bar (height <= 740px)
    const rightPanel = screen.getByTestId('desktop-right-panel');
    expect(rightPanel.className).toContain('min-[920px]:flex');
    expect(screen.getByTestId('right-panel-compact-nowplaying')).toBeTruthy();

    // When height increases above 740px at 1100px width, left sidebar stays collapsed but full cover returns
    act(() => {
      setWindowViewport(1100, 900);
    });
    expect(screen.queryByTestId('sidebar-expanded-downloads-btn')).toBeNull();
    expect(screen.queryByTestId('right-panel-compact-nowplaying')).toBeNull();
  });
});
