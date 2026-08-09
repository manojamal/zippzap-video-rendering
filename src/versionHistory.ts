/**
 * versionHistory.ts
 *
 * Named, in-browser project snapshots ("Save Snapshot" / "Restore") built on
 * top of the same serialization projectBackup.ts uses for full export/import,
 * but stored locally (IndexedDB) instead of downloaded, so restoring is instant
 * and doesn't require re-uploading a file. This is the "revert to yesterday's
 * cut" feature, sharing its underlying state-snapshot mechanism with autosave.
 *
 * Snapshots are capped (MAX_SNAPSHOTS) with oldest-first eviction so this can't
 * grow unbounded and silently exhaust the user's storage quota.
 */
import { getAllKeys, getBlob, putBlob, deleteBlob, blobToBase64, base64ToBlob } from './services/mediaStore';

const SNAPSHOT_DB_KEY_PREFIX = 'zz_snapshot_meta_';
const MAX_SNAPSHOTS = 15;
const LOCAL_STORAGE_PREFIX = 'zz_';

export interface SnapshotMeta {
  id: string;
  label: string;
  created: number;
  mediaCount: number;
}

function listSnapshotMetas(): SnapshotMeta[] {
  const metas: SnapshotMeta[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(SNAPSHOT_DB_KEY_PREFIX)) {
      try {
        const meta = JSON.parse(localStorage.getItem(key) || 'null');
        if (meta) metas.push(meta);
      } catch {
        // skip corrupt entry
      }
    }
  }
  return metas.sort((a, b) => b.created - a.created);
}

export function getSnapshots(): SnapshotMeta[] {
  return listSnapshotMetas();
}

export async function saveSnapshot(label: string): Promise<SnapshotMeta> {
  const id = `snap_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  // Reuse the same serialization shape as a full project backup, but keep it local.
  const localStorageData: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(LOCAL_STORAGE_PREFIX) && !key.startsWith(SNAPSHOT_DB_KEY_PREFIX)) {
      const val = localStorage.getItem(key);
      if (val !== null) localStorageData[key] = val;
    }
  }

  const mediaKeys = await getAllKeys();
  const media: Array<{ key: string; mimeType: string; base64: string }> = [];
  for (const key of mediaKeys) {
    const blob = await getBlob(key);
    if (!blob) continue;
    const base64 = await blobToBase64(blob);
    media.push({ key, mimeType: blob.type || 'application/octet-stream', base64 });
  }

  const snapshotData = { localStorage: localStorageData, media };
  await putBlob(`snapshot_data_${id}`, new Blob([JSON.stringify(snapshotData)], { type: 'application/json' }));

  const meta: SnapshotMeta = { id, label, created: Date.now(), mediaCount: media.length };
  localStorage.setItem(`${SNAPSHOT_DB_KEY_PREFIX}${id}`, JSON.stringify(meta));

  // Evict oldest snapshots beyond the cap so this can't grow unbounded.
  const all = listSnapshotMetas();
  if (all.length > MAX_SNAPSHOTS) {
    const toEvict = all.slice(MAX_SNAPSHOTS);
    for (const old of toEvict) {
      await deleteSnapshot(old.id).catch(() => {});
    }
  }

  return meta;
}

export async function restoreSnapshot(id: string): Promise<{ mediaCount: number; keyCount: number }> {
  const blob = await getBlob(`snapshot_data_${id}`);
  if (!blob) throw new Error('That snapshot could not be found (it may have been evicted).');
  const text = await blob.text();
  const data = JSON.parse(text) as { localStorage: Record<string, string>; media: Array<{ key: string; mimeType: string; base64: string }> };

  let keyCount = 0;
  for (const [key, value] of Object.entries(data.localStorage)) {
    if (!key.startsWith(LOCAL_STORAGE_PREFIX)) continue;
    localStorage.setItem(key, value);
    keyCount++;
  }

  let mediaCount = 0;
  for (const item of data.media || []) {
    try {
      const restoredBlob = base64ToBlob(item.base64, item.mimeType);
      await putBlob(item.key, restoredBlob);
      mediaCount++;
    } catch {
      // skip corrupt entries, keep restoring the rest
    }
  }

  return { mediaCount, keyCount };
}

export async function deleteSnapshot(id: string): Promise<void> {
  localStorage.removeItem(`${SNAPSHOT_DB_KEY_PREFIX}${id}`);
  // Best-effort: leave the blob if deletion fails, it'll be evicted by the cap eventually.
  await deleteBlob(`snapshot_data_${id}`).catch(() => {});
}
