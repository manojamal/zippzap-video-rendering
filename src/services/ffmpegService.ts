import { FFmpeg } from '@ffmpeg/ffmpeg';

// Lazy-loaded singleton FFmpeg (WebAssembly) instance.
// Everything runs fully client-side in the browser - no server, no external API calls.
// Core files are served locally from /public/ffmpeg so no CDN dependency is required.
let ffmpegInstance: FFmpeg | null = null;
let loadPromise: Promise<FFmpeg> | null = null;

export class FFmpegLoadError extends Error {}
export class FFmpegExecError extends Error {}
export class FFmpegLoadTimeoutError extends FFmpegLoadError {}

// The core+wasm download is ~25-32MB. On a normal connection that's seconds; on a bad one
// (flaky wifi, corporate proxy, a stalled CDN response, the PWA service worker serving a
// broken cached entry) the underlying fetch can hang indefinitely without ever rejecting -
// which used to leave the export UI stuck on "Booting up..." forever with no way out besides
// a hard refresh. This timeout guarantees the load always either succeeds or fails visibly.
const FFMPEG_LOAD_TIMEOUT_MS = 90_000;

export function withTimeout<T>(promise: Promise<T>, ms: number, onTimeoutMessage: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new FFmpegLoadTimeoutError(onTimeoutMessage));
    }, ms);
    promise.then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}

/**
 * Returns a loaded, ready-to-use FFmpeg instance. Safe to call multiple times;
 * concurrent callers share the same loading promise.
 *
 * @param onStage optional callback fired with human-readable progress ("Downloading engine...",
 * "Still downloading (large file, hang tight)...", etc.) so callers can show real feedback
 * instead of a frozen spinner during the ~25-32MB one-time download.
 */
export async function getFFmpeg(onLog?: (message: string) => void, onStage?: (message: string) => void): Promise<FFmpeg> {
  if (ffmpegInstance && ffmpegInstance.loaded) {
    return ffmpegInstance;
  }

  if (!loadPromise) {
    const ffmpeg = new FFmpeg();
    if (onLog) {
      ffmpeg.on('log', ({ message }) => onLog(message));
    }

    // Multi-threaded core is 2-4x faster on multi-core devices, but requires the page to be
    // "cross-origin isolated" (COOP/COEP headers set at the host level - see netlify.toml).
    // If that isn't available for any reason, fall back to the single-threaded core, which
    // works everywhere with no special hosting requirements. This is a safe, automatic choice -
    // never a hard requirement - so rendering keeps working even if headers aren't configured.
    //
    // We also skip the multi-threaded core on devices that clearly won't benefit from it:
    // low core-count devices (navigator.hardwareConcurrency), low-memory devices
    // (navigator.deviceMemory, Chrome-only), and typical mobile form factors. Spinning up
    // worker threads on a 2-core phone doesn't meaningfully speed anything up and just costs
    // an extra ~32MB download plus worker-startup overhead for no benefit.
    const isCrossOriginIsolated = typeof window !== 'undefined' && window.crossOriginIsolated === true;
    const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 1 : 1;
    const memoryGB = typeof navigator !== 'undefined' ? (navigator as any).deviceMemory : undefined; // Chrome-only
    const isLikelyMobile = typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    const isLowPowerDevice = cores <= 2 || (typeof memoryGB === 'number' && memoryGB <= 2) || isLikelyMobile;
    const canUseMultiThread = isCrossOriginIsolated && !isLowPowerDevice;

    // Reassures the user during the one-time download instead of leaving a frozen spinner.
    const nudgeTimer = setTimeout(
      () => onStage?.('Still downloading the video engine (~30MB, one-time only)...'),
      8_000
    );

    loadPromise = (async () => {
      onStage?.('Downloading local video engine (WebAssembly FFmpeg)...');
      if (canUseMultiThread) {
        try {
          await withTimeout(
            ffmpeg.load({
              coreURL: '/ffmpeg-mt/ffmpeg-core.js',
              wasmURL: '/ffmpeg-mt/ffmpeg-core.wasm',
              workerURL: '/ffmpeg-mt/ffmpeg-core.worker.js',
            }),
            FFMPEG_LOAD_TIMEOUT_MS,
            'Multi-threaded engine timed out.'
          );
          ffmpegInstance = ffmpeg;
          return ffmpeg;
        } catch (mtErr) {
          console.warn('Multi-threaded video engine failed to load, falling back to single-threaded:', mtErr);
        }
      }
      await withTimeout(
        ffmpeg.load({
          coreURL: '/ffmpeg/ffmpeg-core.js',
          wasmURL: '/ffmpeg/ffmpeg-core.wasm',
        }),
        FFMPEG_LOAD_TIMEOUT_MS,
        'Timed out downloading the video engine after 90 seconds.'
      );
      ffmpegInstance = ffmpeg;
      return ffmpeg;
    })()
      .finally(() => clearTimeout(nudgeTimer))
      .catch((err) => {
        loadPromise = null; // allow retry on next call - a stuck/broken load must not brick every future export
        ffmpegInstance = null;
        const isTimeout = err instanceof FFmpegLoadTimeoutError;
        throw new FFmpegLoadError(
          isTimeout
            ? 'The video engine took too long to download. This usually means a slow/unstable ' +
              'connection or a blocked request. Check your connection and try exporting again.'
            : `Could not initialize the video engine (${err?.message || err}). ` +
              `Check your internet connection and that /ffmpeg/ffmpeg-core.wasm is reachable, then try again.`
        );
      });
  }

  return loadPromise;
}

