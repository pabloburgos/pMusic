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

function parseDdMmYyToIso(title) {
  if (!title) return undefined;
  const m = title.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/);
  if (!m?.[1] || !m[2] || !m[3]) return undefined;
  const dd = m[1].padStart(2, '0');
  const mm = m[2].padStart(2, '0');
  const yyyy = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${yyyy}-${mm}-${dd}`;
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

function deezerRawToCandidate(t, source, priority, cutoff15Iso, todayIso) {
  const dzId = String(t?.id ?? '').trim();
  const title = decodeHtmlEntities(String(t?.title ?? t?.title_short ?? '')).trim();
  const mainArtistName = decodeHtmlEntities(String(t?.artist?.name ?? '')).trim();
  if (!dzId || !title || !mainArtistName) return null;

  const artists = splitCandidateArtists(mainArtistName);
  if (artists.length === 0) return null;
  const rawTrackDate =
    typeof t?.release_date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(t.release_date)
      ? t.release_date.slice(0, 10)
      : '';
  const rawAlbumDate =
    typeof t?.album?.release_date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(t.album.release_date)
      ? t.album.release_date.slice(0, 10)
      : '';
  const releaseDate = rawTrackDate || rawAlbumDate;
  if (!releaseDate || releaseDate < cutoff15Iso || releaseDate > todayIso) {
    return null;
  }
  const releaseYear = Number.parseInt(releaseDate.slice(0, 4), 10) || new Date().getUTCFullYear();
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

  return {
    title,
    artists,
    releaseDate,
    kind: 'track',
    source,
    priority,
    ...(thumbMed ? { thumbnailUrl: thumbMed } : {}),
    track: {
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
    },
  };
}

async function fetchText(
  url,
  timeoutMs = 4500,
  accept = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
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
    clearTimeout(timer);
  }
}

async function fetchJson(url, timeoutMs = 4500) {
  const text = await fetchText(url, timeoutMs, 'application/json');
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
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
    const todayIso = toLocalIsoDate(now);
    const cutoff15Iso = toLocalIsoDate(
      new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 15))
    );

    const fetchAppleEsSongs = async () => {
      const data = await fetchJson(
        'https://rss.marketingtools.apple.com/api/v2/es/music/most-played/50/songs.json',
        4500
      );
      const results = Array.isArray(data?.feed?.results) ? data.feed.results : [];
      const out = [];
      for (const item of results) {
        const title = decodeHtmlEntities(String(item?.name ?? '')).trim();
        const artistName = decodeHtmlEntities(String(item?.artistName ?? '')).trim();
        const releaseDate =
          typeof item?.releaseDate === 'string' ? item.releaseDate.slice(0, 10) : '';
        if (!title || !artistName || !releaseDate || releaseDate < cutoff15Iso || releaseDate > todayIso) continue;
        const artists = splitCandidateArtists(artistName);
        if (artists.length === 0) continue;
        const rawArt100 = typeof item?.artworkUrl100 === 'string' ? item.artworkUrl100.trim() : '';
        const appleThumbMed = rawArt100
          ? rawArt100.replace(/\/\d+x\d+[a-z0-9-]*\.(jpg|jpeg|png|webp)(\?.*)?$/i, '/600x600bb.$1$2')
          : '';
        const appleThumbHigh = rawArt100
          ? rawArt100.replace(/\/\d+x\d+[a-z0-9-]*\.(jpg|jpeg|png|webp)(\?.*)?$/i, '/1000x1000bb.$1$2')
          : '';
        out.push({
          title,
          artists,
          releaseDate,
          kind: 'track',
          source: 'apple_es_top',
          priority: 98,
          ...(appleThumbHigh || appleThumbMed
            ? { thumbnailUrl: appleThumbMed || appleThumbHigh, thumbnailHighUrl: appleThumbHigh || appleThumbMed }
            : {}),
        });
      }
      return out;
    };

    const resolveAlbumDates = async (albumIds) => {
      const outMap = new Map();
      const unique = Array.from(new Set(albumIds.filter(Boolean))).slice(0, 60);
      for (let i = 0; i < unique.length; i += 12) {
        const batch = unique.slice(i, i + 12);
        const resList = await Promise.all(
          batch.map((alId) => fetchJson(`https://api.deezer.com/album/${encodeURIComponent(alId)}`, 2200))
        );
        for (let j = 0; j < batch.length; j++) {
          const rd = resList[j]?.release_date;
          if (typeof rd === 'string' && /^\d{4}-\d{2}-\d{2}/.test(rd)) {
            outMap.set(batch[j], rd.slice(0, 10));
          }
        }
      }
      return outMap;
    };

    const fetchDeezerPlaylists = async () => {
      const searchData = await fetchJson(
        'https://api.deezer.com/search/playlist?q=Novedades+Viernes+Espa%C3%B1a&limit=6',
        4500
      );
      const pls = Array.isArray(searchData?.data) ? searchData.data : [];
      const datedPls = pls
        .map((p) => ({ id: String(p?.id ?? '').trim(), date: parseDdMmYyToIso(p?.title) }))
        .filter((p) => Boolean(p.id));
      const recentPls = datedPls.filter((p) => p.date && p.date >= cutoff15Iso).slice(0, 2);
      const chosenNovPls = recentPls.length > 0 ? recentPls : datedPls.slice(0, 1);

      const [radarWeeklyData, ...novDatas] = await Promise.all([
        fetchJson('https://api.deezer.com/playlist/1282495565/tracks?limit=60', 4500),
        ...chosenNovPls.map((pl) =>
          fetchJson(`https://api.deezer.com/playlist/${encodeURIComponent(pl.id)}/tracks?limit=80`, 4500)
        ),
      ]);

      const rawNovTracks = [];
      for (let i = 0; i < chosenNovPls.length; i++) {
        const tracks = Array.isArray(novDatas[i]?.data) ? novDatas[i].data : [];
        rawNovTracks.push(...tracks);
      }
      const rawRwTracks = (Array.isArray(radarWeeklyData?.data) ? radarWeeklyData.data : []).slice(0, 60);

      const missingDateAlbumIds = [];
      for (const rawT of [...rawNovTracks, ...rawRwTracks]) {
        const hasTrackDate = typeof rawT?.release_date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(rawT.release_date);
        const hasAlbumDate = typeof rawT?.album?.release_date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(rawT.album.release_date);
        if (!hasTrackDate && !hasAlbumDate && rawT?.album?.id) {
          missingDateAlbumIds.push(String(rawT.album.id));
        }
      }
      const albumDateMap = missingDateAlbumIds.length > 0 ? await resolveAlbumDates(missingDateAlbumIds) : new Map();

      const stampVerifiedDate = (rawT) => {
        if (rawT?.release_date || rawT?.album?.release_date) return rawT;
        const alId = rawT?.album?.id ? String(rawT.album.id) : '';
        const verified = alId ? albumDateMap.get(alId) : undefined;
        return verified ? { ...rawT, album: { ...rawT.album, release_date: verified } } : rawT;
      };

      const out = [];
      for (const t of rawNovTracks) {
        const cand = deezerRawToCandidate(stampVerifiedDate(t), 'deezer_novedades_es', 96, cutoff15Iso, todayIso);
        if (cand) out.push(cand);
      }
      for (const t of rawRwTracks) {
        const cand = deezerRawToCandidate(stampVerifiedDate(t), 'deezer_radar_weekly', 78, cutoff15Iso, todayIso);
        if (cand) out.push(cand);
      }
      return out;
    };

    const [appleItems, deezerItems, spNovHtml, lhNovHtml, lhCancHtml] = await Promise.all([
      fetchAppleEsSongs(),
      fetchDeezerPlaylists(),
      fetchText('https://open.spotify.com/embed/playlist/37i9dQZF1DX6PYajiT4pAf', 4500),
      fetchText('https://www.lahiguera.net/musicalia/novedades.php', 4500),
      fetchText('https://www.lahiguera.net/musicalia/canciones.php', 4500),
    ]);
    const [spPegaoHtml, spNmfHtml] = await Promise.all([
      fetchText('https://open.spotify.com/embed/playlist/37i9dQZF1DX1HCSfq0nSal', 4500),
      fetchText('https://open.spotify.com/embed/playlist/37i9dQZF1DX4JAvHpjipBk', 4500),
    ]);

    const raw = [
      ...appleItems,
      ...deezerItems,
      ...parseSpotifyEmbed(spNovHtml, 'spotify_novedades_es', undefined),
      ...parseSpotifyEmbed(spPegaoHtml, 'spotify_pegao', undefined),
      ...parseSpotifyEmbed(spNmfHtml, 'spotify_nmf', undefined),
      ...parseLaHiguera(lhNovHtml, 'novedades').filter(
        (x) => Boolean(x.releaseDate && x.releaseDate >= cutoff15Iso && x.releaseDate <= todayIso)
      ),
      ...parseLaHiguera(lhCancHtml, 'canciones').filter(
        (x) => Boolean(x.releaseDate && x.releaseDate >= cutoff15Iso && x.releaseDate <= todayIso)
      ),
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
      const mergedArtists = [...prev.artists];
      const seenArt = new Set(mergedArtists.map((a) => normStr(a)));
      for (const a of item.artists) {
        const na = normStr(a);
        if (na && !seenArt.has(na)) {
          seenArt.add(na);
          mergedArtists.push(a);
        }
      }
      const prevHasExplicit =
        (prev.source === 'lahiguera_novedades' || prev.source === 'apple_es_top') && Boolean(prev.releaseDate);
      const currHasExplicit =
        (item.source === 'lahiguera_novedades' || item.source === 'apple_es_top') && Boolean(item.releaseDate);
      const chosenDate = currHasExplicit
        ? item.releaseDate
        : prevHasExplicit
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

    const releases = Array.from(dedup.values())
      .filter((item) => {
        if (item.releaseDate && (item.releaseDate < cutoff15Iso || item.releaseDate > todayIso)) {
          return false;
        }
        if (item.track) {
          const trDate = item.track.releaseDate?.slice(0, 10) ?? '';
          if (!trDate || trDate < cutoff15Iso || trDate > todayIso) {
            return false;
          }
        }
        return true;
      })
      .sort((a, b) => {
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
