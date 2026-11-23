import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Disc3,
  Download,
  GripVertical,
  Heart,
  ListMusic,
  ListPlus,
  Loader2,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Search,
  Share2,
  Trash2,
  X,
} from 'lucide-react';
import { formatDurationSec, type Track } from '@pmusic/core';
import {
  usePMusicStore,
  type LibraryCategoryTab,
  type SearchScopeTab,
} from '../store/usePMusicStore.ts';
import {
  clearDraggedTrack,
  getDraggedSource,
  readTrackFromDropEvent,
  setDraggedTrack,
} from '../utils/track-dnd.ts';
import { ArtistLinks } from './ArtistLinks.tsx';

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

export const TrackListRow: React.FC<{
  track: Track;
  index?: number;
  queueContext?: Track[];
  playlistId?: string;
  onDropReorder?: (fromIndex: number, toIndex: number) => void;
}> = ({ track, index, queueContext, playlistId, onDropReorder }) => {
  const {
    currentTrack,
    isPlaying,
    likedTracks,
    offlineDownloads,
    playTrack,
    togglePlayPause,
    toggleLike,
    downloadTrackOffline,
    addToQueue,
    removeTrackFromPlaylist,
    openTrackMenu,
  } = usePMusicStore();

  const [dragOver, setDragOver] = useState(false);

  const isCurrent = currentTrack.id === track.id;
  const isLiked = likedTracks.some((l) => l.trackId === track.id);
  const dlStatus = offlineDownloads[track.id] ?? 'idle';

  const handleRowPlay = () => {
    if (isCurrent) {
      void togglePlayPause();
    } else {
      void playTrack(track, queueContext);
    }
  };

  return (
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
      } ${dragOver ? 'border-t-2 border-[var(--pm-accent-primary)] pm-active-row' : ''}`}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
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
          <img
            src={track.thumbnailUrl}
            alt={track.title}
            loading="lazy"
            className="h-full w-full object-cover"
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
              className={`truncate text-left text-[14px] hover:underline pm-text-primary ${
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
          <div className="flex min-w-0 items-center gap-1.5 overflow-hidden text-[12.5px] leading-normal pm-text-secondary">
            <ArtistLinks
              artists={track.artists}
              className="min-w-0 shrink-0 max-w-[75%]"
              linkClassName="hover:underline hover:text-[var(--pm-text-primary)]"
            />
            {track.album && (
              <span className="hidden min-w-0 flex-1 truncate leading-normal pm-text-tertiary lg:inline">
                · {track.album.name}
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
          <Heart className={`h-4 w-4 ${isLiked ? 'fill-current' : ''}`} />
        </button>

        <button
          type="button"
          aria-label={
            dlStatus === 'downloaded'
              ? `${track.title} descargada offline`
              : `Descargar ${track.title} offline`
          }
          onClick={() => void downloadTrackOffline(track)}
          className="hidden items-center justify-center rounded-full p-2 pm-text-tertiary hover:bg-[var(--pm-hover-tint)] hover:text-[var(--pm-text-primary)] md:flex"
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
  );
};

const CoverCard: React.FC<{
  image: string;
  title: string;
  subtitle?: string;
  subtitleNode?: React.ReactNode;
  badge?: string;
  round?: boolean;
  dragTrack?: Track;
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
      className="pm-cover-card pm-card-lift pm-surface-card group w-[144px] shrink-0 snap-start rounded-[14px] p-2.5 sm:w-[166px] sm:rounded-[12px] md:w-[178px]"
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
            src={image}
            alt={title}
            loading="lazy"
            className={`pm-elevated aspect-square w-full object-cover shadow-[0_10px_24px_rgba(0,0,0,0.42)] ring-1 ring-white/[0.08] transition-transform duration-300 ease-out group-hover:scale-[1.04] ${
              round ? 'rounded-full' : 'rounded-[12px] sm:rounded-[8px]'
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
      <div className={`mt-2 sm:mt-2.5 ${round ? 'text-center' : ''}`}>
        <button
          type="button"
          onClick={onOpen}
          className="block w-full truncate text-left text-[14px] font-semibold pm-text-primary hover:underline"
        >
          <span className={round ? 'block text-center' : ''}>{title}</span>
        </button>
        {subtitleNode ? (
          <div className="mt-0.5 truncate text-[12px] leading-normal pm-text-secondary">
            {subtitleNode}
          </div>
        ) : subtitle ? (
          <div className="mt-0.5 line-clamp-2 text-[12px] leading-normal pm-text-tertiary">
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

export const DetailViewPanel: React.FC = () => {
  const {
    activeDetailView,
    playlists,
    searchResults,
    playTrack,
    toggleDjMode,
    renamePlaylist,
    deletePlaylist,
    duplicatePlaylist,
    copyPlaylistTracksTo,
    addTrackToPlaylist,
    reorderPlaylistTrack,
    searchTracksForPlaylist,
    openAlbumDetail,
    openArtistDetail,
    openLocalPlaylistDetail,
    showToast,
  } = usePMusicStore();

  const [isEditingName, setIsEditingName] = useState(false);
  const [editingName, setEditingName] = useState('');
  const [plMenuOpen, setPlMenuOpen] = useState(false);
  const [showCopyTargetMenu, setShowCopyTargetMenu] = useState(false);
  const [confirmDeletePl, setConfirmDeletePl] = useState(false);
  const [addFinderOverride, setAddFinderOverride] = useState<boolean | null>(null);
  const [playlistDropActive, setPlaylistDropActive] = useState(false);
  const [addSearchQuery, setAddSearchQuery] = useState('');
  const [addSearchResults, setAddSearchResults] = useState<Track[]>([]);
  const [isSearchingAdd, setIsSearchingAdd] = useState(false);

  if (!activeDetailView) return null;

  if (activeDetailView.kind === 'artist') {
    const { artist, description, topSongs, albums, relatedArtists } =
      activeDetailView.data;
    const popularSongs = topSongs.slice(0, 10);
    return (
      <div className="pm-page-enter space-y-8">
        <section
          data-surface="content"
          className="pm-surface-card flex flex-col gap-6 rounded-[18px] p-6 sm:flex-row sm:items-end"
        >
          <img
            src={artist.thumbnailUrl}
            alt={artist.name}
            className="h-36 w-36 shrink-0 rounded-full object-cover shadow-[0_18px_48px_rgba(0,0,0,0.65)] sm:h-44 sm:w-44"
          />
          <div className="min-w-0 flex-1 space-y-2">
            <span className="pm-elevated inline-block rounded-md border pm-border px-2.5 py-1 text-[11px] font-semibold tracking-wide pm-text-secondary">
              ARTISTA
            </span>
            <h1 className="truncate text-3xl font-bold tracking-tight pm-text-primary md:text-5xl">
              {artist.name}
            </h1>
            {(artist.subscribersText || description) && (
              <p className="text-sm pm-text-secondary">
                {artist.subscribersText ?? description}
              </p>
            )}
            <div className="flex flex-wrap gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => {
                  if (popularSongs[0]) void playTrack(popularSongs[0], popularSongs);
                }}
                className="pm-btn-primary inline-flex items-center gap-2 rounded-full px-6 py-2.5 text-xs font-bold"
              >
                <Play className="h-4 w-4 fill-current" />
                <span>Reproducir</span>
              </button>
              <button
                type="button"
                onClick={async () => {
                  await toggleDjMode(true);
                  if (popularSongs[0]) await playTrack(popularSongs[0], popularSongs);
                }}
                className="pm-btn-secondary inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-xs font-semibold"
              >
                <Disc3 className="h-4 w-4 text-purple-500" />
                <span>Sesión DJ {artist.name}</span>
              </button>
            </div>
          </div>
        </section>

        <section className="space-y-2">
          <h2 className="text-[20px] font-bold pm-text-primary">Populares</h2>
          <div className="space-y-0.5">
            {popularSongs.map((track, idx) => (
              <TrackListRow
                key={track.id}
                track={track}
                index={idx}
                queueContext={popularSongs}
              />
            ))}
          </div>
        </section>

        {albums.length > 0 && (
          <CarouselSection title="Discografía">
            {albums.map((al) => (
              <CoverCard
                key={al.id}
                image={al.thumbnailUrl}
                title={al.title}
                subtitle={String(al.year ?? '')}
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

        {relatedArtists && relatedArtists.length > 0 && (
          <CarouselSection title="Artistas similares">
            {relatedArtists.map((rel) => (
              <CoverCard
                key={rel.id}
                image={rel.thumbnailUrl}
                title={rel.name}
                subtitle={rel.subscribersText ?? 'Artista'}
                round
                onOpen={() => void openArtistDetail(rel.id)}
              />
            ))}
          </CarouselSection>
        )}
      </div>
    );
  }

  if (activeDetailView.kind === 'album') {
    const { album, tracks } = activeDetailView.data;
    return (
      <div className="pm-page-enter space-y-7">
        <section
          data-surface="content"
          className="pm-surface-card flex flex-col gap-6 rounded-[18px] p-6 sm:flex-row sm:items-end"
        >
          <img
            src={album.thumbnailUrl}
            alt={album.title}
            className="h-40 w-40 shrink-0 rounded-[12px] object-cover shadow-[0_18px_48px_rgba(0,0,0,0.45)] sm:h-44 sm:w-44"
          />
          <div className="min-w-0 flex-1 space-y-2">
            <span className="pm-elevated inline-block rounded-md border pm-border px-2.5 py-1 text-[11px] font-semibold pm-text-secondary">
              ÁLBUM {album.year ? `· ${album.year}` : ''} · {tracks.length}{' '}
              CANCIONES
            </span>
            <h1 className="truncate text-3xl font-bold tracking-tight pm-text-primary md:text-4xl">
              {album.title}
            </h1>
            <div className="text-sm pm-text-secondary">
              <ArtistLinks
                artists={album.artists}
                singleLine={false}
                linkClassName="hover:underline hover:text-[var(--pm-text-primary)]"
              />
            </div>
            <div className="flex flex-wrap gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => {
                  if (tracks[0]) void playTrack(tracks[0], tracks);
                }}
                className="pm-btn-primary inline-flex items-center gap-2 rounded-full px-6 py-2.5 text-xs font-bold"
              >
                <Play className="h-4 w-4 fill-current" />
                <span>Reproducir álbum</span>
              </button>
              <button
                type="button"
                onClick={async () => {
                  await toggleDjMode(true);
                  if (tracks[0]) await playTrack(tracks[0], tracks);
                }}
                className="pm-btn-secondary inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-xs font-semibold"
              >
                <Disc3 className="h-4 w-4 text-purple-500" />
                <span>Sesión DJ</span>
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
              queueContext={[t]}
            />
          ))}
        </div>
      </div>
    );
  }

  if (activeDetailView.kind === 'playlist') {
    const { playlist, tracks } = activeDetailView.data;
    return (
      <div className="pm-page-enter space-y-7">
        <section
          data-surface="content"
          className="pm-surface-card flex flex-col gap-6 rounded-[18px] p-6 sm:flex-row sm:items-end"
        >
          <img
            src={playlist.thumbnailUrl}
            alt={playlist.title}
            className="h-40 w-40 shrink-0 rounded-[12px] object-cover shadow-[0_18px_48px_rgba(0,0,0,0.45)] sm:h-44 sm:w-44"
          />
          <div className="min-w-0 flex-1 space-y-2">
            <span className="pm-elevated inline-block rounded-md border pm-border px-2.5 py-1 text-[11px] font-semibold pm-text-secondary">
              PLAYLIST · {tracks.length} CANCIONES
            </span>
            <h1 className="truncate text-3xl font-bold tracking-tight pm-text-primary md:text-4xl">
              {playlist.title}
            </h1>
            <p className="text-sm pm-text-secondary">
              {playlist.author ?? 'pMusic'}
            </p>
            <div className="flex flex-wrap gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => {
                  if (tracks[0]) void playTrack(tracks[0], tracks);
                }}
                className="pm-btn-primary inline-flex items-center gap-2 rounded-full px-6 py-2.5 text-xs font-bold"
              >
                <Play className="h-4 w-4 fill-current" />
                <span>Reproducir</span>
              </button>
              <button
                type="button"
                onClick={async () => {
                  await toggleDjMode(true);
                  if (tracks[0]) await playTrack(tracks[0], tracks);
                }}
                className="pm-btn-secondary inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-xs font-semibold"
              >
                <Disc3 className="h-4 w-4 text-purple-500" />
                <span>Sesión DJ AutoMix</span>
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
              queueContext={[t]}
            />
          ))}
        </div>
      </div>
    );
  }

  const localPl = playlists.find((p) => p.id === activeDetailView.playlistId);
  if (!localPl) return null;

  const suggestedAdds = (
    addSearchQuery.trim() ? addSearchResults : searchResults.songs.slice(0, 8)
  ).filter((t) => !localPl.tracks.some((ex) => ex.id === t.id));

  const otherPlaylists = playlists.filter((p) => p.id !== localPl.id);
  const totalPlDurationSec = localPl.tracks.reduce((acc, t) => acc + (t.durationSec || 0), 0);
  const totalPlMins = Math.max(0, Math.round(totalPlDurationSec / 60));
  const isAddFinderOpen = addFinderOverride ?? localPl.tracks.length < 3;

  const handleSharePlaylist = async () => {
    const trackLines = localPl.tracks
      .slice(0, 12)
      .map((t, i) => `${i + 1}. ${t.title} — ${t.artists.map((a) => a.name).join(', ')}`)
      .join('\n');
    const summary = `Playlist pMusic: ${localPl.name} (${localPl.tracks.length} pistas)\n${trackLines}`;
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
        await navigator.share({ title: localPl.name, text: summary });
      } else {
        await navigator.clipboard?.writeText(summary);
      }
      showToast('Playlist lista para compartir (copiada al portapapeles)');
    } catch {
      await navigator.clipboard?.writeText(summary).catch(() => {});
      showToast('Enlace y lista copiados al portapapeles');
    }
  };

  return (
    <div className="pm-page-enter space-y-6">
      <div
        data-surface="content"
        className="pm-surface-card relative rounded-[20px] p-4 sm:p-6"
      >
        <div className="flex flex-col gap-5">
          <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-end sm:gap-5">
            {localPl.coverUrl ?? localPl.tracks[0]?.thumbnailUrl ? (
              <img
                src={localPl.coverUrl ?? localPl.tracks[0]?.thumbnailUrl}
                alt={localPl.name}
                className="h-32 w-32 shrink-0 rounded-[14px] object-cover shadow-[0_18px_40px_rgba(0,0,0,0.45)] sm:h-40 sm:w-40"
              />
            ) : (
              <div className="pm-elevated flex h-32 w-32 shrink-0 items-center justify-center rounded-[14px] border pm-border text-3xl font-bold pm-text-secondary sm:h-40 sm:w-40">
                {localPl.name.slice(0, 1).toUpperCase()}
              </div>
            )}

            <div className="min-w-0 flex-1 space-y-2">
              <span className="pm-elevated inline-flex items-center gap-1.5 rounded-md border pm-border px-2.5 py-1 text-[11px] font-semibold pm-text-secondary">
                <span>TU PLAYLIST</span>
                <span aria-hidden="true">·</span>
                <span>{localPl.tracks.length} PISTAS</span>
                {totalPlMins > 0 && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>{totalPlMins} min</span>
                  </>
                )}
              </span>

              {isEditingName ? (
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
                <div className="flex items-center gap-2">
                  <h1 className="truncate text-3xl font-bold tracking-tight pm-text-primary sm:text-4xl">
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
              )}

              <p className="text-xs pm-text-secondary">
                {localPl.description || 'Playlist personal · Arrastra pistas para reordenar'}
              </p>
            </div>
          </div>

          {/* Interactive Playlist Action Toolbar */}
          <div className="relative flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                if (localPl.tracks[0]) {
                  void playTrack(localPl.tracks[0], localPl.tracks);
                }
              }}
              className="pm-btn-primary inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-xs font-bold"
            >
              <Play className="h-4 w-4 fill-current" />
              <span>Reproducir</span>
            </button>

            <button
              type="button"
              onClick={async () => {
                await toggleDjMode(true);
                if (localPl.tracks[0]) {
                  await playTrack(localPl.tracks[0], localPl.tracks);
                }
              }}
              className="pm-btn-secondary inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-xs font-semibold"
            >
              <Disc3 className="h-4 w-4 text-purple-500" />
              <span>Sesión DJ</span>
            </button>

            <button
              type="button"
              aria-label="Compartir playlist"
              onClick={() => void handleSharePlaylist()}
              className="pm-btn-secondary inline-flex items-center gap-1.5 rounded-full px-4 py-2.5 text-xs font-semibold"
            >
              <Share2 className="h-3.5 w-3.5" />
              <span>Compartir</span>
            </button>

            <button
              type="button"
              onClick={() => setAddFinderOverride(!isAddFinderOpen)}
              className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-2.5 text-xs font-semibold ${
                isAddFinderOpen ? 'pm-btn-primary' : 'pm-btn-secondary'
              }`}
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Añadir</span>
            </button>

            <div className="relative">
              <button
                type="button"
                data-testid="playlist-more-actions-btn"
                aria-label="Más acciones de playlist"
                aria-expanded={plMenuOpen}
                onClick={() => {
                  setPlMenuOpen(!plMenuOpen);
                  setShowCopyTargetMenu(false);
                  setConfirmDeletePl(false);
                }}
                className="pm-btn-secondary inline-flex h-9 w-9 items-center justify-center rounded-full"
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>

              {plMenuOpen && (
                <>
                  <div
                    aria-hidden="true"
                    onClick={() => setPlMenuOpen(false)}
                    className="fixed inset-0 z-40"
                  />
                  <div
                    role="menu"
                    data-testid="playlist-actions-menu"
                    className="pm-glass-liquid pm-menu-pop absolute left-0 top-11 z-50 w-64 rounded-[18px] p-1.5 shadow-2xl"
                    style={{
                      background:
                        'color-mix(in srgb, var(--pm-bg-surface) 92%, transparent)',
                    }}
                  >
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setPlMenuOpen(false);
                        setEditingName(localPl.name);
                        setIsEditingName(true);
                      }}
                      className="pm-hover pm-text-primary flex w-full items-center gap-2.5 rounded-[10px] px-3 py-2 text-left text-xs font-medium"
                    >
                      <Pencil className="h-4 w-4 pm-text-secondary" />
                      <span>Renombrar playlist</span>
                    </button>

                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => setShowCopyTargetMenu(!showCopyTargetMenu)}
                      className="pm-hover pm-text-primary flex w-full items-center justify-between rounded-[10px] px-3 py-2 text-left text-xs font-medium"
                    >
                      <span className="flex items-center gap-2.5">
                        <ListPlus className="h-4 w-4 pm-text-secondary" />
                        <span>Añadir a otra playlist</span>
                      </span>
                      <ChevronRight className="h-3.5 w-3.5 pm-text-tertiary" />
                    </button>

                    {showCopyTargetMenu && (
                      <div className="mx-1.5 my-1 max-h-40 space-y-0.5 overflow-y-auto rounded-[10px] border pm-border bg-black/20 p-1">
                        {otherPlaylists.length > 0 ? (
                          otherPlaylists.map((target) => (
                            <button
                              key={target.id}
                              type="button"
                              onClick={async () => {
                                await copyPlaylistTracksTo(localPl.id, target.id);
                                setPlMenuOpen(false);
                                setShowCopyTargetMenu(false);
                              }}
                              className="pm-hover pm-text-primary flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-[11.5px] font-medium"
                            >
                              <span className="truncate">{target.name}</span>
                              <span className="ml-2 shrink-0 text-[11px] pm-text-tertiary">
                                {target.tracks.length}
                              </span>
                            </button>
                          ))
                        ) : (
                          <div className="px-2.5 py-1.5 text-[11px] pm-text-tertiary">
                            Crea otra playlist primero
                          </div>
                        )}
                      </div>
                    )}

                    <button
                      type="button"
                      role="menuitem"
                      onClick={async () => {
                        setPlMenuOpen(false);
                        const dup = await duplicatePlaylist(localPl.id);
                        if (dup) openLocalPlaylistDetail(dup.id);
                      }}
                      className="pm-hover pm-text-primary flex w-full items-center gap-2.5 rounded-[10px] px-3 py-2 text-left text-xs font-medium"
                    >
                      <Copy className="h-4 w-4 pm-text-secondary" />
                      <span>Duplicar playlist</span>
                    </button>

                    <button
                      type="button"
                      role="menuitem"
                      onClick={async () => {
                        setPlMenuOpen(false);
                        await handleSharePlaylist();
                      }}
                      className="pm-hover pm-text-primary flex w-full items-center gap-2.5 rounded-[10px] px-3 py-2 text-left text-xs font-medium"
                    >
                      <Share2 className="h-4 w-4 pm-text-secondary" />
                      <span>Compartir lista</span>
                    </button>

                    <div className="my-1 border-t pm-border" />

                    {confirmDeletePl ? (
                      <div className="flex items-center justify-between gap-1.5 rounded-[10px] bg-rose-500/15 px-2.5 py-2">
                        <span className="text-[11px] font-semibold text-rose-400">
                          ¿Confirmar?
                        </span>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={async () => {
                              setPlMenuOpen(false);
                              setConfirmDeletePl(false);
                              await deletePlaylist(localPl.id);
                            }}
                            className="rounded-full bg-rose-500 px-2.5 py-1 text-[11px] font-bold text-white"
                          >
                            Eliminar
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeletePl(false)}
                            className="rounded-full bg-white/10 px-2 py-1 text-[11px] font-semibold"
                          >
                            No
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        role="menuitem"
                        aria-label="Eliminar playlist"
                        onClick={() => setConfirmDeletePl(true)}
                        className="flex w-full items-center gap-2.5 rounded-[10px] px-3 py-2 text-left text-xs font-semibold text-rose-400 hover:bg-rose-500/15"
                      >
                        <Trash2 className="h-4 w-4" />
                        <span>Eliminar playlist</span>
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Playlist Tracks Dropzone + Reorder */}
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
        {localPl.tracks.length > 0 ? (
          localPl.tracks.map((t, idx) => (
            <TrackListRow
              key={t.id}
              track={t}
              index={idx}
              queueContext={localPl.tracks}
              playlistId={localPl.id}
              onDropReorder={(from, to) =>
                void reorderPlaylistTrack(localPl.id, from, to)
              }
            />
          ))
        ) : (
          <div className="pm-surface-card rounded-[14px] border-dashed p-8 text-center text-xs pm-text-secondary">
            Esta playlist está vacía. Arrastra canciones aquí o usa el buscador de abajo para añadir temas.
          </div>
        )}
      </div>

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
    </div>
  );
};

