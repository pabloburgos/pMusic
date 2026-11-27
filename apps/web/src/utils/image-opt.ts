export type ArtworkSlot = 'thumb' | 'row' | 'card' | 'avatar' | 'banner' | 'nowplaying';

interface NetworkInfoLike {
  saveData?: boolean;
  effectiveType?: string;
  type?: string;
  downlink?: number;
  rtt?: number;
}

let dataSaverEnabled = false;

export function setDataSaverMode(enabled: boolean): void {
  dataSaverEnabled = Boolean(enabled);
}

export function isDataSaverMode(): boolean {
  return dataSaverEnabled;
}

/**
 * Returns true when running on cellular / bandwidth-constrained connections or metered Android
 * networks so artwork fetches request crisp, lightweight dimensions instead of heavy 1000x1000+ assets.
 */
export function isConstrainedNetwork(): boolean {
  if (dataSaverEnabled) return true;
  if (typeof window !== 'undefined') {
    try {
      const bridge = (window as unknown as {
        PMusicNative?: { isMeteredNetwork?: () => boolean };
      }).PMusicNative;
      if (typeof bridge?.isMeteredNetwork === 'function' && bridge.isMeteredNetwork()) {
        return true;
      }
    } catch {
      // ignore native bridge error
    }
  }
  if (typeof navigator !== 'undefined') {
    const conn = (navigator as unknown as { connection?: NetworkInfoLike }).connection;
    if (conn) {
      if (conn.saveData) return true;
      if (conn.type === 'cellular') return true;
      if (conn.effectiveType && ['slow-2g', '2g', '3g'].includes(conn.effectiveType)) {
        return true;
      }
      if (typeof conn.downlink === 'number' && conn.downlink > 0 && conn.downlink < 4) {
        return true;
      }
      if (typeof conn.rtt === 'number' && conn.rtt >= 200) {
        return true;
      }
    }
  }
  return false;
}

function isMobileCompactViewport(): boolean {
  return typeof window !== 'undefined' && window.innerWidth > 0 && window.innerWidth < 768;
}

const DEEZER_IMG_RE =
  /^(https?:\/\/[^/]*dzcdn\.net\/images\/[^/]+\/[^/]+\/)(\d+x\d+(?:-\d+-\d+-\d+-\d+)?)\.(jpg|jpeg|png|webp)(\?.*)?$/i;
const DEEZER_API_IMG_RE =
  /^(https?:\/\/api\.deezer\.com\/(?:album|artist|playlist|track)\/[^/]+\/image(?:\?.*)?)size=(small|medium|big|xl)(.*)$/i;
const GOOGLE_IMG_RE =
  /^(https?:\/\/[^/]*(?:googleusercontent\.com|ggpht\.com)\/[^\s=]+)=([a-z0-9-]+)(\?.*)?$/i;
const APPLE_IMG_RE =
  /^(https?:\/\/[^/]*mzstatic\.com\/image\/thumb\/.+\/)(\d+x\d+[a-z0-9-]*)\.(jpg|jpeg|png|webp)(\?.*)?$/i;
const SPOTIFY_IMG_RE =
  /^(https?:\/\/i\.scdn\.co\/image\/)(ab67616d0000(?:4851|1e02|b273))([a-f0-9]+)(\?.*)?$/i;
const YOUTUBE_IMG_RE =
  /^(https?:\/\/(?:i|img)\.ytimg\.com\/vi\/[^/]+\/)(default|mqdefault|hqdefault|sddefault|maxresdefault)\.(jpg|webp)(\?.*)?$/i;

/**
 * Generates an ultra-lightweight (~2-4 KB) preview URL for instant progressive blur-up
 * on heavy Artist banners and Now Playing HD covers.
 */
export function getLowResPreviewUrl(rawUrl: string | null | undefined): string {
  const clean = (rawUrl ?? '').trim();
  if (
    !clean ||
    clean.startsWith('data:') ||
    clean.startsWith('blob:') ||
    clean.startsWith('/')
  ) {
    return clean;
  }

  const dzMatch = clean.match(DEEZER_IMG_RE);
  if (dzMatch) {
    return `${dzMatch[1]!}120x120-000000-75-0-0.${dzMatch[3]!}${dzMatch[4] ?? ''}`;
  }
  const gMatch = clean.match(GOOGLE_IMG_RE);
  if (gMatch) {
    return `${gMatch[1]!}=w120-h120-l70-rj${gMatch[3] ?? ''}`;
  }
  const appleMatch = clean.match(APPLE_IMG_RE);
  if (appleMatch) {
    return `${appleMatch[1]!}100x100bb.${appleMatch[3]!}${appleMatch[4] ?? ''}`;
  }
  const spMatch = clean.match(SPOTIFY_IMG_RE);
  if (spMatch) {
    return `${spMatch[1]!}ab67616d00004851${spMatch[3]!}${spMatch[4] ?? ''}`;
  }
  const ytMatch = clean.match(YOUTUBE_IMG_RE);
  if (ytMatch) {
    return `${ytMatch[1]!}mqdefault.${ytMatch[3]!}${ytMatch[4] ?? ''}`;
  }
  return clean;
}

