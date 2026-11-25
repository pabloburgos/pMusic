import React, { useLayoutEffect, useRef, useState } from 'react';

interface MarqueeTextProps {
  children: React.ReactNode;
  disabled?: boolean;
  className?: string;
  trackClassName?: string;
  speedPxPerSec?: number;
  testId?: string;
}

/**
 * YouTube Music style smooth horizontal ping-pong marquee.
 * Automatically activates ONLY when text overflows its container,
 * pauses on hover, and immediately resets flat when `disabled` is true
 * (e.g. during crossfade transitions or when disabled in preferences).
 */
export const MarqueeText: React.FC<MarqueeTextProps> = ({
  children,
  disabled = false,
  className = '',
  trackClassName = '',
  speedPxPerSec = 26,
  testId,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [overflowPx, setOverflowPx] = useState(0);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const track = trackRef.current;
    if (!container || !track || disabled) {
      setOverflowPx(0);
      return;
    }

    const measure = () => {
      const cw = container.clientWidth;
      const tw = track.scrollWidth;
      const diff = Math.ceil(tw - cw);
      setOverflowPx(diff > 3 ? diff : 0);
    };

    measure();

    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(measure);
      ro.observe(container);
      ro.observe(track);
    } else if (typeof window !== 'undefined') {
      window.addEventListener('resize', measure);
    }

    return () => {
      if (ro) {
        ro.disconnect();
      } else if (typeof window !== 'undefined') {
        window.removeEventListener('resize', measure);
      }
    };
  }, [children, disabled]);

  const active = !disabled && overflowPx > 3;
  const oneWaySec = Math.max(2.2, overflowPx / Math.max(12, speedPxPerSec));
  const durationSec = Math.min(20, Math.max(7, oneWaySec * 2 + 3.8));

  return (
    <div
      ref={containerRef}
      data-testid={testId}
      data-marquee-active={active ? 'true' : 'false'}
      className={`pm-marquee-container relative min-w-0 max-w-full overflow-hidden ${
        active ? 'pm-marquee-is-overflowing' : ''
      } ${className}`}
    >
      <div
        ref={trackRef}
        className={`pm-marquee-track ${
          active ? 'pm-marquee-animating inline-flex w-max whitespace-nowrap' : 'block max-w-full truncate'
        } ${trackClassName}`}
        style={
          active
            ? ({
                '--pm-marquee-shift': `-${overflowPx}px`,
                '--pm-marquee-duration': `${durationSec.toFixed(2)}s`,
              } as React.CSSProperties)
            : undefined
        }
      >
        {children}
      </div>
    </div>
  );
};
