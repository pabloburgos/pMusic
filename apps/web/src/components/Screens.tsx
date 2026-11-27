import React, { useEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import {
  ArrowDownAZ,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock,
  Copy,
  Disc3,
  Download,
  GripVertical,
  Heart,
  Link2,
  ListMusic,
  ListOrdered,
  ListPlus,
  Loader2,
  MoreHorizontal,
  Music2,
  Palette,
  Pause,
  Pencil,
  Play,
  Plus,
  Radio,
  RefreshCw,
  Search,
  Share2,
  Shuffle,
  Sparkles,
  Timer,
  Trash2,
  User,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { formatDurationSec, type Track, type UserProfile } from '@pmusic/core';
import {
  filterAndSortPlaylistTracks,
  findPlaylistDuplicates,
  type PlaylistSortMode,
} from '../utils/playlist-tools.ts';
import {
  getSyncSupabaseClient,
  usePMusicStore,
  type LibraryCategoryTab,
  type SearchScopeTab,
} from '../store/usePMusicStore.ts';
import {
  buildPlaylistShareUrl,
  publishOrUpdateSharedPlaylistLink,
  searchProfilesByUsername,
} from '../services/social-service.ts';
import { UserAvatar } from './UserAvatar.tsx';
import { LiquidHeartIcon } from './LiquidHeartIcon.tsx';
import {
  formatPlaylistDuration,
  generatePlaylistBannerDataUrl,
  generatePlaylistCoverDataUrl,
} from '../utils/playlist-artwork.ts';
import { extractCharacteristicImageColor, type RgbTriple } from '../utils/cover-color.ts';
import {
  clearDraggedTrack,
  getDraggedSource,
  readTrackFromDropEvent,
  setDraggedTrack,
} from '../utils/track-dnd.ts';
import { ArtistLinks } from './ArtistLinks.tsx';
import { TrackArtwork } from './TrackArtwork.tsx';
import { SwipeableTrackRow } from './SwipeableTrackRow.tsx';
import { RoundedPauseIcon, RoundedPlayIcon } from './TransportIcons.tsx';
import { optimizeArtworkUrl } from '../utils/image-opt.ts';
import { buildSearchHomeRecommendations } from '../utils/instant-search.ts';

const SPANISH_SHORT_MONTHS = [
  'ene',
  'feb',
  'mar',
  'abr',
  'may',
  'jun',
  'jul',
  'ago',
  'sep',
  'oct',
  'nov',
  'dic',
] as const;

export function formatSpanishReleaseDate(
  iso?: string | null,
  fallbackYear?: number | null
): string {
  const raw = (iso ?? '').trim();
  const fullMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (fullMatch) {
    const year = Number.parseInt(fullMatch[1]!, 10);
    const month = Number.parseInt(fullMatch[2]!, 10);
    const day = Number.parseInt(fullMatch[3]!, 10);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${day} ${SPANISH_SHORT_MONTHS[month - 1]} ${year}`;
    }
  }
  const yearMatch = raw.match(/^(\d{4})$/);
  if (yearMatch) return yearMatch[1]!;
  if (typeof fallbackYear === 'number' && Number.isFinite(fallbackYear) && fallbackYear > 0) {
    return String(fallbackYear);
  }
  return '';
}

const PLAYLIST_SORT_OPTIONS: ReadonlyArray<{
  id: PlaylistSortMode;
  label: string;
  shortLabel: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'custom', label: 'Orden personalizado', shortLabel: 'Manual', icon: ListOrdered },
  { id: 'recent', label: 'Más recientes', shortLabel: 'Recientes', icon: Clock },
  { id: 'title', label: 'Título (A–Z)', shortLabel: 'Título', icon: ArrowDownAZ },
  { id: 'artist', label: 'Artista', shortLabel: 'Artista', icon: User },
  { id: 'duration', label: 'Duración', shortLabel: 'Duración', icon: Timer },
];

export const PlaylistSortControl: React.FC<{
  mode: PlaylistSortMode;
  onChange: (next: PlaylistSortMode) => void;
}> = ({ mode, onChange }) => {
  const showToast = usePMusicStore((s) => s.showToast);
  const [menuOpen, setMenuOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const activeIdx = Math.max(
    0,
    PLAYLIST_SORT_OPTIONS.findIndex((opt) => opt.id === mode)
  );
  const activeOpt = PLAYLIST_SORT_OPTIONS[activeIdx] ?? PLAYLIST_SORT_OPTIONS[0]!;
  const ActiveIcon = activeOpt.icon;

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  const handleMobileCycle = () => {
    const nextOpt = PLAYLIST_SORT_OPTIONS[(activeIdx + 1) % PLAYLIST_SORT_OPTIONS.length]!;
    onChange(nextOpt.id);
    showToast(`Orden: ${nextOpt.label}`);
  };

  return (
    <div ref={containerRef} className="relative shrink-0">
      {/* Desktop custom dark glass dropdown */}
      <div className="hidden sm:block">
        <button
          type="button"
          data-testid="playlist-sort-select"
          aria-label="Ordenar vista de playlist"
          aria-haspopup="listbox"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((prev) => !prev)}
          className={`pm-pressable inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-all ${
            menuOpen
              ? 'border-white/25 bg-white/[0.14] text-white shadow-lg'
              : 'border-white/12 bg-white/[0.06] text-white/90 hover:border-white/22 hover:bg-white/[0.1]'
          }`}
        >
          <ActiveIcon className="h-3.5 w-3.5 shrink-0 text-white/80" />
          <span>{activeOpt.label}</span>
          <ChevronDown
            className={`h-3.5 w-3.5 shrink-0 text-white/65 transition-transform duration-150 ${
              menuOpen ? 'rotate-180' : ''
            }`}
          />
        </button>

        {menuOpen && (
          <div
            role="listbox"
            aria-label="Ordenar vista de playlist"
            data-testid="playlist-sort-menu"
            className="pm-glass-frosted-neutral pm-hud-dark absolute right-0 top-[calc(100%+6px)] z-40 min-w-[216px] rounded-[16px] border border-white/15 p-1.5 shadow-2xl"
          >
            {PLAYLIST_SORT_OPTIONS.map((opt) => {
              const Icon = opt.icon;
              const selected = opt.id === mode;
              return (
                <button
                  key={opt.id}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  data-testid={`playlist-sort-option-${opt.id}`}
                  onClick={() => {
                    onChange(opt.id);
                    setMenuOpen(false);
                  }}
                  className={`flex w-full items-center justify-between gap-2.5 rounded-[11px] px-2.5 py-2 text-left text-xs font-semibold transition-colors ${
                    selected
                      ? 'bg-white text-black shadow-sm'
                      : 'text-white/85 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <Icon className="h-3.5 w-3.5 shrink-0" />
                    <span>{opt.label}</span>
                  </span>
                  {selected && <Check className="h-3.5 w-3.5 shrink-0" />}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Mobile compact single circular icon button with bottom toast confirmation */}
      <button
        type="button"
        data-testid="playlist-sort-mobile-btn"
        aria-label={`Ordenar vista de playlist: ${activeOpt.label}`}
        title={activeOpt.label}
        onClick={handleMobileCycle}
        className={`pm-pressable inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition-colors sm:hidden ${
          mode !== 'custom'
            ? 'border-white/30 bg-white text-black shadow-sm'
            : 'border-white/12 bg-white/[0.06] text-white/90 hover:bg-white/[0.12]'
        }`}
      >
        <ActiveIcon className="h-4 w-4 shrink-0" />
      </button>
    </div>
  );
};

function getSpanishGreeting(): string {
  const hour = new Date().getHours();
  if (hour >= 6 && hour < 13) return 'Buenos días';
  if (hour >= 13 && hour < 21) return 'Buenas tardes';
  return 'Buenas noches';
}

const PlayingEqBars: React.FC = () => (
  <span
    aria-hidden="true"
    className="inline-flex h-3.5 w-3.5 items-end justify-center gap-[2px]"
  >
    <span
      className="pm-eq-bar-1 h-full w-[2.5px] rounded-full"
      style={{ backgroundColor: 'var(--pm-accent-primary)' }}
    />
    <span
      className="pm-eq-bar-2 h-full w-[2.5px] rounded-full"
      style={{ backgroundColor: 'var(--pm-accent-primary)' }}
    />
    <span
      className="pm-eq-bar-3 h-full w-[2.5px] rounded-full"
      style={{ backgroundColor: 'var(--pm-accent-primary)' }}
    />
  </span>
);

const HeroIconAction: React.FC<{
  label: string;
  tooltip?: string;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
  pressed?: boolean;
  activeDot?: boolean;
  activeDotClass?: string;
  badge?: string | null;
  dataTestId?: string;
  className?: string;
  tooltipVariant?: 'dark' | 'surface';
  children: React.ReactNode;
}> = ({
  label,
  tooltip,
  onClick,
  disabled,
  pressed,
  activeDot,
  activeDotClass = 'bg-white',
  badge,
  dataTestId,
  className = '',
  tooltipVariant = 'dark',
  children,
}) => (
  <button
    type="button"
    data-testid={dataTestId}
    aria-label={label}
    title={tooltip ?? label}
    aria-pressed={pressed}
    disabled={disabled}
    onClick={onClick}
    className={`group/act pm-pressable relative inline-flex h-12 w-12 sm:h-14 sm:w-14 items-center justify-center rounded-lg border-0 bg-transparent transition-transform duration-150 hover:scale-115 active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 disabled:pointer-events-none disabled:opacity-35 ${className}`}
  >
    {children}
    <span
      aria-hidden="true"
      className={`pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 translate-y-1 whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] font-semibold opacity-0 shadow-lg transition-all duration-150 group-hover/act:translate-y-0 group-hover/act:opacity-100 group-focus-visible/act:translate-y-0 group-focus-visible/act:opacity-100 ${
        tooltipVariant === 'surface'
          ? 'pm-elevated border pm-border pm-text-primary'
          : 'bg-black/85 text-white ring-1 ring-white/15'
      }`}
    >
      {tooltip ?? label}
    </span>
    {activeDot && (
      <span
        aria-hidden="true"
        className={`absolute bottom-0.5 h-1.5 w-1.5 rounded-full shadow ${activeDotClass}`}
      />
    )}
    {badge && (
      <span className="absolute -bottom-1 rounded-full bg-black/85 px-1 text-[9px] font-bold text-emerald-300 ring-1 ring-white/15">
        {badge}
      </span>
    )}
  </button>
);

export const TrackListRow: React.FC<{
  track: Track;
  index?: number;
  queueContext?: Track[];
  playlistId?: string;
  onDropReorder?: (fromIndex: number, toIndex: number) => void;
}> = React.memo(({ track, index, queueContext, playlistId, onDropReorder }) => {
  const {
    isCurrent,
    isPlaying,
    isLiked,
    dlStatus,
    isOfflineNetwork,
    playTrack,
    togglePlayPause,
    toggleLike,
    downloadTrackOffline,
    addToQueue,
    removeTrackFromPlaylist,
    openTrackMenu,
    setAddToPlaylistModalTrack,
    recordPlaylistPlay,
  } = usePMusicStore(
    useShallow((s) => {
      const cur = s.currentTrack.id === track.id;
      return {
        isCurrent: cur,
        isPlaying: cur ? s.isPlaying : false,
        isLiked: s.likedTracks.some((l) => l.trackId === track.id),
        dlStatus: s.offlineDownloads[track.id] ?? 'idle',
        isOfflineNetwork: s.isOfflineNetwork,
        playTrack: s.playTrack,
        togglePlayPause: s.togglePlayPause,
        toggleLike: s.toggleLike,
        downloadTrackOffline: s.downloadTrackOffline,
        addToQueue: s.addToQueue,
        removeTrackFromPlaylist: s.removeTrackFromPlaylist,
        openTrackMenu: s.openTrackMenu,
        setAddToPlaylistModalTrack: s.setAddToPlaylistModalTrack,
        recordPlaylistPlay: s.recordPlaylistPlay,
      };
    })
  );

  const [dragOver, setDragOver] = useState(false);

  const isUnavailableOffline = isOfflineNetwork && dlStatus !== 'downloaded';

  const handleRowPlay = () => {
    if (isCurrent) {
      void togglePlayPause();
    } else {
      if (playlistId) {
        const pl = usePMusicStore.getState().playlists.find((p) => p.id === playlistId);
        if (pl) recordPlaylistPlay(pl);
      }
      void playTrack(track, queueContext);
    }
  };

  return (
    <SwipeableTrackRow
      onSwipeRight={() => addToQueue(track)}
      onSwipeLeft={() => setAddToPlaylistModalTrack(track)}
    >
      <div
      role="row"
      data-surface="content"
      draggable
      onDragStart={(e) => {
        e.stopPropagation();
        setDraggedTrack(
          e,
          track,
          playlistId && typeof index === 'number'
            ? { playlistId, index }
            : undefined
        );
      }}
      onDragEnd={() => {
        setDragOver(false);
        clearDraggedTrack();
      }}
      onDragOver={(e) => {
        if (!playlistId || !onDropReorder || typeof index !== 'number') return;
        const src = getDraggedSource();
        if (src && src.playlistId === playlistId && src.index !== index) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          setDragOver(true);
        }
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        if (!playlistId || !onDropReorder || typeof index !== 'number') return;
        const src = getDraggedSource();
        if (src && src.playlistId === playlistId && src.index !== index) {
          e.preventDefault();
          e.stopPropagation();
          setDragOver(false);
          onDropReorder(src.index, index);
        }
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        openTrackMenu(track, e.clientX, e.clientY, playlistId);
      }}
      className={`pm-hover group flex h-16 items-center justify-between gap-3 overflow-hidden rounded-[10px] px-2.5 transition-colors ${
        isCurrent ? 'pm-active-row' : ''
      } ${isUnavailableOffline ? 'opacity-45' : ''} ${dragOver ? 'border-t-2 border-[var(--pm-accent-primary)] pm-active-row' : ''}`}
    >
      <div
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-3"
        onClick={(e) => {
          const el = e.target as HTMLElement | null;
          if (el?.closest('button, a, [role="link"]')) return;
          handleRowPlay();
        }}
      >
        <span
          aria-hidden="true"
          className="hidden cursor-grab pm-text-tertiary opacity-0 transition-opacity group-hover:opacity-100 md:inline-flex"
        >
          <GripVertical className="h-3.5 w-3.5" />
        </span>

        {typeof index === 'number' && (
          <span className="tabular-nums hidden w-5 shrink-0 text-center text-xs font-medium pm-text-tertiary sm:inline-flex sm:items-center sm:justify-center">
            {isCurrent && isPlaying ? (
              <PlayingEqBars />
            ) : isCurrent ? (
              '▶'
            ) : (
              index + 1
            )}
          </span>
        )}

        <button
          type="button"
          aria-label={`Reproducir ${track.title}`}
          onClick={handleRowPlay}
          className="pm-elevated relative h-11 w-11 shrink-0 overflow-hidden rounded-[8px]"
        >
          <TrackArtwork
            trackId={track.id}
            src={track.thumbnailUrl}
            title={track.title}
            artistName={track.artists[0]?.name}
            artistId={track.artists[0]?.id}
            alt={track.title}
            variant="list"
            loading="eager"
            draggable={false}
            imgClassName="pointer-events-none h-full w-full select-none object-cover"
          />
          <span
            className={`absolute inset-0 flex items-center justify-center bg-black/55 text-white transition-opacity ${
              isCurrent ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
            }`}
          >
            {isCurrent && isPlaying ? (
              <Pause className="h-4 w-4 fill-current" />
            ) : (
              <Play className="h-4 w-4 translate-x-[1px] fill-current" />
            )}
          </span>
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleRowPlay}
              className={`pm-text-btn truncate text-left text-[14px] leading-[1.2] hover:underline pm-text-primary ${
                isCurrent ? 'font-bold' : 'font-medium'
              }`}
            >
              {track.title}
            </button>
            {track.isExplicit && (
              <span
                aria-label="Explícita"
                className="inline-flex h-[14px] w-[14px] shrink-0 items-center justify-center rounded-[3px] bg-[var(--pm-text-secondary)]/20 text-[9px] font-extrabold leading-none pm-text-secondary"
              >
                E
              </span>
            )}
          </div>
          <div className="mt-0.5 flex min-w-0 items-center gap-1.5 overflow-hidden text-[12.5px] leading-[1.2] pm-text-secondary">
            <ArtistLinks
              artists={track.artists}
              disableOnMobile
              className="min-w-0 shrink-0 max-w-[75%] !py-0 !leading-[1.2]"
              linkClassName="hover:underline hover:text-[var(--pm-text-primary)]"
            />
            {track.album && (
              <span className="hidden min-w-0 flex-1 truncate leading-[1.2] pm-text-tertiary lg:inline">
                · {track.album.name}
              </span>
            )}
            {track.addedBy?.displayName && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-white/[0.08] px-1.5 py-0.5 text-[10.5px] font-semibold pm-text-secondary">
                <UserAvatar
                  src={track.addedBy.avatarUrl}
                  name={track.addedBy.displayName}
                  size="xs"
                />
                <span className="max-w-[95px] truncate">{track.addedBy.displayName}</span>
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-0.5 sm:gap-1">
        <button
          type="button"
          aria-label={`Añadir ${track.title} a la cola`}
          onClick={() => addToQueue(track)}
          className="hidden items-center justify-center rounded-full p-2 pm-text-tertiary opacity-0 transition-opacity hover:bg-[var(--pm-hover-tint)] hover:text-[var(--pm-text-primary)] group-hover:opacity-100 focus-visible:opacity-100 sm:flex"
        >
          <ListPlus className="h-4 w-4" />
        </button>

        <button
          type="button"
          aria-label={
            isLiked
              ? `Quitar ${track.title} de Me gusta`
              : `Añadir ${track.title} a Me gusta`
          }
          aria-pressed={isLiked}
          onClick={() => void toggleLike(track)}
          className={`flex items-center justify-center rounded-full p-2 ${
            isLiked
              ? 'text-rose-500'
              : 'pm-text-tertiary hover:bg-[var(--pm-hover-tint)] hover:text-[var(--pm-text-primary)]'
          }`}
        >
          <LiquidHeartIcon liked={isLiked} className="h-4 w-4" />
        </button>

        <button
          type="button"
          aria-label={
            dlStatus === 'downloaded'
              ? `${track.title} descargada offline`
              : `Descargar ${track.title} offline`
          }
          onClick={() => void downloadTrackOffline(track)}
          className={`${
            dlStatus === 'downloaded' || dlStatus === 'downloading' ? 'flex' : 'hidden md:flex'
          } items-center justify-center rounded-full p-2 pm-text-tertiary hover:bg-[var(--pm-hover-tint)] hover:text-[var(--pm-text-primary)]`}
        >
          {dlStatus === 'downloading' ? (
            <Loader2 className="h-4 w-4 animate-spin pm-text-primary" />
          ) : dlStatus === 'downloaded' ? (
            <Check className="h-4 w-4 text-emerald-500" />
          ) : (
            <Download className="h-4 w-4" />
          )}
        </button>

        {playlistId && (
          <button
            type="button"
            aria-label={`Quitar ${track.title} de esta playlist`}
            onClick={() => void removeTrackFromPlaylist(playlistId, track.id)}
            className="hidden items-center justify-center rounded-full p-2 pm-text-tertiary opacity-0 transition-opacity hover:bg-rose-500/15 hover:text-rose-500 group-hover:opacity-100 focus-visible:opacity-100 sm:flex"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}

        <button
          type="button"
          aria-label={`Más opciones para ${track.title}`}
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            openTrackMenu(track, rect.left - 180, rect.bottom + 6, playlistId);
          }}
          className="flex items-center justify-center rounded-full p-2 pm-text-tertiary opacity-100 transition-opacity hover:bg-[var(--pm-hover-tint)] hover:text-[var(--pm-text-primary)] sm:opacity-70 sm:group-hover:opacity-100"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>

        <span className="tabular-nums w-11 text-right text-[12px] font-medium pm-text-tertiary">
          {formatDurationSec(track.durationSec)}
        </span>
      </div>
    </div>
    </SwipeableTrackRow>
  );
});
TrackListRow.displayName = 'TrackListRow';

const CoverCard: React.FC<{
  image: string;
  title: string;
  subtitle?: string;
  subtitleNode?: React.ReactNode;
  badge?: string;
  round?: boolean;
  dragTrack?: Track;
  fullWidth?: boolean;
  onOpen: () => void;
  onPlay?: () => void;
}> = ({
  image,
  title,
  subtitle,
  subtitleNode,
  badge,
  round,
  dragTrack,
  fullWidth,
  onOpen,
  onPlay,
}) => {
  const openTrackMenu = usePMusicStore((s) => s.openTrackMenu);

  return (
    <article
      data-surface="content"
      draggable={Boolean(dragTrack)}
      onDragStart={(e) => {
        if (dragTrack) setDraggedTrack(e, dragTrack);
      }}
      onDragEnd={() => {
        if (dragTrack) clearDraggedTrack();
      }}
      onContextMenu={(e) => {
        if (!dragTrack) return;
        e.preventDefault();
        openTrackMenu(dragTrack, e.clientX, e.clientY);
      }}
      className={`pm-cover-card pm-card-lift pm-surface-card group rounded-[14px] p-2.5 sm:rounded-[12px] ${
        fullWidth ? 'w-full' : 'w-[144px] shrink-0 snap-start sm:w-[166px] md:w-[178px]'
      }`}
    >
      <div className="relative">
        <button
          type="button"
          aria-label={`Abrir ${title}`}
          onClick={onOpen}
          className={`block w-full overflow-hidden text-left ${
            round ? 'rounded-full' : 'rounded-[12px] sm:rounded-[8px]'
          }`}
        >
          <img
            src={optimizeArtworkUrl(image, round ? 'avatar' : 'card')}
            alt={title}
            loading="lazy"
            decoding="async"
            className={`pm-elevated aspect-square w-full object-cover shadow-[0_10px_24px_rgba(0,0,0,0.42)] ring-1 ring-white/[0.08] transition-transform duration-300 ease-out group-hover:scale-[1.04] ${
              round ? 'rounded-full object-[50%_20%]' : 'rounded-[12px] sm:rounded-[8px]'
            }`}
          />
        </button>
        {badge && (
          <span className="pointer-events-none absolute top-2 left-2 rounded-full bg-black/60 backdrop-blur-md px-2 py-0.5 text-[10px] font-bold tracking-wider text-white">
            {badge}
          </span>
        )}
        {onPlay && (
          <button
            type="button"
            aria-label={`Reproducir ${title}`}
            onClick={onPlay}
            className="pm-cover-play pm-btn-primary absolute right-2 bottom-2 hidden h-11 w-11 items-center justify-center rounded-full shadow-xl hover:scale-105 sm:flex"
          >
            <Play className="h-5 w-5 translate-x-[1px] fill-current" />
          </button>
        )}
      </div>
      <div className={`mt-2 space-y-0.5 sm:mt-2.5 ${round ? 'text-center' : ''}`}>
        <button
          type="button"
          onClick={onOpen}
          className="pm-text-btn block w-full truncate text-left text-[13.5px] font-semibold leading-[1.2] pm-text-primary hover:underline sm:text-[14px]"
        >
          <span className={round ? 'block text-center' : ''}>{title}</span>
        </button>
        {subtitleNode ? (
          <div className="truncate text-[12px] leading-[1.25] pm-text-secondary">
            {subtitleNode}
          </div>
        ) : subtitle ? (
          <div className="line-clamp-2 text-[12px] leading-[1.25] pm-text-tertiary">
            {subtitle}
          </div>
        ) : null}
      </div>
    </article>
  );
};

const CarouselSection: React.FC<{
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}> = ({ title, subtitle, children }) => {
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (scrollerRef.current) {
      scrollerRef.current.scrollLeft = 0;
    }
  }, [title]);

  const scrollByDir = (dir: -1 | 1) => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * 520, behavior: 'smooth' });
  };

  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="text-[20px] font-bold tracking-tight pm-text-primary md:text-[22px]">
            {title}
          </h2>
          {subtitle && (
            <p className="text-[12.5px] pm-text-tertiary">{subtitle}</p>
          )}
        </div>
        <div className="hidden items-center gap-1.5 md:flex">
          <button
            type="button"
            aria-label={`Desplazar ${title} a la izquierda`}
            onClick={() => scrollByDir(-1)}
            className="pm-btn-secondary flex h-8 w-8 items-center justify-center rounded-full"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label={`Desplazar ${title} a la derecha`}
            onClick={() => scrollByDir(1)}
            className="pm-btn-secondary flex h-8 w-8 items-center justify-center rounded-full"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div
        ref={scrollerRef}
        className="pm-no-scrollbar -mx-4 flex snap-x scroll-pl-4 gap-3.5 overflow-x-auto px-4 py-1.5 sm:mx-0 sm:scroll-pl-1 sm:gap-4 sm:px-1 sm:py-2"
      >
        {children}
      </div>
    </section>
  );
};

