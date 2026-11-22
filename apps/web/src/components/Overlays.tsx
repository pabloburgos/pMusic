import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Check,
  Download,
  GripVertical,
  Heart,
  Laptop,
  ListMusic,
  Loader2,
  Mic2,
  MoreHorizontal,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Search,
  Shuffle,
  SkipBack,
  SkipForward,
  Sliders,
  Smartphone,
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
  type Track,
} from '@pmusic/core';
import { usePMusicStore } from '../store/usePMusicStore.ts';
import {
  isElectronDesktopRuntime,
  setDesktopTitleBarOverlay,
} from '../platform/web-bridge.ts';
import { getThemeDefinition } from '../utils/themes.ts';
import { ArtistLinks } from './ArtistLinks.tsx';
import { AudioVisualizer } from './AudioVisualizer.tsx';

export const NowPlayingSheet: React.FC = () => {
  const {
    nowPlayingOpen,
    nowPlayingTab,
    setNowPlayingOpen,
    setNowPlayingTab,
    themeId,
    reducedMotionPref,
    lyricsSize,
    lyricsBlurEnabled,
    lastTrackDirection,
    currentTrack,
    queue,
    queueIndex,
    shuffleEnabled,
    repeatMode,
    isPlaying,
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
    searchTracksForPlaylist,
    playTrack,
    openAlbumDetail,
    showToast,
  } = usePMusicStore();

  const isElectronDesktop = isElectronDesktopRuntime();
  const activeLyricRef = useRef<HTMLButtonElement | null>(null);
  const [smoothPosSec, setSmoothPosSec] = useState(positionSec);
  const [dragQueueIdx, setDragQueueIdx] = useState<number | null>(null);
  const [dragOverQueueIdx, setDragOverQueueIdx] = useState<number | null>(null);
  const [queueSearchQuery, setQueueSearchQuery] = useState('');
  const [queueSearchResults, setQueueSearchResults] = useState<Track[]>([]);
  const [isQueueSearching, setIsQueueSearching] = useState(false);
  const [recentlyMovedKey, setRecentlyMovedKey] = useState<string | null>(null);
  const [transportAnim, setTransportAnim] = useState<'prev' | 'next' | 'play' | null>(null);

  const queueRowRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const prevRowTopsRef = useRef<Map<string, number>>(new Map());
  const transportTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const movedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lyricsScrollResumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const markLyricsUserScrolled = () => {
    setLyricsUserScrolled(true);
    if (lyricsScrollResumeTimerRef.current) clearTimeout(lyricsScrollResumeTimerRef.current);
    lyricsScrollResumeTimerRef.current = setTimeout(() => {
      setLyricsUserScrolled(false);
    }, 4500);
  };

  const triggerTransportAnim = (kind: 'prev' | 'next' | 'play') => {
    setTransportAnim(null);
    if (transportTimerRef.current) clearTimeout(transportTimerRef.current);
    requestAnimationFrame(() => {
      setTransportAnim(kind);
      transportTimerRef.current = setTimeout(() => setTransportAnim(null), 260);
    });
  };

  const moveWithFlip = (fromIdx: number, toIdx: number, movedKey: string) => {
    const snap = new Map<string, number>();
    queueRowRefs.current.forEach((el, k) => {
      snap.set(k, el.getBoundingClientRect().top);
    });
    prevRowTopsRef.current = snap;
    setRecentlyMovedKey(movedKey);
    if (movedTimerRef.current) clearTimeout(movedTimerRef.current);
    movedTimerRef.current = setTimeout(() => setRecentlyMovedKey(null), 460);
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
      el.style.transition = 'none';
      el.style.transform = `translateY(${deltaY}px)`;
      void el.offsetHeight;
      el.style.transition = 'transform 300ms cubic-bezier(0.22, 1, 0.36, 1)';
      el.style.transform = 'translateY(0)';
    });
    prevRowTopsRef.current = new Map();
  }, [queue, reducedMotionPref]);

  const syncClockRef = useRef({
    posSec: positionSec,
    atMs: typeof performance !== 'undefined' ? performance.now() : 0,
  });

  useEffect(() => {
    syncClockRef.current = {
      posSec: positionSec,
      atMs: typeof performance !== 'undefined' ? performance.now() : 0,
    };
    setSmoothPosSec(positionSec);
  }, [positionSec, currentTrack.id]);

  useEffect(() => {
    if (
      !nowPlayingOpen ||
      nowPlayingTab !== 'Letras' ||
      !isPlaying ||
      typeof requestAnimationFrame !== 'function'
    ) {
      return;
    }
    let rafId = 0;
    const step = (now: number) => {
      const elapsed = Math.max(0, (now - syncClockRef.current.atMs) / 1000);
      setSmoothPosSec(Math.min(Math.max(1, durationSec), syncClockRef.current.posSec + elapsed));
      rafId = requestAnimationFrame(step);
    };
    rafId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafId);
  }, [nowPlayingOpen, nowPlayingTab, isPlaying, durationSec]);

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
    if (
      nowPlayingOpen &&
      nowPlayingTab === 'Letras' &&
      !lyricsUserScrolled &&
      activeLyricRef.current &&
      typeof activeLyricRef.current.scrollIntoView === 'function'
    ) {
      activeLyricRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }
  }, [nowPlayingOpen, nowPlayingTab, resolvedActiveLyricIdx, lyricsUserScrolled]);

  if (!nowPlayingOpen) return null;

  const isLiked = likedTracks.some((l) => l.trackId === currentTrack.id);
  const dlStatus = offlineDownloads[currentTrack.id] ?? 'idle';
  const progressPct = Math.max(
    0,
    Math.min(100, (positionSec / Math.max(1, durationSec)) * 100)
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
  const repeatLabel =
    repeatMode === 'one'
      ? 'Repetir esta canción (siguiente: desactivar)'
      : repeatMode === 'all'
        ? 'Repetir playlist (siguiente: repetir una)'
        : 'Activar repetición de playlist';

  const PlayerDeckColumn = (compact = false) => (
    <div
      className={`flex flex-col items-center ${
        compact ? 'w-full gap-5' : 'mx-auto w-full max-w-md gap-6'
      }`}
    >
      {/* Pure Unobstructed Artwork with directional swap animation */}
      <div
        key={currentTrack.id}
        className={`${
          lastTrackDirection === 'prev' ? 'pm-cover-prev' : 'pm-cover-next'
        } relative aspect-square overflow-hidden rounded-[22px] border border-white/15 bg-[#111115] shadow-[0_32px_80px_rgba(0,0,0,0.72)] transition-transform duration-300 ${
          compact ? 'w-56 lg:w-72' : 'w-64 sm:w-80'
        } ${isPlaying ? 'scale-100' : 'scale-[0.95]'}`}
      >
        <img
          src={currentTrack.thumbnailHighUrl ?? currentTrack.thumbnailUrl}
          alt={currentTrack.title}
          className="h-full w-full object-cover"
        />
      </div>

      {/* Title, Artist & Liquid Glass Quick Actions */}
      <div className="flex w-full items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-bold tracking-tight text-[#F5F5F7]">
            {currentTrack.title}
          </h1>
          <div className="flex flex-wrap items-center gap-x-1.5 text-[15px] text-[#C4C4CE]">
            <ArtistLinks
              artists={currentTrack.artists}
              singleLine={false}
              onBeforeNavigate={() => setNowPlayingOpen(false)}
              linkClassName="hover:text-white hover:underline"
            />
            {currentTrack.album && (
              <>
                <span aria-hidden="true" className="opacity-60">
                  ·
                </span>
                <button
                  type="button"
                  onClick={() => {
                    const albumId = currentTrack.album?.id;
                    setNowPlayingOpen(false);
                    if (albumId) void openAlbumDetail(albumId);
                  }}
                  className="max-w-full truncate text-left hover:text-white hover:underline"
                >
                  {currentTrack.album.name}
                </button>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label={isLiked ? 'Quitar de Me gusta' : 'Añadir a Me gusta'}
            aria-pressed={isLiked}
            onClick={() => void toggleLike(currentTrack)}
            className={`pm-glass-chip flex h-10 w-10 items-center justify-center rounded-full ${
              isLiked ? 'text-[#FB7185]' : 'text-[#F5F5F7]'
            }`}
          >
            <Heart className={`h-5 w-5 ${isLiked ? 'fill-current' : ''}`} />
          </button>

          <button
            type="button"
            aria-label={
              dlStatus === 'downloaded'
                ? 'Descargada offline'
                : 'Descargar para escuchar offline'
            }
            onClick={() => void downloadTrackOffline(currentTrack)}
            className="pm-glass-chip flex h-10 w-10 items-center justify-center rounded-full text-[#F5F5F7]"
          >
            {dlStatus === 'downloading' ? (
              <Loader2 className="h-5 w-5 animate-spin text-white" />
            ) : dlStatus === 'downloaded' ? (
              <Check className="h-5 w-5 text-[#34D399]" />
            ) : (
              <Download className="h-5 w-5" />
            )}
          </button>

          <button
            type="button"
            aria-label={`Más opciones para ${currentTrack.title}`}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              openTrackMenu(currentTrack, r.left - 210, r.bottom + 8);
            }}
            className="pm-glass-chip flex h-10 w-10 items-center justify-center rounded-full text-[#F5F5F7]"
          >
            <MoreHorizontal className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Filled Scrubber & DJ Cue Marker + Timestamps */}
      <div className="w-full space-y-2">
        <div className="relative flex w-full items-center">
          {cueStartPct !== null && cueWidthPct > 0 && (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-[#C084FC]/70"
              style={{
                left: `${cueStartPct}%`,
                width: `${cueWidthPct}%`,
              }}
            />
          )}
          <input
            type="range"
            role="slider"
            aria-label="Progreso de la canción"
            min={0}
            max={Math.max(1, Math.round(durationSec))}
            value={Math.min(Math.round(durationSec), Math.round(positionSec))}
            onChange={(e) => seekTo(Number(e.target.value))}
            style={{ '--pm-fill': `${progressPct}%` } as React.CSSProperties}
            className="relative z-10 w-full"
          />
        </div>
        <div className="tabular-nums flex justify-between text-xs font-medium text-[#C4C4CE]">
          <span>{formatDurationSec(positionSec)}</span>
          <span>-{formatDurationSec(Math.max(0, durationSec - positionSec))}</span>
        </div>
      </div>

      {/* Floating Transport Row: Symmetrical Frameless Shuffle/Repeat + Circular Glass Prev/Next + White Play */}
      <div className="flex items-center justify-center gap-4 sm:gap-5">
        <button
          type="button"
          aria-label={
            shuffleEnabled
              ? 'Desactivar reproducción aleatoria'
              : 'Activar reproducción aleatoria'
          }
          aria-pressed={shuffleEnabled}
          onClick={() => toggleShuffle()}
          className={`pm-pressable relative flex h-10 w-10 items-center justify-center rounded-full bg-transparent transition-colors ${
            shuffleEnabled
              ? 'text-white'
              : 'text-[#B4B4BE] hover:text-white'
          }`}
        >
          <Shuffle className="h-4.5 w-4.5" />
          {shuffleEnabled && (
            <span
              aria-hidden="true"
              className="absolute bottom-1 h-1 w-1 rounded-full bg-white"
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
          className="pm-glass-chip pm-pressable flex h-12 w-12 items-center justify-center rounded-full text-[#F5F5F7] hover:scale-105"
        >
          <SkipBack
            className={`h-5 w-5 ${transportAnim === 'prev' ? 'pm-nudge-prev' : ''}`}
          />
        </button>

        <button
          type="button"
          aria-label={isPlaying ? 'Pausar' : 'Reproducir'}
          onClick={() => {
            triggerTransportAnim('play');
            void togglePlayPause();
          }}
          className={`pm-pressable flex h-[60px] w-[60px] items-center justify-center rounded-full bg-white text-[#070709] shadow-[0_12px_34px_rgba(255,255,255,0.28)] hover:scale-105 ${
            transportAnim === 'play' ? 'pm-play-morph' : ''
          }`}
        >
          {isPlaying ? (
            <Pause className="h-6 w-6 fill-current" />
          ) : (
            <Play className="h-6 w-6 translate-x-[1px] fill-current" />
          )}
        </button>

        <button
          type="button"
          aria-label="Siguiente canción"
          onClick={() => {
            triggerTransportAnim('next');
            void nextTrack();
          }}
          className="pm-glass-chip pm-pressable flex h-12 w-12 items-center justify-center rounded-full text-[#F5F5F7] hover:scale-105"
        >
          <SkipForward
            className={`h-5 w-5 ${transportAnim === 'next' ? 'pm-nudge-next' : ''}`}
          />
        </button>

        <button
          type="button"
          aria-label={repeatLabel}
          aria-pressed={repeatMode !== 'off'}
          onClick={() => cycleRepeatMode()}
          className={`pm-pressable relative flex h-10 w-10 items-center justify-center rounded-full bg-transparent transition-colors ${
            repeatMode !== 'off'
              ? 'text-white'
              : 'text-[#B4B4BE] hover:text-white'
          }`}
        >
          {repeatMode === 'one' ? (
            <Repeat1 className="h-4.5 w-4.5" />
          ) : (
            <Repeat className="h-4.5 w-4.5" />
          )}
          {repeatMode !== 'off' && (
            <span
              aria-hidden="true"
              className="absolute bottom-1 h-1 w-1 rounded-full bg-white"
            />
          )}
        </button>
      </div>

      {/* Minimalist Player Volume Bar */}
      <div className="flex w-full max-w-[280px] items-center gap-3 pt-1">
        <button
          type="button"
          aria-label={volume === 0 ? 'Activar sonido' : 'Silenciar'}
          onClick={() => toggleMute()}
          className="flex h-8 w-8 items-center justify-center rounded-full text-[#C4C4CE] hover:bg-white/15 hover:text-white"
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
          className="pm-range-subtle flex-1"
        />
        <span className="tabular-nums w-9 text-right text-[11px] font-medium text-[#C4C4CE]">
          {volumePct}%
        </span>
      </div>

      {!compact && <AudioVisualizer className="mt-1" barClassName="bg-white/75" />}
    </div>
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Reproduciendo ahora"
      data-testid="now-playing-sheet"
      className="pm-sheet-enter pm-dark-sliders fixed inset-0 z-50 flex flex-col overflow-hidden bg-[#070709] text-[#F5F5F7]"
    >
      {/* Dynamic Cover-Art Gradient Backdrop (Exclusive to Song / Now Playing view) */}
      <div
        aria-hidden="true"
        className="pm-ambient-mesh pointer-events-none absolute inset-0 opacity-80"
        style={{
          background:
            'radial-gradient(circle at 18% 22%, var(--pm-ambient-1), transparent 56%), radial-gradient(circle at 82% 76%, var(--pm-ambient-2), transparent 58%), linear-gradient(180deg, var(--pm-ambient-3) 0%, #070709 100%)',
        }}
      />

      {/* Apple HIG Bright Media Scrim (44% dark wash for guaranteed contrast) */}
      <div
        data-testid="bright-media-scrim"
        data-scrim="true"
        data-scrim-alpha="0.44"
        className="pointer-events-none absolute inset-0"
        style={{ backgroundColor: 'rgba(8, 8, 12, 0.44)' }}
      />

      {/* Minimalist Full Liquid Glass Header (with Electron Windows drag & optical 50% tab centering) */}
      <header
        className={`pm-drag-region relative z-10 flex items-center justify-between border-b border-white/[0.10] px-4 py-3 md:px-8 ${
          isElectronDesktop ? 'pr-[152px] md:pr-[152px]' : ''
        }`}
      >
        <button
          type="button"
          aria-label="Cerrar reproductor"
          onClick={() => setNowPlayingOpen(false)}
          className="pm-glass-chip pm-no-drag inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold text-[#F5F5F7]"
        >
          <X className="h-4 w-4" />
          <span className="hidden sm:inline">Cerrar</span>
        </button>

        <div
          role="tablist"
          aria-label="Vistas del reproductor"
          data-surface="glass"
          className="pm-glass-liquid pm-no-drag flex items-center gap-1 rounded-full p-1 sm:absolute sm:left-1/2 sm:-translate-x-1/2"
        >
          {(['Portada', 'Letras', 'Cola'] as const).map((tab) => {
            const active = nowPlayingTab === tab;
            return (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setNowPlayingTab(tab)}
                className={`rounded-full px-4 py-1.5 text-xs font-bold ${
                  active
                    ? 'bg-white text-[#070709] shadow-sm'
                    : 'text-[#E5E5EA] hover:bg-white/10 hover:text-white'
                }`}
              >
                {tab}
              </button>
            );
          })}
        </div>

        <div
          aria-hidden="true"
          className="hidden w-20 sm:block"
        />
      </header>

      {/* Main Content */}
      <div className="relative z-10 flex-1 overflow-y-auto px-4 py-6 md:px-10 md:py-8">
        {nowPlayingTab === 'Portada' && (
          <div className="pm-tab-enter flex min-h-full items-center justify-center">
            {PlayerDeckColumn(false)}
          </div>
        )}

        {nowPlayingTab === 'Letras' && (
          <div className="pm-tab-enter mx-auto grid max-w-6xl grid-cols-1 gap-8 lg:grid-cols-12 lg:items-start">
            <div className="hidden lg:sticky lg:top-4 lg:col-span-5 lg:block">
              {PlayerDeckColumn(true)}
            </div>

            <div
              data-testid="synced-lyrics-view"
              onWheel={markLyricsUserScrolled}
              onTouchMove={markLyricsUserScrolled}
              className="space-y-6 lg:col-span-7"
            >
              <div className="flex items-center justify-between lg:hidden">
                <div className="flex items-center gap-3">
                  <img
                    src={currentTrack.thumbnailUrl}
                    alt={currentTrack.title}
                    className="h-12 w-12 rounded-[10px] object-cover shadow-md"
                  />
                  <div>
                    <h2 className="text-base font-bold text-[#F5F5F7]">
                      {currentTrack.title}
                    </h2>
                    <p className="text-xs text-[#B4B4BE]">
                      <ArtistLinks
                        artists={currentTrack.artists}
                        onBeforeNavigate={() => setNowPlayingOpen(false)}
                        linkClassName="hover:text-white hover:underline"
                      />{' '}
                      · Toca una frase para saltar
                    </p>
                  </div>
                </div>
              </div>

              {lyricsUserScrolled && (
                <div className="sticky top-2 z-20 flex justify-end">
                  <button
                    type="button"
                    onClick={() => {
                      if (lyricsScrollResumeTimerRef.current) {
                        clearTimeout(lyricsScrollResumeTimerRef.current);
                      }
                      setLyricsUserScrolled(false);
                    }}
                    className="rounded-full bg-white px-4 py-1.5 text-xs font-bold text-[#070709] shadow-md"
                  >
                    Sincronizar con la reproducción
                  </button>
                </div>
              )}

              {currentLyrics && currentLyrics.lines.length > 0 ? (
                <div className="space-y-2 pb-16">
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
                    const isActive = idx === resolvedActiveLyricIdx;
                    const dist =
                      resolvedActiveLyricIdx >= 0
                        ? Math.abs(idx - resolvedActiveLyricIdx)
                        : idx;
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
                      lyricsSize === 'normal'
                        ? 'text-xl leading-[1.3] md:text-[26px] md:leading-[1.28]'
                        : lyricsSize === 'xl'
                          ? 'text-[30px] leading-[1.22] md:text-[38px] md:leading-[1.2]'
                          : 'text-[26px] leading-[1.26] md:text-[32px] md:leading-[1.24]';

                    const distClass = isActive
                      ? 'pm-lyric-line-active'
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
                    const totalWeight = words.reduce(
                      (sum, w) => sum + w.length + 1,
                      0
                    );
                    let weightCursor = 0;

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
                          className={`group relative flex w-full items-baseline justify-between gap-4 rounded-[14px] px-4 py-2.5 text-left font-bold tracking-tight ${lyricSizeClass} ${distClass}`}
                        >
                          <span className="flex-1">
                            {isActive && words.length > 0 ? (
                              words.map((word, wIdx) => {
                                const wLen = word.length + 1;
                                const wStart =
                                  weightCursor / Math.max(1, totalWeight);
                                weightCursor += wLen;
                                const wEnd =
                                  weightCursor / Math.max(1, totalWeight);
                                const wp = Math.max(
                                  0,
                                  Math.min(
                                    1,
                                    (verseProgress01 - wStart) /
                                      Math.max(0.01, wEnd - wStart)
                                  )
                                );
                                const liftPx =
                                  wp > 0 && wp < 1
                                    ? '-2.2px'
                                    : wp >= 1
                                      ? '-0.8px'
                                      : '0px';
                                const glowPx =
                                  wp > 0.08
                                    ? `${(6 * Math.sin(Math.min(1, wp) * Math.PI)).toFixed(1)}px`
                                    : '0px';
                                return (
                                  <React.Fragment key={`${idx}-${wIdx}`}>
                                    <span
                                      className="pm-sing-word"
                                      style={
                                        {
                                          '--word-p': `${Math.round(wp * 100)}%`,
                                          '--word-y': liftPx,
                                          '--word-glow': glowPx,
                                        } as React.CSSProperties
                                      }
                                    >
                                      {word}
                                    </span>
                                    {wIdx < words.length - 1 ? ' ' : ''}
                                  </React.Fragment>
                                );
                              })
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
              ) : (
                <div className="pm-surface-card rounded-[16px] p-10 text-center">
                  <Mic2 className="mx-auto mb-3 h-8 w-8 text-[#B4B4BE]" />
                  <p className="text-base font-semibold text-[#F5F5F7]">
                    No hay letra disponible para esta canción
                  </p>
                  <p className="mt-1 text-xs text-[#8E8E98]">
                    LRCLIB no encontró letra sincronizada ni texto para esta pista.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {nowPlayingTab === 'Cola' && (
          <div className="pm-tab-enter mx-auto grid max-w-6xl grid-cols-1 gap-8 lg:grid-cols-12 lg:items-start">
            <div className="hidden lg:sticky lg:top-4 lg:col-span-5 lg:block">
              {PlayerDeckColumn(true)}
            </div>

            {/* Free-floating Borderless Queue with Inline Quick-Add Search & Smooth FLIP Reordering */}
            <div
              data-testid="queue-view"
              className="flex max-h-[78vh] flex-col gap-3.5 lg:col-span-7"
            >
              {/* Clean Borderless Header */}
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.12] pb-3">
                <div>
                  <h2 className="text-xl font-bold tracking-tight text-white">
                    Cola de reproducción
                  </h2>
                  <p className="text-xs text-[#D4D4E0]">
                    {queue.length} pistas · Arrastra o usa ↑ para reordenar
                  </p>
                </div>

                {queue.length > 1 && (
                  <button
                    type="button"
                    onClick={() => clearUpNextQueue()}
                    className="pm-pressable h-8 rounded-full border border-white/15 bg-white/[0.08] px-3.5 text-[11px] font-semibold text-[#E5E5EA] hover:bg-white/[0.18] hover:text-white"
                  >
                    Limpiar cola
                  </button>
                )}
              </div>

              {/* Quick Inline Search to Add Songs Directly to Queue */}
              <div className="space-y-2">
                <div className="flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.08] px-3.5 py-2 focus-within:border-white/40 focus-within:bg-white/[0.12]">
                  <Search className="h-3.5 w-3.5 shrink-0 text-[#D4D4E0]" />
                  <input
                    type="search"
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
                      className="pm-pressable rounded-full p-0.5 text-[#D4D4E0] hover:bg-white/15 hover:text-white"
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
                            <div className="truncate text-xs font-semibold text-white">
                              {cand.title}
                            </div>
                            <div className="truncate text-[11px] text-[#D4D4E0]">
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

              {/* Scrollable Borderless Draggable Queue Rows with Smooth FLIP Animation */}
              <div
                role="list"
                className="flex-1 space-y-1 overflow-y-auto pr-1 pm-no-scrollbar"
              >
                {(() => {
                  const occMap = new Map<string, number>();
                  return queue.map((track, idx) => {
                    const occ = occMap.get(track.id) ?? 0;
                    occMap.set(track.id, occ + 1);
                    const rowKey = `${track.id}#${occ}`;
                    const isCurrent = idx === queueIndex;
                    const ana = trackAnalyses[track.id];
                    const trackLiked = likedTracks.some((l) => l.trackId === track.id);
                    const isDragOver = dragOverQueueIdx === idx;
                    const isMoved = recentlyMovedKey === rowKey;
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
                          setDragQueueIdx(idx);
                          e.dataTransfer.effectAllowed = 'move';
                          e.dataTransfer.setData('text/plain', String(idx));
                        }}
                        onDragEnd={() => {
                          setDragQueueIdx(null);
                          setDragOverQueueIdx(null);
                        }}
                        onDragOver={(e) => {
                          if (dragQueueIdx === null || dragQueueIdx === idx) return;
                          e.preventDefault();
                          e.dataTransfer.dropEffect = 'move';
                          setDragOverQueueIdx(idx);
                        }}
                        onDragLeave={() => {
                          if (dragOverQueueIdx === idx) setDragOverQueueIdx(null);
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          const from =
                            dragQueueIdx ??
                            Number.parseInt(e.dataTransfer.getData('text/plain'), 10);
                          setDragQueueIdx(null);
                          setDragOverQueueIdx(null);
                          if (Number.isFinite(from) && from !== idx) {
                            const movedTrack = queue[from];
                            moveWithFlip(from, idx, movedTrack ? `${movedTrack.id}#0` : rowKey);
                          }
                        }}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          openTrackMenu(track, e.clientX, e.clientY);
                        }}
                        className={`group flex h-15 items-center justify-between gap-2.5 overflow-hidden rounded-[12px] px-2.5 transition-colors ${
                          isCurrent
                            ? 'bg-white/[0.15]'
                            : 'hover:bg-white/[0.09]'
                        } ${isMoved ? 'pm-queue-moved' : ''} ${
                          isDragOver ? 'border-t-2 border-white bg-white/[0.18]' : ''
                        }`}
                      >
                        <div className="flex min-w-0 flex-1 items-center gap-2.5">
                          <span
                            aria-hidden="true"
                            className="cursor-grab text-[#D4D4E0]/50 opacity-50 transition-opacity group-hover:opacity-100"
                          >
                            <GripVertical className="h-4 w-4" />
                          </span>

                          <button
                            type="button"
                            aria-label={`Reproducir ${track.title}`}
                            onClick={() => void playTrack(track, queue)}
                            className="relative h-10 w-10 shrink-0 overflow-hidden rounded-[8px] bg-black/40"
                          >
                            <img
                              src={track.thumbnailUrl}
                              alt={track.title}
                              className="h-full w-full object-cover"
                            />
                            {isCurrent && isPlaying && (
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
                            <button
                              type="button"
                              onClick={() => void playTrack(track, queue)}
                              className="block max-w-full truncate text-left text-[14px] font-semibold text-[#F5F5F7] hover:underline"
                            >
                              {track.title}
                            </button>
                            <div className="truncate text-xs text-[#D4D4E0]">
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

                          {idx > 0 && (
                            <button
                              type="button"
                              aria-label={`Subir ${track.title} en la cola`}
                              onClick={() => moveWithFlip(idx, idx - 1, rowKey)}
                              className="pm-pressable rounded-full px-2 py-1 text-xs font-semibold text-[#E5E5EA] opacity-75 transition-all hover:bg-white/[0.14] hover:text-white group-hover:opacity-100"
                            >
                              ↑
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

                          {queue.length > 1 && (
                            <button
                              type="button"
                              aria-label={`Quitar ${track.title} de la cola`}
                              onClick={() => removeQueueItem(idx)}
                              className="pm-pressable rounded-full p-1.5 text-[#D4D4E0] hover:bg-white/[0.12] hover:text-[#FB7185]"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export const EqAndCrossfadeSheet: React.FC = () => {
  const {
    eqSheetOpen,
    setEqSheetOpen,
    userEq,
    safeCrossfade,
    djMode,
    setEqPreset,
    setEqBandGain,
    setEqEnabled,
    setSafeCrossfade,
  } = usePMusicStore();

  if (!eqSheetOpen) return null;

  const crossfadePct = Math.round((safeCrossfade.durationSec / 12) * 100);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        aria-hidden="true"
        onClick={() => setEqSheetOpen(false)}
        className="pm-spotlight-backdrop absolute inset-0 bg-black/65"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Ecualizador y Crossfade"
        data-testid="eq-sheet"
        className="pm-glass-regular pm-modal-pop relative z-10 flex max-h-[88dvh] w-full max-w-2xl flex-col overflow-y-auto rounded-[22px] p-6 pm-text-primary"
      >
        <div className="flex items-center justify-between border-b pm-border pb-4">
          <div className="flex items-center gap-2.5">
            <Sliders className="h-5 w-5 pm-text-primary" />
            <h2 className="text-lg font-bold pm-text-primary">
              Ecualizador y Crossfade
            </h2>
          </div>
          <button
            type="button"
            aria-label="Cerrar ecualizador"
            onClick={() => setEqSheetOpen(false)}
            className="pm-btn-secondary rounded-full px-3.5 py-1.5 text-xs font-semibold"
          >
            Cerrar
          </button>
        </div>

        <div className="mt-5 space-y-5">
          <section
            data-surface="content"
            className="pm-surface-card rounded-[16px] p-4"
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold pm-text-primary">
                  Crossfade seguro (0–12 s)
                </h3>
                <p className="text-xs pm-text-secondary">
                  {djMode.enabled
                    ? 'Pausado automáticamente mientras el Modo Sesión DJ está activo'
                    : 'Transición suave de potencia constante entre canciones'}
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={safeCrossfade.enabled}
                aria-label="Activar Crossfade seguro"
                disabled={djMode.enabled}
                onClick={() =>
                  setSafeCrossfade({ enabled: !safeCrossfade.enabled })
                }
                className={`rounded-full px-4 py-1.5 text-xs font-bold ${
                  safeCrossfade.enabled && !djMode.enabled
                    ? 'pm-btn-primary'
                    : 'pm-btn-secondary'
                }`}
              >
                {safeCrossfade.enabled && !djMode.enabled
                  ? 'Activo'
                  : 'Inactivo'}
              </button>
            </div>

            <div className="mt-3 flex items-center gap-4">
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
                className="flex-1"
              />
              <span className="tabular-nums text-sm font-bold pm-text-primary">
                {safeCrossfade.durationSec} s
              </span>
            </div>
          </section>

          <section
            data-surface="content"
            className="pm-surface-card rounded-[16px] p-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold pm-text-primary">
                Ecualizador de 5 bandas
              </h3>
              <button
                type="button"
                role="switch"
                aria-checked={userEq.enabled}
                aria-label="Activar ecualizador"
                onClick={() => setEqEnabled(!userEq.enabled)}
                className={`rounded-full px-4 py-1.5 text-xs font-bold ${
                  userEq.enabled ? 'pm-btn-primary' : 'pm-btn-secondary'
                }`}
              >
                {userEq.enabled ? 'EQ Activo' : 'EQ Inactivo'}
              </button>
            </div>

            <div className="mt-3 flex flex-wrap gap-1.5">
              {USER_EQ_PRESETS.map((preset) => {
                const active = userEq.preset === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setEqPreset(preset.id)}
                    className={`rounded-full px-3.5 py-1.5 text-xs font-bold ${
                      active ? 'pm-btn-primary' : 'pm-btn-secondary'
                    }`}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>

            <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-5">
              {USER_EQ_FREQUENCIES_HZ.map((freq, idx) => {
                const label =
                  freq >= 1000 ? `${freq / 1000} kHz` : `${freq} Hz`;
                const val = userEq.bandsDb[idx] ?? 0;
                const pct = Math.round(((val + 12) / 24) * 100);
                return (
                  <div
                    key={freq}
                    className="flex flex-col items-center gap-2 rounded-[12px] border pm-border pm-elevated p-3"
                  >
                    <span className="tabular-nums text-xs font-bold pm-text-primary">
                      {val > 0 ? `+${val}` : val} dB
                    </span>
                    <input
                      type="range"
                      role="slider"
                      aria-label={`Banda EQ ${label}`}
                      min={-12}
                      max={12}
                      step={0.5}
                      value={val}
                      onChange={(e) =>
                        setEqBandGain(idx, Number(e.target.value))
                      }
                      style={{ '--pm-fill': `${pct}%` } as React.CSSProperties}
                      className="w-full"
                    />
                    <span className="tabular-nums text-xs font-medium pm-text-tertiary">
                      {label}
                    </span>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};

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
