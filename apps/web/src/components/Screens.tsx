import React, { useState } from 'react';
import {
  ArrowLeft,
  Check,
  Disc3,
  Download,
  Heart,
  ListMusic,
  Loader2,
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
  queueContext?: Track[];
}> = ({ track, queueContext }) => {
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
      className={`pm-surface-card flex items-center justify-between gap-3 rounded-xl px-3.5 py-2.5 transition-colors ${
        isCurrent ? 'border-[#0A84FF]' : ''
      }`}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
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
          className="relative h-12 w-12 shrink-0 overflow-hidden rounded-[10px] bg-[#111116]"
        >
          <img
            src={track.thumbnailUrl}
            alt={track.title}
            className="h-full w-full object-cover"
          />
          <span className="absolute inset-0 flex items-center justify-center bg-black/45 text-white">
            <Play className="h-4 w-4 fill-current" />
          </span>
        </button>

        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-[#F5F5F7]">
            {track.title}
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-[#AEAEB2]">
            {track.artists.map((artist, idx) => (
              <React.Fragment key={`${artist.name}-${idx}`}>
                {idx > 0 && <span>,</span>}
                <button
                  type="button"
                  onClick={() =>
                    void openArtistDetail(artist.id ?? artist.name)
                  }
                  className="hover:text-white hover:underline"
                >
                  {artist.name}
                </button>
              </React.Fragment>
            ))}
            {ana && (
              <span className="tabular-nums rounded bg-[#111116] px-1.5 py-0.5 text-[11px] font-semibold text-[#BF5AF2]">
                {ana.bpm} BPM
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <span className="tabular-nums hidden text-xs font-medium text-[#AEAEB2] sm:inline">
          {formatDurationSec(track.durationSec)}
        </span>

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
              ? 'text-[#FF375F]'
              : 'text-[#AEAEB2] hover:text-white'
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
          className="flex items-center justify-center rounded-full p-2 text-[#AEAEB2] hover:text-white"
        >
          {dlStatus === 'downloading' ? (
            <Loader2 className="h-4 w-4 animate-spin text-[#0A84FF]" />
          ) : dlStatus === 'downloaded' ? (
            <Check className="h-4 w-4 text-[#30D158]" />
          ) : (
            <Download className="h-4 w-4" />
          )}
        </button>
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
      <div className="space-y-6">
        <button
          type="button"
          onClick={() => closeDetailView()}
          className="flex items-center gap-2 rounded-full bg-[#16161D] px-4 py-2 text-xs font-semibold text-[#F5F5F7]"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Volver</span>
        </button>

        <div className="pm-surface-card flex flex-col gap-5 rounded-2xl p-6 sm:flex-row sm:items-center">
          <img
            src={artist.thumbnailUrl}
            alt={artist.name}
            className="h-28 w-28 rounded-full object-cover"
          />
          <div className="space-y-2">
            <span className="rounded-full bg-[#0A84FF]/20 px-3 py-1 text-xs font-bold text-[#0A84FF]">
              Artista verificado • Escena Española
            </span>
            <h1 className="text-2xl font-bold text-[#F5F5F7] md:text-3xl">
              {artist.name}
            </h1>
            <p className="text-xs text-[#AEAEB2]">
              {artist.subscribersText ?? description}
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  if (topSongs[0]) void playTrack(topSongs[0], topSongs);
                }}
                className="flex items-center gap-2 rounded-full bg-[#0A84FF] px-4 py-2 text-xs font-bold text-white"
              >
                <Play className="h-4 w-4 fill-current" />
                <span>Reproducir top canciones</span>
              </button>
              <button
                type="button"
                onClick={async () => {
                  await toggleDjMode(true);
                  if (topSongs[0]) await playTrack(topSongs[0], topSongs);
                }}
                className="flex items-center gap-2 rounded-full bg-[#BF5AF2] px-4 py-2 text-xs font-bold text-white"
              >
                <Disc3 className="h-4 w-4" />
                <span>Sesión DJ {artist.name}</span>
              </button>
            </div>
          </div>
        </div>

        <section className="space-y-3">
          <h2 className="text-lg font-bold text-[#F5F5F7]">
            Canciones populares
          </h2>
          <div className="space-y-2">
            {topSongs.map((track) => (
              <TrackListRow key={track.id} track={track} queueContext={topSongs} />
            ))}
          </div>
        </section>

        {albums.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-lg font-bold text-[#F5F5F7]">Álbumes</h2>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              {albums.map((al) => (
                <article
                  key={al.id}
                  data-surface="content"
                  className="pm-surface-card rounded-2xl p-3"
                >
                  <img
                    src={al.thumbnailUrl}
                    alt={al.title}
                    className="aspect-square w-full rounded-xl object-cover"
                  />
                  <div className="mt-2 truncate text-sm font-bold text-[#F5F5F7]">
                    {al.title}
                  </div>
                  <div className="text-xs text-[#AEAEB2]">{al.year ?? 2024}</div>
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
      <div className="space-y-6">
        <button
          type="button"
          onClick={() => closeDetailView()}
          className="flex items-center gap-2 rounded-full bg-[#16161D] px-4 py-2 text-xs font-semibold text-[#F5F5F7]"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Volver</span>
        </button>

        <div className="pm-surface-card flex flex-col gap-5 rounded-2xl p-6 sm:flex-row sm:items-center">
          <img
            src={album.thumbnailUrl}
            alt={album.title}
            className="h-32 w-32 rounded-2xl object-cover"
          />
          <div className="space-y-2">
            <span className="text-xs font-bold text-[#0A84FF]">
              Álbum • {album.year ?? 2024}
            </span>
            <h1 className="text-2xl font-bold text-[#F5F5F7]">{album.title}</h1>
            <p className="text-sm text-[#AEAEB2]">
              {album.artists.map((a) => a.name).join(', ')}
            </p>
            <button
              type="button"
              onClick={() => {
                if (tracks[0]) void playTrack(tracks[0], tracks);
              }}
              className="flex items-center gap-2 rounded-full bg-[#0A84FF] px-4 py-2 text-xs font-bold text-white"
            >
              <Play className="h-4 w-4 fill-current" />
              <span>Reproducir álbum</span>
            </button>
          </div>
        </div>

        <div className="space-y-2">
          {tracks.map((t) => (
            <TrackListRow key={t.id} track={t} queueContext={tracks} />
          ))}
        </div>
      </div>
    );
  }

  if (activeDetailView.kind === 'playlist') {
    const { playlist, tracks } = activeDetailView.data;
    return (
      <div className="space-y-6">
        <button
          type="button"
          onClick={() => closeDetailView()}
          className="flex items-center gap-2 rounded-full bg-[#16161D] px-4 py-2 text-xs font-semibold text-[#F5F5F7]"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Volver</span>
        </button>

        <div className="pm-surface-card flex flex-col gap-5 rounded-2xl p-6 sm:flex-row sm:items-center">
          <img
            src={playlist.thumbnailUrl}
            alt={playlist.title}
            className="h-32 w-32 rounded-2xl object-cover"
          />
          <div className="space-y-2">
            <h1 className="text-2xl font-bold text-[#F5F5F7]">
              {playlist.title}
            </h1>
            <p className="text-xs text-[#AEAEB2]">
              {playlist.author ?? 'pMusic'} • {tracks.length} canciones
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  if (tracks[0]) void playTrack(tracks[0], tracks);
                }}
                className="flex items-center gap-2 rounded-full bg-[#0A84FF] px-4 py-2 text-xs font-bold text-white"
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
                className="flex items-center gap-2 rounded-full bg-[#BF5AF2] px-4 py-2 text-xs font-bold text-white"
              >
                <Disc3 className="h-4 w-4" />
                <span>Sesión DJ AutoMix</span>
              </button>
            </div>
          </div>
        </div>

        <div className="space-y-2">
          {tracks.map((t) => (
            <TrackListRow key={t.id} track={t} queueContext={tracks} />
          ))}
        </div>
      </div>
    );
  }

  // Local playlist detail
  const localPl = playlists.find((p) => p.id === activeDetailView.playlistId);
  if (!localPl) return null;

  return (
    <div className="space-y-6">
      <button
        type="button"
        onClick={() => closeDetailView()}
        className="flex items-center gap-2 rounded-full bg-[#16161D] px-4 py-2 text-xs font-semibold text-[#F5F5F7]"
      >
        <ArrowLeft className="h-4 w-4" />
        <span>Volver a Biblioteca</span>
      </button>

      <div className="pm-surface-card space-y-4 rounded-2xl p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-[#F5F5F7]">{localPl.name}</h1>
            <p className="text-xs text-[#AEAEB2]">
              {localPl.description || 'Playlist personal'} • {localPl.tracks.length} pistas
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
              className="flex items-center gap-2 rounded-full bg-[#0A84FF] px-4 py-2 text-xs font-bold text-white"
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
              className="flex items-center gap-2 rounded-full bg-[#BF5AF2] px-4 py-2 text-xs font-bold text-white"
            >
              <Disc3 className="h-4 w-4" />
              <span>Sesión DJ</span>
            </button>
            <button
              type="button"
              aria-label="Eliminar playlist"
              onClick={() => void deletePlaylist(localPl.id)}
              className="rounded-full bg-[#FF453A]/20 px-3.5 py-2 text-xs font-bold text-[#FF453A]"
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
            className="rounded-xl border border-white/15 bg-[#111116] px-3 py-1.5 text-xs text-[#F5F5F7]"
          />
          <button
            type="button"
            onClick={async () => {
              if (editingName.trim()) {
                await renamePlaylist(localPl.id, editingName.trim());
                setEditingName('');
              }
            }}
            className="rounded-xl bg-[#111116] px-3.5 py-1.5 text-xs font-semibold text-[#F5F5F7]"
          >
            Renombrar
          </button>
        </div>
      </div>

      <div className="space-y-2">
        {localPl.tracks.map((t) => (
          <TrackListRow key={t.id} track={t} queueContext={localPl.tracks} />
        ))}
      </div>
    </div>
  );
};

