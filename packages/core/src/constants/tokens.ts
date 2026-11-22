export type TypographyAllowedWeight = 400 | 500 | 600 | 700;

export interface TypographyViewportSpec {
  readonly sizePx: number;
  readonly lineHeightPx: number;
  readonly letterSpacing: string;
  readonly tracking: string;
}

export interface TypographyScaleToken {
  readonly cssName: string;
  readonly mobile: TypographyViewportSpec;
  readonly desktop: TypographyViewportSpec;
  readonly weight: TypographyAllowedWeight;
  readonly weights: readonly TypographyAllowedWeight[];
  readonly usage: string;
}

export type TypographyScaleKey =
  | 'displayLyric'
  | 'largeTitle'
  | 'title1'
  | 'title2'
  | 'title3'
  | 'headline'
  | 'body'
  | 'subhead'
  | 'footnote'
  | 'caption';

export interface MotionSpringPhysics {
  readonly type: 'spring';
  readonly stiffness: number;
  readonly damping: number;
  readonly mass?: number;
}

export interface MotionReducedFallback {
  readonly duration: number;
  readonly ease?: string;
}

export type MotionSpringPreset = MotionSpringPhysics;
export type MotionFadePreset = MotionReducedFallback;

function deepFreeze<T>(obj: T): Readonly<T> {
  if (obj !== null && typeof obj === 'object') {
    Object.freeze(obj);
    for (const value of Object.values(obj as Record<string, unknown>)) {
      if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
        deepFreeze(value);
      }
    }
  }
  return obj;
}

export const PMUSIC_CSS_VARIABLES = deepFreeze({
  // Content Layer Surfaces (Opaque — NEVER Liquid Glass)
  '--pm-bg-oled': '#000000',
  '--pm-bg-base': '#0A0A0D',
  '--pm-bg-card': '#121216',
  '--pm-bg-card-hover': '#1A1A20',
  '--pm-bg-elevated': '#1C1C22',
  '--pm-bg-elevated-hi': '#24242C',

  // Functional Layer — Liquid Glass Regular
  '--pm-glass-regular-bg': 'rgba(20, 20, 26, 0.74)',
  '--pm-glass-regular-blur': '24px',
  '--pm-glass-regular-sat': '1.4',
  '--pm-glass-border': 'rgba(255, 255, 255, 0.12)',
  '--pm-glass-specular-top': 'inset 0 1px 0 rgba(255, 255, 255, 0.14)',

  // Functional Layer — Liquid Glass Clear (ONLY over visually rich media)
  '--pm-glass-clear-bg': 'rgba(22, 22, 28, 0.30)',
  '--pm-glass-clear-blur': '14px',
  '--pm-glass-clear-sat': '1.3',
  '--pm-glass-bright-scrim': 'rgba(0, 0, 0, 0.35)',

  // 4-Level Label & Separator Hierarchy
  '--pm-text-primary': '#FFFFFF',
  '--pm-text-secondary': '#B3B3BE',
  '--pm-text-tertiary': '#8E8E9B',
  '--pm-text-quaternary': 'rgba(235, 235, 245, 0.28)',
  '--pm-separator': 'rgba(255, 255, 255, 0.10)',
  '--pm-separator-opaque': '#2C2C34',

  // Brand & Semantic Signals
  '--pm-accent-text': '#FF4D6A',
  '--pm-accent-cta': '#C81935',
  '--pm-accent-cta-hover': '#D91E3B',
  '--pm-dynamic-accent': 'var(--pm-accent-text)',
  '--pm-status-connected': '#30D158',
  '--pm-status-dj': '#FF9F0A',
  '--pm-status-destructive': '#FF5E57',
  '--pm-status-destructive-bg': '#D70015',
  '--pm-status-info': '#4DA3FF',

  // Ambient Mesh Defaults
  '--pm-ambient-1': 'rgba(140, 26, 52, 0.38)',
  '--pm-ambient-2': 'rgba(48, 28, 86, 0.32)',
  '--pm-ambient-3': 'rgba(16, 48, 72, 0.26)',

  // Concentric Corner Radii
  '--pm-radius-pill': '9999px',
  '--pm-radius-sheet-mobile': '28px',
  '--pm-radius-dialog': '20px',
  '--pm-radius-artwork-lg': '18px',
  '--pm-radius-card': '14px',
  '--pm-radius-art-md': '10px',
  '--pm-radius-art-sm': '8px',
  '--pm-radius-control': '10px',

  // Spacing, Touch Targets & Layout Dimensions
  '--pm-target-mobile': '44px',
  '--pm-target-desktop': '28px',
  '--pm-margin-mobile': '16px',
  '--pm-margin-desktop': '28px',
  '--pm-sidebar-w': '248px',
  '--pm-sidebar-collapsed-w': '72px',
  '--pm-desktop-player-h': '80px',
} as const);

