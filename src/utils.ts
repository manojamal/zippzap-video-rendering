import { CelebrativeEvent, BirthdayContact, ActivityFeedItem, MediaItem, TextOverlay, PlanTier, UserProfile } from './types';

export const TIERS: Record<string, PlanTier> = {
  freemium: {
    id: 'freemium', l: 'Freemium', i: '🆓', p: 'Free', c: '#5C6B8A', bg: '#F0F2F8', badge: 'FREE',
    msgAllowance: 2, videoUploads: 1, signUpPoints: 20, referralPoints: 20,
    studio: 'basic', personalization: 'basic', celebrations: ['Birthday'],
    deliverySpeed: 'basic', support: 'Self-service (FAQ)', ai: false, mixer: false, premiumEffects: false, price: 0
  },
  standard: {
    id: 'standard', l: 'Standard', i: '⭐', p: '₦2,500', c: '#0A7A4A', bg: '#F0FFF8', badge: 'STANDARD',
    msgAllowance: 20, videoUploads: 5, signUpPoints: 50, referralPoints: 50,
    studio: 'standard', personalization: 'occasion', celebrations: 'all',
    deliverySpeed: 'scheduled', support: 'Email support', ai: false, mixer: false, premiumEffects: false, price: 2500
  },
  gold: {
    id: 'gold', l: 'Gold', i: '🥇', p: '₦4,999', c: '#B07A00', bg: '#FFF8E6', badge: 'GOLD',
    msgAllowance: 75, videoUploads: 20, signUpPoints: 100, referralPoints: 100,
    studio: 'full', personalization: 'advanced', celebrations: 'all',
    deliverySpeed: 'priority', support: 'Priority support', ai: true, mixer: true, premiumEffects: false, price: 4999
  },
  elite: {
    id: 'elite', l: 'Elite', i: '💎', p: '₦9,999', c: '#6B21D9', bg: '#F3EBFF', badge: 'ELITE',
    msgAllowance: Infinity, videoUploads: Infinity, signUpPoints: 300, referralPoints: 300,
    studio: 'premium', personalization: 'hyper', celebrations: 'all+custom',
    deliverySpeed: 'realtime', support: 'Dedicated concierge', ai: true, mixer: true, premiumEffects: true, price: 9999
  },
  demo: {
    id: 'demo', l: 'Demo', i: '🚀', p: 'Free', c: '#FF6B1A', bg: '#FFF8F0', badge: 'DEMO',
    msgAllowance: Infinity, videoUploads: Infinity, signUpPoints: 999, referralPoints: 999,
    studio: 'premium', personalization: 'hyper', celebrations: 'all+custom',
    deliverySpeed: 'realtime', support: 'Dedicated concierge', ai: true, mixer: true, premiumEffects: true, price: 0
  }
};

export const SURPRISE_THEMES = [
  { id: 'classic', name: 'Classic Orange', desc: 'Warm & celebratory — the Zipp Zap default',
    colors: { orange: '#FF6B1A', c1: '#FFF8F0', c2: '#FFF0E4', ink: '#1C1207' }, emoji: '🎉' },
  { id: 'royal', name: 'Royal Purple', desc: 'Elegant & prestigious',
    colors: { orange: '#6B21D9', c1: '#F8F0FF', c2: '#F0E8FF', ink: '#1A0A2E' }, emoji: '👑' },
  { id: 'emerald', name: 'Emerald Green', desc: 'Fresh, natural & vibrant',
    colors: { orange: '#0A7A4A', c1: '#F0FFF8', c2: '#E0FFF0', ink: '#0A2010' }, emoji: '💚' },
  { id: 'midnight', name: 'Midnight Dark', desc: 'Bold, modern & dramatic',
    colors: { orange: '#4A9EFF', c1: '#0D1117', c2: '#161B22', ink: '#E6EDF3' }, emoji: '🌙' },
  { id: 'rose', name: 'Rose Gold', desc: 'Soft, romantic & feminine',
    colors: { orange: '#C96B8A', c1: '#FFF0F4', c2: '#FFE0EA', ink: '#2E0A18' }, emoji: '🌹' },
  { id: 'naija', name: 'Naija Vibes', desc: 'Green-white-green Nigerian pride!',
    colors: { orange: '#008751', c1: '#F0FFF4', c2: '#E0FFE8', ink: '#0A1E10' }, emoji: '🇳🇬' },
  { id: 'gold', name: 'Gold & Black', desc: 'Luxurious, premium & VIP',
    colors: { orange: '#D4A820', c1: '#1A1500', c2: '#221D00', ink: '#F5E6A0' }, emoji: '✨' },
  { id: 'ocean', name: 'Ocean Blue', desc: 'Cool, calm & professional',
    colors: { orange: '#0070F3', c1: '#EFF6FF', c2: '#DBEAFE', ink: '#0A1628' }, emoji: '🌊' },
  { id: 'sunset', name: 'Sunset Theme', desc: 'Warm gradient sunset style',
    colors: { orange: '#FF6B6B', c1: '#FFF0F0', c2: '#FFE4E4', ink: '#2E0A0A' }, emoji: '🌅' }
];

