import React, { useEffect, useState } from 'react';
import {
  Car,
  Heart,
  ListMusic,
  Mic,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Sparkles,
  X,
} from 'lucide-react';
import { formatDurationSec, type Track } from '@pmusic/core';
import { usePMusicStore } from '../store/usePMusicStore.ts';
import { PMusicLogo } from './PMusicLogo.tsx';

type CarBrowseTab = 'para-ti' | 'playlists' | 'me-gusta';

export const CarModeView: React.FC = () => {
  const {
    carModeOpen,
    setCarModeOpen,
    currentTrack,
    isPlaying,
    positionSec,
    durationSec,
    homeShelves,
    playlists,
    likedTracks,
    togglePlayPause,
    nextTrack,
    prevTrack,
    toggleLike,
    playTrack,
    playFromVoiceQuery,
    showToast,
  } = usePMusicStore();

  const [tab, setTab] = useState<CarBrowseTab>('para-ti');
  const [voiceListening, setVoiceListening] = useState(false);
  const [quickPromptOpen, setQuickPromptOpen] = useState(false);
  const [quickQuery, setQuickQuery] = useState('');

  useEffect(() => {
    if (!carModeOpen || typeof window === 'undefined') return;
    const win = window as unknown as {
      __pmusicVoiceSearchResult?: (q: string) => void;
    };
    const prev = win.__pmusicVoiceSearchResult;
    win.__pmusicVoiceSearchResult = (text: string) => {
      setVoiceListening(false);
      if (text?.trim()) {
        void playFromVoiceQuery(text.trim());
      }
    };
    return () => {
      win.__pmusicVoiceSearchResult = prev;
    };
  }, [carModeOpen, playFromVoiceQuery]);

  if (!carModeOpen) return null;

  const isLiked = likedTracks.some((l) => l.trackId === currentTrack.id);
  const dur = Math.max(1, durationSec || currentTrack.durationSec);
  const pct = Math.max(0, Math.min(100, (positionSec / dur) * 100));

  const recommendedTracks: Track[] = Array.from(
    new Map(homeShelves.flatMap((s) => s.tracks ?? []).map((t) => [t.id, t])).values()
  ).slice(0, 12);

  const handleVoicePress = () => {
    const native = (window as unknown as {
      PMusicNative?: { startVoiceSearch?: () => boolean };
    }).PMusicNative;
    if (native?.startVoiceSearch) {
      try {
        setVoiceListening(true);
        const started = native.startVoiceSearch();
        if (started) return;
      } catch {
        // fall through to Web Speech or quick bar
      }
      setVoiceListening(false);
    }

    const SpeechCtor =
      typeof window !== 'undefined'
        ? ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)
        : null;
    if (SpeechCtor) {
      try {
        const rec = new SpeechCtor();
        rec.lang = 'es-ES';
        rec.interimResults = false;
        rec.maxAlternatives = 1;
        setVoiceListening(true);
        rec.onresult = (ev: any) => {
          setVoiceListening(false);
          const transcript = ev?.results?.[0]?.[0]?.transcript ?? '';
          if (transcript) void playFromVoiceQuery(transcript);
        };
        rec.onerror = () => {
          setVoiceListening(false);
          setQuickPromptOpen(true);
        };
        rec.onend = () => setVoiceListening(false);
        rec.start();
        return;
      } catch {
        setVoiceListening(false);
      }
    }

    setQuickPromptOpen((v) => !v);
    showToast('Dicta o escribe una canción o artista');
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Modo Coche pMusic"
      data-testid="car-mode-view"
      className="fixed inset-0 z-[90] flex flex-col overflow-hidden bg-[#070709] text-white"
      style={{
        background:
          'radial-gradient(circle at 30% 18%, color-mix(in srgb, var(--pm-ambient-1, #a855f7) 34%, #070709) 0%, color-mix(in srgb, var(--pm-ambient-3, #111116) 52%, #070709) 60%, #070709 100%)',
      }}
    >
      {/* Clean Driving Top Header */}
      <header className="flex shrink-0 items-center justify-between gap-3 px-4 pt-[max(1rem,var(--pm-safe-top,env(safe-area-inset-top)))] pb-3 sm:px-7">
        <div className="flex items-center gap-3">
          <PMusicLogo size={28} variant="wordmark-only" />
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/12 px-3 py-1 text-xs font-bold tracking-wide text-white">
            <Car className="h-3.5 w-3.5" />
            <span>Modo Coche</span>
          </span>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            data-testid="car-voice-search-btn"
            aria-label="Buscar música por voz"
            onClick={handleVoicePress}
            className={`pm-pressable inline-flex h-12 items-center gap-2 rounded-full px-5 text-sm font-extrabold shadow-lg transition-all ${
              voiceListening
                ? 'animate-pulse bg-[#fa233b] text-white'
                : 'bg-white text-[#070709] hover:scale-[1.03]'
            }`}
          >
            <Mic className="h-5 w-5" />
            <span>{voiceListening ? 'Escuchando…' : 'Voz'}</span>
          </button>

          <button
            type="button"
            data-testid="car-mode-close-btn"
            aria-label="Salir de Modo Coche"
            onClick={() => setCarModeOpen(false)}
            className="pm-pressable flex h-12 w-12 items-center justify-center rounded-full bg-white/12 text-white hover:bg-white/22"
          >
            <X className="h-6 w-6" />
          </button>
        </div>
      </header>

      {quickPromptOpen && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!quickQuery.trim()) return;
            void playFromVoiceQuery(quickQuery);
            setQuickQuery('');
            setQuickPromptOpen(false);
          }}
          className="mx-4 mb-2 flex items-center gap-2 rounded-2xl bg-white/10 p-2 backdrop-blur-md sm:mx-7"
        >
          <input
            type="text"
            autoFocus
            value={quickQuery}
            onChange={(e) => setQuickQuery(e.target.value)}
            placeholder="Di o escribe canción o artista…"
            aria-label="Búsqueda rápida en coche"
            className="h-12 flex-1 bg-transparent px-3 text-base font-semibold text-white placeholder:text-white/50 focus:outline-none"
          />
          <button
            type="submit"
            className="h-12 rounded-xl bg-white px-5 text-sm font-extrabold text-[#070709]"
          >
            Sonar
          </button>
        </form>
      )}

      {/* Oversized Now-Playing Car Stage */}
      <div className="flex shrink-0 flex-col gap-4 px-5 py-2 sm:px-8">
        <div className="flex items-center gap-4">
          <img
            src={currentTrack.thumbnailHighUrl ?? currentTrack.thumbnailUrl}
            alt={currentTrack.title}
            className="h-24 w-24 shrink-0 rounded-[18px] object-cover shadow-2xl ring-1 ring-white/20 sm:h-28 sm:w-28"
          />
          <div className="min-w-0 flex-1 space-y-1">
            <h1 className="line-clamp-1 text-2xl font-black tracking-tight text-white sm:text-3xl">
              {currentTrack.title}
            </h1>
            <p className="line-clamp-1 text-base font-semibold text-white/75 sm:text-lg">
              {currentTrack.artists.map((a) => a.name).join(', ')}
            </p>
            <div className="pt-1.5">
              <div className="h-2 w-full overflow-hidden rounded-full bg-white/15">
                <div
                  className="h-full rounded-full bg-white transition-all duration-200"
                  style={{ width: `${pct.toFixed(1)}%` }}
                />
              </div>
              <div className="mt-1 flex justify-between text-xs font-bold tabular-nums text-white/60">
                <span>{formatDurationSec(positionSec)}</span>
                <span>{formatDurationSec(dur)}</span>
              </div>
            </div>
          </div>
          <button
            type="button"
            aria-label={isLiked ? 'Quitar de Me gusta' : 'Me gusta'}
            onClick={() => void toggleLike(currentTrack)}
            className={`pm-pressable flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-white/10 ${
              isLiked ? 'text-[#FB7185]' : 'text-white/80'
            }`}
          >
            <Heart className={`h-7 w-7 ${isLiked ? 'fill-current' : ''}`} />
          </button>
        </div>

        {/* Giant Glove-Friendly Transport Controls */}
        <div className="grid grid-cols-3 items-center justify-items-center gap-4 py-2">
          <button
            type="button"
            data-testid="car-prev-btn"
            aria-label="Anterior"
            onClick={() => void prevTrack()}
            className="pm-pressable flex h-[68px] w-full max-w-[140px] items-center justify-center rounded-[24px] bg-white/12 text-white hover:bg-white/20"
          >
            <SkipBack className="h-8 w-8 fill-current" />
          </button>

          <button
            type="button"
            data-testid="car-play-pause-btn"
            aria-label={isPlaying ? 'Pausar' : 'Reproducir'}
            onClick={() => void togglePlayPause()}
            className="pm-pressable flex h-[80px] w-full max-w-[160px] items-center justify-center rounded-[28px] bg-white text-[#070709] shadow-2xl"
          >
            {isPlaying ? (
              <Pause className="h-10 w-10 fill-current" />
            ) : (
              <Play className="h-10 w-10 translate-x-[2px] fill-current" />
            )}
          </button>

          <button
            type="button"
            data-testid="car-next-btn"
            aria-label="Siguiente"
            onClick={() => void nextTrack()}
            className="pm-pressable flex h-[68px] w-full max-w-[140px] items-center justify-center rounded-[24px] bg-white/12 text-white hover:bg-white/20"
          >
            <SkipForward className="h-8 w-8 fill-current" />
          </button>
        </div>
      </div>

      {/* Zero-Clutter 3-Tab One-Tap Library */}
      <div className="mt-2 flex min-h-0 flex-1 flex-col rounded-t-[28px] bg-black/35 px-4 pt-3 pb-[max(1rem,var(--pm-safe-bottom,env(safe-area-inset-bottom)))] backdrop-blur-md sm:px-7">
        <div className="mb-3 grid grid-cols-3 gap-2" role="tablist" aria-label="Listas rápidas de coche">
          {(
            [
              { id: 'para-ti', label: 'Para ti', icon: <Sparkles className="h-4 w-4" /> },
              { id: 'playlists', label: 'Playlists', icon: <ListMusic className="h-4 w-4" /> },
              { id: 'me-gusta', label: 'Me gusta', icon: <Heart className="h-4 w-4" /> },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              onClick={() => setTab(item.id)}
              className={`pm-pressable flex h-12 items-center justify-center gap-2 rounded-2xl text-sm font-extrabold transition-colors ${
                tab === item.id
                  ? 'bg-white text-[#070709]'
                  : 'bg-white/10 text-white/80 hover:bg-white/16'
              }`}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </div>

        <div className="pm-no-scrollbar flex-1 space-y-2 overflow-y-auto pb-2">
          {tab === 'para-ti' &&
            recommendedTracks.map((t) => (
              <button
                key={`car-rec-${t.id}`}
                type="button"
                onClick={() => void playTrack(t, recommendedTracks)}
                className={`pm-pressable flex min-h-[68px] w-full items-center gap-3.5 rounded-[18px] px-3.5 py-2 text-left transition-colors ${
                  currentTrack.id === t.id
                    ? 'bg-white/22 ring-1 ring-white/40'
                    : 'bg-white/[0.07] hover:bg-white/[0.14]'
                }`}
              >
                <img
                  src={t.thumbnailUrl}
                  alt=""
                  className="h-12 w-12 shrink-0 rounded-[10px] object-cover"
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-base font-bold text-white">{t.title}</div>
                  <div className="truncate text-xs font-semibold text-white/65">
                    {t.artists.map((a) => a.name).join(', ')}
                  </div>
                </div>
              </button>
            ))}

          {tab === 'playlists' &&
            (playlists.length === 0 ? (
              <div className="py-8 text-center text-sm font-semibold text-white/60">
                No tienes playlists guardadas aún
              </div>
            ) : (
              playlists.map((pl) => (
                <button
                  key={`car-pl-${pl.id}`}
                  type="button"
                  onClick={() => {
                    if (pl.tracks[0]) void playTrack(pl.tracks[0], pl.tracks);
                  }}
                  className="pm-pressable flex min-h-[68px] w-full items-center gap-3.5 rounded-[18px] bg-white/[0.07] px-3.5 py-2 text-left hover:bg-white/[0.14]"
                >
                  <img
                    src={pl.coverUrl ?? pl.tracks[0]?.thumbnailUrl ?? ''}
                    alt=""
                    className="h-12 w-12 shrink-0 rounded-[10px] bg-white/10 object-cover"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-base font-bold text-white">{pl.name}</div>
                    <div className="truncate text-xs font-semibold text-white/65">
                      {pl.tracks.length} canciones
                    </div>
                  </div>
                </button>
              ))
            ))}

          {tab === 'me-gusta' &&
            (likedTracks.length === 0 ? (
              <div className="py-8 text-center text-sm font-semibold text-white/60">
                Aún no tienes canciones en Me gusta
              </div>
            ) : (
              likedTracks.map((lk) => (
                <button
                  key={`car-lk-${lk.trackId}`}
                  type="button"
                  onClick={() =>
                    void playTrack(
                      lk.track,
                      likedTracks.map((x) => x.track)
                    )
                  }
                  className={`pm-pressable flex min-h-[68px] w-full items-center gap-3.5 rounded-[18px] px-3.5 py-2 text-left transition-colors ${
                    currentTrack.id === lk.trackId
                      ? 'bg-white/22 ring-1 ring-white/40'
                      : 'bg-white/[0.07] hover:bg-white/[0.14]'
                  }`}
                >
                  <img
                    src={lk.track.thumbnailUrl}
                    alt=""
                    className="h-12 w-12 shrink-0 rounded-[10px] object-cover"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-base font-bold text-white">{lk.track.title}</div>
                    <div className="truncate text-xs font-semibold text-white/65">
                      {lk.track.artists.map((a) => a.name).join(', ')}
                    </div>
                  </div>
                </button>
              ))
            ))}
        </div>
      </div>
    </div>
  );
};
