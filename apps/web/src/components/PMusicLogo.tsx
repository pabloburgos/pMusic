import React, { useId } from 'react';

export interface PMusicLogoProps {
  size?: number;
  variant?: 'icon' | 'full' | 'wordmark-only';
  showWordmark?: boolean;
  className?: string;
}

export const PMusicLogo: React.FC<PMusicLogoProps> = ({
  size = 30,
  variant,
  showWordmark = false,
  className = '',
}) => {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const wordmarkOnly = variant === 'wordmark-only';
  const showFull = wordmarkOnly || (variant ? variant === 'full' : showWordmark);
  const bgId = `pm-bg-${uid}`;
  const rimId = `pm-rim-${uid}`;
  const accentBarId = `pm-bar-${uid}`;

  return (
    <span className={`inline-flex items-center gap-2.5 select-none ${className}`}>
      {!wordmarkOnly && (
        <svg
          width={size}
          height={size}
          viewBox="0 0 256 256"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
          className="shrink-0 drop-shadow-[0_4px_10px_rgba(0,0,0,0.32)]"
        >
          <defs>
            <linearGradient id={bgId} x1="20%" y1="0%" x2="80%" y2="100%">
              <stop offset="0%" stopColor="#1F1D29" />
              <stop offset="100%" stopColor="#0C0C11" />
            </linearGradient>
            <linearGradient id={rimId} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.24" />
              <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0.06" />
            </linearGradient>
            <linearGradient id={accentBarId} x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#F4EDFF" />
              <stop offset="100%" stopColor="#C4B5FD" />
            </linearGradient>
          </defs>

          <rect x="8" y="8" width="240" height="240" rx="64" fill={`url(#${bgId})`} />
          <rect
            x="10.5"
            y="10.5"
            width="235"
            height="235"
            rx="61.5"
            stroke={`url(#${rimId})`}
            strokeWidth="5"
          />

          {/* Signature 4-bar equalizer app mark */}
          <rect x="52" y="92" width="26" height="72" rx="13" fill="#F8FAFC" />
          <rect x="94" y="54" width="26" height="148" rx="13" fill={`url(#${accentBarId})`} />
          <rect x="136" y="74" width="26" height="108" rx="13" fill="#F8FAFC" />
          <rect x="178" y="108" width="26" height="40" rx="13" fill="#E2E8F0" />
        </svg>
      )}

      {showFull && (
        <span
          className={`pm-brand-wordmark inline-flex items-baseline ${
            wordmarkOnly ? 'text-[23px]' : 'text-[18px]'
          }`}
        >
          <span className="pm-brand-p">p</span>
          <span className="pm-text-primary">Music</span>
        </span>
      )}
    </span>
  );
};
