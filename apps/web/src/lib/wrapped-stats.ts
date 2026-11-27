import type { DevicePlatform, Track, WrappedListenEvent } from '@pmusic/core';

const WRAPPED_STORAGE_KEY = 'pmusic.wrapped.events.v1';
const MAX_LOCAL_EVENTS = 5000;

export interface WrappedRankedItem {
  key: string;
  title: string;
  subtitle?: string;
  thumbnailUrl?: string;
  plays: number;
  minutes: number;
}

export interface WrappedGenreItem {
  genre: string;
  plays: number;
  minutes: number;
  percent: number;
}

export interface WrappedSummary {
  year: number;
  totalMinutes: number;
  totalHours: number;
  totalPlays: number;
  uniqueTracks: number;
  uniqueArtists: number;
  uniqueGenres: number;
  topTracks: WrappedRankedItem[];
  topArtists: WrappedRankedItem[];
  topGenres: WrappedGenreItem[];
  peakHour: number;
  listeningPersona: {
    title: string;
    subtitle: string;
  };
  longestStreakDays: number;
  topMonth: {
    name: string;
    minutes: number;
  };
  mostLoopedTrack: WrappedRankedItem | null;
}

const MONTHS_ES = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
];

const GENRE_KEYWORDS: Array<{ genre: string; patterns: RegExp[] }> = [
  {
    genre: 'Reggaeton / Urbano',
    patterns: [
      /bad bunny|quevedo|feid|rauw|karol g|myke towers|eladio|mora|ozuna|anuel|daddy yankee|j balvin|maluma|tainy|saiko|jc reyes|omar courtz|dei v|yandel|wisin|arcangel|chencho|plan b|young miko|blessd|ryan castro|nicki nicole|bizarrap|dillom|duki|emilia|tiago pzk|maria becerra|trueno|rel[s]? b/i,
      /reggaeton|perreo|dembow|urbano|baila|bellakeo/i,
    ],
  },
  {
    genre: 'Trap / Hip-Hop',
    patterns: [
      /travis scott|drake|kendrick|kanye|playboi carti|future|metro boomin|21 savage|lil baby|gunna|don toliver|asap rocky|j\.?\s*cole|eminem|50 cent|snoop|tupac|biggie|post malone|central cee|dave|morad|beny jr|c\.?\s*tangana|kidd keo|yung beef|natos y waor|ayax|kase\.?o/i,
      /\btrap\b|\brap\b|hip[\s-]?hop|freestyle|drill/i,
    ],
  },
  {
    genre: 'Pop',
    patterns: [
      /taylor swift|the weeknd|dua lipa|billie eilish|ariana grande|olivia rodrigo|sabrina carpenter|harry styles|ed sheeran|bruno mars|justin bieber|shawn mendes|katy perry|lady gaga|rihanna|beyonce|aitana|rosalia|lola indigo|melendi|estopa|david bisbal|sebastian yatra|morat|camilo/i,
      /\bpop\b/i,
    ],
  },
  {
    genre: 'Electrónica / House',
    patterns: [
      /daft punk|calvin harris|david guetta|martin garrix|avicii|fred again|skrillex|tiesto|kygo|marshmello|fisher|peggy gou|disclosure|rufus du sol|bicep|anyma|keinemusik|dom dolla|john summit|alesso|swedish house mafia/i,
      /house|techno|edm|electro|remix|club|trance|dubstep|synth/i,
    ],
  },
  {
    genre: 'Rock / Indie',
    patterns: [
      /arctic monkeys|tame impala|coldplay|radiohead|nirvana|queen|pink floyd|linkin park|green day|red hot chili|metallica|ac\/dc|the strokes|oasis|blur|gorillaz|the neighbourhood|cigarettes after sex|mac demarco|extremoduro|fito|hombres g|vetusta morla|iz[aá]l|ar[de] bogot[aá]/i,
      /\brock\b|\bindie\b|\bpunk\b|\bmetal\b|alternative/i,
    ],
  },
  {
    genre: 'R&B / Soul',
    patterns: [
      /frank ocean|sza|daniel caesar|brent faiyaz|the mar[ií]as|kali uchis|summer walker|bryson tiller|partynextdoor|steve lacy|giveon|khalid|alicia keys|usher|chris brown/i,
      /r&b|rnb|soul|neo-soul/i,
    ],
  },
  {
    genre: 'Latina / Bachata / Corridos',
    patterns: [
      /peso pluma|natanael cano|junior h|fuerza regida|grupo frontera|carin leon|romeo santos|aventura|prince royce|marc anthony|juan luis guerra|luis miguel|man[aá]|shakira/i,
      /bachata|salsa|cumbia|corrido|mariachi|flamenco/i,
    ],
  },
];

