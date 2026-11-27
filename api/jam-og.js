import { ImageResponse } from '@vercel/og';
import { getJamBannerTheme, upgradeTo500Artwork } from './jam-theme.js';

export const config = {
  runtime: 'edge',
};

const SUPABASE_URL = 'https://zlaxnxkfwngmwqnqnqtu.supabase.co';
const SUPABASE_KEY = 'sb_publishable_FksjG7J-ZnFPpsT07uLg3g_kzCzgBdJ';
const MINIMAL_DESCRIPTION = 'Tu música sin límites en Windows, Android y Web.';
const PMUSIC_MARK_PATH =
  'M100.6 0.2 C121.0 1.4 139.0 12.1 149.4 29.5 C163.3 52.8 159.4 81.9 140.0 101.2 C127.6 113.5 110.9 120.2 93.4 120.0 L59.0 119.6 L59.0 165.4 C59.0 176.9 49.7 186.2 38.2 186.2 L32.2 186.2 C20.7 186.2 11.4 176.9 11.4 165.4 L11.4 58.6 C11.4 25.1 39.2 -1.9 72.7 0.0 Z M91.4 33.4 C77.1 33.4 65.5 45.0 65.5 59.3 C65.5 73.6 77.1 85.2 91.4 85.2 C105.7 85.2 117.3 73.6 117.3 59.3 C117.3 45.0 105.7 33.4 91.4 33.4 Z';

export { getJamBannerTheme };

function el(type, props, ...children) {
  const flatChildren = children.flat().filter((c) => c !== null && c !== undefined && c !== false);
  return {
    type,
    props: {
      ...(props || {}),
      children:
        flatChildren.length === 0
          ? undefined
          : flatChildren.length === 1
            ? flatChildren[0]
            : flatChildren,
    },
  };
}

