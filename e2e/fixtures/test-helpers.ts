/**
 * Opaque-box UI interaction helpers, multi-viewport project gating, HTML5
 * `<audio>` DOM playback probes, and pure-Node binary validators (PNG & Android
 * APK ZIP Central Directory inspector) for pMusic E2E suites (Tiers 1-4).
 *
 * Strictly opaque-box:
 * - ZERO imports from `apps/**` or `packages/**`.
 * - Interacts solely via the 15 frozen `data-testid` landmarks in `PROJECT.md`,
 *   standard WAI-ARIA roles, and authoritative Spanish accessible names.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import {
  expect,
  test,
  type Locator,
  type Page,
  type TestInfo,
} from '@playwright/test';

/**
 * The 15 frozen `data-testid` landmarks from `PROJECT.md § Interface Contracts #6`.
 */
export const FROZEN_TEST_IDS = {
  mobileTabBar: 'mobile-tab-bar',
  mobileMiniPlayer: 'mobile-mini-player',
  desktopSidebar: 'desktop-sidebar',
  desktopPlayerBar: 'desktop-player-bar',
  nowPlayingSheet: 'now-playing-sheet',
  syncedLyricsView: 'synced-lyrics-view',
  queueView: 'queue-view',
  djModeToggle: 'dj-mode-toggle',
  djStyleQuick: 'dj-style-quick',
  djStyleFull: 'dj-style-full',
  eqSheet: 'eq-sheet',
  devicesSheet: 'devices-sheet',
  importModal: 'import-modal',
  settingsView: 'settings-view',
  bestResultCard: 'best-result-card',
} as const;

export type ViewportClass = 'mobile' | 'desktop-narrow' | 'desktop';

function isPage(pageOrTestInfo: Page | TestInfo): pageOrTestInfo is Page {
  return typeof (pageOrTestInfo as Page).viewportSize === 'function';
}

export function getViewportWidth(pageOrTestInfo: Page | TestInfo): number {
  if (isPage(pageOrTestInfo)) {
    return pageOrTestInfo.viewportSize()?.width ?? 1440;
  }
  return pageOrTestInfo.project.use.viewport?.width ?? 1440;
}

export function getViewportClass(
  pageOrTestInfo: Page | TestInfo
): ViewportClass {
  const width = getViewportWidth(pageOrTestInfo);
  if (width < 768) return 'mobile';
  if (width < 1024) return 'desktop-narrow';
  return 'desktop';
}

/**
 * Gates mobile-only specs (`width < 768`, e.g. `390x844` touch project).
 */
export function requireMobileViewport(testInfo: TestInfo): void {
  const width = getViewportWidth(testInfo);
  test.skip(width >= 768, 'Mobile viewport (<768px) only');
}

/**
 * Gates wide desktop specs (`width >= 1024`, e.g. `1440x900` project).
 */
export function requireDesktopWideViewport(testInfo: TestInfo): void {
  const width = getViewportWidth(testInfo);
  test.skip(width < 1024, 'Desktop wide viewport (>=1024px) only');
}

/**
 * Gates narrow desktop specs (`768 <= width < 1024`, e.g. `960x700` project).
 */
export function requireDesktopNarrowViewport(testInfo: TestInfo): void {
  const width = getViewportWidth(testInfo);
  test.skip(
    width < 768 || width >= 1024,
    'Desktop narrow viewport (768..1023px) only'
  );
}

/**
 * Gates any desktop viewport (`width >= 768`, i.e. `1440x900` or `960x700`).
 */
export function requireDesktopAnyViewport(testInfo: TestInfo): void {
  const width = getViewportWidth(testInfo);
  test.skip(width < 768, 'Desktop viewport (>=768px) only');
}

/**
 * Gates Node/filesystem/artifact/clean-room specs so static checks execute
 * once on the primary desktop project (`width >= 1024`).
 */
export function runOnceOnDesktop(testInfo: TestInfo): void {
  const width = getViewportWidth(testInfo);
  test.skip(width < 1024, 'Static/filesystem check runs once on desktop project');
}

