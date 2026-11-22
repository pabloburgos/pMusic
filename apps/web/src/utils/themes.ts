import { setDesktopTitleBarOverlay } from '../platform/web-bridge.ts';

export type PMusicThemeId =
  | 'obsidian'
  | 'nordic-light'
  | 'vinyl-amber'
  | 'cyber-indigo'
  | 'emerald-forest'
  | 'crimson-rose';

export type PMusicPlayerBarStyle = 'classic-center' | 'ambient-dock';

export type PMusicAccentPresetId =
  | 'auto'
  | 'white'
  | 'amber'
  | 'violet'
  | 'emerald'
  | 'rose'
  | 'cyan';

export interface PMusicAccentPreset {
  id: PMusicAccentPresetId;
  label: string;
  swatchHex: string;
  darkPrimary: string;
  darkFg: string;
  lightPrimary: string;
  lightFg: string;
}

export const PMUSIC_ACCENT_PRESETS: readonly PMusicAccentPreset[] = [
  {
    id: 'auto',
    label: 'Del tema',
    swatchHex: 'linear-gradient(135deg, #FFFFFF 0%, #C084FC 50%, #F59E0B 100%)',
    darkPrimary: '',
    darkFg: '',
    lightPrimary: '',
    lightFg: '',
  },
  {
    id: 'white',
    label: 'Blanco / Negro',
    swatchHex: '#F5F5F7',
    darkPrimary: '#FFFFFF',
    darkFg: '#070709',
    lightPrimary: '#141418',
    lightFg: '#FFFFFF',
  },
  {
    id: 'amber',
    label: 'Ámbar',
    swatchHex: '#F59E0B',
    darkPrimary: '#F59E0B',
    darkFg: '#140C02',
    lightPrimary: '#D97706',
    lightFg: '#FFFFFF',
  },
  {
    id: 'violet',
    label: 'Violeta',
    swatchHex: '#C084FC',
    darkPrimary: '#C084FC',
    darkFg: '#0E0717',
    lightPrimary: '#7C3AED',
    lightFg: '#FFFFFF',
  },
  {
    id: 'emerald',
    label: 'Esmeralda',
    swatchHex: '#34D399',
    darkPrimary: '#34D399',
    darkFg: '#041F13',
    lightPrimary: '#059669',
    lightFg: '#FFFFFF',
  },
  {
    id: 'rose',
    label: 'Rosa',
    swatchHex: '#FB7185',
    darkPrimary: '#FB7185',
    darkFg: '#1A060B',
    lightPrimary: '#E11D48',
    lightFg: '#FFFFFF',
  },
  {
    id: 'cyan',
    label: 'Cian',
    swatchHex: '#38BDF8',
    darkPrimary: '#38BDF8',
    darkFg: '#041725',
    lightPrimary: '#0284C7',
    lightFg: '#FFFFFF',
  },
] as const;

export function applyAccentOverride(
  accentId: PMusicAccentPresetId,
  themeId: PMusicThemeId
): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (accentId === 'auto') {
    root.style.removeProperty('--pm-accent-primary');
    root.style.removeProperty('--pm-accent-fg');
    return;
  }
  const preset = PMUSIC_ACCENT_PRESETS.find((p) => p.id === accentId);
  if (!preset) return;
  const theme = getThemeDefinition(themeId);
  root.style.setProperty(
    '--pm-accent-primary',
    theme.isLight ? preset.lightPrimary : preset.darkPrimary
  );
  root.style.setProperty(
    '--pm-accent-fg',
    theme.isLight ? preset.lightFg : preset.darkFg
  );
}

export interface PMusicThemeDefinition {
  id: PMusicThemeId;
  name: string;
  tagline: string;
  isLight: boolean;
  fontLabel: string;
  titleBarColor: string;
  titleBarSymbolColor: string;
  swatches: readonly [string, string, string, string];
}

export const PMUSIC_THEMES: readonly PMusicThemeDefinition[] = [
  {
    id: 'obsidian',
    name: 'Obsidian OLED',
    tagline: 'Negro puro OLED con vidrio líquido neutro y contraste nítido',
    isLight: false,
    fontLabel: 'Bricolage + Jakarta',
    titleBarColor: '#070709',
    titleBarSymbolColor: '#B4B4BE',
    swatches: ['#070709', '#121217', '#FFFFFF', '#C084FC'],
  },
  {
    id: 'nordic-light',
    name: 'Marfil Editorial',
    tagline: 'Modo claro cálido tipo revista hi-fi con titulares Serif y tinta oscura',
    isLight: true,
    fontLabel: 'Instrument Serif + Jakarta',
    titleBarColor: '#F5F2EB',
    titleBarSymbolColor: '#2B2B33',
    swatches: ['#F5F2EB', '#FFFFFF', '#141418', '#D97706'],
  },
  {
    id: 'vinyl-amber',
    name: 'Vinilo Analógico',
    tagline: 'Madera oscura de amplificador, válvulas ámbar cálido y serifa clásica',
    isLight: false,
    fontLabel: 'Instrument Serif + Jakarta',
    titleBarColor: '#120C08',
    titleBarSymbolColor: '#E5CFAF',
    swatches: ['#120C08', '#1D140E', '#F59E0B', '#FDE68A'],
  },
  {
    id: 'cyber-indigo',
    name: 'Neón Nocturno',
    tagline: 'Medianoche índigo eléctrico con acentos cian y atmósfera synthwave',
    isLight: false,
    fontLabel: 'Bricolage + Mono',
    titleBarColor: '#070919',
    titleBarSymbolColor: '#9ED8FF',
    swatches: ['#070919', '#101533', '#38BDF8', '#A855F7'],
  },
  {
    id: 'emerald-forest',
    name: 'Bosque Hi-Res',
    tagline: 'Tonos pino de estudio masterizado con vidrio jade y acento esmeralda',
    isLight: false,
    fontLabel: 'Bricolage + Jakarta',
    titleBarColor: '#05100B',
    titleBarSymbolColor: '#A7E8CC',
    swatches: ['#05100B', '#0C1D15', '#34D399', '#D9F99D'],
  },
  {
    id: 'crimson-rose',
    name: 'Terciopelo Carmesí',
    tagline: 'Burdeos profundo de club privado con detalles coral y rojo rubí',
    isLight: false,
    fontLabel: 'Bricolage + Jakarta',
    titleBarColor: '#13070B',
    titleBarSymbolColor: '#F5B8C4',
    swatches: ['#13070B', '#210D14', '#FB7185', '#FDA4AF'],
  },
] as const;

export function getThemeDefinition(id: PMusicThemeId): PMusicThemeDefinition {
  return PMUSIC_THEMES.find((t) => t.id === id) ?? PMUSIC_THEMES[0]!;
}

export function applyPMusicTheme(themeId: PMusicThemeId): void {
  if (typeof document === 'undefined') return;
  const def = getThemeDefinition(themeId);
  const root = document.documentElement;
  root.dataset.theme = def.id;
  root.classList.toggle('dark', !def.isLight);
  root.classList.toggle('light', def.isLight);
  root.style.colorScheme = def.isLight ? 'light' : 'dark';

  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) {
    metaTheme.setAttribute('content', def.titleBarColor);
  }

  void setDesktopTitleBarOverlay({
    color: def.titleBarColor,
    symbolColor: def.titleBarSymbolColor,
    height: 48,
  });
}
