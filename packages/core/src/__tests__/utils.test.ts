import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SPANISH_URBAN_SEEDS,
  clamp,
  formatDurationMs,
  formatDurationSec,
  mapRuntimeToDevicePlatform,
  normalizeArtistKey,
  sanitizeTrackTitle,
} from '../index.ts';

describe('normalizeArtistKey', () => {
  it('strips Spanish & Latin combining diacritics, lowercases, and collapses whitespace', () => {
    expect(normalizeArtistKey('Cruz Cafuné')).toBe('cruz cafune');
    expect(normalizeArtistKey('Eladio Carrión')).toBe('eladio carrion');
    expect(normalizeArtistKey('Ñengo\u00A0\u00A0Flow')).toBe('nengo flow');
    expect(normalizeArtistKey('  ROSALÍA  ')).toBe('rosalia');
    expect(normalizeArtistKey('Pingüino\t\nReal')).toBe('pinguino real');
    expect(normalizeArtistKey('C. Tangana')).toBe('c. tangana');
    expect(normalizeArtistKey('   \u00A0  ')).toBe('');
    expect(normalizeArtistKey('')).toBe('');
  });

  it('produces identical output for NFC and NFD encoded input strings', () => {
    expect(normalizeArtistKey('Cafun\u00E9')).toBe(normalizeArtistKey('Cafune\u0301'));
  });

  it('matches every seed.artistKey in DEFAULT_SPANISH_URBAN_SEEDS', () => {
    for (const seed of DEFAULT_SPANISH_URBAN_SEEDS) {
      expect(normalizeArtistKey(seed.displayName)).toBe(seed.artistKey);
    }
  });
});

describe('sanitizeTrackTitle', () => {
  it('strips English and Spanish video/audio/quality/producer noise brackets', () => {
    const cases: ReadonlyArray<readonly [string, string]> = [
      ['Cruz Cafuné - Mina el Hammani (Video Oficial)', 'Cruz Cafuné - Mina el Hammani'],
      ['La Pantera - Cayó La Noche [Vídeo Oficial]', 'La Pantera - Cayó La Noche'],
      ['Bad Bunny - Monaco (Official Video)', 'Bad Bunny - Monaco'],
      ['Quevedo - Columbia (Official Music Video)', 'Quevedo - Columbia'],
      ['Saiko - Supernova (Audio Oficial)', 'Saiko - Supernova'],
      ['Mora - Donde Se Aprende A Querer? (Official Audio)', 'Mora - Donde Se Aprende A Querer?'],
      ['Rels B - A Mí (Lyric Video)', 'Rels B - A Mí'],
      ['Feid - Feliz Cumpleaños Ferxxo [Video Lyric]', 'Feid - Feliz Cumpleaños Ferxxo'],
      ['Dellafuente - Consentia (Letra)', 'Dellafuente - Consentia'],
      ['Morad - Pelele (Con Letra)', 'Morad - Pelele'],
      ['Eladio Carrión - Mbappé [Visualizer]', 'Eladio Carrión - Mbappé'],
      ['JC Reyes - Fardos (Visualizador)', 'JC Reyes - Fardos'],
      ['Myke Towers - LALA (Videoclip Oficial)', 'Myke Towers - LALA'],
      ['Dei V - Quién Es Dei V?! (HD) [4K] (1080p)', 'Dei V - Quién Es Dei V?!'],
      ['Quevedo - Quédate (Prod. by Bizarrap)', 'Quevedo - Quédate'],
      ['Cruz Cafuné - Movezz [Prod. Sky]', 'Cruz Cafuné - Movezz'],
      ['Bad Bunny - Titi Me Preguntó (Prod. by Sky, Tainy)', 'Bad Bunny - Titi Me Preguntó'],
      ['Track Name （Video Oficial）【4K】', 'Track Name'],
      ['Song Title (Official Video | 4K)', 'Song Title'],
      ['Song Title (Official Music Video 4K HD)', 'Song Title'],
      ['Song Title (Letra / Lyrics)', 'Song Title'],
      ['Song Title (Official Video, 4K)', 'Song Title'],
    ];

    for (const [input, expected] of cases) {
      expect(sanitizeTrackTitle(input)).toBe(expected);
    }
  });

  it('strips chained, interleaved, and explicit trailing separator noise', () => {
    expect(sanitizeTrackTitle('Cayó La Noche (feat. Quevedo) (Official Video) [4K]')).toBe(
      'Cayó La Noche (feat. Quevedo)'
    );
    expect(sanitizeTrackTitle('Cayó La Noche [Official Video] (Remix)')).toBe(
      'Cayó La Noche (Remix)'
    );
    expect(sanitizeTrackTitle('Mina el Hammani - Video Oficial')).toBe('Mina el Hammani');
    expect(sanitizeTrackTitle('Monaco | Official Audio')).toBe('Monaco');
    expect(sanitizeTrackTitle('Columbia - Prod. by Tainy')).toBe('Columbia');
    expect(sanitizeTrackTitle('Song (Official Video) -')).toBe('Song');
    expect(sanitizeTrackTitle('Spider-Man (Official Video)')).toBe('Spider-Man');
  });

  it('strictly preserves meaningful musical markers and real song titles', () => {
    const preservedCases: readonly string[] = [
      'Cayó La Noche (Remix)',
      'Monaco (Official Remix)',
      'Columbia (Acoustic)',
      'Supernova (Acústico)',
      'A Mí (Live)',
      'Consentia (En Vivo)',
      'Pelele (feat. Quevedo)',
      'Mbappé (ft. Bad Bunny)',
      'LALA (Slowed + Reverb)',
      'LALA (Sped Up)',
      'Quevedo: Bzrp Music Sessions, Vol. 52 (Bzrp Music Sessions, Vol. 52)',
      'Anthem (Product of Spain)',
      'Firestarter (Prodigy Remix)',
      'El Alfa, Darell, Noriel - 4K',
    ];

    for (const title of preservedCases) {
      expect(sanitizeTrackTitle(title)).toBe(title);
    }
  });

  it('never returns an empty string for non-empty noise-only input', () => {
    expect(sanitizeTrackTitle('(Official Video)')).toBe('(Official Video)');
    expect(sanitizeTrackTitle('  [4K]  ')).toBe('[4K]');
    expect(sanitizeTrackTitle('')).toBe('');
    expect(sanitizeTrackTitle('   \u00A0  ')).toBe('');
  });

  it('executes in linear O(N) time without ReDoS backtracking on adversarial input', () => {
    const adversarial = `Track (${'HD '.repeat(10_000)}Remix)`;
    const startMs = performance.now();
    const output = sanitizeTrackTitle(adversarial);
    const elapsedMs = performance.now() - startMs;
    expect(elapsedMs).toBeLessThan(150);
    expect(output.startsWith('Track (')).toBe(true);
    expect(output.endsWith('Remix)')).toBe(true);
  });
});

