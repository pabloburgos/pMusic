export function normalizeArtistKey(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[\u00A0\s]+/g, ' ')
    .trim();
}

const NOISE_PHRASE_STICKY_RE =
  /(?:official\s+(?:music\s+|lyric\s+|lyrics\s+|hd\s+|4k\s+|uhd\s+)?(?:video|audio|visualizer|m\/v|mv)|(?:v[ií]deo|audio)\s+(?:musical\s+)?oficial|oficial\s+(?:v[ií]deo|audio)|(?:v[ií]deo\s*clip|videoclip)(?:\s+oficial)?|(?:v[ií]deo\s+)?lyrics?(?:\s+v[ií]deo)?|(?:con\s+)?letras?|visualiz(?:er|ador)|m\/v|mv|4k|uhd|hd|hq|1080p|720p|60fps)(?=$|[\s|•,/·+–—-])/iy;

const EXPLICIT_TRAILING_NOISE_RE =
  /^(?:official\s+(?:music\s+|lyric\s+|lyrics\s+|hd\s+|4k\s+|uhd\s+)?(?:video|audio|visualizer|m\/v|mv)|(?:v[ií]deo|audio)\s+(?:musical\s+)?oficial|oficial\s+(?:v[ií]deo|audio)|(?:v[ií]deo\s*clip|videoclip)(?:\s+oficial)?|(?:v[ií]deo\s+)?lyrics?\s+v[ií]deo|v[ií]deo\s+lyrics?|visualiz(?:er|ador)|prod(?:\.\s*|\s+)(?:by\s+)?\S.*)$/i;

const PROD_CREDIT_RE = /^prod(?:\.\s*|\s+)(?:by\s+)?\S/i;
const BRACKET_BLOCK_RE = /\s*(?:\(([^()]*)\)|\[([^\[\]]*)\]|（([^（）]*)）|【([^【】]*)】)/g;
const TRAILING_SEP_RE = /^(.*)\s+[-–—|•·/]\s+([^-–—|•·/]+)$/;

function isNoiseChunk(chunk: string): boolean {
  const s = chunk.trim();
  if (!s) return false;
  if (PROD_CREDIT_RE.test(s)) return true;

  let pos = 0;
  let matchedAny = false;
  while (pos < s.length) {
    while (pos < s.length && /[\s|•,/·+–—-]/.test(s[pos]!)) {
      pos += 1;
    }
    if (pos >= s.length) break;
    NOISE_PHRASE_STICKY_RE.lastIndex = pos;
    const match = NOISE_PHRASE_STICKY_RE.exec(s);
    if (!match) return false;
    matchedAny = true;
    pos = NOISE_PHRASE_STICKY_RE.lastIndex;
  }
  return matchedAny;
}

function isNoiseBracketContent(inner: string): boolean {
  const trimmed = inner.trim();
  if (!trimmed) return false;
  if (PROD_CREDIT_RE.test(trimmed)) return true;
  const parts = trimmed.split(/\s*(?:[|•·/]|\s+[-–—+]\s+)\s*/);
  return parts.length > 0 && parts.every((p) => p.length > 0 && isNoiseChunk(p));
}

export function sanitizeTrackTitle(title: string): string {
  const normalized = title.replace(/[\u00A0\s]+/g, ' ').trim();
  if (!normalized) return '';

  let result = normalized;
  let prev: string;
  do {
    prev = result;
    result = result.replace(
      BRACKET_BLOCK_RE,
      (full: string, p1?: string, p2?: string, p3?: string, p4?: string) => {
        const inner = p1 ?? p2 ?? p3 ?? p4 ?? '';
        return isNoiseBracketContent(inner) ? ' ' : full;
      }
    );
    result = result.replace(/\s+/g, ' ').trim();

    const sepMatch = TRAILING_SEP_RE.exec(result);
    if (sepMatch && sepMatch[1] !== undefined && sepMatch[2] !== undefined) {
      if (EXPLICIT_TRAILING_NOISE_RE.test(sepMatch[2].trim())) {
        result = sepMatch[1].trim();
      }
    }

    result = result.replace(/\s+[-–—|•·/]\s*$/, '').trim();
  } while (result !== prev);

  return result.length > 0 ? result : normalized;
}

export const stripTrackTitleNoise = sanitizeTrackTitle;

export function normalizeSearchText(text: string): string {
  return normalizeArtistKey(text);
}