export const BUILTIN_MUSIC = [
  { id: 'bm1', n: 'Afrobeats Celebration', g: 'Afrobeats', d: '3:10', e: '🎺' },
  { id: 'bm2', n: 'Happy Birthday Piano', g: 'Classical', d: '2:30', e: '🎹' },
  { id: 'bm3', n: 'Naija Party Vibes', g: 'Afropop', d: '2:55', e: '🎸' },
  { id: 'bm4', n: 'Emotional Strings', g: 'Cinematic', d: '3:20', e: '🎻' },
  { id: 'bm5', n: 'Soft Gospel Choir', g: 'Gospel', d: '3:45', e: '🎤' },
  { id: 'bm6', n: 'Drum & Bass Energy', g: 'Electronic', d: '2:40', e: '🥁' },
  { id: 'bm7', n: 'Acoustic Wedding Guitar', g: 'Folk/Romantic', d: '2:15', e: '🎸' },
  { id: 'bm8', n: 'Uplifting Corporate Synth', g: 'Corporate', d: '3:05', e: '💻' },
  { id: 'bm9', n: 'Retro Disco Dance Party', g: 'Retro', d: '2:50', e: '🪩' },
  { id: 'bm10', n: 'Festive African Highlife', g: 'Traditional', d: '3:30', e: '🪘' },
  { id: 'bm11', n: 'Romantic Jazz Saxophone', g: 'Jazz', d: '3:12', e: '🎷' },
  { id: 'bm12', n: 'Golden Horizon Ambient', g: 'Ambient', d: '4:00', e: '🌅' }
];

export const PIPELINE_STAGES = [
  { id: 0, label: 'Event Created', icon: '✦', desc: 'Surprise event set up' },
  { id: 1, label: 'Invites Sent', icon: '📨', desc: 'Contributors notified' },
  { id: 2, label: 'Collecting Wishes', icon: '💌', desc: 'Contributors submitting' },
  { id: 3, label: 'Compiling', icon: '🤖', desc: 'Building the video' },
  { id: 4, label: 'Ready to Send', icon: '✅', desc: 'Video ready for delivery' },
  { id: 5, label: 'Delivered', icon: '🎊', desc: 'Surprise sent!' }
];

export const PHOTO_FRAMES = [
  { id: 'none', name: 'No Frame' },
  { id: 'white', name: 'White Border' },
  { id: 'gold', name: 'Gold Elegant' },
  { id: 'shadow', name: 'Drop Shadow' },
  { id: 'polaroid', name: 'Polaroid' },
  { id: 'vintage', name: 'Vintage' },
  { id: 'rounded', name: 'Rounded' },
  { id: 'film', name: 'Film Strip' }
];

export const SS_TRANSITIONS = [
  { id: 'fade', name: 'Fade', icon: '🌫️' },
  { id: 'slide-l', name: 'Slide Left', icon: '◀' },
  { id: 'slide-r', name: 'Slide Right', icon: '▶' },
  { id: 'zoom-in', name: 'Zoom In', icon: '🔍' },
  { id: 'zoom-out', name: 'Zoom Out', icon: '🔎' },
  { id: 'flip', name: 'Flip', icon: '🔄' },
  { id: 'wipe', name: 'Wipe', icon: '↔️' },
  { id: 'dissolve', name: 'Dissolve', icon: '✨' },
  { id: 'none', name: 'Cut', icon: '✂️' }
];

const ri = (a: number, b: number) => Math.floor(Math.random() * (b - a + 1)) + a;
const fd = (d: number) => { const x = new Date(); x.setDate(x.getDate() + d); return x.toISOString().split('T')[0]; };
const pd = (d: number) => { const x = new Date(); x.setDate(x.getDate() - d); return x.toISOString().split('T')[0]; };

