import React, { useEffect, useState } from 'react';
import { Check, Loader2, Mail, Sparkles, User, X } from 'lucide-react';
import { usePMusicStore } from '../store/usePMusicStore.ts';

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
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/80 p-4 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-label="Cuenta pMusic"
    >
      <div className="relative w-full max-w-md overflow-hidden rounded-[28px] border border-white/15 bg-[#0c0d13] p-6 shadow-2xl">
        <div
          className="pointer-events-none absolute -top-24 left-1/2 h-48 w-72 -translate-x-1/2 rounded-full opacity-35 blur-3xl"
          style={{
            background: 'radial-gradient(circle, #fa233b 0%, #7c3aed 55%, transparent 75%)',
          }}
        />

        {!needsProfileSetup && (
          <button
            type="button"
            onClick={() => setAuthOnboardingOpen(false)}
            className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full bg-white/8 text-white/60 transition hover:bg-white/15 hover:text-white"
            aria-label="Cerrar"
          >
            <X className="h-4 w-4" />
          </button>
        )}

        {needsProfileSetup ? (
          <form onSubmit={handleProfileSubmit} className="relative space-y-5">
            <div className="flex flex-col items-center text-center">
              {syncAuth.avatarUrl ? (
                <img
                  src={syncAuth.avatarUrl}
                  alt={displayName || 'Perfil'}
                  className="h-16 w-16 rounded-full border-2 border-[#fa233b]/70 object-cover shadow-lg"
                />
              ) : (
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-[#fa233b] to-[#7c3aed] text-xl font-bold text-white shadow-lg">
                  {(displayName || syncAuth.email || 'P').slice(0, 1).toUpperCase()}
                </div>
              )}
              <h2 className="mt-3 text-xl font-bold text-white">Elige tu @usuario</h2>
              <p className="mt-1 text-xs text-white/65">
                Tus playlists y Me gusta locales ya se están fusionando con tu cuenta. Tu @usuario
                servirá para Blend y Jam con tus amigos.
              </p>
            </div>

            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-white/70">
                  Nombre visible
                </label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Tu nombre"
                  required
                  maxLength={60}
                  className="pm-input w-full rounded-2xl px-4 py-3 text-sm text-white"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-white/70">
                  Nombre de usuario único
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
                    placeholder="pablo.music"
                    required
                    minLength={3}
                    maxLength={24}
                    className="pm-input w-full rounded-2xl py-3 pl-8 pr-10 text-sm text-white"
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
                  <p className="mt-1 text-xs text-rose-400">Ese @usuario ya está pillado.</p>
                )}
              </div>
            </div>

            {errorMsg && (
              <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
                {errorMsg}
              </p>
            )}

            <button
              type="submit"
              disabled={busy || usernameStatus === 'taken'}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[#fa233b] px-4 py-3.5 text-sm font-semibold text-white shadow-lg shadow-[#fa233b]/25 transition hover:brightness-110 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Guardar perfil y entrar
            </button>
          </form>
        ) : step === 'choice' ? (
          <div className="relative space-y-5">
            <div className="flex flex-col items-center text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-[#fa233b] via-[#ff3b5c] to-[#7c3aed] text-2xl font-black text-white shadow-lg shadow-[#fa233b]/30">
                pM
              </div>
              <h2 className="mt-4 text-2xl font-bold tracking-tight text-white">
                Bienvenido a pMusic
              </h2>
              <p className="mt-1.5 text-sm text-white/65">
                Sincroniza tu música entre PC y móvil, controla la reproducción a distancia y
                acumula tus estadísticas para tu <span className="text-white">Wrapped</span> anual.
              </p>
            </div>

            {errorMsg && (
              <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
                {errorMsg}
              </p>
            )}

            <div className="space-y-2.5">
              <button
                type="button"
                onClick={handleGoogle}
                disabled={busy}
                className="flex w-full items-center justify-center gap-3 rounded-2xl bg-white px-4 py-3.5 text-sm font-semibold text-zinc-900 shadow-md transition hover:bg-zinc-100 active:scale-[0.99] disabled:opacity-60"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin text-zinc-700" /> : <GoogleLogo />}
                Continuar con Google
              </button>

              <button
                type="button"
                onClick={() => {
                  setErrorMsg(null);
                  setStep('email');
                }}
                disabled={busy}
                className="flex w-full items-center justify-center gap-2.5 rounded-2xl border border-white/15 bg-white/8 px-4 py-3.5 text-sm font-semibold text-white transition hover:bg-white/14 active:scale-[0.99]"
              >
                <Mail className="h-4 w-4 text-white/80" />
                Entrar o crear cuenta con correo
              </button>

              <button
                type="button"
                onClick={() => continueAsGuest()}
                disabled={busy}
                className="flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-medium text-white/65 transition hover:bg-white/5 hover:text-white"
              >
                <User className="h-4 w-4" />
                Continuar como invitado
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleEmailSubmit} className="relative space-y-4">
            <div>
              <button
                type="button"
                onClick={() => {
                  setErrorMsg(null);
                  setStep('choice');
                }}
                className="text-xs font-medium text-white/60 hover:text-white"
              >
                ← Volver
              </button>
              <h2 className="mt-2 text-xl font-bold text-white">
                {emailMode === 'signup' ? 'Crear cuenta pMusic' : 'Iniciar sesión'}
              </h2>
            </div>

            <div className="grid grid-cols-2 rounded-xl bg-white/6 p-1">
              <button
                type="button"
                onClick={() => setEmailMode('signup')}
                className={`rounded-lg py-2 text-xs font-semibold transition ${
                  emailMode === 'signup' ? 'bg-[#fa233b] text-white' : 'text-white/65 hover:text-white'
                }`}
              >
                Crear cuenta
              </button>
              <button
                type="button"
                onClick={() => setEmailMode('signin')}
                className={`rounded-lg py-2 text-xs font-semibold transition ${
                  emailMode === 'signin' ? 'bg-[#fa233b] text-white' : 'text-white/65 hover:text-white'
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
                className="pm-input w-full rounded-2xl px-4 py-3 text-sm text-white"
              />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Contraseña (mín. 6 caracteres)"
                required
                minLength={6}
                className="pm-input w-full rounded-2xl px-4 py-3 text-sm text-white"
              />
            </div>

            {errorMsg && (
              <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
                {errorMsg}
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[#fa233b] px-4 py-3.5 text-sm font-semibold text-white shadow-lg shadow-[#fa233b]/25 transition hover:brightness-110 disabled:opacity-50"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {emailMode === 'signup' ? 'Crear mi cuenta' : 'Entrar'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