describe('formatDurationMs & formatDurationSec', () => {
  it('handles 0, negatives, NaN, and Infinity safely as 0:00', () => {
    expect(formatDurationMs(0)).toBe('0:00');
    expect(formatDurationMs(-0)).toBe('0:00');
    expect(formatDurationMs(-1)).toBe('0:00');
    expect(formatDurationMs(-60_000)).toBe('0:00');
    expect(formatDurationMs(Number.NaN)).toBe('0:00');
    expect(formatDurationMs(Number.POSITIVE_INFINITY)).toBe('0:00');
    expect(formatDurationMs(Number.NEGATIVE_INFINITY)).toBe('0:00');
  });

  it('strictly floors sub-second values and formats exact minute/hour boundaries', () => {
    expect(formatDurationMs(1)).toBe('0:00');
    expect(formatDurationMs(500)).toBe('0:00');
    expect(formatDurationMs(999)).toBe('0:00');
    expect(formatDurationMs(1_000)).toBe('0:01');
    expect(formatDurationMs(9_999)).toBe('0:09');
    expect(formatDurationMs(10_000)).toBe('0:10');
    expect(formatDurationMs(59_999)).toBe('0:59');
    expect(formatDurationMs(60_000)).toBe('1:00');
    expect(formatDurationMs(188_571)).toBe('3:08');
    expect(formatDurationMs(244_000)).toBe('4:04');
    expect(formatDurationMs(605_000)).toBe('10:05');
    expect(formatDurationMs(3_599_999)).toBe('59:59');
    expect(formatDurationMs(3_600_000)).toBe('1:00:00');
    expect(formatDurationMs(3_661_000)).toBe('1:01:01');
    expect(formatDurationMs(36_000_000)).toBe('10:00:00');
    expect(formatDurationMs(360_000_000)).toBe('100:00:00');
  });

  it('formats seconds via formatDurationSec consistently', () => {
    expect(formatDurationSec(0)).toBe('0:00');
    expect(formatDurationSec(-5)).toBe('0:00');
    expect(formatDurationSec(Number.NaN)).toBe('0:00');
    expect(formatDurationSec(Number.POSITIVE_INFINITY)).toBe('0:00');
    expect(formatDurationSec(59.999)).toBe('0:59');
    expect(formatDurationSec(60)).toBe('1:00');
    expect(formatDurationSec(244)).toBe('4:04');
    expect(formatDurationSec(3661)).toBe('1:01:01');
  });
});

describe('clamp', () => {
  it('clamps values within normal and degenerate intervals', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-3, 0, 10)).toBe(0);
    expect(clamp(15, 0, 10)).toBe(10);
    expect(clamp(0, 0, 10)).toBe(0);
    expect(clamp(10, 0, 10)).toBe(10);
    expect(clamp(5, 3, 3)).toBe(3);
  });

  it('normalizes inverted min > max bounds defensively', () => {
    expect(clamp(5, 10, 0)).toBe(5);
    expect(clamp(-2, 10, 0)).toBe(0);
    expect(clamp(12, 10, 0)).toBe(10);
  });

  it('guards NaN, Infinity, and normalizes -0 to +0', () => {
    expect(clamp(Number.NaN, -12, 12)).toBe(-12);
    expect(Object.is(clamp(Number.NaN, -0, 10), 0)).toBe(true);
    expect(Number.isNaN(clamp(5, Number.NaN, 10))).toBe(true);
    expect(Number.isNaN(clamp(5, 0, Number.NaN))).toBe(true);
    expect(clamp(Number.POSITIVE_INFINITY, 0, 10)).toBe(10);
    expect(clamp(Number.NEGATIVE_INFINITY, 0, 10)).toBe(0);
    expect(clamp(5, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY)).toBe(5);
    expect(Object.is(clamp(-0, -5, 5), 0)).toBe(true);
  });
});

describe('mapRuntimeToDevicePlatform', () => {
  it('maps electron -> windows, android -> android, web -> web', () => {
    expect(mapRuntimeToDevicePlatform('electron')).toBe('windows');
    expect(mapRuntimeToDevicePlatform('android')).toBe('android');
    expect(mapRuntimeToDevicePlatform('web')).toBe('web');
  });
});