/** Converts a File/Blob into a Uint8Array ready to write into ffmpeg's virtual filesystem. */
export async function toUint8Array(input: File | Blob): Promise<Uint8Array> {
  const buf = await input.arrayBuffer();
  return new Uint8Array(buf);
}

/**
 * Fetches a remote or blob URL and returns its bytes. Used for soundtrack URLs, etc.
 * Returns null (instead of throwing) on failure so callers can gracefully skip
 * optional assets (e.g. a soundtrack hosted on a third-party CDN that is unreachable)
 * rather than crashing the whole render.
 */
export async function tryFetchBytes(url: string): Promise<Uint8Array | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    return new Uint8Array(buf);
  } catch {
    return null;
  }
}

let fontsLoaded = false;
/** Writes the bundled font files into ffmpeg's FS (used by drawtext for subtitles/overlays). */
export async function ensureFonts(ffmpeg: FFmpeg): Promise<void> {
  if (fontsLoaded) return;
  const [regular, bold] = await Promise.all([
    tryFetchBytes('/fonts/DejaVuSans.ttf'),
    tryFetchBytes('/fonts/DejaVuSans-Bold.ttf'),
  ]);
  if (regular) await ffmpeg.writeFile('font-regular.ttf', regular);
  if (bold) await ffmpeg.writeFile('font-bold.ttf', bold);
  fontsLoaded = true;
}

/** Escapes text for safe use inside an ffmpeg drawtext filter argument. */
export function escapeDrawtext(text: string): string {
  return text
    .replace(/\\/g, '\\\\\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, '\u2019')
    .replace(/%/g, '\\%')
    .replace(/\n/g, ' ');
}

export function terminateFFmpeg(): void {
  if (ffmpegInstance) {
    try {
      ffmpegInstance.terminate();
    } catch {
      // ignore
    }
    ffmpegInstance = null;
    loadPromise = null;
    fontsLoaded = false;
  }
}

export class FFmpegExecTimeoutError extends FFmpegExecError {}

/**
 * Wraps an FFmpeg instance's .exec() with a per-command timeout, and returns a
 * matching cleanup function. Without this, a single command that hangs - most
 * commonly the WASM runtime silently running out of linear memory on a long or
 * high-resolution timeline - leaves the whole export frozen forever: no progress,
 * no error, no download link, since ffmpeg.wasm doesn't reliably reject its own
 * promise when the worker dies underneath it. This turns that silent freeze into
 * a clear, catchable error after a generous but bounded wait, and tears down the
 * (likely corrupted) instance so the next export attempt starts fresh instead of
 * reusing a zombie worker.
 */
export function withExecTimeout(ffmpeg: FFmpeg, ms = 240_000): () => void {
  if ((ffmpeg as any).__execTimeoutWrapped) {
    // Already wrapped (ffmpeg is a lazily-created singleton reused across renders) -
    // avoid stacking timeout wrappers on top of each other.
    return () => {};
  }
  (ffmpeg as any).__execTimeoutWrapped = true;
  const rawExec = ffmpeg.exec.bind(ffmpeg);
  (ffmpeg as any).exec = async (args: string[], ...rest: any[]) => {
    try {
      return await withTimeout(
        rawExec(args, ...(rest as [number?])),
        ms,
        `A video-processing step timed out after ${Math.round(ms / 1000)}s. This usually ` +
          `means the browser ran out of memory (very common with long timelines, 4K/high-res ` +
          `source clips, or many clips at once). Try a lower export resolution, a shorter ` +
          `timeline, or fewer clips at a time.`
      );
    } catch (err) {
      if (err instanceof FFmpegLoadTimeoutError) {
        // Not really a "load" timeout, but withTimeout's rejection type is shared;
        // surface it as an exec timeout and kill the (likely dead) instance.
        terminateFFmpeg();
        throw new FFmpegExecTimeoutError((err as Error).message);
      }
      throw err;
    }
  };
  return () => {
    (ffmpeg as any).exec = rawExec;
  };
}
