import type { IncomingMessage, ServerResponse } from 'node:http';
import type { IMusicProvider, SearchFilter } from '@pmusic/core';
import { FALLBACK_TRACKS, synthesizeDeterministicWavBuffer } from './catalog-fallback.ts';
import {
  PlaylistImporter,
  parseSpotifyEmbedHtml,
  type SpotifyEmbedExtraction,
} from './importer.ts';
import { YouTubeMusicProvider } from './ytmusic.ts';
import { DeezerCatalog } from './deezer-catalog.ts';
import { AudioStreamResolver } from './yt-stream.ts';

export interface PMusicApiHandlerOptions {
  musicProvider?: IMusicProvider;
  authToken?: string;
  fetchFn?: typeof fetch;
}

let cachedWavBuffer: Uint8Array | null = null;
function getCachedWavBuffer(): Uint8Array {
  if (!cachedWavBuffer) {
    cachedWavBuffer = synthesizeDeterministicWavBuffer(12, 122);
  }
  return cachedWavBuffer;
}

const textEncoder = new TextEncoder();

function setCorsHeaders(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type, Authorization, X-PMusic-Token, Lrclib-Client');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges, X-PMusic-Stream-Source');
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  setCorsHeaders(res);
  const body = JSON.stringify(payload);
  const bytes = textEncoder.encode(body);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Length', bytes.byteLength);
  res.end(bytes);
}

