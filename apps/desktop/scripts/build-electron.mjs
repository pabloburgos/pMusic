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

// Generate original pMusic brand SVG + valid 256x256 PNG icon
const brandSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256">
  <defs>
    <linearGradient id="pmGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#FFFFFF" />
      <stop offset="100%" stop-color="#C084FC" />
    </linearGradient>
  </defs>
  <rect width="256" height="256" rx="56" fill="#08080C" />
  <rect x="16" y="16" width="224" height="224" rx="44" fill="url(#pmGrad)" opacity="0.16" />
  <circle cx="128" cy="128" r="76" fill="none" stroke="url(#pmGrad)" stroke-width="18" />
  <polygon points="108,92 168,128 108,164" fill="#F5F5F7" />
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

function generateBrandPng(width = 256, height = 256) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // 8-bit
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const rawRows = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + width * 4);
    rawRows[rowStart] = 0;
    for (let x = 0; x < width; x++) {
      const px = rowStart + 1 + x * 4;
      const dx = x - width / 2;
      const dy = y - height / 2;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 90 && dist > 62) {
        rawRows[px] = 200;
        rawRows[px + 1] = 160;
        rawRows[px + 2] = 255;
        rawRows[px + 3] = 255;
      } else {
        rawRows[px] = 8;
        rawRows[px + 1] = 8;
        rawRows[px + 2] = 12;
        rawRows[px + 3] = 255;
      }
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

writeFileSync(resolve(buildDir, 'icon.png'), generateBrandPng(256, 256));

// Update src/main.ts to serve both static dist/ files AND /api/* over http://127.0.0.1:<port>
const mainEntrySource = `import { createServer, type Server } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { app, BrowserWindow, globalShortcut, ipcMain, Menu } from 'electron';
import { createPMusicApiHandler } from '@pmusic/providers';

let mainWindow: BrowserWindow | null = null;
let loopbackServer: Server | null = null;
let loopbackPort = 0;

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
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      loopbackPort = typeof addr === 'object' && addr ? addr.port : 0;
      loopbackServer = srv;
      resolvePort(loopbackPort);
    });
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

async function createMainWindow(): Promise<void> {
  const port = await startLoopbackServer();

  mainWindow = new BrowserWindow({
    width: 1380,
    height: 860,
    minWidth: 420,
    minHeight: 640,
    backgroundColor: '#08080C',
    title: 'pMusic',
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

  const targetUrl = process.env.PMUSIC_DEV_URL || \`http://127.0.0.1:\${port}\`;
  await mainWindow.loadURL(targetUrl);
}

void app.whenReady().then(async () => {
  await createMainWindow();
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
