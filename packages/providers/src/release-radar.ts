import { normalizeSearchText, type ExternalReleaseCandidate, type Track } from '@pmusic/core';

export const SPOTIFY_RELEASE_RADAR_PLAYLISTS: ReadonlyArray<{
  id: string;
  source: 'spotify_novedades_es' | 'spotify_novedades_latin' | 'spotify_pegao' | 'spotify_nmf';
  priority: number;
  stampEstimatedFridayDate: boolean;
}> = [
  { id: '37i9dQZF1DX6PYajiT4pAf', source: 'spotify_novedades_es', priority: 95, stampEstimatedFridayDate: true },
  { id: '37i9dQZF1DX10zKzsJ2jva', source: 'spotify_novedades_latin', priority: 92, stampEstimatedFridayDate: true },
  { id: '37i9dQZF1DX1HCSfq0nSal', source: 'spotify_pegao', priority: 86, stampEstimatedFridayDate: false },
  { id: '37i9dQZF1DX4JAvHpjipBk', source: 'spotify_nmf', priority: 60, stampEstimatedFridayDate: true },
];

export const APPLE_MUSIC_ES_SONGS_URL =
  'https://rss.marketingtools.apple.com/api/v2/es/music/most-played/50/songs.json';
export const DEEZER_NOVEDADES_ES_SEARCH_URL =
  'https://api.deezer.com/search/playlist?q=Novedades+Viernes+Espa%C3%B1a&limit=6';
export const DEEZER_RADAR_WEEKLY_TRACKS_URL =
  'https://api.deezer.com/playlist/1282495565/tracks?limit=60';
export const LAHIGUERA_NOVEDADES_URL = 'https://www.lahiguera.net/musicalia/novedades.php';
export const LAHIGUERA_CANCIONES_URL = 'https://www.lahiguera.net/musicalia/canciones.php';

const RADAR_CACHE_TTL_MS = 30 * 60_000;
let cachedRadar: { dayKey: string; at: number; items: ExternalReleaseCandidate[] } | null = null;

function toLocalIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function getMostRecentFridayIso(now: Date = new Date()): string {
  const day = now.getDay(); // 0=Sun ... 5=Fri ... 6=Sat
  const daysSinceFri = (day - 5 + 7) % 7;
  const friday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - daysSinceFri,
    0,
    0,
    0,
    0
  );
  return toLocalIsoDate(friday);
}

export function decodeHtmlEntities(raw: string): string {
  if (!raw) return '';
  return raw
    .replace(/\u00A0/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_m, dec) => {
      const code = Number.parseInt(dec, 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    })
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    })
    .replace(/\s+/g, ' ')
    .trim();
}

function splitCandidateArtists(rawArtists: string): string[] {
  const cleaned = decodeHtmlEntities(rawArtists);
  if (!cleaned) return [];
  const parts = cleaned
    .split(/\s*(?:,|&|\bfeat\.?\b|\bft\.?\b|\bcon\b)\s*/i)
    .map((p) => p.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of parts) {
    const norm = normalizeSearchText(part);
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    out.push(part);
  }
  return out;
}

