import React from 'react';
import {
  PMUSIC_P_MARK_HEIGHT,
  PMUSIC_P_MARK_PATH,
  PMUSIC_P_MARK_WIDTH,
  PMUSIC_WORDMARK_HEIGHT,
  PMUSIC_WORDMARK_PATH,
  PMUSIC_WORDMARK_VIEWBOX,
  PMUSIC_WORDMARK_WIDTH,
} from './pmusic-logo-paths.ts';

export interface PMusicLogoProps {
  size?: number;
  variant?: 'icon' | 'full' | 'wordmark-only';
  showWordmark?: boolean;
  color?: string;
  className?: string;
}

const TARGET_H = 190;
const P_SCALE = TARGET_H / PMUSIC_P_MARK_HEIGHT;
const P_TX = (256 - PMUSIC_P_MARK_WIDTH * P_SCALE) / 2;
const P_TY = (256 - TARGET_H) / 2;

export const PMusicLogo: React.FC<PMusicLogoProps> = ({
  size = 30,
  variant,
  showWordmark = false,
  color,
  className = '',
}) => {
  const wordmarkOnly = variant === 'wordmark-only';
  const showFull = wordmarkOnly || (variant ? variant === 'full' : showWordmark);
  const wmHeight = wordmarkOnly ? Math.round(size * 0.92) : Math.round(size * 0.72);
  const wmWidth = Math.round((wmHeight * PMUSIC_WORDMARK_WIDTH) / PMUSIC_WORDMARK_HEIGHT);

  return (
    <span
      className={`inline-flex items-center gap-2 select-none ${className}`}
      style={color ? { color } : undefined}
    >
      {!wordmarkOnly && (
        <svg
          width={size}
          height={size}
          viewBox="0 0 256 256"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
          className="shrink-0 drop-shadow-[0_4px_10px_rgba(0,0,0,0.45)]"
        >
          <rect x="6" y="6" width="244" height="244" rx="64" fill="#060608" />
          <rect
            x="7.5"
            y="7.5"
            width="241"
            height="241"
            rx="62.5"
            stroke="#FFFFFF"
            strokeOpacity="0.14"
            strokeWidth="3"
          />
          <g transform={`translate(${P_TX.toFixed(2)}, ${P_TY.toFixed(2)}) scale(${P_SCALE.toFixed(5)})`}>
            <path
              d={PMUSIC_P_MARK_PATH}
              fill={color ?? '#FFFFFF'}
              fillRule="evenodd"
            />
          </g>
        </svg>
      )}

      {showFull && (
        <svg
          width={wmWidth}
          height={wmHeight}
          viewBox={PMUSIC_WORDMARK_VIEWBOX}
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-label="pMusic"
          className="shrink-0 pm-text-primary"
        >
          <path
            d={PMUSIC_WORDMARK_PATH}
            fill="currentColor"
            fillRule="evenodd"
          />
        </svg>
      )}
    </span>
  );
};
