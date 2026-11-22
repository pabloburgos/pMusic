import React from 'react';
import { Disc3, Info, Sparkles, X } from 'lucide-react';
import { formatDurationSec } from '@pmusic/core';
import { usePMusicStore } from '../store/usePMusicStore.ts';
import { ArtistLinks } from './ArtistLinks.tsx';

function averageStem(vals: readonly number[] | undefined, fallback: number): number {
  if (!vals || vals.length === 0) return fallback;
  let sum = 0;
  for (const v of vals) sum += v;
  return sum / vals.length;
}

export const TrackInfoModal: React.FC = () => {
  const track = usePMusicStore((s) => s.trackInfoModalTrack);
  const setTrackInfoModalTrack = usePMusicStore((s) => s.setTrackInfoModalTrack);
  const trackAnalyses = usePMusicStore((s) => s.trackAnalyses);
  const openAlbumDetail = usePMusicStore((s) => s.openAlbumDetail);
  const playTrack = usePMusicStore((s) => s.playTrack);
  const startTrackRadio = usePMusicStore((s) => s.startTrackRadio);

  if (!track) return null;

  const ana = trackAnalyses[track.id];
  const bassAvg = Math.round(averageStem(ana?.bassEnvelope, 0.72) * 100);
  const vocalAvg = Math.round(averageStem(ana?.vocalEnvelope, 0.64) * 100);
  const highAvg = Math.round(averageStem(ana?.highEnvelope, 0.58) * 100);

  return (
    <div className="fixed inset-0 z-[75] flex items-center justify-center p-4">
      <div
        aria-hidden="true"
        onClick={() => setTrackInfoModalTrack(null)}
        className="pm-spotlight-backdrop absolute inset-0 bg-black/65"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Información de ${track.title}`}
        data-testid="track-info-modal"
        className="pm-glass-regular pm-modal-pop relative z-10 flex max-h-[86dvh] w-full max-w-lg flex-col overflow-y-auto rounded-[22px] p-6"
      >
        <div className="flex items-center justify-between border-b pm-border pb-4">
          <div className="flex items-center gap-2">
            <Info className="h-4 w-4 pm-text-secondary" />
            <h2 className="text-base font-bold pm-text-primary">
              Créditos y análisis acústico
            </h2>
          </div>
          <button
            type="button"
            aria-label="Cerrar información"
            onClick={() => setTrackInfoModalTrack(null)}
            className="pm-btn-secondary flex h-8 w-8 items-center justify-center rounded-full"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-5 flex items-center gap-4">
          <img
            src={track.thumbnailHighUrl ?? track.thumbnailUrl}
            alt={track.title}
            className="h-24 w-24 shrink-0 rounded-[14px] object-cover shadow-lg"
          />
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex items-center gap-2">
              <h3 className="truncate text-xl font-bold pm-text-primary">
                {track.title}
              </h3>
              {track.isExplicit && (
                <span className="rounded bg-white/15 px-1.5 py-0.5 text-[11px] font-bold pm-text-primary">
                  E
                </span>
              )}
            </div>
            <div className="text-sm pm-text-secondary">
              <ArtistLinks
                artists={track.artists}
                singleLine={false}
                onBeforeNavigate={() => setTrackInfoModalTrack(null)}
                linkClassName="hover:underline font-medium pm-text-primary"
              />
            </div>
            {track.album && (
              <button
                type="button"
                onClick={() => {
                  const id = track.album?.id;
                  setTrackInfoModalTrack(null);
                  if (id) void openAlbumDetail(id);
                }}
                className="block truncate text-xs pm-text-tertiary hover:underline"
              >
                Álbum: {track.album.name}
                {track.releaseYear ? ` · ${track.releaseYear}` : ''}
              </button>
            )}
          </div>
        </div>

        {/* Acoustic telemetry grid */}
        <div className="mt-5 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <div className="pm-surface-card rounded-[12px] p-3">
            <div className="text-[11px] pm-text-tertiary">Tempo</div>
            <div className="tabular-nums mt-0.5 text-base font-bold pm-text-primary">
              {ana?.bpm ?? 120} BPM
            </div>
          </div>
          <div className="pm-surface-card rounded-[12px] p-3">
            <div className="text-[11px] pm-text-tertiary">Tonalidad</div>
            <div className="tabular-nums mt-0.5 text-base font-bold pm-text-primary">
              {ana?.camelotKey ?? '8A'}
            </div>
          </div>
          <div className="pm-surface-card rounded-[12px] p-3">
            <div className="text-[11px] pm-text-tertiary">Sonoridad</div>
            <div className="tabular-nums mt-0.5 text-base font-bold pm-text-primary">
              {ana?.loudnessDb !== undefined ? `${ana.loudnessDb} dB` : '-10 dB'}
            </div>
          </div>
          <div className="pm-surface-card rounded-[12px] p-3">
            <div className="text-[11px] pm-text-tertiary">Duración</div>
            <div className="tabular-nums mt-0.5 text-base font-bold pm-text-primary">
              {formatDurationSec(track.durationSec)}
            </div>
          </div>
        </div>

        {/* 3-Stem Profile */}
        <div className="pm-surface-card mt-4 space-y-3 rounded-[14px] p-4">
          <div className="flex items-center justify-between text-xs font-bold pm-text-primary">
            <span className="flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5 text-[#C084FC]" />
              <span>Separación espectral 3-Stems</span>
            </span>
            <span className="text-[11px] font-medium pm-text-tertiary">
              {ana?.source === 'pcm' ? 'Audio real (PCM)' : 'Estimación armónica'}
            </span>
          </div>

          {[
            { label: 'Bajos / Bombo (< 180 Hz)', pct: bassAvg, color: '#C084FC' },
            { label: 'Presencia Vocal (300–3400 Hz)', pct: vocalAvg, color: '#38BDF8' },
            { label: 'Agudos / Aire (> 3400 Hz)', pct: highAvg, color: '#34D399' },
          ].map((stem) => (
            <div key={stem.label} className="space-y-1">
              <div className="flex justify-between text-[11px] pm-text-secondary">
                <span>{stem.label}</span>
                <span className="tabular-nums font-semibold">{stem.pct}%</span>
              </div>
              <div
                className="h-1.5 w-full overflow-hidden rounded-full"
                style={{ backgroundColor: 'var(--pm-slider-track)' }}
              >
                <div
                  className="h-full rounded-full transition-all duration-300"
                  style={{ width: `${stem.pct}%`, backgroundColor: stem.color }}
                />
              </div>
            </div>
          ))}
        </div>

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={() => {
              const t = track;
              setTrackInfoModalTrack(null);
              void startTrackRadio(t, true);
            }}
            className="pm-btn-secondary inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-semibold"
          >
            <Disc3 className="h-3.5 w-3.5 text-[#C084FC]" />
            <span>Radio DJ del tema</span>
          </button>
          <button
            type="button"
            onClick={() => {
              const t = track;
              setTrackInfoModalTrack(null);
              void playTrack(t);
            }}
            className="pm-btn-primary rounded-full px-5 py-2 text-xs font-bold"
          >
            Reproducir ahora
          </button>
        </div>
      </div>
    </div>
  );
};
