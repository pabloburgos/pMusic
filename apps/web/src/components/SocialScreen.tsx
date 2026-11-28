import React, { useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import {
  BarChart3,
  Calendar,
  Check,
  Clock,
  Copy,
  Disc3,
  Flame,
  Headphones,
  Link2,
  ListMusic,
  Loader2,
  Music2,
  Play,
  Plus,
  QrCode,
  Radio,
  Search,
  Sparkles,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import type { UserProfile } from '@pmusic/core';
import { getSyncSupabaseClient, usePMusicStore } from '../store/usePMusicStore.ts';
import type { TopStatsWindow } from '../lib/wrapped-stats.ts';
import { getCachedArtistArtwork } from '../utils/artist-artwork.ts';
import {
  buildJamQrImageUrl,
  buildJamShareUrl,
  buildJamTelegramUrl,
  buildJamWhatsAppUrl,
  buildPlaylistShareUrl,
  isJamQueueOpRequest,
  searchProfilesByUsername,
} from '../services/social-service.ts';
import { openExternalUrl } from '../platform/web-bridge.ts';
import { PMusicSwitch } from './PMusicSwitch.tsx';
import { TelegramIcon, WhatsAppIcon } from './SocialBrandIcons.tsx';
import { TrackArtwork } from './TrackArtwork.tsx';
import { UserAvatar } from './UserAvatar.tsx';

export const SocialScreen: React.FC = React.memo(() => {
  const {
    authState,
    userProfile,
    socialSubTab,
    friends,
    sharedPlaylists,
    shareListeningActivity,
    favoriteArtists,
    friendActivities,
    personalTopStats,
    activeJamSession,
    activeJamRole,
    activeJamRequests,
    setSocialSubTab,
    setShareListeningActivity,
    loadPersonalTopStats,
    playFriendActivityTrack,
    playFromVoiceQuery,
    openArtistDetail,
    hydrateSocialAndSubscribe,
    startJam,
    joinJamInApp,
    openJamJoinPrompt,
    leaveOrEndJam,
    approveJamRequest,
    rejectJamRequest,
    updateJamSettings,
    jamAllowGuestPlaybackControls,
    setJamAllowGuestPlaybackControls,
    setJamInviteModalOpen,
    setNowPlayingOpen,
    setNowPlayingTab,
    sendFriendRequestToUser,
    respondToFriendRequest,
    createBlendWithFriend,
    createCollaborativePlaylist,
    openSharedPlaylistDetail,
    playCollection,
    setAuthOnboardingOpen,
    showToast,
  } = usePMusicStore(
    useShallow((s) => ({
      authState: s.authState,
      userProfile: s.userProfile,
      socialSubTab: s.socialSubTab,
      friends: s.friends,
      sharedPlaylists: s.sharedPlaylists,
      shareListeningActivity: s.shareListeningActivity,
      favoriteArtists: s.favoriteArtists,
      friendActivities: s.friendActivities,
      personalTopStats: s.personalTopStats,
      activeJamSession: s.activeJamSession,
      activeJamRole: s.activeJamRole,
      activeJamRequests: s.activeJamRequests,
      jamAllowGuestPlaybackControls: s.jamAllowGuestPlaybackControls,
      setSocialSubTab: s.setSocialSubTab,
      setShareListeningActivity: s.setShareListeningActivity,
      loadPersonalTopStats: s.loadPersonalTopStats,
      playFriendActivityTrack: s.playFriendActivityTrack,
      playFromVoiceQuery: s.playFromVoiceQuery,
      openArtistDetail: s.openArtistDetail,
      hydrateSocialAndSubscribe: s.hydrateSocialAndSubscribe,
      startJam: s.startJam,
      joinJamInApp: s.joinJamInApp,
      openJamJoinPrompt: s.openJamJoinPrompt,
      leaveOrEndJam: s.leaveOrEndJam,
      approveJamRequest: s.approveJamRequest,
      rejectJamRequest: s.rejectJamRequest,
      updateJamSettings: s.updateJamSettings,
      setJamAllowGuestPlaybackControls: s.setJamAllowGuestPlaybackControls,
      setJamInviteModalOpen: s.setJamInviteModalOpen,
      setNowPlayingOpen: s.setNowPlayingOpen,
      setNowPlayingTab: s.setNowPlayingTab,
      sendFriendRequestToUser: s.sendFriendRequestToUser,
      respondToFriendRequest: s.respondToFriendRequest,
      createBlendWithFriend: s.createBlendWithFriend,
      createCollaborativePlaylist: s.createCollaborativePlaylist,
      openSharedPlaylistDetail: s.openSharedPlaylistDetail,
      playCollection: s.playCollection,
      setAuthOnboardingOpen: s.setAuthOnboardingOpen,
      showToast: s.showToast,
    }))
  );

  const [socialError, setSocialError] = useState<string | null>(null);
  const [friendSearch, setFriendSearch] = useState('');
  const [searchHits, setSearchHits] = useState<UserProfile[]>([]);
  const [searchingUsers, setSearchingUsers] = useState(false);
  const [newCollabName, setNewCollabName] = useState('');
  const [selectedFriendId, setSelectedFriendId] = useState('');
  const [jamBusy, setJamBusy] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [joinJamInput, setJoinJamInput] = useState('');
  const [topWindow, setTopWindow] = useState<TopStatsWindow>('7d');

  const sb = getSyncSupabaseClient();
  const myUserId = authState.userId;

  useEffect(() => {
    if (authState.connected && myUserId) {
      void hydrateSocialAndSubscribe();
    }
  }, [authState.connected, myUserId, hydrateSocialAndSubscribe]);

  useEffect(() => {
    if (socialSubTab === 'top') {
      void loadPersonalTopStats(topWindow);
    }
  }, [socialSubTab, topWindow, loadPersonalTopStats]);

  const handleStartJamClick = async () => {
    setJamBusy(true);
    setSocialError(null);
    try {
      await startJam({ openSheet: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudo iniciar la Jam';
      setSocialError(msg);
      showToast(msg);
    } finally {
      setJamBusy(false);
    }
  };

  const handleSearchFriends = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sb || !friendSearch.trim()) return;
    setSearchingUsers(true);
    setSocialError(null);
    try {
      const hits = await searchProfilesByUsername(sb, friendSearch, myUserId);
      setSearchHits(hits);
      if (hits.length === 0) {
        showToast('No se encontraron usuarios con ese nombre o @usuario');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error buscando usuarios';
      setSocialError(msg);
      showToast(msg);
    } finally {
      setSearchingUsers(false);
    }
  };

  const handleCreateCollab = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCollabName.trim()) return;
    try {
      const created = await createCollaborativePlaylist(
        newCollabName.trim(),
        selectedFriendId ? [selectedFriendId] : []
      );
      setNewCollabName('');
      if (created) openSharedPlaylistDetail(created.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudo crear la playlist';
      setSocialError(msg);
      showToast(msg);
    }
  };

  if (!authState.connected) {
    return (
      <div className="pm-page-enter flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
        <div className="pm-surface-card max-w-md space-y-4 rounded-3xl p-8">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-white/10">
            <Users className="h-7 w-7 pm-text-primary" />
          </div>
          <h1 className="text-2xl font-bold pm-text-primary">Social & Jam</h1>
          <p className="text-sm pm-text-secondary">
            Inicia sesión para añadir amigos por @usuario al instante, crear Blends, listas
            colaborativas y sesiones Jam integradas en tu reproductor.
          </p>
          <button
            type="button"
            onClick={() => setAuthOnboardingOpen(true)}
            className="pm-btn-primary rounded-full px-6 py-3 text-sm font-bold"
          >
            Iniciar sesión
          </button>
        </div>
      </div>
    );
  }

  const acceptedFriends = friends.filter((f) => f.status === 'accepted');
  const pendingIncoming = friends.filter((f) => f.status === 'pending' && f.isIncoming);
  const pendingOutgoing = friends.filter((f) => f.status === 'pending' && !f.isIncoming);

  return (
    <div className="pm-page-enter space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3.5">
          <UserAvatar
            src={userProfile?.avatarUrl ?? authState.avatarUrl}
            name={userProfile?.displayName ?? authState.displayName ?? 'pMusic'}
            size="md"
            showRing
          />
          <div className="min-w-0">
            <h1 className="text-[28px] font-black leading-tight tracking-tight pm-text-primary sm:text-[30px]">
              Social
            </h1>
            <p className="truncate text-xs pm-text-secondary">
              {userProfile?.username ? `@${userProfile.username}` : authState.email} · Jam en directo, amigos y listas compartidas
            </p>
          </div>
        </div>

        <div
          role="tablist"
          aria-label="Secciones de Social"
          className="pm-no-scrollbar flex w-full flex-nowrap gap-1.5 overflow-x-auto pb-0.5 sm:inline-flex sm:w-auto sm:gap-1 sm:rounded-full sm:border sm:pm-border sm:bg-white/[0.04] sm:p-1"
        >
          {[
            {
              id: 'jam' as const,
              label: activeJamSession?.active ? `Jam · ${activeJamSession.code}` : 'Jam & QR',
            },
            { id: 'amigos' as const, label: `Amigos (${acceptedFriends.length})` },
            { id: 'compartidas' as const, label: `Listas (${sharedPlaylists.length})` },
            { id: 'top' as const, label: 'Mi Top' },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={socialSubTab === tab.id}
              onClick={() => setSocialSubTab(tab.id)}
              className={`pm-compact-btn pm-pressable h-8 shrink-0 whitespace-nowrap rounded-full px-3.5 text-xs font-bold transition sm:px-4 ${
                socialSubTab === tab.id
                  ? 'pm-btn-primary shadow-sm'
                  : 'bg-white/[0.05] pm-text-secondary hover:text-white sm:bg-transparent'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {socialError && (
        <div className="rounded-2xl border border-amber-400/35 bg-amber-500/10 px-4 py-3 text-xs text-amber-200">
          {socialError}
        </div>
      )}

      {/* 1. JAM INTEGRADA EN EL REPRODUCTOR */}
      {socialSubTab === 'jam' && (
        <div className="space-y-4">
          {!activeJamSession?.active ? (
            <div className="space-y-4">
              <div className="pm-surface-card relative overflow-hidden space-y-5 rounded-[24px] border border-white/12 bg-white/[0.03] p-5 sm:p-6">
                <div className="flex items-start gap-4">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-400/30">
                    <Radio className="h-6 w-6" />
                  </div>
                  <div className="space-y-1">
                    <div className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-300">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                      TIEMPO REAL MULTIDISPOSITIVO
                    </div>
                    <h2 className="text-lg font-black tracking-tight pm-text-primary sm:text-xl">
                      Jam en directo dentro del reproductor
                    </h2>
                    <p className="text-xs leading-relaxed pm-text-secondary">
                      Tu cola se sincroniza al segundo entre móviles y PCs. Tus amigos escuchan contigo o añaden temas escaneando tu QR.
                    </p>
                  </div>
                </div>

                <label className="flex cursor-pointer items-center justify-between gap-3 rounded-2xl border border-white/10 bg-black/35 px-4 py-3">
                  <div>
                    <div className="text-xs font-bold pm-text-primary">
                      Control de reproducción por invitados
                    </div>
                    <div className="text-[11px] pm-text-secondary">
                      Permitir pausar, pasar canción y mover la barra en la app y en web
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    data-testid="social-jam-allow-controls-toggle"
                    checked={jamAllowGuestPlaybackControls}
                    onChange={(e) => setJamAllowGuestPlaybackControls(e.target.checked)}
                    className="h-4 w-4 accent-white"
                  />
                </label>

                <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
                  <button
                    type="button"
                    disabled={jamBusy}
                    onClick={() => void handleStartJamClick()}
                    className="pm-btn-primary pm-pressable inline-flex items-center justify-center gap-2 rounded-full px-6 py-3 text-sm font-bold shadow-lg disabled:opacity-50"
                  >
                    {jamBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Radio className="h-4 w-4" />}
                    Iniciar Jam y abrir Cola en vivo
                  </button>
                </div>
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  openJamJoinPrompt(joinJamInput);
                  setJoinJamInput('');
                }}
                className="pm-surface-card flex items-center gap-2 rounded-full p-1.5 pl-4"
              >
                <input
                  type="text"
                  value={joinJamInput}
                  onChange={(e) => setJoinJamInput(e.target.value.toUpperCase())}
                  placeholder="Código de Jam (ej. AB3K9P)"
                  className="min-w-0 flex-1 bg-transparent text-xs font-semibold pm-text-primary placeholder:pm-text-tertiary focus:outline-none"
                />
                <button
                  type="submit"
                  className="pm-btn-secondary pm-pressable shrink-0 rounded-full px-4 py-2 text-xs font-bold"
                >
                  Unirse
                </button>
              </form>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
              <div className="pm-surface-card flex flex-col items-center space-y-4 rounded-3xl p-6 text-center lg:col-span-5">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-3 py-1 text-[11px] font-bold text-emerald-300">
                  <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                  JAM ACTIVA · {activeJamSession.code}
                </span>

                <img
                  src={buildJamQrImageUrl(activeJamSession.code)}
                  alt={`QR Jam ${activeJamSession.code}`}
                  className="h-44 w-44 rounded-2xl border border-white/15 bg-[#050507] p-2"
                />

                <div className="w-full space-y-2">
                  <button
                    type="button"
                    onClick={() => {
                      setNowPlayingOpen(true);
                      setNowPlayingTab('Cola');
                    }}
                    className="pm-btn-primary flex w-full items-center justify-center gap-1.5 rounded-full py-2.5 text-xs font-bold"
                  >
                    <QrCode className="h-3.5 w-3.5" />
                    Abrir Cola de Jam en el reproductor
                  </button>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        void openExternalUrl(
                          buildJamWhatsAppUrl(activeJamSession.hostName, activeJamSession.code)
                        )
                      }
                      className="pm-pressable flex items-center justify-center gap-1.5 rounded-full bg-[#25D366] py-2 text-xs font-extrabold text-[#05180D]"
                    >
                      <WhatsAppIcon className="h-4 w-4" />
                      WhatsApp
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        void openExternalUrl(
                          buildJamTelegramUrl(activeJamSession.hostName, activeJamSession.code)
                        )
                      }
                      className="pm-pressable flex items-center justify-center gap-1.5 rounded-full bg-[#229ED9]/25 py-2 text-xs font-bold text-[#7DD3FC]"
                    >
                      <TelegramIcon className="h-4 w-4" />
                      Telegram
                    </button>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        void navigator.clipboard?.writeText(buildJamShareUrl(activeJamSession.code));
                        setCopiedUrl(true);
                        window.setTimeout(() => setCopiedUrl(false), 1800);
                        showToast('Enlace de Jam copiado');
                      }}
                      className="pm-btn-secondary flex flex-1 items-center justify-center gap-1.5 rounded-full py-2 text-xs font-semibold"
                    >
                      {copiedUrl ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                      {copiedUrl ? 'Copiado' : 'Copiar enlace'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void leaveOrEndJam()}
                      className="pm-btn-secondary rounded-full px-4 py-2 text-xs font-semibold text-rose-300"
                    >
                      {activeJamRole === 'host' ? 'Finalizar Jam' : 'Salir'}
                    </button>
                  </div>
                </div>
              </div>

              <div className="pm-surface-card space-y-3 rounded-3xl p-5 lg:col-span-7">
                {(() => {
                  const visibleJamReqs = activeJamRequests.filter((r) => !isJamQueueOpRequest(r));
                  return (
                    <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-bold pm-text-primary">
                    Peticiones entrantes ({visibleJamReqs.length})
                  </h3>
                  {activeJamRole === 'host' && (
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setJamAllowGuestPlaybackControls(!jamAllowGuestPlaybackControls)}
                        className="pm-btn-secondary rounded-full px-3 py-1 text-[11px] font-semibold"
                      >
                        {jamAllowGuestPlaybackControls ? 'Controles: Libres' : 'Controles: Solo tú'}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          void updateJamSettings({
                            allowGuestDirectAdd: !activeJamSession.allowGuestDirectAdd,
                          })
                        }
                        className="pm-btn-secondary rounded-full px-3 py-1 text-[11px] font-semibold"
                      >
                        {activeJamSession.allowGuestDirectAdd ? 'Modo: Directo' : 'Modo: Aprobar'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setJamInviteModalOpen(true)}
                        className="pm-btn-secondary rounded-full px-3 py-1 text-[11px] font-semibold"
                      >
                        Ver QR grande
                      </button>
                    </div>
                  )}
                </div>

                {visibleJamReqs.length === 0 ? (
                  <p className="py-10 text-center text-xs pm-text-secondary">
                    Escanea el QR o comparte el enlace: cada tema añadido entrará al instante.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {visibleJamReqs.map((req) => (
                      <div
                        key={req.id}
                        className="flex items-center gap-3 rounded-2xl border pm-border bg-white/[0.03] p-2.5"
                      >
                        {req.track?.thumbnailUrl && (
                          <img
                            src={req.track.thumbnailUrl}
                            alt=""
                            className="h-10 w-10 shrink-0 rounded-xl object-cover"
                          />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-xs font-bold pm-text-primary">
                            {req.track?.title}
                          </div>
                          <div className="mt-0.5 flex items-center gap-1.5 truncate text-[11px] pm-text-secondary">
                            <UserAvatar
                              src={req.track?.addedBy?.avatarUrl}
                              name={req.guestName}
                              size="xs"
                            />
                            <span>
                              Añadida por <strong>{req.guestName}</strong>
                            </span>
                          </div>
                        </div>
                        {req.status === 'pending' && activeJamRole === 'host' ? (
                          <div className="flex gap-1.5">
                            <button
                              type="button"
                              onClick={() => void approveJamRequest(req)}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/35"
                              aria-label="Aprobar"
                            >
                              <Check className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => void rejectJamRequest(req)}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-rose-500/20 text-rose-300 hover:bg-rose-500/35"
                              aria-label="Rechazar"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </div>
                        ) : (
                          <span className="rounded-full bg-white/8 px-2.5 py-1 text-[10px] font-bold pm-text-secondary">
                            {req.status === 'approved' ? 'En cola' : req.status === 'pending' ? 'Pendiente' : 'Rechazada'}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                    </>
                  );
                })()}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 2. AMIGOS (@usuario) EN TIEMPO REAL */}
      {socialSubTab === 'amigos' && (
        <div className="space-y-4">
          <div className="pm-surface-card flex items-center justify-between gap-3 rounded-2xl p-4">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-400">
                <Headphones className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <div className="text-xs font-bold pm-text-primary">
                  Compartir lo que escucho con amigos
                </div>
                <div className="truncate text-[11px] pm-text-secondary">
                  Muestra en vivo qué canción suena en tu sesión solo a tus amigos aceptados
                </div>
              </div>
            </div>
            <PMusicSwitch
              checked={shareListeningActivity}
              onChange={() => setShareListeningActivity(!shareListeningActivity)}
              ariaLabel="Compartir lo que escucho con amigos"
              testId="social-share-listening-toggle"
            />
          </div>

          {(() => {
            const liveList = Object.values(friendActivities);
            if (liveList.length === 0) return null;
            return (
              <div className="pm-surface-card space-y-2.5 rounded-2xl border border-emerald-400/20 bg-emerald-500/[0.05] p-4">
                <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-emerald-300">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
                  Escuchando ahora ({liveList.length})
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {liveList.map((act) => {
                    const matchedFriend = acceptedFriends.find(
                      (f) => f.otherProfile.userId === act.userId
                    );
                    const friendName =
                      act.displayName ||
                      matchedFriend?.otherProfile.displayName ||
                      (act.username ? `@${act.username}` : 'Amigo');
                    return (
                      <div
                        key={act.userId}
                        data-testid="friend-live-activity-card"
                        className="flex items-center justify-between gap-2.5 rounded-xl border pm-border bg-white/[0.03] p-2.5"
                      >
                        <div className="flex min-w-0 items-center gap-2.5">
                          <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-[9px] bg-white/[0.06]">
                            <TrackArtwork
                              trackId={act.trackId}
                              src={act.thumbnailUrl}
                              title={act.trackTitle}
                              artistName={act.trackArtist}
                              alt={act.trackTitle}
                              variant="list"
                              imgClassName="h-full w-full object-cover"
                            />
                          </div>
                          <div className="min-w-0">
                            <div className="truncate text-[11px] font-bold text-emerald-300">
                              {friendName}
                            </div>
                            <div className="truncate text-xs font-bold pm-text-primary">
                              {act.trackTitle}
                            </div>
                            <div className="truncate text-[11px] pm-text-secondary">
                              {act.trackArtist}
                            </div>
                          </div>
                        </div>
                        <button
                          type="button"
                          aria-label={`Reproducir ${act.trackTitle}`}
                          onClick={() => void playFriendActivityTrack(act)}
                          className="pm-btn-primary inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full shadow-sm"
                        >
                          <Play className="h-3.5 w-3.5 translate-x-[0.5px] fill-current" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          <form onSubmit={handleSearchFriends} className="flex gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 pm-text-tertiary" />
              <input
                type="text"
                value={friendSearch}
                onChange={(e) => setFriendSearch(e.target.value)}
                placeholder="Buscar amigo por @usuario o nombre..."
                className="pm-input w-full rounded-full py-2.5 pl-10 pr-4 text-xs"
              />
            </div>
            <button
              type="submit"
              disabled={searchingUsers}
              className="pm-btn-primary rounded-full px-5 py-2.5 text-xs font-bold"
            >
              {searchingUsers ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Buscar'}
            </button>
          </form>

          {searchHits.length > 0 && (
            <div className="pm-surface-card space-y-2 rounded-2xl p-4">
              <div className="text-[11px] font-bold uppercase tracking-wider pm-text-tertiary">
                Resultados
              </div>
              {searchHits.map((u) => {
                const alreadyFriend = friends.some((f) => f.otherProfile.userId === u.userId);
                return (
                  <div key={u.userId} className="flex items-center justify-between gap-3 py-1">
                    <div className="flex items-center gap-2.5">
                      <UserAvatar src={u.avatarUrl} name={u.displayName} size="md" showRing />
                      <div>
                        <div className="text-xs font-bold pm-text-primary">{u.displayName}</div>
                        <div className="text-[11px] pm-text-secondary">@{u.username}</div>
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={alreadyFriend}
                      onClick={async () => {
                        try {
                          await sendFriendRequestToUser(u.userId);
                          showToast(`Solicitud enviada a @${u.username}`);
                        } catch (err) {
                          showToast(err instanceof Error ? err.message : 'Error');
                        }
                      }}
                      className="pm-btn-primary inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-bold disabled:opacity-45"
                    >
                      <UserPlus className="h-3.5 w-3.5" /> {alreadyFriend ? 'En curso' : 'Añadir'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {pendingIncoming.length > 0 && (
            <div className="pm-surface-card space-y-2 rounded-2xl p-4">
              <div className="text-[11px] font-bold uppercase tracking-wider text-amber-300">
                Solicitudes pendientes ({pendingIncoming.length})
              </div>
              {pendingIncoming.map((req) => (
                <div key={req.id} className="flex items-center justify-between gap-3 py-1">
                  <div className="flex items-center gap-2.5">
                    <UserAvatar
                      src={req.otherProfile.avatarUrl}
                      name={req.otherProfile.displayName}
                      size="md"
                      showRing
                    />
                    <div>
                      <div className="text-xs font-bold pm-text-primary">
                        {req.otherProfile.displayName}
                      </div>
                      <div className="text-[11px] pm-text-secondary">@{req.otherProfile.username}</div>
                    </div>
                  </div>
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={() =>
                        void respondToFriendRequest(req.id, 'accepted', req.otherProfile.username)
                      }
                      className="pm-btn-primary rounded-full px-3 py-1.5 text-xs font-bold"
                    >
                      Aceptar
                    </button>
                    <button
                      type="button"
                      onClick={() => void respondToFriendRequest(req.id, 'declined')}
                      className="pm-btn-secondary rounded-full px-3 py-1.5 text-xs"
                    >
                      Ignorar
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {pendingOutgoing.length > 0 && (
            <div className="pm-surface-card space-y-2 rounded-2xl p-4">
              <div className="text-[11px] font-bold uppercase tracking-wider pm-text-tertiary">
                Solicitudes enviadas ({pendingOutgoing.length})
              </div>
              {pendingOutgoing.map((req) => (
                <div key={req.id} className="flex items-center justify-between gap-3 py-1">
                  <div className="flex items-center gap-2.5">
                    <UserAvatar
                      src={req.otherProfile.avatarUrl}
                      name={req.otherProfile.displayName}
                      size="sm"
                      showRing
                    />
                    <div className="text-xs pm-text-primary">
                      {req.otherProfile.displayName}{' '}
                      <span className="pm-text-secondary">@{req.otherProfile.username}</span>
                    </div>
                  </div>
                  <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-[10px] font-semibold pm-text-secondary">
                    Pendiente
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="pm-surface-card space-y-2.5 rounded-2xl p-4">
            <div className="text-[11px] font-bold uppercase tracking-wider pm-text-tertiary">
              Tus amigos ({acceptedFriends.length})
            </div>
            {acceptedFriends.length === 0 ? (
              <p className="py-6 text-center text-xs pm-text-secondary">
                Busca a tu amigo por su @usuario arriba para crear Blends y playlists colaborativas al
                instante.
              </p>
            ) : (
              acceptedFriends.map((f) => (
                <div
                  key={f.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border pm-border bg-white/[0.02] p-3"
                >
                  <div className="flex items-center gap-3">
                    <UserAvatar
                      src={f.otherProfile.avatarUrl}
                      name={f.otherProfile.displayName}
                      size="md"
                      showRing
                    />
                    <div>
                      <div className="text-sm font-bold pm-text-primary">
                        {f.otherProfile.displayName}
                      </div>
                      <div className="text-xs pm-text-secondary">@{f.otherProfile.username}</div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      const created = await createBlendWithFriend(f);
                      if (created) openSharedPlaylistDetail(created.id);
                    }}
                    className="pm-btn-primary inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-bold"
                  >
                    <Sparkles className="h-3.5 w-3.5" /> Crear Blend
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* 3. PLAYLISTS COMPARTIDAS Y BLENDS */}
      {socialSubTab === 'compartidas' && (
        <div className="space-y-4">
          <form onSubmit={handleCreateCollab} className="pm-surface-card flex flex-wrap gap-2 rounded-2xl p-4">
            <input
              type="text"
              value={newCollabName}
              onChange={(e) => setNewCollabName(e.target.value)}
              placeholder="Nombre de nueva playlist colaborativa..."
              className="pm-input min-w-[200px] flex-1 rounded-full px-4 py-2 text-xs"
            />
            {acceptedFriends.length > 0 && (
              <select
                value={selectedFriendId}
                onChange={(e) => setSelectedFriendId(e.target.value)}
                className="pm-input rounded-full px-3 py-2 text-xs"
              >
                <option value="">Con enlace / amigo...</option>
                {acceptedFriends.map((f) => (
                  <option key={f.id} value={f.otherProfile.userId}>
                    @{f.otherProfile.username}
                  </option>
                ))}
              </select>
            )}
            <button
              type="submit"
              className="pm-btn-primary inline-flex items-center gap-1 rounded-full px-4 py-2 text-xs font-bold"
            >
              <Plus className="h-3.5 w-3.5" /> Crear colaborativa
            </button>
          </form>

          {sharedPlaylists.length === 0 ? (
            <div className="pm-surface-card rounded-2xl p-8 text-center text-xs pm-text-secondary">
              <ListMusic className="mx-auto mb-2 h-7 w-7 opacity-45" />
              Tus listas colaborativas también aparecen directamente en tu Biblioteca y en la barra
              lateral. Pulsa el menú ••• dentro de cualquier playlist para hacerla colaborativa.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 sm:gap-3">
              {sharedPlaylists.map((pl) => (
                <div
                  key={pl.id}
                  data-surface="content"
                  className="pm-surface-card pm-card-lift flex flex-col justify-between gap-3 rounded-[16px] p-4"
                >
                  <button
                    type="button"
                    onClick={() => openSharedPlaylistDetail(pl.id)}
                    className="flex items-start gap-3 text-left"
                  >
                    {pl.coverUrl ? (
                      <img
                        src={pl.coverUrl}
                        alt=""
                        className="h-14 w-14 shrink-0 rounded-xl object-cover"
                      />
                    ) : (
                      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-white/10">
                        <Sparkles className="h-6 w-6 pm-text-primary" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-bold uppercase pm-text-primary">
                          {pl.kind === 'blend' ? 'Blend' : 'Colaborativa'}
                        </span>
                        {typeof pl.compatibilityScore === 'number' && (
                          <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
                            {pl.compatibilityScore}% match
                          </span>
                        )}
                      </div>
                      <h3 className="mt-1 truncate text-sm font-bold pm-text-primary">{pl.name}</h3>
                      <p className="truncate text-[11px] pm-text-secondary">
                        {pl.tracks.length} canciones · Abrir en vista de playlist
                      </p>
                    </div>
                  </button>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={pl.tracks.length === 0}
                      onClick={() => void playCollection(pl.tracks, { isPlaylist: true })}
                      className="pm-btn-primary inline-flex flex-1 items-center justify-center gap-1.5 rounded-full py-2 text-xs font-bold disabled:opacity-40"
                    >
                      <Play className="h-3.5 w-3.5 fill-current" /> Reproducir
                    </button>
                    {pl.shareCode && (
                      <button
                        type="button"
                        onClick={() => {
                          void navigator.clipboard?.writeText(buildPlaylistShareUrl(pl.shareCode!));
                          showToast('Enlace colaborativo copiado');
                        }}
                        className="pm-btn-secondary inline-flex items-center gap-1 rounded-full px-3 py-2 text-xs font-semibold"
                        title="Copiar enlace para compartir"
                      >
                        <Link2 className="h-3.5 w-3.5" /> Enlace
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 4. MI TOP SEMANAL, MENSUAL Y ANUAL (7d / 30d / year) */}
      {socialSubTab === 'top' && (
        <div data-testid="social-top-panel" className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex rounded-full border pm-border bg-white/[0.04] p-1">
              {[
                { id: '7d' as const, label: '7 días', testId: 'top-window-7d' },
                { id: '30d' as const, label: '30 días', testId: 'top-window-30d' },
                { id: 'year' as const, label: 'Este año', testId: 'top-window-year' },
              ].map((win) => (
                <button
                  key={win.id}
                  type="button"
                  data-testid={win.testId}
                  onClick={() => setTopWindow(win.id)}
                  className={`pm-compact-btn h-8 rounded-full px-3.5 text-xs font-bold transition ${
                    topWindow === win.id ? 'pm-btn-primary shadow-sm' : 'pm-text-secondary hover:text-white'
                  }`}
                >
                  {win.label}
                </button>
              ))}
            </div>
            <span className="text-[11px] font-semibold pm-text-tertiary">
              {topWindow === '7d'
                ? 'Tu semana en pMusic'
                : topWindow === '30d'
                  ? 'Tu último mes'
                  : `Tu resumen ${new Date().getFullYear()}`}
            </span>
          </div>

          {(() => {
            const stats = personalTopStats[topWindow];
            if (!stats) {
              return (
                <div className="pm-surface-card flex items-center justify-center rounded-2xl p-8 text-xs pm-text-secondary">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Calculando tus estadísticas...
                </div>
              );
            }
            if (stats.totalPlays === 0) {
              return (
                <div className="pm-surface-card rounded-2xl p-8 text-center text-xs pm-text-secondary">
                  Todavía no hay escuchas registradas en{' '}
                  {topWindow === '7d'
                    ? 'los últimos 7 días'
                    : topWindow === '30d'
                      ? 'los últimos 30 días'
                      : 'lo que va de año'}
                  .
                </div>
              );
            }

            const formatTimeBadge = (mins: number) =>
              mins >= 60 ? `${Math.floor(mins / 60)} h ${mins % 60} m` : `${mins} min`;

            const resolveTopArtistAvatar = (artistName: string, fallbackThumb?: string) => {
              const norm = artistName.trim().toLowerCase();
              const favMatch = favoriteArtists.find(
                (fa) => fa.artistName.trim().toLowerCase() === norm && fa.thumbnailUrl
              );
              return (
                favMatch?.thumbnailUrl ||
                getCachedArtistArtwork(artistName) ||
                fallbackThumb
              );
            };

            const handleOpenTopArtist = (artistName: string, thumb?: string) => {
              const norm = artistName.trim().toLowerCase();
              const favMatch = favoriteArtists.find(
                (fa) => fa.artistName.trim().toLowerCase() === norm
              );
              if (favMatch) {
                void openArtistDetail(favMatch.artistId, {
                  name: favMatch.artistName,
                  thumbnailUrl: favMatch.thumbnailUrl ?? thumb,
                });
                return;
              }
              void playFromVoiceQuery(artistName);
            };

            const leadTrack = stats.topTracks[0] ?? null;
            const leadArtist = stats.topArtists[0] ?? null;
            const leadArtistThumb = leadArtist
              ? resolveTopArtistAvatar(leadArtist.title, leadArtist.thumbnailUrl)
              : undefined;
            const heroBackdrop = leadArtistThumb || leadTrack?.thumbnailUrl;
            const dailyActivity = stats.dailyActivity ?? [];
            const peakBarMinutes = Math.max(
              1,
              ...dailyActivity.map((d) => (d.minutes > 0 ? d.minutes : d.plays))
            );
            const periodTag =
              topWindow === '7d'
                ? '7 DÍAS'
                : topWindow === '30d'
                  ? '30 DÍAS'
                  : `RESUMEN ${new Date().getFullYear()}`;

            return (
              <>
                {/* Modern pMusic Hero Spotlight (matching artist/playlist visual language) */}
                {(leadArtist || leadTrack) && (
                  <section className="relative overflow-hidden rounded-[22px] border border-white/[0.08] bg-[var(--pm-bg-canvas)] p-4 shadow-[0_18px_46px_rgba(0,0,0,0.45)] sm:p-5">
                    {heroBackdrop && (
                      <>
                        <img
                          src={heroBackdrop}
                          alt=""
                          aria-hidden="true"
                          className="pointer-events-none absolute inset-0 h-full w-full scale-125 object-cover opacity-40 blur-3xl saturate-150"
                        />
                        <div
                          aria-hidden="true"
                          className="pointer-events-none absolute inset-0 bg-gradient-to-br from-black/50 via-[#0a0a0f]/75 to-[#08080c]/95"
                        />
                      </>
                    )}
                    <div className="relative z-10 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-[0.14em] text-white/70">
                          <BarChart3 className="h-3.5 w-3.5" />
                          <span>{periodTag} EN PMUSIC</span>
                        </span>
                        <span className="tabular-nums text-[11px] font-semibold text-white/65">
                          {formatTimeBadge(stats.totalMinutes)} · {stats.totalPlays} escuchas
                        </span>
                      </div>

                      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                        {leadArtist && (
                          <button
                            type="button"
                            onClick={() => handleOpenTopArtist(leadArtist.title, leadArtistThumb)}
                            className="pm-pressable group flex items-center gap-3 rounded-[16px] border border-white/10 bg-white/[0.06] p-3 text-left backdrop-blur-md transition hover:bg-white/[0.11]"
                          >
                            <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-full ring-1 ring-white/20">
                              <TrackArtwork
                                src={leadArtistThumb}
                                artistName={leadArtist.title}
                                alt={leadArtist.title}
                                variant="list"
                                imgClassName="h-full w-full object-cover object-top"
                              />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-white/60">
                                Artista #1
                              </div>
                              <div className="truncate text-[16px] font-black leading-tight text-white">
                                {leadArtist.title}
                              </div>
                              <div className="tabular-nums truncate text-[11.5px] text-white/70">
                                {leadArtist.minutes} min · {leadArtist.plays} rep
                              </div>
                            </div>
                          </button>
                        )}

                        {leadTrack && (
                          <button
                            type="button"
                            onClick={() =>
                              void playFromVoiceQuery(
                                `${leadTrack.title} ${leadTrack.subtitle ?? ''}`.trim()
                              )
                            }
                            className="pm-pressable group flex items-center gap-3 rounded-[16px] border border-white/10 bg-white/[0.06] p-3 text-left backdrop-blur-md transition hover:bg-white/[0.11]"
                          >
                            <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-[11px] ring-1 ring-white/20">
                              <TrackArtwork
                                trackId={leadTrack.key}
                                src={leadTrack.thumbnailUrl}
                                title={leadTrack.title}
                                artistName={leadTrack.subtitle}
                                alt={leadTrack.title}
                                variant="list"
                                imgClassName="h-full w-full object-cover"
                              />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-white/60">
                                Canción #1
                              </div>
                              <div className="truncate text-[16px] font-black leading-tight text-white">
                                {leadTrack.title}
                              </div>
                              <div className="truncate text-[11.5px] text-white/70">
                                {leadTrack.subtitle} · {leadTrack.plays} rep
                              </div>
                            </div>
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-black shadow">
                              <Play className="h-3.5 w-3.5 translate-x-[0.5px] fill-current" />
                            </span>
                          </button>
                        )}
                      </div>
                    </div>
                  </section>
                )}

                {/* Core Listening Stats Grid */}
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                  <div className="pm-surface-card rounded-[16px] p-3.5">
                    <div className="flex items-center gap-1.5 text-[11px] font-semibold pm-text-tertiary">
                      <Clock className="h-3.5 w-3.5" /> Tiempo
                    </div>
                    <div className="tabular-nums mt-1 text-xl font-black pm-text-primary sm:text-2xl">
                      {formatTimeBadge(stats.totalMinutes)}
                    </div>
                  </div>
                  <div className="pm-surface-card rounded-[16px] p-3.5">
                    <div className="flex items-center gap-1.5 text-[11px] font-semibold pm-text-tertiary">
                      <Flame className="h-3.5 w-3.5" /> Escuchas
                    </div>
                    <div className="tabular-nums mt-1 text-xl font-black pm-text-primary sm:text-2xl">
                      {stats.totalPlays}
                    </div>
                  </div>
                  <div className="pm-surface-card rounded-[16px] p-3.5">
                    <div className="flex items-center gap-1.5 text-[11px] font-semibold pm-text-tertiary">
                      <Users className="h-3.5 w-3.5" /> Artistas
                    </div>
                    <div className="tabular-nums mt-1 text-xl font-black pm-text-primary sm:text-2xl">
                      {stats.uniqueArtists}
                    </div>
                  </div>
                  <div className="pm-surface-card rounded-[16px] p-3.5">
                    <div className="flex items-center gap-1.5 text-[11px] font-semibold pm-text-tertiary">
                      <Calendar className="h-3.5 w-3.5" /> Días activos
                    </div>
                    <div className="tabular-nums mt-1 text-xl font-black pm-text-primary sm:text-2xl">
                      {stats.activeDays ?? 0}
                    </div>
                  </div>
                </div>

                {/* Mini-Wrapped Habits & Weekly Rhythm */}
                {(dailyActivity.length > 0 || (stats.topGenres && stats.topGenres.length > 0)) && (
                  <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
                    {dailyActivity.length > 0 && (
                      <div className="pm-surface-card rounded-[18px] p-4 lg:col-span-5">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-bold uppercase tracking-wider pm-text-tertiary">
                            Ritmo semanal
                          </span>
                          {stats.avgMinutesPerActiveDay > 0 && (
                            <span className="tabular-nums text-[11px] font-semibold pm-text-secondary">
                              ~{stats.avgMinutesPerActiveDay} min/día
                            </span>
                          )}
                        </div>
                        <div className="mt-4 flex h-20 items-end justify-between gap-2 px-1">
                          {dailyActivity.map((day) => {
                            const val = day.minutes > 0 ? day.minutes : day.plays;
                            const pct =
                              val > 0 ? Math.max(14, Math.round((val / peakBarMinutes) * 100)) : 6;
                            return (
                              <div
                                key={day.label}
                                className="flex flex-1 flex-col items-center gap-1.5"
                                title={`${day.label}: ${day.minutes} min · ${day.plays} rep`}
                              >
                                <div className="flex h-14 w-full items-end justify-center">
                                  <div
                                    className={`w-full max-w-[18px] rounded-full transition-all ${
                                      val > 0 ? 'bg-white/85' : 'bg-white/10'
                                    }`}
                                    style={{ height: `${pct}%` }}
                                  />
                                </div>
                                <span className="text-[10px] font-bold pm-text-tertiary">
                                  {day.label}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    <div className="pm-surface-card flex flex-col justify-between gap-3 rounded-[18px] p-4 lg:col-span-7">
                      <div className="flex flex-wrap gap-2">
                        <div className="rounded-[12px] bg-white/[0.04] px-3 py-2">
                          <div className="text-[10px] font-bold uppercase tracking-wider pm-text-tertiary">
                            Racha máx.
                          </div>
                          <div className="tabular-nums text-sm font-black pm-text-primary">
                            {stats.longestStreakDays ?? 0}{' '}
                            {stats.longestStreakDays === 1 ? 'día' : 'días'}
                          </div>
                        </div>
                        {stats.peakTimeOfDay && (
                          <div className="rounded-[12px] bg-white/[0.04] px-3 py-2">
                            <div className="text-[10px] font-bold uppercase tracking-wider pm-text-tertiary">
                              Tu momento
                            </div>
                            <div className="text-sm font-black pm-text-primary">
                              {stats.peakTimeOfDay}
                            </div>
                          </div>
                        )}
                        {stats.peakDayOfWeek && (
                          <div className="rounded-[12px] bg-white/[0.04] px-3 py-2">
                            <div className="text-[10px] font-bold uppercase tracking-wider pm-text-tertiary">
                              Día más fuerte
                            </div>
                            <div className="text-sm font-black pm-text-primary">
                              {stats.peakDayOfWeek}
                            </div>
                          </div>
                        )}
                        <div className="rounded-[12px] bg-white/[0.04] px-3 py-2">
                          <div className="text-[10px] font-bold uppercase tracking-wider pm-text-tertiary">
                            Temas distintos
                          </div>
                          <div className="tabular-nums text-sm font-black pm-text-primary">
                            {stats.uniqueTracks}
                          </div>
                        </div>
                      </div>

                      {stats.topGenres.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="inline-flex items-center gap-1 text-[10.5px] font-bold uppercase tracking-wider pm-text-tertiary">
                            <Disc3 className="h-3 w-3" /> Géneros:
                          </span>
                          {stats.topGenres.slice(0, 4).map((g) => (
                            <span
                              key={g.genre}
                              className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-0.5 text-[11px] font-semibold pm-text-primary"
                            >
                              <span>{g.genre}</span>
                              <span className="tabular-nums text-[10px] pm-text-tertiary">
                                {g.percent}%
                              </span>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Top 10 Canciones & Top 10 Artistas (fixed square/circle artwork frames) */}
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <div className="pm-surface-card space-y-2.5 rounded-[18px] p-4">
                    <div className="flex items-center justify-between">
                      <div className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider pm-text-tertiary">
                        <Music2 className="h-3.5 w-3.5" />
                        <span>
                          Top {Math.min(10, stats.topTracks.length)} Canciones (
                          {topWindow === '7d' ? '7 días' : topWindow === '30d' ? '30 días' : 'Año'})
                        </span>
                      </div>
                    </div>
                    <div className="space-y-1">
                      {stats.topTracks.slice(0, 10).map((item, idx) => (
                        <button
                          key={item.key}
                          type="button"
                          onClick={() =>
                            void playFromVoiceQuery(
                              `${item.title} ${item.subtitle ?? ''}`.trim()
                            )
                          }
                          className="pm-hover flex w-full items-center justify-between gap-2.5 rounded-[12px] px-2 py-1.5 text-left"
                        >
                          <div className="flex min-w-0 flex-1 items-center gap-2.5">
                            <span className="tabular-nums w-5 shrink-0 text-center text-xs font-black pm-text-tertiary">
                              {idx + 1}
                            </span>
                            <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-[9px] bg-white/[0.06]">
                              <TrackArtwork
                                trackId={item.key}
                                src={item.thumbnailUrl}
                                title={item.title}
                                artistName={item.subtitle}
                                alt={item.title}
                                variant="list"
                                imgClassName="h-full w-full object-cover"
                              />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-[13px] font-bold pm-text-primary">
                                {item.title}
                              </div>
                              <div className="truncate text-[11px] pm-text-secondary">
                                {item.subtitle}
                              </div>
                            </div>
                          </div>
                          <span className="tabular-nums shrink-0 whitespace-nowrap text-[11px] font-semibold pm-text-tertiary">
                            {item.plays} rep · {item.minutes}m
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="pm-surface-card space-y-2.5 rounded-[18px] p-4">
                    <div className="flex items-center justify-between">
                      <div className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider pm-text-tertiary">
                        <Users className="h-3.5 w-3.5" />
                        <span>
                          Top {Math.min(10, stats.topArtists.length)} Artistas (
                          {topWindow === '7d' ? '7 días' : topWindow === '30d' ? '30 días' : 'Año'})
                        </span>
                      </div>
                    </div>
                    <div className="space-y-1">
                      {stats.topArtists.slice(0, 10).map((artist, idx) => {
                        const resolvedArtistImg = resolveTopArtistAvatar(
                          artist.title,
                          artist.thumbnailUrl
                        );
                        return (
                          <button
                            key={artist.key}
                            type="button"
                            onClick={() =>
                              handleOpenTopArtist(artist.title, resolvedArtistImg)
                            }
                            className="pm-hover flex w-full items-center justify-between gap-2.5 rounded-[12px] px-2 py-1.5 text-left"
                          >
                            <div className="flex min-w-0 flex-1 items-center gap-2.5">
                              <span className="tabular-nums w-5 shrink-0 text-center text-xs font-black pm-text-tertiary">
                                {idx + 1}
                              </span>
                              <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-full bg-white/[0.06]">
                                <TrackArtwork
                                  src={resolvedArtistImg}
                                  artistName={artist.title}
                                  alt={artist.title}
                                  variant="list"
                                  imgClassName="h-full w-full object-cover object-top"
                                />
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-[13px] font-bold pm-text-primary">
                                  {artist.title}
                                </div>
                              </div>
                            </div>
                            <span className="tabular-nums shrink-0 whitespace-nowrap text-[11px] font-semibold pm-text-tertiary">
                              {artist.minutes} min · {artist.plays} rep
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
});
SocialScreen.displayName = 'SocialScreen';
