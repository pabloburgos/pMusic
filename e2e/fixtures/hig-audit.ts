/**
 * Automated Apple HIG 5-Lens (`dickwu/apple-design-skill`), 7-Point Liquid Glass,
 * WCAG 2.1 AA/AAA Contrast, Accessibility Media Query (CDP), and Zero-Liner
 * Clean-Room Audit Harness for pMusic E2E Verification.
 *
 * Dual-layer design:
 * 1. Pure Node-testable math & parsers (`parseCssColor`, `compositeOver`,
 *    `relativeLuminance`, `contrastRatio`, `isLargeText`, `requiredContrastRatio`,
 *    `parseBackdropBlurPx`, `hasActiveBackdropBlur`, `LINER_CLEANROOM_REGEX`).
 * 2. Browser DOM/CSS evaluators (`audit*`) and non-vacuous assertion wrappers
 *    (`assert*`) that enforce `checkedCount > 0` so blank screens can never pass.
 *
 * Strictly opaque-box: ZERO imports from `apps/**` or `packages/**`.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { expect, type CDPSession, type Page } from '@playwright/test';

export interface RGBA {
  r: number; // 0..255
  g: number; // 0..255
  b: number; // 0..255
  a: number; // 0..1
}

export interface ContrastViolation {
  selector: string;
  testId: string | null;
  textSample: string;
  fontSizePx: number;
  fontWeight: number;
  isLarge: boolean;
  fg: RGBA;
  bg: RGBA;
  ratio: number;
  requiredRatio: number;
}

export interface ContrastAuditOptions {
  /** Scope evaluation to a CSS selector (default: 'body'). */
  rootSelector?: string;
  /** Exclude selectors (e.g., intentionally dimmed inactive synced lyric lines). */
  excludeSelectors?: string[];
  /** Canvas background beneath transparent ancestors (default: OLED #000000). */
  canvasBg?: RGBA;
  /** Large text threshold mode: 'apple-hig-px' (>=18px or >=14px bold, default) or 'wcag-strict-pt'. */
  thresholdMode?: 'apple-hig-px' | 'wcag-strict-pt';
  /** Include elements scrolled outside current viewport (default: false). */
  includeOffscreen?: boolean;
  /** Minimum ratio override for normal text (default: 4.5). */
  normalMinRatio?: number;
  /** Minimum ratio override for large/bold text (default: 3.0). */
  largeMinRatio?: number;
}

export interface ContrastAuditReport {
  checkedCount: number;
  passCount: number;
  minRatio: number | null;
  violations: ContrastViolation[];
}

export interface TypographyViolation {
  selector: string;
  testId: string | null;
  textSample: string;
  fontSizePx: number;
  fontWeight: number;
  reason: 'below_size_floor' | 'thin_weight_on_small_text';
}

export interface TypographyAuditOptions {
  rootSelector?: string;
  excludeSelectors?: string[];
  mobileBreakpointPx?: number;
  mobileMinPx?: number;
  desktopMinPx?: number;
  thinWeightCeilingPx?: number;
}

export interface TypographyAuditReport {
  viewportWidth: number;
  isMobile: boolean;
  minFontPxFloor: number;
  checkedCount: number;
  minObservedFontPx: number | null;
  sizeViolations: TypographyViolation[];
  weightViolations: TypographyViolation[];
}

export interface HitTargetViolation {
  selector: string;
  testId: string | null;
  label: string;
  role: string;
  width: number;
  height: number;
  requiredPx: number;
  tier: 'primary' | 'floor';
}

export interface HitTargetAuditOptions {
  rootSelector?: string;
  excludeSelectors?: string[];
  primarySelector?: string;
  mobilePrimaryMinPx?: number;
  mobileFloorMinPx?: number;
  desktopDefaultMinPx?: number;
  desktopFloorMinPx?: number;
  tolerancePx?: number;
}

export interface HitTargetAuditReport {
  viewportWidth: number;
  isMobile: boolean;
  checkedCount: number;
  primaryViolations: HitTargetViolation[];
  floorViolations: HitTargetViolation[];
}

export interface GlassElementInfo {
  selector: string;
  testId: string | null;
  backdropFilter: string;
  blurPx: number;
  bgAlpha: number;
}

export interface LiquidGlassAuditOptions {
  maxSimultaneousGlass?: number;
  allowZeroGlass?: boolean;
  extraContentSelectors?: string[];
}

export interface LiquidGlassAuditReport {
  activeGlassCount: number;
  maxAllowed: number;
  activeGlassElements: GlassElementInfo[];
  contentCheckedCount: number;
  contentViolations: Array<{
    selector: string;
    testId: string | null;
    backdropFilter: string;
  }>;
  stackingViolations: Array<{ ancestor: string; descendant: string }>;
}

export interface BrightMediaScrimAuditOptions {
  sheetSelector?: string;
  minScrimAlpha?: number;
  excludeSelectors?: string[];
}

export interface BrightMediaScrimAuditReport {
  sheetVisible: boolean;
  scrimFound: boolean;
  scrimSelector: string | null;
  effectiveScrimAlpha: number;
  directArtworkOverlapViolations: ContrastViolation[];
  foregroundContrast: ContrastAuditReport;
}

export interface AccessibilityMediaOptions {
  reducedMotion?: 'reduce' | 'no-preference';
  reducedTransparency?: 'reduce' | 'no-preference';
  contrast?: 'more' | 'no-preference';
  forcedColors?: 'active' | 'none';
  colorScheme?: 'dark' | 'light' | 'no-preference';
}

export interface AccessibilityMediaController {
  cdp: CDPSession;
  restore: () => Promise<void>;
}

export interface ReducedMotionAuditReport {
  mediaQueryMatches: boolean;
  runningInfiniteAnimations: Array<{
    selector: string;
    animationName: string;
    durationSec: number;
  }>;
  blurredLyricLines: Array<{ selector: string; filter: string }>;
}

export interface ReducedTransparencyAuditOptions {
  requireMediaQuery?: boolean;
  minOpaqueAlpha?: number;
}

export interface ReducedTransparencyAuditReport {
  mediaQueryMatches: boolean;
  checkedChromeCount: number;
  blurViolations: Array<{
    selector: string;
    testId: string | null;
    backdropFilter: string;
    blurPx: number;
  }>;
  translucentViolations: Array<{
    selector: string;
    testId: string | null;
    bgAlpha: number;
  }>;
}

export interface IncreasedContrastAuditOptions {
  allowForcedColors?: boolean;
}

export interface IncreasedContrastAuditReport {
  mediaQueryMatches: boolean;
  forcedColorsMatches: boolean;
  contrastReport: ContrastAuditReport;
  chromeCheckedCount: number;
  weakChromeBordersOrFills: Array<{
    selector: string;
    testId: string | null;
    bgAlpha: number;
    borderAlpha: number;
  }>;
}

export interface AriaAuditOptions {
  rootSelector?: string;
}

export interface AriaAuditReport {
  iconButtonsChecked: number;
  missingIconLabels: Array<{
    selector: string;
    testId: string | null;
    tag: string;
  }>;
  slidersChecked: number;
  sliderViolations: Array<{
    selector: string;
    testId: string | null;
    missing: string[];
  }>;
  tabsChecked: number;
  tabViolations: Array<{
    selector: string;
    testId: string | null;
    reason: string;
  }>;
}

export interface SingleSheetAuditReport {
  visibleDialogCount: number;
  dialogs: Array<{
    selector: string;
    testId: string | null;
    ariaLabel: string | null;
  }>;
}

export interface OverflowAuditReport {
  viewportWidth: number;
  viewportHeight: number;
  innerWidth: number;
  documentScrollWidth: number;
  bodyScrollWidth: number;
  hasOverflow: boolean;
  offendingElements: Array<{
    selector: string;
    testId: string | null;
    right: number;
    overflowPx: number;
  }>;
}

export interface ZeroLinerAuditReport {
  scannedCount: number;
  matches: Array<{ location: string; snippet: string }>;
}

// ============================================================================
// 1. Pure Node-Testable WCAG 2.1 Color, Luminance, Blur & Clean-Room Functions
// ============================================================================

/**
 * Word-boundary regex matching forbidden Liner branding/repos without false
 * positives on CSS/English/Spanish words like "linear", "inline", "outline".
 */
export const LINER_CLEANROOM_REGEX =
  /\b(?:tryliner|liner-signer|feralbureau|liner)\b/i;

