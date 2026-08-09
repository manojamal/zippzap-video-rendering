/**
 * Real, client-side face detection - powers the "Speaker Face Centering" toggle, which
 * previously only applied a fixed, always-centered 1.35x zoom regardless of where anyone's
 * face actually was in the frame. This makes that feature genuinely look at the image.
 *
 * Uses @vladmandic/face-api's TinyFaceDetector, a ~190KB model. The weights are self-hosted
 * from /public/models/tiny_face_detector (copied at build time from the npm package itself -
 * they ship inside the package, not fetched from any external CDN at runtime), matching the
 * same "no external dependency at render time" approach already used for the ffmpeg core and
 * fonts. Everything runs fully in-browser; nothing is ever uploaded anywhere.
 */

let loadPromise: Promise<typeof import('@vladmandic/face-api')> | null = null;

async function getFaceApi() {
  if (!loadPromise) {
    loadPromise = (async () => {
      const faceapi = await import('@vladmandic/face-api');
      await faceapi.nets.tinyFaceDetector.loadFromUri('/models/tiny_face_detector');
      return faceapi;
    })().catch((err) => {
      loadPromise = null; // allow retry on next call
      throw err;
    });
  }
  return loadPromise;
}

export interface NormalizedFaceBox {
  /** Center of the detected face, as a 0-1 fraction of image width/height. */
  cx: number;
  cy: number;
  /** Face box size, as a 0-1 fraction of image width/height (used to pick a sensible zoom level). */
  w: number;
  h: number;
  confidence: number;
}

/**
 * Detects the most prominent face in an image/video/canvas source and returns its position
 * as normalized (0-1) coordinates, so callers don't need to know the source's pixel dimensions.
 * Returns null if no face is confidently found (the caller should fall back to a plain center
 * crop/zoom rather than a wrong or fabricated position).
 */
export async function detectFaceBox(
  source: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement
): Promise<NormalizedFaceBox | null> {
  try {
    const faceapi = await getFaceApi();
    const srcW = (source as HTMLImageElement).naturalWidth || (source as HTMLVideoElement).videoWidth || source.width || 0;
    const srcH = (source as HTMLImageElement).naturalHeight || (source as HTMLVideoElement).videoHeight || source.height || 0;
    if (!srcW || !srcH) return null;

    const detections = await faceapi.detectAllFaces(
      source as any,
      new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.4 })
    );
    if (!detections || detections.length === 0) return null;

    // If multiple faces are found (e.g. a group photo), pick the largest one - it's almost
    // always the intended subject in a birthday-message-style selfie/clip, rather than
    // someone incidentally in the background.
    let best = detections[0];
    for (const d of detections) {
      if (d.box.area > best.box.area) best = d;
    }

    return {
      cx: (best.box.x + best.box.width / 2) / srcW,
      cy: (best.box.y + best.box.height / 2) / srcH,
      w: best.box.width / srcW,
      h: best.box.height / srcH,
      confidence: best.score,
    };
  } catch (err) {
    // Model failed to load, or detection failed on this particular frame/source - this is a
    // "nice to have" enhancement, so any failure here should silently fall back to the
    // existing plain-centered behavior rather than blocking editing or breaking the render.
    console.warn('Face detection unavailable, falling back to center framing:', err);
    return null;
  }
}

/** Grabs a single representative frame from a video element (e.g. at its trim start) onto an
 *  offscreen canvas, for feeding into detectFaceBox - video elements can be detected on directly,
 *  but a stable seeked frame gives a much more reliable box than whatever frame happens to be
 *  currently decoded. */
export async function grabVideoFrame(video: HTMLVideoElement, atSeconds: number): Promise<HTMLCanvasElement | null> {
  return new Promise((resolve) => {
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    if (!canvas.width || !canvas.height) {
      resolve(null);
      return;
    }
    const onSeeked = () => {
      video.removeEventListener('seeked', onSeeked);
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(null);
        return;
      }
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      resolve(canvas);
    };
    video.addEventListener('seeked', onSeeked);
    try {
      video.currentTime = atSeconds;
    } catch {
      video.removeEventListener('seeked', onSeeked);
      resolve(null);
    }
  });
}
