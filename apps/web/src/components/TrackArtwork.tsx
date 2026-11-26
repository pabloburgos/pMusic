import React, { useEffect, useState } from 'react';
import { PMusicLogo } from './PMusicLogo.tsx';
import { usePMusicStore } from '../store/usePMusicStore.ts';
import {
  getCachedOfflineCoverUrl,
  resolveOfflineCoverUrl,
} from '../utils/offline-covers.ts';

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
  loading = 'lazy',
  draggable = false,
  onUnavailableChange,
  children,
}) => {
  const isOfflineNetwork = usePMusicStore((s) => s.isOfflineNetwork);
  const cleanSrc = (src ?? '').trim();

  const [resolvedSrc, setResolvedSrc] = useState<string | null>(() => {
    const cached = getCachedOfflineCoverUrl(trackId, cleanSrc);
    if (cached) return cached;
    if (cleanSrc.startsWith('data:') || cleanSrc.startsWith('blob:')) return cleanSrc;
    if (isOfflineNetwork) return null;
    return cleanSrc || null;
  });
  const [failed, setFailed] = useState<boolean>(false);

  useEffect(() => {
    let active = true;
    setFailed(false);

    const mem = getCachedOfflineCoverUrl(trackId, cleanSrc);
    if (mem) {
      setResolvedSrc(mem);
      onUnavailableChange?.(false);
      return;
    }

    if (cleanSrc.startsWith('data:') || cleanSrc.startsWith('blob:')) {
      setResolvedSrc(cleanSrc);
      onUnavailableChange?.(false);
      return;
    }

    void resolveOfflineCoverUrl(trackId, cleanSrc).then((idbUrl) => {
      if (!active) return;
      if (idbUrl) {
        setResolvedSrc(idbUrl);
        onUnavailableChange?.(false);
      } else if (isOfflineNetwork || !cleanSrc) {
        setResolvedSrc(null);
        setFailed(true);
        onUnavailableChange?.(true);
      } else {
        setResolvedSrc(cleanSrc);
        onUnavailableChange?.(false);
      }
    });

    return () => {
      active = false;
    };
  }, [trackId, cleanSrc, isOfflineNetwork, onUnavailableChange]);

  const handleImgError = () => {
    void resolveOfflineCoverUrl(trackId, cleanSrc).then((idbUrl) => {
      if (idbUrl && idbUrl !== resolvedSrc) {
        setResolvedSrc(idbUrl);
        setFailed(false);
        onUnavailableChange?.(false);
      } else {
        setFailed(true);
        onUnavailableChange?.(true);
      }
    });
  };

  if (failed || !resolvedSrc) {
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
        src={resolvedSrc}
        alt={alt}
        loading={loading}
        draggable={draggable}
        onError={handleImgError}
        className={imgClassName}
      />
      {children}
    </>
  );
};