export function parseCssColor(raw: string): RGBA | null {
  const s = raw.trim().toLowerCase();
  if (!s || s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };

  const hexMatch = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(s);
  if (hexMatch) {
    const h = hexMatch[1] ?? '';
    if (h.length === 3 || h.length === 4) {
      const c0 = h[0] ?? '0';
      const c1 = h[1] ?? '0';
      const c2 = h[2] ?? '0';
      const c3 = h[3] ?? 'f';
      const r = Number.parseInt(c0 + c0, 16);
      const g = Number.parseInt(c1 + c1, 16);
      const b = Number.parseInt(c2 + c2, 16);
      const a = h.length === 4 ? Number.parseInt(c3 + c3, 16) / 255 : 1;
      return { r, g, b, a };
    }
    const r = Number.parseInt(h.slice(0, 2), 16);
    const g = Number.parseInt(h.slice(2, 4), 16);
    const b = Number.parseInt(h.slice(4, 6), 16);
    const a = h.length === 8 ? Number.parseInt(h.slice(6, 8), 16) / 255 : 1;
    return { r, g, b, a };
  }

  const rgbMatch = /^rgba?\(([^)]+)\)$/.exec(s);
  if (rgbMatch) {
    const body = (rgbMatch[1] ?? '').trim();
    const parts = body.includes(',')
      ? body.split(',').map((p) => p.trim())
      : body
          .replace('/', ' / ')
          .split(/\s+/)
          .filter((p) => p !== '/');
    if (parts.length < 3 || parts.length > 4) return null;
    const parseChannel = (tok: string): number =>
      tok.endsWith('%')
        ? (Number.parseFloat(tok) / 100) * 255
        : Number.parseFloat(tok);
    const parseAlpha = (tok?: string): number => {
      if (tok === undefined) return 1;
      return tok.endsWith('%')
        ? Number.parseFloat(tok) / 100
        : Number.parseFloat(tok);
    };
    const r = parseChannel(parts[0] ?? '');
    const g = parseChannel(parts[1] ?? '');
    const b = parseChannel(parts[2] ?? '');
    const a = parseAlpha(parts[3]);
    if ([r, g, b, a].some(Number.isNaN)) return null;
    return {
      r: Math.max(0, Math.min(255, r)),
      g: Math.max(0, Math.min(255, g)),
      b: Math.max(0, Math.min(255, b)),
      a: Math.max(0, Math.min(1, a)),
    };
  }

  const srgbMatch =
    /^color\(\s*srgb\s+([^\s/]+)\s+([^\s/]+)\s+([^\s/]+)(?:\s*\/\s*([^\s)]+))?\s*\)$/.exec(
      s
    );
  if (srgbMatch) {
    const r = Number.parseFloat(srgbMatch[1] ?? '') * 255;
    const g = Number.parseFloat(srgbMatch[2] ?? '') * 255;
    const b = Number.parseFloat(srgbMatch[3] ?? '') * 255;
    const rawA = srgbMatch[4];
    const a = rawA
      ? rawA.endsWith('%')
        ? Number.parseFloat(rawA) / 100
        : Number.parseFloat(rawA)
      : 1;
    if ([r, g, b, a].some(Number.isNaN)) return null;
    return {
      r: Math.max(0, Math.min(255, r)),
      g: Math.max(0, Math.min(255, g)),
      b: Math.max(0, Math.min(255, b)),
      a: Math.max(0, Math.min(1, a)),
    };
  }

  return null;
}

export function compositeOver(fg: RGBA, bg: RGBA): RGBA {
  const outA = fg.a + bg.a * (1 - fg.a);
  if (outA <= 0) return { r: 0, g: 0, b: 0, a: 0 };
  return {
    r: (fg.r * fg.a + bg.r * bg.a * (1 - fg.a)) / outA,
    g: (fg.g * fg.a + bg.g * bg.a * (1 - fg.a)) / outA,
    b: (fg.b * fg.a + bg.b * bg.a * (1 - fg.a)) / outA,
    a: outA,
  };
}

export function relativeLuminance(color: Pick<RGBA, 'r' | 'g' | 'b'>): number {
  const toLinear = (v: number): number => {
    const s = Math.max(0, Math.min(255, v)) / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return (
    0.2126 * toLinear(color.r) +
    0.7152 * toLinear(color.g) +
    0.0722 * toLinear(color.b)
  );
}

export function contrastRatio(fg: RGBA, bg: RGBA): number {
  const opaqueBg: RGBA =
    bg.a < 1 ? compositeOver(bg, { r: 0, g: 0, b: 0, a: 1 }) : bg;
  const effectiveFg: RGBA = fg.a < 1 ? compositeOver(fg, opaqueBg) : fg;
  const l1 = relativeLuminance(effectiveFg);
  const l2 = relativeLuminance(opaqueBg);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

export function isLargeText(
  fontSizePx: number,
  fontWeight: number,
  mode: 'apple-hig-px' | 'wcag-strict-pt' = 'apple-hig-px'
): boolean {
  if (mode === 'wcag-strict-pt') {
    return fontSizePx >= 24 || (fontSizePx >= 18.66 && fontWeight >= 700);
  }
  return fontSizePx >= 18 || (fontSizePx >= 14 && fontWeight >= 700);
}

export function requiredContrastRatio(
  fontSizePx: number,
  fontWeight: number,
  mode: 'apple-hig-px' | 'wcag-strict-pt' = 'apple-hig-px',
  normalMin = 4.5,
  largeMin = 3.0
): number {
  return isLargeText(fontSizePx, fontWeight, mode) ? largeMin : normalMin;
}

export function parseBackdropBlurPx(
  backdropFilter: string | null | undefined
): number {
  if (!backdropFilter || backdropFilter === 'none') return 0;
  let maxPx = 0;
  const re = /blur\(\s*([0-9.]+)px\s*\)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(backdropFilter)) !== null) {
    const val = Number.parseFloat(m[1] ?? '');
    if (!Number.isNaN(val) && val > maxPx) maxPx = val;
  }
  return maxPx;
}

export function hasActiveBackdropBlur(
  backdropFilter: string | null | undefined
): boolean {
  return parseBackdropBlurPx(backdropFilter) > 0;
}

// ============================================================================
// 2. Browser Evaluators & Non-Vacuous Assertion Wrappers
// ============================================================================

