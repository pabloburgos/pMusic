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
  TopResultMatch,
  Track,
} from '@pmusic/core';
import { normalizeSearchText } from '@pmusic/core';

export const FALLBACK_TRACKS: readonly Track[] = [
  {
    id: 'cc_me_muevo_01',
    title: 'Me Muevo Con Dios',
    artists: [{ id: 'UC_CRUZ_CAFUNE', name: 'Cruz Cafuné' }],
    album: { id: 'MPR_MMCD_2023', name: 'Me Muevo Con Dios' },
    durationSec: 214,
    thumbnailUrl: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=300&q=80',
    thumbnailHighUrl: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&q=80',
    isExplicit: true,
    source: 'ytmusic',
    releaseYear: 2023,
    genres: ['urbano_es', 'trap_canarias', 'hip_hop_es'],
  },
  {
    id: 'cc_cangrinaje_02',
    title: 'Cangrinaje',
    artists: [{ id: 'UC_CRUZ_CAFUNE', name: 'Cruz Cafuné' }],
    album: { id: 'MPR_MMCD_2023', name: 'Me Muevo Con Dios' },
    durationSec: 198,
    thumbnailUrl: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=300&q=80',
    thumbnailHighUrl: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&q=80',
    isExplicit: true,
    source: 'ytmusic',
    releaseYear: 2023,
    genres: ['urbano_es', 'trap_canarias'],
  },
  {
    id: 'cc_dios_1_03',
    title: 'Dios #1',
    artists: [
      { id: 'UC_CRUZ_CAFUNE', name: 'Cruz Cafuné' },
      { id: 'UC_MKY', name: 'Miky Woodz' },
    ],
    album: { id: 'MPR_MMCD_2023', name: 'Me Muevo Con Dios' },
    durationSec: 206,
    thumbnailUrl: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=300&q=80',
    thumbnailHighUrl: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&q=80',
    isExplicit: true,
    source: 'ytmusic',
    releaseYear: 2023,
    genres: ['urbano_es', 'trap_canarias'],
  },
  {
    id: 'lp_cayetano_04',
    title: 'Cayetano',
    artists: [
      { id: 'UC_LA_PANTERA', name: 'La Pantera' },
      { id: 'UC_QUEVEDO', name: 'Quevedo' },
      { id: 'UC_JUSEPH', name: 'Juseph' },
    ],
    album: { id: 'MPR_CAYETANO_2022', name: 'Cayetano Remix' },
    durationSec: 224,
    thumbnailUrl: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=300&q=80',
    thumbnailHighUrl: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=600&q=80',
    isExplicit: true,
    source: 'ytmusic',
    releaseYear: 2022,
    genres: ['trap_canarias', 'urbano_es', 'reggaeton'],
  },
  {
    id: 'lp_una_bala_05',
    title: 'Una Bala',
    artists: [{ id: 'UC_LA_PANTERA', name: 'La Pantera' }],
    album: { id: 'MPR_UNA_BALA_2024', name: 'Una Bala' },
    durationSec: 176,
    thumbnailUrl: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=300&q=80',
    thumbnailHighUrl: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=600&q=80',
    isExplicit: true,
    source: 'ytmusic',
    releaseYear: 2024,
    genres: ['trap_canarias', 'urbano_es', 'drill_es'],
  },
  {
    id: 'bb_monaco_06',
    title: 'MONACO',
    artists: [{ id: 'UC_BAD_BUNNY', name: 'Bad Bunny' }],
    album: { id: 'MPR_NSLQVAPM_2023', name: 'nadie sabe lo que va a pasar mañana' },
    durationSec: 267,
    thumbnailUrl: 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=300&q=80',
    thumbnailHighUrl: 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=600&q=80',
    isExplicit: true,
    source: 'ytmusic',
    releaseYear: 2023,
    genres: ['trap_latino', 'reggaeton', 'urbano'],
  },
  {
    id: 'bb_perro_negro_07',
    title: 'PERRO NEGRO',
    artists: [
      { id: 'UC_BAD_BUNNY', name: 'Bad Bunny' },
      { id: 'UC_FEID', name: 'Feid' },
    ],
    album: { id: 'MPR_NSLQVAPM_2023', name: 'nadie sabe lo que va a pasar mañana' },
    durationSec: 162,
    thumbnailUrl: 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=300&q=80',
    thumbnailHighUrl: 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=600&q=80',
    isExplicit: true,
    source: 'ytmusic',
    releaseYear: 2023,
    genres: ['reggaeton', 'urbano', 'trap_latino'],
  },
  {
    id: 'qv_columbia_08',
    title: 'Columbia',
    artists: [{ id: 'UC_QUEVEDO', name: 'Quevedo' }],
    album: { id: 'MPR_DONDE_QUIERO_2023', name: 'Donde Quiero Estar' },
    durationSec: 186,
    thumbnailUrl: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=300&q=80',
    thumbnailHighUrl: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=600&q=80',
    isExplicit: false,
    source: 'ytmusic',
    releaseYear: 2023,
    genres: ['urbano_es', 'trap_canarias', 'reggaeton'],
  },
  {
    id: 'sk_supernova_09',
    title: 'SUPERNOVA',
    artists: [{ id: 'UC_SAIKO', name: 'Saiko' }],
    album: { id: 'MPR_SAKURA_2024', name: 'SAKURA' },
    durationSec: 191,
    thumbnailUrl: 'https://images.unsplash.com/photo-1459749411175-04bf5292ceea?w=300&q=80',
    thumbnailHighUrl: 'https://images.unsplash.com/photo-1459749411175-04bf5292ceea?w=600&q=80',
    isExplicit: false,
    source: 'ytmusic',
    releaseYear: 2024,
    genres: ['urbano_es', 'reggaeton', 'pop_urbano_es'],
  },
  {
    id: 'mr_pelele_10',
    title: 'Pelele',
    artists: [{ id: 'UC_MORAD', name: 'Morad' }],
    album: { id: 'MPR_MDLR_2022', name: 'Reinsertado' },
    durationSec: 178,
    thumbnailUrl: 'https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?w=300&q=80',
    thumbnailHighUrl: 'https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?w=600&q=80',
    isExplicit: true,
    source: 'ytmusic',
    releaseYear: 2022,
    genres: ['drill_es', 'urbano_es', 'mdlr'],
  },
  {
    id: 'df_consentia_11',
    title: 'Consentía',
    artists: [{ id: 'UC_DELLAFUENTE', name: 'Dellafuente' }],
    album: { id: 'MPR_TORII_2024', name: 'Torii Yama' },
    durationSec: 195,
    thumbnailUrl: 'https://images.unsplash.com/photo-1487180144351-b8472da7d491?w=300&q=80',
    thumbnailHighUrl: 'https://images.unsplash.com/photo-1487180144351-b8472da7d491?w=600&q=80',
    isExplicit: false,
    source: 'ytmusic',
    releaseYear: 2024,
    genres: ['flamenco_urbano', 'urbano_es', 'folk_urbano'],
  },
  {
    id: 'rb_a_mi_12',
    title: 'A Mí',
    artists: [{ id: 'UC_RELS_B', name: 'Rels B' }],
    album: { id: 'MPR_AFROLOVA_2023', name: 'afroLOVA 23' },
    durationSec: 210,
    thumbnailUrl: 'https://images.unsplash.com/photo-1518609878373-06d740f60d8b?w=300&q=80',
    thumbnailHighUrl: 'https://images.unsplash.com/photo-1518609878373-06d740f60d8b?w=600&q=80',
    isExplicit: false,
    source: 'ytmusic',
    releaseYear: 2023,
    genres: ['rnb_es', 'urbano_es', 'hip_hop_es'],
  },
] as const;

