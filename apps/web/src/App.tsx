import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Check,
  Disc3,
  Download,
  Heart,
  Home,
  Library,
  ListMusic,
  Loader2,
  Maximize2,
  Mic2,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Pause,
  Play,
  Search,
  Settings,
  SkipBack,
  SkipForward,
  Sliders,
  Volume2,
  VolumeX,
  Wifi,
} from 'lucide-react';
import { formatDurationSec } from '@pmusic/core';
import { usePMusicStore, type MainNavTab } from './store/usePMusicStore.ts';
import {
  DetailViewPanel,
  HomeScreen,
  LibraryScreen,
  SearchScreen,
} from './components/Screens.tsx';
import {
  DevicesConnectSheet,
  EqAndCrossfadeSheet,
  ImportPlaylistModal,
  NowPlayingSheet,
  SettingsModal,
} from './components/Overlays.tsx';

export const App: React.FC = () => {
  const {
    initApp,
    activeTab,
    sidebarCollapsed,
    rightPanelOpen,
    activeDetailView,
    currentTrack,
    queue,
    queueIndex,
    isPlaying,
    positionSec,
    durationSec,
    volume,
    djMode,
    likedTracks,
    offlineDownloads,
    offlineEntries,
    playlists,
    nowPlayingOpen,
    eqSheetOpen,
    devicesSheetOpen,
    importModalOpen,
    settingsOpen,
    setActiveTab,
    setSidebarCollapsed,
    setRightPanelOpen,
    setNowPlayingOpen,
    setNowPlayingTab,
    setEqSheetOpen,
    setDevicesSheetOpen,
    setImportModalOpen,
    setSettingsOpen,
    setLibraryCategory,
    openLocalPlaylistDetail,
    openArtistDetail,
    closeDetailView,
    playTrack,
    togglePlayPause,
    nextTrack,
    prevTrack,
    seekTo,
    setVolume,
    toggleMute,
    toggleLike,
    downloadTrackOffline,
    toggleDjMode,
  } = usePMusicStore();

  const [isMobileViewport, setIsMobileViewport] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth < 768 : false
  );

  const swipeStartXRef = useRef<number | null>(null);

  useEffect(() => {
    void initApp();
  }, [initApp]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleResize = () => {
      setIsMobileViewport(window.innerWidth < 768);
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Global keyboard shortcuts (strictly guarded when typing in text inputs)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const isTextInput =
        tag === 'input' ||
        tag === 'textarea' ||
        tag === 'select' ||
        Boolean(target?.isContentEditable);

      if (e.key === 'Escape') {
        if (nowPlayingOpen) setNowPlayingOpen(false);
        else if (eqSheetOpen) setEqSheetOpen(false);
        else if (devicesSheetOpen) setDevicesSheetOpen(false);
        else if (importModalOpen) setImportModalOpen(false);
        else if (settingsOpen) setSettingsOpen(false);
        return;
      }

      if (isTextInput) return;

      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        void togglePlayPause();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        seekTo(Math.min(durationSec, positionSec + 5));
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        seekTo(Math.max(0, positionSec - 5));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setVolume(Math.min(1, volume + 0.05));
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setVolume(Math.max(0, volume - 0.05));
      } else if (e.key.toLowerCase() === 'm') {
        e.preventDefault();
        toggleMute();
      } else if (e.key.toLowerCase() === 'l') {
        e.preventDefault();
        setNowPlayingOpen(true);
        setNowPlayingTab('Letras');
      } else if (e.key.toLowerCase() === 'q') {
        e.preventDefault();
        setNowPlayingOpen(true);
        setNowPlayingTab('Cola');
      } else if (e.key.toLowerCase() === 'd') {
        e.preventDefault();
        void toggleDjMode();
      } else if (e.key === '/') {
        e.preventDefault();
        setActiveTab('Buscar');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    nowPlayingOpen,
    eqSheetOpen,
    devicesSheetOpen,
    importModalOpen,
    settingsOpen,
    durationSec,
    positionSec,
    volume,
    setNowPlayingOpen,
    setNowPlayingTab,
    setEqSheetOpen,
    setDevicesSheetOpen,
    setImportModalOpen,
    setSettingsOpen,
    togglePlayPause,
    seekTo,
    setVolume,
    toggleMute,
    toggleDjMode,
    setActiveTab,
  ]);

  const isLiked = likedTracks.some((l) => l.trackId === currentTrack.id);
  const dlStatus = offlineDownloads[currentTrack.id] ?? 'idle';
  const progressPct = Math.max(
    0,
    Math.min(100, (positionSec / Math.max(1, durationSec)) * 100)
  );
  const volumePct = Math.round(volume * 100);
  const upNextQueue = queue.slice(queueIndex + 1, queueIndex + 6);

  const navTabs: Array<{ id: MainNavTab; label: string; icon: React.ReactNode }> = [
    { id: 'Inicio', label: 'Inicio', icon: <Home className="h-[18px] w-[18px]" /> },
    { id: 'Buscar', label: 'Buscar', icon: <Search className="h-[18px] w-[18px]" /> },
    { id: 'Biblioteca', label: 'Biblioteca', icon: <Library className="h-[18px] w-[18px]" /> },
  ];

  const handleMiniPlayerSwipeStart = (clientX: number) => {
    swipeStartXRef.current = clientX;
  };

  const handleMiniPlayerSwipeEnd = (clientX: number) => {
    if (swipeStartXRef.current === null) return;
    const deltaX = clientX - swipeStartXRef.current;
    swipeStartXRef.current = null;
    if (deltaX <= -40) {
      void nextTrack();
    } else if (deltaX >= 40) {
      void prevTrack();
    }
  };

  return (
    <div className="relative flex min-h-dvh w-full flex-col bg-[#070709] text-[#F5F5F7]">
      <div className="relative z-10 flex flex-1">
        {/* Desktop Floating Collapsible Liquid Glass Sidebar (>= 768px) */}
        {!isMobileViewport && (
          <aside
            aria-label="Navegación principal"
            data-testid="desktop-sidebar"
            style={{ width: sidebarCollapsed ? 72 : 248 }}
            className="pm-glass-regular sticky top-2.5 z-30 ml-2.5 mt-2.5 flex h-[calc(100dvh-106px)] shrink-0 flex-col justify-between rounded-[18px] p-3 transition-[width] duration-200"
          >
            <div className="space-y-5 overflow-y-auto pm-no-scrollbar">
              {/* Brand Header & Collapse Toggle */}
              <div className="flex items-center justify-between px-1.5 pt-0.5">
                {!sidebarCollapsed && (
                  <button
                    type="button"
                    onClick={() => setActiveTab('Inicio')}
                    className="flex items-center gap-2.5 text-left"
                  >
                    <div className="flex h-7 w-7 items-center justify-center rounded-[8px] bg-white text-sm font-black text-[#070709]">
                      p
                    </div>
                    <span className="text-[16px] font-bold tracking-tight text-[#F5F5F7]">
                      pMusic
                    </span>
                  </button>
                )}
                <button
                  type="button"
                  aria-label={
                    sidebarCollapsed
                      ? 'Expandir barra lateral'
                      : 'Colapsar barra lateral'
                  }
                  onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-[#B4B4BE] hover:bg-white/[0.08] hover:text-white"
                >
                  {sidebarCollapsed ? (
                    <PanelLeftOpen className="h-4 w-4" />
                  ) : (
                    <PanelLeftClose className="h-4 w-4" />
                  )}
                </button>
              </div>

              {/* Primary Navigation */}
              <nav role="tablist" aria-label="Secciones principales" className="space-y-1">
                {navTabs.map((item) => {
                  const active = activeTab === item.id && !activeDetailView;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      aria-label={item.label}
                      onClick={() => setActiveTab(item.id)}
                      className={`flex w-full items-center gap-3 rounded-[10px] px-3 py-2 text-[13.5px] font-semibold ${
                        active
                          ? 'bg-white text-[#070709]'
                          : 'text-[#B4B4BE] hover:bg-white/[0.07] hover:text-[#F5F5F7]'
                      }`}
                    >
                      {item.icon}
                      {!sidebarCollapsed && <span>{item.label}</span>}
                    </button>
                  );
                })}
              </nav>

              {/* Solid Collection Shortcuts (Zero gradients) */}
              {!sidebarCollapsed && (
                <div className="space-y-1.5 border-t border-white/[0.07] pt-4">
                  <div className="flex items-center justify-between px-2">
                    <span className="text-[11px] font-semibold tracking-wider text-[#8E8E98]">
                      TU COLECCIÓN
                    </span>
                    <button
                      type="button"
                      aria-label="Importar playlist"
                      onClick={() => setImportModalOpen(true)}
                      className="rounded-md p-1 text-[#8E8E98] hover:bg-white/[0.08] hover:text-white"
                    >
                      <ListMusic className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setActiveTab('Biblioteca');
                      setLibraryCategory('Me gusta');
                    }}
                    className="flex w-full items-center gap-3 rounded-[10px] px-2 py-2 text-left hover:bg-white/[0.07]"
                  >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-[#24131B] text-[#F43F5E]">
                      <Heart className="h-4 w-4 fill-current" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-medium text-[#F5F5F7]">
                        Canciones que te gustan
                      </div>
                      <div className="text-[11px] text-[#8E8E98]">
                        {likedTracks.length} pistas
                      </div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setActiveTab('Biblioteca');
                      setLibraryCategory('Descargas');
                    }}
                    className="flex w-full items-center gap-3 rounded-[10px] px-2 py-2 text-left hover:bg-white/[0.07]"
                  >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-[#0F241D] text-[#34D399]">
                      <Download className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-medium text-[#F5F5F7]">
                        En este dispositivo
                      </div>
                      <div className="text-[11px] text-[#8E8E98]">
                        {offlineEntries.length} descargadas
                      </div>
                    </div>
                  </button>

                  {playlists.slice(0, 6).map((pl) => {
                    const thumb = pl.coverUrl ?? pl.tracks[0]?.thumbnailUrl;
                    return (
                      <button
                        key={pl.id}
                        type="button"
                        onClick={() => openLocalPlaylistDetail(pl.id)}
                        className="flex w-full items-center gap-3 rounded-[10px] px-2 py-1.5 text-left hover:bg-white/[0.07]"
                      >
                        {thumb ? (
                          <img
                            src={thumb}
                            alt=""
                            className="h-8 w-8 shrink-0 rounded-[7px] object-cover"
                          />
                        ) : (
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[7px] bg-[#181820] text-xs font-bold text-[#B4B4BE]">
                            {pl.name.slice(0, 1).toUpperCase()}
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[13px] text-[#F5F5F7]">
                            {pl.name}
                          </div>
                          <div className="truncate text-[11px] text-[#8E8E98]">
                            {pl.tracks.length} canciones
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Bottom Sidebar Utilities */}
            <div className="space-y-1 border-t border-white/[0.07] pt-2.5">
              <button
                type="button"
                aria-label="Importar playlist"
                onClick={() => setImportModalOpen(true)}
                className="flex w-full items-center gap-3 rounded-[10px] px-3 py-2 text-xs font-medium text-[#B4B4BE] hover:bg-white/[0.07] hover:text-white"
              >
                <ListMusic className="h-4 w-4 shrink-0" />
                {!sidebarCollapsed && <span>Importar playlist</span>}
              </button>

              <button
                type="button"
                aria-label="Dispositivos"
                onClick={() => setDevicesSheetOpen(true)}
                className="flex w-full items-center gap-3 rounded-[10px] px-3 py-2 text-xs font-medium text-[#B4B4BE] hover:bg-white/[0.07] hover:text-white"
              >
                <Wifi className="h-4 w-4 shrink-0 text-[#34D399]" />
                {!sidebarCollapsed && <span>Dispositivos</span>}
              </button>

              <button
                type="button"
                aria-label="Ajustes"
                onClick={() => setSettingsOpen(true)}
                className="flex w-full items-center gap-3 rounded-[10px] px-3 py-2 text-xs font-medium text-[#B4B4BE] hover:bg-white/[0.07] hover:text-white"
              >
                <Settings className="h-4 w-4 shrink-0" />
                {!sidebarCollapsed && <span>Ajustes</span>}
              </button>
            </div>
          </aside>
        )}

        {/* Center Main Canvas (Solid #070709, Zero Blur, Zero Background Gradients) */}
        <main
          data-surface="content"
          className="min-w-0 flex-1 overflow-y-auto px-4 pb-44 pt-0 md:px-8 md:pb-32"
        >
          {/* Sticky Solid Command Bar */}
          <div className="sticky top-0 z-20 -mx-4 mb-5 flex items-center justify-between gap-3 border-b border-white/[0.05] bg-[#070709] px-4 py-3 md:-mx-8 md:px-8">
            <div className="flex items-center gap-2.5">
              {activeDetailView ? (
                <button
                  type="button"
                  aria-label="Volver"
                  onClick={() => closeDetailView()}
                  className="inline-flex h-9 items-center gap-1.5 rounded-full bg-[#14141A] px-3.5 text-xs font-semibold text-[#F5F5F7] hover:bg-[#1E1E26]"
                >
                  <ArrowLeft className="h-4 w-4" />
                  <span>Volver</span>
                </button>
              ) : isMobileViewport ? (
                <div className="flex items-center gap-2">
                  <div className="flex h-7 w-7 items-center justify-center rounded-[8px] bg-white text-xs font-black text-[#070709]">
                    p
                  </div>
                  <span className="text-[16px] font-bold tracking-tight text-[#F5F5F7]">
                    pMusic
                  </span>
                </div>
              ) : null}

              {/* Quick Search Launcher Pill on Desktop (opens Buscar) */}
              {!isMobileViewport && activeTab !== 'Buscar' && (
                <button
                  type="button"
                  onClick={() => setActiveTab('Buscar')}
                  className="flex w-72 items-center justify-between gap-2 rounded-full bg-[#131318] px-3.5 py-2 text-xs text-[#8E8E98] ring-1 ring-white/[0.07] hover:bg-[#1A1A22] hover:text-[#F5F5F7] lg:w-80"
                >
                  <span className="flex items-center gap-2">
                    <Search className="h-3.5 w-3.5 text-[#B4B4BE]" />
                    <span>Buscar canciones, artistas o álbumes…</span>
                  </span>
                  <kbd className="rounded bg-white/[0.08] px-1.5 py-0.5 text-[10px] font-semibold text-[#B4B4BE]">
                    /
                  </kbd>
                </button>
              )}
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                aria-label="Modo Sesión DJ"
                aria-pressed={djMode.enabled}
                onClick={() => void toggleDjMode()}
                className={`inline-flex items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ${
                  djMode.enabled
                    ? 'bg-[#221536] text-[#E9D5FF] ring-1 ring-[#C084FC]/50'
                    : 'bg-[#131318] text-[#B4B4BE] hover:bg-[#1D1D25] hover:text-white'
                }`}
              >
                <Disc3 className="h-3.5 w-3.5 text-[#C084FC]" />
                <span className="hidden sm:inline">
                  {djMode.enabled ? 'DJ Activo' : 'Sesión DJ'}
                </span>
              </button>

              {!isMobileViewport && (
                <button
                  type="button"
                  aria-label="Ecualizador"
                  onClick={() => setEqSheetOpen(true)}
                  className="inline-flex items-center justify-center rounded-full bg-[#131318] p-2 text-[#B4B4BE] hover:bg-[#1D1D25] hover:text-white"
                >
                  <Sliders className="h-4 w-4" />
                </button>
              )}

              <button
                type="button"
                aria-label="Dispositivos"
                onClick={() => setDevicesSheetOpen(true)}
                className="inline-flex items-center justify-center rounded-full bg-[#131318] p-2 text-[#34D399] hover:bg-[#1D1D25]"
              >
                <Wifi className="h-4 w-4" />
              </button>

              <button
                type="button"
                aria-label="Ajustes"
                onClick={() => setSettingsOpen(true)}
                className="inline-flex items-center justify-center rounded-full bg-[#131318] p-2 text-[#B4B4BE] hover:bg-[#1D1D25] hover:text-white"
              >
                <Settings className="h-4 w-4" />
              </button>

              {!isMobileViewport && (
                <button
                  type="button"
                  aria-label={
                    rightPanelOpen ? 'Ocultar panel de cola' : 'Mostrar panel de cola'
                  }
                  onClick={() => setRightPanelOpen(!rightPanelOpen)}
                  className="hidden items-center justify-center rounded-full bg-[#131318] p-2 text-[#B4B4BE] hover:bg-[#1D1D25] hover:text-white xl:inline-flex"
                >
                  {rightPanelOpen ? (
                    <PanelRightClose className="h-4 w-4" />
                  ) : (
                    <PanelRightOpen className="h-4 w-4" />
                  )}
                </button>
              )}
            </div>
          </div>

          {activeDetailView ? (
            <DetailViewPanel />
          ) : (
            <>
              {activeTab === 'Inicio' && <HomeScreen />}
              {activeTab === 'Buscar' && <SearchScreen />}
              {activeTab === 'Biblioteca' && <LibraryScreen />}
            </>
          )}
        </main>

        {/* Desktop Collapsible Right "En Reproducción" Panel (>= 1280px, solid OLED) */}
        {!isMobileViewport && rightPanelOpen && (
          <aside
            aria-label="En reproducción y siguiente"
            className="hidden h-[calc(100dvh-106px)] w-[304px] shrink-0 flex-col gap-5 overflow-y-auto border-l border-white/[0.06] bg-[#0B0B0E] p-4 pm-no-scrollbar xl:sticky xl:top-2.5 xl:mt-2.5 xl:flex"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold tracking-wide text-[#B4B4BE]">
                EN REPRODUCCIÓN
              </span>
              <button
                type="button"
                aria-label="Expandir reproductor"
                onClick={() => setNowPlayingOpen(true)}
                className="rounded-full p-1.5 text-[#8E8E98] hover:bg-white/[0.08] hover:text-white"
              >
                <Maximize2 className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* Song card with subtle localized cover halo ONLY for the active track artwork */}
            <div data-surface="content" className="space-y-3">
              <div className="relative overflow-hidden rounded-[14px] bg-[#141419] p-1">
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute -inset-4 opacity-45 blur-xl"
                  style={{
                    background:
                      'radial-gradient(circle at 50% 45%, var(--pm-ambient-1), transparent 70%)',
                  }}
                />
                <button
                  type="button"
                  aria-label="Abrir vista de canción"
                  onClick={() => setNowPlayingOpen(true)}
                  className="relative block w-full overflow-hidden rounded-[12px]"
                >
                  <img
                    src={currentTrack.thumbnailHighUrl ?? currentTrack.thumbnailUrl}
                    alt={currentTrack.title}
                    className="aspect-square w-full object-cover shadow-2xl"
                  />
                </button>
              </div>

              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <button
                    type="button"
                    onClick={() => setNowPlayingOpen(true)}
                    className="block max-w-full truncate text-left text-[17px] font-bold text-[#F5F5F7] hover:underline"
                  >
                    {currentTrack.title}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void openArtistDetail(
                        currentTrack.artists[0]?.id ??
                          currentTrack.artists[0]?.name ??
                          ''
                      )
                    }
                    className="block max-w-full truncate text-left text-[13px] text-[#B4B4BE] hover:text-white hover:underline"
                  >
                    {currentTrack.artists.map((a) => a.name).join(', ')}
                  </button>
                </div>

                <div className="flex items-center gap-0.5">
                  <button
                    type="button"
                    aria-label={isLiked ? 'Quitar de Me gusta' : 'Añadir a Me gusta'}
                    onClick={() => void toggleLike(currentTrack)}
                    className={`rounded-full p-2 ${
                      isLiked ? 'text-[#F43F5E]' : 'text-[#8E8E98] hover:text-white'
                    }`}
                  >
                    <Heart className={`h-4 w-4 ${isLiked ? 'fill-current' : ''}`} />
                  </button>
                  <button
                    type="button"
                    aria-label="Descargar canción offline"
                    onClick={() => void downloadTrackOffline(currentTrack)}
                    className="rounded-full p-2 text-[#8E8E98] hover:text-white"
                  >
                    {dlStatus === 'downloading' ? (
                      <Loader2 className="h-4 w-4 animate-spin text-white" />
                    ) : dlStatus === 'downloaded' ? (
                      <Check className="h-4 w-4 text-[#34D399]" />
                    ) : (
                      <Download className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  setNowPlayingOpen(true);
                  setNowPlayingTab('Letras');
                }}
                className="flex w-full items-center justify-center gap-2 rounded-[10px] bg-[#16161C] py-2 text-xs font-semibold text-[#F5F5F7] hover:bg-[#1E1E26]"
              >
                <Mic2 className="h-3.5 w-3.5" />
                <span>Ver letras sincronizadas</span>
              </button>
            </div>

            {/* Next in Queue Preview */}
            <div className="space-y-2.5 border-t border-white/[0.06] pt-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-[#F5F5F7]">
                  A continuación
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setNowPlayingOpen(true);
                    setNowPlayingTab('Cola');
                  }}
                  className="text-[11px] font-semibold text-[#B4B4BE] hover:text-white"
                >
                  Abrir cola
                </button>
              </div>

              <div className="space-y-1">
                {upNextQueue.map((track) => (
                  <button
                    key={track.id}
                    type="button"
                    onClick={() => void playTrack(track, queue)}
                    className="flex w-full items-center gap-2.5 rounded-[8px] p-1.5 text-left hover:bg-white/[0.06]"
                  >
                    <img
                      src={track.thumbnailUrl}
                      alt=""
                      className="h-10 w-10 shrink-0 rounded-[6px] object-cover"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-medium text-[#F5F5F7]">
                        {track.title}
                      </div>
                      <div className="truncate text-[11.5px] text-[#8E8E98]">
                        {track.artists.map((a) => a.name).join(', ')}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </aside>
        )}
      </div>

      {/* Desktop Floating Liquid Glass Player Bar (>= 768px) */}
      {!isMobileViewport && (
        <footer
          aria-label="Reproductor de escritorio"
          data-testid="desktop-player-bar"
          className="pm-glass-regular fixed inset-x-2.5 bottom-2.5 z-40 flex h-20 items-center justify-between gap-6 rounded-[18px] px-5"
        >
          {/* Left: Track Info */}
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <button
              type="button"
              aria-label="Abrir reproductor a pantalla completa"
              onClick={() => setNowPlayingOpen(true)}
              className="group flex min-w-0 items-center gap-3 text-left"
            >
              <img
                src={currentTrack.thumbnailUrl}
                alt={currentTrack.title}
                className="h-12 w-12 shrink-0 rounded-[8px] object-cover shadow-md transition-transform group-hover:scale-105"
              />
              <div className="min-w-0">
                <div className="truncate text-[14px] font-semibold text-[#F5F5F7]">
                  {currentTrack.title}
                </div>
                <div className="truncate text-[12px] text-[#B4B4BE]">
                  {currentTrack.artists.map((a) => a.name).join(', ')}
                </div>
              </div>
            </button>

            <button
              type="button"
              aria-label={isLiked ? 'Quitar de Me gusta' : 'Añadir a Me gusta'}
              aria-pressed={isLiked}
              onClick={() => void toggleLike(currentTrack)}
              className={`rounded-full p-2 ${
                isLiked ? 'text-[#F43F5E]' : 'text-[#8E8E98] hover:text-white'
              }`}
            >
              <Heart className={`h-4 w-4 ${isLiked ? 'fill-current' : ''}`} />
            </button>
          </div>

          {/* Center: Transport & Custom Filled Scrubber */}
          <div className="flex max-w-xl flex-1 flex-col items-center gap-1.5">
            <div className="flex items-center gap-4">
              <button
                type="button"
                aria-label="Anterior"
                onClick={() => void prevTrack()}
                className="rounded-full p-2 text-[#B4B4BE] hover:text-white"
              >
                <SkipBack className="h-4 w-4" />
              </button>

              <button
                type="button"
                aria-label={isPlaying ? 'Pausar' : 'Reproducir'}
                onClick={() => void togglePlayPause()}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-[#070709] shadow-sm hover:scale-105"
              >
                {isPlaying ? (
                  <Pause className="h-4 w-4 fill-current" />
                ) : (
                  <Play className="h-4 w-4 translate-x-[1px] fill-current" />
                )}
              </button>

              <button
                type="button"
                aria-label="Siguiente"
                onClick={() => void nextTrack()}
                className="rounded-full p-2 text-[#B4B4BE] hover:text-white"
              >
                <SkipForward className="h-4 w-4" />
              </button>
            </div>

            <div className="flex w-full items-center gap-2.5">
              <span className="tabular-nums w-9 text-right text-[11px] font-medium text-[#8E8E98]">
                {formatDurationSec(positionSec)}
              </span>
              <input
                type="range"
                role="slider"
                aria-label="Posición de reproducción"
                min={0}
                max={Math.max(1, Math.round(durationSec))}
                value={Math.min(Math.round(durationSec), Math.round(positionSec))}
                onChange={(e) => seekTo(Number(e.target.value))}
                style={{ '--pm-fill': `${progressPct}%` } as React.CSSProperties}
                className="pm-range-subtle flex-1"
              />
              <span className="tabular-nums w-9 text-[11px] font-medium text-[#8E8E98]">
                {formatDurationSec(durationSec)}
              </span>
            </div>
          </div>

          {/* Right: DJ, Lyrics, EQ, Devices, Volume */}
          <div className="flex flex-1 items-center justify-end gap-1">
            <button
              type="button"
              aria-label="Modo Sesión DJ"
              aria-pressed={djMode.enabled}
              onClick={() => {
                setNowPlayingOpen(true);
                setNowPlayingTab('Cola');
              }}
              className={`mr-1 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold ${
                djMode.enabled
                  ? 'bg-[#221536] text-[#E9D5FF] ring-1 ring-[#C084FC]/50'
                  : 'text-[#B4B4BE] hover:bg-white/[0.08] hover:text-white'
              }`}
            >
              <Disc3 className="h-3.5 w-3.5 text-[#C084FC]" />
              <span>DJ</span>
            </button>

            <button
              type="button"
              aria-label="Letras sincronizadas"
              onClick={() => {
                setNowPlayingOpen(true);
                setNowPlayingTab('Letras');
              }}
              className="rounded-full p-2 text-[#B4B4BE] hover:bg-white/[0.08] hover:text-white"
            >
              <Mic2 className="h-4 w-4" />
            </button>

            <button
              type="button"
              aria-label="Ecualizador"
              onClick={() => setEqSheetOpen(true)}
              className="rounded-full p-2 text-[#B4B4BE] hover:bg-white/[0.08] hover:text-white"
            >
              <Sliders className="h-4 w-4" />
            </button>

            <button
              type="button"
              aria-label="Dispositivos"
              onClick={() => setDevicesSheetOpen(true)}
              className="rounded-full p-2 text-[#34D399] hover:bg-white/[0.08]"
            >
              <Wifi className="h-4 w-4" />
            </button>

            <button
              type="button"
              aria-label={volume === 0 ? 'Activar sonido' : 'Silenciar'}
              onClick={() => toggleMute()}
              className="rounded-full p-2 text-[#B4B4BE] hover:bg-white/[0.08] hover:text-white"
            >
              {volume === 0 ? (
                <VolumeX className="h-4 w-4" />
              ) : (
                <Volume2 className="h-4 w-4" />
              )}
            </button>

            <input
              type="range"
              role="slider"
              aria-label="Volumen"
              min={0}
              max={100}
              value={volumePct}
              onChange={(e) => setVolume(Number(e.target.value) / 100)}
              style={{ '--pm-fill': `${volumePct}%` } as React.CSSProperties}
              className="pm-range-subtle w-20"
            />
          </div>
        </footer>
      )}

      {/* Mobile Floating Mini-Player + Floating 3-Tab Glass Capsule (< 768px) */}
      {isMobileViewport && (
        <>
          <div
            data-testid="mobile-mini-player"
            onTouchStart={(e) => {
              const t = e.touches[0];
              if (t) handleMiniPlayerSwipeStart(t.clientX);
            }}
            onTouchEnd={(e) => {
              const t = e.changedTouches[0];
              if (t) handleMiniPlayerSwipeEnd(t.clientX);
            }}
            onPointerDown={(e) => handleMiniPlayerSwipeStart(e.clientX)}
            onPointerUp={(e) => handleMiniPlayerSwipeEnd(e.clientX)}
            className="pm-glass-regular fixed inset-x-3 bottom-21 z-40 overflow-hidden rounded-[18px] px-3 py-2"
          >
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                aria-label="Abrir reproductor Reproduciendo ahora"
                onClick={() => setNowPlayingOpen(true)}
                className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
              >
                <img
                  src={currentTrack.thumbnailUrl}
                  alt={currentTrack.title}
                  className="h-11 w-11 shrink-0 rounded-[8px] object-cover shadow-sm"
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] font-semibold text-[#F5F5F7]">
                    {currentTrack.title}
                  </div>
                  <div className="truncate text-xs text-[#B4B4BE]">
                    {currentTrack.artists.map((a) => a.name).join(', ')}
                  </div>
                </div>
              </button>

              <div className="flex items-center gap-1">
                <button
                  type="button"
                  aria-label={isPlaying ? 'Pausar' : 'Reproducir'}
                  onClick={() => void togglePlayPause()}
                  className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-[#070709]"
                >
                  {isPlaying ? (
                    <Pause className="h-5 w-5 fill-current" />
                  ) : (
                    <Play className="h-5 w-5 translate-x-[1px] fill-current" />
                  )}
                </button>

                <button
                  type="button"
                  aria-label="Siguiente canción"
                  onClick={() => void nextTrack()}
                  className="flex h-11 w-11 items-center justify-center rounded-full text-[#F5F5F7]"
                >
                  <SkipForward className="h-5 w-5" />
                </button>
              </div>
            </div>

            {/* Subtle solid hairline progress track along bottom of mini-player */}
            <div className="mt-1.5 h-[2px] w-full overflow-hidden rounded-full bg-white/15">
              <div
                className="h-full rounded-full bg-white transition-[width] duration-200"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>

          <nav
            role="tablist"
            aria-label="Navegación móvil"
            data-testid="mobile-tab-bar"
            className="pm-glass-regular fixed inset-x-3 bottom-3 z-40 grid grid-cols-3 gap-1 rounded-[22px] p-1.5"
          >
            {navTabs.map((item) => {
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setActiveTab(item.id)}
                  className={`flex flex-col items-center justify-center rounded-[16px] py-1.5 text-xs font-bold ${
                    active
                      ? 'bg-white text-[#070709]'
                      : 'text-[#B4B4BE] hover:text-white'
                  }`}
                >
                  {item.icon}
                  <span className="mt-0.5 text-[11px]">{item.label}</span>
                </button>
              );
            })}
          </nav>
        </>
      )}

      {/* Overlays / Modals */}
      <NowPlayingSheet />
      <EqAndCrossfadeSheet />
      <DevicesConnectSheet />
      <ImportPlaylistModal />
      <SettingsModal />
    </div>
  );
};

export default App;
