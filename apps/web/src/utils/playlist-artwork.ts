function hashSeed(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const ARTWORK_PALETTES: readonly [string, string, string, string][] = [
  ['#18181D', '#27272F', '#3F3F46', '#09090B'],
  ['#14151A', '#22242B', '#52525B', '#08090B'],
  ['#19191E', '#2A2A32', '#64748B', '#0A0A0D'],
  ['#121616', '#1F2929', '#475569', '#080B0B'],
  ['#17171B', '#26262C', '#52525B', '#070709'],
  ['#1A1817', '#292524', '#57534E', '#09090B'],
  ['#14161B', '#202632', '#475569', '#08090C'],
  ['#161618', '#232328', '#3F3F46', '#060608'],
];

function escapeXml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function pickPalette(name: string, seed = 0): [string, string, string, string] {
  const h = hashSeed(`${name.trim().toLowerCase()}#${seed}`);
  return ARTWORK_PALETTES[h % ARTWORK_PALETTES.length] ?? ARTWORK_PALETTES[0]!;
}

export interface ResolvedPlaylistCover {
  url: string;
  collageUrls?: string[];
  hasCustomCover: boolean;
  fallbackTrackId?: string;
}

type ArtworkTrackLike = {
  id?: string;
  thumbnailHighUrl?: string;
  thumbnailUrl?: string;
  album?: { id?: string; name?: string };
};

function normalizeCollageTileCount(uniqueThumbs: string[], count = 4): string[] {
  const clean = uniqueThumbs.map((u) => u.trim()).filter(Boolean);
  if (clean.length === 0) return [];
  if (clean.length === 1) return [clean[0]!];
  const out = clean.slice(0, count);
  while (out.length < count) {
    out.push(clean[out.length % clean.length]!);
  }
  return out;
}

function collectUniqueTrackCovers(tracks: readonly ArtworkTrackLike[]): string[] {
  const out: string[] = [];
  const seenUrls = new Set<string>();
  const seenAlbums = new Set<string>();
  const fallbackPool: string[] = [];

  for (const t of tracks) {
    const thumb = (t?.thumbnailHighUrl ?? t?.thumbnailUrl ?? '').trim();
    if (!thumb || seenUrls.has(thumb)) continue;
    seenUrls.add(thumb);
    const albKey = (t.album?.id || t.album?.name || '').trim().toLowerCase();
    if (albKey && seenAlbums.has(albKey)) {
      fallbackPool.push(thumb);
      continue;
    }
    if (albKey) seenAlbums.add(albKey);
    out.push(thumb);
  }
  return out.length > 0 ? out : fallbackPool;
}

/**
 * Picks up to `count` (4) unique track covers at random (Fisher-Yates) to freeze as a Spotify-style 2x2 playlist collage.
 */
export function pickRandomCollageCovers(
  tracks: readonly ArtworkTrackLike[],
  count = 4
): string[] {
  const unique = collectUniqueTrackCovers(tracks);
  if (unique.length <= 1) return unique;
  const copy = [...unique];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = copy[i]!;
    copy[i] = copy[j]!;
    copy[j] = tmp;
  }
  return normalizeCollageTileCount(copy, count);
}

/**
 * Deterministic 2x2 collage selection for legacy playlists without a saved `collageUrls` snapshot.
 */
export function pickDeterministicCollageCovers(
  seedKey: string,
  tracks: readonly ArtworkTrackLike[],
  count = 4
): string[] {
  const unique = collectUniqueTrackCovers(tracks);
  if (unique.length <= 1) return unique;
  const copy = [...unique];
  let seed = hashSeed(seedKey || 'pmusic');
  for (let i = copy.length - 1; i > 0; i--) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const j = seed % (i + 1);
    const tmp = copy[i]!;
    copy[i] = copy[j]!;
    copy[j] = tmp;
  }
  return normalizeCollageTileCount(copy, count);
}

/**
 * Resolves the canonical display cover for any playlist:
 * 1) explicit custom `coverUrl`
 * 2) frozen `collageUrls` 2x2 mosaic created with the playlist
 * 3) deterministic fallback from `tracks` (4-cover mosaic if >=2 distinct covers, or single track thumb)
 * 4) empty url when playlist has 0 tracks (rendered as neutral obsidian surface in PlaylistCoverArt)
 */
