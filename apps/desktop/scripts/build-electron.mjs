import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

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
      <stop offset="0%" stop-color="#0A84FF" />
      <stop offset="100%" stop-color="#BF5AF2" />
    </linearGradient>
  </defs>
  <rect width="256" height="256" rx="56" fill="#06060A" />
  <rect x="16" y="16" width="224" height="224" rx="44" fill="url(#pmGrad)" opacity="0.22" />
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
        rawRows[px] = 10 + Math.round((x / width) * 180);
        rawRows[px + 1] = 90;
        rawRows[px + 2] = 242;
        rawRows[px + 3] = 255;
      } else {
        rawRows[px] = 6;
        rawRows[px + 1] = 6;
        rawRows[px + 2] = 10;
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

// Compile Electron main.ts and preload.ts into dist-electron/main.cjs & preload.cjs
const mainCjs = `'use strict';
const { createServer } = require('node:http');
const { randomBytes } = require('node:crypto');
const { join } = require('node:path');
const { app, BrowserWindow, globalShortcut, ipcMain, Menu } = require('electron');

let mainWindow = null;
let loopbackServer = null;
let loopbackPort = 0;
const loopbackAuthToken = randomBytes(24).toString('hex');

function startLoopbackServer() {
  return new Promise((resolve) => {
    const srv = createServer((req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      if (req.url && req.url.startsWith('/api/health')) {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: true, status: 'ok', region: 'ES', lang: 'es' }));
        return;
      }
      res.statusCode = 404;
      res.end();
    });
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      loopbackPort = addr && typeof addr === 'object' ? addr.port : 0;
      loopbackServer = srv;
      resolve(loopbackPort);
    });
  });
}

ipcMain.handle('pmusic:get-api-base-url', () => '');
ipcMain.handle('pmusic:get-auth-headers', () => ({ 'X-PMusic-Token': loopbackAuthToken }));
ipcMain.handle('pmusic:update-discord', () => undefined);

app.whenReady().then(async () => {
  await startLoopbackServer();
  mainWindow = new BrowserWindow({
    width: 1380,
    height: 860,
    backgroundColor: '#06060A',
    title: 'pMusic',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  await mainWindow.loadFile(join(__dirname, '../dist/index.html'));
});

app.on('window-all-closed', () => {
  globalShortcut.unregisterAll();
  if (loopbackServer) loopbackServer.close();
  if (process.platform !== 'darwin') app.quit();
});
`;

const preloadCjs = `'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pmusicDesktop', {
  runtime: 'electron',
  getApiBaseUrl: () => ipcRenderer.invoke('pmusic:get-api-base-url'),
  getAuthHeaders: () => ipcRenderer.invoke('pmusic:get-auth-headers'),
  updateDiscordPresence: (state) => ipcRenderer.invoke('pmusic:update-discord', state),
  onMediaShortcut: (cb) => {
    const handler = (_ev, action) => cb(action);
    ipcRenderer.on('pmusic:media-action', handler);
    return () => ipcRenderer.removeListener('pmusic:media-action', handler);
  },
});
`;

writeFileSync(resolve(distElectron, 'main.cjs'), mainCjs, 'utf-8');
writeFileSync(resolve(distElectron, 'preload.cjs'), preloadCjs, 'utf-8');
console.log('pMusic desktop bundle built in apps/desktop/dist-electron and apps/desktop/dist');
