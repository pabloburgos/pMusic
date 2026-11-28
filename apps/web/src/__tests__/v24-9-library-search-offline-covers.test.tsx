// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { PlaylistRecord, Track } from '@pmusic/core';
import App from '../App.tsx';
import { CreatePlaylistModal } from '../components/CreatePlaylistModal.tsx';
import { LibraryScreen, SearchScreen } from '../components/Screens.tsx';
import { TrackArtwork } from '../components/TrackArtwork.tsx';
import { deleteOfflineCover, saveOfflineCover } from '../utils/offline-covers.ts';
import {
  pickRandomCollageCovers,
  resolvePlaylistCoverInfo,
} from '../utils/playlist-artwork.ts';
import { preferExactArtistTopResult } from '../utils/instant-search.ts';
import { usePMusicStore } from '../store/usePMusicStore.ts';

const origInnerWidth = window.innerWidth;

afterEach(async () => {
  cleanup();
  Object.defineProperty(window, 'innerWidth', {
    value: origInnerWidth,
    configurable: true,
  });
  try {
    localStorage.removeItem('pmusic_library_view_v1');
    localStorage.removeItem('pmusic_library_view_v2');
  } catch {
    // ignore
  }
  await deleteOfflineCover('tr_dl_small');
  vi.restoreAllMocks();
  act(() => {
    usePMusicStore.setState({
      activeTab: 'Inicio',
      libraryCategory: 'Todo',
      libraryFilterQuery: '',
      playlists: [],
      sharedPlaylists: [],
      playlistAppearances: {},
      likedTracks: [],
      favoriteArtists: [],
      playHistory: [],
      offlineEntries: [],
      offlineDownloads: {},
      offlineTrackMeta: {},
      searchQuery: '',
    });
  });
});