async function fetchLiveJamRow(code) {
  if (!code) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 2000);
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/jam_sessions?code=eq.${encodeURIComponent(code)}&select=code,host_name,current_track,queue,is_playing,active&limit=1`,
      {
        signal: ctrl.signal,
        headers: {
          apikey: SUPABASE_KEY,
          Accept: 'application/json',
        },
      }
    );
    if (!res.ok) return null;
    const rows = await res.json();
    return Array.isArray(rows) && rows[0] ? rows[0] : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchCoverAsDataUrl(coverUrl, timeoutMs = 1200) {
  const clean = String(coverUrl || '').trim();
  if (!clean || !clean.startsWith('https://')) return '';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(clean, { signal: ctrl.signal });
    if (!res.ok) return '';
    const mimeRaw = (res.headers.get('content-type') || 'image/jpeg').split(';')[0].trim().toLowerCase();
    const mime = mimeRaw === 'image/png' || mimeRaw === 'image/webp' || mimeRaw === 'image/jpeg' ? mimeRaw : 'image/jpeg';
    const buf = await res.arrayBuffer();
    if (!buf || buf.byteLength < 256 || buf.byteLength > 2_000_000) return '';
    const bytes = new Uint8Array(buf);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 8192) {
      bin += String.fromCharCode(...bytes.subarray(i, i + 8192));
    }
    return `data:${mime};base64,${btoa(bin)}`;
  } catch {
    return '';
  } finally {
    clearTimeout(timer);
  }
}

export default async function handler(req) {
  const url = new URL(req.url);
  const rawCode = url.searchParams.get('code') || 'PMUSIC';
  const cleanCode = rawCode.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 16) || 'PMUSIC';
  const theme = getJamBannerTheme(cleanCode);
  const session = await fetchLiveJamRow(cleanCode);

  const hostName = String(session?.host_name || '').trim();
  const cur = session?.current_track && typeof session.current_track === 'object' ? session.current_track : null;
  const trackTitle = String(cur?.title || '').trim();
  const trackArtist = Array.isArray(cur?.artists)
    ? cur.artists.map((a) => a?.name).filter(Boolean).join(', ')
    : '';
  const rawCover = cur?.thumbnailHighUrl || cur?.thumbnailUrl || '';
  const coverUrl = upgradeTo500Artwork(rawCover);
  const coverDataUrl = coverUrl ? await fetchCoverAsDataUrl(coverUrl) : '';
  const queueArr = Array.isArray(session?.queue) ? session.queue : [];
  const upNextCount = Math.max(0, queueArr.length - (trackTitle ? 1 : 0));

  const headline = hostName ? `Jam de ${hostName}` : `Sesión Jam · ${cleanCode}`;

  const logoSvg = el(
    'svg',
    {
      width: '28',
      height: '28',
      viewBox: '-10 -8 180 202',
      fill: 'none',
    },
    el('path', {
      fillRule: 'evenodd',
      clipRule: 'evenodd',
      d: PMUSIC_MARK_PATH,
      fill: '#FFFFFF',
    })
  );

  const rightCard = coverDataUrl
    ? el(
        'div',
        {
          style: {
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            width: '320px',
            height: '320px',
            borderRadius: '34px',
            border: `1.5px solid ${theme.accentSoft}`,
            backgroundColor: 'rgba(255, 255, 255, 0.04)',
            padding: '18px',
            boxShadow: `0 24px 70px ${theme.glowA}`,
          },
        },
        el('img', {
          src: coverDataUrl,
          width: 280,
          height: 280,
          style: {
            width: '280px',
            height: '280px',
            borderRadius: '22px',
            objectFit: 'cover',
          },
        })
      )
    : el(
        'div',
        {
          style: {
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            width: '320px',
            height: '320px',
            borderRadius: '34px',
            border: `1.5px solid ${theme.accentSoft}`,
            backgroundColor: 'rgba(255, 255, 255, 0.04)',
            gap: '20px',
            boxShadow: `0 24px 70px ${theme.glowA}`,
          },
        },
        el(
          'div',
          {
            style: {
              display: 'flex',
              alignItems: 'flex-end',
              justifyContent: 'center',
              gap: '12px',
              height: '92px',
            },
          },
          el('div', { style: { width: '16px', height: '48px', borderRadius: '99px', backgroundColor: '#FFFFFF', opacity: 0.78 } }),
          el('div', { style: { width: '16px', height: '86px', borderRadius: '99px', backgroundColor: theme.accent } }),
          el('div', { style: { width: '16px', height: '64px', borderRadius: '99px', backgroundColor: '#FFFFFF', opacity: 0.94 } }),
          el('div', { style: { width: '16px', height: '38px', borderRadius: '99px', backgroundColor: theme.accent, opacity: 0.85 } })
        ),
        el(
          'div',
          {
            style: {
              display: 'flex',
              fontSize: '30px',
              fontWeight: 800,
              letterSpacing: '0.18em',
              color: '#FFFFFF',
            },
          },
          cleanCode
        )
      );

  const tree = el(
    'div',
    {
      style: {
        width: '1200px',
        height: '630px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        backgroundColor: '#06060A',
        color: '#F5F5F7',
        padding: '54px 66px',
        position: 'relative',
        overflow: 'hidden',
        fontFamily: 'sans-serif',
      },
    },
    el('div', {
      style: {
        position: 'absolute',
        width: '540px',
        height: '540px',
        borderRadius: '999px',
        backgroundImage: `radial-gradient(circle, ${theme.glowA} 0%, transparent 70%)`,
        ...theme.orbA,
      },
    }),
    el('div', {
      style: {
        position: 'absolute',
        width: '520px',
        height: '520px',
        borderRadius: '999px',
        backgroundImage: `radial-gradient(circle, ${theme.glowB} 0%, transparent 72%)`,
        ...theme.orbB,
      },
    }),
    el(
      'div',
      {
        style: {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          width: '100%',
          zIndex: 2,
        },
      },
      el(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: '14px',
          },
        },
        el(
          'div',
          {
            style: {
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '48px',
              height: '48px',
              borderRadius: '14px',
              backgroundColor: 'rgba(255, 255, 255, 0.08)',
              border: '1px solid rgba(255, 255, 255, 0.14)',
            },
          },
          logoSvg
        ),
        el(
          'div',
          {
            style: {
              display: 'flex',
              fontSize: '30px',
              fontWeight: 800,
              letterSpacing: '-0.02em',
              color: '#FFFFFF',
            },
          },
          'pMusic'
        )
      ),
      el(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            borderRadius: '999px',
            padding: '10px 22px',
            backgroundColor: theme.accentSoft,
            border: `1px solid ${theme.accent}`,
            fontSize: '20px',
            fontWeight: 800,
            letterSpacing: '0.12em',
            color: '#FFFFFF',
          },
        },
        `JAM · ${cleanCode}`
      )
    ),
    el(
      'div',
      {
        style: {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '48px',
          width: '100%',
          zIndex: 2,
        },
      },
      el(
        'div',
        {
          style: {
            display: 'flex',
            flexDirection: 'column',
            gap: '18px',
            maxWidth: '680px',
          },
        },
        el(
          'div',
          {
            style: {
              display: 'flex',
              fontSize: '58px',
              fontWeight: 900,
              lineHeight: 1.06,
              letterSpacing: '-0.03em',
              color: '#FFFFFF',
            },
          },
          headline
        ),
        el(
          'div',
          {
            style: {
              display: 'flex',
              fontSize: '26px',
              fontWeight: 500,
              lineHeight: 1.35,
              color: 'rgba(245, 245, 247, 0.78)',
            },
          },
          MINIMAL_DESCRIPTION
        ),
        trackTitle
          ? el(
              'div',
              {
                style: {
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  marginTop: '8px',
                  padding: '12px 20px',
                  borderRadius: '999px',
                  backgroundColor: 'rgba(255, 255, 255, 0.08)',
                  border: '1px solid rgba(255, 255, 255, 0.14)',
                  fontSize: '21px',
                  fontWeight: 700,
                  color: theme.accent,
                },
              },
              `${trackTitle}${trackArtist ? ` · ${trackArtist}` : ''}${upNextCount > 0 ? ` · +${upNextCount} en cola` : ''}`
            )
          : el(
              'div',
              {
                style: {
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  marginTop: '8px',
                  fontSize: '20px',
                  fontWeight: 700,
                  color: theme.accent,
                },
              },
              'Escanea o entra al enlace para añadir canciones a la cola en directo'
            )
      ),
      rightCard
    ),
    el(
      'div',
      {
        style: {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          width: '100%',
          fontSize: '18px',
          fontWeight: 600,
          color: 'rgba(255, 255, 255, 0.48)',
          zIndex: 2,
        },
      },
      el('div', { style: { display: 'flex' } }, `pmusic-olive.vercel.app/jam/${cleanCode}`),
      el('div', { style: { display: 'flex', color: theme.accent } }, `Tema ${theme.name}`)
    )
  );

  return new ImageResponse(tree, {
    width: 1200,
    height: 630,
    headers: {
      'Cache-Control': 'public, max-age=30, s-maxage=60, stale-while-revalidate=300',
    },
  });
}
