import React, { useEffect, useRef } from 'react';
import {
  Compass,
  Disc3,
  Loader2,
  MoreVertical,
  Play,
  Search,
  User,
  X,
} from 'lucide-react';
import { formatDurationSec } from '@pmusic/core';
import { useShallow } from 'zustand/react/shallow';
import { usePMusicStore } from '../store/usePMusicStore.ts';
import { buildSearchHomeRecommendations } from '../utils/instant-search.ts';
import { useRotatingSearchPlaceholder } from '../utils/search-placeholders.ts';
import { ArtistLinks } from './ArtistLinks.tsx';

export const SpotlightSearchModal: React.FC = React.memo(() => {
  const spotlightOpen = usePMusicStore((s) => s.spotlightOpen);
  if (!spotlightOpen) return null;
  return <SpotlightSearchModalInner />;
});
SpotlightSearchModal.displayName = 'SpotlightSearchModal';

const SpotlightSearchModalInner: React.FC = () => {
  const {
    spotlightOpen,
    setSpotlightOpen,
    searchQuery,
    isSearching,
    searchResults,
    bestResult,
    autocompleteSuggestions,
    recentSearches,
    recentSearchItems,
    seedArtists,
    likedTracks,
    playHistory,
    playlists,
    favoriteArtists,
    homeShelves,
    affinityProfile,
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
  } = usePMusicStore(
    useShallow((s) => ({
      spotlightOpen: s.spotlightOpen,
      setSpotlightOpen: s.setSpotlightOpen,
      searchQuery: s.searchQuery,
      isSearching: s.isSearching,
      searchResults: s.searchResults,
      bestResult: s.bestResult,
      autocompleteSuggestions: s.autocompleteSuggestions,
      recentSearches: s.recentSearches,
      recentSearchItems: s.recentSearchItems,
      seedArtists: s.seedArtists,
      likedTracks: s.likedTracks,
      playHistory: s.playHistory,
      playlists: s.playlists,
      favoriteArtists: s.favoriteArtists,
      homeShelves: s.homeShelves,
      affinityProfile: s.affinityProfile,
      setSearchQuery: s.setSearchQuery,
      submitSearch: s.submitSearch,
      setActiveTab: s.setActiveTab,
      playTrack: s.playTrack,
      openArtistDetail: s.openArtistDetail,
      openTrackMenu: s.openTrackMenu,
      addRecentSearchTrack: s.addRecentSearchTrack,
      addRecentSearchArtist: s.addRecentSearchArtist,
      removeRecentSearchItem: s.removeRecentSearchItem,
      clearRecentSearchItems: s.clearRecentSearchItems,
    }))
  );

  const likedTrackIdSet = new Set(likedTracks.map((l) => l.trackId));
  const recentTrackIdSet = new Set(
    recentSearchItems
      .filter((i): i is typeof i & { kind: 'track' } => i.kind === 'track')
      .map((i) => i.track.id)
  );
  const { recommendedTracks, recommendedArtists } = buildSearchHomeRecommendations({
    likedTracks,
    playHistory,
    playlists,
    recentSearchItems,
    recentSearches,
    favoriteArtists,
    homeShelves,
    affinityProfile,
  });

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

  const sbSearchPlaceholder = useRotatingSearchPlaceholder({ paused: Boolean(searchQuery) });

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
          className="pm-input flex items-center gap-3 rounded-[14px] px-4 py-2.5 shadow-[0_24px_64px_rgba(0,0,0,0.45)] focus-within:border-[var(--pm-border-strong)]"
        >
          <Search className="h-4 w-4 shrink-0 pm-text-tertiary" />
          <input
            ref={inputRef}
            type="search"
            role="searchbox"
            aria-label="Buscar canciones, artistas o álbumes"
            placeholder={sbSearchPlaceholder}
            value={searchQuery}
            onChange={(e) => void setSearchQuery(e.target.value)}
            className="pm-input-frameless flex-1 bg-transparent text-[14px] font-medium pm-text-primary placeholder:text-[var(--pm-text-tertiary)] focus:outline-none"
          />
          {isSearching && (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin pm-text-secondary" />
          )}
          {hasQuery && (
            <button
              type="button"
              aria-label="Limpiar búsqueda"
              onClick={() => {
                void setSearchQuery('', true);
                inputRef.current?.focus();
              }}
              className="pm-text-tertiary pm-hover flex h-7 w-7 items-center justify-center rounded-full"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </form>

        {/* Floating Dropdown Card */}
        <div
          data-testid="spotlight-search-panel"
          className="pm-glass-regular mt-2 max-h-[68vh] overflow-y-auto rounded-[16px] p-2 shadow-[0_32px_84px_rgba(0,0,0,0.55)] pm-no-scrollbar"
        >
          {!hasQuery ? (
            <div>
              <div className="flex items-center justify-between px-3 py-2">
                <span className="text-xs font-medium pm-text-tertiary">
                  Búsquedas recientes
                </span>
                {recentSearchItems.length > 0 && (
                  <button
                    type="button"
                    onClick={() => clearRecentSearchItems()}
                    className="pm-text-secondary pm-hover rounded-md px-2 py-1 text-xs font-medium"
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
                          className="pm-hover group flex h-14 items-center gap-2 rounded-[10px] px-2 transition-colors"
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
                              <div className="truncate text-[14px] font-semibold pm-text-primary">
                                {item.name}
                              </div>
                              <div className="truncate text-xs pm-text-tertiary">
                                Artistas
                              </div>
                            </div>
                          </button>

                          <button
                            type="button"
                            aria-label={`Quitar ${item.name} de recientes`}
                            onClick={() => removeRecentSearchItem(item.id)}
                            className="pm-text-tertiary pm-hover flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      );
                    }

                    const t = item.track;
                    return (
                      <div
                        key={item.id}
                        role="listitem"
                        className="pm-hover group flex h-14 items-center gap-2 rounded-[10px] px-2 transition-colors"
                      >
                        <button
                          type="button"
                          aria-label={`Reproducir ${t.title}`}
                          onClick={() => {
                            addRecentSearchTrack(t);
                            setSpotlightOpen(false);
                            void playTrack(t);
                          }}
                          className="relative h-10 w-10 shrink-0 overflow-hidden rounded-[7px]"
                        >
                          <img
                            src={t.thumbnailUrl}
                            alt={t.title}
                            className="h-full w-full object-cover"
                          />
                          <span className="absolute inset-0 flex items-center justify-center bg-black/45 opacity-0 transition-opacity group-hover:opacity-100">
                            <Play className="h-3.5 w-3.5 translate-x-[1px] fill-current text-white" />
                          </span>
                        </button>

                        <div className="min-w-0 flex-1">
                          <button
                            type="button"
                            onClick={() => {
                              addRecentSearchTrack(t);
                              setSpotlightOpen(false);
                              void playTrack(t);
                            }}
                            className="block max-w-full truncate text-left text-[14px] font-semibold pm-text-primary hover:underline"
                          >
                            {t.title}
                          </button>
                          <div className="flex items-center gap-1.5 truncate text-xs pm-text-tertiary">
                            {t.isExplicit && (
                              <span
                                aria-label="Explícita"
                                className="inline-flex h-[14px] w-[14px] shrink-0 items-center justify-center rounded-[3px] bg-[var(--pm-text-secondary)]/20 text-[9px] font-extrabold leading-none pm-text-secondary"
                              >
                                E
                              </span>
                            )}
                            <ArtistLinks
                              artists={t.artists}
                              disableOnMobile
                              onBeforeNavigate={() => setSpotlightOpen(false)}
                            />
                          </div>
                        </div>

                        <span className="tabular-nums hidden pr-1 text-xs pm-text-tertiary sm:inline">
                          {formatDurationSec(t.durationSec)}
                        </span>

                        <button
                          type="button"
                          aria-label={`Más opciones para ${t.title}`}
                          onClick={(e) => {
                            const r = e.currentTarget.getBoundingClientRect();
                            openTrackMenu(t, r.left - 210, r.bottom + 6);
                          }}
                          className="pm-text-tertiary pm-hover flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
                        >
                          <MoreVertical className="h-3.5 w-3.5" />
                        </button>

                        <button
                          type="button"
                          aria-label={`Quitar ${t.title} de recientes`}
                          onClick={() => removeRecentSearchItem(item.id)}
                          className="pm-text-tertiary pm-hover flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="space-y-4 px-3 py-5 text-center">
                  <p className="text-xs pm-text-tertiary">
                    Busca canciones, artistas o álbumes al instante
                  </p>
                  {recentSearches.length > 0 && (
                    <div className="flex flex-wrap items-center justify-center gap-1.5">
                      {recentSearches.slice(0, 6).map((rec) => (
                        <button
                          key={rec}
                          type="button"
                          onClick={() => void setSearchQuery(rec, true)}
                          className="pm-elevated rounded-full border pm-border px-3 py-1 text-xs font-medium pm-text-secondary hover:pm-text-primary"
                        >
                          {rec}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="flex flex-wrap items-center justify-center gap-1.5">
                    {seedArtists.slice(0, 6).map((seed) => (
                      <button
                        key={seed.artistKey}
                        type="button"
                        onClick={() => void setSearchQuery(seed.displayName, true)}
                        className="pm-btn-secondary rounded-full px-3 py-1 text-xs font-medium"
                      >
                        {seed.displayName}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {(recommendedArtists.length > 0 || recommendedTracks.length > 0) && (
                <div
                  data-testid="spotlight-recommended-section"
                  className="mt-2 border-t pm-border pt-2.5"
                >
                  <div className="flex items-center gap-1.5 px-3 pb-2 text-xs font-medium pm-text-tertiary">
                    <Compass className="h-3.5 w-3.5 text-white/75" />
                    <span>Recomendado para ti</span>
                  </div>

                  {recommendedArtists.length > 0 && (
                    <div className="flex flex-nowrap gap-1.5 overflow-x-auto px-2 pb-2 pm-no-scrollbar">
                      {recommendedArtists.slice(0, 6).map((ar) => (
                        <button
                          key={`rec-ar-${ar.id}-${ar.name}`}
                          type="button"
                          onClick={() => {
                            addRecentSearchArtist({
                              id: ar.id,
                              name: ar.name,
                              thumbnailUrl: ar.thumbnailUrl,
                            });
                            setSpotlightOpen(false);
                            void openArtistDetail(ar.id, {
                              name: ar.name,
                              thumbnailUrl: ar.thumbnailUrl,
                            });
                          }}
                          className="pm-elevated pm-hover inline-flex shrink-0 items-center gap-2 rounded-full border pm-border py-1 pl-1 pr-3 text-xs font-semibold pm-text-primary"
                        >
                          {ar.thumbnailUrl ? (
                            <img
                              src={ar.thumbnailUrl}
                              alt={ar.name}
                              className="h-6 w-6 rounded-full object-cover"
                            />
                          ) : (
                            <User className="ml-1 h-4 w-4 pm-text-tertiary" />
                          )}
                          <span className="max-w-[110px] truncate">{ar.name}</span>
                        </button>
                      ))}
                    </div>
                  )}

                  {recommendedTracks.length > 0 && (
                    <div role="list" className="space-y-0.5">
                      {recommendedTracks.slice(0, 5).map((t) => (
                        <div
                          key={`rec-tr-${t.id}`}
                          role="listitem"
                          className="pm-hover group flex h-13 items-center gap-2 rounded-[10px] px-2 transition-colors"
                        >
                          <button
                            type="button"
                            aria-label={`Reproducir ${t.title}`}
                            onClick={() => {
                              addRecentSearchTrack(t);
                              setSpotlightOpen(false);
                              void playTrack(t, recommendedTracks);
                            }}
                            className="relative h-9 w-9 shrink-0 overflow-hidden rounded-[7px]"
                          >
                            <img
                              src={t.thumbnailUrl}
                              alt={t.title}
                              className="h-full w-full object-cover"
                            />
                            <span className="absolute inset-0 flex items-center justify-center bg-black/45 opacity-0 transition-opacity group-hover:opacity-100">
                              <Play className="h-3.5 w-3.5 translate-x-[1px] fill-current text-white" />
                            </span>
                          </button>
                          <div className="min-w-0 flex-1">
                            <button
                              type="button"
                              onClick={() => {
                                addRecentSearchTrack(t);
                                setSpotlightOpen(false);
                                void playTrack(t, recommendedTracks);
                              }}
                              className="block max-w-full truncate text-left text-[13.5px] font-semibold pm-text-primary hover:underline"
                            >
                              {t.title}
                            </button>
                            <div className="truncate text-xs pm-text-tertiary">
                              <ArtistLinks
                                artists={t.artists}
                                disableOnMobile
                                onBeforeNavigate={() => setSpotlightOpen(false)}
                              />
                            </div>
                          </div>
                          <span className="tabular-nums hidden pr-1 text-xs pm-text-tertiary sm:inline">
                            {formatDurationSec(t.durationSec)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3 p-1">
              {autocompleteSuggestions.length > 0 && (
                <div
                  data-testid="spotlight-autocomplete-chips"
                  className="flex flex-nowrap items-center gap-1.5 overflow-x-auto px-1 pt-0.5 pm-no-scrollbar"
                >
                  {autocompleteSuggestions.slice(0, 5).map((sug) => (
                    <button
                      key={`sp-sug-${sug.text}`}
                      type="button"
                      onClick={() => void submitSearch(sug.text)}
                      className="pm-btn-secondary shrink-0 rounded-full px-3 py-1 text-[11px] font-medium"
                    >
                      {sug.text}
                    </button>
                  ))}
                </div>
              )}
              {bestResult && (
                <div>
                  <div className="px-2.5 pb-1 text-[11px] font-semibold tracking-wide pm-text-tertiary">
                    MEJOR RESULTADO
                  </div>
                  {bestResult.kind === 'artist' ? (
                    <div
                      data-testid="best-result-card"
                      data-surface="content"
                      className="pm-elevated pm-border flex items-center justify-between gap-3 rounded-[12px] border px-3 py-2.5"
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
                          <div className="truncate text-[14px] font-bold pm-text-primary">
                            {bestResult.item.name}
                          </div>
                          <div className="flex items-center gap-1 text-xs pm-text-secondary">
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
                            void playTrack(song, [song]);
                          }
                        }}
                        className="pm-btn-primary flex h-9 w-9 shrink-0 items-center justify-center rounded-full hover:scale-105"
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
                        className="pm-elevated pm-border flex items-center justify-between gap-3 rounded-[12px] border px-3 py-2.5"
                      >
                        <div className="flex min-w-0 flex-1 items-center gap-3">
                          <button
                            type="button"
                            onClick={() => {
                              addRecentSearchTrack(bestResult.item);
                              setSpotlightOpen(false);
                              void playTrack(bestResult.item, [bestResult.item]);
                            }}
                            className="shrink-0"
                          >
                            <img
                              src={bestResult.item.thumbnailUrl}
                              alt={bestResult.item.title}
                              className="h-11 w-11 rounded-[8px] object-cover"
                            />
                          </button>
                          <div className="min-w-0 flex-1">
                            <button
                              type="button"
                              onClick={() => {
                                addRecentSearchTrack(bestResult.item);
                                setSpotlightOpen(false);
                                void playTrack(bestResult.item, [bestResult.item]);
                              }}
                              className="block max-w-full truncate text-left text-[14px] font-bold pm-text-primary hover:underline"
                            >
                              {bestResult.item.title}
                            </button>
                            <div className="truncate text-xs pm-text-secondary">
                              Canción ·{' '}
                              <ArtistLinks
                                artists={bestResult.item.artists}
                                onBeforeNavigate={() => setSpotlightOpen(false)}
                              />
                            </div>
                          </div>
                        </div>
                        <button
                          type="button"
                          aria-label={`Reproducir ${bestResult.item.title}`}
                          onClick={() => {
                            addRecentSearchTrack(bestResult.item);
                            setSpotlightOpen(false);
                            void playTrack(bestResult.item, [bestResult.item]);
                          }}
                          className="pm-btn-primary flex h-9 w-9 shrink-0 items-center justify-center rounded-full hover:scale-105"
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
                  <div className="px-2.5 pb-1 text-[11px] font-semibold tracking-wide pm-text-tertiary">
                    CANCIONES
                  </div>
                  <div role="list" className="space-y-0.5">
                    {searchResults.songs.slice(0, 6).map((t) => (
                      <div
                        key={t.id}
                        role="listitem"
                        className="pm-hover group flex h-14 items-center gap-2 rounded-[10px] px-2 transition-colors"
                      >
                        <button
                          type="button"
                          aria-label={`Reproducir ${t.title}`}
                          onClick={() => {
                            addRecentSearchTrack(t);
                            setSpotlightOpen(false);
                            void playTrack(t, [t]);
                          }}
                          className="relative h-10 w-10 shrink-0 overflow-hidden rounded-[7px]"
                        >
                          <img
                            src={t.thumbnailUrl}
                            alt={t.title}
                            className="h-full w-full object-cover"
                          />
                          <span className="absolute inset-0 flex items-center justify-center bg-black/45 opacity-0 transition-opacity group-hover:opacity-100">
                            <Play className="h-3.5 w-3.5 translate-x-[1px] fill-current text-white" />
                          </span>
                        </button>

                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => {
                                addRecentSearchTrack(t);
                                setSpotlightOpen(false);
                                void playTrack(t, [t]);
                              }}
                              className="block max-w-full truncate text-left text-[14px] font-semibold pm-text-primary hover:underline"
                            >
                              {t.title}
                            </button>
                            {likedTrackIdSet.has(t.id) ? (
                              <span className="shrink-0 rounded-full bg-white/[0.08] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider pm-text-secondary">
                                Me gusta
                              </span>
                            ) : recentTrackIdSet.has(t.id) ? (
                              <span className="shrink-0 rounded-full bg-white/[0.06] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider pm-text-tertiary">
                                Buscado
                              </span>
                            ) : null}
                          </div>
                          <div className="flex items-center gap-1.5 truncate text-xs pm-text-tertiary">
                            {t.isExplicit && (
                              <span
                                aria-label="Explícita"
                                className="inline-flex h-[14px] w-[14px] shrink-0 items-center justify-center rounded-[3px] bg-[var(--pm-text-secondary)]/20 text-[9px] font-extrabold leading-none pm-text-secondary"
                              >
                                E
                              </span>
                            )}
                            <ArtistLinks
                              artists={t.artists}
                              disableOnMobile
                              onBeforeNavigate={() => setSpotlightOpen(false)}
                            />
                          </div>
                        </div>

                        <span className="tabular-nums hidden pr-1 text-xs pm-text-tertiary sm:inline">
                          {formatDurationSec(t.durationSec)}
                        </span>
                        <button
                          type="button"
                          aria-label={`Más opciones para ${t.title}`}
                          onClick={(e) => {
                            const r = e.currentTarget.getBoundingClientRect();
                            openTrackMenu(t, r.left - 210, r.bottom + 6);
                          }}
                          className="pm-text-tertiary pm-hover flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
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
                  <div className="px-2.5 pb-1 text-[11px] font-semibold tracking-wide pm-text-tertiary">
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
                        className="pm-hover flex h-13 w-full items-center gap-3 rounded-[10px] px-2 text-left transition-colors"
                      >
                        <img
                          src={ar.thumbnailUrl}
                          alt={ar.name}
                          className="h-9 w-9 shrink-0 rounded-full object-cover"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[13.5px] font-semibold pm-text-primary">
                            {ar.name}
                          </div>
                          <div className="truncate text-xs pm-text-tertiary">
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
                className="pm-btn-secondary flex w-full items-center justify-center gap-2 rounded-[10px] py-2.5 text-xs font-semibold"
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
