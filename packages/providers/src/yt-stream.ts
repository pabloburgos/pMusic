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

export type StreamSourceKind = 'youtube-full';

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

const ARTIST_ALIASES: Record<string, readonly string[]> = {
  'cruz cafune': ['cruzzi', 'cruz cafune'],
  cruzzi: ['cruz cafune', 'cruzzi'],
  'la pantera': ['la pantera', 'lapantera'],
  'c tangana': ['c tangana', 'pucho', 'crema'],
  'd valentino': ['d valentino', 'dvalentino'],
  dvalentino: ['d valentino', 'dvalentino'],
  'lucho rk': ['lucho rk', 'luchork'],
  'bad bunny': ['bad bunny', 'benito'],
};

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

  const rawArtistParts = target.artist
    .split(/,|&|\bfeat\.?\b|\bft\.?\b/i)
    .map((p) => normText(p))
    .filter(Boolean);
  const expandedArtistParts: string[] = [];
  for (const part of rawArtistParts) {
    expandedArtistParts.push(part);
    const aliases = ARTIST_ALIASES[part];
    if (aliases) {
      for (const al of aliases) {
        if (!expandedArtistParts.includes(al)) expandedArtistParts.push(al);
      }
    }
  }
  const candArtistBlob = normText(
    `${cand.candidateArtists ?? ''} ${cand.candidateAuthor ?? ''}`
  );
  const candFullBlob = `${candArtistBlob} ${candTitle}`.trim();

  let artistMatchCount = 0;
  for (const part of expandedArtistParts) {
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

  const artistMatched = rawArtistParts.length === 0 || artistMatchCount > 0;
  const targetDur = target.durationSec;
  const durDiff = targetDur > 0 ? Math.abs(cand.candidateDurationSec - targetDur) : 0;
  const candArtistPartsCount = (cand.candidateArtists ?? '')
    .split(/,|&|\bfeat\.?\b|\bft\.?\b/i)
    .map((p) => p.trim())
    .filter(Boolean).length;
  const candHasExtraCredits =
    candArtistPartsCount > rawArtistParts.length + 1 ||
    (candTitle !== rawNormTitle &&
      candTitle !== cleanTitle &&
      (candTitle.includes('feat') ||
        candTitle.includes('ft ') ||
        candTitle.includes('remix') ||
        candTitle.length > rawNormTitle.length + 10));

  if (targetDur > 45 && !wantsSpecial) {
    // Reject music videos or posse-cut remixes that deviate significantly from the real song duration.
    // Only allow a wider fallback tolerance on official YTMusic songs when the unstripped title is identical.
    const maxDurDiff =
      cand.isYtMusicSong && exactTitle && artistMatched && !candHasExtraCredits ? 180 : 28;
    if (durDiff > maxDurDiff) {
      return -Infinity;
    }
  }

  if (!artistMatched && !(exactTitle && durDiff <= 6)) {
    return -Infinity;
  }

  let score = cand.isYtMusicSong ? 4 : 0;
  if (candTitle === rawNormTitle || candTitle === cleanTitle) score += 10;
  else if (exactTitle) score += 6;
  else if (candTitle.includes(cleanTitle) || cleanTitle.includes(candStrippedTitle)) score += 4;
  score += Math.round(titleOverlap * 4);

  if (rawArtistParts.length > 0) {
    score += artistMatchCount > 0 ? 6 + Math.min(3, artistMatchCount) : 0;
  }
  if (/topic|vevo|official|oficial/.test(candArtistBlob)) score += 2;
  if (/audio|visualizer/.test(candTitle)) score += 2;
  if (!wantsSpecial && /video oficial|official video|music video|videoclip/.test(candTitle) && durDiff > 10) {
    score -= 10;
  }
  if (targetDur > 0) {
    if (durDiff <= 2) score += 16;
    else if (durDiff <= 5) score += 12;
    else if (durDiff <= 10) score += 6;
    else if (durDiff <= 18) score += 1;
    else if (durDiff <= 35) score -= Math.round(durDiff * 0.25);
    else score -= Math.round(9 + (durDiff - 35) * 0.01);
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
          .sort((a: any, b: any) => {
            const aMp4 = String(a?.mime_type ?? '').includes('mp4') ? 1 : 0;
            const bMp4 = String(b?.mime_type ?? '').includes('mp4') ? 1 : 0;
            if (aMp4 !== bMp4) return bMp4 - aMp4;
            return Number(b?.bitrate ?? 0) - Number(a?.bitrate ?? 0);
          });

        for (const fmt of [...adaptiveAudio, ...progressive]) {
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

    // 1) Priority: YouTube Music official songs search (strict then relaxed for underground tracks)
    const relaxedYtm: Array<{ id: string; score: number }> = [];
    try {
      const ytMusicRes = await yt.music.search(focusedQuery, { type: 'song' });
      const musicCandidates: Array<{ id: string; score: number }> = [];
      for (const sec of ytMusicRes?.contents ?? []) {
        for (const item of sec?.contents ?? []) {
          const id = item?.id ?? item?.video_id;
          const dur = Number(item?.duration?.seconds ?? 0);
          if (typeof id !== 'string' || !YOUTUBE_ID_RE.test(id) || dur < 40) continue;
          const artistArr = Array.isArray(item?.artists) ? item.artists : [];
          const itemArtists = artistArr
            .map((a: any) => a?.name ?? '')
            .filter(Boolean)
            .join(', ');
          const candTitleStr = String(item?.title ?? item?.name ?? '');
          const score = scoreAudioCandidate(info, {
            candidateTitle: candTitleStr,
            candidateArtists: itemArtists,
            candidateDurationSec: dur,
            isYtMusicSong: true,
          });
          if (score >= 6) {
            musicCandidates.push({ id, score });
          } else if (dur >= 45 && dur <= 900) {
            const normCand = normText(candTitleStr);
            const normTok = tokenize(strippedTitle).filter((t) => t.length >= 3);
            if (normTok.some((t) => normCand.includes(t)) && !BAD_VERSION_RE.test(normCand)) {
              relaxedYtm.push({ id, score: Number.isFinite(score) ? score : 0 });
            }
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

    // 2) Fallback: Standard YouTube video search with focused queries + underground relaxed rescue
    const queries = Array.from(
      new Set([
        primaryArtist ? `${primaryArtist} - ${strippedTitle} audio` : strippedTitle,
        primaryArtist ? `${primaryArtist} ${strippedTitle} topic` : '',
        focusedQuery,
        primaryArtist ? `${strippedTitle} ${primaryArtist}` : '',
      ].filter(Boolean))
    );
    const relaxedYt: Array<{ id: string; score: number }> = [];
    for (const q of queries) {
      try {
        const res = await yt.search(q, { type: 'video' });
        const candidates: Array<{ id: string; score: number }> = [];
        for (const v of res?.videos ?? []) {
          const vid = String(v?.id ?? '');
          const dur = Number(v?.duration?.seconds ?? 0);
          if (!vid || dur < 40) continue;
          const candTitleStr = String(v.title?.text ?? '');
          const candAuthor = String(v.author?.name ?? '');
          const sc = scoreAudioCandidate(info, {
            candidateTitle: candTitleStr,
            candidateAuthor: candAuthor,
            candidateDurationSec: dur,
            isYtMusicSong: false,
          });
          if (sc >= 6) {
            candidates.push({ id: vid, score: sc });
          } else if (dur >= 45 && dur <= 900) {
            const normCand = normText(candTitleStr);
            const normTok = tokenize(strippedTitle).filter((t) => t.length >= 3);
            if (normTok.some((t) => normCand.includes(t)) && !BAD_VERSION_RE.test(normCand)) {
              relaxedYt.push({ id: vid, score: Number.isFinite(sc) ? sc : 0 });
            }
          }
        }
        candidates.sort((a, b) => b.score - a.score);

        for (const c of candidates.slice(0, 3)) {
          const resolved = await this.decipherVideo(yt, c.id);
          if (resolved) return resolved;
        }
      } catch {
        // try next query
      }
    }

    // 3) Underground / obscure rescue pass (strict title token matched, duration >= 45s)
    const allRelaxed = [...relaxedYtm, ...relaxedYt].sort((a, b) => b.score - a.score);
    const seenIds = new Set<string>();
    for (const c of allRelaxed) {
      if (seenIds.has(c.id)) continue;
      seenIds.add(c.id);
      const resolved = await this.decipherVideo(yt, c.id);
      if (resolved) return resolved;
      if (seenIds.size >= 4) break;
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
