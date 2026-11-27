import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Copy,
  GripVertical,
  Loader2,
  MessageCircle,
  MoreHorizontal,
  Plus,
  QrCode,
  Radio,
  RefreshCw,
  Search,
  Share2,
  Shuffle,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { formatDurationSec, type Track } from '@pmusic/core';
import { getLivePlaybackPosition, usePMusicStore } from '../store/usePMusicStore.ts';
import { ArtistLinks } from './ArtistLinks.tsx';
import { LiquidHeartIcon } from './LiquidHeartIcon.tsx';
import { TrackArtwork } from './TrackArtwork.tsx';
import { UserAvatar } from './UserAvatar.tsx';
import {
  buildJamShareUrl,
  buildJamWhatsAppUrl,
  isJamQueueOpRequest,
} from '../services/social-service.ts';
import { openExternalUrl } from '../platform/web-bridge.ts';
import { clearDraggedTrack, setDraggedTrack } from '../utils/track-dnd.ts';

const ROW_PERF_STYLE: React.CSSProperties = {
  contentVisibility: 'auto',
  containIntrinsicSize: 'auto 60px',
  contain: 'layout style paint',
};

const QUEUE_SCROLL_STYLE: React.CSSProperties = {
  transform: 'translateZ(0)',
  willChange: 'scroll-position',
  contain: 'layout paint style',
  isolation: 'isolate',
};

const DjTransitionProgressBar: React.FC = React.memo(() => {
  const isTransitioning = usePMusicStore((s) => s.isTransitioning);
  const fillRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isTransitioning || typeof requestAnimationFrame !== 'function') return;
    let rafId = 0;
    const tick = () => {
      const p = Math.max(0, Math.min(1, getLivePlaybackPosition().transitionProgress01));
      if (fillRef.current) {
        fillRef.current.style.transform = `scaleX(${p.toFixed(4)})`;
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => {
      if (rafId && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(rafId);
    };
  }, [isTransitioning]);

  if (!isTransitioning) return null;
  return (
    <div className="h-1 w-full overflow-hidden rounded-full bg-white/15">
      <div
        ref={fillRef}
        className="h-full w-full origin-left rounded-full bg-white will-change-transform"
        style={{ transform: `scaleX(${Math.max(0, Math.min(1, getLivePlaybackPosition().transitionProgress01)).toFixed(4)})` }}
      />
    </div>
  );
});

interface QueueTrackRowProps {
  track: Track;
  realIdx: number;
  relIdx: number;
  rowKey: string;
  prevRowKey: string | null;
  queueLength: number;
  trackLiked: boolean;
  djEnabled: boolean;
  bpm: number;
  isDragOver: boolean;
  isPointerDragging?: boolean;
  pointerDeltaY?: number;
  isMoved: boolean;
  isDisplaced: boolean;
  onPlayAt: (realIdx: number) => void;
  onCloseSheet: () => void;
  onToggleLike: (track: Track) => void;
  onMoveWithFlip: (fromIdx: number, toIdx: number, movedKey: string, displacedKey?: string | null) => void;
  onOpenMenu: (track: Track, x: number, y: number) => void;
  onRemoveAt: (realIdx: number) => void;
  onDragStartIdx: (realIdx: number) => void;
  onDragEndIdx: () => void;
  onDragOverIdx: (e: React.DragEvent<HTMLDivElement>, realIdx: number) => void;
  onDragLeaveIdx: (realIdx: number) => void;
  onDropIdx: (e: React.DragEvent<HTMLDivElement>, realIdx: number, rowKey: string) => void;
  onPointerDragHandleDown?: (e: React.PointerEvent<HTMLSpanElement>, realIdx: number, rowKey: string) => void;
}

