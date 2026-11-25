import React, { useEffect, useRef, useState } from 'react';
import { Check, Clock, Loader2, Music2, Pencil, Plus, Radio, Search, Sparkles, X } from 'lucide-react';
import type { Track } from '@pmusic/core';
import { PMusicLogo } from './PMusicLogo.tsx';
import { UserAvatar } from './UserAvatar.tsx';
import {
  fetchPublicJamRequests,
  fetchPublicJamSession,
  getAnonSupabaseClient,
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
      return localStorage.getItem('pmusic.jam.guestName') ?? sessionStorage.getItem('pmusic.jam.guestName') ?? '';
    } catch {
      return '';
    }
  });
  const [nameConfirmed, setNameConfirmed] = useState<boolean>(() => {
    try {
      return Boolean(
        localStorage.getItem('pmusic.jam.guestName') || sessionStorage.getItem('pmusic.jam.guestName')
      );
    } catch {
      return false;
    }
  });
  const [editingNickname, setEditingNickname] = useState(false);

  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<Track[]>([]);
  const [requestedIds, setRequestedIds] = useState<Set<string>>(new Set());
  const [feedback, setFeedback] = useState<string | null>(null);
  const searchSeqRef = useRef(0);

  useEffect(() => {
    let active = true;
    const load = async () => {
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

    const sb = getAnonSupabaseClient();
    const channel = sb
      .channel(`pmusic-public-jam:${cleanCode}:${Date.now()}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'jam_sessions', filter: `code=eq.${cleanCode}` },
        () => void load()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'jam_requests', filter: `jam_code=eq.${cleanCode}` },
        () => void load()
      )
      .subscribe();

    const timer = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      void load();
    }, 5500);

    return () => {
      active = false;
      window.clearInterval(timer);
      void channel.unsubscribe?.();
      sb.removeChannel?.(channel);
    };
  }, [cleanCode]);

  // Live debounced search as the guest types
  useEffect(() => {
    const cleanQ = query.trim();
    if (cleanQ.length < 2) {
      if (cleanQ.length === 0) setResults([]);
      setSearching(false);
      return;
    }
    const seq = ++searchSeqRef.current;
    setSearching(true);
    const timer = window.setTimeout(async () => {
      try {
        const list = await searchPublicCatalog(cleanQ);
        if (seq === searchSeqRef.current) {
          setResults(list);
        }
      } catch {
        if (seq === searchSeqRef.current) setResults([]);
      } finally {
        if (seq === searchSeqRef.current) setSearching(false);
      }
    }, 260);
    return () => window.clearTimeout(timer);
  }, [query]);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanQ = query.trim();
    if (!cleanQ) return;
    const seq = ++searchSeqRef.current;
    setSearching(true);
    setFeedback(null);
    try {
      const list = await searchPublicCatalog(cleanQ);
      if (seq === searchSeqRef.current) {
        setResults(list);
        if (list.length === 0) {
          setFeedback('No encontramos canciones con esa búsqueda. Prueba otro título o artista.');
        }
      }
    } finally {
      if (seq === searchSeqRef.current) setSearching(false);
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
      const cleanNick = guestName.trim() || 'Invitado';
      const created = await submitPublicJamRequest(
        cleanCode,
        cleanNick,
        track,
        session.allowGuestDirectAdd,
        { displayName: cleanNick, avatarUrl: null }
      );
      setRequests((prev) => [created, ...prev]);
      setRequestedIds((prev) => new Set(prev).add(track.id));
      setFeedback(
        session.allowGuestDirectAdd
          ? `«${track.title}» añadida a la cola de ${session.hostName}`
          : `«${track.title}» enviada para aprobación de ${session.hostName}`
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

  if (!nameConfirmed || editingNickname) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center bg-[#050507] px-6 text-white">
        <div className="w-full max-w-sm space-y-6 text-center">
          <div className="flex justify-center">
            <PMusicLogo size={46} variant="wordmark-only" animated />
          </div>
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/25 bg-emerald-500/12 px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-emerald-300">
              <Sparkles className="h-3 w-3" /> Jam de {session.hostName}
            </span>
            <h1 className="mt-3 text-xl font-bold">Añade canciones a la cola</h1>
            <p className="mt-1 text-xs text-white/55">
              Pon tu apodo para que sepan quién ha añadido cada tema.
            </p>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const clean = guestName.trim();
              if (!clean) return;
              try {
                localStorage.setItem('pmusic.jam.guestName', clean);
                sessionStorage.setItem('pmusic.jam.guestName', clean);
              } catch {
                // ignore
              }
              setNameConfirmed(true);
              setEditingNickname(false);
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
              className="w-full rounded-full border border-white/15 bg-white/[0.06] px-5 py-3.5 text-center text-sm text-white placeholder-white/35 outline-none focus:border-white/40"
            />
            <button
              type="submit"
              className="w-full cursor-pointer rounded-full bg-white px-5 py-3.5 text-sm font-bold text-black transition hover:bg-white/90"
            >
              {editingNickname ? 'Guardar apodo' : 'Entrar a añadir canciones'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-[#050507] text-white">
      <div className="mx-auto max-w-xl px-4 pb-16 pt-5 sm:px-6">
        <header className="flex flex-wrap items-center justify-between gap-2 pb-4">
          <PMusicLogo size={26} variant="wordmark-only" />
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-500/15 px-3 py-1 text-[11px] font-semibold text-emerald-300">
              <Radio className="h-3 w-3 animate-pulse" />
              Jam · {session.hostName}
            </span>
            <button
              type="button"
              onClick={() => setEditingNickname(true)}
              className="inline-flex items-center gap-1.5 rounded-full border border-white/12 bg-white/[0.05] px-2.5 py-1 text-[11px] font-semibold text-white/80 hover:bg-white/10"
              title="Cambiar tu apodo"
            >
              <UserAvatar name={guestName || 'Invitado'} size="xs" />
              <span className="max-w-[90px] truncate">{guestName}</span>
              <Pencil className="h-2.5 w-2.5 opacity-65" />
            </button>
          </div>
        </header>

        <div className="mb-4 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-xs text-white/75">
          Modo web invitado · Solo para buscar y añadir temas directamente a la cola de{' '}
          <strong className="text-white">{session.hostName}</strong>.
        </div>

        {/* Fast Search Bar — Only add songs */}
        <form onSubmit={handleSearch} className="mb-4 flex gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Busca una canción para añadir a la Jam..."
              className="w-full rounded-full border border-white/15 bg-white/[0.06] py-3 pl-11 pr-9 text-sm text-white placeholder-white/40 outline-none focus:border-white/40"
            />
            {query && (
              <button
                type="button"
                aria-label="Limpiar búsqueda"
                onClick={() => {
                  setQuery('');
                  setResults([]);
                }}
                className="absolute right-3 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-white/50 hover:bg-white/10 hover:text-white"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
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
          <div className="mb-4 rounded-2xl border border-emerald-400/25 bg-emerald-500/10 px-4 py-2.5 text-xs font-medium text-emerald-200">
            {feedback}
          </div>
        )}

        {/* Search Results */}
        {results.length > 0 && (
          <section className="mb-7 space-y-2">
            <h2 className="text-[11px] font-bold uppercase tracking-wider text-white/45">
              Resultados — Toca para añadir a la cola
            </h2>
            <div className="space-y-1.5">
              {results.map((track) => {
                const already = requestedIds.has(track.id);
                return (
                  <div
                    key={track.id}
                    className="flex items-center gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.04] p-2.5"
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
                      {already ? 'Añadida' : 'Añadir'}
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Live Add-Only Jam Queue */}
        <section className="space-y-2.5">
          <div className="flex items-center justify-between">
            <h2 className="text-[11px] font-bold uppercase tracking-wider text-white/45">
              Añadidas a la cola ({requests.length + (session.queue?.length ?? 0)})
            </h2>
          </div>

          {requests.length === 0 && (!session.queue || session.queue.length === 0) ? (
            <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-6 text-center text-xs text-white/45">
              <Music2 className="mx-auto mb-2 h-6 w-6 opacity-50" />
              Aún no hay temas añadidos. ¡Busca arriba y añade el primero!
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
                    <div className="mt-0.5 flex items-center gap-1.5 truncate text-[11px] text-white/60">
                      <UserAvatar
                        src={req.track?.addedBy?.avatarUrl}
                        name={req.guestName}
                        size="xs"
                      />
                      <span>
                        Añadida por <strong className="text-white/90">{req.guestName}</strong>
                      </span>
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
