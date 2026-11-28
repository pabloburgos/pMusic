import { describe, expect, it } from 'vitest';
import {
  AudioStreamResolver,
  DeezerCatalog,
  HttpProxyMusicProvider,
  LrcParser,
  LrclibLyricsProvider,
  PlaylistImporter,
  YouTubeMusicProvider,
  canonicalizeArtistIdentity,
  createPMusicApiHandler,
  extractSpotifyEmbedAccessToken,
  fetchSpotifyPathfinderPlaylist,
  getFallbackArtistDetail,
  isAuthenticLyricsText,
  mergeMatchedTrackArtists,
  parseFeaturedArtistsFromTitle,
  parseLaHigueraNovedadesHtml,
  parsePlaylistCsvOrText,
  parseSpotifyEmbedHtml,
  parseSpotifyEmbedPlaylistHtml,
  parseYouTubeDescriptionCredits,
  parseYtmAudienceCount,
  rankStreamFormatsForQuality,
  sanitizeArtistImageUrl,
  scoreAudioCandidate,
  searchFallbackCatalog,
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

  it('rejects karaoke/cover/slowed/8d variants for remix songs while preferring the official remix', () => {
    const target = {
      title: 'Las Bratz (Remix)',
      artist: 'Aitana',
      durationSec: 218,
    };

    const officialRemixScore = scoreAudioCandidate(target, {
      candidateTitle: 'Las Bratz (Remix)',
      candidateArtists: 'Aitana, Saiko, Dei V',
      candidateDurationSec: 218,
      isYtMusicSong: true,
    });
    const karaokeScore = scoreAudioCandidate(target, {
      candidateTitle: 'Las Bratz (Remix) Karaoke Version',
      candidateArtists: 'Karaoke Hits',
      candidateDurationSec: 218,
      isYtMusicSong: false,
    });
    const instrumentalScore = scoreAudioCandidate(target, {
      candidateTitle: 'Las Bratz Remix Instrumental',
      candidateArtists: 'Beat Maker',
      candidateDurationSec: 218,
      isYtMusicSong: false,
    });
    const coverScore = scoreAudioCandidate(target, {
      candidateTitle: 'Las Bratz Remix (Cover)',
      candidateArtists: 'Cover Singer',
      candidateDurationSec: 218,
      isYtMusicSong: false,
    });
    const slowedScore = scoreAudioCandidate(target, {
      candidateTitle: 'Las Bratz (Remix) [Slowed + Reverb]',
      candidateArtists: 'NightEdits',
      candidateDurationSec: 230,
      isYtMusicSong: false,
    });
    const nonRemixScore = scoreAudioCandidate(target, {
      candidateTitle: 'Las Bratz',
      candidateArtists: 'Aitana',
      candidateDurationSec: 215,
      isYtMusicSong: true,
    });

    expect(officialRemixScore).toBeGreaterThan(20);
    expect(officialRemixScore).toBeGreaterThan(nonRemixScore);
    expect(karaokeScore).toBe(-Infinity);
    expect(instrumentalScore).toBe(-Infinity);
    expect(coverScore).toBe(-Infinity);
    expect(slowedScore).toBe(-Infinity);
  });

  it('rejects scrambled gibberish or foreign cipher lyrics and returns not_found instead of fake lines', async () => {
    const scrambled = [
      '[00:10.00]Kahe rorew vip',
      '[00:14.00]Vuqew qazaqo kimi',
      '[00:18.00]Qaxu xur cutox',
      '[00:22.00]Ger tiwuk gejun',
      '[00:26.00]Yanufo zisan sen',
      '[00:30.00]Poj hesu qanu',
      '[00:34.00]Kij viki manex',
      '[00:38.00]Yited foc weti',
      '[00:42.00]Dumufu bav hebijo',
      '[00:46.00]Xipihe wihe yigog',
      '[00:50.00]Sogu qud seyoz',
      '[00:54.00]Boj weq yec',
    ].join('\n');

    expect(isAuthenticLyricsText(scrambled)).toBe(false);
    expect(
      isAuthenticLyricsText('[00:05.00]Me muevo con Dios por la noche en la isla sin mirar atrás')
    ).toBe(true);

    const mock404 = (async () => new Response('Not found', { status: 404 })) as typeof fetch;
    const provider = new LrclibLyricsProvider({
      fetchFn: mock404,
      musixmatchFetcher: async () => ({
        syncedLyrics: scrambled,
        plainLyrics: scrambled,
        source: 'musixmatch',
      }),
    });
    const doc = await provider.getLyrics({
      trackId: 'tr_gibberish',
      title: 'LAMINE YAMAL',
      artist: 'Nemzzz',
      durationSec: 133,
    });
    expect(doc.status).toBe('not_found');
    expect(doc.lines).toHaveLength(0);
  });

  it('keeps underground style-matched recommendations resilient when artist radio fails', async () => {
    const mockFetch = (async (url: string | URL | Request) => {
      const u = String(url);
      if (u.includes('/track/8801')) {
        return new Response(
          JSON.stringify({
            id: 8801,
            title: 'DIABLA',
            duration: 186,
            artist: { id: 501, name: 'Pablete' },
            album: { id: 9901, title: 'DIABLA', cover_medium: 'https://example.com/d.jpg' },
            contributors: [
              { id: 501, name: 'Pablete' },
              { id: 502, name: 'ScenePeer' },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      if (u.includes('/artist/501/radio')) {
        return new Response(JSON.stringify({ error: { message: 'no data' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (u.includes('/artist/501/related') || u.includes('/artist/501/top')) {
        return new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (u.includes('/album/9901')) {
        return new Response(
          JSON.stringify({ id: 9901, title: 'DIABLA', genres: { data: [{ id: 116 }] } }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      if (u.includes('/artist/502/top')) {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: 7701,
                title: 'Noche Under',
                duration: 175,
                artist: { id: 502, name: 'ScenePeer' },
                album: { id: 9902, title: 'Under Tape', cover_medium: 'https://example.com/u.jpg' },
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      if (u.includes('/search/playlist?')) {
        return new Response(
          JSON.stringify({
            data: [{ id: 3301, title: 'Underground ES', nb_tracks: 24 }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      if (u.includes('/playlist/3301/tracks')) {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: 8801,
                title: 'DIABLA',
                duration: 186,
                artist: { id: 501, name: 'Pablete' },
                album: { id: 9901, title: 'DIABLA' },
              },
              {
                id: 7702,
                title: 'Calle Oscura',
                duration: 192,
                artist: { id: 503, name: 'UnderBoy' },
                album: { id: 9903, title: 'Oscura', cover_medium: 'https://example.com/o.jpg' },
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
    const rel = await catalog.related('dz:8801');
    const titles = rel.tracks.map((t) => t.title);
    expect(titles).toContain('Noche Under');
    expect(titles).toContain('Calle Oscura');
    expect(titles).not.toContain('DIABLA');
  });

  it('returns HTTP 503 JSON instead of 12s WAV tone or 30s preview when stream resolution fails', async () => {
    const prevFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ data: [] }), { status: 500 })) as typeof fetch;
    try {
      const handler = createPMusicApiHandler({ fetchFn: globalThis.fetch });
      const headers: Record<string, string | number> = {};
      let bodyBytes = Buffer.alloc(0);
      const fakeReq = {
        method: 'GET',
        url: '/api/stream/dz:999888?title=Inexistente&artist=Nadie',
        headers: { host: '127.0.0.1' },
      } as unknown as import('node:http').IncomingMessage;
      const fakeRes = {
        statusCode: 200,
        setHeader(k: string, v: string | number) {
          headers[k.toLowerCase()] = v;
        },
        end(chunk?: unknown) {
          if (chunk) {
            bodyBytes = Buffer.from(chunk as Uint8Array);
          }
        },
      } as unknown as import('node:http').ServerResponse;

      const handled = await handler(fakeReq, fakeRes);
      expect(handled).toBe(true);
      expect(fakeRes.statusCode).toBe(503);
      expect(String(headers['content-type'])).toContain('application/json');
      const parsed = JSON.parse(bodyBytes.toString('utf-8')) as { error?: string };
      expect(parsed.error).toBeTruthy();
    } finally {
      globalThis.fetch = prevFetch;
    }
  }, 15000);

  it('rejects 6-minute YouTube video candidates for 3-minute tracks in scoreAudioCandidate', () => {
    const score = scoreAudioCandidate(
      { title: 'NUEVAYoL', artist: 'Bad Bunny', durationSec: 180 },
      {
        candidateTitle: 'NUEVAYoL',
        candidateAuthor: 'Bad Bunny',
        candidateDurationSec: 360,
        isYtMusicSong: false,
      }
    );
    expect(score).toBe(-Infinity);
  });

  it('falls back quickly to full-length Audius MP3 stream when YouTube resolution returns null', async () => {
    const prevFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request) => {
      const u = String(url);
      if (u.includes('api.audius.co/v1/tracks/search')) {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: 'aud123',
                title: 'NUEVAYoL',
                duration: 184,
                is_streamable: true,
                user: { name: 'Bad Bunny' },
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      if (u.includes('api.audius.co/v1/tracks/aud123/stream')) {
        return new Response(new Uint8Array([1, 2, 3, 4]), {
          status: 206,
          headers: { 'content-type': 'audio/mpeg' },
        });
      }
      return new Response('Not found', { status: 404 });
    }) as typeof fetch;

    try {
      const resolver = new AudioStreamResolver(new DeezerCatalog(globalThis.fetch));
      (resolver as unknown as { yt: () => Promise<never> }).yt = async () => {
        throw new Error('YT unavailable');
      };
      const resolved = await resolver.resolve('bb_nuevayol_01', {
        title: 'NUEVAYoL',
        artist: 'Bad Bunny',
        durationSec: 183,
      });
      expect(resolved).not.toBeNull();
      expect(resolved?.source).toBe('audius-full');
      expect(resolved?.mime).toBe('audio/mpeg');
      expect(resolved?.url).toBe('https://api.audius.co/v1/tracks/aud123/stream?app_name=pMusic');
    } finally {
      globalThis.fetch = prevFetch;
    }
  }, 15000);

  it('rejects remixes, mashups, edits and bootlegs for Columbia while keeping authentic original, and refuses Audius remixes', async () => {
    const remixScore = scoreAudioCandidate(
      { title: 'Columbia', artist: 'Quevedo', durationSec: 186 },
      {
        candidateTitle: 'Columbia (DJ Remix / Mashup Edit)',
        candidateArtists: 'Quevedo',
        candidateDurationSec: 186,
        isYtMusicSong: true,
      }
    );
    expect(remixScore).toBe(-Infinity);

    const originalScore = scoreAudioCandidate(
      { title: 'Columbia', artist: 'Quevedo', durationSec: 186 },
      {
        candidateTitle: 'Columbia',
        candidateArtists: 'Quevedo',
        candidateDurationSec: 186,
        isYtMusicSong: true,
      }
    );
    expect(originalScore).toBeGreaterThanOrEqual(20);

    const prevFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request) => {
      const u = String(url);
      if (u.includes('api.audius.co/v1/tracks/search')) {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: 'remx999',
                title: 'Columbia (Bootleg Remix)',
                duration: 185,
                is_streamable: true,
                user: { name: 'Random DJ' },
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      return new Response('Not found', { status: 404 });
    }) as typeof fetch;

    try {
      const resolver = new AudioStreamResolver(new DeezerCatalog(globalThis.fetch));
      (resolver as unknown as { yt: () => Promise<never> }).yt = async () => {
        throw new Error('YT unavailable');
      };
      const resolved = await resolver.resolve('quevedo_columbia_test', {
        title: 'Columbia',
        artist: 'Quevedo',
        durationSec: 186,
      });
      expect(resolved).toBeNull();
    } finally {
      globalThis.fetch = prevFetch;
    }
  }, 15000);

  it('ranks matching artist profile first for artist queries, keeps artist+song queries on song, and promotes joint album co-headliners', async () => {
    const mockFetch = (async (url: string | URL | Request) => {
      const u = String(url);
      if (u.includes('/search/artist')) {
        return new Response(
          JSON.stringify({
            data: [
              { id: 7524936, name: 'La Pantera', nb_fan: 550000, picture_big: 'https://example.com/lp.jpg' },
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
                id: 3001,
                title: 'SHARINGAN',
                title_short: 'SHARINGAN',
                duration: 215,
                artist: { id: 7524936, name: 'La Pantera' },
                contributors: [{ id: 7524936, name: 'La Pantera' }],
                album: { id: 601, title: 'SHARINGAN', cover_medium: 'https://example.com/sh.jpg' },
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      if (u.includes('/album/777001/tracks')) {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: 8101,
                title: 'BANE',
                duration: 190,
                artist: { id: 101, name: 'Lucho RK' },
                contributors: [
                  { id: 101, name: 'Lucho RK' },
                  { id: 7524936, name: 'La Pantera' },
                ],
              },
              {
                id: 8102,
                title: 'TA FACIL',
                duration: 200,
                artist: { id: 101, name: 'Lucho RK' },
                contributors: [
                  { id: 101, name: 'Lucho RK' },
                  { id: 7524936, name: 'La Pantera' },
                ],
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      if (u.includes('/album/777001')) {
        return new Response(
          JSON.stringify({
            id: 777001,
            title: 'TA FACIL',
            nb_tracks: 2,
            artist: { id: 101, name: 'Lucho RK' },
            cover_big: 'https://example.com/tf.jpg',
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

    const catalog = new DeezerCatalog(mockFetch);
    const artistQueryRes = await catalog.search('La Pantera', 'all');
    expect(artistQueryRes.topResult?.kind).toBe('artist');
    if (artistQueryRes.topResult?.kind === 'artist') {
      expect(artistQueryRes.topResult.item.name).toBe('La Pantera');
    }

    const songQueryRes = await catalog.search('La Pantera Sharingan', 'all');
    expect(songQueryRes.topResult?.kind).toBe('song');
    if (songQueryRes.topResult?.kind === 'song') {
      expect(songQueryRes.topResult.item.title).toBe('SHARINGAN');
    }

    const jointAlbum = await catalog.album('777001');
    expect(jointAlbum.album.artists.map((a) => a.name)).toEqual(['Lucho RK', 'La Pantera']);
    expect(jointAlbum.tracks[0]?.artists.map((a) => a.name)).toEqual(['Lucho RK', 'La Pantera']);
  });

  it('enriches DeezerCatalog.artist with fresh YouTube Music portrait, widescreen banner, and newest-first albums/singles split', async () => {
    const mockFetch = (async (input: RequestInfo | URL) => {
      const u = String(input);
      if (u.endsWith('/artist/7524936')) {
        return new Response(
          JSON.stringify({
            id: 7524936,
            name: 'La Pantera',
            nb_fan: 500000,
            picture_big: 'https://cdn-images.dzcdn.net/old-500.jpg',
            picture_xl: 'https://cdn-images.dzcdn.net/old-1000.jpg',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      if (u.includes('/artist/7524936/top')) {
        return new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (u.includes('/artist/7524936/albums')) {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: 1,
                title: 'UNA SEMANA INCREÍBLE',
                record_type: 'album',
                release_date: '2024-09-01',
                cover_big: 'https://example.com/alb1.jpg',
              },
              {
                id: 2,
                title: 'SINGLE ANTIGUO',
                record_type: 'single',
                release_date: '2022-03-10',
                cover_big: 'https://example.com/sg0.jpg',
              },
              {
                id: 3,
                title: 'SINGLE NUEVO',
                record_type: 'single',
                release_date: '2025-11-15',
                cover_big: 'https://example.com/sg1.jpg',
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      if (u.includes('/artist/7524936/related')) {
        return new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (u.includes('music.youtube.com/youtubei/v1/search')) {
        return new Response(
          JSON.stringify({
            contents: {
              musicResponsiveListItemRenderer: {
                flexColumns: [
                  {
                    musicResponsiveListItemFlexColumnRenderer: {
                      text: { runs: [{ text: 'La Pantera' }] },
                    },
                  },
                ],
                thumbnail: {
                  musicThumbnailRenderer: {
                    thumbnail: {
                      thumbnails: [
                        {
                          url: 'https://lh3.googleusercontent.com/artist_avatar=w120-h120-p-l90-rj',
                          width: 120,
                          height: 120,
                        },
                      ],
                    },
                  },
                },
                navigationEndpoint: {
                  browseEndpoint: { browseId: 'UCtestPantera123' },
                },
              },
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      if (u.includes('music.youtube.com/youtubei/v1/browse')) {
        return new Response(
          JSON.stringify({
            header: {
              musicImmersiveHeaderRenderer: {
                thumbnail: {
                  musicThumbnailRenderer: {
                    thumbnail: {
                      thumbnails: [
                        {
                          url: 'https://lh3.googleusercontent.com/artist_banner=w2880-h1200-p-l90-rj',
                          width: 2880,
                          height: 1200,
                        },
                      ],
                    },
                  },
                },
                monthlyListenerCount: {
                  runs: [{ text: '5,8 M oyentes mensuales' }],
                },
                description: {
                  runs: [{ text: 'Artista urbano de Gran Canaria.' }],
                },
              },
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    }) as typeof fetch;

    const catalog = new DeezerCatalog(mockFetch);
    const detail = await catalog.artist('7524936');

    expect(detail.artist.thumbnailUrl).toBe(
      'https://lh3.googleusercontent.com/artist_avatar=w640-h640-p-l90-rj'
    );
    expect(detail.bannerUrl).toBe(
      'https://lh3.googleusercontent.com/artist_banner=w1440-h600-p-l90-rj'
    );
    expect(detail.artist.subscribersText).toBe('5,8 M oyentes mensuales');
    expect(detail.description).toBe('Artista urbano de Gran Canaria.');
    expect(detail.albums.map((a) => a.title)).toEqual(['UNA SEMANA INCREÍBLE']);
    expect(detail.singles.map((s) => s.title)).toEqual(['SINGLE NUEVO', 'SINGLE ANTIGUO']);
  });

  it('filters out fake/homonym Deezer releases via YTM official channel discography and classifies EPs into singles', async () => {
    const mockFetch = (async (input: RequestInfo | URL) => {
      const u = String(input);
      if (u.endsWith('/artist/7524936')) {
        return new Response(
          JSON.stringify({
            id: 7524936,
            name: 'La Pantera',
            nb_fan: 7500,
            picture_big: 'https://cdn-images.dzcdn.net/old-500.jpg',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      if (u.includes('/artist/7524936/top')) {
        return new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (u.includes('/artist/7524936/albums')) {
        return new Response(
          JSON.stringify({
            data: [
              { id: 10, title: 'FILIPENSES', record_type: 'album', release_date: '2026-11-06', fans: 132, cover_big: 'https://e/f.jpg' },
              { id: 11, title: 'Afterglow', record_type: 'album', release_date: '2026-07-27', fans: 10, cover_big: 'https://e/a.jpg' },
              { id: 12, title: 'UNA SEMANA INCREÍBLE', record_type: 'album', release_date: '2024-09-27', fans: 339, cover_big: 'https://e/u.jpg' },
              { id: 13, title: 'STONE BOY EUROPA', record_type: 'ep', release_date: '2026-06-18', fans: 78, cover_big: 'https://e/s.jpg' },
              { id: 14, title: 'Entre Tú Y Yo', record_type: 'single', release_date: '2026-11-21', fans: 0, cover_big: 'https://e/e.jpg' },
              { id: 15, title: 'TONY STARK', record_type: 'single', release_date: '2026-11-05', fans: 6, cover_big: 'https://e/t.jpg' },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      if (u.includes('/artist/7524936/related')) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      if (u.includes('music.youtube.com/youtubei/v1/search')) {
        return new Response(
          JSON.stringify({
            contents: {
              musicResponsiveListItemRenderer: {
                flexColumns: [{ musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'La Pantera' }] } } }],
                navigationEndpoint: { browseEndpoint: { browseId: 'UCtestPanteraReal' } },
              },
            },
          }),
          { status: 200 }
        );
      }
      if (u.includes('music.youtube.com/youtubei/v1/browse')) {
        return new Response(
          JSON.stringify({
            header: {
              musicImmersiveHeaderRenderer: {
                monthlyListenerCount: { runs: [{ text: '2,59 M usuarios mensuales' }] },
              },
            },
            contents: {
              singleColumnBrowseResultsRenderer: {
                tabs: [
                  {
                    tabRenderer: {
                      content: {
                        sectionListRenderer: {
                          contents: [
                            {
                              musicCarouselShelfRenderer: {
                                header: {
                                  musicCarouselShelfBasicHeaderRenderer: {
                                    title: { runs: [{ text: 'Álbumes' }] },
                                  },
                                },
                                contents: [
                                  { musicTwoRowItemRenderer: { title: { runs: [{ text: 'FILIPENSES' }] } } },
                                  { musicTwoRowItemRenderer: { title: { runs: [{ text: 'UNA SEMANA INCREÍBLE' }] } } },
                                ],
                              },
                            },
                            {
                              musicCarouselShelfRenderer: {
                                header: {
                                  musicCarouselShelfBasicHeaderRenderer: {
                                    title: { runs: [{ text: 'Singles y EPs' }] },
                                  },
                                },
                                contents: [
                                  { musicTwoRowItemRenderer: { title: { runs: [{ text: 'STONE BOY EUROPA' }] } } },
                                  { musicTwoRowItemRenderer: { title: { runs: [{ text: 'TONY STARK' }] } } },
                                ],
                              },
                            },
                          ],
                        },
                      },
                    },
                  },
                ],
              },
            },
          }),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    }) as typeof fetch;

    const catalog = new DeezerCatalog(mockFetch);
    const detail = await catalog.artist('7524936');

    expect(detail.albums.map((a) => a.title)).toEqual(['FILIPENSES', 'UNA SEMANA INCREÍBLE']);
    expect(detail.singles.map((s) => s.title)).toEqual(['TONY STARK', 'STONE BOY EUROPA']);
  });

  it('fetches structured track credits via DeezerCatalog and /api/credits/:id endpoint', async () => {
    const mockFetch = (async (url: string | URL | Request) => {
      const u = String(url);
      if (u.includes('api.deezer.com/track/9911')) {
        return new Response(
          JSON.stringify({
            id: 9911,
            title: 'Luna de Tenerife',
            isrc: 'ES1232600001',
            bpm: 124,
            release_date: '2026-04-12',
            explicit_lyrics: true,
            artist: { id: 42, name: 'Quevedo' },
            contributors: [
              { id: 42, name: 'Quevedo', role: 'Main' },
              { id: 77, name: 'Linton', role: 'Featured' },
            ],
            album: { id: 881, title: 'Noches Atlánticas' },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      if (u.includes('api.deezer.com/album/881')) {
        return new Response(
          JSON.stringify({
            id: 881,
            title: 'Noches Atlánticas',
            label: 'Rimas / DQE',
            release_date: '2026-04-12',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      if (u.includes('musicbrainz.org/ws/2/recording?query=isrc:ES1232600001')) {
        return new Response(JSON.stringify({ recordings: [{ id: 'mb-rec-1' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (u.includes('musicbrainz.org/ws/2/recording/mb-rec-1')) {
        return new Response(
          JSON.stringify({
            relations: [
              { type: 'composer', artist: { name: 'Pedro Domínguez Quevedo' } },
              { type: 'producer', artist: { name: 'Linton Beats' } },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      return new Response(JSON.stringify({}), { status: 404 });
    }) as typeof fetch;

    const catalog = new DeezerCatalog(mockFetch);
    const credits = await catalog.trackCredits('dz:9911');
    expect(credits).not.toBeNull();
    expect(credits?.performers.map((p) => p.name)).toEqual(['Quevedo', 'Linton']);
    expect(credits?.performers[0]?.role).toBe('Artista principal');
    expect(credits?.performers[1]?.role).toBe('Artista invitado');
    expect(credits?.writers).toEqual(['Pedro Domínguez Quevedo']);
    expect(credits?.producers).toEqual(['Linton Beats']);
    expect(credits?.label).toBe('Rimas / DQE');
    expect(credits?.isrc).toBe('ES1232600001');
    expect(credits?.bpm).toBe(124);

    // Verify /api/credits/:id handler route responds cleanly
    const handler = createPMusicApiHandler({ fetchFn: mockFetch });
    let statusCode = 0;
    let bodyText = '';
    const mockRes: any = {
      statusCode: 200,
      headers: new Map<string, string>(),
      setHeader(k: string, v: string) {
        this.headers.set(k.toLowerCase(), String(v));
      },
      end(chunk?: Uint8Array | string) {
        statusCode = this.statusCode;
        bodyText = chunk ? Buffer.from(chunk).toString('utf-8') : '';
      },
    };
    const handled = await handler(
      { url: '/api/credits/cc_me_muevo_01?title=Me+Muevo+Con+Dios&artist=Cruz+Cafune', method: 'GET', headers: {} } as any,
      mockRes
    );
    expect(handled).toBe(true);
    expect(statusCode).toBe(200);
    expect(JSON.parse(bodyText)).toHaveProperty('credits');
  });

  it('parses full DDEX producer/composer/lyricist/engineer credits from YouTube auto-generated descriptions and sanitizes empty artist placeholders', async () => {
    const sampleDesc = [
      'Provided to YouTube by La Pantera',
      '',
      'SHARINGAN · La Pantera',
      '',
      'FILIPENSES',
      '',
      '℗ 2026 Bdp Music',
      '',
      'Released on: 2026-03-19',
      '',
      'Producer: Pana YMB',
      'Producer: TyMaz',
      'Producer: Johanmobu',
      'Masterer: The Mars Citizen',
      'Mixer: The Mars Citizen',
      'Composer: Sergio Aimar Castellano Almeida',
      'Lyricist: Sergio Aimar Castellano Almeida',
      '',
      'Auto-generated by YouTube.',
    ].join('\n');

    const parsed = parseYouTubeDescriptionCredits(sampleDesc);
    expect(parsed.distributor).toBe('La Pantera');
    expect(parsed.label).toBe('Bdp Music');
    expect(parsed.releaseDate).toBe('2026-03-19');
    expect(parsed.producers).toEqual(['Pana YMB', 'TyMaz', 'Johanmobu']);
    expect(parsed.composers).toEqual(['Sergio Aimar Castellano Almeida']);
    expect(parsed.lyricists).toEqual(['Sergio Aimar Castellano Almeida']);
    expect(parsed.engineers).toEqual([
      'The Mars Citizen (Masterer)',
      'The Mars Citizen (Mixer)',
    ]);

    expect(sanitizeArtistImageUrl('https://e-cdns-images.dzcdn.net/images/artist//500x500.jpg')).toBe('');
    expect(sanitizeArtistImageUrl('https://e-cdns-images.dzcdn.net/images/artist/d41d8cd98f00b204e9800998ecf8427e/500x500.jpg')).toBe('');
    expect(sanitizeArtistImageUrl('https://yt3.googleusercontent.com/abc=w1440-h600')).toBe(
      'https://yt3.googleusercontent.com/abc=w1440-h600'
    );

    const mockFetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      if (u.includes('music.youtube.com/youtubei/v1/search')) {
        return new Response(
          JSON.stringify({
            contents: {
              musicResponsiveListItemRenderer: {
                playlistItemData: { videoId: 'ExX--k9PqxY' },
                flexColumns: [
                  { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'SHARINGAN' }] } } },
                  { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'La Pantera' }] } } },
                ],
              },
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      if (u.includes('youtube.com/youtubei/v1/player')) {
        expect(init?.method).toBe('POST');
        return new Response(
          JSON.stringify({
            videoDetails: { shortDescription: sampleDesc },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      return new Response(JSON.stringify({}), { status: 404 });
    }) as typeof fetch;

    const catalog = new DeezerCatalog(mockFetch);
    const ytMerged = await catalog.trackCredits('yt_sharingan', {
      title: 'SHARINGAN',
      artist: 'La Pantera',
    });
    expect(ytMerged?.producers).toEqual(['Pana YMB', 'TyMaz', 'Johanmobu']);
    expect(ytMerged?.composers).toEqual(['Sergio Aimar Castellano Almeida']);
    expect(ytMerged?.lyricists).toEqual(['Sergio Aimar Castellano Almeida']);
    expect(ytMerged?.label).toBe('Bdp Music');
    expect(ytMerged?.distributor).toBe('La Pantera');
  });

  it('canonicalizes Cruz Cafuné -> Cruzzi (ID 73148212), picks the 1.07M YTM channel over 1-subscriber homonyms, and extracts Spotify portraits', async () => {
    expect(canonicalizeArtistIdentity('10125390', 'Cruz Cafuné')).toEqual({
      id: '73148212',
      name: 'Cruzzi',
    });
    expect(parseYtmAudienceCount('Artista • 1,07 M usuarios mensuales')).toBe(1_070_000);
    expect(parseYtmAudienceCount('Artista • 1 suscriptor')).toBe(1);

    const mockFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const u = String(input);
      if (u.endsWith('/artist/73148212')) {
        return new Response(
          JSON.stringify({ id: 73148212, name: 'Cruzzi', nb_fan: 448, picture_xl: 'https://dz/cruzzi.jpg' }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      if (u.includes('/artist/73148212/top')) {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: 2288414347,
                title: 'Folelé',
                duration: 228,
                artist: { id: 73148212, name: 'Cruzzi' },
                album: { id: 442746907, title: 'Me Muevo Con Dios', cover_big: 'https://dz/mmd.jpg' },
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      if (u.includes('/artist/10125390/top')) {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: 3320658521,
                title: 'DEVIL JIN',
                duration: 195,
                artist: { id: 10125390, name: 'Cruz Cafuné' },
                album: { id: 741049531, title: 'DEVIL JIN', cover_big: 'https://dz/dj.jpg' },
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      if (u.includes('/artist/73148212/albums')) {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: 442746907,
                title: 'Me Muevo Con Dios',
                record_type: 'album',
                release_date: '2023-05-25',
                fans: 5000,
                cover_big: 'https://dz/mmd.jpg',
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      if (u.includes('/artist/10125390/albums')) {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: 741049531,
                title: 'DEVIL JIN',
                record_type: 'single',
                release_date: '2025-04-22',
                fans: 2000,
                cover_big: 'https://dz/dj.jpg',
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      if (u.includes('/artist/73148212/') || u.includes('/artist/10125390/')) {
        return new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (u.includes('music.youtube.com/youtubei/v1/search')) {
        return new Response(
          JSON.stringify({
            contents: [
              {
                musicResponsiveListItemRenderer: {
                  flexColumns: [
                    { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'Cruzzi' }] } } },
                    { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'Artista • 1 suscriptor' }] } } },
                  ],
                  navigationEndpoint: { browseEndpoint: { browseId: 'UCrandom1sub' } },
                },
              },
              {
                musicResponsiveListItemRenderer: {
                  flexColumns: [
                    { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'Cruzzi' }] } } },
                    { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'Artista • 1,07 M usuarios mensuales' }] } } },
                  ],
                  navigationEndpoint: { browseEndpoint: { browseId: 'UCrealCruzzi' } },
                },
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      if (u.includes('music.youtube.com/youtubei/v1/browse')) {
        const body = String(init?.body ?? '');
        if (body.includes('UCrandom1sub')) {
          return new Response(
            JSON.stringify({
              header: {
                musicImmersiveHeaderRenderer: {
                  subscriptionButton: {
                    subscribeButtonRenderer: { longSubscriberCountText: { runs: [{ text: '1 suscriptor' }] } },
                  },
                },
              },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } }
          );
        }
        return new Response(
          JSON.stringify({
            header: {
              musicImmersiveHeaderRenderer: {
                thumbnail: {
                  musicThumbnailRenderer: {
                    thumbnail: {
                      thumbnails: [{ url: 'https://yt3.googleusercontent.com/cruzzi_real=w1440-h600-l90-rj', width: 1440, height: 600 }],
                    },
                  },
                },
                monthlyListenerCount: { runs: [{ text: '1,07 M usuarios mensuales' }] },
              },
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      if (u.includes('musicbrainz.org/ws/2/artist?query=')) {
        return new Response(JSON.stringify({ artists: [{ id: 'mb-cruzzi', name: 'Cruzzi' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (u.includes('musicbrainz.org/ws/2/artist/mb-cruzzi')) {
        return new Response(
          JSON.stringify({
            relations: [{ url: { resource: 'https://open.spotify.com/artist/0jeYkqwckGJoHQhhXwgzk3' } }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      if (u.includes('open.spotify.com/artist/0jeYkqwckGJoHQhhXwgzk3')) {
        return new Response(
          '<html><head><meta property="og:image" content="https://i.scdn.co/image/ab6761610000e5eb9f52199eefb0ccb6f69afe2c"></head></html>',
          { status: 200, headers: { 'content-type': 'text/html' } }
        );
      }
      return new Response(JSON.stringify({ data: [] }), { status: 404 });
    }) as typeof fetch;

    const catalog = new DeezerCatalog(mockFetch);
    const detail = await catalog.artist('10125390');
    expect(detail.artist.id).toBe('73148212');
    expect(detail.artist.name).toBe('Cruzzi');
    expect(detail.artist.subscribersText).toBe('1,07 M usuarios mensuales');
    expect(detail.artist.thumbnailUrl).toBe(
      'https://yt3.googleusercontent.com/cruzzi_real=w1440-h600-p-l90-rj'
    );
    expect(detail.bannerUrl).toBe(
      'https://yt3.googleusercontent.com/cruzzi_real=w1440-h600-p-l90-rj'
    );
    expect(detail.topSongs.map((t) => t.title)).toEqual(['Folelé', 'DEVIL JIN']);
    expect(detail.topSongs[1]?.artists[0]).toEqual({ id: '73148212', name: 'Cruzzi' });
    expect(detail.albums.map((a) => a.title)).toContain('Me Muevo Con Dios');
    expect((detail.singles ?? []).map((s) => s.title)).toContain('DEVIL JIN');

    const fb = getFallbackArtistDetail('73148212');
    expect(fb.artist.name).toBe('Cruzzi');
    expect(fb.singles ?? []).toEqual([]);
  });

  it('resolves Wikidata P1902 Spotify oEmbed HD portraits with homonym guard and Apple Music fallback helpers', async () => {
    const mockFetch = (async (input: RequestInfo | URL) => {
      const u = String(input);
      if (u.includes('wikidata.org/w/api.php') && u.includes('action=wbsearchentities')) {
        return new Response(
          JSON.stringify({ search: [{ id: 'QwrongPantera' }, { id: 'QrealLaPantera' }] }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      if (u.includes('wikidata.org/w/api.php') && u.includes('action=wbgetentities')) {
        return new Response(
          JSON.stringify({
            entities: {
              QwrongPantera: {
                labels: { en: { value: 'Pantera' } },
                claims: { P1902: [{ mainsnak: { datavalue: { value: '14pVkFUHDL207LzLHtSA18' } } }] },
              },
              QrealLaPantera: {
                labels: { es: { value: 'La Pantera' } },
                claims: { P1902: [{ mainsnak: { datavalue: { value: '0IEzMvarfVycBJAXjjEZOL' } } }] },
              },
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      if (u.includes('open.spotify.com/oembed') && u.includes('0IEzMvarfVycBJAXjjEZOL')) {
        return new Response(
          JSON.stringify({
            title: 'La Pantera',
            thumbnail_url: 'https://image-cdn-fa.spotifycdn.com/image/ab676161000051740445559a074ca4ac92c4434f',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      if (u.includes('itunes.apple.com/search')) {
        return new Response(
          JSON.stringify({
            results: [
              { artistName: 'JC Reyes', artistLinkUrl: 'https://music.apple.com/es/artist/jc-reyes/12345' },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      if (u.includes('music.apple.com/es/artist/jc-reyes/12345')) {
        return new Response(
          '<html><head><meta property="og:image" content="https://is1-ssl.mzstatic.com/image/thumb/Features211/v4/fd/9b/d1/mza_8866.jpg/1200x630cw.png"></head></html>',
          { status: 200, headers: { 'content-type': 'text/html' } }
        );
      }
      if (u.includes('/search/artist')) {
        return new Response(
          JSON.stringify({
            data: [{ id: 7524936, name: 'La Pantera', nb_fan: 500000, picture_big: 'https://dz/old.jpg' }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      if (u.includes('/search/')) {
        return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify({ data: [] }), { status: 404 });
    }) as typeof fetch;

    const catalog = new DeezerCatalog(mockFetch);
    const spPortrait = await catalog.fetchSpotifyArtistAvatar('La Pantera');
    expect(spPortrait).toBe('https://i.scdn.co/image/ab6761610000e5eb0445559a074ca4ac92c4434f');

    const bundle = await catalog.search('La Pantera', 'artist');
    expect(bundle.artists[0]?.thumbnailUrl).toBe('https://dz/old.jpg');

    const appleVisuals = await catalog.fetchAppleMusicArtistVisuals('JC Reyes');
    expect(appleVisuals).toEqual({
      avatarUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Features211/v4/fd/9b/d1/mza_8866.jpg/800x800cc.webp',
      bannerUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Features211/v4/fd/9b/d1/mza_8866.jpg/1200x1200bb.jpg',
    });

    expect(searchFallbackCatalog('superestrella').artists).toEqual([]);
  });

  it('parses LaHiguera novedades, Spotify editorial embed releases, and prefers newer track release_date over older deluxe album dates', async () => {
    const lhHtml = `
      <article>
        <img src="https://www.lahiguera.net/musicalia/artistas/quevedo/disco/15600/portada-p.jpg">
        <div class=cont><div class=fecha>21/11/2026</div>
        <h3><a href="https://www.lahiguera.net/musicalia/artistas/quevedo/disco/15600">Quevedo: EL BAIFO &amp; SOY MEJOR</a></h3>
        <div class=intro>Nuevo lanzamiento urbano</div></div>
      </article>
      <article>
        <div class=cont><div class=fecha>25/11/2026</div>
        <h3><a href="#">Stray Kids: SUIATSU</a></h3>
        <div class=intro>EP de siete pistas</div></div>
      </article>
    `;
    const parsedLh = parseLaHigueraNovedadesHtml(lhHtml, 'novedades');
    expect(parsedLh).toHaveLength(2);
    expect(parsedLh[0]).toMatchObject({
      title: 'EL BAIFO & SOY MEJOR',
      artists: ['Quevedo'],
      releaseDate: '2026-11-21',
      kind: 'album',
      source: 'lahiguera_novedades',
    });
    expect(parsedLh[1]?.kind).toBe('ep');
    expect(parsedLh[1]?.releaseDate).toBe('2026-11-25');

    const spEmbedHtml = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
      props: {
        pageProps: {
          state: {
            data: {
              entity: {
                name: 'Novedades Viernes España',
                trackList: [
                  {
                    title: 'SOY MEJOR 2.0',
                    subtitle: 'Kristina,\u00A0Quevedo,\u00A0Came Beats',
                  },
                ],
              },
            },
          },
        },
      },
    })}</script>`;
    const parsedSp = parseSpotifyEmbedPlaylistHtml(
      spEmbedHtml,
      'spotify_novedades_es',
      '2026-11-20'
    );
    expect(parsedSp).toEqual([
      {
        title: 'SOY MEJOR 2.0',
        artists: ['Kristina', 'Quevedo', 'Came Beats'],
        releaseDate: '2026-11-20',
        kind: 'track',
        source: 'spotify_novedades_es',
        priority: 95,
      },
    ]);

    const catalog = new DeezerCatalog();
    const mappedDeluxeTrack = catalog.mapTrack({
      id: 4396919801,
      title: 'LAMINE YAMAL (feat. La Pantera)',
      title_short: 'LAMINE YAMAL (feat. La Pantera)',
      duration: 165,
      release_date: '2026-11-06',
      artist: { id: 50619722, name: 'Nemzzz' },
      contributors: [
        { id: 50619722, name: 'Nemzzz' },
        { id: 7524936, name: 'La Pantera' },
      ],
      album: {
        id: 8888,
        title: 'LOCKED IN (EUROLUXE)',
        release_date: '2026-09-04',
        cover_medium: 'https://example.com/lamine.jpg',
      },
    });
    expect(mappedDeluxeTrack.releaseDate).toBe('2026-11-06');
    expect(mappedDeluxeTrack.releaseYear).toBe(2026);
  });

  it('serves parsed external releases on GET /api/release-radar', async () => {
    const mockFetch = (async (input: RequestInfo | URL) => {
      const u = String(input);
      if (u.includes('open.spotify.com/embed/playlist/37i9dQZF1DX6PYajiT4pAf')) {
        return new Response(
          `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
            props: {
              pageProps: {
                state: {
                  data: {
                    entity: {
                      trackList: [{ title: 'Tremendo Desastre', subtitle: 'Myke Towers,\u00A0Rauw Alejandro' }],
                    },
                  },
                },
              },
            },
          })}</script>`,
          { status: 200, headers: { 'content-type': 'text/html' } }
        );
      }
      if (u.includes('lahiguera.net/musicalia/novedades.php')) {
        return new Response(
          `<article><div class=cont><div class=fecha>25/11/2026</div><h3><a href="#">Mvrk: Nueva Ola</a></h3><div class=intro>Álbum</div></div></article>`,
          { status: 200, headers: { 'content-type': 'text/html' } }
        );
      }
      return new Response('', { status: 404 });
    }) as typeof fetch;

    const handler = createPMusicApiHandler({ fetchFn: mockFetch });
    let statusCode = 0;
    let bodyText = '';
    const fakeRes = {
      statusCode: 200,
      setHeader: () => {},
      end: (chunk?: unknown) => {
        statusCode = fakeRes.statusCode;
        bodyText =
          chunk instanceof Uint8Array
            ? Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength).toString('utf-8')
            : String(chunk ?? '');
      },
    } as any;

    const handled = await handler(
      { url: '/api/release-radar', method: 'GET', headers: {} } as any,
      fakeRes
    );
    expect(handled).toBe(true);
    expect(statusCode).toBe(200);
    const payload = JSON.parse(bodyText) as {
      releases: Array<{ title: string; artists: string[]; source: string }>;
    };
    expect(payload.releases.some((r) => r.title === 'Tremendo Desastre' && r.source === 'spotify_novedades_es')).toBe(
      true
    );
  });

  it('retries once when Deezer returns error code 4 (Quota limit exceeded) and falls back cleanly on /api/import/spotify', async () => {
    let calls = 0;
    const quotaFetch = (async () => {
      calls++;
      if (calls === 1) {
        return new Response(JSON.stringify({ error: { type: 'Exception', message: 'Quota limit exceeded', code: 4 } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(
        JSON.stringify({
          data: [
            {
              id: 4428059631,
              title: 'SOY MEJOR 2.0',
              duration: 198,
              artist: { id: 1, name: 'Kristina' },
              contributors: [
                { id: 1, name: 'Kristina' },
                { id: 6705223, name: 'Quevedo' },
              ],
              album: { id: 888, title: 'SOY MEJOR 2.0', release_date: '2026-11-21', cover_medium: 'https://x.com/c.jpg' },
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }) as typeof fetch;

    const catalog = new DeezerCatalog(quotaFetch);
    const searchRes = await catalog.search('Quevedo SOY MEJOR 2.0', 'song');
    expect(calls).toBeGreaterThanOrEqual(2);
    expect(searchRes.songs.some((s) => s.title === 'SOY MEJOR 2.0')).toBe(true);

    // HttpProxyMusicProvider OTA fallback when /api/release-radar returns 404 (old Electron host)
    const proxyFetch = (async (input: RequestInfo | URL) => {
      const u = String(input);
      if (u.endsWith('/api/release-radar')) {
        return new Response('{"error":"not_found"}', { status: 404 });
      }
      if (u.includes('/api/import/spotify') && u.includes('37i9dQZF1DX6PYajiT4pAf')) {
        return new Response(
          JSON.stringify({
            name: 'Novedades Viernes España',
            tracks: [{ title: 'Tremendo Desastre', artists: ['Myke Towers', 'Rauw Alejandro'] }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      return new Response(JSON.stringify({ name: 'PEGAO', tracks: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    const proxy = new HttpProxyMusicProvider({ fetchFn: proxyFetch, baseUrl: 'http://127.0.0.1:47820' });
    const radar = await proxy.getReleaseRadar();
    expect(radar.some((r) => r.title === 'Tremendo Desastre' && r.source === 'spotify_novedades_es')).toBe(true);
  });

  it('falls back on Android mobileDirect to Vercel /api/release-radar and Deezer /api/dz-proxy playlists when /api/radar-proxy is unavailable', async () => {
    const origWindow = (globalThis as any).window;
    (globalThis as any).window = {
      location: { hostname: 'appassets.pmusic.local', origin: 'https://appassets.pmusic.local' },
    };
    try {
      const vercelFetch = (async (input: RequestInfo | URL) => {
        const u = String(input);
        if (u.includes('/api/radar-proxy')) {
          return new Response('', { status: 404 });
        }
        if (u.includes('pmusic-olive.vercel.app/api/release-radar')) {
          return new Response(
            JSON.stringify({
              releases: [
                {
                  title: 'SOY MEJOR 2.0',
                  artists: ['Kristina', 'Quevedo'],
                  releaseDate: '2026-11-20',
                  kind: 'track',
                  source: 'spotify_novedades_es',
                  priority: 95,
                },
              ],
            }),
            { status: 200, headers: { 'content-type': 'application/json' } }
          );
        }
        return new Response('{}', { status: 404 });
      }) as typeof fetch;

      const mobileProvider = new HttpProxyMusicProvider({ fetchFn: vercelFetch });
      const radarFromVercel = await mobileProvider.getReleaseRadar();
      expect(radarFromVercel.some((r) => r.title === 'SOY MEJOR 2.0')).toBe(true);

      const dzPlaylistFetch = (async (input: RequestInfo | URL) => {
        const u = String(input);
        if (u.includes('/api/radar-proxy') || u.includes('pmusic-olive.vercel.app')) {
          return new Response('', { status: 502 });
        }
        if (u.includes('/api/dz-proxy') && u.includes('search%2Fplaylist')) {
          return new Response(JSON.stringify({ data: [{ id: 15987808083 }] }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        if (u.includes('/api/dz-proxy') && u.includes('playlist%2F15987808083')) {
          return new Response(
            JSON.stringify({
              data: [
                {
                  id: 4437886881,
                  title: 'GRACIAS X TODO',
                  artist: { name: 'Feid' },
                  release_date: '2026-11-26',
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

      const mobileDzProvider = new HttpProxyMusicProvider({ fetchFn: dzPlaylistFetch });
      const radarFromDz = await mobileDzProvider.getReleaseRadar();
      expect(radarFromDz.some((r) => r.title === 'GRACIAS X TODO' && r.releaseDate === '2026-11-26')).toBe(
        true
      );
      expect(radarFromDz.find((r) => r.title === 'GRACIAS X TODO')?.track?.id).toBe('dz_4437886881');

      // Also verify mobileDirect calls Vercel /api/lyrics for lyrics fallback
      const mobileLyricsFetch = (async (input: RequestInfo | URL) => {
        const u = String(input);
        if (u.includes('pmusic-olive.vercel.app/api/lyrics')) {
          return new Response(
            JSON.stringify({ plainLyrics: 'No hallé otro sitio pa vivirla que en Las Palmas', source: 'letras' }),
            { status: 200, headers: { 'content-type': 'application/json' } }
          );
        }
        return new Response('{}', { status: 404 });
      }) as typeof fetch;
      const mobileLyricsProv = new HttpProxyMusicProvider({ fetchFn: mobileLyricsFetch });
      const mobLyr = await mobileLyricsProv.getMusixmatchLyrics('Lugares Comunes', 'SFDK');
      expect(mobLyr?.plainLyrics).toContain('Las Palmas');
    } finally {
      (globalThis as any).window = origWindow;
    }
  });

  it('rejects Musixmatch honeypot tokens, cascades to Letras.com plain lyrics, and matches stripped/multi-artist LRCLIB entries', async () => {
    const mxmHoneypotFetch = (async (input: RequestInfo | URL) => {
      const u = String(input);
      if (u.includes('apic-desktop.musixmatch.com/ws/1.1/token.get')) {
        return new Response(
          JSON.stringify({
            message: { header: { status_code: 200 }, body: { user_token: '00000000000000000000' } },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      if (u.includes('letras.com/sfdk/lugares-comunes')) {
        return new Response(
          '<div class="lyric-original"><p>No hallé otro sitio<br>que me llene el alma de verdad</p></div>',
          { status: 200, headers: { 'content-type': 'text/html' } }
        );
      }
      return new Response('', { status: 404 });
    }) as typeof fetch;

    const apiHandler = createPMusicApiHandler({ fetchFn: mxmHoneypotFetch });
    let capturedBody = '';
    const mockRes = {
      statusCode: 200,
      setHeader: () => {},
      end: (chunk: Uint8Array | string) => {
        capturedBody = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
      },
    } as any;
    await apiHandler({ url: '/api/lyrics/musixmatch?title=Lugares+Comunes&artist=SFDK', method: 'GET', headers: {} } as any, mockRes);
    const parsedMxm = JSON.parse(capturedBody);
    expect(parsedMxm.plainLyrics).toContain('No hallé otro sitio');

    const lrcFetch = (async (input: RequestInfo | URL) => {
      const u = String(input);
      if (u.includes('/api/get')) return new Response('', { status: 404 });
      if (u.includes('/api/search?q=')) {
        return new Response(
          JSON.stringify([
            {
              id: 777,
              trackName: 'SOY MEJOR 2.0 (Videoclip Oficial)',
              artistName: 'Kristina',
              duration: 198,
              plainLyrics: 'Soy mejor desde que te fuiste de aqui',
            },
          ]),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;

    const lrcProvider = new LrclibLyricsProvider({ fetchFn: lrcFetch });
    const lrcDoc = await lrcProvider.getLyrics({
      trackId: 'tr-soy-mejor',
      title: 'SOY MEJOR 2.0',
      artist: 'Kristina, Quevedo',
    });
    expect(lrcDoc.status).toBe('plain');
    expect(lrcDoc.plainLines[0]).toContain('Soy mejor');
  });

  it('ranks audio formats strictly by quality tier (Opus 48 kHz #1 in high, AAC 128k in medium, Opus 48-64k in low) and exposes CORS stream quality headers', async () => {
    const progressive = [{ itag: 18, mime_type: 'video/mp4; codecs="avc1.42001E, mp4a.40.2"', bitrate: 444_000, audio_sample_rate: 44100 }];
    const adaptive = [
      { itag: 139, mime_type: 'audio/mp4; codecs="mp4a.40.5"', bitrate: 50_000, average_bitrate: 48_800, audio_sample_rate: 22050 },
      { itag: 140, mime_type: 'audio/mp4; codecs="mp4a.40.2"', bitrate: 130_757, average_bitrate: 129_487, audio_sample_rate: 44100 },
      { itag: 249, mime_type: 'audio/webm; codecs="opus"', bitrate: 61_709, average_bitrate: 56_231, audio_sample_rate: 48000 },
      { itag: 250, mime_type: 'audio/webm; codecs="opus"', bitrate: 80_644, average_bitrate: 73_708, audio_sample_rate: 48000 },
      { itag: 251, mime_type: 'audio/webm; codecs="opus"', bitrate: 156_848, average_bitrate: 144_322, audio_sample_rate: 48000 },
    ];

    const highRanked = rankStreamFormatsForQuality(progressive, adaptive, 'high');
    expect(highRanked.map((f) => f.itag)).toEqual([251, 140, 250, 249, 139, 18]);

    const medRanked = rankStreamFormatsForQuality(progressive, adaptive, 'medium');
    expect(medRanked[0]?.itag).toBe(140);
    expect(medRanked[1]?.itag).toBe(251);
    expect(medRanked.indexOf(progressive[0]!)).toBeLessThan(medRanked.findIndex((f) => f.itag === 139));

    const lowRanked = rankStreamFormatsForQuality(progressive, adaptive, 'low');
    expect(lowRanked[0]?.itag).toBe(139);
    expect(lowRanked[1]?.itag).toBe(249);
    expect(lowRanked[lowRanked.length - 1]?.itag).toBe(18);

    // 3G/EDGE mode prioritizes ultra-compact ~32-56 kbps streams (itag 599/600/249) first
    const lowWithUltraCompact = rankStreamFormatsForQuality(progressive, [
      ...adaptive,
      { itag: 599, mime_type: 'audio/mp4; codecs="mp4a.40.5"', bitrate: 32_250, average_bitrate: 30_813, audio_sample_rate: 22050 },
      { itag: 600, mime_type: 'audio/webm; codecs="opus"', bitrate: 33_774, average_bitrate: 31_247, audio_sample_rate: 48000 },
    ], 'low');
    expect([599, 600]).toContain(lowWithUltraCompact[0]?.itag);

    // Verify OPTIONS CORS exposes quality/codec/bitrate/sampleRate headers
    const apiHandler = createPMusicApiHandler();
    const headersMap: Record<string, string> = {};
    const mockRes = {
      statusCode: 0,
      setHeader: (k: string, v: string) => {
        headersMap[k.toLowerCase()] = String(v);
      },
      end: () => {},
    } as any;
    await apiHandler({ url: '/api/stream/test123?quality=high', method: 'OPTIONS', headers: {} } as any, mockRes);
    const exposed = headersMap['access-control-expose-headers'] ?? '';
    expect(exposed).toContain('X-PMusic-Stream-Quality');
    expect(exposed).toContain('X-PMusic-Stream-Codec');
    expect(exposed).toContain('X-PMusic-Stream-Bitrate');
    expect(exposed).toContain('X-PMusic-Stream-SampleRate');
  });

  it('strictly filters Release Radar to verified <= 15 day releases and drops old playlist tracks like LA VILLA (2025-10-23)', async () => {
    const now = new Date(2026, 10, 27, 12, 0, 0);
    const handler = createPMusicApiHandler({
      fetchFn: (async (input: RequestInfo | URL) => {
        const u = String(input);
        if (u.includes('api.deezer.com/search/playlist')) {
          return new Response(JSON.stringify({ data: [{ id: 15987808083, title: 'Novedades Viernes España 27/11/26' }] }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        if (u.includes('api.deezer.com/playlist/15987808083/tracks')) {
          return new Response(
            JSON.stringify({
              data: [
                {
                  id: 3613707422,
                  title: 'LA VILLA',
                  duration: 193,
                  artist: { id: 1, name: 'Ryan Castro' },
                  album: { id: 841932862, title: 'LA VILLA', cover_medium: 'https://cdn-images.dzcdn.net/images/cover/a/250x250-000000-80-0-0.jpg' },
                },
                {
                  id: 4437886881,
                  title: 'ESTRENO REAL',
                  duration: 185,
                  artist: { id: 2, name: 'Quevedo' },
                  album: { id: 999001, title: 'ESTRENO REAL', cover_medium: 'https://cdn-images.dzcdn.net/images/cover/b/250x250-000000-80-0-0.jpg' },
                },
              ],
            }),
            { status: 200, headers: { 'content-type': 'application/json' } }
          );
        }
        if (u.includes('api.deezer.com/album/841932862')) {
          return new Response(JSON.stringify({ id: 841932862, release_date: '2025-10-23' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        if (u.includes('api.deezer.com/album/999001')) {
          return new Response(JSON.stringify({ id: 999001, release_date: '2026-11-26' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        if (u.includes('open.spotify.com/embed/playlist/')) {
          return new Response(
            `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
              props: { pageProps: { state: { data: { entity: { trackList: [{ title: 'Pista Sin Fecha', subtitle: 'Artista X' }] } } } } },
            })}</script>`,
            { status: 200, headers: { 'content-type': 'text/html' } }
          );
        }
        return new Response(JSON.stringify({ data: [], feed: { results: [] } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }) as typeof fetch,
    });

    let bodyText = '';
    await handler(
      { url: '/api/release-radar', method: 'GET', headers: {} } as any,
      {
        statusCode: 200,
        setHeader: () => {},
        end: (chunk?: unknown) => {
          bodyText =
            chunk instanceof Uint8Array
              ? Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength).toString('utf-8')
              : String(chunk ?? '');
        },
      } as any
    );
    const parsed = JSON.parse(bodyText) as {
      releases: Array<{ title: string; releaseDate?: string; track?: { releaseDate?: string } }>;
    };
    expect(now.getFullYear()).toBe(2026);
    expect(parsed.releases.some((r) => r.title === 'LA VILLA')).toBe(false);
    expect(parsed.releases.some((r) => r.title === 'ESTRENO REAL' && r.releaseDate === '2026-11-26')).toBe(true);
    const spotifyHint = parsed.releases.find((r) => r.title === 'Pista Sin Fecha');
    expect(spotifyHint?.releaseDate).toBeUndefined();
  });

  it('paginates Spotify Pathfinder playlists beyond 100 tracks, preserves multi-artists on match, and parses Exportify CSV', async () => {
    const htmlWithToken = `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
      props: {
        pageProps: {
          state: {
            settings: { session: { accessToken: 'BQD_test_spotify_token_1234567890' } },
          },
        },
      },
    })}</script></body></html>`;
    expect(extractSpotifyEmbedAccessToken(htmlWithToken)).toBe('BQD_test_spotify_token_1234567890');

    const mockFetch = (async (input: string | URL | Request) => {
      const url = String(input);
      const offsetMatch = url.match(/offset%22%3A(\d+)/i);
      const offset = offsetMatch ? Number(offsetMatch[1]) : 0;
      const items = Array.from({ length: offset === 0 ? 100 : 45 }, (_, idx) => {
        const num = offset + idx + 1;
        return {
          uid: `u_${num}`,
          itemV2: {
            data: {
              __typename: 'Track',
              uri: `spotify:track:${num}`,
              name: num === 1 ? 'PERRO NEGRO' : `Canción ${num}`,
              trackDuration: { totalMilliseconds: 162000 },
              artists: {
                items:
                  num === 1
                    ? [{ profile: { name: 'Bad Bunny' } }, { profile: { name: 'Feid' } }]
                    : [{ profile: { name: 'La Pantera' } }],
              },
            },
          },
        };
      });
      return new Response(
        JSON.stringify({
          data: {
            playlistV2: {
              name: 'Mega Trap 145',
              ownerV2: { data: { name: 'Pablo' } },
              content: { totalCount: 145, items },
            },
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }) as typeof fetch;

    const pf = await fetchSpotifyPathfinderPlaylist(
      '37i9dQZF1DX123456',
      'BQD_test_spotify_token_1234567890',
      { maxTracks: 500, fetchFn: mockFetch }
    );
    expect(pf).not.toBeNull();
    expect(pf!.tracks).toHaveLength(145);
    expect(pf!.truncated).toBe(false);
    expect(pf!.tracks[0]!.artists).toEqual(['Bad Bunny', 'Feid']);

    const merged = mergeMatchedTrackArtists(
      {
        id: 'dz:111',
        title: 'PERRO NEGRO',
        artists: [{ id: 'ar_bb', name: 'Bad Bunny' }],
        durationSec: 162,
        thumbnailUrl: '',
        isExplicit: true,
        source: 'youtube',
      },
      ['Bad Bunny', 'Feid']
    );
    expect(merged.artists.map((a) => a.name)).toEqual(['Bad Bunny', 'Feid']);

    const csvParsed = parsePlaylistCsvOrText(
      'Track Name,Artist Name(s),Track Duration (ms)\n"PERRO NEGRO","Bad Bunny, Feid",162000\n"DOGGY","La Pantera; Quevedo",203000'
    );
    expect(csvParsed).toHaveLength(2);
    expect(csvParsed[0]?.artists).toEqual(['Bad Bunny', 'Feid']);
    expect(csvParsed[1]?.artists).toEqual(['La Pantera', 'Quevedo']);
  });
});