const QueueTrackRow: React.FC<QueueTrackRowProps> = React.memo(
  ({
    track,
    realIdx,
    relIdx,
    rowKey,
    prevRowKey,
    trackLiked,
    djEnabled,
    bpm,
    isDragOver,
    isPointerDragging,
    pointerDeltaY = 0,
    isMoved,
    isDisplaced,
    onPlayAt,
    onCloseSheet,
    onToggleLike,
    onMoveWithFlip,
    onOpenMenu,
    onRemoveAt,
    onDragStartIdx,
    onDragEndIdx,
    onDragOverIdx,
    onDragLeaveIdx,
    onDropIdx,
    onPointerDragHandleDown,
  }) => (
    <div
      data-queue-row-key={rowKey}
      data-queue-real-idx={realIdx}
      role="listitem"
      draggable
      style={{
        ...ROW_PERF_STYLE,
        ...(isPointerDragging
          ? {
              transform: `translate3d(0, ${pointerDeltaY.toFixed(1)}px, 0) scale(1.02)`,
              zIndex: 40,
              boxShadow: '0 14px 32px rgba(0, 0, 0, 0.55)',
              backgroundColor: 'rgba(255, 255, 255, 0.16)',
            }
          : {}),
      }}
      onDragStart={(e) => {
        onDragStartIdx(realIdx);
        setDraggedTrack(e, track);
        e.dataTransfer.effectAllowed = 'copyMove';
        e.dataTransfer.setData('text/plain', String(realIdx));
      }}
      onDragEnd={() => {
        onDragEndIdx();
        clearDraggedTrack();
      }}
      onDragOver={(e) => onDragOverIdx(e, realIdx)}
      onDragLeave={() => onDragLeaveIdx(realIdx)}
      onDrop={(e) => onDropIdx(e, realIdx, rowKey)}
      onContextMenu={(e) => {
        e.preventDefault();
        onOpenMenu(track, e.clientX, e.clientY);
      }}
      className={`group flex h-15 items-center justify-between gap-2.5 overflow-hidden rounded-[12px] px-2.5 transition-colors duration-75 hover:bg-white/[0.09] ${
        isMoved ? 'pm-queue-leap-over' : isDisplaced ? 'pm-queue-duck-under' : ''
      } ${isDragOver && !isPointerDragging ? 'border-t-2 border-white bg-white/[0.18]' : ''}`}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <span
          role="button"
          tabIndex={-1}
          aria-label={`Arrastrar ${track.title} en la cola`}
          onPointerDown={(e) => onPointerDragHandleDown?.(e, realIdx, rowKey)}
          className="inline-flex touch-none select-none cursor-grab items-center justify-center rounded-md px-1 py-2 -ml-1 text-[#D4D4E0]/70 opacity-75 transition-opacity duration-75 hover:text-white active:cursor-grabbing sm:opacity-55 sm:group-hover:opacity-100"
        >
          <GripVertical className="h-4 w-4" />
        </span>

        <button
          type="button"
          aria-label={`Reproducir ${track.title}`}
          onClick={() => onPlayAt(realIdx)}
          className="relative h-10 w-10 shrink-0 overflow-hidden rounded-[8px] bg-black/40"
        >
          <TrackArtwork
            trackId={track.id}
            src={track.thumbnailUrl}
            title={track.title}
            artistName={track.artists[0]?.name}
            artistId={track.artists[0]?.id}
            alt={track.title}
            variant="mini"
            loading="lazy"
            imgClassName="h-full w-full object-cover"
          />
        </button>

        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={() => onPlayAt(realIdx)}
            className="block max-w-full truncate text-left text-[14px] font-semibold leading-snug text-[#F5F5F7] hover:underline"
          >
            {track.title}
          </button>
          <div className="flex items-center gap-1.5 overflow-x-clip py-[1px] text-xs leading-normal text-[#D4D4E0]">
            <ArtistLinks
              artists={track.artists}
              disableOnMobile
              onBeforeNavigate={onCloseSheet}
              linkClassName="hover:text-white hover:underline"
            />
            {track.addedBy?.displayName && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-white/[0.10] px-1.5 py-0.5 text-[10px] font-semibold text-white/90">
                <UserAvatar
                  src={track.addedBy.avatarUrl}
                  name={track.addedBy.displayName}
                  size="xs"
                />
                <span className="max-w-[84px] truncate">{track.addedBy.displayName}</span>
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {djEnabled && (
          <span className="tabular-nums hidden rounded-full bg-white/[0.10] px-2 py-0.5 text-[11px] font-semibold text-[#E9D5FF] sm:inline">
            {bpm} BPM
          </span>
        )}

        <span className="tabular-nums hidden px-1.5 text-xs font-medium text-[#D4D4E0] sm:inline">
          {formatDurationSec(track.durationSec)}
        </span>

        <button
          type="button"
          aria-label={
            trackLiked ? `Quitar ${track.title} de Me gusta` : `Añadir ${track.title} a Me gusta`
          }
          onClick={() => onToggleLike(track)}
          className={`pm-pressable hidden rounded-full p-1.5 transition-colors duration-75 sm:inline-flex ${
            trackLiked
              ? 'text-[#FB7185]'
              : 'text-[#D4D4E0] hover:bg-white/[0.12] hover:text-white'
          }`}
        >
          <LiquidHeartIcon liked={trackLiked} className="h-3.5 w-3.5" />
        </button>

        {relIdx > 0 && (
          <button
            type="button"
            aria-label={`Subir ${track.title} en la cola`}
            onClick={() => onMoveWithFlip(realIdx, realIdx - 1, rowKey, prevRowKey)}
            className="pm-pressable rounded-full px-2 py-1 text-xs font-semibold text-[#E5E5EA] opacity-75 transition-colors duration-75 hover:bg-white/[0.14] hover:text-white group-hover:opacity-100"
          >
            <span className={isMoved ? 'pm-arrow-grab-up' : ''}>↑</span>
          </button>
        )}

        <button
          type="button"
          aria-label={`Más opciones para ${track.title}`}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            onOpenMenu(track, r.left - 210, r.bottom + 6);
          }}
          className="pm-pressable rounded-full p-1.5 text-[#D4D4E0] transition-colors duration-75 hover:bg-white/[0.12] hover:text-white"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>

        <button
          type="button"
          aria-label={`Quitar ${track.title} de la cola`}
          onClick={() => onRemoveAt(realIdx)}
          className="pm-pressable rounded-full p-1.5 text-[#D4D4E0] transition-colors duration-75 hover:bg-white/[0.12] hover:text-[#FB7185]"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
);

interface RecommendedQueueRowProps {
  rec: Track;
  recLiked: boolean;
  onPlayRec: (rec: Track) => void;
  onCloseSheet: () => void;
  onToggleLike: (track: Track) => void;
  onPromote: (rec: Track) => void;
  onDismiss: (recId: string) => void;
  onOpenMenu: (track: Track, x: number, y: number) => void;
}

