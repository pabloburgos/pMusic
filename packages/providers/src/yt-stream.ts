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

export type StreamSourceKind = 'youtube-full' | 'audius-full';

interface Resolved {
  url: string;
  mime: string;
  source: StreamSourceKind;
  expiresAt: number;
}

const YOUTUBE_ID_RE = /^[a-zA-Z0-9_-]{11}$/;
const AUDIO_CLIENTS = ['ANDROID', 'YTMUSIC', 'MWEB', 'IOS'] as const;
const HARD_UNWANTED_RE =
  /\b(karaoke|instrumental|backing track|sin voz|minus one|pista karaoke|cover|tribute|parodia|parody|ai cover|tutorial|piano version|guitar cover|ukulele|reaction|reaccion|8d audio|slowed|sped up|nightcore|reverb|bass boosted|acapella|a capella|mashup|bootleg|megamix|mixtape|dj set|break intro|dj intro|intro edit|lyrics|letra)\b/g;
const REMIX_VERSION_RE =
  /\b(remix|rmx|rework|refix|flip|vip mix|club mix|extended mix|radio edit)\b/;
const LIVE_VERSION_RE = /\b(live|en vivo|en directo|concierto|acoustic|acustico|unplugged)\b/;
const BAD_VERSION_RE =
  /\b(karaoke|remix|rmx|mashup|bootleg|flip|rework|refix|vip mix|club mix|extended mix|break intro|dj intro|intro edit|acapella|a capella|live|en vivo|cover|reaction|sped up|slowed|nightcore|instrumental|letra|lyrics|tutorial|8d audio|reverb|bass boosted|dj set|mixtape|megamix|tribute|parodia|parody|ai cover|pitched|radio edit|edit|version)\b/;

function hasHardUnwantedCandidateTerm(rawNormTitle: string, candText: string): boolean {
  const matches = candText.match(HARD_UNWANTED_RE);
  if (!matches) return false;
  for (const term of matches) {
    if (!rawNormTitle.includes(term)) return true;
  }
  return false;
}

