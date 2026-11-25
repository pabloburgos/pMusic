import type { Track } from '@pmusic/core';

export type RgbTriple = [number, number, number];
export type PaletteTriplet = [RgbTriple, RgbTriple, RgbTriple];

const FALLBACK_PALETTES_RGB: readonly PaletteTriplet[] = [
  [
    [58, 58, 66],
    [38, 38, 44],
    [16, 16, 20],
  ],
  [
    [62, 60, 56],
    [41, 39, 36],
    [18, 17, 16],
  ],
  [
    [54, 59, 64],
    [35, 39, 44],
    [16, 18, 21],
  ],
  [
    [60, 56, 59],
    [39, 36, 39],
    [18, 16, 18],
  ],
  [
    [56, 61, 59],
    [36, 41, 39],
    [16, 20, 18],
  ],
];

const paletteCache = new Map<string, PaletteTriplet>();

let liveRgb: PaletteTriplet = [
  [58, 58, 66],
  [38, 38, 44],
  [16, 16, 20],
];
let paletteAnimRafId = 0;
let activeExtractToken = 0;
let activePaletteTrackKey = '';
const lastAppliedCss: [string, string, string] = ['', '', ''];

function rgbCss(rgb: RgbTriple): string {
  return `rgb(${Math.round(rgb[0])}, ${Math.round(rgb[1])}, ${Math.round(rgb[2])})`;
}

function applyRgbTripletToRoot(p: PaletteTriplet): void {
  liveRgb = [
    [p[0][0], p[0][1], p[0][2]],
    [p[1][0], p[1][1], p[1][2]],
    [p[2][0], p[2][1], p[2][2]],
  ];
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const nextCss: [string, string, string] = [rgbCss(p[0]), rgbCss(p[1]), rgbCss(p[2])];
  if (nextCss[0] !== lastAppliedCss[0]) {
    lastAppliedCss[0] = nextCss[0];
    root.style.setProperty('--pm-ambient-1', nextCss[0]);
  }
  if (nextCss[1] !== lastAppliedCss[1]) {
    lastAppliedCss[1] = nextCss[1];
    root.style.setProperty('--pm-ambient-2', nextCss[1]);
  }
  if (nextCss[2] !== lastAppliedCss[2]) {
    lastAppliedCss[2] = nextCss[2];
    root.style.setProperty('--pm-ambient-3', nextCss[2]);
  }
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

function hslToRgb(h: number, sPct: number, lPct: number): RgbTriple {
  const hn = (((h % 360) + 360) % 360) / 360;
  const s = Math.max(0, Math.min(1, sPct / 100));
  const l = Math.max(0, Math.min(1, lPct / 100));
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue2rgb = (t: number) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  return [
    Math.round(hue2rgb(hn + 1 / 3) * 255),
    Math.round(hue2rgb(hn) * 255),
    Math.round(hue2rgb(hn - 1 / 3) * 255),
  ];
}

function fallbackPaletteForTrack(track: Track | null): PaletteTriplet {
  const idx = track
    ? track.id.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0) % FALLBACK_PALETTES_RGB.length
    : 0;
  return FALLBACK_PALETTES_RGB[idx] ?? FALLBACK_PALETTES_RGB[0]!;
}

function transitionToPalette(target: PaletteTriplet, durationMs: number): void {
  if (paletteAnimRafId && typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(paletteAnimRafId);
    paletteAnimRafId = 0;
  }

  const reduced =
    typeof document !== 'undefined' &&
    document.documentElement.classList.contains('pm-reduced-motion');

  if (durationMs <= 0 || reduced || typeof requestAnimationFrame !== 'function') {
    applyRgbTripletToRoot(target);
    return;
  }

  const from: PaletteTriplet = [
    [liveRgb[0][0], liveRgb[0][1], liveRgb[0][2]],
    [liveRgb[1][0], liveRgb[1][1], liveRgb[1][2]],
    [liveRgb[2][0], liveRgb[2][1], liveRgb[2][2]],
  ];
  const startMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
  let lastPaintMs = -Infinity;

  const step = (now: number) => {
    const rawT = Math.max(0, Math.min(1, (now - startMs) / durationMs));
    if (now - lastPaintMs >= 33 || rawT >= 1) {
      lastPaintMs = now;
      const lerp = (a: number, b: number) => a + (b - a) * rawT;
      applyRgbTripletToRoot([
        [lerp(from[0][0], target[0][0]), lerp(from[0][1], target[0][1]), lerp(from[0][2], target[0][2])],
        [lerp(from[1][0], target[1][0]), lerp(from[1][1], target[1][1]), lerp(from[1][2], target[1][2])],
        [lerp(from[2][0], target[2][0]), lerp(from[2][1], target[2][1]), lerp(from[2][2], target[2][2])],
      ]);
    }
    if (rawT < 1) {
      paletteAnimRafId = requestAnimationFrame(step);
    } else {
      paletteAnimRafId = 0;
    }
  };

  paletteAnimRafId = requestAnimationFrame(step);
}

