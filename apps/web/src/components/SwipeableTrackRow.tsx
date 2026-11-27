import React, { useRef, useState } from 'react';
import { ListMusic, ListPlus } from 'lucide-react';

interface SwipeableTrackRowProps {
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}

const SWIPE_TRIGGER_PX = 68;
const MAX_TRAVEL_PX = 104;

export const SwipeableTrackRow: React.FC<SwipeableTrackRowProps> = ({
  onSwipeLeft,
  onSwipeRight,
  disabled = false,
  children,
}) => {
  const [offsetX, setOffsetX] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const lockedAxisRef = useRef<'x' | 'y' | null>(null);
  const armedSideRef = useRef<'left' | 'right' | null>(null);
  const offsetRef = useRef(0);

  const triggerHaptic = () => {
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        navigator.vibrate(12);
      }
    } catch {
      // ignore unsupported vibrate API
    }
  };

  const resetGesture = () => {
    lockedAxisRef.current = null;
    armedSideRef.current = null;
    offsetRef.current = 0;
    setIsDragging(false);
    setOffsetX(0);
  };

  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (disabled || e.touches.length !== 1) return;
    const t = e.touches[0]!;
    startXRef.current = t.clientX;
    startYRef.current = t.clientY;
    lockedAxisRef.current = null;
    armedSideRef.current = null;
    offsetRef.current = 0;
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (disabled || e.touches.length !== 1) return;
    const t = e.touches[0]!;
    const dx = t.clientX - startXRef.current;
    const dy = t.clientY - startYRef.current;

    if (!lockedAxisRef.current) {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      if (Math.abs(dx) > Math.abs(dy) * 1.25) {
        lockedAxisRef.current = 'x';
        setIsDragging(true);
      } else {
        lockedAxisRef.current = 'y';
        return;
      }
    }

    if (lockedAxisRef.current !== 'x') return;

    // Rubber-band resist beyond MAX_TRAVEL_PX
    const allowedDx =
      dx > 0 && !onSwipeRight
        ? 0
        : dx < 0 && !onSwipeLeft
          ? 0
          : Math.sign(dx) * Math.min(MAX_TRAVEL_PX, Math.abs(dx) * 0.9);

    const nextSide =
      allowedDx <= -SWIPE_TRIGGER_PX
        ? 'left'
        : allowedDx >= SWIPE_TRIGGER_PX
          ? 'right'
          : null;
    if (nextSide && nextSide !== armedSideRef.current) {
      triggerHaptic();
    }
    armedSideRef.current = nextSide;
    offsetRef.current = allowedDx;
    setOffsetX(allowedDx);
  };

  const handleTouchEnd = () => {
    if (lockedAxisRef.current === 'x') {
      const finalOffset = offsetRef.current;
      if (finalOffset <= -SWIPE_TRIGGER_PX && onSwipeLeft) {
        onSwipeLeft();
      } else if (finalOffset >= SWIPE_TRIGGER_PX && onSwipeRight) {
        onSwipeRight();
      }
    }
    resetGesture();
  };

  const revealRight = offsetX < -4; // swiped left -> add to queue
  const revealLeft = offsetX > 4; // swiped right -> add to playlist
  const leftArmed = offsetX <= -SWIPE_TRIGGER_PX;
  const rightArmed = offsetX >= SWIPE_TRIGGER_PX;
  const activeReveal = revealRight || revealLeft;

  return (
    <div
      data-testid="swipeable-track-row"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={resetGesture}
      className="relative overflow-hidden rounded-[10px]"
    >
      {/* Revealed Action Rails */}
      {activeReveal && (
        <div
          aria-hidden="true"
          className={`pointer-events-none absolute inset-0 flex items-center justify-between rounded-[10px] px-4 transition-colors duration-150 ${
            revealLeft
              ? rightArmed
                ? 'bg-[#7C3AED]/90 text-white'
                : 'bg-[#7C3AED]/45 text-white/90'
              : leftArmed
                ? 'bg-emerald-600/90 text-white'
                : 'bg-emerald-600/45 text-white/90'
          }`}
        >
          <div
            className={`flex items-center gap-2 transition-transform duration-150 ${
              revealLeft ? 'opacity-100' : 'opacity-0'
            } ${rightArmed ? 'scale-105' : 'scale-95'}`}
          >
            <ListMusic className="h-4 w-4 shrink-0" />
            <span className="text-xs font-bold tracking-tight">A playlist</span>
          </div>

          <div
            className={`flex items-center gap-2 transition-transform duration-150 ${
              revealRight ? 'opacity-100' : 'opacity-0'
            } ${leftArmed ? 'scale-105' : 'scale-95'}`}
          >
            <span className="text-xs font-bold tracking-tight">A la cola</span>
            <ListPlus className="h-4 w-4 shrink-0" />
          </div>
        </div>
      )}

      {/* Foreground Sliding Row */}
      <div
        className="relative z-10"
        style={{
          transform: offsetX !== 0 ? `translate3d(${offsetX.toFixed(1)}px, 0, 0)` : undefined,
          transition: isDragging
            ? 'none'
            : 'transform 260ms cubic-bezier(0.22, 1, 0.36, 1)',
        }}
      >
        {children}
      </div>
    </div>
  );
};
