import { defaultPlatformBridge } from '../platform/web-bridge.ts';

const OFFLINE_COVERS_DB_NAME = 'pmusic_offline_covers_v1';
const OFFLINE_COVERS_STORE = 'covers';

interface StoredCoverEntry {
  key: string;
  trackId: string;
  coverUrl: string;
  blob: Blob;
  savedAt: number;
}

const memoryCoverUrls = new Map<string, string>();
let coverDbPromise: Promise<IDBDatabase | null> | null = null;

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

function registerMemoryCover(trackId: string | undefined, coverUrl: string | undefined | null, blob: Blob): string | null {
  if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return null;
  try {
    const objUrl = URL.createObjectURL(blob);
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
    }
    const norm = normalizeCoverKey(coverUrl);
    if (norm) {
      memoryCoverUrls.set(`url:${norm}`, objUrl);
    }
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
  coverUrl?: string | null
): string | null {
  if (trackId) {
    const byId = memoryCoverUrls.get(`track:${trackId}`);
    if (byId) return byId;
  }
  const norm = normalizeCoverKey(coverUrl);
  if (norm) {
    const byUrl = memoryCoverUrls.get(`url:${norm}`);
    if (byUrl) return byUrl;
  }
  return null;
}

export async function resolveOfflineCoverUrl(
  trackId?: string,
  coverUrl?: string | null
): Promise<string | null> {
  const cached = getCachedOfflineCoverUrl(trackId, coverUrl);
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
      return registerMemoryCover(trackId, entry.coverUrl || coverUrl, entry.blob);
    }
  }
  const norm = normalizeCoverKey(coverUrl);
  if (norm) {
    const entry = await readByKey(`url:${norm}`);
    if (entry?.blob) {
      return registerMemoryCover(trackId || entry.trackId, coverUrl, entry.blob);
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
  const cleanUrl = (coverUrl ?? '').trim();
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

  // Already persisted in memory for this track
  const existingMem = memoryCoverUrls.get(`track:${trackId}`);
  if (existingMem) return true;

  const existingDb = await resolveOfflineCoverUrl(trackId, cleanUrl);
  if (existingDb) return true;

  const blob = await fetchCoverBlobWithFallback(cleanUrl);
  if (!blob) return false;

  registerMemoryCover(trackId, cleanUrl, blob);

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
      } satisfies StoredCoverEntry);
      const norm = normalizeCoverKey(cleanUrl);
      if (norm) {
        store.put({
          key: `url:${norm}`,
          trackId,
          coverUrl: cleanUrl,
          blob,
          savedAt: now,
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
            registerMemoryCover(item.trackId, item.coverUrl, item.blob);
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