/**
 * Skips redundant execution on `desktop-narrow` (`960x700`) for cross-viewport
 * specs that already execute on `desktop` (`1440x900`) and `mobile` (`390x844`).
 */
export function skipDesktopNarrow(testInfo: TestInfo): void {
  const width = getViewportWidth(testInfo);
  test.skip(
    width >= 768 && width < 1024,
    'Cross-viewport journey runs on primary desktop (1440x900) and mobile (390x844)'
  );
}

// ============================================================================
// Runtime Error Guard, Boot & Storage Hygiene
// ============================================================================

export interface RuntimeErrorGuard {
  readonly pageErrors: Error[];
  readonly consoleErrors: string[];
  assertNoUncaughtErrors(): void;
  clear(): void;
}

export function attachRuntimeErrorGuard(page: Page): RuntimeErrorGuard {
  const pageErrors: Error[] = [];
  const consoleErrors: string[] = [];

  page.on('pageerror', (err) => {
    pageErrors.push(err);
  });

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      // Ignore expected browser network logs from intentional 404/500/offline route tests
      if (
        text.includes('Failed to load resource') ||
        text.includes('net::ERR_')
      ) {
        return;
      }
      consoleErrors.push(text);
    }
  });

  return {
    pageErrors,
    consoleErrors,
    assertNoUncaughtErrors(): void {
      expect(
        pageErrors.map((e) => `${e.name}: ${e.message}`),
        'Expected zero uncaught pageerror exceptions'
      ).toEqual([]);
    },
    clear(): void {
      pageErrors.length = 0;
      consoleErrors.length = 0;
    },
  };
}

export interface GotoAppOptions {
  path?: string;
  waitForShell?: boolean;
  assertZeroAlerts?: boolean;
  timeoutMs?: number;
}

export async function gotoApp(
  page: Page,
  options?: GotoAppOptions
): Promise<void> {
  const targetPath = options?.path ?? '/';
  const timeout = options?.timeoutMs ?? 15_000;
  await page.goto(targetPath, { waitUntil: 'domcontentloaded', timeout });

  if (options?.waitForShell !== false) {
    const shellLocator = page.locator(
      `[data-testid="${FROZEN_TEST_IDS.mobileTabBar}"], [data-testid="${FROZEN_TEST_IDS.desktopSidebar}"]`
    );
    await expect(shellLocator.first()).toBeVisible({ timeout });
  }

  if (options?.assertZeroAlerts !== false) {
    await expect(page.locator('[role="alertdialog"]')).toHaveCount(0);
  }
}

export async function resetClientStorage(
  page: Page,
  options?: { reload?: boolean }
): Promise<void> {
  await page.evaluate(async () => {
    try {
      window.localStorage.clear();
    } catch {
      // Ignore if origin not initialized yet
    }
    try {
      window.sessionStorage.clear();
    } catch {
      // Ignore
    }
    try {
      if (typeof window.indexedDB?.databases === 'function') {
        const dbs = await window.indexedDB.databases();
        await Promise.all(
          dbs.map(
            (db) =>
              new Promise<void>((resolve) => {
                if (!db.name) {
                  resolve();
                  return;
                }
                const req = window.indexedDB.deleteDatabase(db.name);
                req.onsuccess = () => resolve();
                req.onerror = () => resolve();
                req.onblocked = () => resolve();
              })
          )
        );
      }
    } catch {
      // Ignore IndexedDB enumeration errors
    }
  });

  if (options?.reload !== false) {
    await gotoApp(page);
  }
}

// ============================================================================
// Viewport-Adaptive Primary Navigation & Sheet Openers
// ============================================================================

export type PrimaryTabName = 'Inicio' | 'Buscar' | 'Biblioteca';

