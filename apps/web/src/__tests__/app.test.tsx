// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen, fireEvent } from '@testing-library/react';
import { App } from '../App.tsx';
import { ArtistLinks } from '../components/ArtistLinks.tsx';
import { usePMusicStore } from '../store/usePMusicStore.ts';

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

    fireEvent.click(screen.getByTestId('dock-dj-btn'));
    expect(screen.getByTestId('dj-popover')).toBeDefined();
    expect(screen.getByTestId('dj-style-quick')).toBeDefined();
    expect(screen.getByTestId('dj-style-full')).toBeDefined();

    fireEvent.click(screen.getByTestId('dock-eq-btn'));
    expect(screen.queryByTestId('dj-popover')).toBeNull();
    expect(screen.getByTestId('eq-sheet')).toBeDefined();
    fireEvent.click(screen.getByTestId('dock-eq-btn'));

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

  it('shows Play/Pause loading indicator when isBuffering is active and triggers epic skip/prev/shuffle animations', async () => {
    act(() => {
      usePMusicStore.setState({ isBuffering: false, isPlaying: false });
    });
    render(<App />);
    const playBtn = screen.getByTestId('dock-play-btn');
    expect(screen.queryByTestId('dock-play-loader')).toBeNull();

    act(() => {
      usePMusicStore.setState({ isBuffering: true });
    });
    expect(screen.getByTestId('dock-play-loader')).toBeDefined();
    expect(playBtn.getAttribute('aria-label')).toBe('Cargando canción');

    act(() => {
      usePMusicStore.setState({ isBuffering: false });
    });
    expect(screen.queryByTestId('dock-play-loader')).toBeNull();

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

  it('hides MEZCLANDO · DJ and Entrando takeover during plain crossfade, and deactivates DJ Mode synchronously', async () => {
    const t1 = usePMusicStore.getState().homeShelves[0]!.tracks![0]!;
    const t2 = usePMusicStore.getState().homeShelves[0]!.tracks![1]!;

    act(() => {
      usePMusicStore.setState({
        nowPlayingOpen: true,
        isBuffering: false,
        isTransitioning: true,
        transitionProgress01: 0.45,
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
});
