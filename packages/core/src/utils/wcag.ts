export interface RgbColor {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

export interface RgbaColor extends RgbColor {
  readonly a: number;
}

export type ColorInput = string | RgbColor | RgbaColor;

export interface WcagAAOptions {
  /** Large text (>= 18pt / 24px regular or >= 14pt / 18.67px bold) or graphical UI components: 3.0:1 instead of 4.5:1 */
  readonly largeText?: boolean;
}

export const WCAG_SRGB_LINEAR_THRESHOLD = 0.04045;
export const WCAG_AA_NORMAL_RATIO = 4.5;
export const WCAG_AA_LARGE_RATIO = 3.0;
export const WCAG_AAA_NORMAL_RATIO = 7.0;

const HEX_COLOR_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const RGBA_FUNC_RE = /^(rgba?)\(\s*([^)]+)\s*\)$/i;
const STRICT_DECIMAL_RE = /^(?:\d+(?:\.\d+)?|\.\d+)$/;
const STRICT_ALPHA_RE = /^(?:\d+(?:\.\d+)?|\.\d+)%?$/;

export function parseHexColor(hex: string): RgbColor {
  if (typeof hex !== 'string') {
    throw new RangeError('Invalid hex color: expected string');
  }
  const trimmed = hex.trim();
  const match = HEX_COLOR_RE.exec(trimmed);
  if (!match || !match[1]) {
    throw new RangeError(`Invalid hex color: "${hex}"`);
  }
  const digits = match[1];
  if (digits.length === 3) {
    const r = Number.parseInt(digits[0]! + digits[0]!, 16);
    const g = Number.parseInt(digits[1]! + digits[1]!, 16);
    const b = Number.parseInt(digits[2]! + digits[2]!, 16);
    return { r, g, b };
  }
  const r = Number.parseInt(digits.slice(0, 2), 16);
  const g = Number.parseInt(digits.slice(2, 4), 16);
  const b = Number.parseInt(digits.slice(4, 6), 16);
  return { r, g, b };
}

function parseRgbChannel(raw: string): number {
  const s = raw.trim();
  if (!STRICT_DECIMAL_RE.test(s)) {
    throw new RangeError(`Invalid RGB channel value: "${raw}"`);
  }
  const value = Number(s);
  if (!Number.isFinite(value) || value < 0 || value > 255) {
    throw new RangeError(`RGB channel out of [0, 255] range: "${raw}"`);
  }
  return value;
}

function parseAlphaChannel(raw: string): number {
  const s = raw.trim();
  if (!STRICT_ALPHA_RE.test(s)) {
    throw new RangeError(`Invalid alpha channel value: "${raw}"`);
  }
  if (s.endsWith('%')) {
    const pct = Number(s.slice(0, -1));
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      throw new RangeError(`Percentage alpha out of [0%, 100%] range: "${raw}"`);
    }
    return pct / 100;
  }
  const value = Number(s);
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`Alpha channel out of [0, 1] range: "${raw}"`);
  }
  return value;
}

export function parseRgbaColor(rgba: string): RgbaColor {
  if (typeof rgba !== 'string') {
    throw new RangeError('Invalid rgb/rgba color: expected string');
  }
  const trimmed = rgba.trim();
  const match = RGBA_FUNC_RE.exec(trimmed);
  if (!match || !match[1] || !match[2]) {
    throw new RangeError(`Invalid rgb/rgba color syntax: "${rgba}"`);
  }
  const fnName = match[1].toLowerCase();
  const body = match[2].trim();

  if (body.includes(',')) {
    if (body.includes('/')) {
      throw new RangeError(`Cannot mix comma and slash syntax in "${rgba}"`);
    }
    const parts = body.split(',');
    if (fnName === 'rgb' && parts.length === 3) {
      return {
        r: parseRgbChannel(parts[0]!),
        g: parseRgbChannel(parts[1]!),
        b: parseRgbChannel(parts[2]!),
        a: 1,
      };
    }
    if (fnName === 'rgba' && parts.length === 4) {
      return {
        r: parseRgbChannel(parts[0]!),
        g: parseRgbChannel(parts[1]!),
        b: parseRgbChannel(parts[2]!),
        a: parseAlphaChannel(parts[3]!),
      };
    }
    throw new RangeError(`Invalid argument count for ${fnName}() in "${rgba}"`);
  }

  // CSS Color 4 space / slash syntax
  const slashParts = body.split('/');
  if (slashParts.length > 2) {
    throw new RangeError(`Multiple slashes in rgb/rgba color: "${rgba}"`);
  }
  const rgbTokens = slashParts[0]!.trim().split(/\s+/);
  if (rgbTokens.length !== 3) {
    throw new RangeError(`Expected 3 RGB channels in "${rgba}"`);
  }
  const r = parseRgbChannel(rgbTokens[0]!);
  const g = parseRgbChannel(rgbTokens[1]!);
  const b = parseRgbChannel(rgbTokens[2]!);

  if (slashParts.length === 2) {
    const alphaRaw = slashParts[1]!.trim();
    if (!alphaRaw || /\s/.test(alphaRaw)) {
      throw new RangeError(`Invalid slash alpha in "${rgba}"`);
    }
    return { r, g, b, a: parseAlphaChannel(alphaRaw) };
  }

  if (fnName === 'rgba') {
    throw new RangeError(`rgba() requires an explicit alpha channel in "${rgba}"`);
  }
  return { r, g, b, a: 1 };
}

