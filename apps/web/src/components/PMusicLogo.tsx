import React, { useId } from 'react';
import {
  PMUSIC_P_MARK_HEIGHT,
  PMUSIC_P_MARK_PATH,
  PMUSIC_P_MARK_VIEWBOX,
  PMUSIC_P_MARK_WIDTH,
  PMUSIC_WORDMARK_HEIGHT,
  PMUSIC_WORDMARK_PATH,
  PMUSIC_WORDMARK_VIEWBOX,
  PMUSIC_WORDMARK_WIDTH,
} from './pmusic-logo-paths.ts';

export interface PMusicLogoProps {
  size?: number;
  variant?: 'icon' | 'mark' | 'full' | 'wordmark-only';
  showWordmark?: boolean;
  color?: string;
  animated?: boolean;
  className?: string;
}

const TARGET_H = 188;
const P_SCALE = TARGET_H / PMUSIC_P_MARK_HEIGHT;
const P_TX = (256 - PMUSIC_P_MARK_WIDTH * P_SCALE) / 2;
const P_TY = (256 - TARGET_H) / 2;

export const PMusicLogo: React.FC<PMusicLogoProps> = ({
  size = 30,
  variant,
  showWordmark = false,
  color,
  animated = false,
  className = '',
}) => {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const wordmarkOnly = variant === 'wordmark-only';
  const markOnly = variant === 'mark';
  const showFull = wordmarkOnly || (variant ? variant === 'full' : showWordmark);
  const wmHeight = wordmarkOnly ? Math.round(size * 0.92) : Math.round(size * 0.72);
  const wmWidth = Math.round((wmHeight * PMUSIC_WORDMARK_WIDTH) / PMUSIC_WORDMARK_HEIGHT);
  const markWidth = Math.max(8, Math.round((size * PMUSIC_P_MARK_WIDTH) / PMUSIC_P_MARK_HEIGHT));
  const clipId = `pm-wm-clip-${uid}`;
  const gleamId = `pm-wm-gleam-${uid}`;

  if (markOnly) {
    return (
      <svg
        width={markWidth}
        height={size}
        viewBox={PMUSIC_P_MARK_VIEWBOX}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        className={`inline-block shrink-0 select-none ${className}`}
        style={color ? { color } : undefined}
      >
        <path
          d={PMUSIC_P_MARK_PATH}
          fill={color ?? 'currentColor'}
          fillRule="evenodd"
        />
      </svg>
    );
  }

  return (
    <span
      className={`inline-flex items-center gap-2 select-none ${className}`}
      style={color ? { color } : undefined}
    >
      {animated && (
        <style>{`
          @keyframes pmMotionDraw {
            0% { stroke-dashoffset: 1800; stroke-opacity: 0.95; }
            62% { stroke-dashoffset: 0; stroke-opacity: 0.95; }
            100% { stroke-dashoffset: 0; stroke-opacity: 0; }
          }
          @keyframes pmMotionFill {
            0%, 34% { opacity: 0; transform: scale(0.955); filter: blur(4px); }
            72% { opacity: 1; transform: scale(1.018); filter: blur(0px); }
            100% { opacity: 1; transform: scale(1); filter: blur(0px); }
          }
          @keyframes pmMotionGleam {
            0%, 42% { transform: translateX(-110%); opacity: 0; }
            55% { opacity: 0.85; }
            86% { transform: translateX(135%); opacity: 0; }
            100% { transform: translateX(135%); opacity: 0; }
          }
          .pm-mg-stroke {
            stroke-dasharray: 1800;
            stroke-dashoffset: 1800;
            animation: pmMotionDraw 1.25s cubic-bezier(0.22, 1, 0.36, 1) forwards;
          }
          .pm-mg-fill {
            transform-origin: center;
            animation: pmMotionFill 1.05s cubic-bezier(0.16, 1, 0.3, 1) forwards;
          }
          .pm-mg-gleam {
            animation: pmMotionGleam 3.6s cubic-bezier(0.4, 0, 0.2, 1) infinite;
          }
        `}</style>
      )}

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
            {animated && (
              <path
                d={PMUSIC_P_MARK_PATH}
                fill="none"
                stroke={color ?? '#FFFFFF'}
                strokeWidth="4.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="pm-mg-stroke"
              />
            )}
            <path
              d={PMUSIC_P_MARK_PATH}
              fill={color ?? '#FFFFFF'}
              fillRule="evenodd"
              className={animated ? 'pm-mg-fill' : undefined}
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
          className="shrink-0 pm-text-primary overflow-visible"
        >
          {animated && (
            <defs>
              <clipPath id={clipId}>
                <path d={PMUSIC_WORDMARK_PATH} fillRule="evenodd" />
              </clipPath>
              <linearGradient id={gleamId} x1="0%" y1="0%" x2="100%" y2="25%">
                <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0" />
                <stop offset="46%" stopColor="#FFFFFF" stopOpacity="0.88" />
                <stop offset="54%" stopColor="#E2E8F0" stopOpacity="0.95" />
                <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
              </linearGradient>
            </defs>
          )}
          {animated && (
            <path
              d={PMUSIC_WORDMARK_PATH}
              fill="none"
              stroke="currentColor"
              strokeWidth="4"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="pm-mg-stroke"
            />
          )}
          <path
            d={PMUSIC_WORDMARK_PATH}
            fill="currentColor"
            fillRule="evenodd"
            className={animated ? 'pm-mg-fill' : undefined}
          />
          {animated && (
            <g clipPath={`url(#${clipId})`}>
              <rect
                x="-120"
                y="-20"
                width={PMUSIC_WORDMARK_WIDTH * 0.45}
                height={PMUSIC_WORDMARK_HEIGHT + 40}
                fill={`url(#${gleamId})`}
                className="pm-mg-gleam"
                style={{ mixBlendMode: 'overlay' }}
              />
            </g>
          )}
        </svg>
      )}
    </span>
  );
};
