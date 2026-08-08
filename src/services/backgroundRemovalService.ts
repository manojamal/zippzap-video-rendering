import { pipeline, RawImage } from '@huggingface/transformers';

// Lazily-loaded singleton background-removal pipeline. Runs fully in the browser via ONNX
// Runtime Web (WASM/WebGPU) - no server, no API key - using the same @huggingface/transformers
// library already bundled in this app for Whisper transcription (speechToTextService.ts).
// The model (~7MB, quantized MODNet portrait matting) downloads once from Hugging Face's model
// CDN and is cached by the browser afterward.
//
// NOTE ON VERIFICATION: this could not be exercised end-to-end in the sandbox this was built
// in - huggingface.co and its model CDN are unreachable from that sandbox's browser (confirmed
// directly: a plain `fetch()` to both hosts fails with "Failed to fetch"), so the actual model
// download/inference has not been observed to succeed there. The pipeline call itself follows
// the exact same, already-proven-working pattern as getTranscriber() in speechToTextService.ts
// (same library, same lazy-singleton/progress-callback shape, same error handling), and the
// surrounding UI code (file validation, canvas compositing, error states) was verified. Please
// test this on a real connection before relying on it.
let removerPromise: Promise<any> | null = null;

export async function getBackgroundRemover(onProgress?: (pct: number, status: string) => void): Promise<any> {
  if (!removerPromise) {
    removerPromise = pipeline('background-removal', 'Xenova/modnet', {
      progress_callback: (data: any) => {
        if (onProgress && data?.status === 'progress' && typeof data.progress === 'number') {
          onProgress(Math.round(data.progress), `Downloading background-removal model${data.file ? ` (${data.file})` : ''}...`);
        } else if (onProgress && data?.status === 'ready') {
          onProgress(100, 'Background-removal model ready.');
        }
      },
    } as any).catch((err: any) => {
      removerPromise = null; // allow retry
      throw err;
    });
  }
  return removerPromise;
}

/**
 * Removes the background from an image file, then composites the cut-out subject onto a solid
 * backdrop color (a transparent PNG alone would render as an undefined/black area once
 * transcoded to a normal video frame by ffmpeg, which doesn't support alpha in the final MP4
 * output) and returns a real, renderable JPEG file at the source image's original resolution.
 */
export async function removeImageBackground(
  file: File,
  backdropColor: string,
  onProgress?: (pct: number, status: string) => void
): Promise<File> {
  const remover = await getBackgroundRemover(onProgress);
  onProgress?.(100, 'Removing background...');

  const url = URL.createObjectURL(file);
  try {
    const result = await remover(url);
    // transformers.js's background-removal pipeline returns an array of RawImage (RGBA, subject
    // opaque, background alpha=0) - one per input image.
    const cutout: RawImage = (Array.isArray(result) ? result[0] : result).rgba();

    const canvas = document.createElement('canvas');
    canvas.width = cutout.width;
    canvas.height = cutout.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');

    ctx.fillStyle = backdropColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(cutout.toCanvas(), 0, 0);

    const blob: Blob = await new Promise((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('canvas.toBlob failed'))), 'image/jpeg', 0.92)
    );
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '_bg_removed.jpg', { type: 'image/jpeg', lastModified: Date.now() });
  } finally {
    URL.revokeObjectURL(url);
  }
}