export const FALLBACK_ARTISTS: readonly ArtistSummary[] = [
  {
    id: 'UC_CRUZ_CAFUNE',
    name: 'Cruz Cafuné',
    thumbnailUrl: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=300&q=80',
    subscribersText: '1,2 M de suscriptores',
  },
  {
    id: 'UC_LA_PANTERA',
    name: 'La Pantera',
    thumbnailUrl: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=300&q=80',
    subscribersText: '820 mil suscriptores',
  },
  {
    id: 'UC_BAD_BUNNY',
    name: 'Bad Bunny',
    thumbnailUrl: 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=300&q=80',
    subscribersText: '48,5 M de suscriptores',
  },
  {
    id: 'UC_QUEVEDO',
    name: 'Quevedo',
    thumbnailUrl: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=300&q=80',
    subscribersText: '4,9 M de suscriptores',
  },
  {
    id: 'UC_SAIKO',
    name: 'Saiko',
    thumbnailUrl: 'https://images.unsplash.com/photo-1459749411175-04bf5292ceea?w=300&q=80',
    subscribersText: '2,1 M de suscriptores',
  },
  {
    id: 'UC_MORAD',
    name: 'Morad',
    thumbnailUrl: 'https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?w=300&q=80',
    subscribersText: '3,8 M de suscriptores',
  },
  {
    id: 'UC_DELLAFUENTE',
    name: 'Dellafuente',
    thumbnailUrl: 'https://images.unsplash.com/photo-1487180144351-b8472da7d491?w=300&q=80',
    subscribersText: '1,1 M de suscriptores',
  },
  {
    id: 'UC_RELS_B',
    name: 'Rels B',
    thumbnailUrl: 'https://images.unsplash.com/photo-1518609878373-06d740f60d8b?w=300&q=80',
    subscribersText: '5,4 M de suscriptores',
  },
] as const;

