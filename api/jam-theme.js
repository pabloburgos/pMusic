export const JAM_BANNER_THEMES = [
  {
    name: 'Violeta',
    accent: '#C4B5FD',
    accentSoft: 'rgba(167, 139, 250, 0.28)',
    glowA: 'rgba(139, 92, 246, 0.34)',
    glowB: 'rgba(99, 102, 241, 0.24)',
    orbA: { top: '-140px', left: '-90px' },
    orbB: { bottom: '-150px', right: '-80px' },
  },
  {
    name: 'Cian',
    accent: '#67E8F9',
    accentSoft: 'rgba(34, 211, 238, 0.26)',
    glowA: 'rgba(6, 182, 212, 0.32)',
    glowB: 'rgba(59, 130, 246, 0.24)',
    orbA: { top: '-120px', right: '-70px' },
    orbB: { bottom: '-150px', left: '-90px' },
  },
  {
    name: 'Rosa',
    accent: '#F9A8D4',
    accentSoft: 'rgba(244, 114, 182, 0.28)',
    glowA: 'rgba(236, 72, 153, 0.34)',
    glowB: 'rgba(168, 85, 247, 0.24)',
    orbA: { top: '-150px', left: '120px' },
    orbB: { bottom: '-130px', right: '-90px' },
  },
  {
    name: 'Ámbar',
    accent: '#FCD34D',
    accentSoft: 'rgba(251, 191, 36, 0.26)',
    glowA: 'rgba(245, 158, 11, 0.32)',
    glowB: 'rgba(244, 63, 94, 0.22)',
    orbA: { top: '-130px', left: '-110px' },
    orbB: { bottom: '-140px', right: '140px' },
  },
  {
    name: 'Menta',
    accent: '#5EEAD4',
    accentSoft: 'rgba(45, 212, 191, 0.26)',
    glowA: 'rgba(20, 184, 166, 0.32)',
    glowB: 'rgba(14, 165, 233, 0.22)',
    orbA: { top: '-140px', right: '120px' },
    orbB: { bottom: '-120px', left: '-80px' },
  },
  {
    name: 'Cobalto',
    accent: '#93C5FD',
    accentSoft: 'rgba(96, 165, 250, 0.28)',
    glowA: 'rgba(59, 130, 246, 0.34)',
    glowB: 'rgba(139, 92, 246, 0.24)',
    orbA: { top: '-100px', left: '-80px' },
    orbB: { bottom: '-160px', right: '-70px' },
  },
  {
    name: 'Carmesí',
    accent: '#FDA4AF',
    accentSoft: 'rgba(251, 113, 133, 0.28)',
    glowA: 'rgba(225, 29, 72, 0.30)',
    glowB: 'rgba(147, 51, 234, 0.22)',
    orbA: { top: '-140px', right: '-90px' },
    orbB: { bottom: '-140px', left: '130px' },
  },
  {
    name: 'Hielo',
    accent: '#A5B4FC',
    accentSoft: 'rgba(129, 140, 248, 0.28)',
    glowA: 'rgba(99, 102, 241, 0.32)',
    glowB: 'rgba(56, 189, 248, 0.24)',
    orbA: { top: '-150px', left: '160px' },
    orbB: { bottom: '-130px', left: '-100px' },
  },
];

function fnv1aHash(str) {
  let h = 2166136261;
  const input = String(str || '');
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function getJamBannerTheme(code) {
  const cleanCode = String(code || 'PMUSIC').trim().toUpperCase() || 'PMUSIC';
  const idx = fnv1aHash(cleanCode) % JAM_BANNER_THEMES.length;
  return JAM_BANNER_THEMES[idx];
}

export function upgradeTo500Artwork(url) {
  const clean = String(url || '').trim();
  if (!clean) return '';
  if (/dzcdn\.net\/images\//i.test(clean)) {
    return clean.replace(/\d+x\d+(?:-\d+-\d+-\d+-\d+)?\.(jpg|jpeg|png|webp)/i, '500x500-000000-80-0-0.$1');
  }
  if (/googleusercontent\.com|ggpht\.com/i.test(clean)) {
    return clean.replace(/=[a-z0-9-]+$/i, '=w500-h500-l90-rj');
  }
  if (/mzstatic\.com\/image\/thumb/i.test(clean)) {
    return clean.replace(/\d+x\d+[a-z0-9-]*\.(jpg|jpeg|png|webp)/i, '500x500bb.$1');
  }
  return clean;
}
