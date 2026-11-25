import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { app, BrowserWindow, globalShortcut, ipcMain, Menu, nativeImage, shell } from 'electron';
import { createPMusicApiHandler } from '@pmusic/providers';
import type {
  DiscordPresenceState,
  DiscordRpcStatus,
  NativeMediaAction,
  NativeMediaSessionState,
} from '@pmusic/core';

let mainWindow: BrowserWindow | null = null;
let loopbackServer: Server | null = null;
let loopbackPort = 0;
const loopbackAuthToken = randomBytes(24).toString('hex');
let pendingAuthCallbackUrl: string | null = null;

function dispatchAuthCallbackUrl(url: string): void {
  if (!url || !url.toLowerCase().startsWith('pmusic://')) return;
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    mainWindow.webContents.send('pmusic:auth-callback', url);
    pendingAuthCallbackUrl = null;
  } else {
    pendingAuthCallbackUrl = url;
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

class DiscordRpcManager {
  private client: any = null;
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
      const rpcMod: any = await import('@xhayper/discord-rpc');
      const ClientCtor = rpcMod.Client ?? rpcMod.default?.Client;
      if (!ClientCtor) {
        this.status = 'disconnected';
        this.lastError = 'No se pudo cargar @xhayper/discord-rpc';
        return this.getStatus();
      }

      const client = new ClientCtor({ clientId: this.clientId });
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
          : 'Discord no detectado o Client ID inválido';
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
      const details = rawTitle.length < 2 ? `${rawTitle} ` : rawTitle.slice(0, 128);
      const artists = state.track.artists.map((a) => a.name).join(', ') || 'Artista';
      const stateTextRaw = state.isPlaying ? artists : `En pausa · ${artists}`;
      const stateText = stateTextRaw.length < 2 ? `${stateTextRaw} ` : stateTextRaw.slice(0, 128);
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
      });
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

async function startLoopbackProxyServer(): Promise<number> {
  if (loopbackServer && loopbackPort > 0) return loopbackPort;
  const handler = createPMusicApiHandler({ authToken: loopbackAuthToken });

  return new Promise<number>((resolve, reject) => {
    const srv = createServer((req, res) => {
      void handler(req, res);
    });
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      loopbackPort = typeof addr === 'object' && addr ? addr.port : 0;
      loopbackServer = srv;
      resolve(loopbackPort);
    });
  });
}

function sendMediaAction(action: NativeMediaAction): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('pmusic:media-action', action);
  }
}

function pngCrc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]!;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(pngCrc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}

function makeThumbarIcon(kind: 'prev' | 'play' | 'pause' | 'next'): Electron.NativeImage {
  const size = 24;
  const raw = Buffer.alloc(size * (1 + size * 4));
  const setPx = (x: number, y: number, alpha = 255) => {
    if (x < 0 || x >= size || y < 0 || y >= size) return;
    const idx = y * (1 + size * 4) + 1 + x * 4;
    raw[idx] = 245;
    raw[idx + 1] = 245;
    raw[idx + 2] = 247;
    raw[idx + 3] = alpha;
  };

  if (kind === 'play') {
    for (let y = 5; y <= 18; y++) {
      const span = Math.round(((11.5 - Math.abs(y - 11.5)) / 6.5) * 10);
      for (let x = 7; x < 7 + span; x++) setPx(x, y);
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
  const png = Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
  return nativeImage.createFromBuffer(png);
}

let cachedThumbarIcons: Record<'prev' | 'play' | 'pause' | 'next', Electron.NativeImage> | null = null;
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
      {
        tooltip: 'Anterior',
        icon: cachedThumbarIcons.prev,
        click: () => sendMediaAction({ type: 'previoustrack' }),
      },
      {
        tooltip: isPlaying ? 'Pausar' : 'Reproducir',
        icon: isPlaying ? cachedThumbarIcons.pause : cachedThumbarIcons.play,
        click: () => sendMediaAction({ type: 'toggle' }),
      },
      {
        tooltip: 'Siguiente',
        icon: cachedThumbarIcons.next,
        click: () => sendMediaAction({ type: 'nexttrack' }),
      },
    ]);
  } catch {
    // ignore on platforms/windows without taskbar thumbar support
  }
}

