import React, { useEffect, useState } from 'react';
import type { ArtistRef } from '@pmusic/core';
import { usePMusicStore } from '../store/usePMusicStore.ts';

function useIsMobileViewport(): boolean {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth < 768 : false
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check, { passive: true });
    return () => window.removeEventListener('resize', check);
  }, []);

  return isMobile;
}

export interface ArtistLinksProps {
  artists: readonly ArtistRef[];
  className?: string;
  linkClassName?: string;
  onBeforeNavigate?: () => void;
  stopPropagation?: boolean;
  singleLine?: boolean;
  disableOnMobile?: boolean;
}

/**
 * Renders every collaborating artist as an individual interactive button
 * so listeners can jump cleanly to ANY featured or collaborating artist profile.
 */
export const ArtistLinks: React.FC<ArtistLinksProps> = ({
  artists,
  className = '',
  linkClassName = 'hover:underline',
  onBeforeNavigate,
  stopPropagation = true,
  singleLine = true,
  disableOnMobile = false,
}) => {
  const openArtistDetail = usePMusicStore((s) => s.openArtistDetail);
  const prefetchArtistDetail = usePMusicStore((s) => s.prefetchArtistDetail);
  const isMobile = useIsMobileViewport();

  const list = artists.length > 0 ? artists : [{ name: 'Artista' }];

  if (disableOnMobile && isMobile) {
    return (
      <span
        className={`pointer-events-none inline-flex max-w-full select-none items-center truncate py-[1px] leading-normal ${className}`}
      >
        {list.map((a) => a.name).join(', ')}
      </span>
    );
  }

  return (
    <span
      className={`inline-flex max-w-full items-center py-[1px] leading-normal ${
        singleLine ? 'flex-nowrap overflow-x-clip whitespace-nowrap' : 'flex-wrap'
      } ${className}`}
    >
      {list.map((artist, idx) => {
        const cleanId = artist.id?.trim() ?? '';
        const target = /^\d+$/.test(cleanId) ? cleanId : artist.name.trim();
        return (
          <React.Fragment key={`${target}-${idx}`}>
            {idx > 0 && <span className="mr-1 shrink-0 select-none opacity-75">,</span>}
            <span
              role="link"
              tabIndex={0}
              aria-label={`Ir al artista ${artist.name}`}
              onMouseEnter={() => {
                if (target) prefetchArtistDetail(target, { name: artist.name });
              }}
              onTouchStart={() => {
                if (target) prefetchArtistDetail(target, { name: artist.name });
              }}
              onClick={(e) => {
                if (stopPropagation) e.stopPropagation();
                onBeforeNavigate?.();
                if (target) void openArtistDetail(target, { name: artist.name });
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  if (stopPropagation) e.stopPropagation();
                  onBeforeNavigate?.();
                  if (target) void openArtistDetail(target, { name: artist.name });
                }
              }}
              className={`shrink-0 cursor-pointer text-left transition-colors ${linkClassName}`}
            >
              {artist.name}
            </span>
          </React.Fragment>
        );
      })}
    </span>
  );
};
