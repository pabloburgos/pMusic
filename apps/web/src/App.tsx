import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Check,
  Compass,
  Disc3,
  Download,
  GripVertical,
  Heart,
  Home,
  Library,
  ListMusic,
  ListStart,
  Loader2,
  Maximize,
  Maximize2,
  Mic2,
  Minimize,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Repeat,
  Repeat1,
  Search,
  Settings,
  Sliders,
  Sparkles,
  Timer,
  Users,
  Volume2,
  VolumeX,
  Wifi,
  X,
} from 'lucide-react';
import {
  AnimatedShuffleIcon,
  AnimatedSkipBackIcon,
  AnimatedSkipForwardIcon,
  RoundedPauseIcon,
  RoundedPlayIcon,
} from './components/TransportIcons.tsx';
import { formatDurationSec, type Track } from '@pmusic/core';
import {
  getLivePlaybackPosition,
  usePMusicStore,
  type MainNavTab,
} from './store/usePMusicStore.ts';
import {
  getRealFullscreen,
  isElectronDesktopRuntime,
  onRealFullscreenChange,
  toggleRealFullscreen,
} from './platform/web-bridge.ts';
import { PMusicLogo } from './components/PMusicLogo.tsx';
import { useDelayedBuffering } from './hooks/useDelayedBuffering.ts';
import { SpotlightSearchModal } from './components/SpotlightSearchModal.tsx';
import { AppToast, TrackContextMenu } from './components/TrackMenu.tsx';
import { ArtistLinks } from './components/ArtistLinks.tsx';
import { SettingsModal } from './components/SettingsModal.tsx';
import { TrackInfoModal } from './components/TrackInfoModal.tsx';
import { AuthOnboardingModal } from './components/AuthOnboardingModal.tsx';
import { WrappedStoriesModal } from './components/WrappedStoriesModal.tsx';
import { SocialScreen } from './components/SocialScreen.tsx';
import { PublicJamGuestPage } from './components/PublicJamGuestPage.tsx';
import {
  clearDraggedTrack,
  readTrackFromDropEvent,
  setDraggedTrack,
} from './utils/track-dnd.ts';
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
  const publicJamCode =
    typeof window !== 'undefined'
      ? window.location.pathname.match(/^\/jam\/([A-Za-z0-9]{4,12})\/?$/)?.[1] ?? null
      : null;

  if (publicJamCode) {
    return <PublicJamGuestPage code={publicJamCode} />;
  }

  return <PMusicMainApp />;
};

