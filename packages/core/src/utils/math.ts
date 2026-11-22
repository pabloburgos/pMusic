export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(min) || Number.isNaN(max)) {
    return Number.NaN;
  }
  const low = min <= max ? min : max;
  const high = min <= max ? max : min;
  if (Number.isNaN(value)) {
    return low === 0 ? 0 : low;
  }
  if (value < low) {
    return low === 0 ? 0 : low;
  }
  if (value > high) {
    return high === 0 ? 0 : high;
  }
  return value === 0 ? 0 : value;
}

export function clampEqGainDb(value: number): number {
  return clamp(Number.isFinite(value) ? value : 0, -12, 12);
}

export function clampAffinityScore(value: number): number {
  return clamp(Number.isFinite(value) ? value : 0, -20, 200);
}

export function computeDecayedScore(
  initialScore: number,
  elapsedDays: number,
  halfLifeDays = 14
): number {
  if (!Number.isFinite(initialScore) || initialScore === 0) return 0;
  if (!Number.isFinite(elapsedDays) || elapsedDays <= 0) return initialScore;
  const safeHalfLife = halfLifeDays > 0 ? halfLifeDays : 14;
  return initialScore * Math.pow(2, -elapsedDays / safeHalfLife);
}

