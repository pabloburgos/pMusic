import React, { useEffect, useState } from 'react';
import { Link2, Loader2, Play, Plus, Users, X } from 'lucide-react';
import type { Track } from '@pmusic/core';
import { getSyncSupabaseClient, usePMusicStore } from '../store/usePMusicStore.ts';
import {
  addTrackToSharedPlaylist,
  buildPlaylistShareUrl,
  fetchSharedPlaylistByCode,
  joinSharedPlaylistByCode,
  type SharedPlaylistRecord,
} from '../services/social-service.ts';

export const SharedPlaylistLinkModal: React.FC<{
  shareCode: string | null;
  onClose: () => void;
}> = ({ shareCode, onClose }) => {
  const {
    authState,
    userProfile,
    playCollection,
    createPlaylist,
    searchTracksForPlaylist,
    setAuthOnboardingOpen,
    showToast,
  } = usePMusicStore();

  const [playlist, setPlaylist] = useState<SharedPlaylistRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addQuery, setAddQuery] = useState('');
  const [addHits, setAddHits] = useState<Track[]>([]);
  const [searching, setSearching] = useState(false);

  const sb = getSyncSupabaseClient();

  useEffect(() => {
    if (!shareCode) {
      setPlaylist(null);
      return;
    }
    let alive = true;
    setLoading(true);
    setError(null);
    void fetchSharedPlaylistByCode(shareCode, sb)
      .then(async (found) => {
        if (!alive) return;
        if (!found) {
          setError('No se encontró esa playlist o el enlace expiró.');
          setPlaylist(null);
          return;
        }
        if (sb && authState.connected && authState.userId && found.allowLinkEdit) {
          const joined = await joinSharedPlaylistByCode(sb, found, authState.userId);
          if (alive) setPlaylist(joined);
        } else {
          setPlaylist(found);
        }
      })
      .catch(() => {
        if (alive) setError('Error cargando la playlist compartida.');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [shareCode, authState.connected, authState.userId]);

  if (!shareCode) return null;

  const adderIdentity = {
    userId: authState.userId ?? undefined,
    username: userProfile?.username,
    displayName:
      userProfile?.displayName ||
      authState.displayName ||
      authState.email?.split('@')[0] ||
      'Colaborador',
    avatarUrl: userProfile?.avatarUrl ?? authState.avatarUrl ?? null,
  };

  return (
    <div
      className="fixed inset-0 z-[125] flex items-end justify-center bg-black/75 p-0 backdrop-blur-xl sm:items-center sm:p-5"
      role="dialog"
      aria-modal="true"
      aria-label="Playlist compartida"
    >
      <div className="pm-glass-regular pm-modal-pop flex max-h-[88dvh] w-full flex-col overflow-hidden rounded-t-[28px] sm:max-w-xl sm:rounded-[24px]">
        <header className="flex items-center justify-between border-b pm-border px-5 py-4">
          <div className="flex items-center gap-2 text-sm font-bold pm-text-primary">
            <Users className="h-4 w-4 text-purple-300" />
            <span>
              {playlist?.allowLinkEdit ? 'Playlist colaborativa' : 'Playlist compartida'}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="pm-btn-secondary flex h-8 w-8 items-center justify-center rounded-full"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-12 text-xs pm-text-secondary">
              <Loader2 className="h-4 w-4 animate-spin" /> Cargando playlist...
            </div>
          )}

          {error && (
            <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-center text-xs text-rose-200">
              {error}
            </div>
          )}

          {playlist && (
            <>
              <div className="flex items-center gap-4">
                {playlist.coverUrl ? (
                  <img
                    src={playlist.coverUrl}
                    alt={playlist.name}
                    className="h-20 w-20 shrink-0 rounded-2xl object-cover shadow-lg"
                  />
                ) : (
                  <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl bg-white/10 text-2xl font-bold pm-text-primary">
                    {playlist.name.slice(0, 1).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-xl font-bold pm-text-primary">{playlist.name}</h2>
                  <p className="mt-0.5 text-xs pm-text-secondary">
                    {playlist.tracks.length} canciones ·{' '}
                    {playlist.allowLinkEdit
                      ? 'Cualquiera con este enlace puede añadir canciones'
                      : 'Solo lectura'}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={playlist.tracks.length === 0}
                  onClick={() => void playCollection(playlist.tracks, { isPlaylist: true })}
                  className="pm-btn-primary inline-flex items-center gap-1.5 rounded-full px-5 py-2 text-xs font-bold disabled:opacity-40"
                >
                  <Play className="h-3.5 w-3.5 fill-current" /> Reproducir
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    await createPlaylist(playlist.name, playlist.description, playlist.tracks);
                    showToast(`"${playlist.name}" guardada en tu Biblioteca`);
                  }}
                  className="pm-btn-secondary inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-semibold"
                >
                  <Plus className="h-3.5 w-3.5" /> Guardar en biblioteca
                </button>
                {playlist.shareCode && (
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard?.writeText(buildPlaylistShareUrl(playlist.shareCode!));
                      showToast('Enlace copiado');
                    }}
                    className="pm-btn-secondary inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-semibold"
                  >
                    <Link2 className="h-3.5 w-3.5" /> Copiar enlace
                  </button>
                )}
              </div>

              {playlist.allowLinkEdit && (
                <div className="pm-surface-card space-y-2.5 rounded-2xl p-3.5">
                  {!authState.connected ? (
                    <div className="flex items-center justify-between gap-2 text-xs pm-text-secondary">
                      <span>Inicia sesión para añadir canciones como colaborador</span>
                      <button
                        type="button"
                        onClick={() => setAuthOnboardingOpen(true)}
                        className="pm-btn-primary shrink-0 rounded-full px-3.5 py-1.5 text-xs font-bold"
                      >
                        Entrar
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="flex gap-2">
                        <input
                          type="search"
                          value={addQuery}
                          onChange={async (e) => {
                            const q = e.target.value;
                            setAddQuery(q);
                            if (q.trim().length >= 2) {
                              setSearching(true);
                              const hits = await searchTracksForPlaylist(q);
                              setAddHits(hits.slice(0, 5));
                              setSearching(false);
                            } else {
                              setAddHits([]);
                            }
                          }}
                          placeholder="Buscar canción para añadir a esta colaborativa..."
                          className="pm-input flex-1 rounded-full px-3.5 py-2 text-xs"
                        />
                        {searching && <Loader2 className="h-4 w-4 animate-spin self-center" />}
                      </div>
                      {addHits.length > 0 && (
                        <div className="space-y-1.5">
                          {addHits.map((t) => (
                            <div key={t.id} className="flex items-center justify-between gap-2 rounded-xl bg-white/[0.04] p-2">
                              <div className="flex min-w-0 items-center gap-2">
                                <img src={t.thumbnailUrl} alt="" className="h-8 w-8 rounded-lg object-cover" />
                                <div className="min-w-0">
                                  <div className="truncate text-xs font-semibold pm-text-primary">{t.title}</div>
                                  <div className="truncate text-[10.5px] pm-text-secondary">
                                    {t.artists.map((a) => a.name).join(', ')}
                                  </div>
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={async () => {
                                  if (!sb) return;
                                  const updated = await addTrackToSharedPlaylist(sb, playlist, t, adderIdentity);
                                  setPlaylist(updated);
                                  showToast(`"${t.title}" añadida por ${adderIdentity.displayName}`);
                                }}
                                className="pm-btn-primary rounded-full px-3 py-1 text-[11px] font-bold"
                              >
                                Añadir
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              <div className="space-y-1.5">
                {playlist.tracks.map((t, idx) => (
                  <div
                    key={t.id}
                    onClick={() => void playCollection(playlist.tracks, { startIndex: idx, isPlaylist: true })}
                    className="pm-hover flex cursor-pointer items-center justify-between gap-3 rounded-xl px-3 py-2"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <img src={t.thumbnailUrl} alt="" className="h-10 w-10 rounded-lg object-cover" />
                      <div className="min-w-0">
                        <div className="truncate text-xs font-bold pm-text-primary">{t.title}</div>
                        <div className="truncate text-[11px] pm-text-secondary">
                          {t.artists.map((a) => a.name).join(', ')}
                        </div>
                      </div>
                    </div>
                    {t.addedBy?.displayName && (
                      <span className="shrink-0 rounded-full bg-white/[0.06] px-2 py-0.5 text-[10.5px] font-semibold pm-text-secondary">
                        Añadida por {t.addedBy.displayName}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
