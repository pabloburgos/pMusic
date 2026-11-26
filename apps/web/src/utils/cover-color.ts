import type { Track } from '@pmusic/core';

export type RgbTriple = [number, number, number];
export type PaletteTriplet = [RgbTriple, RgbTriple, RgbTriple];
export type PaletteQuad = [RgbTriple, RgbTriple, RgbTriple, RgbTriple];

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

const paletteCache = new Map<
  string,
  {
    triplet: PaletteTriplet;
    quad: PaletteQuad;
    luma: number;
    perceptualLuma: number;
    brightFraction: number;
  }
>();

let liveRgb: PaletteTriplet = [
  [58, 58, 66],
  [38, 38, 44],
  [16, 16, 20],
];
let liveQuad: PaletteQuad = [
  [58, 58, 66],
  [48, 48, 55],
  [38, 38, 44],
  [18, 18, 22],
];
let liveLuminance = 0.45;
export interface CoverBrightnessMetrics {
  perceptualLuma: number;
  brightFraction: number;
}
let liveCoverBrightness: CoverBrightnessMetrics = {
  perceptualLuma: 0.22,
  brightFraction: 0.1,
};
const coverBrightnessListeners = new Set<(metrics: CoverBrightnessMetrics) => void>();

function updateLiveCoverBrightness(perceptualLuma: number, brightFraction: number): void {
  const nextLuma = Math.max(0, Math.min(1, Number.isFinite(perceptualLuma) ? perceptualLuma : 0.22));
  const nextFrac = Math.max(0, Math.min(1, Number.isFinite(brightFraction) ? brightFraction : 0.1));
  if (
    Math.abs(nextLuma - liveCoverBrightness.perceptualLuma) < 0.005 &&
    Math.abs(nextFrac - liveCoverBrightness.brightFraction) < 0.005
  ) {
    return;
  }
  liveCoverBrightness = { perceptualLuma: nextLuma, brightFraction: nextFrac };
  for (const listener of coverBrightnessListeners) {
    try {
      listener(liveCoverBrightness);
    } catch {
      // ignore subscriber errors
    }
  }
}

export function getLiveCoverBrightness(): CoverBrightnessMetrics {
  return liveCoverBrightness;
}

export function subscribeCoverBrightness(
  listener: (metrics: CoverBrightnessMetrics) => void
): () => void {
  coverBrightnessListeners.add(listener);
  return () => {
    coverBrightnessListeners.delete(listener);
  };
}

export function shouldUseDarkInkOnBackdrop(params: {
  perceptualLuma: number;
  brightFraction: number;
  backdropStyle: 'fluid' | 'paint' | 'pulse' | 'minimal';
  currentlyLight?: boolean;
}): boolean {
  if (params.backdropStyle === 'minimal') return false;
  const h = params.currentlyLight ? 0.05 : 0;
  if (params.backdropStyle === 'fluid') {
    return params.perceptualLuma >= 0.58 - h && params.brightFraction >= 0.48 - h;
  }
  return params.perceptualLuma >= 0.52 - h && params.brightFraction >= 0.44 - h;
}
let paletteAnimRafId = 0;
let activeExtractToken = 0;
let activePaletteTrackKey = '';
const lastAppliedCss: [string, string, string] = ['', '', ''];

function rgbCss(rgb: RgbTriple): string {
  return `rgb(${Math.round(rgb[0])}, ${Math.round(rgb[1])}, ${Math.round(rgb[2])})`;
}

function applyCssPaletteToRoot(p: PaletteTriplet, transitionMs?: number): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (typeof transitionMs === 'number' && Number.isFinite(transitionMs)) {
    const clampedMs = transitionMs <= 0 ? 0 : Math.max(250, Math.round(transitionMs));
    root.style.setProperty('--pm-ambient-transition-ms', `${clampedMs}ms`);
  }
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