function isCandidateVersionDisallowed(rawNormTitle: string, candTitle: string, candArtistText = ''): boolean {
  const combined = `${candTitle} ${candArtistText}`.trim();
  if (hasHardUnwantedCandidateTerm(rawNormTitle, combined)) return true;
  if (!REMIX_VERSION_RE.test(rawNormTitle) && REMIX_VERSION_RE.test(candTitle)) return true;
  if (!LIVE_VERSION_RE.test(rawNormTitle) && LIVE_VERSION_RE.test(combined)) return true;
  return false;
}

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
  const wantsRemix = REMIX_VERSION_RE.test(rawNormTitle);

  const candTitle = normText(cand.candidateTitle);
  const candStrippedTitle = normText(stripTrackTitleNoise(cand.candidateTitle) || cand.candidateTitle);
  const candArtistNorm = normText(`${cand.candidateArtists ?? ''} ${cand.candidateAuthor ?? ''}`);
  if (!candTitle || cand.candidateDurationSec < 40) return -Infinity;

  if (isCandidateVersionDisallowed(rawNormTitle, candTitle, candArtistNorm)) {
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
  if (wantsRemix) {
    score += REMIX_VERSION_RE.test(candTitle) ? 8 : -6;
  }

  if (rawArtistParts.length > 0) {
    score += artistMatchCount > 0 ? 6 + Math.min(3, artistMatchCount) : 0;
  }
  if (/topic|vevo|official|oficial/.test(candArtistBlob)) score += 2;
  if (/audio|visualizer/.test(candTitle)) score += 2;
  if (!wantsSpecial && /video oficial|official video|music video|videoclip/.test(candTitle) && durDiff > 10) {
    score -= 10;
  }
  if (targetDur > 0) {
    const isVerifiedYtmExact = Boolean(cand.isYtMusicSong && exactTitle && artistMatched);
    if (
      targetDur >= 45 &&
      durDiff > Math.max(40, Math.round(targetDur * 0.45)) &&
      !isVerifiedYtmExact
    ) {
      return -Infinity;
    }
    if (durDiff <= 2) score += 16;
    else if (durDiff <= 5) score += 12;
    else if (durDiff <= 10) score += 6;
    else if (durDiff <= 18) score += 1;
    else if (durDiff <= 35) score -= Math.round(durDiff * 0.25);
    else score -= isVerifiedYtmExact
      ? Math.round(9 + (durDiff - 35) * 0.01)
      : Math.min(40, Math.round(9 + (durDiff - 35) * 0.25));
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
  private ytCreatedAtMs = 0;
  private readonly cache = new Map<string, Resolved>();
  private readonly inflight = new Map<string, Promise<Resolved | null>>();
  private readonly catalog: DeezerCatalog;
  private lastFailureReason: 'bot_check' | 'not_found' | null = null;
  private botCheckCooldownUntilMs = 0;

  public constructor(catalog: DeezerCatalog) {
    this.catalog = catalog;
  }

  public getLastFailureReason(): 'bot_check' | 'not_found' | null {
    return this.lastFailureReason;
  }

  private async yt(): Promise<any> {
    // Periodically refresh InnerTube player/cipher during multi-hour listening sessions
    if (this.ytPromise && this.ytCreatedAtMs > 0 && Date.now() - this.ytCreatedAtMs > 45 * 60_000) {
      this.ytPromise = null;
    }
    if (!this.ytPromise) {
      this.ytCreatedAtMs = Date.now();
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
        this.ytCreatedAtMs = 0;
        throw e;
      });
    }
    return this.ytPromise;
  }

  private async isStreamableOpenRange(url: string): Promise<boolean> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
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

  private async decipherVideo(
    yt: any,
    videoId: string,
    expectedDurationSec?: number
  ): Promise<Resolved | null> {
    const formatMatchesDuration = (f: any): boolean => {
      if (!expectedDurationSec || expectedDurationSec < 45) return true;
      const approxSec = Number(f?.approx_duration_ms ?? 0) / 1000;
      if (!Number.isFinite(approxSec) || approxSec <= 10) return true;
      return Math.abs(approxSec - expectedDurationSec) <= Math.max(35, expectedDurationSec * 0.4);
    };

    let botCheckRejects = 0;
    let triedClients = 0;

    for (const client of AUDIO_CLIENTS) {
      triedClients++;
      try {
        const info = await yt.getBasicInfo(videoId, { client });
        const statusStr = String(info?.playability_status?.status ?? '');
        const reasonStr = String(info?.playability_status?.reason ?? '').toLowerCase();
        if (
          statusStr === 'LOGIN_REQUIRED' &&
          (reasonStr.includes('bot') || reasonStr.includes('inicia sesi') || reasonStr.includes('sign in'))
        ) {
          botCheckRejects++;
          continue;
        }

        const progressive = (info.streaming_data?.formats ?? [])
          .filter((f: any) => Boolean(f?.has_audio) && formatMatchesDuration(f))
          .sort((a: any, b: any) => {
            const aPref = a?.itag === 18 || String(a?.mime_type ?? '').includes('mp4') ? 1 : 0;
            const bPref = b?.itag === 18 || String(b?.mime_type ?? '').includes('mp4') ? 1 : 0;
            if (aPref !== bPref) return bPref - aPref;
            return Number(b?.bitrate ?? 0) - Number(a?.bitrate ?? 0);
          });

        const adaptiveAudio = (info.streaming_data?.adaptive_formats ?? [])
          .filter((f: any) => Boolean(f?.has_audio) && !f?.has_video && formatMatchesDuration(f))
          .sort((a: any, b: any) => {
            const aMp4 = String(a?.mime_type ?? '').includes('mp4') ? 1 : 0;
            const bMp4 = String(b?.mime_type ?? '').includes('mp4') ? 1 : 0;
            if (aMp4 !== bMp4) return bMp4 - aMp4;
            return Number(b?.bitrate ?? 0) - Number(a?.bitrate ?? 0);
          });

        for (const fmt of [...progressive, ...adaptiveAudio]) {
          try {
            const url = await fmt?.decipher(yt.session.player);
            if (!url) continue;
            if (await this.isStreamableOpenRange(url)) {
              this.lastFailureReason = null;
              this.botCheckCooldownUntilMs = 0;
              return {
                url,
                mime: String(fmt.mime_type ?? 'video/mp4').split(';')[0]!,
                source: 'youtube-full',
                expiresAt: Date.now() + 35 * 60_000,
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

    if (triedClients > 0 && botCheckRejects === triedClients) {
      this.lastFailureReason = 'bot_check';
      this.botCheckCooldownUntilMs = Date.now() + 45_000;
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
    this.lastFailureReason = null;
    const yt = await this.yt();

    if (YOUTUBE_ID_RE.test(trackId)) {
      const direct = await this.decipherVideo(yt, trackId, meta?.durationSec);
      if (direct) return direct;
      if (this.lastFailureReason === 'bot_check') return null;
    }

    const info = await this.lookupTrackInfo(trackId, meta);
    if (!info) {
      this.lastFailureReason = 'not_found';
      return null;
    }

    const strippedTitle = stripTrackTitleNoise(info.title) || info.title.trim();
    const primaryArtist =
      info.artist.split(/,|&|\bfeat\.?\b|\bft\.?\b/i)[0]?.trim() || info.artist.trim();
    const focusedQuery = `${primaryArtist} ${strippedTitle}`.trim();
    const maxRelaxDelta =
      info.durationSec >= 45 ? Math.max(25, Math.round(info.durationSec * 0.25)) : 120;
    const isRelaxDurationOk = (dur: number): boolean =>
      info.durationSec >= 45
        ? Math.abs(dur - info.durationSec) <= maxRelaxDelta
        : dur >= 45 && dur <= 600;

    const rawNormInfoTitle = normText(info.title);
    const artistTokens = tokenize(primaryArtist).filter((t) => t.length >= 2);

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
          } else if (isRelaxDurationOk(dur)) {
            const normCand = normText(candTitleStr);
            const normArt = normText(itemArtists);
            const normCombined = normText(`${candTitleStr} ${itemArtists}`);
            const normTok = tokenize(strippedTitle).filter((t) => t.length >= 3);
            const artistOk =
              artistTokens.length === 0 || artistTokens.some((a) => normCombined.includes(a));
            if (
              normTok.some((t) => normCand.includes(t)) &&
              artistOk &&
              !isCandidateVersionDisallowed(rawNormInfoTitle, normCand, normArt)
            ) {
              relaxedYtm.push({ id, score: Number.isFinite(score) ? score : 0 });
            }
          }
        }
      }
      musicCandidates.sort((a, b) => b.score - a.score);
      for (const c of musicCandidates.slice(0, 3)) {
        const resolved = await this.decipherVideo(yt, c.id, info.durationSec);
        if (resolved) return resolved;
        if (this.lastFailureReason === 'bot_check') return null;
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
          } else if (isRelaxDurationOk(dur)) {
            const normCand = normText(candTitleStr);
            const normAuth = normText(candAuthor);
            const normCombined = normText(`${candTitleStr} ${candAuthor}`);
            const normTok = tokenize(strippedTitle).filter((t) => t.length >= 3);
            const artistOk =
              artistTokens.length === 0 || artistTokens.some((a) => normCombined.includes(a));
            if (
              normTok.some((t) => normCand.includes(t)) &&
              artistOk &&
              !isCandidateVersionDisallowed(rawNormInfoTitle, normCand, normAuth)
            ) {
              relaxedYt.push({ id: vid, score: Number.isFinite(sc) ? sc : 0 });
            }
          }
        }
        candidates.sort((a, b) => b.score - a.score);

        for (const c of candidates.slice(0, 3)) {
          const resolved = await this.decipherVideo(yt, c.id, info.durationSec);
          if (resolved) return resolved;
          if (this.lastFailureReason === 'bot_check') return null;
        }
      } catch {
        // try next query
      }
    }

    // 3) Underground / obscure rescue pass (strict title token & duration matched)
    const allRelaxed = [...relaxedYtm, ...relaxedYt].sort((a, b) => b.score - a.score);
    const seenIds = new Set<string>();
    for (const c of allRelaxed) {
      if (seenIds.has(c.id)) continue;
      seenIds.add(c.id);
      const resolved = await this.decipherVideo(yt, c.id, info.durationSec);
      if (resolved) return resolved;
      if (this.lastFailureReason === 'bot_check') return null;
      if (seenIds.size >= 4) break;
    }

    this.lastFailureReason = 'not_found';
    return null;
  }

  private async resolveAudius(info: {
    title: string;
    artist: string;
    durationSec: number;
  }): Promise<Resolved | null> {
    const strippedTitle = stripTrackTitleNoise(info.title) || info.title.trim();
    const primaryArtist =
      info.artist.split(/,|&|\bfeat\.?\b|\bft\.?\b/i)[0]?.trim() || info.artist.trim();
    const focusedQuery = `${primaryArtist} ${strippedTitle}`.trim();
    const queries = Array.from(new Set([focusedQuery, strippedTitle].filter(Boolean)));
    const rawNormTitle = normText(info.title);

    const strictMatches: Array<{ id: string; score: number }> = [];

    for (const q of queries) {
      try {
        const res = await fetch(
          `https://api.audius.co/v1/tracks/search?query=${encodeURIComponent(q)}&app_name=pMusic`,
          {
            headers: { Accept: 'application/json' },
            signal: AbortSignal.timeout(4000),
          }
        );
        if (!res.ok) continue;
        const json = (await res.json()) as { data?: Array<Record<string, any>> };
        const items = Array.isArray(json?.data) ? json.data : [];

        for (const item of items.slice(0, 12)) {
          const id = String(item?.id ?? '').trim();
          const dur = Number(item?.duration ?? 0);
          if (!id || item?.is_streamable === false || dur < 40) continue;
          const candTitle = String(item?.title ?? '');
          const candArtist = String(item?.user?.name ?? '');
          const candHandle = String(item?.user?.handle ?? '');
          if (isCandidateVersionDisallowed(rawNormTitle, normText(candTitle), normText(candArtist))) {
            continue;
          }
          // Require the Audius uploader itself to match the track artist so third-party DJ edits cannot masquerade
          if (primaryArtist) {
            const normPrimary = normText(primaryArtist);
            const normUploader = normText(`${candArtist} ${candHandle}`);
            const uploaderMatch =
              normUploader.includes(normPrimary) ||
              normUploader.replace(/\s+/g, '').includes(normPrimary.replace(/\s+/g, '')) ||
              tokenize(primaryArtist)
                .filter((t) => t.length >= 3)
                .some((t) => normUploader.includes(t));
            if (!uploaderMatch) continue;
          }
          const sc = scoreAudioCandidate(info, {
            candidateTitle: candTitle,
            candidateArtists: candArtist,
            candidateDurationSec: dur,
            isYtMusicSong: true,
          });
          if (sc >= 8) {
            strictMatches.push({ id, score: sc });
          }
        }
        if (strictMatches.length > 0) break;
      } catch {
        // try next Audius search query
      }
    }

    const ordered = strictMatches.sort((a, b) => b.score - a.score);

    const seen = new Set<string>();
    for (const cand of ordered) {
      if (seen.has(cand.id)) continue;
      seen.add(cand.id);
      const streamUrl = `https://api.audius.co/v1/tracks/${encodeURIComponent(cand.id)}/stream?app_name=pMusic`;
      if (await this.isStreamableOpenRange(streamUrl)) {
        return {
          url: streamUrl,
          mime: 'audio/mpeg',
          source: 'audius-full',
          expiresAt: Date.now() + 90 * 60_000,
        };
      }
      if (seen.size >= 3) break;
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
        if (Date.now() >= this.botCheckCooldownUntilMs) {
          try {
            r = await this.resolveYoutube(trackId, meta);
          } catch {
            r = null;
          }
        } else {
          this.lastFailureReason = 'bot_check';
        }
        if (!r) {
          const info = await this.lookupTrackInfo(trackId, meta);
          if (info) {
            const audius = await this.resolveAudius(info);
            if (audius) {
              r = audius;
              this.lastFailureReason = null;
            }
          }
        }
        if (r) {
          if (this.cache.size >= 40) {
            const oldestKey = this.cache.keys().next().value;
            if (oldestKey) this.cache.delete(oldestKey);
          }
          this.cache.set(cacheKey, r);
        }
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
    const ac = new AbortController();
    let clientClosed = false;
    let resolveDrain: (() => void) | null = null;
    const onClientClose = () => {
      clientClosed = true;
      try {
        ac.abort();
      } catch {
        // ignore abort failure
      }
      if (resolveDrain) {
        const fn = resolveDrain;
        resolveDrain = null;
        fn();
      }
    };
    req.once('close', onClientClose);
    res.once('close', onClientClose);

    let upstream = await fetch(resolved.url, {
      headers: { Range: range },
      signal: ac.signal,
    }).catch(() => null);

    // Retry once with fresh decipher if cached YouTube URL expired (403/410)
    if (!clientClosed && (!upstream || (!upstream.ok && upstream.status !== 206))) {
      this.cache.delete(cacheKey);
      resolved = await this.resolve(trackId, meta);
      if (!resolved || clientClosed) {
        req.off('close', onClientClose);
        res.off('close', onClientClose);
        return false;
      }
      upstream = await fetch(resolved.url, {
        headers: { Range: range },
        signal: ac.signal,
      }).catch(() => null);
    }

    if (clientClosed || !upstream || (!upstream.ok && upstream.status !== 206)) {
      req.off('close', onClientClose);
      res.off('close', onClientClose);
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
      req.off('close', onClientClose);
      res.off('close', onClientClose);
      if (!res.writableEnded && !res.destroyed) res.end();
      return true;
    }

    const reader = upstream.body.getReader();
    try {
      for (;;) {
        if (clientClosed || res.destroyed || res.writableEnded) break;
        const { done, value } = await reader.read();
        if (done || clientClosed || res.destroyed || res.writableEnded) break;
        if (!res.write(value)) {
          await new Promise<void>((r) => {
            if (clientClosed || res.destroyed || res.writableEnded) {
              r();
              return;
            }
            resolveDrain = r;
            const onDrain = () => {
              if (resolveDrain === r) resolveDrain = null;
              r();
            };
            res.once('drain', onDrain);
          });
        }
      }
    } catch {
      // client closed connection or fetch aborted
    } finally {
      req.off('close', onClientClose);
      res.off('close', onClientClose);
      resolveDrain = null;
      try {
        reader.releaseLock();
      } catch {
        // ignore lock release failure
      }
      if (!res.writableEnded && !res.destroyed) {
        res.end();
      }
    }
    return true;
  }
}
