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
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Pause,
  Play,
  Plus,
  Repeat,
  Repeat1,
  Search,
  Settings,
  Shuffle,
  SkipBack,
  SkipForward,
  Sliders,
  Sparkles,
  Volume2,
  VolumeX,
  Wifi,
} from 'lucide-react';
import { formatDurationSec } from '@pmusic/core';
import { usePMusicStore, type MainNavTab } from './store/usePMusicStore.ts';
import { isElectronDesktopRuntime } from './platform/web-bridge.ts';
import { PMusicLogo } from './components/PMusicLogo.tsx';
import { AppToast, TrackContextMenu } from './components/TrackMenu.tsx';
import { readTrackFromDropEvent } from './utils/track-dnd.ts';
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
    shuffleEnabled,
    repeatMode,
    isPlaying,
    positionSec,
    durationSec,
    volume,
    djMode,
    isTransitioning,
    activeTransitionType,
    transitionProgress01,
    activeTransitionPlan,
    trackAnalyses,
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
    toggleShuffle,
    cycleRepeatMode,
    seekTo,
    setVolume,
    toggleMute,
    toggleLike,
    likeTrackIfNeeded,
    createPlaylist,
    addTrackToPlaylist,
    openTrackMenu,
    showToast,
    downloadTrackOffline,
    toggleDjMode,
  } = usePMusicStore();

  const [isMobileViewport, setIsMobileViewport] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth < 768 : false
  );
  const [sidebarDropTargetId, setSidebarDropTargetId] = useState<string | null>(null);
  const isElectronDesktop = isElectronDesktopRuntime();

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
      } else if (e.key.toLowerCase() === 's') {
        e.preventDefault();
        toggleShuffle();
      } else if (e.key.toLowerCase() === 'r') {
        e.preventDefault();
        cycleRepeatMode();
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
    toggleShuffle,
    cycleRepeatMode,
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
  const cueStartPct =
    djMode.enabled && activeTransitionPlan && durationSec > 10
      ? Math.max(0, Math.min(96, (activeTransitionPlan.cueOutSec / durationSec) * 100))
      : null;
  const cueWidthPct =
    djMode.enabled && activeTransitionPlan && durationSec > 10
      ? Math.max(
          2.5,
          Math.min(
            100 - (cueStartPct ?? 0),
            (activeTransitionPlan.transitionDurationSec / durationSec) * 100
          )
        )
      : 0;
  const djCueCountdownSec =
    djMode.enabled && activeTransitionPlan
      ? Math.max(0, Math.round(activeTransitionPlan.cueOutSec - positionSec))
      : null;
  const currentBpm = trackAnalyses[currentTrack.id]?.bpm;
  const repeatLabel =
    repeatMode === 'one'
      ? 'Repetir esta canción (activar siguiente: desactivar)'
      : repeatMode === 'all'
        ? 'Repetir cola o playlist (siguiente: repetir una)'
        : 'Activar repetición de playlist';

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
    <div
      className={`relative flex w-full flex-col bg-[#070709] text-[#F5F5F7] ${
        isMobileViewport ? 'min-h-dvh' : 'h-dvh overflow-hidden'
      }`}
    >
      {/* Unified Desktop Header & Integrated Frameless Windows Drag Bar */}
      {!isMobileViewport && (
        <header className="pm-drag-region z-30 flex h-12 w-full shrink-0 items-center justify-between gap-3 border-b border-white/[0.05] bg-[#070709] px-3">
          <div className="pm-no-drag flex items-center gap-2">
            <button
              type="button"
              aria-label="Ir al inicio"
              onClick={() => setActiveTab('Inicio')}
              className="flex items-center rounded-[10px] px-1.5 py-1 hover:bg-white/[0.06]"
            >
              <PMusicLogo size={28} showWordmark />
            </button>

            <button
              type="button"
              aria-label={
                sidebarCollapsed ? 'Expandir barra lateral' : 'Colapsar barra lateral'
              }
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[#B4B4BE] hover:bg-white/[0.08] hover:text-white"
            >
              {sidebarCollapsed ? (
                <PanelLeftOpen className="h-4 w-4" />
              ) : (
                <PanelLeftClose className="h-4 w-4" />
              )}
            </button>

            {activeDetailView && (
              <button
                type="button"
                aria-label="Volver"
                onClick={() => closeDetailView()}
                className="inline-flex h-8 items-center gap-1.5 rounded-full bg-[#14141A] px-3 text-xs font-semibold text-[#F5F5F7] hover:bg-[#1E1E26]"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                <span>Volver</span>
              </button>
            )}
          </div>

          <div className="flex flex-1 items-center justify-center">
            {activeTab !== 'Buscar' && (
              <button
                type="button"
                onClick={() => setActiveTab('Buscar')}
                className="pm-no-drag flex w-72 items-center justify-between gap-2 rounded-full bg-[#131318] px-3.5 py-1.5 text-xs text-[#8E8E98] ring-1 ring-white/[0.07] hover:bg-[#1A1A22] hover:text-[#F5F5F7] lg:w-96"
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

          <div
            className={`pm-no-drag flex items-center gap-1.5 ${
              isElectronDesktop ? 'mr-[138px]' : ''
            }`}
          >
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
              <span>{djMode.enabled ? 'DJ Activo' : 'Sesión DJ'}</span>
            </button>

            <button
              type="button"
              aria-label="Ecualizador"
              onClick={() => setEqSheetOpen(true)}
              className="inline-flex items-center justify-center rounded-full bg-[#131318] p-2 text-[#B4B4BE] hover:bg-[#1D1D25] hover:text-white"
            >
              <Sliders className="h-4 w-4" />
            </button>

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
          </div>
        </header>
      )}

      <div
        className={`relative z-10 flex min-h-0 flex-1 ${
          !isMobileViewport ? 'gap-3 px-3 pt-3 pb-[112px]' : ''
        }`}
      >
        {/* Desktop Floating Collapsible Liquid Glass Sidebar (>= 768px) */}
        {!isMobileViewport && (
          <aside
            aria-label="Navegación principal"
            data-testid="desktop-sidebar"
            style={{ width: sidebarCollapsed ? 72 : 244 }}
            className="pm-glass-regular z-30 flex h-full shrink-0 flex-col justify-between rounded-[20px] p-3 transition-[width] duration-200"
          >
            <div className="space-y-4 overflow-y-auto pm-no-scrollbar">
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

              {/* Solid Collection Shortcuts (Zero gradients, Drag & Drop Playlist Targets) */}
              {!sidebarCollapsed && (
                <div className="space-y-1.5 border-t border-white/[0.07] pt-4">
                  <div className="flex items-center justify-between px-2">
                    <span className="text-[11px] font-semibold tracking-wider text-[#8E8E98]">
                      TU COLECCIÓN
                    </span>
                    <div className="flex items-center gap-0.5">
                      <button
                        type="button"
                        aria-label="Crear nueva playlist"
                        onClick={async () => {
                          const created = await createPlaylist(
                            `Mi Playlist #${playlists.length + 1}`,
                            'Creada en pMusic',
                            []
                          );
                          openLocalPlaylistDetail(created.id);
                          showToast(`Playlist «${created.name}» creada`);
                        }}
                        className="rounded-md p-1 text-[#8E8E98] hover:bg-white/[0.08] hover:text-white"
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        aria-label="Importar playlist"
                        onClick={() => setImportModalOpen(true)}
                        className="rounded-md p-1 text-[#8E8E98] hover:bg-white/[0.08] hover:text-white"
                      >
                        <ListMusic className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  <button
                    type="button"
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'copy';
                      setSidebarDropTargetId('liked');
                    }}
                    onDragLeave={() => {
                      if (sidebarDropTargetId === 'liked') setSidebarDropTargetId(null);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      setSidebarDropTargetId(null);
                      const dropped = readTrackFromDropEvent(e);
                      if (dropped) void likeTrackIfNeeded(dropped);
                    }}
                    onClick={() => {
                      setActiveTab('Biblioteca');
                      setLibraryCategory('Me gusta');
                    }}
                    className={`flex w-full items-center gap-3 rounded-[10px] px-2 py-2 text-left transition-all ${
                      sidebarDropTargetId === 'liked'
                        ? 'bg-white/[0.14] ring-2 ring-white/75'
                        : 'hover:bg-white/[0.07]'
                    }`}
                  >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-[#24131B] text-[#F43F5E]">
                      <Heart className="h-4 w-4 fill-current" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-medium text-[#F5F5F7]">
                        Canciones que te gustan
                      </div>
                      <div className="text-[11px] text-[#8E8E98]">
                        {sidebarDropTargetId === 'liked'
                          ? 'Suelta para guardar'
                          : `${likedTracks.length} pistas`}
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

                  {playlists.slice(0, 12).map((pl) => {
                    const thumb = pl.coverUrl ?? pl.tracks[0]?.thumbnailUrl;
                    const isDropActive = sidebarDropTargetId === pl.id;
                    return (
                      <button
                        key={pl.id}
                        type="button"
                        onDragOver={(e) => {
                          e.preventDefault();
                          e.dataTransfer.dropEffect = 'copy';
                          setSidebarDropTargetId(pl.id);
                        }}
                        onDragLeave={() => {
                          if (sidebarDropTargetId === pl.id) setSidebarDropTargetId(null);
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          setSidebarDropTargetId(null);
                          const dropped = readTrackFromDropEvent(e);
                          if (dropped) void addTrackToPlaylist(pl.id, dropped);
                        }}
                        onClick={() => openLocalPlaylistDetail(pl.id)}
                        className={`flex w-full items-center gap-3 rounded-[10px] px-2 py-1.5 text-left transition-all ${
                          isDropActive
                            ? 'bg-white/[0.14] ring-2 ring-white/75'
                            : 'hover:bg-white/[0.07]'
                        }`}
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
                            {isDropActive ? '+ Soltar para añadir' : `${pl.tracks.length} canciones`}
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
          className={
            isMobileViewport
              ? 'min-w-0 flex-1 overflow-y-auto px-4 pb-44 pt-0'
              : 'h-full min-w-0 flex-1 overflow-y-auto px-7 pt-3 pb-8'
          }
        >
          {/* Mobile Top Command Bar */}
          {isMobileViewport && (
            <div className="sticky top-0 z-20 -mx-4 mb-5 flex items-center justify-between gap-3 border-b border-white/[0.05] bg-[#070709] px-4 py-3">
              <div className="flex items-center gap-2.5">
                {activeDetailView ? (
                  <button
                    type="button"
                    aria-label="Volver"
                    onClick={() => closeDetailView()}
                    className="inline-flex h-10 items-center gap-1.5 rounded-full bg-[#14141A] px-3.5 text-xs font-semibold text-[#F5F5F7] hover:bg-[#1E1E26]"
                  >
                    <ArrowLeft className="h-4 w-4" />
                    <span>Volver</span>
                  </button>
                ) : (
                  <PMusicLogo size={28} showWordmark />
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
                </button>

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
              </div>
            </div>
          )}

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
            className="hidden h-full w-[304px] shrink-0 flex-col gap-5 overflow-y-auto rounded-[20px] border border-white/[0.06] bg-[#0B0B0F] p-4 pm-no-scrollbar xl:flex"
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
                  <button
                    type="button"
                    aria-label={`Más opciones para ${currentTrack.title}`}
                    onClick={(e) => {
                      const r = e.currentTarget.getBoundingClientRect();
                      openTrackMenu(currentTrack, r.left - 220, r.bottom + 6);
                    }}
                    className="rounded-full p-2 text-[#8E8E98] hover:text-white"
                  >
                    <MoreHorizontal className="h-4 w-4" />
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

            {/* DJ Live Transition Preview Card */}
            {djMode.enabled && activeTransitionPlan && (
              <div className="rounded-[12px] border border-[#C084FC]/30 bg-[#171222] p-3 text-xs">
                <div className="flex items-center justify-between font-bold text-[#E9D5FF]">
                  <span className="flex items-center gap-1.5">
                    <Sparkles className="h-3.5 w-3.5 text-[#C084FC]" />
                    <span>
                      {isTransitioning
                        ? 'Mezclando en vivo…'
                        : djCueCountdownSec !== null && djCueCountdownSec > 0
                          ? `Mezcla DJ en ${djCueCountdownSec}s`
                          : 'Mezcla lista'}
                    </span>
                  </span>
                  <span className="tabular-nums text-[11px] text-[#B4B4BE]">
                    {currentBpm ?? 120} BPM
                  </span>
                </div>
                <div className="mt-1 text-[11px] text-[#B4B4BE]">
                  {activeTransitionPlan.transitionType === 'eq_swap'
                    ? 'EQ Swap 200Hz'
                    : activeTransitionPlan.transitionType === 'filter_sweep'
                      ? 'Filtro Resonante'
                      : 'Echo Out BPM'}{' '}
                  · {activeTransitionPlan.transitionBars} compases (
                  {activeTransitionPlan.transitionDurationSec}s) ·{' '}
                  {Math.round(activeTransitionPlan.compatibilityScore * 100)}% fit
                </div>
                {isTransitioning && (
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full rounded-full bg-[#C084FC] transition-[width] duration-100"
                      style={{ width: `${Math.round(transitionProgress01 * 100)}%` }}
                    />
                  </div>
                )}
              </div>
            )}

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
          className="pm-glass-regular fixed inset-x-3 bottom-3 z-40 grid h-[88px] grid-cols-[minmax(220px,1fr)_minmax(420px,1.65fr)_minmax(240px,1fr)] items-center gap-6 rounded-[20px] px-5 py-2.5"
        >
          {/* Left: Track Info */}
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              aria-label="Abrir reproductor a pantalla completa"
              onClick={() => setNowPlayingOpen(true)}
              className="group flex min-w-0 items-center gap-3 text-left"
            >
              <img
                src={currentTrack.thumbnailUrl}
                alt={currentTrack.title}
                className="h-12 w-12 shrink-0 rounded-[10px] object-cover shadow-md transition-transform group-hover:scale-105"
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
              className={`inline-flex shrink-0 items-center justify-center rounded-full p-2 ${
                isLiked ? 'text-[#F43F5E]' : 'text-[#8E8E98] hover:text-white'
              }`}
            >
              <Heart className={`h-4 w-4 ${isLiked ? 'fill-current' : ''}`} />
            </button>
          </div>

          {/* Center: Shuffle + Transport + Repeat & Scrubber */}
          <div className="flex w-full max-w-2xl flex-col items-center justify-self-center">
            <div className="flex items-center justify-center gap-5">
              <button
                type="button"
                aria-label={
                  shuffleEnabled
                    ? 'Desactivar reproducción aleatoria'
                    : 'Activar reproducción aleatoria'
                }
                aria-pressed={shuffleEnabled}
                onClick={() => toggleShuffle()}
                className={`relative inline-flex h-8 w-8 items-center justify-center rounded-full hover:bg-white/[0.08] ${
                  shuffleEnabled ? 'text-white' : 'text-[#8E8E98] hover:text-white'
                }`}
              >
                <Shuffle className="h-4 w-4" />
                {shuffleEnabled && (
                  <span
                    aria-hidden="true"
                    className="absolute bottom-0.5 h-1 w-1 rounded-full bg-white"
                  />
                )}
              </button>

              <button
                type="button"
                aria-label="Anterior"
                onClick={() => void prevTrack()}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[#B4B4BE] hover:bg-white/[0.08] hover:text-white"
              >
                <SkipBack className="h-4 w-4" />
              </button>

              <button
                type="button"
                aria-label={isPlaying ? 'Pausar' : 'Reproducir'}
                onClick={() => void togglePlayPause()}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-[#070709] shadow-[0_6px_20px_rgba(255,255,255,0.20)] hover:scale-105"
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
                className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[#B4B4BE] hover:bg-white/[0.08] hover:text-white"
              >
                <SkipForward className="h-4 w-4" />
              </button>

              <button
                type="button"
                aria-label={repeatLabel}
                aria-pressed={repeatMode !== 'off'}
                onClick={() => cycleRepeatMode()}
                className={`relative inline-flex h-8 w-8 items-center justify-center rounded-full hover:bg-white/[0.08] ${
                  repeatMode !== 'off' ? 'text-white' : 'text-[#8E8E98] hover:text-white'
                }`}
              >
                {repeatMode === 'one' ? (
                  <Repeat1 className="h-4 w-4" />
                ) : (
                  <Repeat className="h-4 w-4" />
                )}
                {repeatMode !== 'off' && (
                  <span
                    aria-hidden="true"
                    className="absolute bottom-0.5 h-1 w-1 rounded-full bg-white"
                  />
                )}
              </button>
            </div>

            <div className="mt-2 flex w-full items-center gap-3">
              <span className="tabular-nums w-9 text-right text-[11px] font-medium text-[#8E8E98]">
                {formatDurationSec(positionSec)}
              </span>
              <div className="relative flex flex-1 items-center">
                {cueStartPct !== null && cueWidthPct > 0 && (
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-[#C084FC]/60"
                    style={{
                      left: `${cueStartPct}%`,
                      width: `${cueWidthPct}%`,
                    }}
                  />
                )}
                <input
                  type="range"
                  role="slider"
                  aria-label="Posición de reproducción"
                  min={0}
                  max={Math.max(1, Math.round(durationSec))}
                  value={Math.min(Math.round(durationSec), Math.round(positionSec))}
                  onChange={(e) => seekTo(Number(e.target.value))}
                  style={{ '--pm-fill': `${progressPct}%` } as React.CSSProperties}
                  className="pm-range-subtle relative z-10 w-full"
                />
              </div>
              <span className="tabular-nums w-9 text-[11px] font-medium text-[#8E8E98]">
                {formatDurationSec(durationSec)}
              </span>
            </div>
          </div>

          {/* Right: DJ, Lyrics, EQ, Devices, Volume */}
          <div className="flex items-center justify-end gap-1.5">
            <button
              type="button"
              aria-label="Modo Sesión DJ"
              aria-pressed={djMode.enabled}
              onClick={() => {
                setNowPlayingOpen(true);
                setNowPlayingTab('Cola');
              }}
              className={`inline-flex items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold ${
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
              className="inline-flex items-center justify-center rounded-full p-2 text-[#B4B4BE] hover:bg-white/[0.08] hover:text-white"
            >
              <Mic2 className="h-4 w-4" />
            </button>

            <button
              type="button"
              aria-label="Ecualizador"
              onClick={() => setEqSheetOpen(true)}
              className="inline-flex items-center justify-center rounded-full p-2 text-[#B4B4BE] hover:bg-white/[0.08] hover:text-white"
            >
              <Sliders className="h-4 w-4" />
            </button>

            <button
              type="button"
              aria-label="Dispositivos"
              onClick={() => setDevicesSheetOpen(true)}
              className="inline-flex items-center justify-center rounded-full p-2 text-[#34D399] hover:bg-white/[0.08]"
            >
              <Wifi className="h-4 w-4" />
            </button>

            <button
              type="button"
              aria-label={volume === 0 ? 'Activar sonido' : 'Silenciar'}
              onClick={() => toggleMute()}
              className="inline-flex items-center justify-center rounded-full p-2 text-[#B4B4BE] hover:bg-white/[0.08] hover:text-white"
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

      {/* Overlays / Modals / Spotify Context Menu */}
      <NowPlayingSheet />
      <EqAndCrossfadeSheet />
      <DevicesConnectSheet />
      <ImportPlaylistModal />
      <SettingsModal />
      <TrackContextMenu />
      <AppToast />
    </div>
  );
};

export default App;
