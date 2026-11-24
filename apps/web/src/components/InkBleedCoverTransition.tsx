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
  const filterId = `pm-ink-filter-${safeUid}`;
  const maskId = `pm-ink-mask-${safeUid}`;

  const incomingImgRef = useRef<HTMLImageElement | null>(null);
  const outgoingGroupRef = useRef<SVGGElement | null>(null);
  const dispRef = useRef<SVGFEDisplacementMapElement | null>(null);
  const rimGroupRef = useRef<SVGGElement | null>(null);
  const c0Ref = useRef<SVGCircleElement | null>(null);
  const c1Ref = useRef<SVGCircleElement | null>(null);
  const c2Ref = useRef<SVGCircleElement | null>(null);
  const c3Ref = useRef<SVGCircleElement | null>(null);
  const e0Ref = useRef<SVGCircleElement | null>(null);
  const e1Ref = useRef<SVGCircleElement | null>(null);
  const e2Ref = useRef<SVGCircleElement | null>(null);
  const e3Ref = useRef<SVGCircleElement | null>(null);

  const { seed, origins } = useMemo(() => {
    let hash = 2166136261;
    for (let i = 0; i < seedKey.length; i++) {
      hash ^= seedKey.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    const u = Math.abs(hash);
    const pts: Array<{ cx: number; cy: number; maxR: number; delay: number }> = [
      { cx: 110 + (u % 180), cy: 110 + ((u >> 4) % 180), maxR: 520, delay: 0 },
      { cx: 65 + ((u >> 8) % 270), cy: 65 + ((u >> 12) % 270), maxR: 430, delay: 0.07 },
      { cx: 70 + ((u >> 16) % 260), cy: 70 + ((u >> 20) % 260), maxR: 390, delay: 0.15 },
      { cx: 80 + ((u >> 3) % 240), cy: 80 + ((u >> 7) % 240), maxR: 360, delay: 0.23 },
    ];
    return {
      seed: (u % 980) + 12,
      origins: pts,
    };
  }, [seedKey]);

  useEffect(() => {
    const circleRefs = [c0Ref, c1Ref, c2Ref, c3Ref];
    const rimCircleRefs = [e0Ref, e1Ref, e2Ref, e3Ref];
    const totalMs = Math.max(900, durationSec * 1000);
    const startMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
    let rafId = 0;

    const tick = (now: number) => {
      const pRaw = Math.max(0, Math.min(1, (now - startMs) / totalMs));
      const p = pRaw < 0.5 ? 2 * pRaw * pRaw : 1 - Math.pow(-2 * pRaw + 2, 2) / 2;

      const dispScale = p < 0.45 ? (p / 0.45) * 66 : 66 - ((p - 0.45) / 0.55) * 24;
      dispRef.current?.setAttribute('scale', dispScale.toFixed(1));

      for (let i = 0; i < origins.length; i++) {
        const origin = origins[i]!;
        const localT = Math.max(
          0,
          Math.min(1, (pRaw - origin.delay) / Math.max(0.15, 0.9 - origin.delay))
        );
        const radiusEase = 1 - Math.pow(1 - localT, 2.25);
        const r = origin.maxR * radiusEase;
        circleRefs[i]?.current?.setAttribute('r', r.toFixed(1));
        rimCircleRefs[i]?.current?.setAttribute('r', (r + 12).toFixed(1));
      }

      if (rimGroupRef.current) {
        const rimAlpha = pRaw < 0.14 ? pRaw / 0.14 : pRaw > 0.8 ? Math.max(0, (1 - pRaw) / 0.2) : 1;
        rimGroupRef.current.setAttribute('opacity', (rimAlpha * 0.45).toFixed(3));
      }

      if (outgoingGroupRef.current) {
        const outOpacity = pRaw < 0.84 ? 1 : Math.max(0, 1 - (pRaw - 0.84) / 0.14);
        const outScale = 1 + p * 0.032;
        outgoingGroupRef.current.style.opacity = outOpacity.toFixed(3);
        outgoingGroupRef.current.style.transform = `scale(${outScale.toFixed(4)})`;
      }

      if (incomingImgRef.current) {
        const inProgress = Math.max(0, Math.min(1, pRaw / 0.94));
        const inEase = 1 - Math.pow(1 - inProgress, 2.8);
        const scale = 0.935 + 0.065 * inEase;
        const bright = 0.84 + 0.16 * inEase;
        const blur = Math.max(0, (1 - inEase) * 3);
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
  }, [durationSec, origins]);

  return (
    <div
      data-testid="ink-bleed-cover"
      className="relative h-full w-full overflow-hidden rounded-[16px] bg-[#111115] shadow-[0_26px_64px_rgba(0,0,0,0.58)]"
    >
      {/* Back Layer: Incoming track emerging seamlessly from behind */}
      <img
        ref={incomingImgRef}
        src={incomingUrl}
        alt={incomingTitle}
        draggable={false}
        className="h-full w-full select-none object-cover will-change-transform"
        style={{
          transform: 'scale(0.935)',
          filter: 'brightness(0.84) blur(3px)',
        }}
      />

      {/* Front Layer: Outgoing cover dissolving via Fractal Noise Ink-Bleed SVG mask */}
      <svg
        viewBox="0 0 400 400"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 h-full w-full"
      >
        <defs>
          <filter id={filterId} x="-35%" y="-35%" width="170%" height="170%">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.022 0.026"
              numOctaves={3}
              seed={seed}
              result="noise"
            />
            <feDisplacementMap
              ref={dispRef}
              in="SourceGraphic"
              in2="noise"
              scale={0}
              xChannelSelector="R"
              yChannelSelector="G"
              result="displaced"
            />
            <feGaussianBlur in="displaced" stdDeviation={2.5} />
          </filter>

          <mask id={maskId}>
            <rect x="0" y="0" width="400" height="400" fill="white" />
            <g filter={`url(#${filterId})`}>
              <circle ref={c0Ref} cx={origins[0]!.cx} cy={origins[0]!.cy} r="0" fill="black" />
              <circle ref={c1Ref} cx={origins[1]!.cx} cy={origins[1]!.cy} r="0" fill="black" />
              <circle ref={c2Ref} cx={origins[2]!.cx} cy={origins[2]!.cy} r="0" fill="black" />
              <circle ref={c3Ref} cx={origins[3]!.cx} cy={origins[3]!.cy} r="0" fill="black" />
            </g>
          </mask>
        </defs>

        {/* Wet-ink dark organic halo expanding on the tear front */}
        <g ref={rimGroupRef} filter={`url(#${filterId})`} opacity="0">
          <circle
            ref={e0Ref}
            cx={origins[0]!.cx}
            cy={origins[0]!.cy}
            r="0"
            fill="none"
            stroke="rgba(8, 8, 14, 0.85)"
            strokeWidth="20"
          />
          <circle
            ref={e1Ref}
            cx={origins[1]!.cx}
            cy={origins[1]!.cy}
            r="0"
            fill="none"
            stroke="rgba(8, 8, 14, 0.8)"
            strokeWidth="18"
          />
          <circle
            ref={e2Ref}
            cx={origins[2]!.cx}
            cy={origins[2]!.cy}
            r="0"
            fill="none"
            stroke="rgba(8, 8, 14, 0.75)"
            strokeWidth="16"
          />
          <circle
            ref={e3Ref}
            cx={origins[3]!.cx}
            cy={origins[3]!.cy}
            r="0"
            fill="none"
            stroke="rgba(8, 8, 14, 0.7)"
            strokeWidth="14"
          />
        </g>

        <g
          ref={outgoingGroupRef}
          style={{ transformOrigin: '200px 200px' }}
        >
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
