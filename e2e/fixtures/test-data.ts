/**
 * Canonical Spanish urban music fixture catalog (14 tracks, 8 artists, 12 albums,
 * 3 playlists), alias resolver, synced/plain/instrumental LRCLIB fixtures,
 * Spotify/YouTube import fixtures, and pure-Node 64x64 RGB PNG + SVG cover art
 * generator (`node:zlib` + IEEE 802.3 CRC32, zero external dependencies).
 *
 * Strictly opaque-box: ZERO imports from `apps/**` or `packages/**`.
 */

import { deflateSync } from 'node:zlib';
import type { RhythmPattern } from './wav-generator';

export interface MockArtistRef {
  id: string;
  name: string;
}

export interface MockAlbumRef {
  id: string;
  name: string;
}

export interface MockTrack {
  id: string;
  title: string;
  artists: MockArtistRef[];
  album?: MockAlbumRef;
  durationSec: number;
  thumbnailUrl: string;
  thumbnailHighUrl?: string;
  isExplicit?: boolean;
  source: 'ytmusic' | 'youtube' | 'offline';
  releaseYear?: number;
  genres?: string[];
  bpm?: number;
  energy?: number;
  camelotKey?: string;
}

export interface MockArtistSummary {
  id: string;
  name: string;
  thumbnailUrl: string;
  bannerUrl?: string;
  description?: string;
  subscribersText?: string;
  genres?: string[];
  isSpanishUrbanSeed?: boolean;
}

export interface MockAlbumSummary {
  id: string;
  title: string;
  artists: MockArtistRef[];
  year?: number;
  thumbnailUrl: string;
  trackCount?: number;
}

export interface MockPlaylistSummary {
  id: string;
  title: string;
  author?: string;
  description?: string;
  thumbnailUrl: string;
  trackCount: number;
}

export interface MockTopResult {
  type: 'artist' | 'track' | 'album' | 'playlist';
  track?: MockTrack;
  artist?: MockArtistSummary;
  album?: MockAlbumSummary;
  playlist?: MockPlaylistSummary;
  item?: MockTrack | MockArtistSummary | MockAlbumSummary | MockPlaylistSummary;
}

export interface MockSearchResultBundle {
  query: string;
  topResult?: MockTopResult | null;
  songs: MockTrack[];
  videos: MockTrack[];
  artists: MockArtistSummary[];
  albums: MockAlbumSummary[];
  playlists: MockPlaylistSummary[];
  continuationToken?: string | null;
}

export interface MockHomeFeedShelf {
  id: string;
  title: string;
  subtitle?: string;
  kind?:
    | 'quick_picks'
    | 'mixes'
    | 'because_you_listened'
    | 'new_releases'
    | 'tracks'
    | 'albums'
    | 'playlists';
  items: Array<MockTrack | MockAlbumSummary | MockPlaylistSummary | MockArtistSummary>;
  tracks?: MockTrack[];
  albums?: MockAlbumSummary[];
  playlists?: MockPlaylistSummary[];
}

export interface MockImportedSourceTrack {
  title: string;
  artists: string[];
  rawSubtitle?: string;
  durationSec?: number;
  album?: string;
  isrc?: string;
  matchedTrackId?: string | null;
}

export interface MockSpotifyImportPayload {
  id: string;
  kind: 'playlist' | 'album';
  name: string;
  author?: string;
  coverUrl?: string;
  sourceUrl: string;
  truncated: boolean;
  warning?: string;
  tracks: MockImportedSourceTrack[];
}

export interface MockLrclibRecord {
  id: number;
  name: string;
  trackName: string;
  artistName: string;
  albumName: string;
  duration: number;
  instrumental: boolean;
  plainLyrics: string | null;
  syncedLyrics: string | null;
}

export interface TrackAudioFixtureSpec {
  bpm: number;
  pattern: RhythmPattern;
  wavDurationSec: number;
  baseFreqHz: number;
  energy: number;
  camelotKey: string;
}

export interface TrackLyricsFixtureSpec {
  mode:
    | 'synced'
    | 'plain_only'
    | 'no_lyrics'
    | 'instrumental'
    | 'duration_mismatch_search_fallback'
    | 'yt_plain_fallback';
  syncedLyrics: string | null;
  plainLyrics: string | null;
  lrclibDurationSec?: number;
}

// ============================================================================
// Pure-Node 64x64 RGB PNG & SVG Cover Art Generator (IEEE 802.3 CRC32 + zlib)
// ============================================================================

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const crc32Table: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