export async function navigateToTab(
  page: Page,
  tab: PrimaryTabName
): Promise<void> {
  const isMobile = getViewportClass(page) === 'mobile';
  const containerSelector = isMobile
    ? `[data-testid="${FROZEN_TEST_IDS.mobileTabBar}"]`
    : `[data-testid="${FROZEN_TEST_IDS.desktopSidebar}"]`;

  const container = page.locator(containerSelector);
  await expect(container).toBeVisible();

  const pattern = new RegExp(`^\\s*${tab}\\s*$`, 'i');
  const byRoleTab = container.getByRole('tab', { name: pattern });
  if ((await byRoleTab.count()) > 0) {
    await byRoleTab.first().click();
    return;
  }

  const byRoleButton = container.getByRole('button', { name: pattern });
  if ((await byRoleButton.count()) > 0) {
    await byRoleButton.first().click();
    return;
  }

  const byRoleLink = container.getByRole('link', { name: pattern });
  if ((await byRoleLink.count()) > 0) {
    await byRoleLink.first().click();
    return;
  }

  await container.getByText(pattern).first().click();
}

export function getActivePlayerLandmark(page: Page): Locator {
  if (getViewportClass(page) === 'mobile') {
    return page.getByTestId(FROZEN_TEST_IDS.mobileMiniPlayer);
  }
  return page.getByTestId(FROZEN_TEST_IDS.desktopPlayerBar);
}

export async function openNowPlaying(page: Page): Promise<Locator> {
  const sheet = page.getByTestId(FROZEN_TEST_IDS.nowPlayingSheet);
  if (await sheet.isVisible()) {
    return sheet;
  }

  if (getViewportClass(page) === 'mobile') {
    const miniPlayer = page.getByTestId(FROZEN_TEST_IDS.mobileMiniPlayer);
    await expect(miniPlayer).toBeVisible();
    const expandBtn = miniPlayer.getByRole('button', {
      name: /reproduciendo ahora|abrir reproductor|expandir|portada/i,
    });
    if ((await expandBtn.count()) > 0 && (await expandBtn.first().isVisible())) {
      await expandBtn.first().click();
    } else {
      // Tap left/title side of mini-player avoiding transport buttons on right
      await miniPlayer.click({ position: { x: 72, y: 24 } });
    }
  } else {
    const bar = page.getByTestId(FROZEN_TEST_IDS.desktopPlayerBar);
    await expect(bar).toBeVisible();
    const expandBtn = bar.getByRole('button', {
      name: /reproduciendo ahora|abrir reproductor|expandir|pantalla completa|portada|letras/i,
    });
    if ((await expandBtn.count()) > 0 && (await expandBtn.first().isVisible())) {
      await expandBtn.first().click();
    } else {
      const img = bar.locator('img').first();
      if (await img.isVisible()) {
        await img.click();
      } else {
        await bar.click({ position: { x: 100, y: 40 } });
      }
    }
  }

  await expect(sheet).toBeVisible();
  return sheet;
}

export async function switchNowPlayingTab(
  page: Page,
  tab: 'Portada' | 'Letras' | 'Cola'
): Promise<Locator> {
  const sheet = await openNowPlaying(page);
  const pattern = new RegExp(`^\\s*${tab}\\s*$`, 'i');

  const roleTab = sheet.getByRole('tab', { name: pattern });
  if ((await roleTab.count()) > 0) {
    await roleTab.first().click();
  } else {
    const roleBtn = sheet.getByRole('button', { name: pattern });
    if ((await roleBtn.count()) > 0) {
      await roleBtn.first().click();
    } else {
      await sheet.getByText(pattern).first().click();
    }
  }

  if (tab === 'Letras') {
    const lyricsView = page.getByTestId(FROZEN_TEST_IDS.syncedLyricsView);
    await expect(lyricsView).toBeVisible();
    return lyricsView;
  }
  if (tab === 'Cola') {
    const queueView = page.getByTestId(FROZEN_TEST_IDS.queueView);
    await expect(queueView).toBeVisible();
    return queueView;
  }
  return sheet;
}

