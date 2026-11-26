import React from 'react';
import type { ArtistRef } from '@pmusic/core';
import { usePMusicStore } from '../store/usePMusicStore.ts';

export interface ArtistLinksProps {
  artists: readonly ArtistRef[];
  className?: string;
  linkClassName?: string;
  onBeforeNavigate?: () => void;
  stopPropagation?: boolean;
  singleLine?: boolean;
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
}) => {
  const openArtistDetail = usePMusicStore((s) => s.openArtistDetail);
  const prefetchArtistDetail = usePMusicStore((s) => s.prefetchArtistDetail);

  const list = artists.length > 0 ? artists : [{ name: 'Artista' }];

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