export async function auditContrast(
  page: Page,
  options?: ContrastAuditOptions
): Promise<ContrastAuditReport> {
  return page.evaluate((opts) => {
    const rootSelector = opts?.rootSelector ?? 'body';
    const excludeSelectors = [
      ...(opts?.excludeSelectors ?? []),
      '[data-lyric-active="false"]',
      '[data-lyric-state="inactive"]',
    ];
    const canvasBg: RGBA = opts?.canvasBg ?? { r: 0, g: 0, b: 0, a: 1 };
    const thresholdMode = opts?.thresholdMode ?? 'apple-hig-px';
    const includeOffscreen = opts?.includeOffscreen ?? false;
    const normalMin = opts?.normalMinRatio ?? 4.5;
    const largeMin = opts?.largeMinRatio ?? 3.0;

    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    function parseColorInBrowser(raw: string | null | undefined): RGBA {
      const s = (raw ?? '').trim().toLowerCase();
      if (!s || s === 'transparent' || s === 'rgba(0, 0, 0, 0)') {
        return { r: 0, g: 0, b: 0, a: 0 };
      }
      const rgbMatch = /^rgba?\(([^)]+)\)$/.exec(s);
      if (rgbMatch) {
        const body = (rgbMatch[1] ?? '').trim();
        const parts = body.includes(',')
          ? body.split(',').map((p) => p.trim())
          : body
              .replace('/', ' / ')
              .split(/\s+/)
              .filter((p) => p !== '/');
        if (parts.length >= 3) {
          const p0 = parts[0] ?? '0';
          const p1 = parts[1] ?? '0';
          const p2 = parts[2] ?? '0';
          const p3 = parts[3];
          const ch = (tok: string) =>
            tok.endsWith('%')
              ? (Number.parseFloat(tok) / 100) * 255
              : Number.parseFloat(tok);
          const al =
            p3 === undefined
              ? 1
              : p3.endsWith('%')
                ? Number.parseFloat(p3) / 100
                : Number.parseFloat(p3);
          const r = ch(p0);
          const g = ch(p1);
          const b = ch(p2);
          if (![r, g, b, al].some(Number.isNaN)) {
            return {
              r: Math.max(0, Math.min(255, r)),
              g: Math.max(0, Math.min(255, g)),
              b: Math.max(0, Math.min(255, b)),
              a: Math.max(0, Math.min(1, al)),
            };
          }
        }
      }
      if (ctx) {
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillStyle = '#000000';
        ctx.fillStyle = s;
        ctx.fillRect(0, 0, 1, 1);
        const data = ctx.getImageData(0, 0, 1, 1).data;
        const slashAlpha = /\/\s*([0-9.]+%?)\s*\)$/.exec(s);
        let a = (data[3] ?? 255) / 255;
        if (slashAlpha?.[1]) {
          const tok = slashAlpha[1];
          const parsedA = tok.endsWith('%')
            ? Number.parseFloat(tok) / 100
            : Number.parseFloat(tok);
          if (!Number.isNaN(parsedA)) {
            a = Math.max(0, Math.min(1, parsedA));
          }
        }
        return {
          r: data[0] ?? 0,
          g: data[1] ?? 0,
          b: data[2] ?? 0,
          a,
        };
      }
      return { r: 255, g: 255, b: 255, a: 1 };
    }

    function compOver(fg: RGBA, bg: RGBA): RGBA {
      const outA = fg.a + bg.a * (1 - fg.a);
      if (outA <= 0) return { r: 0, g: 0, b: 0, a: 0 };
      return {
        r: (fg.r * fg.a + bg.r * bg.a * (1 - fg.a)) / outA,
        g: (fg.g * fg.a + bg.g * bg.a * (1 - fg.a)) / outA,
        b: (fg.b * fg.a + bg.b * bg.a * (1 - fg.a)) / outA,
        a: outA,
      };
    }

    function relLum(c: RGBA): number {
      const lin = (v: number) => {
        const sv = Math.max(0, Math.min(255, v)) / 255;
        return sv <= 0.04045 ? sv / 12.92 : Math.pow((sv + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
    }

    function calcRatio(fg: RGBA, bg: RGBA): number {
      const opBg = bg.a < 1 ? compOver(bg, canvasBg) : bg;
      const effFg = fg.a < 1 ? compOver(fg, opBg) : fg;
      const l1 = relLum(effFg);
      const l2 = relLum(opBg);
      return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    }

    function describeEl(el: Element): string {
      const tag = el.tagName.toLowerCase();
      const tid = el.getAttribute('data-testid');
      if (tid) return `${tag}[data-testid="${tid}"]`;
      const id = el.id ? `#${el.id}` : '';
      const cls =
        typeof el.className === 'string' && el.className.trim()
          ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}`
          : '';
      return `${tag}${id}${cls}`;
    }

    function isExcluded(el: Element): boolean {
      for (const sel of excludeSelectors) {
        try {
          if (el.matches(sel) || el.closest(sel)) return true;
        } catch {
          // Ignore invalid selector
        }
      }
      return false;
    }

    const root = document.querySelector(rootSelector);
    if (!root) {
      return {
        checkedCount: 0,
        passCount: 0,
        minRatio: null,
        violations: [],
      };
    }

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const visitedElements = new Set<Element>();
    const violations: ContrastViolation[] = [];
    let checkedCount = 0;
    let passCount = 0;
    let minRatio: number | null = null;

    let currentNode = walker.nextNode();
    while (currentNode) {
      const text = (currentNode.nodeValue ?? '').trim();
      const el = currentNode.parentElement;
      currentNode = walker.nextNode();

      if (!text || !el || visitedElements.has(el)) continue;
      const tag = el.tagName.toLowerCase();
      if (tag === 'script' || tag === 'style' || tag === 'noscript' || tag === 'title') {
        continue;
      }
      if (isExcluded(el)) continue;
      if (
        el.hasAttribute('disabled') ||
        el.getAttribute('aria-disabled') === 'true' ||
        el.closest('[disabled], [aria-disabled="true"], [aria-hidden="true"]')
      ) {
        continue;
      }

      const rect = el.getBoundingClientRect();
      if (rect.width <= 1 || rect.height <= 1) continue;
      if (
        !includeOffscreen &&
        (rect.bottom <= 0 ||
          rect.right <= 0 ||
          rect.top >= window.innerHeight ||
          rect.left >= window.innerWidth)
      ) {
        continue;
      }

      const style = window.getComputedStyle(el);
      if (
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        style.clip === 'rect(0px, 0px, 0px, 0px)'
      ) {
        continue;
      }

      // Walk ancestors for cumulative opacity and background layers
      const bgLayers: RGBA[] = [];
      let cumulativeOpacity = 1;
      let curr: Element | null = el;
      let hiddenAncestor = false;

      while (curr) {
        const cs = window.getComputedStyle(curr);
        if (cs.display === 'none' || cs.visibility === 'hidden') {
          hiddenAncestor = true;
          break;
        }
        const op = Number.parseFloat(cs.opacity);
        if (!Number.isNaN(op)) {
          cumulativeOpacity *= op;
        }
        const bgColor = parseColorInBrowser(cs.backgroundColor);
        if (bgColor.a > 0) {
          bgLayers.push({
            ...bgColor,
            a: Math.max(0, Math.min(1, bgColor.a * (Number.isNaN(op) ? 1 : op))),
          });
        }
        curr = curr.parentElement;
      }

      if (hiddenAncestor || cumulativeOpacity < 0.15) continue;
      visitedElements.add(el);

      // Composite backgrounds top-down from root to element
      let resolvedBg: RGBA = { ...canvasBg };
      for (let i = bgLayers.length - 1; i >= 0; i--) {
        const layer = bgLayers[i];
        if (layer) {
          resolvedBg = compOver(layer, resolvedBg);
        }
      }

      const rawFg = parseColorInBrowser(style.color);
      const effectiveFg: RGBA = compOver(
        { ...rawFg, a: Math.max(0, Math.min(1, rawFg.a * cumulativeOpacity)) },
        resolvedBg
      );

      const fontSizePx = Number.parseFloat(style.fontSize) || 14;
      const fontWeight =
        Number.parseInt(style.fontWeight, 10) ||
        (style.fontWeight === 'bold' ? 700 : 400);
      const isLarge =
        thresholdMode === 'wcag-strict-pt'
          ? fontSizePx >= 24 || (fontSizePx >= 18.66 && fontWeight >= 700)
          : fontSizePx >= 18 || (fontSizePx >= 14 && fontWeight >= 700);
      const reqRatio = isLarge ? largeMin : normalMin;
      const ratio = Number(calcRatio(effectiveFg, resolvedBg).toFixed(2));

      checkedCount++;
      if (minRatio === null || ratio < minRatio) {
        minRatio = ratio;
      }

      if (ratio + 0.05 < reqRatio) {
        violations.push({
          selector: describeEl(el),
          testId:
            el.getAttribute('data-testid') ??
            el.closest('[data-testid]')?.getAttribute('data-testid') ??
            null,
          textSample: text.slice(0, 60),
          fontSizePx: Number(fontSizePx.toFixed(2)),
          fontWeight,
          isLarge,
          fg: {
            r: Math.round(effectiveFg.r),
            g: Math.round(effectiveFg.g),
            b: Math.round(effectiveFg.b),
            a: Number(effectiveFg.a.toFixed(2)),
          },
          bg: {
            r: Math.round(resolvedBg.r),
            g: Math.round(resolvedBg.g),
            b: Math.round(resolvedBg.b),
            a: Number(resolvedBg.a.toFixed(2)),
          },
          ratio,
          requiredRatio: reqRatio,
        });
      } else {
        passCount++;
      }
    }

    return {
      checkedCount,
      passCount,
      minRatio,
      violations,
    };
  }, options);
}

export async function assertContrast(
  page: Page,
  options?: ContrastAuditOptions
): Promise<ContrastAuditReport> {
  const report = await auditContrast(page, options);
  expect(
    report.checkedCount,
    'Contrast audit found 0 visible text nodes (vacuous screen check)'
  ).toBeGreaterThan(0);
  expect(
    report.violations,
    `WCAG 2.1 contrast violations found:\n${JSON.stringify(report.violations, null, 2)}`
  ).toEqual([]);
  return report;
}

export async function auditTypography(
  page: Page,
  options?: TypographyAuditOptions
): Promise<TypographyAuditReport> {
  return page.evaluate((opts) => {
    const rootSelector = opts?.rootSelector ?? 'body';
    const excludeSelectors = opts?.excludeSelectors ?? [];
    const mobileBp = opts?.mobileBreakpointPx ?? 768;
    const isMobile = window.innerWidth < mobileBp;
    const minFontPxFloor = isMobile
      ? (opts?.mobileMinPx ?? 11)
      : (opts?.desktopMinPx ?? 10);
    const thinCeilingPx = opts?.thinWeightCeilingPx ?? 20;

    function describeEl(el: Element): string {
      const tag = el.tagName.toLowerCase();
      const tid = el.getAttribute('data-testid');
      return tid ? `${tag}[data-testid="${tid}"]` : tag;
    }

    function isExcluded(el: Element): boolean {
      for (const sel of excludeSelectors) {
        try {
          if (el.matches(sel) || el.closest(sel)) return true;
        } catch {
          // Ignore
        }
      }
      return false;
    }

    const root = document.querySelector(rootSelector);
    if (!root) {
      return {
        viewportWidth: window.innerWidth,
        isMobile,
        minFontPxFloor,
        checkedCount: 0,
        minObservedFontPx: null,
        sizeViolations: [],
        weightViolations: [],
      };
    }

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const visited = new Set<Element>();
    const sizeViolations: TypographyViolation[] = [];
    const weightViolations: TypographyViolation[] = [];
    let checkedCount = 0;
    let minObservedFontPx: number | null = null;

    let node = walker.nextNode();
    while (node) {
      const text = (node.nodeValue ?? '').trim();
      const el = node.parentElement;
      node = walker.nextNode();

      if (!text || !el || visited.has(el)) continue;
      const tag = el.tagName.toLowerCase();
      if (tag === 'script' || tag === 'style' || tag === 'noscript') continue;
      if (isExcluded(el)) continue;
      if (el.closest('[aria-hidden="true"]')) continue;

      const rect = el.getBoundingClientRect();
      if (rect.width <= 1 || rect.height <= 1) continue;

      const style = window.getComputedStyle(el);
      if (
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        Number.parseFloat(style.opacity) === 0
      ) {
        continue;
      }

      visited.add(el);
      const fontSizePx = Number.parseFloat(style.fontSize) || 14;
      const fontWeight =
        Number.parseInt(style.fontWeight, 10) ||
        (style.fontWeight === 'bold' ? 700 : 400);

      checkedCount++;
      if (minObservedFontPx === null || fontSizePx < minObservedFontPx) {
        minObservedFontPx = Number(fontSizePx.toFixed(2));
      }

      const testId =
        el.getAttribute('data-testid') ??
        el.closest('[data-testid]')?.getAttribute('data-testid') ??
        null;

      if (fontSizePx < minFontPxFloor - 0.05) {
        sizeViolations.push({
          selector: describeEl(el),
          testId,
          textSample: text.slice(0, 50),
          fontSizePx: Number(fontSizePx.toFixed(2)),
          fontWeight,
          reason: 'below_size_floor',
        });
      }

      if (fontSizePx < thinCeilingPx && fontWeight < 400) {
        weightViolations.push({
          selector: describeEl(el),
          testId,
          textSample: text.slice(0, 50),
          fontSizePx: Number(fontSizePx.toFixed(2)),
          fontWeight,
          reason: 'thin_weight_on_small_text',
        });
      }
    }

    return {
      viewportWidth: window.innerWidth,
      isMobile,
      minFontPxFloor,
      checkedCount,
      minObservedFontPx,
      sizeViolations,
      weightViolations,
    };
  }, options);
}

export async function assertTypography(
  page: Page,
  options?: TypographyAuditOptions
): Promise<TypographyAuditReport> {
  const report = await auditTypography(page, options);
  expect(
    report.checkedCount,
    'Typography audit found 0 visible text nodes (vacuous screen check)'
  ).toBeGreaterThan(0);
  expect(
    report.sizeViolations,
    `Typography size floor (${report.minFontPxFloor}px) violations:\n${JSON.stringify(report.sizeViolations, null, 2)}`
  ).toEqual([]);
  expect(
    report.weightViolations,
    `Typography thin font-weight (<400 on <20px text) violations:\n${JSON.stringify(report.weightViolations, null, 2)}`
  ).toEqual([]);
  return report;
}

export async function auditHitTargets(
  page: Page,
  options?: HitTargetAuditOptions
): Promise<HitTargetAuditReport> {
  return page.evaluate((opts) => {
    const rootSelector = opts?.rootSelector ?? 'body';
    const excludeSelectors = opts?.excludeSelectors ?? [];
    const isMobile = window.innerWidth < 768;
    const tol = opts?.tolerancePx ?? 0.5;
    const primaryMinPx = isMobile
      ? (opts?.mobilePrimaryMinPx ?? 44)
      : (opts?.desktopDefaultMinPx ?? 28);
    const floorMinPx = isMobile
      ? (opts?.mobileFloorMinPx ?? 28)
      : (opts?.desktopFloorMinPx ?? 20);

    const primarySelector =
      opts?.primarySelector ??
      [
        '[data-testid="mobile-tab-bar"] button',
        '[data-testid="mobile-tab-bar"] [role="tab"]',
        '[data-testid="mobile-tab-bar"] a',
        '[data-testid="mobile-mini-player"] button',
        '[data-testid="now-playing-sheet"] button',
        '[data-testid="desktop-sidebar"] button',
        '[data-testid="desktop-sidebar"] a',
        '[data-testid="desktop-sidebar"] [role="tab"]',
        '[data-testid="desktop-player-bar"] button',
        '[role="tablist"] [role="tab"]',
        '[role="dialog"] button',
        '[role="switch"]',
      ].join(', ');

    function isExcluded(el: Element): boolean {
      for (const sel of excludeSelectors) {
        try {
          if (el.matches(sel) || el.closest(sel)) return true;
        } catch {
          // Ignore
        }
      }
      return false;
    }

    function describeEl(el: Element): string {
      const tag = el.tagName.toLowerCase();
      const tid = el.getAttribute('data-testid');
      const aria = el.getAttribute('aria-label');
      if (tid) return `${tag}[data-testid="${tid}"]`;
      if (aria) return `${tag}[aria-label="${aria}"]`;
      return tag;
    }

    const root = document.querySelector(rootSelector);
    if (!root) {
      return {
        viewportWidth: window.innerWidth,
        isMobile,
        checkedCount: 0,
        primaryViolations: [],
        floorViolations: [],
      };
    }

    const candidates = Array.from(
      root.querySelectorAll(
        'button, a[href], [role="button"], [role="tab"], [role="slider"], [role="switch"], input:not([type="hidden"]), select'
      )
    );

    const primaryViolations: HitTargetViolation[] = [];
    const floorViolations: HitTargetViolation[] = [];
    let checkedCount = 0;

    for (const el of candidates) {
      if (isExcluded(el)) continue;
      if (
        el.hasAttribute('disabled') ||
        el.getAttribute('aria-disabled') === 'true' ||
        el.closest('[disabled], [aria-disabled="true"], [aria-hidden="true"]')
      ) {
        continue;
      }

      const style = window.getComputedStyle(el);
      if (
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        Number.parseFloat(style.opacity) === 0
      ) {
        continue;
      }

      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      if (
        rect.bottom <= 0 ||
        rect.right <= 0 ||
        rect.top >= window.innerHeight ||
        rect.left >= window.innerWidth
      ) {
        continue;
      }

      checkedCount++;
      const isSlider =
        el.getAttribute('role') === 'slider' ||
        (el.tagName.toLowerCase() === 'input' &&
          (el as HTMLInputElement).type === 'range');

      // For sliders, check parent hit wrapper height if the input track itself is styled thin
      const parentRect = el.parentElement?.getBoundingClientRect();
      const effectiveWidth = isSlider && parentRect
        ? Math.max(rect.width, parentRect.width)
        : rect.width;
      const effectiveHeight = isSlider && parentRect
        ? Math.max(rect.height, parentRect.height)
        : rect.height;

      let isPrimary = false;
      try {
        isPrimary = el.matches(primarySelector);
      } catch {
        isPrimary = false;
      }

      const label = (
        el.getAttribute('aria-label') ??
        (el as HTMLElement).innerText ??
        ''
      )
        .trim()
        .slice(0, 40);
      const role = el.getAttribute('role') ?? el.tagName.toLowerCase();
      const testId =
        el.getAttribute('data-testid') ??
        el.closest('[data-testid]')?.getAttribute('data-testid') ??
        null;

      if (isPrimary) {
        if (
          effectiveWidth < primaryMinPx - tol ||
          effectiveHeight < primaryMinPx - tol
        ) {
          primaryViolations.push({
            selector: describeEl(el),
            testId,
            label,
            role,
            width: Number(effectiveWidth.toFixed(1)),
            height: Number(effectiveHeight.toFixed(1)),
            requiredPx: primaryMinPx,
            tier: 'primary',
          });
        }
      } else if (
        effectiveWidth < floorMinPx - tol ||
        effectiveHeight < floorMinPx - tol
      ) {
        floorViolations.push({
          selector: describeEl(el),
          testId,
          label,
          role,
          width: Number(effectiveWidth.toFixed(1)),
          height: Number(effectiveHeight.toFixed(1)),
          requiredPx: floorMinPx,
          tier: 'floor',
        });
      }
    }

    return {
      viewportWidth: window.innerWidth,
      isMobile,
      checkedCount,
      primaryViolations,
      floorViolations,
    };
  }, options);
}

export async function assertHitTargets(
  page: Page,
  options?: HitTargetAuditOptions
): Promise<HitTargetAuditReport> {
  const report = await auditHitTargets(page, options);
  expect(
    report.checkedCount,
    'Hit target audit found 0 visible interactive controls (vacuous screen check)'
  ).toBeGreaterThan(0);
  expect(
    report.primaryViolations,
    `Primary hit-target violations:\n${JSON.stringify(report.primaryViolations, null, 2)}`
  ).toEqual([]);
  expect(
    report.floorViolations,
    `Minimum hit-target floor violations:\n${JSON.stringify(report.floorViolations, null, 2)}`
  ).toEqual([]);
  return report;
}

export async function auditLiquidGlass(
  page: Page,
  options?: LiquidGlassAuditOptions
): Promise<LiquidGlassAuditReport> {
  return page.evaluate((opts) => {
    const maxAllowed = opts?.maxSimultaneousGlass ?? 4;

    function getBlurPx(bf: string | null | undefined): number {
      if (!bf || bf === 'none') return 0;
      let max = 0;
      const re = /blur\(\s*([0-9.]+)px\s*\)/gi;
      let m: RegExpExecArray | null;
      while ((m = re.exec(bf)) !== null) {
        const v = Number.parseFloat(m[1] ?? '');
        if (!Number.isNaN(v) && v > max) max = v;
      }
      return max;
    }

    function parseBgAlpha(bg: string | null | undefined): number {
      const s = (bg ?? '').trim().toLowerCase();
      if (!s || s === 'transparent') return 0;
      const rgbaMatch = /^rgba\(([^)]+)\)$/.exec(s);
      if (rgbaMatch) {
        const parts = (rgbaMatch[1] ?? '').split(',');
        const a = Number.parseFloat((parts[3] ?? '1').trim());
        return Number.isNaN(a) ? 1 : a;
      }
      const slashMatch = /\/\s*([0-9.]+%?)\s*\)$/.exec(s);
      if (slashMatch?.[1]) {
        const tok = slashMatch[1];
        const a = tok.endsWith('%')
          ? Number.parseFloat(tok) / 100
          : Number.parseFloat(tok);
        return Number.isNaN(a) ? 1 : a;
      }
      return 1;
    }

    function describeEl(el: Element): string {
      const tag = el.tagName.toLowerCase();
      const tid = el.getAttribute('data-testid');
      if (tid) return `${tag}[data-testid="${tid}"]`;
      const id = el.id ? `#${el.id}` : '';
      return `${tag}${id}`;
    }

    const chromeLandmarkSelector = [
      '[data-testid="mobile-tab-bar"]',
      '[data-testid="mobile-mini-player"]',
      '[data-testid="desktop-sidebar"]',
      '[data-testid="desktop-player-bar"]',
      '[data-testid="now-playing-sheet"]',
      '[data-testid="eq-sheet"]',
      '[data-testid="devices-sheet"]',
      '[data-testid="import-modal"]',
      '[role="dialog"]',
      '[role="search"]',
      '[data-surface="glass"]',
    ].join(', ');

    const contentSelectors = [
      'html',
      'body',
      '#root',
      'main',
      'main article',
      '[role="row"]',
      '[role="listitem"]',
      '[data-surface="content"]',
      '[data-testid="best-result-card"]',
      ...(opts?.extraContentSelectors ?? []),
    ];

    const contentViolations: Array<{
      selector: string;
      testId: string | null;
      backdropFilter: string;
    }> = [];
    const checkedContentSet = new Set<Element>();

    for (const sel of contentSelectors) {
      let els: Element[] = [];
      try {
        els = Array.from(document.querySelectorAll(sel));
      } catch {
        continue;
      }
      for (const el of els) {
        if (checkedContentSet.has(el)) continue;
        try {
          if (el.matches(chromeLandmarkSelector)) continue;
        } catch {
          // Ignore
        }
        const rect = el.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) continue;
        checkedContentSet.add(el);

        const cs = window.getComputedStyle(el);
        const bf =
          cs.backdropFilter && cs.backdropFilter !== 'none'
            ? cs.backdropFilter
            : ((cs as unknown as { webkitBackdropFilter?: string })
                .webkitBackdropFilter ?? 'none');
        if (getBlurPx(bf) > 0) {
          contentViolations.push({
            selector: describeEl(el),
            testId: el.getAttribute('data-testid'),
            backdropFilter: bf,
          });
        }
      }
    }

    const allElements = Array.from(document.querySelectorAll('*'));
    const activeGlassSet = new Set<Element>();
    const activeGlassElements: GlassElementInfo[] = [];

    for (const el of allElements) {
      if (el.getAttribute('data-glass-transient') === 'true') continue;
      const cs = window.getComputedStyle(el);
      if (
        cs.display === 'none' ||
        cs.visibility === 'hidden' ||
        Number.parseFloat(cs.opacity) === 0
      ) {
        continue;
      }
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      if (
        rect.bottom <= 0 ||
        rect.right <= 0 ||
        rect.top >= window.innerHeight ||
        rect.left >= window.innerWidth
      ) {
        continue;
      }

      const bf =
        cs.backdropFilter && cs.backdropFilter !== 'none'
          ? cs.backdropFilter
          : ((cs as unknown as { webkitBackdropFilter?: string })
              .webkitBackdropFilter ?? 'none');
      const blurPx = getBlurPx(bf);
      if (blurPx > 0) {
        activeGlassSet.add(el);
        activeGlassElements.push({
          selector: describeEl(el),
          testId: el.getAttribute('data-testid'),
          backdropFilter: bf,
          blurPx,
          bgAlpha: Number(parseBgAlpha(cs.backgroundColor).toFixed(2)),
        });
      }
    }

    const stackingViolations: Array<{ ancestor: string; descendant: string }> =
      [];
    for (const el of activeGlassSet) {
      let parent = el.parentElement;
      while (parent) {
        if (activeGlassSet.has(parent)) {
          stackingViolations.push({
            ancestor: describeEl(parent),
            descendant: describeEl(el),
          });
          break;
        }
        parent = parent.parentElement;
      }
    }

    return {
      activeGlassCount: activeGlassElements.length,
      maxAllowed,
      activeGlassElements,
      contentCheckedCount: checkedContentSet.size,
      contentViolations,
      stackingViolations,
    };
  }, options);
}

