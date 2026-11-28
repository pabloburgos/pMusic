import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Camera,
  Check,
  Loader2,
  Plus,
  Search,
  Shuffle,
  Trash2,
  X,
} from 'lucide-react';
import type { Track } from '@pmusic/core';
import { usePMusicStore } from '../store/usePMusicStore.ts';
import { PlaylistCoverArt } from './PlaylistCoverArt.tsx';
import { TrackArtwork } from './TrackArtwork.tsx';
import {
  compressImageFileToDataUrl,
  formatPlaylistDuration,
  pickRandomCollageCovers,
  type ResolvedPlaylistCover,
} from '../utils/playlist-artwork.ts';
import { triggerHaptic } from '../utils/haptics.ts';

const QUICK_TITLE_CHIPS = ['Noche', 'Gym', 'Coche', 'Chill', 'Previa', 'Focus'] as const;
type SourceTab = 'Para ti' | 'Me gusta' | 'Recientes' | 'Descubrir';
const SOURCE_TABS: readonly SourceTab[] = ['Para ti', 'Me gusta', 'Recientes', 'Descubrir'];

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
    homeShelves,
    setCreatePlaylistModalOpen,
    createPlaylist,
    updatePlaylistAppearance,
    openLocalPlaylistDetail,
    searchTracksForPlaylist,
    showToast,
  } = usePMusicStore();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [customCoverUrl, setCustomCoverUrl] = useState<string | null>(null);
  const [mosaicUrls, setMosaicUrls] = useState<string[]>([]);
  const [selectedTracks, setSelectedTracks] = useState<Track[]>([]);
  const [sourceTab, setSourceTab] = useState<SourceTab>('Para ti');
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
            setSongResults(res.slice(0, 12));
            setSearchingSongs(false);
          }
        })
        .catch(() => {
          if (searchTokenRef.current === token) {
            setSearchingSongs(false);
          }
        });
    }, 160);
    return () => window.clearTimeout(timer);
  }, [songQuery, searchTracksForPlaylist]);

  const fallbackName = `Mi Playlist #${playlists.length + 1}`;
  const previewTitle = name.trim() || fallbackName;

  // Keep mosaic reactive while adding initial songs, preserving custom shuffles when possible
  useEffect(() => {
    if (selectedTracks.length === 0) {
      setMosaicUrls([]);
      return;
    }
    const nextAuto = pickRandomCollageCovers(selectedTracks, 4);
    setMosaicUrls((prev) => {
      const validPool = new Set(
        selectedTracks
          .map((t) => (t.thumbnailHighUrl ?? t.thumbnailUrl ?? '').trim())
          .filter(Boolean)
      );
      const retained = prev.filter((u) => validPool.has(u));
      if (retained.length === 4) return retained;
      if (nextAuto.length > 0) return nextAuto;
      return retained;
    });
  }, [selectedTracks]);

  const distinctCoverCount = useMemo(() => {
    const s = new Set<string>();
    for (const t of selectedTracks) {
      const u = (t.thumbnailHighUrl ?? t.thumbnailUrl ?? '').trim();
      if (u) s.add(u);
    }
    return s.size;
  }, [selectedTracks]);

  const coverInfo: ResolvedPlaylistCover = useMemo(() => {
    if (customCoverUrl) {
      return { url: customCoverUrl, hasCustomCover: true };
    }
    if (mosaicUrls.length >= 2) {
      return { url: mosaicUrls[0]!, collageUrls: mosaicUrls, hasCustomCover: false };
    }
    if (mosaicUrls.length === 1) {
      return {
        url: mosaicUrls[0]!,
        hasCustomCover: false,
        fallbackTrackId: selectedTracks[0]?.id,
      };
    }
    return { url: '', hasCustomCover: false };
  }, [customCoverUrl, mosaicUrls, selectedTracks]);

  const tabTrackPool = useMemo(() => {
    const out: Track[] = [];
    const seen = new Set<string>();
    const pushUnique = (tr?: Track | null) => {
      if (!tr?.id || seen.has(tr.id)) return;
      seen.add(tr.id);
      out.push(tr);
    };

    if (sourceTab === 'Me gusta') {
      for (const l of likedTracks) pushUnique(l.track);
      return out;
    }
    if (sourceTab === 'Recientes') {
      for (const h of playHistory) pushUnique(h.track);
      return out;
    }
    if (sourceTab === 'Descubrir') {
      for (const shelf of homeShelves) {
        for (const t of shelf.tracks ?? []) pushUnique(t);
      }
      for (const s of searchResults.songs) pushUnique(s);
      return out;
    }

    // "Para ti": balanced mix across likes, recents, shelves, and search
    for (const l of likedTracks.slice(0, 8)) pushUnique(l.track);
    for (const h of playHistory.slice(0, 8)) pushUnique(h.track);
    for (const shelf of homeShelves) {
      for (const t of (shelf.tracks ?? []).slice(0, 6)) pushUnique(t);
    }
    for (const s of searchResults.songs.slice(0, 6)) pushUnique(s);
    return out;
  }, [sourceTab, likedTracks, playHistory, homeShelves, searchResults.songs]);

  const visibleTracks = useMemo(() => {
    const q = songQuery.trim().toLowerCase();
    if (!q) return tabTrackPool.slice(0, 14);
    const localMatches = tabTrackPool.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.artists.some((a) => a.name.toLowerCase().includes(q))
    );
    const merged: Track[] = [];
    const seen = new Set<string>();
    for (const t of [...localMatches, ...songResults]) {
      if (!t?.id || seen.has(t.id)) continue;
      seen.add(t.id);
      merged.push(t);
    }
    return merged.slice(0, 16);
  }, [songQuery, tabTrackPool, songResults]);

  const selectedIdSet = useMemo(
    () => new Set(selectedTracks.map((t) => t.id)),
    [selectedTracks]
  );

  const selectedDurationLabel = useMemo(
    () =>
      formatPlaylistDuration(
        selectedTracks.reduce((acc, t) => acc + (t.durationSec || 0), 0)
      ),
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

  const handleQuickFill4 = () => {
    const candidates = visibleTracks.filter((t) => !selectedIdSet.has(t.id));
    if (candidates.length === 0) {
      showToast('No quedan temas nuevos en esta vista');
      return;
    }
    triggerHaptic('confirm');
    const shuffled = [...candidates].sort(() => Math.random() - 0.5).slice(0, 4);
    setSelectedTracks((prev) => [...prev, ...shuffled]);
  };

  const handleShuffleMosaic = () => {
    if (distinctCoverCount < 2) return;
    triggerHaptic('light');
    setCustomCoverUrl(null);
    setMosaicUrls(pickRandomCollageCovers(selectedTracks, 4));
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
      if (customCoverUrl) {
        await updatePlaylistAppearance('local', created.id, { coverUrl: customCoverUrl });
      } else if (mosaicUrls.length > 0) {
        await updatePlaylistAppearance('local', created.id, { collageUrls: mosaicUrls });
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
        className="pm-spotlight-backdrop absolute inset-0 bg-black/80 backdrop-blur-md"
      />

      <form
        role="dialog"
        aria-modal="true"
        aria-label="Nueva playlist"
        data-testid="create-playlist-modal"
        onSubmit={(e) => void handleCreateSubmit(e)}
        className="pm-hud-dark pm-modal-pop relative z-10 flex h-[92dvh] w-full max-w-xl flex-col overflow-hidden rounded-t-[28px] border border-white/[0.10] bg-[#0a0a0d] shadow-2xl sm:h-auto sm:max-h-[86dvh] sm:rounded-[26px]"
      >
        {/* Pure obsidian ambient halo from real cover only */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-44 overflow-hidden bg-gradient-to-b from-white/[0.04] to-transparent"
        >
          {coverInfo.url && (
            <>
              <img
                src={coverInfo.url}
                alt=""
                className="h-full w-full scale-125 object-cover opacity-30 blur-3xl saturate-125"
              />
              <div className="absolute inset-0 bg-gradient-to-b from-black/25 via-[#0a0a0d]/75 to-[#0a0a0d]" />
            </>
          )}
        </div>

        {/* Mobile drag bar */}
        <div className="relative z-10 flex justify-center pt-2.5 sm:hidden">
          <div className="h-1 w-10 rounded-full bg-white/25" />
        </div>

        {/* Minimal Close bar */}
        <div className="relative z-10 flex items-center justify-between gap-2 px-5 pt-2.5 sm:pt-4">
          <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/55">
            Nueva playlist
          </span>
          <button
            type="button"
            aria-label="Cerrar creación de playlist"
            onClick={close}
            className="pm-compact-btn pm-hover flex h-8 w-8 items-center justify-center rounded-full text-white/65 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Scrollable Interactive Creator */}
        <div className="relative z-10 flex-1 space-y-4 overflow-y-auto px-5 pb-4 pt-2 pm-no-scrollbar">
          {/* Interactive Hero Preview + Big Direct Title */}
          <div className="flex items-start gap-4">
            <div className="shrink-0 space-y-1.5">
              <button
                type="button"
                aria-label="Elegir portada de playlist"
                onClick={() => fileInputRef.current?.click()}
                className="pm-compact-btn pm-pressable group relative block h-24 w-24 overflow-hidden rounded-[16px] bg-[#141418] shadow-[0_18px_40px_rgba(0,0,0,0.65)] ring-1 ring-white/[0.14] sm:h-28 sm:w-28"
              >
                <PlaylistCoverArt
                  coverInfo={coverInfo}
                  title={previewTitle}
                  variant="card"
                  iconClassName="h-8 w-8"
                />
                <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/55 opacity-0 transition-opacity group-hover:opacity-100">
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
                  onClick={() =>
                    customCoverUrl ? setCustomCoverUrl(null) : fileInputRef.current?.click()
                  }
                  className="pm-compact-btn pm-hover inline-flex h-6 items-center gap-1 rounded-full bg-white/[0.08] px-2.5 text-[10.5px] font-semibold text-white/80 hover:text-white"
                >
                  <Camera className="h-3 w-3" />
                  <span>{customCoverUrl ? 'Mosaico' : 'Foto'}</span>
                </button>
                {distinctCoverCount >= 2 && !customCoverUrl && (
                  <button
                    type="button"
                    data-testid="create-playlist-shuffle-mosaic-btn"
                    onClick={handleShuffleMosaic}
                    title="Mezclar 4 portadas"
                    className="pm-compact-btn pm-hover inline-flex h-6 w-6 items-center justify-center rounded-full bg-white/[0.08] text-white/80 hover:text-white"
                  >
                    <Shuffle className="h-3 w-3" />
                  </button>
                )}
              </div>
            </div>

            <div className="min-w-0 flex-1 space-y-2 pt-0.5">
              <input
                id="pm-create-playlist-name"
                data-testid="create-playlist-name-input"
                type="text"
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={fallbackName}
                maxLength={80}
                className="w-full border-b border-white/[0.12] bg-transparent pb-1.5 text-xl font-black tracking-tight text-white placeholder:text-white/35 focus:border-white/50 focus:outline-none sm:text-2xl"
              />
              <input
                type="text"
                aria-label="Descripción opcional"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Añade una descripción opcional..."
                maxLength={140}
                className="w-full bg-transparent text-xs text-white/75 placeholder:text-white/35 focus:outline-none"
              />
              <div className="tabular-nums text-[11.5px] font-medium text-white/55">
                {selectedTracks.length > 0
                  ? `${selectedTracks.length} ${selectedTracks.length === 1 ? 'pista' : 'pistas'}${
                      selectedDurationLabel ? ` · ${selectedDurationLabel}` : ''
                    }`
                  : 'El icono se creará automáticamente con 4 portadas'}
              </div>
            </div>
          </div>

          {/* 1-tap quick title chips */}
          {!name.trim() && (
            <div className="flex flex-nowrap gap-1.5 overflow-x-auto pb-0.5 pm-no-scrollbar">
              {QUICK_TITLE_CHIPS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => {
                    triggerHaptic('light');
                    setName(preset);
                  }}
                  className="pm-compact-btn pm-pressable inline-flex h-7 shrink-0 items-center rounded-full border border-white/10 bg-white/[0.05] px-3 text-[11.5px] font-semibold text-white/80 transition hover:bg-white/[0.12] hover:text-white"
                >
                  {preset}
                </button>
              ))}
            </div>
          )}

          {/* Selected tracks interactive chip tray */}
          {selectedTracks.length > 0 && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[10.5px] font-bold uppercase tracking-wider text-white/50">
                  En tu lista ({selectedTracks.length})
                </span>
                {selectedTracks.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setSelectedTracks([])}
                    className="pm-compact-btn inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold text-white/55 hover:text-white"
                  >
                    <Trash2 className="h-3 w-3" />
                    <span>Vaciar</span>
                  </button>
                )}
              </div>
              <div className="flex flex-nowrap gap-1.5 overflow-x-auto pb-0.5 pm-no-scrollbar">
                {selectedTracks.map((tr) => (
                  <button
                    key={`sel-${tr.id}`}
                    type="button"
                    onClick={() => toggleTrackSelection(tr)}
                    className="pm-compact-btn inline-flex h-8 max-w-[175px] shrink-0 items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.08] pl-1 pr-2.5 text-[11.5px] font-semibold text-white hover:bg-white/[0.14]"
                  >
                    <span className="relative h-6 w-6 shrink-0 overflow-hidden rounded-full bg-white/[0.06]">
                      <TrackArtwork
                        trackId={tr.id}
                        src={tr.thumbnailUrl}
                        title={tr.title}
                        artistName={tr.artists[0]?.name}
                        alt={tr.title}
                        variant="list"
                        imgClassName="h-full w-full object-cover"
                      />
                    </span>
                    <span className="truncate">{tr.title}</span>
                    <X className="h-3 w-3 shrink-0 text-white/60" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Interactive Song Builder */}
          <div className="space-y-2.5 border-t border-white/[0.08] pt-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 flex-1 flex-nowrap gap-1.5 overflow-x-auto pm-no-scrollbar">
                {SOURCE_TABS.map((tab) => {
                  const active = sourceTab === tab;
                  return (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => {
                        triggerHaptic('light');
                        setSourceTab(tab);
                      }}
                      className={`pm-compact-btn h-7 shrink-0 rounded-full px-3 text-[11.5px] font-bold transition ${
                        active
                          ? 'bg-white text-[#070709]'
                          : 'bg-white/[0.06] text-white/70 hover:bg-white/[0.12] hover:text-white'
                      }`}
                    >
                      {tab}
                    </button>
                  );
                })}
              </div>

              <button
                type="button"
                data-testid="create-playlist-quick-fill-btn"
                onClick={handleQuickFill4}
                className="pm-compact-btn pm-pressable inline-flex h-7 shrink-0 items-center gap-1 rounded-full border border-white/15 bg-white/[0.08] px-3 text-[11px] font-bold text-white hover:bg-white/[0.15]"
              >
                <Plus className="h-3 w-3" />
                <span>+4 al azar</span>
              </button>
            </div>

            <div className="flex h-9 items-center gap-2 rounded-full border border-white/[0.10] bg-white/[0.05] px-3.5">
              <Search className="h-3.5 w-3.5 shrink-0 text-white/45" />
              <input
                type="search"
                aria-label="Buscar canciones para tu nueva playlist"
                value={songQuery}
                onChange={(e) => setSongQuery(e.target.value)}
                placeholder="Buscar canciones o artistas..."
                className="pm-text-btn w-full bg-transparent text-xs text-white placeholder:text-white/40 focus:outline-none"
              />
              {searchingSongs && <Loader2 className="h-3.5 w-3.5 animate-spin text-white/60" />}
              {songQuery && !searchingSongs && (
                <button
                  type="button"
                  aria-label="Limpiar búsqueda de canciones"
                  onClick={() => setSongQuery('')}
                  className="pm-compact-btn flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-white/55 hover:text-white"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {visibleTracks.length > 0 ? (
              <div className="space-y-1">
                {visibleTracks.map((tr) => {
                  const picked = selectedIdSet.has(tr.id);
                  return (
                    <button
                      key={tr.id}
                      type="button"
                      onClick={() => toggleTrackSelection(tr)}
                      className={`pm-compact-btn pm-pressable flex w-full items-center justify-between gap-2.5 rounded-[12px] px-2 py-1.5 text-left transition ${
                        picked ? 'bg-white/[0.10]' : 'hover:bg-white/[0.05]'
                      }`}
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-2.5">
                        <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-[8px] bg-[#141418]">
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
                          <div className="truncate text-[13px] font-bold text-white">
                            {tr.title}
                          </div>
                          <div className="truncate text-[11px] text-white/55">
                            {tr.artists.map((a) => a.name).join(', ')}
                          </div>
                        </div>
                      </div>
                      <span
                        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition ${
                          picked
                            ? 'bg-white text-[#070709]'
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
              <p className="py-4 text-center text-xs text-white/50">
                {songQuery.trim().length >= 2 && !searchingSongs
                  ? 'Sin resultados para esta búsqueda'
                  : 'Busca cualquier tema o elige canciones al instante'}
              </p>
            )}
          </div>
        </div>

        {/* Fixed OLED Footer */}
        <div className="relative z-10 flex items-center justify-end gap-2 border-t border-white/[0.08] bg-black/50 px-5 py-3.5 pb-[max(0.9rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            onClick={close}
            className="pm-compact-btn h-10 rounded-full border border-white/12 bg-white/[0.06] px-4 text-xs font-semibold text-white/80 hover:bg-white/[0.12] hover:text-white"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={submitting}
            data-testid="create-playlist-submit-btn"
            className="pm-compact-btn pm-pressable inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-full bg-white px-5 text-xs font-black text-[#070709] shadow-lg disabled:opacity-50 sm:flex-initial"
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            <span>
              {selectedTracks.length > 0
                ? `Crear · ${selectedTracks.length} ${
                    selectedTracks.length === 1 ? 'tema' : 'temas'
                  }`
                : 'Crear playlist'}
            </span>
          </button>
        </div>
      </form>
    </div>,
    document.body
  );
};
