import React, { useEffect, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Flame,
  Headphones,
  Music2,
  Sparkles,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { usePMusicStore } from '../store/usePMusicStore.ts';
import type { WrappedSummary } from '../lib/wrapped-stats.ts';

const SLIDE_GRADIENTS = [
  'radial-gradient(circle at 20% 20%, #7c3aed 0%, #3b0764 40%, #06060b 100%)',
  'radial-gradient(circle at 80% 25%, #0284c7 0%, #1e1b4b 46%, #05060a 100%)',
  'radial-gradient(circle at 50% 18%, #e11d48 0%, #4c0519 46%, #06060a 100%)',
  'radial-gradient(circle at 30% 22%, #059669 0%, #064e3b 45%, #05070a 100%)',
  'radial-gradient(circle at 75% 25%, #d97706 0%, #581c87 48%, #07060b 100%)',
  'radial-gradient(circle at 40% 20%, #9333ea 0%, #1d4ed8 44%, #06060b 100%)',
  'linear-gradient(155deg, #2e1065 0%, #831843 38%, #0f172a 76%, #050509 100%)',
];

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

  // Vivid multi-stop pMusic Aurora Mesh background
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

  // Header brand + @handle
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

  // Top #1 Track / Artist artwork showcase card
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

  // Two glass cards side by side: Top Artistas & Top Canciones
  const colW = 446;
  const colY = 608;
  const colH = 690;

  // Left card: Top Artists
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

  // Right card: Top Songs
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

  // Vibe & Stats Footer Banner
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
  ctx.fillText(
    `${summary.topGenres[0]?.genre ?? 'Urbano & Pop'}`,
    118,
    1480
  );

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

  // Brand signature pill
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

export const WrappedStoriesModal: React.FC = () => {
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
  const totalSlides = 7;

  // Auto-play user taste soundtrack when Wrapped opens
  useEffect(() => {
    if (!wrappedModalOpen) return;
    setSlide(0);
    if (wrappedSoundtrackTracks.length > 0) {
      const first = wrappedSoundtrackTracks[0]!;
      if (currentTrack.id !== first.id) {
        void playTrack(first, wrappedSoundtrackTracks);
      }
    }
  }, [wrappedModalOpen]);

  // Switch to #1 song on Top Track slide if present in soundtrack
  useEffect(() => {
    if (!wrappedModalOpen || slide !== 3 || !wrappedSummary?.topTracks[0]) return;
    const topTitle = wrappedSummary.topTracks[0].title.trim().toLowerCase();
    const match = wrappedSoundtrackTracks.find(
      (t) =>
        t.id === wrappedSummary.topTracks[0]!.key ||
        t.title.trim().toLowerCase() === topTitle
    );
    if (match && currentTrack.id !== match.id) {
      void playTrack(match, wrappedSoundtrackTracks);
    }
  }, [slide, wrappedModalOpen]);

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
  const topArtist = summary.topArtists[0];
  const topTrack = summary.topTracks[0];
  const topGenre = summary.topGenres[0];

  return (
    <div
      className="fixed inset-0 z-[130] flex items-center justify-center bg-black/92 p-0 backdrop-blur-2xl sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={`pMusic Wrapped ${summary.year}`}
    >
      <div
        className="relative flex h-full w-full flex-col justify-between overflow-hidden sm:h-[min(860px,92vh)] sm:max-w-[440px] sm:rounded-[34px] sm:border sm:border-white/20 sm:shadow-[0_32px_90px_rgba(0,0,0,0.8)]"
        style={{ background: SLIDE_GRADIENTS[slide] ?? SLIDE_GRADIENTS[0] }}
      >
        {/* Ambient animated background orbs */}
        <div
          aria-hidden="true"
          className="pm-wrapped-float pointer-events-none absolute -top-24 -left-20 h-72 w-72 rounded-full bg-purple-500/30 blur-3xl"
        />
        <div
          aria-hidden="true"
          className="pm-wrapped-float pointer-events-none absolute -right-24 bottom-10 h-80 w-80 rounded-full bg-rose-500/25 blur-3xl"
          style={{ animationDelay: '-3.5s' }}
        />

        {/* Top story progress bars */}
        <div className="relative z-20 px-4 pt-4">
          <div className="flex gap-1.5">
            {Array.from({ length: totalSlides }).map((_, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => setSlide(idx)}
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
                <Sparkles className="h-3 w-3 text-[#e2ccff]" />
                Wrapped {summary.year}
              </span>
              {currentTrack?.title && (
                <span className="truncate text-[11px] font-medium text-white/75">
                  ♪ {currentTrack.title}
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
            <div className="space-y-5 text-center">
              <div className="pm-wrapped-pop mx-auto flex h-24 w-24 items-center justify-center rounded-[28px] border border-white/25 bg-white/10 shadow-2xl backdrop-blur-xl">
                <Sparkles className="h-11 w-11 text-[#e2ccff]" />
              </div>
              <div className="space-y-2">
                <p className="text-xs font-bold uppercase tracking-[0.26em] text-[#e2ccff]">
                  pMusic Wrapped {summary.year}
                </p>
                <h2 className="text-4xl font-black tracking-tight text-white">
                  Tu banda sonora del año está lista
                </h2>
                <p className="mx-auto max-w-xs text-sm text-white/75">
                  Usa las flechas <kbd className="rounded bg-white/15 px-1.5 py-0.5 text-[11px]">←</kbd>{' '}
                  <kbd className="rounded bg-white/15 px-1.5 py-0.5 text-[11px]">→</kbd> o Espacio para
                  recorrer tu año sin cortar tu música.
                </p>
              </div>
              {userProfile && (
                <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-1.5 text-xs font-bold text-white">
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
              <p className="text-xs font-bold uppercase tracking-[0.22em] text-sky-300">
                Tiempo contigo
              </p>
              <div className="pm-wrapped-pop">
                <div className="text-6xl font-black tracking-tight text-white">
                  {animatedMinutes.toLocaleString('es-ES')}
                </div>
                <div className="text-xl font-bold text-white/80">minutos escuchados</div>
              </div>
              <div className="grid grid-cols-3 gap-2.5 pt-2">
                <div className="rounded-2xl border border-white/15 bg-white/[0.07] p-3">
                  <div className="text-xl font-black text-white">{animatedPlays}</div>
                  <div className="text-[11px] text-white/65">reproducciones</div>
                </div>
                <div className="rounded-2xl border border-white/15 bg-white/[0.07] p-3">
                  <div className="text-xl font-black text-white">{summary.uniqueTracks}</div>
                  <div className="text-[11px] text-white/65">canciones</div>
                </div>
                <div className="rounded-2xl border border-white/15 bg-white/[0.07] p-3">
                  <div className="text-xl font-black text-white">{summary.uniqueArtists}</div>
                  <div className="text-[11px] text-white/65">artistas</div>
                </div>
              </div>
            </div>
          )}

          {slide === 2 && (
            <div className="space-y-5">
              <p className="text-xs font-bold uppercase tracking-[0.22em] text-rose-300">
                Tu artista #1
              </p>
              {topArtist ? (
                <div className="pm-wrapped-pop relative flex items-center gap-4">
                  <div className="relative shrink-0">
                    <div
                      aria-hidden="true"
                      className="pm-wrapped-halo absolute -inset-2 rounded-3xl bg-gradient-to-tr from-rose-500 via-purple-500 to-sky-400 opacity-70 blur-md"
                    />
                    {topArtist.thumbnailUrl ? (
                      <img
                        src={topArtist.thumbnailUrl}
                        alt={topArtist.title}
                        className="relative h-24 w-24 rounded-2xl object-cover shadow-2xl ring-2 ring-white/30"
                      />
                    ) : (
                      <div className="relative flex h-24 w-24 items-center justify-center rounded-2xl bg-white/15">
                        <Headphones className="h-10 w-10 text-white" />
                      </div>
                    )}
                  </div>
                  <div className="min-w-0">
                    <h2 className="truncate text-3xl font-black text-white">{topArtist.title}</h2>
                    <p className="mt-1 text-sm text-white/75">
                      {topArtist.minutes} min · {topArtist.plays} escuchas
                    </p>
                  </div>
                </div>
              ) : (
                <h2 className="text-3xl font-black text-white">Tu artista favorito te espera</h2>
              )}

              <div className="space-y-2.5 rounded-2xl border border-white/15 bg-black/30 p-4 backdrop-blur-md">
                {summary.topArtists.map((a, i) => (
                  <div key={a.key} className="space-y-1">
                    <div className="flex items-center justify-between text-xs font-bold text-white">
                      <span className="truncate">
                        <span className="mr-2 text-white/50">#{i + 1}</span>
                        {a.title}
                      </span>
                      <span className="text-white/70">{a.minutes} min</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                      <div
                        className="pm-wrapped-bar h-full rounded-full bg-gradient-to-r from-rose-400 to-purple-400"
                        style={{
                          width: `${Math.max(12, Math.round((a.minutes / Math.max(1, topArtist?.minutes ?? 1)) * 100))}%`,
                          animationDelay: `${i * 90}ms`,
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
              <p className="text-xs font-bold uppercase tracking-[0.22em] text-emerald-300">
                Tu canción en bucle
              </p>
              {topTrack ? (
                <div className="pm-wrapped-pop flex flex-col items-center text-center">
                  <div className="relative">
                    <div
                      aria-hidden="true"
                      className="pm-wrapped-halo absolute -inset-3 rounded-[28px] bg-gradient-to-tr from-emerald-400 via-sky-400 to-purple-500 opacity-55 blur-lg"
                    />
                    {topTrack.thumbnailUrl ? (
                      <img
                        src={topTrack.thumbnailUrl}
                        alt={topTrack.title}
                        className="relative h-40 w-40 rounded-3xl object-cover shadow-2xl ring-2 ring-white/30"
                      />
                    ) : (
                      <div className="relative flex h-40 w-40 items-center justify-center rounded-3xl bg-white/15">
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

              <div className="space-y-1.5 rounded-2xl border border-white/15 bg-black/30 p-3 backdrop-blur-md">
                {summary.topTracks.slice(0, 5).map((t, i) => (
                  <div key={t.key} className="flex items-center justify-between gap-2 text-xs">
                    <span className="truncate font-semibold text-white">
                      <span className="mr-2 text-white/50">{i + 1}.</span>
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
                Tu estilo dominante
              </p>
              <h2 className="pm-wrapped-pop text-4xl font-black tracking-tight text-white">
                {topGenre?.genre ?? 'Urbano & Pop'}
              </h2>
              <div className="space-y-3">
                {summary.topGenres.map((g, idx) => (
                  <div key={g.genre} className="space-y-1">
                    <div className="flex items-center justify-between text-xs font-bold">
                      <span className={idx === 0 ? 'text-white' : 'text-white/80'}>
                        {idx + 1}. {g.genre}
                      </span>
                      <span className="text-white/70">
                        {g.percent}% · {g.minutes} min
                      </span>
                    </div>
                    <div className="h-2.5 overflow-hidden rounded-full bg-white/10">
                      <div
                        className="pm-wrapped-bar h-full rounded-full bg-gradient-to-r from-amber-400 via-pink-500 to-purple-500"
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
                Tu ADN pMusic
              </p>
              <h2 className="pm-wrapped-pop text-3xl font-black text-white">
                {summary.listeningPersona.title}
              </h2>
              <p className="text-sm text-white/80">{summary.listeningPersona.subtitle}</p>

              <div className="grid grid-cols-2 gap-3 pt-2">
                <div className="rounded-2xl border border-white/15 bg-white/[0.08] p-4 backdrop-blur-md">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-amber-300">
                    <Flame className="h-4 w-4" /> Racha récord
                  </div>
                  <p className="mt-1 text-2xl font-black text-white">
                    {summary.longestStreakDays} días
                  </p>
                </div>
                <div className="rounded-2xl border border-white/15 bg-white/[0.08] p-4 backdrop-blur-md">
                  <div className="text-xs font-bold text-sky-300">Hora pico</div>
                  <p className="mt-1 text-2xl font-black text-white">
                    {String(summary.peakHour).padStart(2, '0')}:00
                  </p>
                </div>
                <div className="col-span-2 rounded-2xl border border-white/15 bg-white/[0.08] p-4 backdrop-blur-md">
                  <div className="text-xs font-bold text-purple-300">Tu mes más musical</div>
                  <p className="mt-0.5 text-xl font-black text-white">
                    {summary.topMonth.name}{' '}
                    <span className="text-sm font-semibold text-white/65">
                      ({summary.topMonth.minutes} min)
                    </span>
                  </p>
                </div>
              </div>
            </div>
          )}

          {slide === 6 && (
            <div className="space-y-4">
              <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#e2ccff]">
                Listo para tu Story de Instagram
              </p>

              {/* Live IG 9:16 Preview Card */}
              <div
                className="pm-wrapped-pop relative overflow-hidden rounded-[28px] border border-white/25 p-5 shadow-2xl"
                style={{
                  background:
                    'linear-gradient(155deg, rgba(124,58,237,0.55) 0%, rgba(225,29,72,0.45) 48%, rgba(14,165,233,0.35) 100%)',
                }}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-black tracking-wider text-[#f5d0fe]">
                    pMusic WRAPPED {summary.year}
                  </span>
                  <span className="rounded-full bg-white/15 px-2.5 py-0.5 text-[11px] font-bold text-white">
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
                    <div className="truncate text-[11px] text-white/70">
                      {topArtist?.title ?? 'pMusic'}
                    </div>
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-3 text-[11.5px]">
                  <div className="rounded-2xl bg-black/25 p-2.5">
                    <div className="mb-1 text-[10px] font-extrabold uppercase tracking-wider text-purple-300">
                      Top Artistas
                    </div>
                    {summary.topArtists.slice(0, 5).map((a, i) => (
                      <div key={a.key} className="truncate py-0.5 font-bold text-white">
                        {i + 1}. {a.title}
                      </div>
                    ))}
                  </div>
                  <div className="rounded-2xl bg-black/25 p-2.5">
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
        <div className="relative z-20 flex items-center justify-between px-6 pb-6">
          <button
            type="button"
            onClick={() => setSlide((s) => Math.max(0, s - 1))}
            disabled={slide === 0}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-white transition hover:bg-white/25 disabled:opacity-25"
            aria-label="Anterior"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <span className="text-xs font-semibold text-white/70">
            {slide + 1} / {totalSlides}
          </span>
          <button
            type="button"
            onClick={() =>
              slide < totalSlides - 1 ? setSlide((s) => s + 1) : closeWrappedModal()
            }
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
