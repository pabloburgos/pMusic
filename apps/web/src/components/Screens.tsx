import React, { useState } from 'react';
import {
  ArrowLeft,
  Check,
  Disc3,
  Download,
  Heart,
  ListMusic,
  Loader2,
  Pause,
  Play,
  Plus,
  Search,
  Settings,
  Sliders,
  Sparkles,
  Trash2,
  Wifi,
} from 'lucide-react';
import { formatDurationSec, type Track } from '@pmusic/core';
import {
  usePMusicStore,
  type LibraryCategoryTab,
  type SearchScopeTab,
} from '../store/usePMusicStore.ts';

function getSpanishGreeting(): string {
  const hour = new Date().getHours();
  if (hour >= 6 && hour < 13) return 'Buenos días';
  if (hour >= 13 && hour < 21) return 'Buenas tardes';
  return 'Buenas noches';
}

export const TrackListRow: React.FC<{
  track: Track;
  index?: number;
  queueContext?: Track[];
}> = ({ track, index, queueContext }) => {
  const {
    currentTrack,
    isPlaying,
    likedTracks,
    offlineDownloads,
    trackAnalyses,
    playTrack,
    togglePlayPause,
    toggleLike,
    downloadTrackOffline,
    openArtistDetail,
  } = usePMusicStore();

  const isCurrent = currentTrack.id === track.id;
  const isLiked = likedTracks.some((l) => l.trackId === track.id);
  const dlStatus = offlineDownloads[track.id] ?? 'idle';
  const ana = trackAnalyses[track.id];

  return (
    <div
      role="row"
      data-surface="content"
      className={`pm-surface-card group flex h-16 items-center justify-between gap-3 rounded-[12px] px-3.5 transition-all ${
        isCurrent ? 'border-white/25 bg-[#191924]' : ''
      }`}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3.5">
        {typeof index === 'number' && (
          <span className="tabular-nums hidden w-5 text-center text-xs font-medium text-[#8E8E98] sm:inline-block">
            {isCurrent && isPlaying ? '▶' : index + 1}
          </span>
        )}

        <button
          type="button"
          aria-label={`Reproducir ${track.title}`}
          onClick={() => {
            if (isCurrent) {
              void togglePlayPause();
            } else {
              void playTrack(track, queueContext);
            }
          }}
          className="relative h-11 w-11 shrink-0 overflow-hidden rounded-[8px] bg-[#101016] shadow-md"
        >
          <img
            src={track.thumbnailUrl}
            alt={track.title}
            className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
          />
          <span
            className={`absolute inset-0 flex items-center justify-center bg-black/50 text-white transition-opacity ${
              isCurrent ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
            }`}
          >
            {isCurrent && isPlaying ? (
              <Pause className="h-4 w-4 fill-current" />
            ) : (
              <Play className="h-4 w-4 fill-current" />
            )}
          </span>
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[14px] font-medium text-[#F5F5F7]">
              {track.title}
            </span>
            {track.isExplicit && (
              <span className="rounded bg-white/10 px-1.5 py-0.2 text-[10px] font-semibold text-[#B4B4BE]">
                E
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 truncate text-[13px] text-[#B4B4BE]">
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

      <div className="flex items-center gap-2.5">
        {ana && (
          <span className="tabular-nums hidden rounded-md border border-white/[0.07] bg-[#0D0D13] px-2 py-0.5 text-[11px] font-medium text-[#B4B4BE] sm:inline-block">
            {ana.bpm} BPM
          </span>
        )}

        <button
          type="button"
          aria-label={
            isLiked
              ? `Quitar ${track.title} de Me gusta`
              : `Añadir ${track.title} a Me gusta`
          }
          aria-pressed={isLiked}
          onClick={() => void toggleLike(track)}
          className={`flex items-center justify-center rounded-lg p-2 transition-colors ${
            isLiked
              ? 'text-[#F43F5E]'
              : 'text-[#8E8E98] hover:text-[#F5F5F7]'
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
          className="flex items-center justify-center rounded-lg p-2 text-[#8E8E98] hover:text-[#F5F5F7]"
        >
          {dlStatus === 'downloading' ? (
            <Loader2 className="h-4 w-4 animate-spin text-white" />
          ) : dlStatus === 'downloaded' ? (
            <Check className="h-4 w-4 text-[#34D399]" />
          ) : (
            <Download className="h-4 w-4" />
          )}
        </button>

        <span className="tabular-nums w-11 text-right text-[12px] font-medium text-[#8E8E98]">
          {formatDurationSec(track.durationSec)}
        </span>
      </div>
    </div>
  );
};

export const DetailViewPanel: React.FC = () => {
  const {
    activeDetailView,
    closeDetailView,
    playlists,
    playTrack,
    toggleDjMode,
    renamePlaylist,
    deletePlaylist,
  } = usePMusicStore();

  const [editingName, setEditingName] = useState('');

  if (!activeDetailView) return null;

  if (activeDetailView.kind === 'artist') {
    const { artist, description, topSongs, albums } = activeDetailView.data;
    return (
      <div className="space-y-7">
        <button
          type="button"
          onClick={() => closeDetailView()}
          className="inline-flex items-center gap-2 rounded-[10px] border border-white/[0.08] bg-[#121219] px-3.5 py-2 text-xs font-medium text-[#F5F5F7] hover:bg-[#1A1A24]"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Volver</span>
        </button>

        {/* Liner-style EntityHero */}
        <div className="pm-surface-card flex flex-col gap-6 rounded-[20px] p-6 sm:flex-row sm:items-end">
          <img
            src={artist.thumbnailUrl}
            alt={artist.name}
            className="h-36 w-36 rounded-[16px] object-cover shadow-[0_20px_50px_rgba(0,0,0,0.65)] sm:h-40 sm:w-40"
          />
          <div className="flex-1 space-y-2.5">
            <div className="inline-flex items-center gap-2 rounded-md bg-white/[0.07] px-2.5 py-1 text-[11px] font-semibold tracking-wide text-[#B4B4BE]">
              <span>ARTISTA</span>
              <span>·</span>
              <span>{topSongs.length} PISTAS POPULARES</span>
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-[#F5F5F7] md:text-4xl">
              {artist.name}
            </h1>
            <p className="text-sm text-[#B4B4BE]">
              {artist.subscribersText ?? description}
            </p>
            <div className="flex flex-wrap gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => {
                  if (topSongs[0]) void playTrack(topSongs[0], topSongs);
                }}
                className="inline-flex items-center gap-2 rounded-[10px] bg-white px-5 py-2.5 text-xs font-bold text-[#08080C] shadow-sm hover:bg-white/90"
              >
                <Play className="h-4 w-4 fill-current" />
                <span>Reproducir todo</span>
              </button>
              <button
                type="button"
                onClick={async () => {
                  await toggleDjMode(true);
                  if (topSongs[0]) await playTrack(topSongs[0], topSongs);
                }}
                className="inline-flex items-center gap-2 rounded-[10px] border border-white/[0.12] bg-[#1A1A26] px-4 py-2.5 text-xs font-semibold text-[#F5F5F7] hover:bg-[#222232]"
              >
                <Disc3 className="h-4 w-4 text-[#C084FC]" />
                <span>Sesión DJ {artist.name}</span>
              </button>
            </div>
          </div>
        </div>

        <section className="space-y-2.5">
          <h2 className="text-[18px] font-semibold text-[#F5F5F7]">
            Canciones populares
          </h2>
          <div className="space-y-1.5">
            {topSongs.map((track, idx) => (
              <TrackListRow
                key={track.id}
                track={track}
                index={idx}
                queueContext={topSongs}
              />
            ))}
          </div>
        </section>

        {albums.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-[18px] font-semibold text-[#F5F5F7]">
              Discografía
            </h2>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {albums.map((al) => (
                <article
                  key={al.id}
                  data-surface="content"
                  className="pm-surface-card rounded-[14px] p-3"
                >
                  <img
                    src={al.thumbnailUrl}
                    alt={al.title}
                    className="aspect-square w-full rounded-[10px] object-cover"
                  />
                  <div className="mt-2.5 truncate text-[14px] font-medium text-[#F5F5F7]">
                    {al.title}
                  </div>
                  <div className="text-[12px] text-[#8E8E98]">
                    {al.year ?? 2024}
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}
      </div>
    );
  }

  if (activeDetailView.kind === 'album') {
    const { album, tracks } = activeDetailView.data;
    return (
      <div className="space-y-7">
        <button
          type="button"
          onClick={() => closeDetailView()}
          className="inline-flex items-center gap-2 rounded-[10px] border border-white/[0.08] bg-[#121219] px-3.5 py-2 text-xs font-medium text-[#F5F5F7] hover:bg-[#1A1A24]"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Volver</span>
        </button>

        <div className="pm-surface-card flex flex-col gap-6 rounded-[20px] p-6 sm:flex-row sm:items-end">
          <img
            src={album.thumbnailUrl}
            alt={album.title}
            className="h-36 w-36 rounded-[14px] object-cover shadow-[0_20px_50px_rgba(0,0,0,0.65)] sm:h-40 sm:w-40"
          />
          <div className="flex-1 space-y-2.5">
            <div className="inline-flex items-center gap-2 rounded-md bg-white/[0.07] px-2.5 py-1 text-[11px] font-semibold text-[#B4B4BE]">
              <span>ÁLBUM</span>
              <span>·</span>
              <span>{album.year ?? 2024}</span>
              <span>·</span>
              <span>{tracks.length} CANCIONES</span>
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-[#F5F5F7]">
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
                className="inline-flex items-center gap-2 rounded-[10px] bg-white px-5 py-2.5 text-xs font-bold text-[#08080C] hover:bg-white/90"
              >
                <Play className="h-4 w-4 fill-current" />
                <span>Reproducir álbum</span>
              </button>
            </div>
          </div>
        </div>

        <div className="space-y-1.5">
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
        <button
          type="button"
          onClick={() => closeDetailView()}
          className="inline-flex items-center gap-2 rounded-[10px] border border-white/[0.08] bg-[#121219] px-3.5 py-2 text-xs font-medium text-[#F5F5F7] hover:bg-[#1A1A24]"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Volver</span>
        </button>

        <div className="pm-surface-card flex flex-col gap-6 rounded-[20px] p-6 sm:flex-row sm:items-end">
          <img
            src={playlist.thumbnailUrl}
            alt={playlist.title}
            className="h-36 w-36 rounded-[14px] object-cover shadow-[0_20px_50px_rgba(0,0,0,0.65)] sm:h-40 sm:w-40"
          />
          <div className="flex-1 space-y-2.5">
            <div className="inline-flex items-center gap-2 rounded-md bg-white/[0.07] px-2.5 py-1 text-[11px] font-semibold text-[#B4B4BE]">
              <span>PLAYLIST</span>
              <span>·</span>
              <span>{tracks.length} CANCIONES</span>
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-[#F5F5F7]">
              {playlist.title}
            </h1>
            <p className="text-sm text-[#B4B4BE]">
              {playlist.author ?? 'pMusic Editorial'}
            </p>
            <div className="flex flex-wrap gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => {
                  if (tracks[0]) void playTrack(tracks[0], tracks);
                }}
                className="inline-flex items-center gap-2 rounded-[10px] bg-white px-5 py-2.5 text-xs font-bold text-[#08080C] hover:bg-white/90"
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
                className="inline-flex items-center gap-2 rounded-[10px] border border-white/[0.12] bg-[#1A1A26] px-4 py-2.5 text-xs font-semibold text-[#F5F5F7] hover:bg-[#222232]"
              >
                <Disc3 className="h-4 w-4 text-[#C084FC]" />
                <span>Sesión DJ AutoMix</span>
              </button>
            </div>
          </div>
        </div>

        <div className="space-y-1.5">
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

  return (
    <div className="space-y-7">
      <button
        type="button"
        onClick={() => closeDetailView()}
        className="inline-flex items-center gap-2 rounded-[10px] border border-white/[0.08] bg-[#121219] px-3.5 py-2 text-xs font-medium text-[#F5F5F7] hover:bg-[#1A1A24]"
      >
        <ArrowLeft className="h-4 w-4" />
        <span>Volver a Biblioteca</span>
      </button>

      <div className="pm-surface-card space-y-5 rounded-[20px] p-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-1.5">
            <span className="inline-block rounded-md bg-white/[0.07] px-2.5 py-1 text-[11px] font-semibold text-[#B4B4BE]">
              COLECCIÓN · {localPl.tracks.length} PISTAS
            </span>
            <h1 className="text-3xl font-bold tracking-tight text-[#F5F5F7]">
              {localPl.name}
            </h1>
            <p className="text-xs text-[#B4B4BE]">
              {localPl.description || 'Playlist personal sincronizada'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                if (localPl.tracks[0]) {
                  void playTrack(localPl.tracks[0], localPl.tracks);
                }
              }}
              className="inline-flex items-center gap-2 rounded-[10px] bg-white px-5 py-2.5 text-xs font-bold text-[#08080C] hover:bg-white/90"
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
              className="inline-flex items-center gap-2 rounded-[10px] border border-white/[0.12] bg-[#1A1A26] px-4 py-2.5 text-xs font-semibold text-[#F5F5F7]"
            >
              <Disc3 className="h-4 w-4 text-[#C084FC]" />
              <span>Sesión DJ</span>
            </button>
            <button
              type="button"
              aria-label="Eliminar playlist"
              onClick={() => void deletePlaylist(localPl.id)}
              className="rounded-[10px] border border-white/[0.08] bg-[#1A1215] px-3.5 py-2.5 text-xs font-semibold text-[#F87171]"
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
            className="rounded-[10px] border border-white/10 bg-[#0D0D13] px-3.5 py-2 text-xs text-[#F5F5F7]"
          />
          <button
            type="button"
            onClick={async () => {
              if (editingName.trim()) {
                await renamePlaylist(localPl.id, editingName.trim());
                setEditingName('');
              }
            }}
            className="rounded-[10px] border border-white/10 bg-[#181822] px-4 py-2 text-xs font-semibold text-[#F5F5F7]"
          >
            Renombrar
          </button>
        </div>
      </div>

      <div className="space-y-1.5">
        {localPl.tracks.map((t, idx) => (
          <TrackListRow
            key={t.id}
            track={t}
            index={idx}
            queueContext={localPl.tracks}
          />
        ))}
      </div>
    </div>
  );
};

export const HomeScreen: React.FC = () => {
  const {
    homeShelves,
    currentTrack,
    queue,
    djMode,
    isOfflineNetwork,
    playTrack,
    toggleDjMode,
    setImportModalOpen,
    setDevicesSheetOpen,
    setEqSheetOpen,
    setSettingsOpen,
    setNowPlayingOpen,
    setNowPlayingTab,
    openAlbumDetail,
  } = usePMusicStore();

  return (
    <div className="space-y-9">
      {/* Minimal Top Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#F5F5F7] md:text-[28px]">
            {getSpanishGreeting()}
          </h1>
          <p className="text-[13px] text-[#B4B4BE]">
            Escena Urbana Española · Bad Bunny, La Pantera, Cruz Cafuné
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            aria-pressed={djMode.enabled}
            onClick={() => void toggleDjMode()}
            className={`inline-flex items-center gap-1.5 rounded-[10px] border px-3.5 py-2 text-xs font-semibold transition-colors ${
              djMode.enabled
                ? 'border-[#C084FC]/50 bg-[#231738] text-[#F5F5F7]'
                : 'border-white/[0.08] bg-[#121219] text-[#F5F5F7] hover:bg-[#1A1A24]'
            }`}
          >
            <Disc3 className="h-4 w-4 text-[#C084FC]" />
            <span>{djMode.enabled ? 'Sesión DJ activa' : 'Modo Sesión DJ'}</span>
          </button>

          <button
            type="button"
            onClick={() => setEqSheetOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-[10px] border border-white/[0.08] bg-[#121219] px-3.5 py-2 text-xs font-medium text-[#F5F5F7] hover:bg-[#1A1A24]"
          >
            <Sliders className="h-4 w-4 text-[#B4B4BE]" />
            <span>EQ / Crossfade</span>
          </button>

          <button
            type="button"
            onClick={() => setImportModalOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-[10px] border border-white/[0.08] bg-[#121219] px-3.5 py-2 text-xs font-medium text-[#F5F5F7] hover:bg-[#1A1A24]"
          >
            <ListMusic className="h-4 w-4 text-[#B4B4BE]" />
            <span>Importar</span>
          </button>

          <button
            type="button"
            onClick={() => setDevicesSheetOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-[10px] border border-white/[0.08] bg-[#121219] px-3.5 py-2 text-xs font-medium text-[#F5F5F7] hover:bg-[#1A1A24]"
          >
            <Wifi className="h-4 w-4 text-[#34D399]" />
            <span>Dispositivos</span>
          </button>

          <button
            type="button"
            aria-label="Ajustes"
            onClick={() => setSettingsOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-[10px] border border-white/[0.08] bg-[#121219] px-3.5 py-2 text-xs font-medium text-[#F5F5F7] hover:bg-[#1A1A24]"
          >
            <Settings className="h-4 w-4 text-[#B4B4BE]" />
            <span>Ajustes</span>
          </button>
        </div>
      </div>

      {/* Liner-inspired Featured Entity Hero */}
      <section
        data-surface="content"
        className="pm-surface-card relative overflow-hidden rounded-[20px] p-6 md:p-7"
      >
        <div className="relative z-10 flex flex-col gap-6 sm:flex-row sm:items-end">
          <img
            src={currentTrack.thumbnailHighUrl ?? currentTrack.thumbnailUrl}
            alt={currentTrack.title}
            className="h-36 w-36 shrink-0 rounded-[14px] object-cover shadow-[0_24px_60px_rgba(0,0,0,0.75)] sm:h-40 sm:w-40"
          />

          <div className="min-w-0 flex-1 space-y-2.5">
            <div className="inline-flex items-center gap-2 rounded-md border border-white/[0.08] bg-[#0D0D13] px-2.5 py-1 text-[11px] font-semibold tracking-wider text-[#B4B4BE]">
              <Sparkles className="h-3 w-3 text-[#C084FC]" />
              <span>DESTACADO EN TU PERFIL · {queue.length} PISTAS</span>
            </div>

            <h2 className="truncate text-2xl font-bold tracking-tight text-[#F5F5F7] md:text-[32px]">
              {currentTrack.title}
            </h2>

            <p className="truncate text-[15px] text-[#B4B4BE]">
              {currentTrack.artists.map((a) => a.name).join(', ')}
              {currentTrack.album ? ` · ${currentTrack.album.name}` : ''}
            </p>

            <div className="flex flex-wrap items-center gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => void playTrack(currentTrack, queue)}
                className="inline-flex items-center gap-2 rounded-[10px] bg-white px-5 py-2.5 text-xs font-bold text-[#08080C] shadow-sm transition-transform hover:bg-white/90 active:scale-95"
              >
                <Play className="h-4 w-4 fill-current" />
                <span>Reproducir ahora</span>
              </button>

              <button
                type="button"
                onClick={async () => {
                  await toggleDjMode(true);
                  await playTrack(currentTrack, queue);
                }}
                className="inline-flex items-center gap-2 rounded-[10px] border border-white/[0.12] bg-[#1A1A26] px-4 py-2.5 text-xs font-semibold text-[#F5F5F7] hover:bg-[#222232]"
              >
                <Disc3 className="h-4 w-4 text-[#C084FC]" />
                <span>Sesión DJ AutoMix</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setNowPlayingOpen(true);
                  setNowPlayingTab('Letras');
                }}
                className="inline-flex items-center gap-2 rounded-[10px] border border-white/[0.08] bg-[#121219] px-4 py-2.5 text-xs font-medium text-[#B4B4BE] hover:text-white"
              >
                <span>Ver letras sincronizadas</span>
              </button>
            </div>
          </div>
        </div>
      </section>

      {isOfflineNetwork && (
        <div
          role="status"
          className="pm-surface-card rounded-2xl border border-[#FBBF24]/40 px-4 py-3 text-xs font-semibold text-[#F5F5F7]"
        >
          Modo sin conexión activo — Reproduciendo desde tu caché offline y catálogo local.
        </div>
      )}

      {/* 4 Editorial Shelves */}
      {homeShelves.map((shelf) => (
        <section key={shelf.id} className="space-y-3.5">
          <div className="flex items-baseline justify-between">
            <div>
              <h2 className="text-[20px] font-bold tracking-tight text-[#F5F5F7]">
                {shelf.title}
              </h2>
              {shelf.subtitle && (
                <p className="text-[12.5px] text-[#8E8E98]">
                  {shelf.subtitle}
                </p>
              )}
            </div>
          </div>

          {shelf.kind === 'mixes_for_you' && shelf.mixes && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {shelf.mixes.map((mix, mixIdx) => {
                const badgeHues = [
                  'from-[#581C87] to-[#1E1B4B]',
                  'from-[#0C4A6E] to-[#111827]',
                  'from-[#064E3B] to-[#111827]',
                ];
                const grad = badgeHues[mixIdx % badgeHues.length]!;
                return (
                  <article
                    key={mix.id}
                    data-surface="content"
                    className="pm-surface-card group flex flex-col justify-between overflow-hidden rounded-[16px] p-4"
                  >
                    <div className="relative aspect-[16/10] w-full overflow-hidden rounded-[12px] bg-[#0D0D13]">
                      <img
                        src={mix.coverUrl}
                        alt={mix.title}
                        className="h-full w-full object-cover opacity-85 transition-transform duration-300 group-hover:scale-105"
                      />
                      <div
                        className={`absolute inset-0 bg-gradient-to-t ${grad} opacity-60`}
                      />
                      <div className="absolute top-3 left-3 rounded-md bg-black/60 px-2.5 py-1 text-[10px] font-bold tracking-wider text-white">
                        DAILY MIX · AUTOMIX
                      </div>
                    </div>

                    <div className="mt-3.5 space-y-1">
                      <h3 className="truncate text-[16px] font-bold text-[#F5F5F7]">
                        {mix.title}
                      </h3>
                      <p className="line-clamp-2 text-[12.5px] text-[#B4B4BE]">
                        {mix.subtitle}
                      </p>
                    </div>

                    <div className="mt-4 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          if (mix.tracks[0]) void playTrack(mix.tracks[0], mix.tracks);
                        }}
                        className="flex flex-1 items-center justify-center gap-1.5 rounded-[10px] bg-white py-2 text-xs font-bold text-[#08080C] hover:bg-white/90"
                      >
                        <Play className="h-3.5 w-3.5 fill-current" />
                        <span>Reproducir Mix</span>
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          await toggleDjMode(true);
                          if (mix.tracks[0]) await playTrack(mix.tracks[0], mix.tracks);
                        }}
                        className="flex items-center justify-center gap-1 rounded-[10px] border border-white/[0.12] bg-[#1A1A26] px-3.5 py-2 text-xs font-semibold text-[#F5F5F7] hover:bg-[#222232]"
                      >
                        <Disc3 className="h-3.5 w-3.5 text-[#C084FC]" />
                        <span>DJ</span>
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}

          {shelf.kind === 'favorite_new_releases' && shelf.albums && (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-5">
              {shelf.albums.map((album) => (
                <article
                  key={album.id}
                  data-surface="content"
                  className="pm-surface-card group flex flex-col rounded-[14px] p-3"
                >
                  <button
                    type="button"
                    onClick={() => void openAlbumDetail(album.id)}
                    className="text-left"
                  >
                    <div className="overflow-hidden rounded-[10px] bg-[#0D0D13] shadow-md">
                      <img
                        src={album.thumbnailUrl}
                        alt={album.title}
                        className="aspect-square w-full object-cover transition-transform duration-300 group-hover:scale-105"
                      />
                    </div>
                    <div className="mt-2.5 truncate text-[14px] font-medium text-[#F5F5F7]">
                      {album.title}
                    </div>
                    <div className="truncate text-[12px] text-[#8E8E98]">
                      {album.artists.map((a) => a.name).join(', ')} · {album.year ?? 2024}
                    </div>
                  </button>
                </article>
              ))}
            </div>
          )}

          {(shelf.kind === 'listen_again' ||
            shelf.kind === 'because_you_listened') &&
            shelf.tracks && (
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                {shelf.tracks.slice(0, 6).map((track, idx) => (
                  <TrackListRow
                    key={`${shelf.id}-${track.id}`}
                    track={track}
                    index={idx}
                    queueContext={shelf.tracks}
                  />
                ))}
              </div>
            )}
        </section>
      ))}
    </div>
  );
};

export const SearchScreen: React.FC = () => {
  const {
    searchQuery,
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
        <h1 className="text-2xl font-bold tracking-tight text-[#F5F5F7] md:text-[28px]">
          Buscar
        </h1>
        <p className="text-[13px] text-[#8E8E98]">
          Algoritmo personalizado · Priorizando tus artistas y escena urbana española
        </p>
      </div>

      {/* Sleek Quiet-Fill Search Box */}
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          void submitSearch();
        }}
        className="flex items-center gap-3 rounded-[14px] border border-white/[0.10] bg-[#121219] px-4 py-2.5 focus-within:border-white/30"
      >
        <Search className="h-5 w-5 text-[#8E8E98]" />
        <input
          type="search"
          role="searchbox"
          aria-label="Buscar canciones, artistas o álbumes"
          placeholder="Buscar artistas, canciones, álbumes (ej. Cruz Cafuné, La Pantera, Bad Bunny)..."
          value={searchQuery}
          onChange={(e) => void setSearchQuery(e.target.value)}
          className="flex-1 bg-transparent text-[14px] font-medium text-[#F5F5F7] placeholder:text-[#8E8E98] focus:outline-none"
        />
        {searchQuery && (
          <button
            type="button"
            aria-label="Limpiar búsqueda"
            onClick={() => void setSearchQuery('')}
            className="rounded-lg bg-white/[0.08] px-3 py-1 text-xs font-medium text-[#B4B4BE] hover:text-white"
          >
            Limpiar
          </button>
        )}
      </form>

      {/* Autocomplete Chips & Recent Searches */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {autocompleteSuggestions.slice(0, 6).map((sug) => (
            <button
              key={sug.text}
              type="button"
              onClick={() => void submitSearch(sug.text)}
              className="rounded-[9px] border border-white/[0.07] bg-[#121219] px-3 py-1.5 text-xs font-medium text-[#F5F5F7] hover:bg-[#1A1A24]"
            >
              {sug.text}
            </button>
          ))}
        </div>

        {recentSearches.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-[#8E8E98]">Recientes:</span>
            {recentSearches.slice(0, 3).map((rec) => (
              <button
                key={rec}
                type="button"
                onClick={() => void submitSearch(rec)}
                className="rounded-lg bg-[#0D0D13] px-2.5 py-1 text-xs text-[#B4B4BE] hover:text-white"
              >
                {rec}
              </button>
            ))}
            <button
              type="button"
              onClick={() => clearRecentSearches()}
              className="text-xs font-medium text-[#F5F5F7] underline-offset-2 hover:underline"
            >
              Borrar historial
            </button>
          </div>
        )}
      </div>

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
              className={`rounded-[10px] px-4 py-2 text-xs font-bold transition-colors ${
                active
                  ? 'bg-white text-[#08080C]'
                  : 'border border-white/[0.07] bg-[#121219] text-[#B4B4BE] hover:text-white'
              }`}
            >
              {scope}
            </button>
          );
        })}
      </div>

      {/* Hero Best Result Card (Mejor resultado) */}
      {(searchScope === 'Todo' || searchScope === 'Artistas' || searchScope === 'Canciones') &&
        bestResult && (
          <section className="space-y-2.5">
            <h2 className="text-[16px] font-semibold text-[#F5F5F7]">
              Mejor resultado
            </h2>
            <div
              data-testid="best-result-card"
              data-surface="content"
              className="pm-surface-card flex flex-wrap items-center justify-between gap-4 rounded-[18px] p-5"
            >
              {bestResult.kind === 'artist' && (
                <>
                  <div className="flex items-center gap-4">
                    <img
                      src={bestResult.item.thumbnailUrl}
                      alt={bestResult.item.name}
                      className="h-20 w-20 rounded-full object-cover shadow-lg"
                    />
                    <div>
                      <span className="inline-block rounded-md bg-white/[0.08] px-2.5 py-0.5 text-[11px] font-semibold text-[#B4B4BE]">
                        ARTISTA DESTACADO
                      </span>
                      <h3 className="mt-1 text-xl font-bold text-[#F5F5F7]">
                        {bestResult.item.name}
                      </h3>
                      <p className="text-xs text-[#8E8E98]">
                        {bestResult.item.subscribersText ?? 'Escena Urbana Española'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void openArtistDetail(bestResult.item.id)}
                      className="rounded-[10px] border border-white/[0.10] bg-[#1A1A26] px-4 py-2 text-xs font-semibold text-[#F5F5F7]"
                    >
                      Ver perfil
                    </button>
                    <button
                      type="button"
                      aria-label={`Reproducir ${bestResult.item.name}`}
                      onClick={() => {
                        const song =
                          searchResults.songs.find((s) =>
                            s.artists.some((a) => a.name === bestResult.item.name)
                          ) ?? searchResults.songs[0];
                        if (song) void playTrack(song, searchResults.songs);
                      }}
                      className="inline-flex items-center gap-1.5 rounded-[10px] bg-white px-4 py-2 text-xs font-bold text-[#08080C]"
                    >
                      <Play className="h-4 w-4 fill-current" />
                      <span>Reproducir</span>
                    </button>
                  </div>
                </>
              )}

              {bestResult.kind === 'song' && (
                <>
                  <div className="flex items-center gap-4">
                    <img
                      src={bestResult.item.thumbnailUrl}
                      alt={bestResult.item.title}
                      className="h-20 w-20 rounded-[12px] object-cover shadow-lg"
                    />
                    <div>
                      <span className="inline-block rounded-md bg-white/[0.08] px-2.5 py-0.5 text-[11px] font-semibold text-[#B4B4BE]">
                        CANCIÓN
                      </span>
                      <h3 className="mt-1 text-xl font-bold text-[#F5F5F7]">
                        {bestResult.item.title}
                      </h3>
                      <p className="text-xs text-[#8E8E98]">
                        {bestResult.item.artists.map((a) => a.name).join(', ')}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    aria-label={`Reproducir ${bestResult.item.title}`}
                    onClick={() =>
                      void playTrack(bestResult.item, searchResults.songs)
                    }
                    className="inline-flex items-center gap-1.5 rounded-[10px] bg-white px-4 py-2 text-xs font-bold text-[#08080C]"
                  >
                    <Play className="h-4 w-4 fill-current" />
                    <span>Reproducir</span>
                  </button>
                </>
              )}
            </div>
          </section>
        )}

      {/* Songs Section */}
      {(searchScope === 'Todo' || searchScope === 'Canciones') && (
        <section className="space-y-2.5">
          <h2 className="text-[16px] font-semibold text-[#F5F5F7]">Canciones</h2>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
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

      {/* Artists Section */}
      {(searchScope === 'Todo' || searchScope === 'Artistas') && (
        <section className="space-y-2.5">
          <h2 className="text-[16px] font-semibold text-[#F5F5F7]">Artistas</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {searchResults.artists.map((artist) => (
              <article
                key={artist.id}
                data-surface="content"
                className="pm-surface-card flex flex-col items-center rounded-[16px] p-4 text-center"
              >
                <img
                  src={artist.thumbnailUrl}
                  alt={artist.name}
                  className="h-20 w-20 rounded-full object-cover shadow-md"
                />
                <div className="mt-2.5 truncate text-[14px] font-semibold text-[#F5F5F7]">
                  {artist.name}
                </div>
                <div className="text-xs text-[#8E8E98]">
                  {artist.subscribersText ?? 'Artista'}
                </div>
                <button
                  type="button"
                  onClick={() => void openArtistDetail(artist.id)}
                  className="mt-3 rounded-[9px] border border-white/[0.08] bg-[#0D0D13] px-3.5 py-1.5 text-xs font-semibold text-[#F5F5F7] hover:bg-white hover:text-[#08080C]"
                >
                  Ver artista
                </button>
              </article>
            ))}
          </div>
        </section>
      )}

      {/* Albums Section */}
      {(searchScope === 'Todo' || searchScope === 'Álbumes') && (
        <section className="space-y-2.5">
          <h2 className="text-[16px] font-semibold text-[#F5F5F7]">Álbumes</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {searchResults.albums.map((album) => (
              <article
                key={album.id}
                data-surface="content"
                className="pm-surface-card rounded-[14px] p-3"
              >
                <button
                  type="button"
                  onClick={() => void openAlbumDetail(album.id)}
                  className="w-full text-left"
                >
                  <img
                    src={album.thumbnailUrl}
                    alt={album.title}
                    className="aspect-square w-full rounded-[10px] object-cover"
                  />
                  <div className="mt-2 truncate text-[14px] font-medium text-[#F5F5F7]">
                    {album.title}
                  </div>
                  <div className="truncate text-xs text-[#8E8E98]">
                    {album.artists.map((a) => a.name).join(', ')}
                  </div>
                </button>
              </article>
            ))}
          </div>
        </section>
      )}

      {/* Playlists Section */}
      {(searchScope === 'Todo' || searchScope === 'Playlists') && (
        <section className="space-y-2.5">
          <h2 className="text-[16px] font-semibold text-[#F5F5F7]">Playlists</h2>
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            {searchResults.playlists.map((pl) => (
              <article
                key={pl.id}
                data-surface="content"
                className="pm-surface-card flex items-center justify-between gap-4 rounded-[16px] p-4"
              >
                <div className="flex items-center gap-3.5">
                  <img
                    src={pl.thumbnailUrl}
                    alt={pl.title}
                    className="h-16 w-16 rounded-[10px] object-cover"
                  />
                  <div>
                    <div className="text-[15px] font-bold text-[#F5F5F7]">
                      {pl.title}
                    </div>
                    <div className="text-xs text-[#8E8E98]">
                      {pl.author ?? 'pMusic'} · {pl.trackCount ?? 12} canciones
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void openPlaylistDetail(pl.id)}
                  className="rounded-[10px] bg-white px-4 py-2 text-xs font-bold text-[#08080C]"
                >
                  Abrir
                </button>
              </article>
            ))}
          </div>
        </section>
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
    openLocalPlaylistDetail,
    setImportModalOpen,
    removeOfflineTrack,
  } = usePMusicStore();

  const [newPlaylistName, setNewPlaylistName] = useState('');

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
          <h1 className="text-2xl font-bold tracking-tight text-[#F5F5F7] md:text-[28px]">
            Biblioteca
          </h1>
          <p className="text-[13px] text-[#8E8E98]">
            Colección sincronizada entre tu móvil Android y tu PC Windows
          </p>
        </div>

        <button
          type="button"
          onClick={() => setImportModalOpen(true)}
          className="inline-flex items-center gap-2 rounded-[10px] bg-white px-4 py-2 text-xs font-bold text-[#08080C] hover:bg-white/90"
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
                className={`rounded-[10px] px-4 py-1.5 text-xs font-bold ${
                  active
                    ? 'bg-white text-[#08080C]'
                    : 'border border-white/[0.07] bg-[#121219] text-[#B4B4BE] hover:text-white'
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
          className="rounded-[10px] border border-white/10 bg-[#121219] px-3.5 py-2 text-xs text-[#F5F5F7] placeholder:text-[#8E8E98]"
        />
      </div>

      {/* Create New Playlist Quick Bar */}
      {(libraryCategory === 'Todo' || libraryCategory === 'Playlists') && (
        <div className="pm-surface-card flex flex-wrap items-center gap-2.5 rounded-[16px] p-4">
          <input
            type="text"
            aria-label="Nombre de la nueva playlist"
            placeholder="Nueva playlist (ej. Sesión Canarias)..."
            value={newPlaylistName}
            onChange={(e) => setNewPlaylistName(e.target.value)}
            className="flex-1 rounded-[10px] border border-white/10 bg-[#0D0D13] px-3.5 py-2 text-xs text-[#F5F5F7] placeholder:text-[#8E8E98]"
          />
          <button
            type="button"
            onClick={async () => {
              const name = newPlaylistName.trim() || 'Mi Playlist pMusic';
              await createPlaylist(
                name,
                'Creada en pMusic',
                searchResults.songs.slice(0, 4)
              );
              setNewPlaylistName('');
            }}
            className="inline-flex items-center gap-1.5 rounded-[10px] bg-white px-4 py-2 text-xs font-bold text-[#08080C]"
          >
            <Plus className="h-4 w-4" />
            <span>Crear playlist</span>
          </button>
        </div>
      )}

      {/* Playlists Section */}
      {(libraryCategory === 'Todo' || libraryCategory === 'Playlists') && (
        <section className="space-y-3">
          <h2 className="text-[16px] font-semibold text-[#F5F5F7]">
            Tus Playlists ({filteredPlaylists.length})
          </h2>
          {filteredPlaylists.length > 0 ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {filteredPlaylists.map((pl) => (
                <article
                  key={pl.id}
                  data-surface="content"
                  className="pm-surface-card flex items-center justify-between gap-3 rounded-[14px] p-4"
                >
                  <div>
                    <h3 className="text-[15px] font-bold text-[#F5F5F7]">
                      {pl.name}
                    </h3>
                    <p className="text-xs text-[#8E8E98]">
                      {pl.tracks.length} canciones · {pl.source}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => openLocalPlaylistDetail(pl.id)}
                      className="rounded-[9px] bg-white px-3.5 py-1.5 text-xs font-bold text-[#08080C]"
                    >
                      Ver
                    </button>
                    <button
                      type="button"
                      aria-label={`Eliminar ${pl.name}`}
                      onClick={() => void deletePlaylist(pl.id)}
                      className="rounded-[9px] bg-[#0D0D13] p-2 text-[#8E8E98] hover:text-[#F87171]"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </article>
              ))}
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
        <section className="space-y-3">
          <h2 className="text-[16px] font-semibold text-[#F5F5F7]">
            Canciones que te gustan ({filteredLikes.length})
          </h2>
          {filteredLikes.length > 0 ? (
            <div className="space-y-1.5">
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
        <section className="space-y-3">
          <h2 className="text-[16px] font-semibold text-[#F5F5F7]">
            En este dispositivo · Offline ({offlineEntries.length})
          </h2>
          {offlineEntries.length > 0 ? (
            <div className="space-y-1.5">
              {offlineEntries.map((entry) => {
                const track =
                  searchResults.songs.find((s) => s.id === entry.trackId) ??
                  searchResults.songs[0]!;
                return (
                  <div
                    key={entry.trackId}
                    className="pm-surface-card flex items-center justify-between rounded-[12px] p-3.5"
                  >
                    <div>
                      <div className="text-sm font-semibold text-[#F5F5F7]">
                        {track.title}
                      </div>
                      <div className="text-xs text-[#8E8E98]">
                        Disponible sin conexión · {(entry.sizeBytes / 1024).toFixed(0)} KB
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void removeOfflineTrack(entry.trackId)}
                      className="rounded-lg bg-[#0D0D13] px-3 py-1.5 text-xs font-semibold text-[#F87171]"
                    >
                      Borrar descarga
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-[#8E8E98]">
              Descarga canciones con el icono de flecha para escucharlas en tu móvil sin gastar datos.
            </p>
          )}
        </section>
      )}

      {/* Listening History Section */}
      {(libraryCategory === 'Todo' || libraryCategory === 'Historial') && (
        <section className="space-y-3">
          <h2 className="text-[16px] font-semibold text-[#F5F5F7]">
            Historial reciente ({playHistory.length})
          </h2>
          {playHistory.length > 0 ? (
            <div className="space-y-1.5">
              {playHistory.slice(0, 12).map((h, idx) => (
                <TrackListRow key={h.id} track={h.track} index={idx} />
              ))}
            </div>
          ) : (
            <p className="text-xs text-[#8E8E98]">
              Tu historial alimenta automáticamente el algoritmo de recomendaciones.
            </p>
          )}
        </section>
      )}
    </div>
  );
};