export function parseLaHigueraNovedadesHtml(
  html: string,
  kind: 'novedades' | 'canciones' = 'novedades',
  fallbackDate?: string
): ExternalReleaseCandidate[] {
  if (!html) return [];
  const out: ExternalReleaseCandidate[] = [];
  const articleRe = /<article\b[^>]*>([\s\S]*?)<\/article>/gi;
  let m: RegExpExecArray | null;
  while ((m = articleRe.exec(html)) !== null) {
    const block = m[1] ?? '';
    const titleMatch = block.match(/<h3\b[^>]*>\s*<a\b[^>]*>([\s\S]*?)<\/a>\s*<\/h3>/i);
    if (!titleMatch?.[1]) continue;
    const rawHeader = decodeHtmlEntities(titleMatch[1].replace(/<[^>]+>/g, ''));
    const colonIdx = rawHeader.indexOf(':');
    if (colonIdx <= 0) continue;
    const artistsRaw = rawHeader.slice(0, colonIdx).trim();
    const title = rawHeader.slice(colonIdx + 1).trim();
    const artists = splitCandidateArtists(artistsRaw);
    if (!title || artists.length === 0) continue;

    let releaseDate = fallbackDate;
    const dateMatch = block.match(/class=["']?fecha["']?[^>]*>\s*(\d{2})\/(\d{2})\/(\d{4})/i);
    if (dateMatch?.[1] && dateMatch[2] && dateMatch[3]) {
      releaseDate = `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`;
    }

    const introMatch = block.match(/class=["']?intro["']?[^>]*>([\s\S]*?)<\/div>/i);
    const introText = introMatch?.[1] ? decodeHtmlEntities(introMatch[1].replace(/<[^>]+>/g, '')) : '';
    const imgMatch = block.match(/<img\b[^>]*\bsrc=["']([^"']+)["']/i);
    const thumbnailUrl = imgMatch?.[1]?.trim() || undefined;

    const releaseKind: 'track' | 'album' | 'ep' =
      kind === 'canciones'
        ? 'track'
        : /\bep\b|ep[eé]/i.test(introText)
          ? 'ep'
          : 'album';

    out.push({
      title,
      artists,
      ...(releaseDate ? { releaseDate } : {}),
      kind: releaseKind,
      source: kind === 'canciones' ? 'lahiguera_canciones' : 'lahiguera_novedades',
      priority: kind === 'canciones' ? 72 : 68,
      ...(thumbnailUrl ? { thumbnailUrl } : {}),
    });
  }
  return out;
}

export function parseSpotifyEmbedPlaylistHtml(
  html: string,
  source: 'spotify_novedades_es' | 'spotify_novedades_latin' | 'spotify_pegao' | 'spotify_nmf',
  estimatedReleaseDate?: string
): ExternalReleaseCandidate[] {
  if (!html) return [];
  const nextDataMatch = html.match(/<script\b[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!nextDataMatch?.[1]) return [];
  let parsed: any;
  try {
    parsed = JSON.parse(nextDataMatch[1]);
  } catch {
    return [];
  }
  const trackList = parsed?.props?.pageProps?.state?.data?.entity?.trackList;
  if (!Array.isArray(trackList)) return [];

  const priority =
    source === 'spotify_novedades_es'
      ? 95
      : source === 'spotify_novedades_latin'
        ? 92
        : source === 'spotify_pegao'
          ? 86
          : 60;
  const out: ExternalReleaseCandidate[] = [];
  for (const item of trackList) {
    const title = decodeHtmlEntities(String(item?.title ?? ''));
    const subtitle = decodeHtmlEntities(String(item?.subtitle ?? ''));
    if (!title || !subtitle) continue;
    const artists = subtitle
      .split(/\s*,\s*/)
      .map((a) => a.trim())
      .filter(Boolean);
    if (artists.length === 0) continue;
    out.push({
      title,
      artists,
      ...(estimatedReleaseDate ? { releaseDate: estimatedReleaseDate } : {}),
      kind: 'track',
      source,
      priority,
    });
  }
  return out;
}

async function fetchTextWithTimeout(
  url: string,
  fetchFn: typeof fetch,
  timeoutMs = 4000,
  signal?: AbortSignal,
  accept = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
): Promise<string | null> {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  const onOuter = () => ctrl?.abort();
  signal?.addEventListener('abort', onOuter, { once: true });
  try {
    const res = await fetchFn(url, {
      method: 'GET',
      signal: ctrl?.signal ?? signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        Accept: accept,
      },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
    signal?.removeEventListener('abort', onOuter);
  }
}

async function fetchJsonWithTimeout<T>(
  url: string,
  fetchFn: typeof fetch,
  timeoutMs = 4000,
  signal?: AbortSignal
): Promise<T | null> {
  const raw = await fetchTextWithTimeout(url, fetchFn, timeoutMs, signal, 'application/json');
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function parseDdMmYyToIso(title?: string): string | undefined {
  if (!title) return undefined;
  const m = title.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/);
  if (!m?.[1] || !m[2] || !m[3]) return undefined;
  const dd = m[1].padStart(2, '0');
  const mm = m[2].padStart(2, '0');
  const yyyy = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${yyyy}-${mm}-${dd}`;
}

function deezerRawToCandidate(
  t: any,
  source: 'deezer_novedades_es' | 'deezer_radar_weekly',
  priority: number,
  fallbackDate: string
): ExternalReleaseCandidate | null {
  const dzId = String(t?.id ?? '').trim();
  const title = decodeHtmlEntities(String(t?.title ?? t?.title_short ?? '')).trim();
  const mainArtistName = decodeHtmlEntities(String(t?.artist?.name ?? '')).trim();
  if (!dzId || !title || !mainArtistName) return null;

  const artists = splitCandidateArtists(mainArtistName);
  if (artists.length === 0) return null;
  const releaseDate =
    typeof t?.release_date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(t.release_date)
      ? t.release_date.slice(0, 10)
      : fallbackDate;
  const releaseYear = Number.parseInt(releaseDate.slice(0, 4), 10) || new Date().getFullYear();
  const thumbMed =
    typeof t?.album?.cover_medium === 'string' && t.album.cover_medium
      ? t.album.cover_medium
      : typeof t?.album?.cover === 'string' && t.album.cover
        ? t.album.cover
        : '';
  const thumbHigh =
    typeof t?.album?.cover_big === 'string' && t.album.cover_big
      ? t.album.cover_big
      : typeof t?.album?.cover_xl === 'string' && t.album.cover_xl
        ? t.album.cover_xl
        : thumbMed;
  const durationSec =
    typeof t?.duration === 'number' && Number.isFinite(t.duration) && t.duration > 0
      ? Math.round(t.duration)
      : 180;

  const track: Track = {
    id: `dz_${dzId}`,
    title,
    artists: [{ id: t?.artist?.id ? `dz_ar_${t.artist.id}` : undefined, name: mainArtistName }],
    ...(t?.album?.title
      ? { album: { id: t?.album?.id ? `dz_al_${t.album.id}` : undefined, name: String(t.album.title) } }
      : {}),
    durationSec,
    thumbnailUrl: thumbMed,
    ...(thumbHigh ? { thumbnailHighUrl: thumbHigh } : {}),
    releaseYear,
    releaseDate,
    isExplicit: Boolean(t?.explicit_lyrics),
    source: 'ytmusic',
  };

  return {
    title,
    artists,
    releaseDate,
    kind: 'track',
    source,
    priority,
    ...(thumbMed ? { thumbnailUrl: thumbMed } : {}),
    track,
  };
}

export async function fetchExternalReleaseRadar(
  options: {
    fetchFn?: typeof fetch;
    signal?: AbortSignal;
    now?: Date;
    forceRefresh?: boolean;
  } = {}
): Promise<ExternalReleaseCandidate[]> {
  const now = options.now ?? new Date();
  const dayKey = toLocalIsoDate(now);
  const useCache = !options.fetchFn && !options.forceRefresh;
  if (useCache && cachedRadar && cachedRadar.dayKey === dayKey && Date.now() - cachedRadar.at < RADAR_CACHE_TTL_MS) {
    return cachedRadar.items;
  }

  const fetchImpl = options.fetchFn ?? globalThis.fetch.bind(globalThis);
  const fridayIso = getMostRecentFridayIso(now);
  const cutoff15Iso = toLocalIsoDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 15, 0, 0, 0, 0));
  const cutoffDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30, 0, 0, 0, 0);
  const cutoffIso = toLocalIsoDate(cutoffDate);

  const fetchSpotifyEntry = async (pl: (typeof SPOTIFY_RELEASE_RADAR_PLAYLISTS)[number]) => {
    const html = await fetchTextWithTimeout(
      `https://open.spotify.com/embed/playlist/${pl.id}`,
      fetchImpl,
      4000,
      options.signal
    );
    return html
      ? parseSpotifyEmbedPlaylistHtml(html, pl.source, pl.stampEstimatedFridayDate ? fridayIso : undefined)
      : [];
  };

  const fetchAppleEsSongs = async (): Promise<ExternalReleaseCandidate[]> => {
    const data = await fetchJsonWithTimeout<{
      feed?: { results?: Array<{ name?: string; artistName?: string; releaseDate?: string; artworkUrl100?: string }> };
    }>(APPLE_MUSIC_ES_SONGS_URL, fetchImpl, 4000, options.signal);
    const items = data?.feed?.results;
    if (!Array.isArray(items)) return [];
    const out: ExternalReleaseCandidate[] = [];
    for (const item of items) {
      const title = decodeHtmlEntities(String(item?.name ?? '')).trim();
      const artistName = decodeHtmlEntities(String(item?.artistName ?? '')).trim();
      const releaseDate = typeof item?.releaseDate === 'string' ? item.releaseDate.slice(0, 10) : '';
      if (!title || !artistName || !releaseDate || releaseDate < cutoff15Iso) continue;
      const artists = splitCandidateArtists(artistName);
      if (artists.length === 0) continue;
      out.push({
        title,
        artists,
        releaseDate,
        kind: 'track',
        source: 'apple_es_top',
        priority: 98,
        ...(item.artworkUrl100 ? { thumbnailUrl: item.artworkUrl100 } : {}),
      });
    }
    return out;
  };

  const fetchDeezerPlaylists = async (): Promise<ExternalReleaseCandidate[]> => {
    const searchData = await fetchJsonWithTimeout<{
      data?: Array<{ id?: number | string; title?: string }>;
    }>(DEEZER_NOVEDADES_ES_SEARCH_URL, fetchImpl, 4000, options.signal);
    const pls = Array.isArray(searchData?.data) ? searchData.data : [];
    const datedPls = pls
      .map((p) => ({
        id: String(p?.id ?? '').trim(),
        date: parseDdMmYyToIso(p?.title),
      }))
      .filter((p) => Boolean(p.id));
    const recentPls = datedPls.filter((p) => p.date && p.date >= cutoff15Iso).slice(0, 2);
    const chosenNovPls = recentPls.length > 0 ? recentPls : datedPls.slice(0, 1);

    const [radarWeeklyData, ...novDatas] = await Promise.all([
      fetchJsonWithTimeout<{ data?: unknown[] }>(DEEZER_RADAR_WEEKLY_TRACKS_URL, fetchImpl, 4000, options.signal),
      ...chosenNovPls.map((pl) =>
        fetchJsonWithTimeout<{ data?: unknown[] }>(
          `https://api.deezer.com/playlist/${encodeURIComponent(pl.id)}/tracks?limit=80`,
          fetchImpl,
          4000,
          options.signal
        )
      ),
    ]);

    const out: ExternalReleaseCandidate[] = [];
    for (let i = 0; i < chosenNovPls.length; i++) {
      const plMeta = chosenNovPls[i]!;
      const plRes = novDatas[i];
      const tracks = Array.isArray(plRes?.data) ? plRes.data : [];
      for (const rawT of tracks) {
        const cand = deezerRawToCandidate(rawT, 'deezer_novedades_es', 96, plMeta.date ?? fridayIso);
        if (cand) out.push(cand);
      }
    }
    const rwTracks = Array.isArray(radarWeeklyData?.data) ? radarWeeklyData.data : [];
    for (const rawT of rwTracks.slice(0, 60)) {
      const cand = deezerRawToCandidate(rawT, 'deezer_radar_weekly', 55, fridayIso);
      if (cand) out.push(cand);
    }
    return out;
  };

  // Wave A: Apple Music ES, Deezer Novedades ES / Radar Weekly, Spotify Novedades ES, LaHiguera
  const primaryPl = SPOTIFY_RELEASE_RADAR_PLAYLISTS[0]!;
  const [appleItems, deezerItems, spPrimary, lhNovHtml, lhCancHtml] = await Promise.all([
    fetchAppleEsSongs(),
    fetchDeezerPlaylists(),
    fetchSpotifyEntry(primaryPl),
    fetchTextWithTimeout(LAHIGUERA_NOVEDADES_URL, fetchImpl, 4000, options.signal),
    fetchTextWithTimeout(LAHIGUERA_CANCIONES_URL, fetchImpl, 4000, options.signal),
  ]);

  // Wave B: PEGAO + New Music Friday (slightly staggered to avoid concurrent Spotify embed throttling)
  const spSecondaryRes = await Promise.allSettled(
    SPOTIFY_RELEASE_RADAR_PLAYLISTS.slice(1).map(fetchSpotifyEntry)
  );

  const raw: ExternalReleaseCandidate[] = [...appleItems, ...deezerItems, ...spPrimary];
  for (const r of spSecondaryRes) {
    if (r.status === 'fulfilled' && Array.isArray(r.value)) {
      raw.push(...r.value);
    }
  }
  if (lhNovHtml) {
    for (const item of parseLaHigueraNovedadesHtml(lhNovHtml, 'novedades')) {
      if (!item.releaseDate || item.releaseDate >= cutoffIso) {
        raw.push(item);
      }
    }
  }
  if (lhCancHtml) {
    raw.push(...parseLaHigueraNovedadesHtml(lhCancHtml, 'canciones', fridayIso));
  }

  // Deduplicate by normalized title::primaryArtist while preserving highest priority, explicit date & pre-built track
  const dedup = new Map<string, ExternalReleaseCandidate>();
  for (const item of raw) {
    const key = `${normalizeSearchText(item.title)}::${normalizeSearchText(item.artists[0] ?? '')}`;
    if (key === '::') continue;
    const prev = dedup.get(key);
    if (!prev) {
      dedup.set(key, item);
      continue;
    }
    const mergedArtists = [...prev.artists];
    const seenArt = new Set(mergedArtists.map((a) => normalizeSearchText(a)));
    for (const a of item.artists) {
      const na = normalizeSearchText(a);
      if (na && !seenArt.has(na)) {
        seenArt.add(na);
        mergedArtists.push(a);
      }
    }
    const prevHasExplicitDate =
      (prev.source === 'lahiguera_novedades' || prev.source === 'apple_es_top') && Boolean(prev.releaseDate);
    const currHasExplicitDate =
      (item.source === 'lahiguera_novedades' || item.source === 'apple_es_top') && Boolean(item.releaseDate);
    const chosenDate = currHasExplicitDate
      ? item.releaseDate
      : prevHasExplicitDate
        ? prev.releaseDate
        : item.releaseDate && (!prev.releaseDate || item.releaseDate > prev.releaseDate)
          ? item.releaseDate
          : prev.releaseDate;

    const winner = item.priority > prev.priority ? item : prev;
    const mergedTrack = winner.track ?? prev.track ?? item.track;
    dedup.set(key, {
      ...winner,
      artists: mergedArtists,
      ...(chosenDate ? { releaseDate: chosenDate } : {}),
      thumbnailUrl: winner.thumbnailUrl ?? prev.thumbnailUrl ?? item.thumbnailUrl,
      ...(mergedTrack ? { track: mergedTrack } : {}),
    });
  }

  const finalItems = Array.from(dedup.values()).sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    return (b.releaseDate ?? '').localeCompare(a.releaseDate ?? '');
  });

  if (useCache && finalItems.length > 0) {
    cachedRadar = { dayKey, at: Date.now(), items: finalItems };
  }
  return finalItems;
}
