import type {
  DjModeConfig,
  SafeCrossfadeConfig,
  UserEqConfig,
  UserEqPreset,
  UserEqPresetId,
} from '../contracts/audio.ts';

export const USER_EQ_FREQUENCIES_HZ = Object.freeze([60, 230, 910, 3600, 14000] as const);
export const USER_EQ_MIN_DB = -12;
export const USER_EQ_MAX_DB = 12;

export const USER_EQ_PRESETS: readonly UserEqPreset[] = Object.freeze([
  Object.freeze({
    id: 'flat',
    label: 'Plano',
    description: 'Respuesta neutra sin alteraciones',
    bandsDb: Object.freeze([0, 0, 0, 0, 0] as const),
  }),
  Object.freeze({
    id: 'urbano',
    label: 'Urbano / Graves',
    description: 'Subgraves potentes y brillo limpio para reggaetón y trap',
    bandsDb: Object.freeze([5.5, 3.0, -1.0, 1.5, 3.0] as const),
  }),
  Object.freeze({
    id: 'bass_boosted',
    label: 'Bass Boosted',
    description: 'Subgraves y pegada de bajos reforzados al máximo',
    bandsDb: Object.freeze([9.0, 6.0, -0.5, 1.0, 2.0] as const),
  }),
  Object.freeze({
    id: 'vocal',
    label: 'Vocal',
    description: 'Realza la claridad de voces y letras',
    bandsDb: Object.freeze([-2.0, 0.5, 3.5, 4.0, 1.5] as const),
  }),
  Object.freeze({
    id: 'electronic',
    label: 'Electrónica',
    description: 'Graves profundos y agudos cristalinos para sesiones de club',
    bandsDb: Object.freeze([4.5, 1.5, -1.5, 2.5, 4.5] as const),
  }),
  Object.freeze({
    id: 'acoustic',
    label: 'Acústico',
    description: 'Calidez natural para guitarras y voces acústicas',
    bandsDb: Object.freeze([1.5, 2.0, 1.0, 2.5, 2.0] as const),
  }),
  Object.freeze({
    id: 'custom',
    label: 'Personalizado',
    description: 'Ajuste manual de las 5 bandas',
    bandsDb: Object.freeze([0, 0, 0, 0, 0] as const),
  }),
]);

export const USER_EQ_PRESET_MAP: Readonly<Record<UserEqPresetId, UserEqPreset>> = Object.freeze(
  USER_EQ_PRESETS.reduce(
    (acc, preset) => {
      acc[preset.id] = preset;
      return acc;
    },
    {} as Record<UserEqPresetId, UserEqPreset>
  )
);

export const DEFAULT_USER_EQ_CONFIG: Readonly<UserEqConfig> = Object.freeze<UserEqConfig>({
  enabled: false,
  preset: 'flat',
  bandsDb: [0, 0, 0, 0, 0],
});

export const DEFAULT_SAFE_CROSSFADE_CONFIG: Readonly<SafeCrossfadeConfig> = Object.freeze({
  enabled: false,
  durationSec: 4,
});

export const DEFAULT_DJ_MODE_CONFIG: Readonly<DjModeConfig> = Object.freeze({
  enabled: false,
  style: 'quick',
  autoReorderQueue: true,
  preferredTransition: 'auto',
  enabledTransitions: Object.freeze({
    eq_swap: true,
    filter_sweep: true,
    echo_out: true,
  }),
  tempoMatching: true,
});
