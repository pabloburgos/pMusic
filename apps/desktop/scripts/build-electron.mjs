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
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { app, BrowserWindow, globalShortcut, ipcMain, Menu, shell } from 'electron';
import { createPMusicApiHandler } from '@pmusic/providers';

let mainWindow: BrowserWindow | null = null;
let splashWindow: BrowserWindow | null = null;
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

function createSplashWindow(): void {
  const wmPath = join(__dirname, '../dist/wordmark.svg');
  const rawWmSvg = existsSync(wmPath)
    ? readFileSync(wmPath, 'utf-8')
        .replace(/currentColor/g, '#FFFFFF')
        .replace('<svg ', '<svg class="wm" ')
    : '';

  splashWindow = new BrowserWindow({
    width: 420,
    height: 260,
    frame: false,
    resizable: false,
    movable: true,
    alwaysOnTop: true,
    center: true,
    backgroundColor: '#050507',
    show: true,
    skipTaskbar: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });

  const splashHtml = \`<!doctype html><html><head><meta charset="utf-8"><style>
    *{box-sizing:border-box}
    body{margin:0;height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#050507;color:#fff;overflow:hidden;border:1px solid rgba(255,255,255,.11);border-radius:22px;user-select:none;-webkit-app-region:drag;position:relative}
    .aura{position:absolute;width:300px;height:300px;border-radius:999px;background:radial-gradient(circle,rgba(255,255,255,.16) 0%,rgba(190,200,225,.05) 45%,transparent 70%);filter:blur(28px);animation:auraPulse 3s ease-in-out infinite}
    .ring{position:absolute;width:120px;height:120px;border-radius:999px;border:1px solid rgba(255,255,255,.22);animation:ringExpand 1.6s cubic-bezier(.16,1,.3,1) forwards}
    .wm-wrap{position:relative;z-index:2;animation:wmReveal 950ms cubic-bezier(.16,1,.3,1) both}
    .wm{width:210px;height:auto;display:block;filter:drop-shadow(0 12px 32px rgba(255,255,255,.18))}
    .wm path{stroke:#fff;stroke-width:3.5;stroke-dasharray:1800;stroke-dashoffset:1800;fill-opacity:0;animation:drawPath 1.05s cubic-bezier(.22,1,.36,1) forwards, fillPath .7s cubic-bezier(.16,1,.3,1) .42s forwards}
    .bar{position:relative;z-index:2;margin-top:30px;width:148px;height:2px;border-radius:99px;background:rgba(255,255,255,.1);overflow:hidden}
    .bar::after{content:'';position:absolute;inset:0;width:46%;border-radius:99px;background:linear-gradient(90deg,transparent,#ffffff,transparent);animation:slide 1.1s cubic-bezier(.4,0,.2,1) infinite}
    @keyframes auraPulse{0%,100%{transform:scale(.95);opacity:.65}50%{transform:scale(1.12);opacity:1}}
    @keyframes ringExpand{0%{transform:scale(.5);opacity:.65}100%{transform:scale(2.8);opacity:0}}
    @keyframes wmReveal{0%{opacity:0;transform:translateY(14px) scale(.92);filter:blur(8px)}100%{opacity:1;transform:none;filter:blur(0)}}
    @keyframes drawPath{0%{stroke-dashoffset:1800;stroke-opacity:.95}70%{stroke-dashoffset:0;stroke-opacity:.9}100%{stroke-dashoffset:0;stroke-opacity:0}}
    @keyframes fillPath{0%{fill-opacity:0}100%{fill-opacity:1}}
    @keyframes slide{0%{transform:translateX(-110%)}100%{transform:translateX(260%)}}
  </style></head><body>
    <div class="aura"></div>
    <div class="ring"></div>
    <div class="wm-wrap">\${rawWmSvg}</div>
    <div class="bar"></div>
  </body></html>\`;

  void splashWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(splashHtml));
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
    srv.once('error', () => {
      srv.listen(0, '127.0.0.1', onListening);
    });
    srv.listen(47820, '127.0.0.1', onListening);
  });
}

function sendMediaAction(type: string): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('pmusic:media-action', { type });
  }
}

ipcMain.handle('pmusic:get-api-base-url', () => \`http://127.0.0.1:\${loopbackPort}\`);
ipcMain.handle('pmusic:get-auth-headers', () => ({}));
ipcMain.handle('pmusic:update-discord', () => undefined);
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

  mainWindow = new BrowserWindow({
    width: 1380,
    height: 860,
    minWidth: 420,
    minHeight: 640,
    backgroundColor: '#070709',
    title: 'pMusic',
    show: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#070709',
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
    },
  });

  const menu = Menu.buildFromTemplate([
    {
      label: 'pMusic',
      submenu: [
        { label: 'Reproducir / Pausar', click: () => sendMediaAction('play') },
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
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.close();
      splashWindow = null;
    }
  });

  const targetUrl = process.env.PMUSIC_DEV_URL || \`http://127.0.0.1:\${port}\`;
  await mainWindow.loadURL(targetUrl);
}

void app.whenReady().then(async () => {
  createSplashWindow();
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
    globalShortcut.register('MediaPlayPause', () => sendMediaAction('play'));
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
