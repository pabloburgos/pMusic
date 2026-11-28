import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Check,
  ChevronRight,
  Copy,
  Disc3,
  Download,
  ListPlus,
  Loader2,
  Palette,
  Pencil,
  Play,
  Share2,
  Shuffle,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react';
import { getSyncSupabaseClient, usePMusicStore } from '../store/usePMusicStore.ts';
import { buildPlaylistShareUrl, publishOrUpdateSharedPlaylistLink } from '../services/social-service.ts';
import { PlaylistCoverArt } from './PlaylistCoverArt.tsx';
import { formatPlaylistDuration, resolvePlaylistCoverInfo } from '../utils/playlist-artwork.ts';

export const PlaylistOptionsMenu: React.FC = React.memo(() => {
  const open = usePMusicStore((s) => Boolean(s.playlistContextMenu));
  if (!open) return null;
  return <PlaylistOptionsMenuInner />;
});
PlaylistOptionsMenu.displayName = 'PlaylistOptionsMenu';

const PlaylistOptionsMenuInner: React.FC = () => {
  const {
    playlistContextMenu,
    playlists,
    sharedPlaylists,
    playlistAppearances,
    offlineDownloads,
    playlistDownloadProgress,
    authState,
    userProfile,
    closePlaylistContextMenu,
    openPlaylistAppearanceModal,
    playCollection,
    toggleDjMode,
    recordPlaylistPlay,
    renamePlaylist,
    duplicatePlaylist,
    copyPlaylistTracksTo,
    togglePlaylistCollaborative,
    setPlaylistShareMetadata,
    deletePlaylist,
    deleteOrLeaveSharedPlaylistById,
    openLocalPlaylistDetail,
    openSharedPlaylistDetail,
    downloadPlaylistOffline,
    showToast,
  } = usePMusicStore();

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showCopyMenu, setShowCopyMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');

  useEffect(() => {
    setConfirmDelete(false);
    setShowCopyMenu(false);
    setRenaming(false);
    setRenameValue('');
  }, [playlistContextMenu?.playlistId, playlistContextMenu?.kind]);

  useEffect(() => {
    if (!playlistContextMenu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closePlaylistContextMenu();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [playlistContextMenu, closePlaylistContextMenu]);

  if (!playlistContextMenu || typeof document === 'undefined') return null;

  const isLocal = playlistContextMenu.kind === 'local';
  const localPl = isLocal
    ? playlists.find((p) => p.id === playlistContextMenu.playlistId)
    : undefined;
  const sharedPl = !isLocal
    ? sharedPlaylists.find((p) => p.id === playlistContextMenu.playlistId)
    : undefined;

  const target = localPl ?? sharedPl;
  if (!target) return null;

  const tracks = target.tracks ?? [];
  const savedApp = playlistAppearances[target.id];
  const coverInfo = resolvePlaylistCoverInfo(target, savedApp);
  const durationLabel = formatPlaylistDuration(
    tracks.reduce((acc, t) => acc + (t.durationSec || 0), 0)
  );
  const otherPlaylists = isLocal ? playlists.filter((p) => p.id !== target.id) : [];

  const isDownloadingThis = playlistDownloadProgress?.playlistId === target.id;
  const allDownloaded =
    tracks.length > 0 && tracks.every((t) => offlineDownloads[t.id] === 'downloaded');
  const isSharedOwner = sharedPl ? sharedPl.ownerId === authState.userId : true;
  const deleteLabel =
    !isLocal && !isSharedOwner ? 'Salir de la lista' : 'Eliminar playlist';

  const winW = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const winH = typeof window !== 'undefined' ? window.innerHeight : 800;
  const menuW = 268;
  const estH = 440;
  const left = Math.max(12, Math.min(playlistContextMenu.x, winW - menuW - 12));
  const top = Math.max(12, Math.min(playlistContextMenu.y, winH - estH - 12));

  const copyShareUrl = async (shareCode?: string | null) => {
    const sb = getSyncSupabaseClient();
    if (isLocal && localPl && sb && authState.connected && authState.userId) {
      try {
        const synced = await publishOrUpdateSharedPlaylistLink(sb, {
          ownerId: authState.userId,
          name: localPl.name,
          description: localPl.description,
          tracks: localPl.tracks,
          isCollaborative: Boolean(localPl.isCollaborative),
          existingShareCode: shareCode ?? localPl.shareCode,
          ownerProfile: userProfile,
        });
        await setPlaylistShareMetadata(localPl.id, {
          shareCode: synced.shareCode ?? localPl.shareCode,
          isCollaborative: Boolean(localPl.isCollaborative),
          isPublicLink: true,
        });
        const url = buildPlaylistShareUrl(synced.shareCode ?? '');
        await navigator.clipboard?.writeText(url).catch(() => {});
        showToast('Enlace de playlist copiado');
        return;
      } catch {
        // fallback below
      }
    }
    if (shareCode) {
      const url = buildPlaylistShareUrl(shareCode);
      await navigator.clipboard?.writeText(url).catch(() => {});
      showToast('Enlace de playlist copiado');
      return;
    }
    const textList = tracks
      .slice(0, 12)
      .map((t, i) => `${i + 1}. ${t.title} — ${t.artists.map((a) => a.name).join(', ')}`)
      .join('\n');
    await navigator.clipboard
      ?.writeText(`Playlist pMusic: ${target.name} (${tracks.length} pistas)\n${textList}`)
      .catch(() => {});
    showToast('Lista copiada al portapapeles');
  };

  return createPortal(
    <>
      <div
        aria-hidden="true"
        onClick={closePlaylistContextMenu}
        onContextMenu={(e) => {
          e.preventDefault();
          closePlaylistContextMenu();
        }}
        className="fixed inset-0 z-[9998]"
      />
      <div
        role="menu"
        aria-label={`Opciones de ${target.name}`}
        data-testid="playlist-actions-menu"
        style={{
          left,
          top,
          width: menuW,
          maxHeight: 'calc(100vh - 24px)',
          background: 'color-mix(in srgb, var(--pm-bg-surface) 96%, transparent)',
        }}
        className="pm-glass-frosted-neutral pm-hud-dark pm-menu-pop fixed z-[9999] overflow-y-auto rounded-[18px] border border-white/15 p-1.5 shadow-[0_24px_64px_rgba(0,0,0,0.72)]"
      >
        {/* Header Summary */}
        <div className="mb-1 flex items-center gap-2.5 border-b border-white/10 px-2.5 py-2">
          <div className="relative h-9 w-9 shrink-0 overflow-hidden rounded-[8px]">
            <PlaylistCoverArt
              coverInfo={coverInfo}
              title={target.name}
              artistName={tracks[0]?.artists[0]?.name}
              variant="list"
              iconClassName="h-4 w-4"
            />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-bold text-white">{target.name}</div>
            <div className="truncate text-[10.5px] text-white/60">
              {tracks.length} pistas{durationLabel ? ` · ${durationLabel}` : ''}
            </div>
          </div>
        </div>

        <button
          type="button"
          role="menuitem"
          disabled={tracks.length === 0}
          onClick={() => {
            closePlaylistContextMenu();
            if (tracks.length > 0) {
              if (localPl) recordPlaylistPlay(localPl);
              void playCollection(tracks, { isPlaylist: true });
            }
          }}
          className="pm-hover flex w-full items-center gap-2.5 rounded-[10px] px-3 py-2 text-left text-xs font-medium text-white disabled:opacity-40"
        >
          <Play className="h-4 w-4 text-white/75" />
          <span>Reproducir</span>
        </button>

        <button
          type="button"
          role="menuitem"
          disabled={tracks.length === 0}
          onClick={() => {
            closePlaylistContextMenu();
            if (tracks.length > 0) {
              if (localPl) recordPlaylistPlay(localPl);
              void playCollection(tracks, { isPlaylist: true, forceShuffle: true });
            }
          }}
          className="pm-hover flex w-full items-center gap-2.5 rounded-[10px] px-3 py-2 text-left text-xs font-medium text-white disabled:opacity-40"
        >
          <Shuffle className="h-4 w-4 text-white/75" />
          <span>Reproducir en aleatorio</span>
        </button>

        <button
          type="button"
          role="menuitem"
          data-testid="playlist-menu-dj-btn"
          disabled={tracks.length === 0}
          onClick={() => {
            closePlaylistContextMenu();
            if (tracks.length > 0) {
              if (localPl) recordPlaylistPlay(localPl);
              void playCollection(tracks, { isPlaylist: true }).then(() => {
                void toggleDjMode(true);
              });
            }
          }}
          className="pm-hover flex w-full items-center gap-2.5 rounded-[10px] px-3 py-2 text-left text-xs font-medium text-white disabled:opacity-40"
        >
          <Disc3 className="h-4 w-4 text-purple-300" />
          <span>Iniciar Sesión DJ AutoMix</span>
        </button>

        <button
          type="button"
          role="menuitem"
          onClick={() => openPlaylistAppearanceModal(playlistContextMenu.kind, target.id)}
          className="pm-hover flex w-full items-center gap-2.5 rounded-[10px] px-3 py-2 text-left text-xs font-medium text-white"
        >
          <Palette className="h-4 w-4 text-purple-300" />
          <span>Personalizar portada y banner</span>
        </button>

        <button
          type="button"
          role="menuitem"
          disabled={tracks.length === 0 || isDownloadingThis}
          onClick={() => {
            closePlaylistContextMenu();
            void downloadPlaylistOffline(target.id, tracks, target.name);
          }}
          className="pm-hover flex w-full items-center justify-between gap-2 rounded-[10px] px-3 py-2 text-left text-xs font-medium text-white disabled:opacity-50"
        >
          <span className="flex items-center gap-2.5">
            {isDownloadingThis ? (
              <Loader2 className="h-4 w-4 animate-spin text-emerald-400" />
            ) : allDownloaded ? (
              <Check className="h-4 w-4 text-emerald-400" />
            ) : (
              <Download className="h-4 w-4 text-white/75" />
            )}
            <span>
              {isDownloadingThis
                ? `Descargando (${playlistDownloadProgress.completed}/${playlistDownloadProgress.total})`
                : allDownloaded
                  ? 'Descargada offline'
                  : 'Descargar playlist entera'}
            </span>
          </span>
        </button>

        {isLocal && localPl && (
          <>
            {renaming ? (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (renameValue.trim()) {
                    await renamePlaylist(localPl.id, renameValue.trim());
                    showToast('Nombre actualizado');
                  }
                  closePlaylistContextMenu();
                }}
                className="mx-1 my-1 flex items-center gap-1.5 rounded-[10px] bg-white/[0.06] p-1.5"
              >
                <input
                  type="text"
                  autoFocus
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  className="pm-input min-w-0 flex-1 rounded-full px-2.5 py-1 text-xs text-white"
                />
                <button
                  type="submit"
                  className="rounded-full bg-white px-2.5 py-1 text-[11px] font-bold text-[#070709]"
                >
                  OK
                </button>
              </form>
            ) : (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setRenameValue(localPl.name);
                  setRenaming(true);
                }}
                className="pm-hover flex w-full items-center gap-2.5 rounded-[10px] px-3 py-2 text-left text-xs font-medium text-white"
              >
                <Pencil className="h-4 w-4 text-white/75" />
                <span>Renombrar playlist</span>
              </button>
            )}

            <button
              type="button"
              role="menuitem"
              onClick={() => setShowCopyMenu((v) => !v)}
              className="pm-hover flex w-full items-center justify-between rounded-[10px] px-3 py-2 text-left text-xs font-medium text-white"
            >
              <span className="flex items-center gap-2.5">
                <ListPlus className="h-4 w-4 text-white/75" />
                <span>Añadir a otra playlist</span>
              </span>
              <ChevronRight className="h-3.5 w-3.5 text-white/55" />
            </button>

            {showCopyMenu && (
              <div className="mx-1.5 my-1 max-h-36 space-y-0.5 overflow-y-auto rounded-[10px] border border-white/10 bg-black/30 p-1">
                {otherPlaylists.length > 0 ? (
                  otherPlaylists.map((dst) => (
                    <button
                      key={dst.id}
                      type="button"
                      onClick={async () => {
                        await copyPlaylistTracksTo(localPl.id, dst.id);
                        closePlaylistContextMenu();
                      }}
                      className="pm-hover flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-[11.5px] font-medium text-white"
                    >
                      <span className="truncate">{dst.name}</span>
                      <span className="ml-2 shrink-0 text-[10.5px] text-white/55">
                        {dst.tracks.length}
                      </span>
                    </button>
                  ))
                ) : (
                  <div className="px-2.5 py-1.5 text-[11px] text-white/55">
                    Crea otra playlist primero
                  </div>
                )}
              </div>
            )}

            <button
              type="button"
              role="menuitem"
              onClick={async () => {
                closePlaylistContextMenu();
                const dup = await duplicatePlaylist(localPl.id);
                if (dup) openLocalPlaylistDetail(dup.id);
              }}
              className="pm-hover flex w-full items-center gap-2.5 rounded-[10px] px-3 py-2 text-left text-xs font-medium text-white"
            >
              <Copy className="h-4 w-4 text-white/75" />
              <span>Duplicar playlist</span>
            </button>

            <button
              type="button"
              role="menuitem"
              onClick={async () => {
                closePlaylistContextMenu();
                await togglePlaylistCollaborative(localPl.id);
              }}
              className="pm-hover flex w-full items-center gap-2.5 rounded-[10px] px-3 py-2 text-left text-xs font-medium text-white"
            >
              <Users className="h-4 w-4 text-emerald-400" />
              <span>
                {localPl.isCollaborative
                  ? 'Desactivar lista colaborativa'
                  : 'Hacer lista colaborativa'}
              </span>
            </button>

            <button
              type="button"
              role="menuitem"
              onClick={async () => {
                closePlaylistContextMenu();
                openLocalPlaylistDetail(localPl.id);
                if (!localPl.shareCode && authState.connected) {
                  const synced = await togglePlaylistCollaborative(localPl.id);
                  await copyShareUrl(synced?.shareCode ?? localPl.shareCode);
                } else {
                  await copyShareUrl(localPl.shareCode);
                }
              }}
              className="pm-hover flex w-full items-center gap-2.5 rounded-[10px] px-3 py-2 text-left text-xs font-medium text-white"
            >
              <UserPlus className="h-4 w-4 text-white/75" />
              <span>Invitar amigo o copiar link</span>
            </button>
          </>
        )}

        {!isLocal && sharedPl && (
          <button
            type="button"
            role="menuitem"
            onClick={async () => {
              closePlaylistContextMenu();
              openSharedPlaylistDetail(sharedPl.id);
              await copyShareUrl(sharedPl.shareCode);
            }}
            className="pm-hover flex w-full items-center gap-2.5 rounded-[10px] px-3 py-2 text-left text-xs font-medium text-white"
          >
            <UserPlus className="h-4 w-4 text-emerald-400" />
            <span>Copiar link de colaboración</span>
          </button>
        )}

        <button
          type="button"
          role="menuitem"
          onClick={async () => {
            closePlaylistContextMenu();
            await copyShareUrl(localPl?.shareCode ?? sharedPl?.shareCode);
          }}
          className="pm-hover flex w-full items-center gap-2.5 rounded-[10px] px-3 py-2 text-left text-xs font-medium text-white"
        >
          <Share2 className="h-4 w-4 text-white/75" />
          <span>Compartir lista</span>
        </button>

        <div className="my-1 border-t border-white/10" />

        {confirmDelete ? (
          <div className="flex items-center justify-between gap-1.5 rounded-[10px] bg-rose-500/20 px-2.5 py-2">
            <span className="text-[11px] font-semibold text-rose-300">¿Confirmar?</span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                data-testid="confirm-delete-playlist-btn"
                onClick={async () => {
                  const delId = target.id;
                  const delKind = playlistContextMenu.kind;
                  closePlaylistContextMenu();
                  if (delKind === 'local') {
                    await deletePlaylist(delId);
                  } else {
                    await deleteOrLeaveSharedPlaylistById(delId);
                  }
                }}
                className="rounded-full bg-rose-500 px-2.5 py-1 text-[11px] font-bold text-white"
              >
                {!isLocal && !isSharedOwner ? 'Salir' : 'Eliminar'}
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="rounded-full bg-white/10 px-2 py-1 text-[11px] font-semibold text-white"
              >
                No
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            role="menuitem"
            aria-label={deleteLabel}
            onClick={() => setConfirmDelete(true)}
            className="flex w-full items-center gap-2.5 rounded-[10px] px-3 py-2 text-left text-xs font-semibold text-rose-400 hover:bg-rose-500/15"
          >
            <Trash2 className="h-4 w-4" />
            <span>{deleteLabel}</span>
          </button>
        )}
      </div>
    </>,
    document.body
  );
};
