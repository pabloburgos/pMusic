import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import * as esbuild from 'esbuild';

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(__dirname, '..');
const webDist = resolve(desktopRoot, '../web/dist');
const desktopDist = resolve(desktopRoot, 'dist');
const distElectron = resolve(desktopRoot, 'dist-electron');
const buildDir = resolve(desktopRoot, 'build');

mkdirSync(desktopDist, { recursive: true });
mkdirSync(distElectron, { recursive: true });
mkdirSync(buildDir, { recursive: true });

if (existsSync(webDist)) {
  cpSync(webDist, desktopDist, { recursive: true });
}

// Generate original pMusic brand SVG + valid 256x256 PNG icon (obsidian squircle + 4-bar acoustic play-wave)
const brandSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256">
  <rect x="8" y="8" width="240" height="240" rx="64" fill="#111117" stroke="rgba(255,255,255,0.22)" stroke-width="6" />
  <rect x="61" y="85" width="25" height="86" rx="12.5" fill="#FFFFFF" fill-opacity="0.86" />
  <rect x="101" y="53" width="25" height="150" rx="12.5" fill="#E2CCFF" />
  <rect x="141" y="74" width="25" height="108" rx="12.5" fill="#FFFFFF" fill-opacity="0.96" />
  <rect x="181" y="103" width="25" height="50" rx="12.5" fill="#FFFFFF" fill-opacity="0.76" />
</svg>`;
writeFileSync(resolve(buildDir, 'icon.svg'), brandSvg, 'utf-8');

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makePngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcVal = crc32(Buffer.concat([typeBuf, data]));
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crcVal, 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function sdRoundedBox(px, py, cx, cy, halfW, halfH, radius) {
  const qx = Math.abs(px - cx) - (halfW - radius);
  const qy = Math.abs(py - cy) - (halfH - radius);
  const outDist = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  const inDist = Math.min(Math.max(qx, qy), 0);
  return outDist + inDist - radius;
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function generateBrandPng(width = 256, height = 256) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const bars = [
    { cx: 73.5, halfH: 43, r: 226, g: 226, b: 232 },
    { cx: 113.5, halfH: 75, r: 226, g: 204, b: 255 },
    { cx: 153.5, halfH: 54, r: 248, g: 248, b: 252 },
    { cx: 193.5, halfH: 25, r: 204, g: 204, b: 214 },
  ];

  const rawRows = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + width * 4);
    rawRows[rowStart] = 0;
    for (let x = 0; x < width; x++) {
      const px = rowStart + 1 + x * 4;
      const dOuter = sdRoundedBox(x + 0.5, y + 0.5, 128, 128, 120, 120, 62);
      const outerAlpha = clamp01(0.75 - dOuter);
      if (outerAlpha <= 0) {
        rawRows[px] = 0;
        rawRows[px + 1] = 0;
        rawRows[px + 2] = 0;
        rawRows[px + 3] = 0;
        continue;
      }

      // Base obsidian fill + specular rim
      let r = 17;
      let g = 17;
      let b = 23;
      const rimFactor = clamp01(1 - Math.abs(dOuter + 2.5) / 2.2) * 0.24;
      r = Math.round(r + (255 - r) * rimFactor);
      g = Math.round(g + (255 - g) * rimFactor);
      b = Math.round(b + (255 - b) * rimFactor);

      // Blend 4 acoustic play-wave bars
      for (const bar of bars) {
        const dBar = sdRoundedBox(x + 0.5, y + 0.5, bar.cx, 128, 12.5, bar.halfH, 12.5);
        const a = clamp01(0.75 - dBar);
        if (a > 0) {
          r = Math.round(r * (1 - a) + bar.r * a);
          g = Math.round(g * (1 - a) + bar.g * a);
          b = Math.round(b * (1 - a) + bar.b * a);
        }
      }

      rawRows[px] = r;
      rawRows[px + 1] = g;
      rawRows[px + 2] = b;
      rawRows[px + 3] = Math.round(outerAlpha * 255);
    }
  }

  const compressed = deflateSync(rawRows);
  return Buffer.concat([
    sig,
    makePngChunk('IHDR', ihdr),
    makePngChunk('IDAT', compressed),
    makePngChunk('IEND', Buffer.alloc(0)),
  ]);
}

const canonicalLogoPng = resolve(desktopRoot, '../../assets/pMusic-logo.png');
const canonicalLogoSvg = resolve(desktopRoot, '../../assets/pMusic-icon.svg');
const canonicalWordmarkSvg = resolve(desktopRoot, '../../assets/pMusic-wordmark.svg');
if (existsSync(canonicalLogoSvg)) {
  cpSync(canonicalLogoSvg, resolve(buildDir, 'icon.svg'));
}
if (existsSync(canonicalWordmarkSvg)) {
  cpSync(canonicalWordmarkSvg, resolve(desktopDist, 'wordmark.svg'));
}
if (existsSync(canonicalLogoPng)) {
  cpSync(canonicalLogoPng, resolve(buildDir, 'icon.png'));
  cpSync(canonicalLogoPng, resolve(desktopDist, 'icon.png'));
} else {
  const brandPng = generateBrandPng(256, 256);
  writeFileSync(resolve(buildDir, 'icon.png'), brandPng);
  writeFileSync(resolve(desktopDist, 'icon.png'), brandPng);
}

// Update src/main.ts to serve both static dist/ files AND /api/* over http://127.0.0.1:<port>
const mainEntrySource = `import { createServer, type Server } from 'node:http';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, normalize } from 'node:path';
import { deflateSync } from 'node:zlib';
import { app, BrowserWindow, globalShortcut, ipcMain, Menu, nativeImage, shell } from 'electron';
import { createPMusicApiHandler } from '@pmusic/providers';