export async function assertLiquidGlass(
  page: Page,
  options?: LiquidGlassAuditOptions
): Promise<LiquidGlassAuditReport> {
  const report = await auditLiquidGlass(page, options);
  expect(
    report.contentCheckedCount,
    'Liquid Glass audit found 0 content elements to inspect'
  ).toBeGreaterThan(0);
  expect(
    report.contentViolations,
    `Content elements must NEVER use backdrop-filter blur:\n${JSON.stringify(report.contentViolations, null, 2)}`
  ).toEqual([]);
  expect(
    report.stackingViolations,
    `Glass-on-glass stacking violations found:\n${JSON.stringify(report.stackingViolations, null, 2)}`
  ).toEqual([]);
  expect(
    report.activeGlassCount,
    `Simultaneous Liquid Glass surfaces (${report.activeGlassCount}) exceeded cap (${report.maxAllowed})`
  ).toBeLessThanOrEqual(report.maxAllowed);
  if (!options?.allowZeroGlass) {
    expect(
      report.activeGlassCount,
      'Expected at least 1 active Liquid Glass functional chrome surface in normal transparency mode'
    ).toBeGreaterThanOrEqual(1);
  }
  return report;
}

export async function auditBrightMediaScrim(
  page: Page,
  options?: BrightMediaScrimAuditOptions
): Promise<BrightMediaScrimAuditReport> {
  const sheetSelector =
    options?.sheetSelector ?? '[data-testid="now-playing-sheet"]';
  const foregroundContrast = await auditContrast(page, {
    rootSelector: sheetSelector,
    excludeSelectors: options?.excludeSelectors,
  });

  const scrimEval = await page.evaluate(
    ({ sel }) => {
      const sheet = document.querySelector(sel);
      if (!sheet) {
        return {
          sheetVisible: false,
          scrimFound: false,
          scrimSelector: null,
          effectiveScrimAlpha: 0,
        };
      }
      const sheetRect = sheet.getBoundingClientRect();
      if (sheetRect.width <= 0 || sheetRect.height <= 0) {
        return {
          sheetVisible: false,
          scrimFound: false,
          scrimSelector: null,
          effectiveScrimAlpha: 0,
        };
      }

      function extractDarkAlpha(str: string): number {
        let maxAlpha = 0;
        const rgbaRe = /rgba?\(\s*([0-9.]+)\s*[,\s]\s*([0-9.]+)\s*[,\s]\s*([0-9.]+)(?:\s*[,/]\s*([0-9.]+%?))?\s*\)/gi;
        let m: RegExpExecArray | null;
        while ((m = rgbaRe.exec(str)) !== null) {
          const r = Number.parseFloat(m[1] ?? '255');
          const g = Number.parseFloat(m[2] ?? '255');
          const b = Number.parseFloat(m[3] ?? '255');
          const rawA = m[4];
          const a = rawA
            ? rawA.endsWith('%')
              ? Number.parseFloat(rawA) / 100
              : Number.parseFloat(rawA)
            : 1;
          if (r <= 36 && g <= 36 && b <= 45 && !Number.isNaN(a)) {
            if (a > maxAlpha) maxAlpha = a;
          }
        }
        return maxAlpha;
      }

      const candidates = [
        sheet,
        ...Array.from(
          sheet.querySelectorAll(
            '[data-testid="bright-media-scrim"], [data-scrim], div, section'
          )
        ),
      ];

      let bestAlpha = 0;
      let bestSelector: string | null = null;

      for (const el of candidates) {
        const cs = window.getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        const op = Number.parseFloat(cs.opacity);
        const effOp = Number.isNaN(op) ? 1 : op;
        if (effOp <= 0) continue;

        const r = el.getBoundingClientRect();
        const coversSheet =
          r.width >= sheetRect.width * 0.45 && r.height >= sheetRect.height * 0.25;
        const isExplicitScrim =
          el.getAttribute('data-testid') === 'bright-media-scrim' ||
          el.hasAttribute('data-scrim');

        if (!coversSheet && !isExplicitScrim) continue;

        const dataAlpha = Number.parseFloat(
          el.getAttribute('data-scrim-alpha') ?? ''
        );
        const bgAlpha = extractDarkAlpha(cs.backgroundColor) * effOp;
        const imgAlpha = extractDarkAlpha(cs.backgroundImage) * effOp;
        const candidateAlpha = Math.max(
          Number.isNaN(dataAlpha) ? 0 : dataAlpha,
          bgAlpha,
          imgAlpha
        );

        if (candidateAlpha > bestAlpha) {
          bestAlpha = candidateAlpha;
          const tid = el.getAttribute('data-testid');
          bestSelector = tid
            ? `${el.tagName.toLowerCase()}[data-testid="${tid}"]`
            : el.tagName.toLowerCase();
        }
      }

      return {
        sheetVisible: true,
        scrimFound: bestAlpha > 0,
        scrimSelector: bestSelector,
        effectiveScrimAlpha: Number(bestAlpha.toFixed(2)),
      };
    },
    { sel: sheetSelector }
  );

  return {
    ...scrimEval,
    directArtworkOverlapViolations: [],
    foregroundContrast,
  };
}