export const fmtD = (s: string) => new Date(s).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });
export const daysTo = (s: string) => Math.ceil((new Date(s).getTime() - new Date().getTime()) / 86400000);
export const fmtT = (s: number) => { if (!s || isNaN(s)) return '0:00'; const m = Math.floor(s / 60), sec = Math.floor(s % 60); return `${m}:${String(sec).padStart(2, '0')}`; };

export function getMediaDur(url: string, type: string = 'video'): Promise<number> {
  return new Promise(res => {
    const el = document.createElement(type === 'audio' ? 'audio' : 'video');
    el.preload = 'metadata';
    el.onloadedmetadata = () => res(el.duration || 0);
    el.onerror = () => res(0);
    el.src = url;
  });
}

// --- Guardrails for in-browser media processing -----------------------------
// Everything (rendering, compression, transcription) runs inside the browser tab's
// memory via WebAssembly - there's no server to offload to. Very large files or very
// long combined timelines can exhaust that memory and crash the tab rather than fail
// gracefully, so we warn/block before that happens rather than after.
export const MAX_UPLOAD_FILE_SIZE_MB = 500;
export const MAX_TIMELINE_DURATION_SECONDS = 600; // 10 minutes combined
export const MAX_TIMELINE_CLIP_COUNT = 60;

export interface FileValidationResult {
  ok: boolean;
  reason?: string;
}

/** Checks a single file against the per-file size guardrail before it's read/processed. */
export function validateUploadFileSize(file: File): FileValidationResult {
  const maxBytes = MAX_UPLOAD_FILE_SIZE_MB * 1024 * 1024;
  if (file.size > maxBytes) {
    const sizeMB = Math.round(file.size / (1024 * 1024));
    return {
      ok: false,
      reason: `"${file.name}" is ${sizeMB}MB, which is over the ${MAX_UPLOAD_FILE_SIZE_MB}MB per-file limit. Since all video processing happens in your browser (not a server), very large files can freeze or crash the tab. Try compressing it first or trimming it to a shorter clip.`,
    };
  }
  return { ok: true };
}

/** Checks whether adding `addingSeconds` more to a timeline would exceed a sane combined-duration budget. */
export function checkTimelineDurationBudget(currentTotalSeconds: number, addingSeconds: number): FileValidationResult {
  const projected = currentTotalSeconds + addingSeconds;
  if (projected > MAX_TIMELINE_DURATION_SECONDS) {
    return {
      ok: false,
      reason: `This would bring your total timeline to about ${Math.round(projected / 60)} minutes. Timelines rendered entirely in-browser can get slow or unstable past roughly ${Math.round(MAX_TIMELINE_DURATION_SECONDS / 60)} minutes combined. You can still add it, but consider rendering in smaller batches if you notice slowdowns.`,
    };
  }
  return { ok: true };
}

/** Checks whether adding one more clip would exceed a sane clip-count budget (many small clips also add overhead). */
export function checkTimelineClipCountBudget(currentClipCount: number): FileValidationResult {
  if (currentClipCount + 1 > MAX_TIMELINE_CLIP_COUNT) {
    return {
      ok: false,
      reason: `You're at ${currentClipCount} clips already. Timelines with more than ${MAX_TIMELINE_CLIP_COUNT} clips can be slow to render in-browser. You can still add more, but consider splitting into multiple projects if you notice slowdowns.`,
    };
  }
  return { ok: true };
}

/**
 * Client-side anti-spam rate limit for public contributor submissions. Since this app
 * has no backend/server, this can only track "this browser" (via localStorage) rather
 * than truly preventing abuse across devices - it's a friction/deterrent measure, not
 * a security boundary. A determined spammer with multiple browsers/devices can still
 * get around it; real abuse prevention would need a server to enforce per-IP/account.
 */
const SUBMISSION_COOLDOWN_MS = 20_000; // 20 seconds between submissions from the same browser
const MAX_SUBMISSIONS_PER_EVENT = 15; // soft cap per browser per event