export const DetailViewPanel: React.FC = React.memo(() => {
  const {
    activeDetailView,
    currentTrack,
    isPlaying,
    shuffleEnabled,
    alwaysShuffle,
    djMode,
    playlists,
    sharedPlaylists,
    friends,
    likedTracks,
    favoriteArtists,
    dismissedPlaylistRecs,
    playlistAppearances,
    offlineDownloads,
    playlistDownloadProgress,
    searchResults,
    authState,
    userProfile,
    playTrack,
    playCollection,
    togglePlayPause,
    playArtistShuffled,
    toggleFavoriteArtist,
    isArtistFavorite,
    setPlaylistShareMetadata,
    togglePlaylistCollaborative,
    inviteFriendToPlaylist,
    addTrackToCollaborativePlaylist,
    removeTrackFromCollaborativePlaylist,
    toggleDjMode,
    startTrackRadio,
    renamePlaylist,
    openPlaylistContextMenu,
    openPlaylistAppearanceModal,
    downloadPlaylistOffline,
    cancelPlaylistDownload,
    addTrackToPlaylist,
    removePlaylistDuplicates,
    reorderPlaylistTrack,
    searchTracksForPlaylist,
    dismissPlaylistRecommendation,
    fetchPlaylistRecommendations,
    openAlbumDetail,
    openArtistDetail,
    openLocalPlaylistDetail,
    recordPlaylistPlay,
    showToast,
  } = usePMusicStore(
    useShallow((s) => ({
      activeDetailView: s.activeDetailView,
      currentTrack: s.currentTrack,
      isPlaying: s.isPlaying,
      shuffleEnabled: s.shuffleEnabled,
      alwaysShuffle: s.alwaysShuffle,
      djMode: s.djMode,
      playlists: s.playlists,
      sharedPlaylists: s.sharedPlaylists,
      friends: s.friends,
      likedTracks: s.likedTracks,
      favoriteArtists: s.favoriteArtists,
      dismissedPlaylistRecs: s.dismissedPlaylistRecs,
      playlistAppearances: s.playlistAppearances,
      offlineDownloads: s.offlineDownloads,
      playlistDownloadProgress: s.playlistDownloadProgress,
      searchResults: s.searchResults,
      authState: s.authState,
      userProfile: s.userProfile,
      playTrack: s.playTrack,
      playCollection: s.playCollection,
      togglePlayPause: s.togglePlayPause,
      playArtistShuffled: s.playArtistShuffled,
      toggleFavoriteArtist: s.toggleFavoriteArtist,
      isArtistFavorite: s.isArtistFavorite,
      setPlaylistShareMetadata: s.setPlaylistShareMetadata,
      togglePlaylistCollaborative: s.togglePlaylistCollaborative,
      inviteFriendToPlaylist: s.inviteFriendToPlaylist,
      addTrackToCollaborativePlaylist: s.addTrackToCollaborativePlaylist,
      removeTrackFromCollaborativePlaylist: s.removeTrackFromCollaborativePlaylist,
      toggleDjMode: s.toggleDjMode,
      startTrackRadio: s.startTrackRadio,
      renamePlaylist: s.renamePlaylist,
      openPlaylistContextMenu: s.openPlaylistContextMenu,
      openPlaylistAppearanceModal: s.openPlaylistAppearanceModal,
      downloadPlaylistOffline: s.downloadPlaylistOffline,
      cancelPlaylistDownload: s.cancelPlaylistDownload,
      addTrackToPlaylist: s.addTrackToPlaylist,
      removePlaylistDuplicates: s.removePlaylistDuplicates,
      reorderPlaylistTrack: s.reorderPlaylistTrack,
      searchTracksForPlaylist: s.searchTracksForPlaylist,
      dismissPlaylistRecommendation: s.dismissPlaylistRecommendation,
      fetchPlaylistRecommendations: s.fetchPlaylistRecommendations,
      openAlbumDetail: s.openAlbumDetail,
      openArtistDetail: s.openArtistDetail,
      openLocalPlaylistDetail: s.openLocalPlaylistDetail,
      recordPlaylistPlay: s.recordPlaylistPlay,
      showToast: s.showToast,
    }))
  );

  const [isEditingName, setIsEditingName] = useState(false);
  const [editingName, setEditingName] = useState('');
  const [collabModalOpen, setCollabModalOpen] = useState(false);
  const [collabUserQuery, setCollabUserQuery] = useState('');
  const [collabUserHits, setCollabUserHits] = useState<UserProfile[]>([]);
  const [searchingCollabUsers, setSearchingCollabUsers] = useState(false);
  const [addFinderOverride, setAddFinderOverride] = useState<boolean | null>(null);
  const [heroMoreMenuId, setHeroMoreMenuId] = useState<string | null>(null);
  const [playlistDropActive, setPlaylistDropActive] = useState(false);
  const [playlistFilterQuery, setPlaylistFilterQuery] = useState('');
  const [playlistSortMode, setPlaylistSortMode] = useState<PlaylistSortMode>('custom');
  const [addSearchQuery, setAddSearchQuery] = useState('');
  const [addSearchResults, setAddSearchResults] = useState<Track[]>([]);
  const [isSearchingAdd, setIsSearchingAdd] = useState(false);
  const [recPool, setRecPool] = useState<Track[]>([]);
  const [isLoadingRecs, setIsLoadingRecs] = useState(false);
  const [sessionSkippedIds, setSessionSkippedIds] = useState<string[]>([]);
  const [artistDiscoTab, setArtistDiscoTab] = useState<'all' | 'albums' | 'singles'>('all');
  const [artistDiscoExpanded, setArtistDiscoExpanded] = useState(false);
  const artistDiscoRailRef = useRef<HTMLDivElement | null>(null);
  const [resolvedAppearanceDates, setResolvedAppearanceDates] = useState<Record<string, string>>({});
  const [showAllPopular, setShowAllPopular] = useState(false);
  const heroSectionRef = useRef<HTMLElement | null>(null);
  const [artistStickyVisible, setArtistStickyVisible] = useState(false);
  const [artistHeaderRgb, setArtistHeaderRgb] = useState<RgbTriple | null>(null);
  const [heroCandidateIdx, setHeroCandidateIdx] = useState(0);
  const [heroLoadedUrl, setHeroLoadedUrl] = useState<string | null>(null);
  const recTrackIdsRef = useRef<{ plId: string; ids: Set<string> }>({
    plId: '',
    ids: new Set(),
  });

  const activeArtistDetailId =
    activeDetailView?.kind === 'artist' ? activeDetailView.data.artist.id : null;
  const activeArtistBannerUrl =
    activeDetailView?.kind === 'artist' ? activeDetailView.data.bannerUrl : undefined;
  const activeArtistThumbUrl =
    activeDetailView?.kind === 'artist' ? activeDetailView.data.artist.thumbnailUrl : undefined;

  useEffect(() => {
    setArtistDiscoTab('all');
    setArtistDiscoExpanded(false);
    setShowAllPopular(false);
    setArtistStickyVisible(false);
    setArtistHeaderRgb(null);
    setHeroCandidateIdx(0);
    setHeroLoadedUrl(null);
  }, [activeArtistDetailId]);

  useEffect(() => {
    setHeroCandidateIdx(0);
    setHeroLoadedUrl(null);
    if (!activeArtistDetailId) return;
    let cancelled = false;
    void extractCharacteristicImageColor([
      optimizeArtworkUrl(activeArtistBannerUrl, 'row'),
      optimizeArtworkUrl(activeArtistThumbUrl, 'row'),
    ]).then((rgb) => {
      if (!cancelled && rgb) setArtistHeaderRgb(rgb);
    });
    return () => {
      cancelled = true;
    };
  }, [activeArtistDetailId, activeArtistBannerUrl, activeArtistThumbUrl]);

  useEffect(() => {
    if (!activeArtistDetailId) return;
    const heroEl = heroSectionRef.current;
    const scrollEl = heroEl?.closest('main') as HTMLElement | null;
    if (!heroEl) return;

    const updateSticky = () => {
      const rect = heroEl.getBoundingClientRect();
      const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
      if (isMobile) {
        const mobileHdrBottom =
          document.querySelector('[data-testid="mobile-top-header"]')?.getBoundingClientRect()
            .bottom ?? 64;
        setArtistStickyVisible(rect.bottom <= mobileHdrBottom + 18);
      } else if (scrollEl) {
        const mainRect = scrollEl.getBoundingClientRect();
        setArtistStickyVisible(rect.bottom <= mainRect.top + 80);
      }
    };

    updateSticky();
    scrollEl?.addEventListener('scroll', updateSticky, { passive: true });
    window.addEventListener('scroll', updateSticky, { passive: true });
    window.addEventListener('resize', updateSticky, { passive: true });
    return () => {
      scrollEl?.removeEventListener('scroll', updateSticky);
      window.removeEventListener('scroll', updateSticky);
      window.removeEventListener('resize', updateSticky);
    };
  }, [activeArtistDetailId]);

  const activeLocalPlaylistId =
    activeDetailView?.kind === 'local_playlist' ? activeDetailView.playlistId : null;
  const activeSharedPlaylistId =
    activeDetailView?.kind === 'shared_playlist' ? activeDetailView.sharedId : null;
  const activeLocalPlaylist = activeLocalPlaylistId
    ? playlists.find((p) => p.id === activeLocalPlaylistId)
    : undefined;
  const activeLocalTrackIdsKey = (activeLocalPlaylist?.tracks ?? []).map((t) => t.id).join('|');

  useEffect(() => {
    setAddFinderOverride(null);
    setAddSearchQuery('');
    setAddSearchResults([]);
    setPlaylistFilterQuery('');
    setPlaylistSortMode('custom');
    setIsEditingName(false);
    setSessionSkippedIds([]);
    setRecPool([]);
    setHeroMoreMenuId(null);
  }, [activeLocalPlaylistId, activeSharedPlaylistId]);

  useEffect(() => {
    if (!activeLocalPlaylistId || !activeLocalPlaylist) {
      recTrackIdsRef.current = { plId: '', ids: new Set() };
      setRecPool([]);
      setIsLoadingRecs(false);
      return;
    }

    const currentIds = new Set(activeLocalPlaylist.tracks.map((t) => t.id));
    if (activeLocalPlaylist.tracks.length < 10) {
      recTrackIdsRef.current = { plId: activeLocalPlaylistId, ids: currentIds };
      setRecPool([]);
      setIsLoadingRecs(false);
      return;
    }

    const prevSnap = recTrackIdsRef.current;
    const isSamePlaylist = prevSnap.plId === activeLocalPlaylistId;
    const addedTracks = isSamePlaylist
      ? activeLocalPlaylist.tracks.filter((t) => !prevSnap.ids.has(t.id))
      : [];
    const crossedThreshold = isSamePlaylist && prevSnap.ids.size < 10;
    const shouldFetch = !isSamePlaylist || crossedThreshold || addedTracks.length > 0;
    recTrackIdsRef.current = { plId: activeLocalPlaylistId, ids: currentIds };

    if (!shouldFetch) return;

    let cancelled = false;
    setIsLoadingRecs(true);
    const seedTrack =
      addedTracks.length > 0 ? addedTracks[addedTracks.length - 1] : undefined;

    void fetchPlaylistRecommendations(activeLocalPlaylistId, {
      ...(seedTrack ? { seedTrack } : {}),
    }).then((fresh) => {
      if (cancelled) return;
      if (seedTrack && isSamePlaylist && !crossedThreshold) {
        setRecPool((prev) => {
          const freshIds = new Set(fresh.map((f) => f.id));
          const keptPrev = prev
            .filter(
              (p) =>
                !currentIds.has(p.id) &&
                !freshIds.has(p.id)
            )
            .slice(0, 2);
          return [...fresh.slice(0, 4), ...keptPrev, ...fresh.slice(4)];
        });
      } else {
        setRecPool(fresh);
      }
      setIsLoadingRecs(false);
    });

    return () => {
      cancelled = true;
    };
  }, [
    activeLocalPlaylistId,
    activeLocalTrackIdsKey,
    fetchPlaylistRecommendations,
  ]);

  const activeArtistLatestAppearanceCandidate = (() => {
    if (activeDetailView?.kind !== 'artist') return null;
    const { artist, appearances = [], topSongs = [] } = activeDetailView.data;
    const artistKeyNorm = artist.name.trim().toLowerCase();
    const pool = Array.from(
      new Map<string, Track>([...appearances, ...topSongs].map((t) => [t.id, t])).values()
    ).filter(
      (t) =>
        t.artists.length > 1 || (t.artists[0]?.name ?? '').trim().toLowerCase() !== artistKeyNorm
    );
    return pool[0] ?? null;
  })();

  useEffect(() => {
    const tr = activeArtistLatestAppearanceCandidate;
    if (!tr || tr.releaseDate || !tr.id.startsWith('dz_')) return;
    if (resolvedAppearanceDates[tr.id]) return;
    const dzId = tr.id.slice(3);
    if (!dzId) return;
    let cancelled = false;
    void fetch(`/api/dz-proxy?path=${encodeURIComponent(`/track/${dzId}`)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        const relDate = String(data.release_date ?? data.album?.release_date ?? '').trim();
        if (relDate) {
          setResolvedAppearanceDates((prev) => ({ ...prev, [tr.id]: relDate }));
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [activeArtistLatestAppearanceCandidate?.id, activeArtistLatestAppearanceCandidate?.releaseDate, resolvedAppearanceDates]);

  if (!activeDetailView) return null;

  if (activeDetailView.kind === 'artist') {
    const isArtistLoading = Boolean(activeDetailView.isLoading);
    const {
      artist,
      bannerUrl,
      description,
      topSongs,
      appearances = [],
      albums,
      singles,
      relatedArtists,
    } = activeDetailView.data;
    const popularSongs = topSongs.slice(0, 10);
    const visiblePopularSongs = showAllPopular ? popularSongs : popularSongs.slice(0, 5);

    const isValidHeroUrl = (raw?: string | null): raw is string => {
      const u = (raw ?? '').trim();
      if (!u) return false;
      return !/images\/artist\/\/|\/artist\/d41d8cd98f00b204e9800998ecf8427e/i.test(u);
    };
    const heroCandidates = Array.from(
      new Set([bannerUrl, artist.thumbnailUrl].filter(isValidHeroUrl))
    );
    const activeHeroImage = heroCandidates[heroCandidateIdx] ?? null;
    const optimizedHeroUrl = activeHeroImage ? optimizeArtworkUrl(activeHeroImage, 'banner') : null;
    const lowResHeroPlaceholder = artist.thumbnailUrl
      ? optimizeArtworkUrl(artist.thumbnailUrl, 'row')
      : null;
    const hasHeroPhoto = Boolean(optimizedHeroUrl || lowResHeroPlaceholder);

    const dedupedSingles = (() => {
      const rawSingles = singles ?? [];
      if (!albums.length || !rawSingles.length) return rawSingles;
      const hashRe = /\/images\/cover\/([a-f0-9]{16,})\//i;
      const parseTs = (iso?: string): number | null => {
        if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return null;
        const ms = Date.parse(iso.slice(0, 10));
        return Number.isFinite(ms) ? ms : null;
      };
      const albumByCover = new Map<string, Array<{ ts: number | null; year?: number }>>();
      for (const al of albums) {
        const m = (al.thumbnailUrl ?? '').match(hashRe);
        if (!m?.[1]) continue;
        const hash = m[1].toLowerCase();
        const list = albumByCover.get(hash) ?? [];
        list.push({ ts: parseTs(al.releaseDate), year: al.year });
        albumByCover.set(hash, list);
      }
      const WATERFALL_WINDOW_MS = 21 * 86_400_000;
      return rawSingles.filter((sg) => {
        const m = (sg.thumbnailUrl ?? '').match(hashRe);
        if (!m?.[1]) return true;
        const candidates = albumByCover.get(m[1].toLowerCase());
        if (!candidates?.length) return true;
        const sTs = parseTs(sg.releaseDate);
        for (const al of candidates) {
          if (sTs !== null && al.ts !== null) {
            if (Math.abs(sTs - al.ts) <= WATERFALL_WINDOW_MS) return false;
          } else if (!sg.year || !al.year || sg.year === al.year) {
            return false;
          }
        }
        return true;
      });
    })();
    const allReleases = [
      ...albums.map((al) => ({ ...al, releaseKind: 'Álbum' as const })),
      ...dedupedSingles.map((sg) => ({ ...sg, releaseKind: 'Sencillo' as const })),
    ].sort((a, b) => {
      const da = a.releaseDate ?? `${a.year ?? 0}-01-01`;
      const db = b.releaseDate ?? `${b.year ?? 0}-01-01`;
      return db.localeCompare(da);
    });
    const latestRelease = allReleases[0] ?? null;
    const artistKeyNorm = artist.name.trim().toLowerCase();
    const isRealAppearanceTrack = (t: Track): boolean =>
      t.artists.length > 1 || (t.artists[0]?.name ?? '').trim().toLowerCase() !== artistKeyNorm;
    const isFromLatestRelease = (t: Track): boolean => {
      if (!latestRelease) return false;
      const tTitle = t.title.trim().toLowerCase();
      const tAlbum = (t.album?.name ?? '').trim().toLowerCase();
      const relTitle = latestRelease.title.trim().toLowerCase();
      return tTitle === relTitle || (Boolean(tAlbum) && tAlbum === relTitle);
    };
    const mergedAppearancePool = Array.from(
      new Map<string, Track>([...appearances, ...topSongs].map((t) => [t.id, t])).values()
    )
      .filter(isRealAppearanceTrack)
      .sort((a, b) => {
        const da = a.releaseDate ?? `${a.releaseYear ?? 0}-01-01`;
        const db = b.releaseDate ?? `${b.releaseYear ?? 0}-01-01`;
        const cmp = db.localeCompare(da);
        if (cmp !== 0) return cmp;
        const na = Number.parseInt(a.id.replace(/\D/g, ''), 10) || 0;
        const nb = Number.parseInt(b.id.replace(/\D/g, ''), 10) || 0;
        return nb - na;
      });
    const latestAppearance: Track | null =
      mergedAppearancePool.find((t) => !isFromLatestRelease(t)) ??
      mergedAppearancePool[0] ??
      null;
    const isDistinctAppearance = Boolean(
      latestAppearance && (!latestRelease || !isFromLatestRelease(latestAppearance))
    );
    const filteredDiscography =
      artistDiscoTab === 'albums'
        ? albums.map((al) => ({ ...al, releaseKind: 'Álbum' as const }))
        : artistDiscoTab === 'singles'
          ? dedupedSingles.map((sg) => ({ ...sg, releaseKind: 'Sencillo' as const }))
          : allReleases;
    const trimmedDesc = (description ?? '').trim();
    const hasBioText =
      Boolean(trimmedDesc) &&
      trimmedDesc.toLowerCase() !== (artist.subscribersText ?? '').trim().toLowerCase();

    const artistNameNorm = artist.name.trim().toLowerCase();
    const isPlayingThisArtist = Boolean(
      currentTrack &&
        currentTrack.artists.some(
          (a) => a.id === artist.id || a.name.trim().toLowerCase() === artistNameNorm
        )
    );

    const handleArtistPlay = () => {
      if (isPlayingThisArtist) {
        void togglePlayPause();
      } else if (alwaysShuffle) {
        void playArtistShuffled(artist, topSongs, albums, singles);
      } else if (topSongs[0]) {
        void playTrack(topSongs[0], topSongs);
      }
    };

    const handleArtistShuffle = () => {
      void playArtistShuffled(artist, topSongs, albums, singles);
    };

    const [hdrR, hdrG, hdrB] = artistHeaderRgb ?? [20, 20, 26];
    const stickyBgGradient = `linear-gradient(180deg, rgba(${hdrR}, ${hdrG}, ${hdrB}, 0.96) 0%, rgba(${Math.round(hdrR * 0.64)}, ${Math.round(hdrG * 0.64)}, ${Math.round(hdrB * 0.64)}, 0.96) 100%)`;
    const isLikedArtist =
      favoriteArtists.some(
        (fa) => fa.artistId === artist.id || fa.artistName.toLowerCase() === artist.name.toLowerCase()
      ) || isArtistFavorite(artist.name);

    const handleToggleArtistLike = () => {
      void toggleFavoriteArtist({
        id: artist.id,
        name: artist.name,
        thumbnailUrl: artist.thumbnailUrl ?? activeHeroImage ?? undefined,
      });
    };

    const renderStickyHeaderRow = (isStickyTestTarget: boolean) => (
      <>
        <div className="flex min-w-0 items-center gap-2.5 sm:gap-3.5">
          <button
            type="button"
            data-testid={isStickyTestTarget ? 'artist-sticky-play-btn' : undefined}
            aria-label={isPlayingThisArtist && isPlaying ? 'Pausar' : `Reproducir ${artist.name}`}
            onClick={handleArtistPlay}
            className="pm-pressable flex h-10 w-10 shrink-0 items-center justify-center bg-transparent text-white transition-transform duration-150 hover:scale-110 active:scale-90 focus:outline-none"
          >
            {isPlayingThisArtist && isPlaying ? (
              <RoundedPauseIcon className="h-7 w-7 drop-shadow-[0_2px_10px_rgba(0,0,0,0.45)]" />
            ) : (
              <RoundedPlayIcon className="h-7 w-7 translate-x-[1px] drop-shadow-[0_2px_10px_rgba(0,0,0,0.45)]" />
            )}
          </button>
          <span className="truncate text-lg font-black tracking-tight text-white sm:text-xl">
            {artist.name}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            aria-label={isLikedArtist ? `Quitar ${artist.name} de favoritos` : `Dar me gusta a ${artist.name}`}
            aria-pressed={isLikedArtist}
            onClick={handleToggleArtistLike}
            className={`pm-pressable flex h-10 w-10 shrink-0 items-center justify-center bg-transparent transition-transform duration-150 hover:scale-110 active:scale-90 focus:outline-none ${
              isLikedArtist ? 'text-rose-400' : 'text-white/85 hover:text-white'
            }`}
          >
            <LiquidHeartIcon liked={isLikedArtist} className="h-5 w-5" />
          </button>
          <button
            type="button"
            aria-label={`Aleatorio ${artist.name}`}
            onClick={handleArtistShuffle}
            className="pm-pressable relative flex h-10 w-10 shrink-0 items-center justify-center bg-transparent text-white/85 transition-transform duration-150 hover:scale-110 hover:text-white active:scale-90 focus:outline-none"
          >
            <Shuffle className="h-5 w-5" />
            {isPlayingThisArtist && shuffleEnabled && (
              <span className="absolute bottom-1 h-1 w-1 rounded-full bg-white" />
            )}
          </button>
        </div>
      </>
    );

    return (
      <div className="pm-page-enter">
        {/* Desktop Sticky Scroll Bar colored from the artist's photo */}
        <div className="hidden sm:block sticky top-0 z-30 -mx-7 h-0 overflow-visible">
          <div
            data-testid="artist-sticky-header"
            data-visible={artistStickyVisible ? 'true' : 'false'}
            aria-hidden={!artistStickyVisible}
            style={{ background: stickyBgGradient }}
            className={`flex h-[64px] items-center justify-between gap-3 px-7 shadow-[0_10px_28px_rgba(0,0,0,0.45)] backdrop-blur-2xl transition-all duration-200 ${
              artistStickyVisible
                ? 'pointer-events-auto translate-y-0 opacity-100'
                : 'pointer-events-none -translate-y-2 opacity-0'
            }`}
          >
            {renderStickyHeaderRow(true)}
          </div>
        </div>

        {/* Mobile Sticky Scroll Bar integrated cleanly right below pinned mobile controls */}
        <div
          data-testid="artist-sticky-header-mobile"
          data-visible={artistStickyVisible ? 'true' : 'false'}
          aria-hidden={!artistStickyVisible}
          style={{ background: stickyBgGradient }}
          className={`sm:hidden fixed inset-x-0 top-0 z-[35] rounded-b-[20px] px-4 pt-[calc(max(0.8rem,var(--pm-safe-top,env(safe-area-inset-top)))+3.1rem)] pb-2.5 shadow-[0_12px_32px_rgba(0,0,0,0.5)] backdrop-blur-2xl transition-all duration-200 ${
            artistStickyVisible
              ? 'pointer-events-auto translate-y-0 opacity-100'
              : 'pointer-events-none -translate-y-3 opacity-0'
          }`}
        >
          <div className="flex h-11 items-center justify-between gap-3">
            {renderStickyHeaderRow(false)}
          </div>
        </div>

        {/* Full-Bleed Atmospheric Banner (collapses to compact typographic header when no valid photo) */}
        <section
          ref={heroSectionRef}
          data-testid="artist-hero-banner"
          data-surface="content"
          className={
            hasHeroPhoto
              ? 'relative -mx-4 flex min-h-[340px] flex-col justify-end overflow-hidden bg-[var(--pm-bg-canvas)] px-5 pt-[calc(5.2rem+var(--pm-safe-top,env(safe-area-inset-top)))] pb-6 sm:-mx-7 sm:min-h-[360px] sm:p-8 sm:pb-7'
              : 'relative -mx-4 flex min-h-0 flex-col justify-end overflow-hidden bg-[var(--pm-bg-canvas)] px-5 pt-[calc(4.7rem+var(--pm-safe-top,env(safe-area-inset-top)))] pb-3 sm:-mx-7 sm:px-7 sm:pt-7 sm:pb-3'
          }
        >
          {(optimizedHeroUrl || lowResHeroPlaceholder) && (
            <>
              {lowResHeroPlaceholder && heroLoadedUrl !== optimizedHeroUrl && (
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 h-full w-full scale-110 bg-cover bg-[50%_22%] blur-xl opacity-80"
                  style={{ backgroundImage: `url("${lowResHeroPlaceholder}")` }}
                />
              )}
              {optimizedHeroUrl && (
                <img
                  src={optimizedHeroUrl}
                  alt=""
                  aria-hidden="true"
                  referrerPolicy="no-referrer"
                  decoding="async"
                  fetchPriority="high"
                  onLoad={() => setHeroLoadedUrl(optimizedHeroUrl)}
                  onError={() => setHeroCandidateIdx((i) => i + 1)}
                  className={`pointer-events-none absolute inset-0 h-full w-full scale-[1.02] object-cover object-[50%_22%] transition-opacity duration-300 ${
                    heroLoadedUrl === optimizedHeroUrl || !lowResHeroPlaceholder ? 'opacity-100' : 'opacity-0'
                  }`}
                />
              )}
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0"
                style={{
                  background:
                    'linear-gradient(180deg, color-mix(in srgb, var(--pm-bg-canvas) 18%, transparent) 0%, transparent 24%, color-mix(in srgb, var(--pm-bg-canvas) 14%, transparent) 46%, color-mix(in srgb, var(--pm-bg-canvas) 52%, transparent) 66%, color-mix(in srgb, var(--pm-bg-canvas) 84%, transparent) 82%, color-mix(in srgb, var(--pm-bg-canvas) 97%, transparent) 93%, var(--pm-bg-canvas) 100%)',
                }}
              />
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0"
                style={{
                  background:
                    'linear-gradient(90deg, color-mix(in srgb, var(--pm-bg-canvas) 62%, transparent) 0%, transparent 55%)',
                }}
              />
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 bottom-0 h-2 bg-[var(--pm-bg-canvas)]"
              />
            </>
          )}

          <div className="relative z-10 flex items-end justify-between gap-4">
            <div className="min-w-0 flex-1 space-y-1.5">
              <h1 className="truncate text-4xl font-black tracking-tight pm-text-primary drop-shadow-[0_4px_20px_rgba(0,0,0,0.65)] sm:text-5xl md:text-6xl">
                {artist.name}
              </h1>
              {(artist.subscribersText || description) && (
                <p className="text-xs font-semibold pm-text-secondary drop-shadow sm:text-sm">
                  {artist.subscribersText ?? description}
                </p>
              )}
            </div>

            <div className="flex shrink-0 items-center gap-2 pb-0.5 sm:gap-3.5">
              <button
                type="button"
                data-testid="artist-like-btn"
                aria-label={isLikedArtist ? `Quitar ${artist.name} de favoritos` : `Dar me gusta a ${artist.name}`}
                aria-pressed={isLikedArtist}
                onClick={handleToggleArtistLike}
                className={`pm-pressable relative flex h-12 w-12 items-center justify-center bg-transparent drop-shadow-[0_4px_14px_rgba(0,0,0,0.55)] transition-transform duration-150 hover:scale-110 active:scale-90 focus:outline-none sm:h-14 sm:w-14 ${
                  isLikedArtist ? 'text-rose-400' : 'text-white/85 hover:text-white'
                }`}
              >
                <LiquidHeartIcon liked={isLikedArtist} className="h-6 w-6 sm:h-7 sm:w-7" />
              </button>

              <button
                type="button"
                data-testid="artist-shuffle-btn"
                aria-label="Aleatorio"
                aria-pressed={isPlayingThisArtist && shuffleEnabled}
                onClick={handleArtistShuffle}
                disabled={isArtistLoading && topSongs.length === 0}
                className="pm-pressable relative flex h-12 w-12 items-center justify-center bg-transparent text-white/85 drop-shadow-[0_4px_14px_rgba(0,0,0,0.55)] transition-transform duration-150 hover:scale-110 hover:text-white active:scale-90 focus:outline-none disabled:opacity-40 sm:h-14 sm:w-14"
              >
                <Shuffle className="h-6 w-6 sm:h-7 sm:w-7" />
                {isPlayingThisArtist && shuffleEnabled && (
                  <span className="absolute bottom-1 h-1.5 w-1.5 rounded-full bg-white shadow" />
                )}
              </button>

              <button
                type="button"
                data-testid="artist-play-btn"
                aria-label={isPlayingThisArtist && isPlaying ? 'Pausar' : 'Reproducir'}
                onClick={handleArtistPlay}
                disabled={isArtistLoading && topSongs.length === 0}
                className="pm-pressable flex h-16 w-16 items-center justify-center overflow-visible bg-transparent text-white drop-shadow-[0_6px_22px_rgba(0,0,0,0.6)] transition-transform duration-150 hover:scale-105 active:scale-90 focus:outline-none disabled:opacity-40 sm:h-[72px] sm:w-[72px]"
              >
                {isPlayingThisArtist && isPlaying ? (
                  <RoundedPauseIcon className="h-[56px] w-[56px] sm:h-[66px] sm:w-[66px]" />
                ) : (
                  <RoundedPlayIcon className="h-[56px] w-[56px] translate-x-[2px] sm:h-[66px] sm:w-[66px]" />
                )}
              </button>
            </div>
          </div>
        </section>

        <div className="mt-6 space-y-6">
          {/* Popular Songs + Latest Release Feature Grid */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            <section className={`space-y-2 ${latestRelease || isArtistLoading ? 'lg:col-span-7' : 'lg:col-span-12'}`}>
              <div className="flex items-center justify-between">
                <h2 className="text-[20px] font-bold pm-text-primary">Populares</h2>
                {popularSongs.length > 5 && (
                  <button
                    type="button"
                    onClick={() => setShowAllPopular((v) => !v)}
                    className="pm-pressable inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold pm-text-secondary hover:bg-white/[0.08] hover:pm-text-primary"
                  >
                    <span>{showAllPopular ? 'Ver menos' : 'Ver más'}</span>
                    {showAllPopular ? (
                      <ChevronUp className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5" />
                    )}
                  </button>
                )}
              </div>
              {isArtistLoading && visiblePopularSongs.length === 0 ? (
                <div className="space-y-2 py-1" aria-label="Cargando canciones populares">
                  {[0, 1, 2, 3, 4].map((row) => (
                    <div
                      key={row}
                      className="flex items-center gap-3 rounded-[10px] bg-white/[0.03] px-2.5 py-2"
                    >
                      <div className="h-10 w-10 shrink-0 animate-pulse rounded-[7px] bg-white/[0.08]" />
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <div className="h-3.5 w-44 animate-pulse rounded bg-white/[0.09]" />
                        <div className="h-2.5 w-28 animate-pulse rounded bg-white/[0.06]" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="space-y-0.5">
                  {visiblePopularSongs.map((track, idx) => (
                    <TrackListRow
                      key={track.id}
                      track={track}
                      index={idx}
                      queueContext={topSongs}
                    />
                  ))}
                </div>
              )}
            </section>

            {isArtistLoading && !latestRelease ? (
              <section className="space-y-4 lg:col-span-5">
                <div className="space-y-2">
                  <h2 className="text-[20px] font-bold pm-text-primary">Último lanzamiento</h2>
                  <div className="pm-surface-card flex items-center gap-4 rounded-[18px] p-4">
                    <div className="h-24 w-24 shrink-0 animate-pulse rounded-[12px] bg-white/[0.08]" />
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="h-4 w-20 animate-pulse rounded-full bg-white/[0.08]" />
                      <div className="h-4 w-40 animate-pulse rounded bg-white/[0.09]" />
                      <div className="h-3 w-24 animate-pulse rounded bg-white/[0.06]" />
                    </div>
                  </div>
                </div>
              </section>
            ) : (
              (latestRelease || latestAppearance) && (
                <section className="space-y-4 lg:col-span-5">
                  {latestRelease && (
                    <div className="space-y-2">
                      <h2 className="text-[20px] font-bold pm-text-primary">Último lanzamiento</h2>
                      <button
                        type="button"
                        data-testid="artist-latest-release-card"
                        onClick={() =>
                          void openAlbumDetail(latestRelease.id, {
                            title: latestRelease.title,
                            artist: latestRelease.artists?.[0]?.name ?? artist.name,
                            thumbnailUrl: latestRelease.thumbnailUrl,
                          })
                        }
                        className="pm-surface-card pm-card-lift group flex w-full items-center gap-4 rounded-[18px] p-4 text-left"
                      >
                        <img
                          src={optimizeArtworkUrl(latestRelease.thumbnailUrl, 'card')}
                          alt={latestRelease.title}
                          loading="lazy"
                          decoding="async"
                          className="h-24 w-24 shrink-0 rounded-[12px] object-cover shadow-lg transition-transform duration-300 group-hover:scale-[1.04]"
                        />
                        <div className="min-w-0 flex-1 space-y-1">
                          {(() => {
                            const relDateLabel = formatSpanishReleaseDate(
                              latestRelease.releaseDate,
                              latestRelease.year
                            );
                            return (
                              <span className="inline-flex items-center gap-1 rounded-full border border-white/[0.08] bg-white/[0.08] px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider pm-text-secondary">
                                {latestRelease.releaseKind}
                                {relDateLabel ? ` · ${relDateLabel}` : ''}
                              </span>
                            );
                          })()}
                          <div className="line-clamp-2 text-base font-bold leading-snug pm-text-primary group-hover:underline">
                            {latestRelease.title}
                          </div>
                          <div className="truncate text-xs pm-text-tertiary">
                            {artist.name}
                          </div>
                        </div>
                      </button>
                    </div>
                  )}

                  {(latestAppearance || latestRelease) && (
                    <div className="space-y-2">
                      <h2 className="text-[20px] font-bold pm-text-primary">Última aparición</h2>
                      {latestAppearance && (isDistinctAppearance || !latestRelease) ? (
                        <button
                          type="button"
                          data-testid="artist-latest-appearance-card"
                          onClick={() =>
                            void playTrack(latestAppearance, [latestAppearance, ...topSongs])
                          }
                          className="pm-surface-card pm-card-lift group flex w-full items-center gap-4 rounded-[18px] p-4 text-left"
                        >
                          <img
                            src={optimizeArtworkUrl(latestAppearance.thumbnailUrl, 'card')}
                            alt={latestAppearance.title}
                            loading="lazy"
                            decoding="async"
                            className="h-24 w-24 shrink-0 rounded-[12px] object-cover shadow-lg transition-transform duration-300 group-hover:scale-[1.04]"
                          />
                          <div className="min-w-0 flex-1 space-y-1">
                            {(() => {
                              const appearanceDateLabel = formatSpanishReleaseDate(
                                latestAppearance.releaseDate ||
                                  resolvedAppearanceDates[latestAppearance.id],
                                latestAppearance.releaseYear
                              );
                              return (
                                <span className="inline-flex items-center gap-1 rounded-full border border-white/[0.08] bg-white/[0.08] px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider pm-text-secondary">
                                  <Clock className="h-3 w-3 shrink-0 opacity-80" />
                                  <span>{appearanceDateLabel || 'Sencillo'}</span>
                                </span>
                              );
                            })()}
                            <div className="line-clamp-2 text-base font-bold leading-snug pm-text-primary group-hover:underline">
                              {latestAppearance.title}
                            </div>
                            <div className="truncate text-xs pm-text-tertiary">
                              {latestAppearance.artists.map((a) => a.name).join(', ')}
                            </div>
                          </div>
                        </button>
                      ) : (
                        latestRelease && (
                          <button
                            type="button"
                            data-testid="artist-latest-appearance-card"
                            onClick={() =>
                              void openAlbumDetail(latestRelease.id, {
                                title: latestRelease.title,
                                artist: latestRelease.artists?.[0]?.name ?? artist.name,
                                thumbnailUrl: latestRelease.thumbnailUrl,
                              })
                            }
                            className="pm-surface-card pm-card-lift group flex w-full items-center gap-4 rounded-[18px] p-4 text-left"
                          >
                            <img
                              src={optimizeArtworkUrl(latestRelease.thumbnailUrl, 'card')}
                              alt={latestRelease.title}
                              loading="lazy"
                              decoding="async"
                              className="h-24 w-24 shrink-0 rounded-[12px] object-cover shadow-lg transition-transform duration-300 group-hover:scale-[1.04]"
                            />
                            <div className="min-w-0 flex-1 space-y-1">
                              {(() => {
                                const relDateLabel = formatSpanishReleaseDate(
                                  latestRelease.releaseDate,
                                  latestRelease.year
                                );
                                return (
                                  <span className="inline-flex items-center gap-1 rounded-full border border-white/[0.08] bg-white/[0.08] px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider pm-text-secondary">
                                    Último lanzamiento
                                    {relDateLabel ? ` · ${relDateLabel}` : ''}
                                  </span>
                                );
                              })()}
                              <div className="line-clamp-2 text-base font-bold leading-snug pm-text-primary group-hover:underline">
                                {latestRelease.title}
                              </div>
                              <div className="truncate text-xs pm-text-tertiary">
                                {artist.name}
                              </div>
                            </div>
                          </button>
                        )
                      )}
                    </div>
                  )}
                </section>
              )
            )}
          </div>

          {/* Discography Section with Interactive All / Albums / Singles Filter Pills, Desktop Scroll Arrows & Full Grid View */}
          {allReleases.length > 0 && (
            <section className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-[20px] font-bold tracking-tight pm-text-primary md:text-[22px]">
                  Discografía
                </h2>
                <div className="flex flex-wrap items-center gap-1.5">
                  <div className="flex items-center gap-1.5" role="tablist" aria-label="Filtrar discografía">
                    {(
                      [
                        { id: 'all', label: 'Todo', count: allReleases.length },
                        { id: 'albums', label: 'Álbumes', count: albums.length },
                        { id: 'singles', label: 'Sencillos y EP', count: dedupedSingles.length },
                      ] as const
                    )
                      .filter((tab) => tab.id === 'all' || tab.count > 0)
                      .map((tab) => (
                        <button
                          key={tab.id}
                          type="button"
                          role="tab"
                          aria-selected={artistDiscoTab === tab.id}
                          onClick={() => setArtistDiscoTab(tab.id)}
                          className={`pm-pressable rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                            artistDiscoTab === tab.id
                              ? 'pm-btn-primary'
                              : 'pm-btn-secondary'
                          }`}
                        >
                          {tab.label}
                        </button>
                      ))}
                  </div>
                  {filteredDiscography.length > 3 && (
                    <button
                      type="button"
                      data-testid="artist-disco-expand-btn"
                      onClick={() => setArtistDiscoExpanded((prev) => !prev)}
                      className={`pm-pressable rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                        artistDiscoExpanded ? 'pm-btn-primary' : 'pm-btn-secondary'
                      }`}
                    >
                      {artistDiscoExpanded ? 'Carrusel' : 'Ver todo'}
                    </button>
                  )}
                  {!artistDiscoExpanded && (
                    <div className="hidden items-center gap-1 md:flex">
                      <button
                        type="button"
                        data-testid="artist-disco-scroll-left"
                        aria-label="Desplazar discografía a la izquierda"
                        onClick={() => {
                          const el = artistDiscoRailRef.current;
                          if (!el) return;
                          const step = Math.max(360, Math.round(el.clientWidth * 0.75));
                          el.scrollBy({ left: -step, behavior: 'smooth' });
                        }}
                        className="pm-btn-secondary inline-flex h-8 w-8 items-center justify-center rounded-full"
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        data-testid="artist-disco-scroll-right"
                        aria-label="Desplazar discografía a la derecha"
                        onClick={() => {
                          const el = artistDiscoRailRef.current;
                          if (!el) return;
                          const step = Math.max(360, Math.round(el.clientWidth * 0.75));
                          el.scrollBy({ left: step, behavior: 'smooth' });
                        }}
                        className="pm-btn-secondary inline-flex h-8 w-8 items-center justify-center rounded-full"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {artistDiscoExpanded ? (
                <div
                  data-testid="artist-disco-full-grid"
                  className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 sm:gap-4"
                >
                  {filteredDiscography.map((al) => (
                    <CoverCard
                      key={`${al.releaseKind}-${al.id}`}
                      image={al.thumbnailUrl}
                      title={al.title}
                      subtitle={
                        al.year ? `${al.year} · ${al.releaseKind}` : al.releaseKind
                      }
                      badge={al.releaseKind}
                      fullWidth
                      onOpen={() =>
                        void openAlbumDetail(al.id, {
                          title: al.title,
                          artist: al.artists?.[0]?.name ?? artist.name,
                          thumbnailUrl: al.thumbnailUrl,
                        })
                      }
                    />
                  ))}
                </div>
              ) : (
                <div
                  ref={artistDiscoRailRef}
                  onWheel={(e) => {
                    if (!e.shiftKey) return;
                    const el = artistDiscoRailRef.current;
                    if (!el || Math.abs(e.deltaY) === 0) return;
                    e.preventDefault();
                    el.scrollLeft += e.deltaY;
                  }}
                  className="pm-no-scrollbar -mx-4 flex snap-x scroll-pl-4 gap-3.5 overflow-x-auto px-4 py-1.5 sm:mx-0 sm:scroll-pl-1 sm:gap-4 sm:px-1 sm:py-2"
                >
                  {filteredDiscography.map((al) => (
                    <CoverCard
                      key={`${al.releaseKind}-${al.id}`}
                      image={al.thumbnailUrl}
                      title={al.title}
                      subtitle={
                        al.year ? `${al.year} · ${al.releaseKind}` : al.releaseKind
                      }
                      badge={al.releaseKind}
                      onOpen={() =>
                        void openAlbumDetail(al.id, {
                          title: al.title,
                          artist: al.artists?.[0]?.name ?? artist.name,
                          thumbnailUrl: al.thumbnailUrl,
                        })
                      }
                    />
                  ))}
                </div>
              )}
            </section>
          )}

          {relatedArtists && relatedArtists.length > 0 && (
            <CarouselSection title="Artistas similares">
              {relatedArtists.map((rel) => (
                <CoverCard
                  key={rel.id}
                  image={rel.thumbnailUrl}
                  title={rel.name}
                  subtitle={rel.subscribersText ?? 'Artista'}
                  round
                  onOpen={() =>
                    void openArtistDetail(rel.id, {
                      name: rel.name,
                      thumbnailUrl: rel.thumbnailUrl,
                    })
                  }
                />
              ))}
            </CarouselSection>
          )}

          {hasBioText && (
            <section className="space-y-2.5 pb-4">
              <h2 className="text-[20px] font-bold pm-text-primary">Información</h2>
              <div className="pm-surface-card relative overflow-hidden rounded-[20px] p-5 sm:p-6">
                <p className="relative z-10 max-w-3xl text-sm leading-relaxed pm-text-secondary">
                  {description}
                </p>
              </div>
            </section>
          )}
        </div>
      </div>
    );
  }

  if (activeDetailView.kind === 'album') {
    const isAlbumLoading = Boolean(activeDetailView.isLoading);
    const { album, tracks } = activeDetailView.data;
    const isPlayingAlbum = Boolean(
      isPlaying && currentTrack && tracks.some((t) => t.id === currentTrack.id)
    );
    const albumDurText = formatPlaylistDuration(
      tracks.reduce((acc, t) => acc + (t.durationSec || 0), 0)
    );
    const releaseTypeLabel =
      !isAlbumLoading && tracks.length > 0 && tracks.length <= 2
        ? 'SINGLE'
        : !isAlbumLoading && tracks.length >= 3 && tracks.length <= 6
          ? 'EP'
          : 'ÁLBUM';
    const albumHeroCover =
      album.thumbnailUrl || tracks[0]?.thumbnailHighUrl || tracks[0]?.thumbnailUrl || '';
    const isDownloadingAlbum = playlistDownloadProgress?.playlistId === album.id;
    const allAlbumDownloaded =
      tracks.length > 0 && tracks.every((t) => offlineDownloads[t.id] === 'downloaded');

    return (
      <div className="pm-page-enter space-y-6">
        <section
          data-surface="content"
          data-testid="album-hero-banner"
          className="relative -mx-4 flex min-h-[260px] flex-col justify-end overflow-hidden bg-[var(--pm-bg-canvas)] px-4 pt-[calc(5rem+var(--pm-safe-top,env(safe-area-inset-top)))] pb-5 sm:-mx-7 sm:min-h-[330px] sm:px-7 sm:pt-10 sm:pb-7"
        >
          {albumHeroCover && (
            <img
              src={albumHeroCover}
              alt=""
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 h-full w-full scale-110 object-cover blur-2xl brightness-75 saturate-125"
            />
          )}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                'linear-gradient(180deg, color-mix(in srgb, var(--pm-bg-canvas) 22%, transparent) 0%, color-mix(in srgb, var(--pm-bg-canvas) 54%, transparent) 55%, var(--pm-bg-canvas) 100%)',
            }}
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                'linear-gradient(90deg, color-mix(in srgb, var(--pm-bg-canvas) 55%, transparent) 0%, transparent 60%)',
            }}
          />

          <div className="relative z-10 flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
            <div className="flex min-w-0 flex-1 flex-row items-center gap-3.5 sm:items-end sm:gap-6">
              {albumHeroCover ? (
                <div className="h-[104px] w-[104px] shrink-0 overflow-hidden rounded-[14px] shadow-[0_22px_50px_rgba(0,0,0,0.62)] ring-1 ring-white/15 sm:h-40 sm:w-40 sm:rounded-[16px]">
                  <TrackArtwork
                    trackId={tracks[0]?.id}
                    src={albumHeroCover}
                    title={album.title}
                    artistName={album.artists[0]?.name}
                    artistId={album.artists[0]?.id}
                    alt={album.title}
                    variant="card"
                    imgClassName="h-full w-full object-cover"
                  />
                </div>
              ) : (
                <div className="h-[104px] w-[104px] shrink-0 animate-pulse rounded-[14px] bg-white/[0.08] sm:h-40 sm:w-40 sm:rounded-[16px]" />
              )}

              <div className="min-w-0 flex-1 space-y-1 sm:space-y-1.5">
                <div className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-white/65">
                  {releaseTypeLabel}
                  {album.year ? ` · ${album.year}` : ''}
                </div>
                <h1 className="line-clamp-2 text-[27px] font-black leading-[1.06] tracking-tight text-white drop-shadow-[0_4px_20px_rgba(0,0,0,0.65)] sm:text-4xl md:text-5xl">
                  {album.title}
                </h1>
                <div className="text-xs font-semibold text-white/85 sm:text-sm">
                  <ArtistLinks
                    artists={album.artists}
                    singleLine={false}
                    linkClassName="hover:underline hover:text-white"
                  />
                </div>
                <div className="tabular-nums flex flex-wrap items-center gap-x-2.5 gap-y-0.5 pt-0.5 text-[12px] font-medium text-white/70 sm:text-[13px]">
                  <span className="inline-flex items-center gap-1.5">
                    <Music2 className="h-3.5 w-3.5 opacity-70" />
                    <span>
                      {isAlbumLoading && tracks.length === 0
                        ? 'Cargando…'
                        : `${tracks.length} ${tracks.length === 1 ? 'pista' : 'pistas'}`}
                    </span>
                  </span>
                  {albumDurText && (
                    <>
                      <span aria-hidden="true" className="opacity-35">•</span>
                      <span className="inline-flex items-center gap-1.5">
                        <Clock className="h-3.5 w-3.5 opacity-70" />
                        <span>{albumDurText}</span>
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>

            <div className="relative flex shrink-0 flex-wrap items-center justify-end gap-2 self-end sm:gap-3 md:pb-0.5">
              <HeroIconAction
                label="Aleatorio"
                tooltip="Reproducir en aleatorio"
                pressed={isPlayingAlbum && shuffleEnabled}
                activeDot={isPlayingAlbum && shuffleEnabled}
                activeDotClass="bg-white"
                disabled={isAlbumLoading && tracks.length === 0}
                onClick={() => {
                  if (tracks[0]) {
                    void playCollection(tracks, { forceShuffle: true });
                  }
                }}
                className="text-white/85 drop-shadow-[0_3px_12px_rgba(0,0,0,0.6)] hover:text-white"
              >
                <Shuffle className="h-6 w-6 sm:h-7 sm:w-7" />
              </HeroIconAction>

              <HeroIconAction
                label={
                  isDownloadingAlbum
                    ? `Descargando ${playlistDownloadProgress.completed} de ${playlistDownloadProgress.total}`
                    : allAlbumDownloaded
                      ? 'Descargado offline'
                      : 'Descargar álbum offline'
                }
                tooltip={
                  isDownloadingAlbum
                    ? `Descargando ${playlistDownloadProgress.completed}/${playlistDownloadProgress.total}`
                    : allAlbumDownloaded
                      ? 'Descargado offline'
                      : 'Descargar álbum para escuchar sin conexión'
                }
                disabled={tracks.length === 0}
                badge={
                  isDownloadingAlbum
                    ? `${playlistDownloadProgress.completed}/${playlistDownloadProgress.total}`
                    : null
                }
                onClick={() => {
                  if (isDownloadingAlbum) cancelPlaylistDownload();
                  else void downloadPlaylistOffline(album.id, tracks, album.title);
                }}
                className="text-white/85 drop-shadow-[0_3px_12px_rgba(0,0,0,0.6)] hover:text-white"
              >
                {isDownloadingAlbum ? (
                  <Loader2 className="h-6 w-6 animate-spin text-emerald-300 sm:h-7 sm:w-7" />
                ) : allAlbumDownloaded ? (
                  <Check
                    strokeWidth={2.5}
                    className="h-6 w-6 text-emerald-400 drop-shadow-[0_0_10px_rgba(52,211,153,0.6)] sm:h-7 sm:w-7"
                  />
                ) : (
                  <Download className="h-6 w-6 sm:h-7 sm:w-7" />
                )}
              </HeroIconAction>

              <div className="relative">
                <HeroIconAction
                  dataTestId="album-more-options-btn"
                  label="Más opciones de álbum"
                  tooltip="Más opciones (Sesión DJ)"
                  disabled={isAlbumLoading && tracks.length === 0}
                  onClick={() =>
                    setHeroMoreMenuId((cur) => (cur === `album:${album.id}` ? null : `album:${album.id}`))
                  }
                  className="text-white/85 drop-shadow-[0_3px_12px_rgba(0,0,0,0.6)] hover:text-white"
                >
                  <MoreHorizontal className="h-6 w-6 sm:h-7 sm:w-7" />
                </HeroIconAction>

                {heroMoreMenuId === `album:${album.id}` && (
                  <div
                    role="menu"
                    className="pm-menu-glass pm-modal-pop absolute right-0 top-14 z-40 w-60 space-y-0.5 rounded-[14px] p-1.5"
                  >
                    <button
                      type="button"
                      role="menuitem"
                      data-testid="hero-menu-dj-btn"
                      onClick={async () => {
                        setHeroMoreMenuId(null);
                        await toggleDjMode(true);
                        if (tracks[0]) await playTrack(tracks[0], tracks);
                      }}
                      className="pm-hover flex w-full items-center gap-2.5 rounded-[10px] px-3 py-2 text-left text-xs font-medium text-white"
                    >
                      <Disc3 className="h-4 w-4 text-purple-300" />
                      <span>Iniciar Sesión DJ AutoMix</span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setHeroMoreMenuId(null);
                        if (tracks.length > 0) void playCollection(tracks, { isPlaylist: true, forceShuffle: true });
                      }}
                      className="pm-hover flex w-full items-center gap-2.5 rounded-[10px] px-3 py-2 text-left text-xs font-medium text-white"
                    >
                      <Shuffle className="h-4 w-4 text-white/75" />
                      <span>Reproducir en aleatorio</span>
                    </button>
                  </div>
                )}
              </div>

              <button
                type="button"
                aria-label={isPlayingAlbum ? 'Pausar álbum' : 'Reproducir álbum'}
                title={isPlayingAlbum ? 'Pausar' : 'Reproducir'}
                disabled={isAlbumLoading && tracks.length === 0}
                onClick={() => {
                  if (isPlayingAlbum) {
                    void togglePlayPause();
                  } else if (tracks[0]) {
                    void playCollection(tracks);
                  }
                }}
                className="pm-pressable ml-1 flex h-[72px] w-[72px] items-center justify-center overflow-visible border-0 bg-transparent text-white drop-shadow-[0_6px_22px_rgba(0,0,0,0.65)] transition-transform duration-150 hover:scale-105 active:scale-90 focus:outline-none disabled:opacity-40 sm:h-[86px] sm:w-[86px]"
              >
                {isPlayingAlbum ? (
                  <RoundedPauseIcon className="h-[64px] w-[64px] sm:h-[78px] sm:w-[78px]" />
                ) : (
                  <RoundedPlayIcon className="h-[64px] w-[64px] translate-x-[2px] sm:h-[78px] sm:w-[78px]" />
                )}
              </button>
            </div>
          </div>
        </section>

        {isAlbumLoading && tracks.length === 0 ? (
          <div className="space-y-2">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                className="flex items-center gap-3 rounded-[10px] bg-white/[0.03] px-3 py-2.5"
              >
                <div className="h-9 w-9 shrink-0 animate-pulse rounded-[7px] bg-white/[0.08]" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3.5 w-48 animate-pulse rounded bg-white/[0.09]" />
                  <div className="h-2.5 w-28 animate-pulse rounded bg-white/[0.06]" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-0.5">
            {tracks.map((t, idx) => (
              <TrackListRow
                key={t.id}
                track={t}
                index={idx}
                queueContext={[t]}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  if (activeDetailView.kind === 'playlist') {
    const { playlist, tracks } = activeDetailView.data;
    const totalDurText = formatPlaylistDuration(
      tracks.reduce((acc, t) => acc + (t.durationSec || 0), 0)
    );
    const edCover =
      playlist.thumbnailUrl || generatePlaylistCoverDataUrl(playlist.title, 0);
    const isDownloadingThis = playlistDownloadProgress?.playlistId === playlist.id;
    const allDownloaded =
      tracks.length > 0 && tracks.every((t) => offlineDownloads[t.id] === 'downloaded');
    return (
      <div className="pm-page-enter space-y-6">
        <section
          data-surface="content"
          data-testid="playlist-hero-banner"
          className="relative -mx-4 flex min-h-[290px] flex-col justify-end overflow-hidden bg-[var(--pm-bg-canvas)] px-5 pt-[calc(5rem+var(--pm-safe-top,env(safe-area-inset-top)))] pb-6 sm:-mx-7 sm:min-h-[330px] sm:px-7 sm:pt-10 sm:pb-7"
        >
          <img
            src={edCover}
            alt=""
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 h-full w-full scale-110 object-cover blur-2xl brightness-75 saturate-125"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                'linear-gradient(180deg, color-mix(in srgb, var(--pm-bg-canvas) 22%, transparent) 0%, color-mix(in srgb, var(--pm-bg-canvas) 55%, transparent) 55%, var(--pm-bg-canvas) 100%)',
            }}
          />
          <div className="relative z-10 flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
            <div className="flex min-w-0 flex-1 flex-row items-center gap-3.5 sm:items-end sm:gap-6">
              <img
                src={edCover}
                alt={playlist.title}
                className="h-[104px] w-[104px] shrink-0 rounded-[14px] object-cover shadow-[0_22px_50px_rgba(0,0,0,0.6)] ring-1 ring-white/15 sm:h-40 sm:w-40 sm:rounded-[16px]"
              />
              <div className="min-w-0 flex-1 space-y-1 sm:space-y-1.5">
                <div className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-white/65">
                  PLAYLIST pMUSIC
                </div>
                <h1 className="line-clamp-2 text-[27px] font-black leading-[1.06] tracking-tight text-white drop-shadow-[0_4px_20px_rgba(0,0,0,0.6)] sm:text-4xl md:text-5xl">
                  {playlist.title}
                </h1>
                {playlist.author && (
                  <p className="text-xs font-medium text-white/75 sm:text-sm">
                    {playlist.author}
                  </p>
                )}
                <div className="tabular-nums flex flex-wrap items-center gap-x-2.5 gap-y-0.5 pt-0.5 text-[12px] font-medium text-white/70 sm:text-[13px]">
                  <span className="inline-flex items-center gap-1.5">
                    <Music2 className="h-3.5 w-3.5 opacity-70" />
                    <span>{tracks.length} {tracks.length === 1 ? 'pista' : 'pistas'}</span>
                  </span>
                  {totalDurText && (
                    <>
                      <span aria-hidden="true" className="opacity-35">•</span>
                      <span className="inline-flex items-center gap-1.5">
                        <Clock className="h-3.5 w-3.5 opacity-70" />
                        <span>{totalDurText}</span>
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>

            <div className="relative flex shrink-0 flex-wrap items-center justify-end gap-2 self-end sm:gap-3 md:pb-0.5">
              <HeroIconAction
                label={
                  isDownloadingThis
                    ? `Descargando ${playlistDownloadProgress.completed} de ${playlistDownloadProgress.total}`
                    : allDownloaded
                      ? 'Descargada offline'
                      : 'Descargar offline'
                }
                tooltip={
                  isDownloadingThis
                    ? `Descargando ${playlistDownloadProgress.completed}/${playlistDownloadProgress.total}`
                    : allDownloaded
                      ? 'Descargada offline'
                      : 'Descargar para escuchar sin conexión'
                }
                disabled={tracks.length === 0}
                badge={
                  isDownloadingThis
                    ? `${playlistDownloadProgress.completed}/${playlistDownloadProgress.total}`
                    : null
                }
                onClick={() => {
                  if (isDownloadingThis) cancelPlaylistDownload();
                  else void downloadPlaylistOffline(playlist.id, tracks, playlist.title);
                }}
                className="text-white/85 drop-shadow-[0_3px_12px_rgba(0,0,0,0.6)] hover:text-white"
              >
                {isDownloadingThis ? (
                  <Loader2 className="h-6 w-6 animate-spin text-emerald-300 sm:h-7 sm:w-7" />
                ) : allDownloaded ? (
                  <Check
                    strokeWidth={2.5}
                    className="h-6 w-6 text-emerald-400 drop-shadow-[0_0_10px_rgba(52,211,153,0.6)] sm:h-7 sm:w-7"
                  />
                ) : (
                  <Download className="h-6 w-6 sm:h-7 sm:w-7" />
                )}
              </HeroIconAction>

              <div className="relative">
                <HeroIconAction
                  dataTestId="editorial-more-options-btn"
                  label="Más opciones de playlist"
                  tooltip="Más opciones (Sesión DJ)"
                  onClick={() =>
                    setHeroMoreMenuId((cur) =>
                      cur === `ed:${playlist.id}` ? null : `ed:${playlist.id}`
                    )
                  }
                  className="text-white/85 drop-shadow-[0_3px_12px_rgba(0,0,0,0.6)] hover:text-white"
                >
                  <MoreHorizontal className="h-6 w-6 sm:h-7 sm:w-7" />
                </HeroIconAction>

                {heroMoreMenuId === `ed:${playlist.id}` && (
                  <div
                    role="menu"
                    className="pm-menu-glass pm-modal-pop absolute right-0 top-14 z-40 w-60 space-y-0.5 rounded-[14px] p-1.5"
                  >
                    <button
                      type="button"
                      role="menuitem"
                      data-testid="hero-menu-dj-btn"
                      onClick={async () => {
                        setHeroMoreMenuId(null);
                        await toggleDjMode(true);
                        if (tracks.length > 0) await playCollection(tracks, { isPlaylist: true });
                      }}
                      className="pm-hover flex w-full items-center gap-2.5 rounded-[10px] px-3 py-2 text-left text-xs font-medium text-white"
                    >
                      <Disc3 className="h-4 w-4 text-purple-300" />
                      <span>Iniciar Sesión DJ AutoMix</span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setHeroMoreMenuId(null);
                        if (tracks.length > 0) void playCollection(tracks, { isPlaylist: true, forceShuffle: true });
                      }}
                      className="pm-hover flex w-full items-center gap-2.5 rounded-[10px] px-3 py-2 text-left text-xs font-medium text-white"
                    >
                      <Shuffle className="h-4 w-4 text-white/75" />
                      <span>Reproducir en aleatorio</span>
                    </button>
                  </div>
                )}
              </div>

              <button
                type="button"
                aria-label={
                  isPlaying && currentTrack && tracks.some((t) => t.id === currentTrack.id)
                    ? 'Pausar'
                    : 'Reproducir'
                }
                title={
                  isPlaying && currentTrack && tracks.some((t) => t.id === currentTrack.id)
                    ? 'Pausar'
                    : shuffleEnabled || alwaysShuffle
                      ? 'Reproducir en aleatorio'
                      : 'Reproducir'
                }
                onClick={() => {
                  if (isPlaying && currentTrack && tracks.some((t) => t.id === currentTrack.id)) {
                    void togglePlayPause();
                  } else if (tracks.length > 0) {
                    void playCollection(tracks, { isPlaylist: true });
                  }
                }}
                className="pm-pressable ml-1 flex h-[72px] w-[72px] items-center justify-center overflow-visible border-0 bg-transparent text-white drop-shadow-[0_6px_22px_rgba(0,0,0,0.65)] transition-transform duration-150 hover:scale-105 active:scale-90 focus:outline-none disabled:opacity-40 sm:h-[86px] sm:w-[86px]"
              >
                {isPlaying && currentTrack && tracks.some((t) => t.id === currentTrack.id) ? (
                  <RoundedPauseIcon className="h-[64px] w-[64px] sm:h-[78px] sm:w-[78px]" />
                ) : (
                  <RoundedPlayIcon className="h-[64px] w-[64px] translate-x-[2px] sm:h-[78px] sm:w-[78px]" />
                )}
              </button>
            </div>
          </div>
        </section>

        <div className="space-y-0.5">
          {tracks.map((t, idx) => (
            <TrackListRow
              key={t.id}
              track={t}
              index={idx}
              queueContext={tracks}
            />
          ))}
        </div>
      </div>
    );
  }

  const renderInviteCollaboratorsModal = (opts: {
    targetId: string;
    playlistName: string;
    shareCode?: string | null;
    memberIds: string[];
  }) => {
    if (!collabModalOpen) return null;
    const shareUrl = opts.shareCode ? buildPlaylistShareUrl(opts.shareCode) : '';
    const acceptedFriends = friends.filter((f) => f.status === 'accepted');
    const sb = getSyncSupabaseClient();
    return (
      <div className="fixed inset-0 z-[72] flex items-center justify-center p-4">
        <div
          aria-hidden="true"
          onClick={() => setCollabModalOpen(false)}
          className="pm-spotlight-backdrop absolute inset-0 bg-black/70 backdrop-blur-sm"
        />
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Invitar colaboradores"
          data-testid="invite-collaborators-modal"
          className="pm-glass-frosted-neutral pm-hud-dark pm-modal-pop relative z-10 w-full max-w-md space-y-4 rounded-[24px] border border-white/15 p-5 shadow-2xl"
        >
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="text-base font-extrabold text-white">Invitar a «{opts.playlistName}»</h3>
              <p className="text-[11px] text-white/70">
                Cada amigo añadido verá la lista al instante en su Biblioteca
              </p>
            </div>
            <button
              type="button"
              aria-label="Cerrar modal de colaboradores"
              onClick={() => setCollabModalOpen(false)}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white/80 hover:bg-white/20"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {shareUrl && (
            <div className="space-y-1.5 rounded-2xl border border-white/12 bg-white/[0.04] p-3">
              <div className="text-[10.5px] font-bold uppercase tracking-wider text-white/60">
                Enlace colaborativo
              </div>
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1 truncate rounded-xl bg-black/35 px-3 py-2 font-mono text-[11px] text-white/85">
                  {shareUrl}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard?.writeText(shareUrl);
                    showToast('Enlace colaborativo copiado');
                  }}
                  className="shrink-0 rounded-full bg-white px-3.5 py-2 text-[11px] font-bold text-[#070709]"
                >
                  Copiar link
                </button>
              </div>
            </div>
          )}

          {/* Search any @usuario */}
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!sb || !collabUserQuery.trim()) return;
              setSearchingCollabUsers(true);
              try {
                const hits = await searchProfilesByUsername(sb, collabUserQuery, authState.userId);
                setCollabUserHits(hits);
              } finally {
                setSearchingCollabUsers(false);
              }
            }}
            className="flex gap-2"
          >
            <input
              type="text"
              value={collabUserQuery}
              onChange={(e) => setCollabUserQuery(e.target.value)}
              placeholder="Buscar usuario por @apodo o nombre..."
              className="min-w-0 flex-1 rounded-full border border-white/15 bg-white/[0.06] px-4 py-2 text-xs text-white placeholder:text-white/45 focus:outline-none"
            />
            <button
              type="submit"
              disabled={searchingCollabUsers}
              className="rounded-full bg-white px-4 py-2 text-xs font-bold text-[#070709]"
            >
              {searchingCollabUsers ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Buscar'}
            </button>
          </form>

          {collabUserHits.length > 0 && (
            <div className="max-h-36 space-y-1.5 overflow-y-auto rounded-2xl border border-white/10 bg-black/30 p-2">
              {collabUserHits.map((u) => {
                const isMember = opts.memberIds.includes(u.userId);
                return (
                  <div key={u.userId} className="flex items-center justify-between gap-2 px-1.5 py-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <UserAvatar src={u.avatarUrl} name={u.displayName} size="sm" />
                      <div className="min-w-0">
                        <div className="truncate text-xs font-bold text-white">{u.displayName}</div>
                        <div className="truncate text-[10.5px] text-white/65">@{u.username}</div>
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={isMember}
                      onClick={() => void inviteFriendToPlaylist(opts.targetId, u.userId)}
                      className={`rounded-full px-3 py-1 text-[11px] font-bold ${
                        isMember
                          ? 'bg-emerald-500/20 text-emerald-300'
                          : 'bg-white text-[#070709]'
                      }`}
                    >
                      {isMember ? 'Miembro' : 'Añadir'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Accepted Friends Quick List */}
          <div className="space-y-1.5">
            <div className="text-[10.5px] font-bold uppercase tracking-wider text-white/60">
              Tus amigos ({acceptedFriends.length})
            </div>
            {acceptedFriends.length === 0 ? (
              <p className="rounded-xl bg-white/[0.03] px-3 py-3 text-center text-[11px] text-white/60">
                Añade amigos en la pestaña Social o busca arriba por @usuario.
              </p>
            ) : (
              <div className="max-h-44 space-y-1.5 overflow-y-auto">
                {acceptedFriends.map((f) => {
                  const isMember = opts.memberIds.includes(f.otherProfile.userId);
                  return (
                    <div
                      key={f.id}
                      className="flex items-center justify-between gap-2 rounded-xl bg-white/[0.04] px-3 py-2"
                    >
                      <div className="flex min-w-0 items-center gap-2.5">
                        <UserAvatar
                          src={f.otherProfile.avatarUrl}
                          name={f.otherProfile.displayName}
                          size="sm"
                        />
                        <div className="min-w-0">
                          <div className="truncate text-xs font-bold text-white">
                            {f.otherProfile.displayName}
                          </div>
                          <div className="truncate text-[10.5px] text-white/65">
                            @{f.otherProfile.username}
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={isMember}
                        onClick={() =>
                          void inviteFriendToPlaylist(opts.targetId, f.otherProfile.userId)
                        }
                        className={`shrink-0 rounded-full px-3 py-1 text-[11px] font-bold ${
                          isMember
                            ? 'bg-emerald-500/20 text-emerald-300'
                            : 'bg-white text-[#070709]'
                        }`}
                      >
                        {isMember ? 'Miembro' : 'Invitar'}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderPlaylistHeroCard = (opts: {
    kind: 'local' | 'shared';
    id: string;
    name: string;
    description: string;
    badgeLabel: string;
    badgeCollab?: boolean;
    tracks: Track[];
    coverUrl?: string | null;
    bannerUrl?: string | null;
    bannerEnabled: boolean;
    seed: number;
    actionsRow: React.ReactNode;
    titleContent: React.ReactNode;
  }) => {
    const firstTrackThumb = opts.tracks[0]?.thumbnailHighUrl ?? opts.tracks[0]?.thumbnailUrl ?? '';
    const resolvedCover =
      opts.coverUrl || firstTrackThumb || generatePlaylistCoverDataUrl(opts.name, opts.seed);
    const hasCustomBanner = Boolean(opts.bannerUrl);
    const resolvedBanner =
      opts.bannerUrl || firstTrackThumb || generatePlaylistBannerDataUrl(opts.name, opts.seed);
    const durText = formatPlaylistDuration(
      opts.tracks.reduce((acc, t) => acc + (t.durationSec || 0), 0)
    );
    const isBannerAutoFromCover = !hasCustomBanner && Boolean(firstTrackThumb);
    const cleanDesc = (opts.description ?? '').trim();
    const showDesc = Boolean(cleanDesc) && !/^creada en pmusic$/i.test(cleanDesc);

    const renderCoverButton = (sizeClass: string) => (
      <div className={`group relative ${sizeClass} shrink-0 overflow-hidden`}>
        <TrackArtwork
          trackId={opts.tracks[0]?.id}
          src={resolvedCover}
          title={opts.name}
          artistName={opts.tracks[0]?.artists[0]?.name}
          artistId={opts.tracks[0]?.artists[0]?.id}
          alt={opts.name}
          variant="card"
          imgClassName="h-full w-full object-cover"
        />
        <button
          type="button"
          aria-label="Personalizar portada y banner"
          onClick={() => openPlaylistAppearanceModal(opts.kind, opts.id)}
          className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/55 opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
        >
          <Palette className="h-5 w-5 text-white" />
          <span className="hidden text-[10px] font-bold text-white sm:inline">Personalizar</span>
        </button>
      </div>
    );

    const renderStatsRow = (mutedClass: string) => (
      <div
        className={`tabular-nums flex flex-wrap items-center gap-x-2.5 gap-y-0.5 pt-0.5 text-[12px] font-medium sm:text-[13px] ${mutedClass}`}
      >
        <span className="inline-flex items-center gap-1.5">
          <Music2 className="h-3.5 w-3.5 opacity-70" />
          <span>
            {opts.tracks.length} {opts.tracks.length === 1 ? 'pista' : 'pistas'}
          </span>
        </span>
        {durText && (
          <>
            <span aria-hidden="true" className="opacity-35">•</span>
            <span className="inline-flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 opacity-70" />
              <span>{durText}</span>
            </span>
          </>
        )}
      </div>
    );

    if (!opts.bannerEnabled) {
      return (
        <div
          data-surface="content"
          data-testid="playlist-classic-header"
          className="pm-surface-card relative rounded-[20px] p-4 sm:p-6"
        >
          <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
            <div className="flex min-w-0 flex-1 flex-row items-center gap-3.5 sm:items-end sm:gap-6">
              {renderCoverButton(
                'h-[104px] w-[104px] rounded-[14px] shadow-[0_18px_40px_rgba(0,0,0,0.45)] sm:h-40 sm:w-40 sm:rounded-[16px]'
              )}
              <div className="min-w-0 flex-1 space-y-1 sm:space-y-1.5">
                <div
                  className={`inline-flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-[0.14em] ${
                    opts.badgeCollab ? 'text-emerald-400' : 'pm-text-tertiary'
                  }`}
                >
                  {opts.badgeCollab && <Users className="h-3 w-3" />}
                  <span>{opts.badgeLabel}</span>
                </div>
                {opts.titleContent}
                {showDesc && <p className="truncate text-xs pm-text-secondary">{cleanDesc}</p>}
                {renderStatsRow('pm-text-secondary')}
              </div>
            </div>
            {opts.actionsRow}
          </div>
        </div>
      );
    }

    return (
      <section
        data-surface="content"
        data-testid="playlist-hero-banner"
        className="relative -mx-4 flex min-h-[260px] flex-col justify-end overflow-hidden bg-[var(--pm-bg-canvas)] px-4 pt-[calc(5rem+var(--pm-safe-top,env(safe-area-inset-top)))] pb-5 sm:-mx-7 sm:min-h-[340px] sm:px-7 sm:pt-10 sm:pb-7"
      >
        <img
          src={resolvedBanner}
          alt=""
          aria-hidden="true"
          className={`pointer-events-none absolute inset-0 h-full w-full object-cover ${
            isBannerAutoFromCover
              ? 'scale-110 object-center blur-2xl brightness-75 saturate-125'
              : 'scale-[1.02] object-[50%_25%] opacity-90'
          }`}
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'linear-gradient(180deg, color-mix(in srgb, var(--pm-bg-canvas) 20%, transparent) 0%, color-mix(in srgb, var(--pm-bg-canvas) 48%, transparent) 52%, color-mix(in srgb, var(--pm-bg-canvas) 88%, transparent) 84%, var(--pm-bg-canvas) 100%)',
          }}
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'linear-gradient(90deg, color-mix(in srgb, var(--pm-bg-canvas) 55%, transparent) 0%, transparent 60%)',
          }}
        />

        <div className="relative z-10 flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div className="flex min-w-0 flex-1 flex-row items-center gap-3.5 sm:items-end sm:gap-6">
            {renderCoverButton(
              'h-[104px] w-[104px] rounded-[14px] shadow-[0_22px_50px_rgba(0,0,0,0.62)] ring-1 ring-white/15 sm:h-40 sm:w-40 sm:rounded-[16px]'
            )}
            <div className="min-w-0 flex-1 space-y-1 sm:space-y-1.5">
              <div
                className={`inline-flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-[0.14em] ${
                  opts.badgeCollab ? 'text-emerald-300' : 'text-white/65'
                }`}
              >
                {opts.badgeCollab && <Users className="h-3 w-3" />}
                <span>{opts.badgeLabel}</span>
              </div>
              {opts.titleContent}
              {showDesc && (
                <p className="truncate text-xs font-medium text-white/75 sm:text-sm drop-shadow">
                  {cleanDesc}
                </p>
              )}
              {renderStatsRow('text-white/70')}
            </div>
          </div>

          {opts.actionsRow}
        </div>
      </section>
    );
  };

  if (activeDetailView.kind === 'shared_playlist') {
    const sharedPl = sharedPlaylists.find((p) => p.id === activeDetailView.sharedId);
    if (!sharedPl) return null;
    const spApp = playlistAppearances[sharedPl.id];
    const isAddOpen = addFinderOverride ?? false;
    const isDownloadingThis = playlistDownloadProgress?.playlistId === sharedPl.id;
    const allDownloaded =
      sharedPl.tracks.length > 0 &&
      sharedPl.tracks.every((t) => offlineDownloads[t.id] === 'downloaded');
    const suggestedSharedAdds = (
      addSearchQuery.trim() ? addSearchResults : searchResults.songs.slice(0, 8)
    ).filter((t) => !sharedPl.tracks.some((ex) => ex.id === t.id));

    return (
      <div className="pm-page-enter space-y-6">
        {renderPlaylistHeroCard({
          kind: 'shared',
          id: sharedPl.id,
          name: sharedPl.name,
          description:
            sharedPl.description || 'Playlist colaborativa · Cada canción muestra quién la añadió',
          badgeLabel: sharedPl.kind === 'blend' ? 'BLEND' : 'LISTA COLABORATIVA',
          badgeCollab: true,
          tracks: sharedPl.tracks,
          coverUrl: spApp?.coverUrl ?? sharedPl.coverUrl,
          bannerUrl: spApp?.bannerUrl ?? null,
          bannerEnabled: spApp?.bannerEnabled ?? true,
          seed: spApp?.coverStyleSeed ?? 0,
          titleContent: (
            <h1 className="line-clamp-2 text-[27px] font-black leading-[1.06] tracking-tight text-white drop-shadow-[0_4px_20px_rgba(0,0,0,0.65)] sm:text-4xl md:text-5xl">
              {sharedPl.name}
            </h1>
          ),
          actionsRow: (
            <div className="relative flex shrink-0 flex-wrap items-center justify-end gap-2 self-end sm:gap-3 md:pb-0.5">
              <HeroIconAction
                label={
                  isDownloadingThis
                    ? `Descargando ${playlistDownloadProgress.completed} de ${playlistDownloadProgress.total}`
                    : allDownloaded
                      ? 'Descargada offline'
                      : 'Descargar offline'
                }
                tooltip={
                  isDownloadingThis
                    ? `Descargando ${playlistDownloadProgress.completed}/${playlistDownloadProgress.total}`
                    : allDownloaded
                      ? 'Descargada offline'
                      : 'Descargar para escuchar sin conexión'
                }
                disabled={sharedPl.tracks.length === 0}
                badge={
                  isDownloadingThis
                    ? `${playlistDownloadProgress.completed}/${playlistDownloadProgress.total}`
                    : null
                }
                onClick={() => {
                  if (isDownloadingThis) cancelPlaylistDownload();
                  else void downloadPlaylistOffline(sharedPl.id, sharedPl.tracks, sharedPl.name);
                }}
                className="text-white/85 drop-shadow-[0_3px_12px_rgba(0,0,0,0.6)] hover:text-white"
              >
                {isDownloadingThis ? (
                  <Loader2 className="h-6 w-6 animate-spin text-emerald-300 sm:h-7 sm:w-7" />
                ) : allDownloaded ? (
                  <Check
                    strokeWidth={2.5}
                    className="h-6 w-6 text-emerald-400 drop-shadow-[0_0_10px_rgba(52,211,153,0.6)] sm:h-7 sm:w-7"
                  />
                ) : (
                  <Download className="h-6 w-6 sm:h-7 sm:w-7" />
                )}
              </HeroIconAction>

              <HeroIconAction
                label="Añadir canciones"
                tooltip={isAddOpen ? 'Ocultar buscador' : 'Añadir canciones'}
                pressed={isAddOpen}
                onClick={() => setAddFinderOverride(!isAddOpen)}
                className={`drop-shadow-[0_3px_12px_rgba(0,0,0,0.6)] ${
                  isAddOpen ? 'text-white' : 'text-white/85 hover:text-white'
                }`}
              >
                <Plus
                  strokeWidth={2.4}
                  className={`h-6 w-6 transition-transform duration-200 sm:h-7 sm:w-7 ${
                    isAddOpen ? 'rotate-45' : ''
                  }`}
                />
              </HeroIconAction>

              <HeroIconAction
                label="Invitar colaboradores"
                tooltip="Invitar / Compartir enlace"
                onClick={() => setCollabModalOpen(true)}
                className="text-emerald-300/90 drop-shadow-[0_3px_12px_rgba(0,0,0,0.6)] hover:text-emerald-200 hover:drop-shadow-[0_0_12px_rgba(52,211,153,0.65)]"
              >
                <UserPlus className="h-6 w-6 sm:h-7 sm:w-7" />
              </HeroIconAction>

              <span aria-hidden="true" className="mx-0.5 h-6 w-px bg-white/15" />

              <HeroIconAction
                dataTestId="playlist-more-actions-btn"
                label="Más acciones de playlist"
                tooltip="Más opciones"
                onClick={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  openPlaylistContextMenu('shared', sharedPl.id, Math.max(12, r.right - 250), r.bottom + 8);
                }}
                className="text-white/75 drop-shadow-[0_3px_12px_rgba(0,0,0,0.6)] hover:text-white"
              >
                <MoreHorizontal className="h-6 w-6 sm:h-7 sm:w-7" />
              </HeroIconAction>

              <button
                type="button"
                aria-label={
                  isPlaying &&
                  currentTrack &&
                  sharedPl.tracks.some((t) => t.id === currentTrack.id)
                    ? 'Pausar'
                    : 'Reproducir'
                }
                title={
                  isPlaying &&
                  currentTrack &&
                  sharedPl.tracks.some((t) => t.id === currentTrack.id)
                    ? 'Pausar'
                    : shuffleEnabled || alwaysShuffle
                      ? 'Reproducir en aleatorio'
                      : 'Reproducir'
                }
                onClick={() => {
                  if (
                    isPlaying &&
                    currentTrack &&
                    sharedPl.tracks.some((t) => t.id === currentTrack.id)
                  ) {
                    void togglePlayPause();
                  } else if (sharedPl.tracks.length > 0) {
                    void playCollection(sharedPl.tracks, { isPlaylist: true });
                  }
                }}
                className="pm-pressable ml-1 flex h-[72px] w-[72px] items-center justify-center overflow-visible border-0 bg-transparent text-white drop-shadow-[0_6px_22px_rgba(0,0,0,0.65)] transition-transform duration-150 hover:scale-105 active:scale-90 focus:outline-none sm:h-[86px] sm:w-[86px]"
              >
                {isPlaying &&
                currentTrack &&
                sharedPl.tracks.some((t) => t.id === currentTrack.id) ? (
                  <RoundedPauseIcon className="h-[64px] w-[64px] sm:h-[78px] sm:w-[78px]" />
                ) : (
                  <RoundedPlayIcon className="h-[64px] w-[64px] translate-x-[2px] sm:h-[78px] sm:w-[78px]" />
                )}
              </button>
            </div>
          ),
        })}

        {(() => {
          const sharedViewRows = filterAndSortPlaylistTracks(
            sharedPl.tracks,
            playlistFilterQuery,
            playlistSortMode
          );
          const sharedQueue = sharedViewRows.map((r) => r.track);
          return (
            <>
              {sharedPl.tracks.length > 0 && (
                <div className="mb-2 flex items-center gap-2 sm:justify-between">
                  <div className="relative min-w-0 flex-1 sm:max-w-[300px]">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 pm-text-tertiary" />
                    <input
                      type="text"
                      value={playlistFilterQuery}
                      onChange={(e) => setPlaylistFilterQuery(e.target.value)}
                      placeholder="Filtrar canciones..."
                      data-testid="playlist-filter-input"
                      className="pm-input w-full rounded-full py-1.5 pl-8 pr-7 text-xs"
                    />
                    {playlistFilterQuery && (
                      <button
                        type="button"
                        aria-label="Limpiar filtro"
                        onClick={() => setPlaylistFilterQuery('')}
                        className="absolute right-2 top-1/2 -translate-y-1/2 pm-text-tertiary hover:pm-text-primary"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                  <PlaylistSortControl mode={playlistSortMode} onChange={setPlaylistSortMode} />
                </div>
              )}

              <div className="space-y-0.5">
                {sharedPl.tracks.length === 0 ? (
                  <div className="pm-surface-card rounded-[14px] border-dashed p-8 text-center text-xs pm-text-secondary">
                    Esta lista colaborativa está vacía. Busca canciones abajo o invita a tus amigos.
                  </div>
                ) : sharedViewRows.length === 0 ? (
                  <div className="pm-surface-card rounded-[14px] p-6 text-center text-xs pm-text-secondary">
                    Ninguna canción coincide con «{playlistFilterQuery}»
                  </div>
                ) : (
                  sharedViewRows.map(({ track: t, originalIndex }) => (
                    <div key={`${t.id}-${originalIndex}`} className="group flex items-center gap-1">
                      <div className="min-w-0 flex-1">
                        <TrackListRow
                          track={t}
                          index={originalIndex}
                          queueContext={sharedQueue}
                        />
                      </div>
                      {(sharedPl.ownerId === authState.userId || t.addedBy?.userId === authState.userId) && (
                        <button
                          type="button"
                          aria-label={`Quitar ${t.title}`}
                          onClick={() => void removeTrackFromCollaborativePlaylist(sharedPl.id, t.id)}
                          className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-full pm-text-tertiary hover:bg-rose-500/15 hover:text-rose-400 group-hover:flex"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  ))
                )}
              </div>
            </>
          );
        })()}

        {isAddOpen && (
          <section data-surface="content" className="pm-surface-card space-y-4 rounded-[16px] p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-[17px] font-bold pm-text-primary">
                  Añadir canciones a «{sharedPl.name}»
                </h2>
                <p className="text-xs pm-text-tertiary">
                  Se guardarán en vivo para todos los colaboradores
                </p>
              </div>
            </div>
            <div className="pm-input flex items-center gap-2.5 rounded-full px-4 py-2">
              <Search className="h-4 w-4 pm-text-secondary" />
              <input
                type="search"
                aria-label="Buscar canciones para lista colaborativa"
                placeholder="Buscar canciones o artistas para añadir..."
                value={addSearchQuery}
                onChange={async (e) => {
                  const q = e.target.value;
                  setAddSearchQuery(q);
                  if (q.trim().length >= 2) {
                    setIsSearchingAdd(true);
                    const found = await searchTracksForPlaylist(q);
                    setAddSearchResults(found);
                    setIsSearchingAdd(false);
                  } else {
                    setAddSearchResults([]);
                  }
                }}
                className="flex-1 bg-transparent text-xs pm-text-primary placeholder:pm-text-tertiary focus:outline-none"
              />
              {isSearchingAdd && <Loader2 className="h-4 w-4 animate-spin pm-text-secondary" />}
            </div>
            <div className="space-y-1">
              {suggestedSharedAdds.slice(0, 6).map((t) => (
                <div
                  key={`add-sp-${t.id}`}
                  className="pm-hover flex items-center justify-between gap-3 rounded-[10px] px-2.5 py-2"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <img src={t.thumbnailUrl} alt="" className="h-10 w-10 shrink-0 rounded-[7px] object-cover" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13.5px] font-medium pm-text-primary">{t.title}</div>
                      <div className="truncate text-xs pm-text-tertiary">
                        {t.artists.map((a) => a.name).join(', ')}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void addTrackToCollaborativePlaylist(sharedPl.id, t)}
                    className="pm-btn-secondary inline-flex items-center gap-1 rounded-full px-3.5 py-1.5 text-xs font-semibold"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>Añadir</span>
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        {renderInviteCollaboratorsModal({
          targetId: sharedPl.id,
          playlistName: sharedPl.name,
          shareCode: sharedPl.shareCode,
          memberIds: sharedPl.memberIds,
        })}
      </div>
    );
  }

  const localPl = playlists.find((p) => p.id === activeDetailView.playlistId);
  if (!localPl) return null;

  const dismissedSet = new Set(dismissedPlaylistRecs[localPl.id] ?? []);
  const skippedSet = new Set(sessionSkippedIds);
  const plOwnedIds = new Set(localPl.tracks.map((t) => t.id));
  const plOwnedKeys = new Set(
    localPl.tracks.map(
      (t) => `${t.title.trim().toLowerCase()}::${(t.artists[0]?.name ?? '').trim().toLowerCase()}`
    )
  );
  const visibleRecs = recPool
    .filter((t) => {
      if (plOwnedIds.has(t.id) || dismissedSet.has(t.id) || skippedSet.has(t.id)) return false;
      const k = `${t.title.trim().toLowerCase()}::${(t.artists[0]?.name ?? '').trim().toLowerCase()}`;
      return !plOwnedKeys.has(k);
    })
    .slice(0, 6);

  const handleReloadPlaylistRecs = async () => {
    const shownIds = visibleRecs.map((t) => t.id);
    const nextSkipped = Array.from(new Set([...sessionSkippedIds, ...shownIds]));
    setSessionSkippedIds(nextSkipped);
    setIsLoadingRecs(true);
    const fresh = await fetchPlaylistRecommendations(localPl.id, {
      excludeIds: [...nextSkipped, ...recPool.map((t) => t.id)],
    });
    setRecPool(fresh);
    setIsLoadingRecs(false);
  };

  const handleAddRecommendedTrack = async (track: Track) => {
    setRecPool((prev) => prev.filter((item) => item.id !== track.id));
    await addTrackToPlaylist(localPl.id, track);
  };

  const handleDismissRecommendedTrack = async (track: Track) => {
    dismissPlaylistRecommendation(localPl.id, track.id);
    const remaining = recPool.filter((item) => item.id !== track.id);
    setRecPool(remaining);
    if (remaining.length < 8 && localPl.tracks.length >= 10) {
      const fresh = await fetchPlaylistRecommendations(localPl.id, {
        excludeIds: [...sessionSkippedIds, ...remaining.map((x) => x.id), track.id],
      });
      setRecPool((prev) => {
        const seen = new Set([...prev.map((x) => x.id), track.id]);
        return [...prev, ...fresh.filter((x) => !seen.has(x.id))];
      });
    }
  };

  const suggestedAdds = (
    addSearchQuery.trim() ? addSearchResults : searchResults.songs.slice(0, 8)
  ).filter((t) => !localPl.tracks.some((ex) => ex.id === t.id));

  const isAddFinderOpen = addFinderOverride ?? false;
  const localApp = playlistAppearances[localPl.id];
  const isDownloadingThis = playlistDownloadProgress?.playlistId === localPl.id;
  const allDownloaded =
    localPl.tracks.length > 0 &&
    localPl.tracks.every((t) => offlineDownloads[t.id] === 'downloaded');

  const linkedShared = localPl.shareCode
    ? sharedPlaylists.find(
        (s) => s.shareCode?.toUpperCase() === localPl.shareCode?.toUpperCase()
      ) ?? null
    : null;

  return (
    <div className="pm-page-enter space-y-6">
      {renderPlaylistHeroCard({
        kind: 'local',
        id: localPl.id,
        name: localPl.name,
        description: localPl.description ?? '',
        badgeLabel: localPl.isCollaborative ? 'COLABORATIVA' : 'TU PLAYLIST',
        badgeCollab: Boolean(localPl.isCollaborative),
        tracks: localPl.tracks,
        coverUrl: localApp?.coverUrl ?? localPl.coverUrl,
        bannerUrl: localApp?.bannerUrl ?? localPl.bannerUrl,
        bannerEnabled: localApp?.bannerEnabled ?? localPl.bannerEnabled ?? true,
        seed: localApp?.coverStyleSeed ?? localPl.coverStyleSeed ?? 0,
        titleContent: isEditingName ? (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (editingName.trim()) {
                await renamePlaylist(localPl.id, editingName.trim());
                showToast('Nombre actualizado');
              }
              setIsEditingName(false);
            }}
            className="flex flex-wrap items-center gap-2"
          >
            <input
              type="text"
              autoFocus
              aria-label="Nuevo nombre de playlist"
              value={editingName}
              onChange={(e) => setEditingName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setIsEditingName(false);
              }}
              className="pm-input rounded-full px-4 py-1.5 text-lg font-bold"
            />
            <button
              type="submit"
              className="pm-btn-primary rounded-full px-4 py-1.5 text-xs font-bold"
            >
              Guardar
            </button>
            <button
              type="button"
              onClick={() => setIsEditingName(false)}
              className="pm-btn-secondary rounded-full px-3.5 py-1.5 text-xs font-semibold"
            >
              Cancelar
            </button>
          </form>
        ) : (
          <div className="flex items-center gap-1.5">
            <h1
              onClick={() => {
                setEditingName(localPl.name);
                setIsEditingName(true);
              }}
              title="Pulsa para renombrar"
              className="line-clamp-2 cursor-pointer text-[27px] font-black leading-[1.06] tracking-tight pm-text-primary drop-shadow-[0_4px_18px_rgba(0,0,0,0.45)] hover:opacity-90 sm:text-4xl md:text-5xl"
            >
              {localPl.name}
            </h1>
            <button
              type="button"
              aria-label="Editar nombre de playlist"
              onClick={() => {
                setEditingName(localPl.name);
                setIsEditingName(true);
              }}
              className="pm-hover rounded-full p-1.5 pm-text-tertiary hover:text-[var(--pm-text-primary)]"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          </div>
        ),
        actionsRow: (
          <div className="relative flex shrink-0 flex-wrap items-center justify-end gap-2 self-end sm:gap-3 md:pb-0.5">
            <HeroIconAction
              label={
                isDownloadingThis
                  ? `Descargando ${playlistDownloadProgress.completed} de ${playlistDownloadProgress.total}`
                  : allDownloaded
                    ? 'Descargada offline'
                    : 'Descargar offline'
              }
              tooltip={
                isDownloadingThis
                  ? `Descargando ${playlistDownloadProgress.completed}/${playlistDownloadProgress.total}`
                  : allDownloaded
                    ? 'Descargada offline'
                    : 'Descargar para escuchar sin conexión'
              }
              disabled={localPl.tracks.length === 0}
              badge={
                isDownloadingThis
                  ? `${playlistDownloadProgress.completed}/${playlistDownloadProgress.total}`
                  : null
              }
              onClick={() => {
                if (isDownloadingThis) cancelPlaylistDownload();
                else void downloadPlaylistOffline(localPl.id, localPl.tracks, localPl.name);
              }}
              className="text-white/85 drop-shadow-[0_3px_12px_rgba(0,0,0,0.6)] hover:text-white"
            >
              {isDownloadingThis ? (
                <Loader2 className="h-6 w-6 animate-spin text-emerald-300 sm:h-7 sm:w-7" />
              ) : allDownloaded ? (
                <Check
                  strokeWidth={2.5}
                  className="h-6 w-6 text-emerald-400 drop-shadow-[0_0_10px_rgba(52,211,153,0.6)] sm:h-7 sm:w-7"
                />
              ) : (
                <Download className="h-6 w-6 sm:h-7 sm:w-7" />
              )}
            </HeroIconAction>

            <HeroIconAction
              dataTestId="playlist-add-songs-btn"
              label="Añadir canciones"
              tooltip={isAddFinderOpen ? 'Ocultar buscador' : 'Añadir canciones'}
              pressed={isAddFinderOpen}
              onClick={() => setAddFinderOverride(!isAddFinderOpen)}
              className={`drop-shadow-[0_3px_12px_rgba(0,0,0,0.6)] ${
                isAddFinderOpen ? 'text-white' : 'text-white/85 hover:text-white'
              }`}
            >
              <Plus
                strokeWidth={2.4}
                className={`h-6 w-6 transition-transform duration-200 sm:h-7 sm:w-7 ${
                  isAddFinderOpen ? 'rotate-45' : ''
                }`}
              />
            </HeroIconAction>

            {localPl.isCollaborative && (
              <HeroIconAction
                label="Colaborativa · Invitar"
                tooltip="Invitar colaboradores"
                onClick={() => setCollabModalOpen(true)}
                className="text-emerald-300/90 drop-shadow-[0_3px_12px_rgba(0,0,0,0.6)] hover:text-emerald-200 hover:drop-shadow-[0_0_12px_rgba(52,211,153,0.65)]"
              >
                <Users className="h-6 w-6 sm:h-7 sm:w-7" />
              </HeroIconAction>
            )}

            <span aria-hidden="true" className="mx-0.5 h-6 w-px bg-white/15" />

            <HeroIconAction
              dataTestId="playlist-more-actions-btn"
              label="Más acciones de playlist"
              tooltip="Más opciones"
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                openPlaylistContextMenu('local', localPl.id, Math.max(12, r.right - 250), r.bottom + 8);
              }}
              className="text-white/75 drop-shadow-[0_3px_12px_rgba(0,0,0,0.6)] hover:text-white"
            >
              <MoreHorizontal className="h-6 w-6 sm:h-7 sm:w-7" />
            </HeroIconAction>

            <button
              type="button"
              aria-label={
                isPlaying &&
                currentTrack &&
                localPl.tracks.some((t) => t.id === currentTrack.id)
                  ? 'Pausar'
                  : 'Reproducir'
              }
              title={
                isPlaying &&
                currentTrack &&
                localPl.tracks.some((t) => t.id === currentTrack.id)
                  ? 'Pausar'
                  : shuffleEnabled || alwaysShuffle
                    ? 'Reproducir en aleatorio'
                    : 'Reproducir'
              }
              onClick={() => {
                if (
                  isPlaying &&
                  currentTrack &&
                  localPl.tracks.some((t) => t.id === currentTrack.id)
                ) {
                  void togglePlayPause();
                } else if (localPl.tracks.length > 0) {
                  recordPlaylistPlay(localPl);
                  void playCollection(localPl.tracks, { isPlaylist: true });
                }
              }}
              className="pm-pressable ml-1 flex h-[72px] w-[72px] items-center justify-center overflow-visible border-0 bg-transparent text-white drop-shadow-[0_6px_22px_rgba(0,0,0,0.65)] transition-transform duration-150 hover:scale-105 active:scale-90 focus:outline-none sm:h-[86px] sm:w-[86px]"
            >
              {isPlaying &&
              currentTrack &&
              localPl.tracks.some((t) => t.id === currentTrack.id) ? (
                <RoundedPauseIcon className="h-[64px] w-[64px] sm:h-[78px] sm:w-[78px]" />
              ) : (
                <RoundedPlayIcon className="h-[64px] w-[64px] translate-x-[2px] sm:h-[78px] sm:w-[78px]" />
              )}
            </button>
          </div>
        ),
      })}

      {/* Playlist Tracks Dropzone + Reorder */}
      {(() => {
        const dupInfo = findPlaylistDuplicates(localPl.tracks);
        const localViewRows = filterAndSortPlaylistTracks(
          localPl.tracks,
          playlistFilterQuery,
          playlistSortMode
        );
        const localQueue = localViewRows.map((r) => r.track);
        const allowManualReorder =
          playlistSortMode === 'custom' && !playlistFilterQuery.trim();
        return (
          <>
            {localPl.tracks.length > 0 && (
              <div className="flex items-center gap-2 sm:justify-between">
                <div className="relative min-w-0 flex-1 sm:max-w-[300px]">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 pm-text-tertiary" />
                  <input
                    type="text"
                    value={playlistFilterQuery}
                    onChange={(e) => setPlaylistFilterQuery(e.target.value)}
                    placeholder="Filtrar canciones..."
                    data-testid="playlist-filter-input"
                    className="pm-input w-full rounded-full py-1.5 pl-8 pr-7 text-xs"
                  />
                  {playlistFilterQuery && (
                    <button
                      type="button"
                      aria-label="Limpiar filtro"
                      onClick={() => setPlaylistFilterQuery('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 pm-text-tertiary hover:pm-text-primary"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                <PlaylistSortControl mode={playlistSortMode} onChange={setPlaylistSortMode} />
              </div>
            )}

            {dupInfo.duplicateCount > 0 && (
              <div
                data-testid="playlist-duplicates-banner"
                className="flex flex-wrap items-center justify-between gap-2 rounded-[12px] border border-amber-500/35 bg-amber-500/10 px-3.5 py-2.5 text-xs text-amber-200"
              >
                <span>
                  {dupInfo.duplicateCount === 1
                    ? 'Hay 1 canción duplicada en esta playlist'
                    : `Hay ${dupInfo.duplicateCount} canciones duplicadas en esta playlist`}
                </span>
                <button
                  type="button"
                  data-testid="playlist-clean-duplicates-btn"
                  onClick={() => void removePlaylistDuplicates(localPl.id)}
                  className="rounded-full bg-amber-400/20 px-3 py-1 text-[11px] font-bold text-amber-100 hover:bg-amber-400/30"
                >
                  Limpiar duplicados
                </button>
              </div>
            )}

            <div
              onDragOver={(e) => {
                const src = getDraggedSource();
                if (src?.playlistId === localPl.id) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'copy';
                setPlaylistDropActive(true);
              }}
              onDragLeave={() => setPlaylistDropActive(false)}
              onDrop={(e) => {
                setPlaylistDropActive(false);
                const src = getDraggedSource();
                if (src?.playlistId === localPl.id) return;
                const dropped = readTrackFromDropEvent(e);
                if (dropped) {
                  e.preventDefault();
                  void addTrackToPlaylist(localPl.id, dropped);
                }
              }}
              className={`space-y-0.5 rounded-[14px] transition-colors ${
                playlistDropActive
                  ? 'pm-active-row p-2 ring-2 ring-[var(--pm-accent-primary)]'
                  : ''
              }`}
            >
              {localPl.tracks.length === 0 ? (
                <div className="pm-surface-card rounded-[14px] border-dashed p-8 text-center text-xs pm-text-secondary">
                  Esta playlist está vacía. Arrastra canciones aquí o usa el buscador de abajo para añadir temas.
                </div>
              ) : localViewRows.length === 0 ? (
                <div className="pm-surface-card rounded-[14px] p-6 text-center text-xs pm-text-secondary">
                  Ninguna canción coincide con «{playlistFilterQuery}»
                </div>
              ) : (
                localViewRows.map(({ track: t, originalIndex }) => (
                  <TrackListRow
                    key={`${t.id}-${originalIndex}`}
                    track={t}
                    index={originalIndex}
                    queueContext={localQueue}
                    playlistId={localPl.id}
                    onDropReorder={
                      allowManualReorder
                        ? (from, to) => void reorderPlaylistTrack(localPl.id, from, to)
                        : undefined
                    }
                  />
                ))
              )}
            </div>
          </>
        );
      })()}

      {/* Collapsible Inline Add Songs Section (auto-open on small playlists, clean toggle on full ones) */}
      {isAddFinderOpen && (
      <section
        data-surface="content"
        className="pm-surface-card space-y-4 rounded-[16px] p-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-[17px] font-bold pm-text-primary">
              Añadir canciones a «{localPl.name}»
            </h2>
            <p className="text-xs pm-text-tertiary">
              Busca temas o pulsa el menú ••• en cualquier canción de la app
            </p>
          </div>
          {localPl.tracks.length >= 1 && (
            <button
              type="button"
              aria-label="Ocultar buscador de playlist"
              onClick={() => setAddFinderOverride(false)}
              className="pm-hover rounded-full p-1.5 pm-text-tertiary hover:text-[var(--pm-text-primary)]"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setIsSearchingAdd(true);
            const found = await searchTracksForPlaylist(addSearchQuery);
            setAddSearchResults(found);
            setIsSearchingAdd(false);
          }}
          className="pm-input flex items-center gap-2.5 rounded-full px-4 py-2"
        >
          <Search className="h-4 w-4 pm-text-secondary" />
          <input
            type="search"
            aria-label="Buscar canciones para añadir a esta playlist"
            placeholder="Buscar canciones o artistas para añadir..."
            value={addSearchQuery}
            onChange={async (e) => {
              const q = e.target.value;
              setAddSearchQuery(q);
              if (q.trim().length >= 2) {
                setIsSearchingAdd(true);
                const found = await searchTracksForPlaylist(q);
                setAddSearchResults(found);
                setIsSearchingAdd(false);
              } else {
                setAddSearchResults([]);
              }
            }}
            className="flex-1 bg-transparent text-xs pm-text-primary placeholder:pm-text-tertiary focus:outline-none"
          />
          {isSearchingAdd && (
            <Loader2 className="h-4 w-4 animate-spin pm-text-secondary" />
          )}
        </form>

        <div className="space-y-1">
          {suggestedAdds.slice(0, 6).map((t) => (
            <div
              key={`add-${t.id}`}
              className="pm-hover flex items-center justify-between gap-3 rounded-[10px] px-2.5 py-2"
            >
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <img
                  src={t.thumbnailUrl}
                  alt=""
                  className="h-10 w-10 shrink-0 rounded-[7px] object-cover"
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13.5px] font-medium pm-text-primary">
                    {t.title}
                  </div>
                  <div className="truncate text-xs pm-text-tertiary">
                    <ArtistLinks
                      artists={t.artists}
                      disableOnMobile
                      linkClassName="hover:underline hover:text-[var(--pm-text-primary)]"
                    />
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => void addTrackToPlaylist(localPl.id, t)}
                className="pm-btn-secondary inline-flex items-center gap-1 rounded-full px-3.5 py-1.5 text-xs font-semibold"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Añadir</span>
              </button>
            </div>
          ))}
        </div>
      </section>
      )}

      {/* Infinite Adaptive Playlist Recommendations (shown only when >= 10 songs) */}
      {localPl.tracks.length >= 10 && (
      <section
        data-surface="content"
        data-testid="playlist-recommendations-section"
        className="pm-surface-card space-y-4 rounded-[16px] p-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-[17px] font-bold pm-text-primary">
              Recomendadas para esta playlist
            </h2>
            <p className="text-xs pm-text-tertiary">
              Al añadir un tema se adaptan automáticamente con nuevas canciones afines
            </p>
          </div>
          <button
            type="button"
            onClick={() => void handleReloadPlaylistRecs()}
            className="pm-btn-secondary pm-pressable inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isLoadingRecs ? 'animate-spin' : ''}`} />
            <span>Recargar</span>
          </button>
        </div>

        <div className="space-y-1">
          {visibleRecs.map((t) => (
            <div
              key={`pl-rec-${t.id}`}
              className="pm-hover flex items-center justify-between gap-2.5 rounded-[10px] px-2.5 py-2"
            >
              <button
                type="button"
                onClick={() => void playTrack(t, [t, ...visibleRecs])}
                className="flex min-w-0 flex-1 items-center gap-3 text-left"
              >
                <img
                  src={t.thumbnailUrl}
                  alt=""
                  className="h-10 w-10 shrink-0 rounded-[7px] object-cover"
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13.5px] font-medium pm-text-primary hover:underline">
                    {t.title}
                  </div>
                  <div className="truncate text-xs pm-text-tertiary">
                    {t.artists.map((a) => a.name).join(', ')}
                  </div>
                </div>
              </button>
              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  aria-label={`No recomendar ${t.title}`}
                  title="No recomendar nunca aquí"
                  onClick={() => void handleDismissRecommendedTrack(t)}
                  className="pm-btn-secondary inline-flex h-8 w-8 items-center justify-center rounded-full pm-text-tertiary hover:text-rose-400"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => void handleAddRecommendedTrack(t)}
                  className="pm-btn-secondary inline-flex items-center gap-1 rounded-full px-3.5 py-1.5 text-xs font-semibold"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Añadir</span>
                </button>
              </div>
            </div>
          ))}
          {visibleRecs.length === 0 && !isLoadingRecs && (
            <div className="py-4 text-center text-xs pm-text-tertiary">
              No quedan sugerencias en este lote. Pulsa <strong>Recargar</strong> para descubrir más canciones.
            </div>
          )}
        </div>
      </section>
      )}

      {renderInviteCollaboratorsModal({
        targetId: localPl.id,
        playlistName: localPl.name,
        shareCode: linkedShared?.shareCode ?? localPl.shareCode,
        memberIds: linkedShared?.memberIds ?? [],
      })}
    </div>
  );
});
DetailViewPanel.displayName = 'DetailViewPanel';