export async function assertBrightMediaScrim(
  page: Page,
  options?: BrightMediaScrimAuditOptions
): Promise<BrightMediaScrimAuditReport> {
  const minAlpha = options?.minScrimAlpha ?? 0.35;
  const report = await auditBrightMediaScrim(page, options);
  expect(report.sheetVisible, 'Now Playing sheet must be visible').toBe(true);
  expect(
    report.scrimFound,
    'Bright media dimming scrim must be active inside Now Playing sheet'
  ).toBe(true);
  expect(
    report.effectiveScrimAlpha,
    `Bright media scrim alpha (${report.effectiveScrimAlpha}) must be >= ${minAlpha} (Apple HIG 35% constant)`
  ).toBeGreaterThanOrEqual(minAlpha);
  expect(
    report.foregroundContrast.checkedCount,
    'Foreground contrast check inside Now Playing found 0 text nodes'
  ).toBeGreaterThan(0);
  expect(
    report.foregroundContrast.violations,
    `Bright media Now Playing contrast violations:\n${JSON.stringify(report.foregroundContrast.violations, null, 2)}`
  ).toEqual([]);
  return report;
}

/**
 * Emulates `prefers-reduced-transparency`, `prefers-reduced-motion`,
 * `prefers-contrast`, `forced-colors`, and `prefers-color-scheme` via a
 * unified Chromium CDP `Emulation.setEmulatedMedia` session.
 */
