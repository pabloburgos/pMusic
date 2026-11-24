import { useEffect, useState } from 'react';

/**
 * Delays showing a playback buffering spinner so fast track loads (< delayMs)
 * render seamlessly without any visual flash.
 */
export function useDelayedBuffering(isBuffering: boolean, delayMs = 500): boolean {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!isBuffering) {
      setVisible(false);
      return;
    }
    const timer = setTimeout(() => {
      setVisible(true);
    }, delayMs);
    return () => {
      clearTimeout(timer);
    };
  }, [isBuffering, delayMs]);

  return visible;
}
