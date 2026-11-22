import React, { useEffect, useRef, useState } from 'react';
import {
  Compass,
  Disc3,
  Heart,
  Home,
  Library,
  ListMusic,
  Mic2,
  Pause,
  Play,
  PanelLeftClose,
  PanelLeftOpen,
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
    activeDetailView,
    currentTrack,
    isPlaying,
    positionSec,
    durationSec,
    volume,
    djMode,
    likedTracks,
    nowPlayingOpen,
    eqSheetOpen,
    devicesSheetOpen,
    importModalOpen,
    settingsOpen,
    setActiveTab,
    setSidebarCollapsed,
    setNowPlayingOpen,
    setNowPlayingTab,
    setEqSheetOpen,
    setDevicesSheetOpen,
    setImportModalOpen,
    setSettingsOpen,
    togglePlayPause,
    nextTrack,
    prevTrack,
    seekTo,
    setVolume,
    toggleMute,
    toggleLike,
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

  const navTabs: Array<{ id: MainNavTab; label: string; icon: React.ReactNode }> = [
    { id: 'Inicio', label: 'Inicio', icon: <Home className="h-5 w-5" /> },
    { id: 'Buscar', label: 'Buscar', icon: <Search className="h-5 w-5" /> },
    { id: 'Biblioteca', label: 'Biblioteca', icon: <Library className="h-5 w-5" /> },
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
    <div className="relative flex min-h-dvh w-full flex-col bg-[#06060A] text-[#F5F5F7]">
      <div className="flex flex-1">
        {/* Desktop Collapsible Liquid Glass Sidebar (>= 768px only) */}
        {!isMobileViewport && (
          <aside
            aria-label="Navegación principal"
            data-testid="desktop-sidebar"
            style={{ width: sidebarCollapsed ? 72 : 248 }}
            className="pm-glass-regular sticky top-0 z-30 flex h-[calc(100dvh-80px)] shrink-0 flex-col justify-between p-3 transition-[width] duration-200"
          >
            <div className="space-y-6">
              {/* Brand Header & Collapse Button */}
              <div className="flex items-center justify-between px-2 pt-1">
                {!sidebarCollapsed && (
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-[#0A84FF] to-[#BF5AF2] font-bold text-white">
                      p
                    </div>
                    <span className="text-lg font-bold tracking-tight text-[#F5F5F7]">
                      pMusic
                    </span>
                  </div>
                )}
                <button
                  type="button"
                  aria-label={
                    sidebarCollapsed
                      ? 'Expandir barra lateral'
                      : 'Colapsar barra lateral'
                  }
                  onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
                  className="flex items-center justify-center rounded-xl bg-[#16161D] p-2 text-[#AEAEB2] hover:text-white"
                >
                  {sidebarCollapsed ? (
                    <PanelLeftOpen className="h-4 w-4" />
                  ) : (
                    <PanelLeftClose className="h-4 w-4" />
                  )}
                </button>
              </div>

              {/* Primary Navigation Tabs */}
              <nav role="tablist" aria-label="Secciones principales" className="space-y-1.5">
                {navTabs.map((item) => {
                  const active = activeTab === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      aria-label={item.label}
                      onClick={() => setActiveTab(item.id)}
                      className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors ${
                        active
                          ? 'bg-[#0A84FF] text-white'
                          : 'text-[#AEAEB2] hover:bg-[#16161D] hover:text-[#F5F5F7]'
                      }`}
                    >
                      {item.icon}
                      {!sidebarCollapsed && <span>{item.label}</span>}
                    </button>
                  );
                })}
              </nav>
            </div>

            {/* Bottom Utility Controls in Sidebar */}
            <div className="space-y-1.5 border-t border-white/10 pt-3">
              <button
                type="button"
                aria-label="Importar playlist"
                onClick={() => setImportModalOpen(true)}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-xs font-semibold text-[#AEAEB2] hover:bg-[#16161D] hover:text-white"
              >
                <ListMusic className="h-4 w-4 text-[#0A84FF]" />
                {!sidebarCollapsed && <span>Importar playlist</span>}
              </button>

              <button
                type="button"
                aria-label="Dispositivos"
                onClick={() => setDevicesSheetOpen(true)}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-xs font-semibold text-[#AEAEB2] hover:bg-[#16161D] hover:text-white"
              >
                <Wifi className="h-4 w-4 text-[#30D158]" />
                {!sidebarCollapsed && <span>Dispositivos</span>}
              </button>

              <button
                type="button"
                aria-label="Ajustes"
                onClick={() => setSettingsOpen(true)}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-xs font-semibold text-[#AEAEB2] hover:bg-[#16161D] hover:text-white"
              >
                <Settings className="h-4 w-4 text-[#AEAEB2]" />
                {!sidebarCollapsed && <span>Ajustes</span>}
              </button>
            </div>
          </aside>
        )}

        {/* Main Scrollable Content Region */}
        <main
          data-surface="content"
          className="flex-1 overflow-y-auto px-4 pb-40 pt-5 md:px-7 md:pb-28"
        >
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
      </div>

      {/* Desktop Fixed 80px Liquid Glass Player Bar (>= 768px only) */}
      {!isMobileViewport && (
        <footer
          aria-label="Reproductor de escritorio"
          data-testid="desktop-player-bar"
          className="pm-glass-regular fixed inset-x-0 bottom-0 z-40 flex h-20 items-center justify-between gap-6 px-6"
        >
          {/* Left: Artwork, Track Info & Expand Trigger */}
          <div className="flex min-w-0 flex-1 items-center gap-3.5">
            <button
              type="button"
              aria-label="Abrir reproductor a pantalla completa"
              onClick={() => setNowPlayingOpen(true)}
              className="flex min-w-0 items-center gap-3 text-left"
            >
              <img
                src={currentTrack.thumbnailUrl}
                alt={currentTrack.title}
                className="h-13 w-13 rounded-[10px] object-cover"
              />
              <div className="min-w-0">
                <div className="truncate text-sm font-bold text-[#F5F5F7]">
                  {currentTrack.title}
                </div>
                <div className="truncate text-xs text-[#AEAEB2]">
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
                isLiked ? 'text-[#FF375F]' : 'text-[#AEAEB2] hover:text-white'
              }`}
            >
              <Heart className={`h-4 w-4 ${isLiked ? 'fill-current' : ''}`} />
            </button>
          </div>

          {/* Center: Transport & Timeline Scrubber */}
          <div className="flex max-w-xl flex-1 flex-col items-center gap-1.5">
            <div className="flex items-center gap-4">
              <button
                type="button"
                aria-label="Anterior"
                onClick={() => void prevTrack()}
                className="rounded-full p-2 text-[#F5F5F7] hover:bg-white/10"
              >
                <SkipBack className="h-4 w-4" />
              </button>

              <button
                type="button"
                aria-label={isPlaying ? 'Pausar' : 'Reproducir'}
                onClick={() => void togglePlayPause()}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-[#0A84FF] text-white hover:bg-[#0A84FF]/90"
              >
                {isPlaying ? (
                  <Pause className="h-5 w-5" />
                ) : (
                  <Play className="h-5 w-5" />
                )}
              </button>

              <button
                type="button"
                aria-label="Siguiente"
                onClick={() => void nextTrack()}
                className="rounded-full p-2 text-[#F5F5F7] hover:bg-white/10"
              >
                <SkipForward className="h-4 w-4" />
              </button>
            </div>

            <div className="flex w-full items-center gap-2.5">
              <span className="tabular-nums text-[11px] font-medium text-[#AEAEB2]">
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
                className="flex-1 accent-[#0A84FF]"
              />
              <span className="tabular-nums text-[11px] font-medium text-[#AEAEB2]">
                {formatDurationSec(durationSec)}
              </span>
            </div>
          </div>

          {/* Right: DJ Toggle, Lyrics, EQ, Devices & Volume */}
          <div className="flex flex-1 items-center justify-end gap-2">
            <button
              type="button"
              aria-label="Modo Sesión DJ"
              aria-pressed={djMode.enabled}
              onClick={() => {
                setNowPlayingOpen(true);
                setNowPlayingTab('Cola');
              }}
              className={`flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-bold ${
                djMode.enabled
                  ? 'bg-[#BF5AF2] text-white'
                  : 'bg-[#16161D] text-[#AEAEB2] hover:text-white'
              }`}
            >
              <Disc3 className="h-3.5 w-3.5" />
              <span>DJ</span>
            </button>

            <button
              type="button"
              aria-label="Letras sincronizadas"
              onClick={() => {
                setNowPlayingOpen(true);
                setNowPlayingTab('Letras');
              }}
              className="rounded-full bg-[#16161D] p-2 text-[#AEAEB2] hover:text-white"
            >
              <Mic2 className="h-4 w-4" />
            </button>

            <button
              type="button"
              aria-label="Ecualizador"
              onClick={() => setEqSheetOpen(true)}
              className="rounded-full bg-[#16161D] p-2 text-[#AEAEB2] hover:text-white"
            >
              <Sliders className="h-4 w-4" />
            </button>

            <button
              type="button"
              aria-label="Dispositivos"
              onClick={() => setDevicesSheetOpen(true)}
              className="rounded-full bg-[#16161D] p-2 text-[#30D158] hover:text-white"
            >
              <Wifi className="h-4 w-4" />
            </button>

            <button
              type="button"
              aria-label={volume === 0 ? 'Activar sonido' : 'Silenciar'}
              onClick={() => toggleMute()}
              className="rounded-full p-2 text-[#AEAEB2] hover:text-white"
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
              value={Math.round(volume * 100)}
              onChange={(e) => setVolume(Number(e.target.value) / 100)}
              className="w-20 accent-[#0A84FF]"
            />
          </div>
        </footer>
      )}

      {/* Mobile Floating Mini-Player + Floating 3-Tab Glass Capsule (< 768px only) */}
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
            className="pm-glass-regular fixed inset-x-3 bottom-22 z-40 flex items-center justify-between gap-2 rounded-[20px] px-3 py-2"
          >
            <button
              type="button"
              aria-label="Abrir reproductor Reproduciendo ahora"
              onClick={() => setNowPlayingOpen(true)}
              className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
            >
              <img
                src={currentTrack.thumbnailUrl}
                alt={currentTrack.title}
                className="h-11 w-11 rounded-[10px] object-cover"
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-bold text-[#F5F5F7]">
                  {currentTrack.title}
                </div>
                <div className="truncate text-xs text-[#AEAEB2]">
                  {currentTrack.artists.map((a) => a.name).join(', ')}
                </div>
              </div>
            </button>

            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-label={isPlaying ? 'Pausar' : 'Reproducir'}
                onClick={() => void togglePlayPause()}
                className="flex h-12 w-12 items-center justify-center rounded-full bg-[#0A84FF] text-white"
              >
                {isPlaying ? (
                  <Pause className="h-5 w-5" />
                ) : (
                  <Play className="h-5 w-5" />
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

          <nav
            role="tablist"
            aria-label="Navegación móvil"
            data-testid="mobile-tab-bar"
            className="pm-glass-regular fixed inset-x-3 bottom-3 z-40 grid grid-cols-3 gap-1 rounded-full p-1.5"
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
                  className={`flex flex-col items-center justify-center rounded-full py-1.5 text-xs font-bold transition-colors ${
                    active
                      ? 'bg-[#0A84FF] text-white'
                      : 'text-[#AEAEB2] hover:text-white'
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