export const FALLBACK_ALBUMS: readonly AlbumSummary[] = [
  {
    id: 'MPR_MMCD_2023',
    title: 'Me Muevo Con Dios',
    artists: [{ id: 'UC_CRUZ_CAFUNE', name: 'Cruz Cafuné' }],
    year: 2023,
    thumbnailUrl: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=300&q=80',
  },
  {
    id: 'MPR_UNA_BALA_2024',
    title: 'Una Bala',
    artists: [{ id: 'UC_LA_PANTERA', name: 'La Pantera' }],
    year: 2024,
    thumbnailUrl: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=300&q=80',
  },
  {
    id: 'MPR_NSLQVAPM_2023',
    title: 'nadie sabe lo que va a pasar mañana',
    artists: [{ id: 'UC_BAD_BUNNY', name: 'Bad Bunny' }],
    year: 2023,
    thumbnailUrl: 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=300&q=80',
  },
  {
    id: 'MPR_DONDE_QUIERO_2023',
    title: 'Donde Quiero Estar',
    artists: [{ id: 'UC_QUEVEDO', name: 'Quevedo' }],
    year: 2023,
    thumbnailUrl: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=300&q=80',
  },
  {
    id: 'MPR_SAKURA_2024',
    title: 'SAKURA',
    artists: [{ id: 'UC_SAIKO', name: 'Saiko' }],
    year: 2024,
    thumbnailUrl: 'https://images.unsplash.com/photo-1459749411175-04bf5292ceea?w=300&q=80',
  },
] as const;

export const FALLBACK_PLAYLISTS: readonly PlaylistSummary[] = [
  {
    id: 'PL_URBANO_ES_2026',
    title: 'Urbano España & Canarias',
    author: 'pMusic Editorial',
    trackCount: 12,
    thumbnailUrl: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=300&q=80',
    source: 'ytmusic',
  },
  {
    id: 'PL_SESION_DJ_CLUB',
    title: 'Sesión DJ Club Urbano',
    author: 'pMusic AutoMix',
    trackCount: 10,
    thumbnailUrl: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=300&q=80',
    source: 'ytmusic',
  },
] as const;

export function searchFallbackCatalog(
  query: string,
  filter: SearchFilter = 'all'
): SearchResultBundle {
  const norm = normalizeSearchText(query);
  if (!norm) {
    return {
      query,
      topResult: { kind: 'artist', item: FALLBACK_ARTISTS[0]! },
      songs: [...FALLBACK_TRACKS],
      videos: FALLBACK_TRACKS.slice(0, 4),
      artists: [...FALLBACK_ARTISTS],
      albums: [...FALLBACK_ALBUMS],
      playlists: [...FALLBACK_PLAYLISTS],
    };
  }

  const matchedSongs = FALLBACK_TRACKS.filter((t) => {
    const hay = normalizeSearchText(
      `${t.title} ${t.artists.map((a) => a.name).join(' ')} ${t.album?.name ?? ''} ${(t.genres ?? []).join(' ')}`
    );
    return hay.includes(norm) || norm.split(' ').some((tok) => tok.length >= 2 && hay.includes(tok));
  });

  const matchedArtists = FALLBACK_ARTISTS.filter((a) => {
    const hay = normalizeSearchText(a.name);
    return hay.includes(norm) || norm.includes(hay);
  });

  const matchedAlbums = FALLBACK_ALBUMS.filter((al) => {
    const hay = normalizeSearchText(`${al.title} ${al.artists.map((a) => a.name).join(' ')}`);
    return hay.includes(norm);
  });

  const matchedPlaylists = FALLBACK_PLAYLISTS.filter((pl) => {
    const hay = normalizeSearchText(`${pl.title} ${pl.author ?? ''}`);
    return hay.includes(norm);
  });

  const songs = matchedSongs.length > 0 ? matchedSongs : [...FALLBACK_TRACKS];
  const artists = matchedArtists.length > 0 ? matchedArtists : FALLBACK_ARTISTS.slice(0, 4);
  const albums = matchedAlbums.length > 0 ? matchedAlbums : FALLBACK_ALBUMS.slice(0, 3);
  const playlists = matchedPlaylists.length > 0 ? matchedPlaylists : [...FALLBACK_PLAYLISTS];

  let topResult: TopResultMatch | undefined;
  if (matchedArtists[0]) {
    topResult = { kind: 'artist', item: matchedArtists[0] };
  } else if (songs[0]) {
    topResult = { kind: 'song', item: songs[0] };
  }

  return {
    query,
    topResult,
    songs: filter === 'all' || filter === 'song' ? songs : [],
    videos: filter === 'all' || filter === 'video' ? songs.slice(0, 4) : [],
    artists: filter === 'all' || filter === 'artist' ? artists : [],
    albums: filter === 'all' || filter === 'album' ? albums : [],
    playlists: filter === 'all' || filter === 'playlist' ? playlists : [],
  };
}

