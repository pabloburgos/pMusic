import type {
  AlbumDetail,
  AlbumSummary,
  ArtistDetail,
  ArtistSummary,
  HomeFeedResult,
  PlaylistDetail,
  PlaylistSummary,
  RelatedResult,
  SearchFilter,
  SearchResultBundle,
  Track,
  TrackCreditPerson,
  TrackCredits,
} from '@pmusic/core';

/**
 * Catálogo real y gratuito (sin claves) basado en la API pública de Deezer:
 * millones de canciones, artistas, álbumes y listas con carátulas oficiales.
 * El audio completo se resuelve aparte (YouTube) en el proxy de streaming.
 */
const DEEZER_COVER_HASH_RE = /\/images\/cover\/([a-f0-9]{16,})\//i;

export function filterWaterfallAlbumSingles<
  T extends { id: string; title: string; thumbnailUrl?: string; releaseDate?: string; year?: number }
>(albums: T[], singles: T[]): T[] {
  if (!albums.length || !singles.length) return singles;
  const parseTs = (iso?: string): number | null => {
    if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return null;
    const ms = Date.parse(iso.slice(0, 10));
    return Number.isFinite(ms) ? ms : null;
  };
  const albumByCover = new Map<string, Array<{ ts: number | null; year?: number }>>();
  for (const al of albums) {
    const m = (al.thumbnailUrl ?? '').match(DEEZER_COVER_HASH_RE);
    if (!m?.[1]) continue;
    const hash = m[1].toLowerCase();
    const list = albumByCover.get(hash) ?? [];
    list.push({ ts: parseTs(al.releaseDate), year: al.year });
    albumByCover.set(hash, list);
  }
  const WATERFALL_WINDOW_MS = 21 * 86_400_000;
  return singles.filter((sg) => {
    const m = (sg.thumbnailUrl ?? '').match(DEEZER_COVER_HASH_RE);
    if (!m?.[1]) return true;
    const candidates = albumByCover.get(m[1].toLowerCase());
    if (!candidates?.length) return true;
    const sTs = parseTs(sg.releaseDate);
    for (const al of candidates) {
      if (sTs !== null && al.ts !== null) {
        if (Math.abs(sTs - al.ts) <= WATERFALL_WINDOW_MS) return false;
      } else if (!sg.year || !al.year || sg.year === al.year) {
        return false;
      }
    }
    return true;
  });
}

const API = 'https://api.deezer.com';
const YTM_WEB_REMIX_CLIENT = {
  clientName: 'WEB_REMIX',
  clientVersion: '1.20250310.01.00',
  hl: 'es',
  gl: 'ES',
};

function collectObjectsByKey(
  root: unknown,
  targetKey: string,
  out: Array<Record<string, any>> = [],
  depth = 0,
  maxItems = 60
): Array<Record<string, any>> {
  if (!root || typeof root !== 'object' || depth > 24 || out.length >= maxItems) return out;
  if (Array.isArray(root)) {
    for (const item of root) collectObjectsByKey(item, targetKey, out, depth + 1, maxItems);
    return out;
  }
  const rec = root as Record<string, any>;
  for (const [k, v] of Object.entries(rec)) {
    if (k === targetKey && v && typeof v === 'object') {
      out.push(v as Record<string, any>);
    }
    if (v && typeof v === 'object') {
      collectObjectsByKey(v, targetKey, out, depth + 1, maxItems);
    }
  }
  return out;
}

function readRunsText(node: any): string {
  if (!node || !Array.isArray(node.runs)) return '';
  return node.runs.map((r: any) => String(r?.text ?? '')).join('').trim();
}