export const HomeScreen: React.FC = () => {
  const {
    homeShelves,
    djMode,
    isOfflineNetwork,
    playTrack,
    toggleDjMode,
    setImportModalOpen,
    setDevicesSheetOpen,
    setEqSheetOpen,
    setSettingsOpen,
    openAlbumDetail,
  } = usePMusicStore();

  return (
    <div className="space-y-8">
      {/* Top Editorial Header & Quick Actions */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#F5F5F7] md:text-3xl">
            {getSpanishGreeting()}
          </h1>
          <p className="text-sm font-medium text-[#AEAEB2]">
            Tu algoritmo personalizado • Bad Bunny, La Pantera, Cruz Cafuné y Urbano ES
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            aria-pressed={djMode.enabled}
            onClick={() => void toggleDjMode()}
            className={`flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-bold transition-colors ${
              djMode.enabled
                ? 'bg-[#7D2AE8] text-white'
                : 'bg-[#16161D] text-[#F5F5F7] hover:bg-[#1E1E28]'
            }`}
          >
            <Disc3 className="h-4 w-4" />
            <span>{djMode.enabled ? 'Sesión DJ Activa' : 'Modo Sesión DJ'}</span>
          </button>

          <button
            type="button"
            onClick={() => setEqSheetOpen(true)}
            className="flex items-center gap-1.5 rounded-full bg-[#16161D] px-3.5 py-2 text-xs font-semibold text-[#F5F5F7] hover:bg-[#1E1E28]"
          >
            <Sliders className="h-4 w-4 text-[#0A84FF]" />
            <span>EQ / Crossfade</span>
          </button>

          <button
            type="button"
            onClick={() => setImportModalOpen(true)}
            className="flex items-center gap-1.5 rounded-full bg-[#16161D] px-3.5 py-2 text-xs font-semibold text-[#F5F5F7] hover:bg-[#1E1E28]"
          >
            <ListMusic className="h-4 w-4 text-[#0A84FF]" />
            <span>Importar</span>
          </button>

          <button
            type="button"
            onClick={() => setDevicesSheetOpen(true)}
            className="flex items-center gap-1.5 rounded-full bg-[#16161D] px-3.5 py-2 text-xs font-semibold text-[#F5F5F7] hover:bg-[#1E1E28]"
          >
            <Wifi className="h-4 w-4 text-[#30D158]" />
            <span>Dispositivos</span>
          </button>

          <button
            type="button"
            aria-label="Ajustes"
            onClick={() => setSettingsOpen(true)}
            className="flex items-center gap-1.5 rounded-full bg-[#16161D] px-3.5 py-2 text-xs font-semibold text-[#F5F5F7] hover:bg-[#1E1E28]"
          >
            <Settings className="h-4 w-4 text-[#AEAEB2]" />
            <span>Ajustes</span>
          </button>
        </div>
      </div>

      {/* Direct 1-Click Installer Downloads (Saves straight to user's Windows Downloads folder) */}
      <div
        data-surface="content"
        className="pm-surface-card flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-[#0A84FF]/40 p-4"
      >
        <div>
          <div className="text-sm font-bold text-[#F5F5F7]">
            Descargar instaladores de pMusic (con tu Supabase ya configurado)
          </div>
          <div className="text-xs text-[#AEAEB2]">
            Haz clic para guardar directamente en tu carpeta <code className="text-[#F5F5F7]">C:\Users\pable\Downloads</code>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <a
            href="/api/download/windows"
            download="pMusic-0.1.0-Windows-x64.zip"
            className="flex items-center gap-2 rounded-full bg-[#0051D5] px-4 py-2 text-xs font-bold text-white hover:bg-[#0051D5]/90"
          >
            <Download className="h-4 w-4" />
            <span>Descargar para Windows (pmusic.exe .zip)</span>
          </a>
          <a
            href="/api/download/android"
            download="pMusic-Android.apk"
            className="flex items-center gap-2 rounded-full bg-[#30D158] px-4 py-2 text-xs font-bold text-[#06060A] hover:bg-[#30D158]/90"
          >
            <Download className="h-4 w-4" />
            <span>Descargar para Android (.apk)</span>
          </a>
        </div>
      </div>

      {isOfflineNetwork && (
        <div
          role="status"
          className="pm-surface-card rounded-2xl border border-[#FF9F0A]/40 px-4 py-3 text-xs font-semibold text-[#F5F5F7]"
        >
          Modo sin conexión activo — Reproduciendo desde tu caché offline y catálogo local.
        </div>
      )}

      {/* 4 Editorial Shelves */}
      {homeShelves.map((shelf) => (
        <section key={shelf.id} className="space-y-3">
          <div>
            <h2 className="text-xl font-bold text-[#F5F5F7]">{shelf.title}</h2>
            {shelf.subtitle && (
              <p className="text-xs font-medium text-[#AEAEB2]">
                {shelf.subtitle}
              </p>
            )}
          </div>

          {shelf.kind === 'mixes_for_you' && shelf.mixes && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              {shelf.mixes.map((mix) => (
                <article
                  key={mix.id}
                  data-surface="content"
                  className="pm-surface-card flex flex-col justify-between rounded-2xl p-4"
                >
                  <div className="flex items-start gap-3.5">
                    <img
                      src={mix.coverUrl}
                      alt={mix.title}
                      className="h-20 w-20 rounded-xl object-cover"
                    />
                    <div className="min-w-0 flex-1">
                      <span className="inline-flex items-center gap-1 rounded-full bg-[#BF5AF2]/20 px-2.5 py-0.5 text-[11px] font-bold text-[#BF5AF2]">
                        <Sparkles className="h-3 w-3" />
                        <span>Para ti</span>
                      </span>
                      <h3 className="mt-1 truncate text-base font-bold text-[#F5F5F7]">
                        {mix.title}
                      </h3>
                      <p className="line-clamp-2 text-xs text-[#AEAEB2]">
                        {mix.subtitle}
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        if (mix.tracks[0]) void playTrack(mix.tracks[0], mix.tracks);
                      }}
                      className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#0A84FF] py-2 text-xs font-bold text-white"
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
                      className="flex items-center justify-center gap-1 rounded-xl bg-[#BF5AF2] px-3 py-2 text-xs font-bold text-white"
                    >
                      <Disc3 className="h-3.5 w-3.5" />
                      <span>DJ</span>
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}

          {shelf.kind === 'favorite_new_releases' && shelf.albums && (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-5">
              {shelf.albums.map((album) => (
                <article
                  key={album.id}
                  data-surface="content"
                  className="pm-surface-card flex flex-col rounded-2xl p-3"
                >
                  <button
                    type="button"
                    onClick={() => void openAlbumDetail(album.id)}
                    className="text-left"
                  >
                    <img
                      src={album.thumbnailUrl}
                      alt={album.title}
                      className="aspect-square w-full rounded-xl object-cover"
                    />
                    <div className="mt-2.5 truncate text-sm font-bold text-[#F5F5F7]">
                      {album.title}
                    </div>
                    <div className="truncate text-xs text-[#AEAEB2]">
                      {album.artists.map((a) => a.name).join(', ')} • {album.year ?? 2024}
                    </div>
                  </button>
                </article>
              ))}
            </div>
          )}

          {(shelf.kind === 'listen_again' ||
            shelf.kind === 'because_you_listened') &&
            shelf.tracks && (
              <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
                {shelf.tracks.slice(0, 6).map((track) => (
                  <TrackListRow
                    key={`${shelf.id}-${track.id}`}
                    track={track}
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
        <h1 className="text-2xl font-bold tracking-tight text-[#F5F5F7] md:text-3xl">
          Buscar
        </h1>
        <p className="text-xs font-medium text-[#AEAEB2]">
          Priorizando tus gustos y artistas de la escena urbana española
        </p>
      </div>

      {/* Search Bar */}
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          void submitSearch();
        }}
        className="flex items-center gap-2 rounded-2xl border border-white/15 bg-[#16161D] px-4 py-2"
      >
        <Search className="h-5 w-5 text-[#AEAEB2]" />
        <input
          type="search"
          role="searchbox"
          aria-label="Buscar canciones, artistas o álbumes"
          placeholder="Buscar artistas, canciones, álbumes (ej. Cruz Cafuné, La Pantera, Bad Bunny)..."
          value={searchQuery}
          onChange={(e) => void setSearchQuery(e.target.value)}
          className="flex-1 bg-transparent text-sm font-medium text-[#F5F5F7] placeholder:text-[#8E8E93] focus:outline-none"
        />
        {searchQuery && (
          <button
            type="button"
            aria-label="Limpiar búsqueda"
            onClick={() => void setSearchQuery('')}
            className="rounded-full bg-[#111116] px-2.5 py-1 text-xs font-semibold text-[#AEAEB2]"
          >
            Limpiar
          </button>
        )}
      </form>

      {/* Autocomplete Suggestions & Recent Searches */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {autocompleteSuggestions.slice(0, 6).map((sug) => (
            <button
              key={sug.text}
              type="button"
              onClick={() => void submitSearch(sug.text)}
              className="rounded-full bg-[#16161D] px-3.5 py-1.5 text-xs font-semibold text-[#F5F5F7] hover:bg-[#1E1E28]"
            >
              {sug.text}
            </button>
          ))}
        </div>

        {recentSearches.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-[#8E8E93]">Recientes:</span>
            {recentSearches.slice(0, 3).map((rec) => (
              <button
                key={rec}
                type="button"
                onClick={() => void submitSearch(rec)}
                className="rounded-full bg-[#111116] px-2.5 py-1 text-xs text-[#AEAEB2] hover:text-white"
              >
                {rec}
              </button>
            ))}
            <button
              type="button"
              onClick={() => clearRecentSearches()}
              className="text-xs font-semibold text-[#0A84FF] hover:underline"
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
        className="flex flex-wrap gap-2"
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
              className={`rounded-full px-4 py-2 text-xs font-bold transition-colors ${
                active
                  ? 'bg-[#0A84FF] text-white'
                  : 'bg-[#16161D] text-[#AEAEB2] hover:text-white'
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
          <section className="space-y-2">
            <h2 className="text-lg font-bold text-[#F5F5F7]">
              Mejor resultado
            </h2>
            <div
              data-testid="best-result-card"
              data-surface="content"
              className="pm-surface-card flex flex-wrap items-center justify-between gap-4 rounded-2xl p-5"
            >
              {bestResult.kind === 'artist' && (
                <>
                  <div className="flex items-center gap-4">
                    <img
                      src={bestResult.item.thumbnailUrl}
                      alt={bestResult.item.name}
                      className="h-20 w-20 rounded-full object-cover"
                    />
                    <div>
                      <span className="rounded-full bg-[#0A84FF]/20 px-2.5 py-0.5 text-xs font-bold text-[#0A84FF]">
                        Artista destacado
                      </span>
                      <h3 className="mt-1 text-xl font-bold text-[#F5F5F7]">
                        {bestResult.item.name}
                      </h3>
                      <p className="text-xs text-[#AEAEB2]">
                        {bestResult.item.subscribersText ?? 'Escena Urbana Española'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void openArtistDetail(bestResult.item.id)}
                      className="rounded-full bg-[#111116] px-4 py-2 text-xs font-bold text-[#F5F5F7]"
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
                      className="flex items-center gap-1.5 rounded-full bg-[#0A84FF] px-4 py-2 text-xs font-bold text-white"
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
                      className="h-20 w-20 rounded-xl object-cover"
                    />
                    <div>
                      <span className="rounded-full bg-[#0A84FF]/20 px-2.5 py-0.5 text-xs font-bold text-[#0A84FF]">
                        Canción
                      </span>
                      <h3 className="mt-1 text-xl font-bold text-[#F5F5F7]">
                        {bestResult.item.title}
                      </h3>
                      <p className="text-xs text-[#AEAEB2]">
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
                    className="flex items-center gap-1.5 rounded-full bg-[#0A84FF] px-4 py-2 text-xs font-bold text-white"
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
        <section className="space-y-3">
          <h2 className="text-lg font-bold text-[#F5F5F7]">Canciones</h2>
          <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
            {searchResults.songs.map((track) => (
              <TrackListRow
                key={track.id}
                track={track}
                queueContext={searchResults.songs}
              />
            ))}
          </div>
        </section>
      )}

      {/* Artists Section */}
      {(searchScope === 'Todo' || searchScope === 'Artistas') && (
        <section className="space-y-3">
          <h2 className="text-lg font-bold text-[#F5F5F7]">Artistas</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {searchResults.artists.map((artist) => (
              <article
                key={artist.id}
                data-surface="content"
                className="pm-surface-card flex flex-col items-center rounded-2xl p-4 text-center"
              >
                <img
                  src={artist.thumbnailUrl}
                  alt={artist.name}
                  className="h-20 w-20 rounded-full object-cover"
                />
                <div className="mt-2.5 truncate text-sm font-bold text-[#F5F5F7]">
                  {artist.name}
                </div>
                <div className="text-xs text-[#AEAEB2]">
                  {artist.subscribersText ?? 'Artista'}
                </div>
                <button
                  type="button"
                  onClick={() => void openArtistDetail(artist.id)}
                  className="mt-3 rounded-full bg-[#111116] px-3.5 py-1.5 text-xs font-semibold text-[#F5F5F7] hover:bg-[#0A84FF]"
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
        <section className="space-y-3">
          <h2 className="text-lg font-bold text-[#F5F5F7]">Álbumes</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {searchResults.albums.map((album) => (
              <article
                key={album.id}
                data-surface="content"
                className="pm-surface-card rounded-2xl p-3"
              >
                <button
                  type="button"
                  onClick={() => void openAlbumDetail(album.id)}
                  className="w-full text-left"
                >
                  <img
                    src={album.thumbnailUrl}
                    alt={album.title}
                    className="aspect-square w-full rounded-xl object-cover"
                  />
                  <div className="mt-2 truncate text-sm font-bold text-[#F5F5F7]">
                    {album.title}
                  </div>
                  <div className="truncate text-xs text-[#AEAEB2]">
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
        <section className="space-y-3">
          <h2 className="text-lg font-bold text-[#F5F5F7]">Playlists</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {searchResults.playlists.map((pl) => (
              <article
                key={pl.id}
                data-surface="content"
                className="pm-surface-card flex items-center justify-between gap-4 rounded-2xl p-4"
              >
                <div className="flex items-center gap-3.5">
                  <img
                    src={pl.thumbnailUrl}
                    alt={pl.title}
                    className="h-16 w-16 rounded-xl object-cover"
                  />
                  <div>
                    <div className="text-base font-bold text-[#F5F5F7]">
                      {pl.title}
                    </div>
                    <div className="text-xs text-[#AEAEB2]">
                      {pl.author ?? 'pMusic'} • {pl.trackCount ?? 12} canciones
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void openPlaylistDetail(pl.id)}
                  className="rounded-full bg-[#0A84FF] px-4 py-2 text-xs font-bold text-white"
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
          <h1 className="text-2xl font-bold tracking-tight text-[#F5F5F7] md:text-3xl">
            Biblioteca
          </h1>
          <p className="text-xs font-medium text-[#AEAEB2]">
            Tus playlists, canciones favoritas, descargas offline e historial sincronizado
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setImportModalOpen(true)}
            className="flex items-center gap-1.5 rounded-full bg-[#0A84FF] px-4 py-2 text-xs font-bold text-white"
          >
            <ListMusic className="h-4 w-4" />
            <span>Importar playlist</span>
          </button>
        </div>
      </div>

      {/* Category Pills & Inline Filter */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          role="tablist"
          aria-label="Categorías de biblioteca"
          className="flex flex-wrap gap-2"
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
                    ? 'bg-[#0A84FF] text-white'
                    : 'bg-[#16161D] text-[#AEAEB2] hover:text-white'
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
          className="rounded-xl border border-white/15 bg-[#16161D] px-3.5 py-2 text-xs text-[#F5F5F7] placeholder:text-[#8E8E93]"
        />
      </div>

      {/* Create New Playlist Quick Bar */}
      {(libraryCategory === 'Todo' || libraryCategory === 'Playlists') && (
        <div className="pm-surface-card flex flex-wrap items-center gap-2.5 rounded-2xl p-4">
          <input
            type="text"
            aria-label="Nombre de la nueva playlist"
            placeholder="Nombre de tu nueva playlist (ej. Sesión Canarias)..."
            value={newPlaylistName}
            onChange={(e) => setNewPlaylistName(e.target.value)}
            className="flex-1 rounded-xl border border-white/15 bg-[#111116] px-3.5 py-2 text-xs text-[#F5F5F7]"
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
            className="flex items-center gap-1.5 rounded-xl bg-[#0A84FF] px-4 py-2 text-xs font-bold text-white"
          >
            <Plus className="h-4 w-4" />
            <span>Crear playlist</span>
          </button>
        </div>
      )}

      {/* Playlists Section */}
      {(libraryCategory === 'Todo' || libraryCategory === 'Playlists') && (
        <section className="space-y-3">
          <h2 className="text-lg font-bold text-[#F5F5F7]">
            Tus Playlists ({filteredPlaylists.length})
          </h2>
          {filteredPlaylists.length > 0 ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {filteredPlaylists.map((pl) => (
                <article
                  key={pl.id}
                  data-surface="content"
                  className="pm-surface-card flex items-center justify-between gap-3 rounded-2xl p-4"
                >
                  <div>
                    <h3 className="text-base font-bold text-[#F5F5F7]">
                      {pl.name}
                    </h3>
                    <p className="text-xs text-[#AEAEB2]">
                      {pl.tracks.length} canciones • {pl.source}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => openLocalPlaylistDetail(pl.id)}
                      className="rounded-full bg-[#0A84FF] px-3.5 py-1.5 text-xs font-bold text-white"
                    >
                      Ver
                    </button>
                    <button
                      type="button"
                      aria-label={`Eliminar ${pl.name}`}
                      onClick={() => void deletePlaylist(pl.id)}
                      className="rounded-full bg-[#111116] p-2 text-[#AEAEB2] hover:text-[#FF453A]"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="text-xs text-[#AEAEB2]">
              Aún no has creado playlists personalizadas. Usa el campo superior o importa desde Spotify/YouTube.
            </p>
          )}
        </section>
      )}

      {/* Liked Tracks Section */}
      {(libraryCategory === 'Todo' || libraryCategory === 'Me gusta') && (
        <section className="space-y-3">
          <h2 className="text-lg font-bold text-[#F5F5F7]">
            Canciones que te gustan ({filteredLikes.length})
          </h2>
          {filteredLikes.length > 0 ? (
            <div className="space-y-2">
              {filteredLikes.map((item) => (
                <TrackListRow
                  key={item.trackId}
                  track={item.track}
                  queueContext={filteredLikes.map((l) => l.track)}
                />
              ))}
            </div>
          ) : (
            <p className="text-xs text-[#AEAEB2]">
              Pulsa el icono del corazón en cualquier canción para guardarla aquí.
            </p>
          )}
        </section>
      )}

      {/* Offline Downloads Section */}
      {(libraryCategory === 'Todo' || libraryCategory === 'Descargas') && (
        <section className="space-y-3">
          <h2 className="text-lg font-bold text-[#F5F5F7]">
            Descargas offline ({offlineEntries.length})
          </h2>
          {offlineEntries.length > 0 ? (
            <div className="space-y-2">
              {offlineEntries.map((entry) => {
                const track =
                  searchResults.songs.find((s) => s.id === entry.trackId) ??
                  searchResults.songs[0]!;
                return (
                  <div
                    key={entry.trackId}
                    className="pm-surface-card flex items-center justify-between rounded-xl p-3"
                  >
                    <div>
                      <div className="text-sm font-bold text-[#F5F5F7]">
                        {track.title}
                      </div>
                      <div className="text-xs text-[#AEAEB2]">
                        Disponible sin conexión • {(entry.sizeBytes / 1024).toFixed(0)} KB
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void removeOfflineTrack(entry.trackId)}
                      className="rounded-lg bg-[#111116] px-3 py-1.5 text-xs font-semibold text-[#FF453A]"
                    >
                      Borrar descarga
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-[#AEAEB2]">
              Descarga canciones con el icono de flecha para escucharlas en tu móvil sin gastar datos.
            </p>
          )}
        </section>
      )}

      {/* Listening History Section */}
      {(libraryCategory === 'Todo' || libraryCategory === 'Historial') && (
        <section className="space-y-3">
          <h2 className="text-lg font-bold text-[#F5F5F7]">
            Historial reciente ({playHistory.length})
          </h2>
          {playHistory.length > 0 ? (
            <div className="space-y-2">
              {playHistory.slice(0, 12).map((h) => (
                <TrackListRow key={h.id} track={h.track} />
              ))}
            </div>
          ) : (
            <p className="text-xs text-[#AEAEB2]">
              Tu historial alimenta automáticamente el algoritmo de recomendaciones.
            </p>
          )}
        </section>
      )}
    </div>
  );
};
