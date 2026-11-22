import React, { useEffect, useRef } from 'react';
import {
  Disc3,
  Loader2,
  MoreVertical,
  Play,
  Search,
  User,
  X,
} from 'lucide-react';
import { formatDurationSec } from '@pmusic/core';
import { usePMusicStore } from '../store/usePMusicStore.ts';

export const SpotlightSearchModal: React.FC = () => {
  const {
    spotlightOpen,
    setSpotlightOpen,
    searchQuery,
    isSearching,
    searchResults,
    bestResult,
    recentSearchItems,
    seedArtists,
    setSearchQuery,
    submitSearch,
    setActiveTab,
    playTrack,
    openArtistDetail,
    openTrackMenu,
    addRecentSearchTrack,
    addRecentSearchArtist,
    removeRecentSearchItem,
    clearRecentSearchItems,
  } = usePMusicStore();

  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!spotlightOpen) return;
    const id = setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 20);
    return () => clearTimeout(id);
  }, [spotlightOpen]);

  if (!spotlightOpen) return null;

  const trimmedQuery = searchQuery.trim();
  const hasQuery = trimmedQuery.length > 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Búsqueda rápida Spotlight"
      data-testid="spotlight-search-modal"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          setSpotlightOpen(false);
        }
      }}
      className="pm-spotlight-backdrop fixed inset-0 z-50 flex items-start justify-center bg-black/60 px-4 pt-[8vh]"
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="pm-modal-pop w-full max-w-[620px]"
      >
        {/* Floating Search Bar */}
        <form
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            void submitSearch(searchQuery);
            setSpotlightOpen(false);
            setActiveTab('Buscar');
          }}
          className="flex items-center gap-3 rounded-[14px] border border-white/[0.12] bg-[#16161B] px-4 py-2.5 shadow-[0_24px_64px_rgba(0,0,0,0.78)] focus-within:border-white/25"
        >
          <Search className="h-4 w-4 shrink-0 text-[#9A9AA6]" />
          <input
            ref={inputRef}
            type="search"
            role="searchbox"
            aria-label="Buscar canciones, artistas o álbumes"
            placeholder="Buscar"
            value={searchQuery}
            onChange={(e) => void setSearchQuery(e.target.value)}
            className="pm-input-frameless flex-1 bg-transparent text-[14px] font-medium text-[#F5F5F7] placeholder:text-[#8E8E98] focus:outline-none"
          />
          {isSearching && (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[#B4B4BE]" />
          )}
          {hasQuery && (
            <button
              type="button"
              aria-label="Limpiar búsqueda"
              onClick={() => {
                void setSearchQuery('', true);
                inputRef.current?.focus();
              }}
              className="flex h-7 w-7 items-center justify-center rounded-full text-[#8E8E98] hover:bg-white/[0.08] hover:text-white"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </form>

        {/* Floating Dropdown Card */}
        <div
          data-testid="spotlight-search-panel"
          className="mt-2 max-h-[68vh] overflow-y-auto rounded-[16px] border border-white/[0.10] bg-[#141419] p-2 shadow-[0_32px_84px_rgba(0,0,0,0.88)] pm-no-scrollbar"
        >
          {!hasQuery ? (
            <div>
              <div className="flex items-center justify-between px-3 py-2">
                <span className="text-xs font-medium text-[#8E8E98]">
                  Búsquedas recientes
                </span>
                {recentSearchItems.length > 0 && (
                  <button
                    type="button"
                    onClick={() => clearRecentSearchItems()}
                    className="rounded-md px-2 py-1 text-xs font-medium text-[#B4B4BE] hover:bg-white/[0.07] hover:text-white"
                  >
                    Borrar
                  </button>
                )}
              </div>

              {recentSearchItems.length > 0 ? (
                <div role="list" className="space-y-0.5">
                  {recentSearchItems.map((item) => {
                    if (item.kind === 'artist') {
                      return (
                        <div
                          key={item.id}
                          role="listitem"
                          className="group flex h-14 items-center gap-2 rounded-[10px] px-2 transition-colors hover:bg-white/[0.07]"
                        >
                          <button
                            type="button"
                            onClick={() => {
                              addRecentSearchArtist({
                                id: item.artistId,
                                name: item.name,
                                thumbnailUrl: item.thumbnailUrl,
                              });
                              setSpotlightOpen(false);
                              void openArtistDetail(item.artistId);
                            }}
                            className="flex min-w-0 flex-1 items-center gap-3 text-left"
                          >
                            <img
                              src={item.thumbnailUrl}
                              alt={item.name}
                              className="h-10 w-10 shrink-0 rounded-full object-cover shadow-sm"
                            />
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-[14px] font-semibold text-[#F5F5F7]">
                                {item.name}
                              </div>
                              <div className="truncate text-xs text-[#8E8E98]">
                                Artistas
                              </div>
                            </div>
                          </button>

                          <button
                            type="button"
                            aria-label={`Quitar ${item.name} de recientes`}
                            onClick={() => removeRecentSearchItem(item.id)}
                            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[#8E8E98] hover:bg-white/[0.10] hover:text-white"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      );
                    }

                    const t = item.track;
                    const artistNames = t.artists.map((a) => a.name).join(', ');
                    return (
                      <div
                        key={item.id}
                        role="listitem"
                        className="group flex h-14 items-center gap-2 rounded-[10px] px-2 transition-colors hover:bg-white/[0.07]"
                      >
                        <button
                          type="button"
                          onClick={() => {
                            addRecentSearchTrack(t);
                            setSpotlightOpen(false);
                            void playTrack(t);
                          }}
                          className="flex min-w-0 flex-1 items-center gap-3 text-left"
                        >
                          <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-[7px] bg-[#1C1C24]">
                            <img
                              src={t.thumbnailUrl}
                              alt={t.title}
                              className="h-full w-full object-cover"
                            />
                            <span className="absolute inset-0 flex items-center justify-center bg-black/45 opacity-0 transition-opacity group-hover:opacity-100">
                              <Play className="h-3.5 w-3.5 translate-x-[1px] fill-current text-white" />
                            </span>
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[14px] font-semibold text-[#F5F5F7]">
                              {t.title}
                            </div>
                            <div className="flex items-center gap-1.5 truncate text-xs text-[#8E8E98]">
                              {t.isExplicit && (
                                <span
                                  aria-label="Explícita"
                                  className="inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-[3px] bg-white/[0.16] px-1 text-[11px] font-bold leading-none text-[#F5F5F7]"
                                >
                                  E
                                </span>
                              )}
                              <span className="truncate">{artistNames}</span>
                            </div>
                          </div>
                        </button>

                        <span className="tabular-nums hidden pr-1 text-xs text-[#8E8E98] sm:inline">
                          {formatDurationSec(t.durationSec)}
                        </span>

                        <button
                          type="button"
                          aria-label={`Más opciones para ${t.title}`}
                          onClick={(e) => {
                            const r = e.currentTarget.getBoundingClientRect();
                            openTrackMenu(t, r.left - 210, r.bottom + 6);
                          }}
                          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[#8E8E98] hover:bg-white/[0.10] hover:text-white"
                        >
                          <MoreVertical className="h-3.5 w-3.5" />
                        </button>

                        <button
                          type="button"
                          aria-label={`Quitar ${t.title} de recientes`}
                          onClick={() => removeRecentSearchItem(item.id)}
                          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[#8E8E98] hover:bg-white/[0.10] hover:text-white"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="space-y-4 px-3 py-6 text-center">
                  <p className="text-xs text-[#8E8E98]">
                    Busca canciones, artistas o álbumes al instante
                  </p>
                  <div className="flex flex-wrap items-center justify-center gap-1.5">
                    {seedArtists.slice(0, 6).map((seed) => (
                      <button
                        key={seed.artistKey}
                        type="button"
                        onClick={() => void setSearchQuery(seed.displayName, true)}
                        className="rounded-full border border-white/[0.08] bg-[#1A1A22] px-3 py-1 text-xs font-medium text-[#E5E5EA] hover:bg-white hover:text-[#070709]"
                      >
                        {seed.displayName}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3 p-1">
              {bestResult && (
                <div>
                  <div className="px-2.5 pb-1 text-[11px] font-semibold tracking-wide text-[#8E8E98]">
                    MEJOR RESULTADO
                  </div>
                  {bestResult.kind === 'artist' ? (
                    <div
                      data-testid="best-result-card"
                      data-surface="content"
                      className="flex items-center justify-between gap-3 rounded-[12px] border border-white/[0.08] bg-[#1A1A22] px-3 py-2.5"
                    >
                      <button
                        type="button"
                        onClick={() => {
                          addRecentSearchArtist({
                            id: bestResult.item.id,
                            name: bestResult.item.name,
                            thumbnailUrl: bestResult.item.thumbnailUrl,
                          });
                          setSpotlightOpen(false);
                          void openArtistDetail(bestResult.item.id);
                        }}
                        className="flex min-w-0 flex-1 items-center gap-3 text-left"
                      >
                        <img
                          src={bestResult.item.thumbnailUrl}
                          alt={bestResult.item.name}
                          className="h-11 w-11 shrink-0 rounded-full object-cover"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[14px] font-bold text-[#F5F5F7]">
                            {bestResult.item.name}
                          </div>
                          <div className="flex items-center gap-1 text-xs text-[#B4B4BE]">
                            <User className="h-3 w-3" />
                            <span>Artista</span>
                          </div>
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const song =
                            searchResults.songs.find((s) =>
                              s.artists.some((a) => a.name === bestResult.item.name)
                            ) ?? searchResults.songs[0];
                          if (song) {
                            addRecentSearchTrack(song);
                            setSpotlightOpen(false);
                            void playTrack(song, searchResults.songs);
                          }
                        }}
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-[#070709] hover:scale-105"
                        aria-label={`Reproducir ${bestResult.item.name}`}
                      >
                        <Play className="h-4 w-4 translate-x-[1px] fill-current" />
                      </button>
                    </div>
                  ) : (
                    bestResult.kind === 'song' && (
                      <div
                        data-testid="best-result-card"
                        data-surface="content"
                        className="flex items-center justify-between gap-3 rounded-[12px] border border-white/[0.08] bg-[#1A1A22] px-3 py-2.5"
                      >
                        <button
                          type="button"
                          onClick={() => {
                            addRecentSearchTrack(bestResult.item);
                            setSpotlightOpen(false);
                            void playTrack(bestResult.item, searchResults.songs);
                          }}
                          className="flex min-w-0 flex-1 items-center gap-3 text-left"
                        >
                          <img
                            src={bestResult.item.thumbnailUrl}
                            alt={bestResult.item.title}
                            className="h-11 w-11 shrink-0 rounded-[8px] object-cover"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[14px] font-bold text-[#F5F5F7]">
                              {bestResult.item.title}
                            </div>
                            <div className="truncate text-xs text-[#B4B4BE]">
                              Canción ·{' '}
                              {bestResult.item.artists.map((a) => a.name).join(', ')}
                            </div>
                          </div>
                        </button>
                        <button
                          type="button"
                          aria-label={`Reproducir ${bestResult.item.title}`}
                          onClick={() => {
                            addRecentSearchTrack(bestResult.item);
                            setSpotlightOpen(false);
                            void playTrack(bestResult.item, searchResults.songs);
                          }}
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-[#070709] hover:scale-105"
                        >
                          <Play className="h-4 w-4 translate-x-[1px] fill-current" />
                        </button>
                      </div>
                    )
                  )}
                </div>
              )}

              {searchResults.songs.length > 0 && (
                <div>
                  <div className="px-2.5 pb-1 text-[11px] font-semibold tracking-wide text-[#8E8E98]">
                    CANCIONES
                  </div>
                  <div role="list" className="space-y-0.5">
                    {searchResults.songs.slice(0, 6).map((t) => (
                      <div
                        key={t.id}
                        role="listitem"
                        className="group flex h-14 items-center gap-2 rounded-[10px] px-2 transition-colors hover:bg-white/[0.07]"
                      >
                        <button
                          type="button"
                          onClick={() => {
                            addRecentSearchTrack(t);
                            setSpotlightOpen(false);
                            void playTrack(t, searchResults.songs);
                          }}
                          className="flex min-w-0 flex-1 items-center gap-3 text-left"
                        >
                          <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-[7px] bg-[#1C1C24]">
                            <img
                              src={t.thumbnailUrl}
                              alt={t.title}
                              className="h-full w-full object-cover"
                            />
                            <span className="absolute inset-0 flex items-center justify-center bg-black/45 opacity-0 transition-opacity group-hover:opacity-100">
                              <Play className="h-3.5 w-3.5 translate-x-[1px] fill-current text-white" />
                            </span>
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[14px] font-semibold text-[#F5F5F7]">
                              {t.title}
                            </div>
                            <div className="flex items-center gap-1.5 truncate text-xs text-[#8E8E98]">
                              {t.isExplicit && (
                                <span
                                  aria-label="Explícita"
                                  className="inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-[3px] bg-white/[0.16] px-1 text-[11px] font-bold leading-none text-[#F5F5F7]"
                                >
                                  E
                                </span>
                              )}
                              <span className="truncate">
                                {t.artists.map((a) => a.name).join(', ')}
                              </span>
                            </div>
                          </div>
                        </button>
                        <span className="tabular-nums hidden pr-1 text-xs text-[#8E8E98] sm:inline">
                          {formatDurationSec(t.durationSec)}
                        </span>
                        <button
                          type="button"
                          aria-label={`Más opciones para ${t.title}`}
                          onClick={(e) => {
                            const r = e.currentTarget.getBoundingClientRect();
                            openTrackMenu(t, r.left - 210, r.bottom + 6);
                          }}
                          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[#8E8E98] hover:bg-white/[0.10] hover:text-white"
                        >
                          <MoreVertical className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {searchResults.artists.length > 0 && (
                <div>
                  <div className="px-2.5 pb-1 text-[11px] font-semibold tracking-wide text-[#8E8E98]">
                    ARTISTAS
                  </div>
                  <div role="list" className="space-y-0.5">
                    {searchResults.artists.slice(0, 3).map((ar) => (
                      <button
                        key={ar.id}
                        type="button"
                        onClick={() => {
                          addRecentSearchArtist({
                            id: ar.id,
                            name: ar.name,
                            thumbnailUrl: ar.thumbnailUrl,
                          });
                          setSpotlightOpen(false);
                          void openArtistDetail(ar.id);
                        }}
                        className="flex h-13 w-full items-center gap-3 rounded-[10px] px-2 text-left transition-colors hover:bg-white/[0.07]"
                      >
                        <img
                          src={ar.thumbnailUrl}
                          alt={ar.name}
                          className="h-9 w-9 shrink-0 rounded-full object-cover"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[13.5px] font-semibold text-[#F5F5F7]">
                            {ar.name}
                          </div>
                          <div className="truncate text-xs text-[#8E8E98]">
                            Artistas
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <button
                type="button"
                onClick={() => {
                  void submitSearch(searchQuery);
                  setSpotlightOpen(false);
                  setActiveTab('Buscar');
                }}
                className="flex w-full items-center justify-center gap-2 rounded-[10px] border border-white/[0.08] bg-[#1A1A22] py-2.5 text-xs font-semibold text-[#F5F5F7] hover:bg-white hover:text-[#070709]"
              >
                <Disc3 className="h-3.5 w-3.5" />
                <span>Ver todos los resultados para «{trimmedQuery}»</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
