import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Check,
  Compass,
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
  Timer,
  Volume2,
  VolumeX,
  Wifi,
} from 'lucide-react';
import { formatDurationSec } from '@pmusic/core';
import {
  getLivePlaybackPosition,
  usePMusicStore,
  type MainNavTab,
} from './store/usePMusicStore.ts';
import { isElectronDesktopRuntime } from './platform/web-bridge.ts';
import { PMusicLogo } from './components/PMusicLogo.tsx';
import { SpotlightSearchModal } from './components/SpotlightSearchModal.tsx';
import { AppToast, TrackContextMenu } from './components/TrackMenu.tsx';
import { ArtistLinks } from './components/ArtistLinks.tsx';
import { SettingsModal } from './components/SettingsModal.tsx';
import { TrackInfoModal } from './components/TrackInfoModal.tsx';
import { readTrackFromDropEvent } from './utils/track-dnd.ts';
import {
  DetailViewPanel,
  ExploreScreen,
  HomeScreen,
  LibraryScreen,
  SearchScreen,
} from './components/Screens.tsx';
import {
  DevicesConnectSheet,
  DjPopover,
  EqAndCrossfadeSheet,
  ImportPlaylistModal,
  NowPlayingSheet,
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
    isBuffering,
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
    djPopoverOpen,
    audioPanelTab,
    incomingTransitionTrack,
    devicesSheetOpen,
    importModalOpen,
    settingsOpen,
    spotlightOpen,
    playerBarStyle,
    reducedMotionPref,
    sleepTimerMode,
    sleepTimerRemainingSec,
    setActiveTab,
    setSidebarCollapsed,
    setRightPanelOpen,
    setNowPlayingOpen,
    setNowPlayingTab,
    setEqSheetOpen,
    setDjPopoverOpen,
    setDevicesSheetOpen,
    setImportModalOpen,
    setSettingsOpen,
    setSpotlightOpen,
    setLibraryCategory,
    openLocalPlaylistDetail,
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
  const [dockHoverPct, setDockHoverPct] = useState<number | null>(null);
  const [heartBurst, setHeartBurst] = useState(false);
  const [dockHeartBurstKey, setDockHeartBurstKey] = useState(0);
  const [dockTransportAnim, setDockTransportAnim] = useState<
    'prev' | 'next' | 'play' | 'shuffle' | 'repeat' | null
  >(null);
  const [smoothDockPosSec, setSmoothDockPosSec] = useState<number>(positionSec);
  const isElectronDesktop = isElectronDesktopRuntime();

  const swipeStartXRef = useRef<number | null>(null);
  const heartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dockBarRef = useRef<HTMLElement | null>(null);
  const ambientFillRef = useRef<HTMLDivElement | null>(null);
  const islandFillRef = useRef<HTMLDivElement | null>(null);
  const waveFillRef = useRef<HTMLDivElement | null>(null);
  const scrubDraggingRef = useRef(false);
  const dockAnimTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dockClockRef = useRef({
    posSec: positionSec,
    renderedPosSec: positionSec,
    trackId: currentTrack.id,
    atMs: typeof performance !== 'undefined' ? performance.now() : 0,
  });

  useEffect(() => {
    const now = typeof performance !== 'undefined' ? performance.now() : 0;
    const trackChanged = dockClockRef.current.trackId !== currentTrack.id;
    const seekJumped = Math.abs(positionSec - dockClockRef.current.renderedPosSec) > 0.85;
    const effDur = Math.max(1, durationSec);
    const clampedPos = Math.max(0, Math.min(effDur, positionSec));
    dockClockRef.current.posSec = clampedPos;
    dockClockRef.current.atMs = now;
    dockClockRef.current.trackId = currentTrack.id;
    if (trackChanged || seekJumped || !isPlaying) {
      dockClockRef.current.renderedPosSec = clampedPos;
      setSmoothDockPosSec(clampedPos);
      const pctStr = `${Math.max(0, Math.min(100, (clampedPos / effDur) * 100)).toFixed(4)}%`;
      if (ambientFillRef.current) ambientFillRef.current.style.width = pctStr;
      if (islandFillRef.current) islandFillRef.current.style.width = pctStr;
      if (waveFillRef.current) waveFillRef.current.style.width = pctStr;
    }
  }, [positionSec, currentTrack.id, isPlaying, durationSec]);

  useEffect(() => {
    if (!isPlaying || isMobileViewport || typeof requestAnimationFrame !== 'function') {
      return;
    }
    let rafId = 0;
    let lastStateSyncMs = typeof performance !== 'undefined' ? performance.now() : 0;
    let lastIntSec = Math.floor(dockClockRef.current.renderedPosSec);

    const step = (now: number) => {
      const live = getLivePlaybackPosition();
      const effDur = Math.max(1, live.durationSec || durationSec);
      const rawPos = Number.isFinite(live.positionSec)
        ? live.positionSec
        : dockClockRef.current.posSec;
      const rendered = Math.max(0, Math.min(effDur, rawPos));
      dockClockRef.current.renderedPosSec = rendered;

      const pctStr = `${Math.max(0, Math.min(100, (rendered / effDur) * 100)).toFixed(4)}%`;
      if (ambientFillRef.current) ambientFillRef.current.style.width = pctStr;
      if (islandFillRef.current) islandFillRef.current.style.width = pctStr;
      if (waveFillRef.current) waveFillRef.current.style.width = pctStr;

      const curIntSec = Math.floor(rendered);
      if (curIntSec !== lastIntSec || now - lastStateSyncMs >= 220) {
        lastIntSec = curIntSec;
        lastStateSyncMs = now;
        setSmoothDockPosSec(rendered);
      }
      rafId = requestAnimationFrame(step);
    };
    rafId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafId);
  }, [isPlaying, isMobileViewport, durationSec]);

  const triggerDockTransportAnim = (
    kind: 'prev' | 'next' | 'play' | 'shuffle' | 'repeat'
  ) => {
    setDockTransportAnim(null);
    if (dockAnimTimerRef.current) clearTimeout(dockAnimTimerRef.current);
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => {
        setDockTransportAnim(kind);
        dockAnimTimerRef.current = setTimeout(() => setDockTransportAnim(null), 520);
      });
    } else {
      setDockTransportAnim(kind);
      dockAnimTimerRef.current = setTimeout(() => setDockTransportAnim(null), 520);
    }
  };

  const triggerHeartBurst = () => {
    setHeartBurst(false);
    if (heartTimerRef.current) clearTimeout(heartTimerRef.current);
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => {
        setHeartBurst(true);
        if (!reducedMotionPref) setDockHeartBurstKey((k) => k + 1);
        heartTimerRef.current = setTimeout(() => setHeartBurst(false), 520);
      });
    } else {
      setHeartBurst(true);
      if (!reducedMotionPref) setDockHeartBurstKey((k) => k + 1);
      heartTimerRef.current = setTimeout(() => setHeartBurst(false), 520);
    }
  };

  useEffect(() => {
    void initApp();
  }, [initApp]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const win = window as Window & { __pmusicHandleAndroidBack?: () => boolean };
    win.__pmusicHandleAndroidBack = () => {
      const st = usePMusicStore.getState();
      if (st.trackMenu) {
        st.closeTrackMenu();
        return true;
      }
      if (st.trackInfoModalTrack) {
        st.setTrackInfoModalTrack(null);
        return true;
      }
      if (st.djPopoverOpen) {
        st.setDjPopoverOpen(false);
        return true;
      }
      if (st.eqSheetOpen) {
        st.setEqSheetOpen(false);
        return true;
      }
      if (st.spotlightOpen) {
        st.setSpotlightOpen(false);
        return true;
      }
      if (st.settingsOpen) {
        st.setSettingsOpen(false);
        return true;
      }
      if (st.devicesSheetOpen) {
        st.setDevicesSheetOpen(false);
        return true;
      }
      if (st.importModalOpen) {
        st.setImportModalOpen(false);
        return true;
      }
      if (st.nowPlayingOpen) {
        st.setNowPlayingOpen(false);
        return true;
      }
      if (st.activeDetailView) {
        st.closeDetailView();
        return true;
      }
      if (st.activeTab !== 'Inicio') {
        st.setActiveTab('Inicio');
        return true;
      }
      return false;
    };
    return () => {
      delete win.__pmusicHandleAndroidBack;
    };
  }, []);

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

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSpotlightOpen(!spotlightOpen);
        return;
      }

      if (e.key === 'Escape') {
        if (spotlightOpen) setSpotlightOpen(false);
        else if (djPopoverOpen) setDjPopoverOpen(false);
        else if (eqSheetOpen) setEqSheetOpen(false);
        else if (nowPlayingOpen) setNowPlayingOpen(false);
        else if (devicesSheetOpen) setDevicesSheetOpen(false);
        else if (importModalOpen) setImportModalOpen(false);
        else if (settingsOpen) setSettingsOpen(false);
        return;
      }

      if (isTextInput) return;

      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        triggerDockTransportAnim('play');
        void togglePlayPause();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        if (e.shiftKey) {
          seekTo(Math.min(durationSec, positionSec + 5));
        } else {
          triggerDockTransportAnim('next');
          void nextTrack();
        }
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (e.shiftKey) {
          seekTo(Math.max(0, positionSec - 5));
        } else {
          triggerDockTransportAnim('prev');
          void prevTrack();
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setVolume(Math.min(1, Number((volume + 0.03).toFixed(2))));
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setVolume(Math.max(0, Number((volume - 0.03).toFixed(2))));
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
        triggerDockTransportAnim('shuffle');
        toggleShuffle();
      } else if (e.key.toLowerCase() === 'r') {
        e.preventDefault();
        triggerDockTransportAnim('repeat');
        cycleRepeatMode();
      } else if (e.key === '/') {
        e.preventDefault();
        setSpotlightOpen(true);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    spotlightOpen,
    nowPlayingOpen,
    eqSheetOpen,
    djPopoverOpen,
    audioPanelTab,
    incomingTransitionTrack,
    devicesSheetOpen,
    importModalOpen,
    settingsOpen,
    durationSec,
    positionSec,
    volume,
    setSpotlightOpen,
    setNowPlayingOpen,
    setNowPlayingTab,
    setEqSheetOpen,
    setDjPopoverOpen,
    setDevicesSheetOpen,
    setImportModalOpen,
    setSettingsOpen,
    togglePlayPause,
    toggleShuffle,
    cycleRepeatMode,
    seekTo,
    nextTrack,
    prevTrack,
    setVolume,
    toggleMute,
    toggleDjMode,
    setActiveTab,
  ]);

  const isLiked = likedTracks.some((l) => l.trackId === currentTrack.id);
  const dlStatus = offlineDownloads[currentTrack.id] ?? 'idle';
  const liveDockPosSec = isMobileViewport ? positionSec : smoothDockPosSec;
  const progressPct = Math.max(
    0,
    Math.min(100, (liveDockPosSec / Math.max(1, durationSec)) * 100)
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
  const unplayedDockCueStartPct =
    cueStartPct !== null ? Math.max(cueStartPct, progressPct) : null;
  const unplayedDockCueWidthPct =
    cueStartPct !== null && unplayedDockCueStartPct !== null
      ? Math.max(0, cueStartPct + cueWidthPct - unplayedDockCueStartPct)
      : 0;
  const djCueCountdownSec =
    djMode.enabled && activeTransitionPlan
      ? Math.max(0, Math.round(activeTransitionPlan.cueOutSec - liveDockPosSec))
      : null;
  const currentBpm = trackAnalyses[currentTrack.id]?.bpm;
  const repeatLabel =
    repeatMode === 'one'
      ? 'Repetir esta canción (activar siguiente: desactivar)'
      : repeatMode === 'all'
        ? 'Repetir cola o playlist (siguiente: repetir una)'
        : 'Activar repetición de playlist';

  const viewTransitionKey = activeDetailView
    ? activeDetailView.kind === 'artist'
      ? `artist:${activeDetailView.data.artist.id}`
      : activeDetailView.kind === 'album'
        ? `album:${activeDetailView.data.album.id}`
        : activeDetailView.kind === 'playlist'
          ? `playlist:${activeDetailView.data.playlist.id}`
          : `local:${activeDetailView.playlistId}`
    : `tab:${activeTab}`;

  const navTabs: Array<{ id: MainNavTab; label: string; icon: React.ReactNode }> = [
    { id: 'Inicio', label: 'Inicio', icon: <Home className="h-[18px] w-[18px]" /> },
    { id: 'Explorar', label: 'Explorar', icon: <Compass className="h-[18px] w-[18px]" /> },
    { id: 'Buscar', label: 'Buscar', icon: <Search className="h-[18px] w-[18px]" /> },
    { id: 'Biblioteca', label: 'Biblioteca', icon: <Library className="h-[18px] w-[18px]" /> },
  ];
  const dockHoverSec =
    dockHoverPct !== null ? (dockHoverPct / 100) * Math.max(1, durationSec) : null;

  const seekFromClientX = (clientX: number) => {
    const el = dockBarRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)));
    const nextSec = Math.round(pct * Math.max(1, durationSec));
    dockClockRef.current = {
      posSec: nextSec,
      renderedPosSec: nextSec,
      trackId: currentTrack.id,
      atMs: typeof performance !== 'undefined' ? performance.now() : 0,
    };
    const pctStr = `${(pct * 100).toFixed(4)}%`;
    if (ambientFillRef.current) ambientFillRef.current.style.width = pctStr;
    if (islandFillRef.current) islandFillRef.current.style.width = pctStr;
    if (waveFillRef.current) waveFillRef.current.style.width = pctStr;
    setSmoothDockPosSec(nextSec);
    seekTo(nextSec);
  };

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
      className={`pm-canvas relative flex w-full flex-col ${
        isMobileViewport ? 'min-h-dvh' : 'h-dvh overflow-hidden'
      }`}
    >
      {/* Unified Desktop Header & Integrated Frameless Windows Drag Bar (borderless unified canvas) */}
      {!isMobileViewport && (
        <header className="pm-drag-region pm-canvas relative z-30 flex h-12 w-full shrink-0 items-center justify-between gap-3 px-3">
          <div className="pm-no-drag relative z-10 flex items-center gap-2">
            <button
              type="button"
              aria-label="Ir al inicio"
              onClick={() => setActiveTab('Inicio')}
              className="pm-no-drag pm-hover pointer-events-auto relative z-20 flex items-center rounded-[10px] px-1.5 py-1"
            >
              <PMusicLogo size={28} showWordmark />
            </button>

            {activeDetailView && (
              <button
                type="button"
                aria-label="Volver"
                data-testid="back-detail-btn"
                onClick={() => closeDetailView()}
                className="pm-no-drag pm-btn-secondary pm-pressable pointer-events-auto relative z-20 inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-semibold"
              >
                <ArrowLeft className="pointer-events-none h-3.5 w-3.5" />
                <span className="pointer-events-none">Volver</span>
              </button>
            )}
          </div>

          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <button
              type="button"
              data-testid="top-center-search-btn"
              onClick={() => setSpotlightOpen(true)}
              className="pm-no-drag pm-input pm-text-tertiary pointer-events-auto flex w-60 items-center justify-between gap-2 rounded-full px-3.5 py-1.5 text-xs transition-colors hover:border-[var(--pm-border-strong)] hover:text-[var(--pm-text-primary)] md:w-72 lg:w-96"
            >
              <span className="flex items-center gap-2">
                <Search className="h-3.5 w-3.5 pm-text-secondary" />
                <span>Buscar canciones, artistas o álbumes…</span>
              </span>
              <kbd className="pm-elevated rounded border pm-border px-1.5 py-0.5 text-[11px] font-semibold pm-text-secondary">
                Ctrl K
              </kbd>
            </button>
          </div>

          <div
            className={`pm-no-drag relative z-10 flex items-center gap-1.5 ${
              isElectronDesktop ? 'mr-[138px]' : ''
            }`}
          >
            {sleepTimerMode !== 'off' && (
              <button
                type="button"
                aria-label="Temporizador de apagado activo"
                onClick={() => setSettingsOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/15 px-3 py-1 text-xs font-semibold text-amber-500"
              >
                <Timer className="h-3.5 w-3.5" />
                <span className="tabular-nums">
                  {sleepTimerMode === 'end_of_track'
                    ? 'Fin de pista'
                    : formatDurationSec(sleepTimerRemainingSec)}
                </span>
              </button>
            )}
          </div>
        </header>
      )}

      <div
        className={`relative z-10 flex min-h-0 flex-1 ${
          !isMobileViewport
            ? playerBarStyle === 'floating-island'
              ? 'gap-3 px-3 pt-3 pb-3'
              : playerBarStyle === 'classic-center'
                ? 'gap-3 px-3 pt-3 pb-[104px]'
                : 'gap-3 px-3 pt-3 pb-[98px]'
            : ''
        }`}
      >
        {/* Desktop Floating Collapsible Liquid Glass Sidebar (>= 768px) */}
        {!isMobileViewport && (
          <aside
            aria-label="Navegación principal"
            data-testid="desktop-sidebar"
            style={{ width: sidebarCollapsed ? 68 : 244 }}
            className={`pm-glass-regular z-30 flex h-full shrink-0 flex-col justify-between rounded-[20px] transition-[width] duration-200 ${
              sidebarCollapsed ? 'items-center px-2 py-3' : 'p-3'
            }`}
          >
            <div className="flex w-full min-h-0 flex-1 flex-col gap-3 overflow-y-auto pm-no-scrollbar">
              {/* Unified Sidebar Panel Toggle Header */}
              <div
                className={`flex items-center ${
                  sidebarCollapsed ? 'justify-center' : 'justify-between px-2'
                }`}
              >
                {!sidebarCollapsed && (
                  <span className="text-[11px] font-semibold tracking-wider pm-text-tertiary">
                    EXPLORAR
                  </span>
                )}
                <button
                  type="button"
                  title={sidebarCollapsed ? 'Expandir barra lateral' : 'Colapsar barra lateral'}
                  aria-label={sidebarCollapsed ? 'Expandir barra lateral' : 'Colapsar barra lateral'}
                  onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
                  className="pm-hover inline-flex h-7 w-7 items-center justify-center rounded-lg pm-text-tertiary hover:text-[var(--pm-text-primary)]"
                >
                  {sidebarCollapsed ? (
                    <PanelLeftOpen className="h-4 w-4" />
                  ) : (
                    <PanelLeftClose className="h-4 w-4" />
                  )}
                </button>
              </div>

              {/* Primary Navigation */}
              <nav
                role="tablist"
                aria-label="Secciones principales"
                className={`flex flex-col ${sidebarCollapsed ? 'items-center gap-1.5' : 'gap-1'}`}
              >
                {navTabs.map((item) => {
                  const active =
                    item.id === 'Buscar'
                      ? spotlightOpen || (activeTab === 'Buscar' && !activeDetailView)
                      : !spotlightOpen && activeTab === item.id && !activeDetailView;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      role="tab"
                      title={item.label}
                      aria-selected={active}
                      aria-label={item.label}
                      onClick={() => {
                        if (item.id === 'Buscar') {
                          setSpotlightOpen(true);
                        } else {
                          setActiveTab(item.id);
                        }
                      }}
                      className={
                        sidebarCollapsed
                          ? `pm-pressable mx-auto flex h-11 w-11 items-center justify-center rounded-[14px] transition-all ${
                              active
                                ? 'pm-btn-primary shadow-sm'
                                : 'pm-text-secondary pm-hover hover:text-[var(--pm-text-primary)]'
                            }`
                          : `pm-pressable flex w-full items-center gap-3 rounded-[10px] px-3 py-2 text-[13.5px] font-semibold transition-colors ${
                              active
                                ? 'pm-btn-primary'
                                : 'pm-text-secondary pm-hover hover:text-[var(--pm-text-primary)]'
                            }`
                      }
                    >
                      {item.icon}
                      {!sidebarCollapsed && <span>{item.label}</span>}
                    </button>
                  );
                })}
              </nav>

              {/* Compact Collapsed Shortcut Icons + Drop Targets */}
              {sidebarCollapsed && (
                <div className="flex w-full flex-col items-center gap-2 border-t pm-border pt-3">
                  <button
                    type="button"
                    title="Canciones que te gustan"
                    aria-label="Canciones que te gustan"
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
                    className={`mx-auto flex h-10 w-10 items-center justify-center rounded-[11px] bg-rose-500/15 text-rose-500 transition-all hover:scale-105 ${
                      sidebarDropTargetId === 'liked' ? 'ring-2 ring-[var(--pm-accent-primary)]' : ''
                    }`}
                  >
                    <Heart className="h-4 w-4 fill-current" />
                  </button>

                  <button
                    type="button"
                    title="En este dispositivo"
                    aria-label="En este dispositivo"
                    onClick={() => {
                      setActiveTab('Biblioteca');
                      setLibraryCategory('Descargas');
                    }}
                    className="mx-auto flex h-10 w-10 items-center justify-center rounded-[11px] bg-emerald-500/15 text-emerald-500 transition-all hover:scale-105"
                  >
                    <Download className="h-4 w-4" />
                  </button>

                  {playlists.slice(0, 5).map((pl) => {
                    const thumb = pl.coverUrl ?? pl.tracks[0]?.thumbnailUrl;
                    const isDropActive = sidebarDropTargetId === pl.id;
                    return (
                      <button
                        key={pl.id}
                        type="button"
                        title={pl.name}
                        aria-label={`Playlist ${pl.name}`}
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
                        className={`mx-auto flex h-10 w-10 items-center justify-center overflow-hidden rounded-[11px] transition-all hover:scale-105 ${
                          isDropActive ? 'ring-2 ring-[var(--pm-accent-primary)]' : ''
                        }`}
                      >
                        {thumb ? (
                          <img
                            src={thumb}
                            alt=""
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <span className="pm-elevated flex h-full w-full items-center justify-center text-xs font-bold pm-text-secondary">
                            {pl.name.slice(0, 1).toUpperCase()}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Solid Collection Shortcuts (Zero gradients, Drag & Drop Playlist Targets) */}
              {!sidebarCollapsed && (
                <div className="space-y-1.5 border-t pm-border pt-3">
                  <div className="flex items-center justify-between px-2">
                    <span className="text-[11px] font-semibold tracking-wider pm-text-tertiary">
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
                        className="pm-hover rounded-md p-1 pm-text-tertiary hover:text-[var(--pm-text-primary)]"
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        aria-label="Importar playlist"
                        onClick={() => setImportModalOpen(true)}
                        className="pm-hover rounded-md p-1 pm-text-tertiary hover:text-[var(--pm-text-primary)]"
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
                        ? 'pm-active-row ring-2 ring-[var(--pm-accent-primary)]'
                        : 'pm-hover'
                    }`}
                  >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-rose-500/15 text-rose-500">
                      <Heart className="h-4 w-4 fill-current" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-medium pm-text-primary">
                        Canciones que te gustan
                      </div>
                      <div className="text-[11px] pm-text-tertiary">
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
                    className="pm-hover flex w-full items-center gap-3 rounded-[10px] px-2 py-2 text-left"
                  >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-emerald-500/15 text-emerald-500">
                      <Download className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-medium pm-text-primary">
                        En este dispositivo
                      </div>
                      <div className="text-[11px] pm-text-tertiary">
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
                            ? 'pm-active-row ring-2 ring-[var(--pm-accent-primary)]'
                            : 'pm-hover'
                        }`}
                      >
                        {thumb ? (
                          <img
                            src={thumb}
                            alt=""
                            className="h-8 w-8 shrink-0 rounded-[7px] object-cover"
                          />
                        ) : (
                          <div className="pm-elevated flex h-8 w-8 shrink-0 items-center justify-center rounded-[7px] text-xs font-bold pm-text-secondary">
                            {pl.name.slice(0, 1).toUpperCase()}
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[13px] pm-text-primary">
                            {pl.name}
                          </div>
                          <div className="truncate text-[11px] pm-text-tertiary">
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
            <div
              className={`flex w-full flex-col border-t pm-border pt-2.5 ${
                sidebarCollapsed ? 'items-center gap-1' : 'space-y-1'
              }`}
            >
              <button
                type="button"
                title="Importar playlist"
                aria-label="Importar playlist"
                onClick={() => setImportModalOpen(true)}
                className={
                  sidebarCollapsed
                    ? 'pm-hover mx-auto flex h-10 w-10 items-center justify-center rounded-[12px] pm-text-secondary hover:text-[var(--pm-text-primary)]'
                    : 'pm-hover flex w-full items-center gap-3 rounded-[10px] px-3 py-2 text-xs font-medium pm-text-secondary hover:text-[var(--pm-text-primary)]'
                }
              >
                <ListMusic className="h-4 w-4 shrink-0" />
                {!sidebarCollapsed && <span>Importar playlist</span>}
              </button>

              <button
                type="button"
                title="Dispositivos"
                aria-label="Dispositivos"
                onClick={() => setDevicesSheetOpen(true)}
                className={
                  sidebarCollapsed
                    ? 'pm-hover mx-auto flex h-10 w-10 items-center justify-center rounded-[12px] text-emerald-500'
                    : 'pm-hover flex w-full items-center gap-3 rounded-[10px] px-3 py-2 text-xs font-medium pm-text-secondary hover:text-[var(--pm-text-primary)]'
                }
              >
                <Wifi className="h-4 w-4 shrink-0 text-emerald-500" />
                {!sidebarCollapsed && <span>Dispositivos</span>}
              </button>

              <button
                type="button"
                title="Ajustes"
                aria-label="Ajustes"
                onClick={() => setSettingsOpen(true)}
                className={
                  sidebarCollapsed
                    ? 'pm-hover mx-auto flex h-10 w-10 items-center justify-center rounded-[12px] pm-text-secondary hover:text-[var(--pm-text-primary)]'
                    : 'pm-hover flex w-full items-center gap-3 rounded-[10px] px-3 py-2 text-xs font-medium pm-text-secondary hover:text-[var(--pm-text-primary)]'
                }
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
              ? 'min-w-0 flex-1 overflow-y-auto px-4 pb-48 pt-0'
              : `h-full min-w-0 flex-1 overflow-y-auto px-7 pt-3 ${
                  playerBarStyle === 'floating-island' ? 'pb-28' : 'pb-8'
                }`
          }
        >
          {/* Mobile Top Command Bar (Liquid Glass, clean wordmark + Devices & Settings only) */}
          {isMobileViewport && (
            <div className="pm-mobile-glass-header sticky top-0 z-20 -mx-4 mb-4 flex items-center justify-between gap-3 px-4 pt-[max(0.8rem,var(--pm-safe-top,env(safe-area-inset-top)))] pb-3">
              <div className="flex items-center gap-2.5">
                {activeDetailView ? (
                  <button
                    type="button"
                    aria-label="Volver"
                    onClick={() => closeDetailView()}
                    className="pm-glass-chip inline-flex h-10 items-center gap-1.5 rounded-full px-3.5 text-xs font-semibold pm-text-primary"
                  >
                    <ArrowLeft className="h-4 w-4" />
                    <span>Volver</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    aria-label="Ir al inicio"
                    onClick={() => setActiveTab('Inicio')}
                    className="pm-pressable py-0.5 text-left"
                  >
                    <PMusicLogo size={28} variant="wordmark-only" />
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  data-testid="mobile-devices-btn"
                  aria-label="Dispositivos"
                  onClick={() => setDevicesSheetOpen(true)}
                  className="pm-glass-chip pm-pressable inline-flex h-9 w-9 items-center justify-center rounded-full text-emerald-400"
                >
                  <Wifi className="h-4 w-4" />
                </button>

                <button
                  type="button"
                  data-testid="mobile-settings-btn"
                  aria-label="Ajustes"
                  onClick={() => setSettingsOpen(true)}
                  className="pm-glass-chip pm-pressable inline-flex h-9 w-9 items-center justify-center rounded-full pm-text-secondary"
                >
                  <Settings className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

          <div key={viewTransitionKey} className="pm-view-transition">
            {activeDetailView ? (
              <DetailViewPanel />
            ) : (
              <>
                {activeTab === 'Inicio' && <HomeScreen />}
                {activeTab === 'Explorar' && <ExploreScreen />}
                {activeTab === 'Buscar' && <SearchScreen />}
                {activeTab === 'Biblioteca' && <LibraryScreen />}
              </>
            )}
          </div>
        </main>

        {/* Desktop Collapsible Right "En Reproducción" Panel (>= 1280px) */}
        {!isMobileViewport && rightPanelOpen && (
          <aside
            aria-label="En reproducción y siguiente"
            className={`pm-glass-surface hidden h-full w-[304px] shrink-0 flex-col gap-5 overflow-y-auto rounded-[20px] p-4 pm-no-scrollbar xl:flex ${
              playerBarStyle === 'floating-island' ? 'pb-24' : ''
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold tracking-wide pm-text-secondary">
                EN REPRODUCCIÓN
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  aria-label="Expandir reproductor"
                  onClick={() => setNowPlayingOpen(true)}
                  className="pm-hover rounded-full p-1.5 pm-text-tertiary hover:text-[var(--pm-text-primary)]"
                >
                  <Maximize2 className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  aria-label="Ocultar panel derecho"
                  onClick={() => setRightPanelOpen(false)}
                  className="pm-hover rounded-full p-1.5 pm-text-tertiary hover:text-[var(--pm-text-primary)]"
                >
                  <PanelRightClose className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            {/* Song card with subtle localized cover halo ONLY for the active track artwork */}
            <div data-surface="content" className="space-y-3">
              <div className="pm-elevated relative overflow-hidden rounded-[14px] p-1">
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
                    className="block max-w-full truncate text-left text-[17px] font-bold pm-text-primary hover:underline"
                  >
                    {currentTrack.title}
                  </button>
                  <div className="truncate text-[13px] pm-text-secondary">
                    <ArtistLinks
                      artists={currentTrack.artists}
                      linkClassName="hover:underline hover:text-[var(--pm-text-primary)]"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-0.5">
                  <button
                    type="button"
                    aria-label={isLiked ? 'Quitar de Me gusta' : 'Añadir a Me gusta'}
                    onClick={() => void toggleLike(currentTrack)}
                    className={`rounded-full p-2 ${
                      isLiked
                        ? 'text-rose-500'
                        : 'pm-text-tertiary hover:text-[var(--pm-text-primary)]'
                    }`}
                  >
                    <Heart className={`h-4 w-4 ${isLiked ? 'fill-current' : ''}`} />
                  </button>
                  <button
                    type="button"
                    aria-label="Descargar canción offline"
                    onClick={() => void downloadTrackOffline(currentTrack)}
                    className="rounded-full p-2 pm-text-tertiary hover:text-[var(--pm-text-primary)]"
                  >
                    {dlStatus === 'downloading' ? (
                      <Loader2 className="h-4 w-4 animate-spin pm-text-primary" />
                    ) : dlStatus === 'downloaded' ? (
                      <Check className="h-4 w-4 text-emerald-500" />
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
                    className="rounded-full p-2 pm-text-tertiary hover:text-[var(--pm-text-primary)]"
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
                className="pm-btn-secondary pm-pressable flex w-full items-center justify-center gap-2 rounded-[10px] py-2 text-xs font-semibold"
              >
                <Mic2 className="h-3.5 w-3.5" />
                <span>Ver letras sincronizadas</span>
              </button>
            </div>

            {/* DJ Live Transition Preview Card */}
            {djMode.enabled && activeTransitionPlan && (
              <div className="pm-surface-card rounded-[12px] border border-purple-500/35 p-3 text-xs">
                <div className="flex items-center justify-between font-bold text-purple-500">
                  <span className="flex items-center gap-1.5">
                    <Sparkles className="h-3.5 w-3.5" />
                    <span>
                      {isTransitioning
                        ? 'Mezclando en vivo…'
                        : djCueCountdownSec !== null && djCueCountdownSec > 0
                          ? `Mezcla DJ en ${djCueCountdownSec}s`
                          : 'Mezcla lista'}
                    </span>
                  </span>
                  <span className="tabular-nums text-[11px] pm-text-secondary">
                    {currentBpm ?? 120} BPM
                  </span>
                </div>
                <div className="mt-1 text-[11px] pm-text-secondary">
                  {activeTransitionPlan.choreography?.summary ??
                    `${activeTransitionPlan.transitionBars} compases (${activeTransitionPlan.transitionDurationSec}s) · ${Math.round(activeTransitionPlan.compatibilityScore * 100)}% fit`}
                </div>
                {isTransitioning && (
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-purple-500/20">
                    <div
                      className="h-full rounded-full bg-purple-500 transition-[width] duration-100"
                      style={{ width: `${Math.round(transitionProgress01 * 100)}%` }}
                    />
                  </div>
                )}
              </div>
            )}

            {/* Next in Queue Preview */}
            <div className="space-y-2.5 border-t pm-border pt-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold pm-text-primary">
                  A continuación
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setNowPlayingOpen(true);
                    setNowPlayingTab('Cola');
                  }}
                  className="text-[11px] font-semibold pm-text-secondary hover:text-[var(--pm-text-primary)]"
                >
                  Abrir cola
                </button>
              </div>

              <div className="space-y-1">
                {upNextQueue.map((track) => (
                  <div
                    key={track.id}
                    className="pm-hover flex w-full items-center gap-2.5 rounded-[8px] p-1.5"
                  >
                    <button
                      type="button"
                      aria-label={`Reproducir ${track.title}`}
                      onClick={() => void playTrack(track, queue)}
                      className="h-10 w-10 shrink-0 overflow-hidden rounded-[6px]"
                    >
                      <img
                        src={track.thumbnailUrl}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    </button>
                    <div className="min-w-0 flex-1">
                      <button
                        type="button"
                        onClick={() => void playTrack(track, queue)}
                        className="block max-w-full truncate text-left text-[13px] font-medium pm-text-primary hover:underline"
                      >
                        {track.title}
                      </button>
                      <div className="truncate text-[11.5px] pm-text-tertiary">
                        <ArtistLinks
                          artists={track.artists}
                          linkClassName="hover:underline hover:text-[var(--pm-text-primary)]"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </aside>
        )}
      </div>

      {/* Desktop Customizable Floating Frosted/Liquid Glass Player Bar (>= 768px) */}
      {!isMobileViewport && (
        <footer
          ref={dockBarRef}
          aria-label="Reproductor de escritorio"
          data-testid="desktop-player-bar"
          data-dock-style={playerBarStyle}
          onPointerDown={(e) => {
            if (playerBarStyle === 'classic-center') return;
            const target = e.target as HTMLElement | null;
            if (
              target?.closest(
                'button, input, a, [role="link"], .pm-dock-interactive'
              )
            ) {
              return;
            }
            scrubDraggingRef.current = true;
            e.currentTarget.setPointerCapture?.(e.pointerId);
            seekFromClientX(e.clientX);
          }}
          onPointerMove={(e) => {
            if (playerBarStyle === 'classic-center') return;
            const rect = e.currentTarget.getBoundingClientRect();
            const pct = Math.max(
              0,
              Math.min(100, ((e.clientX - rect.left) / Math.max(1, rect.width)) * 100)
            );
            if (scrubDraggingRef.current) {
              seekFromClientX(e.clientX);
              setDockHoverPct(pct);
              return;
            }
            const target = e.target as HTMLElement | null;
            if (
              target?.closest(
                'button, input, a, [role="link"], .pm-dock-interactive'
              )
            ) {
              if (dockHoverPct !== null) setDockHoverPct(null);
              return;
            }
            setDockHoverPct(pct);
          }}
          onPointerUp={() => {
            scrubDraggingRef.current = false;
          }}
          onPointerCancel={() => {
            scrubDraggingRef.current = false;
          }}
          onMouseLeave={() => {
            scrubDraggingRef.current = false;
            setDockHoverPct(null);
          }}
          className={`pm-glass-regular fixed z-40 grid select-none items-center gap-4 overflow-hidden ${
            playerBarStyle === 'floating-island'
              ? 'left-1/2 bottom-3.5 h-[72px] w-[min(840px,calc(100%-32px))] -translate-x-1/2 cursor-pointer grid-cols-[minmax(160px,1fr)_auto_minmax(160px,1fr)] rounded-full px-5'
              : playerBarStyle === 'minimal-wave'
                ? 'inset-x-3 bottom-3 h-[76px] cursor-pointer grid-cols-[minmax(200px,1fr)_minmax(300px,520px)_minmax(200px,1fr)] rounded-[18px] px-5'
                : playerBarStyle === 'ambient-dock'
                  ? 'inset-x-3 bottom-3 h-[80px] cursor-pointer grid-cols-[minmax(200px,1fr)_minmax(320px,540px)_minmax(200px,1fr)] rounded-[20px] px-5'
                  : 'inset-x-3 bottom-3 h-[84px] grid-cols-[minmax(200px,1fr)_minmax(320px,540px)_minmax(200px,1fr)] rounded-[20px] px-5'
          }`}
        >
          {/* Flat Solid Sharp-Edged Ambient Progress Fill (Zero Gradient, Zero Vertical Playhead) */}
          {playerBarStyle === 'ambient-dock' && (
            <div
              ref={ambientFillRef}
              aria-hidden="true"
              data-testid="ambient-progress-fill"
              className="pointer-events-none absolute inset-y-0 left-0 z-0 transition-[background-color] duration-300"
              style={{
                width: `${progressPct}%`,
                backgroundColor:
                  'color-mix(in srgb, var(--pm-ambient-1) 36%, rgba(255, 255, 255, 0.08))',
              }}
            />
          )}

          {/* Dynamic Floating Island Bottom Curve Progress Hairline */}
          {playerBarStyle === 'floating-island' && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-7 bottom-0 z-10 h-[3px] overflow-hidden rounded-full bg-white/12"
            >
              <div
                ref={islandFillRef}
                className="h-full rounded-full"
                style={{
                  width: `${progressPct}%`,
                  background:
                    'linear-gradient(90deg, color-mix(in srgb, var(--pm-ambient-1) 80%, var(--pm-accent-primary)) 0%, var(--pm-accent-primary) 100%)',
                  boxShadow:
                    '0 0 12px color-mix(in srgb, var(--pm-ambient-1) 70%, transparent)',
                }}
              />
            </div>
          )}

          {/* Minimal Studio Top Edge Glowing Progress Line */}
          {playerBarStyle === 'minimal-wave' && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 top-0 z-10 h-[3px] bg-white/10"
            >
              <div
                ref={waveFillRef}
                className="h-full rounded-r-full"
                style={{
                  width: `${progressPct}%`,
                  background:
                    'linear-gradient(90deg, color-mix(in srgb, var(--pm-ambient-2) 70%, var(--pm-accent-primary)) 0%, color-mix(in srgb, var(--pm-ambient-1) 85%, white) 100%)',
                  boxShadow:
                    '0 0 16px color-mix(in srgb, var(--pm-ambient-1) 65%, transparent)',
                }}
              />
            </div>
          )}

          {/* Stealth Hover White Scrub Hairline + Accessible Slider for Click/Drag Dock Modes */}
          {playerBarStyle !== 'classic-center' && (
            <>
              {dockHoverPct !== null && (
                <div
                  aria-hidden="true"
                  data-testid="dock-hover-hairline"
                  className="pointer-events-none absolute inset-y-0 z-10 w-[1px] -translate-x-1/2 bg-white/35"
                  style={{ left: `${dockHoverPct}%` }}
                />
              )}
              {cueStartPct !== null && cueWidthPct > 0 && (
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute top-0 z-0 h-[2.5px] rounded-full bg-purple-500/85"
                  style={{
                    left: `${cueStartPct}%`,
                    width: `${cueWidthPct}%`,
                  }}
                />
              )}
              {dockHoverPct !== null && dockHoverSec !== null && (
                <span
                  aria-hidden="true"
                  style={{ left: `clamp(28px, ${dockHoverPct}%, calc(100% - 28px))` }}
                  className="tabular-nums pm-btn-primary pointer-events-none absolute top-1.5 z-20 -translate-x-1/2 rounded-full px-2 py-0.5 text-[11px] font-semibold shadow-sm"
                >
                  {formatDurationSec(dockHoverSec)}
                </span>
              )}
              <input
                type="range"
                role="slider"
                aria-label="Posición de reproducción"
                min={0}
                max={Math.max(1, Math.round(durationSec))}
                value={Math.min(Math.round(durationSec), Math.round(liveDockPosSec))}
                onChange={(e) => {
                  const next = Number(e.target.value);
                  setSmoothDockPosSec(next);
                  seekTo(next);
                }}
                className="sr-only"
              />
            </>
          )}

          {/* Left: Artwork + Title & Clickable ArtistLinks + Heart (+ Incoming DJ Dock Takeover) */}
          <div className="pointer-events-none relative z-10 flex min-w-0 items-center">
            {isTransitioning &&
              incomingTransitionTrack &&
              incomingTransitionTrack.id !== currentTrack.id && (
                <div className="pm-dock-takeover-in pm-glass-chip pointer-events-auto mr-3 flex max-w-[230px] items-center gap-2 rounded-[12px] px-2.5 py-1.5">
                  <img
                    src={incomingTransitionTrack.thumbnailUrl}
                    alt={incomingTransitionTrack.title}
                    className="h-8 w-8 shrink-0 rounded-[7px] object-cover"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-white/75">
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
                      <span>Entrando · {Math.round(transitionProgress01 * 100)}%</span>
                    </div>
                    <div className="truncate text-xs font-semibold pm-text-primary">
                      {incomingTransitionTrack.title}
                    </div>
                  </div>
                </div>
              )}
            <div className="pm-dock-interactive pointer-events-auto inline-flex min-w-0 max-w-full items-center gap-3">
              <button
                type="button"
                aria-label="Abrir reproductor a pantalla completa"
                onClick={() => setNowPlayingOpen(true)}
                className="group relative h-11 w-11 shrink-0 overflow-hidden rounded-[10px] shadow-md"
              >
                <img
                  src={currentTrack.thumbnailUrl}
                  alt={currentTrack.title}
                  className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
                />
                {playerBarStyle === 'minimal-wave' && isPlaying && (
                  <span
                    aria-hidden="true"
                    className="absolute right-1 bottom-1 flex h-4 items-end gap-[2px] rounded bg-black/65 px-1 py-0.5"
                  >
                    <span
                      className="pm-eq-bar w-[2px] rounded-full bg-white"
                      style={{ height: '70%', animationDelay: '0ms' }}
                    />
                    <span
                      className="pm-eq-bar w-[2px] rounded-full bg-white"
                      style={{ height: '100%', animationDelay: '160ms' }}
                    />
                    <span
                      className="pm-eq-bar w-[2px] rounded-full bg-white"
                      style={{ height: '55%', animationDelay: '320ms' }}
                    />
                  </span>
                )}
              </button>

              <div className="min-w-0 max-w-[200px] xl:max-w-[240px]">
                <button
                  type="button"
                  onClick={() => setNowPlayingOpen(true)}
                  className="block max-w-full truncate text-left text-[14px] font-semibold leading-tight pm-text-primary hover:underline"
                >
                  {currentTrack.title}
                </button>
                <div className="mt-0.5 flex items-center gap-1.5 truncate">
                  {currentTrack.isExplicit && (
                    <span
                      aria-label="Explícita"
                      className="inline-flex h-[14px] w-[14px] shrink-0 items-center justify-center rounded-[3px] bg-[var(--pm-text-secondary)]/20 text-[9px] font-extrabold leading-none pm-text-secondary"
                    >
                      E
                    </span>
                  )}
                  <div className="truncate text-[12px] pm-text-secondary">
                    <ArtistLinks
                      artists={currentTrack.artists}
                      linkClassName="hover:underline hover:text-[var(--pm-text-primary)]"
                    />
                  </div>
                </div>
              </div>

              <button
                type="button"
                aria-label={isLiked ? 'Quitar de Me gusta' : 'Añadir a Me gusta'}
                aria-pressed={isLiked}
                onClick={() => {
                  if (!isLiked) triggerHeartBurst();
                  void toggleLike(currentTrack);
                }}
                className={`pm-pressable pm-hover relative inline-flex shrink-0 items-center justify-center overflow-visible rounded-full p-2 ${
                  heartBurst && !reducedMotionPref ? 'pm-heart-burst-epic' : ''
                } ${
                  isLiked
                    ? 'text-rose-500'
                    : 'pm-text-secondary hover:text-[var(--pm-text-primary)]'
                }`}
              >
                <Heart className={`h-4 w-4 ${isLiked ? 'fill-current' : ''}`} />
                {isLiked &&
                  dockHeartBurstKey > 0 &&
                  !reducedMotionPref &&
                  [
                    { sx: '0px', sy: '-17px', c: '#FB7185' },
                    { sx: '15px', sy: '-9px', c: '#F9A8D4' },
                    { sx: '15px', sy: '9px', c: '#FDE047' },
                    { sx: '0px', sy: '17px', c: '#FB7185' },
                    { sx: '-15px', sy: '9px', c: '#F9A8D4' },
                    { sx: '-15px', sy: '-9px', c: '#FDE047' },
                  ].map((sp, spIdx) => (
                    <span
                      key={`dock-sp-${dockHeartBurstKey}-${spIdx}`}
                      aria-hidden="true"
                      className="pm-sparkle-dot pointer-events-none absolute left-1/2 top-1/2 h-1.5 w-1.5 rounded-full"
                      style={
                        {
                          backgroundColor: sp.c,
                          '--sx': sp.sx,
                          '--sy': sp.sy,
                        } as React.CSSProperties
                      }
                    />
                  ))}
              </button>
            </div>
          </div>

          {/* Center: Symmetrical Clean Transport [Shuffle · Prev · Play · Next · Repeat] + Centered Timeline/Time */}
          <div className="pointer-events-none relative z-10 flex w-full flex-col items-center justify-center gap-1 justify-self-center">
            <div className="pm-dock-interactive pointer-events-auto inline-flex items-center justify-center gap-2 sm:gap-3">
              <button
                type="button"
                aria-label={
                  shuffleEnabled
                    ? 'Desactivar reproducción aleatoria'
                    : 'Activar reproducción aleatoria'
                }
                aria-pressed={shuffleEnabled}
                onClick={() => {
                  triggerDockTransportAnim('shuffle');
                  toggleShuffle();
                }}
                className={`pm-pressable pm-hover relative inline-flex h-8 w-8 items-center justify-center rounded-full transition-colors ${
                  shuffleEnabled
                    ? 'pm-text-primary'
                    : 'pm-text-tertiary hover:text-[var(--pm-text-primary)]'
                }`}
              >
                <Shuffle
                  className={`h-3.5 w-3.5 ${
                    dockTransportAnim === 'shuffle' && !reducedMotionPref
                      ? 'pm-shuffle-flip-epic'
                      : ''
                  }`}
                />
                {shuffleEnabled && (
                  <span
                    aria-hidden="true"
                    className="absolute bottom-0.5 h-1 w-1 rounded-full"
                    style={{ backgroundColor: 'var(--pm-accent-primary)' }}
                  />
                )}
              </button>

              <button
                type="button"
                aria-label="Anterior"
                onClick={() => {
                  triggerDockTransportAnim('prev');
                  void prevTrack();
                }}
                className="pm-pressable pm-hover inline-flex h-9 w-9 items-center justify-center rounded-full pm-text-primary active:scale-90"
              >
                <SkipBack
                  className={`h-4 w-4 ${
                    dockTransportAnim === 'prev' && !reducedMotionPref ? 'pm-skip-glide-prev' : ''
                  }`}
                />
              </button>

              <button
                type="button"
                aria-label={isPlaying ? 'Pausar' : 'Reproducir'}
                onClick={() => {
                  triggerDockTransportAnim('play');
                  void togglePlayPause();
                }}
                className="pm-btn-primary pm-pressable relative flex h-10 w-10 items-center justify-center overflow-hidden rounded-full shadow-lg transition-transform duration-200 hover:scale-105 active:scale-90"
              >
                <Pause
                  className={`absolute h-4.5 w-4.5 fill-current transition-all duration-200 ease-out ${
                    isPlaying
                      ? 'scale-100 rotate-0 opacity-100 blur-0'
                      : 'scale-50 rotate-90 opacity-0 blur-[1px]'
                  }`}
                />
                <Play
                  className={`absolute h-4.5 w-4.5 translate-x-[1px] fill-current transition-all duration-200 ease-out ${
                    !isPlaying
                      ? 'scale-100 rotate-0 opacity-100 blur-0'
                      : 'scale-50 -rotate-90 opacity-0 blur-[1px]'
                  }`}
                />
              </button>

              <button
                type="button"
                aria-label="Siguiente"
                onClick={() => {
                  triggerDockTransportAnim('next');
                  void nextTrack();
                }}
                className="pm-pressable pm-hover inline-flex h-9 w-9 items-center justify-center rounded-full pm-text-primary active:scale-90"
              >
                <SkipForward
                  className={`h-4 w-4 ${
                    dockTransportAnim === 'next' && !reducedMotionPref ? 'pm-skip-glide-next' : ''
                  }`}
                />
              </button>

              <button
                type="button"
                aria-label={repeatLabel}
                aria-pressed={repeatMode !== 'off'}
                onClick={() => {
                  triggerDockTransportAnim('repeat');
                  cycleRepeatMode();
                }}
                className={`pm-pressable pm-hover relative inline-flex h-8 w-8 items-center justify-center rounded-full transition-colors ${
                  repeatMode !== 'off'
                    ? 'pm-text-primary'
                    : 'pm-text-tertiary hover:text-[var(--pm-text-primary)]'
                }`}
              >
                <span
                  className={`inline-flex ${
                    dockTransportAnim === 'repeat' && !reducedMotionPref
                      ? 'pm-repeat-spin-epic'
                      : ''
                  }`}
                >
                  {repeatMode === 'one' ? (
                    <Repeat1 className="h-3.5 w-3.5" />
                  ) : (
                    <Repeat className="h-3.5 w-3.5" />
                  )}
                </span>
                {repeatMode !== 'off' && (
                  <span
                    aria-hidden="true"
                    className="absolute bottom-0.5 h-1 w-1 rounded-full"
                    style={{ backgroundColor: 'var(--pm-accent-primary)' }}
                  />
                )}
              </button>
            </div>

            {playerBarStyle === 'classic-center' ? (
              <div className="pm-dock-interactive pointer-events-auto flex w-full max-w-[500px] items-center gap-2.5">
                <span className="tabular-nums w-9 shrink-0 select-none text-right text-[11px] font-medium pm-text-tertiary">
                  {formatDurationSec(liveDockPosSec)}
                </span>
                <div className="relative flex flex-1 items-center">
                  {unplayedDockCueStartPct !== null && unplayedDockCueWidthPct > 0 && (
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-purple-500/75"
                      style={{
                        left: `${unplayedDockCueStartPct}%`,
                        width: `${unplayedDockCueWidthPct}%`,
                      }}
                    />
                  )}
                  <input
                    type="range"
                    role="slider"
                    aria-label="Posición de reproducción"
                    min={0}
                    max={Math.max(1, Math.round(durationSec))}
                    value={Math.min(Math.round(durationSec), Math.round(liveDockPosSec))}
                    onChange={(e) => {
                      const next = Number(e.target.value);
                      setSmoothDockPosSec(next);
                      seekTo(next);
                    }}
                    style={
                      {
                        '--pm-fill': `${progressPct}%`,
                        '--pm-slider-active':
                          'color-mix(in srgb, var(--pm-ambient-1) 62%, var(--pm-accent-primary))',
                      } as React.CSSProperties
                    }
                    className="pm-range-subtle relative z-10 w-full cursor-pointer"
                  />
                </div>
                <span className="tabular-nums w-9 shrink-0 select-none text-left text-[11px] font-medium pm-text-tertiary">
                  {formatDurationSec(durationSec)}
                </span>
              </div>
            ) : (
              <div className="tabular-nums flex items-center justify-center gap-2 select-none text-[11px] font-medium pm-text-tertiary">
                <span>{formatDurationSec(liveDockPosSec)}</span>
                <span aria-hidden="true" className="opacity-50">
                  ·
                </span>
                <span>{formatDurationSec(durationSec)}</span>
              </div>
            )}
          </div>

          {/* Right: Unified Soft Matte Translucent Utility Capsule */}
          <div className="pointer-events-none relative z-10 flex items-center justify-end">
            <div className="pm-dock-interactive pm-dock-cluster pointer-events-auto flex items-center gap-1 rounded-full px-2 py-1">
              <button
                type="button"
                data-testid="dock-dj-btn"
                aria-label="Modo Sesión DJ"
                aria-pressed={djMode.enabled || djPopoverOpen}
                onClick={() => setDjPopoverOpen(!djPopoverOpen)}
                className={`pm-pressable inline-flex h-8 items-center justify-center gap-1.5 rounded-full px-2.5 text-[11px] font-bold transition-colors ${
                  djMode.enabled || djPopoverOpen
                    ? 'bg-white/[0.16] pm-text-primary'
                    : 'pm-text-secondary hover:bg-white/[0.10] hover:text-[var(--pm-text-primary)]'
                }`}
              >
                <Disc3
                  className={`h-3.5 w-3.5 ${
                    djMode.enabled ? 'text-purple-400' : 'pm-text-secondary'
                  }`}
                />
                <span className="hidden xl:inline">DJ</span>
              </button>

              <button
                type="button"
                data-testid="dock-eq-btn"
                aria-label="Ecualizador"
                aria-pressed={eqSheetOpen}
                onClick={() => setEqSheetOpen(!eqSheetOpen)}
                className={`pm-pressable inline-flex h-8 w-8 items-center justify-center rounded-full transition-colors ${
                  eqSheetOpen
                    ? 'bg-white/[0.16] text-[var(--pm-text-primary)]'
                    : 'pm-text-secondary hover:bg-white/[0.10] hover:text-[var(--pm-text-primary)]'
                }`}
              >
                <Sliders className="h-3.5 w-3.5" />
              </button>

              <button
                type="button"
                aria-label="Letras sincronizadas"
                onClick={() => {
                  setNowPlayingOpen(true);
                  setNowPlayingTab('Letras');
                }}
                className="pm-pressable inline-flex h-8 w-8 items-center justify-center rounded-full pm-text-secondary transition-colors hover:bg-white/[0.10] hover:text-[var(--pm-text-primary)]"
              >
                <Mic2 className="h-3.5 w-3.5" />
              </button>

              <button
                type="button"
                aria-label={volume === 0 ? 'Activar sonido' : 'Silenciar'}
                onClick={() => toggleMute()}
                className="pm-pressable inline-flex h-8 w-8 items-center justify-center rounded-full pm-text-secondary transition-colors hover:bg-white/[0.10] hover:text-[var(--pm-text-primary)]"
              >
                {volume === 0 ? (
                  <VolumeX className="h-3.5 w-3.5" />
                ) : (
                  <Volume2 className="h-3.5 w-3.5" />
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
                className="pm-range-subtle mx-1 hidden w-16 lg:block xl:w-20"
              />

              <span aria-hidden="true" className="mx-0.5 h-3.5 w-px bg-white/10" />

              <button
                type="button"
                aria-label="Expandir reproductor"
                onClick={() => setNowPlayingOpen(true)}
                className="pm-pressable inline-flex h-8 w-8 items-center justify-center rounded-full pm-text-secondary transition-colors hover:bg-white/[0.10] hover:text-[var(--pm-text-primary)]"
              >
                <Maximize2 className="h-3.5 w-3.5" />
              </button>

              <button
                type="button"
                aria-label={
                  rightPanelOpen ? 'Ocultar panel de cola' : 'Mostrar panel de cola'
                }
                onClick={() => setRightPanelOpen(!rightPanelOpen)}
                className="pm-pressable hidden h-8 w-8 items-center justify-center rounded-full pm-text-secondary transition-colors hover:bg-white/[0.10] hover:text-[var(--pm-text-primary)] xl:inline-flex"
              >
                {rightPanelOpen ? (
                  <PanelRightClose className="h-3.5 w-3.5" />
                ) : (
                  <PanelRightOpen className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
          </div>
        </footer>
      )}

      {/* Mobile Floating Mini-Player + Floating Tab Glass Capsule (< 768px) */}
      {isMobileViewport && (
        <>
          <div
            aria-hidden="true"
            className="pointer-events-none fixed inset-x-0 bottom-0 z-30 h-40 bg-gradient-to-t from-[#070709] via-[#070709]/85 to-transparent"
          />
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
            className="pm-glass-regular fixed inset-x-3 bottom-[calc(5.25rem+var(--pm-safe-bottom,env(safe-area-inset-bottom)))] z-40 overflow-hidden rounded-[18px] px-3 py-2"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 flex-1 items-center gap-2.5">
                <button
                  type="button"
                  aria-label="Abrir reproductor Reproduciendo ahora"
                  onClick={() => setNowPlayingOpen(true)}
                  className="h-11 w-11 shrink-0 overflow-hidden rounded-[8px] shadow-sm"
                >
                  <img
                    src={currentTrack.thumbnailUrl}
                    alt={currentTrack.title}
                    className="h-full w-full object-cover"
                  />
                </button>
                <div className="min-w-0 flex-1">
                  <button
                    type="button"
                    onClick={() => setNowPlayingOpen(true)}
                    className="block max-w-full truncate text-left text-[14px] font-semibold leading-snug pm-text-primary hover:underline"
                  >
                    {currentTrack.title}
                  </button>
                  <div className="truncate text-xs leading-normal pm-text-secondary">
                    <ArtistLinks
                      artists={currentTrack.artists}
                      linkClassName="hover:underline hover:text-[var(--pm-text-primary)]"
                    />
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-1">
                <button
                  type="button"
                  aria-label={isLiked ? 'Quitar de Me gusta' : 'Añadir a Me gusta'}
                  onClick={() => void toggleLike(currentTrack)}
                  className={`pm-pressable flex h-10 w-10 items-center justify-center rounded-full bg-white/[0.08] ${
                    isLiked ? 'text-rose-500' : 'pm-text-secondary'
                  }`}
                >
                  <Heart className={`h-4 w-4 ${isLiked ? 'fill-current' : ''}`} />
                </button>

                <button
                  type="button"
                  aria-label={isBuffering ? 'Cargando canción' : isPlaying ? 'Pausar' : 'Reproducir'}
                  onClick={() => void togglePlayPause()}
                  className="pm-btn-primary pm-pressable relative flex h-10 w-10 items-center justify-center overflow-hidden rounded-full shadow-md"
                >
                  {isBuffering ? (
                    <Loader2 className="h-4.5 w-4.5 animate-spin" />
                  ) : (
                    <>
                      <Pause
                        className={`absolute h-4.5 w-4.5 fill-current transition-all duration-200 ease-out ${
                          isPlaying
                            ? 'scale-100 rotate-0 opacity-100 blur-0'
                            : 'scale-50 rotate-90 opacity-0 blur-[1px]'
                        }`}
                      />
                      <Play
                        className={`absolute h-4.5 w-4.5 translate-x-[1px] fill-current transition-all duration-200 ease-out ${
                          !isPlaying
                            ? 'scale-100 rotate-0 opacity-100 blur-0'
                            : 'scale-50 -rotate-90 opacity-0 blur-[1px]'
                        }`}
                      />
                    </>
                  )}
                </button>

                <button
                  type="button"
                  aria-label="Siguiente canción"
                  onClick={() => void nextTrack()}
                  className="pm-pressable flex h-10 w-10 items-center justify-center rounded-full pm-text-primary"
                >
                  <SkipForward className="h-4.5 w-4.5" />
                </button>
              </div>
            </div>

            {/* Subtle solid hairline progress track along bottom of mini-player */}
            <div className="mt-1.5 h-[2px] w-full overflow-hidden rounded-full bg-[var(--pm-slider-track)]">
              <div
                className={`h-full rounded-full transition-[width] duration-200 ${
                  isBuffering ? 'pm-buffer-shimmer w-full' : ''
                }`}
                style={{
                  width: isBuffering ? '100%' : `${progressPct}%`,
                  backgroundColor: isBuffering ? undefined : 'var(--pm-slider-active)',
                }}
              />
            </div>
          </div>

          <nav
            role="tablist"
            aria-label="Navegación móvil"
            data-testid="mobile-tab-bar"
            className="pm-glass-regular fixed inset-x-3 bottom-[max(0.75rem,var(--pm-safe-bottom,env(safe-area-inset-bottom)))] z-40 grid grid-cols-4 gap-1 rounded-[22px] p-1.5"
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
                  className={`pm-pressable flex flex-col items-center justify-center rounded-[16px] py-1.5 text-xs font-bold transition-all duration-200 ${
                    active
                      ? 'pm-btn-primary scale-[1.03] shadow-sm'
                      : 'pm-text-secondary hover:text-[var(--pm-text-primary)]'
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

      {/* Overlays / Modals / Spotlight, Dock Popovers & Context Menu */}
      <SpotlightSearchModal />
      <NowPlayingSheet />
      <EqAndCrossfadeSheet />
      <DjPopover />
      <DevicesConnectSheet />
      <ImportPlaylistModal />
      <SettingsModal />
      <TrackInfoModal />
      <TrackContextMenu />
      <AppToast />
    </div>
  );
};

export default App;
