import type { FFmpeg } from '@ffmpeg/ffmpeg';
import {
  getFFmpeg,
  toUint8Array,
  tryFetchBytes,
  ensureFonts,
  escapeDrawtext,
  terminateFFmpeg,
  withExecTimeout,
} from './ffmpegService';
import { clampRetimeRate } from '../retime';

export interface RenderOptions {
  soundtrackUrl?: string | null;
  soundtrackVolume?: number;
  autoTrimSilence?: boolean;
  videoFilter?: string;
  fitMode?: 'cover' | 'contain' | 'blur';
  colorGrade?: string;
  showLiveAudioWaveform?: boolean;
  waveformStyle?: string;
  animatedFrame?: string;
  overlays?: any[];
  audioPitch?: number;
  audioReversed?: boolean;
  outputWidth?: number;
  outputHeight?: number;
  outputFps?: number;
  outputFormat?: 'mp4' | 'webm' | 'avi' | 'gif';
  quality?: 'high' | 'balanced' | 'fast';
  /** Evens out volume differences between clips recorded on wildly different devices. Default: true. */
  autoLevel?: boolean;
  /**
   * Global output gain, as a percentage (100 = unchanged), applied as a final mixdown stage
   * after per-clip volume/loudnorm and soundtrack mixing. Deliberately NOT folded into the
   * per-clip volume filter: per-clip volume runs before loudnorm on clips longer than
   * MIN_LOUDNORM_DURATION, and loudnorm would normalize most of a pre-gain right back out,
   * making a "master volume" control that's applied per-clip largely inaudible in practice.
   */
  masterVolume?: number;
  /** Final-mix 3-band EQ gain in dB (typically -50..+50, matching the UI slider's range). Only
   *  the bands that differ from 0 add a real ffmpeg filter - applying `bass=g=0:treble=g=0`
   *  unconditionally would still cost a re-encode pass for no audible effect. */
  eq?: { bass: number; mid: number; treble: number };
  /** Automatically lowers the soundtrack under speech, using each clip's Whisper caption timings. Default: true when captions exist. */
  autoDuck?: boolean;
  /** White-label branding applied to auto-generated text cards (intro/outro/section titles). */
  brandColor?: string;
  brandLogoDataUrl?: string;
  /** Named points on the final timeline (in seconds), embedded as real MP4 chapter metadata
   *  (visible on YouTube/most players' scrubbers) via an ffmetadata mux pass. Only applied
   *  when the output format is mp4 - chapter metadata isn't reliably supported in webm/avi/gif.
   *  Called "markers" here (not "chapters") to stay distinct from the auto Story Chapters
   *  engine (chapterEngine.ts), which reorders/groups clips rather than tagging timestamps. */
  markers?: Array<{ time: number; label: string }>;
}

const DEFAULT_OUT_W = 1280;
const DEFAULT_OUT_H = 720;
const DEFAULT_OUT_FPS = 30;
const TARGET_SAMPLE_RATE = 44100;
// FFmpeg's `loudnorm` filter runs single-pass/"dynamic" here (no measured-stats
// pre-pass, for speed). On clips shorter than this, it doesn't have enough audio
// to settle its internal gain history and instead audibly ramps/pumps the volume
// up and down within the clip - this is what shows up to users as the music or
// voice "shaking"/warbling right around a cut. Below this length we skip it and
// just rely on the flat per-clip volume setting instead.
const MIN_LOUDNORM_DURATION = 2.5;
const loudnormFilter = (effectiveDuration: number) =>
  effectiveDuration >= MIN_LOUDNORM_DURATION ? 'loudnorm=I=-16:TP=-1.5:LRA=11' : null;

// ---- Filter graph helpers -------------------------------------------------

/** Maps the app's named video filters to real ffmpeg `eq`/`colorchannelmixer` filters. */
function videoFilterToFfmpeg(name?: string): string | null {
  switch (name) {
    case 'grayscale':
      return 'hue=s=0';
    case 'sepia':
      return 'colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131:0';
    case 'vibrant':
      return 'eq=saturation=1.8:contrast=1.25:brightness=0.06';
    case 'brightness':
      return 'eq=brightness=0.25';
    case 'high-contrast':
      // This per-clip option existed in the editor's clip-level filter picker but was never
      // actually implemented in the renderer - it silently no-op'd at export time before.
      return 'eq=contrast=1.6:saturation=1.4';
    case 'warm':
      return 'colorbalance=rs=0.16:gs=0.04:bs=-0.16:rm=0.08:bm=-0.08,eq=saturation=1.08';
    case 'cool':
      return 'colorbalance=rs=-0.16:bs=0.16:rm=-0.06:bm=0.08';
    case 'vignette':
      return 'vignette=PI/4';
    case 'oldfilm':
      // Vintage tone curve + light film grain + a soft vignette - a real composited effect,
      // not just a single filter, layered the same way old celluloid actually degrades.
      return 'curves=preset=vintage,noise=alls=12:allf=t+u,vignette=PI/4,eq=contrast=1.08:saturation=0.85';
    case 'noir':
      return 'hue=s=0,eq=contrast=1.4:brightness=-0.02,vignette=PI/3';
    case 'dreamy':
      // Soft glow: blends a heavily blurred copy of the frame back over the sharp original
      // using 'screen' blend mode - the same split/overlay technique already used for the
      // Blur Backdrop fit mode, just composited differently here.
      return 'split[dreamy_a][dreamy_b];[dreamy_b]gblur=sigma=12[dreamy_blur];[dreamy_a][dreamy_blur]blend=all_mode=screen:all_opacity=0.4,eq=saturation=1.1';
    case 'vhs':
      return 'eq=saturation=1.3:contrast=0.95,noise=alls=8:allf=t,hue=h=2:s=1.1';
    case 'invert':
      return 'negate';
    case 'sharpen':
      return 'unsharp=5:5:1.0:5:5:0.0';
    case 'blur':
      return 'gblur=sigma=6';
    case 'thermal':
      // Approximates a false-color thermal-camera look using stock filters (ffmpeg-core has
      // no true pseudocolor/thermal LUT filter built in).
      return 'hue=h=280:s=3,eq=contrast=1.4:brightness=0.05';
    case 'nightvision':
      return 'colorchannelmixer=.2:.9:.2:0:.2:.9:.2:0:.2:.9:.2:0,noise=alls=15:allf=t,vignette=PI/3';
    case 'sketch':
      // Real edge-detection filter - produces a genuine line-art/sketch look, not a fake
      // "cartoon" filter (ffmpeg has no toon-shading filter, so this is labeled for what it
      // actually renders as).
      return 'edgedetect=mode=colormix:high=0.4';
    default:
      return null;
  }
}

/** Maps the app's named color grades to real ffmpeg color-grading filters (approximations). */
function colorGradeToFfmpeg(name?: string): string | null {
  switch (name) {
    case 'warm':
      return 'colorbalance=rs=0.16:gs=0.04:bs=-0.16:rm=0.08:bm=-0.08,eq=saturation=1.08';
    case 'cool':
      return 'colorbalance=rs=-0.16:bs=0.16:rm=-0.06:bm=0.08';
    case 'vibrant':
      return 'eq=saturation=1.6:contrast=1.15';
    case 'bw':
      return 'hue=s=0,eq=contrast=1.25';
    case 'sepia':
      return 'colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131:0';
    case 'cinematic':
      return 'colorbalance=rs=0.05:gs=0.01:bs=-0.08:rm=-0.03:bm=0.05,eq=contrast=1.1:saturation=1.05';
    case 'cyberpunk':
      return 'colorbalance=rs=0.2:bs=0.28:gm=-0.1,eq=saturation=1.45';
    case 'solarize':
      // Approximation of a "solarized glow" look using stock filters (ffmpeg core has no true solarize filter).
      return 'eq=gamma=1.7:contrast=1.25:saturation=1.3';
    default:
      return null;
  }
}

/** Builds an ffmpeg atempo filter chain for a speed change. atempo's valid range per stage is
 *  0.5x-2.0x, so speeds outside that range are achieved by chaining multiple stages. */
/** Builds a pitch-shifting speed-change filter: resampling the audio's rate up or down changes
 *  both tempo and pitch together, like a vinyl record played at the wrong speed (a "chipmunk"
 *  effect at high speed, or a deep/slow effect below 1x). This is the counterpart to
 *  atempoChain() below - offered as the "maintain pitch: off" option since it's a legitimate
 *  creative effect some editors specifically want, not just an artifact to always avoid. */
function pitchShiftingSpeedFilter(speed: number): string {
  const rate = Math.round(TARGET_SAMPLE_RATE * speed);
  return `asetrate=${rate},aresample=${TARGET_SAMPLE_RATE}`;
}

/** Chooses the right audio speed-change filter for a clip: pitch-preserving atempo by default,
 *  or the pitch-shifting resample effect when the clip has maintainPitch explicitly disabled. */
function speedChangeAudioFilter(speed: number, maintainPitch?: boolean): string {
  return maintainPitch === false ? pitchShiftingSpeedFilter(speed) : atempoChain(speed);
}

