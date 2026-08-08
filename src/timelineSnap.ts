/**
 * Magnetic timeline snapping.
 *
 * Adapted from the snap-resolution technique in opencut-classic's timeline/snapping module:
 * given a dragged value and a set of "magnet" points, pull the drag to the closest one
 * within a pixel-based threshold (converted to seconds using the current zoom/scale), rather
 * than snapping to a fixed distance regardless of how zoomed-in the timeline is.
 */

export interface SnapPoint {
  /** Time in seconds this magnet point sits at. */
  time: number;
  /** What kind of point this is, so callers can label or filter (e.g. "whole-second" vs "caption"). */
  type: 'grid' | 'caption' | 'playhead' | 'bookmark';
  label?: string;
}

export interface SnapResult {
  snappedTime: number;
  snapPoint: SnapPoint | null;
  didSnap: boolean;
}

/** Default screen-space distance (in px) within which a drag will snap to a nearby point. */
export const DEFAULT_SNAP_THRESHOLD_PX = 8;

/** Converts a pixel-space snap threshold into a time-space one for the current zoom level. */
export function getSnapThresholdSeconds({
  pixelsPerSecond,
  thresholdPx = DEFAULT_SNAP_THRESHOLD_PX,
}: {
  pixelsPerSecond: number;
  thresholdPx?: number;
}): number {
  if (!pixelsPerSecond || pixelsPerSecond <= 0) return 0;
  return thresholdPx / pixelsPerSecond;
}

/**
 * Finds the closest snap point to `targetTime` within `thresholdSeconds`. Returns the
 * original (unsnapped) time if nothing is close enough, so callers can just always use
 * `snappedTime` without checking `didSnap` first.
 */
export function resolveSnap({
  targetTime,
  snapPoints,
  thresholdSeconds,
}: {
  targetTime: number;
  snapPoints: SnapPoint[];
  thresholdSeconds: number;
}): SnapResult {
  let closest: SnapPoint | null = null;
  let closestDistance = Infinity;

  for (const point of snapPoints) {
    const distance = Math.abs(targetTime - point.time);
    if (distance <= thresholdSeconds && distance < closestDistance) {
      closestDistance = distance;
      closest = point;
    }
  }

  return {
    snappedTime: closest ? closest.time : targetTime,
    snapPoint: closest,
    didSnap: closest !== null,
  };
}

/** Builds whole-second gridline snap points across a duration, e.g. for a clip's trim slider. */
export function buildWholeSecondSnapPoints(durationSeconds: number): SnapPoint[] {
  const points: SnapPoint[] = [];
  const wholeSeconds = Math.floor(durationSeconds);
  for (let s = 0; s <= wholeSeconds; s++) {
    points.push({ time: s, type: 'grid' });
  }
  return points;
}

/** Builds snap points from a clip's caption/subtitle cue boundaries, if it has any. */
export function buildCaptionSnapPoints(subtitles: Array<{ start?: number; end?: number; text?: string }> | undefined): SnapPoint[] {
  if (!Array.isArray(subtitles)) return [];
  const points: SnapPoint[] = [];
  for (const sub of subtitles) {
    if (!sub.text || !sub.text.trim()) continue;
    if (typeof sub.start === 'number') points.push({ time: sub.start, type: 'caption', label: sub.text });
    if (typeof sub.end === 'number') points.push({ time: sub.end, type: 'caption', label: sub.text });
  }
  return points;
}