async function createMainWindow(): Promise<void> {
  await startLoopbackProxyServer();

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
        {
          label: 'Reproducir / Pausar',
          accelerator: 'MediaPlayPause',
          click: () => sendMediaAction({ type: 'toggle' }),
        },
        {
          label: 'Siguiente pista',
          accelerator: 'MediaNextTrack',
          click: () => sendMediaAction({ type: 'nexttrack' }),
        },
        {
          label: 'Pista anterior',
          accelerator: 'MediaPreviousTrack',
          click: () => sendMediaAction({ type: 'previoustrack' }),
        },
        { type: 'separator' },
        { role: 'quit', label: 'Salir de pMusic' },
      ],
    },
  ]);
  Menu.setApplicationMenu(menu);

  const devUrl = process.env.PMUSIC_DEV_URL;
  if (devUrl) {
    await mainWindow.loadURL(devUrl);
  } else {
    await mainWindow.loadFile(join(__dirname, '../dist/index.html'));
  }

  updateTaskbarThumbar(false);

  mainWindow.on('enter-full-screen', () => {
    mainWindow?.webContents.send('pmusic:fullscreen-changed', true);
  });
  mainWindow.on('leave-full-screen', () => {
    mainWindow?.webContents.send('pmusic:fullscreen-changed', false);
  });
}

ipcMain.handle('pmusic:get-api-base-url', () => `http://127.0.0.1:${loopbackPort}`);
ipcMain.handle('pmusic:get-auth-headers', () => ({
  'X-PMusic-Token': loopbackAuthToken,
}));
ipcMain.handle('pmusic:update-discord', async (_event, state: DiscordPresenceState) => {
  await discordRpc.updateActivity(state);
});
ipcMain.handle('pmusic:update-media-session', (_event, state: NativeMediaSessionState) => {
  updateTaskbarThumbar(Boolean(state?.isPlaying));
  if (mainWindow && !mainWindow.isDestroyed()) {
    const tTitle = state?.track?.title?.trim();
    mainWindow.setTitle(tTitle ? `${tTitle} — pMusic` : 'pMusic');
  }
});
ipcMain.handle('pmusic:configure-discord', async (_event, clientId: string) => {
  return discordRpc.configureAndReconnect(clientId ?? '');
});
ipcMain.handle('pmusic:reconnect-discord', async () => {
  return discordRpc.connect();
});
ipcMain.handle('pmusic:get-discord-status', () => {
  return discordRpc.getStatus();
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
      // Ignore on unsupported platforms
    }
  }
);

ipcMain.handle('pmusic:open-external-url', async (_event, url: string) => {
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
    await shell.openExternal(url);
  }
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

void app.whenReady().then(async () => {
  try {
    if (process.defaultApp && process.argv.length >= 2 && process.argv[1]) {
      app.setAsDefaultProtocolClient('pmusic', process.execPath, [process.argv[1]]);
    } else {
      app.setAsDefaultProtocolClient('pmusic');
    }
  } catch {
    // Ignore protocol registration errors
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
    globalShortcut.register('MediaPlayPause', () => sendMediaAction({ type: 'toggle' }));
    globalShortcut.register('MediaNextTrack', () => sendMediaAction({ type: 'nexttrack' }));
    globalShortcut.register('MediaPreviousTrack', () => sendMediaAction({ type: 'previoustrack' }));
  } catch {
    // Ignore global shortcut registration failures in headless CI
  }
});

app.on('window-all-closed', () => {
  globalShortcut.unregisterAll();
  discordRpc.dispose();
  loopbackServer?.close();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
