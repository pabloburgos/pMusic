import { defaultPlatformBridge } from '../platform/web-bridge.ts';
import { upgradeCoverUrlToHd } from './image-opt.ts';

const OFFLINE_COVERS_DB_NAME = 'pmusic_offline_covers_v1';
const OFFLINE_COVERS_STORE = 'covers';
const MIN_HD_COVER_BYTES = 20_000;

interface StoredCoverEntry {
  key: string;
  trackId: string;
  coverUrl: string;
  blob: Blob;
  savedAt: number;
  hd?: boolean;
}

const memoryCoverUrls = new Map<string, string>();
const memoryCoverIsHd = new Map<string, boolean>();
const coverSavedListeners = new Set<(trackId: string) => void>();
let coverDbPromise: Promise<IDBDatabase | null> | null = null;

export function subscribeOfflineCoverSaved(listener: (trackId: string) => void): () => void {
  coverSavedListeners.add(listener);
  return () => {
    coverSavedListeners.delete(listener);
  };
}

function emitOfflineCoverSaved(trackId?: string): void {
  if (!trackId) return;
  for (const listener of coverSavedListeners) {
    try {
      listener(trackId);
    } catch {
      // ignore listener error
    }
  }
}

function isCoverBlobHd(blob: Blob, markedHd?: boolean): boolean {
  if (markedHd === true && blob.size >= MIN_HD_COVER_BYTES) return true;
  return blob.size >= MIN_HD_COVER_BYTES;
}

export function normalizeCoverKey(url?: string | null): string {
  const raw = (url ?? '').trim();
  if (!raw || raw.startsWith('data:') || raw.startsWith('blob:')) return '';
  try {
    const parsed = new URL(raw);
    return `${parsed.origin}${parsed.pathname}${parsed.search}`.toLowerCase();
  } catch {
    return raw.toLowerCase();
  }
}

function registerMemoryCover(
  trackId: string | undefined,
  coverUrl: string | undefined | null,
  blob: Blob,
  hd?: boolean
): string | null {
  if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return null;
  try {
    const objUrl = URL.createObjectURL(blob);
    const isHd = isCoverBlobHd(blob, hd);
    if (trackId) {
      const prev = memoryCoverUrls.get(`track:${trackId}`);
      if (prev && prev !== objUrl) {
        try {
          URL.revokeObjectURL(prev);
        } catch {
          // ignore
        }
      }
      memoryCoverUrls.set(`track:${trackId}`, objUrl);
      memoryCoverIsHd.set(`track:${trackId}`, isHd);
    }
    const norm = normalizeCoverKey(coverUrl);
    if (norm) {
      memoryCoverUrls.set(`url:${norm}`, objUrl);
      memoryCoverIsHd.set(`url:${norm}`, isHd);
    }
    emitOfflineCoverSaved(trackId);
    return objUrl;
  } catch {
    return null;
  }
}

function openCoverDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  if (coverDbPromise) return coverDbPromise;
  coverDbPromise = new Promise<IDBDatabase | null>((resolve) => {
    try {
      const req = indexedDB.open(OFFLINE_COVERS_DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(OFFLINE_COVERS_STORE)) {
          db.createObjectStore(OFFLINE_COVERS_STORE, { keyPath: 'key' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return coverDbPromise;
}

export function getCachedOfflineCoverUrl(
  trackId?: string,
  coverUrl?: string | null,
  opts?: { requireHd?: boolean }
): string | null {
  const requireHd = Boolean(opts?.requireHd);
  if (trackId) {
    const byId = memoryCoverUrls.get(`track:${trackId}`);
    if (byId && (!requireHd || memoryCoverIsHd.get(`track:${trackId}`))) {
      return byId;
    }
  }
  const norm = normalizeCoverKey(coverUrl);
  if (norm) {
    const byUrl = memoryCoverUrls.get(`url:${norm}`);
    if (byUrl && (!requireHd || memoryCoverIsHd.get(`url:${norm}`))) {
      return byUrl;
    }
  }
  return null;
}

export async function resolveOfflineCoverUrl(
  trackId?: string,
  coverUrl?: string | null,
  opts?: { requireHd?: boolean }
): Promise<string | null> {
  const requireHd = Boolean(opts?.requireHd);
  const cached = getCachedOfflineCoverUrl(trackId, coverUrl, opts);
  if (cached) return cached;

  const db = await openCoverDb();
  if (!db) return null;

  const readByKey = (key: string) =>
    new Promise<StoredCoverEntry | null>((resolve) => {
      try {
        const tx = db.transaction(OFFLINE_COVERS_STORE, 'readonly');
        const req = tx.objectStore(OFFLINE_COVERS_STORE).get(key);
        req.onsuccess = () => resolve((req.result as StoredCoverEntry | undefined) ?? null);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });

  if (trackId) {
    const entry = await readByKey(`track:${trackId}`);
    if (entry?.blob) {
      const entryHd = isCoverBlobHd(entry.blob, entry.hd);
      if (!requireHd || entryHd) {
        return registerMemoryCover(trackId, entry.coverUrl || coverUrl, entry.blob, entryHd);
      }
    }
  }
  const norm = normalizeCoverKey(coverUrl);
  if (norm) {
    const entry = await readByKey(`url:${norm}`);
    if (entry?.blob) {
      const entryHd = isCoverBlobHd(entry.blob, entry.hd);
      if (!requireHd || entryHd) {
        return registerMemoryCover(trackId || entry.trackId, coverUrl, entry.blob, entryHd);
      }
    }
  }
  return null;
}

async function fetchCoverBlobWithFallback(coverUrl: string): Promise<Blob | null> {
  const clean = coverUrl.trim();
  if (!clean) return null;
  if (clean.startsWith('data:')) {
    try {
      const res = await fetch(clean);
      const blob = await res.blob();
      return blob.size > 64 ? blob : null;
    } catch {
      return null;
    }
  }

  try {
    const directRes = await fetch(clean, { mode: 'cors' });
    if (directRes.ok) {
      const blob = await directRes.blob();
      if (blob.size > 256) return blob;
    }
  } catch {
    // Fallback to CORS-safe local API proxy below
  }

  try {
    const [baseUrl, headers] = await Promise.all([
      defaultPlatformBridge.getApiBaseUrl(),
      defaultPlatformBridge.getAuthHeaders(),
    ]);
    const proxyUrl = `${baseUrl}/api/cover-proxy?url=${encodeURIComponent(clean)}`;
    const proxyRes = await fetch(proxyUrl, { headers });
    if (proxyRes.ok) {
      const blob = await proxyRes.blob();
      if (blob.size > 256) return blob;
    }
  } catch {
    // Ignore proxy failures when truly offline
  }

  return null;
}

export async function saveOfflineCover(
  trackId: string,
  coverUrl?: string | null
): Promise<boolean> {
  const rawClean = (coverUrl ?? '').trim();
  const cleanUrl = upgradeCoverUrlToHd(rawClean) || rawClean;
  if (!trackId || !cleanUrl) return false;

  if (typeof window !== 'undefined') {
    const nativeBridge = (window as unknown as {
      PMusicNative?: { saveOfflineCover?: (id: string, url: string) => void };
    }).PMusicNative;
    try {
      nativeBridge?.saveOfflineCover?.(trackId, cleanUrl);
    } catch {
      // ignore native bridge issues
    }
  }

  // Only skip if an HD cover is already stored for this track
  const existingMemHd = getCachedOfflineCoverUrl(trackId, cleanUrl, { requireHd: true });
  if (existingMemHd) return true;

  const existingDbHd = await resolveOfflineCoverUrl(trackId, cleanUrl, { requireHd: true });
  if (existingDbHd) return true;

  let blob = await fetchCoverBlobWithFallback(cleanUrl);
  if (!blob && rawClean && rawClean !== cleanUrl) {
    blob = await fetchCoverBlobWithFallback(rawClean);
  }
  if (!blob) {
    const anyExisting = await resolveOfflineCoverUrl(trackId, cleanUrl);
    return Boolean(anyExisting);
  }

  const hd = isCoverBlobHd(blob, true);
  // Never overwrite an already-HD cover with a low-res blob
  if (!hd && (memoryCoverIsHd.get(`track:${trackId}`) || getCachedOfflineCoverUrl(trackId, cleanUrl))) {
    return true;
  }

  registerMemoryCover(trackId, cleanUrl, blob, hd);
  if (rawClean && rawClean !== cleanUrl) {
    const rawNorm = normalizeCoverKey(rawClean);
    const objUrl = memoryCoverUrls.get(`track:${trackId}`);
    if (rawNorm && objUrl) {
      memoryCoverUrls.set(`url:${rawNorm}`, objUrl);
      memoryCoverIsHd.set(`url:${rawNorm}`, hd);
    }
  }

  const db = await openCoverDb();
  if (!db) return true;

  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(OFFLINE_COVERS_STORE, 'readwrite');
      const store = tx.objectStore(OFFLINE_COVERS_STORE);
      const now = Date.now();
      store.put({
        key: `track:${trackId}`,
        trackId,
        coverUrl: cleanUrl,
        blob,
        savedAt: now,
        hd,
      } satisfies StoredCoverEntry);
      const norm = normalizeCoverKey(cleanUrl);
      if (norm) {
        store.put({
          key: `url:${norm}`,
          trackId,
          coverUrl: cleanUrl,
          blob,
          savedAt: now,
          hd,
        } satisfies StoredCoverEntry);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });

  return true;
}

export async function hydrateOfflineCoversMemory(): Promise<void> {
  const db = await openCoverDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(OFFLINE_COVERS_STORE, 'readonly');
      const req = tx.objectStore(OFFLINE_COVERS_STORE).getAll();
      req.onsuccess = () => {
        const list = (req.result as StoredCoverEntry[] | undefined) ?? [];
        for (const item of list) {
          if (item?.blob && !memoryCoverUrls.has(item.key)) {
            registerMemoryCover(item.trackId, item.coverUrl, item.blob, item.hd);
          }
        }
        resolve();
      };
      req.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function deleteOfflineCover(trackId: string): Promise<void> {
  if (!trackId) return;
  const existing = memoryCoverUrls.get(`track:${trackId}`);
  if (existing) {
    memoryCoverUrls.delete(`track:${trackId}`);
    try {
      URL.revokeObjectURL(existing);
    } catch {
      // ignore
    }
  }
  const db = await openCoverDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(OFFLINE_COVERS_STORE, 'readwrite');
      tx.objectStore(OFFLINE_COVERS_STORE).delete(`track:${trackId}`);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function clearOfflineCovers(): Promise<void> {
  for (const val of memoryCoverUrls.values()) {
    try {
      URL.revokeObjectURL(val);
    } catch {
      // ignore
    }
  }
  memoryCoverUrls.clear();
  const db = await openCoverDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(OFFLINE_COVERS_STORE, 'readwrite');
      tx.objectStore(OFFLINE_COVERS_STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}
