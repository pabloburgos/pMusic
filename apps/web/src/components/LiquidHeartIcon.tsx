import React, { useEffect, useId, useRef, useState } from 'react';

export interface LiquidHeartIconProps {
  liked: boolean;
  size?: number;
  className?: string;
  fillColor?: string;
  strokeColor?: string;
}

const HEART_PATH =
  'M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z';

// Periodic sinusoidal wave spanning 72px (3 cycles of 24px) so translating -24px loops seamlessly
const WAVE_PATH =
  'M 0 3 Q 6 0 12 3 T 24 3 T 36 3 T 48 3 T 60 3 T 72 3 L 72 34 L 0 34 Z';

const WAVE_CREST_PATH =
  'M 0 3 Q 6 0 12 3 T 24 3 T 36 3 T 48 3 T 60 3 T 72 3';

/**
 * Heart icon with an SVG liquid-fill animation that smoothly rises from bottom to top
 * with a sloshing meniscus wave whenever the track/artist is liked.
 */
export const LiquidHeartIcon: React.FC<LiquidHeartIconProps> = ({
  liked,
  size,
  className = '',
  fillColor = 'currentColor',
  strokeColor = 'currentColor',
}) => {
  const rawId = useId();
  const clipId = `pm-heart-clip-${rawId.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const prevLikedRef = useRef(liked);
  const [justLiked, setJustLiked] = useState(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    if (!prevLikedRef.current && liked) {
      setJustLiked(true);
      timer = setTimeout(() => setJustLiked(false), 620);
    } else if (!liked) {
      setJustLiked(false);
    }
    prevLikedRef.current = liked;
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [liked]);

  return (
    <svg
      viewBox="0 0 24 24"
      {...(typeof size === 'number' ? { width: size, height: size } : {})}
      fill="none"
      aria-hidden="true"
      data-liked={liked ? 'true' : 'false'}
      className={`overflow-visible ${justLiked ? 'pm-heart-liquid-pop' : ''} ${className}`}
    >
      <defs>
        <clipPath id={clipId}>
          <path d={HEART_PATH} />
        </clipPath>
      </defs>

      <g clipPath={`url(#${clipId})`}>
        <g
          className="pm-liquid-rise"
          style={{
            transform: liked ? 'translateY(-2px)' : 'translateY(25px)',
          }}
        >
          <g className={liked ? 'pm-liquid-wave-path pm-liquid-wave-active' : 'pm-liquid-wave-path'}>
            <path d={WAVE_PATH} fill={fillColor} fillOpacity={0.96} />
            <path
              d={WAVE_CREST_PATH}
              fill="none"
              stroke="rgba(255,255,255,0.48)"
              strokeWidth="1.2"
              strokeLinecap="round"
            />
          </g>
        </g>
      </g>

      <path
        d={HEART_PATH}
        fill="none"
        stroke={strokeColor}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};
