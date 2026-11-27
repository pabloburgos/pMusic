// @vitest-environment jsdom
import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { AlbumSummary, ArtistSummary, Track } from '@pmusic/core';
import { DeezerCatalog, filterWaterfallAlbumSingles } from '@pmusic/providers';
import {
  RecommendationEngine,
  computeBoundedEditDistance,
} from '@pmusic/recommendations';
import { App } from '../App.tsx';
import {
  DetailViewPanel,
  PlaylistSortControl,
  SearchScreen,
  TrackListRow,
  formatSpanishReleaseDate,
} from '../components/Screens.tsx';
import { SpotlightSearchModal } from '../components/SpotlightSearchModal.tsx';
import { TelegramIcon, WhatsAppIcon } from '../components/SocialBrandIcons.tsx';
import {
  buildInstantLocalSearchBundle,
  buildPersonalSearchSignals,
  buildSearchHomeRecommendations,
} from '../utils/instant-search.ts';
import { usePMusicStore } from '../store/usePMusicStore.ts';

function makeTrack(n: number, overrides: Partial<Track> = {}): Track {
  return {
    id: `tr-${n}`,
    title: `Song ${n}`,
    artists: [{ id: `ar-${n}`, name: `Artist ${n}` }],
    album: { id: `alb-${n}`, name: `Album ${n}` },
    durationSec: 180 + n,
    thumbnailUrl: `https://example.com/${n}.jpg`,
    source: 'ytmusic',
    ...overrides,
  };
}

