import React, { useEffect, useState } from 'react';

export interface UserAvatarProps {
  src?: string | null;
  name: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  showRing?: boolean;
}

const SIZE_CLASSES: Record<NonNullable<UserAvatarProps['size']>, string> = {
  xs: 'h-4 w-4 text-[9px]',
  sm: 'h-6 w-6 text-[10px]',
  md: 'h-9 w-9 text-xs',
  lg: 'h-11 w-11 text-sm',
  xl: 'h-14 w-14 text-lg',
};

const AVATAR_GRADIENTS = [
  'linear-gradient(135deg, #FA233B 0%, #BF5AF2 100%)',
  'linear-gradient(135deg, #0A84FF 0%, #5E5CE6 100%)',
  'linear-gradient(135deg, #30D158 0%, #0A84FF 100%)',
  'linear-gradient(135deg, #FF9F0A 0%, #FF375F 100%)',
  'linear-gradient(135deg, #BF5AF2 0%, #5E5CE6 100%)',
  'linear-gradient(135deg, #FF375F 0%, #FF9F0A 100%)',
] as const;

function pickAvatarGradient(name: string): string {
  const clean = name.trim().toLowerCase() || 'pmusic';
  let h = 0;
  for (let i = 0; i < clean.length; i++) {
    h = (h * 31 + clean.charCodeAt(i)) >>> 0;
  }
  return AVATAR_GRADIENTS[h % AVATAR_GRADIENTS.length]!;
}

export const UserAvatar: React.FC<UserAvatarProps> = ({
  src,
  name,
  size = 'md',
  className = '',
  showRing = false,
}) => {
  const cleanSrc = typeof src === 'string' ? src.trim() : '';
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  useEffect(() => {
    setFailedUrl(null);
  }, [cleanSrc]);

  const initial = (name.trim().replace(/^@+/, '').slice(0, 1) || 'P').toUpperCase();
  const sizeClass = SIZE_CLASSES[size];
  const ringClass = showRing ? 'ring-1 ring-white/20' : '';
  const showImage = Boolean(cleanSrc) && failedUrl !== cleanSrc;

  return (
    <span
      aria-label={name}
      className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-bold text-white select-none ${sizeClass} ${ringClass} ${className}`}
      style={showImage ? undefined : { background: pickAvatarGradient(name) }}
    >
      {showImage ? (
        <img
          src={cleanSrc}
          alt={name}
          referrerPolicy="no-referrer"
          loading="lazy"
          onError={() => setFailedUrl(cleanSrc)}
          className="h-full w-full object-cover"
        />
      ) : (
        <span aria-hidden="true" className="leading-none">
          {initial}
        </span>
      )}
    </span>
  );
};
