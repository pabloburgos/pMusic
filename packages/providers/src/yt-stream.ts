import type { IncomingMessage, ServerResponse } from 'node:http';
import { stripTrackTitleNoise } from '@pmusic/core';
import { FALLBACK_TRACKS } from './catalog-fallback.ts';
import type { DeezerCatalog } from './deezer-catalog.ts';
import { isDeezerTrackId } from './deezer-catalog.ts';

export interface AudioStreamMeta {
  title?: string;
  artist?: string;
  durationSec?: number;
}

export type StreamSourceKind = 'youtube-full' | 'deezer-preview';

interface Resolved {
  url: string;
  mime: string;
  source: StreamSourceKind;
  expiresAt: number;
}

const YOUTUBE_ID_RE = /^[a-zA-Z0-9_-]{11}$/;
const AUDIO_CLIENTS = ['ANDROID', 'YTMUSIC', 'MWEB', 'IOS'] as const;
const BAD_VERSION_RE =
  /(karaoke|remix|live|en vivo|cover|reaction|sped up|slowed|nightcore|instrumental|letra|lyrics|tutorial|8d audio|reverb)/;

function normText(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(s: string): string[] {
  const n = normText(s);
  return n ? n.split(' ') : [];
}

export interface StreamCandidateInput {
  candidateTitle: string;
  candidateArtists?: string;
  candidateAuthor?: string;
  candidateDurationSec: number;
  isYtMusicSong?: boolean;
}

export function scoreAudioCandidate(
  target: { title: string; artist: string; durationSec: number },
  cand: StreamCandidateInput
): number {
  const rawNormTitle = normText(target.title);
  const strippedNormTitle = normText(stripTrackTitleNoise(target.title) || target.title);
  const cleanTitle = strippedNormTitle || rawNormTitle;
  const wantsSpecial = BAD_VERSION_RE.test(rawNormTitle);

  const candTitle = normText(cand.candidateTitle);
  const candStrippedTitle = normText(stripTrackTitleNoise(cand.candidateTitle) || cand.candidateTitle);
  if (!candTitle || cand.candidateDurationSec < 40) return -Infinity;

  if (!wantsSpecial && BAD_VERSION_RE.test(candTitle) && !BAD_VERSION_RE.test(cleanTitle)) {
    return -Infinity;
  }

  const targetDur = target.durationSec;
  if (targetDur > 45 && !wantsSpecial && Math.abs(cand.candidateDurationSec - targetDur) > 45) {
    return -Infinity;
  }

  const titleTokens = tokenize(cleanTitle);
  const sigTokens = titleTokens.filter((tok) => tok.length >= 2);
  const checkTokens = sigTokens.length > 0 ? sigTokens : titleTokens;
  const candTitleWords = new Set(tokenize(cand.candidateTitle));

  const matchedTokens = checkTokens.filter(
    (tok) => candTitleWords.has(tok) || candTitle.includes(tok)
  ).length;
  const titleOverlap = checkTokens.length > 0 ? matchedTokens / checkTokens.length : 0;

  const exactTitle =
    candTitle === cleanTitle ||
    candStrippedTitle === cleanTitle ||
    candTitle === rawNormTitle;

  if (!exactTitle && titleOverlap < 0.5) {
    return -Infinity;
  }

  const artistParts = target.artist
    .split(/,|&|\bfeat\.?\b|\bft\.?\b/i)
    .map((p) => normText(p))
    .filter(Boolean);
  const candArtistBlob = normText(
    `${cand.candidateArtists ?? ''} ${cand.candidateAuthor ?? ''}`
  );
  const candFullBlob = `${candArtistBlob} ${candTitle}`.trim();

  let artistMatchCount = 0;
  for (const part of artistParts) {
    const partCollapsed = part.replace(/\s+/g, '');
    const candBlobCollapsed = candFullBlob.replace(/\s+/g, '');
    if (
      (part.length >= 2 && candFullBlob.includes(part)) ||
      (partCollapsed.length >= 3 && candBlobCollapsed.includes(partCollapsed))
    ) {
      artistMatchCount++;
    } else {
      const aToks = tokenize(part).filter((w) => w.length >= 3);
      if (aToks.length > 0 && aToks.every((w) => candFullBlob.includes(w))) {
        artistMatchCount++;
      }
    }
  }

  const artistMatched = artistParts.length === 0 || artistMatchCount > 0;
  const durDiff = targetDur > 0 ? Math.abs(cand.candidateDurationSec - targetDur) : 0;
  if (!artistMatched && !(exactTitle && durDiff <= 8)) {
    return -Infinity;
  }

  let score = cand.isYtMusicSong ? 4 : 0;
  if (exactTitle) score += 8;
  else if (candTitle.includes(cleanTitle) || cleanTitle.includes(candStrippedTitle)) score += 5;
  score += Math.round(titleOverlap * 4);

  if (artistParts.length > 0) {
    score += artistMatchCount > 0 ? 6 + Math.min(3, artistMatchCount) : 0;
  }
  if (/topic|vevo|official|oficial/.test(candArtistBlob)) score += 2;
  if (/audio/.test(candTitle)) score += 1;
  if (targetDur > 0) {
    if (durDiff <= 3) score += 3;
    else if (durDiff <= 10) score += 1.5;
    else score -= Math.min(5, durDiff / 6);
  }

  return score;
}

/**
 * Resuelve y retransmite el audio COMPLETO de cualquier canción (catálogo Deezer,
 * IDs de YouTube Music o pistas curadas):
 * 1) Si ya es un videoId de YouTube (11 chars), descifra directo.
 * 2) Busca primero canciones oficiales en YouTube Music (`yt.music.search`).
 * 3) Respaldo a búsqueda estándar de YouTube (`yt.search`) y clientes IOS/YTMUSIC/ANDROID_VR.
 * 4) Solo usa fragmento de 30s de Deezer si YouTube falla por completo.
 */
export class AudioStreamResolver {
  private ytPromise: Promise<any> | null = null;
  private readonly cache = new Map<string, Resolved>();
  private readonly inflight = new Map<string, Promise<Resolved | null>>();
  private readonly catalog: DeezerCatalog;

  public constructor(catalog: DeezerCatalog) {
    this.catalog = catalog;
  }

  private async yt(): Promise<any> {
    if (!this.ytPromise) {
      this.ytPromise = (async () => {
        const mod: any = await import('youtubei.js');
        if (mod.Platform?.shim) {
          mod.Platform.shim.eval = async (data: { output: string }, env: Record<string, unknown>) =>
            new Function(...Object.keys(env), data.output)(...Object.values(env));
        }
        mod.Parser?.setParserErrorHandler?.(() => {});
        mod.Log?.setLevel?.(mod.Log.Level.NONE);
        const Innertube = mod.Innertube ?? mod.default;
        return Innertube.create({ lang: 'es', location: 'ES', retrieve_player: true });
      })().catch((e) => {
        this.ytPromise = null;
        throw e;
      });
    }
    return this.ytPromise;
  }

  private async isStreamableOpenRange(url: string): Promise<boolean> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    try {
      const res = await fetch(url, {
        headers: { Range: 'bytes=0-' },
        signal: controller.signal,
      });
      const ok = res.status === 200 || res.status === 206;
      void res.body?.cancel().catch(() => {});
      return ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  private async decipherVideo(yt: any, videoId: string): Promise<Resolved | null> {
    for (const client of AUDIO_CLIENTS) {
      try {
        const info = await yt.getBasicInfo(videoId, { client });
        const progressive = (info.streaming_data?.formats ?? [])
          .filter((f: any) => Boolean(f?.has_audio))
          .sort((a: any, b: any) => {
            const aPref = a?.itag === 18 || String(a?.mime_type ?? '').includes('mp4') ? 1 : 0;
            const bPref = b?.itag === 18 || String(b?.mime_type ?? '').includes('mp4') ? 1 : 0;
            if (aPref !== bPref) return bPref - aPref;
            return Number(b?.bitrate ?? 0) - Number(a?.bitrate ?? 0);
          });

        const adaptiveAudio = (info.streaming_data?.adaptive_formats ?? [])
          .filter((f: any) => Boolean(f?.has_audio) && !f?.has_video)
          .sort((a: any, b: any) => Number(b?.bitrate ?? 0) - Number(a?.bitrate ?? 0));

        for (const fmt of [...progressive, ...adaptiveAudio]) {
          try {
            const url = await fmt?.decipher(yt.session.player);
            if (!url) continue;
            if (await this.isStreamableOpenRange(url)) {
              return {
                url,
                mime: String(fmt.mime_type ?? 'video/mp4').split(';')[0]!,
                source: 'youtube-full',
                expiresAt: Date.now() + 90 * 60_000,
              };
            }
          } catch {
            // try next candidate format
          }
        }
      } catch {
        // try next YouTube client
      }
    }
    return null;
  }

  private async lookupTrackInfo(
    trackId: string,
    meta?: AudioStreamMeta
  ): Promise<{ title: string; artist: string; durationSec: number } | null> {
    if (isDeezerTrackId(trackId)) {
      try {
        const t = await this.catalog.track(trackId);
        return {
          title: t.title,
          artist: t.artists.map((a) => a.name).join(', ') || meta?.artist || '',
          durationSec: t.durationSec || meta?.durationSec || 200,
        };
      } catch {
        if (meta?.title) {
          return {
            title: meta.title,
            artist: meta.artist ?? '',
            durationSec: meta.durationSec ?? 200,
          };
        }
        return null;
      }
    }

    const fallback = FALLBACK_TRACKS.find((t) => t.id === trackId);
    if (fallback) {
      return {
        title: fallback.title,
        artist: fallback.artists.map((a) => a.name).join(', '),
        durationSec: fallback.durationSec,
      };
    }

    if (meta?.title?.trim()) {
      return {
        title: meta.title.trim(),
        artist: meta.artist?.trim() ?? '',
        durationSec: meta.durationSec ?? 200,
      };
    }

    return null;
  }

  private async resolveYoutube(trackId: string, meta?: AudioStreamMeta): Promise<Resolved | null> {
    const yt = await this.yt();

    if (YOUTUBE_ID_RE.test(trackId)) {
      const direct = await this.decipherVideo(yt, trackId);
      if (direct) return direct;
    }

    const info = await this.lookupTrackInfo(trackId, meta);
    if (!info) return null;

    const strippedTitle = stripTrackTitleNoise(info.title) || info.title.trim();
    const primaryArtist =
      info.artist.split(/,|&|\bfeat\.?\b|\bft\.?\b/i)[0]?.trim() || info.artist.trim();
    const focusedQuery = `${primaryArtist} ${strippedTitle}`.trim();

    // 1) Priority: YouTube Music official songs search with strict validation gate
    try {
      const ytMusicRes = await yt.music.search(focusedQuery, { type: 'song' });
      const musicCandidates: Array<{ id: string; score: number }> = [];
      for (const sec of ytMusicRes?.contents ?? []) {
        for (const item of sec?.contents ?? []) {
          const id = item?.id ?? item?.video_id;
          const dur = Number(item?.duration?.seconds ?? 0);
          if (typeof id !== 'string' || !YOUTUBE_ID_RE.test(id) || dur < 40) continue;
          const itemArtists = Array.isArray(item?.artists)
            ? item.artists.map((a: any) => a?.name ?? '').join(' ')
            : '';
          const score = scoreAudioCandidate(info, {
            candidateTitle: String(item?.title ?? item?.name ?? ''),
            candidateArtists: itemArtists,
            candidateDurationSec: dur,
            isYtMusicSong: true,
          });
          if (score >= 6) {
            musicCandidates.push({ id, score });
          }
        }
      }
      musicCandidates.sort((a, b) => b.score - a.score);
      for (const c of musicCandidates.slice(0, 3)) {
        const resolved = await this.decipherVideo(yt, c.id);
        if (resolved) return resolved;
      }
    } catch {
      // fall through to standard YouTube video search
    }

    // 2) Fallback: Standard YouTube video search with focused queries & strict gate
    const queries = Array.from(
      new Set([
        primaryArtist ? `${primaryArtist} - ${strippedTitle} audio` : strippedTitle,
        primaryArtist ? `${primaryArtist} ${strippedTitle} topic` : '',
        focusedQuery,
      ].filter(Boolean))
    );
    for (const q of queries) {
      try {
        const res = await yt.search(q, { type: 'video' });
        const candidates = (res?.videos ?? [])
          .filter((v: any) => v?.id && Number(v.duration?.seconds) >= 40)
          .map((v: any) => ({
            id: String(v.id),
            score: scoreAudioCandidate(info, {
              candidateTitle: String(v.title?.text ?? ''),
              candidateAuthor: String(v.author?.name ?? ''),
              candidateDurationSec: Number(v.duration.seconds),
              isYtMusicSong: false,
            }),
          }))
          .filter((c: { id: string; score: number }) => c.score >= 6)
          .sort((a: any, b: any) => b.score - a.score);

        for (const c of candidates.slice(0, 3)) {
          const resolved = await this.decipherVideo(yt, c.id);
          if (resolved) return resolved;
        }
      } catch {
        // try next query
      }
    }

    return null;
  }

  public async resolve(trackId: string, meta?: AudioStreamMeta): Promise<Resolved | null> {
    const cacheKey = `${trackId}::${meta?.title ?? ''}`;
    const hit = this.cache.get(cacheKey);
    if (hit && hit.expiresAt > Date.now()) return hit;

    let p = this.inflight.get(cacheKey);
    if (!p) {
      p = (async () => {
        let r: Resolved | null = null;
        try {
          r = await this.resolveYoutube(trackId, meta);
        } catch {
          r = null;
        }
        if (!r && isDeezerTrackId(trackId)) {
          const preview = await this.catalog.previewUrl(trackId).catch(() => null);
          if (preview) {
            r = {
              url: preview,
              mime: 'audio/mpeg',
              source: 'deezer-preview',
              expiresAt: Date.now() + 10 * 60_000,
            };
          }
        }
        if (r) this.cache.set(cacheKey, r);
        return r;
      })().finally(() => this.inflight.delete(cacheKey));
      this.inflight.set(cacheKey, p);
    }
    return p;
  }

  public canAttemptResolve(trackId: string, meta?: AudioStreamMeta): boolean {
    if (isDeezerTrackId(trackId) || YOUTUBE_ID_RE.test(trackId)) return true;
    if (FALLBACK_TRACKS.some((t) => t.id === trackId)) return true;
    return Boolean(meta?.title?.trim());
  }

  /** Streams audio with HTTP Range support; returns true if handled. */
  public async pipe(
    trackId: string,
    req: IncomingMessage,
    res: ServerResponse,
    meta?: AudioStreamMeta
  ): Promise<boolean> {
    if (!this.canAttemptResolve(trackId, meta)) return false;

    const cacheKey = `${trackId}::${meta?.title ?? ''}`;
    let resolved = await this.resolve(trackId, meta);
    if (!resolved) {
      return false;
    }

    const hasClientRange = typeof req.headers.range === 'string' && req.headers.range.trim().length > 0;
    const range = hasClientRange ? req.headers.range!.trim() : 'bytes=0-';
    let upstream = await fetch(resolved.url, { headers: { Range: range } }).catch(() => null);

    // Retry once with fresh decipher if cached YouTube URL expired (403/410)
    if (!upstream || (!upstream.ok && upstream.status !== 206)) {
      this.cache.delete(cacheKey);
      resolved = await this.resolve(trackId, meta);
      if (!resolved) {
        return false;
      }
      upstream = await fetch(resolved.url, { headers: { Range: range } }).catch(() => null);
    }

    if (!upstream || (!upstream.ok && upstream.status !== 206)) {
      this.cache.delete(cacheKey);
      return false;
    }

    res.setHeader('Content-Type', resolved.mime);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-PMusic-Stream-Source', resolved.source);
    if (!hasClientRange && upstream.status === 206) {
      res.statusCode = 200;
      const len = upstream.headers.get('content-length');
      if (len) res.setHeader('content-length', len);
    } else {
      res.statusCode = upstream.status;
      for (const h of ['content-length', 'content-range']) {
        const v = upstream.headers.get(h);
        if (v) res.setHeader(h, v);
      }
    }

    if (req.method === 'HEAD' || !upstream.body) {
      res.end();
      return true;
    }

    const reader = upstream.body.getReader();
    req.on('close', () => void reader.cancel().catch(() => {}));
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!res.write(value)) {
          await new Promise<void>((r) => res.once('drain', () => r()));
        }
      }
    } catch {
      // client closed connection
    }
    res.end();
    return true;
  }
}