export async function emulateAccessibilityMedia(
  page: Page,
  options: AccessibilityMediaOptions
): Promise<AccessibilityMediaController> {
  const cdp = await page.context().newCDPSession(page);
  const features: Array<{ name: string; value: string }> = [];
  if (options.reducedMotion) {
    features.push({
      name: 'prefers-reduced-motion',
      value: options.reducedMotion,
    });
  }
  if (options.reducedTransparency) {
    features.push({
      name: 'prefers-reduced-transparency',
      value: options.reducedTransparency,
    });
  }
  if (options.contrast) {
    features.push({ name: 'prefers-contrast', value: options.contrast });
  }
  if (options.forcedColors) {
    features.push({ name: 'forced-colors', value: options.forcedColors });
  }
  if (options.colorScheme) {
    features.push({
      name: 'prefers-color-scheme',
      value: options.colorScheme,
    });
  }
  await cdp.send('Emulation.setEmulatedMedia', { features });

  return {
    cdp,
    restore: async () => {
      try {
        await cdp.send('Emulation.setEmulatedMedia', { features: [] });
      } finally {
        await cdp.detach().catch(() => undefined);
      }
    },
  };
}

export async function auditReducedMotion(
  page: Page
): Promise<ReducedMotionAuditReport> {
  return page.evaluate(() => {
    const mediaQueryMatches = window.matchMedia(
      '(prefers-reduced-motion: reduce)'
    ).matches;

    function getBlurPx(f: string | null | undefined): number {
      if (!f || f === 'none') return 0;
      const m = /blur\(\s*([0-9.]+)px\s*\)/i.exec(f);
      return m?.[1] ? Number.parseFloat(m[1]) || 0 : 0;
    }

    const runningInfiniteAnimations: Array<{
      selector: string;
      animationName: string;
      durationSec: number;
    }> = [];

    for (const el of Array.from(document.querySelectorAll('*'))) {
      const cs = window.getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      if (
        cs.animationName &&
        cs.animationName !== 'none' &&
        cs.animationPlayState === 'running' &&
        cs.animationIterationCount === 'infinite'
      ) {
        const dur = Number.parseFloat(cs.animationDuration) || 0;
        if (dur > 0.05) {
          const tid = el.getAttribute('data-testid');
          runningInfiniteAnimations.push({
            selector: tid
              ? `${el.tagName.toLowerCase()}[data-testid="${tid}"]`
              : el.tagName.toLowerCase(),
            animationName: cs.animationName,
            durationSec: dur,
          });
        }
      }
    }

    const blurredLyricLines: Array<{ selector: string; filter: string }> = [];
    const lyricsContainer = document.querySelector(
      '[data-testid="synced-lyrics-view"]'
    );
    if (lyricsContainer) {
      for (const el of Array.from(lyricsContainer.querySelectorAll('*'))) {
        const cs = window.getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        if (getBlurPx(cs.filter) > 0) {
          blurredLyricLines.push({
            selector: el.tagName.toLowerCase(),
            filter: cs.filter,
          });
        }
      }
    }

    return {
      mediaQueryMatches,
      runningInfiniteAnimations,
      blurredLyricLines,
    };
  });
}

export async function assertReducedMotion(
  page: Page
): Promise<ReducedMotionAuditReport> {
  const report = await auditReducedMotion(page);
  expect(
    report.runningInfiniteAnimations,
    `Infinite animations must stop under prefers-reduced-motion:\n${JSON.stringify(report.runningInfiniteAnimations, null, 2)}`
  ).toEqual([]);
  expect(
    report.blurredLyricLines,
    `Inactive synced lyric lines must disable CSS filter blur under prefers-reduced-motion:\n${JSON.stringify(report.blurredLyricLines, null, 2)}`
  ).toEqual([]);
  return report;
}

export async function auditReducedTransparency(
  page: Page,
  options?: ReducedTransparencyAuditOptions
): Promise<ReducedTransparencyAuditReport> {
  return page.evaluate((opts) => {
    const minOpaqueAlpha = opts?.minOpaqueAlpha ?? 0.95;
    const mediaQueryMatches = window.matchMedia(
      '(prefers-reduced-transparency: reduce)'
    ).matches;

    function getBlurPx(bf: string | null | undefined): number {
      if (!bf || bf === 'none') return 0;
      let max = 0;
      const re = /blur\(\s*([0-9.]+)px\s*\)/gi;
      let m: RegExpExecArray | null;
      while ((m = re.exec(bf)) !== null) {
        const v = Number.parseFloat(m[1] ?? '');
        if (!Number.isNaN(v) && v > max) max = v;
      }
      return max;
    }

    function parseAlpha(bg: string | null | undefined): number {
      const s = (bg ?? '').trim().toLowerCase();
      if (!s || s === 'transparent' || s === 'rgba(0, 0, 0, 0)') return 0;
      const rgbaMatch = /^rgba\(([^)]+)\)$/.exec(s);
      if (rgbaMatch) {
        const parts = (rgbaMatch[1] ?? '').split(',');
        const a = Number.parseFloat((parts[3] ?? '1').trim());
        return Number.isNaN(a) ? 1 : a;
      }
      const slashMatch = /\/\s*([0-9.]+%?)\s*\)$/.exec(s);
      if (slashMatch?.[1]) {
        const tok = slashMatch[1];
        const a = tok.endsWith('%')
          ? Number.parseFloat(tok) / 100
          : Number.parseFloat(tok);
        return Number.isNaN(a) ? 1 : a;
      }
      return 1;
    }

    const chromeSelectors = [
      '[data-testid="mobile-tab-bar"]',
      '[data-testid="mobile-mini-player"]',
      '[data-testid="desktop-sidebar"]',
      '[data-testid="desktop-player-bar"]',
      '[data-testid="now-playing-sheet"]',
      '[data-testid="eq-sheet"]',
      '[data-testid="devices-sheet"]',
      '[data-testid="import-modal"]',
      '[data-surface="glass"]',
    ];

    const visited = new Set<Element>();
    const blurViolations: Array<{
      selector: string;
      testId: string | null;
      backdropFilter: string;
      blurPx: number;
    }> = [];
    const translucentViolations: Array<{
      selector: string;
      testId: string | null;
      bgAlpha: number;
    }> = [];

    for (const sel of chromeSelectors) {
      for (const el of Array.from(document.querySelectorAll(sel))) {
        if (visited.has(el)) continue;
        const cs = window.getComputedStyle(el);
        if (
          cs.display === 'none' ||
          cs.visibility === 'hidden' ||
          Number.parseFloat(cs.opacity) === 0
        ) {
          continue;
        }
        const rect = el.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) continue;
        visited.add(el);

        const tid = el.getAttribute('data-testid');
        const desc = tid
          ? `${el.tagName.toLowerCase()}[data-testid="${tid}"]`
          : el.tagName.toLowerCase();

        const bf =
          cs.backdropFilter && cs.backdropFilter !== 'none'
            ? cs.backdropFilter
            : ((cs as unknown as { webkitBackdropFilter?: string })
                .webkitBackdropFilter ?? 'none');
        const blurPx = getBlurPx(bf);
        if (blurPx > 0) {
          blurViolations.push({
            selector: desc,
            testId: tid,
            backdropFilter: bf,
            blurPx,
          });
        }

        const bgAlpha = Number(parseAlpha(cs.backgroundColor).toFixed(2));
        if (bgAlpha < minOpaqueAlpha) {
          translucentViolations.push({
            selector: desc,
            testId: tid,
            bgAlpha,
          });
        }
      }
    }

    return {
      mediaQueryMatches,
      checkedChromeCount: visited.size,
      blurViolations,
      translucentViolations,
    };
  }, options);
}

export async function assertReducedTransparency(
  page: Page,
  options?: ReducedTransparencyAuditOptions
): Promise<ReducedTransparencyAuditReport> {
  const report = await auditReducedTransparency(page, options);
  if (options?.requireMediaQuery) {
    expect(
      report.mediaQueryMatches,
      'Expected prefers-reduced-transparency: reduce media query to match'
    ).toBe(true);
  }
  expect(
    report.checkedChromeCount,
    'Reduced transparency audit found 0 visible chrome surfaces'
  ).toBeGreaterThan(0);
  expect(
    report.blurViolations,
    `Active backdrop-filter blur must be 0px in reduced transparency / Modo ahorro gráfico:\n${JSON.stringify(report.blurViolations, null, 2)}`
  ).toEqual([]);
  expect(
    report.translucentViolations,
    `Chrome surfaces must become solid opaque (>=0.95 alpha) in reduced transparency:\n${JSON.stringify(report.translucentViolations, null, 2)}`
  ).toEqual([]);
  return report;
}

