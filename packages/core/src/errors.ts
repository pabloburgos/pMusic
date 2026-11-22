export const PROVIDER_ERROR_CODES = Object.freeze([
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
] as const);

export type ProviderErrorCode = (typeof PROVIDER_ERROR_CODES)[number];

const PROVIDER_ERROR_CODE_SET: ReadonlySet<string> = new Set(PROVIDER_ERROR_CODES);

export class DomainError extends Error {
  public readonly code: ProviderErrorCode;
  public readonly retryAfterSec?: number;
  public override readonly cause?: unknown;

  constructor(
    code: ProviderErrorCode,
    message: string,
    retryAfterSec?: number,
    cause?: unknown
  ) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = 'DomainError';
    this.code = code;
    if (retryAfterSec !== undefined) {
      this.retryAfterSec = retryAfterSec;
    } else {
      delete (this as { retryAfterSec?: number }).retryAfterSec;
    }
    if (cause !== undefined) {
      this.cause = cause;
    } else {
      delete (this as { cause?: unknown }).cause;
    }
    // Preserve prototype chain across transpilation, ESM, and subclass boundaries
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function isDomainError(value: unknown): value is DomainError {
  if (value instanceof DomainError) {
    return true;
  }
  if (
    value instanceof Error &&
    value.name === 'DomainError' &&
    'code' in value &&
    typeof (value as { code: unknown }).code === 'string' &&
    PROVIDER_ERROR_CODE_SET.has((value as { code: string }).code)
  ) {
    return true;
  }
  return false;
}