/**
 * Rewrites Deezer, Google/YouTube Music, Apple Music, Spotify, and YouTube CDN artwork URLs
 * to sharp dimensions matching the target UI slot and network budget while leaving local/inline URLs untouched.
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

  const dataSaver = dataSaverEnabled;
  const constrained = forceConstrained ?? isConstrainedNetwork();
  const compactThumb = slot === 'thumb' && (dataSaver || constrained || isMobileCompactViewport());

  const dzMatch = clean.match(DEEZER_IMG_RE);
  if (dzMatch) {
    const prefix = dzMatch[1]!;
    const ext = dzMatch[3]!;
    const query = dzMatch[4] ?? '';
    let spec: string;
    if (slot === 'thumb') {
      spec = dataSaver
        ? '56x56-000000-75-0-0'
        : compactThumb
          ? '120x120-000000-80-0-0'
          : '250x250-000000-80-0-0';
    } else if (slot === 'row') {
      spec = dataSaver ? '56x56-000000-80-0-0' : '250x250-000000-80-0-0';
    } else if (slot === 'card' || slot === 'avatar') {
      spec = dataSaver || constrained ? '250x250-000000-80-0-0' : '500x500-000000-80-0-0';
    } else if (slot === 'banner') {
      spec = dataSaver
        ? '250x250-000000-80-0-0'
        : constrained
          ? '500x500-000000-80-0-0'
          : '1000x1000-000000-80-0-0';
    } else {
      spec = dataSaver
        ? '250x250-000000-80-0-0'
        : constrained
          ? '500x500-000000-80-0-0'
          : '1000x1000-000000-80-0-0';
    }
    return `${prefix}${spec}.${ext}${query}`;
  }

  const dzApiMatch = clean.match(DEEZER_API_IMG_RE);
  if (dzApiMatch) {
    const prefix = dzApiMatch[1]!;
    const suffix = dzApiMatch[3] ?? '';
    const sizeParam = dataSaver
      ? 'medium'
      : compactThumb
        ? 'medium'
        : constrained
          ? slot === 'nowplaying' || slot === 'banner'
            ? 'big'
            : 'medium'
          : slot === 'nowplaying' || slot === 'banner'
            ? 'xl'
            : slot === 'card' || slot === 'avatar'
              ? 'big'
              : 'medium';
    return `${prefix}size=${sizeParam}${suffix}`;
  }

  const gMatch = clean.match(GOOGLE_IMG_RE);
  if (gMatch) {
    const base = gMatch[1]!;
    const query = gMatch[3] ?? '';
    let param: string;
    if (dataSaver) {
      param =
        slot === 'thumb' || slot === 'row'
          ? 'w64-h64-l70-rj'
          : slot === 'card' || slot === 'avatar'
            ? 'w240-h240-l75-rj'
            : 'w320-h320-l75-rj';
    } else if (slot === 'thumb') {
      param = compactThumb ? 'w128-h128-l75-rj' : 'w240-h240-l85-rj';
    } else if (slot === 'row') {
      param = 'w256-h256-l85-rj';
    } else if (slot === 'card' || slot === 'avatar') {
      param = constrained ? 'w300-h300-l80-rj' : 'w544-h544-l90-rj';
    } else if (slot === 'banner') {
      param = constrained ? 'w800-h400-p-l80-rj' : 'w1440-h600-p-l90-rj';
    } else {
      param = constrained ? 'w640-h640-l85-rj' : 'w1000-h1000-l90-rj';
    }
    return `${base}=${param}${query}`;
  }

  const appleMatch = clean.match(APPLE_IMG_RE);
  if (appleMatch) {
    const prefix = appleMatch[1]!;
    const ext = appleMatch[3]!;
    const query = appleMatch[4] ?? '';
    const dim = dataSaver
      ? '200x200bb'
      : slot === 'thumb'
        ? compactThumb
          ? '140x140bb'
          : '250x250bb'
        : slot === 'nowplaying' || slot === 'banner'
          ? constrained
            ? '600x600bb'
            : '1000x1000bb'
          : slot === 'card' || slot === 'avatar'
            ? constrained
              ? '300x300bb'
              : '600x600bb'
            : '300x300bb';
    return `${prefix}${dim}.${ext}${query}`;
  }

  const spMatch = clean.match(SPOTIFY_IMG_RE);
  if (spMatch) {
    const prefix = spMatch[1]!;
    const currentHashPrefix = spMatch[2]!;
    const hashSuffix = spMatch[3]!;
    const query = spMatch[4] ?? '';
    const targetPrefix = dataSaver
      ? currentHashPrefix
      : slot === 'thumb'
        ? 'ab67616d00001e02'
        : slot === 'nowplaying' || slot === 'card' || slot === 'banner'
          ? constrained && slot === 'card'
            ? 'ab67616d00001e02'
            : 'ab67616d0000b273'
          : currentHashPrefix === 'ab67616d00004851'
            ? 'ab67616d00001e02'
            : currentHashPrefix;
    return `${prefix}${targetPrefix}${hashSuffix}${query}`;
  }

  const ytMatch = clean.match(YOUTUBE_IMG_RE);
  if (ytMatch) {
    const prefix = ytMatch[1]!;
    const currentName = ytMatch[2]!.toLowerCase();
    const ext = ytMatch[3]!;
    const query = ytMatch[4] ?? '';
    if (slot === 'thumb' && compactThumb) {
      return `${prefix}mqdefault.${ext}${query}`;
    }
    if (!dataSaver && (currentName === 'default' || currentName === 'mqdefault' || currentName === 'hqdefault')) {
      const nextName =
        slot === 'nowplaying' || (slot === 'card' && !constrained)
          ? 'sddefault'
          : 'hqdefault';
      return `${prefix}${nextName}.${ext}${query}`;
    }
  }

  return clean;
}

export function upgradeCoverUrlToHd(url?: string | null): string {
  return optimizeArtworkUrl(url, 'nowplaying', false);
}