function upscaleYtmImageUrl(url: string, targetW: number, targetH: number): string {
  if (!url) return '';
  if (/=w\d+-h\d+/.test(url)) {
    return url.replace(/=w\d+-h\d+[^?#]*/, `=w${targetW}-h${targetH}-p-l90-rj`);
  }
  return url;
}

const CANONICAL_ARTIST_ALIASES: Record<
  string,
  { canonicalName: string; canonicalDeezerId: string }
> = {
  'cruz cafune': { canonicalName: 'Cruzzi', canonicalDeezerId: '73148212' },
  cruzzi: { canonicalName: 'Cruzzi', canonicalDeezerId: '73148212' },
};

const CANONICAL_ARTIST_ID_REDIRECTS: Record<string, string> = {
  '10125390': '73148212',
};

const MERGED_CANONICAL_ARTIST_IDS: Record<string, readonly string[]> = {
  '73148212': ['73148212', '10125390'],
};

export function canonicalizeArtistIdentity(
  id?: string,
  name?: string
): { id?: string; name: string } {
  const rawName = (name ?? '').trim();
  const rawId = id ? String(id).trim() : undefined;
  const norm = rawName ? normalizeSearchStr(rawName) : '';
  const alias = norm ? CANONICAL_ARTIST_ALIASES[norm] : undefined;
  if (alias) {
    const nextId =
      !rawId || rawId === '10125390' || /^\d+$/.test(rawId)
        ? alias.canonicalDeezerId
        : rawId;
    return { id: nextId, name: alias.canonicalName };
  }
  if (rawId && CANONICAL_ARTIST_ID_REDIRECTS[rawId]) {
    return { id: CANONICAL_ARTIST_ID_REDIRECTS[rawId], name: rawName || 'Cruzzi' };
  }
  return rawId ? { id: rawId, name: rawName } : { name: rawName };
}

/**
 * Parses YouTube Music artist subtitle audience counts such as
 * "Artista • 1,07 M usuarios mensuales", "236 K suscriptores", or "1 suscriptor".
 */
export function parseYtmAudienceCount(text: string): number {
  if (!text) return 0;
  const m = text.match(/([\d.,]+)\s*([kmb])?\s*(?:usuarios mensuales|oyentes mensuales|monthly listeners|suscriptor(?:es)?|subscriber(?:s)?)/i);
  if (!m || !m[1]) return 0;
  const numStr = m[1].replace(/\./g, '').replace(',', '.');
  const val = Number.parseFloat(numStr);
  if (!Number.isFinite(val)) return 0;
  const unit = (m[2] ?? '').toLowerCase();
  if (unit === 'k') return Math.round(val * 1_000);
  if (unit === 'm') return Math.round(val * 1_000_000);
  if (unit === 'b') return Math.round(val * 1_000_000_000);
  return Math.round(val);
}

function pickPreferredThumb(
  thumbs: unknown,
  idealWidth = 1440
): { url: string; width: number; height: number } | null {
  if (!Array.isArray(thumbs) || thumbs.length === 0) return null;
  const parsed: Array<{ url: string; width: number; height: number }> = [];
  for (const t of thumbs) {
    if (!t || typeof t !== 'object') continue;
    const url = String((t as any).url ?? '').trim();
    if (!url) continue;
    const width = Number((t as any).width ?? 0);
    const height = Number((t as any).height ?? 0);
    parsed.push({ url, width, height });
  }
  if (parsed.length === 0) return null;
  const fitting = parsed
    .filter((t) => t.width >= idealWidth)
    .sort((a, b) => a.width - b.width);
  if (fitting.length > 0) return fitting[0]!;
  return parsed.sort((a, b) => b.width - a.width)[0]!;
}

/** Rejects Deezer empty-hash artist placeholders that return broken or generic blank silhouette URLs. */
export function sanitizeArtistImageUrl(rawUrl?: string | null): string {
  const url = String(rawUrl ?? '').trim();
  if (!url) return '';
  if (/images\/artist\/\/|\/artist\/d41d8cd98f00b204e9800998ecf8427e/i.test(url)) {
    return '';
  }
  return url;
}

export interface ParsedYouTubeCredits {
  performers: TrackCreditPerson[];
  producers: string[];
  composers: string[];
  lyricists: string[];
  engineers: string[];
  label?: string;
  distributor?: string;
  releaseDate?: string;
}

/**
 * Parses structured DDEX credits from YouTube auto-generated "Provided to YouTube by ..." descriptions
 * (Producer, Composer, Lyricist, Mixer, Mastering Engineer, label ℗, release date, distributor).
 */
export function parseYouTubeDescriptionCredits(shortDescription: string): ParsedYouTubeCredits {
  const performers: TrackCreditPerson[] = [];
  const producers: string[] = [];
  const composers: string[] = [];
  const lyricists: string[] = [];
  const engineers: string[] = [];
  let label: string | undefined;
  let distributor: string | undefined;
  let releaseDate: string | undefined;

  if (!shortDescription) {
    return { performers, producers, composers, lyricists, engineers };
  }

  const seenPerf = new Set<string>();
  const seenProd = new Set<string>();
  const seenComp = new Set<string>();
  const seenLyric = new Set<string>();
  const seenEng = new Set<string>();

  const pushUnique = (list: string[], seen: Set<string>, rawVal: string) => {
    const clean = rawVal.trim().replace(/^[,;·]+|[,;·]+$/g, '').trim();
    if (!clean || /^auto-generated/i.test(clean)) return;
    const key = normalizeSearchStr(clean);
    if (!key || seen.has(key)) return;
    seen.add(key);
    list.push(clean);
  };

  const pushPerformer = (rawVal: string, roleLabel: string) => {
    const clean = rawVal.trim();
    if (!clean) return;
    const key = `${normalizeSearchStr(clean)}::${roleLabel.toLowerCase()}`;
    if (!key || seenPerf.has(key)) return;
    seenPerf.add(key);
    performers.push({ name: clean, role: roleLabel });
  };

  const splitCreditNames = (raw: string): string[] =>
    raw
      .split(/\s*(?:,|;|\/|\sy\s|\sand\s)\s*/i)
      .map((s) => s.trim())
      .filter(Boolean);

  const lines = shortDescription.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (/^provided to youtube by\s+/i.test(line)) {
      const dist = line.replace(/^provided to youtube by\s+/i, '').trim();
      if (dist && !distributor) distributor = dist;
      continue;
    }

    if (/^℗\s*/.test(line)) {
      const cleaned = line
        .replace(/^℗\s*/, '')
        .replace(/^\d{4}\s+/, '')
        .trim();
      if (cleaned && !label) label = cleaned;
      continue;
    }

    if (/^released on\s*:/i.test(line)) {
      const dt = line.replace(/^released on\s*:\s*/i, '').trim();
      if (dt && !releaseDate) releaseDate = dt;
      continue;
    }

    const colonIdx = line.indexOf(':');
    if (colonIdx <= 0 || colonIdx > 48) continue;
    const rawRole = line.slice(0, colonIdx).trim();
    const rawNames = line.slice(colonIdx + 1).trim();
    if (!rawNames) continue;
    const roleLower = rawRole.toLowerCase();

    if (
      /^(?:co[- ]?)?producer$|^executive producer$|^additional producer$|^vocal producer$|^beatmaker$|^producci[oó]n$|^productor/i.test(
        roleLower
      )
    ) {
      for (const n of splitCreditNames(rawNames)) pushUnique(producers, seenProd, n);
      continue;
    }

    if (/composer\s*[,&/]?\s*lyricist|writer\s*[,&/]?\s*composer/i.test(roleLower)) {
      for (const n of splitCreditNames(rawNames)) {
        pushUnique(composers, seenComp, n);
        pushUnique(lyricists, seenLyric, n);
      }
      continue;
    }

    if (/^(?:composer|music|composici[oó]n|compositor)/i.test(roleLower)) {
      for (const n of splitCreditNames(rawNames)) pushUnique(composers, seenComp, n);
      continue;
    }

    if (/^(?:lyricist|author|writer|songwriter|text|letra|letrista)/i.test(roleLower)) {
      for (const n of splitCreditNames(rawNames)) pushUnique(lyricists, seenLyric, n);
      continue;
    }

    if (
      /mixer|mixing|masterer|mastering|recording engineer|sound engineer|studio personnel|\bengineer\b/i.test(
        roleLower
      )
    ) {
      for (const n of splitCreditNames(rawNames)) {
        pushUnique(engineers, seenEng, `${n} (${rawRole})`);
      }
      continue;
    }

    if (/associated performer|vocals|featured artist|main artist|background vocals/i.test(roleLower)) {
      const roleLabel = /featured/i.test(roleLower)
        ? 'Artista invitado'
        : /vocal/i.test(roleLower)
          ? 'Voz'
          : 'Intérprete';
      for (const n of splitCreditNames(rawNames)) pushPerformer(n, roleLabel);
    }
  }

  return {
    performers,
    producers,
    composers,
    lyricists,
    engineers,
    ...(label ? { label } : {}),
    ...(distributor ? { distributor } : {}),
    ...(releaseDate ? { releaseDate } : {}),
  };
}

export const DZ_PREFIX = 'dz:';
export const toTrackId = (dzId: number | string): string => `${DZ_PREFIX}${dzId}`;
export const isDeezerTrackId = (id: string): boolean => id.startsWith(DZ_PREFIX);

/**
 * Extracts featured artist names from song titles like
 * "Cayó La Noche (feat. Cruzzi, Abhir Hathi, Bejo) [Remix]" or "Song ft. Artist1 & Artist2".
 */
export function parseFeaturedArtistsFromTitle(title: string): string[] {
  if (!title) return [];
  const results: string[] = [];
  const bracketRe = /[([]\s*(?:feat\.?|ft\.?|featuring|with|con)\s+([^)\]]+)[)\]]/gi;
  const inlineRe = /(?:^|\s)(?:feat\.?|ft\.?|featuring)\s+([^(\[]+)$/i;

  const pushChunk = (raw: string) => {
    const cleaned = raw
      .replace(/\s*(?:remix|version|versión|en vivo|live|official.*|audio.*|video.*)$/i, '')
      .trim();
    if (!cleaned) return;
    const parts = cleaned.split(/\s*(?:,|&|\/|\sy\s|\sx\s|\+)\s*/i);
    for (const part of parts) {
      const name = part.replace(/^["']|["']$/g, '').trim();
      if (
        name.length >= 2 &&
        !/^(?:remix|edit|version|versión|prod\.?|official|video|audio)$/i.test(name) &&
        !results.some((r) => r.toLowerCase() === name.toLowerCase())
      ) {
        results.push(name);
      }
    }
  };

  let m: RegExpExecArray | null;
  while ((m = bracketRe.exec(title)) !== null) {
    if (m[1]) pushChunk(m[1]);
  }
  const stripped = title.replace(bracketRe, '').trim();
  const inMatch = inlineRe.exec(stripped);
  if (inMatch?.[1]) {
    pushChunk(inMatch[1]);
  }
  return results;
}

type Json = Record<string, any>;

export function normalizeReleaseTitle(title: string): string {
  return String(title ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\([^)]*(?:feat\.?|ft\.?|con|with|deluxe|edici[oó]n|explicit|remix|remaster|version|versi[oó]n)[^)]*\)/gi, ' ')
    .replace(/\[[^\]]*(?:deluxe|explicit|remix|remaster|version|versi[oó]n)[^\]]*\]/gi, ' ')
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeSearchStr(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function collapseSearchStr(input: string): string {
  return normalizeSearchStr(input).replace(/\s+/g, '');
}

function tokenizeSearchStr(input: string): string[] {
  const clean = normalizeSearchStr(input);
  return clean ? clean.split(' ') : [];
}

function scoreFieldTokens(
  queryTokens: readonly string[],
  normQuery: string,
  title: string,
  artistNames: readonly string[],
  albumName?: string
): number {
  if (!normQuery || queryTokens.length === 0) return 0;
  const collapsedQuery = normQuery.replace(/\s+/g, '');
  const normTitle = normalizeSearchStr(title);
  const titleWords = new Set(tokenizeSearchStr(title));
  const normArtists = artistNames.map((n) => normalizeSearchStr(n)).filter(Boolean);
  const collapsedArtists = artistNames.map((n) => collapseSearchStr(n)).filter(Boolean);
  const artistWordSet = new Set(normArtists.flatMap((a) => tokenizeSearchStr(a)));
  const normAlbum = albumName ? normalizeSearchStr(albumName) : '';
  const albumWords = new Set(normAlbum ? tokenizeSearchStr(normAlbum) : []);

  let score = 0;

  if (normTitle === normQuery) score += 180;
  if (collapsedArtists.some((a) => a === collapsedQuery)) score += 155;
  for (const a of normArtists) {
    if (`${a} ${normTitle}` === normQuery || `${normTitle} ${a}` === normQuery) {
      score += 185;
      break;
    }
  }

  let matchedInTitleCount = 0;
  let matchedInArtistCount = 0;
  let totalCoveredTokens = 0;

  for (const tok of queryTokens) {
    const inTitleWord = titleWords.has(tok);
    const inArtistWord = artistWordSet.has(tok);
    const inAlbumWord = albumWords.has(tok);

    if (inTitleWord) {
      matchedInTitleCount++;
      score += 34;
    } else if (normTitle.includes(tok)) {
      score += 7;
    }

    if (inArtistWord) {
      matchedInArtistCount++;
      score += 30;
    } else if (normArtists.some((a) => a.includes(tok))) {
      score += 6;
    }

    if (!inTitleWord && !inArtistWord && inAlbumWord) {
      score += 14;
    }

    if (inTitleWord || inArtistWord || inAlbumWord) {
      totalCoveredTokens++;
    }
  }

  // Split Artist + Track intent (e.g. "pablete diabla" -> Pablete in artists AND diabla in title)
  if (queryTokens.length >= 2 && matchedInTitleCount >= 1 && matchedInArtistCount >= 1) {
    score += 150;
    if (totalCoveredTokens === queryTokens.length) {
      score += 40;
    }
  } else if (totalCoveredTokens === queryTokens.length) {
    score += 95;
  }

  // Boost clean exact/prefix matches on title when single or short query
  if (normTitle.startsWith(normQuery)) score += 18;
  if (normArtists.some((a) => a === normQuery)) score += 145;

  return score;
}

export function scoreTrackForQuery(track: Track, query: string): number {
  const normQuery = normalizeSearchStr(query);
  const queryTokens = tokenizeSearchStr(query);
  return scoreFieldTokens(
    queryTokens,
    normQuery,
    track.title,
    track.artists.map((a) => a.name),
    track.album?.name
  );
}

export function scoreAlbumForQuery(album: AlbumSummary, query: string): number {
  const normQuery = normalizeSearchStr(query);
  const queryTokens = tokenizeSearchStr(query);
  const base = scoreFieldTokens(
    queryTokens,
    normQuery,
    album.title,
    album.artists.map((a) => a.name)
  );
  // Slight adjustment so exact song matches beat album cards when both exist
  return base > 0 ? base - 8 : 0;
}

export function scoreArtistForQuery(artist: ArtistSummary, query: string): number {
  const normQuery = normalizeSearchStr(query);
  const collapsedQuery = collapseSearchStr(query);
  const queryTokens = tokenizeSearchStr(query);
  if (!normQuery || queryTokens.length === 0) return 0;
  const normName = normalizeSearchStr(artist.name);
  const collapsedName = collapseSearchStr(artist.name);
  const queryAlias = CANONICAL_ARTIST_ALIASES[normQuery]?.canonicalName;
  const artistAlias = CANONICAL_ARTIST_ALIASES[normName]?.canonicalName;
  if (
    normName === normQuery ||
    (queryAlias && normalizeSearchStr(queryAlias) === normName) ||
    (queryAlias && artistAlias && queryAlias === artistAlias) ||
    (collapsedQuery.length >= 4 && collapsedName === collapsedQuery)
  ) {
    return 640;
  }
  const nameWords = new Set(tokenizeSearchStr(artist.name));
  const wordHits = queryTokens.filter((t) => nameWords.has(t)).length;
  if (wordHits === queryTokens.length) return 560;
  if (
    collapsedQuery.length >= 4 &&
    (collapsedName.startsWith(collapsedQuery) || collapsedQuery === collapsedName)
  ) {
    return 320;
  }
  if (
    collapsedQuery.length >= 4 &&
    (collapsedName.includes(collapsedQuery) || collapsedQuery.includes(collapsedName))
  ) {
    return 240;
  }
  if (normName.includes(normQuery) || normQuery.includes(normName)) return 140;
  return wordHits * 28;
}

const GENRE_CHART_MAP: Record<string, number> = {
  'género: latino': 197,
  'género: reggaetón': 122,
  'género: rap & hip-hop': 116,
  'género: pop': 132,
  'género: electrónica': 106,
  'género: r&b': 165,
  'género: dance': 113,
  'género: rock': 152,
};

export class DeezerCatalog {
  private readonly fetchFn: typeof fetch;
  private readonly cache = new Map<string, { at: number; data: unknown }>();
  private readonly inFlight = new Map<string, Promise<Json>>();
  private readonly searchCache = new Map<string, { at: number; bundle: SearchResultBundle }>();
  private readonly inFlightSearch = new Map<string, Promise<SearchResultBundle>>();
  private readonly suggestionsCache = new Map<string, { at: number; list: string[] }>();
  private readonly ytmVisualsCache = new Map<
    string,
    {
      at: number;
      data: {
        avatarUrl?: string;
        bannerUrl?: string;
        listenersText?: string;
        bio?: string;
        ytmAlbumTitles?: string[];
        ytmSingleOrEpTitles?: string[];
        ytmHasFullDiscography?: boolean;
      } | null;
    }
  >();
  private readonly artistDetailCache = new Map<string, { at: number; detail: ArtistDetail }>();
  private readonly inFlightArtist = new Map<string, Promise<ArtistDetail>>();
  private readonly albumDetailCache = new Map<string, { at: number; detail: AlbumDetail }>();
  private readonly inFlightAlbum = new Map<string, Promise<AlbumDetail>>();
  private readonly creditsCache = new Map<string, { at: number; credits: TrackCredits }>();
  private readonly spotifyAvatarCache = new Map<string, { at: number; url: string | null }>();
  private readonly inFlightSpotifyAvatar = new Map<string, Promise<string | null>>();
  private readonly appleArtistVisualsCache = new Map<
    string,
    { at: number; visuals: { avatarUrl: string; bannerUrl: string } | null }
  >();
  private readonly inFlightAppleVisuals = new Map<
    string,
    Promise<{ avatarUrl: string; bannerUrl: string } | null>
  >();
  private mbNextAllowedAtMs = 0;
  private activeDeezerReqs = 0;
  private readonly deezerQueue: Array<() => void> = [];

  public constructor(fetchFn?: typeof fetch) {
    this.fetchFn = fetchFn ?? globalThis.fetch.bind(globalThis);
  }

  private async acquireDeezerSlot(): Promise<void> {
    if (this.activeDeezerReqs < 12) {
      this.activeDeezerReqs++;
      return;
    }
    await new Promise<void>((resolve) => {
      this.deezerQueue.push(resolve);
    });
    this.activeDeezerReqs++;
  }

  private releaseDeezerSlot(): void {
    this.activeDeezerReqs = Math.max(0, this.activeDeezerReqs - 1);
    const next = this.deezerQueue.shift();
    if (next) next();
  }

  private async get(path: string, signal?: AbortSignal): Promise<Json> {
    const hit = this.cache.get(path);
    if (hit && Date.now() - hit.at < 5 * 60_000) return hit.data as Json;
    if (!signal) {
      const pending = this.inFlight.get(path);
      if (pending) return pending;
    }
    const exec = (async () => {
      const backoffMs = [0, 380, 900];
      for (let attempt = 0; attempt < backoffMs.length; attempt++) {
        if (signal?.aborted) throw new Error('Aborted');
        if (backoffMs[attempt]! > 0) {
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, backoffMs[attempt]!);
            signal?.addEventListener(
              'abort',
              () => {
                clearTimeout(timer);
                resolve();
              },
              { once: true }
            );
          });
          if (signal?.aborted) throw new Error('Aborted');
        }
        await this.acquireDeezerSlot();
        let shouldRetry = false;
        try {
          const res = await this.fetchFn(`${API}${path}`, { signal });
          if (res.status === 429 && attempt < backoffMs.length - 1) {
            shouldRetry = true;
          } else {
            if (!res.ok) throw new Error(`Deezer ${res.status}`);
            const data = (await res.json()) as Json;
            if (data?.error) {
              if (Number(data.error?.code) === 4 && attempt < backoffMs.length - 1) {
                shouldRetry = true;
              } else {
                throw new Error(String(data.error?.message ?? 'Deezer error'));
              }
            } else {
              this.cache.set(path, { at: Date.now(), data });
              if (this.cache.size > 120) this.cache.delete(this.cache.keys().next().value as string);
              return data;
            }
          }
        } finally {
          this.releaseDeezerSlot();
        }
        if (shouldRetry) continue;
      }
      throw new Error('Deezer quota exceeded');
    })();
    if (!signal) {
      this.inFlight.set(path, exec);
    }
    try {
      return await exec;
    } finally {
      this.inFlight.delete(path);
    }
  }

  public mapTrack(t: Json, albumOverride?: Json): Track {
    const album = t.album ?? albumOverride;
    const rawList: Array<{ id?: string; name: string }> = [];
    const seenIds = new Set<string>();
    const seenNames = new Set<string>();

    const pushArtist = (idVal: unknown, nameVal: unknown) => {
      const rawName = typeof nameVal === 'string' ? nameVal.trim() : '';
      if (!rawName) return;
      const rawId =
        idVal !== undefined && idVal !== null && String(idVal).trim()
          ? String(idVal).trim()
          : undefined;
      const canon = canonicalizeArtistIdentity(rawId, rawName);
      const name = canon.name;
      const id = canon.id;
      const lower = name
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
      const hasTokenOverlap = Array.from(seenNames).some(
        (existing) => existing === lower || existing.startsWith(`${lower} `) || lower.startsWith(`${existing} `)
      );
      if ((id && seenIds.has(id)) || seenNames.has(lower) || hasTokenOverlap) return;
      if (id) seenIds.add(id);
      seenNames.add(lower);
      rawList.push(id ? { id, name } : { name });
    };

    if (t.artist) pushArtist(t.artist.id, t.artist.name);
    if (Array.isArray(t.contributors)) {
      for (const c of t.contributors) {
        if (c) pushArtist(c.id, c.name);
      }
    }
    const extraFeatured = parseFeaturedArtistsFromTitle(
      String(t.title ?? t.title_short ?? '')
    );
    for (const extraName of extraFeatured) {
      pushArtist(undefined, extraName);
    }

    const rawTitle = String(t.title ?? t.title_short ?? '');
    const shortTitle = String(t.title_short ?? t.title ?? '');
    const hasRemixOrVersionInFullTitle =
      rawTitle.length > shortTitle.length &&
      /\b(?:remix|version|versión|live|en vivo|acústico|acoustic|edit|vip)\b/i.test(rawTitle);

    const maxAllowedIso = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    const validReleaseDates = [t?.release_date, album?.release_date, t?.album?.release_date]
      .map((val) => (typeof val === 'string' ? val.trim().slice(0, 10) : ''))
      .filter((val) => /^\d{4}-\d{2}-\d{2}$/.test(val) && val <= maxAllowedIso)
      .sort((a, b) => b.localeCompare(a));
    const rawReleaseDate = validReleaseDates[0];

    return {
      id: toTrackId(t.id),
      title: hasRemixOrVersionInFullTitle ? rawTitle : shortTitle,
      artists: rawList.length ? rawList : [{ name: 'Artista' }],
      album: album ? { id: String(album.id), name: String(album.title) } : undefined,
      durationSec: Number(t.duration) || 200,
      thumbnailUrl: album?.cover_medium ?? album?.cover ?? '',
      thumbnailHighUrl: album?.cover_xl ?? album?.cover_big ?? album?.cover_medium,
      isExplicit: Boolean(t.explicit_lyrics),
      source: 'ytmusic',
      releaseYear: rawReleaseDate
        ? Number(rawReleaseDate.slice(0, 4))
        : album?.release_date
          ? Number(String(album.release_date).slice(0, 4))
          : undefined,
      ...(rawReleaseDate ? { releaseDate: rawReleaseDate } : {}),
    };
  }

  private async enrichTracks(
    rawTracks: Json[],
    mappedTracks: Track[],
    maxCount = 12,
    signal?: AbortSignal,
    timeoutMs = 700
  ): Promise<Track[]> {
    const out = [...mappedTracks];
    const indicesToEnrich: number[] = [];
    const cap = Math.min(rawTracks.length, out.length, maxCount);
    for (let i = 0; i < cap; i++) {
      const raw = rawTracks[i];
      if (raw?.id && !Array.isArray(raw.contributors)) {
        indicesToEnrich.push(i);
      }
    }
    if (indicesToEnrich.length === 0) return out;

    const enrichOne = async (idx: number) => {
      const raw = rawTracks[idx];
      const existing = out[idx];
      if (!raw?.id || !existing) return;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const onOuterAbort = () => controller.abort();
      signal?.addEventListener('abort', onOuterAbort, { once: true });
      try {
        const full = await this.get(`/track/${encodeURIComponent(String(raw.id))}`, controller.signal);
        const fullMapped = this.mapTrack(full, raw.album);
        const merged = [...fullMapped.artists];
        const have = new Set(merged.map((a) => a.name.toLowerCase()));
        for (const orig of existing.artists) {
          if (!have.has(orig.name.toLowerCase())) {
            merged.push(orig);
            have.add(orig.name.toLowerCase());
          }
        }
        const shouldUpgradeDate =
          Boolean(fullMapped.releaseDate) &&
          (!existing.releaseDate || fullMapped.releaseDate! > existing.releaseDate);
        out[idx] = {
          ...existing,
          artists: merged.length > 0 ? merged : existing.artists,
          ...(shouldUpgradeDate
            ? {
                releaseDate: fullMapped.releaseDate,
                releaseYear: fullMapped.releaseYear ?? existing.releaseYear,
              }
            : {}),
        };
      } catch {
        // Ignore timeout / network error per track and keep original mapped artists
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onOuterAbort);
      }
    };

    const concurrency = 4;
    for (let i = 0; i < indicesToEnrich.length; i += concurrency) {
      if (signal?.aborted) break;
      await Promise.allSettled(indicesToEnrich.slice(i, i + concurrency).map(enrichOne));
    }
    return out;
  }

  private mapArtist(a: Json): ArtistSummary {
    const canon = canonicalizeArtistIdentity(String(a.id), String(a.name));
    return {
      id: canon.id ?? String(a.id),
      name: canon.name || String(a.name),
      thumbnailUrl: sanitizeArtistImageUrl(a.picture_big ?? a.picture_medium ?? a.picture ?? ''),
      subscribersText: a.nb_fan ? `${Number(a.nb_fan).toLocaleString('es-ES')} fans` : undefined,
    };
  }

  private mapAlbum(a: Json, artist?: Json): AlbumSummary {
    const artistList: Array<{ id?: string; name: string }> = [];
    const seen = new Set<string>();
    const pushAr = (rawAr: Json | undefined) => {
      const rawName = typeof rawAr?.name === 'string' ? rawAr.name.trim() : '';
      if (!rawName) return;
      const rawId =
        rawAr?.id !== undefined && rawAr?.id !== null && String(rawAr.id).trim()
          ? String(rawAr.id).trim()
          : undefined;
      const canon = canonicalizeArtistIdentity(rawId, rawName);
      const norm = normalizeSearchStr(canon.name);
      if (!norm || seen.has(norm)) return;
      seen.add(norm);
      artistList.push(canon.id ? { id: canon.id, name: canon.name } : { name: canon.name });
    };
    if (a.artist) pushAr(a.artist);
    if (Array.isArray(a.contributors)) {
      for (const c of a.contributors) pushAr(c);
    }
    if (artist) pushAr(artist);
    const rawReleaseDate =
      typeof a?.release_date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(a.release_date.trim())
        ? a.release_date.trim().slice(0, 10)
        : undefined;
    return {
      id: String(a.id),
      title: String(a.title),
      artists: artistList,
      year: rawReleaseDate
        ? Number(rawReleaseDate.slice(0, 4))
        : a.release_date
          ? Number(String(a.release_date).slice(0, 4))
          : undefined,
      ...(rawReleaseDate ? { releaseDate: rawReleaseDate } : {}),
      thumbnailUrl: a.cover_big ?? a.cover_medium ?? a.cover ?? '',
    };
  }

  private mapPlaylist(p: Json): PlaylistSummary {
    return {
      id: String(p.id),
      title: String(p.title),
      author: p.user?.name ?? 'Deezer',
      trackCount: p.nb_tracks,
      thumbnailUrl: p.picture_big ?? p.picture_medium ?? '',
      source: 'ytmusic',
    };
  }

  public async search(query: string, filter: SearchFilter = 'all', signal?: AbortSignal): Promise<SearchResultBundle> {
    if (!query.trim()) {
      const [tracks, latinoTracks, artists, albums, playlists] = await Promise.all([
        this.get('/chart/0/tracks?limit=25', signal),
        this.get('/chart/197/tracks?limit=15', signal).catch(() => ({ data: [] })),
        this.get('/chart/0/artists?limit=12', signal),
        this.get('/chart/0/albums?limit=12', signal),
        this.get('/chart/0/playlists?limit=10', signal).catch(() => ({ data: [] })),
      ]);
      const rawTracks = [...(latinoTracks.data ?? []), ...(tracks.data ?? [])];
      const seenTrackIds = new Set<string>();
      const rawUnique: Json[] = [];
      const songsInit: Track[] = [];
      for (const t of rawTracks) {
        const mapped = this.mapTrack(t);
        if (!seenTrackIds.has(mapped.id)) {
          seenTrackIds.add(mapped.id);
          rawUnique.push(t);
          songsInit.push(mapped);
        }
      }
      const songs = await this.enrichTracks(rawUnique, songsInit, 6, signal, 450);
      return {
        query,
        topResult: songs[0] ? { kind: 'song', item: songs[0] } : undefined,
        songs,
        videos: songs.slice(0, 4),
        artists: (artists.data ?? []).map((a: Json) => this.mapArtist(a)),
        albums: (albums.data ?? []).map((a: Json) => this.mapAlbum(a)),
        playlists: (playlists.data ?? []).map((p: Json) => this.mapPlaylist(p)),
      };
    }

    const genreId = GENRE_CHART_MAP[query.trim().toLowerCase()];
    if (genreId) {
      const [tracks, artists, albums, playlists] = await Promise.all([
        this.get(`/chart/${genreId}/tracks?limit=30`, signal),
        this.get(`/chart/${genreId}/artists?limit=8`, signal).catch(() => ({ data: [] })),
        this.get(`/chart/${genreId}/albums?limit=10`, signal).catch(() => ({ data: [] })),
        this.get(`/chart/${genreId}/playlists?limit=8`, signal).catch(() => ({ data: [] })),
      ]);
      const rawGenreTracks = tracks.data ?? [];
      const songs = await this.enrichTracks(
        rawGenreTracks,
        rawGenreTracks.map((t: Json) => this.mapTrack(t)),
        6,
        signal,
        450
      );
      const artistList = (artists.data ?? []).map((a: Json) => this.mapArtist(a));
      return {
        query,
        topResult: songs[0]
          ? { kind: 'song', item: songs[0] }
          : artistList[0]
            ? { kind: 'artist', item: artistList[0] }
            : undefined,
        songs,
        videos: songs.slice(0, 4),
        artists: artistList,
        albums: (albums.data ?? []).map((a: Json) => this.mapAlbum(a)),
        playlists: (playlists.data ?? []).map((p: Json) => this.mapPlaylist(p)),
      };
    }

    const rawQ = query.trim();
    const searchCacheKey = `${filter}::${normalizeSearchStr(rawQ)}`;
    const cachedBundle = this.searchCache.get(searchCacheKey);
    if (cachedBundle && Date.now() - cachedBundle.at < 10 * 60_000) {
      return cachedBundle.bundle;
    }
    if (!signal) {
      const pending = this.inFlightSearch.get(searchCacheKey);
      if (pending) return pending;
    }

    const q = encodeURIComponent(rawQ);
    const tokens = tokenizeSearchStr(rawQ);
    const want = (f: SearchFilter) => filter === 'all' || filter === f;

    const runTimedGet = async (path: string, timeoutMs = 1100): Promise<Json | null> => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      const onOuter = () => ctrl.abort();
      signal?.addEventListener('abort', onOuter, { once: true });
      try {
        return await this.get(path, ctrl.signal);
      } catch {
        return null;
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onOuter);
      }
    };

    const execSearch = (async (): Promise<SearchResultBundle> => {
      const isFastSongQuery = filter === 'song' && tokens.length >= 2;

      // Compute alias & single-token punctuated artist variants BEFORE Wave 1 so everything fires in parallel
      const normQueryLower = normalizeSearchStr(rawQ);
      let aliasQuery: string | null = null;
      if (normQueryLower.includes('cruzzi')) {
        aliasQuery = rawQ.replace(/cruzzi/gi, 'Cruz Cafuné');
      } else if (normQueryLower.includes('cruz cafune')) {
        aliasQuery = rawQ.replace(/cruz\s*cafun[eé]/gi, 'Cruzzi');
      }
      const hasAlias = Boolean(aliasQuery && aliasQuery.trim().toLowerCase() !== rawQ.toLowerCase());
      const aq = hasAlias ? encodeURIComponent(aliasQuery!.trim()) : '';

      const dotVariants: string[] = [];
      if (tokens.length === 1 && tokens[0] && tokens[0].length >= 4 && (want('artist') || want('song'))) {
        const tok = tokens[0];
        if (!tok.startsWith('d')) {
          dotVariants.push(`D.${rawQ}`);
        } else if (tok.length >= 5) {
          dotVariants.push(`d.${rawQ.slice(1)}`);
        }
      }

      const rawArtistRows: Json[] = [];
      const extraDotArtists: Json[] = [];
      const extraArtistTracks: Json[] = [];
      const aliasAlbums: Json[] = [];

      const [songs, artists, albums, playlists] = await Promise.all([
        want('song') || want('video')
          ? runTimedGet(`/search?q=${q}&limit=${isFastSongQuery ? 12 : 25}`, isFastSongQuery ? 1100 : 1250)
          : Promise.resolve(null),
        want('artist')
          ? runTimedGet(`/search/artist?q=${q}&limit=25`, 1250)
          : Promise.resolve(null),
        want('album') || (!isFastSongQuery && (want('song') || want('video')) && tokens.length >= 2)
          ? runTimedGet(`/search/album?q=${q}&limit=10`, 950)
          : Promise.resolve(null),
        want('playlist')
          ? runTimedGet(`/search/playlist?q=${q}&limit=8`, 950)
          : Promise.resolve(null),
        // Companion alias queries in parallel inside Wave 1
        ...(hasAlias
          ? [
              want('song') || want('video')
                ? runTimedGet(`/search?q=${aq}&limit=12`, 550).then((res) => {
                    for (const t of res?.data ?? []) extraArtistTracks.push(t);
                    return null;
                  })
                : Promise.resolve(null),
              want('artist')
                ? runTimedGet(`/search/artist?q=${aq}&limit=8`, 550).then((res) => {
                    for (const row of res?.data ?? []) extraDotArtists.push(row);
                    return null;
                  })
                : Promise.resolve(null),
              want('album')
                ? runTimedGet(`/search/album?q=${aq}&limit=8`, 550).then((res) => {
                    for (const al of res?.data ?? []) aliasAlbums.push(al);
                    return null;
                  })
                : Promise.resolve(null),
            ]
          : []),
        // Punctuated artist variants in parallel inside Wave 1
        ...dotVariants.map((variant) =>
          runTimedGet(`/search/artist?q=${encodeURIComponent(variant)}&limit=6`, 450).then((res) => {
            for (const row of res?.data ?? []) extraDotArtists.push(row);
            return null;
          })
        ),
      ]);

      for (const row of artists?.data ?? []) rawArtistRows.push(row);

      const artistByCanonicalId = new Map<string, Json>();
      const combinedRawArtists: Json[] = [];
      for (const row of [...rawArtistRows, ...extraDotArtists]) {
        const rawIdStr = row?.id ? String(row.id) : '';
        if (!rawIdStr) continue;
        const canonIdStr = CANONICAL_ARTIST_ID_REDIRECTS[rawIdStr] ?? rawIdStr;
        const existing = artistByCanonicalId.get(canonIdStr);
        if (!existing) {
          const clone = { ...row };
          artistByCanonicalId.set(canonIdStr, clone);
          combinedRawArtists.push(clone);
        } else {
          existing.nb_fan = (Number(existing.nb_fan) || 0) + (Number(row.nb_fan) || 0);
          if (String(row.id) === canonIdStr) {
            existing.id = row.id;
            existing.name = row.name;
            if (row.picture_xl) existing.picture_xl = row.picture_xl;
            if (row.picture_big) existing.picture_big = row.picture_big;
            if (row.picture_medium) existing.picture_medium = row.picture_medium;
          }
        }
      }

      const albumListRaw: Json[] = [...(albums?.data ?? []), ...aliasAlbums];
      const primaryRawSongs: Json[] = songs?.data ?? [];
      const bestPrimaryScore = primaryRawSongs.reduce((best, raw) => {
        const s = scoreTrackForQuery(this.mapTrack(raw), rawQ);
        return s > best ? s : best;
      }, 0);

      const dotMatchedArtists =
        want('song') || want('video')
          ? extraDotArtists
              .filter((raw) => scoreArtistForQuery(this.mapArtist(raw), rawQ) >= 120)
              .slice(0, 2)
          : [];

      const structuredTracks: Array<Json | null> = [];
      const candidateAlbumTracks: Json[] = [];

      const needSplitExpansion =
        (want('song') || want('video')) && tokens.length >= 2 && bestPrimaryScore < 165;

      // Single fast parallel Wave 2 (only when needed) — no slow track enrichment waterfall!
      if (dotMatchedArtists.length > 0 || needSplitExpansion) {
        const wave2Calls: Array<Promise<void>> = dotMatchedArtists.map((ar) =>
          runTimedGet(`/artist/${encodeURIComponent(String(ar.id))}/top?limit=5`, 400).then((res) => {
            for (const t of res?.data ?? []) extraArtistTracks.push(t);
          })
        );

        if (needSplitExpansion) {
          const first = tokens[0]!;
          const rest = tokens.slice(1).join(' ');
          const last = tokens[tokens.length - 1]!;
          const head = tokens.slice(0, -1).join(' ');
          const matchingAlbums = albumListRaw
            .map((al) => ({
              al,
              score: scoreAlbumForQuery(this.mapAlbum(al), rawQ),
            }))
            .filter((entry) => entry.score >= 60)
            .sort((a, b) => b.score - a.score)
            .slice(0, 2);

          wave2Calls.push(
            runTimedGet(`/search/track?q=${encodeURIComponent(`artist:"${first}" track:"${rest}"`)}&limit=8`, 480).then((res) => {
              if (res) structuredTracks.push(res);
            }),
            runTimedGet(`/search/track?q=${encodeURIComponent(`artist:"${last}" track:"${head}"`)}&limit=8`, 480).then((res) => {
              if (res) structuredTracks.push(res);
            }),
            ...matchingAlbums.map(({ al }) =>
              runTimedGet(`/album/${encodeURIComponent(String(al.id))}/tracks?limit=20`, 480).then((res) => {
                const list = (res?.data ?? []).map((t: Json) => ({
                  ...t,
                  artist: t.artist ?? al.artist,
                  album: t.album ?? al,
                }));
                candidateAlbumTracks.push(...list);
              })
            )
          );
        }

        await Promise.all(wave2Calls);
      }

      const mergedRaw: Json[] = [];
      const seenRawIds = new Set<string>();
      const pushRawUnique = (list: Json[]) => {
        for (const item of list) {
          if (!item || !item.id) continue;
          const idStr = String(item.id);
          if (seenRawIds.has(idStr)) continue;
          seenRawIds.add(idStr);
          mergedRaw.push(item);
        }
      };

      for (const sRes of structuredTracks) {
        pushRawUnique(sRes?.data ?? []);
      }
      pushRawUnique(candidateAlbumTracks);
      pushRawUnique(extraArtistTracks);
      pushRawUnique(primaryRawSongs);

      // Direct zero-latency mapping in search (featured artists already extracted via parseFeaturedArtistsFromTitle)
      const songList = mergedRaw
        .map((raw: Json, idx: number) => {
          const track = this.mapTrack(raw);
          return { track, idx, score: scoreTrackForQuery(track, rawQ) };
        })
        .sort((a, b) => b.score - a.score || a.idx - b.idx)
        .map((x) => x.track);

      const artistRanked = combinedRawArtists
        .map((raw: Json, idx: number) => {
          const artist = this.mapArtist(raw);
          const fans = Number(raw.nb_fan) || 0;
          const fanBoost = Math.log10(Math.max(1, fans) + 1) * 8;
          return {
            artist,
            fans,
            idx,
            score: scoreArtistForQuery(artist, rawQ) + fanBoost,
          };
        })
        .sort((a: { score: number; idx: number }, b: { score: number; idx: number }) => b.score - a.score || a.idx - b.idx);
      const artistList = artistRanked.map((x: { artist: ArtistSummary }) => x.artist);

      // Promote shared joint-album collaborators discovered in search tracks onto album summaries
      const albumExtraArtists = new Map<string, Map<string, { ref: { id?: string; name: string }; count: number }>>();
      for (const song of songList) {
        const aid = song.album?.id;
        if (!aid || song.artists.length < 2) continue;
        let arMap = albumExtraArtists.get(aid);
        if (!arMap) {
          arMap = new Map();
          albumExtraArtists.set(aid, arMap);
        }
        for (const a of song.artists) {
          const norm = normalizeSearchStr(a.name);
          if (!norm) continue;
          const prev = arMap.get(norm);
          arMap.set(norm, { ref: prev?.ref ?? a, count: (prev?.count ?? 0) + 1 });
        }
      }

      const albumList = (want('album') ? albumListRaw : [])
        .map((a: Json) => {
          const mapped = this.mapAlbum(a);
          const extras = albumExtraArtists.get(mapped.id);
          if (!extras) return mapped;
          const have = new Set(mapped.artists.map((x) => normalizeSearchStr(x.name)));
          const promoted = [...mapped.artists];
          for (const [norm, entry] of extras.entries()) {
            if (entry.count >= 2 && !have.has(norm)) {
              have.add(norm);
              promoted.push(entry.ref);
            }
          }
          return promoted.length > mapped.artists.length ? { ...mapped, artists: promoted } : mapped;
        })
        .map((album: AlbumSummary, idx: number) => ({
          album,
          idx,
          score: scoreAlbumForQuery(album, rawQ),
        }))
        .sort((a: { score: number; idx: number }, b: { score: number; idx: number }) => b.score - a.score || a.idx - b.idx)
        .map((x: { album: AlbumSummary }) => x.album);

      const topSong = songList[0];
      const topArtist = artistList[0];
      const topArtistFans = artistRanked[0]?.fans ?? 0;
      const topAlbum = albumList[0];

      const normQ = normalizeSearchStr(rawQ);
      const qTokens = tokenizeSearchStr(rawQ);
      const topSongNormTitle = topSong ? normalizeSearchStr(topSong.title) : '';
      const topSongTitleWords = new Set(topSong ? tokenizeSearchStr(topSong.title) : []);
      const topSongTitleHits = qTokens.filter((t) => topSongTitleWords.has(t)).length;
      const topSongIsTitleIntent = Boolean(
        topSong &&
          (topSongNormTitle === normQ ||
            (normQ.length >= 3 && topSongNormTitle.startsWith(normQ)) ||
            (qTokens.length >= 2 && topSongTitleHits >= 1) ||
            (qTokens.length === 1 && topSongTitleHits === 1))
      );

      const rawSongScore = topSong ? scoreTrackForQuery(topSong, rawQ) : -1;
      const songScore = topSong
        ? topSongIsTitleIntent
          ? rawSongScore
          : Math.min(rawSongScore, 340)
        : -1;
      const rawArtistScore = topArtist ? scoreArtistForQuery(topArtist, rawQ) : -1;
      const artistScore =
        topSongNormTitle === normQ && topArtistFans < 500
          ? Math.min(rawArtistScore, Math.max(0, songScore - 20))
          : rawArtistScore;
      const albumScore = topAlbum ? scoreAlbumForQuery(topAlbum, rawQ) : -1;

      let topResult: SearchResultBundle['topResult'];
      if (artistScore >= songScore && artistScore >= albumScore && topArtist) {
        topResult = { kind: 'artist', item: topArtist };
      } else if (songScore >= albumScore && topSong) {
        topResult = { kind: 'song', item: topSong };
      } else if (topAlbum) {
        topResult = { kind: 'album', item: topAlbum };
      } else if (topSong) {
        topResult = { kind: 'song', item: topSong };
      } else if (topArtist) {
        topResult = { kind: 'artist', item: topArtist };
      }

      const bundle: SearchResultBundle = {
        query,
        topResult,
        songs: songList,
        videos: songList.slice(0, 4),
        artists: artistList,
        albums: albumList,
        playlists: (playlists?.data ?? []).map((p: Json) => this.mapPlaylist(p)),
      };
      this.searchCache.set(searchCacheKey, { at: Date.now(), bundle });
      if (this.searchCache.size > 64) {
        this.searchCache.delete(this.searchCache.keys().next().value as string);
      }
      return bundle;
    })();

    if (!signal) {
      this.inFlightSearch.set(searchCacheKey, execSearch);
    }
    try {
      return await execSearch;
    } finally {
      if (!signal && this.inFlightSearch.get(searchCacheKey) === execSearch) {
        this.inFlightSearch.delete(searchCacheKey);
      }
    }
  }

  public async suggestions(input: string, signal?: AbortSignal): Promise<string[]> {
    const clean = input.trim();
    if (!clean) return [];
    const key = normalizeSearchStr(clean);
    const cached = this.suggestionsCache.get(key);
    if (cached && Date.now() - cached.at < 10 * 60_000) {
      return cached.list;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 600);
    const onOuter = () => ctrl.abort();
    signal?.addEventListener('abort', onOuter, { once: true });
    try {
      const data = await this.get(`/search/autocomplete?q=${encodeURIComponent(clean)}&limit=6`, ctrl.signal);
      const out = new Set<string>();
      for (const a of data.artists?.data ?? []) out.add(a.name);
      for (const t of data.tracks?.data ?? []) out.add(`${t.title_short ?? t.title} - ${t.artist?.name ?? ''}`.trim());
      const list = [...out].slice(0, 8);
      this.suggestionsCache.set(key, { at: Date.now(), list });
      if (this.suggestionsCache.size > 64) {
        this.suggestionsCache.delete(this.suggestionsCache.keys().next().value as string);
      }
      return list;
    } catch {
      return [];
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onOuter);
    }
  }

  public async home(signal?: AbortSignal): Promise<HomeFeedResult> {
    const [chartTracks, chartArtists, chartAlbums, chartPlaylists] = await Promise.all([
      this.get('/chart/0/tracks?limit=30', signal),
      this.get('/chart/0/artists?limit=12', signal),
      this.get('/chart/0/albums?limit=12', signal),
      this.get('/chart/0/playlists?limit=10', signal),
    ]);
    const rawChartTracks = chartTracks.data ?? [];
    const enrichedChartTracks = await this.enrichTracks(
      rawChartTracks,
      rawChartTracks.map((t: Json) => this.mapTrack(t)),
      10,
      signal
    );
    return {
      moods: ['Para ti', 'Tendencias', 'Reggaeton', 'Pop', 'Hip-Hop', 'Electrónica'],
      shelves: [
        { title: 'Éxitos del momento', items: enrichedChartTracks },
        { title: 'Artistas del momento', items: (chartArtists.data ?? []).map((a: Json) => this.mapArtist(a)) },
        { title: 'Álbumes populares', items: (chartAlbums.data ?? []).map((a: Json) => this.mapAlbum(a)) },
        { title: 'Listas para descubrir', items: (chartPlaylists.data ?? []).map((p: Json) => this.mapPlaylist(p)) },
      ],
    } as HomeFeedResult;
  }

  public async fetchSpotifyPortraitById(
    spotifyId: string,
    signal?: AbortSignal
  ): Promise<string | null> {
    const cleanId = spotifyId.trim();
    if (!/^[A-Za-z0-9]{22}$/.test(cleanId)) return null;

    // Primary: lightweight Spotify oEmbed endpoint (returns official ab676161 artist portrait)
    try {
      const oembedRes = await this.fetchFn(
        `https://open.spotify.com/oembed?url=${encodeURIComponent(`https://open.spotify.com/artist/${cleanId}`)}`,
        { headers: { Accept: 'application/json' }, signal }
      );
      if (oembedRes.ok) {
        const oembed = (await oembedRes.json()) as { thumbnail_url?: string };
        const rawThumb = String(oembed?.thumbnail_url ?? '').trim();
        if (rawThumb.includes('ab676161')) {
          const upgraded = rawThumb
            .replace(
              /^https:\/\/image-cdn-[a-z0-9]+\.spotifycdn\.com\/image\//i,
              'https://i.scdn.co/image/'
            )
            .replace('ab67616100005174', 'ab6761610000e5eb')
            .replace('ab6761610000f178', 'ab6761610000e5eb');
          return upgraded;
        }
      }
    } catch {
      // fall through to open.spotify.com og:image
    }

    // Fallback: OpenGraph metadata on open.spotify.com/artist/<id>
    try {
      const spHtmlRes = await this.fetchFn(`https://open.spotify.com/artist/${cleanId}`, {
        headers: { 'User-Agent': 'facebookexternalhit/1.1' },
        signal,
      });
      if (!spHtmlRes.ok) return null;
      const html = await spHtmlRes.text();
      const ogImg =
        html.match(/property=["']og:image["']\s+content=["'](https:\/\/i\.scdn\.co\/image\/ab676161[^"']+)["']/i)?.[1] ??
        html.match(/content=["'](https:\/\/i\.scdn\.co\/image\/ab676161[^"']+)["']\s+property=["']og:image["']/i)?.[1] ??
        null;
      if (!ogImg || /download-page-image/i.test(ogImg)) return null;
      return ogImg;
    } catch {
      return null;
    }
  }

  private async waitForMusicBrainzSlot(signal?: AbortSignal): Promise<void> {
    if (this.fetchFn !== globalThis.fetch) return;
    const now = Date.now();
    const waitMs = Math.max(0, this.mbNextAllowedAtMs - now);
    this.mbNextAllowedAtMs = Math.max(now, this.mbNextAllowedAtMs) + 1150;
    if (waitMs <= 0) return;
    await new Promise<void>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new Error('Aborted'));
        return;
      }
      const t = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, waitMs);
      const onAbort = () => {
        clearTimeout(t);
        reject(new Error('Aborted'));
      };
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  private buildArtistQueryCandidates(artistName: string): string[] {
    const clean = artistName.trim();
    if (!clean) return [];
    const norm = normalizeSearchStr(clean);
    const out = [clean];
    if (norm === 'cruzzi') out.push('Cruz Cafuné');
    else if (norm === 'cruz cafune') out.push('Cruzzi');
    return out;
  }

  public async fetchSpotifyArtistAvatar(
    artistName: string,
    signal?: AbortSignal,
    options?: { allowMusicBrainz?: boolean }
  ): Promise<string | null> {
    const cleanName = artistName.trim();
    if (!cleanName) return null;
    const normKey = normalizeSearchStr(cleanName);
    const cached = this.spotifyAvatarCache.get(normKey);
    if (cached) {
      const ttl = cached.url ? 24 * 3600_000 : 10 * 60_000;
      if (Date.now() - cached.at < ttl) {
        return cached.url;
      }
    }

    if (!signal) {
      const pending = this.inFlightSpotifyAvatar.get(normKey);
      if (pending) return pending;
    }

    const candidates = this.buildArtistQueryCandidates(cleanName);
    const acceptedNorms = new Set(candidates.map((c) => normalizeSearchStr(c)));
    const allowMusicBrainz = options?.allowMusicBrainz !== false;

    const exec = (async (): Promise<string | null> => {
      const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = ctrl ? setTimeout(() => ctrl.abort(), allowMusicBrainz ? 4800 : 2200) : null;
      const onOuter = () => ctrl?.abort();
      signal?.addEventListener('abort', onOuter, { once: true });
      const effectiveSignal = ctrl?.signal ?? signal;

      try {
        const wdHeaders = {
          Accept: 'application/json',
          'User-Agent': 'pMusicDesktop/0.18.7 (https://github.com/pabloburgos/pMusic)',
        };

        // Tier 1: Wikidata P1902 (Spotify artist ID) — fast, high coverage, no strict 1-req/s throttle
        for (const candName of candidates) {
          try {
            const wdSearchRes = await this.fetchFn(
              `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(candName)}&language=es&format=json&limit=5`,
              { headers: wdHeaders, signal: effectiveSignal }
            );
            if (!wdSearchRes.ok) continue;
            const wdSearch = (await wdSearchRes.json()) as {
              search?: Array<{ id?: string; label?: string }>;
            };
            const qids = (wdSearch?.search ?? [])
              .map((item) => String(item?.id ?? '').trim())
              .filter(Boolean);
            if (qids.length === 0) continue;

            const wdEntRes = await this.fetchFn(
              `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${encodeURIComponent(qids.join('|'))}&props=claims|labels|aliases&languages=es|en&format=json`,
              { headers: wdHeaders, signal: effectiveSignal }
            );
            if (!wdEntRes.ok) continue;
            const wdEnt = (await wdEntRes.json()) as {
              entities?: Record<
                string,
                {
                  labels?: Record<string, { value?: string }>;
                  aliases?: Record<string, Array<{ value?: string }>>;
                  claims?: {
                    P1902?: Array<{ mainsnak?: { datavalue?: { value?: string } } }>;
                  };
                }
              >;
            };

            let matchedSpId: string | null = null;
            for (const qid of qids) {
              const entity = wdEnt?.entities?.[qid];
              if (!entity) continue;
              const labelNames = [
                entity.labels?.es?.value ?? '',
                entity.labels?.en?.value ?? '',
                ...(entity.aliases?.es ?? []).map((a) => a.value ?? ''),
                ...(entity.aliases?.en ?? []).map((a) => a.value ?? ''),
              ].filter(Boolean);
              const isExactArtist = labelNames.some((n) => acceptedNorms.has(normalizeSearchStr(n)));
              if (!isExactArtist) continue;

              const spId = String(
                entity.claims?.P1902?.[0]?.mainsnak?.datavalue?.value ?? ''
              ).trim();
              if (/^[A-Za-z0-9]{22}$/.test(spId)) {
                matchedSpId = spId;
                break;
              }
            }

            if (matchedSpId) {
              const portraitUrl = await this.fetchSpotifyPortraitById(matchedSpId, effectiveSignal);
              if (portraitUrl) {
                this.spotifyAvatarCache.set(normKey, { at: Date.now(), url: portraitUrl });
                if (this.spotifyAvatarCache.size > 160) {
                  const oldest = this.spotifyAvatarCache.keys().next().value;
                  if (oldest) this.spotifyAvatarCache.delete(oldest);
                }
                return portraitUrl;
              }
            }
          } catch {
            // continue to next candidate or tier
          }
        }

        // Tier 2: Rate-limited MusicBrainz url-rels fallback
        if (allowMusicBrainz) {
          const mbHeaders = {
            Accept: 'application/json',
            'User-Agent': 'pMusicDesktop/0.18.7 ( https://github.com/pabloburgos/pMusic )',
          };
          for (const candName of candidates) {
            try {
              await this.waitForMusicBrainzSlot(effectiveSignal);
              const searchRes = await this.fetchFn(
                `https://musicbrainz.org/ws/2/artist?query=artist:${encodeURIComponent(`"${candName}"`)}&fmt=json&limit=3`,
                { headers: mbHeaders, signal: effectiveSignal }
              );
              if (!searchRes.ok) continue;
              const mbJson = (await searchRes.json()) as {
                artists?: Array<{ id?: string; name?: string; score?: number }>;
              };
              const artistsList = Array.isArray(mbJson?.artists) ? mbJson.artists : [];
              const bestMb = artistsList.find((ar) =>
                acceptedNorms.has(normalizeSearchStr(String(ar.name ?? '')))
              );
              const mbId = bestMb?.id;
              if (!mbId) continue;

              await this.waitForMusicBrainzSlot(effectiveSignal);
              const relRes = await this.fetchFn(
                `https://musicbrainz.org/ws/2/artist/${encodeURIComponent(mbId)}?inc=url-rels&fmt=json`,
                { headers: mbHeaders, signal: effectiveSignal }
              );
              if (!relRes.ok) continue;
              const relJson = (await relRes.json()) as {
                relations?: Array<{ url?: { resource?: string } }>;
              };
              const spUrl = (relJson?.relations ?? [])
                .map((r) => String(r?.url?.resource ?? '').trim())
                .find((u) => /https?:\/\/open\.spotify\.com\/artist\/([A-Za-z0-9]{22})/i.test(u));
              const spId = spUrl?.match(/artist\/([A-Za-z0-9]{22})/i)?.[1];
              if (!spId) continue;

              const portraitUrl = await this.fetchSpotifyPortraitById(spId, effectiveSignal);
              if (portraitUrl) {
                this.spotifyAvatarCache.set(normKey, { at: Date.now(), url: portraitUrl });
                if (this.spotifyAvatarCache.size > 160) {
                  const oldest = this.spotifyAvatarCache.keys().next().value;
                  if (oldest) this.spotifyAvatarCache.delete(oldest);
                }
                return portraitUrl;
              }
            } catch {
              // continue to next candidate
            }
          }
        }

        this.spotifyAvatarCache.set(normKey, { at: Date.now(), url: null });
        return null;
      } catch {
        return null;
      } finally {
        if (timer) clearTimeout(timer);
        signal?.removeEventListener('abort', onOuter);
      }
    })();

    if (!signal) {
      this.inFlightSpotifyAvatar.set(normKey, exec);
    }
    try {
      return await exec;
    } finally {
      this.inFlightSpotifyAvatar.delete(normKey);
    }
  }

  public async fetchAppleMusicArtistVisuals(
    artistName: string,
    signal?: AbortSignal
  ): Promise<{ avatarUrl: string; bannerUrl: string } | null> {
    const cleanName = artistName.trim();
    if (!cleanName) return null;
    const normKey = normalizeSearchStr(cleanName);
    const cached = this.appleArtistVisualsCache.get(normKey);
    if (cached) {
      const ttl = cached.visuals ? 24 * 3600_000 : 10 * 60_000;
      if (Date.now() - cached.at < ttl) {
        return cached.visuals;
      }
    }

    if (!signal) {
      const pending = this.inFlightAppleVisuals.get(normKey);
      if (pending) return pending;
    }

    const candidates = this.buildArtistQueryCandidates(cleanName);
    const acceptedNorms = new Set(candidates.map((c) => normalizeSearchStr(c)));

    const exec = (async (): Promise<{ avatarUrl: string; bannerUrl: string } | null> => {
      const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = ctrl ? setTimeout(() => ctrl.abort(), 2400) : null;
      const onOuter = () => ctrl?.abort();
      signal?.addEventListener('abort', onOuter, { once: true });
      const effectiveSignal = ctrl?.signal ?? signal;

      try {
        for (const candName of candidates) {
          const itunesRes = await this.fetchFn(
            `https://itunes.apple.com/search?term=${encodeURIComponent(candName)}&entity=musicArtist&limit=5&country=ES`,
            { signal: effectiveSignal }
          );
          if (!itunesRes.ok) continue;
          const itunesJson = (await itunesRes.json()) as {
            results?: Array<{ artistName?: string; artistLinkUrl?: string }>;
          };
          const match = (itunesJson?.results ?? []).find(
            (r) =>
              Boolean(r?.artistLinkUrl) &&
              acceptedNorms.has(normalizeSearchStr(String(r?.artistName ?? '')))
          );
          const artistLinkUrl = match?.artistLinkUrl?.trim();
          if (!artistLinkUrl) continue;

          const amRes = await this.fetchFn(artistLinkUrl, {
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            },
            signal: effectiveSignal,
          });
          if (!amRes.ok) continue;
          const html = await amRes.text();
          const rawOg =
            html.match(/property=["']og:image["']\s+content=["'](https:\/\/is\d+-ssl\.mzstatic\.com\/image\/thumb\/[^"']+)["']/i)?.[1] ??
            html.match(/content=["'](https:\/\/is\d+-ssl\.mzstatic\.com\/image\/thumb\/[^"']+)["']\s+property=["']og:image["']/i)?.[1] ??
            null;
          if (!rawOg) continue;

          // Strip trailing size/cw OpenGraph badge segment so we get clean studio portrait crops
          const base = rawOg.replace(/\/[^/]+$/, '');
          if (!base.includes('mzstatic.com/image/thumb/')) continue;
          const visuals = {
            avatarUrl: `${base}/800x800cc.webp`,
            bannerUrl: `${base}/1200x1200bb.jpg`,
          };
          this.appleArtistVisualsCache.set(normKey, { at: Date.now(), visuals });
          if (this.appleArtistVisualsCache.size > 160) {
            const oldest = this.appleArtistVisualsCache.keys().next().value;
            if (oldest) this.appleArtistVisualsCache.delete(oldest);
          }
          return visuals;
        }

        this.appleArtistVisualsCache.set(normKey, { at: Date.now(), visuals: null });
        return null;
      } catch {
        return null;
      } finally {
        if (timer) clearTimeout(timer);
        signal?.removeEventListener('abort', onOuter);
      }
    })();

    if (!signal) {
      this.inFlightAppleVisuals.set(normKey, exec);
    }
    try {
      return await exec;
    } finally {
      this.inFlightAppleVisuals.delete(normKey);
    }
  }

  private async enrichArtistListWithPreferredPortraits(
    artists: ArtistSummary[],
    maxCount = 4,
    timeoutMs = 900,
    signal?: AbortSignal
  ): Promise<ArtistSummary[]> {
    if (artists.length === 0 || maxCount <= 0) return artists;
    const count = Math.min(maxCount, artists.length);
    const out = [...artists];
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const onOuter = () => ctrl?.abort();
    signal?.addEventListener('abort', onOuter, { once: true });

    const jobs = out.slice(0, count).map(async (artist, idx) => {
      if (!artist?.name) return;
      try {
        const sp = await this.fetchSpotifyArtistAvatar(artist.name, ctrl?.signal ?? signal, {
          allowMusicBrainz: false,
        });
        const cleanSp = sanitizeArtistImageUrl(sp);
        if (cleanSp) {
          out[idx] = { ...artist, thumbnailUrl: cleanSp };
          return;
        }
        const apple = await this.fetchAppleMusicArtistVisuals(artist.name, ctrl?.signal ?? signal);
        const cleanApple = sanitizeArtistImageUrl(apple?.avatarUrl);
        if (cleanApple) {
          out[idx] = { ...artist, thumbnailUrl: cleanApple };
        }
      } catch {
        // keep original thumbnail on timeout/failure
      }
    });

    try {
      let timer: ReturnType<typeof setTimeout> | null = null;
      await Promise.race([
        Promise.allSettled(jobs),
        new Promise<void>((resolve) => {
          timer = setTimeout(() => {
            ctrl?.abort();
            resolve();
          }, timeoutMs);
        }),
      ]);
      if (timer) clearTimeout(timer);
    } finally {
      signal?.removeEventListener('abort', onOuter);
    }
    return out;
  }

  public async artistByName(name: string, signal?: AbortSignal): Promise<ArtistDetail> {
    const canon = canonicalizeArtistIdentity(undefined, name);
    const cleaned = (canon.name || name).trim();
    const res = await this.get(`/search/artist?q=${encodeURIComponent(cleaned)}&limit=15`, signal);
    const list = (res.data ?? []) as Json[];
    if (list.length === 0) {
      if (canon.id) return this.artist(canon.id, signal, canon.name);
      throw new Error(`Artista no encontrado: ${name}`);
    }
    const normTarget = normalizeSearchStr(cleaned);
    const exactMatches = list
      .filter((a) => {
        const mappedName = canonicalizeArtistIdentity(String(a.id), String(a.name ?? '')).name;
        return normalizeSearchStr(mappedName) === normTarget;
      })
      .sort((a, b) => (Number(b.nb_fan) || 0) - (Number(a.nb_fan) || 0));

    const best =
      exactMatches[0] ??
      [...list].sort((a, b) => {
        const sA =
          scoreArtistForQuery(this.mapArtist(a), cleaned) +
          Math.log10(Math.max(1, Number(a.nb_fan) || 0) + 1) * 18;
        const sB =
          scoreArtistForQuery(this.mapArtist(b), cleaned) +
          Math.log10(Math.max(1, Number(b.nb_fan) || 0) + 1) * 18;
        return sB - sA;
      })[0]!;
    return this.artist(canon.id ?? String(best.id), signal, canon.name);
  }

  private async fetchYtMusicArtistVisuals(
    artistName: string,
    signal?: AbortSignal
  ): Promise<{
    avatarUrl?: string;
    bannerUrl?: string;
    listenersText?: string;
    bio?: string;
    ytmAlbumTitles?: string[];
    ytmSingleOrEpTitles?: string[];
    ytmHasFullDiscography?: boolean;
  } | null> {
    const cleanName = artistName.trim();
    if (!cleanName) return null;

    const normCacheKey = normalizeSearchStr(cleanName);
    const cachedYtm = this.ytmVisualsCache.get(normCacheKey);
    if (cachedYtm && Date.now() - cachedYtm.at < 30 * 60_000) {
      return cachedYtm.data;
    }

    const ytmPost = async (
      ep: 'search' | 'browse',
      bodyObj: Record<string, unknown>,
      timeoutMs = 1700
    ) => {
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
      const onOuterAbort = () => controller?.abort();
      signal?.addEventListener('abort', onOuterAbort, { once: true });
      try {
        const res = await this.fetchFn(`https://music.youtube.com/youtubei/v1/${ep}?prettyPrint=false`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ context: { client: YTM_WEB_REMIX_CLIENT }, ...bodyObj }),
          signal: controller?.signal ?? signal,
        });
        if (!res.ok) return null;
        return (await res.json()) as Json;
      } catch {
        return null;
      } finally {
        if (timer) clearTimeout(timer);
        signal?.removeEventListener('abort', onOuterAbort);
      }
    };

    try {
      const ytmStartedAt = Date.now();
      const searchJson = await ytmPost('search', {
        query: cleanName,
        params: 'EgWKAQIgAWoMEAMQBBAJEAoQBRAV',
      }, 1150);
      if (!searchJson) return null;

      const items = collectObjectsByKey(searchJson, 'musicResponsiveListItemRenderer');
      const wantNorm = normalizeSearchStr(cleanName);
      const aliasNorm = CANONICAL_ARTIST_ALIASES[wantNorm]
        ? normalizeSearchStr(CANONICAL_ARTIST_ALIASES[wantNorm]!.canonicalName)
        : '';
      let chosen: Record<string, any> | null = null;
      let chosenScore = -Infinity;
      for (const item of items) {
        const browseId = String(
          item?.navigationEndpoint?.browseEndpoint?.browseId ?? ''
        ).trim();
        if (!browseId) continue;
        const flex0 = readRunsText(
          item?.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text
        );
        const flex1 = readRunsText(
          item?.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text
        );
        const normFlex = normalizeSearchStr(flex0);
        const normSub = normalizeSearchStr(flex1);

        let score = 0;
        if (normFlex === wantNorm || (aliasNorm && normFlex === aliasNorm)) {
          score += 320;
        } else if (normFlex.includes(wantNorm) || wantNorm.includes(normFlex)) {
          score += 140;
        }
        if (/\b(?:artista|artist)\b/.test(normSub)) score += 90;
        if (/\b(?:usuarios mensuales|oyentes mensuales|monthly listeners)\b/.test(normSub)) {
          score += 110;
        }
        if (/\bperfil\b/.test(normSub) || /-\s*tema$/.test(normFlex)) {
          score -= 160;
        }
        const audience = parseYtmAudienceCount(flex1);
        if (audience > 0) {
          score += Math.log10(audience + 1) * 35;
        }
        if (score > chosenScore) {
          chosenScore = score;
          chosen = item;
        }
      }
      if (!chosen) return null;

      const searchThumbRaw = pickPreferredThumb(
        chosen?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails,
        640
      );
      const searchAvatarUrl = searchThumbRaw
        ? upscaleYtmImageUrl(searchThumbRaw.url, 640, 640)
        : undefined;
      const browseId = String(chosen?.navigationEndpoint?.browseEndpoint?.browseId ?? '').trim();
      if (!browseId) {
        return searchAvatarUrl ? { avatarUrl: searchAvatarUrl } : null;
      }

      const browseJson = await ytmPost('browse', { browseId }, 1150);
      const header =
        browseJson?.header?.musicImmersiveHeaderRenderer ??
        browseJson?.header?.musicVisualHeaderRenderer ??
        collectObjectsByKey(browseJson, 'musicImmersiveHeaderRenderer')[0] ??
        collectObjectsByKey(browseJson, 'musicVisualHeaderRenderer')[0] ??
        null;

      const bannerBest = pickPreferredThumb(
        header?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails,
        1440
      );
      const bannerUrl = bannerBest
        ? upscaleYtmImageUrl(bannerBest.url, 1440, 600)
        : searchAvatarUrl;

      const listenersText =
        readRunsText(header?.monthlyListenerCount) ||
        readRunsText(header?.subscriptionButton?.subscribeButtonRenderer?.longSubscriberCountText) ||
        readRunsText(header?.subscriptionButton?.subscribeButtonRenderer?.subscriberCountText) ||
        undefined;
      const bio = readRunsText(header?.description) || undefined;

      // Also extract verified official release titles & album/single-EP split from YTM artist shelves
      const ytmAlbumTitlesSet = new Set<string>();
      const ytmSingleOrEpTitlesSet = new Set<string>();
      const moreBrowseIds = new Set<string>();
      let ytmHasFullDiscography = false;

      const shelves = collectObjectsByKey(browseJson, 'musicCarouselShelfRenderer', [], 0, 30);
      for (const shelf of shelves) {
        const headerRenderer = shelf?.header?.musicCarouselShelfBasicHeaderRenderer;
        const shelfTitle = readRunsText(headerRenderer?.title).toLowerCase();
        const isAlbumShelf = /^[áa]lbum(?:es)?\b|\balbums\b/.test(shelfTitle);
        const isSingleOrEpShelf = /^(?:single|sencillo|ep)/.test(shelfTitle);
        if (!isAlbumShelf && !isSingleOrEpShelf) continue;

        const targetSet = isAlbumShelf ? ytmAlbumTitlesSet : ytmSingleOrEpTitlesSet;
        const shelfItems = Array.isArray(shelf?.contents) ? shelf.contents : [];
        for (const entry of shelfItems) {
          const twoRow = entry?.musicTwoRowItemRenderer;
          if (!twoRow) continue;
          const normTitle = normalizeReleaseTitle(readRunsText(twoRow.title));
          if (normTitle) targetSet.add(normTitle);
        }

        const moreId = String(
          headerRenderer?.moreContentButton?.buttonRenderer?.navigationEndpoint?.browseEndpoint?.browseId ?? ''
        ).trim();
        if (moreId) moreBrowseIds.add(moreId);
      }

      if (moreBrowseIds.size > 0 && Date.now() - ytmStartedAt < 1300) {
        const moreResults = await Promise.allSettled(
          Array.from(moreBrowseIds)
            .slice(0, 2)
            .map((mid) => ytmPost('browse', { browseId: mid }, 750))
        );
        for (const r of moreResults) {
          if (r.status !== 'fulfilled' || !r.value) continue;
          const twoRows = collectObjectsByKey(r.value, 'musicTwoRowItemRenderer', [], 0, 220);
          if (twoRows.length > 0) ytmHasFullDiscography = true;
          for (const twoRow of twoRows) {
            const normTitle = normalizeReleaseTitle(readRunsText(twoRow.title));
            if (!normTitle) continue;
            const sub = readRunsText(twoRow.subtitle).toLowerCase();
            if (/\b(?:[áa]lbum|album)\b/.test(sub)) {
              ytmAlbumTitlesSet.add(normTitle);
            } else {
              ytmSingleOrEpTitlesSet.add(normTitle);
            }
          }
        }
      }

      const result = {
        avatarUrl: searchAvatarUrl || bannerUrl,
        bannerUrl,
        listenersText,
        bio,
        ytmAlbumTitles: Array.from(ytmAlbumTitlesSet),
        ytmSingleOrEpTitles: Array.from(ytmSingleOrEpTitlesSet),
        ytmHasFullDiscography,
      };
      this.ytmVisualsCache.set(normCacheKey, { at: Date.now(), data: result });
      if (this.ytmVisualsCache.size > 120) {
        const oldest = this.ytmVisualsCache.keys().next().value;
        if (oldest) this.ytmVisualsCache.delete(oldest);
      }
      return result;
    } catch {
      return null;
    }
  }

  public async artist(id: string, signal?: AbortSignal, hintName?: string): Promise<ArtistDetail> {
    const resolvedId = CANONICAL_ARTIST_ID_REDIRECTS[id] ?? id;
    const cachedDetail = this.artistDetailCache.get(resolvedId);
    if (cachedDetail && Date.now() - cachedDetail.at < 15 * 60_000) {
      return cachedDetail.detail;
    }

    if (!signal) {
      const pending = this.inFlightArtist.get(resolvedId);
      if (pending) return pending;
    }

    const exec = (async (): Promise<ArtistDetail> => {
      const artistPromise = this.get(`/artist/${encodeURIComponent(resolvedId)}`, signal);
      const canonHint = hintName?.trim()
        ? canonicalizeArtistIdentity(resolvedId, hintName.trim()).name
        : resolvedId === '73148212'
          ? 'Cruzzi'
          : '';
      const ytmVisualsPromise = canonHint
        ? this.fetchYtMusicArtistVisuals(canonHint, signal).catch(() => null)
        : artistPromise
            .then((a) =>
              a?.name
                ? this.fetchYtMusicArtistVisuals(
                    canonicalizeArtistIdentity(resolvedId, String(a.name)).name,
                    signal
                  )
                : null
            )
            .catch(() => null);

      const sourceIds = MERGED_CANONICAL_ARTIST_IDS[resolvedId] ?? [resolvedId];
      const topTracksPromise = Promise.all(
        sourceIds.map((sid) =>
          this.get(`/artist/${encodeURIComponent(sid)}/top?limit=50`, signal)
            .then((top) => (top?.data ?? []) as Json[])
            .catch(() => [] as Json[])
        )
      ).then(async (rawLists) => {
        const mergedRawTop: Json[] = [];
        const seenTrackIds = new Set<string>();
        const seenTitleArtist = new Set<string>();
        for (const list of rawLists) {
          for (const t of list) {
            if (!t?.id) continue;
            const mapped = this.mapTrack(t);
            const sig = `${normalizeSearchStr(mapped.title)}::${normalizeSearchStr(mapped.artists[0]?.name ?? '')}`;
            if (seenTrackIds.has(mapped.id) || (sig !== '::' && seenTitleArtist.has(sig))) {
              continue;
            }
            seenTrackIds.add(mapped.id);
            if (sig !== '::') seenTitleArtist.add(sig);
            mergedRawTop.push(t);
            if (mergedRawTop.length >= 50) break;
          }
          if (mergedRawTop.length >= 50) break;
        }
        return this.enrichTracks(
          mergedRawTop,
          mergedRawTop.map((t: Json) => this.mapTrack(t)),
          6,
          signal,
          700
        );
      });

      const albumsPromise = Promise.all(
        sourceIds.map((sid) =>
          this.get(`/artist/${encodeURIComponent(sid)}/albums?limit=60`, signal)
            .then((res) => (Array.isArray(res?.data) ? (res.data as Json[]) : []))
            .catch(() => [] as Json[])
        )
      ).then((lists) => lists.flat());

      const lookupNamePromise: Promise<string> = canonHint
        ? Promise.resolve(canonHint)
        : artistPromise
            .then((artObj) =>
              artObj?.name
                ? canonicalizeArtistIdentity(resolvedId, String(artObj.name)).name
                : ''
            )
            .catch(() => '');

      const rawAppearancesPromise = (async (): Promise<Track[]> => {
        try {
          const targetName = (await lookupNamePromise).trim();
          if (!targetName) return [];
          const searchQ = targetName === 'Cruzzi' ? 'Cruz Cafuné' : targetName;
          const isCompilationOrJunkAppearance = (
            albumTitle: string,
            trackTitle: string,
            collectionType?: string
          ): boolean => {
            if (collectionType && collectionType.toLowerCase() === 'compilation') return true;
            const hay = `${albumTitle} ${trackTitle}`.toLowerCase();
            return /\b(?:various artists|varios artistas|hits\s*20\d{2}|éxitos\s*20\d{2}|exitos\s*20\d{2}|top\s*(?:50|100|hits)|summer\s*hits|best\s*of|lo\s*mejor\s*de|karaoke|tribute|sped\s*up|slowed(?:\s*\+\s*reverb)?|8d\s*audio|dj\s*mix|megamix|soundtrack\s*collection)\b/i.test(
              hay
            );
          };

          const searchController = new AbortController();
          const timer = setTimeout(() => searchController.abort(), 2400);
          const onOuterAbort = () => searchController.abort();
          signal?.addEventListener('abort', onOuterAbort, { once: true });

          const itunesController = new AbortController();
          const itunesTimer = setTimeout(() => itunesController.abort(), 2400);
          const onOuterItunes = () => itunesController.abort();
          signal?.addEventListener('abort', onOuterItunes, { once: true });

          interface ItunesSongHit {
            trackId: string;
            trackName: string;
            artistName: string;
            collectionName: string;
            collectionType?: string;
            artworkUrl: string;
            durationSec: number;
            releaseDate: string;
          }
          const fetchItunesSongs = async (): Promise<ItunesSongHit[]> => {
            try {
              const itRes = await this.fetchFn(
                `https://itunes.apple.com/search?term=${encodeURIComponent(searchQ)}&entity=song&country=ES&limit=80`,
                { signal: itunesController.signal }
              );
              if (!itRes.ok) return [];
              const itJson = (await itRes.json()) as { results?: Array<Record<string, any>> };
              const maxAllowedIso = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
              return (Array.isArray(itJson?.results) ? itJson.results : [])
                .map((row): ItunesSongHit => {
                  const art100 = String(row?.artworkUrl100 ?? row?.artworkUrl60 ?? '').trim();
                  const artHigh = art100 ? art100.replace(/\/\d+x\d+bb\./, '/600x600bb.') : '';
                  return {
                    trackId: String(row?.trackId ?? '').trim(),
                    trackName: String(row?.trackName ?? '').trim(),
                    artistName: String(row?.artistName ?? '').trim(),
                    collectionName: String(row?.collectionName ?? '').trim(),
                    collectionType: typeof row?.collectionType === 'string' ? row.collectionType : undefined,
                    artworkUrl: artHigh || art100,
                    durationSec: Math.max(30, Math.round(Number(row?.trackTimeMillis ?? 180_000) / 1000)),
                    releaseDate: String(row?.releaseDate ?? '').trim().slice(0, 10),
                  };
                })
                .filter(
                  (row) =>
                    row.trackName.length > 0 &&
                    row.artistName.length > 0 &&
                    /^\d{4}-\d{2}-\d{2}$/.test(row.releaseDate) &&
                    row.releaseDate <= maxAllowedIso &&
                    !isCompilationOrJunkAppearance(row.collectionName, row.trackName, row.collectionType)
                );
            } catch {
              return [];
            } finally {
              clearTimeout(itunesTimer);
              signal?.removeEventListener('abort', onOuterItunes);
            }
          };

          let rawHits: Json[] = [];
          let itunesHits: ItunesSongHit[] = [];
          try {
            const [dzGeneralRes, dzArtistRes, itRes] = await Promise.all([
              this.get(
                `/search/track?q=${encodeURIComponent(searchQ)}&limit=40`,
                searchController.signal
              ).catch(() => null),
              this.get(
                `/search/track?q=${encodeURIComponent(`artist:"${searchQ}"`)}&limit=40`,
                searchController.signal
              ).catch(() => null),
              fetchItunesSongs(),
            ]);
            const mergedRaw = [
              ...(Array.isArray(dzGeneralRes?.data) ? (dzGeneralRes.data as Json[]) : []),
              ...(Array.isArray(dzArtistRes?.data) ? (dzArtistRes.data as Json[]) : []),
            ];
            const seenDzIds = new Set<string>();
            rawHits = mergedRaw.filter((item) => {
              const idStr = String(item?.id ?? '');
              if (!idStr || seenDzIds.has(idStr)) return false;
              seenDzIds.add(idStr);
              const alTitle = String(item?.album?.title ?? '');
              const trTitle = String(item?.title ?? '');
              return !isCompilationOrJunkAppearance(alTitle, trTitle);
            });
            itunesHits = itRes;
          } finally {
            clearTimeout(timer);
            signal?.removeEventListener('abort', onOuterAbort);
          }

          const sourceIdSet = new Set(sourceIds);
          const normTarget = normalizeSearchStr(targetName);
          const matchesTargetArtist = (n: string): boolean => {
            const kn = normalizeSearchStr(n);
            if (!kn) return false;
            if (kn === normTarget) return true;
            if (
              (normTarget === 'cruzzi' || normTarget === 'cruz cafune') &&
              (kn === 'cruzzi' || kn === 'cruz cafune')
            ) {
              return true;
            }
            return false;
          };

          const stripTitleExtras = (title: string): string =>
            normalizeSearchStr(
              title
                .replace(/\s*\((?:feat\.?|ft\.?|with|con)\b[^)]*\)/gi, '')
                .replace(/\s*\[[^\]]*\]/g, '')
            );

          // Resolve ALL authentic non-compilation iTunes collabs sorted newest-first (no arbitrary 90-day cutoff)
          const existingTitleSet = new Set(rawHits.map((t) => stripTitleExtras(String(t?.title ?? ''))));
          const authenticItunesCollabs = itunesHits
            .filter((it) => {
              const normItArtists = normalizeSearchStr(it.artistName);
              const titlePlusArtist = `${normItArtists} ${normalizeSearchStr(it.trackName)}`;
              const involvesTarget =
                titlePlusArtist.includes(normTarget) ||
                ((normTarget === 'cruzzi' || normTarget === 'cruz cafune') &&
                  (titlePlusArtist.includes('cruzzi') || titlePlusArtist.includes('cruz cafune')));
              if (!involvesTarget) return false;
              const firstArtist = it.artistName.split(/\s*(?:,|&|\bx\b)\s*/i)[0]?.trim() ?? '';
              const isCollabOrGuest =
                !matchesTargetArtist(firstArtist) ||
                /\((?:feat\.?|ft\.?|with|con)\b/i.test(it.trackName) ||
                /[,&]/.test(it.artistName);
              return isCollabOrGuest;
            })
            .sort((a, b) => b.releaseDate.localeCompare(a.releaseDate));

          const recentItunesTitleSet = new Set(
            authenticItunesCollabs.slice(0, 12).map((it) => stripTitleExtras(it.trackName)).filter(Boolean)
          );

          const missingRecentItunes = authenticItunesCollabs
            .filter((it) => {
              const stripped = stripTitleExtras(it.trackName);
              return Boolean(stripped) && !existingTitleSet.has(stripped);
            })
            .slice(0, 8);

          if (missingRecentItunes.length > 0) {
            const extraRes = await Promise.allSettled(
              missingRecentItunes.map(async (it) => {
                const cleanTitle = it.trackName
                  .replace(/\s*\((?:feat\.?|ft\.?|with|con)\b[^)]*\)/gi, '')
                  .trim();
                const firstArtist = it.artistName.split(/\s*(?:,|&|\bx\b)\s*/i)[0]?.trim() ?? '';
                const subCtrl = new AbortController();
                const subTimer = setTimeout(() => subCtrl.abort(), 1100);
                const onOuterSub = () => subCtrl.abort();
                signal?.addEventListener('abort', onOuterSub, { once: true });
                try {
                  const r = await this.get(
                    `/search/track?q=${encodeURIComponent(`${firstArtist} ${cleanTitle}`)}&limit=3`,
                    subCtrl.signal
                  );
                  return Array.isArray(r?.data) ? (r.data as Json[]) : [];
                } catch {
                  return [] as Json[];
                } finally {
                  clearTimeout(subTimer);
                  signal?.removeEventListener('abort', onOuterSub);
                }
              })
            );
            const seenRawIds = new Set(rawHits.map((t) => String(t?.id ?? '')));
            for (const er of extraRes) {
              if (er.status !== 'fulfilled') continue;
              for (const item of er.value) {
                const alTitle = String(item?.album?.title ?? '');
                const trTitle = String(item?.title ?? '');
                if (
                  item?.id &&
                  !seenRawIds.has(String(item.id)) &&
                  !isCompilationOrJunkAppearance(alTitle, trTitle)
                ) {
                  seenRawIds.add(String(item.id));
                  rawHits.push(item);
                }
              }
            }
          }

          const itunesDateByTitle = new Map<string, string>();
          for (const it of authenticItunesCollabs) {
            const key = stripTitleExtras(it.trackName);
            if (!key) continue;
            const prev = itunesDateByTitle.get(key);
            if (!prev || it.releaseDate > prev) {
              itunesDateByTitle.set(key, it.releaseDate);
            }
          }

          const candidates = rawHits
            .filter((t) => {
              if (!t?.id) return false;
              const mainId = String(t?.artist?.id ?? '');
              const titleStr = String(t?.title ?? '');
              const alTitle = String(t?.album?.title ?? '');
              if (isCompilationOrJunkAppearance(alTitle, titleStr)) return false;
              return (
                !sourceIdSet.has(mainId) ||
                /\((?:feat\.?|ft\.?|with|con)\b/i.test(titleStr)
              );
            })
            .sort((x, y) => {
              const tx = stripTitleExtras(String(x?.title ?? ''));
              const ty = stripTitleExtras(String(y?.title ?? ''));
              const itX = itunesDateByTitle.get(tx) ?? '';
              const itY = itunesDateByTitle.get(ty) ?? '';
              if (itX || itY) {
                if (itX && !itY) return -1;
                if (itY && !itX) return 1;
                const dCmp = itY.localeCompare(itX);
                if (dCmp !== 0) return dCmp;
              }
              const matchX = recentItunesTitleSet.has(tx) ? 1 : 0;
              const matchY = recentItunesTitleSet.has(ty) ? 1 : 0;
              if (matchX !== matchY) return matchY - matchX;
              return Number(y?.id ?? 0) - Number(x?.id ?? 0);
            })
            .slice(0, 12);

          const enriched = candidates.length
            ? await this.enrichTracks(
                candidates,
                candidates.map((t) => this.mapTrack(t)),
                10,
                signal,
                1100
              )
            : [];

          const seenKey = new Set<string>();
          const kept: Track[] = [];
          for (const tr of enriched) {
            if (isCompilationOrJunkAppearance(tr.album?.name ?? '', tr.title)) continue;
            const involvesArtist = tr.artists.some(
              (ar) => (ar.id && sourceIdSet.has(ar.id)) || matchesTargetArtist(ar.name)
            );
            if (!involvesArtist) continue;
            const isGuestOrCollab =
              tr.artists.length > 1 ||
              !matchesTargetArtist(tr.artists[0]?.name ?? '');
            if (!isGuestOrCollab) continue;
            const dedupKey = `${stripTitleExtras(tr.title)}::${normalizeSearchStr(tr.artists[0]?.name ?? '')}`;
            if (seenKey.has(dedupKey)) continue;
            seenKey.add(dedupKey);

            const itDate = itunesDateByTitle.get(stripTitleExtras(tr.title));
            const upgradedTrack: Track =
              itDate && (!tr.releaseDate || itDate > tr.releaseDate)
                ? {
                    ...tr,
                    releaseDate: itDate,
                    releaseYear: Number(itDate.slice(0, 4)),
                  }
                : tr;
            kept.push(upgradedTrack);
          }

          // Synthesize fallback tracks for newest verified iTunes collaborations missing from Deezer
          const keptStrippedTitles = new Set(kept.map((t) => stripTitleExtras(t.title)));
          for (const it of authenticItunesCollabs.slice(0, 5)) {
            const stripped = stripTitleExtras(it.trackName);
            if (!stripped || keptStrippedTitles.has(stripped)) continue;
            keptStrippedTitles.add(stripped);
            const parsedArtists = it.artistName
              .split(/\s*(?:,|&|\bfeat\.?\b|\bft\.?\b)\s*/i)
              .map((n) => n.trim())
              .filter(Boolean)
              .map((name) => ({ name }));
            kept.push({
              id: it.trackId ? `it_${it.trackId}` : `it_${Date.parse(it.releaseDate)}_${kept.length}`,
              title: it.trackName,
              artists: parsedArtists.length ? parsedArtists : [{ name: it.artistName }],
              album: it.collectionName
                ? { id: it.trackId ? `it_alb_${it.trackId}` : 'it_alb_0', name: it.collectionName }
                : undefined,
              durationSec: it.durationSec || 180,
              thumbnailUrl: it.artworkUrl,
              thumbnailHighUrl: it.artworkUrl,
              source: 'youtube',
              releaseDate: it.releaseDate,
              releaseYear: Number(it.releaseDate.slice(0, 4)),
            });
          }

          kept.sort((x, y) => {
            const xExact = Boolean(x.releaseDate && /^\d{4}-\d{2}-\d{2}/.test(x.releaseDate));
            const yExact = Boolean(y.releaseDate && /^\d{4}-\d{2}-\d{2}/.test(y.releaseDate));
            if (xExact !== yExact) return xExact ? -1 : 1;
            const dx = x.releaseDate ?? `${x.releaseYear ?? 0}-01-01`;
            const dy = y.releaseDate ?? `${y.releaseYear ?? 0}-01-01`;
            const cmp = dy.localeCompare(dx);
            if (cmp !== 0) return cmp;
            const nx = Number.parseInt(x.id.replace(/\D/g, ''), 10) || 0;
            const ny = Number.parseInt(y.id.replace(/\D/g, ''), 10) || 0;
            return ny - nx;
          });
          return kept;
        } catch {
          return [];
        }
      })();

      const appearancesPromise = Promise.race([
        rawAppearancesPromise,
        new Promise<Track[]>((resolve) => setTimeout(() => resolve([]), 3800)),
      ]);

      const [a, topSongs, mergedRawReleases, related, ytmVisuals, appearances] =
        await Promise.all([
          artistPromise,
          topTracksPromise,
          albumsPromise,
          this.get(`/artist/${encodeURIComponent(resolvedId)}/related?limit=10`, signal),
          ytmVisualsPromise,
          appearancesPromise,
        ]);

      const baseArtist = this.mapArtist(a);
      const artist: ArtistSummary = {
        ...baseArtist,
        thumbnailUrl:
          sanitizeArtistImageUrl(ytmVisuals?.avatarUrl) ||
          baseArtist.thumbnailUrl,
        subscribersText: ytmVisuals?.listenersText || baseArtist.subscribersText,
      };

      const rawReleases = mergedRawReleases;
      const ytmAlbumSet = new Set(ytmVisuals?.ytmAlbumTitles ?? []);
      const ytmSingleSet = new Set(ytmVisuals?.ytmSingleOrEpTitles ?? []);
      const ytmAllSet = new Set<string>([...ytmAlbumSet, ...ytmSingleSet]);
      const hasYtmCatalog = ytmAllSet.size >= 2;
      const artistFans = Number(a?.nb_fan ?? 0);

      const matchesYtmCatalog = (normTitle: string, set: Set<string>): boolean => {
        if (!normTitle) return false;
        if (set.has(normTitle)) return true;
        if (normTitle.length < 4) return false;
        for (const entry of set) {
          if (entry.length >= 4 && (entry.startsWith(normTitle) || normTitle.startsWith(entry))) {
            return true;
          }
        }
        return false;
      };

      // Filter out homonym / fake AI spam releases uploaded to shared artist IDs on Deezer
      // and deduplicate identical normalized titles (keeping highest fan count / newest release).
      const keptByTitle = new Map<string, Json>();
      const recentCutoffMs = Date.now() - 45 * 86_400_000;
      for (const al of rawReleases) {
        const recType = String(al?.record_type ?? '').toLowerCase();
        if (recType === 'compile') continue;
        const normTitle = normalizeReleaseTitle(String(al?.title ?? ''));
        if (!normTitle) continue;
        const fans = Number(al?.fans ?? 0);
        const relDateStr = typeof al?.release_date === 'string' ? al.release_date.trim().slice(0, 10) : '';
        const relMs = /^\d{4}-\d{2}-\d{2}$/.test(relDateStr) ? Date.parse(`${relDateStr}T00:00:00Z`) : 0;
        const isRecentRelease = relMs > recentCutoffMs;

        if (hasYtmCatalog) {
          const matchedYtm = matchesYtmCatalog(normTitle, ytmAllSet);
          if (!matchedYtm) {
            if (isRecentRelease) {
              if (artistFans >= 1500 && fans === 0) continue;
            } else if (ytmVisuals?.ytmHasFullDiscography) {
              if (fans < 150) continue;
            } else if (artistFans >= 1500 && fans < 25) {
              continue;
            }
          }
        }

        const prev = keptByTitle.get(normTitle);
        if (!prev) {
          keptByTitle.set(normTitle, al);
        } else {
          const prevFans = Number(prev?.fans ?? 0);
          const prevDate = String(prev?.release_date ?? '');
          const nextDate = String(al?.release_date ?? '');
          if (fans > prevFans || (fans === prevFans && nextDate.localeCompare(prevDate) > 0)) {
            keptByTitle.set(normTitle, al);
          }
        }
      }

      const filteredReleases = Array.from(keptByTitle.values());
      const sortNewestFirst = (list: Json[]) =>
        [...list].sort((x, y) => {
          const dx = String(x.release_date ?? '');
          const dy = String(y.release_date ?? '');
          return dy.localeCompare(dx);
        });

      const isAlbumRelease = (al: Json): boolean => {
        const normTitle = normalizeReleaseTitle(String(al?.title ?? ''));
        const recType = String(al?.record_type ?? '').toLowerCase();
        if (hasYtmCatalog) {
          if (matchesYtmCatalog(normTitle, ytmAlbumSet)) return true;
          if (matchesYtmCatalog(normTitle, ytmSingleSet)) return false;
        }
        return recType !== 'single' && recType !== 'ep';
      };

      const albumsList = sortNewestFirst(
        filteredReleases.filter((al) => isAlbumRelease(al))
      ).map((al) => this.mapAlbum(al, a));

      const rawSinglesList = sortNewestFirst(
        filteredReleases.filter((al) => !isAlbumRelease(al))
      ).map((al) => this.mapAlbum(al, a));
      const singlesList = filterWaterfallAlbumSingles(albumsList, rawSinglesList);

      const sanitizedBanner =
        sanitizeArtistImageUrl(ytmVisuals?.bannerUrl) ||
        sanitizeArtistImageUrl(ytmVisuals?.avatarUrl) ||
        sanitizeArtistImageUrl(a.picture_xl) ||
        artist.thumbnailUrl;

      const detail = {
        artist,
        bannerUrl: sanitizedBanner || undefined,
        description: ytmVisuals?.bio || artist.subscribersText || '',
        topSongs,
        appearances,
        albums: albumsList,
        singles: singlesList,
        relatedArtists: (related.data ?? []).map((r: Json) => this.mapArtist(r)),
      } as ArtistDetail;
      this.artistDetailCache.set(resolvedId, { at: Date.now(), detail });
      if (this.artistDetailCache.size > 24) {
        const oldest = this.artistDetailCache.keys().next().value;
        if (oldest) this.artistDetailCache.delete(oldest);
      }
      return detail;
    })();

    if (!signal) {
      this.inFlightArtist.set(resolvedId, exec);
    }
    try {
      return await exec;
    } finally {
      this.inFlightArtist.delete(resolvedId);
    }
  }

  public async album(id: string, signal?: AbortSignal): Promise<AlbumDetail> {
    const cachedAlbum = this.albumDetailCache.get(id);
    if (cachedAlbum && Date.now() - cachedAlbum.at < 15 * 60_000) {
      return cachedAlbum.detail;
    }
    if (!signal) {
      const pending = this.inFlightAlbum.get(id);
      if (pending) return pending;
    }

    const exec = (async (): Promise<AlbumDetail> => {
      const a = await this.get(`/album/${encodeURIComponent(id)}`, signal);
      let trackData: Json[] = a.tracks?.data ?? [];
      if (a.nb_tracks && trackData.length < Number(a.nb_tracks)) {
        const fullTracks = await this.get(`/album/${encodeURIComponent(id)}/tracks?limit=100`, signal).catch(() => null);
        if (Array.isArray(fullTracks?.data) && fullTracks.data.length > trackData.length) {
          trackData = fullTracks.data;
        }
      }
      const rawTracks = trackData.map((t: Json) => ({
        ...t,
        artist: t.artist ?? a.artist,
        album: t.album ?? a,
      }));
      const tracks = await this.enrichTracks(
        rawTracks,
        rawTracks.map((t: Json) => this.mapTrack(t, a)),
        30,
        signal,
        650
      );

      // Promote co-headlining joint-album collaborators (e.g. "TA FACIL" -> Lucho RK, La Pantera)
      const mappedAlbum = this.mapAlbum(a);
      if (tracks.length >= 2) {
        const collabCounts = new Map<string, { ref: { id?: string; name: string }; count: number }>();
        for (const tr of tracks) {
          const seenInTrack = new Set<string>();
          for (const ar of tr.artists) {
            const norm = normalizeSearchStr(ar.name);
            if (!norm || seenInTrack.has(norm)) continue;
            seenInTrack.add(norm);
            const prev = collabCounts.get(norm);
            collabCounts.set(norm, { ref: prev?.ref ?? ar, count: (prev?.count ?? 0) + 1 });
          }
        }
        const threshold = Math.max(2, Math.ceil(tracks.length * 0.6));
        const existingNorms = new Set(mappedAlbum.artists.map((x) => normalizeSearchStr(x.name)));
        const promoted = [...mappedAlbum.artists];
        const candidates = Array.from(collabCounts.entries())
          .filter(([norm, info]) => info.count >= threshold && !existingNorms.has(norm))
          .sort((x, y) => y[1].count - x[1].count);
        for (const [norm, info] of candidates) {
          existingNorms.add(norm);
          promoted.push(info.ref);
        }
        mappedAlbum.artists = promoted;
      }

      const detail: AlbumDetail = {
        album: mappedAlbum,
        tracks,
      };
      this.albumDetailCache.set(id, { at: Date.now(), detail });
      if (this.albumDetailCache.size > 24) {
        const oldest = this.albumDetailCache.keys().next().value;
        if (oldest) this.albumDetailCache.delete(oldest);
      }
      return detail;
    })();

    if (!signal) {
      this.inFlightAlbum.set(id, exec);
    }
    try {
      return await exec;
    } finally {
      this.inFlightAlbum.delete(id);
    }
  }

  public async albumByQuery(title: string, artist?: string, signal?: AbortSignal): Promise<AlbumDetail | null> {
    const cleanTitle = title.trim();
    if (!cleanTitle) return null;
    const queries = Array.from(
      new Set([artist ? `${cleanTitle} ${artist}` : cleanTitle, cleanTitle].map((q) => q.trim()).filter(Boolean))
    );
    for (const q of queries) {
      const res = await this.get(`/search/album?q=${encodeURIComponent(q)}&limit=12`, signal).catch(() => null);
      const list: Json[] = res?.data ?? [];
      if (list.length === 0) continue;
      const scored = list
        .map((al) => ({
          al,
          score: scoreAlbumForQuery(this.mapAlbum(al), q),
        }))
        .sort((a, b) => b.score - a.score);
      const best = scored[0]?.al;
      if (best?.id) {
        return this.album(String(best.id), signal);
      }
    }
    return null;
  }

  public async playlist(id: string, maxItems = 100, signal?: AbortSignal): Promise<PlaylistDetail> {
    const p = await this.get(`/playlist/${encodeURIComponent(id.replace(/^VL/, ''))}`, signal);
    const rawTracks = (p.tracks?.data ?? []).slice(0, maxItems);
    const tracks = await this.enrichTracks(
      rawTracks,
      rawTracks.map((t: Json) => this.mapTrack(t)),
      12,
      signal
    );
    return {
      playlist: this.mapPlaylist(p),
      tracks,
    } as PlaylistDetail;
  }

  public async related(trackId: string, signal?: AbortSignal): Promise<RelatedResult> {
    const raw = trackId.replace(DZ_PREFIX, '');
    const t = await this.get(`/track/${encodeURIComponent(raw)}`, signal);
    const seedTrackId = toTrackId(raw);
    const seedArtistId = t?.artist?.id ? String(t.artist.id) : '';
    const seedArtistName = String(t?.artist?.name ?? '').trim();
    const seedAlbumId = t?.album?.id ? String(t.album.id) : '';

    const [relRes, radioRes, artistTopRes, albumRes, playlistSearchRes] = await Promise.allSettled([
      seedArtistId
        ? this.get(`/artist/${encodeURIComponent(seedArtistId)}/related?limit=10`, signal)
        : Promise.resolve({ data: [] }),
      seedArtistId
        ? this.get(`/artist/${encodeURIComponent(seedArtistId)}/radio?limit=25`, signal)
        : Promise.resolve({ data: [] }),
      seedArtistId
        ? this.get(`/artist/${encodeURIComponent(seedArtistId)}/top?limit=15`, signal)
        : Promise.resolve({ data: [] }),
      seedAlbumId
        ? this.get(`/album/${encodeURIComponent(seedAlbumId)}`, signal)
        : Promise.resolve(null),
      seedArtistName
        ? this.get(`/search/playlist?q=${encodeURIComponent(seedArtistName)}&limit=6`, signal)
        : Promise.resolve({ data: [] }),
    ]);

    const relArtistsRaw: Json[] =
      relRes.status === 'fulfilled' && Array.isArray(relRes.value?.data) ? relRes.value.data : [];
    const radioRaw: Json[] =
      radioRes.status === 'fulfilled' && Array.isArray(radioRes.value?.data)
        ? radioRes.value.data
        : [];
    const artistTopRaw: Json[] =
      artistTopRes.status === 'fulfilled' && Array.isArray(artistTopRes.value?.data)
        ? artistTopRes.value.data
        : [];
    const albumData: Json | null = albumRes.status === 'fulfilled' ? albumRes.value : null;
    const playlistsRaw: Json[] =
      playlistSearchRes.status === 'fulfilled' && Array.isArray(playlistSearchRes.value?.data)
        ? playlistSearchRes.value.data
        : [];

    // Gather collaborator IDs from the seed track & artist's top tracks (vital for underground scenes)
    const collabIds: string[] = [];
    const collabSet = new Set<string>();
    const addCollabId = (idVal: unknown) => {
      const idStr = idVal !== undefined && idVal !== null ? String(idVal).trim() : '';
      if (!idStr || idStr === seedArtistId || collabSet.has(idStr)) return;
      collabSet.add(idStr);
      collabIds.push(idStr);
    };

    if (Array.isArray(t?.contributors)) {
      for (const c of t.contributors) addCollabId(c?.id);
    }
    for (const topItem of artistTopRaw) {
      if (topItem?.artist?.id) addCollabId(topItem.artist.id);
      if (Array.isArray(topItem?.contributors)) {
        for (const c of topItem.contributors) addCollabId(c?.id);
      }
    }

    // If Deezer omitted contributor IDs on underground tracks, resolve featured artists by name
    if (collabIds.length < 3) {
      const candidateNames: string[] = [
        ...parseFeaturedArtistsFromTitle(String(t?.title ?? '')),
        ...artistTopRaw.slice(0, 6).flatMap((x) => parseFeaturedArtistsFromTitle(String(x?.title ?? ''))),
      ].filter(
        (name, idx, arr) =>
          name.toLowerCase() !== seedArtistName.toLowerCase() &&
          arr.findIndex((other) => other.toLowerCase() === name.toLowerCase()) === idx
      );
      if (candidateNames.length > 0) {
        const lookedUp = await Promise.allSettled(
          candidateNames.slice(0, 3).map((name) =>
            this.get(`/search/artist?q=${encodeURIComponent(name)}&limit=3`, signal)
          )
        );
        for (let i = 0; i < lookedUp.length; i++) {
          const item = lookedUp[i];
          if (item?.status !== 'fulfilled') continue;
          const hits: Json[] = item.value?.data ?? [];
          const want = candidateNames[i]!.toLowerCase();
          const exact =
            hits.find((a) => String(a?.name ?? '').trim().toLowerCase() === want) ?? hits[0];
          if (exact?.id) addCollabId(exact.id);
        }
      }
    }

    const peerIdsToFetch = [
      ...collabIds.slice(0, 4),
      ...relArtistsRaw
        .map((a) => String(a?.id ?? '').trim())
        .filter((idStr) => idStr && idStr !== seedArtistId && !collabSet.has(idStr))
        .slice(0, 4),
    ];

    const scenePlaylists = playlistsRaw
      .filter((p) => {
        const n = Number(p?.nb_tracks ?? 0);
        return p?.id && n >= 5 && n <= 180;
      })
      .slice(0, 2);

    const [peerTopResponses, playlistResponses] = await Promise.all([
      Promise.allSettled(
        peerIdsToFetch.map((idStr) =>
          this.get(`/artist/${encodeURIComponent(idStr)}/top?limit=5`, signal)
        )
      ),
      Promise.allSettled(
        scenePlaylists.map((p) =>
          this.get(`/playlist/${encodeURIComponent(String(p.id))}/tracks?limit=40`, signal)
        )
      ),
    ]);

    const collabTracks: Track[] = [];
    const relArtistTracks: Track[] = [];
    peerTopResponses.forEach((res, idx) => {
      if (res.status !== 'fulfilled' || !Array.isArray(res.value?.data)) return;
      const mapped = res.value.data.map((x: Json) => this.mapTrack(x));
      if (idx < collabIds.slice(0, 4).length) {
        collabTracks.push(...mapped);
      } else {
        relArtistTracks.push(...mapped);
      }
    });

    const playlistSceneTracks: Track[] = [];
    playlistResponses.forEach((res, idx) => {
      if (res.status !== 'fulfilled' || !Array.isArray(res.value?.data)) return;
      const rawItems: Json[] = res.value.data;
      const plTitle = String(scenePlaylists[idx]?.title ?? '').toLowerCase();
      const seedLower = seedArtistName.toLowerCase();
      const containsSeed =
        (seedLower.length >= 3 && plTitle.includes(seedLower)) ||
        rawItems.some(
          (item) =>
            (seedArtistId && String(item?.artist?.id ?? '') === seedArtistId) ||
            (seedLower && String(item?.artist?.name ?? '').toLowerCase() === seedLower)
        );
      if (!containsSeed) return;
      playlistSceneTracks.push(...rawItems.map((x: Json) => this.mapTrack(x)));
    });

    const radioTracks = radioRaw.map((x: Json) => this.mapTrack(x));
    const seedOtherTracks = artistTopRaw
      .map((x: Json) => this.mapTrack(x))
      .filter((tr) => !seedAlbumId || tr.album?.id !== seedAlbumId);

    // Same-genre cushion ONLY if artist radio, collaborators, related artists & playlists produced < 8 tracks
    const preCount =
      collabTracks.length +
      relArtistTracks.length +
      playlistSceneTracks.length +
      radioTracks.length +
      seedOtherTracks.length;
    const genreTracks: Track[] = [];
    const genreId = Number(albumData?.genres?.data?.[0]?.id ?? albumData?.genre_id ?? -1);
    if (preCount < 8 && Number.isFinite(genreId) && genreId > 0) {
      const genreRes = await this.get(`/chart/${genreId}/tracks?limit=15`, signal).catch(() => ({
        data: [],
      }));
      if (Array.isArray(genreRes?.data)) {
        genreTracks.push(...genreRes.data.map((x: Json) => this.mapTrack(x)));
      }
    }

    // Interleave style-matched pools cleanly while capping any single artist/album from dominating
    const pools: Track[][] = [
      collabTracks,
      playlistSceneTracks,
      relArtistTracks,
      radioTracks,
      seedOtherTracks,
      genreTracks,
    ];
    const cursors = pools.map(() => 0);
    const seenIds = new Set<string>([seedTrackId]);
    const seenTitleArtist = new Set<string>();
    if (t?.title && seedArtistName) {
      seenTitleArtist.add(
        `${String(t.title).trim().toLowerCase()}::${seedArtistName.toLowerCase()}`
      );
    }
    const artistCounts = new Map<string, number>();
    const mixed: Track[] = [];

    let progressed = true;
    while (mixed.length < 30 && progressed) {
      progressed = false;
      for (let pIdx = 0; pIdx < pools.length && mixed.length < 30; pIdx++) {
        const pool = pools[pIdx]!;
        while (cursors[pIdx]! < pool.length) {
          const cand = pool[cursors[pIdx]!]!;
          cursors[pIdx]!++;
          if (!cand?.id || seenIds.has(cand.id)) continue;
          const primaryArtist = (cand.artists[0]?.name ?? '').trim().toLowerCase();
          const normKey = `${cand.title.trim().toLowerCase()}::${primaryArtist}`;
          if (seenTitleArtist.has(normKey)) continue;
          const aCount = artistCounts.get(primaryArtist) ?? 0;
          const maxForArtist =
            seedArtistName && primaryArtist === seedArtistName.toLowerCase() ? 3 : 2;
          if (primaryArtist && aCount >= maxForArtist) continue;
          seenIds.add(cand.id);
          seenTitleArtist.add(normKey);
          if (primaryArtist) artistCounts.set(primaryArtist, aCount + 1);
          mixed.push(cand);
          progressed = true;
          break;
        }
      }
    }

    return {
      tracks: mixed,
      artists: relArtistsRaw.map((r: Json) => this.mapArtist(r)),
      playlists: [],
    } as RelatedResult;
  }

  public async track(trackId: string, signal?: AbortSignal): Promise<Track> {
    const t = await this.get(`/track/${encodeURIComponent(trackId.replace(DZ_PREFIX, ''))}`, signal);
    return this.mapTrack(t);
  }

  public async getTrack(trackId: string, signal?: AbortSignal): Promise<Track | null> {
    try {
      return await this.track(trackId, signal);
    } catch {
      return null;
    }
  }

  private async fetchYouTubeTrackCredits(
    title: string,
    artist?: string,
    signal?: AbortSignal
  ): Promise<ParsedYouTubeCredits | null> {
    const cleanTitle = title.trim();
    if (!cleanTitle) return null;

    const postWithTimeout = async (url: string, bodyObj: Record<string, unknown>, timeoutMs = 1800) => {
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
      const onOuterAbort = () => controller?.abort();
      signal?.addEventListener('abort', onOuterAbort, { once: true });
      try {
        const res = await this.fetchFn(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(bodyObj),
          signal: controller?.signal ?? signal,
        });
        if (!res.ok) return null;
        return (await res.json()) as Json;
      } catch {
        return null;
      } finally {
        if (timer) clearTimeout(timer);
        signal?.removeEventListener('abort', onOuterAbort);
      }
    };

    try {
      const primaryArtist = (artist ?? '').split(',')[0]?.trim() ?? '';
      const q = primaryArtist ? `${primaryArtist} ${cleanTitle}` : cleanTitle;
      const searchJson = await postWithTimeout(
        'https://music.youtube.com/youtubei/v1/search?prettyPrint=false',
        {
          context: { client: YTM_WEB_REMIX_CLIENT },
          query: q,
          params: 'EgWKAQIIAWoMEAMQBBAJEAoQBRAV',
        },
        1800
      );
      if (!searchJson) return null;

      const items = collectObjectsByKey(searchJson, 'musicResponsiveListItemRenderer', [], 0, 20);
      const wantTitleNorm = normalizeSearchStr(cleanTitle);
      const wantArtistNorm = normalizeSearchStr(primaryArtist);

      let chosenVideoId = '';
      let bestCandidateScore = -1;
      for (const item of items) {
        const vid = String(
          item?.playlistItemData?.videoId ??
            item?.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint?.videoId ??
            ''
        ).trim();
        if (!vid || !/^[a-zA-Z0-9_-]{11}$/.test(vid)) continue;
        const tText = normalizeSearchStr(
          readRunsText(item?.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text)
        );
        const subText = normalizeSearchStr(
          readRunsText(item?.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text)
        );
        let sc = 0;
        if (tText === wantTitleNorm) sc += 100;
        else if (wantTitleNorm && (tText.includes(wantTitleNorm) || wantTitleNorm.includes(tText))) sc += 50;
        if (wantArtistNorm && subText.includes(wantArtistNorm)) sc += 60;
        if (sc > bestCandidateScore) {
          bestCandidateScore = sc;
          chosenVideoId = vid;
        }
      }

      if (!chosenVideoId) {
        const m = JSON.stringify(searchJson).match(/"videoId":"([a-zA-Z0-9_-]{11})"/);
        chosenVideoId = m?.[1] ?? '';
      }
      if (!chosenVideoId) return null;

      const playerJson = await postWithTimeout(
        'https://www.youtube.com/youtubei/v1/player?prettyPrint=false',
        {
          context: {
            client: {
              clientName: 'WEB',
              clientVersion: '2.20250310.01.00',
              hl: 'en',
              gl: 'US',
            },
          },
          videoId: chosenVideoId,
        },
        1800
      );
      const desc = String(playerJson?.videoDetails?.shortDescription ?? '');
      if (!desc) return null;
      return parseYouTubeDescriptionCredits(desc);
    } catch {
      return null;
    }
  }

  /** Fetches rich song credits (performers with roles, producers, composers, lyricists, engineers, label, ISRC, release date). */
  public async trackCredits(
    trackId: string,
    hint?: { title?: string; artist?: string },
    signal?: AbortSignal
  ): Promise<TrackCredits | null> {
    const cacheKey = `${trackId}::${hint?.title ?? ''}::${hint?.artist ?? ''}`;
    const hit = this.creditsCache.get(cacheKey);
    if (hit && Date.now() - hit.at < 30 * 60_000) return hit.credits;

    const deezerTask = (async () => {
      let rawTrack: Json | null = null;
      try {
        if (isDeezerTrackId(trackId) || /^\d+$/.test(trackId)) {
          rawTrack = await this.get(
            `/track/${encodeURIComponent(trackId.replace(DZ_PREFIX, ''))}`,
            signal
          );
        } else if (hint?.title) {
          const q = `${hint.title} ${hint.artist ?? ''}`.trim();
          const sr = await this.get(`/search/track?q=${encodeURIComponent(q)}&limit=5`, signal);
          const list = Array.isArray(sr?.data) ? (sr.data as Json[]) : [];
          const normReqTitle = normalizeSearchStr(hint.title);
          const best =
            list.find((item) => normalizeSearchStr(String(item?.title ?? '')) === normReqTitle) ??
            list[0];
          if (best?.id) {
            rawTrack = await this.get(`/track/${encodeURIComponent(String(best.id))}`, signal);
          }
        }
      } catch {
        rawTrack = null;
      }

      let rawAlbum: Json | null = null;
      if (rawTrack?.album?.id) {
        rawAlbum = await this.get(
          `/album/${encodeURIComponent(String(rawTrack.album.id))}`,
          signal
        ).catch(() => null);
      }
      return { rawTrack, rawAlbum };
    })();

    const ytHintTitle = hint?.title?.trim() ?? '';
    const ytTask = ytHintTitle
      ? this.fetchYouTubeTrackCredits(ytHintTitle, hint?.artist, signal).catch(() => null)
      : deezerTask.then(({ rawTrack }) =>
          rawTrack?.title
            ? this.fetchYouTubeTrackCredits(
                String(rawTrack.title),
                String(rawTrack.artist?.name ?? ''),
                signal
              ).catch(() => null)
            : null
        );

    const [{ rawTrack, rawAlbum }, ytCredits] = await Promise.all([deezerTask, ytTask]);

    if (!rawTrack && !hint?.title && !ytCredits) return null;

    const performers: TrackCreditPerson[] = [];
    const seenPerformers = new Set<string>();
    const pushPerformer = (nameVal: unknown, roleVal: unknown, idVal?: unknown) => {
      const name = typeof nameVal === 'string' ? nameVal.trim() : '';
      if (!name) return;
      const key = normalizeSearchStr(name);
      if (!key || seenPerformers.has(key)) return;
      seenPerformers.add(key);
      const rawRole = typeof roleVal === 'string' ? roleVal.trim() : '';
      const role =
        !rawRole || /^main$/i.test(rawRole)
          ? 'Artista principal'
          : /^featured?$/i.test(rawRole)
            ? 'Artista invitado'
            : rawRole;
      const id =
        idVal !== undefined && idVal !== null && String(idVal).trim()
          ? String(idVal).trim()
          : undefined;
      performers.push({ name, role, ...(id ? { id } : {}) });
    };

    if (rawTrack?.artist) {
      pushPerformer(rawTrack.artist.name, 'Artista principal', rawTrack.artist.id);
    }
    if (Array.isArray(rawTrack?.contributors)) {
      for (const c of rawTrack.contributors) {
        if (c) pushPerformer(c.name, c.role, c.id);
      }
    }
    const titleStr = String(rawTrack?.title ?? hint?.title ?? 'Pista');
    for (const feat of parseFeaturedArtistsFromTitle(titleStr)) {
      pushPerformer(feat, 'Artista invitado');
    }
    if (ytCredits) {
      for (const yp of ytCredits.performers) {
        pushPerformer(yp.name, yp.role);
      }
    }
    if (performers.length === 0 && hint?.artist) {
      for (const part of hint.artist.split(/\s*(?:,|&)\s*/)) {
        if (part.trim()) pushPerformer(part.trim(), 'Artista principal');
      }
    }

    const composers: string[] = [];
    const lyricists: string[] = [];
    const producers: string[] = [];
    const engineers: string[] = [];
    const seenComposers = new Set<string>();
    const seenLyricists = new Set<string>();
    const seenProducers = new Set<string>();
    const seenEngineers = new Set<string>();
    const pushUnique = (list: string[], seen: Set<string>, nameVal: string) => {
      const clean = nameVal.trim();
      if (!clean) return;
      const k = normalizeSearchStr(clean);
      if (!k || seen.has(k)) return;
      seen.add(k);
      list.push(clean);
    };

    if (ytCredits) {
      for (const p of ytCredits.producers) pushUnique(producers, seenProducers, p);
      for (const c of ytCredits.composers) pushUnique(composers, seenComposers, c);
      for (const l of ytCredits.lyricists) pushUnique(lyricists, seenLyricists, l);
      for (const e of ytCredits.engineers) pushUnique(engineers, seenEngineers, e);
    }

    const isrc = typeof rawTrack?.isrc === 'string' && rawTrack.isrc.trim() ? rawTrack.isrc.trim() : undefined;

    // Optional MusicBrainz lookup by ISRC to enrich or fill composer / lyricist / producer / engineer credits
    if (isrc) {
      const mbCtrl = new AbortController();
      const mbTimer = setTimeout(() => mbCtrl.abort(), 1800);
      try {
        const mbHeaders = {
          Accept: 'application/json',
          'User-Agent': 'pMusic/0.18.5 (https://pmusic.app)',
        };
        const searchRes = await this.fetchFn(
          `https://musicbrainz.org/ws/2/recording?query=isrc:${encodeURIComponent(isrc)}&fmt=json`,
          { headers: mbHeaders, signal: mbCtrl.signal }
        );
        if (searchRes.ok) {
          const mbJson = (await searchRes.json()) as { recordings?: Array<{ id?: string }> };
          const recId = mbJson?.recordings?.[0]?.id;
          if (recId) {
            const relRes = await this.fetchFn(
              `https://musicbrainz.org/ws/2/recording/${encodeURIComponent(recId)}?inc=artist-rels+work-rels+work-level-rels&fmt=json`,
              { headers: mbHeaders, signal: mbCtrl.signal }
            );
            if (relRes.ok) {
              const relData = (await relRes.json()) as { relations?: Array<Record<string, any>> };
              const visitRelations = (rels: Array<Record<string, any>> | undefined) => {
                if (!Array.isArray(rels)) return;
                for (const rel of rels) {
                  const type = String(rel?.type ?? '').toLowerCase();
                  const arName = String(rel?.artist?.name ?? '').trim();
                  if (arName) {
                    if (/composer|arranger/.test(type)) {
                      pushUnique(composers, seenComposers, arName);
                    } else if (/lyricist|author|writer/.test(type)) {
                      pushUnique(lyricists, seenLyricists, arName);
                    } else if (/producer/.test(type)) {
                      pushUnique(producers, seenProducers, arName);
                    } else if (/mix|mastering|engineer|programming|recording/.test(type)) {
                      pushUnique(engineers, seenEngineers, arName);
                    }
                  }
                  if (Array.isArray(rel?.work?.relations)) {
                    visitRelations(rel.work.relations);
                  }
                }
              };
              visitRelations(relData.relations);
            }
          }
        }
      } catch {
        // MusicBrainz is best-effort only; never fail credits endpoint
      } finally {
        clearTimeout(mbTimer);
      }
    }

    const writers: string[] = [];
    const seenWriters = new Set<string>();
    for (const c of composers) pushUnique(writers, seenWriters, c);
    for (const l of lyricists) pushUnique(writers, seenWriters, l);

    const labelStr =
      ytCredits?.label ||
      (typeof rawAlbum?.label === 'string' && rawAlbum.label.trim()
        ? rawAlbum.label.trim()
        : undefined);
    const releaseDate =
      typeof rawTrack?.release_date === 'string' && rawTrack.release_date.trim()
        ? rawTrack.release_date.trim()
        : typeof rawAlbum?.release_date === 'string' && rawAlbum.release_date.trim()
          ? rawAlbum.release_date.trim()
          : ytCredits?.releaseDate;
    const bpmVal =
      typeof rawTrack?.bpm === 'number' && Number.isFinite(rawTrack.bpm) && rawTrack.bpm > 0
        ? Math.round(rawTrack.bpm)
        : undefined;

    const sources: string[] = [];
    if (rawTrack) sources.push('deezer');
    if (ytCredits) sources.push('youtube');
    if (isrc && (composers.length || lyricists.length || producers.length)) {
      sources.push('musicbrainz');
    }

    const credits: TrackCredits = {
      trackId,
      title: titleStr,
      performers,
      writers,
      producers,
      ...(composers.length > 0 ? { composers } : {}),
      ...(lyricists.length > 0 ? { lyricists } : {}),
      ...(engineers.length > 0 ? { engineers } : {}),
      ...(ytCredits?.distributor ? { distributor: ytCredits.distributor } : {}),
      ...(labelStr ? { label: labelStr } : {}),
      source: labelStr ?? 'Catálogo pMusic',
      ...(rawTrack?.album?.title ? { albumTitle: String(rawTrack.album.title) } : {}),
      ...(releaseDate ? { releaseDate } : {}),
      ...(isrc ? { isrc } : {}),
      ...(bpmVal ? { bpm: bpmVal } : {}),
      explicit: Boolean(rawTrack?.explicit_lyrics),
      fetchedFrom: sources.join('+') || 'metadata',
    };

    this.creditsCache.set(cacheKey, { at: Date.now(), credits });
    if (this.creditsCache.size > 40) {
      this.creditsCache.delete(this.creditsCache.keys().next().value as string);
    }
    return credits;
  }

  /** Fragmento de 30 s (siempre disponible) usado como último recurso. */
  public async previewUrl(trackId: string, signal?: AbortSignal): Promise<string | null> {
    const raw = trackId.replace(DZ_PREFIX, '');
    // Sin caché: las URLs de preview caducan.
    const res = await this.fetchFn(`${API}/track/${encodeURIComponent(raw)}`, { signal });
    const t = (await res.json()) as Json;
    return t?.preview || null;
  }
}