function atempoChain(speed: number): string {
  let s = speed > 0 ? speed : 1;
  const stages: number[] = [];
  let guard = 0;
  while ((s < 0.5 || s > 2.0) && guard < 8) {
    if (s < 0.5) {
      stages.push(0.5);
      s /= 0.5;
    } else {
      stages.push(2.0);
      s /= 2.0;
    }
    guard++;
  }
  stages.push(s);
  return stages.map((v) => `atempo=${v.toFixed(3)}`).join(',');
}

/** Maps a per-clip chroma-key ("green screen") request to a real ffmpeg colorkey filter.
 *  This removes the keyed color from the clip's own footage (e.g. a green-screen self-recording)
 *  rather than requiring a second overlay video track, which the current single-track pipeline
 *  doesn't otherwise support. */
function chromaKeyToFfmpeg(ck?: { enabled?: boolean; color?: string; similarity?: number; blend?: number }): string | null {
  if (!ck || !ck.enabled) return null;
  const color = (ck.color || '#00ff00').replace('#', '0x');
  const similarity = Math.min(1, Math.max(0.01, ck.similarity ?? 0.3));
  const blend = Math.min(1, Math.max(0, ck.blend ?? 0.1));
  return `colorkey=${color}:${similarity.toFixed(2)}:${blend.toFixed(2)}`;
}

/** The full pool of ffmpeg's built-in xfade named transitions used for "Cinematic Auto" mode -
 *  every one of these is a real xfade style, not a fabricated name, so whichever gets picked
 *  actually renders as that specific motion. */
const CINEMATIC_TRANSITION_POOL = [
  'fade', 'fadeblack', 'fadewhite', 'dissolve', 'distance',
  'wipeleft', 'wiperight', 'wipeup', 'wipedown',
  'slideleft', 'slideright', 'slideup', 'slidedown',
  'smoothleft', 'smoothright', 'smoothup', 'smoothdown',
  'circleopen', 'circleclose', 'circlecrop', 'rectcrop', 'radial',
  'vertopen', 'vertclose', 'horzopen', 'horzclose',
  'diagtl', 'diagtr', 'diagbl', 'diagbr',
  'pixelize', 'hblur',
  'coverleft', 'coverright', 'coverup', 'coverdown',
  'revealleft', 'revealright', 'revealup', 'revealdown',
];
// Note: deliberately NOT including 'zoomin' - it was only added to ffmpeg's xfade filter in a
// newer release than the ffmpeg-core build this app self-hosts (@ffmpeg/core 0.12.x, FFmpeg 6.0
// baseline), so it would silently fail and fall back to a hard cut for that entire chain.

/** Maps a clip's chosen transition style to a real ffmpeg xfade transition name. 'auto' (the
 *  "Cinematic Auto" picker) draws from the full named-transition pool, deliberately avoiding
 *  whatever style was used on the previous cut so the same wipe/dissolve never repeats twice
 *  in a row - matching how a human editor varies transitions through a sequence. */
function resolveTransitionStyle(requested: string | undefined, previousStyleUsed: string | null): string {
  const map: Record<string, string> = {
    fade: 'fade',
    slide: 'slideleft',
    wipe: 'wipeleft',
    dissolve: 'dissolve',
    zoom: 'circleopen',
  };
  if (requested === 'auto') {
    const pool = CINEMATIC_TRANSITION_POOL.filter((s) => s !== previousStyleUsed);
    return pool[Math.floor(Math.random() * pool.length)];
  }
  return (requested && map[requested]) || 'fade';
}

/**
 * Real dead-air removal: probes a clip's audio (only within the range the user already
 * trimmed to - this never expands beyond what they selected) using ffmpeg's silencedetect
 * filter, then nudges trimStart/trimEnd inward past any leading/trailing silence found. Caps
 * how much it will remove (max 40% off either end) as a safety margin against misfires, and
 * returns null (leaving the clip untouched) if nothing meaningful was found or the probe fails.
 */
