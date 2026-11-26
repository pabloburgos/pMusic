import React, { useEffect, useState } from 'react';
import { PMusicLogo } from './PMusicLogo.tsx';
import { usePMusicStore } from '../store/usePMusicStore.ts';
import {
  getCachedOfflineCoverUrl,
  resolveOfflineCoverUrl,
} from '../utils/offline-covers.ts';
import { optimizeArtworkUrl, type ArtworkSlot } from '../utils/image-opt.ts';

export interface TrackArtworkProps {
  trackId?: string;
  src?: string | null;
  alt: string;
  variant: 'list' | 'nowplaying' | 'mini' | 'card';
  className?: string;
  imgClassName?: string;
  loading?: 'lazy' | 'eager';
  draggable?: boolean;
  onUnavailableChange?: (unavailable: boolean) => void;
  children?: React.ReactNode;
}

export const TrackArtwork: React.FC<TrackArtworkProps> = ({
  trackId,
  src,
  alt,
  variant,
  className = '',
  imgClassName = 'h-full w-full object-cover',
  loading,
  draggable = false,
  onUnavailableChange,
  children,
}) => {
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
    if (variant === 'list') {
      return null;
    }
    if (variant === 'nowplaying') {
      return (
        <div
          data-testid="nowplaying-missing-cover"
          className={`flex h-full w-full flex-col items-center justify-center gap-3 rounded-[16px] border border-white/10 bg-[#0d0d12] px-6 text-center ${className}`}
        >
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04]">
            <PMusicLogo size={30} className="text-white/55" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-bold tracking-tight text-white/90">
              No se consiguió cargar la portada
            </p>
            <p className="text-[11.5px] font-medium text-white/45">
              Audio disponible en este dispositivo
            </p>
          </div>
          {children}
        </div>
      );
    }
    return (
      <div
        className={`flex h-full w-full items-center justify-center bg-[#121218] ${className}`}
      >
        <PMusicLogo size={variant === 'mini' ? 18 : 28} className="text-white/55" />
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