export function resolvePlaylistCoverInfo(
  pl: {
    id?: string;
    name: string;
    coverUrl?: string | null;
    collageUrls?: string[] | null;
    coverStyleSeed?: number;
    tracks: Array<ArtworkTrackLike>;
  },
  app?: {
    coverUrl?: string | null;
    collageUrls?: string[] | null;
    coverStyleSeed?: number;
  } | null
): ResolvedPlaylistCover {
  const hasExplicitAppCoverKey = Boolean(app && 'coverUrl' in app);
  const appCoverRaw = hasExplicitAppCoverKey ? (app!.coverUrl ?? '').trim() : '';
  if (appCoverRaw) {
    return {
      url: appCoverRaw,
      hasCustomCover: true,
      fallbackTrackId: undefined,
    };
  }

  const plCoverRaw = !hasExplicitAppCoverKey ? (pl.coverUrl ?? '').trim() : '';
  if (plCoverRaw) {
    const matchesTrackThumb = pl.tracks.some(
      (t) =>
        (t.thumbnailUrl ?? '').trim() === plCoverRaw ||
        (t.thumbnailHighUrl ?? '').trim() === plCoverRaw
    );
    const distinctTrackCovers = collectUniqueTrackCovers(pl.tracks);
    if (
      plCoverRaw.startsWith('data:') ||
      !matchesTrackThumb ||
      distinctTrackCovers.length < 2
    ) {
      return {
        url: plCoverRaw,
        hasCustomCover: true,
        fallbackTrackId: undefined,
      };
    }
  }

  const storedCollageRaw =
    app && app.collageUrls !== undefined ? app.collageUrls : pl.collageUrls;
  const storedCollage = Array.isArray(storedCollageRaw)
    ? storedCollageRaw.map((u) => (typeof u === 'string' ? u.trim() : '')).filter(Boolean)
    : [];
  if (storedCollage.length >= 2) {
    const tiles = normalizeCollageTileCount(storedCollage, 4);
    return {
      url: tiles[0]!,
      collageUrls: tiles,
      hasCustomCover: false,
      fallbackTrackId: undefined,
    };
  }
  if (storedCollage.length === 1) {
    return {
      url: storedCollage[0]!,
      hasCustomCover: false,
      fallbackTrackId: pl.tracks[0]?.id,
    };
  }

  const firstTrack = pl.tracks[0];
  const firstThumb = (firstTrack?.thumbnailHighUrl ?? firstTrack?.thumbnailUrl ?? '').trim();
  if (pl.tracks.length >= 2) {
    const tiles = pickDeterministicCollageCovers(pl.id || pl.name, pl.tracks, 4);
    if (tiles.length >= 2) {
      return {
        url: tiles[0]!,
        collageUrls: tiles,
        hasCustomCover: false,
        fallbackTrackId: firstTrack?.id,
      };
    }
  }
  if (firstThumb) {
    return {
      url: firstThumb,
      hasCustomCover: false,
      fallbackTrackId: firstTrack?.id,
    };
  }
  return {
    url: '',
    hasCustomCover: false,
    fallbackTrackId: undefined,
  };
}

/**
 * Formats playlist total seconds into clean pMusic Spanish duration strings (e.g. "2 h 15 min", "43 min").
 */
export function formatPlaylistDuration(totalSec: number): string {
  if (!Number.isFinite(totalSec) || totalSec <= 0) return '';
  if (totalSec < 60) return '< 1 min';
  const totalMins = Math.round(totalSec / 60);
  if (totalMins < 60) return `${totalMins} min`;
  const hours = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  return mins > 0 ? `${hours} h ${mins} min` : `${hours} h`;
}

/**
 * Generates a unique, deterministic obsidian-mesh pMusic cover SVG data URL for any playlist.
 */