const SEMANTIC_TOKENS = deepFreeze({
  /** Remote device connected / Downloaded (use #000000 on solid pill = 10.39:1) */
  connected: '#30D158',
  /** Sesión DJ Active (use #000000 on solid pill = 10.22:1) */
  dj: '#FF9F0A',
  /** Destructive text on dark/glass surfaces (6.99:1 on #000, 5.51:1 on #1E1E26) */
  destructive: '#FF5E57',
  /** Destructive solid button fill with #FFFFFF text (5.38:1) */
  destructiveBg: '#D70015',
  /** Sync / informational badge (8.00:1 on #000, #000000 on solid pill = 8.00:1) */
  info: '#4DA3FF',
  onFill: {
    cta: '#FFFFFF',
    ctaHover: '#FFFFFF',
    destructiveBg: '#FFFFFF',
    connected: '#000000',
    dj: '#000000',
    info: '#000000',
  },
} as const);

export const PMUSIC_DESIGN_TOKENS = deepFreeze({
  surfaces: {
    oled: '#000000',
    base: '#0A0A0D',
    card: '#121216',
    cardHover: '#1A1A20',
    elevated: '#1C1C22',
    elevatedHi: '#24242C',
  },

  glass: {
    regular: {
      background: 'rgba(20, 20, 26, 0.74)',
      bg: 'rgba(20, 20, 26, 0.74)',
      rgba: { r: 20, g: 20, b: 26, a: 0.74 },
      blurPx: 24,
      saturation: 1.4,
      saturate: 1.4,
      border: 'rgba(255, 255, 255, 0.12)',
      specularTop: 'inset 0 1px 0 rgba(255, 255, 255, 0.14)',
    },
    clear: {
      background: 'rgba(22, 22, 28, 0.30)',
      bg: 'rgba(22, 22, 28, 0.30)',
      rgba: { r: 22, g: 22, b: 28, a: 0.30 },
      blurPx: 14,
      saturation: 1.3,
      saturate: 1.3,
      brightScrim: 'rgba(0, 0, 0, 0.35)',
      brightScrimAlpha: 0.35,
    },
    /** Apple HIG published Liquid Glass constant: 35% dark dimming scrim over bright media */
    brightScrim: 'rgba(0, 0, 0, 0.35)',
    brightScrimOpacity: 0.35,
    brightScrimAlpha: 0.35,
    maxSimultaneousRegions: 4,
    recommendedMobileRegions: 3,
    reducedTransparency: {
      regularBg: '#18181E',
      clearBg: '#1E1E26',
      blurPx: 0,
      border: 'rgba(255, 255, 255, 0.22)',
    },
    highContrast: {
      regularBg: 'rgba(20, 20, 26, 0.94)',
      regularRgba: { r: 20, g: 20, b: 26, a: 0.94 },
      border: 'rgba(255, 255, 255, 0.38)',
      separator: 'rgba(255, 255, 255, 0.28)',
      textSecondary: '#E5E5EA',
      textTertiary: '#C7C7D1',
    },
    constraints: {
      maxSimultaneousSurfacesDesktop: 4,
      maxSimultaneousSurfacesMobile: 3,
      allowGlassOnGlassStacking: false,
      allowGlassOnContentLayer: false,
      ambientMaxLightnessPct: 32,
      /** Luminance ceiling alongside HSL L<=32% so bright yellows never break Clear Glass contrast */
      ambientMaxRelativeLuminance: 0.08,
      dynamicAccentLightnessRangePct: [60, 72] as const,
    },
  },

  text: {
    primary: '#FFFFFF',
    secondary: '#B3B3BE',
    tertiary: '#8E8E9B',
    /** Decorative / disabled icons ONLY — NEVER readable copy, NEVER on thin/clear glass */
    quaternary: 'rgba(235, 235, 245, 0.28)',
    separator: 'rgba(255, 255, 255, 0.10)',
    separatorOpaque: '#2C2C34',
  },

  separators: {
    subtle: 'rgba(255, 255, 255, 0.10)',
    opaque: '#2C2C34',
  },

  brand: {
    /** Icons, links, active tab on dark/glass surfaces ONLY (NEVER use with #FFFFFF text: 3.22:1!) */
    accentText: '#FF4D6A',
    /** Prominent CTA solid fill with #FFFFFF text (5.76:1) */
    accentCta: '#C81935',
    /** Prominent CTA hover fill with #FFFFFF text (5.00:1) */
    accentCtaHover: '#D91E3B',
    dynamicAccentFallback: 'var(--pm-accent-text)',
    maxTintedPrimaryActionsPerView: 2,
  },

  semantic: SEMANTIC_TOKENS,
  status: SEMANTIC_TOKENS,

  ambient: {
    stop1: 'rgba(140, 26, 52, 0.38)',
    stop2: 'rgba(48, 28, 86, 0.32)',
    stop3: 'rgba(16, 48, 72, 0.26)',
    mesh1: 'rgba(140, 26, 52, 0.38)',
    mesh2: 'rgba(48, 28, 86, 0.32)',
    mesh3: 'rgba(16, 48, 72, 0.26)',
    maxMeshLightnessPct: 32,
    dynamicAccentLightnessRangePct: [60, 72] as const,
  },

  radii: {
    pillPx: 9999,
    sheetMobilePx: 28,
    dialogPx: 20,
    artworkLgPx: 18,
    cardPx: 14,
    artMdPx: 10,
    artSmPx: 8,
    controlPx: 10,
    /** Concentric corner rule: R_inner = max(4, R_outer - padding) */
    concentricMinInnerPx: 4,
    pill: 9999,
    sheetMobile: 28,
    dialog: 20,
    artworkLg: 18,
    card: 14,
    artMd: 10,
    artSm: 8,
    control: 10,
  },

  layout: {
    targetMobilePx: 44,
    targetMobileTransportPx: 48,
    targetMobileMinFloorPx: 28,
    targetMobileMinPx: 28,
    targetDesktopPx: 28,
    targetDesktopMinFloorPx: 20,
    targetDesktopMinPx: 20,
    marginMobilePx: 16,
    marginDesktopPx: 28,
    sidebarWidthPx: 248,
    sidebarCollapsedWidthPx: 72,
    desktopPlayerHeightPx: 80,
    mobileMiniPlayerGapPx: 8,
    mobileBreakpointPx: 768,
    sidebarCollapseBreakpointPx: 1024,
    breakpoints: {
      mobileMaxPx: 767,
      desktopMinPx: 768,
      sidebarAutoCollapseBelowPx: 1024,
    },
    mobileTabs: ['Inicio', 'Buscar', 'Biblioteca'] as const,
    searchScopeTabs: ['Todo', 'Canciones', 'Artistas', 'Álbumes', 'Playlists'] as const,
  },

  typography: {
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Segoe UI Variable", "Roboto", system-ui, sans-serif',
    numericFontVariant: 'tabular-nums',
    allowedWeights: [400, 500, 600, 700] as readonly TypographyAllowedWeight[],
    minWeight: 400 as TypographyAllowedWeight,
    minFontSizePx: {
      mobile: 11,
      desktop: 10,
    },
    minFontSizeMobilePx: 11,
    minFontSizeDesktopPx: 10,
    defaultBodySizePx: {
      mobile: 17,
      desktop: 13,
    },
    scale: {
      displayLyric: {
        cssName: 'display-lyric',
        mobile: { sizePx: 28, lineHeightPx: 35, letterSpacing: '-0.015em', tracking: '-0.015em' },
        desktop: { sizePx: 36, lineHeightPx: 44, letterSpacing: '-0.02em', tracking: '-0.02em' },
        weight: 700,
        weights: [700],
        usage: 'Synced Lyrics active/inactive lines',
      },
      largeTitle: {
        cssName: 'large-title',
        mobile: { sizePx: 34, lineHeightPx: 41, letterSpacing: '0.40px', tracking: '0.40px' },
        desktop: { sizePx: 26, lineHeightPx: 32, letterSpacing: '0.22px', tracking: '0.22px' },
        weight: 700,
        weights: [700],
        usage: 'Screen headers (Inicio, Buscar, Biblioteca)',
      },
      title1: {
        cssName: 'title-1',
        mobile: { sizePx: 28, lineHeightPx: 34, letterSpacing: '0.38px', tracking: '0.38px' },
        desktop: { sizePx: 22, lineHeightPx: 26, letterSpacing: '-0.26px', tracking: '-0.26px' },
        weight: 700,
        weights: [700],
        usage: 'Now Playing track title, Artist/Playlist hero',
      },
      title2: {
        cssName: 'title-2',
        mobile: { sizePx: 22, lineHeightPx: 28, letterSpacing: '-0.26px', tracking: '-0.26px' },
        desktop: { sizePx: 18, lineHeightPx: 23, letterSpacing: '-0.44px', tracking: '-0.44px' },
        weight: 700,
        weights: [700],
        usage: 'Section headers (Mixes para ti, Mejor resultado)',
      },
      title3: {
        cssName: 'title-3',
        mobile: { sizePx: 20, lineHeightPx: 25, letterSpacing: '-0.45px', tracking: '-0.45px' },
        desktop: { sizePx: 15, lineHeightPx: 20, letterSpacing: '-0.23px', tracking: '-0.23px' },
        weight: 600,
        weights: [600],
        usage: 'Modal/Sheet titles (Dispositivos, Sesión DJ)',
      },
      headline: {
        cssName: 'headline',
        mobile: { sizePx: 17, lineHeightPx: 22, letterSpacing: '-0.43px', tracking: '-0.43px' },
        desktop: { sizePx: 14, lineHeightPx: 18, letterSpacing: '-0.15px', tracking: '-0.15px' },
        weight: 600,
        weights: [600],
        usage: 'Track titles in rows, Mix card titles',
      },
      body: {
        cssName: 'body',
        mobile: { sizePx: 17, lineHeightPx: 22, letterSpacing: '-0.43px', tracking: '-0.43px' },
        desktop: { sizePx: 13, lineHeightPx: 18, letterSpacing: '-0.08px', tracking: '-0.08px' },
        weight: 400,
        weights: [400],
        usage: 'Default body copy, settings descriptions',
      },
      subhead: {
        cssName: 'subhead',
        mobile: { sizePx: 15, lineHeightPx: 20, letterSpacing: '-0.23px', tracking: '-0.23px' },
        desktop: { sizePx: 13, lineHeightPx: 17, letterSpacing: '-0.08px', tracking: '-0.08px' },
        weight: 400,
        weights: [400, 500],
        usage: 'Artist subtitles, secondary card descriptions',
      },
      footnote: {
        cssName: 'footnote',
        mobile: { sizePx: 13, lineHeightPx: 18, letterSpacing: '-0.08px', tracking: '-0.08px' },
        desktop: { sizePx: 12, lineHeightPx: 16, letterSpacing: '0px', tracking: '0px' },
        weight: 400,
        weights: [400, 500],
        usage: 'Track durations, timestamps, badges',
      },
      caption: {
        cssName: 'caption',
        mobile: { sizePx: 11, lineHeightPx: 14, letterSpacing: '0.06px', tracking: '0.06px' },
        desktop: { sizePx: 11, lineHeightPx: 14, letterSpacing: '0.06px', tracking: '0.06px' },
        weight: 500,
        weights: [500, 600],
        usage: 'Tab bar labels, BPM/EQ tick labels, status pills',
      },
    } as Record<TypographyScaleKey, TypographyScaleToken>,
  },

  motion: {
    pmSpringTap: {
      default: { type: 'spring' as const, stiffness: 450, damping: 32, mass: 0.7 },
      spring: { type: 'spring' as const, stiffness: 450, damping: 32, mass: 0.7 },
      reducedMotion: { duration: 0.01 },
      reduced: { duration: 0.01 },
      pressScale: 0.96,
    },
    pmSpringSheet: {
      default: { type: 'spring' as const, stiffness: 320, damping: 34, mass: 0.95 },
      spring: { type: 'spring' as const, stiffness: 320, damping: 34, mass: 0.95 },
      reducedMotion: { duration: 0.16, ease: 'easeOut' as const },
      reduced: { duration: 0.16, ease: 'easeOut' as const },
      cancellable: true,
    },
    pmSpringLyrics: {
      default: { type: 'spring' as const, stiffness: 260, damping: 30 },
      spring: { type: 'spring' as const, stiffness: 260, damping: 30 },
      reducedMotion: { duration: 0.15 },
      reduced: { duration: 0.15 },
      activeScale: 1.02,
      inactiveOpacity: 0.38,
      inactiveBlurPx: 2,
      reducedMotionInactiveOpacity: 0.45,
      reducedMotionInactiveBlurPx: 0,
    },
    pmAmbientMesh: {
      default: {
        durationSec: 24,
        easing: 'ease-in-out' as const,
        iterationCount: 'infinite' as const,
        gpuTransformOnly: true,
      },
      durationSec: 24,
      reducedMotion: {
        animation: 'none' as const,
      },
      reduced: 'none' as const,
    },
  },

  accessibility: {
    wcagAaNormalMinRatio: 4.5,
    wcagAaLargeMinRatio: 3.0,
    wcagAaaNormalMinRatio: 7.0,
    reducedTransparency: {
      glassRegularBg: '#18181E',
      glassClearBg: '#1E1E26',
      glassRegularBlurPx: 0,
      glassClearBlurPx: 0,
      glassBorder: 'rgba(255, 255, 255, 0.22)',
      cssVariables: {
        '--pm-glass-regular-bg': '#18181E',
        '--pm-glass-clear-bg': '#1E1E26',
        '--pm-glass-regular-blur': '0px',
        '--pm-glass-clear-blur': '0px',
        '--pm-glass-border': 'rgba(255, 255, 255, 0.22)',
      },
    },
    moreContrast: {
      textSecondary: '#E5E5EA',
      textTertiary: '#C7C7D1',
      glassRegularBg: 'rgba(20, 20, 26, 0.94)',
      glassBorder: 'rgba(255, 255, 255, 0.38)',
      separator: 'rgba(255, 255, 255, 0.28)',
      focusRing: '2px solid #FFFFFF',
      focusRingOffsetPx: 2,
      cssVariables: {
        '--pm-text-secondary': '#E5E5EA',
        '--pm-text-tertiary': '#C7C7D1',
        '--pm-glass-regular-bg': 'rgba(20, 20, 26, 0.94)',
        '--pm-glass-border': 'rgba(255, 255, 255, 0.38)',
        '--pm-separator': 'rgba(255, 255, 255, 0.28)',
      },
    },
  },

  cssVariables: PMUSIC_CSS_VARIABLES,
} as const);

export type PMusicDesignTokens = typeof PMUSIC_DESIGN_TOKENS;
export type PmusicDesignTokens = PMusicDesignTokens;

/** Backward-compatible alias referenced in PROJECT.md L207 & SCOPE.md L93 */
export const PMUSIC_TOKENS: PMusicDesignTokens = PMUSIC_DESIGN_TOKENS;
