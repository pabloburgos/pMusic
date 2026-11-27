import React, { useRef, useState } from 'react';
import { ListMusic, ListPlus } from 'lucide-react';
import { triggerHaptic } from '../utils/haptics.ts';

interface SwipeableTrackRowProps {
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}

const SWIPE_TRIGGER_PX = 64;
const MAX_TRAVEL_PX = 96;

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

    const allowedDx =
      dx > 0 && !onSwipeRight
        ? 0
        : dx < 0 && !onSwipeLeft
          ? 0
          : Math.sign(dx) * Math.min(MAX_TRAVEL_PX, Math.abs(dx) * 0.88);

    const nextSide =
      allowedDx <= -SWIPE_TRIGGER_PX
        ? 'left'
        : allowedDx >= SWIPE_TRIGGER_PX
          ? 'right'
          : null;
    if (nextSide && nextSide !== armedSideRef.current) {
      triggerHaptic('light');
    }
    armedSideRef.current = nextSide;
    offsetRef.current = allowedDx;
    setOffsetX(allowedDx);
  };

  const handleTouchEnd = () => {
    if (lockedAxisRef.current === 'x') {
      const finalOffset = offsetRef.current;
      if (finalOffset <= -SWIPE_TRIGGER_PX && onSwipeLeft) {
        triggerHaptic('confirm');
        onSwipeLeft();
      } else if (finalOffset >= SWIPE_TRIGGER_PX && onSwipeRight) {
        triggerHaptic('confirm');
        onSwipeRight();
      }
    }
    resetGesture();
  };

  const revealLeftRail = offsetX > 4; // swiped right -> add to queue
  const revealRightRail = offsetX < -4; // swiped left -> add to playlist
  const rightArmed = offsetX >= SWIPE_TRIGGER_PX;
  const leftArmed = offsetX <= -SWIPE_TRIGGER_PX;
  const activeReveal = revealLeftRail || revealRightRail;
  const progress = Math.min(1, Math.abs(offsetX) / SWIPE_TRIGGER_PX);

  return (
    <div
      data-testid="swipeable-track-row"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={resetGesture}
      className="relative overflow-hidden rounded-[10px]"
    >
      {/* Minimalist Icon-Only Action Rails */}
      {activeReveal && (
        <div
          aria-hidden="true"
          className={`pointer-events-none absolute inset-0 flex items-center justify-between rounded-[10px] px-4 transition-colors duration-150 ${
            revealLeftRail
              ? rightArmed
                ? 'bg-emerald-500/32 text-emerald-100'
                : 'bg-emerald-500/18 text-emerald-200/85'
              : leftArmed
                ? 'bg-violet-500/32 text-violet-100'
                : 'bg-violet-500/18 text-violet-200/85'
          }`}
        >
          {/* Left rail (revealed when swiping right): Add to Queue */}
          <div
            data-testid="swipe-icon-queue"
            className={`flex h-9 w-9 items-center justify-center rounded-full transition-all duration-150 ${
              revealLeftRail ? '' : 'opacity-0'
            } ${
              rightArmed
                ? 'bg-emerald-500 text-[#050507] shadow-[0_0_16px_rgba(16,185,129,0.5)]'
                : 'bg-white/10 text-white'
            }`}
            style={
              revealLeftRail
                ? {
                    opacity: 0.35 + progress * 0.65,
                    transform: `scale(${(rightArmed ? 1.12 : 0.72 + progress * 0.28).toFixed(3)})`,
                  }
                : undefined
            }
          >
            <ListPlus className="h-[18px] w-[18px]" />
          </div>

          {/* Right rail (revealed when swiping left): Add to Playlist */}
          <div
            data-testid="swipe-icon-playlist"
            className={`flex h-9 w-9 items-center justify-center rounded-full transition-all duration-150 ${
              revealRightRail ? '' : 'opacity-0'
            } ${
              leftArmed
                ? 'bg-violet-500 text-white shadow-[0_0_16px_rgba(139,92,246,0.5)]'
                : 'bg-white/10 text-white'
            }`}
            style={
              revealRightRail
                ? {
                    opacity: 0.35 + progress * 0.65,
                    transform: `scale(${(leftArmed ? 1.12 : 0.72 + progress * 0.28).toFixed(3)})`,
                  }
                : undefined
            }
          >
            <ListMusic className="h-[18px] w-[18px]" />
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