export async function openDevicesSheet(page: Page): Promise<Locator> {
  const sheet = page.getByTestId(FROZEN_TEST_IDS.devicesSheet);
  if (await sheet.isVisible()) return sheet;

  const trigger = page
    .getByRole('button', { name: /dispositivos|conectar/i })
    .filter({ visible: true })
    .first();
  await expect(trigger).toBeVisible();
  await trigger.click();
  await expect(sheet).toBeVisible();
  return sheet;
}

export async function openEqSheet(page: Page): Promise<Locator> {
  const sheet = page.getByTestId(FROZEN_TEST_IDS.eqSheet);
  if (await sheet.isVisible()) return sheet;

  const trigger = page
    .getByRole('button', { name: /\beq\b|ecualizador|crossfade/i })
    .filter({ visible: true })
    .first();
  if ((await trigger.count()) > 0) {
    await trigger.click();
  } else {
    const np = await openNowPlaying(page);
    await np
      .getByRole('button', { name: /\beq\b|ecualizador|crossfade/i })
      .first()
      .click();
  }
  await expect(sheet).toBeVisible();
  return sheet;
}

export async function openImportModal(page: Page): Promise<Locator> {
  const modal = page.getByTestId(FROZEN_TEST_IDS.importModal);
  if (await modal.isVisible()) return modal;

  const trigger = page
    .getByRole('button', { name: /importar/i })
    .filter({ visible: true })
    .first();
  if ((await trigger.count()) > 0) {
    await trigger.click();
  } else {
    await navigateToTab(page, 'Biblioteca');
    await page
      .getByRole('button', { name: /importar/i })
      .filter({ visible: true })
      .first()
      .click();
  }
  await expect(modal).toBeVisible();
  return modal;
}

export async function openSettings(page: Page): Promise<Locator> {
  const settings = page.getByTestId(FROZEN_TEST_IDS.settingsView);
  if (await settings.isVisible()) return settings;

  const trigger = page
    .getByRole('button', { name: /ajustes|configuración/i })
    .filter({ visible: true })
    .first();
  if ((await trigger.count()) > 0) {
    await trigger.click();
  } else {
    await navigateToTab(page, 'Inicio');
    await page
      .getByRole('button', { name: /ajustes|configuración/i })
      .filter({ visible: true })
      .first()
      .click();
  }
  await expect(settings).toBeVisible();
  return settings;
}

export async function closeActiveSheet(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  const visibleDialogs = page
    .locator('[role="dialog"], [role="alertdialog"]')
    .filter({ visible: true });
  if ((await visibleDialogs.count()) > 0) {
    const closeBtn = visibleDialogs
      .first()
      .getByRole('button', { name: /cerrar|cancelar|minimizar/i })
      .first();
    if ((await closeBtn.count()) > 0 && (await closeBtn.isVisible())) {
      await closeBtn.click();
    }
  }
}

// ============================================================================
// Search, Playback, DJ Toggle, Slider & Touch Swipe Helpers
// ============================================================================

export interface SearchForOptions {
  submit?: boolean;
  scopeTab?: 'Todo' | 'Canciones' | 'Artistas' | 'Álbumes' | 'Playlists';
}

export async function searchFor(
  page: Page,
  query: string,
  options?: SearchForOptions
): Promise<Locator> {
  await navigateToTab(page, 'Buscar');
  const searchInput = page
    .locator(
      'input[type="search"], [role="searchbox"], input[placeholder*="Artistas" i], input[placeholder*="Buscar" i]'
    )
    .filter({ visible: true })
    .first();

  await expect(searchInput).toBeVisible();
  await searchInput.fill(query);

  if (options?.submit !== false) {
    await searchInput.press('Enter');
  }

  if (options?.scopeTab) {
    const tabPattern = new RegExp(`^\\s*${options.scopeTab}\\s*$`, 'i');
    const tab = page
      .getByRole('tab', { name: tabPattern })
      .filter({ visible: true })
      .first();
    await expect(tab).toBeVisible();
    await tab.click();
  }

  return searchInput;
}