export function computeCrc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    const byte = buf[i] ?? 0;
    const tableVal = crc32Table[(c ^ byte) & 0xff] ?? 0;
    c = tableVal ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makePngChunk(typeAscii: string, data: Buffer): Buffer {
  const chunk = Buffer.allocUnsafe(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  chunk.write(typeAscii, 4, 4, 'ascii');
  if (data.length > 0) {
    data.copy(chunk, 8);
  }
  const crc = computeCrc32(chunk.subarray(4, 8 + data.length));
  chunk.writeUInt32BE(crc, 8 + data.length);
  return chunk;
}

const pngCache = new Map<string, Buffer>();

/**
 * Generates a valid 8-bit Truecolor RGB PNG (`colorType = 2`) with zero external
 * dependencies. When `secondaryRgb` is omitted or equal to `primaryRgb`, every
 * pixel is strictly uniform `(r, g, b)` (e.g. `#FFFFFF` for bright scrim tests).
 */
export function generatePngBuffer(
  primaryRgb: readonly [number, number, number],
  secondaryRgb?: readonly [number, number, number],
  width = 64,
  height = 64
): Buffer {
  const sec = secondaryRgb ?? primaryRgb;
  const cacheKey = `${primaryRgb.join(',')}|${sec.join(',')}|${width}x${height}`;
  const existing = pngCache.get(cacheKey);
  if (existing) return existing;

  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // 8-bit depth
  ihdr[9] = 2; // colorType 2 = Truecolor RGB
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const rowStride = 1 + width * 3;
  const rawScanlines = Buffer.allocUnsafe(rowStride * height);

  for (let y = 0; y < height; y++) {
    const rowOffset = y * rowStride;
    rawScanlines[rowOffset] = 0; // Filter type 0 (None)
    const fy = height > 1 ? y / (height - 1) : 0;
    for (let x = 0; x < width; x++) {
      const fx = width > 1 ? x / (width - 1) : 0;
      const mix = (fx + fy) * 0.5;
      const r = Math.round(primaryRgb[0] * (1 - mix) + sec[0] * mix);
      const g = Math.round(primaryRgb[1] * (1 - mix) + sec[1] * mix);
      const b = Math.round(primaryRgb[2] * (1 - mix) + sec[2] * mix);
      const pxOffset = rowOffset + 1 + x * 3;
      rawScanlines[pxOffset] = Math.max(0, Math.min(255, r));
      rawScanlines[pxOffset + 1] = Math.max(0, Math.min(255, g));
      rawScanlines[pxOffset + 2] = Math.max(0, Math.min(255, b));
    }
  }

  const compressedIdat = deflateSync(rawScanlines, { level: 6 });
  const png = Buffer.concat([
    PNG_SIGNATURE,
    makePngChunk('IHDR', ihdr),
    makePngChunk('IDAT', compressedIdat),
    makePngChunk('IEND', Buffer.alloc(0)),
  ]);

  pngCache.set(cacheKey, png);
  return png;
}

export interface ArtPaletteEntry {
  primaryRgb: readonly [number, number, number];
  secondaryRgb: readonly [number, number, number];
  primaryHex: string;
  secondaryHex: string;
  label: string;
}

export const MOCK_ART_PALETTES: Record<string, ArtPaletteEntry> = {
  'bb-titi': {
    primaryRgb: [232, 93, 4],
    secondaryRgb: [106, 4, 15],
    primaryHex: '#E85D04',
    secondaryHex: '#6A040F',
    label: 'UVST',
  },
  'cc-mina': {
    primaryRgb: [164, 19, 60],
    secondaryRgb: [28, 12, 24],
    primaryHex: '#A4133C',
    secondaryHex: '#1C0C18',
    label: 'MMCD',
  },
  'lp-cayo': {
    primaryRgb: [212, 140, 0],
    secondaryRgb: [32, 24, 58],
    primaryHex: '#D48C00',
    secondaryHex: '#20183A',
    label: 'CAYO',
  },
  'qv-colu': {
    primaryRgb: [0, 119, 182],
    secondaryRgb: [12, 26, 54],
    primaryHex: '#0077B6',
    secondaryHex: '#0C1A36',
    label: 'COLU',
  },
  'mr-mode': {
    primaryRgb: [106, 13, 173],
    secondaryRgb: [22, 10, 40],
    primaryHex: '#6A0DAD',
    secondaryHex: '#160A28',
    label: 'MORA',
  },
  'sk-supe': {
    primaryRgb: [181, 23, 158],
    secondaryRgb: [24, 14, 46],
    primaryHex: '#B5179E',
    secondaryHex: '#180E2E',
    label: 'SAKU',
  },
  'rb-inst': {
    primaryRgb: [15, 76, 92],
    secondaryRgb: [10, 24, 32],
    primaryHex: '#0F4C5C',
    secondaryHex: '#0A1820',
    label: 'RELS',
  },
  'bright-white': {
    primaryRgb: [255, 255, 255],
    secondaryRgb: [255, 255, 255],
    primaryHex: '#FFFFFF',
    secondaryHex: '#FFFFFF',
    label: 'WHITE',
  },
  'cc-long': {
    primaryRgb: [43, 65, 98],
    secondaryRgb: [18, 24, 38],
    primaryHex: '#2B4162',
    secondaryHex: '#121826',
    label: 'ATLA',
  },
  'bb-mono': {
    primaryRgb: [89, 13, 34],
    secondaryRgb: [20, 10, 16],
    primaryHex: '#590D22',
    secondaryHex: '#140A10',
    label: 'MONO',
  },
  'lp-peli': {
    primaryRgb: [27, 67, 50],
    secondaryRgb: [10, 26, 20],
    primaryHex: '#1B4332',
    secondaryHex: '#0A1A14',
    label: 'PELI',
  },
  'df-guap': {
    primaryRgb: [61, 30, 46],
    secondaryRgb: [18, 12, 18],
    primaryHex: '#3D1E2E',
    secondaryHex: '#120C12',
    label: 'DF',
  },
  'qv-shrt': {
    primaryRgb: [72, 12, 168],
    secondaryRgb: [18, 10, 42],
    primaryHex: '#480CA8',
    secondaryHex: '#120A2A',
    label: 'SHRT',
  },
};

function normalizeArtKey(rawName: string): string {
  const base = rawName
    .trim()
    .toLowerCase()
    .replace(/\.(png|svg|jpg|jpeg|webp)$/i, '');
  if (base.includes('missing-404') || base.includes('404')) return 'missing-404';
  if (base.includes('bright') || base.includes('white')) return 'bright-white';
  if (MOCK_ART_PALETTES[base]) return base;
  return 'cc-mina';
}

/**
 * Returns a 64x64 PNG Buffer for the requested artwork key, or `null` for
 * `missing-404` so the route handler returns HTTP 404.
 */
export function getMockArtPngBuffer(rawName: string): Buffer | null {
  const key = normalizeArtKey(rawName);
  if (key === 'missing-404') return null;
  const palette = MOCK_ART_PALETTES[key] ?? MOCK_ART_PALETTES['cc-mina']!;
  return generatePngBuffer(palette.primaryRgb, palette.secondaryRgb, 64, 64);
}

/**
 * Returns a deterministic SVG string for `.svg` artwork requests, or `null`
 * for `missing-404`.
 */
export function getMockArtSvg(rawName: string): string | null {
  const key = normalizeArtKey(rawName);
  if (key === 'missing-404') return null;
  const palette = MOCK_ART_PALETTES[key] ?? MOCK_ART_PALETTES['cc-mina']!;
  if (key === 'bright-white') {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256"><rect width="256" height="256" fill="#FFFFFF"/></svg>`;
  }
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256">`,
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">`,
    `<stop offset="0%" stop-color="${palette.primaryHex}"/>`,
    `<stop offset="100%" stop-color="${palette.secondaryHex}"/>`,
    `</linearGradient></defs>`,
    `<rect width="256" height="256" fill="url(#g)"/>`,
    `</svg>`,
  ].join('');
}

// ============================================================================
// Canonical 8 Spanish Urban Artists
// ============================================================================

export const MOCK_ARTISTS: readonly MockArtistSummary[] = [
  {
    id: 'UCmBA_wu8xGg1OfOkfW13Q0Q',
    name: 'Bad Bunny',
    thumbnailUrl: '/__mock__/art/bb-titi.png',
    bannerUrl: '/__mock__/art/bb-titi.png',
    description:
      'Referente global del reggaetón, trap latino y música urbana en español.',
    subscribersText: '48,5 M de suscriptores',
    genres: ['Reggaetón', 'Trap Latino', 'Urbano Español'],
    isSpanishUrbanSeed: true,
  },
  {
    id: 'UCdOIOrEjYYS42wLKAdGWTLQ',
    name: 'Cruz Cafuné',
    thumbnailUrl: '/__mock__/art/cc-mina.png',
    bannerUrl: '/__mock__/art/cc-mina.png',
    description:
      'Voz esencial de la escena urbana canaria y española, autor de Me Muevo Con Dios y Maracucho Bueno Muere Chiquito.',
    subscribersText: '820 K suscriptores',
    genres: ['Urbano Español', 'Canarias Urbano', 'R&B / Rap'],
    isSpanishUrbanSeed: true,
  },
  {
    id: 'UClaPantera000000000001',
    name: 'La Pantera',
    thumbnailUrl: '/__mock__/art/lp-cayo.png',
    bannerUrl: '/__mock__/art/lp-cayo.png',
    description:
      'Artista urbano de Gran Canaria, protagonista de la nueva ola canaria con Cayó La Noche y Una Semana Increíble.',
    subscribersText: '610 K suscriptores',
    genres: ['Urbano Español', 'Canarias Urbano', 'Reggaetón'],
    isSpanishUrbanSeed: true,
  },
  {
    id: 'UCquevedo00000000000001',
    name: 'Quevedo',
    thumbnailUrl: '/__mock__/art/qv-colu.png',
    bannerUrl: '/__mock__/art/qv-colu.png',
    description:
      'Artista canario líder de listas en España con Donde Quiero Estar y Columbia.',
    subscribersText: '5,4 M de suscriptores',
    genres: ['Urbano Español', 'Reggaetón', 'Canarias Urbano'],
    isSpanishUrbanSeed: true,
  },
  {
    id: 'UCmora000000000000000001',
    name: 'Mora',
    thumbnailUrl: '/__mock__/art/mr-mode.png',
    bannerUrl: '/__mock__/art/mr-mode.png',
    description:
      'Productor y cantante de reggaetón y trap electrónico con fuerte presencia en España.',
    subscribersText: '4,1 M de suscriptores',
    genres: ['Trap Latino', 'Reggaetón', 'Urbano'],
    isSpanishUrbanSeed: true,
  },
  {
    id: 'UCsaiko0000000000000001',
    name: 'Saiko',
    thumbnailUrl: '/__mock__/art/sk-supe.png',
    bannerUrl: '/__mock__/art/sk-supe.png',
    description:
      'Cantante granadino de reggaetón y pop urbano español, autor de SAKURA y Supernova.',
    subscribersText: '1,9 M de suscriptores',
    genres: ['Urbano Español', 'Pop Urbano', 'Reggaetón'],
    isSpanishUrbanSeed: true,
  },
  {
    id: 'UCrelsB0000000000000001',
    name: 'Rels B',
    thumbnailUrl: '/__mock__/art/rb-inst.png',
    bannerUrl: '/__mock__/art/rb-inst.png',
    description:
      'Skinny Flakk: R&B, hip hop y música urbana desde Mallorca para España y Latinoamérica.',
    subscribersText: '6,2 M de suscriptores',
    genres: ['R&B Español', 'Urbano Español', 'Hip Hop'],
    isSpanishUrbanSeed: true,
  },
  {
    id: 'UCdellafuente0000000001',
    name: 'Dellafuente',
    thumbnailUrl: '/__mock__/art/df-guap.png',
    bannerUrl: '/__mock__/art/df-guap.png',
    description:
      'Pionero granadino de la música folklórica atemporal, flamenco urbano y electrónica española.',
    subscribersText: '1,1 M de suscriptores',
    genres: ['Urbano Español', 'Folklore Urbano', 'Flamenco Urbano'],
    isSpanishUrbanSeed: true,
  },
];

