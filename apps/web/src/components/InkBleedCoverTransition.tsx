import React, { useEffect, useMemo, useRef } from 'react';

interface InkBleedCoverTransitionProps {
  outgoingUrl: string;
  outgoingTitle: string;
  incomingUrl: string;
  incomingTitle: string;
  seedKey: string;
  durationSec: number;
}

const GRID = 128;
const TOTAL = GRID * GRID;
const CANVAS_SIZE = 384;

function hash2D(ix: number, iy: number, seed: number): number {
  let h = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 1442695041);
  h = (h ^ (h >>> 13)) | 0;
  h = Math.imul(h, 1274126177);
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967295;
}

function quintic(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function valueNoise2D(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const u = quintic(fx);
  const v = quintic(fy);

  const a = hash2D(ix, iy, seed);
  const b = hash2D(ix + 1, iy, seed);
  const c = hash2D(ix, iy + 1, seed);
  const d = hash2D(ix + 1, iy + 1, seed);

  const ab = a + (b - a) * u;
  const cd = c + (d - c) * u;
  return ab + (cd - ab) * v;
}

function fbm3(x: number, y: number, seed: number): number {
  const o1 = valueNoise2D(x * 3.2, y * 3.2, seed);
  const o2 = valueNoise2D(x * 6.8 + 11.4, y * 6.8 - 7.1, seed + 17);
  const o3 = valueNoise2D(x * 13.5 - 4.7, y * 13.5 + 19.3, seed + 53);
  return o1 * 0.56 + o2 * 0.29 + o3 * 0.15;
}

function buildInkField(seed: number): Float32Array {
  const field = new Float32Array(TOTAL);
  let minVal = Infinity;
  let maxVal = -Infinity;

  for (let py = 0; py < GRID; py++) {
    const ny = py / GRID;
    for (let px = 0; px < GRID; px++) {
      const nx = px / GRID;
      const wx = fbm3(nx + 5.2, ny + 1.3, seed + 31);
      const wy = fbm3(nx + 1.7, ny + 9.2, seed + 89);
      const h = fbm3(nx + 0.65 * wx, ny + 0.65 * wy, seed + 149);
      const idx = py * GRID + px;
      field[idx] = h;
      if (h < minVal) minVal = h;
      if (h > maxVal) maxVal = h;
    }
  }

  const span = Math.max(1e-5, maxVal - minVal);
  for (let i = 0; i < TOTAL; i++) {
    field[i] = (field[i]! - minVal) / span;
  }
  return field;
}

export const InkBleedCoverTransition: React.FC<InkBleedCoverTransitionProps> = ({
  outgoingUrl,
  outgoingTitle,
  incomingUrl,
  incomingTitle,
  seedKey,
  durationSec,
}) => {
  const incomingImgRef = useRef<HTMLImageElement | null>(null);
  const fallbackOutgoingRef = useRef<HTMLImageElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const seed = useMemo(() => {
    let hash = 2166136261;
    for (let i = 0; i < seedKey.length; i++) {
      hash ^= seedKey.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (Math.abs(hash) % 940) + 17;
  }, [seedKey]);

  const inkField = useMemo(() => buildInkField(seed), [seed]);

  useEffect(() => {
    const totalMs = Math.max(1200, durationSec * 1000);
    const startMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
    let rafId = 0;
    let cancelled = false;
    let hidFallback = false;

    const canvas = canvasRef.current;
    let displayCtx: CanvasRenderingContext2D | null = null;
    try {
      displayCtx = canvas?.getContext('2d') ?? null;
    } catch {
      displayCtx = null;
    }

    let maskCanvas: HTMLCanvasElement | null = null;
    let maskCtx: CanvasRenderingContext2D | null = null;
    let maskImg: ImageData | null = null;
    let mask32: Uint32Array | null = null;

    let rimCanvas: HTMLCanvasElement | null = null;
    let rimCtx: CanvasRenderingContext2D | null = null;
    let rimImg: ImageData | null = null;
    let rim32: Uint32Array | null = null;

    let outgoingImg: HTMLImageElement | null = null;
    let outgoingReady = false;

    if (displayCtx && typeof document !== 'undefined') {
      displayCtx.imageSmoothingEnabled = true;
      if ('imageSmoothingQuality' in displayCtx) {
        displayCtx.imageSmoothingQuality = 'high';
      }

      maskCanvas = document.createElement('canvas');
      maskCanvas.width = GRID;
      maskCanvas.height = GRID;
      maskCtx = maskCanvas.getContext('2d');

      rimCanvas = document.createElement('canvas');
      rimCanvas.width = GRID;
      rimCanvas.height = GRID;
      rimCtx = rimCanvas.getContext('2d');

      if (maskCtx && rimCtx) {
        maskImg = maskCtx.createImageData(GRID, GRID);
        mask32 = new Uint32Array(maskImg.data.buffer);
        rimImg = rimCtx.createImageData(GRID, GRID);
        rim32 = new Uint32Array(rimImg.data.buffer);
      }

      outgoingImg = new Image();
      outgoingImg.decoding = 'async';
      outgoingImg.onload = () => {
        outgoingReady = true;
      };
      outgoingImg.src = outgoingUrl;
      if (outgoingImg.complete && outgoingImg.naturalWidth > 0) {
        outgoingReady = true;
      }
    }

    const drawFrame = (pRaw: number) => {
      const p = 0.5 - 0.5 * Math.cos(Math.PI * pRaw);

      if (incomingImgRef.current) {
        // Keep incoming hidden during initial subpixel frames, then ramp opacity cleanly so edges never bleed white
        const inAlpha = pRaw < 0.06 ? Math.max(0, pRaw / 0.06) : 1;
        const scale = 1.035 - 0.035 * p;
        incomingImgRef.current.style.transform = `translate3d(0, 0, 0) scale(${scale.toFixed(4)})`;
        incomingImgRef.current.style.opacity = inAlpha.toFixed(3);
      }

      const canPaintCanvas = Boolean(
        displayCtx &&
          maskCtx &&
          maskCanvas &&
          maskImg &&
          mask32 &&
          rimCtx &&
          rimCanvas &&
          rimImg &&
          rim32 &&
          outgoingImg &&
          outgoingReady
      );

      if (canPaintCanvas && displayCtx && maskCtx && maskCanvas && maskImg && mask32 && rimCtx && rimCanvas && rimImg && rim32 && outgoingImg) {
        const thr = -0.03 + 1.18 * p;
        const invSoft = 1 / 0.145;
        const rimPeak = Math.sin(Math.PI * pRaw) * 0.42;

        for (let i = 0; i < TOTAL; i++) {
          const d = (inkField[i]! - thr) * invSoft;
          if (d <= 0) {
            mask32[i] = 0;
            rim32[i] = 0;
          } else if (d >= 1) {
            mask32[i] = 0xffffffff;
            rim32[i] = 0;
          } else {
            const s = d * d * (3 - 2 * d);
            const alpha = Math.max(0, Math.min(255, (s * 255) | 0));
            mask32[i] = (0x00ffffff | (alpha << 24)) >>> 0;
            const rimA = Math.max(0, Math.min(255, (Math.sin(d * Math.PI) * rimPeak * 255) | 0));
            rim32[i] = (0x000a0606 | (rimA << 24)) >>> 0;
          }
        }

        maskCtx.putImageData(maskImg, 0, 0);
        rimCtx.putImageData(rimImg, 0, 0);

        const iw = outgoingImg.naturalWidth || CANVAS_SIZE;
        const ih = outgoingImg.naturalHeight || CANVAS_SIZE;
        const coverScale = Math.max(CANVAS_SIZE / iw, CANVAS_SIZE / ih);
        const sw = CANVAS_SIZE / coverScale;
        const sh = CANVAS_SIZE / coverScale;
        const sx = (iw - sw) * 0.5;
        const sy = (ih - sh) * 0.5;

        displayCtx.globalCompositeOperation = 'source-over';
        displayCtx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
        displayCtx.drawImage(outgoingImg, sx, sy, sw, sh, 0, 0, CANVAS_SIZE, CANVAS_SIZE);

        displayCtx.globalCompositeOperation = 'source-atop';
        displayCtx.drawImage(rimCanvas, 0, 0, CANVAS_SIZE, CANVAS_SIZE);

        displayCtx.globalCompositeOperation = 'destination-in';
        displayCtx.drawImage(maskCanvas, 0, 0, CANVAS_SIZE, CANVAS_SIZE);

        if (canvas) {
          const outScale = 1.015 + 0.02 * p;
          const outOpacity = pRaw > 0.94 ? Math.max(0, (1 - pRaw) / 0.06) : 1;
          canvas.style.transform = `translate3d(0, 0, 0) scale(${outScale.toFixed(4)})`;
          canvas.style.opacity = outOpacity.toFixed(3);
        }

        if (!hidFallback && fallbackOutgoingRef.current) {
          hidFallback = true;
          fallbackOutgoingRef.current.style.opacity = '0';
        }
      } else if (fallbackOutgoingRef.current) {
        const outScale = 1.015 + 0.02 * p;
        const outOpacity = Math.max(0, 1 - p);
        fallbackOutgoingRef.current.style.transform = `translate3d(0, 0, 0) scale(${outScale.toFixed(4)})`;
        fallbackOutgoingRef.current.style.opacity = outOpacity.toFixed(3);
      }
    };

    const tick = (now: number) => {
      if (cancelled) return;
      const pRaw = Math.max(0, Math.min(1, (now - startMs) / totalMs));
      drawFrame(pRaw);
      if (pRaw < 1 && typeof requestAnimationFrame === 'function') {
        rafId = requestAnimationFrame(tick);
      }
    };

    drawFrame(0);
    if (typeof requestAnimationFrame === 'function') {
      rafId = requestAnimationFrame(tick);
    }

    return () => {
      cancelled = true;
      if (rafId && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(rafId);
      }
    };
  }, [durationSec, inkField, outgoingUrl]);

  return (
    <div
      data-testid="ink-bleed-cover"
      className="relative h-full w-full overflow-hidden rounded-[16px] shadow-[0_26px_64px_rgba(0,0,0,0.58)]"
    >
      {/* Back Layer: Incoming track emerging smoothly once dissolve starts */}
      <img
        ref={incomingImgRef}
        src={incomingUrl}
        alt={incomingTitle}
        draggable={false}
        className="h-full w-full select-none object-cover will-change-transform"
        style={{
          transform: 'translate3d(0, 0, 0) scale(1.035)',
          opacity: 0,
        }}
      />

      {/* First-frame fallback image (overscanned 3px to guarantee zero subpixel edge fringe) */}
      <img
        ref={fallbackOutgoingRef}
        src={outgoingUrl}
        alt={outgoingTitle}
        aria-hidden="true"
        draggable={false}
        className="pointer-events-none absolute -inset-[3px] h-[calc(100%+6px)] w-[calc(100%+6px)] max-w-none select-none object-cover will-change-transform"
        style={{ transform: 'translate3d(0, 0, 0) scale(1.015)' }}
      />

      {/* Front Layer: Overscanned 60/120fps Canvas2D Domain-Warped fBM Ink-Bleed Compositor */}
      <canvas
        ref={canvasRef}
        width={CANVAS_SIZE}
        height={CANVAS_SIZE}
        aria-hidden="true"
        className="pointer-events-none absolute -inset-[3px] h-[calc(100%+6px)] w-[calc(100%+6px)] max-w-none will-change-transform"
        style={{ transform: 'translate3d(0, 0, 0) scale(1.015)' }}
      />
    </div>
  );
};