export function getActiveAmbientTrackKey(): string {
  return activePaletteTrackKey;
}

export function getLiveAmbientRgb(): PaletteTriplet {
  return [
    [liveRgb[0][0], liveRgb[0][1], liveRgb[0][2]],
    [liveRgb[1][0], liveRgb[1][1], liveRgb[1][2]],
    [liveRgb[2][0], liveRgb[2][1], liveRgb[2][2]],
  ];
}

const prebakedBackdropCache = new Map<string, [HTMLCanvasElement, HTMLCanvasElement]>();
const prebakedBackdropInFlight = new Set<string>();
let prebakeScratch: HTMLCanvasElement | null = null;
let prebakeMidA: HTMLCanvasElement | null = null;
let prebakeMidB: HTMLCanvasElement | null = null;

function buildBakedCanvasPair(img: HTMLImageElement): [HTMLCanvasElement, HTMLCanvasElement] | null {
  if (typeof document === 'undefined' || !img.complete || img.naturalWidth <= 0) return null;
  try {
    if (!prebakeScratch) {
      prebakeScratch = document.createElement('canvas');
      prebakeScratch.width = 96;
      prebakeScratch.height = 96;
    }
    if (!prebakeMidA) {
      prebakeMidA = document.createElement('canvas');
      prebakeMidA.width = 24;
      prebakeMidA.height = 24;
    }
    if (!prebakeMidB) {
      prebakeMidB = document.createElement('canvas');
      prebakeMidB.width = 16;
      prebakeMidB.height = 16;
    }
    const iw = img.naturalWidth;
    const ih = img.naturalHeight;
    const side = Math.min(iw, ih);
    const sx = (iw - side) * 0.5;
    const sy = (ih - side) * 0.5;

    const sctx = prebakeScratch.getContext('2d');
    const ctxMidA = prebakeMidA.getContext('2d');
    const ctxMidB = prebakeMidB.getContext('2d');
    if (!sctx || !ctxMidA || !ctxMidB) return null;

    sctx.clearRect(0, 0, 96, 96);
    sctx.imageSmoothingEnabled = true;
    if ('imageSmoothingQuality' in sctx) sctx.imageSmoothingQuality = 'high';
    sctx.drawImage(img, sx, sy, side, side, 0, 0, 96, 96);

    ctxMidA.clearRect(0, 0, 24, 24);
    ctxMidA.imageSmoothingEnabled = true;
    if ('imageSmoothingQuality' in ctxMidA) ctxMidA.imageSmoothingQuality = 'high';
    ctxMidA.drawImage(prebakeScratch, 0, 0, 24, 24);

    ctxMidB.clearRect(0, 0, 16, 16);
    ctxMidB.imageSmoothingEnabled = true;
    if ('imageSmoothingQuality' in ctxMidB) ctxMidB.imageSmoothingQuality = 'high';
    ctxMidB.drawImage(prebakeScratch, 0, 0, 16, 16);

    const outFront = document.createElement('canvas');
    outFront.width = 48;
    outFront.height = 48;
    const cf = outFront.getContext('2d');

    const outBack = document.createElement('canvas');
    outBack.width = 48;
    outBack.height = 48;
    const cb = outBack.getContext('2d');

    if (!cf || !cb) return null;
    cf.imageSmoothingEnabled = true;
    if ('imageSmoothingQuality' in cf) cf.imageSmoothingQuality = 'high';
    cf.drawImage(prebakeMidA, 0, 0, 48, 48);

    cb.imageSmoothingEnabled = true;
    if ('imageSmoothingQuality' in cb) cb.imageSmoothingQuality = 'high';
    cb.drawImage(prebakeMidB, 0, 0, 48, 48);

    return [outFront, outBack];
  } catch {
    return null;
  }
}

export function getPrebakedMobileBackdrop(
  url?: string | null
): [HTMLCanvasElement, HTMLCanvasElement] | null {
  if (!url) return null;
  return prebakedBackdropCache.get(url) ?? null;
}