export function checkSubmissionRateLimit(eventId: string): FileValidationResult {
  try {
    const key = `zippzap_submissions_${eventId}`;
    const raw = localStorage.getItem(key);
    const data = raw ? JSON.parse(raw) : { count: 0, lastAt: 0 };
    const now = Date.now();
    if (data.lastAt && now - data.lastAt < SUBMISSION_COOLDOWN_MS) {
      const waitSec = Math.ceil((SUBMISSION_COOLDOWN_MS - (now - data.lastAt)) / 1000);
      return { ok: false, reason: `Please wait ${waitSec} more second${waitSec === 1 ? '' : 's'} before submitting again.` };
    }
    if (data.count >= MAX_SUBMISSIONS_PER_EVENT) {
      return {
        ok: false,
        reason: `You've already submitted ${data.count} wishes for this event from this device. If you'd like to send more, please reach out to the event organizer directly.`,
      };
    }
    return { ok: true };
  } catch {
    return { ok: true }; // if localStorage is unavailable, don't block submission on that basis
  }
}

export function recordSubmission(eventId: string): void {
  try {
    const key = `zippzap_submissions_${eventId}`;
    const raw = localStorage.getItem(key);
    const data = raw ? JSON.parse(raw) : { count: 0, lastAt: 0 };
    data.count = (data.count || 0) + 1;
    data.lastAt = Date.now();
    localStorage.setItem(key, JSON.stringify(data));
  } catch {
    // best-effort only; not tracking a submission just means the cooldown is skipped once
  }
}
/**
 * Reads a file's actual leading bytes and checks them against known magic-number
 * signatures for its claimed category (video/audio/image), instead of trusting only
 * the file extension or browser-reported MIME type (either of which can be wrong for
 * a renamed, corrupted, or mislabeled file). Returns true if the signature is
 * recognized and matches, or if the format simply isn't in our signature list (in
 * which case we don't block it - this is a best-effort sanity check, not a strict
 * allowlist). A clear early rejection here is much friendlier than a cryptic ffmpeg
 * decode error minutes later.
 */
export async function validateFileSignature(
  file: File,
  expectedCategory: 'video' | 'audio' | 'photo'
): Promise<FileValidationResult> {
  try {
    const buf = await file.slice(0, 16).arrayBuffer();
    const bytes = new Uint8Array(buf);
    const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
    const ascii = Array.from(bytes).map((b) => (b >= 32 && b <= 126 ? String.fromCharCode(b) : '.')).join('');

    const isMp4Family = ascii.slice(4, 8) === 'ftyp';
    const isWebm = hex.startsWith('1a45dfa3');
    const isAvi = ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'AVI ';
    const isWav = ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WAVE';
    const isOgg = ascii.startsWith('OggS');
    const isMp3 = hex.startsWith('fffb') || hex.startsWith('fff3') || hex.startsWith('fff2') || ascii.startsWith('ID3');
    const isJpeg = hex.startsWith('ffd8ff');
    const isPng = hex.startsWith('89504e47');
    const isGif = ascii.startsWith('GIF87a') || ascii.startsWith('GIF89a');
    const isWebp = ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP';
    const isHeic = ascii.slice(4, 8) === 'ftyp' && /hei[cs]|heix|mif1/i.test(ascii.slice(8, 12));
    const isZip = hex.startsWith('504b0304') || hex.startsWith('504b0506') || hex.startsWith('504b0708');

    // A .zip's signature previously fell through as "unrecognized, don't block" below,
    // which let it slip past this check entirely, get added to the timeline as a fake
    // "video" clip (see handleAddNewClip's type-detection fallback), and only fail -
    // opaquely, with no useful error - once the render pipeline tried to decode it.
    // extractMediaFilesFromZip() is meant to intercept real zips before they ever reach
    // this function, but this catches the case directly (renamed file, or a caller that
    // skips extraction) with an actionable message instead of a silent pass-through.
    if (isZip) {
      return {
        ok: false,
        reason: `"${file.name}" is a .zip archive, not a ${expectedCategory} file. Upload it directly - ZippZap will automatically extract the videos/photos/audio inside it.`,
      };
    }

    const recognizedAsVideo = isMp4Family || isWebm || isAvi;
    const recognizedAsAudio = isWav || isOgg || isMp3 || isMp4Family; // m4a shares the mp4/ftyp container
    const recognizedAsPhoto = isJpeg || isPng || isGif || isWebp || isHeic;

    const anyRecognized = recognizedAsVideo || recognizedAsAudio || recognizedAsPhoto;
    if (!anyRecognized) {
      // Unrecognized signature (could be a format we simply don't check, e.g. some RAW
      // photo or exotic codec) - don't block it, just let it proceed.
      return { ok: true };
    }

    const matches =
      (expectedCategory === 'video' && (recognizedAsVideo || recognizedAsAudio)) || // some containers overlap
      (expectedCategory === 'audio' && recognizedAsAudio) ||
      (expectedCategory === 'photo' && recognizedAsPhoto);

    if (!matches) {
      return {
        ok: false,
        reason: `"${file.name}" doesn't look like a real ${expectedCategory} file (its content doesn't match its name/type - it may be renamed, corrupted, or the wrong kind of file). Please double-check the file before uploading.`,
      };
    }
    return { ok: true };
  } catch {
    // If we can't even read the file to check, don't block the upload on that basis.
    return { ok: true };
  }
}

