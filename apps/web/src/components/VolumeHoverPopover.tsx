import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Volume1, Volume2, VolumeX } from 'lucide-react';

export interface VolumeHoverPopoverProps {
  volume: number;
  onChangeVolume: (next: number) => void;
  onToggleMute: () => void;
  inlineBreakpoint?: 'lg' | 'sm' | 'never';
}

function getViewportWidth(): number {
  return typeof window !== 'undefined' && Number.isFinite(window.innerWidth)
    ? window.innerWidth
    : 1280;
}

/**
 * Adaptive volume control: shows the horizontal inline bar when enough width is available,
 * and pops up a Liner-style vertical OLED glass capsule above the speaker icon on hover/focus/wheel
 * whenever the window is too compact for the inline slider.
 */
export const VolumeHoverPopover: React.FC<VolumeHoverPopoverProps> = React.memo(
  ({ volume, onChangeVolume, onToggleMute, inlineBreakpoint = 'lg' }) => {
    const [vpWidth, setVpWidth] = useState<number>(getViewportWidth);
    const [popoverOpen, setPopoverOpen] = useState(false);
    const [dragging, setDragging] = useState(false);
    const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const trackRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
      if (typeof window === 'undefined') return;
      const onResize = () => setVpWidth(window.innerWidth);
      window.addEventListener('resize', onResize, { passive: true });
      return () => window.removeEventListener('resize', onResize);
    }, []);

    useEffect(() => {
      return () => {
        if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
      };
    }, []);

    const showInlineSlider =
      inlineBreakpoint === 'never'
        ? false
        : inlineBreakpoint === 'sm'
          ? vpWidth >= 640
          : vpWidth >= 1024;

    const clamped = Math.max(0, Math.min(1, Number.isFinite(volume) ? volume : 0.8));
    const volumePct = Math.round(clamped * 100);

    const openNow = useCallback(() => {
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
      setPopoverOpen(true);
    }, []);

    const scheduleClose = useCallback(() => {
      if (dragging) return;
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
      closeTimerRef.current = setTimeout(() => {
        setPopoverOpen(false);
      }, 180);
    }, [dragging]);

    const applyClientY = useCallback(
      (clientY: number) => {
        const el = trackRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        if (rect.height <= 0) return;
        const raw = (rect.bottom - clientY) / rect.height;
        const next = Math.max(0, Math.min(1, Math.round(raw * 100) / 100));
        onChangeVolume(next);
      },
      [onChangeVolume]
    );

    const handleWheel = useCallback(
      (e: React.WheelEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const step = e.deltaY < 0 ? 0.05 : -0.05;
        const next = Math.max(0, Math.min(1, Math.round((clamped + step) * 100) / 100));
        onChangeVolume(next);
        if (!showInlineSlider) openNow();
      },
      [clamped, onChangeVolume, openNow, showInlineSlider]
    );

    const VolumeGlyph =
      volumePct === 0 ? (
        <VolumeX className="h-3.5 w-3.5" />
      ) : volumePct < 50 ? (
        <Volume1 className="h-3.5 w-3.5" />
      ) : (
        <Volume2 className="h-3.5 w-3.5" />
      );

    return (
      <div
        className="relative flex items-center"
        onMouseEnter={() => {
          if (!showInlineSlider) openNow();
        }}
        onMouseLeave={() => {
          if (!showInlineSlider) scheduleClose();
        }}
        onWheel={handleWheel}
      >
        <button
          type="button"
          data-testid="dock-volume-btn"
          aria-label={volumePct === 0 ? 'Activar sonido' : 'Silenciar'}
          aria-expanded={!showInlineSlider ? popoverOpen : undefined}
          onClick={() => onToggleMute()}
          onFocus={() => {
            if (!showInlineSlider) openNow();
          }}
          onBlur={() => {
            if (!showInlineSlider) scheduleClose();
          }}
          className={`pm-pressable inline-flex h-8 w-8 items-center justify-center rounded-full transition-colors ${
            !showInlineSlider && popoverOpen
              ? 'bg-white/[0.16] text-[var(--pm-text-primary)]'
              : 'pm-text-secondary hover:bg-white/[0.10] hover:text-[var(--pm-text-primary)]'
          }`}
        >
          {VolumeGlyph}
        </button>

        {showInlineSlider ? (
          <input
            type="range"
            role="slider"
            data-testid="dock-volume-slider"
            aria-label="Volumen"
            min={0}
            max={100}
            value={volumePct}
            onChange={(e) => onChangeVolume(Number(e.target.value) / 100)}
            style={{ '--pm-fill': `${volumePct}%` } as React.CSSProperties}
            className="pm-range-subtle mx-1 w-14 xl:w-20"
          />
        ) : (
          popoverOpen && (
            <div
              data-testid="volume-hover-popover"
              onMouseEnter={openNow}
              onMouseLeave={scheduleClose}
              className="pm-volume-pop pm-dock-interactive pointer-events-auto absolute bottom-[calc(100%+8px)] left-1/2 z-50 -translate-x-1/2 pb-2"
            >
              <div className="w-[48px] rounded-[18px] border border-white/14 bg-[#141418]/95 p-[5px] shadow-[0_14px_34px_rgba(0,0,0,0.82)] backdrop-blur-xl">
                <div
                  ref={trackRef}
                  role="slider"
                  tabIndex={0}
                  aria-label="Volumen"
                  aria-orientation="vertical"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={volumePct}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
                      e.preventDefault();
                      onChangeVolume(Math.min(1, Math.round((clamped + 0.05) * 100) / 100));
                    } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
                      e.preventDefault();
                      onChangeVolume(Math.max(0, Math.round((clamped - 0.05) * 100) / 100));
                    }
                  }}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setDragging(true);
                    e.currentTarget.setPointerCapture?.(e.pointerId);
                    applyClientY(e.clientY);
                  }}
                  onPointerMove={(e) => {
                    if (!dragging) return;
                    applyClientY(e.clientY);
                  }}
                  onPointerUp={(e) => {
                    setDragging(false);
                    try {
                      e.currentTarget.releasePointerCapture?.(e.pointerId);
                    } catch {
                      // ignore
                    }
                  }}
                  onPointerCancel={() => setDragging(false)}
                  className="relative flex h-[138px] w-full cursor-ns-resize touch-none select-none flex-col items-center justify-between overflow-hidden rounded-[13px] bg-[#2a2a30] py-2.5 focus:outline-none"
                >
                  {/* Bottom-up volume fill bar */}
                  <div
                    aria-hidden="true"
                    data-testid="volume-hover-fill"
                    className="pointer-events-none absolute inset-x-0 bottom-0 bg-[#E5E5EA] transition-[height] duration-75"
                    style={{ height: `${volumePct}%` }}
                  />

                  {/* Top Speaker Icon (dark ink only once light fill reaches the top >=92%) */}
                  <span
                    aria-hidden="true"
                    className={`relative z-10 pointer-events-none flex items-center justify-center transition-colors ${
                      volumePct >= 92 ? 'text-[#0B0B0E]' : 'text-white'
                    }`}
                  >
                    {volumePct === 0 ? (
                      <VolumeX className="h-4 w-4" />
                    ) : volumePct < 50 ? (
                      <Volume1 className="h-4 w-4" />
                    ) : (
                      <Volume2 className="h-4 w-4" />
                    )}
                  </span>

                  {/* Bottom Percentage Readout (dark ink when fill covers >=16%) */}
                  <span
                    data-testid="volume-hover-pct"
                    className={`tabular-nums relative z-10 pointer-events-none text-[11px] font-bold tracking-tight transition-colors ${
                      volumePct >= 16 ? 'text-[#0B0B0E]' : 'text-white/90'
                    }`}
                  >
                    {volumePct}%
                  </span>
                </div>
              </div>
            </div>
          )
        )}
      </div>
    );
  }
);
VolumeHoverPopover.displayName = 'VolumeHoverPopover';
