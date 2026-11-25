import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  Copy,
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
  addTrackToSharedPlaylist,
  buildJamQrImageUrl,
  buildJamShareUrl,
  computeBlendScoreAndTracks,
  createJamSession,
  createSharedPlaylist,
  fetchJamRequests,
  listFriendships,
  listSharedPlaylists,
  respondFriendRequest,
  searchProfilesByUsername,
  sendFriendRequest,
  updateJamRequestStatus,
  updateJamSessionState,
  type FriendRecord,
  type JamRequestRecord,
  type JamSessionRecord,
  type SharedPlaylistRecord,
} from '../services/social-service.ts';

type SocialSubTab = 'jam' | 'amigos' | 'compartidas';

export const SocialScreen: React.FC = () => {
  const {
    authState,
    userProfile,
    currentTrack,
    queue,
    isPlaying,
    likedTracks,
    playTrack,
    addToQueue,
    setAuthOnboardingOpen,
    showToast,
  } = usePMusicStore();

  const [subTab, setSubTab] = useState<SocialSubTab>('jam');

  // Friends state
  const [friendSearch, setFriendSearch] = useState('');
  const [searchHits, setSearchHits] = useState<UserProfile[]>([]);
  const [searchingUsers, setSearchingUsers] = useState(false);
  const [friends, setFriends] = useState<FriendRecord[]>([]);
  const [sharedPlaylists, setSharedPlaylists] = useState<SharedPlaylistRecord[]>([]);
  const [newCollabName, setNewCollabName] = useState('');
  const [selectedFriendId, setSelectedFriendId] = useState('');

  // Jam state
  const [jamSession, setJamSession] = useState<JamSessionRecord | null>(null);
  const [jamRequests, setJamRequests] = useState<JamRequestRecord[]>([]);
  const [allowDirectAdd, setAllowDirectAdd] = useState(true);
  const [maxPerGuest, setMaxPerGuest] = useState<number>(0);
  const [jamBusy, setJamBusy] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const processedRequestIdsRef = useRef<Set<string>>(new Set());

  const sb = getSyncSupabaseClient();
  const myUserId = authState.userId;

  const refreshSocialData = async () => {
    if (!sb || !myUserId || !authState.connected) return;
    const [fList, spList] = await Promise.all([
      listFriendships(sb, myUserId),
      listSharedPlaylists(sb, myUserId),
    ]);
    setFriends(fList);
    setSharedPlaylists(spList);
  };

  useEffect(() => {
    void refreshSocialData();
  }, [authState.connected, myUserId]);

  // Keep active Jam session synced with live playback & auto-ingest guest requests
  useEffect(() => {
    if (!sb || !jamSession?.active) return;
    void updateJamSessionState(sb, jamSession.code, {
      currentTrack,
      queue,
      isPlaying,
      allowGuestDirectAdd: allowDirectAdd,
      maxRequestsPerGuest: maxPerGuest,
    });
  }, [sb, jamSession?.code, jamSession?.active, currentTrack?.id, isPlaying, allowDirectAdd, maxPerGuest, queue.length]);

  useEffect(() => {
    if (!sb || !jamSession?.active) return;
    let alive = true;
    const poll = async () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      const reqs = await fetchJamRequests(sb, jamSession.code);
      if (!alive) return;
      setJamRequests(reqs);
      for (const req of reqs) {
        if (req.status === 'approved' && !processedRequestIdsRef.current.has(req.id)) {
          processedRequestIdsRef.current.add(req.id);
          if (req.track?.id) {
            addToQueue(req.track);
            showToast(`${req.guestName} añadió "${req.track.title}" a la cola`);
          }
        }
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 3500);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [sb, jamSession?.code, jamSession?.active, addToQueue, showToast]);

  const handleStartJam = async () => {
    if (!sb || !myUserId) return;
    setJamBusy(true);
    try {
      const created = await createJamSession(sb, {
        hostUserId: myUserId,
        hostName: userProfile?.displayName || userProfile?.username || 'pMusic',
        currentTrack,
        queue,
        isPlaying,
        allowGuestDirectAdd: allowDirectAdd,
        maxRequestsPerGuest: maxPerGuest,
      });
      processedRequestIdsRef.current.clear();
      setJamSession(created);
      setJamRequests([]);
      showToast(`Jam ${created.code} iniciada — comparte el QR`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'No se pudo iniciar la Jam');
    } finally {
      setJamBusy(false);
    }
  };

  const handleStopJam = async () => {
    if (!sb || !jamSession) return;
    await updateJamSessionState(sb, jamSession.code, { active: false });
    setJamSession(null);
    setJamRequests([]);
    showToast('Sala Jam finalizada');
  };

  const handleApproveRequest = async (req: JamRequestRecord) => {
    if (!sb) return;
    await updateJamRequestStatus(sb, req.id, 'approved');
    processedRequestIdsRef.current.add(req.id);
    if (req.track?.id) addToQueue(req.track);
    setJamRequests((prev) =>
      prev.map((item) => (item.id === req.id ? { ...item, status: 'approved' } : item))
    );
    showToast(`"${req.track.title}" añadida a la cola`);
  };

  const handleRejectRequest = async (req: JamRequestRecord) => {
    if (!sb) return;
    await updateJamRequestStatus(sb, req.id, 'rejected');
    setJamRequests((prev) =>
      prev.map((item) => (item.id === req.id ? { ...item, status: 'rejected' } : item))
    );
  };

  const handleSearchFriends = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sb || !friendSearch.trim()) return;
    setSearchingUsers(true);
    try {
      const hits = await searchProfilesByUsername(sb, friendSearch, myUserId);
      setSearchHits(hits);
    } finally {
      setSearchingUsers(false);
    }
  };

  const handleCreateBlend = async (friend: FriendRecord) => {
    if (!sb || !myUserId) return;
    const baseTracks = [
      ...likedTracks.map((l) => l.track),
      ...queue,
    ];
    const { score, tracks } = computeBlendScoreAndTracks(baseTracks, friend.otherProfile.username);
    try {
      const created = await createSharedPlaylist(sb, {
        ownerId: myUserId,
        name: `Blend · ${userProfile?.displayName || 'Tú'} + ${friend.otherProfile.displayName}`,
        description: `Mezcla automática con @${friend.otherProfile.username} (${score}% de compatibilidad)`,
        kind: 'blend',
        memberIds: [friend.otherProfile.userId],
        tracks,
        compatibilityScore: score,
      });
      setSharedPlaylists((prev) => [created, ...prev]);
      setSubTab('compartidas');
      showToast(`Blend creado (${score}% de match)`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'No se pudo crear el Blend');
    }
  };

  const handleCreateCollab = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sb || !myUserId || !newCollabName.trim()) return;
    try {
      const created = await createSharedPlaylist(sb, {
        ownerId: myUserId,
        name: newCollabName.trim(),
        description: 'Playlist colaborativa en pMusic',
        kind: 'collab',
        memberIds: selectedFriendId ? [selectedFriendId] : [],
        tracks: currentTrack ? [currentTrack] : [],
      });
      setSharedPlaylists((prev) => [created, ...prev]);
      setNewCollabName('');
      showToast(`Playlist colaborativa "${created.name}" creada`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'No se pudo crear la playlist');
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
            Inicia sesión para añadir amigos por @usuario, crear Blends, playlists colaborativas y
            lanzar salas Jam con código QR.
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

  return (
    <div className="pm-page-enter space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[24px] font-bold tracking-tight pm-text-primary sm:text-[28px]">
            Social
          </h1>
          <p className="text-xs pm-text-secondary">
            {userProfile?.username ? `@${userProfile.username}` : authState.email} · Jam Web con QR,
            Amigos y Blend
          </p>
        </div>

        <div className="inline-flex rounded-full border pm-border bg-white/[0.04] p-1">
          {[
            { id: 'jam' as const, label: 'Jam & QR' },
            { id: 'amigos' as const, label: `Amigos (${acceptedFriends.length})` },
            { id: 'compartidas' as const, label: `Blend & Collab (${sharedPlaylists.length})` },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setSubTab(tab.id)}
              className={`rounded-full px-3.5 py-1.5 text-xs font-bold transition ${
                subTab === tab.id ? 'pm-btn-primary' : 'pm-text-secondary hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* 1. JAM & WEB REQUEST QR */}
      {subTab === 'jam' && (
        <div className="space-y-4">
          {!jamSession ? (
            <div className="pm-surface-card space-y-5 rounded-3xl p-6">
              <div className="flex items-start gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/10">
                  <QrCode className="h-6 w-6 pm-text-primary" />
                </div>
                <div className="space-y-1">
                  <h2 className="text-lg font-bold pm-text-primary">
                    Jam en vivo · Pedir canciones desde la web
                  </h2>
                  <p className="text-xs pm-text-secondary">
                    Crea un código QR para que cualquiera pueda buscar y pedir canciones desde el
                    navegador sin descargar la app (sin poder pausar, saltar ni tocar el volumen).
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setAllowDirectAdd((v) => !v)}
                  className="flex items-center justify-between rounded-2xl border pm-border bg-white/[0.03] px-4 py-3 text-left"
                >
                  <div>
                    <div className="text-xs font-bold pm-text-primary">Modo de peticiones</div>
                    <div className="text-[11px] pm-text-secondary">
                      {allowDirectAdd ? 'Añadir directo a la cola' : 'Aprobar antes de sonar'}
                    </div>
                  </div>
                  <span
                    className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${
                      allowDirectAdd
                        ? 'bg-emerald-500/20 text-emerald-300'
                        : 'bg-amber-500/20 text-amber-300'
                    }`}
                  >
                    {allowDirectAdd ? 'Directo' : 'Moderar'}
                  </span>
                </button>

                <div className="flex items-center justify-between rounded-2xl border pm-border bg-white/[0.03] px-4 py-3">
                  <div>
                    <div className="text-xs font-bold pm-text-primary">Límite por invitado</div>
                    <div className="text-[11px] pm-text-secondary">Evita spam en fiestas</div>
                  </div>
                  <div className="flex gap-1">
                    {[0, 2, 3, 5].map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setMaxPerGuest(n)}
                        className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${
                          maxPerGuest === n ? 'pm-btn-primary' : 'pm-btn-secondary'
                        }`}
                      >
                        {n === 0 ? '∞' : n}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <button
                type="button"
                disabled={jamBusy}
                onClick={() => void handleStartJam()}
                className="pm-btn-primary inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-bold disabled:opacity-50"
              >
                {jamBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Radio className="h-4 w-4" />}
                Iniciar Jam y generar QR
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
              <div className="pm-surface-card flex flex-col items-center space-y-4 rounded-3xl p-6 text-center lg:col-span-5">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-3 py-1 text-[11px] font-bold text-emerald-300">
                  <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                  JAM ACTIVA · {jamSession.code}
                </span>

                <img
                  src={buildJamQrImageUrl(jamSession.code)}
                  alt={`QR Jam ${jamSession.code}`}
                  className="h-48 w-48 rounded-2xl border border-white/15 bg-[#050507] p-2"
                />

                <div className="w-full space-y-2">
                  <div className="truncate rounded-xl border pm-border bg-black/30 px-3 py-2 font-mono text-[11px] pm-text-secondary">
                    {buildJamShareUrl(jamSession.code)}
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        void navigator.clipboard?.writeText(buildJamShareUrl(jamSession.code));
                        setCopiedUrl(true);
                        window.setTimeout(() => setCopiedUrl(false), 1800);
                        showToast('Enlace de Jam copiado');
                      }}
                      className="pm-btn-primary flex flex-1 items-center justify-center gap-1.5 rounded-full py-2.5 text-xs font-bold"
                    >
                      {copiedUrl ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                      {copiedUrl ? 'Copiado' : 'Copiar enlace'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleStopJam()}
                      className="pm-btn-secondary rounded-full px-4 py-2.5 text-xs font-semibold text-rose-300"
                    >
                      Cerrar Jam
                    </button>
                  </div>
                </div>
              </div>

              <div className="pm-surface-card space-y-3 rounded-3xl p-5 lg:col-span-7">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold pm-text-primary">
                    Peticiones entrantes ({jamRequests.length})
                  </h3>
                  <button
                    type="button"
                    onClick={() => setAllowDirectAdd((v) => !v)}
                    className="pm-btn-secondary rounded-full px-3 py-1 text-[11px] font-semibold"
                  >
                    {allowDirectAdd ? 'Modo: Directo' : 'Modo: Aprobar'}
                  </button>
                </div>

                {jamRequests.length === 0 ? (
                  <p className="py-10 text-center text-xs pm-text-secondary">
                    Escanea el QR con otro móvil y pide una canción — aparecerá aquí al instante.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {jamRequests.map((req) => (
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
                          <div className="truncate text-[11px] pm-text-secondary">
                            Pedido por <strong>{req.guestName}</strong>
                          </div>
                        </div>
                        {req.status === 'pending' ? (
                          <div className="flex gap-1.5">
                            <button
                              type="button"
                              onClick={() => void handleApproveRequest(req)}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/35"
                              aria-label="Aprobar"
                            >
                              <Check className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleRejectRequest(req)}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-rose-500/20 text-rose-300 hover:bg-rose-500/35"
                              aria-label="Rechazar"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </div>
                        ) : (
                          <span className="rounded-full bg-white/8 px-2.5 py-1 text-[10px] font-bold pm-text-secondary">
                            {req.status === 'approved' ? 'En cola' : 'Rechazada'}
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

      {/* 2. AMIGOS (@usuario) */}
      {subTab === 'amigos' && (
        <div className="space-y-4">
          <form onSubmit={handleSearchFriends} className="flex gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 pm-text-tertiary" />
              <input
                type="text"
                value={friendSearch}
                onChange={(e) => setFriendSearch(e.target.value)}
                placeholder="Buscar amigo por @usuario..."
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
              {searchHits.map((u) => (
                <div key={u.userId} className="flex items-center justify-between gap-3 py-1">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-xs font-bold pm-text-primary">
                      {u.displayName.slice(0, 1).toUpperCase()}
                    </div>
                    <div>
                      <div className="text-xs font-bold pm-text-primary">{u.displayName}</div>
                      <div className="text-[11px] pm-text-secondary">@{u.username}</div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      if (!sb || !myUserId) return;
                      try {
                        await sendFriendRequest(sb, myUserId, u.userId);
                        showToast(`Solicitud enviada a @${u.username}`);
                        void refreshSocialData();
                      } catch (err) {
                        showToast(err instanceof Error ? err.message : 'Error');
                      }
                    }}
                    className="pm-btn-primary inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-bold"
                  >
                    <UserPlus className="h-3.5 w-3.5" /> Añadir
                  </button>
                </div>
              ))}
            </div>
          )}

          {pendingIncoming.length > 0 && (
            <div className="pm-surface-card space-y-2 rounded-2xl p-4">
              <div className="text-[11px] font-bold uppercase tracking-wider text-amber-300">
                Solicitudes pendientes ({pendingIncoming.length})
              </div>
              {pendingIncoming.map((req) => (
                <div key={req.id} className="flex items-center justify-between gap-3 py-1">
                  <div>
                    <div className="text-xs font-bold pm-text-primary">
                      {req.otherProfile.displayName}
                    </div>
                    <div className="text-[11px] pm-text-secondary">@{req.otherProfile.username}</div>
                  </div>
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={async () => {
                        if (!sb) return;
                        await respondFriendRequest(sb, req.id, 'accepted');
                        showToast(`Ahora eres amigo de @${req.otherProfile.username}`);
                        void refreshSocialData();
                      }}
                      className="pm-btn-primary rounded-full px-3 py-1.5 text-xs font-bold"
                    >
                      Aceptar
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        if (!sb) return;
                        await respondFriendRequest(sb, req.id, 'declined');
                        void refreshSocialData();
                      }}
                      className="pm-btn-secondary rounded-full px-3 py-1.5 text-xs"
                    >
                      Ignorar
                    </button>
                  </div>
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
                Busca a tu amigo por su @usuario arriba para crear Blends y playlists juntos.
              </p>
            ) : (
              acceptedFriends.map((f) => (
                <div
                  key={f.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border pm-border bg-white/[0.02] p-3"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-sm font-bold pm-text-primary">
                      {f.otherProfile.displayName.slice(0, 1).toUpperCase()}
                    </div>
                    <div>
                      <div className="text-sm font-bold pm-text-primary">
                        {f.otherProfile.displayName}
                      </div>
                      <div className="text-xs pm-text-secondary">@{f.otherProfile.username}</div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleCreateBlend(f)}
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

      {/* 3. BLEND & COLLAB PLAYLISTS */}
      {subTab === 'compartidas' && (
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
                <option value="">Con amigo...</option>
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
              <Plus className="h-3.5 w-3.5" /> Crear
            </button>
          </form>

          {sharedPlaylists.length === 0 ? (
            <div className="pm-surface-card rounded-2xl p-8 text-center text-xs pm-text-secondary">
              <ListMusic className="mx-auto mb-2 h-7 w-7 opacity-45" />
              Aún no tienes Blends ni playlists colaborativas. Crea una arriba o desde la pestaña
              Amigos.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {sharedPlaylists.map((pl) => (
                <div
                  key={pl.id}
                  className="pm-surface-card flex flex-col justify-between gap-3 rounded-2xl p-4"
                >
                  <div className="flex items-start gap-3">
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
                        {pl.tracks.length} canciones
                      </p>
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={pl.tracks.length === 0}
                      onClick={() => {
                        if (pl.tracks[0]) void playTrack(pl.tracks[0], pl.tracks);
                      }}
                      className="pm-btn-primary inline-flex flex-1 items-center justify-center gap-1.5 rounded-full py-2 text-xs font-bold disabled:opacity-40"
                    >
                      <Play className="h-3.5 w-3.5 fill-current" /> Reproducir
                    </button>
                    {currentTrack && (
                      <button
                        type="button"
                        onClick={async () => {
                          if (!sb) return;
                          try {
                            const updated = await addTrackToSharedPlaylist(sb, pl, currentTrack);
                            setSharedPlaylists((prev) =>
                              prev.map((item) => (item.id === updated.id ? updated : item))
                            );
                            showToast(`"${currentTrack.title}" añadida a ${pl.name}`);
                          } catch (err) {
                            showToast(err instanceof Error ? err.message : 'Error');
                          }
                        }}
                        className="pm-btn-secondary inline-flex items-center gap-1 rounded-full px-3 py-2 text-xs font-semibold"
                        title="Añadir la canción que suena ahora"
                      >
                        <Plus className="h-3.5 w-3.5" /> Actual
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