/** Extension -> MIME map for files found inside an uploaded .zip archive. */
const ZIP_MEDIA_MIME_BY_EXT: Record<string, string> = {
  mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', avi: 'video/x-msvideo', mkv: 'video/x-matroska', m4v: 'video/mp4',
  mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', ogg: 'audio/ogg', aac: 'audio/aac', flac: 'audio/flac',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', heic: 'image/heic', heif: 'image/heif',
};

export interface ZipExtractionResult {
  files: File[];
  skippedNames: string[];
}

/**
 * Extracts video/audio/photo entries from an uploaded .zip archive, fully client-side
 * (JSZip, lazy-loaded so its cost is never paid by users who don't upload a zip) - no
 * server involved, consistent with the rest of this app. Folders, hidden/system entries
 * (`__MACOSX/`, `.DS_Store`, dotfiles), and any extension we don't recognize as media
 * are skipped and reported back in `skippedNames` rather than silently dropped, so the
 * caller can tell the user what was left out.
 */
export async function extractMediaFilesFromZip(
  zipFile: File,
  onProgress?: (message: string) => void
): Promise<ZipExtractionResult> {
  const { default: JSZip } = await import('jszip');
  onProgress?.(`Reading ${zipFile.name}...`);
  const zip = await JSZip.loadAsync(zipFile);

  const files: File[] = [];
  const skippedNames: string[] = [];

  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue;
    const baseName = entry.name.split('/').pop() || entry.name;
    const ext = baseName.includes('.') ? baseName.split('.').pop()!.toLowerCase() : '';
    const mime = ZIP_MEDIA_MIME_BY_EXT[ext];
    if (!mime || baseName.startsWith('.') || entry.name.startsWith('__MACOSX/')) {
      skippedNames.push(entry.name);
      continue;
    }
    onProgress?.(`Extracting ${baseName}...`);
    const blob = await entry.async('blob');
    files.push(new File([blob], baseName, { type: mime }));
  }

  return { files, skippedNames };
}

export function capVidThumb(url: string): Promise<string | null> {
  return new Promise(res => {
    const v = document.createElement('video');
    v.src = url;
    v.muted = true;
    v.preload = 'auto';
    v.currentTime = 0.5;
    v.oncanplay = () => {
      try {
        const c = document.createElement('canvas');
        c.width = 320;
        c.height = 180;
        const ctx = c.getContext('2d');
        if (ctx) {
          ctx.drawImage(v, 0, 0, 320, 180);
          res(c.toDataURL());
        } else {
          res(null);
        }
      } catch (e) {
        res(null);
      }
    };
    v.onerror = () => res(null);
    v.load();
  });
}


