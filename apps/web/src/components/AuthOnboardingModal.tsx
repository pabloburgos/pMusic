import React, { useEffect, useState } from 'react';
import { Check, Loader2, Mail, User, X } from 'lucide-react';
import { usePMusicStore } from '../store/usePMusicStore.ts';
import { PMusicLogo } from './PMusicLogo.tsx';

function GoogleLogo() {
  return (
    <svg className="h-[18px] w-[18px] shrink-0" viewBox="0 0 24 24" aria-hidden="true">
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

export const AuthOnboardingModal: React.FC = React.memo(() => {
  const open = usePMusicStore((s) => s.authOnboardingOpen || s.needsProfileSetup);
  if (!open) return null;
  return <AuthOnboardingModalInner />;
});
AuthOnboardingModal.displayName = 'AuthOnboardingModal';

const AuthOnboardingModalInner: React.FC = () => {
  const {
    authOnboardingOpen,
    needsProfileSetup,
    authState: syncAuth,
    userProfile,
    authCallbackError,
    signInWithGoogle,
    signInSupabase: signInCloud,
    signUpSupabase: signUpCloud,
    continueAsGuest,
    saveUserProfile,
    checkUsernameAvailable,
    setAuthOnboardingOpen,
  } = usePMusicStore();

  const [step, setStep] = useState<'choice' | 'email' | 'google_waiting'>('choice');
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
    if (!authOnboardingOpen || needsProfileSetup) {
      setStep('choice');
      return;
    }
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
    setStep('google_waiting');
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
      className="pm-no-drag fixed inset-0 z-[140] flex flex-col items-center justify-center overflow-hidden bg-[#050507] px-6 text-white"
      role="dialog"
      aria-modal="true"
      aria-label="pMusic"
    >
      <style>{`
        @keyframes pmAgFadeUp {
          0% { opacity: 0; transform: translate3d(0, 18px, 0) scale(0.985); filter: blur(6px); }
          100% { opacity: 1; transform: translate3d(0, 0, 0) scale(1); filter: blur(0); }
        }
        @keyframes pmAgOrbFloat {
          0%, 100% { transform: translate3d(-50%, 0, 0) scale(1); opacity: 0.14; }
          50% { transform: translate3d(-50%, -18px, 0) scale(1.08); opacity: 0.22; }
        }
        .pm-ag-enter-1 { animation: pmAgFadeUp 620ms cubic-bezier(0.16, 1, 0.3, 1) both; }
        .pm-ag-enter-2 { animation: pmAgFadeUp 680ms cubic-bezier(0.16, 1, 0.3, 1) 90ms both; }
        .pm-ag-enter-3 { animation: pmAgFadeUp 740ms cubic-bezier(0.16, 1, 0.3, 1) 170ms both; }
        .pm-ag-orb { animation: pmAgOrbFloat 7s ease-in-out infinite; }
      `}</style>

      {/* Pure monochrome Antigravity-style breathing light field */}
      <div
        aria-hidden="true"
        className="pm-ag-orb pointer-events-none fixed left-1/2 top-[16%] h-[420px] w-[540px] rounded-full blur-[120px]"
        style={{
          background:
            'radial-gradient(circle, rgba(255,255,255,0.22) 0%, rgba(180,190,220,0.08) 48%, transparent 74%)',
        }}
      />

      {/* Clean Close button positioned safely below 48px Windows titlebar */}
      {!needsProfileSetup && (
        <button
          type="button"
          onClick={() => setAuthOnboardingOpen(false)}
          className="pm-no-drag fixed right-6 top-[max(3.6rem,var(--pm-safe-top,env(safe-area-inset-top)))] z-50 inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border border-white/12 bg-white/[0.05] text-white/65 transition hover:border-white/25 hover:bg-white/[0.1] hover:text-white active:scale-95"
          aria-label="Cerrar"
        >
          <X className="pointer-events-none h-4 w-4" />
        </button>
      )}

      <div className="relative z-10 w-full max-w-[360px]">
        {needsProfileSetup ? (
          <form onSubmit={handleProfileSubmit} className="pm-ag-enter-1 space-y-6">
            <div className="flex flex-col items-center gap-3">
              {syncAuth.avatarUrl ? (
                <img
                  src={syncAuth.avatarUrl}
                  alt=""
                  className="h-16 w-16 rounded-full border border-white/20 object-cover"
                />
              ) : (
                <PMusicLogo size={60} variant="icon" />
              )}
              <PMusicLogo size={26} variant="wordmark-only" />
            </div>

            <div className="space-y-3">
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Nombre"
                required
                maxLength={60}
                className="w-full rounded-2xl border border-white/12 bg-white/[0.04] px-4 py-3.5 text-sm text-white placeholder-white/35 outline-none transition focus:border-white/35"
              />
              <div className="relative">
                <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm text-white/40">
                  @
                </span>
                <input
                  type="text"
                  value={username}
                  onChange={(e) =>
                    setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9._]/g, ''))
                  }
                  placeholder="usuario"
                  required
                  minLength={3}
                  maxLength={24}
                  className="w-full rounded-2xl border border-white/12 bg-white/[0.04] py-3.5 pl-8 pr-10 text-sm text-white placeholder-white/35 outline-none transition focus:border-white/35"
                />
                <span className="absolute right-3.5 top-1/2 -translate-y-1/2">
                  {usernameStatus === 'checking' && (
                    <Loader2 className="h-4 w-4 animate-spin text-white/45" />
                  )}
                  {usernameStatus === 'ok' && <Check className="h-4 w-4 text-white" />}
                  {usernameStatus === 'taken' && <X className="h-4 w-4 text-white/45" />}
                </span>
              </div>
            </div>

            {errorMsg && (
              <p className="rounded-2xl border border-white/15 bg-white/[0.06] px-4 py-2.5 text-center text-xs text-white/80">
                {errorMsg}
              </p>
            )}

            <button
              type="submit"
              disabled={busy || usernameStatus === 'taken'}
              className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-full bg-white px-5 py-3.5 text-sm font-semibold text-black transition hover:bg-white/90 active:scale-[0.985] disabled:opacity-50"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Continuar
            </button>
          </form>
        ) : step === 'google_waiting' ? (
          <div
            data-testid="google-auth-waiting-screen"
            className="pm-ag-enter-1 flex flex-col items-center space-y-7 text-center"
          >
            <div className="flex items-center gap-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/15 bg-white/[0.06] shadow-lg">
                <PMusicLogo size={32} variant="icon" />
              </div>
              <div className="flex items-center gap-1.5" aria-hidden="true">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white/40" />
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white/65 [animation-delay:180ms]" />
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white/90 [animation-delay:360ms]" />
              </div>
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/15 bg-white text-black shadow-lg">
                <GoogleLogo />
              </div>
            </div>

            <div className="space-y-2">
              <h2 className="text-2xl font-bold tracking-tight text-white">
                Autentícate en Google
              </h2>
              <p className="text-sm leading-relaxed text-white/65">
                Hemos abierto una ventana nueva para iniciar sesión de forma segura. Al terminar, volverás automáticamente a pMusic.
              </p>
            </div>

            {errorMsg || authCallbackError ? (
              <p className="w-full rounded-2xl border border-rose-400/30 bg-rose-500/15 px-4 py-2.5 text-center text-xs text-rose-200">
                {errorMsg || authCallbackError}
              </p>
            ) : (
              <div className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/[0.05] px-4 py-2 text-xs font-medium text-white/80">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-400" />
                <span>Esperando confirmación…</span>
              </div>
            )}

            <div className="w-full space-y-2.5 pt-1">
              <button
                type="button"
                onClick={handleGoogle}
                disabled={busy}
                className="flex w-full cursor-pointer items-center justify-center gap-2.5 rounded-full bg-white px-5 py-3.5 text-sm font-semibold text-black shadow-[0_12px_36px_rgba(255,255,255,0.12)] transition hover:bg-white/90 active:scale-[0.985] disabled:opacity-60"
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin text-black/70" />
                ) : (
                  <GoogleLogo />
                )}
                Reabrir ventana de Google
              </button>

              <button
                type="button"
                onClick={() => {
                  setErrorMsg(null);
                  setStep('choice');
                }}
                className="w-full cursor-pointer py-2 text-center text-xs font-medium text-white/50 transition hover:text-white"
              >
                ← Volver y usar otro método
              </button>
            </div>
          </div>
        ) : step === 'choice' ? (
          <div className="flex flex-col items-center space-y-10">
            {/* Pure big animated motion-graphics pMusic wordmark only */}
            <div className="pm-ag-enter-1 flex flex-col items-center">
              <PMusicLogo size={62} variant="wordmark-only" animated />
            </div>

            {(errorMsg || authCallbackError) && (
              <p className="w-full rounded-2xl border border-white/15 bg-white/[0.06] px-4 py-2.5 text-center text-xs text-white/80">
                {errorMsg || authCallbackError}
              </p>
            )}

            <div className="pm-ag-enter-2 w-full space-y-3">
              <button
                type="button"
                onClick={handleGoogle}
                disabled={busy}
                className="flex w-full cursor-pointer items-center justify-center gap-3 rounded-full bg-white px-5 py-3.5 text-sm font-semibold text-black shadow-[0_12px_36px_rgba(255,255,255,0.12)] transition hover:bg-white/90 active:scale-[0.985] disabled:opacity-60"
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin text-black/70" />
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
                className="flex w-full cursor-pointer items-center justify-center gap-2.5 rounded-full border border-white/14 bg-white/[0.04] px-5 py-3.5 text-sm font-medium text-white transition hover:border-white/25 hover:bg-white/[0.08] active:scale-[0.985]"
              >
                <Mail className="h-4 w-4 text-white/70" />
                Correo electrónico
              </button>
            </div>

            <button
              type="button"
              onClick={() => continueAsGuest()}
              disabled={busy}
              className="pm-ag-enter-3 inline-flex cursor-pointer items-center gap-2 rounded-full px-4 py-2 text-xs font-medium text-white/45 transition hover:text-white/85"
            >
              <User className="h-3.5 w-3.5" />
              Invitado
            </button>

            <div className="pm-ag-enter-3 flex items-center justify-center gap-2.5 text-[11px] text-white/35">
              <a
                href="https://pmusic-olive.vercel.app/privacy"
                target="_blank"
                rel="noopener noreferrer"
                className="transition hover:text-white/75"
              >
                Privacidad
              </a>
              <span>·</span>
              <a
                href="https://pmusic-olive.vercel.app/terms"
                target="_blank"
                rel="noopener noreferrer"
                className="transition hover:text-white/75"
              >
                Términos
              </a>
            </div>
          </div>
        ) : (
          <form onSubmit={handleEmailSubmit} className="pm-ag-enter-1 space-y-5">
            <div className="flex flex-col items-center gap-3">
              <PMusicLogo size={30} variant="wordmark-only" />
              <div className="inline-flex rounded-full border border-white/10 bg-white/[0.03] p-1">
                <button
                  type="button"
                  onClick={() => setEmailMode('signup')}
                  className={`cursor-pointer rounded-full px-4 py-1.5 text-xs font-medium transition ${
                    emailMode === 'signup' ? 'bg-white text-black' : 'text-white/55 hover:text-white'
                  }`}
                >
                  Crear cuenta
                </button>
                <button
                  type="button"
                  onClick={() => setEmailMode('signin')}
                  className={`cursor-pointer rounded-full px-4 py-1.5 text-xs font-medium transition ${
                    emailMode === 'signin' ? 'bg-white text-black' : 'text-white/55 hover:text-white'
                  }`}
                >
                  Iniciar sesión
                </button>
              </div>
            </div>

            <div className="space-y-3">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Correo electrónico"
                required
                className="w-full rounded-2xl border border-white/12 bg-white/[0.04] px-4 py-3.5 text-sm text-white placeholder-white/35 outline-none transition focus:border-white/35"
              />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Contraseña"
                required
                minLength={6}
                className="w-full rounded-2xl border border-white/12 bg-white/[0.04] px-4 py-3.5 text-sm text-white placeholder-white/35 outline-none transition focus:border-white/35"
              />
            </div>

            {errorMsg && (
              <p className="rounded-2xl border border-white/15 bg-white/[0.06] px-4 py-2.5 text-center text-xs text-white/80">
                {errorMsg}
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-full bg-white px-5 py-3.5 text-sm font-semibold text-black transition hover:bg-white/90 active:scale-[0.985] disabled:opacity-50"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {emailMode === 'signup' ? 'Crear cuenta' : 'Entrar'}
            </button>

            <button
              type="button"
              onClick={() => {
                setErrorMsg(null);
                setStep('choice');
              }}
              className="w-full cursor-pointer py-1 text-center text-xs text-white/45 transition hover:text-white"
            >
              ← Volver
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
