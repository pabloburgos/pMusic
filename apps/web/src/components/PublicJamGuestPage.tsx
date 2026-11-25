import React, { useEffect, useState } from 'react';
import { Check, Clock, Disc3, Loader2, Music2, Plus, Search, Sparkles } from 'lucide-react';
import type { Track } from '@pmusic/core';
import { PMusicLogo } from './PMusicLogo.tsx';
import {
  fetchPublicJamRequests,
  fetchPublicJamSession,
  searchPublicCatalog,
  submitPublicJamRequest,
  type JamRequestRecord,
  type JamSessionRecord,
} from '../services/social-service.ts';

export const PublicJamGuestPage: React.FC<{ code: string }> = ({ code }) => {
  const cleanCode = code.toUpperCase();
  const [session, setSession] = useState<JamSessionRecord | null>(null);
  const [requests, setRequests] = useState<JamRequestRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [guestName, setGuestName] = useState<string>(() => {
    try {
      return sessionStorage.getItem('pmusic.jam.guestName') ?? '';
    } catch {
      return '';
    }
  });
  const [nameConfirmed, setNameConfirmed] = useState<boolean>(() => {
    try {
      return Boolean(sessionStorage.getItem('pmusic.jam.guestName'));
    } catch {
      return false;
    }
  });

  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<Track[]>([]);
  const [requestedIds, setRequestedIds] = useState<Set<string>>(new Set());
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      const [s, r] = await Promise.all([
        fetchPublicJamSession(cleanCode),
        fetchPublicJamRequests(cleanCode),
      ]);
      if (!active) return;
      setSession(s);
      setRequests(r);
      setLoading(false);
    };
    void load();
    const timer = window.setInterval(() => void load(), 4000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [cleanCode]);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    setFeedback(null);
    try {
      const list = await searchPublicCatalog(query);
      setResults(list);
    } finally {
      setSearching(false);
    }
  };

  const handleRequestTrack = async (track: Track) => {
    if (!session) return;
    const myCount = requests.filter(
      (r) => r.guestName.toLowerCase() === guestName.trim().toLowerCase() && r.status !== 'rejected'
    ).length;
    if (session.maxRequestsPerGuest > 0 && myCount >= session.maxRequestsPerGuest) {
      setFeedback(`Límite alcanzado: máximo ${session.maxRequestsPerGuest} canciones por invitado.`);
      return;
    }
    try {
      const created = await submitPublicJamRequest(
        cleanCode,
        guestName || 'Invitado',
        track,
        session.allowGuestDirectAdd
      );
      setRequests((prev) => [created, ...prev]);
      setRequestedIds((prev) => new Set(prev).add(track.id));
      setFeedback(
        session.allowGuestDirectAdd
          ? `"${track.title}" añadida a la cola de ${session.hostName}`
          : `"${track.title}" enviada para aprobación de ${session.hostName}`
      );
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'No se pudo enviar la canción');
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-[#050507] text-white">
        <PMusicLogo size={42} variant="wordmark-only" animated />
        <Loader2 className="h-5 w-5 animate-spin text-white/50" />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center bg-[#050507] px-6 text-center text-white">
        <PMusicLogo size={44} variant="wordmark-only" />
        <h1 className="mt-6 text-xl font-bold">Esta Jam no está activa</h1>
        <p className="mt-2 max-w-sm text-sm text-white/55">
          El código <span className="font-mono text-white">{cleanCode}</span> ha finalizado o no
          existe. Pide al anfitrión un nuevo enlace QR.
        </p>
      </div>
    );
  }

  if (!nameConfirmed) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center bg-[#050507] px-6 text-white">
        <div className="w-full max-w-sm space-y-6 text-center">
          <div className="flex justify-center">
            <PMusicLogo size={46} variant="wordmark-only" animated />
          </div>
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.06] px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-white/75">
              <Sparkles className="h-3 w-3" /> Jam de {session.hostName}
            </span>
            <h1 className="mt-3 text-xl font-bold">Pide tus canciones</h1>
            <p className="mt-1 text-xs text-white/55">
              Pon tu apodo para que sepan quién pidió cada temazo.
            </p>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const clean = guestName.trim();
              if (!clean) return;
              try {
                sessionStorage.setItem('pmusic.jam.guestName', clean);
              } catch {
                // ignore
              }
              setNameConfirmed(true);
            }}
            className="space-y-3"
          >
            <input
              type="text"
              value={guestName}
              onChange={(e) => setGuestName(e.target.value)}
              placeholder="Tu nombre o apodo"
              maxLength={32}
              required
              autoFocus
              className="w-full rounded-full border border-white/15 bg-white/[0.05] px-5 py-3.5 text-center text-sm text-white placeholder-white/35 outline-none focus:border-white/40"
            />
            <button
              type="submit"
              className="w-full cursor-pointer rounded-full bg-white px-5 py-3.5 text-sm font-bold text-black transition hover:bg-white/90"
            >
              Entrar a la Jam
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-[#050507] text-white">
      <div className="mx-auto max-w-xl px-4 pb-16 pt-6 sm:px-6">
        <header className="flex items-center justify-between gap-3 pb-5">
          <PMusicLogo size={26} variant="wordmark-only" />
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-500/15 px-3 py-1 text-[11px] font-semibold text-emerald-300">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Jam · {session.hostName}
            </span>
          </div>
        </header>

        {/* Now Playing Live Card (Read-Only) */}
        {session.currentTrack && (
          <section className="mb-6 flex items-center gap-4 rounded-3xl border border-white/12 bg-white/[0.04] p-4">
            {session.currentTrack.thumbnailUrl ? (
              <img
                src={session.currentTrack.thumbnailUrl}
                alt=""
                className="h-16 w-16 shrink-0 rounded-2xl object-cover shadow-lg"
              />
            ) : (
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-white/10">
                <Disc3 className="h-7 w-7 text-white/60" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-bold uppercase tracking-widest text-white/45">
                {session.isPlaying ? 'Sonando ahora' : 'En pausa'}
              </div>
              <div className="truncate text-base font-bold text-white">
                {session.currentTrack.title}
              </div>
              <div className="truncate text-xs text-white/60">
                {session.currentTrack.artists?.map((a) => a.name).join(', ')}
              </div>
            </div>
          </section>
        )}

        {/* Search & Request Form */}
        <form onSubmit={handleSearch} className="mb-4 flex gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Busca una canción para pedir..."
              className="w-full rounded-full border border-white/15 bg-white/[0.05] py-3 pl-11 pr-4 text-sm text-white placeholder-white/40 outline-none focus:border-white/40"
            />
          </div>
          <button
            type="submit"
            disabled={searching}
            className="shrink-0 cursor-pointer rounded-full bg-white px-5 py-3 text-sm font-bold text-black transition hover:bg-white/90 disabled:opacity-50"
          >
            {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Buscar'}
          </button>
        </form>

        {feedback && (
          <div className="mb-4 rounded-2xl border border-white/15 bg-white/[0.06] px-4 py-2.5 text-xs text-white/85">
            {feedback}
          </div>
        )}

        {/* Search Results */}
        {results.length > 0 && (
          <section className="mb-8 space-y-2">
            <h2 className="text-xs font-bold uppercase tracking-wider text-white/45">
              Resultados — Toca para pedir
            </h2>
            <div className="space-y-1.5">
              {results.map((track) => {
                const already = requestedIds.has(track.id);
                return (
                  <div
                    key={track.id}
                    className="flex items-center gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.03] p-2.5"
                  >
                    <img
                      src={track.thumbnailUrl}
                      alt=""
                      className="h-11 w-11 shrink-0 rounded-xl object-cover"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-white">{track.title}</div>
                      <div className="truncate text-xs text-white/55">
                        {track.artists.map((a) => a.name).join(', ')}
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={already}
                      onClick={() => void handleRequestTrack(track)}
                      className={`inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-full px-3.5 py-2 text-xs font-bold transition ${
                        already
                          ? 'bg-emerald-500/20 text-emerald-300'
                          : 'bg-white text-black hover:bg-white/90'
                      }`}
                    >
                      {already ? <Check className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                      {already ? 'Pedida' : 'Pedir'}
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Live Requests Queue */}
        <section className="space-y-2.5">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-wider text-white/45">
              Peticiones en esta Jam ({requests.length})
            </h2>
            <span className="text-[11px] text-white/40">Hola, {guestName}</span>
          </div>

          {requests.length === 0 ? (
            <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-6 text-center text-xs text-white/45">
              <Music2 className="mx-auto mb-2 h-6 w-6 opacity-50" />
              Aún no hay peticiones. ¡Sé el primero en pedir una canción!
            </div>
          ) : (
            <div className="space-y-2">
              {requests.map((req) => (
                <div
                  key={req.id}
                  className="flex items-center gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.03] p-2.5"
                >
                  {req.track?.thumbnailUrl && (
                    <img
                      src={req.track.thumbnailUrl}
                      alt=""
                      className="h-10 w-10 shrink-0 rounded-xl object-cover"
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-white">
                      {req.track?.title}
                    </div>
                    <div className="truncate text-[11px] text-white/55">
                      Pedido por <strong className="text-white/85">{req.guestName}</strong>
                    </div>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold ${
                      req.status === 'approved'
                        ? 'bg-emerald-500/15 text-emerald-300'
                        : req.status === 'pending'
                          ? 'bg-amber-500/15 text-amber-300'
                          : 'bg-rose-500/15 text-rose-300'
                    }`}
                  >
                    {req.status === 'approved' ? (
                      'En cola'
                    ) : req.status === 'pending' ? (
                      <span className="inline-flex items-center gap-1">
                        <Clock className="h-3 w-3" /> Pendiente
                      </span>
                    ) : (
                      'Rechazada'
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