const HOME_CHIPS = ['Todo', 'Música', 'Mixes', 'Álbumes'] as const;

export const HomeScreen: React.FC = React.memo(() => {
  const {
    currentTrack,
    isPlaying,
    homeShelves,
    playlists,
    sharedPlaylists,
    playlistAppearances,
    likedTracks,
    playHistory,
    searchResults,
    exploreEmergingArtists,
    playlistPlayCounts,
    isOfflineNetwork,
    wrappedSeasonActive,
    openWrappedModal,
    favoriteArtists,
    playTrack,
    playCollection,
    openAlbumDetail,
    openArtistDetail,
    openLocalPlaylistDetail,
    recordPlaylistPlay,
    openTrackMenu,
    refreshHomeRecommendations,
  } = usePMusicStore(
    useShallow((s) => ({
      currentTrack: s.currentTrack,
      isPlaying: s.isPlaying,
      homeShelves: s.homeShelves,
      playlists: s.playlists,
      sharedPlaylists: s.sharedPlaylists,
      playlistAppearances: s.playlistAppearances,
      likedTracks: s.likedTracks,
      playHistory: s.playHistory,
      searchResults: s.searchResults,
      exploreEmergingArtists: s.exploreEmergingArtists,
      playlistPlayCounts: s.playlistPlayCounts,
      isOfflineNetwork: s.isOfflineNetwork,
      wrappedSeasonActive: s.wrappedSeasonActive,
      openWrappedModal: s.openWrappedModal,
      favoriteArtists: s.favoriteArtists,
      playTrack: s.playTrack,
      playCollection: s.playCollection,
      openAlbumDetail: s.openAlbumDetail,
      openArtistDetail: s.openArtistDetail,
      openLocalPlaylistDetail: s.openLocalPlaylistDetail,
      recordPlaylistPlay: s.recordPlaylistPlay,
      openTrackMenu: s.openTrackMenu,
      refreshHomeRecommendations: s.refreshHomeRecommendations,
    }))
  );
  const [chip, setChip] = useState<(typeof HOME_CHIPS)[number]>('Todo');
  const [isRefreshingHome, setIsRefreshingHome] = useState(false);

  const listen = homeShelves.find((s) => s.kind === 'listen_again');
  const mixes = homeShelves.find((s) => s.kind === 'mixes_for_you');
  const because = homeShelves.find((s) => s.kind === 'because_you_listened');
  const releases = homeShelves.find((s) => s.kind === 'favorite_new_releases');

  // Promote frequently played user playlists into the Quick-Access grid (YouTube Music style)
  const frequentPlaylists = playlists
    .map((pl) => {
      const normKey = pl.name.trim().toLowerCase().replace(/\s+/g, ' ');
      const stat = playlistPlayCounts[normKey];
      const count = stat?.count ?? 0;
      const recencyBonus = stat?.lastPlayedAt ? Math.max(0, 1 - (Date.now() - stat.lastPlayedAt) / (7 * 86400_000)) : 0;
      return { pl, count, rankScore: count * 3 + recencyBonus };
    })
    .filter((item) => item.pl.tracks.length > 0 && item.count >= 1)
    .sort((a, b) => b.rankScore - a.rankScore)
    .slice(0, 2)
    .map((x) => x.pl);

  const quick = (listen?.tracks ?? []).slice(0, Math.max(4, 6 - frequentPlaylists.length));
  const show = (name: (typeof HOME_CHIPS)[number]) =>
    chip === 'Todo' || chip === name;

  // Build "Tus artistas favoritos" strictly from liked artists (heart) OR >= 2 songs in user playlists / likes / real listening history
  const userRealTracks: Track[] = [
    ...playlists.flatMap((p) => p.tracks),
    ...sharedPlaylists.flatMap((s) => s.tracks),
    ...likedTracks.map((l) => l.track),
    ...playHistory.filter((h) => h.signalType !== 'skip_early').map((h) => h.track),
  ];
  const findArtistPortrait = (artistName: string): string => {
    const low = artistName.trim().toLowerCase();
    const fromSearch = searchResults.artists.find((a) => a.name.trim().toLowerCase() === low)?.thumbnailUrl;
    if (fromSearch) return fromSearch;
    const fromEmerging = exploreEmergingArtists.find((a) => a.name.trim().toLowerCase() === low)?.thumbnailUrl;
    if (fromEmerging) return fromEmerging;
    const fromUserTrack = userRealTracks.find((t) =>
      t.artists[0]?.name.trim().toLowerCase() === low
    );
    return fromUserTrack?.thumbnailHighUrl ?? fromUserTrack?.thumbnailUrl ?? '';
  };

  const libraryArtistCounts = new Map<
    string,
    { id?: string; name: string; count: number; img: string; isHearted: boolean }
  >();
  for (const fa of favoriteArtists) {
    const k = fa.artistName.trim().toLowerCase();
    if (!k) continue;
    libraryArtistCounts.set(k, {
      id: fa.artistId,
      name: fa.artistName,
      count: 1000,
      img: fa.thumbnailUrl || findArtistPortrait(fa.artistName),
      isHearted: true,
    });
  }
  const seenTrackIdsForCounts = new Set<string>();
  for (const t of userRealTracks) {
    if (!t?.id || seenTrackIdsForCounts.has(t.id)) continue;
    seenTrackIdsForCounts.add(t.id);
    const primary = t.artists[0];
    if (!primary?.name) continue;
    const k = primary.name.trim().toLowerCase();
    const existing = libraryArtistCounts.get(k);
    if (existing) {
      existing.count += 1;
      if (!existing.img) existing.img = t.thumbnailHighUrl ?? t.thumbnailUrl ?? '';
      if (!existing.id && primary.id) existing.id = primary.id;
    } else {
      libraryArtistCounts.set(k, {
        id: primary.id,
        name: primary.name,
        count: 1,
        img: findArtistPortrait(primary.name) || t.thumbnailHighUrl || t.thumbnailUrl || '',
        isHearted: false,
      });
    }
  }
  const artistCards = Array.from(libraryArtistCounts.values())
    .filter((entry) => entry.isHearted || entry.count >= 2)
    .sort((a, b) => Number(b.isHearted) - Number(a.isHearted) || b.count - a.count)
    .slice(0, 12)
    .map((entry) => ({
      a: { id: entry.id, name: entry.name },
      img: entry.img,
    }));

  return (
    <div className="pm-page-enter space-y-6 sm:space-y-8">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-[24px] font-bold tracking-tight pm-text-primary sm:text-[28px] md:text-[32px]">
          {getSpanishGreeting()}
        </h1>
        <button
          type="button"
          data-testid="reset-home-recommendations-btn"
          aria-label="Reiniciar escuchar de nuevo y recomendaciones"
          disabled={isRefreshingHome}
          onClick={async () => {
            setIsRefreshingHome(true);
            await refreshHomeRecommendations(true);
            setIsRefreshingHome(false);
          }}
          className="pm-pressable inline-flex h-9 w-9 shrink-0 items-center justify-center gap-2 rounded-full bg-white/[0.08] px-0 text-xs font-semibold pm-text-secondary transition-colors hover:bg-white/[0.16] hover:text-[var(--pm-text-primary)] disabled:opacity-50 sm:w-auto sm:px-3.5"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isRefreshingHome ? 'animate-spin' : ''}`} />
          <span className="hidden sm:inline">Reiniciar inicio</span>
        </button>
      </div>

      {wrappedSeasonActive && (
        <button
          type="button"
          onClick={() => void openWrappedModal()}
          className="pm-pressable relative flex w-full items-center justify-between gap-4 overflow-hidden rounded-3xl border border-[#fa233b]/35 bg-gradient-to-r from-[#2e0c29] via-[#5c1031] to-[#1a1033] p-5 text-left shadow-xl"
        >
          <div className="space-y-1">
            <span className="inline-flex items-center gap-1 rounded-full bg-[#fa233b]/25 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-[#ff7a8a]">
              <Sparkles className="h-3 w-3" />
              Ya disponible
            </span>
            <h2 className="text-xl font-black text-white sm:text-2xl">
              Tu pMusic Wrapped {new Date().getFullYear()}
            </h2>
            <p className="text-xs text-white/75 sm:text-sm">
              Descubre tus minutos, géneros, artistas y canciones #1 en tarjetas 9:16.
            </p>
          </div>
          <span className="shrink-0 rounded-full bg-white px-4 py-2 text-xs font-extrabold text-zinc-900 shadow-md">
            Ver ahora
          </span>
        </button>
      )}

      {/* Filter Pills */}
      <div
        role="tablist"
        aria-label="Filtros de inicio"
        className="pm-no-scrollbar flex flex-nowrap gap-2 overflow-x-auto pb-0.5 sm:flex-wrap"
      >
        {HOME_CHIPS.map((c) => (
          <button
            key={c}
            type="button"
            role="tab"
            aria-selected={chip === c}
            onClick={() => setChip(c)}
            className={`shrink-0 rounded-full px-4 py-1.5 text-[13px] font-semibold transition-colors ${
              chip === c ? 'pm-btn-primary' : 'pm-btn-secondary'
            }`}
          >
            {c}
          </button>
        ))}
      </div>

      {isOfflineNetwork && (
        <div
          role="status"
          className="rounded-xl border border-amber-500/35 bg-amber-500/10 px-4 py-3 text-[13px] font-medium pm-text-primary"
        >
          Sin conexión. Mostrando tu caché offline y catálogo guardado.
        </div>
      )}

      {/* 2x3 Compact Quick-Access Grid (Promotes Frequently Played Playlists + Top Songs) */}
      {chip === 'Todo' && (quick.length > 0 || frequentPlaylists.length > 0) && (
        <section aria-label="Escuchar de nuevo">
          <div className="grid grid-cols-2 gap-2 sm:gap-2.5 lg:grid-cols-3">
            {frequentPlaylists.map((pl) => {
              const plCover =
                playlistAppearances[pl.id]?.coverUrl ?? pl.coverUrl ?? pl.tracks[0]?.thumbnailUrl;
              return (
                <div
                  key={`quick-pl-${pl.id}`}
                  data-testid={`quick-playlist-tile-${pl.id}`}
                  data-surface="content"
                  role="button"
                  tabIndex={0}
                  aria-label={`Abrir playlist ${pl.name}`}
                  onClick={() => openLocalPlaylistDetail(pl.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      openLocalPlaylistDetail(pl.id);
                    }
                  }}
                  className="pm-quick-tile pm-card-lift group flex cursor-pointer items-center gap-2.5 overflow-hidden rounded-[10px] pr-2.5 sm:gap-3 sm:rounded-[8px]"
                >
                  <div className="h-[52px] w-[52px] shrink-0 overflow-hidden sm:h-14 sm:w-14">
                    {plCover ? (
                      <img
                        src={plCover}
                        alt={pl.name}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="pm-elevated flex h-full w-full items-center justify-center text-sm font-bold pm-text-secondary">
                        {pl.name.slice(0, 1).toUpperCase()}
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1 py-1">
                    <div className="line-clamp-2 text-left text-[12.5px] font-semibold leading-[1.2] pm-text-primary sm:truncate sm:text-[14px]">
                      {pl.name}
                    </div>
                    <div className="hidden truncate text-[12px] leading-normal pm-text-tertiary sm:block">
                      Playlist · {pl.tracks.length} temas
                    </div>
                  </div>
                  <button
                    type="button"
                    aria-label={`Reproducir playlist ${pl.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (pl.tracks.length > 0) {
                        recordPlaylistPlay(pl);
                        void playCollection(pl.tracks, { isPlaylist: true });
                      }
                    }}
                    className="pm-cover-play pm-btn-primary hidden h-9 w-9 shrink-0 items-center justify-center rounded-full shadow-md sm:flex"
                  >
                    <Play className="h-4 w-4 translate-x-[1px] fill-current" />
                  </button>
                </div>
              );
            })}
            {quick.map((t) => {
              const isTilePlaying = currentTrack.id === t.id;
              return (
                <div
                  key={t.id}
                  data-surface="content"
                  data-playing={isTilePlaying ? 'true' : undefined}
                  role="button"
                  tabIndex={0}
                  aria-label={`Reproducir ${t.title}`}
                  draggable
                  onDragStart={(e) => setDraggedTrack(e, t)}
                  onDragEnd={() => clearDraggedTrack()}
                  onClick={() => void playTrack(t, listen?.tracks)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      void playTrack(t, listen?.tracks);
                    }
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    openTrackMenu(t, e.clientX, e.clientY);
                  }}
                  className="pm-quick-tile pm-card-lift group flex cursor-pointer items-center gap-2.5 overflow-hidden rounded-[10px] pr-2.5 sm:gap-3 sm:rounded-[8px]"
                >
                  <div className="h-[52px] w-[52px] shrink-0 overflow-hidden sm:h-14 sm:w-14">
                    <img
                      src={t.thumbnailUrl}
                      alt={t.title}
                      className="h-full w-full object-cover"
                    />
                  </div>
                  <div className="min-w-0 flex-1 py-1">
                    <div className="line-clamp-2 text-left text-[12.5px] font-semibold leading-[1.2] pm-text-primary sm:truncate sm:text-[14px]">
                      {t.title}
                    </div>
                    <div
                      onClick={(e) => {
                        if ((e.target as HTMLElement).closest('button, a')) {
                          e.stopPropagation();
                        }
                      }}
                      className="hidden truncate text-[12px] leading-normal pm-text-tertiary sm:block"
                    >
                      <ArtistLinks
                        artists={t.artists}
                        disableOnMobile
                        className="!flex-nowrap whitespace-nowrap"
                        linkClassName="hover:underline hover:text-[var(--pm-text-primary)]"
                      />
                    </div>
                  </div>
                  {isTilePlaying && isPlaying && (
                    <span className="shrink-0 sm:hidden">
                      <PlayingEqBars />
                    </span>
                  )}
                  <button
                    type="button"
                    aria-label={`Más opciones para ${t.title}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      const r = e.currentTarget.getBoundingClientRect();
                      openTrackMenu(t, r.left - 180, r.bottom + 6);
                    }}
                    className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-full pm-text-tertiary opacity-0 transition-opacity hover:bg-[var(--pm-hover-tint)] hover:text-[var(--pm-text-primary)] group-hover:opacity-100 sm:flex"
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Play ${t.title}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      void playTrack(t, listen?.tracks);
                    }}
                    className="pm-cover-play pm-btn-primary hidden h-9 w-9 shrink-0 items-center justify-center rounded-full shadow-md sm:flex"
                  >
                    <Play className="h-4 w-4 translate-x-[1px] fill-current" />
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Mixes para ti (Novedades de lunes a lunes, Daily Mix 100 y Daily Discover 100, sin DJ) */}
      {show('Mixes') && mixes?.mixes && (
        <CarouselSection
          title="Mixes para ti"
          subtitle={mixes.subtitle ?? 'Novedades de lunes a lunes, tu Daily Mix y Daily Discover de 100 temas'}
        >
          {mixes.mixes.map((mix) => (
            <CoverCard
              key={mix.id}
              image={mix.coverUrl}
              title={mix.title}
              subtitle={mix.subtitle}
              badge={mix.badge}
              onOpen={() => {
                usePMusicStore.setState({
                  activeDetailView: {
                    kind: 'playlist',
                    data: {
                      playlist: {
                        id: mix.id,
                        title: mix.title,
                        author: 'pMusic Mixes',
                        trackCount: mix.tracks.length,
                        thumbnailUrl: mix.coverUrl,
                        source: 'mix',
                      },
                      tracks: mix.tracks,
                    },
                  },
                });
              }}
              onPlay={() => {
                if (mix.tracks.length > 0) {
                  void playCollection(mix.tracks, { isPlaylist: true });
                }
              }}
            />
          ))}
        </CarouselSection>
      )}

      {/* Porque escuchaste a... */}
      {show('Música') && because?.tracks && because.tracks.length > 0 && (
        <CarouselSection title={because.title} subtitle={because.subtitle}>
          {because.tracks.map((t) => (
            <CoverCard
              key={t.id}
              image={t.thumbnailHighUrl ?? t.thumbnailUrl}
              title={t.title}
              subtitleNode={
                <ArtistLinks
                  artists={t.artists}
                  linkClassName="hover:underline hover:text-[var(--pm-text-primary)]"
                />
              }
              dragTrack={t}
              onOpen={() => void playTrack(t, because.tracks)}
              onPlay={() => void playTrack(t, because.tracks)}
            />
          ))}
        </CarouselSection>
      )}

      {/* Éxitos del momento (Clean flat rows) */}
      {show('Música') && listen?.tracks && listen.tracks.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-[20px] font-bold tracking-tight pm-text-primary md:text-[22px]">
            Escuchar de nuevo
          </h2>
          <div className="grid grid-cols-1 gap-x-6 md:grid-cols-2">
            {listen.tracks.slice(0, 8).map((t, i) => (
              <TrackListRow
                key={`listen-${t.id}`}
                track={t}
                index={i}
                queueContext={listen.tracks}
              />
            ))}
          </div>
        </section>
      )}

      {/* Álbumes para ti */}
      {show('Álbumes') && releases?.albums && releases.albums.length > 0 && (
        <CarouselSection title="Álbumes para ti">
          {releases.albums.map((al) => (
            <CoverCard
              key={al.id}
              image={al.thumbnailUrl}
              title={al.title}
              subtitleNode={
                <span>
                  {al.year ? `${al.year} · ` : ''}
                  <ArtistLinks
                    artists={al.artists}
                    linkClassName="hover:underline hover:text-[var(--pm-text-primary)]"
                  />
                </span>
              }
              onOpen={() =>
                void openAlbumDetail(al.id, {
                  title: al.title,
                  artist: al.artists?.[0]?.name,
                })
              }
            />
          ))}
        </CarouselSection>
      )}

      {/* Artistas destacados */}
      {chip === 'Todo' && artistCards.length > 0 && (
        <CarouselSection title="Tus artistas favoritos">
          {artistCards.map(({ a, img }) => (
            <CoverCard
              key={a.id ?? a.name}
              image={img}
              title={a.name}
              subtitle="Artista"
              round
              onOpen={() =>
                void openArtistDetail(a.id ?? a.name, { name: a.name })
              }
            />
          ))}
        </CarouselSection>
      )}
    </div>
  );
});
HomeScreen.displayName = 'HomeScreen';

const GENRE_CARDS = [
  { label: 'Latino', query: 'Género: Latino', accent: '#EF4444' },
  { label: 'Reggaetón', query: 'Género: Reggaetón', accent: '#F59E0B' },
  { label: 'Rap & Hip-Hop', query: 'Género: Rap & Hip-Hop', accent: '#C084FC' },
  { label: 'Pop', query: 'Género: Pop', accent: '#3B82F6' },
  { label: 'Electrónica', query: 'Género: Electrónica', accent: '#06B6D4' },
  { label: 'R&B', query: 'Género: R&B', accent: '#EC4899' },
  { label: 'Dance', query: 'Género: Dance', accent: '#10B981' },
  { label: 'Rock', query: 'Género: Rock', accent: '#F97316' },
] as const;

export const ExploreScreen: React.FC = React.memo(() => {
  const {
    homeShelves,
    searchResults,
    playlists,
    likedTracks,
    exploreSimilarTracks,
    exploreEmergingArtists,
    isLoadingExplore,
    refreshExploreDiscovery,
    submitSearch,
    setActiveTab,
    playTrack,
    openAlbumDetail,
    openArtistDetail,
  } = usePMusicStore(
    useShallow((s) => ({
      homeShelves: s.homeShelves,
      searchResults: s.searchResults,
      playlists: s.playlists,
      likedTracks: s.likedTracks,
      exploreSimilarTracks: s.exploreSimilarTracks,
      exploreEmergingArtists: s.exploreEmergingArtists,
      isLoadingExplore: s.isLoadingExplore,
      refreshExploreDiscovery: s.refreshExploreDiscovery,
      submitSearch: s.submitSearch,
      setActiveTab: s.setActiveTab,
      playTrack: s.playTrack,
      openAlbumDetail: s.openAlbumDetail,
      openArtistDetail: s.openArtistDetail,
    }))
  );

  const listen = homeShelves.find((s) => s.kind === 'listen_again');
  const releases = homeShelves.find((s) => s.kind === 'favorite_new_releases');
  const ownedTracks = [
    ...playlists.flatMap((p) => p.tracks),
    ...likedTracks.map((l) => l.track),
  ];
  const ownedIds = new Set(ownedTracks.map((t) => t.id));
  const ownedKeys = new Set(
    ownedTracks.map(
      (t) => `${t.title.trim().toLowerCase()}::${(t.artists[0]?.name ?? '').trim().toLowerCase()}`
    )
  );
  const isNotOwned = (t: Track) => {
    if (ownedIds.has(t.id)) return false;
    const key = `${t.title.trim().toLowerCase()}::${(t.artists[0]?.name ?? '').trim().toLowerCase()}`;
    return !ownedKeys.has(key);
  };

  const similarDiscoverTracks = (
    exploreSimilarTracks.length > 0
      ? exploreSimilarTracks
      : (listen?.tracks ?? [])
  )
    .filter(isNotOwned)
    .slice(0, 8);
  const trendingSongs = (
    searchResults.songs.length > 0
      ? searchResults.songs
      : listen?.tracks ?? []
  )
    .filter(isNotOwned)
    .slice(0, 6);
  const albums =
    searchResults.albums.length > 0
      ? searchResults.albums
      : releases?.albums ?? [];
  const emergingArtists = exploreEmergingArtists;
  const artists = searchResults.artists;

  const heroDiscoveryTrack = similarDiscoverTracks[0] ?? trendingSongs[0] ?? null;

  return (
    <div className="pm-page-enter space-y-7 sm:space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-black tracking-tight pm-text-primary md:text-[32px]">
            Explorar
          </h1>
          <p className="text-[13px] pm-text-tertiary">
            Algoritmo de descubrimiento afín a tu estilo, letras y escena emergente
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refreshExploreDiscovery(true)}
          className="pm-btn-secondary pm-pressable inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold"
        >
          {isLoadingExplore ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Sparkles className="h-3.5 w-3.5 text-purple-300" />
          )}
          <span>Actualizar recomendaciones</span>
        </button>
      </div>

      {/* Featured Discovery Spotlight Hero */}
      {heroDiscoveryTrack && (
        <section
          data-surface="content"
          className="pm-surface-card relative overflow-hidden rounded-[22px] border border-white/10 p-4 sm:p-6"
        >
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -right-14 -top-14 h-52 w-52 rounded-full bg-[var(--pm-accent-primary)]/20 blur-3xl"
          />
          <div className="relative z-10 flex items-center gap-4 sm:gap-5">
            <TrackArtwork
              trackId={heroDiscoveryTrack.id}
              src={heroDiscoveryTrack.thumbnailHighUrl ?? heroDiscoveryTrack.thumbnailUrl}
              title={heroDiscoveryTrack.title}
              artistName={heroDiscoveryTrack.artists[0]?.name}
              artistId={heroDiscoveryTrack.artists[0]?.id}
              alt={heroDiscoveryTrack.title}
              variant="card"
              imgClassName="h-20 w-20 shrink-0 rounded-[14px] object-cover shadow-xl sm:h-24 sm:w-24 sm:rounded-[16px]"
            />
            <div className="min-w-0 flex-1 space-y-1">
              <div className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.08] px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-white/80">
                <Sparkles className="h-3 w-3 text-purple-300" />
                <span>Selección pMusic · Para tu vibra</span>
              </div>
              <h2 className="truncate text-lg font-black tracking-tight pm-text-primary sm:text-2xl">
                {heroDiscoveryTrack.title}
              </h2>
              <p className="truncate text-xs font-medium pm-text-secondary sm:text-sm">
                {heroDiscoveryTrack.artists.map((a) => a.name).join(', ')}
              </p>
            </div>
            <button
              type="button"
              aria-label={`Reproducir ${heroDiscoveryTrack.title}`}
              onClick={() =>
                void playTrack(
                  heroDiscoveryTrack,
                  similarDiscoverTracks.length > 0 ? similarDiscoverTracks : trendingSongs
                )
              }
              className="pm-btn-primary pm-pressable inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full shadow-lg sm:h-12 sm:w-12"
            >
              <Play className="h-4 w-4 translate-x-[1px] fill-current sm:h-5 sm:w-5" />
            </button>
          </div>
        </section>
      )}

      {/* Genres Grid */}
      <section className="space-y-3">
        <h2 className="text-[19px] font-bold tracking-tight pm-text-primary sm:text-[20px]">
          Explorar géneros
        </h2>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 sm:gap-3">
          {GENRE_CARDS.map((g) => (
            <button
              key={g.query}
              type="button"
              onClick={() => {
                setActiveTab('Buscar');
                void submitSearch(g.query);
              }}
              className="pm-surface-card pm-card-lift group relative flex items-center justify-between gap-2.5 overflow-hidden rounded-[14px] px-4 py-3.5 text-left"
              style={{
                background: `radial-gradient(120% 100% at 100% 0%, ${g.accent}24 0%, transparent 62%)`,
              }}
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <span
                  aria-hidden="true"
                  className="h-5 w-1.5 shrink-0 rounded-full transition-transform group-hover:scale-y-125"
                  style={{ backgroundColor: g.accent }}
                />
                <span className="truncate text-[13.5px] font-bold pm-text-primary">
                  {g.label}
                </span>
              </div>
              <Music2
                className="h-4 w-4 shrink-0 opacity-45 transition-opacity group-hover:opacity-90"
                style={{ color: g.accent }}
              />
            </button>
          ))}
        </div>
      </section>

      {/* Personalized Mega Discovery: Similar to Your Taste */}
      {similarDiscoverTracks.length > 0 && (
        <section className="space-y-3">
          <div>
            <h2 className="text-[20px] font-bold tracking-tight pm-text-primary">
              Para tu vibra · Similares a lo que escuchas
            </h2>
            <p className="text-[12.5px] pm-text-tertiary">
              Temas con sonido, temática y colaboradores afines a tus escuchas recientes
            </p>
          </div>
          <div className="grid grid-cols-1 gap-x-6 md:grid-cols-2">
            {similarDiscoverTracks.map((t, i) => (
              <TrackListRow
                key={`explore-sim-${t.id}`}
                track={t}
                index={i}
                queueContext={similarDiscoverTracks}
              />
            ))}
          </div>
        </section>
      )}

      {/* Emerging & Underground Scene Artists */}
      {emergingArtists.length > 0 && (
        <CarouselSection
          title="Artistas emergentes para descubrir"
          subtitle="Voces nuevas y colaboraciones de tu escena con potencial similar"
        >
          {emergingArtists.map((ar) => (
            <CoverCard
              key={`explore-emerging-${ar.id}`}
              image={ar.thumbnailUrl}
              title={ar.name}
              subtitle={
                ar.subscribersText
                  ? `Emergente · ${ar.subscribersText}`
                  : 'Escena afín'
              }
              round
              onOpen={() =>
                void openArtistDetail(ar.id || ar.name, {
                  name: ar.name,
                  thumbnailUrl: ar.thumbnailUrl,
                })
              }
            />
          ))}
        </CarouselSection>
      )}

      {/* Trending Songs */}
      {trendingSongs.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-[20px] font-bold tracking-tight pm-text-primary">
            Tendencias ahora
          </h2>
          <div className="grid grid-cols-1 gap-x-6 md:grid-cols-2">
            {trendingSongs.map((t, i) => (
              <TrackListRow
                key={`explore-trend-${t.id}`}
                track={t}
                index={i}
                queueContext={trendingSongs}
              />
            ))}
          </div>
        </section>
      )}

      {/* Featured Albums */}
      {albums.length > 0 && (
        <CarouselSection
          title="Álbumes destacados"
          subtitle="Lanzamientos populares en tu escena"
        >
          {albums.map((al) => (
            <CoverCard
              key={`explore-album-${al.id}`}
              image={al.thumbnailUrl}
              title={al.title}
              subtitleNode={
                <span>
                  {al.year ? `${al.year} · ` : ''}
                  <ArtistLinks
                    artists={al.artists}
                    linkClassName="hover:underline hover:text-[var(--pm-text-primary)]"
                  />
                </span>
              }
              onOpen={() =>
                void openAlbumDetail(al.id, {
                  title: al.title,
                  artist: al.artists?.[0]?.name,
                })
              }
            />
          ))}
        </CarouselSection>
      )}

      {/* Artists to Discover */}
      {artists.length > 0 && (
        <CarouselSection
          title="Artistas para descubrir"
          subtitle="Perfiles esenciales de la escena actual"
        >
          {artists.map((ar) => (
            <CoverCard
              key={`explore-artist-${ar.id}`}
              image={ar.thumbnailUrl}
              title={ar.name}
              subtitle={ar.subscribersText ?? 'Artista'}
              round
              onOpen={() =>
                void openArtistDetail(ar.id, {
                  name: ar.name,
                  thumbnailUrl: ar.thumbnailUrl,
                })
              }
              onPlay={() => {
                const match =
                  trendingSongs.find((t) =>
                    t.artists.some((a) => a.name === ar.name)
                  ) ?? trendingSongs[0];
                if (match) void playTrack(match, trendingSongs);
              }}
            />
          ))}
        </CarouselSection>
      )}
    </div>
  );
});
ExploreScreen.displayName = 'ExploreScreen';

export const SearchScreen: React.FC = React.memo(() => {
  const {
    spotlightOpen,
    setSpotlightOpen,
    searchQuery,
    isSearching,
    searchScope,
    searchResults,
    bestResult,
    autocompleteSuggestions,
    recentSearches,
    recentSearchItems,
    likedTracks,
    playHistory,
    playlists,
    favoriteArtists,
    homeShelves,
    affinityProfile,
    setSearchQuery,
    submitSearch,
    setSearchScope,
    clearRecentSearches,
    addRecentSearchTrack,
    addRecentSearchArtist,
    removeRecentSearchItem,
    clearRecentSearchItems,
    playTrack,
    openArtistDetail,
    openAlbumDetail,
    openPlaylistDetail,
  } = usePMusicStore(
    useShallow((s) => ({
      spotlightOpen: s.spotlightOpen,
      setSpotlightOpen: s.setSpotlightOpen,
      searchQuery: s.searchQuery,
      isSearching: s.isSearching,
      searchScope: s.searchScope,
      searchResults: s.searchResults,
      bestResult: s.bestResult,
      autocompleteSuggestions: s.autocompleteSuggestions,
      recentSearches: s.recentSearches,
      recentSearchItems: s.recentSearchItems,
      likedTracks: s.likedTracks,
      playHistory: s.playHistory,
      playlists: s.playlists,
      favoriteArtists: s.favoriteArtists,
      homeShelves: s.homeShelves,
      affinityProfile: s.affinityProfile,
      setSearchQuery: s.setSearchQuery,
      submitSearch: s.submitSearch,
      setSearchScope: s.setSearchScope,
      clearRecentSearches: s.clearRecentSearches,
      addRecentSearchTrack: s.addRecentSearchTrack,
      addRecentSearchArtist: s.addRecentSearchArtist,
      removeRecentSearchItem: s.removeRecentSearchItem,
      clearRecentSearchItems: s.clearRecentSearchItems,
      playTrack: s.playTrack,
      openArtistDetail: s.openArtistDetail,
      openAlbumDetail: s.openAlbumDetail,
      openPlaylistDetail: s.openPlaylistDetail,
    }))
  );

  const { recommendedTracks, recommendedArtists } = buildSearchHomeRecommendations({
    likedTracks,
    playHistory,
    playlists,
    recentSearchItems,
    recentSearches,
    favoriteArtists,
    homeShelves,
    affinityProfile,
  });
  const hasSearchText = Boolean(searchQuery.trim());

  const scopes: readonly SearchScopeTab[] = [
    'Todo',
    'Canciones',
    'Artistas',
    'Álbumes',
    'Playlists',
  ];

  return (
    <div className="pm-page-enter space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-bold tracking-tight pm-text-primary">
            Buscar
          </h1>
          <p className="text-[13px] pm-text-tertiary">
            Canciones, artistas, álbumes y listas completas
          </p>
        </div>
        <button
          type="button"
          onClick={() => setSpotlightOpen(true)}
          className="pm-btn-secondary hidden items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-medium md:inline-flex"
        >
          <Search className="h-3.5 w-3.5" />
          <span>Búsqueda rápida</span>
          <kbd className="pm-elevated rounded border pm-border px-1.5 py-0.5 text-[11px] font-semibold pm-text-primary">
            Ctrl K
          </kbd>
        </button>
      </div>

      {/* Sleek Liquid Glass Search Field (hides native searchbox role when Spotlight modal is open to avoid duplicates) */}
      {spotlightOpen ? (
        <button
          type="button"
          onClick={() => setSpotlightOpen(true)}
          className="pm-glass-search flex w-full items-center gap-3 rounded-full px-4 py-3 text-left text-[14px] pm-text-tertiary"
        >
          <Search className="h-4 w-4 shrink-0 pm-text-secondary" />
          <span>{searchQuery || '¿Qué te apetece escuchar hoy?'}</span>
        </button>
      ) : (
        <form
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            void submitSearch();
          }}
          className="pm-glass-search flex items-center gap-3 rounded-full px-4 py-2.5"
        >
          <Search className="h-4 w-4 shrink-0 pm-text-secondary" />
          <input
            type="search"
            role="searchbox"
            aria-label="Buscar canciones, artistas o álbumes"
            placeholder="¿Qué te apetece escuchar hoy?"
            value={searchQuery}
            onChange={(e) => void setSearchQuery(e.target.value)}
            className="pm-input-frameless flex-1 bg-transparent text-[14px] font-medium pm-text-primary placeholder:pm-text-tertiary focus:outline-none"
          />
          {isSearching && (
            <Loader2 className="h-4 w-4 animate-spin pm-text-secondary" />
          )}
          {searchQuery && (
            <button
              type="button"
              aria-label="Limpiar búsqueda"
              onClick={() => void setSearchQuery('', true)}
              className="pm-btn-secondary rounded-full px-3 py-1 text-xs font-semibold"
            >
              Limpiar
            </button>
          )}
        </form>
      )}

      {/* Autocomplete & Recent Searches */}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="flex flex-nowrap items-center gap-1.5 overflow-x-auto pb-1 pm-no-scrollbar sm:flex-wrap sm:overflow-visible sm:pb-0">
          {autocompleteSuggestions.slice(0, 6).map((sug) => (
            <button
              key={sug.text}
              type="button"
              onClick={() => void submitSearch(sug.text)}
              className="pm-btn-secondary shrink-0 rounded-full px-3.5 py-1.5 text-xs font-medium"
            >
              {sug.text}
            </button>
          ))}
        </div>

        {recentSearches.length > 0 && (
          <div className="flex flex-nowrap items-center gap-2 overflow-x-auto pb-1 pm-no-scrollbar sm:flex-wrap sm:overflow-visible sm:pb-0">
            <span className="shrink-0 text-xs pm-text-tertiary">Recientes:</span>
            {recentSearches.slice(0, 3).map((rec) => (
              <button
                key={rec}
                type="button"
                onClick={() => void submitSearch(rec)}
                className="pm-elevated shrink-0 rounded-full border pm-border px-3 py-1 text-xs pm-text-secondary hover:text-[var(--pm-text-primary)]"
              >
                {rec}
              </button>
            ))}
            <button
              type="button"
              onClick={() => clearRecentSearches()}
              className="shrink-0 text-xs font-medium pm-text-secondary hover:text-[var(--pm-text-primary)] hover:underline"
            >
              Borrar
            </button>
          </div>
        )}
      </div>

      {/* Personal Recent Searches & Personalized Recommendations when query is empty */}
      {!hasSearchText && !spotlightOpen && (
        <div className="space-y-6">
          {(recentSearchItems.length > 0 || recentSearches.length > 0) && (
            <section data-testid="search-recent-items" className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-[18px] font-bold pm-text-primary">Tus búsquedas recientes</h2>
                <button
                  type="button"
                  onClick={() => {
                    clearRecentSearchItems();
                    clearRecentSearches();
                  }}
                  className="text-xs font-medium pm-text-secondary hover:text-[var(--pm-text-primary)] hover:underline"
                >
                  Borrar todo
                </button>
              </div>
              {recentSearchItems.length > 0 && (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {recentSearchItems.slice(0, 6).map((item) =>
                    item.kind === 'artist' ? (
                      <div
                        key={`search-rec-${item.id}`}
                        className="pm-surface-card pm-hover flex items-center gap-2.5 rounded-[12px] p-2.5"
                      >
                        <button
                          type="button"
                          onClick={() => {
                            addRecentSearchArtist({
                              id: item.artistId,
                              name: item.name,
                              thumbnailUrl: item.thumbnailUrl,
                            });
                            void openArtistDetail(item.artistId, {
                              name: item.name,
                              thumbnailUrl: item.thumbnailUrl,
                            });
                          }}
                          className="flex min-w-0 flex-1 items-center gap-3 text-left"
                        >
                          <img
                            src={item.thumbnailUrl}
                            alt={item.name}
                            className="h-10 w-10 shrink-0 rounded-full object-cover"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[13.5px] font-semibold pm-text-primary">
                              {item.name}
                            </div>
                            <div className="truncate text-[11px] pm-text-tertiary">Artista</div>
                          </div>
                        </button>
                        <button
                          type="button"
                          aria-label={`Quitar ${item.name} de recientes`}
                          onClick={() => removeRecentSearchItem(item.id)}
                          className="pm-text-tertiary hover:pm-text-primary flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ) : (
                      <div
                        key={`search-rec-${item.id}`}
                        className="pm-surface-card pm-hover group flex items-center gap-2.5 rounded-[12px] p-2.5"
                      >
                        <button
                          type="button"
                          aria-label={`Reproducir ${item.track.title}`}
                          onClick={() => {
                            addRecentSearchTrack(item.track);
                            void playTrack(item.track, [item.track]);
                          }}
                          className="relative h-10 w-10 shrink-0 overflow-hidden rounded-[8px]"
                        >
                          <img
                            src={item.track.thumbnailUrl}
                            alt={item.track.title}
                            className="h-full w-full object-cover"
                          />
                          <span className="absolute inset-0 flex items-center justify-center bg-black/45 opacity-0 transition-opacity group-hover:opacity-100">
                            <Play className="h-3.5 w-3.5 translate-x-[1px] fill-current text-white" />
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            addRecentSearchTrack(item.track);
                            void playTrack(item.track, [item.track]);
                          }}
                          className="min-w-0 flex-1 text-left"
                        >
                          <div className="truncate text-[13.5px] font-semibold pm-text-primary hover:underline">
                            {item.track.title}
                          </div>
                          <div className="truncate text-[11px] pm-text-tertiary">
                            {item.track.artists.map((a) => a.name).join(', ')}
                          </div>
                        </button>
                        <button
                          type="button"
                          aria-label={`Quitar ${item.track.title} de recientes`}
                          onClick={() => removeRecentSearchItem(item.id)}
                          className="pm-text-tertiary hover:pm-text-primary flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )
                  )}
                </div>
              )}
            </section>
          )}

          {recommendedArtists.length > 0 && (
            <div data-testid="search-recommended-artists">
              <CarouselSection title="Artistas para ti">
                {recommendedArtists.map((artist) => (
                  <CoverCard
                    key={`rec-artist-${artist.id}-${artist.name}`}
                    image={artist.thumbnailUrl}
                    title={artist.name}
                    subtitle={artist.subscribersText ?? 'Para ti'}
                    round
                    onOpen={() => {
                      addRecentSearchArtist({
                        id: artist.id,
                        name: artist.name,
                        thumbnailUrl: artist.thumbnailUrl,
                      });
                      void openArtistDetail(artist.id, {
                        name: artist.name,
                        thumbnailUrl: artist.thumbnailUrl,
                      });
                    }}
                  />
                ))}
              </CarouselSection>
            </div>
          )}

          {recommendedTracks.length > 0 && (
            <section data-testid="search-recommended-for-you" className="space-y-2.5">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-white/80" />
                <h2 className="text-[18px] font-bold pm-text-primary">Recomendado para ti</h2>
              </div>
              <div className="grid grid-cols-1 gap-x-6 md:grid-cols-2">
                {recommendedTracks.slice(0, 8).map((track, idx) => (
                  <TrackListRow
                    key={`rec-row-${track.id}`}
                    track={track}
                    index={idx}
                    queueContext={recommendedTracks}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {/* 5 Scope Filter Tabs */}
      <div
        role="tablist"
        aria-label="Filtros de búsqueda"
        className="flex flex-nowrap gap-1.5 overflow-x-auto pb-1 pm-no-scrollbar sm:flex-wrap sm:overflow-visible sm:pb-0"
      >
        {scopes.map((scope) => {
          const active = searchScope === scope;
          return (
            <button
              key={scope}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setSearchScope(scope)}
              className={`shrink-0 rounded-full px-4 py-1.5 text-xs font-bold transition-colors ${
                active ? 'pm-btn-primary' : 'pm-btn-secondary'
              }`}
            >
              {scope}
            </button>
          );
        })}
      </div>

      {/* Spotify Desktop 2-Column Top Result + Top 4 Songs */}
      {searchScope === 'Todo' && bestResult ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <section className="space-y-2.5 lg:col-span-5">
            <h2 className="text-[18px] font-bold pm-text-primary">
              Mejor resultado
            </h2>
            <div
              data-testid="best-result-card"
              data-surface="content"
              className="pm-surface-card group flex flex-col justify-between gap-4 rounded-[16px] p-5"
            >
              {bestResult.kind === 'artist' && (
                <>
                  <div className="flex items-center gap-4">
                    <img
                      src={bestResult.item.thumbnailUrl}
                      alt={bestResult.item.name}
                      className="h-24 w-24 shrink-0 rounded-full object-cover shadow-xl"
                    />
                    <div className="min-w-0">
                      <span className="pm-elevated inline-block rounded-md border pm-border px-2.5 py-0.5 text-[11px] font-semibold pm-text-secondary">
                        ARTISTA
                      </span>
                      <h3 className="mt-1.5 truncate text-2xl font-bold pm-text-primary">
                        {bestResult.item.name}
                      </h3>
                      <p className="text-xs pm-text-tertiary">
                        {bestResult.item.subscribersText ?? 'Artista'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      aria-label={`Reproducir ${bestResult.item.name}`}
                      onClick={() => {
                        const song =
                          searchResults.songs.find((s) =>
                            s.artists.some(
                              (a) => a.name === bestResult.item.name
                            )
                          ) ?? searchResults.songs[0];
                        if (song) void playTrack(song, [song]);
                      }}
                      className="pm-btn-primary inline-flex items-center gap-1.5 rounded-full px-5 py-2 text-xs font-bold"
                    >
                      <Play className="h-4 w-4 fill-current" />
                      <span>Reproducir</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        addRecentSearchArtist({
                          id: bestResult.item.id,
                          name: bestResult.item.name,
                          thumbnailUrl: bestResult.item.thumbnailUrl,
                        });
                        void openArtistDetail(bestResult.item.id, {
                          name: bestResult.item.name,
                          thumbnailUrl: bestResult.item.thumbnailUrl,
                        });
                      }}
                      className="pm-btn-secondary rounded-full px-4 py-2 text-xs font-semibold"
                    >
                      Ver perfil
                    </button>
                  </div>
                </>
              )}

              {bestResult.kind === 'song' && (
                <>
                  <div className="flex items-center gap-4">
                    <img
                      src={
                        bestResult.item.thumbnailHighUrl ??
                        bestResult.item.thumbnailUrl
                      }
                      alt={bestResult.item.title}
                      className="h-24 w-24 shrink-0 rounded-[12px] object-cover shadow-xl"
                    />
                    <div className="min-w-0">
                      <span className="pm-elevated inline-block rounded-md border pm-border px-2.5 py-0.5 text-[11px] font-semibold pm-text-secondary">
                        CANCIÓN
                      </span>
                      <h3 className="mt-1.5 truncate text-2xl font-bold pm-text-primary">
                        {bestResult.item.title}
                      </h3>
                      <div className="truncate text-xs pm-text-secondary">
                        <ArtistLinks
                          artists={bestResult.item.artists}
                          linkClassName="hover:underline hover:text-[var(--pm-text-primary)]"
                        />
                      </div>
                    </div>
                  </div>
                  <div>
                    <button
                      type="button"
                      aria-label={`Reproducir ${bestResult.item.title}`}
                      onClick={() => {
                        addRecentSearchTrack(bestResult.item);
                        void playTrack(bestResult.item, [bestResult.item]);
                      }}
                      className="pm-btn-primary inline-flex items-center gap-1.5 rounded-full px-5 py-2 text-xs font-bold"
                    >
                      <Play className="h-4 w-4 fill-current" />
                      <span>Reproducir</span>
                    </button>
                  </div>
                </>
              )}
            </div>
          </section>

          <section className="space-y-2 lg:col-span-7">
            <h2 className="text-[18px] font-bold pm-text-primary">Canciones</h2>
            <div className="space-y-0.5">
              {searchResults.songs.slice(0, 4).map((track, idx) => (
                <TrackListRow
                  key={track.id}
                  track={track}
                  index={idx}
                  queueContext={[track]}
                />
              ))}
            </div>
          </section>
        </div>
      ) : (
        (searchScope === 'Artistas' || searchScope === 'Canciones') &&
        bestResult && (
          <section className="space-y-2.5">
            <h2 className="text-[18px] font-bold pm-text-primary">
              Mejor resultado
            </h2>
            <div
              data-testid="best-result-card"
              data-surface="content"
              className="pm-surface-card flex flex-wrap items-center justify-between gap-4 rounded-[16px] p-5"
            >
              {bestResult.kind === 'artist' ? (
                <>
                  <div className="flex items-center gap-4">
                    <img
                      src={bestResult.item.thumbnailUrl}
                      alt={bestResult.item.name}
                      className="h-20 w-20 rounded-full object-cover"
                    />
                    <div>
                      <span className="pm-elevated inline-block rounded-md border pm-border px-2.5 py-0.5 text-[11px] font-semibold pm-text-secondary">
                        ARTISTA
                      </span>
                      <h3 className="mt-1 text-xl font-bold pm-text-primary">
                        {bestResult.item.name}
                      </h3>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      void openArtistDetail(bestResult.item.id, {
                        name: bestResult.item.name,
                        thumbnailUrl: bestResult.item.thumbnailUrl,
                      })
                    }
                    className="pm-btn-primary rounded-full px-5 py-2 text-xs font-bold"
                  >
                    Ver perfil
                  </button>
                </>
              ) : (
                bestResult.kind === 'song' && (
                  <>
                    <div className="flex items-center gap-4">
                      <img
                        src={bestResult.item.thumbnailUrl}
                        alt={bestResult.item.title}
                        className="h-20 w-20 rounded-[10px] object-cover"
                      />
                      <div>
                        <span className="pm-elevated inline-block rounded-md border pm-border px-2.5 py-0.5 text-[11px] font-semibold pm-text-secondary">
                          CANCIÓN
                        </span>
                        <h3 className="mt-1 text-xl font-bold pm-text-primary">
                          {bestResult.item.title}
                        </h3>
                        <div className="truncate text-xs pm-text-secondary">
                          <ArtistLinks
                            artists={bestResult.item.artists}
                            linkClassName="hover:underline hover:text-[var(--pm-text-primary)]"
                          />
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        void playTrack(bestResult.item, [bestResult.item])
                      }
                      className="pm-btn-primary rounded-full px-5 py-2 text-xs font-bold"
                    >
                      Reproducir
                    </button>
                  </>
                )
              )}
            </div>
          </section>
        )
      )}

      {/* Full Songs List in Canciones tab OR remaining songs in Todo */}
      {searchScope === 'Canciones' && (
        <section className="space-y-2">
          <h2 className="text-[18px] font-bold pm-text-primary">
            Todas las canciones
          </h2>
          <div className="space-y-0.5">
            {searchResults.songs.map((track, idx) => (
              <TrackListRow
                key={track.id}
                track={track}
                index={idx}
                queueContext={[track]}
              />
            ))}
          </div>
        </section>
      )}

      {searchScope === 'Todo' && searchResults.songs.length > 4 && (
        <section className="space-y-2">
          <h2 className="text-[18px] font-bold pm-text-primary">
            Más resultados
          </h2>
          <div className="grid grid-cols-1 gap-x-6 md:grid-cols-2">
            {searchResults.songs.slice(4, 16).map((track, idx) => (
              <TrackListRow
                key={track.id}
                track={track}
                index={idx + 4}
                queueContext={[track]}
              />
            ))}
          </div>
        </section>
      )}

      {/* Artists Carousel / Grid */}
      {(searchScope === 'Todo' || searchScope === 'Artistas') &&
        searchResults.artists.length > 0 && (
          <CarouselSection title="Artistas">
            {searchResults.artists.map((artist) => (
              <CoverCard
                key={artist.id}
                image={artist.thumbnailUrl}
                title={artist.name}
                subtitle={artist.subscribersText ?? 'Artista'}
                round
                onOpen={() => {
                  addRecentSearchArtist({
                    id: artist.id,
                    name: artist.name,
                    thumbnailUrl: artist.thumbnailUrl,
                  });
                  void openArtistDetail(artist.id, {
                    name: artist.name,
                    thumbnailUrl: artist.thumbnailUrl,
                  });
                }}
              />
            ))}
          </CarouselSection>
        )}

      {/* Albums Carousel */}
      {(searchScope === 'Todo' || searchScope === 'Álbumes') &&
        searchResults.albums.length > 0 && (
          <CarouselSection title="Álbumes">
            {searchResults.albums.map((album) => (
              <CoverCard
                key={album.id}
                image={album.thumbnailUrl}
                title={album.title}
                subtitleNode={
                  <span>
                    {album.year ? `${album.year} · ` : ''}
                    <ArtistLinks
                      artists={album.artists}
                      linkClassName="hover:underline hover:text-[var(--pm-text-primary)]"
                    />
                  </span>
                }
                onOpen={() =>
                  void openAlbumDetail(album.id, {
                    title: album.title,
                    artist: album.artists?.[0]?.name,
                  })
                }
              />
            ))}
          </CarouselSection>
        )}

      {/* Playlists Carousel */}
      {(searchScope === 'Todo' || searchScope === 'Playlists') &&
        searchResults.playlists.length > 0 && (
          <CarouselSection title="Playlists">
            {searchResults.playlists.map((pl) => (
              <CoverCard
                key={pl.id}
                image={pl.thumbnailUrl}
                title={pl.title}
                subtitle={`${pl.author ?? 'pMusic'} · ${pl.trackCount ?? 0} canciones`}
                onOpen={() => void openPlaylistDetail(pl.id)}
              />
            ))}
          </CarouselSection>
        )}
    </div>
  );
});
SearchScreen.displayName = 'SearchScreen';

export const LibraryScreen: React.FC = React.memo(() => {
  const {
    libraryCategory,
    libraryFilterQuery,
    playlists,
    sharedPlaylists,
    playlistAppearances,
    likedTracks,
    favoriteArtists,
    playHistory,
    offlineEntries,
    searchResults,
    setLibraryCategory,
    setLibraryFilterQuery,
    createPlaylist,
    addTrackToPlaylist,
    openLocalPlaylistDetail,
    openSharedPlaylistDetail,
    openPlaylistContextMenu,
    openArtistDetail,
    toggleFavoriteArtist,
    setImportModalOpen,
    setActiveTab,
    setSocialSubTab,
    removeOfflineTrack,
    playTrack,
    playCollection,
    recordPlaylistPlay,
    showToast,
  } = usePMusicStore(
    useShallow((s) => ({
      libraryCategory: s.libraryCategory,
      libraryFilterQuery: s.libraryFilterQuery,
      playlists: s.playlists,
      sharedPlaylists: s.sharedPlaylists,
      playlistAppearances: s.playlistAppearances,
      likedTracks: s.likedTracks,
      favoriteArtists: s.favoriteArtists,
      playHistory: s.playHistory,
      offlineEntries: s.offlineEntries,
      searchResults: s.searchResults,
      setLibraryCategory: s.setLibraryCategory,
      setLibraryFilterQuery: s.setLibraryFilterQuery,
      createPlaylist: s.createPlaylist,
      addTrackToPlaylist: s.addTrackToPlaylist,
      openLocalPlaylistDetail: s.openLocalPlaylistDetail,
      openSharedPlaylistDetail: s.openSharedPlaylistDetail,
      openPlaylistContextMenu: s.openPlaylistContextMenu,
      openArtistDetail: s.openArtistDetail,
      toggleFavoriteArtist: s.toggleFavoriteArtist,
      setImportModalOpen: s.setImportModalOpen,
      setActiveTab: s.setActiveTab,
      setSocialSubTab: s.setSocialSubTab,
      removeOfflineTrack: s.removeOfflineTrack,
      playTrack: s.playTrack,
      playCollection: s.playCollection,
      recordPlaylistPlay: s.recordPlaylistPlay,
      showToast: s.showToast,
    }))
  );

  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [showCreateBar, setShowCreateBar] = useState(false);
  const [showMobileFilter, setShowMobileFilter] = useState(false);
  const [dragOverPlaylistId, setDragOverPlaylistId] = useState<string | null>(null);

  const categories: readonly LibraryCategoryTab[] = [
    'Todo',
    'Playlists',
    'Artistas',
    'Me gusta',
    'Descargas',
    'Historial',
  ];

  const filterNorm = libraryFilterQuery.trim().toLowerCase();

  const filteredPlaylists = playlists.filter(
    (p) => !filterNorm || p.name.toLowerCase().includes(filterNorm)
  );
  const filteredSharedPlaylists = sharedPlaylists.filter(
    (sp) =>
      (!sp.shareCode ||
        !playlists.some((lp) => lp.shareCode?.toUpperCase() === sp.shareCode?.toUpperCase())) &&
      (!filterNorm || sp.name.toLowerCase().includes(filterNorm))
  );
  const totalUnifiedPlaylistCount = filteredPlaylists.length + filteredSharedPlaylists.length;
  const filteredLikes = likedTracks.filter(
    (l) =>
      !filterNorm ||
      l.track.title.toLowerCase().includes(filterNorm) ||
      l.track.artists.some((a) => a.name.toLowerCase().includes(filterNorm))
  );

  return (
    <div className="pm-page-enter space-y-5 sm:space-y-6">
      {/* Clean pMusic Library Header */}
      <div className="flex items-center justify-between gap-2.5">
        <div className="min-w-0">
          <h1 className="text-[28px] font-black tracking-tight pm-text-primary sm:text-[30px]">
            Biblioteca
          </h1>
          <p className="hidden text-[13px] pm-text-tertiary sm:block">
            Colección sincronizada entre tu móvil Android y tu PC Windows
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          <button
            type="button"
            aria-label="Buscar en biblioteca"
            onClick={() => setShowMobileFilter((v) => !v)}
            className={`pm-pressable inline-flex h-9 w-9 items-center justify-center rounded-full sm:hidden ${
              showMobileFilter || libraryFilterQuery ? 'pm-btn-primary' : 'pm-btn-secondary'
            }`}
          >
            <Search className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label="Nueva playlist"
            onClick={() => setShowCreateBar((v) => !v)}
            className="pm-btn-secondary pm-pressable inline-flex h-9 w-9 items-center justify-center rounded-full sm:hidden"
          >
            <Plus className="h-4 w-4" />
          </button>
          <button
            type="button"
            data-testid="library-my-top-btn"
            aria-label="Mi Top semanal y mensual"
            onClick={() => {
              setActiveTab('Social');
              setSocialSubTab('top');
            }}
            className="pm-btn-secondary pm-pressable inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-xs font-bold sm:h-auto sm:px-4 sm:py-2"
          >
            <Sparkles className="h-3.5 w-3.5" />
            <span>Mi Top</span>
          </button>
          <button
            type="button"
            aria-label="Importar playlist"
            onClick={() => setImportModalOpen(true)}
            className="pm-btn-primary pm-pressable inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-xs font-bold sm:h-auto sm:px-5 sm:py-2"
          >
            <ListMusic className="h-4 w-4" />
            <span className="sm:hidden">Importar</span>
            <span className="hidden sm:inline">Importar playlist</span>
          </button>
        </div>
      </div>

      {/* Category Pills & Search Filter */}
      <div className="flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-3">
        <div
          role="tablist"
          aria-label="Categorías de biblioteca"
          className="flex w-full flex-nowrap gap-1.5 overflow-x-auto pb-0.5 pm-no-scrollbar sm:w-auto sm:flex-wrap sm:overflow-visible sm:pb-0"
        >
          {categories.map((cat) => {
            const active = libraryCategory === cat;
            return (
              <button
                key={cat}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setLibraryCategory(cat)}
                className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-bold transition-colors sm:px-4 ${
                  active ? 'pm-btn-primary' : 'pm-btn-secondary'
                }`}
              >
                {cat}
              </button>
            );
          })}
        </div>

        <div
          className={`pm-input w-full items-center gap-2 rounded-full px-3.5 py-1.5 sm:flex sm:w-56 ${
            showMobileFilter || libraryFilterQuery ? 'flex' : 'hidden'
          }`}
        >
          <Search className="h-3.5 w-3.5 shrink-0 pm-text-tertiary" />
          <input
            type="search"
            aria-label="Filtrar en biblioteca"
            placeholder="Filtrar en tu biblioteca..."
            value={libraryFilterQuery}
            onChange={(e) => setLibraryFilterQuery(e.target.value)}
            className="pm-text-btn w-full bg-transparent text-xs pm-text-primary placeholder:pm-text-tertiary focus:outline-none"
          />
          {libraryFilterQuery && (
            <button
              type="button"
              aria-label="Limpiar filtro"
              onClick={() => setLibraryFilterQuery('')}
              className="pm-compact-btn pm-text-tertiary hover:text-[var(--pm-text-primary)]"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Create New Playlist Quick Bar */}
      {(libraryCategory === 'Todo' || libraryCategory === 'Playlists') && (
        <div
          data-surface="content"
          className={`pm-surface-card items-center gap-2 rounded-[16px] p-3 sm:gap-2.5 sm:p-3.5 ${
            showCreateBar ? 'flex' : 'hidden sm:flex'
          }`}
        >
          <input
            type="text"
            aria-label="Nombre de la nueva playlist"
            placeholder="Nueva playlist (ej. Sesión Canarias)..."
            value={newPlaylistName}
            onChange={(e) => setNewPlaylistName(e.target.value)}
            className="pm-input min-w-0 flex-1 rounded-full px-4 py-2 text-xs"
          />
          <button
            type="button"
            onClick={async () => {
              const name = newPlaylistName.trim() || `Mi Playlist #${playlists.length + 1}`;
              const created = await createPlaylist(name, '', []);
              setNewPlaylistName('');
              setShowCreateBar(false);
              showToast(`Playlist «${created.name}» creada`);
            }}
            className="pm-btn-primary inline-flex shrink-0 items-center gap-1.5 rounded-full px-4 py-2 text-xs font-bold"
          >
            <Plus className="h-4 w-4" />
            <span>Crear playlist</span>
          </button>
        </div>
      )}

      {/* Pinned Liked Songs Summary Tile */}
      {libraryCategory === 'Todo' && likedTracks.length > 0 && !filterNorm && (
        <div
          data-surface="content"
          role="button"
          tabIndex={0}
          onClick={() => setLibraryCategory('Me gusta')}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setLibraryCategory('Me gusta');
            }
          }}
          className="pm-hover flex cursor-pointer items-center justify-between gap-3 rounded-[14px] bg-white/[0.03] px-2.5 py-2.5 sm:px-3.5 sm:py-3"
        >
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[11px] bg-gradient-to-br from-rose-500/85 to-purple-600/85 text-white shadow-md sm:h-13 sm:w-13">
              <Heart className="h-5 w-5 fill-current" />
            </div>
            <div className="min-w-0">
              <div className="truncate text-[15px] font-bold pm-text-primary">
                Tus Me gusta
              </div>
              <div className="text-xs pm-text-tertiary">
                {likedTracks.length} {likedTracks.length === 1 ? 'canción' : 'canciones'}
              </div>
            </div>
          </div>
          <button
            type="button"
            aria-label="Reproducir Me gusta"
            onClick={(e) => {
              e.stopPropagation();
              const list = likedTracks.map((l) => l.track);
              if (list.length > 0) void playCollection(list, { isPlaylist: true });
            }}
            className="pm-btn-primary pm-pressable inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full shadow-md"
          >
            <Play className="h-4 w-4 translate-x-[1px] fill-current" />
          </button>
        </div>
      )}

      {/* Playlists Section (Clean compact mobile list, rich 2-col desktop grid) */}
      {(libraryCategory === 'Todo' || libraryCategory === 'Playlists') && (
        <section className="space-y-2.5">
          <div className="flex items-center justify-between">
            <h2 className="text-[17px] font-bold pm-text-primary sm:text-[18px]">
              Tus Playlists ({totalUnifiedPlaylistCount})
            </h2>
          </div>
          {totalUnifiedPlaylistCount > 0 ? (
            <div className="grid grid-cols-1 gap-1 sm:grid-cols-2 sm:gap-3">
              {filteredSharedPlaylists.map((sp) => {
                const spApp = playlistAppearances[sp.id];
                const thumb =
                  spApp?.coverUrl ??
                  sp.coverUrl ??
                  sp.tracks[0]?.thumbnailUrl ??
                  generatePlaylistCoverDataUrl(sp.name, spApp?.coverStyleSeed ?? 0);
                const spDur = formatPlaylistDuration(
                  sp.tracks.reduce((acc, t) => acc + (t.durationSec || 0), 0)
                );
                return (
                  <article
                    key={`lib-sp-${sp.id}`}
                    data-surface="content"
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      openPlaylistContextMenu('shared', sp.id, e.clientX, e.clientY);
                    }}
                    onClick={() => openSharedPlaylistDetail(sp.id)}
                    className="pm-hover sm:pm-surface-card relative flex cursor-pointer items-center justify-between gap-3 rounded-[12px] px-2 py-2 transition-all sm:rounded-[14px] sm:p-3.5"
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <img
                        src={thumb}
                        alt={sp.name}
                        className="h-12 w-12 shrink-0 rounded-[10px] object-cover shadow-sm sm:h-13 sm:w-13"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <h3 className="truncate text-[15px] font-bold leading-tight pm-text-primary">
                            {sp.name}
                          </h3>
                          <span className="shrink-0 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
                            {sp.kind === 'blend' ? 'Blend' : 'Colaborativa'}
                          </span>
                        </div>
                        <p className="mt-0.5 truncate text-xs pm-text-tertiary">
                          {sp.tracks.length} {sp.tracks.length === 1 ? 'pista' : 'pistas'}
                          {spDur ? ` · ${spDur}` : ''}
                        </p>
                      </div>
                    </div>
                    <div
                      className="flex shrink-0 items-center gap-1"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {sp.tracks.length > 0 && (
                        <button
                          type="button"
                          aria-label={`Reproducir ${sp.name}`}
                          onClick={() => void playCollection(sp.tracks, { isPlaylist: true })}
                          className="pm-btn-secondary pm-pressable hidden h-9 w-9 shrink-0 items-center justify-center rounded-full sm:inline-flex"
                        >
                          <Play className="h-3.5 w-3.5 translate-x-[1px] fill-current" />
                        </button>
                      )}
                      <button
                        type="button"
                        aria-label={`Opciones de ${sp.name}`}
                        onClick={(e) => {
                          const r = e.currentTarget.getBoundingClientRect();
                          openPlaylistContextMenu('shared', sp.id, r.right - 260, r.bottom + 8);
                        }}
                        className="pm-hover pm-pressable inline-flex h-9 w-9 items-center justify-center rounded-full pm-text-tertiary hover:text-[var(--pm-text-primary)]"
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </button>
                    </div>
                  </article>
                );
              })}
              {filteredPlaylists.map((pl) => {
                const plApp = playlistAppearances[pl.id];
                const thumb =
                  plApp?.coverUrl ??
                  pl.coverUrl ??
                  pl.tracks[0]?.thumbnailUrl ??
                  generatePlaylistCoverDataUrl(pl.name, plApp?.coverStyleSeed ?? pl.coverStyleSeed ?? 0);
                const plDur = formatPlaylistDuration(
                  pl.tracks.reduce((acc, t) => acc + (t.durationSec || 0), 0)
                );
                const isDropTarget = dragOverPlaylistId === pl.id;
                return (
                  <article
                    key={pl.id}
                    data-surface="content"
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'copy';
                      setDragOverPlaylistId(pl.id);
                    }}
                    onDragLeave={() => {
                      if (dragOverPlaylistId === pl.id) setDragOverPlaylistId(null);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDragOverPlaylistId(null);
                      const dropped = readTrackFromDropEvent(e);
                      if (dropped) {
                        void addTrackToPlaylist(pl.id, dropped);
                      }
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      openPlaylistContextMenu('local', pl.id, e.clientX, e.clientY);
                    }}
                    onClick={() => openLocalPlaylistDetail(pl.id)}
                    className={`pm-hover sm:pm-surface-card relative flex cursor-pointer items-center justify-between gap-3 rounded-[12px] px-2 py-2 transition-all sm:rounded-[14px] sm:p-3.5 ${
                      isDropTarget
                        ? 'pm-active-row ring-2 ring-[var(--pm-accent-primary)]'
                        : ''
                    }`}
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <img
                        src={thumb}
                        alt={pl.name}
                        className="h-12 w-12 shrink-0 rounded-[10px] object-cover shadow-sm sm:h-13 sm:w-13"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <h3 className="truncate text-[15px] font-bold leading-tight pm-text-primary">
                            {pl.name}
                          </h3>
                          {pl.isCollaborative && (
                            <span className="shrink-0 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
                              Colaborativa
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 truncate text-xs pm-text-tertiary">
                          {pl.tracks.length} {pl.tracks.length === 1 ? 'pista' : 'pistas'}
                          {plDur ? ` · ${plDur}` : ''}
                        </p>
                      </div>
                    </div>

                    <div
                      className="relative flex shrink-0 items-center gap-1"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {pl.tracks.length > 0 && (
                        <button
                          type="button"
                          aria-label={`Reproducir ${pl.name}`}
                          onClick={() => {
                            if (pl.tracks.length > 0) {
                              recordPlaylistPlay(pl);
                              void playCollection(pl.tracks, { isPlaylist: true });
                            }
                          }}
                          className="pm-btn-secondary pm-pressable hidden h-9 w-9 items-center justify-center rounded-full sm:inline-flex"
                        >
                          <Play className="h-3.5 w-3.5 translate-x-[1px] fill-current" />
                        </button>
                      )}
                      <button
                        type="button"
                        aria-label={`Opciones de ${pl.name}`}
                        onClick={(e) => {
                          const r = e.currentTarget.getBoundingClientRect();
                          openPlaylistContextMenu('local', pl.id, r.right - 260, r.bottom + 8);
                        }}
                        className="pm-hover pm-pressable inline-flex h-9 w-9 items-center justify-center rounded-full pm-text-tertiary hover:text-[var(--pm-text-primary)]"
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <p className="text-xs pm-text-tertiary">
              Aún no has creado playlists personalizadas. Toca «Nueva» o importa desde Spotify/YouTube.
            </p>
          )}
        </section>
      )}

      {/* Favorite Artists Section (hidden in Todo when empty) */}
      {(libraryCategory === 'Artistas' ||
        (libraryCategory === 'Todo' && favoriteArtists.length > 0)) && (
        <section className="space-y-2.5">
          <h2 className="text-[18px] font-bold pm-text-primary">
            Artistas favoritos ({favoriteArtists.length})
          </h2>
          {favoriteArtists.length > 0 ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {favoriteArtists
                .filter(
                  (a) => !filterNorm || a.artistName.toLowerCase().includes(filterNorm)
                )
                .map((fa) => (
                  <div
                    key={fa.artistId}
                    data-surface="content"
                    onClick={() =>
                      void openArtistDetail(fa.artistId, {
                        name: fa.artistName,
                        thumbnailUrl: fa.thumbnailUrl,
                      })
                    }
                    className="pm-surface-card pm-card-lift flex cursor-pointer items-center justify-between gap-2.5 rounded-[14px] p-3"
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      {fa.thumbnailUrl ? (
                        <img
                          src={fa.thumbnailUrl}
                          alt={fa.artistName}
                          className="h-11 w-11 shrink-0 rounded-full object-cover"
                        />
                      ) : (
                        <div className="pm-elevated flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-bold pm-text-primary">
                          {fa.artistName.slice(0, 1).toUpperCase()}
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="truncate text-xs font-bold pm-text-primary">
                          {fa.artistName}
                        </div>
                        <div className="text-[10.5px] pm-text-tertiary">Artista favorito</div>
                      </div>
                    </div>
                    <button
                      type="button"
                      aria-label={`Quitar ${fa.artistName} de favoritos`}
                      onClick={(e) => {
                        e.stopPropagation();
                        void toggleFavoriteArtist({
                          id: fa.artistId,
                          name: fa.artistName,
                          thumbnailUrl: fa.thumbnailUrl,
                        });
                      }}
                      className="rounded-full p-1.5 text-rose-400 hover:bg-rose-500/15"
                    >
                      <Heart className="h-3.5 w-3.5 fill-current" />
                    </button>
                  </div>
                ))}
            </div>
          ) : (
            <p className="text-xs pm-text-tertiary">
              Pulsa «Me gusta» en el perfil de cualquier artista para ver sus temas recomendados
              aquí y en tus mixes diarios.
            </p>
          )}
        </section>
      )}

      {/* Liked Tracks Section */}
      {(libraryCategory === 'Me gusta' ||
        (libraryCategory === 'Todo' && filteredLikes.length > 0)) && (
        <section className="space-y-2.5">
          <h2 className="text-[18px] font-bold pm-text-primary">
            Canciones que te gustan ({filteredLikes.length})
          </h2>
          {filteredLikes.length > 0 ? (
            <div className="space-y-0.5">
              {filteredLikes.map((item, idx) => (
                <TrackListRow
                  key={item.trackId}
                  track={item.track}
                  index={idx}
                  queueContext={filteredLikes.map((l) => l.track)}
                />
              ))}
            </div>
          ) : (
            <p className="text-xs pm-text-tertiary">
              Pulsa el icono del corazón en cualquier canción para guardarla aquí.
            </p>
          )}
        </section>
      )}

      {/* Offline Downloads Section */}
      {(libraryCategory === 'Descargas' ||
        (libraryCategory === 'Todo' && offlineEntries.length > 0)) && (
        <section className="space-y-2.5">
          <h2 className="text-[18px] font-bold pm-text-primary">
            En este dispositivo · Offline ({offlineEntries.length})
          </h2>
          {offlineEntries.length > 0 ? (
            <div className="space-y-1.5">
              {offlineEntries.map((entry) => {
                const track =
                  searchResults.songs.find((s) => s.id === entry.trackId) ??
                  likedTracks.find((l) => l.trackId === entry.trackId)?.track ??
                  playHistory.find((h) => h.track.id === entry.trackId)?.track;
                return (
                  <div
                    key={entry.trackId}
                    data-surface="content"
                    className="pm-surface-card flex items-center justify-between gap-3 rounded-[10px] p-3"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        if (track) void playTrack(track);
                      }}
                      className="min-w-0 flex-1 text-left"
                    >
                      <div className="truncate text-sm font-semibold pm-text-primary">
                        {track?.title ?? entry.trackId}
                      </div>
                      <div className="text-xs pm-text-tertiary">
                        Disponible sin conexión ·{' '}
                        {entry.sizeBytes > 1024 * 1024
                          ? `${(entry.sizeBytes / (1024 * 1024)).toFixed(1)} MB`
                          : `${(entry.sizeBytes / 1024).toFixed(0)} KB`}
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => void removeOfflineTrack(entry.trackId)}
                      className="pm-btn-secondary rounded-full px-3.5 py-1.5 text-xs font-semibold text-rose-500"
                    >
                      Borrar
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-xs pm-text-tertiary">
              Descarga canciones con el icono de flecha para escucharlas sin conexión.
            </p>
          )}
        </section>
      )}

      {/* Listening History Section */}
      {(libraryCategory === 'Historial' ||
        (libraryCategory === 'Todo' && playHistory.length > 0)) && (
        <section className="space-y-2.5">
          <h2 className="text-[18px] font-bold pm-text-primary">
            Historial reciente ({playHistory.length})
          </h2>
          {playHistory.length > 0 ? (
            <div className="space-y-0.5">
              {playHistory.slice(0, 12).map((h, idx) => (
                <TrackListRow key={h.id} track={h.track} index={idx} />
              ))}
            </div>
          ) : (
            <p className="text-xs pm-text-tertiary">
              Tu historial alimenta automáticamente las recomendaciones.
            </p>
          )}
        </section>
      )}
    </div>
  );
});
LibraryScreen.displayName = 'LibraryScreen';