export function getFallbackHomeFeed(): HomeFeedResult {
  return {
    moods: ['Urbano ES', 'Trap Canarias', 'Energía', 'Chill', 'Sesión DJ'],
    shelves: [
      {
        title: 'Escuchar de nuevo',
        items: FALLBACK_TRACKS.slice(0, 6),
      },
      {
        title: 'Tendencias en España',
        items: FALLBACK_TRACKS.slice(2, 10),
      },
      {
        title: 'Artistas destacados',
        items: [...FALLBACK_ARTISTS],
      },
      {
        title: 'Álbumes recomendados',
        items: [...FALLBACK_ALBUMS],
      },
    ],
  };
}

export function getFallbackArtistDetail(artistId: string): ArtistDetail {
  const artist =
    FALLBACK_ARTISTS.find((a) => a.id === artistId || normalizeSearchText(a.name) === normalizeSearchText(artistId)) ??
    FALLBACK_ARTISTS[0]!;
  const topSongs = FALLBACK_TRACKS.filter((t) =>
    t.artists.some((a) => a.id === artist.id || normalizeSearchText(a.name) === normalizeSearchText(artist.name))
  );
  return {
    artist,
    bannerUrl: artist.thumbnailUrl,
    description: `${artist.name} — Escena urbana y tendencias en pMusic.`,
    topSongs: topSongs.length > 0 ? topSongs : FALLBACK_TRACKS.slice(0, 5),
    albums: FALLBACK_ALBUMS.filter((al) => al.artists.some((a) => a.name === artist.name)),
    singles: FALLBACK_ALBUMS.slice(0, 2),
    relatedArtists: FALLBACK_ARTISTS.filter((a) => a.id !== artist.id).slice(0, 5),
  };
}

export function getFallbackAlbumDetail(albumId: string): AlbumDetail {
  const album = FALLBACK_ALBUMS.find((a) => a.id === albumId) ?? FALLBACK_ALBUMS[0]!;
  const tracks = FALLBACK_TRACKS.filter((t) => t.album?.id === album.id);
  return {
    album,
    tracks: tracks.length > 0 ? tracks : FALLBACK_TRACKS.slice(0, 6),
  };
}

export function getFallbackPlaylistDetail(playlistId: string): PlaylistDetail {
  const cleanId = playlistId.replace(/^VL/, '');
  const playlist =
    FALLBACK_PLAYLISTS.find((p) => p.id === cleanId) ?? {
      id: cleanId,
      title: 'Playlist Urbana pMusic',
      author: 'pMusic',
      trackCount: FALLBACK_TRACKS.length,
      thumbnailUrl: FALLBACK_TRACKS[0]!.thumbnailUrl,
      source: 'ytmusic',
    };
  return {
    playlist,
    tracks: [...FALLBACK_TRACKS],
  };
}

export function getFallbackRelated(videoId: string): RelatedResult {
  const others = FALLBACK_TRACKS.filter((t) => t.id !== videoId);
  return {
    tracks: others.length > 0 ? others : [...FALLBACK_TRACKS],
    artists: FALLBACK_ARTISTS.slice(0, 4),
    playlists: [...FALLBACK_PLAYLISTS],
  };
}

/**
 * Generates a real playable 16-bit PCM WAV buffer with clear rhythmic beat pulses (120 BPM)
 * and intro/drop/outro envelope so `<audio crossOrigin="anonymous">` and Web Audio API
 * decodeAudioData / AnalyserNode always work deterministically even offline.
 */
export function synthesizeDeterministicWavBuffer(durationSec = 12, bpm = 120): Buffer {
  const sampleRate = 22050;
  const numSamples = Math.max(sampleRate, Math.floor(durationSec * sampleRate));
  const dataBytes = numSamples * 2;
  const buf = Buffer.alloc(44 + dataBytes);

  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // Mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataBytes, 40);

  const beatPeriodSec = 60 / Math.max(60, Math.min(180, bpm));
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const progress = t / durationSec;
    const sectionGain =
      progress < 0.15 ? 0.35 : progress < 0.8 ? 0.85 : 0.3;
    const beatPhase = (t % beatPeriodSec) / beatPeriodSec;
    const kickEnv = beatPhase < 0.18 ? Math.exp(-beatPhase * 18) : 0.15;
    const bassSample = Math.sin(2 * Math.PI * 110 * t) * 0.55;
    const leadSample = Math.sin(2 * Math.PI * 220 * t) * 0.35;
    const sample = Math.max(-1, Math.min(1, (bassSample + leadSample) * kickEnv * sectionGain));
    buf.writeInt16LE(Math.round(sample * 28000), 44 + i * 2);
  }

  return buf;
}
