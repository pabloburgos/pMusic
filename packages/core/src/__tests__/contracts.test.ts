import { describe, expect, expectTypeOf, it } from 'vitest';
import * as core from '../index.ts';
import type {
  IAudioEngine,
  IDjPlanner,
  ILrcParser,
  ILyricsProvider,
  IMusicProvider,
  IPlatformBridge,
  IPlaylistImporter,
  IPreferencesStorageBridge,
  IRecommendationEngine,
  ISyncEngine,
  PMusicDesignTokens,
  PlaylistRecordSource,
  PlaylistSummarySource,
  RemoteCommandInput,
  TopResultMatch,
  Track,
} from '../index.ts';

describe('@pmusic/core Public Barrel & Frozen Contract Type Safety', () => {
  it('exports all runtime constants, error classes, and pure utilities from root barrel', () => {
    expect(typeof core.DomainError).toBe('function');
    expect(typeof core.isDomainError).toBe('function');
    expect(Array.isArray(core.PROVIDER_ERROR_CODES)).toBe(true);
    expect(Array.isArray(core.DEFAULT_SPANISH_URBAN_SEEDS)).toBe(true);
    expect(typeof core.SIGNAL_WEIGHTS).toBe('object');
    expect(core.AFFINITY_HALF_LIFE_DAYS).toBe(14);
    expect(Array.isArray(core.USER_EQ_FREQUENCIES_HZ)).toBe(true);
    expect(Array.isArray(core.USER_EQ_PRESETS)).toBe(true);
    expect(typeof core.USER_EQ_PRESET_MAP).toBe('object');
    expect(typeof core.PMUSIC_DESIGN_TOKENS).toBe('object');
    expect(core.PMUSIC_TOKENS).toBe(core.PMUSIC_DESIGN_TOKENS);
    expect(typeof core.PMUSIC_CSS_VARIABLES).toBe('object');

    expect(typeof core.normalizeArtistKey).toBe('function');
    expect(typeof core.sanitizeTrackTitle).toBe('function');
    expect(typeof core.formatDurationMs).toBe('function');
    expect(typeof core.formatDurationSec).toBe('function');
    expect(typeof core.clamp).toBe('function');
    expect(typeof core.mapRuntimeToDevicePlatform).toBe('function');
    expect(typeof core.parseHexColor).toBe('function');
    expect(typeof core.parseRgbaColor).toBe('function');
    expect(typeof core.compositeOverHex).toBe('function');
    expect(typeof core.relativeLuminance).toBe('function');
    expect(typeof core.wcagContrastRatio).toBe('function');
    expect(typeof core.meetsWcagAA).toBe('function');
  });

  it('preserves discriminated union narrowing on RemoteCommandInput via DistributiveOmit', () => {
    type SeekInput = Extract<RemoteCommandInput, { type: 'seek' }>;
    type TransferInput = Extract<RemoteCommandInput, { type: 'transfer' }>;
    type SetDjModeInput = Extract<RemoteCommandInput, { type: 'set_dj_mode' }>;

    expectTypeOf<SeekInput>().toHaveProperty('positionMs');
    expectTypeOf<SeekInput>().toHaveProperty('targetDeviceId');
    expectTypeOf<TransferInput>().toHaveProperty('snapshot');
    expectTypeOf<SetDjModeInput>().toHaveProperty('enabled');
    expectTypeOf<SetDjModeInput>().toHaveProperty('style');

    const seekCmd: RemoteCommandInput = {
      targetDeviceId: 'pc-win-01',
      type: 'seek',
      positionMs: 42_000,
    };
    expect(seekCmd.type).toBe('seek');
  });

  it('narrows TopResultMatch.item by kind without unsafe casts', () => {
    const sampleTrack: Track = {
      id: 'dQw4w9WgXcQ',
      title: 'Mina el Hammani',
      artists: [{ id: 'UC123', name: 'Cruz Cafuné' }],
      durationSec: 215,
      thumbnailUrl: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
      source: 'ytmusic',
    };

    const match: TopResultMatch = { kind: 'song', item: sampleTrack };
    if (match.kind === 'song') {
      expectTypeOf(match.item).toEqualTypeOf<Track>();
      expect(match.item.durationSec).toBe(215);
    }
  });

  it('maintains SQL-compatible PlaylistRecordSource vs PlaylistSummarySource and Supabase storage shape', () => {
    expectTypeOf<PlaylistRecordSource>().toEqualTypeOf<
      'local' | 'imported_spotify' | 'imported_youtube' | 'mix'
    >();
    expectTypeOf<PlaylistRecordSource>().toMatchTypeOf<PlaylistSummarySource>();

    interface SupabaseSupportedStorageLike {
      getItem: (key: string) => Promise<string | null>;
      setItem: (key: string, value: string) => Promise<void>;
      removeItem: (key: string) => Promise<void>;
    }
    expectTypeOf<IPreferencesStorageBridge>().toMatchTypeOf<SupabaseSupportedStorageLike>();
    expectTypeOf<IPlatformBridge>().toBeObject();
    expectTypeOf<IMusicProvider>().toBeObject();
    expectTypeOf<ILyricsProvider>().toBeObject();
    expectTypeOf<ILrcParser>().toBeObject();
    expectTypeOf<IPlaylistImporter>().toBeObject();
    expectTypeOf<IAudioEngine>().toBeObject();
    expectTypeOf<IDjPlanner>().toBeObject();
    expectTypeOf<IRecommendationEngine>().toBeObject();
    expectTypeOf<ISyncEngine>().toBeObject();
    expectTypeOf<PMusicDesignTokens>().toBeObject();
  });

  it('contains zero references to prohibited third-party branding in serialized runtime exports', () => {
    const serialized = JSON.stringify({
      codes: core.PROVIDER_ERROR_CODES,
      seeds: core.DEFAULT_SPANISH_URBAN_SEEDS,
      weights: core.SIGNAL_WEIGHTS,
      eq: core.USER_EQ_PRESETS,
      tokens: core.PMUSIC_DESIGN_TOKENS,
    });
    const forbiddenPattern = new RegExp(
      ['try' + 'li' + 'ner', 'li' + 'ner-signer', 'feral' + 'bureau', '\\bli' + 'ner\\b'].join('|'),
      'i'
    );
    expect(serialized).not.toMatch(forbiddenPattern);
  });
});
