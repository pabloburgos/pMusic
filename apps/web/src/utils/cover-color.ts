import type { Track } from '@pmusic/core';

const FALLBACK_PALETTES: readonly [string, string, string][] = [
  ['#6D28D9', '#1D4ED8', '#111024'],
  ['#BE185D', '#1E3A8A', '#170E1D'],
  ['#0F766E', '#1E293B', '#0B181A'],
  ['#B45309', '#4C1D95', '#17111A'],
  ['#0369A1', '#312E81', '#0D1321'],
];

function setRootAmbient(p: readonly [string, string, string]): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.style.setProperty('--pm-ambient-1', p[0]);
  root.style.setProperty('--pm-ambient-2', p[1]);
  root.style.setProperty('--pm-ambient-3', p[2]);
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return [Math.round(h * 60), s, l];
}

function hslCss(h: number, sPct: number, lPct: number): string {
  return `hsl(${((h % 360) + 360) % 360} ${Math.round(sPct)}% ${Math.round(lPct)}%)`;
}

let activeExtractToken = 0;

/**
 * Extracts vibrant harmonious ambient colors from the active song cover art
 * for the Now Playing / Song backdrop (falls back deterministically if CORS blocks pixel read).
 */
export function applyAmbientPaletteFromCover(track: Track | null): void {
  if (typeof document === 'undefined') return;
  const idx = track
    ? track.id.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0) % FALLBACK_PALETTES.length
    : 0;
  const fallback = FALLBACK_PALETTES[idx] ?? FALLBACK_PALETTES[0]!;
  setRootAmbient(fallback);

  const imgUrl = track?.thumbnailHighUrl ?? track?.thumbnailUrl;
  if (!imgUrl || typeof Image === 'undefined') return;

  const token = ++activeExtractToken;
  try {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (token !== activeExtractToken) return;
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 24;
        canvas.height = 24;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, 24, 24);
        const { data } = ctx.getImageData(0, 0, 24, 24);

        let bestH = 260;
        let bestScore = -1;
        let secondH = 215;
        let sumR = 0;
        let sumG = 0;
        let sumB = 0;
        let count = 0;

        for (let i = 0; i < data.length; i += 4) {
          const r = data[i] ?? 0;
          const g = data[i + 1] ?? 0;
          const b = data[i + 2] ?? 0;
          const a = data[i + 3] ?? 255;
          if (a < 180) continue;
          sumR += r;
          sumG += g;
          sumB += b;
          count++;

          const [h, s, l] = rgbToHsl(r, g, b);
          if (l < 0.12 || l > 0.85) continue;
          const vibrance = s * (1 - Math.abs(l - 0.5) * 1.4);
          if (vibrance > bestScore) {
            if (Math.abs(h - bestH) > 28) secondH = bestH;
            bestScore = vibrance;
            bestH = h;
          }
        }

        if (count > 0 && bestScore > 0.12) {
          const avgH = rgbToHsl(sumR / count, sumG / count, sumB / count)[0];
          const secondary = Math.abs(secondH - bestH) > 25 ? secondH : avgH + 35;
          setRootAmbient([
            hslCss(bestH, 68, 40),
            hslCss(secondary, 62, 32),
            hslCss(bestH, 45, 11),
          ]);
        }
      } catch {
        // Keep deterministic fallback palette when canvas is tainted
      }
    };
    img.onerror = () => {
      // Keep deterministic fallback palette
    };
    img.src = imgUrl;
  } catch {
    // Ignore in test environments
  }
}
