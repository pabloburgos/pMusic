import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
if (existsSync(resolve(buildDir, 'icon.ico'))) {
  cpSync(resolve(buildDir, 'icon.ico'), resolve(desktopDist, 'icon.ico'));
}
if (existsSync(canonicalLogoPng)) {
  cpSync(canonicalLogoPng, resolve(buildDir, 'icon.png'));
  cpSync(canonicalLogoPng, resolve(desktopDist, 'icon.png'));
} else {
  const brandPng = generateBrandPng(256, 256);
  writeFileSync(resolve(buildDir, 'icon.png'), brandPng);
  writeFileSync(resolve(desktopDist, 'icon.png'), brandPng);
}

const officialFaviconPath = resolve(desktopRoot, '../web/public/favicon.svg');
const officialFaviconRaw = existsSync(officialFaviconPath)
  ? readFileSync(officialFaviconPath, 'utf-8')
  : '';
const officialPathData =
  officialFaviconRaw.match(/d="([^"]+)"/)?.[1] ??
  'M100.6 0.2 C121.0 1.4 139.0 12.1 149.4 29.5 C163.3 52.8 159.4 81.9 140.0 101.2 C127.6 113.5 110.9 120.2 93.4 120.0 L59.0 119.6 L59.0 165.4 C59.0 176.9 49.7 186.2 38.2 186.2 L32.2 186.2 C20.7 186.2 11.4 176.9 11.4 165.4 L11.4 58.6 C11.4 25.1 39.2 -1.9 72.7 0.0 Z M91.4 33.4 C77.1 33.4 65.5 45.0 65.5 59.3 C65.5 73.6 77.1 85.2 91.4 85.2 C105.7 85.2 117.3 73.6 117.3 59.3 C117.3 45.0 105.7 33.4 91.4 33.4 Z';

