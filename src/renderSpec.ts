/**
 * renderSpec.ts
 *
 * Exposes the render pipeline's real options as a plain JSON "power user" spec:
 * the exact clip list + RenderOptions that RenderWorkerService.startRender()
 * consumes. This turns the Video Studio from a GUI-only tool into something a
 * script (or another tool) can generate content for - paste/import a JSON spec
 * describing exact clips, filters, and output settings, and it renders exactly
 * that, using the identical code path as a normal in-app render.
 */
import type { RenderOptions } from './services/RenderWorker';

export interface RenderSpecClipRef {
  /** Must match a MediaItem id currently in the project's media library. */
  mediaId: string;
  trimStart?: number;
  trimEnd?: number;
  filter?: string;
  transition?: 'none' | 'fade' | 'slide';
  subtitles?: Array<{ text: string; start: number; end: number; color?: string; size?: number; backplate?: string }>;
}

export interface RenderSpec {
  formatVersion: 1;
  clips: RenderSpecClipRef[];
  options: RenderOptions;
}

/** Builds a portable RenderSpec JSON from the studio's current in-memory clip/timeline state. */
export function exportRenderSpec(clips: any[], options: RenderOptions): RenderSpec {
  return {
    formatVersion: 1,
    clips: clips.map((c) => ({
      mediaId: c.id,
      trimStart: c.trimStart,
      trimEnd: c.trimEnd,
      filter: c.filter,
      transition: c.transition,
      subtitles: c.subtitles,
    })),
    options,
  };
}

/**
 * Parses a RenderSpec JSON string and resolves each clip reference against the
 * given media library, returning ready-to-render clip objects + options - the
 * same shape RenderWorkerService.startRender() already expects. Throws with a
 * clear message if a referenced mediaId can't be found (e.g. spec written
 * against a different project).
 */
export function importRenderSpec(json: string, mediaLibrary: any[]): { clips: any[]; options: RenderOptions } {
  let spec: RenderSpec;
  try {
    spec = JSON.parse(json);
  } catch {
    throw new Error('That is not valid JSON.');
  }
  if (!spec || spec.formatVersion !== 1 || !Array.isArray(spec.clips)) {
    throw new Error('That does not look like a Zipp Zap render spec (missing formatVersion/clips).');
  }

  const byId = new Map(mediaLibrary.map((m) => [m.id, m]));
  const clips = spec.clips.map((ref) => {
    const media = byId.get(ref.mediaId);
    if (!media) {
      throw new Error(`Render spec references media id "${ref.mediaId}" which isn't in this project's library.`);
    }
    return {
      ...media,
      trimStart: ref.trimStart ?? 0,
      trimEnd: ref.trimEnd ?? media.dur ?? 1,
      filter: ref.filter ?? 'none',
      transition: ref.transition ?? 'none',
      subtitles: ref.subtitles ?? media.subtitles ?? [],
    };
  });

  return { clips, options: spec.options || {} };
}
