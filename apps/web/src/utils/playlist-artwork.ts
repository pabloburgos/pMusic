function hashSeed(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const ARTWORK_PALETTES: readonly [string, string, string, string][] = [
  ['#6D28D9', '#2563EB', '#EC4899', '#0B0B14'],
  ['#0F766E', '#06B6D4', '#3B82F6', '#07131A'],
  ['#BE123C', '#F97316', '#A855F7', '#160912'],
  ['#047857', '#10B981', '#14B8A6', '#061511'],
  ['#4338CA', '#7C3AED', '#38BDF8', '#0A0B1C'],
  ['#B45309', '#EF4444', '#F59E0B', '#170E08'],
  ['#1D4ED8', '#8B5CF6', '#06B6D4', '#080D1B'],
  ['#9D174D', '#EC4899', '#6366F1', '#150816'],
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
