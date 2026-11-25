import React, { useEffect, useState } from 'react';
import {
  Check,
  Copy,
  Link2,
  ListMusic,
  Loader2,
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
import {
  buildJamQrImageUrl,
  buildJamShareUrl,
  buildPlaylistShareUrl,
  searchProfilesByUsername,
} from '../services/social-service.ts';
import { UserAvatar } from './UserAvatar.tsx';

export const SocialScreen: React.FC = () => {
  const {
    authState,
    userProfile,
    socialSubTab,
    friends,
    sharedPlaylists,
    activeJamSession,
    activeJamRole,
    activeJamRequests,
    setSocialSubTab,
    hydrateSocialAndSubscribe,
    startJam,
    joinJamInApp,
    leaveOrEndJam,
    approveJamRequest,
    rejectJamRequest,
    updateJamSettings,
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
  } = usePMusicStore();

  const [socialError, setSocialError] = useState<string | null>(null);
  const [friendSearch, setFriendSearch] = useState('');
  const [searchHits, setSearchHits] = useState<UserProfile[]>([]);
  const [searchingUsers, setSearchingUsers] = useState(false);
  const [newCollabName, setNewCollabName] = useState('');
  const [selectedFriendId, setSelectedFriendId] = useState('');
  const [jamBusy, setJamBusy] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [joinJamInput, setJoinJamInput] = useState('');

  const sb = getSyncSupabaseClient();
  const myUserId = authState.userId;

  useEffect(() => {
    if (authState.connected && myUserId) {
      void hydrateSocialAndSubscribe();
    }
  }, [authState.connected, myUserId, hydrateSocialAndSubscribe]);

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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[24px] font-bold tracking-tight pm-text-primary sm:text-[28px]">
            Social
          </h1>
          <p className="text-xs pm-text-secondary">
            {userProfile?.username ? `@${userProfile.username}` : authState.email} · Tiempo real entre
            amigos, Jam en vivo y listas compartidas
          </p>
        </div>

        <div className="inline-flex rounded-full border pm-border bg-white/[0.04] p-1">
          {[
            {
              id: 'jam' as const,
              label: activeJamSession?.active ? `Jam · ${activeJamSession.code}` : 'Jam & QR',
            },
            { id: 'amigos' as const, label: `Amigos (${acceptedFriends.length})` },
            { id: 'compartidas' as const, label: `Compartidas (${sharedPlaylists.length})` },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setSocialSubTab(tab.id)}
              className={`rounded-full px-3.5 py-1.5 text-xs font-bold transition ${
                socialSubTab === tab.id ? 'pm-btn-primary' : 'pm-text-secondary hover:text-white'
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
              <div className="pm-surface-card space-y-5 rounded-3xl p-6">
                <div className="flex items-start gap-4">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-400">
                    <Radio className="h-6 w-6" />
                  </div>
                  <div className="space-y-1">
                    <h2 className="text-lg font-bold pm-text-primary">
                      Jam en directo dentro del reproductor
                    </h2>
                    <p className="text-xs pm-text-secondary">
                      Tu cola normal se transforma en una Cola de Jam en tiempo real. Tus amigos con la
                      app escuchan y añaden con su cuenta, y los invitados desde la web añaden
                      canciones al instante con el enlace o QR.
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  disabled={jamBusy}
                  onClick={() => void handleStartJamClick()}
                  className="pm-btn-primary inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-bold disabled:opacity-50"
                >
                  {jamBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Radio className="h-4 w-4" />}
                  Iniciar Jam y abrir Cola en vivo
                </button>
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void joinJamInApp(joinJamInput);
                  setJoinJamInput('');
                }}
                className="pm-surface-card flex flex-wrap items-center gap-2 rounded-2xl p-4"
              >
                <input
                  type="text"
                  value={joinJamInput}
                  onChange={(e) => setJoinJamInput(e.target.value.toUpperCase())}
                  placeholder="¿Tienes un código de Jam? Ej: AB3K9P"
                  className="pm-input min-w-[200px] flex-1 rounded-full px-4 py-2 text-xs"
                />
                <button
                  type="submit"
                  className="pm-btn-secondary rounded-full px-4 py-2 text-xs font-bold"
                >
                  Unirse desde mi cuenta
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
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-bold pm-text-primary">
                    Peticiones entrantes ({activeJamRequests.length})
                  </h3>
                  {activeJamRole === 'host' && (
                    <div className="flex items-center gap-2">
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

                {activeJamRequests.length === 0 ? (
                  <p className="py-10 text-center text-xs pm-text-secondary">
                    Escanea el QR o comparte el enlace: cada tema añadido entrará al instante.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {activeJamRequests.map((req) => (
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
              </div>
            </div>
          )}
        </div>
      )}

      {/* 2. AMIGOS (@usuario) EN TIEMPO REAL */}
      {socialSubTab === 'amigos' && (
        <div className="space-y-4">
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
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {sharedPlaylists.map((pl) => (
                <div
                  key={pl.id}
                  className="pm-surface-card flex flex-col justify-between gap-3 rounded-2xl p-4"
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
    </div>
  );
};
