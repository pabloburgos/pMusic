import React, { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, Flame, Headphones, Music2, Sparkles, X } from 'lucide-react';
import { usePMusicStore } from '../store/usePMusicStore.ts';
import type { WrappedSummary } from '../lib/wrapped-stats.ts';

const SLIDE_GRADIENTS = [
  'linear-gradient(155deg, #1b0b2e 0%, #3b0a2a 48%, #09090e 100%)',
  'linear-gradient(155deg, #0b1f33 0%, #163b50 45%, #09090e 100%)',
  'linear-gradient(155deg, #2d0b1e 0%, #7a1030 48%, #09090e 100%)',
  'linear-gradient(155deg, #0d261c 0%, #115e46 48%, #09090e 100%)',
  'linear-gradient(155deg, #25130b 0%, #7c2d12 45%, #09090e 100%)',
  'linear-gradient(155deg, #120b24 0%, #2b0f35 45%, #07070b 100%)',
];

function downloadWrappedStoryCard(summary: WrappedSummary, handle: string): void {
  const canvas = document.createElement('canvas');
  canvas.width = 1080;
  canvas.height = 1920;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const grad = ctx.createLinearGradient(0, 0, 1080, 1920);
  grad.addColorStop(0, '#190a28');
  grad.addColorStop(0.45, '#3b0b25');
  grad.addColorStop(1, '#07070b');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 1080, 1920);

  // Subtle glow circle
  const glow = ctx.createRadialGradient(540, 420, 40, 540, 420, 520);
  glow.addColorStop(0, 'rgba(250, 35, 59, 0.36)');
  glow.addColorStop(1, 'rgba(250, 35, 59, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 1080, 1100);

  ctx.fillStyle = '#fa233b';
  ctx.font = '900 44px system-ui, -apple-system, sans-serif';
  ctx.fillText(`pMusic WRAPPED ${summary.year}`, 88, 150);

  ctx.fillStyle = 'rgba(255,255,255,0.65)';
  ctx.font = '600 32px system-ui, -apple-system, sans-serif';
  ctx.fillText(handle ? `@${handle}` : 'Tu año en música', 88, 204);

  // Big minutes hero
  ctx.fillStyle = '#ffffff';
  ctx.font = '900 132px system-ui, -apple-system, sans-serif';
  ctx.fillText(`${summary.totalMinutes.toLocaleString('es-ES')}`, 88, 390);
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.font = '600 38px system-ui, -apple-system, sans-serif';
  ctx.fillText(`minutos escuchados · ${summary.totalPlays} reproducciones`, 88, 450);

  // Top Artists
  ctx.fillStyle = '#fa233b';
  ctx.font = '800 30px system-ui, -apple-system, sans-serif';
  ctx.fillText('TOP ARTISTAS', 88, 590);
  summary.topArtists.slice(0, 5).forEach((artist, i) => {
    ctx.fillStyle = i === 0 ? '#ffffff' : 'rgba(255,255,255,0.82)';
    ctx.font = i === 0 ? '800 44px system-ui, sans-serif' : '600 36px system-ui, sans-serif';
    ctx.fillText(`${i + 1}. ${artist.title.slice(0, 28)}`, 88, 658 + i * 62);
  });

  // Top Songs
  ctx.fillStyle = '#34d399';
  ctx.font = '800 30px system-ui, -apple-system, sans-serif';
  ctx.fillText('TOP CANCIONES', 88, 1040);
  summary.topTracks.slice(0, 5).forEach((track, i) => {
    ctx.fillStyle = i === 0 ? '#ffffff' : 'rgba(255,255,255,0.82)';
    ctx.font = i === 0 ? '800 42px system-ui, sans-serif' : '600 34px system-ui, sans-serif';
    ctx.fillText(`${i + 1}. ${track.title.slice(0, 30)}`, 88, 1108 + i * 62);
  });

  // Bottom badges
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fillRect(88, 1480, 904, 240);
  ctx.fillStyle = '#ffffff';
  ctx.font = '800 36px system-ui, sans-serif';
  ctx.fillText(
    `Género #1: ${summary.topGenres[0]?.genre ?? 'Pop / Urbano'}`,
    126,
    1558
  );
  ctx.fillStyle = 'rgba(255,255,255,0.78)';
  ctx.font = '600 32px system-ui, sans-serif';
  ctx.fillText(
    `Racha récord: ${summary.longestStreakDays} días · ${summary.listeningPersona.title}`,
    126,
    1624
  );
  ctx.fillText(`Mes más musical: ${summary.topMonth.name}`, 126, 1682);

  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.font = '700 28px system-ui, sans-serif';
  ctx.fillText('pMusic · Escucha sin límites', 88, 1835);

  const link = document.createElement('a');
  link.download = `pMusic-Wrapped-${summary.year}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
}

export const WrappedStoriesModal: React.FC = () => {
  const { wrappedModalOpen, wrappedSummary, userProfile, closeWrappedModal } = usePMusicStore();
  const [slide, setSlide] = useState(0);
  const totalSlides = 6;

  useEffect(() => {
    if (wrappedModalOpen) setSlide(0);
  }, [wrappedModalOpen]);

  useEffect(() => {
    if (!wrappedModalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeWrappedModal();
      if (e.key === 'ArrowRight') setSlide((s) => Math.min(totalSlides - 1, s + 1));
      if (e.key === 'ArrowLeft') setSlide((s) => Math.max(0, s - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [wrappedModalOpen, closeWrappedModal]);

  if (!wrappedModalOpen || !wrappedSummary) return null;

  const summary = wrappedSummary;
  const topArtist = summary.topArtists[0];
  const topTrack = summary.topTracks[0];
  const topGenre = summary.topGenres[0];

  return (
    <div
      className="fixed inset-0 z-[130] flex items-center justify-center bg-black/90 p-0 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={`pMusic Wrapped ${summary.year}`}
    >
      <div
        className="relative flex h-full w-full flex-col justify-between overflow-hidden sm:h-[min(860px,92vh)] sm:max-w-[440px] sm:rounded-[32px] sm:border sm:border-white/15 sm:shadow-2xl"
        style={{ background: SLIDE_GRADIENTS[slide] ?? SLIDE_GRADIENTS[0] }}
      >
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

          <div className="mt-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-full bg-[#fa233b]/25 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-[#ff6b7c]">
                <Sparkles className="h-3 w-3" />
                Wrapped {summary.year}
              </span>
              {userProfile?.username && (
                <span className="text-xs font-medium text-white/60">@{userProfile.username}</span>
              )}
            </div>
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

        {/* Slide Content */}
        <div className="relative z-10 flex flex-1 flex-col justify-center px-6 py-4">
          {slide === 0 && (
            <div className="space-y-4">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#ff6b7c]">
                Tu año en pMusic
              </p>
              <h2 className="text-5xl font-black tracking-tight text-white">
                {summary.totalMinutes.toLocaleString('es-ES')}
                <span className="block text-2xl font-bold text-white/75">minutos escuchados</span>
              </h2>
              <p className="text-sm text-white/70">
                Eso son <strong className="text-white">{summary.totalHours} horas</strong> de
                música repartidas en{' '}
                <strong className="text-white">{summary.totalPlays}</strong> reproducciones,{' '}
                <strong className="text-white">{summary.uniqueTracks}</strong> canciones distintas y{' '}
                <strong className="text-white">{summary.uniqueArtists}</strong> artistas.
              </p>
              {summary.totalPlays === 0 && (
                <p className="rounded-2xl border border-white/10 bg-white/6 p-3 text-xs text-white/70">
                  Aún estás empezando a acumular escuchas en {summary.year}. Sigue escuchando música
                  normalmente y todo se irá guardando automáticamente para diciembre.
                </p>
              )}
            </div>
          )}

          {slide === 1 && (
            <div className="space-y-5">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-sky-300">
                Tu género #1
              </p>
              <h2 className="text-4xl font-black tracking-tight text-white">
                {topGenre?.genre ?? 'Pop / Urbano'}
              </h2>
              <div className="space-y-2.5">
                {summary.topGenres.map((g, idx) => (
                  <div key={g.genre} className="space-y-1">
                    <div className="flex items-center justify-between text-xs font-semibold">
                      <span className={idx === 0 ? 'text-white' : 'text-white/75'}>
                        {idx + 1}. {g.genre}
                      </span>
                      <span className="text-white/60">
                        {g.percent}% · {g.minutes} min
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-white/10">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-[#fa233b] to-sky-400"
                        style={{ width: `${Math.max(8, g.percent)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {slide === 2 && (
            <div className="space-y-5">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-rose-300">
                Tu artista #1
              </p>
              {topArtist ? (
                <div className="flex items-center gap-4">
                  {topArtist.thumbnailUrl ? (
                    <img
                      src={topArtist.thumbnailUrl}
                      alt={topArtist.title}
                      className="h-24 w-24 rounded-2xl object-cover shadow-2xl ring-2 ring-white/20"
                    />
                  ) : (
                    <div className="flex h-24 w-24 items-center justify-center rounded-2xl bg-white/10">
                      <Headphones className="h-10 w-10 text-white/70" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <h2 className="truncate text-3xl font-black text-white">{topArtist.title}</h2>
                    <p className="mt-1 text-sm text-white/70">
                      {topArtist.minutes} min · {topArtist.plays} escuchas
                    </p>
                  </div>
                </div>
              ) : (
                <h2 className="text-3xl font-black text-white">Sin datos todavía</h2>
              )}

              <div className="space-y-2 rounded-2xl border border-white/10 bg-black/25 p-3.5">
                {summary.topArtists.map((a, i) => (
                  <div key={a.key} className="flex items-center justify-between text-sm">
                    <span className="truncate font-semibold text-white">
                      <span className="mr-2 text-white/45">{i + 1}</span>
                      {a.title}
                    </span>
                    <span className="shrink-0 text-xs text-white/60">{a.minutes} min</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {slide === 3 && (
            <div className="space-y-5">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-300">
                Tu canción más escuchada
              </p>
              {topTrack ? (
                <div className="flex flex-col items-center text-center">
                  {topTrack.thumbnailUrl ? (
                    <img
                      src={topTrack.thumbnailUrl}
                      alt={topTrack.title}
                      className="h-44 w-44 rounded-3xl object-cover shadow-2xl ring-2 ring-white/20"
                    />
                  ) : (
                    <div className="flex h-44 w-44 items-center justify-center rounded-3xl bg-white/10">
                      <Music2 className="h-14 w-14 text-white/70" />
                    </div>
                  )}
                  <h2 className="mt-4 line-clamp-2 text-2xl font-black text-white">
                    {topTrack.title}
                  </h2>
                  <p className="text-sm text-white/70">{topTrack.subtitle}</p>
                  <p className="mt-1.5 rounded-full bg-emerald-400/20 px-3 py-1 text-xs font-bold text-emerald-300">
                    {topTrack.plays} reproducciones
                  </p>
                </div>
              ) : (
                <h2 className="text-3xl font-black text-white">Aún sin canción #1</h2>
              )}

              <div className="space-y-1.5 rounded-2xl border border-white/10 bg-black/25 p-3">
                {summary.topTracks.slice(0, 5).map((t, i) => (
                  <div key={t.key} className="flex items-center justify-between gap-2 text-xs">
                    <span className="truncate font-medium text-white">
                      <span className="mr-2 text-white/45">{i + 1}</span>
                      {t.title}
                    </span>
                    <span className="shrink-0 text-white/60">{t.plays}×</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {slide === 4 && (
            <div className="space-y-4">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-amber-300">
                Tu ADN musical
              </p>
              <h2 className="text-3xl font-black text-white">{summary.listeningPersona.title}</h2>
              <p className="text-sm text-white/75">{summary.listeningPersona.subtitle}</p>

              <div className="grid grid-cols-2 gap-3 pt-2">
                <div className="rounded-2xl border border-white/12 bg-black/25 p-3.5">
                  <div className="flex items-center gap-1.5 text-xs text-amber-300">
                    <Flame className="h-4 w-4" /> Racha récord
                  </div>
                  <p className="mt-1 text-2xl font-black text-white">
                    {summary.longestStreakDays} días
                  </p>
                </div>
                <div className="rounded-2xl border border-white/12 bg-black/25 p-3.5">
                  <div className="text-xs text-white/60">Hora pico</div>
                  <p className="mt-1 text-2xl font-black text-white">
                    {String(summary.peakHour).padStart(2, '0')}:00
                  </p>
                </div>
                <div className="col-span-2 rounded-2xl border border-white/12 bg-black/25 p-3.5">
                  <div className="text-xs text-white/60">Tu mes más musical</div>
                  <p className="mt-0.5 text-xl font-black text-white">
                    {summary.topMonth.name}{' '}
                    <span className="text-sm font-semibold text-white/60">
                      ({summary.topMonth.minutes} min)
                    </span>
                  </p>
                </div>
              </div>
            </div>
          )}

          {slide === 5 && (
            <div className="space-y-4">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#ff6b7c]">
                Listo para compartir
              </p>
              <div className="rounded-3xl border border-white/15 bg-black/40 p-5 shadow-xl">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-black tracking-tight text-[#fa233b]">
                    pMusic WRAPPED {summary.year}
                  </span>
                  <span className="text-xs text-white/60">
                    {summary.totalMinutes.toLocaleString('es-ES')} min
                  </span>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-4 text-xs">
                  <div>
                    <div className="mb-1.5 font-bold uppercase tracking-wider text-white/50">
                      Top Artistas
                    </div>
                    {summary.topArtists.slice(0, 5).map((a, i) => (
                      <div key={a.key} className="truncate py-0.5 font-semibold text-white">
                        {i + 1}. {a.title}
                      </div>
                    ))}
                  </div>
                  <div>
                    <div className="mb-1.5 font-bold uppercase tracking-wider text-white/50">
                      Top Canciones
                    </div>
                    {summary.topTracks.slice(0, 5).map((t, i) => (
                      <div key={t.key} className="truncate py-0.5 font-semibold text-white">
                        {i + 1}. {t.title}
                      </div>
                    ))}
                  </div>
                </div>
                <div className="mt-4 border-t border-white/10 pt-3 text-xs text-white/70">
                  Género #1: <strong className="text-white">{topGenre?.genre ?? 'Pop / Urbano'}</strong> ·{' '}
                  {summary.listeningPersona.title}
                </div>
              </div>

              <button
                type="button"
                onClick={() =>
                  downloadWrappedStoryCard(summary, userProfile?.username ?? '')
                }
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[#fa233b] px-4 py-3.5 text-sm font-bold text-white shadow-lg shadow-[#fa233b]/30 transition hover:brightness-110"
              >
                <Download className="h-4 w-4" />
                Guardar tarjeta 9:16 (TikTok / IG)
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
            className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20 disabled:opacity-25"
            aria-label="Anterior"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <span className="text-xs font-semibold text-white/55">
            {slide + 1} / {totalSlides}
          </span>
          <button
            type="button"
            onClick={() =>
              slide < totalSlides - 1 ? setSlide((s) => s + 1) : closeWrappedModal()
            }
            className="flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-white transition hover:bg-white/25"
            aria-label={slide < totalSlides - 1 ? 'Siguiente' : 'Finalizar'}
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
      </div>
    </div>
  );
};
