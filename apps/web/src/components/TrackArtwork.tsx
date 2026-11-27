import React, { useEffect, useId, useMemo, useState } from 'react';
import { PMusicLogo } from './PMusicLogo.tsx';
import { usePMusicStore } from '../store/usePMusicStore.ts';
import {
  getCachedOfflineCoverUrl,
  resolveOfflineCoverUrl,
} from '../utils/offline-covers.ts';
import {
  getCachedArtistArtwork,
  resolveArtistArtwork,
} from '../utils/artist-artwork.ts';
import { optimizeArtworkUrl, type ArtworkSlot } from '../utils/image-opt.ts';

export interface TrackArtworkProps {
  trackId?: string;
  src?: string | null;
  alt: string;
  title?: string;
  artistName?: string;
  artistId?: string;
  variant: 'list' | 'nowplaying' | 'mini' | 'card';
  className?: string;
  imgClassName?: string;
  loading?: 'lazy' | 'eager';
  draggable?: boolean;
  onUnavailableChange?: (unavailable: boolean) => void;
  children?: React.ReactNode;
}

interface CoverPalette {
  bg: string;
  glow1: string;
  glow2: string;
  accent: string;
  ring: string;
}

const PMUSIC_EDITORIAL_PALETTES: readonly CoverPalette[] = [
  {
    bg: '#100914',
    glow1: 'rgba(244, 63, 94, 0.56)',
    glow2: 'rgba(168, 85, 247, 0.42)',
    accent: '#FB7185',
    ring: 'rgba(255, 255, 255, 0.14)',
  },
  {
    bg: '#08101c',
    glow1: 'rgba(56, 189, 248, 0.52)',
    glow2: 'rgba(99, 102, 241, 0.44)',
    accent: '#38BDF8',
    ring: 'rgba(255, 255, 255, 0.14)',
  },
  {
    bg: '#110b1c',
    glow1: 'rgba(168, 85, 247, 0.54)',
    glow2: 'rgba(236, 72, 153, 0.38)',
    accent: '#C084FC',
    ring: 'rgba(255, 255, 255, 0.15)',
  },
  {
    bg: '#071410',
    glow1: 'rgba(16, 185, 129, 0.50)',
    glow2: 'rgba(6, 182, 212, 0.38)',
    accent: '#34D399',
    ring: 'rgba(255, 255, 255, 0.13)',
  },
  {
    bg: '#160d07',
    glow1: 'rgba(245, 158, 11, 0.54)',
    glow2: 'rgba(239, 68, 68, 0.40)',
    accent: '#FBBF24',
    ring: 'rgba(255, 255, 255, 0.14)',
  },
  {
    bg: '#091318',
    glow1: 'rgba(34, 211, 238, 0.50)',
    glow2: 'rgba(59, 130, 246, 0.40)',
    accent: '#22D3EE',
    ring: 'rgba(255, 255, 255, 0.14)',
  },
  {
    bg: '#170a12',
    glow1: 'rgba(236, 72, 153, 0.52)',
    glow2: 'rgba(139, 92, 246, 0.42)',
    accent: '#F472B6',
    ring: 'rgba(255, 255, 255, 0.15)',
  },
  {
    bg: '#0b0e1c',
    glow1: 'rgba(129, 140, 248, 0.54)',
    glow2: 'rgba(14, 165, 233, 0.40)',
    accent: '#818CF8',
    ring: 'rgba(255, 255, 255, 0.14)',
  },
];