describe('pMusic v0.24.3 fixes & UX polish', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('uses official WhatsApp & Telegram brand SVGs across Jam share surfaces', () => {
    const { container: waBox } = render(<WhatsAppIcon />);
    const { container: tgBox } = render(<TelegramIcon />);
    expect(waBox.querySelector('svg[data-brand="whatsapp"]')).toBeTruthy();
    expect(tgBox.querySelector('svg[data-brand="telegram"]')).toBeTruthy();

    const queuePanelSrc = readFileSync(
      resolve(__dirname, '../components/NowPlayingQueuePanel.tsx'),
      'utf-8'
    );
    const overlaysSrc = readFileSync(
      resolve(__dirname, '../components/Overlays.tsx'),
      'utf-8'
    );
    const socialSrc = readFileSync(
      resolve(__dirname, '../components/SocialScreen.tsx'),
      'utf-8'
    );
    expect(queuePanelSrc).toContain('WhatsAppIcon');
    expect(queuePanelSrc).toContain('TelegramIcon');
    expect(queuePanelSrc).toContain('queue-jam-whatsapp-btn');
    expect(queuePanelSrc).toContain('queue-jam-telegram-btn');
    expect(overlaysSrc).toContain('WhatsAppIcon');
    expect(overlaysSrc).toContain('TelegramIcon');
    expect(socialSrc).toContain('WhatsAppIcon');
    expect(socialSrc).toContain('TelegramIcon');
  });

  it('defaults Discord Rich Presence statusDisplayType to song title and migrates legacy non-custom app pref', () => {
    const storeSrc = readFileSync(
      resolve(__dirname, '../store/usePMusicStore.ts'),
      'utf-8'
    );
    const mainSrc = readFileSync(
      resolve(__dirname, '../../../desktop/src/main.ts'),
      'utf-8'
    );
    const electronBuildSrc = readFileSync(
      resolve(__dirname, '../../../desktop/scripts/build-electron.mjs'),
      'utf-8'
    );

    expect(storeSrc).toContain("displayMode: 'song'");
    expect(storeSrc).toContain('displayModeUserSet: true');
    expect(mainSrc).toContain("state.displayMode === 'app' ? 0 : state.displayMode === 'artist' ? 1 : 2");
    expect(electronBuildSrc).toContain("state.displayMode === 'app' ? 0 : state.displayMode === 'artist' ? 1 : 2");
  });

  it('centers the desktop top search bar in the window and removes fullscreen button from main header only', () => {
    render(<App />);
    const searchBtn = screen.getByTestId('top-center-search-btn');
    const centerWrapper = searchBtn.parentElement as HTMLElement;
    expect(centerWrapper.className).toContain('left-1/2');
    expect(centerWrapper.className).toContain('-translate-x-1/2');
    expect(screen.queryByTestId('desktop-fullscreen-btn')).toBeNull();

    const overlaysSrc = readFileSync(
      resolve(__dirname, '../components/Overlays.tsx'),
      'utf-8'
    );
    expect(overlaysSrc).toContain('data-testid="toggle-real-fullscreen-btn"');
  });

  it('filters waterfall album-track singles sharing album cover hash within 21 days while keeping standalone singles', () => {
    const album: AlbumSummary = {
      id: 'dz_alb_1',
      title: 'LOCKED IN',
      artists: [{ id: 'dz_ar_nemzzz', name: 'Nemzzz' }],
      thumbnailUrl: 'https://e-cdns-images.dzcdn.net/images/cover/abc1234567890abcdef1234567890ab/500x500-000000-80-0-0.jpg',
      year: 2026,
      releaseDate: '2026-10-16',
    };
    const singles: AlbumSummary[] = [
      {
        id: 'dz_sg_money',
        title: 'MONEY (feat. Artie 5ive)',
        artists: [{ id: 'dz_ar_nemzzz', name: 'Nemzzz' }],
        thumbnailUrl: 'https://e-cdns-images.dzcdn.net/images/cover/abc1234567890abcdef1234567890ab/500x500-000000-80-0-0.jpg',
        year: 2026,
        releaseDate: '2026-10-16',
      },
      {
        id: 'dz_sg_old_single',
        title: 'EARLIER STANDALONE',
        artists: [{ id: 'dz_ar_nemzzz', name: 'Nemzzz' }],
        thumbnailUrl: 'https://e-cdns-images.dzcdn.net/images/cover/fedcba9876543210fedcba9876543210/500x500-000000-80-0-0.jpg',
        year: 2026,
        releaseDate: '2026-08-01',
      },
      {
        id: 'dz_sg_old_same_art',
        title: 'OLD REMIX SAME ART',
        artists: [{ id: 'dz_ar_nemzzz', name: 'Nemzzz' }],
        thumbnailUrl: 'https://e-cdns-images.dzcdn.net/images/cover/abc1234567890abcdef1234567890ab/500x500-000000-80-0-0.jpg',
        year: 2026,
        releaseDate: '2026-06-01',
      },
    ];

    const filtered = filterWaterfallAlbumSingles([album], singles);
    expect(filtered.map((s) => s.id)).toEqual(['dz_sg_old_single', 'dz_sg_old_same_art']);
  });

  it('formats Spanish release dates, removes Colaboración · feat. badge, and enables desktop Discografía arrows + Ver todo grid', () => {
    expect(formatSpanishReleaseDate('2026-11-20')).toBe('20 nov 2026');
    expect(formatSpanishReleaseDate(undefined, 2025)).toBe('2025');

    const sharedHash = '11223344556677889900aabbccddeeff';
    const album: AlbumSummary = {
      id: 'dz_alb_main',
      title: 'LOCKED IN',
      artists: [{ id: 'ar-nemzzz', name: 'Nemzzz' }],
      thumbnailUrl: `https://e-cdns-images.dzcdn.net/images/cover/${sharedHash}/500x500-000000-80-0-0.jpg`,
      year: 2026,
      releaseDate: '2026-10-16',
    };
    const waterfallSingle: AlbumSummary = {
      id: 'dz_sg_wf',
      title: 'MONEY (feat. Artie 5ive)',
      artists: [{ id: 'ar-nemzzz', name: 'Nemzzz' }],
      thumbnailUrl: `https://e-cdns-images.dzcdn.net/images/cover/${sharedHash}/500x500-000000-80-0-0.jpg`,
      year: 2026,
      releaseDate: '2026-10-16',
    };
    const realSingles: AlbumSummary[] = [1, 2, 3, 4].map((i) => ({
      id: `dz_sg_real_${i}`,
      title: `Single ${i}`,
      artists: [{ id: 'ar-nemzzz', name: 'Nemzzz' }],
      thumbnailUrl: `https://example.com/sg-${i}.jpg`,
      year: 2025,
      releaseDate: `2025-0${i}-10`,
    }));

    act(() => {
      usePMusicStore.setState({
        activeDetailView: {
          kind: 'artist',
          data: {
            artist: { id: 'ar-nemzzz', name: 'Nemzzz', thumbnailUrl: 'https://example.com/n.jpg' },
            topSongs: [makeTrack(1, { artists: [{ id: 'ar-nemzzz', name: 'Nemzzz' }] })],
            appearances: [
              makeTrack(99, {
                title: 'DÓNDE ESTÁS?',
                artists: [
                  { id: 'ar-yapi', name: 'Yapi' },
                  { id: 'ar-lucho', name: 'Lucho RK' },
                ],
                releaseDate: '2026-11-20',
                releaseYear: 2026,
              }),
            ],
            albums: [album],
            singles: [waterfallSingle, ...realSingles],
            relatedArtists: [],
          },
        },
      });
    });

    render(<DetailViewPanel />);

    const appCard = screen.getByTestId('artist-latest-appearance-card');
    expect(appCard.textContent).toContain('20 nov 2026');
    expect(appCard.textContent).not.toMatch(/Colaboración · feat\./i);

    // Waterfall single was filtered out of Discografía
    expect(screen.queryByText('MONEY (feat. Artie 5ive)')).toBeNull();
    expect(screen.getAllByText('LOCKED IN').length).toBeGreaterThanOrEqual(1);

    // Desktop scroll controls present + Ver todo expands into full grid
    const rightBtn = screen.getByTestId('artist-disco-scroll-right');
    const leftBtn = screen.getByTestId('artist-disco-scroll-left');
    expect(leftBtn).toBeTruthy();
    expect(rightBtn).toBeTruthy();

    const expandBtn = screen.getByTestId('artist-disco-expand-btn');
    expect(expandBtn.textContent).toBe('Ver todo');
    fireEvent.click(expandBtn);
    const fullGrid = screen.getByTestId('artist-disco-full-grid');
    expect(fullGrid).toBeTruthy();
    expect(fullGrid.textContent).toContain('LOCKED IN');
    expect(fullGrid.textContent).toContain('Single 4');
    expect(screen.getByTestId('artist-disco-expand-btn').textContent).toBe('Carrusel');
  });

  it('removes contentVisibility skip on TrackListRow and renders custom desktop + mobile sort controls', () => {
    const tr = makeTrack(77);
    const { container } = render(<TrackListRow track={tr} index={0} />);
    const row = container.querySelector('[role="row"]') as HTMLElement;
    expect(row).toBeTruthy();
    expect(row.style.contentVisibility).toBe('');
    const rowImg = row.querySelector('img') as HTMLImageElement | null;
    expect(rowImg?.getAttribute('loading')).toBe('eager');

    const onChange = vi.fn();
    render(<PlaylistSortControl mode="custom" onChange={onChange} />);

    // No native <select> elements
    expect(document.querySelector('select[data-testid="playlist-sort-select"]')).toBeNull();

    // Desktop custom popover opens on click and updates sort mode
    const desktopTrigger = screen.getByTestId('playlist-sort-select');
    fireEvent.click(desktopTrigger);
    const menu = screen.getByTestId('playlist-sort-menu');
    expect(menu).toBeTruthy();
    fireEvent.click(screen.getByTestId('playlist-sort-option-duration'));
    expect(onChange).toHaveBeenCalledWith('duration');

    // Mobile compact single icon button cycles sort mode and shows bottom toast confirmation
    const mobileBtn = screen.getByTestId('playlist-sort-mobile-btn');
    expect(mobileBtn).toBeTruthy();
    expect(mobileBtn.textContent).toBe('');
    fireEvent.click(mobileBtn);
    expect(onChange).toHaveBeenCalledWith('recent');
    expect(usePMusicStore.getState().toastMessage).toContain('Más recientes');

    // Full-bleed hero views (playlist, album, artist) exclude opaque status-bar shield & start header at top-0
    const appSrc = readFileSync(resolve(__dirname, '../App.tsx'), 'utf-8');
    expect(appSrc).toContain("activeDetailView.kind === 'album'");
    expect(appSrc).toContain('{isMobileViewport && !nowPlayingOpen && !isFullBleedHeroView && (');
    expect(appSrc).toContain('fixed inset-x-0 top-0 z-40');
  });

  it('wires Android v0.24.3+ daily release JobService and direct tap-to-play song deep link', () => {
    const buildApkSrc = readFileSync(
      resolve(__dirname, '../../../mobile/scripts/build-apk.mjs'),
      'utf-8'
    );
    const bridgeSrc = readFileSync(
      resolve(__dirname, '../platform/web-bridge.ts'),
      'utf-8'
    );
    const storeSrc = readFileSync(
      resolve(__dirname, '../store/usePMusicStore.ts'),
      'utf-8'
    );

    expect(buildApkSrc).toMatch(/android:versionCode="(?:64|65|\d+)"/);
    expect(buildApkSrc).toMatch(/android:versionName="0\.24\.\d+"/);
    expect(buildApkSrc).toContain('PMusicReleaseCheckJobService');
    expect(buildApkSrc).toContain('android.permission.RECEIVE_BOOT_COMPLETED');
    expect(buildApkSrc).toContain('showReleaseNotificationDetailed');
    expect(buildApkSrc).toContain('__pmusicOpenReleaseTrack');
    expect(bridgeSrc).toContain('syncAndroidReleaseArtists');
    expect(storeSrc).toContain('__pmusicOpenReleaseTrack');
    expect(storeSrc).toContain('syncAndroidReleaseArtists');
  });

  it('skips slow per-track HTTP enrichment during DeezerCatalog live search and caches repeat queries', async () => {
    const requestedUrls: string[] = [];
    const mockFetch = (async (url: string | URL | Request) => {
      const u = String(url);
      requestedUrls.push(u);
      if (u.includes('/track/')) {
        throw new Error(`Should not enrich individual /track/:id during live search: ${u}`);
      }
      if (u.includes('/search/artist?')) {
        return new Response(
          JSON.stringify({
            data: [{ id: 101, name: 'Cruzzi', nb_fan: 500000, picture_medium: 'https://example.com/c.jpg' }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      if (u.includes('/search?')) {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: 5001,
                title: 'Me Muevo Con Dios (feat. Cruzzi)',
                duration: 210,
                artist: { id: 101, name: 'Cruzzi' },
                album: { id: 3001, title: 'MMCD', cover_medium: 'https://example.com/m.jpg' },
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    const catalog = new DeezerCatalog(mockFetch);
    const first = await catalog.search('cruzzi', 'all');
    expect(first.songs[0]?.title).toContain('Me Muevo Con Dios');
    expect(requestedUrls.some((u) => u.includes('/track/'))).toBe(false);

    const callsBeforeRepeat = requestedUrls.length;
    const second = await catalog.search('cruzzi', 'all');
    expect(second.songs[0]?.id).toBe(first.songs[0]?.id);
    expect(requestedUrls.length).toBe(callsBeforeRepeat);
  });

  it('supports fuzzy typo tolerance and personal taste prioritization in RecommendationEngine search ranking', () => {
    expect(computeBoundedEditDistance('cruzi', 'cruzzi', 2)).toBe(1);
    expect(computeBoundedEditDistance('palbete', 'pablete', 2)).toBe(1);

    const engine = new RecommendationEngine({
      initialSeeds: [
        { artistKey: 'cruzzi', displayName: 'Cruzzi', priorWeight: 8, genres: ['urbano_es'] },
      ],
    });
    const likedHit = makeTrack(201, {
      id: 'liked-song-1',
      title: 'Tarde en el Barrio',
      artists: [{ id: 'ar-cruzzi', name: 'Cruzzi' }],
    });
    const genericHit = makeTrack(202, {
      id: 'generic-song-2',
      title: 'Tarde en el Barrio',
      artists: [{ id: 'ar-other', name: 'Otro Artista' }],
    });
    const cArtist: ArtistSummary = {
      id: 'ar-cruzzi',
      name: 'Cruzzi',
      thumbnailUrl: 'https://example.com/c.jpg',
      subscribersText: '500.000 fans',
    };
    const otherArtist: ArtistSummary = {
      id: 'ar-other',
      name: 'Other Artist',
      thumbnailUrl: 'https://example.com/o.jpg',
      subscribersText: '500.000 fans',
    };

    const signals = buildPersonalSearchSignals({
      likedTracks: [{ trackId: likedHit.id, track: likedHit }],
      playHistory: [],
      recentSearches: ['cruzi'],
      recentSearchItems: [{ kind: 'track', id: `track:${likedHit.id}`, track: likedHit }],
      favoriteArtists: [
        {
          artistId: 'ar-cruzzi',
          artistName: 'Cruzzi',
          thumbnailUrl: 'https://example.com/c.jpg',
          likedAt: new Date().toISOString(),
        },
      ],
    });

    const typoBundle = engine.rerankSearchBundle(
      'cruzi',
      {
        query: 'cruzi',
        songs: [genericHit, likedHit],
        videos: [],
        artists: [otherArtist, cArtist],
        albums: [],
        playlists: [],
      },
      signals
    );

    expect(typoBundle.artists[0]?.name).toBe('Cruzzi');
    expect(typoBundle.topResult?.kind).toBe('artist');
    if (typoBundle.topResult?.kind === 'artist') {
      expect(typoBundle.topResult.item.name).toBe('Cruzzi');
    }

    const songReranked = engine.rerankSearchBundle(
      'tarde en el barrio',
      {
        query: 'tarde en el barrio',
        songs: [genericHit, likedHit],
        videos: [],
        artists: [],
        albums: [],
        playlists: [],
      },
      signals
    );
    expect(songReranked.songs[0]?.id).toBe(likedHit.id);

    const sugs = engine.rankAutocomplete('cruz', [], signals);
    expect(sugs.some((s) => s.text === 'Cruzzi' && s.kind === 'artist')).toBe(true);
    expect(sugs.some((s) => s.text === 'cruzi' && s.kind === 'history')).toBe(true);
  });

  it('builds 0ms local search results & personalized SearchScreen + Spotlight recommendations', () => {
    const favArtist: ArtistSummary = {
      id: 'ar-quevedo',
      name: 'Quevedo',
      thumbnailUrl: 'https://example.com/q.jpg',
      subscribersText: 'Artista favorito',
    };
    const recTrack = makeTrack(301, {
      id: 'rec-track-301',
      title: 'Columbia',
      artists: [{ id: favArtist.id, name: favArtist.name }],
    });
    const likedTrack = makeTrack(302, {
      id: 'liked-track-302',
      title: 'Buenas Noches',
      artists: [{ id: favArtist.id, name: favArtist.name }],
    });

    const favShelf = {
      id: 'shelf-rec-test',
      kind: 'listen_again' as const,
      title: 'Recomendado para ti',
      tracks: [recTrack],
    };

    const instant = buildInstantLocalSearchBundle('colmbia', {
      likedTracks: [{ trackId: likedTrack.id, track: likedTrack }],
      playHistory: [],
      playlists: [],
      recentSearchItems: [],
      recentSearches: ['quevedo'],
      favoriteArtists: [
        {
          artistId: favArtist.id,
          artistName: favArtist.name,
          thumbnailUrl: favArtist.thumbnailUrl,
          likedAt: new Date().toISOString(),
        },
      ],
      homeShelves: [favShelf],
      affinityProfile: [],
    });
    expect(instant.songs[0]?.id).toBe(recTrack.id);
    expect(instant.topResult?.kind).toBe('song');

    const recs = buildSearchHomeRecommendations({
      likedTracks: [{ trackId: likedTrack.id, track: likedTrack }],
      playHistory: [],
      playlists: [],
      recentSearchItems: [],
      recentSearches: [],
      favoriteArtists: [
        {
          artistId: favArtist.id,
          artistName: favArtist.name,
          thumbnailUrl: favArtist.thumbnailUrl,
          likedAt: new Date().toISOString(),
        },
      ],
      homeShelves: [favShelf],
      affinityProfile: [],
    });
    expect(recs.recommendedTracks.map((t) => t.id)).toContain(recTrack.id);
    expect(recs.recommendedArtists[0]?.name).toBe('Quevedo');

    act(() => {
      usePMusicStore.setState({
        spotlightOpen: false,
        searchQuery: '',
        likedTracks: [{ trackId: likedTrack.id, track: likedTrack, likedAt: new Date().toISOString() }],
        favoriteArtists: [
          {
            artistId: favArtist.id,
            artistName: favArtist.name,
            thumbnailUrl: favArtist.thumbnailUrl,
            likedAt: new Date().toISOString(),
          },
        ],
        homeShelves: [favShelf],
      });
    });

    render(<SearchScreen />);
    expect(screen.getByTestId('search-recent-items')).toBeTruthy();
    expect(screen.getByTestId('search-recommended-for-you').textContent).toContain('Columbia');
    expect(screen.getByTestId('search-recommended-artists').textContent).toContain('Quevedo');

    cleanup();
    act(() => {
      usePMusicStore.setState({ spotlightOpen: true, searchQuery: '' });
    });
    render(<SpotlightSearchModal />);
    expect(screen.getByTestId('spotlight-recommended-section').textContent).toContain('Columbia');
    expect(screen.getByTestId('spotlight-recommended-section').textContent).toContain('Quevedo');
    act(() => {
      usePMusicStore.setState({ spotlightOpen: false, searchQuery: '' });
    });
  });
});
