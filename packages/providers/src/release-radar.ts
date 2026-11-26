import { normalizeSearchText, type ExternalReleaseCandidate } from '@pmusic/core';

export const SPOTIFY_RELEASE_RADAR_PLAYLISTS: ReadonlyArray<{
  id: string;
  source: 'spotify_novedades_es' | 'spotify_pegao' | 'spotify_nmf';
  priority: number;
  stampEstimatedFridayDate: boolean;
}> = [
  { id: '37i9dQZF1DX6PYajiT4pAf', source: 'spotify_novedades_es', priority: 95, stampEstimatedFridayDate: true },
  { id: '37i9dQZF1DX1HCSfq0nSal', source: 'spotify_pegao', priority: 85, stampEstimatedFridayDate: false },
  { id: '37i9dQZF1DX4JAvHpjipBk', source: 'spotify_nmf', priority: 75, stampEstimatedFridayDate: true },
];

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
  source: 'spotify_novedades_es' | 'spotify_pegao' | 'spotify_nmf',
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
    source === 'spotify_novedades_es' ? 95 : source === 'spotify_pegao' ? 85 : 75;
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
  signal?: AbortSignal
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
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
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

  // Wave A: primary Spanish editorial & LaHiguera sources
  const primaryPl = SPOTIFY_RELEASE_RADAR_PLAYLISTS[0]!;
  const [spPrimary, lhNovHtml, lhCancHtml] = await Promise.all([
    fetchSpotifyEntry(primaryPl),
    fetchTextWithTimeout(LAHIGUERA_NOVEDADES_URL, fetchImpl, 4000, options.signal),
    fetchTextWithTimeout(LAHIGUERA_CANCIONES_URL, fetchImpl, 4000, options.signal),
  ]);

  // Wave B: PEGAO + New Music Friday (slightly staggered to avoid concurrent Spotify embed throttling)
  const spSecondaryRes = await Promise.allSettled(
    SPOTIFY_RELEASE_RADAR_PLAYLISTS.slice(1).map(fetchSpotifyEntry)
  );

  const raw: ExternalReleaseCandidate[] = [...spPrimary];
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

  // Deduplicate by normalized title::primaryArtist while preserving highest priority & explicit date
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
    const prevHasExplicitLhDate = prev.source === 'lahiguera_novedades' && Boolean(prev.releaseDate);
    const currHasExplicitLhDate = item.source === 'lahiguera_novedades' && Boolean(item.releaseDate);
    const chosenDate = currHasExplicitLhDate
      ? item.releaseDate
      : prevHasExplicitLhDate
        ? prev.releaseDate
        : item.releaseDate && (!prev.releaseDate || item.releaseDate > prev.releaseDate)
          ? item.releaseDate
          : prev.releaseDate;

    const winner = item.priority > prev.priority ? item : prev;
    dedup.set(key, {
      ...winner,
      artists: mergedArtists,
      ...(chosenDate ? { releaseDate: chosenDate } : {}),
      thumbnailUrl: winner.thumbnailUrl ?? prev.thumbnailUrl ?? item.thumbnailUrl,
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
