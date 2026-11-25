import { describe, expect, it } from 'vitest';
import type { Track } from '@pmusic/core';
import {
  RecommendationEngine,
  getDailyMixDateKey,
  getMondayWeekWindow,
  getThursdayNoonCycleKey,
  isReleaseDateInWindow,
} from '../index.ts';

const TRACK_CRUZ: Track = {
  id: 'cc_1',
  title: 'Me Muevo Con Dios',
  artists: [{ name: 'Cruz Cafuné' }],
  durationSec: 214,
  thumbnailUrl: 'https://example.com/cruz.jpg',
  source: 'ytmusic',
  genres: ['urbano_es', 'trap_canarias'],
};

const TRACK_PANTERA: Track = {
  id: 'lp_1',
  title: 'Cayetano',
  artists: [{ name: 'La Pantera' }],
  durationSec: 224,
  thumbnailUrl: 'https://example.com/pantera.jpg',
  source: 'ytmusic',
  genres: ['trap_canarias', 'urbano_es'],
};

const TRACK_POP_INTL: Track = {
  id: 'pop_1',
  title: 'Random International Pop',
  artists: [{ name: 'Unknown Artist EN' }],
  durationSec: 180,
  thumbnailUrl: 'https://example.com/pop.jpg',
  source: 'ytmusic',
  genres: ['country_us'],
};