async function detectAndTrimSilence(
  ffmpeg: FFmpeg,
  bytes: Uint8Array,
  clip: any,
  ext: string
): Promise<{ trimStart: number; trimEnd: number } | null> {
  const origStart = clip.trimStart ?? 0;
  const origEnd = clip.trimEnd ?? origStart + 1;
  const windowDur = origEnd - origStart;
  if (windowDur < 1.5) return null; // not worth probing a very short clip

  const probeName = `silprobe_${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const logLines: string[] = [];
  const onLog = ({ message }: { message: string }) => {
    if (message.includes('silence_start') || message.includes('silence_end')) logLines.push(message);
  };

  try {
    await ffmpeg.writeFile(probeName, bytes);
    ffmpeg.on('log', onLog);
    await ffmpeg.exec([
      '-ss', origStart.toFixed(2), '-i', probeName, '-t', windowDur.toFixed(2),
      '-af', 'silencedetect=noise=-30dB:d=0.4', '-f', 'null', '-',
    ]);
  } catch (err) {
    console.warn('Silence probe failed, leaving this clip untrimmed:', err);
    return null;
  } finally {
    ffmpeg.off('log', onLog);
    try {
      await ffmpeg.deleteFile(probeName);
    } catch {
      // ignore cleanup failure
    }
  }

  const starts: number[] = [];
  const ends: number[] = [];
  for (const line of logLines) {
    const sm = /silence_start:\s*(-?[\d.]+)/.exec(line);
    if (sm) starts.push(parseFloat(sm[1]));
    const em = /silence_end:\s*(-?[\d.]+)/.exec(line);
    if (em) ends.push(parseFloat(em[1]));
  }

  let leadingSilenceEnd = 0;
  let trailingSilenceStart = windowDur;
  // Leading silence: silence begins essentially at t=0 of our probed window.
  if (starts.length > 0 && starts[0] <= 0.15 && ends.length > 0) {
    leadingSilenceEnd = Math.min(ends[0], windowDur * 0.4);
  }
  // Trailing silence: the last detected silence_start never got a matching silence_end within
  // the probe window, meaning it ran silent all the way to the end.
  if (starts.length > 0) {
    const lastStart = starts[starts.length - 1];
    const hasMatchingEnd = ends.length >= starts.length;
    if (!hasMatchingEnd && lastStart > windowDur * 0.5) {
      trailingSilenceStart = Math.max(lastStart, windowDur * 0.6);
    }
  }

  if (leadingSilenceEnd <= 0.05 && trailingSilenceStart >= windowDur - 0.05) return null;

  const newStart = origStart + leadingSilenceEnd;
  const newEnd = origStart + trailingSilenceStart;
  if (newEnd - newStart < 1) return null; // guard against trimming a clip down to almost nothing

  return { trimStart: Number(newStart.toFixed(2)), trimEnd: Number(newEnd.toFixed(2)) };
}

function guessExtension(clip: any): string {
  const nameExt = (clip.name || '').split('.').pop();
  if (nameExt && nameExt.length <= 4 && /^[a-zA-Z0-9]+$/.test(nameExt)) return nameExt.toLowerCase();
  const mime: string = clip.file?.type || '';
  if (mime.includes('webm')) return 'webm';
  if (mime.includes('quicktime') || mime.includes('mov')) return 'mov';
  if (mime.includes('png')) return 'png';
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
  if (mime.includes('mpeg') || mime.includes('mp3')) return 'mp3';
  if (clip.type === 'photo') return 'jpg';
  if (clip.type === 'audio') return 'mp3';
  return 'mp4';
}

async function getClipBytes(clip: any): Promise<Uint8Array | null> {
  if (clip.file) {
    try {
      return await toUint8Array(clip.file);
    } catch {
      // fall through to url fetch
    }
  }
  if (clip.url) {
    return tryFetchBytes(clip.url);
  }
  return null;
}

interface DrawtextSpec {
  text: string;
  start: number;
  end: number;
  fontcolor: string;
  fontsize: number;
  pos: 'centre' | 'bottom' | 'top' | 'custom';
  x?: number; // 0-100 percent
  y?: number; // 0-100 percent
  bold?: boolean;
  boxed?: boolean;
}

function buildDrawtextFilter(spec: DrawtextSpec): string {
  const fontfile = spec.bold ? 'font-bold.ttf' : 'font-regular.ttf';
  const text = escapeDrawtext(spec.text);
  let xExpr = '(w-text_w)/2';
  let yExpr = 'h-th-40';
  if (spec.pos === 'top') yExpr = '40';
  else if (spec.pos === 'centre') yExpr = '(h-text_h)/2';
  else if (spec.pos === 'custom' && spec.x != null && spec.y != null) {
    xExpr = `(w*${(spec.x / 100).toFixed(3)})`;
    yExpr = `(h*${(spec.y / 100).toFixed(3)})`;
  }
  const box = spec.boxed ? ':box=1:boxcolor=black@0.45:boxborderw=10' : '';
  const start = Math.max(0, spec.start);
  const end = Math.max(start + 0.1, spec.end);
  return (
    `drawtext=fontfile=${fontfile}:text='${text}':fontsize=${spec.fontsize}:` +
    `fontcolor=${spec.fontcolor.replace('#', '0x')}${box}:x=${xExpr}:y=${yExpr}:` +
    `enable='between(t,${start.toFixed(2)},${end.toFixed(2)})'`
  );
}

/** Maps the app's named waveform visualizer styles to real ffmpeg audio-visualization filters. */
function waveformStyleToFfmpeg(style: string | undefined, w: number, stripH: number): { filter: string; isCorner: boolean } {
  switch (style) {
    case 'spectrum':
      return { filter: `showfreqs=s=${w}x${stripH}:mode=bar:colors=0x818cf8|0x6366f1`, isCorner: false };
    case 'cyber_bars':
      return { filter: `showfreqs=s=${w}x${stripH}:mode=bar:colors=0x00ffcc|0xff00e6`, isCorner: false };
    case 'circular':
      // No native "circular" audio viz in stock ffmpeg; avectorscope's lissajous mode gives
      // a comparable orbiting-dot look. It's inherently square, so it's composited as a
      // small corner overlay rather than stretched across a horizontal strip.
      return { filter: `avectorscope=s=${stripH}x${stripH}:mode=lissajous:rc=99:gc=102:bc=241`, isCorner: true };
    case 'wave':
    default:
      return { filter: `showwaves=s=${w}x${stripH}:mode=cline:colors=white`, isCorner: false };
  }
}

// ---- Main render pipeline --------------------------------------------------

export class RenderWorkerService {
  private cancelled = false;
  private tempFiles: string[] = [];

  async startRender(
    clips: any[],
    options: RenderOptions,
    onProgress: (progress: number, etaSeconds: number, statusText: string) => void,
    onComplete: (outputUrl: string, warnings?: string[]) => void,
    onError?: (message: string) => void
  ) {
    this.cancelled = false;
    this.tempFiles = [];
    const startedAt = Date.now();
    const warnings: string[] = [];

    // Monotonic clamp: pct can only ever go up. Without this, the live per-clip
    // interpolation below (driven by ffmpeg's own progress events, which reset to 0 at the
    // start of every single ffmpeg.exec() call - and a single clip can involve 2+ execs, e.g.
    // a silence-detection pass followed by the real transcode) would make the bar visibly
    // jump backwards.
    let maxReportedPct = 0;
    const report = (pct: number, statusText: string) => {
      const clamped = Math.max(pct, maxReportedPct);
      maxReportedPct = clamped;
      const elapsed = (Date.now() - startedAt) / 1000;
      const rate = clamped > 0 ? elapsed / clamped : 0;
      const etaSeconds = Math.max(0, Math.round(rate * (100 - clamped)));
      onProgress(Math.min(99, Math.round(clamped)), etaSeconds, statusText);
    };

    // The per-clip checkpoints below only report once *before* that clip's ffmpeg command(s)
    // start - for a real (non-trivial) clip, the actual transcode can take a long time, during
    // which the reported percentage previously sat completely frozen. That's indistinguishable
    // from a hang to anyone watching it, which is exactly what was reported. This listens to
    // ffmpeg.wasm's own real-time encode progress and interpolates smoothly within whichever
    // clip is currently processing, so the number visibly keeps moving instead of stalling.
    // Only active during the per-clip loop (liveClipWeight is 0 the rest of the time), and
    // removed at every exit path below so it can't leak into - or keep firing after - a
    // later render that reuses the same singleton ffmpeg instance.
    let liveClipBase = 0;
    let liveClipWeight = 0;
    let liveStatusText = '';
    const onFfmpegLiveProgress = ({ progress }: { progress: number }) => {
      if (this.cancelled || liveClipWeight === 0) return;
      // ffmpeg.wasm's progress value is unreliable for some command shapes (concat demuxer,
      // complex filtergraphs) - it can report negative or >1 values outside the per-clip
      // transcode this is meant to track. Clamping to [0,1] combined with report()'s own
      // monotonic clamp means a bad reading can only ever be a no-op, never a visible glitch.
      const clamped01 = Math.min(1, Math.max(0, progress));
      report(liveClipBase + clamped01 * liveClipWeight, liveStatusText);
    };
    // Declared outside the try block so the catch block below can still reach it to detach
    // the listener - the `ffmpeg` const from getFFmpeg() only exists inside the try's scope.
    let ffmpegRef: FFmpeg | null = null;

    try {
      if (!clips || clips.length === 0) {
        throw new Error('No clips to render.');
      }

      // Resolve output spec for this render - shadows the module defaults so both the
      // advanced "Stitch & Render" panel and the simpler "Compile & Download" export
      // panel share this exact same real pipeline, just with different parameters.
      const OUT_W = options.outputWidth || DEFAULT_OUT_W;
      const OUT_H = options.outputHeight || DEFAULT_OUT_H;
      const OUT_FPS = options.outputFps || DEFAULT_OUT_FPS;
      const qualityToCrf: Record<string, number> = { high: 18, balanced: 23, fast: 28 };
      const CRF = String(qualityToCrf[options.quality || 'balanced'] ?? 23);

      report(1, 'Booting up local video engine (WebAssembly FFmpeg)...');
      const ffmpeg = await getFFmpeg(undefined, (stage) => {
        if (!this.cancelled) report(1, stage);
      });
      if (this.cancelled) return;
      ffmpegRef = ffmpeg;
      // Bound every individual ffmpeg command so a hung/OOM'd WASM worker fails loudly
      // instead of freezing the export forever with no error and no download.
      withExecTimeout(ffmpeg);
      await ensureFonts(ffmpeg);
      ffmpeg.on('progress', onFfmpegLiveProgress);

      // Weighting: 65% for per-clip transcoding, 15% for transitions, 15% for concat, 5% for audio mix/finishing.
      const perClipWeight = clips.length > 0 ? 65 / clips.length : 0;
      const processedClips: { file: string; duration: number; transition?: string; transitionDuration?: number }[] = [];
      let cumulativeTimelineOffset = 0;
      // Collected from each clip's Whisper-generated subtitle timings (if captions were generated),
      // mapped onto the final timeline. Used to auto-duck the background soundtrack under speech,
      // and skipped harmlessly if no clip has captions.
      const speechWindows: { start: number; end: number }[] = [];

      for (let i = 0; i < clips.length; i++) {
        if (this.cancelled) return;
        const clip = { ...clips[i] }; // local shallow copy - silence-trim below may adjust
        // trimStart/trimEnd on this copy only, never mutating the caller's actual clips array.
        const outName = `clip_${i}.mp4`;

        liveClipBase = 1 + i * perClipWeight;
        liveClipWeight = perClipWeight;
        liveStatusText = `Processing clip ${i + 1} of ${clips.length} (${clip.name || 'untitled'})...`;
        report(liveClipBase, liveStatusText);

        const bytes = await getClipBytes(clip);
        if (!bytes) {
          // Graceful fallback: skip an unreachable/missing clip rather than aborting the whole render.
          console.warn(`Skipping clip "${clip.name}" - source media could not be read.`);
          continue;
        }

        if (options.autoTrimSilence && clip.type === 'video') {
          report(1 + i * perClipWeight, `Detecting dead air in clip ${i + 1} of ${clips.length}...`);
          const trimmed = await detectAndTrimSilence(ffmpeg, bytes, clip, guessExtension(clip));
          if (trimmed) {
            clip.trimStart = trimmed.trimStart;
            clip.trimEnd = trimmed.trimEnd;
          }
        }

        const duration = Math.max(0.3, (clip.trimEnd ?? 1) - (clip.trimStart ?? 0));

        // Real-word timing already exists whenever this clip has generated captions -
        // reuse it (rather than a separate detection pass) to know when speech happens,
        // for soundtrack auto-ducking below.
        if (Array.isArray(clip.subtitles)) {
          for (const sub of clip.subtitles) {
            if (!sub.text || !sub.text.trim()) continue;
            const s = cumulativeTimelineOffset + Math.max(0, (sub.start ?? 0));
            const e = cumulativeTimelineOffset + Math.max((sub.start ?? 0) + 0.1, (sub.end ?? duration));
            speechWindows.push({ start: s, end: e });
          }
        }

        const activeFilter = clip.filter && clip.filter !== 'none' ? clip.filter : options.videoFilter;
        const videoFaceBox = clip.faceCentering && clip.faceBox ? clip.faceBox : null;
        let canvasFit: string;
        if (options.fitMode === 'cover') {
          // Real face-aware cropping: bias the crop window toward the detected face instead of
          // always cutting to plain dead-center, when "Speaker Face Centering" found a real face.
          if (videoFaceBox) {
            const fx = Math.min(0.9, Math.max(0.1, videoFaceBox.cx));
            const fy = Math.min(0.85, Math.max(0.1, videoFaceBox.cy));
            canvasFit =
              `scale=${OUT_W}:${OUT_H}:force_original_aspect_ratio=increase,` +
              `crop=${OUT_W}:${OUT_H}:x='max(0,min(iw-${OUT_W},${fx.toFixed(3)}*iw-${OUT_W}/2))':y='max(0,min(ih-${OUT_H},${fy.toFixed(3)}*ih-${OUT_H}/2))'`;
          } else {
            canvasFit = `scale=${OUT_W}:${OUT_H}:force_original_aspect_ratio=increase,crop=${OUT_W}:${OUT_H}`;
          }
        } else if (options.fitMode === 'blur') {
          // LibreCuts-style "canvas background": a blurred, cover-scaled backdrop of the same
          // frame behind a letterboxed (contain-scaled) foreground, instead of plain black bars.
          canvasFit =
            `split=2[bg_src][fg_src];` +
            `[bg_src]scale=${OUT_W}:${OUT_H}:force_original_aspect_ratio=increase,crop=${OUT_W}:${OUT_H},gblur=sigma=22[bg_blur];` +
            `[fg_src]scale=${OUT_W}:${OUT_H}:force_original_aspect_ratio=decrease[fg_fit];` +
            `[bg_blur][fg_fit]overlay=(W-w)/2:(H-h)/2`;
        } else {
          canvasFit = `scale=${OUT_W}:${OUT_H}:force_original_aspect_ratio=decrease,pad=${OUT_W}:${OUT_H}:(ow-iw)/2:(oh-ih)/2:color=black`;
        }
        const vf = [canvasFit, 'setsar=1', `fps=${OUT_FPS}`];
        const namedFilter = videoFilterToFfmpeg(activeFilter);
        if (namedFilter) vf.push(namedFilter);
        const grade = colorGradeToFfmpeg(options.colorGrade);
        if (grade) vf.push(grade);
        const chromaKeyFilter = chromaKeyToFfmpeg(clip.chromaKey);
        // Speed change: setpts scales playback time (video); the matching audio-side
        // atempo chain is applied separately below, in the audio filter list.
        const clipSpeed = clampRetimeRate(clip.speed ?? 1);
        if (clipSpeed !== 1) vf.push(`setpts=PTS/${clipSpeed.toFixed(3)}`);
        if (clip.reversed) vf.push('reverse');
        const fadeInSec = Math.max(0, clip.fadeIn || 0);
        const fadeOutSec = Math.max(0, clip.fadeOut || 0);
        // Freeze frame: holds the clip's last decoded frame for an extra N seconds
        // (LibreCuts' "freeze frame" action), applied after speed/reverse so it always
        // freezes on the actual final frame of the processed clip.
        const freezeSec = Math.max(0, clip.freezeFrameSec || 0);
        if (freezeSec > 0) vf.push(`tpad=stop_mode=clone:stop_duration=${freezeSec.toFixed(2)}`);
        // Effective output duration after speed change and any freeze-frame extension - this is
        // what downstream concat/transition timing and cumulativeTimelineOffset must use, not the
        // raw trim length, since both speed and freeze-frame change how long the clip actually plays.
        const effectiveDuration = duration / clipSpeed + freezeSec;
        if (fadeInSec > 0) vf.push(`fade=t=in:st=0:d=${fadeInSec.toFixed(2)}`);
        if (fadeOutSec > 0) vf.push(`fade=t=out:st=${Math.max(0, effectiveDuration - fadeOutSec).toFixed(2)}:d=${fadeOutSec.toFixed(2)}`);

        // Burn in per-clip subtitles and any global overlays anchored to this clip's local timeline.
        const drawtextSpecs: DrawtextSpec[] = [];
        if (Array.isArray(clip.subtitles)) {
          for (const sub of clip.subtitles) {
            if (!sub.text) continue;
            drawtextSpecs.push({
              text: sub.text,
              start: sub.start ?? 0,
              end: sub.end ?? duration,
              fontcolor: sub.color || '#ffffff',
              fontsize: Math.max(14, Math.round((sub.size || 15) * 1.6)),
              pos: 'bottom',
              boxed: sub.backplate === 'strip',
            });
          }
        }
        if (Array.isArray(options.overlays)) {
          for (const ov of options.overlays) {
            if (!ov.text) continue;
            const appliesToThisClip = ov.clipId
              ? ov.clipId === clip.id
              : // global overlay: only include on the clip(s) its absolute timeline window intersects
                (ov.startTime ?? 0) < cumulativeTimelineOffset + duration &&
                (ov.endTime ?? Infinity) > cumulativeTimelineOffset;
            if (!appliesToThisClip) continue;
            const localStart = ov.clipId ? ov.startTime ?? 0 : Math.max(0, (ov.startTime ?? 0) - cumulativeTimelineOffset);
            const localEnd = ov.clipId
              ? ov.endTime ?? duration
              : Math.min(duration, (ov.endTime ?? duration) - cumulativeTimelineOffset);
            drawtextSpecs.push({
              text: ov.text,
              start: localStart,
              end: localEnd,
              fontcolor: ov.color || '#ffffff',
              fontsize: Math.max(14, Math.round(ov.size || 24)),
              pos: ov.x != null && ov.y != null ? 'custom' : ov.pos || 'centre',
              x: ov.x,
              y: ov.y,
              bold: ov.styleBold,
            });
          }
        }
        for (const spec of drawtextSpecs) {
          vf.push(buildDrawtextFilter(spec));
        }
        // Lower third: an optional Name / Relationship / City caption, styled as a bottom-left
        // bar (LibreCuts-style lower third) rather than plain centered text. Shown for the
        // first few seconds of the clip, or for the clip's full length if it's short.
        if (clip.lowerThird && (clip.lowerThird.name || clip.lowerThird.relationship || clip.lowerThird.city)) {
          const lt = clip.lowerThird;
          const nameLine = escapeDrawtext(lt.name || '');
          const subLine = escapeDrawtext([lt.relationship, lt.city].filter(Boolean).join(' • '));
          const showFor = Math.min(effectiveDuration, Math.max(3, lt.durationSec || 4));
          if (nameLine) {
            vf.push(
              `drawtext=fontfile=font-bold.ttf:text='${nameLine}':fontsize=30:fontcolor=white:` +
              `box=1:boxcolor=black@0.55:boxborderw=14:x=60:y=h-160:` +
              `enable='between(t,0,${showFor.toFixed(2)})'`
            );
          }
          if (subLine) {
            vf.push(
              `drawtext=fontfile=font-regular.ttf:text='${subLine}':fontsize=20:fontcolor=0xd1d5db:` +
              `box=1:boxcolor=black@0.55:boxborderw=10:x=60:y=h-110:` +
              `enable='between(t,0,${showFor.toFixed(2)})'`
            );
          }
        }
        // Simple, real decorative frame border (approximates the "animated frame" toggle).
        if (options.animatedFrame && options.animatedFrame !== 'none') {
          vf.push('drawbox=x=0:y=0:w=iw:h=ih:color=white@0.85:t=12');
        }

        const filterChain = vf.join(',');
        const inputExt = guessExtension(clip);

        try {
          if (clip.type === 'photo') {
            const inName = `src_${i}.${inputExt}`;
            await ffmpeg.writeFile(inName, bytes);
            this.tempFiles.push(inName);
            // Ken Burns pan/zoom (every photo should move, not sit static) - mirrors the live
            // preview's slow zoom-in, but as a real baked-in ffmpeg zoompan effect. When face
            // detection found a subject (clip.faceBox), the pan target is biased toward their
            // actual face instead of the plain image center.
            const totalFrames = Math.max(2, Math.round(duration * OUT_FPS));
            const faceBox = clip.faceCentering && clip.faceBox ? clip.faceBox : null;
            const fx = faceBox ? Math.min(0.9, Math.max(0.1, faceBox.cx)) : 0.5;
            const fy = faceBox ? Math.min(0.85, Math.max(0.1, faceBox.cy)) : 0.42;
            const maxZoom = faceBox ? 1.28 : 1.12; // zoom in further when we can confidently frame a real face
            const zoomExpr = `1+${(maxZoom - 1).toFixed(3)}*on/${totalFrames}`;
            const xExpr = `max(0,min(iw-iw/zoom,${fx.toFixed(3)}*iw-(iw/zoom/2)))`;
            const yExpr = `max(0,min(ih-ih/zoom,${fy.toFixed(3)}*ih-(ih/zoom/2)))`;
            const photoVf = [
              `scale=${OUT_W * 2}:${OUT_H * 2}:force_original_aspect_ratio=increase`,
              `zoompan=z='${zoomExpr}':d=${totalFrames}:x='${xExpr}':y='${yExpr}':s=${OUT_W}x${OUT_H}:fps=${OUT_FPS}`,
              'setsar=1',
            ];
            const photoNamedFilter = videoFilterToFfmpeg(activeFilter);
            if (photoNamedFilter) photoVf.push(photoNamedFilter);
            const photoGrade = colorGradeToFfmpeg(options.colorGrade);
            if (photoGrade) photoVf.push(photoGrade);
            const photoFadeIn = Math.max(0, clip.fadeIn || 0);
            const photoFadeOut = Math.max(0, clip.fadeOut || 0);
            if (photoFadeIn > 0) photoVf.push(`fade=t=in:st=0:d=${photoFadeIn.toFixed(2)}`);
            if (photoFadeOut > 0) photoVf.push(`fade=t=out:st=${Math.max(0, duration - photoFadeOut).toFixed(2)}:d=${photoFadeOut.toFixed(2)}`);
            await ffmpeg.exec([
              '-loop', '1', '-t', duration.toFixed(2), '-i', inName,
              '-f', 'lavfi', '-t', duration.toFixed(2), '-i', `anullsrc=r=${TARGET_SAMPLE_RATE}:cl=stereo`,
              '-vf', photoVf.join(','),
              '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', CRF, '-pix_fmt', 'yuv420p',
              '-c:a', 'aac', '-shortest', outName,
            ]);
          } else if (clip.type === 'text') {
            // Wish-card: colored background with the message burned in via drawtext.
            // White-label branding: a custom background tint and/or a logo overlay in the
            // top-right corner, when the organizer has set them in their profile.
            const cardText = escapeDrawtext(clip.textBody || clip.name || '');
            const bgColor = options.brandColor ? `0x${options.brandColor.replace('#', '')}` : '0x1c1917';
            const drawtextStage =
              `drawtext=fontfile=font-bold.ttf:text='${cardText}':fontsize=40:fontcolor=white:` +
              'x=(w-text_w)/2:y=(h-text_h)/2:box=1:boxcolor=black@0.35:boxborderw=20';

            let brandLogoBytes: Uint8Array | null = null;
            if (options.brandLogoDataUrl) {
              try {
                const match = /^data:(.+);base64,(.*)$/.exec(options.brandLogoDataUrl);
                if (match) {
                  const binary = atob(match[2]);
                  const arr = new Uint8Array(binary.length);
                  for (let bi = 0; bi < binary.length; bi++) arr[bi] = binary.charCodeAt(bi);
                  brandLogoBytes = arr;
                }
              } catch (logoErr) {
                console.warn('Could not decode brand logo, skipping overlay for this card:', logoErr);
              }
            }

            if (brandLogoBytes) {
              await ffmpeg.writeFile('brand_logo.png', brandLogoBytes);
              this.tempFiles.push('brand_logo.png');
              await ffmpeg.exec([
                '-f', 'lavfi', '-i', `color=c=${bgColor}:s=${OUT_W}x${OUT_H}:d=${duration.toFixed(2)}:r=${OUT_FPS}`,
                '-i', 'brand_logo.png',
                '-f', 'lavfi', '-t', duration.toFixed(2), '-i', `anullsrc=r=${TARGET_SAMPLE_RATE}:cl=stereo`,
                '-filter_complex',
                `[1:v]scale=140:-1[logo];[0:v][logo]overlay=W-w-40:40[bg];[bg]${drawtextStage}[vout]`,
                '-map', '[vout]', '-map', '2:a',
                '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', CRF, '-pix_fmt', 'yuv420p',
                '-c:a', 'aac', '-shortest', outName,
              ]);
            } else {
              const cardFilter = `color=c=${bgColor}:s=${OUT_W}x${OUT_H}:d=${duration.toFixed(2)}:r=${OUT_FPS},${drawtextStage}`;
              await ffmpeg.exec([
                '-f', 'lavfi', '-i', cardFilter,
                '-f', 'lavfi', '-t', duration.toFixed(2), '-i', `anullsrc=r=${TARGET_SAMPLE_RATE}:cl=stereo`,
                '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', CRF, '-pix_fmt', 'yuv420p',
                '-c:a', 'aac', '-shortest', outName,
              ]);
            }
          } else if (clip.type === 'audio') {
            const inName = `src_${i}.${inputExt}`;
            await ffmpeg.writeFile(inName, bytes);
            this.tempFiles.push(inName);
            const audioFxChain = [
              options.audioReversed ? 'areverse' : null,
              options.audioPitch && options.audioPitch !== 1
                ? `asetrate=${TARGET_SAMPLE_RATE}*${options.audioPitch},aresample=${TARGET_SAMPLE_RATE}`
                : null,
              options.autoLevel !== false ? loudnormFilter(effectiveDuration) : null,
            ].filter(Boolean).join(',');
            const aLabelChain = audioFxChain ? `,${audioFxChain}` : '';
            await ffmpeg.exec([
              '-i', inName,
              '-filter_complex',
              `[0:a]atrim=${(clip.trimStart ?? 0).toFixed(2)}:${(clip.trimEnd ?? duration).toFixed(2)},asetpts=PTS-STARTPTS${aLabelChain}[a];[a]showwaves=s=${OUT_W}x${OUT_H}:mode=cline:colors=white[v]`,
              '-map', '[v]', '-map', '[a]',
              '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', CRF, '-pix_fmt', 'yuv420p',
              '-c:a', 'aac', outName,
            ]);
          } else {
            // Default: real video clip.
            const inName = `src_${i}.${inputExt}`;
            await ffmpeg.writeFile(inName, bytes);
            this.tempFiles.push(inName);
            const audioFilters: string[] = [];
            // Per-clip volume (LibreCuts-style "amplify up to 200%") - applied before normalization
            // so loudnorm still evens things out, but a deliberately quiet/loud clip keeps its intent.
            // A clip with its audio detached (see handleDetachAudio in VideoStudio.tsx) is forced
            // silent here - its sound now comes from the separate audio clip split off from it.
            const clipVolumePct = clip.audioDetached ? 0 : (clip.volume !== undefined ? clip.volume : 100);
            if (clipVolumePct !== 100) audioFilters.push(`volume=${(clipVolumePct / 100).toFixed(2)}`);
            if (clip.reversed || options.audioReversed) audioFilters.push('areverse');
            if (clipSpeed !== 1) audioFilters.push(speedChangeAudioFilter(clipSpeed, clip.maintainPitch));
            if (options.audioPitch && options.audioPitch !== 1) {
              audioFilters.push(`asetrate=${TARGET_SAMPLE_RATE}*${options.audioPitch}`, `aresample=${TARGET_SAMPLE_RATE}`);
            }
            if (options.autoLevel !== false) {
              // Single-pass loudness normalization to a broadcast-standard target - contributors
              // record on wildly different devices (some too quiet, some clipping); this evens
              // everything out so the compiled video doesn't jump in volume clip to clip.
              // Skipped on very short clips - see MIN_LOUDNORM_DURATION comment above - where
              // it would otherwise audibly pump/"shake" the volume instead of smoothing it.
              const lf = loudnormFilter(effectiveDuration);
              if (lf) audioFilters.push(lf);
            }
            if (freezeSec > 0) audioFilters.push(`apad=pad_dur=${freezeSec.toFixed(2)}`);
            if (fadeInSec > 0) audioFilters.push(`afade=t=in:st=0:d=${fadeInSec.toFixed(2)}`);
            if (fadeOutSec > 0) audioFilters.push(`afade=t=out:st=${Math.max(0, effectiveDuration - fadeOutSec).toFixed(2)}:d=${fadeOutSec.toFixed(2)}`);
            const audioFilterStr = audioFilters.length > 0 ? audioFilters.join(',') : 'anull';

            if (chromaKeyFilter) {
              // Real green-screen removal: key out the chosen color from the clip's own footage,
              // then flatten the resulting transparent pixels onto a solid backdrop color, since
              // stock H.264/mp4 output can't carry an alpha channel through to the final concat.
              // (Chroma key takes priority over the live-waveform overlay if both are set on the
              // same clip, since compositing both onto one frame isn't supported in this pass.)
              const bg = (clip.chromaKey?.bgColor || '#000000').replace('#', '0x');
              const keyedFilterComplex =
                `[0:v]${filterChain},${chromaKeyFilter},format=yuva420p[fg];` +
                `[1:v]${bg}[bgv];` +
                `[bgv][fg]overlay=(W-w)/2:(H-h)/2:format=auto[vout]`;
              try {
                await ffmpeg.exec([
                  '-ss', (clip.trimStart ?? 0).toFixed(2),
                  '-i', inName,
                  '-f', 'lavfi', '-t', duration.toFixed(2), '-i', `color=c=${bg}:s=${OUT_W}x${OUT_H}:d=${duration.toFixed(2)}:r=${OUT_FPS}`,
                  '-t', duration.toFixed(2),
                  '-filter_complex', keyedFilterComplex,
                  '-map', '[vout]', '-map', '0:a',
                  ...(audioFilterStr !== 'anull' ? ['-af', audioFilterStr] : []),
                  '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', CRF, '-pix_fmt', 'yuv420p',
                  '-c:a', 'aac', '-ar', String(TARGET_SAMPLE_RATE), '-ac', '2',
                  outName,
                ]);
              } catch (noAudioErr) {
                console.warn(`Clip "${clip.name}" chroma-key pass failed (likely no audio track) — retrying with a silent track:`, noAudioErr);
                await ffmpeg.exec([
                  '-ss', (clip.trimStart ?? 0).toFixed(2),
                  '-i', inName,
                  '-f', 'lavfi', '-t', duration.toFixed(2), '-i', `color=c=${bg}:s=${OUT_W}x${OUT_H}:d=${duration.toFixed(2)}:r=${OUT_FPS}`,
                  '-f', 'lavfi', '-t', duration.toFixed(2), '-i', `anullsrc=r=${TARGET_SAMPLE_RATE}:cl=stereo`,
                  '-t', duration.toFixed(2),
                  '-filter_complex', keyedFilterComplex,
                  '-map', '[vout]', '-map', '2:a',
                  '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', CRF, '-pix_fmt', 'yuv420p',
                  '-c:a', 'aac', '-ar', String(TARGET_SAMPLE_RATE), '-ac', '2',
                  outName,
                ]);
              }
            } else if (options.showLiveAudioWaveform) {
              // Composite a real waveform/spectrum visualization (derived from the clip's
              // own audio) onto the video, instead of leaving this a purely cosmetic,
              // non-functional toggle.
              const stripH = Math.round(OUT_H * 0.18);
              const { filter: waveFilter, isCorner } = waveformStyleToFfmpeg(options.waveformStyle, OUT_W, stripH);
              const overlayPos = isCorner ? `W-w-20:H-h-20` : `0:H-h`;
              const filterComplex =
                `[0:a]${audioFilterStr},asplit=2[a_out][a_wave];` +
                `[a_wave]${waveFilter}[wave];` +
                `[0:v]${filterChain}[vbase];` +
                `[vbase][wave]overlay=${overlayPos}:format=auto[vout]`;
              try {
                await ffmpeg.exec([
                  '-ss', (clip.trimStart ?? 0).toFixed(2),
                  '-i', inName,
                  '-t', duration.toFixed(2),
                  '-filter_complex', filterComplex,
                  '-map', '[vout]', '-map', '[a_out]',
                  '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', CRF, '-pix_fmt', 'yuv420p',
                  '-c:a', 'aac', '-ar', String(TARGET_SAMPLE_RATE), '-ac', '2',
                  outName,
                ]);
              } catch (noAudioErr) {
                // Same reasoning as the non-waveform branch below: a video with
                // no audio stream can't feed [0:a] at all. Fall back to a flat
                // silent waveform instead of dropping the clip from the export.
                console.warn(`Clip "${clip.name}" has no audio track for waveform overlay — retrying with a silent track instead of dropping it:`, noAudioErr);
                const silentFilterComplex =
                  `[1:a]asplit=2[a_out][a_wave];` +
                  `[a_wave]${waveFilter}[wave];` +
                  `[0:v]${filterChain}[vbase];` +
                  `[vbase][wave]overlay=${overlayPos}:format=auto[vout]`;
                await ffmpeg.exec([
                  '-ss', (clip.trimStart ?? 0).toFixed(2),
                  '-i', inName,
                  '-f', 'lavfi', '-t', duration.toFixed(2), '-i', `anullsrc=r=${TARGET_SAMPLE_RATE}:cl=stereo`,
                  '-t', duration.toFixed(2),
                  '-filter_complex', silentFilterComplex,
                  '-map', '[vout]', '-map', '[a_out]',
                  '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', CRF, '-pix_fmt', 'yuv420p',
                  '-c:a', 'aac', '-ar', String(TARGET_SAMPLE_RATE), '-ac', '2',
                  outName,
                ]);
              }
            } else {
              const afArgs = audioFilters.length > 0 ? ['-af', audioFilterStr] : [];
              try {
                await ffmpeg.exec([
                  '-ss', (clip.trimStart ?? 0).toFixed(2),
                  '-i', inName,
                  '-t', duration.toFixed(2),
                  '-vf', filterChain,
                  ...afArgs,
                  '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', CRF, '-pix_fmt', 'yuv420p',
                  '-c:a', 'aac', '-ar', String(TARGET_SAMPLE_RATE), '-ac', '2',
                  outName,
                ]);
              } catch (noAudioErr) {
                // Some real, valid video sources have no audio stream at all
                // (muted screen recordings, videos edited elsewhere with audio
                // stripped). The command above implicitly expects an audio
                // stream to encode - without one it fails outright. Retrying
                // with an explicit silent track (same pattern used for photos
                // and text cards) keeps the clip in the export instead of
                // silently dropping it from the final video.
                console.warn(`Clip "${clip.name}" has no audio track — retrying with a silent one instead of dropping it:`, noAudioErr);
                await ffmpeg.exec([
                  '-ss', (clip.trimStart ?? 0).toFixed(2),
                  '-i', inName,
                  '-f', 'lavfi', '-t', duration.toFixed(2), '-i', `anullsrc=r=${TARGET_SAMPLE_RATE}:cl=stereo`,
                  '-t', duration.toFixed(2),
                  '-vf', filterChain,
                  '-map', '0:v', '-map', '1:a',
                  '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', CRF, '-pix_fmt', 'yuv420p',
                  '-c:a', 'aac', '-ar', String(TARGET_SAMPLE_RATE), '-ac', '2',
                  outName,
                ]);
              }
            }
          }
          // This branch only handles real video clips (photo/text/audio are handled above and
          // don't have speed/freeze applied), so the effective duration always reflects those.
          const finalClipDuration = effectiveDuration;
          processedClips.push({ file: outName, duration: finalClipDuration, transition: clip.transition, transitionDuration: clip.transitionDuration });
          this.tempFiles.push(outName);
          cumulativeTimelineOffset += finalClipDuration;
        } catch (clipErr) {
          console.warn(`Failed to process clip "${clip.name}", skipping it:`, clipErr);
          cumulativeTimelineOffset += duration;
        }
      }

      if (processedClips.length === 0) {
        throw new Error('None of the clips could be processed (all sources were unreadable).');
      }

      // Done with the per-clip loop - stop interpolating against it so later stages'
      // (transitions/concat/mixing) own fixed checkpoints below aren't second-guessed by a
      // stray leftover ffmpeg progress event from whichever exec() ran last.
      liveClipWeight = 0;

      // --- Real crossfade/slide transitions -------------------------------
      // Group consecutive clips into "chains" split wherever the transition is 'none'.
      // Each chain of 2+ clips is blended into one file via ffmpeg's xfade/acrossfade
      // filters; a chain of exactly 1 clip is used as-is. Chains are then hard-concatenated
      // (which is correct, since 'none' is exactly where the user wants a hard cut).
      report(67, 'Building transitions between clips...');
      const chains: { file: string; duration: number; transition?: string; transitionDuration?: number }[][] = [];
      let currentChain: { file: string; duration: number; transition?: string }[] = [processedClips[0]];
      for (let i = 1; i < processedClips.length; i++) {
        const incomingTransition = processedClips[i - 1].transition;
        if (incomingTransition && incomingTransition !== 'none') {
          currentChain.push(processedClips[i]);
        } else {
          chains.push(currentChain);
          currentChain = [processedClips[i]];
        }
      }
      chains.push(currentChain);

      const finalSegmentFiles: string[] = [];
      for (let c = 0; c < chains.length; c++) {
        const chain = chains[c];
        if (chain.length === 1) {
          finalSegmentFiles.push(chain[0].file);
          continue;
        }
        const chainOutName = `chain_${c}.mp4`;
        try {
          const inputArgs: string[] = [];
          chain.forEach((seg) => {
            inputArgs.push('-i', seg.file);
          });

          const D_BASE = 0.6;
          let filterComplex = '';
          let prevV = '0:v';
          let prevA = '0:a';
          let cumulative = chain[0].duration;
          let lastTransitionStyleUsed: string | null = null;
          for (let i = 1; i < chain.length; i++) {
            const style = resolveTransitionStyle(chain[i - 1].transition, lastTransitionStyleUsed);
            lastTransitionStyleUsed = style;
            const requestedDur = chain[i - 1].transitionDuration ?? D_BASE;
            const dur = Math.max(0.15, Math.min(requestedDur, chain[i - 1].duration * 0.4, chain[i].duration * 0.4));
            const offset = Math.max(0, cumulative - dur);
            const vOut = `v${i}`;
            const aOut = `a${i}`;
            filterComplex += `[${prevV}][${i}:v]xfade=transition=${style}:duration=${dur.toFixed(2)}:offset=${offset.toFixed(2)}[${vOut}];`;
            filterComplex += `[${prevA}][${i}:a]acrossfade=d=${dur.toFixed(2)}[${aOut}];`;
            prevV = vOut;
            prevA = aOut;
            cumulative = cumulative + chain[i].duration - dur;
          }
          filterComplex = filterComplex.replace(/;$/, '');

          await ffmpeg.exec([
            ...inputArgs,
            '-filter_complex', filterComplex,
            '-map', `[${prevV}]`, '-map', `[${prevA}]`,
            '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', CRF, '-pix_fmt', 'yuv420p',
            '-c:a', 'aac',
            chainOutName,
          ]);
          finalSegmentFiles.push(chainOutName);
          this.tempFiles.push(chainOutName);
        } catch (chainErr) {
          // Defensive fallback: if the crossfade filter graph fails for any reason, don't
          // fail the whole render - just hard-cut those clips together instead.
          console.warn('Crossfade transition failed for a chain, falling back to hard cuts:', chainErr);
          chain.forEach((seg) => finalSegmentFiles.push(seg.file));
        }
      }

      report(82, 'Stitching all clips together...');
      const listContent = finalSegmentFiles.map((f) => `file '${f}'`).join('\n');
      await ffmpeg.writeFile('concat_list.txt', listContent);
      this.tempFiles.push('concat_list.txt');

      const stitchedName = 'stitched.mp4';
      await ffmpeg.exec([
        '-f', 'concat', '-safe', '0', '-i', 'concat_list.txt',
        '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', CRF, '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-ar', String(TARGET_SAMPLE_RATE),
        stitchedName,
      ]);
      this.tempFiles.push(stitchedName);
      if (this.cancelled) return;

      let finalName = stitchedName;

      // Mix in a soundtrack if one was requested and is actually reachable.
      if (options.soundtrackUrl) {
        report(88, 'Mixing in soundtrack...');
        const musicBytes = await tryFetchBytes(options.soundtrackUrl);
        if (musicBytes) {          try {
            await ffmpeg.writeFile('soundtrack.mp3', musicBytes);
            this.tempFiles.push('soundtrack.mp3');
            const vol = ((options.soundtrackVolume ?? 50) / 100).toFixed(2);
            finalName = 'final.mp4';

            // Auto-ducking: lower the soundtrack under speech, using Whisper caption timings
            // collected while processing each clip above. Capped at 60 windows so the filter
            // expression can't grow unreasonably large on a very long, heavily-captioned video.
            let musicVolumeExpr = `volume=${vol}`;
            if (options.autoDuck !== false && speechWindows.length > 0) {
              const capped = speechWindows.slice(0, 60);
              const duckedVol = (parseFloat(vol) * 0.35).toFixed(2);
              const condition = capped.map((w) => `between(t,${w.start.toFixed(2)},${w.end.toFixed(2)})`).join('+');
              // Two volume stages: a base level everywhere, then a lower level only inside speech windows.
              musicVolumeExpr = `volume=${vol},volume=${duckedVol}:enable='${condition}'`;
            }

            await ffmpeg.exec([
              '-i', stitchedName,
              // Loop the soundtrack indefinitely - if it's shorter than the final
              // video it would otherwise play once and then go silent for the
              // rest. amix's duration=first below still caps the actual output
              // to the video's real length, so this only fills gaps, it never
              // extends the video.
              '-stream_loop', '-1', '-i', 'soundtrack.mp3',
              '-filter_complex',
              `[1:a]${musicVolumeExpr}[music];[0:a][music]amix=inputs=2:duration=first:dropout_transition=2[aout]`,
              '-map', '0:v', '-map', '[aout]',
              '-c:v', 'copy', '-c:a', 'aac',
              finalName,
            ]);
            this.tempFiles.push(finalName);
          } catch (mixErr) {
            console.warn('Soundtrack mixing failed, delivering video without soundtrack:', mixErr);
            warnings.push('Soundtrack was downloaded but could not be mixed in (an unexpected ffmpeg error) - your video was still rendered, just without background music.');
            finalName = stitchedName;
          }
        } else {
          // This is the #1 real cause of "I picked a soundtrack but it's not in my video":
          // the built-in tracks are hosted on an external site (soundhelix.com), and browsers
          // require that external site to send CORS headers before JS is allowed to read the
          // actual audio bytes (needed here to hand them to ffmpeg.wasm for mixing) - simply
          // *playing* the track in the live preview doesn't have this requirement, which is
          // why the preview can play music that then fails to make it into the exported file.
          console.warn('Soundtrack source was unreachable (likely a CORS restriction on the external host); delivering video without soundtrack.');
          warnings.push('Background music could not be added: the built-in track is hosted externally and blocked the download needed to mix it into your video (a cross-origin/CORS restriction). It played fine in the preview because preview playback doesn\'t need to read the raw file - only mixing into the export does. Workaround: upload your own MP3 as a custom soundtrack instead, which mixes in reliably.');
        }
      }

      // Global output gain and 3-band EQ - see the RenderOptions doc comments for why these run
      // as one final mixdown pass rather than folding into the per-clip volume filter. Combined
      // into a single ffmpeg pass (rather than one exec per adjustment) so a video with both set
      // only pays for one extra re-encode, not two.
      const finalMixFilters: string[] = [];
      if (options.masterVolume !== undefined && options.masterVolume !== 100) {
        finalMixFilters.push(`volume=${(Math.max(0, options.masterVolume) / 100).toFixed(2)}`);
      }
      if (options.eq && (options.eq.bass !== 0 || options.eq.mid !== 0 || options.eq.treble !== 0)) {
        if (options.eq.bass !== 0) finalMixFilters.push(`bass=g=${options.eq.bass.toFixed(1)}`);
        if (options.eq.treble !== 0) finalMixFilters.push(`treble=g=${options.eq.treble.toFixed(1)}`);
        if (options.eq.mid !== 0) finalMixFilters.push(`equalizer=f=1000:width_type=o:width=2:g=${options.eq.mid.toFixed(1)}`);
      }
      if (finalMixFilters.length > 0) {
        report(89, 'Applying master volume/EQ...');
        try {
          const mixedName = 'final_mix.mp4';
          await ffmpeg.exec(['-i', finalName, '-c:v', 'copy', '-af', finalMixFilters.join(','), '-c:a', 'aac', mixedName]);
          this.tempFiles.push(mixedName);
          finalName = mixedName;
        } catch (mixErr) {
          console.warn('Master volume/EQ adjustment failed, delivering at original level:', mixErr);
          warnings.push('Master volume/EQ could not be applied (an unexpected ffmpeg error) - your video was still rendered, just without that adjustment.');
        }
      }

      const targetFormat = options.outputFormat || 'mp4';

      // Embed timeline markers as real MP4 chapter metadata - visible in YouTube's and most
      // players' scrubbers - via an ffmetadata mux pass. Only meaningful for mp4 output;
      // webm/avi/gif don't reliably support chapter metadata, so this is skipped for those.
      if (targetFormat === 'mp4' && options.markers && options.markers.length > 0) {
        report(96, 'Embedding chapter markers...');
        try {
          const sorted = [...options.markers].sort((a, b) => a.time - b.time);
          const lines = [';FFMETADATA1'];
          for (let i = 0; i < sorted.length; i++) {
            const startMs = Math.max(0, Math.round(sorted[i].time * 1000));
            // No reliable way to know the exact final duration here without an extra probe
            // pass, so the last marker's END is set far beyond any real video length -
            // players clamp chapter boundaries to the actual duration automatically.
            const endMs = i + 1 < sorted.length ? Math.round(sorted[i + 1].time * 1000) : startMs + 999_999_000;
            const safeTitle = sorted[i].label.replace(/[\r\n]/g, ' ').slice(0, 200);
            lines.push('[CHAPTER]', 'TIMEBASE=1/1000', `START=${startMs}`, `END=${endMs}`, `title=${safeTitle}`);
          }
          await ffmpeg.writeFile('chapters.txt', lines.join('\n') + '\n');
          this.tempFiles.push('chapters.txt');
          const chapteredName = 'with_chapters.mp4';
          await ffmpeg.exec([
            '-i', finalName,
            '-i', 'chapters.txt',
            '-map_metadata', '1',
            '-map_chapters', '1',
            '-codec', 'copy',
            chapteredName,
          ]);
          this.tempFiles.push(chapteredName);
          finalName = chapteredName;
        } catch (chapterErr) {
          // Never let a marker-embedding failure block the actual export - the video itself
          // is already done and correct at this point.
          console.warn('Embedding chapter markers failed; delivering video without them:', chapterErr);
        }
      }

      report(97, 'Finalizing output file...');

      let outputName = finalName;
      let mimeType = 'video/mp4';
      if (targetFormat !== 'mp4') {
        try {
          if (targetFormat === 'webm') {
            outputName = 'final_out.webm';
            await ffmpeg.exec(['-i', finalName, '-c:v', 'libvpx-vp9', '-b:v', '1M', '-c:a', 'libopus', outputName]);
            mimeType = 'video/webm';
          } else if (targetFormat === 'avi') {
            outputName = 'final_out.avi';
            await ffmpeg.exec(['-i', finalName, '-c:v', 'mpeg4', '-q:v', '5', '-c:a', 'libmp3lame', outputName]);
            mimeType = 'video/x-msvideo';
          } else if (targetFormat === 'gif') {
            outputName = 'final_out.gif';
            // Palette-based GIF encoding for reasonable quality/size; GIFs have no audio track.
            await ffmpeg.exec([
              '-i', finalName,
              '-vf', `fps=${Math.min(15, OUT_FPS)},scale=${Math.min(OUT_W, 640)}:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse`,
              outputName,
            ]);
            mimeType = 'image/gif';
          }
          this.tempFiles.push(outputName);
        } catch (formatErr) {
          console.warn(`Could not convert final output to ${targetFormat}, delivering .mp4 instead:`, formatErr);
          outputName = finalName;
          mimeType = 'video/mp4';
        }
      }

      const data = await ffmpeg.readFile(outputName);
      const uint8 = data instanceof Uint8Array ? data : new Uint8Array(data as unknown as ArrayBuffer);
      const blob = new Blob([uint8], { type: mimeType });
      const outputUrl = URL.createObjectURL(blob);

      ffmpeg.off('progress', onFfmpegLiveProgress);
      await this.cleanupTempFiles(ffmpeg);
      onProgress(100, 0, 'Render complete!');
      onComplete(outputUrl, warnings);
    } catch (err: any) {
      // ffmpeg is the module-level singleton (reused by the next render too), so this
      // listener must always be detached on the way out - including on failure/cancel -
      // or it keeps firing (into this call's now-stale `report`) on every future render.
      ffmpegRef?.off('progress', onFfmpegLiveProgress);
      if (this.cancelled) {
        // Expected: the user cancelled, or the component unmounted mid-render. Not an error.
        onProgress(0, 0, 'Render cancelled.');
        return;
      }
      const message = err?.message || String(err);
      console.error('Render failed:', err);
      if (onError) {
        onError(message);
      } else {
        onProgress(0, 0, `Render failed: ${message}`);
      }
    }
  }

  /**
   * Real standalone audio export (LibreCuts' "Audio Export" feature): mixes every clip's own
   * audio track (video/audio clips only - photo/text clips contribute silence for their duration
   * so timing still lines up) in timeline order, applies the same per-clip volume/speed/reverse/
   * fade chain used in the video render, then mixes in the soundtrack if one is set, and encodes
   * the result as a real, playable standalone .mp3 file.
   */
  async exportAudioOnly(
    clips: any[],
    options: RenderOptions,
    onProgress: (progress: number, etaSeconds: number, statusText: string) => void,
    onComplete: (outputUrl: string, warnings?: string[]) => void,
    onError?: (message: string) => void
  ) {
    this.cancelled = false;
    this.tempFiles = [];
    const startedAt = Date.now();
    const warnings: string[] = [];
    const report = (pct: number, statusText: string) => {
      const elapsed = (Date.now() - startedAt) / 1000;
      const rate = pct > 0 ? elapsed / pct : 0;
      const etaSeconds = Math.max(0, Math.round(rate * (100 - pct)));
      onProgress(Math.min(99, Math.round(pct)), etaSeconds, statusText);
    };

    try {
      if (!clips || clips.length === 0) throw new Error('No clips to export audio from.');
      report(1, 'Booting up local audio engine (WebAssembly FFmpeg)...');
      const ffmpeg = await getFFmpeg(undefined, (stage) => {
        if (!this.cancelled) report(1, stage);
      });
      if (this.cancelled) return;
      withExecTimeout(ffmpeg);

      const segmentFiles: string[] = [];
      const perClipWeight = clips.length > 0 ? 80 / clips.length : 0;

      for (let i = 0; i < clips.length; i++) {
        if (this.cancelled) return;
        const clip = clips[i];
        const duration = Math.max(0.3, (clip.trimEnd ?? 1) - (clip.trimStart ?? 0));
        const outName = `aseg_${i}.mp3`;
        report(1 + i * perClipWeight, `Extracting audio from clip ${i + 1} of ${clips.length}...`);

        const clipSpeed = clampRetimeRate(clip.speed ?? 1);
        const clipVolumePct = clip.volume !== undefined ? clip.volume : 100;
        const audioFilters: string[] = [];
        if (clipVolumePct !== 100) audioFilters.push(`volume=${(clipVolumePct / 100).toFixed(2)}`);
        if (clip.reversed) audioFilters.push('areverse');
        if (clipSpeed !== 1) audioFilters.push(speedChangeAudioFilter(clipSpeed, clip.maintainPitch));
        const fadeInSec = Math.max(0, clip.fadeIn || 0);
        const fadeOutSec = Math.max(0, clip.fadeOut || 0);
        const effectiveDuration = duration / clipSpeed + Math.max(0, clip.freezeFrameSec || 0);
        if (options.autoLevel !== false) {
          const lf = loudnormFilter(effectiveDuration);
          if (lf) audioFilters.push(lf);
        }
        if (fadeInSec > 0) audioFilters.push(`afade=t=in:st=0:d=${fadeInSec.toFixed(2)}`);
        if (fadeOutSec > 0) audioFilters.push(`afade=t=out:st=${Math.max(0, effectiveDuration - fadeOutSec).toFixed(2)}:d=${fadeOutSec.toFixed(2)}`);

        try {
          if (clip.type === 'video' || clip.type === 'audio') {
            const bytes = await getClipBytes(clip);
            if (!bytes) throw new Error('source unreadable');
            const inName = `asrc_${i}.${guessExtension(clip)}`;
            await ffmpeg.writeFile(inName, bytes);
            this.tempFiles.push(inName);
            const args = [
              '-ss', (clip.trimStart ?? 0).toFixed(2),
              '-i', inName,
              '-t', duration.toFixed(2),
              ...(audioFilters.length > 0 ? ['-af', audioFilters.join(',')] : []),
              '-vn', '-c:a', 'libmp3lame', '-b:a', '192k', '-ar', String(TARGET_SAMPLE_RATE), '-ac', '2',
              outName,
            ];
            await ffmpeg.exec(args);
          } else {
            // Photo/text clips have no audio of their own - insert real silence so the
            // exported track still matches the video timeline's total length.
            await ffmpeg.exec([
              '-f', 'lavfi', '-t', duration.toFixed(2), '-i', `anullsrc=r=${TARGET_SAMPLE_RATE}:cl=stereo`,
              '-c:a', 'libmp3lame', '-b:a', '192k', outName,
            ]);
          }
          segmentFiles.push(outName);
          this.tempFiles.push(outName);
        } catch (segErr) {
          console.warn(`Skipping audio for clip "${clip.name}":`, segErr);
        }
      }

      if (segmentFiles.length === 0) throw new Error('No usable audio could be extracted from any clip.');

      report(85, 'Concatenating audio track...');
      const listContent = segmentFiles.map((f) => `file '${f}'`).join('\n');
      await ffmpeg.writeFile('audio_concat_list.txt', listContent);
      this.tempFiles.push('audio_concat_list.txt');
      let finalName = 'audio_concat.mp3';
      await ffmpeg.exec(['-f', 'concat', '-safe', '0', '-i', 'audio_concat_list.txt', '-c', 'copy', finalName]);
      this.tempFiles.push(finalName);

      if (options.soundtrackUrl) {
        report(92, 'Mixing in soundtrack...');
        const musicBytes = await tryFetchBytes(options.soundtrackUrl);
        if (musicBytes) {
          try {
            await ffmpeg.writeFile('audio_soundtrack.mp3', musicBytes);
            this.tempFiles.push('audio_soundtrack.mp3');
            const vol = ((options.soundtrackVolume ?? 50) / 100).toFixed(2);
            const mixedName = 'audio_final.mp3';
            await ffmpeg.exec([
              '-i', finalName,
              '-stream_loop', '-1', '-i', 'audio_soundtrack.mp3',
              '-filter_complex', `[1:a]volume=${vol}[music];[0:a][music]amix=inputs=2:duration=first:dropout_transition=2[aout]`,
              '-map', '[aout]', '-c:a', 'libmp3lame', '-b:a', '192k',
              mixedName,
            ]);
            finalName = mixedName;
            this.tempFiles.push(finalName);
          } catch (mixErr) {
            console.warn('Audio-export soundtrack mixing failed, delivering voice/clip audio only:', mixErr);
            warnings.push('Soundtrack was downloaded but could not be mixed in (an unexpected ffmpeg error) - your audio was still exported, just without background music.');
          }
        } else {
          warnings.push('Background music could not be added: the built-in track is hosted externally and blocked the download needed to mix it in (a cross-origin/CORS restriction). Try uploading your own MP3 as a custom soundtrack instead.');
        }
      }

      report(98, 'Finalizing MP3 file...');
      const data = await ffmpeg.readFile(finalName);
      const uint8 = data instanceof Uint8Array ? data : new Uint8Array(data as unknown as ArrayBuffer);
      const blob = new Blob([uint8], { type: 'audio/mpeg' });
      const outputUrl = URL.createObjectURL(blob);
      await this.cleanupTempFiles(ffmpeg);
      onProgress(100, 0, 'Audio export complete!');
      onComplete(outputUrl, warnings);
    } catch (err: any) {
      if (this.cancelled) {
        onProgress(0, 0, 'Audio export cancelled.');
        return;
      }
      const message = err?.message || String(err);
      console.error('Audio export failed:', err);
      if (onError) onError(message);
      else onProgress(0, 0, `Audio export failed: ${message}`);
    }
  }

  private async cleanupTempFiles(ffmpeg: FFmpeg) {
    for (const f of this.tempFiles) {
      try {
        await ffmpeg.deleteFile(f);
      } catch {
        // best-effort cleanup; ignore missing files
      }
    }
    this.tempFiles = [];
  }

  /**
   * Cancels an in-progress render immediately - this actually terminates the underlying
   * ffmpeg worker (killing any exec call that's currently running), rather than just
   * setting a flag that's only checked between steps. The engine is automatically
   * reloaded fresh the next time a render starts.
   */
  cancel(onCancelled?: () => void) {
    this.cancelled = true;
    terminateFFmpeg();
    if (onCancelled) onCancelled();
  }

  terminate() {
    this.cancelled = true;
    terminateFFmpeg();
  }
}