export function prebakeMobileBackdrop(url?: string | null, loadedImg?: HTMLImageElement | null): void {
  if (!url || typeof document === 'undefined') return;
  if (prebakedBackdropCache.has(url)) return;
  const commitImg = (img: HTMLImageElement) => {
    const pair = buildBakedCanvasPair(img);
    if (!pair) return;
    prebakedBackdropCache.set(url, pair);
    if (prebakedBackdropCache.size > 24) {
      const oldest = prebakedBackdropCache.keys().next().value;
      if (oldest) prebakedBackdropCache.delete(oldest);
    }
  };
  if (loadedImg && loadedImg.complete && loadedImg.naturalWidth > 0) {
    commitImg(loadedImg);
    return;
  }
  if (typeof Image === 'undefined' || prebakedBackdropInFlight.has(url)) return;
  prebakedBackdropInFlight.add(url);
  const img = new Image();
  img.decoding = 'async';
  img.onload = () => {
    prebakedBackdropInFlight.delete(url);
    commitImg(img);
  };
  img.onerror = () => {
    prebakedBackdropInFlight.delete(url);
  };
  img.src = url;
  if (img.complete && img.naturalWidth > 0) {
    prebakedBackdropInFlight.delete(url);
    commitImg(img);
  }
}

export function getCachedPaletteCss(coverUrl?: string | null): [string, string, string] {
  const cached = coverUrl ? paletteCache.get(coverUrl) : undefined;
  const p = cached ?? liveRgb;
  return [rgbCss(p[0]), rgbCss(p[1]), rgbCss(p[2])];
}

/**
 * Extracts vibrant harmonious ambient colors from the track cover and interpolates
 * `--pm-ambient-1/2/3` strictly linearly over `durationMs` (0->10->20->...->100)
 * so backdrop color shifts are steady and seamless without abrupt jumps.
 */
export function animateAmbientPaletteFromCover(track: Track | null, durationMs = 1100): void {
  if (typeof document === 'undefined') return;
  const fallback = fallbackPaletteForTrack(track);
  const imgUrl = track?.thumbnailHighUrl ?? track?.thumbnailUrl ?? '';
  activePaletteTrackKey = track ? `${track.id}::${imgUrl}` : '';

  if (!imgUrl) {
    transitionToPalette(fallback, durationMs);
    return;
  }

  const cached = paletteCache.get(imgUrl);
  if (cached) {
    transitionToPalette(cached, durationMs);
    return;
  }

  if (typeof Image === 'undefined') {
    transitionToPalette(fallback, durationMs);
    return;
  }

  const startedAtMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const token = ++activeExtractToken;
  try {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (token !== activeExtractToken) return;
      const elapsed = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAtMs;
      const remainingMs = durationMs <= 0 ? 0 : Math.max(280, durationMs - elapsed);
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
          let extracted: PaletteTriplet;
          if (bestScore > 0.14) {
            const sat1 = Math.min(68, Math.max(24, Math.round(bestS * 100)));
            const sat2 = Math.min(62, Math.max(20, Math.round(sat1 * 0.9)));
            const secondary = Math.abs(secondH - bestH) > 25 ? secondH : avgH + 30;
            extracted = [
              hslToRgb(bestH, sat1, 40),
              hslToRgb(secondary, sat2, 30),
              hslToRgb(bestH, Math.min(44, Math.round(sat1 * 0.65)), 11),
            ];
          } else {
            const mutedSat = Math.min(18, Math.round(avgS * 100));
            extracted = [
              hslToRgb(avgH, mutedSat, 34),
              hslToRgb(avgH, Math.max(4, Math.round(mutedSat * 0.75)), 22),
              hslToRgb(avgH, Math.max(3, Math.round(mutedSat * 0.5)), 10),
            ];
          }
          paletteCache.set(imgUrl, extracted);
          transitionToPalette(extracted, remainingMs);
        }
      } catch {
        transitionToPalette(fallback, remainingMs);
      }
    };
    img.onerror = () => {
      if (token === activeExtractToken) {
        const elapsed = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAtMs;
        const remainingMs = durationMs <= 0 ? 0 : Math.max(280, durationMs - elapsed);
        transitionToPalette(fallback, remainingMs);
      }
    };
    img.src = imgUrl;
  } catch {
    transitionToPalette(fallback, durationMs);
  }
}

export function applyAmbientPaletteFromCover(track: Track | null, durationMs = 1100): void {
  animateAmbientPaletteFromCover(track, durationMs);
}
