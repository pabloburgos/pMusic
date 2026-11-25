import React, { useEffect, useState } from 'react';
import { Disc3, Info, Music2, Sparkles, Users, X } from 'lucide-react';
import { formatDurationSec, type TrackCredits } from '@pmusic/core';
import { usePMusicStore } from '../store/usePMusicStore.ts';
import { ArtistLinks } from './ArtistLinks.tsx';

function averageStem(vals: readonly number[] | undefined, fallback: number): number {
  if (!vals || vals.length === 0) return fallback;
  let sum = 0;
  for (const v of vals) sum += v;
  return sum / vals.length;
}

function sameCreditList(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const setB = new Set(b.map((x) => x.trim().toLowerCase()));
  return a.every((x) => setB.has(x.trim().toLowerCase()));
}

const CreditNamesBlock: React.FC<{
  label: string;
  names: readonly string[];
  loading: boolean;
  emptyText?: string;
}> = ({ label, names, loading, emptyText = 'No especificado' }) => (
  <div>
    <div className="text-[11px] font-semibold uppercase tracking-wider pm-text-tertiary">
      {label}
    </div>
    {loading && names.length === 0 ? (
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        <span className="h-5 w-24 animate-pulse rounded-full bg-white/[0.08]" />
        <span className="h-5 w-16 animate-pulse rounded-full bg-white/[0.06]" />
      </div>
    ) : names.length > 0 ? (
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {names.map((person) => (
          <span
            key={`${label}-${person}`}
            className="inline-flex items-center rounded-full border pm-border bg-white/[0.06] px-2.5 py-0.5 text-[11.5px] font-medium pm-text-primary"
          >
            {person}
          </span>
        ))}
      </div>
    ) : (
      <div className="mt-1 text-xs pm-text-tertiary">{emptyText}</div>
    )}
  </div>
);