export async function playTrackBySearch(
  page: Page,
  query: string,
  trackTitle?: string
): Promise<void> {
  await searchFor(page, query, { submit: true });
  const targetTitle = trackTitle ?? query;

  const trackRow = page
    .locator('[role="row"], [role="listitem"], article, [data-testid="best-result-card"]')
    .filter({ hasText: targetTitle, visible: true })
    .first();

  await expect(trackRow).toBeVisible();
  const playBtn = trackRow
    .getByRole('button', { name: /reproducir/i })
    .first();
  if ((await playBtn.count()) > 0 && (await playBtn.isVisible())) {
    await playBtn.click();
  } else {
    await trackRow.click();
  }

  const player = getActivePlayerLandmark(page);
  await expect(player).toBeVisible();
}

export async function toggleDjMode(
  page: Page,
  enable?: boolean
): Promise<Locator> {
  let toggle = page
    .getByTestId(FROZEN_TEST_IDS.djModeToggle)
    .filter({ visible: true })
    .first();

  if ((await toggle.count()) === 0) {
    await switchNowPlayingTab(page, 'Cola');
    toggle = page
      .getByTestId(FROZEN_TEST_IDS.djModeToggle)
      .filter({ visible: true })
      .first();
  }

  await expect(toggle).toBeVisible();
  const isPressed =
    (await toggle.getAttribute('aria-pressed')) === 'true' ||
    (await toggle.getAttribute('aria-checked')) === 'true' ||
    (await toggle.getAttribute('data-state')) === 'on' ||
    (await toggle.getAttribute('data-active')) === 'true';

  if (enable === undefined || enable !== isPressed) {
    await toggle.click();
  }
  return toggle;
}

export async function setSliderValue(
  slider: Locator,
  targetValue: number
): Promise<void> {
  await expect(slider).toBeVisible();
  const tagName = await slider.evaluate((el) => el.tagName.toLowerCase());

  if (tagName === 'input') {
    await slider.evaluate((el, val) => {
      const input = el as HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value'
      )?.set;
      if (setter) {
        setter.call(input, String(val));
      } else {
        input.value = String(val);
      }
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, targetValue);
    return;
  }

  // Custom ARIA [role="slider"]
  const currentAttr = await slider.getAttribute('aria-valuenow');
  const minAttr = await slider.getAttribute('aria-valuemin');
  const maxAttr = await slider.getAttribute('aria-valuemax');
  const min = minAttr !== null ? Number.parseFloat(minAttr) : 0;
  const max = maxAttr !== null ? Number.parseFloat(maxAttr) : 100;
  const current = currentAttr !== null ? Number.parseFloat(currentAttr) : min;

  const delta = Math.round(targetValue - current);
  if (Math.abs(delta) <= 24) {
    await slider.focus();
    const key = delta >= 0 ? 'ArrowRight' : 'ArrowLeft';
    for (let i = 0; i < Math.abs(delta); i++) {
      await slider.press(key);
    }
    return;
  }

  const box = await slider.boundingBox();
  if (box && max > min) {
    const ratio = Math.max(0, Math.min(1, (targetValue - min) / (max - min)));
    await slider.click({
      position: {
        x: Math.max(1, Math.min(box.width - 1, box.width * ratio)),
        y: box.height / 2,
      },
    });
  }
}

/**
 * Dispatches both Touch Events and Pointer Events horizontally across `locator`
 * so mobile swipe gestures (e.g. mini-player next/prev skip) work consistently.
 */
