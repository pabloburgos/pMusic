import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SUPABASE_URL = 'https://zlaxnxkfwngmwqnqnqtu.supabase.co';
const SUPABASE_KEY = 'sb_publishable_FksjG7J-ZnFPpsT07uLg3g_kzCzgBdJ';
const PUBLIC_ORIGIN = 'https://pmusic-olive.vercel.app';
const MINIMAL_DESCRIPTION = 'Tu música sin límites en Windows, Android y Web.';

let cachedHtml = '';
let cachedAtMs = 0;

function escapeHtmlAttr(val) {
  return String(val || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function hashShort(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

export function injectJamMetaTags(baseHtml, meta) {
  const cleanCode = String(meta?.code || 'PMUSIC').trim().toUpperCase() || 'PMUSIC';
  const hostName = String(meta?.hostName || '').trim();
  const trackTitle = String(meta?.trackTitle || '').trim();
  const trackArtist = String(meta?.trackArtist || '').trim();
  const pageUrl = `${PUBLIC_ORIGIN}/jam/${encodeURIComponent(cleanCode)}`;
  const versionHash = hashShort(`${cleanCode}::${hostName}::${trackTitle}::${trackArtist}`);
  const ogImageUrl =
    meta?.ogImageUrl ||
    `${PUBLIC_ORIGIN}/api/jam-og?code=${encodeURIComponent(cleanCode)}&v=${versionHash}`;

  const title = hostName ? `Jam de ${hostName} · pMusic` : `Jam · ${cleanCode} · pMusic`;
  const description = MINIMAL_DESCRIPTION;

  let html = String(baseHtml || '');
  html = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtmlAttr(title)}</title>`);
  html = html.replace(/<meta\s+name=["']description["'][^>]*>\s*/gi, '');
  html = html.replace(/<meta\s+property=["']og:[^"']+["'][^>]*>\s*/gi, '');
  html = html.replace(/<meta\s+name=["']twitter:[^"']+["'][^>]*>\s*/gi, '');

  const injectedTags = [
    `    <meta name="description" content="${escapeHtmlAttr(description)}" />`,
    `    <meta property="og:site_name" content="pMusic" />`,
    `    <meta property="og:type" content="website" />`,
    `    <meta property="og:url" content="${escapeHtmlAttr(pageUrl)}" />`,
    `    <meta property="og:title" content="${escapeHtmlAttr(title)}" />`,
    `    <meta property="og:description" content="${escapeHtmlAttr(description)}" />`,
    `    <meta property="og:image" content="${escapeHtmlAttr(ogImageUrl)}" />`,
    `    <meta property="og:image:type" content="image/png" />`,
    `    <meta property="og:image:width" content="1200" />`,
    `    <meta property="og:image:height" content="630" />`,
    `    <meta name="twitter:card" content="summary_large_image" />`,
    `    <meta name="twitter:title" content="${escapeHtmlAttr(title)}" />`,
    `    <meta name="twitter:description" content="${escapeHtmlAttr(description)}" />`,
    `    <meta name="twitter:image" content="${escapeHtmlAttr(ogImageUrl)}" />`,
  ].join('\n');

  if (/<\/head>/i.test(html)) {
    return html.replace(/<\/head>/i, `${injectedTags}\n  </head>`);
  }
  return `${injectedTags}\n${html}`;
}

async function loadSpaIndexHtml(req) {
  const now = Date.now();
  if (cachedHtml && now - cachedAtMs < 5 * 60_000) {
    return cachedHtml;
  }

  const diskCandidates = [
    resolve(process.cwd(), 'apps/web/dist/index.html'),
    resolve(process.cwd(), 'dist/index.html'),
    resolve(process.cwd(), 'index.html'),
  ];
  for (const cand of diskCandidates) {
    if (existsSync(cand)) {
      cachedHtml = readFileSync(cand, 'utf-8');
      cachedAtMs = now;
      return cachedHtml;
    }
  }

  const host = String(req?.headers?.['x-forwarded-host'] || req?.headers?.host || '').trim();
  const origin = host ? `https://${host}` : PUBLIC_ORIGIN;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 3000);
  try {
    const res = await fetch(`${origin}/index.html`, { signal: ctrl.signal });
    if (res.ok) {
      const text = await res.text();
      if (text && text.includes('<div id="root"')) {
        cachedHtml = text;
        cachedAtMs = now;
        return cachedHtml;
      }
    }
  } catch {
    // fallback minimal shell below
  } finally {
    clearTimeout(timer);
  }

  return `<!doctype html><html lang="es" class="dark"><head><meta charset="UTF-8" /><title>pMusic</title></head><body><div id="root"></div></body></html>`;
}

async function fetchJamSummary(code) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 2000);
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/jam_sessions?code=eq.${encodeURIComponent(code)}&select=code,host_name,current_track&limit=1`,
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

export default async function handler(req, res) {
  const rawCode = String(req?.query?.code || '').trim();
  const cleanCode = rawCode.toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 16) || 'PMUSIC';

  const [baseHtml, row] = await Promise.all([
    loadSpaIndexHtml(req),
    fetchJamSummary(cleanCode),
  ]);

  const cur = row?.current_track && typeof row.current_track === 'object' ? row.current_track : null;
  const html = injectJamMetaTags(baseHtml, {
    code: cleanCode,
    hostName: row?.host_name || '',
    trackTitle: cur?.title || '',
    trackArtist: Array.isArray(cur?.artists)
      ? cur.artists.map((a) => a?.name).filter(Boolean).join(', ')
      : '',
  });

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=120');
  return res.status(200).send(html);
}