export function seedData() {
  const now = Date.now();
  const events: CelebrativeEvent[] = [
    {
      id: 'e1', title: "Oluwaseun's 30th Birthday", occ: 'Birthday', cel: 'Oluwaseun Adeyemi', date: fd(9), emoji: '🎂', status: 'active',
      invites: [
        { name: 'Emeka Obi', contact: 'emeka@demo.ng', sent: true, responded: true, viewed: true, method: 'WhatsApp' },
        { name: 'Chiamaka Eze', contact: 'chiamaka@demo.ng', sent: true, responded: true, viewed: true, method: 'Email' },
        { name: 'Babatunde Adewale', contact: 'babatunde@demo.ng', sent: true, responded: false, viewed: true, method: 'SMS' },
        { name: 'Kemi Adesanya', contact: 'kemi@demo.ng', sent: true, responded: false, viewed: false, method: 'WhatsApp' }
      ],
      uploads: [], link: 'SEUN30NG', pipeline: 2, created: now - 86400000 * 2
    },
    {
      id: 'e2', title: "Mama Nkechi's Anniversary", occ: 'Anniversary', cel: 'Chief & Mrs Nwosu', date: fd(3), emoji: '💍', status: 'active',
      invites: [
        { name: 'Chidi Okeke', contact: 'chidi@demo.ng', sent: true, responded: true, viewed: true, method: 'WhatsApp' }
      ],
      uploads: [], link: 'NKECHI25NG', pipeline: 1, created: now - 86400000 * 4
    },
    {
      id: 'e3', title: "Damilola's Graduation", occ: 'Graduation', cel: 'Damilola Obaseki', date: pd(5), emoji: '🎓', status: 'delivered',
      invites: [], uploads: [], link: 'DAMI2025NG', pipeline: 5, created: now - 86400000 * 12
    }
  ];

  const birthdays: BirthdayContact[] = [
    { id: 'b1', name: 'Oluwaseun Adeyemi', rel: 'Friend', date: fd(9), phone: '+234 803 456 7890', emoji: '🧑' },
    { id: 'b2', name: 'Kemi Adesanya', rel: 'Family', date: fd(14), phone: '+234 807 654 3210', emoji: '👩' },
    { id: 'b3', name: 'Obinna Nwosu', rel: 'Colleague', date: fd(22), phone: '+234 809 876 5432', emoji: '👨' },
    { id: 'b4', name: 'Funke Akindele', rel: 'Friend', date: fd(30), phone: '+234 802 111 2222', emoji: '👩' }
  ];

  const activity: ActivityFeedItem[] = [
    { id: 'act_1', type: 'done', icon: '💌', text: "Chiamaka submitted a voice note", time: '4h ago', stage: 'Collecting Wishes' },
    { id: 'act_2', type: 'done', icon: '📨', text: 'Invite sent to 4 contributors', time: '1d ago', stage: 'Invites Sent' },
    { id: 'act_3', type: 'done', icon: '✦', text: "Oluwaseun's Birthday event created", time: '2d ago', stage: 'Event Created' },
    { id: 'act_4', type: 'done', icon: '⭐', text: 'Damilola rated their surprise 5 stars!', time: '5d ago', stage: 'Delivered' }
  ];

  const timeline = { v: [], a: [], t: [], p: [], m: [] };
  const overlays: TextOverlay[] = [
    { id: 'o1', text: 'Happy 30th Birthday Oluwaseun! 🎂', pos: 'centre', color: '#FF6B1A', size: 48 },
    { id: 'o2', text: 'From all of us with love 💕', pos: 'bottom', color: '#ffffff', size: 36 }
  ];

  return { events, birthdays, activity, timeline, overlays };
}

export const CP_ACCOUNTS = {
  'emeka@demo.ng': { name: 'Emeka Obi', pw: 'demo1234' },
  'chiamaka@demo.ng': { name: 'Chiamaka Eze', pw: 'demo1234' },
  'babatunde@demo.ng': { name: 'Babatunde Adewale', pw: 'demo1234' },
  'kemi@demo.ng': { name: 'Kemi Adesanya', pw: 'demo1234' }
};

export const DEMO_ACCOUNTS: Record<string, UserProfile> = {
  'adaeze@demo.ng': { name: 'Adaeze Okonkwo', pw: 'demo1234', tier: 'demo', isDemo: true, em: 'adaeze@demo.ng', phone: '+234 801 234 5678', city: 'Lagos', points: 999, monthlyMsgCount: 0 },
  'silver@demo.ng': { name: 'Chukwuemeka Eze', pw: 'demo1234', tier: 'demo', isDemo: true, em: 'silver@demo.ng', phone: '', city: 'Abuja', points: 450, monthlyMsgCount: 0 },
  'diamond@demo.ng': { name: 'Ngozi Adichie', pw: 'demo1234', tier: 'demo', isDemo: true, em: 'diamond@demo.ng', phone: '+234 812 345 6789', city: 'Enugu', points: 1200, monthlyMsgCount: 0 }
};