// ============================================================================
// Canonical 12 Spanish Urban Albums
// ============================================================================

export const MOCK_ALBUMS: readonly MockAlbumSummary[] = [
  {
    id: 'MPRbbUVST01',
    title: 'Un Verano Sin Ti',
    artists: [{ id: 'UCmBA_wu8xGg1OfOkfW13Q0Q', name: 'Bad Bunny' }],
    year: 2022,
    thumbnailUrl: '/__mock__/art/bb-titi.png',
    trackCount: 23,
  },
  {
    id: 'MPRccMMCD01',
    title: 'Me Muevo Con Dios',
    artists: [{ id: 'UCdOIOrEjYYS42wLKAdGWTLQ', name: 'Cruz Cafuné' }],
    year: 2023,
    thumbnailUrl: '/__mock__/art/cc-mina.png',
    trackCount: 23,
  },
  {
    id: 'MPRlpCANA01',
    title: 'Canarias Urbano',
    artists: [
      { id: 'UClaPantera000000000001', name: 'La Pantera' },
      { id: 'UCquevedo00000000000001', name: 'Quevedo' },
      { id: 'UCdOIOrEjYYS42wLKAdGWTLQ', name: 'Cruz Cafuné' },
    ],
    year: 2022,
    thumbnailUrl: '/__mock__/art/lp-cayo.png',
    trackCount: 10,
  },
  {
    id: 'MPRqvDQE001',
    title: 'Donde Quiero Estar',
    artists: [{ id: 'UCquevedo00000000000001', name: 'Quevedo' }],
    year: 2023,
    thumbnailUrl: '/__mock__/art/qv-colu.png',
    trackCount: 16,
  },
  {
    id: 'MPRmrESTR01',
    title: 'ESTRELLA',
    artists: [{ id: 'UCmora000000000000000001', name: 'Mora' }],
    year: 2023,
    thumbnailUrl: '/__mock__/art/mr-mode.png',
    trackCount: 15,
  },
  {
    id: 'MPRskSAKU01',
    title: 'SAKURA',
    artists: [{ id: 'UCsaiko0000000000000001', name: 'Saiko' }],
    year: 2024,
    thumbnailUrl: '/__mock__/art/sk-supe.png',
    trackCount: 16,
  },
  {
    id: 'MPRrbFLAK01',
    title: "Flakk Daniel's LP",
    artists: [{ id: 'UCrelsB0000000000000001', name: 'Rels B' }],
    year: 2018,
    thumbnailUrl: '/__mock__/art/rb-inst.png',
    trackCount: 13,
  },
  {
    id: 'MPRdfTORI01',
    title: 'Torii Yama',
    artists: [{ id: 'UCdellafuente0000000001', name: 'Dellafuente' }],
    year: 2024,
    thumbnailUrl: '/__mock__/art/bright-white.png',
    trackCount: 12,
  },
  {
    id: 'MPRccATLA01',
    title: 'Sesiones del Atlántico Norte (Edición Deluxe Extendida)',
    artists: [
      { id: 'UCdOIOrEjYYS42wLKAdGWTLQ', name: 'Cruz Cafuné' },
      { id: 'UClaPantera000000000001', name: 'La Pantera' },
    ],
    year: 2024,
    thumbnailUrl: '/__mock__/art/cc-long.png',
    trackCount: 8,
  },
  {
    id: 'MPRbbNSLQ01',
    title: 'nadie sabe lo que va a pasar mañana',
    artists: [{ id: 'UCmBA_wu8xGg1OfOkfW13Q0Q', name: 'Bad Bunny' }],
    year: 2023,
    thumbnailUrl: '/__mock__/art/bb-mono.png',
    trackCount: 22,
  },
  {
    id: 'MPRlpUSI001',
    title: 'Una Semana Increíble',
    artists: [{ id: 'UClaPantera000000000001', name: 'La Pantera' }],
    year: 2024,
    thumbnailUrl: '/__mock__/art/lp-peli.png',
    trackCount: 14,
  },
  {
    id: 'MPRdfLPOD01',
    title: 'Lágrimas Pa Otro Día',
    artists: [{ id: 'UCdellafuente0000000001', name: 'Dellafuente' }],
    year: 2023,
    thumbnailUrl: '/__mock__/art/df-guap.png',
    trackCount: 11,
  },
];

// ============================================================================
// Canonical 14 Spanish Urban Tracks
// ============================================================================

export const LONG_SPANISH_TRACK_TITLE =
  'La Canción Extraordinariamente Larga de Madrugada en Tenerife Con Cruz Cafuné, La Pantera, Quevedo, Saiko y Rels B (Edición Especial Remasterizada)';

