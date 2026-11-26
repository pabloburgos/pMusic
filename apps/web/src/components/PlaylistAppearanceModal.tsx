import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Image as ImageIcon, RotateCcw, Sparkles, Upload, X } from 'lucide-react';
import { usePMusicStore } from '../store/usePMusicStore.ts';
import { PMusicSwitch } from './PMusicSwitch.tsx';
import {
  compressImageFileToDataUrl,
  formatPlaylistDuration,
  generatePlaylistBannerDataUrl,
  generatePlaylistCoverDataUrl,
} from '../utils/playlist-artwork.ts';

export const PlaylistAppearanceModal: React.FC = React.memo(() => {
  const open = usePMusicStore((s) => Boolean(s.playlistAppearanceModal));
  if (!open) return null;
  return <PlaylistAppearanceModalInner />;
});
PlaylistAppearanceModal.displayName = 'PlaylistAppearanceModal';

const PlaylistAppearanceModalInner: React.FC = () => {
  const {
    playlistAppearanceModal,
    playlists,
    sharedPlaylists,
    playlistAppearances,
    closePlaylistAppearanceModal,
    updatePlaylistAppearance,
    renamePlaylist,
    showToast,
  } = usePMusicStore();

  const [nameInput, setNameInput] = useState('');
  const [coverUrlInput, setCoverUrlInput] = useState('');
  const [bannerUrlInput, setBannerUrlInput] = useState('');
  const coverFileRef = useRef<HTMLInputElement | null>(null);
  const bannerFileRef = useRef<HTMLInputElement | null>(null);

  const localPl =
    playlistAppearanceModal?.kind === 'local'
      ? playlists.find((p) => p.id === playlistAppearanceModal.playlistId)
      : undefined;
  const sharedPl =
    playlistAppearanceModal?.kind === 'shared'
      ? sharedPlaylists.find((p) => p.id === playlistAppearanceModal.playlistId)
      : undefined;

  const activeName = localPl?.name ?? sharedPl?.name ?? '';
  const activeId = playlistAppearanceModal?.playlistId ?? '';
  const savedApp = activeId ? playlistAppearances[activeId] : undefined;
  const activeTracks = localPl?.tracks ?? sharedPl?.tracks ?? [];
  const activeSeed = savedApp?.coverStyleSeed ?? localPl?.coverStyleSeed ?? 0;
  const bannerEnabled = savedApp?.bannerEnabled ?? localPl?.bannerEnabled ?? true;

  useEffect(() => {
    if (!playlistAppearanceModal) return;
    setNameInput(activeName);
    const curCover = savedApp?.coverUrl ?? localPl?.coverUrl ?? sharedPl?.coverUrl ?? '';
    const curBanner = savedApp?.bannerUrl ?? localPl?.bannerUrl ?? '';
    setCoverUrlInput(curCover.startsWith('data:') ? '' : curCover);
    setBannerUrlInput(curBanner.startsWith('data:') ? '' : curBanner);
  }, [playlistAppearanceModal?.playlistId, playlistAppearanceModal?.kind]);

  if (!playlistAppearanceModal || (!localPl && !sharedPl) || typeof document === 'undefined') {
    return null;
  }

  const kind = playlistAppearanceModal.kind;
  const trackThumb = activeTracks[0]?.thumbnailHighUrl ?? activeTracks[0]?.thumbnailUrl ?? '';
  const currentCover =
    savedApp?.coverUrl ??
    localPl?.coverUrl ??
    sharedPl?.coverUrl ??
    trackThumb ??
    generatePlaylistCoverDataUrl(activeName, activeSeed);
  const currentBanner =
    savedApp?.bannerUrl ??
    localPl?.bannerUrl ??
    trackThumb ??
    generatePlaylistBannerDataUrl(activeName, activeSeed);
  const totalDurLabel = formatPlaylistDuration(
    activeTracks.reduce((acc, t) => acc + (t.durationSec || 0), 0)
  );

  const handleUploadFile = async (
    e: React.ChangeEvent<HTMLInputElement>,
    target: 'cover' | 'banner'
  ) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const dataUrl =
        target === 'cover'
          ? await compressImageFileToDataUrl(file, 512, 512)
          : await compressImageFileToDataUrl(file, 1400, 520);
      if (target === 'cover') {
        await updatePlaylistAppearance(kind, activeId, { coverUrl: dataUrl });
        showToast('Portada actualizada');
      } else {
        await updatePlaylistAppearance(kind, activeId, {
          bannerUrl: dataUrl,
          bannerEnabled: true,
        });
        showToast('Banner actualizado');
      }
    } catch {
      showToast('No se pudo cargar la imagen');
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[9998] flex items-center justify-center p-4">
      <div
        aria-hidden="true"
        onClick={closePlaylistAppearanceModal}
        className="pm-spotlight-backdrop absolute inset-0 bg-black/75 backdrop-blur-sm"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Personalizar playlist"
        data-testid="playlist-appearance-modal"
        className="pm-glass-frosted-neutral pm-hud-dark pm-modal-pop relative z-10 max-h-[90vh] w-full max-w-lg space-y-4 overflow-y-auto rounded-[24px] border border-white/15 p-5 shadow-2xl"
      >
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-extrabold text-white">
              Personalizar «{activeName}»
            </h2>
            <p className="text-[11px] text-white/65">
              Portada, banner estilo artista y diseño personalizado en pMusic
            </p>
          </div>
          <button
            type="button"
            aria-label="Cerrar personalización"
            onClick={closePlaylistAppearanceModal}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white/80 hover:bg-white/20"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Live Mini Hero Preview */}
        <div className="relative overflow-hidden rounded-[18px] border border-white/12 bg-[#0b0b10]">
          {bannerEnabled && (
            <>
              <img
                src={currentBanner}
                alt=""
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-70"
              />
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0"
                style={{
                  background:
                    'linear-gradient(180deg, rgba(10,10,14,0.22) 0%, rgba(10,10,14,0.88) 100%)',
                }}
              />
            </>
          )}
          <div className="relative z-10 flex items-end gap-3.5 p-4 pt-9">
            <img
              src={currentCover}
              alt={activeName}
              className="h-16 w-16 shrink-0 rounded-[12px] object-cover shadow-lg ring-1 ring-white/15"
            />
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-bold uppercase tracking-wider text-white/75">
                {activeTracks.length} pistas{totalDurLabel ? ` · ${totalDurLabel}` : ''}
              </div>
              <div className="truncate text-lg font-black text-white">{activeName}</div>
            </div>
          </div>
        </div>

        {/* Rename Name (Local Playlists) */}
        {kind === 'local' && (
          <div className="space-y-1.5">
            <label className="text-[11px] font-bold uppercase tracking-wider text-white/60">
              Nombre de la playlist
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                className="pm-input flex-1 rounded-full px-3.5 py-2 text-xs text-white"
              />
              <button
                type="button"
                onClick={async () => {
                  const trimmed = nameInput.trim();
                  if (!trimmed) return;
                  await renamePlaylist(activeId, trimmed);
                  showToast('Nombre actualizado');
                }}
                className="rounded-full bg-white px-3.5 py-2 text-xs font-bold text-[#070709]"
              >
                Guardar
              </button>
            </div>
          </div>
        )}

        {/* Banner Mode Switch */}
        <div className="flex items-center justify-between gap-3 rounded-[16px] border border-white/10 bg-white/[0.04] px-4 py-3">
          <div className="min-w-0">
            <div className="text-xs font-bold text-white">Banner estilo artista</div>
            <div className="text-[11px] text-white/65">
              Cabecera panorámica inmersiva (desactívalo para ver el diseño clásico)
            </div>
          </div>
          <PMusicSwitch
            checked={bannerEnabled}
            onChange={() => void updatePlaylistAppearance(kind, activeId, { bannerEnabled: !bannerEnabled })}
            ariaLabel="Activar banner estilo artista"
          />
        </div>

        {/* Cover Customization */}
        <div className="space-y-2 rounded-[16px] border border-white/10 bg-white/[0.04] p-3.5">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-xs font-bold text-white">
              <ImageIcon className="h-3.5 w-3.5 text-purple-300" />
              Portada cuadrada
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => coverFileRef.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-full bg-white/12 px-3 py-1.5 text-[11.5px] font-semibold text-white hover:bg-white/20"
            >
              <Upload className="h-3.5 w-3.5" />
              <span>Subir imagen</span>
            </button>
            <button
              type="button"
              data-testid="generate-playlist-cover-btn"
              onClick={async () => {
                const nextSeed = activeSeed + 1;
                const url = generatePlaylistCoverDataUrl(activeName, nextSeed);
                setCoverUrlInput('');
                await updatePlaylistAppearance(kind, activeId, {
                  coverUrl: url,
                  coverStyleSeed: nextSeed,
                });
                showToast('Portada pMusic generada');
              }}
              className="inline-flex items-center gap-1.5 rounded-full bg-purple-500/25 px-3 py-1.5 text-[11.5px] font-semibold text-purple-200 hover:bg-purple-500/35"
            >
              <Sparkles className="h-3.5 w-3.5" />
              <span>Generar portada pMusic</span>
            </button>
            <button
              type="button"
              onClick={async () => {
                setCoverUrlInput('');
                await updatePlaylistAppearance(kind, activeId, { coverUrl: '' });
                showToast('Portada automática restaurada');
              }}
              className="inline-flex items-center gap-1.5 rounded-full bg-white/8 px-3 py-1.5 text-[11.5px] font-semibold text-white/75 hover:bg-white/15"
            >
              <RotateCcw className="h-3 w-3" />
              <span>Automática</span>
            </button>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <input
              type="url"
              placeholder="O pega URL de imagen para portada..."
              value={coverUrlInput}
              onChange={(e) => setCoverUrlInput(e.target.value)}
              className="pm-input flex-1 rounded-full px-3 py-1.5 text-[11.5px] text-white"
            />
            <button
              type="button"
              onClick={async () => {
                const u = coverUrlInput.trim();
                if (!u) return;
                await updatePlaylistAppearance(kind, activeId, { coverUrl: u });
                showToast('Portada aplicada');
              }}
              className="rounded-full bg-white/15 px-3 py-1.5 text-[11.5px] font-semibold text-white hover:bg-white/25"
            >
              Aplicar
            </button>
          </div>
          <input
            ref={coverFileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => void handleUploadFile(e, 'cover')}
          />
        </div>

        {/* Banner Customization */}
        <div className="space-y-2 rounded-[16px] border border-white/10 bg-white/[0.04] p-3.5">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-xs font-bold text-white">
              <ImageIcon className="h-3.5 w-3.5 text-sky-300" />
              Banner panorámico
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => bannerFileRef.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-full bg-white/12 px-3 py-1.5 text-[11.5px] font-semibold text-white hover:bg-white/20"
            >
              <Upload className="h-3.5 w-3.5" />
              <span>Subir banner</span>
            </button>
            <button
              type="button"
              data-testid="generate-playlist-banner-btn"
              onClick={async () => {
                const nextSeed = activeSeed + 1;
                const url = generatePlaylistBannerDataUrl(activeName, nextSeed);
                setBannerUrlInput('');
                await updatePlaylistAppearance(kind, activeId, {
                  bannerUrl: url,
                  bannerEnabled: true,
                  coverStyleSeed: nextSeed,
                });
                showToast('Banner pMusic generado');
              }}
              className="inline-flex items-center gap-1.5 rounded-full bg-sky-500/25 px-3 py-1.5 text-[11.5px] font-semibold text-sky-200 hover:bg-sky-500/35"
            >
              <Sparkles className="h-3.5 w-3.5" />
              <span>Generar banner pMusic</span>
            </button>
            <button
              type="button"
              onClick={async () => {
                setBannerUrlInput('');
                await updatePlaylistAppearance(kind, activeId, { bannerUrl: null });
                showToast('Banner automático restaurado');
              }}
              className="inline-flex items-center gap-1.5 rounded-full bg-white/8 px-3 py-1.5 text-[11.5px] font-semibold text-white/75 hover:bg-white/15"
            >
              <RotateCcw className="h-3 w-3" />
              <span>Automático</span>
            </button>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <input
              type="url"
              placeholder="O pega URL de imagen para banner..."
              value={bannerUrlInput}
              onChange={(e) => setBannerUrlInput(e.target.value)}
              className="pm-input flex-1 rounded-full px-3 py-1.5 text-[11.5px] text-white"
            />
            <button
              type="button"
              onClick={async () => {
                const u = bannerUrlInput.trim();
                if (!u) return;
                await updatePlaylistAppearance(kind, activeId, {
                  bannerUrl: u,
                  bannerEnabled: true,
                });
                showToast('Banner aplicado');
              }}
              className="rounded-full bg-white/15 px-3 py-1.5 text-[11.5px] font-semibold text-white hover:bg-white/25"
            >
              Aplicar
            </button>
          </div>
          <input
            ref={bannerFileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => void handleUploadFile(e, 'banner')}
          />
        </div>
      </div>
    </div>,
    document.body
  );
};
