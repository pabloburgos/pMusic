import React from 'react';

export interface PMusicLogoProps {
  size?: number;
  showWordmark?: boolean;
  className?: string;
}

export const PMusicLogo: React.FC<PMusicLogoProps> = ({
  size = 28,
  showWordmark = false,
  className = '',
}) => {
  return (
    <span className={`inline-flex items-center gap-2.5 select-none ${className}`}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 36 36"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        className="shrink-0"
      >
        <rect x="0.75" y="0.75" width="34.5" height="34.5" rx="9" fill="#111117" />
        <rect
          x="0.75"
          y="0.75"
          width="34.5"
          height="34.5"
          rx="9"
          stroke="rgba(255,255,255,0.18)"
          strokeWidth="1.1"
        />
        <rect x="8.6" y="12" width="3.6" height="12" rx="1.8" fill="#FFFFFF" fillOpacity="0.86" />
        <rect x="14.3" y="7.5" width="3.6" height="21" rx="1.8" fill="#E2CCFF" />
        <rect x="20" y="10.5" width="3.6" height="15" rx="1.8" fill="#FFFFFF" fillOpacity="0.96" />
        <rect x="25.7" y="14.5" width="3.6" height="7" rx="1.8" fill="#FFFFFF" fillOpacity="0.76" />
      </svg>
      {showWordmark && (
        <span className="text-[15.5px] font-bold tracking-[-0.03em] text-[#F5F5F7]">
          pMusic
        </span>
      )}
    </span>
  );
};
