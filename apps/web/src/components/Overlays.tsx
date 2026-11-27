import React, { useEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import {
  ArrowLeft,
  Check,
  ChevronDown,
  Clock,
  Copy,
  Disc3,
  Download,
  Eye,
  Image as ImageIcon,
  Laptop,
  ListMusic,
  Loader2,
  Lock,
  Maximize,
  MessageSquareQuote,
  Mic2,
  Minimize,
  MoreHorizontal,
  Palette,
  Pause,
  Play,
  Plus,
  Radio,
  Repeat,
  Repeat1,
  Search,
  Share2,
  Shuffle,
  Sliders,
  SlidersHorizontal,
  Smartphone,
  Sparkles,
  Type,
  Users,
  Volume2,
  VolumeX,
  Waves,
  Wifi,
  X,
} from 'lucide-react';
import {
  AnimatedShuffleIcon,
  AnimatedSkipBackIcon,
  AnimatedSkipForwardIcon,
  RoundedPauseIcon,
  RoundedPlayIcon,
} from './TransportIcons.tsx';
import { LiquidHeartIcon } from './LiquidHeartIcon.tsx';
import {
  InkBleedCoverTransition,
  prefetchInkCoverImage,
  warmUpInkBleedWebGL,
} from './InkBleedCoverTransition.tsx';
import { ExoticBackdropCanvas } from './ExoticBackdropCanvas.tsx';
import { MarqueeText } from './MarqueeText.tsx';
import { TrackArtwork } from './TrackArtwork.tsx';
import { NowPlayingQueuePanel } from './NowPlayingQueuePanel.tsx';
import { buildJamQrImageUrl, buildJamShareUrl } from '../services/social-service.ts';
import { useDelayedBuffering } from '../hooks/useDelayedBuffering.ts';
import {
  USER_EQ_FREQUENCIES_HZ,
  USER_EQ_PRESETS,
  formatDurationSec,
  type AudioStreamQuality,
  type DjFxToggles,
  type LyricLine,
  type Track,
} from '@pmusic/core';
import {
  getLivePlaybackPosition,
  usePMusicStore,
  type LyricsVisualStyle,
  type NowPlayingBackdropStyle,
} from '../store/usePMusicStore.ts';
import {
  getRealFullscreen,
  isElectronDesktopRuntime,
  onRealFullscreenChange,
  setDesktopTitleBarOverlay,
  toggleRealFullscreen,
} from '../platform/web-bridge.ts';
import { getThemeDefinition } from '../utils/themes.ts';
import {
  animateAmbientPaletteFromCover,
  getLiveCoverBrightness,
  prefetchAmbientPaletteFromCover,
  registerBackdropCleanupHook,
  shouldUseDarkInkOnBackdrop,
  subscribeCoverBrightness,
} from '../utils/cover-color.ts';
import { ArtistLinks } from './ArtistLinks.tsx';
import { PMusicSwitch } from './PMusicSwitch.tsx';
import {
  MobileFluidBackdropCanvas,
  prefetchFluidBackdropCover,
} from './MobileFluidBackdropCanvas.tsx';

function normalizeLyricToken(raw: string): string {
  return raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9ñ]/g, '');
}

function getRhymeKey(cleanWord: string): string {
  if (cleanWord.length < 3) return '';
  return cleanWord.slice(cleanWord.length >= 4 ? -3 : -2);
}

type WordEmphasis = 'normal' | 'punch' | 'rhyme';

function analyzeKineticWords(
  lines: readonly LyricLine[],
  lineIdx: number
): WordEmphasis[] {
  const curText = lines[lineIdx]?.text ?? '';
  const words = curText.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const neighborRhymes = new Set<string>();
  for (const offset of [-2, -1, 1, 2]) {
    const nb = lines[lineIdx + offset]?.text ?? '';
    const nbWords = nb.trim().split(/\s+/).filter(Boolean);
    for (let i = Math.max(0, nbWords.length - 3); i < nbWords.length; i++) {
      const k = getRhymeKey(normalizeLyricToken(nbWords[i] ?? ''));
      if (k) neighborRhymes.add(k);
    }
  }

  let punchBudget = 2;
  const maxLen = words.reduce((m, w) => Math.max(m, normalizeLyricToken(w).length), 0);

  return words.map((raw, idx) => {
    const clean = normalizeLyricToken(raw);
    const isLineTail = idx >= Math.max(0, words.length - 2);
    const rKey = getRhymeKey(clean);
    if (isLineTail && rKey && neighborRhymes.has(rKey)) {
      return 'rhyme';
    }
    const isUpper = raw.length >= 3 && raw === raw.toUpperCase() && /[A-Z]/.test(raw);
    const hasPunct = /[!?¡¿]/.test(raw);
    const isLongestImpact =
      punchBudget > 0 && clean.length >= 5 && clean.length === maxLen && idx > 0;
    if ((isUpper || hasPunct || isLongestImpact) && punchBudget > 0) {
      punchBudget -= 1;
      return 'punch';
    }
    return 'normal';
  });
}

const LYRICS_STYLE_OPTIONS: readonly {
  id: LyricsVisualStyle;
  label: string;
  desc: string;
  previewClass: string;
}[] = [
  { id: 'classic', label: 'Clásico', desc: 'Barrido suave palabra a palabra', previewClass: 'font-sans' },
  { id: 'wordflow', label: 'Palabra Viva', desc: 'Cada palabra salta y varía al ritmo', previewClass: 'font-extrabold tracking-tight' },
  { id: 'kinetic', label: 'Cinético', desc: 'Rimas y punchlines con impacto visual', previewClass: 'font-black' },
  { id: 'neon', label: 'Neón', desc: 'Concierto display con brillo luminoso', previewClass: 'pm-neon-font' },
  { id: 'typewriter', label: 'Máquina', desc: 'Tipografía mono con cursor en vivo', previewClass: 'pm-mono-font' },
  { id: 'poster', label: 'Póster', desc: 'Contraste bold e itálica editorial', previewClass: 'pm-poster-font' },
  { id: 'focus', label: 'Enfoque', desc: 'Un verso limpio en el centro', previewClass: 'font-extrabold' },
  { id: 'editorial', label: 'Editorial', desc: 'Serif cálida estilo revista musical', previewClass: 'pm-editorial-font italic' },
];

export function isSameAlbumOrCover(
  a: Track | null | undefined,
  b: Track | null | undefined
): boolean {
  if (!a || !b) return false;
  if (a.album?.id && b.album?.id && a.album.id === b.album.id) return true;
  const nameA = a.album?.name?.trim().toLowerCase();
  const nameB = b.album?.name?.trim().toLowerCase();
  const artistA = a.artists[0]?.name?.trim().toLowerCase();
  const artistB = b.artists[0]?.name?.trim().toLowerCase();
  if (
    nameA &&
    nameB &&
    nameA === nameB &&
    (!artistA || !artistB || artistA === artistB)
  ) {
    return true;
  }
  const urlA = (a.thumbnailHighUrl ?? a.thumbnailUrl ?? '').trim();
  const urlB = (b.thumbnailHighUrl ?? b.thumbnailUrl ?? '').trim();
  if (urlA && urlB && urlA === urlB) return true;
  return false;
}

const BACKDROP_STYLE_OPTIONS: readonly {
  id: NowPlayingBackdropStyle;
  label: string;
  desc: string;
}[] = [
  { id: 'pulse', label: 'Pulso', desc: 'Ondas luminosas y respiración viva' },
  { id: 'fluid', label: 'Fluido', desc: 'Portada viva y orbes' },
  { id: 'paint', label: 'Pintura', desc: 'Óleo líquido en movimiento' },
  { id: 'minimal', label: 'Minimal', desc: 'Estudio editorial oscuro' },
];

const PLAYER_BAR_STYLE_OPTIONS = [
  {
    id: 'classic-center',
    label: 'Clásica Central',
    desc: 'Controles centrados y tiempos simétricos',
  },
  {
    id: 'ambient-dock',
    label: 'Ambiental Fluida',
    desc: 'Color suave continuo del álbum',
  },
  {
    id: 'floating-island',
    label: 'Isla Flotante',
    desc: 'Cápsula compacta con barra inferior',
  },
  {
    id: 'minimal-wave',
    label: 'Minimalista',
    desc: 'Diseño puro de estudio',
  },
] as const;

const decodedBackdropImgCache = new Map<string, HTMLImageElement>();
export function clearDecodedBackdropCache(): void {
  decodedBackdropImgCache.clear();
}
registerBackdropCleanupHook(clearDecodedBackdropCache);

export const NowPlayingSheet: React.FC = React.memo(() => {
  const nowPlayingOpen = usePMusicStore((s) => s.nowPlayingOpen);
  if (!nowPlayingOpen) return null;
  return <NowPlayingSheetInner />;
});
NowPlayingSheet.displayName = 'NowPlayingSheet';