function applyRgbTripletToRoot(p: PaletteTriplet, transitionMs?: number): void {
  liveRgb = [
    [p[0][0], p[0][1], p[0][2]],
    [p[1][0], p[1][1], p[1][2]],
    [p[2][0], p[2][1], p[2][2]],
  ];
  applyCssPaletteToRoot(p, transitionMs);
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

function tripletToDefaultQuad(p: PaletteTriplet): PaletteQuad {
  const mid: RgbTriple = [
    Math.round((p[0][0] + p[1][0]) * 0.5),
    Math.round((p[0][1] + p[1][1]) * 0.5),
    Math.round((p[0][2] + p[1][2]) * 0.5),
  ];
  return [p[0], p[1], mid, p[2]];
}

function transitionToPalette(
  target: PaletteTriplet,
  durationMs: number,
  targetLuma?: number,
  targetQuad?: PaletteQuad
): void {
  if (paletteAnimRafId && typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(paletteAnimRafId);
    paletteAnimRafId = 0;
  }

  const nextLuma =
    typeof targetLuma === 'number' && Number.isFinite(targetLuma)
      ? Math.max(0.15, Math.min(1, targetLuma))
      : liveLuminance;
  const resolvedTargetQuad = targetQuad ?? tripletToDefaultQuad(target);

  const reduced =
    typeof document !== 'undefined' &&
    document.documentElement.classList.contains('pm-reduced-motion');

  if (durationMs <= 0 || reduced || typeof requestAnimationFrame !== 'function') {
    liveLuminance = nextLuma;
    liveQuad = [
      [...resolvedTargetQuad[0]],
      [...resolvedTargetQuad[1]],
      [...resolvedTargetQuad[2]],
      [...resolvedTargetQuad[3]],
    ];
    applyRgbTripletToRoot(target, 0);
    return;
  }

  const fromLuma = liveLuminance;
  const from: PaletteTriplet = [
    [liveRgb[0][0], liveRgb[0][1], liveRgb[0][2]],
    [liveRgb[1][0], liveRgb[1][1], liveRgb[1][2]],
    [liveRgb[2][0], liveRgb[2][1], liveRgb[2][2]],
  ];
  const fromQuad: PaletteQuad = [
    [liveQuad[0][0], liveQuad[0][1], liveQuad[0][2]],
    [liveQuad[1][0], liveQuad[1][1], liveQuad[1][2]],
    [liveQuad[2][0], liveQuad[2][1], liveQuad[2][2]],
    [liveQuad[3][0], liveQuad[3][1], liveQuad[3][2]],
  ];

  // Trigger native CSS @property GPU transition ONCE instead of mutating :root every 60ms
  applyCssPaletteToRoot(target, durationMs);

  const startMs = typeof performance !== 'undefined' ? performance.now() : Date.now();

  const step = (now: number) => {
    const rawT = Math.max(0, Math.min(1, (now - startMs) / durationMs));
    const lerp = (a: number, b: number) => a + (b - a) * rawT;
    liveLuminance = lerp(fromLuma, nextLuma);
    liveQuad = [
      [
        lerp(fromQuad[0][0], resolvedTargetQuad[0][0]),
        lerp(fromQuad[0][1], resolvedTargetQuad[0][1]),
        lerp(fromQuad[0][2], resolvedTargetQuad[0][2]),
      ],
      [
        lerp(fromQuad[1][0], resolvedTargetQuad[1][0]),
        lerp(fromQuad[1][1], resolvedTargetQuad[1][1]),
        lerp(fromQuad[1][2], resolvedTargetQuad[1][2]),
      ],
      [
        lerp(fromQuad[2][0], resolvedTargetQuad[2][0]),
        lerp(fromQuad[2][1], resolvedTargetQuad[2][1]),
        lerp(fromQuad[2][2], resolvedTargetQuad[2][2]),
      ],
      [
        lerp(fromQuad[3][0], resolvedTargetQuad[3][0]),
        lerp(fromQuad[3][1], resolvedTargetQuad[3][1]),
        lerp(fromQuad[3][2], resolvedTargetQuad[3][2]),
      ],
    ];
    liveRgb = [
      [lerp(from[0][0], target[0][0]), lerp(from[0][1], target[0][1]), lerp(from[0][2], target[0][2])],
      [lerp(from[1][0], target[1][0]), lerp(from[1][1], target[1][1]), lerp(from[1][2], target[1][2])],
      [lerp(from[2][0], target[2][0]), lerp(from[2][1], target[2][1]), lerp(from[2][2], target[2][2])],
    ];
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

export function getLiveAmbientQuad(): PaletteQuad {
  return [
    [liveQuad[0][0], liveQuad[0][1], liveQuad[0][2]],
    [liveQuad[1][0], liveQuad[1][1], liveQuad[1][2]],
    [liveQuad[2][0], liveQuad[2][1], liveQuad[2][2]],
    [liveQuad[3][0], liveQuad[3][1], liveQuad[3][2]],
  ];
}

export function getLiveAmbientLuminance(): number {
  return liveLuminance;
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
    if (prebakedBackdropCache.size > 6) {
      const oldest = prebakedBackdropCache.keys().next().value;
      if (oldest) {
        const oldPair = prebakedBackdropCache.get(oldest);
        if (oldPair) {
          oldPair[0].width = 0;
          oldPair[0].height = 0;
          oldPair[1].width = 0;
          oldPair[1].height = 0;
        }
        prebakedBackdropCache.delete(oldest);
      }
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
  const p = cached?.triplet ?? liveRgb;
  return [rgbCss(p[0]), rgbCss(p[1]), rgbCss(p[2])];
}

const backdropCleanupHooks = new Set<() => void>();

export function registerBackdropCleanupHook(fn: () => void): void {
  backdropCleanupHooks.add(fn);
}

export function trimBackdropMemoryCaches(): void {
  for (const [cA, cB] of prebakedBackdropCache.values()) {
    cA.width = 0;
    cA.height = 0;
    cB.width = 0;
    cB.height = 0;
  }
  prebakedBackdropCache.clear();
  prebakedBackdropInFlight.clear();
  for (const fn of backdropCleanupHooks) {
    try {
      fn();
    } catch {
      // ignore cleanup failure
    }
  }
}

function toneDownExtremeNeon(rgb: RgbTriple): RgbTriple {
  const [h, s, l] = rgbToHsl(rgb[0], rgb[1], rgb[2]);
  const naturalSatPct = Math.min(68, Math.round(s * 100));
  const boundedLumaPct = Math.max(12, Math.min(76, Math.round(l * 100)));
  return hslToRgb(h, naturalSatPct, boundedLumaPct);
}

function rgbDist(a: RgbTriple, b: RgbTriple): number {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function srgbChannelToLinear(c: number): number {
  const n = c / 255;
  return n <= 0.03928 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4);
}

/**
 * Quantizes the cover into a 5x5x5 color space to extract up to 4 real tones
 * proportional to cover area + visual identity, never inflating pastel/neutral covers into neon.
 */
function extractCoverEssenceQuad(data: Uint8ClampedArray): {
  quad: PaletteQuad;
  avgL: number;
  perceptualLuma: number;
  brightFraction: number;
} {
  const buckets = new Map<
    number,
    { sumR: number; sumG: number; sumB: number; count: number }
  >();
  let totalR = 0;
  let totalG = 0;
  let totalB = 0;
  let totalPerceptualLuma = 0;
  let brightPixels = 0;
  let totalCount = 0;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] ?? 0;
    const g = data[i + 1] ?? 0;
    const b = data[i + 2] ?? 0;
    const a = data[i + 3] ?? 255;
    if (a < 180) continue;
    totalR += r;
    totalG += g;
    totalB += b;
    const relLuma =
      0.2126 * srgbChannelToLinear(r) +
      0.7152 * srgbChannelToLinear(g) +
      0.0722 * srgbChannelToLinear(b);
    totalPerceptualLuma += relLuma;
    if (relLuma >= 0.55) brightPixels++;
    totalCount++;

    const qr = Math.min(4, Math.floor(r / 51));
    const qg = Math.min(4, Math.floor(g / 51));
    const qb = Math.min(4, Math.floor(b / 51));
    const key = qr * 25 + qg * 5 + qb;
    const existing = buckets.get(key);
    if (existing) {
      existing.sumR += r;
      existing.sumG += g;
      existing.sumB += b;
      existing.count++;
    } else {
      buckets.set(key, { sumR: r, sumG: g, sumB: b, count: 1 });
    }
  }

  if (totalCount === 0) {
    return {
      quad: [
        [58, 58, 66],
        [48, 48, 55],
        [38, 38, 44],
        [18, 18, 22],
      ],
      avgL: 0.45,
      perceptualLuma: 0.22,
      brightFraction: 0.1,
    };
  }

  const avgRgb: RgbTriple = [totalR / totalCount, totalG / totalCount, totalB / totalCount];
  const [, , avgL] = rgbToHsl(avgRgb[0], avgRgb[1], avgRgb[2]);
  const perceptualLuma = totalPerceptualLuma / totalCount;
  const brightFraction = brightPixels / totalCount;

  const ranked = Array.from(buckets.values())
    .map((b) => {
      const rgb: RgbTriple = [
        Math.round(b.sumR / b.count),
        Math.round(b.sumG / b.count),
        Math.round(b.sumB / b.count),
      ];
      const [, sat, luma] = rgbToHsl(rgb[0], rgb[1], rgb[2]);
      const prominence = b.count * (0.72 + sat * 0.45);
      return {
        rgb: toneDownExtremeNeon(rgb),
        luma,
        prominence,
      };
    })
    .sort((a, b) => b.prominence - a.prominence);

  const chosen: Array<{ rgb: RgbTriple; luma: number; prominence: number }> = [];
  for (const minDist of [38, 20, 0]) {
    for (const item of ranked) {
      if (chosen.length >= 4) break;
      if (chosen.some((c) => rgbDist(c.rgb, item.rgb) < minDist && minDist > 0)) continue;
      if (minDist === 0 && chosen.includes(item)) continue;
      chosen.push(item);
    }
    if (chosen.length >= 4) break;
  }

  // Minimalist / monochrome covers: fill remaining slots with authentic tonal steps from cover average
  const baseTone = toneDownExtremeNeon(avgRgb);
  const [baseH, baseS, baseL] = rgbToHsl(baseTone[0], baseTone[1], baseTone[2]);
  const mutedSatPct = Math.min(40, Math.round(baseS * 100));
  const tonalFallbackLumas = [
    Math.min(72, Math.max(28, Math.round(baseL * 100) + 12)),
    Math.min(62, Math.max(22, Math.round(baseL * 100))),
    Math.min(50, Math.max(16, Math.round(baseL * 100) - 10)),
    Math.min(34, Math.max(11, Math.round(baseL * 100) - 22)),
  ];
  let fallbackIdx = 0;
  while (chosen.length < 4) {
    const stepL = tonalFallbackLumas[fallbackIdx % tonalFallbackLumas.length]!;
    fallbackIdx++;
    chosen.push({
      rgb: hslToRgb(baseH, mutedSatPct, stepL),
      luma: stepL / 100,
      prominence: 0,
    });
  }

  // Deepest tone goes in slot 4 for organic edge grounding; remaining 3 ordered by cover prominence
  let deepestIdx = 0;
  for (let i = 1; i < chosen.length; i++) {
    if (chosen[i]!.luma < chosen[deepestIdx]!.luma) {
      deepestIdx = i;
    }
  }
  const deepest = chosen[deepestIdx]!.rgb;
  const others = chosen.filter((_, i) => i !== deepestIdx).map((c) => c.rgb);
  const quad: PaletteQuad = [
    others[0] ?? baseTone,
    others[1] ?? others[0] ?? baseTone,
    others[2] ?? others[1] ?? others[0] ?? baseTone,
    deepest,
  ];
  return { quad, avgL, perceptualLuma, brightFraction };
}

/**
 * Extracts faithful harmonious cover colors (4 real cover tones + luminance) and interpolates
 * `--pm-ambient-1/2/3` cleanly over `durationMs` so backdrop shifts match the artwork essence.
 */
export function animateAmbientPaletteFromCover(track: Track | null, durationMs = 1100): void {
  if (typeof document === 'undefined') return;
  const fallback = fallbackPaletteForTrack(track);
  const imgUrl = track?.thumbnailHighUrl ?? track?.thumbnailUrl ?? '';
  activePaletteTrackKey = track ? `${track.id}::${imgUrl}` : '';

  if (!imgUrl) {
    updateLiveCoverBrightness(0.22, 0.1);
    transitionToPalette(fallback, durationMs);
    return;
  }

  const cached = paletteCache.get(imgUrl);
  if (cached) {
    updateLiveCoverBrightness(cached.perceptualLuma, cached.brightFraction);
    transitionToPalette(cached.triplet, durationMs, cached.luma, cached.quad);
    return;
  }

  if (typeof Image === 'undefined') {
    updateLiveCoverBrightness(0.22, 0.1);
    transitionToPalette(fallback, durationMs);
    return;
  }

  const startedAtMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const token = ++activeExtractToken;
  const loadSample = (srcUrl: string, allowProxyRetry: boolean) => {
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

          const { quad, avgL, perceptualLuma, brightFraction } = extractCoverEssenceQuad(data);
          const extracted: PaletteTriplet = [quad[0], quad[1], quad[3]];
          paletteCache.set(imgUrl, {
            triplet: extracted,
            quad,
            luma: avgL,
            perceptualLuma,
            brightFraction,
          });
          if (paletteCache.size > 32) {
            const oldest = paletteCache.keys().next().value;
            if (oldest) paletteCache.delete(oldest);
          }
          updateLiveCoverBrightness(perceptualLuma, brightFraction);
          transitionToPalette(extracted, remainingMs, avgL, quad);
        } catch {
          updateLiveCoverBrightness(0.22, 0.1);
          transitionToPalette(fallback, remainingMs);
        }
      };
      img.onerror = () => {
        if (token !== activeExtractToken) return;
        const isProxyEligible =
          allowProxyRetry &&
          srcUrl.startsWith('https://') &&
          typeof window !== 'undefined' &&
          window.location?.hostname !== 'appassets.pmusic.local' &&
          (window.location?.protocol === 'http:' || window.location?.protocol === 'https:');
        if (isProxyEligible) {
          loadSample(`/api/cover-proxy?url=${encodeURIComponent(srcUrl)}`, false);
          return;
        }
        const elapsed = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAtMs;
        const remainingMs = durationMs <= 0 ? 0 : Math.max(280, durationMs - elapsed);
        updateLiveCoverBrightness(0.22, 0.1);
        transitionToPalette(fallback, remainingMs);
      };
      img.src = srcUrl;
    } catch {
      updateLiveCoverBrightness(0.22, 0.1);
      transitionToPalette(fallback, durationMs);
    }
  };
  loadSample(imgUrl, true);
}