const HOME_CHIPS = ['Todo', 'Música', 'Mixes', 'Álbumes'] as const;

export const HomeScreen: React.FC = () => {
  const {
    currentTrack,
    isPlaying,
    homeShelves,
    isOfflineNetwork,
    playTrack,
    toggleDjMode,
    openAlbumDetail,
    openArtistDetail,
    openTrackMenu,
    refreshHomeRecommendations,
  } = usePMusicStore();
  const [chip, setChip] = useState<(typeof HOME_CHIPS)[number]>('Todo');
  const [isRefreshingHome, setIsRefreshingHome] = useState(false);

  const listen = homeShelves.find((s) => s.kind === 'listen_again');
  const mixes = homeShelves.find((s) => s.kind === 'mixes_for_you');
  const because = homeShelves.find((s) => s.kind === 'because_you_listened');
  const releases = homeShelves.find((s) => s.kind === 'favorite_new_releases');
  const quick = (listen?.tracks ?? []).slice(0, 6);
  const show = (name: (typeof HOME_CHIPS)[number]) =>
    chip === 'Todo' || chip === name;

  const artistCards = Array.from(
    new Map(
      (releases?.tracks ?? []).flatMap((t) =>
        t.artists.slice(0, 1).map((a) => [
          a.id ?? a.name,
          { a, img: t.thumbnailHighUrl ?? t.thumbnailUrl },
        ] as const)
      )
    ).values()
  );

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

      {/* 2x3 Compact Quick-Access Grid */}
      {chip === 'Todo' && quick.length > 0 && (
        <section aria-label="Escuchar de nuevo">
          <div className="grid grid-cols-2 gap-2 sm:gap-2.5 lg:grid-cols-3">
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

      {/* Mixes para ti (Solid artwork cards, ZERO gradient overlays) */}
      {show('Mixes') && mixes?.mixes && (
        <CarouselSection
          title="Mixes para ti"
          subtitle="Mezclas personalizadas con Modo Sesión DJ"
        >
          {mixes.mixes.map((mix) => (
            <CoverCard
              key={mix.id}
              image={mix.coverUrl}
              title={mix.title}
              subtitle={mix.subtitle}
              badge="AUTOMIX"
              onOpen={() =>
                mix.tracks[0] && void playTrack(mix.tracks[0], mix.tracks)
              }
              onPlay={() => {
                void toggleDjMode(true);
                if (mix.tracks[0]) void playTrack(mix.tracks[0], mix.tracks);
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
              onOpen={() => void openArtistDetail(a.id ?? a.name)}
            />
          ))}
        </CarouselSection>
      )}
    </div>
  );
};

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

export const ExploreScreen: React.FC = () => {
  const {
    homeShelves,
    searchResults,
    exploreSimilarTracks,
    exploreEmergingArtists,
    isLoadingExplore,
    refreshExploreDiscovery,
    submitSearch,
    setActiveTab,
    playTrack,
    openAlbumDetail,
    openArtistDetail,
  } = usePMusicStore();

  const listen = homeShelves.find((s) => s.kind === 'listen_again');
  const releases = homeShelves.find((s) => s.kind === 'favorite_new_releases');
  const similarDiscoverTracks =
    exploreSimilarTracks.length > 0
      ? exploreSimilarTracks.slice(0, 8)
      : (listen?.tracks ?? []).slice(0, 6);
  const trendingSongs = (
    searchResults.songs.length > 0
      ? searchResults.songs
      : listen?.tracks ?? []
  ).slice(0, 6);
  const albums =
    searchResults.albums.length > 0
      ? searchResults.albums
      : releases?.albums ?? [];
  const emergingArtists = exploreEmergingArtists;
  const artists = searchResults.artists;

  return (
    <div className="pm-page-enter space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-bold tracking-tight pm-text-primary md:text-[32px]">
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
          {isLoadingExplore && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          <span>Actualizar recomendaciones</span>
        </button>
      </div>

      {/* Genres Grid */}
      <section className="space-y-3">
        <h2 className="text-[20px] font-bold tracking-tight pm-text-primary">
          Explorar géneros
        </h2>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          {GENRE_CARDS.map((g) => (
            <button
              key={g.query}
              type="button"
              onClick={() => {
                setActiveTab('Buscar');
                void submitSearch(g.query);
              }}
              className="pm-surface-card pm-card-lift group flex items-center gap-3 rounded-[12px] px-4 py-3.5 text-left"
            >
              <span
                aria-hidden="true"
                className="h-5 w-1.5 shrink-0 rounded-full transition-transform group-hover:scale-y-110"
                style={{ backgroundColor: g.accent }}
              />
              <span className="truncate text-[13.5px] font-semibold pm-text-primary">
                {g.label}
              </span>
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
              onOpen={() => void openArtistDetail(ar.id || ar.name)}
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
              onOpen={() => void openArtistDetail(ar.id)}
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
};

export const SearchScreen: React.FC = () => {
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
    setSearchQuery,
    submitSearch,
    setSearchScope,
    clearRecentSearches,
    playTrack,
    openArtistDetail,
    openAlbumDetail,
    openPlaylistDetail,
  } = usePMusicStore();

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
                        if (song) void playTrack(song, searchResults.songs);
                      }}
                      className="pm-btn-primary inline-flex items-center gap-1.5 rounded-full px-5 py-2 text-xs font-bold"
                    >
                      <Play className="h-4 w-4 fill-current" />
                      <span>Reproducir</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void openArtistDetail(bestResult.item.id)}
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
                      onClick={() =>
                        void playTrack(bestResult.item, searchResults.songs)
                      }
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
                  queueContext={searchResults.songs}
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
                    onClick={() => void openArtistDetail(bestResult.item.id)}
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
                        void playTrack(bestResult.item, searchResults.songs)
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
                queueContext={searchResults.songs}
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
                queueContext={searchResults.songs}
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
                onOpen={() => void openArtistDetail(artist.id)}
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
};

export const LibraryScreen: React.FC = () => {
  const {
    libraryCategory,
    libraryFilterQuery,
    playlists,
    likedTracks,
    playHistory,
    offlineEntries,
    searchResults,
    setLibraryCategory,
    setLibraryFilterQuery,
    createPlaylist,
    deletePlaylist,
    addTrackToPlaylist,
    openLocalPlaylistDetail,
    setImportModalOpen,
    removeOfflineTrack,
    playTrack,
    showToast,
  } = usePMusicStore();

  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [dragOverPlaylistId, setDragOverPlaylistId] = useState<string | null>(null);

  const categories: readonly LibraryCategoryTab[] = [
    'Todo',
    'Playlists',
    'Me gusta',
    'Descargas',
    'Historial',
  ];

  const filterNorm = libraryFilterQuery.trim().toLowerCase();

  const filteredPlaylists = playlists.filter(
    (p) => !filterNorm || p.name.toLowerCase().includes(filterNorm)
  );
  const filteredLikes = likedTracks.filter(
    (l) =>
      !filterNorm ||
      l.track.title.toLowerCase().includes(filterNorm) ||
      l.track.artists.some((a) => a.name.toLowerCase().includes(filterNorm))
  );

  return (
    <div className="pm-page-enter space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-bold tracking-tight pm-text-primary">
            Biblioteca
          </h1>
          <p className="text-[13px] pm-text-tertiary">
            Colección sincronizada entre tu móvil Android y tu PC Windows
          </p>
        </div>

        <button
          type="button"
          onClick={() => setImportModalOpen(true)}
          className="pm-btn-primary inline-flex items-center gap-2 rounded-full px-5 py-2 text-xs font-bold"
        >
          <ListMusic className="h-4 w-4" />
          <span>Importar playlist</span>
        </button>
      </div>

      {/* Category Pills & Inline Filter */}
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div
          role="tablist"
          aria-label="Categorías de biblioteca"
          className="flex w-full flex-nowrap gap-1.5 overflow-x-auto pb-1 pm-no-scrollbar sm:w-auto sm:flex-wrap sm:overflow-visible sm:pb-0"
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
                className={`shrink-0 rounded-full px-4 py-1.5 text-xs font-bold transition-colors ${
                  active ? 'pm-btn-primary' : 'pm-btn-secondary'
                }`}
              >
                {cat}
              </button>
            );
          })}
        </div>

        <input
          type="search"
          aria-label="Filtrar en biblioteca"
          placeholder="Filtrar en tu biblioteca..."
          value={libraryFilterQuery}
          onChange={(e) => setLibraryFilterQuery(e.target.value)}
          className="pm-input w-full rounded-full px-4 py-2 text-xs sm:w-56"
        />
      </div>

      {/* Create New Playlist Quick Bar */}
      {(libraryCategory === 'Todo' || libraryCategory === 'Playlists') && (
        <div
          data-surface="content"
          className="pm-surface-card flex flex-wrap items-center gap-2.5 rounded-[14px] p-3.5"
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
              const created = await createPlaylist(name, 'Creada en pMusic', []);
              setNewPlaylistName('');
              showToast(`Playlist «${created.name}» creada`);
            }}
            className="pm-btn-primary inline-flex shrink-0 items-center gap-1.5 rounded-full px-4 py-2 text-xs font-bold"
          >
            <Plus className="h-4 w-4" />
            <span>Crear playlist</span>
          </button>
        </div>
      )}

      {/* Playlists Section */}
      {(libraryCategory === 'Todo' || libraryCategory === 'Playlists') && (
        <section className="space-y-3">
          <h2 className="text-[18px] font-bold pm-text-primary">
            Tus Playlists ({filteredPlaylists.length})
          </h2>
          {filteredPlaylists.length > 0 ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {filteredPlaylists.map((pl) => {
                const thumb = pl.coverUrl ?? pl.tracks[0]?.thumbnailUrl;
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
                    className={`pm-surface-card pm-card-lift flex items-center justify-between gap-3 rounded-[12px] p-3.5 transition-all ${
                      isDropTarget
                        ? 'pm-active-row ring-2 ring-[var(--pm-accent-primary)]'
                        : ''
                    }`}
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      {thumb ? (
                        <img
                          src={thumb}
                          alt={pl.name}
                          className="h-12 w-12 shrink-0 rounded-[8px] object-cover"
                        />
                      ) : (
                        <div className="pm-elevated flex h-12 w-12 shrink-0 items-center justify-center rounded-[8px] border pm-border text-sm font-bold pm-text-secondary">
                          {pl.name.slice(0, 1).toUpperCase()}
                        </div>
                      )}
                      <div className="min-w-0">
                        <h3 className="truncate text-[15px] font-bold pm-text-primary">
                          {pl.name}
                        </h3>
                        <p className="text-xs pm-text-tertiary">
                          {pl.tracks.length} canciones · {pl.source}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => openLocalPlaylistDetail(pl.id)}
                        className="pm-btn-primary rounded-full px-3.5 py-1.5 text-xs font-bold"
                      >
                        Ver
                      </button>
                      <button
                        type="button"
                        aria-label={`Eliminar ${pl.name}`}
                        onClick={() => void deletePlaylist(pl.id)}
                        className="pm-btn-secondary rounded-full p-2 pm-text-tertiary hover:text-rose-500"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <p className="text-xs pm-text-tertiary">
              Aún no has creado playlists personalizadas. Usa el campo superior o importa desde Spotify/YouTube.
            </p>
          )}
        </section>
      )}

      {/* Liked Tracks Section */}
      {(libraryCategory === 'Todo' || libraryCategory === 'Me gusta') && (
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
      {(libraryCategory === 'Todo' || libraryCategory === 'Descargas') && (
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
      {(libraryCategory === 'Todo' || libraryCategory === 'Historial') && (
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
};
