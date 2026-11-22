import { describe, expect, it } from 'vitest';
import {
  LrcParser,
  LrclibLyricsProvider,
  PlaylistImporter,
  YouTubeMusicProvider,
  parseFeaturedArtistsFromTitle,
  parseSpotifyEmbedHtml,
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
});
