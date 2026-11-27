export const THEME_SOLID_BG: Record<string, string> = {
  obsidian: '#070709',
  'nordic-light': '#F5F2EB',
  'vinyl-amber': '#100B08',
  'cyber-indigo': '#070919',
  'emerald-forest': '#05100B',
  'crimson-rose': '#13070B',
};

export interface NativeSystemBarOptions {
  nowPlayingOpen: boolean;
  isLightBackdrop: boolean;
  themeId: string;
  transparentStatusBar?: boolean;
  isLightStatusBar?: boolean;
}

/**
 * Keeps Android status & navigation bar backgrounds and icon luminance synchronized
 * with the active solid app theme, transparent full-bleed hero banners, or fullscreen Now Playing.
 */
export function syncNativeSystemBars(opts: NativeSystemBarOptions): void {
  if (typeof window === 'undefined') return;
  try {
    const bg = THEME_SOLID_BG[opts.themeId] ?? '#070709';
    const isLightTheme = opts.themeId === 'nordic-light';
    const darkStatusIcons = opts.nowPlayingOpen
      ? Boolean(opts.isLightBackdrop)
      : opts.transparentStatusBar
        ? Boolean(opts.isLightStatusBar ?? isLightTheme)
        : isLightTheme;
    const targetThemeColor = opts.nowPlayingOpen
      ? opts.isLightBackdrop
        ? '#FFFFFF'
        : '#070709'
      : opts.transparentStatusBar && darkStatusIcons
        ? '#FFFFFF'
        : bg;

    if (typeof document !== 'undefined') {
      const metaTheme = document.querySelector('meta[name="theme-color"]');
      if (metaTheme) {
        metaTheme.setAttribute('content', targetThemeColor);
      }
    }

    const nativeBridge = (
      window as unknown as {
        PMusicNative?: {
          setSystemBarsAppearance?: (
            darkIcons: boolean,
            statusBarHex: string,
            navBarHex: string
          ) => void;
          setSystemBarsSplitAppearance?: (
            darkStatusIcons: boolean,
            darkNavIcons: boolean,
            statusBarHex: string,
            navBarHex: string
          ) => void;
        };
      }
    ).PMusicNative;
    if (!nativeBridge) return;

    if (opts.nowPlayingOpen) {
      nativeBridge.setSystemBarsAppearance?.(opts.isLightBackdrop, 'transparent', 'transparent');
      return;
    }

    if (opts.transparentStatusBar) {
      if (typeof nativeBridge.setSystemBarsSplitAppearance === 'function') {
        nativeBridge.setSystemBarsSplitAppearance(darkStatusIcons, isLightTheme, 'transparent', bg);
      } else {
        nativeBridge.setSystemBarsAppearance?.(darkStatusIcons, 'transparent', bg);
      }
      return;
    }

    nativeBridge.setSystemBarsAppearance?.(isLightTheme, bg, bg);
  } catch {
    // ignore non-Android environments
  }
}
