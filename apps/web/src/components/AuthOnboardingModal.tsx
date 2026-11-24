import React, { useEffect, useState } from 'react';
import {
  Check,
  Disc3,
  Laptop,
  Loader2,
  Mail,
  ShieldCheck,
  Sparkles,
  User,
  X,
} from 'lucide-react';
import { usePMusicStore } from '../store/usePMusicStore.ts';
import { PMusicLogo } from './PMusicLogo.tsx';

function GoogleLogo() {
  return (
    <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.49 12.27c0-.79-.07-1.54-.2-2.27H12v4.3h6.45c-.28 1.48-1.12 2.74-2.38 3.58v2.98h3.85c2.25-2.07 3.57-5.12 3.57-8.59z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.07 7.93-2.91l-3.85-2.98c-1.07.72-2.44 1.15-4.08 1.15-3.14 0-5.8-2.12-6.75-4.97H1.28v3.08C3.25 21.29 7.31 24 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.25 14.29A7.18 7.18 0 0 1 4.88 12c0-.79.14-1.56.37-2.29V6.63H1.28A12 12 0 0 0 0 12c0 1.94.46 3.77 1.28 5.37l3.97-3.08z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.76 0 3.34.61 4.58 1.8l3.44-3.44C17.95 1.19 15.24 0 12 0 7.31 0 3.25 2.71 1.28 6.63l3.97 3.08c.95-2.85 3.61-4.96 6.75-4.96z"
      />
    </svg>
  );
}

