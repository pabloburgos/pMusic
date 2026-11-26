import React, { useEffect, useRef } from 'react';
import {
  getLiveAmbientRgb,
  getPrebakedMobileBackdrop,
  prebakeMobileBackdrop,
} from '../utils/cover-color.ts';

interface MobileFluidBackdropCanvasProps {
  coverUrl: string;
  crossfadeMs: number;
  crossfadeLinear: boolean;
  ambientMotionEnabled: boolean;
  reducedMotionPref: boolean;
}

const decodedCoverImgCache = new Map<string, HTMLImageElement>();

/**
 * Single-canvas hardware-composited mobile fluid backdrop.
 * Blends outgoing & incoming pre-baked 48x48 covers and live ambient orbs in ONE draw pass
 * with an unbroken phase clock — eliminating Android WebView z-index / mix-blend flicker.
 */
export const MobileFluidBackdropCanvas: React.FC<MobileFluidBackdropCanvasProps> = ({
  coverUrl,
  crossfadeMs,
  crossfadeLinear,
  ambientMotionEnabled,
  reducedMotionPref,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const activeUrlRef = useRef<string>(coverUrl);
  const outgoingUrlRef = useRef<string | null>(null);
  const targetUrlRef = useRef<string>(coverUrl);
  const blendStartRef = useRef<number>(0);
  const blendDurRef = useRef<number>(950);
  const blendLinearRef = useRef<boolean>(false);
  const blendActiveRef = useRef<boolean>(false);
  const phaseRef = useRef<number>(0);
  const motionRef = useRef<boolean>(ambientMotionEnabled && !reducedMotionPref);
  motionRef.current = ambientMotionEnabled && !reducedMotionPref;
  const crossfadeMsPropRef = useRef<number>(crossfadeMs);
  crossfadeMsPropRef.current = crossfadeMs;
  const crossfadeLinearPropRef = useRef<boolean>(crossfadeLinear);
  crossfadeLinearPropRef.current = crossfadeLinear;

  // Transition cover URL seamlessly without ever clearing the currently displayed cover while loading
  useEffect(() => {
    const cleanUrl = coverUrl || '';
    if (cleanUrl === targetUrlRef.current && (blendActiveRef.current || activeUrlRef.current === cleanUrl)) {
      return;
    }
    targetUrlRef.current = cleanUrl;
    let cancelled = false;

    const triggerBlend = (nextUrl: string) => {
      if (cancelled) return;
      if (nextUrl === activeUrlRef.current) return;
      if (reducedMotionPref) {
        outgoingUrlRef.current = null;
        activeUrlRef.current = nextUrl;
        blendActiveRef.current = false;
        return;
      }
      outgoingUrlRef.current = activeUrlRef.current;
      activeUrlRef.current = nextUrl;
      blendStartRef.current = typeof performance !== 'undefined' ? performance.now() : Date.now();
      blendDurRef.current = Math.max(280, crossfadeMsPropRef.current || 950);
      blendLinearRef.current = Boolean(crossfadeLinearPropRef.current);
      blendActiveRef.current = true;
    };

    if (!cleanUrl) {
      triggerBlend('');
      return;
    }

    if (getPrebakedMobileBackdrop(cleanUrl)) {
      triggerBlend(cleanUrl);
      return;
    }

    const cached = decodedCoverImgCache.get(cleanUrl);
    if (cached && cached.complete && cached.naturalWidth > 0) {
      prebakeMobileBackdrop(cleanUrl, cached);
      triggerBlend(cleanUrl);
      return;
    }

    if (typeof Image === 'undefined') {
      triggerBlend(cleanUrl);
      return;
    }

    const img = new Image();
    img.decoding = 'async';
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled || cancelled) return;
      settled = true;
      clearTimeout(timer);
      if (ok && img.naturalWidth > 0) {
        decodedCoverImgCache.set(cleanUrl, img);
        if (decodedCoverImgCache.size > 32) {
          const oldest = decodedCoverImgCache.keys().next().value;
          if (oldest) decodedCoverImgCache.delete(oldest);
        }
        prebakeMobileBackdrop(cleanUrl, img);
      }
      triggerBlend(cleanUrl);
    };
    const timer = setTimeout(() => finish(false), 1100);
    img.onload = () => {
      if (typeof img.decode === 'function') {
        void img.decode().catch(() => {}).finally(() => finish(true));
      } else {
        finish(true);
      }
    };
    img.onerror = () => finish(false);
    img.src = cleanUrl;
    if (img.complete && img.naturalWidth > 0) finish(true);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [coverUrl, reducedMotionPref]);

  // Continuous single-canvas render loop (throttled ~30fps for zero-jank Android smoothness)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let ctx: CanvasRenderingContext2D | null = null;
    try {
      ctx = canvas.getContext('2d', { alpha: false });
    } catch {
      ctx = null;
    }
    if (!ctx) return;

    let rafId = 0;
    let cancelled = false;
    let lastTick = typeof performance !== 'undefined' ? performance.now() : Date.now();
    let lastDraw = 0;

    const drawBakedPair = (url: string, alpha: number, t: number, w: number, h: number) => {
      if (!ctx || !url || alpha <= 0.005) return;
      const pair = getPrebakedMobileBackdrop(url);
      if (!pair) return;

      const minDim = Math.max(1, Math.min(w, h));
      const coverDim = Math.max(w, h) * 1.18;
      const [layerA, layerB] = pair;
      if (layerA) {
        ctx.save();
        ctx.globalAlpha = 0.64 * alpha;
        const dx = Math.sin(t * 0.72) * minDim * 0.14;
        const dy = Math.cos(t * 0.54) * minDim * 0.16;
        const sc = 1.24 + Math.sin(t * 0.42) * 0.07;
        const rot = Math.sin(t * 0.34) * 0.18;
        ctx.translate(w * 0.5 + dx, h * 0.5 + dy);
        ctx.rotate(rot);
        ctx.scale(sc, sc);
        ctx.drawImage(layerA, -coverDim * 0.5, -coverDim * 0.5, coverDim, coverDim);
        ctx.restore();
      }
      if (layerB) {
        ctx.save();
        ctx.globalAlpha = 0.42 * alpha;
        const dx2 = Math.cos(t * 0.62) * minDim * 0.16;
        const dy2 = Math.sin(t * 0.66) * minDim * 0.18;
        const sc2 = 1.28 + Math.cos(t * 0.38) * 0.07;
        const rot2 = -Math.cos(t * 0.31) * 0.2;
        ctx.translate(w * 0.5 + dx2, h * 0.5 + dy2);
        ctx.rotate(rot2);
        ctx.scale(-sc2, sc2);
        ctx.drawImage(layerB, -coverDim * 0.5, -coverDim * 0.5, coverDim, coverDim);
        ctx.restore();
      }
    };

    const drawFrame = (now: number) => {
      if (!ctx) return;
      const dt = Math.min(0.08, Math.max(0, (now - lastTick) / 1000));
      lastTick = now;
      if (motionRef.current) {
        phaseRef.current += dt;
      }
      const t = phaseRef.current;

      const w = canvas.width;
      const h = canvas.height;
      const minDim = Math.max(1, Math.min(w, h));
      const diagDim = Math.hypot(w, h);

      ctx.globalAlpha = 1;
      ctx.fillStyle = '#09090d';
      ctx.fillRect(0, 0, w, h);

      let blend = 1;
      if (blendActiveRef.current) {
        const elapsed = Math.max(0, now - blendStartRef.current);
        const raw = Math.min(1, elapsed / Math.max(1, blendDurRef.current));
        if (raw >= 1) {
          blendActiveRef.current = false;
          outgoingUrlRef.current = null;
          blend = 1;
        } else {
          blend = blendLinearRef.current ? raw : raw * raw * (3 - 2 * raw);
        }
      }

      if (blendActiveRef.current && outgoingUrlRef.current && 1 - blend > 0.008) {
        drawBakedPair(outgoingUrlRef.current, 1 - blend, t, w, h);
      }
      drawBakedPair(activeUrlRef.current, blend, t, w, h);

      // Living Ambient Orbs using live interpolated cover palette RGB (zero CSS mix-blend flicker)
      const [c1, c2, c3] = getLiveAmbientRgb();
      const orbs: Array<{
        cx: number;
        cy: number;
        rad: number;
        rgb: readonly [number, number, number];
        alpha: number;
      }> = [
        {
          cx: w * 0.34 + Math.sin(t * 0.62) * minDim * 0.24,
          cy: h * 0.24 + Math.cos(t * 0.49) * minDim * 0.22,
          rad: diagDim * 0.56,
          rgb: c1,
          alpha: 0.42,
        },
        {
          cx: w * 0.68 + Math.cos(t * 0.51) * minDim * 0.24,
          cy: h * 0.74 + Math.sin(t * 0.43) * minDim * 0.22,
          rad: diagDim * 0.6,
          rgb: c2,
          alpha: 0.46,
        },
        {
          cx: w * 0.5 + Math.sin(t * 0.37) * minDim * 0.22,
          cy: h * 0.49 + Math.cos(t * 0.33) * minDim * 0.22,
          rad: diagDim * 0.5,
          rgb: c3,
          alpha: 0.34,
        },
      ];

      for (const orb of orbs) {
        const g = ctx.createRadialGradient(orb.cx, orb.cy, 0, orb.cx, orb.cy, orb.rad);
        g.addColorStop(0, `rgba(${Math.round(orb.rgb[0])},${Math.round(orb.rgb[1])},${Math.round(orb.rgb[2])},${orb.alpha})`);
        g.addColorStop(
          0.55,
          `rgba(${Math.round(orb.rgb[0])},${Math.round(orb.rgb[1])},${Math.round(orb.rgb[2])},${(orb.alpha * 0.45).toFixed(3)})`
        );
        g.addColorStop(1, 'rgba(9,9,13,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
      }

      // Soft dark top balance stop so high-key covers never look chalky at the top edge
      const topShade = ctx.createLinearGradient(0, 0, 0, h * 0.38);
      topShade.addColorStop(0, 'rgba(7,7,9,0.28)');
      topShade.addColorStop(1, 'rgba(7,7,9,0)');
      ctx.fillStyle = topShade;
      ctx.fillRect(0, 0, w, h * 0.38);
    };

    const loop = (now: number) => {
      if (cancelled) return;
      if (typeof document !== 'undefined' && document.hidden) {
        rafId = 0;
        return;
      }
      if (now - lastDraw >= 30 || blendActiveRef.current) {
        lastDraw = now;
        drawFrame(now);
      }
      if (motionRef.current || blendActiveRef.current) {
        rafId = requestAnimationFrame(loop);
      }
    };

    const handleVisibility = () => {
      if (cancelled) return;
      if (typeof document !== 'undefined' && document.hidden) {
        if (rafId && typeof cancelAnimationFrame === 'function') {
          cancelAnimationFrame(rafId);
          rafId = 0;
        }
      } else if (!rafId && (motionRef.current || blendActiveRef.current) && typeof requestAnimationFrame === 'function') {
        lastTick = typeof performance !== 'undefined' ? performance.now() : Date.now();
        rafId = requestAnimationFrame(loop);
      }
    };
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibility);
    }

    drawFrame(lastTick);
    if (typeof requestAnimationFrame === 'function' && !(typeof document !== 'undefined' && document.hidden)) {
      rafId = requestAnimationFrame(loop);
    }

    return () => {
      cancelled = true;
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibility);
      }
      if (rafId && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(rafId);
      }
      canvas.width = 0;
      canvas.height = 0;
    };
  }, [ambientMotionEnabled, reducedMotionPref, coverUrl]);

  return (
    <canvas
      ref={canvasRef}
      width={160}
      height={280}
      data-testid="live-backdrop-img"
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 h-full w-full select-none"
    />
  );
};