export function generatePlaylistCoverDataUrl(name: string, seed = 0): string {
  const cleanName = name.trim() || 'pMusic';
  const h = hashSeed(`${cleanName}#cov#${seed}`);
  const [c1, c2, c3, base] = pickPalette(cleanName, seed);
  const cx1 = 22 + (h % 36);
  const cy1 = 20 + ((h >>> 4) % 36);
  const cx2 = 54 + ((h >>> 8) % 34);
  const cy2 = 58 + ((h >>> 12) % 30);
  const angle = (h >>> 16) % 360;
  const words = cleanName.split(/\s+/).filter(Boolean);
  const monogram =
    words.length >= 2
      ? `${words[0]![0] ?? ''}${words[1]![0] ?? ''}`.toUpperCase()
      : cleanName.slice(0, 2).toUpperCase();
  const safeInitial = escapeXml(monogram || 'P');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1" gradientTransform="rotate(${angle} 0.5 0.5)">
      <stop offset="0%" stop-color="${base}"/>
      <stop offset="52%" stop-color="${c1}" stop-opacity="0.72"/>
      <stop offset="100%" stop-color="${c2}" stop-opacity="0.88"/>
    </linearGradient>
    <radialGradient id="orbA" cx="${cx1}%" cy="${cy1}%" r="58%">
      <stop offset="0%" stop-color="${c3}" stop-opacity="0.82"/>
      <stop offset="65%" stop-color="${c1}" stop-opacity="0.22"/>
      <stop offset="100%" stop-color="${base}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="orbB" cx="${cx2}%" cy="${cy2}%" r="54%">
      <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.24"/>
      <stop offset="45%" stop-color="${c2}" stop-opacity="0.45"/>
      <stop offset="100%" stop-color="${base}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="512" height="512" fill="${base}"/>
  <rect width="512" height="512" fill="url(#bg)"/>
  <rect width="512" height="512" fill="url(#orbA)"/>
  <rect width="512" height="512" fill="url(#orbB)"/>
  <circle cx="256" cy="256" r="176" fill="none" stroke="rgba(255,255,255,0.10)" stroke-width="1.5"/>
  <circle cx="256" cy="256" r="128" fill="none" stroke="rgba(255,255,255,0.14)" stroke-width="1.5"/>
  <text x="256" y="294" text-anchor="middle" font-family="system-ui,-apple-system,Segoe UI,sans-serif" font-size="136" font-weight="800" letter-spacing="-4" fill="rgba(255,255,255,0.92)">${safeInitial}</text>
  <rect x="206" y="346" width="14" height="32" rx="7" fill="rgba(255,255,255,0.55)"/>
  <rect x="232" y="330" width="14" height="64" rx="7" fill="rgba(255,255,255,0.90)"/>
  <rect x="258" y="338" width="14" height="48" rx="7" fill="rgba(255,255,255,0.72)"/>
  <rect x="284" y="350" width="14" height="24" rx="7" fill="rgba(255,255,255,0.50)"/>
</svg>`;

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/**
 * Generates an atmospheric cinematic wide SVG banner tailored to each playlist.
 */
export function generatePlaylistBannerDataUrl(name: string, seed = 0): string {
  const cleanName = name.trim() || 'pMusic';
  const h = hashSeed(`${cleanName}#ban#${seed}`);
  const [c1, c2, c3, base] = pickPalette(cleanName, seed);
  const cx1 = 18 + (h % 35);
  const cy1 = 22 + ((h >>> 4) % 45);
  const cx2 = 55 + ((h >>> 8) % 35);
  const cy2 = 30 + ((h >>> 12) % 45);
  const waveY1 = 210 + ((h >>> 6) % 90);
  const waveY2 = 290 + ((h >>> 10) % 70);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1400 480" width="1400" height="480" preserveAspectRatio="xMidYMid slice">
  <defs>
    <linearGradient id="mesh" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${base}"/>
      <stop offset="48%" stop-color="${c1}" stop-opacity="0.72"/>
      <stop offset="100%" stop-color="${c2}" stop-opacity="0.78"/>
    </linearGradient>
    <radialGradient id="g1" cx="${cx1}%" cy="${cy1}%" r="55%">
      <stop offset="0%" stop-color="${c3}" stop-opacity="0.78"/>
      <stop offset="100%" stop-color="${base}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="g2" cx="${cx2}%" cy="${cy2}%" r="55%">
      <stop offset="0%" stop-color="${c2}" stop-opacity="0.74"/>
      <stop offset="100%" stop-color="${base}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1400" height="480" fill="${base}"/>
  <rect width="1400" height="480" fill="url(#mesh)"/>
  <rect width="1400" height="480" fill="url(#g1)"/>
  <rect width="1400" height="480" fill="url(#g2)"/>
  <path d="M0,${waveY1} C320,${waveY1 - 120} 680,${waveY1 + 110} 1040,${waveY1 - 60} C1220,${waveY1 - 120} 1330,${waveY1 - 30} 1400,${waveY1} L1400,480 L0,480 Z" fill="rgba(255,255,255,0.06)"/>
  <path d="M0,${waveY2} C420,${waveY2 + 95} 820,${waveY2 - 110} 1400,${waveY2 - 20} L1400,480 L0,480 Z" fill="rgba(255,255,255,0.045)"/>
</svg>`;

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/**
 * Compresses any local image file into a lightweight data URL bounded to maxW x maxH.
 */
export async function compressImageFileToDataUrl(
  file: File,
  maxW: number,
  maxH: number
): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('No se pudo leer la imagen'));
    reader.readAsDataURL(file);
  });

  if (typeof document === 'undefined' || typeof Image === 'undefined') {
    return dataUrl;
  }

  return new Promise<string>((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const w = img.naturalWidth || maxW;
        const h = img.naturalHeight || maxH;
        const ratio = Math.min(1, maxW / w, maxH / h);
        const tw = Math.max(1, Math.round(w * ratio));
        const th = Math.max(1, Math.round(h * ratio));
        const canvas = document.createElement('canvas');
        canvas.width = tw;
        canvas.height = th;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(dataUrl);
          return;
        }
        ctx.drawImage(img, 0, 0, tw, th);
        const webp = canvas.toDataURL('image/webp', 0.82);
        resolve(webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/jpeg', 0.84));
      } catch {
        resolve(dataUrl);
      }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}
