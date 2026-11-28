import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Clock,
  Disc3,
  ExternalLink,
  GripVertical,
  Headphones,
  Image as ImageIcon,
  ListMusic,
  Loader2,
  Lock,
  Music2,
  Pencil,
  Plus,
  Radio,
  Search,
  Sliders,
  SlidersHorizontal,
  Speaker,
  Trash2,
  X,
} from 'lucide-react';
import {
  formatDurationSec,
  USER_EQ_FREQUENCIES_HZ,
  type Track,
} from '@pmusic/core';
import { PMusicLogo } from './PMusicLogo.tsx';
import { TrackArtwork } from './TrackArtwork.tsx';
import { UserAvatar } from './UserAvatar.tsx';
import { PMusicSwitch } from './PMusicSwitch.tsx';
import { MobileFluidBackdropCanvas } from './MobileFluidBackdropCanvas.tsx';
import { ExoticBackdropCanvas } from './ExoticBackdropCanvas.tsx';
import {
  AnimatedShuffleIcon,
  AnimatedSkipBackIcon,
  AnimatedSkipForwardIcon,
  RoundedPauseIcon,
  RoundedPlayIcon,
} from './TransportIcons.tsx';
import { Repeat } from 'lucide-react';
import {
  extractJamSyncMeta,
  fetchPublicJamRequests,
  fetchPublicJamSession,
  getAnonSupabaseClient,
  isJamQueueOpRequest,
  searchPublicCatalog,
  submitPublicJamPlaybackOp,
  submitPublicJamQueueOp,
  submitPublicJamRequest,
  type JamRequestRecord,
  type JamSessionRecord,
} from '../services/social-service.ts';

type GuestBackdropStyle = 'fluid' | 'paint' | 'pulse' | 'minimal';

interface GuestVisualPrefs {
  backdropStyle: GuestBackdropStyle;
  ambientMotion: boolean;
  showRemainingTime: boolean;
}

const GUEST_PREFS_STORAGE_KEY = 'pmusic.jam.guestPrefs';

