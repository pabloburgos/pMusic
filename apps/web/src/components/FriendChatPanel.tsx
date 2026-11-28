import React, { useEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import {
  ArrowLeft,
  Image as ImageIcon,
  ListMusic,
  Loader2,
  MessageCircle,
  Music2,
  Play,
  Radio,
  Send,
  User,
  X,
} from 'lucide-react';
import { usePMusicStore } from '../store/usePMusicStore.ts';
import {
  compressChatImageToDataUrl,
  type DirectMessageRecord,
} from '../services/social-service.ts';
import { resolvePlaylistCoverInfo } from '../utils/playlist-artwork.ts';
import { PlaylistCoverArt } from './PlaylistCoverArt.tsx';
import { UserAvatar } from './UserAvatar.tsx';

function formatMessageTime(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  return new Date(ms).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}

function summarizeMessagePreview(msg?: DirectMessageRecord): string {
  if (!msg) return 'Sin mensajes todavía';
  if (msg.messageType === 'image') return 'Imagen';
  if (msg.messageType === 'playlist') return `Playlist · ${msg.payload?.playlistName || 'Lista'}`;
  if (msg.messageType === 'jam') return `Invitación Jam · ${msg.payload?.jamCode || ''}`;
  if (msg.messageType === 'track') return `Tema · ${msg.payload?.track?.title || ''}`;
  return msg.body || 'Mensaje';
}

export const FriendChatPanel: React.FC = React.memo(() => {
  const {
    authState,
    friends,
    friendActivities,
    activeChatFriendId,
    directMessagesByFriend,
    unreadDmCounts,
    playlists,
    sharedPlaylists,
    currentTrack,
    openChatWithFriend,
    loadDirectMessagesWithFriend,
    openFriendProfile,
    sendFriendChatMessage,
    sendJamInviteToFriendChat,
    openJamJoinPrompt,
    playTrack,
    playCollection,
    openLocalPlaylistDetail,
    openSharedPlaylistDetail,
    joinSharedPlaylistLink,
    showToast,
  } = usePMusicStore(
    useShallow((s) => ({
      authState: s.authState,
      friends: s.friends,
      friendActivities: s.friendActivities,
      activeChatFriendId: s.activeChatFriendId,
      directMessagesByFriend: s.directMessagesByFriend,
      unreadDmCounts: s.unreadDmCounts,
      playlists: s.playlists,
      sharedPlaylists: s.sharedPlaylists,
      currentTrack: s.currentTrack,
      openChatWithFriend: s.openChatWithFriend,
      loadDirectMessagesWithFriend: s.loadDirectMessagesWithFriend,
      openFriendProfile: s.openFriendProfile,
      sendFriendChatMessage: s.sendFriendChatMessage,
      sendJamInviteToFriendChat: s.sendJamInviteToFriendChat,
      openJamJoinPrompt: s.openJamJoinPrompt,
      playTrack: s.playTrack,
      playCollection: s.playCollection,
      openLocalPlaylistDetail: s.openLocalPlaylistDetail,
      openSharedPlaylistDetail: s.openSharedPlaylistDetail,
      joinSharedPlaylistLink: s.joinSharedPlaylistLink,
      showToast: s.showToast,
    }))
  );

  const [textInput, setTextInput] = useState('');
  const [sending, setSending] = useState(false);
  const [playlistPickerOpen, setPlaylistPickerOpen] = useState(false);
  const [lightboxImageUrl, setLightboxImageUrl] = useState<string | null>(null);
  const [mobileListMode, setMobileListMode] = useState<boolean>(() => !activeChatFriendId);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const threadEndRef = useRef<HTMLDivElement | null>(null);

  const acceptedFriends = friends.filter((f) => f.status === 'accepted');
  const sortedFriends = [...acceptedFriends].sort((a, b) => {
    const la = directMessagesByFriend[a.otherProfile.userId];
    const lb = directMessagesByFriend[b.otherProfile.userId];
    const ta = la?.[la.length - 1]?.createdAt ?? '';
    const tb = lb?.[lb.length - 1]?.createdAt ?? '';
    return tb.localeCompare(ta);
  });

  const activeFriend =
    sortedFriends.find((f) => f.otherProfile.userId === activeChatFriendId) ??
    sortedFriends[0] ??
    null;
  const targetUserId = activeFriend?.otherProfile.userId ?? null;
  const messages = targetUserId ? directMessagesByFriend[targetUserId] ?? [] : [];

  useEffect(() => {
    if (activeChatFriendId) {
      setMobileListMode(false);
    }
  }, [activeChatFriendId]);

  useEffect(() => {
    if (targetUserId && !activeChatFriendId) {
      void loadDirectMessagesWithFriend(targetUserId);
    }
  }, [targetUserId, activeChatFriendId, loadDirectMessagesWithFriend]);

  useEffect(() => {
    if (typeof threadEndRef.current?.scrollIntoView === 'function') {
      threadEndRef.current.scrollIntoView({ behavior: 'auto', block: 'end' });
    }
  }, [targetUserId, messages.length]);

  const handleSendText = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetUserId || !textInput.trim() || sending) return;
    const text = textInput.trim();
    setTextInput('');
    setSending(true);
    try {
      await sendFriendChatMessage(targetUserId, {
        messageType: 'text',
        body: text,
      });
    } catch (err) {
      setTextInput(text);
      showToast(err instanceof Error ? err.message : 'Error enviando mensaje');
    } finally {
      setSending(false);
    }
  };

  const handleImageFile = async (file: File) => {
    if (!targetUserId) return;
    setSending(true);
    try {
      const { dataUrl, width, height } = await compressChatImageToDataUrl(file);
      await sendFriendChatMessage(targetUserId, {
        messageType: 'image',
        body: textInput.trim(),
        payload: { imageDataUrl: dataUrl, imageWidth: width, imageHeight: height },
      });
      if (textInput.trim()) setTextInput('');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'No se pudo enviar la imagen');
    } finally {
      setSending(false);
    }
  };

  const handleSendPlaylist = async (item: {
    id: string;
    name: string;
    coverUrl?: string | null;
    shareCode?: string | null;
    kind: 'local' | 'collab' | 'blend';
    tracks: typeof playlists[number]['tracks'];
  }) => {
    if (!targetUserId) return;
    setPlaylistPickerOpen(false);
    setSending(true);
    try {
      await sendFriendChatMessage(targetUserId, {
        messageType: 'playlist',
        body: item.name,
        payload: {
          playlistId: item.id,
          playlistName: item.name,
          playlistCoverUrl:
            item.coverUrl ??
            item.tracks[0]?.thumbnailHighUrl ??
            item.tracks[0]?.thumbnailUrl ??
            null,
          trackCount: item.tracks.length,
          shareCode: item.shareCode ?? null,
          playlistKind: item.kind,
          tracks: item.tracks.slice(0, 25),
        },
      });
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'No se pudo compartir la playlist');
    } finally {
      setSending(false);
    }
  };

  const handleSendCurrentTrack = async () => {
    if (!targetUserId || !currentTrack?.id || sending) return;
    setSending(true);
    try {
      await sendFriendChatMessage(targetUserId, {
        messageType: 'track',
        body: `${currentTrack.title} — ${currentTrack.artists.map((a) => a.name).join(', ')}`,
        payload: { track: currentTrack },
      });
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'No se pudo enviar la canción');
    } finally {
      setSending(false);
    }
  };

  if (acceptedFriends.length === 0) {
    return (
      <div className="pm-surface-card rounded-2xl border border-white/[0.08] bg-white/[0.02] p-8 text-center">
        <MessageCircle className="mx-auto mb-2.5 h-8 w-8 text-white/35" />
        <h3 className="text-sm font-bold pm-text-primary">Chats directos en pMusic</h3>
        <p className="mt-1 text-xs pm-text-secondary">
          Añade amigos en la pestaña Amigos para chatear, mandar imágenes, compartir playlists e
          invitarlos directo a una Jam.
        </p>
      </div>
    );
  }

  const shareablePlaylists = [
    ...sharedPlaylists.map((s) => ({
      id: s.id,
      name: s.name,
      coverUrl: s.coverUrl,
      shareCode: s.shareCode,
      kind: s.kind as 'collab' | 'blend',
      tracks: s.tracks,
    })),
    ...playlists
      .filter((p) => !p.id.startsWith('descubre_daily_'))
      .map((p) => ({
        id: p.id,
        name: p.name,
        coverUrl: p.coverUrl,
        shareCode: p.shareCode,
        kind: 'local' as const,
        tracks: p.tracks,
      })),
  ];

  return (
    <div
      data-testid="friend-chat-panel"
      className="grid grid-cols-1 gap-3 md:grid-cols-[260px_minmax(0,1fr)]"
    >
      {/* Conversations List */}
      <aside
        className={`${
          mobileListMode ? 'flex' : 'hidden md:flex'
        } max-h-[560px] flex-col gap-1.5 overflow-y-auto rounded-[20px] border border-white/[0.08] bg-white/[0.02] p-2.5 pm-no-scrollbar`}
      >
        <div className="px-2 py-1 text-[10.5px] font-bold uppercase tracking-wider pm-text-tertiary">
          Conversaciones ({sortedFriends.length})
        </div>
        {sortedFriends.map((f) => {
          const fid = f.otherProfile.userId;
          const isSelected = fid === targetUserId;
          const msgs = directMessagesByFriend[fid] ?? [];
          const lastMsg = msgs[msgs.length - 1];
          const unread = unreadDmCounts[fid] ?? 0;
          const isOnline = Boolean(friendActivities[fid]);
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => {
                setMobileListMode(false);
                void openChatWithFriend(fid);
              }}
              className={`flex items-center gap-2.5 rounded-[14px] px-2.5 py-2.5 text-left transition-colors ${
                isSelected
                  ? 'bg-white/[0.1] ring-1 ring-white/[0.14]'
                  : 'hover:bg-white/[0.05]'
              }`}
            >
              <div className="relative shrink-0">
                <UserAvatar
                  src={f.otherProfile.avatarUrl}
                  name={f.otherProfile.displayName}
                  size="sm"
                  showRing
                />
                {isOnline && (
                  <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-[#070709] bg-emerald-400" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-1">
                  <span className="truncate text-xs font-bold pm-text-primary">
                    {f.otherProfile.displayName}
                  </span>
                  {unread > 0 && (
                    <span className="tabular-nums inline-flex min-w-[18px] items-center justify-center rounded-full bg-white px-1.5 py-0.5 text-[10px] font-black text-[#070709]">
                      {unread}
                    </span>
                  )}
                </div>
                <div className="truncate text-[11px] pm-text-secondary">
                  {summarizeMessagePreview(lastMsg)}
                </div>
              </div>
            </button>
          );
        })}
      </aside>

      {/* Active Chat Thread */}
      {activeFriend && targetUserId && (
        <section
          className={`${
            !mobileListMode ? 'flex' : 'hidden md:flex'
          } h-[520px] sm:h-[560px] flex-col overflow-hidden rounded-[20px] border border-white/[0.08] bg-white/[0.02]`}
        >
          {/* Chat Header */}
          <div className="flex items-center justify-between gap-2 border-b border-white/[0.08] bg-white/[0.02] px-3.5 py-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <button
                type="button"
                aria-label="Volver a conversaciones"
                onClick={() => setMobileListMode(true)}
                className="pm-hover inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full pm-text-secondary md:hidden"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => void openFriendProfile(targetUserId)}
                className="flex min-w-0 items-center gap-2.5 text-left"
              >
                <UserAvatar
                  src={activeFriend.otherProfile.avatarUrl}
                  name={activeFriend.otherProfile.displayName}
                  size="sm"
                  showRing
                />
                <div className="min-w-0">
                  <div className="truncate text-xs font-bold pm-text-primary hover:underline">
                    {activeFriend.otherProfile.displayName}
                  </div>
                  <div className="truncate text-[11px] pm-text-secondary">
                    {friendActivities[targetUserId]
                      ? `Escuchando ${friendActivities[targetUserId]!.trackTitle}`
                      : `@${activeFriend.otherProfile.username}`}
                  </div>
                </div>
              </button>
            </div>

            <div className="flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                onClick={() => void openFriendProfile(targetUserId)}
                className="pm-btn-secondary inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-[11px] font-semibold"
              >
                <User className="h-3 w-3" />
                <span className="hidden sm:inline">Perfil</span>
              </button>
              <button
                type="button"
                onClick={() => void sendJamInviteToFriendChat(targetUserId)}
                className="pm-btn-secondary inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-[11px] font-semibold"
              >
                <Radio className="h-3 w-3 text-emerald-400" />
                <span>Invitar Jam</span>
              </button>
            </div>
          </div>

          {/* Messages Scroll Container */}
          <div className="flex-1 space-y-3 overflow-y-auto p-3.5 sm:p-4">
            {messages.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center text-center text-xs pm-text-secondary">
                <MessageCircle className="mb-2 h-7 w-7 opacity-30" />
                <p>Empieza a chatear con {activeFriend.otherProfile.displayName}</p>
                <p className="mt-0.5 text-[11px] pm-text-tertiary">
                  Puedes enviar mensajes, imágenes, playlists o invitaciones directas a tu Jam.
                </p>
              </div>
            ) : (
              messages.map((msg) => {
                const isOwn = msg.senderId === authState.userId;
                return (
                  <div
                    key={msg.id}
                    className={`flex flex-col ${isOwn ? 'items-end' : 'items-start'}`}
                  >
                    {msg.messageType === 'image' && msg.payload?.imageDataUrl && (
                      <div className="max-w-[260px] space-y-1.5 rounded-2xl border border-white/[0.08] bg-white/[0.04] p-1.5">
                        <button
                          type="button"
                          onClick={() => setLightboxImageUrl(msg.payload?.imageDataUrl ?? null)}
                          className="block overflow-hidden rounded-xl"
                        >
                          <img
                            src={msg.payload.imageDataUrl}
                            alt="Imagen compartida"
                            className="max-h-60 w-full rounded-xl object-cover"
                          />
                        </button>
                        {msg.body && (
                          <p className="px-2 pb-1 text-xs pm-text-primary">{msg.body}</p>
                        )}
                      </div>
                    )}

                    {msg.messageType === 'playlist' && msg.payload && (
                      <div className="w-[min(290px,82vw)] space-y-2.5 rounded-2xl border border-white/[0.1] bg-white/[0.05] p-3">
                        <div className="flex items-center gap-3">
                          <PlaylistCoverArt
                            coverInfo={resolvePlaylistCoverInfo({
                              name: msg.payload.playlistName || 'Playlist',
                              coverUrl: msg.payload.playlistCoverUrl,
                              tracks: msg.payload.tracks ?? [],
                            })}
                            title={msg.payload.playlistName || 'Playlist'}
                            className="h-12 w-12 shrink-0 rounded-lg"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="text-[10px] font-bold uppercase tracking-wider text-white/60">
                              Playlist compartida
                            </div>
                            <div className="truncate text-xs font-bold pm-text-primary">
                              {msg.payload.playlistName || msg.body}
                            </div>
                            <div className="truncate text-[11px] pm-text-secondary">
                              {msg.payload.trackCount ?? msg.payload.tracks?.length ?? 0} canciones
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={async () => {
                              if (msg.payload?.shareCode) {
                                const joined = await joinSharedPlaylistLink(msg.payload.shareCode);
                                if (joined) {
                                  openSharedPlaylistDetail(joined.id);
                                  return;
                                }
                              }
                              const localMatch = playlists.find(
                                (p) => p.id === msg.payload?.playlistId
                              );
                              if (localMatch) {
                                openLocalPlaylistDetail(localMatch.id);
                                return;
                              }
                              const sharedMatch = sharedPlaylists.find(
                                (s) => s.id === msg.payload?.playlistId
                              );
                              if (sharedMatch) {
                                openSharedPlaylistDetail(sharedMatch.id);
                                return;
                              }
                              if (msg.payload?.tracks?.length) {
                                void playCollection(msg.payload.tracks, { isPlaylist: true });
                              }
                            }}
                            className="pm-btn-secondary flex-1 rounded-full py-1.5 text-[11px] font-semibold"
                          >
                            Abrir
                          </button>
                          {Boolean(msg.payload.tracks?.length) && (
                            <button
                              type="button"
                              onClick={() =>
                                void playCollection(msg.payload!.tracks!, { isPlaylist: true })
                              }
                              className="pm-btn-primary inline-flex flex-1 items-center justify-center gap-1 rounded-full py-1.5 text-[11px] font-bold"
                            >
                              <Play className="h-3 w-3 fill-current" />
                              <span>Reproducir</span>
                            </button>
                          )}
                        </div>
                      </div>
                    )}

                    {msg.messageType === 'jam' && msg.payload?.jamCode && (
                      <div className="w-[min(290px,82vw)] space-y-2.5 rounded-2xl border border-emerald-400/25 bg-emerald-500/[0.06] p-3">
                        <div className="flex items-center justify-between gap-2">
                          <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-emerald-300">
                            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                            Invitación a Jam
                          </span>
                          <span className="rounded-full bg-white/10 px-2 py-0.5 font-mono text-[10px] font-bold text-white">
                            {msg.payload.jamCode}
                          </span>
                        </div>
                        <div className="flex items-center gap-2.5">
                          {msg.payload.jamTrackCover && (
                            <img
                              src={msg.payload.jamTrackCover}
                              alt=""
                              className="h-10 w-10 shrink-0 rounded-lg object-cover"
                            />
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-xs font-bold pm-text-primary">
                              Jam de {msg.payload.jamHostName || 'Amigo'}
                            </div>
                            <div className="truncate text-[11px] pm-text-secondary">
                              {msg.payload.jamTrackTitle || 'Sesión en directo'}
                            </div>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => openJamJoinPrompt(msg.payload!.jamCode!)}
                          className="pm-btn-primary inline-flex w-full items-center justify-center gap-1.5 rounded-full py-1.5 text-xs font-bold"
                        >
                          <Radio className="h-3.5 w-3.5" />
                          <span>Unirse a la Jam</span>
                        </button>
                      </div>
                    )}

                    {msg.messageType === 'track' && msg.payload?.track && (
                      <div className="flex w-[min(280px,80vw)] items-center justify-between gap-2.5 rounded-2xl border border-white/[0.1] bg-white/[0.05] p-2.5">
                        <div className="flex min-w-0 items-center gap-2.5">
                          <img
                            src={msg.payload.track.thumbnailUrl}
                            alt=""
                            className="h-10 w-10 shrink-0 rounded-lg object-cover"
                          />
                          <div className="min-w-0">
                            <div className="truncate text-xs font-bold pm-text-primary">
                              {msg.payload.track.title}
                            </div>
                            <div className="truncate text-[11px] pm-text-secondary">
                              {msg.payload.track.artists.map((a) => a.name).join(', ')}
                            </div>
                          </div>
                        </div>
                        <button
                          type="button"
                          aria-label={`Reproducir ${msg.payload.track.title}`}
                          onClick={() => void playTrack(msg.payload!.track!)}
                          className="pm-btn-primary inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
                        >
                          <Play className="h-3.5 w-3.5 fill-current" />
                        </button>
                      </div>
                    )}

                    {msg.messageType === 'text' && (
                      <div
                        className={`max-w-[78%] break-words rounded-2xl px-3.5 py-2 text-xs leading-relaxed ${
                          isOwn
                            ? 'bg-white text-[#070709] font-medium'
                            : 'border border-white/[0.08] bg-white/[0.06] pm-text-primary'
                        }`}
                      >
                        {msg.body}
                      </div>
                    )}

                    <span className="mt-1 px-1 text-[10px] pm-text-tertiary">
                      {formatMessageTime(msg.createdAt)}
                    </span>
                  </div>
                );
              })
            )}
            <div ref={threadEndRef} />
          </div>

          {/* Playlist Picker Popover */}
          {playlistPickerOpen && (
            <div className="border-t border-white/[0.08] bg-[#0c0c10] p-2.5">
              <div className="mb-1.5 flex items-center justify-between px-1">
                <span className="text-[11px] font-bold pm-text-secondary">
                  Elegir playlist para enviar
                </span>
                <button
                  type="button"
                  onClick={() => setPlaylistPickerOpen(false)}
                  className="pm-text-tertiary hover:pm-text-primary"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="flex max-h-36 flex-wrap gap-1.5 overflow-y-auto">
                {shareablePlaylists.slice(0, 12).map((pl) => (
                  <button
                    key={`pick-${pl.kind}-${pl.id}`}
                    type="button"
                    onClick={() => void handleSendPlaylist(pl)}
                    className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.1] bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-white hover:bg-white/[0.1]"
                  >
                    <ListMusic className="h-3 w-3 text-white/70" />
                    <span className="max-w-[160px] truncate">{pl.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Composer */}
          <form
            onSubmit={handleSendText}
            className="flex items-center gap-1.5 border-t border-white/[0.08] bg-white/[0.02] p-2.5"
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) void handleImageFile(file);
              }}
            />
            <button
              type="button"
              title="Enviar imagen"
              aria-label="Enviar imagen"
              onClick={() => fileInputRef.current?.click()}
              className="pm-hover inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full pm-text-secondary hover:text-white"
            >
              <ImageIcon className="h-4 w-4" />
            </button>
            <button
              type="button"
              title="Compartir playlist"
              aria-label="Compartir playlist"
              onClick={() => setPlaylistPickerOpen((v) => !v)}
              className="pm-hover inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full pm-text-secondary hover:text-white"
            >
              <ListMusic className="h-4 w-4" />
            </button>
            <button
              type="button"
              title="Compartir canción actual"
              aria-label="Compartir canción actual"
              onClick={() => void handleSendCurrentTrack()}
              className="pm-hover hidden h-9 w-9 shrink-0 items-center justify-center rounded-full pm-text-secondary hover:text-white sm:inline-flex"
            >
              <Music2 className="h-4 w-4" />
            </button>
            <input
              type="text"
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              onPaste={(e) => {
                const file = e.clipboardData?.files?.[0];
                if (file && file.type.startsWith('image/')) {
                  e.preventDefault();
                  void handleImageFile(file);
                }
              }}
              placeholder={`Escribe a ${activeFriend.otherProfile.displayName}…`}
              className="pm-input min-w-0 flex-1 rounded-full px-3.5 py-2 text-xs"
            />
            <button
              type="submit"
              disabled={!textInput.trim() || sending}
              aria-label="Enviar mensaje"
              className="pm-btn-primary inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full disabled:opacity-40"
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </button>
          </form>
        </section>
      )}

      {/* Lightbox for Fullscreen Chat Image */}
      {lightboxImageUrl && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setLightboxImageUrl(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4"
        >
          <button
            type="button"
            aria-label="Cerrar imagen"
            onClick={() => setLightboxImageUrl(null)}
            className="absolute right-4 top-4 inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
          >
            <X className="h-5 w-5" />
          </button>
          <img
            src={lightboxImageUrl}
            alt="Vista ampliada"
            className="max-h-[88vh] max-w-[92vw] rounded-2xl object-contain"
          />
        </div>
      )}
    </div>
  );
});
FriendChatPanel.displayName = 'FriendChatPanel';
