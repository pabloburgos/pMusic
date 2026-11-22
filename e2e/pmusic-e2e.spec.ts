import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import {
  FROZEN_TEST_IDS,
  assertValidApkArtifact,
  assertValidPngFile,
  attachRuntimeErrorGuard,
  getViewportClass,
  gotoApp,
  navigateToTab,
  openDevicesSheet,
  openEqSheet,
  openImportModal,
  openNowPlaying,
  openSettings,
  playTrackBySearch,
  requireDesktopNarrowViewport,
  requireDesktopWideViewport,
  requireMobileViewport,
  runOnceOnDesktop,
  searchFor,
  skipDesktopNarrow,
  switchNowPlayingTab,
  toggleDjMode,
  waitForRealAudioPlayback,
} from './fixtures/test-helpers.ts';
import {
  assertBrightMediaScrim,
  assertHitTargets,
  assertLiquidGlass,
  assertNoHorizontalOverflow,
  assertReducedMotion,
  assertReducedTransparency,
  assertZeroLinerDom,
  assertZeroLinerSourceTree,
  emulateAccessibilityMedia,
} from './fixtures/hig-audit.ts';

test.describe('pMusic E2E & Apple HIG (dickwu/apple-design-skill) Verification Suite', () => {
  test('Clean-room Zero-Liner audit, compiled Android APK verification, and Desktop icon validation', async ({
    page,
  }, testInfo) => {
    runOnceOnDesktop(testInfo);

    // 1. Source tree clean-room check (zero Liner traces)
    const sourceReport = assertZeroLinerSourceTree('/home/antigravity/pMusic');
    expect(sourceReport.scannedCount).toBeGreaterThanOrEqual(20);

    // 2. Compiled Android APK artifact verification
    const apkPath = resolve(
      '/home/antigravity/pMusic/apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk'
    );
    const apkInfo = assertValidApkArtifact(apkPath);
    expect(apkInfo.hasAndroidManifest).toBe(true);
    expect(apkInfo.hasClassesDex).toBe(true);
    expect(apkInfo.hasWebIndexHtml).toBe(true);

    // 3. Compiled Desktop brand PNG icon verification
    const iconPath = resolve('/home/antigravity/pMusic/apps/desktop/build/icon.png');
    const pngInfo = assertValidPngFile(iconPath, 500);
    expect(pngInfo.width).toBe(256);
    expect(pngInfo.height).toBe(256);

    // 4. Rendered DOM clean-room check
    await gotoApp(page);
    await assertZeroLinerDom(page);
  });

  test('Apple HIG Liquid Glass, Hit Targets, and Zero Horizontal Overflow audit across viewports', async ({
    page,
  }) => {
    const guard = attachRuntimeErrorGuard(page);
    await gotoApp(page);

    await assertNoHorizontalOverflow(page);
    await assertLiquidGlass(page);
    await assertHitTargets(page);

    // Verify Reduced Transparency & Reduced Motion via CDP + Modo ahorro gráfico
    const mediaCtrl = await emulateAccessibilityMedia(page, {
      reducedTransparency: 'reduce',
      reducedMotion: 'reduce',
    });
    await page.evaluate(
      () =>
        new Promise<void>((r) => {
          document.documentElement.classList.add('pm-reduced-transparency', 'pm-reduced-motion');
          requestAnimationFrame(() => requestAnimationFrame(() => r()));
        })
    );
    await assertReducedTransparency(page);
    await assertReducedMotion(page);
    await page.evaluate(() => {
      document.documentElement.classList.remove('pm-reduced-transparency', 'pm-reduced-motion');
    });
    await mediaCtrl.restore();

    guard.assertNoUncaughtErrors();
  });

  test('Mobile Navigation: Floating 3-Tab Glass Bar and Floating Mini-Player (<768px)', async ({
    page,
  }, testInfo) => {
    requireMobileViewport(testInfo);
    const guard = attachRuntimeErrorGuard(page);
    await gotoApp(page);

    await expect(page.getByTestId(FROZEN_TEST_IDS.mobileTabBar)).toBeVisible();
    await expect(page.getByTestId(FROZEN_TEST_IDS.mobileMiniPlayer)).toBeVisible();
    await expect(page.getByTestId(FROZEN_TEST_IDS.desktopSidebar)).toHaveCount(0);

    await navigateToTab(page, 'Buscar');
    await expect(page.getByTestId(FROZEN_TEST_IDS.bestResultCard)).toBeVisible();

    await navigateToTab(page, 'Biblioteca');
    await expect(page.getByText(/Tus Playlists/i).first()).toBeVisible();

    guard.assertNoUncaughtErrors();
  });

  test('Desktop Narrow Navigation: Auto-Collapsed 72px Sidebar (768..1023px)', async ({
    page,
  }, testInfo) => {
    requireDesktopNarrowViewport(testInfo);
    await gotoApp(page);

    const sidebar = page.getByTestId(FROZEN_TEST_IDS.desktopSidebar);
    await expect(sidebar).toBeVisible();
    const box = await sidebar.boundingBox();
    expect(box?.width).toBeLessThanOrEqual(80);
  });

  test('Desktop Wide Navigation: Expanded 248px Sidebar, Fixed 80px Player Bar, and Keyboard Shortcuts', async ({
    page,
  }, testInfo) => {
    requireDesktopWideViewport(testInfo);
    const guard = attachRuntimeErrorGuard(page);
    await gotoApp(page);

    const sidebar = page.getByTestId(FROZEN_TEST_IDS.desktopSidebar);
    const playerBar = page.getByTestId(FROZEN_TEST_IDS.desktopPlayerBar);
    await expect(sidebar).toBeVisible();
    await expect(playerBar).toBeVisible();

    const sidebarBox = await sidebar.boundingBox();
    expect(sidebarBox?.width).toBeGreaterThanOrEqual(240);

    // Press '/' shortcut to jump to Buscar
    await page.keyboard.press('/');
    await expect(page.getByTestId(FROZEN_TEST_IDS.bestResultCard)).toBeVisible();

    // Press 'l' shortcut to open Now Playing Synced Lyrics
    await page.keyboard.press('l');
    await expect(page.getByTestId(FROZEN_TEST_IDS.syncedLyricsView)).toBeVisible();

    // Press 'Escape' to close Now Playing sheet
    await page.keyboard.press('Escape');
    await expect(page.getByTestId(FROZEN_TEST_IDS.nowPlayingSheet)).toHaveCount(0);

    guard.assertNoUncaughtErrors();
  });

  test('Personalized Spanish Urban Search, Real CORS Audio Playback, Now Playing Scrim & Synced Lyrics', async ({
    page,
  }, testInfo) => {
    skipDesktopNarrow(testInfo);
    const guard = attachRuntimeErrorGuard(page);
    await gotoApp(page);

    // Search for Cruz Cafuné and verify Mejor resultado card
    await searchFor(page, 'Cruz Cafuné', { submit: true });
    const bestCard = page.getByTestId(FROZEN_TEST_IDS.bestResultCard);
    await expect(bestCard).toBeVisible();
    await expect(bestCard).toContainText(/Cruz Cafuné/i);

    // Play track and verify real HTML5 <audio crossOrigin="anonymous"> playback advances
    await playTrackBySearch(page, 'Me Muevo Con Dios', 'Me Muevo Con Dios');
    const audioSnap = await waitForRealAudioPlayback(page, {
      minAdvanceSec: 0.15,
      timeoutMs: 8_000,
    });
    expect(audioSnap.crossOrigin).toBe('anonymous');
    expect(audioSnap.paused).toBe(false);

    // Open Now Playing sheet and verify Bright Media Scrim >= 35%
    const npSheet = await openNowPlaying(page);
    await expect(npSheet).toBeVisible();
    const scrimReport = await assertBrightMediaScrim(page);
    expect(scrimReport.effectiveScrimAlpha).toBeGreaterThanOrEqual(0.35);

    // Switch to Synced Lyrics and tap a line to seek
    const lyricsView = await switchNowPlayingTab(page, 'Letras');
    await expect(lyricsView).toBeVisible();
    const lyricButtons = lyricsView.locator('button[data-lyric-state]');
    expect(await lyricButtons.count()).toBeGreaterThan(2);
    await lyricButtons.nth(1).click();

    guard.assertNoUncaughtErrors();
  });

  test('Modo Sesión DJ (AutoMix): Quick (45-90s) vs Full Session, BPM Badges, FX Toggles, and 5-Band EQ', async ({
    page,
  }, testInfo) => {
    skipDesktopNarrow(testInfo);
    const guard = attachRuntimeErrorGuard(page);
    await gotoApp(page);

    // Open Now Playing -> Cola & Modo Sesión DJ
    const queueView = await switchNowPlayingTab(page, 'Cola');
    await expect(queueView).toBeVisible();

    const djToggle = await toggleDjMode(page, true);
    await expect(djToggle).toHaveAttribute('aria-pressed', 'true');

    const quickBtn = page.getByTestId(FROZEN_TEST_IDS.djStyleQuick);
    const fullBtn = page.getByTestId(FROZEN_TEST_IDS.djStyleFull);
    await expect(quickBtn).toBeVisible();
    await expect(fullBtn).toBeVisible();

    await fullBtn.click();
    await expect(fullBtn).toHaveAttribute('aria-pressed', 'true');
    await quickBtn.click();
    await expect(quickBtn).toHaveAttribute('aria-pressed', 'true');

    // Close Now Playing and open 5-Band EQ & Crossfade sheet
    await page.keyboard.press('Escape');
    const eqSheet = await openEqSheet(page);
    await expect(eqSheet).toBeVisible();
    await eqSheet.getByRole('button', { name: /Urbano \/ Graves/i }).click();
    await page.keyboard.press('Escape');

    guard.assertNoUncaughtErrors();
  });

  test('pMusic Connect (Dispositivos), Spotify/YouTube Playlist Importer, Offline Download & Settings', async ({
    page,
  }, testInfo) => {
    skipDesktopNarrow(testInfo);
    const guard = attachRuntimeErrorGuard(page);
    await gotoApp(page);

    // 1. Dispositivos sheet: 1-tap exact-second transfer to companion device
    const devicesSheet = await openDevicesSheet(page);
    await expect(devicesSheet).toBeVisible();
    const transferBtn = devicesSheet.getByRole('button', { name: /Transferir aquí/i }).first();
    await expect(transferBtn).toBeVisible();
    await transferBtn.click();
    await expect(devicesSheet.getByText(/Transferido a/i)).toBeVisible();
    await page.keyboard.press('Escape');

    // 2. Playlist Importer modal: import Spotify Urbano ES example and save to Library
    const importModal = await openImportModal(page);
    await expect(importModal).toBeVisible();
    await importModal.getByRole('button', { name: /Probar ejemplo Spotify Urbano ES/i }).click();
    const saveBtn = importModal.getByRole('button', { name: /Guardar en Biblioteca/i });
    await expect(saveBtn).toBeVisible();
    await saveBtn.click();

    // Verify imported playlist appears in Biblioteca
    await expect(page.getByText(/Éxitos Urbano España|Trap Canarias/i).first()).toBeVisible();

    // 3. Settings modal: verify Spanish urban seed artists & Supabase setup fields
    if (getViewportClass(page) === 'mobile') {
      await navigateToTab(page, 'Inicio');
    }
    const settingsModal = await openSettings(page);
    await expect(settingsModal).toBeVisible();
    await expect(settingsModal).toContainText(/Bad Bunny/i);
    await expect(settingsModal).toContainText(/La Pantera/i);
    await expect(settingsModal).toContainText(/Cruz Cafuné/i);

    guard.assertNoUncaughtErrors();
  });
});
