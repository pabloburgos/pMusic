import React, { useEffect, useState } from 'react';
import {
  Activity,
  Award,
  Check,
  Copy,
  Disc3,
  Headphones,
  Info,
  Mic2,
  PenTool,
  Sliders,
  Sparkles,
  Users,
  X,
} from 'lucide-react';
import { formatDurationSec, type TrackCredits } from '@pmusic/core';
import { usePMusicStore } from '../store/usePMusicStore.ts';
import { ArtistLinks } from './ArtistLinks.tsx';
import { TrackArtwork } from './TrackArtwork.tsx';

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

function formatCreditDateEs(raw?: string): string {
  if (!raw) return '';
  const m = raw.trim().slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return raw;
  const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const monthLabel = months[Math.max(0, Math.min(11, Number(m[2]) - 1))] ?? m[2];
  return `${Number(m[3])} ${monthLabel} ${m[1]}`;
}

const CreditNamesBlock: React.FC<{
  label: string;
  icon?: React.ReactNode;
  names: readonly string[];
  loading: boolean;
  onSelectPerson?: (name: string) => void;
}> = ({ label, icon, names, loading, onSelectPerson }) => {
  if (!loading && names.length === 0) return null;
  return (
    <div>
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider pm-text-tertiary">
        {icon}
        <span>{label}</span>
      </div>
      {loading && names.length === 0 ? (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          <span className="h-6 w-24 animate-pulse rounded-full bg-white/[0.08]" />
          <span className="h-6 w-16 animate-pulse rounded-full bg-white/[0.06]" />
        </div>
      ) : (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {names.map((person) => (
            <button
              key={`${label}-${person}`}
              type="button"
              onClick={() => onSelectPerson?.(person)}
              className="pm-pressable inline-flex items-center rounded-full border pm-border bg-white/[0.07] px-3 py-1 text-[11.5px] font-semibold pm-text-primary transition-colors hover:border-white/25 hover:bg-white/[0.15]"
            >
              {person}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export const TrackInfoModal: React.FC = () => {
  const track = usePMusicStore((s) => s.trackInfoModalTrack);
  const setTrackInfoModalTrack = usePMusicStore((s) => s.setTrackInfoModalTrack);
  const trackAnalyses = usePMusicStore((s) => s.trackAnalyses);
  const openAlbumDetail = usePMusicStore((s) => s.openAlbumDetail);
  const openArtistDetail = usePMusicStore((s) => s.openArtistDetail);
  const submitSearch = usePMusicStore((s) => s.submitSearch);
  const setActiveTab = usePMusicStore((s) => s.setActiveTab);
  const fetchTrackCredits = usePMusicStore((s) => s.fetchTrackCredits);
  const playTrack = usePMusicStore((s) => s.playTrack);
  const startTrackRadio = usePMusicStore((s) => s.startTrackRadio);
  const showToast = usePMusicStore((s) => s.showToast);

  const [credits, setCredits] = useState<TrackCredits | null>(null);
  const [creditsLoading, setCreditsLoading] = useState(false);
  const [copiedCredits, setCopiedCredits] = useState(false);
  const [copiedIsrc, setCopiedIsrc] = useState(false);

  useEffect(() => {
    setCopiedCredits(false);
    setCopiedIsrc(false);
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
  const hasAnyProductionCredits =
    producers.length > 0 || composers.length > 0 || lyricists.length > 0 || engineers.length > 0;

  const displayBpm = ana?.bpm ? Math.round(ana.bpm) : credits?.bpm ?? 120;
  const formattedDate = formatCreditDateEs(credits?.releaseDate ?? track.releaseDate);
  const heroArtUrl = track.thumbnailHighUrl ?? track.thumbnailUrl;

  const handleOpenContributorSearch = (name: string) => {
    setTrackInfoModalTrack(null);
    setActiveTab('Buscar');
    void submitSearch(name);
  };

  const handleCopyAllCredits = async () => {
    const lines: string[] = [
      `${track.title} — ${performers.map((p) => p.name).join(', ')}`,
      ...(track.album?.name || credits?.albumTitle
        ? [`Álbum: ${track.album?.name ?? credits?.albumTitle}${formattedDate ? ` (${formattedDate})` : ''}`]
        : []),
      ...(producers.length > 0 ? [`Producción: ${producers.join(', ')}`] : []),
      ...(composers.length > 0 ? [`Composición: ${composers.join(', ')}`] : []),
      ...(lyricists.length > 0 && !composersMatchLyricists ? [`Letra: ${lyricists.join(', ')}`] : []),
      ...(engineers.length > 0 ? [`Ingeniería: ${engineers.join(', ')}`] : []),
      ...(credits?.label ? [`Sello: ${credits.label}`] : []),
      ...(credits?.isrc ? [`ISRC: ${credits.isrc}`] : []),
    ];
    try {
      await navigator.clipboard?.writeText(lines.join('\n'));
      setCopiedCredits(true);
      showToast('Créditos copiados al portapapeles');
      setTimeout(() => setCopiedCredits(false), 1800);
    } catch {
      showToast('No se pudieron copiar los créditos');
    }
  };

  const handleCopyIsrc = async (isrc: string) => {
    try {
      await navigator.clipboard?.writeText(isrc);
      setCopiedIsrc(true);
      showToast(`ISRC ${isrc} copiado`);
      setTimeout(() => setCopiedIsrc(false), 1600);
    } catch {
      // ignore clipboard denial
    }
  };

  return (
    <div className="fixed inset-0 z-[75] flex items-center justify-center p-3 sm:p-4">
      <div
        aria-hidden="true"
        onClick={() => setTrackInfoModalTrack(null)}
        className="pm-spotlight-backdrop absolute inset-0 bg-black/72 backdrop-blur-sm"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Créditos de ${track.title}`}
        data-testid="track-info-modal"
        className="pm-glass-regular pm-modal-pop relative z-10 flex max-h-[88dvh] w-full max-w-lg flex-col overflow-hidden rounded-[24px] border border-white/15 shadow-2xl"
      >
        {/* Atmospheric blurred cover header */}
        <div className="relative overflow-hidden border-b pm-border px-5 pb-5 pt-4 sm:px-6">
          {heroArtUrl && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -inset-6 scale-125 opacity-35 blur-3xl"
              style={{
                backgroundImage: `url("${heroArtUrl}")`,
                backgroundPosition: 'center',
                backgroundSize: 'cover',
              }}
            />
          )}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/35 via-black/55 to-black/75"
          />

          <div className="relative z-10 flex items-center justify-between">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-black/35 px-3 py-1 backdrop-blur-md">
              <Info className="h-3.5 w-3.5 text-[#38BDF8]" />
              <h2 className="text-xs font-bold uppercase tracking-[0.12em] text-white">
                Créditos
              </h2>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => void handleCopyAllCredits()}
                className="pm-pressable inline-flex h-8 items-center gap-1.5 rounded-full border border-white/15 bg-black/40 px-3 text-[11px] font-semibold text-white/90 backdrop-blur-md transition-colors hover:bg-white/15"
              >
                {copiedCredits ? (
                  <Check className="h-3.5 w-3.5 text-emerald-400" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
                <span>{copiedCredits ? 'Copiado' : 'Copiar'}</span>
              </button>
              <button
                type="button"
                aria-label="Cerrar créditos"
                onClick={() => setTrackInfoModalTrack(null)}
                className="pm-pressable flex h-8 w-8 items-center justify-center rounded-full border border-white/15 bg-black/40 text-white backdrop-blur-md hover:bg-white/15"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="relative z-10 mt-4 flex items-center gap-4">
            <div className="h-24 w-24 shrink-0 overflow-hidden rounded-[16px] shadow-[0_14px_34px_rgba(0,0,0,0.55)] ring-1 ring-white/20 sm:h-26 sm:w-26">
              <TrackArtwork
                trackId={track.id}
                src={heroArtUrl}
                title={track.title}
                artistName={track.artists[0]?.name}
                artistId={track.artists[0]?.id}
                alt={track.title}
                variant="card"
                imgClassName="h-full w-full object-cover"
              />
            </div>

            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="flex items-center gap-2">
                <h3 className="line-clamp-2 text-lg font-extrabold leading-tight tracking-tight text-white sm:text-xl">
                  {track.title}
                </h3>
                {(track.isExplicit || credits?.explicit) && (
                  <span className="inline-flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded-[4px] bg-white/20 text-[10px] font-extrabold leading-none text-white">
                    E
                  </span>
                )}
              </div>
              <div className="text-sm text-white/80">
                <ArtistLinks
                  artists={track.artists}
                  singleLine={false}
                  onBeforeNavigate={() => setTrackInfoModalTrack(null)}
                  linkClassName="hover:underline font-semibold text-white"
                />
              </div>
              <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
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
                    className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.08] px-2.5 py-0.5 text-[11px] font-medium text-white/90 hover:bg-white/[0.16]"
                  >
                    <Disc3 className="h-3 w-3 shrink-0 text-white/70" />
                    <span className="truncate">{track.album?.name ?? credits?.albumTitle}</span>
                  </button>
                )}
                {formattedDate ? (
                  <span className="inline-flex items-center rounded-full bg-white/[0.08] px-2.5 py-0.5 text-[11px] font-medium text-white/75">
                    {formattedDate}
                  </span>
                ) : track.releaseYear ? (
                  <span className="inline-flex items-center rounded-full bg-white/[0.08] px-2.5 py-0.5 text-[11px] font-medium text-white/75">
                    {track.releaseYear}
                  </span>
                ) : null}
              </div>
            </div>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 space-y-4 overflow-y-auto p-5 sm:p-6 pm-no-scrollbar">
          {/* Rich pMusic Track Credits Card */}
          <section
            data-testid="track-credits-section"
            className="pm-surface-card space-y-4 rounded-[18px] p-4"
          >
            <div className="flex items-center justify-between text-xs font-bold pm-text-primary">
              <span className="flex items-center gap-1.5">
                <Users className="h-3.5 w-3.5 text-[#38BDF8]" />
                <span>Ficha artística y producción</span>
              </span>
              {creditsLoading && (
                <span className="inline-flex items-center gap-1.5 text-[11px] font-medium pm-text-tertiary">
                  <span className="h-1.5 w-1.5 animate-ping rounded-full bg-[#38BDF8]" />
                  Consultando ficha…
                </span>
              )}
            </div>

            {/* Performers */}
            <div className="space-y-2 border-t pm-border pt-3">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider pm-text-tertiary">
                <Mic2 className="h-3 w-3" />
                <span>Interpretación</span>
              </div>
              <div className="space-y-1.5">
                {performers.map((person) => (
                  <div
                    key={`${person.name}-${person.role}`}
                    className="flex items-center justify-between gap-2 rounded-[12px] bg-white/[0.04] px-3 py-2 text-xs"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setTrackInfoModalTrack(null);
                        void openArtistDetail(person.id ?? person.name, { name: person.name });
                      }}
                      className="truncate font-semibold pm-text-primary hover:underline"
                    >
                      {person.name}
                    </button>
                    <span className="shrink-0 rounded-full bg-white/[0.10] px-2.5 py-0.5 text-[10.5px] font-semibold pm-text-secondary">
                      {person.role}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Producers / Composers / Lyricists / Engineers */}
            {(creditsLoading || hasAnyProductionCredits) && (
              <div className="space-y-3 border-t pm-border pt-3">
                <CreditNamesBlock
                  label="Producción"
                  icon={<Sliders className="h-3 w-3 text-[#C084FC]" />}
                  names={producers}
                  loading={creditsLoading}
                  onSelectPerson={handleOpenContributorSearch}
                />

                {composersMatchLyricists ? (
                  <CreditNamesBlock
                    label="Composición y letra"
                    icon={<PenTool className="h-3 w-3 text-[#38BDF8]" />}
                    names={composers}
                    loading={creditsLoading}
                    onSelectPerson={handleOpenContributorSearch}
                  />
                ) : (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <CreditNamesBlock
                      label="Composición"
                      icon={<PenTool className="h-3 w-3 text-[#38BDF8]" />}
                      names={composers}
                      loading={creditsLoading}
                      onSelectPerson={handleOpenContributorSearch}
                    />
                    <CreditNamesBlock
                      label="Letra"
                      icon={<PenTool className="h-3 w-3 text-[#34D399]" />}
                      names={lyricists}
                      loading={creditsLoading}
                      onSelectPerson={handleOpenContributorSearch}
                    />
                  </div>
                )}

                <CreditNamesBlock
                  label="Mezcla, masterización e ingeniería"
                  icon={<Headphones className="h-3 w-3 text-amber-400" />}
                  names={engineers}
                  loading={false}
                  onSelectPerson={handleOpenContributorSearch}
                />
              </div>
            )}

            {!creditsLoading && !hasAnyProductionCredits && (
              <div className="border-t pm-border pt-3 text-[11.5px] pm-text-tertiary">
                Este lanzamiento solo publica créditos de interpretación en el catálogo oficial.
              </div>
            )}

            {/* Label / Distributor / Copyable ISRC */}
            <div className="space-y-2 border-t pm-border pt-3 text-[11px] pm-text-tertiary">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-1.5">
                  <Award className="h-3.5 w-3.5 text-[#34D399]" />
                  <span>
                    Sello:{' '}
                    <strong className="font-semibold pm-text-primary">
                      {credits?.label ?? credits?.source ?? 'Catálogo pMusic'}
                    </strong>
                  </span>
                </span>
                {credits?.isrc && (
                  <button
                    type="button"
                    onClick={() => void handleCopyIsrc(credits.isrc!)}
                    className="pm-pressable inline-flex items-center gap-1 rounded-full border pm-border bg-white/[0.06] px-2.5 py-0.5 font-mono text-[10.5px] font-semibold pm-text-secondary hover:bg-white/[0.12]"
                  >
                    <span>ISRC: {credits.isrc}</span>
                    {copiedIsrc ? (
                      <Check className="h-3 w-3 text-emerald-400" />
                    ) : (
                      <Copy className="h-2.5 w-2.5 opacity-70" />
                    )}
                  </button>
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
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <div className="pm-surface-card rounded-[14px] p-3">
              <div className="flex items-center gap-1 text-[10.5px] font-semibold uppercase tracking-wide pm-text-tertiary">
                <Activity className="h-3 w-3 text-[#C084FC]" />
                <span>Tempo</span>
              </div>
              <div className="tabular-nums mt-1 text-base font-bold pm-text-primary">
                {displayBpm} BPM
              </div>
            </div>
            <div className="pm-surface-card rounded-[14px] p-3">
              <div className="text-[10.5px] font-semibold uppercase tracking-wide pm-text-tertiary">
                Tonalidad
              </div>
              <div className="tabular-nums mt-1 text-base font-bold pm-text-primary">
                {ana?.camelotKey ?? '8A'}
              </div>
            </div>
            <div className="pm-surface-card rounded-[14px] p-3">
              <div className="text-[10.5px] font-semibold uppercase tracking-wide pm-text-tertiary">
                Sonoridad
              </div>
              <div className="tabular-nums mt-1 text-base font-bold pm-text-primary">
                {ana?.loudnessDb !== undefined ? `${ana.loudnessDb} dB` : '-10 dB'}
              </div>
            </div>
            <div className="pm-surface-card rounded-[14px] p-3">
              <div className="text-[10.5px] font-semibold uppercase tracking-wide pm-text-tertiary">
                Duración
              </div>
              <div className="tabular-nums mt-1 text-base font-bold pm-text-primary">
                {formatDurationSec(track.durationSec)}
              </div>
            </div>
          </div>

          {/* 3-Stem Profile */}
          <div className="pm-surface-card space-y-3 rounded-[16px] p-4">
            <div className="flex items-center justify-between text-xs font-bold pm-text-primary">
              <span className="flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5 text-[#C084FC]" />
                <span>ADN Acústico 3-Stems</span>
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
        </div>

        {/* Sticky action footer */}
        <div className="flex flex-wrap items-center justify-end gap-2 border-t pm-border px-5 py-3.5 sm:px-6">
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