export const MOCK_TRACKS: readonly MockTrack[] = [
  {
    id: 'pmBBtiti001',
    title: 'Tití Me Preguntó',
    artists: [{ id: 'UCmBA_wu8xGg1OfOkfW13Q0Q', name: 'Bad Bunny' }],
    album: { id: 'MPRbbUVST01', name: 'Un Verano Sin Ti' },
    durationSec: 244,
    thumbnailUrl: '/__mock__/art/bb-titi.png',
    thumbnailHighUrl: '/__mock__/art/bb-titi.png',
    isExplicit: true,
    source: 'ytmusic',
    releaseYear: 2022,
    genres: ['Reggaetón', 'Urbano Español'],
    bpm: 107,
    energy: 0.88,
    camelotKey: '8A',
  },
  {
    id: 'pmCCmina002',
    title: 'Mina el Hammani',
    artists: [{ id: 'UCdOIOrEjYYS42wLKAdGWTLQ', name: 'Cruz Cafuné' }],
    album: { id: 'MPRccMMCD01', name: 'Me Muevo Con Dios' },
    durationSec: 197,
    thumbnailUrl: '/__mock__/art/cc-mina.png',
    thumbnailHighUrl: '/__mock__/art/cc-mina.png',
    isExplicit: false,
    source: 'ytmusic',
    releaseYear: 2023,
    genres: ['Urbano Español', 'Canarias Urbano'],
    bpm: 96,
    energy: 0.78,
    camelotKey: '6A',
  },
  {
    id: 'pmLPcayo003',
    title: 'Cayó La Noche (Remix)',
    artists: [
      { id: 'UClaPantera000000000001', name: 'La Pantera' },
      { id: 'UCquevedo00000000000001', name: 'Quevedo' },
      { id: 'UCdOIOrEjYYS42wLKAdGWTLQ', name: 'Cruz Cafuné' },
    ],
    album: { id: 'MPRlpCANA01', name: 'Canarias Urbano' },
    durationSec: 238,
    thumbnailUrl: '/__mock__/art/lp-cayo.png',
    thumbnailHighUrl: '/__mock__/art/lp-cayo.png',
    isExplicit: false,
    source: 'ytmusic',
    releaseYear: 2022,
    genres: ['Urbano Español', 'Canarias Urbano', 'Reggaetón'],
    bpm: 98,
    energy: 0.85,
    camelotKey: '6A',
  },
  {
    id: 'pmQVcolu004',
    title: 'Columbia',
    artists: [{ id: 'UCquevedo00000000000001', name: 'Quevedo' }],
    album: { id: 'MPRqvDQE001', name: 'Donde Quiero Estar' },
    durationSec: 186,
    thumbnailUrl: '/__mock__/art/qv-colu.png',
    thumbnailHighUrl: '/__mock__/art/qv-colu.png',
    isExplicit: false,
    source: 'ytmusic',
    releaseYear: 2023,
    genres: ['Urbano Español', 'Reggaetón'],
    bpm: 100,
    energy: 0.82,
    camelotKey: '7A',
  },
  {
    id: 'pmMRmode005',
    title: 'Modelito',
    artists: [{ id: 'UCmora000000000000000001', name: 'Mora' }],
    album: { id: 'MPRmrESTR01', name: 'ESTRELLA' },
    durationSec: 204,
    thumbnailUrl: '/__mock__/art/mr-mode.png',
    thumbnailHighUrl: '/__mock__/art/mr-mode.png',
    isExplicit: true,
    source: 'ytmusic',
    releaseYear: 2023,
    genres: ['Trap Latino', 'Reggaetón'],
    bpm: 138,
    energy: 0.9,
    camelotKey: '9A',
  },
  {
    id: 'pmSKsupe006',
    title: 'Supernova',
    artists: [{ id: 'UCsaiko0000000000000001', name: 'Saiko' }],
    album: { id: 'MPRskSAKU01', name: 'SAKURA' },
    durationSec: 192,
    thumbnailUrl: '/__mock__/art/sk-supe.png',
    thumbnailHighUrl: '/__mock__/art/sk-supe.png',
    isExplicit: false,
    source: 'ytmusic',
    releaseYear: 2023,
    genres: ['Urbano Español', 'Pop Urbano'],
    bpm: 118,
    energy: 0.84,
    camelotKey: '8B',
  },
  {
    id: 'pmRBinst007',
    title: 'A Mí (Versión Instrumental)',
    artists: [{ id: 'UCrelsB0000000000000001', name: 'Rels B' }],
    album: { id: 'MPRrbFLAK01', name: "Flakk Daniel's LP" },
    durationSec: 175,
    thumbnailUrl: '/__mock__/art/rb-inst.png',
    thumbnailHighUrl: '/__mock__/art/rb-inst.png',
    isExplicit: false,
    source: 'ytmusic',
    releaseYear: 2019,
    genres: ['R&B Español', 'Urbano Español'],
    bpm: 92,
    energy: 0.56,
    camelotKey: '5A',
  },
  {
    id: 'pmDFbrig008',
    title: 'Luz Blanca (Consentía Edit)',
    artists: [
      { id: 'UCdellafuente0000000001', name: 'Dellafuente' },
      { id: 'UClaPantera000000000001', name: 'La Pantera' },
    ],
    album: { id: 'MPRdfTORI01', name: 'Torii Yama' },
    durationSec: 211,
    thumbnailUrl: '/__mock__/art/bright-white.png',
    thumbnailHighUrl: '/__mock__/art/bright-white.png',
    isExplicit: false,
    source: 'ytmusic',
    releaseYear: 2024,
    genres: ['Urbano Español', 'Flamenco Urbano'],
    bpm: 95,
    energy: 0.8,
    camelotKey: '6A',
  },
  {
    id: 'pmCClong009',
    title: LONG_SPANISH_TRACK_TITLE,
    artists: [
      { id: 'UCdOIOrEjYYS42wLKAdGWTLQ', name: 'Cruz Cafuné' },
      { id: 'UClaPantera000000000001', name: 'La Pantera' },
      { id: 'UCquevedo00000000000001', name: 'Quevedo' },
      { id: 'UCsaiko0000000000000001', name: 'Saiko' },
      { id: 'UCrelsB0000000000000001', name: 'Rels B' },
    ],
    album: {
      id: 'MPRccATLA01',
      name: 'Sesiones del Atlántico Norte (Edición Deluxe Extendida)',
    },
    durationSec: 265,
    thumbnailUrl: '/__mock__/art/cc-long.png',
    thumbnailHighUrl: '/__mock__/art/cc-long.png',
    isExplicit: false,
    source: 'ytmusic',
    releaseYear: 2024,
    genres: ['Urbano Español', 'Canarias Urbano'],
    bpm: 124,
    energy: 0.76,
    camelotKey: '8A',
  },
  {
    id: 'pmBBmono010',
    title: 'MONACO',
    artists: [{ id: 'UCmBA_wu8xGg1OfOkfW13Q0Q', name: 'Bad Bunny' }],
    album: { id: 'MPRbbNSLQ01', name: 'nadie sabe lo que va a pasar mañana' },
    durationSec: 267,
    thumbnailUrl: '/__mock__/art/bb-mono.png',
    thumbnailHighUrl: '/__mock__/art/bb-mono.png',
    isExplicit: true,
    source: 'ytmusic',
    releaseYear: 2023,
    genres: ['Trap Latino', 'Urbano Español'],
    bpm: 136,
    energy: 0.91,
    camelotKey: '9A',
  },
  {
    id: 'pmLPpeli011',
    title: 'Peligrosa',
    artists: [{ id: 'UClaPantera000000000001', name: 'La Pantera' }],
    album: { id: 'MPRlpUSI001', name: 'Una Semana Increíble' },
    durationSec: 189,
    thumbnailUrl: '/__mock__/art/lp-peli.png',
    thumbnailHighUrl: '/__mock__/art/lp-peli.png',
    isExplicit: false,
    source: 'ytmusic',
    releaseYear: 2024,
    genres: ['Urbano Español', 'Canarias Urbano'],
    bpm: 116,
    energy: 0.79,
    camelotKey: '7B',
  },
  {
    id: 'pmDFguap012',
    title: 'Guerrera',
    artists: [
      { id: 'UCdellafuente0000000001', name: 'Dellafuente' },
      { id: 'UCmora000000000000000001', name: 'Mora' },
    ],
    album: { id: 'MPRdfLPOD01', name: 'Lágrimas Pa Otro Día' },
    durationSec: 202,
    thumbnailUrl: '/__mock__/art/df-guap.png',
    thumbnailHighUrl: '/__mock__/art/df-guap.png',
    isExplicit: false,
    source: 'ytmusic',
    releaseYear: 2023,
    genres: ['Urbano Español', 'Flamenco Urbano'],
    bpm: 102,
    energy: 0.74,
    camelotKey: '7A',
  },
  {
    id: 'pmQVshrt013',
    title: 'Interludio Urbano',
    artists: [{ id: 'UCquevedo00000000000001', name: 'Quevedo' }],
    album: { id: 'MPRqvDQE001', name: 'Donde Quiero Estar' },
    durationSec: 6,
    thumbnailUrl: '/__mock__/art/qv-shrt.png',
    thumbnailHighUrl: '/__mock__/art/qv-shrt.png',
    isExplicit: false,
    source: 'ytmusic',
    releaseYear: 2023,
    genres: ['Urbano Español'],
    bpm: 96,
    energy: 0.65,
    camelotKey: '6A',
  },
  {
    id: 'pmLPmiss014',
    title: 'Sin Portada (Interludio)',
    artists: [{ id: 'UClaPantera000000000001', name: 'La Pantera' }],
    album: { id: 'MPRlpCANA01', name: 'Canarias Urbano' },
    durationSec: 32,
    thumbnailUrl: '/__mock__/art/missing-404.png',
    thumbnailHighUrl: '/__mock__/art/missing-404.png',
    isExplicit: false,
    source: 'ytmusic',
    releaseYear: 2024,
    genres: ['Urbano Español'],
    bpm: 94,
    energy: 0.55,
    camelotKey: '6A',
  },
];

