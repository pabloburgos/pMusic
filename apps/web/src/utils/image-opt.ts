export type ArtworkSlot = 'row' | 'card' | 'avatar' | 'banner' | 'nowplaying';

interface NetworkInfoLike {
  saveData?: boolean;
  effectiveType?: string;
  type?: string;
}

/**
 * Returns true when running on cellular / bandwidth-constrained connections or mobile viewports
 * so artwork fetches request crisp, lightweight dimensions instead of heavy 1000x1000+ assets.
 */
export function isConstrainedNetwork(): boolean {
  if (typeof navigator !== 'undefined') {
    const conn = (navigator as unknown as { connection?: NetworkInfoLike }).connection;
    if (conn) {
      if (conn.saveData) return true;
      if (conn.effectiveType && ['slow-2g', '2g', '3g'].includes(conn.effectiveType)) {
        return true;
      }
      if (conn.type === 'cellular') return true;
    }
  }
  if (typeof window !== 'undefined' && window.innerWidth > 0 && window.innerWidth < 768) {
    return true;
  }
  return false;
}

const DEEZER_IMG_RE =
  /^(https?:\/\/[^/]*dzcdn\.net\/images\/[^/]+\/[^/]+\/)(\d+x\d+-\d+-\d+-\d+-\d+)\.(jpg|jpeg|png|webp)(\?.*)?$/i;
const GOOGLE_IMG_RE =
  /^(https?:\/\/[^/]*(?:googleusercontent\.com|ggpht\.com)\/[^\s=]+)=([a-z0-9-]+)(\?.*)?$/i;

/**
 * Rewrites Deezer and Google/YouTube Music CDN artwork URLs to fit the target UI slot
 * and current network conditions while leaving non-CDN URLs (data:, blob:, /api/*) untouched.
 */
export function optimizeArtworkUrl(
  rawUrl: string | null | undefined,
  slot: ArtworkSlot,
  forceConstrained?: boolean
): string {
  const clean = (rawUrl ?? '').trim();
  if (
    !clean ||
    clean.startsWith('data:') ||
    clean.startsWith('blob:') ||
    clean.startsWith('/')
  ) {
    return clean;
  }

  const constrained = forceConstrained ?? isConstrainedNetwork();

  const dzMatch = clean.match(DEEZER_IMG_RE);
  if (dzMatch) {
    const prefix = dzMatch[1]!;
    const ext = dzMatch[3]!;
    const query = dzMatch[4] ?? '';
    let spec: string;
    if (slot === 'row') {
      spec = '120x120-000000-75-0-0';
    } else if (slot === 'card' || slot === 'avatar') {
      spec = constrained ? '250x250-000000-80-0-0' : '500x500-000000-80-0-0';
    } else if (slot === 'banner') {
      spec = constrained ? '500x500-000000-80-0-0' : '1000x1000-000000-80-0-0';
    } else {
      spec = constrained ? '500x500-000000-85-0-0' : '1000x1000-000000-80-0-0';
    }
    return `${prefix}${spec}.${ext}${query}`;
  }

  const gMatch = clean.match(GOOGLE_IMG_RE);
  if (gMatch) {
    const base = gMatch[1]!;
    const query = gMatch[3] ?? '';
    let param: string;
    if (slot === 'row') {
      param = 'w120-h120-l80-rj';
    } else if (slot === 'card' || slot === 'avatar') {
      param = constrained ? 'w300-h300-l80-rj' : 'w544-h544-l90-rj';
    } else if (slot === 'banner') {
      param = constrained ? 'w800-h400-p-l80-rj' : 'w1440-h600-p-l90-rj';
    } else {
      param = constrained ? 'w640-h640-l85-rj' : 'w1000-h1000-l90-rj';
    }
    return `${base}=${param}${query}`;
  }

  return clean;
}