const RecommendedQueueRow: React.FC<RecommendedQueueRowProps> = React.memo(
  ({ rec, recLiked, onPlayRec, onCloseSheet, onToggleLike, onPromote, onDismiss, onOpenMenu }) => (
    <div
      data-testid="recommended-queue-item"
      role="listitem"
      style={ROW_PERF_STYLE}
      onContextMenu={(e) => {
        e.preventDefault();
        onOpenMenu(rec, e.clientX, e.clientY);
      }}
      className="group flex h-14 items-center justify-between gap-2.5 overflow-hidden rounded-[12px] px-2.5 transition-colors duration-75 hover:bg-white/[0.09]"
    >
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <button
          type="button"
          aria-label={`Reproducir recomendación ${rec.title}`}
          onClick={() => onPlayRec(rec)}
          className="relative h-10 w-10 shrink-0 overflow-hidden rounded-[8px] bg-black/40"
        >
          <TrackArtwork
            trackId={rec.id}
            src={rec.thumbnailUrl}
            title={rec.title}
            artistName={rec.artists[0]?.name}
            artistId={rec.artists[0]?.id}
            alt={rec.title}
            variant="mini"
            loading="lazy"
            imgClassName="h-full w-full object-cover"
          />
        </button>

        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={() => onPlayRec(rec)}
            className="block max-w-full truncate text-left text-[13.5px] font-semibold leading-snug text-[#F5F5F7] hover:underline"
          >
            {rec.title}
          </button>
          <div className="overflow-x-clip py-[1px] text-xs leading-normal text-[#D4D4E0]">
            <ArtistLinks
              artists={rec.artists}
              disableOnMobile
              onBeforeNavigate={onCloseSheet}
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
            recLiked ? `Quitar ${rec.title} de Me gusta` : `Añadir ${rec.title} a Me gusta`
          }
          onClick={() => onToggleLike(rec)}
          className={`pm-pressable hidden rounded-full p-1.5 transition-colors duration-75 sm:inline-flex ${
            recLiked
              ? 'text-[#FB7185]'
              : 'text-[#D4D4E0] hover:bg-white/[0.12] hover:text-white'
          }`}
        >
          <LiquidHeartIcon liked={recLiked} className="h-3.5 w-3.5" />
        </button>

        <button
          type="button"
          aria-label={`Subir ${rec.title} a tu cola`}
          onClick={() => onPromote(rec)}
          className="pm-pressable inline-flex h-7 w-7 items-center justify-center rounded-full bg-white/[0.08] text-[#F5F5F7] transition-colors duration-75 hover:bg-white/[0.16] hover:text-white"
          title="Subir a Tu cola"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>

        <button
          type="button"
          aria-label={`Descartar ${rec.title}`}
          onClick={() => onDismiss(rec.id)}
          className="pm-pressable inline-flex h-7 w-7 items-center justify-center rounded-full text-[#B4B4BE] transition-colors duration-75 hover:bg-white/[0.12] hover:text-white"
          title="Quitar recomendación"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
);

/**
 * Isolated memoized right-column Queue panel for fullscreen & mobile NowPlayingSheet.
 * Uses fine-grained store selectors so playback clock ticks (`positionSec`) never re-render queue rows.
 */