const NowPlayingSheetInner: React.FC = () => {
  const {
    nowPlayingOpen,
    nowPlayingTab,
    setNowPlayingOpen,
    setNowPlayingTab,
    eqSheetOpen,
    setEqSheetOpen,
    djPopoverOpen,
    setDjPopoverOpen,
    audioPanelTab,
    setAudioPanelTab,
    outgoingTransitionTrack,
    incomingTransitionTrack,
    themeId,
    reducedMotionPref,
    isAppHidden,
    lyricsSize,
    lyricsBlurEnabled,
    lyricsStyle,
    setLyricsStyle,
    ambientMotionEnabled,
    nowPlayingBackdropStyle,
    skipSameAlbumCoverTransition,
    marqueeTextEnabled,
    showRemainingTime,
    setShowRemainingTime,
    lastTrackDirection,
    currentTrack,
    nextPrefetchUrl,
    needsRecommendedReplenish,
    isLoadingRecommendedQueue,
    shuffleEnabled,
    repeatMode,
    isPlaying,
    isBuffering,
    durationSec,
    volume,
    isTransitioning,
    transitionDurationSec,
    djMode,
    activeTransitionPlan,
    currentLyrics,
    lyricsUserScrolled,
    setLyricsUserScrolled,
    isLiked,
    dlStatus,
    togglePlayPause,
    nextTrack,
    prevTrack,
    toggleShuffle,
    cycleRepeatMode,
    seekTo,
    setVolume,
    toggleMute,
    openTrackMenu,
    toggleLike,
    downloadTrackOffline,
    replenishRecommendedQueue,
    openAlbumDetail,
    activeJamSession,
    activeJamRole,
    streamQuality,
  } = usePMusicStore(
    useShallow((s) => {
      const nextTrackCand = s.queue[s.queueIndex + 1] ?? s.recommendedQueue[0] ?? null;
      return {
        streamQuality: s.streamQuality,
        nowPlayingOpen: s.nowPlayingOpen,
        nowPlayingTab: s.nowPlayingTab,
        setNowPlayingOpen: s.setNowPlayingOpen,
        setNowPlayingTab: s.setNowPlayingTab,
        eqSheetOpen: s.eqSheetOpen,
        setEqSheetOpen: s.setEqSheetOpen,
        djPopoverOpen: s.djPopoverOpen,
        setDjPopoverOpen: s.setDjPopoverOpen,
        audioPanelTab: s.audioPanelTab,
        setAudioPanelTab: s.setAudioPanelTab,
        outgoingTransitionTrack: s.outgoingTransitionTrack,
        incomingTransitionTrack: s.incomingTransitionTrack,
        themeId: s.themeId,
        reducedMotionPref: s.reducedMotionPref,
        isAppHidden: s.isAppHidden,
        lyricsSize: s.lyricsSize,
        lyricsBlurEnabled: s.lyricsBlurEnabled,
        lyricsStyle: s.lyricsStyle,
        setLyricsStyle: s.setLyricsStyle,
        ambientMotionEnabled: s.ambientMotionEnabled,
        nowPlayingBackdropStyle: s.nowPlayingBackdropStyle,
        skipSameAlbumCoverTransition: s.skipSameAlbumCoverTransition,
        marqueeTextEnabled: s.marqueeTextEnabled,
        showRemainingTime: s.showRemainingTime,
        setShowRemainingTime: s.setShowRemainingTime,
        lastTrackDirection: s.lastTrackDirection,
        currentTrack: s.currentTrack,
        nextPrefetchUrl: nextTrackCand
          ? (nextTrackCand.thumbnailHighUrl ?? nextTrackCand.thumbnailUrl ?? '').trim()
          : '',
        needsRecommendedReplenish: s.recommendedQueue.length < 3,
        isLoadingRecommendedQueue: s.isLoadingRecommendedQueue,
        shuffleEnabled: s.shuffleEnabled,
        repeatMode: s.repeatMode,
        isPlaying: s.isPlaying,
        isBuffering: s.isBuffering,
        durationSec: s.durationSec,
        volume: s.volume,
        isTransitioning: s.isTransitioning,
        transitionDurationSec: s.transitionDurationSec,
        djMode: s.djMode,
        activeTransitionPlan: s.activeTransitionPlan,
        currentLyrics: s.currentLyrics,
        lyricsUserScrolled: s.lyricsUserScrolled,
        setLyricsUserScrolled: s.setLyricsUserScrolled,
        isLiked: s.likedTracks.some((l) => l.trackId === s.currentTrack.id),
        dlStatus: s.offlineDownloads[s.currentTrack.id] ?? 'idle',
        togglePlayPause: s.togglePlayPause,
        nextTrack: s.nextTrack,
        prevTrack: s.prevTrack,
        toggleShuffle: s.toggleShuffle,
        cycleRepeatMode: s.cycleRepeatMode,
        seekTo: s.seekTo,
        setVolume: s.setVolume,
        toggleMute: s.toggleMute,
        openTrackMenu: s.openTrackMenu,
        toggleLike: s.toggleLike,
        downloadTrackOffline: s.downloadTrackOffline,
        replenishRecommendedQueue: s.replenishRecommendedQueue,
        openAlbumDetail: s.openAlbumDetail,
        activeJamSession: s.activeJamSession,
        activeJamRole: s.activeJamRole,
      };
    })
  );

  const isGuestInJam = Boolean(activeJamSession?.active && activeJamRole === 'guest');

  const initialPosSec = usePMusicStore.getState().positionSec;
  const isElectronDesktop = isElectronDesktopRuntime();
  const showBuffering = useDelayedBuffering(isBuffering, 500);
  const sheetRootRef = useRef<HTMLDivElement | null>(null);
  const lyricsContainerRef = useRef<HTMLDivElement | null>(null);
  const activeLyricRef = useRef<HTMLButtonElement | null>(null);
  const cachedSingLineElRef = useRef<HTMLButtonElement | null>(null);
  const cachedSingSpansRef = useRef<NodeListOf<HTMLElement> | null>(null);
  const progressInputRef = useRef<HTMLInputElement | null>(null);
  const sheetFillRef = useRef<HTMLDivElement | null>(null);
  const sheetRewindGlowRef = useRef<HTMLSpanElement | null>(null);
  const progressTimeRef = useRef<HTMLSpanElement | null>(null);
  const progressRemainRef = useRef<HTMLSpanElement | null>(null);
  const showRemainingTimeRef = useRef(showRemainingTime);
  const sheetDurationSecRef = useRef(durationSec);
  sheetDurationSecRef.current = durationSec;
  const sheetTrackIdRef = useRef(currentTrack.id);
  sheetTrackIdRef.current = currentTrack.id;
  const nowPlayingTabRef = useRef(nowPlayingTab);
  nowPlayingTabRef.current = nowPlayingTab;
  const reducedMotionPrefRef = useRef(reducedMotionPref);
  reducedMotionPrefRef.current = reducedMotionPref;
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;
  const coverSwipeStartRef = useRef<{ x: number; y: number } | null>(null);
  const sheetSwipeDownRef = useRef<{ y: number; x: number } | null>(null);
  const lastWholeSecRef = useRef<number>(Math.floor(initialPosSec));
  const lastLyricStateSyncMsRef = useRef<number>(0);
  const lastRenderedLyricIdxRef = useRef<number>(-1);
  const currentLyricsRef = useRef(currentLyrics);
  currentLyricsRef.current = currentLyrics;
  const lyricsStyleRef = useRef(lyricsStyle);
  lyricsStyleRef.current = lyricsStyle;
  const [lyricsStyleModalOpen, setLyricsStyleModalOpen] = useState(false);
  const prevTabForModalRef = useRef<string>(nowPlayingTab);
  const lyricsLongPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lyricsPointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const [smoothPosSec, setSmoothPosSec] = useState(initialPosSec);
  const [sheetDisplayDurSec, setSheetDisplayDurSec] = useState(durationSec);
  const [isRealFullscreen, setIsRealFullscreen] = useState(false);
  const [coverBrightness, setCoverBrightness] = useState(getLiveCoverBrightness);
  const [isLightBackdrop, setIsLightBackdrop] = useState(() =>
    shouldUseDarkInkOnBackdrop({
      ...getLiveCoverBrightness(),
      backdropStyle: nowPlayingBackdropStyle,
    })
  );

  useEffect(() => subscribeCoverBrightness(setCoverBrightness), []);

  useEffect(() => {
    setIsLightBackdrop((prev) =>
      shouldUseDarkInkOnBackdrop({
        perceptualLuma: coverBrightness.perceptualLuma,
        brightFraction: coverBrightness.brightFraction,
        backdropStyle: nowPlayingBackdropStyle,
        currentlyLight: prev,
      })
    );
  }, [coverBrightness, nowPlayingBackdropStyle]);

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

  useEffect(() => {
    if (!nowPlayingOpen || nowPlayingTab !== 'Letras') {
      setLyricsStyleModalOpen(false);
    }
    prevTabForModalRef.current = nowPlayingTab;
  }, [nowPlayingTab, nowPlayingOpen]);
  const [transportAnim, setTransportAnim] = useState<
    'prev' | 'next' | 'play' | 'shuffle' | 'repeat' | null
  >(null);
  const [heartBurstKey, setHeartBurstKey] = useState(0);

  const transportTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCrossfadedTrackIdRef = useRef<string | null>(null);
  const lyricsScrollResumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSheetBarPctRef = useRef<number>(0);
  const sheetDisplayDurSecRef = useRef<number>(durationSec);
  const lastSheetRewindAtMsRef = useRef<number>(0);
  const sheetBarRewindRef = useRef<{
    fromPct: number;
    startMs: number;
    durationMs: number;
  } | null>(null);
  const sheetManualSeekAtMsRef = useRef<number>(0);

  const [isMobileBackdrop, setIsMobileBackdrop] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    if (window.location?.hostname === 'appassets.pmusic.local') return true;
    return (
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(max-width: 767px), (hover: none) and (pointer: coarse)').matches
    );
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(max-width: 767px), (hover: none) and (pointer: coarse)');
    const update = () => {
      setIsMobileBackdrop(
        window.location?.hostname === 'appassets.pmusic.local' || mq.matches
      );
    };
    update();
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', update);
      return () => mq.removeEventListener('change', update);
    }
    return undefined;
  }, []);

  // Pre-warm pooled WebGL ink-bleed context & shaders during idle time after sheet opens (0ms t=0 crossfade stall!)
  useEffect(() => {
    if (reducedMotionPref) return;
    const timer = setTimeout(() => {
      warmUpInkBleedWebGL();
    }, 360);
    return () => clearTimeout(timer);
  }, [reducedMotionPref]);

  // Pause global inherited :root @property --pm-ambient-1/2/3 CSS transitions while fullscreen WebGL/Canvas backdrop is active
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const useCanvasBackdrop = nowPlayingBackdropStyle !== 'minimal';
    document.documentElement.classList.toggle('pm-np-canvas-open', useCanvasBackdrop);
    return () => {
      document.documentElement.classList.remove('pm-np-canvas-open');
    };
  }, [nowPlayingBackdropStyle]);

  const markLyricsUserScrolled = () => {
    setLyricsUserScrolled(true);
    if (lyricsScrollResumeTimerRef.current) clearTimeout(lyricsScrollResumeTimerRef.current);
    lyricsScrollResumeTimerRef.current = setTimeout(() => {
      setLyricsUserScrolled(false);
    }, 4500);
  };

  const triggerTransportAnim = (
    kind: 'prev' | 'next' | 'play' | 'shuffle' | 'repeat'
  ) => {
    setTransportAnim(null);
    if (transportTimerRef.current) clearTimeout(transportTimerRef.current);
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => {
        setTransportAnim(kind);
        transportTimerRef.current = setTimeout(() => setTransportAnim(null), 660);
      });
    } else {
      setTransportAnim(kind);
      transportTimerRef.current = setTimeout(() => setTransportAnim(null), 660);
    }
  };

  useEffect(() => {
    if (isTransitioning && incomingTransitionTrack) {
      lastCrossfadedTrackIdRef.current = incomingTransitionTrack.id;
    }
  }, [isTransitioning, incomingTransitionTrack]);

  const cfActiveBackdrop = Boolean(
    isTransitioning &&
      outgoingTransitionTrack &&
      incomingTransitionTrack &&
      outgoingTransitionTrack.id !== incomingTransitionTrack.id
  );
  const cfDurBackdropSec = Math.max(1.2, transitionDurationSec || 4);
  const targetBackdropUrl =
    cfActiveBackdrop && incomingTransitionTrack
      ? (incomingTransitionTrack.thumbnailHighUrl ?? incomingTransitionTrack.thumbnailUrl)
      : (currentTrack.thumbnailHighUrl ?? currentTrack.thumbnailUrl);

  const cfDurBackdropSecRef = useRef<number>(cfDurBackdropSec);
  cfDurBackdropSecRef.current = cfDurBackdropSec;

  useEffect(() => {
    if (targetBackdropUrl) {
      prefetchInkCoverImage(targetBackdropUrl);
      prefetchFluidBackdropCover(targetBackdropUrl);
    }
    if (cfActiveBackdrop && incomingTransitionTrack) {
      animateAmbientPaletteFromCover(
        incomingTransitionTrack,
        Math.round(cfDurBackdropSecRef.current * 1000)
      );
    }
  }, [cfActiveBackdrop, incomingTransitionTrack, targetBackdropUrl]);

  // Prefetch next queued track cover via ONE shared deduplicated CORS fetch into ink-bleed, WebGL fluid, exotic & palette caches
  // Skipped in 3G/EDGE Data-Saver mode ('low') to conserve cellular bandwidth
  useEffect(() => {
    if (streamQuality === 'low' || !nextPrefetchUrl || typeof Image === 'undefined') return;
    prefetchInkCoverImage(nextPrefetchUrl);
    prefetchFluidBackdropCover(nextPrefetchUrl);
    prefetchAmbientPaletteFromCover(nextPrefetchUrl);
  }, [nextPrefetchUrl, streamQuality]);

  useEffect(() => {
    if (
      nowPlayingOpen &&
      nowPlayingTab === 'Cola' &&
      needsRecommendedReplenish &&
      !isLoadingRecommendedQueue
    ) {
      void replenishRecommendedQueue();
    }
  }, [
    nowPlayingOpen,
    nowPlayingTab,
    needsRecommendedReplenish,
    isLoadingRecommendedQueue,
    replenishRecommendedQueue,
  ]);

  const syncClockRef = useRef({
    posSec: initialPosSec,
    renderedPosSec: initialPosSec,
    trackId: currentTrack.id,
    atMs: typeof performance !== 'undefined' ? performance.now() : 0,
  });
  const lyricClockRef = useRef({
    lastRawPos: initialPosSec,
    lastWallMs: typeof performance !== 'undefined' ? performance.now() : 0,
    smoothedPos: initialPosSec,
    trackId: currentTrack.id,
  });

  // Sync positionSec imperatively via Zustand subscribe (ZERO 1Hz React re-renders of NowPlayingSheet!)
  useEffect(() => {
    const syncPositionSnapshot = (
      posVal: number,
      trackIdVal: string,
      playingVal: boolean,
      durVal: number
    ) => {
      const now = typeof performance !== 'undefined' ? performance.now() : 0;
      const trackChanged = syncClockRef.current.trackId !== trackIdVal;
      const live = getLivePlaybackPosition();
      if (playingVal && live.isTransitioning && !trackChanged) {
        return;
      }
      const seekJumped = Math.abs(posVal - syncClockRef.current.renderedPosSec) > 0.85;
      const useIncoming = Boolean(
        live.isTransitioning &&
          live.transitionProgress01 >= 0.5 &&
          typeof live.incomingPositionSec === 'number' &&
          typeof live.incomingDurationSec === 'number' &&
          live.incomingDurationSec > 0
      );
      const effDur = useIncoming ? live.incomingDurationSec! : Math.max(1, durVal);
      if (Math.abs(sheetDisplayDurSecRef.current - effDur) > 0.5) {
        sheetDisplayDurSecRef.current = effDur;
        setSheetDisplayDurSec(effDur);
      }
      const basePos = useIncoming
        ? live.incomingPositionSec!
        : !playingVal && !trackChanged && !seekJumped && Number.isFinite(live.positionSec) && live.positionSec > 0
          ? Math.max(posVal, live.positionSec)
          : posVal;
      const clampedPos = Math.max(0, Math.min(effDur, basePos));
      syncClockRef.current.posSec = clampedPos;
      syncClockRef.current.atMs = now;
      syncClockRef.current.trackId = trackIdVal;
      if (trackChanged || seekJumped || !playingVal) {
        syncClockRef.current.renderedPosSec = clampedPos;
        lyricClockRef.current = {
          lastRawPos: clampedPos,
          lastWallMs: now,
          smoothedPos: clampedPos,
          trackId: trackIdVal,
        };
        lastWholeSecRef.current = Math.floor(clampedPos);
        if (nowPlayingTabRef.current === 'Letras' || trackChanged || !playingVal) {
          setSmoothPosSec(clampedPos);
        }
        const pct = Math.min(100, Math.max(0, (clampedPos / effDur) * 100));
        if (
          trackChanged &&
          !reducedMotionPrefRef.current &&
          now - sheetManualSeekAtMsRef.current > 350 &&
          now - lastSheetRewindAtMsRef.current > 900 &&
          !sheetBarRewindRef.current &&
          lastSheetBarPctRef.current - pct > 8
        ) {
          lastSheetRewindAtMsRef.current = now;
          sheetBarRewindRef.current = {
            fromPct: lastSheetBarPctRef.current,
            startMs: now,
            durationMs: 850,
          };
          if (sheetRewindGlowRef.current) {
            sheetRewindGlowRef.current.style.opacity = '1';
          }
        } else if (!sheetBarRewindRef.current) {
          lastSheetBarPctRef.current = pct;
          if (sheetFillRef.current) {
            sheetFillRef.current.style.transform = `translate3d(${(pct - 100).toFixed(4)}%, 0, 0)`;
          }
          if (sheetRewindGlowRef.current) {
            sheetRewindGlowRef.current.style.opacity = '0';
          }
          if (progressInputRef.current) {
            const nextMax = String(Math.max(1, Math.round(effDur)));
            const nextVal = String(
              Number(Math.min(effDur, Math.round(clampedPos * 10) / 10).toFixed(1))
            );
            if (progressInputRef.current.max !== nextMax) progressInputRef.current.max = nextMax;
            if (progressInputRef.current.value !== nextVal) progressInputRef.current.value = nextVal;
          }
        }
        if (progressTimeRef.current) {
          const txt = formatDurationSec(clampedPos);
          if (progressTimeRef.current.textContent !== txt) {
            progressTimeRef.current.textContent = txt;
          }
        }
        if (progressRemainRef.current) {
          const rightTxt = showRemainingTimeRef.current
            ? `-${formatDurationSec(Math.max(0, effDur - clampedPos))}`
            : formatDurationSec(effDur);
          if (progressRemainRef.current.textContent !== rightTxt) {
            progressRemainRef.current.textContent = rightTxt;
          }
        }
      }
    };

    const stInit = usePMusicStore.getState();
    syncPositionSnapshot(stInit.positionSec, stInit.currentTrack.id, stInit.isPlaying, stInit.durationSec);

    return usePMusicStore.subscribe((state, prevState) => {
      if (
        state.positionSec !== prevState.positionSec ||
        state.currentTrack.id !== prevState.currentTrack.id ||
        state.isPlaying !== prevState.isPlaying ||
        state.durationSec !== prevState.durationSec
      ) {
        syncPositionSnapshot(
          state.positionSec,
          state.currentTrack.id,
          state.isPlaying,
          state.durationSec
        );
      }
    });
  }, []);

  useEffect(() => {
    showRemainingTimeRef.current = showRemainingTime;
    const effDur = Math.max(1, sheetDisplayDurSecRef.current || durationSec);
    const cur = syncClockRef.current.renderedPosSec;
    if (progressRemainRef.current) {
      progressRemainRef.current.textContent = showRemainingTime
        ? `-${formatDurationSec(Math.max(0, effDur - cur))}`
        : formatDurationSec(effDur);
    }
  }, [showRemainingTime, durationSec, sheetDisplayDurSec]);

  useEffect(() => {
    if (isAppHidden || !nowPlayingOpen) return;
    const now = typeof performance !== 'undefined' ? performance.now() : 0;
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
      : Math.max(1, live.durationSec || sheetDurationSecRef.current);
    const rawPos = useIncoming
      ? live.incomingPositionSec!
      : Number.isFinite(live.positionSec)
        ? live.positionSec
        : syncClockRef.current.posSec;
    const clampedPos = Math.max(0, Math.min(effDur, rawPos));
    const pct = Math.min(100, Math.max(0, (clampedPos / effDur) * 100));

    sheetBarRewindRef.current = null;
    if (sheetRewindGlowRef.current) {
      sheetRewindGlowRef.current.style.opacity = '0';
    }
    sheetDisplayDurSecRef.current = effDur;
    setSheetDisplayDurSec(effDur);
    lastSheetBarPctRef.current = pct;
    if (sheetFillRef.current) {
      sheetFillRef.current.style.transform = `translate3d(${(pct - 100).toFixed(4)}%, 0, 0)`;
    }
    syncClockRef.current = {
      posSec: clampedPos,
      renderedPosSec: clampedPos,
      trackId: sheetTrackIdRef.current,
      atMs: now,
    };
    lyricClockRef.current = {
      lastRawPos: clampedPos,
      lastWallMs: now,
      smoothedPos: clampedPos,
      trackId: sheetTrackIdRef.current,
    };
    lastWholeSecRef.current = Math.floor(clampedPos);
    setSmoothPosSec(clampedPos);
    if (progressTimeRef.current) {
      progressTimeRef.current.textContent = formatDurationSec(clampedPos);
    }
    if (progressRemainRef.current) {
      progressRemainRef.current.textContent = showRemainingTimeRef.current
        ? `-${formatDurationSec(Math.max(0, effDur - clampedPos))}`
        : formatDurationSec(effDur);
    }
  }, [isAppHidden, nowPlayingOpen]);

  useEffect(() => {
    if (
      !nowPlayingOpen ||
      !isPlaying ||
      isAppHidden ||
      typeof requestAnimationFrame !== 'function'
    ) {
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
        : Math.max(1, live.durationSec || sheetDurationSecRef.current);
      if (Math.abs(sheetDisplayDurSecRef.current - effDur) > 0.5) {
        sheetDisplayDurSecRef.current = effDur;
        setSheetDisplayDurSec(effDur);
      }
      const rawPos = useIncoming
        ? live.incomingPositionSec!
        : Number.isFinite(live.positionSec)
          ? live.positionSec
          : syncClockRef.current.posSec;
      const rate = usePMusicStore.getState().playbackRate || 1.0;
      const activeTrackId = sheetTrackIdRef.current;
      const lClock = lyricClockRef.current;
      if (lClock.trackId !== activeTrackId || Math.abs(rawPos - lClock.smoothedPos) > 0.75) {
        lClock.trackId = activeTrackId;
        lClock.lastRawPos = rawPos;
        lClock.lastWallMs = now;
        lClock.smoothedPos = rawPos;
      } else {
        if (Math.abs(rawPos - lClock.lastRawPos) > 0.0005) {
          lClock.lastRawPos = rawPos;
          lClock.lastWallMs = now;
        }
        const extrapolated =
          rawPos + Math.min(0.22, Math.max(0, (now - lClock.lastWallMs) / 1000)) * rate;
        if (extrapolated >= lClock.smoothedPos) {
          lClock.smoothedPos = extrapolated;
        }
      }
      const rendered = Math.max(0, Math.min(effDur, lClock.smoothedPos));

      syncClockRef.current.renderedPosSec = rendered;
      const livePct = Math.min(100, Math.max(0, (rendered / effDur) * 100));
      if (
        !reducedMotionPrefRef.current &&
        now - sheetManualSeekAtMsRef.current > 350 &&
        now - lastSheetRewindAtMsRef.current > 900 &&
        !sheetBarRewindRef.current &&
        lastSheetBarPctRef.current - livePct > 8
      ) {
        lastSheetRewindAtMsRef.current = now;
        sheetBarRewindRef.current = {
          fromPct: lastSheetBarPctRef.current,
          startMs: now,
          durationMs: 850,
        };
        if (sheetRewindGlowRef.current) {
          sheetRewindGlowRef.current.style.opacity = '1';
        }
      }

      let visualPct = livePct;
      if (sheetBarRewindRef.current) {
        const elapsed = now - sheetBarRewindRef.current.startMs;
        const t = Math.max(0, Math.min(1, elapsed / sheetBarRewindRef.current.durationMs));
        const ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
        visualPct =
          sheetBarRewindRef.current.fromPct +
          (livePct - sheetBarRewindRef.current.fromPct) * ease;
        if (t >= 1) {
          sheetBarRewindRef.current = null;
          visualPct = livePct;
          if (sheetRewindGlowRef.current) {
            sheetRewindGlowRef.current.style.opacity = '0';
          }
        }
      } else {
        const prevPct = lastSheetBarPctRef.current;
        if (Math.abs(livePct - prevPct) > 4 || Math.abs(livePct - prevPct) < 0.002) {
          visualPct = livePct;
        } else {
          visualPct = prevPct + (livePct - prevPct) * (1 - Math.exp(-dtSec * 22));
        }
      }
      lastSheetBarPctRef.current = visualPct;

      if (sheetFillRef.current) {
        sheetFillRef.current.style.transform = `translate3d(${(visualPct - 100).toFixed(4)}%, 0, 0)`;
      }
      if (progressInputRef.current && !sheetBarRewindRef.current) {
        const roundedMax = String(Math.max(1, Math.round(effDur)));
        if (progressInputRef.current.max !== roundedMax) {
          progressInputRef.current.max = roundedMax;
        }
        const nextRangeVal = String(
          Number(Math.min(effDur, Math.round(((visualPct / 100) * effDur) * 10) / 10).toFixed(1))
        );
        if (progressInputRef.current.value !== nextRangeVal) {
          progressInputRef.current.value = nextRangeVal;
        }
      }
      if (progressTimeRef.current) {
        const txt = formatDurationSec(rendered);
        if (progressTimeRef.current.textContent !== txt) {
          progressTimeRef.current.textContent = txt;
        }
      }
      if (progressRemainRef.current) {
        const rightTxt = showRemainingTimeRef.current
          ? `-${formatDurationSec(Math.max(0, effDur - rendered))}`
          : formatDurationSec(effDur);
        if (progressRemainRef.current.textContent !== rightTxt) {
          progressRemainRef.current.textContent = rightTxt;
        }
      }

      if (nowPlayingTabRef.current === 'Letras') {
        const docs = currentLyricsRef.current;
        let curLineIdx = -1;
        if (docs && docs.status === 'synced' && docs.lines.length > 0) {
          const targetMs = rendered * 1000 + 120;
          for (let i = 0; i < docs.lines.length; i++) {
            if (docs.lines[i]!.timeMs <= targetMs) curLineIdx = i;
            else break;
          }
        }

        // Direct 60-120fps DOM sweep for classic Apple Music Sing mode (cached NodeList, zero querySelectorAll spam)
        if (
          lyricsStyleRef.current === 'classic' &&
          docs &&
          docs.status === 'synced' &&
          docs.lines.length > 0 &&
          activeLyricRef.current
        ) {
          const idxForSweep =
            curLineIdx >= 0
              ? curLineIdx
              : (docs.lines[0]?.timeMs ?? 0) <= 4000
                ? 0
                : -1;
          const activeLineObj = idxForSweep >= 0 ? docs.lines[idxForSweep] : undefined;
          if (activeLineObj) {
            const nextLineObj = docs.lines[idxForSweep + 1];
            const lineEndMs =
              nextLineObj && nextLineObj.timeMs > activeLineObj.timeMs
                ? nextLineObj.timeMs
                : activeLineObj.timeMs + 4200;
            const spanMs = Math.max(800, lineEndMs - activeLineObj.timeMs);
            const vocalSpanMs = Math.min(
              spanMs * 0.92,
              Math.max(1100, activeLineObj.text.length * 90)
            );
            const vp01 = Math.max(
              0,
              Math.min(1, (rendered * 1000 - activeLineObj.timeMs) / vocalSpanMs)
            );
            if (
              cachedSingLineElRef.current !== activeLyricRef.current ||
              !cachedSingLineElRef.current?.isConnected
            ) {
              cachedSingLineElRef.current = activeLyricRef.current;
              cachedSingSpansRef.current =
                activeLyricRef.current.querySelectorAll<HTMLElement>('.pm-sing-word');
            }
            const spans = cachedSingSpansRef.current;
            if (spans) {
              for (let s = 0; s < spans.length; s++) {
                const el = spans[s]!;
                const wStart = Number(el.dataset.wStart ?? '0');
                const wEnd = Number(el.dataset.wEnd ?? '1');
                const wp = Math.max(
                  0,
                  Math.min(1, (vp01 - wStart) / Math.max(0.01, wEnd - wStart))
                );
                const wordState =
                  wp <= 0.002 ? 'upcoming' : wp >= 0.998 ? 'sung' : 'active';
                const prevWordState = el.dataset.wordState;
                if (prevWordState === wordState && wordState !== 'active') {
                  continue;
                }
                const bgPos = wordState === 'upcoming' ? 100 : wordState === 'sung' ? 0 : (1 - wp) * 100;
                const prevBgPos = Number(el.dataset.lastBgPos ?? '-999');
                if (prevWordState === wordState && Math.abs(bgPos - prevBgPos) < 0.45) {
                  continue;
                }
                if (prevWordState !== wordState) {
                  el.dataset.wordState = wordState;
                }
                el.dataset.lastBgPos = bgPos.toFixed(1);
                el.style.setProperty('--word-bg-pos', `${bgPos.toFixed(2)}%`);
                const wave = wordState === 'active' ? Math.sin(wp * Math.PI) : 0;
                const lift = wordState === 'upcoming' ? 0 : wordState === 'sung' ? -1 : -(1 + 2.6 * wave);
                const scale = wordState === 'active' ? 1 + 0.032 * wave : 1;
                el.style.setProperty('--word-y', `${lift.toFixed(2)}px`);
                el.style.setProperty('--word-scale', scale.toFixed(4));
              }
            }
          }
        }

        const lineChanged = curLineIdx !== lastRenderedLyricIdxRef.current;
        const isAnimatedNonClassic =
          lyricsStyleRef.current === 'wordflow' ||
          lyricsStyleRef.current === 'typewriter' ||
          lyricsStyleRef.current === 'neon' ||
          lyricsStyleRef.current === 'poster';
        const isAnimDue =
          isAnimatedNonClassic && now - lastLyricStateSyncMsRef.current >= 40;
        const introGapActive =
          Boolean(docs?.lines[0] && docs.lines[0].timeMs > 4000 && rendered * 1000 < docs.lines[0].timeMs);
        const activeLineForGap = curLineIdx >= 0 ? docs?.lines[curLineIdx] : undefined;
        const nextLineForGap = curLineIdx >= 0 ? docs?.lines[curLineIdx + 1] : undefined;
        const midGapJustCrossed = Boolean(
          activeLineForGap &&
            nextLineForGap &&
            nextLineForGap.timeMs - activeLineForGap.timeMs > 6500 &&
            rendered * 1000 - activeLineForGap.timeMs > 3200 &&
            (lastWholeSecRef.current * 1000 - activeLineForGap.timeMs <= 3200)
        );
        const wholeChanged =
          (introGapActive && Math.floor(rendered) !== lastWholeSecRef.current) ||
          midGapJustCrossed;

        if (lineChanged || isAnimDue || wholeChanged) {
          lastRenderedLyricIdxRef.current = curLineIdx;
          lastLyricStateSyncMsRef.current = now;
          lastWholeSecRef.current = Math.floor(rendered);
          setSmoothPosSec(rendered);
        }
      } else {
        const whole = Math.floor(rendered);
        if (whole !== lastWholeSecRef.current) {
          lastWholeSecRef.current = whole;
        }
      }
      rafId = requestAnimationFrame(step);
    };
    rafId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafId);
  }, [nowPlayingOpen, isPlaying, isAppHidden]);

  useEffect(() => {
    if (!isElectronDesktop) return;
    const def = getThemeDefinition(themeId);
    void setDesktopTitleBarOverlay({
      color: nowPlayingOpen ? '#00000000' : def.titleBarColor,
      symbolColor: nowPlayingOpen ? '#F5F5F7' : def.titleBarSymbolColor,
      height: 48,
    });
    return () => {
      void setDesktopTitleBarOverlay({
        color: def.titleBarColor,
        symbolColor: def.titleBarSymbolColor,
        height: 48,
      });
    };
  }, [isElectronDesktop, nowPlayingOpen, themeId]);

  const smoothPosMs = smoothPosSec * 1000;
  let liveLyricIdx = -1;
  if (currentLyrics && currentLyrics.status === 'synced' && currentLyrics.lines.length > 0) {
    for (let i = 0; i < currentLyrics.lines.length; i++) {
      if (currentLyrics.lines[i]!.timeMs <= smoothPosMs + 120) {
        liveLyricIdx = i;
      } else {
        break;
      }
    }
  }
  const storeActiveLyricIndex = usePMusicStore.getState().activeLyricIndex;
  const resolvedActiveLyricIdx =
    currentLyrics && currentLyrics.lines.length > 0
      ? liveLyricIdx >= 0
        ? liveLyricIdx
        : storeActiveLyricIndex >= 0
          ? storeActiveLyricIndex
          : 0
      : -1;

  useEffect(() => {
    if (sheetRootRef.current) {
      sheetRootRef.current.scrollTop = 0;
      sheetRootRef.current.scrollLeft = 0;
    }
    if (
      nowPlayingOpen &&
      nowPlayingTab === 'Letras' &&
      !lyricsUserScrolled &&
      lyricsContainerRef.current &&
      activeLyricRef.current
    ) {
      const container = lyricsContainerRef.current;
      const activeEl = activeLyricRef.current;
      const containerRect = container.getBoundingClientRect();
      const activeRect = activeEl.getBoundingClientRect();
      const offsetWithinContainer = activeRect.top - containerRect.top + container.scrollTop;
      const targetTop = Math.max(
        0,
        offsetWithinContainer - container.clientHeight * 0.42 + activeRect.height * 0.5
      );
      if (typeof container.scrollTo === 'function') {
        container.scrollTo({
          top: targetTop,
          behavior: reducedMotionPref ? 'auto' : 'smooth',
        });
      } else {
        container.scrollTop = targetTop;
      }
    }
  }, [
    nowPlayingOpen,
    nowPlayingTab,
    resolvedActiveLyricIdx,
    lyricsUserScrolled,
    reducedMotionPref,
  ]);

  if (!nowPlayingOpen) return null;

  const activeSheetDurSec = Math.max(1, sheetDisplayDurSec || durationSec);
  const liveRenderPosSec =
    nowPlayingTab === 'Letras'
      ? smoothPosSec
      : Math.max(0, Math.min(activeSheetDurSec, syncClockRef.current.renderedPosSec));
  const progressPct = Math.max(
    0,
    Math.min(100, (liveRenderPosSec / activeSheetDurSec) * 100)
  );
  const activeSheetFillPct = sheetBarRewindRef.current
    ? lastSheetBarPctRef.current
    : progressPct;
  const volumePct = Math.round(volume * 100);
  const cueStartPct =
    djMode.enabled && activeTransitionPlan && activeSheetDurSec > 10
      ? Math.max(0, Math.min(96, (activeTransitionPlan.cueOutSec / activeSheetDurSec) * 100))
      : null;
  const cueWidthPct =
    djMode.enabled && activeTransitionPlan && activeSheetDurSec > 10
      ? Math.max(
          2.5,
          Math.min(
            100 - (cueStartPct ?? 0),
            (activeTransitionPlan.transitionDurationSec / activeSheetDurSec) * 100
          )
        )
      : 0;
  const unplayedCueStartPct =
    cueStartPct !== null ? Math.max(cueStartPct, progressPct) : null;
  const unplayedCueWidthPct =
    cueStartPct !== null && unplayedCueStartPct !== null
      ? Math.max(0, cueStartPct + cueWidthPct - unplayedCueStartPct)
      : 0;
  const repeatLabel =
    repeatMode === 'one'
      ? 'Repetir esta canción (siguiente: desactivar)'
      : repeatMode === 'all'
        ? 'Repetir playlist (siguiente: repetir una)'
        : 'Activar repetición de playlist';

  const remainingSec = Math.max(0, activeSheetDurSec - liveRenderPosSec);
  const cfActive = Boolean(
    isTransitioning &&
      outgoingTransitionTrack &&
      incomingTransitionTrack &&
      outgoingTransitionTrack.id !== incomingTransitionTrack.id
  );
  const cfAnimDurationSec = Math.max(1.2, transitionDurationSec || 4);

  const incomingPreviewTrack =
    djMode.enabled &&
    isTransitioning &&
    incomingTransitionTrack &&
    incomingTransitionTrack.id !== currentTrack.id
      ? incomingTransitionTrack
      : null;

  const isPostCrossfadeSameTrack = lastCrossfadedTrackIdRef.current === currentTrack.id;
  const skipCoverForSameAlbum = Boolean(
    skipSameAlbumCoverTransition &&
      isSameAlbumOrCover(outgoingTransitionTrack, incomingTransitionTrack)
  );
  const showInkCoverTransition = Boolean(
    cfActive &&
      outgoingTransitionTrack &&
      incomingTransitionTrack &&
      !skipCoverForSameAlbum &&
      !reducedMotionPref
  );

  const PlayerDeckColumn = (compact = false) => (
    <div
      className={`flex flex-col items-center ${
        compact
          ? 'w-full gap-3 xl:gap-3.5'
          : 'mx-auto flex h-full w-full max-w-[420px] justify-evenly gap-2 pb-2 md:h-auto md:justify-center md:gap-4 md:py-0'
      }`}
    >
      {/* Large Borderless Centerpiece Artwork with pMusic Fractal Ink-Bleed Transition (Permanent Stage Key: Zero Cut at t=0) */}
      <div
        key="np-cover-stage"
        onTouchStart={(e) => {
          if (isGuestInJam) return;
          const t = e.touches[0];
          if (t) coverSwipeStartRef.current = { x: t.clientX, y: t.clientY };
        }}
        onTouchEnd={(e) => {
          if (isGuestInJam) {
            coverSwipeStartRef.current = null;
            return;
          }
          const start = coverSwipeStartRef.current;
          coverSwipeStartRef.current = null;
          const t = e.changedTouches[0];
          if (!start || !t) return;
          const dx = t.clientX - start.x;
          const dy = t.clientY - start.y;
          if (Math.abs(dx) > 52 && Math.abs(dx) > Math.abs(dy) * 1.2) {
            if (dx < 0) {
              triggerTransportAnim('next');
              void nextTrack();
            } else {
              triggerTransportAnim('prev');
              void prevTrack();
            }
          }
        }}
        className={`${
          cfActive || isPostCrossfadeSameTrack
            ? ''
            : lastTrackDirection === 'prev'
              ? 'pm-cover-slide-prev'
              : 'pm-cover-slide-next'
        } relative aspect-square overflow-hidden rounded-[16px] bg-[#111115] shadow-[0_26px_64px_rgba(0,0,0,0.58)] transition-transform duration-300 ease-out ${
          compact
            ? 'w-[min(68vw,320px,36dvh)] xl:w-[min(68vw,346px,38dvh)]'
            : 'w-[min(78vw,316px,35dvh)] md:w-[min(74vw,340px,38dvh)] xl:w-[min(74vw,380px,42dvh)]'
        } ${isPlaying ? 'scale-100' : 'scale-[0.96]'}`}
      >
        <TrackArtwork
          trackId={currentTrack.id}
          src={currentTrack.thumbnailHighUrl ?? currentTrack.thumbnailUrl}
          title={currentTrack.title}
          artistName={currentTrack.artists[0]?.name}
          artistId={currentTrack.artists[0]?.id}
          alt={currentTrack.title}
          variant="nowplaying"
          loading="eager"
          imgClassName="h-full w-full scale-100 object-cover opacity-100"
        />
        {showInkCoverTransition && outgoingTransitionTrack && incomingTransitionTrack && (
          <div className="pointer-events-none absolute inset-0 z-10">
            <InkBleedCoverTransition
              outgoingUrl={
                outgoingTransitionTrack.thumbnailHighUrl ?? outgoingTransitionTrack.thumbnailUrl
              }
              outgoingTitle={outgoingTransitionTrack.title}
              incomingUrl={
                incomingTransitionTrack.thumbnailHighUrl ?? incomingTransitionTrack.thumbnailUrl
              }
              incomingTitle={incomingTransitionTrack.title}
              seedKey={`${outgoingTransitionTrack.id}:${incomingTransitionTrack.id}`}
              durationSec={cfAnimDurationSec}
            />
          </div>
        )}
      </div>

      {/* Minimalist Title, Full Multi-Artist Line & Borderless Actions (Permanent Stage Key: Zero Cut at t=0) */}
      <div
        key="np-meta-stage"
        className={`${cfActive || isPostCrossfadeSameTrack ? '' : 'pm-track-meta-in'} flex w-full flex-col gap-0`}
      >
        {cfActive && outgoingTransitionTrack && incomingTransitionTrack && !reducedMotionPref ? (
          <>
            <div className="flex h-[30px] w-full items-center justify-between gap-2">
              <div className="relative h-[30px] min-w-0 flex-1 overflow-hidden">
                <h1
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 flex h-[30px] items-center truncate text-[21px] font-bold leading-[1.12] tracking-tight text-white md:text-[23px]"
                  style={{
                    animation: `pmMetaBlurOut ${cfAnimDurationSec}s ease-in-out forwards`,
                  }}
                >
                  {outgoingTransitionTrack.title}
                </h1>
                <h1
                  className="flex h-[30px] items-center truncate text-[21px] font-bold leading-[1.12] tracking-tight text-white md:text-[23px]"
                  style={{
                    animation: `pmMetaBlurIn ${cfAnimDurationSec}s ease-in-out forwards`,
                  }}
                >
                  {incomingTransitionTrack.title}
                </h1>
              </div>

              <div className="flex shrink-0 items-center gap-0.5">
                <button
                  type="button"
                  aria-label={isLiked ? 'Quitar de Me gusta' : 'Añadir a Me gusta'}
                  aria-pressed={isLiked}
                  onClick={() => void toggleLike(currentTrack)}
                  className={`pm-pressable relative flex h-8 w-8 items-center justify-center rounded-full transition-colors hover:bg-white/[0.10] ${
                    isLiked ? 'text-[#FB7185]' : 'text-white/85 hover:text-white'
                  }`}
                >
                  <LiquidHeartIcon liked={isLiked} className="h-5 w-5" />
                </button>
                <button
                  type="button"
                  aria-label={
                    dlStatus === 'downloaded'
                      ? 'Descargada offline'
                      : 'Descargar para escuchar offline'
                  }
                  onClick={() => void downloadTrackOffline(currentTrack)}
                  className="pm-pressable flex h-8 w-8 items-center justify-center rounded-full text-white/80 transition-colors hover:bg-white/[0.10] hover:text-white"
                >
                  {dlStatus === 'downloading' ? (
                    <Loader2 className="h-4.5 w-4.5 animate-spin text-white" />
                  ) : dlStatus === 'downloaded' ? (
                    <Check className="h-4.5 w-4.5 text-[#34D399]" />
                  ) : (
                    <Download className="h-4.5 w-4.5" />
                  )}
                </button>
                <button
                  type="button"
                  aria-label={`Más opciones para ${currentTrack.title}`}
                  onClick={(e) => {
                    const r = e.currentTarget.getBoundingClientRect();
                    openTrackMenu(currentTrack, r.left - 210, r.bottom + 8);
                  }}
                  className="pm-pressable flex h-8 w-8 items-center justify-center rounded-full text-white/85 transition-colors hover:bg-white/[0.10] hover:text-white"
                >
                  <MoreHorizontal className="h-5 w-5" />
                </button>
              </div>
            </div>

            <div className="relative h-[20px] w-full overflow-hidden text-[14px] leading-[1.2] text-white/70">
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 flex items-center gap-x-1.5 whitespace-nowrap"
                style={{
                  animation: `pmMetaBlurOut ${cfAnimDurationSec}s ease-in-out forwards`,
                }}
              >
                <span className="truncate">
                  {outgoingTransitionTrack.artists.map((a) => a.name).join(', ')}
                </span>
                {outgoingTransitionTrack.album && outgoingTransitionTrack.artists.length <= 2 && (
                  <>
                    <span aria-hidden="true" className="opacity-50">
                      ·
                    </span>
                    <span className="min-w-0 truncate text-white/55">
                      {outgoingTransitionTrack.album.name}
                    </span>
                  </>
                )}
              </div>
              <div
                className="flex h-[20px] items-center gap-x-1.5 whitespace-nowrap"
                style={{
                  animation: `pmMetaBlurIn ${cfAnimDurationSec}s ease-in-out forwards`,
                }}
              >
                <span className="truncate">
                  {incomingTransitionTrack.artists.map((a) => a.name).join(', ')}
                </span>
                {incomingTransitionTrack.album && incomingTransitionTrack.artists.length <= 2 && (
                  <>
                    <span aria-hidden="true" className="opacity-50">
                      ·
                    </span>
                    <span className="min-w-0 truncate text-white/55">
                      {incomingTransitionTrack.album.name}
                    </span>
                  </>
                )}
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="flex h-[30px] w-full items-center justify-between gap-2">
              <MarqueeText
                disabled={!marqueeTextEnabled || reducedMotionPref || cfActive}
                testId="np-title-marquee"
                className="flex h-[30px] min-w-0 flex-1 items-center"
              >
                <h1 className="text-[21px] font-bold leading-[1.12] tracking-tight text-white md:text-[23px]">
                  {currentTrack.title}
                </h1>
              </MarqueeText>

              <div className="flex shrink-0 items-center gap-0.5">
                <button
                  type="button"
                  aria-label={isLiked ? 'Quitar de Me gusta' : 'Añadir a Me gusta'}
                  aria-pressed={isLiked}
                  onClick={() => {
                    if (!isLiked && !reducedMotionPref) {
                      setHeartBurstKey((k) => k + 1);
                    }
                    void toggleLike(currentTrack);
                  }}
                  className={`pm-pressable relative flex h-8 w-8 items-center justify-center overflow-visible rounded-full transition-colors hover:bg-white/[0.10] ${
                    isLiked ? 'text-[#FB7185]' : 'text-white/85 hover:text-white'
                  }`}
                >
                  <LiquidHeartIcon
                    key={`deck-heart-${heartBurstKey}-${isLiked}`}
                    liked={isLiked}
                    className={`h-5 w-5 ${
                      isLiked && heartBurstKey > 0 && !reducedMotionPref ? 'pm-heart-burst-epic' : ''
                    }`}
                  />
                  {isLiked &&
                    heartBurstKey > 0 &&
                    !reducedMotionPref &&
                    [
                      { sx: '0px', sy: '-20px', c: '#FB7185' },
                      { sx: '17px', sy: '-10px', c: '#F9A8D4' },
                      { sx: '17px', sy: '10px', c: '#FDE047' },
                      { sx: '0px', sy: '20px', c: '#FB7185' },
                      { sx: '-17px', sy: '10px', c: '#F9A8D4' },
                      { sx: '-17px', sy: '-10px', c: '#FDE047' },
                    ].map((sp, spIdx) => (
                      <span
                        key={`deck-sp-${heartBurstKey}-${spIdx}`}
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

                <button
                  type="button"
                  aria-label={
                    dlStatus === 'downloaded'
                      ? 'Descargada offline'
                      : 'Descargar para escuchar offline'
                  }
                  onClick={() => void downloadTrackOffline(currentTrack)}
                  className="pm-pressable flex h-8 w-8 items-center justify-center rounded-full text-white/80 transition-colors hover:bg-white/[0.10] hover:text-white"
                >
                  {dlStatus === 'downloading' ? (
                    <Loader2 className="h-4.5 w-4.5 animate-spin text-white" />
                  ) : dlStatus === 'downloaded' ? (
                    <Check className="h-4.5 w-4.5 text-[#34D399]" />
                  ) : (
                    <Download className="h-4.5 w-4.5" />
                  )}
                </button>

                <button
                  type="button"
                  aria-label={`Más opciones para ${currentTrack.title}`}
                  onClick={(e) => {
                    const r = e.currentTarget.getBoundingClientRect();
                    openTrackMenu(currentTrack, r.left - 210, r.bottom + 8);
                  }}
                  className="pm-pressable flex h-8 w-8 items-center justify-center rounded-full text-white/85 transition-colors hover:bg-white/[0.10] hover:text-white"
                >
                  <MoreHorizontal className="h-5 w-5" />
                </button>
              </div>
            </div>

            {/* Full-Width Artist · Album Line with Ping-Pong Marquee when overflowing */}
            <MarqueeText
              disabled={!marqueeTextEnabled || reducedMotionPref || cfActive}
              testId="np-artist-marquee"
              className="flex h-[20px] w-full items-center text-[14px] leading-[1.2] text-white/70"
            >
              <div className="inline-flex items-center gap-x-1.5 whitespace-nowrap">
                <ArtistLinks
                  artists={currentTrack.artists}
                  className="inline-flex whitespace-nowrap !py-0 !leading-[1.2]"
                  onBeforeNavigate={() => setNowPlayingOpen(false)}
                  linkClassName="hover:text-white hover:underline"
                />
                {currentTrack.album && currentTrack.artists.length <= 2 && (
                  <>
                    <span aria-hidden="true" className="opacity-50">
                      ·
                    </span>
                    <span
                      role="link"
                      tabIndex={0}
                      onClick={() => {
                        const album = currentTrack.album;
                        setNowPlayingOpen(false);
                        if (album?.id) {
                          void openAlbumDetail(album.id, {
                            title: album.name,
                            artist: currentTrack.artists[0]?.name,
                          });
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          const album = currentTrack.album;
                          setNowPlayingOpen(false);
                          if (album?.id) {
                            void openAlbumDetail(album.id, {
                              title: album.name,
                              artist: currentTrack.artists[0]?.name,
                            });
                          }
                        }
                      }}
                      className="cursor-pointer text-left text-white/55 hover:text-white hover:underline"
                    >
                      {currentTrack.album.name}
                    </span>
                  </>
                )}
              </div>
            </MarqueeText>
          </>
        )}
      </div>

      {/* Thin Apple Music GPU-Composited Pill Progress Bar + Clickable Remaining Time */}
      <div className="w-full space-y-1">
        <div className="group relative flex h-[18px] w-full items-center">
          <div
            aria-hidden="true"
            className="pointer-events-none relative h-[6px] w-full overflow-hidden rounded-full bg-white/18 transition-[height] duration-150 group-hover:h-[8px]"
          >
            <div
              ref={sheetFillRef}
              data-testid="nowplaying-progress-fill"
              className="relative h-full w-full rounded-full bg-white/92 will-change-transform"
              style={{
                transform: `translate3d(${(activeSheetFillPct - 100).toFixed(4)}%, 0, 0)`,
              }}
            >
              <span
                ref={sheetRewindGlowRef}
                aria-hidden="true"
                className="pm-sheet-recede-glow pointer-events-none absolute inset-y-0 right-0 w-10 rounded-full opacity-0 transition-opacity duration-200"
              />
            </div>
            {unplayedCueStartPct !== null && unplayedCueWidthPct > 0 && (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-0 rounded-full bg-[#C084FC]/80"
                style={{
                  left: `${unplayedCueStartPct}%`,
                  width: `${unplayedCueWidthPct}%`,
                }}
              />
            )}
          </div>
          <input
            ref={progressInputRef}
            type="range"
            role="slider"
            aria-label="Progreso de la canción"
            disabled={isGuestInJam}
            min={0}
            max={Math.max(1, Math.round(activeSheetDurSec))}
            step={0.1}
            value={Number(
              Math.min(
                activeSheetDurSec,
                Math.round(((activeSheetFillPct / 100) * activeSheetDurSec) * 10) / 10
              ).toFixed(1)
            )}
            onChange={(e) => {
              if (isGuestInJam) return;
              const effDur = activeSheetDurSec;
              const next = Math.max(0, Math.min(effDur, Number(e.target.value)));
              const pct = Math.min(100, Math.max(0, (next / effDur) * 100));
              sheetManualSeekAtMsRef.current =
                typeof performance !== 'undefined' ? performance.now() : Date.now();
              sheetBarRewindRef.current = null;
              lastSheetBarPctRef.current = pct;
              if (sheetFillRef.current) {
                sheetFillRef.current.style.transform = `translate3d(${(pct - 100).toFixed(4)}%, 0, 0)`;
              }
              if (sheetRewindGlowRef.current) {
                sheetRewindGlowRef.current.style.opacity = '0';
              }
              if (progressInputRef.current) {
                progressInputRef.current.value = String(Number(next.toFixed(1)));
              }
              if (progressTimeRef.current) {
                progressTimeRef.current.textContent = formatDurationSec(next);
              }
              if (progressRemainRef.current) {
                progressRemainRef.current.textContent = showRemainingTimeRef.current
                  ? `-${formatDurationSec(Math.max(0, effDur - next))}`
                  : formatDurationSec(effDur);
              }
              lastWholeSecRef.current = Math.floor(next);
              syncClockRef.current.renderedPosSec = next;
              syncClockRef.current.posSec = next;
              lyricClockRef.current = {
                lastRawPos: next,
                lastWallMs: typeof performance !== 'undefined' ? performance.now() : 0,
                smoothedPos: next,
                trackId: currentTrack.id,
              };
              setSmoothPosSec(next);
              seekTo(next);
            }}
            className={`pm-range-gpu-overlay absolute inset-0 z-10 h-full w-full ${
              isGuestInJam ? 'cursor-not-allowed opacity-70' : 'cursor-pointer'
            }`}
          />
        </div>
        <div className="tabular-nums flex items-center justify-between text-[11px] font-medium text-white/60">
          <span ref={progressTimeRef}>{formatDurationSec(liveRenderPosSec)}</span>
          {djMode.enabled && isTransitioning ? (
            <span className="font-sans text-[10px] font-semibold tracking-[0.14em] text-purple-300/90 animate-pulse">
              MEZCLANDO · DJ
            </span>
          ) : null}
          <button
            type="button"
            aria-label="Alternar tiempo restante y duración total"
            onClick={() => setShowRemainingTime(!showRemainingTime)}
            className="tabular-nums text-right text-[11px] font-medium text-white/60 transition-colors hover:text-white"
          >
            <span ref={progressRemainRef}>
              {showRemainingTime
                ? `-${formatDurationSec(remainingSec)}`
                : formatDurationSec(activeSheetDurSec)}
            </span>
          </button>
        </div>
      </div>

      {/* Pure Minimalist Centered Borderless Transport Row (Exact 5 icons matching desktop) */}
      <div className="mx-auto grid w-full max-w-[340px] grid-cols-5 place-items-center py-0">
        <button
          type="button"
          disabled={isGuestInJam}
          aria-label={
            shuffleEnabled
              ? 'Desactivar reproducción aleatoria'
              : 'Activar reproducción aleatoria'
          }
          aria-pressed={shuffleEnabled}
          onClick={() => {
            triggerTransportAnim('shuffle');
            toggleShuffle();
          }}
          className={`pm-pressable relative flex h-7 w-7 items-center justify-center overflow-visible bg-transparent transition-transform duration-150 focus:outline-none md:h-9 md:w-9 ${
            isGuestInJam ? 'cursor-not-allowed opacity-40' : 'hover:scale-110'
          } ${
            shuffleEnabled
              ? 'text-white'
              : 'text-white/55 hover:text-white'
          }`}
        >
          <AnimatedShuffleIcon
            className="h-[14px] w-[14px] md:h-[18px] md:w-[18px]"
            animate={transportAnim === 'shuffle' && !reducedMotionPref}
          />
          {shuffleEnabled && (
            <span
              aria-hidden="true"
              className="pm-indicator-dot absolute bottom-0.5 h-1 w-1 rounded-full bg-white"
            />
          )}
        </button>

        <button
          type="button"
          disabled={isGuestInJam}
          aria-label="Canción anterior"
          onClick={() => {
            triggerTransportAnim('prev');
            void prevTrack();
          }}
          className={`pm-pressable relative flex h-12 w-12 items-center justify-center overflow-visible bg-transparent text-white/90 transition-transform duration-150 focus:outline-none ${
            isGuestInJam ? 'cursor-not-allowed opacity-40' : 'hover:scale-110 hover:text-white active:scale-90'
          }`}
        >
          <AnimatedSkipBackIcon
            className="h-8 w-8"
            filled
            animate={transportAnim === 'prev' && !reducedMotionPref}
          />
        </button>

        <button
          type="button"
          disabled={isGuestInJam}
          data-testid="nowplaying-play-btn"
          aria-label={showBuffering ? 'Cargando canción' : isPlaying ? 'Pausar' : 'Reproducir'}
          onClick={() => {
            triggerTransportAnim('play');
            void togglePlayPause();
          }}
          className={`pm-pressable relative flex h-16 w-16 items-center justify-center overflow-visible bg-transparent text-white outline-none ring-0 transition-transform duration-200 focus:outline-none ${
            isGuestInJam ? 'cursor-not-allowed opacity-45' : 'hover:scale-105 active:scale-90'
          }`}
        >
          {showBuffering ? (
            <Loader2 data-testid="nowplaying-play-loader" className="h-10 w-10 animate-spin text-white/95" />
          ) : (
            <>
              <RoundedPauseIcon
                className={`absolute h-[52px] w-[52px] drop-shadow-[0_4px_14px_rgba(0,0,0,0.34)] transition-all duration-200 ease-out ${
                  isPlaying
                    ? 'scale-100 rotate-0 opacity-100 blur-0'
                    : 'scale-50 rotate-90 opacity-0 blur-[1px]'
                }`}
              />
              <RoundedPlayIcon
                className={`absolute h-[52px] w-[52px] translate-x-[2px] drop-shadow-[0_4px_14px_rgba(0,0,0,0.34)] transition-all duration-200 ease-out ${
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
          disabled={isGuestInJam}
          aria-label="Siguiente canción"
          onClick={() => {
            triggerTransportAnim('next');
            void nextTrack();
          }}
          className={`pm-pressable relative flex h-12 w-12 items-center justify-center overflow-visible bg-transparent text-white/90 transition-transform duration-150 focus:outline-none ${
            isGuestInJam ? 'cursor-not-allowed opacity-40' : 'hover:scale-110 hover:text-white active:scale-90'
          }`}
        >
          <AnimatedSkipForwardIcon
            className="h-8 w-8"
            filled
            animate={transportAnim === 'next' && !reducedMotionPref}
          />
        </button>

        <button
          type="button"
          disabled={isGuestInJam}
          aria-label={repeatLabel}
          aria-pressed={repeatMode !== 'off'}
          onClick={() => {
            triggerTransportAnim('repeat');
            cycleRepeatMode();
          }}
          className={`pm-pressable relative flex h-7 w-7 items-center justify-center bg-transparent transition-transform duration-150 focus:outline-none md:h-9 md:w-9 ${
            isGuestInJam ? 'cursor-not-allowed opacity-40' : 'hover:scale-110'
          } ${
            repeatMode !== 'off'
              ? 'text-white'
              : 'text-white/55 hover:text-white'
          }`}
        >
          <span
            className={`inline-flex ${
              transportAnim === 'repeat' && !reducedMotionPref ? 'pm-repeat-spin-epic' : ''
            }`}
          >
            {repeatMode === 'one' ? (
              <Repeat1 className="h-[14px] w-[14px] md:h-[18px] md:w-[18px]" />
            ) : (
              <Repeat className="h-[14px] w-[14px] md:h-[18px] md:w-[18px]" />
            )}
          </span>
          {repeatMode !== 'off' && (
            <span
              aria-hidden="true"
              className="pm-indicator-dot absolute bottom-0.5 h-1 w-1 rounded-full bg-white"
            />
          )}
        </button>
      </div>

      {isGuestInJam && (
        <div
          data-testid="nowplaying-jam-guest-lock"
          className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-black/35 px-3 py-1 text-[11px] font-semibold text-white/80 backdrop-blur-md"
        >
          <Lock className="h-3 w-3 shrink-0" />
          <span>Solo el jefe de la Jam controla la reproducción</span>
        </div>
      )}

      {/* Desktop-only Subtle Pill Volume Bar (mobile locks internal volume to 100%) */}
      <div className="hidden w-full max-w-[290px] items-center gap-3 pt-1 md:flex">
        <button
          type="button"
          aria-label={volume === 0 ? 'Activar sonido' : 'Silenciar'}
          onClick={() => toggleMute()}
          className="flex h-8 w-8 items-center justify-center rounded-full text-white/65 hover:bg-white/15 hover:text-white"
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
          aria-label="Volumen del reproductor"
          min={0}
          max={100}
          value={volumePct}
          onChange={(e) => setVolume(Number(e.target.value) / 100)}
          style={{ '--pm-fill': `${volumePct}%` } as React.CSSProperties}
          className="pm-range-pill flex-1 cursor-pointer"
        />
        <span className="tabular-nums w-9 text-right text-[11px] font-medium text-white/60">
          {volumePct}%
        </span>
      </div>
    </div>
  );

  return (
    <div
      ref={sheetRootRef}
      role="dialog"
      aria-modal="true"
      aria-label="Reproduciendo ahora"
      data-testid="now-playing-sheet"
      data-light-backdrop={isLightBackdrop ? 'true' : 'false'}
      style={
        {
          '--pm-ink-transition-ms': `${cfActiveBackdrop ? Math.round(cfDurBackdropSec * 1000) : 650}ms`,
        } as React.CSSProperties
      }
      onScroll={(e) => {
        if (e.currentTarget.scrollTop !== 0) e.currentTarget.scrollTop = 0;
        if (e.currentTarget.scrollLeft !== 0) e.currentTarget.scrollLeft = 0;
      }}
      className={`pm-sheet-spring-in pm-dark-sliders fixed inset-0 z-50 flex h-dvh w-screen flex-col overflow-hidden bg-[#070709] text-[#F5F5F7] ${
        isLightBackdrop ? 'pm-np-light-surface' : ''
      }`}
    >
      {/* Dynamic Selectable Fullscreen Backdrop (Smooth Motion, Non-Audio-Reactive) */}
      <div
        data-testid="live-backdrop-container"
        data-backdrop-style={nowPlayingBackdropStyle}
        aria-hidden="true"
        className={`pointer-events-none fixed -inset-16 z-0 overflow-hidden ${
          !ambientMotionEnabled || reducedMotionPref ? 'pm-backdrop-static' : ''
        }`}
        style={{
          contain: 'strict',
          transform: 'translateZ(0)',
          background:
            nowPlayingBackdropStyle === 'minimal'
              ? 'radial-gradient(ellipse at 50% 24%, color-mix(in srgb, var(--pm-ambient-1) 30%, #070709) 0%, color-mix(in srgb, var(--pm-ambient-3) 38%, #070709) 55%, #070709 100%)'
              : '#070709',
        }}
      >
        {/* Zero-Blur GPU-Composited Fluid Canvas (Desktop + Mobile) & Un-throttled Exotic Shaders */}
        {nowPlayingBackdropStyle === 'fluid' && !isAppHidden && (
          <div
            className="pointer-events-none absolute inset-16"
            style={{ zIndex: 2 }}
          >
            <MobileFluidBackdropCanvas
              desktopMode={!isMobileBackdrop}
              coverUrl={targetBackdropUrl}
              crossfadeMs={cfActiveBackdrop ? Math.round(cfDurBackdropSec * 1000) : 950}
              crossfadeLinear={cfActiveBackdrop}
              ambientMotionEnabled={ambientMotionEnabled}
              reducedMotionPref={reducedMotionPref}
            />
          </div>
        )}

        {!isMobileBackdrop && (
          <>
            <div data-testid="backdrop-slot-0" aria-hidden="true" className="hidden" />
            <div data-testid="backdrop-slot-1" aria-hidden="true" className="hidden" />
          </>
        )}

        {!isAppHidden &&
          (nowPlayingBackdropStyle === 'paint' ||
            nowPlayingBackdropStyle === 'pulse') && (
          <div className="pointer-events-none absolute inset-16" style={{ zIndex: 3 }}>
            <ExoticBackdropCanvas
              key={nowPlayingBackdropStyle}
              style={nowPlayingBackdropStyle}
              coverUrl={targetBackdropUrl}
              crossfadeMs={cfActiveBackdrop ? Math.round(cfDurBackdropSec * 1000) : 950}
              isPlaying={isPlaying}
              ambientMotionEnabled={ambientMotionEnabled}
              reducedMotionPref={reducedMotionPref}
              throttleFps={false}
            />
          </div>
        )}
      </div>

      {/* Apple HIG Bright Media Scrim (Adaptive frosted veil when cover backdrop is white/very bright) */}
      <div
        data-testid="bright-media-scrim"
        data-scrim="true"
        data-scrim-alpha={
          isLightBackdrop
            ? '0.18'
            : nowPlayingBackdropStyle === 'pulse' || nowPlayingBackdropStyle === 'paint'
              ? '0.22'
              : '0.34'
        }
        className="pointer-events-none fixed inset-0 z-0 transition-[background] duration-500"
        style={{
          background: isLightBackdrop
            ? 'linear-gradient(180deg, rgba(255, 255, 255, 0.22) 0%, rgba(255, 255, 255, 0.10) 36%, rgba(255, 255, 255, 0.24) 100%)'
            : nowPlayingBackdropStyle === 'pulse' || nowPlayingBackdropStyle === 'paint'
              ? 'linear-gradient(180deg, rgba(8, 8, 12, 0.24) 0%, rgba(8, 8, 12, 0.16) 28%, rgba(8, 8, 12, 0.22) 100%)'
              : 'linear-gradient(180deg, rgba(8, 8, 12, 0.44) 0%, rgba(8, 8, 12, 0.31) 24%, rgba(8, 8, 12, 0.34) 100%)',
        }}
      />

      {/* Minimalist Top Area: Grabber Pill on Mobile Portada, Sleek Mini Track Bar on Letras/Cola, Subtle Cerrar on Desktop */}
      <header
        onTouchStart={(e) => {
          const t = e.touches[0];
          if (t) sheetSwipeDownRef.current = { y: t.clientY, x: t.clientX };
        }}
        onTouchEnd={(e) => {
          const s = sheetSwipeDownRef.current;
          sheetSwipeDownRef.current = null;
          const t = e.changedTouches[0];
          if (!s || !t) return;
          if (t.clientY - s.y > 56 && Math.abs(t.clientX - s.x) < 60) {
            setNowPlayingOpen(false);
          }
        }}
        className={`pm-drag-region relative z-20 flex shrink-0 items-center justify-between px-4 pt-[max(0.6rem,var(--pm-safe-top,env(safe-area-inset-top)))] pb-1 md:px-8 md:pb-2 ${
          isElectronDesktop && !isRealFullscreen ? 'pr-[152px] md:pr-[152px]' : ''
        }`}
      >
        {/* Mobile Portada: clean centered top grabber capsule + fullscreen button */}
        {nowPlayingTab === 'Portada' ? (
          <div className="relative flex w-full items-center justify-center py-1 md:hidden">
            <button
              type="button"
              aria-label="Bajar reproductor"
              onClick={() => setNowPlayingOpen(false)}
              className="flex h-7 w-16 items-center justify-center rounded-full"
            >
              <span className="h-1 w-10 rounded-full bg-white/35" />
            </button>
          </div>
        ) : (
          /* Mobile Letras / Cola: compact top mini-track header matching Apple Music style */
          <div className="flex w-full items-center justify-between gap-2.5 py-1 md:hidden">
            <button
              type="button"
              onClick={() => setNowPlayingTab('Portada')}
              className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
            >
              <div className="h-10 w-10 shrink-0 overflow-hidden rounded-[8px] shadow-md">
                <TrackArtwork
                  trackId={currentTrack.id}
                  src={currentTrack.thumbnailUrl}
                  title={currentTrack.title}
                  artistName={currentTrack.artists[0]?.name}
                  artistId={currentTrack.artists[0]?.id}
                  alt={currentTrack.title}
                  variant="mini"
                  imgClassName="h-full w-full object-cover"
                />
              </div>
              <div className="min-w-0 flex-1">
                <MarqueeText
                  disabled={!marqueeTextEnabled || reducedMotionPref || cfActive}
                  className="w-full"
                >
                  <span className="text-[14px] font-bold leading-tight text-white">
                    {currentTrack.title}
                  </span>
                </MarqueeText>
                <MarqueeText
                  disabled={!marqueeTextEnabled || reducedMotionPref || cfActive}
                  className="w-full text-xs text-white/65"
                >
                  <span>{currentTrack.artists.map((a) => a.name).join(', ')}</span>
                </MarqueeText>
              </div>
            </button>
            <button
              type="button"
              aria-label={isPlaying ? 'Pausar' : 'Reproducir'}
              onClick={() => void togglePlayPause()}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white hover:bg-white/10"
            >
              {isPlaying ? (
                <Pause className="h-5 w-5 fill-current" />
              ) : (
                <Play className="h-5 w-5 translate-x-[1px] fill-current" />
              )}
            </button>
            <button
              type="button"
              aria-label="Bajar reproductor"
              onClick={() => setNowPlayingOpen(false)}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white/75 hover:bg-white/10 hover:text-white"
            >
              <ChevronDown className="h-5 w-5" />
            </button>
          </div>
        )}

        {/* Desktop Minimal Left Dismiss Pill */}
        <button
          type="button"
          aria-label="Cerrar reproductor"
          onClick={() => setNowPlayingOpen(false)}
          className="pm-pressable pm-no-drag hidden items-center gap-1.5 rounded-full bg-white/[0.08] px-3.5 py-1.5 text-xs font-semibold text-white/90 transition-colors hover:bg-white/[0.16] md:inline-flex"
        >
          <ChevronDown className="h-4 w-4" />
          <span>Minimizar</span>
        </button>

        <button
          type="button"
          data-testid="toggle-real-fullscreen-btn"
          aria-label={isRealFullscreen ? 'Salir de pantalla completa' : 'Pantalla completa real'}
          title={isRealFullscreen ? 'Salir de pantalla completa (F11 / Esc)' : 'Pantalla completa real (F11)'}
          onClick={() => void toggleRealFullscreen().then(setIsRealFullscreen)}
          className="pm-pressable pm-no-drag hidden items-center gap-1.5 rounded-full bg-white/[0.08] px-3.5 py-1.5 text-xs font-semibold text-white/90 transition-colors hover:bg-white/[0.16] md:inline-flex"
        >
          {isRealFullscreen ? (
            <>
              <Minimize className="h-3.5 w-3.5" />
              <span>Salir pantalla completa</span>
            </>
          ) : (
            <>
              <Maximize className="h-3.5 w-3.5" />
              <span>Pantalla completa</span>
            </>
          )}
        </button>
      </header>

      {/* Main Content */}
      <div
        className={`relative z-10 min-h-0 flex-1 px-5 md:px-10 ${
          nowPlayingTab === 'Portada'
            ? 'overflow-hidden py-1 md:overflow-x-hidden md:overflow-y-auto md:py-5'
            : nowPlayingTab === 'Letras'
              ? 'overflow-hidden py-0'
              : 'overflow-hidden py-2 md:py-5'
        }`}
      >
        {nowPlayingTab === 'Portada' && (
          <div key="np-portada" className="pm-view-transition flex h-full min-h-full items-center justify-center">
            {PlayerDeckColumn(false)}
          </div>
        )}

        {nowPlayingTab === 'Letras' && (
          <div key="np-letras" className="pm-view-transition mx-auto grid h-full min-h-0 max-w-6xl grid-cols-1 grid-rows-[minmax(0,1fr)] gap-8 lg:grid-cols-12">
            <div
              data-testid="letras-left-deck"
              className="hidden h-full min-h-0 px-4 lg:col-span-5 lg:flex lg:items-center lg:justify-center"
            >
              {PlayerDeckColumn(true)}
            </div>

            <div
              ref={lyricsContainerRef}
              data-testid="synced-lyrics-view"
              onWheel={markLyricsUserScrolled}
              onTouchMove={markLyricsUserScrolled}
              onPointerDown={(e) => {
                lyricsPointerStartRef.current = { x: e.clientX, y: e.clientY };
                if (lyricsLongPressTimerRef.current) clearTimeout(lyricsLongPressTimerRef.current);
                lyricsLongPressTimerRef.current = setTimeout(() => {
                  setLyricsStyleModalOpen(true);
                }, 420);
              }}
              onPointerMove={(e) => {
                const orig = lyricsPointerStartRef.current;
                if (!orig || !lyricsLongPressTimerRef.current) return;
                if (Math.hypot(e.clientX - orig.x, e.clientY - orig.y) > 10) {
                  clearTimeout(lyricsLongPressTimerRef.current);
                  lyricsLongPressTimerRef.current = null;
                }
              }}
              onPointerUp={() => {
                lyricsPointerStartRef.current = null;
                if (lyricsLongPressTimerRef.current) {
                  clearTimeout(lyricsLongPressTimerRef.current);
                  lyricsLongPressTimerRef.current = null;
                }
              }}
              onPointerCancel={() => {
                lyricsPointerStartRef.current = null;
                if (lyricsLongPressTimerRef.current) {
                  clearTimeout(lyricsLongPressTimerRef.current);
                  lyricsLongPressTimerRef.current = null;
                }
              }}
              className="relative flex h-full min-h-0 flex-col overflow-y-auto pt-4 pb-12 pr-1 pm-no-scrollbar lg:col-span-7 lg:py-8 lg:pr-2"
            >
              {lyricsUserScrolled && lyricsStyle !== 'focus' && (
                <div className="sticky top-2 z-20 mb-2 flex justify-end">
                  <button
                    type="button"
                    onClick={() => {
                      if (lyricsScrollResumeTimerRef.current) {
                        clearTimeout(lyricsScrollResumeTimerRef.current);
                      }
                      setLyricsUserScrolled(false);
                    }}
                    className="rounded-full bg-white px-3.5 py-1.5 text-[11px] font-bold text-[#070709] shadow-md"
                  >
                    Sincronizar
                  </button>
                </div>
              )}

              {currentLyrics && currentLyrics.lines.length > 0 ? (
                lyricsStyle === 'focus' ? (
                  /* Mode 3: Enfoque — Mobile TikTok/Reels hero cover + centered spotlight lyric stage */
                  (() => {
                    const activeIdx = Math.max(0, resolvedActiveLyricIdx);
                    const activeLine = currentLyrics.lines[activeIdx];
                    const nextLine = currentLyrics.lines[activeIdx + 1];
                    const emphasis = activeLine
                      ? analyzeKineticWords(currentLyrics.lines, activeIdx)
                      : [];
                    const words = activeLine ? activeLine.text.trim().split(/\s+/).filter(Boolean) : [];
                    return (
                      <div
                        data-testid="focus-lyrics-stage"
                        className="flex flex-1 flex-col items-center justify-center gap-5 px-4 pb-8 text-center lg:items-start lg:px-3 lg:pb-10 lg:text-left"
                      >
                        {/* Large glowing album cover for mobile vertical TikTok / Reels aesthetic */}
                        <div className="flex flex-col items-center gap-3 lg:hidden">
                          <div className="relative">
                            <div
                              aria-hidden="true"
                              className="pointer-events-none absolute -inset-5 rounded-[34px] opacity-55 blur-2xl"
                              style={{
                                background:
                                  'radial-gradient(circle at 50% 50%, var(--pm-ambient-1, rgba(168,85,247,0.55)), transparent 72%)',
                              }}
                            />
                            <div
                              className={`relative aspect-square w-[min(60vw,236px)] overflow-hidden rounded-[24px] shadow-[0_24px_64px_rgba(0,0,0,0.68)] ring-1 ring-white/25 ${
                                isPlaying && ambientMotionEnabled ? 'pm-focus-cover-playing' : ''
                              }`}
                            >
                              <TrackArtwork
                                trackId={currentTrack.id}
                                src={currentTrack.thumbnailHighUrl ?? currentTrack.thumbnailUrl}
                                title={currentTrack.title}
                                artistName={currentTrack.artists[0]?.name}
                                artistId={currentTrack.artists[0]?.id}
                                alt={currentTrack.title}
                                variant="card"
                                imgClassName="h-full w-full object-cover"
                              />
                              <div
                                aria-hidden="true"
                                className="pointer-events-none absolute inset-0 rounded-[24px] shadow-[inset_0_1px_0_rgba(255,255,255,0.35)]"
                              />
                            </div>
                          </div>
                          <div className="max-w-[82vw] space-y-0.5">
                            <div className="truncate text-[16px] font-extrabold tracking-tight text-white drop-shadow-sm">
                              {currentTrack.title}
                            </div>
                            <div className="truncate text-xs font-semibold text-white/65">
                              {currentTrack.artists.map((a) => a.name).join(', ')}
                            </div>
                          </div>
                        </div>

                        <div className="flex w-full flex-col items-center lg:items-start">
                          {activeLine && (
                            <button
                              key={`focus-${activeIdx}-${activeLine.timeMs}`}
                              type="button"
                              data-lyric-state="active"
                              onClick={() => seekTo(activeLine.timeMs / 1000)}
                              className="pm-focus-stage-line max-w-[92vw] text-center text-[25px] font-extrabold leading-[1.2] tracking-tight text-white drop-shadow-[0_6px_26px_rgba(0,0,0,0.48)] sm:text-[29px] lg:max-w-none lg:text-left lg:text-[38px]"
                            >
                              {words.map((w, wi) => {
                                const kind = emphasis[wi] ?? 'normal';
                                return (
                                  <React.Fragment key={wi}>
                                    <span
                                      className={
                                        kind === 'rhyme'
                                          ? 'pm-kinetic-rhyme'
                                          : kind === 'punch'
                                            ? 'pm-kinetic-punch'
                                            : ''
                                      }
                                    >
                                      {w}
                                    </span>
                                    {wi < words.length - 1 ? ' ' : ''}
                                  </React.Fragment>
                                );
                              })}
                            </button>
                          )}
                          {nextLine && (
                            <button
                              type="button"
                              onClick={() => seekTo(nextLine.timeMs / 1000)}
                              className="mt-3 max-w-[88vw] text-center text-[15px] font-semibold leading-snug text-white/40 transition-colors hover:text-white/70 sm:text-lg lg:mt-6 lg:max-w-none lg:text-left lg:text-2xl"
                            >
                              {nextLine.text}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })()
                ) : (
                  <div
                    key={`lyrics-body-${currentTrack.id}`}
                    style={{
                      opacity: cfActive ? 0.86 : 1,
                      transition: 'opacity 320ms ease',
                    }}
                    className={
                      lyricsStyle === 'kinetic'
                        ? 'pm-lyrics-swap-in space-y-3 pt-4 pb-24'
                        : 'pm-lyrics-mask pm-lyrics-swap-in space-y-2 pt-4 pb-16'
                    }
                  >
                    {/* Borderless 3-dot instrumental breathing pulse before intro verse */}
                    {currentLyrics.lines[0] &&
                      currentLyrics.lines[0].timeMs > 4000 &&
                      smoothPosMs < currentLyrics.lines[0].timeMs && (
                        <div className="inline-flex items-center gap-2 px-4 py-2">
                          <span className="pm-lyric-dot h-2 w-2 rounded-full bg-white/90" />
                          <span className="pm-lyric-dot h-2 w-2 rounded-full bg-white/80" />
                          <span className="pm-lyric-dot h-2 w-2 rounded-full bg-white/90" />
                        </div>
                      )}

                    {currentLyrics.lines.map((line, idx) => {
                      const highlightIdx =
                        resolvedActiveLyricIdx >= 0
                          ? resolvedActiveLyricIdx
                          : (currentLyrics.lines[0]?.timeMs ?? 0) <= 4000
                            ? 0
                            : -1;
                      const isActive = idx === highlightIdx;
                      const isPast = highlightIdx >= 0 && idx < highlightIdx;
                      const dist = highlightIdx >= 0 ? Math.abs(idx - highlightIdx) : idx + 1;

                      if (lyricsStyle === 'kinetic' && highlightIdx >= 2 && idx < highlightIdx - 1) {
                        return null;
                      }

                      const nextLine = currentLyrics.lines[idx + 1];
                      const lineEndMs =
                        nextLine && nextLine.timeMs > line.timeMs
                          ? nextLine.timeMs
                          : line.timeMs + 4200;
                      const spanMs = Math.max(800, lineEndMs - line.timeMs);
                      const vocalSpanMs = Math.min(
                        spanMs * 0.92,
                        Math.max(1100, line.text.length * 90)
                      );
                      const verseProgress01 = isActive
                        ? Math.max(
                            0,
                            Math.min(1, (smoothPosMs - line.timeMs) / vocalSpanMs)
                          )
                        : 0;
                      const showInstrumentalGap =
                        isActive &&
                        nextLine &&
                        nextLine.timeMs - line.timeMs > 6500 &&
                        smoothPosMs - line.timeMs > 3200;

                      const lyricSizeClass =
                        lyricsStyle === 'kinetic' || lyricsStyle === 'wordflow'
                          ? isActive
                            ? 'text-[26px] leading-[1.2] md:text-[34px] md:leading-[1.18]'
                            : 'text-[19px] leading-[1.32] md:text-[23px]'
                          : lyricsStyle === 'neon'
                            ? isActive
                              ? 'pm-neon-font text-[25px] leading-[1.18] md:text-[34px]'
                              : 'pm-neon-font text-[18px] leading-[1.28] md:text-[23px]'
                            : lyricsStyle === 'typewriter'
                              ? isActive
                                ? 'pm-mono-font text-[22px] leading-[1.28] md:text-[29px]'
                                : 'pm-mono-font text-[16px] leading-[1.35] md:text-[20px]'
                              : lyricsStyle === 'poster'
                                ? isActive
                                  ? 'pm-poster-font text-[27px] leading-[1.18] md:text-[36px]'
                                  : 'pm-poster-font text-[20px] leading-[1.28] md:text-[25px]'
                                : lyricsStyle === 'editorial'
                                  ? isActive
                                    ? 'pm-editorial-font text-[30px] italic leading-[1.18] md:text-[40px]'
                                    : 'pm-editorial-font text-[24px] leading-[1.26] md:text-[30px]'
                                  : lyricsSize === 'normal'
                                    ? 'text-xl leading-[1.3] md:text-[26px] md:leading-[1.28]'
                                    : lyricsSize === 'xl'
                                      ? 'text-[30px] leading-[1.22] md:text-[38px] md:leading-[1.2]'
                                      : 'text-[26px] leading-[1.26] md:text-[32px] md:leading-[1.24]';

                      const distClass =
                        lyricsStyle === 'kinetic' && isPast
                          ? 'pm-kinetic-vanish max-h-0 overflow-hidden !py-0'
                          : isActive
                            ? `pm-lyric-line-active ${
                                lyricsStyle === 'kinetic'
                                  ? 'pm-kinetic-enter'
                                  : lyricsStyle === 'poster'
                                    ? 'pm-poster-enter'
                                    : ''
                              }`
                            : highlightIdx === -1 && idx === 0
                              ? 'pm-lyric-line-inactive opacity-85'
                              : lyricsStyle === 'editorial' || lyricsStyle === 'poster' || lyricsStyle === 'typewriter'
                              ? isPast
                                ? 'opacity-25'
                                : dist === 1
                                  ? 'opacity-60'
                                  : 'opacity-35'
                              : lyricsBlurEnabled
                                ? `pm-lyric-line-inactive ${
                                    dist === 1
                                      ? 'pm-lyric-dist-1'
                                      : dist === 2
                                        ? 'pm-lyric-dist-2'
                                        : 'pm-lyric-dist-far'
                                  }`
                                : `pm-lyric-line-inactive ${
                                    dist === 1
                                      ? 'opacity-65'
                                      : dist === 2
                                        ? 'opacity-50'
                                        : 'opacity-35'
                                  }`;

                      const words = line.text.trim().split(/\s+/).filter(Boolean);
                      const emphasis =
                        (lyricsStyle === 'kinetic' || lyricsStyle === 'poster') && isActive
                          ? analyzeKineticWords(currentLyrics.lines, idx)
                          : null;
                      const totalWeight = words.reduce(
                        (sum, w) => sum + w.length + 1,
                        0
                      );
                      let weightCursor = 0;
                      const perWordTiming = words.map((word) => {
                        const wLen = word.length + 1;
                        const wStart = weightCursor / Math.max(1, totalWeight);
                        weightCursor += wLen;
                        const wEnd = weightCursor / Math.max(1, totalWeight);
                        const wp = Math.max(
                          0,
                          Math.min(
                            1,
                            (verseProgress01 - wStart) / Math.max(0.01, wEnd - wStart)
                          )
                        );
                        return { word, wp, wStart, wEnd };
                      });
                      const currentWordIdx = perWordTiming.findIndex(
                        (item) => item.wp > 0.005 && item.wp < 0.995
                      );

                      return (
                        <React.Fragment key={`${line.index}-${line.timeMs}`}>
                          <button
                            ref={isActive ? activeLyricRef : undefined}
                            type="button"
                            data-lyric-state={isActive ? 'active' : 'inactive'}
                            onClick={() => {
                              seekTo(line.timeMs / 1000);
                              setLyricsUserScrolled(false);
                            }}
                            className={`group relative flex w-full items-baseline justify-between gap-4 rounded-[14px] px-3 py-2.5 text-left font-bold tracking-tight ${lyricSizeClass} ${distClass}`}
                          >
                            <span className="flex-1">
                              {isActive && words.length > 0 ? (
                                lyricsStyle === 'wordflow' ? (
                                  perWordTiming.map(({ word, wp }, wIdx) => {
                                    const isPastWord = wp >= 0.995;
                                    const isCurWord = wp > 0.005 && wp < 0.995;
                                    const scaleVar =
                                      wIdx % 3 === 0 ? '1.14' : wIdx % 3 === 1 ? '1.08' : '1.11';
                                    const tiltVar =
                                      wIdx % 4 === 1 ? '-1.2deg' : wIdx % 4 === 3 ? '1.2deg' : '0deg';
                                    return (
                                      <React.Fragment key={`${idx}-${wIdx}`}>
                                        <span
                                          className={`pm-wordflow-word ${
                                            isCurWord
                                              ? 'pm-wordflow-word-active'
                                              : isPastWord
                                                ? 'pm-wordflow-word-past'
                                                : 'pm-wordflow-word-future'
                                          }`}
                                          style={
                                            {
                                              '--pm-word-scale': scaleVar,
                                              '--pm-word-tilt': tiltVar,
                                            } as React.CSSProperties
                                          }
                                        >
                                          {word}
                                        </span>
                                        {wIdx < words.length - 1 ? ' ' : ''}
                                      </React.Fragment>
                                    );
                                  })
                                ) : lyricsStyle === 'typewriter' ? (
                                  perWordTiming.map(({ word, wp }, wIdx) => {
                                    const typed = wp > 0.005;
                                    const showCaret =
                                      (currentWordIdx >= 0 ? wIdx === currentWordIdx : wIdx === words.length - 1 && verseProgress01 > 0.02);
                                    return (
                                      <React.Fragment key={`${idx}-${wIdx}`}>
                                        <span
                                          className={`transition-opacity duration-150 ${
                                            typed ? 'opacity-100 text-white' : 'opacity-20 text-white/55'
                                          }`}
                                        >
                                          {word}
                                        </span>
                                        {showCaret && <span aria-hidden="true" className="pm-caret-blink" />}
                                        {wIdx < words.length - 1 ? ' ' : ''}
                                      </React.Fragment>
                                    );
                                  })
                                ) : lyricsStyle === 'neon' ? (
                                  perWordTiming.map(({ word, wp }, wIdx) => {
                                    const isCurWord = wp > 0.005 && wp < 0.995;
                                    const isPastWord = wp >= 0.995;
                                    return (
                                      <React.Fragment key={`${idx}-${wIdx}`}>
                                        <span
                                          className={
                                            isCurWord
                                              ? 'pm-neon-active inline-block'
                                              : isPastWord
                                                ? 'text-white drop-shadow-[0_0_12px_rgba(255,255,255,0.45)]'
                                                : 'text-white/35'
                                          }
                                        >
                                          {word}
                                        </span>
                                        {wIdx < words.length - 1 ? ' ' : ''}
                                      </React.Fragment>
                                    );
                                  })
                                ) : lyricsStyle === 'poster' && emphasis ? (
                                  words.map((word, wIdx) => {
                                    const kind = emphasis[wIdx] ?? 'normal';
                                    return (
                                      <React.Fragment key={`${idx}-${wIdx}`}>
                                        <span
                                          className={
                                            kind === 'rhyme' || kind === 'punch'
                                              ? 'pm-poster-accent'
                                              : 'text-white/95'
                                          }
                                        >
                                          {word}
                                        </span>
                                        {wIdx < words.length - 1 ? ' ' : ''}
                                      </React.Fragment>
                                    );
                                  })
                                ) : emphasis ? (
                                  words.map((word, wIdx) => {
                                    const kind = emphasis[wIdx] ?? 'normal';
                                    return (
                                      <React.Fragment key={`${idx}-${wIdx}`}>
                                        <span
                                          className={
                                            kind === 'rhyme'
                                              ? 'pm-kinetic-rhyme'
                                              : kind === 'punch'
                                                ? 'pm-kinetic-punch'
                                                : 'text-white/95'
                                          }
                                        >
                                          {word}
                                        </span>
                                        {wIdx < words.length - 1 ? ' ' : ''}
                                      </React.Fragment>
                                    );
                                  })
                                ) : (
                                  perWordTiming.map(({ word, wp, wStart, wEnd }, wIdx) => {
                                    const wordState =
                                      wp <= 0.002
                                        ? 'upcoming'
                                        : wp >= 0.998
                                          ? 'sung'
                                          : 'active';
                                    const wave =
                                      wordState === 'active'
                                        ? Math.sin(Math.min(1, wp) * Math.PI)
                                        : 0;
                                    const liftPx =
                                      wordState === 'active'
                                        ? `${(-(1 + 2.6 * wave)).toFixed(2)}px`
                                        : wordState === 'sung'
                                          ? '-1px'
                                          : '0px';
                                    const wordScale =
                                      wordState === 'active' ? (1 + 0.032 * wave).toFixed(4) : '1';
                                    const bgPos =
                                      wordState === 'upcoming'
                                        ? 100
                                        : wordState === 'sung'
                                          ? 0
                                          : (1 - wp) * 100;
                                    return (
                                      <React.Fragment key={`${idx}-${wIdx}`}>
                                        <span
                                          className="pm-sing-word"
                                          data-word-state={wordState}
                                          data-w-start={wStart.toFixed(5)}
                                          data-w-end={wEnd.toFixed(5)}
                                          style={
                                            {
                                              '--word-bg-pos': `${bgPos.toFixed(2)}%`,
                                              '--word-y': liftPx,
                                              '--word-scale': wordScale,
                                            } as React.CSSProperties
                                          }
                                        >
                                          {word}
                                        </span>
                                        {wIdx < words.length - 1 ? ' ' : ''}
                                      </React.Fragment>
                                    );
                                  })
                                )
                              ) : (
                                <span>{line.text}</span>
                              )}
                            </span>
                            <span className="tabular-nums shrink-0 text-[11px] font-medium text-[#D1D1DC] opacity-0 transition-opacity group-hover:opacity-75">
                              {formatDurationSec(line.timeMs / 1000)}
                            </span>
                          </button>

                          {showInstrumentalGap && (
                            <div className="inline-flex items-center gap-2 px-4 py-2">
                              <span className="pm-lyric-dot h-2 w-2 rounded-full bg-white/90" />
                              <span className="pm-lyric-dot h-2 w-2 rounded-full bg-white/80" />
                              <span className="pm-lyric-dot h-2 w-2 rounded-full bg-white/90" />
                            </div>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </div>
                )
              ) : (
                <div className="flex h-full min-h-[280px] items-center justify-center px-2">
                  <div className="w-full max-w-md rounded-[24px] bg-white/[0.06] px-8 py-10 text-center">
                    <Mic2 className="mx-auto mb-3 h-8 w-8 text-[#B4B4BE]" />
                    <p className="text-base font-semibold text-[#F5F5F7]">
                      No hay letra disponible para esta canción
                    </p>
                    <p className="mt-1.5 text-xs leading-relaxed text-[#A1A1AE]">
                      No se encontró letra sincronizada ni texto en LRCLIB ni Musixmatch para esta pista.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {nowPlayingTab === 'Cola' && (
          <div key="np-cola" className="pm-view-transition mx-auto grid h-full min-h-0 max-w-6xl grid-cols-1 grid-rows-[minmax(0,1fr)] gap-8 lg:grid-cols-12">
            <div className="hidden h-full min-h-0 px-4 lg:col-span-5 lg:flex lg:items-center lg:justify-center">
              {PlayerDeckColumn(true)}
            </div>
            <NowPlayingQueuePanel />
          </div>
        )}
      </div>

      {/* Unified Bottom Minimalist Navigation Bar: Letras -> Cola -> Ajustes de audio */}
      <nav
        aria-label="Controles inferiores del reproductor"
        data-testid="nowplaying-bottom-nav"
        className="relative z-20 flex shrink-0 items-center justify-center bg-transparent px-6 pt-1 pb-[max(0.95rem,var(--pm-safe-bottom,env(safe-area-inset-bottom)))] md:pb-5"
      >
        <div className="flex w-full max-w-[300px] items-center justify-around md:w-auto md:max-w-none md:justify-center md:gap-2">
          <button
            type="button"
            aria-label="Portada"
            aria-pressed={nowPlayingTab === 'Portada'}
            onClick={() => setNowPlayingTab('Portada')}
            className={`pm-pressable hidden h-9 items-center gap-1.5 rounded-full px-3.5 text-xs font-semibold transition-colors md:inline-flex ${
              nowPlayingTab === 'Portada'
                ? 'bg-white text-[#070709] shadow-sm'
                : 'text-white/75 hover:bg-white/[0.12] hover:text-white'
            }`}
          >
            <ImageIcon className="h-3.5 w-3.5" />
            <span>Portada</span>
          </button>

          <button
            type="button"
            aria-label="Letras"
            aria-pressed={nowPlayingTab === 'Letras'}
            onClick={() => {
              if (nowPlayingTab === 'Letras') {
                if (isMobileBackdrop) {
                  setNowPlayingTab('Portada');
                } else {
                  setLyricsStyleModalOpen((v) => !v);
                }
              } else {
                setNowPlayingTab('Letras');
              }
            }}
            className={`pm-pressable inline-flex h-10 w-10 items-center justify-center gap-1.5 rounded-full transition-colors md:h-9 md:w-auto md:px-3.5 md:text-xs md:font-semibold ${
              nowPlayingTab === 'Letras'
                ? 'bg-white/[0.22] text-white md:bg-white md:text-[#070709] md:shadow-sm'
                : 'text-white/70 hover:bg-white/[0.10] hover:text-white'
            }`}
          >
            <MessageSquareQuote className="h-5 w-5 md:h-3.5 md:w-3.5" />
            <span className="hidden md:inline">Letras</span>
          </button>

          <button
            type="button"
            aria-label="Cola"
            aria-pressed={nowPlayingTab === 'Cola'}
            onClick={() =>
              setNowPlayingTab(nowPlayingTab === 'Cola' ? 'Portada' : 'Cola')
            }
            className={`pm-pressable inline-flex h-10 w-10 items-center justify-center gap-1.5 rounded-full transition-colors md:h-9 md:w-auto md:px-3.5 md:text-xs md:font-semibold ${
              nowPlayingTab === 'Cola'
                ? 'bg-white/[0.22] text-white md:bg-white md:text-[#070709] md:shadow-sm'
                : 'text-white/70 hover:bg-white/[0.10] hover:text-white'
            }`}
          >
            <ListMusic className="h-5 w-5 md:h-3.5 md:w-3.5" />
            <span className="hidden md:inline">Cola</span>
          </button>

          <button
            type="button"
            data-testid="nowplaying-dj-btn"
            aria-label="Ajustes de audio, DJ y calidad"
            aria-pressed={djPopoverOpen || eqSheetOpen}
            onClick={() => {
              if (djPopoverOpen || eqSheetOpen) {
                setDjPopoverOpen(false);
                setEqSheetOpen(false);
              } else if (audioPanelTab === 'display') {
                setEqSheetOpen(true);
                setAudioPanelTab('display');
              } else if (audioPanelTab === 'eq') {
                setEqSheetOpen(true);
              } else {
                setDjPopoverOpen(true);
              }
            }}
            className={`pm-pressable inline-flex h-10 w-10 items-center justify-center gap-1.5 rounded-full transition-colors md:h-9 md:w-auto md:px-3.5 md:text-xs md:font-semibold ${
              djMode.enabled || djPopoverOpen || eqSheetOpen
                ? 'bg-white/[0.2] text-white'
                : 'text-white/70 hover:bg-white/[0.10] hover:text-white'
            }`}
          >
            <SlidersHorizontal
              className={`h-5 w-5 md:h-3.5 md:w-3.5 ${
                djMode.enabled ? 'text-purple-300' : ''
              }`}
            />
            <span className="hidden md:inline">
              {djMode.enabled ? 'Opciones · DJ' : 'Opciones'}
            </span>
          </button>
        </div>
      </nav>

      {/* Full-Screen Frosted Modal for Switching Lyrics Visual Mode (viewport-wide blur & dim) */}
      {lyricsStyleModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 backdrop-blur-md sm:items-center sm:bg-black/45"
          onClick={() => setLyricsStyleModalOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="false"
            aria-label="Estilo de visualización de letras"
            data-testid="lyrics-style-switcher"
            onClick={(e) => e.stopPropagation()}
            className="pm-glass-frosted-neutral pm-hud-dark pm-modal-pop max-h-[78dvh] w-full max-w-[400px] overflow-y-auto rounded-[24px] p-4 shadow-2xl pm-no-scrollbar sm:max-w-[600px] sm:rounded-[28px] sm:p-5"
          >
            <div className="mb-3.5 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-white sm:text-base">
                  Estilo visual de letras
                </h3>
                <p className="text-[11px] text-white/60 sm:text-xs">
                  Vuelve a pulsar Letras o mantén pulsado para cambiar
                </p>
              </div>
              <button
                type="button"
                aria-label="Cerrar selector de letras"
                onClick={() => setLyricsStyleModalOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white/75 transition-colors hover:bg-white/20 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-2.5">
              {LYRICS_STYLE_OPTIONS.map((opt) => {
                const selected = lyricsStyle === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    data-testid={`lyrics-style-${opt.id}`}
                    aria-pressed={selected}
                    onClick={() => {
                      setLyricsStyle(opt.id);
                      setLyricsStyleModalOpen(false);
                    }}
                    className={`pm-pressable group flex flex-col justify-between gap-2 rounded-[18px] border p-3 text-left transition-all ${
                      selected
                        ? 'border-white/80 bg-white text-[#070709] shadow-lg'
                        : 'border-white/12 bg-white/[0.06] text-white/90 hover:border-white/28 hover:bg-white/[0.12]'
                    }`}
                  >
                    <div className="flex w-full items-start justify-between">
                      <span
                        className={`text-[21px] leading-none tracking-tight ${opt.previewClass} ${
                          selected ? 'text-[#070709]' : 'text-white'
                        }`}
                      >
                        Aa
                      </span>
                      {selected && (
                        <span className="flex h-4.5 w-4.5 items-center justify-center rounded-full bg-[#070709] text-white">
                          <Check className="h-2.5 w-2.5" />
                        </span>
                      )}
                    </div>
                    <div className="space-y-0.5">
                      <div className="text-xs font-bold leading-tight">{opt.label}</div>
                      <div
                        className={`text-[10.5px] leading-snug ${
                          selected ? 'text-[#070709]/70' : 'text-white/55'
                        }`}
                      >
                        {opt.desc}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const DJ_FX_ITEMS: readonly { key: keyof DjFxToggles; label: string }[] = [
  { key: 'vocal_over_beat', label: 'Voz / Base' },
  { key: 'instrumental_bed', label: 'Base / Voz' },
  { key: 'loop_build', label: 'Bucles' },
  { key: 'eq_swap', label: 'EQ Swap' },
  { key: 'filter_sweep', label: 'Filter Sweep' },
  { key: 'echo_out', label: 'Echo Out' },
];

export const AudioStudioSheet: React.FC = React.memo(() => {
  const isOpen = usePMusicStore((s) => s.eqSheetOpen || s.djPopoverOpen);
  if (!isOpen) return null;
  return <AudioStudioSheetInner />;
});
AudioStudioSheet.displayName = 'AudioStudioSheet';

const AudioStudioSheetInner: React.FC = () => {
  const {
    eqSheetOpen,
    djPopoverOpen,
    audioPanelTab,
    setAudioPanelTab,
    setEqSheetOpen,
    setDjPopoverOpen,
    nowPlayingOpen,
    playerBarStyle,
    setPlayerBarStyle,
    userEq,
    safeCrossfade,
    djMode,
    currentTrack,
    positionSec,
    activeTransitionPlan,
    isTransitioning,
    trackAnalyses,
    setEqPreset,
    setEqBandGain,
    setEqEnabled,
    setSafeCrossfade,
    toggleDjMode,
    setDjSessionStyle,
    toggleDjFx,
    triggerDjMixNow,
    startFullDjRadio,
    streamQuality,
    setStreamQuality,
    audioNormalization,
    setAudioNormalization,
    nowPlayingBackdropStyle,
    setNowPlayingBackdropStyle,
    lyricsStyle,
    setLyricsStyle,
    lyricsSize,
    setLyricsSize,
    lyricsBlurEnabled,
    setLyricsBlurEnabled,
    alwaysShuffle,
    setAlwaysShuffle,
    skipSameAlbumCoverTransition,
    setSkipSameAlbumCoverTransition,
    marqueeTextEnabled,
    setMarqueeTextEnabled,
      ambientMotionEnabled,
      setAmbientMotionEnabled,
      showRemainingTime,
      setShowRemainingTime,
      activeJamSession,
      activeJamRole,
    } = usePMusicStore(
      useShallow((s) => ({
        eqSheetOpen: s.eqSheetOpen,
        djPopoverOpen: s.djPopoverOpen,
        audioPanelTab: s.audioPanelTab,
        setAudioPanelTab: s.setAudioPanelTab,
        setEqSheetOpen: s.setEqSheetOpen,
        setDjPopoverOpen: s.setDjPopoverOpen,
        nowPlayingOpen: s.nowPlayingOpen,
        playerBarStyle: s.playerBarStyle,
        setPlayerBarStyle: s.setPlayerBarStyle,
        userEq: s.userEq,
        safeCrossfade: s.safeCrossfade,
        djMode: s.djMode,
        currentTrack: s.currentTrack,
        positionSec:
          s.audioPanelTab === 'dj' && s.djMode.enabled && Boolean(s.activeTransitionPlan)
            ? Math.floor(s.positionSec)
            : 0,
        activeTransitionPlan: s.activeTransitionPlan,
        isTransitioning: s.isTransitioning,
        trackAnalyses: s.trackAnalyses,
        setEqPreset: s.setEqPreset,
        setEqBandGain: s.setEqBandGain,
        setEqEnabled: s.setEqEnabled,
        setSafeCrossfade: s.setSafeCrossfade,
        toggleDjMode: s.toggleDjMode,
        setDjSessionStyle: s.setDjSessionStyle,
        toggleDjFx: s.toggleDjFx,
        triggerDjMixNow: s.triggerDjMixNow,
        startFullDjRadio: s.startFullDjRadio,
        streamQuality: s.streamQuality,
        setStreamQuality: s.setStreamQuality,
        audioNormalization: s.audioNormalization,
        setAudioNormalization: s.setAudioNormalization,
        nowPlayingBackdropStyle: s.nowPlayingBackdropStyle,
        setNowPlayingBackdropStyle: s.setNowPlayingBackdropStyle,
        lyricsStyle: s.lyricsStyle,
        setLyricsStyle: s.setLyricsStyle,
        lyricsSize: s.lyricsSize,
        setLyricsSize: s.setLyricsSize,
        lyricsBlurEnabled: s.lyricsBlurEnabled,
        setLyricsBlurEnabled: s.setLyricsBlurEnabled,
        alwaysShuffle: s.alwaysShuffle,
        setAlwaysShuffle: s.setAlwaysShuffle,
        skipSameAlbumCoverTransition: s.skipSameAlbumCoverTransition,
        setSkipSameAlbumCoverTransition: s.setSkipSameAlbumCoverTransition,
        marqueeTextEnabled: s.marqueeTextEnabled,
        setMarqueeTextEnabled: s.setMarqueeTextEnabled,
        ambientMotionEnabled: s.ambientMotionEnabled,
        setAmbientMotionEnabled: s.setAmbientMotionEnabled,
        showRemainingTime: s.showRemainingTime,
        setShowRemainingTime: s.setShowRemainingTime,
        activeJamSession: s.activeJamSession,
        activeJamRole: s.activeJamRole,
      }))
    );

  const isGuestInJam = Boolean(activeJamSession?.active && activeJamRole === 'guest');

  const [isMobileViewport, setIsMobileViewport] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth < 768 : false
  );

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const syncVp = () => setIsMobileViewport(window.innerWidth < 768);
    window.addEventListener('resize', syncVp);
    return () => window.removeEventListener('resize', syncVp);
  }, []);

  const isOpen = eqSheetOpen || djPopoverOpen;

  React.useEffect(() => {
    if (!isOpen || isMobileViewport) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest(
          '[data-testid="audio-studio-sheet"], [data-testid="eq-sheet"], [data-testid="dj-popover"], [data-testid="dock-eq-btn"], [data-testid="nowplaying-eq-btn"], [data-testid="nowplaying-dj-btn"], [data-testid="mobile-eq-btn"], [data-testid="mobile-dj-btn"], [data-testid="island-effects-btn"], [data-testid="island-effect-dj"], [data-testid="island-effect-eq"]'
        )
      ) {
        return;
      }
      setEqSheetOpen(false);
      setDjPopoverOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [isOpen, isMobileViewport, setEqSheetOpen, setDjPopoverOpen]);

  if (!isOpen) return null;

  const thirdTabLabel = nowPlayingOpen ? 'Pantalla' : 'Barra';
  const crossfadePct = Math.round((safeCrossfade.durationSec / 12) * 100);
  const ana = trackAnalyses[currentTrack.id];
  const countdownSec =
    djMode.enabled && activeTransitionPlan
      ? Math.max(0, Math.round(activeTransitionPlan.cueOutSec - positionSec))
      : null;

  const closeAudioStudio = () => {
    setEqSheetOpen(false);
    setDjPopoverOpen(false);
  };

  return (
    <>
      {!isMobileViewport && (
        <div
          aria-hidden="true"
          onClick={closeAudioStudio}
          className="fixed inset-0 z-[64] bg-black/50 sm:hidden"
        />
      )}
      <div
        role="dialog"
        aria-modal={isMobileViewport ? 'true' : 'false'}
        aria-label={
          audioPanelTab === 'dj'
            ? 'Modo Sesión DJ y Efectos'
            : audioPanelTab === 'display'
              ? nowPlayingOpen
                ? 'Ajustes de pantalla completa'
                : 'Estilo de barra de reproducción'
              : 'Ecualizador y Crossfade'
        }
        data-testid={audioPanelTab === 'dj' ? 'dj-popover' : 'eq-sheet'}
        className={
          isMobileViewport
            ? 'pm-canvas pm-page-enter fixed inset-0 z-[95] flex flex-col overflow-y-auto px-4 pb-[max(2.25rem,var(--pm-safe-bottom,env(safe-area-inset-bottom)))] pm-no-scrollbar'
            : `pm-glass-frosted-neutral pm-hud-dark pm-popover-enter fixed inset-x-0 bottom-0 z-[65] max-h-[82dvh] overflow-y-auto rounded-t-[28px] px-5 pt-3 pb-[max(1.5rem,var(--pm-safe-bottom,env(safe-area-inset-bottom)))] pm-no-scrollbar sm:inset-x-auto sm:mx-0 sm:w-[376px] sm:rounded-[24px] sm:p-4 ${
                nowPlayingOpen
                  ? 'sm:right-6 sm:bottom-[74px]'
                  : playerBarStyle === 'floating-island'
                    ? 'sm:right-[max(16px,calc(50%-440px))] sm:bottom-[94px]'
                    : 'sm:right-6 sm:bottom-[104px]'
              }`
        }
      >
        {isMobileViewport ? (
          <header className="pm-mobile-glass-header sticky top-0 z-20 -mx-4 mb-4 flex shrink-0 items-center justify-between gap-3 px-4 pt-[max(0.85rem,var(--pm-safe-top,env(safe-area-inset-top)))] pb-3">
            <button
              type="button"
              aria-label="Volver"
              onClick={closeAudioStudio}
              className="pm-pressable inline-flex h-10 items-center gap-2 rounded-full px-2 text-sm font-semibold pm-text-primary hover:bg-white/[0.08]"
            >
              <ArrowLeft className="h-5 w-5" />
              <span>
                {audioPanelTab === 'dj'
                  ? 'Sesión DJ'
                  : audioPanelTab === 'display'
                    ? 'Pantalla y Barra'
                    : 'Audio y Ecualizador'}
              </span>
            </button>
          </header>
        ) : (
          <div className="mb-3 flex items-center justify-between gap-2 sm:hidden">
            <div className="w-7" aria-hidden="true" />
            <div className="h-1 w-10 rounded-full bg-white/25" />
            <button
              type="button"
              aria-label="Cerrar estudio de audio"
              onClick={closeAudioStudio}
              className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-white/80 hover:bg-white/20 hover:text-white"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* Frosted Segmented Switcher: Sesión DJ | Audio y EQ | Barra / Pantalla */}
        <div
          data-testid="audio-studio-sheet"
          className="mb-4 flex items-center justify-between gap-1 rounded-full bg-white/[0.08] p-1"
        >
          <button
            type="button"
            data-testid="audio-panel-tab-dj"
            onClick={() => setAudioPanelTab('dj')}
            className={`flex flex-1 items-center justify-center gap-1 rounded-full py-1.5 text-[11.5px] font-bold transition-colors ${
              audioPanelTab === 'dj'
                ? 'bg-white text-[#070709] shadow-sm'
                : 'text-white/75 hover:text-white'
            }`}
          >
            <Disc3 className={`h-3.5 w-3.5 ${djMode.enabled && audioPanelTab !== 'dj' ? 'text-purple-300' : ''}`} />
            <span>Sesión DJ</span>
          </button>
          <button
            type="button"
            data-testid="audio-panel-tab-eq"
            onClick={() => setAudioPanelTab('eq')}
            className={`flex flex-1 items-center justify-center gap-1 rounded-full py-1.5 text-[11.5px] font-bold transition-colors ${
              audioPanelTab === 'eq'
                ? 'bg-white text-[#070709] shadow-sm'
                : 'text-white/75 hover:text-white'
            }`}
          >
            <Sliders className="h-3.5 w-3.5" />
            <span>Audio y EQ</span>
          </button>
          <button
            type="button"
            data-testid="audio-panel-tab-display"
            onClick={() => setAudioPanelTab('display')}
            className={`flex flex-1 items-center justify-center gap-1 rounded-full py-1.5 text-[11.5px] font-bold transition-colors ${
              audioPanelTab === 'display'
                ? 'bg-white text-[#070709] shadow-sm'
                : 'text-white/75 hover:text-white'
            }`}
          >
            <Palette className="h-3.5 w-3.5" />
            <span>{thirdTabLabel}</span>
          </button>
        </div>

        {audioPanelTab === 'dj' ? (
          <div>
            {isGuestInJam && (
              <div
                data-testid="studio-jam-dj-locked"
                className="mb-3 flex items-center gap-2 rounded-[12px] border border-amber-400/30 bg-amber-500/12 px-3 py-2 text-[11px] font-semibold text-amber-200"
              >
                <Lock className="h-3.5 w-3.5 shrink-0" />
                <span>Solo el jefe de la Jam puede cambiar esto</span>
              </div>
            )}
            <div
              aria-disabled={isGuestInJam || undefined}
              className={isGuestInJam ? 'pointer-events-none select-none opacity-45' : ''}
            >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-[15px] font-bold leading-tight">
                  AutoMix Pro DJ
                </h2>
                <p className="mt-0.5 text-[11.5px] opacity-70">
                  {ana
                    ? `${Math.round(ana.bpm)} BPM${ana.camelotKey ? ` · ${ana.camelotKey}` : ''} · Stems & Bucles`
                    : 'Algoritmo inteligente por pista'}
                </p>
              </div>
              <PMusicSwitch
                variant="hud"
                testId="dj-mode-toggle"
                checked={djMode.enabled}
                ariaLabel="Activar Modo Sesión DJ"
                onChange={() => void toggleDjMode()}
              />
            </div>

            {/* Curated Radio Full DJ Button */}
            <button
              type="button"
              data-testid="start-full-dj-radio-btn"
              onClick={() => {
                void startFullDjRadio();
                setDjPopoverOpen(false);
                setEqSheetOpen(false);
              }}
              className="pm-pressable mt-3 flex w-full items-center justify-between gap-2 rounded-[14px] border border-white/15 bg-white/[0.08] px-3.5 py-2.5 text-left transition-colors hover:bg-white/[0.15]"
            >
              <div className="flex items-center gap-2.5">
                <Radio className="h-4 w-4 shrink-0 text-white" />
                <div>
                  <div className="text-xs font-bold">Radio Full DJ</div>
                  <div className="text-[11px] opacity-70">
                    Selecciona y ordena tus gustos para mezclas perfectas
                  </div>
                </div>
              </div>
              <Play className="h-3.5 w-3.5 shrink-0 fill-current opacity-80" />
            </button>

            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                type="button"
                data-testid="dj-style-quick"
                aria-pressed={djMode.enabled && djMode.style === 'quick'}
                onClick={() => void setDjSessionStyle('quick')}
                className={`pm-pressable flex flex-col items-start gap-1 rounded-[14px] border p-2.5 text-left transition-all ${
                  djMode.enabled && djMode.style === 'quick'
                    ? 'border-white/70 bg-white/[0.18] shadow-sm'
                    : 'border-white/10 bg-white/[0.06] opacity-80 hover:bg-white/[0.12]'
                }`}
              >
                <span className="text-xs font-bold">Rápida</span>
                <span className="text-[11px] leading-snug opacity-75">
                  Directo al drop y mezcla ágil
                </span>
              </button>

              <button
                type="button"
                data-testid="dj-style-full"
                aria-pressed={djMode.enabled && djMode.style === 'full'}
                onClick={() => void setDjSessionStyle('full')}
                className={`pm-pressable flex flex-col items-start gap-1 rounded-[14px] border p-2.5 text-left transition-all ${
                  djMode.enabled && djMode.style === 'full'
                    ? 'border-white/70 bg-white/[0.18] shadow-sm'
                    : 'border-white/10 bg-white/[0.06] opacity-80 hover:bg-white/[0.12]'
                }`}
              >
                <span className="text-xs font-bold">Completa</span>
                <span className="text-[11px] leading-snug opacity-75">
                  Duración adaptativa 2–12 compases
                </span>
              </button>
            </div>

            {/* FX Choreography Toggles */}
            <div className="mt-3">
              <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wider opacity-60">
                Efectos y stems permitidos
              </div>
              <div className="flex flex-wrap gap-1.5">
                {DJ_FX_ITEMS.map((fx) => {
                  const active = djMode.enabledTransitions?.[fx.key] ?? true;
                  return (
                    <button
                      key={fx.key}
                      type="button"
                      aria-pressed={active}
                      onClick={() => toggleDjFx(fx.key)}
                      className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                        active
                          ? 'border-white/55 bg-white/[0.18] text-white'
                          : 'border-white/10 bg-white/[0.05] text-white/55 hover:bg-white/[0.12]'
                      }`}
                    >
                      {fx.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {djMode.enabled && (
              <div className="mt-3 space-y-2 border-t border-white/10 pt-3">
                {activeTransitionPlan?.choreography?.activeLayers &&
                  activeTransitionPlan.choreography.activeLayers.length > 0 && (
                    <div className="flex flex-wrap gap-1" data-testid="dj-active-layers">
                      {activeTransitionPlan.choreography.activeLayers.map((layerLabel) => (
                        <span
                          key={layerLabel}
                          className="rounded-full border border-white/15 bg-white/[0.08] px-2 py-0.5 text-[10px] font-semibold text-white/85"
                        >
                          {layerLabel}
                        </span>
                      ))}
                    </div>
                  )}
                {activeTransitionPlan?.choreography?.summary && (
                  <p className="text-[11px] opacity-75">
                    {activeTransitionPlan.choreography.summary}
                  </p>
                )}
                <div className="flex items-center justify-between gap-2">
                  <span className="tabular-nums text-[11px] opacity-80">
                    {isTransitioning
                      ? 'Mezclando pistas ahora…'
                      : activeTransitionPlan && countdownSec !== null
                        ? `Cruce auto en ${countdownSec}s (${formatDurationSec(activeTransitionPlan.cueOutSec)})`
                        : 'Preparando siguiente cruce…'}
                  </span>
                  <button
                    type="button"
                    data-testid="dj-mix-now-btn"
                    disabled={isTransitioning}
                    onClick={() => void triggerDjMixNow()}
                    className="pm-pressable rounded-full bg-white px-3 py-1 text-[11px] font-bold text-[#070709] shadow-sm transition-opacity hover:opacity-90 disabled:opacity-50"
                  >
                    Mezclar ahora
                  </button>
                </div>
              </div>
            )}
            </div>
          </div>
        ) : audioPanelTab === 'eq' ? (
          <div>
            {isGuestInJam && (
              <div
                data-testid="studio-jam-eq-locked"
                className="mb-3 flex items-center gap-2 rounded-[12px] border border-amber-400/30 bg-amber-500/12 px-3 py-2 text-[11px] font-semibold text-amber-200"
              >
                <Lock className="h-3.5 w-3.5 shrink-0" />
                <span>Solo el jefe de la Jam puede cambiar esto (EQ y Crossfade)</span>
              </div>
            )}
            <div
              aria-disabled={isGuestInJam || undefined}
              className={isGuestInJam ? 'pointer-events-none select-none opacity-45' : ''}
            >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-[15px] font-bold leading-tight">Ecualizador</h2>
                <p className="mt-0.5 text-[11.5px] opacity-70">
                  Moldea el sonido banda por banda
                </p>
              </div>
              <PMusicSwitch
                variant="hud"
                checked={userEq.enabled}
                ariaLabel="Activar ecualizador"
                onChange={() => setEqEnabled(!userEq.enabled)}
              />
            </div>

            <div className="mt-3.5 grid grid-cols-3 gap-1.5">
              {USER_EQ_PRESETS.map((preset) => {
                const active = userEq.preset === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setEqPreset(preset.id)}
                    className={`rounded-[10px] py-1.5 text-[11.5px] font-bold transition-all ${
                      active
                        ? 'bg-white text-[#070709] shadow-sm'
                        : 'bg-white/[0.08] opacity-80 hover:bg-white/[0.15]'
                    }`}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>

            <div className="mt-4 grid grid-cols-5 gap-2">
              {USER_EQ_FREQUENCIES_HZ.map((freq, idx) => {
                const label = freq >= 1000 ? `${freq / 1000}k` : `${freq}`;
                const ariaFreq = freq >= 1000 ? `${freq / 1000} kHz` : `${freq} Hz`;
                const val = userEq.bandsDb[idx] ?? 0;
                const pct = Math.max(0, Math.min(100, ((val + 12) / 24) * 100));
                return (
                  <div key={freq} className="flex flex-col items-center gap-1.5">
                    <span className="tabular-nums text-[11px] font-semibold">
                      {val > 0 ? `+${val}` : val}
                    </span>
                    <div className="relative flex h-28 w-7 items-center justify-center">
                      <div className="pointer-events-none relative h-24 w-1.5 overflow-hidden rounded-full bg-white/18">
                        <div
                          className="absolute inset-x-0 bottom-0 rounded-full bg-white/75"
                          style={{ height: `${pct}%` }}
                        />
                      </div>
                      <div
                        aria-hidden="true"
                        className="pointer-events-none absolute left-1/2 h-3 w-4 -translate-x-1/2 translate-y-1/2 rounded-full bg-white shadow-md"
                        style={{ bottom: `calc(${pct * 0.86}% + 7px)` }}
                      />
                      <input
                        type="range"
                        role="slider"
                        aria-label={`Banda EQ ${ariaFreq}`}
                        min={-12}
                        max={12}
                        step={0.5}
                        value={val}
                        onChange={(e) => setEqBandGain(idx, Number(e.target.value))}
                        className="pm-eq-vertical absolute inset-0 h-full w-full opacity-0"
                      />
                    </div>
                    <span className="tabular-nums text-[11px] font-medium opacity-70">
                      {label}
                    </span>
                  </div>
                );
              })}
            </div>

            <div className="mt-3.5 border-t border-white/10 pt-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <span className="text-xs font-bold">Crossfade</span>
                  <span className="ml-2 text-[11px] opacity-70">
                    {djMode.enabled ? 'En pausa con DJ' : `${safeCrossfade.durationSec} s`}
                  </span>
                </div>
                <PMusicSwitch
                  variant="hud"
                  checked={safeCrossfade.enabled && !djMode.enabled}
                  ariaLabel="Activar Crossfade seguro"
                  disabled={djMode.enabled}
                  onChange={() =>
                    setSafeCrossfade({
                      enabled: djMode.enabled ? true : !safeCrossfade.enabled,
                      durationSec:
                        safeCrossfade.durationSec > 0 ? safeCrossfade.durationSec : 4,
                    })
                  }
                />
              </div>
              <input
                type="range"
                role="slider"
                aria-label="Duración de Crossfade en segundos"
                min={0}
                max={12}
                step={1}
                value={safeCrossfade.durationSec}
                onChange={(e) =>
                  setSafeCrossfade({ durationSec: Number(e.target.value) })
                }
                style={{ '--pm-fill': `${crossfadePct}%` } as React.CSSProperties}
                className="pm-range-pill mt-2 w-full cursor-pointer"
              />
            </div>

            {/* Sound Quality & Volume Normalization */}
            <div className="mt-3.5 space-y-2.5 border-t border-white/10 pt-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold">Calidad de sonido</span>
                <span className="text-[11px] opacity-70">
                  {streamQuality === 'high'
                    ? 'Máxima · 48 kHz'
                    : streamQuality === 'medium'
                      ? 'Alta · 128k'
                      : 'Normal · 64k'}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {(
                  [
                    { id: 'low', label: 'Normal' },
                    { id: 'medium', label: 'Alta' },
                    { id: 'high', label: 'Máxima' },
                  ] as const
                ).map((q) => {
                  const selected = streamQuality === q.id;
                  return (
                    <button
                      key={q.id}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => setStreamQuality(q.id as AudioStreamQuality)}
                      className={`rounded-[10px] py-1.5 text-[11px] font-bold transition-all ${
                        selected
                          ? 'bg-white text-[#070709] shadow-sm'
                          : 'bg-white/[0.08] opacity-80 hover:bg-white/[0.15]'
                      }`}
                    >
                      {q.label}
                    </button>
                  );
                })}
              </div>

              <div className="flex items-center justify-between pt-1">
                <div>
                  <span className="text-xs font-semibold">Normalizar volumen</span>
                  <p className="text-[10.5px] opacity-60">Iguala el nivel entre pistas</p>
                </div>
                <PMusicSwitch
                  variant="hud"
                  checked={audioNormalization}
                  ariaLabel="Normalizar volumen"
                  onChange={() => setAudioNormalization(!audioNormalization)}
                />
              </div>
            </div>
            </div>
          </div>
        ) : !nowPlayingOpen ? (
          <div data-testid="dock-style-panel">
            <div>
              <h2 className="text-[15px] font-bold leading-tight">Barra de reproducción</h2>
              <p className="mt-0.5 text-[11.5px] opacity-70">
                Elige el estilo del reproductor inferior
              </p>
            </div>

            <div className="mt-3.5 grid grid-cols-1 gap-2">
              {PLAYER_BAR_STYLE_OPTIONS.map((opt) => {
                const selected = playerBarStyle === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    data-testid={`studio-bar-style-${opt.id}`}
                    aria-pressed={selected}
                    onClick={() => setPlayerBarStyle(opt.id)}
                    className={`flex items-center justify-between gap-3 rounded-[10px] px-3 py-2.5 text-left transition-all ${
                      selected
                        ? 'bg-white text-[#070709] shadow-sm'
                        : 'bg-white/[0.08] opacity-85 hover:bg-white/[0.15] hover:opacity-100'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-bold leading-tight">{opt.label}</div>
                      <div
                        className={`mt-0.5 truncate text-[10.5px] ${
                          selected ? 'text-[#070709]/70' : 'opacity-65'
                        }`}
                      >
                        {opt.desc}
                      </div>
                    </div>
                    {selected && <Check className="h-4 w-4 shrink-0" />}
                  </button>
                );
              })}
            </div>

            <div className="mt-3.5 space-y-2.5 border-t border-white/10 pt-3">
              {[
                {
                  testId: 'dock-pref-always-shuffle-switch',
                  label: 'Aleatorio siempre activo',
                  desc: 'Mantiene el modo aleatorio al abrir playlists',
                  checked: alwaysShuffle,
                  onToggle: () => setAlwaysShuffle(!alwaysShuffle),
                },
                {
                  testId: 'dock-pref-marquee-switch',
                  label: 'Texto deslizante si no cabe',
                  desc: 'Desplaza títulos y artistas largos',
                  checked: marqueeTextEnabled,
                  onToggle: () => setMarqueeTextEnabled(!marqueeTextEnabled),
                },
                {
                  testId: 'dock-pref-same-album-skip-switch',
                  label: 'Omitir transición en mismo álbum',
                  desc: 'Deja fija la portada si coincide',
                  checked: skipSameAlbumCoverTransition,
                  onToggle: () => setSkipSameAlbumCoverTransition(!skipSameAlbumCoverTransition),
                },
                {
                  testId: 'dock-pref-remaining-time-switch',
                  label: 'Mostrar tiempo restante',
                  desc: 'Cuenta regresiva en lugar de duración total',
                  checked: showRemainingTime,
                  onToggle: () => setShowRemainingTime(!showRemainingTime),
                },
              ].map((sw) => (
                <div
                  key={sw.testId}
                  onClick={sw.onToggle}
                  className="flex cursor-pointer items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="text-xs font-bold leading-tight">{sw.label}</div>
                    <div className="text-[10.5px] leading-tight opacity-65">{sw.desc}</div>
                  </div>
                  <PMusicSwitch
                    variant="hud"
                    testId={sw.testId}
                    checked={sw.checked}
                    ariaLabel={sw.label}
                    onChange={sw.onToggle}
                  />
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div data-testid="nowplaying-display-panel" className="space-y-3.5">
            <div>
              <h2 className="text-[15px] font-bold leading-tight">Fondo en pantalla completa</h2>
              <p className="mt-0.5 text-[11.5px] opacity-70">
                Personaliza ambiente visual y letras al vuelo
              </p>
            </div>

            <div className="grid grid-cols-2 gap-1.5">
              {BACKDROP_STYLE_OPTIONS.map((opt) => {
                const selected = nowPlayingBackdropStyle === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    data-testid={`backdrop-style-${opt.id}`}
                    aria-pressed={selected}
                    onClick={() => setNowPlayingBackdropStyle(opt.id)}
                    className={`flex items-center gap-2 rounded-[10px] px-2.5 py-2 text-left transition-all ${
                      selected
                        ? 'bg-white text-[#070709] shadow-sm'
                        : 'bg-white/[0.08] opacity-85 hover:bg-white/[0.15] hover:opacity-100'
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className="h-5 w-5 shrink-0 rounded-full ring-1 ring-white/20"
                      style={
                        opt.id === 'fluid'
                          ? { background: 'linear-gradient(135deg, var(--pm-ambient-1), var(--pm-ambient-2))' }
                          : opt.id === 'paint'
                            ? { background: 'conic-gradient(from 20deg, #ff3d8b, var(--pm-ambient-1), #38bdf8, var(--pm-ambient-2), #ff3d8b)' }
                            : opt.id === 'pulse'
                              ? { background: 'radial-gradient(circle, var(--pm-ambient-1) 0%, var(--pm-ambient-2) 55%, #160f24 100%)', filter: 'blur(0.5px)' }
                              : { background: '#111116' }
                      }
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-[11px] font-bold leading-tight">
                        {opt.label}
                      </span>
                      <span
                        className={`block truncate text-[9.5px] leading-tight ${
                          selected ? 'text-[#070709]/65' : 'opacity-60'
                        }`}
                      >
                        {opt.desc}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="border-t border-white/10 pt-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-xs font-bold">Estilo de letras</span>
                <div className="flex items-center gap-1 rounded-[10px] bg-white/[0.08] p-0.5">
                  {(['normal', 'large', 'xl'] as const).map((sz) => (
                    <button
                      key={sz}
                      type="button"
                      onClick={() => setLyricsSize(sz)}
                      className={`rounded-[8px] px-2 py-0.5 text-[10.5px] font-bold transition-colors ${
                        lyricsSize === sz
                          ? 'bg-white text-[#070709] shadow-sm'
                          : 'opacity-75 hover:opacity-100'
                      }`}
                    >
                      {sz === 'normal' ? 'N' : sz === 'large' ? 'G' : 'XL'}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-4 gap-1.5">
                {LYRICS_STYLE_OPTIONS.map((opt) => {
                  const selected = lyricsStyle === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      data-testid={`display-lyrics-style-${opt.id}`}
                      aria-pressed={selected}
                      onClick={() => setLyricsStyle(opt.id)}
                      className={`flex flex-col items-center justify-center gap-0.5 rounded-[10px] px-1.5 py-2 text-center transition-all ${
                        selected
                          ? 'bg-white text-[#070709] shadow-sm'
                          : 'bg-white/[0.08] opacity-85 hover:bg-white/[0.15] hover:opacity-100'
                      }`}
                    >
                      <span className={`text-[15px] leading-none ${opt.previewClass}`}>Aa</span>
                      <span className="max-w-full truncate text-[10px] font-semibold">
                        {opt.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2.5 border-t border-white/10 pt-3">
              {[
                {
                  testId: 'pref-always-shuffle-switch',
                  label: 'Aleatorio siempre activo',
                  desc: 'Mantiene el modo aleatorio al abrir playlists',
                  checked: alwaysShuffle,
                  onToggle: () => setAlwaysShuffle(!alwaysShuffle),
                },
                {
                  testId: 'pref-same-album-skip-switch',
                  label: 'Omitir transición en mismo álbum',
                  desc: 'Deja fija la portada si coincide',
                  checked: skipSameAlbumCoverTransition,
                  onToggle: () => setSkipSameAlbumCoverTransition(!skipSameAlbumCoverTransition),
                },
                {
                  testId: 'pref-marquee-switch',
                  label: 'Texto deslizante si no cabe',
                  desc: 'Desplaza títulos y artistas largos y pausa en crossfade',
                  checked: marqueeTextEnabled,
                  onToggle: () => setMarqueeTextEnabled(!marqueeTextEnabled),
                },
                {
                  testId: 'pref-ambient-motion-switch',
                  label: 'Fondo animado vivo',
                  desc: 'Movimiento fluido del color de la portada',
                  checked: ambientMotionEnabled,
                  onToggle: () => setAmbientMotionEnabled(!ambientMotionEnabled),
                },
                {
                  testId: 'pref-lyrics-blur-switch',
                  label: 'Desenfoque en otros versos',
                  desc: 'Enfoca el verso activo en letras sincronizadas',
                  checked: lyricsBlurEnabled,
                  onToggle: () => setLyricsBlurEnabled(!lyricsBlurEnabled),
                },
                {
                  testId: 'pref-remaining-time-switch',
                  label: 'Mostrar tiempo restante',
                  desc: 'Cuenta regresiva en lugar de duración total',
                  checked: showRemainingTime,
                  onToggle: () => setShowRemainingTime(!showRemainingTime),
                },
              ].map((item) => (
                <div key={item.testId} className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs font-semibold leading-tight">{item.label}</div>
                    <p className="text-[10.5px] opacity-60">{item.desc}</p>
                  </div>
                  <PMusicSwitch
                    variant="hud"
                    ariaLabel={item.label}
                    testId={item.testId}
                    checked={item.checked}
                    onChange={item.onToggle}
                  />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
};

export const EqAndCrossfadeSheet = AudioStudioSheet;
export const DjPopover: React.FC = () => null;

export const DevicesConnectSheet: React.FC = React.memo(() => {
  const devicesSheetOpen = usePMusicStore((s) => s.devicesSheetOpen);
  if (!devicesSheetOpen) return null;
  return <DevicesConnectSheetInner />;
});
DevicesConnectSheet.displayName = 'DevicesConnectSheet';

const DevicesConnectSheetInner: React.FC = () => {
  const {
    devicesSheetOpen,
    setDevicesSheetOpen,
    onlineDevices,
    selfDeviceId,
    deviceName,
    syncMode,
    authState,
    lastTransferBanner,
    remoteControlledDeviceId,
    remoteDeviceSnapshot,
    transferPlaybackToDevice,
    pullPlaybackFromDevice,
    sendRemoteDeviceCommand,
    setRemoteControlledDevice,
    setDeviceName,
    signInSupabase,
    signUpSupabase,
    pairDemoCompanionDevice,
    setSettingsOpen,
    nowPlayingOpen,
    playerBarStyle,
    activeJamSession,
    startJam,
    joinJamInApp,
    setNowPlayingOpen,
    setNowPlayingTab,
    setJamInviteModalOpen,
  } = usePMusicStore();

  const [joinCodeDraft, setJoinCodeDraft] = useState('');
  const [quickEmail, setQuickEmail] = useState('');
  const [quickPassword, setQuickPassword] = useState('');
  const [quickAuthMode, setQuickAuthMode] = useState<'signin' | 'signup'>('signin');
  const [quickAuthBusy, setQuickAuthBusy] = useState(false);
  const [quickAuthMsg, setQuickAuthMsg] = useState<string | null>(null);
  const [remoteVol, setRemoteVol] = useState(85);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(deviceName);
  const [isMobileViewport, setIsMobileViewport] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth < 768 : false
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const syncVp = () => setIsMobileViewport(window.innerWidth < 768);
    window.addEventListener('resize', syncVp);
    return () => window.removeEventListener('resize', syncVp);
  }, []);

  useEffect(() => {
    setNameDraft(deviceName);
  }, [deviceName]);

  useEffect(() => {
    if (remoteDeviceSnapshot) {
      setRemoteVol(Math.round(remoteDeviceSnapshot.volume * 100));
    }
  }, [remoteDeviceSnapshot]);

  useEffect(() => {
    if (!devicesSheetOpen || isMobileViewport) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest(
          '[data-testid="devices-sheet"], [data-testid="dock-connect-btn"], [data-testid="mobile-devices-btn"], [data-testid="island-effect-connect"], [data-testid="sidebar-devices-btn"]'
        )
      ) {
        return;
      }
      setDevicesSheetOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [devicesSheetOpen, isMobileViewport, setDevicesSheetOpen]);

  if (!devicesSheetOpen) return null;

  const peerDevices = onlineDevices.filter((d) => d.device_id !== selfDeviceId);
  const selfDevice = onlineDevices.find((d) => d.device_id === selfDeviceId);

  const handleQuickAuth = async () => {
    setQuickAuthMsg(null);
    setQuickAuthBusy(true);
    try {
      if (quickAuthMode === 'signup') {
        const res = await signUpSupabase(quickEmail, quickPassword);
        setQuickAuthMsg(
          res.needsEmailConfirmation
            ? 'Cuenta creada. Confirma tu email para conectar tus dispositivos.'
            : '¡Cuenta creada y conectada en vivo!'
        );
      } else {
        await signInSupabase(quickEmail, quickPassword);
        setQuickAuthMsg('¡Conectado! Tus dispositivos aparecerán automáticamente.');
      }
    } catch (err) {
      setQuickAuthMsg(err instanceof Error ? err.message : 'No se pudo conectar');
    } finally {
      setQuickAuthBusy(false);
    }
  };

  return (
    <>
      {!isMobileViewport && (
        <div
          aria-hidden="true"
          onClick={() => setDevicesSheetOpen(false)}
          className="fixed inset-0 z-[64] bg-black/50 sm:hidden"
        />
      )}
      <div
        role="dialog"
        aria-modal={isMobileViewport ? 'true' : 'false'}
        aria-label="Dispositivos conectados"
        data-testid="devices-sheet"
        className={
          isMobileViewport
            ? 'pm-canvas pm-page-enter fixed inset-0 z-[95] flex flex-col overflow-y-auto px-4 pb-[max(2.25rem,var(--pm-safe-bottom,env(safe-area-inset-bottom)))] pm-no-scrollbar'
            : `pm-glass-frosted-neutral pm-hud-dark pm-popover-enter fixed inset-x-0 bottom-0 z-[65] max-h-[82dvh] overflow-y-auto rounded-t-[28px] px-5 pt-3 pb-[max(1.5rem,var(--pm-safe-bottom,env(safe-area-inset-bottom)))] pm-no-scrollbar sm:inset-x-auto sm:mx-0 sm:w-[376px] sm:rounded-[24px] sm:p-4 ${
                nowPlayingOpen
                  ? 'sm:right-6 sm:bottom-[74px]'
                  : playerBarStyle === 'floating-island'
                    ? 'sm:right-[max(16px,calc(50%-440px))] sm:bottom-[94px]'
                    : 'sm:right-6 sm:bottom-[104px]'
              }`
        }
      >
        {isMobileViewport ? (
          <header className="pm-mobile-glass-header sticky top-0 z-20 -mx-4 mb-4 flex shrink-0 items-center justify-between gap-3 px-4 pt-[max(0.85rem,var(--pm-safe-top,env(safe-area-inset-top)))] pb-3">
            <button
              type="button"
              aria-label="Volver"
              onClick={() => setDevicesSheetOpen(false)}
              className="pm-pressable inline-flex h-10 items-center gap-2 rounded-full px-2 text-sm font-semibold pm-text-primary hover:bg-white/[0.08]"
            >
              <ArrowLeft className="h-5 w-5" />
              <span>Dispositivos y Jam</span>
            </button>
          </header>
        ) : (
          <div className="mb-3 flex items-center justify-between gap-2 sm:hidden">
            <div className="w-7" aria-hidden="true" />
            <div className="h-1 w-10 rounded-full bg-white/25" />
            <button
              type="button"
              aria-label="Cerrar dispositivos"
              onClick={() => setDevicesSheetOpen(false)}
              className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-white/80 hover:bg-white/20 hover:text-white"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        <div className="flex items-center justify-between gap-2 border-b border-white/10 pb-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/15 bg-white/[0.08] text-white">
              <Wifi className="h-4 w-4" />
              <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-emerald-400 ring-2 ring-[#070709] animate-pulse" />
            </span>
            <div className="min-w-0">
              <h2 className="truncate text-[15px] font-bold leading-tight">
                pMusic Connect
              </h2>
              <p className="mt-0.5 truncate text-[11px] opacity-70">
                {onlineDevices.length} {onlineDevices.length === 1 ? 'dispositivo activo' : 'dispositivos en vivo'} · al milisegundo
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              setDevicesSheetOpen(false);
              if (activeJamSession?.active) {
                setNowPlayingOpen(true);
                setNowPlayingTab('Cola');
                setJamInviteModalOpen(true);
              } else {
                void startJam({ openSheet: true });
              }
            }}
            className="shrink-0 rounded-full bg-white px-3 py-1 text-[11px] font-bold text-[#070709] shadow-sm transition-opacity hover:opacity-90"
          >
            {activeJamSession?.active ? `Jam · ${activeJamSession.code}` : 'Iniciar Jam'}
          </button>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!joinCodeDraft.trim()) return;
            setDevicesSheetOpen(false);
            void joinJamInApp(joinCodeDraft);
            setJoinCodeDraft('');
          }}
          className="mt-2.5 flex items-center gap-1.5"
        >
          <input
            type="text"
            value={joinCodeDraft}
            onChange={(e) => setJoinCodeDraft(e.target.value.toUpperCase())}
            placeholder="Código Jam de un amigo (ej. AB3K9P)"
            className="min-w-0 flex-1 rounded-full border border-white/12 bg-white/[0.06] px-3 py-1.5 text-[11px] text-white placeholder:text-white/40 focus:border-white/35 focus:outline-none"
          />
          <button
            type="submit"
            className="shrink-0 rounded-full bg-white/15 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-white/25"
          >
            Unirse
          </button>
        </form>

        {lastTransferBanner && (
          <div className="mt-3 flex items-center justify-between gap-2 rounded-[12px] border border-emerald-400/35 bg-emerald-500/15 px-3 py-2 text-[11.5px] font-semibold text-emerald-200">
            <span className="truncate">{lastTransferBanner}</span>
            {remoteControlledDeviceId && (
              <button
                type="button"
                onClick={() => setRemoteControlledDevice(null)}
                className="shrink-0 rounded-full bg-emerald-500/25 px-2.5 py-0.5 text-[10.5px] font-bold text-emerald-100 hover:bg-emerald-500/35"
              >
                Soltar
              </button>
            )}
          </div>
        )}

        {/* Inline Account Connect card when not signed in */}
        {!authState.connected && (
          <div className="mt-3 space-y-2.5 rounded-[14px] border border-white/10 bg-white/[0.06] p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-xs font-bold leading-tight">
                  Conecta tu cuenta en PC y móvil
                </div>
                <div className="mt-0.5 text-[10.5px] opacity-70">
                  Mismo correo para sincronizar en vivo
                </div>
              </div>
              <div className="flex shrink-0 rounded-full bg-white/[0.08] p-0.5 text-[10.5px] font-bold">
                <button
                  type="button"
                  onClick={() => setQuickAuthMode('signin')}
                  className={`rounded-full px-2 py-0.5 transition-colors ${
                    quickAuthMode === 'signin'
                      ? 'bg-white text-[#070709]'
                      : 'text-white/70 hover:text-white'
                  }`}
                >
                  Entrar
                </button>
                <button
                  type="button"
                  onClick={() => setQuickAuthMode('signup')}
                  className={`rounded-full px-2 py-0.5 transition-colors ${
                    quickAuthMode === 'signup'
                      ? 'bg-white text-[#070709]'
                      : 'text-white/70 hover:text-white'
                  }`}
                >
                  Crear
                </button>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-1.5">
              <input
                type="email"
                placeholder="tu@email.com"
                value={quickEmail}
                onChange={(e) => setQuickEmail(e.target.value)}
                className="w-full rounded-[10px] border border-white/12 bg-white/[0.06] px-3 py-1.5 text-xs text-white placeholder:text-white/40 focus:border-white/35 focus:outline-none"
              />
              <input
                type="password"
                placeholder="Contraseña (mín. 6 caracteres)"
                value={quickPassword}
                onChange={(e) => setQuickPassword(e.target.value)}
                className="w-full rounded-[10px] border border-white/12 bg-white/[0.06] px-3 py-1.5 text-xs text-white placeholder:text-white/40 focus:border-white/35 focus:outline-none"
              />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                disabled={quickAuthBusy}
                onClick={() => void handleQuickAuth()}
                className="rounded-full bg-white px-3.5 py-1.5 text-[11px] font-bold text-[#070709] shadow-sm transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                {quickAuthBusy
                  ? 'Conectando…'
                  : quickAuthMode === 'signup'
                    ? 'Crear cuenta'
                    : 'Iniciar sesión'}
              </button>
              {quickAuthMsg && (
                <span className="text-[10.5px] font-medium opacity-80">
                  {quickAuthMsg}
                </span>
              )}
            </div>
          </div>
        )}

        {/* Current Device Hero Card */}
        {selfDevice && (
          <div className="mt-3 space-y-1.5">
            <div className="text-[10.5px] font-bold uppercase tracking-wider opacity-60">
              Este dispositivo
            </div>
            <div className="flex items-center justify-between gap-2.5 rounded-[14px] border border-emerald-400/30 bg-white/[0.06] p-3">
              <div className="flex min-w-0 flex-1 items-center gap-2.5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500/18 text-emerald-400">
                  {selfDevice.platform === 'android' ? (
                    <Smartphone className="h-4 w-4" />
                  ) : (
                    <Laptop className="h-4 w-4" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  {editingName ? (
                    <div className="flex items-center gap-1.5">
                      <input
                        type="text"
                        value={nameDraft}
                        onChange={(e) => setNameDraft(e.target.value)}
                        className="w-36 rounded-lg border border-white/15 bg-white/[0.08] px-2 py-1 text-xs text-white focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          void setDeviceName(nameDraft);
                          setEditingName(false);
                        }}
                        className="rounded-full bg-white px-2.5 py-1 text-[10.5px] font-bold text-[#070709]"
                      >
                        Guardar
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-1.5 text-xs font-bold">
                      <span className="truncate">{selfDevice.device_name}</span>
                      {!remoteControlledDeviceId && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                          Activo
                        </span>
                      )}
                    </div>
                  )}
                  <div className="mt-0.5 truncate text-[11px] opacity-70">
                    {selfDevice.track_title}
                  </div>
                </div>
              </div>
              {!editingName && (
                <button
                  type="button"
                  onClick={() => setEditingName(true)}
                  className="shrink-0 rounded-full bg-white/[0.08] px-2.5 py-1 text-[10.5px] font-semibold hover:bg-white/[0.15]"
                >
                  Renombrar
                </button>
              )}
            </div>
          </div>
        )}

        {/* Peer Devices */}
        <div className="mt-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10.5px] font-bold uppercase tracking-wider opacity-60">
              Otros dispositivos ({peerDevices.length})
            </span>
          </div>

          {peerDevices.length === 0 ? (
            <div className="rounded-[12px] border border-white/10 bg-white/[0.05] p-3 text-center text-[11px] opacity-75">
              Abre pMusic en tu PC o móvil con la misma cuenta para verlos aparecer aquí.
            </div>
          ) : (
            peerDevices.map((dev) => {
              const isRemoteTarget = remoteControlledDeviceId === dev.device_id;
              return (
                <div
                  key={dev.device_id}
                  className={`flex flex-col gap-2.5 rounded-[14px] border p-3 transition-all ${
                    isRemoteTarget
                      ? 'border-emerald-400/60 bg-emerald-500/10'
                      : 'border-white/10 bg-white/[0.06]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 flex-1 items-center gap-2.5">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white/10">
                        {dev.platform === 'android' ? (
                          <Smartphone className="h-4 w-4 text-emerald-400" />
                        ) : (
                          <Laptop className="h-4 w-4 text-white" />
                        )}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 text-xs font-bold">
                          <span className="truncate">{dev.device_name}</span>
                          {(dev.is_playing || isRemoteTarget) && (
                            <span className="rounded-full bg-emerald-500/20 px-1.5 py-0.5 text-[9.5px] font-semibold text-emerald-300">
                              En vivo
                            </span>
                          )}
                        </div>
                        <div className="truncate text-[10.5px] opacity-70">
                          {dev.track_title}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      onClick={() => void transferPlaybackToDevice(dev.device_id)}
                      className="rounded-[10px] bg-white py-1.5 text-[11px] font-bold text-[#070709] shadow-sm transition-opacity hover:opacity-90"
                    >
                      Transferir aquí
                    </button>
                    <button
                      type="button"
                      onClick={() => void pullPlaybackFromDevice(dev.device_id)}
                      className="rounded-[10px] bg-white/[0.08] py-1.5 text-[11px] font-semibold hover:bg-white/[0.15]"
                    >
                      Traer aquí
                    </button>
                  </div>

                  {/* Interactive Remote Controls + Volume Slider */}
                  <div className="space-y-2 border-t border-white/10 pt-2">
                    <div className="grid grid-cols-3 gap-1">
                      <button
                        type="button"
                        aria-label={`Anterior en ${dev.device_name}`}
                        onClick={() => void sendRemoteDeviceCommand(dev.device_id, 'prev')}
                        className="rounded-[8px] bg-white/[0.08] py-1 text-[10.5px] font-semibold hover:bg-white/[0.15]"
                      >
                        Anterior
                      </button>
                      <button
                        type="button"
                        aria-label={`Play/Pausa en ${dev.device_name}`}
                        onClick={() => void sendRemoteDeviceCommand(dev.device_id, 'toggle')}
                        className="rounded-[8px] bg-white py-1 text-[10.5px] font-bold text-[#070709]"
                      >
                        Play / Pausa
                      </button>
                      <button
                        type="button"
                        aria-label={`Siguiente en ${dev.device_name}`}
                        onClick={() => void sendRemoteDeviceCommand(dev.device_id, 'next')}
                        className="rounded-[8px] bg-white/[0.08] py-1 text-[10.5px] font-semibold hover:bg-white/[0.15]"
                      >
                        Siguiente
                      </button>
                    </div>

                    <div className="flex items-center gap-2">
                      <Volume2 className="h-3.5 w-3.5 shrink-0 opacity-70" />
                      <input
                        type="range"
                        min={0}
                        max={100}
                        aria-label={`Volumen remoto en ${dev.device_name}`}
                        value={remoteVol}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          setRemoteVol(v);
                          void sendRemoteDeviceCommand(dev.device_id, 'toggle', v / 100);
                        }}
                        style={{ '--pm-fill': `${remoteVol}%` } as React.CSSProperties}
                        className="pm-range-pill flex-1 cursor-pointer"
                      />
                      <span className="tabular-nums w-8 text-right text-[10.5px] font-semibold opacity-80">
                        {remoteVol}%
                      </span>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-3">
          <div className="min-w-0 flex-1 truncate text-[11px] opacity-75">
            {authState.connected && syncMode === 'supabase'
              ? authState.email
              : syncMode === 'supabase'
                ? 'Inicia sesión'
                : 'Local activo'}
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => pairDemoCompanionDevice()}
              className="rounded-full bg-white/[0.08] px-2.5 py-1 text-[10.5px] font-semibold hover:bg-white/[0.15]"
            >
              Demo local
            </button>
            <button
              type="button"
              onClick={() => {
                setDevicesSheetOpen(false);
                setSettingsOpen(true);
              }}
              className="rounded-full bg-white px-2.5 py-1 text-[10.5px] font-bold text-[#070709]"
            >
              Cuenta
            </button>
          </div>
        </div>
      </div>
    </>
  );
};

export const JamInviteModal: React.FC = React.memo(() => {
  const open = usePMusicStore((s) => Boolean(s.jamInviteModalOpen && s.activeJamSession));
  if (!open) return null;
  return <JamInviteModalInner />;
});
JamInviteModal.displayName = 'JamInviteModal';

const JamInviteModalInner: React.FC = () => {
  const {
    jamInviteModalOpen,
    setJamInviteModalOpen,
    activeJamSession,
    activeJamRole,
    updateJamSettings,
    leaveOrEndJam,
    showToast,
  } = usePMusicStore();
  const [copiedLink, setCopiedLink] = useState(false);

  if (!jamInviteModalOpen || !activeJamSession) return null;
  const shareUrl = buildJamShareUrl(activeJamSession.code);
  const qrUrl = buildJamQrImageUrl(activeJamSession.code);
  const isHost = activeJamRole === 'host';

  return (
    <div className="fixed inset-0 z-[72] flex items-center justify-center p-4">
      <div
        aria-hidden="true"
        onClick={() => setJamInviteModalOpen(false)}
        className="pm-spotlight-backdrop absolute inset-0 bg-black/70 backdrop-blur-sm"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Invitar a esta Jam"
        data-testid="jam-invite-modal"
        className="pm-glass-frosted-neutral pm-hud-dark pm-modal-pop relative z-10 w-full max-w-sm space-y-4 rounded-[26px] border border-white/15 p-6 text-center shadow-2xl"
      >
        <div className="flex items-center justify-between">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/20 px-3 py-1 text-[11px] font-bold text-emerald-300">
            <Radio className="h-3.5 w-3.5 animate-pulse" />
            JAM ACTIVA
          </span>
          <button
            type="button"
            aria-label="Cerrar invitación de Jam"
            onClick={() => setJamInviteModalOpen(false)}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white/80 hover:bg-white/20 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div>
          <h3 className="text-lg font-extrabold tracking-tight text-white">
            Invita a añadir canciones
          </h3>
          <p className="mt-1 text-xs text-white/70">
            Escanea el QR o comparte el enlace: en la web podrán añadir temas rápido sin descargar la app.
          </p>
        </div>

        <div className="mx-auto inline-flex flex-col items-center gap-2 rounded-2xl border border-white/15 bg-[#050507] p-3">
          <img
            src={qrUrl}
            alt={`Código QR Jam ${activeJamSession.code}`}
            className="h-44 w-44 rounded-xl"
          />
          <span className="font-mono text-base font-black tracking-[0.22em] text-white">
            {activeJamSession.code}
          </span>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard?.writeText(shareUrl);
              setCopiedLink(true);
              window.setTimeout(() => setCopiedLink(false), 1800);
              showToast('Enlace de Jam copiado');
            }}
            className="pm-pressable inline-flex flex-1 items-center justify-center gap-1.5 rounded-full bg-white py-2.5 text-xs font-bold text-[#070709]"
          >
            {copiedLink ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copiedLink ? 'Copiado' : 'Copiar enlace'}
          </button>
          {typeof navigator !== 'undefined' && typeof navigator.share === 'function' && (
            <button
              type="button"
              onClick={() => {
                void navigator.share({
                  title: `Únete a la Jam de ${activeJamSession.hostName} en pMusic`,
                  url: shareUrl,
                }).catch(() => {});
              }}
              className="pm-pressable inline-flex items-center justify-center gap-1.5 rounded-full bg-white/12 px-4 py-2.5 text-xs font-bold text-white hover:bg-white/20"
            >
              <Share2 className="h-3.5 w-3.5" />
              Compartir
            </button>
          )}
        </div>

        {isHost && (
          <div className="flex items-center justify-between rounded-2xl border border-white/12 bg-white/[0.04] px-3.5 py-2.5 text-left">
            <div>
              <div className="text-xs font-bold text-white">Peticiones de invitados</div>
              <div className="text-[11px] text-white/65">
                {activeJamSession.allowGuestDirectAdd
                  ? 'Entran directo a la cola'
                  : 'Aprobar antes de añadir'}
              </div>
            </div>
            <button
              type="button"
              onClick={() =>
                void updateJamSettings({
                  allowGuestDirectAdd: !activeJamSession.allowGuestDirectAdd,
                })
              }
              className={`rounded-full px-3 py-1 text-[11px] font-bold ${
                activeJamSession.allowGuestDirectAdd
                  ? 'bg-emerald-500/20 text-emerald-300'
                  : 'bg-amber-500/20 text-amber-300'
              }`}
            >
              {activeJamSession.allowGuestDirectAdd ? 'Directo' : 'Moderar'}
            </button>
          </div>
        )}

        <button
          type="button"
          onClick={() => void leaveOrEndJam()}
          className="w-full rounded-full border border-rose-400/30 bg-rose-500/15 py-2 text-xs font-bold text-rose-300 hover:bg-rose-500/25"
        >
          {isHost ? 'Finalizar Jam para todos' : 'Salir de la Jam'}
        </button>
      </div>
    </div>
  );
};

export const ImportPlaylistModal: React.FC = React.memo(() => {
  const importModalOpen = usePMusicStore((s) => s.importModalOpen);
  if (!importModalOpen) return null;
  return <ImportPlaylistModalInner />;
});
ImportPlaylistModal.displayName = 'ImportPlaylistModal';

const ImportPlaylistModalInner: React.FC = () => {
  const {
    importModalOpen,
    setImportModalOpen,
    importUrlInput,
    setImportUrlInput,
    importProgress,
    importResult,
    importError,
    startPlaylistImport,
    cancelPlaylistImport,
    saveImportedPlaylistToLibrary,
  } = usePMusicStore();

  if (!importModalOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        aria-hidden="true"
        onClick={() => setImportModalOpen(false)}
        className="pm-spotlight-backdrop absolute inset-0 bg-black/65"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Importar playlist de Spotify o YouTube"
        data-testid="import-modal"
        className="pm-glass-regular pm-modal-pop relative z-10 flex max-h-[86dvh] w-full max-w-xl flex-col overflow-y-auto rounded-[22px] p-6 pm-text-primary"
      >
        <div className="flex items-center justify-between border-b pm-border pb-4">
          <div className="flex items-center gap-2">
            <ListMusic className="h-5 w-5 pm-text-primary" />
            <h2 className="text-lg font-bold pm-text-primary">
              Importar playlist (Spotify / YouTube)
            </h2>
          </div>
          <button
            type="button"
            aria-label="Cerrar importador"
            onClick={() => setImportModalOpen(false)}
            className="pm-btn-secondary rounded-full px-3.5 py-1.5 text-xs font-semibold"
          >
            Cerrar
          </button>
        </div>

        <div className="mt-4 space-y-4">
          <p className="text-xs font-medium pm-text-secondary">
            Pega el enlace público de cualquier playlist o álbum de Spotify o YouTube Music:
          </p>

          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              type="text"
              aria-label="URL de playlist de Spotify o YouTube"
              placeholder="https://open.spotify.com/playlist/... o https://music.youtube.com/playlist?list=..."
              value={importUrlInput}
              onChange={(e) => setImportUrlInput(e.target.value)}
              className="pm-input flex-1 rounded-full px-4 py-2.5 text-sm"
            />
            <button
              type="button"
              onClick={() => void startPlaylistImport()}
              className="pm-btn-primary rounded-full px-5 py-2.5 text-sm font-bold"
            >
              Importar
            </button>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() =>
                void startPlaylistImport(
                  'https://open.spotify.com/playlist/37i9dQZF1DX123456'
                )
              }
              className="pm-btn-secondary rounded-full px-3.5 py-1.5 text-xs font-medium"
            >
              Probar ejemplo Spotify Urbano ES
            </button>
            <button
              type="button"
              onClick={() =>
                void startPlaylistImport(
                  'https://music.youtube.com/playlist?list=PL_URBANO_ES_2026'
                )
              }
              className="pm-btn-secondary rounded-full px-3.5 py-1.5 text-xs font-medium"
            >
              Probar ejemplo YouTube Music
            </button>
          </div>

          {importProgress && importProgress.phase !== 'done' && (
            <div
              data-surface="content"
              className="pm-surface-card space-y-2 rounded-[14px] p-4"
            >
              <div className="flex items-center justify-between text-xs font-semibold pm-text-primary">
                <span>
                  Fase: {importProgress.phase}{' '}
                  {importProgress.currentTrackTitle
                    ? `— ${importProgress.currentTrackTitle}`
                    : ''}
                </span>
                <span className="tabular-nums">
                  {importProgress.completed}/{Math.max(1, importProgress.total)}
                </span>
              </div>
              <button
                type="button"
                onClick={() => cancelPlaylistImport()}
                className="pm-btn-secondary rounded-full px-3.5 py-1.5 text-xs font-semibold text-rose-500"
              >
                Cancelar importación
              </button>
            </div>
          )}

          {importError && (
            <div
              role="status"
              className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-xs font-semibold pm-text-primary"
            >
              {importError}
            </div>
          )}

          {importResult && (
            <div
              data-surface="content"
              className="pm-surface-card space-y-3 rounded-[16px] p-4"
            >
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h3 className="text-base font-bold pm-text-primary">
                    {importResult.name}
                  </h3>
                  <p className="text-xs pm-text-secondary">
                    {importResult.items.length} canciones encontradas
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void saveImportedPlaylistToLibrary()}
                  className="pm-btn-primary rounded-full px-4 py-2 text-xs font-bold"
                >
                  Guardar en Biblioteca
                </button>
              </div>

              {importResult.truncated && importResult.warning && (
                <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs font-medium pm-text-primary">
                  {importResult.warning}
                </div>
              )}

              <div className="max-h-48 space-y-1.5 overflow-y-auto">
                {importResult.items.map((item, i) => (
                  <div
                    key={`${item.source.title}-${i}`}
                    className="flex items-center justify-between rounded-lg border pm-border pm-elevated px-3 py-2 text-xs"
                  >
                    <span className="truncate font-semibold pm-text-primary">
                      {item.source.title} — {item.source.artists.join(', ')}
                    </span>
                    <span className="ml-2 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-500">
                      {Math.round(item.confidence * 100)}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