// ============================================================================
// Track, Artist, Album & Playlist Alias Maps (Explorer 1/2/3 Compatibility)
// ============================================================================

export const TRACK_ID_ALIASES: Readonly<Record<string, string>> = {
  // Canonical 14 IDs map to themselves
  pmBBtiti001: 'pmBBtiti001',
  pmCCmina002: 'pmCCmina002',
  pmLPcayo003: 'pmLPcayo003',
  pmQVcolu004: 'pmQVcolu004',
  pmMRmode005: 'pmMRmode005',
  pmSKsupe006: 'pmSKsupe006',
  pmRBinst007: 'pmRBinst007',
  pmDFbrig008: 'pmDFbrig008',
  pmCClong009: 'pmCClong009',
  pmBBmono010: 'pmBBmono010',
  pmLPpeli011: 'pmLPpeli011',
  pmDFguap012: 'pmDFguap012',
  pmQVshrt013: 'pmQVshrt013',
  pmLPmiss014: 'pmLPmiss014',
  // Explorer 1 alternate IDs
  pmRBbue0007: 'pmRBinst007',
  pmDFcons008: 'pmDFbrig008',
  pmCCiong009: 'pmCClong009',
  // Explorer 3 alternate IDs
  pmBadBunny1: 'pmBBtiti001',
  pmCruzCafu1: 'pmCCmina002',
  pmLaPanter1: 'pmLPcayo003',
  pmQuevedo01: 'pmQVcolu004',
  pmMora00001: 'pmMRmode005',
  pmSaiko0001: 'pmSKsupe006',
  pmRelsB0001: 'pmRBinst007',
  pmDellafue1: 'pmDFbrig008',
  pmBrightArt: 'pmDFbrig008',
  pmUnsynced1: 'pmQVcolu004',
  pmNoLyrics1: 'pmSKsupe006',
  pmShortSig1: 'pmQVshrt013',
  pmShortSignal: 'pmQVshrt013',
};

export const ARTIST_ID_ALIASES: Readonly<Record<string, string>> = {
  UCmBA_wu8xGg1OfOkfW13Q0Q: 'UCmBA_wu8xGg1OfOkfW13Q0Q',
  UCdOIOrEjYYS42wLKAdGWTLQ: 'UCdOIOrEjYYS42wLKAdGWTLQ',
  UClaPantera000000000001: 'UClaPantera000000000001',
  UCquevedo00000000000001: 'UCquevedo00000000000001',
  UCmora000000000000000001: 'UCmora000000000000000001',
  UCsaiko0000000000000001: 'UCsaiko0000000000000001',
  UCrelsB0000000000000001: 'UCrelsB0000000000000001',
  UCdellafuente0000000001: 'UCdellafuente0000000001',
  UC_bad_bunny: 'UCmBA_wu8xGg1OfOkfW13Q0Q',
  UC_cruz_cafune: 'UCdOIOrEjYYS42wLKAdGWTLQ',
  UC_la_pantera: 'UClaPantera000000000001',
  UC_quevedo: 'UCquevedo00000000000001',
  UC_mora: 'UCmora000000000000000001',
  UC_saiko: 'UCsaiko0000000000000001',
  UC_rels_b: 'UCrelsB0000000000000001',
  UC_dellafuente: 'UCdellafuente0000000001',
};

export const PLAYLIST_ID_ALIASES: Readonly<Record<string, string>> = {
  PLesUrbano01: 'PLesUrbano01',
  PLesCanarias02: 'PLesCanarias02',
  PLesNovedades03: 'PLesNovedades03',
  PLpmusicTest01: 'PLesUrbano01',
  VLPLesUrbano01: 'PLesUrbano01',
  VLPLesCanarias02: 'PLesCanarias02',
  VLPLesNovedades03: 'PLesNovedades03',
  VLPLpmusicTest01: 'PLesUrbano01',
};

export function resolveCanonicalTrackId(id: string): string {
  return TRACK_ID_ALIASES[id] ?? id;
}

export function findTrackById(id: string): MockTrack | undefined {
  const canonical = resolveCanonicalTrackId(id);
  const found = MOCK_TRACKS.find((t) => t.id === canonical);
  if (!found) return undefined;
  return id === found.id ? found : { ...found, id };
}

export function findArtistById(id: string): MockArtistSummary | undefined {
  const canonical = ARTIST_ID_ALIASES[id] ?? id;
  return MOCK_ARTISTS.find((a) => a.id === canonical);
}

export function findAlbumById(id: string): MockAlbumSummary | undefined {
  return MOCK_ALBUMS.find((al) => al.id === id);
}

// ============================================================================
// Curated Playlists (Intentionally Unsorted BPM for DJ AutoMix Verification)
// ============================================================================

export const MOCK_PLAYLISTS: readonly MockPlaylistSummary[] = [
  {
    id: 'PLesUrbano01',
    title: 'Urbano ES · Esenciales',
    author: 'pMusic Editorial',
    description:
      'Selección esencial de reggaetón, trap y escena urbana española (Cruz Cafuné, La Pantera, Bad Bunny, Quevedo, Mora y Saiko).',
    thumbnailUrl: '/__mock__/art/cc-mina.png',
    trackCount: 6,
  },
  {
    id: 'PLesCanarias02',
    title: 'Canarias Sound',
    author: 'Cruz Cafuné & Amigos',
    description: 'El sonido de las islas: Tenerife y Gran Canaria en sesión continua.',
    thumbnailUrl: '/__mock__/art/lp-cayo.png',
    trackCount: 4,
  },
  {
    id: 'PLesNovedades03',
    title: 'Novedades Urbano España',
    author: 'pMusic Radar',
    description: 'Lanzamientos recientes de tus artistas urbanos favoritos en España.',
    thumbnailUrl: '/__mock__/art/bb-titi.png',
    trackCount: 4,
  },
];

export const MOCK_PLAYLIST_TRACK_IDS: Readonly<Record<string, readonly string[]>> = {
  // Intentionally unsorted BPM: 96, 138, 98, 136, 100, 118 -> DJ reorder smoothes jumps!
  PLesUrbano01: [
    'pmCCmina002',
    'pmMRmode005',
    'pmLPcayo003',
    'pmBBmono010',
    'pmQVcolu004',
    'pmSKsupe006',
  ],
  PLesCanarias02: ['pmCCmina002', 'pmLPcayo003', 'pmQVcolu004', 'pmLPpeli011'],
  PLesNovedades03: ['pmBBtiti001', 'pmSKsupe006', 'pmDFbrig008', 'pmMRmode005'],
};

