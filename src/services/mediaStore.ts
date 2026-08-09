/**
 * mediaStore.ts
 *
 * Blob URLs created via URL.createObjectURL() only live for the current page
 * session — they silently die on refresh/close. Media metadata (name, notes,
 * timestamps, etc.) is small and JSON-safe so it's fine in localStorage, but
 * the actual binary media (video/audio/photo blobs) needs real persistent
 * storage that can hold Blobs across sessions: IndexedDB.
 *
 * This module is a small, dependency-free wrapper around a single IndexedDB
 * object store that maps a mediaItem id -> Blob. createObjectURL() is still
 * used, but only transiently, to display a Blob once it's been read back out
 * of IndexedDB for the current session.
 */

const DB_NAME = 'zippzap_media_store';
const DB_VERSION = 1;
const STORE_NAME = 'blobs';

let dbPromise: Promise<IDBDatabase> | null = null;

function isIndexedDBAvailable(): boolean {
  try {
    return typeof indexedDB !== 'undefined';
  } catch {
    return false;
  }
}

function openDB(): Promise<IDBDatabase> {
  if (!isIndexedDBAvailable()) {
    return Promise.reject(new Error('IndexedDB is not available in this browser/context.'));
  }
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Failed to open IndexedDB'));
  });

  return dbPromise;
}

export class MediaStoreQuotaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MediaStoreQuotaError';
  }
}

/** Persist a blob under the given key (typically a MediaItem id, optionally suffixed e.g. `${id}_thumb`). */
export async function putBlob(key: string, blob: Blob): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(blob, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e: any) {
    if (e && (e.name === 'QuotaExceededError' || /quota/i.test(e.message || ''))) {
      throw new MediaStoreQuotaError(
        'Your browser storage is full, so this media file could not be saved for next time. Free up space or export your project to back it up.'
      );
    }
    // IndexedDB not available, blocked (private browsing on some browsers), etc. — degrade quietly.
    throw e;
  }
}

/** Retrieve a previously stored blob, or undefined if not present. */
export async function getBlob(key: string): Promise<Blob | undefined> {
  try {
    const db = await openDB();
    return await new Promise<Blob | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(key);
      req.onsuccess = () => resolve(req.result as Blob | undefined);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return undefined;
  }
}

export async function deleteBlob(key: string): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // best-effort
  }
}

export async function getAllKeys(): Promise<string[]> {
  try {
    const db = await openDB();
    return await new Promise<string[]>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).getAllKeys();
      req.onsuccess = () => resolve((req.result as IDBValidKey[]).map(String));
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

export async function clearAllBlobs(): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // best-effort
  }
}

/**
 * Convenience: given a same-origin blob: URL that is still alive in this
 * session, read it back into a real Blob and persist it under `key`.
 * Used right after a MediaItem is created (its object URL is still valid at
 * that point) so the binary survives the next reload.
 */
export async function persistFromObjectUrl(key: string, objectUrl: string): Promise<void> {
  if (!objectUrl || !objectUrl.startsWith('blob:')) return;
  try {
    const res = await fetch(objectUrl);
    const blob = await res.blob();
    await putBlob(key, blob);
  } catch {
    // best-effort — if the object URL was already revoked or fetch fails, skip silently
  }
}

/** Base64 helpers used by project export/import (see utils.ts exportProjectData/importProjectData). */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve((reader.result as string).split(',')[1] || '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export function base64ToBlob(base64: string, mimeType: string): Blob {
  const byteChars = atob(base64);
  const byteNumbers = new Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) {
    byteNumbers[i] = byteChars.charCodeAt(i);
  }
  return new Blob([new Uint8Array(byteNumbers)], { type: mimeType });
}
