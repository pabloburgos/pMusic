import { describe, expect, it } from 'vitest';
import {
  AFFINITY_HALF_LIFE_DAYS,
  AFFINITY_MAX_SCORE,
  AFFINITY_MIN_SCORE,
  DEFAULT_DJ_MODE_CONFIG,
  DEFAULT_SAFE_CROSSFADE_CONFIG,
  DEFAULT_SPANISH_URBAN_SEEDS,
  DEFAULT_USER_EQ_CONFIG,
  PLAYBACK_TRANSFER_MAX_QUEUE_ITEMS,
  REALTIME_CHANNEL_PREFIX,
  SIGNAL_WEIGHTS,
  SUPABASE_PRESENCE_MAX_KEYS,
  SUPABASE_PRESENCE_MIN_INTERVAL_MS,
  USER_EQ_FREQUENCIES_HZ,
  USER_EQ_MAX_DB,
  USER_EQ_MIN_DB,
  USER_EQ_PRESETS,
  USER_EQ_PRESET_MAP,
  normalizeArtistKey,
} from '../index.ts';

describe('DEFAULT_SPANISH_URBAN_SEEDS & recommendation constants', () => {
  it('defines exact 14 Spanish urban seeds with 3 primary (+8.0) and 11 scene (+4.5) priors', () => {
    expect(Object.isFrozen(DEFAULT_SPANISH_URBAN_SEEDS)).toBe(true);
    expect(DEFAULT_SPANISH_URBAN_SEEDS).toHaveLength(14);

    const primary = DEFAULT_SPANISH_URBAN_SEEDS.filter((s) => s.priorWeight === 8.0);
    const scene = DEFAULT_SPANISH_URBAN_SEEDS.filter((s) => s.priorWeight === 4.5);

    expect(primary.map((s) => s.artistKey)).toEqual([
      'bad bunny',
      'la pantera',
      'cruz cafune',
    ]);
    expect(scene).toHaveLength(11);
    expect(scene.map((s) => s.artistKey)).toEqual([
      'quevedo',
      'saiko',
      'mora',
      'rels b',
      'feid',
      'dellafuente',
      'eladio carrion',
      'myke towers',
      'jc reyes',
      'morad',
      'dei v',
    ]);

    const seenKeys = new Set<string>();
    for (const seed of DEFAULT_SPANISH_URBAN_SEEDS) {
      expect(Object.isFrozen(seed)).toBe(true);
      expect(Object.isFrozen(seed.genres)).toBe(true);
      expect(seenKeys.has(seed.artistKey)).toBe(false);
      seenKeys.add(seed.artistKey);
      expect(seed.artistKey).toBe(normalizeArtistKey(seed.displayName));
      expect(seed.genres.length).toBeGreaterThan(0);
    }
  });

  it('defines exact SIGNAL_WEIGHTS and 14-day exponential decay constants', () => {
    expect(Object.isFrozen(SIGNAL_WEIGHTS)).toBe(true);
    expect(SIGNAL_WEIGHTS).toEqual({
      skip_early: -1.0,
      complete_listen: 2.0,
      repeat_loop: 3.5,
      like: 5.0,
      add_to_playlist: 5.0,
      unlike: -3.5,
    });
    expect(SIGNAL_WEIGHTS.like).toBeGreaterThanOrEqual(SIGNAL_WEIGHTS.add_to_playlist);
    expect(SIGNAL_WEIGHTS.add_to_playlist).toBeGreaterThan(SIGNAL_WEIGHTS.repeat_loop);
    expect(SIGNAL_WEIGHTS.repeat_loop).toBeGreaterThan(SIGNAL_WEIGHTS.complete_listen);
    expect(SIGNAL_WEIGHTS.complete_listen).toBeGreaterThan(0);
    expect(SIGNAL_WEIGHTS.skip_early).toBeLessThan(0);
    expect(SIGNAL_WEIGHTS.unlike).toBeLessThan(SIGNAL_WEIGHTS.skip_early);

    expect(AFFINITY_HALF_LIFE_DAYS).toBe(14);
    expect(AFFINITY_MIN_SCORE).toBe(-20);
    expect(AFFINITY_MAX_SCORE).toBe(200);
  });
});