export function findPlaylistById(
  rawId: string
): { playlist: MockPlaylistSummary; tracks: MockTrack[] } | undefined {
  const stripped = rawId.startsWith('VL') ? rawId.slice(2) : rawId;
  const canonical = PLAYLIST_ID_ALIASES[rawId] ?? PLAYLIST_ID_ALIASES[stripped] ?? stripped;
  const playlist = MOCK_PLAYLISTS.find((p) => p.id === canonical);
  if (!playlist) return undefined;
  const ids = MOCK_PLAYLIST_TRACK_IDS[canonical] ?? [];
  const tracks = ids
    .map((tid) => findTrackById(tid))
    .filter((t): t is MockTrack => t !== undefined);
  return {
    playlist: rawId === playlist.id ? playlist : { ...playlist, id: rawId },
    tracks,
  };
}

// ============================================================================
// Audio Synthesis Config per Track
// ============================================================================

export const TRACK_AUDIO_SPECS: Readonly<Record<string, TrackAudioFixtureSpec>> = {
  pmBBtiti001: {
    bpm: 107,
    pattern: 'reggaeton',
    wavDurationSec: 36,
    baseFreqHz: 58,
    energy: 0.88,
    camelotKey: '8A',
  },
  pmCCmina002: {
    bpm: 96,
    pattern: 'reggaeton',
    wavDurationSec: 36,
    baseFreqHz: 55,
    energy: 0.78,
    camelotKey: '6A',
  },
  pmLPcayo003: {
    bpm: 98,
    pattern: 'reggaeton',
    wavDurationSec: 36,
    baseFreqHz: 56,
    energy: 0.85,
    camelotKey: '6A',
  },
  pmQVcolu004: {
    bpm: 100,
    pattern: 'reggaeton',
    wavDurationSec: 36,
    baseFreqHz: 60,
    energy: 0.82,
    camelotKey: '7A',
  },
  pmMRmode005: {
    bpm: 138,
    pattern: 'trap',
    wavDurationSec: 36,
    baseFreqHz: 52,
    energy: 0.9,
    camelotKey: '9A',
  },
  pmSKsupe006: {
    bpm: 118,
    pattern: 'urban_pop',
    wavDurationSec: 36,
    baseFreqHz: 62,
    energy: 0.84,
    camelotKey: '8B',
  },
  pmRBinst007: {
    bpm: 92,
    pattern: 'urban_pop',
    wavDurationSec: 36,
    baseFreqHz: 54,
    energy: 0.56,
    camelotKey: '5A',
  },
  pmDFbrig008: {
    bpm: 95,
    pattern: 'reggaeton',
    wavDurationSec: 36,
    baseFreqHz: 57,
    energy: 0.8,
    camelotKey: '6A',
  },
  pmCClong009: {
    bpm: 124,
    pattern: 'urban_pop',
    wavDurationSec: 36,
    baseFreqHz: 60,
    energy: 0.76,
    camelotKey: '8A',
  },
  pmBBmono010: {
    bpm: 136,
    pattern: 'trap',
    wavDurationSec: 36,
    baseFreqHz: 52,
    energy: 0.91,
    camelotKey: '9A',
  },
  pmLPpeli011: {
    bpm: 116,
    pattern: 'urban_pop',
    wavDurationSec: 36,
    baseFreqHz: 61,
    energy: 0.79,
    camelotKey: '7B',
  },
  pmDFguap012: {
    bpm: 102,
    pattern: 'reggaeton',
    wavDurationSec: 36,
    baseFreqHz: 58,
    energy: 0.74,
    camelotKey: '7A',
  },
  pmQVshrt013: {
    bpm: 96,
    pattern: 'reggaeton',
    wavDurationSec: 6,
    baseFreqHz: 58,
    energy: 0.65,
    camelotKey: '6A',
  },
  pmLPmiss014: {
    bpm: 94,
    pattern: 'reggaeton',
    wavDurationSec: 32,
    baseFreqHz: 56,
    energy: 0.55,
    camelotKey: '6A',
  },
};

// ============================================================================
// Synced LRC & Plain Lyrics Fixtures (30+ Lines with Exact Seek Timestamps)
// ============================================================================

function build32LineSpanishLrc(
  title: string,
  artist: string,
  hookLine: string,
  options?: { includeMultiTimestamp?: boolean; includeInterlude?: boolean }
): string {
  const lines: string[] = [
    `[00:00.50] ${title} · ${artist} en la casa`,
    `[00:01.20] Sube el bajo en la pista que empieza la sesión`,
    `[00:02.00] Desde Canarias hasta Madrid sonando fuerte`,
  ];

  if (options?.includeMultiTimestamp) {
    lines.push(`[00:02.80][00:07.80] ${hookLine}`);
  } else {
    lines.push(`[00:02.80] ${hookLine}`);
  }

  lines.push(
    `[00:03.60] La noche cae sobre la avenida iluminada`,
    `[00:04.40] El ritmo urbano marca cada paso en la acera`,
    `[00:05.10] Seguimos firmes con la gente de siempre`
  );

  if (options?.includeInterlude !== false) {
    lines.push(`[00:05.80] `);
  }

  lines.push(
    `[00:06.50] Vuelve a romper el dembow en los altavoces`,
    `[00:07.20] Todo el club cantando el estribillo a una voz`,
    `[00:08.50] Nadie nos baja la energía esta madrugada`,
    `[00:09.20] Luces de neón reflejadas en el cristal`,
    `[00:10.00] Diez segundos exactos de pura vibra española`,
    `[00:11.00] Cruzando el puente hacia el segundo verso`,
    `[00:12.00] Doce segundos marcando el compás del estribillo`,
    `[00:13.20] ${hookLine} (en directo)`,
    `[00:14.00] Catorce segundos conectando móvil y escritorio`,
    `[00:15.20] La melodía sube con el filtro resonante`,
    `[00:16.00] Dieciséis segundos de transferencia instantánea`,
    `[00:17.00] El eco repite cada palabra en la mezcla`,
    `[00:18.00] Dieciocho segundos clavados en la línea activa`,
    `[00:19.50] Siente los graves a sesenta hercios retumbando`,
    `[00:21.00] La costa atlántica brilla bajo la luna llena`,
    `[00:22.50] Cada verso cuenta una historia verdadera`,
    `[00:24.00] Preparando la transición para el siguiente tema`,
    `[00:25.00] Veinticinco segundos exactos en el marcador`,
    `[00:26.50] Seguimos sonando sin cortes ni silencios`,
    `[00:28.00] ${hookLine} (cierre de oro)`,
    `[00:29.50] La sesión continúa con toda la escena española`,
    `[00:31.00] Últimos compases antes de que entre el DJ`,
    `[00:32.50] Baja la espuma mientras sube el próximo beat`,
    `[00:34.00] Fin del bloque vocal en pMusic`
  );

  return lines.join('\n');
}