export const TrackInfoModal: React.FC = () => {
  const track = usePMusicStore((s) => s.trackInfoModalTrack);
  const setTrackInfoModalTrack = usePMusicStore((s) => s.setTrackInfoModalTrack);
  const trackAnalyses = usePMusicStore((s) => s.trackAnalyses);
  const openAlbumDetail = usePMusicStore((s) => s.openAlbumDetail);
  const openArtistDetail = usePMusicStore((s) => s.openArtistDetail);
  const fetchTrackCredits = usePMusicStore((s) => s.fetchTrackCredits);
  const playTrack = usePMusicStore((s) => s.playTrack);
  const startTrackRadio = usePMusicStore((s) => s.startTrackRadio);

  const [credits, setCredits] = useState<TrackCredits | null>(null);
  const [creditsLoading, setCreditsLoading] = useState(false);

  useEffect(() => {
    if (!track) {
      setCredits(null);
      setCreditsLoading(false);
      return;
    }
    let cancelled = false;
    setCredits(null);
    setCreditsLoading(true);
    void fetchTrackCredits(track)
      .then((res) => {
        if (!cancelled) setCredits(res);
      })
      .finally(() => {
        if (!cancelled) setCreditsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [track, fetchTrackCredits]);

  if (!track) return null;

  const ana = trackAnalyses[track.id];
  const bassAvg = Math.round(averageStem(ana?.bassEnvelope, 0.72) * 100);
  const vocalAvg = Math.round(averageStem(ana?.vocalEnvelope, 0.64) * 100);
  const highAvg = Math.round(averageStem(ana?.highEnvelope, 0.58) * 100);

  const performers =
    credits && credits.performers.length > 0
      ? credits.performers
      : track.artists.map((ar, idx) => ({
          id: ar.id,
          name: ar.name,
          role: idx === 0 ? 'Artista principal' : 'Artista invitado',
        }));

  const producers = credits?.producers ?? [];
  const composers =
    credits?.composers && credits.composers.length > 0
      ? credits.composers
      : credits?.writers ?? [];
  const lyricists =
    credits?.lyricists && credits.lyricists.length > 0
      ? credits.lyricists
      : composers;
  const composersMatchLyricists =
    composers.length > 0 && sameCreditList(composers, lyricists);
  const engineers = credits?.engineers ?? [];

  const displayBpm = ana?.bpm ? Math.round(ana.bpm) : credits?.bpm ?? 120;

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
        aria-label={`Créditos de ${track.title}`}
        data-testid="track-info-modal"
        className="pm-glass-regular pm-modal-pop relative z-10 flex max-h-[86dvh] w-full max-w-lg flex-col overflow-y-auto rounded-[22px] p-6"
      >
        <div className="flex items-center justify-between border-b pm-border pb-4">
          <div className="flex items-center gap-2">
            <Info className="h-4 w-4 pm-text-secondary" />
            <h2 className="text-base font-bold pm-text-primary">
              Créditos
            </h2>
          </div>
          <button
            type="button"
            aria-label="Cerrar créditos"
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
              {(track.isExplicit || credits?.explicit) && (
                <span className="inline-flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-[3px] bg-[var(--pm-text-secondary)]/20 text-[10px] font-extrabold leading-none pm-text-secondary">
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
            {(track.album || credits?.albumTitle) && (
              <button
                type="button"
                onClick={() => {
                  const id = track.album?.id;
                  setTrackInfoModalTrack(null);
                  if (id) {
                    void openAlbumDetail(id, {
                      title: track.album?.name ?? credits?.albumTitle,
                      artist: track.artists[0]?.name,
                      thumbnailUrl: track.thumbnailUrl,
                    });
                  }
                }}
                className="block truncate text-xs pm-text-tertiary hover:underline"
              >
                Álbum: {track.album?.name ?? credits?.albumTitle}
                {credits?.releaseDate
                  ? ` · ${credits.releaseDate}`
                  : track.releaseYear
                    ? ` · ${track.releaseYear}`
                    : ''}
              </button>
            )}
          </div>
        </div>

        {/* Rich pMusic Track Credits Card */}
        <section
          data-testid="track-credits-section"
          className="pm-surface-card mt-5 space-y-4 rounded-[16px] p-4"
        >
          <div className="flex items-center justify-between text-xs font-bold pm-text-primary">
            <span className="flex items-center gap-1.5">
              <Users className="h-3.5 w-3.5 pm-text-secondary" />
              <span>Ficha artística y producción</span>
            </span>
            {creditsLoading && (
              <span className="text-[11px] font-medium pm-text-tertiary">
                Consultando ficha…
              </span>
            )}
          </div>

          <div className="space-y-2 border-t pm-border pt-3">
            <div className="text-[11px] font-semibold uppercase tracking-wider pm-text-tertiary">
              Interpretado por
            </div>
            <div className="space-y-1.5">
              {performers.map((person) => (
                <div
                  key={`${person.name}-${person.role}`}
                  className="flex items-center justify-between gap-2 text-xs"
                >
                  {person.id ? (
                    <button
                      type="button"
                      onClick={() => {
                        setTrackInfoModalTrack(null);
                        void openArtistDetail(person.id!, { name: person.name });
                      }}
                      className="truncate font-semibold pm-text-primary hover:underline"
                    >
                      {person.name}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setTrackInfoModalTrack(null);
                        void openArtistDetail(person.name, { name: person.name });
                      }}
                      className="truncate font-semibold pm-text-primary hover:underline"
                    >
                      {person.name}
                    </button>
                  )}
                  <span className="shrink-0 rounded-full bg-white/[0.08] px-2.5 py-0.5 text-[10.5px] font-medium pm-text-secondary">
                    {person.role}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-3 border-t pm-border pt-3">
            <CreditNamesBlock
              label="Producido por"
              names={producers}
              loading={creditsLoading}
            />

            {composersMatchLyricists ? (
              <CreditNamesBlock
                label="Composición y letra"
                names={composers}
                loading={creditsLoading}
              />
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <CreditNamesBlock
                  label="Compositores"
                  names={composers}
                  loading={creditsLoading}
                />
                <CreditNamesBlock
                  label="Letristas"
                  names={lyricists}
                  loading={creditsLoading}
                />
              </div>
            )}

            {engineers.length > 0 && (
              <CreditNamesBlock
                label="Mezcla, masterización e ingeniería"
                names={engineers}
                loading={false}
              />
            )}
          </div>

          <div className="space-y-1.5 border-t pm-border pt-3 text-[11px] pm-text-tertiary">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex items-center gap-1.5">
                <Music2 className="h-3.5 w-3.5 pm-text-tertiary" />
                <span>
                  Sello / Fuente:{' '}
                  <strong className="font-semibold pm-text-secondary">
                    {credits?.label ?? credits?.source ?? 'Catálogo pMusic'}
                  </strong>
                </span>
              </span>
              {credits?.isrc && (
                <span className="tabular-nums font-medium">
                  ISRC: {credits.isrc}
                </span>
              )}
            </div>
            {credits?.distributor && (
              <div>
                Distribución:{' '}
                <strong className="font-semibold pm-text-secondary">
                  {credits.distributor}
                </strong>
              </div>
            )}
          </div>
        </section>

        {/* Acoustic telemetry grid */}
        <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <div className="pm-surface-card rounded-[12px] p-3">
            <div className="text-[11px] pm-text-tertiary">Tempo</div>
            <div className="tabular-nums mt-0.5 text-base font-bold pm-text-primary">
              {displayBpm} BPM
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
