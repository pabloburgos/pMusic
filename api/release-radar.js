function toLocalIsoDate(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getMostRecentFridayIso(now = new Date()) {
  const day = now.getUTCDay();
  const daysSinceFri = (day - 5 + 7) % 7;
  const friday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysSinceFri)
  );
  return toLocalIsoDate(friday);
}

function decodeHtmlEntities(raw) {
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

function normStr(input) {
  return String(input || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitCandidateArtists(rawArtists) {
  const cleaned = decodeHtmlEntities(rawArtists);
  if (!cleaned) return [];
  const parts = cleaned
    .split(/\s*(?:,|&|\bfeat\.?\b|\bft\.?\b|\bcon\b)\s*/i)
    .map((p) => p.trim())
    .filter(Boolean);
  const seen = new Set();
  const out = [];
  for (const part of parts) {
    const k = normStr(part);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(part);
  }
  return out;
}

function parseSpotifyEmbed(html, source, estimatedReleaseDate) {
  if (!html) return [];
  const match = html.match(/<script\b[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match?.[1]) return [];
  let parsed;
  try {
    parsed = JSON.parse(match[1]);
  } catch {
    return [];
  }
  const trackList = parsed?.props?.pageProps?.state?.data?.entity?.trackList;
  if (!Array.isArray(trackList)) return [];
  const priority =
    source === 'spotify_novedades_es' ? 95 : source === 'spotify_pegao' ? 85 : 75;
  const out = [];
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

function parseLaHiguera(html, kind, fallbackDate) {
  if (!html) return [];
  const out = [];
  const articleRe = /<article\b[^>]*>([\s\S]*?)<\/article>/gi;
  let m;
  while ((m = articleRe.exec(html)) !== null) {
    const block = m[1] ?? '';
    const titleMatch = block.match(/<h3\b[^>]*>\s*<a\b[^>]*>([\s\S]*?)<\/a>\s*<\/h3>/i);
    if (!titleMatch?.[1]) continue;
    const rawHeader = decodeHtmlEntities(titleMatch[1].replace(/<[^>]+>/g, ''));
    const colonIdx = rawHeader.indexOf(':');
    if (colonIdx <= 0) continue;
    const artists = splitCandidateArtists(rawHeader.slice(0, colonIdx).trim());
    const title = rawHeader.slice(colonIdx + 1).trim();
    if (!title || artists.length === 0) continue;

    let releaseDate = fallbackDate;
    const dateMatch = block.match(/class=["']?fecha["']?[^>]*>\s*(\d{2})\/(\d{2})\/(\d{4})/i);
    if (dateMatch?.[1] && dateMatch[2] && dateMatch[3]) {
      releaseDate = `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`;
    }

    const introMatch = block.match(/class=["']?intro["']?[^>]*>([\s\S]*?)<\/div>/i);
    const introText = introMatch?.[1]
      ? decodeHtmlEntities(introMatch[1].replace(/<[^>]+>/g, ''))
      : '';
    const imgMatch = block.match(/<img\b[^>]*\bsrc=["']([^"']+)["']/i);
    const thumbnailUrl = imgMatch?.[1]?.trim() || undefined;
    const releaseKind =
      kind === 'canciones' ? 'track' : /\bep\b|ep[eé]/i.test(introText) ? 'ep' : 'album';

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

async function fetchText(url, timeoutMs = 4500) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
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
    clearTimeout(timer);
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const now = new Date();
    const fridayIso = getMostRecentFridayIso(now);
    const cutoffIso = toLocalIsoDate(
      new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 30))
    );

    const [spNovHtml, lhNovHtml, lhCancHtml] = await Promise.all([
      fetchText('https://open.spotify.com/embed/playlist/37i9dQZF1DX6PYajiT4pAf', 4500),
      fetchText('https://www.lahiguera.net/musicalia/novedades.php', 4500),
      fetchText('https://www.lahiguera.net/musicalia/canciones.php', 4500),
    ]);
    const [spPegaoHtml, spNmfHtml] = await Promise.all([
      fetchText('https://open.spotify.com/embed/playlist/37i9dQZF1DX1HCSfq0nSal', 4500),
      fetchText('https://open.spotify.com/embed/playlist/37i9dQZF1DX4JAvHpjipBk', 4500),
    ]);

    const raw = [
      ...parseSpotifyEmbed(spNovHtml, 'spotify_novedades_es', fridayIso),
      ...parseSpotifyEmbed(spPegaoHtml, 'spotify_pegao', undefined),
      ...parseSpotifyEmbed(spNmfHtml, 'spotify_nmf', fridayIso),
      ...parseLaHiguera(lhNovHtml, 'novedades').filter(
        (x) => !x.releaseDate || x.releaseDate >= cutoffIso
      ),
      ...parseLaHiguera(lhCancHtml, 'canciones', fridayIso),
    ];

    const dedup = new Map();
    for (const item of raw) {
      const key = `${normStr(item.title)}::${normStr(item.artists[0] ?? '')}`;
      if (key === '::') continue;
      const prev = dedup.get(key);
      if (!prev) {
        dedup.set(key, item);
        continue;
      }
      const winner = item.priority > prev.priority ? item : prev;
      dedup.set(key, {
        ...winner,
        releaseDate:
          item.source === 'lahiguera_novedades' && item.releaseDate
            ? item.releaseDate
            : prev.source === 'lahiguera_novedades' && prev.releaseDate
              ? prev.releaseDate
              : winner.releaseDate ?? prev.releaseDate ?? item.releaseDate,
        thumbnailUrl: winner.thumbnailUrl ?? prev.thumbnailUrl ?? item.thumbnailUrl,
      });
    }

    const releases = Array.from(dedup.values()).sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return (b.releaseDate ?? '').localeCompare(a.releaseDate ?? '');
    });

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');
    return res.status(200).json({ releases, fetchedAt: new Date().toISOString() });
  } catch (err) {
    return res.status(200).json({
      releases: [],
      error: err instanceof Error ? err.message : 'release_radar_failed',
      fetchedAt: new Date().toISOString(),
    });
  }
}
