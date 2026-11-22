import { describe, expect, it } from 'vitest';
import {
  DeezerCatalog,
  LrcParser,
  LrclibLyricsProvider,
  PlaylistImporter,
  YouTubeMusicProvider,
  parseFeaturedArtistsFromTitle,
  parseSpotifyEmbedHtml,
  scoreAudioCandidate,
  splitSpotifySubtitleArtists,
  synthesizeDeterministicWavBuffer,
} from '../index.ts';

describe('@pmusic/providers', () => {
  it('parses multi-timestamp and word-timed LRC files with O(log N) binary search', () => {
    const parser = new LrcParser();
    const raw = [
      '[ar:Cruz Cafuné]',
      '[ti:Me Muevo Con Dios]',
      '[offset:100]',
      '[00:05.00][00:25.00]Me muevo con Dios',
      '[00:10.50]♪',
      '[00:15.20]<00:15.20>Desde <00:16.00>Tenerife',
    ].join('\n');

    const res = parser.parse(raw);
    expect(res.metadata.ar).toBe('Cruz Cafuné');
    expect(res.offsetMs).toBe(100);
    expect(res.lines).toHaveLength(4);
    expect(res.lines[0]?.timeMs).toBe(4900);
    expect(res.lines[1]?.isInterlude).toBe(true);
    expect(res.lines[2]?.words).toHaveLength(2);
    expect(res.lines[3]?.timeMs).toBe(24900);

    expect(parser.findActiveLineIndex(res.lines, 1000)).toBe(-1);
    expect(parser.findActiveLineIndex(res.lines, 5000)).toBe(0);
    expect(parser.findActiveLineIndex(res.lines, 16000)).toBe(2);
    expect(parser.findActiveLineIndex(res.lines, 30000)).toBe(3);
  });

  it('cascades LrclibLyricsProvider from /api/get to /api/search and YTMusic fallback', async () => {
    const mockFetch = (async (url: string | URL | Request) => {
      const u = String(url);
      if (u.includes('/api/get')) {
        return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } });
      }
      if (u.includes('/api/search')) {
        return new Response(
          JSON.stringify([
            {
              id: 777,
              trackName: 'Me Muevo Con Dios',
              artistName: 'Cruz Cafuné',
              duration: 214,
              syncedLyrics: '[00:02.00]Subiendo desde Canarias\n[00:06.00]Me muevo con Dios',
            },
          ]),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      return new Response('{}', { status: 404 });
    }) as typeof fetch;

    const provider = new LrclibLyricsProvider({ fetchFn: mockFetch });
    const doc = await provider.getLyrics({
      trackId: 'cc_me_muevo_01',
      title: 'Me Muevo Con Dios (Video Oficial)',
      artist: 'Cruz Cafuné',
      durationSec: 214,
    });

    expect(doc.status).toBe('synced');
    expect(doc.source).toBe('lrclib');
    expect(doc.lines).toHaveLength(2);
    expect(doc.lines[0]?.text).toBe('Subiendo desde Canarias');
  });

  it('splits Spotify non-breaking space subtitles and parses __NEXT_DATA__ with 100-track truncation warning', () => {
    const artists = splitSpotifySubtitleArtists('La Pantera,\u00A0Quevedo,\u00A0Juseph');
    expect(artists).toEqual(['La Pantera', 'Quevedo', 'Juseph']);

    const trackList = Array.from({ length: 100 }, (_, idx) => ({
      uid: `uid_${idx}`,
      uri: `spotify:track:${idx}`,
      title: idx === 0 ? 'Cayetano' : `Track ${idx}`,
      subtitle: 'La Pantera,\u00A0Quevedo',
      duration: 224_000,
    }));

    const html = `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
      props: {
        pageProps: {
          state: {
            data: {
              entity: {
                title: 'Trap Canarias Hits',
                ownerV2: { data: { name: 'pMusic User' } },
                trackList,
              },
            },
          },
        },
      },
    })}</script></body></html>`;

    const extracted = parseSpotifyEmbedHtml(html, {
      platform: 'spotify',
      kind: 'playlist',
      id: '37i9dQZF1DX123456',
      canonicalUrl: 'https://open.spotify.com/playlist/37i9dQZF1DX123456',
    });

    expect(extracted).not.toBeNull();
    expect(extracted?.truncated).toBe(true);
    expect(extracted?.warning).toContain('100');
    expect(extracted?.tracks[0]?.artists).toEqual(['La Pantera', 'Quevedo']);
  });

  it('imports Spotify and YouTube playlists and matches tracks against YouTubeMusicProvider', async () => {
    const musicProvider = new YouTubeMusicProvider();
    const importer = new PlaylistImporter({
      musicProvider,
      spotifyExtractor: async (parsed) => ({
        id: parsed.id,
        kind: parsed.kind,
        name: 'Mi Playlist Urbana',
        author: 'Pablo',
        sourceUrl: parsed.canonicalUrl,
        truncated: false,
        tracks: [
          { title: 'Me Muevo Con Dios', artists: ['Cruz Cafuné'], durationSec: 214 },
          { title: 'Cayetano', artists: ['La Pantera', 'Quevedo'], durationSec: 224 },
        ],
      }),
    });

    const parsedSpotify = importer.parseUrl('https://open.spotify.com/intl-es/playlist/37i9dQZF1DX123456?si=abc');
    expect(parsedSpotify?.platform).toBe('spotify');
    expect(parsedSpotify?.id).toBe('37i9dQZF1DX123456');

    const result = await importer.importFromUrl('https://open.spotify.com/playlist/37i9dQZF1DX123456');
    expect(result.name).toBe('Mi Playlist Urbana');
    expect(result.items).toHaveLength(2);
    expect(result.items[0]?.status).toBe('matched');
    expect(result.items[0]?.match?.id).toBe('cc_me_muevo_01');
  });

  it('synthesizes a valid RIFF WAVE buffer for audio streaming', () => {
    const wav = synthesizeDeterministicWavBuffer(2, 120);
    expect(wav.byteLength).toBeGreaterThan(44);
    const header = String.fromCharCode(wav[0]!, wav[1]!, wav[2]!, wav[3]!);
    expect(header).toBe('RIFF');
  });

  it('extracts and deduplicates multi-artist collaborations from track titles and contributors', () => {
    expect(
      parseFeaturedArtistsFromTitle('Cayó La Noche (feat. Cruzzi, Abhir Hathi & Bejo) [Remix]')
    ).toEqual(['Cruzzi', 'Abhir Hathi', 'Bejo']);
    expect(parseFeaturedArtistsFromTitle('LUNA ft. Feid x ATL Jacob')).toEqual([
      'Feid',
      'ATL Jacob',
    ]);
  });

  it('expands matching albums and ranks split artist+track intent #1 (e.g. "pablete diabla" -> Pablete - DIABLA)', async () => {
    const mockFetch = (async (url: string | URL | Request) => {
      const u = String(url);
      if (u.includes('/search/track?')) {
        return new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (u.includes('/search/album?')) {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: 9901,
                title: 'DIABLA',
                artist: { id: 501, name: 'Pablete' },
                cover_medium: 'https://example.com/diabla.jpg',
                release_date: '2025-11-01',
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      if (u.includes('/album/9901/tracks')) {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: 8801,
                title: 'DIABLA',
                title_short: 'DIABLA',
                duration: 186,
                artist: { id: 501, name: 'Pablete' },
                contributors: [{ id: 501, name: 'Pablete' }],
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      if (u.includes('/search?')) {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: 1001,
                title: 'El Puente del Diablo',
                duration: 197,
                artist: { id: 201, name: 'Nelson Poblete' },
                contributors: [{ id: 201, name: 'Nelson Poblete' }],
                album: { id: 301, title: 'Patios Interiores', cover_medium: 'https://example.com/nelson.jpg' },
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
    const res = await catalog.search('pablete diabla', 'all');
    expect(res.songs[0]?.title).toBe('DIABLA');
    expect(res.songs[0]?.artists[0]?.name).toBe('Pablete');
    expect(res.topResult?.kind).toBe('song');
    if (res.topResult?.kind === 'song') {
      expect(res.topResult.item.title).toBe('DIABLA');
      expect(res.topResult.item.artists[0]?.name).toBe('Pablete');
    }
  });

  it('resolves artistByName using normalized exact match + highest fan count (La Pantera 7524936 & Miky Woodz 10177296)', async () => {
    const mockFetch = (async (url: string | URL | Request) => {
      const u = String(url);
      if (u.includes('/search/artist?')) {
        if (u.includes('Miky')) {
          return new Response(
            JSON.stringify({
              data: [
                { id: 412798571, name: 'Miky Woodz', nb_fan: 0 },
                { id: 10177296, name: 'Miky Woodz', nb_fan: 427195 },
              ],
            }),
            { status: 200, headers: { 'content-type': 'application/json' } }
          );
        }
        return new Response(
          JSON.stringify({
            data: [
              { id: 307769181, name: 'La Pantera', nb_fan: 12 },
              { id: 7524936, name: 'La Pantera', nb_fan: 7478 },
              { id: 2969, name: 'Pantera', nb_fan: 1625364 },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      if (u.includes('/artist/7524936')) {
        return new Response(
          JSON.stringify({
            id: 7524936,
            name: 'La Pantera',
            nb_fan: 7478,
            picture_xl: 'https://example.com/lp.jpg',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      if (u.includes('/artist/10177296')) {
        return new Response(
          JSON.stringify({
            id: 10177296,
            name: 'Miky Woodz',
            nb_fan: 427195,
            picture_xl: 'https://example.com/mw.jpg',
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
    const lp = await catalog.artistByName('La Pantera');
    expect(lp.artist.id).toBe('7524936');
    expect(lp.artist.name).toBe('La Pantera');

    const mw = await catalog.artistByName('Miky Woodz');
    expect(mw.artist.id).toBe('10177296');
    expect(mw.artist.name).toBe('Miky Woodz');
  });

  it('rejects unrelated artist/song audio candidates and accepts stripped titles with matching artist', () => {
    const wrongArtist = scoreAudioCandidate(
      { title: 'MONACO', artist: 'Bad Bunny', durationSec: 267 },
      {
        candidateTitle: 'Monaco Grand Prix Highlights',
        candidateAuthor: 'F1 Channel',
        candidateDurationSec: 265,
      }
    );
    expect(wrongArtist).toBe(-Infinity);

    const exactStrip = scoreAudioCandidate(
      { title: 'PERRO NEGRO (feat. Feid)', artist: 'Bad Bunny, Feid', durationSec: 162 },
      {
        candidateTitle: 'PERRO NEGRO',
        candidateArtists: 'Bad Bunny Feid',
        candidateDurationSec: 163,
        isYtMusicSong: true,
      }
    );
    expect(exactStrip).toBeGreaterThanOrEqual(15);
  });

  it('falls back to Musixmatch lyrics when LRCLIB fails and resolves complete albums by query', async () => {
    const mockLrclibFetch = (async () =>
      new Response('Not found', { status: 404 })) as typeof fetch;

    const lyr = new LrclibLyricsProvider({
      fetchFn: mockLrclibFetch,
      musixmatchFetcher: async () => ({
        syncedLyrics: '[00:04.00]Verso desde Musixmatch\n[00:08.50]Sonando limpio',
        plainLyrics: 'Verso desde Musixmatch\nSonando limpio',
        source: 'musixmatch',
      }),
    });
    const doc = await lyr.getLyrics({
      trackId: 'mx_1',
      title: 'Prettygyal',
      artist: 'D.Valentino',
      durationSec: 175,
    });
    expect(doc.source).toBe('musixmatch');
    expect(doc.status).toBe('synced');
    expect(doc.lines).toHaveLength(2);

    const mockAlbumFetch = (async (url: string | URL | Request) => {
      const u = String(url);
      if (u.includes('/search/album?')) {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: 501641511,
                title: 'nadie sabe lo que va a pasar mañana',
                artist: { id: 10583405, name: 'Bad Bunny' },
                cover_medium: 'https://example.com/ns.jpg',
                release_date: '2023-10-13',
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      if (u.includes('/album/501641511/tracks')) {
        const list = Array.from({ length: 22 }, (_, i) => ({
          id: 9000 + i,
          title: `Track ${i + 1}`,
          duration: 200,
          artist: { id: 10583405, name: 'Bad Bunny' },
          contributors: [{ id: 10583405, name: 'Bad Bunny' }],
        }));
        return new Response(JSON.stringify({ data: list }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (u.includes('/album/501641511')) {
        return new Response(
          JSON.stringify({
            id: 501641511,
            title: 'nadie sabe lo que va a pasar mañana',
            nb_tracks: 22,
            artist: { id: 10583405, name: 'Bad Bunny' },
            tracks: { data: [] },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    const catalog = new DeezerCatalog(mockAlbumFetch);
    const yt = new YouTubeMusicProvider({ catalog });
    const fullAlbum = await yt.getAlbum('MPR_NSLQVAPM_2023');
    expect(fullAlbum.tracks).toHaveLength(22);
  });

  it('matches Cruz Cafuné -> Cruzzi artist alias and accepts 388s Me Muevo Con Dios on YTMusic', () => {
    const crzScore = scoreAudioCandidate(
      { title: 'Me Muevo Con Dios', artist: 'Cruz Cafuné', durationSec: 214 },
      {
        candidateTitle: 'Me Muevo Con Dios',
        candidateArtists: 'Cruzzi',
        candidateDurationSec: 388,
        isYtMusicSong: true,
      }
    );
    const coverScore = scoreAudioCandidate(
      { title: 'Me Muevo Con Dios', artist: 'Cruz Cafuné', durationSec: 214 },
      {
        candidateTitle: 'Me Muevo Con Dios (Acoustic Cover)',
        candidateArtists: 'Random Cover Artist',
        candidateDurationSec: 214,
        isYtMusicSong: false,
      }
    );
    expect(crzScore).toBeGreaterThanOrEqual(15);
    expect(crzScore).toBeGreaterThan(coverScore);

    const cangriScore = scoreAudioCandidate(
      { title: 'Cangrinaje', artist: 'Cruz Cafuné', durationSec: 212 },
      {
        candidateTitle: 'Cangrinaje',
        candidateArtists: 'Cruzzi',
        candidateDurationSec: 212,
        isYtMusicSong: true,
      }
    );
    expect(cangriScore).toBeGreaterThanOrEqual(20);
  });
});