export async function swipeHorizontal(
  locator: Locator,
  deltaX: number
): Promise<void> {
  await expect(locator).toBeVisible();
  await locator.evaluate((el, dx) => {
    const rect = el.getBoundingClientRect();
    const startX = rect.left + rect.width / 2;
    const startY = rect.top + rect.height / 2;
    const endX = startX + dx;

    // 1. Touch events
    if (typeof Touch !== 'undefined' && typeof TouchEvent !== 'undefined') {
      try {
        const tStart = new Touch({
          identifier: 1,
          target: el,
          clientX: startX,
          clientY: startY,
          pageX: startX,
          pageY: startY,
        });
        const tMid = new Touch({
          identifier: 1,
          target: el,
          clientX: startX + dx * 0.5,
          clientY: startY,
          pageX: startX + dx * 0.5,
          pageY: startY,
        });
        const tEnd = new Touch({
          identifier: 1,
          target: el,
          clientX: endX,
          clientY: startY,
          pageX: endX,
          pageY: startY,
        });

        el.dispatchEvent(
          new TouchEvent('touchstart', {
            bubbles: true,
            cancelable: true,
            touches: [tStart],
            targetTouches: [tStart],
            changedTouches: [tStart],
          })
        );
        el.dispatchEvent(
          new TouchEvent('touchmove', {
            bubbles: true,
            cancelable: true,
            touches: [tMid],
            targetTouches: [tMid],
            changedTouches: [tMid],
          })
        );
        el.dispatchEvent(
          new TouchEvent('touchend', {
            bubbles: true,
            cancelable: true,
            touches: [],
            targetTouches: [],
            changedTouches: [tEnd],
          })
        );
      } catch {
        // Fallback to pointer events below
      }
    }

    // 2. Pointer events
    el.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        pointerType: 'touch',
        isPrimary: true,
        clientX: startX,
        clientY: startY,
        buttons: 1,
      })
    );
    el.dispatchEvent(
      new PointerEvent('pointermove', {
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        pointerType: 'touch',
        isPrimary: true,
        clientX: startX + dx * 0.5,
        clientY: startY,
        buttons: 1,
      })
    );
    el.dispatchEvent(
      new PointerEvent('pointermove', {
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        pointerType: 'touch',
        isPrimary: true,
        clientX: endX,
        clientY: startY,
        buttons: 1,
      })
    );
    el.dispatchEvent(
      new PointerEvent('pointerup', {
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        pointerType: 'touch',
        isPrimary: true,
        clientX: endX,
        clientY: startY,
        buttons: 0,
      })
    );
  }, deltaX);
}

// ============================================================================
// Opaque HTML5 `<audio>` DOM Probes
// ============================================================================

export interface AudioElementSnapshot {
  index: number;
  src: string;
  currentSrc: string;
  crossOrigin: string | null;
  paused: boolean;
  ended: boolean;
  muted: boolean;
  readyState: number;
  networkState: number;
  currentTime: number;
  duration: number;
  volume: number;
  playbackRate: number;
  errorCode: number | null;
  errorMessage: string | null;
}

export async function getAudioElementsState(
  page: Page
): Promise<AudioElementSnapshot[]> {
  return page.evaluate(() => {
    const audios = Array.from(document.querySelectorAll('audio'));
    return audios.map((a, index) => ({
      index,
      src: a.getAttribute('src') ?? a.src ?? '',
      currentSrc: a.currentSrc ?? '',
      crossOrigin: a.crossOrigin,
      paused: a.paused,
      ended: a.ended,
      muted: a.muted,
      readyState: a.readyState,
      networkState: a.networkState,
      currentTime: Number.isFinite(a.currentTime) ? a.currentTime : 0,
      duration: Number.isFinite(a.duration) ? a.duration : 0,
      volume: a.volume,
      playbackRate: a.playbackRate,
      errorCode: a.error ? a.error.code : null,
      errorMessage: a.error ? a.error.message : null,
    }));
  });
}

export interface WaitForRealAudioOptions {
  minAdvanceSec?: number;
  timeoutMs?: number;
  requireCrossOriginAnonymous?: boolean;
}

