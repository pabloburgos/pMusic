export type HapticStyle = 'light' | 'medium' | 'confirm';

/**
 * Triggers crisp native haptic feedback on Android (via PMusicNative bridge)
 * with graceful fallback to Web Vibration API on supported mobile browsers.
 */
export function triggerHaptic(style: HapticStyle = 'light'): void {
  if (typeof window === 'undefined') return;
  try {
    const nativeBridge = (
      window as unknown as {
        PMusicNative?: { triggerHaptic?: (style: string) => void };
      }
    ).PMusicNative;
    if (typeof nativeBridge?.triggerHaptic === 'function') {
      nativeBridge.triggerHaptic(style);
      return;
    }
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      const pattern = style === 'confirm' ? [10, 22, 14] : style === 'medium' ? 15 : 9;
      navigator.vibrate(pattern);
    }
  } catch {
    // ignore unsupported haptic APIs
  }
}