describe('pMusic v0.24.9 interactive Library & Search, offline covers & unified playlist artwork', () => {
  it('renders cached offline covers for downloaded tracks on cards instead of falling back to generated pMusic art', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:https://pmusic.test/offline-small-cover');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      blob: async () => new Blob([new Uint8Array(600)], { type: 'image/jpeg' }),
    } as Response);

    const saved = await saveOfflineCover('tr_dl_small', 'https://example.com/small-thumb.jpg');
    expect(saved).toBe(true);

    act(() => {
      usePMusicStore.setState({
        isOfflineNetwork: false,
        offlineDownloads: { tr_dl_small: 'downloaded' },
      });
    });

    const { container } = render(
      <TrackArtwork
        trackId="tr_dl_small"
        src="https://example.com/small-thumb.jpg"
        title="Sharingan"
        artistName="La Pantera"
        alt="Sharingan"
        variant="card"
      />
    );

    const img = container.querySelector('img');
    expect(img).toBeTruthy();
    expect(img?.getAttribute('src')).toBe('blob:https://pmusic.test/offline-small-cover');
    expect(screen.queryByTestId('pmusic-generated-cover')).toBeNull();
  });

  it('resolves downloaded track metadata & interactive controls in LibraryScreen and reflects playlist cover updates everywhere', () => {
    const dlTrack: Track = {
      id: 'ZNcJZjYw8v4',
      title: 'Sharingan',
      artists: [{ id: 'ar_lp', name: 'La Pantera' }],
      album: { id: 'al_lp', name: 'LP' },
      durationSec: 120,
      thumbnailUrl: 'https://example.com/sharingan.jpg',
      source: 'ytmusic',
    };

    const customPlaylist: PlaylistRecord = {
      id: 'pl_lapanera',
      name: 'LaPanera',
      description: '',
      source: 'local',
      tracks: [dlTrack],
      coverUrl: 'https://example.com/old-sea.jpg',
      createdAt: '2026-11-27T00:00:00Z',
      updatedAt: '2026-11-27T00:00:00Z',
    };

    const resolvedWithOverride = resolvePlaylistCoverInfo(customPlaylist, {
      coverUrl: 'https://example.com/custom-lapanera.jpg',
    });
    expect(resolvedWithOverride.hasCustomCover).toBe(true);
    expect(resolvedWithOverride.url).toBe('https://example.com/custom-lapanera.jpg');
    expect(resolvedWithOverride.fallbackTrackId).toBeUndefined();

    const resolvedClearedOverride = resolvePlaylistCoverInfo(customPlaylist, {
      coverUrl: null,
    });
    expect(resolvedClearedOverride.hasCustomCover).toBe(false);
    expect(resolvedClearedOverride.url).toBe('https://example.com/sharingan.jpg');
    expect(resolvedClearedOverride.fallbackTrackId).toBe('ZNcJZjYw8v4');

    act(() => {
      usePMusicStore.setState({
        libraryCategory: 'Todo',
        playlists: [customPlaylist],
        playlistAppearances: {
          pl_lapanera: { coverUrl: 'https://example.com/custom-v1.jpg' },
        },
        offlineEntries: [
          {
            trackId: 'ZNcJZjYw8v4',
            sizeBytes: 3_250_000,
          },
        ],
        offlineDownloads: { ZNcJZjYw8v4: 'downloaded' },
      });
    });

    const { container } = render(<LibraryScreen />);

    // Downloaded row resolves real track title & artist instead of raw ID ZNcJZjYw8v4
    const dlSection = screen.getByTestId('library-downloads-section');
    expect(dlSection.textContent).toContain('Sharingan');
    expect(dlSection.textContent).toContain('La Pantera');
    expect(dlSection.textContent).not.toContain('ZNcJZjYw8v4');

    // Sort & Grid/List controls
    const sortBtn = screen.getByTestId('library-sort-btn');
    expect(sortBtn.textContent).toContain('Recientes');
    fireEvent.click(sortBtn);
    expect(sortBtn.textContent).toContain('A–Z');

    const viewToggle = screen.getByTestId('library-view-toggle');
    expect(viewToggle.textContent).toContain('Lista');
    fireEvent.click(viewToggle);
    expect(viewToggle.textContent).toContain('Cuadrícula');

    // Updated playlist cover propagates immediately to LibraryScreen
    const srcsBefore = Array.from(container.querySelectorAll('img')).map((el) =>
      el.getAttribute('src')
    );
    expect(srcsBefore.some((s) => s?.includes('custom-v1.jpg'))).toBe(true);

    act(() => {
      usePMusicStore.setState({
        playlistAppearances: {
          pl_lapanera: { coverUrl: 'https://example.com/custom-v2.jpg' },
        },
      });
    });
    const srcsAfter = Array.from(container.querySelectorAll('img')).map((el) =>
      el.getAttribute('src')
    );
    expect(srcsAfter.some((s) => s?.includes('custom-v2.jpg'))).toBe(true);
    expect(srcsAfter.some((s) => s?.includes('custom-v1.jpg'))).toBe(false);
  });

  it('removes Explorar from mobile bottom bar and upgrades Buscar into an interactive pMusic search + discovery hub', () => {
    Object.defineProperty(window, 'innerWidth', {
      value: 390,
      configurable: true,
    });

    act(() => {
      usePMusicStore.setState({ activeTab: 'Buscar' });
    });

    render(<App />);
    const mobileBar = screen.getByTestId('mobile-tab-bar');
    const mobileTabs = within(mobileBar).getAllByRole('tab');
    expect(mobileTabs.map((t) => t.textContent?.trim())).toEqual([
      'Inicio',
      'Buscar',
      'Biblioteca',
      'Social',
    ]);
    expect(within(mobileBar).queryByRole('tab', { name: /Explorar/i })).toBeNull();
    cleanup();

    render(<SearchScreen />);
    expect(screen.getByTestId('search-genre-grid')).toBeTruthy();
    expect(screen.getByRole('searchbox', { name: /Buscar canciones, artistas o álbumes/i })).toBeTruthy();

    // Active search hides redundant RECIENTES: chip bar, centers compact clear button, and prefers exact artist topResult
    act(() => {
      usePMusicStore.setState({
        searchQuery: 'la pantera',
        recentSearches: ['Cruzzi', 'La Pantera'],
      });
    });
    expect(screen.queryByText(/^Recientes:$/i)).toBeNull();
    const clearBtn = screen.getByRole('button', { name: /Limpiar búsqueda/i });
    expect(clearBtn.className).toContain('pm-compact-btn');
    expect(clearBtn.className).toContain('justify-center');

    const exactPicked = preferExactArtistTopResult('la pantera', {
      artists: [
        {
          id: 'ar_pantera',
          name: 'La Pantera',
          thumbnailUrl: 'https://example.com/pantera.jpg',
        },
      ],
      songs: [
        {
          id: 'tr_cayo',
          title: 'Cayó La Noche',
          artists: [{ id: 'ar_pantera', name: 'La Pantera' }],
          album: { id: 'al_1', name: 'Single' },
          durationSec: 210,
          thumbnailUrl: 'https://example.com/cayo.jpg',
          source: 'ytmusic',
        },
      ],
      topResult: {
        kind: 'song',
        item: {
          id: 'tr_cayo',
          title: 'Cayó La Noche',
          artists: [{ id: 'ar_pantera', name: 'La Pantera' }],
          album: { id: 'al_1', name: 'Single' },
          durationSec: 210,
          thumbnailUrl: 'https://example.com/cayo.jpg',
          source: 'ytmusic',
        },
      },
    });
    expect(exactPicked?.kind).toBe('artist');
    if (exactPicked?.kind === 'artist') {
      expect(exactPicked.item.name).toBe('La Pantera');
    }
  });

  it('freezes 4 random Spotify-style covers at playlist creation, preserves custom cover override, and renders OLED interactive CreatePlaylistModal without purple/Estilo', async () => {
    const mkSampleTrack = (idx: number): Track => ({
      id: `col_tr_${idx}`,
      title: `Tema ${idx}`,
      artists: [{ id: `art_${idx}`, name: `Artista ${idx}` }],
      album: { id: `alb_${idx}`, name: `Álbum ${idx}` },
      durationSec: 185,
      thumbnailUrl: `https://example.com/cover-${idx}.jpg`,
      source: 'ytmusic',
    });

    const initialTracks = [mkSampleTrack(1), mkSampleTrack(2), mkSampleTrack(3), mkSampleTrack(4)];
    const collage = pickRandomCollageCovers(initialTracks, 4);
    expect(collage).toHaveLength(4);
    expect(new Set(collage).size).toBe(4);

    // Create playlist with 4 tracks -> freezes collageUrls immediately
    const created = await act(async () =>
      usePMusicStore.getState().createPlaylist('Mosaico Congelado', '', initialTracks)
    );
    const frozenBeforeAdd = usePMusicStore.getState().playlistAppearances[created.id]?.collageUrls;
    expect(frozenBeforeAdd).toHaveLength(4);

    // Adding a 5th track must NOT mutate the frozen 4-cover mosaic
    const fifthTrack = mkSampleTrack(5);
    await act(async () => {
      await usePMusicStore.getState().addTrackToPlaylist(created.id, fifthTrack);
    });
    const frozenAfterAdd = usePMusicStore.getState().playlistAppearances[created.id]?.collageUrls;
    expect(frozenAfterAdd).toEqual(frozenBeforeAdd);
    expect(frozenAfterAdd).not.toContain('https://example.com/cover-5.jpg');

    // Legacy playlist whose pl.coverUrl equals tracks[0].thumbnailUrl still resolves 2x2 mosaic when >= 2 covers exist
    const legacyResolved = resolvePlaylistCoverInfo({
      id: 'pl_legacy',
      name: 'Legacy',
      coverUrl: 'https://example.com/cover-1.jpg',
      tracks: initialTracks,
    });
    expect(legacyResolved.hasCustomCover).toBe(false);
    expect(legacyResolved.collageUrls).toHaveLength(4);

    // Custom uploaded/set cover overrides mosaic cleanly
    const customResolved = resolvePlaylistCoverInfo(
      { ...created, tracks: initialTracks },
      { coverUrl: 'data:image/png;base64,AAA', collageUrls: frozenBeforeAdd }
    );
    expect(customResolved.hasCustomCover).toBe(true);
    expect(customResolved.url).toBe('data:image/png;base64,AAA');

    // Interactive CreatePlaylistModal builds live 2x2 mosaic via +4 al azar without Estilo button
    act(() => {
      usePMusicStore.setState({
        likedTracks: initialTracks.map((t) => ({
          trackId: t.id,
          track: t,
          likedAt: new Date().toISOString(),
        })),
        createPlaylistModalOpen: true,
      });
    });

    render(<CreatePlaylistModal />);
    expect(screen.queryByText(/^Estilo$/i)).toBeNull();
    fireEvent.click(screen.getByTestId('create-playlist-quick-fill-btn'));
    expect(await screen.findByTestId('playlist-mosaic-cover')).toBeTruthy();

    act(() => {
      usePMusicStore.setState({ createPlaylistModalOpen: false, likedTracks: [], playlists: [] });
    });
  });
});
