import React, { useEffect, useRef } from 'react';

export interface OverlayScrollbarProps {
  scrollRef: React.RefObject<HTMLElement | null>;
  insetClassName?: string;
}

/**
 * Floating Chromium-overlay scrollbar inset cleanly inside rounded frames.
 * Updates DOM transforms directly via refs so scrolling never triggers React re-renders.
 */
export const OverlayScrollbar: React.FC<OverlayScrollbarProps> = ({
  scrollRef,
  insetClassName = 'top-4 bottom-4 right-1.5',
}) => {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const thumbRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    const track = trackRef.current;
    const thumb = thumbRef.current;
    if (!el || !track || !thumb) return;

    let hideTimer: ReturnType<typeof setTimeout> | null = null;
    let pointerInside = false;
    let dragging = false;
    let dragStartY = 0;
    let dragStartScrollTop = 0;
    let lastThumbHeight = 0;
    let lastMaxOffset = 0;

    const showTemporarily = () => {
      track.dataset.active = 'true';
      if (hideTimer) clearTimeout(hideTimer);
      if (!pointerInside && !dragging) {
        hideTimer = setTimeout(() => {
          if (!pointerInside && !dragging) {
            track.dataset.active = 'false';
          }
        }, 900);
      }
    };

    const syncMetrics = () => {
      const clientH = el.clientHeight;
      const scrollH = el.scrollHeight;
      const trackH = track.clientHeight;
      if (scrollH <= clientH + 2 || trackH <= 0) {
        track.style.opacity = '0';
        track.style.pointerEvents = 'none';
        lastThumbHeight = 0;
        lastMaxOffset = 0;
        return false;
      }

      track.style.opacity = '';
      track.style.pointerEvents = '';
      const ratio = clientH / scrollH;
      const thumbH = Math.max(32, Math.min(trackH, Math.round(trackH * ratio)));
      const maxScroll = Math.max(1, scrollH - clientH);
      const maxOffset = Math.max(0, trackH - thumbH);
      const offset = Math.max(0, Math.min(maxOffset, (el.scrollTop / maxScroll) * maxOffset));

      lastThumbHeight = thumbH;
      lastMaxOffset = maxOffset;
      thumb.style.height = `${thumbH}px`;
      thumb.style.transform = `translate3d(0, ${offset.toFixed(1)}px, 0)`;
      return true;
    };

    const onScroll = () => {
      if (syncMetrics()) {
        showTemporarily();
      }
    };

    const onContainerEnter = () => {
      pointerInside = true;
      if (syncMetrics()) {
        showTemporarily();
      }
    };

    const onContainerLeave = () => {
      pointerInside = false;
      if (!dragging) {
        if (hideTimer) clearTimeout(hideTimer);
        hideTimer = setTimeout(() => {
          if (!pointerInside && !dragging) {
            track.dataset.active = 'false';
          }
        }, 450);
      }
    };

    const onPointerDown = (e: PointerEvent) => {
      if (!lastThumbHeight || e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();

      if (e.target !== thumb) {
        const trackRect = track.getBoundingClientRect();
        const clickY = e.clientY - trackRect.top - lastThumbHeight / 2;
        const pct = lastMaxOffset > 0 ? Math.max(0, Math.min(1, clickY / lastMaxOffset)) : 0;
        el.scrollTop = pct * Math.max(0, el.scrollHeight - el.clientHeight);
      }

      dragging = true;
      dragStartY = e.clientY;
      dragStartScrollTop = el.scrollTop;
      track.dataset.dragging = 'true';
      track.dataset.active = 'true';
      try {
        track.setPointerCapture(e.pointerId);
      } catch {
        // Ignore if capture is unsupported
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!dragging || lastMaxOffset <= 0) return;
      const deltaY = e.clientY - dragStartY;
      const maxScroll = Math.max(1, el.scrollHeight - el.clientHeight);
      el.scrollTop = Math.max(
        0,
        Math.min(maxScroll, dragStartScrollTop + (deltaY / lastMaxOffset) * maxScroll)
      );
    };

    const stopDrag = (e: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      track.dataset.dragging = 'false';
      try {
        track.releasePointerCapture(e.pointerId);
      } catch {
        // Ignore
      }
      showTemporarily();
    };

    syncMetrics();
    el.addEventListener('scroll', onScroll, { passive: true });
    el.addEventListener('pointerenter', onContainerEnter, { passive: true });
    el.addEventListener('pointerleave', onContainerLeave, { passive: true });
    track.addEventListener('pointerenter', onContainerEnter, { passive: true });
    track.addEventListener('pointerleave', onContainerLeave, { passive: true });
    track.addEventListener('pointerdown', onPointerDown);
    track.addEventListener('pointermove', onPointerMove);
    track.addEventListener('pointerup', stopDrag);
    track.addEventListener('pointercancel', stopDrag);

    const ro =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => void syncMetrics()) : null;
    ro?.observe(el);
    if (el.firstElementChild) ro?.observe(el.firstElementChild);

    const mo =
      typeof MutationObserver !== 'undefined'
        ? new MutationObserver(() => {
            requestAnimationFrame(() => void syncMetrics());
          })
        : null;
    mo?.observe(el, { childList: true, subtree: true });

    return () => {
      if (hideTimer) clearTimeout(hideTimer);
      el.removeEventListener('scroll', onScroll);
      el.removeEventListener('pointerenter', onContainerEnter);
      el.removeEventListener('pointerleave', onContainerLeave);
      track.removeEventListener('pointerenter', onContainerEnter);
      track.removeEventListener('pointerleave', onContainerLeave);
      track.removeEventListener('pointerdown', onPointerDown);
      track.removeEventListener('pointermove', onPointerMove);
      track.removeEventListener('pointerup', stopDrag);
      track.removeEventListener('pointercancel', stopDrag);
      ro?.disconnect();
      mo?.disconnect();
    };
  }, [scrollRef]);

  return (
    <div
      ref={trackRef}
      aria-hidden="true"
      data-active="false"
      data-dragging="false"
      className={`pm-overlay-scrollbar-track pointer-events-auto absolute z-40 w-2.5 select-none ${insetClassName}`}
    >
      <div
        ref={thumbRef}
        className="pm-overlay-scrollbar-thumb mx-auto w-[5px] rounded-full"
      />
    </div>
  );
};
