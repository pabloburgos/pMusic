import { describe, expect, it } from 'vitest';
import {
  DomainError,
  PROVIDER_ERROR_CODES,
  isDomainError,
  type ProviderErrorCode,
} from '../index.ts';

class CustomSubDomainError extends DomainError {
  public readonly endpoint: string;

  constructor(code: ProviderErrorCode, message: string, endpoint: string) {
    super(code, message);
    this.name = 'CustomSubDomainError';
    this.endpoint = endpoint;
  }
}

describe('DomainError & PROVIDER_ERROR_CODES', () => {
  it('freezes all 11 canonical ProviderErrorCode values', () => {
    expect(Object.isFrozen(PROVIDER_ERROR_CODES)).toBe(true);
    expect(PROVIDER_ERROR_CODES).toEqual([
      'NETWORK_OFFLINE',
      'RATE_LIMITED',
      'TRACK_UNPLAYABLE',
      'AUDIO_STREAM_FORBIDDEN',
      'PLAYLIST_PRIVATE_OR_NOT_FOUND',
      'INVALID_PLAYLIST_URL',
      'SPOTIFY_EXTRACT_FAILED',
      'LYRICS_NOT_FOUND',
      'AUTH_REQUIRED',
      'SYNC_UNAVAILABLE',
      'ABORTED',
    ]);
  });

  it('preserves instanceof Error and instanceof DomainError with prototype chain intact', () => {
    const err = new DomainError('NETWORK_OFFLINE', 'Sin conexión a internet');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(DomainError);
    expect(err.name).toBe('DomainError');
    expect(err.code).toBe('NETWORK_OFFLINE');
    expect(err.message).toBe('Sin conexión a internet');
    expect(typeof err.stack).toBe('string');
  });

  it('omits retryAfterSec and cause keys when not provided', () => {
    const err = new DomainError('LYRICS_NOT_FOUND', 'No se encontraron letras');
    expect(err.retryAfterSec).toBeUndefined();
    expect(err.cause).toBeUndefined();
    expect('retryAfterSec' in err).toBe(false);
    expect('cause' in err).toBe(false);
  });

  it('stores retryAfterSec and cause when provided', () => {
    const rootCause = new TypeError('Fetch failed');
    const err = new DomainError('RATE_LIMITED', 'Demasiadas peticiones a LRCLIB', 12, rootCause);
    expect(err.code).toBe('RATE_LIMITED');
    expect(err.retryAfterSec).toBe(12);
    expect(err.cause).toBe(rootCause);
  });

  it('supports every ProviderErrorCode value and custom subclasses', () => {
    for (const code of PROVIDER_ERROR_CODES) {
      const err = new DomainError(code, `Error for ${code}`);
      expect(err.code).toBe(code);
      expect(isDomainError(err)).toBe(true);
    }

    const sub = new CustomSubDomainError(
      'AUDIO_STREAM_FORBIDDEN',
      '403 Forbidden from stream upstream',
      '/api/stream/dQw4w9WgXcQ'
    );
    expect(sub).toBeInstanceOf(Error);
    expect(sub).toBeInstanceOf(DomainError);
    expect(sub).toBeInstanceOf(CustomSubDomainError);
    expect(sub.endpoint).toBe('/api/stream/dQw4w9WgXcQ');
    expect(isDomainError(sub)).toBe(true);
  });

  it('validates isDomainError across real instances, cross-realm Error duck types, and non-errors', () => {
    const valid = new DomainError('SPOTIFY_EXTRACT_FAILED', 'No se pudo extraer __NEXT_DATA__');
    expect(isDomainError(valid)).toBe(true);

    const crossRealmError = Object.assign(new Error('Cross-realm error'), {
      name: 'DomainError',
      code: 'SYNC_UNAVAILABLE',
    });
    expect(isDomainError(crossRealmError)).toBe(true);

    const invalidCodeError = Object.assign(new Error('Invalid code'), {
      name: 'DomainError',
      code: 'UNKNOWN_RANDOM_CODE',
    });
    expect(isDomainError(invalidCodeError)).toBe(false);

    expect(isDomainError(new Error('Plain error'))).toBe(false);
    expect(isDomainError({ name: 'DomainError', code: 'NETWORK_OFFLINE' })).toBe(false);
    expect(isDomainError(null)).toBe(false);
    expect(isDomainError(undefined)).toBe(false);
    expect(isDomainError('NETWORK_OFFLINE')).toBe(false);
  });
});