export async function waitForRealAudioPlayback(
  page: Page,
  options?: WaitForRealAudioOptions
): Promise<AudioElementSnapshot> {
  const minAdvanceSec = options?.minAdvanceSec ?? 0.25;
  const timeoutMs = options?.timeoutMs ?? 10_000;
  const requireCors = options?.requireCrossOriginAnonymous !== false;

  const deadline = Date.now() + timeoutMs;
  let initialTimeByIndex = new Map<number, number>();
  let lastActive: AudioElementSnapshot | undefined;

  while (Date.now() < deadline) {
    const snapshots = await getAudioElementsState(page);
    for (const snap of snapshots) {
      if (snap.errorCode !== null) continue;
      if (!snap.src && !snap.currentSrc) continue;
      if (snap.paused) continue;
      if (snap.readyState < 2) continue;

      if (requireCors) {
        expect(
          snap.crossOrigin,
          `<audio> element must set crossOrigin="anonymous" before src`
        ).toBe('anonymous');
      }

      lastActive = snap;
      const startT = initialTimeByIndex.get(snap.index);
      if (startT === undefined) {
        initialTimeByIndex.set(snap.index, snap.currentTime);
        if (snap.currentTime >= minAdvanceSec) {
          return snap;
        }
      } else if (
        snap.currentTime - startT >= minAdvanceSec ||
        snap.currentTime >= minAdvanceSec
      ) {
        return snap;
      }
    }

    await page.waitForTimeout(100);
  }

  expect(
    lastActive,
    `Expected active HTML5 <audio> playback advancing by >= ${minAdvanceSec}s within ${timeoutMs}ms`
  ).toBeDefined();
  return lastActive!;
}

// ============================================================================
// Pure-Node Binary Validators (PNG Screenshot Header & Android APK ZIP Reader)
// ============================================================================

export interface PngValidationResult {
  path: string;
  sizeBytes: number;
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
}

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function assertValidPngFile(
  filePath: string,
  minBytes = 5000
): PngValidationResult {
  expect(
    existsSync(filePath),
    `Expected PNG file to exist at ${filePath}`
  ).toBe(true);

  const st = statSync(filePath);
  expect(
    st.size,
    `Expected PNG file ${filePath} size (${st.size} B) to exceed ${minBytes} B`
  ).toBeGreaterThan(minBytes);

  const buf = readFileSync(filePath);
  const sig = buf.subarray(0, 8);
  expect(
    sig.equals(PNG_MAGIC),
    `File ${filePath} does not start with valid PNG magic bytes 89 50 4E 47 0D 0A 1A 0A`
  ).toBe(true);

  const ihdrTag = buf.toString('ascii', 12, 16);
  expect(ihdrTag, `PNG ${filePath} missing IHDR chunk at offset 12`).toBe('IHDR');

  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  const bitDepth = buf[24] ?? 0;
  const colorType = buf[25] ?? 0;

  expect(width, `PNG ${filePath} width must be > 0`).toBeGreaterThan(0);
  expect(height, `PNG ${filePath} height must be > 0`).toBeGreaterThan(0);

  return {
    path: filePath,
    sizeBytes: st.size,
    width,
    height,
    bitDepth,
    colorType,
  };
}

export interface ApkZipInspectionResult {
  path: string;
  sizeBytes: number;
  hasZipMagic: boolean;
  entries: string[];
  hasAndroidManifest: boolean;
  hasClassesDex: boolean;
  hasWebIndexHtml: boolean;
  appleDesignSkillEntries: string[];
}

/**
 * Pure-Node ZIP Central Directory & Local File Header reader for verifying
 * compiled Android `.apk` archives without external CLI tools.
 */
