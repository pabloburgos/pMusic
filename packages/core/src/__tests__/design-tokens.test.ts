import { describe, expect, it } from 'vitest';
import {
  PMUSIC_CSS_VARIABLES,
  PMUSIC_DESIGN_TOKENS,
  PMUSIC_TOKENS,
  WCAG_AAA_NORMAL_RATIO,
  WCAG_AA_NORMAL_RATIO,
  compositeOverHex,
  meetsWcagAA,
  wcagContrastRatio,
} from '../index.ts';

describe('PMUSIC_DESIGN_TOKENS & WCAG 2.1 Verification Matrix', () => {
  it('enforces referential alias equality and deep runtime immutability', () => {
    expect(PMUSIC_TOKENS).toBe(PMUSIC_DESIGN_TOKENS);
    expect(PMUSIC_DESIGN_TOKENS.cssVariables).toBe(PMUSIC_CSS_VARIABLES);
    expect(PMUSIC_DESIGN_TOKENS.semantic).toBe(PMUSIC_DESIGN_TOKENS.status);
    expect(Object.isFrozen(PMUSIC_DESIGN_TOKENS)).toBe(true);
    expect(Object.isFrozen(PMUSIC_DESIGN_TOKENS.surfaces)).toBe(true);
    expect(Object.isFrozen(PMUSIC_DESIGN_TOKENS.glass.regular)).toBe(true);
    expect(Object.isFrozen(PMUSIC_DESIGN_TOKENS.typography.scale.body)).toBe(true);
    expect(Object.isFrozen(PMUSIC_CSS_VARIABLES)).toBe(true);
  });

  it('proves every readable foreground token meets WCAG AA (>= 4.5:1) across all 8 opaque dark surfaces', () => {
    const darkSurfaces = [
      PMUSIC_DESIGN_TOKENS.surfaces.oled,
      PMUSIC_DESIGN_TOKENS.surfaces.base,
      PMUSIC_DESIGN_TOKENS.surfaces.card,
      PMUSIC_DESIGN_TOKENS.surfaces.cardHover,
      PMUSIC_DESIGN_TOKENS.surfaces.elevated,
      PMUSIC_DESIGN_TOKENS.surfaces.elevatedHi,
      PMUSIC_DESIGN_TOKENS.accessibility.reducedTransparency.glassRegularBg,
      PMUSIC_DESIGN_TOKENS.accessibility.reducedTransparency.glassClearBg,
    ];

    const readableForegrounds = [
      PMUSIC_DESIGN_TOKENS.text.primary,
      PMUSIC_DESIGN_TOKENS.text.secondary,
      PMUSIC_DESIGN_TOKENS.text.tertiary,
      PMUSIC_DESIGN_TOKENS.accessibility.moreContrast.textSecondary,
      PMUSIC_DESIGN_TOKENS.accessibility.moreContrast.textTertiary,
      PMUSIC_DESIGN_TOKENS.brand.accentText,
      PMUSIC_DESIGN_TOKENS.semantic.connected,
      PMUSIC_DESIGN_TOKENS.semantic.dj,
      PMUSIC_DESIGN_TOKENS.semantic.destructive,
      PMUSIC_DESIGN_TOKENS.semantic.info,
    ];

    for (const surface of darkSurfaces) {
      for (const fg of readableForegrounds) {
        const ratio = wcagContrastRatio(fg, surface);
        expect(ratio).toBeGreaterThanOrEqual(WCAG_AA_NORMAL_RATIO);
        expect(meetsWcagAA(fg, surface)).toBe(true);
      }
      // Primary & secondary text achieve WCAG AAA (>= 7.0:1) on every dark surface
      expect(wcagContrastRatio(PMUSIC_DESIGN_TOKENS.text.primary, surface)).toBeGreaterThanOrEqual(
        WCAG_AAA_NORMAL_RATIO
      );
      expect(
        wcagContrastRatio(PMUSIC_DESIGN_TOKENS.text.secondary, surface)
      ).toBeGreaterThanOrEqual(WCAG_AAA_NORMAL_RATIO);
    }
  });

  it('proves every readable foreground token meets WCAG AA (>= 4.5:1) over alpha-composited Liquid Glass', () => {
    const underlyingBackdrops = [
      PMUSIC_DESIGN_TOKENS.surfaces.oled,
      PMUSIC_DESIGN_TOKENS.surfaces.base,
      PMUSIC_DESIGN_TOKENS.surfaces.card,
      PMUSIC_DESIGN_TOKENS.surfaces.elevated,
      PMUSIC_DESIGN_TOKENS.surfaces.elevatedHi,
      PMUSIC_DESIGN_TOKENS.accessibility.reducedTransparency.glassClearBg,
    ];

    const readableForegrounds = [
      PMUSIC_DESIGN_TOKENS.text.primary,
      PMUSIC_DESIGN_TOKENS.text.secondary,
      PMUSIC_DESIGN_TOKENS.text.tertiary,
      PMUSIC_DESIGN_TOKENS.accessibility.moreContrast.textSecondary,
      PMUSIC_DESIGN_TOKENS.accessibility.moreContrast.textTertiary,
      PMUSIC_DESIGN_TOKENS.brand.accentText,
      PMUSIC_DESIGN_TOKENS.semantic.connected,
      PMUSIC_DESIGN_TOKENS.semantic.dj,
      PMUSIC_DESIGN_TOKENS.semantic.destructive,
      PMUSIC_DESIGN_TOKENS.semantic.info,
    ];

    for (const backdrop of underlyingBackdrops) {
      const compositedRegularGlass = compositeOverHex(
        PMUSIC_DESIGN_TOKENS.glass.regular.background,
        backdrop
      );
      const compositedHighContrastGlass = compositeOverHex(
        PMUSIC_DESIGN_TOKENS.accessibility.moreContrast.glassRegularBg,
        backdrop
      );

      for (const fg of readableForegrounds) {
        expect(wcagContrastRatio(fg, compositedRegularGlass)).toBeGreaterThanOrEqual(
          WCAG_AA_NORMAL_RATIO
        );
        expect(wcagContrastRatio(fg, compositedHighContrastGlass)).toBeGreaterThanOrEqual(
          WCAG_AA_NORMAL_RATIO
        );
      }
    }
  });

  it('verifies solid CTA buttons, status pills, and 35% bright-media scrim protection', () => {
    const { brand, semantic, glass, text, accessibility } = PMUSIC_DESIGN_TOKENS;

    // White text on solid CTA / destructive buttons >= 4.5:1
    expect(wcagContrastRatio('#FFFFFF', brand.accentCta)).toBeGreaterThanOrEqual(5.7);
    expect(wcagContrastRatio('#FFFFFF', brand.accentCtaHover)).toBeGreaterThanOrEqual(5.0);
    expect(wcagContrastRatio('#FFFFFF', semantic.destructiveBg)).toBeGreaterThanOrEqual(5.3);

    // Black text on solid status pills >= 7.0:1 (AAA)
    expect(wcagContrastRatio('#000000', semantic.connected)).toBeGreaterThanOrEqual(10.0);
    expect(wcagContrastRatio('#000000', semantic.dj)).toBeGreaterThanOrEqual(10.0);
    expect(wcagContrastRatio('#000000', semantic.info)).toBeGreaterThanOrEqual(7.9);

    // Apple HIG 35% bright-media scrim
    expect(glass.brightScrimOpacity).toBe(0.35);
    expect(glass.clear.brightScrimAlpha).toBe(0.35);
    expect(glass.brightScrim).toBe('rgba(0, 0, 0, 0.35)');

    const regularOverScrimmedWhite = compositeOverHex(
      glass.regular.background,
      compositeOverHex(glass.brightScrim, '#FFFFFF')
    );
    expect(meetsWcagAA(text.primary, regularOverScrimmedWhite)).toBe(true);
    expect(meetsWcagAA(text.secondary, regularOverScrimmedWhite)).toBe(true);

    const clearOverClampedAmbient = compositeOverHex(
      glass.clear.background,
      compositeOverHex(glass.brightScrim, '#525252')
    );
    expect(meetsWcagAA(text.primary, clearOverClampedAmbient)).toBe(true);
    expect(meetsWcagAA(text.secondary, clearOverClampedAmbient)).toBe(true);

    // High contrast labels strictly improve contrast vs default secondary/tertiary
    expect(
      wcagContrastRatio(accessibility.moreContrast.textSecondary, '#000000')
    ).toBeGreaterThan(wcagContrastRatio(text.secondary, '#000000'));
    expect(
      wcagContrastRatio(accessibility.moreContrast.textTertiary, '#000000')
    ).toBeGreaterThan(wcagContrastRatio(text.tertiary, '#000000'));
  });

  it('verifies Apple HIG typography floors, touch targets, concentric radii, and motion fallbacks', () => {
    const { typography, layout, radii, motion, accessibility } = PMUSIC_DESIGN_TOKENS;

    const scaleKeys = Object.keys(typography.scale);
    expect(scaleKeys).toEqual([
      'displayLyric',
      'largeTitle',
      'title1',
      'title2',
      'title3',
      'headline',
      'body',
      'subhead',
      'footnote',
      'caption',
    ]);

    for (const token of Object.values(typography.scale)) {
      expect(token.mobile.sizePx).toBeGreaterThanOrEqual(11);
      expect(token.desktop.sizePx).toBeGreaterThanOrEqual(10);
      expect(token.mobile.lineHeightPx).toBeGreaterThan(token.mobile.sizePx);
      expect(token.desktop.lineHeightPx).toBeGreaterThan(token.desktop.sizePx);
      expect(token.weight).toBeGreaterThanOrEqual(400);
      for (const w of token.weights) {
        expect([400, 500, 600, 700]).toContain(w);
      }
    }

    expect(typography.scale.body.mobile.sizePx).toBe(17);
    expect(typography.scale.body.desktop.sizePx).toBe(13);
    expect(typography.numericFontVariant).toBe('tabular-nums');

    expect(layout.targetMobilePx).toBeGreaterThanOrEqual(44);
    expect(layout.targetMobileMinFloorPx).toBe(28);
    expect(layout.targetDesktopPx).toBeGreaterThanOrEqual(28);
    expect(layout.targetDesktopMinFloorPx).toBe(20);
    expect(layout.mobileTabs).toEqual(['Inicio', 'Buscar', 'Biblioteca']);
    expect(layout.searchScopeTabs).toEqual([
      'Todo',
      'Canciones',
      'Artistas',
      'Álbumes',
      'Playlists',
    ]);
    expect(layout.sidebarWidthPx).toBe(248);
    expect(layout.sidebarCollapsedWidthPx).toBe(72);
    expect(layout.desktopPlayerHeightPx).toBe(80);

    expect(radii.concentricMinInnerPx).toBe(4);
    expect(radii.sheetMobilePx).toBeGreaterThan(radii.dialogPx);
    expect(radii.dialogPx).toBeGreaterThan(radii.artworkLgPx);
    expect(radii.artworkLgPx).toBeGreaterThan(radii.cardPx);
    expect(radii.cardPx).toBeGreaterThan(radii.artMdPx);
    expect(radii.artMdPx).toBeGreaterThan(radii.artSmPx);

    expect(motion.pmAmbientMesh.reducedMotion.animation).toBe('none');
    expect(motion.pmSpringLyrics.reducedMotionInactiveBlurPx).toBe(0);
    expect(accessibility.reducedTransparency.glassRegularBlurPx).toBe(0);
    expect(accessibility.reducedTransparency.glassClearBlurPx).toBe(0);
  });
});
