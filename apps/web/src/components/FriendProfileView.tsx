import React, { useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import {
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Disc3,
  ListMusic,
  Loader2,
  MessageCircle,
  Play,
  Plus,
  Radio,
  UserPlus,
  Users,
} from 'lucide-react';
import type { Track } from '@pmusic/core';
import { usePMusicStore } from '../store/usePMusicStore.ts';
import { resolvePlaylistCoverInfo } from '../utils/playlist-artwork.ts';
import type { PublicPlaylistSummary } from '../services/social-service.ts';
import { ArtistLinks } from './ArtistLinks.tsx';
import { PlaylistCoverArt } from './PlaylistCoverArt.tsx';
import { TrackArtwork } from './TrackArtwork.tsx';
import { UserAvatar } from './UserAvatar.tsx';

export const FriendProfileView: React.FC<{ userId: string }> = React.memo(({ userId }) => {
  const {
    authState,
    friends,
    friendProfilesCache,
    friendActivities,
    sharedPlaylists,
    blendGeneratingForUserId,
    openFriendProfile,
    openChatWithFriend,
    createBlendWithFriend,
    sendJamInviteToFriendChat,
    sendFriendRequestToUser,
    openArtistDetail,
    openSharedPlaylistDetail,
    openFriendPlaylistDetail,
    joinSharedPlaylistLink,
    playTrack,
    playCollection,
    playFriendActivityTrack,
    createPlaylist,
    openLocalPlaylistDetail,
    openTrackMenu,
    showToast,
  } = usePMusicStore(
    useShallow((s) => ({
      authState: s.authState,
      friends: s.friends,
      friendProfilesCache: s.friendProfilesCache,
      friendActivities: s.friendActivities,
      sharedPlaylists: s.sharedPlaylists,
      blendGeneratingForUserId: s.blendGeneratingForUserId,
      openFriendProfile: s.openFriendProfile,
      openChatWithFriend: s.openChatWithFriend,
      createBlendWithFriend: s.createBlendWithFriend,
      sendJamInviteToFriendChat: s.sendJamInviteToFriendChat,
      sendFriendRequestToUser: s.sendFriendRequestToUser,
      openArtistDetail: s.openArtistDetail,
      openSharedPlaylistDetail: s.openSharedPlaylistDetail,
      openFriendPlaylistDetail: s.openFriendPlaylistDetail,
      joinSharedPlaylistLink: s.joinSharedPlaylistLink,
      playTrack: s.playTrack,
      playCollection: s.playCollection,
      playFriendActivityTrack: s.playFriendActivityTrack,
      createPlaylist: s.createPlaylist,
      openLocalPlaylistDetail: s.openLocalPlaylistDetail,
      openTrackMenu: s.openTrackMenu,
      showToast: s.showToast,
    }))
  );

  const [savedPlaylistIds, setSavedPlaylistIds] = useState<Record<string, boolean>>({});
  const [sendingReq, setSendingReq] = useState(false);
  const [showAllPopular, setShowAllPopular] = useState(false);

  const profile = friendProfilesCache[userId] ?? null;
  const friendRecord = friends.find((f) => f.otherProfile.userId === userId) ?? null;
  const isAcceptedFriend = friendRecord?.status === 'accepted';
  const liveActivity = friendActivities[userId] ?? null;

  useEffect(() => {
    setShowAllPopular(false);
    if (!friendProfilesCache[userId]) {
      void openFriendProfile(userId);
    }
  }, [userId, friendProfilesCache, openFriendProfile]);

  const displayName =
    profile?.displayName ?? friendRecord?.otherProfile.displayName ?? 'Usuario pMusic';
  const username = profile?.username ?? friendRecord?.otherProfile.username ?? 'usuario';
  const avatarUrl = profile?.avatarUrl ?? friendRecord?.otherProfile.avatarUrl ?? null;

  const isPrivateProfile = profile?.publicProfileEnabled === false;
  const topTracks = isPrivateProfile ? [] : profile?.topTracks ?? [];
  const topArtists = isPrivateProfile ? [] : profile?.topArtists ?? [];

  const mutualSharedPlaylists: PublicPlaylistSummary[] = sharedPlaylists
    .filter((sp) => sp.ownerId === userId || sp.memberIds.includes(userId))
    .map((sp) => ({
      id: sp.id,
      name: sp.name,
      description: sp.description,
      coverUrl: sp.coverUrl,
      trackCount: sp.tracks.length,
      tracks: sp.tracks,
      shareCode: sp.shareCode,
      kind: sp.kind,
    }));

  const publicPlaylists: PublicPlaylistSummary[] = (() => {
    if (isPrivateProfile) return mutualSharedPlaylists;
    const raw = [...(profile?.publicPlaylists ?? []), ...mutualSharedPlaylists];
    const seen = new Set<string>();
    return raw.filter((pl) => {
      const k = (pl.shareCode || pl.id || pl.name).toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  })();

  const topQueueTracks: Track[] = topTracks.map((x) => x.track).filter(Boolean);
  const visibleTopTracks = showAllPopular ? topTracks.slice(0, 10) : topTracks.slice(0, 5);
  const heroBackdropUrl =
    avatarUrl ||
    liveActivity?.thumbnailUrl ||
    topTracks[0]?.track.thumbnailUrl ||
    topArtists[0]?.thumbnailUrl ||
    null;

  const handleOpenPlaylist = async (pl: PublicPlaylistSummary) => {
    const existingShared = sharedPlaylists.find(
      (s) =>
        s.id === pl.id ||
        (pl.shareCode && s.shareCode?.toUpperCase() === pl.shareCode.toUpperCase())
    );
    if (existingShared) {
      openSharedPlaylistDetail(existingShared.id);
      return;
    }
    if (pl.shareCode) {
      const joined = await joinSharedPlaylistLink(pl.shareCode);
      if (joined) {
        openSharedPlaylistDetail(joined.id);
        return;
      }
    }
    openFriendPlaylistDetail(pl, username, displayName);
  };

  const handleSaveCopy = async (pl: PublicPlaylistSummary) => {
    if (pl.tracks.length === 0) return;
    const created = await createPlaylist(
      pl.name,
      pl.description || `Copia de la playlist de @${username}`,
      pl.tracks
    );
    setSavedPlaylistIds((prev) => ({ ...prev, [pl.id]: true }));
    showToast(`«${created.name}» guardada en tu biblioteca`);
    openLocalPlaylistDetail(created.id);
  };

  const isGeneratingBlend = blendGeneratingForUserId === userId;

  return (
    <div data-testid="friend-profile-view" className="pm-page-enter pb-10">
      {/* Full-bleed Artist-Style OLED Profile Hero */}
      <section
        data-surface="content"
        data-testid="friend-hero-banner"
        className="relative -mx-4 flex min-h-[300px] flex-col justify-end overflow-hidden bg-[var(--pm-bg-canvas)] px-5 pt-[calc(5rem+var(--pm-safe-top,env(safe-area-inset-top)))] pb-6 sm:-mx-7 sm:min-h-[340px] sm:p-8 sm:pb-7"
      >
        {heroBackdropUrl && (
          <>
            <img
              src={heroBackdropUrl}
              alt=""
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 h-full w-full scale-110 object-cover object-[50%_22%] blur-2xl brightness-[0.62] saturate-125"
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0"
              style={{
                background:
                  'linear-gradient(180deg, transparent 0%, color-mix(in srgb, var(--pm-bg-canvas) 28%, transparent) 44%, color-mix(in srgb, var(--pm-bg-canvas) 78%, transparent) 78%, var(--pm-bg-canvas) 100%)',
              }}
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0"
              style={{
                background:
                  'linear-gradient(90deg, color-mix(in srgb, var(--pm-bg-canvas) 62%, transparent) 0%, transparent 55%)',
              }}
            />
          </>
        )}

        <div className="relative z-10 flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div className="flex min-w-0 flex-1 flex-row items-center gap-4 sm:items-end sm:gap-5">
            <div className="relative shrink-0">
              <UserAvatar src={avatarUrl} name={displayName} size="lg" showRing />
              {liveActivity && (
                <span
                  aria-label="En directo"
                  className="absolute bottom-0.5 right-0.5 h-3.5 w-3.5 rounded-full border-2 border-[#070709] bg-emerald-400"
                />
              )}
            </div>
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-white/[0.12] bg-white/[0.08] px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-white/80">
                  Perfil pMusic
                </span>
                {liveActivity && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[10px] font-bold text-emerald-300">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                    Escuchando ahora
                  </span>
                )}
              </div>
              <h1 className="truncate text-3xl font-black tracking-tight text-white drop-shadow-[0_4px_20px_rgba(0,0,0,0.65)] sm:text-5xl">
                {displayName}
              </h1>
              <p className="truncate text-xs font-medium text-white/75 sm:text-sm">
                @{username}
                {profile?.bio ? ` · ${profile.bio}` : ''}
                {!isPrivateProfile && publicPlaylists.length > 0
                  ? ` · ${publicPlaylists.length} ${publicPlaylists.length === 1 ? 'playlist pública' : 'playlists públicas'}`
                  : ''}
              </p>
            </div>
          </div>

          {authState.userId !== userId && (
            <div className="flex flex-wrap items-center gap-2 md:shrink-0">
              {isAcceptedFriend ? (
                <>
                  <button
                    type="button"
                    data-testid="friend-profile-chat-btn"
                    onClick={() => void openChatWithFriend(userId)}
                    className="pm-btn-primary pm-pressable inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-bold"
                  >
                    <MessageCircle className="h-3.5 w-3.5" />
                    <span>Chatear</span>
                  </button>
                  {friendRecord && (
                    <button
                      type="button"
                      disabled={isGeneratingBlend}
                      data-testid="friend-profile-blend-btn"
                      onClick={async () => {
                        const created = await createBlendWithFriend(friendRecord);
                        if (created) openSharedPlaylistDetail(created.id);
                      }}
                      className="pm-btn-secondary pm-pressable inline-flex items-center gap-1.5 rounded-full border border-white/[0.14] bg-white/[0.08] px-4 py-2 text-xs font-semibold text-white hover:bg-white/[0.14] disabled:opacity-55"
                    >
                      {isGeneratingBlend ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Disc3 className="h-3.5 w-3.5" />
                      )}
                      <span>{isGeneratingBlend ? 'Creando Blend…' : 'Blend 100'}</span>
                    </button>
                  )}
                  <button
                    type="button"
                    data-testid="friend-profile-jam-btn"
                    onClick={async () => {
                      await sendJamInviteToFriendChat(userId);
                      await openChatWithFriend(userId);
                    }}
                    className="pm-btn-secondary pm-pressable inline-flex items-center gap-1.5 rounded-full border border-white/[0.14] bg-white/[0.08] px-3.5 py-2 text-xs font-semibold text-white hover:bg-white/[0.14]"
                  >
                    <Radio className="h-3.5 w-3.5 text-emerald-400" />
                    <span>Invitar a Jam</span>
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  disabled={Boolean(friendRecord) || sendingReq}
                  onClick={async () => {
                    setSendingReq(true);
                    try {
                      await sendFriendRequestToUser(userId);
                      showToast(`Solicitud enviada a @${username}`);
                    } finally {
                      setSendingReq(false);
                    }
                  }}
                  className="pm-btn-primary inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-bold disabled:opacity-50"
                >
                  <UserPlus className="h-3.5 w-3.5" />
                  <span>{friendRecord ? 'Solicitud pendiente' : 'Añadir amigo'}</span>
                </button>
              )}
            </div>
          )}
        </div>
      </section>

      <div className="mt-6 space-y-8">
        {/* Live Now Playing Banner */}
        {liveActivity && (
          <section className="pm-surface-card flex items-center justify-between gap-3 rounded-[18px] border border-emerald-400/20 bg-emerald-500/[0.05] p-3.5 sm:p-4">
            <div className="flex min-w-0 items-center gap-3">
              <TrackArtwork
                trackId={liveActivity.trackId}
                src={liveActivity.thumbnailUrl}
                title={liveActivity.trackTitle}
                artistName={liveActivity.trackArtist}
                alt={liveActivity.trackTitle}
                variant="list"
                imgClassName="h-12 w-12 shrink-0 rounded-[10px] object-cover"
              />
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-emerald-300">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                  <span>Sonando ahora en pMusic</span>
                </div>
                <div className="truncate text-sm font-bold pm-text-primary">
                  {liveActivity.trackTitle}
                </div>
                <div className="truncate text-xs pm-text-secondary">
                  {liveActivity.trackArtist}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void playFriendActivityTrack(liveActivity)}
              className="pm-btn-primary pm-pressable inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-4 text-xs font-bold"
            >
              <Play className="h-3.5 w-3.5 fill-current" />
              <span>Escuchar</span>
            </button>
          </section>
        )}

        {!profile && (
          <div className="pm-surface-card flex items-center justify-center gap-2 rounded-2xl border border-white/[0.06] py-10 text-xs pm-text-secondary">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Cargando actividad y gustos de @{username}…</span>
          </div>
        )}

        {/* Populares / Top 10 Canciones */}
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-[20px] font-bold tracking-tight pm-text-primary">
                Top 10 canciones
              </h2>
              <p className="text-xs pm-text-tertiary">
                Lo más escuchado recientemente por {displayName}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {topTracks.length > 5 && (
                <button
                  type="button"
                  onClick={() => setShowAllPopular((v) => !v)}
                  className="pm-pressable inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold pm-text-secondary hover:bg-white/[0.08] hover:pm-text-primary"
                >
                  <span>{showAllPopular ? 'Ver menos' : 'Ver Top 10'}</span>
                  {showAllPopular ? (
                    <ChevronUp className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5" />
                  )}
                </button>
              )}
              {topQueueTracks.length > 0 && (
                <button
                  type="button"
                  onClick={() => void playCollection(topQueueTracks, { isPlaylist: true })}
                  className="pm-btn-secondary inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold"
                >
                  <Play className="h-3 w-3 fill-current" />
                  <span>Reproducir</span>
                </button>
              )}
            </div>
          </div>

          {topTracks.length === 0 ? (
            <div className="pm-surface-card rounded-2xl border border-white/[0.07] bg-white/[0.02] p-6 text-center text-xs pm-text-secondary">
              {isPrivateProfile
                ? `${displayName} mantiene su Top 10 en privado.`
                : `Aún no hay Top 10 público de @${username}. Se actualiza automáticamente en cuanto abra pMusic.`}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-1.5 md:grid-cols-2">
              {visibleTopTracks.map((item, idx) => (
                <div
                  key={`fp-top-${item.track.id}-${idx}`}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    openTrackMenu(item.track, e.clientX, e.clientY);
                  }}
                  className="pm-hover group flex items-center justify-between gap-3 rounded-[12px] border border-white/[0.05] bg-white/[0.02] px-3 py-2 transition-colors hover:border-white/[0.12] hover:bg-white/[0.06]"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <span className="tabular-nums w-5 text-center text-xs font-black text-white/40">
                      {idx + 1}
                    </span>
                    <button
                      type="button"
                      onClick={() => void playTrack(item.track, topQueueTracks)}
                      className="relative h-10 w-10 shrink-0 overflow-hidden rounded-[8px] bg-white/[0.06]"
                    >
                      <TrackArtwork
                        trackId={item.track.id}
                        src={item.track.thumbnailUrl}
                        title={item.track.title}
                        artistName={item.track.artists[0]?.name}
                        alt={item.track.title}
                        variant="list"
                        imgClassName="h-full w-full object-cover object-center"
                      />
                    </button>
                    <div className="min-w-0 flex-1">
                      <button
                        type="button"
                        onClick={() => void playTrack(item.track, topQueueTracks)}
                        className="block max-w-full truncate text-left text-[13px] font-bold pm-text-primary hover:underline"
                      >
                        {item.track.title}
                      </button>
                      <div className="truncate text-[11.5px] pm-text-secondary">
                        <ArtistLinks
                          artists={item.track.artists}
                          linkClassName="hover:underline hover:text-white"
                        />
                      </div>
                    </div>
                  </div>
                  <span className="tabular-nums shrink-0 rounded-full bg-white/[0.05] px-2 py-0.5 text-[10px] font-semibold text-white/60">
                    {item.plays} rep.
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Top Artistas */}
        {topArtists.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-[20px] font-bold tracking-tight pm-text-primary">
              Artistas más escuchados
            </h2>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-5">
              {topArtists.slice(0, 10).map((ar, idx) => (
                <button
                  key={`fp-art-${ar.artistName}-${idx}`}
                  type="button"
                  onClick={() =>
                    void openArtistDetail(ar.artistId || ar.artistName, {
                      name: ar.artistName,
                      thumbnailUrl: ar.thumbnailUrl,
                    })
                  }
                  className="pm-surface-card pm-card-lift flex items-center gap-2.5 rounded-[14px] border border-white/[0.07] bg-white/[0.03] p-2.5 text-left transition-colors hover:border-white/[0.16] hover:bg-white/[0.07]"
                >
                  {ar.thumbnailUrl ? (
                    <img
                      src={ar.thumbnailUrl}
                      alt={ar.artistName}
                      className="h-10 w-10 shrink-0 rounded-full object-cover object-center"
                    />
                  ) : (
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/[0.08] text-xs font-bold text-white/70">
                      <Users className="h-4 w-4" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-bold pm-text-primary">{ar.artistName}</div>
                    <div className="truncate text-[10.5px] pm-text-tertiary">{ar.plays} rep.</div>
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Playlists Públicas: Tarjetas horizontales en móvil, Grid 1:1 cuadrado en escritorio */}
        <section data-testid="friend-public-playlists" className="space-y-3">
          <div className="flex items-center gap-2">
            <ListMusic className="h-4 w-4 text-white/70" />
            <h2 className="text-[20px] font-bold tracking-tight pm-text-primary">
              Playlists públicas ({publicPlaylists.length})
            </h2>
          </div>

          {publicPlaylists.length === 0 ? (
            <div className="pm-surface-card rounded-2xl border border-white/[0.07] bg-white/[0.02] p-6 text-center text-xs pm-text-secondary">
              @{username} no tiene playlists públicas visibles todavía.
            </div>
          ) : (
            <div
              data-testid="friend-playlists-responsive-list"
              className="grid grid-cols-1 gap-2 sm:grid-cols-3 sm:gap-4 md:grid-cols-4 lg:grid-cols-5"
            >
              {publicPlaylists.map((pl) => {
                const coverInfo = resolvePlaylistCoverInfo({
                  id: pl.id,
                  name: pl.name,
                  coverUrl: pl.coverUrl,
                  tracks: pl.tracks,
                });
                const isSaved = Boolean(savedPlaylistIds[pl.id]);
                const subtitle = [
                  `${pl.trackCount || pl.tracks.length} pistas`,
                  pl.kind === 'blend' ? 'Blend' : pl.kind === 'collab' ? 'Colaborativa' : '',
                ]
                  .filter(Boolean)
                  .join(' · ');

                return (
                  <article
                    key={`fp-pl-${pl.id}`}
                    data-testid={`friend-playlist-card-${pl.id}`}
                    onClick={() => void handleOpenPlaylist(pl)}
                    className="pm-media-card pm-surface-card group flex min-w-0 cursor-pointer items-center justify-between gap-3 rounded-[16px] border border-white/[0.08] bg-white/[0.03] p-2.5 transition-colors hover:border-white/[0.16] hover:bg-white/[0.06] sm:block sm:border-transparent sm:bg-transparent sm:hover:border-transparent sm:hover:bg-white/[0.04]"
                  >
                    <div className="relative shrink-0 overflow-hidden rounded-[10px] sm:w-full sm:rounded-[12px]">
                      <button
                        type="button"
                        data-testid={`friend-playlist-open-${pl.id}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleOpenPlaylist(pl);
                        }}
                        className="block h-14 w-14 overflow-hidden rounded-[10px] bg-[#141418] text-left focus:outline-none sm:h-auto sm:w-full sm:rounded-[12px]"
                      >
                        <PlaylistCoverArt
                          coverInfo={coverInfo}
                          title={pl.name}
                          className="aspect-square h-full w-full rounded-[10px] sm:rounded-[12px]"
                        />
                      </button>
                      {pl.tracks.length > 0 && (
                        <button
                          type="button"
                          aria-label={`Reproducir ${pl.name}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            void playCollection(pl.tracks, { isPlaylist: true });
                          }}
                          className="pm-cover-play pm-btn-primary hidden h-10 w-10 items-center justify-center rounded-full shadow-xl transition-transform hover:scale-105 sm:absolute sm:right-2 sm:bottom-2 sm:flex"
                        >
                          <Play className="h-4 w-4 translate-x-[1px] fill-current" />
                        </button>
                      )}
                    </div>

                    <div className="flex min-w-0 flex-1 items-center justify-between gap-2 sm:mt-2.5 sm:items-start sm:gap-1.5">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleOpenPlaylist(pl);
                        }}
                        className="min-w-0 flex-1 text-left focus:outline-none"
                      >
                        <div className="truncate text-sm font-bold leading-snug pm-text-primary hover:underline sm:text-[13.5px]">
                          {pl.name}
                        </div>
                        <div className="truncate text-[11.5px] pm-text-secondary">
                          {subtitle}
                        </div>
                      </button>

                      <div className="flex shrink-0 items-center gap-1.5 sm:hidden">
                        {pl.tracks.length > 0 && (
                          <button
                            type="button"
                            aria-label={`Reproducir ${pl.name} en móvil`}
                            onClick={(e) => {
                              e.stopPropagation();
                              void playCollection(pl.tracks, { isPlaylist: true });
                            }}
                            className="pm-btn-primary pm-pressable flex h-8 w-8 items-center justify-center rounded-full"
                          >
                            <Play className="h-3.5 w-3.5 translate-x-[0.5px] fill-current" />
                          </button>
                        )}
                        <ChevronRight className="h-4 w-4 text-white/40" />
                      </div>

                      {pl.tracks.length > 0 && (
                        <button
                          type="button"
                          disabled={isSaved}
                          aria-label={isSaved ? 'Guardada en tu biblioteca' : `Guardar ${pl.name}`}
                          title={isSaved ? 'Guardada' : 'Guardar copia'}
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleSaveCopy(pl);
                          }}
                          className="mt-0.5 hidden h-6 w-6 shrink-0 items-center justify-center rounded-full text-white/55 transition-colors hover:bg-white/[0.08] hover:text-white disabled:opacity-75 sm:flex"
                        >
                          {isSaved ? (
                            <Check className="h-3.5 w-3.5 text-emerald-400" />
                          ) : (
                            <Plus className="h-3.5 w-3.5" />
                          )}
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
});
FriendProfileView.displayName = 'FriendProfileView';
