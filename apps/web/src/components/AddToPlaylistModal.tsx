import React, { useEffect, useMemo, useState } from 'react';
import { Check, ListMusic, Plus, Search, X } from 'lucide-react';
import { usePMusicStore } from '../store/usePMusicStore.ts';
import { TrackArtwork } from './TrackArtwork.tsx';

export const AddToPlaylistModal: React.FC = () => {
  const track = usePMusicStore((s) => s.addToPlaylistModalTrack);
  const setTrack = usePMusicStore((s) => s.setAddToPlaylistModalTrack);
  const playlists = usePMusicStore((s) => s.playlists);
  const addTrackToPlaylist = usePMusicStore((s) => s.addTrackToPlaylist);
  const removeTrackFromPlaylist = usePMusicStore((s) => s.removeTrackFromPlaylist);
  const createPlaylist = usePMusicStore((s) => s.createPlaylist);

  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');

  useEffect(() => {
    if (!track) {
      setQuery('');
      setCreating(false);
      setNewName('');
    }
  }, [track]);

  const filteredPlaylists = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return playlists;
    return playlists.filter((pl) => pl.name.toLowerCase().includes(q));
  }, [playlists, query]);

  if (!track) return null;

  const handleTogglePlaylist = async (playlistId: string, alreadyIn: boolean) => {
    if (alreadyIn) {
      await removeTrackFromPlaylist(playlistId, track.id);
    } else {
      await addTrackToPlaylist(playlistId, track);
    }
  };

  const handleCreateAndAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = newName.trim();
    if (!clean) return;
    const created = await createPlaylist(clean);
    await addTrackToPlaylist(created.id, track);
    setNewName('');
    setCreating(false);
    setTrack(null);
  };

  return (
    <div className="fixed inset-0 z-[78] flex items-end justify-center sm:items-center sm:p-4">
      <div
        aria-hidden="true"
        onClick={() => setTrack(null)}
        className="pm-spotlight-backdrop absolute inset-0 bg-black/72 backdrop-blur-sm"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Añadir ${track.title} a playlist`}
        data-testid="add-to-playlist-modal"
        className="pm-glass-regular pm-modal-pop relative z-10 flex max-h-[84dvh] w-full max-w-md flex-col overflow-hidden rounded-t-[26px] border border-white/15 shadow-2xl sm:rounded-[24px]"
      >
        {/* Drag indicator bar on mobile */}
        <div className="flex justify-center pt-2.5 sm:hidden">
          <div className="h-1 w-10 rounded-full bg-white/25" />
        </div>

        {/* Header with Track Preview */}
        <div className="flex items-center justify-between gap-3 border-b pm-border px-5 pb-4 pt-3.5">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <div className="h-12 w-12 shrink-0 overflow-hidden rounded-[10px] bg-black/40 ring-1 ring-white/15">
              <TrackArtwork
                trackId={track.id}
                src={track.thumbnailUrl}
                title={track.title}
                artistName={track.artists[0]?.name}
                artistId={track.artists[0]?.id}
                alt={track.title}
                variant="mini"
                imgClassName="h-full w-full object-cover"
              />
            </div>
            <div className="min-w-0">
              <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#C084FC]">
                Añadir a playlist
              </div>
              <div className="truncate text-sm font-bold pm-text-primary">{track.title}</div>
              <div className="truncate text-xs pm-text-secondary">
                {track.artists.map((a) => a.name).join(', ')}
              </div>
            </div>
          </div>

          <button
            type="button"
            aria-label="Cerrar selector de playlist"
            onClick={() => setTrack(null)}
            className="pm-pressable flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/[0.08] pm-text-secondary hover:bg-white/[0.16] hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Search + Quick New Playlist */}
        <div className="space-y-2.5 border-b pm-border px-5 py-3">
          {playlists.length > 4 && (
            <div className="flex items-center gap-2 rounded-full bg-white/[0.07] px-3.5 py-2 focus-within:bg-white/[0.12]">
              <Search className="h-3.5 w-3.5 shrink-0 pm-text-tertiary" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar playlist…"
                className="w-full bg-transparent text-xs pm-text-primary placeholder:pm-text-tertiary focus:outline-none"
              />
            </div>
          )}

          {creating ? (
            <form onSubmit={(e) => void handleCreateAndAdd(e)} className="flex items-center gap-2">
              <input
                type="text"
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Nombre de la nueva playlist…"
                className="flex-1 rounded-full border pm-border bg-white/[0.07] px-3.5 py-2 text-xs pm-text-primary placeholder:pm-text-tertiary focus:border-white/35 focus:outline-none"
              />
              <button
                type="submit"
                disabled={!newName.trim()}
                className="pm-btn-primary rounded-full px-4 py-2 text-xs font-bold disabled:opacity-45"
              >
                Crear
              </button>
              <button
                type="button"
                onClick={() => {
                  setCreating(false);
                  setNewName('');
                }}
                className="pm-btn-secondary rounded-full px-3 py-2 text-xs font-semibold"
              >
                Cancelar
              </button>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="pm-pressable flex w-full items-center gap-3 rounded-[14px] border border-dashed border-white/20 bg-white/[0.04] px-3.5 py-2.5 text-left transition-colors hover:bg-white/[0.09]"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-white/[0.12] text-white">
                <Plus className="h-4 w-4" />
              </span>
              <span className="text-xs font-bold pm-text-primary">Nueva playlist</span>
            </button>
          )}
        </div>

        {/* Interactive Playlist List */}
        <div className="flex-1 space-y-1.5 overflow-y-auto px-4 py-3 pm-no-scrollbar">
          {filteredPlaylists.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-8 text-center text-xs pm-text-tertiary">
              <ListMusic className="h-7 w-7 opacity-40" />
              <span>
                {playlists.length === 0
                  ? 'Todavía no tienes playlists. Crea una arriba.'
                  : 'Ninguna playlist coincide con tu búsqueda.'}
              </span>
            </div>
          ) : (
            filteredPlaylists.map((pl) => {
              const alreadyIn = pl.tracks.some((t) => t.id === track.id);
              const coverSrc = pl.coverUrl ?? pl.tracks[0]?.thumbnailUrl ?? '';
              return (
                <button
                  key={pl.id}
                  type="button"
                  data-testid={`playlist-picker-row-${pl.id}`}
                  aria-pressed={alreadyIn}
                  onClick={() => void handleTogglePlaylist(pl.id, alreadyIn)}
                  className={`pm-pressable flex w-full items-center justify-between gap-3 rounded-[14px] px-3 py-2.5 text-left transition-colors ${
                    alreadyIn
                      ? 'bg-white/[0.12] ring-1 ring-white/20'
                      : 'hover:bg-white/[0.07]'
                  }`}
                >
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <div className="h-11 w-11 shrink-0 overflow-hidden rounded-[10px] bg-white/[0.08]">
                      <TrackArtwork
                        trackId={pl.tracks[0]?.id ?? pl.id}
                        src={coverSrc}
                        title={pl.name}
                        artistName={`${pl.tracks.length} pistas`}
                        alt={pl.name}
                        variant="mini"
                        imgClassName="h-full w-full object-cover"
                      />
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold pm-text-primary">
                        {pl.name}
                      </div>
                      <div className="text-[11px] pm-text-tertiary">
                        {pl.tracks.length} {pl.tracks.length === 1 ? 'canción' : 'canciones'}
                      </div>
                    </div>
                  </div>

                  <span
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition-all duration-200 ${
                      alreadyIn
                        ? 'scale-105 bg-emerald-500 text-[#050507] shadow-[0_0_12px_rgba(16,185,129,0.45)]'
                        : 'border border-white/25 bg-white/[0.05] text-transparent'
                    }`}
                  >
                    <Check className="h-3.5 w-3.5 stroke-[3]" />
                  </span>
                </button>
              );
            })
          )}
        </div>

        {/* Done Button */}
        <div className="border-t pm-border px-5 py-3">
          <button
            type="button"
            onClick={() => setTrack(null)}
            className="pm-btn-primary w-full rounded-full py-2.5 text-xs font-bold"
          >
            Listo
          </button>
        </div>
      </div>
    </div>
  );
};