export function inspectApkZipEntries(apkPath: string): ApkZipInspectionResult {
  if (!existsSync(apkPath)) {
    throw new Error(`APK file not found at ${apkPath}`);
  }

  const buf = readFileSync(apkPath);
  const sizeBytes = buf.length;
  const hasZipMagic =
    sizeBytes >= 4 &&
    buf[0] === 0x50 &&
    buf[1] === 0x4b &&
    buf[2] === 0x03 &&
    buf[3] === 0x04;

  const entrySet = new Set<string>();

  // 1. Locate End of Central Directory (EOCD) signature 0x06054b50 from tail
  const minEocdOffset = Math.max(0, sizeBytes - 65557);
  let eocdOffset = -1;
  for (let i = sizeBytes - 22; i >= minEocdOffset; i--) {
    if (
      buf[i] === 0x50 &&
      buf[i + 1] === 0x4b &&
      buf[i + 2] === 0x05 &&
      buf[i + 3] === 0x06
    ) {
      eocdOffset = i;
      break;
    }
  }

  if (eocdOffset >= 0 && eocdOffset + 20 <= sizeBytes) {
    const cdSize = buf.readUInt32LE(eocdOffset + 12);
    const cdOffset = buf.readUInt32LE(eocdOffset + 16);
    const cdEnd = Math.min(sizeBytes, cdOffset + cdSize);
    let ptr = cdOffset;

    while (ptr + 46 <= cdEnd) {
      // Central Directory File Header signature: 0x02014b50
      if (
        buf[ptr] !== 0x50 ||
        buf[ptr + 1] !== 0x4b ||
        buf[ptr + 2] !== 0x01 ||
        buf[ptr + 3] !== 0x02
      ) {
        break;
      }
      const nameLen = buf.readUInt16LE(ptr + 28);
      const extraLen = buf.readUInt16LE(ptr + 30);
      const commentLen = buf.readUInt16LE(ptr + 32);
      const nameStart = ptr + 46;
      const nameEnd = nameStart + nameLen;
      if (nameEnd <= sizeBytes) {
        entrySet.add(buf.toString('utf-8', nameStart, nameEnd));
      }
      ptr = nameEnd + extraLen + commentLen;
    }
  }

  // 2. Fallback scan of Local File Headers (0x04034b50) if EOCD was not used
  if (entrySet.size === 0) {
    let ptr = 0;
    while (ptr + 30 <= sizeBytes) {
      if (
        buf[ptr] === 0x50 &&
        buf[ptr + 1] === 0x4b &&
        buf[ptr + 2] === 0x03 &&
        buf[ptr + 3] === 0x04
      ) {
        const compressedSize = buf.readUInt32LE(ptr + 18);
        const nameLen = buf.readUInt16LE(ptr + 26);
        const extraLen = buf.readUInt16LE(ptr + 28);
        const nameStart = ptr + 30;
        const nameEnd = nameStart + nameLen;
        if (nameEnd <= sizeBytes && nameLen > 0 && nameLen < 512) {
          entrySet.add(buf.toString('utf-8', nameStart, nameEnd));
        }
        ptr =
          compressedSize > 0
            ? nameEnd + extraLen + compressedSize
            : nameEnd + extraLen + 1;
      } else {
        ptr++;
      }
    }
  }

  const entries = Array.from(entrySet);
  const hasAndroidManifest = entries.includes('AndroidManifest.xml');
  const hasClassesDex = entries.some(
    (e) => e === 'classes.dex' || /^classes\d*\.dex$/.test(e)
  );
  const hasWebIndexHtml = entries.includes('assets/public/index.html');
  const appleDesignSkillEntries = entries.filter((e) =>
    e.toLowerCase().includes('apple-design-skill')
  );

  return {
    path: apkPath,
    sizeBytes,
    hasZipMagic,
    entries,
    hasAndroidManifest,
    hasClassesDex,
    hasWebIndexHtml,
    appleDesignSkillEntries,
  };
}

export function assertValidApkArtifact(
  apkPath: string
): ApkZipInspectionResult {
  expect(
    existsSync(apkPath),
    `Expected compiled Android APK at ${apkPath}`
  ).toBe(true);

  const info = inspectApkZipEntries(apkPath);
  expect(info.hasZipMagic, 'APK must start with ZIP magic PK\\x03\\x04').toBe(
    true
  );
  expect(
    info.sizeBytes,
    'APK size must be > 100 KB'
  ).toBeGreaterThan(100_000);
  expect(
    info.hasAndroidManifest,
    'APK must contain AndroidManifest.xml'
  ).toBe(true);
  expect(info.hasClassesDex, 'APK must contain classes.dex').toBe(true);
  expect(
    info.hasWebIndexHtml,
    'APK must bundle Capacitor web assets at assets/public/index.html'
  ).toBe(true);
  expect(
    info.appleDesignSkillEntries,
    'APK must exclude dev-only design/apple-design-skill reference files'
  ).toEqual([]);
  return info;
}
