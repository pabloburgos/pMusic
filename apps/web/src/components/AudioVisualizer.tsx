import React, { useEffect, useRef } from 'react';
import { getLiveAnalyserData, usePMusicStore } from '../store/usePMusicStore.ts';

const BAR_COUNT = 14;
const IDLE_BARS = [0.22, 0.34, 0.28, 0.45, 0.36, 0.52, 0.42, 0.58, 0.44, 0.36, 0.48, 0.32, 0.26, 0.2];

export const AudioVisualizer: React.FC<{
  className?: string;
  barClassName?: string;
}> = ({ className = '', barClassName = 'bg-white/80' }) => {
  const isPlaying = usePMusicStore((s) => s.isPlaying);
  const visualizerEnabled = usePMusicStore((s) => s.visualizerEnabled);
  const reducedMotionPref = usePMusicStore((s) => s.reducedMotionPref);
  const barsRef = useRef<(HTMLSpanElement | null)[]>([]);

  useEffect(() => {
    if (!visualizerEnabled) return;
    const applyBars = (levels: number[], playing: boolean) => {
      for (let i = 0; i < BAR_COUNT; i++) {
        const el = barsRef.current[i];
        if (!el) continue;
        const lvl = levels[i] ?? 0.25;
        el.style.transform = `scaleY(${lvl.toFixed(2)})`;
        el.style.opacity = playing ? (0.55 + lvl * 0.45).toFixed(2) : '0.35';
      }
    };

    if (!isPlaying || reducedMotionPref) {
      applyBars(IDLE_BARS, false);
      return;
    }

    const timer = setInterval(() => {
      const data = getLiveAnalyserData();
      const bins = data.frequencyBins;
      const stride = Math.max(1, Math.floor(bins.length / BAR_COUNT));
      const next: number[] = [];
      for (let i = 0; i < BAR_COUNT; i++) {
        const val = (bins[Math.min(bins.length - 1, i * stride)] ?? 0) / 255;
        next.push(Math.max(0.14, Math.min(1, 0.16 + val * 0.84)));
      }
      applyBars(next, true);
    }, 85);

    return () => clearInterval(timer);
  }, [isPlaying, visualizerEnabled, reducedMotionPref]);

  if (!visualizerEnabled) return null;

  return (
    <div
      aria-hidden="true"
      className={`flex h-5 items-end justify-center gap-[3px] ${className}`}
    >
      {IDLE_BARS.map((lvl, i) => (
        <span
          key={i}
          ref={(el) => {
            barsRef.current[i] = el;
          }}
          className={`pm-visualizer-bar w-[2.5px] rounded-full ${barClassName}`}
          style={{
            height: '100%',
            transform: `scaleY(${lvl.toFixed(2)})`,
            opacity: isPlaying ? 0.55 + lvl * 0.45 : 0.35,
          }}
        />
      ))}
    </div>
  );
};