export function inferTrackGenre(track: Partial<Track> & { genre?: string }): string {
  const explicit = (track.genre ?? '').trim();
  if (explicit && explicit.toLowerCase() !== 'unknown' && explicit.toLowerCase() !== 'music') {
    return explicit;
  }
  const artistNames = Array.isArray(track.artists)
    ? track.artists.map((a) => a.name).join(' ')
    : '';
  const haystack = `${artistNames} ${track.title ?? ''} ${track.album?.name ?? ''}`;
  for (const rule of GENRE_KEYWORDS) {
    if (rule.patterns.some((re) => re.test(haystack))) {
      return rule.genre;
    }
  }
  return 'Pop / Urbano';
}

export function isWrappedSeason(now: Date = new Date()): boolean {
  return now.getMonth() === 11; // December (0-indexed: 11)
}

export function loadLocalWrappedEvents(): WrappedListenEvent[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(WRAPPED_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as WrappedListenEvent[]) : [];
  } catch {
    return [];
  }
}

export function appendLocalWrappedEvent(event: WrappedListenEvent): WrappedListenEvent[] {
  const existing = loadLocalWrappedEvents();
  const next = [event, ...existing].slice(0, MAX_LOCAL_EVENTS);
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(WRAPPED_STORAGE_KEY, JSON.stringify(next));
    }
  } catch {
    // Ignore storage quota errors
  }
  return next;
}

