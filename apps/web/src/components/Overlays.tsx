import React, { useState } from 'react';
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
  Radio,
  RotateCcw,
  Settings,
  SkipBack,
  SkipForward,
  Sliders,
  Smartphone,
  Sparkles,
  Trash2,
  Volume2,
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
    setEqSheetOpen,
    setDevicesSheetOpen,
  } = usePMusicStore();

  if (!nowPlayingOpen) return null;

  const isLiked = likedTracks.some((l) => l.trackId === currentTrack.id);
  const dlStatus = offlineDownloads[currentTrack.id] ?? 'idle';
  const currentAnalysis = trackAnalyses[currentTrack.id];
  const enabledFx = djMode.enabledTransitions ?? {
    eq_swap: true,
    filter_sweep: true,
    echo_out: true,
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Reproduciendo ahora"
      data-testid="now-playing-sheet"
      className="pm-glass-regular fixed inset-0 z-50 flex flex-col overflow-hidden text-[#F5F5F7]"
    >
      {/* Dynamic album-art ambient mesh background */}
      <div
        aria-hidden="true"
        className="pm-ambient-mesh pointer-events-none absolute inset-0 opacity-65"
        style={{
          background:
            'radial-gradient(circle at 22% 24%, var(--pm-ambient-1), transparent 55%), radial-gradient(circle at 78% 72%, var(--pm-ambient-2), transparent 58%), linear-gradient(180deg, var(--pm-ambient-3) 0%, #06060A 100%)',
        }}
      />

      {/* Apple HIG 38% Bright Media Scrim (>= 0.35 constant) */}
      <div
        data-testid="bright-media-scrim"
        data-scrim="true"
        data-scrim-alpha="0.38"
        className="pointer-events-none absolute inset-0"
        style={{ backgroundColor: 'rgba(6, 6, 10, 0.42)' }}
      />

      {/* Top Header & Segmented Switcher */}
      <header className="relative z-10 flex items-center justify-between border-b border-white/10 px-4 py-3 md:px-8">
        <button
          type="button"
          aria-label="Cerrar reproductor"
          onClick={() => setNowPlayingOpen(false)}
          className="flex items-center gap-2 rounded-full bg-[#16161D] px-3.5 py-2 text-sm font-medium text-[#F5F5F7] hover:bg-[#1E1E28]"
        >
          <X className="h-4 w-4" />
          <span>Cerrar</span>
        </button>

        <div
          role="tablist"
          aria-label="Vistas del reproductor"
          className="flex items-center gap-1 rounded-full bg-[#111116] p-1"
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
                className={`rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${
                  active
                    ? 'bg-[#0051D5] text-white'
                    : 'text-[#AEAEB2] hover:text-[#F5F5F7]'
                }`}
              >
                {tab}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="Ecualizador y Crossfade"
            onClick={() => {
              setNowPlayingOpen(false);
              setEqSheetOpen(true);
            }}
            className="flex items-center gap-1.5 rounded-full bg-[#16161D] px-3 py-2 text-xs font-semibold text-[#F5F5F7] hover:bg-[#1E1E28]"
          >
            <Sliders className="h-4 w-4 text-[#0A84FF]" />
            <span>EQ</span>
          </button>
          <button
            type="button"
            aria-label="Dispositivos conectados"
            onClick={() => {
              setNowPlayingOpen(false);
              setDevicesSheetOpen(true);
            }}
            className="flex items-center gap-1.5 rounded-full bg-[#16161D] px-3 py-2 text-xs font-semibold text-[#F5F5F7] hover:bg-[#1E1E28]"
          >
            <Wifi className="h-4 w-4 text-[#30D158]" />
            <span>Dispositivos</span>
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <div className="relative z-10 flex-1 overflow-y-auto px-4 py-6 md:px-10">
        {nowPlayingTab === 'Portada' && (
          <div className="mx-auto flex max-w-2xl flex-col items-center gap-6">
            {/* Large Artwork with Soft Shadow */}
            <div className="relative aspect-square w-64 overflow-hidden rounded-[18px] border border-white/15 bg-[#16161D] shadow-2xl md:w-80">
              <img
                src={currentTrack.thumbnailHighUrl ?? currentTrack.thumbnailUrl}
                alt={currentTrack.title}
                className="h-full w-full object-cover"
              />
              {djMode.enabled && (
                <div className="absolute top-3 left-3 flex items-center gap-1.5 rounded-full bg-[#111116]/95 px-3 py-1 text-xs font-semibold text-[#BF5AF2]">
                  <Sparkles className="h-3.5 w-3.5" />
                  <span>
                    Deck {activeDeck} • {currentAnalysis?.bpm ?? 120} BPM
                  </span>
                </div>
              )}
            </div>

            {/* Title, Artist & Quick Actions */}
            <div className="flex w-full items-center justify-between gap-4">
              <div className="min-w-0 flex-1">
                <h1 className="truncate text-2xl font-bold text-[#F5F5F7]">
                  {currentTrack.title}
                </h1>
                <p className="truncate text-base font-medium text-[#AEAEB2]">
                  {currentTrack.artists.map((a) => a.name).join(', ')}
                  {currentTrack.album ? ` • ${currentTrack.album.name}` : ''}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  aria-label={isLiked ? 'Quitar de Me gusta' : 'Añadir a Me gusta'}
                  aria-pressed={isLiked}
                  onClick={() => void toggleLike(currentTrack)}
                  className={`flex items-center justify-center rounded-full p-2.5 ${
                    isLiked
                      ? 'bg-[#FF375F]/20 text-[#FF375F]'
                      : 'bg-[#16161D] text-[#AEAEB2] hover:text-white'
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
                  className="flex items-center justify-center rounded-full bg-[#16161D] p-2.5 text-[#AEAEB2] hover:text-white"
                >
                  {dlStatus === 'downloading' ? (
                    <Loader2 className="h-5 w-5 animate-spin text-[#0A84FF]" />
                  ) : dlStatus === 'downloaded' ? (
                    <Check className="h-5 w-5 text-[#30D158]" />
                  ) : (
                    <Download className="h-5 w-5" />
                  )}
                </button>
              </div>
            </div>

            {/* Scrubber & Tabular Timestamps */}
            <div className="w-full space-y-2">
              <input
                type="range"
                role="slider"
                aria-label="Progreso de la canción"
                min={0}
                max={Math.max(1, Math.round(durationSec))}
                value={Math.min(Math.round(durationSec), Math.round(positionSec))}
                onChange={(e) => seekTo(Number(e.target.value))}
                className="w-full accent-[#0A84FF]"
              />
              <div className="tabular-nums flex justify-between text-xs font-medium text-[#AEAEB2]">
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
                className="flex items-center justify-center rounded-full bg-[#16161D] p-3.5 text-[#F5F5F7] hover:bg-[#1E1E28]"
              >
                <SkipBack className="h-6 w-6" />
              </button>

              <button
                type="button"
                aria-label={isPlaying ? 'Pausar' : 'Reproducir'}
                onClick={() => void togglePlayPause()}
                className="flex h-16 w-16 items-center justify-center rounded-full bg-[#0A84FF] text-white shadow-lg hover:bg-[#0A84FF]/90"
              >
                {isPlaying ? <Pause className="h-7 w-7" /> : <Play className="h-7 w-7" />}
              </button>

              <button
                type="button"
                aria-label="Siguiente canción"
                onClick={() => void nextTrack()}
                className="flex items-center justify-center rounded-full bg-[#16161D] p-3.5 text-[#F5F5F7] hover:bg-[#1E1E28]"
              >
                <SkipForward className="h-6 w-6" />
              </button>
            </div>
          </div>
        )}

        {nowPlayingTab === 'Letras' && (
          <div
            data-testid="synced-lyrics-view"
            onWheel={() => setLyricsUserScrolled(true)}
            onTouchMove={() => setLyricsUserScrolled(true)}
            className="mx-auto max-w-2xl space-y-5 py-4"
          >
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-[#F5F5F7]">
                  Letras sincronizadas
                </h2>
                <p className="text-xs font-medium text-[#AEAEB2]">
                  Toca cualquier verso para saltar a ese segundo exacto
                </p>
              </div>
              {lyricsUserScrolled && (
                <button
                  type="button"
                  onClick={() => setLyricsUserScrolled(false)}
                  className="rounded-full bg-[#0A84FF] px-3.5 py-1.5 text-xs font-semibold text-white"
                >
                  Volver a la línea actual
                </button>
              )}
            </div>

            {currentLyrics && currentLyrics.lines.length > 0 ? (
              <div className="space-y-4">
                {currentLyrics.lines.map((line, idx) => {
                  const isActive = idx === activeLyricIndex || (activeLyricIndex === -1 && idx === 0);
                  return (
                    <button
                      key={`${line.index}-${line.timeMs}`}
                      type="button"
                      data-lyric-state={isActive ? 'active' : 'inactive'}
                      onClick={() => {
                        seekTo(line.timeMs / 1000);
                        setLyricsUserScrolled(false);
                      }}
                      className={`block w-full rounded-xl px-3 py-2 text-left text-2xl font-bold md:text-3xl ${
                        isActive ? 'pm-lyric-line-active bg-white/10' : 'pm-lyric-line-inactive'
                      }`}
                    >
                      <span>{line.text}</span>
                      <span className="tabular-nums ml-3 text-xs font-medium text-[#AEAEB2]">
                        {formatDurationSec(line.timeMs / 1000)}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="pm-surface-card rounded-2xl p-6 text-center">
                <Mic2 className="mx-auto mb-2 h-8 w-8 text-[#AEAEB2]" />
                <p className="text-base font-semibold text-[#F5F5F7]">
                  Letras no disponibles para esta pista
                </p>
              </div>
            )}
          </div>
        )}

        {nowPlayingTab === 'Cola' && (
          <div
            data-testid="queue-view"
            className="mx-auto max-w-3xl space-y-6"
          >
            {/* Modo Sesión DJ AutoMix Panel */}
            <section
              aria-label="Modo Sesión DJ AutoMix"
              className="pm-surface-card rounded-2xl p-5"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <Disc3 className="h-5 w-5 text-[#BF5AF2]" />
                    <h2 className="text-lg font-bold text-[#F5F5F7]">
                      Modo Sesión DJ (AutoMix)
                    </h2>
                  </div>
                  <p className="text-xs font-medium text-[#AEAEB2]">
                    Ordena la cola por BPM/energía y mezcla en los drops con EQ swap, filtros y eco
                  </p>
                </div>

                <button
                  type="button"
                  data-testid="dj-mode-toggle"
                  aria-pressed={djMode.enabled}
                  onClick={() => void toggleDjMode()}
                  className={`rounded-full px-4 py-2 text-sm font-bold transition-colors ${
                    djMode.enabled
                      ? 'bg-[#7D2AE8] text-white'
                      : 'bg-[#111116] text-[#AEAEB2] hover:text-white'
                  }`}
                >
                  {djMode.enabled ? 'Sesión DJ activa' : 'Activar Sesión DJ'}
                </button>
              </div>

              {/* Quick (45-90s) vs Full Session Style Selector */}
              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  data-testid="dj-style-quick"
                  aria-pressed={djMode.style === 'quick'}
                  onClick={() => void setDjSessionStyle('quick')}
                  className={`rounded-xl border p-3 text-left transition-colors ${
                    djMode.style === 'quick'
                      ? 'border-[#BF5AF2] bg-[#1E1430] text-white'
                      : 'border-white/10 bg-[#111116] text-[#AEAEB2]'
                  }`}
                >
                  <div className="text-sm font-bold text-[#F5F5F7]">
                    Sesión rápida (45–90s)
                  </div>
                  <div className="text-xs text-[#AEAEB2]">
                    Entra directo al drop/estribillo y mezcla rápido como un set de club
                  </div>
                </button>

                <button
                  type="button"
                  data-testid="dj-style-full"
                  aria-pressed={djMode.style === 'full'}
                  onClick={() => void setDjSessionStyle('full')}
                  className={`rounded-xl border p-3 text-left transition-colors ${
                    djMode.style === 'full'
                      ? 'border-[#BF5AF2] bg-[#1E1430] text-white'
                      : 'border-white/10 bg-[#111116] text-[#AEAEB2]'
                  }`}
                >
                  <div className="text-sm font-bold text-[#F5F5F7]">
                    Sesión completa
                  </div>
                  <div className="text-xs text-[#AEAEB2]">
                    Respeta la canción entera y mezcla con efectos en el tramo final
                  </div>
                </button>
              </div>

              {/* DJ Transition FX Toggles & Mix Now Trigger */}
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
                        className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                          active
                            ? 'bg-[#1E1430] text-[#F5F5F7] border border-[#BF5AF2]'
                            : 'bg-[#111116] text-[#AEAEB2] border border-white/10'
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
                  className="rounded-full bg-[#0051D5] px-4 py-1.5 text-xs font-bold text-white hover:bg-[#0051D5]/90"
                >
                  {isTransitioning
                    ? `Mezclando (${activeTransitionType ?? 'DJ'})...`
                    : 'Mezclar siguiente ahora'}
                </button>
              </div>
            </section>

            {/* Reorderable Queue List */}
            <section className="space-y-3">
              <h3 className="text-base font-bold text-[#F5F5F7]">
                Cola de reproducción ({queue.length} pistas)
              </h3>
              <div role="list" className="space-y-2">
                {queue.map((track, idx) => {
                  const isCurrent = idx === queueIndex;
                  const ana = trackAnalyses[track.id];
                  return (
                    <div
                      key={`${track.id}-${idx}`}
                      role="listitem"
                      data-surface="content"
                      className={`pm-surface-card flex items-center justify-between gap-3 rounded-xl p-3 ${
                        isCurrent ? 'border-[#0A84FF]' : ''
                      }`}
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-3">
                        <img
                          src={track.thumbnailUrl}
                          alt={track.title}
                          className="h-11 w-11 rounded-lg object-cover"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-semibold text-[#F5F5F7]">
                            {track.title}
                          </div>
                          <div className="truncate text-xs text-[#AEAEB2]">
                            {track.artists.map((a) => a.name).join(', ')}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <span className="tabular-nums rounded-md bg-[#111116] px-2 py-1 text-xs font-semibold text-[#BF5AF2]">
                          {ana?.bpm ?? 120} BPM
                        </span>

                        {idx > 0 && (
                          <button
                            type="button"
                            aria-label={`Subir ${track.title} en la cola`}
                            onClick={() => moveQueueItem(idx, idx - 1)}
                            className="rounded-lg bg-[#111116] px-2.5 py-1.5 text-xs font-semibold text-[#AEAEB2] hover:text-white"
                          >
                            ↑
                          </button>
                        )}
                        {queue.length > 1 && (
                          <button
                            type="button"
                            aria-label={`Quitar ${track.title} de la cola`}
                            onClick={() => removeQueueItem(idx)}
                            className="rounded-lg bg-[#111116] p-1.5 text-[#AEAEB2] hover:text-[#FF453A]"
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

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Ecualizador y Crossfade"
      data-testid="eq-sheet"
      className="pm-glass-regular fixed inset-x-4 bottom-4 top-16 z-50 mx-auto flex max-w-2xl flex-col overflow-y-auto rounded-[24px] p-6 text-[#F5F5F7] md:inset-y-12"
    >
      <div className="flex items-center justify-between border-b border-white/10 pb-4">
        <div className="flex items-center gap-2.5">
          <Sliders className="h-5 w-5 text-[#0A84FF]" />
          <h2 className="text-lg font-bold text-[#F5F5F7]">
            Ecualizador y Crossfade
          </h2>
        </div>
        <button
          type="button"
          aria-label="Cerrar ecualizador"
          onClick={() => setEqSheetOpen(false)}
          className="rounded-full bg-[#16161D] px-3 py-1.5 text-xs font-semibold text-[#F5F5F7]"
        >
          Cerrar
        </button>
      </div>

      <div className="mt-5 space-y-6">
        {/* Safe Crossfade Section */}
        <section className="pm-surface-card rounded-2xl p-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-[#F5F5F7]">
                Crossfade seguro (0–12 s)
              </h3>
              <p className="text-xs text-[#AEAEB2]">
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
              onClick={() => setSafeCrossfade({ enabled: !safeCrossfade.enabled })}
              className={`rounded-full px-3.5 py-1.5 text-xs font-bold ${
                safeCrossfade.enabled && !djMode.enabled
                  ? 'bg-[#0A84FF] text-white'
                  : 'bg-[#111116] text-[#AEAEB2]'
              }`}
            >
              {safeCrossfade.enabled && !djMode.enabled ? 'Activo' : 'Inactivo'}
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
              onChange={(e) => setSafeCrossfade({ durationSec: Number(e.target.value) })}
              className="flex-1 accent-[#0A84FF]"
            />
            <span className="tabular-nums text-sm font-bold text-[#F5F5F7]">
              {safeCrossfade.durationSec} s
            </span>
          </div>
        </section>

        {/* 5-Band Graphic EQ Section */}
        <section className="pm-surface-card rounded-2xl p-4">
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
              className={`rounded-full px-3.5 py-1.5 text-xs font-bold ${
                userEq.enabled ? 'bg-[#0A84FF] text-white' : 'bg-[#111116] text-[#AEAEB2]'
              }`}
            >
              {userEq.enabled ? 'EQ Activo' : 'EQ Inactivo'}
            </button>
          </div>

          {/* 6 Spanish Presets */}
          <div className="mt-3 flex flex-wrap gap-2">
            {USER_EQ_PRESETS.map((preset) => {
              const active = userEq.preset === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setEqPreset(preset.id)}
                  className={`rounded-full px-3.5 py-1.5 text-xs font-semibold ${
                    active
                      ? 'bg-[#0A84FF] text-white'
                      : 'bg-[#111116] text-[#AEAEB2] hover:text-white'
                  }`}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>

          {/* 5 Band Sliders */}
          <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-5">
            {USER_EQ_FREQUENCIES_HZ.map((freq, idx) => {
              const label = freq >= 1000 ? `${freq / 1000} kHz` : `${freq} Hz`;
              const val = userEq.bandsDb[idx] ?? 0;
              return (
                <div
                  key={freq}
                  className="flex flex-col items-center gap-2 rounded-xl bg-[#111116] p-3"
                >
                  <span className="tabular-nums text-xs font-bold text-[#0A84FF]">
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
                    onChange={(e) => setEqBandGain(idx, Number(e.target.value))}
                    className="w-full accent-[#0A84FF]"
                  />
                  <span className="tabular-nums text-xs font-medium text-[#AEAEB2]">
                    {label}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
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
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Dispositivos conectados"
      data-testid="devices-sheet"
      className="pm-glass-regular fixed inset-x-4 bottom-4 top-20 z-50 mx-auto flex max-w-xl flex-col overflow-y-auto rounded-[24px] p-6 text-[#F5F5F7] md:inset-y-16"
    >
      <div className="flex items-center justify-between border-b border-white/10 pb-4">
        <div className="flex items-center gap-2.5">
          <Wifi className="h-5 w-5 text-[#30D158]" />
          <div>
            <h2 className="text-lg font-bold text-[#F5F5F7]">
              Dispositivos (pMusic Connect)
            </h2>
            <p className="text-xs text-[#AEAEB2]">
              Controla tu PC o móvil en vivo y transfiere la canción en el segundo exacto
            </p>
          </div>
        </div>
        <button
          type="button"
          aria-label="Cerrar dispositivos"
          onClick={() => setDevicesSheetOpen(false)}
          className="rounded-full bg-[#16161D] px-3 py-1.5 text-xs font-semibold text-[#F5F5F7]"
        >
          Cerrar
        </button>
      </div>

      {lastTransferBanner && (
        <div className="mt-4 rounded-xl border border-[#30D158]/40 bg-[#30D158]/15 px-4 py-2.5 text-xs font-semibold text-[#F5F5F7]">
          {lastTransferBanner}
        </div>
      )}

      <div className="mt-4 space-y-3">
        {onlineDevices.map((dev) => {
          const isSelf = dev.device_id === selfDeviceId;
          return (
            <div
              key={dev.device_id}
              className="pm-surface-card flex flex-col gap-3 rounded-2xl p-4"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  {dev.platform === 'android' ? (
                    <Smartphone className="h-5 w-5 text-[#30D158]" />
                  ) : (
                    <Laptop className="h-5 w-5 text-[#0A84FF]" />
                  )}
                  <div>
                    <div className="flex items-center gap-2 text-sm font-bold text-[#F5F5F7]">
                      <span>{dev.device_name}</span>
                      {isSelf && (
                        <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-medium text-[#AEAEB2]">
                          Este dispositivo
                        </span>
                      )}
                      {dev.is_active && (
                        <span className="rounded-full bg-[#30D158]/20 px-2 py-0.5 text-[11px] font-semibold text-[#30D158]">
                          Activo
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-[#AEAEB2]">{dev.track_title}</div>
                  </div>
                </div>

                {!isSelf && (
                  <button
                    type="button"
                    onClick={() => void transferPlaybackToDevice(dev.device_id)}
                    className="rounded-full bg-[#30D158] px-3.5 py-2 text-xs font-bold text-[#06060A] hover:bg-[#30D158]/90"
                  >
                    Transferir aquí
                  </button>
                )}
              </div>

              {!isSelf && (
                <div className="flex items-center justify-between border-t border-white/10 pt-2">
                  <span className="text-xs font-medium text-[#AEAEB2]">
                    Control remoto en vivo:
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      aria-label={`Anterior en ${dev.device_name}`}
                      onClick={() => void sendRemoteDeviceCommand(dev.device_id, 'prev')}
                      className="rounded-lg bg-[#111116] px-2.5 py-1.5 text-xs font-semibold text-[#F5F5F7]"
                    >
                      Anterior
                    </button>
                    <button
                      type="button"
                      aria-label={`Play/Pausa en ${dev.device_name}`}
                      onClick={() => void sendRemoteDeviceCommand(dev.device_id, 'toggle')}
                      className="rounded-lg bg-[#0A84FF] px-3 py-1.5 text-xs font-semibold text-white"
                    >
                      Play / Pausa
                    </button>
                    <button
                      type="button"
                      aria-label={`Siguiente en ${dev.device_name}`}
                      onClick={() => void sendRemoteDeviceCommand(dev.device_id, 'next')}
                      className="rounded-lg bg-[#111116] px-2.5 py-1.5 text-xs font-semibold text-[#F5F5F7]"
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

      <div className="pm-surface-card mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl p-4">
        <div className="text-xs text-[#AEAEB2]">
          Modo actual:{' '}
          <strong className="text-[#F5F5F7]">
            {syncMode === 'supabase'
              ? 'Supabase Realtime Conectado'
              : 'Sincronización Local / Sin cuenta'}
          </strong>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => pairDemoCompanionDevice()}
            className="rounded-full bg-[#111116] px-3 py-1.5 text-xs font-semibold text-[#AEAEB2] hover:text-white"
          >
            Vincular dispositivo local
          </button>
          <button
            type="button"
            onClick={() => {
              setDevicesSheetOpen(false);
              setSettingsOpen(true);
            }}
            className="rounded-full bg-[#0A84FF] px-3.5 py-1.5 text-xs font-semibold text-white"
          >
            Configurar Supabase gratis
          </button>
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
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Importar playlist de Spotify o YouTube"
      data-testid="import-modal"
      className="pm-glass-regular fixed inset-x-4 bottom-6 top-16 z-50 mx-auto flex max-w-xl flex-col overflow-y-auto rounded-[24px] p-6 text-[#F5F5F7] md:inset-y-16"
    >
      <div className="flex items-center justify-between border-b border-white/10 pb-4">
        <div className="flex items-center gap-2">
          <ListMusic className="h-5 w-5 text-[#0A84FF]" />
          <h2 className="text-lg font-bold text-[#F5F5F7]">
            Importar playlist (Spotify / YouTube)
          </h2>
        </div>
        <button
          type="button"
          aria-label="Cerrar importador"
          onClick={() => setImportModalOpen(false)}
          className="rounded-full bg-[#16161D] px-3 py-1.5 text-xs font-semibold text-[#F5F5F7]"
        >
          Cerrar
        </button>
      </div>

      <div className="mt-4 space-y-4">
        <p className="text-xs font-medium text-[#AEAEB2]">
          Pega el enlace público de cualquier playlist o álbum de Spotify o YouTube Music:
        </p>

        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            type="text"
            aria-label="URL de playlist de Spotify o YouTube"
            placeholder="https://open.spotify.com/playlist/... o https://music.youtube.com/playlist?list=..."
            value={importUrlInput}
            onChange={(e) => setImportUrlInput(e.target.value)}
            className="flex-1 rounded-xl border border-white/15 bg-[#111116] px-3.5 py-2.5 text-sm text-[#F5F5F7] placeholder:text-[#8E8E93]"
          />
          <button
            type="button"
            onClick={() => void startPlaylistImport()}
            className="rounded-xl bg-[#0A84FF] px-5 py-2.5 text-sm font-bold text-white hover:bg-[#0A84FF]/90"
          >
            Importar
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() =>
              void startPlaylistImport('https://open.spotify.com/playlist/37i9dQZF1DX123456')
            }
            className="rounded-full bg-[#16161D] px-3 py-1.5 text-xs font-medium text-[#AEAEB2] hover:text-white"
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
            className="rounded-full bg-[#16161D] px-3 py-1.5 text-xs font-medium text-[#AEAEB2] hover:text-white"
          >
            Probar ejemplo YouTube Music
          </button>
        </div>

        {importProgress && importProgress.phase !== 'done' && (
          <div className="pm-surface-card space-y-2 rounded-2xl p-4">
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
              className="rounded-lg bg-[#FF453A]/20 px-3 py-1.5 text-xs font-semibold text-[#FF453A]"
            >
              Cancelar importación
            </button>
          </div>
        )}

        {importError && (
          <div
            role="status"
            className="rounded-xl border border-[#FF453A]/40 bg-[#FF453A]/15 p-3 text-xs font-semibold text-[#F5F5F7]"
          >
            {importError}
          </div>
        )}

        {importResult && (
          <div className="pm-surface-card space-y-3 rounded-2xl p-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h3 className="text-base font-bold text-[#F5F5F7]">
                  {importResult.name}
                </h3>
                <p className="text-xs text-[#AEAEB2]">
                  {importResult.items.length} canciones encontradas
                </p>
              </div>
              <button
                type="button"
                onClick={() => void saveImportedPlaylistToLibrary()}
                className="rounded-full bg-[#30D158] px-4 py-2 text-xs font-bold text-[#06060A]"
              >
                Guardar en Biblioteca
              </button>
            </div>

            {importResult.truncated && importResult.warning && (
              <div className="rounded-xl border border-[#FF9F0A]/40 bg-[#FF9F0A]/15 p-2.5 text-xs font-medium text-[#F5F5F7]">
                {importResult.warning}
              </div>
            )}

            <div className="max-h-48 space-y-1.5 overflow-y-auto">
              {importResult.items.map((item, i) => (
                <div
                  key={`${item.source.title}-${i}`}
                  className="flex items-center justify-between rounded-lg bg-[#111116] px-3 py-2 text-xs"
                >
                  <span className="truncate font-semibold text-[#F5F5F7]">
                    {item.source.title} — {item.source.artists.join(', ')}
                  </span>
                  <span className="ml-2 rounded-full bg-[#30D158]/20 px-2 py-0.5 text-[11px] font-semibold text-[#30D158]">
                    {Math.round(item.confidence * 100)}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
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

  const totalOfflineBytes = offlineEntries.reduce((sum, e) => sum + e.sizeBytes, 0);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Ajustes de pMusic"
      data-testid="settings-view"
      className="pm-glass-regular fixed inset-x-4 bottom-4 top-12 z-50 mx-auto flex max-w-2xl flex-col overflow-y-auto rounded-[24px] p-6 text-[#F5F5F7] md:inset-y-10"
    >
      <div className="flex items-center justify-between border-b border-white/10 pb-4">
        <div className="flex items-center gap-2.5">
          <Settings className="h-5 w-5 text-[#0A84FF]" />
          <h2 className="text-lg font-bold text-[#F5F5F7]">
            Ajustes y Sincronización
          </h2>
        </div>
        <button
          type="button"
          aria-label="Cerrar ajustes"
          onClick={() => setSettingsOpen(false)}
          className="rounded-full bg-[#16161D] px-3 py-1.5 text-xs font-semibold text-[#F5F5F7]"
        >
          Cerrar
        </button>
      </div>

      <div className="mt-5 space-y-6">
        {/* 1. Supabase Cloud & Auth */}
        <section className="pm-surface-card space-y-3 rounded-2xl p-4">
          <h3 className="text-sm font-bold text-[#F5F5F7]">
            Interconexión PC ↔ Móvil (Supabase Free Tier)
          </h3>
          <p className="text-xs text-[#AEAEB2]">
            Opcional: introduce tu SUPABASE_URL y SUPABASE_ANON_KEY para sincronizar playlists, gustos y control remoto en la nube gratis.
          </p>

          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <input
              type="text"
              aria-label="Nombre de este dispositivo"
              placeholder="Nombre del dispositivo"
              value={devNameVal}
              onChange={(e) => setDevNameVal(e.target.value)}
              className="rounded-xl border border-white/15 bg-[#111116] px-3 py-2 text-xs text-[#F5F5F7]"
            />
            <input
              type="text"
              aria-label="Supabase Project URL"
              placeholder="https://xyz.supabase.co"
              value={urlVal}
              onChange={(e) => setUrlVal(e.target.value)}
              className="rounded-xl border border-white/15 bg-[#111116] px-3 py-2 text-xs text-[#F5F5F7]"
            />
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              type="password"
              aria-label="Supabase Anon Key"
              placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI..."
              value={keyVal}
              onChange={(e) => setKeyVal(e.target.value)}
              className="flex-1 rounded-xl border border-white/15 bg-[#111116] px-3 py-2 text-xs text-[#F5F5F7]"
            />
            <button
              type="button"
              onClick={async () => {
                await configureSupabase(urlVal, keyVal, devNameVal);
                setAuthNotice('Configuración guardada correctamente.');
              }}
              className="rounded-xl bg-[#0A84FF] px-4 py-2 text-xs font-bold text-white"
            >
              Guardar conexión
            </button>
          </div>

          {/* Account Sign In / Sign Up */}
          <div className="border-t border-white/10 pt-3">
            {authState.connected ? (
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[#30D158]">
                  Sesión iniciada como {authState.email}
                </span>
                <button
                  type="button"
                  onClick={() => void signOutSupabase()}
                  className="rounded-full bg-[#111116] px-3 py-1.5 text-xs font-semibold text-[#FF453A]"
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
                  className="flex-1 rounded-xl border border-white/15 bg-[#111116] px-3 py-2 text-xs text-[#F5F5F7]"
                />
                <input
                  type="password"
                  aria-label="Contraseña"
                  placeholder="Contraseña"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="flex-1 rounded-xl border border-white/15 bg-[#111116] px-3 py-2 text-xs text-[#F5F5F7]"
                />
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await signInSupabase(email || 'pablo@pmusic.es', password || 'pmusic123');
                      setAuthNotice('Sesión iniciada.');
                    } catch (err) {
                      setAuthNotice(err instanceof Error ? err.message : 'Error de acceso');
                    }
                  }}
                  className="rounded-xl bg-[#30D158] px-3.5 py-2 text-xs font-bold text-[#06060A]"
                >
                  Iniciar sesión
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await signUpSupabase(email || 'pablo@pmusic.es', password || 'pmusic123');
                      setAuthNotice('Cuenta creada.');
                    } catch (err) {
                      setAuthNotice(err instanceof Error ? err.message : 'Error al registrar');
                    }
                  }}
                  className="rounded-xl bg-[#111116] px-3.5 py-2 text-xs font-semibold text-[#F5F5F7]"
                >
                  Crear cuenta
                </button>
              </div>
            )}
            {authNotice && (
              <p className="mt-2 text-xs font-medium text-[#30D158]">{authNotice}</p>
            )}
          </div>
        </section>

        {/* 2. Algoritmo de Recomendaciones y Artistas Semilla */}
        <section className="pm-surface-card space-y-3 rounded-2xl p-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-[#F5F5F7]">
                Algoritmo de Gustos y Artistas Semilla (Escena Española)
              </h3>
              <p className="text-xs text-[#AEAEB2]">
                Tus artistas favoritos tienen prioridad en búsquedas, autocompletado y Mixes
              </p>
            </div>
            <button
              type="button"
              onClick={() => void resetTasteProfile()}
              className="flex items-center gap-1 rounded-full bg-[#111116] px-3 py-1.5 text-xs font-semibold text-[#AEAEB2] hover:text-white"
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
              className="flex-1 rounded-xl border border-white/15 bg-[#111116] px-3 py-2 text-xs text-[#F5F5F7]"
            />
            <button
              type="button"
              onClick={async () => {
                await addSeedArtist(newSeedName);
                setNewSeedName('');
              }}
              className="flex items-center gap-1 rounded-xl bg-[#0A84FF] px-4 py-2 text-xs font-bold text-white"
            >
              <Plus className="h-4 w-4" />
              <span>Añadir</span>
            </button>
          </div>

          <div className="flex flex-wrap gap-2">
            {seedArtists.slice(0, 10).map((seed) => (
              <span
                key={seed.artistKey}
                className="flex items-center gap-1.5 rounded-full bg-[#111116] px-3 py-1 text-xs font-semibold text-[#F5F5F7]"
              >
                <span>{seed.displayName}</span>
                <button
                  type="button"
                  aria-label={`Eliminar semilla ${seed.displayName}`}
                  onClick={() => void removeSeedArtist(seed.artistKey)}
                  className="text-[#8E8E93] hover:text-[#FF453A]"
                >
                  ×
                </button>
              </span>
            ))}
          </div>

          <div className="text-xs text-[#AEAEB2]">
            Top afinidad actual:{' '}
            {affinityProfile
              .slice(0, 4)
              .map((a) => `${a.artistName} (+${a.score.toFixed(1)})`)
              .join(' • ')}
          </div>
        </section>

        {/* 3. Extras: Discord RPC, Caché Offline y Modo Ahorro Gráfico */}
        <section className="pm-surface-card space-y-3 rounded-2xl p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-bold text-[#F5F5F7]">
                Discord Rich Presence (Windows PC)
              </div>
              <div className="text-xs text-[#AEAEB2]">
                Muestra la canción actual y el artista en tu perfil de Discord
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={discordRpcEnabled}
              aria-label="Activar Discord Rich Presence"
              onClick={() => setDiscordRpcEnabled(!discordRpcEnabled)}
              className={`rounded-full px-3.5 py-1.5 text-xs font-bold ${
                discordRpcEnabled ? 'bg-[#0A84FF] text-white' : 'bg-[#111116] text-[#AEAEB2]'
              }`}
            >
              {discordRpcEnabled ? 'Activado' : 'Desactivado'}
            </button>
          </div>

          <div className="flex items-center justify-between border-t border-white/10 pt-3">
            <div>
              <div className="text-sm font-bold text-[#F5F5F7]">
                Modo ahorro gráfico (Reducir transparencias)
              </div>
              <div className="text-xs text-[#AEAEB2]">
                Sustituye el desenfoque Liquid Glass por superficies OLED opacas de alto rendimiento
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={graphicSaverMode}
              aria-label="Activar Modo ahorro gráfico"
              onClick={() => setGraphicSaverMode(!graphicSaverMode)}
              className={`rounded-full px-3.5 py-1.5 text-xs font-bold ${
                graphicSaverMode ? 'bg-[#0A84FF] text-white' : 'bg-[#111116] text-[#AEAEB2]'
              }`}
            >
              {graphicSaverMode ? 'Activado' : 'Desactivado'}
            </button>
          </div>

          <div className="flex items-center justify-between border-t border-white/10 pt-3">
            <div>
              <div className="text-sm font-bold text-[#F5F5F7]">
                Caché offline ({offlineEntries.length} canciones •{' '}
                {(totalOfflineBytes / 1024).toFixed(0)} KB)
              </div>
              <div className="text-xs text-[#AEAEB2]">
                Canciones guardadas para escuchar sin datos en el móvil
              </div>
            </div>
            <button
              type="button"
              onClick={() => void clearOfflineCache()}
              className="rounded-full bg-[#111116] px-3.5 py-1.5 text-xs font-semibold text-[#FF453A]"
            >
              Vaciar caché offline
            </button>
          </div>
        </section>
      </div>
    </div>
  );
};