export const TRACK_LYRICS_SPECS: Readonly<Record<string, TrackLyricsFixtureSpec>> = {
  pmBBtiti001: {
    mode: 'synced',
    syncedLyrics: build32LineSpanishLrc(
      'Tití Me Preguntó',
      'Bad Bunny',
      'Ey, Tití me preguntó si tengo muchas novias, muchas novias',
      { includeInterlude: true }
    ),
    plainLyrics:
      'Tití Me Preguntó · Bad Bunny\nEy, Tití me preguntó si tengo muchas novias\nHoy tengo a una, mañana otra\nDesde Puerto Rico hasta España sonando en la noche.',
  },
  pmCCmina002: {
    mode: 'synced',
    syncedLyrics: build32LineSpanishLrc(
      'Mina el Hammani',
      'Cruz Cafuné',
      'Me muevo con Dios, Tenerife hasta Madrid sin mirar atrás',
      { includeMultiTimestamp: true, includeInterlude: true }
    ),
    plainLyrics:
      'Mina el Hammani · Cruz Cafuné\nMe muevo con Dios, Tenerife hasta Madrid sin mirar atrás\nLa escena canaria en lo más alto del bloque.',
  },
  pmLPcayo003: {
    mode: 'synced',
    syncedLyrics: build32LineSpanishLrc(
      'Cayó La Noche (Remix)',
      'La Pantera, Quevedo, Cruz Cafuné',
      'Hoy cayó la noche y salimos a quemar la isla entera',
      { includeMultiTimestamp: true }
    ),
    plainLyrics:
      'Cayó La Noche (Remix) · La Pantera, Quevedo, Cruz Cafuné\nHoy cayó la noche y salimos a quemar la isla entera.',
  },
  pmQVcolu004: {
    mode: 'plain_only',
    syncedLyrics: null,
    plainLyrics: [
      'Columbia · Quevedo',
      'Volvió de estudiar en Columbia a la isla sin avisar',
      'Las noches de verano en Gran Canaria nunca se olvidan',
      'Suena la radio mientras bajamos hacia la playa',
      'Letra completa disponible en modo sin sincronizar.',
    ].join('\n'),
  },
  pmMRmode005: {
    mode: 'synced',
    syncedLyrics: build32LineSpanishLrc(
      'Modelito',
      'Mora',
      'Ese modelito nuevo brilla cuando entras a la pista'
    ),
    plainLyrics:
      'Modelito · Mora\nEse modelito nuevo brilla cuando entras a la pista.',
  },
  pmSKsupe006: {
    mode: 'no_lyrics',
    syncedLyrics: null,
    plainLyrics: null,
  },
  pmRBinst007: {
    mode: 'instrumental',
    syncedLyrics: null,
    plainLyrics: null,
  },
  pmDFbrig008: {
    mode: 'synced',
    syncedLyrics: build32LineSpanishLrc(
      'Luz Blanca (Consentía Edit)',
      'Dellafuente, La Pantera',
      'Bajo la luz blanca de Granada cantando a pleno pulmón'
    ),
    plainLyrics:
      'Luz Blanca (Consentía Edit) · Dellafuente, La Pantera\nBajo la luz blanca de Granada cantando a pleno pulmón.',
  },
  pmCClong009: {
    mode: 'plain_only',
    syncedLyrics: null,
    plainLyrics: [
      LONG_SPANISH_TRACK_TITLE,
      'Reunión histórica de Cruz Cafuné, La Pantera, Quevedo, Saiko y Rels B',
      'Grabado en directo entre Tenerife, Gran Canaria, Granada y Mallorca.',
    ].join('\n'),
  },
  pmBBmono010: {
    mode: 'duration_mismatch_search_fallback',
    lrclibDurationSec: 240, // Track metadata is 267s -> /api/get (±2s) misses, /api/search succeeds!
    syncedLyrics: build32LineSpanishLrc(
      'MONACO',
      'Bad Bunny',
      'Los coches de Fórmula 1 rugiendo por las calles de Mónaco'
    ),
    plainLyrics:
      'MONACO · Bad Bunny\nLos coches de Fórmula 1 rugiendo por las calles de Mónaco.',
  },
  pmLPpeli011: {
    mode: 'yt_plain_fallback',
    syncedLyrics: null,
    plainLyrics: [
      'Peligrosa · La Pantera',
      'Letra recuperada desde el respaldo de YouTube Music en español',
      'Cuando sale de noche por Las Palmas nadie la puede parar.',
    ].join('\n'),
  },
  pmDFguap012: {
    mode: 'synced',
    syncedLyrics: build32LineSpanishLrc(
      'Guerrera',
      'Dellafuente, Mora',
      'Siempre guerrera aunque llueva sobre la Alhambra'
    ),
    plainLyrics:
      'Guerrera · Dellafuente, Mora\nSiempre guerrera aunque llueva sobre la Alhambra.',
  },
  pmQVshrt013: {
    mode: 'synced',
    syncedLyrics: [
      '[00:00.40] Interludio Urbano · Quevedo',
      '[00:01.50] Señal positiva de escucha completa en pMusic',
      '[00:03.00] Más del ochenta por ciento reproducido en vivo',
      '[00:04.50] Cerrando el interludio canario',
    ].join('\n'),
    plainLyrics:
      'Interludio Urbano · Quevedo\nSeñal positiva de escucha completa en pMusic.',
  },
  pmLPmiss014: {
    mode: 'no_lyrics',
    syncedLyrics: null,
    plainLyrics: null,
  },
};

// ============================================================================
// Accent-Insensitive Spanish Search & Suggestion Helpers
// ============================================================================