export function applyAmbientPaletteFromCover(track: Track | null, durationMs = 1100): void {
  animateAmbientPaletteFromCover(track, durationMs);
}

const characteristicColorCache = new Map<string, RgbTriple>();

function sampleImageCharacteristicColor(url: string): Promise<RgbTriple | null> {
  if (!url) return Promise.resolve(null);
  const hit = characteristicColorCache.get(url);
  if (hit) return Promise.resolve(hit);
  if (typeof document === 'undefined' || typeof Image === 'undefined') {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    try {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = 32;
          canvas.height = 32;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve(null);
            return;
          }
          ctx.drawImage(img, 0, 0, 32, 32);
          const { data } = ctx.getImageData(0, 0, 32, 32);

          // 12-bucket hue histogram weighted by saturation so we find the artist photo's dominant color
          const buckets = Array.from({ length: 12 }, () => ({ weight: 0, hSum: 0, sSum: 0 }));
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
            if (s < 0.16 || l < 0.08 || l > 0.88) continue;
            const bIdx = Math.floor((((h % 360) + 360) % 360) / 30) % 12;
            const w = s * (1 - Math.abs(l - 0.45) * 1.1);
            if (w <= 0) continue;
            const bkt = buckets[bIdx]!;
            bkt.weight += w;
            bkt.hSum += h * w;
            bkt.sSum += s * w;
          }

          let chosen: RgbTriple;
          const bestBucket = buckets.reduce((a, b) => (b.weight > a.weight ? b : a), buckets[0]!);
          if (bestBucket.weight > 0.6) {
            const avgHue = bestBucket.hSum / bestBucket.weight;
            const avgSat = bestBucket.sSum / bestBucket.weight;
            const satPct = Math.min(72, Math.max(32, Math.round(avgSat * 100)));
            chosen = hslToRgb(avgHue, satPct, 28);
          } else if (count > 0) {
            const [avgH, avgS] = rgbToHsl(sumR / count, sumG / count, sumB / count);
            const satPct = avgS > 0.12 ? Math.min(54, Math.max(24, Math.round(avgS * 100))) : 16;
            chosen = hslToRgb(avgH, satPct, 22);
          } else {
            resolve(null);
            return;
          }

          characteristicColorCache.set(url, chosen);
          if (characteristicColorCache.size > 64) {
            const oldest = characteristicColorCache.keys().next().value;
            if (oldest) characteristicColorCache.delete(oldest);
          }
          resolve(chosen);
        } catch {
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = url;
    } catch {
      resolve(null);
    }
  });
}

/**
 * Extracts the most characteristic color from an artist banner/avatar URL list for sticky header styling.
 */
export async function extractCharacteristicImageColor(
  urls: readonly (string | null | undefined)[]
): Promise<RgbTriple | null> {
  for (const raw of urls) {
    const url = raw?.trim();
    if (!url) continue;
    const rgb = await sampleImageCharacteristicColor(url);
    if (rgb) return rgb;
  }
  return null;
}