function hashSeed(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export const TrackArtwork: React.FC<TrackArtworkProps> = ({
  trackId,
  src,
  alt,
  title,
  artistName,
  artistId,
  variant,
  className = '',
  imgClassName = 'h-full w-full object-cover',
  loading,
  draggable = false,
  onUnavailableChange,
  children,
}) => {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const isOfflineNetwork = usePMusicStore((s) => s.isOfflineNetwork);
  const cleanSrc = (src ?? '').trim();
  const artworkSlot: ArtworkSlot =
    variant === 'nowplaying'
      ? 'nowplaying'
      : variant === 'card'
        ? 'card'
        : 'row';
  const optimizedSrc = optimizeArtworkUrl(cleanSrc, artworkSlot);

  const isEagerVariant = variant === 'nowplaying' || variant === 'mini';
  const effectiveLoading = loading ?? (isEagerVariant ? 'eager' : 'lazy');
  const [resolvedSrc, setResolvedSrc] = useState<string | null>(() => {
    const cached = getCachedOfflineCoverUrl(trackId, cleanSrc);
    if (cached) return cached;
    if (cleanSrc.startsWith('data:') || cleanSrc.startsWith('blob:')) return cleanSrc;
    if (isOfflineNetwork) return null;
    return optimizedSrc || null;
  });
  const [displayedSrc, setDisplayedSrc] = useState<string | null>(resolvedSrc);
  const [failed, setFailed] = useState<boolean>(false);
  const [artistArtUrl, setArtistArtUrl] = useState<string | null>(() =>
    artistName ? getCachedArtistArtwork(artistName) : null
  );
  const [artistArtFailed, setArtistArtFailed] = useState<boolean>(false);

  const displayTitle = (title ?? alt ?? 'pMusic').trim() || 'pMusic';
  const primaryArtist = (artistName ?? '').trim();

  const palette = useMemo(() => {
    const idx =
      hashSeed(`${primaryArtist}::${displayTitle}::${trackId ?? ''}`) %
      PMUSIC_EDITORIAL_PALETTES.length;
    return PMUSIC_EDITORIAL_PALETTES[idx]!;
  }, [primaryArtist, displayTitle, trackId]);

  useEffect(() => {
    let active = true;
    setFailed(false);

    const commitSrc = (nextUrl: string | null) => {
      if (!active) return;
      setResolvedSrc(nextUrl);
      if (nextUrl) {
        setFailed(false);
        onUnavailableChange?.(false);
        if (
          !isEagerVariant ||
          nextUrl.startsWith('data:') ||
          nextUrl.startsWith('blob:') ||
          typeof Image === 'undefined' ||
          displayedSrc === nextUrl
        ) {
          setDisplayedSrc(nextUrl);
        } else {
          // Hold previous decoded image visible until the incoming artwork finishes decoding (zero 0.2s blink)
          const pre = new Image();
          pre.decoding = 'async';
          let settled = false;
          const promote = () => {
            if (settled || !active) return;
            settled = true;
            setDisplayedSrc(nextUrl);
          };
          const safety = setTimeout(promote, 1800);
          pre.onload = () => {
            clearTimeout(safety);
            if (typeof pre.decode === 'function') {
              void pre.decode().catch(() => {}).finally(promote);
            } else {
              promote();
            }
          };
          pre.onerror = () => {
            clearTimeout(safety);
            promote();
          };
          pre.src = nextUrl;
          if (pre.complete && pre.naturalWidth > 0) {
            clearTimeout(safety);
            promote();
          }
        }
      } else {
        setDisplayedSrc(null);
        setFailed(true);
        onUnavailableChange?.(true);
      }
    };

    const mem = getCachedOfflineCoverUrl(trackId, cleanSrc);
    if (mem) {
      commitSrc(mem);
      return () => {
        active = false;
      };
    }

    if (cleanSrc.startsWith('data:') || cleanSrc.startsWith('blob:')) {
      commitSrc(cleanSrc);
      return () => {
        active = false;
      };
    }

    // Online fast-path: begin loading immediately with bandwidth-optimized CDN dimensions while IDB cache check runs in parallel
    if (!isOfflineNetwork && optimizedSrc) {
      commitSrc(optimizedSrc);
    }

    void resolveOfflineCoverUrl(trackId, cleanSrc).then((idbUrl) => {
      if (!active) return;
      if (idbUrl) {
        commitSrc(idbUrl);
      } else if (isOfflineNetwork || !optimizedSrc) {
        commitSrc(null);
      }
    });

    return () => {
      active = false;
    };
  }, [trackId, cleanSrc, optimizedSrc, isOfflineNetwork, isEagerVariant, onUnavailableChange]);

  const needsFallback = failed || !(displayedSrc ?? resolvedSrc);

  useEffect(() => {
    setArtistArtFailed(false);
    if (!needsFallback || !primaryArtist || isOfflineNetwork) {
      setArtistArtUrl(primaryArtist ? getCachedArtistArtwork(primaryArtist) : null);
      return;
    }
    const cached = getCachedArtistArtwork(primaryArtist);
    if (cached) {
      setArtistArtUrl(cached);
      return;
    }
    let active = true;
    void resolveArtistArtwork(primaryArtist, artistId).then((url) => {
      if (active && url) setArtistArtUrl(url);
    });
    return () => {
      active = false;
    };
  }, [needsFallback, primaryArtist, artistId, isOfflineNetwork]);

  const handleImgError = () => {
    void resolveOfflineCoverUrl(trackId, cleanSrc).then((idbUrl) => {
      if (idbUrl && idbUrl !== resolvedSrc) {
        setResolvedSrc(idbUrl);
        setDisplayedSrc(idbUrl);
        setFailed(false);
        onUnavailableChange?.(false);
      } else {
        setFailed(true);
        onUnavailableChange?.(true);
      }
    });
  };

  const renderSrc = displayedSrc ?? resolvedSrc;
  if (failed || !renderSrc) {
    const showArtistBg = Boolean(artistArtUrl && !artistArtFailed);
    const isLarge = variant === 'nowplaying' || variant === 'card';
    const isNowPlaying = variant === 'nowplaying';
    const bgStyle: React.CSSProperties = {
      backgroundColor: palette.bg,
      backgroundImage: `radial-gradient(circle at 18% 18%, ${palette.glow1} 0%, transparent 56%), radial-gradient(circle at 86% 82%, ${palette.glow2} 0%, transparent 58%), linear-gradient(145deg, rgba(255,255,255,0.06) 0%, rgba(0,0,0,0.28) 100%)`,
    };

    if (!isLarge) {
      return (
        <div
          data-testid="pmusic-generated-cover"
          className={`relative flex h-full w-full items-center justify-center overflow-hidden ${className}`}
          style={bgStyle}
        >
          {showArtistBg && (
            <>
              <img
                src={artistArtUrl!}
                alt=""
                aria-hidden="true"
                loading="lazy"
                decoding="async"
                onError={() => setArtistArtFailed(true)}
                className="pointer-events-none absolute inset-0 h-full w-full select-none object-cover object-top"
              />
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/75 via-black/25 to-black/15"
              />
            </>
          )}
          {!showArtistBg && (
            <svg
              aria-hidden="true"
              viewBox="0 0 64 64"
              className="pointer-events-none absolute inset-0 h-full w-full opacity-40"
            >
              <circle cx="52" cy="14" r="22" fill="none" stroke={palette.ring} strokeWidth="1.2" />
              <circle cx="52" cy="14" r="14" fill="none" stroke={palette.ring} strokeWidth="0.9" />
              <path d="M0 54 Q 28 34 64 46" fill="none" stroke={palette.accent} strokeOpacity="0.4" strokeWidth="1.4" />
            </svg>
          )}
          <span className="relative z-10 flex items-center justify-center drop-shadow-[0_2px_6px_rgba(0,0,0,0.65)]">
            <PMusicLogo
              variant="mark"
              size={variant === 'mini' ? 14 : 16}
              color="#FFFFFF"
            />
          </span>
          {children}
        </div>
      );
    }

    return (
      <div
        data-testid={isNowPlaying ? 'nowplaying-missing-cover' : 'pmusic-generated-cover'}
        className={`relative flex h-full w-full flex-col justify-between overflow-hidden select-none ${
          isNowPlaying ? 'rounded-[16px] p-5 sm:p-6' : 'rounded-[12px] p-3.5'
        } text-left ${className}`}
        style={bgStyle}
      >
        {showArtistBg && (
          <>
            <img
              src={artistArtUrl!}
              alt={primaryArtist || displayTitle}
              decoding="async"
              onError={() => setArtistArtFailed(true)}
              className="pointer-events-none absolute inset-0 h-full w-full select-none object-cover object-top transition-transform duration-700"
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0"
              style={{
                background: `linear-gradient(180deg, rgba(6,6,10,0.46) 0%, rgba(6,6,10,0.18) 38%, rgba(6,6,10,0.88) 100%), radial-gradient(circle at 85% 18%, ${palette.glow1} 0%, transparent 55%)`,
                mixBlendMode: 'normal',
              }}
            />
          </>
        )}

        {/* Modern Geometric Acoustic Cover Art Layer */}
        <svg
          aria-hidden="true"
          viewBox="0 0 240 240"
          className="pointer-events-none absolute inset-0 h-full w-full"
        >
          <defs>
            <linearGradient id={`pm-cov-grad-${uid}`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor={palette.accent} stopOpacity="0.34" />
              <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0.03" />
            </linearGradient>
          </defs>
          <circle
            cx="178"
            cy="64"
            r="78"
            fill="none"
            stroke={palette.ring}
            strokeWidth="1.2"
          />
          <circle
            cx="178"
            cy="64"
            r="54"
            fill="none"
            stroke={`url(#pm-cov-grad-${uid})`}
            strokeWidth="1.5"
          />
          <circle
            cx="178"
            cy="64"
            r="28"
            fill="none"
            stroke={palette.accent}
            strokeOpacity="0.35"
            strokeWidth="1.2"
          />
          <path
            d="M-12 168 C 52 128, 128 192, 252 136"
            fill="none"
            stroke={`url(#pm-cov-grad-${uid})`}
            strokeWidth="2"
          />
        </svg>

        {/* Subtle Inner Specular Hairline */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-[inherit] ring-1 ring-inset ring-white/15"
        />

        {/* Top Row: Pure Unboxed pMusic Mark + Subtle Acoustic Tag */}
        <div className="relative z-10 flex items-center justify-between">
          <PMusicLogo
            variant="mark"
            size={isNowPlaying ? 26 : 18}
            color="#FFFFFF"
            className="drop-shadow-[0_3px_10px_rgba(0,0,0,0.55)]"
          />
          <span
            className={`inline-flex items-center gap-1 rounded-full bg-black/35 font-semibold uppercase tracking-[0.16em] text-white/80 backdrop-blur-md ${
              isNowPlaying ? 'px-2.5 py-1 text-[9.5px]' : 'px-2 py-0.5 text-[8px]'
            }`}
          >
            <span
              aria-hidden="true"
              className="h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: palette.accent }}
            />
            pMusic Art
          </span>
        </div>

        {/* Bottom Editorial Typography */}
        <div className="relative z-10 min-w-0 space-y-1">
          <div
            className="h-[2px] w-7 rounded-full"
            style={{ backgroundColor: palette.accent }}
          />
          {primaryArtist && (
            <p
              className={`truncate font-bold uppercase tracking-[0.14em] text-white/75 drop-shadow-sm ${
                isNowPlaying ? 'text-[11px] pt-1' : 'text-[9px] pt-0.5'
              }`}
            >
              {primaryArtist}
            </p>
          )}
          <p
            className={`line-clamp-2 font-extrabold leading-[1.08] tracking-tight text-white drop-shadow-[0_2px_10px_rgba(0,0,0,0.6)] ${
              isNowPlaying ? 'text-xl sm:text-2xl' : 'text-sm'
            }`}
          >
            {displayTitle}
          </p>
        </div>

        {children}
      </div>
    );
  }

  return (
    <>
      <img
        src={renderSrc}
        alt={alt}
        loading={effectiveLoading}
        decoding="async"
        draggable={draggable}
        onError={handleImgError}
        className={imgClassName}
      />
      {children}
    </>
  );
};
