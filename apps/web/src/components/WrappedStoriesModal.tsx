import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Disc3,
  Download,
  Flame,
  Headphones,
  Music2,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import type { Track } from '@pmusic/core';
import { usePMusicStore } from '../store/usePMusicStore.ts';
import type { WrappedSummary } from '../lib/wrapped-stats.ts';
import { triggerHaptic } from '../utils/haptics.ts';

interface SlideVisualTheme {
  background: string;
  accentHex: string;
  pillTextClass: string;
  kicker: string;
}

const SLIDE_THEMES: readonly SlideVisualTheme[] = [
  {
    background:
      'radial-gradient(circle at 18% 18%, #7e22ce 0%, #3b0764 42%, #07050c 100%)',
    accentHex: '#d9f99d',
    pillTextClass: 'text-[#d9f99d]',
    kicker: 'pMusic Wrapped',
  },
  {
    background:
      'radial-gradient(circle at 82% 20%, #0284c7 0%, #1e1b4b 48%, #05070e 100%)',
    accentHex: '#67e8f9',
    pillTextClass: 'text-cyan-300',
    kicker: 'Tiempo contigo',
  },
  {
    background:
      'radial-gradient(circle at 24% 24%, #e11d48 0%, #581c87 46%, #07060b 100%)',
    accentHex: '#fda4af',
    pillTextClass: 'text-rose-300',
    kicker: 'Tu artista #1',
  },
  {
    background:
      'radial-gradient(circle at 72% 18%, #059669 0%, #064e3b 44%, #040908 100%)',
    accentHex: '#6ee7b7',
    pillTextClass: 'text-emerald-300',
    kicker: 'En bucle todo el año',
  },
  {
    background:
      'radial-gradient(circle at 26% 20%, #ea580c 0%, #701a75 48%, #09050c 100%)',
    accentHex: '#fcd34d',
    pillTextClass: 'text-amber-300',
    kicker: 'Tu ADN de géneros',
  },
  {
    background:
      'radial-gradient(circle at 78% 22%, #6366f1 0%, #115e59 46%, #05070d 100%)',
    accentHex: '#a5f3fc',
    pillTextClass: 'text-sky-300',
    kicker: 'Tu aura sonora',
  },
  {
    background:
      'linear-gradient(155deg, #4c1d95 0%, #be185d 38%, #0369a1 76%, #05050a 100%)',
    accentHex: '#f5d0fe',
    pillTextClass: 'text-[#f5d0fe]',
    kicker: 'Tarjeta para compartir',
  },
];

/**
 * Assigns a distinct song to each of the 7 Wrapped story slides whenever
 * the soundtrack has enough distinct tracks (e.g., slide 3 gets #1 top track,
 * slide 2 prefers a different track by #1 top artist, and all other slides
 * fill strictly with unused tracks).
 */
export function buildDistinctSlideTracks(
  soundtrack: readonly Track[],
  summary: WrappedSummary | null
): (Track | null)[] {
  const slots: (Track | null)[] = Array(7).fill(null);
  if (soundtrack.length === 0) return slots;

  const usedIds = new Set<string>();
  const usedKeys = new Set<string>();
  const normKey = (t: Track) =>
    `${t.title.trim().toLowerCase()}::${(t.artists[0]?.name ?? '').trim().toLowerCase()}`;
  const markUsed = (t: Track) => {
    usedIds.add(t.id);
    usedKeys.add(normKey(t));
  };
  const isUnused = (t: Track) => !usedIds.has(t.id) && !usedKeys.has(normKey(t));

  // Slide 3 ("Tu canción en bucle"): match #1 top track if present
  const topTrackEntry = summary?.topTracks[0];
  if (topTrackEntry) {
    const topTitleLow = topTrackEntry.title.trim().toLowerCase();
    const match = soundtrack.find(
      (t) =>
        isUnused(t) &&
        (t.id === topTrackEntry.key || t.title.trim().toLowerCase() === topTitleLow)
    );
    if (match) {
      slots[3] = match;
      markUsed(match);
    }
  }

  // Slide 2 ("Tu artista #1"): prefer a distinct song from #1 top artist
  const topArtistName = summary?.topArtists[0]?.title.trim().toLowerCase();
  if (topArtistName) {
    const artistMatch = soundtrack.find(
      (t) =>
        isUnused(t) &&
        t.artists.some((a) => a.name.trim().toLowerCase() === topArtistName)
    );
    if (artistMatch) {
      slots[2] = artistMatch;
      markUsed(artistMatch);
    }
  }

  // Fill every remaining slide with a strictly unused track first
  for (let i = 0; i < slots.length; i++) {
    if (slots[i]) continue;
    const nextFresh = soundtrack.find(isUnused);
    if (nextFresh) {
      slots[i] = nextFresh;
      markUsed(nextFresh);
    }
  }

  // Only if catalog itself has < 7 songs total, cycle cleanly without back-to-back repeats
  for (let i = 0; i < slots.length; i++) {
    if (!slots[i]) {
      slots[i] = soundtrack[i % soundtrack.length] ?? null;
    }
  }

  return slots;
}