export async function auditIncreasedContrast(
  page: Page,
  options?: IncreasedContrastAuditOptions
): Promise<IncreasedContrastAuditReport> {
  const contrastReport = await auditContrast(page);
  const chromeEval = await page.evaluate(() => {
    const mediaQueryMatches = window.matchMedia(
      '(prefers-contrast: more)'
    ).matches;
    const forcedColorsMatches = window.matchMedia(
      '(forced-colors: active)'
    ).matches;

    function parseAlpha(bg: string | null | undefined): number {
      const s = (bg ?? '').trim().toLowerCase();
      if (!s || s === 'transparent' || s === 'rgba(0, 0, 0, 0)') return 0;
      const rgbaMatch = /^rgba\(([^)]+)\)$/.exec(s);
      if (rgbaMatch) {
        const parts = (rgbaMatch[1] ?? '').split(',');
        const a = Number.parseFloat((parts[3] ?? '1').trim());
        return Number.isNaN(a) ? 1 : a;
      }
      const slashMatch = /\/\s*([0-9.]+%?)\s*\)$/.exec(s);
      if (slashMatch?.[1]) {
        const tok = slashMatch[1];
        const a = tok.endsWith('%')
          ? Number.parseFloat(tok) / 100
          : Number.parseFloat(tok);
        return Number.isNaN(a) ? 1 : a;
      }
      return 1;
    }

    const chromeSelectors = [
      '[data-testid="mobile-tab-bar"]',
      '[data-testid="mobile-mini-player"]',
      '[data-testid="desktop-sidebar"]',
      '[data-testid="desktop-player-bar"]',
      '[role="dialog"]',
    ];

    let chromeCheckedCount = 0;
    const weakChromeBordersOrFills: Array<{
      selector: string;
      testId: string | null;
      bgAlpha: number;
      borderAlpha: number;
    }> = [];

    for (const sel of chromeSelectors) {
      for (const el of Array.from(document.querySelectorAll(sel))) {
        const cs = window.getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        const rect = el.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) continue;

        chromeCheckedCount++;
        const bgAlpha = Number(parseAlpha(cs.backgroundColor).toFixed(2));
        const borderAlpha = Number(
          Math.max(
            parseAlpha(cs.borderTopColor),
            parseAlpha(cs.borderColor),
            parseAlpha(cs.outlineColor)
          ).toFixed(2)
        );

        if (!forcedColorsMatches && bgAlpha < 0.85 && borderAlpha < 0.22) {
          const tid = el.getAttribute('data-testid');
          weakChromeBordersOrFills.push({
            selector: tid
              ? `${el.tagName.toLowerCase()}[data-testid="${tid}"]`
              : el.tagName.toLowerCase(),
            testId: tid,
            bgAlpha,
            borderAlpha,
          });
        }
      }
    }

    return {
      mediaQueryMatches,
      forcedColorsMatches,
      chromeCheckedCount,
      weakChromeBordersOrFills,
    };
  });

  return {
    ...chromeEval,
    contrastReport,
    ...(options ? {} : {}),
  };
}

export async function assertIncreasedContrast(
  page: Page,
  options?: IncreasedContrastAuditOptions
): Promise<IncreasedContrastAuditReport> {
  const report = await auditIncreasedContrast(page, options);
  expect(
    report.contrastReport.checkedCount,
    'Increased contrast audit found 0 visible text nodes'
  ).toBeGreaterThan(0);
  expect(
    report.contrastReport.violations,
    `WCAG contrast violations under prefers-contrast: more:\n${JSON.stringify(report.contrastReport.violations, null, 2)}`
  ).toEqual([]);
  expect(
    report.weakChromeBordersOrFills,
    `Glass chrome borders/fills must strengthen under prefers-contrast: more:\n${JSON.stringify(report.weakChromeBordersOrFills, null, 2)}`
  ).toEqual([]);
  return report;
}

export async function auditIconButtonAriaLabels(
  page: Page,
  options?: AriaAuditOptions
): Promise<AriaAuditReport> {
  return page.evaluate((opts) => {
    const root = document.querySelector(opts?.rootSelector ?? 'body');
    if (!root) {
      return {
        iconButtonsChecked: 0,
        missingIconLabels: [],
        slidersChecked: 0,
        sliderViolations: [],
        tabsChecked: 0,
        tabViolations: [],
      };
    }

    function isVisible(el: Element): boolean {
      const cs = window.getComputedStyle(el);
      if (
        cs.display === 'none' ||
        cs.visibility === 'hidden' ||
        Number.parseFloat(cs.opacity) === 0
      ) {
        return false;
      }
      if (el.closest('[aria-hidden="true"]')) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }

    function hasAccessibleName(el: Element): boolean {
      const ariaLabel = (el.getAttribute('aria-label') ?? '').trim();
      if (ariaLabel.length > 0) return true;
      const labelledBy = (el.getAttribute('aria-labelledby') ?? '').trim();
      if (labelledBy) {
        const refText = labelledBy
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent?.trim() ?? '')
          .join(' ')
          .trim();
        if (refText.length > 0) return true;
      }
      const title = (el.getAttribute('title') ?? '').trim();
      if (title.length > 0) return true;
      const text = ((el as HTMLElement).innerText ?? el.textContent ?? '').trim();
      if (text.length > 0) return true;
      const imgAlt = el.querySelector('img[alt]')?.getAttribute('alt')?.trim();
      if (imgAlt) return true;
      const svgTitle = el.querySelector('svg title')?.textContent?.trim();
      if (svgTitle) return true;
      return false;
    }

    const missingIconLabels: Array<{
      selector: string;
      testId: string | null;
      tag: string;
    }> = [];
    let iconButtonsChecked = 0;

    for (const el of Array.from(
      root.querySelectorAll('button, [role="button"], a[href]')
    )) {
      if (!isVisible(el)) continue;
      iconButtonsChecked++;
      if (!hasAccessibleName(el)) {
        const tid = el.getAttribute('data-testid');
        missingIconLabels.push({
          selector: tid
            ? `${el.tagName.toLowerCase()}[data-testid="${tid}"]`
            : el.tagName.toLowerCase(),
          testId: tid,
          tag: el.tagName.toLowerCase(),
        });
      }
    }

    const sliderViolations: Array<{
      selector: string;
      testId: string | null;
      missing: string[];
    }> = [];
    let slidersChecked = 0;

    for (const el of Array.from(
      root.querySelectorAll('[role="slider"], input[type="range"]')
    )) {
      if (!isVisible(el)) continue;
      slidersChecked++;
      const missing: string[] = [];
      if (!hasAccessibleName(el)) {
        missing.push('aria-label');
      }
      const isNativeRange =
        el.tagName.toLowerCase() === 'input' &&
        (el as HTMLInputElement).type === 'range';
      const hasMin =
        el.hasAttribute('aria-valuemin') || (isNativeRange && el.hasAttribute('min'));
      const hasMax =
        el.hasAttribute('aria-valuemax') || (isNativeRange && el.hasAttribute('max'));
      const hasNow =
        el.hasAttribute('aria-valuenow') ||
        (isNativeRange && (el as HTMLInputElement).value !== '');
      if (!hasMin) missing.push('aria-valuemin');
      if (!hasMax) missing.push('aria-valuemax');
      if (!hasNow) missing.push('aria-valuenow');

      if (missing.length > 0) {
        const tid = el.getAttribute('data-testid');
        sliderViolations.push({
          selector: tid
            ? `${el.tagName.toLowerCase()}[data-testid="${tid}"]`
            : el.tagName.toLowerCase(),
          testId: tid,
          missing,
        });
      }
    }

    const tabViolations: Array<{
      selector: string;
      testId: string | null;
      reason: string;
    }> = [];
    let tabsChecked = 0;

    for (const el of Array.from(root.querySelectorAll('[role="tab"]'))) {
      if (!isVisible(el)) continue;
      tabsChecked++;
      const ariaSel = el.getAttribute('aria-selected');
      const ariaCurr = el.getAttribute('aria-current');
      if (
        ariaSel !== 'true' &&
        ariaSel !== 'false' &&
        ariaCurr !== 'page' &&
        ariaCurr !== 'true'
      ) {
        const tid = el.getAttribute('data-testid');
        tabViolations.push({
          selector: tid
            ? `${el.tagName.toLowerCase()}[data-testid="${tid}"]`
            : el.tagName.toLowerCase(),
          testId: tid,
          reason: 'missing aria-selected or aria-current on [role="tab"]',
        });
      }
    }

    return {
      iconButtonsChecked,
      missingIconLabels,
      slidersChecked,
      sliderViolations,
      tabsChecked,
      tabViolations,
    };
  }, options);
}

export async function assertIconButtonAriaLabels(
  page: Page,
  options?: AriaAuditOptions
): Promise<AriaAuditReport> {
  const report = await auditIconButtonAriaLabels(page, options);
  expect(
    report.iconButtonsChecked,
    'ARIA audit found 0 visible buttons/links'
  ).toBeGreaterThan(0);
  expect(
    report.missingIconLabels,
    `Buttons/links missing accessible name (aria-label):\n${JSON.stringify(report.missingIconLabels, null, 2)}`
  ).toEqual([]);
  expect(
    report.sliderViolations,
    `Sliders missing ARIA range attributes:\n${JSON.stringify(report.sliderViolations, null, 2)}`
  ).toEqual([]);
  expect(
    report.tabViolations,
    `Tabs missing aria-selected / aria-current:\n${JSON.stringify(report.tabViolations, null, 2)}`
  ).toEqual([]);
  return report;
}