// Update src/main.ts to serve both static dist/ files AND /api/* over http://127.0.0.1:<port>
const mainEntrySource = `import { createServer, type Server } from 'node:http';
import { execFileSync, spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, normalize } from 'node:path';
import { tmpdir } from 'node:os';
import { deflateSync, inflateRawSync } from 'node:zlib';
import { app, BrowserWindow, globalShortcut, ipcMain, Menu, nativeImage, shell } from 'electron';
import { Client as DiscordRpcClient } from '@xhayper/discord-rpc';
import type { DiscordPresenceState, DiscordRpcStatus } from '@pmusic/core';
import { createPMusicApiHandler } from '@pmusic/providers';

const PMUSIC_DESKTOP_VERSION = '0.23.14';

function getOtaRootDir(): string {
  return join(app.getPath('userData'), 'ota_web');
}

function readInstalledOtaVersion(): string {
  try {
    const verFile = join(getOtaRootDir(), 'current', 'ota-version.txt');
    if (existsSync(verFile)) {
      return readFileSync(verFile, 'utf-8').trim();
    }
  } catch {
    // ignore read failure
  }
  return '';
}

function getActiveWebDistRoot(): string {
  const defaultDist = join(__dirname, '../dist');
  try {
    const currentDir = join(getOtaRootDir(), 'current');
    if (existsSync(join(currentDir, 'index.html'))) {
      const otaVer = readInstalledOtaVersion();
      if (otaVer && compareSemverDesktop(otaVer, PMUSIC_DESKTOP_VERSION) >= 0) {
        return currentDir;
      }
    }
  } catch {
    // fall back to packaged dist
  }
  return defaultDist;
}

function extractZipBufferToDir(zipBuf: Buffer, destDir: string): void {
  let eocdOffset = -1;
  for (let i = zipBuf.length - 22; i >= Math.max(0, zipBuf.length - 65558); i--) {
    if (zipBuf.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) {
    throw new Error('Invalid OTA zip archive (missing EOCD)');
  }
  const cdOffset = zipBuf.readUInt32LE(eocdOffset + 16);
  const totalEntries = zipBuf.readUInt16LE(eocdOffset + 10);
  const resolvedRoot = normalize(destDir);
  mkdirSync(resolvedRoot, { recursive: true });

  let cursor = cdOffset;
  for (let n = 0; n < totalEntries && cursor + 46 <= zipBuf.length; n++) {
    if (zipBuf.readUInt32LE(cursor) !== 0x02014b50) break;
    const method = zipBuf.readUInt16LE(cursor + 10);
    const compSize = zipBuf.readUInt32LE(cursor + 20);
    const nameLen = zipBuf.readUInt16LE(cursor + 28);
    const extraLen = zipBuf.readUInt16LE(cursor + 30);
    const commentLen = zipBuf.readUInt16LE(cursor + 32);
    const localHeaderOffset = zipBuf.readUInt32LE(cursor + 42);
    const rawName = zipBuf.subarray(cursor + 46, cursor + 46 + nameLen).toString('utf-8');
    cursor += 46 + nameLen + extraLen + commentLen;

    if (!rawName || rawName.endsWith('/')) continue;
    const targetPath = normalize(join(resolvedRoot, rawName));
    if (!targetPath.startsWith(resolvedRoot)) continue;

    if (zipBuf.readUInt32LE(localHeaderOffset) !== 0x04034b50) continue;
    const lNameLen = zipBuf.readUInt16LE(localHeaderOffset + 26);
    const lExtraLen = zipBuf.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + lNameLen + lExtraLen;
    const compSlice = zipBuf.subarray(dataStart, dataStart + compSize);

    const outData = method === 0 ? compSlice : method === 8 ? inflateRawSync(compSlice) : null;
    if (!outData) {
      throw new Error('Unsupported zip compression method: ' + String(method));
    }
    mkdirSync(dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, outData);
  }
}

function compareSemverDesktop(remoteRaw: string, localRaw: string): number {
  const clean = (v: string) =>
    v
      .trim()
      .replace(/^v/i, '')
      .split('-')[0]
      ?.split('.')
      .map((n) => Number.parseInt(n, 10) || 0) ?? [0, 0, 0];
  const r = clean(remoteRaw);
  const l = clean(localRaw);
  const len = Math.max(r.length, l.length, 3);
  for (let i = 0; i < len; i++) {
    const rv = r[i] ?? 0;
    const lv = l[i] ?? 0;
    if (rv > lv) return 1;
    if (rv < lv) return -1;
  }
  return 0;
}

function scheduleCloseOAuthBrowserWindow(): void {
  if (process.platform !== 'win32') return;
  for (const delayMs of [1100, 2300]) {
    setTimeout(() => {
      try {
        const psScript = \`
Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class PMWinClose {
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
  public static void CloseMatching(uint selfPid) {
    EnumWindows((hWnd, lParam) => {
      if (!IsWindowVisible(hWnd)) return true;
      uint pid = 0;
      GetWindowThreadProcessId(hWnd, out pid);
      if (pid == selfPid) return true;
      var sb = new StringBuilder(512);
      GetWindowText(hWnd, sb, sb.Capacity);
      var title = sb.ToString();
      if (title.Contains("pMusic") && (title.Contains("iniciada") || title.Contains("Auth"))) {
        PostMessage(hWnd, 0x0010, IntPtr.Zero, IntPtr.Zero);
      }
      return true;
    }, IntPtr.Zero);
  }
}
"@
[PMWinClose]::CloseMatching(\${process.pid})
\`;
        const encoded = Buffer.from(psScript, 'utf16le').toString('base64');
        const child = spawn(
          'powershell.exe',
          ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded],
          { detached: true, stdio: 'ignore', windowsHide: true }
        );
        child.unref();
      } catch {
        // ignore window auto-close fallback errors
      }
    }, delayMs);
  }
}

class DiscordRpcManager {
  private client: InstanceType<typeof DiscordRpcClient> | null = null;
  private clientId = '';
  private status: DiscordRpcStatus['status'] = 'disconnected';
  private username: string | undefined;
  private lastError: string | undefined;
  private connecting = false;
  private enabled = true;
  private lastState: DiscordPresenceState | null = null;
  private reconnectTimer: ReturnType<typeof setInterval> | null = null;

  private getConfigPath(): string {
    return join(app.getPath('userData'), 'discord-rpc.json');
  }

  public loadSavedClientId(): void {
    try {
      const cfgPath = this.getConfigPath();
      if (existsSync(cfgPath)) {
        const raw = JSON.parse(readFileSync(cfgPath, 'utf8')) as { clientId?: string };
        if (typeof raw?.clientId === 'string' && raw.clientId.trim()) {
          this.clientId = raw.clientId.trim();
          return;
        }
      }
    } catch {
      // Ignore corrupt file
    }
    this.clientId = (process.env.DISCORD_CLIENT_ID ?? '').trim();
  }

  public saveClientId(clientId: string): void {
    this.clientId = clientId.trim();
    try {
      writeFileSync(
        this.getConfigPath(),
        JSON.stringify({ clientId: this.clientId }, null, 2),
        'utf8'
      );
    } catch {
      // Ignore disk write failure
    }
  }

  public getStatus(): DiscordRpcStatus {
    return {
      connected: Boolean(this.client?.user && this.status === 'connected'),
      status: this.clientId
        ? this.enabled
          ? this.status
          : 'disabled'
        : 'needs_client_id',
      username: this.username,
      clientId: this.clientId,
      lastError: this.lastError,
    };
  }

  public start(): void {
    this.loadSavedClientId();
    if (!this.reconnectTimer) {
      this.reconnectTimer = setInterval(() => {
        if (this.enabled && this.clientId && (!this.client || !this.client.user)) {
          void this.connect();
        }
      }, 15_000);
    }
    if (this.clientId && this.enabled) {
      void this.connect();
    } else if (!this.clientId) {
      this.status = 'needs_client_id';
    }
  }

  public async configureAndReconnect(clientId: string): Promise<DiscordRpcStatus> {
    this.saveClientId(clientId);
    await this.disconnect();
    if (!this.clientId) {
      this.status = 'needs_client_id';
      this.lastError = undefined;
      return this.getStatus();
    }
    this.enabled = true;
    await this.connect();
    return this.getStatus();
  }

  public async disconnect(): Promise<void> {
    if (this.client) {
      try {
        await this.client.destroy?.();
      } catch {
        // Ignore teardown errors
      }
      this.client = null;
    }
    this.username = undefined;
    if (this.status === 'connected' || this.status === 'connecting') {
      this.status = 'disconnected';
    }
  }

  public async connect(): Promise<DiscordRpcStatus> {
    if (!this.enabled) {
      this.status = 'disabled';
      return this.getStatus();
    }
    if (!this.clientId) {
      this.status = 'needs_client_id';
      return this.getStatus();
    }
    if (this.connecting) return this.getStatus();
    if (this.client?.user && this.status === 'connected') return this.getStatus();

    this.connecting = true;
    this.status = 'connecting';
    this.lastError = undefined;

    try {
      const client = new DiscordRpcClient({ clientId: this.clientId });
      client.on('ready', () => {
        this.client = client;
        this.status = 'connected';
        this.username = client.user?.username ?? undefined;
        this.lastError = undefined;
        if (this.lastState) {
          void this.updateActivity(this.lastState);
        }
      });
      client.on('disconnected', () => {
        if (this.client === client) {
          this.client = null;
          this.username = undefined;
          this.status = 'disconnected';
        }
      });

      await client.login();
      this.client = client;
      if (client.user) {
        this.status = 'connected';
        this.username = client.user.username ?? undefined;
      }
    } catch (err) {
      this.client = null;
      this.username = undefined;
      this.status = 'disconnected';
      this.lastError =
        err instanceof Error
          ? err.message
          : 'Discord Desktop no detectado o Client ID inválido';
    } finally {
      this.connecting = false;
    }
    return this.getStatus();
  }

  public async updateActivity(state: DiscordPresenceState): Promise<void> {
    this.lastState = state;
    this.enabled = state.enabled;
    if (typeof state.clientId === 'string' && state.clientId.trim() !== this.clientId) {
      await this.configureAndReconnect(state.clientId);
    }

    if (!state.enabled) {
      this.status = this.clientId ? 'disabled' : 'needs_client_id';
      if (this.client?.user) {
        await this.client.user.clearActivity().catch(() => {});
      }
      return;
    }

    if (!this.clientId) {
      this.status = 'needs_client_id';
      return;
    }

    if (!this.client?.user) {
      await this.connect();
      if (!this.client?.user) return;
    }

    try {
      if (!state.track || (!state.isPlaying && state.showWhenPaused === false)) {
        await this.client.user.clearActivity();
        return;
      }

      const rawTitle = (state.track.title || 'pMusic').trim();
      const details = rawTitle.length < 2 ? rawTitle + ' ' : rawTitle.slice(0, 128);
      const artists = state.track.artists.map((a) => a.name).join(', ') || 'Artista';
      const stateTextRaw = state.isPlaying ? artists : 'En pausa · ' + artists;
      const stateText = stateTextRaw.length < 2 ? stateTextRaw + ' ' : stateTextRaw.slice(0, 128);
      const artUrl =
        state.showArtwork !== false
          ? state.track.thumbnailHighUrl ?? state.track.thumbnailUrl
          : undefined;
      const validArtUrl =
        artUrl && (artUrl.startsWith('https://') || artUrl.startsWith('http://'))
          ? artUrl
          : undefined;

      const nowSec = Math.floor(Date.now() / 1000);
      const dur = state.durationSec ?? state.track.durationSec ?? 0;
      const timestamps =
        state.isPlaying && state.showTimestamps !== false
          ? {
              startTimestamp: Math.max(0, nowSec - Math.max(0, Math.round(state.positionSec))),
              ...(dur > state.positionSec
                ? { endTimestamp: nowSec + Math.round(dur - state.positionSec) }
                : {}),
            }
          : {};

      const statusDisplayType =
        state.displayMode === 'artist' ? 1 : state.displayMode === 'app' ? 0 : 2;

      await this.client.user.setActivity({
        type: 2,
        statusDisplayType,
        details,
        state: stateText,
        ...(validArtUrl
          ? {
              largeImageKey: validArtUrl,
              largeImageText: state.track.album?.name?.slice(0, 128) || 'pMusic',
            }
          : {}),
        instance: false,
        ...timestamps,
      } as any);
    } catch {
      this.status = 'disconnected';
      this.client = null;
    }
  }

  public dispose(): void {
    if (this.reconnectTimer) {
      clearInterval(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    void this.disconnect();
  }
}

const discordRpc = new DiscordRpcManager();

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

async function openUrlInNewBrowserWindow(url: string): Promise<void> {
  if (process.platform === 'win32') {
    try {
      const candidates: string[] = [];
      try {
        const regOut = execFileSync(
          'reg',
          ['query', 'HKCU\\\\Software\\\\Microsoft\\\\Windows\\\\Shell\\\\Associations\\\\UrlAssociations\\\\https\\\\UserChoice', '/v', 'ProgId'],
          { encoding: 'utf-8', timeout: 1500, windowsHide: true }
        );
        const progId = regOut.match(/ProgId\\s+REG_SZ\\s+(\\S+)/i)?.[1];
        if (progId) {
          const cmdOut = execFileSync(
            'reg',
            ['query', \`HKCR\\\\\${progId}\\\\shell\\\\open\\\\command\`, '/ve'],
            { encoding: 'utf-8', timeout: 1500, windowsHide: true }
          );
          const exePath = cmdOut.match(/"([^"]+\\.exe)"/i)?.[1];
          if (exePath && existsSync(exePath)) candidates.push(exePath);
        }
      } catch {
        // fallback below
      }
      for (const root of [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA]) {
        if (!root) continue;
        for (const rel of [
          'Google\\\\Chrome\\\\Application\\\\chrome.exe',
          'Microsoft\\\\Edge\\\\Application\\\\msedge.exe',
          'BraveSoftware\\\\Brave-Browser\\\\Application\\\\brave.exe',
          'Vivaldi\\\\Application\\\\vivaldi.exe',
          'Programs\\\\Opera\\\\opera.exe',
          'Mozilla Firefox\\\\firefox.exe',
        ]) {
          const p = join(root, rel);
          if (existsSync(p) && !candidates.includes(p)) candidates.push(p);
        }
      }
      const exe = candidates[0];
      if (exe) {
        const args = /firefox\\.exe$/i.test(exe)
          ? ['-new-window', url]
          : ['--app=' + url, '--window-size=500,680'];
        const child = spawn(exe, args, { detached: true, stdio: 'ignore', windowsHide: false });
        child.unref();
        return;
      }
    } catch {
      // fall back to default external opener
    }
  }
  await shell.openExternal(url);
}

async function startOAuthCallbackServer(): Promise<number> {
  if (oauthServer && oauthPort > 0) return oauthPort;
  const htmlDone = \`<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sesión iniciada — pMusic</title>
<style>
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#050507;color:#fff;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;overflow:hidden}
  .glow{position:fixed;left:50%;top:18%;width:520px;height:400px;transform:translateX(-50%);border-radius:999px;background:radial-gradient(circle,rgba(255,255,255,.18) 0%,rgba(52,211,153,.09) 45%,transparent 72%);filter:blur(100px);pointer-events:none}
  .card{position:relative;z-index:2;width:min(90vw,390px);padding:36px 28px 30px;border-radius:28px;border:1px solid rgba(255,255,255,.11);background:rgba(255,255,255,.035);backdrop-filter:blur(28px);text-align:center;box-shadow:0 28px 80px rgba(0,0,0,.7);animation:enter .55s cubic-bezier(.16,1,.3,1) both}
  .logo-wrap{position:relative;display:inline-flex;align-items:center;justify-content:center;width:72px;height:72px;border-radius:22px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.14);margin-bottom:20px}
  .badge{position:absolute;right:-6px;bottom:-6px;width:26px;height:26px;border-radius:999px;background:#34D399;color:#050507;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:14px;box-shadow:0 4px 14px rgba(52,211,153,.45);border:2px solid #050507}
  .badge.err{background:#FB7185;box-shadow:0 4px 14px rgba(251,113,133,.45)}
  .brand{font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:rgba(255,255,255,.45);font-weight:700;margin-bottom:6px}
  h1{margin:0 0 10px;font-size:21px;font-weight:800;letter-spacing:-.02em}
  p{margin:0 0 22px;font-size:13.5px;line-height:1.5;color:rgba(255,255,255,.65)}
  .bar{height:3px;width:100%;border-radius:99px;background:rgba(255,255,255,.09);overflow:hidden;margin-bottom:18px}
  .fill{height:100%;width:100%;background:linear-gradient(90deg,#34D399,#ffffff);transform-origin:left;animation:prog 2.1s cubic-bezier(.22,1,.36,1) both}
  .btn{width:100%;padding:12px 18px;border-radius:999px;border:0;background:#fff;color:#050507;font-size:13.5px;font-weight:700;cursor:pointer;transition:transform .15s,opacity .15s}
  .btn:hover{opacity:.92}.btn:active{transform:scale(.98)}
  .foot{margin-top:12px;font-size:11.5px;color:rgba(255,255,255,.4)}
  @keyframes enter{from{opacity:0;transform:translateY(14px) scale(.97)}to{opacity:1;transform:none}}
  @keyframes prog{from{transform:scaleX(0)}to{transform:scaleX(1)}}
</style></head><body>
<div class="glow"></div>
<div class="card">
  <div class="logo-wrap">
    <svg width="42" height="42" viewBox="0 0 256 256" fill="none" aria-hidden="true">
      <g transform="translate(52.56, 34.00) scale(0.94000)">
        <path fill="#FFFFFF" fill-rule="evenodd" d="${officialPathData}"/>
      </g>
    </svg>
    <div id="badge" class="badge">✓</div>
  </div>
  <div class="brand">pMusic</div>
  <h1 id="title">Sesión iniciada correctamente</h1>
  <p id="desc">Tu cuenta de Google se ha conectado con pMusic. Ya puedes volver a la aplicación.</p>
  <div class="bar"><div class="fill"></div></div>
  <button type="button" class="btn" onclick="try{window.close()}catch(e){}">Volver a pMusic</button>
  <div id="foot" class="foot">Cerrando esta ventana automáticamente…</div>
</div>
<script>
  if (location.search && location.search.includes('error=')) {
    document.getElementById('badge').textContent = '!';
    document.getElementById('badge').className = 'badge err';
    document.getElementById('title').textContent = 'No se pudo completar el acceso';
    document.getElementById('desc').textContent = 'Vuelve a pMusic e inténtalo de nuevo.';
    document.getElementById('foot').textContent = 'Puedes cerrar esta ventana.';
  }
  if (location.hash && location.hash.includes('access_token')) {
    fetch('/auth/hash', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: location.href }).catch(()=>{});
  }
  setTimeout(() => { try { window.open('', '_self'); window.close(); } catch {} }, 900);
  setTimeout(() => { try { window.close(); } catch {} }, 1600);
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
              scheduleCloseOAuthBrowserWindow();
            }
            res.statusCode = 200;
            res.end('ok');
          });
          return;
        }
        const fullUrl = \`http://127.0.0.1:\${oauthPort}\${reqUrl}\`;
        if (reqUrl.includes('code=') || reqUrl.includes('error=')) {
          dispatchAuthCallbackUrl(fullUrl);
          if (!reqUrl.includes('error=')) {
            scheduleCloseOAuthBrowserWindow();
          }
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
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.wav': 'audio/wav',
};

async function startLoopbackServer(): Promise<number> {
  if (loopbackServer && loopbackPort > 0) return loopbackPort;
  const apiHandler = createPMusicApiHandler();

  return new Promise<number>((resolvePort, reject) => {
    const srv = createServer(async (req, res) => {
      const rawUrl = req.url ?? '/';
      if (rawUrl.startsWith('/api/')) {
        await apiHandler(req, res);
        return;
      }

      const distRoot = getActiveWebDistRoot();
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
        if (ext === '.html') {
          res.setHeader('Cache-Control', 'no-store');
        }
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
ipcMain.handle('pmusic:update-discord', async (_event, state: DiscordPresenceState) => {
  await discordRpc.updateActivity(state);
});
ipcMain.handle('pmusic:configure-discord', async (_event, clientId: string) =>
  discordRpc.configureAndReconnect(typeof clientId === 'string' ? clientId : '')
);
ipcMain.handle('pmusic:reconnect-discord', async () => discordRpc.connect());
ipcMain.handle('pmusic:get-discord-status', () => discordRpc.getStatus());
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
ipcMain.handle('pmusic:open-auth-window', async (_event, url: string) => {
  if (typeof url === 'string' && /^https?:\\/\\//i.test(url)) {
    await openUrlInNewBrowserWindow(url);
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
ipcMain.handle('pmusic:check-and-apply-update', async (_event, runningWebVersion?: string) => {
  const sendProg = (percent: number, message: string, phase = 'downloading') => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('pmusic:update-progress', {
        phase,
        version: runningWebVersion ?? PMUSIC_DESKTOP_VERSION,
        percent,
        message,
      });
    }
  };
  const currentWebVer =
    typeof runningWebVersion === 'string' && runningWebVersion.trim()
      ? runningWebVersion.trim().replace(/^v/i, '')
      : readInstalledOtaVersion() || PMUSIC_DESKTOP_VERSION;

  // 1. Instant In-Splash OTA web bundle update (zero Setup.exe reinstall needed)
  try {
    const acOta = new AbortController();
    const tOta = setTimeout(() => acOta.abort(), 3200);
    const otaRes = await fetch(
      'https://raw.githubusercontent.com/pabloburgos/pMusic/main/ota/latest.json?t=' + Date.now(),
      { signal: acOta.signal, headers: { 'User-Agent': 'pMusic-Updater' } }
    ).finally(() => clearTimeout(tOta));
    if (otaRes.ok) {
      const ota = (await otaRes.json()) as {
        version?: string;
        minNativeVersion?: string;
        bundleUrl?: string;
      };
      const otaVer = String(ota?.version ?? '').trim().replace(/^v/i, '');
      const minNative = String(ota?.minNativeVersion ?? '').trim().replace(/^v/i, '');
      const nativeCompatible =
        !minNative || compareSemverDesktop(minNative, PMUSIC_DESKTOP_VERSION) <= 0;
      if (
        otaVer &&
        ota?.bundleUrl &&
        nativeCompatible &&
        compareSemverDesktop(otaVer, currentWebVer) > 0
      ) {
        sendProg(10, 'Actualización v' + otaVer + ' · Descargando…');
        const dlRes = await fetch(ota.bundleUrl, {
          headers: { 'User-Agent': 'pMusic-Updater' },
        });
        if (dlRes.ok && dlRes.body) {
          const total = Number(dlRes.headers.get('content-length') ?? 0) || 1_500_000;
          const chunks: Buffer[] = [];
          let received = 0;
          const reader = dlRes.body.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) {
              const buf = Buffer.from(value);
              chunks.push(buf);
              received += buf.length;
              const pct = Math.min(88, Math.max(12, Math.round((received / total) * 85)));
              sendProg(pct, 'Actualización v' + otaVer + ' · Descargando ' + pct + '%…');
            }
          }
          sendProg(92, 'Actualización v' + otaVer + ' · Instalando…', 'installing');
          const otaRoot = getOtaRootDir();
          const stagingDir = join(otaRoot, 'staging');
          const currentDir = join(otaRoot, 'current');
          rmSync(stagingDir, { recursive: true, force: true });
          extractZipBufferToDir(Buffer.concat(chunks), stagingDir);
          if (existsSync(join(stagingDir, 'index.html'))) {
            writeFileSync(join(stagingDir, 'ota-version.txt'), otaVer, 'utf-8');
            rmSync(currentDir, { recursive: true, force: true });
            renameSync(stagingDir, currentDir);
            sendProg(100, 'Actualización v' + otaVer + ' instalada · Cargando…', 'installing');
            if (mainWindow && !mainWindow.isDestroyed()) {
              await mainWindow.webContents.session.clearCache().catch(() => {});
              setTimeout(() => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                  void mainWindow.loadURL(
                    'http://127.0.0.1:' + String(loopbackPort) + '/?ota=' + encodeURIComponent(otaVer)
                  );
                }
              }, 220);
            }
            return { updated: true, version: otaVer };
          }
        }
      }
    }
  } catch {
    // Fall back to GitHub Release native installer check when needed
  }

  // 2. Native Electron installer fallback (only when packaged + native update needed)
  if (!app.isPackaged || process.platform !== 'win32') {
    return { updated: false };
  }
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 1600);
    const relRes = await fetch('https://api.github.com/repos/pabloburgos/pMusic/releases/latest', {
      signal: ac.signal,
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'pMusic-Updater' },
    }).finally(() => clearTimeout(t));
    if (!relRes.ok) return { updated: false };
    const relJson = (await relRes.json()) as {
      tag_name?: string;
      assets?: Array<{ name?: string; browser_download_url?: string }>;
    };
    const latestVer = String(relJson?.tag_name ?? '').trim().replace(/^v/i, '');
    if (!latestVer || compareSemverDesktop(latestVer, PMUSIC_DESKTOP_VERSION) <= 0) {
      return { updated: false };
    }
    const exeAsset = (relJson.assets ?? []).find((a) => /pMusic-Setup.*\.exe$/i.test(a.name ?? ''));
    if (!exeAsset?.browser_download_url) {
      return { updated: false };
    }

    sendProg(8, 'Actualizando pMusic a v' + latestVer + '…');
    const dlAc = new AbortController();
    const dlRes = await fetch(exeAsset.browser_download_url, {
      signal: dlAc.signal,
      headers: { 'User-Agent': 'pMusic-Updater' },
    });
    if (!dlRes.ok || !dlRes.body) return { updated: false };

    const totalBytes = Number(dlRes.headers.get('content-length') ?? 0) || 170 * 1024 * 1024;
    const installerPath = join(tmpdir(), 'pMusic-Setup-Update-' + latestVer + '.exe');
    const ws = createWriteStream(installerPath);
    const reader = dlRes.body.getReader();
    let received = 0;
    let lastReportMs = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        ws.write(Buffer.from(value));
        received += value.byteLength;
        const nowMs = Date.now();
        if (nowMs - lastReportMs > 120) {
          lastReportMs = nowMs;
          const pct = Math.min(94, Math.max(10, Math.round((received / totalBytes) * 90)));
          sendProg(pct, 'Actualizando pMusic a v' + latestVer + ' (' + pct + '%)…');
        }
      }
    }
    await new Promise<void>((resolve, reject) => {
      ws.end(() => resolve());
      ws.on('error', reject);
    });

    if (!existsSync(installerPath) || statSync(installerPath).size < 10_000_000) {
      return { updated: false };
    }

    sendProg(100, 'Aplicando actualización y reiniciando…', 'installing');
    const installDir = dirname(process.execPath);
    const child = spawn(
      installerPath,
      ['/silent', '/dir=' + installDir, '/relaunch'],
      { detached: true, stdio: 'ignore', windowsHide: true }
    );
    child.unref();
    setTimeout(() => app.quit(), 300);
    return { updated: true, version: latestVer };
  } catch {
    return { updated: false };
  }
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
    join(__dirname, '../dist/icon.ico'),
    join(__dirname, '../build/icon.ico'),
    join(__dirname, '../dist/icon.png'),
    join(__dirname, '../build/icon.png'),
  ];
  const windowIconPath = iconCandidates.find((p) => existsSync(p));
  const resolvedWindowIcon = windowIconPath ? nativeImage.createFromPath(windowIconPath) : null;
  const windowIcon = resolvedWindowIcon && !resolvedWindowIcon.isEmpty() ? resolvedWindowIcon : windowIconPath;
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
    mainWindow?.webContents.setBackgroundThrottling(false);
    mainWindow?.webContents.invalidate();
    mainWindow?.webContents.send('pmusic:window-visibility', true);
  });
  mainWindow.on('show', () => {
    mainWindow?.webContents.setBackgroundThrottling(false);
    mainWindow?.webContents.invalidate();
    mainWindow?.webContents.send('pmusic:window-visibility', true);
  });
  mainWindow.on('enter-full-screen', () => {
    mainWindow?.webContents.send('pmusic:fullscreen-changed', true);
  });
  mainWindow.on('leave-full-screen', () => {
    mainWindow?.webContents.send('pmusic:fullscreen-changed', false);
  });
}

if (process.platform === 'win32') {
  app.setAppUserModelId('es.pmusic.desktop');
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
  discordRpc.start();
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
  discordRpc.dispose();
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