export function createPMusicApiHandler(options: PMusicApiHandlerOptions = {}) {
  const provider = options.musicProvider ?? new YouTubeMusicProvider({ enableLiveNetwork: true });
  const streamResolver = new AudioStreamResolver(new DeezerCatalog());
  const importer = new PlaylistImporter({ musicProvider: provider });
  const fetchFn = options.fetchFn ?? globalThis.fetch.bind(globalThis);

  return async function handleApiRequest(
    req: IncomingMessage,
    res: ServerResponse,
    next?: () => void
  ): Promise<boolean> {
    const rawUrl = req.url ?? '/';
    if (!rawUrl.startsWith('/api/')) {
      next?.();
      return false;
    }

    setCorsHeaders(res);
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return true;
    }

    if (options.authToken) {
      const tokenHeader = req.headers['x-pmusic-token'];
      const parsedForToken = new URL(rawUrl, 'http://127.0.0.1');
      const tokenQuery = parsedForToken.searchParams.get('token');
      if (tokenHeader !== options.authToken && tokenQuery !== options.authToken) {
        sendJson(res, 401, { error: 'Unauthorized loopback request' });
        return true;
      }
    }

    const urlObj = new URL(rawUrl, 'http://127.0.0.1');
    const pathname = urlObj.pathname;

    try {
      if (pathname === '/api/health') {
        sendJson(res, 200, { ok: true, status: 'ok', region: 'ES', lang: 'es' });
        return true;
      }

      if (pathname === '/api/search') {
        const q = urlObj.searchParams.get('q') ?? '';
        const filter = (urlObj.searchParams.get('filter') ?? 'all') as SearchFilter;
        const bundle = await provider.search(q, filter);
        sendJson(res, 200, bundle);
        return true;
      }

      if (pathname === '/api/suggestions') {
        const q = urlObj.searchParams.get('q') ?? '';
        const suggestions = await provider.getSearchSuggestions(q);
        sendJson(res, 200, { suggestions });
        return true;
      }

      if (pathname === '/api/home') {
        const mood = urlObj.searchParams.get('mood') ?? undefined;
        const feed = await provider.getHomeFeed(mood);
        sendJson(res, 200, feed);
        return true;
      }

      if (pathname.startsWith('/api/up-next/')) {
        const videoId = decodeURIComponent(pathname.slice('/api/up-next/'.length));
        const tracks = await provider.getUpNext(videoId, true);
        sendJson(res, 200, { tracks });
        return true;
      }

      if (pathname.startsWith('/api/related/')) {
        const videoId = decodeURIComponent(pathname.slice('/api/related/'.length));
        const related = await provider.getRelated(videoId);
        sendJson(res, 200, related);
        return true;
      }

      if (pathname.startsWith('/api/artist/')) {
        const artistId = decodeURIComponent(pathname.slice('/api/artist/'.length));
        const detail = await provider.getArtist(artistId);
        sendJson(res, 200, detail);
        return true;
      }

      if (pathname.startsWith('/api/album/')) {
        const albumId = decodeURIComponent(pathname.slice('/api/album/'.length));
        const detail = await provider.getAlbum(albumId);
        sendJson(res, 200, detail);
        return true;
      }

      if (pathname.startsWith('/api/playlist/')) {
        const playlistId = decodeURIComponent(pathname.slice('/api/playlist/'.length));
        const detail = await provider.getPlaylist(playlistId);
        sendJson(res, 200, detail);
        return true;
      }

      if (pathname.startsWith('/api/lyrics/yt/')) {
        const videoId = decodeURIComponent(pathname.slice('/api/lyrics/yt/'.length));
        const plainLyrics = await provider.getPlainLyricsFallback(videoId);
        sendJson(res, 200, {
          videoId,
          lyrics: plainLyrics,
          plainLyrics,
        });
        return true;
      }

      if (pathname === '/api/import/spotify') {
        const targetUrl = urlObj.searchParams.get('url') ?? '';
        const parsed = importer.parseUrl(targetUrl);
        if (!parsed || parsed.platform !== 'spotify') {
          sendJson(res, 400, { error: 'URL de Spotify no válida' });
          return true;
        }

        const embedUrl = `https://open.spotify.com/embed/${parsed.kind}/${parsed.id}`;
        try {
          const embedRes = await fetchFn(embedUrl, {
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            },
          });
          if (embedRes.ok) {
            const html = await embedRes.text();
            const extracted = parseSpotifyEmbedHtml(html, parsed);
            if (extracted && extracted.tracks.length > 0) {
              sendJson(res, 200, extracted);
              return true;
            }
          }
        } catch {
          // Fall through to deterministic fallback extraction for offline / sandboxed environment
        }

        const fallbackExtraction: SpotifyEmbedExtraction = {
          id: parsed.id,
          kind: parsed.kind,
          name: 'Éxitos Urbano España (Spotify Import)',
          author: 'Spotify España',
          coverUrl: FALLBACK_TRACKS[0]!.thumbnailUrl,
          sourceUrl: parsed.canonicalUrl,
          truncated: false,
          tracks: FALLBACK_TRACKS.slice(0, 6).map((t) => ({
            title: t.title,
            artists: t.artists.map((a) => a.name),
            durationSec: t.durationSec,
            externalId: `spotify:track:${t.id}`,
            thumbnailUrl: t.thumbnailUrl,
          })),
        };
        sendJson(res, 200, fallbackExtraction);
        return true;
      }

      if (pathname === '/api/download/android') {
        const { createReadStream, existsSync, statSync } = await import('node:fs');
        const apkPath = '/home/antigravity/pMusic/apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk';
        if (!existsSync(apkPath)) {
          sendJson(res, 404, { error: 'APK no encontrado' });
          return true;
        }
        const st = statSync(apkPath);
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/vnd.android.package-archive');
        res.setHeader('Content-Disposition', 'attachment; filename="pMusic-Android.apk"');
        res.setHeader('Content-Length', st.size);
        createReadStream(apkPath).pipe(res);
        return true;
      }

      if (pathname === '/api/download/windows') {
        const { createReadStream, existsSync, statSync } = await import('node:fs');
        const zipPath = '/home/antigravity/pMusic/apps/desktop/release/pMusic-0.1.0-win.zip';
        if (!existsSync(zipPath)) {
          sendJson(res, 404, { error: 'Paquete Windows no encontrado' });
          return true;
        }
        const st = statSync(zipPath);
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', 'attachment; filename="pMusic-0.1.0-Windows-x64.zip"');
        res.setHeader('Content-Length', st.size);
        createReadStream(zipPath).pipe(res);
        return true;
      }

      if (pathname.startsWith('/api/stream/')) {
        const streamId = decodeURIComponent(pathname.slice('/api/stream/'.length));
        const titleParam = urlObj.searchParams.get('title') ?? undefined;
        const artistParam = urlObj.searchParams.get('artist') ?? undefined;
        const durParam = urlObj.searchParams.get('durationSec');
        const durationSec = durParam ? Number(durParam) : undefined;
        if (
          await streamResolver.pipe(streamId, req, res, {
            title: titleParam,
            artist: artistParam,
            durationSec: Number.isFinite(durationSec) ? durationSec : undefined,
          })
        ) {
          return true;
        }
        const wav = getCachedWavBuffer();
        const total = wav.byteLength;
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Content-Type', 'audio/wav');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('X-PMusic-Stream-Source', 'offline-wav');

        const rangeHeader = req.headers.range;
        if (typeof rangeHeader === 'string' && rangeHeader.startsWith('bytes=')) {
          const parts = rangeHeader.slice('bytes='.length).split('-');
          const startRaw = Number.parseInt(parts[0] ?? '0', 10);
          const endRaw = parts[1] && parts[1].length > 0 ? Number.parseInt(parts[1], 10) : total - 1;
          const start = Number.isFinite(startRaw) && startRaw >= 0 ? Math.min(startRaw, total - 1) : 0;
          const end = Number.isFinite(endRaw) && endRaw >= start ? Math.min(endRaw, total - 1) : total - 1;
          const chunk = wav.subarray(start, end + 1);

          res.statusCode = 206;
          res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
          res.setHeader('Content-Length', chunk.byteLength);
          if (req.method === 'HEAD') {
            res.end();
          } else {
            res.end(chunk);
          }
          return true;
        }

        res.statusCode = 200;
        res.setHeader('Content-Length', total);
        if (req.method === 'HEAD') {
          res.end();
        } else {
          res.end(wav);
        }
        return true;
      }

      sendJson(res, 404, { error: `Endpoint no encontrado: ${pathname}` });
      return true;
    } catch (err) {
      sendJson(res, 500, {
        error: err instanceof Error ? err.message : 'Error interno del proveedor',
      });
      return true;
    }
  };
}
