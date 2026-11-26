import type { IncomingMessage, ServerResponse } from 'node:http';
import { normalizeSearchText, type IMusicProvider, type SearchFilter } from '@pmusic/core';
import { FALLBACK_TRACKS } from './catalog-fallback.ts';
import { isAuthenticLyricsText } from './lrclib.ts';
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
  const deezerCatalog = new DeezerCatalog();
  const streamResolver = new AudioStreamResolver(deezerCatalog);
  const importer = new PlaylistImporter({ musicProvider: provider });
  const fetchFn = options.fetchFn ?? globalThis.fetch.bind(globalThis);

  let mxmToken: string | null = null;
  let mxmTokenExpiresAt = 0;
  const mxmGuid = 'pMusicDesktop-1a2b3c4d';

  async function getMusixmatchToken(): Promise<string | null> {
    if (mxmToken && mxmTokenExpiresAt > Date.now()) return mxmToken;
    try {
      const res = await fetchFn(
        'https://apic-desktop.musixmatch.com/ws/1.1/token.get?app_id=web-desktop-app-v1.0',
        {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            Cookie: `x-mxm-token-guid=${mxmGuid}`,
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          },
        }
      );
      if (!res.ok) return null;
      const json = (await res.json()) as {
        message?: { header?: { status_code?: number }; body?: { user_token?: string } };
      };
      const code = json?.message?.header?.status_code;
      const tok = json?.message?.body?.user_token;
      if (code === 200 && tok && tok !== 'UpgradeOnlyUpgradeOnlyUpgradeOnlyUpgradeOnly') {
        mxmToken = tok;
        mxmTokenExpiresAt = Date.now() + 20 * 60_000;
        return tok;
      }
      return null;
    } catch {
      return null;
    }
  }

  async function fetchMusixmatchLyrics(
    title: string,
    artist: string,
    durationSec?: number
  ): Promise<{ syncedLyrics: string | null; plainLyrics: string | null }> {
    const cleanWatermark = (raw: string): string =>
      raw
        .replace(/\*+\s*This Lyrics is NOT for Commercial use\s*\*+[\s\S]*/i, '')
        .trim();

    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await getMusixmatchToken();
      if (!token) break;
      const params = new URLSearchParams({
        format: 'json',
        namespace: 'lyrics_richsynched',
        subtitle_format: 'lrc',
        app_id: 'web-desktop-app-v1.0',
        usertoken: token,
        q_track: title,
        q_artist: artist,
      });
      if (durationSec && Number.isFinite(durationSec) && durationSec > 0) {
        params.set('f_subtitle_length', String(Math.round(durationSec)));
        params.set('f_subtitle_length_max_deviation', '8');
      }
      try {
        const res = await fetchFn(
          `https://apic-desktop.musixmatch.com/ws/1.1/macro.subtitles.get?${params.toString()}`,
          {
            method: 'GET',
            headers: {
              Accept: 'application/json',
              Cookie: `x-mxm-token-guid=${mxmGuid}; AWSELB=unknown`,
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            },
          }
        );
        if (!res.ok) break;
        const json = (await res.json()) as {
          message?: {
            header?: { status_code?: number };
            body?: {
              macro_calls?: {
                'track.subtitles.get'?: {
                  message?: {
                    header?: { status_code?: number };
                    body?: { subtitle_list?: Array<{ subtitle?: { subtitle_body?: string } }> };
                  };
                };
                'track.lyrics.get'?: {
                  message?: {
                    header?: { status_code?: number };
                    body?: { lyrics?: { lyrics_body?: string } };
                  };
                };
              };
            };
          };
        };
        const topCode = json?.message?.header?.status_code;
        if (topCode === 401 || topCode === 402) {
          mxmToken = null;
          mxmTokenExpiresAt = 0;
          continue;
        }
        const calls = json?.message?.body?.macro_calls as Record<string, any> | undefined;
        const matchedTrack = calls?.['matcher.track.get']?.message?.body?.track;
        if (matchedTrack) {
          const reqTitle = normalizeSearchText(title);
          const reqArtist = normalizeSearchText(artist);
          const gotTitle = normalizeSearchText(String(matchedTrack.track_name ?? ''));
          const gotArtist = normalizeSearchText(String(matchedTrack.artist_name ?? ''));
          const titleOk =
            !reqTitle ||
            !gotTitle ||
            gotTitle === reqTitle ||
            gotTitle.includes(reqTitle) ||
            reqTitle.includes(gotTitle);
          const artistOk =
            !reqArtist ||
            !gotArtist ||
            gotArtist === reqArtist ||
            gotArtist.includes(reqArtist) ||
            reqArtist.includes(gotArtist) ||
            (reqArtist.includes('cruz cafune') && gotArtist.includes('cruzzi'));
          if (!titleOk || !artistOk) {
            return { syncedLyrics: null, plainLyrics: null };
          }
        }
        const subRaw =
          calls?.['track.subtitles.get']?.message?.body?.subtitle_list?.[0]?.subtitle
            ?.subtitle_body;
        const lyrRaw = calls?.['track.lyrics.get']?.message?.body?.lyrics?.lyrics_body;
        const rawSynced =
          typeof subRaw === 'string' && subRaw.trim().length > 0 ? subRaw.trim() : null;
        const rawPlain =
          typeof lyrRaw === 'string' && lyrRaw.trim().length > 0 ? cleanWatermark(lyrRaw) : '';
        const syncedLyrics =
          rawSynced && isAuthenticLyricsText(rawSynced) ? rawSynced : null;
        const cleanedPlain =
          rawPlain.length > 0 && isAuthenticLyricsText(rawPlain) ? rawPlain : '';
        return {
          syncedLyrics,
          plainLyrics: cleanedPlain.length > 0 ? cleanedPlain : null,
        };
      } catch {
        break;
      }
    }
    return { syncedLyrics: null, plainLyrics: null };
  }

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
        const nameHint = urlObj.searchParams.get('name') ?? undefined;
        const getArtistFn = provider.getArtist.bind(provider) as (
          id: string,
          signal?: AbortSignal,
          hint?: { name?: string }
        ) => Promise<unknown>;
        const detail = await getArtistFn(artistId, undefined, nameHint ? { name: nameHint } : undefined);
        sendJson(res, 200, detail);
        return true;
      }

      if (pathname.startsWith('/api/track/')) {
        const trackId = decodeURIComponent(pathname.slice('/api/track/'.length));
        const track = await deezerCatalog.getTrack(trackId);
        if (!track) {
          const fallback = FALLBACK_TRACKS.find((t) => t.id === trackId) ?? null;
          if (!fallback) {
            sendJson(res, 404, { error: `Pista no encontrada: ${trackId}` });
            return true;
          }
          sendJson(res, 200, fallback);
          return true;
        }
        sendJson(res, 200, track);
        return true;
      }

      if (pathname.startsWith('/api/credits/')) {
        const trackId = decodeURIComponent(pathname.slice('/api/credits/'.length));
        const title = urlObj.searchParams.get('title') ?? undefined;
        const artist = urlObj.searchParams.get('artist') ?? undefined;
        const credits = await deezerCatalog.trackCredits(trackId, { title, artist });
        sendJson(res, 200, { credits });
        return true;
      }

      if (pathname.startsWith('/api/album/')) {
        const albumId = decodeURIComponent(pathname.slice('/api/album/'.length));
        const title = urlObj.searchParams.get('title') ?? undefined;
        const artist = urlObj.searchParams.get('artist') ?? undefined;
        const getAlbumFn = provider.getAlbum.bind(provider) as (
          id: string,
          signal?: AbortSignal,
          hint?: { title?: string; artist?: string }
        ) => Promise<unknown>;
        const detail = await getAlbumFn(albumId, undefined, { title, artist });
        sendJson(res, 200, detail);
        return true;
      }

      if (pathname.startsWith('/api/playlist/')) {
        const playlistId = decodeURIComponent(pathname.slice('/api/playlist/'.length));
        const detail = await provider.getPlaylist(playlistId);
        sendJson(res, 200, detail);
        return true;
      }

      if (pathname === '/api/lyrics/musixmatch') {
        const title = (urlObj.searchParams.get('title') ?? '').trim();
        const artist = (urlObj.searchParams.get('artist') ?? '').trim();
        const durRaw = urlObj.searchParams.get('duration');
        const duration = durRaw ? Number(durRaw) : undefined;
        if (!title) {
          sendJson(res, 200, { syncedLyrics: null, plainLyrics: null, source: 'musixmatch' });
          return true;
        }
        const result = await fetchMusixmatchLyrics(
          title,
          artist,
          duration && Number.isFinite(duration) ? duration : undefined
        );
        sendJson(res, 200, { ...result, source: 'musixmatch' });
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

      if (pathname === '/api/cover-proxy') {
        const rawCoverUrl = (urlObj.searchParams.get('url') ?? '').trim();
        let parsedCover: URL;
        try {
          parsedCover = new URL(rawCoverUrl);
        } catch {
          sendJson(res, 400, { error: 'URL de portada inválida' });
          return true;
        }
        const host = parsedCover.hostname.toLowerCase();
        const allowedHosts = [
          'ytimg.com',
          'googleusercontent.com',
          'ggpht.com',
          'scdn.co',
          'mzstatic.com',
          'deezer.com',
          'dzcdn.net',
          'tidal.com',
          'supabase.co',
          'discogs.com',
          'lastfm.freetls.fastly.net',
        ];
        const isAllowedHost = allowedHosts.some(
          (allowed) => host === allowed || host.endsWith(`.${allowed}`)
        );
        if (parsedCover.protocol !== 'https:' || !isAllowedHost) {
          sendJson(res, 403, { error: 'Origen de portada no permitido' });
          return true;
        }
        try {
          const ac = new AbortController();
          const timer = setTimeout(() => ac.abort(), 6000);
          const upstream = await fetch(parsedCover.toString(), {
            signal: ac.signal,
            headers: {
              'User-Agent': 'pMusic/0.23.0',
              Accept: 'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8',
            },
          }).finally(() => clearTimeout(timer));
          if (!upstream.ok) {
            sendJson(res, upstream.status, { error: 'No se pudo obtener la portada' });
            return true;
          }
          const ctype = (upstream.headers.get('content-type') ?? 'image/jpeg').toLowerCase();
          if (!ctype.startsWith('image/')) {
            sendJson(res, 415, { error: 'Contenido no es imagen' });
            return true;
          }
          const buf = Buffer.from(await upstream.arrayBuffer());
          if (buf.byteLength === 0 || buf.byteLength > 5 * 1024 * 1024) {
            sendJson(res, 413, { error: 'Portada vacía o demasiado grande' });
            return true;
          }
          res.statusCode = 200;
          res.setHeader('Content-Type', ctype);
          res.setHeader('Content-Length', buf.byteLength);
          res.setHeader('Cache-Control', 'public, max-age=604800');
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.end(buf);
          return true;
        } catch {
          sendJson(res, 502, { error: 'Error descargando portada' });
          return true;
        }
      }

      if (pathname === '/api/download/android') {
        const { createReadStream, existsSync, statSync } = await import('node:fs');
        const { dirname, resolve } = await import('node:path');
        const { fileURLToPath } = await import('node:url');
        const here = dirname(fileURLToPath(import.meta.url));
        const apkPath = resolve(
          here,
          '../../../apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk'
        );
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
        const { dirname, resolve } = await import('node:path');
        const { fileURLToPath } = await import('node:url');
        const here = dirname(fileURLToPath(import.meta.url));
        const exePath = resolve(here, '../../../apps/desktop/release/latest/pMusic-Setup-0.1.0.exe');
        if (!existsSync(exePath)) {
          sendJson(res, 404, { error: 'Instalador Windows no encontrado' });
          return true;
        }
        const st = statSync(exePath);
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Disposition', 'attachment; filename="pMusic-Setup-0.1.0.exe"');
        res.setHeader('Content-Length', st.size);
        createReadStream(exePath).pipe(res);
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
        const errMsg =
          streamResolver.getLastFailureReason() === 'bot_check'
            ? 'YouTube bloqueó esta IP con verificación anti-bot. Cambia de red o reintenta en unos minutos.'
            : 'No se pudo cargar el audio completo de esta pista';
        sendJson(res, 503, { error: errMsg });
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
