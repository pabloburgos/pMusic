import React, { useEffect } from 'react';
import { Bell, CheckCheck, Disc3, Loader2, Play, Radio, RefreshCw, X } from 'lucide-react';
import { usePMusicStore } from '../store/usePMusicStore.ts';
import { PMusicSwitch } from './PMusicSwitch.tsx';
import { TrackArtwork } from './TrackArtwork.tsx';

function formatReleaseDateChip(iso: string): string {
  if (!iso) return 'Reciente';
  const today = new Date();
  const todayIso = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, '0')}-${String(today.getUTCDate()).padStart(2, '0')}`;
  if (iso === todayIso) return 'Hoy';
  const diffDays = Math.round(
    (Date.parse(`${todayIso}T00:00:00Z`) - Date.parse(`${iso}T00:00:00Z`)) / 86_400_000
  );
  if (diffDays === 1) return 'Ayer';
  if (diffDays > 1 && diffDays <= 14) return `Hace ${diffDays} días`;
  return iso;
}

export const ReleaseNotificationsModal: React.FC = React.memo(() => {
  const open = usePMusicStore((s) => s.notificationsPanelOpen);
  if (!open) return null;
  return <ReleaseNotificationsModalInner />;
});
ReleaseNotificationsModal.displayName = 'ReleaseNotificationsModal';

const ReleaseNotificationsModalInner: React.FC = () => {
  const {
    setNotificationsPanelOpen,
    releaseNotifications,
    releaseNotificationsEnabled,
    releaseNotificationsChecking,
    setReleaseNotificationsEnabled,
    checkNewArtistReleases,
    markReleaseNotificationRead,
    markAllReleaseNotificationsRead,
    playReleaseNotification,
    globalActiveJams,
    activeJamSession,
    authState,
    openJamJoinPrompt,
    refreshGlobalActiveJams,
  } = usePMusicStore();

  useEffect(() => {
    void refreshGlobalActiveJams();
  }, [refreshGlobalActiveJams]);

  const joinableJams = globalActiveJams.filter(
    (j) => j.active && j.code !== activeJamSession?.code && j.hostUserId !== authState.userId
  );
  const unreadCount = releaseNotifications.filter((n) => !n.read).length;

  return (
    <div className="fixed inset-0 z-[74] flex items-center justify-center p-4">
      <div
        aria-hidden="true"
        onClick={() => setNotificationsPanelOpen(false)}
        className="pm-spotlight-backdrop absolute inset-0 bg-black/70 backdrop-blur-sm"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Novedades de tus artistas"
        data-testid="release-notifications-modal"
        className="pm-glass-frosted-neutral pm-hud-dark pm-modal-pop relative z-10 flex max-h-[84vh] w-full max-w-lg flex-col overflow-hidden rounded-[26px] border border-white/15 shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 text-white">
              <Bell className="h-4.5 w-4.5" />
            </div>
            <div>
              <h3 className="text-base font-extrabold tracking-tight text-white">
                Notificaciones
              </h3>
              <p className="text-[11px] text-white/65">
                {joinableJams.length > 0
                  ? `${joinableJams.length} Jam${joinableJams.length === 1 ? '' : 's'} en directo`
                  : unreadCount > 0
                    ? `${unreadCount} lanzamiento${unreadCount === 1 ? '' : 's'} sin leer`
                    : 'Jams en directo y estrenos de tus artistas'}
              </p>
            </div>
          </div>

          <button
            type="button"
            aria-label="Cerrar notificaciones"
            onClick={() => setNotificationsPanelOpen(false)}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white/80 hover:bg-white/20 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 bg-white/[0.03] px-5 py-3">
          <div className="flex items-center gap-2.5">
            <span className="text-xs font-semibold text-white/85">Avisos activos</span>
            <PMusicSwitch
              checked={releaseNotificationsEnabled}
              onChange={() => setReleaseNotificationsEnabled(!releaseNotificationsEnabled)}
              ariaLabel="Activar avisos de nuevos lanzamientos"
              testId="notifications-modal-toggle"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={releaseNotificationsChecking}
              onClick={() => {
                void checkNewArtistReleases(true);
                void refreshGlobalActiveJams();
              }}
              className="pm-pressable inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-white/20 disabled:opacity-50"
            >
              {releaseNotificationsChecking ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              Buscar ahora
            </button>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={() => markAllReleaseNotificationsRead()}
                className="pm-pressable inline-flex items-center gap-1 rounded-full bg-white px-3 py-1.5 text-[11px] font-bold text-[#070709]"
              >
                <CheckCheck className="h-3.5 w-3.5" />
                Marcar leídas
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-4 pm-no-scrollbar">
          {/* Global Active Jams across pMusic */}
          {joinableJams.length > 0 && (
            <section data-testid="notifications-live-jams-section" className="space-y-2">
              <div className="flex items-center gap-1.5 px-1 text-[10.5px] font-bold uppercase tracking-wider text-emerald-300">
                <Radio className="h-3 w-3 animate-pulse" />
                <span>Jams activas en pMusic ({joinableJams.length})</span>
              </div>
              {joinableJams.map((jam) => (
                <div
                  key={`notif-jam-${jam.code}`}
                  data-testid={`notifications-jam-card-${jam.code}`}
                  className="flex items-center justify-between gap-3 rounded-2xl border border-emerald-400/25 bg-emerald-500/[0.08] p-2.5"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-xl bg-black/50">
                      {jam.currentTrack ? (
                        <TrackArtwork
                          trackId={jam.currentTrack.id}
                          src={jam.currentTrack.thumbnailUrl}
                          title={jam.currentTrack.title}
                          artistName={jam.currentTrack.artists?.[0]?.name}
                          alt={jam.currentTrack.title}
                          variant="mini"
                          imgClassName="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-emerald-300">
                          <Radio className="h-4 w-4" />
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-400 animate-pulse" />
                        <span className="truncate text-[13px] font-extrabold text-white">
                          Jam de {jam.hostName}
                        </span>
                      </div>
                      <div className="truncate text-xs text-white/75">
                        {jam.currentTrack?.title ?? 'Cola compartida en directo'}
                      </div>
                      <div className="mt-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-300/90">
                        Código {jam.code} · {jam.queue.length} temas
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    data-testid={`notifications-jam-join-${jam.code}`}
                    onClick={() => {
                      setNotificationsPanelOpen(false);
                      openJamJoinPrompt(jam.code);
                    }}
                    className="pm-pressable shrink-0 rounded-full bg-white px-4 py-2 text-xs font-extrabold text-[#070709] shadow-md hover:opacity-90"
                  >
                    Unirse
                  </button>
                </div>
              ))}
            </section>
          )}

          {releaseNotifications.length === 0 && joinableJams.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/[0.07] text-white/60">
                <Disc3 className="h-6 w-6" />
              </div>
              <div className="space-y-1">
                <div className="text-sm font-bold text-white">
                  Sin estrenos ni Jams activas
                </div>
                <p className="max-w-xs text-xs text-white/65">
                  Cuando alguien abra una Jam o tus artistas favoritos lancen música nueva, aparecerá aquí al instante.
                </p>
              </div>
            </div>
          ) : (
            releaseNotifications.map((item) => (
              <div
                key={item.id}
                onClick={() => markReleaseNotificationRead(item.id)}
                className={`flex items-center justify-between gap-3 rounded-2xl border p-2.5 transition ${
                  item.read
                    ? 'border-white/10 bg-white/[0.03]'
                    : 'border-white/25 bg-white/[0.08]'
                }`}
              >
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-black/50">
                    <TrackArtwork
                      trackId={item.trackId}
                      src={item.coverUrl}
                      title={item.title}
                      artistName={item.artistName}
                      artistId={item.artistId}
                      alt={item.title}
                      variant="mini"
                      imgClassName="h-full w-full object-cover"
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      {!item.read && (
                        <span className="h-2 w-2 shrink-0 rounded-full bg-white" />
                      )}
                      <span className="truncate text-[13px] font-extrabold text-white">
                        {item.title}
                      </span>
                    </div>
                    <div className="truncate text-xs text-white/75">{item.artistName}</div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-[10px] font-semibold text-white/55">
                      <span className="rounded-full bg-white/10 px-2 py-0.5 uppercase tracking-wider text-white/80">
                        {item.recordType === 'album'
                          ? 'Álbum'
                          : item.recordType === 'ep'
                            ? 'EP'
                            : 'Single'}
                      </span>
                      <span>{formatReleaseDateChip(item.releaseDate)}</span>
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  aria-label={`Reproducir ${item.title}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    void playReleaseNotification(item);
                  }}
                  className="pm-pressable inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-[#070709] shadow-md hover:opacity-90"
                >
                  <Play className="ml-0.5 h-4 w-4 fill-current" />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