export const NowPlayingQueuePanel: React.FC = React.memo(() => {
  const queue = usePMusicStore((s) => s.queue);
  const queueIndex = usePMusicStore((s) => s.queueIndex);
  const userQueueCount = usePMusicStore((s) => s.userQueueCount);
  const currentTrack = usePMusicStore((s) => s.currentTrack);
  const isPlaying = usePMusicStore((s) => s.isPlaying);
  const shuffleEnabled = usePMusicStore((s) => s.shuffleEnabled);
  const recommendedQueue = usePMusicStore((s) => s.recommendedQueue);
  const isLoadingRecommendedQueue = usePMusicStore((s) => s.isLoadingRecommendedQueue);
  const likedTracks = usePMusicStore((s) => s.likedTracks);
  const djMode = usePMusicStore((s) => s.djMode);
  const activeTransitionPlan = usePMusicStore((s) => s.activeTransitionPlan);
  const trackAnalyses = usePMusicStore((s) => s.trackAnalyses);
  const reducedMotionPref = usePMusicStore((s) => s.reducedMotionPref);
  const activeJamSession = usePMusicStore((s) => s.activeJamSession);
  const activeJamRole = usePMusicStore((s) => s.activeJamRole);
  const activeJamRequests = usePMusicStore((s) => s.activeJamRequests);

  const setNowPlayingOpen = usePMusicStore((s) => s.setNowPlayingOpen);
  const setJamInviteModalOpen = usePMusicStore((s) => s.setJamInviteModalOpen);
  const startJam = usePMusicStore((s) => s.startJam);
  const updateJamSettings = usePMusicStore((s) => s.updateJamSettings);
  const leaveOrEndJam = usePMusicStore((s) => s.leaveOrEndJam);
  const toggleShuffle = usePMusicStore((s) => s.toggleShuffle);
  const clearUpNextQueue = usePMusicStore((s) => s.clearUpNextQueue);
  const searchTracksForPlaylist = usePMusicStore((s) => s.searchTracksForPlaylist);
  const addTrackToActiveJam = usePMusicStore((s) => s.addTrackToActiveJam);
  const modifyJamQueueAsGuest = usePMusicStore((s) => s.modifyJamQueueAsGuest);
  const approveJamRequest = usePMusicStore((s) => s.approveJamRequest);
  const rejectJamRequest = usePMusicStore((s) => s.rejectJamRequest);
  const playTrack = usePMusicStore((s) => s.playTrack);
  const playQueueIndex = usePMusicStore((s) => s.playQueueIndex);
  const toggleLike = usePMusicStore((s) => s.toggleLike);
  const openTrackMenu = usePMusicStore((s) => s.openTrackMenu);
  const moveQueueItem = usePMusicStore((s) => s.moveQueueItem);
  const removeQueueItem = usePMusicStore((s) => s.removeQueueItem);
  const replenishRecommendedQueue = usePMusicStore((s) => s.replenishRecommendedQueue);
  const promoteRecommendedTrack = usePMusicStore((s) => s.promoteRecommendedTrack);
  const dismissRecommendedTrack = usePMusicStore((s) => s.dismissRecommendedTrack);
  const showToast = usePMusicStore((s) => s.showToast);

  const [dragQueueIdx, setDragQueueIdx] = useState<number | null>(null);
  const [dragOverQueueIdx, setDragOverQueueIdx] = useState<number | null>(null);
  const [pointerDragIdx, setPointerDragIdx] = useState<number | null>(null);
  const [pointerDragDeltaY, setPointerDragDeltaY] = useState(0);
  const [queueSearchQuery, setQueueSearchQuery] = useState('');
  const [queueSearchResults, setQueueSearchResults] = useState<Track[]>([]);
  const [isQueueSearching, setIsQueueSearching] = useState(false);
  const [jamQuickSettingsOpen, setJamQuickSettingsOpen] = useState(false);
  const [jamLinkCopied, setJamLinkCopied] = useState(false);
  const [recentlyMovedKey, setRecentlyMovedKey] = useState<string | null>(null);
  const [recentlyDisplacedKey, setRecentlyDisplacedKey] = useState<string | null>(null);

  const listContainerRef = useRef<HTMLDivElement | null>(null);
  const prevRowTopsRef = useRef<Map<string, number>>(new Map());
  const movedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointerDragSessionRef = useRef<{
    fromIdx: number;
    rowKey: string;
    startY: number;
    overIdx: number;
  } | null>(null);

  const likedIdSet = useMemo(() => new Set(likedTracks.map((l) => l.trackId)), [likedTracks]);

  const moveWithFlip = (
    fromIdx: number,
    toIdx: number,
    movedKey: string,
    displacedKey?: string | null
  ) => {
    const snap = new Map<string, number>();
    const rowNodes = listContainerRef.current?.querySelectorAll<HTMLElement>('[data-queue-row-key]');
    rowNodes?.forEach((el) => {
      const key = el.dataset.queueRowKey;
      if (key) snap.set(key, el.getBoundingClientRect().top);
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
    const rowNodes = listContainerRef.current?.querySelectorAll<HTMLElement>('[data-queue-row-key]');
    rowNodes?.forEach((el) => {
      const k = el.dataset.queueRowKey;
      if (!k) return;
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

  const isJamActive = Boolean(activeJamSession?.active);
  const isHostInJam = isJamActive && activeJamRole === 'host';
  const isGuestInJam = isJamActive && activeJamRole === 'guest';
  const pendingJamReqs = isHostInJam
    ? activeJamRequests.filter((r) => r.status === 'pending' && !isJamQueueOpRequest(r))
    : [];
  const activeQueueTrack = isGuestInJam
    ? (activeJamSession?.currentTrack ?? queue[queueIndex] ?? currentTrack)
    : (queue[queueIndex] ?? currentTrack);
  const upNextTracks = useMemo(
    () =>
      isGuestInJam
        ? (activeJamSession?.queue ?? []).filter((t) => t.id !== activeQueueTrack.id)
        : queue.slice(queueIndex + 1),
    [isGuestInJam, activeJamSession?.queue, activeQueueTrack.id, queue, queueIndex]
  );
  const rowKeys = useMemo(() => {
    const occMap = new Map<string, number>();
    return upNextTracks.map((t) => {
      const occ = occMap.get(t.id) ?? 0;
      occMap.set(t.id, occ + 1);
      return `${t.id}#next#${occ}`;
    });
  }, [upNextTracks]);

  const activeAna = trackAnalyses[activeQueueTrack.id];
  const activeLiked = likedIdSet.has(activeQueueTrack.id);

  const handleCloseSheet = () => setNowPlayingOpen(false);
  const handlePlayAt = (realIdx: number) => {
    if (isGuestInJam) {
      showToast('Solo el jefe de la Jam controla la reproducción');
      return;
    }
    void playQueueIndex(realIdx);
  };
  const handlePlayRec = (rec: Track) => {
    if (isGuestInJam) {
      showToast('Solo el jefe de la Jam controla la reproducción');
      return;
    }
    void playTrack(rec, [rec]);
  };
  const handleToggleLike = (t: Track) => void toggleLike(t);
  const handlePromote = (rec: Track) => {
    if (isGuestInJam) {
      void addTrackToActiveJam(rec, true);
      return;
    }
    promoteRecommendedTrack(rec.id);
    showToast(`«${rec.title}» subida a Tu cola`);
  };
  const handleDragOverIdx = (e: React.DragEvent<HTMLDivElement>, realIdx: number) => {
    if (dragQueueIdx === null || dragQueueIdx === realIdx || dragQueueIdx <= queueIndex) {
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverQueueIdx !== realIdx) setDragOverQueueIdx(realIdx);
  };
  const handleDragLeaveIdx = (realIdx: number) => {
    if (dragOverQueueIdx === realIdx) setDragOverQueueIdx(null);
  };
  const handleQueueMove = (
    fromRealIdx: number,
    toRealIdx: number,
    movedKey: string,
    displacedKey?: string | null
  ) => {
    if (isGuestInJam) {
      const fromRel = fromRealIdx - (queueIndex + 1);
      const toRel = toRealIdx - (queueIndex + 1);
      const target = upNextTracks[fromRel];
      if (target) {
        void modifyJamQueueAsGuest('move', target.id, Math.max(0, toRel));
      }
      return;
    }
    moveWithFlip(fromRealIdx, toRealIdx, movedKey, displacedKey);
  };
  const handleQueueRemove = (realIdx: number) => {
    if (isGuestInJam) {
      const rel = realIdx - (queueIndex + 1);
      const target = upNextTracks[rel];
      if (target) {
        void modifyJamQueueAsGuest('remove', target.id);
      }
      return;
    }
    removeQueueItem(realIdx);
  };
  const handleDropIdx = (e: React.DragEvent<HTMLDivElement>, realIdx: number, rowKey: string) => {
    e.preventDefault();
    const from = dragQueueIdx ?? Number.parseInt(e.dataTransfer.getData('text/plain'), 10);
    setDragQueueIdx(null);
    setDragOverQueueIdx(null);
    if (Number.isFinite(from) && from > queueIndex && from !== realIdx) {
      handleQueueMove(from, realIdx, rowKey);
    }
  };

  const handlePointerDragHandleDown = (
    e: React.PointerEvent<HTMLSpanElement>,
    realIdx: number,
    rowKey: string
  ) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // On mobile touch/pen, drive smooth touch drag-and-drop without fighting HTML5 drag
    if (e.pointerType === 'mouse') return;
    e.preventDefault();
    e.stopPropagation();
    const startY = e.clientY;
    pointerDragSessionRef.current = {
      fromIdx: realIdx,
      rowKey,
      startY,
      overIdx: realIdx,
    };
    setPointerDragIdx(realIdx);
    setPointerDragDeltaY(0);
    setDragOverQueueIdx(realIdx);

    const handleMove = (ev: PointerEvent) => {
      const sess = pointerDragSessionRef.current;
      if (!sess) return;
      setPointerDragDeltaY(ev.clientY - sess.startY);
      const container = listContainerRef.current;
      if (container) {
        const cRect = container.getBoundingClientRect();
        if (ev.clientY < cRect.top + 38) {
          container.scrollTop = Math.max(0, container.scrollTop - 12);
        } else if (ev.clientY > cRect.bottom - 38) {
          container.scrollTop += 12;
        }
        const rows = container.querySelectorAll<HTMLElement>('[data-queue-real-idx]');
        let bestIdx = sess.overIdx;
        let bestDist = Infinity;
        rows.forEach((node) => {
          const r = node.getBoundingClientRect();
          const midY = r.top + r.height * 0.5;
          const dist = Math.abs(ev.clientY - midY);
          const idxVal = Number(node.dataset.queueRealIdx);
          if (Number.isFinite(idxVal) && idxVal > queueIndex && dist < bestDist) {
            bestDist = dist;
            bestIdx = idxVal;
          }
        });
        if (bestIdx !== sess.overIdx) {
          sess.overIdx = bestIdx;
          setDragOverQueueIdx(bestIdx);
        }
      }
    };

    const cleanup = (commit: boolean) => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleCancel);
      const sess = pointerDragSessionRef.current;
      pointerDragSessionRef.current = null;
      setPointerDragIdx(null);
      setPointerDragDeltaY(0);
      setDragOverQueueIdx(null);
      if (commit && sess && sess.overIdx > queueIndex && sess.overIdx !== sess.fromIdx) {
        handleQueueMove(sess.fromIdx, sess.overIdx, sess.rowKey);
      }
    };

    const handleUp = () => cleanup(true);
    const handleCancel = () => cleanup(false);

    window.addEventListener('pointermove', handleMove, { passive: false });
    window.addEventListener('pointerup', handleUp, { once: true });
    window.addEventListener('pointercancel', handleCancel, { once: true });
  };

  return (
    <div
      data-testid="queue-view"
      className="flex h-full min-h-0 flex-col gap-3 lg:col-span-7 lg:max-h-[82vh] lg:gap-3.5 lg:self-center lg:pb-12"
    >
      {/* Clean Borderless Header */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-white/[0.08] pb-2.5 md:border-white/[0.12] md:pb-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[19px] font-bold tracking-tight text-white md:text-xl">
              {isJamActive ? 'Cola de Jam' : 'Cola de reproducción'}
            </h2>
            {isJamActive && activeJamSession && (
              <span
                data-testid="queue-jam-live-badge"
                className="pm-jam-live-badge inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10.5px] font-extrabold tracking-wide"
              >
                <span className="pm-jam-live-dot h-1.5 w-1.5 rounded-full animate-pulse" />
                EN VIVO · {activeJamSession.code}
              </span>
            )}
          </div>
          <p className="text-xs text-[#D4D4E0]">
            {isJamActive && activeJamSession
              ? `Anfitrión: ${activeJamSession.hostName} · ${upNextTracks.length} en cola compartida`
              : `${upNextTracks.length} en tu cola · ${recommendedQueue.length} recomendadas infinitas`}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {isJamActive && activeJamSession ? (
            <>
              <button
                type="button"
                onClick={() => setJamInviteModalOpen(true)}
                className="pm-pressable inline-flex h-8 items-center gap-1.5 rounded-full bg-white px-3 text-[11px] font-bold text-[#0A0A0D] shadow-sm hover:opacity-90"
              >
                <QrCode className="h-3.5 w-3.5" />
                Invitar
              </button>
              {isHostInJam && (
                <button
                  type="button"
                  data-testid="queue-jam-settings-btn"
                  aria-expanded={jamQuickSettingsOpen}
                  onClick={() => setJamQuickSettingsOpen((v) => !v)}
                  className={`pm-pressable inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[11px] font-semibold transition-colors ${
                    jamQuickSettingsOpen
                      ? 'bg-white text-[#0A0A0D]'
                      : 'bg-white/[0.10] text-white hover:bg-white/[0.18]'
                  }`}
                >
                  <SlidersHorizontal className="h-3.5 w-3.5" />
                  Ajustes
                </button>
              )}
              <button
                type="button"
                onClick={() => void leaveOrEndJam()}
                className="pm-pressable pm-jam-end-btn inline-flex h-8 items-center gap-1 rounded-full bg-rose-500/20 px-3 text-[11px] font-bold text-rose-300 hover:bg-rose-500/30"
              >
                {isHostInJam ? 'Finalizar' : 'Salir'}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                data-testid="queue-create-jam-btn"
                onClick={() => void startJam({ openSheet: true })}
                className="pm-pressable pm-jam-trigger-btn inline-flex h-8 items-center gap-1.5 rounded-full px-3.5 text-[11px] font-bold transition-all"
              >
                <Radio className="h-3.5 w-3.5" />
                Crear Jam
              </button>
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
            </>
          )}
          {upNextTracks.length > 0 && !isGuestInJam && (
            <button
              type="button"
              onClick={() => clearUpNextQueue()}
              className="pm-pressable h-8 rounded-full bg-white/[0.08] px-3.5 text-[11px] font-semibold text-[#F5F5F7] transition-colors hover:bg-white/[0.16]"
            >
              Limpiar
            </button>
          )}
        </div>
      </div>

      {/* pMusic Active Jam Quick Share & Settings Bar */}
      {isJamActive && activeJamSession && (
        <div
          data-testid="queue-jam-control-strip"
          className="pm-jam-live-card space-y-2.5 rounded-[16px] px-3 py-2.5"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                data-testid="queue-jam-whatsapp-btn"
                onClick={() =>
                  void openExternalUrl(
                    buildJamWhatsAppUrl(activeJamSession.hostName, activeJamSession.code)
                  )
                }
                className="pm-pressable inline-flex h-7 items-center gap-1.5 rounded-full bg-[#25D366]/20 px-2.5 text-[11px] font-bold text-[#4ADE80] hover:bg-[#25D366]/30"
              >
                <MessageCircle className="h-3.5 w-3.5" />
                WhatsApp
              </button>
              <button
                type="button"
                onClick={() => {
                  const url = buildJamShareUrl(activeJamSession.code);
                  void navigator.clipboard?.writeText(url);
                  setJamLinkCopied(true);
                  window.setTimeout(() => setJamLinkCopied(false), 1600);
                  showToast('Enlace de Jam copiado');
                }}
                className="pm-pressable inline-flex h-7 items-center gap-1.5 rounded-full bg-white/[0.10] px-2.5 text-[11px] font-semibold text-white hover:bg-white/[0.18]"
              >
                {jamLinkCopied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                {jamLinkCopied ? 'Copiado' : 'Copiar enlace'}
              </button>
              {typeof navigator !== 'undefined' && typeof navigator.share === 'function' && (
                <button
                  type="button"
                  onClick={() => {
                    void navigator
                      .share({
                        title: `Jam de ${activeJamSession.hostName} · pMusic`,
                        text: `Únete a la Jam (${activeJamSession.code}) en pMusic`,
                        url: buildJamShareUrl(activeJamSession.code),
                      })
                      .catch(() => {});
                  }}
                  className="pm-pressable inline-flex h-7 items-center gap-1.5 rounded-full bg-white/[0.10] px-2.5 text-[11px] font-semibold text-white hover:bg-white/[0.18]"
                >
                  <Share2 className="h-3 w-3" />
                  Compartir
                </button>
              )}
            </div>
            <span className="text-[10.5px] font-semibold text-white/70">
              {activeJamSession.allowGuestDirectAdd ? 'Entrada directa' : 'Con aprobación'}
            </span>
          </div>

          {isHostInJam && jamQuickSettingsOpen && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-2">
              <div className="flex items-center gap-1.5">
                <span className="text-[10.5px] font-semibold text-white/75">Cola:</span>
                <button
                  type="button"
                  onClick={() =>
                    void updateJamSettings({
                      allowGuestDirectAdd: !activeJamSession.allowGuestDirectAdd,
                    })
                  }
                  className={`pm-pressable rounded-full px-2.5 py-1 text-[10.5px] font-bold ${
                    activeJamSession.allowGuestDirectAdd
                      ? 'bg-white text-[#070709]'
                      : 'bg-white/[0.12] text-white'
                  }`}
                >
                  {activeJamSession.allowGuestDirectAdd ? 'Añaden directo' : 'Aprobar peticiones'}
                </button>
              </div>
              <div className="flex items-center gap-1">
                <span className="mr-1 text-[10.5px] font-semibold text-white/75">Límite:</span>
                {[
                  { val: 0, label: '∞' },
                  { val: 3, label: '3' },
                  { val: 5, label: '5' },
                  { val: 10, label: '10' },
                ].map((opt) => (
                  <button
                    key={opt.val}
                    type="button"
                    onClick={() => void updateJamSettings({ maxRequestsPerGuest: opt.val })}
                    className={`pm-pressable rounded-full px-2 py-0.5 text-[10.5px] font-bold ${
                      activeJamSession.maxRequestsPerGuest === opt.val
                        ? 'bg-white text-[#070709]'
                        : 'bg-white/[0.10] text-white/80 hover:bg-white/[0.18]'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Quick Inline Search to Add Songs Directly to Queue or Active Jam */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 rounded-full bg-white/[0.09] px-3.5 py-2.5 focus-within:bg-white/[0.14] md:border md:border-white/15 md:bg-white/[0.08] md:py-2 md:focus-within:border-white/40 md:focus-within:bg-white/[0.12]">
          <Search className="h-3.5 w-3.5 shrink-0 text-[#D4D4E0]" />
          <input
            type="text"
            aria-label={isJamActive ? 'Buscar canción para añadir a la Jam' : 'Buscar canción para añadir a la cola'}
            placeholder={
              isJamActive
                ? 'Buscar canción para añadir a la Jam…'
                : 'Buscar canción para añadir a la cola…'
            }
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
          {isQueueSearching && <Loader2 className="h-3.5 w-3.5 animate-spin text-white" />}
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
          <div className="space-y-1 rounded-[14px] border border-white/15 bg-black/45 p-2">
            {queueSearchResults.map((cand) => (
              <div
                key={`qadd-${cand.id}`}
                className="flex items-center justify-between gap-2.5 rounded-[10px] px-2.5 py-1.5 transition-colors duration-75 hover:bg-white/[0.10]"
              >
                <div className="flex min-w-0 flex-1 items-center gap-2.5">
                  <div className="h-8 w-8 shrink-0 overflow-hidden rounded-[6px] bg-black/40">
                    <TrackArtwork
                      trackId={cand.id}
                      src={cand.thumbnailUrl}
                      title={cand.title}
                      artistName={cand.artists[0]?.name}
                      artistId={cand.artists[0]?.id}
                      alt={cand.title}
                      variant="mini"
                      loading="lazy"
                      imgClassName="h-full w-full object-cover"
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-semibold leading-snug text-white">
                      {cand.title}
                    </div>
                    <div className="truncate text-xs leading-normal text-[#D4D4E0]">
                      <ArtistLinks
                        artists={cand.artists}
                        disableOnMobile
                        onBeforeNavigate={handleCloseSheet}
                        linkClassName="hover:text-white hover:underline"
                      />
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {(!isGuestInJam || activeJamSession?.allowGuestDirectAdd) && (
                    <button
                      type="button"
                      onClick={() => void addTrackToActiveJam(cand, true)}
                      className="pm-pressable rounded-full bg-white px-2.5 py-1 text-[11px] font-bold text-[#070709] hover:opacity-90"
                    >
                      + Siguiente
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void addTrackToActiveJam(cand, false)}
                    className="pm-pressable rounded-full border border-white/20 bg-white/[0.10] px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-white/[0.20]"
                  >
                    {isJamActive ? '+ Jam' : '+ Cola'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Host Pending Moderation Requests inside Jam Queue */}
      {pendingJamReqs.length > 0 && (
        <div className="space-y-1.5 rounded-[14px] border border-amber-400/25 bg-amber-500/10 p-2.5">
          <div className="px-1 text-[10.5px] font-bold uppercase tracking-wider text-amber-300">
            Peticiones por aprobar ({pendingJamReqs.length})
          </div>
          {pendingJamReqs.map((req) => (
            <div
              key={req.id}
              className="flex items-center justify-between gap-2 rounded-[10px] bg-black/30 px-2.5 py-1.5"
            >
              <div className="flex min-w-0 flex-1 items-center gap-2">
                {req.track && (
                  <div className="h-8 w-8 shrink-0 overflow-hidden rounded-md bg-black/40">
                    <TrackArtwork
                      trackId={req.track.id}
                      src={req.track.thumbnailUrl}
                      title={req.track.title}
                      artistName={req.track.artists?.[0]?.name}
                      alt={req.track.title}
                      variant="mini"
                      loading="lazy"
                      imgClassName="h-full w-full object-cover"
                    />
                  </div>
                )}
                <div className="min-w-0">
                  <div className="truncate text-xs font-semibold text-white">
                    {req.track?.title}
                  </div>
                  <div className="truncate text-[10.5px] text-white/65">
                    Pedido por {req.guestName}
                  </div>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  aria-label={`Aprobar ${req.track?.title}`}
                  onClick={() => void approveJamRequest(req)}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500/25 text-emerald-300 hover:bg-emerald-500/40"
                >
                  <Check className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  aria-label={`Rechazar ${req.track?.title}`}
                  onClick={() => void rejectJamRequest(req)}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-rose-500/25 text-rose-300 hover:bg-rose-500/40"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

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
          <DjTransitionProgressBar />
        </div>
      )}

      {/* GPU-Isolated Scrollable Borderless Two-Tier Queue */}
      <div
        ref={listContainerRef}
        role="list"
        style={QUEUE_SCROLL_STYLE}
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
            style={ROW_PERF_STYLE}
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
                <TrackArtwork
                  trackId={activeQueueTrack.id}
                  src={activeQueueTrack.thumbnailUrl}
                  title={activeQueueTrack.title}
                  artistName={activeQueueTrack.artists[0]?.name}
                  artistId={activeQueueTrack.artists[0]?.id}
                  alt={activeQueueTrack.title}
                  variant="mini"
                  draggable={false}
                  imgClassName="pointer-events-none h-full w-full select-none object-cover"
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
                <div className="flex items-center gap-1.5 overflow-x-clip py-[1px] text-xs leading-normal text-[#D4D4E0]">
                  <ArtistLinks
                    artists={activeQueueTrack.artists}
                    onBeforeNavigate={handleCloseSheet}
                    linkClassName="hover:text-white hover:underline"
                  />
                  {isJamActive && activeQueueTrack.addedBy?.displayName && (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-white/[0.10] px-1.5 py-0.5 text-[10px] font-semibold text-white/90">
                      <UserAvatar
                        src={activeQueueTrack.addedBy.avatarUrl}
                        name={activeQueueTrack.addedBy.displayName}
                        size="xs"
                      />
                      <span className="max-w-[84px] truncate">
                        {activeQueueTrack.addedBy.displayName}
                      </span>
                    </span>
                  )}
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
                className={`pm-pressable hidden rounded-full p-1.5 transition-colors duration-75 sm:inline-flex ${
                  activeLiked
                    ? 'text-[#FB7185]'
                    : 'text-[#D4D4E0] hover:bg-white/[0.12] hover:text-white'
                }`}
              >
                <LiquidHeartIcon liked={activeLiked} className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                aria-label={`Más opciones para ${activeQueueTrack.title}`}
                onClick={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  openTrackMenu(activeQueueTrack, r.left - 210, r.bottom + 6);
                }}
                className="pm-pressable rounded-full p-1.5 text-[#D4D4E0] transition-colors duration-75 hover:bg-white/[0.12] hover:text-white"
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
            </div>
          </div>
        </section>

        {/* Tier 1b: Tu cola · Siguiente */}
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
            upNextTracks.map((track, relIdx) => {
              const realIdx = queueIndex + 1 + relIdx;
              const rowKey = rowKeys[relIdx]!;
              const prevRowKey = relIdx > 0 ? rowKeys[relIdx - 1] ?? null : null;
              const showUserQueueBadge = !isGuestInJam && userQueueCount > 0 && relIdx === 0;
              const showContextQueueDivider =
                !isGuestInJam && userQueueCount > 0 && relIdx === userQueueCount;
              return (
                <React.Fragment key={rowKey}>
                  {showUserQueueBadge && (
                    <div className="pm-jam-queue-accent px-1 pt-0.5 text-[10px] font-bold uppercase tracking-[0.09em]">
                      Añadidas a tu cola ({Math.min(userQueueCount, upNextTracks.length)})
                    </div>
                  )}
                  {showContextQueueDivider && (
                    <div className="mt-1 border-t border-white/[0.08] px-1 pt-2 text-[10px] font-bold uppercase tracking-[0.09em] text-[#B4B4BE]">
                      Siguiente de la lista
                    </div>
                  )}
                  <QueueTrackRow
                    track={track}
                    realIdx={realIdx}
                    relIdx={relIdx}
                    rowKey={rowKey}
                    prevRowKey={prevRowKey}
                    queueLength={queue.length}
                    trackLiked={likedIdSet.has(track.id)}
                    djEnabled={djMode.enabled}
                    bpm={trackAnalyses[track.id]?.bpm ?? 120}
                    isDragOver={dragOverQueueIdx === realIdx}
                    isPointerDragging={pointerDragIdx === realIdx}
                    pointerDeltaY={pointerDragIdx === realIdx ? pointerDragDeltaY : 0}
                    isMoved={recentlyMovedKey === rowKey}
                    isDisplaced={recentlyDisplacedKey === rowKey}
                    onPlayAt={handlePlayAt}
                    onCloseSheet={handleCloseSheet}
                    onToggleLike={handleToggleLike}
                    onMoveWithFlip={handleQueueMove}
                    onOpenMenu={openTrackMenu}
                    onRemoveAt={handleQueueRemove}
                    onDragStartIdx={setDragQueueIdx}
                    onDragEndIdx={() => {
                      setDragQueueIdx(null);
                      setDragOverQueueIdx(null);
                    }}
                    onDragOverIdx={handleDragOverIdx}
                    onDragLeaveIdx={handleDragLeaveIdx}
                    onDropIdx={handleDropIdx}
                    onPointerDragHandleDown={handlePointerDragHandleDown}
                  />
                </React.Fragment>
              );
            })
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
            recommendedQueue.map((rec) => (
              <RecommendedQueueRow
                key={`rec-${rec.id}`}
                rec={rec}
                recLiked={likedIdSet.has(rec.id)}
                onPlayRec={handlePlayRec}
                onCloseSheet={handleCloseSheet}
                onToggleLike={handleToggleLike}
                onPromote={handlePromote}
                onDismiss={dismissRecommendedTrack}
                onOpenMenu={openTrackMenu}
              />
            ))
          )}
        </section>
      </div>
    </div>
  );
});
