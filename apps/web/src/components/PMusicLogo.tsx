import React, { useId } from 'react';

export interface PMusicLogoProps {
  size?: number;
  variant?: 'icon' | 'full';
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
  const showFull = variant ? variant === 'full' : showWordmark;
  const bgId = `pm-bg-${uid}`;
  const rimId = `pm-rim-${uid}`;
  const glyphId = `pm-glyph-${uid}`;
  const sheenId = `pm-sheen-${uid}`;

  return (
    <span className={`inline-flex items-center gap-2.5 select-none ${className}`}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 256 256"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        className="shrink-0 drop-shadow-[0_4px_12px_rgba(0,0,0,0.35)]"
      >
        <defs>
          <radialGradient id={bgId} cx="30%" cy="20%" r="85%">
            <stop offset="0%" stopColor="#251C3E" />
            <stop offset="52%" stopColor="#12111D" />
            <stop offset="100%" stopColor="#08080D" />
          </radialGradient>
          <linearGradient id={rimId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.45" />
            <stop offset="50%" stopColor="#C084FC" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#38BDF8" stopOpacity="0.32" />
          </linearGradient>
          <linearGradient id={glyphId} x1="18%" y1="12%" x2="88%" y2="90%">
            <stop offset="0%" stopColor="#FFFFFF" />
            <stop offset="52%" stopColor="#E4D0FF" />
            <stop offset="100%" stopColor="#67E8F9" />
          </linearGradient>
          <linearGradient id={sheenId} x1="10%" y1="0%" x2="80%" y2="65%">
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Sculptural Liquid Glass Squircle Base */}
        <rect x="8" y="8" width="240" height="240" rx="64" fill={`url(#${bgId})`} />
        <path
          d="M72 10H184C218 10 246 38 246 72V106C198 76 122 70 10 112V72C10 38 38 10 72 10Z"
          fill={`url(#${sheenId})`}
        />
        <rect
          x="10.5"
          y="10.5"
          width="235"
          height="235"
          rx="61.5"
          stroke={`url(#${rimId})`}
          strokeWidth="5"
        />

        {/* Bespoke Geometric Resonant "p" Acoustic Mark */}
        <rect x="64" y="60" width="28" height="142" rx="14" fill={`url(#${glyphId})`} />
        <path
          d="M92 98C92 73 113 56 142 56C174 56 198 79 198 112C198 145 174 168 142 168C118 168 100 155 92 136"
          stroke={`url(#${glyphId})`}
          strokeWidth="26"
          strokeLinecap="round"
        />
        {/* Core Resonance Pulse & Acoustic Arc */}
        <circle cx="143" cy="112" r="14" fill="#38BDF8" />
        <path
          d="M174 50C193 60 206 75 213 94"
          stroke="#C084FC"
          strokeWidth="12"
          strokeLinecap="round"
          strokeOpacity="0.88"
        />
      </svg>

      {showFull && (
        <span
          className="inline-flex items-baseline text-[17px] font-extrabold tracking-[-0.045em] leading-none"
          style={{ fontFamily: 'var(--pm-font-display)' }}
        >
          <span
            style={{
              background: 'linear-gradient(135deg, #C084FC 0%, #38BDF8 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            p
          </span>
          <span className="pm-text-primary">Music</span>
        </span>
      )}
    </span>
  );
};
