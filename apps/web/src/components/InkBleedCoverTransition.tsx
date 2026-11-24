import React, { useEffect, useId, useMemo, useRef } from 'react';

interface InkBleedCoverTransitionProps {
  outgoingUrl: string;
  outgoingTitle: string;
  incomingUrl: string;
  incomingTitle: string;
  seedKey: string;
  durationSec: number;
}

export const InkBleedCoverTransition: React.FC<InkBleedCoverTransitionProps> = ({
  outgoingUrl,
  outgoingTitle,
  incomingUrl,
  incomingTitle,
  seedKey,
  durationSec,
}) => {
  const rawUid = useId();
  const safeUid = rawUid.replace(/[^a-zA-Z0-9_-]/g, '');
  const maskFilterId = `pm-ink-mask-filter-${safeUid}`;
  const rimFilterId = `pm-ink-rim-filter-${safeUid}`;
  const maskId = `pm-ink-mask-${safeUid}`;
  const rimMaskId = `pm-ink-rim-mask-${safeUid}`;

  const incomingImgRef = useRef<HTMLImageElement | null>(null);
  const outgoingGroupRef = useRef<SVGGElement | null>(null);
  const rimGroupRef = useRef<SVGGElement | null>(null);
  const rFuncRef = useRef<SVGFEFuncRElement | null>(null);
  const gFuncRef = useRef<SVGFEFuncGElement | null>(null);
  const bFuncRef = useRef<SVGFEFuncBElement | null>(null);
  const rimRFuncRef = useRef<SVGFEFuncRElement | null>(null);
  const rimGFuncRef = useRef<SVGFEFuncGElement | null>(null);
  const rimBFuncRef = useRef<SVGFEFuncBElement | null>(null);

  const seed = useMemo(() => {
    let hash = 2166136261;
    for (let i = 0; i < seedKey.length; i++) {
      hash ^= seedKey.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (Math.abs(hash) % 940) + 17;
  }, [seedKey]);

  useEffect(() => {
    const totalMs = Math.max(1200, durationSec * 1000);
    const startMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
    let rafId = 0;

    const tick = (now: number) => {
      const pRaw = Math.max(0, Math.min(1, (now - startMs) / totalMs));
      // Smooth S-curve matching the backdrop fade timing
      const p = 0.5 - 0.5 * Math.cos(Math.PI * pRaw);

      // Sweeps pure fractal noise luminance threshold from 100% outgoing -> 100% incoming
      const intercept = 1.15 - 8.8 * p;
      const interceptStr = intercept.toFixed(3);
      rFuncRef.current?.setAttribute('intercept', interceptStr);
      gFuncRef.current?.setAttribute('intercept', interceptStr);
      bFuncRef.current?.setAttribute('intercept', interceptStr);

      // Leading dark wet-ink bleed edge around the organic tear front
      const rimIntercept = (intercept - 0.45).toFixed(3);
      rimRFuncRef.current?.setAttribute('intercept', rimIntercept);
      rimGFuncRef.current?.setAttribute('intercept', rimIntercept);
      rimBFuncRef.current?.setAttribute('intercept', rimIntercept);

      if (rimGroupRef.current) {
        const rimAlpha = Math.sin(Math.PI * pRaw) * 0.48;
        rimGroupRef.current.setAttribute('opacity', rimAlpha.toFixed(3));
      }

      if (outgoingGroupRef.current) {
        const outOpacity = pRaw > 0.92 ? Math.max(0, (1 - pRaw) / 0.08) : 1;
        const outScale = 1 + 0.025 * p;
        outgoingGroupRef.current.style.opacity = outOpacity.toFixed(3);
        outgoingGroupRef.current.style.transform = `scale(${outScale.toFixed(4)})`;
      }

      if (incomingImgRef.current) {
        const scale = 0.95 + 0.05 * p;
        const bright = 0.86 + 0.14 * p;
        const blur = Math.max(0, (1 - p) * 2.5);
        incomingImgRef.current.style.transform = `scale(${scale.toFixed(4)})`;
        incomingImgRef.current.style.filter = `brightness(${bright.toFixed(3)}) blur(${blur.toFixed(2)}px)`;
      }

      if (pRaw < 1 && typeof requestAnimationFrame === 'function') {
        rafId = requestAnimationFrame(tick);
      }
    };

    if (typeof requestAnimationFrame === 'function') {
      rafId = requestAnimationFrame(tick);
    }
    return () => {
      if (rafId && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(rafId);
      }
    };
  }, [durationSec, seed]);

  return (
    <div
      data-testid="ink-bleed-cover"
      className="relative h-full w-full overflow-hidden rounded-[16px] bg-[#111115] shadow-[0_26px_64px_rgba(0,0,0,0.58)]"
    >
      {/* Back Layer: Incoming track emerging organically from behind */}
      <img
        ref={incomingImgRef}
        src={incomingUrl}
        alt={incomingTitle}
        draggable={false}
        className="h-full w-full select-none object-cover will-change-transform"
        style={{
          transform: 'scale(0.95)',
          filter: 'brightness(0.86) blur(2.5px)',
        }}
      />

      {/* Front Layer: Pure Multi-Octave Random Fractal Noise Ink-Bleed SVG Dissolve */}
      <svg
        viewBox="0 0 400 400"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 h-full w-full"
      >
        <defs>
          <filter
            id={maskFilterId}
            filterUnits="userSpaceOnUse"
            x="0"
            y="0"
            width="400"
            height="400"
          >
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.011 0.011"
              numOctaves={4}
              seed={seed}
              result="lowNoise"
            />
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.036 0.036"
              numOctaves={3}
              seed={seed + 41}
              result="fineNoise"
            />
            <feComposite
              in="lowNoise"
              in2="fineNoise"
              operator="arithmetic"
              k1={0}
              k2={0.72}
              k3={0.28}
              k4={0}
              result="combinedNoise"
            />
            <feColorMatrix
              in="combinedNoise"
              type="matrix"
              values="1 0 0 0 0  1 0 0 0 0  1 0 0 0 0  0 0 0 0 1"
              result="grayNoise"
            />
            <feComponentTransfer in="grayNoise" result="inkMask">
              <feFuncR ref={rFuncRef} type="linear" slope={7.5} intercept={1.15} />
              <feFuncG ref={gFuncRef} type="linear" slope={7.5} intercept={1.15} />
              <feFuncB ref={bFuncRef} type="linear" slope={7.5} intercept={1.15} />
            </feComponentTransfer>
            <feGaussianBlur in="inkMask" stdDeviation={1.6} />
          </filter>

          <filter
            id={rimFilterId}
            filterUnits="userSpaceOnUse"
            x="0"
            y="0"
            width="400"
            height="400"
          >
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.011 0.011"
              numOctaves={4}
              seed={seed}
              result="lowNoiseRim"
            />
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.036 0.036"
              numOctaves={3}
              seed={seed + 41}
              result="fineNoiseRim"
            />
            <feComposite
              in="lowNoiseRim"
              in2="fineNoiseRim"
              operator="arithmetic"
              k1={0}
              k2={0.72}
              k3={0.28}
              k4={0}
              result="combinedRim"
            />
            <feColorMatrix
              in="combinedRim"
              type="matrix"
              values="1 0 0 0 0  1 0 0 0 0  1 0 0 0 0  0 0 0 0 1"
              result="grayRim"
            />
            <feComponentTransfer in="grayRim" result="rimThresh">
              <feFuncR ref={rimRFuncRef} type="linear" slope={7.5} intercept={0.7} />
              <feFuncG ref={rimGFuncRef} type="linear" slope={7.5} intercept={0.7} />
              <feFuncB ref={rimBFuncRef} type="linear" slope={7.5} intercept={0.7} />
            </feComponentTransfer>
            <feGaussianBlur in="rimThresh" stdDeviation={2.8} />
          </filter>

          <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="400" height="400">
            <rect x="0" y="0" width="400" height="400" fill="white" filter={`url(#${maskFilterId})`} />
          </mask>

          <mask id={rimMaskId} maskUnits="userSpaceOnUse" x="0" y="0" width="400" height="400">
            <rect x="0" y="0" width="400" height="400" fill="white" filter={`url(#${rimFilterId})`} />
          </mask>
        </defs>

        {/* Subtle organic wet-ink bleed wash leading ahead of the fracture edge */}
        <g ref={rimGroupRef} opacity="0">
          <rect
            x="0"
            y="0"
            width="400"
            height="400"
            fill="rgba(5, 5, 10, 0.42)"
            mask={`url(#${maskId})`}
          />
          <rect
            x="0"
            y="0"
            width="400"
            height="400"
            fill="rgba(5, 5, 10, 0.36)"
            mask={`url(#${rimMaskId})`}
          />
        </g>

        <g ref={outgoingGroupRef} style={{ transformOrigin: '200px 200px' }}>
          <image
            href={outgoingUrl}
            x="0"
            y="0"
            width="400"
            height="400"
            preserveAspectRatio="xMidYMid slice"
            mask={`url(#${maskId})`}
          />
        </g>
      </svg>
    </div>
  );
};