describe('USER_EQ_PRESETS & Audio/DJ defaults', () => {
  it('defines 5 ascending center frequencies [60, 230, 910, 3600, 14000]', () => {
    expect(Object.isFrozen(USER_EQ_FREQUENCIES_HZ)).toBe(true);
    expect(USER_EQ_FREQUENCIES_HZ).toEqual([60, 230, 910, 3600, 14000]);
    for (let i = 1; i < USER_EQ_FREQUENCIES_HZ.length; i++) {
      expect(USER_EQ_FREQUENCIES_HZ[i]!).toBeGreaterThan(USER_EQ_FREQUENCIES_HZ[i - 1]!);
    }
  });

  it('defines exact 7 Spanish EQ presets with 5 bands within [-12, +12] dB', () => {
    expect(Object.isFrozen(USER_EQ_PRESETS)).toBe(true);
    expect(USER_EQ_PRESETS).toHaveLength(7);
    expect(USER_EQ_PRESETS.map((p) => p.label)).toEqual([
      'Plano',
      'Urbano / Graves',
      'Bass Boosted',
      'Vocal',
      'Electrónica',
      'Acústico',
      'Personalizado',
    ]);
    expect(USER_EQ_PRESETS.map((p) => p.id)).toEqual([
      'flat',
      'urbano',
      'bass_boosted',
      'vocal',
      'electronic',
      'acoustic',
      'custom',
    ]);

    for (const preset of USER_EQ_PRESETS) {
      expect(Object.isFrozen(preset)).toBe(true);
      expect(Object.isFrozen(preset.bandsDb)).toBe(true);
      expect(preset.bandsDb).toHaveLength(5);
      expect(preset.description.length).toBeGreaterThan(0);
      expect(USER_EQ_PRESET_MAP[preset.id]).toBe(preset);
      for (const db of preset.bandsDb) {
        expect(Number.isFinite(db)).toBe(true);
        expect(db).toBeGreaterThanOrEqual(USER_EQ_MIN_DB);
        expect(db).toBeLessThanOrEqual(USER_EQ_MAX_DB);
      }
    }

    expect(USER_EQ_PRESET_MAP.flat.bandsDb).toEqual([0, 0, 0, 0, 0]);
    expect(USER_EQ_PRESET_MAP.custom.bandsDb).toEqual([0, 0, 0, 0, 0]);
    expect(USER_EQ_PRESET_MAP.urbano.bandsDb[0]).toBeGreaterThan(0);
    expect(USER_EQ_PRESET_MAP.vocal.bandsDb[2]).toBeGreaterThan(0);
    expect(USER_EQ_PRESET_MAP.vocal.bandsDb[3]).toBeGreaterThan(0);
  });

  it('defines frozen default configs for EQ, Safe Crossfade, and DJ AutoMix mode', () => {
    expect(Object.isFrozen(DEFAULT_USER_EQ_CONFIG)).toBe(true);
    expect(DEFAULT_USER_EQ_CONFIG.preset).toBe('flat');
    expect(DEFAULT_SAFE_CROSSFADE_CONFIG).toEqual({ enabled: false, durationSec: 4 });
    expect(DEFAULT_DJ_MODE_CONFIG).toEqual({
      enabled: false,
      style: 'quick',
      autoReorderQueue: true,
      preferredTransition: 'auto',
      enabledTransitions: {
        eq_swap: true,
        filter_sweep: true,
        echo_out: true,
      },
      tempoMatching: true,
    });
  });
});

describe('Supabase Free Tier sync constants', () => {
  it('enforces Free Tier Presence & Broadcast limits', () => {
    expect(SUPABASE_PRESENCE_MAX_KEYS).toBe(10);
    expect(SUPABASE_PRESENCE_MIN_INTERVAL_MS).toBeGreaterThanOrEqual(8_000);
    expect(PLAYBACK_TRANSFER_MAX_QUEUE_ITEMS).toBe(100);
    expect(REALTIME_CHANNEL_PREFIX).toBe('pmusic:user:');
  });
});
