import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Camera,
  Check,
  Loader2,
  Music2,
  Palette,
  Plus,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import type { Track } from '@pmusic/core';
import { usePMusicStore } from '../store/usePMusicStore.ts';
import { TrackArtwork } from './TrackArtwork.tsx';
import {
  compressImageFileToDataUrl,
  generatePlaylistCoverDataUrl,
} from '../utils/playlist-artwork.ts';
import { triggerHaptic } from '../utils/haptics.ts';

const QUICK_PLAYLIST_PRESETS = [
  'Sesión de noche',
  'Gym',
  'Coche',
  'Chill',
  'Para descubrir',
] as const;

export const CreatePlaylistModal: React.FC = React.memo(() => {
  const open = usePMusicStore((s) => s.createPlaylistModalOpen);
  if (!open) return null;
  return <CreatePlaylistModalInner />;
});
CreatePlaylistModal.displayName = 'CreatePlaylistModal';

const CreatePlaylistModalInner: React.FC = () => {
  const {
    playlists,
    likedTracks,
    playHistory,
    searchResults,
    setCreatePlaylistModalOpen,
    createPlaylist,
    updatePlaylistAppearance,
    openLocalPlaylistDetail,
    searchTracksForPlaylist,
    showToast,
  } = usePMusicStore();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [coverSeed, setCoverSeed] = useState(0);
  const [customCoverUrl, setCustomCoverUrl] = useState<string | null>(null);
  const [selectedTracks, setSelectedTracks] = useState<Track[]>([]);
  const [songQuery, setSongQuery] = useState('');
  const [songResults, setSongResults] = useState<Track[]>([]);
  const [searchingSongs, setSearchingSongs] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const searchTokenRef = useRef(0);

  const close = () => {
    if (submitting) return;
    setCreatePlaylistModalOpen(false);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [submitting]);

  useEffect(() => {
    const trimmed = songQuery.trim();
    if (trimmed.length < 2) {
      setSongResults([]);
      setSearchingSongs(false);
      return;
    }
    const token = ++searchTokenRef.current;
    setSearchingSongs(true);
    const timer = window.setTimeout(() => {
      void searchTracksForPlaylist(trimmed)
        .then((res) => {
          if (searchTokenRef.current === token) {
            setSongResults(res.slice(0, 8));
            setSearchingSongs(false);
          }
        })
        .catch(() => {
          if (searchTokenRef.current === token) {
            setSearchingSongs(false);
          }
        });
    }, 180);
    return () => window.clearTimeout(timer);
  }, [songQuery, searchTracksForPlaylist]);

  const fallbackName = `Mi Playlist #${playlists.length + 1}`;
  const previewTitle = name.trim() || fallbackName;
  const generatedCover = useMemo(
    () => generatePlaylistCoverDataUrl(previewTitle, coverSeed),
    [previewTitle, coverSeed]
  );
  const activeCover = customCoverUrl || generatedCover;

  const suggestedTracks = useMemo(() => {
    if (songQuery.trim().length >= 2) return songResults;
    const pool: Track[] = [];
    const seen = new Set<string>();
    const pushUnique = (tr?: Track | null) => {
      if (!tr?.id || seen.has(tr.id)) return;
      seen.add(tr.id);
      pool.push(tr);
    };
    for (const l of likedTracks) pushUnique(l.track);
    for (const h of playHistory) pushUnique(h.track);
    for (const s of searchResults.songs) pushUnique(s);
    return pool.slice(0, 6);
  }, [songQuery, songResults, likedTracks, playHistory, searchResults.songs]);

  const selectedIdSet = useMemo(
    () => new Set(selectedTracks.map((t) => t.id)),
    [selectedTracks]
  );

  const toggleTrackSelection = (track: Track) => {
    triggerHaptic('light');
    setSelectedTracks((prev) =>
      prev.some((t) => t.id === track.id)
        ? prev.filter((t) => t.id !== track.id)
        : [...prev, track]
    );
  };

  const handleCoverUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const dataUrl = await compressImageFileToDataUrl(file, 512, 512);
      setCustomCoverUrl(dataUrl);
      triggerHaptic('confirm');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'No se pudo cargar la imagen');
    }
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    triggerHaptic('confirm');
    try {
      const finalName = name.trim() || fallbackName;
      const created = await createPlaylist(finalName, description.trim(), selectedTracks);
      if (customCoverUrl || coverSeed !== 0) {
        await updatePlaylistAppearance('local', created.id, {
          ...(customCoverUrl ? { coverUrl: customCoverUrl } : {}),
          coverStyleSeed: coverSeed,
        });
      }
      setCreatePlaylistModalOpen(false);
      openLocalPlaylistDetail(created.id);
      showToast(
        selectedTracks.length > 0
          ? `Playlist «${created.name}» creada con ${selectedTracks.length} temas`
          : `Playlist «${created.name}» creada`
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'No se pudo crear la playlist');
      setSubmitting(false);
    }
  };

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-end justify-center sm:items-center sm:p-4">
      <div
        aria-hidden="true"
        onClick={close}
        className="pm-spotlight-backdrop absolute inset-0 bg-black/75 backdrop-blur-md"
      />

      <form
        role="dialog"
        aria-modal="true"
        aria-label="Nueva playlist"
        data-testid="create-playlist-modal"
        onSubmit={(e) => void handleCreateSubmit(e)}
        className="pm-glass-regular pm-modal-pop relative z-10 flex max-h-[88dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-[28px] border border-white/15 bg-[#09090d]/95 shadow-2xl sm:rounded-[26px]"
      >
        {/* Subtle hero ambient glow matching artwork */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-44 overflow-hidden opacity-45"
        >
          <img
            src={activeCover}
            alt=""
            className="h-full w-full scale-125 object-cover blur-3xl saturate-150"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-black/25 via-[#09090d]/70 to-[#09090d]" />
        </div>

        {/* Mobile drag bar */}
        <div className="relative z-10 flex justify-center pt-2.5 sm:hidden">
          <div className="h-1 w-10 rounded-full bg-white/25" />
        </div>

        {/* Header */}
        <div className="relative z-10 flex items-center justify-between gap-3 px-5 pb-3 pt-3 sm:pt-4">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-white/80" />
            <h2 className="text-[17px] font-black tracking-tight pm-text-primary">
              Nueva playlist
            </h2>
          </div>
          <button
            type="button"
            aria-label="Cerrar creación de playlist"
            onClick={close}
            className="pm-compact-btn pm-hover flex h-8 w-8 items-center justify-center rounded-full pm-text-secondary hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="relative z-10 flex-1 space-y-4 overflow-y-auto px-5 pb-4 pm-no-scrollbar">
          {/* Interactive Cover + Name / Description */}
          <div className="flex items-center gap-4">
            <div className="shrink-0 space-y-1.5 text-center">
              <button
                type="button"
                aria-label="Elegir portada de playlist"
                onClick={() => fileInputRef.current?.click()}
                className="pm-compact-btn pm-pressable group relative block h-24 w-24 overflow-hidden rounded-[16px] shadow-[0_16px_36px_rgba(0,0,0,0.55)] ring-1 ring-white/20 sm:h-28 sm:w-28"
              >
                <img
                  src={activeCover}
                  alt={previewTitle}
                  className="h-full w-full object-cover"
                />
                <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
                  <Camera className="h-4 w-4 text-white" />
                  <span className="text-[10px] font-bold text-white">Subir foto</span>
                </span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                aria-label="Archivo de portada"
                className="hidden"
                onChange={(e) => void handleCoverUpload(e)}
              />
              <div className="flex items-center justify-center gap-1">
                <button
                  type="button"
                  onClick={() => {
                    if (customCoverUrl) {
                      setCustomCoverUrl(null);
                    } else {
                      setCoverSeed((s) => s + 1);
                    }
                    triggerHaptic('light');
                  }}
                  className="pm-compact-btn pm-hover inline-flex h-6 items-center gap-1 rounded-full bg-white/[0.08] px-2 text-[10.5px] font-semibold pm-text-secondary hover:text-white"
                >
                  <Palette className="h-3 w-3" />
                  <span>{customCoverUrl ? 'Auto' : 'Estilo'}</span>
                </button>
              </div>
            </div>

            <div className="min-w-0 flex-1 space-y-2.5">
              <div>
                <label
                  htmlFor="pm-create-playlist-name"
                  className="mb-1 block text-[10.5px] font-bold uppercase tracking-wider pm-text-tertiary"
                >
                  Nombre
                </label>
                <input
                  id="pm-create-playlist-name"
                  data-testid="create-playlist-name-input"
                  type="text"
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={fallbackName}
                  maxLength={80}
                  className="pm-input w-full rounded-[14px] px-3.5 py-2.5 text-sm font-bold pm-text-primary placeholder:pm-text-tertiary"
                />
              </div>

              <div>
                <input
                  type="text"
                  aria-label="Descripción opcional"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Descripción o vibra (opcional)..."
                  maxLength={140}
                  className="pm-input w-full rounded-[12px] px-3.5 py-2 text-xs pm-text-primary placeholder:pm-text-tertiary"
                />
              </div>
            </div>
          </div>

          {/* 1-tap preset ideas */}
          {!name.trim() && (
            <div className="space-y-1.5">
              <div className="text-[10.5px] font-bold uppercase tracking-wider pm-text-tertiary">
                Ideas rápidas
              </div>
              <div className="flex flex-wrap gap-1.5">
                {QUICK_PLAYLIST_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => {
                      triggerHaptic('light');
                      setName(preset);
                    }}
                    className="pm-compact-btn pm-pressable inline-flex h-7 items-center rounded-full border border-white/10 bg-white/[0.05] px-3 text-[11.5px] font-semibold pm-text-secondary transition hover:bg-white/[0.12] hover:text-white"
                  >
                    {preset}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Optional Fast Song Picker */}
          <div className="space-y-2 border-t border-white/[0.08] pt-3">
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider pm-text-tertiary">
                <Music2 className="h-3.5 w-3.5" />
                <span>Añadir temas al crear</span>
              </span>
              {selectedTracks.length > 0 && (
                <span className="tabular-nums rounded-full bg-white px-2 py-0.5 text-[10.5px] font-black text-black">
                  {selectedTracks.length}{' '}
                  {selectedTracks.length === 1 ? 'elegida' : 'elegidas'}
                </span>
              )}
            </div>

            <div className="pm-input flex h-9 items-center gap-2 rounded-full px-3.5">
              <Search className="h-3.5 w-3.5 shrink-0 pm-text-tertiary" />
              <input
                type="search"
                aria-label="Buscar canciones para tu nueva playlist"
                value={songQuery}
                onChange={(e) => setSongQuery(e.target.value)}
                placeholder="Buscar canción o artista..."
                className="pm-text-btn w-full bg-transparent text-xs pm-text-primary placeholder:pm-text-tertiary focus:outline-none"
              />
              {searchingSongs && <Loader2 className="h-3.5 w-3.5 animate-spin pm-text-tertiary" />}
              {songQuery && !searchingSongs && (
                <button
                  type="button"
                  aria-label="Limpiar búsqueda de canciones"
                  onClick={() => setSongQuery('')}
                  className="pm-compact-btn flex h-6 w-6 shrink-0 items-center justify-center rounded-full pm-text-tertiary hover:text-white"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {suggestedTracks.length > 0 ? (
              <div className="max-h-44 space-y-1 overflow-y-auto pr-0.5 pm-no-scrollbar">
                {suggestedTracks.map((tr) => {
                  const picked = selectedIdSet.has(tr.id);
                  return (
                    <button
                      key={tr.id}
                      type="button"
                      onClick={() => toggleTrackSelection(tr)}
                      className={`pm-compact-btn pm-pressable flex w-full items-center justify-between gap-2.5 rounded-[12px] px-2 py-1.5 text-left transition ${
                        picked
                          ? 'bg-white/[0.12] ring-1 ring-white/25'
                          : 'hover:bg-white/[0.06]'
                      }`}
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-2.5">
                        <div className="relative h-9 w-9 shrink-0 overflow-hidden rounded-[8px] bg-white/[0.06]">
                          <TrackArtwork
                            trackId={tr.id}
                            src={tr.thumbnailUrl}
                            title={tr.title}
                            artistName={tr.artists[0]?.name}
                            alt={tr.title}
                            variant="list"
                            imgClassName="h-full w-full object-cover"
                          />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-xs font-bold pm-text-primary">
                            {tr.title}
                          </div>
                          <div className="truncate text-[11px] pm-text-tertiary">
                            {tr.artists.map((a) => a.name).join(', ')}
                          </div>
                        </div>
                      </div>
                      <span
                        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition ${
                          picked
                            ? 'bg-white text-black'
                            : 'bg-white/[0.08] text-white/80'
                        }`}
                      >
                        {picked ? (
                          <Check className="h-3.5 w-3.5 stroke-[2.6]" />
                        ) : (
                          <Plus className="h-3.5 w-3.5" />
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="py-2 text-center text-[11px] pm-text-tertiary">
                {songQuery.trim().length >= 2 && !searchingSongs
                  ? 'Sin resultados para esta búsqueda'
                  : 'Puedes crearla ahora y añadir canciones dentro en cualquier momento'}
              </p>
            )}
          </div>
        </div>

        {/* Footer actions */}
        <div className="relative z-10 flex items-center justify-end gap-2 border-t border-white/[0.08] bg-black/35 px-5 py-3.5 pb-[max(0.9rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            onClick={close}
            className="pm-btn-secondary pm-compact-btn h-10 rounded-full px-4 text-xs font-semibold"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={submitting}
            data-testid="create-playlist-submit-btn"
            className="pm-btn-primary pm-compact-btn pm-pressable inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-full px-5 text-xs font-black shadow-lg disabled:opacity-50 sm:flex-initial"
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            <span>
              {selectedTracks.length > 0
                ? `Crear (${selectedTracks.length})`
                : 'Crear playlist'}
            </span>
          </button>
        </div>
      </form>
    </div>,
    document.body
  );
};