function validateChannel255(value: number, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 255) {
    throw new RangeError(`Invalid ${label} channel: ${String(value)}`);
  }
  return value;
}

function validateAlpha01(value: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`Invalid alpha channel: ${String(value)}`);
  }
  return value;
}

function resolveColorInput(input: ColorInput): RgbaColor {
  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (trimmed.startsWith('#')) {
      const rgb = parseHexColor(trimmed);
      return { ...rgb, a: 1 };
    }
    return parseRgbaColor(trimmed);
  }
  if (input !== null && typeof input === 'object') {
    const r = validateChannel255(input.r, 'r');
    const g = validateChannel255(input.g, 'g');
    const b = validateChannel255(input.b, 'b');
    const a =
      'a' in input && (input as { a?: unknown }).a !== undefined
        ? validateAlpha01((input as RgbaColor).a)
        : 1;
    return { r, g, b, a };
  }
  throw new RangeError('Invalid color input');
}

function toHexByte(channel255: number): string {
  const clamped = Math.min(255, Math.max(0, Math.round(channel255)));
  return clamped.toString(16).padStart(2, '0').toUpperCase();
}

export function compositeOverHex(foreground: string | RgbaColor, backgroundHex: string): string {
  const fg = resolveColorInput(foreground);
  const bg = parseHexColor(backgroundHex);
  const r = Math.round(fg.r * fg.a + bg.r * (1 - fg.a) + 1e-12);
  const g = Math.round(fg.g * fg.a + bg.g * (1 - fg.a) + 1e-12);
  const b = Math.round(fg.b * fg.a + bg.b * (1 - fg.a) + 1e-12);
  return `#${toHexByte(r)}${toHexByte(g)}${toHexByte(b)}`;
}

function linearizeSrgbChannel(channel255: number): number {
  const s = channel255 / 255;
  return s <= WCAG_SRGB_LINEAR_THRESHOLD ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(color: ColorInput): number {
  const resolved = resolveColorInput(color);
  if (resolved.a < 1) {
    throw new RangeError(
      'Translucent color (alpha < 1) has no standalone relative luminance; composite over an opaque background first.'
    );
  }
  const R = linearizeSrgbChannel(resolved.r);
  const G = linearizeSrgbChannel(resolved.g);
  const B = linearizeSrgbChannel(resolved.b);
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

export function wcagContrastRatio(foreground: ColorInput, background: ColorInput): number {
  const bg = resolveColorInput(background);
  if (bg.a < 1) {
    throw new RangeError(
      'Background color in wcagContrastRatio must be opaque (alpha === 1); composite translucent backgrounds over an opaque backdrop first.'
    );
  }
  const fg = resolveColorInput(foreground);
  const effectiveFg: RgbColor =
    fg.a < 1
      ? {
          r: fg.r * fg.a + bg.r * (1 - fg.a),
          g: fg.g * fg.a + bg.g * (1 - fg.a),
          b: fg.b * fg.a + bg.b * (1 - fg.a),
        }
      : { r: fg.r, g: fg.g, b: fg.b };

  const l1 = relativeLuminance(effectiveFg);
  const l2 = relativeLuminance({ r: bg.r, g: bg.g, b: bg.b });
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

export function meetsWcagAA(
  foreground: ColorInput,
  background: ColorInput,
  options?: WcagAAOptions
): boolean {
  const minRatio = options?.largeText ? WCAG_AA_LARGE_RATIO : WCAG_AA_NORMAL_RATIO;
  return wcagContrastRatio(foreground, background) >= minRatio;
}
