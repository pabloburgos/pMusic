import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  Disc3,
  Download,
  Heart,
  Laptop,
  ListMusic,
  Loader2,
  Mic2,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Settings,
  SkipBack,
  SkipForward,
  Sliders,
  Smartphone,
  Sparkles,
  Trash2,
  Wifi,
  X,
} from 'lucide-react';
import {
  USER_EQ_FREQUENCIES_HZ,
  USER_EQ_PRESETS,
  formatDurationSec,
} from '@pmusic/core';
import { usePMusicStore } from '../store/usePMusicStore.ts';

export const NowPlayingSheet: React.FC = () => {
  const {
    nowPlayingOpen,
    nowPlayingTab,
    setNowPlayingOpen,
    setNowPlayingTab,
    currentTrack,
    queue,
    queueIndex,
    isPlaying,
    positionSec,
    durationSec,
    activeDeck,
    isTransitioning,
    activeTransitionType,
    djMode,
    trackAnalyses,
    currentLyrics,
    activeLyricIndex,
    lyricsUserScrolled,
    setLyricsUserScrolled,
    likedTracks,
    offlineDownloads,
    togglePlayPause,
    nextTrack,
    prevTrack,
    seekTo,
    toggleLike,
    downloadTrackOffline,
    toggleDjMode,
    setDjSessionStyle,
    toggleDjFx,
    triggerDjMixNow,
    moveQueueItem,
    removeQueueItem,
    playTrack,
    setEqSheetOpen,
    setDevicesSheetOpen,
    openArtistDetail,
  } = usePMusicStore();

  const activeLyricRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (
      nowPlayingOpen &&
      nowPlayingTab === 'Letras' &&
      !lyricsUserScrolled &&
      activeLyricRef.current &&
      typeof activeLyricRef.current.scrollIntoView === 'function'
    ) {
      activeLyricRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }
  }, [nowPlayingOpen, nowPlayingTab, activeLyricIndex, lyricsUserScrolled]);

  if (!nowPlayingOpen) return null;

  const isLiked = likedTracks.some((l) => l.trackId === currentTrack.id);
  const dlStatus = offlineDownloads[currentTrack.id] ?? 'idle';
  const currentAnalysis = trackAnalyses[currentTrack.id];
  const enabledFx = djMode.enabledTransitions ?? {
    eq_swap: true,
    filter_sweep: true,
    echo_out: true,
  };
  const progressPct = Math.max(
    0,
    Math.min(100, (positionSec / Math.max(1, durationSec)) * 100)
  );

  const PlayerDeckColumn = (compact = false) => (
    <div
      className={`flex flex-col items-center ${
        compact ? 'w-full gap-5' : 'mx-auto w-full max-w-md gap-6'
      }`}
    >
      {/* Artwork with responsive playback scale */}
      <div
        className={`relative aspect-square overflow-hidden rounded-[20px] border border-white/10 bg-[#111115] shadow-[0_32px_80px_rgba(0,0,0,0.75)] transition-transform duration-300 ${
          compact ? 'w-56 lg:w-72' : 'w-64 sm:w-80'
        } ${isPlaying ? 'scale-100' : 'scale-[0.95]'}`}
      >
        <img
          src={currentTrack.thumbnailHighUrl ?? currentTrack.thumbnailUrl}
          alt={currentTrack.title}
          className="h-full w-full object-cover"
        />
        {djMode.enabled && (
          <div className="absolute top-3 left-3 flex items-center gap-1.5 rounded-full border border-white/15 bg-[#0B0B0E]/90 px-3 py-1 text-xs font-semibold text-[#E9D5FF]">
            <Sparkles className="h-3.5 w-3.5 text-[#C084FC]" />
            <span>
              Deck {activeDeck} · {currentAnalysis?.bpm ?? 120} BPM
            </span>
          </div>
        )}
      </div>

      {/* Title, Artist & Quick Actions */}
      <div className="flex w-full items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-bold tracking-tight text-[#F5F5F7]">
            {currentTrack.title}
          </h1>
          <button
            type="button"
            onClick={() => {
              setNowPlayingOpen(false);
              void openArtistDetail(
                currentTrack.artists[0]?.id ?? currentTrack.artists[0]?.name ?? ''
              );
            }}
            className="block max-w-full truncate text-left text-[15px] text-[#B4B4BE] hover:text-white hover:underline"
          >
            {currentTrack.artists.map((a) => a.name).join(', ')}
            {currentTrack.album ? ` · ${currentTrack.album.name}` : ''}
          </button>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            aria-label={isLiked ? 'Quitar de Me gusta' : 'Añadir a Me gusta'}
            aria-pressed={isLiked}
            onClick={() => void toggleLike(currentTrack)}
            className={`flex items-center justify-center rounded-full border border-white/[0.10] p-2.5 ${
              isLiked
                ? 'bg-[#281219] text-[#F43F5E]'
                : 'bg-[#121217]/90 text-[#B4B4BE] hover:text-white'
            }`}
          >
            <Heart className={`h-5 w-5 ${isLiked ? 'fill-current' : ''}`} />
          </button>

          <button
            type="button"
            aria-label={
              dlStatus === 'downloaded'
                ? 'Descargada offline'
                : 'Descargar para escuchar offline'
            }
            onClick={() => void downloadTrackOffline(currentTrack)}
            className="flex items-center justify-center rounded-full border border-white/[0.10] bg-[#121217]/90 p-2.5 text-[#B4B4BE] hover:text-white"
          >
            {dlStatus === 'downloading' ? (
              <Loader2 className="h-5 w-5 animate-spin text-white" />
            ) : dlStatus === 'downloaded' ? (
              <Check className="h-5 w-5 text-[#34D399]" />
            ) : (
              <Download className="h-5 w-5" />
            )}
          </button>
        </div>
      </div>

      {/* Filled Scrubber & Timestamps */}
      <div className="w-full space-y-2">
        <input
          type="range"
          role="slider"
          aria-label="Progreso de la canción"
          min={0}
          max={Math.max(1, Math.round(durationSec))}
          value={Math.min(Math.round(durationSec), Math.round(positionSec))}
          onChange={(e) => seekTo(Number(e.target.value))}
          style={{ '--pm-fill': `${progressPct}%` } as React.CSSProperties}
          className="w-full"
        />
        <div className="tabular-nums flex justify-between text-xs font-medium text-[#B4B4BE]">
          <span>{formatDurationSec(positionSec)}</span>
          <span>-{formatDurationSec(Math.max(0, durationSec - positionSec))}</span>
        </div>
      </div>

      {/* Transport Controls */}
      <div className="flex items-center justify-center gap-6">
        <button
          type="button"
          aria-label="Canción anterior"
          onClick={() => void prevTrack()}
          className="flex items-center justify-center rounded-full border border-white/[0.10] bg-[#121217]/85 p-3.5 text-[#F5F5F7] hover:bg-[#1E1E26]"
        >
          <SkipBack className="h-5 w-5" />
        </button>

        <button
          type="button"
          aria-label={isPlaying ? 'Pausar' : 'Reproducir'}
          onClick={() => void togglePlayPause()}
          className="flex h-15 w-15 items-center justify-center rounded-full bg-white text-[#070709] shadow-[0_10px_32px_rgba(255,255,255,0.22)] hover:scale-105"
        >
          {isPlaying ? (
            <Pause className="h-6 w-6 fill-current" />
          ) : (
            <Play className="h-6 w-6 translate-x-[1px] fill-current" />
          )}
        </button>

        <button
          type="button"
          aria-label="Siguiente canción"
          onClick={() => void nextTrack()}
          className="flex items-center justify-center rounded-full border border-white/[0.10] bg-[#121217]/85 p-3.5 text-[#F5F5F7] hover:bg-[#1E1E26]"
        >
          <SkipForward className="h-5 w-5" />
        </button>
      </div>
    </div>
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Reproduciendo ahora"
      data-testid="now-playing-sheet"
      className="pm-glass-regular pm-sheet-enter fixed inset-0 z-50 flex flex-col overflow-hidden text-[#F5F5F7]"
    >
      {/* Dynamic Cover-Art Gradient Backdrop (Exclusive to Song / Now Playing view) */}
      <div
        aria-hidden="true"
        className="pm-ambient-mesh pointer-events-none absolute inset-0 opacity-75"
        style={{
          background:
            'radial-gradient(circle at 18% 22%, var(--pm-ambient-1), transparent 56%), radial-gradient(circle at 82% 76%, var(--pm-ambient-2), transparent 58%), linear-gradient(180deg, var(--pm-ambient-3) 0%, #070709 100%)',
        }}
      />

      {/* Apple HIG Bright Media Scrim (44% dark wash for guaranteed contrast) */}
      <div
        data-testid="bright-media-scrim"
        data-scrim="true"
        data-scrim-alpha="0.44"
        className="pointer-events-none absolute inset-0"
        style={{ backgroundColor: 'rgba(8, 8, 12, 0.44)' }}
      />

      {/* Minimal Header */}
      <header className="relative z-10 flex items-center justify-between border-b border-white/[0.08] px-4 py-3.5 md:px-10">
        <button
          type="button"
          aria-label="Cerrar reproductor"
          onClick={() => setNowPlayingOpen(false)}
          className="inline-flex items-center gap-2 rounded-full border border-white/[0.10] bg-[#121217]/85 px-4 py-2 text-xs font-semibold text-[#F5F5F7] hover:bg-[#1D1D25]"
        >
          <X className="h-4 w-4" />
          <span className="hidden sm:inline">Cerrar</span>
        </button>

        <div
          role="tablist"
          aria-label="Vistas del reproductor"
          className="flex items-center gap-1 rounded-full border border-white/[0.08] bg-[#0B0B0E]/85 p-1"
        >
          {(['Portada', 'Letras', 'Cola'] as const).map((tab) => {
            const active = nowPlayingTab === tab;
            return (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setNowPlayingTab(tab)}
                className={`rounded-full px-4 py-1.5 text-xs font-bold ${
                  active
                    ? 'bg-white text-[#070709]'
                    : 'text-[#B4B4BE] hover:text-[#F5F5F7]'
                }`}
              >
                {tab}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            aria-label="Ecualizador y Crossfade"
            onClick={() => {
              setNowPlayingOpen(false);
              setEqSheetOpen(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.10] bg-[#121217]/85 px-3.5 py-2 text-xs font-semibold text-[#F5F5F7] hover:bg-[#1D1D25]"
          >
            <Sliders className="h-4 w-4 text-[#B4B4BE]" />
            <span className="hidden sm:inline">EQ</span>
          </button>
          <button
            type="button"
            aria-label="Dispositivos conectados"
            onClick={() => {
              setNowPlayingOpen(false);
              setDevicesSheetOpen(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.10] bg-[#121217]/85 px-3.5 py-2 text-xs font-semibold text-[#F5F5F7] hover:bg-[#1D1D25]"
          >
            <Wifi className="h-4 w-4 text-[#34D399]" />
            <span className="hidden sm:inline">Dispositivos</span>
          </button>
        </div>
      </header>

      {/* Main Content */}
      <div className="relative z-10 flex-1 overflow-y-auto px-4 py-6 md:px-10 md:py-8">
        {nowPlayingTab === 'Portada' && (
          <div className="flex min-h-full items-center justify-center">
            {PlayerDeckColumn(false)}
          </div>
        )}

        {nowPlayingTab === 'Letras' && (
          <div className="mx-auto grid max-w-6xl grid-cols-1 gap-8 lg:grid-cols-12 lg:items-start">
            <div className="hidden lg:sticky lg:top-4 lg:col-span-5 lg:block">
              {PlayerDeckColumn(true)}
            </div>

            <div
              data-testid="synced-lyrics-view"
              onWheel={() => setLyricsUserScrolled(true)}
              onTouchMove={() => setLyricsUserScrolled(true)}
              className="space-y-6 lg:col-span-7"
            >
              <div className="flex items-center justify-between lg:hidden">
                <div className="flex items-center gap-3">
                  <img
                    src={currentTrack.thumbnailUrl}
                    alt={currentTrack.title}
                    className="h-12 w-12 rounded-[10px] object-cover shadow-md"
                  />
                  <div>
                    <h2 className="text-base font-bold text-[#F5F5F7]">
                      {currentTrack.title}
                    </h2>
                    <p className="text-xs text-[#B4B4BE]">
                      {currentTrack.artists.map((a) => a.name).join(', ')} ·
                      Toca una frase para saltar
                    </p>
                  </div>
                </div>
              </div>

              {lyricsUserScrolled && (
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => setLyricsUserScrolled(false)}
                    className="rounded-full bg-white px-4 py-1.5 text-xs font-bold text-[#070709] shadow-md"
                  >
                    Sincronizar con la reproducción
                  </button>
                </div>
              )}

              {currentLyrics && currentLyrics.lines.length > 0 ? (
                <div className="space-y-3 pb-12">
                  {currentLyrics.lines.map((line, idx) => {
                    const isActive =
                      idx === activeLyricIndex ||
                      (activeLyricIndex === -1 && idx === 0);
                    return (
                      <button
                        key={`${line.index}-${line.timeMs}`}
                        ref={isActive ? activeLyricRef : undefined}
                        type="button"
                        data-lyric-state={isActive ? 'active' : 'inactive'}
                        onClick={() => {
                          seekTo(line.timeMs / 1000);
                          setLyricsUserScrolled(false);
                        }}
                        className={`block w-full rounded-[14px] px-4 py-3 text-left text-2xl font-bold tracking-tight md:text-[30px] md:leading-[1.28] ${
                          isActive
                            ? 'pm-lyric-line-active bg-white/[0.09]'
                            : 'pm-lyric-line-inactive hover:bg-white/[0.04]'
                        }`}
                      >
                        <span>{line.text}</span>
                        <span className="tabular-nums ml-3 align-middle text-xs font-medium text-[#B4B4BE]">
                          {formatDurationSec(line.timeMs / 1000)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="pm-surface-card rounded-[16px] p-10 text-center">
                  <Mic2 className="mx-auto mb-3 h-8 w-8 text-[#B4B4BE]" />
                  <p className="text-base font-semibold text-[#F5F5F7]">
                    No hay letra disponible para esta canción
                  </p>
                  <p className="mt-1 text-xs text-[#8E8E98]">
                    LRCLIB no encontró letra sincronizada ni texto para esta pista.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {nowPlayingTab === 'Cola' && (
          <div className="mx-auto grid max-w-6xl grid-cols-1 gap-8 lg:grid-cols-12 lg:items-start">
            <div className="hidden lg:sticky lg:top-4 lg:col-span-5 lg:block">
              {PlayerDeckColumn(true)}
            </div>

            <div data-testid="queue-view" className="space-y-6 lg:col-span-7">
              {/* Modo Sesión DJ AutoMix Console */}
              <section
                aria-label="Modo Sesión DJ AutoMix"
                data-surface="content"
                className="pm-surface-card rounded-[16px] p-5"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <Disc3 className="h-5 w-5 text-[#C084FC]" />
                      <h2 className="text-[17px] font-bold text-[#F5F5F7]">
                        Modo Sesión DJ (AutoMix)
                      </h2>
                    </div>
                    <p className="text-xs text-[#B4B4BE]">
                      Orden armónico por BPM y mezcla en los drops con EQ Swap, filtro y eco
                    </p>
                  </div>

                  <button
                    type="button"
                    data-testid="dj-mode-toggle"
                    aria-pressed={djMode.enabled}
                    onClick={() => void toggleDjMode()}
                    className={`rounded-full px-4 py-2 text-xs font-bold ${
                      djMode.enabled
                        ? 'bg-white text-[#070709]'
                        : 'border border-white/15 bg-[#16161C] text-[#F5F5F7] hover:bg-[#1E1E26]'
                    }`}
                  >
                    {djMode.enabled ? 'Sesión DJ activa' : 'Activar Sesión DJ'}
                  </button>
                </div>

                {/* Quick vs Full Session Selector */}
                <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <button
                    type="button"
                    data-testid="dj-style-quick"
                    aria-pressed={djMode.style === 'quick'}
                    onClick={() => void setDjSessionStyle('quick')}
                    className={`rounded-[12px] border p-3.5 text-left ${
                      djMode.style === 'quick'
                        ? 'border-white/35 bg-[#1C162A] text-white'
                        : 'border-white/[0.07] bg-[#0B0B0E] text-[#B4B4BE]'
                    }`}
                  >
                    <div className="text-sm font-bold text-[#F5F5F7]">
                      Sesión rápida (45–90s)
                    </div>
                    <div className="mt-0.5 text-xs text-[#B4B4BE]">
                      Entra directo al drop/estribillo y mezcla rápido tipo set de club
                    </div>
                  </button>

                  <button
                    type="button"
                    data-testid="dj-style-full"
                    aria-pressed={djMode.style === 'full'}
                    onClick={() => void setDjSessionStyle('full')}
                    className={`rounded-[12px] border p-3.5 text-left ${
                      djMode.style === 'full'
                        ? 'border-white/35 bg-[#1C162A] text-white'
                        : 'border-white/[0.07] bg-[#0B0B0E] text-[#B4B4BE]'
                    }`}
                  >
                    <div className="text-sm font-bold text-[#F5F5F7]">
                      Sesión completa
                    </div>
                    <div className="mt-0.5 text-xs text-[#B4B4BE]">
                      Respeta el tema completo y mezcla en el tramo final
                    </div>
                  </button>
                </div>

                {/* DJ FX Toggles & Trigger */}
                <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    {(
                      [
                        { id: 'eq_swap', label: 'EQ Swap (200Hz)' },
                        { id: 'filter_sweep', label: 'Filtro Resonante' },
                        { id: 'echo_out', label: 'Echo Out BPM' },
                      ] as const
                    ).map((fx) => {
                      const active = enabledFx[fx.id];
                      return (
                        <button
                          key={fx.id}
                          type="button"
                          aria-pressed={active}
                          onClick={() => toggleDjFx(fx.id)}
                          className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                            active
                              ? 'border-white/30 bg-[#1C162A] text-[#F5F5F7]'
                              : 'border-white/[0.08] bg-[#0B0B0E] text-[#B4B4BE]'
                          }`}
                        >
                          {fx.label}
                        </button>
                      );
                    })}
                  </div>

                  <button
                    type="button"
                    onClick={() => void triggerDjMixNow()}
                    className="rounded-full bg-white px-4 py-1.5 text-xs font-bold text-[#070709] hover:bg-white/90"
                  >
                    {isTransitioning
                      ? `Mezclando (${activeTransitionType ?? 'DJ'})...`
                      : 'Mezclar siguiente ahora'}
                  </button>
                </div>
              </section>

              {/* Queue List */}
              <section className="space-y-2.5">
                <h3 className="text-base font-bold text-[#F5F5F7]">
                  Cola de reproducción ({queue.length} pistas)
                </h3>
                <div role="list" className="space-y-1.5">
                  {queue.map((track, idx) => {
                    const isCurrent = idx === queueIndex;
                    const ana = trackAnalyses[track.id];
                    return (
                      <div
                        key={`${track.id}-${idx}`}
                        role="listitem"
                        data-surface="content"
                        className={`pm-surface-card flex h-15 items-center justify-between gap-3 rounded-[10px] px-3 ${
                          isCurrent ? 'border-white/25 bg-[#191922]' : ''
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => void playTrack(track, queue)}
                          className="flex min-w-0 flex-1 items-center gap-3 text-left"
                        >
                          <img
                            src={track.thumbnailUrl}
                            alt={track.title}
                            className="h-10 w-10 shrink-0 rounded-[8px] object-cover"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[14px] font-medium text-[#F5F5F7]">
                              {track.title}
                            </div>
                            <div className="truncate text-xs text-[#B4B4BE]">
                              {track.artists.map((a) => a.name).join(', ')}
                            </div>
                          </div>
                        </button>

                        <div className="flex items-center gap-1.5">
                          <span className="tabular-nums rounded-full border border-white/[0.08] bg-[#0B0B0E] px-2.5 py-1 text-xs font-semibold text-[#E9D5FF]">
                            {ana?.bpm ?? 120} BPM
                          </span>

                          {idx > 0 && (
                            <button
                              type="button"
                              aria-label={`Subir ${track.title} en la cola`}
                              onClick={() => moveQueueItem(idx, idx - 1)}
                              className="rounded-full bg-[#0B0B0E] px-2.5 py-1 text-xs font-semibold text-[#B4B4BE] hover:text-white"
                            >
                              ↑
                            </button>
                          )}
                          {queue.length > 1 && (
                            <button
                              type="button"
                              aria-label={`Quitar ${track.title} de la cola`}
                              onClick={() => removeQueueItem(idx)}
                              className="rounded-full bg-[#0B0B0E] p-1.5 text-[#B4B4BE] hover:text-[#F87171]"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export const EqAndCrossfadeSheet: React.FC = () => {
  const {
    eqSheetOpen,
    setEqSheetOpen,
    userEq,
    safeCrossfade,
    djMode,
    setEqPreset,
    setEqBandGain,
    setEqEnabled,
    setSafeCrossfade,
  } = usePMusicStore();

  if (!eqSheetOpen) return null;

  const crossfadePct = Math.round((safeCrossfade.durationSec / 12) * 100);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        aria-hidden="true"
        onClick={() => setEqSheetOpen(false)}
        className="absolute inset-0 bg-black/70"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Ecualizador y Crossfade"
        data-testid="eq-sheet"
        className="pm-glass-regular pm-sheet-enter relative z-10 flex max-h-[88dvh] w-full max-w-2xl flex-col overflow-y-auto rounded-[22px] p-6 text-[#F5F5F7]"
      >
        <div className="flex items-center justify-between border-b border-white/[0.08] pb-4">
          <div className="flex items-center gap-2.5">
            <Sliders className="h-5 w-5 text-[#F5F5F7]" />
            <h2 className="text-lg font-bold text-[#F5F5F7]">
              Ecualizador y Crossfade
            </h2>
          </div>
          <button
            type="button"
            aria-label="Cerrar ecualizador"
            onClick={() => setEqSheetOpen(false)}
            className="rounded-full border border-white/[0.08] bg-[#141419] px-3.5 py-1.5 text-xs font-semibold text-[#F5F5F7] hover:bg-[#1E1E26]"
          >
            Cerrar
          </button>
        </div>

        <div className="mt-5 space-y-5">
          <section
            data-surface="content"
            className="pm-surface-card rounded-[16px] p-4"
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-[#F5F5F7]">
                  Crossfade seguro (0–12 s)
                </h3>
                <p className="text-xs text-[#B4B4BE]">
                  {djMode.enabled
                    ? 'Pausado automáticamente mientras el Modo Sesión DJ está activo'
                    : 'Transición suave de potencia constante entre canciones'}
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={safeCrossfade.enabled}
                aria-label="Activar Crossfade seguro"
                disabled={djMode.enabled}
                onClick={() =>
                  setSafeCrossfade({ enabled: !safeCrossfade.enabled })
                }
                className={`rounded-full px-4 py-1.5 text-xs font-bold ${
                  safeCrossfade.enabled && !djMode.enabled
                    ? 'bg-white text-[#070709]'
                    : 'bg-[#0B0B0E] text-[#B4B4BE]'
                }`}
              >
                {safeCrossfade.enabled && !djMode.enabled
                  ? 'Activo'
                  : 'Inactivo'}
              </button>
            </div>

            <div className="mt-3 flex items-center gap-4">
              <input
                type="range"
                role="slider"
                aria-label="Duración de Crossfade en segundos"
                min={0}
                max={12}
                step={1}
                value={safeCrossfade.durationSec}
                onChange={(e) =>
                  setSafeCrossfade({ durationSec: Number(e.target.value) })
                }
                style={{ '--pm-fill': `${crossfadePct}%` } as React.CSSProperties}
                className="flex-1"
              />
              <span className="tabular-nums text-sm font-bold text-[#F5F5F7]">
                {safeCrossfade.durationSec} s
              </span>
            </div>
          </section>

          <section
            data-surface="content"
            className="pm-surface-card rounded-[16px] p-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-[#F5F5F7]">
                Ecualizador de 5 bandas
              </h3>
              <button
                type="button"
                role="switch"
                aria-checked={userEq.enabled}
                aria-label="Activar ecualizador"
                onClick={() => setEqEnabled(!userEq.enabled)}
                className={`rounded-full px-4 py-1.5 text-xs font-bold ${
                  userEq.enabled
                    ? 'bg-white text-[#070709]'
                    : 'bg-[#0B0B0E] text-[#B4B4BE]'
                }`}
              >
                {userEq.enabled ? 'EQ Activo' : 'EQ Inactivo'}
              </button>
            </div>

            <div className="mt-3 flex flex-wrap gap-1.5">
              {USER_EQ_PRESETS.map((preset) => {
                const active = userEq.preset === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setEqPreset(preset.id)}
                    className={`rounded-full px-3.5 py-1.5 text-xs font-bold ${
                      active
                        ? 'bg-white text-[#070709]'
                        : 'border border-white/[0.08] bg-[#0B0B0E] text-[#B4B4BE] hover:text-white'
                    }`}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>

            <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-5">
              {USER_EQ_FREQUENCIES_HZ.map((freq, idx) => {
                const label =
                  freq >= 1000 ? `${freq / 1000} kHz` : `${freq} Hz`;
                const val = userEq.bandsDb[idx] ?? 0;
                const pct = Math.round(((val + 12) / 24) * 100);
                return (
                  <div
                    key={freq}
                    className="flex flex-col items-center gap-2 rounded-[12px] border border-white/[0.06] bg-[#0B0B0E] p-3"
                  >
                    <span className="tabular-nums text-xs font-bold text-[#F5F5F7]">
                      {val > 0 ? `+${val}` : val} dB
                    </span>
                    <input
                      type="range"
                      role="slider"
                      aria-label={`Banda EQ ${label}`}
                      min={-12}
                      max={12}
                      step={0.5}
                      value={val}
                      onChange={(e) =>
                        setEqBandGain(idx, Number(e.target.value))
                      }
                      style={{ '--pm-fill': `${pct}%` } as React.CSSProperties}
                      className="w-full"
                    />
                    <span className="tabular-nums text-xs font-medium text-[#8E8E98]">
                      {label}
                    </span>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};

export const DevicesConnectSheet: React.FC = () => {
  const {
    devicesSheetOpen,
    setDevicesSheetOpen,
    onlineDevices,
    selfDeviceId,
    syncMode,
    lastTransferBanner,
    transferPlaybackToDevice,
    sendRemoteDeviceCommand,
    pairDemoCompanionDevice,
    setSettingsOpen,
  } = usePMusicStore();

  if (!devicesSheetOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        aria-hidden="true"
        onClick={() => setDevicesSheetOpen(false)}
        className="absolute inset-0 bg-black/70"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Dispositivos conectados"
        data-testid="devices-sheet"
        className="pm-glass-regular pm-sheet-enter relative z-10 flex max-h-[86dvh] w-full max-w-xl flex-col overflow-y-auto rounded-[22px] p-6 text-[#F5F5F7]"
      >
        <div className="flex items-center justify-between border-b border-white/[0.08] pb-4">
          <div className="flex items-center gap-2.5">
            <Wifi className="h-5 w-5 text-[#34D399]" />
            <div>
              <h2 className="text-lg font-bold text-[#F5F5F7]">
                Dispositivos (pMusic Connect)
              </h2>
              <p className="text-xs text-[#B4B4BE]">
                Controla tu PC o móvil en vivo y transfiere la canción en el segundo exacto
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Cerrar dispositivos"
            onClick={() => setDevicesSheetOpen(false)}
            className="rounded-full border border-white/[0.08] bg-[#141419] px-3.5 py-1.5 text-xs font-semibold text-[#F5F5F7]"
          >
            Cerrar
          </button>
        </div>

        {lastTransferBanner && (
          <div className="mt-4 rounded-xl border border-[#34D399]/40 bg-[#0A261D] px-4 py-2.5 text-xs font-semibold text-[#F5F5F7]">
            {lastTransferBanner}
          </div>
        )}

        <div className="mt-4 space-y-3">
          {onlineDevices.map((dev) => {
            const isSelf = dev.device_id === selfDeviceId;
            return (
              <div
                key={dev.device_id}
                data-surface="content"
                className="pm-surface-card flex flex-col gap-3 rounded-[16px] p-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    {dev.platform === 'android' ? (
                      <Smartphone className="h-5 w-5 text-[#34D399]" />
                    ) : (
                      <Laptop className="h-5 w-5 text-[#F5F5F7]" />
                    )}
                    <div>
                      <div className="flex items-center gap-2 text-sm font-bold text-[#F5F5F7]">
                        <span>{dev.device_name}</span>
                        {isSelf && (
                          <span className="rounded-full bg-white/[0.09] px-2.5 py-0.5 text-[11px] font-medium text-[#B4B4BE]">
                            Este dispositivo
                          </span>
                        )}
                        {dev.is_active && (
                          <span className="rounded-full bg-[#0A261D] px-2.5 py-0.5 text-[11px] font-semibold text-[#34D399]">
                            Activo
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-[#B4B4BE]">
                        {dev.track_title}
                      </div>
                    </div>
                  </div>

                  {!isSelf && (
                    <button
                      type="button"
                      onClick={() =>
                        void transferPlaybackToDevice(dev.device_id)
                      }
                      className="rounded-full bg-white px-4 py-2 text-xs font-bold text-[#070709] hover:bg-white/90"
                    >
                      Transferir aquí
                    </button>
                  )}
                </div>

                {!isSelf && (
                  <div className="flex items-center justify-between border-t border-white/[0.07] pt-2">
                    <span className="text-xs font-medium text-[#8E8E98]">
                      Control remoto en vivo:
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        aria-label={`Anterior en ${dev.device_name}`}
                        onClick={() =>
                          void sendRemoteDeviceCommand(dev.device_id, 'prev')
                        }
                        className="rounded-full bg-[#0B0B0E] px-3 py-1.5 text-xs font-semibold text-[#F5F5F7]"
                      >
                        Anterior
                      </button>
                      <button
                        type="button"
                        aria-label={`Play/Pausa en ${dev.device_name}`}
                        onClick={() =>
                          void sendRemoteDeviceCommand(dev.device_id, 'toggle')
                        }
                        className="rounded-full bg-white px-3.5 py-1.5 text-xs font-bold text-[#070709]"
                      >
                        Play / Pausa
                      </button>
                      <button
                        type="button"
                        aria-label={`Siguiente en ${dev.device_name}`}
                        onClick={() =>
                          void sendRemoteDeviceCommand(dev.device_id, 'next')
                        }
                        className="rounded-full bg-[#0B0B0E] px-3 py-1.5 text-xs font-semibold text-[#F5F5F7]"
                      >
                        Siguiente
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div
          data-surface="content"
          className="pm-surface-card mt-5 flex flex-wrap items-center justify-between gap-3 rounded-[16px] p-4"
        >
          <div className="text-xs text-[#B4B4BE]">
            Estado:{' '}
            <strong className="text-[#F5F5F7]">
              {syncMode === 'supabase'
                ? 'Supabase Realtime Conectado'
                : 'Sincronización Local Activa'}
            </strong>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => pairDemoCompanionDevice()}
              className="rounded-full border border-white/[0.08] bg-[#0B0B0E] px-3.5 py-1.5 text-xs font-semibold text-[#B4B4BE] hover:text-white"
            >
              Vincular dispositivo local
            </button>
            <button
              type="button"
              onClick={() => {
                setDevicesSheetOpen(false);
                setSettingsOpen(true);
              }}
              className="rounded-full bg-white px-4 py-1.5 text-xs font-bold text-[#070709]"
            >
              Ajustes de cuenta
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export const ImportPlaylistModal: React.FC = () => {
  const {
    importModalOpen,
    setImportModalOpen,
    importUrlInput,
    setImportUrlInput,
    importProgress,
    importResult,
    importError,
    startPlaylistImport,
    cancelPlaylistImport,
    saveImportedPlaylistToLibrary,
  } = usePMusicStore();

  if (!importModalOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        aria-hidden="true"
        onClick={() => setImportModalOpen(false)}
        className="absolute inset-0 bg-black/70"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Importar playlist de Spotify o YouTube"
        data-testid="import-modal"
        className="pm-glass-regular pm-sheet-enter relative z-10 flex max-h-[86dvh] w-full max-w-xl flex-col overflow-y-auto rounded-[22px] p-6 text-[#F5F5F7]"
      >
        <div className="flex items-center justify-between border-b border-white/[0.08] pb-4">
          <div className="flex items-center gap-2">
            <ListMusic className="h-5 w-5 text-[#F5F5F7]" />
            <h2 className="text-lg font-bold text-[#F5F5F7]">
              Importar playlist (Spotify / YouTube)
            </h2>
          </div>
          <button
            type="button"
            aria-label="Cerrar importador"
            onClick={() => setImportModalOpen(false)}
            className="rounded-full border border-white/[0.08] bg-[#141419] px-3.5 py-1.5 text-xs font-semibold text-[#F5F5F7]"
          >
            Cerrar
          </button>
        </div>

        <div className="mt-4 space-y-4">
          <p className="text-xs font-medium text-[#B4B4BE]">
            Pega el enlace público de cualquier playlist o álbum de Spotify o YouTube Music:
          </p>

          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              type="text"
              aria-label="URL de playlist de Spotify o YouTube"
              placeholder="https://open.spotify.com/playlist/... o https://music.youtube.com/playlist?list=..."
              value={importUrlInput}
              onChange={(e) => setImportUrlInput(e.target.value)}
              className="flex-1 rounded-full border border-white/15 bg-[#0B0B0E] px-4 py-2.5 text-sm text-[#F5F5F7] placeholder:text-[#8E8E98]"
            />
            <button
              type="button"
              onClick={() => void startPlaylistImport()}
              className="rounded-full bg-white px-5 py-2.5 text-sm font-bold text-[#070709] hover:bg-white/90"
            >
              Importar
            </button>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() =>
                void startPlaylistImport(
                  'https://open.spotify.com/playlist/37i9dQZF1DX123456'
                )
              }
              className="rounded-full border border-white/[0.08] bg-[#121217] px-3.5 py-1.5 text-xs font-medium text-[#B4B4BE] hover:text-white"
            >
              Probar ejemplo Spotify Urbano ES
            </button>
            <button
              type="button"
              onClick={() =>
                void startPlaylistImport(
                  'https://music.youtube.com/playlist?list=PL_URBANO_ES_2026'
                )
              }
              className="rounded-full border border-white/[0.08] bg-[#121217] px-3.5 py-1.5 text-xs font-medium text-[#B4B4BE] hover:text-white"
            >
              Probar ejemplo YouTube Music
            </button>
          </div>

          {importProgress && importProgress.phase !== 'done' && (
            <div
              data-surface="content"
              className="pm-surface-card space-y-2 rounded-[14px] p-4"
            >
              <div className="flex items-center justify-between text-xs font-semibold">
                <span>
                  Fase: {importProgress.phase}{' '}
                  {importProgress.currentTrackTitle
                    ? `— ${importProgress.currentTrackTitle}`
                    : ''}
                </span>
                <span className="tabular-nums">
                  {importProgress.completed}/{Math.max(1, importProgress.total)}
                </span>
              </div>
              <button
                type="button"
                onClick={() => cancelPlaylistImport()}
                className="rounded-full bg-[#281219] px-3.5 py-1.5 text-xs font-semibold text-[#F87171]"
              >
                Cancelar importación
              </button>
            </div>
          )}

          {importError && (
            <div
              role="status"
              className="rounded-xl border border-[#F87171]/40 bg-[#281219] p-3 text-xs font-semibold text-[#F5F5F7]"
            >
              {importError}
            </div>
          )}

          {importResult && (
            <div
              data-surface="content"
              className="pm-surface-card space-y-3 rounded-[16px] p-4"
            >
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h3 className="text-base font-bold text-[#F5F5F7]">
                    {importResult.name}
                  </h3>
                  <p className="text-xs text-[#B4B4BE]">
                    {importResult.items.length} canciones encontradas
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void saveImportedPlaylistToLibrary()}
                  className="rounded-full bg-white px-4 py-2 text-xs font-bold text-[#070709]"
                >
                  Guardar en Biblioteca
                </button>
              </div>

              {importResult.truncated && importResult.warning && (
                <div className="rounded-xl border border-[#FBBF24]/40 bg-[#27200B] p-2.5 text-xs font-medium text-[#F5F5F7]">
                  {importResult.warning}
                </div>
              )}

              <div className="max-h-48 space-y-1.5 overflow-y-auto">
                {importResult.items.map((item, i) => (
                  <div
                    key={`${item.source.title}-${i}`}
                    className="flex items-center justify-between rounded-lg bg-[#0B0B0E] px-3 py-2 text-xs"
                  >
                    <span className="truncate font-semibold text-[#F5F5F7]">
                      {item.source.title} — {item.source.artists.join(', ')}
                    </span>
                    <span className="ml-2 rounded-full bg-[#0A261D] px-2.5 py-0.5 text-[11px] font-semibold text-[#34D399]">
                      {Math.round(item.confidence * 100)}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export const SettingsModal: React.FC = () => {
  const {
    settingsOpen,
    setSettingsOpen,
    supabaseUrlInput,
    supabaseAnonKeyInput,
    deviceName,
    authState,
    seedArtists,
    affinityProfile,
    offlineEntries,
    graphicSaverMode,
    discordRpcEnabled,
    configureSupabase,
    signInSupabase,
    signUpSupabase,
    signOutSupabase,
    addSeedArtist,
    removeSeedArtist,
    resetTasteProfile,
    clearOfflineCache,
    setGraphicSaverMode,
    setDiscordRpcEnabled,
  } = usePMusicStore();

  const [urlVal, setUrlVal] = useState(supabaseUrlInput);
  const [keyVal, setKeyVal] = useState(supabaseAnonKeyInput);
  const [devNameVal, setDevNameVal] = useState(deviceName);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [newSeedName, setNewSeedName] = useState('');
  const [authNotice, setAuthNotice] = useState<string | null>(null);

  if (!settingsOpen) return null;

  const totalOfflineBytes = offlineEntries.reduce(
    (sum, e) => sum + e.sizeBytes,
    0
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        aria-hidden="true"
        onClick={() => setSettingsOpen(false)}
        className="absolute inset-0 bg-black/70"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Ajustes de pMusic"
        data-testid="settings-view"
        className="pm-glass-regular pm-sheet-enter relative z-10 flex max-h-[88dvh] w-full max-w-2xl flex-col overflow-y-auto rounded-[22px] p-6 text-[#F5F5F7]"
      >
        <div className="flex items-center justify-between border-b border-white/[0.08] pb-4">
          <div className="flex items-center gap-2.5">
            <Settings className="h-5 w-5 text-[#F5F5F7]" />
            <h2 className="text-lg font-bold text-[#F5F5F7]">
              Ajustes y Sincronización
            </h2>
          </div>
          <button
            type="button"
            aria-label="Cerrar ajustes"
            onClick={() => setSettingsOpen(false)}
            className="rounded-full border border-white/[0.08] bg-[#141419] px-3.5 py-1.5 text-xs font-semibold text-[#F5F5F7]"
          >
            Cerrar
          </button>
        </div>

        <div className="mt-5 space-y-5">
          <section
            data-surface="content"
            className="pm-surface-card space-y-3 rounded-[16px] p-4"
          >
            <h3 className="text-sm font-bold text-[#F5F5F7]">
              Interconexión PC ↔ Móvil (Supabase Free Tier)
            </h3>
            <p className="text-xs text-[#B4B4BE]">
              Tu proyecto Supabase (
              <code className="text-[#F5F5F7]">zlaxnxkfwngmwqnqnqtu</code>) ya
              está preconfigurado. Inicia sesión con el mismo correo en tu móvil
              y en tu PC.
            </p>

            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <input
                type="text"
                aria-label="Nombre de este dispositivo"
                placeholder="Nombre del dispositivo"
                value={devNameVal}
                onChange={(e) => setDevNameVal(e.target.value)}
                className="rounded-full border border-white/15 bg-[#0B0B0E] px-4 py-2 text-xs text-[#F5F5F7]"
              />
              <input
                type="text"
                aria-label="Supabase Project URL"
                placeholder="https://xyz.supabase.co"
                value={urlVal}
                onChange={(e) => setUrlVal(e.target.value)}
                className="rounded-full border border-white/15 bg-[#0B0B0E] px-4 py-2 text-xs text-[#F5F5F7]"
              />
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                type="password"
                aria-label="Supabase Anon Key"
                placeholder="sb_publishable_..."
                value={keyVal}
                onChange={(e) => setKeyVal(e.target.value)}
                className="flex-1 rounded-full border border-white/15 bg-[#0B0B0E] px-4 py-2 text-xs text-[#F5F5F7]"
              />
              <button
                type="button"
                onClick={async () => {
                  await configureSupabase(urlVal, keyVal, devNameVal);
                  setAuthNotice('Configuración guardada correctamente.');
                }}
                className="rounded-full bg-white px-4 py-2 text-xs font-bold text-[#070709]"
              >
                Guardar conexión
              </button>
            </div>

            <div className="border-t border-white/[0.07] pt-3">
              {authState.connected ? (
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-[#34D399]">
                    Sesión iniciada como {authState.email}
                  </span>
                  <button
                    type="button"
                    onClick={() => void signOutSupabase()}
                    className="rounded-full bg-[#0B0B0E] px-3.5 py-1.5 text-xs font-semibold text-[#F87171]"
                  >
                    Cerrar sesión
                  </button>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="email"
                    aria-label="Correo electrónico"
                    placeholder="tu@email.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="flex-1 rounded-full border border-white/15 bg-[#0B0B0E] px-4 py-2 text-xs text-[#F5F5F7]"
                  />
                  <input
                    type="password"
                    aria-label="Contraseña"
                    placeholder="Contraseña"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="flex-1 rounded-full border border-white/15 bg-[#0B0B0E] px-4 py-2 text-xs text-[#F5F5F7]"
                  />
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await signInSupabase(
                          email || 'pablo@pmusic.es',
                          password || 'pmusic123'
                        );
                        setAuthNotice('Sesión iniciada.');
                      } catch (err) {
                        setAuthNotice(
                          err instanceof Error ? err.message : 'Error de acceso'
                        );
                      }
                    }}
                    className="rounded-full bg-white px-4 py-2 text-xs font-bold text-[#070709]"
                  >
                    Iniciar sesión
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await signUpSupabase(
                          email || 'pablo@pmusic.es',
                          password || 'pmusic123'
                        );
                        setAuthNotice('Cuenta creada.');
                      } catch (err) {
                        setAuthNotice(
                          err instanceof Error
                            ? err.message
                            : 'Error al registrar'
                        );
                      }
                    }}
                    className="rounded-full border border-white/10 bg-[#0B0B0E] px-4 py-2 text-xs font-semibold text-[#F5F5F7]"
                  >
                    Crear cuenta
                  </button>
                </div>
              )}
              {authNotice && (
                <p className="mt-2 text-xs font-medium text-[#34D399]">
                  {authNotice}
                </p>
              )}
            </div>
          </section>

          <section
            data-surface="content"
            className="pm-surface-card space-y-3 rounded-[16px] p-4"
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-[#F5F5F7]">
                  Algoritmo de Gustos y Artistas Semilla
                </h3>
                <p className="text-xs text-[#B4B4BE]">
                  Tus artistas favoritos tienen prioridad en búsquedas, autocompletado y Mixes
                </p>
              </div>
              <button
                type="button"
                onClick={() => void resetTasteProfile()}
                className="flex items-center gap-1 rounded-full bg-[#0B0B0E] px-3.5 py-1.5 text-xs font-semibold text-[#B4B4BE] hover:text-white"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span>Restablecer gustos</span>
              </button>
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                aria-label="Añadir artista favorito"
                placeholder="Ej. Cruz Cafuné, La Pantera, Bad Bunny..."
                value={newSeedName}
                onChange={(e) => setNewSeedName(e.target.value)}
                className="flex-1 rounded-full border border-white/15 bg-[#0B0B0E] px-4 py-2 text-xs text-[#F5F5F7]"
              />
              <button
                type="button"
                onClick={async () => {
                  await addSeedArtist(newSeedName);
                  setNewSeedName('');
                }}
                className="flex items-center gap-1 rounded-full bg-white px-4 py-2 text-xs font-bold text-[#070709]"
              >
                <Plus className="h-4 w-4" />
                <span>Añadir</span>
              </button>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {seedArtists.slice(0, 10).map((seed) => (
                <span
                  key={seed.artistKey}
                  className="flex items-center gap-1.5 rounded-full border border-white/[0.07] bg-[#0B0B0E] px-3 py-1 text-xs font-semibold text-[#F5F5F7]"
                >
                  <span>{seed.displayName}</span>
                  <button
                    type="button"
                    aria-label={`Eliminar semilla ${seed.displayName}`}
                    onClick={() => void removeSeedArtist(seed.artistKey)}
                    className="text-[#8E8E98] hover:text-[#F87171]"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>

            <div className="text-xs text-[#B4B4BE]">
              Top afinidad actual:{' '}
              {affinityProfile
                .slice(0, 4)
                .map((a) => `${a.artistName} (+${a.score.toFixed(1)})`)
                .join(' · ')}
            </div>
          </section>

          <section
            data-surface="content"
            className="pm-surface-card space-y-3 rounded-[16px] p-4"
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-bold text-[#F5F5F7]">
                  Discord Rich Presence (Windows PC)
                </div>
                <div className="text-xs text-[#B4B4BE]">
                  Muestra la canción actual y el artista en tu perfil de Discord
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={discordRpcEnabled}
                aria-label="Activar Discord Rich Presence"
                onClick={() => setDiscordRpcEnabled(!discordRpcEnabled)}
                className={`rounded-full px-4 py-1.5 text-xs font-bold ${
                  discordRpcEnabled
                    ? 'bg-white text-[#070709]'
                    : 'bg-[#0B0B0E] text-[#B4B4BE]'
                }`}
              >
                {discordRpcEnabled ? 'Activado' : 'Desactivado'}
              </button>
            </div>

            <div className="flex items-center justify-between border-t border-white/[0.07] pt-3">
              <div>
                <div className="text-sm font-bold text-[#F5F5F7]">
                  Modo ahorro gráfico (Reducir transparencias)
                </div>
                <div className="text-xs text-[#B4B4BE]">
                  Sustituye el desenfoque Liquid Glass por superficies OLED opacas
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={graphicSaverMode}
                aria-label="Activar Modo ahorro gráfico"
                onClick={() => setGraphicSaverMode(!graphicSaverMode)}
                className={`rounded-full px-4 py-1.5 text-xs font-bold ${
                  graphicSaverMode
                    ? 'bg-white text-[#070709]'
                    : 'bg-[#0B0B0E] text-[#B4B4BE]'
                }`}
              >
                {graphicSaverMode ? 'Activado' : 'Desactivado'}
              </button>
            </div>

            <div className="flex items-center justify-between border-t border-white/[0.07] pt-3">
              <div>
                <div className="text-sm font-bold text-[#F5F5F7]">
                  Caché offline ({offlineEntries.length} canciones ·{' '}
                  {(totalOfflineBytes / 1024).toFixed(0)} KB)
                </div>
                <div className="text-xs text-[#B4B4BE]">
                  Canciones guardadas para escuchar sin datos
                </div>
              </div>
              <button
                type="button"
                onClick={() => void clearOfflineCache()}
                className="rounded-full bg-[#0B0B0E] px-4 py-1.5 text-xs font-semibold text-[#F87171]"
              >
                Vaciar caché offline
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};