export async function auditSingleSheetRule(
  page: Page
): Promise<SingleSheetAuditReport> {
  return page.evaluate(() => {
    const dialogs: Array<{
      selector: string;
      testId: string | null;
      ariaLabel: string | null;
    }> = [];

    for (const el of Array.from(
      document.querySelectorAll('[role="dialog"], [role="alertdialog"]')
    )) {
      const cs = window.getComputedStyle(el);
      if (
        cs.display === 'none' ||
        cs.visibility === 'hidden' ||
        Number.parseFloat(cs.opacity) === 0
      ) {
        continue;
      }
      if (el.getAttribute('aria-hidden') === 'true') continue;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;

      const tid = el.getAttribute('data-testid');
      dialogs.push({
        selector: tid
          ? `${el.tagName.toLowerCase()}[data-testid="${tid}"]`
          : el.tagName.toLowerCase(),
        testId: tid,
        ariaLabel: el.getAttribute('aria-label'),
      });
    }

    return {
      visibleDialogCount: dialogs.length,
      dialogs,
    };
  });
}

export async function assertSingleSheetRule(
  page: Page
): Promise<SingleSheetAuditReport> {
  const report = await auditSingleSheetRule(page);
  expect(
    report.visibleDialogCount,
    `Single-sheet rule violated: found ${report.visibleDialogCount} simultaneous visible [role="dialog"] elements:\n${JSON.stringify(report.dialogs, null, 2)}`
  ).toBeLessThanOrEqual(1);
  return report;
}

export async function auditNoHorizontalOverflow(
  page: Page
): Promise<OverflowAuditReport> {
  return page.evaluate(() => {
    const innerWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const docScrollWidth = document.documentElement.scrollWidth;
    const bodyScrollWidth = document.body ? document.body.scrollWidth : 0;
    const hasOverflow =
      docScrollWidth > innerWidth + 1 || bodyScrollWidth > innerWidth + 1;

    const offendingElements: Array<{
      selector: string;
      testId: string | null;
      right: number;
      overflowPx: number;
    }> = [];

    if (hasOverflow) {
      for (const el of Array.from(document.querySelectorAll('*'))) {
        const cs = window.getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) continue;
        if (r.right > innerWidth + 1.5) {
          // Check if inside an intentional horizontal scroll container
          let insideScrollable = false;
          let p = el.parentElement;
          while (p && p !== document.body && p !== document.documentElement) {
            const pcs = window.getComputedStyle(p);
            if (
              pcs.overflowX === 'auto' ||
              pcs.overflowX === 'scroll' ||
              pcs.overflowX === 'hidden' ||
              pcs.overflowX === 'clip'
            ) {
              insideScrollable = true;
              break;
            }
            p = p.parentElement;
          }
          if (!insideScrollable && offendingElements.length < 10) {
            const tid = el.getAttribute('data-testid');
            offendingElements.push({
              selector: tid
                ? `${el.tagName.toLowerCase()}[data-testid="${tid}"]`
                : el.tagName.toLowerCase(),
              testId: tid,
              right: Number(r.right.toFixed(1)),
              overflowPx: Number((r.right - innerWidth).toFixed(1)),
            });
          }
        }
      }
    }

    return {
      viewportWidth: innerWidth,
      viewportHeight,
      innerWidth,
      documentScrollWidth: docScrollWidth,
      bodyScrollWidth,
      hasOverflow,
      offendingElements,
    };
  });
}

export async function assertNoHorizontalOverflow(
  page: Page
): Promise<OverflowAuditReport> {
  const report = await auditNoHorizontalOverflow(page);
  expect(
    report.documentScrollWidth,
    `Horizontal overflow at ${report.viewportWidth}x${report.viewportHeight} (scrollWidth=${report.documentScrollWidth}):\n${JSON.stringify(report.offendingElements, null, 2)}`
  ).toBeLessThanOrEqual(report.innerWidth + 1);
  expect(report.bodyScrollWidth).toBeLessThanOrEqual(report.innerWidth + 1);
  return report;
}

export async function assertNoHorizontalOverflowAtViewports(
  page: Page,
  viewports: ReadonlyArray<{ width: number; height: number }> = [
    { width: 360, height: 800 },
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 960, height: 700 },
    { width: 1440, height: 900 },
  ]
): Promise<OverflowAuditReport[]> {
  const originalSize = page.viewportSize();
  const reports: OverflowAuditReport[] = [];

  try {
    for (const vp of viewports) {
      await page.setViewportSize(vp);
      await page.evaluate(
        () =>
          new Promise<void>((r) =>
            requestAnimationFrame(() => requestAnimationFrame(() => r()))
          )
      );
      const report = await assertNoHorizontalOverflow(page);
      reports.push(report);
    }
  } finally {
    if (originalSize) {
      await page.setViewportSize(originalSize);
    }
  }

  return reports;
}

export async function auditZeroLinerDom(page: Page): Promise<ZeroLinerAuditReport> {
  return page.evaluate(() => {
    const re = /\b(?:tryliner|liner-signer|feralbureau|liner)\b/i;
    const matches: Array<{ location: string; snippet: string }> = [];
    let scannedCount = 0;

    function checkText(loc: string, val: string | null | undefined): void {
      if (!val) return;
      scannedCount++;
      const m = re.exec(val);
      if (m) {
        matches.push({
          location: loc,
          snippet: val.slice(Math.max(0, m.index - 20), m.index + 40),
        });
      }
    }

    checkText('document.title', document.title);
    checkText('document.body.innerText', document.body?.innerText ?? '');

    for (const el of Array.from(
      document.querySelectorAll(
        '[aria-label], [title], img[alt], img[src], meta[content], link[href]'
      )
    )) {
      const tag = el.tagName.toLowerCase();
      checkText(`${tag}[aria-label]`, el.getAttribute('aria-label'));
      checkText(`${tag}[title]`, el.getAttribute('title'));
      checkText(`${tag}[alt]`, el.getAttribute('alt'));
      checkText(`${tag}[src]`, el.getAttribute('src'));
      checkText(`${tag}[content]`, el.getAttribute('content'));
      checkText(`${tag}[href]`, el.getAttribute('href'));
    }

    return {
      scannedCount,
      matches,
    };
  });
}

export async function assertZeroLinerDom(
  page: Page
): Promise<ZeroLinerAuditReport> {
  const report = await auditZeroLinerDom(page);
  expect(
    report.scannedCount,
    'Zero-Liner DOM audit scanned 0 nodes'
  ).toBeGreaterThan(0);
  expect(
    report.matches,
    `Forbidden Liner branding/references found in rendered DOM:\n${JSON.stringify(report.matches, null, 2)}`
  ).toEqual([]);
  return report;
}

const TEXT_FILE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '.css',
  '.html',
  '.md',
  '.sql',
  '.yml',
  '.yaml',
  '.xml',
  '.java',
  '.gradle',
  '.properties',
  '.svg',
]);

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'e2e',
  'apple-design-skill',
  'playwright-report',
  'test-results',
  '.gradle',
  'build',
]);

export function auditZeroLinerSourceTree(
  repoRoot = '/home/antigravity/pMusic'
): ZeroLinerAuditReport {
  const rootPath = resolve(repoRoot);
  const matches: Array<{ location: string; snippet: string }> = [];
  let scannedCount = 0;

  const targetPaths = [
    'package.json',
    'README.md',
    '.env.example',
    'packages',
    'apps',
    'docs',
    'supabase',
    '.github',
  ];

  function scanFile(absPath: string): void {
    let st;
    try {
      st = statSync(absPath);
    } catch {
      return;
    }
    if (!st.isFile() || st.size > 2 * 1024 * 1024) return;
    const ext = extname(absPath).toLowerCase();
    const baseName = absPath.split('/').pop() ?? '';
    if (!TEXT_FILE_EXTENSIONS.has(ext) && !baseName.startsWith('.env')) {
      return;
    }

    let content: string;
    try {
      content = readFileSync(absPath, 'utf-8');
    } catch {
      return;
    }

    scannedCount++;
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';
      if (LINER_CLEANROOM_REGEX.test(line)) {
        // Allow explicit legal disclaimer mentioning clean-room zero-Liner compliance in docs/README if any,
        // wait: product code and UI must have 0 matches; check if any match exists
        matches.push({
          location: `${relative(rootPath, absPath)}:${i + 1}`,
          snippet: line.trim().slice(0, 120),
        });
      }
    }
  }

  function walk(absDir: string): void {
    let entries;
    try {
      entries = readdirSync(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const full = join(absDir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        scanFile(full);
      }
    }
  }

  for (const rel of targetPaths) {
    const abs = join(rootPath, rel);
    if (!existsSync(abs)) continue;
    const st = statSync(abs);
    if (st.isDirectory()) {
      walk(abs);
    } else if (st.isFile()) {
      scanFile(abs);
    }
  }

  return {
    scannedCount,
    matches,
  };
}

export function assertZeroLinerSourceTree(
  repoRoot = '/home/antigravity/pMusic'
): ZeroLinerAuditReport {
  const report = auditZeroLinerSourceTree(repoRoot);
  expect(
    report.scannedCount,
    'Zero-Liner source tree audit must scan at least 10 project files'
  ).toBeGreaterThanOrEqual(10);
  expect(
    report.matches,
    `Forbidden Liner references found in pMusic source tree:\n${JSON.stringify(report.matches, null, 2)}`
  ).toEqual([]);
  return report;
}
