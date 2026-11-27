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
}

/**
 * Keeps Android status & navigation bar backgrounds and icon luminance synchronized
 * with either the active solid app theme or fullscreen Now Playing cover brightness.
 */
export function syncNativeSystemBars(opts: NativeSystemBarOptions): void {
  if (typeof window === 'undefined') return;
  try {
    const nativeBridge = (
      window as unknown as {
        PMusicNative?: {
          setSystemBarsAppearance?: (
            darkIcons: boolean,
            statusBarHex: string,
            navBarHex: string
          ) => void;
        };
      }
    ).PMusicNative;
    if (typeof nativeBridge?.setSystemBarsAppearance !== 'function') return;

    if (opts.nowPlayingOpen) {
      nativeBridge.setSystemBarsAppearance(opts.isLightBackdrop, 'transparent', 'transparent');
      return;
    }

    const bg = THEME_SOLID_BG[opts.themeId] ?? '#070709';
    const isLightTheme = opts.themeId === 'nordic-light';
    nativeBridge.setSystemBarsAppearance(isLightTheme, bg, bg);
  } catch {
    // ignore non-Android environments
  }
}