export const AuthOnboardingModal: React.FC = () => {
  const {
    authOnboardingOpen,
    needsProfileSetup,
    authState: syncAuth,
    userProfile,
    signInWithGoogle,
    signInSupabase: signInCloud,
    signUpSupabase: signUpCloud,
    continueAsGuest,
    saveUserProfile,
    checkUsernameAvailable,
    setAuthOnboardingOpen,
  } = usePMusicStore();

  const [step, setStep] = useState<'choice' | 'email'>('choice');
  const [emailMode, setEmailMode] = useState<'signup' | 'signin'>('signup');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [usernameStatus, setUsernameStatus] = useState<'idle' | 'checking' | 'ok' | 'taken'>('idle');

  useEffect(() => {
    if (!needsProfileSetup) return;
    const baseName =
      userProfile?.displayName ||
      syncAuth.displayName ||
      (syncAuth.email ? syncAuth.email.split('@')[0] : '') ||
      '';
    setDisplayName((prev) => prev || baseName);
    const suggested = baseName
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9._]/g, '')
      .slice(0, 18);
    if (suggested.length >= 3) {
      setUsername((prev) => prev || suggested);
    }
  }, [needsProfileSetup, syncAuth.displayName, syncAuth.email, userProfile?.displayName]);

  useEffect(() => {
    if (!needsProfileSetup) return;
    const clean = username.trim().toLowerCase().replace(/^@+/, '');
    if (!/^[a-z0-9._]{3,24}$/.test(clean)) {
      setUsernameStatus('idle');
      return;
    }
    let cancelled = false;
    setUsernameStatus('checking');
    const timer = window.setTimeout(async () => {
      const ok = await checkUsernameAvailable(clean);
      if (!cancelled) setUsernameStatus(ok ? 'ok' : 'taken');
    }, 320);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [username, needsProfileSetup, checkUsernameAvailable]);

  useEffect(() => {
    if (!authOnboardingOpen || needsProfileSetup) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAuthOnboardingOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [authOnboardingOpen, needsProfileSetup, setAuthOnboardingOpen]);

  if (!authOnboardingOpen && !needsProfileSetup) return null;

  const handleGoogle = async () => {
    setBusy(true);
    setErrorMsg(null);
    try {
      await signInWithGoogle();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'No se pudo abrir Google.');
    } finally {
      setBusy(false);
    }
  };

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErrorMsg(null);
    try {
      if (emailMode === 'signup') {
        await signUpCloud(email, password);
      } else {
        await signInCloud(email, password);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Error al iniciar sesión.');
    } finally {
      setBusy(false);
    }
  };

  const handleProfileSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErrorMsg(null);
    try {
      await saveUserProfile({
        username,
        displayName,
        avatarUrl: syncAuth.avatarUrl ?? null,
      });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'No se pudo guardar tu perfil.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="pm-no-drag fixed inset-0 z-[140] flex flex-col overflow-y-auto bg-[#040407] text-white"
      role="dialog"
      aria-modal="true"
      aria-label="Acceso pMusic"
    >
      {/* Subtle futuristic studio grid + monochrome/crimson radial aura */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 opacity-[0.07]"
        style={{
          backgroundImage:
            'linear-gradient(to right, rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.5) 1px, transparent 1px)',
          backgroundSize: '64px 64px',
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none fixed -top-40 left-1/2 h-[420px] w-[720px] -translate-x-1/2 rounded-full opacity-25 blur-[110px]"
        style={{
          background:
            'radial-gradient(circle, rgba(250,35,59,0.55) 0%, rgba(124,58,237,0.28) 50%, transparent 75%)',
        }}
      />

      {/* Top Navigation Bar — positioned safely below the 48px Windows titlebar overlay */}
      <header className="pm-no-drag relative z-30 flex w-full shrink-0 items-center justify-between px-6 pb-3 pt-[max(3.5rem,var(--pm-safe-top,env(safe-area-inset-top)))] sm:px-10">
        <div className="flex items-center gap-3">
          <PMusicLogo size={26} variant="wordmark-only" />
          <span className="hidden rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/55 sm:inline-block">
            Audio Studio
          </span>
        </div>

        {!needsProfileSetup && (
          <button
            type="button"
            onClick={() => setAuthOnboardingOpen(false)}
            className="pm-no-drag relative z-40 inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border border-white/15 bg-white/[0.06] text-white/75 transition hover:border-white/30 hover:bg-white/[0.12] hover:text-white active:scale-95"
            aria-label="Cerrar pantalla de acceso"
          >
            <X className="pointer-events-none h-4 w-4" />
          </button>
        )}
      </header>

      {/* Full-Screen Architectural Split Layout */}
      <div className="relative z-10 mx-auto flex w-full max-w-6xl flex-1 items-center px-6 pb-12 pt-4 sm:px-10">
        <div className="grid w-full grid-cols-1 items-center gap-12 lg:grid-cols-12">
          {/* Left Showcase Column (Desktop) */}
          <div className="hidden space-y-8 lg:col-span-6 lg:block">
            <div className="inline-flex items-center gap-4">
              <PMusicLogo size={72} variant="icon" />
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#ff5a6e]">
                  Ecosistema pMusic
                </p>
                <h1 className="mt-1 text-4xl font-bold tracking-tight text-white">
                  Tu música, sincronizada al milisegundo.
                </h1>
              </div>
            </div>

            <p className="max-w-md text-sm leading-relaxed text-white/60">
              Conecta tu PC y tu móvil en una misma sesión en vivo, conserva tu biblioteca en la
              nube y construye automáticamente tu <span className="text-white">Wrapped</span> anual.
            </p>

            <div className="grid max-w-md gap-3">
              <div className="flex items-center gap-3.5 rounded-2xl border border-white/[0.08] bg-white/[0.025] px-4 py-3.5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.05] text-emerald-400">
                  <Laptop className="h-4 w-4" />
                </span>
                <div>
                  <div className="text-xs font-semibold text-white">pMusic Connect</div>
                  <div className="text-[11px] text-white/55">
                    Transfiere la reproducción y controla el volumen entre PC y Android.
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3.5 rounded-2xl border border-white/[0.08] bg-white/[0.025] px-4 py-3.5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.05] text-[#ff5a6e]">
                  <Disc3 className="h-4 w-4" />
                </span>
                <div>
                  <div className="text-xs font-semibold text-white">Wrapped Anual Privado</div>
                  <div className="text-[11px] text-white/55">
                    Minutos, artistas, géneros y racha registrados en segundo plano.
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3.5 rounded-2xl border border-white/[0.08] bg-white/[0.025] px-4 py-3.5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.05] text-sky-400">
                  <ShieldCheck className="h-4 w-4" />
                </span>
                <div>
                  <div className="text-xs font-semibold text-white">Cuenta independiente</div>
                  <div className="text-[11px] text-white/55">
                    Cada cuenta tiene sus playlists, likes y perfil @usuario privados.
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Right / Center Studio Auth Surface */}
          <div className="mx-auto w-full max-w-md lg:col-span-6 lg:ml-auto lg:mr-0">
            <div className="rounded-[24px] border border-white/[0.11] bg-[#0a0b10]/95 p-7 shadow-[0_32px_90px_rgba(0,0,0,0.75)] sm:p-8">
              {needsProfileSetup ? (
                <form onSubmit={handleProfileSubmit} className="space-y-5">
                  <div className="flex items-center gap-4">
                    {syncAuth.avatarUrl ? (
                      <img
                        src={syncAuth.avatarUrl}
                        alt={displayName || 'Perfil'}
                        className="h-14 w-14 rounded-2xl border border-white/20 object-cover"
                      />
                    ) : (
                      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/10 text-lg font-bold text-white">
                        {(displayName || syncAuth.email || 'P').slice(0, 1).toUpperCase()}
                      </div>
                    )}
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-emerald-400">
                        Cuenta verificada
                      </p>
                      <h2 className="text-xl font-bold text-white">Configura tu @usuario</h2>
                    </div>
                  </div>

                  <p className="text-xs leading-relaxed text-white/60">
                    Tus playlists y Me gusta locales ya se están fusionando automáticamente. Tu
                    @usuario te identificará en Blend y Jam.
                  </p>

                  <div className="space-y-3.5">
                    <div>
                      <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-white/55">
                        Nombre visible
                      </label>
                      <input
                        type="text"
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        placeholder="Tu nombre"
                        required
                        maxLength={60}
                        className="w-full rounded-xl border border-white/12 bg-white/[0.04] px-4 py-3 text-sm text-white outline-none transition focus:border-white/35"
                      />
                    </div>

                    <div>
                      <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-white/55">
                        Identificador único
                      </label>
                      <div className="relative">
                        <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm font-semibold text-white/45">
                          @
                        </span>
                        <input
                          type="text"
                          value={username}
                          onChange={(e) =>
                            setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9._]/g, ''))
                          }
                          placeholder="tu.usuario"
                          required
                          minLength={3}
                          maxLength={24}
                          className="w-full rounded-xl border border-white/12 bg-white/[0.04] py-3 pl-8 pr-10 text-sm text-white outline-none transition focus:border-white/35"
                        />
                        <span className="absolute right-3.5 top-1/2 -translate-y-1/2">
                          {usernameStatus === 'checking' && (
                            <Loader2 className="h-4 w-4 animate-spin text-white/50" />
                          )}
                          {usernameStatus === 'ok' && <Check className="h-4 w-4 text-emerald-400" />}
                          {usernameStatus === 'taken' && <X className="h-4 w-4 text-rose-400" />}
                        </span>
                      </div>
                      {usernameStatus === 'taken' && (
                        <p className="mt-1 text-xs text-rose-400">Ese @usuario ya está en uso.</p>
                      )}
                    </div>
                  </div>

                  {errorMsg && (
                    <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2.5 text-xs text-rose-300">
                      {errorMsg}
                    </p>
                  )}

                  <button
                    type="submit"
                    disabled={busy || usernameStatus === 'taken'}
                    className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-white px-4 py-3.5 text-sm font-bold text-zinc-950 transition hover:bg-zinc-200 disabled:opacity-50"
                  >
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                    Guardar y entrar a pMusic
                  </button>
                </form>
              ) : step === 'choice' ? (
                <div className="space-y-6">
                  <div className="space-y-2">
                    <div className="mb-4 flex items-center gap-3 lg:hidden">
                      <PMusicLogo size={48} variant="icon" />
                    </div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/45">
                      Acceso seguro
                    </p>
                    <h2 className="text-2xl font-bold tracking-tight text-white">
                      Inicia sesión en pMusic
                    </h2>
                    <p className="text-xs leading-relaxed text-white/60">
                      Accede con tu cuenta de Google o correo para sincronizar tus dispositivos y
                      guardar tu historial.
                    </p>
                  </div>

                  {errorMsg && (
                    <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2.5 text-xs text-rose-300">
                      {errorMsg}
                    </p>
                  )}

                  <div className="space-y-3">
                    <button
                      type="button"
                      onClick={handleGoogle}
                      disabled={busy}
                      className="flex w-full cursor-pointer items-center justify-center gap-3 rounded-xl bg-white px-4 py-3.5 text-sm font-semibold text-zinc-950 shadow-sm transition hover:bg-zinc-200 active:scale-[0.99] disabled:opacity-60"
                    >
                      {busy ? (
                        <Loader2 className="h-4 w-4 animate-spin text-zinc-700" />
                      ) : (
                        <GoogleLogo />
                      )}
                      Continuar con Google
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setErrorMsg(null);
                        setStep('email');
                      }}
                      disabled={busy}
                      className="flex w-full cursor-pointer items-center justify-center gap-2.5 rounded-xl border border-white/15 bg-white/[0.04] px-4 py-3.5 text-sm font-semibold text-white transition hover:border-white/25 hover:bg-white/[0.08] active:scale-[0.99]"
                    >
                      <Mail className="h-4 w-4 text-white/75" />
                      Entrar o crear cuenta con correo
                    </button>
                  </div>

                  <div className="border-t border-white/[0.08] pt-4">
                    <button
                      type="button"
                      onClick={() => continueAsGuest()}
                      disabled={busy}
                      className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs font-medium text-white/55 transition hover:bg-white/[0.04] hover:text-white"
                    >
                      <User className="h-3.5 w-3.5" />
                      Continuar como invitado (solo local)
                    </button>
                  </div>
                </div>
              ) : (
                <form onSubmit={handleEmailSubmit} className="space-y-5">
                  <div>
                    <button
                      type="button"
                      onClick={() => {
                        setErrorMsg(null);
                        setStep('choice');
                      }}
                      className="cursor-pointer text-xs font-medium text-white/55 transition hover:text-white"
                    >
                      ← Volver a opciones
                    </button>
                    <h2 className="mt-2.5 text-xl font-bold text-white">
                      {emailMode === 'signup' ? 'Crear cuenta pMusic' : 'Iniciar sesión'}
                    </h2>
                  </div>

                  <div className="grid grid-cols-2 rounded-xl border border-white/10 bg-white/[0.03] p-1">
                    <button
                      type="button"
                      onClick={() => setEmailMode('signup')}
                      className={`cursor-pointer rounded-lg py-2 text-xs font-semibold transition ${
                        emailMode === 'signup'
                          ? 'bg-white text-zinc-950'
                          : 'text-white/60 hover:text-white'
                      }`}
                    >
                      Crear cuenta
                    </button>
                    <button
                      type="button"
                      onClick={() => setEmailMode('signin')}
                      className={`cursor-pointer rounded-lg py-2 text-xs font-semibold transition ${
                        emailMode === 'signin'
                          ? 'bg-white text-zinc-950'
                          : 'text-white/60 hover:text-white'
                      }`}
                    >
                      Ya tengo cuenta
                    </button>
                  </div>

                  <div className="space-y-3">
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="tu@correo.com"
                      required
                      className="w-full rounded-xl border border-white/12 bg-white/[0.04] px-4 py-3 text-sm text-white outline-none transition focus:border-white/35"
                    />
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Contraseña (mín. 6 caracteres)"
                      required
                      minLength={6}
                      className="w-full rounded-xl border border-white/12 bg-white/[0.04] px-4 py-3 text-sm text-white outline-none transition focus:border-white/35"
                    />
                  </div>

                  {errorMsg && (
                    <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2.5 text-xs text-rose-300">
                      {errorMsg}
                    </p>
                  )}

                  <button
                    type="submit"
                    disabled={busy}
                    className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-white px-4 py-3.5 text-sm font-bold text-zinc-950 transition hover:bg-zinc-200 disabled:opacity-50"
                  >
                    {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                    {emailMode === 'signup' ? 'Crear cuenta' : 'Entrar'}
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
