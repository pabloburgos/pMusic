import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  ChevronRight,
  Copy,
  Disc,
  Disc3,
  Download,
  FolderPlus,
  Heart,
  Info,
  ListPlus,
  ListStart,
  Plus,
  Trash2,
  User,
} from 'lucide-react';
import { usePMusicStore } from '../store/usePMusicStore.ts';

export const TrackContextMenu: React.FC = React.memo(() => {
  const open = usePMusicStore((s) => Boolean(s.trackMenu));
  if (!open) return null;
  return <TrackContextMenuInner />;
});
TrackContextMenu.displayName = 'TrackContextMenu';

const TrackContextMenuInner: React.FC = () => {
  const {
    trackMenu,
    playlists,
    likedTracks,
    offlineDownloads,
    closeTrackMenu,
    playNextInQueue,
    addToQueue,
    addTrackToPlaylist,
    removeTrackFromPlaylist,
    createPlaylist,
    toggleLike,
    startTrackRadio,
    startFullDjRadio,
    openArtistDetail,
    openAlbumDetail,
    downloadTrackOffline,
    removeOfflineTrack,
    setTrackInfoModalTrack,
    showToast,
  } = usePMusicStore();

  const [showPlaylistPicker, setShowPlaylistPicker] = useState(false);
  const [viewportWidth, setViewportWidth] = useState<number>(() =>
    typeof window !== 'undefined' ? window.innerWidth : 1280
  );
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setShowPlaylistPicker(false);
  }, [trackMenu]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    if (!trackMenu || typeof window === 'undefined') return;
    const openedAt = Date.now();
    const isMobile = window.innerWidth < 640;
    const handlePointerDown = (e: MouseEvent) => {
      if (Date.now() - openedAt < 120) return;
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        closeTrackMenu();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeTrackMenu();
      }
    };
    const handleScroll = (e: Event) => {
      if (isMobile || Date.now() - openedAt < 180) return;
      if (menuRef.current && menuRef.current.contains(e.target as Node)) return;
      closeTrackMenu();
    };
    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKey);
    window.addEventListener('scroll', handleScroll, true);
    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKey);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [trackMenu, closeTrackMenu]);

  if (!trackMenu) return null;

  const { track, x, y, playlistId } = trackMenu;
  const isMobileSheet = viewportWidth < 640;
  const winW = viewportWidth;
  const winH = typeof window !== 'undefined' ? window.innerHeight : 800;
  const left = Math.max(12, Math.min(x, winW - 276));
  const top = Math.max(12, Math.min(y, winH - 420));

  const isLiked = likedTracks.some((l) => l.trackId === track.id);
  const isDownloaded = offlineDownloads[track.id] === 'downloaded';
  const artistName = track.artists.map((a) => a.name).join(', ');
  const trackArtists =
    track.artists.length > 0 ? track.artists : [{ name: 'Artista' }];

  return (
    <>
      {isMobileSheet && (
        <div
          aria-hidden="true"
          onClick={() => closeTrackMenu()}
          className="fixed inset-0 z-[74] bg-black/55"
        />
      )}
      <div
        ref={menuRef}
        role="menu"
        aria-label={`Opciones para ${track.title}`}
        data-testid="track-context-menu"
        style={isMobileSheet ? undefined : { left, top }}
        className={
          isMobileSheet
            ? 'pm-glass-frosted-neutral pm-popover-enter fixed inset-x-0 bottom-0 z-[75] max-h-[84dvh] overflow-y-auto rounded-t-[28px] px-4 pt-3 pb-[max(1.5rem,var(--pm-safe-bottom,env(safe-area-inset-bottom)))] pm-no-scrollbar'
            : 'pm-glass-frosted-neutral pm-menu-pop fixed z-[75] w-66 max-h-[78vh] overflow-y-auto rounded-[18px] p-1.5 pm-no-scrollbar'
        }
      >
        {isMobileSheet && (
          <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/30" />
        )}
        {/* Mini Track Header */}
        <div className="mb-1.5 flex items-center gap-3 border-b border-white/10 px-2.5 py-2.5">
          <img
            src={track.thumbnailUrl}
            alt=""
            className="h-11 w-11 shrink-0 rounded-[9px] object-cover sm:h-9 sm:w-9 sm:rounded-[7px]"
          />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[14px] font-bold sm:text-[13px]">
              {track.title}
            </div>
            <div className="truncate text-xs opacity-70 sm:text-[11px]">
              {artistName}
            </div>
          </div>
        </div>

      <button
        type="button"
        role="menuitem"
        onClick={() => {
          playNextInQueue(track);
          closeTrackMenu();
        }}
        className="pm-hover pm-text-primary flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left text-xs font-medium"
      >
        <ListStart className="h-4 w-4 pm-text-secondary" />
        <span>Reproducir a continuación</span>
      </button>

      <button
        type="button"
        role="menuitem"
        onClick={() => {
          addToQueue(track);
          closeTrackMenu();
        }}
        className="pm-hover pm-text-primary flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left text-xs font-medium"
      >
        <ListPlus className="h-4 w-4 pm-text-secondary" />
        <span>Añadir a la cola</span>
      </button>

      <div className="my-1 border-t pm-border" />

      {/* Add to Playlist Section */}
      <button
        type="button"
        role="menuitem"
        aria-expanded={showPlaylistPicker}
        onClick={() => setShowPlaylistPicker(!showPlaylistPicker)}
        className="pm-hover pm-text-primary flex w-full items-center justify-between gap-2 rounded-[10px] px-2.5 py-2 text-left text-xs font-semibold"
      >
        <span className="flex items-center gap-2.5">
          <FolderPlus className="h-4 w-4 pm-text-secondary" />
          <span>Añadir a playlist</span>
        </span>
        <ChevronRight
          className={`h-3.5 w-3.5 pm-text-tertiary transition-transform ${
            showPlaylistPicker ? 'rotate-90' : ''
          }`}
        />
      </button>

      {showPlaylistPicker && (
        <div className="pm-panel mx-1 mb-1 space-y-0.5 rounded-[10px] p-1.5">
          <button
            type="button"
            onClick={async () => {
              const pl = await createPlaylist(
                `${track.title.slice(0, 24)}`,
                'Creada desde menú de canción',
                [track]
              );
              showToast(`Playlist «${pl.name}» creada`);
              closeTrackMenu();
            }}
            className="pm-hover flex w-full items-center gap-2 rounded-[8px] px-2.5 py-1.5 text-left text-xs font-semibold text-[#C084FC]"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Nueva playlist con esta canción</span>
          </button>

          {playlists.length > 0 ? (
            <div className="max-h-36 space-y-0.5 overflow-y-auto pm-no-scrollbar">
              {playlists.map((pl) => {
                const alreadyIn = pl.tracks.some((t) => t.id === track.id);
                return (
                  <button
                    key={pl.id}
                    type="button"
                    onClick={async () => {
                      await addTrackToPlaylist(pl.id, track);
                      closeTrackMenu();
                    }}
                    className="pm-hover flex w-full items-center justify-between gap-2 rounded-[8px] px-2.5 py-1.5 text-left text-xs"
                  >
                    <span className="truncate pm-text-primary">{pl.name}</span>
                    {alreadyIn ? (
                      <Check className="h-3.5 w-3.5 shrink-0 text-[#34D399]" />
                    ) : (
                      <Plus className="h-3.5 w-3.5 shrink-0 pm-text-tertiary" />
                    )}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="px-2.5 py-1 text-[11px] pm-text-tertiary">
              Crea tu primera playlist arriba
            </div>
          )}
        </div>
      )}

      {playlistId && (
        <button
          type="button"
          role="menuitem"
          onClick={async () => {
            await removeTrackFromPlaylist(playlistId, track.id);
            closeTrackMenu();
          }}
          className="pm-hover flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left text-xs font-medium text-[#F87171]"
        >
          <Trash2 className="h-4 w-4" />
          <span>Quitar de esta playlist</span>
        </button>
      )}

      <div className="my-1 border-t pm-border" />

      <button
        type="button"
        role="menuitem"
        onClick={async () => {
          await toggleLike(track);
          closeTrackMenu();
        }}
        className="pm-hover pm-text-primary flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left text-xs font-medium"
      >
        <Heart
          className={`h-4 w-4 ${
            isLiked ? 'fill-current text-[#F43F5E]' : 'pm-text-secondary'
          }`}
        />
        <span>{isLiked ? 'Quitar de Me gusta' : 'Guardar en Me gusta'}</span>
      </button>

      <button
        type="button"
        role="menuitem"
        onClick={async () => {
          closeTrackMenu();
          await startTrackRadio(track, true);
        }}
        className="pm-hover flex w-full items-center gap-3 rounded-[12px] px-3 py-2.5 text-left text-[13px] font-medium sm:gap-2.5 sm:rounded-[10px] sm:px-2.5 sm:py-2 sm:text-xs"
      >
        <Disc3 className="h-4 w-4 opacity-90" />
        <span>Radio desde esta canción · DJ</span>
      </button>

      <button
        type="button"
        role="menuitem"
        onClick={async () => {
          closeTrackMenu();
          await startFullDjRadio();
        }}
        className="pm-hover flex w-full items-center gap-3 rounded-[12px] px-3 py-2.5 text-left text-[13px] font-medium sm:gap-2.5 sm:rounded-[10px] sm:px-2.5 sm:py-2 sm:text-xs"
      >
        <Plus className="h-4 w-4 opacity-90" />
        <span>Radio Full DJ (tus gustos mezclados)</span>
      </button>

      {trackArtists.map((ar, idx) => (
        <button
          key={`${ar.id ?? ar.name}-${idx}`}
          type="button"
          role="menuitem"
          onClick={async () => {
            closeTrackMenu();
            await openArtistDetail(ar.id ?? ar.name);
          }}
          className="pm-hover pm-text-primary flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left text-xs font-medium"
        >
          <User className="h-4 w-4 shrink-0 pm-text-secondary" />
          <span className="truncate">Ir a {ar.name}</span>
        </button>
      ))}

      {track.album?.id && (
        <button
          type="button"
          role="menuitem"
          onClick={async () => {
            closeTrackMenu();
            await openAlbumDetail(track.album!.id!, {
              title: track.album!.name,
              artist: track.artists[0]?.name,
            });
          }}
          className="pm-hover pm-text-primary flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left text-xs font-medium"
        >
          <Disc className="h-4 w-4 pm-text-secondary" />
          <span>Ir al álbum</span>
        </button>
      )}

      <button
        type="button"
        role="menuitem"
        data-testid="track-menu-credits"
        onClick={() => {
          setTrackInfoModalTrack(track);
          closeTrackMenu();
        }}
        className="pm-hover pm-text-primary flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left text-xs font-medium"
      >
        <Info className="h-4 w-4 pm-text-secondary" />
        <span>Ver créditos</span>
      </button>

      <button
        type="button"
        role="menuitem"
        onClick={async () => {
          closeTrackMenu();
          if (isDownloaded) {
            await removeOfflineTrack(track.id);
            showToast('Eliminada de descargas');
          } else {
            await downloadTrackOffline(track);
            showToast('Guardada para escuchar offline');
          }
        }}
        className="pm-hover pm-text-primary flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left text-xs font-medium"
      >
        {isDownloaded ? (
          <>
            <Trash2 className="h-4 w-4 text-[#F87171]" />
            <span>Eliminar descarga offline</span>
          </>
        ) : (
          <>
            <Download className="h-4 w-4 pm-text-secondary" />
            <span>Descargar offline</span>
          </>
        )}
      </button>

      <button
        type="button"
        role="menuitem"
        onClick={() => {
          void navigator.clipboard?.writeText(`${track.title} — ${artistName}`);
          showToast('Copiado al portapapeles');
          closeTrackMenu();
        }}
        className="pm-hover flex w-full items-center gap-3 rounded-[12px] px-3 py-2.5 text-left text-[13px] font-medium sm:gap-2.5 sm:rounded-[10px] sm:px-2.5 sm:py-2 sm:text-xs"
      >
        <Copy className="h-4 w-4 opacity-80" />
        <span>Copiar título y artista</span>
      </button>
      </div>
    </>
  );
};

export const AppToast: React.FC = () => {
  const toastMessage = usePMusicStore((s) => s.toastMessage);
  const nowPlayingOpen = usePMusicStore((s) => s.nowPlayingOpen);
  if (!toastMessage) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="app-toast"
      className={`pm-btn-primary pm-toast-enter pointer-events-none fixed left-1/2 z-[80] rounded-full border pm-border px-4 py-2 text-xs font-bold shadow-[0_14px_36px_rgba(0,0,0,0.45)] ${
        nowPlayingOpen ? 'bottom-6' : 'bottom-[156px] md:bottom-[98px]'
      }`}
    >
      {toastMessage}
    </div>
  );
};
