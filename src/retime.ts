/**
 * Retime (speed) helpers.
 *
 * Adapted from opencut-classic's retime module: a clamped, always-valid playback rate,
 * plus a "maintain pitch" flag that's distinct from the rate itself - changing speed and
 * changing pitch are two different creative decisions, not one setting.
 */

export const DEFAULT_RETIME_RATE = 1;
export const MIN_RETIME_RATE = 0.1;
export const MAX_RETIME_RATE = 4;

/** Always returns a finite, positive rate within [MIN_RETIME_RATE, MAX_RETIME_RATE].
 *  Falls back to 1x for anything invalid (NaN, 0, negative, Infinity) rather than letting
 *  a bad value reach ffmpeg's atempo chain, which errors on out-of-range input. */
export function clampRetimeRate(rate: number): number {
  if (!Number.isFinite(rate) || rate <= 0) return DEFAULT_RETIME_RATE;
  return Math.min(Math.max(rate, MIN_RETIME_RATE), MAX_RETIME_RATE);
}

/** Whether it's meaningful to offer a "maintain pitch" toggle at all for this rate
 *  (it's a no-op exactly at 1x). */
export function canMaintainPitch(rate: number): boolean {
  return clampRetimeRate(rate) !== 1;
}

/** Converts a clip-local playback time to the equivalent source-media time at a given rate. */
export function getSourceTimeAtClipTime(clipTime: number, rate: number): number {
  return clipTime * clampRetimeRate(rate);
}

/** Converts a source-media time back to clip-local playback time at a given rate. */
export function getClipTimeAtSourceTime(sourceTime: number, rate: number): number {
  return sourceTime / clampRetimeRate(rate);
}

/** How long a trimmed source span will play for on the timeline once retimed. */
export function getTimelineDurationForSourceSpan(sourceSpanSeconds: number, rate: number): number {
  if (sourceSpanSeconds <= 0) return 0;
  return sourceSpanSeconds / clampRetimeRate(rate);
}
