/**
 * Whole-project export/import.
 *
 * Bundles every zz_* localStorage key (events, media metadata, studio
 * timeline, profile, etc.) together with every media Blob currently held in
 * IndexedDB (base64-encoded) into a single downloadable .json file, and can
 * restore that file back into a fresh browser/profile. This is the "insurance
 * policy" against a cleared cache, a private-tab session, or moving to a new
 * device — since this app has no backend, the exported file *is* the backup.
 */
import { getAllKeys, getBlob, putBlob, blobToBase64, base64ToBlob } from './services/mediaStore';

const LOCAL_STORAGE_PREFIX = 'zz_';
const BACKUP_FORMAT_VERSION = 1;

interface ProjectBackupFile {
  formatVersion: number;
  exportedAt: string;
  appName: 'Zipp Zap';
  localStorage: Record<string, string>;
  media: Array<{ key: string; mimeType: string; base64: string }>;
}

function collectLocalStorage(): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(LOCAL_STORAGE_PREFIX)) {
      const val = localStorage.getItem(key);
      if (val !== null) out[key] = val;
    }
  }
  return out;
}

export async function exportProjectData(): Promise<{ fileName: string; mediaCount: number }> {
  const localStorageData = collectLocalStorage();

  const keys = await getAllKeys();
  const media: ProjectBackupFile['media'] = [];
  for (const key of keys) {
    const blob = await getBlob(key);
    if (!blob) continue;
    const base64 = await blobToBase64(blob);
    media.push({ key, mimeType: blob.type || 'application/octet-stream', base64 });
  }

  const backup: ProjectBackupFile = {
    formatVersion: BACKUP_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    appName: 'Zipp Zap',
    localStorage: localStorageData,
    media
  };

  const json = JSON.stringify(backup);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const dateStamp = new Date().toISOString().slice(0, 10);
  const fileName = `zippzap-project-backup-${dateStamp}.json`;

  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);

  return { fileName, mediaCount: media.length };
}

export async function importProjectData(file: File): Promise<{ mediaCount: number; keyCount: number }> {
  const text = await file.text();
  let backup: ProjectBackupFile;
  try {
    backup = JSON.parse(text);
  } catch {
    throw new Error('That file is not a valid Zipp Zap project backup (couldn\'t parse JSON).');
  }
  if (!backup || typeof backup !== 'object' || !backup.localStorage) {
    throw new Error('That file doesn\'t look like a Zipp Zap project backup.');
  }

  // Restore metadata (events, media list, studio timeline, profile, etc.)
  let keyCount = 0;
  for (const [key, value] of Object.entries(backup.localStorage)) {
    if (!key.startsWith(LOCAL_STORAGE_PREFIX)) continue; // defense in depth, never write arbitrary keys
    localStorage.setItem(key, value);
    keyCount++;
  }

  // Restore media blobs into IndexedDB
  let mediaCount = 0;
  for (const item of backup.media || []) {
    try {
      const blob = base64ToBlob(item.base64, item.mimeType);
      await putBlob(item.key, blob);
      mediaCount++;
    } catch {
      // skip corrupt entries, keep restoring the rest
    }
  }

  return { mediaCount, keyCount };
}