function useCountUp(target: number, slideKey: string, durationMs = 780): number {
  const [val, setVal] = useState(0);
  useEffect(() => {
    if (target <= 0) {
      setVal(0);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - p, 3);
      setVal(Math.round(target * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, slideKey, durationMs]);
  return val;
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function loadCorsImage(url?: string): Promise<HTMLImageElement | null> {
  if (!url) return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const timer = window.setTimeout(() => resolve(null), 2600);
    img.onload = () => {
      window.clearTimeout(timer);
      resolve(img);
    };
    img.onerror = () => {
      window.clearTimeout(timer);
      resolve(null);
    };
    img.src = url;
  });
}

async function downloadWrappedStoryCard(
  summary: WrappedSummary,
  handle: string,
  displayName?: string
): Promise<void> {
  const canvas = document.createElement('canvas');
  canvas.width = 1080;
  canvas.height = 1920;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const bg = ctx.createLinearGradient(0, 0, 1080, 1920);
  bg.addColorStop(0, '#1e0b3a');
  bg.addColorStop(0.32, '#4c0d48');
  bg.addColorStop(0.68, '#102247');
  bg.addColorStop(1, '#06070c');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 1080, 1920);

  const paintOrb = (cx: number, cy: number, radius: number, color: string) => {
    const g = ctx.createRadialGradient(cx, cy, 10, cx, cy, radius);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
  };

  paintOrb(220, 320, 520, 'rgba(192, 132, 252, 0.42)');
  paintOrb(880, 480, 540, 'rgba(244, 63, 94, 0.36)');
  paintOrb(540, 1180, 620, 'rgba(56, 189, 248, 0.28)');
  paintOrb(240, 1660, 480, 'rgba(52, 211, 153, 0.24)');

  ctx.fillStyle = '#e2ccff';
  ctx.font = '900 34px system-ui, -apple-system, sans-serif';
  ctx.fillText(`pMusic WRAPPED ${summary.year}`, 78, 128);

  const label = displayName
    ? `${displayName}${handle ? ` · @${handle}` : ''}`
    : handle
      ? `@${handle}`
      : 'Tu resumen del año';
  ctx.fillStyle = 'rgba(255,255,255,0.78)';
  ctx.font = '600 28px system-ui, -apple-system, sans-serif';
  ctx.fillText(label, 78, 174);

  const heroUrl = summary.topTracks[0]?.thumbnailUrl ?? summary.topArtists[0]?.thumbnailUrl;
  const heroImg = await loadCorsImage(heroUrl);

  drawRoundedRect(ctx, 78, 224, 924, 344, 42);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
  ctx.lineWidth = 2;
  ctx.stroke();

  if (heroImg) {
    ctx.save();
    drawRoundedRect(ctx, 114, 260, 272, 272, 32);
    ctx.clip();
    ctx.drawImage(heroImg, 114, 260, 272, 272);
    ctx.restore();
  } else {
    drawRoundedRect(ctx, 114, 260, 272, 272, 32);
    const artFallback = ctx.createLinearGradient(114, 260, 386, 532);
    artFallback.addColorStop(0, '#c084fc');
    artFallback.addColorStop(1, '#f43f5e');
    ctx.fillStyle = artFallback;
    ctx.fill();
  }

  ctx.fillStyle = '#f472b6';
  ctx.font = '800 24px system-ui, -apple-system, sans-serif';
  ctx.fillText('TU MINUTO MUSICAL', 420, 316);

  ctx.fillStyle = '#ffffff';
  ctx.font = '900 108px system-ui, -apple-system, sans-serif';
  ctx.fillText(`${summary.totalMinutes.toLocaleString('es-ES')}`, 420, 424);

  ctx.fillStyle = 'rgba(255,255,255,0.82)';
  ctx.font = '600 28px system-ui, -apple-system, sans-serif';
  ctx.fillText(`min escuchados · ${summary.totalPlays} temas`, 420, 474);

  ctx.fillStyle = '#34d399';
  ctx.font = '700 24px system-ui, -apple-system, sans-serif';
  ctx.fillText(`${summary.listeningPersona.title}`, 420, 520);

  const colW = 446;
  const colY = 608;
  const colH = 690;

  drawRoundedRect(ctx, 78, colY, colW, colH, 38);
  ctx.fillStyle = 'rgba(14, 14, 22, 0.56)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.16)';
  ctx.stroke();

  ctx.fillStyle = '#c084fc';
  ctx.font = '900 26px system-ui, -apple-system, sans-serif';
  ctx.fillText('TOP ARTISTAS', 112, colY + 68);

  summary.topArtists.slice(0, 5).forEach((artist, i) => {
    const rowY = colY + 148 + i * 102;
    ctx.fillStyle = i === 0 ? '#fde047' : 'rgba(255,255,255,0.45)';
    ctx.font = '900 34px system-ui, -apple-system, sans-serif';
    ctx.fillText(`${i + 1}`, 112, rowY);

    ctx.fillStyle = '#ffffff';
    ctx.font = i === 0 ? '800 34px system-ui, sans-serif' : '700 30px system-ui, sans-serif';
    ctx.fillText(artist.title.slice(0, 17), 160, rowY);

    ctx.fillStyle = 'rgba(255,255,255,0.58)';
    ctx.font = '600 22px system-ui, sans-serif';
    ctx.fillText(`${artist.minutes} min`, 160, rowY + 34);
  });

  drawRoundedRect(ctx, 556, colY, colW, colH, 38);
  ctx.fillStyle = 'rgba(14, 14, 22, 0.56)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.16)';
  ctx.stroke();

  ctx.fillStyle = '#34d399';
  ctx.font = '900 26px system-ui, -apple-system, sans-serif';
  ctx.fillText('TOP CANCIONES', 590, colY + 68);

  summary.topTracks.slice(0, 5).forEach((track, i) => {
    const rowY = colY + 148 + i * 102;
    ctx.fillStyle = i === 0 ? '#34d399' : 'rgba(255,255,255,0.45)';
    ctx.font = '900 34px system-ui, -apple-system, sans-serif';
    ctx.fillText(`${i + 1}`, 590, rowY);

    ctx.fillStyle = '#ffffff';
    ctx.font = i === 0 ? '800 32px system-ui, sans-serif' : '700 28px system-ui, sans-serif';
    ctx.fillText(track.title.slice(0, 18), 638, rowY);

    ctx.fillStyle = 'rgba(255,255,255,0.58)';
    ctx.font = '600 22px system-ui, sans-serif';
    ctx.fillText(`${track.plays} reproducciones`, 638, rowY + 34);
  });

  drawRoundedRect(ctx, 78, 1340, 924, 340, 38);
  const footGrad = ctx.createLinearGradient(78, 1340, 1002, 1680);
  footGrad.addColorStop(0, 'rgba(192, 132, 252, 0.22)');
  footGrad.addColorStop(1, 'rgba(56, 189, 248, 0.16)');
  ctx.fillStyle = footGrad;
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.20)';
  ctx.stroke();

  ctx.fillStyle = '#38bdf8';
  ctx.font = '800 25px system-ui, sans-serif';
  ctx.fillText('TU ADN SONORO', 118, 1410);

  ctx.fillStyle = '#ffffff';
  ctx.font = '900 48px system-ui, sans-serif';
  ctx.fillText(`${summary.topGenres[0]?.genre ?? 'Urbano & Pop'}`, 118, 1480);

  ctx.fillStyle = 'rgba(255,255,255,0.84)';
  ctx.font = '600 30px system-ui, sans-serif';
  ctx.fillText(
    `Racha: ${summary.longestStreakDays} días · Hora pico: ${String(summary.peakHour).padStart(2, '0')}:00`,
    118,
    1554
  );
  ctx.fillText(
    `Mes #1: ${summary.topMonth.name} · ${summary.uniqueArtists} artistas distintos`,
    118,
    1612
  );

  drawRoundedRect(ctx, 355, 1748, 370, 74, 37);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.94)';
  ctx.fill();
  ctx.fillStyle = '#09090e';
  ctx.font = '900 30px system-ui, sans-serif';
  ctx.fillText('pMusic · Escucha sin límites', 392, 1796);

  const link = document.createElement('a');
  link.download = `pMusic-Wrapped-${summary.year}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
}

const WrappedMotionBackdrop: React.FC<{ slide: number; year: number }> = ({ slide, year }) => (
  <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
    {/* Soft breathing kinetic orbs */}
    <div
      className="pm-wrapped-float absolute -top-24 -left-24 h-72 w-72 rounded-full blur-3xl"
      style={{
        background:
          slide % 2 === 0 ? 'rgba(217, 249, 157, 0.22)' : 'rgba(56, 189, 248, 0.24)',
      }}
    />
    <div
      className="pm-wrapped-float absolute -right-24 bottom-12 h-80 w-80 rounded-full blur-3xl"
      style={{
        background:
          slide === 3 ? 'rgba(52, 211, 153, 0.24)' : 'rgba(244, 63, 94, 0.24)',
        animationDelay: '-3.5s',
      }}
    />

    {/* Slide 0: Diagonal Kinetic Marquee Typography + Geometric Starbursts */}
    {slide === 0 && (
      <>
        <div className="absolute -left-20 top-20 w-[180%] -rotate-6 opacity-18">
          <div className="pm-wrapped-marquee flex whitespace-nowrap text-4xl font-black uppercase tracking-[0.2em] text-lime-200">
            <span className="pr-8">pMusic WRAPPED {year} · TU BANDA SONORA ·</span>
            <span className="pr-8">pMusic WRAPPED {year} · TU BANDA SONORA ·</span>
          </div>
        </div>
        <div className="absolute -left-20 bottom-24 w-[180%] -rotate-6 opacity-14">
          <div className="pm-wrapped-marquee-rev flex whitespace-nowrap text-3xl font-black uppercase tracking-[0.22em] text-purple-200">
            <span className="pr-8">RITMO · NOSTALGIA · LOOP · TOP HITS ·</span>
            <span className="pr-8">RITMO · NOSTALGIA · LOOP · TOP HITS ·</span>
          </div>
        </div>
        <svg
          viewBox="0 0 120 120"
          className="pm-wrapped-spin absolute right-5 top-28 h-28 w-28 text-lime-200/20"
        >
          <polygon
            points="60,4 72,42 112,38 82,66 98,104 60,84 22,104 38,66 8,38 48,42"
            fill="currentColor"
          />
        </svg>
      </>
    )}

    {/* Slide 1: Concentric Tempo Radar Rings */}
    {slide === 1 && (
      <div className="absolute inset-0 flex items-center justify-center">
        {[0, 1, 2].map((ring) => (
          <div
            key={ring}
            className="pm-wrapped-pulse-ring absolute h-64 w-64 rounded-full border-2 border-cyan-300/35"
            style={{ animationDelay: `${ring * 0.85}s` }}
          />
        ))}
      </div>
    )}

    {/* Slide 2: Diagonal Spotlight Geometric Stripes */}
    {slide === 2 && (
      <div className="pm-wrapped-ribbon absolute -inset-12 opacity-20">
        <svg viewBox="0 0 400 700" className="h-full w-full" preserveAspectRatio="none">
          <path
            d="M-40,140 C120,40 280,260 440,110 L440,210 C280,360 120,140 -40,240 Z"
            fill="#fb7185"
          />
          <path
            d="M-40,460 C140,360 270,560 440,420 L440,510 C270,650 140,450 -40,550 Z"
            fill="#c084fc"
          />
        </svg>
      </div>
    )}

    {/* Slide 3: Equalizer Spectrum Wave Bars at bottom */}
    {slide === 3 && (
      <div className="absolute inset-x-6 bottom-24 flex h-24 items-end justify-between gap-1.5 opacity-25">
        {Array.from({ length: 20 }).map((_, idx) => (
          <div
            key={idx}
            className="pm-wrapped-eq-bar flex-1 rounded-t-full bg-emerald-300"
            style={{
              height: `${36 + ((idx * 29) % 64)}%`,
              animationDelay: `${(idx % 7) * 110}ms`,
            }}
          />
        ))}
      </div>
    )}

    {/* Slide 4: Fluid Sound Waves Ribbon */}
    {slide === 4 && (
      <svg
        viewBox="0 0 400 700"
        className="pm-wrapped-ribbon absolute inset-0 h-full w-full opacity-22"
        preserveAspectRatio="none"
      >
        <path
          d="M0,180 Q100,110 200,185 T400,175 L400,245 Q300,315 200,245 T0,255 Z"
          fill="#fbbf24"
        />
        <path
          d="M0,510 Q110,440 210,515 T400,490 L400,560 Q300,625 200,560 T0,575 Z"
          fill="#f472b6"
        />
      </svg>
    )}

    {/* Slide 5: Orbiting Aura Constellation */}
    {slide === 5 && (
      <svg viewBox="0 0 400 700" className="absolute inset-0 h-full w-full opacity-35">
        <circle cx="200" cy="340" r="145" fill="none" stroke="rgba(165,243,252,0.22)" strokeDasharray="6 8" />
        <circle cx="200" cy="340" r="215" fill="none" stroke="rgba(192,132,252,0.18)" strokeDasharray="4 10" />
        <circle cx="72" cy="148" r="4" fill="#a5f3fc" className="animate-pulse" />
        <circle cx="330" cy="192" r="5" fill="#f0abfc" className="animate-pulse" />
        <circle cx="88" cy="542" r="5" fill="#fde047" className="animate-pulse" />
        <circle cx="322" cy="520" r="4" fill="#6ee7b7" className="animate-pulse" />
      </svg>
    )}

    {/* Slide 6: Celebratory Confetti Rain */}
    {slide === 6 && (
      <div className="absolute inset-x-0 top-10 h-60 overflow-hidden">
        {Array.from({ length: 14 }).map((_, i) => (
          <span
            key={i}
            className="pm-wrapped-confetti absolute top-0 rounded-sm"
            style={{
              left: `${6 + ((i * 7) % 88)}%`,
              width: i % 2 === 0 ? '8px' : '11px',
              height: i % 3 === 0 ? '14px' : '8px',
              backgroundColor: ['#f472b6', '#fde047', '#34d399', '#38bdf8', '#c084fc'][i % 5],
              animationDelay: `${(i * 0.27) % 2.4}s`,
            }}
          />
        ))}
      </div>
    )}
  </div>
);

export const WrappedStoriesModal: React.FC = React.memo(() => {
  const wrappedModalOpen = usePMusicStore((s) => s.wrappedModalOpen);
  if (!wrappedModalOpen) return null;
  return <WrappedStoriesModalInner />;
});
WrappedStoriesModal.displayName = 'WrappedStoriesModal';

const WrappedStoriesModalInner: React.FC = () => {
  const {
    wrappedModalOpen,
    wrappedSummary,
    wrappedSoundtrackTracks,
    userProfile,
    currentTrack,
    playTrack,
    toggleMute,
    volume,
    closeWrappedModal,
  } = usePMusicStore();
  const [slide, setSlide] = useState(0);
  const [exporting, setExporting] = useState(false);
  const swipeStartRef = useRef<{ x: number; y: number } | null>(null);
  const totalSlides = 7;

  const slideTracks = useMemo(
    () => buildDistinctSlideTracks(wrappedSoundtrackTracks, wrappedSummary),
    [wrappedSoundtrackTracks, wrappedSummary]
  );

  useEffect(() => {
    if (!wrappedModalOpen) return;
    setSlide(0);
  }, [wrappedModalOpen]);

  // Play a distinct song for each Wrapped story slide
  useEffect(() => {
    if (!wrappedModalOpen) return;
    const targetTrack = slideTracks[slide] ?? slideTracks.find(Boolean) ?? null;
    if (targetTrack && targetTrack.id !== currentTrack.id) {
      const queueOrder = slideTracks.filter((t): t is Track => Boolean(t));
      void playTrack(
        targetTrack,
        queueOrder.length > 0 ? queueOrder : wrappedSoundtrackTracks
      );
    }
  }, [slide, wrappedModalOpen, slideTracks]);

  const goToSlide = (nextIdx: number) => {
    if (nextIdx >= totalSlides) {
      triggerHaptic('confirm');
      closeWrappedModal();
      return;
    }
    const clamped = Math.max(0, nextIdx);
    if (clamped !== slide) {
      triggerHaptic('light');
      setSlide(clamped);
    }
  };

  // Exclusive Wrapped keyboard navigation (capture phase blocks song skip hotkeys!)
  useEffect(() => {
    if (!wrappedModalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        closeWrappedModal();
        return;
      }
      if (e.key === 'ArrowRight' || e.key === ' ' || e.code === 'Space' || e.key === 'Enter') {
        e.preventDefault();
        e.stopImmediatePropagation();
        setSlide((s) => (s < totalSlides - 1 ? s + 1 : s));
        return;
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        e.stopImmediatePropagation();
        setSlide((s) => Math.max(0, s - 1));
        return;
      }
      if (e.key.toLowerCase() === 'm') {
        e.preventDefault();
        e.stopImmediatePropagation();
        toggleMute();
        return;
      }
      if (['ArrowUp', 'ArrowDown', 'l', 'q', 'd', 's', 'r', '/'].includes(e.key.toLowerCase())) {
        e.stopImmediatePropagation();
      }
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [wrappedModalOpen, closeWrappedModal, toggleMute]);

  const animatedMinutes = useCountUp(wrappedSummary?.totalMinutes ?? 0, `${slide}-min`);
  const animatedPlays = useCountUp(wrappedSummary?.totalPlays ?? 0, `${slide}-plays`);

  if (!wrappedModalOpen || !wrappedSummary) return null;

  const summary = wrappedSummary;
  const theme = SLIDE_THEMES[slide] ?? SLIDE_THEMES[0]!;
  const topArtist = summary.topArtists[0];
  const topTrack = summary.topTracks[0];
  const topGenre = summary.topGenres[0];
  const storyHours = Math.max(1, Math.round(summary.totalMinutes / 60));
  const activeSlideTrack = slideTracks[slide] ?? currentTrack;

  return (
    <div
      className="fixed inset-0 z-[130] flex items-center justify-center bg-black/94 p-0 backdrop-blur-2xl sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={`pMusic Wrapped ${summary.year}`}
    >
      <div
        className="relative flex h-full w-full flex-col justify-between overflow-hidden transition-[background] duration-500 sm:h-[min(860px,92vh)] sm:max-w-[440px] sm:rounded-[34px] sm:border sm:border-white/20 sm:shadow-[0_32px_90px_rgba(0,0,0,0.85)]"
        style={{ background: theme.background }}
        onTouchStart={(e) => {
          const t = e.touches[0];
          if (t) swipeStartRef.current = { x: t.clientX, y: t.clientY };
        }}
        onTouchEnd={(e) => {
          const t = e.changedTouches[0];
          if (!t || !swipeStartRef.current) return;
          const dx = t.clientX - swipeStartRef.current.x;
          const dy = t.clientY - swipeStartRef.current.y;
          swipeStartRef.current = null;
          if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.2) {
            if (dx < 0) goToSlide(slide + 1);
            else goToSlide(slide - 1);
          }
        }}
      >
        <WrappedMotionBackdrop slide={slide} year={summary.year} />

        {/* Top story progress bars */}
        <div className="relative z-20 px-4 pt-[max(1rem,var(--pm-safe-top,env(safe-area-inset-top)))] sm:pt-4">
          <div className="flex gap-1.5">
            {Array.from({ length: totalSlides }).map((_, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => goToSlide(idx)}
                className="h-1 flex-1 overflow-hidden rounded-full bg-white/20"
                aria-label={`Diapositiva ${idx + 1}`}
              >
                <div
                  className={`h-full rounded-full bg-white transition-all duration-300 ${
                    idx <= slide ? 'w-full' : 'w-0'
                  }`}
                />
              </button>
            ))}
          </div>

          <div className="mt-3 flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-white backdrop-blur-md">
                <Flame className="h-3 w-3" style={{ color: theme.accentHex }} />
                Wrapped {summary.year}
              </span>
              {activeSlideTrack?.title && (
                <span
                  data-testid="wrapped-slide-song"
                  className="inline-flex min-w-0 items-center gap-1.5 rounded-full bg-black/30 px-2.5 py-1 text-[11px] font-medium text-white/85 backdrop-blur-md"
                >
                  <span className="inline-flex h-2.5 items-end gap-[2px]" aria-hidden="true">
                    <span className="pm-wrapped-eq-bar h-full w-[2px] rounded-full bg-emerald-300" />
                    <span
                      className="pm-wrapped-eq-bar h-full w-[2px] rounded-full bg-emerald-300"
                      style={{ animationDelay: '180ms' }}
                    />
                    <span
                      className="pm-wrapped-eq-bar h-full w-[2px] rounded-full bg-emerald-300"
                      style={{ animationDelay: '340ms' }}
                    />
                  </span>
                  <span className="truncate">{activeSlideTrack.title}</span>
                </span>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                onClick={toggleMute}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-black/35 text-white/80 hover:bg-black/60 hover:text-white"
                aria-label={volume === 0 ? 'Activar sonido' : 'Silenciar'}
              >
                {volume === 0 ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
              </button>
              <button
                type="button"
                onClick={closeWrappedModal}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-black/35 text-white/80 hover:bg-black/60 hover:text-white"
                aria-label="Cerrar Wrapped"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Slide Content */}
        <div
          key={slide}
          className="pm-wrapped-enter relative z-10 flex flex-1 flex-col justify-center px-6 py-4"
        >
          {slide === 0 && (
            <div className="space-y-6 text-center">
              <div className="relative mx-auto w-fit">
                <span
                  aria-hidden="true"
                  className="pm-wrapped-pulse-ring absolute -inset-3 rounded-[32px] border border-lime-200/40"
                />
                <div className="pm-wrapped-pop relative flex h-24 w-24 items-center justify-center rounded-[28px] border border-white/30 bg-white/12 shadow-2xl backdrop-blur-xl">
                  <Disc3 className="h-11 w-11 text-[#d9f99d]" />
                </div>
              </div>
              <div className="space-y-2.5">
                <span className="pm-wrapped-sticker inline-block rounded-full bg-[#d9f99d] px-3.5 py-1 text-[11px] font-black uppercase tracking-[0.2em] text-black shadow-lg">
                  Edición {summary.year}
                </span>
                <h2 className="text-4xl font-black tracking-tight text-white">
                  Tu banda sonora del año está lista
                </h2>
                <p className="mx-auto max-w-xs text-sm text-white/80">
                  Cada historia suena con un tema distinto de tu año. Desliza o usa{' '}
                  <kbd className="rounded bg-white/15 px-1.5 py-0.5 text-[11px]">←</kbd>{' '}
                  <kbd className="rounded bg-white/15 px-1.5 py-0.5 text-[11px]">→</kbd>.
                </p>
              </div>
              {userProfile && (
                <div className="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-4 py-1.5 text-xs font-bold text-white backdrop-blur-md">
                  {userProfile.avatarUrl && (
                    <img src={userProfile.avatarUrl} alt="" className="h-5 w-5 rounded-full object-cover" />
                  )}
                  <span>{userProfile.displayName}</span>
                  <span className="text-white/60">@{userProfile.username}</span>
                </div>
              )}
            </div>
          )}

          {slide === 1 && (
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold uppercase tracking-[0.22em] text-cyan-300">
                  {theme.kicker}
                </p>
                <span className="pm-wrapped-sticker rounded-full bg-cyan-300 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-slate-950">
                  {storyHours} h seguidas
                </span>
              </div>
              <div className="pm-wrapped-pop">
                <div className="text-6xl font-black tracking-tight text-white">
                  {animatedMinutes.toLocaleString('es-ES')}
                </div>
                <div className="text-xl font-bold text-white/85">minutos escuchados</div>
              </div>
              <div className="grid grid-cols-3 gap-2.5 pt-2">
                <div className="rounded-2xl border border-white/20 bg-white/[0.08] p-3 backdrop-blur-md">
                  <div className="text-xl font-black text-cyan-200">{animatedPlays}</div>
                  <div className="text-[11px] text-white/70">reproducciones</div>
                </div>
                <div className="rounded-2xl border border-white/20 bg-white/[0.08] p-3 backdrop-blur-md">
                  <div className="text-xl font-black text-pink-200">{summary.uniqueTracks}</div>
                  <div className="text-[11px] text-white/70">canciones</div>
                </div>
                <div className="rounded-2xl border border-white/20 bg-white/[0.08] p-3 backdrop-blur-md">
                  <div className="text-xl font-black text-lime-200">{summary.uniqueArtists}</div>
                  <div className="text-[11px] text-white/70">artistas</div>
                </div>
              </div>
            </div>
          )}

          {slide === 2 && (
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold uppercase tracking-[0.22em] text-rose-300">
                  {theme.kicker}
                </p>
                <span className="pm-wrapped-sticker rounded-full bg-rose-300 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-rose-950">
                  TOP #1
                </span>
              </div>
              {topArtist ? (
                <div className="pm-wrapped-pop relative flex items-center gap-4">
                  <div className="relative shrink-0">
                    <div
                      aria-hidden="true"
                      className="pm-wrapped-halo absolute -inset-2 rounded-3xl bg-gradient-to-tr from-rose-400 via-fuchsia-400 to-amber-300 opacity-80 blur-md"
                    />
                    {topArtist.thumbnailUrl ? (
                      <img
                        src={topArtist.thumbnailUrl}
                        alt={topArtist.title}
                        className="relative h-24 w-24 rounded-2xl object-cover shadow-2xl ring-2 ring-white/40"
                      />
                    ) : (
                      <div className="relative flex h-24 w-24 items-center justify-center rounded-2xl bg-white/15">
                        <Headphones className="h-10 w-10 text-white" />
                      </div>
                    )}
                  </div>
                  <div className="min-w-0">
                    <h2 className="truncate text-3xl font-black text-white">{topArtist.title}</h2>
                    <p className="mt-1 text-sm text-white/80">
                      {topArtist.minutes} min · {topArtist.plays} escuchas
                    </p>
                  </div>
                </div>
              ) : (
                <h2 className="text-3xl font-black text-white">Tu artista favorito te espera</h2>
              )}

              <div className="space-y-2.5 rounded-2xl border border-white/20 bg-black/35 p-4 backdrop-blur-md">
                {summary.topArtists.map((a, i) => (
                  <div key={a.key} className="space-y-1">
                    <div className="flex items-center justify-between text-xs font-bold text-white">
                      <span className="truncate">
                        <span className="mr-2 text-rose-300">#{i + 1}</span>
                        {a.title}
                      </span>
                      <span className="text-white/75">{a.minutes} min</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-white/12">
                      <div
                        className="pm-wrapped-bar h-full rounded-full bg-gradient-to-r from-rose-400 via-pink-400 to-amber-300"
                        style={{
                          width: `${Math.max(12, Math.round((a.minutes / Math.max(1, topArtist?.minutes ?? 1)) * 100))}%`,
                          animationDelay: `${i * 95}ms`,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {slide === 3 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold uppercase tracking-[0.22em] text-emerald-300">
                  {theme.kicker}
                </p>
                <span className="pm-wrapped-sticker rounded-full bg-emerald-300 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-emerald-950">
                  ON REPEAT
                </span>
              </div>
              {topTrack ? (
                <div className="pm-wrapped-pop flex flex-col items-center text-center">
                  <div className="relative">
                    {/* Spinning vinyl disc peeking cleanly behind cover */}
                    <div
                      aria-hidden="true"
                      className="pm-wrapped-spin absolute -right-7 top-3 h-32 w-32 rounded-full border-4 border-white/15 bg-[radial-gradient(circle,#111_22%,#27272a_24%,#09090b_55%,#18181b_78%)] opacity-85 shadow-xl"
                    >
                      <span className="absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-emerald-400" />
                    </div>
                    <div
                      aria-hidden="true"
                      className="pm-wrapped-halo absolute -inset-3 rounded-[28px] bg-gradient-to-tr from-emerald-400 via-teal-300 to-sky-400 opacity-55 blur-lg"
                    />
                    {topTrack.thumbnailUrl ? (
                      <img
                        src={topTrack.thumbnailUrl}
                        alt={topTrack.title}
                        className="relative h-36 w-36 rounded-3xl object-cover shadow-2xl ring-2 ring-white/35"
                      />
                    ) : (
                      <div className="relative flex h-36 w-36 items-center justify-center rounded-3xl bg-white/15">
                        <Music2 className="h-14 w-14 text-white" />
                      </div>
                    )}
                  </div>
                  <h2 className="mt-4 line-clamp-2 text-2xl font-black text-white">
                    {topTrack.title}
                  </h2>
                  <p className="text-sm text-white/75">{topTrack.subtitle}</p>
                  <p className="mt-1.5 rounded-full bg-emerald-400/20 px-3 py-1 text-xs font-bold text-emerald-200">
                    {topTrack.plays} reproducciones
                  </p>
                </div>
              ) : (
                <h2 className="text-3xl font-black text-white">Tu #1 del año</h2>
              )}

              <div className="space-y-1.5 rounded-2xl border border-white/20 bg-black/35 p-3 backdrop-blur-md">
                {summary.topTracks.slice(0, 5).map((t, i) => (
                  <div key={t.key} className="flex items-center justify-between gap-2 text-xs">
                    <span className="truncate font-semibold text-white">
                      <span className="mr-2 text-emerald-300">{i + 1}.</span>
                      {t.title}
                    </span>
                    <span className="shrink-0 font-bold text-emerald-300">{t.plays}×</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {slide === 4 && (
            <div className="space-y-5">
              <p className="text-xs font-bold uppercase tracking-[0.22em] text-amber-300">
                {theme.kicker}
              </p>
              <h2 className="pm-wrapped-pop text-4xl font-black tracking-tight text-white">
                {topGenre?.genre ?? 'Urbano & Pop'}
              </h2>
              <div className="space-y-3 rounded-2xl border border-white/18 bg-black/30 p-4 backdrop-blur-md">
                {summary.topGenres.map((g, idx) => (
                  <div key={g.genre} className="space-y-1">
                    <div className="flex items-center justify-between text-xs font-bold">
                      <span className={idx === 0 ? 'text-amber-200' : 'text-white/85'}>
                        {idx + 1}. {g.genre}
                      </span>
                      <span className="text-white/75">
                        {g.percent}% · {g.minutes} min
                      </span>
                    </div>
                    <div className="h-2.5 overflow-hidden rounded-full bg-white/12">
                      <div
                        className="pm-wrapped-bar h-full rounded-full bg-gradient-to-r from-amber-300 via-orange-400 to-fuchsia-500"
                        style={{
                          width: `${Math.max(10, g.percent)}%`,
                          animationDelay: `${idx * 100}ms`,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {slide === 5 && (
            <div className="space-y-4">
              <p className="text-xs font-bold uppercase tracking-[0.22em] text-sky-300">
                {theme.kicker}
              </p>
              <div className="pm-wrapped-pop rounded-3xl border border-cyan-200/30 bg-gradient-to-br from-white/15 via-cyan-400/10 to-purple-500/15 p-4 backdrop-blur-xl">
                <h2 className="text-3xl font-black text-white">
                  {summary.listeningPersona.title}
                </h2>
                <p className="mt-1.5 text-sm text-white/80">{summary.listeningPersona.subtitle}</p>
              </div>

              <div className="grid grid-cols-2 gap-3 pt-1">
                <div className="rounded-2xl border border-white/20 bg-white/[0.08] p-4 backdrop-blur-md">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-amber-300">
                    <Flame className="h-4 w-4" /> Racha récord
                  </div>
                  <p className="mt-1 text-2xl font-black text-white">
                    {summary.longestStreakDays} días
                  </p>
                </div>
                <div className="rounded-2xl border border-white/20 bg-white/[0.08] p-4 backdrop-blur-md">
                  <div className="text-xs font-bold text-cyan-300">Hora pico</div>
                  <p className="mt-1 text-2xl font-black text-white">
                    {String(summary.peakHour).padStart(2, '0')}:00
                  </p>
                </div>
                <div className="col-span-2 rounded-2xl border border-white/20 bg-white/[0.08] p-4 backdrop-blur-md">
                  <div className="text-xs font-bold text-purple-300">Tu mes más musical</div>
                  <p className="mt-0.5 text-xl font-black text-white">
                    {summary.topMonth.name}{' '}
                    <span className="text-sm font-semibold text-white/70">
                      ({summary.topMonth.minutes} min)
                    </span>
                  </p>
                </div>
              </div>
            </div>
          )}

          {slide === 6 && (
            <div className="space-y-4">
              <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#f5d0fe]">
                Listo para tu Story de Instagram
              </p>

              <div
                className="pm-wrapped-pop relative overflow-hidden rounded-[28px] border border-white/25 p-5 shadow-2xl"
                style={{
                  background:
                    'linear-gradient(155deg, rgba(124,58,237,0.6) 0%, rgba(225,29,72,0.5) 48%, rgba(14,165,233,0.4) 100%)',
                }}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-black tracking-wider text-[#f5d0fe]">
                    pMusic WRAPPED {summary.year}
                  </span>
                  <span className="rounded-full bg-white/18 px-2.5 py-0.5 text-[11px] font-bold text-white">
                    {summary.totalMinutes.toLocaleString('es-ES')} min
                  </span>
                </div>

                <div className="mt-3 flex items-center gap-3 rounded-2xl bg-black/30 p-2.5">
                  {(topTrack?.thumbnailUrl || topArtist?.thumbnailUrl) && (
                    <img
                      src={topTrack?.thumbnailUrl ?? topArtist?.thumbnailUrl}
                      alt=""
                      className="h-12 w-12 shrink-0 rounded-xl object-cover"
                    />
                  )}
                  <div className="min-w-0">
                    <div className="text-[10px] font-bold uppercase text-emerald-300">
                      {summary.listeningPersona.title}
                    </div>
                    <div className="truncate text-sm font-black text-white">
                      {topTrack?.title ?? topArtist?.title ?? 'Tu año en música'}
                    </div>
                    <div className="truncate text-[11px] text-white/75">
                      {topArtist?.title ?? 'pMusic'}
                    </div>
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-3 text-[11.5px]">
                  <div className="rounded-2xl bg-black/28 p-2.5">
                    <div className="mb-1 text-[10px] font-extrabold uppercase tracking-wider text-purple-300">
                      Top Artistas
                    </div>
                    {summary.topArtists.slice(0, 5).map((a, i) => (
                      <div key={a.key} className="truncate py-0.5 font-bold text-white">
                        {i + 1}. {a.title}
                      </div>
                    ))}
                  </div>
                  <div className="rounded-2xl bg-black/28 p-2.5">
                    <div className="mb-1 text-[10px] font-extrabold uppercase tracking-wider text-emerald-300">
                      Top Canciones
                    </div>
                    {summary.topTracks.slice(0, 5).map((t, i) => (
                      <div key={t.key} className="truncate py-0.5 font-bold text-white">
                        {i + 1}. {t.title}
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <button
                type="button"
                disabled={exporting}
                onClick={async () => {
                  triggerHaptic('confirm');
                  setExporting(true);
                  try {
                    await downloadWrappedStoryCard(
                      summary,
                      userProfile?.username ?? '',
                      userProfile?.displayName
                    );
                  } finally {
                    setExporting(false);
                  }
                }}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#c084fc] via-[#f43f5e] to-[#fb923c] px-4 py-3.5 text-sm font-black text-white shadow-lg transition hover:brightness-110 disabled:opacity-60"
              >
                <Download className="h-4 w-4" />
                {exporting ? 'Generando imagen 1080×1920...' : 'Descargar imagen para Instagram (9:16)'}
              </button>
            </div>
          )}
        </div>

        {/* Bottom navigation controls */}
        <div className="relative z-20 flex items-center justify-between px-6 pb-[max(1.5rem,var(--pm-safe-bottom,env(safe-area-inset-bottom)))] sm:pb-6">
          <button
            type="button"
            onClick={() => goToSlide(slide - 1)}
            disabled={slide === 0}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-white transition hover:bg-white/25 disabled:opacity-25"
            aria-label="Anterior"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <span className="text-xs font-semibold text-white/75">
            {slide + 1} / {totalSlides}
          </span>
          <button
            type="button"
            onClick={() => goToSlide(slide + 1)}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-white/20 text-white transition hover:bg-white/30"
            aria-label={slide < totalSlides - 1 ? 'Siguiente' : 'Finalizar'}
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
      </div>
    </div>
  );
};
