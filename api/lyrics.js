const ARTIST_ALIASES = {
  'cruz cafune': ['cruzzi'],
  cruzzi: ['cruz cafune'],
  'la pantera': ['lapantera'],
  lapantera: ['la pantera'],
  'c tangana': ['pucho'],
  'lucho rk': ['luchork'],
};

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
    });
}

function normStr(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripTitleNoise(raw) {
  return String(raw || '')
    .replace(/\((?:official\s*(?:music\s*)?video|videoclip\s*oficial|audio\s*oficial|lyric\s*video|lyrics|visualizer|explicit|en\s*vivo|live|remaster(?:ed)?|feat\.?[^)]*|ft\.?[^)]*)\)/gi, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\s*-\s*(?:official|videoclip|lyric).*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function buildArtistVariants(artist) {
  const parts = String(artist || '')
    .split(/\s*(?:,|&|\bfeat\.?\b|\bft\.?\b|\bcon\b|\bx\b)\s*/i)
    .map((p) => p.trim())
    .filter(Boolean);
  const out = [];
  const seen = new Set();
  const push = (v) => {
    const k = normStr(v);
    if (!k || seen.has(k)) return;
    seen.add(k);
    out.push(v);
    for (const alias of ARTIST_ALIASES[k] || []) {
      const ak = normStr(alias);
      if (ak && !seen.has(ak)) {
        seen.add(ak);
        out.push(alias);
      }
    }
  };
  for (const p of parts) push(p);
  return out;
}

async function fetchWithTimeout(url, timeoutMs = 4000, headers = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        ...headers,
      },
    });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchFromLetrasCom(titleVariants, artistVariants) {
  for (const artist of artistVariants.slice(0, 3)) {
    const aSlug = slugify(artist);
    if (!aSlug) continue;
    for (const title of titleVariants) {
      const tSlug = slugify(title);
      if (!tSlug) continue;
      const res = await fetchWithTimeout(`https://www.letras.com/${aSlug}/${tSlug}/`, 3800, {
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'es-ES,es;q=0.9',
      });
      if (!res?.ok) continue;
      const html = await res.text();
      const match =
        html.match(/<div class="lyric-original[^>]*>([\s\S]*?)<\/div>/i) ||
        html.match(/<div class="cnt-letra[^>]*>([\s\S]*?)<\/div>/i);
      if (!match?.[1]) continue;
      const plain = decodeHtmlEntities(
        match[1]
          .replace(/<br\s*\/?>/gi, '\n')
          .replace(/<\/p>/gi, '\n\n')
          .replace(/<[^>]+>/g, '')
      )
        .replace(/\n{3,}/g, '\n\n')
        .trim();
      if (plain.length >= 25) return plain;
    }
  }
  return null;
}

async function fetchFromLyricsOvh(cleanTitle, artistVariants) {
  for (const artist of artistVariants.slice(0, 2)) {
    const res = await fetchWithTimeout(
      `https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(cleanTitle)}`,
      3800,
      { Accept: 'application/json' }
    );
    if (!res?.ok) continue;
    try {
      const json = await res.json();
      const plain = typeof json?.lyrics === 'string' ? json.lyrics.trim() : '';
      if (plain.length >= 25) return plain;
    } catch {
      // ignore invalid json
    }
  }
  return null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const urlObj = new URL(req.url || '/', 'http://127.0.0.1');
    const rawTitle = (urlObj.searchParams.get('title') || '').trim();
    const rawArtist = (urlObj.searchParams.get('artist') || '').trim();
    if (!rawTitle || !rawArtist) {
      return res.status(200).json({ syncedLyrics: null, plainLyrics: null, source: 'none' });
    }

    const cleanTitle = stripTitleNoise(rawTitle) || rawTitle;
    const titleVariants = Array.from(new Set([cleanTitle, rawTitle].filter(Boolean)));
    const artistVariants = buildArtistVariants(rawArtist);

    const letrasPlain = await fetchFromLetrasCom(titleVariants, artistVariants);
    if (letrasPlain) {
      res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');
      return res.status(200).json({
        syncedLyrics: null,
        plainLyrics: letrasPlain,
        source: 'letras',
      });
    }

    const ovhPlain = await fetchFromLyricsOvh(cleanTitle, artistVariants);
    if (ovhPlain) {
      res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');
      return res.status(200).json({
        syncedLyrics: null,
        plainLyrics: ovhPlain,
        source: 'lyrics_ovh',
      });
    }

    return res.status(200).json({ syncedLyrics: null, plainLyrics: null, source: 'none' });
  } catch {
    return res.status(200).json({ syncedLyrics: null, plainLyrics: null, source: 'none' });
  }
}