describe('@pmusic/recommendations', () => {
  it('applies Spanish urban seed priors (Bad Bunny, La Pantera, Cruz Cafuné) and learns from implicit signals', async () => {
    const engine = new RecommendationEngine();

    expect(engine.getEffectiveAffinity('Cruz Cafuné')).toBeGreaterThanOrEqual(7.5);
    expect(engine.getEffectiveAffinity('La Pantera')).toBeGreaterThanOrEqual(7.5);
    expect(engine.getEffectiveAffinity('Bad Bunny')).toBeGreaterThanOrEqual(7.5);
    expect(engine.getEffectiveAffinity('Unknown Artist EN')).toBe(0);

    const beforeCruz = engine.getEffectiveAffinity('Cruz Cafuné');
    await engine.recordSignal(TRACK_CRUZ, 'like');
    await engine.recordSignal(TRACK_CRUZ, 'complete_listen', { completionRatio: 0.95 });
    expect(engine.getEffectiveAffinity('Cruz Cafuné')).toBeGreaterThan(beforeCruz);

    await engine.recordSignal(TRACK_POP_INTL, 'skip_early', { actualPlayedSec: 6 });
    expect(engine.getEffectiveAffinity('Unknown Artist EN')).toBeLessThan(0);
  });

  it('reranks tracks favoring high-affinity Spanish urban artists and boosts autocomplete', () => {
    const engine = new RecommendationEngine();
    const reranked = engine.rerankTracks([TRACK_POP_INTL, TRACK_PANTERA, TRACK_CRUZ]);
    expect(reranked[0]?.id).not.toBe('pop_1');
    expect(reranked[2]?.id).toBe('pop_1');

    const suggestions = engine.rankAutocomplete('cruz', ['cruzando el mar', 'Cruz Cafuné - Cangrinaje']);
    expect(suggestions[0]?.text).toBe('Cruz Cafuné');
    expect(suggestions[0]?.kind).toBe('artist');
  });

  it('prioritizes split artist+track intent in both rerankTracks(query) and selectBestResult', () => {
    const engine = new RecommendationEngine();
    const noisy: Track = {
      id: 'noisy_1',
      title: 'El Puente del Diablo',
      artists: [{ name: 'Nelson Poblete' }],
      durationSec: 197,
      thumbnailUrl: 'https://example.com/nelson.jpg',
      source: 'ytmusic',
    };
    const exactMatch: Track = {
      id: 'exact_1',
      title: 'DIABLA',
      artists: [{ name: 'Pablete' }],
      album: { id: 'al_1', name: 'DIABLA' },
      durationSec: 186,
      thumbnailUrl: 'https://example.com/diabla.jpg',
      source: 'ytmusic',
    };

    const reranked = engine.rerankTracks([noisy, exactMatch], { query: 'pablete diabla' });
    expect(reranked[0]?.id).toBe('exact_1');

    const best = engine.selectBestResult('pablete diabla', {
      query: 'pablete diabla',
      songs: [noisy, exactMatch],
      videos: [],
      artists: [],
      albums: [],
      playlists: [],
    });
    expect(best?.kind).toBe('song');
    if (best?.kind === 'song') {
      expect(best.item.id).toBe('exact_1');
    }
  });

  it('prioritizes Spanish-scene & dotted artist matches in rerankSearchBundle (e.g. "valentino" -> D.Valentino)', () => {
    const engine = new RecommendationEngine();
    const foreignBandTrack: Track = {
      id: 'for_1',
      title: 'Volim Te Još',
      artists: [{ id: '83110262', name: 'Valentino' }],
      durationSec: 210,
      thumbnailUrl: 'https://example.com/for.jpg',
      source: 'ytmusic',
    };
    const spanishTrack: Track = {
      id: 'es_1',
      title: 'Prettygyal',
      artists: [
        { id: '119371702', name: 'D.Valentino' },
        { id: '999', name: 'Came Beats' },
      ],
      durationSec: 175,
      thumbnailUrl: 'https://example.com/dv.jpg',
      source: 'ytmusic',
    };
    const res = engine.rerankSearchBundle('valentino', {
      query: 'valentino',
      songs: [foreignBandTrack, spanishTrack],
      videos: [],
      artists: [
        { id: '83110262', name: 'Valentino', thumbnailUrl: 'https://example.com/for.jpg' },
        { id: '119371702', name: 'D.Valentino', thumbnailUrl: 'https://example.com/dv.jpg' },
      ],
      albums: [],
      playlists: [],
    });
    expect(res.artists[0]?.name).toBe('D.Valentino');
    expect(res.songs[0]?.id).toBe('es_1');
  });

  it('puts Artist Profile first when searching an artist name while exact song titles still return the song', async () => {
    const engine = new RecommendationEngine();
    await engine.recordSignal(TRACK_PANTERA, 'like');

    const bundle = {
      query: 'La Pantera',
      songs: [TRACK_PANTERA],
      videos: [],
      artists: [
        { id: '7524936', name: 'La Pantera', thumbnailUrl: 'https://example.com/lp.jpg' },
      ],
      albums: [],
      playlists: [],
    };

    const bestArtist = engine.selectBestResult('La Pantera', bundle);
    expect(bestArtist?.kind).toBe('artist');
    if (bestArtist?.kind === 'artist') {
      expect(bestArtist.item.name).toBe('La Pantera');
    }

    const bestSong = engine.selectBestResult('Cayetano', {
      ...bundle,
      query: 'Cayetano',
    });
    expect(bestSong?.kind).toBe('song');
    if (bestSong?.kind === 'song') {
      expect(bestSong.item.id).toBe('lp_1');
    }
  });

  it('never lets unrelated high-affinity or 0-fan homonym artists hijack non-matching searches like superestrella', async () => {
    const engine = new RecommendationEngine();
    await engine.recordSignal(TRACK_PANTERA, 'like');
    await engine.recordSignal(TRACK_PANTERA, 'complete_listen', { completionRatio: 1 });

    const songHit: Track = {
      id: 'dz:3566475931',
      title: 'SUPERESTRELLA',
      artists: [{ id: '123', name: 'Aitana' }],
      durationSec: 184,
      thumbnailUrl: 'https://example.com/aitana.jpg',
      source: 'ytmusic',
    };
    const obscureHomonym = {
      id: '9999999',
      name: 'Super Estrella',
      thumbnailUrl: 'https://example.com/se.jpg',
      subscribersText: '10 fans',
    };
    const laPantera = {
      id: '7524936',
      name: 'La Pantera',
      thumbnailUrl: 'https://example.com/lp.jpg',
      subscribersText: '500000 fans',
    };

    const reranked = engine.rerankSearchBundle('superestrella', {
      query: 'superestrella',
      songs: [songHit],
      videos: [],
      artists: [laPantera, obscureHomonym],
      albums: [],
      playlists: [],
    });

    expect(reranked.artists.map((a) => a.name)).toEqual(['Super Estrella']);
    expect(reranked.topResult?.kind).toBe('song');
    if (reranked.topResult?.kind === 'song') {
      expect(reranked.topResult.item.title).toBe('SUPERESTRELLA');
    }
  });

  it('updates Thursday 12:00 cycle key cleanly and boosts favorite artists across Daily Mixes without DJ labels', async () => {
    const beforeNoon = new Date(2026, 10, 26, 11, 55, 0); // Thursday Nov 26 2026 11:55
    const afterNoon = new Date(2026, 10, 26, 12, 5, 0); // Thursday Nov 26 2026 12:05
    const friday = new Date(2026, 10, 27, 9, 0, 0);
    expect(getThursdayNoonCycleKey(beforeNoon)).toBe('2026-11-19-T12');
    expect(getThursdayNoonCycleKey(afterNoon)).toBe('2026-11-26-T12');
    expect(getThursdayNoonCycleKey(friday)).toBe('2026-11-26-T12');
    expect(getDailyMixDateKey(afterNoon)).toBe('2026-11-26');

    const engine = new RecommendationEngine();
    const baseAffinity = engine.getEffectiveAffinity('Artist Nuevo');
    engine.setFavoriteArtists([
      {
        artistId: 'fav_1',
        artistName: 'Artist Nuevo',
        likedAt: new Date().toISOString(),
      },
    ]);
    expect(engine.getEffectiveAffinity('Artist Nuevo')).toBeGreaterThanOrEqual(baseAffinity + 20);

    const shelves = await engine.buildHomeShelves();
    const mixesShelf = shelves.find((s) => s.kind === 'mixes_for_you');
    expect(mixesShelf).toBeDefined();
    expect(mixesShelf?.subtitle?.toLowerCase()).not.toContain('dj');
    const titles = mixesShelf?.mixes?.map((m) => m.title) ?? [];
    expect(titles[0]).toBe('Descubre lo Nuevo');
    expect(titles.some((t) => /Daily Mix/i.test(t))).toBe(true);
    expect(titles.some((t) => /Sesión DJ/i.test(t))).toBe(false);
  });

  it('enforces Monday-to-Monday Descubre lo Nuevo, builds a single 100-song Daily Mix + 100-song unheard Daily Discover, and blocks unrelated chart pop', async () => {
    const searchCalls: string[] = [];
    const unrelatedPop: Track = {
      id: 'pop_ariana',
      title: 'Yes, And?',
      artists: [{ id: 'ariana', name: 'Ariana Grande' }],
      durationSec: 215,
      thumbnailUrl: 'https://example.com/ariana.jpg',
      source: 'ytmusic',
      releaseYear: 2024,
      releaseDate: '2024-01-12',
    };

    const now = new Date();
    const weekWin = getMondayWeekWindow(now);
    const thuNov26 = new Date(2026, 10, 26, 0, 23, 0);
    const thuWin = getMondayWeekWindow(thuNov26);
    expect(thuWin.startIso).toBe('2026-11-23');
    expect(thuWin.endIso).toBe('2026-11-30');
    expect(isReleaseDateInWindow('2026-11-23', thuWin.startIso, thuWin.endIso)).toBe(true);
    expect(isReleaseDateInWindow('2026-11-26', thuWin.startIso, thuWin.endIso)).toBe(true);
    expect(isReleaseDateInWindow('2026-11-30', thuWin.startIso, thuWin.endIso)).toBe(false);
    expect(isReleaseDateInWindow('2026-11-06', thuWin.startIso, thuWin.endIso)).toBe(false);

    // Build 260 distinct scene/related + 2nd-degree emerging tracks
    const sceneArtists = ['Cruzzi', 'La Pantera', 'Quevedo', 'Rels B', 'D.Valentino', 'Mvrk', 'Judeline', 'Rusowsky'];
    const poolTracks: Track[] = [];
    for (let i = 0; i < 260; i++) {
      const art = sceneArtists[i % sceneArtists.length]!;
      const isThisWeek = i >= 15 && i < 27;
      poolTracks.push({
        id: `scene_${i}`,
        title: `Tema Escena ${i}`,
        artists: [{ id: `art_${i % sceneArtists.length}`, name: art }],
        album: { id: `alb_${i % 16}`, name: `Álbum ${i % 16}` },
        durationSec: 185,
        thumbnailUrl: `https://example.com/${i}.jpg`,
        source: 'ytmusic',
        releaseYear: isThisWeek ? Number(weekWin.startIso.slice(0, 4)) : 2023,
        releaseDate: isThisWeek ? weekWin.startIso : '2023-05-12',
      });
    }

    const mockProvider = {
      search: async (query: string) => {
        searchCalls.push(query);
        const matching = poolTracks.filter((t) =>
          t.artists.some((a) => a.name.toLowerCase().includes(query.toLowerCase()))
        );
        return {
          query,
          songs: query === '' ? [unrelatedPop] : matching,
          videos: [],
          artists: [],
          albums: [],
          playlists: [],
        };
      },
      getHomeFeed: async () => ({ shelves: [], moods: [] }),
      getUpNext: async () => [],
      getRelated: async () => ({
        tracks: poolTracks.slice(0, 140),
        artists: sceneArtists.map((n, i) => ({
          id: `art_${i}`,
          name: n,
          thumbnailUrl: `https://example.com/ar_${i}.jpg`,
        })),
        playlists: [],
      }),
      getArtist: async (idOrName: string) => {
        const clean = idOrName.replace(/^art_/, '');
        const matched = poolTracks.filter((t) =>
          t.artists.some((a) => a.name.toLowerCase().includes(clean.toLowerCase()) || a.id === idOrName)
        );
        const artistName = matched[0]?.artists[0]?.name ?? clean;
        return {
          artist: { id: idOrName, name: artistName, thumbnailUrl: 'https://example.com/a.jpg' },
          topSongs: matched.length > 0 ? matched : poolTracks.slice(0, 40),
          albums: [
            {
              id: `alb_rel_${artistName}`,
              title: `Disco Semanal ${artistName}`,
              artists: [{ name: artistName }],
              thumbnailUrl: 'https://example.com/al.jpg',
              year: Number(weekWin.startIso.slice(0, 4)),
              releaseDate: weekWin.startIso,
            },
            {
              id: `alb_old_${artistName}`,
              title: `Disco Viejo ${artistName}`,
              artists: [{ name: artistName }],
              thumbnailUrl: 'https://example.com/al_old.jpg',
              year: 2026,
              releaseDate: weekWin.prevStartIso,
            },
          ],
          singles: [],
          relatedArtists: sceneArtists.map((n, idx) => ({
            id: `art_${idx}`,
            name: n,
            thumbnailUrl: 'https://example.com/rel.jpg',
          })),
        };
      },
      getAlbum: async (albumId: string) => {
        const isOld = albumId.startsWith('alb_old_');
        return {
          album: {
            id: albumId,
            title: isOld ? 'Disco Viejo' : 'Disco Semanal',
            artists: [{ name: 'Cruzzi' }],
            thumbnailUrl: 'https://example.com/al.jpg',
            year: Number(weekWin.startIso.slice(0, 4)),
            releaseDate: isOld ? weekWin.prevStartIso : weekWin.startIso,
          },
          tracks: isOld
            ? [
                {
                  id: `old_track_${albumId}`,
                  title: 'Canción Semana Pasada',
                  artists: [{ id: 'art_0', name: 'Cruzzi' }],
                  album: { id: albumId, name: 'Disco Viejo' },
                  durationSec: 190,
                  thumbnailUrl: 'https://example.com/old.jpg',
                  source: 'ytmusic' as const,
                  releaseYear: Number(weekWin.prevStartIso.slice(0, 4)),
                  releaseDate: weekWin.prevStartIso,
                },
              ]
            : poolTracks.filter((t) => t.releaseDate === weekWin.startIso),
        };
      },
    };

    const librarySlice = poolTracks.slice(0, 15);
    const likedList = [poolTracks[0]!, poolTracks[1]!];
    const ownedIds = new Set([...librarySlice, ...likedList].map((t) => t.id));

    const engine = new RecommendationEngine({ musicProvider: mockProvider });
    engine.setFavoriteArtists([{ artistId: 'art_0', artistName: 'Cruzzi', likedAt: '2026-11-25T10:00:00Z' }]);
    engine.setUserLibraryContext({
      libraryTracks: librarySlice,
      likedTracks: likedList,
    });
    await engine.recordSignal(poolTracks[12]!, 'complete_listen', { completionRatio: 0.95 });

    const shelves = await engine.buildHomeShelves();

    expect(searchCalls).not.toContain('');

    const allTrackIdsAcrossShelves = shelves.flatMap((s) => [
      ...(s.tracks ?? []).map((t) => t.id),
      ...(s.mixes ?? []).flatMap((m) => m.tracks.map((t) => t.id)),
    ]);
    expect(allTrackIdsAcrossShelves).not.toContain('pop_ariana');

    const discoverShelf = shelves.find((s) => s.kind === 'because_you_listened');
    expect(discoverShelf?.title).toBe('Recomendado para ti');

    const mixesShelf = shelves.find((s) => s.kind === 'mixes_for_you');
    const mixesList = mixesShelf?.mixes ?? [];
    expect(mixesList.map((m) => m.id)).toEqual([
      'mix_descubre_lo_nuevo',
      'mix_daily_mix',
      'mix_daily_discover',
    ]);

    const weeklyMix = mixesList[0]!;
    expect(weeklyMix.tracks.length).toBeGreaterThan(0);
    for (const t of weeklyMix.tracks) {
      expect(isReleaseDateInWindow(t.releaseDate, weekWin.startIso, weekWin.endIso)).toBe(true);
    }
    expect(weeklyMix.tracks.some((t) => t.id.startsWith('old_track_'))).toBe(false);

    const dailyMix = mixesList[1]!;
    const dailyDiscover = mixesList[2]!;
    expect(dailyMix.tracks.length).toBe(100);
    expect(dailyDiscover.tracks.length).toBe(100);

    // Daily Mix must include user's familiar tracks alongside recommendations
    expect(dailyMix.tracks.some((t) => ownedIds.has(t.id))).toBe(true);

    // Daily Discover must NEVER contain owned playlists/likes, listened history, or Daily Mix tracks
    const dailyMixIds = new Set(dailyMix.tracks.map((t) => t.id));
    for (const t of dailyDiscover.tracks) {
      expect(ownedIds.has(t.id)).toBe(false);
      expect(t.id).not.toBe(poolTracks[12]!.id);
      expect(dailyMixIds.has(t.id)).toBe(false);
    }
  });
});
