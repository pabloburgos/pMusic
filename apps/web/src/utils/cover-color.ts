import type { Track } from '@pmusic/core';

const FALLBACK_PALETTES: readonly [string, string, string][] = [
  ['#3A3A42', '#26262C', '#101014'],
  ['#3E3C38', '#292724', '#121110'],
  ['#363B40', '#23272C', '#101215'],
  ['#3C383B', '#272427', '#121012'],
  ['#383D3B', '#242927', '#101412'],
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

  const imgUrl = track?.thumbnailHighUrl ?? track?.thumbnailUrl;
  if (!imgUrl || typeof Image === 'undefined') {
    setRootAmbient(fallback);
    return;
  }

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

        let bestH = 220;
        let bestS = 0;
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
          if (l < 0.1 || l > 0.88) continue;
          const vibrance = s * (1 - Math.abs(l - 0.5) * 1.35);
          if (vibrance > bestScore) {
            if (Math.abs(h - bestH) > 28) secondH = bestH;
            bestScore = vibrance;
            bestH = h;
            bestS = s;
          }
        }

        if (count > 0) {
          const [avgH, avgS] = rgbToHsl(sumR / count, sumG / count, sumB / count);
          if (bestScore > 0.14) {
            const sat1 = Math.min(68, Math.max(24, Math.round(bestS * 100)));
            const sat2 = Math.min(62, Math.max(20, Math.round(sat1 * 0.9)));
            const secondary = Math.abs(secondH - bestH) > 25 ? secondH : avgH + 30;
            setRootAmbient([
              hslCss(bestH, sat1, 40),
              hslCss(secondary, sat2, 30),
              hslCss(bestH, Math.min(44, Math.round(sat1 * 0.65)), 11),
            ]);
          } else {
            // Authentic muted stone/parchment/graphite palette for white, cream, beige or B&W covers
            const mutedSat = Math.min(18, Math.round(avgS * 100));
            setRootAmbient([
              hslCss(avgH, mutedSat, 34),
              hslCss(avgH, Math.max(4, Math.round(mutedSat * 0.75)), 22),
              hslCss(avgH, Math.max(3, Math.round(mutedSat * 0.5)), 10),
            ]);
          }
        }
      } catch {
        setRootAmbient(fallback);
      }
    };
    img.onerror = () => {
      if (token === activeExtractToken) {
        setRootAmbient(fallback);
      }
    };
    img.src = imgUrl;
  } catch {
    setRootAmbient(fallback);
  }
}