export function applyThemeStyle(colors: { orange: string; c1: string; c2: string; ink: string }) {
  const hexToRgba = (hex: string, alpha: number) => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  };

  const adjustColor = (hex: string, amount: number) => {
    const r = Math.min(255, parseInt(hex.slice(1, 3), 16) + amount);
    const g = Math.min(255, parseInt(hex.slice(3, 5), 16) + amount);
    const b = Math.min(255, parseInt(hex.slice(5, 7), 16) + amount);
    return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
  };

  const root = document.documentElement.style;
  root.setProperty('--orange', colors.orange);
  root.setProperty('--oran2', adjustColor(colors.orange, 30));
  root.setProperty('--c1', colors.c1);
  root.setProperty('--c2', colors.c2);
  root.setProperty('--ink', colors.ink);
  root.setProperty('--oran-l', hexToRgba(colors.orange, 0.1));
  root.setProperty('--oran-m', hexToRgba(colors.orange, 0.3));
}

export function getSoundtrackUrl(id: string, customUrl?: string | null): string | null {
  if (id === 'custom') return customUrl || null;
  const soundHelixIndex: Record<string, number> = {
    bm1: 1, bm2: 2, bm3: 3, bm4: 4, bm5: 5, bm6: 6,
    bm7: 7, bm8: 8, bm9: 9, bm10: 10, bm11: 11, bm12: 12,
  };
  const idx = soundHelixIndex[id];
  if (!idx) return null;
  return `https://www.soundhelix.com/examples/mp3/SoundHelix-Song-${idx}.mp3`;
}

export interface CompressionResult {
  compressedFile: File;
  oldSize: number;
  newSize: number;
  savedPercentage: number;
  originalResolution: string;
  compressedResolution: string;
}

export async function compressVideoFile(
  file: File,
  quality: 'low' | 'medium' | 'high',
  onProgress: (progress: number, etaSeconds: number, statusText: string) => void
): Promise<CompressionResult> {
  // Lazily import so pages that never touch compression don't pay for the ffmpeg bundle.
  const { getFFmpeg, toUint8Array } = await import('./services/ffmpegService');

  const presets = {
    low: { crf: 32, scale: 854, label: '480p SD Mobile Compact' },
    medium: { crf: 26, scale: 1280, label: '720p HD Optimized Fast' },
    high: { crf: 20, scale: 1920, label: '1080p Compressed Smooth' },
  };
  const preset = presets[quality];
  const startedAt = Date.now();

  onProgress(2, 0, '🔍 Booting up local video engine (WebAssembly FFmpeg)...');
  const ffmpeg = await getFFmpeg();

  const removeProgressListener = () => {
    // @ts-ignore - off() exists at runtime even if types lag behind
    ffmpeg.off?.('progress');
  };

  ffmpeg.on('progress', ({ progress }) => {
    const pct = Math.min(99, Math.max(3, Math.round(progress * 100)));
    const elapsed = (Date.now() - startedAt) / 1000;
    const eta = progress > 0 ? Math.max(0.1, elapsed / progress - elapsed) : 0;
    onProgress(pct, parseFloat(eta.toFixed(1)), '🛠️ Transcoding and downsampling video stream...');
  });

  const inputExt = (file.name.split('.').pop() || 'mp4').toLowerCase();
  const inName = `compress_in.${/^[a-z0-9]+$/.test(inputExt) ? inputExt : 'mp4'}`;
  const outName = 'compress_out.mp4';

  try {
    const bytes = await toUint8Array(file);
    await ffmpeg.writeFile(inName, bytes);

    await ffmpeg.exec([
      '-i', inName,
      '-vf', `scale='min(${preset.scale},iw)':-2`,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(preset.crf), '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '128k',
      outName,
    ]);

    const data = await ffmpeg.readFile(outName);
    const uint8 = data instanceof Uint8Array ? data : new Uint8Array(data as unknown as ArrayBuffer);
    const compressedBlob = new Blob([uint8], { type: 'video/mp4' });
    const compressedFile = new File(
      [compressedBlob],
      file.name.replace(/\.[^.]+$/, '') + '_optimized.mp4',
      { type: 'video/mp4', lastModified: Date.now() }
    );

    const newSize = compressedFile.size;
    const savedPercentage = Math.max(0, Math.round((1 - newSize / Math.max(1, file.size)) * 100));

    onProgress(100, 0, '✨ Compression complete!');

    return {
      compressedFile,
      oldSize: file.size,
      newSize,
      savedPercentage,
      originalResolution: 'Original',
      compressedResolution: preset.label,
    };
  } finally {
    removeProgressListener();
    try { await ffmpeg.deleteFile(inName); } catch { /* ignore */ }
    try { await ffmpeg.deleteFile(outName); } catch { /* ignore */ }
  }
}

