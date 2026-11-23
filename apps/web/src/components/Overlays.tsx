import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  Disc3,
  Download,
  GripVertical,
  Heart,
  Image as ImageIcon,
  Laptop,
  ListMusic,
  Loader2,
  MessageSquareQuote,
  Mic2,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  Radio,
  RefreshCw,
  Repeat,
  Repeat1,
  Search,
  Shuffle,
  SkipBack,
  SkipForward,
  Sliders,
  SlidersHorizontal,
  Smartphone,
  Sparkles,
  Trash2,
  Volume2,
  VolumeX,
  Wifi,
  X,
} from 'lucide-react';
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
  getLiveAnalyserData,
  getLivePlaybackPosition,
  usePMusicStore,
  type LyricsVisualStyle,
} from '../store/usePMusicStore.ts';
import {
  isElectronDesktopRuntime,
  setDesktopTitleBarOverlay,
} from '../platform/web-bridge.ts';
import { getThemeDefinition } from '../utils/themes.ts';
import { ArtistLinks } from './ArtistLinks.tsx';
import { clearDraggedTrack, setDraggedTrack } from '../utils/track-dnd.ts';

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

export const NowPlayingSheet: React.FC = () => {
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
    incomingTransitionTrack,
    themeId,
    reducedMotionPref,
    lyricsSize,
    lyricsBlurEnabled,
    lyricsStyle,
    setLyricsStyle,
    ambientMotionEnabled,
    lastTrackDirection,
    currentTrack,
    queue,
    queueIndex,
    recommendedQueue,
    isLoadingRecommendedQueue,
    shuffleEnabled,
    repeatMode,
    isPlaying,
    isBuffering,
    positionSec,
    durationSec,
    volume,
    isTransitioning,
    transitionProgress01,
    djMode,
    activeTransitionPlan,
    trackAnalyses,
    currentLyrics,
    activeLyricIndex,
    lyricsUserScrolled,
    setLyricsUserScrolled,
    likedTracks,
    offlineDownloads,
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
    moveQueueItem,
    removeQueueItem,
    clearUpNextQueue,
    addToQueue,
    playNextInQueue,
    replenishRecommendedQueue,
    promoteRecommendedTrack,
    dismissRecommendedTrack,
    searchTracksForPlaylist,
    playTrack,
    openAlbumDetail,
    showToast,
  } = usePMusicStore();

  const isElectronDesktop = isElectronDesktopRuntime();
  const sheetRootRef = useRef<HTMLDivElement | null>(null);
  const lyricsContainerRef = useRef<HTMLDivElement | null>(null);
  const activeLyricRef = useRef<HTMLButtonElement | null>(null);
  const backdropBeatRef = useRef<HTMLDivElement | null>(null);
  const progressInputRef = useRef<HTMLInputElement | null>(null);
  const progressTimeRef = useRef<HTMLSpanElement | null>(null);
  const progressRemainRef = useRef<HTMLSpanElement | null>(null);
  const showRemainingTimeRef = useRef(true);
  const [showRemainingTime, setShowRemainingTime] = useState(true);
  const coverSwipeStartRef = useRef<{ x: number; y: number } | null>(null);
  const sheetSwipeDownRef = useRef<{ y: number; x: number } | null>(null);
  const lastWholeSecRef = useRef<number>(Math.floor(positionSec));
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
  const [smoothPosSec, setSmoothPosSec] = useState(positionSec);

  useEffect(() => {
    if (!nowPlayingOpen || nowPlayingTab !== 'Letras') {
      setLyricsStyleModalOpen(false);
    }
    prevTabForModalRef.current = nowPlayingTab;
  }, [nowPlayingTab, nowPlayingOpen]);
  const [dragQueueIdx, setDragQueueIdx] = useState<number | null>(null);
  const [dragOverQueueIdx, setDragOverQueueIdx] = useState<number | null>(null);
  const [queueSearchQuery, setQueueSearchQuery] = useState('');
  const [queueSearchResults, setQueueSearchResults] = useState<Track[]>([]);
  const [isQueueSearching, setIsQueueSearching] = useState(false);
  const [recentlyMovedKey, setRecentlyMovedKey] = useState<string | null>(null);
  const [recentlyDisplacedKey, setRecentlyDisplacedKey] = useState<string | null>(null);
  const [transportAnim, setTransportAnim] = useState<
    'prev' | 'next' | 'play' | 'shuffle' | 'repeat' | null
  >(null);
  const [heartBurstKey, setHeartBurstKey] = useState(0);
  const [prevBackdrop, setPrevBackdrop] = useState<{
    id: string;
    coverUrl: string;
    direction: 'next' | 'prev';
  } | null>(null);

  const queueRowRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const prevRowTopsRef = useRef<Map<string, number>>(new Map());
  const transportTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const movedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backdropTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastBackdropTrackRef = useRef<{ id: string; coverUrl: string }>({
    id: currentTrack.id,
    coverUrl: currentTrack.thumbnailHighUrl ?? currentTrack.thumbnailUrl,
  });
  const lyricsScrollResumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    const nextUrl = currentTrack.thumbnailHighUrl ?? currentTrack.thumbnailUrl;
    const prev = lastBackdropTrackRef.current;
    if (prev.id !== currentTrack.id) {
      setPrevBackdrop({
        id: prev.id,
        coverUrl: prev.coverUrl,
        direction: lastTrackDirection === 'prev' ? 'prev' : 'next',
      });
      lastBackdropTrackRef.current = { id: currentTrack.id, coverUrl: nextUrl };
      if (backdropTimerRef.current) clearTimeout(backdropTimerRef.current);
      backdropTimerRef.current = setTimeout(() => setPrevBackdrop(null), 760);
    }
    return () => {
      if (backdropTimerRef.current) clearTimeout(backdropTimerRef.current);
    };
  }, [currentTrack.id, currentTrack.thumbnailHighUrl, currentTrack.thumbnailUrl, lastTrackDirection]);

  useEffect(() => {
    const isTouchOrSmall =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(max-width: 767px), (hover: none) and (pointer: coarse)').matches;
    if (
      !nowPlayingOpen ||
      !isPlaying ||
      !ambientMotionEnabled ||
      reducedMotionPref ||
      isTouchOrSmall ||
      typeof requestAnimationFrame !== 'function'
    ) {
      if (backdropBeatRef.current) {
        backdropBeatRef.current.style.setProperty('--pm-beat-scale', '1');
      }
      return;
    }
    let rafId = 0;
    let smoothBass = 0;
    const pulse = () => {
      const data = getLiveAnalyserData();
      const bins = data.frequencyBins;
      const lowAvg =
        bins.length >= 4
          ? ((bins[0] ?? 0) + (bins[1] ?? 0) + (bins[2] ?? 0) + (bins[3] ?? 0)) / (4 * 255)
          : data.rmsLevel;
      const bassLevel = Math.max(lowAvg, data.rmsLevel * 0.85);
      smoothBass = smoothBass * 0.74 + bassLevel * 0.26;
      const el = backdropBeatRef.current;
      if (el) {
        el.style.setProperty('--pm-beat-scale', (1 + smoothBass * 0.045).toFixed(4));
      }
      rafId = requestAnimationFrame(pulse);
    };
    rafId = requestAnimationFrame(pulse);
    return () => {
      cancelAnimationFrame(rafId);
      if (backdropBeatRef.current) {
        backdropBeatRef.current.style.setProperty('--pm-beat-scale', '1');
      }
    };
  }, [nowPlayingOpen, isPlaying, ambientMotionEnabled, reducedMotionPref]);

  useEffect(() => {
    if (
      nowPlayingOpen &&
      nowPlayingTab === 'Cola' &&
      recommendedQueue.length < 3 &&
      !isLoadingRecommendedQueue
    ) {
      void replenishRecommendedQueue();
    }
  }, [
    nowPlayingOpen,
    nowPlayingTab,
    recommendedQueue.length,
    isLoadingRecommendedQueue,
    replenishRecommendedQueue,
  ]);

  const moveWithFlip = (
    fromIdx: number,
    toIdx: number,
    movedKey: string,
    displacedKey?: string | null
  ) => {
    const snap = new Map<string, number>();
    queueRowRefs.current.forEach((el, k) => {
      snap.set(k, el.getBoundingClientRect().top);
    });
    prevRowTopsRef.current = snap;
    setRecentlyMovedKey(movedKey);
    setRecentlyDisplacedKey(displacedKey ?? null);
    if (movedTimerRef.current) clearTimeout(movedTimerRef.current);
    movedTimerRef.current = setTimeout(() => {
      setRecentlyMovedKey(null);
      setRecentlyDisplacedKey(null);
    }, 480);
    moveQueueItem(fromIdx, toIdx);
  };

  useLayoutEffect(() => {
    if (reducedMotionPref || prevRowTopsRef.current.size === 0) {
      prevRowTopsRef.current.clear();
      return;
    }
    const prevTops = prevRowTopsRef.current;
    queueRowRefs.current.forEach((el, k) => {
      const oldTop = prevTops.get(k);
      if (oldTop === undefined) return;
      const newTop = el.getBoundingClientRect().top;
      const deltaY = oldTop - newTop;
      if (Math.abs(deltaY) < 1) return;
      const isRising = deltaY > 0;
      el.style.transition = 'none';
      el.style.zIndex = isRising ? '30' : '10';
      el.style.transform = isRising
        ? `translateY(${deltaY}px) scale(1.045)`
        : `translateY(${deltaY}px) scale(0.94)`;
      void el.offsetHeight;
      el.style.transition = 'transform 380ms cubic-bezier(0.22, 1, 0.36, 1)';
      el.style.transform = 'translateY(0) scale(1)';
      setTimeout(() => {
        el.style.zIndex = '';
      }, 400);
    });
    prevRowTopsRef.current = new Map();
  }, [queue, reducedMotionPref]);

  const syncClockRef = useRef({
    posSec: positionSec,
    renderedPosSec: positionSec,
    trackId: currentTrack.id,
    atMs: typeof performance !== 'undefined' ? performance.now() : 0,
  });
  const lyricClockRef = useRef({
    lastRawPos: positionSec,
    lastWallMs: typeof performance !== 'undefined' ? performance.now() : 0,
    smoothedPos: positionSec,
    trackId: currentTrack.id,
  });

  useEffect(() => {
    const now = typeof performance !== 'undefined' ? performance.now() : 0;
    const trackChanged = syncClockRef.current.trackId !== currentTrack.id;
    const seekJumped = Math.abs(positionSec - syncClockRef.current.renderedPosSec) > 0.85;
    const effDur = Math.max(1, durationSec);
    const liveSnap = !isPlaying && !trackChanged && !seekJumped ? getLivePlaybackPosition() : null;
    const basePos =
      liveSnap && Number.isFinite(liveSnap.positionSec) && liveSnap.positionSec > 0
        ? Math.max(positionSec, liveSnap.positionSec)
        : positionSec;
    const clampedPos = Math.max(0, Math.min(effDur, basePos));
    syncClockRef.current.posSec = clampedPos;
    syncClockRef.current.atMs = now;
    syncClockRef.current.trackId = currentTrack.id;
    if (trackChanged || seekJumped || !isPlaying) {
      syncClockRef.current.renderedPosSec = clampedPos;
      lyricClockRef.current = {
        lastRawPos: clampedPos,
        lastWallMs: now,
        smoothedPos: clampedPos,
        trackId: currentTrack.id,
      };
      lastWholeSecRef.current = Math.floor(clampedPos);
      setSmoothPosSec(clampedPos);
      const pct = Math.min(100, Math.max(0, (clampedPos / effDur) * 100));
      if (progressInputRef.current) {
        progressInputRef.current.style.setProperty('--pm-fill', `${pct.toFixed(2)}%`);
        progressInputRef.current.value = String(Math.min(Math.round(effDur), Math.round(clampedPos)));
      }
      if (progressTimeRef.current) {
        progressTimeRef.current.textContent = formatDurationSec(clampedPos);
      }
      if (progressRemainRef.current) {
        progressRemainRef.current.textContent = showRemainingTimeRef.current
          ? `-${formatDurationSec(Math.max(0, effDur - clampedPos))}`
          : formatDurationSec(effDur);
      }
    }
  }, [positionSec, currentTrack.id, isPlaying, durationSec]);

  useEffect(() => {
    showRemainingTimeRef.current = showRemainingTime;
    const effDur = Math.max(1, durationSec);
    const cur = syncClockRef.current.renderedPosSec;
    if (progressRemainRef.current) {
      progressRemainRef.current.textContent = showRemainingTime
        ? `-${formatDurationSec(Math.max(0, effDur - cur))}`
        : formatDurationSec(effDur);
    }
  }, [showRemainingTime, durationSec]);

  useEffect(() => {
    if (
      !nowPlayingOpen ||
      !isPlaying ||
      typeof requestAnimationFrame !== 'function'
    ) {
      return;
    }
    let rafId = 0;
    const step = (now: number) => {
      const live = getLivePlaybackPosition();
      const effDur = Math.max(1, live.durationSec || durationSec);
      const rawPos = Number.isFinite(live.positionSec)
        ? live.positionSec
        : syncClockRef.current.posSec;
      const lClock = lyricClockRef.current;
      if (lClock.trackId !== currentTrack.id || Math.abs(rawPos - lClock.smoothedPos) > 0.75) {
        lClock.trackId = currentTrack.id;
        lClock.lastRawPos = rawPos;
        lClock.lastWallMs = now;
        lClock.smoothedPos = rawPos;
      } else {
        if (Math.abs(rawPos - lClock.lastRawPos) > 0.0005) {
          lClock.lastRawPos = rawPos;
          lClock.lastWallMs = now;
        }
        const extrapolated =
          rawPos + Math.min(0.2, Math.max(0, (now - lClock.lastWallMs) / 1000));
        if (extrapolated >= lClock.smoothedPos) {
          lClock.smoothedPos = extrapolated;
        }
      }
      const rendered = Math.max(0, Math.min(effDur, lClock.smoothedPos));

      syncClockRef.current.renderedPosSec = rendered;
      const pct = Math.min(100, Math.max(0, (rendered / effDur) * 100));
      if (progressInputRef.current) {
        progressInputRef.current.style.setProperty('--pm-fill', `${pct.toFixed(2)}%`);
        progressInputRef.current.value = String(Math.min(Math.round(effDur), Math.round(rendered)));
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

      if (nowPlayingTab === 'Letras') {
        const docs = currentLyricsRef.current;
        let curLineIdx = -1;
        if (docs && docs.status === 'synced' && docs.lines.length > 0) {
          const targetMs = rendered * 1000 + 120;
          for (let i = 0; i < docs.lines.length; i++) {
            if (docs.lines[i]!.timeMs <= targetMs) curLineIdx = i;
            else break;
          }
        }

        // Direct 60-120fps DOM sweep for classic Apple Music Sing mode (zero React re-render stutter)
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
            const spans = activeLyricRef.current.querySelectorAll<HTMLElement>('.pm-sing-word');
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
              if (el.dataset.wordState !== wordState) {
                el.dataset.wordState = wordState;
              }
              const bgPos = wordState === 'upcoming' ? 100 : wordState === 'sung' ? 0 : (1 - wp) * 100;
              el.style.setProperty('--word-bg-pos', `${bgPos.toFixed(2)}%`);
              const wave = wordState === 'active' ? Math.sin(wp * Math.PI) : 0;
              const lift = wordState === 'upcoming' ? 0 : wordState === 'sung' ? -1 : -(1 + 2.6 * wave);
              const scale = wordState === 'active' ? 1 + 0.032 * wave : 1;
              el.style.setProperty('--word-y', `${lift.toFixed(2)}px`);
              el.style.setProperty('--word-scale', scale.toFixed(4));
            }
          }
        }

        const lineChanged = curLineIdx !== lastRenderedLyricIdxRef.current;
        const wholeChanged = Math.floor(rendered) !== lastWholeSecRef.current;
        const isAnimatedNonClassic =
          lyricsStyleRef.current === 'wordflow' ||
          lyricsStyleRef.current === 'typewriter' ||
          lyricsStyleRef.current === 'neon' ||
          lyricsStyleRef.current === 'poster';
        const isAnimDue =
          isAnimatedNonClassic && now - lastLyricStateSyncMsRef.current >= 40;

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
          setSmoothPosSec(rendered);
        }
      }
      rafId = requestAnimationFrame(step);
    };
    rafId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafId);
  }, [nowPlayingOpen, isPlaying, durationSec, nowPlayingTab, currentTrack.id]);

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
  const resolvedActiveLyricIdx =
    currentLyrics && currentLyrics.lines.length > 0
      ? liveLyricIdx >= 0
        ? liveLyricIdx
        : activeLyricIndex >= 0
          ? activeLyricIndex
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

  const isLiked = likedTracks.some((l) => l.trackId === currentTrack.id);
  const dlStatus = offlineDownloads[currentTrack.id] ?? 'idle';
  const progressPct = Math.max(
    0,
    Math.min(100, (smoothPosSec / Math.max(1, durationSec)) * 100)
  );
  const volumePct = Math.round(volume * 100);
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

  const remainingSec = Math.max(0, durationSec - smoothPosSec);
  const incomingPreviewTrack =
    djMode.enabled &&
    isTransitioning &&
    incomingTransitionTrack &&
    incomingTransitionTrack.id !== currentTrack.id
      ? incomingTransitionTrack
      : null;

  const PlayerDeckColumn = (compact = false) => (
    <div
      className={`flex flex-col items-center ${
        compact
          ? 'w-full gap-3.5 xl:gap-4'
          : 'mx-auto flex h-full w-full max-w-[420px] justify-center gap-5 pb-4 md:h-auto md:justify-center md:gap-5 md:py-0'
      }`}
    >
      {/* Large Borderless Centerpiece Artwork with smooth 3D slide, DJ crossfade preview & swipe skip */}
      <div
        key={currentTrack.id}
        onTouchStart={(e) => {
          const t = e.touches[0];
          if (t) coverSwipeStartRef.current = { x: t.clientX, y: t.clientY };
        }}
        onTouchEnd={(e) => {
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
          lastTrackDirection === 'prev' ? 'pm-cover-slide-prev' : 'pm-cover-slide-next'
        } relative aspect-square overflow-hidden rounded-[14px] bg-[#111115] shadow-[0_26px_64px_rgba(0,0,0,0.58)] transition-transform duration-300 ease-out md:rounded-[16px] ${
          compact
            ? 'w-[min(68vw,320px,36dvh)] xl:w-[min(68vw,346px,38dvh)]'
            : 'w-[min(86vw,356px,42dvh)] md:w-[min(74vw,340px,38dvh)] xl:w-[min(74vw,380px,42dvh)]'
        } ${isPlaying ? 'scale-100' : 'scale-[0.96]'}`}
      >
        <img
          src={currentTrack.thumbnailHighUrl ?? currentTrack.thumbnailUrl}
          alt={currentTrack.title}
          className={`h-full w-full object-cover transition-all duration-500 ${
            incomingPreviewTrack ? 'scale-[0.94] opacity-40 blur-[2px]' : 'scale-100 opacity-100'
          }`}
        />
        {incomingPreviewTrack && (
          <img
            key={`in-cover-${incomingPreviewTrack.id}`}
            src={incomingPreviewTrack.thumbnailHighUrl ?? incomingPreviewTrack.thumbnailUrl}
            alt={incomingPreviewTrack.title}
            className="pm-track-meta-in absolute inset-0 h-full w-full object-cover transition-opacity duration-500"
            style={{
              opacity: Math.max(0.28, Math.min(1, transitionProgress01 * 1.45)),
            }}
          />
        )}
      </div>

      {/* Minimalist Title, Full Multi-Artist Line & Borderless Actions */}
      <div
        key={`meta-${incomingPreviewTrack?.id ?? currentTrack.id}`}
        className="pm-track-meta-in flex w-full flex-col gap-0.5 md:gap-1"
      >
        <div className="flex w-full items-center justify-between gap-2">
          <h1 className="min-w-0 flex-1 truncate text-[21px] font-bold leading-snug tracking-tight text-white md:text-[23px]">
            {currentTrack.title}
          </h1>

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
              className={`pm-pressable relative flex h-9 w-9 items-center justify-center overflow-visible rounded-full transition-colors hover:bg-white/[0.10] ${
                isLiked ? 'text-[#FB7185]' : 'text-white/85 hover:text-white'
              }`}
            >
              <Heart
                key={`deck-heart-${heartBurstKey}-${isLiked}`}
                className={`h-5 w-5 ${isLiked ? 'fill-current' : ''} ${
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
              className="pm-pressable hidden h-9 w-9 items-center justify-center rounded-full text-white/80 transition-colors hover:bg-white/[0.10] hover:text-white md:flex"
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
              className="pm-pressable flex h-9 w-9 items-center justify-center rounded-full text-white/85 transition-colors hover:bg-white/[0.10] hover:text-white"
            >
              <MoreHorizontal className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Full-Width Artist · Album Line so multi-artist collaborations never truncate unnecessarily */}
        <div className="flex w-full flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[14px] leading-snug text-white/70">
          <ArtistLinks
            artists={currentTrack.artists}
            className="flex-wrap"
            onBeforeNavigate={() => setNowPlayingOpen(false)}
            linkClassName="hover:text-white hover:underline"
          />
          {currentTrack.album && currentTrack.artists.length <= 2 && (
            <>
              <span aria-hidden="true" className="opacity-50">
                ·
              </span>
              <button
                type="button"
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
                className="min-w-0 truncate text-left text-white/55 hover:text-white hover:underline"
              >
                {currentTrack.album.name}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Thin Apple Music Pill Progress Bar + Status + Clickable Remaining Time */}
      <div className="w-full space-y-1">
        <div className="relative flex w-full items-center">
          {isBuffering && (
            <span
              aria-hidden="true"
              className="pm-buffer-shimmer pointer-events-none absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full opacity-90"
            />
          )}
          {unplayedCueStartPct !== null && unplayedCueWidthPct > 0 && (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-[#C084FC]/75"
              style={{
                left: `${unplayedCueStartPct}%`,
                width: `${unplayedCueWidthPct}%`,
              }}
            />
          )}
          <input
            ref={progressInputRef}
            type="range"
            role="slider"
            aria-label="Progreso de la canción"
            min={0}
            max={Math.max(1, Math.round(durationSec))}
            value={Math.min(Math.round(durationSec), Math.round(smoothPosSec))}
            onChange={(e) => {
              const effDur = Math.max(1, durationSec);
              const next = Math.max(0, Math.min(effDur, Number(e.target.value)));
              const pct = Math.min(100, Math.max(0, (next / effDur) * 100));
              if (progressInputRef.current) {
                progressInputRef.current.style.setProperty('--pm-fill', `${pct.toFixed(2)}%`);
                progressInputRef.current.value = String(Math.round(next));
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
              setSmoothPosSec(next);
              seekTo(next);
            }}
            style={{ '--pm-fill': `${progressPct}%` } as React.CSSProperties}
            className="pm-range-pill relative z-10 w-full cursor-pointer"
          />
        </div>
        <div className="tabular-nums flex items-center justify-between text-[11px] font-medium text-white/60">
          <span ref={progressTimeRef}>{formatDurationSec(smoothPosSec)}</span>
          {isBuffering ? (
            <span className="inline-flex items-center gap-1.5 font-sans text-[10px] font-semibold tracking-[0.14em] text-white/90 animate-pulse">
              <Loader2 className="h-3 w-3 animate-spin" />
              CARGANDO AUDIO…
            </span>
          ) : djMode.enabled && isTransitioning ? (
            <span className="font-sans text-[10px] font-semibold tracking-[0.14em] text-purple-300/90 animate-pulse">
              MEZCLANDO · DJ
            </span>
          ) : null}
          <button
            type="button"
            aria-label="Alternar tiempo restante y duración total"
            onClick={() => setShowRemainingTime((v) => !v)}
            className="tabular-nums text-right text-[11px] font-medium text-white/60 transition-colors hover:text-white"
          >
            <span ref={progressRemainRef}>
              {showRemainingTime
                ? `-${formatDurationSec(remainingSec)}`
                : formatDurationSec(durationSec)}
            </span>
          </button>
        </div>
      </div>

      {/* Pure Minimalist Centered Borderless Transport Row (Exact 5 icons matching desktop) */}
      <div className="mx-auto grid w-full max-w-[300px] grid-cols-5 place-items-center py-0 sm:max-w-[340px]">
        <button
          type="button"
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
          className={`pm-pressable relative flex h-9 w-9 items-center justify-center overflow-visible bg-transparent transition-transform duration-150 hover:scale-110 focus:outline-none ${
            shuffleEnabled
              ? 'text-white'
              : 'text-white/55 hover:text-white'
          }`}
        >
          {transportAnim === 'shuffle' && !reducedMotionPref && (
            <span aria-hidden="true" className="pointer-events-none absolute inset-0">
              <span
                className="pm-shuffle-spark absolute left-1/2 top-1/2 h-1.5 w-1.5 rounded-full bg-white"
                style={{ '--sx': '-16px', '--sy': '-13px' } as React.CSSProperties}
              />
              <span
                className="pm-shuffle-spark absolute left-1/2 top-1/2 h-1.5 w-1.5 rounded-full bg-white"
                style={{ '--sx': '16px', '--sy': '-13px' } as React.CSSProperties}
              />
              <span
                className="pm-shuffle-spark absolute left-1/2 top-1/2 h-1.5 w-1.5 rounded-full bg-white"
                style={{ '--sx': '-16px', '--sy': '13px' } as React.CSSProperties}
              />
              <span
                className="pm-shuffle-spark absolute left-1/2 top-1/2 h-1.5 w-1.5 rounded-full bg-white"
                style={{ '--sx': '16px', '--sy': '13px' } as React.CSSProperties}
              />
            </span>
          )}
          <Shuffle
            className={`h-4 w-4 ${
              transportAnim === 'shuffle' && !reducedMotionPref ? 'pm-shuffle-chaos-epic' : ''
            }`}
          />
          {shuffleEnabled && (
            <span
              aria-hidden="true"
              className="absolute bottom-0.5 h-1 w-1 rounded-full bg-white"
            />
          )}
        </button>

        <button
          type="button"
          aria-label="Canción anterior"
          onClick={() => {
            triggerTransportAnim('prev');
            void prevTrack();
          }}
          className="pm-pressable relative flex h-12 w-12 items-center justify-center overflow-visible bg-transparent text-white/90 transition-transform duration-150 hover:scale-110 hover:text-white active:scale-90 focus:outline-none"
        >
          {transportAnim === 'prev' && !reducedMotionPref && (
            <span
              aria-hidden="true"
              className="pm-skip-trail-prev pointer-events-none absolute left-1/2 top-1/2 h-6 w-7 -translate-x-1/2 rounded-full bg-white/35 blur-[3px]"
            />
          )}
          <SkipBack
            className={`h-7 w-7 fill-current ${
              transportAnim === 'prev' && !reducedMotionPref ? 'pm-skip-prev-hyper' : ''
            }`}
          />
        </button>

        <button
          type="button"
          data-testid="nowplaying-play-btn"
          aria-label={isBuffering ? 'Cargando canción' : isPlaying ? 'Pausar' : 'Reproducir'}
          onClick={() => {
            triggerTransportAnim('play');
            void togglePlayPause();
          }}
          className="pm-pressable relative flex h-16 w-16 items-center justify-center overflow-visible bg-transparent text-white outline-none ring-0 transition-transform duration-200 hover:scale-105 active:scale-90 focus:outline-none"
        >
          {isBuffering ? (
            <>
              <span
                aria-hidden="true"
                className="pm-play-loading-ring pointer-events-none absolute inset-1 rounded-full border-2 border-white/40"
              />
              <Loader2 data-testid="nowplaying-play-loader" className="h-10 w-10 animate-spin text-white/95" />
            </>
          ) : (
            <>
              <Pause
                className={`absolute h-12 w-12 fill-current drop-shadow-[0_4px_14px_rgba(0,0,0,0.34)] transition-all duration-200 ease-out ${
                  isPlaying
                    ? 'scale-100 rotate-0 opacity-100 blur-0'
                    : 'scale-50 rotate-90 opacity-0 blur-[1px]'
                }`}
              />
              <Play
                className={`absolute h-12 w-12 translate-x-[2px] fill-current drop-shadow-[0_4px_14px_rgba(0,0,0,0.34)] transition-all duration-200 ease-out ${
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
            triggerTransportAnim('next');
            void nextTrack();
          }}
          className="pm-pressable relative flex h-12 w-12 items-center justify-center overflow-visible bg-transparent text-white/90 transition-transform duration-150 hover:scale-110 hover:text-white active:scale-90 focus:outline-none"
        >
          {transportAnim === 'next' && !reducedMotionPref && (
            <span
              aria-hidden="true"
              className="pm-skip-trail-next pointer-events-none absolute left-1/2 top-1/2 h-6 w-7 -translate-x-1/2 rounded-full bg-white/35 blur-[3px]"
            />
          )}
          <SkipForward
            className={`h-7 w-7 fill-current ${
              transportAnim === 'next' && !reducedMotionPref ? 'pm-skip-next-hyper' : ''
            }`}
          />
        </button>

        <button
          type="button"
          aria-label={repeatLabel}
          aria-pressed={repeatMode !== 'off'}
          onClick={() => {
            triggerTransportAnim('repeat');
            cycleRepeatMode();
          }}
          className={`pm-pressable relative flex h-9 w-9 items-center justify-center bg-transparent transition-transform duration-150 hover:scale-110 focus:outline-none ${
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
              <Repeat1 className="h-4 w-4" />
            ) : (
              <Repeat className="h-4 w-4" />
            )}
          </span>
          {repeatMode !== 'off' && (
            <span
              aria-hidden="true"
              className="absolute bottom-0.5 h-1 w-1 rounded-full bg-white"
            />
          )}
        </button>
      </div>

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
      onScroll={(e) => {
        if (e.currentTarget.scrollTop !== 0) e.currentTarget.scrollTop = 0;
        if (e.currentTarget.scrollLeft !== 0) e.currentTarget.scrollLeft = 0;
      }}
      className="pm-sheet-spring-in pm-dark-sliders fixed inset-0 z-50 flex h-dvh w-screen flex-col overflow-hidden bg-[#070709] text-[#F5F5F7]"
    >
      {/* Apple Music Style Living Fluid Cover Backdrop (Fixed & Oversized so zero unfiltered edges ever appear) */}
      <div
        ref={backdropBeatRef}
        data-testid="live-backdrop-container"
        aria-hidden="true"
        className={`pointer-events-none fixed -inset-16 z-0 overflow-hidden ${
          !ambientMotionEnabled || reducedMotionPref ? 'pm-backdrop-static' : ''
        }`}
        style={{
          background:
            'radial-gradient(circle at 20% 24%, var(--pm-ambient-1), transparent 58%), radial-gradient(circle at 80% 76%, var(--pm-ambient-2), transparent 60%), linear-gradient(180deg, var(--pm-ambient-3) 0%, #070709 100%)',
          transform: 'scale(var(--pm-beat-scale, 1))',
        }}
      >
        {prevBackdrop && (
          <div
            key={`out-${prevBackdrop.id}`}
            className={`pointer-events-none absolute -inset-24 ${
              prevBackdrop.direction === 'prev'
                ? 'pm-backdrop-out-prev'
                : 'pm-backdrop-out-next'
            }`}
          >
            <img
              src={prevBackdrop.coverUrl}
              alt=""
              draggable={false}
              className="pm-fluid-cover-a h-full w-full select-none object-cover opacity-75"
            />
          </div>
        )}

        <div
          key={`in-${currentTrack.id}`}
          className={`pointer-events-none absolute -inset-24 ${
            prevBackdrop
              ? lastTrackDirection === 'prev'
                ? 'pm-backdrop-in-prev'
                : 'pm-backdrop-in-next'
              : ''
          }`}
        >
          <img
            data-testid="live-backdrop-img"
            src={currentTrack.thumbnailHighUrl ?? currentTrack.thumbnailUrl}
            alt=""
            draggable={false}
            className="pm-fluid-cover-a absolute inset-0 h-full w-full select-none object-cover opacity-55"
          />
          <img
            src={currentTrack.thumbnailHighUrl ?? currentTrack.thumbnailUrl}
            alt=""
            draggable={false}
            className="pm-fluid-cover-b absolute inset-0 h-full w-full -scale-x-100 select-none object-cover opacity-35"
          />
        </div>

        {/* GPU-Composited Living Fluid Cover-Palette Orbs (True circles + closest-side fade = zero box seams) */}
        <div className="pm-orb-1 pointer-events-none absolute -left-[20vmax] -top-[16vmax] h-[78vmax] w-[78vmax] rounded-full mix-blend-screen" />
        <div className="pm-orb-2 pointer-events-none absolute -bottom-[18vmax] -right-[16vmax] h-[82vmax] w-[82vmax] rounded-full mix-blend-screen" />
        <div className="pm-orb-3 pointer-events-none absolute left-[10%] top-[22%] h-[68vmax] w-[68vmax] rounded-full mix-blend-screen" />
        <div className="pm-orb-sheen pointer-events-none absolute inset-[-12%] rounded-full mix-blend-overlay" />
      </div>

      {/* Apple HIG Bright Media Scrim (34% dark wash for vivid fluid colors with legible text) */}
      <div
        data-testid="bright-media-scrim"
        data-scrim="true"
        data-scrim-alpha="0.34"
        className="pointer-events-none fixed inset-0 z-0"
        style={{ backgroundColor: 'rgba(8, 8, 12, 0.34)' }}
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
          isElectronDesktop ? 'pr-[152px] md:pr-[152px]' : ''
        }`}
      >
        {/* Mobile Portada: clean centered top grabber capsule (tappable or swipe down to close) */}
        {nowPlayingTab === 'Portada' ? (
          <div className="flex w-full items-center justify-center py-1 md:hidden">
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
              <img
                src={currentTrack.thumbnailUrl}
                alt={currentTrack.title}
                className="h-10 w-10 shrink-0 rounded-[8px] object-cover shadow-md"
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14px] font-bold leading-tight text-white">
                  {currentTrack.title}
                </div>
                <div className="truncate text-xs text-white/65">
                  {currentTrack.artists.map((a) => a.name).join(', ')}
                </div>
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

        {/* Desktop Minimal Left Dismiss Pill (NO ugly centered Portada/Letras/Cola pill bar on top) */}
        <button
          type="button"
          aria-label="Cerrar reproductor"
          onClick={() => setNowPlayingOpen(false)}
          className="pm-pressable pm-no-drag hidden items-center gap-1.5 rounded-full bg-white/[0.08] px-3.5 py-1.5 text-xs font-semibold text-white/90 transition-colors hover:bg-white/[0.16] md:inline-flex"
        >
          <ChevronDown className="h-4 w-4" />
          <span>Minimizar</span>
        </button>

        <div aria-hidden="true" className="hidden w-20 md:block" />
      </header>

      {/* Main Content */}
      <div
        className={`relative z-10 min-h-0 flex-1 px-5 md:px-10 ${
          nowPlayingTab === 'Portada'
            ? 'overflow-x-hidden overflow-y-auto py-2 md:py-5'
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
                  /* Mode 3: Enfoque — Single-line centered spotlight + next verse preview */
                  (() => {
                    const activeIdx = Math.max(0, resolvedActiveLyricIdx);
                    const activeLine = currentLyrics.lines[activeIdx];
                    const nextLine = currentLyrics.lines[activeIdx + 1];
                    const emphasis = activeLine
                      ? analyzeKineticWords(currentLyrics.lines, activeIdx)
                      : [];
                    const words = activeLine ? activeLine.text.trim().split(/\s+/).filter(Boolean) : [];
                    return (
                      <div className="flex flex-1 flex-col items-start justify-center px-3 pb-10">
                        {activeLine && (
                          <button
                            key={`focus-${activeIdx}-${activeLine.timeMs}`}
                            type="button"
                            data-lyric-state="active"
                            onClick={() => seekTo(activeLine.timeMs / 1000)}
                            className="pm-focus-stage-line text-left text-[28px] font-extrabold leading-[1.22] tracking-tight text-white md:text-[38px]"
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
                            className="mt-6 text-left text-lg font-semibold leading-snug text-white/35 transition-colors hover:text-white/65 md:text-2xl"
                          >
                            {nextLine.text}
                          </button>
                        )}
                      </div>
                    );
                  })()
                ) : (
                  <div
                    className={
                      lyricsStyle === 'kinetic'
                        ? 'space-y-3 pt-4 pb-24'
                        : 'pm-lyrics-mask space-y-2 pb-16'
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

        {nowPlayingTab === 'Cola' && (() => {
          const activeQueueTrack = queue[queueIndex] ?? currentTrack;
          const upNextTracks = queue.slice(queueIndex + 1);
          const activeAna = trackAnalyses[activeQueueTrack.id];
          const activeLiked = likedTracks.some((l) => l.trackId === activeQueueTrack.id);
          return (
          <div key="np-cola" className="pm-view-transition mx-auto grid h-full min-h-0 max-w-6xl grid-cols-1 grid-rows-[minmax(0,1fr)] gap-8 lg:grid-cols-12">
            <div className="hidden h-full min-h-0 px-4 lg:col-span-5 lg:flex lg:items-center lg:justify-center">
              {PlayerDeckColumn(true)}
            </div>

            {/* Free-floating Borderless Two-Tier Queue */}
            <div
              data-testid="queue-view"
              className="flex h-full min-h-0 flex-col gap-3 lg:col-span-7 lg:max-h-[82vh] lg:gap-3.5 lg:self-center lg:pb-12"
            >
              {/* Clean Borderless Header */}
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.08] pb-2.5 md:border-white/[0.12] md:pb-3">
                <div>
                  <h2 className="text-[19px] font-bold tracking-tight text-white md:text-xl">
                    Cola de reproducción
                  </h2>
                  <p className="text-xs text-[#D4D4E0]">
                    {upNextTracks.length} en tu cola · {recommendedQueue.length} recomendadas infinitas
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    aria-pressed={shuffleEnabled}
                    onClick={() => toggleShuffle()}
                    className={`pm-pressable inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[11px] font-semibold transition-colors ${
                      shuffleEnabled
                        ? 'bg-white text-[#0A0A0D]'
                        : 'bg-white/[0.08] text-[#F5F5F7] hover:bg-white/[0.16]'
                    }`}
                  >
                    <Shuffle className="h-3.5 w-3.5" />
                    Aleatorio
                  </button>
                  {upNextTracks.length > 0 && (
                    <button
                      type="button"
                      onClick={() => clearUpNextQueue()}
                      className="pm-pressable h-8 rounded-full bg-white/[0.08] px-3.5 text-[11px] font-semibold text-[#F5F5F7] transition-colors hover:bg-white/[0.16]"
                    >
                      Limpiar cola
                    </button>
                  )}
                </div>
              </div>

              {/* Quick Inline Search to Add Songs Directly to Queue */}
              <div className="space-y-2">
                <div className="flex items-center gap-2 rounded-full bg-white/[0.09] px-3.5 py-2.5 focus-within:bg-white/[0.14] md:border md:border-white/15 md:bg-white/[0.08] md:py-2 md:focus-within:border-white/40 md:focus-within:bg-white/[0.12]">
                  <Search className="h-3.5 w-3.5 shrink-0 text-[#D4D4E0]" />
                  <input
                    type="text"
                    aria-label="Buscar canción para añadir a la cola"
                    placeholder="Buscar canción para añadir a la cola…"
                    value={queueSearchQuery}
                    onChange={async (e) => {
                      const q = e.target.value;
                      setQueueSearchQuery(q);
                      if (q.trim().length >= 2) {
                        setIsQueueSearching(true);
                        const found = await searchTracksForPlaylist(q);
                        setQueueSearchResults(found.slice(0, 5));
                        setIsQueueSearching(false);
                      } else {
                        setQueueSearchResults([]);
                      }
                    }}
                    className="flex-1 bg-transparent text-xs text-white placeholder:text-[#B4B4BE] focus:outline-none"
                  />
                  {isQueueSearching && (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-white" />
                  )}
                  {queueSearchQuery && (
                    <button
                      type="button"
                      aria-label="Limpiar búsqueda rápida de cola"
                      onClick={() => {
                        setQueueSearchQuery('');
                        setQueueSearchResults([]);
                      }}
                      className="pm-pressable inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[#D4D4E0] hover:bg-white/15 hover:text-white"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>

                {queueSearchResults.length > 0 && (
                  <div className="space-y-1 rounded-[14px] border border-white/15 bg-black/40 p-2">
                    {queueSearchResults.map((cand) => (
                      <div
                        key={`qadd-${cand.id}`}
                        className="flex items-center justify-between gap-2.5 rounded-[10px] px-2.5 py-1.5 hover:bg-white/[0.10]"
                      >
                        <div className="flex min-w-0 flex-1 items-center gap-2.5">
                          <img
                            src={cand.thumbnailUrl}
                            alt=""
                            className="h-8 w-8 shrink-0 rounded-[6px] object-cover"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-xs font-semibold leading-snug text-white">
                              {cand.title}
                            </div>
                            <div className="truncate text-xs leading-normal text-[#D4D4E0]">
                              <ArtistLinks
                                artists={cand.artists}
                                onBeforeNavigate={() => setNowPlayingOpen(false)}
                                linkClassName="hover:text-white hover:underline"
                              />
                            </div>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              playNextInQueue(cand);
                              showToast(`«${cand.title}» sonará a continuación`);
                            }}
                            className="pm-pressable rounded-full bg-white px-2.5 py-1 text-[11px] font-bold text-[#070709] hover:opacity-90"
                          >
                            + Siguiente
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              addToQueue(cand);
                              showToast(`«${cand.title}» añadida al final`);
                            }}
                            className="pm-pressable rounded-full border border-white/20 bg-white/[0.10] px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-white/[0.20]"
                          >
                            + Cola
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Subtle 1-line Live Choreography Telemetry when DJ Mode is active */}
              {djMode.enabled && activeTransitionPlan && (
                <div className="space-y-1 border-b border-white/[0.08] pb-2 text-[11px] text-[#E5E5EA]">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold text-[#E9D5FF]">
                      {activeTransitionPlan.choreography?.summary ??
                        `AutoMix ${activeTransitionPlan.transitionBars} compases (${activeTransitionPlan.transitionDurationSec}s) · ${Math.round(activeTransitionPlan.compatibilityScore * 100)}% fit`}
                    </span>
                    <span className="tabular-nums text-[#D4D4E0]">
                      {formatDurationSec(activeTransitionPlan.cueOutSec)} →{' '}
                      {formatDurationSec(activeTransitionPlan.cueInSec)}
                    </span>
                  </div>
                  {isTransitioning && (
                    <div className="h-1 w-full overflow-hidden rounded-full bg-white/15">
                      <div
                        className="h-full rounded-full bg-white transition-[width] duration-100"
                        style={{ width: `${Math.round(transitionProgress01 * 100)}%` }}
                      />
                    </div>
                  )}
                </div>
              )}

              {/* Scrollable Borderless Two-Tier Queue Rows with Smooth FLIP Reordering */}
              <div
                role="list"
                className="flex-1 space-y-4 overflow-y-auto pr-1 pm-no-scrollbar"
              >
                {/* Tier 1a: Sonando ahora */}
                <section aria-label="Sonando ahora" className="space-y-1.5">
                  <div className="flex items-center justify-between px-1">
                    <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#D4D4E0]">
                      Sonando ahora
                    </span>
                  </div>
                  <div
                    role="listitem"
                    draggable
                    onDragStart={(e) => setDraggedTrack(e, activeQueueTrack)}
                    onDragEnd={() => clearDraggedTrack()}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      openTrackMenu(activeQueueTrack, e.clientX, e.clientY);
                    }}
                    className="group flex h-15 items-center justify-between gap-2.5 overflow-hidden rounded-[12px] bg-white/[0.15] px-2.5"
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-2.5">
                      <button
                        type="button"
                        aria-label={`Reproducir ${activeQueueTrack.title}`}
                        onClick={() => void playTrack(activeQueueTrack, queue)}
                        className="relative h-10 w-10 shrink-0 overflow-hidden rounded-[8px] bg-black/40"
                      >
                        <img
                          src={activeQueueTrack.thumbnailUrl}
                          alt={activeQueueTrack.title}
                          className="h-full w-full object-cover"
                        />
                        {isPlaying && (
                          <span className="absolute inset-0 flex items-center justify-center bg-black/45">
                            <span className="inline-flex h-3 w-3 items-end justify-center gap-[2px]">
                              <span className="pm-eq-bar-1 h-full w-[2.5px] rounded-full bg-white" />
                              <span className="pm-eq-bar-2 h-full w-[2.5px] rounded-full bg-white" />
                              <span className="pm-eq-bar-3 h-full w-[2.5px] rounded-full bg-white" />
                            </span>
                          </span>
                        )}
                      </button>

                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[14px] font-semibold leading-snug text-[#F5F5F7]">
                          {activeQueueTrack.title}
                        </div>
                        <div className="overflow-x-clip py-[1px] text-xs leading-normal text-[#D4D4E0]">
                          <ArtistLinks
                            artists={activeQueueTrack.artists}
                            onBeforeNavigate={() => setNowPlayingOpen(false)}
                            linkClassName="hover:text-white hover:underline"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-1">
                      {djMode.enabled && (
                        <span className="tabular-nums hidden rounded-full bg-white/[0.10] px-2 py-0.5 text-[11px] font-semibold text-[#E9D5FF] sm:inline">
                          {activeAna?.bpm ?? 120} BPM
                        </span>
                      )}
                      <span className="tabular-nums hidden px-1.5 text-xs font-medium text-[#D4D4E0] sm:inline">
                        {formatDurationSec(activeQueueTrack.durationSec)}
                      </span>
                      <button
                        type="button"
                        aria-label={
                          activeLiked
                            ? `Quitar ${activeQueueTrack.title} de Me gusta`
                            : `Añadir ${activeQueueTrack.title} a Me gusta`
                        }
                        onClick={() => void toggleLike(activeQueueTrack)}
                        className={`pm-pressable hidden rounded-full p-1.5 transition-colors sm:inline-flex ${
                          activeLiked
                            ? 'text-[#FB7185]'
                            : 'text-[#D4D4E0] hover:bg-white/[0.12] hover:text-white'
                        }`}
                      >
                        <Heart className={`h-3.5 w-3.5 ${activeLiked ? 'fill-current' : ''}`} />
                      </button>
                      <button
                        type="button"
                        aria-label={`Más opciones para ${activeQueueTrack.title}`}
                        onClick={(e) => {
                          const r = e.currentTarget.getBoundingClientRect();
                          openTrackMenu(activeQueueTrack, r.left - 210, r.bottom + 6);
                        }}
                        className="pm-pressable rounded-full p-1.5 text-[#D4D4E0] hover:bg-white/[0.12] hover:text-white"
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </section>

                {/* Tier 1b: Tu cola · Siguiente (user/playlist queue) */}
                <section
                  data-testid="user-queue-section"
                  aria-label="Tu cola · Siguiente"
                  className="space-y-1.5"
                >
                  <div className="flex items-center justify-between px-1">
                    <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-white/90">
                      Tu cola · Siguiente
                    </span>
                    <span className="tabular-nums rounded-full bg-white/[0.08] px-2 py-0.5 text-[10px] font-semibold text-[#D4D4E0]">
                      {upNextTracks.length}
                    </span>
                  </div>

                  {upNextTracks.length === 0 ? (
                    <div className="rounded-[12px] border border-dashed border-white/15 bg-white/[0.03] px-3.5 py-3 text-xs text-[#B4B4BE]">
                      No hay canciones pendientes en tu cola. Busca arriba o sube pistas con{' '}
                      <span className="font-semibold text-white">+</span> desde tus recomendadas.
                    </div>
                  ) : (
                    (() => {
                      const occMap = new Map<string, number>();
                      const rowKeys = upNextTracks.map((t) => {
                        const occ = occMap.get(t.id) ?? 0;
                        occMap.set(t.id, occ + 1);
                        return `${t.id}#next#${occ}`;
                      });
                      return upNextTracks.map((track, relIdx) => {
                        const realIdx = queueIndex + 1 + relIdx;
                        const rowKey = rowKeys[relIdx]!;
                        const prevRowKey = relIdx > 0 ? rowKeys[relIdx - 1] ?? null : null;
                        const ana = trackAnalyses[track.id];
                        const trackLiked = likedTracks.some((l) => l.trackId === track.id);
                        const isDragOver = dragOverQueueIdx === realIdx;
                        const isMoved = recentlyMovedKey === rowKey;
                        const isDisplaced = recentlyDisplacedKey === rowKey;
                        return (
                          <div
                            key={rowKey}
                            ref={(el) => {
                              if (el) queueRowRefs.current.set(rowKey, el);
                              else queueRowRefs.current.delete(rowKey);
                            }}
                            role="listitem"
                            draggable
                            onDragStart={(e) => {
                              setDragQueueIdx(realIdx);
                              setDraggedTrack(e, track);
                              e.dataTransfer.effectAllowed = 'copyMove';
                              e.dataTransfer.setData('text/plain', String(realIdx));
                            }}
                            onDragEnd={() => {
                              setDragQueueIdx(null);
                              setDragOverQueueIdx(null);
                              clearDraggedTrack();
                            }}
                            onDragOver={(e) => {
                              if (
                                dragQueueIdx === null ||
                                dragQueueIdx === realIdx ||
                                dragQueueIdx <= queueIndex
                              ) {
                                return;
                              }
                              e.preventDefault();
                              e.dataTransfer.dropEffect = 'move';
                              setDragOverQueueIdx(realIdx);
                            }}
                            onDragLeave={() => {
                              if (dragOverQueueIdx === realIdx) setDragOverQueueIdx(null);
                            }}
                            onDrop={(e) => {
                              e.preventDefault();
                              const from =
                                dragQueueIdx ??
                                Number.parseInt(e.dataTransfer.getData('text/plain'), 10);
                              setDragQueueIdx(null);
                              setDragOverQueueIdx(null);
                              if (Number.isFinite(from) && from > queueIndex && from !== realIdx) {
                                moveWithFlip(from, realIdx, rowKey);
                              }
                            }}
                            onContextMenu={(e) => {
                              e.preventDefault();
                              openTrackMenu(track, e.clientX, e.clientY);
                            }}
                            className={`group flex h-15 items-center justify-between gap-2.5 overflow-hidden rounded-[12px] px-2.5 transition-colors hover:bg-white/[0.09] ${
                              isMoved ? 'pm-queue-leap-over' : isDisplaced ? 'pm-queue-duck-under' : ''
                            } ${isDragOver ? 'border-t-2 border-white bg-white/[0.18]' : ''}`}
                          >
                            <div className="flex min-w-0 flex-1 items-center gap-2.5">
                              <span
                                aria-hidden="true"
                                className="hidden cursor-grab text-[#D4D4E0]/50 opacity-50 transition-opacity group-hover:opacity-100 sm:inline-flex"
                              >
                                <GripVertical className="h-4 w-4" />
                              </span>

                              <button
                                type="button"
                                aria-label={`Reproducir ${track.title}`}
                                onClick={() => void playTrack(track, queue.slice(realIdx))}
                                className="relative h-10 w-10 shrink-0 overflow-hidden rounded-[8px] bg-black/40"
                              >
                                <img
                                  src={track.thumbnailUrl}
                                  alt={track.title}
                                  className="h-full w-full object-cover"
                                />
                              </button>

                              <div className="min-w-0 flex-1">
                                <button
                                  type="button"
                                  onClick={() => void playTrack(track, queue.slice(realIdx))}
                                  className="block max-w-full truncate text-left text-[14px] font-semibold leading-snug text-[#F5F5F7] hover:underline"
                                >
                                  {track.title}
                                </button>
                                <div className="overflow-x-clip py-[1px] text-xs leading-normal text-[#D4D4E0]">
                                  <ArtistLinks
                                    artists={track.artists}
                                    onBeforeNavigate={() => setNowPlayingOpen(false)}
                                    linkClassName="hover:text-white hover:underline"
                                  />
                                </div>
                              </div>
                            </div>

                            <div className="flex shrink-0 items-center gap-1">
                              {djMode.enabled && (
                                <span className="tabular-nums hidden rounded-full bg-white/[0.10] px-2 py-0.5 text-[11px] font-semibold text-[#E9D5FF] sm:inline">
                                  {ana?.bpm ?? 120} BPM
                                </span>
                              )}

                              <span className="tabular-nums hidden px-1.5 text-xs font-medium text-[#D4D4E0] sm:inline">
                                {formatDurationSec(track.durationSec)}
                              </span>

                              <button
                                type="button"
                                aria-label={
                                  trackLiked
                                    ? `Quitar ${track.title} de Me gusta`
                                    : `Añadir ${track.title} a Me gusta`
                                }
                                onClick={() => void toggleLike(track)}
                                className={`pm-pressable hidden rounded-full p-1.5 transition-colors sm:inline-flex ${
                                  trackLiked
                                    ? 'text-[#FB7185]'
                                    : 'text-[#D4D4E0] hover:bg-white/[0.12] hover:text-white'
                                }`}
                              >
                                <Heart
                                  className={`h-3.5 w-3.5 ${trackLiked ? 'fill-current' : ''}`}
                                />
                              </button>

                              {relIdx > 0 && (
                                <button
                                  type="button"
                                  aria-label={`Subir ${track.title} en la cola`}
                                  onClick={() =>
                                    moveWithFlip(realIdx, realIdx - 1, rowKey, prevRowKey)
                                  }
                                  className="pm-pressable rounded-full px-2 py-1 text-xs font-semibold text-[#E5E5EA] opacity-75 transition-all hover:bg-white/[0.14] hover:text-white group-hover:opacity-100"
                                >
                                  <span className={isMoved ? 'pm-arrow-grab-up' : ''}>↑</span>
                                </button>
                              )}

                              <button
                                type="button"
                                aria-label={`Más opciones para ${track.title}`}
                                onClick={(e) => {
                                  const r = e.currentTarget.getBoundingClientRect();
                                  openTrackMenu(track, r.left - 210, r.bottom + 6);
                                }}
                                className="pm-pressable rounded-full p-1.5 text-[#D4D4E0] hover:bg-white/[0.12] hover:text-white"
                              >
                                <MoreHorizontal className="h-4 w-4" />
                              </button>

                              <button
                                type="button"
                                aria-label={`Quitar ${track.title} de la cola`}
                                onClick={() => removeQueueItem(realIdx)}
                                className="pm-pressable rounded-full p-1.5 text-[#D4D4E0] hover:bg-white/[0.12] hover:text-[#FB7185]"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </div>
                          </div>
                        );
                      });
                    })()
                  )}
                </section>

                {/* Tier 2: Cola infinita · Recomendadas para ti */}
                <section
                  data-testid="recommended-queue-section"
                  aria-label="Cola infinita · Recomendadas para ti"
                  className="space-y-1.5 border-t border-white/[0.10] pt-3"
                >
                  <div className="flex items-center justify-between px-1">
                    <div className="flex items-center gap-1.5">
                      <Sparkles className="h-3.5 w-3.5 text-[#E9D5FF]" />
                      <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#E9D5FF]">
                        Cola infinita · Recomendadas para ti
                      </span>
                    </div>

                    <button
                      type="button"
                      aria-label="Renovar recomendaciones"
                      onClick={() => void replenishRecommendedQueue(true)}
                      className="pm-pressable inline-flex items-center gap-1 rounded-full bg-white/[0.08] px-3 py-1 text-[10px] font-semibold text-[#F5F5F7] transition-colors hover:bg-white/[0.16]"
                    >
                      <RefreshCw
                        className={`h-3 w-3 ${isLoadingRecommendedQueue ? 'animate-spin' : ''}`}
                      />
                      <span>Renovar</span>
                    </button>
                  </div>

                  {recommendedQueue.length === 0 ? (
                    <div className="flex items-center gap-2 rounded-[12px] px-3 py-3 text-xs text-[#B4B4BE]">
                      {isLoadingRecommendedQueue ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-white" />
                          <span>Buscando próximas canciones afines…</span>
                        </>
                      ) : (
                        <span>Pulsa Renovar para cargar recomendaciones infinitas.</span>
                      )}
                    </div>
                  ) : (
                    recommendedQueue.map((rec) => {
                      const recLiked = likedTracks.some((l) => l.trackId === rec.id);
                      return (
                        <div
                          key={`rec-${rec.id}`}
                          data-testid="recommended-queue-item"
                          role="listitem"
                          onContextMenu={(e) => {
                            e.preventDefault();
                            openTrackMenu(rec, e.clientX, e.clientY);
                          }}
                          className="group flex h-14 items-center justify-between gap-2.5 overflow-hidden rounded-[12px] px-2.5 transition-colors hover:bg-white/[0.09]"
                        >
                          <div className="flex min-w-0 flex-1 items-center gap-2.5">
                            <button
                              type="button"
                              aria-label={`Reproducir recomendación ${rec.title}`}
                              onClick={() => void playTrack(rec, [rec])}
                              className="relative h-10 w-10 shrink-0 overflow-hidden rounded-[8px] bg-black/40"
                            >
                              <img
                                src={rec.thumbnailUrl}
                                alt={rec.title}
                                className="h-full w-full object-cover"
                              />
                            </button>

                            <div className="min-w-0 flex-1">
                              <button
                                type="button"
                                onClick={() => void playTrack(rec, [rec])}
                                className="block max-w-full truncate text-left text-[13.5px] font-semibold leading-snug text-[#F5F5F7] hover:underline"
                              >
                                {rec.title}
                              </button>
                              <div className="overflow-x-clip py-[1px] text-xs leading-normal text-[#D4D4E0]">
                                <ArtistLinks
                                  artists={rec.artists}
                                  onBeforeNavigate={() => setNowPlayingOpen(false)}
                                  linkClassName="hover:text-white hover:underline"
                                />
                              </div>
                            </div>
                          </div>

                          <div className="flex shrink-0 items-center gap-1">
                            <span className="tabular-nums hidden px-1.5 text-xs font-medium text-[#D4D4E0] sm:inline">
                              {formatDurationSec(rec.durationSec)}
                            </span>

                            <button
                              type="button"
                              aria-label={
                                recLiked
                                  ? `Quitar ${rec.title} de Me gusta`
                                  : `Añadir ${rec.title} a Me gusta`
                              }
                              onClick={() => void toggleLike(rec)}
                              className={`pm-pressable hidden rounded-full p-1.5 transition-colors sm:inline-flex ${
                                recLiked
                                  ? 'text-[#FB7185]'
                                  : 'text-[#D4D4E0] hover:bg-white/[0.12] hover:text-white'
                              }`}
                            >
                              <Heart className={`h-3.5 w-3.5 ${recLiked ? 'fill-current' : ''}`} />
                            </button>

                            <button
                              type="button"
                              aria-label={`Subir ${rec.title} a tu cola`}
                              onClick={() => {
                                promoteRecommendedTrack(rec.id);
                                showToast(`«${rec.title}» subida a Tu cola`);
                              }}
                              className="pm-pressable inline-flex h-7 w-7 items-center justify-center rounded-full bg-white/[0.08] text-[#F5F5F7] transition-colors hover:bg-white/[0.16] hover:text-white"
                              title="Subir a Tu cola"
                            >
                              <Plus className="h-3.5 w-3.5" />
                            </button>

                            <button
                              type="button"
                              aria-label={`Descartar ${rec.title}`}
                              onClick={() => dismissRecommendedTrack(rec.id)}
                              className="pm-pressable inline-flex h-7 w-7 items-center justify-center rounded-full text-[#B4B4BE] hover:bg-white/[0.12] hover:text-white"
                              title="Quitar recomendación"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </section>
              </div>
            </div>
          </div>
          );
        })()}
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
                setLyricsStyleModalOpen((v) => !v);
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
              {djMode.enabled ? 'Audio y DJ · Activo' : 'Audio y DJ'}
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

export const AudioStudioSheet: React.FC = () => {
  const {
    eqSheetOpen,
    djPopoverOpen,
    audioPanelTab,
    setAudioPanelTab,
    setEqSheetOpen,
    setDjPopoverOpen,
    nowPlayingOpen,
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
  } = usePMusicStore();

  const isOpen = eqSheetOpen || djPopoverOpen;

  React.useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest(
          '[data-testid="audio-studio-sheet"], [data-testid="eq-sheet"], [data-testid="dj-popover"], [data-testid="dock-eq-btn"], [data-testid="dock-dj-btn"], [data-testid="nowplaying-eq-btn"], [data-testid="nowplaying-dj-btn"], [data-testid="mobile-eq-btn"], [data-testid="mobile-dj-btn"]'
        )
      ) {
        return;
      }
      setEqSheetOpen(false);
      setDjPopoverOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [isOpen, setEqSheetOpen, setDjPopoverOpen]);

  if (!isOpen) return null;

  const crossfadePct = Math.round((safeCrossfade.durationSec / 12) * 100);
  const ana = trackAnalyses[currentTrack.id];
  const countdownSec =
    djMode.enabled && activeTransitionPlan
      ? Math.max(0, Math.round(activeTransitionPlan.cueOutSec - positionSec))
      : null;

  return (
    <>
      <div
        aria-hidden="true"
        onClick={() => {
          setEqSheetOpen(false);
          setDjPopoverOpen(false);
        }}
        className="fixed inset-0 z-[64] bg-black/50 sm:hidden"
      />
      <div
        role="dialog"
        aria-modal="false"
        aria-label={audioPanelTab === 'dj' ? 'Modo Sesión DJ y Efectos' : 'Ecualizador y Crossfade'}
        data-testid={audioPanelTab === 'dj' ? 'dj-popover' : 'eq-sheet'}
        className={`pm-glass-frosted-neutral pm-hud-dark pm-popover-enter fixed inset-x-0 bottom-0 z-[65] max-h-[82dvh] overflow-y-auto rounded-t-[28px] px-5 pt-3 pb-[max(1.5rem,var(--pm-safe-bottom,env(safe-area-inset-bottom)))] pm-no-scrollbar sm:inset-x-auto sm:mx-0 sm:w-[376px] sm:rounded-[24px] sm:p-4 sm:right-6 ${
          nowPlayingOpen ? 'sm:bottom-[74px]' : 'sm:bottom-[104px]'
        }`}
      >
        <div className="mb-3 flex items-center justify-between gap-2 sm:hidden">
          <div className="w-7" aria-hidden="true" />
          <div className="h-1 w-10 rounded-full bg-white/25" />
          <button
            type="button"
            aria-label="Cerrar estudio de audio"
            onClick={() => {
              setEqSheetOpen(false);
              setDjPopoverOpen(false);
            }}
            className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-white/80 hover:bg-white/20 hover:text-white"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Frosted Segmented Switcher: Sesión DJ | Ecualizador */}
        <div
          data-testid="audio-studio-sheet"
          className="mb-4 flex items-center justify-between gap-2 rounded-full bg-white/[0.08] p-1"
        >
          <button
            type="button"
            onClick={() => setAudioPanelTab('dj')}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-full py-1.5 text-xs font-bold transition-colors ${
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
            onClick={() => setAudioPanelTab('eq')}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-full py-1.5 text-xs font-bold transition-colors ${
              audioPanelTab === 'eq'
                ? 'bg-white text-[#070709] shadow-sm'
                : 'text-white/75 hover:text-white'
            }`}
          >
            <Sliders className="h-3.5 w-3.5" />
            <span>Audio y EQ</span>
          </button>
        </div>

        {audioPanelTab === 'dj' ? (
          <div>
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
              <button
                type="button"
                role="switch"
                data-testid="dj-mode-toggle"
                aria-checked={djMode.enabled}
                aria-label="Activar Modo Sesión DJ"
                onClick={() => void toggleDjMode()}
                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors ${
                  djMode.enabled ? 'bg-white' : 'bg-white/25'
                }`}
              >
                <span
                  className={`h-5 w-5 rounded-full shadow-sm transition-transform duration-200 ${
                    djMode.enabled ? 'translate-x-5 bg-[#070709]' : 'translate-x-0 bg-white'
                  }`}
                />
              </button>
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
        ) : (
          <div>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-[15px] font-bold leading-tight">Ecualizador</h2>
                <p className="mt-0.5 text-[11.5px] opacity-70">
                  Moldea el sonido banda por banda
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={userEq.enabled}
                aria-label="Activar ecualizador"
                onClick={() => setEqEnabled(!userEq.enabled)}
                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors ${
                  userEq.enabled ? 'bg-white' : 'bg-white/25'
                }`}
              >
                <span
                  className={`h-5 w-5 rounded-full shadow-sm transition-transform duration-200 ${
                    userEq.enabled
                      ? 'translate-x-5 bg-[#0A0A0F]'
                      : 'translate-x-0 bg-white'
                  }`}
                />
              </button>
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
                <button
                  type="button"
                  role="switch"
                  aria-checked={safeCrossfade.enabled && !djMode.enabled}
                  aria-label="Activar Crossfade seguro"
                  onClick={() =>
                    setSafeCrossfade({
                      enabled: djMode.enabled ? true : !safeCrossfade.enabled,
                      durationSec:
                        safeCrossfade.durationSec > 0 ? safeCrossfade.durationSec : 4,
                    })
                  }
                  className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold transition-colors ${
                    safeCrossfade.enabled && !djMode.enabled
                      ? 'bg-white text-[#070709]'
                      : 'bg-white/10 opacity-80 hover:bg-white/15'
                  }`}
                >
                  {safeCrossfade.enabled && !djMode.enabled ? 'Activo' : 'Off'}
                </button>
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
                    ? 'Máxima'
                    : streamQuality === 'medium'
                      ? 'Alta'
                      : 'Normal'}
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
                <button
                  type="button"
                  role="switch"
                  aria-checked={audioNormalization}
                  aria-label="Normalizar volumen"
                  onClick={() => setAudioNormalization(!audioNormalization)}
                  className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors ${
                    audioNormalization ? 'bg-white' : 'bg-white/25'
                  }`}
                >
                  <span
                    className={`h-4 w-4 rounded-full shadow-sm transition-transform duration-200 ${
                      audioNormalization
                        ? 'translate-x-4 bg-[#070709]'
                        : 'translate-x-0 bg-white'
                    }`}
                  />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
};

export const EqAndCrossfadeSheet = AudioStudioSheet;
export const DjPopover: React.FC = () => null;

export const DevicesConnectSheet: React.FC = () => {
  const {
    devicesSheetOpen,
    setDevicesSheetOpen,
    onlineDevices,
    selfDeviceId,
    syncMode,
    lastTransferBanner,
    transferPlaybackToDevice,
    sendRemoteDeviceCommand,
    pairDemoCompanionDevice,
    setSettingsOpen,
  } = usePMusicStore();

  if (!devicesSheetOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        aria-hidden="true"
        onClick={() => setDevicesSheetOpen(false)}
        className="pm-spotlight-backdrop absolute inset-0 bg-black/65"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Dispositivos conectados"
        data-testid="devices-sheet"
        className="pm-glass-regular pm-modal-pop relative z-10 flex max-h-[86dvh] w-full max-w-xl flex-col overflow-y-auto rounded-[22px] p-6 pm-text-primary"
      >
        <div className="flex items-center justify-between border-b pm-border pb-4">
          <div className="flex items-center gap-2.5">
            <Wifi className="h-5 w-5 text-emerald-500" />
            <div>
              <h2 className="text-lg font-bold pm-text-primary">
                Dispositivos (pMusic Connect)
              </h2>
              <p className="text-xs pm-text-secondary">
                Controla tu PC o móvil en vivo y transfiere la canción en el segundo exacto
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Cerrar dispositivos"
            onClick={() => setDevicesSheetOpen(false)}
            className="pm-btn-secondary rounded-full px-3.5 py-1.5 text-xs font-semibold"
          >
            Cerrar
          </button>
        </div>

        {lastTransferBanner && (
          <div className="mt-4 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-2.5 text-xs font-semibold pm-text-primary">
            {lastTransferBanner}
          </div>
        )}

        <div className="mt-4 space-y-3">
          {onlineDevices.map((dev) => {
            const isSelf = dev.device_id === selfDeviceId;
            return (
              <div
                key={dev.device_id}
                data-surface="content"
                className="pm-surface-card flex flex-col gap-3 rounded-[16px] p-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    {dev.platform === 'android' ? (
                      <Smartphone className="h-5 w-5 text-emerald-500" />
                    ) : (
                      <Laptop className="h-5 w-5 pm-text-primary" />
                    )}
                    <div>
                      <div className="flex items-center gap-2 text-sm font-bold pm-text-primary">
                        <span>{dev.device_name}</span>
                        {isSelf && (
                          <span className="pm-elevated rounded-full border pm-border px-2.5 py-0.5 text-[11px] font-medium pm-text-secondary">
                            Este dispositivo
                          </span>
                        )}
                        {dev.is_active && (
                          <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-500">
                            Activo
                          </span>
                        )}
                      </div>
                      <div className="text-xs pm-text-secondary">
                        {dev.track_title}
                      </div>
                    </div>
                  </div>

                  {!isSelf && (
                    <button
                      type="button"
                      onClick={() =>
                        void transferPlaybackToDevice(dev.device_id)
                      }
                      className="pm-btn-primary rounded-full px-4 py-2 text-xs font-bold"
                    >
                      Transferir aquí
                    </button>
                  )}
                </div>

                {!isSelf && (
                  <div className="flex items-center justify-between border-t pm-border pt-2">
                    <span className="text-xs font-medium pm-text-tertiary">
                      Control remoto en vivo:
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        aria-label={`Anterior en ${dev.device_name}`}
                        onClick={() =>
                          void sendRemoteDeviceCommand(dev.device_id, 'prev')
                        }
                        className="pm-btn-secondary rounded-full px-3 py-1.5 text-xs font-semibold"
                      >
                        Anterior
                      </button>
                      <button
                        type="button"
                        aria-label={`Play/Pausa en ${dev.device_name}`}
                        onClick={() =>
                          void sendRemoteDeviceCommand(dev.device_id, 'toggle')
                        }
                        className="pm-btn-primary rounded-full px-3.5 py-1.5 text-xs font-bold"
                      >
                        Play / Pausa
                      </button>
                      <button
                        type="button"
                        aria-label={`Siguiente en ${dev.device_name}`}
                        onClick={() =>
                          void sendRemoteDeviceCommand(dev.device_id, 'next')
                        }
                        className="pm-btn-secondary rounded-full px-3 py-1.5 text-xs font-semibold"
                      >
                        Siguiente
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div
          data-surface="content"
          className="pm-surface-card mt-5 flex flex-wrap items-center justify-between gap-3 rounded-[16px] p-4"
        >
          <div className="text-xs pm-text-secondary">
            Estado:{' '}
            <strong className="pm-text-primary">
              {syncMode === 'supabase'
                ? 'Supabase Realtime Conectado'
                : 'Sincronización Local Activa'}
            </strong>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => pairDemoCompanionDevice()}
              className="pm-btn-secondary rounded-full px-3.5 py-1.5 text-xs font-semibold"
            >
              Vincular dispositivo local
            </button>
            <button
              type="button"
              onClick={() => {
                setDevicesSheetOpen(false);
                setSettingsOpen(true);
              }}
              className="pm-btn-primary rounded-full px-4 py-1.5 text-xs font-bold"
            >
              Ajustes de cuenta
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export const ImportPlaylistModal: React.FC = () => {
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
