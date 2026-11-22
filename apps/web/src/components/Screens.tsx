import React, { useRef, useState } from 'react';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Disc3,
  Download,
  GripVertical,
  Heart,
  ListMusic,
  ListPlus,
  Loader2,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  Search,
  Trash2,
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
    <span className="pm-eq-bar-1 h-full w-[2.5px] rounded-full bg-white" />
    <span className="pm-eq-bar-2 h-full w-[2.5px] rounded-full bg-white" />
    <span className="pm-eq-bar-3 h-full w-[2.5px] rounded-full bg-white" />
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
    openArtistDetail,
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
      className={`group flex h-16 items-center justify-between gap-3 rounded-[10px] px-2.5 transition-colors hover:bg-white/[0.06] ${
        isCurrent ? 'bg-white/[0.09]' : ''
      } ${dragOver ? 'border-t-2 border-white/80 bg-white/[0.08]' : ''}`}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span
          aria-hidden="true"
          className="hidden cursor-grab text-[#8E8E98]/60 opacity-0 transition-opacity group-hover:opacity-100 md:inline-flex"
        >
          <GripVertical className="h-3.5 w-3.5" />
        </span>

        {typeof index === 'number' && (
          <span className="tabular-nums hidden w-5 shrink-0 text-center text-xs font-medium text-[#8E8E98] sm:inline-flex sm:items-center sm:justify-center">
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
          className="relative h-11 w-11 shrink-0 overflow-hidden rounded-[8px] bg-[#141419]"
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
              className={`truncate text-left text-[14px] font-medium hover:underline ${
                isCurrent ? 'text-white' : 'text-[#F5F5F7]'
              }`}
            >
              {track.title}
            </button>
            {track.isExplicit && (
              <span className="shrink-0 rounded bg-white/[0.12] px-1.5 py-0.5 text-[10px] font-bold leading-none text-[#B4B4BE]">
                E
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 truncate text-[12.5px] text-[#B4B4BE]">
            <span
              role="link"
              tabIndex={0}
              onClick={() =>
                void openArtistDetail(
                  track.artists[0]?.id ?? track.artists[0]?.name ?? ''
                )
              }
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  void openArtistDetail(
                    track.artists[0]?.id ?? track.artists[0]?.name ?? ''
                  );
                }
              }}
              className="cursor-pointer truncate hover:text-white hover:underline"
            >
              {track.artists.map((a) => a.name).join(', ')}
            </span>
            {track.album && (
              <span className="hidden truncate text-[#8E8E98] lg:inline">
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
          className="hidden items-center justify-center rounded-full p-2 text-[#8E8E98] opacity-0 transition-opacity hover:bg-white/[0.08] hover:text-white group-hover:opacity-100 focus-visible:opacity-100 sm:flex"
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
              ? 'text-[#F43F5E]'
              : 'text-[#8E8E98] hover:bg-white/[0.08] hover:text-[#F5F5F7]'
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
          className="hidden items-center justify-center rounded-full p-2 text-[#8E8E98] hover:bg-white/[0.08] hover:text-[#F5F5F7] md:flex"
        >
          {dlStatus === 'downloading' ? (
            <Loader2 className="h-4 w-4 animate-spin text-white" />
          ) : dlStatus === 'downloaded' ? (
            <Check className="h-4 w-4 text-[#34D399]" />
          ) : (
            <Download className="h-4 w-4" />
          )}
        </button>

        {playlistId && (
          <button
            type="button"
            aria-label={`Quitar ${track.title} de esta playlist`}
            onClick={() => void removeTrackFromPlaylist(playlistId, track.id)}
            className="hidden items-center justify-center rounded-full p-2 text-[#8E8E98] opacity-0 transition-opacity hover:bg-[#2A1418] hover:text-[#F87171] group-hover:opacity-100 focus-visible:opacity-100 sm:flex"
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
          className="flex items-center justify-center rounded-full p-2 text-[#8E8E98] opacity-100 transition-opacity hover:bg-white/[0.08] hover:text-white sm:opacity-70 sm:group-hover:opacity-100"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>

        <span className="tabular-nums w-11 text-right text-[12px] font-medium text-[#8E8E98]">
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
  badge?: string;
  round?: boolean;
  dragTrack?: Track;
  onOpen: () => void;
  onPlay?: () => void;
}> = ({ image, title, subtitle, badge, round, dragTrack, onOpen, onPlay }) => {
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
      className="pm-cover-card group w-[152px] shrink-0 snap-start rounded-[12px] bg-[#111115] p-2.5 transition-colors hover:bg-[#18181E] md:w-[178px]"
    >
    <div className="relative">
      <button
        type="button"
        aria-label={`Abrir ${title}`}
        onClick={onOpen}
        className="block w-full text-left"
      >
        <img
          src={image}
          alt={title}
          loading="lazy"
          className={`aspect-square w-full bg-[#16161C] object-cover shadow-[0_8px_24px_rgba(0,0,0,0.5)] ${
            round ? 'rounded-full' : 'rounded-[8px]'
          }`}
        />
      </button>
      {badge && (
        <span className="pointer-events-none absolute top-2 left-2 rounded bg-[#070709]/90 px-2 py-0.5 text-[10px] font-bold tracking-wider text-[#F5F5F7]">
          {badge}
        </span>
      )}
      {onPlay && (
        <button
          type="button"
          aria-label={`Reproducir ${title}`}
          onClick={onPlay}
          className="pm-cover-play absolute right-2 bottom-2 flex h-11 w-11 items-center justify-center rounded-full bg-white text-[#070709] shadow-xl hover:scale-105"
        >
          <Play className="h-5 w-5 translate-x-[1px] fill-current" />
        </button>
      )}
    </div>
    <div className={`mt-2.5 ${round ? 'text-center' : ''}`}>
      <button
        type="button"
        onClick={onOpen}
        className="block w-full truncate text-left text-[14px] font-semibold text-[#F5F5F7] hover:underline"
      >
        <span className={round ? 'block text-center' : ''}>{title}</span>
      </button>
      {subtitle && (
        <div className="mt-0.5 line-clamp-2 text-[12px] text-[#8E8E98]">
          {subtitle}
        </div>
      )}
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

  const scrollByDir = (dir: -1 | 1) => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * 520, behavior: 'smooth' });
  };

  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="text-[20px] font-bold tracking-tight text-[#F5F5F7] md:text-[22px]">
            {title}
          </h2>
          {subtitle && (
            <p className="text-[12.5px] text-[#8E8E98]">{subtitle}</p>
          )}
        </div>
        <div className="hidden items-center gap-1.5 md:flex">
          <button
            type="button"
            aria-label={`Desplazar ${title} a la izquierda`}
            onClick={() => scrollByDir(-1)}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-[#141419] text-[#B4B4BE] hover:bg-[#1E1E26] hover:text-white"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label={`Desplazar ${title} a la derecha`}
            onClick={() => scrollByDir(1)}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-[#141419] text-[#B4B4BE] hover:bg-[#1E1E26] hover:text-white"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div
        ref={scrollerRef}
        className="pm-no-scrollbar flex snap-x gap-4 overflow-x-auto px-1 pb-1.5"
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
    addTrackToPlaylist,
    reorderPlaylistTrack,
    searchTracksForPlaylist,
    openAlbumDetail,
    openArtistDetail,
  } = usePMusicStore();

  const [editingName, setEditingName] = useState('');
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
      <div className="space-y-8">
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
            <span className="inline-block rounded-md bg-white/[0.08] px-2.5 py-1 text-[11px] font-semibold tracking-wide text-[#B4B4BE]">
              ARTISTA
            </span>
            <h1 className="truncate text-3xl font-bold tracking-tight text-[#F5F5F7] md:text-5xl">
              {artist.name}
            </h1>
            {(artist.subscribersText || description) && (
              <p className="text-sm text-[#B4B4BE]">
                {artist.subscribersText ?? description}
              </p>
            )}
            <div className="flex flex-wrap gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => {
                  if (popularSongs[0]) void playTrack(popularSongs[0], popularSongs);
                }}
                className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-2.5 text-xs font-bold text-[#070709] hover:bg-white/90"
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
                className="inline-flex items-center gap-2 rounded-full border border-white/[0.12] bg-[#16161C] px-5 py-2.5 text-xs font-semibold text-[#F5F5F7] hover:bg-[#1E1E26]"
              >
                <Disc3 className="h-4 w-4 text-[#C084FC]" />
                <span>Sesión DJ {artist.name}</span>
              </button>
            </div>
          </div>
        </section>

        <section className="space-y-2">
          <h2 className="text-[20px] font-bold text-[#F5F5F7]">Populares</h2>
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
                onOpen={() => void openAlbumDetail(al.id)}
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
      <div className="space-y-7">
        <section
          data-surface="content"
          className="pm-surface-card flex flex-col gap-6 rounded-[18px] p-6 sm:flex-row sm:items-end"
        >
          <img
            src={album.thumbnailUrl}
            alt={album.title}
            className="h-40 w-40 shrink-0 rounded-[12px] object-cover shadow-[0_18px_48px_rgba(0,0,0,0.65)] sm:h-44 sm:w-44"
          />
          <div className="min-w-0 flex-1 space-y-2">
            <span className="inline-block rounded-md bg-white/[0.08] px-2.5 py-1 text-[11px] font-semibold text-[#B4B4BE]">
              ÁLBUM {album.year ? `· ${album.year}` : ''} · {tracks.length}{' '}
              CANCIONES
            </span>
            <h1 className="truncate text-3xl font-bold tracking-tight text-[#F5F5F7] md:text-4xl">
              {album.title}
            </h1>
            <p className="text-sm text-[#B4B4BE]">
              {album.artists.map((a) => a.name).join(', ')}
            </p>
            <div className="flex flex-wrap gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => {
                  if (tracks[0]) void playTrack(tracks[0], tracks);
                }}
                className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-2.5 text-xs font-bold text-[#070709] hover:bg-white/90"
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
                className="inline-flex items-center gap-2 rounded-full border border-white/[0.12] bg-[#16161C] px-5 py-2.5 text-xs font-semibold text-[#F5F5F7] hover:bg-[#1E1E26]"
              >
                <Disc3 className="h-4 w-4 text-[#C084FC]" />
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
              queueContext={tracks}
            />
          ))}
        </div>
      </div>
    );
  }

  if (activeDetailView.kind === 'playlist') {
    const { playlist, tracks } = activeDetailView.data;
    return (
      <div className="space-y-7">
        <section
          data-surface="content"
          className="pm-surface-card flex flex-col gap-6 rounded-[18px] p-6 sm:flex-row sm:items-end"
        >
          <img
            src={playlist.thumbnailUrl}
            alt={playlist.title}
            className="h-40 w-40 shrink-0 rounded-[12px] object-cover shadow-[0_18px_48px_rgba(0,0,0,0.65)] sm:h-44 sm:w-44"
          />
          <div className="min-w-0 flex-1 space-y-2">
            <span className="inline-block rounded-md bg-white/[0.08] px-2.5 py-1 text-[11px] font-semibold text-[#B4B4BE]">
              PLAYLIST · {tracks.length} CANCIONES
            </span>
            <h1 className="truncate text-3xl font-bold tracking-tight text-[#F5F5F7] md:text-4xl">
              {playlist.title}
            </h1>
            <p className="text-sm text-[#B4B4BE]">
              {playlist.author ?? 'pMusic'}
            </p>
            <div className="flex flex-wrap gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => {
                  if (tracks[0]) void playTrack(tracks[0], tracks);
                }}
                className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-2.5 text-xs font-bold text-[#070709] hover:bg-white/90"
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
                className="inline-flex items-center gap-2 rounded-full border border-white/[0.12] bg-[#16161C] px-5 py-2.5 text-xs font-semibold text-[#F5F5F7] hover:bg-[#1E1E26]"
              >
                <Disc3 className="h-4 w-4 text-[#C084FC]" />
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
              queueContext={tracks}
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

  return (
    <div className="space-y-7">
      <div
        data-surface="content"
        className="pm-surface-card space-y-5 rounded-[18px] p-6"
      >
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex items-end gap-5">
            {localPl.coverUrl ?? localPl.tracks[0]?.thumbnailUrl ? (
              <img
                src={localPl.coverUrl ?? localPl.tracks[0]?.thumbnailUrl}
                alt={localPl.name}
                className="h-28 w-28 rounded-[12px] object-cover shadow-xl sm:h-36 sm:w-36"
              />
            ) : (
              <div className="flex h-28 w-28 items-center justify-center rounded-[12px] bg-[#181820] text-3xl font-bold text-[#B4B4BE] sm:h-36 sm:w-36">
                {localPl.name.slice(0, 1).toUpperCase()}
              </div>
            )}
            <div className="space-y-1.5">
              <span className="inline-block rounded-md bg-white/[0.08] px-2.5 py-1 text-[11px] font-semibold text-[#B4B4BE]">
                TU PLAYLIST · {localPl.tracks.length} PISTAS
              </span>
              <h1 className="text-3xl font-bold tracking-tight text-[#F5F5F7]">
                {localPl.name}
              </h1>
              <p className="text-xs text-[#B4B4BE]">
                {localPl.description || 'Playlist personal sincronizada'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                if (localPl.tracks[0]) {
                  void playTrack(localPl.tracks[0], localPl.tracks);
                }
              }}
              className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-xs font-bold text-[#070709] hover:bg-white/90"
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
              className="inline-flex items-center gap-2 rounded-full border border-white/[0.12] bg-[#16161C] px-4 py-2.5 text-xs font-semibold text-[#F5F5F7]"
            >
              <Disc3 className="h-4 w-4 text-[#C084FC]" />
              <span>Sesión DJ</span>
            </button>
            <button
              type="button"
              aria-label="Eliminar playlist"
              onClick={() => void deletePlaylist(localPl.id)}
              className="rounded-full border border-white/[0.08] bg-[#1E1215] px-4 py-2.5 text-xs font-semibold text-[#F87171]"
            >
              Eliminar
            </button>
          </div>
        </div>

        <div className="flex gap-2">
          <input
            type="text"
            aria-label="Nuevo nombre de playlist"
            placeholder="Renombrar playlist..."
            value={editingName}
            onChange={(e) => setEditingName(e.target.value)}
            className="rounded-full border border-white/10 bg-[#0B0B0E] px-4 py-2 text-xs text-[#F5F5F7]"
          />
          <button
            type="button"
            onClick={async () => {
              if (editingName.trim()) {
                await renamePlaylist(localPl.id, editingName.trim());
                setEditingName('');
              }
            }}
            className="rounded-full border border-white/10 bg-[#181820] px-4 py-2 text-xs font-semibold text-[#F5F5F7]"
          >
            Renombrar
          </button>
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
          playlistDropActive ? 'bg-white/[0.06] ring-2 ring-white/60 p-2' : ''
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
          <div className="rounded-[14px] border border-dashed border-white/[0.14] bg-[#101016] p-8 text-center text-xs text-[#B4B4BE]">
            Esta playlist está vacía. Arrastra canciones aquí o usa el buscador de abajo para añadir temas.
          </div>
        )}
      </div>

      {/* Spotify-style Inline Add Songs Search Section */}
      <section
        data-surface="content"
        className="pm-surface-card space-y-4 rounded-[16px] p-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-[17px] font-bold text-[#F5F5F7]">
              Añadir canciones a «{localPl.name}»
            </h2>
            <p className="text-xs text-[#8E8E98]">
              Busca temas o pulsa el menú ••• en cualquier canción de la app
            </p>
          </div>
        </div>

        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setIsSearchingAdd(true);
            const found = await searchTracksForPlaylist(addSearchQuery);
            setAddSearchResults(found);
            setIsSearchingAdd(false);
          }}
          className="flex items-center gap-2.5 rounded-full border border-white/[0.10] bg-[#0B0B0E] px-4 py-2"
        >
          <Search className="h-4 w-4 text-[#B4B4BE]" />
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
            className="flex-1 bg-transparent text-xs text-[#F5F5F7] placeholder:text-[#8E8E98] focus:outline-none"
          />
          {isSearchingAdd && (
            <Loader2 className="h-4 w-4 animate-spin text-[#B4B4BE]" />
          )}
        </form>

        <div className="space-y-1">
          {suggestedAdds.slice(0, 6).map((t) => (
            <div
              key={`add-${t.id}`}
              className="flex items-center justify-between gap-3 rounded-[10px] px-2.5 py-2 hover:bg-white/[0.06]"
            >
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <img
                  src={t.thumbnailUrl}
                  alt=""
                  className="h-10 w-10 shrink-0 rounded-[7px] object-cover"
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13.5px] font-medium text-[#F5F5F7]">
                    {t.title}
                  </div>
                  <div className="truncate text-xs text-[#8E8E98]">
                    {t.artists.map((a) => a.name).join(', ')}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => void addTrackToPlaylist(localPl.id, t)}
                className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-[#181822] px-3.5 py-1.5 text-xs font-semibold text-[#F5F5F7] hover:bg-white hover:text-[#070709]"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Añadir</span>
              </button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};

const HOME_CHIPS = ['Todo', 'Música', 'Mixes', 'Álbumes'] as const;

export const HomeScreen: React.FC = () => {
  const {
    homeShelves,
    isOfflineNetwork,
    playTrack,
    toggleDjMode,
    openAlbumDetail,
    openArtistDetail,
    openTrackMenu,
  } = usePMusicStore();
  const [chip, setChip] = useState<(typeof HOME_CHIPS)[number]>('Todo');

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
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-[28px] font-bold tracking-tight text-[#F5F5F7] md:text-[32px]">
          {getSpanishGreeting()}
        </h1>
      </div>

      {/* Spotify-style Filter Pills */}
      <div role="tablist" aria-label="Filtros de inicio" className="flex flex-wrap gap-2">
        {HOME_CHIPS.map((c) => (
          <button
            key={c}
            type="button"
            role="tab"
            aria-selected={chip === c}
            onClick={() => setChip(c)}
            className={`rounded-full px-4 py-1.5 text-[13px] font-semibold ${
              chip === c
                ? 'bg-white text-[#070709]'
                : 'bg-[#16161C] text-[#F5F5F7] hover:bg-[#1F1F28]'
            }`}
          >
            {c}
          </button>
        ))}
      </div>

      {isOfflineNetwork && (
        <div
          role="status"
          className="rounded-xl border border-[#FBBF24]/30 bg-[#1B160B] px-4 py-3 text-[13px] font-medium text-[#F5F5F7]"
        >
          Sin conexión. Mostrando tu caché offline y catálogo guardado.
        </div>
      )}

      {/* 2x3 Quick-Access Grid (Spotify signature) */}
      {chip === 'Todo' && quick.length > 0 && (
        <section aria-label="Escuchar de nuevo">
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {quick.map((t) => (
              <div
                key={t.id}
                data-surface="content"
                draggable
                onDragStart={(e) => setDraggedTrack(e, t)}
                onDragEnd={() => clearDraggedTrack()}
                onContextMenu={(e) => {
                  e.preventDefault();
                  openTrackMenu(t, e.clientX, e.clientY);
                }}
                className="group flex items-center gap-3 overflow-hidden rounded-[8px] border border-white/[0.05] bg-[#121217] pr-2 transition-colors hover:bg-[#1A1A22]"
              >
                <button
                  type="button"
                  aria-label={`Reproducir ${t.title}`}
                  onClick={() => void playTrack(t, listen?.tracks)}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                >
                  <img
                    src={t.thumbnailUrl}
                    alt={t.title}
                    className="h-14 w-14 shrink-0 object-cover"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14px] font-semibold text-[#F5F5F7]">
                      {t.title}
                    </div>
                    <div className="truncate text-[12px] text-[#8E8E98]">
                      {t.artists.map((a) => a.name).join(', ')}
                    </div>
                  </div>
                </button>
                <button
                  type="button"
                  aria-label={`Más opciones para ${t.title}`}
                  onClick={(e) => {
                    const r = e.currentTarget.getBoundingClientRect();
                    openTrackMenu(t, r.left - 180, r.bottom + 6);
                  }}
                  className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-full text-[#8E8E98] opacity-0 transition-opacity hover:bg-white/[0.10] hover:text-white group-hover:opacity-100 sm:flex"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  aria-label={`Play ${t.title}`}
                  onClick={() => void playTrack(t, listen?.tracks)}
                  className="pm-cover-play flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-[#070709] shadow-md"
                >
                  <Play className="h-4 w-4 translate-x-[1px] fill-current" />
                </button>
              </div>
            ))}
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
              subtitle={t.artists.map((a) => a.name).join(', ')}
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
          <h2 className="text-[20px] font-bold tracking-tight text-[#F5F5F7] md:text-[22px]">
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
              subtitle={[al.year, al.artists.map((a) => a.name).join(', ')]
                .filter(Boolean)
                .join(' · ')}
              onOpen={() => void openAlbumDetail(al.id)}
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

export const SearchScreen: React.FC = () => {
  const {
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
    <div className="space-y-6">
      <div>
        <h1 className="text-[28px] font-bold tracking-tight text-[#F5F5F7]">
          Buscar
        </h1>
        <p className="text-[13px] text-[#8E8E98]">
          Millones de canciones, artistas, álbumes y listas completas
        </p>
      </div>

      {/* Sleek Solid Search Field */}
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          void submitSearch();
        }}
        className="flex items-center gap-3 rounded-full border border-white/[0.09] bg-[#131318] px-4 py-2 focus-within:border-white/30"
      >
        <Search className="h-4 w-4 shrink-0 text-[#B4B4BE]" />
        <input
          type="search"
          role="searchbox"
          aria-label="Buscar canciones, artistas o álbumes"
          placeholder="¿Qué te apetece escuchar hoy?"
          value={searchQuery}
          onChange={(e) => void setSearchQuery(e.target.value)}
          className="flex-1 bg-transparent text-[14px] font-medium text-[#F5F5F7] placeholder:text-[#8E8E98] focus:outline-none"
        />
        {isSearching && (
          <Loader2 className="h-4 w-4 animate-spin text-[#B4B4BE]" />
        )}
        {searchQuery && (
          <button
            type="button"
            aria-label="Limpiar búsqueda"
            onClick={() => void setSearchQuery('', true)}
            className="rounded-full bg-white/[0.09] px-3 py-1 text-xs font-semibold text-[#F5F5F7] hover:bg-white/[0.16]"
          >
            Limpiar
          </button>
        )}
      </form>

      {/* Autocomplete & Recent Searches */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {autocompleteSuggestions.slice(0, 6).map((sug) => (
            <button
              key={sug.text}
              type="button"
              onClick={() => void submitSearch(sug.text)}
              className="rounded-full border border-white/[0.06] bg-[#121217] px-3.5 py-1.5 text-xs font-medium text-[#F5F5F7] hover:bg-[#1B1B22]"
            >
              {sug.text}
            </button>
          ))}
        </div>

        {recentSearches.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-[#8E8E98]">Recientes:</span>
            {recentSearches.slice(0, 3).map((rec) => (
              <button
                key={rec}
                type="button"
                onClick={() => void submitSearch(rec)}
                className="rounded-full bg-[#131318] px-3 py-1 text-xs text-[#B4B4BE] hover:text-white"
              >
                {rec}
              </button>
            ))}
            <button
              type="button"
              onClick={() => clearRecentSearches()}
              className="text-xs font-medium text-[#B4B4BE] hover:text-white hover:underline"
            >
              Borrar
            </button>
          </div>
        )}
      </div>

      {/* Browse Genres (shown when search box is empty on Todo) */}
      {!searchQuery.trim() && searchScope === 'Todo' && (
        <section className="space-y-3">
          <h2 className="text-[18px] font-bold text-[#F5F5F7]">
            Explorar géneros
          </h2>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            {GENRE_CARDS.map((g) => (
              <button
                key={g.query}
                type="button"
                onClick={() => void submitSearch(g.query)}
                className="flex items-center gap-3 rounded-[10px] border border-white/[0.06] bg-[#111115] px-4 py-3.5 text-left hover:bg-[#181820]"
              >
                <span
                  aria-hidden="true"
                  className="h-5 w-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: g.accent }}
                />
                <span className="truncate text-[13.5px] font-semibold text-[#F5F5F7]">
                  {g.label}
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* 5 Scope Filter Tabs */}
      <div
        role="tablist"
        aria-label="Filtros de búsqueda"
        className="flex flex-wrap gap-1.5"
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
              className={`rounded-full px-4 py-1.5 text-xs font-bold ${
                active
                  ? 'bg-white text-[#070709]'
                  : 'bg-[#16161C] text-[#B4B4BE] hover:bg-[#1F1F28] hover:text-white'
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
            <h2 className="text-[18px] font-bold text-[#F5F5F7]">
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
                      <span className="inline-block rounded-md bg-white/[0.08] px-2.5 py-0.5 text-[11px] font-semibold text-[#B4B4BE]">
                        ARTISTA
                      </span>
                      <h3 className="mt-1.5 truncate text-2xl font-bold text-[#F5F5F7]">
                        {bestResult.item.name}
                      </h3>
                      <p className="text-xs text-[#8E8E98]">
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
                      className="inline-flex items-center gap-1.5 rounded-full bg-white px-5 py-2 text-xs font-bold text-[#070709] hover:bg-white/90"
                    >
                      <Play className="h-4 w-4 fill-current" />
                      <span>Reproducir</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void openArtistDetail(bestResult.item.id)}
                      className="rounded-full border border-white/[0.12] bg-[#16161C] px-4 py-2 text-xs font-semibold text-[#F5F5F7] hover:bg-[#1E1E26]"
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
                      <span className="inline-block rounded-md bg-white/[0.08] px-2.5 py-0.5 text-[11px] font-semibold text-[#B4B4BE]">
                        CANCIÓN
                      </span>
                      <h3 className="mt-1.5 truncate text-2xl font-bold text-[#F5F5F7]">
                        {bestResult.item.title}
                      </h3>
                      <p className="truncate text-xs text-[#B4B4BE]">
                        {bestResult.item.artists.map((a) => a.name).join(', ')}
                      </p>
                    </div>
                  </div>
                  <div>
                    <button
                      type="button"
                      aria-label={`Reproducir ${bestResult.item.title}`}
                      onClick={() =>
                        void playTrack(bestResult.item, searchResults.songs)
                      }
                      className="inline-flex items-center gap-1.5 rounded-full bg-white px-5 py-2 text-xs font-bold text-[#070709] hover:bg-white/90"
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
            <h2 className="text-[18px] font-bold text-[#F5F5F7]">Canciones</h2>
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
            <h2 className="text-[18px] font-bold text-[#F5F5F7]">
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
                      <span className="inline-block rounded-md bg-white/[0.08] px-2.5 py-0.5 text-[11px] font-semibold text-[#B4B4BE]">
                        ARTISTA
                      </span>
                      <h3 className="mt-1 text-xl font-bold text-[#F5F5F7]">
                        {bestResult.item.name}
                      </h3>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void openArtistDetail(bestResult.item.id)}
                    className="rounded-full bg-white px-5 py-2 text-xs font-bold text-[#070709]"
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
                        <span className="inline-block rounded-md bg-white/[0.08] px-2.5 py-0.5 text-[11px] font-semibold text-[#B4B4BE]">
                          CANCIÓN
                        </span>
                        <h3 className="mt-1 text-xl font-bold text-[#F5F5F7]">
                          {bestResult.item.title}
                        </h3>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        void playTrack(bestResult.item, searchResults.songs)
                      }
                      className="rounded-full bg-white px-5 py-2 text-xs font-bold text-[#070709]"
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
          <h2 className="text-[18px] font-bold text-[#F5F5F7]">
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
          <h2 className="text-[18px] font-bold text-[#F5F5F7]">
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
                subtitle={[album.year, album.artists.map((a) => a.name).join(', ')]
                  .filter(Boolean)
                  .join(' · ')}
                onOpen={() => void openAlbumDetail(album.id)}
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
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-bold tracking-tight text-[#F5F5F7]">
            Biblioteca
          </h1>
          <p className="text-[13px] text-[#8E8E98]">
            Colección sincronizada entre tu móvil Android y tu PC Windows
          </p>
        </div>

        <button
          type="button"
          onClick={() => setImportModalOpen(true)}
          className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-2 text-xs font-bold text-[#070709] hover:bg-white/90"
        >
          <ListMusic className="h-4 w-4" />
          <span>Importar playlist</span>
        </button>
      </div>

      {/* Category Pills & Inline Filter */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          role="tablist"
          aria-label="Categorías de biblioteca"
          className="flex flex-wrap gap-1.5"
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
                className={`rounded-full px-4 py-1.5 text-xs font-bold ${
                  active
                    ? 'bg-white text-[#070709]'
                    : 'bg-[#16161C] text-[#B4B4BE] hover:bg-[#1F1F28] hover:text-white'
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
          className="rounded-full border border-white/10 bg-[#131318] px-4 py-2 text-xs text-[#F5F5F7] placeholder:text-[#8E8E98]"
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
            className="flex-1 rounded-full border border-white/10 bg-[#0B0B0E] px-4 py-2 text-xs text-[#F5F5F7] placeholder:text-[#8E8E98]"
          />
          <button
            type="button"
            onClick={async () => {
              const name = newPlaylistName.trim() || `Mi Playlist #${playlists.length + 1}`;
              const created = await createPlaylist(name, 'Creada en pMusic', []);
              setNewPlaylistName('');
              showToast(`Playlist «${created.name}» creada`);
            }}
            className="inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-xs font-bold text-[#070709]"
          >
            <Plus className="h-4 w-4" />
            <span>Crear playlist</span>
          </button>
        </div>
      )}

      {/* Playlists Section */}
      {(libraryCategory === 'Todo' || libraryCategory === 'Playlists') && (
        <section className="space-y-3">
          <h2 className="text-[18px] font-bold text-[#F5F5F7]">
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
                    className={`pm-surface-card flex items-center justify-between gap-3 rounded-[12px] p-3.5 transition-all ${
                      isDropTarget
                        ? 'bg-white/[0.12] ring-2 ring-white/75'
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
                        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[8px] bg-[#181820] text-sm font-bold text-[#B4B4BE]">
                          {pl.name.slice(0, 1).toUpperCase()}
                        </div>
                      )}
                      <div className="min-w-0">
                        <h3 className="truncate text-[15px] font-bold text-[#F5F5F7]">
                          {pl.name}
                        </h3>
                        <p className="text-xs text-[#8E8E98]">
                          {pl.tracks.length} canciones · {pl.source}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => openLocalPlaylistDetail(pl.id)}
                        className="rounded-full bg-white px-3.5 py-1.5 text-xs font-bold text-[#070709]"
                      >
                        Ver
                      </button>
                      <button
                        type="button"
                        aria-label={`Eliminar ${pl.name}`}
                        onClick={() => void deletePlaylist(pl.id)}
                        className="rounded-full bg-[#16161C] p-2 text-[#8E8E98] hover:text-[#F87171]"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-[#8E8E98]">
              Aún no has creado playlists personalizadas. Usa el campo superior o importa desde Spotify/YouTube.
            </p>
          )}
        </section>
      )}

      {/* Liked Tracks Section */}
      {(libraryCategory === 'Todo' || libraryCategory === 'Me gusta') && (
        <section className="space-y-2.5">
          <h2 className="text-[18px] font-bold text-[#F5F5F7]">
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
            <p className="text-xs text-[#8E8E98]">
              Pulsa el icono del corazón en cualquier canción para guardarla aquí.
            </p>
          )}
        </section>
      )}

      {/* Offline Downloads Section */}
      {(libraryCategory === 'Todo' || libraryCategory === 'Descargas') && (
        <section className="space-y-2.5">
          <h2 className="text-[18px] font-bold text-[#F5F5F7]">
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
                      <div className="truncate text-sm font-semibold text-[#F5F5F7]">
                        {track?.title ?? entry.trackId}
                      </div>
                      <div className="text-xs text-[#8E8E98]">
                        Disponible sin conexión ·{' '}
                        {entry.sizeBytes > 1024 * 1024
                          ? `${(entry.sizeBytes / (1024 * 1024)).toFixed(1)} MB`
                          : `${(entry.sizeBytes / 1024).toFixed(0)} KB`}
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => void removeOfflineTrack(entry.trackId)}
                      className="rounded-full bg-[#16161C] px-3.5 py-1.5 text-xs font-semibold text-[#F87171] hover:bg-[#241418]"
                    >
                      Borrar
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-[#8E8E98]">
              Descarga canciones con el icono de flecha para escucharlas sin conexión.
            </p>
          )}
        </section>
      )}

      {/* Listening History Section */}
      {(libraryCategory === 'Todo' || libraryCategory === 'Historial') && (
        <section className="space-y-2.5">
          <h2 className="text-[18px] font-bold text-[#F5F5F7]">
            Historial reciente ({playHistory.length})
          </h2>
          {playHistory.length > 0 ? (
            <div className="space-y-0.5">
              {playHistory.slice(0, 12).map((h, idx) => (
                <TrackListRow key={h.id} track={h.track} index={idx} />
              ))}
            </div>
          ) : (
            <p className="text-xs text-[#8E8E98]">
              Tu historial alimenta automáticamente las recomendaciones.
            </p>
          )}
        </section>
      )}
    </div>
  );
};
