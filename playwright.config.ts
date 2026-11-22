import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

const VM_PLAYWRIGHT_BROWSERS_DIR = '/opt/ms-playwright';
if (!process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync(VM_PLAYWRIGHT_BROWSERS_DIR)) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = VM_PLAYWRIGHT_BROWSERS_DIR;
}

const isCI = Boolean(process.env.CI);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:4173';
const skipWebServer = process.env.PMUSIC_E2E_SKIP_WEBSERVER === '1';
const webServerCommand =
  process.env.PMUSIC_E2E_SERVER_CMD ??
  'npm run build:web && npm run preview -w @pmusic/web -- --host 127.0.0.1 --port 4173 --strictPort';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: isCI ? 2 : undefined,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    locale: 'es-ES',
    timezoneId: 'Europe/Madrid',
    colorScheme: 'dark',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    launchOptions: {
      args: [
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--autoplay-policy=no-user-gesture-required',
      ],
    },
  },
  projects: [
    {
      name: 'desktop',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        screen: { width: 1440, height: 900 },
      },
    },
    {
      name: 'desktop-narrow',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 960, height: 700 },
        screen: { width: 960, height: 700 },
      },
    },
    {
      name: 'mobile',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
        screen: { width: 390, height: 844 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
        userAgent:
          'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/159.0.8154.6 Mobile Safari/537.36',
      },
    },
  ],
  ...(skipWebServer
    ? {}
    : {
        webServer: {
          command: webServerCommand,
          url: baseURL,
          timeout: 120_000,
          reuseExistingServer: !isCI,
          stdout: 'pipe',
          stderr: 'pipe',
        },
      }),
});
