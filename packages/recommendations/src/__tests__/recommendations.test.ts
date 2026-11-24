import { describe, expect, it } from 'vitest';
import type { Track } from '@pmusic/core';
import { RecommendationEngine } from '../index.ts';

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
});