const isTransientStreamError = (err: unknown): boolean => {
  const code = (err as { code?: string })?.code ?? '';
  const msg = err instanceof Error ? \`\${err.message}\\n\${err.stack ?? ''}\` : String(err ?? '');
  return (
    code === 'ERR_ASSERTION' ||
    code === 'ECONNRESET' ||
    code === 'EPIPE' ||
    code === 'ERR_STREAM_PREMATURE_CLOSE' ||
    code === 'ABORT_ERR' ||
    msg.includes('undici') ||
    msg.includes('assert(!this.paused)') ||
    msg.includes('aborted')
  );
};
process.on('uncaughtException', (err) => {
  if (isTransientStreamError(err)) {
    console.warn('[pMusic] Ignored transient stream exception:', err?.message ?? err);
    return;
  }
  console.error('[pMusic] Uncaught exception:', err);
});
process.on('unhandledRejection', (reason) => {
  console.warn('[pMusic] Unhandled rejection:', reason);
});

app.commandLine.appendSwitch('js-flags', '--max-old-space-size=160');
app.commandLine.appendSwitch('disk-cache-size', String(24 * 1024 * 1024));
app.commandLine.appendSwitch('gpu-program-cache-size-kb', '12288');
app.commandLine.appendSwitch('disable-features', 'MediaRouter,OptimizationHints');

function getVaultFilePath(): string {
  return join(app.getPath('userData'), 'pmusic-vault.json');
}

function readVaultData(): Record<string, string> {
  try {
    const file = getVaultFilePath();
    if (!existsSync(file)) return {};
    const parsed = JSON.parse(readFileSync(file, 'utf-8')) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function writeVaultData(data: Record<string, string>): void {
  try {
    const file = getVaultFilePath();
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(data), 'utf-8');
  } catch {
    // ignore disk vault write error
  }
}

let mainWindow: BrowserWindow | null = null;
let loopbackServer: Server | null = null;
let loopbackPort = 0;
let oauthServer: Server | null = null;
let oauthPort = 47821;
let pendingAuthCallbackUrl: string | null = null;

function dispatchAuthCallbackUrl(url: string): void {
  if (!url) return;
  const lower = url.toLowerCase();
  if (!lower.startsWith('pmusic://') && !lower.startsWith('http://127.0.0.1:')) return;
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    // Force Windows to bring pMusic to the foreground over the browser (fixes orange taskbar flash)
    try {
      mainWindow.setAlwaysOnTop(true);
      mainWindow.focus();
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.setAlwaysOnTop(false);
        }
      }, 350);
    } catch {
      mainWindow.focus();
    }
    mainWindow.webContents.send('pmusic:auth-callback', url);
    pendingAuthCallbackUrl = null;
  } else {
    pendingAuthCallbackUrl = url;
  }
}

async function startOAuthCallbackServer(): Promise<number> {
  if (oauthServer && oauthPort > 0) return oauthPort;
  const htmlDone = \`<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>pMusic</title>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#050507;color:#fff;font-family:system-ui,-apple-system,sans-serif}
  .box{display:flex;flex-direction:column;align-items:center;gap:14px;animation:fade .5s cubic-bezier(.16,1,.3,1) both}
  .dot{width:44px;height:44px;border-radius:999px;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.06);display:flex;align-items:center;justify-content:center;font-size:18px;color:#fff}
  .txt{font-size:13px;color:rgba(255,255,255,.6)}
  @keyframes fade{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
</style></head><body>
<div class="box"><div class="dot">✓</div><div class="txt">pMusic</div></div>
<script>
  if (location.hash && location.hash.includes('access_token')) {
    fetch('/auth/hash', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: location.href }).catch(()=>{});
  }
  setTimeout(() => { try { window.close(); } catch {} }, 1000);
</script></body></html>\`;

  const tryListen = (port: number) =>
    new Promise<number>((resolvePort, reject) => {
      const srv = createServer((req, res) => {
        const reqUrl = req.url ?? '/';
        if (req.method === 'POST' && reqUrl.startsWith('/auth/hash')) {
          let body = '';
          req.on('data', (chunk) => { body += String(chunk); });
          req.on('end', () => {
            if (body.includes('access_token=')) {
              dispatchAuthCallbackUrl(body.trim());
            }
            res.statusCode = 200;
            res.end('ok');
          });
          return;
        }
        const fullUrl = \`http://127.0.0.1:\${oauthPort}\${reqUrl}\`;
        if (reqUrl.includes('code=') || reqUrl.includes('error=')) {
          dispatchAuthCallbackUrl(fullUrl);
        }
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(htmlDone);
      });
      srv.on('error', reject);
      srv.listen(port, '127.0.0.1', () => {
        const addr = srv.address();
        oauthPort = typeof addr === 'object' && addr ? addr.port : port;
        oauthServer = srv;
        resolvePort(oauthPort);
      });
    });

  try {
    return await tryListen(47821);
  } catch {
    return await tryListen(0);
  }
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const deepLink = argv.find((arg) => typeof arg === 'string' && arg.toLowerCase().startsWith('pmusic://'));
    if (deepLink) {
      dispatchAuthCallbackUrl(deepLink);
    } else if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

app.on('open-url', (event, url) => {
  event.preventDefault();
  dispatchAuthCallbackUrl(url);
});

const MIME_MAP: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.wav': 'audio/wav',
};

async function startLoopbackServer(): Promise<number> {
  if (loopbackServer && loopbackPort > 0) return loopbackPort;
  const apiHandler = createPMusicApiHandler();
  const distRoot = join(__dirname, '../dist');

  return new Promise<number>((resolvePort, reject) => {
    const srv = createServer(async (req, res) => {
      const rawUrl = req.url ?? '/';
      if (rawUrl.startsWith('/api/')) {
        await apiHandler(req, res);
        return;
      }

      const urlObj = new URL(rawUrl, 'http://127.0.0.1');
      let relPath = decodeURIComponent(urlObj.pathname);
      if (relPath === '/' || relPath === '') relPath = '/index.html';
      const safeRel = normalize(relPath).replace(/^(\\.\\.[\\/\\\\])+/, '');
      let filePath = join(distRoot, safeRel);

      if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
        filePath = join(distRoot, 'index.html');
      }

      try {
        const data = readFileSync(filePath);
        const ext = extname(filePath).toLowerCase();
        res.statusCode = 200;
        res.setHeader('Content-Type', MIME_MAP[ext] ?? 'application/octet-stream');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.end(data);
      } catch {
        res.statusCode = 404;
        res.end('Not found');
      }
    });
    srv.on('error', reject);
    const onListening = () => {
      const addr = srv.address();
      loopbackPort = typeof addr === 'object' && addr ? addr.port : 0;
      loopbackServer = srv;
      resolvePort(loopbackPort);
    };
    let attempt = 0;
    const tryBindFixedPort = () => {
      attempt++;
      srv.once('error', () => {
        if (attempt < 8) {
          setTimeout(tryBindFixedPort, 150);
        } else {
          srv.listen(0, '127.0.0.1', onListening);
        }
      });
      srv.listen(47820, '127.0.0.1', onListening);
    };
    tryBindFixedPort();
  });
}

function sendMediaAction(type: string): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('pmusic:media-action', { type });
  }
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const tb = Buffer.from(type, 'ascii');
  let crc = 0xffffffff;
  const combined = Buffer.concat([tb, data]);
  for (let i = 0; i < combined.length; i++) {
    crc ^= combined[i]!;
    for (let k = 0; k < 8; k++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  const cb = Buffer.alloc(4);
  cb.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 0);
  return Buffer.concat([len, tb, data, cb]);
}

function makeThumbarIcon(kind: 'prev' | 'play' | 'pause' | 'next'): Electron.NativeImage {
  const size = 24;
  const raw = Buffer.alloc(size * (1 + size * 4));
  const setPx = (x: number, y: number, a = 245) => {
    if (x < 0 || x >= size || y < 0 || y >= size) return;
    const i = y * (1 + size * 4) + 1 + x * 4;
    raw[i] = 255;
    raw[i + 1] = 255;
    raw[i + 2] = 255;
    raw[i + 3] = a;
  };
  if (kind === 'play') {
    for (let y = 5; y <= 18; y++) {
      const span = Math.round(((6.5 - Math.abs(y - 11.5)) / 6.5) * 10);
      for (let x = 7; x <= 7 + span; x++) setPx(x, y);
    }
  } else if (kind === 'pause') {
    for (let y = 5; y <= 18; y++) {
      for (let x = 6; x <= 9; x++) setPx(x, y);
      for (let x = 14; x <= 17; x++) setPx(x, y);
    }
  } else if (kind === 'next') {
    for (let y = 6; y <= 17; y++) {
      const span = Math.round(((5.5 - Math.abs(y - 11.5)) / 5.5) * 8);
      for (let x = 5; x <= 5 + span; x++) setPx(x, y);
      for (let x = 16; x <= 18; x++) setPx(x, y);
    }
  } else {
    for (let y = 6; y <= 17; y++) {
      const span = Math.round(((5.5 - Math.abs(y - 11.5)) / 5.5) * 8);
      for (let x = 18 - span; x <= 18; x++) setPx(x, y);
      for (let x = 5; x <= 7; x++) setPx(x, y);
    }
  }
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return nativeImage.createFromBuffer(
    Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0))])
  );
}

let cachedThumbarIcons: Record<'prev' | 'play' | 'pause' | 'next', Electron.NativeImage> | null = null;
let lastThumbarPlaying: boolean | null = null;
let lastWindowTitle = '';

function updateTaskbarThumbar(isPlaying: boolean): void {
  if (process.platform !== 'win32' || !mainWindow || mainWindow.isDestroyed()) return;
  try {
    if (!cachedThumbarIcons) {
      cachedThumbarIcons = {
        prev: makeThumbarIcon('prev'),
        play: makeThumbarIcon('play'),
        pause: makeThumbarIcon('pause'),
        next: makeThumbarIcon('next'),
      };
    }
    mainWindow.setThumbarButtons([
      { tooltip: 'Anterior', icon: cachedThumbarIcons.prev, click: () => sendMediaAction('previoustrack') },
      { tooltip: isPlaying ? 'Pausar' : 'Reproducir', icon: isPlaying ? cachedThumbarIcons.pause : cachedThumbarIcons.play, click: () => sendMediaAction('toggle') },
      { tooltip: 'Siguiente', icon: cachedThumbarIcons.next, click: () => sendMediaAction('nexttrack') },
    ]);
  } catch {
    // ignore on platforms without thumbar support
  }
}

ipcMain.handle('pmusic:get-api-base-url', () => \`http://127.0.0.1:\${loopbackPort}\`);
ipcMain.handle('pmusic:get-auth-headers', () => ({}));
ipcMain.handle('pmusic:vault-get', (_event, key: string) => {
  if (typeof key !== 'string' || !key) return null;
  const vault = readVaultData();
  return Object.prototype.hasOwnProperty.call(vault, key) ? vault[key]! : null;
});
ipcMain.handle('pmusic:vault-set', (_event, key: string, value: string) => {
  if (typeof key !== 'string' || !key) return;
  const vault = readVaultData();
  vault[key] = String(value);
  writeVaultData(vault);
});
ipcMain.handle('pmusic:vault-remove', (_event, key: string) => {
  if (typeof key !== 'string' || !key) return;
  const vault = readVaultData();
  if (Object.prototype.hasOwnProperty.call(vault, key)) {
    delete vault[key];
    writeVaultData(vault);
  }
});
ipcMain.handle('pmusic:update-discord', () => undefined);
ipcMain.handle('pmusic:update-media-session', (_event, state: { isPlaying?: boolean; track?: { title?: string } }) => {
  const nextPlaying = Boolean(state?.isPlaying);
  if (nextPlaying !== lastThumbarPlaying) {
    lastThumbarPlaying = nextPlaying;
    updateTaskbarThumbar(nextPlaying);
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    const tTitle = state?.track?.title?.trim();
    const nextTitle = tTitle ? \`\${tTitle} — pMusic\` : 'pMusic';
    if (nextTitle !== lastWindowTitle) {
      lastWindowTitle = nextTitle;
      mainWindow.setTitle(nextTitle);
    }
  }
});
ipcMain.handle('pmusic:open-external-url', async (_event, url: string) => {
  if (typeof url === 'string' && /^https?:\\/\\//i.test(url)) {
    await shell.openExternal(url);
  }
});
ipcMain.handle('pmusic:get-oauth-redirect-url', async () => {
  const port = await startOAuthCallbackServer();
  return \`http://127.0.0.1:\${port}/auth/callback\`;
});
ipcMain.handle('pmusic:consume-pending-auth-callback', () => {
  const url = pendingAuthCallbackUrl;
  pendingAuthCallbackUrl = null;
  return url;
});
ipcMain.handle('pmusic:toggle-fullscreen', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  const next = !mainWindow.isFullScreen();
  mainWindow.setFullScreen(next);
  return mainWindow.isFullScreen();
});
ipcMain.handle('pmusic:get-fullscreen', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  return mainWindow.isFullScreen();
});
ipcMain.handle(
  'pmusic:set-titlebar-overlay',
  (_event, opts: { color?: string; symbolColor?: string; height?: number }) => {
    try {
      mainWindow?.setTitleBarOverlay?.({
        color: opts?.color ?? '#070709',
        symbolColor: opts?.symbolColor ?? '#B4B4BE',
        height: opts?.height ?? 48,
      });
    } catch {
      // ignore on unsupported platforms
    }
  }
);

async function createMainWindow(): Promise<void> {
  const port = await startLoopbackServer();
  const iconCandidates = [
    join(__dirname, '../dist/icon.png'),
    join(__dirname, '../build/icon.png'),
  ];
  const windowIcon = iconCandidates.find((p) => existsSync(p));
  lastThumbarPlaying = null;
  lastWindowTitle = '';

  mainWindow = new BrowserWindow({
    width: 1380,
    height: 860,
    minWidth: 420,
    minHeight: 640,
    backgroundColor: '#000000',
    title: 'pMusic',
    show: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#000000',
      symbolColor: '#B4B4BE',
      height: 48,
    },
    ...(windowIcon ? { icon: windowIcon } : {}),
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: true,
    },
  });

  const menu = Menu.buildFromTemplate([
    {
      label: 'pMusic',
      submenu: [
        { label: 'Reproducir / Pausar', click: () => sendMediaAction('toggle') },
        { label: 'Siguiente pista', click: () => sendMediaAction('nexttrack') },
        { label: 'Pista anterior', click: () => sendMediaAction('previoustrack') },
        { type: 'separator' },
        { role: 'toggleDevTools', label: 'Herramientas de desarrollo' },
        { role: 'quit', label: 'Salir de pMusic' },
      ],
    },
  ]);
  Menu.setApplicationMenu(menu);

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
    if (lastThumbarPlaying === null) {
      lastThumbarPlaying = false;
      updateTaskbarThumbar(false);
    }
  });

  const targetUrl = process.env.PMUSIC_DEV_URL || \`http://127.0.0.1:\${port}\`;
  await mainWindow.loadURL(targetUrl);

  mainWindow.on('minimize', () => {
    mainWindow?.webContents.setBackgroundThrottling(true);
    mainWindow?.webContents.send('pmusic:window-visibility', false);
  });
  mainWindow.on('hide', () => {
    mainWindow?.webContents.setBackgroundThrottling(true);
    mainWindow?.webContents.send('pmusic:window-visibility', false);
  });
  mainWindow.on('restore', () => {
    mainWindow?.webContents.send('pmusic:window-visibility', true);
  });
  mainWindow.on('show', () => {
    mainWindow?.webContents.send('pmusic:window-visibility', true);
  });
  mainWindow.on('enter-full-screen', () => {
    mainWindow?.webContents.send('pmusic:fullscreen-changed', true);
  });
  mainWindow.on('leave-full-screen', () => {
    mainWindow?.webContents.send('pmusic:fullscreen-changed', false);
  });
}

void app.whenReady().then(async () => {
  void startOAuthCallbackServer();
  try {
    if (process.defaultApp && process.argv.length >= 2 && process.argv[1]) {
      app.setAsDefaultProtocolClient('pmusic', process.execPath, [process.argv[1]]);
    } else {
      app.setAsDefaultProtocolClient('pmusic');
    }
  } catch {
    // ignore
  }
  const initialDeepLink = process.argv.find(
    (arg) => typeof arg === 'string' && arg.toLowerCase().startsWith('pmusic://')
  );
  if (initialDeepLink) {
    pendingAuthCallbackUrl = initialDeepLink;
  }
  await createMainWindow();
  if (pendingAuthCallbackUrl) {
    dispatchAuthCallbackUrl(pendingAuthCallbackUrl);
  }
  try {
    globalShortcut.register('MediaPlayPause', () => sendMediaAction('toggle'));
    globalShortcut.register('MediaNextTrack', () => sendMediaAction('nexttrack'));
    globalShortcut.register('MediaPreviousTrack', () => sendMediaAction('previoustrack'));
  } catch {
    // ignore
  }
});

app.on('window-all-closed', () => {
  globalShortcut.unregisterAll();
  loopbackServer?.close();
  oauthServer?.close();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
`;

const tmpMainPath = resolve(distElectron, '_entry_main.ts');
writeFileSync(tmpMainPath, mainEntrySource, 'utf-8');

await esbuild.build({
  entryPoints: [tmpMainPath],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  outfile: resolve(distElectron, 'main.cjs'),
  external: ['electron'],
});

await esbuild.build({
  entryPoints: [resolve(desktopRoot, 'src/preload.ts')],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  outfile: resolve(distElectron, 'preload.cjs'),
  external: ['electron'],
});

console.log('pMusic desktop bundle built with esbuild in apps/desktop/dist-electron and apps/desktop/dist');
