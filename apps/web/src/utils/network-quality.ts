import type { AudioStreamQuality } from '@pmusic/core';

export type ConcreteStreamQuality = 'high' | 'medium' | 'low';
export type NetworkSpeedTier = 'fast' | 'moderate' | 'slow' | 'offline';

interface NavigatorConnectionLike {
  saveData?: boolean;
  effectiveType?: string;
  type?: string;
  downlink?: number;
  rtt?: number;
}

interface TelemetryState {
  consecutiveFailuresOrSlow: number;
  stepDownLevel: 0 | 1 | 2;
  stepDownExpiresAtMs: number;
}

const STEP_DOWN_WINDOW_MS = 180_000;
const telemetry: TelemetryState = {
  consecutiveFailuresOrSlow: 0,
  stepDownLevel: 0,
  stepDownExpiresAtMs: 0,
};

function readNavigatorConnection(): NavigatorConnectionLike | null {
  if (typeof navigator === 'undefined') return null;
  return (navigator as unknown as { connection?: NavigatorConnectionLike }).connection ?? null;
}

export function isNativeMeteredNetwork(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const bridge = (window as unknown as {
      PMusicNative?: { isMeteredNetwork?: () => boolean };
    }).PMusicNative;
    if (typeof bridge?.isMeteredNetwork === 'function') {
      return Boolean(bridge.isMeteredNetwork());
    }
  } catch {
    // ignore native bridge errors
  }
  return false;
}

export function isMeteredOrCellularNetwork(): boolean {
  if (isNativeMeteredNetwork()) return true;
  const conn = readNavigatorConnection();
  if (!conn) return false;
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
  return false;
}

export function getNetworkSpeedTier(): NetworkSpeedTier {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return 'offline';
  }
  const conn = readNavigatorConnection();
  const saveData = Boolean(conn?.saveData);
  const eff = (conn?.effectiveType ?? '').toLowerCase();
  const downlink = typeof conn?.downlink === 'number' ? conn.downlink : 0;
  const rtt = typeof conn?.rtt === 'number' ? conn.rtt : 0;

  if (
    saveData ||
    eff === 'slow-2g' ||
    eff === '2g' ||
    (downlink > 0 && downlink < 1.2) ||
    rtt >= 450
  ) {
    return 'slow';
  }

  if (
    eff === '3g' ||
    (downlink > 0 && downlink < 4.5) ||
    rtt >= 180 ||
    isMeteredOrCellularNetwork()
  ) {
    return 'moderate';
  }

  return 'fast';
}

/**
 * Records observed audio stream load speed/failures so Auto mode proactively steps down
 * under weak mobile coverage and smoothly recovers once fast loads return.
 */
export function recordStreamLoadTelemetry(durationMs: number, failed: boolean): void {
  const now = Date.now();
  if (failed || durationMs >= 2600) {
    telemetry.consecutiveFailuresOrSlow += 1;
    telemetry.stepDownLevel =
      failed || telemetry.consecutiveFailuresOrSlow >= 2 ? 2 : 1;
    telemetry.stepDownExpiresAtMs = now + STEP_DOWN_WINDOW_MS;
    return;
  }
  if (durationMs <= 1200) {
    telemetry.consecutiveFailuresOrSlow = 0;
    if (telemetry.stepDownLevel > 0) {
      telemetry.stepDownLevel = (telemetry.stepDownLevel - 1) as 0 | 1 | 2;
      telemetry.stepDownExpiresAtMs = telemetry.stepDownLevel > 0 ? now + STEP_DOWN_WINDOW_MS / 2 : 0;
    }
  }
}

export function resetNetworkQualityTelemetry(): void {
  telemetry.consecutiveFailuresOrSlow = 0;
  telemetry.stepDownLevel = 0;
  telemetry.stepDownExpiresAtMs = 0;
}

export function resolveEffectiveStreamQuality(
  pref: AudioStreamQuality = 'auto'
): ConcreteStreamQuality {
  if (pref !== 'auto') {
    return pref;
  }

  const now = Date.now();
  if (telemetry.stepDownExpiresAtMs > 0 && now > telemetry.stepDownExpiresAtMs) {
    resetNetworkQualityTelemetry();
  }

  const tier = getNetworkSpeedTier();
  let base: ConcreteStreamQuality =
    tier === 'slow' ? 'low' : tier === 'moderate' ? 'medium' : 'high';

  if (telemetry.stepDownLevel === 2) {
    base = 'low';
  } else if (telemetry.stepDownLevel === 1) {
    base = base === 'high' ? 'medium' : 'low';
  }

  return base;
}

export function getAutoQualityStatusLabel(): string {
  const tier = getNetworkSpeedTier();
  const effective = resolveEffectiveStreamQuality('auto');
  const tierHint =
    tier === 'offline'
      ? 'sin conexión'
      : effective === 'low'
        ? 'red débil/lenta'
        : tier === 'moderate'
          ? 'datos móviles'
          : 'Wi-Fi / 5G rápida';
  const qualityLabel =
    effective === 'high' ? 'Alta' : effective === 'medium' ? 'Equilibrada' : 'Ligera';
  return `Auto · ${qualityLabel} (${tierHint})`;
}
