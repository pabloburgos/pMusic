import React, { useEffect, useRef } from 'react';

interface InkBleedCoverTransitionProps {
  outgoingUrl: string;
  outgoingTitle: string;
  incomingUrl: string;
  incomingTitle: string;
  seedKey: string;
  durationSec: number;
}

/**
 * Pure GPU-composited cover crossfade transition.
 * Holds outgoing artwork at full opacity until incoming decodes (zero blink), then animates
 * opacity + transform strictly on the browser/WebView compositor thread at 60/120fps.
 */
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

  useEffect(() => {
    let cancelled = false;
    let rafA = 0;
    let rafB = 0;
    const totalMs = Math.max(900, Math.round(durationSec * 1000));
    const inEl = incomingImgRef.current;
    const outEl = fallbackOutgoingRef.current;

    const resetStyles = () => {
      if (inEl) {
        inEl.style.transition = 'none';
        inEl.style.transform = 'translate3d(0, 0, 0) scale(1.035)';
        inEl.style.opacity = '1';
      }
      if (outEl) {
        outEl.style.transition = 'none';
        outEl.style.transform = 'translate3d(0, 0, 0) scale(1)';
        outEl.style.opacity = '1';
      }
    };
    resetStyles();

    let started = false;
    const startGpuTransition = () => {
      if (cancelled || started) return;
      started = true;
      const runAnim = () => {
        if (cancelled) return;
        if (inEl) {
          inEl.style.transition = `transform ${totalMs}ms cubic-bezier(0.22, 1, 0.36, 1)`;
          inEl.style.transform = 'translate3d(0, 0, 0) scale(1)';
        }
        if (outEl) {
          outEl.style.transition = `opacity ${totalMs}ms cubic-bezier(0.37, 0, 0.63, 1), transform ${totalMs}ms cubic-bezier(0.37, 0, 0.63, 1)`;
          outEl.style.opacity = '0';
          outEl.style.transform = 'translate3d(0, 0, 0) scale(0.985)';
        }
      };
      if (typeof requestAnimationFrame === 'function') {
        rafA = requestAnimationFrame(() => {
          rafB = requestAnimationFrame(runAnim);
        });
      } else {
        runAnim();
      }
    };

    if (typeof Image !== 'undefined' && incomingUrl) {
      const pre = new Image();
      pre.decoding = 'async';
      const safetyTimer = setTimeout(startGpuTransition, 450);
      const triggerAfterDecode = () => {
        clearTimeout(safetyTimer);
        if (typeof pre.decode === 'function') {
          void pre.decode().catch(() => {}).finally(startGpuTransition);
        } else {
          startGpuTransition();
        }
      };
      pre.onload = triggerAfterDecode;
      pre.onerror = () => {
        clearTimeout(safetyTimer);
        startGpuTransition();
      };
      pre.src = incomingUrl;
      if (pre.complete && pre.naturalWidth > 0) {
        triggerAfterDecode();
      }
      return () => {
        cancelled = true;
        clearTimeout(safetyTimer);
        if (rafA && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(rafA);
        if (rafB && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(rafB);
      };
    }

    startGpuTransition();
    return () => {
      cancelled = true;
      if (rafA && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(rafA);
      if (rafB && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(rafB);
    };
  }, [durationSec, incomingUrl, outgoingUrl, seedKey]);

  return (
    <div
      data-testid="ink-bleed-cover"
      className="relative h-full w-full overflow-hidden rounded-[16px]"
    >
      <img
        ref={incomingImgRef}
        src={incomingUrl}
        alt={incomingTitle}
        loading="eager"
        decoding="async"
        draggable={false}
        className="h-full w-full select-none object-cover will-change-transform"
        style={{
          transform: 'translate3d(0, 0, 0) scale(1.035)',
          opacity: 1,
        }}
      />

      <img
        ref={fallbackOutgoingRef}
        src={outgoingUrl}
        alt={outgoingTitle}
        aria-hidden="true"
        loading="eager"
        decoding="async"
        draggable={false}
        className="pointer-events-none absolute inset-0 h-full w-full select-none object-cover will-change-[opacity,transform]"
        style={{
          transform: 'translate3d(0, 0, 0) scale(1)',
          opacity: 1,
        }}
      />

      <canvas
        ref={canvasRef}
        width={2}
        height={2}
        aria-hidden="true"
        className="pointer-events-none absolute h-0 w-0 opacity-0"
      />
    </div>
  );
};