const PMusicMainApp: React.FC = () => {
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
    transitionDurationSec,
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
    outgoingTransitionTrack,
    incomingTransitionTrack,
    devicesSheetOpen,
    remoteControlledDeviceId,
    remoteDeviceSnapshot,
    onlineDevices,
    importModalOpen,
    settingsOpen,
    spotlightOpen,
    playerBarStyle,
    reducedMotionPref,
    sleepTimerMode,
    sleepTimerRemainingSec,
    authState,
    userProfile,
    setAuthOnboardingOpen,
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
    moveQueueItem,
    removeQueueItem,
    addToQueue,
    playNextInQueue,
    searchTracksForPlaylist,
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
  const [dockHeartPhase, setDockHeartPhase] = useState<'idle' | 'fading-in'>('idle');
  const [sidebarDragFromIdx, setSidebarDragFromIdx] = useState<number | null>(null);
  const [sidebarDragOverIdx, setSidebarDragOverIdx] = useState<number | null>(null);
  const [sidebarSearchQuery, setSidebarSearchQuery] = useState('');
  const [sidebarSearchResults, setSidebarSearchResults] = useState<Track[]>([]);
  const [sidebarSearchLoading, setSidebarSearchLoading] = useState(false);
  const [sidebarAddedIds, setSidebarAddedIds] = useState<Record<string, boolean>>({});
  const [dockTransportAnim, setDockTransportAnim] = useState<
    'prev' | 'next' | 'play' | 'shuffle' | 'repeat' | null
  >(null);
  const [smoothDockPosSec, setSmoothDockPosSec] = useState<number>(positionSec);
  const [dockDisplayDurSec, setDockDisplayDurSec] = useState<number>(durationSec);
  const [islandMenuOpen, setIslandMenuOpen] = useState(false);
  const [isDockReceding, setIsDockReceding] = useState(false);
  const [isRealFullscreen, setIsRealFullscreen] = useState(false);
  const [dockColorWave, setDockColorWave] = useState<{ key: string; prevColor: string } | null>(
    null
  );
  const isElectronDesktop = isElectronDesktopRuntime();
  const showBuffering = useDelayedBuffering(isBuffering, 500);

  useEffect(() => {
    let active = true;
    void getRealFullscreen().then((fs) => {
      if (active) setIsRealFullscreen(fs);
    });
    const unsub = onRealFullscreenChange((fs) => {
      setIsRealFullscreen(fs);
    });
    return () => {
      active = false;
      unsub();
    };
  }, []);

  const swipeStartXRef = useRef<number | null>(null);
  const heartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dockBarRef = useRef<HTMLElement | null>(null);
  const ambientFillRef = useRef<HTMLDivElement | null>(null);
  const islandFillRef = useRef<HTMLDivElement | null>(null);
  const waveFillRef = useRef<HTMLDivElement | null>(null);
  const classicFillRef = useRef<HTMLDivElement | null>(null);
  const classicRangeRef = useRef<HTMLInputElement | null>(null);
  const dockSrRangeRef = useRef<HTMLInputElement | null>(null);
  const dockTimeRef = useRef<HTMLSpanElement | null>(null);
  const dockDurRef = useRef<HTMLSpanElement | null>(null);
  const classicTimeRef = useRef<HTMLSpanElement | null>(null);
  const classicDurRef = useRef<HTMLSpanElement | null>(null);
  const islandMenuRef = useRef<HTMLDivElement | null>(null);
  const scrubDraggingRef = useRef(false);
  const manualSeekAtMsRef = useRef<number>(0);
  const dockDisplayDurSecRef = useRef<number>(durationSec);
  const lastRenderedPctRef = useRef<number>(0);
  const dockRecedeRef = useRef<{ fromPct: number; startMs: number; durationMs: number } | null>(
    null
  );
  const dockColorWaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dockRecedePrevTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastDockCrossfadeIdRef = useRef<string | null>(null);
  const dockHeartPhaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dockAnimTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dockClockRef = useRef({
    posSec: positionSec,
    renderedPosSec: positionSec,
    trackId: currentTrack.id,
    atMs: typeof performance !== 'undefined' ? performance.now() : 0,
  });
  const dockExtrapRef = useRef({
    lastRawPos: positionSec,
    lastWallMs: typeof performance !== 'undefined' ? performance.now() : 0,
    smoothedPos: positionSec,
    trackId: currentTrack.id,
  });

  const applyDockFillTransform = (pct: number) => {
    const tx = `translate3d(${(Math.max(0, Math.min(100, pct)) - 100).toFixed(4)}%, 0, 0)`;
    if (ambientFillRef.current) ambientFillRef.current.style.transform = tx;
    if (islandFillRef.current) islandFillRef.current.style.transform = tx;
    if (waveFillRef.current) waveFillRef.current.style.transform = tx;
    if (classicFillRef.current) classicFillRef.current.style.transform = tx;
  };

  useEffect(() => {
    if (playerBarStyle !== 'floating-island') {
      setIslandMenuOpen(false);
    }
  }, [playerBarStyle]);

  useEffect(() => {
    if (!islandMenuOpen || typeof document === 'undefined') return;
    const handlePointerDown = (e: PointerEvent) => {
      if (islandMenuRef.current && !islandMenuRef.current.contains(e.target as Node)) {
        setIslandMenuOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIslandMenuOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKey);
    };
  }, [islandMenuOpen]);

  useEffect(() => {
    return () => {
      if (dockColorWaveTimerRef.current) clearTimeout(dockColorWaveTimerRef.current);
      if (dockRecedePrevTimerRef.current) clearTimeout(dockRecedePrevTimerRef.current);
      if (dockHeartPhaseTimerRef.current) clearTimeout(dockHeartPhaseTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const cfNow = Boolean(
      isTransitioning &&
        outgoingTransitionTrack &&
        incomingTransitionTrack &&
        outgoingTransitionTrack.id !== incomingTransitionTrack.id
    );
    if (cfNow && incomingTransitionTrack) {
      lastDockCrossfadeIdRef.current = incomingTransitionTrack.id;
      if (dockHeartPhaseTimerRef.current) clearTimeout(dockHeartPhaseTimerRef.current);
      setDockHeartPhase('idle');
      return;
    }
    if (lastDockCrossfadeIdRef.current === currentTrack.id && !reducedMotionPref) {
      lastDockCrossfadeIdRef.current = null;
      setDockHeartPhase('fading-in');
      if (dockHeartPhaseTimerRef.current) clearTimeout(dockHeartPhaseTimerRef.current);
      dockHeartPhaseTimerRef.current = setTimeout(() => {
        setDockHeartPhase('idle');
      }, 820);
    } else if (lastDockCrossfadeIdRef.current && lastDockCrossfadeIdRef.current !== currentTrack.id) {
      lastDockCrossfadeIdRef.current = null;
    }
  }, [isTransitioning, outgoingTransitionTrack, incomingTransitionTrack, currentTrack.id, reducedMotionPref]);

  useEffect(() => {
    const q = sidebarSearchQuery.trim();
    if (!q) {
      setSidebarSearchResults([]);
      setSidebarSearchLoading(false);
      return;
    }
    let cancelled = false;
    setSidebarSearchLoading(true);
    const timer = setTimeout(() => {
      void searchTracksForPlaylist(q)
        .then((tracks) => {
          if (!cancelled) {
            setSidebarSearchResults(tracks.slice(0, 5));
            setSidebarSearchLoading(false);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setSidebarSearchResults([]);
            setSidebarSearchLoading(false);
          }
        });
    }, 220);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [sidebarSearchQuery, searchTracksForPlaylist]);

  useEffect(() => {
    const now = typeof performance !== 'undefined' ? performance.now() : 0;
    const trackChanged = dockClockRef.current.trackId !== currentTrack.id;
    const curLive = getLivePlaybackPosition();
    if (isPlaying && !isMobileViewport && curLive.isTransitioning && !trackChanged) {
      return;
    }
    const seekJumped = Math.abs(positionSec - dockClockRef.current.renderedPosSec) > 0.85;
    const usingIncoming = Boolean(
      curLive.isTransitioning &&
        curLive.transitionProgress01 >= 0.5 &&
        typeof curLive.incomingPositionSec === 'number' &&
        typeof curLive.incomingDurationSec === 'number' &&
        curLive.incomingDurationSec > 0
    );
    const effDur = usingIncoming
      ? curLive.incomingDurationSec!
      : Math.max(1, durationSec);
    if (Math.abs(dockDisplayDurSecRef.current - effDur) > 0.5) {
      dockDisplayDurSecRef.current = effDur;
      setDockDisplayDurSec(effDur);
    }
    const basePos = usingIncoming ? curLive.incomingPositionSec! : positionSec;
    const clampedPos = Math.max(0, Math.min(effDur, basePos));
    const targetPct = Math.max(0, Math.min(100, (clampedPos / effDur) * 100));

    dockClockRef.current.posSec = clampedPos;
    dockClockRef.current.atMs = now;
    dockClockRef.current.trackId = currentTrack.id;

    if (trackChanged) {
      dockExtrapRef.current = {
        lastRawPos: clampedPos,
        lastWallMs: now,
        smoothedPos: clampedPos,
        trackId: currentTrack.id,
      };
      if (typeof document !== 'undefined' && !reducedMotionPref) {
        const prevColor = getComputedStyle(document.documentElement)
          .getPropertyValue('--pm-ambient-1')
          .trim();
        if (prevColor) {
          if (dockColorWaveTimerRef.current) clearTimeout(dockColorWaveTimerRef.current);
          setDockColorWave({ key: `cw-${currentTrack.id}-${Math.round(now)}`, prevColor });
          dockColorWaveTimerRef.current = setTimeout(() => {
            setDockColorWave(null);
          }, 1680);
        }
      }

      if (dockRecedeRef.current) {
        dockClockRef.current.renderedPosSec = clampedPos;
        setSmoothDockPosSec(clampedPos);
        return;
      }

      if (
        !reducedMotionPref &&
        !scrubDraggingRef.current &&
        now - manualSeekAtMsRef.current > 350 &&
        lastRenderedPctRef.current - targetPct > 8
      ) {
        dockRecedeRef.current = {
          fromPct: lastRenderedPctRef.current,
          startMs: now,
          durationMs: 1150,
        };
        setIsDockReceding(true);
        dockClockRef.current.renderedPosSec = clampedPos;
        setSmoothDockPosSec(clampedPos);
        return;
      }

      dockRecedeRef.current = null;
      setIsDockReceding(false);
      dockClockRef.current.renderedPosSec = clampedPos;
      setSmoothDockPosSec(clampedPos);
      lastRenderedPctRef.current = targetPct;
      applyDockFillTransform(targetPct);
    } else if (seekJumped || !isPlaying) {
      dockExtrapRef.current = {
        lastRawPos: clampedPos,
        lastWallMs: now,
        smoothedPos: clampedPos,
        trackId: currentTrack.id,
      };
      dockClockRef.current.renderedPosSec = clampedPos;
      setSmoothDockPosSec(clampedPos);
      if (!dockRecedeRef.current) {
        lastRenderedPctRef.current = targetPct;
        applyDockFillTransform(targetPct);
      }
    }
  }, [positionSec, currentTrack.id, isPlaying, isMobileViewport, durationSec, reducedMotionPref]);

  useEffect(() => {
    if ((!isPlaying && !isDockReceding) || isMobileViewport || typeof requestAnimationFrame !== 'function') {
      return;
    }
    let rafId = 0;
    let lastFrameMs = typeof performance !== 'undefined' ? performance.now() : 0;

    const step = (now: number) => {
      const dtSec = Math.min(0.05, Math.max(0.001, (now - lastFrameMs) / 1000));
      lastFrameMs = now;

      const live = getLivePlaybackPosition();
      const useIncoming = Boolean(
        live.isTransitioning &&
          live.transitionProgress01 >= 0.5 &&
          typeof live.incomingPositionSec === 'number' &&
          typeof live.incomingDurationSec === 'number' &&
          live.incomingDurationSec > 0
      );
      const effDur = useIncoming
        ? live.incomingDurationSec!
        : Math.max(1, live.durationSec || durationSec);
      const rawPos = useIncoming
        ? live.incomingPositionSec!
        : Number.isFinite(live.positionSec)
          ? live.positionSec
          : dockClockRef.current.posSec;

      const storeSt = usePMusicStore.getState();
      const activeId = storeSt.currentTrack.id;
      const rate = storeSt.playbackRate || 1.0;
      const dEx = dockExtrapRef.current;

      let extrapolatedPos: number;
      if (!isPlaying) {
        extrapolatedPos = rawPos;
        dEx.lastRawPos = rawPos;
        dEx.lastWallMs = now;
        dEx.smoothedPos = rawPos;
        dEx.trackId = activeId;
      } else if (dEx.trackId !== activeId || Math.abs(rawPos - dEx.smoothedPos) > 0.55) {
        dEx.trackId = activeId;
        dEx.lastRawPos = rawPos;
        dEx.lastWallMs = now;
        dEx.smoothedPos = rawPos;
        extrapolatedPos = rawPos;
      } else {
        if (Math.abs(rawPos - dEx.lastRawPos) > 0.0005) {
          dEx.lastRawPos = rawPos;
          dEx.lastWallMs = now;
        }
        const candidate =
          rawPos + Math.min(0.22, Math.max(0, (now - dEx.lastWallMs) / 1000)) * rate;
        if (candidate >= dEx.smoothedPos) {
          dEx.smoothedPos = candidate;
        }
        extrapolatedPos = dEx.smoothedPos;
      }

      const rendered = Math.max(0, Math.min(effDur, extrapolatedPos));
      dockClockRef.current.renderedPosSec = rendered;

      if (Math.abs(dockDisplayDurSecRef.current - effDur) > 0.5) {
        dockDisplayDurSecRef.current = effDur;
        setDockDisplayDurSec(effDur);
      }

      const liveTargetPct = Math.max(0, Math.min(100, (rendered / effDur) * 100));
      if (
        !reducedMotionPref &&
        !scrubDraggingRef.current &&
        now - manualSeekAtMsRef.current > 350 &&
        !dockRecedeRef.current &&
        lastRenderedPctRef.current - liveTargetPct > 8
      ) {
        dockRecedeRef.current = {
          fromPct: lastRenderedPctRef.current,
          startMs: now,
          durationMs: 1150,
        };
        setIsDockReceding(true);
      }

      let visualPct = liveTargetPct;
      if (dockRecedeRef.current) {
        const elapsed = now - dockRecedeRef.current.startMs;
        const t = Math.max(0, Math.min(1, elapsed / dockRecedeRef.current.durationMs));
        const ease = 1 - Math.pow(1 - t, 3.2);
        visualPct =
          dockRecedeRef.current.fromPct +
          (liveTargetPct - dockRecedeRef.current.fromPct) * ease;
        if (t >= 1) {
          dockRecedeRef.current = null;
          visualPct = liveTargetPct;
          setIsDockReceding(false);
        }
      } else if (!scrubDraggingRef.current) {
        const prevPct = lastRenderedPctRef.current;
        if (Math.abs(liveTargetPct - prevPct) > 4 || Math.abs(liveTargetPct - prevPct) < 0.002) {
          visualPct = liveTargetPct;
        } else {
          visualPct = prevPct + (liveTargetPct - prevPct) * (1 - Math.exp(-dtSec * 22));
        }
      }

      lastRenderedPctRef.current = visualPct;
      applyDockFillTransform(visualPct);

      const posLabel = formatDurationSec(rendered);
      const durLabel = formatDurationSec(effDur);
      if (dockTimeRef.current && dockTimeRef.current.textContent !== posLabel) {
        dockTimeRef.current.textContent = posLabel;
      }
      if (classicTimeRef.current && classicTimeRef.current.textContent !== posLabel) {
        classicTimeRef.current.textContent = posLabel;
      }
      if (dockDurRef.current && dockDurRef.current.textContent !== durLabel) {
        dockDurRef.current.textContent = durLabel;
      }
      if (classicDurRef.current && classicDurRef.current.textContent !== durLabel) {
        classicDurRef.current.textContent = durLabel;
      }

      const rangeVal = String(Number(Math.min(effDur, Math.round(rendered * 10) / 10).toFixed(1)));
      const rangeMax = String(Math.max(1, Math.round(effDur)));
      if (classicRangeRef.current) {
        if (classicRangeRef.current.max !== rangeMax) classicRangeRef.current.max = rangeMax;
        classicRangeRef.current.value = rangeVal;
      }
      if (dockSrRangeRef.current) {
        if (dockSrRangeRef.current.max !== rangeMax) dockSrRangeRef.current.max = rangeMax;
        dockSrRangeRef.current.value = rangeVal;
      }

      if (isPlaying || dockRecedeRef.current) {
        rafId = requestAnimationFrame(step);
      }
    };
    rafId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafId);
  }, [isPlaying, isDockReceding, isMobileViewport, durationSec, reducedMotionPref]);

  const triggerDockTransportAnim = (
    kind: 'prev' | 'next' | 'play' | 'shuffle' | 'repeat'
  ) => {
    setDockTransportAnim(null);
    if (dockAnimTimerRef.current) clearTimeout(dockAnimTimerRef.current);
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => {
        setDockTransportAnim(kind);
        dockAnimTimerRef.current = setTimeout(() => setDockTransportAnim(null), 660);
      });
    } else {
      setDockTransportAnim(kind);
      dockAnimTimerRef.current = setTimeout(() => setDockTransportAnim(null), 660);
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

      if (e.key === 'F11') {
        e.preventDefault();
        void toggleRealFullscreen().then(setIsRealFullscreen);
        return;
      }

      if (e.key === 'Escape') {
        if (isRealFullscreen) {
          void toggleRealFullscreen().then(setIsRealFullscreen);
          return;
        }
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
    outgoingTransitionTrack,
    incomingTransitionTrack,
    devicesSheetOpen,
    remoteControlledDeviceId,
    remoteDeviceSnapshot,
    onlineDevices,
    importModalOpen,
    settingsOpen,
    isRealFullscreen,
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
  const activeDockDurSec = Math.max(1, dockDisplayDurSec || durationSec);
  const liveDockPosSec = isMobileViewport ? positionSec : smoothDockPosSec;
  const progressPct = Math.max(
    0,
    Math.min(100, (liveDockPosSec / activeDockDurSec) * 100)
  );
  const activeFillPct = dockRecedeRef.current ? lastRenderedPctRef.current : progressPct;
  const volumePct = Math.round(volume * 100);
  const upNextQueue = queue.slice(queueIndex + 1, queueIndex + 25);
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
  const crossfadePairActive = Boolean(
    isTransitioning &&
      outgoingTransitionTrack &&
      incomingTransitionTrack &&
      outgoingTransitionTrack.id !== incomingTransitionTrack.id
  );
  const cfAnimDurationSec = Math.max(1.2, transitionDurationSec || 4);
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
    { id: 'Social', label: 'Social', icon: <Users className="h-[18px] w-[18px]" /> },
  ];
  const dockHoverSec =
    dockHoverPct !== null ? (dockHoverPct / 100) * activeDockDurSec : null;

  const seekFromClientX = (clientX: number) => {
    const el = dockBarRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)));
    const nextSec = Math.round(pct * activeDockDurSec);
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    dockClockRef.current = {
      posSec: nextSec,
      renderedPosSec: nextSec,
      trackId: currentTrack.id,
      atMs: now,
    };
    dockExtrapRef.current = {
      lastRawPos: nextSec,
      lastWallMs: now,
      smoothedPos: nextSec,
      trackId: currentTrack.id,
    };
    manualSeekAtMsRef.current = now;
    dockRecedeRef.current = null;
    setIsDockReceding(false);
    lastRenderedPctRef.current = pct * 100;
    applyDockFillTransform(pct * 100);
    const txt = formatDurationSec(nextSec);
    if (dockTimeRef.current) dockTimeRef.current.textContent = txt;
    if (classicTimeRef.current) classicTimeRef.current.textContent = txt;
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
        <header className="pm-canvas relative z-30 flex h-12 w-full shrink-0 items-center gap-2 px-3">
          <div className="pm-no-drag relative z-20 flex shrink-0 items-center gap-2">
            <button
              type="button"
              aria-label="Ir al inicio"
              onClick={() => setActiveTab('Inicio')}
              className="pm-no-drag pm-hover pointer-events-auto relative z-20 flex items-center rounded-[10px] px-1.5 py-1"
            >
              <PMusicLogo size={26} variant="wordmark-only" />
            </button>

            {activeDetailView && (
              <button
                type="button"
                aria-label="Volver"
                data-testid="back-detail-btn"
                onClick={() => closeDetailView()}
                className="pm-no-drag pm-btn-secondary pm-pressable pointer-events-auto relative z-20 inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full px-3 text-xs font-semibold"
              >
                <ArrowLeft className="pointer-events-none h-3.5 w-3.5" />
                <span className="pointer-events-none">Volver</span>
              </button>
            )}
          </div>

          <div className="pm-drag-region h-full min-w-4 flex-1" aria-hidden="true" />

          <div className="pm-no-drag relative z-20 flex shrink-0 items-center justify-center">
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

          <div className="pm-drag-region h-full min-w-4 flex-1" aria-hidden="true" />

          <div
            className={`pm-no-drag relative z-20 flex shrink-0 items-center gap-1.5 ${
              isElectronDesktop && !isRealFullscreen ? 'mr-[138px]' : ''
            }`}
          >
            <button
              type="button"
              data-testid="desktop-fullscreen-btn"
              aria-label={isRealFullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'}
              title={isRealFullscreen ? 'Salir de pantalla completa (F11)' : 'Pantalla completa (F11)'}
              onClick={() => void toggleRealFullscreen().then(setIsRealFullscreen)}
              className="pm-no-drag pm-btn-secondary pm-pressable inline-flex h-8 w-8 items-center justify-center rounded-full"
            >
              {isRealFullscreen ? (
                <Minimize className="h-3.5 w-3.5" />
              ) : (
                <Maximize className="h-3.5 w-3.5" />
              )}
            </button>
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

            {authState.connected ? (
              <button
                type="button"
                data-testid="desktop-profile-btn"
                onClick={() => setSettingsOpen(true)}
                className="pm-no-drag pm-btn-secondary pm-pressable inline-flex h-8 items-center gap-2 rounded-full pl-1.5 pr-3 text-xs font-semibold"
                title={authState.email ?? 'Tu cuenta pMusic'}
              >
                {userProfile?.avatarUrl || authState.avatarUrl ? (
                  <img
                    src={userProfile?.avatarUrl || authState.avatarUrl || ''}
                    alt=""
                    className="h-5 w-5 rounded-full object-cover"
                  />
                ) : (
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#fa233b] text-[10px] font-black text-white">
                    {(userProfile?.displayName || authState.email || 'P').slice(0, 1).toUpperCase()}
                  </span>
                )}
                <span className="max-w-[110px] truncate">
                  {userProfile?.username ? `@${userProfile.username}` : authState.email?.split('@')[0] ?? 'Cuenta'}
                </span>
              </button>
            ) : (
              <button
                type="button"
                data-testid="desktop-signin-btn"
                onClick={() => setAuthOnboardingOpen(true)}
                className="pm-no-drag pm-btn-primary pm-pressable inline-flex h-8 items-center gap-1.5 rounded-full px-3.5 text-xs font-bold shadow-sm"
              >
                <span>Iniciar sesión</span>
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
                        className="pm-hover inline-flex h-7 w-7 items-center justify-center rounded-md pm-text-tertiary hover:text-[var(--pm-text-primary)]"
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        aria-label="Importar playlist"
                        onClick={() => setImportModalOpen(true)}
                        className="pm-hover inline-flex h-7 w-7 items-center justify-center rounded-md pm-text-tertiary hover:text-[var(--pm-text-primary)]"
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
                {authState.connected ? (
                  <button
                    type="button"
                    data-testid="mobile-profile-btn"
                    aria-label="Tu perfil"
                    onClick={() => setSettingsOpen(true)}
                    className="pm-glass-chip pm-pressable inline-flex h-9 items-center gap-1.5 rounded-full pl-1.5 pr-2.5 text-xs font-semibold pm-text-primary"
                  >
                    {userProfile?.avatarUrl || authState.avatarUrl ? (
                      <img
                        src={userProfile?.avatarUrl || authState.avatarUrl || ''}
                        alt=""
                        className="h-6 w-6 rounded-full object-cover"
                      />
                    ) : (
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#fa233b] text-[10px] font-black text-white">
                        {(userProfile?.displayName || authState.email || 'P').slice(0, 1).toUpperCase()}
                      </span>
                    )}
                    <span className="max-w-[76px] truncate">
                      {userProfile?.username ? `@${userProfile.username}` : 'Cuenta'}
                    </span>
                  </button>
                ) : (
                  <button
                    type="button"
                    data-testid="mobile-signin-btn"
                    onClick={() => setAuthOnboardingOpen(true)}
                    className="pm-btn-primary pm-pressable inline-flex h-9 items-center rounded-full px-3 text-xs font-bold"
                  >
                    Entrar
                  </button>
                )}

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
                {activeTab === 'Social' && <SocialScreen />}
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
              <div
                draggable
                onDragStart={(e) => setDraggedTrack(e, currentTrack)}
                onDragEnd={() => clearDraggedTrack()}
                className="pm-elevated relative cursor-grab overflow-hidden rounded-[14px] p-1 active:cursor-grabbing"
              >
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
                    draggable={false}
                    className="pointer-events-none aspect-square w-full select-none object-cover shadow-2xl"
                  />
                </button>
              </div>

              <div className="flex items-start justify-between gap-2">
                <div
                  draggable
                  onDragStart={(e) => setDraggedTrack(e, currentTrack)}
                  onDragEnd={() => clearDraggedTrack()}
                  className="min-w-0 flex-1 cursor-grab active:cursor-grabbing"
                >
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

            {/* Next in Queue Preview with Drag-and-Drop Reorder + Quick Song Search */}
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

              {/* Compact Quick Search to Add Songs Straight to Queue */}
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 pm-text-tertiary" />
                <input
                  type="text"
                  data-testid="sidebar-queue-search-input"
                  value={sidebarSearchQuery}
                  onChange={(e) => setSidebarSearchQuery(e.target.value)}
                  placeholder="Añadir canción a la cola…"
                  aria-label="Buscar canción para añadir a la cola"
                  className="w-full rounded-[10px] border pm-border bg-white/[0.04] py-1.5 pl-8 pr-7 text-[12px] pm-text-primary placeholder:pm-text-tertiary focus:border-white/25 focus:outline-none"
                />
                {sidebarSearchQuery.length > 0 && (
                  <button
                    type="button"
                    aria-label="Limpiar búsqueda de cola"
                    onClick={() => setSidebarSearchQuery('')}
                    className="absolute right-1.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full pm-text-tertiary hover:bg-white/10 hover:text-[var(--pm-text-primary)]"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>

              {sidebarSearchQuery.trim().length > 0 && (
                <div
                  data-testid="sidebar-queue-search-results"
                  className="space-y-1 rounded-[12px] border pm-border bg-black/25 p-1.5"
                >
                  {sidebarSearchLoading ? (
                    <div className="flex items-center justify-center py-3">
                      <Loader2 className="h-4 w-4 animate-spin pm-text-tertiary" />
                    </div>
                  ) : sidebarSearchResults.length === 0 ? (
                    <div className="py-2 text-center text-[11px] pm-text-tertiary">
                      Sin resultados
                    </div>
                  ) : (
                    sidebarSearchResults.map((resTrack) => {
                      const wasAdded = Boolean(sidebarAddedIds[resTrack.id]);
                      return (
                        <div
                          key={`sb-search-${resTrack.id}`}
                          data-testid={`sidebar-queue-search-result-${resTrack.id}`}
                          className="pm-hover flex items-center gap-2 rounded-[8px] p-1"
                        >
                          <img
                            src={resTrack.thumbnailUrl}
                            alt=""
                            className="h-8 w-8 shrink-0 rounded-[5px] object-cover"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[12px] font-medium pm-text-primary">
                              {resTrack.title}
                            </div>
                            <div className="truncate text-[10.5px] pm-text-tertiary">
                              {resTrack.artists.map((a) => a.name).join(', ')}
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-0.5">
                            <button
                              type="button"
                              title="Reproducir a continuación"
                              aria-label={`Poner ${resTrack.title} a continuación`}
                              onClick={() => {
                                playNextInQueue(resTrack);
                                setSidebarAddedIds((p) => ({ ...p, [resTrack.id]: true }));
                              }}
                              className="pm-pressable flex h-6 w-6 items-center justify-center rounded-full pm-text-secondary hover:bg-white/15 hover:text-[var(--pm-text-primary)]"
                            >
                              <ListStart className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              title="Añadir al final de la cola"
                              aria-label={`Añadir ${resTrack.title} a la cola`}
                              onClick={() => {
                                addToQueue(resTrack);
                                setSidebarAddedIds((p) => ({ ...p, [resTrack.id]: true }));
                              }}
                              className="pm-pressable flex h-6 w-6 items-center justify-center rounded-full pm-text-secondary hover:bg-white/15 hover:text-[var(--pm-text-primary)]"
                            >
                              {wasAdded ? (
                                <Check className="h-3.5 w-3.5 text-emerald-400" />
                              ) : (
                                <Plus className="h-3.5 w-3.5" />
                              )}
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              )}

              <div className="space-y-1">
                {upNextQueue.map((track, offset) => {
                  const realIdx = queueIndex + 1 + offset;
                  const isDropTarget =
                    sidebarDragOverIdx === realIdx && sidebarDragFromIdx !== realIdx;
                  return (
                    <div
                      key={`${track.id}-${realIdx}`}
                      data-testid={`sidebar-queue-item-${track.id}`}
                      draggable
                      onDragStart={(e) => {
                        setSidebarDragFromIdx(realIdx);
                        setDraggedTrack(e, track);
                      }}
                      onDragOver={(e) => {
                        if (sidebarDragFromIdx !== null) {
                          e.preventDefault();
                          if (sidebarDragOverIdx !== realIdx) {
                            setSidebarDragOverIdx(realIdx);
                          }
                        }
                      }}
                      onDrop={(e) => {
                        if (sidebarDragFromIdx !== null) {
                          e.preventDefault();
                          moveQueueItem(sidebarDragFromIdx, realIdx);
                          setSidebarDragFromIdx(null);
                          setSidebarDragOverIdx(null);
                        }
                      }}
                      onDragEnd={() => {
                        setSidebarDragFromIdx(null);
                        setSidebarDragOverIdx(null);
                        clearDraggedTrack();
                      }}
                      className={`pm-hover group/q flex w-full cursor-grab items-center gap-2 rounded-[8px] p-1.5 transition-colors active:cursor-grabbing ${
                        isDropTarget ? 'border-t-2 border-[var(--pm-accent-primary)] bg-white/[0.06]' : ''
                      } ${sidebarDragFromIdx === realIdx ? 'opacity-50' : ''}`}
                    >
                      <GripVertical
                        aria-hidden="true"
                        className="h-3.5 w-3.5 shrink-0 pm-text-tertiary opacity-40 transition-opacity group-hover/q:opacity-90"
                      />
                      <button
                        type="button"
                        aria-label={`Reproducir ${track.title}`}
                        onClick={() => void playTrack(track, queue)}
                        className="h-9 w-9 shrink-0 overflow-hidden rounded-[6px]"
                      >
                        <img
                          src={track.thumbnailUrl}
                          alt=""
                          draggable={false}
                          className="pointer-events-none h-full w-full select-none object-cover"
                        />
                      </button>
                      <div className="min-w-0 flex-1">
                        <button
                          type="button"
                          onClick={() => void playTrack(track, queue)}
                          className="block max-w-full truncate text-left text-[12.5px] font-medium pm-text-primary hover:underline"
                        >
                          {track.title}
                        </button>
                        <div className="truncate text-[11px] pm-text-tertiary">
                          <ArtistLinks
                            artists={track.artists}
                            className="flex !py-0 !leading-[1.25]"
                            linkClassName="hover:underline hover:text-[var(--pm-text-primary)]"
                          />
                        </div>
                      </div>
                      <button
                        type="button"
                        aria-label={`Quitar ${track.title} de la cola`}
                        onClick={(e) => {
                          e.stopPropagation();
                          removeQueueItem(realIdx);
                        }}
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full pm-text-tertiary opacity-0 transition-opacity hover:bg-white/10 hover:text-[var(--pm-text-primary)] group-hover/q:opacity-100"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  );
                })}
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
          className={`pm-glass-regular fixed z-40 grid select-none items-center gap-4 overflow-visible ${
            playerBarStyle === 'floating-island'
              ? 'left-1/2 bottom-3.5 h-[72px] w-[min(880px,calc(100%-32px))] -translate-x-1/2 cursor-pointer grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] rounded-full px-5'
              : playerBarStyle === 'minimal-wave'
                ? 'inset-x-3 bottom-3 h-[76px] cursor-pointer grid-cols-[minmax(200px,1fr)_minmax(300px,520px)_minmax(200px,1fr)] rounded-[18px] px-5'
                : playerBarStyle === 'ambient-dock'
                  ? 'inset-x-3 bottom-3 h-[80px] cursor-pointer grid-cols-[minmax(200px,1fr)_minmax(320px,540px)_minmax(200px,1fr)] rounded-[20px] px-5'
                  : 'inset-x-3 bottom-3 h-[84px] grid-cols-[minmax(200px,1fr)_minmax(320px,540px)_minmax(200px,1fr)] rounded-[20px] px-5'
          }`}
        >
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]"
          >
            {/* Ambient Progress Fill with Smooth Color Collapse + Liquid Water-Recede (GPU translate3d) */}
            {playerBarStyle === 'ambient-dock' && (
              <div
                ref={ambientFillRef}
                aria-hidden="true"
                data-testid="ambient-progress-fill"
                className="pointer-events-none absolute inset-0 z-0 w-full overflow-hidden will-change-transform transition-[background-color] duration-700"
                style={{
                  transform: `translate3d(${(activeFillPct - 100).toFixed(4)}%, 0, 0)`,
                  backgroundColor:
                    'color-mix(in srgb, var(--pm-ambient-1) 36%, rgba(255, 255, 255, 0.08))',
                }}
              >
                {dockColorWave && !reducedMotionPref && (
                  <span
                    key={dockColorWave.key}
                    aria-hidden="true"
                    className="pm-dock-color-collapse"
                    style={
                      {
                        '--pm-dock-prev-color': dockColorWave.prevColor,
                      } as React.CSSProperties
                    }
                  />
                )}
                {isDockReceding && !reducedMotionPref && (
                  <>
                    <span aria-hidden="true" className="pm-dock-water-recede-sheen" />
                    <span aria-hidden="true" className="pm-dock-water-recede-crest" />
                  </>
                )}
              </div>
            )}

            {/* Dynamic Floating Island Bottom Curve Progress Hairline (GPU translate3d) */}
            {playerBarStyle === 'floating-island' && (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-7 bottom-0 z-10 h-[3px] overflow-hidden rounded-full bg-white/12"
              >
                <div
                  ref={islandFillRef}
                  className="h-full w-full rounded-full will-change-transform"
                  style={{
                    transform: `translate3d(${(activeFillPct - 100).toFixed(4)}%, 0, 0)`,
                    background:
                      'linear-gradient(90deg, color-mix(in srgb, var(--pm-ambient-1) 80%, var(--pm-accent-primary)) 0%, var(--pm-accent-primary) 100%)',
                    boxShadow:
                      '0 0 12px color-mix(in srgb, var(--pm-ambient-1) 70%, transparent)',
                  }}
                />
              </div>
            )}

            {/* Minimal Studio Top Edge Glowing Progress Line (GPU translate3d) */}
            {playerBarStyle === 'minimal-wave' && (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 top-0 z-10 h-[3px] overflow-hidden bg-white/10"
              >
                <div
                  ref={waveFillRef}
                  className="h-full w-full rounded-r-full will-change-transform"
                  style={{
                    transform: `translate3d(${(activeFillPct - 100).toFixed(4)}%, 0, 0)`,
                    background:
                      'linear-gradient(90deg, color-mix(in srgb, var(--pm-ambient-2) 70%, var(--pm-accent-primary)) 0%, color-mix(in srgb, var(--pm-ambient-1) 85%, white) 100%)',
                    boxShadow:
                      '0 0 16px color-mix(in srgb, var(--pm-ambient-1) 65%, transparent)',
                  }}
                />
              </div>
            )}

            {/* Stealth Hover White Scrub Hairline + Cue Overlay */}
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
              </>
            )}
          </div>

          {playerBarStyle !== 'classic-center' && (
            <input
              ref={dockSrRangeRef}
              type="range"
              role="slider"
              aria-label="Posición de reproducción"
              min={0}
              max={Math.max(1, Math.round(activeDockDurSec))}
              step={0.1}
              value={Number(
                Math.min(activeDockDurSec, Math.round(liveDockPosSec * 10) / 10).toFixed(1)
              )}
              onChange={(e) => {
                const next = Number(e.target.value);
                const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
                manualSeekAtMsRef.current = now;
                dockExtrapRef.current = {
                  lastRawPos: next,
                  lastWallMs: now,
                  smoothedPos: next,
                  trackId: currentTrack.id,
                };
                dockRecedeRef.current = null;
                setIsDockReceding(false);
                const pct = Math.max(0, Math.min(100, (next / activeDockDurSec) * 100));
                lastRenderedPctRef.current = pct;
                applyDockFillTransform(pct);
                const txt = formatDurationSec(next);
                if (dockTimeRef.current) dockTimeRef.current.textContent = txt;
                setSmoothDockPosSec(next);
                seekTo(next);
              }}
              className="sr-only"
            />
          )}

          {/* Left: Unified GPU 3D Track Prism (Cover + Title + Explicit + Artists + Heart) */}
          <div className="pointer-events-none relative z-10 flex min-w-0 items-center">
            {crossfadePairActive && outgoingTransitionTrack && incomingTransitionTrack && !reducedMotionPref ? (
              <div
                key={`dock-prism-${outgoingTransitionTrack.id}-${incomingTransitionTrack.id}`}
                data-testid="dock-prism-viewport"
                className="pm-dock-prism-viewport pointer-events-auto relative -ml-2.5 -my-[2px] inline-grid max-w-[min(100%,388px)] items-center"
              >
                {/* Invisible sizers force the shared prism width to match the LONGER track + symmetrical margins */}
                {[outgoingTransitionTrack, incomingTransitionTrack].map((sizerTrack, sIdx) => (
                  <div
                    key={`sizer-${sIdx}-${sizerTrack.id}`}
                    aria-hidden="true"
                    className="pointer-events-none invisible col-start-1 row-start-1 flex h-[56px] select-none items-center gap-3 px-2.5 py-1.5"
                  >
                    <div className="h-11 w-11 shrink-0" />
                    <div className="min-w-0 max-w-[200px] xl:max-w-[240px]">
                      <div className="truncate text-[14px] font-semibold leading-[1.15]">
                        {sizerTrack.title}
                      </div>
                      <div className="mt-[2px] flex items-center gap-1.5 truncate text-[12px] leading-[1.2]">
                        {sizerTrack.isExplicit && <span className="inline-block h-[14px] w-[14px] shrink-0" />}
                        <span className="truncate">
                          {sizerTrack.artists.map((a) => a.name).join(', ')}
                        </span>
                      </div>
                    </div>
                    <span className="inline-block h-8 w-8 shrink-0" />
                  </div>
                ))}

                <div
                  className="pm-cube-prism col-start-1 row-start-1 h-[56px] w-full"
                  style={{
                    animation: `pmDockPrismRoll ${cfAnimDurationSec}s cubic-bezier(0.32, 0.05, 0.22, 1) forwards`,
                  }}
                >
                  {[
                    { trackItem: outgoingTransitionTrack, faceClass: 'pm-dock-face-front', isIncoming: false },
                    { trackItem: incomingTransitionTrack, faceClass: 'pm-dock-face-top', isIncoming: true },
                  ].map(({ trackItem, faceClass, isIncoming }) => {
                    const faceLiked = likedTracks.some((l) => l.trackId === trackItem.id);
                    return (
                      <div
                        key={faceClass}
                        className={`${faceClass} flex h-[56px] w-full items-center overflow-hidden`}
                      >
                        <div className="relative flex h-full w-full items-center gap-3 rounded-[14px] px-2.5 py-1.5">
                          <button
                            type="button"
                            aria-label="Abrir reproductor a pantalla completa"
                            onClick={() => setNowPlayingOpen(true)}
                            className="relative h-11 w-11 shrink-0 overflow-hidden rounded-[10px] shadow-md"
                          >
                            <img
                              src={trackItem.thumbnailUrl}
                              alt={trackItem.title}
                              draggable={false}
                              className="pointer-events-none h-full w-full select-none object-cover"
                            />
                          </button>
                          <div className="min-w-0 flex-1 max-w-[200px] xl:max-w-[240px]">
                            <div className="flex h-[17px] items-center">
                              <div className="block max-w-full truncate text-left text-[14px] font-semibold leading-[1.15] pm-text-primary">
                                {trackItem.title}
                              </div>
                            </div>
                            <div className="mt-[2px] flex h-[15px] items-center gap-1.5 truncate">
                              {trackItem.isExplicit && (
                                <span
                                  aria-label="Explícita"
                                  className="inline-flex h-[14px] w-[14px] shrink-0 items-center justify-center rounded-[3px] bg-[var(--pm-text-secondary)]/20 text-[9px] font-extrabold leading-none pm-text-secondary"
                                >
                                  E
                                </span>
                              )}
                              <div className="flex min-w-0 items-center truncate text-[12px] leading-[1.2] pm-text-secondary">
                                {trackItem.artists.map((a) => a.name).join(', ')}
                              </div>
                            </div>
                          </div>
                          {!isIncoming ? (
                            <span
                              aria-hidden="true"
                              className={`relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                                faceLiked ? 'text-rose-500' : 'pm-text-secondary'
                              } pm-dock-heart-out`}
                            >
                              <Heart className={`h-4 w-4 ${faceLiked ? 'fill-current' : ''}`} />
                            </span>
                          ) : (
                            <span aria-hidden="true" className="inline-block h-8 w-8 shrink-0" />
                          )}
                          {isIncoming ? (
                            <span
                              aria-hidden="true"
                              className="pm-cube-light-in absolute inset-0 rounded-[14px]"
                              style={{ animationDuration: `${cfAnimDurationSec}s` }}
                            />
                          ) : (
                            <span
                              aria-hidden="true"
                              className="pm-cube-shade-out absolute inset-0 rounded-[14px]"
                              style={{ animationDuration: `${cfAnimDurationSec}s` }}
                            />
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
            <div
              draggable
              onDragStart={(e) => setDraggedTrack(e, currentTrack)}
              onDragEnd={() => clearDraggedTrack()}
              className="pm-dock-interactive pointer-events-auto inline-flex h-[52px] min-w-0 max-w-full cursor-grab items-center gap-3 active:cursor-grabbing"
            >
              <button
                type="button"
                aria-label="Abrir reproductor a pantalla completa"
                onClick={() => setNowPlayingOpen(true)}
                className="group relative h-11 w-11 shrink-0 overflow-hidden rounded-[10px] shadow-md"
              >
                <img
                  src={currentTrack.thumbnailUrl}
                  alt={currentTrack.title}
                  draggable={false}
                  className="pointer-events-none h-full w-full select-none object-cover transition-transform duration-200 group-hover:scale-105"
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
                <div className="flex h-[17px] items-center">
                  <button
                    type="button"
                    onClick={() => setNowPlayingOpen(true)}
                    className="pm-text-btn block max-w-full truncate text-left text-[14px] font-semibold leading-[1.15] pm-text-primary hover:underline"
                  >
                    {currentTrack.title}
                  </button>
                </div>
                <div className="mt-[2px] flex h-[15px] items-center gap-1.5 truncate">
                  {currentTrack.isExplicit && (
                    <span
                      aria-label="Explícita"
                      className="inline-flex h-[14px] w-[14px] shrink-0 items-center justify-center rounded-[3px] bg-[var(--pm-text-secondary)]/20 text-[9px] font-extrabold leading-none pm-text-secondary"
                    >
                      E
                    </span>
                  )}
                  <div className="flex min-w-0 items-center truncate text-[12px] leading-[1.2] pm-text-secondary">
                    <ArtistLinks
                      artists={currentTrack.artists}
                      className="flex !py-0 !leading-[1.2]"
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
                  dockHeartPhase === 'fading-in' && !reducedMotionPref ? 'pm-dock-heart-in' : ''
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
            )}
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
                className={`pm-pressable pm-hover relative inline-flex h-8 w-8 items-center justify-center overflow-visible rounded-full transition-colors ${
                  shuffleEnabled
                    ? 'pm-text-primary'
                    : 'pm-text-tertiary hover:text-[var(--pm-text-primary)]'
                }`}
              >
                <AnimatedShuffleIcon
                  className="h-4 w-4"
                  animate={dockTransportAnim === 'shuffle' && !reducedMotionPref}
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
                className="pm-pressable pm-hover relative inline-flex h-10 w-10 items-center justify-center overflow-visible rounded-full pm-text-primary active:scale-90"
              >
                <AnimatedSkipBackIcon
                  className="h-[21px] w-[21px]"
                  animate={dockTransportAnim === 'prev' && !reducedMotionPref}
                />
              </button>

              <button
                type="button"
                data-testid="dock-play-btn"
                aria-label={showBuffering ? 'Cargando canción' : isPlaying ? 'Pausar' : 'Reproducir'}
                onClick={() => {
                  triggerDockTransportAnim('play');
                  void togglePlayPause();
                }}
                className="pm-btn-primary pm-pressable relative flex h-[42px] w-[42px] items-center justify-center overflow-visible rounded-full shadow-lg transition-transform duration-200 hover:scale-105 active:scale-90"
              >
                {showBuffering ? (
                  <Loader2 data-testid="dock-play-loader" className="h-5 w-5 animate-spin" />
                ) : (
                  <>
                    <RoundedPauseIcon
                      className={`absolute h-[22px] w-[22px] transition-all duration-200 ease-out ${
                        isPlaying
                          ? 'scale-100 rotate-0 opacity-100 blur-0'
                          : 'scale-50 rotate-90 opacity-0 blur-[1px]'
                      }`}
                    />
                    <RoundedPlayIcon
                      className={`absolute h-[22px] w-[22px] translate-x-[1px] transition-all duration-200 ease-out ${
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
                aria-label="Siguiente"
                onClick={() => {
                  triggerDockTransportAnim('next');
                  void nextTrack();
                }}
                className="pm-pressable pm-hover relative inline-flex h-10 w-10 items-center justify-center overflow-visible rounded-full pm-text-primary active:scale-90"
              >
                <AnimatedSkipForwardIcon
                  className="h-[21px] w-[21px]"
                  animate={dockTransportAnim === 'next' && !reducedMotionPref}
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
                    <Repeat1 className="h-4 w-4" />
                  ) : (
                    <Repeat className="h-4 w-4" />
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
                <span
                  ref={classicTimeRef}
                  className="tabular-nums w-9 shrink-0 select-none text-right text-[11px] font-medium pm-text-tertiary"
                >
                  {formatDurationSec(liveDockPosSec)}
                </span>
                <div className="group relative flex flex-1 items-center">
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-x-0 top-1/2 h-[4px] -translate-y-1/2 overflow-hidden rounded-full bg-[var(--pm-slider-track)] transition-[height] duration-150 group-hover:h-[5px]"
                  >
                    <div
                      ref={classicFillRef}
                      className="h-full w-full rounded-full will-change-transform"
                      style={{
                        transform: `translate3d(${(activeFillPct - 100).toFixed(4)}%, 0, 0)`,
                        backgroundColor:
                          'color-mix(in srgb, var(--pm-ambient-1) 62%, var(--pm-accent-primary))',
                      }}
                    />
                  </div>
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
                    ref={classicRangeRef}
                    type="range"
                    role="slider"
                    aria-label="Posición de reproducción"
                    min={0}
                    max={Math.max(1, Math.round(activeDockDurSec))}
                    step={0.1}
                    value={Number(
                      Math.min(activeDockDurSec, Math.round(liveDockPosSec * 10) / 10).toFixed(1)
                    )}
                    onChange={(e) => {
                      const next = Number(e.target.value);
                      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
                      manualSeekAtMsRef.current = now;
                      dockExtrapRef.current = {
                        lastRawPos: next,
                        lastWallMs: now,
                        smoothedPos: next,
                        trackId: currentTrack.id,
                      };
                      dockRecedeRef.current = null;
                      setIsDockReceding(false);
                      const pct = Math.max(0, Math.min(100, (next / activeDockDurSec) * 100));
                      lastRenderedPctRef.current = pct;
                      applyDockFillTransform(pct);
                      if (classicTimeRef.current) {
                        classicTimeRef.current.textContent = formatDurationSec(next);
                      }
                      setSmoothDockPosSec(next);
                      seekTo(next);
                    }}
                    className="pm-range-gpu-thumb-only relative z-10 w-full cursor-pointer"
                  />
                </div>
                <span
                  ref={classicDurRef}
                  className="tabular-nums w-9 shrink-0 select-none text-left text-[11px] font-medium pm-text-tertiary"
                >
                  {formatDurationSec(activeDockDurSec)}
                </span>
              </div>
            ) : (
              <div className="tabular-nums flex items-center justify-center gap-2 select-none text-[11px] font-medium pm-text-tertiary">
                <span ref={dockTimeRef}>{formatDurationSec(liveDockPosSec)}</span>
                <span aria-hidden="true" className="opacity-50">
                  ·
                </span>
                <span ref={dockDurRef}>{formatDurationSec(activeDockDurSec)}</span>
              </div>
            )}
          </div>

          {/* Right: Compact Floating Island Menu OR Full Utility Capsule */}
          <div className="pointer-events-none relative z-10 flex items-center justify-end">
            {playerBarStyle === 'floating-island' ? (
              <div
                ref={islandMenuRef}
                className="pm-dock-interactive pm-dock-cluster pointer-events-auto relative flex items-center gap-1 rounded-full px-2 py-1"
              >
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
                  className="pm-range-subtle mx-0.5 hidden w-14 sm:block"
                />

                <button
                  type="button"
                  data-testid="island-effects-btn"
                  aria-label="Efectos y controles"
                  aria-expanded={islandMenuOpen}
                  onClick={() => setIslandMenuOpen((v) => !v)}
                  className={`pm-pressable relative inline-flex h-8 w-8 items-center justify-center rounded-full transition-colors ${
                    islandMenuOpen || djMode.enabled || eqSheetOpen || Boolean(remoteControlledDeviceId)
                      ? 'bg-white/[0.16] pm-text-primary'
                      : 'pm-text-secondary hover:bg-white/[0.10] hover:text-[var(--pm-text-primary)]'
                  }`}
                >
                  <MoreHorizontal className="h-4 w-4" />
                  {(djMode.enabled || eqSheetOpen || Boolean(remoteControlledDeviceId)) && (
                    <span
                      aria-hidden="true"
                      className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full"
                      style={{
                        backgroundColor: remoteControlledDeviceId
                          ? '#34D399'
                          : djMode.enabled
                            ? '#C084FC'
                            : 'var(--pm-accent-primary)',
                      }}
                    />
                  )}
                </button>

                <button
                  type="button"
                  aria-label="Expandir reproductor"
                  onClick={() => setNowPlayingOpen(true)}
                  className="pm-pressable inline-flex h-8 w-8 items-center justify-center rounded-full pm-text-secondary transition-colors hover:bg-white/[0.10] hover:text-[var(--pm-text-primary)]"
                >
                  <Maximize2 className="h-3.5 w-3.5" />
                </button>

                {islandMenuOpen && (
                  <div
                    data-testid="island-effects-menu"
                    role="menu"
                    aria-label="Efectos y herramientas de reproducción"
                    className="pm-glass-frosted-neutral pm-hud-dark pm-menu-pop pm-dock-interactive pointer-events-auto absolute right-0 bottom-[calc(100%+14px)] z-50 w-[264px] rounded-[22px] border border-white/[0.14] p-2.5 shadow-[0_24px_64px_rgba(0,0,0,0.78)]"
                  >
                    <div className="mb-2 flex items-center justify-between px-1.5">
                      <span className="text-[11px] font-bold uppercase tracking-wider pm-text-tertiary">
                        Efectos y controles
                      </span>
                      {djMode.enabled && (
                        <span className="rounded-full bg-purple-500/20 px-2 py-0.5 text-[10px] font-bold text-purple-300">
                          DJ Activo
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                      <button
                        type="button"
                        data-testid="island-effect-dj"
                        onClick={() => {
                          setIslandMenuOpen(false);
                          setDjPopoverOpen(!djPopoverOpen);
                        }}
                        className={`pm-pressable flex flex-col items-start gap-1 rounded-[14px] px-3 py-2.5 text-left transition-colors ${
                          djMode.enabled || djPopoverOpen
                            ? 'bg-purple-500/20 text-purple-200 ring-1 ring-purple-400/35'
                            : 'bg-white/[0.06] pm-text-secondary hover:bg-white/[0.12] hover:text-[var(--pm-text-primary)]'
                        }`}
                      >
                        <Disc3 className={`h-4 w-4 ${djMode.enabled ? 'text-purple-400' : ''}`} />
                        <span className="text-[12px] font-semibold pm-text-primary">Sesión DJ</span>
                        <span className="text-[10px] pm-text-tertiary">
                          {djMode.enabled ? 'Mezcla automática' : 'AutoMix'}
                        </span>
                      </button>

                      <button
                        type="button"
                        data-testid="island-effect-eq"
                        onClick={() => {
                          setIslandMenuOpen(false);
                          setEqSheetOpen(!eqSheetOpen);
                        }}
                        className={`pm-pressable flex flex-col items-start gap-1 rounded-[14px] px-3 py-2.5 text-left transition-colors ${
                          eqSheetOpen
                            ? 'bg-white/[0.16] pm-text-primary ring-1 ring-white/25'
                            : 'bg-white/[0.06] pm-text-secondary hover:bg-white/[0.12] hover:text-[var(--pm-text-primary)]'
                        }`}
                      >
                        <Sliders className="h-4 w-4" />
                        <span className="text-[12px] font-semibold pm-text-primary">Ecualizador</span>
                        <span className="text-[10px] pm-text-tertiary">Audio &amp; Crossfade</span>
                      </button>

                      <button
                        type="button"
                        data-testid="island-effect-lyrics"
                        onClick={() => {
                          setIslandMenuOpen(false);
                          setNowPlayingOpen(true);
                          setNowPlayingTab('Letras');
                        }}
                        className="pm-pressable flex flex-col items-start gap-1 rounded-[14px] bg-white/[0.06] px-3 py-2.5 text-left pm-text-secondary transition-colors hover:bg-white/[0.12] hover:text-[var(--pm-text-primary)]"
                      >
                        <Mic2 className="h-4 w-4" />
                        <span className="text-[12px] font-semibold pm-text-primary">Letras</span>
                        <span className="text-[10px] pm-text-tertiary">Sincronizadas</span>
                      </button>

                      <button
                        type="button"
                        data-testid="island-effect-connect"
                        onClick={() => {
                          setIslandMenuOpen(false);
                          setDevicesSheetOpen(true);
                        }}
                        className={`pm-pressable flex flex-col items-start gap-1 rounded-[14px] px-3 py-2.5 text-left transition-colors ${
                          remoteControlledDeviceId
                            ? 'bg-emerald-500/20 text-emerald-200 ring-1 ring-emerald-400/35'
                            : 'bg-white/[0.06] pm-text-secondary hover:bg-white/[0.12] hover:text-[var(--pm-text-primary)]'
                        }`}
                      >
                        <Wifi
                          className={`h-4 w-4 ${
                            remoteControlledDeviceId || onlineDevices.length > 1
                              ? 'text-emerald-400'
                              : ''
                          }`}
                        />
                        <span className="text-[12px] font-semibold pm-text-primary">Conectar</span>
                        <span className="truncate max-w-full text-[10px] pm-text-tertiary">
                          {remoteDeviceSnapshot?.deviceName ?? 'Dispositivos'}
                        </span>
                      </button>
                    </div>

                    <div className="mt-1.5 flex items-center gap-1.5">
                      <button
                        type="button"
                        data-testid="island-effect-queue"
                        onClick={() => {
                          setIslandMenuOpen(false);
                          setRightPanelOpen(!rightPanelOpen);
                        }}
                        className="pm-pressable flex flex-1 items-center justify-center gap-1.5 rounded-full bg-white/[0.07] px-3 py-1.5 text-[11px] font-semibold pm-text-secondary transition-colors hover:bg-white/[0.14] hover:text-[var(--pm-text-primary)]"
                      >
                        {rightPanelOpen ? (
                          <PanelRightClose className="h-3.5 w-3.5" />
                        ) : (
                          <PanelRightOpen className="h-3.5 w-3.5" />
                        )}
                        <span>{rightPanelOpen ? 'Ocultar cola' : 'Ver cola'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setIslandMenuOpen(false);
                          setNowPlayingOpen(true);
                        }}
                        className="pm-pressable flex items-center justify-center gap-1.5 rounded-full bg-white/[0.07] px-3 py-1.5 text-[11px] font-semibold pm-text-secondary transition-colors hover:bg-white/[0.14] hover:text-[var(--pm-text-primary)]"
                      >
                        <Maximize2 className="h-3.5 w-3.5" />
                        <span>Expandir</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
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
                data-testid="dock-connect-btn"
                aria-label="Dispositivos conectados (pMusic Connect)"
                aria-pressed={devicesSheetOpen || Boolean(remoteControlledDeviceId)}
                onClick={() => setDevicesSheetOpen(true)}
                className={`pm-pressable inline-flex h-8 items-center justify-center gap-1.5 rounded-full px-2 text-[11px] font-bold transition-colors ${
                  remoteControlledDeviceId
                    ? 'bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-400/40'
                    : onlineDevices.length > 1
                      ? 'text-emerald-400 hover:bg-emerald-500/15'
                      : 'pm-text-secondary hover:bg-white/[0.10] hover:text-[var(--pm-text-primary)]'
                }`}
              >
                <Wifi className="h-3.5 w-3.5" />
                {remoteControlledDeviceId && (
                  <span className="hidden max-w-[110px] truncate xl:inline">
                    {remoteDeviceSnapshot?.deviceName ?? 'Conectado'}
                  </span>
                )}
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
            )}
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
            {remoteControlledDeviceId && (
              <button
                type="button"
                onClick={() => setDevicesSheetOpen(true)}
                className="mb-1.5 flex w-full items-center justify-between gap-2 rounded-xl bg-emerald-500/15 px-2.5 py-1 text-[11px] font-bold text-emerald-400"
              >
                <span className="inline-flex min-w-0 items-center gap-1.5 truncate">
                  <Wifi className="h-3 w-3 shrink-0" />
                  <span className="truncate">
                    Escuchando en {remoteDeviceSnapshot?.deviceName ?? 'otro dispositivo'}
                  </span>
                </span>
                <span className="shrink-0 text-[10px] opacity-80">Controlar</span>
              </button>
            )}
            <div className="flex items-center justify-between gap-2">
              {crossfadePairActive && outgoingTransitionTrack && incomingTransitionTrack && !reducedMotionPref ? (
                <div
                  key={`m-dock-prism-${outgoingTransitionTrack.id}-${incomingTransitionTrack.id}`}
                  className="pm-dock-prism-viewport relative min-w-0 flex-1"
                >
                  <div
                    className="pm-cube-prism"
                    style={{
                      animation: `pmDockPrismRoll ${cfAnimDurationSec}s cubic-bezier(0.32, 0.05, 0.22, 1) forwards`,
                    }}
                  >
                    {[
                      { trackItem: outgoingTransitionTrack, faceClass: 'pm-dock-face-front', isIncoming: false },
                      { trackItem: incomingTransitionTrack, faceClass: 'pm-dock-face-top', isIncoming: true },
                    ].map(({ trackItem, faceClass, isIncoming }) => {
                      const faceLiked = likedTracks.some((l) => l.trackId === trackItem.id);
                      return (
                        <div
                          key={faceClass}
                          className={`${faceClass} flex h-[52px] w-full items-center justify-between gap-2 overflow-hidden`}
                        >
                          <div className="flex min-w-0 flex-1 items-center gap-2.5">
                            <button
                              type="button"
                              aria-label="Abrir reproductor Reproduciendo ahora"
                              onClick={() => setNowPlayingOpen(true)}
                              className="relative h-11 w-11 shrink-0 overflow-hidden rounded-[8px] shadow-sm"
                            >
                              <img
                                src={trackItem.thumbnailUrl}
                                alt={trackItem.title}
                                draggable={false}
                                className="h-full w-full object-cover"
                              />
                            </button>
                            <div className="min-w-0 flex-1">
                              <div className="flex h-[17px] items-center">
                                <div className="block max-w-full truncate text-left text-[14px] font-semibold leading-[1.15] pm-text-primary">
                                  {trackItem.title}
                                </div>
                              </div>
                              <div className="mt-[2px] flex h-[15px] items-center truncate text-xs leading-[1.2] pm-text-secondary">
                                {trackItem.artists.map((a) => a.name).join(', ')}
                              </div>
                            </div>
                          </div>
                          {!isIncoming && (
                            <span
                              aria-hidden="true"
                              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/[0.08] ${
                                faceLiked ? 'text-rose-500' : 'pm-text-secondary'
                              } pm-dock-heart-out`}
                            >
                              <Heart className={`h-4 w-4 ${faceLiked ? 'fill-current' : ''}`} />
                            </span>
                          )}
                          {isIncoming ? (
                            <span
                              aria-hidden="true"
                              className="pm-cube-light-in absolute inset-0 rounded-[12px]"
                              style={{ animationDuration: `${cfAnimDurationSec}s` }}
                            />
                          ) : (
                            <span
                              aria-hidden="true"
                              className="pm-cube-shade-out absolute inset-0 rounded-[12px]"
                              style={{ animationDuration: `${cfAnimDurationSec}s` }}
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex min-w-0 flex-1 items-center gap-2.5">
                    <button
                      type="button"
                      aria-label="Abrir reproductor Reproduciendo ahora"
                      onClick={() => setNowPlayingOpen(true)}
                      className="relative h-11 w-11 shrink-0 overflow-hidden rounded-[8px] shadow-sm"
                    >
                      <img
                        src={currentTrack.thumbnailUrl}
                        alt={currentTrack.title}
                        className="h-full w-full object-cover"
                      />
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="flex h-[17px] items-center">
                        <button
                          type="button"
                          onClick={() => setNowPlayingOpen(true)}
                          className="block max-w-full truncate text-left text-[14px] font-semibold leading-[1.15] pm-text-primary hover:underline"
                        >
                          {currentTrack.title}
                        </button>
                      </div>
                      <div className="mt-[2px] flex h-[15px] items-center truncate text-xs leading-[1.2] pm-text-secondary">
                        <ArtistLinks
                          artists={currentTrack.artists}
                          className="flex !py-0 !leading-[1.2]"
                          linkClassName="hover:underline hover:text-[var(--pm-text-primary)]"
                        />
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    aria-label={isLiked ? 'Quitar de Me gusta' : 'Añadir a Me gusta'}
                    onClick={() => void toggleLike(currentTrack)}
                    className={`pm-pressable flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/[0.08] ${
                      dockHeartPhase === 'fading-in' && !reducedMotionPref ? 'pm-dock-heart-in' : ''
                    } ${
                      isLiked ? 'text-rose-500' : 'pm-text-secondary'
                    }`}
                  >
                    <Heart className={`h-4 w-4 ${isLiked ? 'fill-current' : ''}`} />
                  </button>
                </>
              )}

              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  data-testid="mobile-play-btn"
                  aria-label={showBuffering ? 'Cargando canción' : isPlaying ? 'Pausar' : 'Reproducir'}
                  onClick={() => void togglePlayPause()}
                  className="pm-btn-primary pm-pressable relative flex h-10 w-10 items-center justify-center overflow-visible rounded-full shadow-md"
                >
                  {showBuffering ? (
                    <Loader2 data-testid="mobile-play-loader" className="h-4.5 w-4.5 animate-spin" />
                  ) : (
                    <>
                      <RoundedPauseIcon
                        className={`absolute h-[22px] w-[22px] transition-all duration-200 ease-out ${
                          isPlaying
                            ? 'scale-100 rotate-0 opacity-100 blur-0'
                            : 'scale-50 rotate-90 opacity-0 blur-[1px]'
                        }`}
                      />
                      <RoundedPlayIcon
                        className={`absolute h-[22px] w-[22px] translate-x-[1px] transition-all duration-200 ease-out ${
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
                  onClick={() => {
                    triggerDockTransportAnim('next');
                    void nextTrack();
                  }}
                  className="pm-pressable relative flex h-10 w-10 items-center justify-center overflow-visible rounded-full pm-text-primary"
                >
                  <AnimatedSkipForwardIcon
                    className="h-5 w-5"
                    animate={dockTransportAnim === 'next' && !reducedMotionPref}
                  />
                </button>
              </div>
            </div>

            {/* Subtle solid hairline progress track along bottom of mini-player (GPU translate3d) */}
            <div className="mt-1.5 h-[2px] w-full overflow-hidden rounded-full bg-[var(--pm-slider-track)]">
              <div
                className="h-full w-full rounded-full will-change-transform"
                style={{
                  transform: `translate3d(${(progressPct - 100).toFixed(4)}%, 0, 0)`,
                  backgroundColor: 'var(--pm-slider-active)',
                }}
              />
            </div>
          </div>

          <nav
            role="tablist"
            aria-label="Navegación móvil"
            data-testid="mobile-tab-bar"
            className="pm-glass-regular fixed inset-x-3 bottom-[max(0.75rem,var(--pm-safe-bottom,env(safe-area-inset-bottom)))] z-40 grid grid-cols-5 gap-1 rounded-[22px] p-1.5"
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
      <AuthOnboardingModal />
      <WrappedStoriesModal />
      <TrackInfoModal />
      <TrackContextMenu />
      <AppToast />
    </div>
  );
};

export default App;
