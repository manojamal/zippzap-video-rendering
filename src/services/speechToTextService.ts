import { pipeline } from '@huggingface/transformers';

// Lazily-loaded singleton Whisper transcription pipeline. Runs fully in the browser via
// ONNX Runtime Web (WASM, with automatic WebGPU acceleration where available) - no server,
// no API key. The model (~75MB, quantized) downloads once from Hugging Face's model CDN
// and is cached by the browser afterward (same category of one-time asset fetch as the
// ffmpeg.wasm core or the app's existing background-music tracks).
let transcriberPromise: Promise<any> | null = null;

export async function getTranscriber(onProgress?: (pct: number, status: string) => void): Promise<any> {
  if (!transcriberPromise) {
    transcriberPromise = pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny.en', {
      progress_callback: (data: any) => {
        if (onProgress && data?.status === 'progress' && typeof data.progress === 'number') {
          onProgress(Math.round(data.progress), `Downloading speech-recognition model${data.file ? ` (${data.file})` : ''}...`);
        } else if (onProgress && data?.status === 'ready') {
          onProgress(100, 'Speech-recognition model ready.');
        }
      },
    } as any).catch((err: any) => {
      transcriberPromise = null; // allow retry
      throw err;
    });
  }
  return transcriberPromise;
}

/** Decodes any audio/video file's audio track into a mono, 16kHz Float32Array (Whisper's required input format). */
export async function decodeToMono16k(bytes: ArrayBuffer): Promise<{ pcm: Float32Array; sampleRate: number }> {
  const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
  const tempCtx = new AudioCtx();
  let audioBuffer: AudioBuffer;
  try {
    audioBuffer = await tempCtx.decodeAudioData(bytes);
  } finally {
    await tempCtx.close().catch(() => {});
  }

  const targetRate = 16000;
  const offlineCtx = new OfflineAudioContext(1, Math.ceil(audioBuffer.duration * targetRate), targetRate);
  const source = offlineCtx.createBufferSource();
  source.buffer = audioBuffer; // multi-channel buffers are auto-downmixed to the mono destination
  source.connect(offlineCtx.destination);
  source.start(0);
  const rendered = await offlineCtx.startRendering();
  return { pcm: rendered.getChannelData(0), sampleRate: targetRate };
}

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

/**
 * Transcribes a time slice [sliceStart, sliceEnd) (in seconds) of already-decoded 16kHz mono
 * PCM audio, returning timestamped segments relative to the start of the slice.
 */
export async function transcribeSlice(
  pcm: Float32Array,
  sampleRate: number,
  sliceStart: number,
  sliceEnd: number,
  onProgress?: (pct: number, status: string) => void
): Promise<TranscriptSegment[]> {
  const transcriber = await getTranscriber(onProgress);

  const startIdx = Math.max(0, Math.floor(sliceStart * sampleRate));
  const endIdx = Math.min(pcm.length, Math.ceil(sliceEnd * sampleRate));
  if (endIdx - startIdx < sampleRate * 0.25) return []; // too short to contain meaningful speech

  const slice = pcm.subarray(startIdx, endIdx);
  const result: any = await transcriber(slice, { return_timestamps: true, chunk_length_s: 30 });

  const chunks: any[] = result?.chunks?.length
    ? result.chunks
    : result?.text?.trim()
      ? [{ timestamp: [0, sliceEnd - sliceStart], text: result.text }]
      : [];

  return chunks
    .filter((c) => c.text && c.text.trim())
    .map((c) => ({
      start: Math.max(0, c.timestamp?.[0] ?? 0),
      end: Math.max(0.1, c.timestamp?.[1] ?? sliceEnd - sliceStart),
      text: c.text.trim(),
    }));
}
