export const APP_VERSION = '0.24.8';

const OTA_MANIFEST_URL =
  'https://raw.githubusercontent.com/pabloburgos/pMusic/main/ota/latest.json';
const GITHUB_LATEST_RELEASE_URL =
  'https://api.github.com/repos/pabloburgos/pMusic/releases/latest';
const RAW_DESKTOP_PKG_URL =
  'https://raw.githubusercontent.com/pabloburgos/pMusic/main/apps/desktop/package.json';
const WEB_RELOAD_GUARD_KEY = 'pmusic_web_updated_version_v1';

export interface SplashUpdateState {
  updating: boolean;
  message?: string;
  percent?: number;
}

export function compareSemver(remoteRaw: string, localRaw: string): number {
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

async function fetchLatestReleaseInfo(timeoutMs = 3200): Promise<{
  version: string;
  minNativeVersion?: string;
  bundleUrl?: string;
  apkUrl?: string;
  exeUrl?: string;
} | null> {
  if (typeof fetch !== 'function') return null;

  // 1. Primary fast OTA manifest (enables in-splash instant updates on Android & Windows)
  const acOta = new AbortController();
  const tOta = setTimeout(() => acOta.abort(), timeoutMs);
  try {
    const otaRes = await fetch(`${OTA_MANIFEST_URL}?t=${Date.now()}`, {
      signal: acOta.signal,
      cache: 'no-store',
    });
    if (otaRes.ok) {
      const ota = (await otaRes.json()) as {
        version?: string;
        minNativeVersion?: string;
        bundleUrl?: string;
        apkUrl?: string;
        exeUrl?: string;
      };
      if (ota?.version) {
        return {
          version: ota.version.trim().replace(/^v/i, ''),
          minNativeVersion: ota.minNativeVersion?.trim().replace(/^v/i, ''),
          bundleUrl: ota.bundleUrl,
          apkUrl: ota.apkUrl,
          exeUrl: ota.exeUrl,
        };
      }
    }
  } catch {
    // Fall back to GitHub Releases / raw package.json
  } finally {
    clearTimeout(tOta);
  }

  // 2. GitHub Releases API fallback (for native binary upgrades)
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(GITHUB_LATEST_RELEASE_URL, {
      signal: ac.signal,
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (res.ok) {
      const data = (await res.json()) as {
        tag_name?: string;
        assets?: Array<{ name?: string; browser_download_url?: string }>;
      };
      const tag = (data?.tag_name ?? '').trim();
      if (tag) {
        const assets = Array.isArray(data.assets) ? data.assets : [];
        const apk = assets.find((a) => /android.*\.apk$|^pMusic-Android\.apk$/i.test(a.name ?? ''));
        const exe = assets.find((a) => /pMusic-Setup.*\.exe$/i.test(a.name ?? ''));
        return {
          version: tag.replace(/^v/i, ''),
          apkUrl: apk?.browser_download_url,
          exeUrl: exe?.browser_download_url,
        };
      }
    }
  } catch {
    // Fallback to raw package.json check
  } finally {
    clearTimeout(timer);
  }

  const ac2 = new AbortController();
  const t2 = setTimeout(() => ac2.abort(), 1100);
  try {
    const pkgRes = await fetch(RAW_DESKTOP_PKG_URL, { signal: ac2.signal });
    if (pkgRes.ok) {
      const pkg = (await pkgRes.json()) as { version?: string };
      if (pkg?.version) {
        return { version: pkg.version.trim().replace(/^v/i, '') };
      }
    }
  } catch {
    // ignore offline/timeout
  } finally {
    clearTimeout(t2);
  }

  return null;
}

export function setSplashUpdateBanner(statusText: string | null, percent?: number): void {
  if (typeof document === 'undefined') return;
  const statusEl = document.getElementById('pm-splash-status');
  const barEl = document.getElementById('pm-splash-update-bar');
  const fillEl = document.getElementById('pm-splash-update-fill');
  if (statusEl) {
    statusEl.textContent = statusText ?? '';
    statusEl.style.display = statusText ? 'block' : 'none';
  }
  if (barEl && fillEl) {
    if (typeof percent === 'number' && statusText) {
      barEl.style.display = 'block';
      fillEl.style.width = `${Math.max(4, Math.min(100, Math.round(percent)))}%`;
    } else {
      barEl.style.display = 'none';
    }
  }
}

export async function runSplashAutoUpdateCheck(
  onStateChange?: (state: SplashUpdateState) => void
): Promise<{ updating: boolean }> {
  if (
    typeof window === 'undefined' ||
    (typeof navigator !== 'undefined' && navigator.onLine === false)
  ) {
    return { updating: false };
  }

  const win = window as unknown as {
    pmusicDesktop?: {
      checkAndApplyUpdate?: (
        currentWebVersion?: string
      ) => Promise<{ updated: boolean; version?: string }>;
      onUpdateProgress?: (
        cb: (p: { phase?: string; version?: string; percent?: number; message?: string }) => void
      ) => () => void;
    };
    PMusicNative?: {
      getNativeVersion?: () => string;
      downloadAndInstallOtaBundle?: (zipUrl: string, version: string) => boolean;
      downloadAndInstallUpdate?: (apkUrl: string, version: string) => boolean;
    };
    __pmusicUpdateProgress?: (percent: number, message: string) => void;
  };

  // 1. Electron Desktop native / OTA updater
  if (win.pmusicDesktop?.checkAndApplyUpdate) {
    let unsub: (() => void) | undefined;
    try {
      unsub = win.pmusicDesktop.onUpdateProgress?.((p) => {
        const msg = p.message || `Actualización v${p.version ?? ''} · Instalando…`;
        const pct = typeof p.percent === 'number' ? p.percent : 15;
        onStateChange?.({ updating: true, message: msg, percent: pct });
        setSplashUpdateBanner(msg, pct);
      });
      const res = await win.pmusicDesktop.checkAndApplyUpdate(APP_VERSION);
      if (res?.updated) {
        return { updating: true };
      }
      return { updating: false };
    } catch {
      return { updating: false };
    } finally {
      unsub?.();
    }
  }

  // 2. Android / Web fast release & OTA check
  const remote = await fetchLatestReleaseInfo(3200);
  if (!remote || compareSemver(remote.version, APP_VERSION) <= 0) {
    return { updating: false };
  }

  // Android WebView OTA bundle (installs right inside splash without APK reinstall)
  const nativeVer = win.PMusicNative?.getNativeVersion?.() ?? APP_VERSION;
  const nativeCompatible =
    !remote.minNativeVersion || compareSemver(remote.minNativeVersion, nativeVer) <= 0;
  if (win.PMusicNative?.downloadAndInstallOtaBundle && remote.bundleUrl && nativeCompatible) {
    const msg = `Actualización v${remote.version} · Descargando…`;
    onStateChange?.({ updating: true, message: msg, percent: 8 });
    setSplashUpdateBanner(msg, 8);
    win.__pmusicUpdateProgress = (pct: number, customMsg?: string) => {
      const m = customMsg || msg;
      onStateChange?.({ updating: true, message: m, percent: pct });
      setSplashUpdateBanner(m, pct);
    };
    try {
      const started = win.PMusicNative.downloadAndInstallOtaBundle(
        remote.bundleUrl,
        remote.version
      );
      if (started) {
        return { updating: true };
      }
    } catch {
      // fall through
    }
    return { updating: false };
  }

  // Android native APK download & install prompt (only when minNativeVersion requires APK upgrade)
  if (win.PMusicNative?.downloadAndInstallUpdate && remote.apkUrl) {
    const msg = `Actualizando a pMusic v${remote.version}…`;
    onStateChange?.({ updating: true, message: msg, percent: 8 });
    setSplashUpdateBanner(msg, 8);
    win.__pmusicUpdateProgress = (pct: number, customMsg?: string) => {
      const m = customMsg || msg;
      onStateChange?.({ updating: true, message: m, percent: pct });
      setSplashUpdateBanner(m, pct);
    };
    try {
      const started = win.PMusicNative.downloadAndInstallUpdate(remote.apkUrl, remote.version);
      if (started) {
        return { updating: true };
      }
    } catch {
      // fall through
    }
    return { updating: false };
  }

  // 3. Web browser cache bust once per new remote version
  try {
    const alreadyReloadedFor = sessionStorage.getItem(WEB_RELOAD_GUARD_KEY);
    if (alreadyReloadedFor !== remote.version && !window.location.hostname.includes('127.0.0.1')) {
      sessionStorage.setItem(WEB_RELOAD_GUARD_KEY, remote.version);
      onStateChange?.({
        updating: true,
        message: `Actualizando a pMusic v${remote.version}…`,
        percent: 70,
      });
      setSplashUpdateBanner(`Actualizando a pMusic v${remote.version}…`, 70);
      if (typeof caches !== 'undefined') {
        const names = await caches.keys();
        await Promise.all(names.map((n) => caches.delete(n).catch(() => false)));
      }
      setTimeout(() => window.location.reload(), 250);
      return { updating: true };
    }
  } catch {
    // ignore storage errors
  }

  return { updating: false };
}