export function normalizeSpanishText(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export const SPANISH_SEARCH_SUGGESTION_POOL: readonly string[] = [
  'cruz cafuné',
  'cruz cafuné mina el hammani',
  'cruz cafuné me muevo con dios',
  'la pantera',
  'la pantera cayó la noche remix',
  'la pantera peligrosa',
  'bad bunny',
  'bad bunny tití me preguntó',
  'bad bunny monaco',
  'quevedo',
  'quevedo columbia',
  'quevedo donde quiero estar',
  'mora',
  'mora modelito',
  'saiko',
  'saiko supernova',
  'rels b',
  'rels b a mí',
  'dellafuente',
  'dellafuente guerrera',
  'dellafuente luz blanca',
  'urbano español',
  'canarias sound',
];

export function queryMockSuggestions(rawQuery: string): string[] {
  const q = normalizeSpanishText(rawQuery);
  if (!q) {
    return SPANISH_SEARCH_SUGGESTION_POOL.slice(0, 6);
  }
  const matches = SPANISH_SEARCH_SUGGESTION_POOL.filter((item) =>
    normalizeSpanishText(item).includes(q)
  );
  if (matches.length > 0) {
    return matches.slice(0, 8);
  }
  return [`${rawQuery.trim()} urbano español`, `${rawQuery.trim()} remix`];
}

export function queryMockCatalog(
  rawQuery: string,
  filter: string = 'all'
): MockSearchResultBundle {
  const query = rawQuery.trim();
  const q = normalizeSpanishText(query);

  if (!q || q.includes('zzzz_no_match') || q.includes('inexistente_xyz_999')) {
    return {
      query,
      topResult: null,
      songs: [],
      videos: [],
      artists: [],
      albums: [],
      playlists: [],
      continuationToken: null,
    };
  }

  // Unmatched regional track used in partial_unmatched Spotify import tests
  if (q.includes('tema regional bloqueado xyz')) {
    return {
      query,
      topResult: null,
      songs: [],
      videos: [],
      artists: [],
      albums: [],
      playlists: [],
      continuationToken: null,
    };
  }

  const matchedTracks = MOCK_TRACKS.filter((t) => {
    const hay = normalizeSpanishText(
      `${t.id} ${t.title} ${t.artists.map((a) => a.name).join(' ')} ${t.album?.name ?? ''} ${(t.genres ?? []).join(' ')}`
    );
    return hay.includes(q) || q.split(/\s+/).every((tok) => hay.includes(tok));
  });

  const matchedArtists = MOCK_ARTISTS.filter((a) => {
    const hay = normalizeSpanishText(`${a.id} ${a.name} ${(a.genres ?? []).join(' ')}`);
    return hay.includes(q) || q.split(/\s+/).every((tok) => hay.includes(tok));
  });

  const matchedAlbums = MOCK_ALBUMS.filter((al) => {
    const hay = normalizeSpanishText(
      `${al.id} ${al.title} ${al.artists.map((a) => a.name).join(' ')}`
    );
    return hay.includes(q) || q.split(/\s+/).every((tok) => hay.includes(tok));
  });

  const matchedPlaylists = MOCK_PLAYLISTS.filter((pl) => {
    const hay = normalizeSpanishText(`${pl.id} ${pl.title} ${pl.author ?? ''} ${pl.description ?? ''}`);
    return hay.includes(q) || q.split(/\s+/).every((tok) => hay.includes(tok));
  });

  const songs = matchedTracks;
  const videos = matchedTracks.slice(0, 4);

  let topResult: MockTopResult | null = null;
  const exactArtist = matchedArtists.find((a) => normalizeSpanishText(a.name) === q);
  const exactTrack = matchedTracks.find((t) => normalizeSpanishText(t.title) === q);

  if (exactArtist) {
    topResult = { type: 'artist', artist: exactArtist, item: exactArtist };
  } else if (exactTrack) {
    topResult = { type: 'track', track: exactTrack, item: exactTrack };
  } else if (matchedArtists[0]) {
    topResult = { type: 'artist', artist: matchedArtists[0], item: matchedArtists[0] };
  } else if (matchedTracks[0]) {
    topResult = { type: 'track', track: matchedTracks[0], item: matchedTracks[0] };
  } else if (matchedAlbums[0]) {
    topResult = { type: 'album', album: matchedAlbums[0], item: matchedAlbums[0] };
  } else if (matchedPlaylists[0]) {
    topResult = { type: 'playlist', playlist: matchedPlaylists[0], item: matchedPlaylists[0] };
  }

  const f = filter.toLowerCase();
  if (f === 'song' || f === 'songs' || f === 'canciones') {
    return {
      query,
      topResult: songs[0] ? { type: 'track', track: songs[0], item: songs[0] } : null,
      songs,
      videos: [],
      artists: [],
      albums: [],
      playlists: [],
      continuationToken: null,
    };
  }
  if (f === 'artist' || f === 'artists' || f === 'artistas') {
    return {
      query,
      topResult: matchedArtists[0]
        ? { type: 'artist', artist: matchedArtists[0], item: matchedArtists[0] }
        : null,
      songs: [],
      videos: [],
      artists: matchedArtists,
      albums: [],
      playlists: [],
      continuationToken: null,
    };
  }
  if (f === 'album' || f === 'albums' || f === 'albumes' || f === 'álbumes') {
    return {
      query,
      topResult: matchedAlbums[0]
        ? { type: 'album', album: matchedAlbums[0], item: matchedAlbums[0] }
        : null,
      songs: [],
      videos: [],
      artists: [],
      albums: matchedAlbums,
      playlists: [],
      continuationToken: null,
    };
  }
  if (f === 'playlist' || f === 'playlists') {
    return {
      query,
      topResult: matchedPlaylists[0]
        ? { type: 'playlist', playlist: matchedPlaylists[0], item: matchedPlaylists[0] }
        : null,
      songs: [],
      videos: [],
      artists: [],
      albums: [],
      playlists: matchedPlaylists,
      continuationToken: null,
    };
  }

  return {
    query,
    topResult,
    songs,
    videos,
    artists: matchedArtists,
    albums: matchedAlbums,
    playlists: matchedPlaylists,
    continuationToken: null,
  };
}

export function buildMockHomeFeed(mood?: string): {
  shelves: MockHomeFeedShelf[];
  moods: string[];
} {
  const quickPicks = [
    MOCK_TRACKS[1]!, // Mina el Hammani · Cruz Cafuné
    MOCK_TRACKS[2]!, // Cayó La Noche (Remix) · La Pantera
    MOCK_TRACKS[0]!, // Tití Me Preguntó · Bad Bunny
    MOCK_TRACKS[3]!, // Columbia · Quevedo
    MOCK_TRACKS[4]!, // Modelito · Mora
    MOCK_TRACKS[5]!, // Supernova · Saiko
  ];

  const mixes: MockPlaylistSummary[] = [
    {
      id: 'PLesUrbano01',
      title: 'Mix Cruz Cafuné & Urbano ES',
      author: 'Tu algoritmo pMusic',
      description: 'Cruz Cafuné, La Pantera, Quevedo y Bad Bunny mezclados para ti.',
      thumbnailUrl: '/__mock__/art/cc-mina.png',
      trackCount: 6,
    },
    {
      id: 'PLesCanarias02',
      title: 'Mix La Pantera & Canarias Sound',
      author: 'Tu algoritmo pMusic',
      description: 'Sesión canaria con La Pantera, Quevedo y Cruz Cafuné.',
      thumbnailUrl: '/__mock__/art/lp-cayo.png',
      trackCount: 4,
    },
    {
      id: 'PLesNovedades03',
      title: 'Mix Bad Bunny & Perreo Nocturno',
      author: 'Tu algoritmo pMusic',
      description: 'Bad Bunny, Mora y Saiko a máximo ritmo.',
      thumbnailUrl: '/__mock__/art/bb-titi.png',
      trackCount: 4,
    },
  ];

  const becauseYouListened = [
    MOCK_TRACKS[2]!, // Cayó La Noche (Remix)
    MOCK_TRACKS[10]!, // Peligrosa · La Pantera
    MOCK_TRACKS[11]!, // Guerrera · Dellafuente, Mora
    MOCK_TRACKS[9]!, // MONACO · Bad Bunny
  ];

  const newReleases = [
    MOCK_ALBUMS[1]!, // Me Muevo Con Dios · Cruz Cafuné
    MOCK_ALBUMS[10]!, // Una Semana Increíble · La Pantera
    MOCK_ALBUMS[0]!, // Un Verano Sin Ti · Bad Bunny
    MOCK_ALBUMS[3]!, // Donde Quiero Estar · Quevedo
    MOCK_ALBUMS[5]!, // SAKURA · Saiko
  ];

  const moodSuffix = mood ? ` (${mood})` : '';

  return {
    moods: ['Energía', 'Fiesta', 'Relax', 'Entrenamiento', 'Concentración'],
    shelves: [
      {
        id: 'shelf-escuchar-de-nuevo',
        title: `Escuchar de nuevo${moodSuffix}`,
        subtitle: 'Tus temas más reproducidos y favoritos recientes',
        kind: 'quick_picks',
        items: quickPicks,
        tracks: quickPicks,
      },
      {
        id: 'shelf-mixes-para-ti',
        title: 'Mixes para ti',
        subtitle: 'Sesiones generadas por tu algoritmo con modo Sesión DJ',
        kind: 'mixes',
        items: mixes,
        playlists: mixes,
      },
      {
        id: 'shelf-porque-escuchaste',
        title: 'Porque escuchaste Cruz Cafuné',
        subtitle: 'Recomendaciones personalizadas de la escena urbana española',
        kind: 'because_you_listened',
        items: becauseYouListened,
        tracks: becauseYouListened,
      },
      {
        id: 'shelf-novedades',
        title: 'Novedades de tus artistas favoritos',
        subtitle: 'Últimos álbumes y sencillos de Bad Bunny, La Pantera, Cruz Cafuné y más',
        kind: 'new_releases',
        items: newReleases,
        albums: newReleases,
      },
    ],
  };
}
