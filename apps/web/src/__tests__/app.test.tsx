// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, fireEvent } from '@testing-library/react';
import { App } from '../App.tsx';
import { ArtistLinks } from '../components/ArtistLinks.tsx';
import { InkBleedCoverTransition } from '../components/InkBleedCoverTransition.tsx';
import { isSameAlbumOrCover } from '../components/Overlays.tsx';
import { PMusicSwitch } from '../components/PMusicSwitch.tsx';
import { mergeAccountTasteProfiles } from '../lib/taste-sync.ts';
import { diversifyAndShuffleTracks, usePMusicStore } from '../store/usePMusicStore.ts';

afterEach(() => {
  cleanup();
});

describe('@pmusic/web UI', () => {
  it('renders pMusic shell without errors, displays Home & Explorar shelves, opens Spotlight Search, and navigates to Buscar and Biblioteca', async () => {
    render(<App />);
    expect(screen.getAllByText(/Buenos días|Buenas tardes|Buenas noches/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Mixes para ti/i).length).toBeGreaterThan(0);

    const exploreTab = screen.getAllByRole('tab', { name: /Explorar/i })[0]!;
    fireEvent.click(exploreTab);
    expect(screen.getByText(/Explorar géneros/i)).toBeDefined();

    const searchTab = screen.getAllByRole('tab', { name: /Buscar/i })[0]!;
    fireEvent.click(searchTab);
    const searchInput = screen.getByRole('searchbox');
    expect(searchInput).toBeDefined();
    expect(screen.getByText(/Búsquedas recientes/i)).toBeDefined();

    fireEvent.change(searchInput, { target: { value: 'Quevedo' } });
    fireEvent.submit(searchInput.closest('form')!);
    expect(screen.getByTestId('best-result-card')).toBeDefined();

    const libTab = screen.getAllByRole('tab', { name: /Biblioteca/i })[0]!;
    fireEvent.click(libTab);
    expect(screen.getAllByText(/Tus Playlists/i).length).toBeGreaterThan(0);
  });

  it('opens categorized SettingsModal, switches themes & dock styles, explores audio/discord tabs, and opens DJ & EQ popovers from dock', () => {
    render(<App />);
    const header = document.querySelector('header');
    expect(header?.querySelector('button[aria-label="Ajustes"]')).toBeNull();

    expect(screen.queryByTestId('dock-dj-btn')).toBeNull();
    fireEvent.click(screen.getByTestId('dock-eq-btn'));
    expect(screen.getByTestId('eq-sheet')).toBeDefined();

    fireEvent.click(screen.getByTestId('audio-panel-tab-dj'));
    expect(screen.getByTestId('dj-popover')).toBeDefined();
    expect(screen.getByTestId('dj-style-quick')).toBeDefined();
    expect(screen.getByTestId('dj-style-full')).toBeDefined();

    fireEvent.click(screen.getByTestId('dock-eq-btn'));
    expect(screen.queryByTestId('dj-popover')).toBeNull();
    expect(screen.queryByTestId('eq-sheet')).toBeNull();

    const settingsBtn = screen.getAllByRole('button', { name: /Ajustes/i })[0]!;
    fireEvent.click(settingsBtn);

    expect(screen.getByTestId('settings-view')).toBeDefined();
    expect(screen.getByTestId('settings-category-apariencia')).toBeDefined();
    expect(screen.getByTestId('settings-category-audio')).toBeDefined();
    expect(screen.getByTestId('settings-category-discord')).toBeDefined();

    fireEvent.click(screen.getByTestId('theme-card-nordic-light'));
    expect(document.documentElement.dataset.theme).toBe('nordic-light');

    const liquidGlassToggle = screen.getByTestId('liquid-glass-toggle');
    fireEvent.click(liquidGlassToggle);
    expect(document.documentElement.classList.contains('pm-solid-modern')).toBe(true);
    expect(document.documentElement.classList.contains('pm-liquid-glass-all')).toBe(false);
    fireEvent.click(liquidGlassToggle);
    expect(document.documentElement.classList.contains('pm-liquid-glass-all')).toBe(true);
    expect(document.documentElement.classList.contains('pm-solid-modern')).toBe(false);

    fireEvent.click(screen.getByTestId('surface-style-frosted-glass'));
    expect(document.documentElement.classList.contains('pm-surface-frosted')).toBe(true);
    expect(document.documentElement.classList.contains('pm-surface-liquid')).toBe(false);
    expect(document.documentElement.classList.contains('pm-surface-simple')).toBe(false);

    fireEvent.click(screen.getByTestId('surface-style-simple'));
    expect(document.documentElement.classList.contains('pm-surface-simple')).toBe(true);
    expect(document.documentElement.classList.contains('pm-solid-modern')).toBe(true);

    fireEvent.click(screen.getByTestId('surface-style-liquid-glass'));
    expect(document.documentElement.classList.contains('pm-surface-liquid')).toBe(true);
    expect(document.documentElement.classList.contains('pm-liquid-glass-all')).toBe(true);

    const ambientCard = screen.getByTestId('dock-style-ambient-dock');
    const classicCard = screen.getByTestId('dock-style-classic-center');
    const islandCard = screen.getByTestId('dock-style-floating-island');
    const minimalCard = screen.getByTestId('dock-style-minimal-wave');
    fireEvent.click(ambientCard);
    expect(ambientCard.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('ambient-progress-fill')).toBeDefined();
    expect(screen.queryByTestId('ambient-playhead')).toBeNull();
    fireEvent.click(islandCard);
    expect(islandCard.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(minimalCard);
    expect(minimalCard.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(classicCard);
    expect(classicCard.getAttribute('aria-pressed')).toBe('true');

    expect(screen.queryByTestId('settings-category-gustos')).toBeNull();
    fireEvent.click(screen.getByTestId('settings-category-cuenta'));
    expect(screen.queryByLabelText('Supabase Project URL')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Tu cuenta pMusic' })).toBeDefined();

    fireEvent.click(screen.getByTestId('settings-category-discord'));
    expect(screen.getByRole('heading', { name: 'Discord Rich Presence' })).toBeDefined();

    fireEvent.click(screen.getByTestId('settings-category-apariencia'));
    fireEvent.click(screen.getByTestId('theme-card-obsidian'));
    fireEvent.click(screen.getByRole('button', { name: /Cerrar ajustes/i }));
  });

  it('renders each collaborating artist independently via ArtistLinks', () => {
    render(
      <ArtistLinks
        artists={[
          { id: 'ar-1', name: 'Bad Bunny' },
          { id: 'ar-2', name: 'Bomba Estéreo' },
          { id: 'ar-3', name: 'Dei V' },
        ]}
      />
    );
    expect(screen.getByRole('link', { name: /Ir al artista Bad Bunny/i })).toBeDefined();
    expect(screen.getByRole('link', { name: /Ir al artista Bomba Estéreo/i })).toBeDefined();
    expect(screen.getByRole('link', { name: /Ir al artista Dei V/i })).toBeDefined();
  });

  it('pushes detail views onto detailViewHistory so Volver steps back gracefully', async () => {
    render(<App />);
    await usePMusicStore.getState().openArtistDetail('UC_BAD_BUNNY');
    expect(usePMusicStore.getState().activeDetailView?.kind).toBe('artist');

    await usePMusicStore.getState().openAlbumDetail('MPR_NSLQVAPM_2023');
    expect(usePMusicStore.getState().activeDetailView?.kind).toBe('album');
    expect(usePMusicStore.getState().detailViewHistory).toHaveLength(1);

    const backBtn = screen.getByTestId('back-detail-btn');
    fireEvent.click(backBtn);
    expect(usePMusicStore.getState().activeDetailView?.kind).toBe('artist');
    expect(usePMusicStore.getState().detailViewHistory).toHaveLength(0);

    fireEvent.click(screen.getByTestId('back-detail-btn'));
    expect(usePMusicStore.getState().activeDetailView).toBeNull();
  });

  it('toggles ambientMotionEnabled switch in SettingsModal and updates NowPlayingSheet fluid backdrop state', () => {
    render(<App />);
    const settingsBtn = screen.getAllByRole('button', { name: /Ajustes/i })[0]!;
    fireEvent.click(settingsBtn);

    const ambientToggle = screen.getByTestId('ambient-motion-toggle');
    expect(usePMusicStore.getState().ambientMotionEnabled).toBe(true);
    fireEvent.click(ambientToggle);
    expect(usePMusicStore.getState().ambientMotionEnabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: /Cerrar ajustes/i }));

    fireEvent.click(
      screen.getAllByRole('button', { name: /Abrir reproductor a pantalla completa/i })[0]!
    );
    expect(
      screen.getByTestId('live-backdrop-container').classList.contains('pm-backdrop-static')
    ).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: /Cerrar reproductor/i }));
    fireEvent.click(settingsBtn);
    fireEvent.click(screen.getByTestId('ambient-motion-toggle'));
    fireEvent.click(screen.getByRole('button', { name: /Cerrar ajustes/i }));
    fireEvent.click(
      screen.getAllByRole('button', { name: /Abrir reproductor a pantalla completa/i })[0]!
    );
    expect(
      screen.getByTestId('live-backdrop-container').classList.contains('pm-backdrop-static')
    ).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: /Cerrar reproductor/i }));
  });

  it('auto-drops finished tracks in user queue, preserves Anterior via sessionPrevStack, and promotes infinite recommendations', async () => {
    const t1 = usePMusicStore.getState().homeShelves[0]!.tracks![0]!;
    const t2 = usePMusicStore.getState().homeShelves[0]!.tracks![1]!;
    const rec = usePMusicStore.getState().homeShelves[0]!.tracks![2]!;

    usePMusicStore.setState({
      queue: [t1, t2],
      queueIndex: 0,
      currentTrack: t1,
      sessionPrevStack: [],
      recommendedQueue: [rec],
      repeatMode: 'off',
    });

    await usePMusicStore.getState().nextTrack();
    expect(usePMusicStore.getState().currentTrack.id).toBe(t2.id);
    expect(usePMusicStore.getState().queue.map((t) => t.id)).toEqual([t2.id]);
    expect(usePMusicStore.getState().sessionPrevStack.map((t) => t.id)).toEqual([t1.id]);

    usePMusicStore.getState().promoteRecommendedTrack(rec.id);
    expect(usePMusicStore.getState().queue.map((t) => t.id)).toEqual([t2.id, rec.id]);
    expect(usePMusicStore.getState().recommendedQueue.some((t) => t.id === rec.id)).toBe(false);

    await usePMusicStore.getState().prevTrack();
    expect(usePMusicStore.getState().currentTrack.id).toBe(t1.id);
    expect(usePMusicStore.getState().queue[0]?.id).toBe(t1.id);
  });

  it('delays Play/Pause loading indicator by 500ms without shimmer or text and triggers epic skip/prev/shuffle animations', async () => {
    vi.useFakeTimers();
    try {
      act(() => {
        usePMusicStore.setState({ isBuffering: false, isPlaying: false });
      });
      render(<App />);
      const playBtn = screen.getByTestId('dock-play-btn');
      expect(screen.queryByTestId('dock-play-loader')).toBeNull();

      // Fast load (< 500ms) never flashes a spinner
      act(() => {
        usePMusicStore.setState({ isBuffering: true });
      });
      expect(screen.queryByTestId('dock-play-loader')).toBeNull();
      act(() => {
        vi.advanceTimersByTime(150);
      });
      expect(screen.queryByTestId('dock-play-loader')).toBeNull();

      act(() => {
        usePMusicStore.setState({ isBuffering: false });
      });
      act(() => {
        vi.advanceTimersByTime(450);
      });
      expect(screen.queryByTestId('dock-play-loader')).toBeNull();

      // Slow load (>= 500ms) reveals ONLY the circular spinner, never CARGANDO AUDIO text or shimmer bar
      act(() => {
        usePMusicStore.setState({ isBuffering: true });
      });
      act(() => {
        vi.advanceTimersByTime(450);
      });
      expect(screen.queryByTestId('dock-play-loader')).toBeNull();

      act(() => {
        vi.advanceTimersByTime(60);
      });
      expect(screen.getByTestId('dock-play-loader')).toBeDefined();
      expect(playBtn.getAttribute('aria-label')).toBe('Cargando canción');
      expect(screen.queryByText(/CARGANDO AUDIO/i)).toBeNull();
      expect(document.querySelector('.pm-buffer-shimmer')).toBeNull();

      act(() => {
        usePMusicStore.setState({ isBuffering: false });
      });
      expect(screen.queryByTestId('dock-play-loader')).toBeNull();
    } finally {
      vi.useRealTimers();
    }

    fireEvent.click(screen.getByRole('button', { name: /Activar reproducción aleatoria/i }));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(document.querySelector('.pm-shuffle-chaos-epic')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(document.querySelector('.pm-skip-next-hyper')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Anterior' }));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(document.querySelector('.pm-skip-prev-hyper')).not.toBeNull();
  });

  it('hides MEZCLANDO · DJ and Entrando takeover during plain crossfade, renders ink-bleed cover and persistent dual backdrop slots, and deactivates DJ Mode synchronously', async () => {
    const allPool = [
      ...usePMusicStore.getState().homeShelves.flatMap((s) => s.tracks ?? []),
      ...usePMusicStore.getState().queue,
    ];
    const t1 = allPool[0]!;
    const t2 =
      allPool.find(
        (t) =>
          t.id !== t1.id &&
          t.thumbnailUrl !== t1.thumbnailUrl &&
          (t.album?.name ?? '') !== (t1.album?.name ?? '')
      ) ?? allPool[1]!;

    act(() => {
      usePMusicStore.setState({
        nowPlayingOpen: true,
        isBuffering: false,
        isTransitioning: true,
        transitionProgress01: 0.45,
        outgoingTransitionTrack: t1,
        incomingTransitionTrack: t2,
        currentTrack: t1,
        djMode: {
          ...usePMusicStore.getState().djMode,
          enabled: false,
        },
        safeCrossfade: { enabled: true, durationSec: 4 },
      });
    });

    render(<App />);
    expect(screen.queryByText(/MEZCLANDO · DJ/i)).toBeNull();
    expect(screen.queryByText(/Entrando ·/i)).toBeNull();
    const inkCover = screen.getByTestId('ink-bleed-cover');
    expect(inkCover).toBeDefined();
    expect(inkCover.querySelectorAll('canvas').length).toBeGreaterThan(0);
    expect(inkCover.querySelectorAll('circle').length).toBe(0);
    expect(inkCover.querySelectorAll('feTurbulence').length).toBe(0);
    expect(screen.getByTestId('backdrop-slot-0')).toBeDefined();
    expect(screen.getByTestId('backdrop-slot-1')).toBeDefined();
    expect(screen.getByTestId('toggle-real-fullscreen-btn')).toBeDefined();

    // Activate DJ Mode, then toggle OFF and ensure synchronous cleanup
    act(() => {
      usePMusicStore.setState({
        djMode: {
          ...usePMusicStore.getState().djMode,
          enabled: true,
        },
        isTransitioning: true,
        incomingTransitionTrack: t2,
        activeTransitionPlan: {
          fromTrackId: t1.id,
          toTrackId: t2.id,
          cueInSec: 0,
          cueOutSec: 160,
          transitionDurationSec: 6,
          transitionBars: 4,
          transitionType: 'eq_swap',
          tempoNudgeRate: 1.0,
          echoSubdivision: 0.5,
          compatibilityScore: 0.9,
        },
      });
    });

    const togglePromise = usePMusicStore.getState().toggleDjMode(false);
    // Must be cleared synchronously on toggle off without waiting for async resolution
    expect(usePMusicStore.getState().djMode.enabled).toBe(false);
    expect(usePMusicStore.getState().isTransitioning).toBe(false);
    expect(usePMusicStore.getState().incomingTransitionTrack).toBeNull();
    expect(usePMusicStore.getState().activeTransitionPlan).toBeNull();
    await togglePromise;
  });

  it('suppresses auto-crossfade when seeking directly inside the final crossfade window', async () => {
    const t1 = usePMusicStore.getState().homeShelves[0]!.tracks![0]!;
    const t2 = usePMusicStore.getState().homeShelves[0]!.tracks![1]!;

    act(() => {
      usePMusicStore.setState({
        queue: [t1, t2],
        queueIndex: 0,
        currentTrack: t1,
        durationSec: 180,
        positionSec: 40,
        repeatMode: 'off',
        djMode: {
          ...usePMusicStore.getState().djMode,
          enabled: false,
        },
        safeCrossfade: { enabled: true, durationSec: 12 },
        isTransitioning: false,
      });
    });

    // Seeking directly into the final 12s crossfade zone (e.g. 173s) must NOT trigger crossfade
    act(() => {
      usePMusicStore.getState().seekTo(173);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 220));
    });
    expect(usePMusicStore.getState().isTransitioning).toBe(false);
    expect(usePMusicStore.getState().currentTrack.id).toBe(t1.id);
    expect(usePMusicStore.getState().positionSec).toBe(173);
  });

  it('renders a compact 3-dots effects menu in Floating Island mode so right controls never overlap transport buttons', () => {
    act(() => {
      usePMusicStore.setState({ playerBarStyle: 'floating-island', nowPlayingOpen: false });
    });
    render(<App />);

    const effectsBtn = screen.getByTestId('island-effects-btn');
    expect(effectsBtn).toBeDefined();
    expect(screen.queryByTestId('island-effects-menu')).toBeNull();

    fireEvent.click(effectsBtn);
    const menu = screen.getByTestId('island-effects-menu');
    expect(menu).toBeDefined();
    expect(menu.className).toContain('pm-glass-frosted-neutral');
    expect(screen.getByTestId('island-effect-dj')).toBeDefined();
    expect(screen.getByTestId('island-effect-eq')).toBeDefined();
    expect(screen.getByTestId('island-effect-lyrics')).toBeDefined();
    expect(screen.getByTestId('island-effect-connect')).toBeDefined();

    fireEvent.click(screen.getByTestId('island-effect-eq'));
    const eqSheet = screen.getByTestId('eq-sheet');
    expect(eqSheet.className).toContain('calc(50%-440px)');
  });

  it('supports drag-and-drop queue reordering and quick song search in the right sidebar queue panel', async () => {
    const t1 = usePMusicStore.getState().homeShelves[0]!.tracks![0]!;
    const t2 = usePMusicStore.getState().homeShelves[0]!.tracks![1]!;
    const t3 = usePMusicStore.getState().homeShelves[0]!.tracks![2]!;

    act(() => {
      usePMusicStore.setState({
        rightPanelOpen: true,
        currentTrack: t1,
        queue: [t1, t2, t3],
        queueIndex: 0,
        searchResults: {
          query: '',
          songs: [t3],
          videos: [],
          artists: [],
          albums: [],
          playlists: [],
        },
      });
    });

    render(<App />);
    const item2 = screen.getByTestId(`sidebar-queue-item-${t2.id}`);
    const item3 = screen.getByTestId(`sidebar-queue-item-${t3.id}`);

    fireEvent.dragStart(item3);
    fireEvent.dragOver(item2);
    fireEvent.drop(item2);
    expect(usePMusicStore.getState().queue.map((t) => t.id)).toEqual([t1.id, t3.id, t2.id]);

    const searchInput = screen.getByTestId('sidebar-queue-search-input');
    fireEvent.change(searchInput, { target: { value: t2.title.slice(0, 4) } });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 320));
    });
    expect(screen.getByTestId('sidebar-queue-search-results')).toBeDefined();
  });

  it('advances by exactly 1 track (never 2) when manually clicking Next while inside the suppressed crossfade zone', async () => {
    const t1 = usePMusicStore.getState().homeShelves[0]!.tracks![0]!;
    const t2 = usePMusicStore.getState().homeShelves[0]!.tracks![1]!;
    const t3 = usePMusicStore.getState().homeShelves[0]!.tracks![2]!;

    act(() => {
      usePMusicStore.setState({
        queue: [t1, t2, t3],
        queueIndex: 0,
        currentTrack: t1,
        durationSec: 180,
        positionSec: 40,
        isPlaying: true,
        repeatMode: 'off',
        djMode: {
          ...usePMusicStore.getState().djMode,
          enabled: false,
        },
        safeCrossfade: { enabled: true, durationSec: 12 },
        isTransitioning: false,
      });
    });

    // Seek directly inside the final 12s crossfade zone (auto-crossfade suppressed)
    act(() => {
      usePMusicStore.getState().seekTo(174);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 60));
      await usePMusicStore.getState().nextTrack();
      await new Promise((r) => setTimeout(r, 300));
    });

    expect(usePMusicStore.getState().currentTrack.id).toBe(t2.id);
    expect(usePMusicStore.getState().isTransitioning).toBe(false);
    expect(usePMusicStore.getState().queue[0]?.id).toBe(t2.id);
  });

  it('renders unified PMusicSwitch with pm-switch-control class, keeps InkBleed incoming scale >= 1.0, merges cloud desktop taste, and promotes frequent playlists on Home', () => {
    // 1. Unified PMusicSwitch across Settings & AudioStudio
    const toggleFn = vi.fn();
    const { container } = render(
      <PMusicSwitch checked ariaLabel="Switch de prueba" onChange={toggleFn} />
    );
    const sw = screen.getByRole('switch', { name: 'Switch de prueba' });
    expect(sw.classList.contains('pm-switch-control')).toBe(true);
    fireEvent.click(sw);
    expect(toggleFn).toHaveBeenCalledTimes(1);
    expect(container.querySelectorAll('button[role="switch"]')).toHaveLength(1);
    cleanup();

    // 2. InkBleedCoverTransition incoming scale >= 1.0 (zero black border edge exposure)
    const sampleTrack = usePMusicStore.getState().homeShelves[0]!.tracks![0]!;
    render(
      <InkBleedCoverTransition
        outgoingUrl={sampleTrack.thumbnailUrl}
        outgoingTitle={sampleTrack.title}
        incomingUrl={sampleTrack.thumbnailUrl}
        incomingTitle="Incoming"
        seedKey="test-seed"
        durationSec={4}
      />
    );
    const inkImg = screen.getByAltText('Incoming') as HTMLImageElement;
    expect(inkImg.style.transform).toContain('scale(1.035');
    expect(inkImg.style.opacity).toBe('0');
    const inkContainer = screen.getByTestId('ink-bleed-cover');
    const fallbackImg = inkContainer.querySelector('img[aria-hidden="true"]') as HTMLImageElement | null;
    expect(fallbackImg?.style.transform).toContain('scale(1.015');
    cleanup();

    // 3. mergeAccountTasteProfiles preserves desktop richness over cold mobile profile
    const merged = mergeAccountTasteProfiles(
      {
        updatedAtMs: 2000,
        richnessScore: 0,
        affinities: [],
        playHistory: [],
        seedArtists: [],
        playlistPlayCounts: {},
      },
      {
        updatedAtMs: 1000,
        richnessScore: 42,
        affinities: [
          {
            artistKey: 'la pantera',
            artistName: 'La Pantera',
            score: 18,
            genres: ['trap_canarias'],
            playCount: 9,
            skipCount: 0,
            isSeed: true,
            updatedAt: '2026-11-24T20:00:00.000Z',
          },
        ],
        playHistory: [
          {
            id: 'h_1',
            trackId: sampleTrack.id,
            track: sampleTrack,
            playedAt: '2026-11-24T20:00:00.000Z',
            playedSec: 180,
            completionRatio: 1.0,
            signalType: 'complete_listen',
          },
        ],
        seedArtists: [
          {
            artistKey: 'la pantera',
            displayName: 'La Pantera',
            genres: ['trap_canarias'],
            priorWeight: 9,
          },
        ],
        playlistPlayCounts: {
          lapanera: { name: 'LaPanera', count: 5, lastPlayedAt: Date.now() },
        },
      }
    );
    expect(merged.affinities[0]?.artistName).toBe('La Pantera');
    expect(merged.playHistory).toHaveLength(1);
    expect(merged.playlistPlayCounts['lapanera']?.count).toBe(5);

    // 4. HomeScreen promotes frequently played playlists inside Quick Picks
    act(() => {
      usePMusicStore.setState({
        activeTab: 'Inicio',
        playlists: [
          {
            id: 'pl_freq_1',
            name: 'LaPanera',
            description: 'Favorita',
            source: 'local',
            tracks: [sampleTrack],
            createdAt: '2026-11-24T10:00:00.000Z',
            updatedAt: '2026-11-24T10:00:00.000Z',
          },
        ],
        playlistPlayCounts: {
          lapanera: { name: 'LaPanera', count: 4, lastPlayedAt: Date.now() },
        },
      });
    });
    render(<App />);
    expect(screen.getByTestId('quick-playlist-tile-pl_freq_1')).toBeDefined();
  });

  it('supports v0.18.0 alwaysShuffle, AudioStudio Pantalla tab, 6 backdrops, same-album skip, banner-only artist profile, and Car Mode', async () => {
    const albumTrackA = {
      id: 'dz:9001',
      title: 'Track Uno Del Álbum con Título Súper Largo',
      artists: [{ id: 'ar1', name: 'La Pantera' }],
      album: { id: 'alb-55', name: 'UNA SEMANA INCREÍBLE' },
      durationSec: 195,
      thumbnailUrl: 'https://example.com/same-cover.jpg',
      thumbnailHighUrl: 'https://example.com/same-cover.jpg',
      source: 'ytmusic' as const,
    };
    const albumTrackB = {
      id: 'dz:9002',
      title: 'Track Dos Del Mismo Álbum',
      artists: [{ id: 'ar1', name: 'La Pantera' }],
      album: { id: 'alb-55', name: 'UNA SEMANA INCREÍBLE' },
      durationSec: 210,
      thumbnailUrl: 'https://example.com/same-cover.jpg',
      thumbnailHighUrl: 'https://example.com/same-cover.jpg',
      source: 'ytmusic' as const,
    };
    const otherAlbumTrack = {
      id: 'dz:9003',
      title: 'Otro Álbum Distinto',
      artists: [{ id: 'ar2', name: 'Quevedo' }],
      album: { id: 'alb-99', name: 'DONDE QUIERO ESTAR' },
      durationSec: 185,
      thumbnailUrl: 'https://example.com/other-cover.jpg',
      thumbnailHighUrl: 'https://example.com/other-cover.jpg',
      source: 'ytmusic' as const,
    };

    // 1. Smart same-album / same-cover detection
    expect(isSameAlbumOrCover(albumTrackA, albumTrackB)).toBe(true);
    expect(isSameAlbumOrCover(albumTrackA, otherAlbumTrack)).toBe(false);

    // 2. alwaysShuffle preference keeps shuffle active across new queues
    act(() => {
      usePMusicStore.getState().setAlwaysShuffle(true);
    });
    expect(usePMusicStore.getState().alwaysShuffle).toBe(true);
    expect(usePMusicStore.getState().shuffleEnabled).toBe(true);

    await act(async () => {
      await usePMusicStore.getState().playTrack(albumTrackA, [albumTrackA, albumTrackB, otherAlbumTrack]);
    });
    expect(usePMusicStore.getState().shuffleEnabled).toBe(true);
    expect(usePMusicStore.getState().queue[0]?.id).toBe(albumTrackA.id);

    // 3. Fullscreen NowPlayingSheet: skips cover transition on same album & exposes Display Preferences inside AudioStudio
    act(() => {
      usePMusicStore.setState({
        nowPlayingOpen: true,
        nowPlayingTab: 'Portada',
        eqSheetOpen: false,
        djPopoverOpen: false,
        audioPanelTab: 'dj',
        isTransitioning: true,
        outgoingTransitionTrack: albumTrackA,
        incomingTransitionTrack: albumTrackB,
        transitionDurationSec: 8,
        skipSameAlbumCoverTransition: true,
        reducedMotionPref: false,
      });
    });

    const { rerender } = render(<App />);
    expect(screen.queryByTestId('ink-bleed-cover')).toBeNull();

    // Switching to another album during crossfade renders ink-bleed transition
    act(() => {
      usePMusicStore.setState({
        incomingTransitionTrack: otherAlbumTrack,
      });
    });
    rerender(<App />);
    expect(screen.getByTestId('ink-bleed-cover')).toBeDefined();

    // Open Studio sheet (Audio y DJ) -> Pantalla tab and switch backdrop style to Pintura Viva ('paint')
    const djBtn = screen.getByTestId('nowplaying-dj-btn');
    fireEvent.click(djBtn);
    fireEvent.click(screen.getByTestId('audio-panel-tab-display'));
    expect(screen.getByTestId('nowplaying-display-panel')).toBeDefined();
    fireEvent.click(screen.getByTestId('backdrop-style-paint'));
    expect(usePMusicStore.getState().nowPlayingBackdropStyle).toBe('paint');
    expect(
      screen.getByTestId('live-backdrop-container').getAttribute('data-backdrop-style')
    ).toBe('paint');
    expect(
      screen.getByTestId('exotic-backdrop-canvas').getAttribute('data-exotic-style')
    ).toBe('paint');

    // Toggle Marquee & Remaining time switches inside Pantalla tab
    fireEvent.click(screen.getByTestId('pref-marquee-switch'));
    expect(usePMusicStore.getState().marqueeTextEnabled).toBe(false);
    fireEvent.click(screen.getByTestId('pref-remaining-time-switch'));
    expect(usePMusicStore.getState().showRemainingTime).toBe(false);

    // 4. Redesigned Artist Profile renders banner-only hero (no circular avatar) & discography filter tabs
    act(() => {
      usePMusicStore.setState({
        nowPlayingOpen: false,
        eqSheetOpen: false,
        djPopoverOpen: false,
        isTransitioning: false,
        outgoingTransitionTrack: null,
        incomingTransitionTrack: null,
        alwaysShuffle: false,
        shuffleEnabled: false,
        nowPlayingBackdropStyle: 'fluid',
        marqueeTextEnabled: true,
        showRemainingTime: true,
        activeDetailView: {
          kind: 'artist',
          data: {
            artist: {
              id: '7524936',
              name: 'La Pantera',
              thumbnailUrl: 'https://example.com/pantera-avatar.jpg',
              subscribersText: '5,8 M oyentes mensuales',
            },
            bannerUrl: 'https://example.com/pantera-banner-1440.jpg',
            description: 'Referente de la escena urbana canaria.',
            topSongs: [albumTrackA, albumTrackB],
            albums: [
              {
                id: 'alb-55',
                title: 'UNA SEMANA INCREÍBLE',
                artists: [{ id: 'ar1', name: 'La Pantera' }],
                year: 2024,
                thumbnailUrl: 'https://example.com/same-cover.jpg',
              },
            ],
            singles: [
              {
                id: 'sg-1',
                title: 'TÓCATE SOLA',
                artists: [{ id: 'ar1', name: 'La Pantera' }],
                year: 2025,
                thumbnailUrl: 'https://example.com/sg-cover.jpg',
              },
            ],
            relatedArtists: [],
          },
        },
      });
    });
    rerender(<App />);
    const heroBanner = screen.getByTestId('artist-hero-banner');
    expect(heroBanner).toBeDefined();
    expect(heroBanner.querySelectorAll('img').length).toBe(1);
    expect(heroBanner.querySelector('[data-testid="artist-play-btn"]')).not.toBeNull();
    expect(heroBanner.querySelector('[data-testid="artist-shuffle-btn"]')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Radio' })).toBeNull();
    expect(screen.queryByText(/Sesión DJ La Pantera/i)).toBeNull();
    expect(screen.getByTestId('artist-sticky-header')).toBeDefined();
    expect(screen.getByTestId('artist-sticky-play-btn')).toBeDefined();
    expect(screen.getByText('Último lanzamiento')).toBeDefined();
    fireEvent.click(screen.getByRole('tab', { name: 'Sencillos y EP' }));
    expect(screen.getAllByText('TÓCATE SOLA').length).toBeGreaterThan(0);

    // Artist profile omits "Artista verificado · pMusic" badge
    expect(screen.queryByText(/Artista verificado · pMusic/i)).toBeNull();

    // Clicking hero shuffle activates true multi-album shuffle without repeats
    await act(async () => {
      fireEvent.click(screen.getByTestId('artist-shuffle-btn'));
    });
    expect(usePMusicStore.getState().shuffleEnabled).toBe(true);

    const spreadTracks = diversifyAndShuffleTracks([
      { ...albumTrackA, id: 'alb1-1', title: 'A1', album: { id: 'alb1', name: 'Album 1' } },
      { ...albumTrackA, id: 'alb1-2', title: 'A2', album: { id: 'alb1', name: 'Album 1' } },
      { ...albumTrackB, id: 'alb2-1', title: 'B1', album: { id: 'alb2', name: 'Album 2' } },
      { ...albumTrackB, id: 'alb2-2', title: 'B2', album: { id: 'alb2', name: 'Album 2' } },
      { ...otherAlbumTrack, id: 'alb3-1', title: 'C1', album: { id: 'alb3', name: 'Album 3' } },
      { ...otherAlbumTrack, id: 'alb3-2', title: 'C2', album: { id: 'alb3', name: 'Album 3' } },
    ]);
    expect(spreadTracks).toHaveLength(6);
    for (let i = 1; i < spreadTracks.length; i++) {
      expect(spreadTracks[i]?.album?.id).not.toBe(spreadTracks[i - 1]?.album?.id);
    }

    // 5. Car Mode has NO manual top-bar button and opens automatically when Android Auto / CarPlay triggers __pmusicSetCarMode
    expect(screen.queryByTestId('open-car-mode-btn')).toBeNull();
    expect(screen.queryByTestId('settings-car-mode-btn')).toBeNull();
    act(() => {
      (window as any).__pmusicSetCarMode?.(true);
    });
    rerender(<App />);
    expect(screen.getByTestId('car-mode-view')).toBeDefined();
    expect(screen.getByTestId('car-voice-search-btn')).toBeDefined();
    expect(screen.getByTestId('car-play-pause-btn')).toBeDefined();
    fireEvent.click(screen.getByRole('tab', { name: 'Playlists' }));
    act(() => {
      (window as any).__pmusicSetCarMode?.(false);
    });
    expect(usePMusicStore.getState().carModeOpen).toBe(false);
  });

  it('supports v0.18.2 studio Barra/Pantalla separation, anchored Connect popover, rhythm backdrop, and song credits modal', async () => {
    act(() => {
      usePMusicStore.setState({
        nowPlayingOpen: false,
        eqSheetOpen: false,
        djPopoverOpen: false,
        devicesSheetOpen: false,
        trackMenu: null,
        trackInfoModalTrack: null,
        activeDetailView: null,
        activeTab: 'Inicio',
        playerBarStyle: 'classic-center',
      });
    });

    render(<App />);

    // 1. Outside fullscreen, 3rd studio tab is "Barra" and hides EQ/Crossfade completely
    fireEvent.click(screen.getByTestId('dock-eq-btn'));
    const displayTabBtn = screen.getByTestId('audio-panel-tab-display');
    expect(displayTabBtn.textContent).toContain('Barra');
    fireEvent.click(displayTabBtn);
    expect(screen.getByTestId('dock-style-panel')).toBeDefined();
    expect(screen.queryByText('Ecualizador')).toBeNull();
    expect(screen.queryByText('Crossfade')).toBeNull();

    fireEvent.click(screen.getByTestId('studio-bar-style-floating-island'));
    expect(usePMusicStore.getState().playerBarStyle).toBe('floating-island');

    // Inside fullscreen, 3rd studio tab becomes "Pantalla", hides EQ/Crossfade, keeps only smooth non-reactive backdrops, and footer button says "Opciones"
    act(() => {
      usePMusicStore.setState({ nowPlayingOpen: true, eqSheetOpen: true, audioPanelTab: 'display' });
    });
    expect(screen.getByTestId('nowplaying-dj-btn').textContent).toContain('Opciones');
    expect(screen.getByTestId('audio-panel-tab-display').textContent).toContain('Pantalla');
    expect(screen.getByTestId('nowplaying-display-panel')).toBeDefined();
    expect(screen.queryByText('Ecualizador')).toBeNull();
    expect(screen.queryByTestId('backdrop-style-prism')).toBeNull();
    expect(screen.queryByTestId('backdrop-style-nebula')).toBeNull();
    expect(screen.queryByTestId('backdrop-style-rhythm')).toBeNull();

    fireEvent.click(screen.getByTestId('backdrop-style-paint'));
    expect(usePMusicStore.getState().nowPlayingBackdropStyle).toBe('paint');
    expect(
      screen.getByTestId('exotic-backdrop-canvas').getAttribute('data-exotic-style')
    ).toBe('paint');

    // Pulso is #1 in display panel and legacy removed backdrop IDs migrate cleanly to 'pulse'
    const firstBackdropBtn = screen.getByTestId('nowplaying-display-panel').querySelector('[data-testid^="backdrop-style-"]');
    expect(firstBackdropBtn?.getAttribute('data-testid')).toBe('backdrop-style-pulse');

    act(() => {
      usePMusicStore.getState().setNowPlayingBackdropStyle('nebula' as any);
    });
    expect(usePMusicStore.getState().nowPlayingBackdropStyle).toBe('pulse');
    act(() => {
      usePMusicStore.getState().setNowPlayingBackdropStyle('rhythm' as any);
    });
    expect(usePMusicStore.getState().nowPlayingBackdropStyle).toBe('pulse');

    // Desktop center frame keeps rounded shape without borders
    act(() => {
      usePMusicStore.setState({ nowPlayingOpen: false });
    });
    const mainFrame = screen.getByTestId('main-content-frame');
    expect(mainFrame.className).toContain('rounded-[20px]');
    expect(mainFrame.className).not.toContain('border-white');

    // 2. DevicesConnectSheet renders as an anchored dock popover matching Studio
    act(() => {
      usePMusicStore.setState({ nowPlayingOpen: false, playerBarStyle: 'classic-center' });
    });
    fireEvent.click(screen.getByTestId('dock-connect-btn'));
    const devicesSheet = screen.getByTestId('devices-sheet');
    expect(devicesSheet.getAttribute('aria-modal')).toBe('false');
    expect(devicesSheet.className).toContain('sm:w-[376px]');
    expect(screen.queryByTestId('eq-sheet')).toBeNull();

    // 3. Track context menu uses "Ver créditos" and opens credits modal with ficha artística
    const sampleTrack = usePMusicStore.getState().currentTrack;
    act(() => {
      usePMusicStore.setState({ devicesSheetOpen: false, nowPlayingOpen: false });
      usePMusicStore.getState().openTrackMenu(sampleTrack, 100, 100);
    });
    const creditsMenuItem = screen.getByTestId('track-menu-credits');
    expect(creditsMenuItem.textContent).toContain('Ver créditos');
    await act(async () => {
      fireEvent.click(creditsMenuItem);
    });
    expect(screen.getByTestId('track-info-modal')).toBeDefined();
    expect(screen.getByTestId('track-credits-section')).toBeDefined();

    // 4. Low-power hibernation pauses animations and unmounts WebGL/2D canvases when minimized/hidden
    act(() => {
      usePMusicStore.setState({
        trackInfoModalTrack: null,
        nowPlayingOpen: true,
        nowPlayingBackdropStyle: 'pulse',
      });
    });
    expect(screen.getByTestId('exotic-backdrop-canvas')).toBeDefined();
    act(() => {
      usePMusicStore.getState().setAppHidden(true);
    });
    expect(document.documentElement.classList.contains('pm-app-hidden')).toBe(true);
    expect(screen.queryByTestId('exotic-backdrop-canvas')).toBeNull();
    act(() => {
      usePMusicStore.getState().setAppHidden(false);
    });
    expect(document.documentElement.classList.contains('pm-app-hidden')).toBe(false);
    expect(screen.getByTestId('exotic-backdrop-canvas')).toBeDefined();
  });
});
