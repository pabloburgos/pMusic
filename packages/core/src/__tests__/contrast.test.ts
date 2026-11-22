import { describe, expect, it } from 'vitest';
import {
  WCAG_AAA_NORMAL_RATIO,
  WCAG_AA_LARGE_RATIO,
  WCAG_AA_NORMAL_RATIO,
  WCAG_SRGB_LINEAR_THRESHOLD,
  compositeOverHex,
  meetsWcagAA,
  parseHexColor,
  parseRgbaColor,
  relativeLuminance,
  wcagContrastRatio,
} from '../index.ts';

describe('WCAG 2.1 Color Parsing & Contrast Utilities', () => {
  it('exports official W3C WCAG 2.1 threshold and ratio constants', () => {
    expect(WCAG_SRGB_LINEAR_THRESHOLD).toBe(0.04045);
    expect(WCAG_AA_NORMAL_RATIO).toBe(4.5);
    expect(WCAG_AA_LARGE_RATIO).toBe(3.0);
    expect(WCAG_AAA_NORMAL_RATIO).toBe(7.0);
  });

  describe('parseHexColor', () => {
    it('parses 6-digit and 3-digit hex strings with surrounding whitespace', () => {
      expect(parseHexColor('#000000')).toEqual({ r: 0, g: 0, b: 0 });
      expect(parseHexColor('#FFFFFF')).toEqual({ r: 255, g: 255, b: 255 });
      expect(parseHexColor('#FF4D6A')).toEqual({ r: 255, g: 77, b: 106 });
      expect(parseHexColor('#121216')).toEqual({ r: 18, g: 18, b: 22 });
      expect(parseHexColor('  #0aF  ')).toEqual({ r: 0, g: 170, b: 255 });
      expect(parseHexColor('#fff')).toEqual({ r: 255, g: 255, b: 255 });
    });

    it('rejects invalid hex inputs with RangeError', () => {
      const invalidInputs = [
        'FFFFFF',
        '',
        '   ',
        '#GGGGGG',
        '#12',
        '#1234',
        '#12345',
        '#1234567',
        '#12345678',
        'rgb(0, 0, 0)',
      ];
      for (const bad of invalidInputs) {
        expect(() => parseHexColor(bad)).toThrow(RangeError);
      }
    });
  });

  describe('parseRgbaColor', () => {
    it('parses comma and CSS Color 4 slash syntax with decimal or percentage alpha', () => {
      expect(parseRgbaColor('rgba(20, 20, 26, 0.74)')).toEqual({ r: 20, g: 20, b: 26, a: 0.74 });
      expect(parseRgbaColor('rgb(20, 20, 26)')).toEqual({ r: 20, g: 20, b: 26, a: 1 });
      expect(parseRgbaColor('rgba(0, 0, 0, .35)')).toEqual({ r: 0, g: 0, b: 0, a: 0.35 });
      expect(parseRgbaColor('rgba(0, 0, 0, 35%)')).toEqual({ r: 0, g: 0, b: 0, a: 0.35 });
      expect(parseRgbaColor('rgb(20 20 26 / 0.74)')).toEqual({ r: 20, g: 20, b: 26, a: 0.74 });
      expect(parseRgbaColor('rgba(20 20 26 / 74%)')).toEqual({ r: 20, g: 20, b: 26, a: 0.74 });
      expect(parseRgbaColor('RGBA(255, 255, 255, 0.12)')).toEqual({
        r: 255,
        g: 255,
        b: 255,
        a: 0.12,
      });
    });

    it('rejects malformed or out-of-range rgb/rgba inputs with RangeError', () => {
      const invalidInputs = [
        '#000000',
        'rgba(20, 20, 26)',
        'rgb(20, 20, 26, 0.5)',
        'rgba(20, 20 / 26, 0.5)',
        'rgb(-1, 0, 0)',
        'rgb(256, 0, 0)',
        'rgba(0, 0, 0, -0.1)',
        'rgba(0, 0, 0, 1.2)',
        'rgba(0, 0, 0, 105%)',
        'rgb(20px, 20, 26)',
        'rgb(20, 20, 26,)',
        'rgb(20, 20, 26) extra',
      ];
      for (const bad of invalidInputs) {
        expect(() => parseRgbaColor(bad)).toThrow(RangeError);
      }
    });
  });

  describe('compositeOverHex', () => {
    it('composites Liquid Glass and scrim layers accurately over dark and bright backdrops', () => {
      expect(compositeOverHex('#FF4D6A', '#000000')).toBe('#FF4D6A');
      expect(compositeOverHex('rgba(255, 77, 106, 0)', '#121216')).toBe('#121216');
      expect(compositeOverHex('rgba(20, 20, 26, 0.74)', '#000000')).toBe('#0F0F13');
      expect(compositeOverHex('rgba(20, 20, 26, 0.74)', '#121216')).toBe('#131319');
      expect(compositeOverHex('rgba(20, 20, 26, 0.74)', '#24242C')).toBe('#18181F');
      expect(compositeOverHex({ r: 20, g: 20, b: 26, a: 0.74 }, '#000000')).toBe('#0F0F13');

      // Chained compositing: Clear Glass (0.30) over 35% dark scrim over clamped ambient #525252
      const scrimmedAmbient = compositeOverHex('rgba(0, 0, 0, 0.35)', '#525252');
      expect(compositeOverHex('rgba(22, 22, 28, 0.30)', scrimmedAmbient)).toBe('#2C2C2E');

      // Regular Glass (0.74) over 35% dark scrim over #FFFFFF
      const scrimmedWhite = compositeOverHex('rgba(0, 0, 0, 0.35)', '#FFFFFF');
      expect(compositeOverHex('rgba(20, 20, 26, 0.74)', scrimmedWhite)).toBe('#3A3A3E');
    });

    it('rejects invalid foreground or background in compositeOverHex with RangeError', () => {
      expect(() => compositeOverHex('not-a-color', '#000000')).toThrow(RangeError);
      expect(() => compositeOverHex('rgba(20, 20, 26, 0.74)', 'rgba(0,0,0,0.5)')).toThrow(
        RangeError
      );
    });
  });

  describe('relativeLuminance', () => {
    it('computes exact W3C relative luminance including the 0.04045 piecewise boundary', () => {
      expect(relativeLuminance('#000000')).toBe(0);
      expect(relativeLuminance('#FFFFFF')).toBeCloseTo(1, 6);
      expect(relativeLuminance('#FF0000')).toBeCloseTo(0.2126, 4);
      expect(relativeLuminance('#00FF00')).toBeCloseTo(0.7152, 4);
      expect(relativeLuminance('#0000FF')).toBeCloseTo(0.0722, 4);

      // Piecewise threshold check: 10.3 / 255 = 0.040392 <= 0.04045 (linear branch)
      const sBelow = 10.3 / 255;
      expect(relativeLuminance({ r: 10.3, g: 10.3, b: 10.3 })).toBeCloseTo(sBelow / 12.92, 10);

      // 10.35 / 255 = 0.040588 > 0.04045 (gamma 2.4 branch)
      const sAbove = 10.35 / 255;
      expect(relativeLuminance({ r: 10.35, g: 10.35, b: 10.35 })).toBeCloseTo(
        ((sAbove + 0.055) / 1.055) ** 2.4,
        10
      );
    });

    it('throws RangeError for translucent or out-of-range inputs', () => {
      expect(() => relativeLuminance('rgba(0, 0, 0, 0.5)')).toThrow(RangeError);
      expect(() => relativeLuminance({ r: 256, g: 0, b: 0 })).toThrow(RangeError);
      expect(() => relativeLuminance({ r: Number.NaN, g: 0, b: 0 })).toThrow(RangeError);
    });
  });

  describe('wcagContrastRatio & meetsWcagAA', () => {
    it('computes symmetric contrast ratios and auto-composites translucent foregrounds', () => {
      expect(wcagContrastRatio('#FFFFFF', '#000000')).toBeCloseTo(21, 5);
      expect(wcagContrastRatio('#000000', '#000000')).toBeCloseTo(1, 5);
      expect(wcagContrastRatio('#B3B3BE', '#121216')).toBeCloseTo(
        wcagContrastRatio('#121216', '#B3B3BE'),
        10
      );
      expect(wcagContrastRatio('#FFFFFF', '#C81935')).toBeCloseTo(5.7592, 3);
      expect(wcagContrastRatio('#B3B3BE', '#000000')).toBeCloseTo(10.1083, 3);
      expect(wcagContrastRatio('rgba(235, 235, 245, 0.28)', '#000000')).toBeCloseTo(2.0898, 3);
    });

    it('throws RangeError when background is translucent', () => {
      expect(() => wcagContrastRatio('#FFFFFF', 'rgba(20, 20, 26, 0.74)')).toThrow(RangeError);
    });

    it('evaluates meetsWcagAA at exact normal (4.5:1) and largeText (3.0:1) boundaries', () => {
      // #767676 on #FFFFFF = 4.542:1 (PASS), #777777 on #FFFFFF = 4.478:1 (FAIL)
      expect(meetsWcagAA('#767676', '#FFFFFF')).toBe(true);
      expect(meetsWcagAA('#777777', '#FFFFFF')).toBe(false);

      // #949494 on #FFFFFF = 3.033:1 (FAIL normal, PASS largeText), #959595 = 2.995:1 (FAIL both)
      expect(meetsWcagAA('#949494', '#FFFFFF')).toBe(false);
      expect(meetsWcagAA('#949494', '#FFFFFF', { largeText: true })).toBe(true);
      expect(meetsWcagAA('#959595', '#FFFFFF', { largeText: true })).toBe(false);

      // #FFFFFF on #FF4D6A (accentText) = 3.22:1 -> fails normal text, passes large/icon
      expect(meetsWcagAA('#FFFFFF', '#FF4D6A')).toBe(false);
      expect(meetsWcagAA('#FFFFFF', '#FF4D6A', { largeText: true })).toBe(true);
    });
  });
});
