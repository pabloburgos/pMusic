import React, { useMemo, useState } from 'react';
import {
  ArrowLeft,
  BarChart3,
  Check,
  ChevronRight,
  Database,
  Disc3,
  History,
  Laptop,
  LogOut,
  Palette,
  Play,
  Radio,
  Sliders,
  Smartphone,
  Timer,
  Trash2,
  UserPlus,
  Users,
  Wifi,
  X,
} from 'lucide-react';
import { formatDurationSec } from '@pmusic/core';
import { usePMusicStore } from '../store/usePMusicStore.ts';
import { PMusicSwitch } from './PMusicSwitch.tsx';
import { TrackArtwork } from './TrackArtwork.tsx';
import { UserAvatar } from './UserAvatar.tsx';

type MobileHubSubView = 'home' | 'history' | 'devices';

function formatRelativeTimeEs(iso: string): string {
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return 'Reciente';
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diffSec < 60) return 'Ahora';
  const mins = Math.floor(diffSec / 60);
  if (mins < 60) return `Hace ${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `Hace ${hrs} h`;
  const days = Math.floor(hrs / 24);
  return `Hace ${days} d`;
}

export const MobileHubPage: React.FC = React.memo(() => {
  const mobileHubOpen = usePMusicStore((s) => s.mobileHubOpen);
  if (!mobileHubOpen) return null;
  return <MobileHubPageInner />;
});
MobileHubPage.displayName = 'MobileHubPage';

const MobileHubPageInner: React.FC = () => {
  const {
    mobileHubOpen,
    setMobileHubOpen,
    authState,
    userProfile,
    savedAccounts,
    switchSavedAccount,
    prepareAddSecondaryAccount,
    removeSavedAccount,
    signOutSupabase,
    setAuthOnboardingOpen,
    openSettingsCategory,
    setActiveTab,
    setSocialSubTab,
    playHistory,
    clearPlayHistory,
    playTrack,
    offlineEntries,
    onlineDevices,
    transferPlaybackToDevice,
    startJam,
    alwaysShuffle,
    setAlwaysShuffle,
    marqueeTextEnabled,
    setMarqueeTextEnabled,
    ambientMotionEnabled,
    setAmbientMotionEnabled,
    sleepTimerMode,
    sleepTimerRemainingSec,
  } = usePMusicStore();

  const [subView, setSubView] = useState<MobileHubSubView>('home');
  const [historyFilter, setHistoryFilter] = useState('');
  const [switchingId, setSwitchingId] = useState<string | null>(null);

  const filteredHistory = useMemo(() => {
    const q = historyFilter.trim().toLowerCase();
    if (!q) return playHistory;
    return playHistory.filter(
      (h) =>
        h.track.title.toLowerCase().includes(q) ||
        h.track.artists.some((a) => a.name.toLowerCase().includes(q))
    );
  }, [playHistory, historyFilter]);

  if (!mobileHubOpen) return null;

  const displayName =
    userProfile?.displayName ||
    authState.displayName ||
    authState.email?.split('@')[0] ||
    'Invitado pMusic';
  const subtitle = userProfile?.username
    ? `@${userProfile.username}`
    : authState.email || 'Sincronización local';
  const lastHistoryTrack = playHistory[0]?.track;
  const otherAccounts = savedAccounts.filter((s) => s.userId !== authState.userId);
  const peerDevices = onlineDevices.filter((_, idx) => idx > 0);
  const currentDevice = onlineDevices[0];

  const handleClose = () => {
    setSubView('home');
    setMobileHubOpen(false);
  };

  return (
    <div
      data-testid="mobile-hub-page"
      role="dialog"
      aria-modal="true"
      aria-label="Preajustes y cuenta de pMusic"
      className="pm-canvas pm-page-enter fixed inset-0 z-[75] flex flex-col overflow-hidden"
    >
      {/* Sticky Top Header */}
      <header className="pm-mobile-glass-header sticky top-0 z-20 flex shrink-0 items-center justify-between gap-3 px-4 pt-[max(0.85rem,var(--pm-safe-top,env(safe-area-inset-top)))] pb-3">
        <button
          type="button"
          aria-label={subView === 'home' ? 'Cerrar preajustes' : 'Volver a preajustes'}
          onClick={() => {
            if (subView !== 'home') setSubView('home');
            else handleClose();
          }}
          className="pm-pressable inline-flex h-10 items-center gap-2 rounded-full px-2 text-sm font-semibold pm-text-primary hover:bg-white/[0.08]"
        >
          <ArrowLeft className="h-5 w-5" />
          <span>
            {subView === 'history'
              ? 'Historial'
              : subView === 'devices'
                ? 'Dispositivos'
                : 'Preajustes'}
          </span>
        </button>

        {subView === 'history' && playHistory.length > 0 && (
          <button
            type="button"
            onClick={() => void clearPlayHistory()}
            className="pm-pressable inline-flex items-center gap-1.5 rounded-full bg-rose-500/15 px-3 py-1.5 text-xs font-semibold text-rose-400"
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span>Limpiar</span>
          </button>
        )}

        {subView === 'home' && sleepTimerMode !== 'off' && (
          <button
            type="button"
            onClick={() => openSettingsCategory('reproduccion')}
            className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/15 px-3 py-1 text-xs font-semibold text-amber-400"
          >
            <Timer className="h-3.5 w-3.5" />
            <span className="tabular-nums">
              {sleepTimerMode === 'end_of_track'
                ? 'Fin pista'
                : formatDurationSec(sleepTimerRemainingSec)}
            </span>
          </button>
        )}
      </header>

      {/* Scrollable Content */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-3 pb-[max(2rem,var(--pm-safe-bottom,env(safe-area-inset-bottom)))]">
        {subView === 'home' && (
          <div className="mx-auto max-w-lg space-y-5">
            {/* Account Card + Multi-account Switcher */}
            <section className="pm-surface-card space-y-4 rounded-[20px] p-4">
              <div className="flex items-center gap-3.5">
                <UserAvatar
                  src={userProfile?.avatarUrl || authState.avatarUrl}
                  name={displayName}
                  size="xl"
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-lg font-extrabold pm-text-primary">
                    {displayName}
                  </div>
                  <div className="truncate text-xs font-medium pm-text-secondary">{subtitle}</div>
                  <div className="mt-1 flex items-center gap-2 text-[11px] pm-text-tertiary">
                    <span>{offlineEntries.length} offline</span>
                    <span>·</span>
                    <span>{playHistory.length} escuchas</span>
                  </div>
                </div>
                {authState.connected ? (
                  <button
                    type="button"
                    onClick={() => openSettingsCategory('cuenta')}
                    className="pm-btn-secondary pm-pressable shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold"
                  >
                    Editar
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      handleClose();
                      setAuthOnboardingOpen(true);
                    }}
                    className="pm-btn-primary pm-pressable shrink-0 rounded-full px-4 py-2 text-xs font-bold"
                  >
                    Entrar
                  </button>
                )}
              </div>

              {/* Multi-account section */}
              <div className="border-t pm-border pt-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-wider pm-text-tertiary">
                    Cuentas en este dispositivo
                  </span>
                </div>

                {authState.connected && (
                  <div className="flex items-center justify-between gap-2.5 rounded-[12px] bg-white/[0.06] px-3 py-2">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <UserAvatar
                        src={userProfile?.avatarUrl || authState.avatarUrl}
                        name={displayName}
                        size="sm"
                      />
                      <div className="min-w-0">
                        <div className="truncate text-xs font-bold pm-text-primary">
                          {displayName}
                        </div>
                        <div className="truncate text-[11px] pm-text-tertiary">
                          {userProfile?.username ? `@${userProfile.username}` : authState.email}
                        </div>
                      </div>
                    </div>
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
                      <Check className="h-3 w-3" /> Activa
                    </span>
                  </div>
                )}

                {otherAccounts.map((acc) => (
                  <div
                    key={acc.userId}
                    className="flex items-center justify-between gap-2 rounded-[12px] bg-white/[0.03] px-3 py-2"
                  >
                    <button
                      type="button"
                      disabled={switchingId === acc.userId}
                      onClick={() => {
                        setSwitchingId(acc.userId);
                        void switchSavedAccount(acc.userId).finally(() => setSwitchingId(null));
                      }}
                      className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                    >
                      <UserAvatar src={acc.avatarUrl} name={acc.displayName} size="sm" />
                      <div className="min-w-0">
                        <div className="truncate text-xs font-bold pm-text-primary">
                          {acc.displayName}
                        </div>
                        <div className="truncate text-[11px] pm-text-tertiary">
                          {acc.username ? `@${acc.username}` : acc.email}
                        </div>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => void switchSavedAccount(acc.userId)}
                      disabled={switchingId === acc.userId}
                      className="pm-btn-secondary pm-pressable rounded-full px-3 py-1 text-[11px] font-semibold"
                    >
                      {switchingId === acc.userId ? 'Cambiando…' : 'Cambiar'}
                    </button>
                    <button
                      type="button"
                      aria-label={`Quitar cuenta ${acc.displayName}`}
                      onClick={() => void removeSavedAccount(acc.userId)}
                      className="p-1.5 pm-text-tertiary hover:text-rose-400"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}

                <button
                  type="button"
                  data-testid="add-secondary-account-btn"
                  onClick={() => void prepareAddSecondaryAccount()}
                  className="pm-hover flex w-full items-center justify-center gap-2 rounded-[12px] border border-dashed pm-border py-2.5 text-xs font-bold pm-text-primary"
                >
                  <UserPlus className="h-4 w-4 text-[var(--pm-accent-primary)]" />
                  <span>Añadir cuenta secundaria</span>
                </button>
              </div>
            </section>

            {/* Primary Mobile Activity Hubs */}
            <section className="pm-surface-card divide-y divide-white/[0.06] overflow-hidden rounded-[20px]">
              <button
                type="button"
                onClick={() => setSubView('history')}
                className="pm-hover flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] bg-sky-500/20 text-sky-400">
                    <History className="h-4.5 w-4.5" />
                  </span>
                  <div className="min-w-0">
                    <div className="text-sm font-bold pm-text-primary">Historial de escucha</div>
                    <div className="truncate text-xs pm-text-secondary">
                      {lastHistoryTrack
                        ? `Última: ${lastHistoryTrack.title} · ${playHistory.length} pistas`
                        : 'Aún no hay reproducciones recientes'}
                    </div>
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 pm-text-tertiary" />
              </button>

              <button
                type="button"
                onClick={() => setSubView('devices')}
                className="pm-hover flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] bg-emerald-500/20 text-emerald-400">
                    <Wifi className="h-4.5 w-4.5" />
                  </span>
                  <div className="min-w-0">
                    <div className="text-sm font-bold pm-text-primary">Dispositivos conectados</div>
                    <div className="truncate text-xs pm-text-secondary">
                      {onlineDevices.length} disponibles · Transferencia instantánea y Jam
                    </div>
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 pm-text-tertiary" />
              </button>

              <button
                type="button"
                onClick={() => {
                  handleClose();
                  setActiveTab('Social');
                  setSocialSubTab('top');
                }}
                className="pm-hover flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] bg-white/10 text-white/90">
                    <BarChart3 className="h-4.5 w-4.5" />
                  </span>
                  <div className="min-w-0">
                    <div className="text-sm font-bold pm-text-primary">Mi Top y estadísticas</div>
                    <div className="truncate text-xs pm-text-secondary">
                      Tu resumen de 7 días, 30 días y este año
                    </div>
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 pm-text-tertiary" />
              </button>
            </section>

            {/* Quick Playback & Visual Toggles */}
            <section className="pm-surface-card divide-y divide-white/[0.06] rounded-[20px] px-4 py-1">
              <div
                onClick={() => setAlwaysShuffle(!alwaysShuffle)}
                className="flex cursor-pointer items-center justify-between gap-3 py-3"
              >
                <div className="min-w-0">
                  <div className="text-[13.5px] font-bold pm-text-primary">
                    Aleatorio siempre activo
                  </div>
                  <div className="text-xs pm-text-secondary">
                    Mezcla automáticamente al reproducir listas
                  </div>
                </div>
                <PMusicSwitch
                  checked={alwaysShuffle}
                  ariaLabel="Aleatorio siempre activo"
                  onChange={() => setAlwaysShuffle(!alwaysShuffle)}
                />
              </div>

              <div
                onClick={() => setMarqueeTextEnabled(!marqueeTextEnabled)}
                className="flex cursor-pointer items-center justify-between gap-3 py-3"
              >
                <div className="min-w-0">
                  <div className="text-[13.5px] font-bold pm-text-primary">
                    Desplazar títulos largos
                  </div>
                  <div className="text-xs pm-text-secondary">
                    Mueve títulos y artistas cuando no caben
                  </div>
                </div>
                <PMusicSwitch
                  checked={marqueeTextEnabled}
                  ariaLabel="Desplazar títulos largos"
                  onChange={() => setMarqueeTextEnabled(!marqueeTextEnabled)}
                />
              </div>

              <div
                onClick={() => setAmbientMotionEnabled(!ambientMotionEnabled)}
                className="flex cursor-pointer items-center justify-between gap-3 py-3"
              >
                <div className="min-w-0">
                  <div className="text-[13.5px] font-bold pm-text-primary">
                    Fondo animado en reproductor
                  </div>
                  <div className="text-xs pm-text-secondary">
                    Fluido dinámico adaptado a la portada
                  </div>
                </div>
                <PMusicSwitch
                  checked={ambientMotionEnabled}
                  ariaLabel="Fondo animado en reproductor"
                  onChange={() => setAmbientMotionEnabled(!ambientMotionEnabled)}
                />
              </div>
            </section>

            {/* Full Settings Sections */}
            <section className="pm-surface-card overflow-hidden rounded-[20px]">
              <div className="px-4 pt-3 pb-1 text-[11px] font-bold uppercase tracking-wider pm-text-tertiary">
                Toda la configuración
              </div>
              <div className="divide-y divide-white/[0.06]">
                {(
                  [
                    {
                      id: 'apariencia',
                      title: 'Apariencia y Temas',
                      sub: 'Liquid Glass, colores, letras y fondos',
                      icon: <Palette className="h-4 w-4 text-rose-400" />,
                    },
                    {
                      id: 'audio',
                      title: 'Audio y Ecualizador',
                      sub: 'Calidad, EQ de 10 bandas, balance y crossfade',
                      icon: <Sliders className="h-4 w-4 text-amber-400" />,
                    },
                    {
                      id: 'dj',
                      title: 'Sesión DJ AutoMix',
                      sub: 'Transiciones, beats y stems automáticos',
                      icon: <Disc3 className="h-4 w-4 text-purple-400" />,
                    },
                    {
                      id: 'reproduccion',
                      title: 'Reproducción y Temporizador',
                      sub: 'Autoplay, velocidad y temporizador de apagado',
                      icon: <Timer className="h-4 w-4 text-cyan-400" />,
                    },
                    {
                      id: 'cuenta',
                      title: 'Cuenta, Perfil y Offline',
                      sub: 'Perfil público, copias de seguridad y caché offline',
                      icon: <Database className="h-4 w-4 text-emerald-400" />,
                    },
                  ] as const
                ).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => openSettingsCategory(item.id)}
                    className="pm-hover flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.06]">
                        {item.icon}
                      </span>
                      <div className="min-w-0">
                        <div className="text-[13.5px] font-bold pm-text-primary">{item.title}</div>
                        <div className="truncate text-[11.5px] pm-text-secondary">{item.sub}</div>
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 pm-text-tertiary" />
                  </button>
                ))}
              </div>
            </section>

            {authState.connected && (
              <button
                type="button"
                onClick={() => {
                  handleClose();
                  void signOutSupabase();
                }}
                className="flex w-full items-center justify-center gap-2 rounded-[16px] border border-rose-500/30 bg-rose-500/12 py-3 text-sm font-bold text-rose-400"
              >
                <LogOut className="h-4 w-4" />
                <span>Cerrar sesión actual</span>
              </button>
            )}
          </div>
        )}

        {subView === 'history' && (
          <div className="mx-auto max-w-lg space-y-3">
            <input
              type="search"
              value={historyFilter}
              onChange={(e) => setHistoryFilter(e.target.value)}
              placeholder="Filtrar historial por canción o artista…"
              className="pm-input w-full rounded-full px-4 py-2.5 text-sm"
            />
            {filteredHistory.length === 0 ? (
              <div className="pm-surface-card rounded-[18px] p-8 text-center text-sm pm-text-secondary">
                No hay canciones en tu historial reciente.
              </div>
            ) : (
              <div className="space-y-1.5">
                {filteredHistory.map((item, idx) => (
                  <button
                    key={`${item.trackId}-${item.playedAt}-${idx}`}
                    type="button"
                    onClick={() => {
                      handleClose();
                      void playTrack(
                        item.track,
                        filteredHistory.map((h) => h.track)
                      );
                    }}
                    className="pm-hover flex w-full items-center gap-3 rounded-[14px] px-2.5 py-2 text-left"
                  >
                    <TrackArtwork
                      trackId={item.trackId}
                      src={item.track.thumbnailUrl}
                      alt={item.track.title}
                      variant="list"
                      imgClassName="h-12 w-12 shrink-0 rounded-[10px] object-cover"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-bold pm-text-primary">
                        {item.track.title}
                      </div>
                      <div className="truncate text-xs pm-text-secondary">
                        {item.track.artists.map((a) => a.name).join(', ')}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <span className="block text-[11px] font-medium pm-text-tertiary">
                        {formatRelativeTimeEs(item.playedAt)}
                      </span>
                      <Play className="ml-auto mt-1 h-3.5 w-3.5 pm-text-secondary" />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {subView === 'devices' && (
          <div className="mx-auto max-w-lg space-y-4">
            <div className="pm-surface-card rounded-[18px] p-4 space-y-3">
              <div className="text-[11px] font-bold uppercase tracking-wider pm-text-tertiary">
                Este dispositivo
              </div>
              {currentDevice && (
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400">
                    {currentDevice.platform === 'windows' ? (
                      <Laptop className="h-5 w-5" />
                    ) : (
                      <Smartphone className="h-5 w-5" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-bold pm-text-primary">
                      {currentDevice.device_name}
                    </div>
                    <div className="truncate text-xs text-emerald-400">
                      Reproduciendo aquí · {currentDevice.track_title}
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="pm-surface-card rounded-[18px] p-4 space-y-2.5">
              <div className="text-[11px] font-bold uppercase tracking-wider pm-text-tertiary">
                Otros dispositivos pMusic ({peerDevices.length})
              </div>
              {peerDevices.map((dev) => (
                <div
                  key={dev.device_id}
                  className="flex items-center justify-between gap-3 rounded-[12px] bg-white/[0.04] px-3 py-2.5"
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    {dev.platform === 'windows' ? (
                      <Laptop className="h-4.5 w-4.5 shrink-0 pm-text-secondary" />
                    ) : (
                      <Smartphone className="h-4.5 w-4.5 shrink-0 pm-text-secondary" />
                    )}
                    <div className="min-w-0">
                      <div className="truncate text-xs font-bold pm-text-primary">
                        {dev.device_name}
                      </div>
                      <div className="truncate text-[11px] pm-text-tertiary">
                        {dev.track_title}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void transferPlaybackToDevice(dev.device_id)}
                    className="pm-btn-primary pm-pressable shrink-0 rounded-full px-3 py-1.5 text-[11px] font-bold"
                  >
                    Enviar aquí
                  </button>
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={() => {
                handleClose();
                void startJam();
              }}
              className="pm-btn-primary pm-pressable flex w-full items-center justify-center gap-2 rounded-[16px] py-3 text-sm font-bold"
            >
              <Radio className="h-4 w-4" />
              <span>Iniciar o gestionar Jam en vivo</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