export function buildWrappedListenEvent(input: {
  track: Track;
  playedSec: number;
  deviceType: DevicePlatform;
  sourceContext?: string;
  isRepeatLoop?: boolean;
}): WrappedListenEvent {
  const now = new Date();
  const durationSec = Math.max(1, Math.round(input.track.durationSec || 180));
  const playedSec = Math.max(1, Math.round(input.playedSec));
  const completionRatio = Math.min(1.5, Math.max(0, playedSec / durationSec));
  const artistName =
    input.track.artists?.map((a) => a.name).filter(Boolean).join(', ') || 'Artista';
  return {
    id:
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `ev_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    trackId: input.track.id,
    title: input.track.title,
    artist: artistName,
    artistId: input.track.artists?.[0]?.id,
    album: input.track.album?.name,
    thumbnailUrl: input.track.thumbnailUrl,
    genre: inferTrackGenre(input.track as Track & { genre?: string }),
    durationSec,
    playedSec,
    completionRatio,
    hourOfDay: now.getHours(),
    dayOfWeek: now.getDay(),
    deviceType: input.deviceType,
    sourceContext: input.sourceContext ?? 'library',
    isRepeatLoop: Boolean(input.isRepeatLoop),
    playedAt: now.toISOString(),
  };
}

export function mergeWrappedEvents(
  localEvents: WrappedListenEvent[],
  remoteEvents: WrappedListenEvent[]
): WrappedListenEvent[] {
  const seen = new Set<string>();
  const merged: WrappedListenEvent[] = [];
  for (const ev of [...remoteEvents, ...localEvents]) {
    const minuteBucket = ev.playedAt ? ev.playedAt.slice(0, 16) : '';
    const dedupKey = `${ev.trackId}::${minuteBucket}`;
    if (seen.has(ev.id) || seen.has(dedupKey)) continue;
    seen.add(ev.id);
    seen.add(dedupKey);
    merged.push(ev);
  }
  return merged.sort((a, b) => (a.playedAt < b.playedAt ? 1 : -1));
}

function getListeningPersona(peakHour: number, totalPlays: number): {
  title: string;
  subtitle: string;
} {
  if (peakHour >= 23 || peakHour < 5) {
    return {
      title: 'Búho Nocturno',
      subtitle: 'Tus mejores sesiones llegan cuando el resto del mundo duerme.',
    };
  }
  if (peakHour >= 5 && peakHour < 11) {
    return {
      title: 'Energía de Mañana',
      subtitle: 'Arrancas el día con auriculares desde primera hora.',
    };
  }
  if (peakHour >= 11 && peakHour < 17) {
    return {
      title: 'Ritmo de Mediodía',
      subtitle: 'La música te acompaña en el pico productivo del día.',
    };
  }
  if (totalPlays >= 250) {
    return {
      title: 'Sesión Non-Stop',
      subtitle: 'Tardes y noches enteras sin soltar el play.',
    };
  }
  return {
    title: 'Vibra de Atardecer',
    subtitle: 'Tu momento favorito para escuchar música es al caer la tarde.',
  };
}

function computeLongestStreakDays(events: WrappedListenEvent[]): number {
  const dayKeys = new Set<string>();
  for (const ev of events) {
    if (!ev.playedAt) continue;
    dayKeys.add(ev.playedAt.slice(0, 10));
  }
  const sorted = Array.from(dayKeys).sort();
  if (sorted.length === 0) return 0;
  let longest = 1;
  let current = 1;
  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(`${sorted[i - 1]}T00:00:00Z`).getTime();
    const curr = new Date(`${sorted[i]}T00:00:00Z`).getTime();
    const diffDays = Math.round((curr - prev) / 86_400_000);
    if (diffDays === 1) {
      current += 1;
      if (current > longest) longest = current;
    } else if (diffDays > 1) {
      current = 1;
    }
  }
  return longest;
}

export function computeWrappedSummary(
  allEvents: WrappedListenEvent[],
  year: number = new Date().getFullYear()
): WrappedSummary {
  const yearEvents = allEvents.filter((ev) => {
    const d = new Date(ev.playedAt);
    return !Number.isNaN(d.getTime()) && d.getFullYear() === year;
  });

  let totalSec = 0;
  const trackMap = new Map<string, WrappedRankedItem>();
  const artistMap = new Map<string, WrappedRankedItem>();
  const genreMap = new Map<string, { plays: number; sec: number }>();
  const loopMap = new Map<string, WrappedRankedItem>();
  const hourBuckets = new Array<number>(24).fill(0);
  const monthBuckets = new Array<number>(12).fill(0);

  for (const ev of yearEvents) {
    const sec = Math.max(0, ev.playedSec || 0);
    totalSec += sec;

    const existingTrack = trackMap.get(ev.trackId);
    if (existingTrack) {
      existingTrack.plays += 1;
      existingTrack.minutes += sec / 60;
      if (!existingTrack.thumbnailUrl && ev.thumbnailUrl) {
        existingTrack.thumbnailUrl = ev.thumbnailUrl;
      }
    } else {
      trackMap.set(ev.trackId, {
        key: ev.trackId,
        title: ev.title,
        subtitle: ev.artist,
        thumbnailUrl: ev.thumbnailUrl,
        plays: 1,
        minutes: sec / 60,
      });
    }

    const artistKey = ev.artist.trim().toLowerCase() || 'desconocido';
    const existingArtist = artistMap.get(artistKey);
    if (existingArtist) {
      existingArtist.plays += 1;
      existingArtist.minutes += sec / 60;
      if (!existingArtist.thumbnailUrl && ev.thumbnailUrl) {
        existingArtist.thumbnailUrl = ev.thumbnailUrl;
      }
    } else {
      artistMap.set(artistKey, {
        key: artistKey,
        title: ev.artist || 'Artista',
        thumbnailUrl: ev.thumbnailUrl,
        plays: 1,
        minutes: sec / 60,
      });
    }

    const genre = ev.genre || 'Pop / Urbano';
    const gEntry = genreMap.get(genre) ?? { plays: 0, sec: 0 };
    gEntry.plays += 1;
    gEntry.sec += sec;
    genreMap.set(genre, gEntry);

    if (ev.isRepeatLoop) {
      const existingLoop = loopMap.get(ev.trackId);
      if (existingLoop) {
        existingLoop.plays += 1;
        existingLoop.minutes += sec / 60;
      } else {
        loopMap.set(ev.trackId, {
          key: ev.trackId,
          title: ev.title,
          subtitle: ev.artist,
          thumbnailUrl: ev.thumbnailUrl,
          plays: 1,
          minutes: sec / 60,
        });
      }
    }

    const d = new Date(ev.playedAt);
    const hr = typeof ev.hourOfDay === 'number' ? ev.hourOfDay : d.getHours();
    if (hr >= 0 && hr < 24) hourBuckets[hr] = (hourBuckets[hr] ?? 0) + sec;
    const m = d.getMonth();
    if (m >= 0 && m < 12) monthBuckets[m] = (monthBuckets[m] ?? 0) + sec;
  }

  const topTracks = Array.from(trackMap.values())
    .sort((a, b) => b.plays - a.plays || b.minutes - a.minutes)
    .slice(0, 5)
    .map((item) => ({ ...item, minutes: Math.max(1, Math.round(item.minutes)) }));

  const topArtists = Array.from(artistMap.values())
    .sort((a, b) => b.minutes - a.minutes || b.plays - a.plays)
    .slice(0, 5)
    .map((item) => ({ ...item, minutes: Math.max(1, Math.round(item.minutes)) }));

  const totalPlays = yearEvents.length;
  const topGenres: WrappedGenreItem[] = Array.from(genreMap.entries())
    .map(([genre, v]) => ({
      genre,
      plays: v.plays,
      minutes: Math.max(1, Math.round(v.sec / 60)),
      percent: totalPlays > 0 ? Math.max(1, Math.round((v.plays / totalPlays) * 100)) : 0,
    }))
    .sort((a, b) => b.plays - a.plays || b.minutes - a.minutes)
    .slice(0, 5);

  let peakHour = 21;
  let peakSec = -1;
  for (let h = 0; h < 24; h++) {
    if ((hourBuckets[h] ?? 0) > peakSec) {
      peakSec = hourBuckets[h] ?? 0;
      peakHour = h;
    }
  }

  let topMonthIdx = new Date().getMonth();
  let topMonthSec = -1;
  for (let m = 0; m < 12; m++) {
    if ((monthBuckets[m] ?? 0) > topMonthSec) {
      topMonthSec = monthBuckets[m] ?? 0;
      topMonthIdx = m;
    }
  }

  const mostLoopedTrack =
    Array.from(loopMap.values()).sort((a, b) => b.plays - a.plays)[0] ??
    topTracks[0] ??
    null;

  const totalMinutes = Math.round(totalSec / 60);
  return {
    year,
    totalMinutes,
    totalHours: Math.round((totalMinutes / 60) * 10) / 10,
    totalPlays,
    uniqueTracks: trackMap.size,
    uniqueArtists: artistMap.size,
    uniqueGenres: genreMap.size,
    topTracks,
    topArtists,
    topGenres,
    peakHour,
    listeningPersona: getListeningPersona(peakHour, totalPlays),
    longestStreakDays: computeLongestStreakDays(yearEvents),
    topMonth: {
      name: MONTHS_ES[topMonthIdx] ?? 'Diciembre',
      minutes: Math.max(0, Math.round(topMonthSec / 60)),
    },
    mostLoopedTrack,
  };
}

export type TopStatsWindow = '7d' | '30d';

export interface PeriodTopStats {
  window: TopStatsWindow;
  totalMinutes: number;
  totalPlays: number;
  uniqueTracks: number;
  uniqueArtists: number;
  topTracks: WrappedRankedItem[];
  topArtists: WrappedRankedItem[];
  topGenres: WrappedGenreItem[];
}

export function computePeriodTopStats(
  allEvents: WrappedListenEvent[],
  window: TopStatsWindow,
  nowMs: number = Date.now()
): PeriodTopStats {
  const days = window === '7d' ? 7 : 30;
  const cutoffMs = nowMs - days * 86_400_000;
  const filtered = allEvents.filter((ev) => {
    const ts = new Date(ev.playedAt).getTime();
    return Number.isFinite(ts) && ts >= cutoffMs && ts <= nowMs + 60_000;
  });

  let totalSec = 0;
  const trackMap = new Map<string, WrappedRankedItem>();
  const artistMap = new Map<string, WrappedRankedItem>();
  const genreMap = new Map<string, { plays: number; sec: number }>();

  for (const ev of filtered) {
    const sec = Math.max(0, ev.playedSec || 0);
    totalSec += sec;

    const existingTrack = trackMap.get(ev.trackId);
    if (existingTrack) {
      existingTrack.plays += 1;
      existingTrack.minutes += sec / 60;
      if (!existingTrack.thumbnailUrl && ev.thumbnailUrl) {
        existingTrack.thumbnailUrl = ev.thumbnailUrl;
      }
    } else {
      trackMap.set(ev.trackId, {
        key: ev.trackId,
        title: ev.title,
        subtitle: ev.artist,
        thumbnailUrl: ev.thumbnailUrl,
        plays: 1,
        minutes: sec / 60,
      });
    }

    const artistKey = ev.artist.trim().toLowerCase() || 'desconocido';
    const existingArtist = artistMap.get(artistKey);
    if (existingArtist) {
      existingArtist.plays += 1;
      existingArtist.minutes += sec / 60;
      if (!existingArtist.thumbnailUrl && ev.thumbnailUrl) {
        existingArtist.thumbnailUrl = ev.thumbnailUrl;
      }
    } else {
      artistMap.set(artistKey, {
        key: artistKey,
        title: ev.artist || 'Artista',
        thumbnailUrl: ev.thumbnailUrl,
        plays: 1,
        minutes: sec / 60,
      });
    }

    const genre = ev.genre || 'Pop / Urbano';
    const gEntry = genreMap.get(genre) ?? { plays: 0, sec: 0 };
    gEntry.plays += 1;
    gEntry.sec += sec;
    genreMap.set(genre, gEntry);
  }

  const totalPlays = filtered.length;
  const topTracks = Array.from(trackMap.values())
    .sort((a, b) => b.plays - a.plays || b.minutes - a.minutes)
    .slice(0, 10)
    .map((item) => ({ ...item, minutes: Math.max(1, Math.round(item.minutes)) }));

  const topArtists = Array.from(artistMap.values())
    .sort((a, b) => b.minutes - a.minutes || b.plays - a.plays)
    .slice(0, 8)
    .map((item) => ({ ...item, minutes: Math.max(1, Math.round(item.minutes)) }));

  const topGenres: WrappedGenreItem[] = Array.from(genreMap.entries())
    .map(([genre, v]) => ({
      genre,
      plays: v.plays,
      minutes: Math.max(1, Math.round(v.sec / 60)),
      percent: totalPlays > 0 ? Math.max(1, Math.round((v.plays / totalPlays) * 100)) : 0,
    }))
    .sort((a, b) => b.plays - a.plays || b.minutes - a.minutes)
    .slice(0, 5);

  return {
    window,
    totalMinutes: Math.round(totalSec / 60),
    totalPlays,
    uniqueTracks: trackMap.size,
    uniqueArtists: artistMap.size,
    topTracks,
    topArtists,
    topGenres,
  };
}
