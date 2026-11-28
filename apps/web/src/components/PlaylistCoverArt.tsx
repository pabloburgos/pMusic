import React from 'react';
import { Music2 } from 'lucide-react';
import type { ResolvedPlaylistCover } from '../utils/playlist-artwork.ts';
import { TrackArtwork } from './TrackArtwork.tsx';

export interface PlaylistCoverArtProps {
  coverInfo: ResolvedPlaylistCover;
  title: string;
  artistName?: string;
  variant?: 'list' | 'card';
  iconClassName?: string;
  className?: string;
}

export const PlaylistCoverArt: React.FC<PlaylistCoverArtProps> = React.memo(
  ({
    coverInfo,
    title,
    artistName,
    variant = 'card',
    iconClassName = 'h-5 w-5',
    className = '',
  }) => {
    const tiles = coverInfo.collageUrls;
    if (!coverInfo.hasCustomCover && tiles && tiles.length >= 2) {
      return (
        <div
          data-testid="playlist-mosaic-cover"
          className={`grid h-full w-full grid-cols-2 grid-rows-2 gap-[1px] overflow-hidden bg-black/50 ${className}`}
        >
          {tiles.slice(0, 4).map((tileUrl, idx) => (
            <div key={`${tileUrl}-${idx}`} className="relative h-full w-full overflow-hidden bg-[#141418]">
              <img
                src={tileUrl}
                alt=""
                loading="lazy"
                decoding="async"
                className="h-full w-full object-cover"
              />
            </div>
          ))}
        </div>
      );
    }

    if (coverInfo.url) {
      return (
        <TrackArtwork
          trackId={coverInfo.fallbackTrackId}
          src={coverInfo.url}
          title={title}
          artistName={artistName}
          alt={title}
          variant={variant}
          className={className}
          imgClassName="h-full w-full object-cover"
        />
      );
    }

    return (
      <div
        data-testid="playlist-empty-cover"
        className={`flex h-full w-full items-center justify-center bg-[#141418] text-white/35 ring-1 ring-inset ring-white/[0.06] ${className}`}
      >
        <Music2 className={iconClassName} />
      </div>
    );
  }
);
PlaylistCoverArt.displayName = 'PlaylistCoverArt';