function readGuestPrefs(): GuestVisualPrefs {
  const defaults: GuestVisualPrefs = {
    backdropStyle: 'fluid',
    ambientMotion: true,
    showRemainingTime: false,
  };
  if (typeof window === 'undefined') return defaults;
  try {
    const raw = window.localStorage.getItem(GUEST_PREFS_STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<GuestVisualPrefs>;
    return {
      backdropStyle:
        parsed.backdropStyle === 'paint' ||
        parsed.backdropStyle === 'pulse' ||
        parsed.backdropStyle === 'minimal'
          ? parsed.backdropStyle
          : 'fluid',
      ambientMotion: parsed.ambientMotion !== false,
      showRemainingTime: Boolean(parsed.showRemainingTime),
    };
  } catch {
    return defaults;
  }
}

function dismissBootSplashImmediately(): void {
  if (typeof document === 'undefined') return;
  const el = document.getElementById('pm-boot-splash');
  if (!el || el.classList.contains('pm-splash-hide')) return;
  el.classList.add('pm-splash-hide');
  setTimeout(() => el.remove(), 360);
}

export const PublicJamGuestPage: React.FC<{ code: string }> = ({ code }) => {
  const cleanCode = code.toUpperCase();
  const [session, setSession] = useState<JamSessionRecord | null>(null);
  const [requests, setRequests] = useState<JamRequestRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [mobileTab, setMobileTab] = useState<'Portada' | 'Cola'>('Portada');
  const [settingsOpen, setSettingsOpen] = useState(false);

  const [guestPrefs, setGuestPrefs] = useState<GuestVisualPrefs>(() => readGuestPrefs());
  const [guestName, setGuestName] = useState<string>(() => {
    try {
      return (
        localStorage.getItem('pmusic.jam.guestName') ??
        sessionStorage.getItem('pmusic.jam.guestName') ??
        ''
      );
    } catch {
      return '';
    }
  });
  const [guestAudioMode, setGuestAudioMode] = useState<'local_and_host' | 'host_only'>(() => {
    try {
      const saved = sessionStorage.getItem(`pmusic.jam.joined:${cleanCode}`);
      if (saved === 'host_only' || saved === 'local_and_host') return saved;
    } catch {
      // ignore
    }
    return 'local_and_host';
  });
  const [entryStep, setEntryStep] = useState<'choose_platform' | 'audio_and_nick'>('choose_platform');
  const [entryConfirmed, setEntryConfirmed] = useState<boolean>(() => {
    try {
      const saved = sessionStorage.getItem(`pmusic.jam.joined:${cleanCode}`);
      return saved === 'host_only' || saved === 'local_and_host';
    } catch {
      return false;
    }
  });
  const [attemptedAppOpen, setAttemptedAppOpen] = useState(false);
  const [editingNickname, setEditingNickname] = useState(false);
  const guestAudioRef = useRef<HTMLAudioElement | null>(null);

  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<Track[]>([]);
  const [requestedIds, setRequestedIds] = useState<Set<string>>(new Set());
  const [feedback, setFeedback] = useState<string | null>(null);
  const [dragFromIdx, setDragFromIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const [syncedPosSec, setSyncedPosSec] = useState(0);
  const searchSeqRef = useRef(0);

  const updateGuestPrefs = (patch: Partial<GuestVisualPrefs>) => {
    setGuestPrefs((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(GUEST_PREFS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  useEffect(() => {
    dismissBootSplashImmediately();
  }, []);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const [s, r] = await Promise.all([
          fetchPublicJamSession(cleanCode),
          fetchPublicJamRequests(cleanCode),
        ]);
        if (!active) return;
        setSession(s);
        setRequests(r);
      } catch {
        if (!active) return;
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();

    let channel: any = null;
    let sb: any = null;
    try {
      sb = getAnonSupabaseClient();
      channel = sb
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
    } catch {
      // fallback polling still keeps data fresh
    }

    const timer = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      void load();
    }, 4500);

    return () => {
      active = false;
      window.clearInterval(timer);
      try {
        void channel?.unsubscribe?.();
        if (channel && sb) sb.removeChannel?.(channel);
      } catch {
        // ignore
      }
    };
  }, [cleanCode]);

  const syncMeta = useMemo(() => extractJamSyncMeta(session), [session]);

  useEffect(() => {
    const audio = guestAudioRef.current;
    if (!audio) return;
    if (!entryConfirmed || guestAudioMode !== 'local_and_host' || !session?.currentTrack) {
      audio.pause();
      return;
    }
    const tr = session.currentTrack;
    const artist = tr.artists?.map((a) => a.name).join(', ') || 'pMusic';
    const nextSrc = `/api/stream/${encodeURIComponent(tr.id)}?title=${encodeURIComponent(tr.title)}&artist=${encodeURIComponent(artist)}&durationSec=${Math.max(30, Math.round(tr.durationSec || 180))}`;
    if (audio.dataset.trackId !== tr.id) {
      audio.dataset.trackId = tr.id;
      audio.src = nextSrc;
      try {
        audio.currentTime = syncedPosSec;
      } catch {
        // ignore
      }
    }
    if (session.isPlaying) {
      if (Math.abs((audio.currentTime || 0) - syncedPosSec) > 2.2) {
        try {
          audio.currentTime = syncedPosSec;
        } catch {
          // ignore
        }
      }
      void audio.play?.().catch(() => {});
    } else {
      audio.pause();
    }
  }, [
    entryConfirmed,
    guestAudioMode,
    session?.currentTrack?.id,
    session?.isPlaying,
    syncedPosSec,
  ]);

  useEffect(() => {
    const computeLivePos = () => {
      const dur = Math.max(1, session?.currentTrack?.durationSec ?? 180);
      if (!syncMeta) return 0;
      const elapsed = syncMeta.isPlaying
        ? Math.max(0, (Date.now() - syncMeta.updatedAtMs) / 1000)
        : 0;
      return Math.min(dur, Math.max(0, syncMeta.positionSec + elapsed));
    };
    setSyncedPosSec(computeLivePos());
    if (!session?.isPlaying) return;
    const iv = window.setInterval(() => {
      setSyncedPosSec(computeLivePos());
    }, 500);
    return () => window.clearInterval(iv);
  }, [session?.isPlaying, session?.currentTrack?.id, session?.currentTrack?.durationSec, syncMeta]);

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

  const handleRequestTrack = async (track: Track, playNext = false) => {
    if (!session) return;
    const visibleReqs = requests.filter((r) => !isJamQueueOpRequest(r));
    const myCount = visibleReqs.filter(
      (r) =>
        r.guestName.toLowerCase() === guestName.trim().toLowerCase() && r.status !== 'rejected'
    ).length;
    if (session.maxRequestsPerGuest > 0 && myCount >= session.maxRequestsPerGuest) {
      setFeedback(`Límite alcanzado: máximo ${session.maxRequestsPerGuest} canciones por invitado.`);
      return;
    }
    const cleanNick = guestName.trim() || 'Invitado';
    try {
      if (playNext && session.allowGuestDirectAdd) {
        const stampedTrack: Track = {
          ...track,
          addedBy: { displayName: cleanNick, avatarUrl: null },
        };
        setSession((prev) => {
          if (!prev) return prev;
          const curId = prev.currentTrack?.id;
          const rest = prev.queue.filter((q) => q.id !== curId && q.id !== stampedTrack.id);
          const head = prev.queue.filter((q) => q.id === curId);
          return { ...prev, queue: [...head, stampedTrack, ...rest] };
        });
        setRequestedIds((prev) => new Set(prev).add(track.id));
        await submitPublicJamQueueOp(cleanCode, cleanNick, {
          __jamOp: 'add_next',
          targetTrackId: track.id,
          toUpNextIndex: 0,
          track: stampedTrack,
        });
        setFeedback(`«${track.title}» puesta a continuación en la Jam de ${session.hostName}`);
        return;
      }

      const created = await submitPublicJamRequest(
        cleanCode,
        cleanNick,
        track,
        session.allowGuestDirectAdd,
        { displayName: cleanNick, avatarUrl: null }
      );
      setRequests((prev) => [created, ...prev]);
      if (session.allowGuestDirectAdd) {
        const stampedTrack: Track = {
          ...track,
          addedBy: { displayName: cleanNick, avatarUrl: null },
        };
        setSession((prev) => {
          if (!prev) return prev;
          if (prev.queue.some((q) => q.id === stampedTrack.id)) return prev;
          return { ...prev, queue: [...prev.queue, stampedTrack] };
        });
      }
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

  const handleQueueMove = async (fromIdx: number, toIdx: number) => {
    if (!session) return;
    const curId = session.currentTrack?.id;
    const upNext = session.queue.filter((t) => t.id !== curId);
    if (fromIdx < 0 || fromIdx >= upNext.length || toIdx < 0 || toIdx >= upNext.length || fromIdx === toIdx) {
      return;
    }
    const nextUp = [...upNext];
    const [moved] = nextUp.splice(fromIdx, 1);
    if (!moved) return;
    nextUp.splice(toIdx, 0, moved);
    const head = session.queue.filter((t) => t.id === curId);
    setSession((prev) => (prev ? { ...prev, queue: [...head, ...nextUp] } : prev));
    setFeedback(`«${moved.title}» movida en la cola`);
    try {
      await submitPublicJamQueueOp(cleanCode, guestName.trim() || 'Invitado', {
        __jamOp: 'move',
        targetTrackId: moved.id,
        toUpNextIndex: toIdx,
      });
    } catch {
      // keep optimistic update
    }
  };

  const handleQueueRemove = async (trackId: string, title: string) => {
    if (!session) return;
    const curId = session.currentTrack?.id;
    const head = session.queue.filter((t) => t.id === curId);
    const nextUp = session.queue.filter((t) => t.id !== curId && t.id !== trackId);
    setSession((prev) => (prev ? { ...prev, queue: [...head, ...nextUp] } : prev));
    setFeedback(`«${title}» retirada de la cola compartida`);
    try {
      await submitPublicJamQueueOp(cleanCode, guestName.trim() || 'Invitado', {
        __jamOp: 'remove',
        targetTrackId: trackId,
      });
    } catch {
      // keep optimistic update
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

  if (!entryConfirmed || editingNickname) {
    if (editingNickname) {
      return (
        <div className="flex min-h-dvh flex-col items-center justify-center bg-[#000000] px-6 text-white">
          <div className="w-full max-w-sm space-y-6 text-center">
            <div className="flex justify-center">
              <PMusicLogo size={46} variant="wordmark-only" animated />
            </div>
            <div>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/25 bg-emerald-500/12 px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-emerald-300">
                <Radio className="h-3 w-3 text-emerald-400" /> Jam de {session.hostName}
              </span>
              <h1 className="mt-3 text-xl font-bold">Cambiar tu apodo</h1>
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
                Guardar apodo
              </button>
            </form>
          </div>
        </div>
      );
    }

    return (
      <div
        data-testid="jam-guest-entry-flow"
        className="flex min-h-dvh flex-col items-center justify-center bg-[#000000] px-5 py-8 text-white"
      >
        <div className="w-full max-w-md space-y-6 rounded-[28px] border border-white/12 bg-[#0a0a0d] p-6 shadow-2xl">
          <div className="flex items-center justify-between">
            <PMusicLogo size={34} variant="wordmark-only" />
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/25 bg-emerald-500/12 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-emerald-300">
              <Radio className="h-3 w-3 animate-pulse" />
              Paso {entryStep === 'choose_platform' ? '1' : '2'} de 2
            </span>
          </div>

          {/* Live Host & Track Preview */}
          <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-3">
            {session.currentTrack?.thumbnailUrl ? (
              <img
                src={session.currentTrack.thumbnailUrl}
                alt={session.currentTrack.title}
                className="h-12 w-12 shrink-0 rounded-xl object-cover"
              />
            ) : (
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white/10">
                <Music2 className="h-5 w-5 text-white/75" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-extrabold text-white">
                Jam de {session.hostName}
              </div>
              <div className="truncate text-xs text-white/65">
                {session.currentTrack
                  ? `${session.currentTrack.title} · ${session.currentTrack.artists?.map((a) => a.name).join(', ')}`
                  : `Código ${cleanCode} · Sesión en vivo`}
              </div>
            </div>
          </div>

          {entryStep === 'choose_platform' ? (
            <div data-testid="jam-entry-step-1" className="space-y-4">
              <div className="space-y-1 text-center">
                <h1 className="text-xl font-black tracking-tight text-white">
                  ¿Cómo quieres unirte a la Jam?
                </h1>
                <p className="text-xs text-white/60">
                  Si ya tienes pMusic instalado en tu móvil o PC, ábrela directo en la app para mejor audio.
                </p>
              </div>

              <div className="space-y-2.5">
                <button
                  type="button"
                  data-testid="jam-open-native-app-btn"
                  onClick={() => {
                    setAttemptedAppOpen(true);
                    try {
                      window.location.href = `pmusic://jam/${cleanCode}`;
                    } catch {
                      // ignore unsupported protocol scheme error
                    }
                  }}
                  className="pm-pressable flex w-full items-center justify-between rounded-2xl bg-white px-4 py-3.5 text-left text-[#070709] shadow-lg transition hover:bg-white/90"
                >
                  <div>
                    <div className="text-sm font-extrabold">Abrir en la app de pMusic</div>
                    <div className="text-[11px] font-medium text-[#070709]/70">
                      Experiencia completa con crossfade, letras y cola en vivo
                    </div>
                  </div>
                  <ExternalLink className="h-4 w-4 shrink-0" />
                </button>

                <button
                  type="button"
                  data-testid="jam-continue-web-btn"
                  onClick={() => setEntryStep('audio_and_nick')}
                  className="pm-pressable flex w-full items-center justify-between rounded-2xl border border-white/15 bg-white/[0.06] px-4 py-3.5 text-left text-white transition hover:bg-white/[0.12]"
                >
                  <div>
                    <div className="text-sm font-bold">Continuar en la web</div>
                    <div className="text-[11px] text-white/60">
                      Sin instalar nada · Elige dónde escuchar ahora
                    </div>
                  </div>
                  <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-[11px] font-bold">
                    Siguiente →
                  </span>
                </button>
              </div>

              {attemptedAppOpen && (
                <div className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-center text-[11px] text-white/75">
                  Intentando abrir pMusic (<code className="font-mono text-white">pmusic://jam/{cleanCode}</code>). Si no se abre, pulsa <strong>Continuar en la web</strong>.
                </div>
              )}
            </div>
          ) : (
            <form
              data-testid="jam-entry-step-2"
              onSubmit={(e) => {
                e.preventDefault();
                const clean = guestName.trim();
                if (!clean) return;
                try {
                  localStorage.setItem('pmusic.jam.guestName', clean);
                  sessionStorage.setItem('pmusic.jam.guestName', clean);
                  sessionStorage.setItem(`pmusic.jam.joined:${cleanCode}`, guestAudioMode);
                } catch {
                  // ignore
                }
                setEntryConfirmed(true);
              }}
              className="space-y-4"
            >
              <div className="space-y-1 text-center">
                <h1 className="text-xl font-black tracking-tight text-white">
                  ¿Dónde quieres escuchar la música?
                </h1>
                <p className="text-xs text-white/60">
                  Puedes cambiarlo luego dentro de la sesión cuando quieras.
                </p>
              </div>

              <div className="grid grid-cols-1 gap-2">
                <button
                  type="button"
                  data-testid="jam-web-audio-local-btn"
                  onClick={() => setGuestAudioMode('local_and_host')}
                  className={`flex items-center gap-3 rounded-2xl border p-3.5 text-left transition ${
                    guestAudioMode === 'local_and_host'
                      ? 'border-white bg-white text-[#070709]'
                      : 'border-white/12 bg-white/[0.04] text-white hover:bg-white/[0.08]'
                  }`}
                >
                  <Headphones className="h-5 w-5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-extrabold">También en mi dispositivo</div>
                    <div
                      className={`text-[11px] ${
                        guestAudioMode === 'local_and_host' ? 'text-[#070709]/70' : 'text-white/60'
                      }`}
                    >
                      Suena sincronizado aquí y en el altavoz de {session.hostName}
                    </div>
                  </div>
                  {guestAudioMode === 'local_and_host' && <Check className="h-4 w-4 shrink-0" />}
                </button>

                <button
                  type="button"
                  data-testid="jam-web-audio-host-only-btn"
                  onClick={() => setGuestAudioMode('host_only')}
                  className={`flex items-center gap-3 rounded-2xl border p-3.5 text-left transition ${
                    guestAudioMode === 'host_only'
                      ? 'border-white bg-white text-[#070709]'
                      : 'border-white/12 bg-white/[0.04] text-white hover:bg-white/[0.08]'
                  }`}
                >
                  <Speaker className="h-5 w-5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-extrabold">Solo en el altavoz del jefe</div>
                    <div
                      className={`text-[11px] ${
                        guestAudioMode === 'host_only' ? 'text-[#070709]/70' : 'text-white/60'
                      }`}
                    >
                      Control remoto y cola compartida sin audio en tu dispositivo
                    </div>
                  </div>
                  {guestAudioMode === 'host_only' && <Check className="h-4 w-4 shrink-0" />}
                </button>
              </div>

              <div className="space-y-2 pt-1">
                <input
                  type="text"
                  value={guestName}
                  onChange={(e) => setGuestName(e.target.value)}
                  placeholder="Tu nombre o apodo"
                  maxLength={32}
                  required
                  className="w-full rounded-full border border-white/15 bg-white/[0.06] px-5 py-3 text-center text-sm text-white placeholder-white/35 outline-none focus:border-white/40"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setEntryStep('choose_platform')}
                    className="rounded-full border border-white/15 bg-white/[0.06] px-4 py-3 text-xs font-bold text-white hover:bg-white/[0.12]"
                  >
                    Atrás
                  </button>
                  <button
                    type="submit"
                    data-testid="jam-entry-submit-btn"
                    className="flex-1 cursor-pointer rounded-full bg-white px-5 py-3 text-sm font-bold text-black transition hover:bg-white/90"
                  >
                    Entrar a la Jam
                  </button>
                </div>
              </div>
            </form>
          )}
        </div>
      </div>
    );
  }

  const allowGuestPlayback = Boolean(
    syncMeta?.allowGuestPlaybackControls ?? session.allowGuestPlaybackControls
  );

  const activeTrack = session.currentTrack ?? session.queue[0] ?? null;
  const activeCoverUrl = activeTrack
    ? activeTrack.thumbnailHighUrl ?? activeTrack.thumbnailUrl
    : undefined;
  const activeDurSec = Math.max(1, activeTrack?.durationSec ?? 180);
  const progressPct = Math.max(0, Math.min(100, (syncedPosSec / activeDurSec) * 100));
  const remainingSec = Math.max(0, activeDurSec - syncedPosSec);
  const upNextQueue = activeTrack
    ? session.queue.filter((t) => t.id !== activeTrack.id)
    : session.queue;
  const visibleRequests = requests.filter((r) => !isJamQueueOpRequest(r));

  const renderPortadaDeck = () => (
    <div
      data-testid="jam-guest-portada-view"
      className="mx-auto flex w-full max-w-[390px] flex-col items-center gap-4 lg:sticky lg:top-8"
    >
      <div className="relative aspect-square w-[min(76vw,320px)] overflow-hidden rounded-[18px] bg-[#111116] shadow-[0_26px_64px_rgba(0,0,0,0.6)] md:w-[340px]">
        {activeTrack ? (
          <TrackArtwork
            trackId={activeTrack.id}
            src={activeCoverUrl}
            title={activeTrack.title}
            artistName={activeTrack.artists[0]?.name}
            artistId={activeTrack.artists[0]?.id}
            alt={activeTrack.title}
            variant="nowplaying"
            loading="eager"
            imgClassName="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-6 text-center">
            <PMusicLogo variant="mark" size={40} color="#FFFFFF" />
            <p className="text-sm font-bold text-white/85">Jam de {session.hostName}</p>
            <p className="text-xs text-white/50">Esperando la siguiente canción</p>
          </div>
        )}
      </div>

      <div className="w-full space-y-1 text-left">
        <div className="flex items-center justify-between gap-2">
          <h1 className="truncate text-[21px] font-bold leading-tight tracking-tight text-white">
            {activeTrack?.title ?? `Jam de ${session.hostName}`}
          </h1>
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-emerald-400/30 bg-emerald-500/15 px-2.5 py-0.5 text-[10px] font-bold text-emerald-300">
            <Radio className="h-3 w-3 animate-pulse" />
            EN VIVO
          </span>
        </div>
        <p className="truncate text-sm text-white/70">
          {activeTrack?.artists.map((a) => a.name).join(', ') ?? 'En directo'}
          {activeTrack?.album?.name ? ` · ${activeTrack.album.name}` : ''}
        </p>
        {activeTrack?.addedBy?.displayName && (
          <div className="inline-flex items-center gap-1.5 pt-1 text-[11px] font-medium text-white/65">
            <UserAvatar
              src={activeTrack.addedBy.avatarUrl}
              name={activeTrack.addedBy.displayName}
              size="xs"
            />
            <span>Añadida por {activeTrack.addedBy.displayName}</span>
          </div>
        )}
      </div>

      {/* Synced Progress Bar (Interactive when host allows guest playback control) */}
      <div className="w-full space-y-1.5">
        <div className="relative flex h-6 items-center">
          <div className="pointer-events-none relative h-[5px] w-full overflow-hidden rounded-full bg-white/20">
            <div
              className="h-full w-full rounded-full bg-white/85 transition-transform duration-300"
              style={{ transform: `translate3d(${(progressPct - 100).toFixed(2)}%, 0, 0)` }}
            />
          </div>
          <input
            type="range"
            role="slider"
            aria-label={
              allowGuestPlayback
                ? 'Progreso de la canción'
                : 'Progreso de la canción (bloqueado en modo invitado)'
            }
            disabled={!allowGuestPlayback}
            min={0}
            max={Math.round(activeDurSec)}
            value={Math.round(syncedPosSec)}
            onChange={(e) => {
              if (!allowGuestPlayback) return;
              const nextSec = Math.max(0, Math.min(activeDurSec, Number(e.target.value)));
              setSyncedPosSec(nextSec);
              if (guestAudioRef.current && guestAudioMode === 'local_and_host') {
                try {
                  guestAudioRef.current.currentTime = nextSec;
                } catch {
                  // ignore
                }
              }
              void submitPublicJamPlaybackOp(cleanCode, guestName.trim() || 'Invitado', 'seek', nextSec);
            }}
            className={`pm-range-gpu-overlay absolute inset-0 z-10 h-full w-full opacity-0 ${
              allowGuestPlayback ? 'cursor-pointer' : 'cursor-not-allowed'
            }`}
          />
        </div>
        <div className="tabular-nums flex items-center justify-between text-[11px] font-medium text-white/60">
          <span>{formatDurationSec(syncedPosSec)}</span>
          <button
            type="button"
            onClick={() => updateGuestPrefs({ showRemainingTime: !guestPrefs.showRemainingTime })}
            className="hover:text-white"
          >
            {guestPrefs.showRemainingTime
              ? `-${formatDurationSec(remainingSec)}`
              : formatDurationSec(activeDurSec)}
          </button>
        </div>
      </div>

      {/* Transport Controls (Unlocked when host grants guest playback permissions) */}
      <div
        data-testid={allowGuestPlayback ? 'jam-guest-unlocked-controls' : 'jam-guest-locked-controls'}
        className="mx-auto grid w-full max-w-[320px] grid-cols-5 place-items-center py-0.5"
      >
        <button
          type="button"
          disabled
          aria-label="Aleatorio bloqueado"
          className="flex h-9 w-9 cursor-not-allowed items-center justify-center text-white/40 opacity-45"
        >
          <AnimatedShuffleIcon className="h-4 w-4" animate={false} />
        </button>
        <button
          type="button"
          disabled={!allowGuestPlayback}
          aria-label={allowGuestPlayback ? 'Canción anterior' : 'Anterior bloqueado'}
          onClick={() => {
            if (!allowGuestPlayback) return;
            void submitPublicJamPlaybackOp(cleanCode, guestName.trim() || 'Invitado', 'prev');
            setFeedback('Anterior solicitada en la Jam');
          }}
          className={`flex h-11 w-11 items-center justify-center ${
            allowGuestPlayback
              ? 'cursor-pointer text-white transition hover:scale-110 active:scale-90'
              : 'cursor-not-allowed text-white/45 opacity-45'
          }`}
        >
          <AnimatedSkipBackIcon className="h-7 w-7" filled animate={false} />
        </button>
        <button
          type="button"
          disabled={!allowGuestPlayback}
          data-testid={allowGuestPlayback ? 'jam-guest-play-btn' : 'jam-guest-play-locked-btn'}
          onClick={() => {
            if (!allowGuestPlayback) return;
            const nextPlaying = !session.isPlaying;
            setSession((prev) => (prev ? { ...prev, isPlaying: nextPlaying } : prev));
            void submitPublicJamPlaybackOp(cleanCode, guestName.trim() || 'Invitado', 'toggle_play');
          }}
          aria-label={
            allowGuestPlayback
              ? session.isPlaying
                ? 'Pausar Jam'
                : 'Reanudar Jam'
              : session.isPlaying
                ? 'Reproducción en curso (solo el jefe)'
                : 'Pausada (solo el jefe)'
          }
          className={`flex h-14 w-14 items-center justify-center rounded-full ${
            allowGuestPlayback
              ? 'cursor-pointer bg-white text-[#070709] shadow-lg transition hover:scale-105 active:scale-90'
              : 'cursor-not-allowed bg-white/10 text-white/75 opacity-55'
          }`}
        >
          {session.isPlaying ? (
            <RoundedPauseIcon className="h-11 w-11" />
          ) : (
            <RoundedPlayIcon className="h-11 w-11 translate-x-[1px]" />
          )}
        </button>
        <button
          type="button"
          disabled={!allowGuestPlayback}
          aria-label={allowGuestPlayback ? 'Siguiente canción' : 'Siguiente bloqueado'}
          onClick={() => {
            if (!allowGuestPlayback) return;
            void submitPublicJamPlaybackOp(cleanCode, guestName.trim() || 'Invitado', 'next');
            setFeedback('Siguiente canción en la Jam');
          }}
          className={`flex h-11 w-11 items-center justify-center ${
            allowGuestPlayback
              ? 'cursor-pointer text-white transition hover:scale-110 active:scale-90'
              : 'cursor-not-allowed text-white/45 opacity-45'
          }`}
        >
          <AnimatedSkipForwardIcon className="h-7 w-7" filled animate={false} />
        </button>
        <button
          type="button"
          disabled
          aria-label="Repetir bloqueado"
          className="flex h-9 w-9 cursor-not-allowed items-center justify-center text-white/40 opacity-45"
        >
          <Repeat className="h-4 w-4" />
        </button>
      </div>

      <div className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-black/35 px-3.5 py-1 text-[11px] font-semibold text-white/75 backdrop-blur-md">
        {allowGuestPlayback ? (
          <>
            <Radio className="h-3 w-3 shrink-0 text-emerald-400" />
            <span>Puedes pausar, pasar canción y mover la barra</span>
          </>
        ) : (
          <>
            <Lock className="h-3 w-3 shrink-0" />
            <span>Controles bloqueados · Solo el jefe de la Jam</span>
          </>
        )}
      </div>
    </div>
  );

  const renderColaSection = () => (
    <div data-testid="jam-guest-cola-view" className="space-y-5">
      {/* Search Bar to Request or Add Songs */}
      <div className="space-y-3">
        <form onSubmit={handleSearch} className="flex gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-white/45" />
            <input
              type="text"
              aria-label="Buscar canción para pedir en la Jam"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Pide una canción para la cola de la Jam…"
              className="w-full rounded-full border border-white/15 bg-black/35 py-3 pl-11 pr-9 text-sm text-white placeholder-white/45 backdrop-blur-md outline-none focus:border-white/40"
            />
            {query && (
              <button
                type="button"
                aria-label="Limpiar búsqueda"
                onClick={() => {
                  setQuery('');
                  setResults([]);
                }}
                className="absolute right-3 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-white/60 hover:bg-white/15 hover:text-white"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <button
            type="submit"
            disabled={searching}
            className="shrink-0 cursor-pointer rounded-full bg-white px-5 py-3 text-sm font-bold text-[#070709] transition hover:bg-white/90 disabled:opacity-50"
          >
            {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Buscar'}
          </button>
        </form>

        {feedback && (
          <div className="rounded-2xl border border-emerald-400/25 bg-emerald-500/12 px-4 py-2.5 text-xs font-medium text-emerald-200 backdrop-blur-md">
            {feedback}
          </div>
        )}

        {results.length > 0 && (
          <section className="space-y-2 rounded-2xl border border-white/12 bg-black/45 p-3 backdrop-blur-xl">
            <h2 className="px-1 text-[11px] font-bold uppercase tracking-wider text-white/55">
              Resultados — Añade a la Jam
            </h2>
            <div className="space-y-1.5">
              {results.map((track) => {
                const already = requestedIds.has(track.id);
                return (
                  <div
                    key={track.id}
                    className="flex items-center gap-3 rounded-xl border border-white/[0.08] bg-white/[0.04] p-2"
                  >
                    <div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-black/40">
                      <TrackArtwork
                        trackId={track.id}
                        src={track.thumbnailUrl}
                        title={track.title}
                        artistName={track.artists[0]?.name}
                        artistId={track.artists[0]?.id}
                        alt={track.title}
                        variant="mini"
                        imgClassName="h-full w-full object-cover"
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-white">{track.title}</div>
                      <div className="truncate text-xs text-white/60">
                        {track.artists.map((a) => a.name).join(', ')}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {session.allowGuestDirectAdd && !already && (
                        <button
                          type="button"
                          onClick={() => void handleRequestTrack(track, true)}
                          className="cursor-pointer rounded-full bg-white px-2.5 py-1.5 text-[11px] font-bold text-[#070709] hover:opacity-90"
                        >
                          + Siguiente
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={already}
                        onClick={() => void handleRequestTrack(track, false)}
                        className={`inline-flex cursor-pointer items-center gap-1 rounded-full px-3 py-1.5 text-xs font-bold transition ${
                          already
                            ? 'bg-emerald-500/20 text-emerald-300'
                            : 'border border-white/20 bg-white/[0.10] text-white hover:bg-white/[0.20]'
                        }`}
                      >
                        {already ? <Check className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                        {already ? 'En cola' : 'Pedir'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </div>

      {/* Sonando ahora */}
      {activeTrack && (
        <section className="space-y-1.5">
          <h2 className="px-1 text-[11px] font-bold uppercase tracking-wider text-white/55">
            Sonando ahora
          </h2>
          <div className="flex items-center gap-3 rounded-2xl border border-white/15 bg-white/[0.12] p-2.5 backdrop-blur-md">
            <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-lg bg-black/40">
              <TrackArtwork
                trackId={activeTrack.id}
                src={activeTrack.thumbnailUrl}
                title={activeTrack.title}
                artistName={activeTrack.artists[0]?.name}
                artistId={activeTrack.artists[0]?.id}
                alt={activeTrack.title}
                variant="mini"
                imgClassName="h-full w-full object-cover"
              />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-bold text-white">{activeTrack.title}</div>
              <div className="truncate text-xs text-white/70">
                {activeTrack.artists.map((a) => a.name).join(', ')}
              </div>
            </div>
            <span className="tabular-nums text-xs font-medium text-white/65">
              {formatDurationSec(activeTrack.durationSec)}
            </span>
          </div>
        </section>
      )}

      {/* Editable Shared Queue (Move up, drag & drop, remove) */}
      <section className="space-y-2">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-[11px] font-bold uppercase tracking-wider text-white/65">
            Cola compartida ({upNextQueue.length})
          </h2>
          <span className="text-[10.5px] text-white/50">Puedes reordenar y editar</span>
        </div>

        {upNextQueue.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/15 bg-black/25 p-6 text-center text-xs text-white/55 backdrop-blur-md">
            <Music2 className="mx-auto mb-2 h-6 w-6 opacity-55" />
            No hay canciones siguientes aún. ¡Busca arriba y pide el primer tema!
          </div>
        ) : (
          <div className="space-y-1.5">
            {upNextQueue.map((track, idx) => (
              <div
                key={`${track.id}-${idx}`}
                data-testid={`jam-guest-queue-row-${track.id}`}
                draggable
                onDragStart={(e) => {
                  setDragFromIdx(idx);
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onDragOver={(e) => {
                  if (dragFromIdx !== null && dragFromIdx !== idx) {
                    e.preventDefault();
                    setDragOverIdx(idx);
                  }
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragFromIdx !== null && dragFromIdx !== idx) {
                    void handleQueueMove(dragFromIdx, idx);
                  }
                  setDragFromIdx(null);
                  setDragOverIdx(null);
                }}
                onDragEnd={() => {
                  setDragFromIdx(null);
                  setDragOverIdx(null);
                }}
                className={`group flex items-center gap-2.5 rounded-2xl border border-white/10 bg-black/30 p-2 backdrop-blur-md transition-colors hover:bg-white/[0.08] ${
                  dragOverIdx === idx ? 'border-t-2 border-t-white' : ''
                }`}
              >
                <GripVertical className="hidden h-4 w-4 shrink-0 cursor-grab text-white/40 sm:block" />
                <div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-black/40">
                  <TrackArtwork
                    trackId={track.id}
                    src={track.thumbnailUrl}
                    title={track.title}
                    artistName={track.artists[0]?.name}
                    artistId={track.artists[0]?.id}
                    alt={track.title}
                    variant="mini"
                    imgClassName="h-full w-full object-cover"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-white">{track.title}</div>
                  <div className="flex items-center gap-1.5 truncate text-xs text-white/60">
                    <span className="truncate">{track.artists.map((a) => a.name).join(', ')}</span>
                    {track.addedBy?.displayName && (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-white/[0.10] px-1.5 py-0.5 text-[10px] font-semibold text-white/85">
                        {track.addedBy.displayName}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {idx > 0 && (
                    <button
                      type="button"
                      aria-label={`Subir ${track.title} en la cola`}
                      onClick={() => void handleQueueMove(idx, idx - 1)}
                      className="rounded-full bg-white/[0.08] px-2.5 py-1 text-xs font-bold text-white hover:bg-white/[0.18]"
                    >
                      ↑
                    </button>
                  )}
                  <button
                    type="button"
                    aria-label={`Quitar ${track.title} de la cola`}
                    onClick={() => void handleQueueRemove(track.id, track.title)}
                    className="rounded-full p-1.5 text-white/60 hover:bg-white/[0.12] hover:text-rose-400"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Incoming Requests History */}
      {visibleRequests.length > 0 && (
        <section className="space-y-2 border-t border-white/10 pt-3">
          <h2 className="px-1 text-[11px] font-bold uppercase tracking-wider text-white/50">
            Peticiones enviadas ({visibleRequests.length})
          </h2>
          <div className="space-y-1.5">
            {visibleRequests.slice(0, 12).map((req) => (
              <div
                key={req.id}
                className="flex items-center gap-2.5 rounded-xl border border-white/[0.08] bg-black/25 p-2"
              >
                {req.track && (
                  <div className="h-9 w-9 shrink-0 overflow-hidden rounded-lg bg-black/40">
                    <TrackArtwork
                      trackId={req.track.id}
                      src={req.track.thumbnailUrl}
                      title={req.track.title}
                      artistName={req.track.artists?.[0]?.name}
                      alt={req.track.title}
                      variant="mini"
                      imgClassName="h-full w-full object-cover"
                    />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-semibold text-white">{req.track?.title}</div>
                  <div className="truncate text-[10.5px] text-white/55">
                    Pedida por <strong className="text-white/85">{req.guestName}</strong>
                  </div>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-bold ${
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
                      <Clock className="h-2.5 w-2.5" /> Pendiente
                    </span>
                  ) : (
                    'Rechazada'
                  )}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );

  return (
    <div className="relative min-h-dvh overflow-x-hidden bg-[#050507] text-white">
      <audio ref={guestAudioRef} preload="auto" className="hidden" />
      {/* Live Dynamic Background */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
        style={{
          background:
            guestPrefs.backdropStyle === 'minimal'
              ? 'radial-gradient(ellipse at 50% 24%, rgba(124, 58, 237, 0.25) 0%, rgba(17, 24, 39, 0.4) 55%, #050507 100%)'
              : '#050507',
        }}
      >
        {guestPrefs.backdropStyle === 'fluid' && (
          <MobileFluidBackdropCanvas
            coverUrl={activeCoverUrl ?? ''}
            crossfadeMs={800}
            crossfadeLinear={false}
            ambientMotionEnabled={guestPrefs.ambientMotion}
            reducedMotionPref={false}
          />
        )}
        {(guestPrefs.backdropStyle === 'paint' || guestPrefs.backdropStyle === 'pulse') && (
          <ExoticBackdropCanvas
            key={guestPrefs.backdropStyle}
            style={guestPrefs.backdropStyle}
            coverUrl={activeCoverUrl ?? ''}
            crossfadeMs={800}
            isPlaying={session.isPlaying}
            ambientMotionEnabled={guestPrefs.ambientMotion}
            reducedMotionPref={false}
            throttleFps={false}
          />
        )}
        <div
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(180deg, rgba(5,5,7,0.48) 0%, rgba(5,5,7,0.28) 40%, rgba(5,5,7,0.72) 100%)',
          }}
        />
      </div>

      {/* Main Container */}
      <div className="relative z-10 mx-auto max-w-6xl px-4 pb-24 pt-4 sm:px-6 md:pb-12">
        <header className="mb-5 flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex items-center gap-2.5">
            <PMusicLogo size={26} variant="wordmark-only" />
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-500/15 px-3 py-1 text-[11px] font-semibold text-emerald-300 backdrop-blur-md">
              <Radio className="h-3 w-3 animate-pulse" />
              Jam · {session.hostName}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              data-testid="jam-guest-toggle-audio-mode-btn"
              onClick={() => {
                const nextMode = guestAudioMode === 'local_and_host' ? 'host_only' : 'local_and_host';
                setGuestAudioMode(nextMode);
                try {
                  sessionStorage.setItem(`pmusic.jam.joined:${cleanCode}`, nextMode);
                } catch {
                  // ignore
                }
              }}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-white/15 bg-black/35 px-3 py-1.5 text-xs font-semibold text-white/90 backdrop-blur-md hover:bg-white/15"
              title="Cambiar dónde suena la música"
            >
              {guestAudioMode === 'local_and_host' ? (
                <>
                  <Headphones className="h-3.5 w-3.5 text-emerald-400" />
                  <span className="hidden sm:inline">En tu dispositivo</span>
                </>
              ) : (
                <>
                  <Speaker className="h-3.5 w-3.5 text-white/75" />
                  <span className="hidden sm:inline">Altavoz del jefe</span>
                </>
              )}
            </button>
            <button
              type="button"
              onClick={() => setEditingNickname(true)}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-white/15 bg-black/35 px-3 py-1.5 text-xs font-semibold text-white/85 backdrop-blur-md hover:bg-white/10"
              title="Cambiar tu apodo"
            >
              <UserAvatar name={guestName || 'Invitado'} size="xs" />
              <span className="max-w-[90px] truncate">{guestName}</span>
              <Pencil className="h-2.5 w-2.5 opacity-65" />
            </button>
            <button
              type="button"
              data-testid="jam-guest-settings-btn"
              onClick={() => setSettingsOpen(true)}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-white/15 bg-black/35 px-3.5 py-1.5 text-xs font-semibold text-white backdrop-blur-md hover:bg-white/15"
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              <span>Ajustes</span>
            </button>
          </div>
        </header>

        {/* Desktop Two-Column Split */}
        <div className="hidden gap-10 lg:grid lg:grid-cols-12">
          <div className="lg:col-span-5">{renderPortadaDeck()}</div>
          <div className="lg:col-span-7">{renderColaSection()}</div>
        </div>

        {/* Mobile/Tablet View */}
        <div className="lg:hidden">
          {mobileTab === 'Portada' ? renderPortadaDeck() : renderColaSection()}
        </div>
      </div>

      {/* Mobile Bottom View Switcher */}
      <nav
        aria-label="Navegación Jam invitado"
        className="fixed inset-x-4 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-30 flex items-center justify-center gap-2 lg:hidden"
      >
        <div className="flex items-center gap-1.5 rounded-full border border-white/15 bg-black/65 p-1.5 shadow-2xl backdrop-blur-xl">
          <button
            type="button"
            data-testid="jam-guest-tab-portada"
            aria-pressed={mobileTab === 'Portada'}
            onClick={() => setMobileTab('Portada')}
            className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-bold transition-colors ${
              mobileTab === 'Portada'
                ? 'bg-white text-[#070709]'
                : 'text-white/80 hover:bg-white/10'
            }`}
          >
            <ImageIcon className="h-3.5 w-3.5" />
            <span>Portada</span>
          </button>
          <button
            type="button"
            data-testid="jam-guest-tab-cola"
            aria-pressed={mobileTab === 'Cola'}
            onClick={() => setMobileTab('Cola')}
            className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-bold transition-colors ${
              mobileTab === 'Cola'
                ? 'bg-white text-[#070709]'
                : 'text-white/80 hover:bg-white/10'
            }`}
          >
            <ListMusic className="h-3.5 w-3.5" />
            <span>Cola ({upNextQueue.length})</span>
          </button>
        </div>
      </nav>

      {/* Guest Personal + Locked Jam Audio Settings Modal */}
      {settingsOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 backdrop-blur-md sm:items-center"
          onClick={() => setSettingsOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Ajustes de Jam"
            data-testid="jam-guest-settings-modal"
            onClick={(e) => e.stopPropagation()}
            className="max-h-[85dvh] w-full max-w-md space-y-5 overflow-y-auto rounded-[24px] border border-white/15 bg-[#0d0d12]/95 p-5 text-white shadow-2xl backdrop-blur-xl"
          >
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold">Ajustes de tu sesión</h2>
                <p className="text-[11px] text-white/55">
                  Personaliza tu pantalla · El audio pertenece al jefe
                </p>
              </div>
              <button
                type="button"
                aria-label="Cerrar ajustes"
                onClick={() => setSettingsOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white/80 hover:bg-white/20"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Personalization Section (Interactive for Guest) */}
            <section className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.04] p-3.5">
              <div className="text-xs font-bold uppercase tracking-wider text-white/60">
                Personalización visual (Tu pantalla)
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {(
                  [
                    { id: 'fluid', label: 'Fluido' },
                    { id: 'paint', label: 'Pintura' },
                    { id: 'pulse', label: 'Pulso' },
                    { id: 'minimal', label: 'Minimal' },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    data-testid={`jam-guest-backdrop-${opt.id}`}
                    aria-pressed={guestPrefs.backdropStyle === opt.id}
                    onClick={() => updateGuestPrefs({ backdropStyle: opt.id })}
                    className={`cursor-pointer rounded-xl px-3 py-2 text-left text-xs font-bold transition ${
                      guestPrefs.backdropStyle === opt.id
                        ? 'bg-white text-[#070709]'
                        : 'bg-white/[0.08] text-white/85 hover:bg-white/[0.15]'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              <div className="flex items-center justify-between pt-1">
                <div>
                  <div className="text-xs font-semibold">Fondo animado vivo</div>
                  <div className="text-[10.5px] text-white/55">Movimiento fluido de portada</div>
                </div>
                <PMusicSwitch
                  variant="hud"
                  ariaLabel="Fondo animado vivo"
                  checked={guestPrefs.ambientMotion}
                  onChange={() =>
                    updateGuestPrefs({ ambientMotion: !guestPrefs.ambientMotion })
                  }
                />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-semibold">Mostrar tiempo restante</div>
                  <div className="text-[10.5px] text-white/55">Cuenta regresiva en el reproductor</div>
                </div>
                <PMusicSwitch
                  variant="hud"
                  ariaLabel="Mostrar tiempo restante"
                  checked={guestPrefs.showRemainingTime}
                  onChange={() =>
                    updateGuestPrefs({ showRemainingTime: !guestPrefs.showRemainingTime })
                  }
                />
              </div>
            </section>

            {/* Locked Host Audio Controls */}
            <section
              data-testid="jam-guest-audio-locked"
              className="space-y-3 rounded-2xl border border-amber-400/25 bg-amber-500/8 p-3.5"
            >
              <div className="flex items-center gap-2 text-xs font-bold text-amber-200">
                <Lock className="h-3.5 w-3.5 shrink-0" />
                <span>Solo el jefe de la Jam puede cambiar esto</span>
              </div>

              <div
                aria-disabled="true"
                className="pointer-events-none select-none space-y-3 opacity-50"
              >
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs font-semibold">
                    <span className="inline-flex items-center gap-1.5">
                      <Sliders className="h-3.5 w-3.5" /> Crossfade
                    </span>
                    <span className="text-[11px]">
                      {syncMeta?.crossfadeEnabled ? `${syncMeta.crossfadeSec} s` : 'Desactivado'}
                    </span>
                  </div>
                  <input
                    type="range"
                    disabled
                    min={0}
                    max={12}
                    value={syncMeta?.crossfadeSec ?? 4}
                    onChange={() => {}}
                    className="w-full"
                  />
                </div>

                <div className="space-y-1.5 border-t border-white/10 pt-2.5">
                  <div className="flex items-center justify-between text-xs font-semibold">
                    <span>Ecualizador (EQ)</span>
                    <span className="text-[11px] uppercase">
                      {syncMeta?.eqEnabled ? syncMeta.eqPreset : 'Plano'}
                    </span>
                  </div>
                  <div className="grid grid-cols-5 gap-1.5 text-center text-[10px] text-white/65">
                    {USER_EQ_FREQUENCIES_HZ.map((hz) => (
                      <div key={hz} className="rounded-lg bg-white/[0.06] py-1.5">
                        {hz >= 1000 ? `${hz / 1000}k` : hz}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex items-center justify-between border-t border-white/10 pt-2.5">
                  <div className="inline-flex items-center gap-1.5 text-xs font-semibold">
                    <Disc3 className="h-3.5 w-3.5" /> Modo Sesión DJ
                  </div>
                  <PMusicSwitch
                    variant="hud"
                    checked={Boolean(syncMeta?.djEnabled)}
                    disabled
                    ariaLabel="Modo Sesión DJ (solo el jefe de la Jam)"
                    onChange={() => {}}
                  />
                </div>
              </div>
            </section>
          </div>
        </div>
      )}
    </div>
  );
};
