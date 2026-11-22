import { existsSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { app, BrowserWindow, globalShortcut, ipcMain, Menu } from 'electron';
import { createPMusicApiHandler } from '@pmusic/providers';
import type { DiscordPresenceState, NativeMediaAction } from '@pmusic/core';

let mainWindow: BrowserWindow | null = null;
let loopbackServer: Server | null = null;
let loopbackPort = 0;
const loopbackAuthToken = randomBytes(24).toString('hex');

// Optional Discord Rich Presence client (graceful no-op when Discord is closed)
let discordClient: any = null;
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID ?? '1298765432109876543';

async function initDiscordRpc(): Promise<void> {
  try {
    const rpcMod: any = await import('@xhayper/discord-rpc');
    const ClientCtor = rpcMod.Client ?? rpcMod.default?.Client;
    if (!ClientCtor) return;
    const client = new ClientCtor({ clientId: DISCORD_CLIENT_ID });
    client.on('ready', () => {
      discordClient = client;
    });
    client.on('disconnected', () => {
      discordClient = null;
    });
    await client.login().catch(() => {
      discordClient = null;
    });
  } catch {
    discordClient = null;
  }
}

async function updateDiscordActivity(state: DiscordPresenceState): Promise<void> {
  if (!discordClient?.user) return;
  try {
    if (!state.enabled || !state.track) {
      await discordClient.user.clearActivity();
      return;
    }
    const artistNames = state.track.artists.map((a) => a.name).join(', ');
    await discordClient.user.setActivity({
      details: state.track.title,
      state: `por ${artistNames}`,
      largeImageKey: 'pmusic_logo',
      largeImageText: 'pMusic — OLED Liquid Glass & Sesión DJ',
      instance: false,
      ...(state.isPlaying
        ? {
            startTimestamp: Math.floor(Date.now() / 1000 - state.positionSec),
          }
        : {}),
    });
  } catch {
    // Silent fallback when Discord closes mid-session
  }
}

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
          click: () => sendMediaAction({ type: 'play' }),
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
}

ipcMain.handle('pmusic:get-api-base-url', () => `http://127.0.0.1:${loopbackPort}`);
ipcMain.handle('pmusic:get-auth-headers', () => ({
  'X-PMusic-Token': loopbackAuthToken,
}));
ipcMain.handle('pmusic:update-discord', async (_event, state: DiscordPresenceState) => {
  await updateDiscordActivity(state);
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

void app.whenReady().then(async () => {
  await createMainWindow();
  void initDiscordRpc();

  try {
    globalShortcut.register('MediaPlayPause', () => sendMediaAction({ type: 'play' }));
    globalShortcut.register('MediaNextTrack', () => sendMediaAction({ type: 'nexttrack' }));
    globalShortcut.register('MediaPreviousTrack', () => sendMediaAction({ type: 'previoustrack' }));
  } catch {
    // Ignore global shortcut registration failures in headless CI
  }
});

app.on('window-all-closed', () => {
  globalShortcut.unregisterAll();
  loopbackServer?.close();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
